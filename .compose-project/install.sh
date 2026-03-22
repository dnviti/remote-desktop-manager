#!/usr/bin/env bash
# =============================================================================
# Arsenale — Production Install Script
# =============================================================================
#
# This script prepares everything needed to run Arsenale in production:
#   1. Checks that Docker and Docker Compose are installed
#   2. Clones the Arsenale source code (needed to build container images)
#   3. Generates cryptographic secrets and writes them to .env
#   4. Creates required directories and placeholder files
#   5. Builds and starts all containers
#   6. Waits for health checks and prints the access URL
#
# Usage:
#   chmod +x install.sh
#   ./install.sh
#
# Options:
#   --no-start    Set up everything but don't start the containers
#   --branch TAG  Clone a specific branch or tag (default: main)
#
# =============================================================================

set -euo pipefail

# -- Configuration -----------------------------------------------------------

REPO_URL="https://github.com/dnviti/arsenale.git"
REPO_DIR="./arsenale"
ENV_FILE="./.env"
BRANCH="main"
START=true

# -- Parse arguments ---------------------------------------------------------

while [[ $# -gt 0 ]]; do
    case "$1" in
        --no-start) START=false; shift ;;
        --branch)   BRANCH="$2"; shift 2 ;;
        *)          echo "Unknown option: $1"; exit 1 ;;
    esac
done

# -- Helpers -----------------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No color

info()    { echo -e "${CYAN}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERR]${NC}  $*" >&2; }

generate_secret() {
    # Generate a 32-byte hex secret (64 characters)
    openssl rand -hex 32
}

generate_password() {
    # Generate a 24-byte base64 password (URL-safe, no special chars)
    openssl rand -base64 24 | tr -d '/+=' | head -c 32
}

# -- Step 1: Check prerequisites --------------------------------------------

info "Checking prerequisites..."

# Check Docker
if ! command -v docker &>/dev/null; then
    error "Docker is not installed."
    echo ""
    echo "Install Docker with:"
    echo "  curl -fsSL https://get.docker.com | sh"
    echo "  sudo usermod -aG docker \$USER"
    echo "  newgrp docker"
    echo ""
    exit 1
fi
success "Docker found: $(docker --version)"

# Check Docker Compose (V2 plugin)
if docker compose version &>/dev/null; then
    success "Docker Compose found: $(docker compose version --short)"
elif command -v docker-compose &>/dev/null; then
    warn "Found docker-compose (V1). Docker Compose V2 is recommended."
    warn "Install V2: sudo apt install docker-compose-plugin"
else
    error "Docker Compose is not installed."
    echo ""
    echo "Install Docker Compose V2:"
    echo "  sudo apt install docker-compose-plugin"
    echo ""
    exit 1
fi

# Check openssl
if ! command -v openssl &>/dev/null; then
    error "openssl is not installed (needed for secret generation)."
    echo "  sudo apt install openssl"
    exit 1
fi
success "openssl found"

echo ""

# -- Step 2: Clone the repository -------------------------------------------

if [ -d "$REPO_DIR" ]; then
    info "Arsenale source already exists at $REPO_DIR"
    info "Pulling latest changes (branch: $BRANCH)..."
    cd "$REPO_DIR"
    git fetch origin
    git checkout "$BRANCH"
    git pull origin "$BRANCH"
    cd ..
    success "Repository updated"
else
    info "Cloning Arsenale from $REPO_URL (branch: $BRANCH)..."
    git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$REPO_DIR"
    success "Repository cloned to $REPO_DIR"
fi

echo ""

# -- Step 3: Generate secrets ------------------------------------------------

