---
name: task-pick
description: Pick up the next task for implementation. Prioritizes verifying and closing in-progress tasks before picking new ones.
disable-model-invocation: true
argument-hint: "[TASK-CODE]"
---

# Pick Up a Task

You are a task manager for the Arsenale project. Your job is to:
1. **First**: verify and close any in-progress tasks that have already been implemented
2. **Then**: pick up a new task only when all in-progress tasks are resolved

## Mode Detection

Determine the operating mode first:

```bash
TRACKER_CFG=".claude/issues-tracker.json"; [ ! -f "$TRACKER_CFG" ] && TRACKER_CFG=".claude/github-issues.json"
PLATFORM="$(jq -r '.platform // "github"' "$TRACKER_CFG" 2>/dev/null)"
TRACKER_ENABLED="$(jq -r '.enabled // false' "$TRACKER_CFG" 2>/dev/null)"
TRACKER_SYNC="$(jq -r '.sync // false' "$TRACKER_CFG" 2>/dev/null)"
TRACKER_REPO="$(jq -r '.repo' "$TRACKER_CFG" 2>/dev/null)"
```

- **Platform-only mode** (`TRACKER_ENABLED=true` AND `TRACKER_SYNC != true`): Read/write task state via GitHub Issues. No local file operations.
- **Dual sync mode** (`TRACKER_ENABLED=true` AND `TRACKER_SYNC=true`): Use local files as primary, then sync to GitHub.
- **Local only mode** (`TRACKER_ENABLED=false` or config missing): Use local files only.

## Current Task State

### GitHub-only mode:

```bash
# In-progress tasks
gh issue list --repo "$TRACKER_REPO" --label "task,status:in-progress" --state open --json number,title --jq '.[] | "\(.title)"' 2>/dev/null
# Pending tasks (by priority)
gh issue list --repo "$TRACKER_REPO" --label "task,status:todo,priority:high" --state open --json number,title --jq '.[] | "\(.title)"' 2>/dev/null
gh issue list --repo "$TRACKER_REPO" --label "task,status:todo,priority:medium" --state open --json number,title --jq '.[] | "\(.title)"' 2>/dev/null
gh issue list --repo "$TRACKER_REPO" --label "task,status:todo,priority:low" --state open --json number,title --jq '.[] | "\(.title)"' 2>/dev/null
# Completed tasks
gh issue list --repo "$TRACKER_REPO" --label "task,status:done" --state closed --limit 20 --json number,title --jq '.[] | "\(.title)"' 2>/dev/null
```

### Local/Dual mode:

#### In-progress tasks (from progressing.txt):
!`grep '^\[~\]' progressing.txt 2>/dev/null | tr -d '\r'`

#### Pending tasks (from to-do.txt):
!`grep '^\[ \]' to-do.txt | tr -d '\r'`

#### Completed tasks (from done.txt):
!`grep '^\[x\]' done.txt 2>/dev/null | tr -d '\r'`

#### Recommended implementation order:
!`grep -A 50 'ORDINE DI IMPLEMENTAZIONE CONSIGLIATO' to-do.txt 2>/dev/null | tr -d '\r'`

## Instructions

The user wants to pick up a task. The argument provided is: **$ARGUMENTS**

---

### Step 0: Verify and Close In-Progress Tasks (PRIORITY)

Before picking any new task, you MUST process in-progress tasks.

**In GitHub-only mode:**
- Query in-progress tasks: `gh issue list --repo "$TRACKER_REPO" --label "task,status:in-progress" --state open --json number,title`
- If a specific task code was provided AND that task has `status:in-progress` label: jump directly to Step 0b for that task only.
- Otherwise, process ALL in-progress tasks sequentially.

**In local/dual mode:**
- Read `progressing.txt` and identify all tasks marked `[~]`.
- If a specific task code was provided AND found in progressing.txt: jump to Step 0b for that task only.
- Otherwise, process ALL in-progress tasks.

