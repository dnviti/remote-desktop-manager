# Architecture

> Auto-generated on 2026-03-07 by `/docs update architecture`.
> Source of truth is the codebase. Run `/docs update architecture` after code changes.

## System Overview

Arsenale is a **monorepo** using npm workspaces with two packages:

```
arsenale/
├── server/          # Express + TypeScript backend
├── client/          # React 19 + Vite frontend
├── ssh-gateway/     # Optional SSH bastion container
├── package.json     # Root workspace config
├── compose.yml      # Production stack
└── compose.dev.yml  # Dev containers (postgres)
```

<!-- manual-start -->
<!-- manual-end -->

## Server Architecture

**Entry point**: `server/src/index.ts`

The server follows a **layered architecture**:

```
Routes → Controllers → Services → Prisma ORM → PostgreSQL
```

### Startup Sequence

1. Kill stale processes on ports 3001 and 3002
2. Run Prisma database migrations (`prisma migrate deploy`)
3. Run startup data migrations (mark legacy users as email-verified and vault-setup-complete)
4. Recover orphaned sessions from previous server instance
5. Initialize Passport (OAuth strategies)
6. Create HTTP server from Express app
7. Attach Socket.IO (SSH terminal, notifications, gateway monitoring)
8. Initialize session cleanup with Socket.IO reference
9. Start scheduled jobs (SSH key rotation, gateway monitors, cleanup tasks, auto-scaling)
10. Detect container orchestrator (Docker, Podman, Kubernetes, or none)
11. Start Guacamole WebSocket server (`guacamole-lite`) on port 3002
12. Listen on configured port (default 3001)

### Scheduled Jobs

| Job | Interval | Description |
|-----|----------|-------------|
| SSH key rotation | Cron (default `0 2 * * *`) | Rotates gateway SSH key pairs |
| Gateway health monitors | Continuous | Monitors gateway connectivity |
| Managed gateway health check | 30s | Checks managed container instances |
| Managed gateway reconciliation | 5m | Reconciles desired vs actual state |
| Auto-scaling evaluation | 30s | Evaluates scaling rules for managed gateways |
| Expired external share cleanup | 1h | Removes expired public share links |
| Expired refresh token cleanup | 1h | Purges expired refresh tokens from DB |
| Expiring secrets check | 6h | Sends notifications for secrets nearing expiry |
| Idle session marking | 1m | Marks sessions as idle after threshold |
| Inactive session closure | 1m | Closes sessions exceeding inactivity timeout |
| Closed session cleanup | 24h | Purges old closed session records |

### Express App (`server/src/app.ts`)

**Middleware pipeline**:
1. Helmet (CSP, HSTS, frameguard, referrer-policy)
2. Trust proxy (production only)
3. CORS (origin: `CLIENT_URL`, credentials enabled)
4. JSON body parser (500kb limit)
5. Cookie parser
6. Passport initialization (OAuth strategies)
7. Request logger (optional, via `LOG_HTTP_REQUESTS`)
8. Route mounting
9. Error handler

**Route mounting**:

| Base Path | Module | Description |
|-----------|--------|-------------|
| `/api/auth` | `oauth.routes` | OAuth login/callback/link |
| `/api/auth` | `auth.routes` | Local auth (register, login, MFA) |
| `/api/vault` | `vault.routes` | Vault unlock/lock/status |
| `/api/connections` | `connections.routes` | CRUD connections |
| `/api/folders` | `folders.routes` | CRUD folders |
| `/api/connections` | `sharing.routes` | Share/unshare connections |
| `/api/sessions` | `session.routes` | RDP/SSH session tokens, monitoring |
| `/api/user` | `user.routes` | Profile, settings, avatar, identity verification |
| `/api/user/2fa` | `twofa.routes` | TOTP setup/verify |
| `/api/user/2fa/sms` | `smsMfa.routes` | SMS MFA setup/verify |
| `/api/user/2fa/webauthn` | `webauthn.routes` | WebAuthn credential management |
| `/api/files` | `files.routes` | User drive file management |
| `/api/audit` | `audit.routes` | Audit log queries |
| `/api/notifications` | `notification.routes` | Notification management |
| `/api/tenants` | `tenant.routes` | Multi-tenant organization |
| `/api/teams` | `team.routes` | Team management |
| `/api/admin` | `admin.routes` | Admin config, email, self-signup |
| `/api/gateways` | `gateway.routes` | Gateway CRUD, SSH keys, managed instances |
| `/api/tabs` | `tabs.routes` | Tab state persistence |
| `/api/secrets` | `secret.routes` | Vault secret management |
| `/api/share` | `publicShare.routes` | Public external share links |
| `/api` | `health.routes` | Health and readiness probes |

