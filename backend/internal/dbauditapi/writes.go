package dbauditapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/tenantauth"
	"github.com/google/uuid"
)

func (s Service) CreateFirewallRule(ctx context.Context, claims authn.Claims, name, pattern, action string, scope, description *string, enabled *bool, priority *int, ip *string) (firewallRule, error) {
	if s.DB == nil {
		return firewallRule{}, errors.New("database is unavailable")
	}
	name, err := validateName(name)
	if err != nil {
		return firewallRule{}, err
	}
	pattern, err = validateSafeRegex(pattern, "firewall rule")
	if err != nil {
		return firewallRule{}, err
	}
	action, err = normalizeFirewallAction(action)
	if err != nil {
		return firewallRule{}, err
	}
	ruleID := uuid.NewString()
	now := time.Now().UTC()
	if _, err := s.DB.Exec(ctx, `
INSERT INTO "DbFirewallRule" (id, "tenantId", name, pattern, action, scope, description, enabled, priority, "createdAt", "updatedAt")
VALUES ($1, $2, $3, $4, $5::"FirewallAction", $6, $7, $8, $9, $10, $11)
`, ruleID, claims.TenantID, name, pattern, action, normalizeOptionalString(scope), normalizeOptionalString(description), defaultBool(enabled, true), defaultInt(priority, 0), now, now); err != nil {
		return firewallRule{}, fmt.Errorf("create firewall rule: %w", err)
	}
	item, err := s.GetFirewallRule(ctx, claims.TenantID, ruleID)
	if err != nil {
		return firewallRule{}, fmt.Errorf("reload firewall rule: %w", err)
	}
	_ = s.insertAuditLog(ctx, claims.UserID, "DB_FIREWALL_RULE_CREATE", "DbFirewallRule", item.ID, map[string]any{
		"name": item.Name, "pattern": item.Pattern, "firewallAction": item.Action,
	}, ip)
	return item, nil
}

func (s Service) UpdateFirewallRule(ctx context.Context, claims authn.Claims, ruleID string, payload map[string]json.RawMessage, ip *string) (firewallRule, error) {
	if s.DB == nil {
		return firewallRule{}, errors.New("database is unavailable")
	}
	setClauses := []string{}
	args := []any{ruleID, claims.TenantID}
	add := func(clause string, value any) {
		args = append(args, value)
		setClauses = append(setClauses, fmt.Sprintf(clause, len(args)))
	}
	if raw, ok := payload["name"]; ok {
		value, err := decodeString(raw)
		if err != nil {
			return firewallRule{}, &requestError{status: http.StatusBadRequest, message: "name must be a string"}
		}
		value, err = validateName(value)
		if err != nil {
			return firewallRule{}, err
		}
		add(`name = $%d`, value)
	}
	if raw, ok := payload["pattern"]; ok {
		value, err := decodeString(raw)
		if err != nil {
			return firewallRule{}, &requestError{status: http.StatusBadRequest, message: "pattern must be a string"}
		}
		value, err = validateSafeRegex(value, "firewall rule")
		if err != nil {
			return firewallRule{}, err
		}
		add(`pattern = $%d`, value)
	}
	if raw, ok := payload["action"]; ok {
		value, err := decodeString(raw)
		if err != nil {
			return firewallRule{}, &requestError{status: http.StatusBadRequest, message: "action must be a string"}
		}
		value, err = normalizeFirewallAction(value)
		if err != nil {
			return firewallRule{}, err
		}
		add(`action = $%d::"FirewallAction"`, value)
	}
	if raw, ok := payload["scope"]; ok {
		value, err := decodeOptionalString(raw)
		if err != nil {
			return firewallRule{}, &requestError{status: http.StatusBadRequest, message: "scope must be a string or null"}
		}
		add(`scope = $%d`, value)
	}
	if raw, ok := payload["description"]; ok {
		value, err := decodeOptionalString(raw)
		if err != nil {
			return firewallRule{}, &requestError{status: http.StatusBadRequest, message: "description must be a string or null"}
		}
		add(`description = $%d`, value)
	}
	if raw, ok := payload["enabled"]; ok {
		value, err := decodeBool(raw)
		if err != nil {
			return firewallRule{}, &requestError{status: http.StatusBadRequest, message: "enabled must be a boolean"}
		}
		add(`enabled = $%d`, value)
	}
	if raw, ok := payload["priority"]; ok {
		value, err := decodeInt(raw)
		if err != nil {
			return firewallRule{}, &requestError{status: http.StatusBadRequest, message: "priority must be an integer"}
		}
		add(`priority = $%d`, value)
	}
	if len(setClauses) == 0 {
		return s.GetFirewallRule(ctx, claims.TenantID, ruleID)
	}
	setClauses = append(setClauses, `"updatedAt" = NOW()`)
	query := fmt.Sprintf(`
UPDATE "DbFirewallRule"
SET %s
WHERE id = $1 AND "tenantId" = $2
`, strings.Join(setClauses, ", "))
	cmd, err := s.DB.Exec(ctx, query, args...)
	if err != nil {
		return firewallRule{}, fmt.Errorf("update firewall rule: %w", err)
	}
	if cmd.RowsAffected() == 0 {
		return firewallRule{}, &requestError{status: http.StatusNotFound, message: "Firewall rule not found"}
	}
	item, err := s.GetFirewallRule(ctx, claims.TenantID, ruleID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return firewallRule{}, &requestError{status: http.StatusNotFound, message: "Firewall rule not found"}
		}
		return firewallRule{}, fmt.Errorf("reload firewall rule: %w", err)
	}
	_ = s.insertAuditLog(ctx, claims.UserID, "DB_FIREWALL_RULE_UPDATE", "DbFirewallRule", item.ID, map[string]any{"name": item.Name}, ip)
	return item, nil
}

