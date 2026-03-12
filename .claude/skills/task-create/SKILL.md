---
name: task-create
description: Create a new task in the project backlog with auto-assigned ID, codebase-informed technical details, and proper formatting.
disable-model-invocation: true
argument-hint: "[task description]"
---

# Create a New Task

You are a task creation assistant for the Arsenale project. Your job is to generate properly formatted task blocks and add them to the project backlog.

Always respond and work in English.

## Mode Detection

Determine the operating mode by reading the GitHub Issues configuration:

```bash
TRACKER_CFG=".claude/issues-tracker.json"; [ ! -f "$TRACKER_CFG" ] && TRACKER_CFG=".claude/github-issues.json"
PLATFORM="$(jq -r '.platform // "github"' "$TRACKER_CFG" 2>/dev/null)"
TRACKER_ENABLED="$(jq -r '.enabled // false' "$TRACKER_CFG" 2>/dev/null)"
TRACKER_SYNC="$(jq -r '.sync // false' "$TRACKER_CFG" 2>/dev/null)"
TRACKER_REPO="$(jq -r '.repo' "$TRACKER_CFG" 2>/dev/null)"
```

Three modes:

| Mode | Condition | Behavior |
|------|-----------|----------|
| **GitHub-only** | `TRACKER_ENABLED=true` AND `TRACKER_SYNC != true` | Create tasks as GitHub Issues only. No local file operations. |
| **Dual sync** | `TRACKER_ENABLED=true` AND `TRACKER_SYNC=true` | Write to `to-do.txt` first, then sync to GitHub. |
| **Local only** | `TRACKER_ENABLED=false` or config missing | Write to `to-do.txt` only. |

## Current Task State

### In GitHub-only mode:

#### Highest task IDs (last 20, sorted by number):
!`TRACKER_CFG=".claude/issues-tracker.json"; [ ! -f "$TRACKER_CFG" ] && TRACKER_CFG=".claude/github-issues.json"; TRACKER_REPO="$(jq -r '.repo' "$TRACKER_CFG" 2>/dev/null)"; gh issue list --repo "$TRACKER_REPO" --label task --state all --limit 500 --json title --jq '.[].title' | grep -oE '[A-Z][A-Z0-9]+-[0-9]{3}' | sort -t'-' -k2 -n | tail -20`

#### All prefixes currently in use:
!`TRACKER_CFG=".claude/issues-tracker.json"; [ ! -f "$TRACKER_CFG" ] && TRACKER_CFG=".claude/github-issues.json"; TRACKER_REPO="$(jq -r '.repo' "$TRACKER_CFG" 2>/dev/null)"; gh issue list --repo "$TRACKER_REPO" --label task --state all --limit 500 --json title --jq '.[].title' | grep -oE '[A-Z][A-Z0-9]+-[0-9]{3}' | sed 's/-[0-9]*//' | sort -u`

### In local only and dual sync modes:

#### Highest task IDs (last 20, sorted by number):
!`grep -rohE '[A-Z][A-Z0-9]+-[0-9]{3}' to-do.txt progressing.txt done.txt 2>/dev/null | sort -t'-' -k2 -n | tail -20`

#### All prefixes currently in use:
!`grep -rohE '[A-Z][A-Z0-9]+-[0-9]{3}' to-do.txt progressing.txt done.txt 2>/dev/null | sed 's/-[0-9]*//' | sort -u`

#### Section headers in to-do.txt:
!`grep -n 'SEZIONE [A-Z]' to-do.txt | tr -d '\r'`

### Section info (GitHub-only mode):

In GitHub-only mode, section information is derived from the label mappings in the tracker config rather than from `to-do.txt`. Read the `labels.sections` mapping from the config to determine available sections and their labels.

## Arguments

The user wants to create a task for: **$ARGUMENTS**

## Instructions

### Step 1: Validate Input

If `$ARGUMENTS` is empty or unclear, ask the user to describe the task they want to create using `AskUserQuestion`:

> "Please describe the task you want to create. Include what the feature/fix should do and any known technical requirements."

Do NOT proceed without a clear task description.

