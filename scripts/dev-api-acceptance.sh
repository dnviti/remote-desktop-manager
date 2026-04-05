#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
default_state_home="${XDG_STATE_HOME:-$HOME/.local/state}"
default_dev_home="${ARSENALE_DEV_HOME:-$default_state_home/arsenale-dev}"
vault_file="${ARSENALE_VAULT_FILE:-$repo_root/deployment/ansible/inventory/group_vars/all/vault.yml}"

resolve_postgres_password() {
  if [[ -n "${ARSENALE_DB_PASSWORD:-}" ]]; then
    printf '%s' "${ARSENALE_DB_PASSWORD}"
    return
  fi

  python3 - "$vault_file" <<'PY'
import re
import sys
from pathlib import Path

vault_path = Path(sys.argv[1])
text = vault_path.read_text()
match = re.search(r'^vault_postgres_password: "([^"]+)"$', text, re.M)
if not match:
    raise SystemExit("could not read vault_postgres_password from " + str(vault_path))
print(match.group(1))
PY
}

resolve_server_encryption_key() {
  python3 - "$vault_file" <<'PY'
import re
import sys
from pathlib import Path

vault_path = Path(sys.argv[1])
text = vault_path.read_text()
match = re.search(r'^vault_server_encryption_key: "([^"]+)"$', text, re.M)
if not match:
    raise SystemExit("could not read vault_server_encryption_key from " + str(vault_path))
print(match.group(1))
PY
}

resolve_jwt_secret() {
  python3 - "$vault_file" <<'PY'
import re
import sys
from pathlib import Path

vault_path = Path(sys.argv[1])
text = vault_path.read_text()
match = re.search(r'^vault_jwt_secret: "([^"]+)"$', text, re.M)
if not match:
    raise SystemExit("could not read vault_jwt_secret from " + str(vault_path))
print(match.group(1))
PY
}

postgres_password="$(resolve_postgres_password)"
server_encryption_key="$(resolve_server_encryption_key)"
jwt_secret="$(resolve_jwt_secret)"
ca_cert="${ARSENALE_CA_CERT:-$repo_root/dev-certs/client/ca.pem}"
if [[ ! -f "${ca_cert}" && -f "${default_dev_home}/dev-certs/client/ca.pem" ]]; then
  ca_cert="${default_dev_home}/dev-certs/client/ca.pem"
fi
api_base="${ARSENALE_API_BASE:-https://localhost:3000/api}"
client_base="${ARSENALE_CLIENT_BASE:-}"
expected_webauthn_rp_id="${ARSENALE_WEBAUTHN_RP_ID:-}"
cp_base="${ARSENALE_CP_BASE:-http://127.0.0.1:18080}"
controller_base="${ARSENALE_CONTROLLER_BASE:-http://127.0.0.1:18081}"
authz_base="${ARSENALE_AUTHZ_BASE:-http://127.0.0.1:18082}"
model_base="${ARSENALE_MODEL_BASE:-http://127.0.0.1:18083}"
tool_base="${ARSENALE_TOOL_BASE:-http://127.0.0.1:18084}"
agent_base="${ARSENALE_AGENT_BASE:-http://127.0.0.1:18085}"
memory_base="${ARSENALE_MEMORY_BASE:-http://127.0.0.1:18086}"
query_base="${ARSENALE_QUERY_BASE:-http://127.0.0.1:18093}"
desktop_base="${ARSENALE_DESKTOP_BASE:-http://127.0.0.1:18091}"
terminal_base="${ARSENALE_TERMINAL_BASE:-http://127.0.0.1:18090}"
tunnel_base="${ARSENALE_TUNNEL_BASE:-http://127.0.0.1:18092}"
runtime_base="${ARSENALE_RUNTIME_BASE:-http://127.0.0.1:18095}"
container_runtime="${ARSENALE_CONTAINER_RUNTIME:-}"
redis_container="${ARSENALE_REDIS_CONTAINER:-arsenale-redis}"
admin_email="${ARSENALE_ADMIN_EMAIL:-admin@example.com}"
admin_password="${ARSENALE_ADMIN_PASSWORD:-ArsenaleTemp91Qx}"
rotated_admin_password="${ARSENALE_ROTATED_ADMIN_PASSWORD:-ArsenaleTemp92Qx}"
db_user="${ARSENALE_DB_USER:-arsenale}"
db_name="${ARSENALE_DB_NAME:-arsenale}"
sample_postgres_host="${ARSENALE_SAMPLE_POSTGRES_HOST:-dev-demo-postgres}"
sample_postgres_port="${ARSENALE_SAMPLE_POSTGRES_PORT:-5432}"
sample_postgres_user="${ARSENALE_SAMPLE_POSTGRES_USER:-demo_pg_user}"
sample_postgres_password="${ARSENALE_SAMPLE_POSTGRES_PASSWORD:-DemoPgPass123!}"
sample_postgres_db_name="${ARSENALE_SAMPLE_POSTGRES_DB_NAME:-arsenale_demo}"
sample_postgres_ssl_mode="${ARSENALE_SAMPLE_POSTGRES_SSL_MODE:-disable}"
sample_postgres_table="${ARSENALE_SAMPLE_POSTGRES_TABLE:-demo_customers}"
connection_name="Acceptance DB $(date +%s)"
ssh_connection_name="Acceptance SSH $(date +%s)"
ssh_tunnel_connection_name="Acceptance SSH Tunnel $(date +%s)"
rdp_connection_name="Acceptance RDP $(date +%s)"
acceptance_suffix="$(date +%s)-$$"
dev_tunnel_managed_ssh_gateway_id="${DEV_TUNNEL_MANAGED_SSH_GATEWAY_ID:-11111111-1111-4111-8111-111111111111}"

access_token="${ARSENALE_ACCESS_TOKEN:-}"
tenant_id="${ARSENALE_TENANT_ID:-}"
user_id=""
token_file="${ARSENALE_TOKEN_FILE:-/tmp/arsenale-dev-access-token}"
tenant_file="${ARSENALE_TENANT_FILE:-/tmp/arsenale-dev-tenant-id}"
ssh_connection_id=""
ssh_session_id=""
ssh_tunnel_connection_id=""
ssh_tunnel_session_id=""
connection_id=""
session_id=""
rdp_connection_id=""
rdp_session_id=""
terminated_session_id=""
rdgw_original_config_json=""
team_id=""
temp_team_member_user_id=""
checkout_request_id=""
checkout_request_secondary_id=""
checkout_target_user_id=""
checkout_target_secret_id=""
tenant_ip_allowlist_original_json=""
switch_tenant_temp_id=""
switch_tenant_temp_user_id=""
access_policy_id=""
keystroke_policy_id=""
db_firewall_rule_id=""
db_masking_policy_id=""
db_rate_limit_policy_id=""
rotation_secret_id=""
uploaded_file_name=""
uploaded_file_local=""
uploaded_file_downloaded=""
public_share_id=""
public_share_secret_id=""
external_vault_provider_id=""
sync_profile_id=""
seed_recording_id=""
seed_recording_file_path=""
seed_guac_recording_id=""
seed_guac_recording_file_path=""
oauth_seed_provider=""
oauth_seed_provider_user_id=""
oauth_vault_setup_user_id=""
tenant_manage_user_id=""
tenant_invite_user_id=""
vault_recovery_user_id=""
imported_connection_id=""
registered_temp_user_id=""
registered_temp_user_email=""
original_self_signup_enabled=""
verify_email_temp_user_id=""
resend_verification_temp_user_id=""
forgot_password_temp_user_id=""
reset_validation_temp_user_id=""
sms_mfa_temp_user_id=""
webauthn_login_temp_user_id=""
mfa_setup_temp_tenant_id=""
mfa_setup_temp_user_id=""
reset_sms_temp_user_id=""

if [[ -z "${container_runtime}" ]]; then
  if command -v podman >/dev/null 2>&1; then
    container_runtime="podman"
  else
    container_runtime="docker"
  fi
fi

cleanup() {
  if [[ -n "${ssh_session_id}" ]]; then
    curl --silent --show-error --fail \
      --cacert "${ca_cert}" \
      -H "authorization: Bearer ${access_token}" \
      -H 'content-type: application/json' \
      -d '{}' \
      "${api_base}/sessions/ssh/${ssh_session_id}/end" >/dev/null || true
  fi

  if [[ -n "${ssh_connection_id}" ]]; then
    curl --silent --show-error --fail \
      --cacert "${ca_cert}" \
      -H "authorization: Bearer ${access_token}" \
      -X DELETE \
      "${api_base}/connections/${ssh_connection_id}" >/dev/null || true
  fi

  if [[ -n "${imported_connection_id}" ]]; then
    curl --silent --show-error --fail \
      --cacert "${ca_cert}" \
      -H "authorization: Bearer ${access_token}" \
      -X DELETE \
      "${api_base}/connections/${imported_connection_id}" >/dev/null || true
  fi

  if [[ -n "${ssh_tunnel_session_id}" ]]; then
    curl --silent --show-error --fail \
      --cacert "${ca_cert}" \
      -H "authorization: Bearer ${access_token}" \
      -H 'content-type: application/json' \
      -d '{}' \
      "${api_base}/sessions/ssh/${ssh_tunnel_session_id}/end" >/dev/null || true
  fi

  if [[ -n "${ssh_tunnel_connection_id}" ]]; then
    curl --silent --show-error --fail \
      --cacert "${ca_cert}" \
      -H "authorization: Bearer ${access_token}" \
      -X DELETE \
      "${api_base}/connections/${ssh_tunnel_connection_id}" >/dev/null || true
  fi

  if [[ -n "${rdp_session_id}" ]]; then
    curl --silent --show-error --fail \
      --cacert "${ca_cert}" \
      -H "authorization: Bearer ${access_token}" \
      -H 'content-type: application/json' \
      -d '{}' \
      "${api_base}/sessions/rdp/${rdp_session_id}/end" >/dev/null || true
  fi

  if [[ -n "${rdp_connection_id}" ]]; then
    curl --silent --show-error --fail \
      --cacert "${ca_cert}" \
      -H "authorization: Bearer ${access_token}" \
      -X DELETE \
      "${api_base}/connections/${rdp_connection_id}" >/dev/null || true
  fi

  if [[ -n "${rotation_secret_id}" ]]; then
    "${container_runtime}" exec \
      -e PGPASSWORD="${postgres_password}" \
      arsenale-postgres \
      psql -U "${db_user}" -d "${db_name}" -c \
      "DELETE FROM \"VaultSecret\" WHERE id = '${rotation_secret_id}';" \
      >/dev/null 2>&1 || true
  fi

  if [[ -n "${session_id}" ]]; then
    curl --silent --show-error --fail \
      --cacert "${ca_cert}" \
      -H "authorization: Bearer ${access_token}" \
      -H 'content-type: application/json' \
      -d '{}' \
      "${api_base}/sessions/database/${session_id}/end" >/dev/null || true
  fi

  if [[ -n "${terminated_session_id}" ]]; then
    curl --silent --show-error --fail \
      --cacert "${ca_cert}" \
      -H "authorization: Bearer ${access_token}" \
      -H 'content-type: application/json' \
      -d '{}' \
      "${api_base}/sessions/database/${terminated_session_id}/end" >/dev/null || true
  fi

  if [[ -n "${connection_id}" ]]; then
    curl --silent --show-error --fail \
      --cacert "${ca_cert}" \
      -H "authorization: Bearer ${access_token}" \
      -X DELETE \
      "${api_base}/connections/${connection_id}" >/dev/null || true
  fi

  if [[ -n "${rdgw_original_config_json}" ]]; then
    curl --silent --show-error --fail \
      --cacert "${ca_cert}" \
      -H "authorization: Bearer ${access_token}" \
      -H 'content-type: application/json' \
      -X PUT \
      -d "${rdgw_original_config_json}" \
      "${api_base}/rdgw/config" >/dev/null || true
  fi

  if [[ -n "${tenant_ip_allowlist_original_json}" ]]; then
    curl --silent --show-error --fail \
      --cacert "${ca_cert}" \
      -H "authorization: Bearer ${access_token}" \
      -H 'content-type: application/json' \
      -X PUT \
      -d "${tenant_ip_allowlist_original_json}" \
      "${api_base}/tenants/${tenant_id}/ip-allowlist" >/dev/null || true
  fi

  if [[ -n "${team_id}" ]]; then
    curl --silent --show-error --fail \
      --cacert "${ca_cert}" \
      -H "authorization: Bearer ${access_token}" \
      -X DELETE \
      "${api_base}/teams/${team_id}" >/dev/null || true
  fi

  if [[ -n "${temp_team_member_user_id}" ]]; then
    "${container_runtime}" exec "${redis_container}" redis-cli DEL "vault:user:${temp_team_member_user_id}" >/dev/null 2>&1 || true
    "${container_runtime}" exec \
      -e PGPASSWORD="${postgres_password}" \
      arsenale-postgres \
      psql -U "${db_user}" -d "${db_name}" -c \
      "DELETE FROM \"User\" WHERE id = '${temp_team_member_user_id}';" \
      >/dev/null 2>&1 || true
  fi

  if [[ -n "${checkout_request_id}" ]]; then
    "${container_runtime}" exec \
      -e PGPASSWORD="${postgres_password}" \
      arsenale-postgres \
      psql -U "${db_user}" -d "${db_name}" -c \
      "DELETE FROM \"Notification\" WHERE \"relatedId\" = '${checkout_request_id}'; DELETE FROM \"SecretCheckoutRequest\" WHERE id = '${checkout_request_id}';" \
      >/dev/null 2>&1 || true
  fi

  if [[ -n "${checkout_request_secondary_id}" ]]; then
    "${container_runtime}" exec \
      -e PGPASSWORD="${postgres_password}" \
      arsenale-postgres \
      psql -U "${db_user}" -d "${db_name}" -c \
      "DELETE FROM \"Notification\" WHERE \"relatedId\" = '${checkout_request_secondary_id}'; DELETE FROM \"SecretCheckoutRequest\" WHERE id = '${checkout_request_secondary_id}';" \
      >/dev/null 2>&1 || true
  fi

  if [[ -n "${checkout_target_secret_id}" ]]; then
    "${container_runtime}" exec \
      -e PGPASSWORD="${postgres_password}" \
      arsenale-postgres \
      psql -U "${db_user}" -d "${db_name}" -c \
      "DELETE FROM \"VaultSecret\" WHERE id = '${checkout_target_secret_id}';" \
      >/dev/null 2>&1 || true
  fi

  if [[ -n "${checkout_target_user_id}" ]]; then
    "${container_runtime}" exec \
      -e PGPASSWORD="${postgres_password}" \
      arsenale-postgres \
      psql -U "${db_user}" -d "${db_name}" -c \
      "DELETE FROM \"User\" WHERE id = '${checkout_target_user_id}';" \
      >/dev/null 2>&1 || true
  fi

  if [[ -n "${access_policy_id}" ]]; then
    curl --silent --show-error --fail \
      --cacert "${ca_cert}" \
      -H "authorization: Bearer ${access_token}" \
      -X DELETE \
      "${api_base}/access-policies/${access_policy_id}" >/dev/null || true
  fi

  if [[ -n "${keystroke_policy_id}" ]]; then
    curl --silent --show-error --fail \
      --cacert "${ca_cert}" \
      -H "authorization: Bearer ${access_token}" \
      -X DELETE \
      "${api_base}/keystroke-policies/${keystroke_policy_id}" >/dev/null || true
  fi

  if [[ -n "${db_firewall_rule_id}" ]]; then
    curl --silent --show-error --fail \
      --cacert "${ca_cert}" \
      -H "authorization: Bearer ${access_token}" \
      -X DELETE \
      "${api_base}/db-audit/firewall-rules/${db_firewall_rule_id}" >/dev/null || true
  fi

  if [[ -n "${db_masking_policy_id}" ]]; then
    curl --silent --show-error --fail \
      --cacert "${ca_cert}" \
      -H "authorization: Bearer ${access_token}" \
      -X DELETE \
      "${api_base}/db-audit/masking-policies/${db_masking_policy_id}" >/dev/null || true
  fi

  if [[ -n "${db_rate_limit_policy_id}" ]]; then
    curl --silent --show-error --fail \
      --cacert "${ca_cert}" \
      -H "authorization: Bearer ${access_token}" \
      -X DELETE \
      "${api_base}/db-audit/rate-limit-policies/${db_rate_limit_policy_id}" >/dev/null || true
  fi

  if [[ -n "${uploaded_file_name}" ]]; then
    curl --silent --show-error --fail \
      --cacert "${ca_cert}" \
      -H "authorization: Bearer ${access_token}" \
      -X DELETE \
      "${api_base}/files/${uploaded_file_name}" >/dev/null || true
  fi

  if [[ -n "${external_vault_provider_id}" ]]; then
    curl --silent --show-error --fail \
      --cacert "${ca_cert}" \
      -H "authorization: Bearer ${access_token}" \
      -X DELETE \
      "${api_base}/vault-providers/${external_vault_provider_id}" >/dev/null || true
  fi

  if [[ -n "${sync_profile_id}" ]]; then
    curl --silent --show-error --fail \
      --cacert "${ca_cert}" \
      -H "authorization: Bearer ${access_token}" \
      -X DELETE \
      "${api_base}/sync-profiles/${sync_profile_id}" >/dev/null || true
  fi

  if [[ -n "${oauth_seed_provider}" && -n "${oauth_seed_provider_user_id}" ]]; then
    "${container_runtime}" exec \
      -e PGPASSWORD="${postgres_password}" \
      arsenale-postgres \
      psql -U "${db_user}" -d "${db_name}" -c \
      "DELETE FROM \"OAuthAccount\" WHERE \"userId\" = '${user_id}' AND provider = '${oauth_seed_provider}'::\"AuthProvider\" AND \"providerUserId\" = '${oauth_seed_provider_user_id}';" \
      >/dev/null 2>&1 || true
  fi

  if [[ -n "${oauth_vault_setup_user_id}" ]]; then
    "${container_runtime}" exec "${redis_container}" redis-cli DEL "vault:user:${oauth_vault_setup_user_id}" "vault:recovery:${oauth_vault_setup_user_id}" >/dev/null 2>&1 || true
    "${container_runtime}" exec \
      -e PGPASSWORD="${postgres_password}" \
      arsenale-postgres \
      psql -U "${db_user}" -d "${db_name}" -c \
      "DELETE FROM \"User\" WHERE id = '${oauth_vault_setup_user_id}';" \
      >/dev/null 2>&1 || true
  fi

  if [[ -n "${tenant_manage_user_id}" ]]; then
    "${container_runtime}" exec \
      -e PGPASSWORD="${postgres_password}" \
      arsenale-postgres \
      psql -U "${db_user}" -d "${db_name}" -c \
      "DELETE FROM \"User\" WHERE id = '${tenant_manage_user_id}';" \
      >/dev/null 2>&1 || true
  fi

  if [[ -n "${tenant_invite_user_id}" ]]; then
    "${container_runtime}" exec \
      -e PGPASSWORD="${postgres_password}" \
      arsenale-postgres \
      psql -U "${db_user}" -d "${db_name}" -c \
      "DELETE FROM \"TenantMember\" WHERE \"userId\" = '${tenant_invite_user_id}'; DELETE FROM \"User\" WHERE id = '${tenant_invite_user_id}';" \
      >/dev/null 2>&1 || true
  fi

  if [[ -n "${vault_recovery_user_id}" ]]; then
    "${container_runtime}" exec "${redis_container}" redis-cli DEL "vault:user:${vault_recovery_user_id}" "vault:recovery:${vault_recovery_user_id}" >/dev/null 2>&1 || true
    "${container_runtime}" exec \
      -e PGPASSWORD="${postgres_password}" \
      arsenale-postgres \
      psql -U "${db_user}" -d "${db_name}" -c \
      "DELETE FROM \"RefreshToken\" WHERE \"userId\" = '${vault_recovery_user_id}'; DELETE FROM \"TenantMember\" WHERE \"userId\" = '${vault_recovery_user_id}'; DELETE FROM \"User\" WHERE id = '${vault_recovery_user_id}';" \
      >/dev/null 2>&1 || true
  fi

  rm -f "${uploaded_file_local}" "${uploaded_file_downloaded}" >/dev/null 2>&1 || true

  if [[ -n "${public_share_id}" || -n "${public_share_secret_id}" ]]; then
    "${container_runtime}" exec \
      -e PGPASSWORD="${postgres_password}" \
      arsenale-postgres \
      psql -U "${db_user}" -d "${db_name}" -c \
      "DELETE FROM \"ExternalSecretShare\" WHERE id = '${public_share_id}'; DELETE FROM \"VaultSecret\" WHERE id = '${public_share_secret_id}';" \
      >/dev/null 2>&1 || true
  fi

  if [[ -n "${switch_tenant_temp_id}" ]]; then
    if [[ -n "${switch_tenant_temp_user_id}" ]]; then
      "${container_runtime}" exec \
        -e PGPASSWORD="${postgres_password}" \
        arsenale-postgres \
        psql -U "${db_user}" -d "${db_name}" -c \
        "DELETE FROM \"User\" WHERE id = '${switch_tenant_temp_user_id}';" \
        >/dev/null 2>&1 || true
    fi
    "${container_runtime}" exec \
      -e PGPASSWORD="${postgres_password}" \
      arsenale-postgres \
      psql -U "${db_user}" -d "${db_name}" -c \
      "DELETE FROM \"TenantMember\" WHERE \"tenantId\" = '${switch_tenant_temp_id}'; DELETE FROM \"Tenant\" WHERE id = '${switch_tenant_temp_id}';" \
      >/dev/null 2>&1 || true
  fi

  if [[ -n "${registered_temp_user_id}" ]]; then
    "${container_runtime}" exec \
      -e PGPASSWORD="${postgres_password}" \
      arsenale-postgres \
      psql -U "${db_user}" -d "${db_name}" -c \
      "DELETE FROM \"RefreshToken\" WHERE \"userId\" = '${registered_temp_user_id}'; DELETE FROM \"TenantMember\" WHERE \"userId\" = '${registered_temp_user_id}'; DELETE FROM \"User\" WHERE id = '${registered_temp_user_id}';" \
      >/dev/null 2>&1 || true
  elif [[ -n "${registered_temp_user_email}" ]]; then
    "${container_runtime}" exec \
      -e PGPASSWORD="${postgres_password}" \
      arsenale-postgres \
      psql -U "${db_user}" -d "${db_name}" -c \
      "DELETE FROM \"RefreshToken\" WHERE \"userId\" IN (SELECT id FROM \"User\" WHERE email = '${registered_temp_user_email}'); DELETE FROM \"TenantMember\" WHERE \"userId\" IN (SELECT id FROM \"User\" WHERE email = '${registered_temp_user_email}'); DELETE FROM \"User\" WHERE email = '${registered_temp_user_email}';" \
      >/dev/null 2>&1 || true
  fi

  if [[ -n "${verify_email_temp_user_id}" ]]; then
    "${container_runtime}" exec \
      -e PGPASSWORD="${postgres_password}" \
      arsenale-postgres \
      psql -U "${db_user}" -d "${db_name}" -c \
      "DELETE FROM \"User\" WHERE id = '${verify_email_temp_user_id}';" \
      >/dev/null 2>&1 || true
  fi

  if [[ -n "${resend_verification_temp_user_id}" ]]; then
    "${container_runtime}" exec \
      -e PGPASSWORD="${postgres_password}" \
      arsenale-postgres \
      psql -U "${db_user}" -d "${db_name}" -c \
      "DELETE FROM \"User\" WHERE id = '${resend_verification_temp_user_id}';" \
      >/dev/null 2>&1 || true
  fi

  if [[ -n "${forgot_password_temp_user_id}" ]]; then
    "${container_runtime}" exec \
      -e PGPASSWORD="${postgres_password}" \
      arsenale-postgres \
      psql -U "${db_user}" -d "${db_name}" -c \
      "DELETE FROM \"RefreshToken\" WHERE \"userId\" = '${forgot_password_temp_user_id}'; DELETE FROM \"User\" WHERE id = '${forgot_password_temp_user_id}';" \
      >/dev/null 2>&1 || true
  fi

  if [[ -n "${reset_validation_temp_user_id}" ]]; then
    "${container_runtime}" exec \
      -e PGPASSWORD="${postgres_password}" \
      arsenale-postgres \
      psql -U "${db_user}" -d "${db_name}" -c \
      "DELETE FROM \"User\" WHERE id = '${reset_validation_temp_user_id}';" \
      >/dev/null 2>&1 || true
  fi

  if [[ -n "${sms_mfa_temp_user_id}" ]]; then
    "${container_runtime}" exec \
      -e PGPASSWORD="${postgres_password}" \
      arsenale-postgres \
      psql -U "${db_user}" -d "${db_name}" -c \
      "DELETE FROM \"RefreshToken\" WHERE \"userId\" = '${sms_mfa_temp_user_id}'; DELETE FROM \"TenantMember\" WHERE \"userId\" = '${sms_mfa_temp_user_id}'; DELETE FROM \"User\" WHERE id = '${sms_mfa_temp_user_id}';" \
      >/dev/null 2>&1 || true
  fi

  if [[ -n "${webauthn_login_temp_user_id}" ]]; then
    "${container_runtime}" exec \
      -e PGPASSWORD="${postgres_password}" \
      arsenale-postgres \
      psql -U "${db_user}" -d "${db_name}" -c \
      "DELETE FROM \"RefreshToken\" WHERE \"userId\" = '${webauthn_login_temp_user_id}'; DELETE FROM \"WebAuthnCredential\" WHERE \"userId\" = '${webauthn_login_temp_user_id}'; DELETE FROM \"TenantMember\" WHERE \"userId\" = '${webauthn_login_temp_user_id}'; DELETE FROM \"User\" WHERE id = '${webauthn_login_temp_user_id}';" \
      >/dev/null 2>&1 || true
  fi

  if [[ -n "${mfa_setup_temp_user_id}" ]]; then
    "${container_runtime}" exec "${redis_container}" redis-cli DEL "vault:user:${mfa_setup_temp_user_id}" "vault:recovery:${mfa_setup_temp_user_id}" >/dev/null 2>&1 || true
    "${container_runtime}" exec \
      -e PGPASSWORD="${postgres_password}" \
      arsenale-postgres \
      psql -U "${db_user}" -d "${db_name}" -c \
      "DELETE FROM \"RefreshToken\" WHERE \"userId\" = '${mfa_setup_temp_user_id}'; DELETE FROM \"TenantMember\" WHERE \"userId\" = '${mfa_setup_temp_user_id}'; DELETE FROM \"User\" WHERE id = '${mfa_setup_temp_user_id}';" \
      >/dev/null 2>&1 || true
  fi

  if [[ -n "${mfa_setup_temp_tenant_id}" ]]; then
    "${container_runtime}" exec \
      -e PGPASSWORD="${postgres_password}" \
      arsenale-postgres \
      psql -U "${db_user}" -d "${db_name}" -c \
      "DELETE FROM \"Tenant\" WHERE id = '${mfa_setup_temp_tenant_id}';" \
      >/dev/null 2>&1 || true
  fi

  if [[ -n "${reset_sms_temp_user_id}" ]]; then
    "${container_runtime}" exec "${redis_container}" redis-cli DEL "vault:user:${reset_sms_temp_user_id}" "vault:recovery:${reset_sms_temp_user_id}" >/dev/null 2>&1 || true
    "${container_runtime}" exec \
      -e PGPASSWORD="${postgres_password}" \
      arsenale-postgres \
      psql -U "${db_user}" -d "${db_name}" -c \
      "DELETE FROM \"RefreshToken\" WHERE \"userId\" = '${reset_sms_temp_user_id}'; DELETE FROM \"TenantMember\" WHERE \"userId\" = '${reset_sms_temp_user_id}'; DELETE FROM \"User\" WHERE id = '${reset_sms_temp_user_id}';" \
      >/dev/null 2>&1 || true
  fi

  if [[ -n "${original_self_signup_enabled}" ]]; then
    "${container_runtime}" exec \
      -e PGPASSWORD="${postgres_password}" \
      arsenale-postgres \
      psql -U "${db_user}" -d "${db_name}" -c \
      "INSERT INTO \"AppConfig\" (key, value, \"updatedAt\") VALUES ('selfSignupEnabled', '${original_self_signup_enabled}', NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, \"updatedAt\" = NOW();" \
      >/dev/null 2>&1 || true
  fi

  if [[ -n "${seed_recording_id}" ]]; then
    "${container_runtime}" exec \
      -e PGPASSWORD="${postgres_password}" \
      arsenale-postgres \
      psql -U "${db_user}" -d "${db_name}" -c \
      "DELETE FROM \"SessionRecording\" WHERE id = '${seed_recording_id}'; DELETE FROM \"AuditLog\" WHERE details->>'recordingId' = '${seed_recording_id}';" \
      >/dev/null 2>&1 || true
  fi

  if [[ -n "${seed_guac_recording_id}" ]]; then
    "${container_runtime}" exec \
      -e PGPASSWORD="${postgres_password}" \
      arsenale-postgres \
      psql -U "${db_user}" -d "${db_name}" -c \
      "DELETE FROM \"SessionRecording\" WHERE id = '${seed_guac_recording_id}';" \
      >/dev/null 2>&1 || true
  fi

  if [[ -n "${seed_recording_file_path}" ]]; then
    "${container_runtime}" exec arsenale-control-plane-api rm -f "${seed_recording_file_path}" "${seed_recording_file_path}.mp4" >/dev/null 2>&1 || true
  fi

  if [[ -n "${seed_guac_recording_file_path}" ]]; then
    "${container_runtime}" exec arsenale-control-plane-api rm -f "${seed_guac_recording_file_path}" "${seed_guac_recording_file_path}.m4v" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

clear_login_rate_limits() {
  if [[ "${container_runtime}" != "podman" && "${container_runtime}" != "docker" ]]; then
    return
  fi
  local keys
  keys="$("${container_runtime}" exec "${redis_container}" redis-cli --scan --pattern 'rl:*' 2>/dev/null || true)"
  if [[ -n "${keys}" ]]; then
    # shellcheck disable=SC2086
    "${container_runtime}" exec "${redis_container}" redis-cli DEL ${keys} >/dev/null || true
  fi
}

clear_session_security_state() {
  if [[ "${container_runtime}" != "podman" && "${container_runtime}" != "docker" ]]; then
    return
  fi

  "${container_runtime}" exec \
    -e PGPASSWORD="${postgres_password}" \
    arsenale-postgres \
    psql -U "${db_user}" -d "${db_name}" -c \
    "UPDATE \"User\"
     SET \"failedLoginAttempts\" = 0,
         \"lockedUntil\" = NULL
     WHERE email = '${admin_email}';

     DELETE FROM \"AuditLog\"
     WHERE \"userId\" IN (
       SELECT id
       FROM \"User\"
       WHERE email = '${admin_email}'
     )
       AND action IN ('SESSION_START'::\"AuditAction\", 'ANOMALOUS_LATERAL_MOVEMENT'::\"AuditAction\");" \
    >/dev/null
}

login_json_for_password() {
  local password="$1"
  curl --silent --show-error --fail \
    --cacert "${ca_cert}" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"${admin_email}\",\"password\":\"${password}\"}" \
    "${api_base}/auth/login"
}

normalize_admin_password() {
  rm -f "${token_file}" "${tenant_file}"
  access_token=""
  tenant_id=""
  clear_login_rate_limits
  clear_session_security_state

  if login_json="$(login_json_for_password "${admin_password}" 2>/dev/null)"; then
    access_token="$(printf '%s' "${login_json}" | jq -r '.accessToken')"
    tenant_id="$(printf '%s' "${login_json}" | jq -r '.user.tenantId')"
    printf '%s' "${access_token}" > "${token_file}"
    printf '%s' "${tenant_id}" > "${tenant_file}"
    clear_login_rate_limits
    return
  fi

  if login_json="$(login_json_for_password "${rotated_admin_password}" 2>/dev/null)"; then
    local rotated_access_token
    rotated_access_token="$(printf '%s' "${login_json}" | jq -r '.accessToken')"
    curl --silent --show-error --fail \
      --cacert "${ca_cert}" \
      -H "authorization: Bearer ${rotated_access_token}" \
      -H 'content-type: application/json' \
      -X PUT \
      -d "{\"oldPassword\":\"${rotated_admin_password}\",\"newPassword\":\"${admin_password}\"}" \
      "${api_base}/user/password" \
      | jq -e '.success == true' >/dev/null
    rm -f "${token_file}" "${tenant_file}"
    access_token=""
    tenant_id=""
    clear_login_rate_limits
    return
  fi

  echo "unable to normalize admin password state" >&2
  return 1
}

ensure_access_token() {
  if [[ -n "${access_token}" ]]; then
    return
  fi

  if [[ -z "${access_token}" && -s "${token_file}" ]]; then
    access_token="$(cat "${token_file}")"
  fi
  if [[ -z "${tenant_id}" && -s "${tenant_file}" ]]; then
    tenant_id="$(cat "${tenant_file}")"
  fi

  if [[ -n "${access_token}" ]]; then
    if curl --silent --show-error --fail \
      --cacert "${ca_cert}" \
      -H "authorization: Bearer ${access_token}" \
      "${api_base}/user/profile" >/dev/null 2>&1; then
      if [[ -z "${tenant_id}" ]]; then
        tenant_id="$(
          TOKEN="${access_token}" python3 - <<'PY'
import base64
import json
import os

token = os.environ["TOKEN"]
payload = token.split(".")[1]
padding = "=" * (-len(payload) % 4)
decoded = base64.urlsafe_b64decode(payload + padding)
data = json.loads(decoded)
print(data.get("tenantId", ""))
PY
        )"
        if [[ -n "${tenant_id}" ]]; then
          printf '%s' "${tenant_id}" > "${tenant_file}"
        fi
      fi
      return
    fi
  fi

  login_json="$(curl --silent --show-error --fail \
    --cacert "${ca_cert}" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"${admin_email}\",\"password\":\"${admin_password}\"}" \
    "${api_base}/auth/login")"
  access_token="$(printf '%s' "${login_json}" | jq -r '.accessToken')"
  tenant_id="$(printf '%s' "${login_json}" | jq -r '.user.tenantId')"
  printf '%s' "${access_token}" > "${token_file}"
  printf '%s' "${tenant_id}" > "${tenant_file}"
}

