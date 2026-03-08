#!/usr/bin/env bash
# Detect available container runtime (docker or podman)
# Usage: source this script or call it to get the runtime command
#   $(./scripts/container-runtime.sh) compose -f docker-compose.dev.yml up -d

if command -v docker &>/dev/null; then
  echo "docker"
elif command -v podman &>/dev/null; then
  echo "podman"
else
  echo "Error: neither docker nor podman found. Please install one of them." >&2
  exit 1
fi