func (s Service) DeleteFirewallRule(ctx context.Context, claims authn.Claims, ruleID string, ip *string) error {
	if s.DB == nil {
		return errors.New("database is unavailable")
	}
	cmd, err := s.DB.Exec(ctx, `DELETE FROM "DbFirewallRule" WHERE id = $1 AND "tenantId" = $2`, ruleID, claims.TenantID)
	if err != nil {
		return fmt.Errorf("delete firewall rule: %w", err)
	}
	if cmd.RowsAffected() == 0 {
		return &requestError{status: http.StatusNotFound, message: "Firewall rule not found"}
	}
	_ = s.insertAuditLog(ctx, claims.UserID, "DB_FIREWALL_RULE_DELETE", "DbFirewallRule", ruleID, nil, ip)
	return nil
}

func (s Service) CreateMaskingPolicy(ctx context.Context, claims authn.Claims, name, columnPattern, strategy string, exemptRoles []string, scope, description *string, enabled *bool, ip *string) (maskingPolicy, error) {
	if s.DB == nil {
		return maskingPolicy{}, errors.New("database is unavailable")
	}
	name, err := validateName(name)
	if err != nil {
		return maskingPolicy{}, err
	}
	columnPattern, err = validateSafeRegex(columnPattern, "masking policy")
	if err != nil {
		return maskingPolicy{}, err
	}
	strategy, err = normalizeMaskingStrategy(strategy)
	if err != nil {
		return maskingPolicy{}, err
	}
	policyID := uuid.NewString()
	now := time.Now().UTC()
	if _, err := s.DB.Exec(ctx, `
INSERT INTO "DbMaskingPolicy" (id, "tenantId", name, "columnPattern", strategy, "exemptRoles", scope, description, enabled, "createdAt", "updatedAt")
VALUES ($1, $2, $3, $4, $5::"MaskingStrategy", $6, $7, $8, $9, $10, $11)
`, policyID, claims.TenantID, name, columnPattern, strategy, defaultStringSlice(exemptRoles), normalizeOptionalString(scope), normalizeOptionalString(description), defaultBool(enabled, true), now, now); err != nil {
		return maskingPolicy{}, fmt.Errorf("create masking policy: %w", err)
	}
	item, err := s.GetMaskingPolicy(ctx, claims.TenantID, policyID)
	if err != nil {
		return maskingPolicy{}, fmt.Errorf("reload masking policy: %w", err)
	}
	_ = s.insertAuditLog(ctx, claims.UserID, "DB_MASKING_POLICY_CREATE", "DbMaskingPolicy", item.ID, map[string]any{"name": item.Name, "strategy": item.Strategy}, ip)
	return item, nil
}

