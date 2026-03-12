---
name: docs
description: "Manage all project documentation. Operations: create, update, verify (docs/ folder); sync (task files + doc alignment); claude-md (update CLAUDE.md from code changes). Usage: /docs <operation> [args]."
disable-model-invocation: true
argument-hint: "<create|update|verify|sync|claude-md> [category or context]"
---

# Documentation Manager

You are a documentation manager for this project. Your job is to create, update, verify, and synchronize project documentation based on the actual codebase.

**Important:** `docs/rag-summary.md` must be kept in sync whenever documentation or features change. If any feature is added, modified, or removed, update this file to reflect the current state.

## Current Documentation State

### Existing docs/ files:
!`python3 .claude/scripts/task_manager.py find-files --patterns "*.md" --max-depth 2 --limit 20`

### README.md:
!`python3 -c "from pathlib import Path; p=Path('README.md'); print(f'Exists ({len(p.read_text().splitlines())} lines)') if p.exists() else print('Missing')"`

### Files changed in last 5 commits:
!`git diff --name-only HEAD~5..HEAD 2>&1 || echo "(no recent commits)"`

### In-progress tasks:
!`python3 .claude/scripts/task_manager.py list --status progressing --format summary`

### Recently completed tasks:
!`python3 .claude/scripts/task_manager.py list --status done --format summary`

## Arguments

The user invoked: **$ARGUMENTS**

## Instructions

### Step 1: Parse the command

Extract the **operation** and optional **category/context** from `$ARGUMENTS`:
- Format: `<operation> [category]`
- Valid operations: `create`, `update`, `verify`, `sync`, `claude-md`
- Categories (for create/update/verify): define based on your project's structure (e.g., `api`, `database`, `components`, `architecture`, `security`, `deployment`, `environment`, `all`)
- If no category is given for create/update/verify, default to `all`
- If arguments are empty or invalid, show this usage guide and stop:

```
Usage: /docs <operation> [category]

Operations:
  create     — Generate new documentation from code
  update     — Refresh existing docs to match current code
  verify     — Check docs accuracy (read-only, no changes)
  sync       — Synchronize task files and align related documentation
  claude-md  — Update CLAUDE.md to reflect current codebase state

Categories (for create/update/verify):
  api, database, components, architecture, security, deployment, environment
  all        — All categories (default)

Examples:
  /docs create api
  /docs verify
  /docs update database
  /docs sync
  /docs claude-md
```

### Step 2: Route to the correct operation

Based on the parsed operation, follow the corresponding section below.

---

## Operation: CREATE

Generate new documentation. For each category, read the relevant source files and produce a well-structured markdown document in `docs/`.

**Before writing any files**, create the `docs/` directory if it does not exist:
```bash
mkdir -p docs
```

Every generated document MUST begin with this header:

```markdown
# [Document Title]

> Auto-generated on [YYYY-MM-DD] by `/docs create [category]`.
> Source of truth is the codebase. Run `/docs update [category]` after code changes.
```

**For each category:**
1. Identify the relevant source files in the project
2. Read them thoroughly
3. Generate a comprehensive markdown document covering all key aspects
4. Save to `docs/[category].md`

**After creating or updating any documentation, also update `docs/rag-summary.md`** to reflect the current feature and documentation state.

### When category is `all`

Run create for each defined category in logical order. Present a summary at the end listing all files created with line counts.

---

## Operation: UPDATE

Refresh existing documentation to match current code.

### Step 1: Check existing docs

For the specified category, check if `docs/[category].md` exists. If not, inform the user and suggest running `/docs create [category]` instead.

### Step 2: Identify drift

Read the existing doc file AND the relevant source files. Compare and identify:
- **Missing items**: code elements in source but not documented
- **Removed items**: documented elements that no longer exist in code
- **Changed items**: documented details that no longer match code

### Step 3: Update the document

Regenerate the document following the same structure as CREATE, but:
- **Preserve manual sections**: any content between `<!-- manual-start -->` and `<!-- manual-end -->` markers must be kept unchanged
- Update the timestamp in the header
- Keep the same file path

**After updating any documentation, also update `docs/rag-summary.md`** to reflect the current state.

### Step 4: Report changes

After updating, present a summary:

```
## Update Summary: docs/[category].md

**Changes made:**
- Added: [list of new items documented]
- Updated: [list of items whose documentation changed]
- Removed: [list of items removed from docs]
- Preserved: [count] manual sections unchanged

**Files read**: [list of source files consulted]
```

### When category is `all`

Iterate through all existing `.md` files in `docs/` and update each one. If a category file is missing, skip it and note it in the summary.

---

## Operation: VERIFY

Check documentation accuracy without modifying any files. This is a **read-only** operation — do NOT edit or write any files.

### Step 1: Inventory existing documentation

List all documentation files: `docs/*.md`, `README.md`, `CLAUDE.md`.

### Step 2: Verify each document

For each existing doc file, read it and compare against the actual source code.

**Checks to perform:**
- Every documented element still exists in the codebase
- Documented types, parameters, and behaviors match the actual code
- File paths mentioned in docs actually exist
- No documented features have been removed from the codebase
- `docs/rag-summary.md` is consistent with the current feature set

### Step 3: Present verification report

