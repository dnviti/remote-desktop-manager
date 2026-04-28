# Environment Variables

> Auto-generated on 2026-03-15 by `/docs create environment`.
> Source of truth is the codebase. Run `/docs update environment` after code changes.

## Overview

All environment variables are loaded from a single `.env` file at the monorepo root. The active Go services and supporting JS tooling read from that shared root configuration. Never create a separate service-local `.env`.

In production, the Docker Compose stack uses `.env.prod` (via `env_file`).

<!-- manual-start -->
> Runtime note: the active public edge is the Go control plane behind the client on `https://localhost:3000`, with direct local development access on `http://localhost:18080`. Legacy-only variables are still preserved here when historically relevant, but new runtime work should target the Go services.
<!-- manual-end -->

## Variable Reference

### Core

| Variable | Type | Default | Required | Env | Description |
|----------|------|---------|----------|-----|-------------|
| `DATABASE_URL` | string | — | Yes | Both | PostgreSQL connection string |
| `PORT` | number | `8080` | No | Both | Go control-plane API port |
| `GUACAMOLE_WS_PORT` | number | `3002` | No | Both | Guacamole WebSocket port |
| `NODE_ENV` | string | `development` | No | Both | Environment mode |
| `CLIENT_URL` | string | `https://localhost:3000` | No | Both | Client URL (CORS, OAuth redirects, emails) |
| `CLI_ENABLED` | boolean | `false` | No | Both | Enable the `arsenale` CLI inside the container |

### Authentication

| Variable | Type | Default | Required | Env | Description | Security Notes |
|----------|------|---------|----------|-----|-------------|---------------|
| `JWT_SECRET` | string | — | **Prod** | Both | JWT signing secret | **Must be provided via `JWT_SECRET` or `JWT_SECRET_FILE` and use a strong random value in production** |
| `JWT_EXPIRES_IN` | string | `15m` | No | Both | Access token lifetime (e.g., `15m`, `1h`) | |
| `JWT_REFRESH_EXPIRES_IN` | string | `7d` | No | Both | Refresh token lifetime (e.g., `7d`, `30d`) | |
| `TOKEN_BINDING_ENABLED` | boolean | `true` | No | Both | Bind JWT tokens to client IP + User-Agent. Set `false` for environments with dynamic IPs. | |
| `TOKEN_BINDING_ENFORCEMENT_TIMESTAMP` | string | control-plane startup time | No | Both | Reject access tokens without `ipUaHash` when their `iat` is after this cutoff. Accepts Unix seconds or RFC3339. | |

### Guacamole

| Variable | Type | Default | Required | Env | Description | Security Notes |
|----------|------|---------|----------|-----|-------------|---------------|
| `GUACD_HOST` | string | `localhost` | No | Both | Guacamole daemon hostname | |
| `GUACD_PORT` | number | `4822` | No | Both | Guacamole daemon port | |
| `GUACAMOLE_SECRET` | string | — | **Prod** | Both | Token encryption key for guacamole-lite | **Must be provided via `GUACAMOLE_SECRET` or `GUACAMOLE_SECRET_FILE` and use a strong random value in production** |

### Vault & Encryption

| Variable | Type | Default | Required | Env | Description | Security Notes |
|----------|------|---------|----------|-----|-------------|---------------|
| `VAULT_TTL_MINUTES` | number | `30` | No | Both | Vault session timeout (0 = never) | |
| `SERVER_ENCRYPTION_KEY` | hex string | Auto-generated | **Prod** | Both | 32-byte key for server-level encryption (64 hex chars) | **Required in production. Generate: `openssl rand -hex 32`** |

### Reverse Proxy

| Variable | Type | Default | Required | Env | Description |
|----------|------|---------|----------|-----|-------------|
| `TRUST_PROXY` | boolean/number/string | `false` | No | Prod | Public-edge proxy trust setting. `false` = disabled, `true` = trust all, number = hop count, string = trusted subnets |
| `ALLOW_LOCAL_NETWORK` | boolean | `false` | No | Both | Allow connections to private/local network addresses |

### Logging

