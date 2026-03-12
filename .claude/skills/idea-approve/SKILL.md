---
name: idea-approve
description: Approve an idea, convert it into a full task with technical details, and promote it to the task pipeline. This is the ONLY bridge from ideas to tasks.
disable-model-invocation: true
argument-hint: "[IDEA-NNN]"
---

# Approve an Idea

You are the idea approval gateway for the Arsenale project. Your job is to take an idea, flesh it out with codebase-informed technical details, and promote it to a full task.

This skill is the **ONLY** bridge between the idea backlog and the task pipeline. Ideas must go through this process to become actionable tasks.

Always respond and work in English. The task block content (field labels, descriptions, technical details) MUST also be written in **English**.

## Mode Detection

!`python3 .claude/scripts/task_manager.py platform-config`

Use the `mode` field to determine behavior: `platform-only`, `dual-sync`, or `local-only`. The JSON includes `platform`, `enabled`, `sync`, `repo`, `cli` (gh/glab), and `labels`.

## Platform Commands

Use `python3 .claude/scripts/task_manager.py platform-cmd <operation> [key=value ...]` to generate the correct CLI command for the detected platform (GitHub/GitLab).

Supported operations: `list-issues`, `search-issues`, `view-issue`, `edit-issue`, `close-issue`, `comment-issue`, `create-issue`, `create-pr`, `list-pr`, `merge-pr`, `create-release`, `edit-release`.

Example: `python3 .claude/scripts/task_manager.py platform-cmd create-issue title="[CODE] Title" body="Description" labels="task,status:todo"`

## Current State

### Platform-only mode queries:

Ideas available for approval:
!`CFG=".claude/issues-tracker.json"; [ ! -f "$CFG" ] && CFG=".claude/github-issues.json"; jq -r 'if (.enabled == true) and (.sync != true) then .repo else empty end' "$CFG" 2>/dev/null | xargs -I{} gh issue list --repo {} --label idea --state open --json number,title --jq '.[] | "#\(.number) \(.title)"' 2>/dev/null`

Next available task ID (from platform):
In platform-only mode, pipe platform issue titles into:
```bash
gh issue list --repo "$TRACKER_REPO" --label task --state all --limit 500 --json title --jq '.[].title' | python3 .claude/scripts/task_manager.py next-id --type task --source platform-titles
```

### Local / dual sync mode queries:

Ideas available for approval:
!`python3 .claude/scripts/task_manager.py list-ideas --file ideas --format summary`

Next available task ID and existing prefixes:
!`python3 .claude/scripts/task_manager.py next-id --type task`

Section headers in to-do.txt:
!`python3 .claude/scripts/task_manager.py sections --file to-do.txt`

## Arguments

The user wants to approve: **$ARGUMENTS**

## Instructions

### Step 1: Select the Idea

**Platform-only mode:**
- **If an IDEA-NNN code was provided**: Search platform issues: `gh issue list --repo "$TRACKER_REPO" --search "[IDEA-NNN] in:title" --label idea --state open --json number,title`. If not found, inform the user and list available idea issues.
  <!-- GitLab: glab issue list -R "$TRACKER_REPO" --search "[IDEA-NNN]" -l idea --output json -->
- **If no argument was provided**: List all open idea issues from the Current State data above. Use `AskUserQuestion` to ask the user which idea to approve.
- If there are no open idea issues, inform the user: "No ideas available for approval. Use `/idea-create` to add ideas first."

**Local / dual sync mode:**
- **If an IDEA-NNN code was provided**: Find that idea in `ideas.txt`. If not found, inform the user and list available ideas.
- **If no argument was provided**: List all ideas from `ideas.txt` with their codes, titles, and categories. Use `AskUserQuestion` to ask the user which idea to approve.
- If `ideas.txt` has no ideas, inform the user: "No ideas available for approval. Use `/idea-create` to add ideas first."

### Step 2: Read the Full Idea

**Platform-only mode:**
- Fetch the full idea issue body: `gh issue view IDEA_ISSUE_NUMBER --repo "$TRACKER_REPO" --json title,body,number`
  <!-- GitLab: glab issue view IDEA_ISSUE_NUMBER -R "$TRACKER_REPO" --output json -->
- Extract the title, description, and motivation from the issue body.

**Local / dual sync mode:**
Get the full parsed idea data:
```bash
python3 .claude/scripts/task_manager.py parse IDEA-NNN
```
This returns all fields as JSON: title, category, date, description, motivation.

Present the idea to the user as context for what will be converted.

### Step 3: Determine the Task Code Prefix

Analyze the idea's description and category to select an appropriate task prefix.

