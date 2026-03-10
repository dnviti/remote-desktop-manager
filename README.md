<div align="center">
  <img src="icons/Arsenale_logo_transparent.png" alt="Arsenale" width="500" />
</div>

[![License: BSL 1.1](https://img.shields.io/badge/License-BSL_1.1-blue.svg)](LICENSE)
[![Verify](https://github.com/dnviti/arsenale/actions/workflows/verify.yml/badge.svg)](https://github.com/dnviti/arsenale/actions/workflows/verify.yml)
[![Version](https://img.shields.io/badge/version-1.0.0-green.svg)](CHANGELOG.md)

A web-based application for managing and accessing remote SSH and RDP connections from your browser. Organize connections in folders, share them with team members, and keep credentials encrypted at rest with a personal vault.

## Features

- **SSH Terminal** — Interactive terminal sessions powered by XTerm.js and Socket.IO
- **RDP Viewer** — Remote desktop connections via Apache Guacamole
- **Encrypted Vault** — All credentials encrypted at rest with AES-256-GCM; master key derived from your password via Argon2
- **Connection Sharing** — Share connections with other users (read-only or full access)
- **Folder Organization** — Hierarchical folder tree to keep connections organized
- **Tabbed Interface** — Open multiple sessions side by side
- **JWT Authentication** — Secure auth with automatic token refresh

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Server** | Express, TypeScript, Prisma, Socket.IO, ssh2, guacamole-lite |
| **Client** | React 19, Vite, Material-UI v6, Zustand, XTerm.js, guacamole-common-js |
| **Database** | PostgreSQL 16 |
| **Infrastructure** | Docker, Nginx, guacd |

## Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [Docker](https://www.docker.com/) (required for RDP support via `guacd`)
- npm 9+

## Getting Started

### 1. Clone the repository

```bash
git clone <repository-url>
cd arsenale
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` as needed — see [Environment Variables](#environment-variables) below.

### 4. Run in development

```bash
# Full setup: starts guacd, generates Prisma client, syncs DB schema, then runs dev servers
npm run predev && npm run dev
```

This starts:
- PostgreSQL 16 on port 5432 (Docker)
- guacd container on port 4822 (Docker)
- Express API server on `http://localhost:3001`
- Vite dev server on `http://localhost:3000` (proxies API and WebSocket requests)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://arsenale:arsenale_password@127.0.0.1:5432/arsenale` | PostgreSQL connection string |
| `JWT_SECRET` | `change-me-in-production` | Secret key for signing JWT tokens |
| `JWT_EXPIRES_IN` | `15m` | Access token TTL |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | Refresh token TTL |
| `GUACD_HOST` | `localhost` | Guacamole daemon hostname |
| `GUACD_PORT` | `4822` | Guacamole daemon port |
| `GUACAMOLE_SECRET` | `change-me-guacamole-secret` | Guacamole encryption secret |
| `PORT` | `3001` | Express server port |
| `GUACAMOLE_WS_PORT` | `3002` | Guacamole WebSocket port |
| `NODE_ENV` | `development` | Environment mode |
| `VAULT_TTL_MINUTES` | `30` | Vault session auto-lock timeout (minutes) |

## Project Structure

```
arsenale/
├── server/                        # Express backend
│   ├── src/
│   │   ├── index.ts              # Entry point (HTTP + Socket.IO + Guacamole WS)
│   │   ├── app.ts                # Express app setup
│   │   ├── routes/               # REST API route definitions
│   │   ├── controllers/          # Request handling and validation
│   │   ├── services/             # Business logic and database operations
│   │   ├── socket/               # Socket.IO SSH handlers
│   │   ├── middleware/           # Auth and error handling
│   │   └── types/                # Shared TypeScript types
│   └── prisma/
│       └── schema.prisma         # Database schema
│
├── client/                        # React frontend
│   ├── src/
│   │   ├── pages/                # Login, Register, Dashboard
│   │   ├── components/           # UI components (RDP, Terminal, Sidebar, Tabs, Dialogs)
│   │   ├── api/                  # Axios API clients with JWT interceptor
│   │   ├── store/                # Zustand state stores
│   │   └── hooks/                # Custom React hooks
│   └── nginx.conf                # Production reverse proxy config
│
├── docker-compose.yml            # Production stack
├── docker-compose.dev.yml        # Dev (guacd + PostgreSQL)
└── .env.example                  # Environment template
```

## Available Scripts

```bash
# Development
npm run dev                 # Run server + client concurrently
npm run dev:server          # Server only (Express on :3001)
npm run dev:client          # Client only (Vite on :3000)

# Build
npm run build               # Build both server and client
npm run build -w server     # Server only
npm run build -w client     # Client only

# Database
npm run db:generate         # Generate Prisma client types
npm run db:push             # Sync schema to DB (no migration)
npm run db:migrate          # Run Prisma migrations

# Docker
npm run docker:dev          # Start guacd + PostgreSQL containers
npm run docker:dev:down     # Stop dev containers
npm run docker:prod         # Full production stack (requires .env.production)
```

## Production Deployment

Deploy the full stack with Docker Compose:

```bash
# 1. Create production secrets
cp .env.production.example .env.production
# Edit .env.production — set strong values for POSTGRES_PASSWORD, JWT_SECRET, GUACAMOLE_SECRET

# 2. Launch the stack
npm run docker:prod
```

This starts four containers:
- **PostgreSQL 16** — Production database
- **guacd** — Apache Guacamole daemon for RDP
- **Server** — Express API (runs migrations on startup)
- **Client** — Nginx serving the React app with reverse proxy to the API

## Architecture

### Server

Layered architecture: **Routes → Controllers → Services → Prisma ORM**

- REST API for connections, folders, sharing, vault, and auth
- Socket.IO namespace (`/ssh`) for real-time SSH terminal sessions
- Guacamole WebSocket server (port 3002) for RDP tunneling

### Client

- Zustand stores manage auth, connections, tabs, and vault state
- Axios interceptor handles automatic JWT refresh on 401 responses
- XTerm.js renders SSH terminals; guacamole-common-js renders RDP sessions

### Vault & Encryption

- User password → Argon2 → master key → AES-256-GCM encryption of all credentials
- Master key held in server memory with auto-expiring sessions (configurable TTL)
- Vault must be unlocked to view or use stored credentials

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, code conventions, commit guidelines, and the PR process.

Before submitting a pull request, make sure the quality gate passes:

```bash
npm run verify
```

## License

This project is licensed under the [Business Source License 1.1](LICENSE).
