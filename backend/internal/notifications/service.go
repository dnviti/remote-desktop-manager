package notifications

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	DB *pgxpool.Pool
}

type notificationEntry struct {
	ID        string     `json:"id"`
	Type      string     `json:"type"`
	Message   string     `json:"message"`
	Read      bool       `json:"read"`
	RelatedID *string    `json:"relatedId"`
	CreatedAt time.Time  `json:"createdAt"`
}

type notificationsResponse struct {
	Data        []notificationEntry `json:"data"`
	Total       int                `json:"total"`
	UnreadCount int                `json:"unreadCount"`
}

type notificationPreference struct {
	Type  string `json:"type"`
	InApp bool   `json:"inApp"`
	Email bool   `json:"email"`
}

type bulkPreferencesPayload struct {
	Preferences []preferenceUpdatePayload `json:"preferences"`
}

type preferenceUpdatePayload struct {
	Type  string `json:"type"`
	InApp *bool  `json:"inApp"`
	Email *bool  `json:"email"`
}

var allTypes = []string{
	"CONNECTION_SHARED",
	"SHARE_PERMISSION_UPDATED",
	"SHARE_REVOKED",
	"SECRET_SHARED",
	"SECRET_SHARE_REVOKED",
	"SECRET_EXPIRING",
	"SECRET_EXPIRED",
	"TENANT_INVITATION",
	"RECORDING_READY",
	"IMPOSSIBLE_TRAVEL_DETECTED",
	"SECRET_CHECKOUT_REQUESTED",
	"SECRET_CHECKOUT_APPROVED",
	"SECRET_CHECKOUT_DENIED",
	"SECRET_CHECKOUT_EXPIRED",
	"LATERAL_MOVEMENT_ALERT",
	"SESSION_TERMINATED_POLICY_VIOLATION",
	"TENANT_VAULT_KEY_RECEIVED",
}

var validTypeSet = func() map[string]struct{} {
	m := make(map[string]struct{}, len(allTypes))
	for _, t := range allTypes {
		m[t] = struct{}{}
	}
	return m
}()

var emailDefaultTrue = map[string]struct{}{
	"IMPOSSIBLE_TRAVEL_DETECTED":        {},
	"LATERAL_MOVEMENT_ALERT":            {},
	"SECRET_EXPIRING":                   {},
	"SESSION_TERMINATED_POLICY_VIOLATION": {},
}

