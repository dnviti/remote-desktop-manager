---
name: task-pick
description: Pick up the next task for implementation. Prioritizes verifying and closing in-progress tasks before picking new ones.
disable-model-invocation: true
argument-hint: "[TASK-CODE]"
---

# Pick Up a Task

You are a task manager for the Remote Desktop Manager project. Your job is to:
1. **First**: verify and close any in-progress tasks that have already been implemented
2. **Then**: pick up a new task only when all in-progress tasks are resolved

Tasks are split across three files by status:
- `to-do.txt` — Pending tasks `[ ]`
- `progressing.txt` — In-progress tasks `[~]`
- `done.txt` — Completed tasks `[x]`

## Current Task State

### In-progress tasks (from progressing.txt):
!`grep '^\[~\]' progressing.txt 2>/dev/null | tr -d '\r'`

### Pending tasks (from to-do.txt):
!`grep '^\[ \]' to-do.txt | tr -d '\r'`

### Completed tasks (from done.txt):
!`grep '^\[x\]' done.txt 2>/dev/null | tr -d '\r'`

### Recommended implementation order:
!`sed -n '/ORDINE DI IMPLEMENTAZIONE CONSIGLIATO/,/NOTE/p' to-do.txt | head -40 | tr -d '\r'`

## Instructions

The user wants to pick up a task. The argument provided is: **$ARGUMENTS**

---

### Step 0: Verify and Close In-Progress Tasks (PRIORITY)

Before picking any new task, you MUST process in-progress tasks from `progressing.txt`.

**If a specific task code was provided as argument** AND that task is already `[~]` in `progressing.txt`: jump directly to Step 0b for that task only, then stop (do not process other in-progress tasks).

**If no argument was provided** OR the argument is not found in `progressing.txt`: process ALL in-progress tasks sequentially as described below.

**0a. Read the in-progress task list:**
Read `progressing.txt` and identify all tasks marked `[~]`. If there are none, skip to Step 1.

**0b. For each in-progress task (in order), verify implementation:**

Read the full task block from `progressing.txt` (everything between its `------` separator lines).

Extract two key sections:
- **FILE COINVOLTI** — the list of files to CREARE (create) and MODIFICARE (modify)
- **DETTAGLI TECNICI** — the technical implementation details

Perform these verification checks:

1. **File existence checks:**
   - For each file marked **CREARE**: Use `Glob` to check if the file exists at the specified path. If not found at the exact path, search for the filename in nearby directories (implementations may use slightly different paths, e.g., `files.routes.ts` instead of `filetransfer.routes.ts`).
   - For each file marked **MODIFICARE**: Verify the file exists.

2. **Implementation content checks:**
   - For files marked **CREARE**: Read the file and verify it contains meaningful implementation (not empty or stub-only). Check for key exports, components, or functions described in DETTAGLI TECNICI.
   - For files marked **MODIFICARE**: Use `Grep` to verify the key changes described in DETTAGLI TECNICI are present. Look for new imports, function names, route paths, component names, API endpoints, store fields, and UI elements described in the task.
   - Cross-check against DETTAGLI TECNICI: for each numbered technical requirement, verify at least one code artifact proves it was implemented.

3. **Build a verification report:**
   ```
   VERIFICATION: [TASK-CODE] — [Task Title]
   ✓ [file path] — [what was found]
   ✗ [file path] — MISSING: [what was expected]

   Technical checks:
   ✓ [requirement] — verified in [file]
   ✗ [requirement] — NOT FOUND
   ```

**0c. Decision based on verification result:**

- **ALL checks pass (task fully implemented):**
  1. **SAST/Quality Gate (MANDATORY):** Before closing the task, run `npm run verify` (typecheck + lint + sast + build). If this script does not exist yet (SAST-031 not implemented), run `npm run build` as a minimum gate. If the verify/build fails:
     - Fix ALL errors and warnings reported
     - Re-run `npm run verify` (or `npm run build`) until it passes with zero errors
     - Only proceed to step 2 when the quality gate passes
  2. **Commit Prompt (Step 6):** Ask the user if they want to commit the changes before closing the task. Wait for their response and act accordingly.
  3. Remove the entire task block from `progressing.txt` (everything between its `------` separators, inclusive)
  4. Append the task block to `done.txt` at the end of the appropriate section (SEZIONE A or SEZIONE B, matching where it was in progressing.txt)
  5. In the appended block: change `[~]` to `[x]` in the header line
  6. Add a `COMPLETATO:` line after the priority/dependencies lines with a brief English summary of what was implemented
  7. If the task appears in the recommended order section of `to-do.txt`, update its status annotation to `[COMPLETATO]`
  8. Present the verification report to the user (including SAST/quality gate result) and confirm the task was closed
  9. **Continue to the next `[~]` task** in progressing.txt — repeat Step 0b