normalize_admin_password

echo '1. /api/ready'
curl --silent --show-error --fail --cacert "${ca_cert}" "${api_base}/ready" \
  | jq -e '.status == "ok"' >/dev/null

echo '1.1 /api/setup/status'
curl --silent --show-error --fail --cacert "${ca_cert}" "${api_base}/setup/status" \
  | jq -e '.required == false' >/dev/null

echo '1.2 /api/setup/db-status'
setup_db_status_code="$(curl --silent --show-error --output /tmp/arsenale-setup-db-status.json --write-out '%{http_code}' --cacert "${ca_cert}" "${api_base}/setup/db-status")"
[[ "${setup_db_status_code}" == "403" ]]
jq -e '.error == "Setup has already been completed"' /tmp/arsenale-setup-db-status.json >/dev/null

echo '1.3 /api/auth/config'
curl --silent --show-error --fail --cacert "${ca_cert}" "${api_base}/auth/config" \
  | jq -e '.selfSignupEnabled == false and .features.databaseProxyEnabled == true and .features.connectionsEnabled == true and .features.keychainEnabled == true' >/dev/null

echo '1.3.1 /api/auth/oauth/providers'
curl --silent --show-error --fail --cacert "${ca_cert}" "${api_base}/auth/oauth/providers" \
  | jq -e 'type == "object"' >/dev/null

echo '2. login'
ensure_access_token
[[ -n "${access_token}" && "${access_token}" != "null" ]]
[[ -n "${tenant_id}" && "${tenant_id}" != "null" ]]

echo '2.1 /api/user/profile'
profile_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/user/profile" \
)"
printf '%s' "${profile_json}" | jq -e '.email == "'"${admin_email}"'" and .hasPassword == true' >/dev/null
user_id="$(printf '%s' "${profile_json}" | jq -r '.id')"
[[ -n "${user_id}" && "${user_id}" != "null" ]]

echo '2.0.1 /api/auth/oauth/accounts + unlink'
oauth_accounts_before="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/auth/oauth/accounts")"
printf '%s' "${oauth_accounts_before}" | jq -e 'type == "array"' >/dev/null
oauth_seed_provider="$(
  printf '%s' "${oauth_accounts_before}" \
    | jq -r '((["github","oidc","google","microsoft","saml","ldap"] - (map(.provider | ascii_downcase))) | .[0]) // ""'
)"
[[ -n "${oauth_seed_provider}" ]]
oauth_seed_provider_upper="${oauth_seed_provider^^}"
oauth_seed_provider_user_id="seed-$(date +%s)"
oauth_seed_id="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"

"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "INSERT INTO \"OAuthAccount\" (id, \"userId\", provider, \"providerUserId\", \"providerEmail\", \"createdAt\", \"updatedAt\") VALUES ('${oauth_seed_id}', '${user_id}', '${oauth_seed_provider_upper}'::\"AuthProvider\", '${oauth_seed_provider_user_id}', 'seed-${oauth_seed_provider}@example.com', NOW(), NOW());" \
  >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/auth/oauth/accounts" \
  | jq -e --arg provider "${oauth_seed_provider_upper}" 'map(select(.provider == $provider)) | length >= 1' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -X DELETE \
  "${api_base}/auth/oauth/link/${oauth_seed_provider}" \
  | jq -e '.success == true' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/auth/oauth/accounts" \
  | jq -e --arg provider "${oauth_seed_provider_upper}" 'map(select(.provider == $provider)) | length == 0' >/dev/null

oauth_seed_provider=""
oauth_seed_provider_user_id=""

echo '2.0.2 /api/auth/oauth/link-code + exchange-code'
oauth_link_code_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -X POST \
  "${api_base}/auth/oauth/link-code")"
oauth_link_code="$(printf '%s' "${oauth_link_code_json}" | jq -r '.code')"
[[ -n "${oauth_link_code}" && "${oauth_link_code}" != "null" ]]

oauth_exchange_code="exchange-$(date +%s)-$$"
oauth_exchange_payload="$(python3 - <<'PY'
import json, time
print(json.dumps({
  "accessToken": "seed-access-token",
  "csrfToken": "seed-csrf-token",
  "needsVaultSetup": False,
  "userId": "seed-user",
  "email": "seed@example.com",
  "username": "seed-user",
  "avatarData": "",
  "tenantId": "seed-tenant",
  "tenantRole": "ADMIN",
  "expiresAt": int(time.time() * 1000) + 60000,
}))
PY
)"
printf '%s' "${oauth_exchange_payload}" | "${container_runtime}" exec -i "${redis_container}" redis-cli -x SET "auth:code:${oauth_exchange_code}" >/dev/null
"${container_runtime}" exec "${redis_container}" redis-cli EXPIRE "auth:code:${oauth_exchange_code}" 60 >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H 'content-type: application/json' \
  -d "{\"code\":\"${oauth_exchange_code}\"}" \
  "${api_base}/auth/oauth/exchange-code" \
  | jq -e '.accessToken == "seed-access-token" and .csrfToken == "seed-csrf-token" and .userId == "seed-user" and .tenantRole == "ADMIN"' >/dev/null

oauth_exchange_status="$(
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --cacert "${ca_cert}" \
    -H 'content-type: application/json' \
    -d "{\"code\":\"${oauth_exchange_code}\"}" \
    "${api_base}/auth/oauth/exchange-code" || true
)"
[[ "${oauth_exchange_status}" == "400" ]]

echo '2.0.3 /api/auth/oauth/vault-setup'
oauth_vault_setup_user_id="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
oauth_vault_setup_email="oauth-vault-${oauth_vault_setup_user_id}@example.com"
oauth_vault_setup_account_id="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
oauth_vault_setup_membership_id="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
oauth_vault_setup_provider_user_id="oauth-vault-user-$(date +%s)-$$"
oauth_vault_setup_user_agent="arsenale-dev-acceptance"
oauth_vault_setup_forwarded_ip="127.0.0.1"

"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "INSERT INTO \"User\" (id, email, enabled, \"vaultSetupComplete\", \"createdAt\", \"updatedAt\") VALUES ('${oauth_vault_setup_user_id}', '${oauth_vault_setup_email}', true, false, NOW(), NOW());
   INSERT INTO \"TenantMember\" (id, \"tenantId\", \"userId\", role, status, \"isActive\", \"joinedAt\", \"updatedAt\") VALUES ('${oauth_vault_setup_membership_id}', '${tenant_id}', '${oauth_vault_setup_user_id}', 'MEMBER', 'ACCEPTED', true, NOW(), NOW());
   INSERT INTO \"OAuthAccount\" (id, \"userId\", provider, \"providerUserId\", \"providerEmail\", \"createdAt\", \"updatedAt\") VALUES ('${oauth_vault_setup_account_id}', '${oauth_vault_setup_user_id}', 'GITHUB'::\"AuthProvider\", '${oauth_vault_setup_provider_user_id}', '${oauth_vault_setup_email}', NOW(), NOW());" \
  >/dev/null

oauth_vault_setup_token="$(
  OAUTH_USER_ID="${oauth_vault_setup_user_id}" \
  OAUTH_EMAIL="${oauth_vault_setup_email}" \
  OAUTH_TENANT_ID="${tenant_id}" \
  OAUTH_IP_UA_HASH="$(
    OAUTH_VAULT_SETUP_FORWARDED_IP="${oauth_vault_setup_forwarded_ip}" \
    OAUTH_VAULT_SETUP_USER_AGENT="${oauth_vault_setup_user_agent}" \
    python3 - <<'PY'
import hashlib
import os

print(hashlib.sha256(f"{os.environ['OAUTH_VAULT_SETUP_FORWARDED_IP']}|{os.environ['OAUTH_VAULT_SETUP_USER_AGENT']}".encode("utf-8")).hexdigest())
PY
  )" \
  JWT_SECRET_VALUE="${jwt_secret}" \
  python3 - <<'PY'
import base64
import hashlib
import hmac
import json
import os
import time

def b64url(data: bytes) -> bytes:
    return base64.urlsafe_b64encode(data).rstrip(b"=")

header = {"alg": "HS256", "typ": "JWT"}
payload = {
    "userId": os.environ["OAUTH_USER_ID"],
    "email": os.environ["OAUTH_EMAIL"],
    "tenantId": os.environ["OAUTH_TENANT_ID"],
    "tenantRole": "MEMBER",
    "type": "access",
    "ipUaHash": os.environ["OAUTH_IP_UA_HASH"],
    "exp": int(time.time()) + 900,
    "iat": int(time.time()),
}
header_b64 = b64url(json.dumps(header, separators=(",", ":")).encode("utf-8"))
payload_b64 = b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
message = header_b64 + b"." + payload_b64
signature = hmac.new(os.environ["JWT_SECRET_VALUE"].encode("utf-8"), message, hashlib.sha256).digest()
print((message + b"." + b64url(signature)).decode("utf-8"))
PY
)"

oauth_vault_setup_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${oauth_vault_setup_token}" \
  -H "user-agent: ${oauth_vault_setup_user_agent}" \
  -H "x-forwarded-for: ${oauth_vault_setup_forwarded_ip}" \
  -H 'content-type: application/json' \
  -d '{"vaultPassword":"VaultSetup91Qx"}' \
  "${api_base}/auth/oauth/vault-setup")"
printf '%s' "${oauth_vault_setup_json}" | jq -e '.success == true and .vaultSetupComplete == true' >/dev/null

"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -Atqc \
  "SELECT COALESCE(\"vaultSetupComplete\", false)::text || '|' || COALESCE(length(\"vaultSalt\"),0)::text || '|' || COALESCE(length(\"encryptedVaultKey\"),0)::text || '|' || COALESCE(length(\"vaultKeyIV\"),0)::text || '|' || COALESCE(length(\"vaultKeyTag\"),0)::text FROM \"User\" WHERE id = '${oauth_vault_setup_user_id}'" \
  | grep -E '^true\|[1-9][0-9]*\|[1-9][0-9]*\|[1-9][0-9]*\|[1-9][0-9]*$' >/dev/null

"${container_runtime}" exec "${redis_container}" redis-cli EXISTS "vault:user:${oauth_vault_setup_user_id}" | grep -qx '1'
"${container_runtime}" exec "${redis_container}" redis-cli EXISTS "vault:recovery:${oauth_vault_setup_user_id}" | grep -qx '1'

"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -Atqc \
  "SELECT COUNT(*) FROM \"AuditLog\" WHERE \"userId\" = '${oauth_vault_setup_user_id}' AND action = 'VAULT_SETUP'" \
  | grep -qx '1'

echo '2.1.0 /api/cli auth device flow + connections'
cli_device_response="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H 'content-type: application/json' \
  -X POST \
  -d '{}' \
  "${api_base}/cli/auth/device" \
)"
printf '%s' "${cli_device_response}" | jq -e '.device_code and .user_code and .verification_uri and .verification_uri_complete and (.interval == 5)' >/dev/null
cli_device_code="$(printf '%s' "${cli_device_response}" | jq -r '.device_code')"
cli_user_code="$(printf '%s' "${cli_device_response}" | jq -r '.user_code')"

cli_pending_response="$(curl --silent --show-error --fail-with-body \
  --cacert "${ca_cert}" \
  -H 'content-type: application/json' \
  -X POST \
  -d "{\"device_code\":\"${cli_device_code}\"}" \
  "${api_base}/cli/auth/device/token" \
  || true \
)"
printf '%s' "${cli_pending_response}" | jq -e '.error == "authorization_pending"' >/dev/null

cli_authorize_response="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X POST \
  -d "{\"user_code\":\"${cli_user_code}\"}" \
  "${api_base}/cli/auth/device/authorize" \
)"
printf '%s' "${cli_authorize_response}" | jq -e '.message == "Device authorized successfully"' >/dev/null

cli_token_response="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H 'content-type: application/json' \
  -X POST \
  -d "{\"device_code\":\"${cli_device_code}\"}" \
  "${api_base}/cli/auth/device/token" \
)"
printf '%s' "${cli_token_response}" | jq -e '.access_token and .refresh_token and .token_type == "Bearer" and .user.id' >/dev/null

cli_connections_response="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/cli/connections" \
)"
printf '%s' "${cli_connections_response}" | jq -e 'type == "array"' >/dev/null

echo '2.1.1 /api/user/profile update'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d '{"username":"admin"}' \
  "${api_base}/user/profile" \
  | jq -e '.email == "'"${admin_email}"'" and .username == "admin"' >/dev/null

echo '2.1.1.1 /api/user/password-change/initiate'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X POST \
  "${api_base}/user/password-change/initiate" \
  | jq -e '.skipVerification == true' >/dev/null

echo '2.1.1.2 /api/user/identity/initiate'
identity_verification_id="$(
  curl --silent --show-error --fail \
    --cacert "${ca_cert}" \
    -H "authorization: Bearer ${access_token}" \
    -H 'content-type: application/json' \
    -X POST \
    -d '{"purpose":"password-change"}' \
    "${api_base}/user/identity/initiate" \
    | jq -r '.verificationId'
)"
[[ -n "${identity_verification_id}" && "${identity_verification_id}" != "null" ]]

echo '2.1.1.3 /api/user/identity/confirm'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X POST \
  -d '{"verificationId":"'"${identity_verification_id}"'","password":"'"${admin_password}"'"}' \
  "${api_base}/user/identity/confirm" \
  | jq -e '.confirmed == true' >/dev/null

original_admin_password="${admin_password}"

echo '2.1.1.4 /api/user/password rotate temp'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d '{"oldPassword":"'"${original_admin_password}"'","newPassword":"'"${rotated_admin_password}"'"}' \
  "${api_base}/user/password" \
  | jq -e '.success == true and (.recoveryKey | length > 10)' >/dev/null

rm -f "${token_file}" "${tenant_file}"
access_token=""
tenant_id=""
admin_password="${rotated_admin_password}"

echo '2.1.1.5 /api/auth/login with rotated password'
ensure_access_token
[[ -n "${access_token}" && "${access_token}" != "null" ]]

echo '2.1.1.6 /api/user/password restore original'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d '{"oldPassword":"'"${rotated_admin_password}"'","newPassword":"'"${original_admin_password}"'"}' \
  "${api_base}/user/password" \
  | jq -e '.success == true and (.recoveryKey | length > 10)' >/dev/null

rm -f "${token_file}" "${tenant_file}"
access_token=""
tenant_id=""
admin_password="${original_admin_password}"

echo '2.1.1.7 /api/auth/login with restored password'
ensure_access_token
[[ -n "${access_token}" && "${access_token}" != "null" ]]

echo '2.1.2 /api/user/ssh-defaults'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d '{"theme":"acceptance-dark","fontSize":15}' \
  "${api_base}/user/ssh-defaults" \
  | jq -e '.sshDefaults.theme == "acceptance-dark" and .sshDefaults.fontSize == 15' >/dev/null

echo '2.1.3 /api/user/rdp-defaults'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d '{"width":1280,"height":720,"qualityPreset":"balanced"}' \
  "${api_base}/user/rdp-defaults" \
  | jq -e '.rdpDefaults.width == 1280 and .rdpDefaults.height == 720 and .rdpDefaults.qualityPreset == "balanced"' >/dev/null

echo '2.1.4 /api/user/profile readback'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/user/profile" \
  | jq -e '.sshDefaults.theme == "acceptance-dark" and .rdpDefaults.width == 1280 and .rdpDefaults.height == 720' >/dev/null

echo '2.1.4.0 /api/user/2fa status surfaces'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/user/2fa/status" \
  | jq -e '(.enabled | type == "boolean")' >/dev/null
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/user/2fa/sms/status" \
  | jq -e '(.enabled | type == "boolean") and (.phoneVerified | type == "boolean")' >/dev/null
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/user/2fa/webauthn/status" \
  | jq -e '(.enabled | type == "boolean") and (.credentialCount | type == "number")' >/dev/null
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/user/2fa/webauthn/credentials" \
  | jq -e 'type == "array"' >/dev/null

echo '2.1.4.0.1 /api/user/2fa/webauthn/registration-options'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d '{}' \
  "${api_base}/user/2fa/webauthn/registration-options" \
  | jq -e --arg expectedRpId "${expected_webauthn_rp_id}" --arg expectedUser "${admin_email}" '
      .challenge
      and (.rp.id | type == "string" and length > 0)
      and ($expectedRpId == "" or .rp.id == $expectedRpId)
      and .rp.name == "Arsenale"
      and .attestation == "none"
      and .user.name == $expectedUser
      and .authenticatorSelection.userVerification == "preferred"
    ' >/dev/null

echo '2.1.4.1 /api/vault/status'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/vault/status" \
  | jq -e '.unlocked == true and .mfaUnlockAvailable == false and (.vaultNeedsRecovery | type == "boolean") and (.mfaUnlockMethods | type == "array")' >/dev/null

