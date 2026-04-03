# ============================================================================
# Arsenale — Deployment via Ansible
# ============================================================================
# Usage:
#   make setup      — First-time setup: install Ansible collections, generate vault + certs
#   make install    — Run the interactive installer
#   make dev        — Start the full installer-aware development stack
#   make deploy     — Run the installer in production mode
#   make help       — Show all available targets
# ============================================================================

SHELL := /bin/bash
ANSIBLE_DIR := deployment/ansible
PLAYBOOK := cd $(ANSIBLE_DIR) && ansible-playbook
VAULT_FILE := $(ANSIBLE_DIR)/inventory/group_vars/all/vault.yml
LOCAL_VAULT_PASS_FILE := $(ANSIBLE_DIR)/.vault-pass
DEFAULT_INSTALL_PASSWORD_FILE := $(abspath install/password.txt)
VAULT_FLAG ?= $(shell \
	if [ -n "$$ANSIBLE_VAULT_PASSWORD_FILE" ]; then \
		printf -- '--vault-password-file %s' "$$ANSIBLE_VAULT_PASSWORD_FILE"; \
	elif [ -f "$(LOCAL_VAULT_PASS_FILE)" ]; then \
		printf -- '--vault-password-file %s' "$(LOCAL_VAULT_PASS_FILE)"; \
	elif [ -f "$(VAULT_FILE)" ] && head -1 "$(VAULT_FILE)" | grep -q '^\$$ANSIBLE_VAULT'; then \
		printf '%s' '--ask-vault-pass'; \
	fi)
INSTALL_PASSWORD_FILE ?= $(if $(wildcard $(DEFAULT_INSTALL_PASSWORD_FILE)),$(DEFAULT_INSTALL_PASSWORD_FILE),)
INSTALL_PASSWORD_FLAG := $(if $(INSTALL_PASSWORD_FILE),-e install_password_file=$(INSTALL_PASSWORD_FILE),)

.DEFAULT_GOAL := help

# ── Dependency check ────────────────────────────────────────────────────────

.PHONY: _check-ansible
_check-ansible:
	@command -v ansible-playbook >/dev/null 2>&1 || { \
		printf "\033[1;31mERROR: Ansible is not installed.\033[0m\n\n"; \
		printf "Install it with one of:\n"; \
		printf "  pip install ansible          # Any platform (recommended)\n"; \
		printf "  pipx install ansible          # Isolated install\n"; \
		printf "  brew install ansible          # macOS (Homebrew)\n"; \
		printf "  sudo dnf install ansible-core # Fedora / RHEL\n"; \
		printf "  sudo apt install ansible      # Debian / Ubuntu\n"; \
		printf "  sudo pacman -S ansible        # Arch Linux\n"; \
		printf "\nThen run: make setup\n"; \
		exit 1; \
	}

# ── First-time setup ───────────────────────────────────────────────────────

.PHONY: setup
setup: _check-ansible  ## First-time setup: install collections, generate vault + certs
	cd $(ANSIBLE_DIR) && ansible-galaxy collection install -r requirements.yml 2>/dev/null || true
	@if [ ! -f $(ANSIBLE_DIR)/inventory/group_vars/all/vault.yml ]; then \
		echo "Generating Ansible Vault..."; \
		cd $(ANSIBLE_DIR) && ./scripts/generate-vault.sh; \
	else \
		echo "Vault already exists. To regenerate: make vault"; \
	fi
	@echo ""
	@echo "Setup complete. Next steps:"
	@echo "  make install   — Run interactive installer"
	@echo "  make dev       — Start development environment"
	@echo "  make deploy    — Deploy production stack"

# ── Development ─────────────────────────────────────────────────────────────

.PHONY: dev
dev: _check-ansible  ## Deploy full dev stack via installer-aware flow
	$(PLAYBOOK) playbooks/install.yml $(VAULT_FLAG) $(INSTALL_PASSWORD_FLAG) -e installer_mode=development

.PHONY: dev-down
dev-down: _check-ansible  ## Stop dev stack
	$(PLAYBOOK) playbooks/deploy.yml $(VAULT_FLAG) $(INSTALL_PASSWORD_FLAG) -e arsenale_env=development -e arsenale_state=absent

# ── Production ──────────────────────────────────────────────────────────────

.PHONY: install
install: _check-ansible  ## Run interactive installer
	$(PLAYBOOK) playbooks/install.yml $(VAULT_FLAG) $(INSTALL_PASSWORD_FLAG)

.PHONY: configure
configure: _check-ansible  ## Reconfigure an existing production install
	$(PLAYBOOK) playbooks/install.yml $(VAULT_FLAG) $(INSTALL_PASSWORD_FLAG) -e installer_mode=production

.PHONY: deploy
deploy: _check-ansible  ## Deploy or update production stack via installer
	$(PLAYBOOK) playbooks/install.yml $(VAULT_FLAG) $(INSTALL_PASSWORD_FLAG) -e installer_mode=production

# ── Operations ──────────────────────────────────────────────────────────────

.PHONY: status
status: _check-ansible  ## Show encrypted installer status
	$(PLAYBOOK) playbooks/status.yml $(VAULT_FLAG) $(INSTALL_PASSWORD_FLAG)

.PHONY: recover
recover: _check-ansible  ## Re-run installer recovery flow in production mode
	$(PLAYBOOK) playbooks/install.yml $(VAULT_FLAG) $(INSTALL_PASSWORD_FLAG) -e installer_mode=production

.PHONY: logs
logs:  ## Follow service logs (pass SVC= for specific service)
	podman compose -f $$(find /opt/arsenale -name docker-compose.yml 2>/dev/null || echo "docker-compose.yml") logs -f $(SVC)

.PHONY: backup
backup: _check-ansible  ## Create database backup
	$(PLAYBOOK) playbooks/backup.yml $(VAULT_FLAG) $(INSTALL_PASSWORD_FLAG)

.PHONY: rotate
rotate: _check-ansible  ## Rotate system secrets
	$(PLAYBOOK) playbooks/rotate-secrets.yml $(VAULT_FLAG) $(INSTALL_PASSWORD_FLAG)

# ── Secrets & Certificates ──────────────────────────────────────────────────

.PHONY: vault
vault: _check-ansible  ## Generate or edit Ansible Vault
	@if [ -f $(ANSIBLE_DIR)/inventory/group_vars/all/vault.yml ]; then \
		ansible-vault edit $(ANSIBLE_DIR)/inventory/group_vars/all/vault.yml; \
	else \
		cd $(ANSIBLE_DIR) && ./scripts/generate-vault.sh; \
	fi

.PHONY: certs
certs: _check-ansible  ## Regenerate TLS certificates
	$(PLAYBOOK) playbooks/deploy.yml $(VAULT_FLAG) $(INSTALL_PASSWORD_FLAG) --tags certificates

# ── Cleanup ─────────────────────────────────────────────────────────────────

.PHONY: clean
clean: _check-ansible  ## Stop and remove all containers and volumes
	$(PLAYBOOK) playbooks/deploy.yml $(VAULT_FLAG) $(INSTALL_PASSWORD_FLAG) -e arsenale_state=absent

# ── Help ────────────────────────────────────────────────────────────────────

.PHONY: help
help:  ## Show available targets
	@printf "\033[1mArsenale Deployment\033[0m\n\n"
	@printf "Prerequisites: ansible (make setup will guide you)\n\n"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'
	@printf "\n"
