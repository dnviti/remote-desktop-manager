# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language

Always respond and work in English, even if the user's prompt is written in another language.

## Workflow & Principles

### Core Principles

- **Simplicity First:** Make every change as simple as possible. Impact minimal code.
- **No Laziness:** Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact:** Only touch what's necessary. No side effects introducing new bugs.

### Plan Mode Default

Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions). If something goes sideways, STOP and re-plan immediately. Use plan mode for verification steps, not just building. Write detailed specs upfront to reduce ambiguity.

### Subagent Strategy

Use subagents liberally to keep the main context window clean. Offload research, exploration, and parallel analysis to subagents. For complex problems, throw more compute at it via subagents. One task per subagent for focused execution.

### Self-Improvement Loop

After ANY correction from the user: update `tasks/lessons.md` with the pattern. Write rules that prevent the same mistake. Ruthlessly iterate on these lessons until the mistake rate drops. Review lessons at session start for the relevant project.

### Verification Before Done

Never mark a task complete without proving it works. Diff behavior between `main` and your changes when relevant. Ask yourself: "Would a staff engineer approve this?" Run tests, check logs, demonstrate correctness. `npm run verify` must pass before closing any task.

### Demand Elegance (Balanced)

For non-trivial changes: pause and ask "is there a more elegant way?" If a fix feels hacky: "Knowing everything I know now, implement the elegant solution." Skip this for simple, obvious fixes — don't over-engineer. Challenge your own work before presenting it.

### Autonomous Bug Fixing

When given a bug report: just fix it. Don't ask for hand-holding. Point at logs, errors, failing tests — then resolve them. Zero context switching required from the user. Go fix failing CI tests without being told how.

### Task Execution Workflow

1. **Plan First:** Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan:** Check in with the user before starting implementation
3. **Track Progress:** Mark items complete as you go
4. **Explain Changes:** High-level summary at each step
5. **Document Results:** Add review section to `tasks/todo.md`
6. **Capture Lessons:** Update `tasks/lessons.md` after corrections

## Development Commands

```bash
# Full dev setup (starts Docker containers, generates Prisma client, runs server+client)
# Database migrations run automatically on server start — no manual migrate command needed
npm run predev && npm run dev

# Run server and client concurrently
npm run dev

# Run individually
npm run dev:server          # Express on :3001 (tsx watch, hot reload)
npm run dev:client          # Vite on :3000 (proxies /api→:3001, /socket.io→:3002)

# Build
npm run build               # Both server (tsc) and client (vite build)
npm run build -w server     # Server only
npm run build -w client     # Client only

# Database (Prisma)
npm run db:generate         # Generate Prisma client types
npm run db:push             # Sync schema to database (no migration, manual only)
npm run db:migrate          # Run migrations (manual only — server auto-migrates on start)

# Code quality & verification
npm run verify              # Full pipeline: typecheck → lint → audit → build
npm run typecheck           # TypeScript type-check (both workspaces, no emit)
npm run lint                # ESLint (both workspaces via root flat config)
npm run lint:fix            # ESLint with auto-fix
npm run sast                # npm audit (dependency vulnerability scan)
npm run codeql              # Local CodeQL security scan (security-extended)
npm run codeql:full         # Local CodeQL full scan (security-and-quality)

# Docker
npm run docker:dev          # Start guacd + PostgreSQL containers (required for dev)
npm run docker:dev:down     # Stop dev containers
npm run docker:prod         # Full production stack (requires .env.production)

# CodeClaw Configuration
DEV_PORTS="3000 3001 3002"               # Client, Server, Guacamole WebSocket
START_COMMAND="npm run dev"              # Command to start dev server
PREDEV_COMMAND="npm run predev"          # Pre-start setup (Docker + Prisma generate)
VERIFY_COMMAND="npm run verify"          # Quality gate (typecheck → lint → audit → test → build)

TEST_FRAMEWORK="vitest"                  # Test runner
TEST_COMMAND="npm run test"              # Run tests (all workspaces)
TEST_FILE_PATTERN="**/*.test.{ts,tsx}"   # Test file pattern

CI_RUNTIME_SETUP="uses: actions/setup-node@v4\nwith:\n  node-version: 22"

DEVELOPMENT_BRANCH="develop"
STAGING_BRANCH="staging"
PRODUCTION_BRANCH="main"

PACKAGE_JSON_PATHS="package.json client/package.json server/package.json gateways/tunnel-agent/package.json extra-clients/browser-extensions/package.json"
CHANGELOG_FILE="CHANGELOG.md"
TAG_PREFIX="v"
GITHUB_REPO_URL="https://github.com/dnviti/arsenale"
```

