---
title: Configuration
description: Environment variables, config files, feature flags, and service configuration
generated-by: ctdf-docs
generated-at: 2026-03-20T01:15:00Z
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

## Guacamole (RDP/VNC)

| Variable | Default | Description |
|----------|---------|-------------|
| `GUACD_HOST` | `localhost` | guacd daemon hostname |
| `GUACD_PORT` | `4822` | guacd port |
| `RECORDING_ENABLED` | `false` | Enable session recording |
| `RECORDING_PATH` | `./data/recordings` | Recording storage directory |
| `RECORDING_VOLUME` | `arsenale_recordings` | Docker volume name (production) |
| `RECORDING_RETENTION_DAYS` | `90` | Auto-cleanup retention |
| `GUACENC_SERVICE_URL` | `http://guacenc:3003` | Video conversion sidecar URL |
| `GUACENC_TIMEOUT_MS` | `120000` | Conversion timeout |

## SSH Gateway

| Variable | Default | Description |
|----------|---------|-------------|
| `SSH_GATEWAY_PORT` | `2222` | SSH gateway listening port |
| `SSH_AUTHORIZED_KEYS` | — | Newline-separated public keys |
| `GATEWAY_API_TOKEN` | — | Shared secret for gateway API |
| `KEY_ROTATION_CRON` | `0 2 * * *` | SSH key rotation schedule (daily 02:00 UTC) |
| `KEY_ROTATION_ADVANCE_DAYS` | `7` | Rotation trigger threshold |

