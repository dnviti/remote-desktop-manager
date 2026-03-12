---
name: idea-approve
description: Approve an idea, convert it into a full task with technical details, and promote it to the task pipeline. This is the ONLY bridge from ideas to tasks.
disable-model-invocation: true
argument-hint: "[IDEA-NNN]"
---

# Approve an Idea

You are the idea approval gateway for the Arsenale project. Your job is to take an idea, flesh it out with codebase-informed technical details, and promote it to a full task.

This skill is the **ONLY** bridge between the idea backlog and the task pipeline. Ideas must go through this process to become actionable tasks.

## Mode Detection

Determine the operating mode by reading the GitHub Issues config:

```bash
TRACKER_CFG=".claude/issues-tracker.json"; [ ! -f "$TRACKER_CFG" ] && TRACKER_CFG=".claude/github-issues.json"
PLATFORM="$(jq -r '.platform // "github"' "$TRACKER_CFG" 2>/dev/null)"
TRACKER_ENABLED="$(jq -r '.enabled // false' "$TRACKER_CFG" 2>/dev/null)"
TRACKER_SYNC="$(jq -r '.sync // false' "$TRACKER_CFG" 2>/dev/null)"
TRACKER_REPO="$(jq -r '.repo' "$TRACKER_CFG" 2>/dev/null)"
```

Three modes:
- **Platform-only mode** (`TRACKER_ENABLED=true` AND `TRACKER_SYNC != true`): All operations happen on GitHub Issues. No local file reads or writes. All content must be in **English**.
- **Dual sync mode** (`TRACKER_ENABLED=true` AND `TRACKER_SYNC=true`): Write to local files first, then sync to GitHub. Task block content is in **Italian**.
- **Local only mode** (`TRACKER_ENABLED=false` or config missing): Write to local files only. Task block content is in **Italian**.

## Current State

### GitHub-only mode queries:

Ideas available for approval:
!`TRACKER_CFG=".claude/issues-tracker.json"; [ ! -f "$TRACKER_CFG" ] && TRACKER_CFG=".claude/github-issues.json"; jq -r 'if (.enabled == true) and (.sync != true) then .repo else empty end' "$TRACKER_CFG" 2>/dev/null | xargs -I{} gh issue list --repo {} --label idea --state open --json number,title --jq '.[] | "#\(.number) \(.title)"' 2>/dev/null`

Highest task IDs from GitHub (last 20):
!`TRACKER_CFG=".claude/issues-tracker.json"; [ ! -f "$TRACKER_CFG" ] && TRACKER_CFG=".claude/github-issues.json"; jq -r 'if (.enabled == true) and (.sync != true) then .repo else empty end' "$TRACKER_CFG" 2>/dev/null | xargs -I{} gh issue list --repo {} --label task --state all --limit 500 --json title --jq '.[].title' 2>/dev/null | grep -oE '[A-Z][A-Z0-9]+-[0-9]{3}' | sort -t'-' -k2 -n | tail -20`

### Local / dual sync mode queries:

Ideas available for approval:
!`grep -E '^IDEA-[0-9]{3}' ideas.txt 2>/dev/null | tr -d '\r'`

Highest task IDs (last 20, sorted by number):
!`grep -rohE '[A-Z][A-Z0-9]+-[0-9]{3}' to-do.txt progressing.txt done.txt 2>/dev/null | sort -t'-' -k2 -n | tail -20`

### All task prefixes currently in use:
!`grep -rohE '[A-Z][A-Z0-9]+-[0-9]{3}' to-do.txt progressing.txt done.txt 2>/dev/null | sed 's/-[0-9]*//' | sort -u`

### Section headers in to-do.txt:
!`grep -n 'SEZIONE [A-Z]' to-do.txt | tr -d '\r'`

## Arguments

The user wants to approve: **$ARGUMENTS**

## Instructions

### Step 1: Select the Idea

**GitHub-only mode:**
- **If an IDEA-NNN code was provided**: Search GitHub Issues: `gh issue list --repo "$TRACKER_REPO" --search "[IDEA-NNN] in:title" --label idea --state open --json number,title`. If not found, inform the user and list available idea issues.
- **If no argument was provided**: List all open idea issues from the Current State data above. Use `AskUserQuestion` to ask the user which idea to approve.
- If there are no open idea issues, inform the user: "No ideas available for approval. Use `/idea-create` to add ideas first."

