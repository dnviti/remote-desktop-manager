# Arsenale — Ansible Deployment

Automated, secure Podman deployment of Arsenale with Ansible Vault for secret management.

## Quick Start (via Makefile)

The preferred way to interact with Ansible is through the root `Makefile`. All commands are run from the repository root.

**Prerequisites:** [Ansible](https://docs.ansible.com/ansible/latest/installation_guide/)

```bash
# First-time setup
make setup          # Install Ansible collections, generate vault + certs

# Development
make dev            # Start postgres + split cache/pubsub backends, generate .env
npm run dev         # Start server + client

# Production
make deploy         # Full stack deployment
make status         # Check health

# Operations
make backup         # Database backup
make rotate         # Rotate secrets
make vault          # Edit Ansible Vault
make certs          # Regenerate TLS certificates
make help           # All available targets
```

## Prerequisites (manual usage)

If running playbooks directly instead of via `make`:

- **Ansible 2.15+** on the control node
- **Ansible Collections** (install before first use):
  ```bash
  ansible-galaxy collection install community.general community.crypto containers.podman
  ```
- **Target host**: Linux with systemd (Fedora, RHEL, Debian, Ubuntu)
- **SSH access** to the target host with sudo privileges

### Direct Playbook Usage

```bash
cd deployment/ansible

# 1. Generate and encrypt secrets
ansible-playbook playbooks/setup-vault.yml

# 2. Deploy Arsenale
ansible-playbook playbooks/deploy.yml --ask-vault-pass

# 3. Verify deployment
ansible-playbook playbooks/deploy.yml --ask-vault-pass --tags healthcheck
```

## Secret Management

### How It Works

Secrets are managed through a two-layer approach:

1. **Ansible Vault** encrypts secrets at rest in `inventory/group_vars/all/vault.yml`
2. **Podman secrets** inject them into containers at `/run/secrets/` — never as environment variables

### Generate Secrets

```bash
ansible-playbook playbooks/setup-vault.yml
```

This generates cryptographically secure random values for all required secrets and encrypts the vault file. You'll be prompted to set a vault password.

### View / Edit Secrets

```bash
ansible-vault view inventory/group_vars/all/vault.yml
ansible-vault edit inventory/group_vars/all/vault.yml
```

### Rotate Secrets

```bash
ansible-playbook playbooks/rotate-secrets.yml --ask-vault-pass
```

This will:
- Generate new secrets for JWT, Guacamole, encryption key, and guacenc token
- Back up the database before rotation
- Update Podman secrets and restart affected services
- Invalidate all active sessions (new JWT secret)

**Important:** After rotation, update `vault.yml` with the new values for future deployments.

### Change Vault Password

```bash
ansible-vault rekey inventory/group_vars/all/vault.yml
```

## Configuration

All non-secret configuration is in `inventory/group_vars/all/vars.yml`.

### Key Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `arsenale_domain` | `localhost` | Domain name for the deployment |
| `arsenale_client_port` | `3000` | Web UI port (host) |
| `arsenale_ssh_port` | `2222` | SSH gateway port (host) |
| `arsenale_node_env` | `production` | Node.js environment |
| `arsenale_build_images` | `true` | Build from source (`false` = pull from registry) |
| `arsenale_registry` | `ghcr.io/dnviti/arsenale` | Container image registry |
| `arsenale_image_tag` | `latest` | Image tag when pulling |
| `arsenale_self_signup_enabled` | `false` | Allow self-registration |
| `arsenale_recording_enabled` | `false` | Enable session recording |
| `arsenale_firewall_enabled` | `true` | Configure nftables firewall |
| `arsenale_backup_retention_days` | `30` | Days to keep database backups |

### Inventory

Edit `inventory/hosts.yml` to set your target host, or use environment variables:

```bash
export ARSENALE_HOST=192.168.1.100
export ARSENALE_USER=deploy
ansible-playbook playbooks/deploy.yml --ask-vault-pass
```

## Firewall

When `arsenale_firewall_enabled: true`, nftables rules are deployed that:

- Allow inbound on ports 22 (SSH), `arsenale_client_port` (web), and `arsenale_ssh_port` (gateway)
- Restrict container egress to DNS (53), HTTPS (443), and SMTP (25/465/587)
- Drop all other inbound and forwarded traffic

Customize allowed source ranges in `vars.yml`:

```yaml
arsenale_allowed_ssh_sources: ["10.0.0.0/8"]
arsenale_allowed_web_sources: ["10.0.0.0/8", "192.168.1.0/24"]
```

## Backup and Restore

### Create Backup

```bash
ansible-playbook playbooks/backup.yml --ask-vault-pass
```

Backups are stored at `{{ arsenale_backup_dir }}` (default: `/opt/arsenale/backups/`). Old backups are automatically cleaned after `arsenale_backup_retention_days`.

### Restore from Backup

```bash
# Copy backup to the server, then:
podman exec -i arsenale-postgres pg_restore \
  -U arsenale -d arsenale --clean --if-exists \
  < /opt/arsenale/backups/arsenale-YYYYMMDD.dump
```

## Updating Arsenale

```bash
# Update the version in vars.yml
# arsenale_version: v1.2.0  (or a branch/tag/commit)

# Re-run deployment
ansible-playbook playbooks/deploy.yml --ask-vault-pass
```

This will pull the new version, rebuild images (if `arsenale_build_images: true`), and restart services.

## Architecture

```
Control Node                    Target Host
┌──────────────┐               ┌──────────────────────────────────┐
│ ansible-vault│──SSH+sudo────>│ /opt/arsenale/                   │
│ ansible-play │               │ ├── arsenale/  (git repo)        │
│              │               │ ├── certs/     (TLS, per-service)│
│              │               │ ├── config/    (ssh-gateway)     │
│              │               │ ├── backups/   (pg_dump)         │
│              │               │ ├── docker-compose.yml           │
│              │               │ └── .env       (non-secret only) │
│              │               │                                   │
│              │               │ Podman secrets: /run/secrets/*    │
│              │               │ 7 containers, 5 networks, 4 vols │
└──────────────┘               └──────────────────────────────────┘
```

## Troubleshooting

### Vault password prompt not appearing
Ensure you pass `--ask-vault-pass` or set `ANSIBLE_VAULT_PASSWORD_FILE`.

### Podman socket not starting
```bash
# On the target host, as the arsenale user:
systemctl --user enable --now podman.socket
loginctl enable-linger arsenale
```

### Container health checks failing
```bash
# Check container logs:
podman logs arsenale-server
podman logs arsenale-postgres

# Check all container statuses:
podman compose -f /opt/arsenale/docker-compose.yml ps
```

### Secrets not found in container
```bash
# Verify Podman secrets exist:
podman secret ls

# Verify secrets are mounted:
podman exec arsenale-server ls /run/secrets/
```

### Certificate issues
Certificates are generated in `{{ arsenale_cert_dir }}` with EC P-256 keys. To regenerate:
```bash
# Delete existing certs and re-run the certificates role
rm -rf /opt/arsenale/certs/*
ansible-playbook playbooks/deploy.yml --ask-vault-pass --tags certificates
```