**Important:** `npm run verify` must pass before closing any task. It runs typecheck, lint, dependency audit, and build in sequence.

## Environment Setup

Copy `.env.example` to `.env`. PostgreSQL is used in both development and production. Docker is required for both PostgreSQL and `guacd` (Guacamole daemon). The `predev` script starts both containers automatically.

**Important:** The `.env` file lives at the **monorepo root**, not inside `server/`. Prisma CLI commands (`db:push`, `db:migrate`) run from the `server/` workspace directory, so `server/prisma.config.ts` explicitly resolves the `.env` path to `../.env`. Never add a separate `server/.env` — all env vars are loaded from the root `.env`.

## Version Bumping

When bumping the app version, update all four `package.json` files and regenerate `package-lock.json`:

| File | Field |
|------|-------|
| `package.json` (root) | `"version"` |
| `client/package.json` | `"version"` |
| `server/package.json` | `"version"` |
| `gateways/tunnel-agent/package.json` | `"version"` |
| `extra-clients/browser-extensions/package.json` | `"version"` |
| `extra-clients/browser-extensions/manifest.json` | `"version"` |
| `server/src/cli.ts` | `.version('X.Y.Z')` |
| `LICENSE` | `Licensed Work: Arsenale X.Y.Z` |
| `docs/index.md` | `Version:` line at bottom |

After editing the package.json files, run `npm install --package-lock-only` to update `package-lock.json`. All versions must always be kept in sync.

## Documentation Maintenance

`docs/rag-summary.md` must be kept in sync whenever documentation or features change. If any feature is added, modified, or removed, update this file to reflect the current state.

## Architecture

**Monorepo** with npm workspaces: `server/`, `client/`, `gateways/tunnel-agent/`, and `extra-clients/browser-extensions/`.

### Server (Express + TypeScript)

Layered architecture: **Routes → Controllers → Services → Prisma ORM**

- `server/src/index.ts` — Entry point: runs `prisma migrate deploy` automatically, creates HTTP server, attaches Socket.IO and Guacamole WebSocket server
- `server/src/app.ts` — Express app setup with middleware and route mounting
- `server/src/routes/*.routes.ts` — Route definitions (auth, connections, folders, sharing, vault)
- `server/src/controllers/*.controller.ts` — Request parsing and validation
- `server/src/services/*.service.ts` — Business logic and database operations
- `server/src/socket/` — Socket.IO handlers for SSH terminal sessions
- `server/src/middleware/` — JWT auth middleware, error handler
- `server/src/types/index.ts` — Shared types (`AuthPayload`, `AuthRequest`, `EncryptedField`, `VaultSession`)
- `server/prisma/schema.prisma` — Data models: User, Connection, Folder, SharedConnection, RefreshToken

### Client (React 19 + Vite)

- `client/src/api/` — Axios client with automatic JWT refresh on 401
- `client/src/store/*Store.ts` — Zustand stores: `authStore`, `connectionsStore`, `tabsStore`, `vaultStore`
- `client/src/pages/` — Page components (Login, Register, Dashboard)
- `client/src/components/` — UI components (Layout, RDP viewer, Terminal, Dialogs, Tabs)
- `client/src/hooks/` — Custom hooks (`useAuth`, `useSocket`)
- UI framework: Material-UI (MUI) v7

### Browser Extension (Chrome Manifest V3)

- `extra-clients/browser-extensions/` — Browser extension workspace (Chrome primary, Firefox secondary)
- `extra-clients/browser-extensions/src/background.ts` — Service worker: handles all API calls to Arsenale servers (bypasses CORS), token refresh via chrome.alarms
- `extra-clients/browser-extensions/src/popup/` — React popup app: account switcher, keychain browsing, connection listing
- `extra-clients/browser-extensions/src/options/` — React options/settings page: multi-account management, server URL configuration
- `extra-clients/browser-extensions/src/content/` — Content scripts for credential autofill on web pages
- `extra-clients/browser-extensions/src/lib/` — Shared utilities: account storage, API client, auth, vault/secrets/connections API wrappers

## Key Patterns

### Configuration Strategy

