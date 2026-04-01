---
title: Development
description: Contributing guide, local development setup, testing, code quality, and branch strategy
generated-by: claw-docs
generated-at: 2026-03-27T12:00:00Z
source-files:
  - package.json
  - client/package.json
  - gateways/tunnel-agent/package.json
  - extra-clients/browser-extensions/package.json
  - eslint.config.mjs
  - client/vitest.config.ts
  - client/vite.config.ts
  - client/tsconfig.json
  - Makefile
  - CLAUDE.md
---

## 🏗 Monorepo Structure

> Runtime note: `backend/` contains the active Go services used by the running application. The legacy Node `server/` implementation has been removed; runtime flows are now fully Go-first.

Arsenale uses npm workspaces for the active JavaScript packages and a separate Go module for the backend:

| Workspace | Path | Technology |
|-----------|------|-----------|
| Backend | `backend/` | Go 1.25 | Active control plane, brokers, orchestration, AI |
| Client | `client/` | React 19 + Vite + MUI v7 + Zustand |
| Tunnel Agent | `gateways/tunnel-agent/` | Node.js + TypeScript |
| Browser Extension | `extra-clients/browser-extensions/` | Chrome MV3 + React |

Install all dependencies with `npm install` at the root.

## 🔀 Branch Strategy

```mermaid
gitgraph
    commit id: "main (production)"
    branch staging
    commit id: "staging (pre-prod)"
    branch develop
    commit id: "develop (integration)"
    branch task/FEAT-0001
    commit id: "feature work"
    commit id: "more work"
    checkout develop
    merge task/FEAT-0001 id: "PR merge"
    checkout staging
    merge develop id: "staging deploy"
    checkout main
    merge staging id: "release"
```

**Protected branches:** `main`, `staging`, `develop` -- never commit directly.

| Branch Pattern | Purpose | PR Target |
|---------------|---------|-----------|
| `task/<CODE>` | Feature/task work | `develop` |
| `fix/<CODE>` | Bug fixes | `develop` |
| `chore/<CODE>` | Maintenance | `develop` |
| `feat/<CODE>` | Features | `develop` |

## 🧪 Testing

### Framework

- **Vitest** for the frontend and JS workspaces
- Go tests for the active backend services
- Client: jsdom environment for DOM simulation
- Globals enabled across all workspaces

### Commands

```bash
npm run test              # Run all tests
npm run backend:test      # Go backend tests
npm run test -w client    # Client tests only
npm run test:watch        # Watch mode (re-runs on change)
```

### Test File Naming

Test files follow the pattern `**/*.test.{ts,tsx}` and are colocated with source files or in `__tests__/` directories.

### Writing Tests

```typescript
import { describe, expect, it } from 'vitest';

describe('example', () => {
  it('keeps behavior explicit', () => {
    expect(true).toBe(true);
  });
});
```

## 🔍 Code Quality

### TypeScript

- **Strict mode** enabled in all active TypeScript workspaces
- Client: ES2022, ESNext modules (Vite handles bundling)

```bash
npm run typecheck         # Check all workspaces
```

### ESLint

Flat config format (`eslint.config.mjs`):
- TypeScript strict rules + security plugin
- Client: React hooks rules, refresh detection
- Tests: relaxed rules

```bash
npm run lint              # Check all
npm run lint:fix          # Auto-fix
```

### Security Scanning

```bash
npm run sast              # npm audit (critical severity)
npm run codeql            # CodeQL static analysis
```

### Full Quality Gate

```bash
npm run verify            # typecheck -> lint -> audit -> test -> build
```

This must pass before closing any task.

## 📐 File Naming Conventions

| Layer | Pattern | Example |
|-------|---------|---------|
| Go packages | directory by responsibility | `backend/internal/authservice` |
| Client stores | `*Store.ts` | `authStore.ts` |
| Client API | `*.api.ts` | `connections.api.ts` |
| Client hooks | `use*.ts` | `useAuth.ts` |
| Tests | `*.test.ts` / `*.test.tsx` | `ip.test.ts` |

## 🧱 Architecture Patterns

### Backend: Routes -> Services -> Stores / SQL

```
backend/cmd/control-plane-api/routes_*.go  # HTTP binding
backend/internal/*                          # Service logic by domain
backend/internal/*/store.go                 # SQL-backed persistence
```

