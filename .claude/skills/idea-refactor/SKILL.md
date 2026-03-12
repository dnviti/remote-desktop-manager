---
name: idea-refactor
description: Review all ideas in ideas.txt or GitHub Issues against the current codebase state and update them to reflect changes in architecture, completed features, or new technical context.
disable-model-invocation: true
argument-hint: "[IDEA-NNN or blank for all]"
---

# Refactor Ideas

You are an idea reviewer for the Arsenale project. Your job is to review the idea backlog against the current state of the codebase and task pipeline, then update ideas that have become stale or outdated.

Development continues while ideas sit in the backlog. Features get implemented, architecture changes, new services appear, and dependencies shift. This skill ensures ideas stay relevant and accurate.

Always respond and work in English for communication.

## Mode Detection

```bash
TRACKER_CFG=".claude/issues-tracker.json"; [ ! -f "$TRACKER_CFG" ] && TRACKER_CFG=".claude/github-issues.json"
PLATFORM="$(jq -r '.platform // "github"' "$TRACKER_CFG" 2>/dev/null)"
TRACKER_ENABLED="$(jq -r '.enabled // false' "$TRACKER_CFG" 2>/dev/null)"
TRACKER_SYNC="$(jq -r '.sync // false' "$TRACKER_CFG" 2>/dev/null)"
TRACKER_REPO="$(jq -r '.repo' "$TRACKER_CFG" 2>/dev/null)"
```

- **Platform-only mode** (`TRACKER_ENABLED=true` AND `TRACKER_SYNC != true`): Read/write ideas from GitHub Issues. No local file operations.
- **Dual sync mode** (`TRACKER_ENABLED=true` AND `TRACKER_SYNC=true`): Read/write ideas from local files, then sync to GitHub.
- **Local only mode** (`TRACKER_ENABLED=false` or config missing): Read/write ideas from local files only.

## Current State

### GitHub-only mode — data sources:

```bash
# All ideas
gh issue list --repo "$TRACKER_REPO" --label idea --state open --json number,title --jq '.[] | "#\(.number) \(.title)"' 2>/dev/null
# Completed tasks
gh issue list --repo "$TRACKER_REPO" --label "task,status:done" --state closed --limit 200 --json number,title --jq '.[] | "#\(.number) \(.title)"' 2>/dev/null
# In-progress tasks
gh issue list --repo "$TRACKER_REPO" --label "task,status:in-progress" --state open --json number,title --jq '.[] | "#\(.number) \(.title)"' 2>/dev/null
# Pending tasks
gh issue list --repo "$TRACKER_REPO" --label "task,status:todo" --state open --json number,title --jq '.[] | "#\(.number) \(.title)"' 2>/dev/null
```

### Local/Dual mode — data sources:

#### All ideas:
!`grep -E '^IDEA-[0-9]{3}' ideas.txt 2>/dev/null | tr -d '\r'`

#### Completed tasks (for overlap detection):
!`grep '^\[x\]' done.txt 2>/dev/null | tr -d '\r'`

#### In-progress tasks:
!`grep '^\[~\]' progressing.txt 2>/dev/null | tr -d '\r'`

#### Pending tasks:
!`grep '^\[ \]' to-do.txt 2>/dev/null | tr -d '\r'`

## Arguments

The user wants to refactor: **$ARGUMENTS**

## Instructions

### Step 1: Load Ideas

**In GitHub-only mode:**
- If an IDEA-NNN code was provided: `gh issue view $(gh issue list --repo "$TRACKER_REPO" --search "[IDEA-NNN] in:title" --label idea --json number --jq '.[0].number') --repo "$TRACKER_REPO" --json number,title,body`
- If no argument: `gh issue list --repo "$TRACKER_REPO" --label idea --state open --json number,title,body`

**In local/dual mode:**
- If an IDEA-NNN code was provided: Read only that specific idea from `ideas.txt`.
- If no argument: Read ALL ideas from `ideas.txt`.

If no ideas exist, inform the user: "No ideas to refactor. Use `/idea-create` to add ideas first."

Read the full content of each idea.

### Step 2: Analyze the Current Codebase

Read key files to understand the current state of the project:

1. **Prisma schema** (`server/prisma/schema.prisma`) — current data models
2. **Server routes** — `Glob` for `server/src/routes/*.routes.ts` and read file names
3. **Server services** — `Glob` for `server/src/services/*.service.ts` and read file names
4. **Client components** — `Glob` for `client/src/components/**/*.tsx` and note key components
5. **Client stores** — `Glob` for `client/src/store/*Store.ts`
6. **Client API files** — `Glob` for `client/src/api/*.api.ts`

Also check what tasks have been planned/completed:

**In GitHub-only mode:**
- Completed tasks: `gh issue list --repo "$TRACKER_REPO" --label "task,status:done" --state closed --limit 200 --json number,title`
- In-progress tasks: `gh issue list --repo "$TRACKER_REPO" --label "task,status:in-progress" --state open --json number,title`
- Pending tasks: `gh issue list --repo "$TRACKER_REPO" --label "task,status:todo" --state open --json number,title`

