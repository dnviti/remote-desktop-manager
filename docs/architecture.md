# Architecture

> Auto-generated on 2026-03-15 by `/docs create architecture`.
> Source of truth is the codebase. Run `/docs update architecture` after code changes.

## System Overview

Arsenale is a **monorepo** managed by npm workspaces with two packages:

```
arsenale/
├── server/          # Express + TypeScript backend (workspace: "server")
├── client/          # React 19 + Vite frontend (workspace: "client")
├── ssh-gateway/     # Optional SSH gateway container
├── docker/          # Docker build contexts (guacenc sidecar)
├── compose.yml      # Production Docker Compose
├── compose.dev.yml  # Development Docker Compose (PostgreSQL + guacenc)
├── package.json     # Root workspace config + shared scripts
└── .env             # Environment variables (root level, shared by all)
```

The root `package.json` defines both workspaces and orchestration scripts (`dev`, `build`, `verify`, `docker:dev`, etc.). All environment variables are loaded from the root `.env` file; the server's `prisma.config.ts` resolves the path to `../.env` explicitly.

<!-- manual-start -->
<!-- manual-end -->

## Server Architecture

### Entry Point

`server/src/index.ts` is the main entry point. On startup it:

1. Kills stale processes on ports 3001 and 3002 (dev hot-reload safety)
2. Runs `prisma migrate deploy` to apply pending database migrations
3. Runs startup data migrations (email verification backfill, vault setup backfill)
4. Recovers orphaned sessions from a previous server instance
5. Initializes GeoIP database (MaxMind GeoLite2, optional)
6. Initializes Passport.js strategies (OAuth, SAML)
7. Creates the HTTP server and attaches Socket.IO (SSH, notifications, gateway monitor)
8. Starts scheduled background jobs:
   - SSH key rotation (cron-based)
   - LDAP sync (cron-based)
   - Membership expiry check (cron-based)
   - External sync profile jobs (cron-based, e.g. NetBox)
   - Gateway health monitoring
   - Managed gateway health check (30s) and reconciliation (5m)
   - Auto-scaling evaluation (30s)
   - Expired external share cleanup (hourly)
   - Expired refresh token cleanup (hourly)
   - Absolute-timeout token family cleanup (every 5m)
   - Secret expiry check (every 6 hours)
   - Idle session marking (every minute)
   - Inactive session closure (every minute)
   - Old closed session cleanup (daily)
   - Expired recording cleanup (daily)
9. Starts the Guacamole WebSocket server (guacamole-lite) on port 3002 for RDP/VNC
10. Listens on port 3001

### Layered Pattern

```
Routes → Controllers → Services → Prisma ORM
```

| Layer | Location | Responsibility |
|-------|----------|---------------|
| **Routes** | `server/src/routes/*.routes.ts` | URL path definitions, middleware chaining, rate limiters |
| **Controllers** | `server/src/controllers/*.controller.ts` | Request parsing, Zod validation, response formatting |
| **Schemas** | `server/src/schemas/*.schemas.ts` | Zod validation schemas shared by controllers and services |
| **Services** | `server/src/services/*.service.ts` | Business logic, database queries, encryption, external integrations |
| **ORM** | `server/src/lib/prisma.ts` + `server/prisma/schema.prisma` | Prisma Client for PostgreSQL |
| **Middleware** | `server/src/middleware/*.middleware.ts` | JWT auth, tenant/team RBAC, CSRF, rate limiting, error handling |
| **Orchestrator** | `server/src/orchestrator/*.ts` | Container orchestration providers (Docker, Podman, Kubernetes, none) |
| **Sync Engine** | `server/src/sync/*.ts` | External data-source sync (engine + providers, e.g. NetBox) |
| **CLI** | `server/src/cli/` | Admin CLI with 12 command groups (user, tenant, gateway, secret, session, etc.) |

### Middleware Pipeline

The Express app (`server/src/app.ts`) applies middleware in this order:

1. **Helmet** — security headers (CSP, HSTS, frame-guard, referrer-policy)
2. **Trust Proxy** — configurable via `TRUST_PROXY` env var
3. **CORS** — restricted to `CLIENT_URL` origin with credentials
4. **JSON body parser** — 500KB limit
5. **Cookie parser** — for refresh token cookies
6. **Passport** — initialized for OAuth/SAML strategies
7. **Request logger** — optional HTTP request logging
8. **Route handlers** — 30 route groups mounted under `/api/*`
9. **Error handler** — centralized error response formatting

### Socket.IO Namespaces

