#!/usr/bin/env bash
# generate-vault.sh — Generate Ansible Vault from SECRETS.env
#
# Reads secrets from a SECRETS.env file (key=value pairs) and generates
# an encrypted Ansible Vault file. Required secrets that are empty or
# missing are auto-generated with cryptographically secure random values.
#
# Usage:
#   ./scripts/generate-vault.sh                        # uses ./SECRETS.env
#   ./scripts/generate-vault.sh --env-file /path/to.env
#   ./scripts/generate-vault.sh --no-encrypt           # skip ansible-vault encrypt
#   ./scripts/generate-vault.sh --output /path/to/vault.yml

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANSIBLE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Defaults
ENV_FILE="${ANSIBLE_DIR}/SECRETS.env"
VAULT_FILE="${ANSIBLE_DIR}/inventory/group_vars/all/vault.yml"
ENCRYPT=true

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --output)
      VAULT_FILE="$2"
      shift 2
      ;;
    --no-encrypt)
      ENCRYPT=false
      shift
      ;;
    -h|--help)
      cat <<'USAGE'
Usage: generate-vault.sh [OPTIONS]

Generate an Ansible Vault file from a SECRETS.env file.

Options:
  --env-file FILE    Path to secrets env file (default: ./SECRETS.env)
  --output FILE      Path to vault output (default: inventory/group_vars/all/vault.yml)
  --no-encrypt       Write vault.yml without encrypting
  -h, --help         Show this help

Required secrets (JWT_SECRET, GUACAMOLE_SECRET, SERVER_ENCRYPTION_KEY,
POSTGRES_PASSWORD, GUACENC_AUTH_TOKEN) are auto-generated if empty.

Examples:
  # Generate from SECRETS.env and encrypt
  ./scripts/generate-vault.sh

  # Generate from custom file without encryption
  ./scripts/generate-vault.sh --env-file /tmp/secrets.env --no-encrypt

  # Generate from existing .env.prod
  ./scripts/generate-vault.sh --env-file ../../.env.prod
USAGE
      exit 0
      ;;
    *)
      echo "Error: Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

# --- Helper functions --------------------------------------------------------

gen_hex() {
  local length="$1"
  openssl rand -hex "$((length / 2))"
}

gen_alnum() {
  local length="$1"
  openssl rand -base64 "$((length * 2))" | tr -dc 'a-zA-Z0-9' | head -c "$length"
}

read_env_var() {
  local key="$1"
  local value=""
  if [[ -f "${ENV_FILE}" ]]; then
    # Read value: skip comments, match KEY=VALUE, handle quoted values
    value=$(grep -E "^${key}=" "${ENV_FILE}" 2>/dev/null | head -1 | sed 's/^[^=]*=//' | sed 's/^["'"'"']//;s/["'"'"']$//' || true)
  fi
  echo "${value}"
}

# --- Read secrets from env file ----------------------------------------------

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "No secrets file found at: ${ENV_FILE}"
  echo "Creating from template..."
  if [[ -f "${ANSIBLE_DIR}/SECRETS.env.example" ]]; then
    cp "${ANSIBLE_DIR}/SECRETS.env.example" "${ENV_FILE}"
    chmod 600 "${ENV_FILE}"
    echo "Created ${ENV_FILE} — fill in optional values and re-run."
  else
    echo "Error: No SECRETS.env.example template found." >&2
    exit 1
  fi
fi

echo "Reading secrets from: ${ENV_FILE}"

# Required secrets — auto-generate if empty
JWT_SECRET=$(read_env_var JWT_SECRET)
GUACAMOLE_SECRET=$(read_env_var GUACAMOLE_SECRET)
SERVER_ENCRYPTION_KEY=$(read_env_var SERVER_ENCRYPTION_KEY)
POSTGRES_PASSWORD=$(read_env_var POSTGRES_PASSWORD)
GUACENC_AUTH_TOKEN=$(read_env_var GUACENC_AUTH_TOKEN)

generated=()

if [[ -z "${JWT_SECRET}" ]]; then
  JWT_SECRET=$(gen_hex 128)
  generated+=("JWT_SECRET (128-char hex)")
fi

if [[ -z "${GUACAMOLE_SECRET}" ]]; then
  GUACAMOLE_SECRET=$(gen_hex 64)
  generated+=("GUACAMOLE_SECRET (64-char hex)")
fi

if [[ -z "${SERVER_ENCRYPTION_KEY}" ]]; then
  SERVER_ENCRYPTION_KEY=$(gen_hex 64)
  generated+=("SERVER_ENCRYPTION_KEY (64-char hex)")
fi

if [[ -z "${POSTGRES_PASSWORD}" ]]; then
  POSTGRES_PASSWORD=$(gen_alnum 32)
  generated+=("POSTGRES_PASSWORD (32-char alnum)")
fi

if [[ -z "${GUACENC_AUTH_TOKEN}" ]]; then
  GUACENC_AUTH_TOKEN=$(gen_hex 64)
  generated+=("GUACENC_AUTH_TOKEN (64-char hex)")
fi

