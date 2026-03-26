# CLAUDE.md

## Language

Always respond and work in English, even if the user's prompt is in another language.

## Workflow & Principles

- **Simplicity First:** Simplest change possible. Minimal code impact.
- **No Laziness:** Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact:** Only touch what's necessary. No side effects.
- **Always Ask Before Commit/Push:** Present staged files and proposed message, wait for approval.
- **Protected Branches:** Never commit/push directly to `main`, `staging`, or `develop`. Always use dedicated branches (`task/`, `fix/`, `chore/`, `feat/`) and PRs.
- **Plan Mode Default:** Enter plan mode for any non-trivial task (3+ steps or architectural decisions). STOP and re-plan if things go sideways.
- **Subagent Strategy:** Use subagents liberally for research, exploration, parallel analysis. One task per subagent.
- **Self-Improvement:** After any correction, update `tasks/lessons.md`. Review lessons at session start.
- **Verification:** Never mark a task complete without proving it works. `npm run verify` must pass before closing any task.
- **Database Migrations:** When a task modifies `schema.prisma`, ALWAYS generate and apply migrations (`npm run db:migrate`) before marking the task complete. Incomplete migrations will break the application. This is mandatory — no exceptions.
- **Demand Elegance:** For non-trivial changes, ask "is there a more elegant way?" Skip for simple fixes.
- **Autonomous Bug Fixing:** Given a bug report, just fix it. Zero context switching from the user.

### Task Execution Workflow

1. Write plan to `tasks/todo.md` → get user approval → track progress → explain changes → document results → capture lessons in `tasks/lessons.md`

## Development Commands

```bash
npm run predev && npm run dev   # Full dev setup (Docker + Prisma + server + client)
npm run dev                     # Server (:3001) + Client (:3000, proxies /api→:3001, /socket.io→:3002)
npm run dev:server              # Express on :3001 (tsx watch)
npm run dev:client              # Vite on :3000
npm run build                   # Both (tsc + vite build)
npm run verify                  # typecheck → lint → audit → build (MUST pass before closing tasks)
npm run typecheck               # TypeScript (both workspaces)
npm run lint / lint:fix         # ESLint (both workspaces)
npm run sast                    # npm audit
npm run codeql                  # CodeQL security-extended
npm run db:generate             # Prisma client types
npm run db:push                 # Sync schema (no migration, manual)
npm run db:migrate              # Run migrations (server auto-migrates on start)
npm run docker:dev / docker:dev:down  # Start/stop guacd + PostgreSQL
npm run docker:prod             # Full production stack

# CodeClaw Configuration
DEV_PORTS="3000 3001 3002"
START_COMMAND="npm run dev"
PREDEV_COMMAND="npm run predev"
VERIFY_COMMAND="npm run verify"
TEST_FRAMEWORK="vitest"
TEST_COMMAND="npm run test"
TEST_FILE_PATTERN="**/*.test.{ts,tsx}"
CI_RUNTIME_SETUP="uses: actions/setup-node@v6\nwith:\n  node-version: 22"
DEVELOPMENT_BRANCH="develop"
STAGING_BRANCH="staging"
PRODUCTION_BRANCH="main"
PACKAGE_JSON_PATHS="package.json client/package.json server/package.json gateways/tunnel-agent/package.json extra-clients/browser-extensions/package.json"
CHANGELOG_FILE="CHANGELOG.md"
TAG_PREFIX="v"
GITHUB_REPO_URL="https://github.com/dnviti/arsenale"
```

## Environment Setup

Copy `.env.example` to `.env` at **monorepo root** (not inside `server/`). `server/prisma.config.ts` resolves `.env` to `../.env`. Never add a separate `server/.env`. Docker required for PostgreSQL + `guacd`; `predev` starts both automatically.

## Version Bumping

Update all these locations, then run `npm install --package-lock-only`:

| File | Field |
|------|-------|
| `package.json` (root), `client/`, `server/`, `gateways/tunnel-agent/`, `extra-clients/browser-extensions/` | `"version"` |
| `extra-clients/browser-extensions/manifest.json` | `"version"` |
| `server/src/cli.ts` | `.version('X.Y.Z')` |
| `LICENSE` | `Licensed Work: Arsenale X.Y.Z` |
| `docs/index.md` | `Version:` line |

## Documentation

`docs/rag-summary.md` must be kept in sync whenever documentation or features change.

## Architecture

**Monorepo** (npm workspaces): `server/`, `client/`, `gateways/tunnel-agent/`, `extra-clients/browser-extensions/`.

### Server (Express + TypeScript)

Layered: **Routes → Controllers → Services → Prisma ORM**