**Local / dual sync mode:**
- **If an IDEA-NNN code was provided**: Find that idea in `ideas.txt`. If not found, inform the user and list available ideas.
- **If no argument was provided**: List all ideas from `ideas.txt` with their codes, titles, and categories. Use `AskUserQuestion` to ask the user which idea to approve.
- If `ideas.txt` has no ideas, inform the user: "No ideas available for approval. Use `/idea-create` to add ideas first."

### Step 2: Read the Full Idea

**GitHub-only mode:**
- Fetch the full idea issue body: `gh issue view IDEA_ISSUE_NUMBER --repo "$TRACKER_REPO" --json title,body,number`
- Extract the title, description, and motivation from the issue body.

**Local / dual sync mode:**
- Read the complete idea block from `ideas.txt` — everything between its `------` separator lines. Extract:
  - Title
  - Categoria
  - DESCRIZIONE
  - MOTIVAZIONE

Present the idea to the user as context for what will be converted.

### Step 3: Determine the Task Code Prefix

Analyze the idea's description and category to select an appropriate task prefix.

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
1. Reuse an existing prefix if the idea clearly falls within that domain.
2. If no existing prefix fits, create a new one: 2-6 uppercase letters that clearly abbreviate the feature area.
3. **NEVER use the `KEYS` prefix** — it is permanently cancelled.

### Step 4: Compute the Next Task Number

Task numbering is **globally sequential** across all prefixes.

**GitHub-only mode:**
1. From the "Highest task IDs from GitHub" data above, extract all numeric parts.
2. **Ignore false positives** like `AES-256` or `SHA-256`.
3. Find the maximum number.
4. The new task number = `max + 1`, zero-padded to 3 digits.

**Local / dual sync mode:**
1. From the "Highest task IDs" data above, extract all numeric parts.
2. **Ignore false positives** like `AES-256` or `SHA-256`.
3. Find the maximum number.
4. The new task number = `max + 1`, zero-padded to 3 digits.

### Step 5: Explore the Codebase

Before writing the task, explore the codebase to generate accurate technical details:

1. **Read the Prisma schema** (`server/prisma/schema.prisma`) — especially if the idea involves database changes.
2. **Read relevant existing files** based on the idea description:
   - Backend ideas → check `server/src/routes/`, `server/src/controllers/`, `server/src/services/`, `server/src/middleware/`
   - Frontend ideas → check `client/src/components/`, `client/src/pages/`, `client/src/store/`, `client/src/hooks/`, `client/src/api/`
   - Infrastructure ideas → check `docker-compose.dev.yml`, `docker-compose.yml`, Dockerfiles
3. **Look at similar completed tasks** — in local/dual mode check `done.txt`, in GitHub-only mode search closed task issues.
4. **Identify files to create and modify** — be specific about file paths. Use `Glob` to verify paths exist before listing them.

### Step 6: Draft the Full Task

**GitHub-only mode — draft as a GitHub Issue in English:**

Title: `[PREFIX-NNN] Task Title`

Body:
```
**Code:** PREFIX-NNN | **Priority:** HIGH/MEDIUM/LOW | **Section:** SECTION X | **Dependencies:** DEPS
**Promoted from:** [IDEA-NNN] #IDEA_ISSUE_NUMBER

## Description
Expanded description in English based on the original idea. More detailed than
the idea, explaining what, why, and the scope. Approximately 4-10 lines.

## Technical Details
Detailed technical implementation plan in English, structured by layer/file.
Include specific code snippets, function signatures, endpoint paths.

## Files Involved
**CREATE:** path/to/new/file.ts
**MODIFY:** path/to/existing/file.ts

---
*Generated by Claude Code via `/idea-approve`*
```

**Local / dual sync mode — draft as a task block in Italian:**

```
------------------------------------------------------------------------------
[ ] PREFIX-NNN — Titolo del task (conciso, in italiano)
------------------------------------------------------------------------------
  Priorita: [ALTA/MEDIA/BASSA]
  Dipendenze: [TASK-CODE, TASK-CODE or Nessuna]

  DESCRIZIONE:
  Expanded description in Italian based on the original idea's DESCRIZIONE
  and MOTIVAZIONE. More detailed than the idea, explaining COSA, PERCHE',
  and the scope. Approximately 4-10 lines.

  DETTAGLI TECNICI:
  Detailed technical implementation plan in Italian, structured by layer/file.
  This section is NEW — the original idea did not have this.
  Include specific code snippets, function signatures, endpoint paths.

  File coinvolti:
    CREARE:     path/to/new/file.ts
    MODIFICARE: path/to/existing/file.ts
```