if grep -q "CHANGE_ME" "$ENV_FILE" 2>/dev/null; then
    info "Generating cryptographic secrets..."

    DB_PASSWORD=$(generate_password)
    JWT_SECRET=$(generate_secret)
    GUACAMOLE_SECRET=$(generate_secret)
    ENCRYPTION_KEY=$(generate_secret)
    GATEWAY_TOKEN=$(generate_secret)

    # Replace placeholders in .env
    # Use a temporary file for portability (works on both GNU and BSD sed)
    cp "$ENV_FILE" "${ENV_FILE}.tmp"

    sed "s|CHANGE_ME_DB_PASSWORD|${DB_PASSWORD}|g" "${ENV_FILE}.tmp" > "${ENV_FILE}.tmp2"
    mv "${ENV_FILE}.tmp2" "${ENV_FILE}.tmp"

    sed "s|CHANGE_ME_JWT_SECRET|${JWT_SECRET}|g" "${ENV_FILE}.tmp" > "${ENV_FILE}.tmp2"
    mv "${ENV_FILE}.tmp2" "${ENV_FILE}.tmp"

    sed "s|CHANGE_ME_GUACAMOLE_SECRET|${GUACAMOLE_SECRET}|g" "${ENV_FILE}.tmp" > "${ENV_FILE}.tmp2"
    mv "${ENV_FILE}.tmp2" "${ENV_FILE}.tmp"

    sed "s|CHANGE_ME_SERVER_ENCRYPTION_KEY|${ENCRYPTION_KEY}|g" "${ENV_FILE}.tmp" > "${ENV_FILE}.tmp2"
    mv "${ENV_FILE}.tmp2" "${ENV_FILE}.tmp"

    sed "s|CHANGE_ME_GATEWAY_API_TOKEN|${GATEWAY_TOKEN}|g" "${ENV_FILE}.tmp" > "${ENV_FILE}.tmp2"
    mv "${ENV_FILE}.tmp2" "${ENV_FILE}.tmp"

    mv "${ENV_FILE}.tmp" "$ENV_FILE"

    success "Secrets generated and written to .env"
    echo ""
    echo "  Database password : ${DB_PASSWORD:0:8}..."
    echo "  JWT secret        : ${JWT_SECRET:0:8}..."
    echo "  Guacamole secret  : ${GUACAMOLE_SECRET:0:8}..."
    echo "  Encryption key    : ${ENCRYPTION_KEY:0:8}..."
    echo "  Gateway API token : ${GATEWAY_TOKEN:0:8}..."
    echo ""
    warn "These secrets are stored in .env — back up this file securely!"
else
    info "Secrets already configured in .env (no CHANGE_ME placeholders found)"
fi

echo ""

# -- Step 4: Create required files and directories ---------------------------

info "Creating required directories and files..."

mkdir -p config/ssh-gateway

if [ ! -f config/ssh-gateway/authorized_keys ]; then
    touch config/ssh-gateway/authorized_keys
    success "Created config/ssh-gateway/authorized_keys (empty — add SSH public keys here)"
else
    success "config/ssh-gateway/authorized_keys already exists"
fi

echo ""

# -- Step 5: Build and start ------------------------------------------------

if [ "$START" = true ]; then
    info "Building and starting Arsenale..."
    echo "  This may take several minutes on first run (building images)."
    echo ""

    docker compose up -d --build

    echo ""
    success "Containers started!"
    echo ""

    # -- Step 6: Wait for health checks --------------------------------------

    info "Waiting for services to become healthy..."

    MAX_WAIT=120
    ELAPSED=0
    INTERVAL=5

    while [ $ELAPSED -lt $MAX_WAIT ]; do
        # Check if the client container is healthy
        CLIENT_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' arsenale-client 2>/dev/null || echo "missing")

        if [ "$CLIENT_HEALTH" = "healthy" ]; then
            echo ""
            success "All services are healthy!"
            break
        fi

        echo -n "."
        sleep $INTERVAL
        ELAPSED=$((ELAPSED + INTERVAL))
    done

    if [ $ELAPSED -ge $MAX_WAIT ]; then
        echo ""
        warn "Timed out waiting for services. Check status with:"
        echo "  docker compose ps"
        echo "  docker compose logs"
    fi

    echo ""
    echo "=============================================="
    echo ""
    echo "  Arsenale is running!"
    echo ""

    # Detect CLIENT_PORT from .env or default to 3000
    CLIENT_PORT=$(grep -E '^CLIENT_PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 || echo "3000")
    CLIENT_PORT=${CLIENT_PORT:-3000}

    # Detect host IP
    HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

    echo "  Web UI:  http://${HOST_IP}:${CLIENT_PORT}"
    echo "  SSH:     ssh -p 2222 tunnel@${HOST_IP}"
    echo ""
    echo "  First time? Register a new account in the web UI."
    echo "  The first registered user becomes the admin."
    echo ""
    echo "  Management commands:"
    echo "    ./manage.sh status    — Service health"
    echo "    ./manage.sh logs      — View all logs"
    echo "    ./manage.sh stop      — Stop all services"
    echo "    ./manage.sh backup    — Database backup"
    echo ""
    echo "=============================================="
else
    info "Setup complete (--no-start flag set)."
    echo ""
    echo "Start Arsenale with:"
    echo "  docker compose up -d --build"
fi