### Step 2: Determine the Task Code Prefix

Analyze the task description and select an appropriate code prefix.

**Existing prefixes and their domains:**

| Prefix | Domain |
|--------|--------|
| `FOLD` | Folder management |
| `UI` | General UI improvements |
| `CTX` | Context menus |
| `DEL` | Deletion features |
| `SHR` | Sharing features |
| `CRED` | Credential management |
| `USER` | User account/profile |
| `EDIT` | Editing features |
| `SEARCH` | Search functionality |
| `DND` | Drag and drop |
| `THEME` | Theming |
| `2FA` | Two-factor authentication |
| `AUDIT` | Audit logging |
| `FAVS` | Favorites |
| `NOTIF` | Notifications |
| `CLIP` | Clipboard |
| `LOG` | Logging |
| `RDPFS` | RDP file sharing/drive redirection |
| `SFTP` | SFTP file transfer |
| `SSHUI` | SSH terminal UI |
| `RDPSET` | RDP settings |
| `OAUTH` | OAuth authentication |
| `EMAIL` | Email features |
| `TENANT` | Multi-tenant features |
| `TEAM` | Team management |
| `PERM` | Permissions |
| `DISC` | User discovery |
| `GUARD` | Security middleware/guards |
| `SAST` | Static analysis/code quality |
| `OSS` | Open-source preparation |
| `CLOUD` | Cloud provider integrations |
| `SMS` | SMS features |
| `OIDC` | OpenID Connect |
| `ZT` | Zero Trust hardening |
| `SSHGW` | SSH gateway |
| `VAULT` | Password vault/keychain |
| `ORCH` | Gateway orchestration/scaling |
| `GATE` | Gateway management |
| `TABS` | Tab management |

**Rules:**
1. Reuse an existing prefix if the task clearly falls within that domain.
2. If no existing prefix fits, create a new one: 2-6 uppercase letters that clearly abbreviate the feature area.
3. **NEVER use the `KEYS` prefix** — it is permanently cancelled.

### Step 3: Compute the Next Task Number

Task numbering is **globally sequential** across all prefixes.

**In GitHub-only mode:**
1. From the GitHub-sourced "Highest task IDs" data above, extract all numeric parts (e.g., `ORCH-065` -> 65).
2. **Ignore false positives** like `AES-256` or `SHA-256` — these are not task codes but encryption algorithm references. Only consider IDs where the prefix is a known task prefix (see table above) or matches the pattern of a short alphabetical prefix.
3. Find the maximum number.
4. The new task number = `max + 1`, zero-padded to 3 digits.

**In local only and dual sync modes:**
1. From the locally-sourced "Highest task IDs" data above, extract all numeric parts (e.g., `ORCH-065` -> 65).
2. **Ignore false positives** like `AES-256` or `SHA-256` — these are not task codes but encryption algorithm references. Only consider IDs where the prefix is a known task prefix (see table above) or matches the pattern of a short alphabetical prefix.
3. Find the maximum number.
4. The new task number = `max + 1`, zero-padded to 3 digits.

### Step 4: Explore the Codebase

Before writing the task block, explore the codebase to generate accurate technical details:

1. **Read the Prisma schema** (`server/prisma/schema.prisma`) — especially if the task involves database changes (new models, enums, fields).
2. **Read relevant existing files** based on the task description:
   - Backend tasks -> check `server/src/routes/`, `server/src/controllers/`, `server/src/services/`, `server/src/middleware/`
   - Frontend tasks -> check `client/src/components/`, `client/src/pages/`, `client/src/store/`, `client/src/hooks/`, `client/src/api/`
   - Infrastructure tasks -> check `docker-compose.dev.yml`, `docker-compose.yml`, Dockerfiles
3. **Look at similar completed tasks** for pattern reference:
   - In local only / dual sync mode: check `done.txt` for a task with similar scope and mirror its structure.
   - In GitHub-only mode: search closed issues with `gh issue list --repo "$TRACKER_REPO" --label task --state closed --limit 10 --json title,body` for reference.
4. **Identify files to create and modify** — be specific about file paths based on the actual directory structure. Use `Glob` to verify paths exist before listing them.

