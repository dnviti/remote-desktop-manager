#!/usr/bin/env bash
# =============================================================================
# Arsenale — Management Script
# =============================================================================
#
# Usage:
#   ./manage.sh <command> [options]
#
# Commands:
#   status          Show service health and status
#   start           Start all services
#   stop            Stop all services
#   restart         Restart all services (or a specific service)
#   logs [service]  View logs (all services or a specific one)
#   update          Pull latest code and rebuild containers
#   backup          Create a PostgreSQL database backup
#   restore <file>  Restore a database backup
#   shell <service> Open a shell in a running container
#   reset           Stop all services and remove volumes (DESTROYS DATA)
#
# Examples:
#   ./manage.sh logs server         # View server logs
#   ./manage.sh restart client      # Restart only the client
#   ./manage.sh backup              # Backup database to ./backups/
#   ./manage.sh restore backups/arsenale_2025-01-15_120000.sql
#
# =============================================================================

set -euo pipefail

# -- Helpers -----------------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERR]${NC}  $*" >&2; }

# Load .env for variable defaults
ENV_FILE="./.env"
if [ -f "$ENV_FILE" ]; then
    # shellcheck disable=SC1090
    set -a; source "$ENV_FILE"; set +a
fi

# -- Commands ----------------------------------------------------------------

cmd_status() {
    info "Service status:"
    echo ""
    docker compose ps
    echo ""
    info "Health checks:"
    for svc in arsenale-postgres arsenale-guacd arsenale-guacenc arsenale-server arsenale-client arsenale-ssh-gateway; do
        status=$(docker inspect --format='{{.State.Health.Status}}' "$svc" 2>/dev/null || echo "not running")
        case "$status" in
            healthy)    echo -e "  ${GREEN}$status${NC}   $svc" ;;
            unhealthy)  echo -e "  ${RED}$status${NC} $svc" ;;
            starting)   echo -e "  ${YELLOW}$status${NC}  $svc" ;;
            *)          echo -e "  ${RED}$status${NC}  $svc" ;;
        esac
    done
    echo ""
}

cmd_start() {
    info "Starting Arsenale..."
    docker compose up -d
    success "All services started. Run './manage.sh status' to check health."
}

cmd_stop() {
    info "Stopping Arsenale..."
    docker compose down
    success "All services stopped."
}

cmd_restart() {
    local service="${1:-}"
    if [ -n "$service" ]; then
        info "Restarting $service..."
        docker compose restart "$service"
        success "$service restarted."
    else
        info "Restarting all services..."
        docker compose restart
        success "All services restarted."
    fi
}

cmd_logs() {
    local service="${1:-}"
    if [ -n "$service" ]; then
        docker compose logs -f "$service"
    else
        docker compose logs -f
    fi
}

cmd_update() {
    info "Updating Arsenale..."

    # Pull latest source code
    if [ -d "./arsenale" ]; then
        cd ./arsenale
        BRANCH=$(git rev-parse --abbrev-ref HEAD)
        info "Pulling latest changes (branch: $BRANCH)..."
        git pull origin "$BRANCH"
        cd ..
        success "Source code updated."
    else
        error "Source directory ./arsenale not found. Run install.sh first."
        exit 1
    fi

    # Rebuild and restart
    info "Rebuilding containers..."
    docker compose up -d --build
    success "Update complete! Run './manage.sh status' to verify."
}

cmd_backup() {
    local backup_dir="./backups"
    local timestamp
    timestamp=$(date +%Y-%m-%d_%H%M%S)
    local backup_file="${backup_dir}/arsenale_${timestamp}.sql"

    mkdir -p "$backup_dir"

    info "Backing up PostgreSQL database..."

    docker compose exec -T postgres pg_dump \
        -U "${POSTGRES_USER:-arsenale}" \
        -d "${POSTGRES_DB:-arsenale}" \
        --clean --if-exists \
        > "$backup_file"

    local size
    size=$(du -sh "$backup_file" | cut -f1)
    success "Backup saved: $backup_file ($size)"
    echo ""
    echo "  Restore with: ./manage.sh restore $backup_file"
}

cmd_restore() {
    local backup_file="${1:-}"

    if [ -z "$backup_file" ]; then
        error "Usage: ./manage.sh restore <backup-file.sql>"
        echo ""
        echo "  Available backups:"
        ls -lh backups/*.sql 2>/dev/null || echo "    (none found in ./backups/)"
        exit 1
    fi

    if [ ! -f "$backup_file" ]; then
        error "Backup file not found: $backup_file"
        exit 1
    fi

    warn "This will REPLACE the current database with the backup."
    read -rp "Are you sure? (y/N) " confirm
    if [[ "$confirm" != [yY] ]]; then
        info "Restore cancelled."
        exit 0
    fi

    info "Restoring from $backup_file..."

    docker compose exec -T postgres psql \
        -U "${POSTGRES_USER:-arsenale}" \
        -d "${POSTGRES_DB:-arsenale}" \
        < "$backup_file"

    success "Database restored. Restarting server to apply migrations..."
    docker compose restart server
    success "Restore complete."
}

cmd_shell() {
    local service="${1:-server}"
    info "Opening shell in $service..."
    docker compose exec "$service" sh
}

cmd_reset() {
    warn "This will STOP all services and DELETE all data (database, recordings, drive files)."
    warn "This action CANNOT be undone."
    echo ""
    read -rp "Type 'RESET' to confirm: " confirm
    if [ "$confirm" != "RESET" ]; then
        info "Reset cancelled."
        exit 0
    fi

    info "Stopping all services and removing volumes..."
    docker compose down -v
    success "All services stopped and volumes removed."
    echo ""
    echo "To start fresh, run: ./install.sh"
}

# -- Main --------------------------------------------------------------------

COMMAND="${1:-}"
shift || true

case "$COMMAND" in
    status)   cmd_status ;;
    start)    cmd_start ;;
    stop)     cmd_stop ;;
    restart)  cmd_restart "$@" ;;
    logs)     cmd_logs "$@" ;;
    update)   cmd_update ;;
    backup)   cmd_backup ;;
    restore)  cmd_restore "$@" ;;
    shell)    cmd_shell "$@" ;;
    reset)    cmd_reset ;;
    *)
        echo "Arsenale Management Script"
        echo ""
        echo "Usage: ./manage.sh <command> [options]"
        echo ""
        echo "Commands:"
        echo "  status            Show service health and status"
        echo "  start             Start all services"
        echo "  stop              Stop all services"
        echo "  restart [service] Restart all or a specific service"
        echo "  logs [service]    View logs (follow mode)"
        echo "  update            Pull latest code and rebuild"
        echo "  backup            Create a database backup"
        echo "  restore <file>    Restore a database backup"
        echo "  shell [service]   Open a shell (default: server)"
        echo "  reset             Stop and destroy all data (DANGEROUS)"
        echo ""
        exit 1
        ;;
esac
