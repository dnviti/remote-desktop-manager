---
name: code-optimize
description: Analyze and optimize code for duplication, performance, security, and convention adherence.
disable-model-invocation: true
allowed-tools: Bash, Read, Grep, Glob, Edit, Write, TaskOutput, WebSearch
argument-hint: "[target path or 'all']"
---

# Code Optimize

You are a senior software engineer performing code quality optimization on the Arsenale codebase. You analyze code for duplication, unused exports, security anti-patterns, performance issues, missing use of existing utilities, magic numbers, and complexity — then present findings and apply fixes with user approval.

Always respond and work in English.

## Target Scope

The user requested target: **$ARGUMENTS**

- If the target is empty, `all`, or not provided: analyze the entire codebase (`server/src/` and `client/src/`)
- If the target is a directory path (e.g., `server/src/controllers`): analyze only that directory
- If the target is a specific file path: analyze only that file
- Validate the target exists before proceeding. If it does not exist, inform the user and stop.

---

## Data Collection

The following data is gathered automatically for your analysis.

### Project structure (server)
!`ls server/src/controllers/ server/src/services/ server/src/middleware/ server/src/routes/ server/src/utils/ server/src/schemas/ 2>/dev/null`

### Project structure (client)
!`ls client/src/components/Dialogs/ client/src/api/ client/src/store/ client/src/hooks/ client/src/utils/ 2>/dev/null`

### Existing shared utilities (client — useAsyncAction)
!`cat client/src/hooks/useAsyncAction.ts 2>/dev/null`

### Existing shared utilities (client — extractApiError)
!`cat client/src/utils/apiError.ts 2>/dev/null`

### Existing shared utilities (client — SlideUp)
!`cat client/src/components/common/SlideUp.tsx 2>/dev/null`

### Components using useAsyncAction (already adopted)
!`grep -rl "useAsyncAction" client/src/ 2>/dev/null || echo "NO_MATCHES: No files use useAsyncAction"`

### Dialogs with manual loading/error state (candidates for useAsyncAction)
!`grep -rl "useState.*loading\|setLoading\|useState.*error.*setError" client/src/components/ 2>/dev/null || echo "NO_MATCHES: No manual loading/error state found"`

### Components NOT using extractApiError
!`grep -rl "\.response\.data\.\(error\|message\)" client/src/ --include="*.tsx" --include="*.ts" 2>/dev/null || echo "NO_MATCHES: No inline error extraction found"`

### Server error middleware and AppError class
!`cat server/src/middleware/error.middleware.ts 2>/dev/null`

### Validate middleware (existing Zod validation)
!`cat server/src/middleware/validate.middleware.ts 2>/dev/null`

### Server config (centralized constants)
!`cat server/src/config.ts 2>/dev/null`

### ESLint config
!`cat eslint.config.mjs 2>/dev/null`

### Catch-block count per controller
!`grep -c "} catch" server/src/controllers/*.ts 2>/dev/null`

### assertAuthenticated usage per controller
!`grep -c "assertAuthenticated" server/src/controllers/*.ts 2>/dev/null`

### Rate-limit middleware files
!`ls server/src/middleware/*rate* server/src/middleware/*Rate* 2>/dev/null || echo "NO_MATCHES: No rate-limit middleware files"`

### Rate-limit configurations
!`grep -rn "rateLimit(" server/src/middleware/ --include="*.ts" -A 8 2>/dev/null || echo "NO_MATCHES: No rateLimit calls found"`

### Magic numbers in server code (4+ digit numbers outside imports/status codes)
!`grep -rnE "[^a-zA-Z0-9_][0-9]{4,}[^a-zA-Z0-9_]" server/src/controllers/ server/src/services/ --include="*.ts" 2>/dev/null | grep -vE "import|//|statusCode|status\(|\.port|config\.|schema\." | head -40`

### Magic numbers in client code (setTimeout, intervals)
!`grep -rnE "setTimeout\(.*[0-9]{3,}|setInterval\(.*[0-9]{3,}" client/src/ --include="*.ts" --include="*.tsx" 2>/dev/null | head -30`

### Inline error message strings in dialogs (not using extractApiError)
!`grep -rn "setError(" client/src/components/Dialogs/ --include="*.tsx" 2>/dev/null | head -30`

### Exported functions from services
!`grep -roh "export function [a-zA-Z]*\|export const [a-zA-Z]*\|export async function [a-zA-Z]*" server/src/services/*.ts 2>/dev/null | sort`

### Prisma schema (for index analysis)
!`cat server/prisma/schema.prisma 2>/dev/null`

### N+1 query candidates (Prisma calls inside loops)
!`grep -rnB2 "prisma\.\|findUnique\|findFirst\|findMany\|create\|update\|delete" server/src/services/ --include="*.ts" 2>/dev/null | grep -B2 "for \|\.map\|\.forEach\|while " | head -30`

### Large bundle imports
!`grep -rn "import .* from 'lodash'" client/src/ server/src/ --include="*.ts" --include="*.tsx" 2>/dev/null || echo "NO_MATCHES: No full lodash imports"`

### Files over 300 lines
!`wc -l server/src/controllers/*.ts server/src/services/*.ts client/src/components/**/*.tsx 2>/dev/null | sort -rn | head -20`

### Functions over 50 lines (approximate — look for function/const arrow gaps)
!`grep -rn "export async function\|export function\|export const .* = async" server/src/controllers/*.ts server/src/services/*.ts 2>/dev/null | head -40`

### Deep nesting (4+ indentation levels)
!`grep -rnE "^(\s{16}|\t{4})" server/src/controllers/*.ts server/src/services/*.ts 2>/dev/null | head -20`

