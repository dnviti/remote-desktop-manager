#!/usr/bin/env bash
set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── Paths ───────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# ── Usage ───────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
${BOLD}Usage:${NC} $(basename "$0") [OPTIONS]

Security scanning for Arsenale.

${BOLD}Modes:${NC}
  --quick     npm audit + ESLint security only (fast, no container needed)
  (default)   + Trivy filesystem scan (vuln, misconfig, secret)
  --docker    + build and scan Docker images (server, client, ssh-gateway)

${BOLD}Options:${NC}
  --help, -h  Show this help message

${BOLD}Requirements:${NC}
  --quick     Node.js, npm
  (default)   + Docker or Podman
  --docker    + Docker or Podman with Docker socket access

${BOLD}Examples:${NC}
  ./scripts/security-scan.sh --quick     # Fast local check
  ./scripts/security-scan.sh             # Full filesystem scan
  ./scripts/security-scan.sh --docker    # Full scan + container images
EOF
}

# ── Argument parsing ────────────────────────────────────────────────────────
MODE="default"
for arg in "$@"; do
  case "$arg" in
    --quick)  MODE="quick" ;;
    --docker) MODE="docker" ;;
    --help|-h) usage; exit 0 ;;
    *) echo -e "${RED}Unknown argument: $arg${NC}"; usage; exit 1 ;;
  esac
done

# ── Container runtime (only needed for default and docker modes) ──────────
CONTAINER_RT=""
if [[ "$MODE" != "quick" ]]; then
  if command -v podman &>/dev/null; then
    CONTAINER_RT="podman"
  elif command -v docker &>/dev/null; then
    CONTAINER_RT="docker"
  else
    echo -e "${YELLOW}No container runtime found (podman/docker) — skipping container scans${NC}"
  fi
  [[ -n "$CONTAINER_RT" ]] && echo -e "${CYAN}Container runtime:${NC} $CONTAINER_RT"
fi

# ── Tracking ────────────────────────────────────────────────────────────────
CHECKS_RUN=0
CHECKS_PASSED=0
FAILED_CHECKS=()

print_header() {
  echo ""
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${CYAN}  $1${NC}"
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

record_result() {
  local name="$1"
  local exit_code="$2"
  CHECKS_RUN=$((CHECKS_RUN + 1))
  if [[ "$exit_code" -eq 0 ]]; then
    CHECKS_PASSED=$((CHECKS_PASSED + 1))
    echo -e "${GREEN}  PASS${NC} $name"
  else
    FAILED_CHECKS+=("$name")
    echo -e "${RED}  FAIL${NC} $name"
  fi
}

# ── Phase 1: npm audit (always) ────────────────────────────────────────────
print_header "Phase 1: npm audit (dependency vulnerabilities)"
cd "$PROJECT_ROOT"
set +e
npm audit --audit-level=critical 2>&1
AUDIT_EXIT=$?
set -e
record_result "npm audit (critical threshold)" "$AUDIT_EXIT"

# Show informational full audit
echo ""
echo -e "${YELLOW}  Informational: full audit including dev dependencies:${NC}"
npm audit 2>&1 || true

# ── Phase 2: ESLint security rules (always) ────────────────────────────────
print_header "Phase 2: ESLint security plugin"
cd "$PROJECT_ROOT"
set +e
LINT_OUTPUT=$(npm run lint 2>&1)
LINT_EXIT=$?
set -e

# Count security-specific issues
SECURITY_ISSUES=$(echo "$LINT_OUTPUT" | grep -c "security/" || true)
if [[ "$LINT_EXIT" -ne 0 ]]; then
  echo "$LINT_OUTPUT"
  echo -e "${YELLOW}  Found $SECURITY_ISSUES security-specific lint issues${NC}"
fi
record_result "ESLint (incl. security plugin)" "$LINT_EXIT"

# ── Phase 3: Trivy filesystem scan (default + docker modes) ───────────────
if [[ "$MODE" != "quick" ]]; then
  print_header "Phase 3: Trivy filesystem scan (vuln, misconfig, secret)"
  set +e
  $CONTAINER_RT run --rm \
    -v "$PROJECT_ROOT:/project:ro" \
    -v trivy-cache:/root/.cache/trivy \
    aquasec/trivy:latest fs /project \
    --scanners vuln,misconfig,secret \
    --severity HIGH,CRITICAL \
    --ignorefile /project/.trivyignore.yaml \
    --skip-dirs node_modules \
    --exit-code 1 \
    2>&1
  TRIVY_FS_EXIT=$?
  set -e
  record_result "Trivy filesystem scan" "$TRIVY_FS_EXIT"
fi

# ── Phase 4: Docker image scan (docker mode only) ─────────────────────────
if [[ "$MODE" == "docker" ]]; then
  IMAGES=(
    "server:./server/Dockerfile:."
    "client:./client/Dockerfile:."
    "ssh-gateway:./ssh-gateway/Dockerfile:./ssh-gateway"
  )

  for image_spec in "${IMAGES[@]}"; do
    IFS=: read -r name dockerfile context <<< "$image_spec"
    print_header "Phase 4: Build & scan $name image"

    echo -e "${CYAN}  Building arsenale-$name:scan ...${NC}"
    set +e
    $CONTAINER_RT build -t "arsenale-$name:scan" -f "$dockerfile" "$context" 2>&1
    BUILD_EXIT=$?
    set -e

    if [[ "$BUILD_EXIT" -ne 0 ]]; then
      echo -e "${RED}  Build failed for $name${NC}"
      record_result "Docker image build ($name)" "$BUILD_EXIT"
      continue
    fi

    echo -e "${CYAN}  Scanning arsenale-$name:scan ...${NC}"
    set +e
    $CONTAINER_RT run --rm \
      -v /var/run/docker.sock:/var/run/docker.sock \
      -v trivy-cache:/root/.cache/trivy \
      aquasec/trivy:latest image "arsenale-$name:scan" \
      --severity HIGH,CRITICAL \
      --exit-code 1 \
      2>&1
    SCAN_EXIT=$?
    set -e
    record_result "Trivy image scan ($name)" "$SCAN_EXIT"
  done
fi

# ── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}  SECURITY SCAN SUMMARY${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  Mode:    ${BOLD}$MODE${NC}"
echo -e "  Checks:  ${CHECKS_PASSED}/${CHECKS_RUN} passed"

if [[ ${#FAILED_CHECKS[@]} -gt 0 ]]; then
  echo ""
  echo -e "${RED}  Failed checks:${NC}"
  for check in "${FAILED_CHECKS[@]}"; do
    echo -e "    ${RED}✗${NC} $check"
  done
  echo ""
  echo -e "${RED}  ${BOLD}SECURITY SCAN FAILED${NC}"
  exit ${#FAILED_CHECKS[@]}
else
  echo ""
  echo -e "${GREEN}  ${BOLD}ALL CHECKS PASSED${NC}"
  exit 0
fi
