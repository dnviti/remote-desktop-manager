---
name: idea-refactor
description: Review all ideas in ideas.txt or platform issues (GitHub/GitLab) against the current codebase state and update them to reflect changes in architecture, completed features, or new technical context.
disable-model-invocation: true
argument-hint: "[IDEA-NNN or blank for all]"
---

# Refactor Ideas

You are an idea reviewer for this project. Your job is to review the idea backlog against the current state of the codebase and task pipeline, then update ideas that have become stale or outdated.

Development continues while ideas sit in the backlog. Features get implemented, architecture changes, new services appear, and dependencies shift. This skill ensures ideas stay relevant and accurate.

Always respond and work in English. Idea content MUST remain in **English**.

## Mode Detection

!`python3 .claude/scripts/task_manager.py platform-config`

Use the `mode` field to determine behavior: `platform-only`, `dual-sync`, or `local-only`. The JSON includes `platform`, `enabled`, `sync`, `repo`, `cli` (gh/glab), and `labels`.

## Platform Commands

Use `python3 .claude/scripts/task_manager.py platform-cmd <operation> [key=value ...]` to generate the correct CLI command for the detected platform (GitHub/GitLab).

Supported operations: `list-issues`, `search-issues`, `view-issue`, `edit-issue`, `close-issue`, `comment-issue`, `create-issue`, `create-pr`, `list-pr`, `merge-pr`, `create-release`, `edit-release`.

Example: `python3 .claude/scripts/task_manager.py platform-cmd create-issue title="[CODE] Title" body="Description" labels="task,status:todo"`

## Current State

### Platform-only mode — data sources:

```bash
# All ideas
gh issue list --repo "$TRACKER_REPO" --label idea --state open --json number,title --jq '.[] | "#\(.number) \(.title)"' 2>/dev/null
# GitLab: glab issue list -R "$TRACKER_REPO" -l idea --state opened --output json | jq '.[] | "#\(.iid) \(.title)"' 2>/dev/null
# Completed tasks
gh issue list --repo "$TRACKER_REPO" --label "task,status:done" --state closed --limit 200 --json number,title --jq '.[] | "#\(.number) \(.title)"' 2>/dev/null
# GitLab: glab issue list -R "$TRACKER_REPO" -l "task,status:done" --state closed --per-page 200 --output json | jq '.[] | "#\(.iid) \(.title)"' 2>/dev/null
# In-progress tasks
gh issue list --repo "$TRACKER_REPO" --label "task,status:in-progress" --state open --json number,title --jq '.[] | "#\(.number) \(.title)"' 2>/dev/null
# GitLab: glab issue list -R "$TRACKER_REPO" -l "task,status:in-progress" --state opened --output json | jq '.[] | "#\(.iid) \(.title)"' 2>/dev/null
# Pending tasks
gh issue list --repo "$TRACKER_REPO" --label "task,status:todo" --state open --json number,title --jq '.[] | "#\(.number) \(.title)"' 2>/dev/null
# GitLab: glab issue list -R "$TRACKER_REPO" -l "task,status:todo" --state opened --output json | jq '.[] | "#\(.iid) \(.title)"' 2>/dev/null
```

### Local/Dual mode — data sources:

#### All ideas:
!`python3 .claude/scripts/task_manager.py list-ideas --file ideas --format summary`

#### All tasks (for overlap detection):
!`python3 .claude/scripts/task_manager.py list --status all --format summary`

## Arguments

The user wants to refactor: **$ARGUMENTS**

## Instructions

### Step 1: Load Ideas

**In Platform-only mode:**
- If an IDEA-NNN code was provided: `gh issue view $(gh issue list --repo "$TRACKER_REPO" --search "[IDEA-NNN] in:title" --label idea --json number --jq '.[0].number') --repo "$TRACKER_REPO" --json number,title,body`
  <!-- # GitLab: glab issue view $(glab issue list -R "$TRACKER_REPO" --search "[IDEA-NNN]" -l idea --output json | jq '.[0].iid') -R "$TRACKER_REPO" --output json -->
- If no argument: `gh issue list --repo "$TRACKER_REPO" --label idea --state open --json number,title,body`
  <!-- # GitLab: glab issue list -R "$TRACKER_REPO" -l idea --state opened --output json | jq '.' -->

**In local/dual mode:**
- If an IDEA-NNN code was provided: Read only that specific idea from `ideas.txt`.
- If no argument: Read ALL ideas from `ideas.txt`.

