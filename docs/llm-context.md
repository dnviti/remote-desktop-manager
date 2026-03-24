---
title: LLM Context
description: Consolidated single-file context for LLM and bot consumption
generated-by: ctdf-docs
generated-at: 2026-03-24T23:40:00Z
source-files:
  - README.md
  - CLAUDE.md
  - server/src/index.ts
  - server/src/app.ts
  - server/src/config.ts
  - server/prisma/schema.prisma
  - client/src/App.tsx
  - client/vite.config.ts
---

# Arsenale -- LLM Context

## Project Summary

Arsenale is a web-based remote access management platform for SSH, RDP, VNC, and database connections. Monorepo with npm workspaces: `server/` (Express + TypeScript + Prisma), `client/` (React 19 + Vite + MUI v7), `gateways/tunnel-agent/`, `extra-clients/browser-extensions/`.

**Stack:** Node.js 22, PostgreSQL 16, Socket.IO, XTerm.js, guacamole-common-js, Zustand, Docker/Podman/Kubernetes.

**Version:** 1.7.1

---

## Architecture Overview

**Server (Express on :3001):** Layered architecture -- Routes -> Controllers -> Services -> Prisma ORM. 43 route files under `/api`. Socket.IO for SSH terminals (`/ssh`) and notifications (`/notifications`). Guacamole WebSocket on :3002 for RDP/VNC. Raw WebSocket tunnel broker on `/api/tunnel/connect`. Middleware stack includes Helmet, CORS, CSRF (double-submit cookies with exemptions for login, register, OAuth code exchange), peekAuth (lightweight JWT extraction for rate-limit keying), and global rate limiting with CIDR whitelist. Feature gate middleware for database proxy, connections, and keychain subsystems.

**Client (Vite on :3000):** React 19 SPA. 17 Zustand stores. 37 API modules. Full-screen MUI Dialog pattern for overlays (preserves active sessions). 6 themes x 2 modes. PWA with Workbox.

**Database:** PostgreSQL 16 with 42 Prisma models. Key models: User, Tenant, Connection, VaultSecret, Gateway, ActiveSession, AuditLog, AccessPolicy.

**Gateways:** guacd (RDP/VNC protocol), SSH Gateway (bastion), guacenc (recording processor), Tunnel Agent (zero-trust outbound tunnel).

**Browser Extension:** Chrome Manifest V3. Service worker for API calls (bypasses CORS), React popup for account switching and keychain browsing, content scripts for credential autofill.

---

## Key Commands

```bash
npm run predev && npm run dev   # Full dev setup (Docker + Prisma + server + client)
npm run dev:server              # Express on :3001 (tsx watch, hot reload)
npm run dev:client              # Vite on :3000 (proxies /api -> :3001)
npm run verify                  # typecheck -> lint -> audit -> build
npm run db:generate             # Regenerate Prisma client
npm run db:push                 # Sync schema to DB (no migration)
npm run db:migrate              # Run Prisma migrations
npm run docker:dev              # Start PostgreSQL + guacenc containers
npm run docker:dev:down         # Stop dev containers
npm run docker:prod             # Full production stack
npm run build                   # Build all workspaces
npm run typecheck               # TypeScript type-check (both workspaces)
npm run lint                    # ESLint (both workspaces)
npm run sast                    # npm audit (dependency scan)
npm run codeql                  # Local CodeQL security scan
```

---

## API Structure

All endpoints under `/api`. JWT Bearer authentication. Zod validation on request bodies. CSRF double-submit cookie protection for state-changing requests.

### Core

