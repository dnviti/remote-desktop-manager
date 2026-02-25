#!/usr/bin/env bash
# =============================================================================
# Task Manager Hook per Claude Code
# Analizza i file modificati e mostra i task correlati dal to-do.txt
# =============================================================================

# Trova la root del progetto: prima prova git, altrimenti risali cercando to-do.txt
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$PROJECT_ROOT" ]; then
  SEARCH_DIR="$(pwd)"
  while [ "$SEARCH_DIR" != "/" ] && [ "$SEARCH_DIR" != "" ]; do
    if [ -f "$SEARCH_DIR/to-do.txt" ]; then
      PROJECT_ROOT="$SEARCH_DIR"
      break
    fi
    SEARCH_DIR="$(dirname "$SEARCH_DIR")"
  done
fi

TODO_FILE="$PROJECT_ROOT/to-do.txt"

if [ ! -f "$TODO_FILE" ]; then
  exit 0
fi

# Sanitizza il file (rimuovi \r Windows) in una variabile
TODO_CONTENT="$(tr -d '\r' < "$TODO_FILE")"

# ---------------------------------------------------------------------------
# Mappa: pattern file -> codice task
# ---------------------------------------------------------------------------
declare -A FILE_TASK_MAP=(
  ["folders.api.ts"]="FOLD-001"
  ["FolderDialog.tsx"]="FOLD-001"
  ["MainLayout.tsx"]="UI-002"
  ["ConnectionContextMenu.tsx"]="CTX-003"
  ["ConnectionTree.tsx"]="CTX-003"
  ["ConfirmDialog.tsx"]="DEL-004"
  ["ShareDialog.tsx"]="SHR-005"
  ["sharing.api.ts"]="SHR-005"
  ["sharing.service.ts"]="SHR-005"
  ["sharing.routes.ts"]="SHR-005"
  ["ConnectAsDialog.tsx"]="CRED-006"
  ["SshTerminal.tsx"]="CRED-006"
  ["RdpViewer.tsx"]="CRED-006"
  ["ssh.service.ts"]="CRED-006"
  ["rdp.service.ts"]="CRED-006"
  ["SettingsPage.tsx"]="USER-007"
  ["user.api.ts"]="USER-007"
  ["user.routes.ts"]="USER-007"
  ["user.controller.ts"]="USER-007"
  ["user.service.ts"]="USER-007"
  ["ConnectionDialog.tsx"]="EDIT-008"
  ["connection.controller.ts"]="EDIT-008"
  ["themeStore.ts"]="THEME-011"
  ["theme.ts"]="THEME-011"
  ["twofa.routes.ts"]="2FA-012"
  ["twofa.service.ts"]="2FA-012"
  ["audit.service.ts"]="AUDIT-013"
  ["audit.routes.ts"]="AUDIT-013"
  ["AuditLogPage.tsx"]="AUDIT-013"
  ["favorites.routes.ts"]="FAVS-014"
  ["notification.service.ts"]="NOTIF-015"
  ["notification.routes.ts"]="NOTIF-015"
  ["NotificationBell.tsx"]="NOTIF-015"
  ["useKeyboardShortcuts.ts"]="KEYS-016"
  ["schema.prisma"]="USER-007"
)

# ---------------------------------------------------------------------------
# Task descriptions
# ---------------------------------------------------------------------------
declare -A TASK_NAMES=(
  ["FOLD-001"]="Gestione cartelle UI"
  ["UI-002"]="Spostare bottone nuova connessione"
  ["CTX-003"]="Menu contestuale connessioni"
  ["DEL-004"]="Eliminazione connessioni"
  ["SHR-005"]="Condivisione connessioni"
  ["CRED-006"]="Credenziali alternative"
  ["USER-007"]="Pannello utente"
  ["EDIT-008"]="Modifica connessioni UI"
  ["SEARCH-009"]="Ricerca connessioni"
  ["DND-010"]="Drag and Drop"
  ["THEME-011"]="Tema scuro/chiaro"
  ["2FA-012"]="Autenticazione 2FA"
  ["AUDIT-013"]="Audit log"
  ["FAVS-014"]="Preferiti e recenti"
  ["NOTIF-015"]="Notifiche condivisione"
  ["KEYS-016"]="Scorciatoie tastiera"
)

# ---------------------------------------------------------------------------
# Funzione: estrai stato di un task dal to-do.txt
# ---------------------------------------------------------------------------
get_task_status() {
  local code="$1"
  local line
  line=$(echo "$TODO_CONTENT" | grep -E "^\[.\] ${code}" | head -1)
  if [ -z "$line" ]; then
    line=$(echo "$TODO_CONTENT" | grep -B1 "$code" | grep -E '^\[' | head -1)
  fi
  if echo "$line" | grep -q '\[x\]'; then
    echo "COMPLETATO"
  elif echo "$line" | grep -q '\[~\]'; then
    echo "IN CORSO"
  elif echo "$line" | grep -q '\[!\]'; then
    echo "BLOCCATO"
  elif echo "$line" | grep -q '\[ \]'; then
    echo "DA FARE"
  else
    echo "N/A"
  fi
}

# ---------------------------------------------------------------------------
# Funzione: conta task per stato
# ---------------------------------------------------------------------------
show_summary() {
  local done progress todo blocked total pct

  done=$(echo "$TODO_CONTENT" | grep -cE '^\[x\] [A-Z0-9]' || true)
  progress=$(echo "$TODO_CONTENT" | grep -cE '^\[~\] [A-Z0-9]' || true)
  todo=$(echo "$TODO_CONTENT" | grep -cE '^\[ \] [A-Z0-9]' || true)
  blocked=$(echo "$TODO_CONTENT" | grep -cE '^\[!\] [A-Z0-9]' || true)

  # Rimuovi spazi/newline spuri
  done=${done//[^0-9]/}
  progress=${progress//[^0-9]/}
  todo=${todo//[^0-9]/}
  blocked=${blocked//[^0-9]/}

  # Default a 0 se vuoto
  done=${done:-0}
  progress=${progress:-0}
  todo=${todo:-0}
  blocked=${blocked:-0}

  total=$((done + progress + todo + blocked))

  echo ""
  echo "=== RDM TASK SUMMARY ==="
  echo "  Completati: $done/$total"
  echo "  In corso:   $progress"
  echo "  Da fare:    $todo"
  echo "  Bloccati:   $blocked"
  if [ "$total" -gt 0 ]; then
    pct=$((done * 100 / total))
    echo "  Progresso:  ${pct}%"
  fi
  echo "========================="
}

# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------
main() {
  local modified_file="$1"

  if [ -z "$modified_file" ]; then
    show_summary
    exit 0
  fi

  local filename
  filename=$(basename "$modified_file")

  local task_code="${FILE_TASK_MAP[$filename]}"

  if [ -n "$task_code" ]; then
    local task_name="${TASK_NAMES[$task_code]}"
    local task_status
    task_status=$(get_task_status "$task_code")

    echo ""
    echo "--- Task Correlato ---"
    echo "  File:   $modified_file"
    echo "  Task:   [$task_code] $task_name"
    echo "  Stato:  $task_status"
    echo "----------------------"
  fi

  show_summary
}

main "$@"
