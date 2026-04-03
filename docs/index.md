---
title: Documentation Index
description: Landing page, table of contents, and project summary for Arsenale
generated-by: claw-docs
generated-at: 2026-04-03T14:30:00Z
source-files:
  - README.md
  - AGENT.md
  - package.json
  - client/package.json
  - backend/go.mod
  - backend/internal/runtimefeatures/manifest.go
  - backend/internal/publicconfig/service.go
---

![Project Logo](../icons/Arsenale_logo_transparent.png)

# Arsenale Documentation

Arsenale is a Go-first remote access, database access, and installer-managed deployment platform. The active runtime combines split Go services in `backend/`, a React SPA in `client/`, gateway containers in `gateways/`, and an Ansible installer that owns encrypted deployment state for both development and production.

The current architectural pivot to keep in mind is that runtime behavior is feature-gated from a shared `runtimefeatures.Manifest`. The control plane exposes that manifest through `GET /api/auth/config`, and the client consumes it to decide which pages, dialogs, session flows, and API families are active in the current install profile.

## 📚 Table of Contents

| Section | Description |
|---------|-------------|
| [Getting Started](getting-started.md) | Installation, prerequisites, first run, and dev bootstrap |
| [Architecture](architecture.md) | Service planes, capability gating, gateway topology, and DB proxy design |
| [Configuration](configuration.md) | Installer inputs, feature flags, env vars, secrets, and precedence |
| [API Reference](api-reference.md) | Public `/api`, SSE surfaces, feature-gated route families, and internal `/v1` contracts |
| [Deployment](deployment.md) | Installer flow, Podman and Kubernetes backends, TLS, and CI/CD |
| [Development](development.md) | Local workflow, quality gates, tests, feature-flag alignment, and CLI rules |
| [Troubleshooting](troubleshooting.md) | Health checks, config drift, bootstrap issues, and debugging commands |
| [LLM Context](llm-context.md) | Single-file condensed context for bots and operators |

## 📁 Extended Documentation

In addition to the generated docs above, the following hand-authored references provide deeper coverage:

### API Details
| File | Description |
|------|-------------|
| [api/overview.md](api/overview.md) | Endpoint family listing with auth requirements |
| [api/auth.md](api/auth.md) | Authentication endpoint request/response specs |
| [api/admin.md](api/admin.md) | Admin, tenant, gateway, and policy endpoint specs |
| [api/connections.md](api/connections.md) | Connection CRUD and sharing endpoint specs |
| [api/resources.md](api/resources.md) | Secrets, recordings, audit, sync, and notification specs |
| [api/sessions.md](api/sessions.md) | Session lifecycle endpoint specs |
| [api/user.md](api/user.md) | User account and MFA endpoint specs |
| [api/vault.md](api/vault.md) | Vault lock/unlock endpoint specs |
| [api/websocket.md](api/websocket.md) | WebSocket protocol specs for SSH, desktop, and notifications |

### Security
| File | Description |
|------|-------------|
| [security/authentication.md](security/authentication.md) | Vault session lifecycle, token binding, tunnel auth, LDAP |
| [security/encryption.md](security/encryption.md) | AES-256-GCM, Argon2id parameters, key derivation, recovery keys |
| [security/policies.md](security/policies.md) | ABAC evaluation, DLP enforcement, re-encryption, impossible travel |
| [security/production.md](security/production.md) | Production deployment security checklist |

### Database Schema
| File | Description |
|------|-------------|
| [database/overview.md](database/overview.md) | Schema overview and migration model |
| [database/core-models.md](database/core-models.md) | User, Tenant, Team, Connection, Folder models |
| [database/vault-models.md](database/vault-models.md) | VaultSecret, SharedSecret, ExternalVaultProvider models |
| [database/gateway-models.md](database/gateway-models.md) | Gateway, SshKeyPair, ManagedGatewayInstance models |
| [database/session-models.md](database/session-models.md) | ActiveSession and SessionRecording models |
| [database/supporting-models.md](database/supporting-models.md) | RefreshToken, AccessPolicy, SyncProfile, and more |
| [database/enums.md](database/enums.md) | All enum types (ConnectionType, TenantRole, AuditAction, etc.) |

### Frontend Components
| File | Description |
|------|-------------|
| [components/overview.md](components/overview.md) | Tech stack, page inventory, component counts |
| [components/ui-components.md](components/ui-components.md) | 88+ component catalog organized by function |
| [components/stores.md](components/stores.md) | 17 Zustand store definitions with fields and actions |
| [components/hooks.md](components/hooks.md) | 15 custom hook signatures and purposes |
| [components/api-layer.md](components/api-layer.md) | 40 API module inventory |

### Guides
| File | Description |
|------|-------------|
| [guides/tunnel-implementation-guide.md](guides/tunnel-implementation-guide.md) | Binary tunnel protocol spec, TunnelBroker architecture |
| [guides/zero-trust-tunnel-user-guide.md](guides/zero-trust-tunnel-user-guide.md) | Tunnel deployment for Docker, Compose, Kubernetes, systemd |

### Reference
| File | Description |
|------|-------------|
| [environment.md](environment.md) | Complete environment variable catalog (100+ vars) |
| [installer.md](installer.md) | Installer workflow, artifacts, recovery procedures |
| [agent-orchestration-gateway.md](agent-orchestration-gateway.md) | Future agent orchestration system specification |
| [infrastructure-roadmap.md](infrastructure-roadmap.md) | Architecture evolution and decomposition roadmap |
| [rag-summary.md](rag-summary.md) | Condensed product overview for RAG/LLM consumption |
| [go-refactor-handoff.md](go-refactor-handoff.md) | Node-to-Go migration completion summary |

