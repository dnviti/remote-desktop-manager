package sshsessions

import (
	"context"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/sessionadmin"
	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

func (s Service) IssueSSHObserverGrant(ctx context.Context, sessionID, observerUserID string, request *http.Request) (sessionadmin.SSHObserveGrantResponse, error) {
	sessionID = strings.TrimSpace(sessionID)
	observerUserID = strings.TrimSpace(observerUserID)
	_ = request
	if sessionID == "" {
		return sessionadmin.SSHObserveGrantResponse{}, &requestError{status: http.StatusBadRequest, message: "sessionId is required"}
	}

	issued, err := s.issueTerminalGrant(ctx, map[string]any{
		"mode":      contracts.TerminalSessionModeObserve,
		"sessionId": sessionID,
		"userId":    observerUserID,
	})
	if err != nil {
		return sessionadmin.SSHObserveGrantResponse{}, err
	}

	return sessionadmin.SSHObserveGrantResponse{
		SessionID:     sessionID,
		Token:         issued.Token,
		ExpiresAt:     issued.ExpiresAt,
		WebSocketPath: "/ws/terminal",
		Mode:          contracts.TerminalSessionModeObserve,
		ReadOnly:      true,
	}, nil
}