echo '2.1.4.1.1 /api/vault/recovery-status'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/vault/recovery-status" \
  | jq -e '(.needsRecovery | type == "boolean") and (.hasRecoveryKey | type == "boolean")' >/dev/null

echo '2.1.4.1.2 /api/secrets tenant-vault/status + counts'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/secrets/tenant-vault/status" \
  | jq -e '(.initialized | type == "boolean") and (.hasAccess | type == "boolean")' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/secrets/counts" \
  | jq -e '(.pwnedCount | type == "number") and (.expiringCount | type == "number")' >/dev/null

echo '2.1.4.1.3 /api/secrets rotation enable/status/history/disable'
rotation_secret_id="$(
  python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
rotation_log_id="$(
  python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "INSERT INTO \"VaultSecret\" (id, name, type, scope, \"userId\", \"encryptedData\", \"dataIV\", \"dataTag\", \"currentVersion\", \"targetRotationEnabled\", \"rotationIntervalDays\", \"lastRotatedAt\", \"createdAt\", \"updatedAt\") VALUES ('${rotation_secret_id}', 'Acceptance Rotation Secret', 'LOGIN', 'PERSONAL', '${user_id}', '00', '00', '00', 1, false, 30, NOW(), NOW(), NOW()); INSERT INTO \"PasswordRotationLog\" (id, \"secretId\", status, trigger, \"targetOS\", \"targetHost\", \"targetUser\", \"durationMs\", \"initiatedBy\", \"createdAt\") VALUES ('${rotation_log_id}', '${rotation_secret_id}', 'SUCCESS', 'MANUAL', 'LINUX', 'rotation-host', 'acceptance-user', 123, '${user_id}', NOW());" \
  >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d '{"intervalDays":45}' \
  "${api_base}/secrets/${rotation_secret_id}/rotation/enable" \
  | jq -e '.enabled == true and .intervalDays == 45' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d "{\"secretId\":\"${rotation_secret_id}\"}" \
  "${api_base}/secrets/rotation/status" \
  | jq -e '.enabled == true and .intervalDays == 45 and .lastRotatedAt != null and .nextRotationAt != null' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d "{\"secretId\":\"${rotation_secret_id}\",\"limit\":5}" \
  "${api_base}/secrets/rotation/history" \
  | jq -e 'type == "array" and length >= 1 and .[0].status == "SUCCESS" and .[0].trigger == "MANUAL"' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d '{}' \
  "${api_base}/secrets/${rotation_secret_id}/rotation/disable" \
  | jq -e '.enabled == false' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d "{\"secretId\":\"${rotation_secret_id}\"}" \
  "${api_base}/secrets/rotation/status" \
  | jq -e '.enabled == false and .intervalDays == 45' >/dev/null

"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "DELETE FROM \"VaultSecret\" WHERE id = '${rotation_secret_id}';" \
  >/dev/null
rotation_secret_id=""

echo '2.1.4.2 /api/vault/auto-lock get/update/restore'
vault_auto_lock_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/vault/auto-lock")"
vault_auto_lock_original="$(printf '%s' "${vault_auto_lock_json}" | jq -c '{autoLockMinutes: .autoLockMinutes}')"
vault_auto_lock_temp="$(
  printf '%s' "${vault_auto_lock_json}" \
    | jq -r '((.tenantMaxMinutes // 15) | if . > 0 and . < 15 then . else 15 end)'
)"
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d "{\"autoLockMinutes\":${vault_auto_lock_temp}}" \
  "${api_base}/vault/auto-lock" \
  | jq -e --argjson expected "${vault_auto_lock_temp}" '.autoLockMinutes == $expected and (.effectiveMinutes | type == "number")' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/vault/auto-lock" \
  | jq -e --argjson expected "${vault_auto_lock_temp}" '.autoLockMinutes == $expected and (.effectiveMinutes | type == "number")' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d "${vault_auto_lock_original}" \
  "${api_base}/vault/auto-lock" \
  | jq -e '.effectiveMinutes | type == "number"' >/dev/null

echo '2.1.4.3 temp user /api/vault unlock + recovery + explicit-reset'
vault_recovery_user_id="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
vault_recovery_email="vault-recovery-${vault_recovery_user_id}@example.com"
vault_recovery_membership_id="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
vault_recovery_username="vault-recovery-$(date +%s)"

"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "INSERT INTO \"User\" (id, email, username, enabled, \"emailVerified\", \"passwordHash\", \"vaultSalt\", \"encryptedVaultKey\", \"vaultKeyIV\", \"vaultKeyTag\", \"encryptedVaultRecoveryKey\", \"vaultRecoveryKeyIV\", \"vaultRecoveryKeyTag\", \"vaultRecoveryKeySalt\", \"vaultSetupComplete\", \"createdAt\", \"updatedAt\")
   SELECT '${vault_recovery_user_id}', '${vault_recovery_email}', '${vault_recovery_username}', true, true, \"passwordHash\", \"vaultSalt\", \"encryptedVaultKey\", \"vaultKeyIV\", \"vaultKeyTag\", \"encryptedVaultRecoveryKey\", \"vaultRecoveryKeyIV\", \"vaultRecoveryKeyTag\", \"vaultRecoveryKeySalt\", COALESCE(\"vaultSetupComplete\", true), NOW(), NOW()
   FROM \"User\" WHERE id = '${user_id}';
   INSERT INTO \"TenantMember\" (id, \"tenantId\", \"userId\", role, status, \"isActive\", \"joinedAt\", \"updatedAt\")
   VALUES ('${vault_recovery_membership_id}', '${tenant_id}', '${vault_recovery_user_id}', 'MEMBER', 'ACCEPTED', true, NOW(), NOW());" \
  >/dev/null

clear_login_rate_limits
temp_vault_login_json="$(
  curl --silent --show-error --fail \
    --cacert "${ca_cert}" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"${vault_recovery_email}\",\"password\":\"${admin_password}\"}" \
    "${api_base}/auth/login"
)"
temp_vault_access_token="$(printf '%s' "${temp_vault_login_json}" | jq -r '.accessToken')"
[[ -n "${temp_vault_access_token}" && "${temp_vault_access_token}" != "null" ]]

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${temp_vault_access_token}" \
  -X POST \
  "${api_base}/vault/lock" \
  | jq -e '.unlocked == false' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${temp_vault_access_token}" \
  "${api_base}/vault/status" \
  | jq -e '.unlocked == false' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${temp_vault_access_token}" \
  -H 'content-type: application/json' \
  -d "{\"password\":\"${admin_password}\"}" \
  "${api_base}/vault/unlock" \
  | jq -e '.unlocked == true' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${temp_vault_access_token}" \
  "${api_base}/vault/status" \
  | jq -e '.unlocked == true' >/dev/null

echo '2.1.4.3.0 /api/user/2fa setup/verify/disable'
temp_totp_setup_json="$(
  curl --silent --show-error --fail \
    --cacert "${ca_cert}" \
    -H "authorization: Bearer ${temp_vault_access_token}" \
    -X POST \
    "${api_base}/user/2fa/setup"
)"
temp_totp_secret="$(printf '%s' "${temp_totp_setup_json}" | jq -r '.secret')"
[[ -n "${temp_totp_secret}" && "${temp_totp_secret}" != "null" ]]
printf '%s' "${temp_totp_setup_json}" | jq -e '.otpauthUri | startswith("otpauth://totp/")' >/dev/null

temp_totp_code="$(
  python3 - "${temp_totp_secret}" <<'PY'
import base64
import hashlib
import hmac
import struct
import sys
import time

secret = sys.argv[1].strip().replace(" ", "").replace("-", "").upper()
padding = "=" * ((8 - len(secret) % 8) % 8)
key = base64.b32decode(secret + padding, casefold=True)
counter = int(time.time()) // 30
msg = struct.pack(">Q", counter)
digest = hmac.new(key, msg, hashlib.sha1).digest()
offset = digest[-1] & 0x0F
value = struct.unpack(">I", digest[offset:offset+4])[0] & 0x7FFFFFFF
print(f"{value % 1000000:06d}")
PY
)"

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${temp_vault_access_token}" \
  -H 'content-type: application/json' \
  -d "{\"code\":\"${temp_totp_code}\"}" \
  "${api_base}/user/2fa/verify" \
  | jq -e '.enabled == true' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${temp_vault_access_token}" \
  "${api_base}/user/2fa/status" \
  | jq -e '.enabled == true' >/dev/null

temp_totp_disable_code="$(
  python3 - "${temp_totp_secret}" <<'PY'
import base64
import hashlib
import hmac
import struct
import sys
import time

secret = sys.argv[1].strip().replace(" ", "").replace("-", "").upper()
padding = "=" * ((8 - len(secret) % 8) % 8)
key = base64.b32decode(secret + padding, casefold=True)
counter = int(time.time()) // 30
msg = struct.pack(">Q", counter)
digest = hmac.new(key, msg, hashlib.sha1).digest()
offset = digest[-1] & 0x0F
value = struct.unpack(">I", digest[offset:offset+4])[0] & 0x7FFFFFFF
print(f"{value % 1000000:06d}")
PY
)"

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${temp_vault_access_token}" \
  -H 'content-type: application/json' \
  -d "{\"code\":\"${temp_totp_disable_code}\"}" \
  "${api_base}/user/2fa/disable" \
  | jq -e '.enabled == false' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${temp_vault_access_token}" \
  "${api_base}/user/2fa/status" \
  | jq -e '.enabled == false' >/dev/null

echo '2.1.4.3.0.1 /api/user/2fa/sms setup/verify/enable/disable'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${temp_vault_access_token}" \
  -H 'content-type: application/json' \
  -d '{"phoneNumber":"+15550003333"}' \
  "${api_base}/user/2fa/sms/setup-phone" \
  | jq -e '.message == "Verification code sent"' >/dev/null

"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -Atqc \
  "SELECT COALESCE(\"phoneNumber\", '') || '|' || COALESCE(\"phoneVerified\", false)::text || '|' || (\"smsOtpHash\" IS NOT NULL)::text FROM \"User\" WHERE id = '${vault_recovery_user_id}'" \
  | grep -qx '+15550003333|false|true'

sms_setup_verify_code="246810"
sms_setup_verify_hash="$(printf '%s' "${sms_setup_verify_code}" | sha256sum | awk '{print $1}')"
"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "UPDATE \"User\" SET \"smsOtpHash\" = '${sms_setup_verify_hash}', \"smsOtpExpiresAt\" = NOW() + INTERVAL '5 minutes', \"updatedAt\" = NOW() WHERE id = '${vault_recovery_user_id}';" \
  >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${temp_vault_access_token}" \
  -H 'content-type: application/json' \
  -d "{\"code\":\"${sms_setup_verify_code}\"}" \
  "${api_base}/user/2fa/sms/verify-phone" \
  | jq -e '.verified == true' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${temp_vault_access_token}" \
  "${api_base}/user/2fa/sms/status" \
  | jq -e '.enabled == false and .phoneVerified == true and (.phoneNumber | endswith("3333"))' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${temp_vault_access_token}" \
  -X POST \
  "${api_base}/user/2fa/sms/enable" \
  | jq -e '.enabled == true' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${temp_vault_access_token}" \
  "${api_base}/user/2fa/sms/status" \
  | jq -e '.enabled == true and .phoneVerified == true and (.phoneNumber | endswith("3333"))' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${temp_vault_access_token}" \
  -X POST \
  "${api_base}/user/2fa/sms/send-disable-code" \
  | jq -e '.message == "Verification code sent"' >/dev/null

sms_disable_code="135790"
sms_disable_hash="$(printf '%s' "${sms_disable_code}" | sha256sum | awk '{print $1}')"
"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "UPDATE \"User\" SET \"smsOtpHash\" = '${sms_disable_hash}', \"smsOtpExpiresAt\" = NOW() + INTERVAL '5 minutes', \"updatedAt\" = NOW() WHERE id = '${vault_recovery_user_id}';" \
  >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${temp_vault_access_token}" \
  -H 'content-type: application/json' \
  -d "{\"code\":\"${sms_disable_code}\"}" \
  "${api_base}/user/2fa/sms/disable" \
  | jq -e '.enabled == false' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${temp_vault_access_token}" \
  "${api_base}/user/2fa/sms/status" \
  | jq -e '.enabled == false and .phoneNumber == null and .phoneVerified == false' >/dev/null

echo '2.1.4.3.0.2 /api/user/2fa/webauthn rename/remove'
temp_webauthn_credential_id="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
temp_webauthn_credential_ref="$(python3 - <<'PY'
import uuid
print(uuid.uuid4().hex)
PY
)"
"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "UPDATE \"User\" SET \"webauthnEnabled\" = true, \"updatedAt\" = NOW() WHERE id = '${vault_recovery_user_id}'; INSERT INTO \"WebAuthnCredential\" (id, \"userId\", \"credentialId\", \"publicKey\", counter, transports, \"friendlyName\", \"createdAt\") VALUES ('${temp_webauthn_credential_id}', '${vault_recovery_user_id}', '${temp_webauthn_credential_ref}', 'cHVibGljLWtleQ', 0, ARRAY['usb'], 'Initial Key', NOW());" \
  >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${temp_vault_access_token}" \
  "${api_base}/user/2fa/webauthn/credentials" \
  | jq -e --arg id "${temp_webauthn_credential_id}" '.[] | select(.id == $id and .friendlyName == "Initial Key")' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${temp_vault_access_token}" \
  -H 'content-type: application/json' \
  -X PATCH \
  -d '{"friendlyName":"Renamed Key"}' \
  "${api_base}/user/2fa/webauthn/credentials/${temp_webauthn_credential_id}" \
  | jq -e '.renamed == true' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${temp_vault_access_token}" \
  "${api_base}/user/2fa/webauthn/credentials" \
  | jq -e --arg id "${temp_webauthn_credential_id}" '.[] | select(.id == $id and .friendlyName == "Renamed Key")' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${temp_vault_access_token}" \
  -X DELETE \
  "${api_base}/user/2fa/webauthn/credentials/${temp_webauthn_credential_id}" \
  | jq -e '.removed == true' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${temp_vault_access_token}" \
  "${api_base}/user/2fa/webauthn/status" \
  | jq -e '.enabled == false and .credentialCount == 0' >/dev/null

vault_totp_secret="JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"
"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "UPDATE \"User\"
      SET \"totpEnabled\" = true,
          \"totpSecret\" = '${vault_totp_secret}',
          \"encryptedTotpSecret\" = NULL,
          \"totpSecretIV\" = NULL,
          \"totpSecretTag\" = NULL,
          \"updatedAt\" = NOW()
    WHERE id = '${vault_recovery_user_id}';" \
  >/dev/null

echo '2.1.4.3.1 /api/vault unlock-mfa/totp'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${temp_vault_access_token}" \
  -X POST \
  "${api_base}/vault/lock" \
  | jq -e '.unlocked == false' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${temp_vault_access_token}" \
  "${api_base}/vault/status" \
  | jq -e '.unlocked == false and .mfaUnlockAvailable == true and (.mfaUnlockMethods | index("totp")) != null' >/dev/null

vault_totp_code="$(
  python3 - "${vault_totp_secret}" <<'PY'
import base64
import hashlib
import hmac
import struct
import sys
import time

secret = sys.argv[1].strip().replace(" ", "").replace("-", "").upper()
padding = "=" * ((8 - len(secret) % 8) % 8)
key = base64.b32decode(secret + padding, casefold=True)
counter = int(time.time()) // 30
msg = struct.pack(">Q", counter)
digest = hmac.new(key, msg, hashlib.sha1).digest()
offset = digest[-1] & 0x0F
value = struct.unpack(">I", digest[offset:offset+4])[0] & 0x7FFFFFFF
print(f"{value % 1000000:06d}")
PY
)"

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${temp_vault_access_token}" \
  -H 'content-type: application/json' \
  -d "{\"code\":\"${vault_totp_code}\"}" \
  "${api_base}/vault/unlock-mfa/totp" \
  | jq -e '.unlocked == true' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${temp_vault_access_token}" \
  "${api_base}/vault/status" \
  | jq -e '.unlocked == true' >/dev/null

vault_temp_rotated_password="VaultTemp91Qx!"
temp_recovery_key="$(
  curl --silent --show-error --fail \
    --cacert "${ca_cert}" \
    -H "authorization: Bearer ${temp_vault_access_token}" \
    -H 'content-type: application/json' \
    -X PUT \
    -d "{\"oldPassword\":\"${admin_password}\",\"newPassword\":\"${vault_temp_rotated_password}\"}" \
    "${api_base}/user/password" \
    | jq -r '.recoveryKey'
)"
[[ -n "${temp_recovery_key}" && "${temp_recovery_key}" != "null" ]]

clear_login_rate_limits
temp_vault_login_json="$(
  curl --silent --show-error --fail \
    --cacert "${ca_cert}" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"${vault_recovery_email}\",\"password\":\"${vault_temp_rotated_password}\"}" \
    "${api_base}/auth/login"
)"
temp_vault_access_token="$(printf '%s' "${temp_vault_login_json}" | jq -r '.accessToken // empty')"
if [[ -z "${temp_vault_access_token}" ]]; then
  temp_vault_temp_token="$(printf '%s' "${temp_vault_login_json}" | jq -r '.tempToken // empty')"
  [[ -n "${temp_vault_temp_token}" ]]
  vault_totp_code="$(
    python3 - "${vault_totp_secret}" <<'PY'
import base64
import hashlib
import hmac
import struct
import sys
import time

secret = sys.argv[1].strip().replace(' ', '').replace('-', '').upper()
padding = '=' * ((8 - len(secret) % 8) % 8)
key = base64.b32decode(secret + padding)
counter = int(time.time()) // 30
msg = struct.pack(">Q", counter)
digest = hmac.new(key, msg, hashlib.sha1).digest()
offset = digest[-1] & 0x0F
value = struct.unpack(">I", digest[offset:offset+4])[0] & 0x7FFFFFFF
print(f"{value % 1000000:06d}")
PY
  )"
  temp_vault_login_json="$(
    curl --silent --show-error --fail \
      --cacert "${ca_cert}" \
      -H 'content-type: application/json' \
      -d "{\"tempToken\":\"${temp_vault_temp_token}\",\"code\":\"${vault_totp_code}\"}" \
      "${api_base}/auth/verify-totp"
  )"
  temp_vault_access_token="$(printf '%s' "${temp_vault_login_json}" | jq -r '.accessToken // empty')"
fi
[[ -n "${temp_vault_access_token}" && "${temp_vault_access_token}" != "null" ]]

"${container_runtime}" exec "${redis_container}" redis-cli DEL "vault:user:${vault_recovery_user_id}" "vault:recovery:${vault_recovery_user_id}" >/dev/null
"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "UPDATE \"User\" SET \"vaultNeedsRecovery\" = true WHERE id = '${vault_recovery_user_id}';" \
  >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${temp_vault_access_token}" \
  "${api_base}/vault/recovery-status" \
  | jq -e '.needsRecovery == true and .hasRecoveryKey == true' >/dev/null

temp_recovery_key_2="$(
  curl --silent --show-error --fail \
    --cacert "${ca_cert}" \
    -H "authorization: Bearer ${temp_vault_access_token}" \
    -H 'content-type: application/json' \
    -d "{\"recoveryKey\":\"${temp_recovery_key}\",\"password\":\"${vault_temp_rotated_password}\"}" \
    "${api_base}/vault/recover-with-key" \
    | jq -r '.newRecoveryKey'
)"
[[ -n "${temp_recovery_key_2}" && "${temp_recovery_key_2}" != "null" ]]

"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -Atqc \
  "SELECT COALESCE(\"vaultNeedsRecovery\", false)::text FROM \"User\" WHERE id = '${vault_recovery_user_id}'" \
  | grep -qx 'false'

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${temp_vault_access_token}" \
  -H 'content-type: application/json' \
  -d "{\"password\":\"${vault_temp_rotated_password}\",\"confirmReset\":true}" \
  "${api_base}/vault/explicit-reset" \
  | jq -e '.success == true and (.newRecoveryKey | length > 10)' >/dev/null

"${container_runtime}" exec "${redis_container}" redis-cli EXISTS "vault:user:${vault_recovery_user_id}" | grep -qx '0'
"${container_runtime}" exec "${redis_container}" redis-cli EXISTS "vault:recovery:${vault_recovery_user_id}" | grep -qx '0'

"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -Atqc \
  "SELECT COALESCE(\"vaultNeedsRecovery\", false)::text || '|' || COALESCE(length(\"vaultSalt\"),0)::text || '|' || COALESCE(length(\"encryptedVaultKey\"),0)::text || '|' || COALESCE(length(\"encryptedVaultRecoveryKey\"),0)::text FROM \"User\" WHERE id = '${vault_recovery_user_id}'" \
  | grep -E '^false\|[1-9][0-9]*\|[1-9][0-9]*\|[1-9][0-9]*$' >/dev/null

echo '2.1.5 /api/user/avatar'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X POST \
  -d '{"avatarData":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0XcAAAAASUVORK5CYII="}' \
  "${api_base}/user/avatar" \
  | jq -e '.avatarData | startswith("data:image/png;base64,")' >/dev/null

echo '2.1.6 /api/user/notification-schedule update'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d '{"dndEnabled":true,"quietHoursStart":"22:00","quietHoursEnd":"06:00","quietHoursTimezone":"Europe/Rome"}' \
  "${api_base}/user/notification-schedule" \
  | jq -e '.dndEnabled == true and .quietHoursStart == "22:00" and .quietHoursEnd == "06:00" and .quietHoursTimezone == "Europe/Rome"' >/dev/null

echo '2.1.7 /api/user/notification-schedule readback'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/user/notification-schedule" \
  | jq -e '.dndEnabled == true and .quietHoursStart == "22:00" and .quietHoursEnd == "06:00" and .quietHoursTimezone == "Europe/Rome"' >/dev/null

echo '2.1.8 /api/user/domain-profile'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/user/domain-profile" \
  | jq -e '.hasDomainPassword == false' >/dev/null

echo '2.1.8.1 /api/user/domain-profile update'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d '{"domainName":"ACME","domainUsername":"admin"}' \
  "${api_base}/user/domain-profile" \
  | jq -e '.domainName == "ACME" and .domainUsername == "admin" and .hasDomainPassword == false' >/dev/null

echo '2.1.9 /api/user/domain-profile clear'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -X DELETE \
  "${api_base}/user/domain-profile" \
  | jq -e '.success == true' >/dev/null

echo '2.1.10 /api/user/domain-profile readback'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/user/domain-profile" \
  | jq -e '.domainName == null and .domainUsername == null and .hasDomainPassword == false' >/dev/null

echo '2.1.11 /api/user/search'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/user/search?q=no-match-acceptance&scope=tenant" \
  | jq -e 'type == "array" and length == 0' >/dev/null

echo '2.1.11.1 /api/tenants/mine and /api/tenants/mine/all'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/tenants/mine" \
  | jq -e --arg tenant_id "${tenant_id}" '.id == $tenant_id and (.name | type == "string") and (.teamCount | type == "number")' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/tenants/mine/all" \
  | jq -e --arg tenant_id "${tenant_id}" 'type == "array" and ((map(select(.tenantId == $tenant_id)) | length) >= 1)' >/dev/null

echo '2.1.11.1.0 /api/tenants create + /api/auth/switch-tenant'
original_tenant_id="${tenant_id}"
switch_tenant_temp_name="Acceptance Switch Tenant $(date +%s)"
switch_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d "{\"name\":\"${switch_tenant_temp_name}\"}" \
  "${api_base}/tenants")"
switch_tenant_temp_id="$(printf '%s' "${switch_json}" | jq -r '.tenant.id')"
access_token="$(printf '%s' "${switch_json}" | jq -r '.accessToken')"
tenant_id="$(printf '%s' "${switch_json}" | jq -r '.user.tenantId')"
printf '%s' "${access_token}" > "${token_file}"
printf '%s' "${tenant_id}" > "${tenant_file}"
[[ "${tenant_id}" == "${switch_tenant_temp_id}" ]]
printf '%s' "${switch_json}" | jq -e --arg tenant_id "${switch_tenant_temp_id}" --arg name "${switch_tenant_temp_name}" '.tenant.id == $tenant_id and .tenant.name == $name and .user.tenantId == $tenant_id' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/tenants/mine" \
  | jq -e --arg tenant_id "${switch_tenant_temp_id}" --arg name "${switch_tenant_temp_name}" '.id == $tenant_id and .name == $name' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d '{"name":"Acceptance Switch Tenant Updated","defaultSessionTimeoutSeconds":4200}' \
  "${api_base}/tenants/${switch_tenant_temp_id}" \
  | jq -e --arg tenant_id "${switch_tenant_temp_id}" '.id == $tenant_id and .name == "Acceptance Switch Tenant Updated" and .defaultSessionTimeoutSeconds == 4200' >/dev/null

echo '2.1.11.1.0.1 /api/gateways/ssh-keypair and /api/secrets tenant-vault init/distribute'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/gateways/ssh-keypair" \
  | jq -e '.publicKey != null and .publicKey != "" and .fingerprint != null and .fingerprint != ""' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/secrets/tenant-vault/status" \
  | jq -e '.initialized == true and .hasAccess == true' >/dev/null

tenant_vault_init_status="$(curl --silent --show-error \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X POST \
  -d '{}' \
  -o /tmp/tenant-vault-init-response.json \
  -w '%{http_code}' \
  "${api_base}/secrets/tenant-vault/init")"
[[ "${tenant_vault_init_status}" == "400" ]]
jq -e '.error == "Tenant vault is already initialized"' /tmp/tenant-vault-init-response.json >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/secrets/tenant-vault/status" \
  | jq -e '.initialized == true and .hasAccess == true' >/dev/null

switch_tenant_temp_user_id="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
switch_tenant_temp_user_email="go-tenant-vault-${switch_tenant_temp_user_id}@example.com"
switch_tenant_temp_user_member_id="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "INSERT INTO \"User\" (id, email, enabled, \"createdAt\", \"updatedAt\") VALUES ('${switch_tenant_temp_user_id}', '${switch_tenant_temp_user_email}', true, NOW(), NOW()); INSERT INTO \"TenantMember\" (id, \"tenantId\", \"userId\", role, status, \"isActive\", \"joinedAt\", \"updatedAt\") VALUES ('${switch_tenant_temp_user_member_id}', '${switch_tenant_temp_id}', '${switch_tenant_temp_user_id}', 'MEMBER', 'ACCEPTED', true, NOW(), NOW());" \
  >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X POST \
  -d "{\"targetUserId\":\"${switch_tenant_temp_user_id}\"}" \
  "${api_base}/secrets/tenant-vault/distribute" \
  | jq -e '.distributed == false and .pending == true' >/dev/null

tenant_vault_pending_count="$("${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -Atqc \
  "SELECT COUNT(*) FROM \"PendingVaultKeyDistribution\" WHERE \"tenantId\" = '${switch_tenant_temp_id}' AND \"targetUserId\" = '${switch_tenant_temp_user_id}';")"
[[ "${tenant_vault_pending_count}" == "1" ]]

switch_back_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":\"${original_tenant_id}\"}" \
  "${api_base}/auth/switch-tenant")"
access_token="$(printf '%s' "${switch_back_json}" | jq -r '.accessToken')"
tenant_id="$(printf '%s' "${switch_back_json}" | jq -r '.user.tenantId')"
printf '%s' "${access_token}" > "${token_file}"
printf '%s' "${tenant_id}" > "${tenant_file}"
[[ "${tenant_id}" == "${original_tenant_id}" ]]

"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "DELETE FROM \"User\" WHERE id = '${switch_tenant_temp_user_id}'; DELETE FROM \"TenantMember\" WHERE \"tenantId\" = '${switch_tenant_temp_id}'; DELETE FROM \"Tenant\" WHERE id = '${switch_tenant_temp_id}';" \
  >/dev/null
switch_tenant_temp_id=""
switch_tenant_temp_user_id=""

echo '2.1.11.1.1 /api/tenants/{id}/mfa-stats users profile'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/tenants/${tenant_id}/mfa-stats" \
  | jq -e '.total >= 1 and .withoutMfa >= 0' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/tenants/${tenant_id}/users" \
  | jq -e --arg user_id "${user_id}" 'type == "array" and ((map(select(.id == $user_id and .email == "admin@example.com")) | length) >= 1)' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/tenants/${tenant_id}/users/${user_id}/profile" \
  | jq -e --arg user_id "${user_id}" '.id == $user_id and (.teams | type == "array") and .email == "admin@example.com"' >/dev/null

echo '2.1.11.1.2 /api/tenants/{id}/ip-allowlist'
tenant_ip_allowlist_original_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/tenants/${tenant_id}/ip-allowlist")"
printf '%s' "${tenant_ip_allowlist_original_json}" | jq -e 'has("enabled") and has("mode") and has("entries")' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d '{"enabled":true,"mode":"flag","entries":["127.0.0.1/32","10.0.0.0/8"]}' \
  "${api_base}/tenants/${tenant_id}/ip-allowlist" \
  | jq -e '.enabled == true and .mode == "flag" and .entries == ["127.0.0.1/32","10.0.0.0/8"]' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/tenants/${tenant_id}/ip-allowlist" \
  | jq -e '.enabled == true and .mode == "flag" and .entries == ["127.0.0.1/32","10.0.0.0/8"]' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d "${tenant_ip_allowlist_original_json}" \
  "${api_base}/tenants/${tenant_id}/ip-allowlist" >/dev/null
tenant_ip_allowlist_original_json=""

echo '2.1.11.2 /api/teams list/get/members'
team_name="Go Acceptance Team $(date +%s)"
team_updated_name="${team_name} Updated"
team_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d "{\"name\":\"${team_name}\",\"description\":\"Go-native team read validation\"}" \
  "${api_base}/teams")"
