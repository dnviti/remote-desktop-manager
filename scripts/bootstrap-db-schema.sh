#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SCHEMA_FILE="${ARSENALE_SCHEMA_FILE:-$PROJECT_ROOT/backend/schema/bootstrap.sql}"
POSTGRES_CONTAINER="${ARSENALE_POSTGRES_CONTAINER:-arsenale-postgres}"
DB_USER="${ARSENALE_DB_USER:-}"
DB_NAME="${ARSENALE_DB_NAME:-}"

detect_runtime() {
  if [[ -n "${CONTAINER_RUNTIME:-}" ]]; then
    printf '%s\n' "$CONTAINER_RUNTIME"
    return 0
  fi
  if command -v podman >/dev/null 2>&1; then
    printf 'podman\n'
    return 0
  fi
  if command -v docker >/dev/null 2>&1; then
    printf 'docker\n'
    return 0
  fi
  printf 'No supported container runtime found (podman/docker).\n' >&2
  return 1
}

RUNTIME="$(detect_runtime)"

if [[ ! -f "$SCHEMA_FILE" ]]; then
  printf 'Schema bootstrap file not found: %s\n' "$SCHEMA_FILE" >&2
  exit 1
fi

container_exec() {
  "$RUNTIME" exec \
    -e "ARSENALE_DB_USER=$DB_USER" \
    -e "ARSENALE_DB_NAME=$DB_NAME" \
    "$POSTGRES_CONTAINER" \
    sh -lc "$1"
}

ensure_gateway_deployment_mode_schema() {
  "$RUNTIME" exec -i \
    -e "ARSENALE_DB_USER=$DB_USER" \
    -e "ARSENALE_DB_NAME=$DB_NAME" \
    "$POSTGRES_CONTAINER" \
    sh -lc '
      db_user=${ARSENALE_DB_USER:-${POSTGRES_USER:-arsenale}}
      db_name=${ARSENALE_DB_NAME:-${POSTGRES_DB:-arsenale}}
      export PGPASSWORD="$(cat "${POSTGRES_PASSWORD_FILE:-/run/secrets/postgres_password}")"
      psql -v ON_ERROR_STOP=1 -U "$db_user" -d "$db_name"
    ' <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'GatewayDeploymentMode'
  ) THEN
    CREATE TYPE public."GatewayDeploymentMode" AS ENUM ('SINGLE_INSTANCE', 'MANAGED_GROUP');
  END IF;
END $$;

ALTER TABLE public."Gateway"
  ADD COLUMN IF NOT EXISTS "deploymentMode" public."GatewayDeploymentMode"
  DEFAULT 'SINGLE_INSTANCE' NOT NULL;

ALTER TABLE public."GatewayTemplate"
  ADD COLUMN IF NOT EXISTS "deploymentMode" public."GatewayDeploymentMode"
  DEFAULT 'SINGLE_INSTANCE' NOT NULL;

UPDATE public."Gateway"
SET "deploymentMode" = CASE
  WHEN type = 'SSH_BASTION'::public."GatewayType" THEN 'SINGLE_INSTANCE'::public."GatewayDeploymentMode"
  WHEN "isManaged" THEN 'MANAGED_GROUP'::public."GatewayDeploymentMode"
  ELSE 'SINGLE_INSTANCE'::public."GatewayDeploymentMode"
END;

UPDATE public."GatewayTemplate"
SET "deploymentMode" = CASE
  WHEN type = 'SSH_BASTION'::public."GatewayType" THEN 'SINGLE_INSTANCE'::public."GatewayDeploymentMode"
  WHEN COALESCE(BTRIM(host), '') = '' THEN 'MANAGED_GROUP'::public."GatewayDeploymentMode"
  ELSE 'SINGLE_INSTANCE'::public."GatewayDeploymentMode"
END;
SQL
}

for _ in $(seq 1 30); do
  if container_exec '
    db_user=${ARSENALE_DB_USER:-${POSTGRES_USER:-arsenale}}
    db_name=${ARSENALE_DB_NAME:-${POSTGRES_DB:-arsenale}}
    export PGPASSWORD="$(cat "${POSTGRES_PASSWORD_FILE:-/run/secrets/postgres_password}")"
    pg_isready -U "$db_user" -d "$db_name" >/dev/null 2>&1
  '; then
    break
  fi
  sleep 2
done

if ! container_exec '
  db_user=${ARSENALE_DB_USER:-${POSTGRES_USER:-arsenale}}
  db_name=${ARSENALE_DB_NAME:-${POSTGRES_DB:-arsenale}}
  export PGPASSWORD="$(cat "${POSTGRES_PASSWORD_FILE:-/run/secrets/postgres_password}")"
  pg_isready -U "$db_user" -d "$db_name" >/dev/null 2>&1
'; then
  printf 'PostgreSQL is not ready in container %s.\n' "$POSTGRES_CONTAINER" >&2
  exit 1
fi

schema_present="$(container_exec '
  db_user=${ARSENALE_DB_USER:-${POSTGRES_USER:-arsenale}}
  db_name=${ARSENALE_DB_NAME:-${POSTGRES_DB:-arsenale}}
  export PGPASSWORD="$(cat "${POSTGRES_PASSWORD_FILE:-/run/secrets/postgres_password}")"
  psql -U "$db_user" -d "$db_name" -Atqc "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '\''public'\'' AND table_name = '\''User'\'');"
')"

if [[ "$schema_present" == "t" ]]; then
  ensure_gateway_deployment_mode_schema
  printf 'schema-bootstrap: already-present (%s)\n' "${DB_NAME:-default}"
  exit 0
fi

"$RUNTIME" exec -i \
  -e "ARSENALE_DB_USER=$DB_USER" \
  -e "ARSENALE_DB_NAME=$DB_NAME" \
  "$POSTGRES_CONTAINER" \
  sh -lc '
    db_user=${ARSENALE_DB_USER:-${POSTGRES_USER:-arsenale}}
    db_name=${ARSENALE_DB_NAME:-${POSTGRES_DB:-arsenale}}
    export PGPASSWORD="$(cat "${POSTGRES_PASSWORD_FILE:-/run/secrets/postgres_password}")"
    psql -v ON_ERROR_STOP=1 -U "$db_user" -d "$db_name"
  ' < "$SCHEMA_FILE"

ensure_gateway_deployment_mode_schema

printf 'schema-bootstrap: applied (%s)\n' "${DB_NAME:-default}"
