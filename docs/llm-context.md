---
title: LLM Context
description: Consolidated single-file context for LLM and bot consumption
generated-by: ctdf-docs
generated-at: 2026-03-21T22:40:00Z
source-files:
  - README.md
  - CLAUDE.md
  - server/src/index.ts
  - server/src/app.ts
  - server/prisma/schema.prisma
  - client/src/App.tsx
  - client/vite.config.ts
  - server/src/services/keystrokeInspection.service.ts
  - server/src/services/checkout.service.ts
  - server/src/config/passport.ts
  - server/src/routes/systemSettings.routes.ts
  - server/src/routes/setup.routes.ts
  - tools/arsenale-cli/main.go
---

# Arsenale — LLM Context

## Project Summary

Arsenale is a web-based remote access management platform for SSH, RDP, and VNC connections. Monorepo with npm workspaces: `server/` (Express + TypeScript + Prisma), `client/` (React 19 + Vite + MUI v7), `gateways/tunnel-agent/`, `extra-clients/browser-extensions/`.

**Stack:** Node.js 22, PostgreSQL 16, Socket.IO, XTerm.js, guacamole-common-js, Zustand, Docker/Podman/Kubernetes.

---

## Architecture Overview

**Server (Express on :3001):** Layered architecture — Routes → Controllers → Services → Prisma ORM. 43 route files under `/api`. Socket.IO for SSH terminals (`/ssh`) and notifications (`/notifications`). Guacamole WebSocket on :3002 for RDP/VNC. Raw WebSocket tunnel broker on `/api/tunnel/connect`. Middleware stack includes Helmet, CORS, CSRF (double-submit cookies with exemptions for login, register, OAuth code exchange), peekAuth (lightweight JWT extraction for rate-limit keying), and global rate limiting with CIDR whitelist.

**New in 1.7.0:** Database Protocol Gateway (Oracle/MSSQL/DB2), web-based SQL client, database query auditing with SQL firewall, SSH keystroke inspection (real-time command blocking/alerting), credential checkout/check-in (PAM), automatic password rotation, lateral movement anomaly detection, pwned password checks, RD Gateway (MS-TSGU) for native RDP clients, SSH proxy for native SSH clients, Arsenale Connect CLI for native client orchestration via RFC 8628 device auth, startup configuration wizard (`/api/setup`), system settings admin panel (`/api/admin/system-settings`), and OAuth domain/tenant filtering (`GOOGLE_HD`, `MICROSOFT_TENANT_ID`).

**Client (Vite on :3000):** React 19 SPA. 15 Zustand stores. Full-screen MUI Dialog pattern for overlays (preserves active sessions). 6 themes × 2 modes. PWA with Workbox.

**Database:** PostgreSQL 16 with 32 Prisma models. Key models: User, Tenant, Connection, VaultSecret, Gateway, ActiveSession, AuditLog, AccessPolicy.

**Gateways:** guacd (RDP/VNC protocol), SSH Gateway (bastion), guacenc (recording processor), Tunnel Agent (zero-trust outbound tunnel).

---

## Key Commands

```bash
npm run predev && npm run dev   # Full dev setup
npm run dev:server              # Express on :3001
npm run dev:client              # Vite on :3000
npm run verify                  # typecheck → lint → audit → test → build
npm run db:generate             # Regenerate Prisma client
npm run db:push                 # Sync schema to DB
npm run docker:dev              # Start PostgreSQL + guacenc
npm run build                   # Build all workspaces
```

---

## API Structure

All endpoints under `/api`. JWT Bearer authentication. Zod validation on request bodies.

**Core endpoints:** `/api/auth` (login, register, MFA, OAuth, SAML, refresh), `/api/vault` (unlock/lock, MFA unlock), `/api/connections` (CRUD, sharing, import/export), `/api/sessions` (RDP/VNC/SSH lifecycle), `/api/secrets` (CRUD, versioning, sharing, external links), `/api/user` (profile, 2FA, WebAuthn, domain profile).

**Multi-tenant:** `/api/tenants` (CRUD, members, IP allowlist), `/api/teams` (CRUD, member roles), `/api/access-policies` (ABAC).

**Infrastructure:** `/api/gateways` (CRUD, deploy, scale, tunnel, SSH keys, templates), `/api/recordings` (playback, export), `/api/audit` (user, tenant, connection logs).

**Integrations:** `/api/vault-providers` (HashiCorp Vault), `/api/sync-profiles` (NetBox), `/api/ldap` (LDAP sync).

**WebSocket:** Socket.IO `/ssh` (terminal), `/notifications` (real-time events), `/gateways` (health monitoring). Raw WS `/api/tunnel/connect` (tunnel broker with binary multiplexed protocol).

---

## Security

- **Encryption:** AES-256-GCM for all credentials, secrets, TOTP seeds. Master key derived from password via Argon2id.
- **Auth:** JWT access tokens (15 min) + refresh tokens (7 days, DB-stored, family tracking). Token binding (IP + User-Agent).
- **MFA:** TOTP, SMS (Twilio/SNS/Vonage), WebAuthn/FIDO2.
- **SSO:** Google, Microsoft, GitHub OAuth. Any OIDC provider. SAML 2.0. LDAP.
- **RBAC:** 7 tenant roles (OWNER→GUEST), 3 team roles. ABAC policies with time windows, trusted device, MFA step-up.
- **Audit:** 100+ action types, GeoIP, impossible travel detection.
- **DLP:** Per-tenant/connection copy, paste, upload, download controls.

---

## Configuration

Single `.env` file at monorepo root. Key categories:

- **Database:** `DATABASE_URL`
- **Secrets:** `JWT_SECRET`, `GUACAMOLE_SECRET`, `SERVER_ENCRYPTION_KEY`
- **Vault:** `VAULT_TTL_MINUTES` (30)
- **OAuth:** `GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_HD` (domain restriction), `MICROSOFT_CLIENT_ID/SECRET`, `MICROSOFT_TENANT_ID` (default: `common`), `GITHUB_CLIENT_ID/SECRET`
- **OIDC/SAML/LDAP:** Full provider configuration
- **Email:** `EMAIL_PROVIDER` (smtp/sendgrid/ses/resend/mailgun)
- **SMS:** `SMS_PROVIDER` (twilio/sns/vonage)
- **Orchestration:** `ORCHESTRATOR_TYPE` (docker/podman/kubernetes/none)
- **Recording:** `RECORDING_ENABLED`, `RECORDING_PATH`
- **Defaults (simplified first-run):** `SELF_SIGNUP_ENABLED` (`false`), `EMAIL_VERIFY_REQUIRED` (`false`), `ALLOW_LOCAL_NETWORK` (`true`)
- **Security:** Rate limits, account lockout, session timeouts, WebAuthn RP config

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

- **Full-screen Dialog pattern** for overlays (not routes) — preserves active sessions
- **`extractApiError(err, fallback)`** for API error handling in catch blocks
- **`useAsyncAction`** hook for dialog form submissions with loading/error state
- **`uiPreferencesStore`** for all persistent UI layout state (never raw localStorage)
- **Vault must be unlocked** to access encrypted credentials
- **`npm run verify`** must pass before closing any task
- **Migrations run automatically** on server start — no manual migrate needed
