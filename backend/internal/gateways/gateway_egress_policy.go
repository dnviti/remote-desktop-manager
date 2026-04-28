package gateways

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/pkg/egresspolicy"
)

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
