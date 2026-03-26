---
title: Configuration
description: Environment variables, config files, feature flags, and service configuration
generated-by: ctdf-docs
generated-at: 2026-03-24T23:40:00Z
source-files:
  - .env.example
  - server/src/config.ts
  - server/prisma.config.ts
  - client/vite.config.ts
  - eslint.config.mjs
---

# Configuration

All configuration is managed through environment variables in a single `.env` file at the monorepo root. The server reads this file on startup; the client receives its configuration via Vite's `VITE_` prefix or runtime API calls.

## Environment File Location

The `.env` file **must** be at the monorepo root (`/arsenale/.env`), not inside `server/`. Prisma CLI commands (`db:push`, `db:migrate`) run from the `server/` workspace, and `server/prisma.config.ts` resolves the env path to `../.env`.

Never create a separate `server/.env` — all env vars are loaded from the root.

## Core Configuration

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://arsenale:arsenale_password@127.0.0.1:5432/arsenale` | PostgreSQL connection string |
| `POSTGRES_USER` | `arsenale` | PostgreSQL user (Docker) |
| `POSTGRES_PASSWORD` | `arsenale_password` | PostgreSQL password (Docker) |
| `POSTGRES_DB` | `arsenale` | Database name (Docker) |

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Express server port |
| `NODE_ENV` | `development` | Environment mode |
| `CLIENT_URL` | `http://localhost:3000` | Client URL for CORS and email links |
| `TRUST_PROXY` | `false` | Reverse proxy trust (false, true, number, or subnet) |

### Secrets

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | Auto-generated in dev | JWT signing key (**required in production**) |
| `JWT_EXPIRES_IN` | `15m` | Access token TTL |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | Refresh token TTL |
| `GUACAMOLE_SECRET` | Auto-generated in dev | Shared secret for Guacamole tokens |
| `GUACAMOLE_WS_PORT` | `3002` | Guacamole WebSocket port |
| `SERVER_ENCRYPTION_KEY` | Auto-generated in dev | Server-level AES-256 key (32 bytes hex) |

### Vault & Encryption

| Variable | Default | Description |
|----------|---------|-------------|
| `VAULT_TTL_MINUTES` | `30` | Vault session auto-lock timeout (0 = never) |

### Token Binding

| Variable | Default | Description |
|----------|---------|-------------|
| `TOKEN_BINDING_ENABLED` | `true` | Bind JWT tokens to client IP + User-Agent (MITRE T1563). Set to `false` to disable. |

## Guacamole (RDP/VNC)

| Variable | Default | Description |
|----------|---------|-------------|
| `GUACD_HOST` | `localhost` | guacd daemon hostname |
| `GUACD_PORT` | `4822` | guacd port |
| `RECORDING_ENABLED` | `false` | Enable session recording |
| `RECORDING_PATH` | `./data/recordings` | Recording storage directory |
| `RECORDING_VOLUME` | — | Docker volume name (production) |
| `RECORDING_RETENTION_DAYS` | `90` | Auto-cleanup retention |
| `GUACENC_SERVICE_URL` | `http://guacenc:3003` | Video conversion sidecar URL |
| `GUACENC_TIMEOUT_MS` | `120000` | Conversion timeout |
| `GUACENC_RECORDING_PATH` | `/recordings` | Container-side mount point for recordings (must match the guacenc volume mount) |
| `ASCIICAST_CONVERTER_URL` | Value of `GUACENC_SERVICE_URL` | Asciicast-to-MP4 converter URL (defaults to guacenc sidecar; set only if running a separate converter) |

## SSH Gateway

| Variable | Default | Description |
|----------|---------|-------------|
| `SSH_GATEWAY_PORT` | `2222` | SSH gateway listening port |
| `SSH_AUTHORIZED_KEYS` | — | Newline-separated public keys |
| `GATEWAY_API_TOKEN` | — | Shared secret for gateway API |
| `KEY_ROTATION_CRON` | `0 2 * * *` | SSH key rotation schedule (daily 02:00 UTC) |
| `KEY_ROTATION_ADVANCE_DAYS` | `7` | Rotation trigger threshold |

## SSH Protocol Proxy

Native SSH proxy for direct SSH access to managed connections without a browser.

