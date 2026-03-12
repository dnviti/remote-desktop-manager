---
name: task-create
description: Create a new task in the project backlog with auto-assigned ID, codebase-informed technical details, and proper formatting.
disable-model-invocation: true
argument-hint: "[task description]"
---

# Create a New Task

You are a task creation assistant for the Arsenale project. Your job is to generate properly formatted task blocks and add them to the project backlog.

Always respond and work in English. The task block content (field labels, descriptions, technical details) MUST also be written in **English**.

## Mode Detection

!`python3 .claude/scripts/task_manager.py platform-config`

Use the `mode` field to determine behavior: `platform-only`, `dual-sync`, or `local-only`. The JSON includes `platform`, `enabled`, `sync`, `repo`, `cli` (gh/glab), and `labels`.

## Platform Commands

Use `python3 .claude/scripts/task_manager.py platform-cmd <operation> [key=value ...]` to generate the correct CLI command for the detected platform (GitHub/GitLab).

Supported operations: `list-issues`, `search-issues`, `view-issue`, `edit-issue`, `close-issue`, `comment-issue`, `create-issue`, `create-pr`, `list-pr`, `merge-pr`, `create-release`, `edit-release`.

Example: `python3 .claude/scripts/task_manager.py platform-cmd create-issue title="[CODE] Title" body="Description" labels="task,status:todo"`

## Current Task State

### In Platform-only mode:

#### Next available task ID and existing prefixes (from platform):
In platform-only mode, pipe platform issue titles into the next-id command:
```bash
gh issue list --repo "$TRACKER_REPO" --label task --state all --limit 500 --json title --jq '.[].title' | python3 .claude/scripts/task_manager.py next-id --type task --source platform-titles
```
This returns the same JSON as local mode: `next_number`, `max_found`, `prefixes`. Crypto false positives (AES-256, etc.) are filtered automatically.

### In local only and dual sync modes:

#### Next available task ID and existing prefixes:
!`python3 .claude/scripts/task_manager.py next-id --type task`

#### Section headers in to-do.txt:
!`python3 .claude/scripts/task_manager.py sections --file to-do.txt`

### Section info (Platform-only mode):

In Platform-only mode, section information is derived from the label mappings in `"$TRACKER_CFG"` rather than from `to-do.txt`. Read the `labels.sections` mapping from the config to determine available sections and their labels.

## Arguments

The user wants to create a task for: **$ARGUMENTS**

## Instructions

### Step 1: Validate Input

If `$ARGUMENTS` is empty or unclear, ask the user to describe the task they want to create using `AskUserQuestion`:

> "Please describe the task you want to create. Include what the feature/fix should do and any known technical requirements."

Do NOT proceed without a clear task description.

### Step 2: Determine the Task Code Prefix

Analyze the task description and select an appropriate code prefix.

**Check the existing prefixes** from the data above. Each prefix represents a feature domain in this project.

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
| `SEC` | Security features |

**Rules:**
1. Reuse an existing prefix if the task clearly falls within that domain.
2. If no existing prefix fits, create a new one: 2-6 uppercase letters that clearly abbreviate the feature area.
3. Document the new prefix's domain when presenting the draft.
4. **NEVER use the `KEYS` prefix** — it is permanently cancelled.

### Step 3: Compute the Next Task Number

Task numbering is **globally sequential** across all prefixes.

**All modes:** Use the `next_number` field from the next-id JSON (from the "Current Task State" section above, or from the `platform-titles` pipe command for platform-only mode). The `prefixes` array shows all existing domain prefixes. The script handles global sequencing and crypto false-positive filtering automatically.

### Step 4: Explore the Codebase

Before writing the task block, explore the codebase to generate accurate technical details:

1. **Read the Prisma schema** (`server/prisma/schema.prisma`) — especially if the task involves database changes (new models, enums, fields).
2. **Read relevant existing files** based on the task description:
   - Backend tasks -> check `server/src/routes/`, `server/src/controllers/`, `server/src/services/`, `server/src/middleware/`
   - Frontend tasks -> check `client/src/components/`, `client/src/pages/`, `client/src/store/`, `client/src/hooks/`, `client/src/api/`
   - Infrastructure tasks -> check `docker-compose.dev.yml`, `docker-compose.yml`, Dockerfiles
3. **Look at similar completed tasks** for pattern reference:
   - In local only / dual sync mode: check `done.txt` for a task with similar scope and mirror its structure.
   - In Platform-only mode: search closed issues with `gh issue list --repo "$TRACKER_REPO" --label task --state closed --limit 10 --json title,body` (GitLab: `glab issue list -R "$TRACKER_REPO" -l task --closed --output json | jq '.[:10]'`) for reference.
4. **Identify files to create and modify** — be specific about file paths based on the actual directory structure. Use `Glob` to verify paths exist before listing them under `MODIFY`.

### Step 5: Draft the Task Block

**In Platform-only mode:** Draft the task as a platform issue in **English**.

Platform issue format:
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
  - Backend services, controllers, routes (Express + TypeScript)
  - Frontend components, stores, API calls (React 19 + Vite + MUI v6)
  - Socket.IO / Guacamole WebSocket changes (if applicable)
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

**In local only and dual sync modes:** Draft the task block in **English** using the existing format.

Template:

```
------------------------------------------------------------------------------
[ ] PREFIX-NNN — Task title (concise)
------------------------------------------------------------------------------
  Priority: [HIGH/MEDIUM/LOW]
  Dependencies: [TASK-CODE, TASK-CODE or None]

  DESCRIPTION:
  Multi-line description. Explain WHAT the task does, WHY it is
  needed, and its scope. Technical but readable, approximately
  4-10 lines.

  TECHNICAL DETAILS:
  Detailed technical implementation plan. Structure by layer/file:
    - Prisma schema changes (if needed)
    - Backend services, controllers, routes (Express + TypeScript)
    - Frontend components, stores, API calls (React 19 + Vite + MUI v6)
    - Socket.IO / Guacamole WebSocket changes (if applicable)
    - Configuration changes
  Use indented sub-sections with specific code snippets, type
  definitions, function signatures, and endpoint paths where appropriate.

  Files involved:
    CREATE:  path/to/new/file.ts
    MODIFY:  path/to/existing/file.ts
```

**Formatting rules (local only and dual sync):**
- Header separator lines are exactly 78 dashes: `------------------------------------------------------------------------------`
- Status prefix is `[ ] ` (pending)
- Title line format: `[ ] PREFIX-NNN — Task Title` (use `—` em dash, not `-` hyphen)
- Indent all content with 2 spaces
- Dependencies: use task codes like `AUTH-001, DB-002` or `None` if none
- Section labels in order: `DESCRIPTION:`, `TECHNICAL DETAILS:`, `Files involved:`
- File action labels: `CREATE:` (new files) and `MODIFY:` (existing files), indented 4 spaces
- End with two blank lines after the last file entry

### Step 6: Present the Draft and Ask for Confirmation

Present the complete task block (or platform issue draft) to the user, along with:

1. **Task code:** The generated PREFIX-NNN
2. **Suggested section:** Which section (A-I) it should be placed in, with reasoning
3. **Suggested priority:** HIGH / MEDIUM / LOW, with reasoning

Then use `AskUserQuestion` with these options:
- **"Looks good, create it"** — proceed to Step 7
- **"Needs changes"** — let the user specify what to adjust (section, priority, description, etc.)
- **"Cancel"** — abort without creating

### Step 7: Check for Duplicates

Before writing, perform a final duplicate check:

**In Platform-only mode:**
1. Search platform issues for key concepts:
   ```bash
   gh issue list --repo "$TRACKER_REPO" --label task --state all --search "keyword1 keyword2" --json title,number,state --jq '.[] | "#\(.number) [\(.state)] \(.title)"'
   # GitLab: glab issue list -R "$TRACKER_REPO" -l task --search "keyword1 keyword2" --output json | jq '.[] | "#\(.iid) [\(.state)] \(.title)"'
   ```
2. If a potentially similar task is found, warn the user and ask whether to proceed or abort.
3. If no duplicates found, continue to Step 8.

**In local only and dual sync modes:**
1. Run: `python3 .claude/scripts/task_manager.py duplicates --keywords "keyword1,keyword2,keyword3"`
   Use 2-3 key terms from the task title and description as keywords.
2. If the JSON output contains matches that look like a similar task, warn the user and ask whether to proceed or abort.
3. If no duplicates found, continue to Step 8.

### Step 8: Insert the Task into to-do.txt

**In Platform-only mode:** Skip this step entirely.

**In local only and dual sync modes:**

Determine the correct insertion point based on the confirmed section.

**Insertion rules:**
1. Use the section data from the "Section headers" JSON above to find the target section's line number.
2. Read that range of lines to find the last task block in the section.
3. Insert the new task block **after the last existing task** in the section (or after the section header + blank lines if the section is empty).
4. Maintain whitespace conventions: two blank lines between tasks, two blank lines before the next section header.

Use the `Edit` tool to insert the task block at the correct position.

### Step 8.5: Sync to Platform Issues

**In Platform-only mode:** This is the **primary write** step. Create the platform issue:

1. Read the label mappings from config:
   ```bash
   PRIORITY_LABEL="$(jq -r ".labels.priority.\"$PRIORITY\"" "$TRACKER_CFG")"
   SECTION_LABEL="$(jq -r ".labels.sections.\"$SECTION_LETTER\"" "$TRACKER_CFG")"
   ```

2. Create the platform issue:
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
   # GitLab: glab issue create -R "$TRACKER_REPO" --title "[PREFIX-NNN] Task Title" --description "BODY" -l "claude-code,task,$PRIORITY_LABEL,status:todo,$SECTION_LABEL"
   ```

3. If the platform CLI command fails, report the error to the user. In Platform-only mode this is a hard failure since there is no local fallback.

**In dual sync mode:**

1. Read the label mappings from config:
   ```bash
   PRIORITY_LABEL="$(jq -r ".labels.priority.\"$PRIORITY\"" "$TRACKER_CFG")"
   SECTION_LABEL="$(jq -r ".labels.sections.\"$SECTION_LETTER\"" "$TRACKER_CFG")"
   ```

2. Create the platform issue:
   ```bash
   ISSUE_URL=$(gh issue create --repo "$TRACKER_REPO" \
     --title "[PREFIX-NNN] Task Title" \
     --body "$(cat <<'EOF'
   **Code:** PREFIX-NNN | **Priority:** PRIORITY | **Section:** SECTION_NAME | **Dependencies:** DEPS

   ## Description
   [DESCRIPTION content from the task block]

   ## Technical Details
   [TECHNICAL DETAILS content from the task block]

   ## Files Involved
   **CREATE:** list of files
   **MODIFY:** list of files

   ---
   *Generated by Claude Code via `/task-create`*
   EOF
   )" \
     --label "claude-code,task,$PRIORITY_LABEL,status:todo,$SECTION_LABEL")
   # GitLab: glab issue create -R "$TRACKER_REPO" --title "[PREFIX-NNN] Task Title" --description "BODY" -l "claude-code,task,$PRIORITY_LABEL,status:todo,$SECTION_LABEL"
   ```

3. Extract the issue number from the URL:
   ```bash
   ISSUE_NUM=$(echo "$ISSUE_URL" | grep -oE '[0-9]+$')
   ```

4. Write the issue reference back to the task block in `to-do.txt`. Add a `GitHub: #NNN` line after the `Dependencies:` line using the `Edit` tool.

