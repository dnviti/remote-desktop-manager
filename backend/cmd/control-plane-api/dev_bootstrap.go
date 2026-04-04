package main

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/runtimefeatures"
	"github.com/dnviti/arsenale/backend/pkg/contracts"
	"github.com/google/uuid"
)

const (
	devBootstrapIP        = "127.0.0.1"
	devBootstrapUserAgent = "arsenale-control-plane-api/dev-bootstrap"
)

type devBootstrapOptions struct {
	adminEmail        string
	adminPassword     string
	adminUsername     string
	tenantName        string
	certDir           string
	orchestratorName  string
	orchestratorKind  contracts.OrchestratorConnectionKind
	orchestratorScope contracts.OrchestratorScope
	orchestratorURL   string
}

type devGatewaySpec struct {
	ID          string
	Name        string
	Type        string
	Host        string
	Port        int
	APIPort     *int
	Token       string
	CertDir     string
	Description string
}

type devDemoDatabaseSpec struct {
	Name        string
	Host        string
	Port        int
	Username    string
	Password    string
	Description string
	DBSettings  map[string]any
}

type encryptedValue struct {
	Ciphertext string
	IV         string
	Tag        string
}

type devBootstrapRuntime struct {
	features              runtimefeatures.Manifest
	tunnelFixturesEnabled bool
	demoDatabasesEnabled  bool
}

func runDevBootstrap(ctx context.Context, deps *apiDependencies) error {
	if deps == nil || deps.db == nil {
		return fmt.Errorf("bootstrap dependencies are unavailable")
	}

	options := loadDevBootstrapOptions()
	runtime := loadDevBootstrapRuntime()
	if err := ensureBootstrapSetup(ctx, deps, options); err != nil {
		return err
	}

	userID, err := lookupBootstrapUserID(ctx, deps, options.adminEmail)
	if err != nil {
		return err
	}
	if runtime.features.KeychainEnabled {
		if err := ensureBootstrapVaultUnlocked(ctx, deps, userID, options.adminPassword); err != nil {
			return err
		}
	}
	tenantID, err := ensureBootstrapTenant(ctx, deps, userID, options.tenantName)
	if err != nil {
		return err
	}
	if err := ensureBootstrapMembership(ctx, deps, tenantID, userID); err != nil {
		return err
	}
	if runtime.features.ConnectionsEnabled {
		if err := ensureBootstrapSSHKeyPair(ctx, deps, tenantID, userID); err != nil {
			return err
		}
	}

	specs := buildDevGatewaySpecs(options.certDir, runtime)
	if runtime.tunnelFixturesEnabled && len(specs) > 0 {
		if err := syncTenantTunnelCA(ctx, deps, tenantID, options.certDir); err != nil {
			return err
		}
		for _, spec := range specs {
			if err := upsertDevGateway(ctx, deps, tenantID, userID, spec); err != nil {
				return err
			}
		}
		if err := ensureBootstrapOrchestratorConnection(ctx, deps, options); err != nil {
			return err
		}
	}

	if runtime.demoDatabasesEnabled && runtime.features.DatabaseProxyEnabled {
		if err := ensureDemoDatabaseConnections(ctx, deps, tenantID, userID); err != nil {
			return err
		}
	}

	if runtime.tunnelFixturesEnabled && hasManagedSSHGateway(specs) {
		const maxManagedSSHKeyPushAttempts = 15
		const managedSSHKeyPushRetryDelay = 2 * time.Second
		keyPushSucceeded := false
		for attempt := 1; attempt <= maxManagedSSHKeyPushAttempts; attempt++ {
			pushResults, err := deps.gatewayService.PushSSHKeyToAllManagedGateways(ctx, tenantID)
			if err != nil {
				fmt.Fprintf(os.Stderr, "Managed SSH key push attempt %d/%d failed: %v\n", attempt, maxManagedSSHKeyPushAttempts, err)
			} else {
				allOK := len(pushResults) > 0
				for _, item := range pushResults {
					if item.OK {
						fmt.Printf("managed ssh key push ok: %s (%s)\n", item.Name, item.GatewayID)
						continue
					}
					allOK = false
					fmt.Fprintf(
						os.Stderr,
						"managed ssh key push pending: %s (%s): %s (attempt %d/%d)\n",
						item.Name,
						item.GatewayID,
						item.Error,
						attempt,
						maxManagedSSHKeyPushAttempts,
					)
				}
				if allOK {
					keyPushSucceeded = true
					break
				}
			}
			if attempt < maxManagedSSHKeyPushAttempts {
				time.Sleep(managedSSHKeyPushRetryDelay)
			}
		}
		if !keyPushSucceeded {
			return fmt.Errorf("managed SSH key push did not complete cleanly after %d attempts", maxManagedSSHKeyPushAttempts)
		}
	}

	fmt.Printf("development bootstrap complete for tenant %s\n", tenantID)
	for _, spec := range specs {
		fmt.Printf("  %s gateway: %s (%s)\n", spec.Type, spec.Name, spec.ID)
	}
	return nil
}

