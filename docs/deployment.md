---
title: Deployment
description: Installer flow, container backends, TLS, demo fixtures, and CI/CD for Arsenale
generated-by: claw-docs
generated-at: 2026-04-03T11:29:03Z
source-files:
  - Makefile
  - backend/Dockerfile
  - client/Dockerfile
  - gateways/db-proxy/Dockerfile
  - gateways/ssh-gateway/Dockerfile
  - gateways/guacd/Dockerfile
  - gateways/guacenc/Dockerfile
  - gateways/tunnel-agent/Dockerfile
  - docker-compose.yml
  - deployment/ansible/README.md
  - deployment/ansible/install/capabilities.yml
  - deployment/ansible/playbooks/install.yml
  - deployment/ansible/playbooks/status.yml
  - deployment/ansible/playbooks/deploy.yml
  - deployment/ansible/roles/deploy/templates/compose.yml.j2
  - .github/workflows/docker-build.yml
  - .github/workflows/gateways-build.yml
  - .github/workflows/security.yml
  - .github/workflows/verify.yml
  - .github/workflows/release.yml
---

## 🎯 Deployment Model

Arsenale now has one installer-driven deployment story for both development and production:

- `Makefile` is the human entry point,
- `deployment/ansible/playbooks/install.yml` is the interactive installer entrypoint,
- `deployment/ansible/playbooks/status.yml` reads encrypted installer status,
- `deployment/ansible/playbooks/deploy.yml` is the shared apply engine under the installer,
- `deployment/ansible/roles/deploy/templates/compose.yml.j2` is the authoritative Podman Compose template.

```mermaid
flowchart TD
    Make["make dev / install / deploy / status"] --> Entry["install.yml or status.yml"]
    Entry --> Artifacts["encrypted installer artifacts"]
    Entry --> Apply["deploy.yml shared apply engine"]
    Apply --> Render["compose.yml.j2 or Helm render"]
    Render --> Runtime["Podman Compose or Kubernetes"]
    Runtime --> Bootstrap["dev bootstrap + demo DB seeding"]
```

The checked-in `docker-compose.yml` mirrors the current generated development stack, but the installer flow and Ansible templates remain the source of truth.

## 🔐 Installer Artifacts

The installer owns an encrypted artifact set in addition to the Ansible vault. The canonical production location is:

```text
/opt/arsenale/install/
```

Artifacts:

- `install-profile.enc`
- `install-state.enc`
- `install-status.enc`
- `install-log.enc`
- `rendered-artifacts.enc`

Operational consequences:

- `make status` reads `install-status.enc`, not the live app database.
- reruns and recovery do not depend on a healthy Arsenale instance,
- the technician password is requested again on every rerun and is never stored on disk.

## 🐳 And ☸ Supported Backends

Supported installer backends:

- Podman Compose
- Kubernetes via Helm

Docker is not a supported installer backend. Development installs also require Podman locally because `playbooks/install.yml` asserts that `podman` is available before it will apply the stack.

The capability catalog in `deployment/ansible/install/capabilities.yml` lets production profiles toggle:

- keychain
- connections
- databases
- recordings
- zero trust
- agentic AI
- enterprise auth
- sharing and approvals
- CLI

Development mode always deploys the full stack and fixture set regardless of production defaults.

## 🐳 Image Build Matrix

| Image | Built from | Notes |
|-------|------------|-------|
| `control-plane-api` | `backend/Dockerfile` with `SERVICE=control-plane-api` | Generic Go service image pattern |
| `client` | `client/Dockerfile` | Multi-stage Node build then nginx runtime |
| `db-proxy` | `gateways/db-proxy/Dockerfile` | Go `db-proxy` binary plus bundled `tunnel-agent` |
| `ssh-gateway` | `gateways/ssh-gateway/Dockerfile` | Alpine runtime, SSHD, gRPC key server, tunnel agent |
| `guacd` | `gateways/guacd/Dockerfile` | Alpine runtime, Guacamole server packages, tunnel agent |
| `guacenc` | `gateways/guacenc/Dockerfile` | Custom build with `guacenc`, `agg`, and Go wrapper |
| `tunnel-agent` | `gateways/tunnel-agent/Dockerfile` | Standalone tunnel agent workspace |

Important implementation details:

- `backend/Dockerfile` is service-agnostic: it builds `/usr/local/bin/service` from `backend/cmd/${SERVICE}` and always also builds `/usr/local/bin/migrate`.
- `client/Dockerfile` serves the built SPA through nginx and exposes `/health`.
- `gateways/db-proxy/Dockerfile` bundles the Go database middleware plus the JS tunnel agent workspace.

## 🖧 Runtime Topology In Development

Key host-to-container mappings from `docker-compose.yml`:

| Host port | Service | Container port |
|-----------|---------|----------------|
| `3000` | `client` | `8080` |
| `18080` | `control-plane-api` | `8080` |
| `18081` | `control-plane-controller` | `8081` |
| `18082` | `authz-pdp` | `8082` |
| `18083` | `model-gateway` | `8083` |
| `18084` | `tool-gateway` | `8084` |
| `18085` | `agent-orchestrator` | `8085` |
| `18086` | `memory-service` | `8086` |
| `18090` | `terminal-broker` | `8090` |
| `18091` | `desktop-broker` | `8091` |
| `18092` | `tunnel-broker` | `8092` |
| `18093` | `query-runner` | `8093` |
| `18095` | `runtime-agent` | `8095` |