| Mount | Routes file | Purpose |
|-------|-------------|---------|
| `/api/auth` | `auth.routes.ts` | Login, register, MFA verification, refresh, forgot/reset password |
| `/api/auth` | `oauth.routes.ts` | Google, Microsoft, GitHub OAuth flows + code exchange |
| `/api/auth/saml` | `saml.routes.ts` | SAML 2.0 SSO |
| `/api/vault` | `vault.routes.ts` | Unlock/lock vault, MFA unlock |
| `/api/connections` | `connections.routes.ts` | CRUD, import/export (feature-gated) |
| `/api/connections` | `sharing.routes.ts` | Share connections with users |
| `/api/connections` | `importExport.routes.ts` | Bulk import/export |
| `/api/folders` | `folders.routes.ts` | Hierarchical folder tree |
| `/api/sessions` | `session.routes.ts` | RDP/VNC/SSH session lifecycle |
| `/api/sessions/ssh-proxy` | `sshProxy.routes.ts` | SSH proxy token management |
| `/api/sessions/db-tunnel` | `dbTunnel.routes.ts` | Database SSH tunnel sessions |
| `/api/sessions/database` | `dbProxy.routes.ts` | Web SQL client proxy (feature-gated) |

### User & Auth

| Mount | Routes file | Purpose |
|-------|-------------|---------|
| `/api/user` | `user.routes.ts` | Profile, preferences, domain credentials |
| `/api/user/2fa` | `twofa.routes.ts` | TOTP setup and verification |
| `/api/user/2fa/sms` | `smsMfa.routes.ts` | SMS OTP (Twilio/SNS/Vonage) |
| `/api/user/2fa/webauthn` | `webauthn.routes.ts` | FIDO2/WebAuthn passkeys |

### Secrets & Keychain

| Mount | Routes file | Purpose |
|-------|-------------|---------|
| `/api/secrets` | `secret.routes.ts` | CRUD, versioning, sharing, external links (feature-gated) |
| `/api/secrets` | `passwordRotation.routes.ts` | Automatic credential rotation |
| `/api/vault-folders` | `vault-folders.routes.ts` | Secrets folder organization (feature-gated) |
| `/api/share` | `publicShare.routes.ts` | Public/external share links |
| `/api/vault-providers` | `externalVault.routes.ts` | HashiCorp Vault KV v2 integration |

### Multi-Tenant & Teams

| Mount | Routes file | Purpose |
|-------|-------------|---------|
| `/api/tenants` | `tenant.routes.ts` | Tenant CRUD, members, IP allowlist |
| `/api/teams` | `team.routes.ts` | Team CRUD, member roles |
| `/api/access-policies` | `accessPolicy.routes.ts` | ABAC policies with time windows |
| `/api/checkouts` | `checkout.routes.ts` | Credential checkout/check-in (PAM) |

### Infrastructure & Monitoring

| Mount | Routes file | Purpose |
|-------|-------------|---------|
| `/api/gateways` | `gateway.routes.ts` | Gateway CRUD, deploy, scale, tunnel, SSH keys |
| `/api/recordings` | `recording.routes.ts` | Session playback and video export |
| `/api/audit` | `audit.routes.ts` | Audit logs (user, tenant, connection) |
| `/api/geoip` | `geoip.routes.ts` | IP geolocation lookups |
| `/api/notifications` | `notification.routes.ts` | In-app notifications |
| `/api/db-audit` | `dbAudit.routes.ts` | Database query audit (feature-gated) |
| `/api/keystroke-policies` | `keystrokePolicy.routes.ts` | SSH command block/alert policies |

### Admin & System

| Mount | Routes file | Purpose |
|-------|-------------|---------|
| `/api/admin` | `admin.routes.ts` | Admin operations |
| `/api/admin/system-settings` | `systemSettings.routes.ts` | Runtime system configuration |
| `/api/setup` | `setup.routes.ts` | Startup configuration wizard |
| `/api/cli` | `cli.routes.ts` | CLI device auth (RFC 8628) |
| `/api/rdgw` | `rdGateway.routes.ts` | RD Gateway (MS-TSGU) for native RDP |
| `/api/ai` | `aiQuery.routes.ts` | AI-assisted SQL generation (feature-gated) |
| `/api` | `health.routes.ts` | Health and readiness probes |

### Integrations

| Mount | Routes file | Purpose |
|-------|-------------|---------|
| `/api/ldap` | `ldap.routes.ts` | LDAP sync and authentication |
| `/api/sync-profiles` | `sync.routes.ts` | NetBox connection sync |

### WebSocket Namespaces

