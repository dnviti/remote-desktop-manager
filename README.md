<div align="center">
  <img src="icons/Arsenale_logo_transparent.png" alt="Arsenale" width="500" />
</div>

[![License: BSL 1.1](https://img.shields.io/badge/License-BSL_1.1-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.7.1-green.svg)](CHANGELOG.md)

A web-based application for managing and accessing remote SSH and RDP connections from your browser. Organize connections in folders, share them with team members, and keep credentials encrypted at rest with a personal vault.

## Features

- **SSH Terminal** — Interactive terminal sessions powered by XTerm.js and Go WebSocket brokers, with integrated SFTP file browser
- **RDP Viewer** — Remote desktop connections via Apache Guacamole with clipboard sync and drive redirection
- **VNC Viewer** — VNC sessions via the Guacamole protocol
- **Encrypted Vault** — All credentials encrypted at rest with AES-256-GCM; master key derived from your password via Argon2id
- **Secrets Keychain** — Store login credentials, SSH keys, certificates, API keys, and secure notes with full versioning and expiry notifications
- **Connection Sharing** — Share connections with other users (read-only or full access) with per-recipient re-encryption
- **Folder Organization** — Hierarchical folder tree with drag-and-drop reordering for personal and team connections
- **Tabbed Interface** — Open multiple sessions side by side; pop out connections into standalone windows
- **Multi-Tenant Organizations** — Tenant-scoped RBAC with Owner/Admin/Operator/Member/Consultant/Auditor/Guest roles; time-limited memberships
- **Team Collaboration** — Teams with shared connection pools, folders, and vault sections
- **Multi-Factor Authentication** — TOTP, SMS OTP (Twilio, AWS SNS, Vonage), and WebAuthn/FIDO2 passkeys
- **OAuth & SAML SSO** — Google, Microsoft, GitHub, any OIDC provider, SAML 2.0, and LDAP identity providers
- **Audit Logging** — 100+ action types with IP and GeoIP tracking; geographic visualization for admins
- **Session Recording** — Record SSH (asciicast) and RDP/VNC (Guacamole format) sessions with in-browser playback and video export
- **DLP Policies** — Tenant and per-connection controls for clipboard copy/paste and file upload/download
- **Connection Policy Enforcement** — Admin-enforced SSH/RDP/VNC settings that override user configuration
- **IP Allowlist** — Per-tenant IP/CIDR allowlists with flag (audit) or block enforcement modes
- **Session Limits** — Max concurrent sessions per user and absolute session timeouts (OWASP A07)
- **External Vault Integration** — Reference credentials from HashiCorp Vault (KV v2) instead of storing them in Arsenale
- **SSH Gateway Management** — Deploy, scale, and monitor SSH gateway containers via Docker, Podman, or Kubernetes
- **JWT Authentication** — Short-lived access tokens with httpOnly refresh cookies, CSRF protection, and token binding

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Backend** | Go split services under `backend/` (control plane, brokers, orchestration, AI, runtime) |
| **Client** | React 19, Vite, Material-UI v7, Zustand, XTerm.js, guacamole-common-js |
| **Database** | PostgreSQL 16 |
| **Infrastructure** | Docker / Podman / Kubernetes, Nginx, guacd, ssh-gateway |

## Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [Go](https://go.dev/) 1.25+ or a container runtime for the bundled Go fallback
- [Docker](https://www.docker.com/) or [Podman](https://podman.io/) (required for the local stack)
- npm 9+

## Getting Started

### 1. Clone the repository

```bash
git clone <repository-url>
cd arsenale
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` as needed — see [Environment Variables](#environment-variables) below.

### 4. Run in development

```bash
# Full setup: starts the local Go stack via Ansible, then runs Vite against it
npm run dev
```

This starts:
- The full local Go stack via `make dev` (PostgreSQL, Redis, guacd, Go control plane, brokers, gateways)
- The containerized HTTPS app on `https://localhost:3000`
- A local Vite dev server on `https://localhost:3005` that proxies to the Go services on `:18080`, `:18090`, and `:18091`

## Environment Variables

Key variables — see [docs/environment.md](docs/environment.md) for the full reference (123 variables).

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://arsenale:arsenale_password@127.0.0.1:5432/arsenale` | PostgreSQL connection string |
| `JWT_SECRET` | `dev-secret-change-me` | Secret key for signing JWT tokens (**must be strong in production**) |
| `JWT_EXPIRES_IN` | `15m` | Access token TTL |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | Refresh token TTL |
| `GUACD_HOST` | `localhost` | Guacamole daemon hostname |
| `GUACD_PORT` | `4822` | Guacamole daemon port |
| `GUACAMOLE_SECRET` | `dev-guac-secret` | Guacamole token encryption key (**must be strong in production**) |
| `SERVER_ENCRYPTION_KEY` | Auto-generated | 32-byte hex key for server-level encryption (**required in production**) |
| `NODE_ENV` | `development` | Environment mode |
| `VAULT_TTL_MINUTES` | `30` | Vault session auto-lock timeout (minutes) |
| `CLIENT_URL` | `http://localhost:3000` | Client URL (CORS, OAuth redirects, emails) |
| `VITE_API_TARGET` | `http://localhost:18080` | Local Vite proxy target for `/api` |
| `VITE_GUAC_TARGET` | `http://localhost:18091` | Local Vite proxy target for `/guacamole` |
| `VITE_TERMINAL_TARGET` | `http://localhost:18090` | Local Vite proxy target for `/ws/terminal` |
| `RECORDING_ENABLED` | `false` | Enable session recording |

## Project Structure

```
arsenale/
├── backend/                       # New Go backend monorepo (control, agent, runtime services)
│   ├── cmd/                      # Service entrypoints (API, controller, brokers, agent services)
│   ├── internal/                 # Internal Go packages
│   └── pkg/                      # Shared Go contracts and workload spec
│
├── client/                        # React frontend
│   ├── src/
│   │   ├── pages/                # Login, Register, Dashboard, RecordingPlayer, PublicShare
│   │   ├── components/           # UI components (RDP, VNC, Terminal, Sidebar, Tabs, Dialogs, Settings, Keychain)
│   │   ├── api/                  # Axios API clients with JWT interceptor (29 modules)
│   │   ├── store/                # Zustand state stores (14 stores)
│   │   └── hooks/                # Custom React hooks
│   └── nginx.conf                # Production reverse proxy config
│
├── gateways/                      # Gateway containers and tunnel agent
│   ├── ssh-gateway/              # Optional SSH gateway container
│   ├── tunnel-agent/             # Zero-trust tunnel agent (workspace)
│   ├── guacd/                    # Custom guacd with embedded tunnel agent
│   └── guacenc/                  # Recording-to-video conversion sidecar
├── Makefile                       # Ansible deployment UX (make dev/deploy/etc.)
├── deployment/ansible/            # Ansible playbooks, roles, and templates
└── .env.example                   # Environment template (121 variables)
```

## Available Scripts

```bash
# Development
npm run dev                 # Start the Go dev stack and local Vite on :3005
npm run dev:client          # Client only (Vite on :3005)

# Build
npm run build               # Build the active Go/backend + client workspaces
npm run backend:build       # Build the Go backend module
npm run build -w client     # Client only

# Database
npm run db:bootstrap        # Apply backend/schema/bootstrap.sql when DB is empty
npm run db:push             # Alias of db:bootstrap
npm run db:migrate          # Alias of db:bootstrap

# Infrastructure (via Makefile + Ansible)
make setup                  # First-time setup (Ansible collections, vault)
make dev                    # Start dev infrastructure (postgres + redis)
make dev-down               # Stop dev infrastructure
make deploy                 # Full production deployment

# Go backend checks
npm run backend:test        # Run Go backend tests
```

## Production Deployment

Deploy the full stack with Ansible (via Makefile):

```bash
# 1. First-time setup (install Ansible collections, generate vault)
make setup

# 2. Deploy production stack
make deploy
```

This deploys the full container stack via Ansible:
- **PostgreSQL 16** — Production database
- **guacd** — Apache Guacamole daemon for RDP/VNC
- **guacenc** — Recording-to-video conversion sidecar
- **control-plane-api-go** — Public API edge
- **desktop-broker-go / terminal-broker-go / tunnel-broker-go** — Session and transport brokers
- **query-runner-go / model-gateway-go / control-plane-controller-go** — Query execution, AI, and orchestration services
- **Client** — Nginx serving the React app with reverse proxy to the API
- **Redis** — Distributed coordination backend
- **ssh-gateway** — Optional SSH gateway container (port 2222)

See [deployment/ansible/README.md](deployment/ansible/README.md) for detailed configuration.

## Architecture

### Backend

The public edge is now Go-first: control-plane, desktop, terminal, tunnel, query, AI, and orchestration services run from `backend/`.

- The public `/api` surface is handled by `control-plane-api-go`
- Browser SSH and desktop runtime terminate in direct Go brokers
- Database sessions, orchestration, gateway management, and AI flows are verified against the Go services
- Legacy `server/` code is no longer part of the default runtime or top-level build path

### Client

- 14 Zustand stores manage auth, connections, tabs, vault, teams, tenants, gateways, and UI preferences
- Axios interceptor handles automatic JWT refresh on 401 responses
- XTerm.js renders SSH terminals; guacamole-common-js renders RDP/VNC sessions
- All UI layout preferences persisted via `uiPreferencesStore` (localStorage)

### Vault & Encryption

- User password → Argon2id → master key → AES-256-GCM encryption of all credentials
- Master key held in server memory with auto-expiring sessions (configurable TTL)
- Vault must be unlocked to view or use stored credentials
- Recovery key generated at registration enables vault access after password reset

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, code conventions, commit guidelines, and the PR process.

Before submitting a pull request, make sure the quality gate passes:

```bash
npm run verify
```

## License

This project is licensed under the [Business Source License 1.1](LICENSE).