func (s Service) UpdateMaskingPolicy(ctx context.Context, claims authn.Claims, policyID string, payload map[string]json.RawMessage, ip *string) (maskingPolicy, error) {
	if s.DB == nil {
		return maskingPolicy{}, errors.New("database is unavailable")
	}
	setClauses := []string{}
	args := []any{policyID, claims.TenantID}
	add := func(clause string, value any) {
		args = append(args, value)
		setClauses = append(setClauses, fmt.Sprintf(clause, len(args)))
	}
	if raw, ok := payload["name"]; ok {
		value, err := decodeString(raw)
		if err != nil {
			return maskingPolicy{}, &requestError{status: http.StatusBadRequest, message: "name must be a string"}
		}
		value, err = validateName(value)
		if err != nil {
			return maskingPolicy{}, err
		}
		add(`name = $%d`, value)
	}
	if raw, ok := payload["columnPattern"]; ok {
		value, err := decodeString(raw)
		if err != nil {
			return maskingPolicy{}, &requestError{status: http.StatusBadRequest, message: "columnPattern must be a string"}
		}
		value, err = validateSafeRegex(value, "masking policy")
		if err != nil {
			return maskingPolicy{}, err
		}
		add(`"columnPattern" = $%d`, value)
	}
	if raw, ok := payload["strategy"]; ok {
		value, err := decodeString(raw)
		if err != nil {
			return maskingPolicy{}, &requestError{status: http.StatusBadRequest, message: "strategy must be a string"}
		}
		value, err = normalizeMaskingStrategy(value)
		if err != nil {
			return maskingPolicy{}, err
		}
		add(`strategy = $%d::"MaskingStrategy"`, value)
	}
	if raw, ok := payload["exemptRoles"]; ok {
		values, err := decodeStringSlice(raw)
		if err != nil {
			return maskingPolicy{}, &requestError{status: http.StatusBadRequest, message: "exemptRoles must be an array of strings"}
		}
		add(`"exemptRoles" = $%d`, values)
	}
	if raw, ok := payload["scope"]; ok {
		value, err := decodeOptionalString(raw)
		if err != nil {
			return maskingPolicy{}, &requestError{status: http.StatusBadRequest, message: "scope must be a string or null"}
		}
		add(`scope = $%d`, value)
	}
	if raw, ok := payload["description"]; ok {
		value, err := decodeOptionalString(raw)
		if err != nil {
			return maskingPolicy{}, &requestError{status: http.StatusBadRequest, message: "description must be a string or null"}
		}
		add(`description = $%d`, value)
	}
	if raw, ok := payload["enabled"]; ok {
		value, err := decodeBool(raw)
		if err != nil {
			return maskingPolicy{}, &requestError{status: http.StatusBadRequest, message: "enabled must be a boolean"}
		}
		add(`enabled = $%d`, value)
	}
	if len(setClauses) == 0 {
		return s.GetMaskingPolicy(ctx, claims.TenantID, policyID)
	}
	setClauses = append(setClauses, `"updatedAt" = NOW()`)
	query := fmt.Sprintf(`
UPDATE "DbMaskingPolicy"
SET %s
WHERE id = $1 AND "tenantId" = $2
`, strings.Join(setClauses, ", "))
	cmd, err := s.DB.Exec(ctx, query, args...)
	if err != nil {
		return maskingPolicy{}, fmt.Errorf("update masking policy: %w", err)
	}
	if cmd.RowsAffected() == 0 {
		return maskingPolicy{}, &requestError{status: http.StatusNotFound, message: "Masking policy not found"}
	}
	item, err := s.GetMaskingPolicy(ctx, claims.TenantID, policyID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return maskingPolicy{}, &requestError{status: http.StatusNotFound, message: "Masking policy not found"}
		}
		return maskingPolicy{}, fmt.Errorf("reload masking policy: %w", err)
	}
	_ = s.insertAuditLog(ctx, claims.UserID, "DB_MASKING_POLICY_UPDATE", "DbMaskingPolicy", item.ID, map[string]any{"name": item.Name}, ip)
	return item, nil
}