Primary internal networks:

| Network | Use |
|---------|-----|
| `net-edge` | Public-facing services and internal service calls |
| `net-db` | PostgreSQL and database-adjacent services |
| `net-cache` | Redis-backed coordination |
| `net-guacd` | Desktop broker and `guacd` |
| `net-guacenc` | Recording conversion |
| `net-gateway` | SSH gateway and managed gateway workloads |
| `net-egress` | Tunneled gateway egress fixtures |

## ⚙️ Runtime Env Emitted By The Installer

The compose template now emits more deployment intent into the running services:

- `ARSENALE_INSTALL_MODE`
- `ARSENALE_INSTALL_BACKEND`
- `ARSENALE_INSTALL_CAPABILITIES`
- `FEATURE_*`
- `CLI_ENABLED`
- `GATEWAY_ROUTING_MODE`
- `ORCHESTRATOR_*`
- `DEV_BOOTSTRAP_*`
- `DEV_SAMPLE_*`

That matters because the control plane uses those env vars to register routes, expose public config, and pick routing behavior for gateways and database sessions.

## 🔐 TLS, Secrets, And Container Hardening

Arsenale deploys with TLS everywhere practical.

### Certificates

- Dev and production certificate generation are handled by the `certificates` role.
- Local development also uses `dev-certs/generate.sh`.
- Generated certs cover client HTTPS, PostgreSQL TLS, `guacd`, `guacenc`, SSH gateway gRPC, and tunnel identities.

### Secrets

Runtime secrets are delivered through secret mounts, not plain environment strings, for:

- database URL
- JWT secret
- guacamole secret
- server encryption key
- guacenc auth token
- provider credentials

### Hardening

Most services in the compose template use a consistent hardening profile:

- `read_only: true`
- `cap_drop: [ALL]`
- `security_opt: [no-new-privileges:true]`
- `tmpfs` for writable scratch paths
- health checks for service readiness

Some containers intentionally run as `0:0` during startup when they must prepare runtime directories before execing the service binary. That behavior is explicit in the template and should not be removed casually.

## 🧪 Development Fixtures And Demo Data

The development installer flow does more than boot the app. It also:

- runs `service dev-bootstrap` inside `arsenale-control-plane-api`,
- creates development gateway fixtures,
- provisions tunneled gateway fixtures,
- seeds five sample database containers,
- pushes managed tenant SSH keys to all managed gateways after bootstrap.

Demo data containers:

| Container | Protocol |
|-----------|----------|
| `arsenale-dev-demo-postgres` | PostgreSQL |
| `arsenale-dev-demo-mysql` | MySQL / MariaDB |
| `arsenale-dev-demo-mongodb` | MongoDB |
| `arsenale-dev-demo-oracle` | Oracle |
| `arsenale-dev-demo-mssql` | SQL Server |

Tunneled gateway fixtures:

| Container | Purpose |
|-----------|---------|
| `arsenale-dev-tunnel-ssh-gateway` | Managed SSH via tunnel broker |
| `arsenale-dev-tunnel-guacd` | Desktop proxy via tunnel broker |
| `arsenale-dev-tunnel-db-proxy` | Database proxy via tunnel broker |

This makes the dev stack suitable for full-stack session, gateway, and DB proxy testing without touching the application's own PostgreSQL data.

## 🚢 CI/CD Workflows

| Workflow | Purpose |
|----------|---------|
| `.github/workflows/verify.yml` | Typecheck, lint, audit, tests, and builds |
| `.github/workflows/security.yml` | CodeQL and Trivy filesystem scanning |
| `.github/workflows/docker-build.yml` | Backend and client verify, image build, scan, and push |
| `.github/workflows/gateways-build.yml` | Gateway Go tests, image build, scan, and push |
| `.github/workflows/release.yml` | Cross-platform CLI build, checksums, and GitHub release draft |

Notable facts from the workflow definitions:

- backend verification includes `go vet` and `go test -race`,
- gateway verification runs `go vet` and `go test -race` for the Go modules under `gateways/`,
- release artifacts currently center on the CLI, not full application bundles.

## 🛠 Common Deployment Operations

```bash
make setup
make install
make deploy
make configure
make recover
make status
make dev
make dev-down
make logs SVC=arsenale-control-plane-api
make certs
make backup
make rotate
```

Useful script-level entry points:

```bash
./scripts/db-migrate.sh status
./scripts/db-migrate.sh up
./scripts/security-scan.sh --quick
./scripts/go-test-all.sh
./scripts/go-build-all.sh
```

`scripts/db-migrate.sh` now auto-detects a container runtime, supports `ARSENALE_COMPOSE_FILE` and related overrides, and uses `deployment/ansible/scripts/run_compose_service.py` for Podman one-shot migration runs.

## 📌 Practical Notes

- Development and production share the same installer model, but not the same runtime scope; development always enables the full fixture set.
- `make status` is part of the deployment contract because installer state is encrypted and persistent outside the app database.
- Podman is mandatory for installer-aware local development, even though the migration helper can target Docker when used outside the installer flow.
- The DB proxy and tunnel fixtures are part of the supported dev stack, not ad hoc extras.