| Variable | Default | Description |
|----------|---------|-------------|
| `SSH_PROXY_ENABLED` | `false` | Enable the SSH protocol proxy |
| `SSH_PROXY_PORT` | `2222` | SSH proxy listening port |
| `SSH_PROXY_HOST_KEY` | — | Path to SSH host private key |
| `SSH_PROXY_AUTH_METHODS` | `token,keyboard-interactive` | Comma-separated auth methods (`token`, `keyboard-interactive`, `certificate`) |
| `SSH_PROXY_TOKEN_TTL_SECONDS` | `300` | One-time connection token TTL |
| `SSH_PROXY_CA_PUBLIC_KEY` | — | Path to CA public key for certificate auth |
| `SSH_PROXY_KEYSTROKE_RECORDING` | `false` | Enable keystroke recording for proxied sessions |

## Database Access

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_PROXY_ENABLED` | `false` | Enable database protocol gateway |
| `DB_PROXY_HOST` | `localhost` | DB proxy container host |
| `DB_PROXY_API_PORT` | `8080` | DB proxy management API port |
| `DB_QUERY_TIMEOUT_MS` | `30000` | Query execution timeout (30 s) |
| `DB_QUERY_MAX_ROWS` | `10000` | Maximum rows returned per query |
| `DB_POOL_MAX_CONNECTIONS` | `3` | Max connections in the DB proxy pool |
| `DB_POOL_IDLE_TIMEOUT_MS` | `60000` | Idle connection timeout (60 s) |

### Database Query Rate Limiting

Token-bucket rate limiting applied to user-initiated database queries.

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_RATE_LIMIT_DEFAULT_WINDOW_MS` | `60000` | Rate limit window (60 s) |
| `DB_RATE_LIMIT_DEFAULT_MAX_QUERIES` | `100` | Max queries per window |
| `DB_RATE_LIMIT_CLEANUP_INTERVAL_MS` | `300000` | Bucket cleanup interval (5 min) |

## SSH Keystroke Inspection

Keystroke policies are managed per-tenant via the `/api/keystroke-policies` endpoint. Policies define regex patterns matched against SSH input with two actions: `BLOCK_AND_TERMINATE` (prevents command execution and kills session) or `ALERT_ONLY` (logs and notifies but allows execution). Policy cache refreshes every 30 seconds.

## Credential Checkout (PAM)

| Variable | Default | Description |
|----------|---------|-------------|
| Checkout request duration | 1-1440 min | Configurable per-request |
| Expiry check interval | 5 min | Cron job for auto-expiry |

## SFTP

| Variable | Default | Description |
|----------|---------|-------------|
| `SFTP_MAX_FILE_SIZE` | `104857600` | Max SFTP file size (100 MB) |
| `SFTP_CHUNK_SIZE` | `65536` | SFTP transfer chunk size (64 KB) |

## Authentication Providers

### OAuth

| Variable | Default | Description |
|----------|---------|-------------|
| `GOOGLE_CLIENT_ID` | — | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | — | Google OAuth client secret |
| `GOOGLE_HD` | — | Google hosted domain restriction (e.g. `example.com`) |
| `GOOGLE_CALLBACK_URL` | `http://localhost:3001/api/auth/oauth/google/callback` | Google OAuth callback URL |
| `MICROSOFT_CLIENT_ID` | — | Microsoft OAuth client ID |
| `MICROSOFT_CLIENT_SECRET` | — | Microsoft OAuth client secret |
| `MICROSOFT_TENANT_ID` | `common` | Azure AD tenant ID or `common` / `organizations` / `consumers` |
| `MICROSOFT_CALLBACK_URL` | `http://localhost:3001/api/auth/oauth/microsoft/callback` | Microsoft OAuth callback URL |
| `GITHUB_CLIENT_ID` | — | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | — | GitHub OAuth client secret |
| `GITHUB_CALLBACK_URL` | `http://localhost:3001/api/auth/oauth/github/callback` | GitHub OAuth callback URL |

### OIDC

