package ldapapi

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/go-ldap/ldap/v3"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	DB *pgxpool.Pool
}

type statusResponse struct {
	Enabled       bool   `json:"enabled"`
	ProviderName  string `json:"providerName"`
	ServerURL     string `json:"serverUrl"`
	BaseDN        string `json:"baseDn"`
	SyncEnabled   bool   `json:"syncEnabled"`
	SyncCron      string `json:"syncCron"`
	AutoProvision bool   `json:"autoProvision"`
}

type LdapTestResult struct {
	Ok         bool   `json:"ok"`
	Message    string `json:"message"`
	UserCount  int    `json:"userCount,omitempty"`
	GroupCount int    `json:"groupCount,omitempty"`
}

type LdapSyncResult struct {
	Created  int      `json:"created"`
	Updated  int      `json:"updated"`
	Disabled int      `json:"disabled"`
	Errors   []string `json:"errors"`
}

type ldapConfig struct {
	Enabled               bool
	ProviderName          string
	ServerURL             string
	BaseDN                string
	BindDN                string
	BindPassword          string
	UserSearchFilter      string
	UserSearchBase        string
	DisplayNameAttr       string
	EmailAttr             string
	UIDAttr               string
	GroupBaseDN           string
	GroupSearchFilter     string
	GroupMemberAttr       string
	GroupNameAttr         string
	AllowedGroups         []string
	StartTLS              bool
	TLSRejectUnauthorized bool
	SyncEnabled           bool
	SyncCron              string
	AutoProvision         bool
	DefaultTenantID       string
}

type ldapUserEntry struct {
	DN             string
	UID            string
	Email          string
	DisplayName    string
	Groups         []string
	ProviderUserID string
}

func (s Service) HandleGetStatus(w http.ResponseWriter, _ *http.Request, claims authn.Claims) {
	if err := requireTenantAdmin(claims); err != nil {
		app.ErrorJSON(w, http.StatusForbidden, err.Error())
		return
	}

	cfg := loadConfig()
	app.WriteJSON(w, http.StatusOK, statusResponse{
		Enabled:       cfg.isEnabled(),
		ProviderName:  cfg.ProviderName,
		ServerURL:     redactLDAPURL(cfg.ServerURL),
		BaseDN:        cfg.BaseDN,
		SyncEnabled:   cfg.SyncEnabled,
		SyncCron:      cfg.SyncCron,
		AutoProvision: cfg.AutoProvision,
	})
}

