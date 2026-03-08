---
name: idea-disapprove
description: Disapprove an idea by moving it from ideas.txt to idea-disapproved.txt with a rejection reason.
disable-model-invocation: true
allowed-tools: Bash, Read, Grep, Glob, Edit, Write
argument-hint: "[IDEA-NNN]"
---

# Disapprove an Idea

You are the idea triage assistant for the Arsenale project. Your job is to move rejected ideas from `ideas.txt` to the `idea-disapproved.txt` archive, recording the reason for disapproval.

Always respond and work in English. However, the disapproval reason added to the idea block MUST be in **Italian**.

## Current State

### Ideas available for disapproval:
!`grep -E '^IDEA-[0-9]{3}' ideas.txt 2>/dev/null | tr -d '\r'`

### Already disapproved ideas:
!`grep -E '^IDEA-[0-9]{3}' idea-disapproved.txt 2>/dev/null | tr -d '\r'`

## Arguments

The user wants to disapprove: **$ARGUMENTS**

## Instructions

### Step 1: Select the Idea

- **If an IDEA-NNN code was provided**: Find that idea in `ideas.txt`. If not found, inform the user and list available ideas.
- **If no argument was provided**: List all ideas from `ideas.txt` with their codes, titles, and categories. Use `AskUserQuestion` to ask the user which idea to disapprove.

If `ideas.txt` has no ideas, inform the user: "No ideas available for disapproval."

### Step 2: Show the Full Idea

Read the complete idea block from `ideas.txt` (everything between its `------` separator lines). Present it to the user so they can review what they are disapproving.

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

### Step 5: Move the Idea

**5a. Read the full idea block** from `ideas.txt` (everything between `------` separators, inclusive).

**5b. Add the disapproval field** to the block. Insert a `MOTIVO RIFIUTO:` line after the `MOTIVAZIONE:` section:

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

**5c. Append the modified block to `idea-disapproved.txt`:**
Use `Edit` to append the block (with `MOTIVO RIFIUTO:` added) at the end of `idea-disapproved.txt`.

**5d. Remove the idea from `ideas.txt`:**
Use `Edit` to remove the entire original idea block from `ideas.txt`. Clean up any extra blank lines left behind.

### Step 6: Confirm and Report

After successfully moving the idea, report:

> "Idea **IDEA-NNN — Title** has been disapproved and moved to `idea-disapproved.txt`.
>
> - **Reason:** [reason in English]
> - **Date:** YYYY-MM-DD
>
> The idea is no longer in the active backlog."

## Important Rules

1. **NEVER modify task files** (`to-do.txt`, `progressing.txt`, `done.txt`).
2. **NEVER delete ideas permanently** — always archive to `idea-disapproved.txt`.
3. **NEVER skip user confirmation** — always confirm before moving.
4. **Italian content** — the `MOTIVO RIFIUTO:` field and its content must be in Italian.
5. **Preserve formatting** — maintain the idea block's indentation, dash count (78), and field order when moving.
6. **Clean removal** — after removing an idea from `ideas.txt`, ensure no orphaned separator lines or excessive blank lines remain.
