# Environment Variables

> Auto-generated on 2026-03-07 by `/docs update environment`.
> Source of truth is the codebase. Run `/docs update environment` after code changes.

## Overview

Environment variables are loaded via `dotenv` in `server/src/config.ts`:

```typescript
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
```

The `.env` file lives at the **monorepo root**, not inside `server/`. The Prisma config (`server/prisma.config.ts`) also resolves to `../.env`. Never create a separate `server/.env`.

Source files: `.env.example`, `server/src/config.ts`

<!-- manual-start -->
<!-- manual-end -->

## Variable Reference

### Database

| Variable | Type | Default | Required | Env | Description | Security |
|----------|------|---------|----------|-----|-------------|----------|
| `DATABASE_URL` | string | `postgresql://arsenale:arsenale_password@127.0.0.1:5432/arsenale` | Yes | Both | PostgreSQL connection string | Use strong password in prod |

<!-- manual-start -->
<!-- manual-end -->

### Server

| Variable | Type | Default | Required | Env | Description | Security |
|----------|------|---------|----------|-----|-------------|----------|
| `PORT` | int | `3001` | No | Both | Express HTTP server port | — |
| `GUACAMOLE_WS_PORT` | int | `3002` | No | Both | Guacamole WebSocket port | — |
| `NODE_ENV` | string | `development` | No | Both | Runtime environment | — |
| `CLIENT_URL` | string | `http://localhost:3000` | No | Both | Client URL (email links, OAuth redirects) | — |
| `SERVER_ENCRYPTION_KEY` | string | _(auto-generated in dev)_ | **Prod** | Both | 64-char hex key (32 bytes) for server-side encryption (SSH key pairs, TOTP secrets, vault recovery) | **Must** be stable in prod; data won't survive key changes |

<!-- manual-start -->
<!-- manual-end -->

### Logging

| Variable | Type | Default | Required | Env | Description | Security |
|----------|------|---------|----------|-----|-------------|----------|
| `LOG_LEVEL` | string | `info` | No | Both | Log level (`error`, `warn`, `info`, `verbose`, `debug`) | — |
| `LOG_FORMAT` | string | `text` | No | Both | Log output format (`text` or `json`) | — |
| `LOG_TIMESTAMPS` | bool | `true` | No | Both | Include ISO-8601 timestamps in log output | — |
| `LOG_HTTP_REQUESTS` | bool | `false` | No | Both | Log HTTP requests (method, URL, status, duration) | — |

<!-- manual-start -->
<!-- manual-end -->

### Authentication

| Variable | Type | Default | Required | Env | Description | Security |
|----------|------|---------|----------|-----|-------------|----------|
| `JWT_SECRET` | string | `dev-secret-change-me` | **Prod** | Both | JWT signing secret | **Must** be strong random value in prod (≥32 bytes) |
| `JWT_EXPIRES_IN` | string | `15m` | No | Both | Access token lifetime (ms/s/m/h/d format) | — |
| `JWT_REFRESH_EXPIRES_IN` | string | `7d` | No | Both | Refresh token lifetime | — |
| `EMAIL_VERIFY_REQUIRED` | bool | `true` | No | Both | Require email verification before login | Set to `false` to allow login without verifying |
| `SELF_SIGNUP_ENABLED` | bool | `true` | No | Both | Allow new users to self-register. When `false`, hard-locked at env level (cannot be re-enabled via admin panel) | — |

<!-- manual-start -->
<!-- manual-end -->

### Rate Limiting & Account Lockout

| Variable | Type | Default | Required | Env | Description | Security |
|----------|------|---------|----------|-----|-------------|----------|
| `LOGIN_RATE_LIMIT_WINDOW_MS` | int | `900000` (15 min) | No | Both | Sliding window duration for login rate limiting (ms) | — |
| `LOGIN_RATE_LIMIT_MAX_ATTEMPTS` | int | `5` | No | Both | Max login attempts per IP within the window | — |
| `ACCOUNT_LOCKOUT_THRESHOLD` | int | `10` | No | Both | Consecutive failed logins before account lockout | — |
| `ACCOUNT_LOCKOUT_DURATION_MS` | int | `1800000` (30 min) | No | Both | Account lockout duration (ms) | — |

<!-- manual-start -->
<!-- manual-end -->

### Session Management