<!-- manual-start -->
<!-- manual-end -->

## Client Architecture

**Tech stack**: React 19, Vite, Material-UI (MUI) v6, Zustand, Axios

### Component Structure

```
client/src/
├── pages/           # Route-level components (9 pages)
├── components/      # UI components grouped by feature
│   ├── Layout/      # MainLayout, NotificationBell
│   ├── Sidebar/     # ConnectionTree, TeamConnectionSection, treeHelpers
│   ├── Tabs/        # TabBar, TabPanel
│   ├── Dialogs/     # ConnectionDialog, ShareDialog, SettingsDialog, AuditLogDialog, etc.
│   ├── Terminal/    # SshTerminal (XTerm.js)
│   ├── RDP/         # RdpViewer (Guacamole), FileBrowser
│   ├── SSH/         # SftpBrowser, SftpTransferQueue
│   ├── Settings/    # Profile, Password, Terminal, RDP, 2FA, SMS, WebAuthn, OAuth, Vault, Gateway, etc.
│   ├── Keychain/    # SecretListPanel, SecretDetailView, SecretDialog, ShareSecretDialog, etc.
│   ├── Overlays/    # VaultLockedOverlay
│   ├── gateway/     # GatewayDialog, GatewayTemplateSection, GatewayTemplateDialog
│   ├── orchestration/ # SessionDashboard, ScalingControls, GatewayInstanceList, etc.
│   ├── common/      # IdentityVerification
│   └── shared/      # FloatingToolbar
├── store/           # 14 Zustand stores
├── hooks/           # useAuth, useSocket, useSftpTransfers, useGatewayMonitor
└── api/             # 23 Axios API modules
```

### State Management

Zustand stores with selective localStorage persistence:
- `authStore` — tokens and user identity (`arsenale-auth`)
- `uiPreferencesStore` — panel states, sidebar, view modes (`arsenale-ui-preferences`)
- `themeStore` — dark/light mode (`arsenale-theme`)
- `terminalSettingsStore` — SSH terminal defaults
- `rdpSettingsStore` — RDP display defaults
- Other stores (connections, vault, tabs, secrets, teams, tenants, gateways, notifications) are session-only

### API Layer

Centralized Axios client (`client/src/api/client.ts`):
- Base URL: `/api`
- Request interceptor: attaches JWT `Authorization: Bearer` header and CSRF token
- Response interceptor: automatic token refresh on 401, then retry

<!-- manual-start -->
<!-- manual-end -->

## Real-Time Connection Flows

### SSH Flow

```
┌──────────┐    Socket.IO /ssh     ┌──────────┐      SSH2       ┌──────────┐
│  Client   │◄────────────────────►│  Server   │◄──────────────►│  Remote  │
│ (XTerm.js)│   session:start      │ (Node.js) │                │  Host    │
│           │   data (bidir)       │           │                │          │
│           │   resize             │           │                │          │
│           │   sftp:* events      │           │                │          │
└──────────┘                       └──────────┘                 └──────────┘
```

1. Client opens SSH tab → connects to Socket.IO `/ssh` namespace with JWT
2. Emits `session:start` with `connectionId` (and optional credential overrides)
3. Server authenticates via JWT middleware, retrieves connection from DB
4. Server decrypts credentials from vault, creates SSH2 connection (direct or via gateway)
5. Bidirectional data flows: `data` events (terminal I/O), `resize` events
6. SFTP operations via `sftp:*` events (list, mkdir, delete, rename, upload, download)