- Entry: `server/src/index.ts` (auto-migrates, creates HTTP server, attaches Socket.IO + Guacamole WS)
- App: `server/src/app.ts` (Express setup, middleware, routes)
- Routes/Controllers/Services: `server/src/routes|controllers|services/*.{routes|controller|service}.ts`
- Socket: `server/src/socket/` (SSH terminal via Socket.IO)
- Middleware: `server/src/middleware/` (JWT auth, error handler)
- Types: `server/src/types/index.ts` (`AuthPayload`, `AuthRequest`, `EncryptedField`, `VaultSession`)
- Schema: `server/prisma/schema.prisma` (User, Connection, Folder, SharedConnection, RefreshToken)

### Client (React 19 + Vite + MUI v7)

- API: `client/src/api/` (Axios + auto JWT refresh on 401)
- Stores: `client/src/store/*Store.ts` (Zustand: auth, connections, tabs, vault)
- Pages: `client/src/pages/` (Login, Register, Dashboard)
- Components: `client/src/components/` (Layout, RDP, Terminal, Dialogs, Tabs)
- Hooks: `client/src/hooks/` (`useAuth`, `useSocket`)

### Browser Extension (Chrome Manifest V3)

Located at `extra-clients/browser-extensions/`:
- `src/background.ts` — Service worker (API calls, CORS bypass, token refresh via chrome.alarms)
- `src/popup/` — React popup (account switcher, keychain, connections)
- `src/options/` — React settings (multi-account, server URL config)
- `src/content/` — Credential autofill content scripts
- `src/lib/` — Shared utilities (account storage, API client, auth, vault/secrets/connections wrappers)

## Key Patterns

### Configuration Strategy

Env vars are the primary config source. UI Settings panel is secondary:
- **Env var set** → used as-is, UI field is read-only
- **Env var unset** → UI setting is editable, persisted to DB
- **New features** must define env vars in `server/src/config.ts` first with sensible defaults

### Real-Time Connections

- **SSH**: Tab → Socket.IO `/ssh` → SSH2 session → bidirectional WS. Rendered with XTerm.js.
- **RDP**: Token from `/sessions/rdp` → Guacamole WS on :3002 → `guacd`. Rendered with `guacamole-common-js`.

### Vault & Encryption

Credentials encrypted at rest (AES-256-GCM). Per-user master key from password via Argon2, held in-memory with configurable TTL. Vault lock requires re-auth to decrypt.

### Logging Security

**Never log sensitive data in clear text** (enforced by CodeQL `js/clear-text-logging`).

Forbidden in logs: passwords, tokens (JWT/access/refresh/API keys), OAuth secrets, private keys, OTPs, full ORM error objects.

Rules:
1. Never pass raw error objects to `logger.error()` — use `err instanceof Error ? err.message : 'Unknown error'`
2. Use `[REDACTED]` for sensitive variables in log templates
3. Never log properties from sensitive config objects (CodeQL taints entire tree)
4. Dev-mode fallback logs must redact all secrets
5. CLI credential display (recovery keys) uses `console.log` directly, never the logger

The logger (`server/src/utils/logger.ts`) provides defense-in-depth with `SENSITIVE_KEYS`, `SENSITIVE_VALUE_PATTERNS`, and `sanitize()` → `formatArgs()` pipeline.

### Authentication

JWT with short-lived access tokens + refresh tokens (stored in DB). Axios interceptor auto-refreshes. Socket.IO authenticates via JWT middleware.

### Full-Screen Dialogs Over Navigation

Features overlaying the workspace **must** use full-screen MUI `Dialog` from `MainLayout` (not page routes) to preserve active RDP/SSH sessions.

**Pattern:** Import `SlideUp` from `'../common/SlideUp'`. Props: `{ open, onClose }`. Use `<Dialog fullScreen TransitionComponent={SlideUp}>` with `<AppBar position="static">` + `<Toolbar variant="dense">`. State in `MainLayout`. Dialog rendered outside blur wrapper `Box`.

### API Error Handling

Use `extractApiError(err, fallbackMessage)` from `client/src/utils/apiError.ts`. For dialog forms with loading/error state, use `useAsyncAction` hook from `client/src/hooks/useAsyncAction.ts`.

### UI Preferences Persistence

All UI layout state must use `uiPreferencesStore` (`client/src/store/uiPreferencesStore.ts`, Zustand persist with `arsenale-ui-preferences` localStorage key). Never use raw `localStorage`. Namespace by userId. Key naming: `camelCase` with component area prefix. Exclude transient state (dialogs, menus, loading flags).

### File Naming Conventions

| Layer | Pattern | Example |
|-------|---------|---------|
| Server routes/controllers/services/middleware | `*.routes|controller|service|middleware.ts` | `auth.routes.ts` |
| Client stores | `*Store.ts` | `authStore.ts` |
| Client API | `*.api.ts` | `connections.api.ts` |
| Client hooks | `use*.ts` | `useAuth.ts` |

### Task & Idea Management

