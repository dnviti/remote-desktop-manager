package desktopsessions

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/desktopbroker"
	"github.com/dnviti/arsenale/backend/internal/sessions"
)

type GrantIssueRequest struct {
	UserID          string                    `json:"userId"`
	ConnectionID    string                    `json:"connectionId"`
	GatewayID       string                    `json:"gatewayId,omitempty"`
	InstanceID      string                    `json:"instanceId,omitempty"`
	Protocol        string                    `json:"protocol"`
	IPAddress       string                    `json:"ipAddress,omitempty"`
	SessionMetadata map[string]any            `json:"sessionMetadata,omitempty"`
	RoutingDecision *sessions.RoutingDecision `json:"routingDecision,omitempty"`
	RecordingID     string                    `json:"recordingId,omitempty"`
	Token           DesktopTokenRequest       `json:"token"`
}

type DesktopTokenRequest struct {
	GuacdHost string         `json:"guacdHost,omitempty"`
	GuacdPort int            `json:"guacdPort,omitempty"`
	Settings  map[string]any `json:"settings"`
	Metadata  map[string]any `json:"metadata,omitempty"`
}

type GrantIssueResponse struct {
	Token       string `json:"token"`
	SessionID   string `json:"sessionId"`
	RecordingID string `json:"recordingId,omitempty"`
}

type OwnedSessionRequest struct {
	UserID string `json:"userId"`
	Reason string `json:"reason,omitempty"`
}

type Service struct {
	Secret string
	Store  *sessions.Store
}

func (s Service) HandleIssue(w http.ResponseWriter, r *http.Request) {
	var req GrantIssueRequest
	if err := app.ReadJSON(r, &req); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := validateGrantIssueRequest(req); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	protocol := strings.ToUpper(strings.TrimSpace(req.Protocol))
	_, err := s.Store.CloseStaleSessionsForConnection(r.Context(), req.UserID, req.ConnectionID, protocol)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	tokenValue, err := desktopbroker.EncryptToken(s.Secret, buildConnectionToken(protocol, req.Token))
	if err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	sessionID, err := s.Store.StartSession(r.Context(), sessions.StartSessionParams{
		UserID:          req.UserID,
		ConnectionID:    req.ConnectionID,
		GatewayID:       req.GatewayID,
		InstanceID:      req.InstanceID,
		Protocol:        protocol,
		GuacTokenHash:   desktopbroker.HashToken(tokenValue),
		IPAddress:       req.IPAddress,
		Metadata:        normalizeMetadata(req.SessionMetadata),
		RoutingDecision: req.RoutingDecision,
		RecordingID:     req.RecordingID,
	})
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	app.WriteJSON(w, http.StatusOK, GrantIssueResponse{
		Token:       tokenValue,
		SessionID:   sessionID,
		RecordingID: req.RecordingID,
	})
}

func (s Service) HandleHeartbeat(w http.ResponseWriter, r *http.Request) {
	var req OwnedSessionRequest
	if err := app.ReadJSON(r, &req); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(req.UserID) == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "userId is required")
		return
	}

	if err := s.Store.HeartbeatOwnedSession(r.Context(), r.PathValue("sessionId"), req.UserID); err != nil {
		s.writeLifecycleError(w, err, true)
		return
	}

	app.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s Service) HandleEnd(w http.ResponseWriter, r *http.Request) {
	var req OwnedSessionRequest
	if err := app.ReadJSON(r, &req); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(req.UserID) == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "userId is required")
		return
	}

	if err := s.Store.EndOwnedSession(r.Context(), r.PathValue("sessionId"), req.UserID, strings.TrimSpace(req.Reason)); err != nil {
		s.writeLifecycleError(w, err, false)
		return
	}

	app.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s Service) writeLifecycleError(w http.ResponseWriter, err error, heartbeat bool) {
	switch {
	case errors.Is(err, sessions.ErrSessionNotFound):
		app.ErrorJSON(w, http.StatusNotFound, "session not found")
	case heartbeat && errors.Is(err, sessions.ErrSessionClosed):
		app.ErrorJSON(w, http.StatusGone, "session already closed")
	default:
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
	}
}

func validateGrantIssueRequest(req GrantIssueRequest) error {
	if strings.TrimSpace(req.UserID) == "" {
		return errors.New("userId is required")
	}
	if strings.TrimSpace(req.ConnectionID) == "" {
		return errors.New("connectionId is required")
	}
	protocol := strings.ToUpper(strings.TrimSpace(req.Protocol))
	if protocol != "RDP" && protocol != "VNC" {
		return fmt.Errorf("unsupported protocol %q", req.Protocol)
	}
	if len(req.Token.Settings) == 0 {
		return errors.New("token.settings is required")
	}
	return nil
}

func buildConnectionToken(protocol string, req DesktopTokenRequest) desktopbroker.ConnectionToken {
	token := desktopbroker.ConnectionToken{}
	token.Connection.Type = strings.ToLower(strings.TrimSpace(protocol))
	token.Connection.GuacdHost = strings.TrimSpace(req.GuacdHost)
	token.Connection.GuacdPort = req.GuacdPort
	token.Connection.Settings = normalizeMetadata(req.Settings)
	if len(req.Metadata) > 0 {
		token.Metadata = normalizeMetadata(req.Metadata)
	}
	return token
}

func normalizeMetadata(input map[string]any) map[string]any {
	if len(input) == 0 {
		return map[string]any{}
	}

	out := make(map[string]any, len(input))
	for key, value := range input {
		out[key] = normalizeValue(value)
	}
	return out
}

func normalizeValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		return normalizeMetadata(typed)
	case []any:
		items := make([]any, 0, len(typed))
		for _, item := range typed {
			items = append(items, normalizeValue(item))
		}
		return items
	case nil:
		return nil
	default:
		return typed
	}
}