- **Some checks fail (task partially implemented or not implemented):**
  1. Present the verification report showing what is implemented and what is missing
  2. **Do NOT close the task** — leave it as `[~]` in progressing.txt
  3. Read all existing files related to the task to understand current state
  4. Proceed to Step 4 (Explore codebase) and Step 5 (Present briefing) for this task, focusing the briefing on **what remains to be done**
  5. **Stop processing further in-progress tasks** — the user should finish this one first

**0d. When all in-progress tasks have been verified and closed:**
Inform the user how many tasks were closed, then continue to Step 1 to pick a new task.

---

### Step 1: Determine which task to pick

This step is only reached when there are NO in-progress tasks remaining in `progressing.txt`.

- **If a task code was provided** (e.g., `CRED-006`): Use that specific task. Verify it exists in `to-do.txt` and is in `[ ]` (todo) status. If found in `done.txt` as `[x]` (completed), inform the user and suggest the next available task.

- **If no argument was provided**: Select the next task from the recommended implementation order that is still `[ ]` (todo) in `to-do.txt`. Skip tasks found in `done.txt` (completed) or `progressing.txt` (in-progress). Also verify that the task's dependencies are satisfied (dependency tasks should be in `done.txt` as `[x]`). If a task has unsatisfied dependencies, skip it and pick the next one.

### Step 2: Move task to progressing.txt

1. Read the full task block from `to-do.txt` — everything between its `------` separator lines (including the separators and all content).
2. Remove that entire block from `to-do.txt`.
3. Append the block to `progressing.txt` in the appropriate section (SEZIONE A or SEZIONE B).
4. In the appended block, change `[ ]` to `[~]` in the header line.
5. If the task appears in the recommended order section of `to-do.txt`, update its status annotation to `[IN CORSO]`.

**Important:** The task block must be moved completely — do not leave a copy in to-do.txt.

### Step 3: Read the full task details

Read the complete task block from `progressing.txt` for the selected task — everything between its `------` separator lines: priority, dependencies, description, technical details, and files involved.

### Step 4: Explore the codebase

For each file listed in the "FILE COINVOLTI" (files involved) section:
- If the file exists, read it to understand the current state
- If marked "CREARE" (to create), check the target directory and look at similar files for patterns to follow
- Identify relevant interfaces, types, and patterns

### Step 5: Present the implementation briefing

Present a clear English-language briefing:

1. **Task Selected**: Code, title, and priority
2. **Status Update**: Confirm the task was moved to progressing.txt and marked as in-progress
3. **Scope Summary**: What needs to be done (in English)
4. **Technical Approach**: Implementation steps based on task details and codebase exploration
5. **Files to Create/Modify**: Every file with what needs to happen in each
6. **Dependencies**: Status of all dependencies (check done.txt for completed deps)
7. **Risks**: Any concerns found during exploration
8. **Quality Gate**: Remind that `npm run verify` (or `npm run build` if SAST-031 not yet done) must pass before the task can be closed

After presenting the briefing, ask the user: "Ready to start implementation, or would you like to adjust the approach?"

---

### Step 6: Post-Implementation — Commit Prompt

After a task has been **fully implemented and the quality gate passes**, before closing the task (Step 0c), ask the user:

> "Work is complete and the quality gate passed. Would you like me to commit these changes?"

- If the user says **yes**: create a commit using the `/commit` skill (or follow the standard git commit workflow). The commit message should reference the task code and briefly describe what was implemented.
- If the user says **no** or **not now**: skip the commit and proceed with closing the task as normal.

**Important:** Always ask — never auto-commit without user confirmation.
