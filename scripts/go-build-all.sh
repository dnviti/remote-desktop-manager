#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
BUILD_DIR="$REPO_ROOT/build/go"

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

build_binary() {
  local label="$1"
  local dir="$2"
  local output_name="$3"
  local package_path="$4"
  shift 4

  run_module "$label" "$dir" "$@" go build -o "$BUILD_DIR/$output_name" "$package_path"
}

mkdir -p "$BUILD_DIR"

run_module "backend package build" "backend" go build ./...
for cmd_dir in "$REPO_ROOT"/backend/cmd/*; do
  [ -d "$cmd_dir" ] || continue
  cmd_name=$(basename "$cmd_dir")
  build_binary "backend binary build ($cmd_name)" "backend" "$cmd_name" "./cmd/$cmd_name"
done

run_module "gateway-core build" "gateways/gateway-core" go build ./...
build_binary "tunnel-agent build" "gateways/tunnel-agent" "tunnel-agent" "."
run_module "db-proxy package build" "gateways/db-proxy" env GOWORK=off go build ./...
build_binary "guacenc build" "gateways/guacenc" "guacenc" "."
build_binary "rdgw build" "gateways/rdgw" "rdgw" "."
build_binary "ssh-gateway grpc build" "gateways/ssh-gateway/grpc-server" "ssh-gateway-grpc-server" "." env GOWORK=off
build_binary "arsenale-cli build" "tools/arsenale-cli" "arsenale-cli" "."