### RDP Flow

```
┌──────────┐    HTTP POST          ┌──────────┐                 ┌──────────┐
│  Client   │───────────────────►  │  Server   │                │  guacd   │
│(Guacamole │  /api/sessions/rdp   │ (Node.js) │                │ (4822)   │
│  Common)  │◄── { token }         │           │                │          │
│           │                      │           │                │          │
│           │    WebSocket :3002   │guacamole- │   Guacamole    │          │
│           │◄────────────────────►│  lite     │◄──────────────►│          │──► Remote
└──────────┘                       └──────────┘                 └──────────┘    Host
```

1. Client requests RDP session via `POST /api/sessions/rdp` with `connectionId`
2. Server decrypts credentials, merges RDP settings (user defaults + connection overrides)
3. Server generates encrypted Guacamole token (AES-256-CBC with `GUACAMOLE_SECRET`)
4. Client connects to Guacamole WebSocket on port 3002 with the token
5. `guacamole-lite` decrypts token, connects to `guacd` daemon
6. `guacd` establishes RDP connection to remote host

### Socket.IO Namespaces

| Namespace | Handler | Purpose |
|-----------|---------|---------|
| `/ssh` | `ssh.handler` | SSH terminal sessions, SFTP operations |
| `/notifications` | `notification.handler` | Real-time notification delivery |
| `/gateway-monitor` | `gatewayMonitor.handler` | Gateway health, instance updates, scaling events |

<!-- manual-start -->
<!-- manual-end -->

## Network Topology

### Development

```
Browser ──► :3000 (Vite dev server)
              ├── /api/* ──────────► :3001 (Express server)
              ├── /socket.io/* ────► :3001 (Socket.IO)
              └── /guacamole/* ────► :3002 (guacamole-lite)

Docker (compose.dev.yml):
  postgres ──► :5432
```

Vite proxies `/api`, `/socket.io`, and `/guacamole` to the server in development. The `guacd` container is commented out in `compose.dev.yml` by default — uncomment it for RDP development.

### Production

```
Browser ──► :3000 (nginx on client container, internal :8080)
              ├── /api/* ──────────► server:3001 (Express)
              ├── /socket.io/* ────► server:3001 (Socket.IO)
              ├── /guacamole/* ────► server:3002 (guacamole-lite)
              ├── /health ──────────► nginx 200 (direct response)
              └── /* ──────────────► static files (SPA fallback)

Docker internal network (arsenale_net):
  postgres (no exposed port)
  guacd (no exposed port)
  server :3001, :3002
  client (nginx) :8080 → mapped to host :3000
  ssh-gateway (optional) :2222
```

### Ports

| Port | Service | Description |
|------|---------|-------------|
| 3000 | Client | Vite dev server / nginx (production, mapped from :8080) |
| 3001 | Server | Express HTTP + Socket.IO |
| 3002 | Server | Guacamole WebSocket (`guacamole-lite`) |
| 4822 | guacd | Guacamole daemon (RDP protocol) |
| 5432 | PostgreSQL | Database |
| 2222 | ssh-gateway | SSH bastion (optional) |

<!-- manual-start -->
<!-- manual-end -->

## Development vs Production

| Aspect | Development | Production |
|--------|-------------|------------|
| **Containers** | postgres only (guacd optional) | postgres + guacd + server + client + ssh-gateway |
| **Server** | `tsx watch` (hot reload) on host | Node.js in Docker container |
| **Client** | Vite dev server on host | nginx serving static build on :8080 |
| **Proxy** | Vite proxy config | nginx reverse proxy |
| **Database** | Exposed on :5432, default credentials | Internal network, env-based credentials |
| **guacd** | Commented out (or exposed on :4822) | Internal network only |
| **Volumes** | `pgdata_dev` named volume | Named volumes (`pgdata`, `arsenale_drive`) |
| **Migrations** | `npm run db:push` (schema sync) | `prisma migrate deploy` on container start |
| **Env file** | `.env` | `.env.prod` |
| **Compose file** | `compose.dev.yml` | `compose.yml` |

<!-- manual-start -->
<!-- manual-end -->
