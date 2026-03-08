---
name: idea-refactor
description: Review all ideas in ideas.txt against the current codebase state and update them to reflect changes in architecture, completed features, or new technical context.
disable-model-invocation: true
allowed-tools: Bash, Read, Grep, Glob, Edit, Write
argument-hint: "[IDEA-NNN or blank for all]"
---

# Refactor Ideas

You are an idea reviewer for the Arsenale project. Your job is to review the idea backlog (`ideas.txt`) against the current state of the codebase and task files, then update ideas that have become stale or outdated.

Development continues while ideas sit in the backlog. Features get implemented, architecture changes, new services appear, and dependencies shift. This skill ensures ideas stay relevant and accurate.

Always respond and work in English for communication. Idea content in `ideas.txt` MUST remain in **Italian**.

## Current State

### All ideas:
!`grep -E '^IDEA-[0-9]{3}' ideas.txt 2>/dev/null | tr -d '\r'`

### Completed tasks (for overlap detection):
!`grep '^\[x\]' done.txt 2>/dev/null | tr -d '\r'`

### In-progress tasks:
!`grep '^\[~\]' progressing.txt 2>/dev/null | tr -d '\r'`

### Pending tasks:
!`grep '^\[ \]' to-do.txt 2>/dev/null | tr -d '\r'`

## Arguments

The user wants to refactor: **$ARGUMENTS**

## Instructions

### Step 1: Load Ideas

- **If an IDEA-NNN code was provided**: Read only that specific idea from `ideas.txt`.
- **If no argument was provided**: Read ALL ideas from `ideas.txt`.

If `ideas.txt` has no ideas, inform the user: "No ideas to refactor. Use `/idea-create` to add ideas first."

Read the full content of each idea block (everything between `------` separators).

### Step 2: Analyze the Current Codebase

Read key files to understand the current state of the project:

1. **Prisma schema** (`server/prisma/schema.prisma`) — current data models
2. **Server routes** — `Glob` for `server/src/routes/*.routes.ts` and read file names
3. **Server services** — `Glob` for `server/src/services/*.service.ts` and read file names
4. **Client components** — `Glob` for `client/src/components/**/*.tsx` and note key components
5. **Client stores** — `Glob` for `client/src/store/*Store.ts`
6. **Client API files** — `Glob` for `client/src/api/*.api.ts`

Also read the task files to understand what has been planned/completed:
- `done.txt` — completed tasks (fully)
- `progressing.txt` — in-progress tasks (fully)
- `to-do.txt` — pending tasks (titles only via grep)

### Step 3: Evaluate Each Idea

For each idea, perform these checks:

**3a. Already implemented?**
- Search `done.txt` for tasks that cover the same functionality
- `Grep` the codebase for key terms from the idea (component names, feature keywords, API endpoints)
- If the idea's core functionality already exists in the codebase, mark it as **REDUNDANT**

**3b. Already planned as a task?**
- Search `to-do.txt` and `progressing.txt` for overlapping tasks
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

For ideas marked **NEEDS UPDATE** (and confirmed by user):
1. Find the idea block in `ideas.txt`
2. Use `Edit` to update the DESCRIZIONE and/or MOTIVAZIONE with the new text
3. Add or update a `Ultimo aggiornamento: YYYY-MM-DD` line after the `Data:` field

For ideas marked **REDUNDANT**, **DUPLICATE**, or **OBSOLETE** (if user confirms):
- Suggest using `/idea-disapprove IDEA-NNN` for each one, with the reason pre-filled
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

1. **NEVER modify task files** (`to-do.txt`, `progressing.txt`, `done.txt`) — only modify `ideas.txt`.
2. **NEVER remove ideas** — only update their content. Removal is handled by `/idea-disapprove`.
3. **NEVER skip user confirmation** — always present the report and wait for approval before editing.
4. **Italian content in idea blocks** — all field labels and descriptions must remain in Italian.
5. **Preserve formatting** — maintain the same indentation, dash count (78), and field order.
6. **Be specific in your analysis** — cite actual files, task codes, and code locations when explaining why an idea is redundant, duplicate, or needs updating.
