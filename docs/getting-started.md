---
title: Getting Started
description: Installation, prerequisites, and first-run instructions for Arsenale
generated-by: claw-docs
generated-at: 2026-04-04T21:15:00Z
source-files:
  - README.md
  - AGENT.md
  - package.json
  - client/package.json
  - Makefile
  - .env.example
  - dev-certs/generate.sh
  - scripts/db-migrate.sh
  - scripts/dev-api-acceptance.sh
  - deployment/ansible/README.md
  - deployment/ansible/playbooks/install.yml
  - deployment/ansible/playbooks/status.yml
  - deployment/ansible/inventory/group_vars/all/vars.yml
---

## Overview

The fastest way to work on Arsenale locally is to let the installer-aware Ansible flow bring up the containerized Go stack and then run the React frontend in local Vite mode. That gives you:

- the installer-selected control plane and brokers,
- seeded development credentials,
- local HTTPS,
- and hot reloading for frontend changes.

For detailed Ansible deployment documentation (all modes, backends, roles, capabilities, and walkthroughs), see [`deployment/ansible/README.md`](../deployment/ansible/README.md). For the installer model reference, see [`docs/installer.md`](installer.md).

## ✅ Prerequisites

| Requirement | Recommended Version | Why it is needed |
|-------------|---------------------|------------------|
| Node.js | `22.x` | Root workspaces, frontend build, tunnel-agent workspace |
| npm | `10.x` or newer | Workspace install and scripts |
| Go | `1.25.x` | Local backend and CLI builds when not using container-only flow |
| Podman | Recent | Required for installer-aware development deploys |
| Ansible | `2.15+` | Installer, deploy, status, and recovery flows |
| Python 3 | `3.9+` | Ansible helpers and acceptance parsing |
| OpenSSL | `3.x` | Local CA and service certificate generation |
| Git | `2.x` | Repository operations |

Docker is not a supported Ansible installer backend. The standalone migration helper in `scripts/db-migrate.sh` can still target Docker or Podman when you point it at a compose file explicitly.

## 🚀 First-Run Flow

```mermaid
flowchart TD
    A["git clone + npm install"] --> B["make setup"]
    B --> C["Generate vault secrets"]
    B --> D["Generate dev certificates"]
    C --> E["make dev"]
    D --> E
    E --> F["Installer-aware dev apply"]
    F --> G["Run dev-bootstrap + seed demo databases"]
    G --> H["Service health checks"]
    H --> I["npm run dev:client or npm run dev"]
    I --> J["Open UI or use CLI"]
```

## 🛠 Step-by-Step Setup

### 1. Clone and install dependencies

```bash
git clone https://github.com/dnviti/arsenale.git
cd arsenale
npm install
```

### 2. Generate local secrets and certificates

```bash
make setup
```

`make setup` installs required Ansible collections and prepares local vault input.
The first `make dev` run then creates installer-managed development state under
`${XDG_STATE_HOME:-$HOME/.local/state}/arsenale-dev` by default.

`make setup` creates:

- `deployment/ansible/inventory/group_vars/all/vault.yml`
- `deployment/ansible/.vault-pass` when generated locally

### 3. Start the development stack

Explicit two-step path:

```bash
make dev
npm run dev:client
```

One-command path:

```bash
npm run dev
```

What actually happens:

1. `make dev` runs `deployment/ansible/playbooks/install.yml -e installer_mode=development`.
2. The playbook renders and applies the dev stack under `${XDG_STATE_HOME:-$HOME/.local/state}/arsenale-dev`, builds the selected images locally, and runs `service dev-bootstrap` to seed the admin user and tenant.
3. `npm run dev:client` starts Vite after `http://localhost:18080/healthz`, `:18090/healthz`, and `:18091/healthz` are reachable.

If you need a headless rerun, place the technician password in
`${XDG_STATE_HOME:-$HOME/.local/state}/arsenale-dev/install/password.txt`
before calling `make dev`. The repo wrapper will auto-pass that file as
`install_password_file` to the installer. Set `ARSENALE_DEV_HOME=/absolute/path`
if you want a different state directory.

### 4. Open the application

| URL | Use |
|-----|-----|
| `https://localhost:3000` | Containerized client with reverse proxy |
| `https://localhost:3005` | Local Vite frontend |
| `http://127.0.0.1:18080/healthz` | Control-plane health |
| `http://127.0.0.1:18090/healthz` | Terminal broker health |
| `http://127.0.0.1:18091/healthz` | Desktop broker health |
| `http://127.0.0.1:18092/healthz` | Tunnel broker health |
| `http://127.0.0.1:18093/healthz` | Query runner health |
| `http://127.0.0.1:18094/healthz` | Recording worker health |

### 5. Sign in with the seeded dev admin

The development install flow seeds an admin and tenant automatically:

```text
Email:    admin@example.com
Password: ArsenaleTemp91Qx
Tenant:   Development Environment
```

## 🔧 Capability Selection In Dev

Installer-driven development now uses the same capability model as production. The difference is that development always uses Podman locally and builds images from the current checkout.

Minimal local example:

```bash
make dev DEV_CAPABILITIES=cli DEV_DIRECT_GATEWAY=false DEV_ZERO_TRUST=false
```

The vault/keychain remains enabled in that minimal profile because it is part of the required core install.
Because `multi_tenancy` is optional, that minimal example also runs in single-tenant mode. Add `multi_tenancy` to `DEV_CAPABILITIES` if you want tenant switching and self-service organization creation enabled.

When you enable `connections`, the development bootstrap registers the built-in
`ssh-gateway` and `guacd` containers in the tenant so they appear in the Gateways UI, and the installer keeps the SSH target fixtures needed for local smoke tests.

If you do not pass overrides, `make dev` uses the same capability defaults as production. That means the local demo databases are present by default because `databases` is enabled, while zero trust stays disabled until you set `DEV_ZERO_TRUST=true`.

## 🧪 Quick Verification

### Installer and health

```bash
make status
curl -k https://localhost:3000/health
curl http://127.0.0.1:18080/api/ready
curl http://127.0.0.1:18080/healthz
```

### CLI smoke

```bash
mkdir -p ./build/go
go build -o ./build/go/arsenale-cli ./tools/arsenale-cli
./build/go/arsenale-cli --server https://localhost:3000 health
./build/go/arsenale-cli --server https://localhost:3000 login
./build/go/arsenale-cli --server https://localhost:3000 whoami
```

When the server is the local installer stack on `https://localhost:3000`, the CLI automatically loads `${XDG_STATE_HOME:-$HOME/.local/state}/arsenale-dev/dev-certs/client/ca.pem`. Use `ARSENALE_CA_CERT` to override that trust path for another private CA.

### Acceptance flow

```bash
npm run dev:api-acceptance
```

The acceptance script exercises auth, sessions, audit, gateways, secrets, recordings, and database operations against the running dev stack.

## 🗄 Database Operations

### Migrations

```bash
npm run db:migrate    # Apply pending migrations
npm run db:status     # Check migration status
```

The migration runner is built into every backend service image. `scripts/db-migrate.sh` provides a wrapper that auto-detects the container runtime and supports compose file overrides via `ARSENALE_COMPOSE_FILE`.

### Direct Database Access

The application PostgreSQL database is separate from the demo databases used for testing. To connect directly:

```bash
psql "postgresql://arsenale:arsenale_password@localhost:5432/arsenale?sslmode=verify-full"
```

## 🧰 Everyday Commands

| Command | Purpose |
|---------|---------|
| `make dev` | Deploy the local installer-aware stack via the Ansible flow |
| `make dev-down` | Tear the local stack down |
| `make status` | Read encrypted installer status |
| `make recover` | Rerun the installer recovery path |
| `make logs SVC=arsenale-control-plane-api` | Follow a specific service log |
| `npm run dev` | Full dev wrapper: deploy stack, wait for health, then start Vite |
| `npm run dev:client` | Frontend only, assuming the stack is already up |
| `npm run db:migrate` | Apply migrations |
| `npm run db:status` | Show migration status |
| `npm run verify` | Full quality gate |
| `npm run backend:test` | Go test pass for the backend module |
| `npm run go:test` | Go tests across backend, gateways, and CLI |

## 🔐 Certificates and Local Trust

The development deployment creates a shared CA and the service certificates consumed by:

- the client HTTPS listener,
- PostgreSQL TLS,
- `guacd`,
- `guacenc`,
- `ssh-gateway`,
- tunnel identities.

If the browser does not trust the local certs yet, import the CA from:

```text
${XDG_STATE_HOME:-$HOME/.local/state}/arsenale-dev/dev-certs/ca.pem
```

If you plan to validate WebAuthn, OAuth redirects, or the installer-configured public URL, align your browser hostname with `arsenale_public_url`. The default dev nginx config accepts both `localhost` and `arsenale.home.arpa.viti`.

## 📁 Files Worth Knowing Early

| Path | Why it matters |
|------|----------------|
| `Makefile` | Human entry point for installer, deploy, status, and recovery flows |
| `deployment/ansible/playbooks/install.yml` | Interactive installer and development entrypoint |
| `deployment/ansible/playbooks/status.yml` | Encrypted installer status reader |
| `deployment/ansible/playbooks/deploy.yml` | Shared apply engine beneath the installer |
| `scripts/db-migrate.sh` | Runtime-aware migration helper |
| `scripts/dev-api-acceptance.sh` | End-to-end API verification |
| `AGENT.md` | CLI-first smoke-test guidance |
| `docs/installer.md` | Installer artifact and rerun model |