If no ideas exist, inform the user: "No ideas to refactor. Use `/idea-create` to add ideas first."

Read the full content of each idea.

### Step 2: Analyze the Current Codebase

Read key files to understand the current state of the project:

1. Explore the project structure using `Glob` to identify key directories and file patterns
2. Read the main source files, configuration, and data models
3. Identify recently added or changed files

Also check what tasks have been planned/completed:

**In Platform-only mode:**
- Completed tasks: `gh issue list --repo "$TRACKER_REPO" --label "task,status:done" --state closed --limit 200 --json number,title`
  <!-- # GitLab: glab issue list -R "$TRACKER_REPO" -l "task,status:done" --state closed --per-page 200 --output json | jq '.' -->
- In-progress tasks: `gh issue list --repo "$TRACKER_REPO" --label "task,status:in-progress" --state open --json number,title`
  <!-- # GitLab: glab issue list -R "$TRACKER_REPO" -l "task,status:in-progress" --state opened --output json | jq '.' -->
- Pending tasks: `gh issue list --repo "$TRACKER_REPO" --label "task,status:todo" --state open --json number,title`
  <!-- # GitLab: glab issue list -R "$TRACKER_REPO" -l "task,status:todo" --state opened --output json | jq '.' -->

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

**In Platform-only mode:**

For ideas marked **NEEDS UPDATE** (and confirmed by user):
- Read the current issue body: `gh issue view $ISSUE_NUM --repo "$TRACKER_REPO" --json body --jq '.body'`
  <!-- # GitLab: glab issue view $ISSUE_NUM -R "$TRACKER_REPO" --output json | jq '.description' -->
- Update the issue body with revised content: `gh issue edit $ISSUE_NUM --repo "$TRACKER_REPO" --body "$NEW_BODY"`
  <!-- # GitLab: glab issue update $ISSUE_NUM -R "$TRACKER_REPO" --description "$NEW_BODY" -->
- Add a comment: `gh issue comment $ISSUE_NUM --repo "$TRACKER_REPO" --body "Idea updated via /idea-refactor (YYYY-MM-DD): [brief description of what changed]"`
  <!-- # GitLab: glab issue note $ISSUE_NUM -R "$TRACKER_REPO" -m "Idea updated via /idea-refactor (YYYY-MM-DD): [brief description of what changed]" -->

For ideas marked **REDUNDANT**, **DUPLICATE**, or **OBSOLETE** (if user confirms):
- Add a comment: `gh issue comment $ISSUE_NUM --repo "$TRACKER_REPO" --body "Flagged as [status] by /idea-refactor. Recommended for disapproval."`
  <!-- # GitLab: glab issue note $ISSUE_NUM -R "$TRACKER_REPO" -m "Flagged as [status] by /idea-refactor. Recommended for disapproval." -->
- Suggest using `/idea-disapprove IDEA-NNN` for each one

**In dual sync mode:**

For ideas marked **NEEDS UPDATE** (and confirmed by user):
1. Find the idea block in `ideas.txt`
2. Use `Edit` to update the DESCRIPTION and/or MOTIVATION with the new text
3. Add or update a `Last updated: YYYY-MM-DD` line after the `Date:` field
4. Sync to platform (update issue body + add comment)

For ideas marked **REDUNDANT**, **DUPLICATE**, or **OBSOLETE** (if user confirms):
- Suggest using `/idea-disapprove IDEA-NNN` for each one — do NOT remove them directly

**In local only mode:**

For ideas marked **NEEDS UPDATE** (and confirmed by user):
1. Find the idea block in `ideas.txt`
2. Use `Edit` to update the DESCRIPTION and/or MOTIVATION with the new text
3. Add or update a `Last updated: YYYY-MM-DD` line after the `Date:` field

For ideas marked **REDUNDANT**, **DUPLICATE**, or **OBSOLETE** (if user confirms):
- Suggest using `/idea-disapprove IDEA-NNN` for each one
- Do NOT remove them directly — always go through the proper disapproval flow

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
4. **English content** — idea content must remain in English across all modes.
5. **Preserve formatting** — maintain the same indentation, dash count (78), and field order (local/dual mode).
6. **Be specific in your analysis** — cite actual files, task codes, and code locations when explaining why an idea is redundant, duplicate, or needs updating.
