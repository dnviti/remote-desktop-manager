---
title: LLM Context
description: Consolidated single-file context for LLM and bot consumption
generated-by: claw-docs
generated-at: 2026-03-27T12:00:00Z
source-files:
  - CLAUDE.md
  - README.md
  - server/src/index.ts
  - server/src/app.ts
  - server/src/config.ts
  - server/prisma/schema.prisma
  - client/vite.config.ts
  - package.json
---

# Arsenale - LLM Context Document

## Project Summary

Arsenale is a secure remote access platform (version 1.7.1, BUSL-1.1 license) providing SSH, RDP, VNC, and database proxy access through a unified web interface. It is a TypeScript monorepo with npm workspaces.

## Architecture

**Monorepo workspaces:** server (Express 5), client (React 19 + Vite + MUI v7), tunnel-agent (Node.js), browser-extension (Chrome MV3).

**Server layers:** Routes -> Controllers -> Services -> Prisma ORM (PostgreSQL 16).

**Real-time:** Socket.IO for SSH terminal I/O, notifications, and gateway monitoring. Guacamole-lite WebSocket (port 3002) for RDP/VNC via guacd.

**Distributed:** GoCacheKV (Go, gRPC) provides KV store, PubSub, and leader election for multi-instance deployments.

**Security:** JWT (15-min access, 7-day refresh with family rotation), Argon2 password hashing, AES-256-GCM vault encryption, mTLS on all internal connections, CSRF double-submit cookies, three-tiered rate limiting.

## Key Files

| File | Purpose |
|------|---------|
| `server/src/index.ts` | Server entry: migrations, TLS, Socket.IO, guacamole-lite, cron jobs |
| `server/src/app.ts` | Express middleware pipeline and route registration (40+ route modules) |
| `server/src/config.ts` | 120+ environment variables with defaults |
| `server/prisma/schema.prisma` | 32+ Prisma models (1535 lines) |
| `client/src/store/` | 17 Zustand stores |
| `client/src/api/` | 29 API client modules (Axios with JWT interceptor) |
| `client/src/components/` | 122 React components |

## API Overview

200+ REST endpoints under `/api`. Key domains:

- `/api/auth` - Login, register, OAuth, SAML, MFA (TOTP, WebAuthn, SMS)
- `/api/vault` - Unlock/lock/recover encrypted vault
- `/api/secret` - Keychain CRUD (LOGIN, SSH_KEY, CERTIFICATE, API_KEY, SECURE_NOTE)
- `/api/connections` - SSH/RDP/VNC/DATABASE connection CRUD
- `/api/session` - Create/manage remote sessions
- `/api/gateway` - Gateway CRUD, SSH key management, auto-scaling, tunnels
- `/api/tenant` - Multi-tenancy, user management, permissions
- `/api/team` - Team CRUD, membership roles
- `/api/audit` - Audit log queries (70+ action types)
- `/api/recording` - Session recording playback and video export
- `/api/db-proxy` - Database proxy sessions and SQL execution
- `/api/health` / `/api/ready` - Health and readiness checks

## Database Models

Key entities: User, Tenant, TenantMember, Team, TeamMember, Connection, Folder, VaultSecret, VaultSecretVersion, ActiveSession, SessionRecording, Gateway, ManagedGatewayInstance, SshKeyPair, RefreshToken, OAuthAccount, WebAuthnCredential, AuditLog, SecretCheckoutRequest, SyncProfile, ExternalVaultProvider.

**Role hierarchy:** GUEST(0.1) < AUDITOR(0.3) < CONSULTANT(0.5) < MEMBER(1) < OPERATOR(2) < ADMIN(3) < OWNER(4).

**Team roles:** TEAM_VIEWER < TEAM_EDITOR < TEAM_ADMIN.

## Configuration

120+ env vars organized by domain. Key categories:

- **Server**: PORT (3001), GUACAMOLE_WS_PORT (3002), CLIENT_URL
- **Auth**: JWT_SECRET, JWT_EXPIRES_IN (15m), TOKEN_BINDING_ENABLED (true)
- **OAuth**: GOOGLE/MICROSOFT/GITHUB/OIDC/SAML client credentials
- **LDAP**: LDAP_ENABLED, LDAP_SERVER_URL, LDAP_SYNC_CRON
- **Database**: DATABASE_URL, DB_QUERY_TIMEOUT_MS (30s), DB_POOL_MAX_CONNECTIONS (3)
- **Cache**: CACHE_SIDECAR_ENABLED (true), CACHE_KV_URL, CACHE_PUBSUB_URL + mTLS certs
- **Security**: ACCOUNT_LOCKOUT_THRESHOLD (10), LATERAL_MOVEMENT_DETECTION_ENABLED (true)
- **Features**: FEATURE_DATABASE_PROXY_ENABLED, FEATURE_CONNECTIONS_ENABLED, FEATURE_KEYCHAIN_ENABLED

## Deployment

Ansible-based (same playbook for dev and prod). Container runtime: Podman or Docker. All containers rootless.

**Services:** server, client (Nginx), PostgreSQL 16, guacd, guacenc, gocache-cache, gocache-pubsub, ssh-gateway.

**Networks:** 5 isolated networks (proxy-net, arsenale-front-net, arsenale-back-net, cache, net-db).

**Secrets:** Ansible Vault -> Podman secrets -> mounted at /run/secrets/ (read-only).

**CI/CD:** GitHub Actions for build/scan (CodeQL, Trivy), multi-arch images (amd64/arm64), ghcr.io registry.

## Development Commands

```bash
make setup              # First-time: Ansible, vault, certs
npm run dev             # Server (:3001) + Client (:3000)
npm run verify          # typecheck -> lint -> audit -> test -> build
npm run db:migrate      # Create and apply migrations
make dev                # Start infrastructure containers
make deploy             # Production deployment
```

## Middleware Pipeline (Order)

Helmet -> Trust Proxy -> Host Validation -> CORS -> Body Parser -> Cookie Parser -> Passport -> Request Logger -> CSRF -> Global Rate Limit -> Feature Gates -> Route Middleware -> Handler -> Error Handler.

## Scheduled Jobs

Key rotation (2 AM daily), LDAP sync (6h), membership expiry (hourly), session cleanup (hourly), recording cleanup (daily), gateway health (30s), auto-scaling (30s), token cleanup (hourly).

## Client State Management

17 Zustand stores: authStore, connectionsStore, tabsStore, vaultStore, secretStore, gatewayStore, teamStore, tenantStore, notificationListStore, notificationStore, uiPreferencesStore, themeStore, accessPolicyStore, rdpSettingsStore, terminalSettingsStore, checkoutStore, featureFlagsStore.

## Key Patterns

- **Access tokens in-memory only** (never localStorage)
- **Axios interceptor** auto-refreshes on 401
- **Full-screen Dialog** for overlays (preserves SSH/RDP sessions)
- **UI preferences** via uiPreferencesStore (Zustand + localStorage)
- **Config strategy**: env var set = used as-is (UI read-only), env var unset = UI editable
- **Logging security**: sanitize sensitive keys, redact JWTs, strip newlines
- **Rootless containers**: non-root users, high ports (>1024), Podman-compatible
