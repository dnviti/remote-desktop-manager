---
title: Getting Started
description: Installation, prerequisites, and first-run instructions for Arsenale
generated-by: claw-docs
generated-at: 2026-03-27T12:00:00Z
source-files:
  - README.md
  - package.json
  - Makefile
  - client/package.json
  - dev-certs/generate.sh
  - .env.example
  - backend/schema/bootstrap.sql
  - deployment/ansible/inventory/group_vars/all/vars.yml
---

## 🎯 Overview

Arsenale is a secure remote access platform that provides SSH, RDP, VNC, and database proxy access through a unified web interface. This guide covers setting up a local development environment.

## 📋 Prerequisites

| Requirement | Minimum Version | Purpose |
|-------------|----------------|---------|
| Node.js | 22.x | Frontend and JS workspace runtime |
| npm | 10.x | Package management |
| Podman or Docker | Latest | Local stack containers and Go fallback builds |
| Podman Compose or Docker Compose | Latest | Container orchestration |
| Python 3 | 3.9+ | Ansible automation scripts |
| Ansible | Latest | Infrastructure provisioning |
| OpenSSL | 3.x | TLS certificate generation |
| Git | 2.x | Version control |

**Operating system support:** Linux, macOS, Windows (with PowerShell Core).

## 🚀 Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/dnviti/arsenale.git
cd arsenale
npm install
```

### 2. First-Time Setup

```bash
make setup
```

This command:
- Installs Ansible collections
- Generates `vault.yml` with auto-generated secrets (JWT, Guacamole, encryption keys, DB password)
- Creates TLS certificates in `dev-certs/` (CA + per-service certs)

### 3. Start Development Environment

```bash
npm run dev
```

This single command:
1. Runs `make dev` -- starts the full local Go stack via Ansible
2. Brings up the containerized HTTPS app on `https://localhost:3000`
3. Starts the Vite dev server on `https://localhost:3005`
4. Proxies local frontend requests to the Go services on `:18080`, `:18090`, and `:18091`

### 4. Access the Application

| URL | Purpose |
|-----|---------|
| `https://localhost:3000` | Containerized web UI |
| `https://localhost:3005` | Local Vite frontend |
| `http://localhost:18080/api` | Public Go API edge |
| `http://localhost:18080/healthz` | Control plane health check |

On first access, the **Setup Wizard** will guide you through creating an admin account.

## 📁 Project Structure

```
arsenale/
├── backend/                 # Go split services
├── client/                  # React 19 + Vite + MUI v7
│   ├── src/                 # Source code
│   └── package.json
├── gateways/                # Gateway containers
│   ├── tunnel-agent/        # Zero-trust tunnel client
│   ├── ssh-gateway/         # SSH bastion
│   ├── guacd/               # Guacamole daemon
│   ├── guacenc/             # Recording video converter
│   └── db-proxy/            # Database protocol proxy
├── extra-clients/
│   └── browser-extensions/  # Chrome extension (MV3)
├── infrastructure/
│   ├── dev/                 # Dev support containers and fixtures
│   └── postgres/            # Database bootstrap assets
├── deployment/
│   └── ansible/             # Ansible playbooks + roles
├── dev-certs/               # Development TLS certificates
├── docs/                    # Documentation
├── Makefile                 # Infrastructure management
├── .env.example             # Environment template
└── package.json             # Root workspace config
```

## 🔧 Development Commands

### Application

```bash
npm run dev              # Go dev stack + Vite on :3005
npm run dev:client       # Vite only (HMR, port 3005)
npm run build            # Production build (active runtime workspaces)
npm run verify           # Full quality gate: typecheck -> lint -> audit -> test -> build
npm run typecheck        # TypeScript check (all workspaces)
npm run lint             # ESLint (all workspaces)
npm run lint:fix         # Auto-fix lint issues
npm run test             # Run all tests (vitest)
npm run test:watch       # Watch mode
```