## 🚀 Quick Start

```bash
git clone https://github.com/dnviti/arsenale.git
cd arsenale
npm install
make setup
make dev
npm run dev:client
```

If you want the repo root to orchestrate both steps, `npm run dev` runs `make dev` in `predev`, waits for the Go services to become healthy, and then starts Vite on `https://localhost:3005`.

For headless local reruns, store the technician password in `install/password.txt`.
The repo wrapper auto-detects that file and passes it to installer-backed `make`
targets as `install_password_file`.

Primary local URLs:

| URL | Purpose |
|-----|---------|
| `https://localhost:3000` | Containerized HTTPS client and reverse proxy |
| `https://localhost:3005` | Local Vite frontend with HMR |
| `http://127.0.0.1:18080/healthz` | Control-plane service health |
| `http://127.0.0.1:18090/healthz` | Terminal broker health |
| `http://127.0.0.1:18091/healthz` | Desktop broker health |
| `http://127.0.0.1:18092/healthz` | Tunnel broker health |
| `http://127.0.0.1:18093/healthz` | Query runner health |

Default dev bootstrap credentials come from `deployment/ansible/inventory/group_vars/all/vars.yml`:

```text
admin@example.com / DevAdmin123!
```

## 🧩 Technology Stack

| Layer | Technologies |
|-------|-------------|
| Frontend | React 19, Vite 8, Material UI 7, Zustand, Monaco, XTerm.js |
| Control plane | Go 1.25, 17 split services in `backend/cmd/*` |
| Runtime brokers | `terminal-broker`, `desktop-broker`, `tunnel-broker`, `query-runner` |
| Gateways | `ssh-gateway`, `guacd`, `guacenc`, `db-proxy`, bundled `tunnel-agent` |
| Data | PostgreSQL 16, Redis 7, recordings and drive volumes |
| Installer and ops | Ansible, Podman Compose, Helm, encrypted installer artifacts |
| Operator tooling | Go CLI in `tools/arsenale-cli` |

## 🏗 Runtime Snapshot

```mermaid
flowchart LR
    Browser["Browser / SPA"] --> Client["client :3000 / :8080"]
    Browser --> PublicConfig["GET /api/auth/config"]
    CLI["arsenale CLI"] --> API["control-plane-api :18080 / :8080"]
    Extension["Browser extension"] --> Client

    Client --> API
    PublicConfig --> API
    Client --> Desktop["desktop-broker :18091 / :8091"]
    Client --> Terminal["terminal-broker :18090 / :8090"]

    API --> Postgres["postgres"]
    API --> Redis["redis"]
    API --> Features["runtimefeatures.Manifest"]
    API --> Tunnel["tunnel-broker :18092 / :8092"]
    API --> SSH["ssh-gateway"]
    API --> Guacd["guacd"]
    API --> DBProxy["db-proxy gateways"]
    API --> Guacenc["guacenc"]

    Desktop --> Guacd
    Terminal --> SSH
    DBProxy --> Targets["PostgreSQL / MySQL / MongoDB / Oracle / SQL Server"]
```

## 📦 Repository Layout

```text
arsenale/
├── backend/                   # Go services, internal packages, migrations, contracts
├── client/                    # React SPA, API clients, dialogs, database UI, settings
├── gateways/
│   ├── gateway-core/          # Shared gateway library
│   ├── rdgw/                  # RD Gateway protocol handler
│   ├── db-proxy/              # DB proxy container with bundled tunnel agent
│   ├── ssh-gateway/           # SSH bastion + gRPC key management
│   ├── guacd/                 # RDP/VNC daemon with optional tunnel agent
│   ├── guacenc/               # Recording conversion sidecar
│   └── tunnel-agent/          # Zero-trust tunnel client workspace
├── deployment/ansible/        # Installer playbooks, roles, templates, and status tooling
├── deployment/helm/           # Helm chart for the Kubernetes backend
├── scripts/                   # Migration, verification, security, and acceptance helpers
├── tools/arsenale-cli/        # Go CLI used for smoke tests and operator workflows
└── docs/                      # Generated and hand-authored technical documentation
```

## 🔎 Current Source Of Truth

- Runtime behavior lives in `backend/cmd/*`, `backend/internal/*`, and `gateways/*`.
- Public route registration lives in `backend/cmd/control-plane-api/routes*.go`.
- Runtime capability switches live in `backend/internal/runtimefeatures/manifest.go`.
- Public auth and feature discovery lives in `GET /api/auth/config` via `backend/internal/publicconfig/service.go`.
- Installer entrypoints live in `deployment/ansible/playbooks/install.yml` and `deployment/ansible/playbooks/status.yml`.

## 🗺 Current Documentation Deltas

- The installer entrypoint is now `playbooks/install.yml`; `playbooks/deploy.yml` is the shared apply engine underneath it.
- Development mode always deploys the full stack, demo databases, managed gateways, and tunneled gateway fixtures.
- Production mode is installer-profile-driven and can target Podman or Kubernetes; Docker is not a supported installer backend.
- `make status` reads encrypted installer status and is part of the normal operator workflow.
- Session recording now supports both SSH (asciicast `.cast`) and desktop (Guacamole `.guac`) formats.
- The agent plane includes model-gateway, tool-gateway, agent-orchestrator, and memory-service.
- The capability catalog defines risk-rated permissions used by the agent orchestration system.