| Variable | Type | Default | Required | Env | Description |
|----------|------|---------|----------|-----|-------------|
| `LOG_LEVEL` | enum | `info` | No | Both | Log verbosity: `error`, `warn`, `info`, `verbose`, `debug` |
| `LOG_FORMAT` | enum | `text` | No | Both | Log format: `text` or `json` |
| `LOG_TIMESTAMPS` | boolean | `true` | No | Both | Include ISO-8601 timestamps in logs |
| `LOG_HTTP_REQUESTS` | boolean | `false` | No | Both | Log HTTP requests (method, URL, status, duration) |
| `LOG_GUACAMOLE` | boolean | `true` | No | Both | Enable guacamole-lite RDP/VNC tunnel logs |

### File Management

| Variable | Type | Default | Required | Env | Description |
|----------|------|---------|----------|-----|-------------|
| `DRIVE_BASE_PATH` | string | `./data/drive` | No | Both | Local materialization cache for Guacamole RDP shared drives |
| `FILE_UPLOAD_MAX_SIZE` | number | `104857600` (100MB) | No | Both | Max file upload size in bytes. Oversized uploads should reach the backend and return a structured 413 JSON error instead of a raw proxy error page. |
| `USER_DRIVE_QUOTA` | number | `104857600` (100MB) | No | Both | Per-user drive quota in bytes |
| `FILE_THREAT_SCANNER_MODE` | string | `builtin` | No | Both | Threat scanner mode for staged file payloads. `builtin` blocks the EICAR signature; `disabled` or `noop` skips scanning. |
| `SHARED_FILES_S3_BUCKET` | string | — | No | Both | Bucket for staged RDP and SSH file payloads. This is required for the control plane to enable shared-drive and SSH file-transfer APIs. |
| `SHARED_FILES_S3_REGION` | string | `us-east-1` | No | Both | Region used for staged-file object storage |
| `SHARED_FILES_S3_ENDPOINT` | string | — | No | Both | Optional custom S3 endpoint for MinIO or another S3-compatible store |
| `SHARED_FILES_S3_ACCESS_KEY_ID` | string | — | No | Both | Access key for staged-file object storage. Leave empty when the runtime should use ambient IAM credentials |
| `SHARED_FILES_S3_SECRET_ACCESS_KEY` | string | — | No | Both | Secret key for staged-file object storage. Supports `_FILE` secret loading in the Go runtime |
| `SHARED_FILES_S3_PREFIX` | string | — | No | Both | Optional key prefix applied to all staged-file objects |
| `SHARED_FILES_S3_FORCE_PATH_STYLE` | boolean | `false` | No | Both | Force path-style S3 requests. Required by some MinIO and S3-compatible deployments |
| `SHARED_FILES_S3_AUTO_CREATE_BUCKET` | boolean | `false` | No | Both | Automatically create the configured staged-file bucket at startup or first use |

### Email

| Variable | Type | Default | Required | Env | Description |
|----------|------|---------|----------|-----|-------------|
| `EMAIL_PROVIDER` | enum | `smtp` | No | Both | Provider: `smtp`, `sendgrid`, `ses`, `resend`, `mailgun` |
| `EMAIL_VERIFY_REQUIRED` | boolean | `true` | No | Both | Require email verification before login |
| `SMTP_HOST` | string | — | Conditional | Both | SMTP server host (leave empty for dev console logging) |
| `SMTP_PORT` | number | `587` | No | Both | SMTP server port |
| `SMTP_USER` | string | — | Conditional | Both | SMTP username |
| `SMTP_PASS` | string | — | Conditional | Both | SMTP password |
| `SMTP_FROM` | string | `noreply@example.com` | No | Both | From address for emails |
| `SENDGRID_API_KEY` | string | — | Conditional | Prod | SendGrid API key |
| `AWS_SES_REGION` | string | `us-east-1` | No | Prod | AWS SES region |
| `AWS_SES_ACCESS_KEY_ID` | string | — | Conditional | Prod | AWS SES access key (leave empty for IAM roles) |
| `AWS_SES_SECRET_ACCESS_KEY` | string | — | Conditional | Prod | AWS SES secret key |
| `RESEND_API_KEY` | string | — | Conditional | Prod | Resend API key |
| `MAILGUN_API_KEY` | string | — | Conditional | Prod | Mailgun API key |
| `MAILGUN_DOMAIN` | string | — | Conditional | Prod | Mailgun sending domain |
| `MAILGUN_REGION` | enum | `us` | No | Prod | Mailgun region: `us` or `eu` |