func (s Service) DeleteMaskingPolicy(ctx context.Context, claims authn.Claims, policyID string, ip *string) error {
	if s.DB == nil {
		return errors.New("database is unavailable")
	}
	cmd, err := s.DB.Exec(ctx, `DELETE FROM "DbMaskingPolicy" WHERE id = $1 AND "tenantId" = $2`, policyID, claims.TenantID)
	if err != nil {
		return fmt.Errorf("delete masking policy: %w", err)
	}
	if cmd.RowsAffected() == 0 {
		return &requestError{status: http.StatusNotFound, message: "Masking policy not found"}
	}
	_ = s.insertAuditLog(ctx, claims.UserID, "DB_MASKING_POLICY_DELETE", "DbMaskingPolicy", policyID, nil, ip)
	return nil
}

func (s Service) CreateRateLimitPolicy(ctx context.Context, claims authn.Claims, name string, queryType *string, windowMS, maxQueries, burstMax *int, exemptRoles []string, scope, action *string, enabled *bool, priority *int, ip *string) (rateLimitPolicy, error) {
	if s.DB == nil {
		return rateLimitPolicy{}, errors.New("database is unavailable")
	}
	name, err := validateName(name)
	if err != nil {
		return rateLimitPolicy{}, err
	}
	normalizedQueryType, err := normalizeOptionalDbQueryType(queryType)
	if err != nil {
		return rateLimitPolicy{}, err
	}
	normalizedAction, err := normalizeOptionalRateLimitAction(action)
	if err != nil {
		return rateLimitPolicy{}, err
	}
	if err := validateRateLimitValues(windowMS, maxQueries, burstMax); err != nil {
		return rateLimitPolicy{}, err
	}
	var duplicateID string
	err = s.DB.QueryRow(ctx, `
SELECT id FROM "DbRateLimitPolicy"
WHERE "tenantId" = $1
  AND "queryType" IS NOT DISTINCT FROM $2::"DbQueryType"
  AND scope IS NOT DISTINCT FROM $3
`, claims.TenantID, normalizedQueryType, normalizeOptionalString(scope)).Scan(&duplicateID)
	if err == nil {
		return rateLimitPolicy{}, &requestError{status: http.StatusConflict, message: "A rate limit policy already exists for this tenant/queryType/scope combination"}
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return rateLimitPolicy{}, fmt.Errorf("check duplicate rate limit policy: %w", err)
	}
	policyID := uuid.NewString()
	now := time.Now().UTC()
	if _, err := s.DB.Exec(ctx, `
INSERT INTO "DbRateLimitPolicy" (id, "tenantId", name, "queryType", "windowMs", "maxQueries", "burstMax", "exemptRoles", scope, action, enabled, priority, "createdAt", "updatedAt")
VALUES ($1, $2, $3, $4::"DbQueryType", $5, $6, $7, $8, $9, $10::"RateLimitAction", $11, $12, $13, $14)
`, policyID, claims.TenantID, name, normalizedQueryType, defaultInt(windowMS, 60000), defaultInt(maxQueries, 100), defaultInt(burstMax, 10), defaultStringSlice(exemptRoles), normalizeOptionalString(scope), defaultString(normalizedAction, "REJECT"), defaultBool(enabled, true), defaultInt(priority, 0), now, now); err != nil {
		return rateLimitPolicy{}, fmt.Errorf("create rate limit policy: %w", err)
	}
	item, err := s.GetRateLimitPolicy(ctx, claims.TenantID, policyID)
	if err != nil {
		return rateLimitPolicy{}, fmt.Errorf("reload rate limit policy: %w", err)
	}
	_ = s.insertAuditLog(ctx, claims.UserID, "DB_RATE_LIMIT_POLICY_CREATE", "DbRateLimitPolicy", item.ID, map[string]any{"name": item.Name, "queryType": defaultString(item.QueryType, "ALL"), "rateLimitAction": item.Action}, ip)
	return item, nil
}

