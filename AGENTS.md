# Arsenale Agent Guide

## Core Rule

- Use `tools/arsenale-cli` as the default operator and smoke-test client for end-to-end verification. Prefer it over ad hoc `curl`.
- If a change affects API routes, response fields, auth flows, config defaults, server URLs, tenant selection, or deployment wiring, update `tools/arsenale-cli` in the same change set. Rebuild and retest it; CLI help output and smoke checks are acceptance criteria.

## CLI Build, Config, And Smoke

Build from the repo root before relying on the CLI:

```bash
go test ./tools/arsenale-cli/...
go build -o /tmp/arsenale-cli ./tools/arsenale-cli
```

Use the local dev stack at `https://localhost:3000`:

```bash
/tmp/arsenale-cli --server https://localhost:3000 health
/tmp/arsenale-cli --server https://localhost:3000 login
/tmp/arsenale-cli --server https://localhost:3000 whoami
```

The CLI stores config and auth in `~/.arsenale/config.yaml`:

```bash
/tmp/arsenale-cli config
/tmp/arsenale-cli config get server_url
/tmp/arsenale-cli config set server_url https://localhost:3000
```

Common entry points: `health`, `login`, `whoami`, `config`, `connection`, `gateway`, `session`, `rdgw`, `vault`, `connect`.

Use `arsenale [command] --help` before assuming flags or subcommands. Prefer `-o json` for assertions and `--quiet` when only IDs matter.

### Standard Verification Flow

1. `arsenale health`
2. `arsenale login --server https://localhost:3000`
3. `arsenale whoami`
4. `arsenale connection list` and `arsenale gateway list`
5. `arsenale session list` and `arsenale gateway instances <id>`
6. `arsenale gateway test <id>`
7. Only then try `arsenale connect ssh <name>` or `arsenale connect rdp <name>`

Useful debugging commands:

```bash
/tmp/arsenale-cli --server https://localhost:3000 gateway tunnel-overview
/tmp/arsenale-cli --server https://localhost:3000 gateway instances <gateway-id>
/tmp/arsenale-cli --server https://localhost:3000 session count
/tmp/arsenale-cli --server https://localhost:3000 rdgw status
```

### Red/Green On Real Infrastructure

For changes that need more than isolated unit coverage, run the loop against `https://localhost:3000` and treat the CLI as the default smoke client:

1. Write or narrow the regression test and make it fail locally.
2. Build the CLI, confirm the stack is up, and refresh auth if needed.
3. Reproduce the bug with `/tmp/arsenale-cli ... -o json` or a narrow API call.
4. If the change touches the frontend, reproduce it in a real browser with Selenium/WebDriver.
5. Implement the fix.
6. Rerun focused tests until green.
7. Rerun the same live-stack smoke path.
8. For frontend changes, rerun both the Selenium/WebDriver path and the matching CLI smoke.
9. Finish with `npm run verify`.

Baseline sequence:

```bash
go test ./tools/arsenale-cli/...
go build -o /tmp/arsenale-cli ./tools/arsenale-cli
/tmp/arsenale-cli --server https://localhost:3000 health
/tmp/arsenale-cli --server https://localhost:3000 login
/tmp/arsenale-cli --server https://localhost:3000 whoami
npm run verify
```

Notes:

- Local seeded credentials: `admin@example.com` / `ArsenaleTemp91Qx` for tenant `Development Environment`.
- If `~/.arsenale/config.yaml` is stale, refresh with `arsenale-cli login` instead of hand-editing tokens.
- For non-interactive CLI auth, use the existing device-flow endpoints, especially `POST /api/cli/auth/device/authorize`, from an already authenticated browser session.
- Frontend acceptance must use Selenium/WebDriver against the real local stack, not only component mocks.
- Frontend browser checks do not replace platform smoke; run the matching `arsenale-cli` assertion too.

Example end-to-end pattern:

```bash
# Red: focused tests fail first
npm run test -w client -- dbFirewallPattern.test.ts
go test ./backend/internal/dbauditapi -run TestValidateSafeRegex -count=1

# Real-stack reproduction and green verification
/tmp/arsenale-cli --server https://localhost:3000 health
/tmp/arsenale-cli --server https://localhost:3000 whoami
/tmp/arsenale-cli --server https://localhost:3000 db-audit firewall-rule list -o json
```

## Deployment Workflow

Use the Ansible installer and root `Makefile` targets as the default lifecycle interface. Do not substitute ad hoc `podman compose` commands for normal install, deploy, or teardown work.

Default rules:

- Docker is not a supported installer backend; use `podman` or `kubernetes`.
- Client installs must keep the installer standalone.
- Production and Kubernetes installs default to published images because `arsenale_build_images: false`.
- Development installs still build from the local source checkout.
- Ansible installation/output directories must never be the current `arsenale` repository checkout; keep installer state and generated folders outside the repo when choosing installation targets to avoid repository pollution.
- Do not reintroduce source-tree coupling into client install paths.

Primary repo-root targets:

```bash
make setup
make dev
make dev-down
make install
make deploy
make configure
make recover
make status
make backup
make rotate
make certs
make clean
```

Development flow:

```bash
make dev
```

- Runs `deployment/ansible/playbooks/install.yml` with `installer_mode=development`
- Always uses the Podman backend
- Builds images from the local checkout
- Keeps installer-managed state under `${XDG_STATE_HOME:-$HOME/.local/state}/arsenale-dev` by default; override with `ARSENALE_DEV_HOME=/absolute/path`
- Brings up the full stack, demo databases, bootstrap data, and acceptance checks

Stop development with:

```bash
make dev-down
```

Production and client install flow:

```bash
make install
make deploy
make configure
```

- Uses the installer profile plus inventory/group vars
- Pulls published images by default
- Does not require the application source tree when `arsenale_build_images: false`
- Renders installer-owned runtime assets under the target config directory

Only set `arsenale_build_images: true` when you intentionally want a source-based build workflow.

Direct playbook usage from `deployment/ansible/`:

```bash
ansible-playbook playbooks/install.yml \
  --vault-password-file .vault-pass \
  -e install_password_file=/absolute/path/to/install/password.txt \
  -e installer_mode=production

ansible-playbook playbooks/install.yml \
  --vault-password-file .vault-pass \
  -e install_password_file=/absolute/path/to/arsenale-dev/install/password.txt \
  -e arsenale_dev_home=/absolute/path/to/arsenale-dev \
  -e installer_mode=development

ansible-playbook playbooks/deploy.yml \
  --vault-password-file .vault-pass \
  -e arsenale_dev_home=/absolute/path/to/arsenale-dev \
  -e arsenale_env=development \
  -e arsenale_state=absent
```

Important deployment files:

- `deployment/ansible/README.md`
- `deployment/ansible/inventory/hosts.yml`
- `deployment/ansible/inventory/group_vars/all/vars.yml`
- `deployment/ansible/inventory/group_vars/all/vault.yml`
- `deployment/ansible/playbooks/install.yml`
- `deployment/ansible/playbooks/deploy.yml`
- `$ARSENALE_DEV_HOME/install/password.txt` for local development reruns

Installer-generated paths:

- Development defaults to `${XDG_STATE_HOME:-$HOME/.local/state}/arsenale-dev/`
- Development artifacts live under that directory: `install/`, `.installer-workspace/`, `.installer-tmp/`, `config/installer-assets/`, `dev-certs/`, `docker-compose.yml`, and `.env`
- Production still uses the installer target, typically `/opt/arsenale/`, including `certs/`

If you change image names, compose rendering, installer defaults, or deployment behavior, update the related Ansible docs and workflows in the same change set.

## Documentation Management

Project docs live in `docs/` and cover architecture, API reference, configuration, deployment, development workflow, security, database schema, frontend components, and guides.

Key docs:

- Top level: `index.md`, `getting-started.md`, `architecture.md`, `configuration.md`, `api-reference.md`, `deployment.md`, `development.md`, `environment.md`, `troubleshooting.md`, `installer.md`, `llm-context.md`, `rag-summary.md`
- Subdirectories: `api/`, `components/`, `database/`, `security/`, `guides/`

Update docs when these change:

- Services: `architecture.md`, `llm-context.md`
- API routes: `api-reference.md`, `api/*.md`
- Feature flags or capabilities: `configuration.md`, `environment.md`, `llm-context.md`
- Frontend stores, hooks, or API modules: `components/*.md`, `development.md`
- Database schema or migrations: `database/*.md`
- Security policy or encryption: `security/*.md`
- Installer or deployment behavior: `deployment.md`, `installer.md`
- Environment variables: `environment.md`, `configuration.md`

Doc update workflow:

1. Read the affected docs first.
2. Cross-check them against the source code; the codebase is the source of truth.
3. Edit the existing docs directly.
4. Update counts and inventories when adding stores, hooks, API modules, or components.
5. Update the `docs/.docs-manifest.json` timestamp.
6. Keep `llm-context.md` aligned.

Rules:

- If docs and code disagree, trust the code and fix the docs.
- Subdirectory docs use `<!-- manual-start -->` / `<!-- manual-end -->`; preserve content inside those markers.
- Do not create new doc files unless the change introduces a genuinely new major feature area.
- When counts change, update `components/overview.md` and `development.md`.
- If you add a doc file, update the table of contents in `docs/index.md`.