| Variable | Type | Default | Required | Env | Description | Security |
|----------|------|---------|----------|-----|-------------|----------|
| `SESSION_HEARTBEAT_INTERVAL_MS` | int | `30000` (30s) | No | Both | Interval for client heartbeat pings (ms) | — |
| `SESSION_IDLE_THRESHOLD_MINUTES` | int | `5` | No | Both | Minutes without heartbeat before session is considered idle | — |
| `SESSION_CLEANUP_RETENTION_DAYS` | int | `30` | No | Both | Days to retain ended session records before cleanup | — |
| `SESSION_INACTIVITY_TIMEOUT_SECONDS` | int | `3600` (1 hour) | No | Both | Seconds of inactivity before automatic session disconnect | — |

<!-- manual-start -->
<!-- manual-end -->

### Guacamole

| Variable | Type | Default | Required | Env | Description | Security |
|----------|------|---------|----------|-----|-------------|----------|
| `GUACD_HOST` | string | `localhost` | No | Both | Guacamole daemon host (use `guacd` in Docker) | — |
| `GUACD_PORT` | int | `4822` | No | Both | Guacamole daemon port | — |
| `GUACAMOLE_SECRET` | string | `dev-guac-secret` | **Prod** | Both | Guacamole token encryption key | **Must** be strong random value in prod |

<!-- manual-start -->
<!-- manual-end -->

### Vault

| Variable | Type | Default | Required | Env | Description | Security |
|----------|------|---------|----------|-----|-------------|----------|
| `VAULT_TTL_MINUTES` | int | `30` | No | Both | Vault session TTL in minutes (0 = never expire) | Lower = more secure, less convenient |

<!-- manual-start -->
<!-- manual-end -->

### File Storage

| Variable | Type | Default | Required | Env | Description | Security |
|----------|------|---------|----------|-----|-------------|----------|
| `DRIVE_BASE_PATH` | string | `./data/drive` | No | Both | Base path for RDP drive redirection files | Must be shared between server and guacd |
| `FILE_UPLOAD_MAX_SIZE` | int | `10485760` (10 MB) | No | Both | Max file upload size in bytes | — |
| `USER_DRIVE_QUOTA` | int | `104857600` (100 MB) | No | Both | Per-user drive storage quota in bytes | — |
| `SFTP_MAX_FILE_SIZE` | int | `104857600` (100 MB) | No | Both | Max SFTP transfer file size in bytes | — |
| `SFTP_CHUNK_SIZE` | int | `65536` (64 KB) | No | Both | SFTP transfer chunk size in bytes | — |

<!-- manual-start -->
<!-- manual-end -->

### Email Provider

| Variable | Type | Default | Required | Env | Description | Security |
|----------|------|---------|----------|-----|-------------|----------|
| `EMAIL_PROVIDER` | string | `smtp` | No | Both | Email provider: `smtp`, `sendgrid`, `ses`, `resend`, `mailgun` | — |

**Dev mode**: Leave `EMAIL_PROVIDER=smtp` with `SMTP_HOST` empty. Verification links will be logged to the console.

#### SMTP

| Variable | Type | Default | Required | Env | Description | Security |
|----------|------|---------|----------|-----|-------------|----------|
| `SMTP_HOST` | string | _(empty)_ | If smtp | Prod | SMTP server hostname | — |
| `SMTP_PORT` | int | `587` | No | Prod | SMTP port | — |
| `SMTP_USER` | string | _(empty)_ | If smtp | Prod | SMTP username | Credential |
| `SMTP_PASS` | string | _(empty)_ | If smtp | Prod | SMTP password | **Credential** |
| `SMTP_FROM` | string | `noreply@example.com` | No | Both | Sender email address | — |

#### SendGrid

| Variable | Type | Default | Required | Env | Description | Security |
|----------|------|---------|----------|-----|-------------|----------|
| `SENDGRID_API_KEY` | string | _(empty)_ | If sendgrid | Prod | SendGrid API key | **Credential** |

#### Amazon SES

| Variable | Type | Default | Required | Env | Description | Security |
|----------|------|---------|----------|-----|-------------|----------|
| `AWS_SES_REGION` | string | `us-east-1` | No | Prod | AWS SES region | — |
| `AWS_SES_ACCESS_KEY_ID` | string | _(empty)_ | Optional | Prod | AWS access key (empty = IAM role/default chain) | **Credential** |
| `AWS_SES_SECRET_ACCESS_KEY` | string | _(empty)_ | Optional | Prod | AWS secret key | **Credential** |