**Check the existing prefixes** from the data above. Each prefix represents a feature domain.

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
1. Reuse an existing prefix if the idea clearly falls within that domain.
2. If no existing prefix fits, create a new one: 2-6 uppercase letters that clearly abbreviate the feature area.
3. **NEVER use the `KEYS` prefix** — it is permanently cancelled.

### Step 4: Compute the Next Task Number

Task numbering is **globally sequential** across all prefixes.

**All modes:** Use the `next_number` field from the next-id JSON (from the "Current State" section above, or from the `platform-titles` pipe command for platform-only mode). The script handles global sequencing and crypto false-positive filtering automatically.

### Step 5: Explore the Codebase

Before writing the task, explore the codebase to generate accurate technical details:

1. **Read the Prisma schema** (`server/prisma/schema.prisma`) — especially if the idea involves database changes.
2. **Read relevant existing files** based on the idea description:
   - Backend ideas -> check `server/src/routes/`, `server/src/controllers/`, `server/src/services/`, `server/src/middleware/`
   - Frontend ideas -> check `client/src/components/`, `client/src/pages/`, `client/src/store/`, `client/src/hooks/`, `client/src/api/`
   - Infrastructure ideas -> check `docker-compose.dev.yml`, `docker-compose.yml`, Dockerfiles
3. **Look at similar completed tasks** — in local/dual mode check `done.txt`, in platform-only mode search closed task issues.
4. **Identify files to create and modify** — be specific about file paths. Use `Glob` to verify paths exist before listing them.

### Step 6: Draft the Full Task

**Platform-only mode — draft as a platform issue in English:**

Title: `[PREFIX-NNN] Task Title`

Body:
```
**Code:** PREFIX-NNN | **Priority:** HIGH/MEDIUM/LOW | **Section:** SECTION_NAME | **Dependencies:** DEPS
**Promoted from:** [IDEA-NNN] #IDEA_ISSUE_NUMBER

## Description
Expanded description in English based on the original idea. More detailed than
the idea, explaining what, why, and the scope. Approximately 4-10 lines.

## Technical Details
Detailed technical implementation plan in English, structured by layer/file.
  - Prisma schema changes (if needed)
  - Backend services, controllers, routes (Express + TypeScript)
  - Frontend components, stores, API calls (React 19 + Vite + MUI v6)
  - Socket.IO / Guacamole WebSocket changes (if applicable)
  - Configuration changes
Include specific code snippets, function signatures, endpoint paths.

## Files Involved
**CREATE:** path/to/new/file.ts
**MODIFY:** path/to/existing/file.ts

---
*Generated by Claude Code via `/idea-approve`*
```

**Local / dual sync mode — draft as a task block in English:**

```
------------------------------------------------------------------------------
[ ] PREFIX-NNN — Task title (concise)
------------------------------------------------------------------------------
  Priority: [HIGH/MEDIUM/LOW]
  Dependencies: [TASK-CODE, TASK-CODE or None]

  DESCRIPTION:
  Expanded description based on the original idea's DESCRIPTION
  and MOTIVATION. More detailed than the idea, explaining WHAT, WHY,
  and the scope. Approximately 4-10 lines.

  TECHNICAL DETAILS:
  Detailed technical implementation plan. Structure by layer/file:
    - Prisma schema changes (if needed)
    - Backend services, controllers, routes (Express + TypeScript)
    - Frontend components, stores, API calls (React 19 + Vite + MUI v6)
    - Socket.IO / Guacamole WebSocket changes (if applicable)
    - Configuration changes
  This section is NEW — the original idea did not have this.
  Include specific code snippets, function signatures, endpoint paths.

  Files involved:
    CREATE:  path/to/new/file.ts
    MODIFY:  path/to/existing/file.ts
```

**Formatting rules (local / dual sync mode only):**
- Header separator lines are exactly 78 dashes
- Status prefix is `[ ] ` (pending)
- Title line format: `[ ] PREFIX-NNN — Task Title` (use `—` em dash)
- Indent all content with 2 spaces
- Dependencies: use task codes or `None`
- Section labels: `DESCRIPTION:`, `TECHNICAL DETAILS:`, `Files involved:`
- File action labels: `CREATE:` and `MODIFY:`, indented 4 spaces
- End with two blank lines

### Step 7: Present the Draft and Ask for Confirmation

Present the complete task (issue draft or task block) to the user, along with:

1. **Original idea:** IDEA-NNN and its title
2. **New task code:** PREFIX-NNN
3. **Suggested section:** Which section (A-I) and why
4. **Suggested priority:** HIGH / MEDIUM / LOW and why

Then use `AskUserQuestion` with these options:
- **"Looks good, approve it"** — proceed to Step 8
- **"Needs changes"** — let the user specify adjustments
- **"Cancel"** — abort without approving

### Step 8: Check for Duplicates