team_id="$(printf '%s' "${team_json}" | jq -r '.id')"
[[ -n "${team_id}" && "${team_id}" != "null" ]]
printf '%s' "${team_json}" | jq -e --arg id "${team_id}" --arg name "${team_name}" '.id == $id and .name == $name' >/dev/null
printf '%s' "${team_json}" | jq -e --arg id "${team_id}" '.id == $id and .myRole == "TEAM_ADMIN" and (.memberCount | type == "number")' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/teams" \
  | jq -e --arg id "${team_id}" 'type == "array" and ((map(select(.id == $id)) | length) == 1)' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/teams/${team_id}" \
  | jq -e --arg id "${team_id}" '.id == $id and .myRole == "TEAM_ADMIN" and (.memberCount | type == "number")' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/teams/${team_id}/members" \
  | jq -e --arg user_id "${user_id}" 'type == "array" and ((map(select(.userId == $user_id and .role == "TEAM_ADMIN")) | length) == 1)' >/dev/null

echo '2.1.11.2.1 /api/teams update/member role/expiry/remove/delete'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d "{\"name\":\"${team_updated_name}\",\"description\":\"Go-native team write validation\"}" \
  "${api_base}/teams/${team_id}" \
  | jq -e --arg id "${team_id}" --arg name "${team_updated_name}" '.id == $id and .name == $name and .description == "Go-native team write validation"' >/dev/null

temp_team_member_user_id="$(
  python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
temp_team_member_email="go-team-member-${temp_team_member_user_id}@example.com"
temp_team_member_expiry="$(
  python3 - <<'PY'
from datetime import datetime, timedelta, timezone
print((datetime.now(timezone.utc) + timedelta(days=7)).replace(microsecond=0).isoformat().replace("+00:00", "Z"))
PY
)"
temp_team_member_vault_payload="$(
  node - "${server_encryption_key}" <<'NODE'
const crypto = require('crypto');
const key = Buffer.from(process.argv[2], 'hex');
const masterKeyHex = crypto.randomBytes(32).toString('hex');
const iv = crypto.randomBytes(16);
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
let ciphertext = cipher.update(masterKeyHex, 'utf8', 'hex');
ciphertext += cipher.final('hex');
const tag = cipher.getAuthTag().toString('hex');
process.stdout.write(JSON.stringify({ ciphertext, iv: iv.toString('hex'), tag }));
NODE
)"

"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "INSERT INTO \"User\" (id, email, enabled, \"createdAt\", \"updatedAt\") VALUES ('${temp_team_member_user_id}', '${temp_team_member_email}', true, NOW(), NOW()); INSERT INTO \"TenantMember\" (id, \"tenantId\", \"userId\", role, status, \"isActive\", \"joinedAt\", \"updatedAt\") VALUES ('$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)', '${tenant_id}', '${temp_team_member_user_id}', 'MEMBER', 'ACCEPTED', true, NOW(), NOW());" \
  >/dev/null

printf '%s' "${temp_team_member_vault_payload}" | "${container_runtime}" exec -i "${redis_container}" redis-cli -x SET "vault:user:${temp_team_member_user_id}" >/dev/null
"${container_runtime}" exec "${redis_container}" redis-cli EXPIRE "vault:user:${temp_team_member_user_id}" 1800 >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d '{"userId":"'"${temp_team_member_user_id}"'","role":"TEAM_EDITOR"}' \
  "${api_base}/teams/${team_id}/members" \
  | jq -e --arg user_id "${temp_team_member_user_id}" '.userId == $user_id and .role == "TEAM_EDITOR"' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PATCH \
  -d '{"expiresAt":"'"${temp_team_member_expiry}"'"}' \
  "${api_base}/teams/${team_id}/members/${temp_team_member_user_id}/expiry" \
  | jq -e --arg user_id "${temp_team_member_user_id}" --arg expiry "${temp_team_member_expiry}" '.userId == $user_id and .expiresAt == $expiry' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/teams/${team_id}/members" \
  | jq -e --arg user_id "${temp_team_member_user_id}" --arg email "${temp_team_member_email}" 'type == "array" and ((map(select(.userId == $user_id and .email == $email and .role == "TEAM_EDITOR" and .expiresAt != null)) | length) == 1)' >/dev/null

echo '2.1.11.2.1.1 /api/tenants/{id}/users/{userId}/permissions'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/tenants/${tenant_id}/users/${temp_team_member_user_id}/permissions" \
  | jq -e '.role == "MEMBER" and .permissions.canManageUsers == false and .defaults.canManageUsers == false and (.overrides == null or (.overrides | type == "object"))' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d '{"overrides":{"canManageConnections":false,"canViewAuditLog":true}}' \
  "${api_base}/tenants/${tenant_id}/users/${temp_team_member_user_id}/permissions" \
  | jq -e '.role == "MEMBER" and .permissions.canManageConnections == false and .permissions.canViewAuditLog == true and .overrides.canManageConnections == false and .overrides.canViewAuditLog == true' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/tenants/${tenant_id}/users/${temp_team_member_user_id}/permissions" \
  | jq -e '.permissions.canManageConnections == false and .permissions.canViewAuditLog == true and .overrides.canManageConnections == false and .overrides.canViewAuditLog == true' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -X DELETE \
  "${api_base}/teams/${team_id}/members/${temp_team_member_user_id}" \
  | jq -e '.removed == true' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/teams/${team_id}/members" \
  | jq -e --arg user_id "${temp_team_member_user_id}" 'type == "array" and ((map(select(.userId == $user_id)) | length) == 0)' >/dev/null

"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "DELETE FROM \"User\" WHERE id = '${temp_team_member_user_id}';" \
  >/dev/null
temp_team_member_user_id=""

echo '2.1.11.2.1.2 /api/tenants/{id}/users/{userId} role enabled expiry remove'
tenant_invite_seed_id="$(
  python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
tenant_invite_email="go-tenant-invite-${tenant_invite_seed_id}@example.com"
tenant_invite_user_id="$(
  python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
tenant_invite_username="tenant-invite-user"

"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "INSERT INTO \"User\" (id, email, username, enabled, \"emailVerified\", \"createdAt\", \"updatedAt\") VALUES ('${tenant_invite_user_id}', '${tenant_invite_email}', '${tenant_invite_username}', true, true, NOW(), NOW());" \
  >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${tenant_invite_email}\",\"role\":\"AUDITOR\"}" \
  "${api_base}/tenants/${tenant_id}/invite" \
  | jq -e --arg user_id "${tenant_invite_user_id}" --arg email "${tenant_invite_email}" '.userId == $user_id and .email == $email and .role == "AUDITOR" and .status == "PENDING"' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/tenants/${tenant_id}/users" \
  | jq -e --arg user_id "${tenant_invite_user_id}" 'type == "array" and ((map(select(.id == $user_id and .pending == true and .role == "AUDITOR")) | length) == 1)' >/dev/null

"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "DELETE FROM \"TenantMember\" WHERE \"tenantId\" = '${tenant_id}' AND \"userId\" = '${tenant_invite_user_id}'; DELETE FROM \"User\" WHERE id = '${tenant_invite_user_id}';" \
  >/dev/null
tenant_invite_user_id=""

tenant_manage_seed_id="$(
  python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
tenant_manage_email="go-tenant-manage-${tenant_manage_seed_id}@example.com"
tenant_manage_expiry="$(
  python3 - <<'PY'
from datetime import datetime, timedelta, timezone
print((datetime.now(timezone.utc) + timedelta(days=14)).replace(microsecond=0).isoformat().replace("+00:00", "Z"))
PY
)"

tenant_manage_create_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${tenant_manage_email}\",\"username\":\"tenant-manage-user\",\"password\":\"VaultTemp91Qx!\",\"role\":\"MEMBER\",\"sendWelcomeEmail\":false}" \
  "${api_base}/tenants/${tenant_id}/users")"
tenant_manage_user_id="$(printf '%s' "${tenant_manage_create_json}" | jq -r '.user.id')"
[[ -n "${tenant_manage_user_id}" && "${tenant_manage_user_id}" != "null" ]]
printf '%s' "${tenant_manage_create_json}" | jq -e --arg user_id "${tenant_manage_user_id}" --arg email "${tenant_manage_email}" '.user.id == $user_id and .user.email == $email and .user.role == "MEMBER" and (.recoveryKey | length > 10)' >/dev/null

"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "UPDATE \"TenantMember\" SET \"isActive\" = true, \"updatedAt\" = NOW() WHERE \"tenantId\" = '${tenant_id}' AND \"userId\" = '${tenant_manage_user_id}';" \
  >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d '{"role":"CONSULTANT"}' \
  "${api_base}/tenants/${tenant_id}/users/${tenant_manage_user_id}" \
  | jq -e --arg user_id "${tenant_manage_user_id}" '.id == $user_id and .role == "CONSULTANT"' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PATCH \
  -d '{"enabled":false}' \
  "${api_base}/tenants/${tenant_id}/users/${tenant_manage_user_id}/enabled" \
  | jq -e --arg user_id "${tenant_manage_user_id}" '.id == $user_id and .enabled == false and .role == "CONSULTANT"' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PATCH \
  -d '{"enabled":true}' \
  "${api_base}/tenants/${tenant_id}/users/${tenant_manage_user_id}/enabled" \
  | jq -e --arg user_id "${tenant_manage_user_id}" '.id == $user_id and .enabled == true and .role == "CONSULTANT"' >/dev/null

tenant_admin_verification_email_id="$(
  curl --silent --show-error --fail \
    --cacert "${ca_cert}" \
    -H "authorization: Bearer ${access_token}" \
    -H 'content-type: application/json' \
    -d '{"purpose":"admin-action"}' \
    "${api_base}/user/identity/initiate" \
    | jq -r '.verificationId'
)"
[[ -n "${tenant_admin_verification_email_id}" && "${tenant_admin_verification_email_id}" != "null" ]]

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d '{"verificationId":"'"${tenant_admin_verification_email_id}"'","password":"'"${admin_password}"'"}' \
  "${api_base}/user/identity/confirm" \
  | jq -e '.confirmed == true' >/dev/null

tenant_manage_new_email="tenant-manage-updated-${tenant_manage_user_id}@example.com"
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d '{"newEmail":"'"${tenant_manage_new_email}"'","verificationId":"'"${tenant_admin_verification_email_id}"'"}' \
  "${api_base}/tenants/${tenant_id}/users/${tenant_manage_user_id}/email" \
  | jq -e --arg user_id "${tenant_manage_user_id}" --arg email "${tenant_manage_new_email}" '.id == $user_id and .email == $email' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/tenants/${tenant_id}/users" \
  | jq -e --arg user_id "${tenant_manage_user_id}" --arg email "${tenant_manage_new_email}" 'type == "array" and ((map(select(.id == $user_id and .email == $email)) | length) == 1)' >/dev/null

tenant_manage_temp_cookie="$(mktemp)"
tenant_manage_temp_headers="$(mktemp)"
tenant_manage_login_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -c "${tenant_manage_temp_cookie}" \
  -D "${tenant_manage_temp_headers}" \
  -H 'content-type: application/json' \
  -d '{"email":"'"${tenant_manage_new_email}"'","password":"VaultTemp91Qx!"}' \
  "${api_base}/auth/login")"
printf '%s' "${tenant_manage_login_json}" | jq -e --arg email "${tenant_manage_new_email}" '(.accessToken | length > 20) and .user.email == $email' >/dev/null
rm -f "${tenant_manage_temp_cookie}" "${tenant_manage_temp_headers}"

tenant_admin_verification_password_id="$(
  curl --silent --show-error --fail \
    --cacert "${ca_cert}" \
    -H "authorization: Bearer ${access_token}" \
    -H 'content-type: application/json' \
    -d '{"purpose":"admin-action"}' \
    "${api_base}/user/identity/initiate" \
    | jq -r '.verificationId'
)"
[[ -n "${tenant_admin_verification_password_id}" && "${tenant_admin_verification_password_id}" != "null" ]]

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d '{"verificationId":"'"${tenant_admin_verification_password_id}"'","password":"'"${admin_password}"'"}' \
  "${api_base}/user/identity/confirm" \
  | jq -e '.confirmed == true' >/dev/null

tenant_manage_new_password="VaultReset92Qx!"
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d '{"newPassword":"'"${tenant_manage_new_password}"'","verificationId":"'"${tenant_admin_verification_password_id}"'"}' \
  "${api_base}/tenants/${tenant_id}/users/${tenant_manage_user_id}/password" \
  | jq -e '.recoveryKey | length > 10' >/dev/null

clear_login_rate_limits

tenant_manage_old_password_login_status="$(
  curl --silent --output /tmp/arsenale-tenant-manage-login-old-password.json --write-out '%{http_code}' \
    --cacert "${ca_cert}" \
    -H 'content-type: application/json' \
    -d '{"email":"'"${tenant_manage_new_email}"'","password":"VaultTemp91Qx!"}' \
    "${api_base}/auth/login"
)"
[[ "${tenant_manage_old_password_login_status}" == "401" || "${tenant_manage_old_password_login_status}" == "403" ]]

clear_login_rate_limits

tenant_manage_reset_cookie="$(mktemp)"
tenant_manage_reset_headers="$(mktemp)"
tenant_manage_reset_login_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -c "${tenant_manage_reset_cookie}" \
  -D "${tenant_manage_reset_headers}" \
  -H 'content-type: application/json' \
  -d '{"email":"'"${tenant_manage_new_email}"'","password":"'"${tenant_manage_new_password}"'"}' \
  "${api_base}/auth/login")"
printf '%s' "${tenant_manage_reset_login_json}" | jq -e --arg email "${tenant_manage_new_email}" '(.accessToken | length > 20) and .user.email == $email' >/dev/null
rm -f "${tenant_manage_reset_cookie}" "${tenant_manage_reset_headers}"

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PATCH \
  -d '{"expiresAt":"'"${tenant_manage_expiry}"'"}' \
  "${api_base}/tenants/${tenant_id}/users/${tenant_manage_user_id}/expiry" \
  | jq -e --arg user_id "${tenant_manage_user_id}" --arg expiry "${tenant_manage_expiry}" '.userId == $user_id and .expiresAt == $expiry' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -X DELETE \
  "${api_base}/tenants/${tenant_id}/users/${tenant_manage_user_id}" \
  | jq -e '.removed == true' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/tenants/${tenant_id}/users" \
  | jq -e --arg user_id "${tenant_manage_user_id}" 'type == "array" and ((map(select(.id == $user_id)) | length) == 0)' >/dev/null

tenant_manage_user_id=""

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -X DELETE \
  "${api_base}/teams/${team_id}" \
  | jq -e '.deleted == true' >/dev/null
team_id=""

echo '2.1.11.2.2 /api/checkouts create/list/get/approve/checkin/reject'
checkout_target_user_id="$(
  python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
checkout_target_secret_id="$(
  python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
checkout_target_email="checkout-target-$(date +%s)@example.com"
checkout_target_secret_name="Go Native Checkout Secret $(date +%s)"
"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "INSERT INTO \"User\" (id, email, \"createdAt\", \"updatedAt\") VALUES ('${checkout_target_user_id}', '${checkout_target_email}', NOW(), NOW()); INSERT INTO \"VaultSecret\" (id, name, type, scope, \"userId\", \"tenantId\", \"encryptedData\", \"dataIV\", \"dataTag\", \"createdAt\", \"updatedAt\") VALUES ('${checkout_target_secret_id}', '${checkout_target_secret_name}', 'LOGIN', 'TENANT', '${checkout_target_user_id}', '${tenant_id}', 'enc', 'iv', 'tag', NOW(), NOW());" \
  >/dev/null

checkout_request_id="$(
  curl --silent --show-error --fail \
    --cacert "${ca_cert}" \
    -H "authorization: Bearer ${access_token}" \
    -H 'content-type: application/json' \
    -X POST \
    -d '{"secretId":"'"${checkout_target_secret_id}"'","durationMinutes":30,"reason":"Go-native checkout create validation"}' \
    "${api_base}/checkouts" \
    | tee /tmp/arsenale-checkout-create.json \
    | jq -r '.id'
)"
[[ -n "${checkout_request_id}" && "${checkout_request_id}" != "null" ]]
jq -e --arg id "${checkout_request_id}" --arg secret_id "${checkout_target_secret_id}" --arg secret_name "${checkout_target_secret_name}" '.id == $id and .secretId == $secret_id and .status == "PENDING" and .durationMinutes == 30 and .reason == "Go-native checkout create validation" and .secretName == $secret_name' /tmp/arsenale-checkout-create.json >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/checkouts?role=requester&status=PENDING&limit=100&offset=0" \
  | jq -e --arg id "${checkout_request_id}" '.total >= 1 and ((.data | map(select(.id == $id and .status == "PENDING" and .durationMinutes == 30)) | length) == 1)' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/checkouts/${checkout_request_id}" \
  | jq -e --arg id "${checkout_request_id}" --arg secret_name "${checkout_target_secret_name}" '.id == $id and .requesterId != null and .status == "PENDING" and .reason == "Go-native checkout create validation" and .secretName == $secret_name' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X POST \
  -d '{}' \
  "${api_base}/checkouts/${checkout_request_id}/approve" \
  | jq -e --arg approver_id "${user_id}" '.status == "APPROVED" and .approverId == $approver_id and .expiresAt != null' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X POST \
  -d '{}' \
  "${api_base}/checkouts/${checkout_request_id}/checkin" \
  | jq -e '.status == "CHECKED_IN"' >/dev/null

checkout_request_secondary_id="$(
  curl --silent --show-error --fail \
    --cacert "${ca_cert}" \
    -H "authorization: Bearer ${access_token}" \
    -H 'content-type: application/json' \
    -X POST \
    -d '{"secretId":"'"${checkout_target_secret_id}"'","durationMinutes":15,"reason":"Go-native checkout reject validation"}' \
    "${api_base}/checkouts" \
    | tee /tmp/arsenale-checkout-create-secondary.json \
    | jq -r '.id'
)"
[[ -n "${checkout_request_secondary_id}" && "${checkout_request_secondary_id}" != "null" ]]
jq -e --arg id "${checkout_request_secondary_id}" '.id == $id and .status == "PENDING" and .durationMinutes == 15 and .reason == "Go-native checkout reject validation"' /tmp/arsenale-checkout-create-secondary.json >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X POST \
  -d '{}' \
  "${api_base}/checkouts/${checkout_request_secondary_id}/reject" \
  | jq -e --arg approver_id "${user_id}" '.status == "REJECTED" and .approverId == $approver_id' >/dev/null

"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "DELETE FROM \"Notification\" WHERE \"relatedId\" IN ('${checkout_request_id}', '${checkout_request_secondary_id}'); DELETE FROM \"SecretCheckoutRequest\" WHERE id IN ('${checkout_request_id}', '${checkout_request_secondary_id}'); DELETE FROM \"VaultSecret\" WHERE id = '${checkout_target_secret_id}'; DELETE FROM \"User\" WHERE id = '${checkout_target_user_id}';" \
  >/dev/null
checkout_request_id=""
checkout_request_secondary_id=""
checkout_target_secret_id=""
checkout_target_user_id=""

echo '2.1.11.3 /api/folders create/list/update/delete'
folder_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d '{"name":"Go Acceptance Folder"}' \
  "${api_base}/folders")"
folder_id="$(printf '%s' "${folder_json}" | jq -r '.id')"
[[ -n "${folder_id}" && "${folder_id}" != "null" ]]

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/folders" \
  | jq -e --arg id "${folder_id}" '.personal | map(select(.id == $id)) | length == 1' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d '{"name":"Go Acceptance Folder Updated"}' \
  "${api_base}/folders/${folder_id}" \
  | jq -e --arg id "${folder_id}" '.id == $id and .name == "Go Acceptance Folder Updated"' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -X DELETE \
  "${api_base}/folders/${folder_id}" \
  | jq -e '.deleted == true' >/dev/null

echo '2.1.11.3.0 /api/vault-folders create/list/update/delete'
vault_folder_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d '{"name":"Go Acceptance Vault Folder","scope":"PERSONAL"}' \
  "${api_base}/vault-folders")"
vault_folder_id="$(printf '%s' "${vault_folder_json}" | jq -r '.id')"
[[ -n "${vault_folder_id}" && "${vault_folder_id}" != "null" ]]
printf '%s' "${vault_folder_json}" | jq -e --arg id "${vault_folder_id}" '.id == $id and .name == "Go Acceptance Vault Folder" and .scope == "PERSONAL"' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/vault-folders" \
  | jq -e --arg id "${vault_folder_id}" '.personal | map(select(.id == $id and .scope == "PERSONAL")) | length == 1' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d '{"name":"Go Acceptance Vault Folder Updated"}' \
  "${api_base}/vault-folders/${vault_folder_id}" \
  | jq -e --arg id "${vault_folder_id}" '.id == $id and .name == "Go Acceptance Vault Folder Updated" and .scope == "PERSONAL"' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -X DELETE \
  "${api_base}/vault-folders/${vault_folder_id}" \
  | jq -e '.deleted == true' >/dev/null