All application configuration **must** use environment variables as the primary source of truth. The UI Settings panel provides a user-friendly way to view and adjust settings, but environment variables always take precedence:

- **Env var set** → value is used as-is and the corresponding UI field shows it as a preset/override (read-only or visually distinguished).
- **Env var unset** → the UI setting is editable and its value is persisted to the database.
- **New features** must define their configuration as env vars in `server/src/config.ts` first, with sensible defaults. If the setting should also be adjustable at runtime via the UI, add a corresponding tenant/system setting that the env var overrides.

This ensures deployments can be fully configured via `.env` / Docker Compose / Kubernetes ConfigMaps without requiring UI interaction, while still allowing runtime tuning through the Settings panel.

### Real-Time Connections

- **SSH**: Client opens tab → Socket.IO connects to `/ssh` namespace → server creates SSH2 session → bidirectional terminal data via WebSocket. Terminal rendered with XTerm.js.
- **RDP**: Client requests token from `/sessions/rdp` → Guacamole WebSocket tunnel on port 3002 → `guacd` handles RDP protocol. Rendered with `guacamole-common-js`.

### Vault & Encryption

All connection credentials are encrypted at rest using AES-256-GCM. Each user has a master key derived from their password via Argon2. The master key is held in-memory server-side with a configurable TTL (vault sessions auto-expire). When the vault is locked, users must re-enter their password to decrypt credentials.

### Authentication

JWT-based with access tokens (short-lived) and refresh tokens (stored in DB). The Axios client interceptor automatically refreshes expired access tokens. Socket.IO connections authenticate via JWT middleware.

### Full-Screen Dialogs Over Navigation

Features that overlay the main workspace (settings, keychain, audit log, etc.) **must** be implemented as full-screen MUI `Dialog` components rendered from `MainLayout`, not as separate page routes. This preserves active RDP/SSH sessions. The only routed page is the main connections dashboard.

**Pattern (SettingsDialog / AuditLogDialog / KeychainDialog):**
- Import the shared `SlideUp` transition: `import { SlideUp } from '../common/SlideUp'`
- Props: `{ open: boolean; onClose: () => void }`
- Root element: `<Dialog fullScreen open={open} onClose={onClose} TransitionComponent={SlideUp}>`
- AppBar: `<AppBar position="static" sx={{ position: 'relative' }}>` + `<Toolbar variant="dense">` with `CloseIcon` button and title
- Content: `<Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', ... }}>`
- State managed in `MainLayout` as `const [xyzOpen, setXyzOpen] = useState(false)`
- Dialog rendered at the fragment root level in `MainLayout`, outside the blur wrapper `Box`

**Rule:** Never create a new page route for UI that opens over the dashboard. Use this dialog pattern instead.

### API Error Handling

Use `extractApiError(err, fallbackMessage)` from `client/src/utils/apiError.ts` for API error extraction in catch blocks. Never use inline type casts for Axios error responses. For dialog form submissions with loading/error state, prefer the `useAsyncAction` hook from `client/src/hooks/useAsyncAction.ts`.

### UI Preferences Persistence

All user-facing UI layout state **must** be persisted via the centralized `uiPreferencesStore` (`client/src/store/uiPreferencesStore.ts`), which uses Zustand's `persist` middleware with localStorage key `arsenale-ui-preferences`.

**What must be persisted:** panel open/closed states, sidebar section collapse/expand, drawer states, view mode toggles (compact, list/grid), positions and sizes of movable/resizable elements, folder expand/collapse states, and any user-configurable layout preference.

**Rules for any new feature:**
- Import from `useUiPreferencesStore` — never use raw `localStorage.getItem/setItem` for UI preferences
- Provide sensible defaults so the app works without any stored preferences
- Namespace by userId (the store handles this internally)
- Key naming: `camelCase` with component area prefix (e.g., `sidebarCompact`, `sidebarFavoritesOpen`, `rdpFileBrowserOpen`)
- Add new preference keys and their defaults to the store's type and initial state
- Exclude transient state (dialogs, menus, loading flags) — only persist what the user would expect to survive a page reload

### Task & Idea Management

Tasks and ideas are managed through one of three modes, controlled by `.claude/issues-tracker.json` (preferred) or `.claude/github-issues.json` (legacy fallback):