| Namespace | Handler File | Purpose |
|-----------|-------------|---------|
| `/ssh` | `server/src/socket/ssh.handler.ts` | SSH terminal sessions + SFTP file operations |
| `/notifications` | `server/src/socket/notification.handler.ts` | Real-time notification delivery |
| `/gateway-monitor` | `server/src/socket/gatewayMonitor.handler.ts` | Real-time gateway health + instance updates |

All Socket.IO namespaces authenticate via JWT middleware using the `auth.token` handshake parameter.

<!-- manual-start -->
<!-- manual-end -->

## Client Architecture

### Tech Stack

- **React 19** with TypeScript
- **Vite** — dev server (port 3000) with proxy to backend
- **Material-UI (MUI) v7** — component library
- **Zustand** — state management (14 stores)
- **Axios** — HTTP client with automatic JWT refresh
- **Socket.IO Client** — real-time SSH terminals, notifications, gateway monitoring
- **XTerm.js** — SSH terminal rendering
- **guacamole-common-js** — RDP/VNC rendering via Guacamole protocol

### Component Tree

```
App
├── LoginPage / RegisterPage / ForgotPasswordPage / ResetPasswordPage
├── OAuthCallbackPage / VaultSetupPage
├── PublicSharePage
├── DashboardPage
│   └── MainLayout
│       ├── Sidebar
│       │   ├── ConnectionTree (folders, favorites, recents, shared)
│       │   ├── TeamConnectionSection
│       │   └── TenantSwitcher
│       ├── TabBar
│       ├── TabPanel
│       │   ├── SshTerminal + SftpBrowser + SftpTransferQueue
│       │   ├── RdpViewer + FileBrowser
│       │   └── VncViewer
│       ├── DockedToolbar (over active RDP/VNC)
│       ├── ReconnectOverlay
│       ├── VaultLockedOverlay
│       ├── NotificationBell
│       └── Full-Screen Dialogs (rendered at root)
│           ├── SettingsDialog (23 settings sections)
│           ├── AuditLogDialog / ConnectionAuditLogDialog
│           ├── KeychainDialog (secrets manager)
│           ├── RecordingsDialog
│           ├── ConnectionDialog / FolderDialog
│           ├── ShareDialog / ShareFolderDialog
│           ├── ImportDialog / ExportDialog
│           ├── ConnectAsDialog / UserProfileDialog
│           ├── CreateUserDialog / InviteDialog
│           ├── TeamDialog
│           └── GatewayDialog / GatewayTemplateDialog
├── ConnectionViewerPage (standalone popup)
└── RecordingPlayerPage (standalone popup)
```

### State Management

14 Zustand stores handle all client-side state:

| Store | Purpose |
|-------|---------|
| `authStore` | JWT tokens, CSRF, user identity, tenant context |
| `connectionsStore` | Connections, folders (own, shared, team) |
| `tabsStore` | Open tabs with server-side persistence |
| `vaultStore` | Vault lock status, MFA unlock availability |
| `uiPreferencesStore` | Persistent UI layout preferences (localStorage) |
| `tenantStore` | Tenant details, user management, memberships |
| `gatewayStore` | Gateways, SSH keys, sessions, orchestration |
| `teamStore` | Teams, members, roles |
| `secretStore` | Vault secrets, sharing, tenant vault |
| `themeStore` | Light/dark mode toggle |
| `rdpSettingsStore` | User's default RDP settings |
| `terminalSettingsStore` | User's default SSH terminal settings |
| `notificationStore` | Toast notifications (ephemeral) |
| `notificationListStore` | Persistent notifications from server |

### API Layer

29 API modules in `client/src/api/` (28 endpoint modules + `client.ts`) provide typed Axios wrappers for every server endpoint. The central `client.ts` configures:

- Automatic `Authorization: Bearer <jwt>` header injection
- CSRF token injection for auth-sensitive endpoints (refresh, logout, tenant-switch)
- Automatic 401 retry with token refresh (single-flight pattern to prevent stampede)

<!-- manual-start -->
<!-- manual-end -->

## Real-Time Connection Flows

### SSH Flow

```
Client                    Server                     Target Host
  │                         │                            │
  ├─ Tab open ──────────────►                            │
  │                         │                            │
  ├─ Socket.IO /ssh ────────►                            │
  │  (JWT in handshake)     │                            │
  │                         ├─ session:start ────────────►
  │                         │  (SSH2 connection,         │
  │                         │   optional bastion hop)    │
  │                         │                            │
  │  ◄── session:ready ─────┤                            │
  │                         │                            │
  │  ── data (keystrokes) ──►  ── stream.write ──────────►
  │  ◄── data (output) ─────  ◄── stream.on('data') ────┤
  │                         │                            │
  │  ── resize ─────────────►  ── pty resize ────────────►
  │                         │                            │
  │  ── sftp:* events ──────►  ── SFTP subsystem ────────►
  │                         │                            │
  │  ── disconnect ─────────►  ── client.end() ──────────►
```