echo '2.1.11.3.1 /api/files upload/list/download/delete'
uploaded_file_name="acceptance-file-$(date +%s).txt"
uploaded_file_local="$(mktemp)"
uploaded_file_downloaded="$(mktemp)"
printf 'acceptance file payload %s\n' "$(date +%s)" > "${uploaded_file_local}"

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -X POST \
  -F "file=@${uploaded_file_local};filename=${uploaded_file_name}" \
  "${api_base}/files" \
  | jq -e --arg name "${uploaded_file_name}" 'type == "array" and ((map(select(.name == $name)) | length) == 1)' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/files" \
  | jq -e --arg name "${uploaded_file_name}" 'type == "array" and ((map(select(.name == $name)) | length) == 1)' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  --output "${uploaded_file_downloaded}" \
  "${api_base}/files/${uploaded_file_name}"

cmp -s "${uploaded_file_local}" "${uploaded_file_downloaded}"

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -X DELETE \
  "${api_base}/files/${uploaded_file_name}" \
  | jq -e '.deleted == true' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/files" \
  | jq -e --arg name "${uploaded_file_name}" 'type == "array" and ((map(select(.name == $name)) | length) == 0)' >/dev/null

rm -f "${uploaded_file_local}" "${uploaded_file_downloaded}"
uploaded_file_local=""
uploaded_file_downloaded=""
uploaded_file_name=""

echo '2.1.11.4 /api/admin email/app-config/auth-providers'
admin_email_status_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/admin/email/status")"
printf '%s' "${admin_email_status_json}" | jq -e '.provider | type == "string"' >/dev/null
printf '%s' "${admin_email_status_json}" | jq -e '.configured | type == "boolean"' >/dev/null
printf '%s' "${admin_email_status_json}" | jq -e '.from | type == "string"' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X POST \
  -d "{\"to\":\"${admin_email}\"}" \
  "${api_base}/admin/email/test" \
  | jq -e '.success == true and (.message | type == "string")' >/dev/null

admin_app_config_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/admin/app-config")"
printf '%s' "${admin_app_config_json}" | jq -e '.selfSignupEnabled | type == "boolean"' >/dev/null
printf '%s' "${admin_app_config_json}" | jq -e '.selfSignupEnvLocked | type == "boolean"' >/dev/null

echo '2.1.11.4.0 /api/auth/register'
original_self_signup_enabled="$(printf '%s' "${admin_app_config_json}" | jq -r '.selfSignupEnabled')"
self_signup_env_locked="$(printf '%s' "${admin_app_config_json}" | jq -r '.selfSignupEnvLocked')"
if [[ "${self_signup_env_locked}" != "true" ]]; then
  if [[ "${original_self_signup_enabled}" != "true" ]]; then
    curl --silent --show-error --fail \
      --cacert "${ca_cert}" \
      -H "authorization: Bearer ${access_token}" \
      -H 'content-type: application/json' \
      -X PUT \
      -d '{"enabled":true}' \
      "${api_base}/admin/app-config/self-signup" \
      | jq -e '.selfSignupEnabled == true and .selfSignupEnvLocked == false' >/dev/null
  fi

  registered_temp_user_email="go-register-$(date +%s)-$$@example.com"
  registered_temp_password="GoReg!$(date +%s)Aa9"
  register_json="$(curl --silent --show-error --fail \
    --cacert "${ca_cert}" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"${registered_temp_user_email}\",\"password\":\"${registered_temp_password}\"}" \
    "${api_base}/auth/register")"
  printf '%s' "${register_json}" | jq -e '.message | type == "string"' >/dev/null
  printf '%s' "${register_json}" | jq -e '.emailVerifyRequired == false and (.recoveryKey | type == "string") and (.recoveryKey | length > 20)' >/dev/null

  registered_temp_user_id="$("${container_runtime}" exec \
    -e PGPASSWORD="${postgres_password}" \
    arsenale-postgres \
    psql -U "${db_user}" -d "${db_name}" -Atqc \
    "SELECT id FROM \"User\" WHERE email = '${registered_temp_user_email}' LIMIT 1;")"
  [[ -n "${registered_temp_user_id}" && "${registered_temp_user_id}" != "null" ]]

  clear_login_rate_limits
  register_login_json="$(curl --silent --show-error --fail \
    --cacert "${ca_cert}" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"${registered_temp_user_email}\",\"password\":\"${registered_temp_password}\"}" \
    "${api_base}/auth/login")"
  printf '%s' "${register_login_json}" | jq -e --arg email "${registered_temp_user_email}" '.accessToken and .user.email == $email' >/dev/null

  "${container_runtime}" exec \
    -e PGPASSWORD="${postgres_password}" \
    arsenale-postgres \
    psql -U "${db_user}" -d "${db_name}" -c \
    "DELETE FROM \"RefreshToken\" WHERE \"userId\" = '${registered_temp_user_id}'; DELETE FROM \"TenantMember\" WHERE \"userId\" = '${registered_temp_user_id}'; DELETE FROM \"User\" WHERE id = '${registered_temp_user_id}';" \
    >/dev/null
  registered_temp_user_id=""
  registered_temp_user_email=""

  if [[ "${original_self_signup_enabled}" != "true" ]]; then
    curl --silent --show-error --fail \
      --cacert "${ca_cert}" \
      -H "authorization: Bearer ${access_token}" \
      -H 'content-type: application/json' \
      -X PUT \
      -d '{"enabled":false}' \
      "${api_base}/admin/app-config/self-signup" \
      | jq -e '.selfSignupEnabled == false and .selfSignupEnvLocked == false' >/dev/null
  fi
fi
original_self_signup_enabled=""

echo '2.1.11.4.1 /api/auth/verify-email'
verify_email_temp_user_id="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
verify_email_temp_token="$(python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
)"
verify_email_temp_email="go-verify-${verify_email_temp_user_id}@example.com"
"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "INSERT INTO \"User\" (id, email, enabled, \"emailVerified\", \"emailVerifyToken\", \"emailVerifyExpiry\", \"createdAt\", \"updatedAt\") VALUES ('${verify_email_temp_user_id}', '${verify_email_temp_email}', true, false, '${verify_email_temp_token}', NOW() + INTERVAL '24 hours', NOW(), NOW());" \
  >/dev/null

verify_email_redirect="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}|%{redirect_url}' \
  --cacert "${ca_cert}" \
  "${api_base}/auth/verify-email?token=${verify_email_temp_token}")"
verify_email_status="${verify_email_redirect%%|*}"
verify_email_location="${verify_email_redirect#*|}"
[[ "${verify_email_status}" == "302" ]]
if [[ -n "${client_base}" ]]; then
  [[ "${verify_email_location}" == "${client_base%/}/login?verified=true" ]]
else
  [[ "${verify_email_location}" == */login?verified=true ]]
fi

"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -Atqc \
  "SELECT COALESCE(\"emailVerified\", false)::text || '|' || COALESCE(\"emailVerifyToken\", '') FROM \"User\" WHERE id = '${verify_email_temp_user_id}'" \
  | grep -qx 'true|'

echo '2.1.11.4.2 /api/auth/resend-verification'
resend_verification_temp_user_id="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
resend_verification_old_token="$(python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
)"
resend_verification_temp_email="go-resend-${resend_verification_temp_user_id}@example.com"
"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "INSERT INTO \"User\" (id, email, enabled, \"emailVerified\", \"emailVerifyToken\", \"emailVerifyExpiry\", \"createdAt\", \"updatedAt\") VALUES ('${resend_verification_temp_user_id}', '${resend_verification_temp_email}', true, false, '${resend_verification_old_token}', NOW() - INTERVAL '1 hour', NOW(), NOW());" \
  >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${resend_verification_temp_email}\"}" \
  "${api_base}/auth/resend-verification" \
  | jq -e '.message == "If an account exists with this email, a verification link has been sent."' >/dev/null

"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -Atqc \
  "SELECT COALESCE(\"emailVerifyToken\", '') <> '${resend_verification_old_token}'::text AND \"emailVerifyExpiry\" > NOW() FROM \"User\" WHERE id = '${resend_verification_temp_user_id}'" \
  | grep -qx 't'

echo '2.1.11.4.3 /api/auth/forgot-password'
forgot_password_temp_user_id="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
forgot_password_temp_email="go-forgot-${forgot_password_temp_user_id}@example.com"
"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "INSERT INTO \"User\" (id, email, enabled, \"passwordHash\", \"createdAt\", \"updatedAt\") SELECT '${forgot_password_temp_user_id}', '${forgot_password_temp_email}', true, \"passwordHash\", NOW(), NOW() FROM \"User\" WHERE email = '${admin_email}' LIMIT 1;" \
  >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${forgot_password_temp_email}\"}" \
  "${api_base}/auth/forgot-password" \
  | jq -e '.message == "If an account exists with this email, a password reset link has been sent."' >/dev/null

"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -Atqc \
  "SELECT (\"passwordResetTokenHash\" IS NOT NULL)::text || '|' || (\"passwordResetExpiry\" > NOW())::text FROM \"User\" WHERE id = '${forgot_password_temp_user_id}'" \
  | grep -qx 'true|true'

echo '2.1.11.4.4 /api/auth/reset-password/validate'
reset_validation_temp_user_id="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
reset_validation_token="$(python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
)"
reset_validation_hash="$(printf '%s' "${reset_validation_token}" | sha256sum | awk '{print $1}')"
reset_validation_temp_email="go-reset-validate-${reset_validation_temp_user_id}@example.com"
"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "INSERT INTO \"User\" (id, email, enabled, \"passwordHash\", \"passwordResetTokenHash\", \"passwordResetExpiry\", \"createdAt\", \"updatedAt\") SELECT '${reset_validation_temp_user_id}', '${reset_validation_temp_email}', true, \"passwordHash\", '${reset_validation_hash}', NOW() + INTERVAL '1 hour', NOW(), NOW() FROM \"User\" WHERE email = '${admin_email}' LIMIT 1;" \
  >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H 'content-type: application/json' \
  -d "{\"token\":\"${reset_validation_token}\"}" \
  "${api_base}/auth/reset-password/validate" \
  | jq -e '.valid == true and .requiresSmsVerification == false and .hasRecoveryKey == false' >/dev/null

echo '2.1.11.4.5 /api/auth/request-sms-code + /verify-sms'
sms_mfa_temp_user_id="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
sms_mfa_temp_email="go-sms-login-${sms_mfa_temp_user_id}@example.com"
sms_mfa_temp_member_id="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "INSERT INTO \"User\" (id, email, enabled, \"emailVerified\", \"passwordHash\", \"smsMfaEnabled\", \"phoneVerified\", \"phoneNumber\", \"createdAt\", \"updatedAt\") SELECT '${sms_mfa_temp_user_id}', '${sms_mfa_temp_email}', true, true, \"passwordHash\", true, true, '+15550001111', NOW(), NOW() FROM \"User\" WHERE email = '${admin_email}' LIMIT 1; INSERT INTO \"TenantMember\" (id, \"tenantId\", \"userId\", role, status, \"isActive\", \"joinedAt\", \"updatedAt\") VALUES ('${sms_mfa_temp_member_id}', '${tenant_id}', '${sms_mfa_temp_user_id}', 'MEMBER', 'ACCEPTED', true, NOW(), NOW());" \
  >/dev/null

clear_login_rate_limits
sms_login_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${sms_mfa_temp_email}\",\"password\":\"${admin_password}\"}" \
  "${api_base}/auth/login")"
printf '%s' "${sms_login_json}" | jq -e '.requiresMFA == true and (.methods | index("sms")) != null' >/dev/null
sms_login_temp_token="$(printf '%s' "${sms_login_json}" | jq -r '.tempToken')"
[[ -n "${sms_login_temp_token}" && "${sms_login_temp_token}" != "null" ]]

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H 'content-type: application/json' \
  -d "{\"tempToken\":\"${sms_login_temp_token}\"}" \
  "${api_base}/auth/request-sms-code" \
  | jq -e '.message == "SMS code sent"' >/dev/null

"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -Atqc \
  "SELECT (\"smsOtpHash\" IS NOT NULL)::text || '|' || (\"smsOtpExpiresAt\" > NOW())::text FROM \"User\" WHERE id = '${sms_mfa_temp_user_id}'" \
  | grep -qx 'true|true'

sms_verify_code="123456"
sms_verify_hash="$(printf '%s' "${sms_verify_code}" | sha256sum | awk '{print $1}')"
"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "UPDATE \"User\" SET \"smsOtpHash\" = '${sms_verify_hash}', \"smsOtpExpiresAt\" = NOW() + INTERVAL '5 minutes', \"updatedAt\" = NOW() WHERE id = '${sms_mfa_temp_user_id}';" \
  >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H 'content-type: application/json' \
  -d "{\"tempToken\":\"${sms_login_temp_token}\",\"code\":\"${sms_verify_code}\"}" \
  "${api_base}/auth/verify-sms" \
  | jq -e --arg email "${sms_mfa_temp_email}" '.accessToken and .user.email == $email' >/dev/null

echo '2.1.11.4.5.1 /api/auth/request-webauthn-options'
webauthn_login_temp_user_id="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
webauthn_login_temp_email="go-webauthn-login-${webauthn_login_temp_user_id}@example.com"
webauthn_login_temp_member_id="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
webauthn_login_temp_credential_id="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
webauthn_login_temp_credential_ref="$(python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(18))
PY
)"
"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "INSERT INTO \"User\" (id, email, enabled, \"emailVerified\", \"passwordHash\", \"webauthnEnabled\", \"createdAt\", \"updatedAt\") SELECT '${webauthn_login_temp_user_id}', '${webauthn_login_temp_email}', true, true, \"passwordHash\", true, NOW(), NOW() FROM \"User\" WHERE email = '${admin_email}' LIMIT 1;
   INSERT INTO \"TenantMember\" (id, \"tenantId\", \"userId\", role, status, \"isActive\", \"joinedAt\", \"updatedAt\") VALUES ('${webauthn_login_temp_member_id}', '${tenant_id}', '${webauthn_login_temp_user_id}', 'MEMBER', 'ACCEPTED', true, NOW(), NOW());
   INSERT INTO \"WebAuthnCredential\" (id, \"userId\", \"credentialId\", \"publicKey\", counter, transports, \"friendlyName\", \"createdAt\") VALUES ('${webauthn_login_temp_credential_id}', '${webauthn_login_temp_user_id}', '${webauthn_login_temp_credential_ref}', 'cHVibGljLWtleQ', 0, ARRAY['usb'], 'Go Login Key', NOW());" \
  >/dev/null

clear_login_rate_limits
webauthn_login_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${webauthn_login_temp_email}\",\"password\":\"${admin_password}\"}" \
  "${api_base}/auth/login")"
printf '%s' "${webauthn_login_json}" | jq -e '.requiresMFA == true and .requiresTOTP == false and (.methods | index("webauthn")) != null' >/dev/null
webauthn_login_temp_token="$(printf '%s' "${webauthn_login_json}" | jq -r '.tempToken')"
[[ -n "${webauthn_login_temp_token}" && "${webauthn_login_temp_token}" != "null" ]]

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H 'content-type: application/json' \
  -d "{\"tempToken\":\"${webauthn_login_temp_token}\"}" \
  "${api_base}/auth/request-webauthn-options" \
  | jq -e --arg ref "${webauthn_login_temp_credential_ref}" --arg expectedRpId "${expected_webauthn_rp_id}" '.challenge and ((($expectedRpId | length) == 0 and (.rpId | type == "string") and (.rpId | length > 0)) or .rpId == $expectedRpId) and .userVerification == "preferred" and ((.allowCredentials | map(select(.id == $ref)) | length) == 1)' >/dev/null

echo '2.1.11.4.6 /api/auth/mfa-setup/init + /verify'
mfa_setup_temp_tenant_id="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
mfa_setup_temp_user_id="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
mfa_setup_temp_email="go-mfa-setup-${mfa_setup_temp_user_id}@example.com"
mfa_setup_temp_member_id="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
mfa_setup_temp_slug="go-mfa-setup-${acceptance_suffix}"
"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "INSERT INTO \"Tenant\" (id, name, slug, \"mfaRequired\", \"createdAt\", \"updatedAt\") VALUES ('${mfa_setup_temp_tenant_id}', 'Go MFA Setup Tenant', '${mfa_setup_temp_slug}', true, NOW(), NOW());
   INSERT INTO \"User\" (id, email, enabled, \"emailVerified\", \"passwordHash\", \"vaultSalt\", \"encryptedVaultKey\", \"vaultKeyIV\", \"vaultKeyTag\", \"encryptedVaultRecoveryKey\", \"vaultRecoveryKeyIV\", \"vaultRecoveryKeyTag\", \"vaultRecoveryKeySalt\", \"vaultSetupComplete\", \"createdAt\", \"updatedAt\")
   SELECT '${mfa_setup_temp_user_id}', '${mfa_setup_temp_email}', true, true, \"passwordHash\", \"vaultSalt\", \"encryptedVaultKey\", \"vaultKeyIV\", \"vaultKeyTag\", \"encryptedVaultRecoveryKey\", \"vaultRecoveryKeyIV\", \"vaultRecoveryKeyTag\", \"vaultRecoveryKeySalt\", COALESCE(\"vaultSetupComplete\", true), NOW(), NOW() FROM \"User\" WHERE email = '${admin_email}' LIMIT 1;
   INSERT INTO \"TenantMember\" (id, \"tenantId\", \"userId\", role, status, \"isActive\", \"joinedAt\", \"updatedAt\") VALUES ('${mfa_setup_temp_member_id}', '${mfa_setup_temp_tenant_id}', '${mfa_setup_temp_user_id}', 'MEMBER', 'ACCEPTED', true, NOW(), NOW());" \
  >/dev/null

clear_login_rate_limits
mfa_setup_login_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${mfa_setup_temp_email}\",\"password\":\"${admin_password}\"}" \
  "${api_base}/auth/login")"
printf '%s' "${mfa_setup_login_json}" | jq -e '.mfaSetupRequired == true' >/dev/null
mfa_setup_temp_token="$(printf '%s' "${mfa_setup_login_json}" | jq -r '.tempToken')"
[[ -n "${mfa_setup_temp_token}" && "${mfa_setup_temp_token}" != "null" ]]

mfa_setup_init_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H 'content-type: application/json' \
  -d "{\"tempToken\":\"${mfa_setup_temp_token}\"}" \
  "${api_base}/auth/mfa-setup/init")"
mfa_setup_secret="$(printf '%s' "${mfa_setup_init_json}" | jq -r '.secret')"
[[ -n "${mfa_setup_secret}" && "${mfa_setup_secret}" != "null" ]]
printf '%s' "${mfa_setup_init_json}" | jq -e '.otpauthUri | startswith("otpauth://totp/")' >/dev/null

mfa_setup_code="$(
  python3 - "${mfa_setup_secret}" <<'PY'
import base64, hashlib, hmac, struct, sys, time
secret = sys.argv[1].strip().replace(" ", "").replace("-", "").upper()
padding = "=" * ((8 - len(secret) % 8) % 8)
key = base64.b32decode(secret + padding, casefold=True)
counter = int(time.time()) // 30
msg = struct.pack(">Q", counter)
digest = hmac.new(key, msg, hashlib.sha1).digest()
offset = digest[-1] & 0x0F
value = struct.unpack(">I", digest[offset:offset+4])[0] & 0x7FFFFFFF
print(f"{value % 1000000:06d}")
PY
)"

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H 'content-type: application/json' \
  -d "{\"tempToken\":\"${mfa_setup_temp_token}\",\"code\":\"${mfa_setup_code}\"}" \
  "${api_base}/auth/mfa-setup/verify" \
  | jq -e --arg email "${mfa_setup_temp_email}" '.accessToken and .user.email == $email' >/dev/null

"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -Atqc \
  "SELECT COALESCE(\"totpEnabled\", false)::text FROM \"User\" WHERE id = '${mfa_setup_temp_user_id}'" \
  | grep -qx 'true'

echo '2.1.11.4.7 /api/auth/reset-password/request-sms + /complete'
reset_sms_temp_user_id="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
reset_sms_temp_email="go-reset-sms-${reset_sms_temp_user_id}@example.com"
reset_sms_temp_member_id="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
reset_sms_token="$(python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
)"
reset_sms_hash="$(printf '%s' "${reset_sms_token}" | sha256sum | awk '{print $1}')"
"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "INSERT INTO \"User\" (id, email, enabled, \"emailVerified\", \"passwordHash\", \"smsMfaEnabled\", \"phoneVerified\", \"phoneNumber\", \"passwordResetTokenHash\", \"passwordResetExpiry\", \"createdAt\", \"updatedAt\") SELECT '${reset_sms_temp_user_id}', '${reset_sms_temp_email}', true, true, \"passwordHash\", true, true, '+15550002222', '${reset_sms_hash}', NOW() + INTERVAL '1 hour', NOW(), NOW() FROM \"User\" WHERE email = '${admin_email}' LIMIT 1; INSERT INTO \"TenantMember\" (id, \"tenantId\", \"userId\", role, status, \"isActive\", \"joinedAt\", \"updatedAt\") VALUES ('${reset_sms_temp_member_id}', '${tenant_id}', '${reset_sms_temp_user_id}', 'MEMBER', 'ACCEPTED', true, NOW(), NOW());" \
  >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H 'content-type: application/json' \
  -d "{\"token\":\"${reset_sms_token}\"}" \
  "${api_base}/auth/reset-password/request-sms" \
  | jq -e '.message == "SMS code sent"' >/dev/null

