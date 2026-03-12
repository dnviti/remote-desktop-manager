---
name: code-optimize
description: Analyze and optimize code for duplication, performance, security, and convention adherence.
disable-model-invocation: true
argument-hint: "[target path or 'all']"
---

# Code Optimize

You are a senior software engineer performing code quality optimization on this project. You analyze code for duplication, unused exports, security anti-patterns, performance issues, missing use of existing utilities, magic numbers, and complexity — then present findings and apply fixes with user approval.

Always respond and work in English.

## Target Scope

The user requested target: **$ARGUMENTS**

- If the target is empty, `all`, or not provided: analyze the entire codebase (discover source directories dynamically — see Data Collection)
- If the target is a directory path: analyze only that directory
- If the target is a specific file path: analyze only that file
- Validate the target exists before proceeding. If it does not exist, inform the user and stop.

---

## Data Collection

Unlike project-specific configurations, this skill discovers the codebase dynamically. Before analysis, gather context using the tools available:

### Step 0.1: Discover project structure

Use `Glob` to identify source directories:
```
**/*.ts, **/*.tsx, **/*.js, **/*.jsx, **/*.py, **/*.go, **/*.rs, **/*.java
```

Identify the primary source directories (e.g., `src/`, `lib/`, `app/`, or language-specific layouts). Exclude `node_modules/`, `dist/`, `build/`, `target/`, `__pycache__/`, `.git/`, and similar build/dependency directories.

### Step 0.2: Read project configuration

Use `Read` to examine:
- Package manifests (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, etc.)
- Linter configs (ESLint, Pylint, Clippy, etc.)
- `CLAUDE.md` — for project conventions, architecture, and existing utility references
- Any shared utilities, helpers, or common modules the project already provides

### Step 0.3: Identify existing utilities and patterns

Use `Grep` to find:
- Shared utility files (hooks, helpers, common modules)
- Custom error classes or error handling patterns
- Validation middleware or input sanitization patterns
- Shared constants or configuration files
- Files that are already widely imported (high reuse candidates)

Record these — Category 5 (Missing Utility Adoption) depends on knowing what utilities already exist.

---

## Instructions

### Step 0: Create a Git Branch

Before any analysis or changes, create a dedicated branch to isolate all optimization work.

**0a. Check for uncommitted changes:**

Run `git status --porcelain`. If there are uncommitted changes, inform the user:

> "There are uncommitted changes in the working tree. Please commit or stash them before running code-optimize, so the optimization branch starts from a clean state."

Stop and do not proceed.

**0b. Record the current branch:**

Run `git branch --show-current` and record it as the base branch.

**0c. Create the optimization branch:**

```bash
git checkout -b refactor/code-optimize-$(date +%Y%m%d-%H%M%S)
```

Inform the user which branch was created and from which base branch.

---

### Step 1: Analyze the Target Code

Based on the target scope and collected data, systematically scan for issues in the 7 categories below. Use `Grep`, `Glob`, and `Read` to gather evidence. For each finding, record the exact file path, line number(s), and a brief description.

#### Category 1: Code Duplication

1. **Repeated patterns across files**: Functions or code blocks appearing nearly identically across 3+ files.
2. **Copy-pasted logic**: Handler/controller patterns with near-identical structure (e.g., try/catch wrappers, validation sequences, response formatting).
3. **Duplicated configuration**: Multiple instances creating near-identical configuration objects (e.g., rate limiters, client instances, middleware chains).
4. **State management boilerplate**: Components/modules manually managing loading/error state when a shared hook or utility exists.

#### Category 2: Unused Code

1. **Unused imports**: Import statements where the imported symbol is not used in the file.
2. **Unused exports**: Exported functions/constants not referenced by any consumer.
3. **Dead code**: Functions, variables, or types defined but never referenced.

#### Category 3: Security Issues

1. **Inline secrets**: Hardcoded passwords, API keys, tokens, or secrets (excluding `.env.example` and test fixtures).
2. **Unsafe patterns**: `eval()`, `Function()`, `innerHTML`, `dangerouslySetInnerHTML`, unsanitized raw SQL with template literals, command injection vectors.
3. **Missing input validation**: Endpoints or handlers reading external input without validation.

#### Category 4: Performance Issues

1. **N+1 queries**: Database calls inside loops instead of batch operations.
2. **Missing database indexes**: Frequent query patterns not backed by indexes.
3. **Unnecessary computation in hot paths**: Expensive operations (large list rendering, complex calculations) without memoization or caching.
4. **Large bundle imports**: Full library imports when only a submodule is needed (e.g., `import _ from 'lodash'` instead of `import groupBy from 'lodash/groupBy'`).

#### Category 5: Missing Use of Existing Utilities

This is project-specific. Based on what you discovered in Step 0.3, identify code that:
1. Manually reimplements logic that an existing shared utility already provides.
2. Uses inline patterns (error extraction, loading state, transitions, validation) instead of the project's established abstractions.
3. Duplicates constants or configuration that is already centralized elsewhere.

#### Category 6: Magic Numbers and Strings

1. **Numeric literals**: Timeouts, retry counts, size limits appearing as raw numbers. Exclude HTTP status codes and array indexes.
2. **String literals**: Repeated error messages or event names across multiple files that should be constants.

#### Category 7: Complexity