| Namespace | Purpose |
|-----------|---------|
| Socket.IO `/ssh` | Terminal I/O for SSH sessions |
| Socket.IO `/notifications` | Real-time event notifications |
| Socket.IO `/gateways` | Gateway health monitoring |
| Raw WS `/api/tunnel/connect` | Tunnel broker (binary multiplexed protocol) |
| Guacamole WS `:3002` | RDP/VNC protocol tunnel |

---

## Security

- **Encryption:** AES-256-GCM for all credentials, secrets, TOTP seeds. Master key derived from password via Argon2id.
- **Auth:** JWT access tokens (15 min) + refresh tokens (7 days, DB-stored, family tracking). Token binding (IP + User-Agent).
- **MFA:** TOTP, SMS (Twilio/SNS/Vonage), WebAuthn/FIDO2.
- **SSO:** Google, Microsoft, GitHub OAuth. Any OIDC provider. SAML 2.0. LDAP (with sync and auto-provisioning).
- **RBAC:** 7 tenant roles (OWNER -> GUEST), 3 team roles. ABAC policies with time windows, trusted device, MFA step-up.
- **Audit:** 100+ action types, GeoIP, impossible travel detection, lateral movement anomaly detection (MITRE T1021).
- **DLP:** Per-tenant/connection copy, paste, upload, download controls.
- **CSRF:** Double-submit cookie with exempt paths for login/register/OAuth.
- **Rate Limiting:** Global rate limiter with CIDR whitelist, per-route rate limiters for login, vault, sessions, OAuth.
- **Logging:** Sensitive data never logged in clear text. Logger sanitizes passwords, tokens, error objects.

---

## Configuration Reference

Single `.env` file at monorepo root. Key categories:

### Core

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://...@127.0.0.1:5432/arsenale` | PostgreSQL connection string |
| `PORT` | `3001` | Express server port |
| `GUACAMOLE_WS_PORT` | `3002` | Guacamole WebSocket port |
| `NODE_ENV` | `development` | Environment mode |
| `CLIENT_URL` | `http://localhost:3000` | Client URL (CORS, OAuth, emails) |
| `TRUST_PROXY` | `false` | Reverse proxy trust depth |

### Secrets

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | `dev-secret-change-me` | JWT signing key (**must be strong in production**) |
| `JWT_EXPIRES_IN` | `15m` | Access token TTL |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | Refresh token TTL |
| `GUACAMOLE_SECRET` | `dev-guac-secret` | Guacamole encryption key |
| `SERVER_ENCRYPTION_KEY` | Auto-generated | 32-byte hex (64 chars) for server-level encryption |

### Vault

| Variable | Default | Description |
|----------|---------|-------------|
| `VAULT_TTL_MINUTES` | `30` | Vault session auto-lock timeout |

### OAuth / SSO

| Variable | Default | Description |
|----------|---------|-------------|
| `GOOGLE_CLIENT_ID/SECRET` | -- | Google OAuth |
| `GOOGLE_HD` | -- | Google domain restriction |
| `MICROSOFT_CLIENT_ID/SECRET` | -- | Microsoft OAuth |
| `MICROSOFT_TENANT_ID` | `common` | Azure AD tenant filter |
| `GITHUB_CLIENT_ID/SECRET` | -- | GitHub OAuth |
| `OIDC_CLIENT_ID/SECRET/ISSUER_URL` | -- | Generic OIDC provider |
| `SAML_ENTRY_POINT/ISSUER/CERT` | -- | SAML 2.0 |

### LDAP

| Variable | Default | Description |
|----------|---------|-------------|
| `LDAP_ENABLED` | `false` | Enable LDAP authentication |
| `LDAP_SERVER_URL` | -- | LDAP server URL |
| `LDAP_BASE_DN` | -- | Base distinguished name |
| `LDAP_SYNC_ENABLED` | `false` | Periodic user sync |
| `LDAP_SYNC_CRON` | `0 */6 * * *` | Sync schedule |

### Email & SMS

| Variable | Default | Description |
|----------|---------|-------------|
| `EMAIL_PROVIDER` | `smtp` | smtp, sendgrid, ses, resend, mailgun |
| `SMS_PROVIDER` | -- | twilio, sns, vonage |