"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -Atqc \
  "SELECT (\"smsOtpHash\" IS NOT NULL)::text || '|' || (\"smsOtpExpiresAt\" > NOW())::text FROM \"User\" WHERE id = '${reset_sms_temp_user_id}'" \
  | grep -qx 'true|true'

reset_sms_code="123456"
reset_sms_code_hash="$(printf '%s' "${reset_sms_code}" | sha256sum | awk '{print $1}')"
"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "UPDATE \"User\" SET \"smsOtpHash\" = '${reset_sms_code_hash}', \"smsOtpExpiresAt\" = NOW() + INTERVAL '5 minutes', \"updatedAt\" = NOW() WHERE id = '${reset_sms_temp_user_id}';" \
  >/dev/null

reset_sms_new_password="ResetTemp91Qx!"
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H 'content-type: application/json' \
  -d "{\"token\":\"${reset_sms_token}\",\"newPassword\":\"${reset_sms_new_password}\",\"smsCode\":\"${reset_sms_code}\"}" \
  "${api_base}/auth/reset-password/complete" \
  | jq -e '.success == true and .vaultPreserved == false' >/dev/null

"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -Atqc \
  "SELECT COALESCE(\"vaultNeedsRecovery\", false)::text || '|' || (\"passwordResetTokenHash\" IS NULL)::text FROM \"User\" WHERE id = '${reset_sms_temp_user_id}'" \
  | grep -qx 'true|true'

clear_login_rate_limits
reset_sms_login_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${reset_sms_temp_email}\",\"password\":\"${reset_sms_new_password}\"}" \
  "${api_base}/auth/login")"
printf '%s' "${reset_sms_login_json}" | jq -e '.requiresMFA == true and (.methods | index("sms")) != null' >/dev/null
reset_sms_temp_token="$(printf '%s' "${reset_sms_login_json}" | jq -r '.tempToken')"
[[ -n "${reset_sms_temp_token}" && "${reset_sms_temp_token}" != "null" ]]

reset_sms_verify_code="654321"
reset_sms_verify_hash="$(printf '%s' "${reset_sms_verify_code}" | sha256sum | awk '{print $1}')"
"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "UPDATE \"User\" SET \"smsOtpHash\" = '${reset_sms_verify_hash}', \"smsOtpExpiresAt\" = NOW() + INTERVAL '5 minutes', \"updatedAt\" = NOW() WHERE id = '${reset_sms_temp_user_id}';" \
  >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H 'content-type: application/json' \
  -d "{\"tempToken\":\"${reset_sms_temp_token}\",\"code\":\"${reset_sms_verify_code}\"}" \
  "${api_base}/auth/verify-sms" \
  | jq -e --arg email "${reset_sms_temp_email}" '.accessToken and .user.email == $email' >/dev/null

admin_auth_providers_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/admin/auth-providers")"
printf '%s' "${admin_auth_providers_json}" | jq -e '
  type == "array"
  and length == 6
  and (map(.key) | sort) == ["github","google","ldap","microsoft","oidc","saml"]
' >/dev/null

echo '2.1.11.4.1 /api/admin/system-settings/db-status'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/admin/system-settings/db-status" \
  | jq -e '.host and (.port | type == "number") and .database and (.connected | type == "boolean")' >/dev/null

echo '2.1.11.4.2 /api/admin/system-settings list/update/bulk-update'
system_settings_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/admin/system-settings")"
printf '%s' "${system_settings_json}" | jq -e '
  (.settings | type == "array")
  and (.groups | type == "array")
  and ((.settings | map(select(.key == "CLI_ENABLED")) | length) == 1)
' >/dev/null

original_cli_enabled="$(printf '%s' "${system_settings_json}" | jq -r '.settings[] | select(.key == "CLI_ENABLED") | .value')"
cli_enabled_locked="$(printf '%s' "${system_settings_json}" | jq -r '.settings[] | select(.key == "CLI_ENABLED") | .envLocked')"
if [[ "${cli_enabled_locked}" != "true" ]]; then
  toggled_cli_enabled="true"
  if [[ "${original_cli_enabled}" == "true" ]]; then
    toggled_cli_enabled="false"
  fi

  curl --silent --show-error --fail \
    --cacert "${ca_cert}" \
    -H "authorization: Bearer ${access_token}" \
    -H 'content-type: application/json' \
    -X PUT \
    -d "{\"value\":${toggled_cli_enabled}}" \
    "${api_base}/admin/system-settings/CLI_ENABLED" \
    | jq -e --argjson value "${toggled_cli_enabled}" '.key == "CLI_ENABLED" and .source == "db" and .value == $value' >/dev/null

  curl --silent --show-error --fail \
    --cacert "${ca_cert}" \
    -H "authorization: Bearer ${access_token}" \
    "${api_base}/admin/system-settings" \
    | jq -e --argjson value "${toggled_cli_enabled}" '.settings[] | select(.key == "CLI_ENABLED") | .value == $value' >/dev/null

  curl --silent --show-error --fail \
    --cacert "${ca_cert}" \
    -H "authorization: Bearer ${access_token}" \
    -H 'content-type: application/json' \
    -X PUT \
    -d "{\"updates\":[{\"key\":\"CLI_ENABLED\",\"value\":${original_cli_enabled}}]}" \
    "${api_base}/admin/system-settings" \
    | jq -e '.results | length == 1 and .[0].key == "CLI_ENABLED" and .[0].success == true' >/dev/null

  curl --silent --show-error --fail \
    --cacert "${ca_cert}" \
    -H "authorization: Bearer ${access_token}" \
    "${api_base}/admin/system-settings" \
    | jq -e --argjson value "${original_cli_enabled}" '.settings[] | select(.key == "CLI_ENABLED") | .value == $value' >/dev/null
fi

if [[ "$(printf '%s' "${admin_app_config_json}" | jq -r '.selfSignupEnvLocked')" == "true" ]]; then
  admin_self_signup_status="$(curl --silent --show-error \
    --output /tmp/arsenale-admin-self-signup.json \
    --write-out '%{http_code}' \
    --cacert "${ca_cert}" \
    -H "authorization: Bearer ${access_token}" \
    -H 'content-type: application/json' \
    -X PUT \
    -d '{"enabled":true}' \
    "${api_base}/admin/app-config/self-signup")"
  [[ "${admin_self_signup_status}" == "403" ]]
  jq -e '.error == "Self-signup is disabled at the environment level and cannot be changed via the admin panel."' \
    /tmp/arsenale-admin-self-signup.json >/dev/null
else
  original_self_signup_enabled="$(printf '%s' "${admin_app_config_json}" | jq -r '.selfSignupEnabled')"
  toggled_self_signup_enabled="true"
  if [[ "${original_self_signup_enabled}" == "true" ]]; then
    toggled_self_signup_enabled="false"
  fi

  curl --silent --show-error --fail \
    --cacert "${ca_cert}" \
    -H "authorization: Bearer ${access_token}" \
    -H 'content-type: application/json' \
    -X PUT \
    -d "{\"enabled\":${toggled_self_signup_enabled}}" \
    "${api_base}/admin/app-config/self-signup" \
    | jq -e --argjson enabled "${toggled_self_signup_enabled}" '.selfSignupEnabled == $enabled' >/dev/null

  curl --silent --show-error --fail \
    --cacert "${ca_cert}" \
    -H "authorization: Bearer ${access_token}" \
    -H 'content-type: application/json' \
    -X PUT \
    -d "{\"enabled\":${original_self_signup_enabled}}" \
    "${api_base}/admin/app-config/self-signup" \
    | jq -e --argjson enabled "${original_self_signup_enabled}" '.selfSignupEnabled == $enabled' >/dev/null
fi

echo '2.1.11.4.3 /api/vault-providers list/create/get/update/delete'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/vault-providers" \
  | jq -e 'type == "array"' >/dev/null

external_vault_provider_id="$(
  curl --silent --show-error --fail \
    --cacert "${ca_cert}" \
    -H "authorization: Bearer ${access_token}" \
    -H 'content-type: application/json' \
    -X POST \
    -d '{"name":"Acceptance Vault Provider","providerType":"HASHICORP_VAULT","serverUrl":"https://vault.example.local","authMethod":"TOKEN","mountPath":"secret","authPayload":"{\"token\":\"acceptance-token\"}","cacheTtlSeconds":180}' \
    "${api_base}/vault-providers" \
    | tee /tmp/arsenale-vault-provider-create.json \
    | jq -r '.id'
)"
[[ -n "${external_vault_provider_id}" && "${external_vault_provider_id}" != "null" ]]
cat /tmp/arsenale-vault-provider-create.json | jq -e --arg id "${external_vault_provider_id}" '.id == $id and .name == "Acceptance Vault Provider" and .providerType == "HASHICORP_VAULT" and .authMethod == "TOKEN" and .cacheTtlSeconds == 180' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/vault-providers" \
  | jq -e --arg id "${external_vault_provider_id}" 'map(select(.id == $id and .name == "Acceptance Vault Provider")) | length == 1' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/vault-providers/${external_vault_provider_id}" \
  | jq -e --arg id "${external_vault_provider_id}" '.id == $id and .name == "Acceptance Vault Provider" and .hasApiToken == true' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X POST \
  -d '{"secretPath":"acceptance/secret"}' \
  "${api_base}/vault-providers/${external_vault_provider_id}/test" \
  | jq -e '.success == false and (.error | type == "string")' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d '{"name":"Acceptance Vault Provider Updated","cacheTtlSeconds":240,"enabled":false}' \
  "${api_base}/vault-providers/${external_vault_provider_id}" \
  | jq -e --arg id "${external_vault_provider_id}" '.id == $id and .name == "Acceptance Vault Provider Updated" and .cacheTtlSeconds == 240 and .enabled == false' >/dev/null

delete_vault_provider_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -X DELETE \
  "${api_base}/vault-providers/${external_vault_provider_id}")"
[[ "${delete_vault_provider_status}" == "204" ]]
external_vault_provider_id=""

echo '2.1.11.4.4 /api/sync-profiles list/create/get/update/logs/delete'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/sync-profiles" \
  | jq -e 'type == "array"' >/dev/null

sync_profile_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d '{"name":"Acceptance Sync Profile","provider":"NETBOX","url":"https://netbox.example.local","apiToken":"acceptance-sync-token","filters":{"site":"lab"},"platformMapping":{"cisco-ios":"SSH"},"defaultProtocol":"SSH","defaultPort":{"SSH":22},"conflictStrategy":"update"}' \
  "${api_base}/sync-profiles")"
sync_profile_id="$(printf '%s' "${sync_profile_json}" | jq -r '.id')"
[[ -n "${sync_profile_id}" && "${sync_profile_id}" != "null" ]]
printf '%s' "${sync_profile_json}" | jq -e '.name == "Acceptance Sync Profile" and .provider == "NETBOX" and .hasApiToken == true and .config.url == "https://netbox.example.local"' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/sync-profiles" \
  | jq -e --arg id "${sync_profile_id}" 'map(select(.id == $id and .name == "Acceptance Sync Profile")) | length == 1' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/sync-profiles/${sync_profile_id}" \
  | jq -e --arg id "${sync_profile_id}" '.id == $id and .config.filters.site == "lab" and .config.defaultProtocol == "SSH"' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d '{"name":"Acceptance Sync Profile Updated","url":"https://netbox-updated.example.local","filters":{"role":"core"},"platformMapping":{"juniper-junos":"SSH"},"defaultProtocol":"RDP","defaultPort":{"RDP":3389},"conflictStrategy":"overwrite","enabled":false}' \
  "${api_base}/sync-profiles/${sync_profile_id}" \
  | jq -e --arg id "${sync_profile_id}" '.id == $id and .name == "Acceptance Sync Profile Updated" and .enabled == false and .config.url == "https://netbox-updated.example.local" and .config.defaultProtocol == "RDP" and .config.conflictStrategy == "overwrite"' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -X POST \
  "${api_base}/sync-profiles/${sync_profile_id}/test" \
  | jq -e '.ok == false and (.error | type == "string")' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X POST \
  -d '{"dryRun":true}' \
  "${api_base}/sync-profiles/${sync_profile_id}/sync" \
  | jq -e '.plan and (.plan.errors | length) >= 1 and (.plan.toCreate | type == "array") and (.plan.toUpdate | type == "array") and (.plan.toSkip | type == "array")' >/dev/null

"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "INSERT INTO \"SyncLog\" (id, \"syncProfileId\", status, \"triggeredBy\", details) VALUES ('$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)', '${sync_profile_id}', 'SUCCESS', '${user_id}', '{\"created\":1}'::jsonb);" \
  >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/sync-profiles/${sync_profile_id}/logs?page=1&limit=20" \
  | jq -e '.total >= 1 and .page == 1 and .limit == 20 and (.logs | length >= 1) and .logs[0].syncProfileId == "'"${sync_profile_id}"'"' >/dev/null

delete_sync_profile_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -X DELETE \
  "${api_base}/sync-profiles/${sync_profile_id}")"
[[ "${delete_sync_profile_status}" == "204" ]]
sync_profile_id=""

echo '2.1.11.5 /api/access-policies list/create/update/delete'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/access-policies" \
  | jq -e 'type == "array"' >/dev/null

access_policy_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d "{\"targetType\":\"TENANT\",\"targetId\":\"${tenant_id}\",\"allowedTimeWindows\":\"09:00-18:00\",\"requireTrustedDevice\":true,\"requireMfaStepUp\":false}" \
  "${api_base}/access-policies")"
access_policy_id="$(printf '%s' "${access_policy_json}" | jq -r '.id')"
[[ -n "${access_policy_id}" && "${access_policy_id}" != "null" ]]
printf '%s' "${access_policy_json}" | jq -e --arg tenant_id "${tenant_id}" '.targetType == "TENANT" and .targetId == $tenant_id and .allowedTimeWindows == "09:00-18:00" and .requireTrustedDevice == true and .requireMfaStepUp == false' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/access-policies" \
  | jq -e --arg id "${access_policy_id}" 'type == "array" and ((map(select(.id == $id)) | length) == 1)' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d '{"allowedTimeWindows":"08:30-17:30","requireTrustedDevice":false,"requireMfaStepUp":true}' \
  "${api_base}/access-policies/${access_policy_id}" \
  | jq -e '.allowedTimeWindows == "08:30-17:30" and .requireTrustedDevice == false and .requireMfaStepUp == true' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -X DELETE \
  "${api_base}/access-policies/${access_policy_id}" \
  | jq -e '.deleted == true' >/dev/null
access_policy_id=""

echo '2.1.11.6 /api/keystroke-policies list/create/get/update/delete'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/keystroke-policies" \
  | jq -e 'type == "array"' >/dev/null

keystroke_policy_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d '{"name":"Acceptance Keystroke Policy","description":"temporary policy","action":"ALERT_ONLY","regexPatterns":["password","token=.*"],"enabled":true}' \
  "${api_base}/keystroke-policies")"
keystroke_policy_id="$(printf '%s' "${keystroke_policy_json}" | jq -r '.id')"
[[ -n "${keystroke_policy_id}" && "${keystroke_policy_id}" != "null" ]]
printf '%s' "${keystroke_policy_json}" | jq -e '.name == "Acceptance Keystroke Policy" and .action == "ALERT_ONLY" and (.regexPatterns | length) == 2 and .enabled == true' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/keystroke-policies/${keystroke_policy_id}" \
  | jq -e --arg id "${keystroke_policy_id}" '.id == $id and .tenantId != null' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d '{"name":"Acceptance Keystroke Policy Updated","action":"BLOCK_AND_TERMINATE","regexPatterns":["secret"],"enabled":false}' \
  "${api_base}/keystroke-policies/${keystroke_policy_id}" \
  | jq -e '.name == "Acceptance Keystroke Policy Updated" and .action == "BLOCK_AND_TERMINATE" and (.regexPatterns | length) == 1 and .enabled == false' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -X DELETE \
  "${api_base}/keystroke-policies/${keystroke_policy_id}" \
  | jq -e '.deleted == true' >/dev/null
keystroke_policy_id=""

echo '2.1.11.7 /api/gateways'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/gateways" \
  | jq -e 'type == "array"' >/dev/null

gateway_acceptance_name="Acceptance Gateway $(python3 - <<'PY'
import uuid
print(str(uuid.uuid4())[:8])
PY
)"
gateway_acceptance_id="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d "{\"name\":\"${gateway_acceptance_name}\",\"type\":\"GUACD\",\"host\":\"guacd\",\"port\":4822,\"description\":\"Go gateway acceptance\",\"monitoringEnabled\":true}" \
  "${api_base}/gateways" \
  | jq -r '.id')"
[[ -n "${gateway_acceptance_id}" && "${gateway_acceptance_id}" != "null" ]]

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d '{"description":"Go gateway acceptance updated","monitorIntervalMs":4000}' \
  "${api_base}/gateways/${gateway_acceptance_id}" \
  | jq -e '.description == "Go gateway acceptance updated" and .monitorIntervalMs == 4000' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -X POST \
  "${api_base}/gateways/${gateway_acceptance_id}/test" \
  | jq -e '.reachable == true' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -X DELETE \
  "${api_base}/gateways/${gateway_acceptance_id}" \
  | jq -e '.deleted == true' >/dev/null
gateway_acceptance_id=""

echo '2.1.11.8 /api/notifications preferences/list/read/delete'
notification_id="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "INSERT INTO \"Notification\" (id, \"userId\", type, message, read, \"createdAt\") VALUES ('${notification_id}', '${user_id}', 'RECORDING_READY', 'Go-native notification acceptance', false, NOW());" \
  >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/notifications/preferences" \
  | jq -e 'type == "array" and length >= 1' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d '{"inApp":false,"email":true}' \
  "${api_base}/notifications/preferences/RECORDING_READY" \
  | jq -e '.type == "RECORDING_READY" and .inApp == false and .email == true' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d '{"preferences":[{"type":"RECORDING_READY","inApp":true,"email":false}]}' \
  "${api_base}/notifications/preferences" \
  | jq -e 'type == "array" and .[0].type == "RECORDING_READY" and .[0].inApp == true and .[0].email == false' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/notifications?limit=20&offset=0" \
  | jq -e --arg id "${notification_id}" '.data | map(select(.id == $id and .read == false)) | length == 1' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -X PUT \
  "${api_base}/notifications/${notification_id}/read" \
  | jq -e '.success == true' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -X PUT \
  "${api_base}/notifications/read-all" \
  | jq -e '.success == true' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -X DELETE \
  "${api_base}/notifications/${notification_id}" \
  | jq -e '.success == true' >/dev/null

echo '2.1.11.9 /api/share public info/access'
public_share_seed_json="$(node <<'NODE'
const crypto = require('crypto');

const token = crypto.randomBytes(32).toString('base64url');
const shareId = crypto.randomUUID();
const secretId = crypto.randomUUID();
const tokenHash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
const tokenSalt = crypto.randomBytes(32).toString('base64');
const derivedKey = crypto.hkdfSync('sha256', Buffer.from(token, 'base64url'), Buffer.from(tokenSalt, 'base64'), Buffer.from(shareId, 'utf8'), 32);
const iv = crypto.randomBytes(16);
const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
const plaintext = JSON.stringify({ username: 'acceptance-share-user', password: 'acceptance-share-pass' });
const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
const tag = cipher.getAuthTag();

process.stdout.write(JSON.stringify({
  shareId,
  secretId,
  token,
  tokenHash,
  tokenSalt,
  encryptedData: ciphertext.toString('hex'),
  dataIV: iv.toString('hex'),
  dataTag: tag.toString('hex'),
}));
NODE
)"
public_share_id="$(printf '%s' "${public_share_seed_json}" | jq -r '.shareId')"
public_share_secret_id="$(printf '%s' "${public_share_seed_json}" | jq -r '.secretId')"
public_share_token="$(printf '%s' "${public_share_seed_json}" | jq -r '.token')"
public_share_token_hash="$(printf '%s' "${public_share_seed_json}" | jq -r '.tokenHash')"
public_share_token_salt="$(printf '%s' "${public_share_seed_json}" | jq -r '.tokenSalt')"
public_share_encrypted_data="$(printf '%s' "${public_share_seed_json}" | jq -r '.encryptedData')"
public_share_data_iv="$(printf '%s' "${public_share_seed_json}" | jq -r '.dataIV')"
public_share_data_tag="$(printf '%s' "${public_share_seed_json}" | jq -r '.dataTag')"

"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "INSERT INTO \"VaultSecret\" (id, name, type, scope, \"userId\", \"tenantId\", \"encryptedData\", \"dataIV\", \"dataTag\", metadata, tags, \"createdAt\", \"updatedAt\") VALUES ('${public_share_secret_id}', 'Acceptance Public Share Secret', 'LOGIN', 'PERSONAL', '${user_id}', '${tenant_id}', '00', '00', '00', '{}'::jsonb, ARRAY[]::text[], NOW(), NOW()); INSERT INTO \"ExternalSecretShare\" (id, \"secretId\", \"createdByUserId\", \"tokenHash\", \"encryptedData\", \"dataIV\", \"dataTag\", \"hasPin\", \"pinSalt\", \"tokenSalt\", \"expiresAt\", \"maxAccessCount\", \"accessCount\", \"secretType\", \"secretName\", \"isRevoked\", \"createdAt\") VALUES ('${public_share_id}', '${public_share_secret_id}', '${user_id}', '${public_share_token_hash}', '${public_share_encrypted_data}', '${public_share_data_iv}', '${public_share_data_tag}', false, NULL, '${public_share_token_salt}', NOW() + INTERVAL '1 hour', 1, 0, 'LOGIN', 'Acceptance Public Share Secret', false, NOW());" \
  >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  "${api_base}/share/${public_share_token}/info" \
  | jq -e '.secretName == "Acceptance Public Share Secret" and .secretType == "LOGIN" and .hasPin == false and .isExpired == false and .isRevoked == false' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H 'content-type: application/json' \
  -X POST \
  -d '{}' \
  "${api_base}/share/${public_share_token}" \
  | jq -e '.secretName == "Acceptance Public Share Secret" and .data.username == "acceptance-share-user" and .data.password == "acceptance-share-pass"' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  "${api_base}/share/${public_share_token}/info" \
  | jq -e '.isExhausted == true' >/dev/null

temp_email="admin+refactor@example.com"

echo '2.1.12 /api/user/email-change initiate temp'
email_change_verification_id="$(
  curl --silent --show-error --fail \
    --cacert "${ca_cert}" \
    -H "authorization: Bearer ${access_token}" \
    -H 'content-type: application/json' \
    -X POST \
    -d '{"newEmail":"'"${temp_email}"'"}' \
    "${api_base}/user/email-change/initiate" \
    | jq -r '.verificationId'
)"
[[ -n "${email_change_verification_id}" && "${email_change_verification_id}" != "null" ]]

echo '2.1.13 /api/user/identity/confirm for email change'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X POST \
  -d '{"verificationId":"'"${email_change_verification_id}"'","password":"'"${admin_password}"'"}' \
  "${api_base}/user/identity/confirm" \
  | jq -e '.confirmed == true' >/dev/null

echo '2.1.14 /api/user/email-change confirm temp'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X POST \
  -d '{"verificationId":"'"${email_change_verification_id}"'"}' \
  "${api_base}/user/email-change/confirm" \
  | jq -e '.email == "'"${temp_email}"'"' >/dev/null

echo '2.1.15 /api/user/profile temp email readback'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/user/profile" \
  | jq -e '.email == "'"${temp_email}"'"' >/dev/null

echo '2.1.16 /api/user/email-change restore initiate'
restore_verification_id="$(
  curl --silent --show-error --fail \
    --cacert "${ca_cert}" \
    -H "authorization: Bearer ${access_token}" \
    -H 'content-type: application/json' \
    -X POST \
    -d '{"newEmail":"'"${admin_email}"'"}' \
    "${api_base}/user/email-change/initiate" \
    | jq -r '.verificationId'
)"
[[ -n "${restore_verification_id}" && "${restore_verification_id}" != "null" ]]

echo '2.1.17 /api/user/identity/confirm restore'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X POST \
  -d '{"verificationId":"'"${restore_verification_id}"'","password":"'"${admin_password}"'"}' \
  "${api_base}/user/identity/confirm" \
  | jq -e '.confirmed == true' >/dev/null

echo '2.1.18 /api/user/email-change confirm restore'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X POST \
  -d '{"verificationId":"'"${restore_verification_id}"'"}' \
  "${api_base}/user/email-change/confirm" \
  | jq -e '.email == "'"${admin_email}"'"' >/dev/null

echo '2.1.19 /api/user/profile restore readback'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/user/profile" \
  | jq -e '.email == "'"${admin_email}"'"' >/dev/null

echo '2.2 Redis coordination'
redis_coordination_ok=0
for attempt in 1 2 3 4 5; do
  if "${container_runtime}" exec "${redis_container}" redis-cli -h 127.0.0.1 -p 6379 ping | grep -q '^PONG$'; then
    redis_rate_limit_keys="$("${container_runtime}" exec "${redis_container}" redis-cli --scan --pattern 'rl:*' 2>/dev/null || true)"
    if grep -q '^rl:' <<<"${redis_rate_limit_keys}"; then
      redis_coordination_ok=1
      break
    fi
  fi
  sleep 1
done
[[ "${redis_coordination_ok}" -eq 1 ]]

echo '3. Go control-plane'
curl --silent --show-error --fail "${cp_base}/v1/meta/service" \
  | jq -e '.service.name == "control-plane-api"' >/dev/null
curl --silent --show-error --fail "${cp_base}/v1/orchestrators" \
  | jq -e '.connections | length >= 1' >/dev/null

orchestrator_name="$(curl --silent --show-error --fail "${cp_base}/v1/orchestrators" | jq -r '.connections[0].name')"
[[ -n "${orchestrator_name}" && "${orchestrator_name}" != "null" ]]

echo '3.1 Go control-plane-controller'
curl --silent --show-error --fail "${controller_base}/v1/meta/service" \
  | jq -e '.service.name == "control-plane-controller"' >/dev/null
curl --silent --show-error --fail \
  -H 'content-type: application/json' \
  -d "{\"connectionName\":\"${orchestrator_name}\",\"workload\":{\"name\":\"acceptance-workload\",\"image\":\"ghcr.io/example/app:latest\",\"env\":{\"MODE\":\"dev\"},\"ports\":[{\"container\":8080,\"protocol\":\"tcp\"}],\"healthcheck\":{\"command\":[\"/bin/true\"],\"intervalSec\":10,\"timeoutSec\":5,\"retries\":3},\"oci\":{\"network\":\"bridge\"}}}" \
  "${controller_base}/v1/reconcile:plan" \
  | jq -e '.accepted == true and .connection.name == "'"${orchestrator_name}"'"' >/dev/null

echo '3.2 Go authz-pdp'
curl --silent --show-error --fail "${authz_base}/v1/meta/service" \
  | jq -e '.service.name == "authz-pdp"' >/dev/null
curl --silent --show-error --fail \
  -H 'content-type: application/json' \
  -d '{"subject":{"type":"agent_run","id":"run-1"},"action":"db.query.execute.write","resource":{"type":"database","id":"dev-postgres"}}' \
  "${authz_base}/v1/decide" \
  | jq -e '.effect == "deny" and (.obligations | any(.type == "require_approval"))' >/dev/null

echo '3.3 Go model-gateway'
curl --silent --show-error --fail "${model_base}/v1/meta/service" \
  | jq -e '.service.name == "model-gateway"' >/dev/null
curl --silent --show-error --fail "${model_base}/v1/providers" \
  | jq -e '.providers | any(.id == "openai")' >/dev/null
curl --silent --show-error --fail \
  -H 'content-type: application/json' \
  -d "{\"config\":{\"tenantId\":\"${tenant_id}\",\"provider\":\"openai\",\"modelId\":\"gpt-4o\",\"maxTokensPerRequest\":2048,\"dailyRequestLimit\":50,\"enabled\":true},\"apiKeyConfigured\":false}" \
  "${model_base}/v1/provider-configs:validate" \
  | jq -e '.valid == false and (.errors | any(. == "provider requires an API key"))' >/dev/null
curl --silent --show-error --fail \
  -X PUT \
  -H 'content-type: application/json' \
  -d '{"provider":"openai","apiKey":"acceptance-key","modelId":"gpt-4o-mini","maxTokensPerRequest":2048,"dailyRequestLimit":50,"enabled":true}' \
  "${model_base}/v1/provider-configs/${tenant_id}" \
  | jq -e '.config.provider == "openai" and .config.hasApiKey == true and .config.modelId == "gpt-4o-mini"' >/dev/null

echo '3.4 Go runtime-agent'
curl --silent --show-error --fail "${runtime_base}/v1/meta/service" \
  | jq -e '.service.name == "runtime-agent"' >/dev/null
curl --silent --show-error --fail \
  -H 'content-type: application/json' \
  -d '{"kind":"podman","workload":{"name":"acceptance-runtime","image":"ghcr.io/example/app:latest","env":{"MODE":"dev"},"ports":[{"container":8080,"protocol":"tcp"}],"healthcheck":{"command":["/bin/true"],"intervalSec":10,"timeoutSec":5,"retries":3},"oci":{"network":"bridge"}}}' \
  "${runtime_base}/v1/runtime/workloads:validate" \
  | jq -e '.valid == true' >/dev/null

echo '3.5 Go desktop-broker'
curl --silent --show-error --fail "${desktop_base}/v1/meta/service" \
  | jq -e '.service.name == "desktop-broker"' >/dev/null

echo '3.6 Go terminal-broker'
curl --silent --show-error --fail "${terminal_base}/v1/meta/service" \
  | jq -e '.service.name == "terminal-broker"' >/dev/null
curl --silent --show-error --fail "${terminal_base}/v1/session-protocol" \
  | jq -e '.webSocketPath == "/ws/terminal"' >/dev/null