### SMS

| Variable | Type | Default | Required | Env | Description |
|----------|------|---------|----------|-----|-------------|
| `SMS_PROVIDER` | enum | — | No | Both | Provider: `twilio`, `sns`, `vonage` (empty = dev console logging) |
| `TWILIO_ACCOUNT_SID` | string | — | Conditional | Prod | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | string | — | Conditional | Prod | Twilio auth token |
| `TWILIO_FROM_NUMBER` | string | — | Conditional | Prod | Twilio sender number |
| `AWS_SNS_REGION` | string | `us-east-1` | No | Prod | AWS SNS region |
| `AWS_SNS_ACCESS_KEY_ID` | string | — | Conditional | Prod | AWS SNS access key |
| `AWS_SNS_SECRET_ACCESS_KEY` | string | — | Conditional | Prod | AWS SNS secret key |
| `VONAGE_API_KEY` | string | — | Conditional | Prod | Vonage API key |
| `VONAGE_API_SECRET` | string | — | Conditional | Prod | Vonage API secret |
| `VONAGE_FROM_NUMBER` | string | — | Conditional | Prod | Vonage sender number |

### Self-Signup

| Variable | Type | Default | Required | Env | Description |
|----------|------|---------|----------|-----|-------------|
| `SELF_SIGNUP_ENABLED` | boolean | `false` | No | Both | Allow new user registration. When `false`, env-level lock that cannot be re-enabled via admin panel. |

### OAuth Providers

Leave `CLIENT_ID` empty to disable a provider.

| Variable | Default | Description |
|----------|---------|-------------|
| `GOOGLE_CLIENT_ID` | — | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | — | Google OAuth client secret |
| `GOOGLE_CALLBACK_URL` | `http://localhost:3000/api/auth/oauth/google/callback` | Google OAuth callback URL |
| `MICROSOFT_CLIENT_ID` | — | Microsoft OAuth client ID |
| `MICROSOFT_CLIENT_SECRET` | — | Microsoft OAuth client secret |
| `MICROSOFT_CALLBACK_URL` | `http://localhost:3000/api/auth/oauth/microsoft/callback` | Microsoft OAuth callback URL |
| `GITHUB_CLIENT_ID` | — | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | — | GitHub OAuth client secret |
| `GITHUB_CALLBACK_URL` | `http://localhost:3000/api/auth/oauth/github/callback` | GitHub OAuth callback URL |

### Generic OIDC

| Variable | Default | Description |
|----------|---------|-------------|
| `OIDC_PROVIDER_NAME` | `SSO` | Display name for the OIDC provider |
| `OIDC_ISSUER_URL` | — | OIDC issuer URL (discovery endpoint) |
| `OIDC_CLIENT_ID` | — | OIDC client ID (leave empty to disable) |
| `OIDC_CLIENT_SECRET` | — | OIDC client secret |
| `OIDC_CALLBACK_URL` | `http://localhost:3000/api/auth/oauth/oidc/callback` | OIDC callback URL |
| `OIDC_SCOPES` | `openid profile email` | OIDC scopes to request |

### SAML 2.0

| Variable | Default | Description |
|----------|---------|-------------|
| `SAML_PROVIDER_NAME` | `SAML SSO` | Display name |
| `SAML_ENTRY_POINT` | — | IdP SSO URL (leave empty to disable) |
| `SAML_ISSUER` | `arsenale` | SP entity ID |
| `SAML_CALLBACK_URL` | `http://localhost:3000/api/auth/saml/callback` | SAML ACS URL |
| `SAML_CERT` | — | IdP signing certificate (PEM, no headers) |
| `SAML_METADATA_URL` | — | IdP metadata URL (for auto-config) |
| `SAML_WANT_AUTHN_RESPONSE_SIGNED` | `true` | Require signed SAML responses |

### LDAP Authentication