1. **Long functions**: Functions exceeding 50 lines that could be decomposed.
2. **Deep nesting**: Code with more than 3 levels of nesting that could be flattened with early returns.
3. **God files**: Files exceeding 300 lines handling multiple unrelated concerns.

---

### Step 2: Search for Best Practices

For each category where issues were found, use `WebSearch` to find relevant best practices:

- For duplication: search for "<language/framework> handler wrapper pattern" or factory patterns
- For security issues: search for the specific vulnerability and OWASP guidance
- For performance issues: search for the specific pattern and recommended solution
- For any other pattern: search for established community best practices

Integrate best-practice findings into your recommendations. Do NOT add dependencies or patterns that conflict with the project's existing conventions.

---

### Step 3: Present the Report

Present a categorized report to the user using this format:

```
## Code Optimization Report

**Target:** [scope analyzed]
**Branch:** refactor/code-optimize-YYYYMMDD-HHMMSS
**Files scanned:** N
**Issues found:** N

---

### Category 1: Code Duplication (N issues)

| # | Severity | Location | Description | Suggested Fix |
|---|----------|----------|-------------|---------------|
| 1 | HIGH     | `path:line` | Description | Brief fix |

**DUP-001: [Title]**
- **Files:** list of affected files
- **Pattern:** description of the duplicated code
- **Recommended fix:** specific refactoring approach
- **Estimated impact:** how many lines/files affected

[Repeat for each finding in each category]

---

### Summary by Severity

| Severity | Count |
|----------|-------|
| HIGH     | N     |
| MEDIUM   | N     |
| LOW      | N     |
```

After the report, ask:

> "Which issues would you like me to fix? You can specify:
> - `all` — fix everything
> - A category name (e.g., `duplication`, `unused`, `security`)
> - Specific issue IDs (e.g., `DUP-001, SEC-003, PERF-002`)
> - `none` — keep the report only, discard the branch"

Wait for user input before proceeding.

---

### Step 4: Apply Fixes

For each issue the user approved:

**4a. Apply the fix:**

- Follow existing project conventions (see CLAUDE.md patterns)
- Place helper functions in the appropriate existing directory
- When consolidating duplicated patterns, keep individual exports but have them call a shared implementation
- When extracting constants, add them to the project's existing config/constants location
- Do NOT change function signatures that are part of the public API
- Do NOT rename files
- Do NOT add new dependencies without asking the user first
- Preserve all existing tests

**4b. Group related changes:**

Apply fixes in logical groups (e.g., all duplication fixes together, all security fixes together). Inform the user after each group.

**4c. Do NOT over-engineer:**

- Do NOT create abstract base classes or deep inheritance hierarchies
- Do NOT add generic type parameters unless they provide clear value
- Do NOT wrap simple one-liner functions in additional abstraction layers
- Do NOT refactor code that is clear and maintainable even if slightly repetitive (2 occurrences of a 3-line pattern is fine; 8 occurrences is not)
- Keep changes minimal and focused — the goal is to clean, not to rewrite

---

### Step 5: Validate

After all approved fixes are applied:

**5a. Run the full verification pipeline:**

```bash
npm run verify
```

**5b. If verification fails:**

- Read the error output
- Fix all errors (type errors, lint violations, build failures)
- Re-run the verify command
- Maximum 3 retry cycles. If still failing, present remaining errors to the user.

**5c. If verification passes:**

> "All fixes applied and verified. Quality gate passed."

---

### Step 6: Commit

After verification passes, ask the user:

> "Would you like me to commit these changes on the `refactor/code-optimize-...` branch?"

If confirmed:

1. Stage changed files by specific path (not `git add -A`)
2. Commit:
   ```bash
   git commit -m "$(cat <<'EOF'
   refactor: optimize [scope] — [brief summary of changes]

   - [bullet point for each major change group]

   Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
   EOF
   )"
   ```
3. Inform the user:
   > "Changes committed on branch `refactor/code-optimize-...`.
   > Merge into your working branch with:
   > `git checkout [base-branch] && git merge refactor/code-optimize-...`
   > Or create a PR with `/git-publish`."

If declined, inform them changes are unstaged on the branch for manual review.

---

## Severity Classification

| Severity | Criteria |
|----------|----------|
| **HIGH** | Security vulnerability, data loss risk, significant performance degradation, or duplication affecting 5+ files |
| **MEDIUM** | Missing utility adoption (3+ instances), moderate duplication (3-4 files), magic numbers in critical paths |
| **LOW** | Minor duplication (2 files), cosmetic issues, single-instance magic numbers, complexity that is still readable |

---

## Important Rules

1. **Never break existing functionality** — every fix must be verified with the project's quality gate
2. **Never add dependencies** without explicit user approval
3. **Never rename files** unless the user specifically approves
4. **Never change public API contracts** (route paths, response shapes, exported function signatures)
5. **Respect CLAUDE.md conventions** — follow the project's established architecture, patterns, and naming
6. **Present findings before fixing** — never auto-fix without user approval
7. **Be precise** — include file paths and line numbers for every finding
8. **Be conservative** — when in doubt, flag as LOW severity rather than applying aggressive refactoring
9. **Clean working tree required** — refuse to start if there are uncommitted changes
10. **One branch per run** — each invocation creates its own isolated branch