If there are no in-progress tasks, skip to Step 1.

**0a. Read the in-progress task list** (as described above).

**0b. For each in-progress task, switch to the task branch and verify implementation:**

First, check if a task branch exists:
```bash
git branch --list "task/<task-code-lowercase>"
```

- **If the branch exists:** Switch to it: `git checkout task/<task-code-lowercase>`
- **If it does not exist:** Continue on the current branch.

**Read the full task details:**

**In GitHub-only mode:**
- Find the issue: `ISSUE_NUM=$(gh issue list --repo "$TRACKER_REPO" --search "[TASK-CODE] in:title" --label task --state open --json number --jq '.[0].number')`
- Read the body: `gh issue view $ISSUE_NUM --repo "$TRACKER_REPO" --json body --jq '.body'`
- Parse the body to extract **Files Involved** (CREATE / MODIFY) and **Technical Details** sections.

**In local/dual mode:**
- Read the full task block from `progressing.txt` (between `------` separator lines).
- Extract **FILE COINVOLTI** (CREARE / MODIFICARE) and **DETTAGLI TECNICI** sections.

Perform these verification checks:

1. **File existence checks:**
   - For each file marked **CREATE** (or **CREARE**): Use `Glob` to check if the file exists. If not found at the exact path, search nearby directories.
   - For each file marked **MODIFY** (or **MODIFICARE**): Verify the file exists.

2. **Implementation content checks:**
   - For files marked **CREATE**: Read the file and verify meaningful implementation. Check for key exports, components, or functions described in Technical Details.
   - For files marked **MODIFY**: Use `Grep` to verify key changes are present.
   - Cross-check against Technical Details: for each requirement, verify code artifacts prove implementation.

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
  1. **Prisma Migration (if needed):** Check whether `server/prisma/schema.prisma` has uncommitted changes:
     ```bash
     git diff --name-only HEAD -- server/prisma/schema.prisma
     ```
     - **If modified:** `npm run db:migrate -w server -- --name <task-code-lowercase>`
     - **If NOT modified:** Skip.
  2. **SAST/Quality Gate (MANDATORY):** Run `npm run verify`. If it fails, fix ALL errors and re-run until it passes.
  3. **Smoke-Test (MANDATORY):** After the quality gate passes:

     **Start the application:**
     Run `npm run predev && npm run db:push && npm run dev` using the Bash tool with `run_in_background: true`.

     **Wait for startup and check ports:**
     Wait 8 seconds, then verify ports 3000 and 3001 are listening:
     ```bash
     netstat -ano 2>/dev/null | grep -E ":(3000|3001)\s" | grep LISTENING
     ```

     **Check for startup errors:**
     Read the background process output using `TaskOutput`. Scan for: `EADDRINUSE`, `Cannot find module`, `ECONNREFUSED`, `Error`, `TypeError`, `SyntaxError`, `prisma`.
     Ignore false positives in variable names, file paths, or middleware names.

     **Decision:**
     - If errors found: fix, re-run verify + smoke-test (max 2 retries).
     - If no errors: proceed.

     **Stop the application (MANDATORY):**
     Kill all processes on ports 3000, 3001, 3002:
     ```bash
     for port in 3000 3001 3002; do
       pids=$(netstat -ano 2>/dev/null | grep -E ":${port}\s" | grep LISTENING | awk '{print $5}' | sort -u | tr -d '\r')
       for pid in $pids; do
         if [ -n "$pid" ] && [ "$pid" != "0" ]; then
           taskkill /PID "$pid" /F /T 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
         fi
       done
     done
     ```

  4. Present the verification report
  5. **Run the Step 6 completion flow** for this task
  6. **Continue to the next in-progress task** — repeat Step 0b

- **Some checks fail:**
  1. Present the verification report
  2. **Do NOT close the task**
  3. Read all related files
  4. Proceed to Step 4 and Step 5 for what remains
  5. **Stop processing further in-progress tasks**

