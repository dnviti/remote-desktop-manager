---
name: task-continue
description: Resume work on an in-progress task from progressing.txt or GitHub Issues. Assesses current implementation state and presents what remains.
disable-model-invocation: true
argument-hint: "[TASK-CODE]"
---

# Continue an In-Progress Task

You are a task manager for the Arsenale project. Your job is to help the user resume work on a task that is already in-progress.

This skill does NOT close or commit tasks — use `/task-pick` for that.

## Mode Detection

Determine the operating mode first:

```bash
TRACKER_CFG=".claude/issues-tracker.json"; [ ! -f "$TRACKER_CFG" ] && TRACKER_CFG=".claude/github-issues.json"
PLATFORM="$(jq -r '.platform // "github"' "$TRACKER_CFG" 2>/dev/null)"
TRACKER_ENABLED="$(jq -r '.enabled // false' "$TRACKER_CFG" 2>/dev/null)"
TRACKER_SYNC="$(jq -r '.sync // false' "$TRACKER_CFG" 2>/dev/null)"
TRACKER_REPO="$(jq -r '.repo' "$TRACKER_CFG" 2>/dev/null)"
```

- **Platform-only mode** (`TRACKER_ENABLED=true` AND `TRACKER_SYNC != true`): Read task data from GitHub Issues. No local file operations.
- **Dual sync / Local only mode**: Read task data from local files (`progressing.txt`).

---

## Current Task State

### GitHub-only mode — In-progress tasks:

```bash
gh issue list --repo "$TRACKER_REPO" --label "task,status:in-progress" --state open --json number,title --jq '.[] | "\(.title)"' 2>/dev/null
```

### Local/Dual mode — In-progress tasks (from progressing.txt):
!`grep '^\[~\]' progressing.txt 2>/dev/null | tr -d '\r'`

## Instructions

The user wants to continue working on a task. The argument provided is: **$ARGUMENTS**

---

### Step 1: Select the Task

**In GitHub-only mode:**
- Query in-progress tasks: `gh issue list --repo "$TRACKER_REPO" --label "task,status:in-progress" --state open --json number,title`
- If a task code was provided, search: `gh issue list --repo "$TRACKER_REPO" --search "[TASK-CODE] in:title" --label "task,status:in-progress" --json number,title`

**In local/dual mode:**
- Read `progressing.txt` and identify all tasks marked `[~]`.

**Common logic:**
- **If no in-progress tasks exist:** Inform the user there are no in-progress tasks and suggest using `/task-pick` to pick one up. Stop here.
- **If a task code was provided as argument:** Find that specific task. If not found, inform the user and list the available in-progress tasks.
- **If no argument was provided and exactly one in-progress task exists:** Use that task automatically.
- **If no argument was provided and multiple in-progress tasks exist:** Use `AskUserQuestion` to let the user choose which task to continue.

### Step 1.5: Switch to the task branch

After selecting the task, check if a dedicated task branch exists:

```bash
git branch --list "task/<task-code-lowercase>"
```

- **If the branch exists and you are not already on it:** Switch to it: `git checkout task/<task-code-lowercase>`. Inform the user: "Switched to branch `task/<task-code>`."
- **If the branch does not exist:** Inform the user that no task branch was found and continue on the current branch.

### Step 2: Read the Full Task Block

**In GitHub-only mode:**
- Find the issue number: `gh issue list --repo "$TRACKER_REPO" --search "[TASK-CODE] in:title" --label task --json number --jq '.[0].number'`
- Read the full issue body: `gh issue view $ISSUE_NUM --repo "$TRACKER_REPO" --json body --jq '.body'`
- Parse the issue body to extract:
  - **Description** section
  - **Technical Details** section
  - **Files Involved** section (files to CREATE and MODIFY)

**In local/dual mode:**
- Read the complete task block from `progressing.txt` for the selected task — everything between its `------` separator lines.
- Extract: **DESCRIZIONE**, **DETTAGLI TECNICI**, **FILE COINVOLTI** (files to CREARE and MODIFICARE)

### Step 3: Assess Current Implementation State

For each file in the FILES INVOLVED section, check what has already been done:

**For files marked CREATE:**
1. Use `Glob` to check if the file exists at the specified path
2. If not found at the exact path, search for the filename in nearby directories
3. If found, read it and check for key exports, components, or functions described in Technical Details
4. Note whether the file is: **missing**, **stub/empty**, or **implemented** (with details)

**For files marked MODIFY:**
1. Read the file to understand its current state
2. Use `Grep` to check for key changes described in Technical Details (new imports, function names, route paths, component names, API endpoints, store fields, UI elements)
3. Note which changes are: **already applied** vs. **still needed**

**Cross-check against Technical Details:**
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
