# Deployment

> Auto-generated on 2026-03-07 by `/docs update deployment`.
> Source of truth is the codebase. Run `/docs update deployment` after code changes.

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 22.x | Server and client builds |
| npm | 10.x+ | Package management (workspaces) |
| Docker or Podman | 20.x+ / 4.x+ | Container runtime |
| Docker/Podman Compose | v2 | Multi-container orchestration |

<!-- manual-start -->
<!-- manual-end -->

## Development Setup

### 1. Clone and Install

```bash
git clone https://github.com/dnviti/arsenale.git
cd arsenale
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Default values work out of the box for development. Key defaults:

| Variable | Default | Notes |
|----------|---------|-------|
| `DATABASE_URL` | `postgresql://arsenale:arsenale_password@127.0.0.1:5432/arsenale` | Uses `127.0.0.1` (not `localhost`) to avoid IPv6 issues on Windows |
| `JWT_SECRET` | `change-me-in-production` | Fine for development |
| `GUACD_HOST` | `localhost` | Docker-exposed guacd (if running) |
| `EMAIL_PROVIDER` | `smtp` | With empty `SMTP_HOST`, verification links are logged to console |
| `SMS_PROVIDER` | _(empty)_ | OTP codes logged to console in dev mode |

### 3. Start Development

```bash
npm run predev && npm run dev
```

The `predev` script handles:
1. Auto-detects container runtime (Docker or Podman) via `scripts/container-runtime.sh`
2. Starts PostgreSQL via `compose.dev.yml` and waits for health check
3. Generates Prisma client types

The `dev` script starts server (:3001) and client (:3000, waits for server health) concurrently.

### Development Docker Containers

| Service | Image | Exposed Port | Purpose |
|---------|-------|-------------|---------|
| postgres | `postgres:16` | 5432 | Database (user: `arsenale`, password: `arsenale_password`) |

guacd is commented out in `compose.dev.yml` by default. Uncomment it if you need RDP development.

Data persistence: PostgreSQL uses named volume `pgdata_dev`.

### Full Docker Dev Mode

For running everything in containers (server + client + postgres):

```bash
npm run dev:docker        # Interactive mode
npm run dev:docker:detach # Detached mode
```

<!-- manual-start -->
<!-- manual-end -->

## Production Deployment

### 1. Configure Secrets

```bash
cp .env.example .env.prod
```

Generate strong secrets:

```bash
openssl rand -base64 32  # For JWT_SECRET
openssl rand -base64 32  # For GUACAMOLE_SECRET
openssl rand -base64 32  # For POSTGRES_PASSWORD
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # For SERVER_ENCRYPTION_KEY
```

Required production variables:

| Variable | Description |
|----------|-------------|
| `POSTGRES_PASSWORD` | PostgreSQL database password |
| `JWT_SECRET` | JWT signing secret (≥32 bytes) |
| `GUACAMOLE_SECRET` | Guacamole token encryption key |
| `SERVER_ENCRYPTION_KEY` | 64-char hex key for server-side encryption |
| `VAULT_TTL_MINUTES` | Vault session TTL (default: 30) |
| `CLIENT_URL` | Public URL of the client (for email links and OAuth redirects) |

### 2. Deploy with Docker Compose

```bash
# Auto-detects Docker or Podman
$(./scripts/container-runtime.sh) compose --env-file .env.prod up -d --build
```

### Production Docker Topology

```
┌──────────────────────────────────────────────────────┐
│                 Docker Network (arsenale_net)          │
│                                                       │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐         │
│  │ postgres │   │  guacd   │   │  server  │         │
│  │ (PG 16)  │   │          │   │ :3001    │         │
│  │          │◄──┤          │◄──┤ :3002    │         │
│  │ internal │   │ internal │   │ internal │         │
│  └──────────┘   └──────────┘   └──────────┘         │
│       ▲                              ▲                │
│       │ healthcheck                  │                │
│       │                              │                │
│  ┌───────────────────────────────────────────┐       │
│  │              client (nginx)               │       │
│  │              :8080 → host :3000           │       │
│  └───────────────────────────────────────────┘       │
│                                                       │
│  ┌──────────┐  (optional)                            │
│  │ssh-gateway│                                       │
│  │  :2222   │                                        │
│  └──────────┘                                        │
└──────────────────────────────────────────────────────┘
```

| Service | Image | Ports | Dependencies |
|---------|-------|-------|-------------|
| postgres | `postgres:16` | Internal only | — |
| guacd | `guacamole/guacd` | Internal only | — |
| server | Custom (`server/Dockerfile`) | Internal (3001, 3002) | postgres (healthy), guacd (healthy) |
| client | Custom (`client/Dockerfile`) | 3000:8080 | server (healthy) |
| ssh-gateway | Custom (`ssh-gateway/Dockerfile`) | Configurable | — |

### Service Details