### Step 5: Draft the Task Block

**In GitHub-only mode:** Draft the task as a GitHub Issue in **English**.

GitHub Issue format:
- **Title:** `[PREFIX-NNN] Task Title`
- **Body:**

```markdown
**Code:** PREFIX-NNN | **Priority:** PRIORITY | **Section:** SECTION_NAME | **Dependencies:** DEPS

## Description
Multi-line description in English. Explain WHAT the task does, WHY it is
needed, and its scope. Technical but readable, roughly 4-10 lines.

## Technical Details
Detailed technical implementation plan in English. Structure by layer/file:
  - Prisma schema changes (if needed)
  - Backend services, controllers, routes
  - Frontend components, stores, API calls
  - Configuration changes
Use indented sub-sections with specific code snippets, type definitions,
function signatures, and endpoint paths where appropriate.

## Files Involved
**CREATE:** path/to/new/file.ts
**MODIFY:** path/to/existing/file.ts

---
*Generated by Claude Code via `/task-create`*
```

- **Labels:** `claude-code,task,PRIORITY_LABEL,status:todo,SECTION_LABEL`

**In local only and dual sync modes:** Draft the task block in **Italian** using the existing format. All field labels and descriptive content MUST be in Italian.

Template:

```
------------------------------------------------------------------------------
[ ] PREFIX-NNN — Titolo del task (conciso, in italiano)
------------------------------------------------------------------------------
  Priorita: [PLACEHOLDER]
  Dipendenze: [PLACEHOLDER]

  DESCRIZIONE:
  Descrizione multi-riga in italiano. Spiegare COSA fa il task, PERCHE' e'
  necessario, e il suo ambito. Usare lo stesso stile dei task esistenti:
  tecnico ma leggibile, circa 4-10 righe.

  DETTAGLI TECNICI:
  Piano di implementazione tecnico dettagliato in italiano. Strutturare per
  layer/file:
    - Modifiche al schema Prisma (se necessarie)
    - Servizi, controller, route backend
    - Componenti, store, chiamate API frontend
    - Modifiche alla configurazione
  Usare sotto-sezioni indentate con snippet di codice specifici, definizioni
  di tipo, signature di funzione e percorsi endpoint dove appropriato.

  File coinvolti:
    CREARE:     percorso/al/nuovo/file.ts
    MODIFICARE: percorso/al/file/esistente.ts
```

**Formatting rules (local only and dual sync):**
- Header separator lines are exactly 78 dashes: `------------------------------------------------------------------------------`
- Status prefix is `[ ] ` (pending)
- Title line format: `[ ] PREFIX-NNN — Task Title` (use `—` em dash, not `-` hyphen)
- Indent all content with 2 spaces
- Priority field: `Priorita:` (no accent — this is the convention used in ALL existing tasks)
- Dependencies: use task codes like `SSHGW-049, SSHGW-050` or `Nessuna` if none
- Section labels in order: `DESCRIZIONE:`, `DETTAGLI TECNICI:`, `File coinvolti:`
- File action labels: `CREARE:` (new files) and `MODIFICARE:` (existing files), indented 4 spaces
- End with two blank lines after the last file entry

### Step 6: Present the Draft and Ask for Confirmation

Present the complete task block (or GitHub Issue draft) to the user, along with:

1. **Task code:** The generated PREFIX-NNN
2. **Suggested section:** Which section (A-G) it should be placed in, with reasoning
3. **Suggested priority:** ALTA / MEDIA / BASSA, with reasoning

Then use `AskUserQuestion` with these options:
- **"Looks good, create it"** — proceed to Step 7
- **"Needs changes"** — let the user specify what to adjust (section, priority, description, etc.)
- **"Cancel"** — abort without creating

### Step 7: Check for Duplicates

Before writing, perform a final duplicate check:

**In GitHub-only mode:**
1. Search GitHub issues for key concepts:
   ```bash
   gh issue list --repo "$TRACKER_REPO" --label task --state all --search "keyword1 keyword2" --json title,number,state --jq '.[] | "#\(.number) [\(.state)] \(.title)"'
   ```