echo '3.7 Go tunnel-broker'
curl --silent --show-error --fail "${tunnel_base}/v1/meta/service" \
  | jq -e '.service.name == "tunnel-broker"' >/dev/null

echo '4. Go query-runner'
query_write_table="query_runner_write_$(date +%s)"
curl --silent --show-error --fail \
  -H 'content-type: application/json' \
  -d "{\"sql\":\"select current_database() as database_name\",\"maxRows\":1,\"target\":{\"protocol\":\"postgresql\",\"host\":\"${sample_postgres_host}\",\"port\":${sample_postgres_port},\"database\":\"${sample_postgres_db_name}\",\"sslMode\":\"${sample_postgres_ssl_mode}\",\"username\":\"${sample_postgres_user}\",\"password\":\"${sample_postgres_password}\"}}" \
  "${query_base}/v1/query-runs:execute" \
  | jq -e ".rowCount == 1 and .rows[0].database_name == \"${sample_postgres_db_name}\"" >/dev/null

curl --silent --show-error --fail \
  -H 'content-type: application/json' \
  -d "{\"sql\":\"select current_database() as database_name\",\"target\":{\"protocol\":\"postgresql\",\"host\":\"${sample_postgres_host}\",\"port\":${sample_postgres_port},\"database\":\"${sample_postgres_db_name}\",\"sslMode\":\"${sample_postgres_ssl_mode}\",\"username\":\"${sample_postgres_user}\",\"password\":\"${sample_postgres_password}\"}}" \
  "${query_base}/v1/query-plans:explain" \
  | jq -e '.supported == true and .format == "json"' >/dev/null

curl --silent --show-error --fail \
  -H 'content-type: application/json' \
  -d "{\"type\":\"database_version\",\"db\":{\"protocol\":\"postgresql\",\"host\":\"${sample_postgres_host}\",\"port\":${sample_postgres_port},\"database\":\"${sample_postgres_db_name}\",\"sslMode\":\"${sample_postgres_ssl_mode}\",\"username\":\"${sample_postgres_user}\",\"password\":\"${sample_postgres_password}\"}}" \
  "${query_base}/v1/introspection:run" \
  | jq -e '.supported == true and (.data.version | type == "string")' >/dev/null

curl --silent --show-error --fail \
  -H 'content-type: application/json' \
  -d "{\"target\":{\"protocol\":\"postgresql\",\"host\":\"${sample_postgres_host}\",\"port\":${sample_postgres_port},\"database\":\"${sample_postgres_db_name}\",\"sslMode\":\"${sample_postgres_ssl_mode}\",\"username\":\"${sample_postgres_user}\",\"password\":\"${sample_postgres_password}\"}}" \
  "${query_base}/v1/schema:fetch" \
  | jq -e '.tables | length > 0' >/dev/null

curl --silent --show-error --fail \
  -H 'content-type: application/json' \
  -d "{\"sql\":\"select current_setting('TIMEZONE') as timezone, current_setting('search_path') as search_path\",\"target\":{\"protocol\":\"postgresql\",\"host\":\"${sample_postgres_host}\",\"port\":${sample_postgres_port},\"database\":\"${sample_postgres_db_name}\",\"sslMode\":\"${sample_postgres_ssl_mode}\",\"username\":\"${sample_postgres_user}\",\"password\":\"${sample_postgres_password}\",\"sessionConfig\":{\"timezone\":\"Europe/Rome\",\"searchPath\":\"public\"}}}" \
  "${query_base}/v1/query-runs:execute" \
  | jq -e '.rowCount == 1 and .rows[0].timezone == "Europe/Rome" and (.rows[0].search_path | tostring | contains("public"))' >/dev/null

curl --silent --show-error --fail \
  -H 'content-type: application/json' \
  -d "{\"sql\":\"create table if not exists public.${query_write_table} (id integer primary key, note text not null)\",\"target\":{\"protocol\":\"postgresql\",\"host\":\"${sample_postgres_host}\",\"port\":${sample_postgres_port},\"database\":\"${sample_postgres_db_name}\",\"sslMode\":\"${sample_postgres_ssl_mode}\",\"username\":\"${sample_postgres_user}\",\"password\":\"${sample_postgres_password}\"}}" \
  "${query_base}/v1/query-runs:execute-any" \
  | jq -e '.rowCount == 0' >/dev/null

curl --silent --show-error --fail \
  -H 'content-type: application/json' \
  -d "{\"sql\":\"insert into public.${query_write_table} (id, note) values (1, 'go-write') on conflict (id) do update set note = excluded.note\",\"target\":{\"protocol\":\"postgresql\",\"host\":\"${sample_postgres_host}\",\"port\":${sample_postgres_port},\"database\":\"${sample_postgres_db_name}\",\"sslMode\":\"${sample_postgres_ssl_mode}\",\"username\":\"${sample_postgres_user}\",\"password\":\"${sample_postgres_password}\"}}" \
  "${query_base}/v1/query-runs:execute-any" \
  | jq -e '.rowCount >= 1' >/dev/null

curl --silent --show-error --fail \
  -H 'content-type: application/json' \
  -d "{\"sql\":\"select note from public.${query_write_table} where id = 1\",\"target\":{\"protocol\":\"postgresql\",\"host\":\"${sample_postgres_host}\",\"port\":${sample_postgres_port},\"database\":\"${sample_postgres_db_name}\",\"sslMode\":\"${sample_postgres_ssl_mode}\",\"username\":\"${sample_postgres_user}\",\"password\":\"${sample_postgres_password}\"}}" \
  "${query_base}/v1/query-runs:execute-any" \
  | jq -e '.rowCount == 1 and .rows[0].note == "go-write"' >/dev/null

curl --silent --show-error --fail \
  -H 'content-type: application/json' \
  -d "{\"sql\":\"drop table if exists public.${query_write_table}\",\"target\":{\"protocol\":\"postgresql\",\"host\":\"${sample_postgres_host}\",\"port\":${sample_postgres_port},\"database\":\"${sample_postgres_db_name}\",\"sslMode\":\"${sample_postgres_ssl_mode}\",\"username\":\"${sample_postgres_user}\",\"password\":\"${sample_postgres_password}\"}}" \
  "${query_base}/v1/query-runs:execute-any" \
  | jq -e '.rowCount == 0' >/dev/null

echo '5. Go tool-gateway'
curl --silent --show-error --fail "${tool_base}/v1/capabilities" \
  | jq -e '.capabilities | length >= 1' >/dev/null

curl --silent --show-error --fail \
  -H 'content-type: application/json' \
  -d "{\"capability\":\"db.query.execute.readonly\",\"authz\":{\"subject\":{\"type\":\"system\",\"id\":\"acceptance\"},\"resource\":{\"type\":\"database\",\"id\":\"dev-postgres\"}},\"input\":{\"sql\":\"select current_database() as database_name\",\"maxRows\":1,\"target\":{\"protocol\":\"postgresql\",\"host\":\"${sample_postgres_host}\",\"port\":${sample_postgres_port},\"database\":\"${sample_postgres_db_name}\",\"sslMode\":\"${sample_postgres_ssl_mode}\",\"username\":\"${sample_postgres_user}\",\"password\":\"${sample_postgres_password}\"}}}" \
  "${tool_base}/v1/tool-calls:execute" \
  | jq -e ".decision.effect == \"allow\" and .output.rowCount == 1 and .output.rows[0].database_name == \"${sample_postgres_db_name}\"" >/dev/null

curl --silent --show-error --fail \
  -H 'content-type: application/json' \
  -d "{\"capability\":\"db.schema.read\",\"authz\":{\"subject\":{\"type\":\"system\",\"id\":\"acceptance\"},\"resource\":{\"type\":\"database\",\"id\":\"dev-postgres\"}},\"input\":{\"target\":{\"protocol\":\"postgresql\",\"host\":\"${sample_postgres_host}\",\"port\":${sample_postgres_port},\"database\":\"${sample_postgres_db_name}\",\"sslMode\":\"${sample_postgres_ssl_mode}\",\"username\":\"${sample_postgres_user}\",\"password\":\"${sample_postgres_password}\"}}}" \
  "${tool_base}/v1/tool-calls:execute" \
  | jq -e '.decision.effect == "allow" and (.output.tables | length > 0)' >/dev/null

curl --silent --show-error --fail \
  -H 'content-type: application/json' \
  -d "{\"capability\":\"db.introspection.read\",\"authz\":{\"subject\":{\"type\":\"system\",\"id\":\"acceptance\"},\"resource\":{\"type\":\"database\",\"id\":\"dev-postgres\"}},\"input\":{\"type\":\"database_version\",\"db\":{\"protocol\":\"postgresql\",\"host\":\"${sample_postgres_host}\",\"port\":${sample_postgres_port},\"database\":\"${sample_postgres_db_name}\",\"sslMode\":\"${sample_postgres_ssl_mode}\",\"username\":\"${sample_postgres_user}\",\"password\":\"${sample_postgres_password}\"}}}" \
  "${tool_base}/v1/tool-calls:execute" \
  | jq -e '.decision.effect == "allow" and (.output.data.version | type == "string")' >/dev/null

echo '5.1 Go memory-service'
memory_namespace_key="$(curl --silent --show-error --fail \
  -X PUT \
  -H 'content-type: application/json' \
  -d '{"tenantId":"acceptance","scope":"agent","agentId":"agent-acceptance","type":"episodic","name":"default"}' \
  "${memory_base}/v1/memory/namespaces" \
  | jq -r '.namespace.key')"
[[ -n "${memory_namespace_key}" && "${memory_namespace_key}" != "null" ]]

curl --silent --show-error --fail \
  -H 'content-type: application/json' \
  -d '{"namespace":{"tenantId":"acceptance","scope":"agent","agentId":"agent-acceptance","type":"episodic","name":"default"},"content":"validated schema fetch path","summary":"schema fetch validation","metadata":{"source":"acceptance"}}' \
  "${memory_base}/v1/memory/items" \
  | jq -e '.item.namespaceKey == "'"${memory_namespace_key}"'"' >/dev/null

curl --silent --show-error --fail \
  "${memory_base}/v1/memory/items?namespaceKey=${memory_namespace_key}" \
  | jq -e '.items | length >= 1' >/dev/null

echo '5.2 Go agent-orchestrator'
agent_run_id="$(curl --silent --show-error --fail \
  -H 'content-type: application/json' \
  -d '{"tenantId":"acceptance","definitionId":"ops-agent","trigger":"acceptance","goals":["validate infra APIs"],"requestedCapabilities":["db.schema.read","gateway.scale"]}' \
  "${agent_base}/v1/agent-runs" \
  | jq -r '.run.id')"
[[ -n "${agent_run_id}" && "${agent_run_id}" != "null" ]]

curl --silent --show-error --fail \
  "${agent_base}/v1/agent-runs/${agent_run_id}" \
  | jq -e '.run.requiresApproval == true and .run.status == "queued"' >/dev/null

curl --silent --show-error --fail \
  "${agent_base}/v1/agent-runs?tenantId=acceptance" \
  | jq -e '.runs | any(.id == "'"${agent_run_id}"'")' >/dev/null

echo '5.3 Go tool-gateway memory capabilities'
curl --silent --show-error --fail \
  -H 'content-type: application/json' \
  -d '{"capability":"memory.write","authz":{"subject":{"type":"agent_run","id":"run-acceptance"},"resource":{"type":"memory_namespace","id":"agent-acceptance/default"},"context":{"approved":"true"}},"input":{"namespace":{"tenantId":"acceptance","scope":"agent","agentId":"agent-acceptance","type":"episodic","name":"default"},"content":"tool-gateway memory write","summary":"gateway memory validation","metadata":{"source":"tool-gateway"}}}' \
  "${tool_base}/v1/tool-calls:execute" \
  | jq -e '.decision.effect == "allow" and .output.item.namespaceKey == "'"${memory_namespace_key}"'"' >/dev/null

curl --silent --show-error --fail \
  -H 'content-type: application/json' \
  -d "{\"capability\":\"memory.read\",\"authz\":{\"subject\":{\"type\":\"agent_run\",\"id\":\"run-acceptance\"},\"resource\":{\"type\":\"memory_namespace\",\"id\":\"${memory_namespace_key}\"}},\"input\":{\"namespaceKey\":\"${memory_namespace_key}\"}}" \
  "${tool_base}/v1/tool-calls:execute" \
  | jq -e '.decision.effect == "allow" and (.output.items | length >= 1)' >/dev/null

echo '5.4 Go tool-gateway SSH grant + terminal broker flow'
terminal_grant_json="$(curl --silent --show-error --fail \
  -H 'content-type: application/json' \
  -d '{"capability":"connection.connect.ssh","authz":{"subject":{"type":"agent_run","id":"run-acceptance"},"resource":{"type":"connection","id":"terminal-target"},"context":{"approved":"true"}},"input":{"sessionId":"terminal-acceptance","connectionId":"terminal-target","userId":"acceptance","expiresAt":"2030-01-01T00:00:00Z","target":{"host":"terminal-target","port":2224,"username":"acceptance","password":"acceptance"},"terminal":{"term":"xterm-256color","cols":80,"rows":24}}}' \
  "${tool_base}/v1/tool-calls:execute")"
printf '%s' "${terminal_grant_json}" \
  | jq -e '.decision.effect == "allow" and (.output.token | type == "string") and (.output.webSocketUrl | startswith("ws://"))' >/dev/null
terminal_ws_url="$(printf '%s' "${terminal_grant_json}" | jq -r '.output.webSocketUrl')"
[[ -n "${terminal_ws_url}" && "${terminal_ws_url}" != "null" ]]

TERMINAL_WS_URL="${terminal_ws_url}" node <<'NODE'
const WebSocketCtor = globalThis.WebSocket || require('undici').WebSocket || require('ws');
const ws = new WebSocketCtor(process.env.TERMINAL_WS_URL);
let ready = false;
let sawOutput = false;
let buffer = '';
const timeout = setTimeout(() => {
  console.error('terminal broker websocket timed out');
  process.exit(1);
}, 15000);

ws.onmessage = (event) => {
  const message = JSON.parse(String(event.data));
  if (message.type === 'ready' && !ready) {
    ready = true;
    ws.send(JSON.stringify({ type: 'input', data: 'echo acceptance-terminal && exit\n' }));
    return;
  }

  if (message.type === 'data') {
    buffer += message.data || '';
    if (buffer.includes('acceptance-terminal')) {
      sawOutput = true;
    }
    return;
  }

  if (message.type === 'error') {
    clearTimeout(timeout);
    console.error(message.message || message.code || 'terminal broker error');
    process.exit(1);
  }

  if (message.type === 'closed') {
    clearTimeout(timeout);
    process.exit(sawOutput ? 0 : 1);
  }
};

ws.onerror = (event) => {
  clearTimeout(timeout);
  console.error(event.error?.message || 'terminal broker socket error');
  process.exit(1);
};

ws.onclose = () => {
  clearTimeout(timeout);
  process.exit(sawOutput ? 0 : 1);
};
NODE

echo '6. public SSH session flow'
create_ssh_connection_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d "{\"name\":\"${ssh_connection_name}\",\"type\":\"SSH\",\"host\":\"terminal-target\",\"port\":2224,\"username\":\"acceptance\",\"password\":\"acceptance\"}" \
  "${api_base}/connections")"
ssh_connection_id="$(printf '%s' "${create_ssh_connection_json}" | jq -r '.id')"
[[ -n "${ssh_connection_id}" && "${ssh_connection_id}" != "null" ]]

echo '6.0 /api/connections list/read/favorite'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/connections" \
  | jq -e --arg id "${ssh_connection_id}" '.own | map(select(.id == $id)) | length == 1' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/connections/${ssh_connection_id}" \
  | jq -e --arg id "${ssh_connection_id}" '.id == $id and .scope == "private"' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -X PATCH \
  "${api_base}/connections/${ssh_connection_id}/favorite" \
  | jq -e --arg id "${ssh_connection_id}" '.id == $id and .isFavorite == true' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d '{"description":"go-native-update","enableDrive":true}' \
  "${api_base}/connections/${ssh_connection_id}" \
  | jq -e --arg id "${ssh_connection_id}" '.id == $id and .description == "go-native-update" and .enableDrive == true' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/connections/${ssh_connection_id}" \
  | jq -e '.description == "go-native-update" and .enableDrive == true and .isFavorite == true' >/dev/null

echo '6.0.0 /api/vault/reveal-password'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X POST \
  -d "{\"connectionId\":\"${ssh_connection_id}\"}" \
  "${api_base}/vault/reveal-password" \
  | jq -e '.password == "acceptance"' >/dev/null

echo '6.0.0 /api/connections export/import'
export_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d "{\"format\":\"JSON\",\"includeCredentials\":true,\"connectionIds\":[\"${ssh_connection_id}\"]}" \
  "${api_base}/connections/export")"
printf '%s' "${export_json}" \
  | jq -e --arg id "${ssh_connection_id}" '
    .count == 1
    and (.connections | type == "array")
    and .connections[0].id == $id
    and .connections[0].username == "acceptance"
    and .connections[0].password == "acceptance"
  ' >/dev/null

import_connection_name="Acceptance Import $(date +%s)"
import_payload_file="$(mktemp)"
printf '%s' "{\"version\":\"1.0\",\"connections\":[{\"name\":\"${import_connection_name}\",\"type\":\"SSH\",\"host\":\"import-target\",\"port\":22,\"username\":\"import-user\",\"password\":\"ImportPass91Qx!\",\"description\":\"go-native-import\"}]}" > "${import_payload_file}"
import_result_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -F "duplicateStrategy=SKIP" \
  -F "format=JSON" \
  -F "file=@${import_payload_file};type=application/json" \
  "${api_base}/connections/import")"
rm -f "${import_payload_file}"
printf '%s' "${import_result_json}" | jq -e '.imported == 1 and .failed == 0' >/dev/null

imported_connection_id="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/connections" \
  | jq -r --arg name "${import_connection_name}" '.own[] | select(.name == $name) | .id' | head -n1)"
[[ -n "${imported_connection_id}" && "${imported_connection_id}" != "null" ]]

echo '6.0.0.1 /api/connections sharing'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d "{\"userId\":\"${oauth_vault_setup_user_id}\",\"permission\":\"READ_ONLY\"}" \
  "${api_base}/connections/${ssh_connection_id}/share" \
  | jq -e --arg email "${oauth_vault_setup_email}" '.permission == "READ_ONLY" and .sharedWith == $email' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/connections/${ssh_connection_id}/shares" \
  | jq -e --arg user_id "${oauth_vault_setup_user_id}" 'type == "array" and any(.userId == $user_id and .permission == "READ_ONLY")' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d '{"permission":"FULL_ACCESS"}' \
  "${api_base}/connections/${ssh_connection_id}/share/${oauth_vault_setup_user_id}" \
  | jq -e '.permission == "FULL_ACCESS"' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d "{\"connectionIds\":[\"${imported_connection_id}\"],\"target\":{\"email\":\"${oauth_vault_setup_email}\"},\"permission\":\"READ_ONLY\",\"folderName\":\"Acceptance Batch Share\"}" \
  "${api_base}/connections/batch-share" \
  | jq -e '.shared == 1 and .failed == 0 and .alreadyShared == 0 and (.errors | length == 0)' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -X DELETE \
  "${api_base}/connections/${ssh_connection_id}/share/${oauth_vault_setup_user_id}" \
  | jq -e '.deleted == true' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/connections/${ssh_connection_id}/shares" \
  | jq -e --arg user_id "${oauth_vault_setup_user_id}" 'type == "array" and all(.userId != $user_id)' >/dev/null

echo '6.0.1.1 /api/sessions/ssh-proxy status/token'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/sessions/ssh-proxy/status" \
  | jq -e '.enabled | type == "boolean"' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d "{\"connectionId\":\"${ssh_connection_id}\"}" \
  "${api_base}/sessions/ssh-proxy/token" \
  | jq -e --arg host "localhost" '.token | type == "string"' >/dev/null

echo '6.0.1 /api/tabs sync/list/clear'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d "{\"tabs\":[{\"connectionId\":\"${ssh_connection_id}\",\"sortOrder\":0,\"isActive\":true}]}" \
  "${api_base}/tabs" \
  | jq -e --arg id "${ssh_connection_id}" 'length == 1 and .[0].connectionId == $id and .[0].isActive == true' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/tabs" \
  | jq -e --arg id "${ssh_connection_id}" 'length == 1 and .[0].connectionId == $id and .[0].sortOrder == 0' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -X DELETE \
  "${api_base}/tabs" \
  | jq -e '.cleared == true' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/tabs" \
  | jq -e 'type == "array" and length == 0' >/dev/null

start_ssh_session_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d "{\"connectionId\":\"${ssh_connection_id}\"}" \
  "${api_base}/sessions/ssh")"
ssh_session_id="$(printf '%s' "${start_ssh_session_json}" | jq -r '.sessionId')"
ssh_transport="$(printf '%s' "${start_ssh_session_json}" | jq -r '.transport')"
ssh_ws_url="$(printf '%s' "${start_ssh_session_json}" | jq -r '.webSocketUrl')"
[[ "${ssh_transport}" == "terminal-broker" ]]
[[ -n "${ssh_session_id}" && "${ssh_session_id}" != "null" ]]
[[ -n "${ssh_ws_url}" && "${ssh_ws_url}" != "null" ]]

echo '6.0.2 /api/sessions active/count'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/sessions/active?protocol=SSH" \
  | jq -e --arg id "${ssh_session_id}" 'map(select(.id == $id and .protocol == "SSH")) | length == 1' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/sessions/count" \
  | jq -e '.count >= 1' >/dev/null

NODE_TLS_REJECT_UNAUTHORIZED=0 SSH_WS_URL="${ssh_ws_url}" node <<'NODE'
const WebSocketCtor = globalThis.WebSocket || require('undici').WebSocket || require('ws');
const ws = new WebSocketCtor(process.env.SSH_WS_URL);
let ready = false;
let sawOutput = false;
let buffer = '';
const timeout = setTimeout(() => {
  console.error('public ssh websocket timed out');
  process.exit(1);
}, 15000);

ws.onmessage = (event) => {
  const message = JSON.parse(String(event.data));
  if (message.type === 'ready' && !ready) {
    ready = true;
    ws.send(JSON.stringify({ type: 'input', data: 'echo acceptance-public-ssh && exit\n' }));
    return;
  }

  if (message.type === 'data') {
    buffer += message.data || '';
    if (buffer.includes('acceptance-public-ssh')) {
      sawOutput = true;
    }
    return;
  }

  if (message.type === 'error') {
    clearTimeout(timeout);
    console.error(message.message || message.code || 'public ssh broker error');
    process.exit(1);
  }
};

ws.onerror = (event) => {
  clearTimeout(timeout);
  console.error(event.error?.message || 'public ssh socket error');
  process.exit(1);
};

ws.onclose = () => {
  clearTimeout(timeout);
  process.exit(sawOutput ? 0 : 1);
};
NODE

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d '{}' \
  "${api_base}/sessions/ssh/${ssh_session_id}/end" \
  | jq -e '.ok == true' >/dev/null

echo '6.1. public SSH session flow via tunnel-backed managed gateway'
create_ssh_tunnel_connection_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d "{\"name\":\"${ssh_tunnel_connection_name}\",\"type\":\"SSH\",\"host\":\"terminal-target\",\"port\":2224,\"username\":\"acceptance\",\"password\":\"acceptance\",\"gatewayId\":\"${dev_tunnel_managed_ssh_gateway_id}\"}" \
  "${api_base}/connections")"
ssh_tunnel_connection_id="$(printf '%s' "${create_ssh_tunnel_connection_json}" | jq -r '.id')"
[[ -n "${ssh_tunnel_connection_id}" && "${ssh_tunnel_connection_id}" != "null" ]]

start_ssh_tunnel_session_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d "{\"connectionId\":\"${ssh_tunnel_connection_id}\"}" \
  "${api_base}/sessions/ssh")"
ssh_tunnel_session_id="$(printf '%s' "${start_ssh_tunnel_session_json}" | jq -r '.sessionId')"
ssh_tunnel_transport="$(printf '%s' "${start_ssh_tunnel_session_json}" | jq -r '.transport')"
ssh_tunnel_ws_url="$(printf '%s' "${start_ssh_tunnel_session_json}" | jq -r '.webSocketUrl')"
[[ "${ssh_tunnel_transport}" == "terminal-broker" ]]
[[ -n "${ssh_tunnel_session_id}" && "${ssh_tunnel_session_id}" != "null" ]]
[[ -n "${ssh_tunnel_ws_url}" && "${ssh_tunnel_ws_url}" != "null" ]]

echo '6.1.0 /api/sessions/count/gateway'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/sessions/count/gateway" \
  | jq -e --arg gateway_id "${dev_tunnel_managed_ssh_gateway_id}" 'map(select(.gatewayId == $gateway_id and .count >= 1)) | length >= 1' >/dev/null

NODE_TLS_REJECT_UNAUTHORIZED=0 SSH_WS_URL="${ssh_tunnel_ws_url}" node <<'NODE'
const WebSocketCtor = globalThis.WebSocket || require('undici').WebSocket || require('ws');
const ws = new WebSocketCtor(process.env.SSH_WS_URL);
let ready = false;
let sawOutput = false;
let buffer = '';
const timeout = setTimeout(() => {
  console.error('public tunnel ssh websocket timed out');
  process.exit(1);
}, 15000);