### Dangerous patterns (eval, innerHTML, dangerouslySetInnerHTML)
!`grep -rn "eval(\|Function(\|innerHTML\|dangerouslySetInnerHTML\|\$queryRaw\`\|\$executeRaw\`" server/src/ client/src/ --include="*.ts" --include="*.tsx" 2>/dev/null || echo "NO_MATCHES: No dangerous patterns found"`

### Hardcoded secrets candidates
!`grep -rnE "(password|secret|key|token)\s*[:=]\s*['\"][^'\"]{8,}" server/src/ --include="*.ts" 2>/dev/null | grep -vE "\.env|config\.|process\.env|type |interface |import|req\.|param|schema" | head -20`

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

Based on the target scope and collected data, systematically scan for issues in the 7 categories below. Use `Grep`, `Glob`, and `Read` to gather additional evidence beyond what was pre-collected. For each finding, record the exact file path, line number(s), and a brief description.

#### Category 1: Code Duplication

1. **Controller catch blocks**: Controllers wrapping every handler in `try { assertAuthenticated(req); ... } catch (err) { next(err); }`. Count controllers with this pattern.
2. **Rate-limit middleware**: Multiple files creating `rateLimit()` instances with near-identical configuration. Check if a factory function would reduce duplication.
3. **Client dialog loading/error state**: Dialogs manually declaring `useState` for loading/error instead of using `useAsyncAction`.
4. **Client API modules**: Identical `const res = await api.get(...); return res.data;` patterns. Only flag if there are 3+ lines of true duplication per function.
5. **General copy-paste blocks**: Functions or code blocks appearing nearly identically across multiple files.

#### Category 2: Unused Code

1. **Unused imports**: Import statements where the imported symbol is not used in the file.
2. **Unused exports**: Exported functions/constants not referenced by any consumer.
3. **Dead code**: Functions, variables, or types defined but never referenced.

#### Category 3: Security Issues

1. **Inline secrets**: Hardcoded passwords, API keys, tokens, or secrets (excluding `.env.example` and test fixtures).
2. **Unsafe patterns**: `eval()`, `Function()`, `innerHTML`, `dangerouslySetInnerHTML`, unsanitized `$queryRaw`/`$executeRaw` with template literals.
3. **Missing input validation**: Controller endpoints reading from `req.body`/`req.params`/`req.query` without a corresponding `validate()` middleware in the route.

#### Category 4: Performance Issues

1. **N+1 queries**: Service functions calling Prisma inside a loop instead of using batch operations.
2. **Missing database indexes**: Frequent query patterns in services not backed by Prisma schema indexes.
3. **Unnecessary re-renders (client)**: Only flag genuinely expensive cases (large lists, complex computations in render without `useMemo`).
4. **Large bundle imports**: Full library imports when only a submodule is needed.

#### Category 5: Missing Use of Existing Utilities

1. **`useAsyncAction` not used**: Dialogs/forms with manual loading/error state.
2. **`extractApiError` not used**: Catch blocks manually extracting error messages from Axios responses.
3. **`SlideUp` not imported**: Full-screen dialogs defining their own `Slide` transition.
4. **`AppError` not used**: Server code manually setting `res.status(N).json({ error })` in catch blocks.
5. **`validate` middleware not used**: Routes doing inline Zod parsing in the controller.

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

- For Express controller duplication: search for "express async handler wrapper pattern typescript"
- For rate-limit factory: search for "express-rate-limit factory function pattern"
- For React hook adoption: search for "react custom hook loading error state pattern"
- For any security issue found: search for the specific vulnerability and OWASP guidance
- For performance issues: search for the specific pattern and recommended solution

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
- Place helper functions in the appropriate existing directory (`server/src/utils/`, `client/src/hooks/`)
- When consolidating rate-limit middleware, keep individual exports but have them call a shared factory
- When adopting `useAsyncAction`, remove manual `useState` for loading/error and replace the try/catch pattern
- When extracting constants, add them to `server/src/config.ts` (server) or create `client/src/constants.ts` (client)
- Do NOT change function signatures that are part of the public API
- Do NOT rename files
- Do NOT add new npm dependencies without asking the user first
- Preserve all existing tests

**4b. Group related changes:**

Apply fixes in logical groups (e.g., all rate-limit changes together, all dialog changes together). Inform the user after each group.

**4c. Do NOT over-engineer:**

- Do NOT create abstract base classes or deep inheritance hierarchies
- Do NOT add generic type parameters unless they provide clear value
- Do NOT wrap simple one-liner API functions in additional abstraction layers
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
- Re-run `npm run verify`
- Maximum 3 retry cycles. If still failing, present remaining errors to the user.

**5c. If verification passes:**

> "All fixes applied and verified. `npm run verify` passed (typecheck, lint, audit, build)."

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

1. **Never break existing functionality** — every fix must be verified with `npm run verify`
2. **Never add dependencies** without explicit user approval
3. **Never rename files** unless the user specifically approves
4. **Never change public API contracts** (route paths, response shapes, exported function signatures)
5. **Respect CLAUDE.md conventions** — layered architecture, file naming, dialog patterns, UI preferences persistence
6. **Present findings before fixing** — never auto-fix without user approval
7. **Be precise** — include file paths and line numbers for every finding
8. **Be conservative** — when in doubt, flag as LOW severity rather than applying aggressive refactoring
9. **Clean working tree required** — refuse to start if there are uncommitted changes
10. **One branch per run** — each invocation creates its own isolated branch