### Infrastructure

| Variable | Default | Description |
|----------|---------|-------------|
| `ORCHESTRATOR_TYPE` | -- | docker, podman, kubernetes, none |
| `RECORDING_ENABLED` | `false` | Enable session recording |
| `RECORDING_PATH` | `/recordings` | Recording storage path |

### Security

| Variable | Default | Description |
|----------|---------|-------------|
| `LOGIN_RATE_LIMIT_MAX_ATTEMPTS` | `5` | Login attempts per window |
| `ACCOUNT_LOCKOUT_THRESHOLD` | `10` | Failed attempts before lockout |
| `MAX_CONCURRENT_SESSIONS` | `0` (unlimited) | Per-user session limit |
| `ABSOLUTE_SESSION_TIMEOUT_SECONDS` | `43200` (12h) | Hard session timeout |
| `TOKEN_BINDING_ENABLED` | `true` | Bind JWT to IP + User-Agent |
| `LATERAL_MOVEMENT_DETECTION_ENABLED` | `true` | MITRE T1021 anomaly detection |
| `ALLOW_LOCAL_NETWORK` | `true` | Allow private IP connections |
| `ALLOW_LOOPBACK` | `false` | Allow localhost connections |

### Database Proxy

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_QUERY_TIMEOUT_MS` | `30000` | SQL query timeout |
| `DB_QUERY_MAX_ROWS` | `10000` | Max result rows |
| `DB_POOL_MAX_CONNECTIONS` | `3` | Connection pool size |

### SSH Proxy

| Variable | Default | Description |
|----------|---------|-------------|
| `SSH_PROXY_ENABLED` | `false` | Enable SSH protocol proxy |
| `SSH_PROXY_PORT` | `2222` | SSH proxy listen port |

### AI Integration

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_PROVIDER` | -- | anthropic, openai, ollama, openai-compatible |
| `AI_API_KEY` | -- | Provider API key |
| `AI_MODEL` | -- | Model identifier |
| `AI_QUERY_GENERATION_ENABLED` | `false` | Natural language to SQL |

### Feature Toggles

| Variable | Default | Description |
|----------|---------|-------------|
| `FEATURE_DATABASE_PROXY_ENABLED` | `true` | Database SQL proxy subsystem |
| `FEATURE_CONNECTIONS_ENABLED` | `true` | Connection management subsystem |
| `FEATURE_KEYCHAIN_ENABLED` | `true` | Secrets keychain subsystem |

### Defaults (simplified first-run)

| Variable | Default | Description |
|----------|---------|-------------|
| `SELF_SIGNUP_ENABLED` | `false` | Allow public registration |
| `EMAIL_VERIFY_REQUIRED` | `false` | Require email verification |

---

## File Naming

| Layer | Pattern | Example |
|-------|---------|---------|
| Routes | `*.routes.ts` | `auth.routes.ts` |
| Controllers | `*.controller.ts` | `connection.controller.ts` |
| Services | `*.service.ts` | `encryption.service.ts` |
| Middleware | `*.middleware.ts` | `auth.middleware.ts` |
| Stores | `*Store.ts` | `authStore.ts` |
| API (client) | `*.api.ts` | `connections.api.ts` |
| Hooks | `use*.ts` | `useAuth.ts` |

---

## Development Patterns

- **Full-screen Dialog pattern** for overlays (not routes) -- preserves active sessions
- **`extractApiError(err, fallback)`** for API error handling in catch blocks
- **`useAsyncAction`** hook for dialog form submissions with loading/error state
- **`uiPreferencesStore`** for all persistent UI layout state (never raw localStorage)
- **Vault must be unlocked** to access encrypted credentials
- **`npm run verify`** must pass before closing any task
- **Migrations run automatically** on server start -- no manual migrate needed
- **Env vars override UI settings** -- config.ts is the single source of truth
- **Feature gates** -- `requireFeature()` middleware disables route groups at runtime
- **No clear-text logging** -- logger sanitizes all sensitive data; never pass raw error objects
