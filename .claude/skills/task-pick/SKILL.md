---
name: task-pick
description: Pick up the next todo task for implementation.
disable-model-invocation: true
argument-hint: "[TASK-CODE]"
---

# Pick Up a Task

You are a task manager for the Arsenale project. Your job is to pick up the next todo task for implementation.

## Mode Detection

!`python3 .claude/scripts/task_manager.py platform-config`

Use the `mode` field to determine behavior: `platform-only`, `dual-sync`, or `local-only`. The JSON includes `platform`, `enabled`, `sync`, `repo`, `cli` (gh/glab), and `labels`.

## Platform Commands

Use `python3 .claude/scripts/task_manager.py platform-cmd <operation> [key=value ...]` to generate the correct CLI command for the detected platform (GitHub/GitLab).

Supported operations: `list-issues`, `search-issues`, `view-issue`, `edit-issue`, `close-issue`, `comment-issue`, `create-issue`, `create-pr`, `list-pr`, `merge-pr`, `create-release`, `edit-release`.

Example: `python3 .claude/scripts/task_manager.py platform-cmd create-issue title="[CODE] Title" body="Description" labels="task,status:todo"`

## Current Task State

### Platform-only mode:

```bash
# Pending tasks (by priority)
gh issue list --repo "$TRACKER_REPO" --label "task,status:todo,priority:high" --state open --json number,title --jq '.[] | "\(.title)"' 2>/dev/null
# GitLab: glab issue list -R "$TRACKER_REPO" -l "task,status:todo,priority:high" --state opened --output json | jq '.[].title'
gh issue list --repo "$TRACKER_REPO" --label "task,status:todo,priority:medium" --state open --json number,title --jq '.[] | "\(.title)"' 2>/dev/null
# GitLab: glab issue list -R "$TRACKER_REPO" -l "task,status:todo,priority:medium" --state opened --output json | jq '.[].title'
gh issue list --repo "$TRACKER_REPO" --label "task,status:todo,priority:low" --state open --json number,title --jq '.[] | "\(.title)"' 2>/dev/null
# GitLab: glab issue list -R "$TRACKER_REPO" -l "task,status:todo,priority:low" --state opened --output json | jq '.[].title'
# Completed tasks
gh issue list --repo "$TRACKER_REPO" --label "task,status:done" --state closed --limit 20 --json number,title --jq '.[] | "\(.title)"' 2>/dev/null
# GitLab: glab issue list -R "$TRACKER_REPO" -l "task,status:done" --state closed --output json | jq '.[].title'
```

### Local/Dual mode:

#### Pending tasks:
!`python3 .claude/scripts/task_manager.py list --status todo --format summary`

#### Completed tasks:
!`python3 .claude/scripts/task_manager.py list --status done --format summary`

#### Recommended implementation order:
!`python3 .claude/scripts/task_manager.py sections --file to-do.txt`

## Instructions

The user wants to pick up a task. The argument provided is: **$ARGUMENTS**

---

### Step 1: Determine which task to pick

**In platform-only mode:**
- **If a task code was provided** (e.g., `AUTH-001`): Search for it: `gh issue list --repo "$TRACKER_REPO" --search "[TASK-CODE] in:title" --label "task,status:todo" --state open --json number,title`
  <!-- GitLab: glab issue list -R "$TRACKER_REPO" --search "[TASK-CODE]" -l "task,status:todo" --state opened --output json -->
  - If not found in todo, check if already done: `gh issue list --repo "$TRACKER_REPO" --search "[TASK-CODE] in:title" --label "task,status:done" --state closed --json number,title`
    <!-- GitLab: glab issue list -R "$TRACKER_REPO" --search "[TASK-CODE]" -l "task,status:done" --state closed --output json -->
  - If done, inform the user and suggest the next available task.
- **If no argument was provided**: Select the next task by priority label ordering: `priority:high` first, then `priority:medium`, then `priority:low`. Within same priority, pick the lowest-numbered task. Check dependencies by reading the task body — dependency task codes should have `status:done` label.

**In local/dual mode:**
- **If a task code was provided**: Use that specific task. Verify it exists in `to-do.txt` and is in `[ ]` (todo) status. If found in `done.txt` as `[x]` (completed), inform the user and suggest the next available task.
- **If no argument was provided**: Select the next task from the recommended implementation order that is still `[ ]` (todo) in `to-do.txt`. Skip tasks found in `done.txt` (completed) or `progressing.txt` (in-progress). Also verify that the task's dependencies are satisfied (dependency tasks should be in `done.txt` as `[x]`). If a task has unsatisfied dependencies, skip it and pick the next one.

