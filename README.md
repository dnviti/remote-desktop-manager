<div align="center">
  <img src="icons/Arsenale_logo_transparent.png" alt="Arsenale" width="500" />
</div>

[![License: BSL 1.1](https://img.shields.io/badge/License-BSL_1.1-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-2.0.0-green.svg)](CHANGELOG.md)

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
- **SSH Gateway Management** — Deploy, scale, and monitor SSH gateway containers via Podman or Kubernetes
- **JWT Authentication** — Short-lived access tokens with httpOnly refresh cookies, CSRF protection, and token binding

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Backend** | Go split services under `backend/` (control plane, brokers, orchestration, AI, runtime) |
| **Client** | React 19, Vite, Material-UI v7, Zustand, XTerm.js, guacamole-common-js |
| **Database** | PostgreSQL 16 |
| **Infrastructure** | Podman / Kubernetes, Nginx, guacd, ssh-gateway |

## Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [Go](https://go.dev/) 1.25+ or a container runtime for the bundled Go fallback
- [Podman](https://podman.io/) for compose-backed installs or [minikube](https://minikube.sigs.k8s.io/docs/start/) for Kubernetes validation
- [Ansible](https://docs.ansible.com/ansible/latest/installation_guide/) for the installer and deployment flow
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

### 3. Prepare the installer

```bash
make setup
```

This installs the required Ansible collections and creates the encrypted Ansible vault used for long-lived deployment secrets.

### 4. Run the full development stack

```bash
make dev
npm run dev
```

`make dev` runs the installer-aware development flow. Development mode always deploys the full stack, demo targets, demo datasets, bootstrap data, and deeper validation. `npm run dev` is optional when you want the Vite client on `https://localhost:3005` against that stack.

### 5. Run the installer

```bash
make install
```

The installer is CLI-only, interactive, password-gated, idempotent, and backend-aware. It can deploy:

- Development via the full local compose stack
- Production via Podman compose
- Production via Helm on Kubernetes

Docker is not a supported installer backend.

See [docs/installer.md](docs/installer.md) for the full flow.

## Installer

The installer persists encrypted profile, state, status, log, and rendered-artifact payloads. On a target host the canonical location is:

```text
/opt/arsenale/install/
```

Artifacts written there:

- `install-profile.enc`
- `install-state.enc`
- `install-status.enc`
- `install-log.enc`
- `rendered-artifacts.enc`

Every rerun asks for the technician password before those artifacts are read. External tooling can read the encrypted installer status directly with the supported helper path instead of querying a running Arsenale instance:

```bash
make status
```

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
├── deployment/ansible/            # Installer playbooks, roles, schemas, and templates
├── deployment/helm/               # Helm chart for the Kubernetes backend
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
npm run backend:generate    # Regenerate sqlc code for the converted Go domains
npm run build -w client     # Client only

# Database
npm run db:migrate          # Apply pending backend SQL migrations
npm run db:status           # Show applied and pending backend migrations
npm run db:bootstrap        # Compatibility alias of db:migrate
npm run db:push             # Alias of db:migrate

# Infrastructure (via Makefile + Ansible)
make setup                  # First-time setup (Ansible collections, vault)
make install                # Interactive installer entrypoint
make dev                    # Full installer-aware development environment
make dev-down               # Stop dev infrastructure
make deploy                 # Production installer/deploy flow
make configure              # Reconfigure an existing install
make recover                # Rerun installer recovery flow
make status                 # Read encrypted installer status

# Go backend checks
npm run backend:test        # Run Go backend tests
```

## Production Deployment

Deploy the full stack with the installer (via Makefile):

```bash
# 1. First-time setup (install Ansible collections, generate vault)
make setup

# 2. Deploy or reconfigure production stack
make deploy

# 3. Read encrypted installer status
make status
```

Production mode uses the same installer profile model across Podman and Kubernetes. Selected capabilities are installer-owned only; disabled capabilities remove their services, APIs, and UI affordances from the rendered runtime.

The installer can render and apply:

- Compose for Podman
- Helm for Kubernetes

Development mode always deploys the full stack and fixtures. Production mode deploys only the selected capabilities.

See [deployment/ansible/README.md](deployment/ansible/README.md) and [docs/installer.md](docs/installer.md) for the operator flow and artifact model.

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