func (s Service) UpdateRateLimitPolicy(ctx context.Context, claims authn.Claims, policyID string, payload map[string]json.RawMessage, ip *string) (rateLimitPolicy, error) {
	if s.DB == nil {
		return rateLimitPolicy{}, errors.New("database is unavailable")
	}
	setClauses := []string{}
	args := []any{policyID, claims.TenantID}
	add := func(clause string, value any) {
		args = append(args, value)
		setClauses = append(setClauses, fmt.Sprintf(clause, len(args)))
	}
	if raw, ok := payload["name"]; ok {
		value, err := decodeString(raw)
		if err != nil {
			return rateLimitPolicy{}, &requestError{status: http.StatusBadRequest, message: "name must be a string"}
		}
		value, err = validateName(value)
		if err != nil {
			return rateLimitPolicy{}, err
		}
		add(`name = $%d`, value)
	}
	if raw, ok := payload["queryType"]; ok {
		value, present, err := decodeOptionalEnumString(raw, normalizeDbQueryType)
		if err != nil {
			return rateLimitPolicy{}, err
		}
		if present {
			add(`"queryType" = $%d::"DbQueryType"`, value)
		} else {
			add(`"queryType" = $%d::"DbQueryType"`, nil)
		}
	}
	if raw, ok := payload["windowMs"]; ok {
		value, err := decodeInt(raw)
		if err != nil {
			return rateLimitPolicy{}, &requestError{status: http.StatusBadRequest, message: "windowMs must be an integer"}
		}
		if err := validateRateLimitValues(&value, nil, nil); err != nil {
			return rateLimitPolicy{}, err
		}
		add(`"windowMs" = $%d`, value)
	}
	if raw, ok := payload["maxQueries"]; ok {
		value, err := decodeInt(raw)
		if err != nil {
			return rateLimitPolicy{}, &requestError{status: http.StatusBadRequest, message: "maxQueries must be an integer"}
		}
		if err := validateRateLimitValues(nil, &value, nil); err != nil {
			return rateLimitPolicy{}, err
		}
		add(`"maxQueries" = $%d`, value)
	}
	if raw, ok := payload["burstMax"]; ok {
		value, err := decodeInt(raw)
		if err != nil {
			return rateLimitPolicy{}, &requestError{status: http.StatusBadRequest, message: "burstMax must be an integer"}
		}
		if err := validateRateLimitValues(nil, nil, &value); err != nil {
			return rateLimitPolicy{}, err
		}
		add(`"burstMax" = $%d`, value)
	}
	if raw, ok := payload["exemptRoles"]; ok {
		values, err := decodeStringSlice(raw)
		if err != nil {
			return rateLimitPolicy{}, &requestError{status: http.StatusBadRequest, message: "exemptRoles must be an array of strings"}
		}
		add(`"exemptRoles" = $%d`, values)
	}
	if raw, ok := payload["scope"]; ok {
		value, err := decodeOptionalString(raw)
		if err != nil {
			return rateLimitPolicy{}, &requestError{status: http.StatusBadRequest, message: "scope must be a string or null"}
		}
		add(`scope = $%d`, value)
	}
	if raw, ok := payload["action"]; ok {
		value, err := decodeString(raw)
		if err != nil {
			return rateLimitPolicy{}, &requestError{status: http.StatusBadRequest, message: "action must be a string"}
		}
		value, err = normalizeRateLimitAction(value)
		if err != nil {
			return rateLimitPolicy{}, err
		}
		add(`action = $%d::"RateLimitAction"`, value)
	}
	if raw, ok := payload["enabled"]; ok {
		value, err := decodeBool(raw)
		if err != nil {
			return rateLimitPolicy{}, &requestError{status: http.StatusBadRequest, message: "enabled must be a boolean"}
		}
		add(`enabled = $%d`, value)
	}
	if raw, ok := payload["priority"]; ok {
		value, err := decodeInt(raw)
		if err != nil {
			return rateLimitPolicy{}, &requestError{status: http.StatusBadRequest, message: "priority must be an integer"}
		}
		add(`priority = $%d`, value)
	}
	if len(setClauses) == 0 {
		return s.GetRateLimitPolicy(ctx, claims.TenantID, policyID)
	}
	setClauses = append(setClauses, `"updatedAt" = NOW()`)
	query := fmt.Sprintf(`
UPDATE "DbRateLimitPolicy"
SET %s
WHERE id = $1 AND "tenantId" = $2
`, strings.Join(setClauses, ", "))
	cmd, err := s.DB.Exec(ctx, query, args...)
	if err != nil {
		return rateLimitPolicy{}, fmt.Errorf("update rate limit policy: %w", err)
	}
	if cmd.RowsAffected() == 0 {
		return rateLimitPolicy{}, &requestError{status: http.StatusNotFound, message: "Rate limit policy not found"}
	}
	item, err := s.GetRateLimitPolicy(ctx, claims.TenantID, policyID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return rateLimitPolicy{}, &requestError{status: http.StatusNotFound, message: "Rate limit policy not found"}
		}
		return rateLimitPolicy{}, fmt.Errorf("reload rate limit policy: %w", err)
	}
	_ = s.insertAuditLog(ctx, claims.UserID, "DB_RATE_LIMIT_POLICY_UPDATE", "DbRateLimitPolicy", item.ID, map[string]any{"name": item.Name}, ip)
	return item, nil
}

