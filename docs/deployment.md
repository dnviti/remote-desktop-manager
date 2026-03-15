# Deployment

> Auto-generated on 2026-03-15 by `/docs create deployment`.
> Source of truth is the codebase. Run `/docs update deployment` after code changes.

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js | 22+ (Alpine image used in Docker) |
| npm | 9+ (ships with Node 22) |
| Docker or Podman | Recent version with Compose V2 (auto-detected via `scripts/container-runtime.sh`) |
| PostgreSQL | 16 (provided via Docker) |

<!-- manual-start -->
<!-- manual-end -->

## Development Setup

### Step 1: Clone and install

```bash
git clone <repository-url>
cd arsenale
npm install
```

### Step 2: Configure environment

```bash
cp .env.example .env
# Edit .env as needed (defaults work for local development)
```

The `.env` file lives at the **monorepo root** (not inside `server/`). All services read from this single file.

### Step 3: Start Docker containers

```bash
npm run docker:dev
# Starts: PostgreSQL (port 5432) + guacenc sidecar (port 3003)
# guacd must be installed locally or uncommented in compose.dev.yml
# Note: `npm run predev` only starts postgres and generates Prisma client
```

### Step 4: Start development server

```bash
npm run predev   # Starts PostgreSQL container + generates Prisma client
npm run dev      # Runs server (port 3001) + client (port 3000) concurrently
```

Or use the combined command:

```bash
npm run predev && npm run dev
```

Database migrations run automatically when the server starts — no manual migrate command needed.

### Development URLs

| Service | URL |
|---------|-----|
| Client (Vite) | http://localhost:3000 |
| Server (Express) | http://localhost:3001 |
| Guacamole WS | ws://localhost:3002 |

Vite proxies `/api` to `:3001`, `/socket.io` to `:3001`, and `/guacamole` to `:3002`.

<!-- manual-start -->
<!-- manual-end -->

## Production Deployment

### Environment Configuration

```bash
cp .env.production.example .env.production
# The `npm run docker:prod` script uses .env.production.
# The compose.yml references .env.prod — use a symlink or rename as needed.
# Fill in production secrets:
#   POSTGRES_PASSWORD — strong random password
#   JWT_SECRET — openssl rand -base64 32
#   GUACAMOLE_SECRET — openssl rand -base64 32
#   SERVER_ENCRYPTION_KEY — openssl rand -hex 32
#   VAULT_TTL_MINUTES — vault session timeout
```

### Docker Compose Topology

The production stack (`compose.yml`) runs 5-6 containers on the `arsenale_net` network:

| Container | Image | Ports (internal) | Purpose |
|-----------|-------|------------------|---------|
| `postgres` | `postgres:16` | 5432 | PostgreSQL database |
| `guacd` | `guacamole/guacd:1.6.0` | 4822 | Guacamole daemon (RDP/VNC proxy) |
| `guacenc` | Custom build (`docker/guacenc`) | 3003 | Recording-to-video conversion sidecar |
| `server` | Custom build (`server/Dockerfile`) | 3001, 3002 | Express API + guacamole-lite WS |
| `client` | Custom build (`client/Dockerfile`) | 8080 | Nginx serving React SPA + reverse proxy |
| `ssh-gateway` | Custom build (`ssh-gateway/Dockerfile`) | 2222 | Optional SSH gateway |

### Service Dependencies

```
client → server (healthy) → postgres (healthy) + guacd (healthy)
```

Health checks are configured for all services with proper `start_period` values. The server container runs with security hardening: `cap_drop: ALL`, `cap_add: NET_BIND_SERVICE`, and `no-new-privileges:true`.

### Starting Production

```bash
# Build and start all containers (auto-detects Docker or Podman)
npm run docker:prod

# Or manually:
docker compose --env-file .env.production up -d --build
# With Podman:
podman compose --env-file .env.production up -d --build
```

