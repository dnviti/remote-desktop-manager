---
title: Development
description: Contributing guide, local development setup, testing, code quality, and branch strategy
generated-by: ctdf-docs
generated-at: 2026-03-21T17:00:00Z
source-files:
  - package.json
  - server/package.json
  - client/package.json
  - gateways/tunnel-agent/package.json
  - extra-clients/browser-extensions/package.json
  - eslint.config.mjs
  - server/vitest.config.ts
  - client/vitest.config.ts
  - CLAUDE.md
  - Makefile
---

# Development

## Local Development Setup

### Prerequisites

- Node.js 22+, npm 10+
- Docker or Podman (for PostgreSQL and guacd)
- Git

### First Run

```bash
npm install                    # Install all workspace dependencies
cp .env.example .env           # Configure environment
npm run predev && npm run dev  # Start containers + server + client
```

### Running Services

| Command | What It Does |
|---------|-------------|
| `npm run dev` | Runs server (3001) + client (3000) concurrently |
| `npm run dev:server` | Express with tsx watch, hot reload |
| `npm run dev:client` | Vite dev server, proxies to server |
| `npm run docker:dev` | Start PostgreSQL + guacenc containers |
| `npm run docker:dev:down` | Stop dev containers |

### Database Operations

| Command | Purpose |
|---------|---------|
| `npm run db:generate` | Generate Prisma client types after schema changes |
| `npm run db:push` | Sync schema to database (no migration file) |
| `npm run db:migrate` | Create new migration interactively |

Migrations run automatically on server start via `prisma migrate deploy` — no manual migration step needed for development.

### Makefile Shortcuts

```bash
make full-stack     # Install + run everything
make server-dev     # Server with Prisma generate + watch
make client-dev     # Client dev server
make prisma-studio  # Open Prisma Studio GUI
make migrate-dev    # Interactive migration creation
```

## Code Quality

### Verification Pipeline

```bash
npm run verify   # Must pass before closing any task
```

Runs in sequence: **typecheck → lint → audit → test → build**

### Individual Checks

| Command | Scope |
|---------|-------|
| `npm run typecheck` | TypeScript type-check (all workspaces, no emit) |
| `npm run lint` | ESLint across all workspaces (flat config) |
| `npm run lint:fix` | ESLint with auto-fix |
| `npm run sast` | npm audit (critical severity) |
| `npm run build` | Build all workspaces |

### ESLint Configuration

The flat ESLint config (`eslint.config.mjs`) applies:

- **TypeScript strict rules** across all workspaces
- **Security plugin** (eslint-plugin-security)
- **Server-specific:** Discourages `console` usage (use logger utility instead)
- **Client/Extensions:** React Hooks + React Refresh rules
- **Test files:** Relaxed rules (no-explicit-any and non-null-assertion allowed)
- **Ignored:** `dist/`, `node_modules/`, `generated/`

### TypeScript Configuration

| Workspace | Target | Module | JSX | Strict |
|-----------|--------|--------|-----|--------|
| Server | ES2022 | CommonJS | — | Yes |
| Client | ES2022 | ESNext | react-jsx | Yes |
| Tunnel Agent | ES2022 | CommonJS | — | Yes |
| Browser Extensions | ES2022 | ESNext | react-jsx | Yes |

## Testing

### Running Tests

```bash
npm run test:watch           # Watch mode (server + client)
npm run test -w server       # Server tests only
npm run test -w client       # Client tests only
```

Test framework: **Vitest** across all workspaces.

### Test File Locations

Tests follow the convention of placing test files alongside source files or in `__tests__/` directories.

## Branch Strategy

```mermaid
gitgraph
    commit id: "main"
    branch develop
    commit id: "feature work"
    branch task/TASK-001
    commit id: "implement feature"
    checkout develop
    merge task/TASK-001 id: "PR merge"
    branch task/TASK-002
    commit id: "fix bug"
    checkout develop
    merge task/TASK-002 id: "PR merge 2"
    checkout main
    merge develop id: "release v1.3.3"
```

| Branch | Purpose | Merges Into |
|--------|---------|-------------|
| `main` | Production releases | — |
| `develop` | Integration branch | `main` (via release) |
| `staging` | Pre-release testing | `main` |
| `task/<code>` | Feature/fix branches | `develop` (via PR) |

**Rules:**
- All work happens on `task/<code>` branches created from `develop`
- Every task branch requires a pull request targeting `develop`
- Never merge directly into `develop` or `main`
- Never delete the `develop` branch