#### Resend

| Variable | Type | Default | Required | Env | Description | Security |
|----------|------|---------|----------|-----|-------------|----------|
| `RESEND_API_KEY` | string | _(empty)_ | If resend | Prod | Resend API key | **Credential** |

#### Mailgun

| Variable | Type | Default | Required | Env | Description | Security |
|----------|------|---------|----------|-----|-------------|----------|
| `MAILGUN_API_KEY` | string | _(empty)_ | If mailgun | Prod | Mailgun API key | **Credential** |
| `MAILGUN_DOMAIN` | string | _(empty)_ | If mailgun | Prod | Mailgun domain | — |
| `MAILGUN_REGION` | string | `us` | No | Prod | Mailgun region (`us` or `eu`) | — |

<!-- manual-start -->
<!-- manual-end -->

### SMS Provider

| Variable | Type | Default | Required | Env | Description | Security |
|----------|------|---------|----------|-----|-------------|----------|
| `SMS_PROVIDER` | string | _(empty)_ | No | Both | SMS provider: `twilio`, `sns`, `vonage` (empty = dev mode, logs to console) | — |

#### Twilio

| Variable | Type | Default | Required | Env | Description | Security |
|----------|------|---------|----------|-----|-------------|----------|
| `TWILIO_ACCOUNT_SID` | string | _(empty)_ | If twilio | Prod | Twilio account SID | **Credential** |
| `TWILIO_AUTH_TOKEN` | string | _(empty)_ | If twilio | Prod | Twilio auth token | **Credential** |
| `TWILIO_FROM_NUMBER` | string | _(empty)_ | If twilio | Prod | Twilio sender phone number | — |

#### AWS SNS

| Variable | Type | Default | Required | Env | Description | Security |
|----------|------|---------|----------|-----|-------------|----------|
| `AWS_SNS_REGION` | string | `us-east-1` | No | Prod | AWS SNS region | — |
| `AWS_SNS_ACCESS_KEY_ID` | string | _(empty)_ | Optional | Prod | AWS access key (empty = IAM role) | **Credential** |
| `AWS_SNS_SECRET_ACCESS_KEY` | string | _(empty)_ | Optional | Prod | AWS secret key | **Credential** |

#### Vonage

| Variable | Type | Default | Required | Env | Description | Security |
|----------|------|---------|----------|-----|-------------|----------|
| `VONAGE_API_KEY` | string | _(empty)_ | If vonage | Prod | Vonage API key | **Credential** |
| `VONAGE_API_SECRET` | string | _(empty)_ | If vonage | Prod | Vonage API secret | **Credential** |
| `VONAGE_FROM_NUMBER` | string | _(empty)_ | If vonage | Prod | Vonage sender number | — |

<!-- manual-start -->
<!-- manual-end -->

### OAuth

Leave `CLIENT_ID` empty to disable a provider. Each provider is independently optional.

#### Google

| Variable | Type | Default | Required | Env | Description | Security |
|----------|------|---------|----------|-----|-------------|----------|
| `GOOGLE_CLIENT_ID` | string | _(empty)_ | No | Both | Google OAuth client ID | — |
| `GOOGLE_CLIENT_SECRET` | string | _(empty)_ | If enabled | Both | Google OAuth client secret | **Credential** |
| `GOOGLE_CALLBACK_URL` | string | `http://localhost:3001/api/auth/google/callback` | No | Both | OAuth callback URL | Update for production domain |

#### Microsoft

| Variable | Type | Default | Required | Env | Description | Security |
|----------|------|---------|----------|-----|-------------|----------|
| `MICROSOFT_CLIENT_ID` | string | _(empty)_ | No | Both | Microsoft OAuth client ID | — |
| `MICROSOFT_CLIENT_SECRET` | string | _(empty)_ | If enabled | Both | Microsoft OAuth client secret | **Credential** |
| `MICROSOFT_CALLBACK_URL` | string | `http://localhost:3001/api/auth/microsoft/callback` | No | Both | OAuth callback URL | Update for production domain |

#### GitHub

| Variable | Type | Default | Required | Env | Description | Security |
|----------|------|---------|----------|-----|-------------|----------|
| `GITHUB_CLIENT_ID` | string | _(empty)_ | No | Both | GitHub OAuth client ID | — |
| `GITHUB_CLIENT_SECRET` | string | _(empty)_ | If enabled | Both | GitHub OAuth client secret | **Credential** |
| `GITHUB_CALLBACK_URL` | string | `http://localhost:3001/api/auth/github/callback` | No | Both | OAuth callback URL | Update for production domain |