### Database bootstrap

```bash
npm run db:bootstrap     # Apply backend/schema/bootstrap.sql when DB is empty
npm run db:push          # Alias of db:bootstrap
npm run db:migrate       # Alias of db:bootstrap
```

### Infrastructure (Makefile)

```bash
make setup               # First-time: Ansible, vault, certs
make dev                 # Start the dev stack containers and Go services
make dev-down            # Stop dev containers
make status              # Show container status
make logs                # Tail all container logs (SVC=arsenale-control-plane-api-go for specific)
make backup              # Database backup
make rotate              # Rotate system secrets
make vault               # Edit Ansible Vault
make certs               # Regenerate TLS certificates
make deploy              # Full production deployment
make clean               # Stop and remove everything
make help                # Show all targets
```

## 🌐 Environment Configuration

The `.env` file is auto-generated at the monorepo root by `make dev` via Ansible templates. Key variables to customize:

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | Auto-generated | PostgreSQL connection string |
| `JWT_SECRET` | Auto-generated | JWT signing key (64 hex chars) |
| `GUACAMOLE_SECRET` | Auto-generated | RDP/VNC encryption key |
| `CLIENT_URL` | `https://localhost:3000` | Containerized frontend URL |
| `VITE_API_TARGET` | `http://localhost:18080` | Local Vite proxy target for `/api` |
| `VITE_GUAC_TARGET` | `http://localhost:18091` | Local Vite proxy target for `/guacamole` |
| `VITE_TERMINAL_TARGET` | `http://localhost:18090` | Local Vite proxy target for `/ws/terminal` |
| `NODE_ENV` | `development` | Environment mode |
| `LOG_LEVEL` | `info` | Log verbosity: error, warn, info, verbose, debug |
| `NODE_EXTRA_CA_CERTS` | `dev-certs/ca.pem` | Trust the dev CA certificate |

See [Configuration](configuration.md) for the full list of 120+ environment variables.

## 🧪 Testing

```bash
# Run all tests
npm run test

# Run tests for a specific workspace
npm run backend:test
npm run test -w client

# Watch mode (re-runs on file change)
npm run test:watch
```

**Test frameworks:**
- **Client**: Vitest with jsdom environment for DOM simulation
- **Tunnel Agent**: Vitest with Node environment

## 🔑 TLS Certificates (Development)

Development certificates are generated by `make setup` (or `./dev-certs/generate.sh` directly):

```
dev-certs/
├── ca.pem, ca-key.pem          # Shared CA (10-year validity)
├── server/                     # Historical client-edge cert name retained for compatibility
├── client/                     # Nginx TLS
├── postgres/                   # PostgreSQL SSL
├── guacd/                      # Guacamole daemon TLS
├── guacenc/                    # Video converter HTTPS
├── ssh-gateway/                # SSH gateway API
└── tunnel/                     # Tunnel mTLS
```

All certificates use ECC (secp256r1) and are valid for 10 years. The shared CA is automatically trusted via `NODE_EXTRA_CA_CERTS`.

## 🐛 Common Issues

| Issue | Solution |
|-------|----------|
| `ECONNREFUSED :5432` | Run `make dev` to start PostgreSQL |
| `SSL certificate problem` | Run `make certs` to regenerate dev certificates |
| `Port already in use` | The dev server auto-detects and cleans stale processes |
| Empty DB after a reset | Run `npm run db:bootstrap` or redeploy with `make dev` |
| `Permission denied` on certs | Certificate files should be readable; run `chmod 644 dev-certs/**/*.pem` |
| First access shows setup wizard | Expected on fresh install -- create your admin account |

## ➡ Next Steps

- [Architecture](architecture.md) -- Understand the system design
- [Configuration](configuration.md) -- Full environment variable reference
- [API Reference](api-reference.md) -- Explore the 200+ API endpoints
- [Development](development.md) -- Contributing, branch strategy, testing details