### Step 2: Mark task as in-progress

**In platform-only mode:**

Update the GitHub Issue labels:
```bash
ISSUE_NUM=$(gh issue list --repo "$TRACKER_REPO" --search "[TASK-CODE] in:title" --label "task,status:todo" --state open --json number --jq '.[0].number')
# GitLab: glab issue list -R "$TRACKER_REPO" --search "[TASK-CODE]" -l task --state opened --output json | jq '.[0].iid'
gh issue edit "$ISSUE_NUM" --repo "$TRACKER_REPO" --remove-label "status:todo" --add-label "status:in-progress"
# GitLab: glab issue update "$ISSUE_NUM" -R "$TRACKER_REPO" --unlabel "status:todo" --label "status:in-progress"
gh issue comment "$ISSUE_NUM" --repo "$TRACKER_REPO" --body "Task picked up. Branch: \`task/<task-code-lowercase>\`"
# GitLab: glab issue note "$ISSUE_NUM" -R "$TRACKER_REPO" -m "Task picked up. Branch: \`task/<task-code-lowercase>\`"
```

**In dual sync mode:**

1. Run the move command:
   ```bash
   python3 .claude/scripts/task_manager.py move TASK-CODE --to progressing
   ```
   This automatically removes the block from `to-do.txt`, inserts it into `progressing.txt`, and updates the status symbol from `[ ]` to `[~]`. Verify the JSON output shows `"success": true`.
2. If the task appears in the recommended order section of `to-do.txt`, update its status annotation to `[IN PROGRESS]`.
3. Sync to GitHub (update labels as above).

**In local only mode:**

Same as dual sync steps 1-2, skip GitHub sync.

### Step 2.5: Create a task branch

Create a dedicated git branch for this task, branching from `develop`.

**2.5a. Check the working tree:**
```bash
git status --porcelain
```
If dirty, inform the user and stop.

**2.5b. Switch to the release branch and pull latest:**
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

**In platform-only mode:**
- `gh issue view $ISSUE_NUM --repo "$TRACKER_REPO" --json body --jq '.body'`
  <!-- GitLab: glab issue view $ISSUE_NUM -R "$TRACKER_REPO" --output json | jq '.description' -->
- Parse the structured body: DESCRIPTION, TECHNICAL DETAILS, Files involved (CREATE / MODIFY) sections.

**In local/dual mode:**

Get the full parsed task data:
```bash
python3 .claude/scripts/task_manager.py parse TASK-CODE
```
This returns all fields as structured JSON: priority, dependencies, description, technical_details, files_create, files_modify.

### Step 4: Explore the codebase

For each file listed in the "Files involved" section:
- If the file exists, read it to understand the current state
- If marked "CREATE", check the target directory and look at similar files for patterns to follow
- Identify relevant interfaces, types, and patterns

**Architecture references:**
- Server: Express + TypeScript, layered as Routes -> Controllers -> Services -> Prisma ORM
- Client: React 19 + Vite + MUI v6, with Zustand stores
- Real-time: Socket.IO for SSH terminals, Guacamole WebSocket for RDP
- Database: PostgreSQL via Prisma

### Step 5: Present the implementation briefing

Present a clear English-language briefing:

1. **Task Selected**: Code, title, and priority
2. **Status Update**: Confirm the task was marked as in-progress
3. **Scope Summary**: What needs to be done
4. **Technical Approach**: Implementation steps based on task details and codebase exploration
5. **Files to Create/Modify**: Every file with what needs to happen in each
6. **Dependencies**: Status of all dependencies
7. **Risks**: Any concerns found during exploration
8. **Prisma Migration**: Note if schema changes are involved — migrations run automatically on server start via `prisma migrate deploy`
9. **Quality Gate**: Remind that `npm run verify` must pass before the task can be closed

After presenting the briefing, ask the user: "Ready to start implementation, or would you like to adjust the approach?"

---

### Step 6: Post-Implementation — Confirm, Close & Commit

After a task has been **fully implemented and the quality gate (`npm run verify`) passes**, execute this completion flow:

**6a. Present a Testing Guide:**

Before asking the user to confirm, generate and present a **manual testing guide** specific to the task that was just implemented. Derive the guide from the task's TECHNICAL DETAILS and Files involved sections.