## File Naming Conventions

| Layer | Pattern | Example |
|-------|---------|---------|
| Server routes | `*.routes.ts` | `auth.routes.ts` |
| Server controllers | `*.controller.ts` | `connection.controller.ts` |
| Server services | `*.service.ts` | `encryption.service.ts` |
| Server middleware | `*.middleware.ts` | `auth.middleware.ts` |
| Client stores | `*Store.ts` | `authStore.ts` |
| Client API | `*.api.ts` | `connections.api.ts` |
| Client hooks | `use*.ts` | `useAuth.ts` |

## Key Development Patterns

### Layered Architecture (Server)

```
Routes → Controllers → Services → Prisma ORM
```

- **Routes:** Define endpoints, apply middleware (auth, validation, rate limiting)
- **Controllers:** Parse requests, extract params, delegate to services
- **Services:** Business logic, database operations, encryption
- **Prisma ORM:** Type-safe database queries

### Full-Screen Dialog Pattern (Client)

Features that overlay the workspace use full-screen MUI `Dialog` components, not routes:

```tsx
<Dialog fullScreen open={open} onClose={onClose} TransitionComponent={SlideUp}>
  <AppBar position="static" sx={{ position: 'relative' }}>
    <Toolbar variant="dense">
      <IconButton onClick={onClose}><CloseIcon /></IconButton>
      <Typography>Title</Typography>
    </Toolbar>
  </AppBar>
  <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
    {/* content */}
  </Box>
</Dialog>
```

State managed in `MainLayout` as `useState<boolean>`.

### Error Handling

**Server:**
```typescript
throw new AppError('Connection not found', 404);
// Caught by asyncHandler → global error middleware
```

**Client:**
```typescript
import { extractApiError } from '../utils/apiError';
const message = extractApiError(err, 'Failed to create connection');
```

### UI Preferences

All layout state persists via `useUiPreferencesStore`:
```typescript
const { sidebarCompact, set } = useUiPreferencesStore();
set('sidebarCompact', !sidebarCompact);
```

Never use raw `localStorage.getItem/setItem` for UI preferences.

### Async Actions in Dialogs

```typescript
const { loading, error, run } = useAsyncAction();
const handleSubmit = () => run(async () => {
  await api.createConnection(data);
  onClose();
});
```

## Version Bumping

When bumping the version, update all locations:

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

Then run `npm install --package-lock-only` to update the lockfile.

## Workspace Structure

```
arsenale/
├── server/                          # Express API + Socket.IO
│   ├── src/
│   │   ├── index.ts                 # Entry point
│   │   ├── app.ts                   # Express app setup
│   │   ├── config.ts                # Configuration
│   │   ├── cli.ts                   # CLI tool
│   │   ├── routes/                  # Route definitions (31 files)
│   │   ├── controllers/             # Request handlers
│   │   ├── services/                # Business logic
│   │   ├── middleware/              # Auth, CSRF, validation, rate limiting
│   │   ├── socket/                  # Socket.IO + WebSocket handlers
│   │   ├── schemas/                 # Zod validation schemas
│   │   └── types/                   # Shared TypeScript types
│   └── prisma/
│       └── schema.prisma            # Database schema (32 models)
├── client/                          # React 19 SPA
│   ├── src/
│   │   ├── main.tsx                 # Entry point
│   │   ├── App.tsx                  # Router
│   │   ├── api/                     # Axios API modules (30 files)
│   │   ├── store/                   # Zustand stores (15 files)
│   │   ├── pages/                   # Route components
│   │   ├── components/              # UI components
│   │   ├── hooks/                   # Custom React hooks
│   │   ├── theme/                   # 6 themes × 2 modes
│   │   └── utils/                   # Utilities
│   ├── vite.config.ts               # Vite + PWA config
│   └── nginx.conf                   # Production Nginx config
├── gateways/
│   ├── tunnel-agent/                # Zero-trust tunnel agent
│   ├── guacd/                       # Custom guacd with tunnel
│   ├── guacenc/                     # Recording processor
│   └── ssh-gateway/                 # SSH bastion with tunnel
├── extra-clients/
│   └── browser-extensions/          # Chrome extension
├── compose.yml                      # Production Docker Compose
├── compose.dev.yml                  # Development Docker Compose
├── .env.example                     # Environment template
├── eslint.config.mjs                # Shared ESLint config
├── Makefile                         # Development shortcuts
└── CLAUDE.md                        # AI assistant instructions
```
