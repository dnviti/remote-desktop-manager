# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Full dev setup (starts Docker guacd, generates Prisma client, syncs DB schema, runs server+client)
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
npm run db:push             # Sync schema to database (no migration)
npm run db:migrate          # Run migrations

# Docker
npm run docker:dev          # Start guacd container (required for RDP)
npm run docker:dev:down     # Stop dev containers
npm run docker:prod         # Full production stack (PostgreSQL + guacd + server + client)
```

## Environment Setup

Copy `.env.example` to `.env`. SQLite is used in development (`file:./dev.db`), PostgreSQL in production. Docker is required for `guacd` (Guacamole daemon) to support RDP connections.

## Architecture

**Monorepo** with npm workspaces: `server/` and `client/`.

### Server (Express + TypeScript)

Layered architecture: **Routes → Controllers → Services → Prisma ORM**

- `server/src/index.ts` — Entry point: creates HTTP server, attaches Socket.IO and Guacamole WebSocket server
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
- UI framework: Material-UI (MUI) v6

## Key Patterns

### Real-Time Connections

- **SSH**: Client opens tab → Socket.IO connects to `/ssh` namespace → server creates SSH2 session → bidirectional terminal data via WebSocket. Terminal rendered with XTerm.js.
- **RDP**: Client requests token from `/sessions/rdp` → Guacamole WebSocket tunnel on port 3002 → `guacd` handles RDP protocol. Rendered with `guacamole-common-js`.

### Vault & Encryption

All connection credentials are encrypted at rest using AES-256-GCM. Each user has a master key derived from their password via Argon2. The master key is held in-memory server-side with a configurable TTL (vault sessions auto-expire). When the vault is locked, users must re-enter their password to decrypt credentials.

### Authentication

JWT-based with access tokens (short-lived) and refresh tokens (stored in DB). The Axios client interceptor automatically refreshes expired access tokens. Socket.IO connections authenticate via JWT middleware.

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