- Terminal rendered with **XTerm.js** (configurable theme, font, cursor style)
- SFTP file browser uses the same SSH connection's SFTP subsystem
- Session heartbeats sent every 30s (implicit on keystroke, explicit from client)
- Optional **asciicast recording** when `RECORDING_ENABLED=true`
- Bastion/gateway routing: SSH_BASTION (user credentials) or MANAGED_SSH (server-managed keys)
- Load balancing across managed gateway instances (round-robin or least-connections)

### RDP/VNC Flow

```
Client                    Server :3001              guacamole-lite :3002     guacd :4822
  │                         │                            │                      │
  ├─ POST /sessions/rdp ───►                             │                      │
  │  (connectionId)         │                            │                      │
  │                         ├─ encrypt token ────────────►                      │
  │  ◄── { token, wsUrl } ──┤  (AES-256-GCM)            │                      │
  │                         │                            │                      │
  ├─ WebSocket /guacamole ──────────────────────────────►│                      │
  │  (encrypted token)      │                            ├─ Guacamole proto ───►│
  │                         │                            │  (connect to target) │
  │  ◄── Guacamole frames ──────────────────────────────┤◄─────────────────────┤
  │  ── Guacamole input ────────────────────────────────►├──────────────────────►
```

- Rendered with **guacamole-common-js** (canvas-based)
- Clipboard sync, drive redirection, audio, and display settings configurable per connection
- Guacamole token encrypted with AES-256-GCM using `GUACAMOLE_SECRET`
- Optional `.guac` format recording when `RECORDING_ENABLED=true`
- Same gateway routing and load balancing as SSH (for managed guacd instances)

<!-- manual-start -->
<!-- manual-end -->

## Network Topology

### Development

| Service | Port | Protocol |
|---------|------|----------|
| Vite dev server | 3000 | HTTP (proxies `/api` → 3001, `/socket.io` → 3001, `/guacamole` → 3002) |
| Express server | 3001 | HTTP + WebSocket (Socket.IO) |
| guacamole-lite | 3002 | WebSocket (Guacamole protocol) |
| PostgreSQL | 5432 | TCP (Docker, bound to 127.0.0.1) |
| guacd | 4822 | TCP (Guacamole daemon, local or Docker) |
| guacenc sidecar | 3003 | HTTP (video conversion service, Docker) |

In development, the Vite dev server handles all proxying. The server and client run as separate Node.js processes outside Docker, while PostgreSQL and guacenc run inside Docker via `compose.dev.yml`.

### Production

| Service | Port | Protocol |
|---------|------|----------|
| Nginx (client container) | 8080 (mapped to host 3000) | HTTP |
| Express (server container) | 3001 | HTTP + WebSocket (internal) |
| guacamole-lite | 3002 | WebSocket (internal) |
| PostgreSQL | 5432 | TCP (internal) |
| guacd | 4822 | TCP (internal) |
| guacenc | 3003 | HTTP (internal) |

In production, all services communicate over the `arsenale_net` Docker network. Only the Nginx client container exposes port 8080 to the host. Nginx reverse-proxies:

| Path | Upstream |
|------|----------|
| `/api/*` | `http://server:3001` |
| `/socket.io/*` | `http://server:3001` (WebSocket upgrade) |
| `/guacamole/*` | `http://server:3002` (WebSocket upgrade, 24h timeout) |
| `/health` | Local 200 response |
| `/*` | SPA fallback to `index.html` |

<!-- manual-start -->
<!-- manual-end -->

## Development vs Production

| Aspect | Development | Production |
|--------|------------|------------|
| **Server** | `tsx watch` (hot reload) | Compiled JS via `tsc`, runs `node dist/index.js` |
| **Client** | Vite dev server with HMR | Static build served by Nginx |
| **Database** | PostgreSQL in Docker (`compose.dev.yml`) | PostgreSQL in Docker (`compose.yml`) |
| **guacd** | Local install or Docker | Docker container in compose stack |
| **Proxy** | Vite dev server proxy | Nginx reverse proxy |
| **Auth secrets** | Dev defaults auto-generated | Required via environment variables |
| **SERVER_ENCRYPTION_KEY** | Auto-generated (not persisted) | Required (64 hex chars) |
| **Containers** | Only PostgreSQL + guacenc | Full stack (5+ containers) |
| **Container runtime** | Docker or Podman | Docker or Podman (rootless supported) |
| **Network** | Host networking + port mapping | Internal Docker network (`arsenale_net`) |

<!-- manual-start -->
<!-- manual-end -->
