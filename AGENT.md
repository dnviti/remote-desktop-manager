# Arsenale Agent Guide

## Purpose
Use `tools/arsenale-cli` as the primary operator and smoke-test client for this platform. Prefer it over ad hoc `curl` when you want to verify behavior end-to-end.

## Build And Verify
Before relying on the CLI, build it from the repo root:

```bash
go test ./tools/arsenale-cli/...
go build -o /tmp/arsenale-cli ./tools/arsenale-cli
```

For the local dev stack, point the CLI at `https://localhost:3000`:

```bash
/tmp/arsenale-cli --server https://localhost:3000 health
/tmp/arsenale-cli --server https://localhost:3000 login
```

The CLI stores credentials in `~/.arsenale/config.yaml`. The config defaults are:

```bash
/tmp/arsenale-cli config
/tmp/arsenale-cli config get server_url
/tmp/arsenale-cli config set server_url https://localhost:3000
```

## Test Flow
Use this sequence when checking the platform after a change:

1. `arsenale health` to confirm the API is reachable.
2. `arsenale login --server https://localhost:3000` to refresh local credentials.
3. `arsenale whoami` to confirm the authenticated tenant/user context.
4. `arsenale connection list` and `arsenale gateway list` to verify the resource layer.
5. `arsenale session list` and `arsenale gateway instances <id>` to verify runtime state.
6. `arsenale gateway test <id>` before trying a manual `arsenale connect ssh <name>` or `arsenale connect rdp <name>`.
7. Use `-o json` for machine checks and `--quiet` when only IDs matter.

For gateway and session debugging, these commands are especially useful:

```bash
/tmp/arsenale-cli --server https://localhost:3000 gateway tunnel-overview
/tmp/arsenale-cli --server https://localhost:3000 gateway instances <gateway-id>
/tmp/arsenale-cli --server https://localhost:3000 session count
/tmp/arsenale-cli --server https://localhost:3000 rdgw status
```

## Red/Green On Real Infrastructure
When the change needs more than isolated unit coverage, run the Red/Green loop against the local stack at `https://localhost:3000` and treat the CLI as the default smoke client:

1. Write or update the narrow regression test first and make it fail locally.
2. Build the CLI, confirm the stack is up, and refresh auth if needed.
3. Reproduce the bug against the live stack with `/tmp/arsenale-cli ... -o json` or a narrow API call.
4. If the change touches frontend behavior, reproduce it in a real browser with Selenium/WebDriver against `https://localhost:3000`.
5. Implement the fix.
6. Rerun the focused test until it is green.
7. Rerun the same live-stack smoke path to confirm the behavior end-to-end.
8. For frontend changes, rerun the Selenium/WebDriver browser path and the matching `arsenale-cli` smoke.
9. Finish with `npm run verify`.

Use this baseline sequence:

```bash
go test ./tools/arsenale-cli/...
go build -o /tmp/arsenale-cli ./tools/arsenale-cli
/tmp/arsenale-cli --server https://localhost:3000 health
/tmp/arsenale-cli --server https://localhost:3000 login
/tmp/arsenale-cli --server https://localhost:3000 whoami
npm run verify
```

Notes:

- The local seeded credentials are `admin@example.com` / `DevAdmin123!` for tenant `Development Environment`.
- The CLI stores auth in `~/.arsenale/config.yaml`. If that file is stale, refresh it with `arsenale-cli login` instead of hand-editing tokens.
- If you need non-interactive CLI auth for automation, use the device flow endpoints already exposed by the platform, especially `POST /api/cli/auth/device/authorize`, from an already authenticated browser session.
- Prefer `-o json` for assertions and keep the live-stack check narrowly scoped to the behavior you changed.
- Frontend acceptance should use Selenium/WebDriver against the real local stack, not only component-level mocks.
- Frontend browser checks do not replace platform smoke. Run the matching `arsenale-cli` assertion as well so the UI path and backend contract are both covered.

Example live-stack pattern for an end-to-end change:

```bash
# Red: focused tests fail first
npm run test -w client -- dbFirewallPattern.test.ts
go test ./backend/internal/dbauditapi -run TestValidateSafeRegex -count=1

# Real-stack reproduction and green verification
/tmp/arsenale-cli --server https://localhost:3000 health
/tmp/arsenale-cli --server https://localhost:3000 whoami
/tmp/arsenale-cli --server https://localhost:3000 db-audit firewall-rule list -o json
```

## Alignment Rule
Any change that affects API routes, response fields, auth flows, config defaults, server URLs, tenant selection, or deployment wiring must be reflected in `tools/arsenale-cli` in the same change set.

That means:

1. Update the CLI command or output handling when backend contracts change.
2. Rebuild and retest the CLI against the current stack.
3. Treat CLI help output and smoke tests as acceptance criteria, not an afterthought.

If the platform changes and the CLI is not updated to match, the change is incomplete.

## Practical Scope
The most commonly used CLI entry points are:

- `health`
- `login`
- `whoami`
- `config`
- `connection`
- `gateway`
- `session`
- `rdgw`
- `vault`
- `connect`

Use `arsenale [command] --help` before assuming flag names or subcommand availability.

## Documentation Management

The project documentation lives in `docs/` and covers the full platform: architecture, API reference, configuration, deployment, development workflow, security, database schema, frontend components, and guides.

### Structure

```
docs/
├── index.md                     # Landing page and table of contents
├── getting-started.md           # Prerequisites and first-run setup
├── architecture.md              # Service planes, capability gating, data flow
├── configuration.md             # Env vars, installer inputs, precedence
├── api-reference.md             # Public API routes and internal contracts
├── deployment.md                # Installer flow, Podman/K8s backends, CI/CD
├── development.md               # Local workflow, quality gates, conventions
├── environment.md               # Complete 121+ env var catalog
├── troubleshooting.md           # Health checks, debugging, reset options
├── installer.md                 # Installer artifacts and recovery
├── llm-context.md               # Condensed single-file context for AI/bots
├── rag-summary.md               # High-level RAG summary
├── api/                         # Detailed API endpoint specs (9 files)
├── components/                  # Frontend architecture (5 files)
├── database/                    # Schema models and enums (7 files)
├── security/                    # Auth, encryption, policies, production (4 files)
└── guides/                      # Zero-trust tunnel guides (2 files)
```

### When To Update Docs

Update documentation when any of the following change:

- **New or removed services** → `architecture.md`, `llm-context.md`
- **API routes added or changed** → `api-reference.md`, `api/*.md`
- **Feature flags or capabilities** → `configuration.md`, `environment.md`, `llm-context.md`
- **Frontend stores, hooks, or API modules** → `components/*.md`, `development.md`
- **Database schema or migrations** → `database/*.md`
- **Security policies or encryption** → `security/*.md`
- **Installer or deployment changes** → `deployment.md`, `installer.md`
- **New env variables** → `environment.md`, `configuration.md`

### How To Update

1. Read the affected doc files to understand current state.
2. Cross-reference with the actual source code (the codebase is always the source of truth).
3. Edit the doc files directly — they are a mix of auto-generated and hand-authored content.
4. Update counts and inventories (stores, hooks, API modules, components) when adding new ones.
5. Update `docs/.docs-manifest.json` timestamp after edits.
6. Keep `llm-context.md` aligned — it is a condensed single-file reference consumed by AI tools.

### Key Rules

- **Codebase is truth.** If docs and code disagree, trust the code and fix the docs.
- **Subdirectory docs have `<!-- manual-start -->` / `<!-- manual-end -->` markers.** Content inside those markers is preserved across regeneration. Content outside is auto-generated.
- **Do not create new doc files** unless covering a genuinely new major feature area. Prefer extending existing files.
- **Counts matter.** When adding a new store, hook, API module, or component, update the counts in `components/overview.md` and `development.md`.
- **Keep index.md in sync.** If you add a new doc file, add a row to the table of contents in `index.md`.
