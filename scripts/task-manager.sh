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
PROGRESS_FILE="$PROJECT_ROOT/progressing.txt"
DONE_FILE="$PROJECT_ROOT/done.txt"

if [ ! -f "$TODO_FILE" ]; then
  exit 0
fi

# Sanitizza i file (rimuovi \r Windows) in variabili
TODO_CONTENT="$(tr -d '\r' < "$TODO_FILE")"
PROGRESS_CONTENT=""
DONE_CONTENT=""
[ -f "$PROGRESS_FILE" ] && PROGRESS_CONTENT="$(tr -d '\r' < "$PROGRESS_FILE")"
[ -f "$DONE_FILE" ] && DONE_CONTENT="$(tr -d '\r' < "$DONE_FILE")"

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
  ["clipboard.service.ts"]="CLIP-017"
  ["ClipboardPanel.tsx"]="CLIP-017"
  ["rdpfs.service.ts"]="RDPFS-018"
  ["FileBrowser.tsx"]="RDPFS-018"
  ["sftp.service.ts"]="SFTP-019"
  ["SftpPanel.tsx"]="SFTP-019"
  ["search.api.ts"]="SEARCH-009"
  ["SearchBar.tsx"]="SEARCH-009"
  ["sshTerminalConfig"]="SSHUI-027"
  ["rdpSettings"]="RDPSET-028"
  ["oauth.service.ts"]="OAUTH-029"
  ["oauth.controller.ts"]="OAUTH-029"
  ["oauth.routes.ts"]="OAUTH-029"
  ["email.service.ts"]="EMAIL-030"
  ["emailVerification"]="EMAIL-030"
  ["tenant.service.ts"]="TENANT-021"
  ["tenant.controller.ts"]="TENANT-021"
  ["tenant.routes.ts"]="TENANT-021"
  ["tenant.middleware.ts"]="GUARD-026"
  ["tenantScope.ts"]="GUARD-026"
  ["TenantSettingsPage.tsx"]="UI-025"
  ["tenantStore.ts"]="UI-025"
  ["tenant.api.ts"]="UI-025"
  ["team.service.ts"]="TEAM-022"
  ["team.controller.ts"]="TEAM-022"
  ["team.routes.ts"]="TEAM-022"
  ["TeamManagementPage.tsx"]="UI-025"
  ["teamStore.ts"]="UI-025"
  ["team.api.ts"]="UI-025"
  ["permission.service.ts"]="PERM-023"
  ["UserPicker.tsx"]="DISC-024"
  [".semgrep.yml"]="SAST-031"
  ["eslint.config"]="SAST-031"
  [".eslintrc"]="SAST-031"
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
  ["CLIP-017"]="Clipboard RDP e SSH"
  ["RDPFS-018"]="Drive redirection RDP"
  ["SFTP-019"]="Trasferimento file SFTP"
  ["SEARCH-009"]="Ricerca connessioni"
  ["SSHUI-027"]="Personalizzazione terminale SSH"
  ["RDPSET-028"]="Personalizzazione sessioni RDP"
  ["OAUTH-029"]="Autenticazione OAuth"
  ["EMAIL-030"]="Verifica email registrazione"
  ["TENANT-020"]="Schema multi-tenant Prisma"
  ["TENANT-021"]="Backend CRUD tenant + onboarding"
  ["TEAM-022"]="Backend CRUD team + vault team"
  ["PERM-023"]="Ownership connessioni + permessi team"
  ["DISC-024"]="Ricerca utenti nel tenant/team"
  ["UI-025"]="Frontend tenant/team/sidebar"
  ["GUARD-026"]="Middleware sicurezza tenant-scoped"
  ["SAST-031"]="SAST e code verification tools"
)

# ---------------------------------------------------------------------------
# Funzione: estrai stato di un task dal to-do.txt
# ---------------------------------------------------------------------------
get_task_status() {
  local code="$1"
  local line

  # Search in done.txt first (completed)
  if [ -n "$DONE_CONTENT" ]; then
    line=$(echo "$DONE_CONTENT" | grep -E "^\[x\] ${code}" | head -1)
    if [ -n "$line" ]; then
      echo "COMPLETATO"
      return
    fi
  fi

  # Search in progressing.txt (in-progress)
  if [ -n "$PROGRESS_CONTENT" ]; then
    line=$(echo "$PROGRESS_CONTENT" | grep -E "^\[~\] ${code}" | head -1)
    if [ -n "$line" ]; then
      echo "IN CORSO"
      return
    fi
  fi

  # Search in to-do.txt (pending/blocked)
  line=$(echo "$TODO_CONTENT" | grep -E "^\[.\] ${code}" | head -1)
  if [ -z "$line" ]; then
    line=$(echo "$TODO_CONTENT" | grep -B1 "$code" | grep -E '^\[' | head -1)
  fi
  if echo "$line" | grep -q '\[!\]'; then
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

  # Count from the correct files
  done=$(echo "$DONE_CONTENT" | grep -cE '^\[x\] [A-Z0-9]' || true)
  progress=$(echo "$PROGRESS_CONTENT" | grep -cE '^\[~\] [A-Z0-9]' || true)
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
  echo "=== ARSENALE TASK SUMMARY ==="
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