ws.onmessage = (event) => {
  const message = JSON.parse(String(event.data));
  if (message.type === 'ready' && !ready) {
    ready = true;
    ws.send(JSON.stringify({ type: 'input', data: 'echo acceptance-tunnel-ssh && exit\n' }));
    return;
  }

  if (message.type === 'data') {
    buffer += message.data || '';
    if (buffer.includes('acceptance-tunnel-ssh')) {
      sawOutput = true;
    }
    return;
  }

  if (message.type === 'error') {
    clearTimeout(timeout);
    console.error(message.message || message.code || 'public tunnel ssh broker error');
    process.exit(1);
  }
};

ws.onerror = (event) => {
  clearTimeout(timeout);
  console.error(event.error?.message || 'public tunnel ssh socket error');
  process.exit(1);
};

ws.onclose = () => {
  clearTimeout(timeout);
  process.exit(sawOutput ? 0 : 1);
};
NODE

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d '{}' \
  "${api_base}/sessions/ssh/${ssh_tunnel_session_id}/end" \
  | jq -e '.ok == true' >/dev/null

curl --silent --show-error --fail "${tunnel_base}/v1/tunnels/${dev_tunnel_managed_ssh_gateway_id}" \
  | jq -e '.gatewayId == "'"${dev_tunnel_managed_ssh_gateway_id}"'" and .connected == true' >/dev/null

echo '7. public DB session flow'
create_connection_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d "{\"name\":\"${connection_name}\",\"type\":\"DATABASE\",\"host\":\"${sample_postgres_host}\",\"port\":${sample_postgres_port},\"username\":\"${sample_postgres_user}\",\"password\":\"${sample_postgres_password}\",\"dbSettings\":{\"protocol\":\"postgresql\",\"databaseName\":\"${sample_postgres_db_name}\",\"sslMode\":\"${sample_postgres_ssl_mode}\"}}" \
  "${api_base}/connections")"
connection_id="$(printf '%s' "${create_connection_json}" | jq -r '.id')"
[[ -n "${connection_id}" && "${connection_id}" != "null" ]]

create_session_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d "{\"connectionId\":\"${connection_id}\"}" \
  "${api_base}/sessions/database")"
session_id="$(printf '%s' "${create_session_json}" | jq -r '.sessionId')"
[[ -n "${session_id}" && "${session_id}" != "null" ]]

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d '{}' \
  "${api_base}/sessions/database/${session_id}/heartbeat" \
  | jq -e '.ok == true' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -X PUT \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d '{"sessionConfig":{"timezone":"Europe/Rome","searchPath":"public"}}' \
  "${api_base}/sessions/database/${session_id}/config" \
  | jq -e '.applied == true and .sessionConfig.timezone == "Europe/Rome" and .sessionConfig.searchPath == "public"' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/sessions/database/${session_id}/config" \
  | jq -e '.timezone == "Europe/Rome" and .searchPath == "public"' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d "{\"sql\":\"select current_setting('TIMEZONE') as timezone, current_setting('search_path') as search_path\"}" \
  "${api_base}/sessions/database/${session_id}/query" \
  | jq -e '.rowCount == 1 and .rows[0].timezone == "Europe/Rome" and (.rows[0].search_path | tostring | contains("public"))' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d '{"sql":"select current_database() as database_name"}' \
  "${api_base}/sessions/database/${session_id}/query" \
  | jq -e ".rowCount == 1 and .rows[0].database_name == \"${sample_postgres_db_name}\"" >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/sessions/database/${session_id}/history?limit=10&search=current_database" \
  | jq -e '. | type == "array" and length >= 1 and any(.queryText | ascii_downcase | contains("current_database"))' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d '{"sql":"select current_database() as database_name"}' \
  "${api_base}/sessions/database/${session_id}/explain" \
  | jq -e '.supported == true and .format == "json"' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d '{"type":"database_version"}' \
  "${api_base}/sessions/database/${session_id}/introspect" \
  | jq -e '.supported == true and (.data.version | type == "string")' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d "{\"type\":\"table_schema\",\"target\":\"${sample_postgres_table}\"}" \
  "${api_base}/sessions/database/${session_id}/introspect" \
  | jq -e '.supported == true and (.data | length > 0)' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/sessions/database/${session_id}/schema" \
  | jq -e '.tables | length > 0' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d '{}' \
  "${api_base}/sessions/database/${session_id}/end" \
  | jq -e '.ok == true' >/dev/null

echo '7.0 /api/db-audit logs/connections/users'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/db-audit/logs?limit=10&connectionId=${connection_id}&queryType=SELECT" \
  | jq -e --arg connection_id "${connection_id}" '
    .data | type == "array"
    and length >= 1
    and any(.connectionId == $connection_id and .queryType == "SELECT")
  ' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/db-audit/logs/connections" \
  | jq -e --arg connection_id "${connection_id}" 'type == "array" and any(.id == $connection_id)' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/db-audit/logs/users" \
  | jq -e --arg user_id "${user_id}" 'type == "array" and any(.id == $user_id)' >/dev/null

echo '7.0.1 /api/db-audit policy reads'
db_firewall_rule_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X POST \
  -d "{\"name\":\"acceptance-firewall-${acceptance_suffix}\",\"pattern\":\"DROP[[:space:]]+TABLE\",\"action\":\"ALERT\",\"scope\":\"public\",\"description\":\"go-readback\",\"enabled\":true,\"priority\":10}" \
  "${api_base}/db-audit/firewall-rules")"
db_firewall_rule_id="$(printf '%s' "${db_firewall_rule_json}" | jq -r '.id')"
[[ -n "${db_firewall_rule_id}" && "${db_firewall_rule_id}" != "null" ]]

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/db-audit/firewall-rules" \
  | jq -e --arg id "${db_firewall_rule_id}" 'type == "array" and any(.id == $id and .action == "ALERT")' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/db-audit/firewall-rules/${db_firewall_rule_id}" \
  | jq -e --arg id "${db_firewall_rule_id}" '.id == $id and .scope == "public" and .priority == 10' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d '{"action":"BLOCK","priority":11,"description":"go-updated"}' \
  "${api_base}/db-audit/firewall-rules/${db_firewall_rule_id}" \
  | jq -e --arg id "${db_firewall_rule_id}" '.id == $id and .action == "BLOCK" and .priority == 11 and .description == "go-updated"' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/db-audit/firewall-rules" \
  | jq -e --arg id "${db_firewall_rule_id}" 'type == "array" and any(.id == $id and .action == "BLOCK" and .priority == 11)' >/dev/null

db_masking_policy_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X POST \
  -d "{\"name\":\"acceptance-masking-${acceptance_suffix}\",\"columnPattern\":\"password\",\"strategy\":\"REDACT\",\"exemptRoles\":[\"OWNER\"],\"scope\":\"public\",\"description\":\"go-readback\",\"enabled\":true}" \
  "${api_base}/db-audit/masking-policies")"
db_masking_policy_id="$(printf '%s' "${db_masking_policy_json}" | jq -r '.id')"
[[ -n "${db_masking_policy_id}" && "${db_masking_policy_id}" != "null" ]]

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/db-audit/masking-policies" \
  | jq -e --arg id "${db_masking_policy_id}" 'type == "array" and any(.id == $id and .strategy == "REDACT")' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/db-audit/masking-policies/${db_masking_policy_id}" \
  | jq -e --arg id "${db_masking_policy_id}" '.id == $id and .scope == "public" and (.exemptRoles | index("OWNER") != null)' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d '{"strategy":"HASH","description":"go-updated","exemptRoles":["ADMIN"]}' \
  "${api_base}/db-audit/masking-policies/${db_masking_policy_id}" \
  | jq -e --arg id "${db_masking_policy_id}" '.id == $id and .strategy == "HASH" and .description == "go-updated" and (.exemptRoles | index("ADMIN") != null)' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/db-audit/masking-policies" \
  | jq -e --arg id "${db_masking_policy_id}" 'type == "array" and any(.id == $id and .strategy == "HASH")' >/dev/null

existing_acceptance_rate_limit_ids="$(
  curl --silent --show-error --fail \
    --cacert "${ca_cert}" \
    -H "authorization: Bearer ${access_token}" \
    "${api_base}/db-audit/rate-limit-policies" \
    | jq -r '.[] | select((((.name | startswith("acceptance-rate-limit-")) or (.name == "acceptance-rate-limit")) and (.queryType == "SELECT") and (.scope == "public"))) | .id'
)"
if [[ -n "${existing_acceptance_rate_limit_ids}" ]]; then
  while IFS= read -r existing_rate_limit_id; do
    [[ -z "${existing_rate_limit_id}" ]] && continue
    curl --silent --show-error --fail \
      --cacert "${ca_cert}" \
      -H "authorization: Bearer ${access_token}" \
      -X DELETE \
      "${api_base}/db-audit/rate-limit-policies/${existing_rate_limit_id}" \
      | jq -e '.ok == true' >/dev/null
  done <<< "${existing_acceptance_rate_limit_ids}"
fi

db_rate_limit_policy_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X POST \
  -d "{\"name\":\"acceptance-rate-limit-${acceptance_suffix}\",\"queryType\":\"SELECT\",\"windowMs\":60000,\"maxQueries\":25,\"burstMax\":5,\"exemptRoles\":[\"OWNER\"],\"scope\":\"public\",\"action\":\"LOG_ONLY\",\"enabled\":true,\"priority\":7}" \
  "${api_base}/db-audit/rate-limit-policies")"
db_rate_limit_policy_id="$(printf '%s' "${db_rate_limit_policy_json}" | jq -r '.id')"
[[ -n "${db_rate_limit_policy_id}" && "${db_rate_limit_policy_id}" != "null" ]]

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/db-audit/rate-limit-policies" \
  | jq -e --arg id "${db_rate_limit_policy_id}" 'type == "array" and any(.id == $id and .action == "LOG_ONLY")' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/db-audit/rate-limit-policies/${db_rate_limit_policy_id}" \
  | jq -e --arg id "${db_rate_limit_policy_id}" '.id == $id and .queryType == "SELECT" and .burstMax == 5 and .priority == 7' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d '{"queryType":"UPDATE","burstMax":6,"priority":8,"action":"REJECT"}' \
  "${api_base}/db-audit/rate-limit-policies/${db_rate_limit_policy_id}" \
  | jq -e --arg id "${db_rate_limit_policy_id}" '.id == $id and .queryType == "UPDATE" and .burstMax == 6 and .priority == 8 and .action == "REJECT"' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/db-audit/rate-limit-policies" \
  | jq -e --arg id "${db_rate_limit_policy_id}" 'type == "array" and any(.id == $id and .queryType == "UPDATE" and .action == "REJECT")' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -X DELETE \
  "${api_base}/db-audit/firewall-rules/${db_firewall_rule_id}" \
  | jq -e '.ok == true' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/db-audit/firewall-rules" \
  | jq -e --arg id "${db_firewall_rule_id}" 'type == "array" and all(.id != $id)' >/dev/null
db_firewall_rule_id=""

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -X DELETE \
  "${api_base}/db-audit/masking-policies/${db_masking_policy_id}" \
  | jq -e '.ok == true' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/db-audit/masking-policies" \
  | jq -e --arg id "${db_masking_policy_id}" 'type == "array" and all(.id != $id)' >/dev/null
db_masking_policy_id=""

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -X DELETE \
  "${api_base}/db-audit/rate-limit-policies/${db_rate_limit_policy_id}" \
  | jq -e '.ok == true' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/db-audit/rate-limit-policies" \
  | jq -e --arg id "${db_rate_limit_policy_id}" 'type == "array" and all(.id != $id)' >/dev/null
db_rate_limit_policy_id=""

echo '7.1 admin terminate database session'
terminated_session_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d "{\"connectionId\":\"${connection_id}\"}" \
  "${api_base}/sessions/database")"
terminated_session_id="$(printf '%s' "${terminated_session_json}" | jq -r '.sessionId')"
[[ -n "${terminated_session_id}" && "${terminated_session_id}" != "null" ]]

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d '{}' \
  "${api_base}/sessions/${terminated_session_id}/terminate" \
  | jq -e --arg id "${terminated_session_id}" '.ok == true and .sessionId == $id and .terminated == true' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/sessions/active?protocol=DATABASE" \
  | jq -e --arg id "${terminated_session_id}" 'map(select(.id == $id)) | length == 0' >/dev/null

terminated_session_id=""

echo '7. public desktop broker flow'
guacd_gateway_id="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/gateways" \
  | jq -r '(map(select(.type == "GUACD")) | ((map(select((.tunnelEnabled // false) == false))[0]) // .[0]).id) // empty')"
[[ -n "${guacd_gateway_id}" ]]

create_rdp_connection_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d "{\"name\":\"${rdp_connection_name}\",\"type\":\"RDP\",\"host\":\"rdp.invalid\",\"port\":3389,\"username\":\"acceptance\",\"password\":\"acceptance\",\"gatewayId\":\"${guacd_gateway_id}\",\"rdpSettings\":{\"ignoreCert\":true}}" \
  "${api_base}/connections")"
rdp_connection_id="$(printf '%s' "${create_rdp_connection_json}" | jq -r '.id')"
[[ -n "${rdp_connection_id}" && "${rdp_connection_id}" != "null" ]]

echo '7.0.1 public rdgw config/status/rdpfile flow'
rdgw_original_config_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/rdgw/config")"
printf '%s' "${rdgw_original_config_json}" | jq -e 'has("enabled") and has("externalHostname") and has("port") and has("idleTimeoutSeconds")' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d '{"enabled":true,"externalHostname":"rdgw.acceptance.local","port":443,"idleTimeoutSeconds":1800}' \
  "${api_base}/rdgw/config" \
  | jq -e '.enabled == true and .externalHostname == "rdgw.acceptance.local" and .port == 443 and .idleTimeoutSeconds == 1800' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/rdgw/status" \
  | jq -e '.activeTunnels >= 0 and .activeChannels >= 0' >/dev/null

rdp_file_content="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/rdgw/connections/${rdp_connection_id}/rdpfile")"
printf '%s' "${rdp_file_content}" | rg 'gatewayhostname:s:rdgw\.acceptance\.local:443' >/dev/null
printf '%s' "${rdp_file_content}" | rg 'full address:s:rdp\.invalid:3389' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X PUT \
  -d "${rdgw_original_config_json}" \
  "${api_base}/rdgw/config" >/dev/null
rdgw_original_config_json=""

create_rdp_session_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d "{\"connectionId\":\"${rdp_connection_id}\"}" \
  "${api_base}/sessions/rdp")"
rdp_session_id="$(printf '%s' "${create_rdp_session_json}" | jq -r '.sessionId')"
rdp_token="$(printf '%s' "${create_rdp_session_json}" | jq -r '.token')"
[[ -n "${rdp_session_id}" && "${rdp_session_id}" != "null" ]]
[[ -n "${rdp_token}" && "${rdp_token}" != "null" ]]

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d '{}' \
  "${api_base}/sessions/rdp/${rdp_session_id}/heartbeat" \
  | jq -e '.ok == true' >/dev/null

NODE_TLS_REJECT_UNAUTHORIZED=0 RDP_TOKEN="${rdp_token}" node <<'NODE'
const WebSocketCtor = globalThis.WebSocket || require('undici').WebSocket || require('ws');
const url = new URL('wss://localhost:3000/guacamole/');
url.searchParams.set('token', process.env.RDP_TOKEN);
let opened = false;
const timeout = setTimeout(() => {
  console.error('desktop broker websocket timed out');
  process.exit(1);
}, 20000);

const ws = new WebSocketCtor(url);

ws.onopen = () => {
  opened = true;
};

ws.onmessage = () => {
  clearTimeout(timeout);
  ws.close();
};

ws.onclose = () => {
  clearTimeout(timeout);
  process.exit(opened ? 0 : 1);
};

ws.onerror = (event) => {
  if (!opened) {
    clearTimeout(timeout);
    console.error(event.error?.message || 'desktop broker socket error');
    process.exit(1);
  }
};
NODE

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -d '{}' \
  "${api_base}/sessions/rdp/${rdp_session_id}/end" \
  | jq -e '.ok == true' >/dev/null

echo '7.0.2 /api/audit gateways/countries/tenant geo'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/audit/gateways" \
  | jq -e 'type == "array"' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/audit/countries" \
  | jq -e 'type == "array"' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/audit/tenant/gateways" \
  | jq -e 'type == "array"' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/audit/tenant/countries" \
  | jq -e 'type == "array"' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/audit/tenant/geo-summary?days=30" \
  | jq -e '.points | type == "array"' >/dev/null

echo '7.0.2.1 /api/audit list/tenant/connection'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/audit?limit=10" \
  | jq -e '.data | type == "array"' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/audit/tenant?limit=10" \
  | jq -e '.data | type == "array"' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/audit/connection/${connection_id}?limit=10" \
  | jq -e --arg connection_id "${connection_id}" '.data | type == "array" and length >= 1 and any(.targetId == $connection_id)' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/audit/connection/${connection_id}/users" \
  | jq -e --arg user_id "${user_id}" 'type == "array" and any(.id == $user_id)' >/dev/null

echo '7.0.3 /api/geoip/{ip}'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/geoip/8.8.8.8" \
  | jq -e '
    .query == "8.8.8.8"
    and (
      (.status == "success" and (.country | type == "string" and length > 0))
      or
      (.status == "fail" and .message == "GeoIP lookup unavailable in this environment")
    )
  ' >/dev/null

echo '7.0.4 /api/ldap/status'
ldap_status_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/ldap/status")"
printf '%s' "${ldap_status_json}" | jq -e '
    has("enabled")
    and has("providerName")
    and has("serverUrl")
    and has("baseDn")
    and has("syncEnabled")
    and has("syncCron")
    and has("autoProvision")
  ' >/dev/null

echo '7.0.4.1 /api/ldap/test'
ldap_test_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -X POST \
  "${api_base}/ldap/test")"
if [[ "$(printf '%s' "${ldap_status_json}" | jq -r '.enabled')" == "true" ]]; then
  printf '%s' "${ldap_test_json}" | jq -e '.ok | type == "boolean"' >/dev/null
else
  printf '%s' "${ldap_test_json}" | jq -e '.ok == false and (.message | test("not enabled"; "i"))' >/dev/null
fi

echo '7.0.4.2 /api/ldap/sync'
ldap_sync_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -X POST \
  "${api_base}/ldap/sync")"
if [[ "$(printf '%s' "${ldap_status_json}" | jq -r '.enabled')" == "true" ]]; then
  printf '%s' "${ldap_sync_json}" | jq -e '
    (.created | type == "number")
    and (.updated | type == "number")
    and (.disabled | type == "number")
    and (.errors | type == "array")
  ' >/dev/null
else
  printf '%s' "${ldap_sync_json}" | jq -e '
    .created == 0
    and .updated == 0
    and .disabled == 0
    and (.errors | type == "array" and length >= 1)
  ' >/dev/null
fi

echo '7.0.5 /api/recordings list/get/stream/analyze/video/audit-trail/delete'
seed_recording_id="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
seed_recording_session_id="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
seed_recording_audit_id="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
seed_guac_recording_id="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
seed_guac_recording_session_id="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
seed_recording_file_path="/recordings/acceptance-${seed_recording_id}.cast"
seed_guac_recording_file_path="/recordings/acceptance-${seed_guac_recording_id}.guac"
recording_stream_expected="$(mktemp)"
recording_stream_downloaded="$(mktemp)"
recording_video_output="$(mktemp)"
recording_video_headers="$(mktemp)"

cat > "${recording_stream_expected}" <<'EOF'
{"version":2,"width":80,"height":24,"timestamp":1700000000,"env":{"TERM":"xterm-256color"}}
[0.0,"o","hello from acceptance\r\n"]
EOF

"${container_runtime}" exec arsenale-control-plane-api sh -lc "cat > '${seed_recording_file_path}' <<'EOF'
{\"version\":2,\"width\":80,\"height\":24,\"timestamp\":1700000000,\"env\":{\"TERM\":\"xterm-256color\"}}
[0.0,\"o\",\"hello from acceptance\\r\\n\"]
EOF"

"${container_runtime}" exec arsenale-control-plane-api sh -lc "cat > '${seed_guac_recording_file_path}' <<'EOF'
4.size,1.0,2.80,2.24;
4.sync,1.0;
EOF"

"${container_runtime}" exec \
  -e PGPASSWORD="${postgres_password}" \
  arsenale-postgres \
  psql -U "${db_user}" -d "${db_name}" -c \
  "INSERT INTO \"SessionRecording\" (id, \"sessionId\", \"userId\", \"connectionId\", protocol, \"filePath\", \"fileSize\", duration, width, height, format, status, \"createdAt\", \"completedAt\") VALUES ('${seed_recording_id}', '${seed_recording_session_id}', '${user_id}', '${ssh_connection_id}', 'SSH', '${seed_recording_file_path}', 128, 12, 80, 24, 'asciicast', 'COMPLETE', NOW(), NOW()); INSERT INTO \"SessionRecording\" (id, \"sessionId\", \"userId\", \"connectionId\", protocol, \"filePath\", \"fileSize\", duration, width, height, format, status, \"createdAt\", \"completedAt\") VALUES ('${seed_guac_recording_id}', '${seed_guac_recording_session_id}', '${user_id}', '${ssh_connection_id}', 'RDP', '${seed_guac_recording_file_path}', 64, 3, 80, 24, 'guac', 'COMPLETE', NOW(), NOW()); INSERT INTO \"AuditLog\" (id, \"userId\", action, \"targetType\", \"targetId\", details, \"createdAt\") VALUES ('${seed_recording_audit_id}', '${user_id}', 'SESSION_START', 'Recording', '${seed_recording_id}', '{\"sessionId\":\"${seed_recording_session_id}\",\"recordingId\":\"${seed_recording_id}\"}'::jsonb, NOW());" \
  >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/recordings?limit=20&offset=0" \
  | jq -e --arg id "${seed_recording_id}" '.recordings | map(select(.id == $id and .protocol == "SSH" and .format == "asciicast")) | length == 1' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/recordings/${seed_recording_id}" \
  | jq -e --arg id "${seed_recording_id}" --arg connection_id "${ssh_connection_id}" '.id == $id and .connectionId == $connection_id and .status == "COMPLETE"' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/audit/session/${seed_recording_session_id}/recording" \
  | jq -e --arg id "${seed_recording_id}" --arg session_id "${seed_recording_session_id}" --arg connection_id "${ssh_connection_id}" '.id == $id and .sessionId == $session_id and .connectionId == $connection_id and .connection.id == $connection_id and .status == "COMPLETE"' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  --output "${recording_stream_downloaded}" \
  "${api_base}/recordings/${seed_recording_id}/stream"

cmp -s "${recording_stream_expected}" "${recording_stream_downloaded}"

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/recordings/${seed_guac_recording_id}/analyze" \
  | jq -e '.fileSize > 0 and .truncated == false and .instructions.size == 1 and .instructions.sync == 1 and .syncCount == 1 and .displayWidth == 80 and .displayHeight == 24 and .hasLayer0Image == false' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -D "${recording_video_headers}" \
  --output "${recording_video_output}" \
  "${api_base}/recordings/${seed_recording_id}/video"

grep -qi '^content-type: video/mp4' "${recording_video_headers}"
[[ -s "${recording_video_output}" ]]

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/recordings/${seed_recording_id}/audit-trail" \
  | jq -e --arg id "${seed_recording_id}" '.data | type == "array" and any(.details.recordingId == $id)' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -X DELETE \
  "${api_base}/recordings/${seed_recording_id}" \
  | jq -e '.ok == true' >/dev/null
seed_recording_id=""

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -X DELETE \
  "${api_base}/recordings/${seed_guac_recording_id}" \
  | jq -e '.ok == true' >/dev/null
seed_guac_recording_id=""

rm -f "${recording_stream_expected}" "${recording_stream_downloaded}" "${recording_video_output}" "${recording_video_headers}"
seed_recording_file_path=""
seed_guac_recording_file_path=""

echo '7.0.6 /api/vault/lock'
curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  -H 'content-type: application/json' \
  -X POST \
  "${api_base}/vault/lock" \
  | jq -e '.unlocked == false' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -H "authorization: Bearer ${access_token}" \
  "${api_base}/vault/status" \
  | jq -e '.unlocked == false and (.vaultNeedsRecovery | type == "boolean") and (.mfaUnlockMethods | type == "array")' >/dev/null

echo '8. public auth logout flow'
clear_login_rate_limits
cookie_jar="$(mktemp)"
logout_login_json="$(curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -c "${cookie_jar}" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${admin_email}\",\"password\":\"${admin_password}\"}" \
  "${api_base}/auth/login")"
printf '%s' "${logout_login_json}" | jq -e '.accessToken | type == "string"' >/dev/null

curl --silent --show-error --fail \
  --cacert "${ca_cert}" \
  -b "${cookie_jar}" \
  -c "${cookie_jar}" \
  -H 'content-type: application/json' \
  -X POST \
  "${api_base}/auth/logout" \
  | jq -e '.success == true' >/dev/null

logout_refresh_code="$(curl --silent --show-error --output /tmp/arsenale-auth-refresh-after-logout.json --write-out '%{http_code}' \
  --cacert "${ca_cert}" \
  -b "${cookie_jar}" \
  -c "${cookie_jar}" \
  -H 'content-type: application/json' \
  -X POST \
  "${api_base}/auth/refresh")"
[[ "${logout_refresh_code}" == "403" ]]
jq -e '.error == "CSRF token missing"' /tmp/arsenale-auth-refresh-after-logout.json >/dev/null

rm -f "${cookie_jar}"

echo 'acceptance-ok'