Controlled by `.claude/issues-tracker.json` (legacy: `.claude/github-issues.json`):

| `enabled` | `sync` | Mode | Data Source |
|-----------|--------|------|-------------|
| `true` | `false` | **Platform-only** (current) | GitHub/GitLab Issues only |
| `true` | `true` | **Dual sync** | Local files first, then platform |
| `false` | — | **Local only** | Local text files only |

**Platform-only mode:** Tasks are GitHub Issues with labels (`claude-code`, `task`, `priority:*`, `status:{todo,in-progress,to-test,done}`, `section:*`). Ideas use `idea` label. Priority order: high > medium > low. `/task-pick` creates branch `task/<code>` from `develop`, opens PR to `develop` on completion.

**Local/Dual mode:** Tasks in `to-do.txt` (`[ ]`), `progressing.txt` (`[~]`), `done.txt` (`[x]`). Ideas in `ideas.txt` / `idea-disapproved.txt`. Dual sync stores `GitHub: #NNN` in each block.

**Skills:** `/idea-create`, `/idea-approve` (→ task), `/idea-disapprove`, `/idea-refactor`. Ideas must never be picked up directly by `/task-pick`.

**Issue title format:** `[PREFIX-NNN] Title` — used for lookup via `gh issue list --search`.

**Scripts** (`.claude/scripts/`, Python stdlib only): `task_manager.py`, `app_manager.py`, `release_manager.py`, `setup_labels.py`.

### Release Planning

`releases.json` at project root is the single source of truth. Structure: `version`, `status` (planned|in-progress|released), `theme`, `target_date`, `tasks`, timestamps.

Skills: `/release-plan` (manage plans), `/release-plan suggest` (AI grouping). Integrated with `/task-create`, `/idea-approve`, `/task-pick`, `/task-continue`, `/task-status`, `/release`, `/git-publish`. All features optional — without `releases.json`, skills behave as before.

### Worktree-Based Task Isolation

Tasks use isolated git worktrees at `.worktrees/task/<code>/` (must be in `.gitignore`). `/task pick` creates worktree, auto-removed on close. `/task continue` creates fresh worktree from existing branch. `task_manager.py` reads/writes task files from main repo root. Run `/release` and `/setup env` from main repository.

## Agent Teams Mode

**Default execution mode.** Use Agent Teams for any task involving development (/claw:task skill), research (/claw:idea skill), or parallel work in general. No exceptions. This is the core of the CLAUDE workflow.

### Team Lifecycle

`TeamCreate` → `TaskCreate` per unit of work → `Agent` (spawn teammates) → teammates claim/complete via `TaskUpdate`, communicate via `SendMessage` → `SendMessage` shutdown → `TeamDelete`

### Implementation Roles

| Role | Purpose | Config |
|------|---------|--------|
| `backend-dev-{CODE}` | Server-side logic, API, data. Messages frontend-dev when done | `isolation: "worktree"`, `mode: "bypassPermissions"` |
| `frontend-dev-{CODE}` | UI, client-side. Waits for backend-dev | `isolation: "worktree"`, `mode: "bypassPermissions"` |
| `qa-agent` | Reviews, tests, sends bugs back to devs | `mode: "bypassPermissions"` |
| `documenter` | Updates docs in parallel | `mode: "bypassPermissions"` |
| `security-scanner` | Security testing, blocks on critical issues | `mode: "bypassPermissions"` |

### Other Flow Roles

| Role | Purpose | Config |
|------|---------|--------|
| `pr-analyst-{N}` | PR analysis in release pipeline | `isolation: "worktree"`, `mode: "bypassPermissions"` |
| `security-auditor` | Cross-PR security validation | `mode: "bypassPermissions"` |
| `ci-monitor-{N}` | CI workflow monitoring | `mode: "bypassPermissions"` |
| `task-creator-{N}` | Idea → task spec conversion | `isolation: "worktree"`, `mode: "bypassPermissions"` |
| `consistency-reviewer` | Task spec consistency review | `mode: "bypassPermissions"` |

### Coordination Flow

Backend dev → messages frontend dev with API contracts → frontend dev implements → documenter works in parallel → security scanner reviews (critical = blocks) → QA reviews (bugs → back to devs) → QA + security approve → done.

## Cross-Platform Notes

Supports Windows, macOS, Linux with auto OS detection.

**Python auto-detection:** `platform_utils.detect_python_cmd()` tries `python3` then `python`. Override via `python_command` in `config/project-config.json`.

**Utilities:** `platform_utils.py` (cmd detection, shell info, file copy), `app_manager.py` (port/process mgmt), `task_manager.py find-files` (cross-platform find).

**Windows:** Requires PowerShell Core (pwsh). Enable long paths, configure `core.autocrlf true`, enable symlinks via Developer Mode. See Windows troubleshooting in project docs if issues arise.