**0d. When all in-progress tasks have been verified and closed:**
Inform the user, then continue to Step 1.

---

### Step 1: Determine which task to pick

This step is only reached when there are NO in-progress tasks remaining.

**In GitHub-only mode:**
- **If a task code was provided** (e.g., `CRED-006`): Search for it: `gh issue list --repo "$TRACKER_REPO" --search "[TASK-CODE] in:title" --label "task,status:todo" --state open --json number,title`
  - If not found in todo, check if already done: `gh issue list --repo "$TRACKER_REPO" --search "[TASK-CODE] in:title" --label "task,status:done" --state closed --json number,title`
  - If done, inform the user and suggest next available task.
- **If no argument was provided**: Select the next task by priority label ordering: `priority:high` first, then `priority:medium`, then `priority:low`. Within same priority, pick the lowest-numbered task. Check dependencies by reading the task body — dependency task codes should have `status:done` label.

**In local/dual mode:**
- **If a task code was provided**: Verify it exists in `to-do.txt` as `[ ]`. If in `done.txt` as `[x]`, inform the user.
- **If no argument was provided**: Select from the recommended implementation order that is still `[ ]` in `to-do.txt`. Skip completed or in-progress tasks. Verify dependencies are satisfied.

### Step 2: Mark task as in-progress

**In GitHub-only mode:**

Update the GitHub Issue labels:
```bash
ISSUE_NUM=$(gh issue list --repo "$TRACKER_REPO" --search "[TASK-CODE] in:title" --label "task,status:todo" --state open --json number --jq '.[0].number')
gh issue edit "$ISSUE_NUM" --repo "$TRACKER_REPO" --remove-label "status:todo" --add-label "status:in-progress"
gh issue comment "$ISSUE_NUM" --repo "$TRACKER_REPO" --body "Task picked up. Branch: \`task/<task-code-lowercase>\`"
```

**In dual sync mode:**

1. Read the full task block from `to-do.txt` (between `------` separators, inclusive).
2. Remove that entire block from `to-do.txt`.
3. Append the block to `progressing.txt`.
4. Change `[ ]` to `[~]` in the header line.
5. Update recommended order annotation to `[IN CORSO]` if applicable.
6. Sync to GitHub (update labels as above).

**In local only mode:**

Same as dual sync steps 1-5, skip GitHub sync.

### Step 2.5: Create a task branch

Create a dedicated git branch for this task, branching from `develop`.

**2.5a. Check the working tree:**
```bash
git status --porcelain
```
If dirty, inform the user and stop.

**2.5b. Switch to develop and pull latest:**
```bash
git checkout develop
git pull origin develop
```

**2.5c. Create the task branch:**
```bash
git branch --list "task/<task-code-lowercase>"
```
- If exists: `git checkout task/<task-code-lowercase>`
- If not: `git checkout -b task/<task-code-lowercase>`

### Step 3: Read the full task details

**In GitHub-only mode:**
- `gh issue view $ISSUE_NUM --repo "$TRACKER_REPO" --json body --jq '.body'`
- Parse the structured body: Description, Technical Details, Files Involved sections.

**In local/dual mode:**
- Read the complete task block from `progressing.txt`.

### Step 4: Explore the codebase

For each file listed in the files involved section:
- If the file exists, read it to understand the current state
- If marked to create, check the target directory and look at similar files for patterns
- Identify relevant interfaces, types, and patterns

### Step 5: Present the implementation briefing

Present a clear English-language briefing:

1. **Task Selected**: Code, title, and priority
2. **Status Update**: Confirm the task was marked as in-progress
3. **Scope Summary**: What needs to be done
4. **Technical Approach**: Implementation steps based on task details and codebase exploration
5. **Files to Create/Modify**: Every file with what needs to happen in each
6. **Dependencies**: Status of all dependencies
7. **Risks**: Any concerns found during exploration
8. **Prisma Migration**: Note if schema changes are involved
9. **Quality Gate**: Remind that `npm run verify` must pass before closing