#### Generic OIDC

Compatible with any OIDC-compliant IdP: Authentik, Keycloak, Authelia, Zitadel, etc. Leave `OIDC_CLIENT_ID` empty to disable.

| Variable | Type | Default | Required | Env | Description | Security |
|----------|------|---------|----------|-----|-------------|----------|
| `OIDC_PROVIDER_NAME` | string | `SSO` | No | Both | Display name shown on the login button | — |
| `OIDC_ISSUER_URL` | string | _(empty)_ | If enabled | Both | OIDC issuer URL (used for discovery) | — |
| `OIDC_CLIENT_ID` | string | _(empty)_ | No | Both | OIDC client ID | — |
| `OIDC_CLIENT_SECRET` | string | _(empty)_ | If enabled | Both | OIDC client secret | **Credential** |
| `OIDC_CALLBACK_URL` | string | `http://localhost:3001/api/auth/oidc/callback` | No | Both | OAuth callback URL | Update for production domain |
| `OIDC_SCOPES` | string | `openid profile email` | No | Both | Space-separated OIDC scopes to request | — |

#### SAML 2.0

Compatible with any SAML 2.0 IdP: Azure AD/Entra ID, Okta, OneLogin, ADFS, Keycloak, Authentik, FreeIPA. Leave `SAML_ENTRY_POINT` empty to disable.

| Variable | Type | Default | Required | Env | Description | Security |
|----------|------|---------|----------|-----|-------------|----------|
| `SAML_PROVIDER_NAME` | string | `SAML SSO` | No | Both | Display name shown on the login button | — |
| `SAML_ENTRY_POINT` | string | _(empty)_ | No | Both | IdP SSO URL (enables SAML when set) | — |
| `SAML_ISSUER` | string | `arsenale` | No | Both | Service provider entity ID | — |
| `SAML_CALLBACK_URL` | string | `http://localhost:3001/api/auth/saml/callback` | No | Both | Assertion consumer service URL | Update for production domain |
| `SAML_CERT` | string | _(empty)_ | If enabled | Both | IdP X.509 certificate (PEM, single line) | — |
| `SAML_METADATA_URL` | string | _(empty)_ | Optional | Both | IdP metadata URL for automatic configuration | — |
| `SAML_WANT_AUTHN_RESPONSE_SIGNED` | bool | `true` | No | Both | Require signed SAML responses | Do not disable in production |

<!-- manual-start -->
<!-- manual-end -->

### WebAuthn / Passkeys (FIDO2)

| Variable | Type | Default | Required | Env | Description | Security |
|----------|------|---------|----------|-----|-------------|----------|
| `WEBAUTHN_RP_ID` | string | `localhost` | No | Both | Relying party identifier (usually the domain name, e.g., `example.com`) | **Must** match production domain |
| `WEBAUTHN_RP_ORIGIN` | string | `http://localhost:3000` | No | Both | Exact origin expected by the browser (scheme + domain + port) | **Must** match production URL |
| `WEBAUTHN_RP_NAME` | string | `Arsenale` | No | Both | Human-readable name shown in browser/authenticator prompts | — |

<!-- manual-start -->
<!-- manual-end -->

### SSH Gateway

| Variable | Type | Default | Required | Env | Description | Security |
|----------|------|---------|----------|-----|-------------|----------|
| `SSH_GATEWAY_PORT` | int | `2222` | No | Prod | Port exposed by the ssh-gateway container | — |
| `SSH_AUTHORIZED_KEYS` | string | _(empty)_ | No | Prod | Public keys authorized to connect (newline-separated), or mount `/config/authorized_keys` | — |
| `GATEWAY_API_TOKEN` | string | _(empty)_ | No | Prod | Shared secret between server and gateway container for automated key push. Empty = sidecar API disabled. | **Credential** |

<!-- manual-start -->
<!-- manual-end -->

### SSH Key Rotation

| Variable | Type | Default | Required | Env | Description | Security |
|----------|------|---------|----------|-----|-------------|----------|
| `KEY_ROTATION_CRON` | string | `0 2 * * *` | No | Both | Cron expression for the key rotation check job (default: daily at 02:00 UTC) | — |
| `KEY_ROTATION_ADVANCE_DAYS` | int | `7` | No | Both | Days before expiration to trigger rotation | — |