| `enabled` | `sync` | Mode | Data Source |
|-----------|--------|------|-------------|
| `true` | `false` (or absent) | **Platform-only** | GitHub/GitLab Issues only. No local files. |
| `true` | `true` | **Dual sync** | Local files first, then platform issues. |
| `false` | — | **Local only** | Local text files only. |

**Platform-only mode (current):** Tasks are GitHub Issues with status labels (`status:todo`, `status:in-progress`, `status:to-test`, `status:done`). Ideas are GitHub Issues with the `idea` label. No local task/idea text files exist. Tasks in `status:in-progress` may also carry `status:to-test`, indicating they are awaiting test verification before release.

**Local/Dual mode (when enabled):** Tasks are split across three files by status:

| File | Status | Symbol |
|------|--------|--------|
| `to-do.txt` | Pending tasks | `[ ]` |
| `progressing.txt` | In-progress tasks | `[~]` |
| `done.txt` | Completed tasks | `[x]` |

Ideas are stored separately:

| File | Purpose |
|------|---------|
| `ideas.txt` | Ideas awaiting evaluation |
| `idea-disapproved.txt` | Rejected ideas archive |

Use `/idea-create` to add ideas, `/idea-approve` to promote an idea to a task, `/idea-refactor` to update ideas based on codebase changes, and `/idea-disapprove` to reject an idea. Ideas must never be picked up directly by `/task-pick`.

### Release Planning

Tasks can be grouped into planned releases via `releases.json` at the project root. This is the single source of truth for release plans — platform labels (`release:vX.Y.Z`) and milestones are kept in sync as secondary artifacts.

**`releases.json` structure:** An array of release entries, each with `version` (semver, no `v` prefix), `status` (`planned`|`in-progress`|`released`), `theme` (grouping description), `target_date` (optional), `tasks` (array of task codes), and `created_at`/`released_at` timestamps.

**Key skills:**
- `/release-plan` — Manage release plans: list, create, assign/unassign tasks, suggest groupings, view timeline
- `/release-plan suggest` — AI-driven grouping of unassigned tasks by prefix affinity, dependency chains, section cohesion, and description similarity

**Integration with existing skills:**
- `/task-create` and `/idea-approve` — Offer to assign newly created tasks to a planned release
- `/task-pick` and `/task-continue` — Show release assignment in briefing
- `/task-status` — Includes release plan overview section
- `/release` — Uses planned version from `releases.json` instead of auto-detecting from commits; marks release as released after publishing
- `/git-publish` — Advisory warning if next planned release has incomplete tasks

**Task block `Release:` field:** In local/dual mode, tasks have a `Release:` field after `Dependencies:`. In platform-only mode, the `release:vX.Y.Z` label on the issue serves the same purpose.

**Backward compatibility:** All release planning features are optional. If `releases.json` does not exist, all skills behave identically to their pre-release-planning behavior.

### File Naming Conventions

| Layer | Pattern | Example |
|-------|---------|---------|
| Server routes | `*.routes.ts` | `auth.routes.ts` |
| Server controllers | `*.controller.ts` | `connection.controller.ts` |
| Server services | `*.service.ts` | `encryption.service.ts` |
| Server middleware | `*.middleware.ts` | `auth.middleware.ts` |
| Client stores | `*Store.ts` | `authStore.ts` |
| Client API | `*.api.ts` | `connections.api.ts` |
| Client hooks | `use*.ts` | `useAuth.ts` |

### Issues Tracker Integration

**Config file:** `.claude/issues-tracker.json` — controls the operating mode, target platform/repo, and label mappings. Copy `.claude/issues-tracker.example.json` to get started. Legacy fallback: `.claude/github-issues.json`.

**Skill scripts:** Python utilities in `.claude/scripts/` (zero external dependencies, stdlib only):
- `task_manager.py` — Task/idea parsing, ID generation, platform detection, PostToolUse hook
- `app_manager.py` — Cross-platform port checking, process management
- `release_manager.py` — Version detection, commit parsing, changelog generation, release plan management
- `setup_labels.py` — Cross-platform label creation (GitHub/GitLab)

**Config parameters:**
- `platform` (string): `"github"` or `"gitlab"` — determines which CLI tool (`gh` or `glab`) is used
- `enabled` (boolean): Whether platform issues integration is active
- `sync` (boolean): Whether to maintain dual sync with local text files. When `false` (or absent), the platform is the sole data source.
- `repo` (string): Target repository (e.g., `dnviti/arsenale`)
- `labels` (object): Label mappings for source, type, priority, status (including `to-test`), and sections

