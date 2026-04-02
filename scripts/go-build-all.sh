#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)

run_module() {
  local label="$1"
  local dir="$2"
  shift 2

  echo "==> $label"
  (
    cd "$REPO_ROOT/$dir"
    "$@"
  )
}

run_module "backend build" "backend" go build ./...
run_module "gateway-core build" "gateways/gateway-core" go build ./...
run_module "db-proxy build" "gateways/db-proxy" env GOWORK=off go build ./...
run_module "guacenc build" "gateways/guacenc" go build ./...
run_module "rdgw build" "gateways/rdgw" go build ./...
run_module "ssh-gateway grpc build" "gateways/ssh-gateway/grpc-server" go build ./...
run_module "arsenale-cli build" "tools/arsenale-cli" go build ./...