## Database Access

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_PROXY_ENABLED` | `false` | Enable database protocol gateway |
| `DB_PROXY_HOST` | `localhost` | DB proxy container host |
| `DB_PROXY_API_PORT` | `8080` | DB proxy management API port |

## SSH Keystroke Inspection

Keystroke policies are managed per-tenant via the `/api/keystroke-policies` endpoint. Policies define regex patterns matched against SSH input with two actions: `BLOCK_AND_TERMINATE` (prevents command execution and kills session) or `ALERT_ONLY` (logs and notifies but allows execution). Policy cache refreshes every 30 seconds.

## Credential Checkout (PAM)

| Variable | Default | Description |
|----------|---------|-------------|
| Checkout request duration | 1-1440 min | Configurable per-request |
| Expiry check interval | 5 min | Cron job for auto-expiry |

## Authentication Providers

### OAuth

| Variable | Default | Description |
|----------|---------|-------------|
| `GOOGLE_CLIENT_ID` | — | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | — | Google OAuth client secret |
| `MICROSOFT_CLIENT_ID` | — | Microsoft OAuth client ID |
| `MICROSOFT_CLIENT_SECRET` | — | Microsoft OAuth client secret |
| `GITHUB_CLIENT_ID` | — | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | — | GitHub OAuth client secret |

### OIDC

| Variable | Default | Description |
|----------|---------|-------------|
| `OIDC_PROVIDER_NAME` | — | Display name for OIDC provider |
| `OIDC_ISSUER_URL` | — | OIDC issuer URL |
| `OIDC_CLIENT_ID` | — | OIDC client ID |
| `OIDC_CLIENT_SECRET` | — | OIDC client secret |
| `OIDC_CALLBACK_URL` | — | OIDC callback URL |
| `OIDC_SCOPES` | `openid profile email` | OIDC scopes |

### SAML

| Variable | Default | Description |
|----------|---------|-------------|
| `SAML_PROVIDER_NAME` | — | Display name for SAML provider |
| `SAML_ENTRY_POINT` | — | SAML SSO URL |
| `SAML_ISSUER` | — | SAML entity ID |
| `SAML_CALLBACK_URL` | — | SAML ACS URL |
| `SAML_CERT` | — | SAML certificate (PEM) |
| `SAML_METADATA_URL` | — | SAML metadata URL |
| `SAML_WANT_AUTHN_RESPONSE_SIGNED` | `true` | Require signed SAML responses |

### LDAP

| Variable | Default | Description |
|----------|---------|-------------|
| `LDAP_ENABLED` | `false` | Enable LDAP authentication |
| `LDAP_SERVER_URL` | — | LDAP server URL |
| `LDAP_BASE_DN` | — | Base distinguished name |
| `LDAP_BIND_DN` | — | Bind DN for searches |
| `LDAP_BIND_PASSWORD` | — | Bind password |
| `LDAP_USER_SEARCH_FILTER` | — | User search filter |
| `LDAP_USER_SEARCH_BASE` | — | User search base |
| `LDAP_DISPLAY_NAME_ATTR` | — | Display name attribute |
| `LDAP_EMAIL_ATTR` | — | Email attribute |
| `LDAP_UID_ATTR` | — | UID attribute |
| `LDAP_SYNC_ENABLED` | `false` | Enable periodic LDAP sync |
| `LDAP_SYNC_CRON` | `0 */6 * * *` | Sync schedule (every 6 hours) |
| `LDAP_AUTO_PROVISION` | `true` | Auto-create users from LDAP |
| `LDAP_DEFAULT_TENANT_ID` | — | Default tenant for provisioned users |
| `LDAP_STARTTLS` | `false` | Use STARTTLS |

## Email

| Variable | Default | Description |
|----------|---------|-------------|
| `EMAIL_PROVIDER` | `smtp` | Provider: smtp, sendgrid, ses, resend, mailgun |
| `EMAIL_VERIFY_REQUIRED` | `true` | Enforce email verification |
| `SELF_SIGNUP_ENABLED` | `true` | Allow self-registration |
| `SMTP_HOST` | — | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password |
| `SMTP_FROM` | — | From address |
| `SENDGRID_API_KEY` | — | SendGrid API key |
| `RESEND_API_KEY` | — | Resend API key |
| `MAILGUN_API_KEY` | — | Mailgun API key |
| `MAILGUN_DOMAIN` | — | Mailgun domain |

## SMS

| Variable | Default | Description |
|----------|---------|-------------|
| `SMS_PROVIDER` | — | Provider: twilio, sns, vonage (dev: console) |
| `TWILIO_ACCOUNT_SID` | — | Twilio SID |
| `TWILIO_AUTH_TOKEN` | — | Twilio auth token |
| `TWILIO_FROM_NUMBER` | — | Twilio phone number |

## Security & Rate Limiting

| Variable | Default | Description |
|----------|---------|-------------|
| `LOGIN_RATE_LIMIT_WINDOW_MS` | `900000` | Rate limit window (15 min) |
| `LOGIN_RATE_LIMIT_MAX_ATTEMPTS` | `5` | Max login attempts per IP per window |
| `ACCOUNT_LOCKOUT_THRESHOLD` | `10` | Failed logins before lockout |
| `ACCOUNT_LOCKOUT_DURATION_MS` | `1800000` | Lockout duration (30 min) |
| `MAX_CONCURRENT_SESSIONS` | `0` | Per-user session limit (0 = unlimited) |
| `ABSOLUTE_SESSION_TIMEOUT_SECONDS` | `43200` | Absolute timeout (12 hours, 0 = disabled) |
| `ALLOW_LOCAL_NETWORK` | `false` | Allow connections to private networks |
| `ALLOW_EXTERNAL_SHARING` | `false` | Enable cross-tenant sharing |

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

## Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | error, warn, info, verbose, debug |
| `LOG_FORMAT` | `text` | text or json |
| `LOG_TIMESTAMPS` | `true` | ISO-8601 timestamps |
| `LOG_HTTP_REQUESTS` | `false` | Log HTTP requests |
| `LOG_GUACAMOLE` | `true` | Log guacamole-lite tunneling |

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
| Self-signup | `SELF_SIGNUP_ENABLED` env + AppConfig DB | `true` |
| Email verification | `EMAIL_VERIFY_REQUIRED` | `true` |
| Session recording | `RECORDING_ENABLED` | `false` |
| LDAP authentication | `LDAP_ENABLED` | `false` |
| LDAP sync | `LDAP_SYNC_ENABLED` | `false` |
| GeoIP tracking | `GEOIP_DB_PATH` (presence) | Disabled |
| Impossible travel | `IMPOSSIBLE_TRAVEL_SPEED_KMH` > 0 | `900` km/h |
| External sharing | `ALLOW_EXTERNAL_SHARING` | `false` |
| Local network access | `ALLOW_LOCAL_NETWORK` | `false` |
| CLI tool | `CLI_ENABLED` | `false` |
