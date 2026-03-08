#!/bin/bash
# Install SELinux policy module for Podman rootless on Fedora 43+
# Fixes nnp_transition denials for container_runtime_t and pasta_t
#
# Usage: sudo bash install.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODULE="arsenale-podman"

cd "$SCRIPT_DIR"

echo "Compiling SELinux policy module..."
checkmodule -M -m -o "${MODULE}.mod" "${MODULE}.te"

echo "Packaging policy module..."
semodule_package -o "${MODULE}.pp" -m "${MODULE}.mod"

echo "Installing policy module..."
semodule -X 300 -i "${MODULE}.pp"

echo "Cleaning up build artifacts..."
rm -f "${MODULE}.mod" "${MODULE}.pp"

echo "Done. Policy module '${MODULE}' installed."
echo "Verify with: semodule -l | grep ${MODULE}"