func (s Service) HandleList(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	limit := 50
	offset := 0
	if value := strings.TrimSpace(r.URL.Query().Get("limit")); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	if value := strings.TrimSpace(r.URL.Query().Get("offset")); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil && parsed >= 0 {
			offset = parsed
		}
	}

	result, err := s.ListNotifications(r.Context(), claims.UserID, limit, offset)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleMarkRead(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := s.MarkRead(r.Context(), claims.UserID, r.PathValue("id")); err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s Service) HandleMarkAllRead(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := s.MarkAllRead(r.Context(), claims.UserID); err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s Service) HandleDelete(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := s.DeleteNotification(r.Context(), claims.UserID, r.PathValue("id")); err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s Service) HandleGetPreferences(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	result, err := s.GetPreferences(r.Context(), claims.UserID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleUpdatePreference(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	var payload preferenceUpdatePayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := s.UpsertPreference(r.Context(), claims.UserID, r.PathValue("type"), payload.InApp, payload.Email)
	if err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleBulkUpdatePreferences(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	var payload bulkPreferencesPayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := s.BulkUpsertPreferences(r.Context(), claims.UserID, payload.Preferences)
	if err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) ListNotifications(ctx context.Context, userID string, limit, offset int) (notificationsResponse, error) {
	if limit < 1 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}

	rows, err := s.DB.Query(ctx, `
SELECT id, type::text, message, read, "relatedId", "createdAt"
FROM "Notification"
WHERE "userId" = $1
ORDER BY "createdAt" DESC
OFFSET $2 LIMIT $3
`, userID, offset, limit)
	if err != nil {
		return notificationsResponse{}, fmt.Errorf("list notifications: %w", err)
	}
	defer rows.Close()

	result := make([]notificationEntry, 0)
	for rows.Next() {
		var item notificationEntry
		var relatedID sql.NullString
		if err := rows.Scan(&item.ID, &item.Type, &item.Message, &item.Read, &relatedID, &item.CreatedAt); err != nil {
			return notificationsResponse{}, fmt.Errorf("scan notification: %w", err)
		}
		if relatedID.Valid {
			item.RelatedID = &relatedID.String
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return notificationsResponse{}, fmt.Errorf("iterate notifications: %w", err)
	}

	var total int
	if err := s.DB.QueryRow(ctx, `SELECT COUNT(*) FROM "Notification" WHERE "userId" = $1`, userID).Scan(&total); err != nil {
		return notificationsResponse{}, fmt.Errorf("count notifications: %w", err)
	}
	var unreadCount int
	if err := s.DB.QueryRow(ctx, `SELECT COUNT(*) FROM "Notification" WHERE "userId" = $1 AND read = false`, userID).Scan(&unreadCount); err != nil {
		return notificationsResponse{}, fmt.Errorf("count unread notifications: %w", err)
	}

	return notificationsResponse{Data: result, Total: total, UnreadCount: unreadCount}, nil
}

func (s Service) MarkRead(ctx context.Context, userID, notificationID string) error {
	_, err := s.DB.Exec(ctx, `UPDATE "Notification" SET read = true WHERE id = $1 AND "userId" = $2`, notificationID, userID)
	if err != nil {
		return fmt.Errorf("mark notification read: %w", err)
	}
	return nil
}

func (s Service) MarkAllRead(ctx context.Context, userID string) error {
	_, err := s.DB.Exec(ctx, `UPDATE "Notification" SET read = true WHERE "userId" = $1 AND read = false`, userID)
	if err != nil {
		return fmt.Errorf("mark all notifications read: %w", err)
	}
	return nil
}

func (s Service) DeleteNotification(ctx context.Context, userID, notificationID string) error {
	_, err := s.DB.Exec(ctx, `DELETE FROM "Notification" WHERE id = $1 AND "userId" = $2`, notificationID, userID)
	if err != nil {
		return fmt.Errorf("delete notification: %w", err)
	}
	return nil
}

func (s Service) GetPreferences(ctx context.Context, userID string) ([]notificationPreference, error) {
	rows, err := s.DB.Query(ctx, `
SELECT type::text, "inApp", email
FROM "NotificationPreference"
WHERE "userId" = $1
`, userID)
	if err != nil {
		return nil, fmt.Errorf("list notification preferences: %w", err)
	}
	defer rows.Close()

	stored := make(map[string]notificationPreference, len(allTypes))
	for rows.Next() {
		var pref notificationPreference
		if err := rows.Scan(&pref.Type, &pref.InApp, &pref.Email); err != nil {
			return nil, fmt.Errorf("scan notification preference: %w", err)
		}
		stored[pref.Type] = pref
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate notification preferences: %w", err)
	}

	result := make([]notificationPreference, 0, len(allTypes))
	for _, t := range allTypes {
		if pref, ok := stored[t]; ok {
			result = append(result, pref)
			continue
		}
		result = append(result, defaultPreference(t))
	}
	return result, nil
}

func (s Service) UpsertPreference(ctx context.Context, userID, prefType string, inApp, email *bool) (notificationPreference, error) {
	normalized := strings.ToUpper(strings.TrimSpace(prefType))
	if _, ok := validTypeSet[normalized]; !ok {
		return notificationPreference{}, fmt.Errorf("invalid notification type")
	}

	defaults := defaultPreference(normalized)
	inAppValue := defaults.InApp
	emailValue := defaults.Email
	if inApp != nil {
		inAppValue = *inApp
	}
	if email != nil {
		emailValue = *email
	}

	var result notificationPreference
	if err := s.DB.QueryRow(ctx, `
INSERT INTO "NotificationPreference" (id, "userId", type, "inApp", email, "createdAt", "updatedAt")
VALUES ($1, $2, $3::"NotificationType", $4, $5, NOW(), NOW())
ON CONFLICT ("userId", type)
DO UPDATE SET
  "inApp" = EXCLUDED."inApp",
  email = EXCLUDED.email,
  "updatedAt" = NOW()
RETURNING type::text, "inApp", email
`, uuid.NewString(), userID, normalized, inAppValue, emailValue).Scan(&result.Type, &result.InApp, &result.Email); err != nil {
		return notificationPreference{}, fmt.Errorf("upsert notification preference: %w", err)
	}
	return result, nil
}

func (s Service) BulkUpsertPreferences(ctx context.Context, userID string, prefs []preferenceUpdatePayload) ([]notificationPreference, error) {
	if len(prefs) == 0 {
		return []notificationPreference{}, nil
	}
	result := make([]notificationPreference, 0, len(prefs))
	for _, pref := range prefs {
		item, err := s.UpsertPreference(ctx, userID, pref.Type, pref.InApp, pref.Email)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, nil
}

func defaultPreference(prefType string) notificationPreference {
	_, emailEnabled := emailDefaultTrue[prefType]
	return notificationPreference{
		Type:  prefType,
		InApp: true,
		Email: emailEnabled,
	}
}