Present it in this format:

> ### Testing Guide for [TASK-CODE] — [Task Title]
>
> **Prerequisites:**
> - [What needs to be running — e.g., `npm run predev` for Docker containers, `npm run dev` for server on :3001 + client on :3000]
>
> **Steps to test:**
> 1. [Concrete action the user can perform in the browser or terminal]
>    - **Expected:** [What they should see or what should happen]
> 2. [Next action]
>    - **Expected:** [Result]
> 3. [Continue as needed...]
>
> **Edge cases to check:**
> - [2-3 edge cases worth verifying — e.g., empty states, error handling, permissions, invalid input]

The guide must be actionable and specific — use real URLs, real UI element names, and real API endpoints from the implementation. Do not use generic placeholders.

**6a.5. Mark task as to-test:**

Before asking the user to confirm, add the `status:to-test` label to signal the task is awaiting test verification. Keep the `status:in-progress` label in place — `to-test` is an additive marker.

**In platform-only or dual sync mode:**
```bash
ISSUE_NUM=$(gh issue list --repo "$TRACKER_REPO" --search "[TASK-CODE] in:title" --label task --state open --json number --jq '.[0].number')
# GitLab: glab issue list -R "$TRACKER_REPO" --search "[TASK-CODE]" -l task --state opened --output json | jq '.[0].iid'
gh issue edit "$ISSUE_NUM" --repo "$TRACKER_REPO" --add-label "status:to-test"
# GitLab: glab issue update "$ISSUE_NUM" -R "$TRACKER_REPO" --label "status:to-test"
```

**In local only mode:** No label change needed — the to-test state is implicit within this flow.

**6b. Ask for user confirmation:**

Present a summary of what was done and ask the user to confirm:

> "Implementation of **[TASK-CODE] — [Task Title]** is complete and the quality gate passed.
>
> **Summary of work done:**
> - [brief list of what was created/modified]
>
> The task has been marked as **status:to-test**. Please review the testing guide above.
>
> Can you confirm this task is done?"

Use `AskUserQuestion` with options:
- **"Yes, task is done (tests passed)"** — proceed to 6b.5 then 6c (full flow including merge option)
- **"Not yet, needs more work"** — proceed to 6b.5 then stop the completion flow; the task stays in-progress
- **"Skip testing, conclude task"** — proceed to 6b.5 then 6c (mark done, but branch will NOT be merged to release)

**6b.5. Remove to-test label:**

After the user responds to 6b, always remove the `status:to-test` label regardless of which option was chosen:

**In platform-only or dual sync mode:**
```bash
gh issue edit "$ISSUE_NUM" --repo "$TRACKER_REPO" --remove-label "status:to-test"
# GitLab: glab issue update "$ISSUE_NUM" -R "$TRACKER_REPO" --unlabel "status:to-test"
```

**In local only mode:** No action needed.

**6c. Mark task as done:**

Once the user confirms the work is done (either "Yes, task is done (tests passed)" or "Skip testing, conclude task"):

**In platform-only mode:**
```bash
ISSUE_NUM=$(gh issue list --repo "$TRACKER_REPO" --search "[TASK-CODE] in:title" --label task --state open --json number --jq '.[0].number')
# GitLab: glab issue list -R "$TRACKER_REPO" --search "[TASK-CODE]" -l task --state opened --output json | jq '.[0].iid'
gh issue edit "$ISSUE_NUM" --repo "$TRACKER_REPO" --remove-label "status:in-progress" --add-label "status:done"
# GitLab: glab issue update "$ISSUE_NUM" -R "$TRACKER_REPO" --unlabel "status:in-progress" --label "status:done"
```

If the user chose **"Yes, task is done (tests passed)"**:
```bash
gh issue close "$ISSUE_NUM" --repo "$TRACKER_REPO" --comment "Task completed and verified. Quality gate passed."
# GitLab: glab issue close "$ISSUE_NUM" -R "$TRACKER_REPO"
# GitLab: glab issue note "$ISSUE_NUM" -R "$TRACKER_REPO" -m "Task completed and verified. Quality gate passed."
```

If the user chose **"Skip testing, conclude task"**:
```bash
gh issue close "$ISSUE_NUM" --repo "$TRACKER_REPO" --comment "Task completed. Quality gate passed. Manual testing was skipped by user. Branch not merged to release."
# GitLab: glab issue close "$ISSUE_NUM" -R "$TRACKER_REPO"
# GitLab: glab issue note "$ISSUE_NUM" -R "$TRACKER_REPO" -m "Task completed. Quality gate passed. Manual testing was skipped by user. Branch not merged to release."
```