**Formatting rules (local / dual sync mode only):**
- Header separator lines are exactly 78 dashes
- Status prefix is `[ ] ` (pending)
- Title line format: `[ ] PREFIX-NNN — Task Title` (use `—` em dash)
- Indent all content with 2 spaces
- Priority field: `Priorita:` (no accent)
- Dependencies: use task codes or `Nessuna`
- Section labels: `DESCRIZIONE:`, `DETTAGLI TECNICI:`, `File coinvolti:`
- File action labels: `CREARE:` and `MODIFICARE:`, indented 4 spaces
- End with two blank lines

### Step 7: Present the Draft and Ask for Confirmation

Present the complete task (issue draft or task block) to the user, along with:

1. **Original idea:** IDEA-NNN and its title
2. **New task code:** PREFIX-NNN
3. **Suggested section:** Which section (A–G) and why
4. **Suggested priority:** HIGH/MEDIUM/LOW (GitHub-only) or ALTA/MEDIA/BASSA (local/dual)

Then use `AskUserQuestion` with these options:
- **"Looks good, approve it"** — proceed to Step 8
- **"Needs changes"** — let the user specify adjustments
- **"Cancel"** — abort without approving

### Step 8: Check for Duplicates

**GitHub-only mode:**
Search GitHub Issues for similar tasks:
```bash
gh issue list --repo "$TRACKER_REPO" --label task --state all --search "keyword1" --json number,title,state
gh issue list --repo "$TRACKER_REPO" --label task --state all --search "keyword2" --json number,title,state
```

**Local / dual sync mode:**
Search all task files for key concepts:
```
grep -i "keyword1" to-do.txt progressing.txt done.txt
grep -i "keyword2" to-do.txt progressing.txt done.txt
```

If a similar task exists, warn the user and ask whether to proceed or abort.

### Step 9: Insert the Task and Remove the Idea

This step varies by mode:

**GitHub-only mode:**
Skip local file operations entirely. The task issue creation and idea issue closure happen in Step 9.5.

**Local / dual sync mode — two operations:**

**9a. Add the task to `to-do.txt`:**
1. Use `grep -n` to find the target section header and the next section header.
2. Find the last task block in the section.
3. Insert the new task block after the last existing task.
4. Maintain whitespace conventions: two blank lines between tasks.

**9b. Remove the idea from `ideas.txt`:**
1. Find the idea block in `ideas.txt` (everything between its `------` separators, inclusive).
2. Remove the entire block from `ideas.txt`.
3. Clean up any extra blank lines left behind.

Use the `Edit` tool for both operations.

### Step 9.5: Sync to GitHub Issues

**GitHub-only mode** — this IS the primary operation:

1. **Close the idea issue:**
   ```bash
   IDEA_ISSUE=$(gh issue list --repo "$TRACKER_REPO" --search "[IDEA-NNN] in:title" --label idea --state open --json number --jq '.[0].number' 2>/dev/null)
   ```
   If found:
   ```bash
   gh issue close "$IDEA_ISSUE" --repo "$TRACKER_REPO" --comment "Approved and promoted to task [PREFIX-NNN]." 2>/dev/null || true
   ```

2. **Create the task issue:**
   ```bash
   PRIORITY_LABEL="$(jq -r ".labels.priority.\"$PRIORITY\"" "$TRACKER_CFG")"
   SECTION_LABEL="$(jq -r ".labels.sections.\"$SECTION_LETTER\"" "$TRACKER_CFG")"
   TASK_ISSUE_URL=$(gh issue create --repo "$TRACKER_REPO" \
     --title "[PREFIX-NNN] Task Title" \
     --body "$(cat <<'EOF'
   **Code:** PREFIX-NNN | **Priority:** HIGH/MEDIUM/LOW | **Section:** SECTION X | **Dependencies:** DEPS
   **Promoted from:** [IDEA-NNN] #IDEA_ISSUE

   ## Description
   [Description content in English]

   ## Technical Details
   [Technical details content in English]

   ## Files Involved
   **CREATE:** list
   **MODIFY:** list

   ---
   *Generated by Claude Code via `/idea-approve`*
   EOF
   )" \
     --label "claude-code,task,$PRIORITY_LABEL,status:todo,$SECTION_LABEL")
   ```

3. **Cross-reference** between the idea and task issues:
   ```bash
   TASK_ISSUE_NUM=$(echo "$TASK_ISSUE_URL" | grep -oE '[0-9]+$')
   gh issue comment "$IDEA_ISSUE" --repo "$TRACKER_REPO" --body "Task issue: #$TASK_ISSUE_NUM" 2>/dev/null || true
   ```