```
## Documentation Verification Report

**Date**: [current date]
**Overall Status**: [PASS | DRIFT DETECTED | DOCS MISSING]

### File Inventory
| File | Exists | Last Modified |
|------|--------|---------------|
| [doc file] | Yes/No | date or N/A |

### Drift Report
| Document | Status | Issues Found |
|----------|--------|-------------|
| [file] | OK / DRIFT / MISSING | [count] issues |

### Detailed Findings

#### [document name]
- [MISSING] [element] not documented
- [DRIFT] [element] documented as X, actual is Y
- [STALE] [element] documented but no longer exists
...

### Recommended Actions
- Run `/docs create [category]` for missing documents
- Run `/docs update [category]` for drifted documents
```

---

## Operation: SYNC

Synchronize task tracking files and align related documentation when tasks change status.

### Step 1: Assess Current State
- Read all three task files (`to-do.txt`, `progressing.txt`, `done.txt`)
- Identify which tasks have recently changed status based on the conversation context
- If invoked without specific context, scan all three files for inconsistencies

### Step 2: Update Task Files
- Move tasks to the correct file based on their new status
- Ensure the status symbol matches the file (`[ ]`, `[~]`, or `[x]`)
- Preserve task descriptions exactly — do not rephrase or summarize
- Maintain chronological or logical ordering within each file

### Step 3: Review Documentation Impact
- For each progressed/completed task, determine if it affects any documentation:
  - New features -> update feature documentation, README sections
  - Architecture changes -> update CLAUDE.md architecture section
  - New commands or scripts -> update Development Commands section in CLAUDE.md
  - New file patterns -> update File Naming Conventions table in CLAUDE.md
  - New environment variables -> update Environment Setup section
  - API changes -> update relevant API documentation
- **Always check if `docs/rag-summary.md` needs updating** when features change

### Step 4: Apply Documentation Updates
- Make precise, targeted edits — do not rewrite entire documents
- Maintain the existing documentation style and format
- Add new sections only when genuinely needed
- Keep language clear, concise, and technical

### Step 5: Verify Consistency
- Cross-check that no task appears in multiple files
- Verify that documentation references match actual file paths and command names
- Ensure no stale references to removed or renamed features remain
- Confirm the task count adds up (no tasks lost in transition)

### Sync Quality Standards

- **Accuracy over completeness**: Only document what is actually implemented.
- **Minimal diffs**: Make the smallest possible changes to achieve alignment.
- **Preserve voice**: Match the existing documentation tone and conventions exactly.
- **No data loss**: Never delete task entries — only move them between files.

---

## Operation: CLAUDE-MD

Update `CLAUDE.md` to reflect the current state of the codebase. Use this after architectural changes, new patterns, new commands, schema changes, or any structural change.

### Step 1: Understand What Changed

Before making any updates, thoroughly investigate what has changed:

1. **Read the current CLAUDE.md** to understand its existing structure and content.
2. **Examine recent file changes** — look at new, modified, or deleted files.
3. **Read relevant source files** — don't guess about new patterns or architecture.
4. **Check configuration files** (package.json, build configs, Docker files) for tooling changes.

### Step 2: Determine What Needs Updating

Compare findings against each section of CLAUDE.md:

- **Development Commands** — New scripts, changed scripts, removed scripts.
- **Environment Setup** — New env vars, changed setup, new services.
- **Architecture** — New directories, layers, entry points, restructured code.
- **Key Patterns** — New or changed patterns.
- **File Naming Conventions** — New file types or changed naming patterns.

### Step 3: Apply Updates Surgically

1. **Preserve the existing structure and style.**
2. **Be precise and concise.**
3. **Add new sections only when necessary.**
4. **Update, don't just append.**
5. **Remove outdated information.**
6. **Maintain the imperative/instructional tone.**
7. **Keep command blocks accurate.**
8. **Preserve all existing rules and constraints** unless they have explicitly changed.

### Step 4: Validate Your Changes

1. Re-read the entire file to ensure consistency and flow.
2. Verify no contradictions exist between sections.
3. Check that all file paths mentioned actually exist.
4. Confirm table formatting is correct and aligned.

### CLAUDE-MD Rules

- **Never change the Language section** unless explicitly instructed.
- **Never add speculative content** — only document what actually exists.
- **Never duplicate information** — reference rather than repeat.
- **Always preserve the Task Files section** format and rules.
- **Always maintain the File Naming Conventions table** with accurate patterns.
- **Keep CLAUDE.md focused** — only information that helps Claude Code work with this codebase.

---

## Important Guidelines

1. **Always read source code** before writing or verifying documentation. Never guess — always base documentation on actual file contents.
2. **Use consistent formatting** across all doc files: ATX headers, fenced code blocks, tables with alignment.
3. **Include code references** where helpful: file paths, function names, type names.
4. **Timestamp every generated document** so readers know when it was last generated.
5. **Manual section markers**: When creating docs, add a `<!-- manual-start -->` / `<!-- manual-end -->` block at the end of each major section for user notes, so that `update` preserves them.
6. **Do not modify README.md** during create/update operations. Only check it during verify.
7. **Language**: All documentation must be written in English.
8. **Always keep `docs/rag-summary.md` in sync** with the current state of the project's features and documentation.