func (s Service) HandleTestConnection(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireTenantAdmin(claims); err != nil {
		app.ErrorJSON(w, http.StatusForbidden, err.Error())
		return
	}

	result := s.testConnection(r.Context())
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleTriggerSync(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireTenantAdmin(claims); err != nil {
		app.ErrorJSON(w, http.StatusForbidden, err.Error())
		return
	}

	result := s.syncUsers(r.Context())
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) testConnection(ctx context.Context) LdapTestResult {
	cfg := loadConfig()
	if !cfg.isEnabled() {
		return LdapTestResult{Ok: false, Message: "LDAP is not enabled"}
	}

	type testPayload struct {
		Users      []ldapUserEntry
		GroupCount int
	}
	payload, err := withAdminBind(ctx, cfg, func(conn *ldap.Conn) (testPayload, error) {
		entries, err := searchUsers(ctx, conn, cfg, 100)
		if err != nil {
			return testPayload{}, err
		}
		groupCount := 0
		if strings.TrimSpace(cfg.GroupBaseDN) != "" {
			groupCount, err = countGroups(ctx, conn, cfg, 100)
			if err != nil {
				return testPayload{}, err
			}
		}
		return testPayload{Users: entries, GroupCount: groupCount}, nil
	})
	if err != nil {
		return LdapTestResult{Ok: false, Message: "Connection failed: " + err.Error()}
	}

	message := fmt.Sprintf("Connected successfully. Found %d user(s)", len(payload.Users))
	if strings.TrimSpace(cfg.GroupBaseDN) != "" {
		message += fmt.Sprintf(" and %d group(s)", payload.GroupCount)
	}
	return LdapTestResult{
		Ok:         true,
		Message:    message,
		UserCount:  len(payload.Users),
		GroupCount: payload.GroupCount,
	}
}

func (s Service) syncUsers(ctx context.Context) LdapSyncResult {
	result := LdapSyncResult{Errors: []string{}}
	cfg := loadConfig()
	if !cfg.isEnabled() {
		result.Errors = append(result.Errors, "LDAP is not enabled")
		return result
	}
	if s.DB == nil {
		result.Errors = append(result.Errors, "database is unavailable")
		return result
	}

	_ = s.insertAudit(ctx, "LDAP_SYNC_START", nil, nil, map[string]any{"provider": cfg.ProviderName})

	tenantExists := false
	if strings.TrimSpace(cfg.DefaultTenantID) != "" {
		var exists bool
		if err := s.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM "Tenant" WHERE id = $1)`, cfg.DefaultTenantID).Scan(&exists); err == nil {
			tenantExists = exists
		}
	}

	ldapUsers, err := withAdminBind(ctx, cfg, func(conn *ldap.Conn) ([]ldapUserEntry, error) {
		entries, err := searchUsers(ctx, conn, cfg, 5000)
		return entries, err
	})
	if err != nil {
		message := err.Error()
		result.Errors = append(result.Errors, message)
		_ = s.insertAudit(ctx, "LDAP_SYNC_ERROR", nil, nil, map[string]any{"error": message})
		return result
	}

	seenEmails := make(map[string]struct{}, len(ldapUsers))
	for _, ldapUser := range ldapUsers {
		email := strings.ToLower(strings.TrimSpace(ldapUser.Email))
		if email == "" {
			continue
		}
		seenEmails[email] = struct{}{}

		if err := s.syncSingleUser(ctx, cfg, tenantExists, ldapUser, &result); err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("%s: %s", email, err.Error()))
		}
	}

	if err := s.disableMissingUsers(ctx, seenEmails, &result); err != nil {
		result.Errors = append(result.Errors, err.Error())
	}

	_ = s.insertAudit(ctx, "LDAP_SYNC_COMPLETE", nil, nil, map[string]any{
		"created":  result.Created,
		"updated":  result.Updated,
		"disabled": result.Disabled,
		"errors":   len(result.Errors),
	})

	return result
}

func (s Service) syncSingleUser(ctx context.Context, cfg ldapConfig, tenantExists bool, ldapUser ldapUserEntry, result *LdapSyncResult) error {
	attributes, err := json.Marshal(map[string]any{
		"dn":     ldapUser.DN,
		"uid":    ldapUser.UID,
		"groups": ldapUser.Groups,
	})
	if err != nil {
		return err
	}

	var (
		userID       string
		existingUser bool
		currentName  *string
	)
	err = s.DB.QueryRow(ctx, `
SELECT id, username
FROM "User"
WHERE LOWER(email) = LOWER($1)
`, ldapUser.Email).Scan(&userID, &currentName)
	if err == nil {
		existingUser = true
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}

	if !existingUser {
		if !cfg.AutoProvision {
			return nil
		}

		displayName := strings.TrimSpace(ldapUser.DisplayName)
		if displayName == "" {
			displayName = strings.TrimSpace(ldapUser.UID)
		}

		tx, err := s.DB.Begin(ctx)
		if err != nil {
			return err
		}
		defer func() { _ = tx.Rollback(ctx) }()

		if err := tx.QueryRow(ctx, `
INSERT INTO "User" (id, email, username, "vaultSetupComplete", "emailVerified")
VALUES ($1, $2, $3, $4, $5)
RETURNING id
`, uuid.NewString(), ldapUser.Email, nullableString(displayName), false, true).Scan(&userID); err != nil {
			return err
		}

		if _, err := tx.Exec(ctx, `
INSERT INTO "OAuthAccount" (id, "userId", provider, "providerUserId", "providerEmail", "samlAttributes")
VALUES ($1, $2, 'LDAP', $3, $4, $5::jsonb)
`, uuid.NewString(), userID, ldapUser.ProviderUserID, ldapUser.Email, string(attributes)); err != nil {
			return err
		}

		if cfg.DefaultTenantID != "" && tenantExists {
			if _, err := tx.Exec(ctx, `
INSERT INTO "TenantMember" (id, "tenantId", "userId", role, status, "isActive")
VALUES ($1, $2, $3, 'MEMBER', 'ACCEPTED', false)
ON CONFLICT ("tenantId", "userId") DO NOTHING
`, uuid.NewString(), cfg.DefaultTenantID, userID); err != nil {
				return err
			}
		}

		if err := tx.Commit(ctx); err != nil {
			return err
		}

		createdUserID := userID
		_ = s.insertAudit(ctx, "LDAP_USER_CREATED", &createdUserID, nil, map[string]any{
			"email": ldapUser.Email,
			"uid":   ldapUser.UID,
			"dn":    ldapUser.DN,
		})
		result.Created++
		return nil
	}

	displayName := strings.TrimSpace(ldapUser.DisplayName)
	if displayName == "" {
		displayName = strings.TrimSpace(ldapUser.UID)
	}
	if displayName != "" && (currentName == nil || strings.TrimSpace(*currentName) != displayName) {
		if _, err := s.DB.Exec(ctx, `UPDATE "User" SET username = $2 WHERE id = $1`, userID, displayName); err != nil {
			return err
		}
		result.Updated++
	}

	var accountID string
	err = s.DB.QueryRow(ctx, `
SELECT id
FROM "OAuthAccount"
WHERE "userId" = $1
  AND provider = 'LDAP'
`, userID).Scan(&accountID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if strings.TrimSpace(accountID) == "" {
		if _, err := s.DB.Exec(ctx, `
INSERT INTO "OAuthAccount" (id, "userId", provider, "providerUserId", "providerEmail", "samlAttributes")
VALUES ($1, $2, 'LDAP', $3, $4, $5::jsonb)
`, uuid.NewString(), userID, ldapUser.ProviderUserID, ldapUser.Email, string(attributes)); err != nil {
			return err
		}
		return nil
	}

	_, err = s.DB.Exec(ctx, `
UPDATE "OAuthAccount"
SET "providerUserId" = $2,
    "providerEmail" = $3,
    "samlAttributes" = $4::jsonb
WHERE id = $1
`, accountID, ldapUser.ProviderUserID, ldapUser.Email, string(attributes))
	return err
}

func (s Service) disableMissingUsers(ctx context.Context, seenEmails map[string]struct{}, result *LdapSyncResult) error {
	rows, err := s.DB.Query(ctx, `
SELECT oa.id, u.id, u.email, u.enabled
FROM "OAuthAccount" oa
JOIN "User" u ON u.id = oa."userId"
WHERE oa.provider = 'LDAP'
`)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var (
			accountID string
			userID    string
			email     string
			enabled   bool
		)
		if err := rows.Scan(&accountID, &userID, &email, &enabled); err != nil {
			return err
		}
		if !enabled {
			continue
		}
		if _, ok := seenEmails[strings.ToLower(strings.TrimSpace(email))]; ok {
			continue
		}
		if _, err := s.DB.Exec(ctx, `UPDATE "User" SET enabled = false WHERE id = $1`, userID); err != nil {
			return err
		}
		disabledUserID := userID
		_ = s.insertAudit(ctx, "LDAP_USER_DISABLED", &disabledUserID, nil, map[string]any{
			"email":  email,
			"reason": "not_found_in_ldap",
		})
		result.Disabled++
		_ = accountID
	}
	return rows.Err()
}

func withAdminBind[T any](ctx context.Context, cfg ldapConfig, fn func(*ldap.Conn) (T, error)) (T, error) {
	var zero T
	conn, err := openConnection(cfg)
	if err != nil {
		return zero, err
	}
	defer conn.Close()

	if cfg.StartTLS && !strings.HasPrefix(strings.ToLower(cfg.ServerURL), "ldaps://") {
		if err := conn.StartTLS(&tls.Config{InsecureSkipVerify: !cfg.TLSRejectUnauthorized}); err != nil {
			return zero, err
		}
	}
	if err := conn.Bind(cfg.BindDN, cfg.BindPassword); err != nil {
		return zero, err
	}
	return fn(conn)
}

func openConnection(cfg ldapConfig) (*ldap.Conn, error) {
	conn, err := ldap.DialURL(cfg.ServerURL, ldap.DialWithTLSConfig(&tls.Config{
		InsecureSkipVerify: !cfg.TLSRejectUnauthorized,
	}))
	if err != nil {
		return nil, err
	}
	conn.SetTimeout(15 * time.Second)
	return conn, nil
}

func searchUsers(ctx context.Context, conn *ldap.Conn, cfg ldapConfig, sizeLimit int) ([]ldapUserEntry, error) {
	filter := strings.TrimSpace(cfg.UserSearchFilter)
	filter = strings.ReplaceAll(filter, "{{username}}", "*")
	filter = strings.ReplaceAll(filter, "{{email}}", "*")
	if filter == "" {
		filter = "(objectClass=person)"
	}

	searchBase := cfg.BaseDN
	if strings.TrimSpace(cfg.UserSearchBase) != "" {
		searchBase = cfg.UserSearchBase
	}

	req := ldap.NewSearchRequest(
		searchBase,
		ldap.ScopeWholeSubtree,
		ldap.NeverDerefAliases,
		sizeLimit,
		0,
		false,
		filter,
		[]string{cfg.UIDAttr, cfg.EmailAttr, cfg.DisplayNameAttr, "entryUUID", "ipauniqueid", "nsuniqueid"},
		nil,
	)
	res, err := conn.Search(req)
	if err != nil {
		return nil, err
	}

	items := make([]ldapUserEntry, 0, len(res.Entries))
	for _, entry := range res.Entries {
		user := parseUserEntry(entry, cfg)
		if strings.TrimSpace(user.Email) == "" {
			continue
		}
		if strings.TrimSpace(cfg.GroupBaseDN) != "" {
			groups, err := fetchUserGroups(ctx, conn, cfg, user.DN)
			if err == nil {
				user.Groups = groups
			}
		}
		if len(cfg.AllowedGroups) > 0 {
			if !allowedGroup(user.Groups, cfg.AllowedGroups) {
				continue
			}
		}
		items = append(items, user)
	}
	return items, nil
}

func countGroups(ctx context.Context, conn *ldap.Conn, cfg ldapConfig, sizeLimit int) (int, error) {
	req := ldap.NewSearchRequest(
		cfg.GroupBaseDN,
		ldap.ScopeWholeSubtree,
		ldap.NeverDerefAliases,
		sizeLimit,
		0,
		false,
		cfg.GroupSearchFilter,
		[]string{cfg.GroupNameAttr},
		nil,
	)
	res, err := conn.Search(req)
	if err != nil {
		return 0, err
	}
	return len(res.Entries), nil
}

func fetchUserGroups(ctx context.Context, conn *ldap.Conn, cfg ldapConfig, userDN string) ([]string, error) {
	baseFilter := strings.TrimSpace(cfg.GroupSearchFilter)
	baseFilter = strings.TrimPrefix(baseFilter, "(")
	baseFilter = strings.TrimSuffix(baseFilter, ")")
	filter := fmt.Sprintf("(&(%s)(%s=%s))", baseFilter, cfg.GroupMemberAttr, ldap.EscapeFilter(userDN))
	req := ldap.NewSearchRequest(
		cfg.GroupBaseDN,
		ldap.ScopeWholeSubtree,
		ldap.NeverDerefAliases,
		1000,
		0,
		false,
		filter,
		[]string{cfg.GroupNameAttr},
		nil,
	)
	res, err := conn.Search(req)
	if err != nil {
		return nil, err
	}
	groups := make([]string, 0, len(res.Entries))
	for _, entry := range res.Entries {
		name := strings.TrimSpace(entry.GetAttributeValue(cfg.GroupNameAttr))
		if name != "" {
			groups = append(groups, name)
		}
	}
	return groups, nil
}

func parseUserEntry(entry *ldap.Entry, cfg ldapConfig) ldapUserEntry {
	providerUserID := firstNonEmpty(
		entry.GetAttributeValue("entryUUID"),
		entry.GetAttributeValue("ipauniqueid"),
		entry.GetAttributeValue("nsuniqueid"),
		entry.GetAttributeValue(cfg.UIDAttr),
	)
	return ldapUserEntry{
		DN:             entry.DN,
		UID:            entry.GetAttributeValue(cfg.UIDAttr),
		Email:          entry.GetAttributeValue(cfg.EmailAttr),
		DisplayName:    entry.GetAttributeValue(cfg.DisplayNameAttr),
		ProviderUserID: providerUserID,
	}
}

func allowedGroup(userGroups, allowed []string) bool {
	for _, userGroup := range userGroups {
		for _, allow := range allowed {
			if strings.EqualFold(strings.TrimSpace(userGroup), strings.TrimSpace(allow)) {
				return true
			}
		}
	}
	return false
}

func loadConfig() ldapConfig {
	return ldapConfig{
		Enabled:               os.Getenv("LDAP_ENABLED") == "true",
		ProviderName:          getenv("LDAP_PROVIDER_NAME", "LDAP"),
		ServerURL:             strings.TrimSpace(os.Getenv("LDAP_SERVER_URL")),
		BaseDN:                strings.TrimSpace(os.Getenv("LDAP_BASE_DN")),
		BindDN:                strings.TrimSpace(os.Getenv("LDAP_BIND_DN")),
		BindPassword:          strings.TrimSpace(os.Getenv("LDAP_BIND_PASSWORD")),
		UserSearchFilter:      getenv("LDAP_USER_SEARCH_FILTER", "(uid={{username}})"),
		UserSearchBase:        strings.TrimSpace(os.Getenv("LDAP_USER_SEARCH_BASE")),
		DisplayNameAttr:       getenv("LDAP_DISPLAY_NAME_ATTR", "displayName"),
		EmailAttr:             getenv("LDAP_EMAIL_ATTR", "mail"),
		UIDAttr:               getenv("LDAP_UID_ATTR", "uid"),
		GroupBaseDN:           strings.TrimSpace(os.Getenv("LDAP_GROUP_BASE_DN")),
		GroupSearchFilter:     getenv("LDAP_GROUP_SEARCH_FILTER", "(objectClass=groupOfNames)"),
		GroupMemberAttr:       getenv("LDAP_GROUP_MEMBER_ATTR", "member"),
		GroupNameAttr:         getenv("LDAP_GROUP_NAME_ATTR", "cn"),
		AllowedGroups:         splitCSV(os.Getenv("LDAP_ALLOWED_GROUPS")),
		StartTLS:              os.Getenv("LDAP_STARTTLS") == "true",
		TLSRejectUnauthorized: os.Getenv("LDAP_TLS_REJECT_UNAUTHORIZED") != "false",
		SyncEnabled:           os.Getenv("LDAP_SYNC_ENABLED") == "true",
		SyncCron:              getenv("LDAP_SYNC_CRON", "0 */6 * * *"),
		AutoProvision:         os.Getenv("LDAP_AUTO_PROVISION") != "false",
		DefaultTenantID:       strings.TrimSpace(os.Getenv("LDAP_DEFAULT_TENANT_ID")),
	}
}

func (c ldapConfig) isEnabled() bool {
	return c.Enabled && c.ServerURL != "" && c.BaseDN != ""
}

func requireTenantAdmin(claims authn.Claims) error {
	if strings.TrimSpace(claims.TenantID) == "" {
		return errors.New("You must belong to an organization to perform this action")
	}
	if !hasTenantRole(claims.TenantRole, "ADMIN") {
		return errors.New("Insufficient tenant role")
	}
	return nil
}

func hasTenantRole(actual, minimum string) bool {
	hierarchy := map[string]int{
		"GUEST":      1,
		"AUDITOR":    2,
		"CONSULTANT": 3,
		"MEMBER":     4,
		"OPERATOR":   5,
		"ADMIN":      6,
		"OWNER":      7,
	}
	return hierarchy[strings.ToUpper(strings.TrimSpace(actual))] >= hierarchy[minimum]
}

func redactLDAPURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if idx := strings.Index(raw, "://"); idx >= 0 {
		rest := raw[idx+3:]
		if at := strings.LastIndex(rest, "@"); at >= 0 {
			return raw[:idx+3] + "***:***@" + rest[at+1:]
		}
	}
	return raw
}

func splitCSV(raw string) []string {
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func nullableString(raw string) any {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	return raw
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}

func getenv(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func (s Service) insertAudit(ctx context.Context, action string, userID *string, targetID *string, details map[string]any) error {
	if s.DB == nil {
		return nil
	}
	payload, err := json.Marshal(details)
	if err != nil {
		return err
	}
	_, err = s.DB.Exec(ctx, `
INSERT INTO "AuditLog" (id, "userId", action, "targetType", "targetId", details)
VALUES ($1, $2, $3, 'ldap', $4, $5::jsonb)
`, uuid.NewString(), userID, action, targetID, string(payload))
	return err
}