**Dual sync mode** — sync after local operations:

1. **Close the idea issue:**
   ```bash
   IDEA_ISSUE=$(gh issue list --repo "$TRACKER_REPO" --search "[IDEA-NNN] in:title" --label idea --state open --json number --jq '.[0].number' 2>/dev/null)
   ```
   If found:
   ```bash
   gh issue close "$IDEA_ISSUE" --repo "$TRACKER_REPO" --comment "Approved and promoted to task [PREFIX-NNN]." 2>/dev/null || true
   ```

2. **Create the task issue:**
   ```bash
   PRIORITY_LABEL="$(jq -r ".labels.priority.\"$PRIORITY\"" "$TRACKER_CFG")"
   SECTION_LABEL="$(jq -r ".labels.sections.\"$SECTION_LETTER\"" "$TRACKER_CFG")"
   TASK_ISSUE_URL=$(gh issue create --repo "$TRACKER_REPO" \
     --title "[PREFIX-NNN] Task Title" \
     --body "$(cat <<'EOF'
   **Code:** PREFIX-NNN | **Priority:** PRIORITY | **Section:** SEZIONE X | **Dependencies:** DEPS
   **Promoted from:** [IDEA-NNN] #IDEA_ISSUE

   ## Descrizione
   [DESCRIZIONE content]

   ## Dettagli Tecnici
   [DETTAGLI TECNICI content]

   ## File Coinvolti
   **CREARE:** list
   **MODIFICARE:** list

   ---
   *Generated by Claude Code via `/idea-approve`*
   EOF
   )" \
     --label "claude-code,task,$PRIORITY_LABEL,status:todo,$SECTION_LABEL")
   ```

3. Extract the task issue number and write `GitHub: #NNN` to the new task block in `to-do.txt`.

4. **Cross-reference** between the idea and task issues:
   ```bash
   TASK_ISSUE_NUM=$(echo "$TASK_ISSUE_URL" | grep -oE '[0-9]+$')
   gh issue comment "$IDEA_ISSUE" --repo "$TRACKER_REPO" --body "Task issue: #$TASK_ISSUE_NUM" 2>/dev/null || true
   ```

**Local only mode:** Skip this step entirely.

**If any `gh` command fails:** Warn but do NOT fail — in dual sync mode the local operations are already complete. In GitHub-only mode, report the failure clearly since no local fallback exists.

### Step 10: Confirm and Report

After successfully completing all operations, report:

> "Idea **IDEA-NNN** has been approved and promoted to task **PREFIX-NNN — Task Title**.
>
> - **Task code:** PREFIX-NNN
> - **Priority:** HIGH/MEDIUM/LOW or ALTA/MEDIA/BASSA
> - **Dependencies:** list or None/Nessuna
> - **Section:** SECTION X — Section Name
> - **Files to create:** N
> - **Files to modify:** N
>
> *(mode-specific details below)*

**GitHub-only mode:** "The idea issue has been closed and the task issue has been created on GitHub. Pick it up with `/task-pick PREFIX-NNN`."

**Dual sync mode:** "The idea has been removed from `ideas.txt`. The task is now in `to-do.txt` and synced to GitHub. Pick it up with `/task-pick PREFIX-NNN`."

**Local only mode:** "The idea has been removed from `ideas.txt`. The task is now in `to-do.txt` and can be picked up with `/task-pick PREFIX-NNN`."

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

## Important Rules

1. **This is the ONLY way ideas become tasks** — ideas must never be added to the task pipeline by any other means.
2. **In local/dual mode, NEVER modify `progressing.txt` or `done.txt`** — only add to `to-do.txt` and remove from `ideas.txt`.
3. **NEVER reuse a task number** — always use global max + 1.
4. **NEVER skip user confirmation** — always present the draft and wait for approval.
5. **Language rules:** GitHub-only mode uses English for all content. Local/dual sync mode uses Italian for task block content.
6. **Accurate file paths** — verify with `Glob` before listing.
7. **Follow the exact task formatting** — in local/dual mode use same indentation, dash count (78), field order as existing tasks.
8. **NEVER use the `KEYS` prefix** — permanently cancelled.
9. **Always remove the approved idea from its source** — in local/dual mode remove from `ideas.txt`; in GitHub-only mode close the idea issue. An approved idea must not remain in the backlog.
10. **GitHub-only mode has no local files** — never read or write `ideas.txt`, `to-do.txt`, `progressing.txt`, or `done.txt` when in GitHub-only mode.