| Variable | Default | Description |
|----------|---------|-------------|
| `OIDC_PROVIDER_NAME` | `SSO` | Display name for OIDC provider |
| `OIDC_ISSUER_URL` | — | OIDC issuer URL |
| `OIDC_CLIENT_ID` | — | OIDC client ID |
| `OIDC_CLIENT_SECRET` | — | OIDC client secret |
| `OIDC_CALLBACK_URL` | `http://localhost:3001/api/auth/oauth/oidc/callback` | OIDC callback URL |
| `OIDC_SCOPES` | `openid profile email` | OIDC scopes |

### SAML

| Variable | Default | Description |
|----------|---------|-------------|
| `SAML_PROVIDER_NAME` | `SAML SSO` | Display name for SAML provider |
| `SAML_ENTRY_POINT` | — | SAML SSO URL |
| `SAML_ISSUER` | `arsenale` | SAML entity ID |
| `SAML_CALLBACK_URL` | `http://localhost:3001/api/auth/saml/callback` | SAML ACS URL |
| `SAML_CERT` | — | SAML certificate (PEM) |
| `SAML_METADATA_URL` | — | SAML metadata URL |
| `SAML_WANT_AUTHN_RESPONSE_SIGNED` | `true` | Require signed SAML responses |

### LDAP

| Variable | Default | Description |
|----------|---------|-------------|
| `LDAP_ENABLED` | `false` | Enable LDAP authentication |
| `LDAP_PROVIDER_NAME` | `LDAP` | Display name for LDAP provider |
| `LDAP_SERVER_URL` | — | LDAP server URL |
| `LDAP_BASE_DN` | — | Base distinguished name |
| `LDAP_BIND_DN` | — | Bind DN for searches |
| `LDAP_BIND_PASSWORD` | — | Bind password |
| `LDAP_USER_SEARCH_FILTER` | `(uid={{username}})` | User search filter |
| `LDAP_USER_SEARCH_BASE` | — | User search base |
| `LDAP_DISPLAY_NAME_ATTR` | `displayName` | Display name attribute |
| `LDAP_EMAIL_ATTR` | `mail` | Email attribute |
| `LDAP_UID_ATTR` | `uid` | UID attribute |
| `LDAP_GROUP_BASE_DN` | — | Base DN for group searches |
| `LDAP_GROUP_SEARCH_FILTER` | `(objectClass=groupOfNames)` | Group search filter |
| `LDAP_GROUP_MEMBER_ATTR` | `member` | Group membership attribute |
| `LDAP_GROUP_NAME_ATTR` | `cn` | Group name attribute |
| `LDAP_ALLOWED_GROUPS` | — | Comma-separated list of allowed group names |
| `LDAP_STARTTLS` | `false` | Use STARTTLS |
| `LDAP_TLS_REJECT_UNAUTHORIZED` | `true` | Reject untrusted TLS certificates |
| `LDAP_SYNC_ENABLED` | `false` | Enable periodic LDAP sync |
| `LDAP_SYNC_CRON` | `0 */6 * * *` | Sync schedule (every 6 hours) |
| `LDAP_AUTO_PROVISION` | `true` | Auto-create users from LDAP |
| `LDAP_DEFAULT_TENANT_ID` | — | Default tenant for provisioned users |

## Email

| Variable | Default | Description |
|----------|---------|-------------|
| `EMAIL_PROVIDER` | `smtp` | Provider: smtp, sendgrid, ses, resend, mailgun |
| `EMAIL_VERIFY_REQUIRED` | `false` | Enforce email verification |
| `SELF_SIGNUP_ENABLED` | `false` | Allow self-registration |
| `SMTP_HOST` | — | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password |
| `SMTP_FROM` | `noreply@localhost` | From address |
| `SENDGRID_API_KEY` | — | SendGrid API key |
| `AWS_SES_REGION` | `us-east-1` | Amazon SES region |
| `AWS_SES_ACCESS_KEY_ID` | — | SES access key (leave empty for IAM roles) |
| `AWS_SES_SECRET_ACCESS_KEY` | — | SES secret key |
| `RESEND_API_KEY` | — | Resend API key |
| `MAILGUN_API_KEY` | — | Mailgun API key |
| `MAILGUN_DOMAIN` | — | Mailgun domain |
| `MAILGUN_REGION` | `us` | Mailgun region (`us` or `eu`) |

## SMS