func loadDevBootstrapRuntime() devBootstrapRuntime {
	return devBootstrapRuntime{
		features:              runtimefeatures.FromEnv(),
		tunnelFixturesEnabled: requiredEnvBool("DEV_BOOTSTRAP_TUNNEL_FIXTURES_ENABLED", false),
		demoDatabasesEnabled:  requiredEnvBool("DEV_BOOTSTRAP_DEMO_DATABASES_ENABLED", false),
	}
}

func requiredEnvBool(name string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	switch strings.ToLower(value) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

func hasManagedSSHGateway(specs []devGatewaySpec) bool {
	for _, spec := range specs {
		if spec.Type == "MANAGED_SSH" {
			return true
		}
	}
	return false
}

func loadDevBootstrapOptions() devBootstrapOptions {
	certDir := strings.TrimSpace(os.Getenv("DEV_TUNNEL_CERT_DIR"))
	if certDir == "" {
		certDir = "/certs"
	}
	return devBootstrapOptions{
		adminEmail:       requiredEnv("DEV_BOOTSTRAP_ADMIN_EMAIL", "admin@example.com"),
		adminPassword:    requiredEnv("DEV_BOOTSTRAP_ADMIN_PASSWORD", "DevAdmin123!"),
		adminUsername:    requiredEnv("DEV_BOOTSTRAP_ADMIN_USERNAME", "admin"),
		tenantName:       requiredEnv("DEV_BOOTSTRAP_TENANT_NAME", "Development Environment"),
		certDir:          certDir,
		orchestratorName: requiredEnv("DEV_BOOTSTRAP_ORCHESTRATOR_NAME", "dev-podman"),
		orchestratorKind: parseBootstrapOrchestratorKind(
			requiredEnv("DEV_BOOTSTRAP_ORCHESTRATOR_KIND", string(contracts.OrchestratorPodman)),
		),
		orchestratorScope: parseBootstrapOrchestratorScope(
			requiredEnv("DEV_BOOTSTRAP_ORCHESTRATOR_SCOPE", string(contracts.OrchestratorScopeGlobal)),
		),
		orchestratorURL: requiredEnv("DEV_BOOTSTRAP_ORCHESTRATOR_ENDPOINT", "unix:///run/podman/podman.sock"),
	}
}

func requiredEnv(name, fallback string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	return value
}

func requiredEnvInt(name string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func buildDevGatewaySpecs(certDir string, runtime devBootstrapRuntime) []devGatewaySpec {
	if !runtime.features.ZeroTrustEnabled || !runtime.tunnelFixturesEnabled {
		return nil
	}

	specs := make([]devGatewaySpec, 0, 3)
	if runtime.features.ConnectionsEnabled {
		specs = append(specs,
			devGatewaySpec{
				ID:          requiredEnv("DEV_TUNNEL_MANAGED_SSH_GATEWAY_ID", "11111111-1111-4111-8111-111111111111"),
				Name:        "Dev Tunnel Managed SSH",
				Type:        "MANAGED_SSH",
				Host:        "dev-tunnel-ssh-gateway",
				Port:        2222,
				APIPort:     intPtr(9022),
				Token:       requiredEnv("DEV_TUNNEL_MANAGED_SSH_TOKEN", "dev-tunnel-managed-ssh-token"),
				CertDir:     filepath.Join(certDir, "tunnel-managed-ssh"),
				Description: "Development managed SSH gateway registered through the zero-trust tunnel",
			},
			devGatewaySpec{
				ID:          requiredEnv("DEV_TUNNEL_GUACD_GATEWAY_ID", "22222222-2222-4222-8222-222222222222"),
				Name:        "Dev Tunnel GUACD",
				Type:        "GUACD",
				Host:        "dev-tunnel-guacd",
				Port:        4822,
				Token:       requiredEnv("DEV_TUNNEL_GUACD_TOKEN", "dev-tunnel-guacd-token"),
				CertDir:     filepath.Join(certDir, "tunnel-guacd"),
				Description: "Development guacd gateway registered through the zero-trust tunnel",
			},
		)
	}
	if runtime.features.DatabaseProxyEnabled {
		specs = append(specs, devGatewaySpec{
			ID:          requiredEnv("DEV_TUNNEL_DB_PROXY_GATEWAY_ID", "33333333-3333-4333-8333-333333333333"),
			Name:        "Dev Tunnel DB Proxy",
			Type:        "DB_PROXY",
			Host:        "dev-tunnel-db-proxy",
			Port:        5432,
			Token:       requiredEnv("DEV_TUNNEL_DB_PROXY_TOKEN", "dev-tunnel-db-proxy-token"),
			CertDir:     filepath.Join(certDir, "tunnel-db-proxy"),
			Description: "Development database proxy gateway registered through the zero-trust tunnel",
		})
	}
	return specs
}

func buildDevDemoDatabaseSpecs() []devDemoDatabaseSpec {
	return []devDemoDatabaseSpec{
		{
			Name:        requiredEnv("DEV_SAMPLE_POSTGRES_CONNECTION_NAME", "Dev Demo PostgreSQL"),
			Host:        requiredEnv("DEV_SAMPLE_POSTGRES_HOST", "dev-demo-postgres"),
			Port:        requiredEnvInt("DEV_SAMPLE_POSTGRES_PORT", 5432),
			Username:    requiredEnv("DEV_SAMPLE_POSTGRES_USER", "demo_pg_user"),
			Password:    requiredEnv("DEV_SAMPLE_POSTGRES_PASSWORD", "DemoPgPass123!"),
			Description: "Seeded development PostgreSQL fixture used for database session smoke tests.",
			DBSettings: map[string]any{
				"protocol":     "postgresql",
				"databaseName": requiredEnv("DEV_SAMPLE_POSTGRES_DATABASE", "arsenale_demo"),
				"sslMode":      requiredEnv("DEV_SAMPLE_POSTGRES_SSL_MODE", "disable"),
			},
		},
		{
			Name:        requiredEnv("DEV_SAMPLE_MYSQL_CONNECTION_NAME", "Dev Demo MySQL"),
			Host:        requiredEnv("DEV_SAMPLE_MYSQL_HOST", "dev-demo-mysql"),
			Port:        requiredEnvInt("DEV_SAMPLE_MYSQL_PORT", 3306),
			Username:    requiredEnv("DEV_SAMPLE_MYSQL_USER", "demo_mysql_user"),
			Password:    requiredEnv("DEV_SAMPLE_MYSQL_PASSWORD", "DemoMySqlPass123!"),
			Description: "Seeded development MySQL fixture used for direct smoke tests.",
			DBSettings: map[string]any{
				"protocol":     "mysql",
				"databaseName": requiredEnv("DEV_SAMPLE_MYSQL_DATABASE", "arsenale_demo"),
			},
		},
		{
			Name:        requiredEnv("DEV_SAMPLE_MONGODB_CONNECTION_NAME", "Dev Demo MongoDB"),
			Host:        requiredEnv("DEV_SAMPLE_MONGODB_HOST", "dev-demo-mongodb"),
			Port:        requiredEnvInt("DEV_SAMPLE_MONGODB_PORT", 27017),
			Username:    requiredEnv("DEV_SAMPLE_MONGODB_USER", "demo_mongo_user"),
			Password:    requiredEnv("DEV_SAMPLE_MONGODB_PASSWORD", "DemoMongoPass123!"),
			Description: "Seeded development MongoDB fixture used for direct smoke tests.",
			DBSettings: map[string]any{
				"protocol":     "mongodb",
				"databaseName": requiredEnv("DEV_SAMPLE_MONGODB_DATABASE", "arsenale_demo"),
			},
		},
		{
			Name:        requiredEnv("DEV_SAMPLE_ORACLE_CONNECTION_NAME", "Dev Demo Oracle"),
			Host:        requiredEnv("DEV_SAMPLE_ORACLE_HOST", "dev-demo-oracle"),
			Port:        requiredEnvInt("DEV_SAMPLE_ORACLE_PORT", 1521),
			Username:    requiredEnv("DEV_SAMPLE_ORACLE_USER", "demo_oracle_user"),
			Password:    requiredEnv("DEV_SAMPLE_ORACLE_PASSWORD", "DemoOraclePass123!"),
			Description: "Seeded development Oracle fixture used for direct smoke tests.",
			DBSettings: map[string]any{
				"protocol":             "oracle",
				"databaseName":         requiredEnv("DEV_SAMPLE_ORACLE_SERVICE_NAME", "FREEPDB1"),
				"oracleConnectionType": "basic",
				"oracleServiceName":    requiredEnv("DEV_SAMPLE_ORACLE_SERVICE_NAME", "FREEPDB1"),
			},
		},
		{
			Name:        requiredEnv("DEV_SAMPLE_MSSQL_CONNECTION_NAME", "Dev Demo SQL Server"),
			Host:        requiredEnv("DEV_SAMPLE_MSSQL_HOST", "dev-demo-mssql"),
			Port:        requiredEnvInt("DEV_SAMPLE_MSSQL_PORT", 1433),
			Username:    requiredEnv("DEV_SAMPLE_MSSQL_USER", "demo_mssql_user"),
			Password:    requiredEnv("DEV_SAMPLE_MSSQL_PASSWORD", "DemoMssqlPass123!"),
			Description: "Seeded development SQL Server fixture used for direct smoke tests.",
			DBSettings: map[string]any{
				"protocol":      "mssql",
				"databaseName":  requiredEnv("DEV_SAMPLE_MSSQL_DATABASE", "ArsenaleDemo"),
				"mssqlAuthMode": "sql",
			},
		},
	}
}

func parseBootstrapOrchestratorKind(value string) contracts.OrchestratorConnectionKind {
	switch contracts.OrchestratorConnectionKind(strings.ToLower(strings.TrimSpace(value))) {
	case contracts.OrchestratorDocker:
		return contracts.OrchestratorDocker
	case contracts.OrchestratorKubernetes:
		return contracts.OrchestratorKubernetes
	default:
		return contracts.OrchestratorPodman
	}
}

func parseBootstrapOrchestratorScope(value string) contracts.OrchestratorScope {
	switch contracts.OrchestratorScope(strings.ToLower(strings.TrimSpace(value))) {
	case contracts.OrchestratorScopeTenant:
		return contracts.OrchestratorScopeTenant
	default:
		return contracts.OrchestratorScopeGlobal
	}
}

func ensureBootstrapSetup(ctx context.Context, deps *apiDependencies, options devBootstrapOptions) error {
	payload := map[string]any{
		"admin": map[string]any{
			"email":    options.adminEmail,
			"username": options.adminUsername,
			"password": options.adminPassword,
		},
		"tenant": map[string]any{
			"name": options.tenantName,
		},
		"settings": map[string]any{
			"selfSignupEnabled": false,
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode setup payload: %w", err)
	}

	req := httptest.NewRequest(http.MethodPost, "https://localhost/api/setup/complete", bytes.NewReader(body))
	req.RemoteAddr = devBootstrapIP + ":0"
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", devBootstrapUserAgent)

	if _, err := deps.setupService.CompleteSetup(ctx, req); err != nil && !strings.Contains(err.Error(), "Setup has already been completed") {
		return fmt.Errorf("complete setup: %w", err)
	}
	return nil
}

func lookupBootstrapUserID(ctx context.Context, deps *apiDependencies, email string) (string, error) {
	var userID string
	err := deps.db.QueryRow(ctx, `SELECT id FROM "User" WHERE email = $1`, strings.TrimSpace(strings.ToLower(email))).Scan(&userID)
	if err == nil {
		return userID, nil
	}
	err = deps.db.QueryRow(ctx, `SELECT id FROM "User" ORDER BY "createdAt" ASC LIMIT 1`).Scan(&userID)
	if err != nil {
		return "", fmt.Errorf("resolve bootstrap user: %w", err)
	}
	return userID, nil
}

func ensureBootstrapVaultUnlocked(ctx context.Context, deps *apiDependencies, userID, password string) error {
	if deps == nil {
		return fmt.Errorf("bootstrap dependencies are unavailable")
	}

	status, err := deps.vaultService.GetStatus(ctx, userID)
	if err != nil {
		return fmt.Errorf("load bootstrap vault status: %w", err)
	}
	if status.Unlocked {
		return nil
	}

	if _, err := deps.vaultService.Unlock(ctx, userID, password, devBootstrapIP); err != nil {
		return fmt.Errorf("unlock bootstrap vault: %w", err)
	}
	return nil
}

func ensureBootstrapTenant(ctx context.Context, deps *apiDependencies, userID, tenantName string) (string, error) {
	var tenantID string
	err := deps.db.QueryRow(ctx, `SELECT id FROM "Tenant" WHERE name = $1`, strings.TrimSpace(tenantName)).Scan(&tenantID)
	if err == nil {
		return tenantID, nil
	}

	created, err := deps.tenantService.CreateTenant(ctx, userID, tenantName, devBootstrapIP)
	if err != nil {
		return "", fmt.Errorf("ensure bootstrap tenant: %w", err)
	}
	return created.ID, nil
}

func ensureBootstrapMembership(ctx context.Context, deps *apiDependencies, tenantID, userID string) error {
	if _, err := deps.db.Exec(ctx, `
UPDATE "TenantMember"
SET "isActive" = false
WHERE "userId" = $1
  AND "isActive" = true
  AND "tenantId" <> $2
`, userID, tenantID); err != nil {
		return fmt.Errorf("deactivate extra memberships: %w", err)
	}

	if _, err := deps.db.Exec(ctx, `
INSERT INTO "TenantMember" (id, "tenantId", "userId", role, status, "isActive", "updatedAt")
VALUES ($1, $2, $3, 'OWNER', 'ACCEPTED', true, NOW())
ON CONFLICT ("tenantId", "userId") DO UPDATE
SET role = 'OWNER',
    status = 'ACCEPTED',
    "isActive" = true,
    "updatedAt" = NOW()
`, uuid.NewString(), tenantID, userID); err != nil {
		return fmt.Errorf("ensure bootstrap membership: %w", err)
	}
	return nil
}

func ensureBootstrapSSHKeyPair(ctx context.Context, deps *apiDependencies, tenantID, userID string) error {
	var exists bool
	if err := deps.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM "SshKeyPair" WHERE "tenantId" = $1)`, tenantID).Scan(&exists); err != nil {
		return fmt.Errorf("check tenant ssh key pair: %w", err)
	}
	if exists {
		return nil
	}
	if _, err := deps.gatewayService.GenerateSSHKeyPair(ctx, userID, tenantID, devBootstrapIP); err != nil {
		return fmt.Errorf("generate tenant ssh key pair: %w", err)
	}
	return nil
}

func syncTenantTunnelCA(ctx context.Context, deps *apiDependencies, tenantID, certDir string) error {
	caCertPEM, err := os.ReadFile(filepath.Join(certDir, "ca.pem"))
	if err != nil {
		return fmt.Errorf("read tenant tunnel CA certificate: %w", err)
	}
	caKeyPEM, err := os.ReadFile(filepath.Join(certDir, "ca-key.pem"))
	if err != nil {
		return fmt.Errorf("read tenant tunnel CA key: %w", err)
	}

	encryptedKey, err := encryptBootstrapValue(deps.gatewayService.ServerEncryptionKey, string(bytes.TrimSpace(caKeyPEM)))
	if err != nil {
		return fmt.Errorf("encrypt tenant tunnel CA key: %w", err)
	}
	fingerprint, err := certificateFingerprint(string(caCertPEM))
	if err != nil {
		return fmt.Errorf("fingerprint tenant tunnel CA certificate: %w", err)
	}

	if _, err := deps.db.Exec(ctx, `
UPDATE "Tenant"
SET "tunnelCaCert" = $2,
    "tunnelCaKey" = $3,
    "tunnelCaKeyIV" = $4,
    "tunnelCaKeyTag" = $5,
    "tunnelCaCertFingerprint" = $6
WHERE id = $1
`, tenantID, string(caCertPEM), encryptedKey.Ciphertext, encryptedKey.IV, encryptedKey.Tag, fingerprint); err != nil {
		return fmt.Errorf("store tenant tunnel CA: %w", err)
	}
	return nil
}

func ensureBootstrapOrchestratorConnection(ctx context.Context, deps *apiDependencies, options devBootstrapOptions) error {
	if deps == nil || deps.store == nil {
		return fmt.Errorf("orchestrator store is unavailable")
	}

	_, err := deps.store.UpsertConnection(ctx, contracts.OrchestratorConnection{
		Name:      options.orchestratorName,
		Kind:      options.orchestratorKind,
		Scope:     options.orchestratorScope,
		Endpoint:  options.orchestratorURL,
		Namespace: "",
		Labels: map[string]string{
			"environment": "development",
			"managedBy":   "dev-bootstrap",
		},
		Capabilities: []string{
			"workload.deploy",
			"workload.restart",
			"workload.logs.read",
			"workload.delete",
		},
	})
	if err != nil {
		return fmt.Errorf("upsert development orchestrator connection: %w", err)
	}
	return nil
}

func ensureDemoDatabaseConnections(ctx context.Context, deps *apiDependencies, tenantID, userID string) error {
	if deps == nil || deps.connectionService.DB == nil {
		return fmt.Errorf("connection service is unavailable")
	}

	claims := authn.Claims{
		UserID:     userID,
		TenantID:   tenantID,
		TenantRole: "OWNER",
		Type:       "access",
	}

	for _, spec := range buildDevDemoDatabaseSpecs() {
		if err := upsertDemoDatabaseConnection(ctx, deps, claims, spec); err != nil {
			return err
		}
	}
	return nil
}

func upsertDemoDatabaseConnection(ctx context.Context, deps *apiDependencies, claims authn.Claims, spec devDemoDatabaseSpec) error {
	settingsJSON, err := json.Marshal(spec.DBSettings)
	if err != nil {
		return fmt.Errorf("encode demo database settings for %s: %w", spec.Name, err)
	}

	payload := map[string]any{
		"name":        spec.Name,
		"type":        "DATABASE",
		"host":        spec.Host,
		"port":        spec.Port,
		"username":    spec.Username,
		"password":    spec.Password,
		"description": spec.Description,
		"dbSettings":  json.RawMessage(settingsJSON),
	}

	existingID, err := findOwnedDemoConnectionID(ctx, deps, claims.UserID, spec.Name)
	if err != nil {
		return err
	}

	method := http.MethodPost
	urlPath := "https://localhost/api/connections"
	expectedStatus := http.StatusCreated
	if existingID != "" {
		method = http.MethodPut
		urlPath = "https://localhost/api/connections/" + existingID
		expectedStatus = http.StatusOK
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode demo connection payload for %s: %w", spec.Name, err)
	}

	req := httptest.NewRequest(method, urlPath, bytes.NewReader(body)).WithContext(ctx)
	req.RemoteAddr = devBootstrapIP + ":0"
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", devBootstrapUserAgent)
	if existingID != "" {
		req.SetPathValue("id", existingID)
	}

	recorder := httptest.NewRecorder()
	if existingID != "" {
		if err := deps.connectionService.HandleUpdate(recorder, req, claims); err != nil {
			return fmt.Errorf("update demo connection %s: %w", spec.Name, err)
		}
	} else {
		if err := deps.connectionService.HandleCreate(recorder, req, claims); err != nil {
			return fmt.Errorf("create demo connection %s: %w", spec.Name, err)
		}
	}

	if recorder.Code != expectedStatus {
		return fmt.Errorf("%s demo connection %s failed: %s", strings.ToLower(method), spec.Name, strings.TrimSpace(recorder.Body.String()))
	}
	return nil
}

func findOwnedDemoConnectionID(ctx context.Context, deps *apiDependencies, userID, name string) (string, error) {
	var connectionID string
	err := deps.db.QueryRow(ctx, `
SELECT id
FROM "Connection"
WHERE "userId" = $1
  AND type = 'DATABASE'::"ConnectionType"
  AND name = $2
ORDER BY "updatedAt" DESC
LIMIT 1
`, userID, name).Scan(&connectionID)
	if err == nil {
		return connectionID, nil
	}
	if strings.Contains(strings.ToLower(err.Error()), "no rows") {
		return "", nil
	}
	return "", fmt.Errorf("find demo connection %s: %w", name, err)
}

func upsertDevGateway(ctx context.Context, deps *apiDependencies, tenantID, userID string, spec devGatewaySpec) error {
	certPEM, keyPEM, expiry, err := readClientCertBundle(spec.CertDir)
	if err != nil {
		return err
	}
	encryptedToken, err := encryptBootstrapValue(deps.gatewayService.ServerEncryptionKey, spec.Token)
	if err != nil {
		return fmt.Errorf("encrypt tunnel token for %s: %w", spec.ID, err)
	}
	encryptedKey, err := encryptBootstrapValue(deps.gatewayService.ServerEncryptionKey, keyPEM)
	if err != nil {
		return fmt.Errorf("encrypt tunnel client key for %s: %w", spec.ID, err)
	}

	if _, err := deps.db.Exec(ctx, `
UPDATE "Gateway"
SET "isDefault" = false
WHERE "tenantId" = $1
  AND type = $2::"GatewayType"
  AND id <> $3
  AND "isDefault" = true
`, tenantID, spec.Type, spec.ID); err != nil {
		return fmt.Errorf("clear existing default gateway for %s: %w", spec.Type, err)
	}

	if _, err := deps.db.Exec(ctx, `
INSERT INTO "Gateway" (
  id, name, type, host, port, "apiPort", description, "tenantId", "createdById",
  "isDefault", "deploymentMode", "isManaged", "publishPorts", "desiredReplicas", "lbStrategy",
  "tunnelEnabled", "encryptedTunnelToken", "tunnelTokenIV", "tunnelTokenTag", "tunnelTokenHash",
  "tunnelClientCert", "tunnelClientCertExp", "tunnelClientKey", "tunnelClientKeyIV", "tunnelClientKeyTag",
  "monitoringEnabled", "monitorIntervalMs", "inactivityTimeoutSeconds", "updatedAt"
) VALUES (
  $1, $2, $3::"GatewayType", $4, $5, $6, $7, $8, $9,
  true, 'MANAGED_GROUP'::"GatewayDeploymentMode", true, false, 1, 'ROUND_ROBIN'::"LoadBalancingStrategy",
  true, $10, $11, $12, $13,
  $14, $15, $16, $17, $18,
  true, 5000, 3600, NOW()
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    type = EXCLUDED.type,
    host = EXCLUDED.host,
    port = EXCLUDED.port,
    "apiPort" = EXCLUDED."apiPort",
    description = EXCLUDED.description,
    "tenantId" = EXCLUDED."tenantId",
    "createdById" = EXCLUDED."createdById",
    "isDefault" = true,
    "deploymentMode" = 'MANAGED_GROUP'::"GatewayDeploymentMode",
    "isManaged" = true,
    "publishPorts" = false,
    "desiredReplicas" = 1,
    "lbStrategy" = 'ROUND_ROBIN'::"LoadBalancingStrategy",
    "tunnelEnabled" = true,
    "encryptedTunnelToken" = EXCLUDED."encryptedTunnelToken",
    "tunnelTokenIV" = EXCLUDED."tunnelTokenIV",
    "tunnelTokenTag" = EXCLUDED."tunnelTokenTag",
    "tunnelTokenHash" = EXCLUDED."tunnelTokenHash",
    "tunnelClientCert" = EXCLUDED."tunnelClientCert",
    "tunnelClientCertExp" = EXCLUDED."tunnelClientCertExp",
    "tunnelClientKey" = EXCLUDED."tunnelClientKey",
    "tunnelClientKeyIV" = EXCLUDED."tunnelClientKeyIV",
    "tunnelClientKeyTag" = EXCLUDED."tunnelClientKeyTag",
    "monitoringEnabled" = true,
    "monitorIntervalMs" = 5000,
    "inactivityTimeoutSeconds" = 3600,
    "updatedAt" = NOW()
`, spec.ID, spec.Name, spec.Type, spec.Host, spec.Port, spec.APIPort, spec.Description, tenantID, userID,
		encryptedToken.Ciphertext, encryptedToken.IV, encryptedToken.Tag, hashToken(spec.Token),
		certPEM, expiry, encryptedKey.Ciphertext, encryptedKey.IV, encryptedKey.Tag); err != nil {
		return fmt.Errorf("upsert gateway %s: %w", spec.ID, err)
	}
	return nil
}

func readClientCertBundle(certDir string) (string, string, time.Time, error) {
	certPEM, err := os.ReadFile(filepath.Join(certDir, "client-cert.pem"))
	if err != nil {
		return "", "", time.Time{}, fmt.Errorf("read tunnel client certificate from %s: %w", certDir, err)
	}
	keyPEM, err := os.ReadFile(filepath.Join(certDir, "client-key.pem"))
	if err != nil {
		return "", "", time.Time{}, fmt.Errorf("read tunnel client key from %s: %w", certDir, err)
	}
	block, _ := pem.Decode(certPEM)
	if block == nil {
		return "", "", time.Time{}, fmt.Errorf("decode tunnel client certificate from %s", certDir)
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return "", "", time.Time{}, fmt.Errorf("parse tunnel client certificate from %s: %w", certDir, err)
	}
	return strings.TrimSpace(string(certPEM)), strings.TrimSpace(string(keyPEM)), cert.NotAfter.UTC(), nil
}

func encryptBootstrapValue(key []byte, plaintext string) (encryptedValue, error) {
	if len(key) != 32 {
		return encryptedValue{}, fmt.Errorf("server encryption key is unavailable")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return encryptedValue{}, fmt.Errorf("create cipher: %w", err)
	}
	gcm, err := cipher.NewGCMWithNonceSize(block, 16)
	if err != nil {
		return encryptedValue{}, fmt.Errorf("create gcm: %w", err)
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return encryptedValue{}, fmt.Errorf("generate nonce: %w", err)
	}
	sealed := gcm.Seal(nil, nonce, []byte(plaintext), nil)
	tagSize := gcm.Overhead()
	return encryptedValue{
		Ciphertext: hex.EncodeToString(sealed[:len(sealed)-tagSize]),
		IV:         hex.EncodeToString(nonce),
		Tag:        hex.EncodeToString(sealed[len(sealed)-tagSize:]),
	}, nil
}

func certificateFingerprint(certPEM string) (string, error) {
	block, _ := pem.Decode([]byte(certPEM))
	if block == nil {
		return "", fmt.Errorf("decode certificate PEM")
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return "", fmt.Errorf("parse certificate: %w", err)
	}
	sum := sha256.Sum256(cert.Raw)
	return hex.EncodeToString(sum[:]), nil
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func intPtr(value int) *int {
	return &value
}