2. If a potentially similar task is found, warn the user and ask whether to proceed or abort.
3. If no duplicates found, continue to Step 8.

**In local only and dual sync modes:**
1. Search all three task files for the key concepts in the task title and description:
   ```
   grep -i "keyword1" to-do.txt progressing.txt done.txt
   grep -i "keyword2" to-do.txt progressing.txt done.txt
   ```
2. If a potentially similar task is found, warn the user and ask whether to proceed or abort.
3. If no duplicates found, continue to Step 8.

### Step 8: Insert the Task into to-do.txt

**In GitHub-only mode:** Skip this step entirely.

**In local only and dual sync modes:**

Determine the correct insertion point based on the confirmed section.

**Section guide:**

| Section | Name |
|---------|------|
| A | TASK RICHIESTI (Core Features) |
| B | TASK AGGIUNTIVI SUGGERITI |
| C | MULTI-TENANT / TEAMS / PERMESSI |
| D | MULTI-BACKEND / MULTI-GATEWAY |
| E | ZERO TRUST HARDENING |
| F | PASSWORD KEYCHAIN / SECRET VAULT |
| G | GATEWAY ORCHESTRATION / AUTO-SCALING |

**Insertion rules:**
1. Use `grep -n` to find the target section header line number and the NEXT section header line number (or `ORDINE DI IMPLEMENTAZIONE CONSIGLIATO` if the target is the last section).
2. Read that range of lines to find the last task block in the section.
3. Insert the new task block **after the last existing task** in the section (or after the section header + blank lines if the section is empty).
4. Maintain whitespace conventions: two blank lines between tasks, two blank lines before the next section header.

Use the `Edit` tool to insert the task block at the correct position.

### Step 8.5: Sync to GitHub Issues

**In GitHub-only mode:** This is the **primary write** step. Create the GitHub Issue:

1. Read the label mappings from config:
   ```bash
   TRACKER_REPO="$(jq -r '.repo' "$TRACKER_CFG")"
   PRIORITY_LABEL="$(jq -r ".labels.priority.\"$PRIORITY\"" "$TRACKER_CFG")"
   SECTION_LABEL="$(jq -r ".labels.sections.\"$SECTION_LETTER\"" "$TRACKER_CFG")"
   ```

2. Create the GitHub Issue:
   ```bash
   ISSUE_URL=$(gh issue create --repo "$TRACKER_REPO" \
     --title "[PREFIX-NNN] Task Title" \
     --body "$(cat <<'EOF'
   **Code:** PREFIX-NNN | **Priority:** PRIORITY | **Section:** SECTION_NAME | **Dependencies:** DEPS

   ## Description
   [Description content in English]

   ## Technical Details
   [Technical details content in English]

   ## Files Involved
   **CREATE:** list of files
   **MODIFY:** list of files

   ---
   *Generated by Claude Code via `/task-create`*
   EOF
   )" \
     --label "claude-code,task,$PRIORITY_LABEL,status:todo,$SECTION_LABEL")
   ```

3. If the `gh` command fails, report the error to the user. In GitHub-only mode this is a hard failure since there is no local fallback.

**In dual sync mode:**

1. Read the label mappings from config:
   ```bash
   TRACKER_REPO="$(jq -r '.repo' "$TRACKER_CFG")"
   PRIORITY_LABEL="$(jq -r ".labels.priority.\"$PRIORITY\"" "$TRACKER_CFG")"
   SECTION_LABEL="$(jq -r ".labels.sections.\"$SECTION_LETTER\"" "$TRACKER_CFG")"
   ```

2. Create the GitHub Issue:
   ```bash
   ISSUE_URL=$(gh issue create --repo "$TRACKER_REPO" \
     --title "[PREFIX-NNN] Task Title" \
     --body "$(cat <<'EOF'
   **Code:** PREFIX-NNN | **Priority:** PRIORITY | **Section:** SEZIONE X | **Dependencies:** DEPS

   ## Descrizione
   [DESCRIZIONE content from the task block]

   ## Dettagli Tecnici
   [DETTAGLI TECNICI content from the task block]

   ## File Coinvolti
   **CREARE:** list of files
   **MODIFICARE:** list of files

   ---
   *Generated by Claude Code via `/task-create`*
   EOF
   )" \
     --label "claude-code,task,$PRIORITY_LABEL,status:todo,$SECTION_LABEL")
   ```