| Variable | Default | Description |
|----------|---------|-------------|
| `SMS_PROVIDER` | — | Provider: twilio, sns, vonage (dev: console) |
| `TWILIO_ACCOUNT_SID` | — | Twilio SID |
| `TWILIO_AUTH_TOKEN` | — | Twilio auth token |
| `TWILIO_FROM_NUMBER` | — | Twilio phone number |
| `AWS_SNS_REGION` | `us-east-1` | AWS SNS region |
| `AWS_SNS_ACCESS_KEY_ID` | — | SNS access key (leave empty for IAM roles) |
| `AWS_SNS_SECRET_ACCESS_KEY` | — | SNS secret key |
| `VONAGE_API_KEY` | — | Vonage API key |
| `VONAGE_API_SECRET` | — | Vonage API secret |
| `VONAGE_FROM_NUMBER` | — | Vonage sender number |

## Security & Rate Limiting

| Variable | Default | Description |
|----------|---------|-------------|
| `LOGIN_RATE_LIMIT_WINDOW_MS` | `900000` | Rate limit window (15 min) |
| `LOGIN_RATE_LIMIT_MAX_ATTEMPTS` | `5` | Max login attempts per IP per window |
| `ACCOUNT_LOCKOUT_THRESHOLD` | `10` | Failed logins before lockout |
| `ACCOUNT_LOCKOUT_DURATION_MS` | `1800000` | Lockout duration (30 min) |
| `MAX_CONCURRENT_SESSIONS` | `0` | Per-user session limit (0 = unlimited) |
| `ABSOLUTE_SESSION_TIMEOUT_SECONDS` | `43200` | Absolute timeout (12 hours, 0 = disabled) |
| `ALLOW_LOCAL_NETWORK` | `true` | Allow connections to private networks |
| `ALLOW_LOOPBACK` | `false` | Allow connections to loopback addresses (localhost, 127.x, ::1) |
| `ALLOW_EXTERNAL_SHARING` | `false` | Enable cross-tenant sharing |

### Vault Rate Limiting

| Variable | Default | Description |
|----------|---------|-------------|
| `VAULT_RATE_LIMIT_WINDOW_MS` | `60000` | Vault unlock rate limit window (60 s) |
| `VAULT_RATE_LIMIT_MAX_ATTEMPTS` | `5` | Max vault unlock attempts per window |
| `VAULT_MFA_RATE_LIMIT_MAX_ATTEMPTS` | `10` | Max vault MFA attempts per window |

### Session Rate Limiting

| Variable | Default | Description |
|----------|---------|-------------|
| `SESSION_RATE_LIMIT_WINDOW_MS` | `60000` | Session endpoint rate limit window (60 s) |
| `SESSION_RATE_LIMIT_MAX_ATTEMPTS` | `20` | Max session requests per window |

### OAuth Rate Limiting

| Variable | Default | Description |
|----------|---------|-------------|
| `OAUTH_FLOW_RATE_LIMIT_WINDOW_MS` | `900000` | OAuth flow rate limit window (15 min) |
| `OAUTH_FLOW_RATE_LIMIT_MAX_ATTEMPTS` | `20` | Max OAuth flow attempts per window |
| `OAUTH_ACCOUNT_RATE_LIMIT_WINDOW_MS` | `60000` | OAuth account rate limit window (60 s) |
| `OAUTH_ACCOUNT_RATE_LIMIT_MAX_ATTEMPTS` | `15` | Max OAuth account operations per window |
| `OAUTH_LINK_RATE_LIMIT_WINDOW_MS` | `900000` | OAuth link rate limit window (15 min) |
| `OAUTH_LINK_RATE_LIMIT_MAX_ATTEMPTS` | `10` | Max OAuth link attempts per window |