**Platform-only mode:**
Search platform issues for similar tasks:
```bash
gh issue list --repo "$TRACKER_REPO" --label task --state all --search "keyword1" --json number,title,state
# GitLab: glab issue list -R "$TRACKER_REPO" -l task --search "keyword1" --output json
gh issue list --repo "$TRACKER_REPO" --label task --state all --search "keyword2" --json number,title,state
# GitLab: glab issue list -R "$TRACKER_REPO" -l task --search "keyword2" --output json
```

**Local / dual sync mode:**
Run: `python3 .claude/scripts/task_manager.py duplicates --keywords "keyword1,keyword2,keyword3" --files "to-do.txt,progressing.txt,done.txt"`

Use 2-3 key terms from the task title and description. If the JSON output contains matches that look like a similar task, warn the user and ask whether to proceed or abort.

### Step 9: Insert the Task and Remove the Idea

This step varies by mode:

**Platform-only mode:**
Skip local file operations entirely. The task issue creation and idea issue closure happen in Step 9.5.

**Local / dual sync mode — two operations:**

**9a. Add the task to `to-do.txt`:**
1. Use the section data from the "Section headers" JSON above to find the target section's line number.
2. Find the last task block in the section.
3. Insert the new task block after the last existing task using the `Edit` tool.
4. Maintain whitespace conventions: two blank lines between tasks.

**9b. Remove the idea from `ideas.txt`:**
Run: `python3 .claude/scripts/task_manager.py remove IDEA-NNN --file ideas.txt`
This cleanly removes the idea block and handles whitespace cleanup automatically.

### Step 9.5: Sync to GitHub Issues

**Platform-only mode** — this IS the primary operation:

1. **Close the idea issue:**
   ```bash
   IDEA_ISSUE=$(gh issue list --repo "$TRACKER_REPO" --search "[IDEA-NNN] in:title" --label idea --state open --json number --jq '.[0].number' 2>/dev/null)
   # GitLab: IDEA_ISSUE=$(glab issue list -R "$TRACKER_REPO" --search "[IDEA-NNN]" -l idea --output json | jq '.[0].iid')
   ```
   If found:
   ```bash
   gh issue close "$IDEA_ISSUE" --repo "$TRACKER_REPO" --comment "Approved and promoted to task [PREFIX-NNN]." 2>/dev/null || true
   # GitLab: glab issue close "$IDEA_ISSUE" -R "$TRACKER_REPO"
   # GitLab: glab issue note "$IDEA_ISSUE" -R "$TRACKER_REPO" -m "Approved and promoted to task [PREFIX-NNN]."
   ```

2. **Create the task issue:**
   ```bash
   PRIORITY_LABEL="$(jq -r ".labels.priority.\"$PRIORITY\"" "$TRACKER_CFG")"
   SECTION_LABEL="$(jq -r ".labels.sections.\"$SECTION_LETTER\"" "$TRACKER_CFG")"
   TASK_ISSUE_URL=$(gh issue create --repo "$TRACKER_REPO" \
     --title "[PREFIX-NNN] Task Title" \
     --body "$(cat <<'EOF'
   **Code:** PREFIX-NNN | **Priority:** HIGH/MEDIUM/LOW | **Section:** SECTION_NAME | **Dependencies:** DEPS
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
   # GitLab: glab issue create -R "$TRACKER_REPO" --title "[PREFIX-NNN] Task Title" --description "BODY" -l "claude-code,task,$PRIORITY_LABEL,status:todo,$SECTION_LABEL"
   ```

3. **Cross-reference** between the idea and task issues:
   ```bash
   TASK_ISSUE_NUM=$(echo "$TASK_ISSUE_URL" | grep -oE '[0-9]+$')
   gh issue comment "$IDEA_ISSUE" --repo "$TRACKER_REPO" --body "Task issue: #$TASK_ISSUE_NUM" 2>/dev/null || true
   # GitLab: glab issue note "$IDEA_ISSUE" -R "$TRACKER_REPO" -m "Task issue: #$TASK_ISSUE_NUM"
   ```

**Dual sync mode** — sync after local operations:

1. **Close the idea issue:**
   ```bash
   IDEA_ISSUE=$(gh issue list --repo "$TRACKER_REPO" --search "[IDEA-NNN] in:title" --label idea --state open --json number --jq '.[0].number' 2>/dev/null)
   # GitLab: IDEA_ISSUE=$(glab issue list -R "$TRACKER_REPO" --search "[IDEA-NNN]" -l idea --output json | jq '.[0].iid')
   ```
   If found:
   ```bash
   gh issue close "$IDEA_ISSUE" --repo "$TRACKER_REPO" --comment "Approved and promoted to task [PREFIX-NNN]." 2>/dev/null || true
   # GitLab: glab issue close "$IDEA_ISSUE" -R "$TRACKER_REPO"
   # GitLab: glab issue note "$IDEA_ISSUE" -R "$TRACKER_REPO" -m "Approved and promoted to task [PREFIX-NNN]."
   ```