**postgres**:
- Health check: `pg_isready` every 5s with 5 retries
- Volume: `pgdata` (named, persistent)
- Environment from `.env.prod`

**guacd**:
- Health check: `nc -z localhost 4822` every 10s with 3 retries
- Volume: `arsenale_drive` (shared with server for drive redirection)

**server**:
- Built from `server/Dockerfile` (Node 22 Alpine)
- Runs as non-root user (`appuser`)
- Runs `prisma migrate deploy` on startup, then `node dist/index.js`
- Health check: `wget -qO- http://localhost:3001/api/health` with 30s start period
- Volume: `arsenale_drive` at `/guacd-drive`, Podman socket for managed gateways

**client**:
- Multi-stage build: Node 22 Alpine (build) → Alpine 3.21 with nginx (runtime)
- Runs as non-root user (`nginx`)
- Serves Vite build from `/usr/share/nginx/html` on port 8080
- Health check: `wget -qO- http://localhost:8080/` with 5s start period

**ssh-gateway** (optional):
- SSH bastion container for tunneled connections
- Configurable SSH port (default: 2222)
- Authorized keys mounted from `config/ssh-gateway/authorized_keys`

### Volume Management

| Volume | Mount Point | Purpose |
|--------|-------------|---------|
| `pgdata` | `/var/lib/postgresql/data` | PostgreSQL data persistence |
| `arsenale_drive` | `/guacd-drive` (server + guacd) | RDP drive redirection file storage |

<!-- manual-start -->
<!-- manual-end -->

## Nginx Configuration

Production nginx (`client/nginx.conf`) handles reverse proxying:

| Location | Target | Notes |
|----------|--------|-------|
| `/api` | `http://server:3001` | REST API + WebSocket upgrade support |
| `/socket.io` | `http://server:3001` | Socket.IO (SSH terminals, notifications, gateway monitor) |
| `/guacamole` | `http://server:3002/` | Guacamole WebSocket (24h timeout) |
| `/health` | Direct nginx response | Returns `{"status":"ok"}` (no proxy) |
| `/` | Static files | SPA fallback (`try_files $uri $uri/ /index.html`) |

All proxy locations include WebSocket upgrade headers (`Upgrade`, `Connection`). The `/guacamole` location has extended timeouts (86400s) for long-lived RDP sessions.

<!-- manual-start -->
<!-- manual-end -->

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run predev` | Start dev containers (postgres), generate Prisma client |
| `npm run dev` | Run server and client concurrently (hot reload) |
| `npm run dev:server` | Run server only (tsx watch on :3001) |
| `npm run dev:client` | Run client only (Vite on :3000) |
| `npm run dev:docker` | Full Docker dev mode (server + client + postgres) |
| `npm run dev:docker:detach` | Docker dev mode in background |
| `npm run build` | Build both server (tsc) and client (vite build) |
| `npm run docker:dev` | Start dev Docker containers |
| `npm run docker:dev:down` | Stop dev Docker containers |
| `npm run docker:prod` | Build and start production stack |
| `npm run db:generate` | Generate Prisma client types |
| `npm run db:push` | Sync Prisma schema to DB (no migration) |
| `npm run db:migrate` | Run Prisma migrations |
| `npm run typecheck` | TypeScript type-check (both workspaces) |
| `npm run lint` | ESLint check |
| `npm run lint:fix` | ESLint with auto-fix |
| `npm run sast` | npm audit (dependency vulnerability scan) |
| `npm run security` | Full security scan (SAST + dependency check) |
| `npm run security:quick` | Quick security scan |
| `npm run security:docker` | Security scan for Docker images |
| `npm run verify` | Full pipeline: typecheck → lint → audit → build |

<!-- manual-start -->
<!-- manual-end -->

## Troubleshooting

### IPv6 / localhost on Windows

PostgreSQL connection may fail with `localhost` on Windows due to IPv6 resolution. Use `127.0.0.1` instead:

```
DATABASE_URL=postgresql://arsenale:arsenale_password@127.0.0.1:5432/arsenale
```

### Docker Networking

- In development, postgres exposes port 5432 to the host. The server runs on the host and connects to `127.0.0.1:5432`.
- In production, services communicate via Docker internal DNS names (`postgres`, `guacd`, `server`) on the `arsenale_net` network. Only the client port (3000→8080) is exposed to the host.

### guacamole-lite Not Available

If `guacamole-lite` fails to load (native dependency issues), the server logs a warning and continues. RDP connections won't work, but SSH remains functional.

### Database Migrations

- Development: `npm run db:push` syncs schema directly (no migration files)
- Production: `prisma migrate deploy` runs on container startup. Create migrations with `npm run db:migrate` before deploying.

### Container Runtime Detection

The `predev` script auto-detects Docker or Podman via `scripts/container-runtime.sh`. If detection fails, set the `CONTAINER_RUNTIME` environment variable to `docker` or `podman`.

<!-- manual-start -->
<!-- manual-end -->