**In dual sync mode:**
1. Run the move command with a completion summary:
   ```bash
   python3 .claude/scripts/task_manager.py move TASK-CODE --to done --completed-summary "Brief summary of what was implemented"
   ```
   This automatically removes from `progressing.txt`, inserts into `done.txt`, updates `[~]` to `[x]`, and adds the `COMPLETED:` line.
2. If the task appears in the recommended order section of `to-do.txt`, update its status annotation to `[COMPLETED]`.
3. Sync to GitHub (update labels and close issue as above).

**In local only mode:**
Same as dual sync steps 1-2, skip GitHub sync.

Inform the user: "Task [TASK-CODE] has been closed."

**6d. Ask to commit:**

After closing the task, ask the user:

> "Would you like me to commit these changes?"

Use `AskUserQuestion` with options:
- **"Yes, commit"** — create a commit using the `/commit` skill (or follow the standard git commit workflow). The commit message should reference the task code and briefly describe what was implemented.
- **"No, skip commit"** — skip the commit; done.

**6e. Ask to create a Pull Request into the release branch (TESTS PASSED ONLY):**

**Important:** This step is ONLY executed when the user chose **"Yes, task is done (tests passed)"** in step 6b. Tasks that skipped testing must NOT be merged into the release branch to prevent untested or broken features from reaching production.

**If testing was confirmed**, use `AskUserQuestion` with options:
- **"Yes, create PR into develop"** — execute the steps below
- **"No, stay on task branch"** — skip PR creation

**If the user chooses to create a PR:**

1. **Push the task branch to remote:**
   ```bash
   git push -u origin task/<task-code-lowercase>
   ```

2. **Check for an existing PR/MR** (avoid duplicates):
   ```bash
   gh pr list --base develop --head task/<task-code-lowercase> --state open --json number,url --jq '.[0]'
   # GitLab: glab mr list --target-branch develop --source-branch task/<task-code-lowercase> --state opened --output json | jq '.[0]'
   ```
   If a PR already exists, inform the user and provide the existing PR URL. Skip creation.

3. **Build the PR body:**

   **If `TRACKER_ENABLED` is `true` (platform-only or dual sync mode):**
   ```bash
   ISSUE_NUM=$(gh issue list --repo "$TRACKER_REPO" --search "[TASK-CODE] in:title" --label task --json number --jq '.[0].number' 2>/dev/null)
   # GitLab: glab issue list -R "$TRACKER_REPO" --search "[TASK-CODE]" -l task --output json | jq '.[0].iid'
   ```

   PR body template:
   ```
   ## Task [TASK-CODE] — [Task Title]

   ### Summary
   [brief list of what was created/modified — reuse from 6b summary]

   ### Related Issue
   Refs #<ISSUE_NUM> ([TASK-CODE])

   ---
   *Generated by Claude Code via `/task-pick`*
   ```

   **If `TRACKER_ENABLED` is `false` or config missing (local only mode):**

   PR body template (omit the "Related Issue" section):
   ```
   ## Task [TASK-CODE] — [Task Title]

   ### Summary
   [brief list of what was created/modified]

   ---
   *Generated by Claude Code via `/task-pick`*
   ```

4. **Create the PR/MR:**

   **GitHub:**
   ```bash
   gh pr create --base develop --head task/<task-code-lowercase> \
     --title "[TASK-CODE] — [Task Title]" \
     --body "$PR_BODY"
   ```

   **GitLab:**
   ```bash
   glab mr create --target-branch develop --source-branch task/<task-code-lowercase> \
     --title "[TASK-CODE] — [Task Title]" \
     --description "$PR_BODY"
   ```

5. **Report the PR URL to the user:**

   > "Pull Request created: <PR_URL>
   > Target branch: `develop`
   > The task branch `task/<task-code-lowercase>` is ready for review and merge."

**If testing was skipped**, do NOT offer the PR. Instead, inform the user:

> "Task [TASK-CODE] was closed without testing confirmation. The task branch `task/<task-code-lowercase>` has **NOT** been submitted as a PR into develop.
> Run `/test-engineer [TASK-CODE]` to complete testing before creating a PR."

**Important:** Always ask — never auto-commit, auto-close, or auto-create PRs without user confirmation. Never merge directly into `develop` without a PR.