2. **Create the task issue:**
   ```bash
   PRIORITY_LABEL="$(jq -r ".labels.priority.\"$PRIORITY\"" "$TRACKER_CFG")"
   SECTION_LABEL="$(jq -r ".labels.sections.\"$SECTION_LETTER\"" "$TRACKER_CFG")"
   TASK_ISSUE_URL=$(gh issue create --repo "$TRACKER_REPO" \
     --title "[PREFIX-NNN] Task Title" \
     --body "$(cat <<'EOF'
   **Code:** PREFIX-NNN | **Priority:** PRIORITY | **Section:** SECTION_NAME | **Dependencies:** DEPS
   **Promoted from:** [IDEA-NNN] #IDEA_ISSUE

   ## Description
   [DESCRIPTION content from the task block]

   ## Technical Details
   [TECHNICAL DETAILS content from the task block]

   ## Files Involved
   **CREATE:** list
   **MODIFY:** list

   ---
   *Generated by Claude Code via `/idea-approve`*
   EOF
   )" \
     --label "claude-code,task,$PRIORITY_LABEL,status:todo,$SECTION_LABEL")
   # GitLab: glab issue create -R "$TRACKER_REPO" --title "[PREFIX-NNN] Task Title" --description "BODY" -l "claude-code,task,$PRIORITY_LABEL,status:todo,$SECTION_LABEL"
   ```

3. Extract the task issue number and write `GitHub: #NNN` to the new task block in `to-do.txt`.

4. **Cross-reference** between the idea and task issues:
   ```bash
   TASK_ISSUE_NUM=$(echo "$TASK_ISSUE_URL" | grep -oE '[0-9]+$')
   gh issue comment "$IDEA_ISSUE" --repo "$TRACKER_REPO" --body "Task issue: #$TASK_ISSUE_NUM" 2>/dev/null || true
   # GitLab: glab issue note "$IDEA_ISSUE" -R "$TRACKER_REPO" -m "Task issue: #$TASK_ISSUE_NUM"
   ```

**Local only mode:** Skip this step entirely.

**If any `gh`/`glab` command fails:** Warn but do NOT fail — in dual sync mode the local operations are already complete. In platform-only mode, report the failure clearly since no local fallback exists.

### Step 10: Confirm and Report

After successfully completing all operations, report:

> "Idea **IDEA-NNN** has been approved and promoted to task **PREFIX-NNN — Task Title**.
>
> - **Task code:** PREFIX-NNN
> - **Priority:** HIGH/MEDIUM/LOW
> - **Dependencies:** list or None
> - **Section:** SECTION X — Section Name
> - **Files to create:** N
> - **Files to modify:** N
>
> *(mode-specific details below)*

**Platform-only mode:** "The idea issue has been closed and the task issue has been created on the platform. Pick it up with `/task-pick PREFIX-NNN`."

**Dual sync mode:** "The idea has been removed from `ideas.txt`. The task is now in `to-do.txt` and synced to the platform. Pick it up with `/task-pick PREFIX-NNN`."

**Local only mode:** "The idea has been removed from `ideas.txt`. The task is now in `to-do.txt` and can be picked up with `/task-pick PREFIX-NNN`."

## Section Selection Guide

Sections are defined in `to-do.txt` (local/dual mode) or in the label mappings (platform-only mode).

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

If the task does not clearly fit any existing section, suggest Section B (enhancements) and note this to the user.

## Important Rules

1. **This is the ONLY way ideas become tasks** — ideas must never be added to the task pipeline by any other means.
2. **In local/dual mode, NEVER modify `progressing.txt` or `done.txt`** — only add to `to-do.txt` and remove from `ideas.txt`.
3. **NEVER reuse a task number** — always use global max + 1.
4. **NEVER skip user confirmation** — always present the draft and wait for approval.
5. **English content** — all task block content and platform issue content in English across all modes.
6. **Accurate file paths** — verify with `Glob` before listing.
7. **Follow the exact task formatting** — in local/dual mode use same indentation, dash count (78), field order as existing tasks.
8. **Always remove the approved idea from its source** — in local/dual mode remove from `ideas.txt`; in platform-only mode close the idea issue. An approved idea must not remain in the backlog.
9. **Platform-only mode has no local files** — never read or write `ideas.txt`, `to-do.txt`, `progressing.txt`, or `done.txt` when in platform-only mode.
10. **NEVER use the `KEYS` prefix** — permanently cancelled.