### Client: Pages -> Components -> Stores -> API

```
pages/DashboardPage.tsx        # Page-level component
components/Sidebar/            # UI components
store/connectionsStore.ts      # Zustand state management
api/connections.api.ts          # Axios HTTP calls
```

### API Error Handling

Client-side: use `extractApiError(err, fallbackMessage)` from `client/src/utils/apiError.ts`.
For dialog forms: use `useAsyncAction` hook from `client/src/hooks/useAsyncAction.ts`.

### Full-Screen Dialogs

Features overlaying the workspace must use full-screen MUI `Dialog` from `MainLayout` (not page routes) to preserve active SSH/RDP sessions.

```typescript
import { SlideUp } from '../common/SlideUp';

<Dialog fullScreen TransitionComponent={SlideUp} open={open} onClose={onClose}>
  <AppBar position="static">
    <Toolbar variant="dense">...</Toolbar>
  </AppBar>
  {/* Content */}
</Dialog>
```

### UI Preferences

All UI layout state uses `uiPreferencesStore` (Zustand + `arsenale-ui-preferences` localStorage key). Never use raw `localStorage`. Namespace by userId.

### Configuration Pattern

```
Env var set    -> used as-is, UI field read-only
Env var unset  -> UI setting editable, persisted to DB
New features   -> define env var in the active Go config or settings registry first
```

## 🗄 Database

### Schema bootstrap

The active empty-database bootstrap snapshot lives at `backend/schema/bootstrap.sql`. Key commands:

```bash
npm run db:bootstrap      # Apply schema snapshot when DB is empty
npm run db:push           # Alias
npm run db:migrate        # Alias
```

## 🐳 Container Standards

All Dockerfiles must be:
- **Rootless**: Non-root user, no privileged operations
- **Podman-compatible**: Test with `podman build` / `podman run`
- **High ports only**: > 1024 (no binding to privileged ports)
- **Multi-stage**: Separate build and runtime stages

## 🔒 Security Standards

### Logging

Never log sensitive data in clear text.

```typescript
// Correct
logger.error(`Auth failed: ${err instanceof Error ? err.message : 'Unknown error'}`);

// Incorrect - never do this
logger.error('Login failed', { password, token });
```

### Vault and Encryption

- Credentials encrypted at rest with AES-256-GCM
- Per-user master key derived from password via Argon2
- Vault lock requires re-auth to decrypt

## 📦 Client Build

### Vite Configuration

- **PWA support**: Service worker with offline caching
- **Code splitting**: Vendor chunks for React, MUI, XTerm, Guacamole, network libraries
- **Chunk limit**: 700 KB warning threshold

### Dev Server Proxies

| Path | Target | Protocol |
|------|--------|----------|
| `/api` | `http://localhost:18080` | HTTP |
| `/ws/terminal` | `http://localhost:18090` | WSS |
| `/guacamole` | `http://localhost:18091` | WSS |

## 📱 Browser Extension

Located at `extra-clients/browser-extensions/`:

- **Chrome Manifest V3** with service worker
- **Multi-account support**: Connect to multiple Arsenale instances
- **Autofill**: Form detection + credential injection
- **Keychain integration**: Browse and copy secrets

```bash
cd extra-clients/browser-extensions
npm run dev           # Watch build
npm run build         # Production build
```

Load unpacked extension from the `dist/` directory in Chrome.

## 🔧 Gateway Development

### Tunnel Agent

```bash
cd gateways/tunnel-agent
npm run dev           # Watch mode (tsx)
npm run test          # Vitest
npm run build         # TypeScript compile
```

### Gateway Go Modules

```bash
cd gateways/guacenc && go test ./...
cd gateways/db-proxy && go test ./...
cd gateways/rdgw && go test ./...
```

## 📐 Version Bumping

When releasing, update version in all locations:

| File | Field |
|------|-------|
| `package.json` (root, client, tunnel-agent, browser-extension) | `"version"` |
| `extra-clients/browser-extensions/manifest.json` | `"version"` |
| `backend/cmd/control-plane-api/main.go` | `ARSENALE_VERSION` default / release wiring |
| `LICENSE` | `Licensed Work: Arsenale X.Y.Z` |
| `docs/index.md` | `Version:` line |

Then run `npm install --package-lock-only` to sync the lockfile.
