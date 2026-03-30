package sshsessions

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

func (s Service) issueTerminalGrant(ctx context.Context, grant map[string]any) (terminalGrantIssueResponse, error) {
	body, err := json.Marshal(map[string]any{"grant": grant})
	if err != nil {
		return terminalGrantIssueResponse{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(s.terminalBrokerURL(), "/")+"/v1/session-grants:issue", bytes.NewReader(body))
	if err != nil {
		return terminalGrantIssueResponse{}, err
	}
	req.Header.Set("content-type", "application/json")

	resp, err := s.client().Do(req)
	if err != nil {
		return terminalGrantIssueResponse{}, fmt.Errorf("issue terminal grant: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		var payload map[string]any
		if json.NewDecoder(resp.Body).Decode(&payload) == nil {
			if message, _ := payload["error"].(string); strings.TrimSpace(message) != "" {
				return terminalGrantIssueResponse{}, &requestError{status: http.StatusBadGateway, message: message}
			}
		}
		return terminalGrantIssueResponse{}, &requestError{status: http.StatusBadGateway, message: "Failed to issue SSH session"}
	}

	var issued terminalGrantIssueResponse
	if err := json.NewDecoder(resp.Body).Decode(&issued); err != nil {
		return terminalGrantIssueResponse{}, fmt.Errorf("decode terminal grant response: %w", err)
	}
	return issued, nil
}

func (s Service) terminalBrokerURL() string {
	if strings.TrimSpace(s.TerminalBrokerURL) != "" {
		return s.TerminalBrokerURL
	}
	return defaultTerminalBrokerURL()
}

func (s Service) tunnelBrokerURL() string {
	if strings.TrimSpace(s.TunnelBrokerURL) != "" {
		return s.TunnelBrokerURL
	}
	return defaultTunnelBrokerURL()
}
