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

run_module "backend tests" "backend" go test ./...
run_module "gateway-core tests" "gateways/gateway-core" go test ./...
run_module "db-proxy tests" "gateways/db-proxy" env GOWORK=off go test ./...
run_module "guacenc tests" "gateways/guacenc" go test ./...
run_module "rdgw tests" "gateways/rdgw" go test ./...
run_module "ssh-gateway grpc tests" "gateways/ssh-gateway/grpc-server" go test ./...
run_module "arsenale-cli tests" "tools/arsenale-cli" go test ./...