Leave `LDAP_ENABLED=false` to disable. Compatible with FreeIPA, OpenLDAP, 389 Directory Server, LLDAP.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `LDAP_ENABLED` | boolean | `false` | Enable LDAP authentication |
| `LDAP_PROVIDER_NAME` | string | `LDAP` | Display name for the LDAP provider |
| `LDAP_SERVER_URL` | string | — | LDAP server URL (e.g., `ldap://ldap.example.com:389`) |
| `LDAP_BASE_DN` | string | — | Base distinguished name (e.g., `dc=example,dc=com`) |
| `LDAP_BIND_DN` | string | — | Bind DN for service account |
| `LDAP_BIND_PASSWORD` | string | — | Bind password for service account |
| `LDAP_USER_SEARCH_FILTER` | string | `(uid={{username}})` | User search filter template |
| `LDAP_USER_SEARCH_BASE` | string | — | User search base (defaults to `LDAP_BASE_DN`) |
| `LDAP_DISPLAY_NAME_ATTR` | string | `displayName` | LDAP attribute for display name |
| `LDAP_EMAIL_ATTR` | string | `mail` | LDAP attribute for email address |
| `LDAP_UID_ATTR` | string | `uid` | LDAP attribute for unique identifier |
| `LDAP_GROUP_BASE_DN` | string | — | Group search base DN (optional) |
| `LDAP_GROUP_SEARCH_FILTER` | string | `(objectClass=groupOfNames)` | Group search filter |
| `LDAP_GROUP_MEMBER_ATTR` | string | `member` | Group membership attribute |
| `LDAP_GROUP_NAME_ATTR` | string | `cn` | Group name attribute |
| `LDAP_ALLOWED_GROUPS` | string | — | Comma-separated list of allowed groups (empty = all) |
| `LDAP_STARTTLS` | boolean | `false` | Use STARTTLS for LDAP connection |
| `LDAP_TLS_REJECT_UNAUTHORIZED` | boolean | `true` | Reject unauthorized TLS certificates |
| `LDAP_SYNC_ENABLED` | boolean | `false` | Enable periodic LDAP user/group sync |
| `LDAP_SYNC_CRON` | string | `0 */6 * * *` | Cron expression for LDAP sync (every 6 hours) |
| `LDAP_AUTO_PROVISION` | boolean | `true` | Auto-create Arsenale user on first LDAP login |
| `LDAP_DEFAULT_TENANT_ID` | string | — | Default tenant ID for auto-provisioned LDAP users |

### WebAuthn / Passkeys

| Variable | Default | Description |
|----------|---------|-------------|
| `WEBAUTHN_RP_ID` | `localhost` | Relying party ID (usually the domain name) |
| `WEBAUTHN_RP_ORIGIN` | `http://localhost:3000` | Expected browser origin |
| `WEBAUTHN_RP_NAME` | `Arsenale` | Human-readable RP name |

### SSH Gateway

| Variable | Default | Description |
|----------|---------|-------------|
| `SSH_GATEWAY_PORT` | `2222` | SSH gateway container port |
| `SSH_AUTHORIZED_KEYS` | — | Authorized public keys (newline-separated) |
| `GATEWAY_API_TOKEN` | — | Shared secret for gateway API sidecar |

### Gateway Runtime Egress

| Variable | Default | Description |
|----------|---------|-------------|
| `ARSENALE_EGRESS_POLICY_JSON` | — | Normalized per-gateway ordered egress firewall policy used by managed gateway runtimes. When present, outbound tunnel targets must match protocol, host/CIDR, port, and optional user/team scope before traffic is opened. |
| `RUNTIME_EGRESS_PRINCIPAL_SIGNING_KEY` / `RUNTIME_EGRESS_PRINCIPAL_SIGNING_KEY_FILE` | — | Shared secret used by the control plane to sign runtime user/team context for scoped DB proxy egress rules. Managed DB proxy deployments with scoped rules fail closed if no key is configured. |

### SSH Key Rotation

| Variable | Default | Description |
|----------|---------|-------------|
| `KEY_ROTATION_CRON` | `0 2 * * *` | Cron expression for rotation check (daily 02:00 UTC) |
| `KEY_ROTATION_ADVANCE_DAYS` | `7` | Days before expiry to trigger rotation |

