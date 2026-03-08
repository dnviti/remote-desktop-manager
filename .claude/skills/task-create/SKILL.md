---
name: task-create
description: Create a new task in the project backlog with auto-assigned ID, codebase-informed technical details, and proper formatting in to-do.txt.
disable-model-invocation: true
allowed-tools: Bash, Read, Grep, Glob, Edit, Write
argument-hint: "[task description]"
---

# Create a New Task

You are a task creation assistant for the Arsenale project. Your job is to generate properly formatted task blocks and add them to the project backlog (`to-do.txt`).

Always respond and work in English. However, the task block content (field labels, descriptions, technical details) MUST be written in **Italian**, following the exact format of existing tasks.

## Current Task State

### Highest task IDs (last 20, sorted by number):
!`grep -rohE '[A-Z][A-Z0-9]+-[0-9]{3}' to-do.txt progressing.txt done.txt 2>/dev/null | sort -t'-' -k2 -n | tail -20`

### All prefixes currently in use:
!`grep -rohE '[A-Z][A-Z0-9]+-[0-9]{3}' to-do.txt progressing.txt done.txt 2>/dev/null | sed 's/-[0-9]*//' | sort -u`

### Section headers in to-do.txt:
!`grep -n 'SEZIONE [A-Z]' to-do.txt | tr -d '\r'`

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

Task numbering is **globally sequential** across all prefixes and all three files.

1. From the "Highest task IDs" data above, extract all numeric parts (e.g., `ORCH-065` → 65).
2. **Ignore false positives** like `AES-256` or `SHA-256` — these are not task codes but encryption algorithm references in the text. Only consider IDs where the prefix is a known task prefix (see table above) or matches the pattern of a short alphabetical prefix.
3. Find the maximum number.
4. The new task number = `max + 1`, zero-padded to 3 digits.

### Step 4: Explore the Codebase

Before writing the task block, explore the codebase to generate accurate technical details:

1. **Read the Prisma schema** (`server/prisma/schema.prisma`) — especially if the task involves database changes (new models, enums, fields).
2. **Read relevant existing files** based on the task description:
   - Backend tasks → check `server/src/routes/`, `server/src/controllers/`, `server/src/services/`, `server/src/middleware/`
   - Frontend tasks → check `client/src/components/`, `client/src/pages/`, `client/src/store/`, `client/src/hooks/`, `client/src/api/`
   - Infrastructure tasks → check `docker-compose.dev.yml`, `docker-compose.yml`, Dockerfiles
3. **Look at similar completed tasks** in `done.txt` for pattern reference — find a task with similar scope and mirror its structure.
4. **Identify files to create and modify** — be specific about file paths based on the actual directory structure. Use `Glob` to verify paths exist before listing them under `MODIFICARE`.

### Step 5: Draft the Task Block

Generate the task block in the **exact format** used by existing tasks. All field labels and descriptive content MUST be in Italian.

**Template:**

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

**Formatting rules:**
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

Present the complete task block to the user, along with:

1. **Task code:** The generated PREFIX-NNN
2. **Suggested section:** Which section (A–G) it should be placed in, with reasoning
3. **Suggested priority:** ALTA / MEDIA / BASSA, with reasoning

Then use `AskUserQuestion` with these options:
- **"Looks good, create it"** — proceed to Step 7
- **"Needs changes"** — let the user specify what to adjust (section, priority, description, etc.)
- **"Cancel"** — abort without creating

### Step 7: Check for Duplicates

Before writing, perform a final duplicate check:

1. Search all three task files for the key concepts in the task title and description:
   ```
   grep -i "keyword1" to-do.txt progressing.txt done.txt
   grep -i "keyword2" to-do.txt progressing.txt done.txt
   ```
2. If a potentially similar task is found, warn the user and ask whether to proceed or abort.
3. If no duplicates found, continue to Step 8.

### Step 8: Insert the Task into to-do.txt

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

### Step 9: Confirm and Report

After successfully inserting the task, report:

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

1. **NEVER modify `progressing.txt` or `done.txt`** — only append to `to-do.txt`.
2. **NEVER create duplicate tasks** — always cross-reference all three files first.
3. **NEVER reuse a task number that already exists** — always use global max + 1.
4. **NEVER skip user confirmation** — always present the draft and wait for approval.
5. **Italian content in task blocks** — field labels (`Priorita`, `Dipendenze`, `DESCRIZIONE`, `DETTAGLI TECNICI`, `File coinvolti`, `CREARE`, `MODIFICARE`) and descriptions are always in Italian. Communication with the user is in English.
6. **Accurate file paths** — only reference files that actually exist (for `MODIFICARE`) or directories that exist (for `CREARE`). Verify with `Glob` before listing.
7. **Follow the exact formatting** of existing tasks — same indentation, same dash count (78), same field order.
8. **NEVER use the `KEYS` prefix** — permanently cancelled.
