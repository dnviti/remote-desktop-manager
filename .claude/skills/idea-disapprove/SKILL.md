---
name: idea-disapprove
description: Disapprove an idea by moving it from ideas.txt to idea-disapproved.txt (local mode) or closing the GitHub Issue with a rejection reason (GitHub-only mode).
disable-model-invocation: true
argument-hint: "[IDEA-NNN]"
---

# Disapprove an Idea

You are the idea triage assistant for the Arsenale project. Your job is to reject ideas, recording the reason for disapproval.

Always respond and work in English.

## Mode Detection

```bash
TRACKER_CFG=".claude/issues-tracker.json"; [ ! -f "$TRACKER_CFG" ] && TRACKER_CFG=".claude/github-issues.json"
PLATFORM="$(jq -r '.platform // "github"' "$TRACKER_CFG" 2>/dev/null)"
TRACKER_ENABLED="$(jq -r '.enabled // false' "$TRACKER_CFG" 2>/dev/null)"
TRACKER_SYNC="$(jq -r '.sync // false' "$TRACKER_CFG" 2>/dev/null)"
TRACKER_REPO="$(jq -r '.repo' "$TRACKER_CFG" 2>/dev/null)"
```

- **Platform-only mode** (`TRACKER_ENABLED=true` AND `TRACKER_SYNC != true`): Close the GitHub Issue with rejection reason. No local file operations.
- **Dual sync mode** (`TRACKER_ENABLED=true` AND `TRACKER_SYNC=true`): Move idea in local files, then close GitHub Issue.
- **Local only mode** (`TRACKER_ENABLED=false` or config missing): Move idea from `ideas.txt` to `idea-disapproved.txt`.

## Current State

### GitHub-only mode — ideas available:

```bash
gh issue list --repo "$TRACKER_REPO" --label "idea" --state open --json number,title --jq '.[] | "#\(.number) \(.title)"' 2>/dev/null
```

### Local/Dual mode — ideas available for disapproval:
!`grep -E '^IDEA-[0-9]{3}' ideas.txt 2>/dev/null | tr -d '\r'`

### Local/Dual mode — already disapproved ideas:
!`grep -E '^IDEA-[0-9]{3}' idea-disapproved.txt 2>/dev/null | tr -d '\r'`

## Arguments

The user wants to disapprove: **$ARGUMENTS**

## Instructions

### Step 1: Select the Idea

**In GitHub-only mode:**
- If an IDEA-NNN code was provided: `gh issue list --repo "$TRACKER_REPO" --search "[IDEA-NNN] in:title" --label idea --state open --json number,title,body`
- If no argument: list all open ideas from GitHub and use `AskUserQuestion` to ask which to disapprove.

**In local/dual mode:**
- If an IDEA-NNN code was provided: Find that idea in `ideas.txt`. If not found, inform the user and list available ideas.
- If no argument: List all ideas from `ideas.txt` and use `AskUserQuestion`.

If no ideas are available, inform the user: "No ideas available for disapproval."

### Step 2: Show the Full Idea

**In GitHub-only mode:**
- Read the issue body: `gh issue view $ISSUE_NUM --repo "$TRACKER_REPO" --json title,body`

**In local/dual mode:**
- Read the complete idea block from `ideas.txt` (everything between `------` separator lines).

Present the idea to the user so they can review what they are disapproving.

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

**In GitHub-only mode:**

Close the GitHub Issue with the rejection reason:
```bash
IDEA_ISSUE=$(gh issue list --repo "$TRACKER_REPO" --search "[IDEA-NNN] in:title" --label idea --state open --json number --jq '.[0].number' 2>/dev/null)
gh issue close "$IDEA_ISSUE" --repo "$TRACKER_REPO" --reason "not planned" --comment "Idea disapproved. Reason: $REASON" 2>/dev/null || true
```

**In dual sync mode:**

1. Read the full idea block from `ideas.txt` (between `------` separators, inclusive).
2. Add `MOTIVO RIFIUTO:` line after `MOTIVAZIONE:` section:
   ```
     MOTIVO RIFIUTO:
     [Reason in Italian] (YYYY-MM-DD)
   ```
   Translate the user's reason into Italian:
   - "Already implemented" → "Funzionalita' gia' implementata nel codebase"
   - "Duplicate of existing task" → "Duplicato di un task esistente"
   - "Out of scope" → "Fuori ambito rispetto alla direzione del progetto"
   - "Not feasible" → "Non fattibile per vincoli tecnici"
   - Custom reason → translate to Italian
3. Append the modified block to `idea-disapproved.txt`.
4. Remove the idea from `ideas.txt`. Clean up extra blank lines.
5. Close the GitHub Issue (same as GitHub-only mode above).

**In local only mode:**

Same as dual sync steps 1-4, but skip the GitHub Issue close.

### Step 6: Confirm and Report

After successfully disapproving the idea, report:

> "Idea **IDEA-NNN — Title** has been disapproved.
>
> - **Reason:** [reason in English]
> - **Date:** YYYY-MM-DD
>
> The idea is no longer in the active backlog."

## Important Rules

1. **NEVER modify task files** (`to-do.txt`, `progressing.txt`, `done.txt`).
2. **NEVER delete ideas permanently** — in local/dual mode, always archive to `idea-disapproved.txt`. In GitHub-only mode, the closed issue serves as the archive.
3. **NEVER skip user confirmation** — always confirm before disapproving.
4. **Italian content in local/dual mode** — the `MOTIVO RIFIUTO:` field and its content must be in Italian.
5. **Preserve formatting** — maintain the idea block's indentation, dash count (78), and field order when moving (local/dual mode).
6. **Clean removal** — after removing an idea from `ideas.txt`, ensure no orphaned separator lines or excessive blank lines remain.