### Global Rate Limiter

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_WHITELIST_CIDRS` | `127.0.0.1/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16` | Comma-separated CIDRs that bypass the global rate limiter. Set to empty string to disable. |
| `GLOBAL_RATE_LIMIT_WINDOW_MS` | `60000` | Global rate limit window (60 s) |
| `GLOBAL_RATE_LIMIT_MAX_AUTHENTICATED` | `200` | Max requests per window for authenticated users |
| `GLOBAL_RATE_LIMIT_MAX_ANONYMOUS` | `60` | Max requests per window for anonymous users |

### Session Management

| Variable | Default | Description |
|----------|---------|-------------|
| `SESSION_HEARTBEAT_INTERVAL_MS` | `30000` | Client heartbeat interval (30 s) |
| `SESSION_IDLE_THRESHOLD_MINUTES` | `5` | Minutes of inactivity before session is considered idle |
| `SESSION_CLEANUP_RETENTION_DAYS` | `30` | Days to retain closed session records |
| `SESSION_INACTIVITY_TIMEOUT_SECONDS` | `3600` | Inactivity timeout (1 hour, forces disconnect) |

### Lateral Movement Detection

Anomaly detection for rapid connection to many distinct targets (MITRE T1021).

| Variable | Default | Description |
|----------|---------|-------------|
| `LATERAL_MOVEMENT_DETECTION_ENABLED` | `true` | Enable lateral movement detection (set to `false` to disable) |
| `LATERAL_MOVEMENT_MAX_DISTINCT_TARGETS` | `10` | Max distinct targets within the detection window |
| `LATERAL_MOVEMENT_WINDOW_MINUTES` | `5` | Sliding window for target counting |
| `LATERAL_MOVEMENT_LOCKOUT_MINUTES` | `30` | Lockout duration after detection |

### WebAuthn

| Variable | Default | Description |
|----------|---------|-------------|
| `WEBAUTHN_RP_ID` | `localhost` | Relying party ID |
| `WEBAUTHN_RP_ORIGIN` | `http://localhost:3000` | Relying party origin |
| `WEBAUTHN_RP_NAME` | `Arsenale` | Relying party display name |

### GeoIP

| Variable | Default | Description |
|----------|---------|-------------|
| `GEOIP_DB_PATH` | — | Path to MaxMind GeoLite2-City.mmdb |
| `IMPOSSIBLE_TRAVEL_SPEED_KMH` | `900` | Max plausible travel speed (0 = disabled) |

## File Sharing

| Variable | Default | Description |
|----------|---------|-------------|
| `DRIVE_BASE_PATH` | `./data/drive` | Local file share directory |
| `FILE_UPLOAD_MAX_SIZE` | `10485760` | Max upload size (10 MB) |
| `USER_DRIVE_QUOTA` | `104857600` | Per-user quota (100 MB) |

## Container Orchestration

| Variable | Default | Description |
|----------|---------|-------------|
| `ORCHESTRATOR_TYPE` | Auto-detect | docker, podman, kubernetes, none |
| `DOCKER_SOCKET_PATH` | `/var/run/docker.sock` | Docker socket path |
| `PODMAN_SOCKET_PATH` | `$XDG_RUNTIME_DIR/podman/podman.sock` | Podman socket |
| `DOCKER_NETWORK` | `arsenale-dev` | Container network for managed gateways |
| `ORCHESTRATOR_K8S_NAMESPACE` | `arsenale` | Kubernetes namespace |
| `ORCHESTRATOR_SSH_GATEWAY_IMAGE` | `ghcr.io/dnviti/arsenale/ssh-gateway:latest` | SSH gateway image |
| `ORCHESTRATOR_GUACD_IMAGE` | `guacamole/guacd:1.6.0` | guacd image |
| `ORCHESTRATOR_DB_PROXY_IMAGE` | `ghcr.io/dnviti/arsenale/db-proxy:latest` | Database proxy image |

## Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | error, warn, info, verbose, debug |
| `LOG_FORMAT` | `text` | text or json |
| `LOG_TIMESTAMPS` | `true` | ISO-8601 timestamps |
| `LOG_HTTP_REQUESTS` | `false` | Log HTTP requests |
| `LOG_GUACAMOLE` | `true` | Log guacamole-lite tunneling |

## Cache Sidecar (gocache)

| Variable | Default | Description |
|----------|---------|-------------|
| `CACHE_SIDECAR_URL` | `localhost:6380` | gRPC endpoint of the gocache sidecar |
| `CACHE_SIDECAR_ENABLED` | `true` | Set to `false` to disable distributed cache (single-instance fallback) |

> **Note:** The TypeScript gRPC client uses a manual JSON codec service definition that matches the Go sidecar's custom codec (`infrastructure/gocache/codec.go`). No `.proto` file is loaded at runtime.

Sidecar-side configuration (container environment):