### Rate Limiting & Account Lockout

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `LOGIN_RATE_LIMIT_WINDOW_MS` | number | `900000` (15 min) | Login rate limit window |
| `LOGIN_RATE_LIMIT_MAX_ATTEMPTS` | number | `5` | Max attempts per IP per window |
| `ACCOUNT_LOCKOUT_THRESHOLD` | number | `10` | Failed logins before lockout |
| `ACCOUNT_LOCKOUT_DURATION_MS` | number | `1800000` (30 min) | Lockout duration |
| `VAULT_RATE_LIMIT_WINDOW_MS` | number | `60000` (1 min) | Vault unlock rate limit window |
| `VAULT_RATE_LIMIT_MAX_ATTEMPTS` | number | `5` | Max vault unlock attempts per user per window |
| `VAULT_MFA_RATE_LIMIT_MAX_ATTEMPTS` | number | `5` | Max vault MFA unlock attempts per user per window |
| `SESSION_RATE_LIMIT_WINDOW_MS` | number | `60000` (1 min) | Session endpoint rate limit window |
| `SESSION_RATE_LIMIT_MAX_ATTEMPTS` | number | `20` | Max session requests per user per window |
| `OAUTH_FLOW_RATE_LIMIT_WINDOW_MS` | number | `900000` (15 min) | OAuth flow initiation rate limit window |
| `OAUTH_FLOW_RATE_LIMIT_MAX_ATTEMPTS` | number | `20` | Max OAuth flow requests per IP per window |
| `OAUTH_ACCOUNT_RATE_LIMIT_WINDOW_MS` | number | `60000` (1 min) | OAuth account management rate limit window |
| `OAUTH_ACCOUNT_RATE_LIMIT_MAX_ATTEMPTS` | number | `15` | Max OAuth account requests per user per window |
| `OAUTH_LINK_RATE_LIMIT_WINDOW_MS` | number | `900000` (15 min) | OAuth account linking rate limit window |
| `OAUTH_LINK_RATE_LIMIT_MAX_ATTEMPTS` | number | `10` | Max account linking attempts per IP per window |

### Session Management

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `SESSION_HEARTBEAT_INTERVAL_MS` | number | `30000` (30s) | Heartbeat interval |
| `SESSION_IDLE_THRESHOLD_MINUTES` | number | `5` | Minutes before marking session idle |
| `SESSION_CLEANUP_RETENTION_DAYS` | number | `30` | Days to keep closed sessions |
| `SESSION_INACTIVITY_TIMEOUT_SECONDS` | number | `3600` (1h) | Session inactivity timeout |
| `MAX_CONCURRENT_SESSIONS` | number | `0` (unlimited) | Max concurrent login sessions per user (0 = unlimited) |
| `ABSOLUTE_SESSION_TIMEOUT_SECONDS` | number | `43200` (12h) | Absolute session timeout — forces re-login regardless of activity (0 = disabled) |

### Container Orchestrator

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `ORCHESTRATOR_TYPE` | enum | — (auto-detect) | `docker`, `podman`, `kubernetes`, `none` |
| `DOCKER_SOCKET_PATH` | string | `/var/run/docker.sock` | Docker socket path |
| `PODMAN_SOCKET_PATH` | string | `$XDG_RUNTIME_DIR/podman/podman.sock` | Podman socket path |
| `DOCKER_NETWORK` | string | `arsenale-dev` | Container network name |
| `ORCHESTRATOR_K8S_NAMESPACE` | string | `arsenale` | Kubernetes namespace |
| `ORCHESTRATOR_SSH_GATEWAY_IMAGE` | string | `ghcr.io/dnviti/arsenale/ssh-gateway:stable` | SSH gateway container image |
| `ORCHESTRATOR_GUACD_IMAGE` | string | `guacamole/guacd:1.6.0` | guacd container image (>= 1.6.0 for recording) |

### Session Recording

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `RECORDING_ENABLED` | boolean | `false` | Enable automatic session recording |
| `RECORDING_PATH` | string | `./data/recordings` | Recording file storage path |
| `RECORDING_VOLUME` | string | — | Docker volume name for recordings (prod) |
| `RECORDING_RETENTION_DAYS` | number | `90` | Days before auto-cleanup |

### Guacenc Video Conversion

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `GUACENC_SERVICE_URL` | string | `http://guacenc:3003` | Guacenc sidecar URL |
| `GUACENC_TIMEOUT_MS` | number | `120000` | Conversion timeout |
| `GUACENC_RECORDING_PATH` | string | `/recordings` | Container-side recording mount |

