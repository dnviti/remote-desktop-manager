# Contributing to Remote Desktop Manager

Thank you for your interest in contributing! This guide covers everything you need to get started.

## Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [Docker](https://www.docker.com/) (required for PostgreSQL + guacd)
- npm 9+
- Git

## Development Setup

```bash
# 1. Fork and clone the repository
git clone https://github.com/dnviti/remote-desktop-manager.git
cd remote-desktop-manager

# 2. Install all dependencies (monorepo — root + server + client)
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env if needed (defaults work for local development)

# 4. Start the full dev stack
npm run predev && npm run dev
```

This starts:
- PostgreSQL 16 on port 5432 (Docker)
- guacd container on port 4822 (Docker)
- Express API server on `http://localhost:3001`
- Vite dev server on `http://localhost:3000`

## Code Conventions

### Architecture

The project follows a strict layered architecture on the server:

```
Routes → Controllers → Services → Prisma ORM
```

- **Routes** (`*.routes.ts`) — URL definitions and middleware chains only
- **Controllers** (`*.controller.ts`) — Request parsing, Zod validation, response shaping
- **Services** (`*.service.ts`) — Business logic and all database operations
- No direct Prisma calls in controllers or routes

### File Naming

| Layer | Pattern | Example |
|-------|---------|---------|
| Server routes | `*.routes.ts` | `auth.routes.ts` |
| Server controllers | `*.controller.ts` | `connection.controller.ts` |
| Server services | `*.service.ts` | `encryption.service.ts` |
| Server middleware | `*.middleware.ts` | `auth.middleware.ts` |
| Client stores | `*Store.ts` | `authStore.ts` |
| Client API | `*.api.ts` | `connections.api.ts` |
| Client hooks | `use*.ts` | `useAuth.ts` |

### UI State Persistence

All user-facing layout preferences **must** be persisted via `useUiPreferencesStore` — never use raw `localStorage` directly.

### TypeScript

Both workspaces use `strict: true`. All new code must be fully typed — avoid `any` unless unavoidable, and never use `as unknown as T` casts.

### Style

- 2-space indentation, LF line endings (enforced by `.editorconfig`)
- No trailing whitespace, files end with a newline
- Follow the existing patterns in the file you are editing

## Quality Gate

Before submitting a PR, the full quality gate must pass:

```bash
npm run verify
```

This runs, in order:
1. `npm run typecheck` — TypeScript type checking (both workspaces)
2. `npm run lint` — ESLint with security and strict TS rules
3. `npm run sast` — `npm audit` for dependency vulnerabilities
4. `npm run build` — Production build verification

Fix all errors before opening a PR. Warnings are tracked but do not block merging.

## Commit Message Guidelines

Use the imperative mood and keep the subject line under 72 characters:

```
Add SFTP file transfer for SSH sessions
Fix vault re-encryption on password change
Update README with production deployment steps
```

Prefix with a type when helpful:

| Prefix | When to use |
|--------|-------------|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `refactor:` | Code change with no behavior change |
| `docs:` | Documentation only |
| `chore:` | Build scripts, dependencies, config |
| `security:` | Security-related change |

## Opening Issues

Search [existing issues](https://github.com/dnviti/remote-desktop-manager/issues) before opening a new one.

Use the provided templates:
- **Bug report** — for unexpected behavior or errors
- **Feature request** — for new functionality proposals

## Opening Pull Requests

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. Make your changes and commit them
3. Run `npm run verify` and fix any issues
4. Push and open a PR against `main`
5. Fill in the PR template completely

PRs that fail the quality gate or lack a clear description will not be reviewed.

## Security Vulnerabilities

Please do **not** open public issues for security vulnerabilities. See [SECURITY.md](SECURITY.md) for the responsible disclosure process.

## License

By contributing, you agree that your contributions will be licensed under the [GNU GPL v3](LICENSE).