After presenting the briefing, ask the user: "Ready to start implementation, or would you like to adjust the approach?"

---

### Step 6: Post-Implementation — Confirm, Close & Commit

After a task has been **fully implemented and the quality gate (`npm run verify`) passes**, execute this completion flow:

**6a. Present a Testing Guide:**

Generate and present a **manual testing guide** derived from the task's technical details and files involved.

Format:
> ### Testing Guide for [TASK-CODE] — [Task Title]
>
> **Prerequisites:**
> - [What needs to be running]
>
> **Steps to test:**
> 1. [Concrete action]
>    - **Expected:** [Result]
>
> **Edge cases to check:**
> - [2-3 edge cases]

The guide must be actionable and specific — use real URLs, UI element names, and API endpoints.

**6a.5. Mark task as to-test (if platform integration is enabled):**

If `TRACKER_ENABLED` is `true`:
```bash
ISSUE_NUM=$(gh issue list --repo "$TRACKER_REPO" --search "[TASK-CODE] in:title" --label task --state open --json number --jq '.[0].number')
gh issue edit "$ISSUE_NUM" --repo "$TRACKER_REPO" --add-label "status:to-test"
```

**6b. Ask for user confirmation:**

Use `AskUserQuestion` with options:
- **"Yes, task is done"** — proceed to 6b.5 then 6c
- **"Not yet, needs more work"** — stop; task stays in-progress
- **"Skip testing, mark as done"** — skip to 6c directly (to-test label remains for later verification)

**6b.5. Remove to-test label (if platform integration is enabled):**

If `TRACKER_ENABLED` is `true` and the user confirmed testing:
```bash
gh issue edit "$ISSUE_NUM" --repo "$TRACKER_REPO" --remove-label "status:to-test"
```

**6c. Mark task as done:**

**In GitHub-only mode:**
```bash
ISSUE_NUM=$(gh issue list --repo "$TRACKER_REPO" --search "[TASK-CODE] in:title" --label task --state open --json number --jq '.[0].number')
gh issue edit "$ISSUE_NUM" --repo "$TRACKER_REPO" --remove-label "status:in-progress" --add-label "status:done"
gh issue close "$ISSUE_NUM" --repo "$TRACKER_REPO" --comment "Task completed and verified. Quality gate passed."
```

**In dual sync mode:**
1. Read the full task block from `progressing.txt` (between `------` separators, inclusive)
2. Remove it from `progressing.txt`
3. Append to `done.txt` in the appropriate section
4. Change `[~]` to `[x]` in the header line
5. Add a `COMPLETATO:` line with a brief English summary
6. Update recommended order annotation to `[COMPLETATO]` if applicable
7. Sync to GitHub (update labels and close issue as above)

**In local only mode:**
Same as dual sync steps 1-6, skip GitHub sync.

Inform the user: "Task [TASK-CODE] has been closed."

**6d. Ask to commit:**

Use `AskUserQuestion` with options:
- **"Yes, commit"** — create a commit referencing the task code
- **"No, skip commit"** — skip

**6e. Ask to merge into develop:**

Use `AskUserQuestion` with options:
- **"Yes, merge into develop"** — execute:
  ```bash
  git checkout develop
  git merge task/<task-code-lowercase> --no-ff -m "Merge task/<task-code-lowercase> into develop"
  ```
  Use `--no-ff` to preserve branch history.

  **Note:** If the task still has `status:to-test` label (user skipped testing), warn: "This task has not been tested yet. Consider running `/test-engineer TASK-CODE` before merging to a release branch."

- **"No, stay on task branch"** — skip the merge

**Important:** Always ask — never auto-commit, auto-close, or auto-merge without user confirmation.