func (s Service) DeleteRateLimitPolicy(ctx context.Context, claims authn.Claims, policyID string, ip *string) error {
	if s.DB == nil {
		return errors.New("database is unavailable")
	}
	cmd, err := s.DB.Exec(ctx, `DELETE FROM "DbRateLimitPolicy" WHERE id = $1 AND "tenantId" = $2`, policyID, claims.TenantID)
	if err != nil {
		return fmt.Errorf("delete rate limit policy: %w", err)
	}
	if cmd.RowsAffected() == 0 {
		return &requestError{status: http.StatusNotFound, message: "Rate limit policy not found"}
	}
	_ = s.insertAuditLog(ctx, claims.UserID, "DB_RATE_LIMIT_POLICY_DELETE", "DbRateLimitPolicy", policyID, nil, ip)
	return nil
}

func (s Service) authorized(w http.ResponseWriter, r *http.Request, claims authn.Claims) bool {
	if claims.TenantID == "" {
		app.ErrorJSON(w, http.StatusForbidden, "Tenant context is required")
		return false
	}
	membership, err := s.TenantAuth.ResolveMembership(r.Context(), claims.UserID, claims.TenantID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return false
	}
	if membership == nil {
		app.ErrorJSON(w, http.StatusForbidden, "Forbidden")
		return false
	}
	switch membership.Role {
	case "ADMIN", "OWNER", "AUDITOR":
	default:
		app.ErrorJSON(w, http.StatusForbidden, "Forbidden")
		return false
	}
	if !membership.Permissions[tenantauth.CanViewAuditLog] {
		app.ErrorJSON(w, http.StatusForbidden, "Forbidden")
		return false
	}
	return true
}

func (s Service) authorizedWrite(w http.ResponseWriter, r *http.Request, claims authn.Claims) bool {
	if claims.TenantID == "" {
		app.ErrorJSON(w, http.StatusForbidden, "Tenant context is required")
		return false
	}
	membership, err := s.TenantAuth.ResolveMembership(r.Context(), claims.UserID, claims.TenantID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return false
	}
	if membership == nil {
		app.ErrorJSON(w, http.StatusForbidden, "Forbidden")
		return false
	}
	switch membership.Role {
	case "ADMIN", "OWNER":
		return true
	default:
		app.ErrorJSON(w, http.StatusForbidden, "Forbidden")
		return false
	}
}