**Setup:**
1. Copy `.claude/issues-tracker.example.json` to `.claude/issues-tracker.json` (or use legacy `.claude/github-issues.json`)
2. Set `"platform"`, `"enabled": true`, and configure `"sync"` (`false` for platform-only, `true` for dual sync)
3. Run `python3 .claude/scripts/setup_labels.py` to create all required labels (cross-platform; legacy: `bash scripts/setup-labels.sh`)
4. Ensure `gh` CLI (GitHub) or `glab` CLI (GitLab) is authenticated

**Behavior in platform-only mode** (`enabled: true`, `sync: false`):
- All task/idea data lives exclusively in platform issues — no local text files
- `/task-create` creates an issue with labels (`claude-code`, `task`, `priority:*`, `status:todo`, `section:*`)
- `/task-pick` picks `status:todo` tasks, updates labels (todo → in-progress → to-test → done) and closes on completion
- `/task-pick` selects next task by priority label: `priority:high` > `priority:medium` > `priority:low`
- `/test-engineer TASK-CODE` runs the testing workflow for `status:to-test` tasks (automated + manual)
- `/idea-create` creates an issue with `idea` label
- `/idea-approve` closes idea issue, creates task issue with cross-reference
- `/idea-disapprove` closes idea issue with reason
- `/idea-refactor` updates issue body when ideas are revised
- `/git-publish` checks for untested tasks (`status:to-test`) before publishing, links PRs to issues via `Refs #N`
- `/release` checks for untested tasks before releasing, enriches GitHub Releases with issue cross-references
- All new content is written in English

**Behavior in dual sync mode** (`enabled: true`, `sync: true`):
- Skills write to local text files first, then sync to GitHub
- If GitHub sync fails, warn but don't fail the operation
- Text files win in case of discrepancy
- `GitHub: #NNN` is stored in each task/idea block for fast lookup
- Task/idea content is written in Italian (local files) with English communication

**Issue title format:** `[PREFIX-NNN] Task Title` or `[IDEA-NNN] Idea Title` — the bracketed code is used to look up issues via `gh issue list --search`.

**Task branch workflow:** `/task-pick` must always create a dedicated branch (`task/<code>`) from `develop` and, upon completion, open a pull request targeting `develop` via `gh pr create --base develop`. Never merge directly into `develop` without a PR.

<!-- CodeClaw:START -->
## Key Patterns

### Task Files

Tasks are split across three files by status:

| File | Status | Symbol |
|------|--------|--------|
| `to-do.txt` | Pending tasks | `[ ]` |
| `progressing.txt` | In-progress tasks | `[~]` |
| `done.txt` | Completed tasks | `[x]` |

When a task changes status, move it to the corresponding file.

**Additional platform label:** Tasks in `progressing.txt` may also carry `status:to-test` on the platform, indicating they are awaiting test verification. Task branches must not be merged into the release branch until testing is confirmed.

### Idea Files

Ideas are stored separately from tasks and must be explicitly approved before entering the task pipeline:

| File | Purpose |
|------|---------|
| `ideas.txt` | Ideas awaiting evaluation |
| `idea-disapproved.txt` | Rejected ideas archive |

Use `/idea create` to add ideas, `/idea approve` to promote an idea to a task, `/idea refactor` to update ideas based on codebase changes, and `/idea disapprove` to reject an idea. Ideas must never be picked up directly by `/task pick`.

### Task & Idea Management Modes

Tasks and ideas support three operating modes, controlled by `.claude/issues-tracker.json` (or legacy `.claude/github-issues.json`):

| `enabled` | `sync` | Mode | Data Source |
|-----------|--------|------|-------------|
| `true` | `false` (or absent) | **Platform-only** | GitHub Issues or GitLab Issues only. No local files. |
| `true` | `true` | **Dual sync** | Local files first, then platform issues. |
| `false` | — | **Local only** | Local text files only (default). |

The `platform` field (`"github"` or `"gitlab"`) determines which CLI tool (`gh` or `glab`) is used. If omitted, defaults to `"github"`.

### Worktree-Based Task Isolation

Tasks are developed in isolated git worktrees instead of branch switching, enabling parallel task work:

| Concept | Location |
|---------|----------|
| Worktree directory | `.worktrees/task/<code-lowercase>/` (mirrors branch name) |
| Branch naming | `task/<code-lowercase>` |
| Task files | Always in main repository root |
| Source code | In the worktree directory |