5. If the `gh` command fails, warn the user that GitHub sync failed but do NOT fail the task creation — the task is already in `to-do.txt`.

**In local only mode:** Skip this step entirely.

### Step 9: Confirm and Report

After successfully creating the task, report:

**In Platform-only mode:**

> "Task **PREFIX-NNN — Task Title** has been created as platform issue.
>
> - **Code:** PREFIX-NNN
> - **Priority:** HIGH/MEDIUM/LOW
> - **Dependencies:** list or None
> - **Section:** SECTION_NAME
> - **Files to create:** N
> - **Files to modify:** N
> - **GitHub Issue:** #NNN (URL)"

**In dual sync mode:**

> "Task **PREFIX-NNN — Task Title** has been created in `to-do.txt`, SECTION X.
>
> - **Code:** PREFIX-NNN
> - **Priority:** HIGH/MEDIUM/LOW
> - **Dependencies:** list or None
> - **Section:** SECTION X — Section Name
> - **Files to create:** N
> - **Files to modify:** N
> - **GitHub Issue:** #NNN (URL) *(only if GitHub sync succeeded)*"

**In local only mode:**

> "Task **PREFIX-NNN — Task Title** has been created in `to-do.txt`, SECTION X.
>
> - **Code:** PREFIX-NNN
> - **Priority:** HIGH/MEDIUM/LOW
> - **Dependencies:** list or None
> - **Section:** SECTION X — Section Name
> - **Files to create:** N
> - **Files to modify:** N"

## Section Selection Guide

Sections are defined in `to-do.txt` (local/dual mode) or in the label mappings (platform-only mode). Read the section headers to understand the project's organizational structure.

**Available sections (A-I):**

| Section | Name | Use when... |
|---------|------|------------|
| A | Core Features | Core features directly needed by end users (connections, UI, auth) |
| B | Suggested Enhancements | Nice-to-have improvements, UX enhancements, quality-of-life features |
| C | Multi-Tenant / Teams / Permissions | Multi-tenant, team management, permissions, role-based access |
| D | Multi-Backend / Multi-Gateway | Backend infrastructure, gateway management, multi-backend routing |
| E | Zero Trust Hardening | Security hardening, zero trust, rate limiting, security headers |
| F | Password Keychain / Secret Vault | Password keychain, secret vault, credential management beyond basic |
| G | Gateway Orchestration / Auto-Scaling | Gateway orchestration, container scaling, session tracking |
| H | Scouted Features | Features discovered via `/task-scout` |
| I | SSO / Identity Federation | SSO, SAML, OIDC, identity federation features |

If the task does not clearly fit any existing section, suggest Section B (enhancements) and note this to the user. If needed, propose a new section.

## Important Rules

1. **In local only and dual sync modes, NEVER modify `progressing.txt` or `done.txt`** — only append to `to-do.txt`.
2. **NEVER create duplicate tasks** — always cross-reference existing tasks first (platform issues in Platform-only mode, local files in local/dual mode).
3. **NEVER reuse a task number that already exists** — always use global max + 1.
4. **NEVER skip user confirmation** — always present the draft and wait for approval.
5. **English content in task blocks** — field labels (`Priority`, `Dependencies`, `DESCRIPTION`, `TECHNICAL DETAILS`, `Files involved`, `CREATE`, `MODIFY`) and descriptions are always in English.
6. **Accurate file paths** — only reference files that actually exist (for `MODIFY`) or directories that exist (for `CREATE`). Verify with `Glob` before listing.
7. **Follow the exact formatting** — in local/dual mode: same indentation, same dash count (78), same field order as existing tasks. In Platform-only mode: use the platform issue markdown format specified in Step 5.
8. **In Platform-only mode, NEVER modify local task files** (`to-do.txt`, `progressing.txt`, `done.txt`) — all operations go through platform issues exclusively.
9. **NEVER use the `KEYS` prefix** — permanently cancelled.