3. Extract the issue number from the URL:
   ```bash
   ISSUE_NUM=$(echo "$ISSUE_URL" | grep -oE '[0-9]+$')
   ```

4. Write the issue reference back to the task block in `to-do.txt`. Add a `GitHub: #NNN` line after the `Dipendenze:` line using the `Edit` tool.

5. If the `gh` command fails, warn the user that GitHub sync failed but do NOT fail the task creation — the task is already in `to-do.txt`.

**In local only mode:** Skip this step entirely.

### Step 9: Confirm and Report

After successfully creating the task, report:

**In GitHub-only mode:**

> "Task **PREFIX-NNN — Task Title** has been created as GitHub Issue.
>
> - **Code:** PREFIX-NNN
> - **Priority:** ALTA/MEDIA/BASSA
> - **Dependencies:** list or None
> - **Section:** SECTION_NAME
> - **Files to create:** N
> - **Files to modify:** N
> - **GitHub Issue:** #NNN (URL)"

**In dual sync mode:**

> "Task **PREFIX-NNN — Task Title** has been created in `to-do.txt`, SEZIONE X.
>
> - **Code:** PREFIX-NNN
> - **Priority:** ALTA/MEDIA/BASSA
> - **Dependencies:** list or Nessuna
> - **Section:** SEZIONE X — Section Name
> - **Files to create:** N
> - **Files to modify:** N
> - **GitHub Issue:** #NNN (URL) *(only if GitHub sync succeeded)*"

**In local only mode:**

> "Task **PREFIX-NNN — Task Title** has been created in `to-do.txt`, SEZIONE X.
>
> - **Code:** PREFIX-NNN
> - **Priority:** ALTA/MEDIA/BASSA
> - **Dependencies:** list or Nessuna
> - **Section:** SEZIONE X — Section Name
> - **Files to create:** N
> - **Files to modify:** N"

## Section Selection Guide

| Section | Use when... |
|---------|------------|
| A | Core features directly needed by end users (connections, UI, auth) |
| B | Nice-to-have improvements, UX enhancements, quality-of-life features |
| C | Multi-tenant, team management, permissions, role-based access |
| D | Backend infrastructure, gateway management, multi-backend routing |
| E | Security hardening, zero trust, rate limiting, security headers |
| F | Password keychain, secret vault, credential management beyond basic |
| G | Gateway orchestration, container scaling, session tracking |

If the task does not clearly fit any existing section, suggest Section B (general improvements) and note this to the user.

## Important Rules

1. **In local only and dual sync modes, NEVER modify `progressing.txt` or `done.txt`** — only append to `to-do.txt`.
2. **NEVER create duplicate tasks** — always cross-reference existing tasks first (GitHub issues in GitHub-only mode, local files in local/dual mode).
3. **NEVER reuse a task number that already exists** — always use global max + 1.
4. **NEVER skip user confirmation** — always present the draft and wait for approval.
5. **Language rules:**
   - **GitHub-only mode:** All task content (title, description, technical details) must be in **English**. Communication with the user is in English.
   - **Local only and dual sync modes:** Task block content (field labels, descriptions, technical details) MUST be in **Italian**. Communication with the user is in English.
6. **Accurate file paths** — only reference files that actually exist (for `MODIFICARE`/`MODIFY`) or directories that exist (for `CREARE`/`CREATE`). Verify with `Glob` before listing.
7. **Follow the exact formatting** — in local/dual mode: same indentation, same dash count (78), same field order as existing tasks. In GitHub-only mode: use the GitHub Issue markdown format specified in Step 5.
8. **NEVER use the `KEYS` prefix** — permanently cancelled.
9. **In GitHub-only mode, NEVER modify local task files** (`to-do.txt`, `progressing.txt`, `done.txt`) — all operations go through GitHub Issues exclusively.
