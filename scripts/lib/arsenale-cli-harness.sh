#!/usr/bin/env bash

arsenale_cli_default_bin() {
  local repo_root="$1"
  printf '%s/build/go/arsenale-cli' "${repo_root}"
}

arsenale_cli_ensure_built() {
  local repo_root="$1"
  local cli_bin="$2"

  mkdir -p "$(dirname "${cli_bin}")"
  go build -o "${cli_bin}" "${repo_root}/tools/arsenale-cli"
}

arsenale_cli_run() {
  local cli_bin="$1"
  local server_url="$2"
  shift 2

  "${cli_bin}" --server "${server_url}" "$@"
}

arsenale_cli_user_agent() {
  local cli_bin="$1"
  local version

  version="$("${cli_bin}" version | awk '{print $2}')"
  version="${version#v}"
  if [[ -z "${version}" ]]; then
    version="0.0.0"
  fi

  printf 'arsenale-cli/%s' "${version}"
}

arsenale_cli_seed_auth() {
  local server_url="$1"
  local access_token="$2"
  local tenant_id="$3"
  local config_dir="${ARSENALE_CLI_CONFIG_DIR:-$HOME/.arsenale}"
  local config_path="${config_dir}/config.yaml"
  local token_expiry

  token_expiry="$(date -u -d '+14 minutes' '+%Y-%m-%dT%H:%M:%SZ')"
  mkdir -p "${config_dir}"
  chmod 700 "${config_dir}" 2>/dev/null || true
  {
    printf 'server_url: %s\n' "${server_url}"
    printf 'access_token: %s\n' "${access_token}"
    printf 'token_expiry: %s\n' "${token_expiry}"
    printf 'tenant_id: %s\n' "${tenant_id}"
    printf 'cache_ttl: 5m\n'
  } > "${config_path}"
  chmod 600 "${config_path}" 2>/dev/null || true
}

arsenale_cli_smoke_core() {
  local repo_root="$1"
  local cli_bin="$2"
  local server_url="$3"

  arsenale_cli_ensure_built "${repo_root}" "${cli_bin}"
  arsenale_cli_run "${cli_bin}" "${server_url}" health >/dev/null
  arsenale_cli_run "${cli_bin}" "${server_url}" whoami >/dev/null
}

arsenale_cli_smoke_inventory() {
  local repo_root="$1"
  local cli_bin="$2"
  local server_url="$3"

  arsenale_cli_smoke_core "${repo_root}" "${cli_bin}" "${server_url}"
  arsenale_cli_run "${cli_bin}" "${server_url}" connection list -o json >/dev/null
  arsenale_cli_run "${cli_bin}" "${server_url}" gateway list -o json >/dev/null
  arsenale_cli_run "${cli_bin}" "${server_url}" session list -o json >/dev/null
}
