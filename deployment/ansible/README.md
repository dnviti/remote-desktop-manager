# Arsenale -- Ansible Deployment Guide

CLI-only, installer-aware deployment of Arsenale for **Podman Compose** and **Kubernetes (Helm)**. The installer keeps its own encrypted profile, state, status, log, and rendered artifacts so reruns and external status reads do not depend on a running Arsenale instance.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Quick Start via Makefile](#quick-start-via-makefile)
- [Installation Modes](#installation-modes)
  - [Development Mode](#development-mode)
  - [Production Mode](#production-mode)
- [Backends](#backends)
  - [Podman Compose](#podman-compose-backend)
  - [Kubernetes via Helm](#kubernetes-via-helm-backend)
- [Interactive Installer Walkthrough](#interactive-installer-walkthrough)
  - [Fresh Install](#fresh-install-walkthrough)
  - [Development Install](#development-install-walkthrough)
  - [Production Podman Install](#production-podman-install-walkthrough)
  - [Production Kubernetes Install](#production-kubernetes-install-walkthrough)
- [Capabilities](#capabilities)
- [Ansible Roles Reference](#ansible-roles-reference)
  - [prerequisites](#role-prerequisites)
  - [certificates](#role-certificates)
  - [podman_secrets](#role-podman_secrets)
  - [firewall](#role-firewall)
  - [deploy](#role-deploy)
  - [render_compose](#role-render_compose)
  - [apply_compose](#role-apply_compose)
  - [render_helm](#role-render_helm)
  - [apply_helm](#role-apply_helm)
  - [healthcheck](#role-healthcheck)
  - [install_artifacts](#role-install_artifacts)
  - [install_diff](#role-install_diff)
- [Playbooks Reference](#playbooks-reference)
- [Secret Management](#secret-management)
- [Configuration Reference](#configuration-reference)
- [Inventory](#inventory)
- [Firewall](#firewall)
- [Backup and Restore](#backup-and-restore)
- [Operations](#operations)
- [Encrypted Installer Artifacts](#encrypted-installer-artifacts)
- [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
Control Node                         Target Host (Podman backend)
+------------------+                 +---------------------------------------+
|  Makefile         |                 | /opt/arsenale/                        |
|  install.yml      |---SSH+sudo---->|   arsenale/   (git repo, if building) |
|  deploy.yml       |                |   certs/      (TLS, per-service)      |
|  status.yml       |                |   config/     (ssh-gateway)           |
|  ansible-vault    |                |   install/    (encrypted artifacts)   |
|                   |                |   backups/    (pg_dump)               |
+------------------+                 |   docker-compose.yml                  |
                                     |   .env        (transient)             |
                                     |                                       |
                                     | Podman secrets: /run/secrets/*        |
                                     | Rootless containers via systemd user  |
                                     +---------------------------------------+

Control Node                         Kubernetes Cluster
+------------------+                 +---------------------------------------+
|  Makefile         |                 | Namespace: arsenale                   |
|  install.yml      |---kubectl----->|   Deployments, Services, ConfigMaps   |
|  deploy.yml       |                |   Secrets, PVCs, Ingress              |
|  ansible-vault    |                |   Helm release: arsenale              |
+------------------+                 +---------------------------------------+
```

The installer resolves one desired profile, then renders either Compose artifacts or Helm manifests from that same model. The checked-in `docker-compose.yml` mirrors the current generated development stack, but the installer flow and Ansible templates remain the source of truth.

---

## Prerequisites

### Control node (the machine running Ansible)

| Requirement | Recommended Version | Purpose |
|-------------|---------------------|---------|
| Ansible | `2.15+` | Installer, deploy, status, and recovery flows |
| Python 3 | `3.9+` | Ansible helpers, installer scripts |
| Git | `2.x` | Repository operations |
| OpenSSL | `3.x` | Certificate generation |
| `kubectl` + `helm` | Latest stable | Required only for Kubernetes backend |

### Ansible Collections

Three Ansible Galaxy collections are required. They are installed automatically by `make setup`:

```yaml
# requirements.yml
collections:
  - name: community.general      # Random string generation, system utilities
  - name: community.crypto        # TLS certificate generation (ECC P-256)
  - name: containers.podman       # Podman container and secret management
```

Manual install:

```bash
ansible-galaxy collection install community.general community.crypto containers.podman
```

### Target host (Podman backend)

| Requirement | Notes |
|-------------|-------|
| Linux with systemd | Fedora, RHEL, Debian, Ubuntu, Arch |
| SSH access with sudo | Ansible connects via SSH |
| Python 3 | `3.9+` for Ansible module execution |
| Podman | Installed automatically by the `prerequisites` role |

### Target host (Kubernetes backend)

| Requirement | Notes |
|-------------|-------|
| Kubernetes cluster | Any conformant cluster (EKS, GKE, AKS, minikube, etc.) |
| `kubectl` configured | With access to the target cluster |
| Helm 3 | For chart installation |
| Podman (control node) | Required for building container images |

Docker is **not** a supported installer backend.

---

## Quick Start via Makefile

The preferred way to interact with Ansible is through the root `Makefile`. All commands are run from the repository root.

```bash
# First-time setup
make setup            # Install Ansible collections and prepare the local vault

# Development
make dev              # Start the installer-aware development stack
make dev client       # Refresh only the client container
make dev gateways     # Refresh gateway containers from the saved dev profile
make dev control-plane # Refresh backend/control-plane services from the saved dev profile
npm run dev:client    # Optional: start Vite on https://localhost:3005

# Production
make install          # Interactive installer (prompts for mode, backend, capabilities)
make deploy           # Deploy or update production stack
make configure        # Reconfigure an existing install
make recover          # Rerun recovery flow

# Operations
make status           # Read encrypted installer status
make backup           # Database backup
make rotate           # Rotate secrets
make vault            # Generate or edit Ansible Vault
make certs            # Regenerate TLS certificates
make logs SVC=name    # Follow service logs (omit SVC= for all)
make clean            # Stop and remove all containers and volumes
make help             # Show all available targets
```

### Vault password handling

The Makefile automatically detects how to supply the vault password:

1. If `ANSIBLE_VAULT_PASSWORD_FILE` is set, it uses that file.
2. If `deployment/ansible/.vault-pass` exists, it uses that file.
3. If the vault file is encrypted, it prompts interactively (`--ask-vault-pass`).

---

## Installation Modes

### Development Mode

Development mode uses the same installer capability model as production, but always runs locally with the Podman backend and builds images from the checked-out source tree.

```bash
make dev
```

What it does:

1. Prompts for the technician password (encrypts installer artifacts).
2. Resolves the selected capability and routing profile.
3. Renders the pruned Compose stack for the selected services.
4. Builds the selected container images from source.
5. Starts the stack via `podman-compose`.
6. Runs database migrations.
7. Executes `dev-bootstrap` to seed the admin user and tenant.
8. Runs health checks against all containers.

For code-only iteration after the full stack already exists, you can reuse the saved development installer profile and refresh only selected services:

```bash
make dev client
make dev gateways
make dev control-plane
make dev control-plane-api query-runner
```

Supported selectors include the group aliases above plus direct service names from the rendered dev stack. The scoped refresh path rebuilds only the requested images, reruns migrations when a backend service is selected, and force-recreates only the targeted containers. Use full `make dev` when you change installer inputs, capability flags, certificates, secrets, or compose/deployment wiring.

Development-specific behaviors:

- Firewall rules are **not** applied.
- Capability selection and routing use the same resolver as production installs.
- Installer-managed development state defaults to `${XDG_STATE_HOME:-$HOME/.local/state}/arsenale-dev`.
- Certificates are generated under `$ARSENALE_DEV_HOME/dev-certs/` by default.
- The client binds to `0.0.0.0` for external access.
- When `connections` is enabled, `dev-bootstrap` registers the local `ssh-gateway` and `guacd` containers as tenant gateways.
- Endpoint-facing runtime services attach to `net-egress`: local `ssh-gateway` and `guacd` for SSH/RDP/VNC access, local `query-runner` for direct database access, and the dev tunnel gateway fixtures for zero-trust SSH/RDP/VNC/database access.
- When `recordings` is disabled, the installer also disables session capture and recording-ready notifications, not just the `/api/recordings` routes.
- Demo database services follow the enabled development capabilities, so the default `make dev` profile includes them. Tunnel fixtures still require `DEV_ZERO_TRUST=true`.

After `make dev` completes:

| URL | Purpose |
|-----|---------|
| `https://localhost:3000` | Containerized client (nginx reverse proxy) |
| `https://localhost:3005` | Local Vite frontend (run `npm run dev:client`) |
| `http://127.0.0.1:18080/healthz` | Control-plane API health |

Default dev credentials:

```
Email:    admin@example.com
Password: ArsenaleTemp91Qx
Tenant:   Development Environment
```

### Production Mode

Production mode deploys **only the selected capabilities**. It supports two backends (Podman Compose and Kubernetes via Helm) and connects to a remote target host over SSH (Podman) or uses the local kubectl context (Kubernetes).

```bash
make install    # Interactive: prompts for mode, backend, capabilities
make deploy     # Non-interactive: uses existing profile or defaults to production
make configure  # Reconfigure: prompts for production changes
```

Production-specific behaviors:

- Only selected capabilities are rendered and deployed.
- The `prerequisites` role installs system dependencies on the target host.
- The `firewall` role configures nftables rules (when `arsenale_firewall_enabled: true`).
- API health endpoints are validated after deploy.
- Secrets are verified to be mounted via Podman secrets, not environment variables.
- Images can be built from source or pulled from a registry.

---

## Backends

### Podman Compose Backend

Podman Compose is the default backend. It deploys rootless containers via `podman-compose` on a systemd-based Linux host.

Key characteristics:

- **Rootless**: Containers run under the `arsenale` system user, not root.
- **Systemd integration**: Uses `loginctl enable-linger` for persistent user sessions.
- **Podman socket**: Enabled for the `arsenale` user at `$XDG_RUNTIME_DIR/podman/podman.sock`.
- **Secrets**: Runtime secrets are injected via Podman secrets at `/run/secrets/`, not environment variables.
- **TLS**: ECC P-256 certificates generated per service.
- **Hardening**: Containers use `read_only: true`, `cap_drop: [ALL]`, `no-new-privileges`.

Targeting a remote host:

```bash
# Via environment variables
export ARSENALE_HOST=192.168.1.100
export ARSENALE_DEPLOY_USER=deploy
make install

# Via inventory file
# Edit deployment/ansible/inventory/hosts.yml
```

### Kubernetes via Helm Backend

The Kubernetes backend generates a values-driven Helm chart from the resolved installer profile. Ansible renders the chart and installs it via `helm upgrade --install`.

Key characteristics:

- **Chart generation**: `compose_to_k8s.py` converts the Docker Compose template into Kubernetes manifests (Deployments, Services, ConfigMaps, Secrets, PVCs).
- **Helm values**: A `values.generated.yaml` is produced from the installer profile.
- **Ingress**: Configurable ingress class, host, and TLS settings.
- **Scaling**: Configurable replica counts and optional HPA autoscaling.
- **Storage**: Configurable storage class for PVCs.

Interactive prompts for Kubernetes:

| Prompt | Default | Description |
|--------|---------|-------------|
| Namespace | `arsenale` | Kubernetes namespace |
| Ingress class | `nginx` | Ingress controller class |
| Ingress host | `arsenale_domain` value | Hostname for ingress rules |
| Ingress TLS | `true` | Enable TLS on ingress |
| Replica count | `1` | Number of replicas per service |

Additional Kubernetes variables (set via `-e` or in vars):

| Variable | Description |
|----------|-------------|
| `installer_storage_class` | Storage class for PVCs |
| `installer_image_pull_secrets` | Image pull secrets (list) |
| `installer_kube_resources` | Resource requests/limits per service |
| `installer_kube_autoscaling` | HPA configuration (`{'enabled': false}`) |
| `installer_kube_node_selector` | Node selector labels |
| `installer_kube_tolerations` | Pod tolerations |

---

## Interactive Installer Walkthrough

### Fresh Install Walkthrough

The installer is driven by `playbooks/install.yml`. It collects inputs interactively, resolves a desired profile, computes a diff against the current state, and applies only the required delta.

**Step 1: Run the installer**

```bash
make install
```

**Step 2: Enter the technician password**

```
Technician password: ********
```

This password encrypts all installer artifacts at rest. It is **never stored on disk** and must be re-entered on every run. Use the same password for subsequent runs to decrypt existing state.

**Step 3: Choose the installation mode**

```
Installation mode [development/production]: production
```

- `development`: Capability-selected local install with source-built images.
- `production`: Selective capabilities, remote or local target.

**Step 4: Choose the backend** (production only)

```
Backend [podman/kubernetes]: podman
```

**Step 5: Configure routing** (production only)

```
Enable direct gateway routing [true/false]: true
Enable zero-trust routing [true/false]: false
```

**Step 6: Select capabilities** (production only)

```
Enabled optional capabilities (comma-separated): multi_tenancy,connections,ip_geolocation,databases,recordings,agentic_ai,enterprise_auth,sharing_approvals,cli
```

**Step 7: Review the execution plan**

The installer displays the classified plan:

```
Run type:  fresh_install
Backend:   podman
Mode:      production
Services:  control-plane-api, authz-pdp, client, postgres, guacd, guacenc, ssh-gateway, ...
Added:     keychain, multi_tenancy, connections, databases, recordings, agentic_ai, enterprise_auth, sharing_approvals, cli
Removed:   none
```

**Step 8: Automated apply**

The installer then:

1. Installs prerequisites on the target host.
2. Generates TLS certificates.
3. Creates Podman secrets.
4. Renders and prunes the Compose file for selected services.
5. Builds or pulls container images.
6. Starts the stack via `podman-compose`.
7. Configures nftables firewall rules.
8. Runs health checks.
9. Encrypts and persists profile, state, status, log, and render metadata.

### Development Install Walkthrough

```bash
make dev
```

The development flow is simplified:

1. **Technician password**: Prompted once.
2. **Mode**: Automatically set to `development`.
3. **Backend**: Forced to `podman`.
4. **Capabilities**: All enabled automatically.
5. **Routing**: Both direct gateway and zero-trust enabled.
6. **Apply**: Full stack rendered and started locally.
7. **Post-apply**: Bootstrap + ERP-style demo database seeding + gateway fixture provisioning.

### Production Podman Install Walkthrough

```bash
export ARSENALE_HOST=10.0.1.50
make install
```

1. **Technician password**: Prompted.
2. **Mode**: `production`.
3. **Backend**: `podman`.
4. **Routing + Capabilities**: Prompted interactively.
5. **Target**: Connects to `10.0.1.50` via SSH as the deploy user.
6. **Prerequisites**: Installs Podman, creates `arsenale` system user, enables lingering.
7. **Certificates**: Generates ECC P-256 TLS certs for all services.
8. **Secrets**: Creates Podman secrets for runtime injection.
9. **Render**: Generates `docker-compose.yml` with only selected services.
10. **Build/Pull**: Pulls published images by default; only clones/builds from source when `arsenale_build_images: true`.
11. **Apply**: Starts containers via `podman-compose`.
12. **Firewall**: Configures nftables.
13. **Health checks**: Validates all containers are healthy, API responds, secrets are mounted.
14. **Artifacts**: Encrypts and persists installer state.

### Production Kubernetes Install Walkthrough

```bash
make install
# Mode: production
# Backend: kubernetes
```

1. **Technician password**: Prompted.
2. **Mode**: `production`.
3. **Backend**: `kubernetes`.
4. **Kubernetes config**: Prompted for namespace, ingress class, host, TLS, replicas.
5. **Routing + Capabilities**: Prompted interactively.
6. **Render**: Generates `docker-compose.yml` then converts to Kubernetes manifests via `compose_to_k8s.py`.
7. **Helm chart**: Copies chart skeleton, generates `values.generated.yaml`.
8. **Build**: Reuses published images by default; only builds via Podman if `arsenale_build_images: true`.
9. **Lint**: Runs `helm lint` on the chart.
10. **Install**: Runs `helm upgrade --install arsenale`.
11. **Wait**: Waits for PVCs to bind, Deployments to roll out, migration Job to complete.
12. **Artifacts**: Encrypts and persists installer state.

---

## Capabilities

Capabilities control which services are included in the rendered runtime. They are defined in `deployment/ansible/install/capabilities.yml` and are **installer-owned only** -- they are not a product-side module system.

| Capability | Title | Default | Description | Dependencies |
|------------|-------|---------|-------------|-------------|
| `core` | Core Platform | **Required** | Base platform services plus the tenant vault/keychain | -- |
| `keychain` | Keychain | **Required** | Tenant vault, secret storage, external vault integration, password rotation | -- |
| `multi_tenancy` | Multi-Tenancy | Enabled | Multiple organizations per platform with tenant switching and self-service organization creation | -- |
| `connections` | Connections | Enabled | SSH, RDP, VNC connections and folders | -- |
| `ip_geolocation` | IP Geolocation | Enabled | External IP lookups, geolocation audit overlays, and the dedicated `map-assets` tile service | -- |
| `databases` | Databases | Enabled | Database proxy and SQL tooling | `connections` |
| `recordings` | Recordings | Enabled | Session recording and video export | `connections` |
| `zero_trust` | Zero Trust | **Disabled** | Tunnel broker, runtime agent, managed zero-trust gateway path | -- |
| `agentic_ai` | Agentic AI | Enabled | Model gateway, tool gateway, memory service, AI-assisted tooling | -- |
| `enterprise_auth` | Enterprise Auth | Enabled | SAML, OIDC, OAuth provider, LDAP surfaces | -- |
| `sharing_approvals` | Sharing And Approvals | Enabled | External sharing, approvals, check-outs | -- |
| `cli` | CLI | Enabled | Device auth and CLI support | -- |

When a capability is disabled:

- Its services are removed from the rendered Compose/Helm output.
- Backend routes and frontend affordances for that capability are removed.
- Persistent data is **not** deleted during capability removal or recovery.
- When `multi_tenancy` is disabled, setup and `dev-bootstrap` can still provision the initial organization, but tenant creation and tenant switching are removed from the product surface afterward.

In **development mode**, capability selection and routing resolve exactly like production; the development-specific difference is local Podman execution with source-built images.

---

## Ansible Roles Reference

### Role: prerequisites

**Path**: `roles/prerequisites/tasks/main.yml`

Prepares the target host for Arsenale deployment. Only runs in production mode for Podman backends.

**Tasks performed**:

1. Install system dependencies: `openssl`, `git`.
2. Install Podman based on OS family:
   - **RedHat/Fedora**: `dnf install podman podman-compose`
   - **Debian/Ubuntu**: `apt install podman podman-compose`
   - **Arch**: `pacman -S podman podman-compose`
3. Create `arsenale` system user with home at `/opt/arsenale`.
4. Enable `loginctl` lingering for rootless Podman persistence.
5. Start systemd user manager for the `arsenale` user.
6. Enable Podman socket for the user.
7. Create deployment directories: `config/ssh-gateway/`, `certs/`, `backups/`.
8. Clone the Arsenale Git repository (if building from source).
9. Migrate legacy authorized_keys directory to file format.
10. Initialize empty `authorized_keys` file for the SSH gateway.

### Role: certificates

**Path**: `roles/certificates/tasks/main.yml`

Generates and manages TLS certificates for all Arsenale services using ECC P-256 keys.

**Certificates generated**:

| Certificate | Purpose | SANs |
|-------------|---------|------|
| CA | Self-signed root CA | -- |
| `client` | Web UI HTTPS | `localhost`, `arsenale_domain`, detected IPs (dev) |
| `control-plane-api` | Internal API TLS | `control-plane-api`, `localhost` |
| `postgres` | Database TLS | `postgres`, `localhost` |
| `guacenc` | Encoding service | `guacenc`, `localhost` |
| `guacd` | Guacamole daemon | `guacd`, `localhost` |
| `ssh-gateway` | SSH gateway + client auth | `ssh-gateway`, `localhost` |

**Development-only certificates**:

| Certificate | Purpose |
|-------------|---------|
| `tunnel-managed-ssh` | Tunnel gateway SSH identity |
| `tunnel-guacd` | Tunnel gateway desktop identity |
| `tunnel-db-proxy` | Tunnel gateway DB proxy identity |

**Certificate parameters**:

| Parameter | Default | Variable |
|-----------|---------|----------|
| Service cert validity | 365 days | `arsenale_cert_validity_days` |
| CA cert validity | 3650 days | `arsenale_ca_validity_days` |
| Key type | ECC P-256 | -- |

The role detects stale certificates (e.g., missing SANs when IPs change in dev) and regenerates them automatically.

Uses Ansible modules: `community.crypto.openssl_privatekey`, `community.crypto.openssl_csr`, `community.crypto.x509_certificate`.

### Role: podman_secrets

**Path**: `roles/podman_secrets/tasks/main.yml`

Creates Podman secrets for secure runtime secret injection. Secrets are mounted at `/run/secrets/<name>` inside containers, never as environment variables.

**Secrets managed** (21 total, only non-empty ones are created):

| Secret | Source Variable | Required |
|--------|----------------|----------|
| `jwt_secret` | `vault_jwt_secret` | Yes |
| `guacamole_secret` | `vault_guacamole_secret` | Yes |
| `server_encryption_key` | `vault_server_encryption_key` | Yes |
| `database_url` | `vault_database_url` | Yes |
| `postgres_password` | `vault_postgres_password` | Yes |
| `guacenc_auth_token` | `vault_guacenc_auth_token` | Yes |
| `smtp_pass` | `vault_smtp_pass` | No |
| `sendgrid_api_key` | `vault_sendgrid_api_key` | No |
| `ses_secret_access_key` | `vault_ses_secret_access_key` | No |
| `resend_api_key` | `vault_resend_api_key` | No |
| `mailgun_api_key` | `vault_mailgun_api_key` | No |
| `twilio_auth_token` | `vault_twilio_auth_token` | No |
| `sns_secret_access_key` | `vault_sns_secret_access_key` | No |
| `vonage_api_secret` | `vault_vonage_api_secret` | No |
| `google_client_secret` | `vault_google_client_secret` | No |
| `microsoft_client_secret` | `vault_microsoft_client_secret` | No |
| `github_client_secret` | `vault_github_client_secret` | No |
| `oidc_client_secret` | `vault_oidc_client_secret` | No |
| `ldap_bind_password` | `vault_ldap_bind_password` | No |
| `ai_api_key` | `vault_ai_api_key` | No |

**Idempotency**: The role compares SHA256 digests of desired secret values against existing Podman secrets and only updates when digests differ.

Uses Ansible module: `containers.podman.podman_secret`.

### Role: firewall

**Path**: `roles/firewall/tasks/main.yml`

Installs and configures nftables firewall rules. Only runs in production mode when `arsenale_firewall_enabled: true`.

**Default rules**:

| Direction | Ports | Policy |
|-----------|-------|--------|
| Inbound | 22 (SSH), `arsenale_client_port` (web), `arsenale_ssh_port` (gateway) | Allow |
| Container egress | 53 (DNS), 443 (HTTPS), 25/465/587 (SMTP) | Allow |
| All other inbound | -- | Drop |
| All forwarded | -- | Drop |

**Customizable source ranges**:

```yaml
# In inventory/group_vars/all/vars.yml
arsenale_allowed_ssh_sources: ["10.0.0.0/8"]
arsenale_allowed_web_sources: ["10.0.0.0/8", "192.168.1.0/24"]
```

**Template**: `templates/arsenale-nft.conf.j2` generates the nftables configuration.

**Handler**: `reload nftables` reloads rules on configuration changes.

### Role: deploy

**Path**: `roles/deploy/tasks/main.yml`

Orchestrates the render, build, and apply phases. This role is included by `render_compose`, `apply_compose`, and the `deploy.yml` playbook.

**Sub-tasks**:

| File | Purpose |
|------|---------|
| `render.yml` | Renders `compose.yml.j2` template, writes `docker-compose.yml` and `.env` |
| `build.yml` | Builds images from Dockerfiles (dev/build mode) or pulls from registry |
| `apply.yml` | Creates volumes, starts containers via `podman-compose up` |

**Template**: `templates/compose.yml.j2` is the authoritative Docker Compose template. It emits runtime environment variables including:

- `ARSENALE_INSTALL_MODE`, `ARSENALE_INSTALL_BACKEND`, `ARSENALE_INSTALL_CAPABILITIES`
- `FEATURE_*` flags for each capability
- `GATEWAY_ROUTING_MODE`
- `DEV_BOOTSTRAP_*` and `DEV_SAMPLE_*` variables (development only)

### Role: render_compose

**Path**: `roles/render_compose/tasks/main.yml`

Renders the Compose file and prunes it for installer-selected services.

1. Includes `deploy/render.yml` to generate the full `docker-compose.yml`.
2. If installer services are selected, calls `install_model.py prune-compose` to remove unselected service definitions while preserving required networks, volumes, and dependencies.

### Role: apply_compose

**Path**: `roles/apply_compose/tasks/main.yml`

Applies the rendered Compose stack.

1. Includes `deploy/build.yml` for image building or pulling.
2. Includes `deploy/apply.yml` for container startup via `podman-compose up`.

### Role: render_helm

**Path**: `roles/render_helm/tasks/main.yml`

Generates Kubernetes manifests and Helm values from the Compose definition.

1. Verifies Podman is available (required for image build/conversion).
2. Copies the Helm chart skeleton from the source tree.
3. Renders the Compose file via `render_compose`.
4. Generates a Kubernetes secrets map from all vault secrets.
5. Generates Kubernetes options (replicas, autoscaling, storage class, tolerations, node selector).
6. Calls `compose_to_k8s.py` to convert Docker Compose into Kubernetes Deployments, Services, ConfigMaps, Secrets, and PVCs.
7. Produces `values.generated.yaml` for Helm.
8. Publishes Helm metadata facts for downstream roles.

### Role: apply_helm

**Path**: `roles/apply_helm/tasks/main.yml`

Applies the Kubernetes Helm release.

1. Builds and loads images (Podman to minikube, if applicable).
2. Lints the Helm chart (`helm lint`).
3. Runs `helm upgrade --install arsenale` with the generated values.
4. Waits for PVCs to bind.
5. Waits for Deployments to roll out.
6. Waits for the migration Job to complete.

### Role: healthcheck

**Path**: `roles/healthcheck/tasks/main.yml`

Comprehensive post-deploy validation for Compose backends.

**Checks performed**:

1. **Container health**: Waits for all containers (except `migrate`) to report `healthy` via `compose_ps_status.py`. Retries up to 72 times in dev (6 min), 24 times in prod (2 min), with 5s delay.
2. **Migration verification**: Confirms the `arsenale-migrate` container exited with code 0.
3. **API health endpoint**: Validates `http://127.0.0.1:<client_port>/api/health` returns HTTP 200 (production only).
4. **Secret isolation**: Verifies `JWT_SECRET`, `GUACAMOLE_SECRET`, and `SERVER_ENCRYPTION_KEY` are **not** present in container environment variables.
5. **Secret mounting**: Verifies Podman secrets are mounted at `/run/secrets/` in the control-plane-api container.
6. **Postgres isolation**: Verifies the postgres container only has `postgres_password` mounted, not other application secrets.
7. **Deployment summary**: Displays the public URL and SSH gateway connection string.

### Role: install_artifacts

**Path**: `roles/install_artifacts/tasks/main.yml`

Manages the encrypted installer artifact lifecycle.

**Actions**:

| Action | Description |
|--------|-------------|
| `read` | Decrypt artifacts and populate `installer_loaded_artifacts` fact |
| `write` | Encrypt plaintext artifacts from `installer_write_artifacts` dictionary |

**Artifacts managed**:

| File | Content |
|------|---------|
| `install-profile.enc` | Desired deployment profile (mode, backend, capabilities, routing) |
| `install-state.enc` | Last applied runtime state (hashes, services, timestamps) |
| `install-status.enc` | Last run result (success/failure, timestamps, health, drift) |
| `install-log.enc` | Execution log entries |
| `rendered-artifacts.enc` | Rendered compose/helm output metadata and content |

Encryption uses AES via `install_crypto.py`. The technician password is passed via stdin and never logged. Artifact permissions are set to `0640`.

### Role: install_diff

**Path**: `roles/install_diff/tasks/main.yml`

Compares the desired profile against existing state to detect what changed.

**Process**:

1. Writes the desired profile to a temporary JSON file.
2. Validates the profile against `profile.schema.json`.
3. Loads existing state and status from decrypted artifacts.
4. Calls `install_model.py diff` to compute the delta.

**Run type classification**:

| Run Type | Meaning |
|----------|---------|
| `fresh_install` | No existing state found |
| `no_op` | Desired profile matches current state exactly |
| `reconfigure` | Capabilities, routing, or other settings changed |
| `upgrade` | Product version changed |
| `recovery` | Previous run failed; re-applying from last known good state |
| `drift_reconcile` | Runtime files were manually modified; overwriting from canonical state |

**Published facts**:

- `installer_diff_result`: Full diff output
- `installer_resolved`: Resolved runtime profile (services, environment)
- `installer_run_diff`: Changes to apply (run type, capabilities added/removed, backend changed)
- `installer_pending_status`: Status payload to be recorded

---

## Playbooks Reference

### install.yml -- Interactive Installer

The primary entry point. Contains four play blocks:

| Play | Hosts | Connection | Purpose |
|------|-------|------------|---------|
| 1 | `localhost` | local | Collect technician password, mode, backend |
| 2 | `localhost` | local | Development mode deployment |
| 3 | `arsenale-control-plane` | SSH | Production Podman deployment |
| 4 | `localhost` | local | Production Kubernetes deployment |

Only the play matching the selected mode and backend executes.

**Usage**:

```bash
# Interactive (prompts for everything)
make install

# Non-interactive with variables
ansible-playbook playbooks/install.yml --ask-vault-pass \
  -e installer_mode=production \
  -e installer_backend=podman \
  -e installer_capabilities_csv="multi_tenancy,connections,databases" \
  -e installer_direct_gateway=true \
  -e installer_zero_trust=false

# With password file for automation
ansible-playbook playbooks/install.yml --ask-vault-pass \
  -e install_password_file=/path/to/password-file \
  -e installer_mode=production

# Repo wrapper auto-detect for local development
printf '%s\n' 'your-technician-password' > "${XDG_STATE_HOME:-$HOME/.local/state}/arsenale-dev/install/password.txt"
make dev

# Minimal local development install
make dev DEV_CAPABILITIES=cli DEV_DIRECT_GATEWAY=false DEV_ZERO_TRUST=false
```

`keychain` is part of the required core profile, so minimal installs still include the vault even when `DEV_CAPABILITIES` is only `cli`.
Omit `multi_tenancy` to keep the platform in single-tenant mode; the initial organization is still created by setup or `dev-bootstrap`, but users cannot create or switch organizations afterward.

### deploy.yml -- Unified Apply Engine

The shared apply engine used beneath the installer. Can also be called directly for simpler deploys.

```bash
# Production deploy
ansible-playbook playbooks/deploy.yml --ask-vault-pass

# Development deploy
ansible-playbook playbooks/deploy.yml --ask-vault-pass -e arsenale_env=development

# Teardown
ansible-playbook playbooks/deploy.yml --ask-vault-pass -e arsenale_env=development -e arsenale_state=absent
```

**Role execution order** (when `arsenale_state=present`):

1. `prerequisites` -- System prep (production Podman only)
2. `certificates` -- TLS cert generation
3. `podman_secrets` -- Runtime secret creation
4. `firewall` -- nftables rules (production only, when enabled)
5. `deploy` -- Render, build, and apply containers
6. `healthcheck` -- Post-deploy validation
7. `dev_post_apply` -- Bootstrap and demo data (development only)

### setup-vault.yml -- Secret Generation

Generates cryptographically secure random values for all required secrets.

```bash
ansible-playbook playbooks/setup-vault.yml
```

**Secrets generated**:

| Secret | Length | Format |
|--------|--------|--------|
| `vault_jwt_secret` | 128 chars | Hex |
| `vault_guacamole_secret` | 64 chars | Hex |
| `vault_server_encryption_key` | 64 chars | Hex |
| `vault_postgres_password` | 32 chars | Random |
| `vault_guacenc_auth_token` | 64 chars | Hex |
| `vault_database_url` | -- | Constructed PostgreSQL URL |

### backup.yml -- Database Backup

```bash
make backup
# or
ansible-playbook playbooks/backup.yml --ask-vault-pass
```

- **Hosts**: `arsenale-control-plane` (production only)
- **Output**: `pg_dump` saved to `{{ arsenale_backup_dir }}/arsenale-YYYYMMDD.dump`
- **Cleanup**: Automatically removes backups older than `arsenale_backup_retention_days` (default: 30)

### rotate-secrets.yml -- Secret Rotation

```bash
make rotate
# or
ansible-playbook playbooks/rotate-secrets.yml --ask-vault-pass
```

Steps:

1. Confirms rotation with the technician.
2. Backs up the database.
3. Generates new secrets for JWT, Guacamole, encryption key, and guacenc token.
4. Updates Podman secrets with `force: true`.
5. Restarts affected services (control-plane-api, guacenc).
6. Waits for services to become healthy.

**Important**: All active sessions are invalidated (new JWT secret). Update `vault.yml` after rotation for future deployments.

### status.yml -- Encrypted Status Read

```bash
make status
# or
ansible-playbook playbooks/status.yml --ask-vault-pass
```

Reads and displays the encrypted installer status without running a full deploy. The status artifact exposes:

- Installer schema version and product version
- Mode and backend
- Enabled capabilities
- Last action and result
- Start/finish timestamps
- Health summary (services, status)
- Drift summary (clean/dirty)

---

## Secret Management

Secrets are managed through a **two-layer approach**:

### Layer 1: Ansible Vault

Long-lived deployment secrets encrypted at rest in `inventory/group_vars/all/vault.yml`.

**Generate secrets** (first-time):

```bash
make setup
# or
ansible-playbook playbooks/setup-vault.yml
```

**View secrets**:

```bash
ansible-vault view deployment/ansible/inventory/group_vars/all/vault.yml
```

**Edit secrets**:

```bash
make vault
# or
ansible-vault edit deployment/ansible/inventory/group_vars/all/vault.yml
```

**Change vault password**:

```bash
ansible-vault rekey deployment/ansible/inventory/group_vars/all/vault.yml
```

**Optional secrets** (set in vault for features you use):

```yaml
# Email
vault_smtp_pass: ""
vault_sendgrid_api_key: ""
vault_ses_secret_access_key: ""
vault_resend_api_key: ""
vault_mailgun_api_key: ""

# SMS
vault_twilio_auth_token: ""
vault_sns_secret_access_key: ""
vault_vonage_api_secret: ""

# OAuth
vault_google_client_secret: ""
vault_microsoft_client_secret: ""
vault_github_client_secret: ""
vault_oidc_client_secret: ""

# LDAP
vault_ldap_bind_password: ""

# AI
vault_ai_api_key: ""
```

Alternatively, create a `SECRETS.env` file from `SECRETS.env.example` and run `./scripts/generate-vault.sh` to populate the vault from it.

### Layer 2: Installer Artifacts

Installer-owned profile, state, status, and render metadata encrypted with the technician password. Stored under `/opt/arsenale/install/` on the target host. See [Encrypted Installer Artifacts](#encrypted-installer-artifacts) for details.

### Runtime Secret Injection

For Compose backends, secrets are injected via Podman secrets at `/run/secrets/<name>`. Generated runtime config (`.env` files) is transient during apply and is cleaned up after the run. Secrets are never stored as container environment variables -- the healthcheck role validates this on every deploy.

---

## Configuration Reference

All non-secret configuration is in `inventory/group_vars/all/vars.yml`.

### Domain and Networking

| Variable | Default | Description |
|----------|---------|-------------|
| `arsenale_domain` | `arsenale.home.arpa.viti` | Domain name for the deployment |
| `arsenale_client_port` | `3000` | Web UI port (host-side) |
| `arsenale_ssh_port` | `2222` | SSH gateway port (host-side) |
| `arsenale_public_url` | `https://arsenale_domain:3000` | Public URL for the web UI |
| `arsenale_trust_proxy` | `false` | Trust X-Forwarded-* headers |
| `arsenale_allow_local_network` | `true` | Allow local network access |
| `arsenale_cookie_secure` | `true` | Set Secure flag on cookies |
| `arsenale_service_bind_host` | `0.0.0.0` | Service bind address |
| `arsenale_client_bind_host` | `127.0.0.1` | Client bind address |

### Internal Service Ports

| Variable | Default | Service |
|----------|---------|---------|
| `arsenale_control_plane_api_port` | `18080` | Control-plane API |
| `arsenale_control_plane_controller_port` | `18081` | Control-plane controller |
| `arsenale_authz_pdp_port` | `18082` | Authorization PDP |
| `arsenale_model_gateway_port` | `18083` | Model gateway |
| `arsenale_tool_gateway_port` | `18084` | Tool gateway |
| `arsenale_agent_orchestrator_port` | `18085` | Agent orchestrator |
| `arsenale_memory_service_port` | `18086` | Memory service |
| `arsenale_terminal_broker_port` | `18090` | Terminal broker |
| `arsenale_desktop_broker_port` | `18091` | Desktop broker |
| `arsenale_tunnel_broker_port` | `18092` | Tunnel broker |
| `arsenale_query_runner_port` | `18093` | Query runner |
| `arsenale_runtime_agent_port` | `18095` | Runtime agent |

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `arsenale_db_user` | `arsenale` | PostgreSQL username |
| `arsenale_db_name` | `arsenale` | PostgreSQL database name |

### Features

| Variable | Default | Description |
|----------|---------|-------------|
| `arsenale_self_signup_enabled` | `false` | Allow self-registration |
| `arsenale_email_verify_required` | `false` | Require email verification |
| `arsenale_recording_enabled` | `true` | Enable session recording |
| `arsenale_email_provider` | `smtp` | Email provider |

### Container Images

| Variable | Default | Description |
|----------|---------|-------------|
| `arsenale_build_images` | `false` | Production/Kubernetes: build from source when `true`, otherwise pull published images. Development always builds locally. |
| `arsenale_registry` | `ghcr.io/dnviti/arsenale` | Container image registry |
| `arsenale_image_tag` | `latest` | Image tag when pulling |
| `arsenale_component_images` | derived from `arsenale_registry` + `arsenale_image_tag` | Per-service image overrides for standalone installs |
| `arsenale_postgres_image` | `quay.io/sclorg/postgresql-16-c10s` | PostgreSQL image |
| `arsenale_guacd_image` | `ghcr.io/dnviti/arsenale/guacd:latest` | Guacamole daemon image |

### TLS

| Variable | Default | Description |
|----------|---------|-------------|
| `arsenale_generate_certs` | `true` | Generate TLS certificates |
| `arsenale_cert_dir` | `{{ arsenale_home }}/certs` | Certificate directory |
| `arsenale_cert_validity_days` | `365` | Service certificate validity |
| `arsenale_ca_validity_days` | `3650` | CA certificate validity |

### Firewall

| Variable | Default | Description |
|----------|---------|-------------|
| `arsenale_firewall_enabled` | `true` | Configure nftables firewall |
| `arsenale_allowed_ssh_sources` | `["0.0.0.0/0"]` | Allowed SSH source CIDRs |
| `arsenale_allowed_web_sources` | `["0.0.0.0/0"]` | Allowed web UI source CIDRs |

### Scaling and Resources

| Variable | Default | Description |
|----------|---------|-------------|
| `arsenale_server_replicas` | `1` | Server replica count |
| `arsenale_resource_limits` | See below | Per-service CPU/memory/PID limits |

Default resource limits:

```yaml
arsenale_resource_limits:
  postgres:    { cpus: "1.0",  memory: "1g",     pids: 256 }
  guacd:       { cpus: "1.0",  memory: "512m",   pids: 256 }
  guacenc:     { cpus: "1.0",  memory: "768m",   pids: 256 }
  server:      { cpus: "2.0",  memory: "1536m",  pids: 512 }
  client:      { cpus: "0.75", memory: "256m",   pids: 256 }
  go_service:  { cpus: "0.5",  memory: "512m",   pids: 128 }
  ssh_gateway: { cpus: "0.5",  memory: "256m",   pids: 128 }
  db_proxy:    { cpus: "0.5",  memory: "256m",   pids: 128 }
```

### Backup

| Variable | Default | Description |
|----------|---------|-------------|
| `arsenale_backup_dir` | `{{ arsenale_home }}/backups` | Backup storage directory |
| `arsenale_backup_retention_days` | `30` | Days to keep old backups |

---

## Inventory

Edit `inventory/hosts.yml` to set your target host:

```yaml
all:
  hosts:
    arsenale-control-plane:
      ansible_host: "192.168.1.100"        # Target host IP or hostname
      ansible_user: "deploy"                # SSH user with sudo access
      ansible_python_interpreter: /usr/bin/python3
  vars:
    arsenale_user: arsenale                  # System user for Arsenale
    arsenale_home: /opt/arsenale             # Deployment directory
    arsenale_repo: https://github.com/dnviti/arsenale.git
    arsenale_version: main                   # Only used when arsenale_build_images=true
```

Or use environment variables:

```bash
export ARSENALE_HOST=192.168.1.100
export ARSENALE_DEPLOY_USER=deploy
export ARSENALE_USER=arsenale
make install
```

---

## Firewall

When `arsenale_firewall_enabled: true` (default for production), the `firewall` role deploys nftables rules.

**Rules applied**:

```
table inet arsenale {
  chain input {
    type filter hook input priority 0; policy drop;

    # Allow established/related connections
    ct state established,related accept

    # Allow loopback
    iif lo accept

    # Allow SSH from configured sources
    tcp dport 22 ip saddr { <arsenale_allowed_ssh_sources> } accept

    # Allow web UI from configured sources
    tcp dport <arsenale_client_port> ip saddr { <arsenale_allowed_web_sources> } accept

    # Allow SSH gateway from configured sources
    tcp dport <arsenale_ssh_port> ip saddr { <arsenale_allowed_web_sources> } accept
  }

  chain forward {
    type filter hook forward priority 0; policy drop;

    # Allow container DNS, HTTPS, SMTP egress
    tcp dport { 53, 443, 25, 465, 587 } accept
    udp dport 53 accept
  }
}
```

To restrict access:

```yaml
# inventory/group_vars/all/vars.yml
arsenale_allowed_ssh_sources: ["10.0.0.0/8"]
arsenale_allowed_web_sources: ["10.0.0.0/8", "192.168.1.0/24"]
```

---

## Backup and Restore

### Create Backup

```bash
make backup
```

Backups are stored at `{{ arsenale_backup_dir }}` (default: `/opt/arsenale/backups/`). Old backups are automatically cleaned after `arsenale_backup_retention_days` (default: 30 days).

### Restore from Backup

```bash
# Copy backup to the server, then:
podman exec -i arsenale-postgres pg_restore \
  -U arsenale -d arsenale --clean --if-exists \
  < /opt/arsenale/backups/arsenale-YYYYMMDD.dump
```

---

## Operations

### Updating Arsenale

```bash
make deploy
```

The installer classifies the rerun as `no_op`, `reconfigure`, `recovery`, or `upgrade` based on the decrypted installer artifacts. Only the required delta is applied.

### Reconfiguring

```bash
make configure
```

Re-prompts for capabilities, routing, and other settings. Applies only the changes.

### Recovery

```bash
make recover
```

Re-applies from the last known good encrypted state. Use after interrupted or failed runs.

### Checking Status

```bash
make status
```

Reads the encrypted installer status without deploying. Requires the technician password.

### Rotating Secrets

```bash
make rotate
```

Rotates JWT, Guacamole, encryption key, and guacenc token. Backs up the database first. Invalidates all active sessions. Update `vault.yml` afterward.

### Viewing Logs

```bash
make logs                                    # All services
make logs SVC=arsenale-control-plane-api     # Specific service
```

### Teardown

```bash
make clean               # Production: stop and remove everything
make dev-down             # Development: stop dev stack
```

---

## Encrypted Installer Artifacts

The installer maintains a second encrypted artifact set (separate from Ansible Vault) at:

```
/opt/arsenale/install/     # Production
<repo-root>/install/       # Development
```

| File | Content |
|------|---------|
| `install-profile.enc` | Desired deployment profile (mode, backend, capabilities, routing, kubernetes config) |
| `install-state.enc` | Last applied state (profile hash, applied hashes, services, timestamps) |
| `install-status.enc` | Last run result (success/failure, timestamps, health, drift) |
| `install-log.enc` | Execution log entries |
| `rendered-artifacts.enc` | Rendered compose/helm output metadata and full content |

**Properties**:

- Encrypted with the technician password entered at install time.
- The password is **never** stored on disk.
- Every rerun asks for the password before reading state.
- Automation can supply the password via `install_password_file` variable, `installer_password` variable, or stdin.
- Artifact permissions are `0640` (owner and group read/write only).
- Encryption uses AES via `scripts/install_crypto.py`.

**Operational consequences**:

- `make status` reads `install-status.enc`, not the live application database.
- Reruns and recovery do not depend on a healthy Arsenale instance.
- Manual edits to generated runtime files (e.g., `docker-compose.yml`) are treated as drift and overwritten from encrypted canonical state.
- Persistent data (database volumes) is never deleted during capability removal or recovery.

---

## Troubleshooting

### Vault password prompt not appearing

Ensure you pass `--ask-vault-pass` or set `ANSIBLE_VAULT_PASSWORD_FILE`:

```bash
export ANSIBLE_VAULT_PASSWORD_FILE=/path/to/vault-password-file
```

### Podman socket not starting

```bash
# On the target host, as the arsenale user:
systemctl --user enable --now podman.socket
loginctl enable-linger arsenale
```

### Container health checks failing

```bash
# Check container logs:
podman logs arsenale-control-plane-api
podman logs arsenale-postgres

# Check all container statuses:
podman compose -f /opt/arsenale/docker-compose.yml ps
```

### Secrets not found in container

```bash
# Verify Podman secrets exist:
podman secret ls

# Verify secrets are mounted:
podman exec arsenale-control-plane-api ls /run/secrets/
```

### Certificate issues

Certificates are generated in `{{ arsenale_cert_dir }}` with ECC P-256 keys. To regenerate:

```bash
make certs
# or manually:
rm -rf /opt/arsenale/certs/*
ansible-playbook playbooks/deploy.yml --ask-vault-pass --tags certificates
```

### Installer status reads fail

- Verify the technician password is correct.
- Verify the artifact path is correct (usually `/opt/arsenale/install/install-status.enc`).
- If decryption fails with the correct password, treat the artifact as tampered or corrupt and rerun `make recover`.

### Direct helper usage for status

```bash
INSTALLER_PASSWORD=...
python3 deployment/ansible/scripts/install_status.py \
  --input /opt/arsenale/install/install-status.enc \
  --password-env INSTALLER_PASSWORD
```

### Backend switch from Docker

Docker is no longer supported. If existing installer artifacts reference Docker:

1. Remove the legacy Docker deployment manually.
2. Rerun the installer with `podman` or `kubernetes`.

### Development stack not starting

1. Verify Podman is installed: `podman --version`
2. Verify vault secrets are generated: `make setup`
3. Check for port conflicts on 3000, 18080-18095, 2222.
4. Review container logs: `podman logs arsenale-postgres`

### Kubernetes deploy failing

1. Verify `kubectl` is configured: `kubectl cluster-info`
2. Verify `helm` is installed: `helm version`
3. Check Helm lint output for chart errors.
4. Verify PVCs can bind: `kubectl get pvc -n arsenale`
5. Check pod status: `kubectl get pods -n arsenale`