if [[ ${#generated[@]} -gt 0 ]]; then
  echo ""
  echo "Auto-generated missing required secrets:"
  for s in "${generated[@]}"; do
    echo "  - ${s}"
  done

  # Write auto-generated values back to SECRETS.env so they persist
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" "${ENV_FILE}"
  sed -i "s|^GUACAMOLE_SECRET=.*|GUACAMOLE_SECRET=${GUACAMOLE_SECRET}|" "${ENV_FILE}"
  sed -i "s|^SERVER_ENCRYPTION_KEY=.*|SERVER_ENCRYPTION_KEY=${SERVER_ENCRYPTION_KEY}|" "${ENV_FILE}"
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${POSTGRES_PASSWORD}|" "${ENV_FILE}"
  sed -i "s|^GUACENC_AUTH_TOKEN=.*|GUACENC_AUTH_TOKEN=${GUACENC_AUTH_TOKEN}|" "${ENV_FILE}"
  echo ""
  echo "Saved generated secrets to: ${ENV_FILE}"
fi

# Optional secrets — read from env file, default to empty
SMTP_PASS=$(read_env_var SMTP_PASS)
SENDGRID_API_KEY=$(read_env_var SENDGRID_API_KEY)
SES_SECRET_ACCESS_KEY=$(read_env_var AWS_SES_SECRET_ACCESS_KEY)
RESEND_API_KEY=$(read_env_var RESEND_API_KEY)
MAILGUN_API_KEY=$(read_env_var MAILGUN_API_KEY)
TWILIO_AUTH_TOKEN=$(read_env_var TWILIO_AUTH_TOKEN)
SNS_SECRET_ACCESS_KEY=$(read_env_var AWS_SNS_SECRET_ACCESS_KEY)
VONAGE_API_SECRET=$(read_env_var VONAGE_API_SECRET)
GOOGLE_CLIENT_SECRET=$(read_env_var GOOGLE_CLIENT_SECRET)
MICROSOFT_CLIENT_SECRET=$(read_env_var MICROSOFT_CLIENT_SECRET)
GITHUB_CLIENT_SECRET=$(read_env_var GITHUB_CLIENT_SECRET)
OIDC_CLIENT_SECRET=$(read_env_var OIDC_CLIENT_SECRET)
LDAP_BIND_PASSWORD=$(read_env_var LDAP_BIND_PASSWORD)
AI_API_KEY=$(read_env_var AI_API_KEY)
SHARED_FILES_S3_SECRET_ACCESS_KEY=$(read_env_var SHARED_FILES_S3_SECRET_ACCESS_KEY)

# --- Write vault.yml ---------------------------------------------------------

# Remove existing vault file if encrypted (can't overwrite encrypted file)
if [[ -f "${VAULT_FILE}" ]]; then
  if head -1 "${VAULT_FILE}" 2>/dev/null | grep -q '^\$ANSIBLE_VAULT'; then
    echo ""
    echo "Existing encrypted vault found. Removing before regeneration."
  fi
  rm -f "${VAULT_FILE}"
fi

mkdir -p "$(dirname "${VAULT_FILE}")"

cat > "${VAULT_FILE}" <<VAULT
# Ansible Vault — Arsenale Secrets
# Generated: $(date -Iseconds)
# Source: ${ENV_FILE}
#
# DO NOT commit this file unencrypted.
# Encrypt with: ansible-vault encrypt inventory/group_vars/all/vault.yml

# Required secrets
vault_jwt_secret: "${JWT_SECRET}"
vault_guacamole_secret: "${GUACAMOLE_SECRET}"
vault_server_encryption_key: "${SERVER_ENCRYPTION_KEY}"
vault_postgres_password: "${POSTGRES_PASSWORD}"
vault_guacenc_auth_token: "${GUACENC_AUTH_TOKEN}"

# Constructed from components
vault_database_url: "postgresql://{{ arsenale_db_user }}:${POSTGRES_PASSWORD}@postgres:5432/{{ arsenale_db_name }}?sslmode=verify-full"

# Optional secrets
vault_smtp_pass: "${SMTP_PASS}"
vault_sendgrid_api_key: "${SENDGRID_API_KEY}"
vault_ses_secret_access_key: "${SES_SECRET_ACCESS_KEY}"
vault_resend_api_key: "${RESEND_API_KEY}"
vault_mailgun_api_key: "${MAILGUN_API_KEY}"
vault_twilio_auth_token: "${TWILIO_AUTH_TOKEN}"
vault_sns_secret_access_key: "${SNS_SECRET_ACCESS_KEY}"
vault_vonage_api_secret: "${VONAGE_API_SECRET}"
vault_google_client_secret: "${GOOGLE_CLIENT_SECRET}"
vault_microsoft_client_secret: "${MICROSOFT_CLIENT_SECRET}"
vault_github_client_secret: "${GITHUB_CLIENT_SECRET}"
vault_oidc_client_secret: "${OIDC_CLIENT_SECRET}"
vault_ldap_bind_password: "${LDAP_BIND_PASSWORD}"
vault_ai_api_key: "${AI_API_KEY}"
vault_shared_files_s3_secret_access_key: "${SHARED_FILES_S3_SECRET_ACCESS_KEY}"
VAULT

chmod 600 "${VAULT_FILE}"

echo ""
echo "Vault file written: ${VAULT_FILE}"

# --- Encrypt -----------------------------------------------------------------

if [[ "${ENCRYPT}" == true ]]; then
  if ! command -v ansible-vault &>/dev/null; then
    echo ""
    echo "WARNING: ansible-vault not found. Vault file is UNENCRYPTED."
    echo "Install Ansible and run: ansible-vault encrypt ${VAULT_FILE}"
    exit 1
  fi

  echo ""
  echo "Encrypting vault file..."
  ansible-vault encrypt "${VAULT_FILE}"
  echo "Vault encrypted successfully."
else
  echo ""
  echo "Skipping encryption (--no-encrypt). File is in PLAINTEXT."
  echo "Encrypt manually: ansible-vault encrypt ${VAULT_FILE}"
fi

echo ""
echo "Done. Deploy with: ansible-playbook playbooks/deploy.yml --ask-vault-pass"