### GeoIP & Impossible Travel

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `GEOIP_DB_PATH` | string | — | Path to MaxMind GeoLite2-City.mmdb (optional) |
| `IMPOSSIBLE_TRAVEL_SPEED_KMH` | number | `900` | Max plausible travel speed in km/h. Consecutive logins requiring faster travel are flagged. Set `0` to disable. |

### Docker-Specific Variables (compose only)

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_USER` | `arsenale` | PostgreSQL username |
| `POSTGRES_PASSWORD` | `arsenale_password` | PostgreSQL password |
| `POSTGRES_DB` | `arsenale` | PostgreSQL database name |

<!-- manual-start -->
<!-- manual-end -->

## Installer And Feature Flags

These variables are emitted by the Ansible installer and control runtime feature gating.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `ARSENALE_INSTALL_MODE` | string | `development` | Install mode: `development` or `production` |
| `ARSENALE_INSTALL_BACKEND` | string | `podman` | Install backend: `podman` or `kubernetes` |
| `ARSENALE_INSTALL_CAPABILITIES` | string | — | Comma-separated enabled capability set |
| `FEATURE_CONNECTIONS_ENABLED` | boolean | `true` | Enable SSH, RDP, VNC connections and folders |
| `FEATURE_IP_GEOLOCATION_ENABLED` | boolean | `true` | Enable GeoIP lookups, audit maps, and the `map-assets` tile service |
| `FEATURE_DATABASE_PROXY_ENABLED` | boolean | `true` | Enable database sessions and DB audit |
| `FEATURE_KEYCHAIN_ENABLED` | boolean | `true` | Enable vault, secrets, files, and external vault providers |
| `FEATURE_MULTI_TENANCY_ENABLED` | boolean | `true` | Enable multiple organizations, tenant switching, and self-service organization creation |
| `FEATURE_RECORDINGS_ENABLED` | boolean | `true` | Enable recording APIs and UI |
| `FEATURE_ZERO_TRUST_ENABLED` | boolean | `true` | Enable gateways, tunnel broker, and managed zero-trust routing |
| `FEATURE_AGENTIC_AI_ENABLED` | boolean | `true` | Enable AI-assisted database tooling |
| `FEATURE_ENTERPRISE_AUTH_ENABLED` | boolean | `true` | Enable SAML, OAuth, OIDC, LDAP surfaces |
| `FEATURE_SHARING_APPROVALS_ENABLED` | boolean | `true` | Enable public sharing, approvals, and checkouts |
| `CLI_ENABLED` | boolean | `false` | Enable CLI device auth and CLI-specific APIs |
| `GATEWAY_ROUTING_MODE` | string | — | Direct vs gateway-mandatory routing behavior |

These flags are converted to a runtime manifest in `backend/internal/runtimefeatures/manifest.go` and exposed via `GET /api/auth/config`.

## Development Defaults

In development (`NODE_ENV=development`):

- `JWT_SECRET` and `GUACAMOLE_SECRET` must still be provisioned via `.env` or the corresponding `_FILE` variables; the Go services do not ship built-in development secrets
- `SERVER_ENCRYPTION_KEY` is auto-generated (not persisted)
- Email verification links are logged to console (no SMTP required)
- SMS OTP codes are logged to console (no SMS provider required)
- Self-signup is enabled by default
- PostgreSQL uses `arsenale:arsenale_password@127.0.0.1:5432/arsenale`

## Production Configuration

Required environment variables with strong random values:

```bash
# Generate secrets
JWT_SECRET=$(openssl rand -base64 32)
GUACAMOLE_SECRET=$(openssl rand -base64 32)
SERVER_ENCRYPTION_KEY=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -base64 32)
GATEWAY_API_TOKEN=$(openssl rand -hex 32)  # if using managed gateways
```

Essential production settings:

```env
NODE_ENV=production
CLIENT_URL=https://your-domain.com
TRUST_PROXY=1   # adjust based on proxy chain depth
JWT_SECRET=<generated>
GUACAMOLE_SECRET=<generated>
SERVER_ENCRYPTION_KEY=<generated>
```

<!-- manual-start -->
<!-- manual-end -->
