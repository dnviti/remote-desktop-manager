package gateways

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/tunnelegress"
	"github.com/dnviti/arsenale/backend/pkg/egresspolicy"
	"github.com/jackc/pgx/v5"
)

type egressPolicyTestPayload struct {
	Protocol string       `json:"protocol"`
	Host     string       `json:"host"`
	Port     int          `json:"port"`
	UserID   string       `json:"userId"`
	Policy   optionalJSON `json:"policy"`
}

type egressPolicyTestResponse struct {
	Allowed     bool   `json:"allowed"`
	Reason      string `json:"reason"`
	RuleIndex   int    `json:"ruleIndex,omitempty"`
	RuleAction  string `json:"ruleAction,omitempty"`
	Rule        string `json:"rule,omitempty"`
	DefaultDeny bool   `json:"defaultDeny"`
}

func prepareGatewayEgressPolicy(raw json.RawMessage) (json.RawMessage, error) {
	normalized, _, err := egresspolicy.NormalizeRaw(raw)
	if err != nil {
		return nil, &requestError{status: http.StatusBadRequest, message: err.Error()}
	}
	return normalized, nil
}

func normalizeGatewayEgressPolicyForResponse(raw json.RawMessage) json.RawMessage {
	normalized, _, err := egresspolicy.NormalizeRaw(raw)
	if err != nil {
		return egresspolicy.EmptyJSON()
	}
	return normalized
}

func chooseGatewayEgressPolicy(current json.RawMessage, update optionalJSON) (json.RawMessage, error) {
	if !update.Present {
		return prepareGatewayEgressPolicy(current)
	}
	return prepareGatewayEgressPolicy(update.Value)
}

func (s Service) GetGatewayEgressPolicy(ctx context.Context, tenantID, gatewayID string) (json.RawMessage, error) {
	record, err := s.loadGateway(ctx, tenantID, gatewayID)
	if err != nil {
		return nil, err
	}
	return normalizeGatewayEgressPolicyForResponse(record.EgressPolicy), nil
}

func (s Service) UpdateGatewayEgressPolicy(ctx context.Context, claims authn.Claims, gatewayID string, raw json.RawMessage, ipAddress string) (gatewayResponse, error) {
	record, err := s.loadGateway(ctx, claims.TenantID, gatewayID)
	if err != nil {
		return gatewayResponse{}, err
	}
	policy, err := prepareGatewayEgressPolicy(raw)
	if err != nil {
		return gatewayResponse{}, err
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return gatewayResponse{}, fmt.Errorf("begin gateway egress policy update transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `
UPDATE "Gateway"
   SET "egressPolicy" = $2::jsonb,
       "updatedAt" = NOW()
 WHERE id = $1
`, record.ID, string(policy)); err != nil {
		return gatewayResponse{}, fmt.Errorf("update gateway egress policy: %w", err)
	}

	if err := s.insertAuditLogTx(ctx, tx, claims.UserID, "GATEWAY_UPDATE", record.ID, map[string]any{
		"fields": []string{"egressPolicy"},
	}, ipAddress); err != nil {
		return gatewayResponse{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return gatewayResponse{}, fmt.Errorf("commit gateway egress policy update transaction: %w", err)
	}

	updated, err := s.loadGateway(ctx, claims.TenantID, record.ID)
	if err != nil {
		return gatewayResponse{}, err
	}
	return gatewayRecordToResponse(updated), nil
}

func (s Service) TestGatewayEgressPolicy(ctx context.Context, claims authn.Claims, gatewayID string, payload egressPolicyTestPayload) (egressPolicyTestResponse, error) {
	record, err := s.loadGateway(ctx, claims.TenantID, gatewayID)
	if err != nil {
		return egressPolicyTestResponse{}, err
	}
	userID := strings.TrimSpace(payload.UserID)
	if userID == "" {
		return egressPolicyTestResponse{}, &requestError{status: http.StatusBadRequest, message: "userId is required"}
	}
	if err := s.requireTenantUser(ctx, claims.TenantID, userID); err != nil {
		return egressPolicyTestResponse{}, err
	}
	rawPolicy := record.EgressPolicy
	if payload.Policy.Present {
		rawPolicy, err = prepareGatewayEgressPolicy(payload.Policy.Value)
		if err != nil {
			return egressPolicyTestResponse{}, err
		}
	}
	teamIDs, err := tunnelegress.LoadActiveTeamIDs(ctx, s.DB, claims.TenantID, userID)
	if err != nil {
		return egressPolicyTestResponse{}, err
	}
	decision := egresspolicy.AuthorizeRaw(ctx, rawPolicy, egresspolicy.Request{
		Protocol: payload.Protocol,
		Host:     payload.Host,
		Port:     payload.Port,
		UserID:   userID,
		TeamIDs:  teamIDs,
	}, egresspolicy.DefaultOptions())
	return egressPolicyTestResponse{
		Allowed:     decision.Allowed,
		Reason:      decision.Reason,
		RuleIndex:   decision.RuleIndex,
		RuleAction:  decision.RuleAction,
		Rule:        decision.Rule,
		DefaultDeny: decision.DefaultDeny,
	}, nil
}

func (s Service) requireTenantUser(ctx context.Context, tenantID, userID string) error {
	var exists bool
	err := s.DB.QueryRow(ctx, `
SELECT EXISTS (
	SELECT 1
	FROM "TenantMember"
	WHERE "tenantId" = $1
	  AND "userId" = $2
	  AND status = 'ACCEPTED'
	  AND "isActive" = true
	  AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
)
`, strings.TrimSpace(tenantID), strings.TrimSpace(userID)).Scan(&exists)
	if err != nil {
		if err == pgx.ErrNoRows {
			return &requestError{status: http.StatusNotFound, message: "User not found"}
		}
		return fmt.Errorf("load egress test user: %w", err)
	}
	if !exists {
		return &requestError{status: http.StatusNotFound, message: "User not found"}
	}
	return nil
}