**In local/dual mode:**
- `done.txt` — completed tasks (fully)
- `progressing.txt` — in-progress tasks (fully)
- `to-do.txt` — pending tasks (titles only via grep)

### Step 3: Evaluate Each Idea

For each idea, perform these checks:

**3a. Already implemented?**
- Search completed tasks for similar functionality
- `Grep` the codebase for key terms from the idea (component names, feature keywords, API endpoints)
- If the idea's core functionality already exists in the codebase, mark it as **REDUNDANT**

**3b. Already planned as a task?**
- Search pending and in-progress tasks for overlapping tasks
- If an existing task covers this idea, mark it as **DUPLICATE**

**3c. Technical landscape changed?**
- Have new services, components, or models been added that affect this idea?
- Have dependencies been created or removed?
- Has the architecture shifted in a way that changes how this idea would be implemented?
- If relevant changes exist, mark it as **NEEDS UPDATE**

**3d. Still relevant?**
- Given the current state of the project, is this idea still valuable?
- Has the problem it addresses been solved by a different approach?
- If no longer relevant, mark it as **OBSOLETE**

**3e. No changes needed?**
- If the idea is still accurate and relevant, mark it as **UNCHANGED**

### Step 4: Present the Review Report

Present a structured report to the user:

```
## Idea Refactoring Report

### REDUNDANT (already implemented)
- **IDEA-NNN — Title**: [explanation of what's already implemented and where]

### DUPLICATE (already a task)
- **IDEA-NNN — Title**: Overlaps with [TASK-CODE — Task Title]

### NEEDS UPDATE (technical context changed)
- **IDEA-NNN — Title**: [what changed and proposed updates]
  - Current text: "..."
  - Proposed text: "..."

### OBSOLETE (no longer relevant)
- **IDEA-NNN — Title**: [why it's no longer relevant]

### UNCHANGED (still valid)
- **IDEA-NNN — Title**: No changes needed
```

### Step 5: Ask for Confirmation

Use `AskUserQuestion` to ask the user what to do:

- **"Apply all suggested changes"** — update NEEDS UPDATE ideas, and note REDUNDANT/DUPLICATE/OBSOLETE ones for potential disapproval
- **"Let me review each one"** — go through each change individually with the user
- **"Cancel"** — make no changes

### Step 6: Apply Changes

**In GitHub-only mode:**

For ideas marked **NEEDS UPDATE** (and confirmed by user):
- Read the current issue body: `gh issue view $ISSUE_NUM --repo "$TRACKER_REPO" --json body --jq '.body'`
- Update the issue body with revised content: `gh issue edit $ISSUE_NUM --repo "$TRACKER_REPO" --body "$NEW_BODY"`
- Add a comment: `gh issue comment $ISSUE_NUM --repo "$TRACKER_REPO" --body "Idea updated via /idea-refactor (YYYY-MM-DD): [brief description of what changed]"`

For ideas marked **REDUNDANT**, **DUPLICATE**, or **OBSOLETE** (if user confirms):
- Add a comment: `gh issue comment $ISSUE_NUM --repo "$TRACKER_REPO" --body "Flagged as [status] by /idea-refactor. Recommended for disapproval."`
- Suggest using `/idea-disapprove IDEA-NNN` for each one

**In dual sync mode:**

For ideas marked **NEEDS UPDATE** (and confirmed by user):
1. Find the idea block in `ideas.txt`
2. Use `Edit` to update the DESCRIZIONE and/or MOTIVAZIONE with the new text
3. Add or update a `Ultimo aggiornamento: YYYY-MM-DD` line after the `Data:` field
4. Sync to GitHub (update issue body + add comment)

For ideas marked **REDUNDANT**, **DUPLICATE**, or **OBSOLETE** (if user confirms):
- Suggest using `/idea-disapprove IDEA-NNN` for each one — do NOT remove them directly

**In local only mode:**

Same as dual sync, but skip GitHub operations.

### Step 7: Report

After applying changes, summarize:

> "Idea refactoring complete.
>
> - **Updated:** N ideas
> - **Unchanged:** N ideas
> - **Recommended for disapproval:** N ideas (use `/idea-disapprove` for each)
>
> [List updated ideas with their codes]"

## Important Rules

1. **NEVER modify task data** — only modify ideas.
2. **NEVER remove ideas** — only update their content. Removal is handled by `/idea-disapprove`.
3. **NEVER skip user confirmation** — always present the report and wait for approval before editing.
4. **In local/dual mode:** idea content in `ideas.txt` must remain in Italian.
5. **Preserve formatting** — maintain the same indentation, dash count (78), and field order (local/dual mode).
6. **Be specific in your analysis** — cite actual files, task codes, and code locations when explaining why an idea is redundant, duplicate, or needs updating.
