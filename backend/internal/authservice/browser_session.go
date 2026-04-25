package authservice

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
)

const browserSessionKeyPrefix = "auth:browser-session:"

type browserSessionState struct {
	UserID    string    `json:"userId"`
	ExpiresAt time.Time `json:"expiresAt"`
}

func (s Service) browserSessionTTLForUser(user loginUser) time.Duration {
	ttl := s.RefreshCookieTTL
	if ttl <= 0 {
		ttl = 7 * 24 * time.Hour
	}
	if active := user.ActiveTenant; active != nil && active.JWTRefreshExpiresSeconds != nil && *active.JWTRefreshExpiresSeconds > 0 {
		ttl = time.Duration(*active.JWTRefreshExpiresSeconds) * time.Second
	}
	return ttl
}

func (s Service) browserSessionTTLForUserID(ctx context.Context, userID string) (time.Duration, error) {
	if s.DB == nil || userID == "" {
		return s.browserSessionTTLForUser(loginUser{}), nil
	}

	user, err := s.loadLoginUserByID(ctx, userID)
	if err != nil {
		return 0, err
	}
	return s.browserSessionTTLForUser(user), nil
}

func (s Service) ApplyBrowserAuthCookies(ctx context.Context, w http.ResponseWriter, userID, refreshToken string, ttl time.Duration) (string, error) {
	if ttl <= 0 {
		ttl = s.browserSessionTTLForUser(loginUser{})
	}
	if s.Redis != nil && userID != "" {
		sessionID := uuid.NewString()
		state := browserSessionState{
			UserID:    userID,
			ExpiresAt: time.Now().Add(ttl).UTC(),
		}
		raw, err := json.Marshal(state)
		if err != nil {
			return "", fmt.Errorf("marshal browser session: %w", err)
		}
		if err := s.Redis.Set(ctx, browserSessionKeyPrefix+sessionID, raw, ttl).Err(); err != nil {
			return "", fmt.Errorf("store browser session: %w", err)
		}
		s.setBrowserSessionCookie(w, sessionID, ttl)
	}

	s.setRefreshTokenCookie(w, refreshToken, ttl)
	return s.setCSRFCookie(w, ttl), nil
}

func (s Service) TouchBrowserSession(ctx context.Context, sessionID, userID string, ttl time.Duration) (string, error) {
	if s.Redis == nil || userID == "" {
		return "", nil
	}
	if ttl <= 0 {
		ttl = s.browserSessionTTLForUser(loginUser{})
	}

	if sessionID != "" {
		raw, err := s.Redis.Get(ctx, browserSessionKeyPrefix+sessionID).Bytes()
		switch {
		case err == nil:
			var state browserSessionState
			if unmarshalErr := json.Unmarshal(raw, &state); unmarshalErr != nil || state.UserID != userID {
				sessionID = ""
			}
		case errors.Is(err, redis.Nil):
			sessionID = ""
		case err != nil:
			return "", fmt.Errorf("load browser session: %w", err)
		}
	}

	if sessionID == "" {
		sessionID = uuid.NewString()
	}

	raw, err := json.Marshal(browserSessionState{
		UserID:    userID,
		ExpiresAt: time.Now().Add(ttl).UTC(),
	})
	if err != nil {
		return "", fmt.Errorf("marshal browser session: %w", err)
	}
	if err := s.Redis.Set(ctx, browserSessionKeyPrefix+sessionID, raw, ttl).Err(); err != nil {
		return "", fmt.Errorf("store browser session: %w", err)
	}
	return sessionID, nil
}

func (s Service) HandleSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	if sessionCookie, err := r.Cookie(s.browserSessionCookieName()); err == nil && sessionCookie.Value != "" {
		result, ttl, err := s.RestoreBrowserSession(r.Context(), sessionCookie.Value, requestIP(r), r.UserAgent())
		if err == nil {
			csrfToken := s.ensureCSRFCookie(w, r, ttl)
			app.WriteJSON(w, http.StatusOK, map[string]any{
				"accessToken": result.accessToken,
				"csrfToken":   csrfToken,
				"user":        result.user,
			})
			return
		}
		if isRequestError(err) {
			var reqErr *requestError
			_ = errors.As(err, &reqErr)
			if reqErr.status == http.StatusUnauthorized {
				s.clearAuthCookies(w)
			}
			if reqErr.status != http.StatusUnauthorized {
				app.ErrorJSON(w, reqErr.status, reqErr.message)
				return
			}
		} else {
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
			return
		}
	}

	refreshToken, err := s.extractRefreshToken(r)
	if err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	if refreshToken == "" {
		s.clearAuthCookies(w)
		app.ErrorJSON(w, http.StatusUnauthorized, "Missing browser session")
		return
	}

	result, err := s.Refresh(r.Context(), refreshToken, requestIP(r), r.UserAgent())
	if err != nil {
		if isRequestError(err) {
			var reqErr *requestError
			_ = errors.As(err, &reqErr)
			if reqErr.status == http.StatusUnauthorized {
				s.clearAuthCookies(w)
			}
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	csrfToken, err := s.ApplyBrowserAuthCookies(r.Context(), w, result.user.ID, result.refreshToken, result.refreshExpires)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	app.WriteJSON(w, http.StatusOK, map[string]any{
		"accessToken": result.accessToken,
		"csrfToken":   csrfToken,
		"user":        result.user,
	})
}

func (s Service) RestoreBrowserSession(ctx context.Context, sessionID, ipAddress, userAgent string) (issuedLogin, time.Duration, error) {
	if s.Redis == nil || sessionID == "" {
		return issuedLogin{}, 0, &requestError{status: http.StatusUnauthorized, message: "Missing browser session"}
	}

	raw, err := s.Redis.Get(ctx, browserSessionKeyPrefix+sessionID).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return issuedLogin{}, 0, &requestError{status: http.StatusUnauthorized, message: "Invalid or expired browser session"}
		}
		return issuedLogin{}, 0, fmt.Errorf("load browser session: %w", err)
	}

	var state browserSessionState
	if err := json.Unmarshal(raw, &state); err != nil {
		return issuedLogin{}, 0, fmt.Errorf("decode browser session: %w", err)
	}

	ttl := time.Until(state.ExpiresAt)
	if ttl <= 0 {
		_ = s.Redis.Del(ctx, browserSessionKeyPrefix+sessionID).Err()
		return issuedLogin{}, 0, &requestError{status: http.StatusUnauthorized, message: "Invalid or expired browser session"}
	}

	user, err := s.loadLoginUserByID(ctx, state.UserID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			_ = s.Redis.Del(ctx, browserSessionKeyPrefix+sessionID).Err()
			return issuedLogin{}, 0, &requestError{status: http.StatusUnauthorized, message: "Invalid or expired browser session"}
		}
		return issuedLogin{}, 0, err
	}
	if !user.Enabled {
		_ = s.Redis.Del(ctx, browserSessionKeyPrefix+sessionID).Err()
		return issuedLogin{}, 0, &requestError{status: http.StatusUnauthorized, message: "Invalid or expired browser session"}
	}

	accessToken, err := s.issueAccessToken(user, ipAddress, userAgent)
	if err != nil {
		return issuedLogin{}, 0, err
	}

	return issuedLogin{
		accessToken: accessToken,
		user:        buildLoginUserResponse(user),
	}, ttl, nil
}