**Lifecycle:**
- `/task pick` creates a worktree when a task is picked up
- When a task is closed (marked done), the worktree is **automatically removed**
- `/task continue` creates a **fresh worktree** from the existing branch (since the old one was dismissed at close)
- `task_manager.py` always reads/writes task files from the main repo root via `get_main_repo_root()`
- `/release` and `/setup env` should be run from the main repository
- `.worktrees/` must be in `.gitignore`

## Cross-Platform Notes

This framework supports **Windows, macOS, and Linux** with automatic OS detection.

### Python Command Auto-Detection

All scripts and skills reference `python3`. On Windows where only `python` is available, CodeClaw auto-detects the correct command:

- **Auto-detection:** `platform_utils.detect_python_cmd()` tries `python3` first, then `python`, verifying each is Python 3.x via `shutil.which()`.
- **Manual override:** Set `python_command` in `config/project-config.json` to skip auto-detection (e.g., `"python_command": "python"`).
- **CI/CD:** The CI workflow includes a `Detect Python command` step that sets the correct command per OS.

### Cross-Platform Utilities

| Utility | File | Purpose |
|---------|------|---------|
| `platform_utils.py` | `scripts/` | Python cmd detection, shell info, safe file copy, command runner |
| `app_manager.py` | `scripts/` | Port/process management — `lsof`/`ss` on Unix, `netstat`/`taskkill` on Windows |
| `task_manager.py find-files` | `scripts/` | Cross-platform file discovery (replaces Unix `find`) |

### Windows Requirements

- **PowerShell Core (pwsh):** Required for shell-expansion features (e.g., inline file reading in agent invocations). Install from https://github.com/PowerShell/PowerShell. The legacy `cmd.exe` has limited support — commands that rely on inline expansion will fall back to direct Python file reading.
- **Long path support:** Enable long paths in the Windows registry or via Group Policy if your project has deeply nested directories. Run: `New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force`
- **Line endings:** Configure Git to handle line endings automatically: `git config --global core.autocrlf true`. CodeClaw text files use LF; Git will convert on checkout/commit.
- **Symlink permissions:** If your project uses symlinks, enable Developer Mode in Windows Settings or grant `SeCreateSymbolicLinkPrivilege` to your user account.

### Troubleshooting (Windows)

| Issue | Solution |
|-------|----------|
| `python3` not found | Install Python 3 from python.org and ensure "Add to PATH" is checked. Or set `python_command` in project config. |
| `cp -r` fails | All CodeClaw scripts use `shutil.copytree()` instead. If you see this error, update to the latest CodeClaw version. |
| `$(cat file)` fails in cmd.exe | CodeClaw uses direct file reading in Python. For manual commands, use PowerShell: `$(Get-Content -Raw file)` |
| Port check fails | Ensure `netstat` is available (built into Windows). Run as Administrator if needed. |
| Permission denied on kill | Run the terminal as Administrator for `taskkill` operations. |

### Vector Memory (opt-in)

CodeClaw includes an optional vector memory layer that indexes source code, tasks, and generated documents for semantic search. It is **disabled by default** and requires optional dependencies.

| Component | Purpose |
|-----------|---------|
| `vector_memory.py index` | Build/update the semantic index |
| `vector_memory.py search "query"` | Search indexed content semantically |
| `vector_memory.py status` | Check index health and staleness |
| `vector_memory.py clear --force` | Reset the vector index |

**Setup:**
1. Install dependencies: `pip install lancedb onnxruntime tokenizers numpy pyarrow`
2. Enable in `project-config.json`: set `vector_memory.enabled` to `true`
3. Run initial index: `python3 scripts/vector_memory.py index --full`

**Configuration** (`project-config.json` > `vector_memory`):
- `enabled`: Enable/disable vector memory (default: `false`)
- `auto_index`: Auto-reindex on file Edit/Write hooks (default: `false`)
- `embedding_provider`: `"local"` (default), `"openai"`, or `"voyage"`
- `embedding_model`: Model name (default: `"all-MiniLM-L6-v2"`)
- `chunk_size`: Max characters per chunk (default: `2000`)
- `index_path`: Index storage path (default: `".claude/memory/vectors"`)

Vectors are stored in `.claude/memory/vectors/` (auto-added to `.gitignore`).
<!-- CodeClaw:END -->