Only port **3000** (mapped from client's 8080) is exposed to the host. All inter-service communication happens over the Docker network.

### Demo Deployment

A separate `compose.demo.yml` is available for demo/showcase purposes. It uses pre-built images from `ghcr.io/dnviti/arsenale/*`, includes a `demo-seed` one-shot container that runs `arsenale demo setup` via the CLI, and adds an `ollama-backend` container for AI features. It uses a three-network topology (`proxy-net`, `arsenale-front-net`, `arsenale-back-net`) for isolation. The client is exposed on port **8081** and a separate `website` container on port **8080**.

### Volume Management

| Volume | Purpose | Persistence |
|--------|---------|-------------|
| `pgdata` | PostgreSQL data | Persisted across restarts |
| `arsenale_drive` | RDP drive redirection files | Shared between server and guacd |
| `arsenale_recordings` | Session recordings | Shared between server, guacd, and guacenc |

<!-- manual-start -->
<!-- manual-end -->

## Nginx Configuration

The client container runs Nginx as a reverse proxy. Configuration: `client/nginx.conf`.

| Location | Upstream | Notes |
|----------|----------|-------|
| `/api` | `http://server:3001` | API requests, WebSocket upgrade for Socket.IO |
| `/socket.io` | `http://server:3001` | Socket.IO WebSocket + polling |
| `/guacamole` | `http://server:3002` | Guacamole WebSocket with 24h timeout |
| `/health` | Local | Returns `{"status":"ok"}` (no proxy) |
| `/` | Local files | SPA fallback to `index.html` |

All proxy locations set `X-Real-IP`, `X-Forwarded-For`, and `X-Forwarded-Proto` headers and enable WebSocket upgrades.

<!-- manual-start -->
<!-- manual-end -->

## Server Dockerfile

`server/Dockerfile`:

1. Installs dependencies (including dev deps for Prisma generate and TypeScript compilation)
2. Generates Prisma client from schema
3. Compiles TypeScript to JavaScript (`npx tsc`)
4. Prunes dev dependencies
5. Creates `/usr/local/bin/arsenale` CLI wrapper script (invokes `node /app/dist/cli.js`)
6. Creates a non-root user (`appuser`)
7. Creates `/guacd-drive` and `/recordings` directories (mode 1777)
8. Exposes ports 3001 (HTTP) and 3002 (Guacamole WS)
9. Runs as `appuser` with `node dist/index.js`

The production compose overrides the user to `0:0` for rootless Podman compatibility (UID 0 maps to the host user).

## Client Dockerfile

`client/Dockerfile`:

1. **Build stage**: Installs deps, runs `npm run build` (Vite production build)
2. **Runtime stage**: Alpine 3.21 with Nginx
3. Copies built assets to Nginx html directory
4. Copies `nginx.main.conf` and `nginx.conf` for server configuration
5. Runs as `nginx` user (non-root)
6. Exposes port 8080

<!-- manual-start -->
<!-- manual-end -->

## Available Scripts

All scripts are run from the monorepo root.

| Script | Command | Description |
|--------|---------|-------------|
| `npm run dev` | `concurrently dev:server dev:client:wait` | Run both server and client (client waits for server health) |
| `npm run dev:server` | `tsx watch server/src/index.ts` | Server with hot reload |
| `npm run dev:client` | `vite` (in client/) | Vite dev server |
| `npm run predev` | Starts PostgreSQL + generates Prisma | Pre-dev setup |
| `npm run build` | Build both workspaces | Production build |
| `npm run build -w server` | `tsc` (in server/) | Build server only |
| `npm run build -w client` | `vite build` (in client/) | Build client only |
| `npm run verify` | typecheck + lint + audit + test + build | Full verification pipeline |
| `npm run typecheck` | `tsc --noEmit` in both workspaces | Type checking |
| `npm run lint` | ESLint across both workspaces | Lint check |
| `npm run lint:fix` | ESLint with `--fix` | Auto-fix linting |
| `npm run sast` | `npm audit` | Dependency vulnerability scan |
| `npm run db:generate` | `prisma generate` | Generate Prisma client types |
| `npm run db:push` | `prisma db push` | Sync schema to DB (no migration) |
| `npm run db:migrate` | `prisma migrate deploy` | Run pending migrations |
| `npm run docker:dev` | `compose -f compose.dev.yml up -d` (auto-detects runtime) | Start dev containers |
| `npm run docker:dev:down` | `compose -f compose.dev.yml down` (auto-detects runtime) | Stop dev containers |
| `npm run docker:prod` | `compose --env-file .env.production up -d --build` (auto-detects runtime) | Start production stack |
| `npm run dev:docker` | `docker compose -f compose.dev.yml up --build` | Full dev stack in Docker |
| `npm run dev:docker:detach` | `docker compose -f compose.dev.yml up --build -d` | Dev stack in background |
| `npm run test:watch` | `vitest` in both workspaces | Run tests in watch mode |
| `npm run security` | `./scripts/security-scan.sh` | Full security scan |
| `npm run security:quick` | `./scripts/security-scan.sh --quick` | Quick security scan |
| `npm run security:docker` | `./scripts/security-scan.sh --docker` | Docker image security scan |
| `npm run cli` | CLI tool (server workspace) | Arsenale CLI (production) |
| `npm run cli:dev` | CLI tool dev mode (server workspace) | Arsenale CLI (development) |

<!-- manual-start -->
<!-- manual-end -->

## Troubleshooting

### Common Issues

**PostgreSQL connection refused on localhost (Windows/WSL)**

If using Docker with IPv6, PostgreSQL may bind to `::1` instead of `127.0.0.1`. The dev compose explicitly binds to `127.0.0.1:5432:5432`. If issues persist, use the Docker container's internal DNS name instead.

**Docker networking: containers can't reach each other**

Ensure all services are on the same Docker network. In development, the `arsenale-dev` network is used. In production, `arsenale_net`. Managed gateway containers must also join this network (configured via `DOCKER_NETWORK`).

**guacd not available — RDP connections fail**

In development, guacd must be running locally or uncommented in `compose.dev.yml`. The server logs a warning if guacamole-lite cannot initialize.

**SERVER_ENCRYPTION_KEY not persisted in development**

The key is auto-generated on each server restart in development. SSH key pairs for managed gateways will be regenerated. Set `SERVER_ENCRYPTION_KEY` in `.env` to persist across restarts.

**Prisma migration errors**

If the database schema is out of sync, try `npm run db:push` for development (destructive) or `npm run db:migrate` for production.

**Port already in use**

The server automatically kills stale processes on ports 3001 and 3002 using `fuser`. If this fails, manually kill the processes.

<!-- manual-start -->
<!-- manual-end -->
