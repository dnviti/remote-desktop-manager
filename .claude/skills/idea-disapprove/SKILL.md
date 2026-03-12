---
name: idea-disapprove
description: Disapprove an idea by moving it from ideas.txt to idea-disapproved.txt (local mode) or closing the GitHub/GitLab Issue with a rejection reason (Platform-only mode).
disable-model-invocation: true
argument-hint: "[IDEA-NNN]"
---

# Disapprove an Idea

You are the idea triage assistant for this project. Your job is to reject ideas, recording the reason for disapproval.

Always respond and work in English.

## Mode Detection

!`python3 .claude/scripts/task_manager.py platform-config`

Use the `mode` field to determine behavior: `platform-only`, `dual-sync`, or `local-only`. The JSON includes `platform`, `enabled`, `sync`, `repo`, `cli` (gh/glab), and `labels`.

## Platform Commands

Use `python3 .claude/scripts/task_manager.py platform-cmd <operation> [key=value ...]` to generate the correct CLI command for the detected platform (GitHub/GitLab).

Supported operations: `list-issues`, `search-issues`, `view-issue`, `edit-issue`, `close-issue`, `comment-issue`, `create-issue`, `create-pr`, `list-pr`, `merge-pr`, `create-release`, `edit-release`.

Example: `python3 .claude/scripts/task_manager.py platform-cmd create-issue title="[CODE] Title" body="Description" labels="task,status:todo"`

## Current State

### Platform-only mode — ideas available:

```bash
gh issue list --repo "$TRACKER_REPO" --label "idea" --state open --json number,title --jq '.[] | "#\(.number) \(.title)"' 2>/dev/null
# GitLab: glab issue list -R "$TRACKER_REPO" -l "idea" --state opened --output json | jq '.[] | "#\(.iid) \(.title)"' 2>/dev/null
```

### Local/Dual mode — ideas available for disapproval:
!`python3 .claude/scripts/task_manager.py list-ideas --file ideas --format summary`

### Local/Dual mode — already disapproved ideas:
!`python3 .claude/scripts/task_manager.py list-ideas --file disapproved --format summary`

## Arguments

The user wants to disapprove: **$ARGUMENTS**

## Instructions

### Step 1: Select the Idea

**In Platform-only mode:**
- If an IDEA-NNN code was provided: `gh issue list --repo "$TRACKER_REPO" --search "[IDEA-NNN] in:title" --label idea --state open --json number,title,body` (GitLab: `glab issue list -R "$TRACKER_REPO" --search "[IDEA-NNN]" -l idea --state opened --output json`)
- If no argument: list all open ideas from GitHub and use `AskUserQuestion` to ask which to disapprove.

**In local/dual mode:**
- If an IDEA-NNN code was provided: Find that idea in `ideas.txt`. If not found, inform the user and list available ideas.
- If no argument: List all ideas from `ideas.txt` and use `AskUserQuestion`.

If no ideas are available, inform the user: "No ideas available for disapproval."

### Step 2: Show the Full Idea

**In Platform-only mode:**
- Read the issue body: `gh issue view $ISSUE_NUM --repo "$TRACKER_REPO" --json title,body` (GitLab: `glab issue view $ISSUE_NUM -R "$TRACKER_REPO" --output json | jq '{title,description}'`)

**In local/dual mode:**
Get the full parsed idea data:
```bash
python3 .claude/scripts/task_manager.py parse IDEA-NNN
```
Present the idea fields (title, category, description, motivation) to the user so they can review what they are disapproving.

### Step 3: Ask for the Disapproval Reason

Use `AskUserQuestion` to ask:

> "Why is this idea being disapproved?"

Provide common options:
- **"Already implemented"** — the functionality already exists in the codebase
- **"Duplicate of existing task"** — a task already covers this
- **"Out of scope"** — doesn't fit the project's direction
- **"Not feasible"** — technical constraints make it impractical

The user can also provide a custom reason via "Other".

### Step 4: Confirm the Disapproval

Present a summary and use `AskUserQuestion`:

> "About to disapprove **IDEA-NNN — Title**.
> Reason: [selected reason]"

Options:
- **"Yes, disapprove it"** — proceed
- **"Cancel"** — abort

### Step 5: Execute the Disapproval

**In Platform-only mode:**

Close the GitHub/GitLab Issue with the rejection reason:
```bash
IDEA_ISSUE=$(gh issue list --repo "$TRACKER_REPO" --search "[IDEA-NNN] in:title" --label idea --state open --json number --jq '.[0].number' 2>/dev/null)
# GitLab: IDEA_ISSUE=$(glab issue list -R "$TRACKER_REPO" --search "[IDEA-NNN]" -l idea --state opened --output json | jq '.[0].iid' 2>/dev/null)
gh issue close "$IDEA_ISSUE" --repo "$TRACKER_REPO" --reason "not planned" --comment "Idea disapproved. Reason: $REASON" 2>/dev/null || true
# GitLab: glab issue close "$IDEA_ISSUE" -R "$TRACKER_REPO" 2>/dev/null || true
# GitLab: glab issue note "$IDEA_ISSUE" -R "$TRACKER_REPO" -m "Idea disapproved. Reason: $REASON" 2>/dev/null || true
```

**In dual sync mode:**

1. The `parse` output from Step 2 contains the `raw` field with the full block text.
2. **Add the rejection field** to the block. Insert a `REJECTION REASON:` line after the `MOTIVATION:` section:
   ```
     REJECTION REASON:
     [Reason] (YYYY-MM-DD)
   ```
3. **Append the modified block to `idea-disapproved.txt`:**
   Use `Edit` to append the block (with `REJECTION REASON:` added) at the end of `idea-disapproved.txt`.
4. **Remove the idea from `ideas.txt`:**
   Run: `python3 .claude/scripts/task_manager.py remove IDEA-NNN --file ideas.txt`
   This cleanly removes the block and handles whitespace cleanup automatically.
5. **Close the GitHub/GitLab Issue** (same as Platform-only mode above). If the command fails, warn but do NOT fail — the local operations are already complete.

**In local only mode:**

Same as dual sync steps 1-4, but skip the GitHub/GitLab Issue close.

### Step 6: Confirm and Report

After successfully disapproving the idea, report:

> "Idea **IDEA-NNN — Title** has been disapproved.
>
> - **Reason:** [reason]
> - **Date:** YYYY-MM-DD
>
> The idea is no longer in the active backlog."

## Important Rules

1. **NEVER modify task files** (`to-do.txt`, `progressing.txt`, `done.txt`).
2. **NEVER delete ideas permanently** — in local/dual mode, always archive to `idea-disapproved.txt`. In Platform-only mode, the closed issue serves as the archive.
3. **NEVER skip user confirmation** — always confirm before disapproving.
4. **English content** — the `REJECTION REASON:` field and its content must be in English.
5. **Preserve formatting** — maintain the idea block's indentation, dash count (78), and field order when moving (local/dual mode).
6. **Clean removal** — after removing an idea from `ideas.txt`, ensure no orphaned separator lines or excessive blank lines remain.
