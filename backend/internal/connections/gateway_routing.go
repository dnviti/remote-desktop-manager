package connections

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/jackc/pgx/v5"
)

func gatewayRoutingMandatoryEnabled() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("GATEWAY_ROUTING_MODE")), "gateway-mandatory")
}

func connectionTypeRequiresGateway(connType string) bool {
	switch strings.ToUpper(strings.TrimSpace(connType)) {
	case "SSH", "RDP", "VNC", "DATABASE", "DB_TUNNEL":
		return true
	default:
		return false
	}
}

func compatibleGatewayTypes(connType string) []string {
	switch strings.ToUpper(strings.TrimSpace(connType)) {
	case "SSH":
		return []string{"MANAGED_SSH", "SSH_BASTION"}
	case "DB_TUNNEL":
		return []string{"MANAGED_SSH", "SSH_BASTION"}
	case "RDP", "VNC":
		return []string{"GUACD"}
	case "DATABASE":
		return []string{"DB_PROXY"}
	default:
		return nil
	}
}

func friendlyGatewayRequirement(connType string) string {
	switch strings.ToUpper(strings.TrimSpace(connType)) {
	case "SSH":
		return "SSH_BASTION or MANAGED_SSH"
	case "DB_TUNNEL":
		return "SSH_BASTION or MANAGED_SSH"
	case "RDP", "VNC":
		return "GUACD"
	case "DATABASE":
		return "DB_PROXY"
	default:
		return "a compatible gateway"
	}
}

func gatewayTypePriority(gatewayType string) int {
	switch strings.ToUpper(strings.TrimSpace(gatewayType)) {
	case "MANAGED_SSH":
		return 0
	case "SSH_BASTION":
		return 1
	case "GUACD", "DB_PROXY":
		return 0
	default:
		return 99
	}
}

func optionalStringPointersEqual(left, right *string) bool {
	leftValue := normalizeOptionalStringPtrValue(left)
	rightValue := normalizeOptionalStringPtrValue(right)
	switch {
	case leftValue == nil && rightValue == nil:
		return true
	case leftValue == nil || rightValue == nil:
		return false
	default:
		return *leftValue == *rightValue
	}
}

func (s Service) resolveDefaultGatewayID(ctx context.Context, tenantID, connType string) (*string, error) {
	gatewayTypes := compatibleGatewayTypes(connType)
	if len(gatewayTypes) == 0 {
		return nil, nil
	}

	rows, err := s.DB.Query(ctx, `
SELECT id, type::text, "isDefault"
FROM "Gateway"
WHERE "tenantId" = $1
  AND type::text = ANY($2)
ORDER BY "isDefault" DESC, "updatedAt" DESC
`, tenantID, gatewayTypes)
	if err != nil {
		return nil, fmt.Errorf("list compatible gateways: %w", err)
	}
	defer rows.Close()

	type gatewayCandidate struct {
		ID        string
		Type      string
		IsDefault bool
	}

	candidates := make([]gatewayCandidate, 0, 4)
	for rows.Next() {
		var item gatewayCandidate
		if err := rows.Scan(&item.ID, &item.Type, &item.IsDefault); err != nil {
			return nil, fmt.Errorf("scan compatible gateway: %w", err)
		}
		candidates = append(candidates, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate compatible gateways: %w", err)
	}
	if len(candidates) == 0 {
		return nil, &requestError{
			status:  400,
			message: fmt.Sprintf("This connection type requires a %s gateway, but none is configured for this tenant.", friendlyGatewayRequirement(connType)),
		}
	}

	// Prefer the tenant's explicit default first. When no compatible default exists,
	// fall back to a deterministic type preference so connection creation stays stable.
	selected := candidates[0]
	for _, candidate := range candidates[1:] {
		if candidate.IsDefault != selected.IsDefault {
			continue
		}
		if gatewayTypePriority(candidate.Type) < gatewayTypePriority(selected.Type) {
			selected = candidate
		}
	}
	if selected.IsDefault || len(candidates) == 1 {
		return &selected.ID, nil
	}

	return nil, &requestError{
		status:  400,
		message: fmt.Sprintf("Multiple compatible gateways exist for %s connections. Set gatewayId explicitly or mark one compatible gateway as default.", strings.ToUpper(strings.TrimSpace(connType))),
	}
}

func (s Service) validateGatewayForConnectionType(ctx context.Context, tenantID, gatewayID, connType string) error {
	gatewayID = strings.TrimSpace(gatewayID)
	if gatewayID == "" {
		if gatewayRoutingMandatoryEnabled() && connectionTypeRequiresGateway(connType) {
			return &requestError{
				status:  400,
				message: fmt.Sprintf("This connection type requires a %s gateway.", friendlyGatewayRequirement(connType)),
			}
		}
		return nil
	}

	var gatewayType string
	if err := s.DB.QueryRow(ctx, `
SELECT type::text
FROM "Gateway"
WHERE id = $1
  AND "tenantId" = $2
`, gatewayID, tenantID).Scan(&gatewayType); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &requestError{status: 400, message: "gatewayId is invalid for this tenant"}
		}
		return fmt.Errorf("load gateway for validation: %w", err)
	}

	for _, candidate := range compatibleGatewayTypes(connType) {
		if strings.EqualFold(candidate, gatewayType) {
			return nil
		}
	}

	return &requestError{
		status:  400,
		message: fmt.Sprintf("Connection gateway must be of type %s for %s connections.", friendlyGatewayRequirement(connType), strings.ToUpper(strings.TrimSpace(connType))),
	}
}