| Variable | Default | Description |
|----------|---------|-------------|
| `CACHE_LISTEN` | `tcp://localhost:6380` | gRPC listen address (`tcp://` or `unix://`) |
| `CACHE_HEALTH_ADDR` | `0.0.0.0:6381` | Health HTTP endpoint address |
| `CACHE_MAX_MEMORY` | `256mb` | Maximum KV store memory |
| `CACHE_DISCOVERY` | `manual` | Peer discovery: `docker`, `kubernetes`, `manual` |
| `CACHE_PEERS` | — | Comma-separated peer addresses (manual mode) |
| `CACHE_K8S_SERVICE` | `gocache` | Kubernetes headless service name |
| `CACHE_K8S_NAMESPACE` | — | Kubernetes namespace |
| `CACHE_REPLICATION_ADDR` | `0.0.0.0:7380` | Peer replication listener address |
| `CACHE_REPLICATION_BUFFER` | `10mb` | Replication buffer size |
| `CACHE_GRPC_REFLECTION` | `false` | Enable gRPC reflection (debugging) |

## AI / LLM Integration

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_PROVIDER` | — | Provider: `anthropic`, `openai`, `ollama`, `openai-compatible` (empty = disabled) |
| `AI_API_KEY` | — | API key for the selected provider (not needed for Ollama) |
| `AI_MODEL` | — | Model name (empty uses provider default) |
| `AI_BASE_URL` | — | Base URL (required for `ollama` and `openai-compatible`) |
| `AI_MAX_TOKENS` | `4096` | Max tokens per response |
| `AI_TEMPERATURE` | `0.2` | Sampling temperature |
| `AI_TIMEOUT_MS` | `60000` | Request timeout (60 s) |
| `AI_QUERY_GENERATION_ENABLED` | `false` | Enable AI-powered natural-language-to-SQL query generation |
| `AI_QUERY_GENERATION_MODEL` | — | Override model for query generation (empty = use `AI_MODEL`) |
| `AI_MAX_REQUESTS_PER_DAY` | `100` | Max AI query generation requests per tenant per day |

## Vite Client Configuration

The client dev server is configured in `client/vite.config.ts`:

| Setting | Value | Description |
|---------|-------|-------------|
| Port | 3000 | Dev server port |
| `/api` proxy | `http://localhost:3001` | API proxy (override with `VITE_API_TARGET`) |
| `/socket.io` proxy | `http://localhost:3001` | WebSocket proxy |
| `/guacamole` proxy | `http://localhost:3002` | Guacamole proxy |
| Chunk size warning | 700 KB | Build warning threshold |

## Feature Flags

Features are controlled through environment variables and database settings:

| Feature | Control | Default |
|---------|---------|---------|
| Self-signup | `SELF_SIGNUP_ENABLED` env + AppConfig DB | `false` |
| Email verification | `EMAIL_VERIFY_REQUIRED` | `false` |
| Session recording | `RECORDING_ENABLED` | `false` |
| LDAP authentication | `LDAP_ENABLED` | `false` |
| LDAP sync | `LDAP_SYNC_ENABLED` | `false` |
| GeoIP tracking | `GEOIP_DB_PATH` (presence) | Disabled |
| Impossible travel | `IMPOSSIBLE_TRAVEL_SPEED_KMH` > 0 | `900` km/h |
| Lateral movement detection | `LATERAL_MOVEMENT_DETECTION_ENABLED` | `true` |
| Token binding | `TOKEN_BINDING_ENABLED` | `true` |
| External sharing | `ALLOW_EXTERNAL_SHARING` | `false` |
| Local network access | `ALLOW_LOCAL_NETWORK` | `true` |
| Loopback access | `ALLOW_LOOPBACK` | `false` |
| CLI tool | `CLI_ENABLED` | `false` |
| Database proxy | `FEATURE_DATABASE_PROXY_ENABLED` | `true` |
| Connections | `FEATURE_CONNECTIONS_ENABLED` | `true` |
| Keychain | `FEATURE_KEYCHAIN_ENABLED` | `true` |
| SSH protocol proxy | `SSH_PROXY_ENABLED` | `false` |
| AI integration | `AI_PROVIDER` (presence) | Disabled |
| AI query generation | `AI_QUERY_GENERATION_ENABLED` | `false` |
