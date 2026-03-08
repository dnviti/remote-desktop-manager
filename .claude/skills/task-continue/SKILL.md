---
name: task-continue
description: Resume work on an in-progress task from progressing.txt. Assesses current implementation state and presents what remains.
disable-model-invocation: true
allowed-tools: Bash, Read, Grep, Glob, AskUserQuestion
argument-hint: "[TASK-CODE]"
---

# Continue an In-Progress Task

You are a task manager for the Arsenale project. Your job is to help the user resume work on a task that is already in-progress in `progressing.txt`.

This skill does NOT close or commit tasks — use `/task-pick` for that.

## Current Task State

### In-progress tasks (from progressing.txt):
!`grep '^\[~\]' progressing.txt 2>/dev/null | tr -d '\r'`

## Instructions

The user wants to continue working on a task. The argument provided is: **$ARGUMENTS**

---

### Step 1: Select the Task

Read `progressing.txt` and identify all tasks marked `[~]`.

- **If no `[~]` tasks exist:** Inform the user there are no in-progress tasks and suggest using `/task-pick` to pick one up. Stop here.

- **If a task code was provided as argument:** Find that specific task in `progressing.txt`. If not found, inform the user and list the available in-progress tasks.

- **If no argument was provided and exactly one `[~]` task exists:** Use that task automatically.

- **If no argument was provided and multiple `[~]` tasks exist:** Use `AskUserQuestion` to let the user choose which task to continue.

### Step 2: Read the Full Task Block

Read the complete task block from `progressing.txt` for the selected task — everything between its `------` separator lines.

Extract these key sections:
- **DESCRIZIONE** — what the task is about
- **DETTAGLI TECNICI** — the technical implementation details
- **FILE COINVOLTI** — files to CREARE (create) and MODIFICARE (modify)

### Step 3: Assess Current Implementation State

For each file in the FILE COINVOLTI section, check what has already been done:

**For files marked CREARE (create):**
1. Use `Glob` to check if the file exists at the specified path
2. If not found at the exact path, search for the filename in nearby directories
3. If found, read it and check for key exports, components, or functions described in DETTAGLI TECNICI
4. Note whether the file is: **missing**, **stub/empty**, or **implemented** (with details)

**For files marked MODIFICARE (modify):**
1. Read the file to understand its current state
2. Use `Grep` to check for key changes described in DETTAGLI TECNICI (new imports, function names, route paths, component names, API endpoints, store fields, UI elements)
3. Note which changes are: **already applied** vs. **still needed**

**Cross-check against DETTAGLI TECNICI:**
For each numbered technical requirement, check whether code artifacts prove it was implemented.

### Step 4: Explore Related Code

Read all existing files related to the task to understand the current codebase state. Look at:
- Files that will be modified (full content)
- Similar files for patterns to follow (e.g., if creating a new route, look at existing routes)
- Related types, interfaces, and imports

### Step 5: Present the Continuation Briefing

Present a clear English-language briefing:

1. **Task**: Code, title, and priority
2. **Description**: Brief summary of what the task accomplishes
3. **Implementation Progress**:
   - What is already done (with file paths and evidence)
   - What remains to be done
4. **Next Steps**: Ordered list of concrete implementation actions for the remaining work
5. **Files to Create/Modify**: Every file with what still needs to happen in each
6. **Quality Gate Reminder**: `npm run verify` must pass before the task can be closed via `/task-pick`

After presenting the briefing, ask the user:

> "Ready to continue implementation, or would you like to adjust the approach?"