<!-- manual-start -->
<!-- manual-end -->

### Container Orchestrator

| Variable | Type | Default | Required | Env | Description | Security |
|----------|------|---------|----------|-----|-------------|----------|
| `ORCHESTRATOR_TYPE` | string | _(empty)_ | No | Both | Provider type: `docker`, `podman`, `kubernetes`, `none` (empty = auto-detect) | — |
| `DOCKER_SOCKET_PATH` | string | `/var/run/docker.sock` | No | Both | Docker daemon socket path | — |
| `PODMAN_SOCKET_PATH` | string | `$XDG_RUNTIME_DIR/podman/podman.sock` | No | Both | Podman socket path (rootless default; `/run/podman/podman.sock` for rootful) | — |
| `DOCKER_NETWORK` | string | _(empty)_ | No | Both | Container network for managed gateways. Set to `arsenale-dev` for Docker dev mode. Empty = host-mode port mapping. | — |
| `ORCHESTRATOR_K8S_NAMESPACE` | string | `arsenale` | No | Both | Kubernetes namespace for managed gateways. Per-tenant namespaces (`arsenale-{tenantId}`) are auto-created. | — |
| `ORCHESTRATOR_SSH_GATEWAY_IMAGE` | string | `ghcr.io/dnviti/arsenale/ssh-gateway:latest` | No | Both | Container image for managed SSH gateway instances | — |
| `ORCHESTRATOR_GUACD_IMAGE` | string | `guacamole/guacd:latest` | No | Both | Container image for managed guacd instances | — |

<!-- manual-start -->
<!-- manual-end -->

### Docker-Specific Variables

These are used by `compose.yml` (production) and are not consumed by the application directly:

| Variable | Type | Default | Required | Env | Description | Security |
|----------|------|---------|----------|-----|-------------|----------|
| `POSTGRES_USER` | string | `arsenale` | No | Prod | PostgreSQL superuser name | — |
| `POSTGRES_PASSWORD` | string | — | **Yes** | Prod | PostgreSQL superuser password | **Must** be strong random value |
| `POSTGRES_DB` | string | `arsenale` | No | Prod | Database name | — |

<!-- manual-start -->
<!-- manual-end -->

## Development Defaults

For development, copy `.env.example` to `.env`. All defaults are functional:

- Database connects to Docker PostgreSQL at `127.0.0.1:5432`
- JWT uses a placeholder secret (fine for local dev)
- `SERVER_ENCRYPTION_KEY` is auto-generated on startup (SSH keys won't survive restarts)
- Email verification links are logged to console (no SMTP needed)
- SMS OTP codes are logged to console (no SMS provider needed)
- OAuth, OIDC, and SAML are disabled by default (empty client IDs)
- Self-signup is enabled; email verification is required
- Vault TTL is 30 minutes
- Orchestrator auto-detects Docker or Podman
- WebAuthn uses `localhost` defaults

## Production Configuration

For production, copy `.env.example` to `.env.prod` and fill in:

1. **Mandatory secrets** — generate with `openssl rand -base64 32`:
   - `POSTGRES_PASSWORD`
   - `JWT_SECRET`
   - `GUACAMOLE_SECRET`
   - `SERVER_ENCRYPTION_KEY` — generate 64-char hex: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

2. **Email provider** — configure at least one for email verification to work:
   - Set `EMAIL_PROVIDER` and the corresponding credentials
   - Set `SMTP_FROM` to your domain's email address

3. **OAuth / SSO** (optional) — for each provider you want:
   - Set `CLIENT_ID` and `CLIENT_SECRET`
   - Update `CALLBACK_URL` to your production domain
   - For OIDC: set `OIDC_ISSUER_URL`
   - For SAML: set `SAML_ENTRY_POINT` and `SAML_CERT`

4. **SMS MFA** (optional) — configure if you want SMS-based MFA:
   - Set `SMS_PROVIDER` and the corresponding credentials

5. **WebAuthn** — set `WEBAUTHN_RP_ID` and `WEBAUTHN_RP_ORIGIN` to match your production domain

6. **CLIENT_URL** — set to your production domain (used in email links and OAuth redirects)

7. **Rate limiting** — adjust `LOGIN_RATE_LIMIT_*` and `ACCOUNT_LOCKOUT_*` for your environment

<!-- manual-start -->
<!-- manual-end -->
