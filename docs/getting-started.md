---
title: Getting Started
description: Installation, prerequisites, environment setup, and first run instructions
generated-by: ctdf-docs
generated-at: 2026-03-24T23:40:00Z
source-files:
  - package.json
  - server/package.json
  - client/package.json
  - gateways/tunnel-agent/package.json
  - extra-clients/browser-extensions/package.json
  - .env.example
  - compose.dev.yml
  - Makefile
  - README.md
---

# Getting Started

## Prerequisites

| Requirement | Minimum Version | Purpose |
|-------------|----------------|---------|
| **Node.js** | 22.x | Runtime for server and client |
| **npm** | 10.x | Package manager (workspaces) |
| **Docker** or **Podman** | Docker 24+ / Podman 4+ | PostgreSQL, guacd, guacenc containers |
| **Git** | 2.x | Source control |

Optional:
- **GeoLite2-City.mmdb** -- MaxMind GeoIP database for impossible travel detection
- **Twilio/AWS SNS/Vonage** account -- SMS MFA
- **SMTP server** or SendGrid/SES/Resend/Mailgun -- Only needed if you enable email verification (`EMAIL_VERIFY_REQUIRED=true`)

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/dnviti/arsenale.git
cd arsenale
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your database credentials and secrets

# 3. Start development (Docker containers + server + client)
npm run predev && npm run dev
```

This starts:
- **PostgreSQL** on port 5432 (via Docker)
- **guacenc** recording processor on port 3003 (via Docker)
- **Server** on port 3001 (Express API + Socket.IO)
- **Client** on port 3000 (Vite dev server, proxies to server)

Database migrations run automatically on server start.

## Step-by-Step Setup

### 1. Install Dependencies

```bash
npm install
```

This installs dependencies for all workspaces (server, client, tunnel-agent, browser-extensions) via npm workspaces.

### 2. Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

**Critical variables to set:**

| Variable | Default | Notes |
|----------|---------|-------|
| `DATABASE_URL` | `postgresql://arsenale:arsenale_password@127.0.0.1:5432/arsenale` | PostgreSQL connection string |
| `JWT_SECRET` | (generated in dev) | **Must be set in production** |
| `GUACAMOLE_SECRET` | (generated in dev) | Shared secret for RDP/VNC tokens |
| `CLIENT_URL` | `http://localhost:3000` | Client URL for CORS and verification links |

**OAuth providers** (optional -- leave `CLIENT_ID` empty to disable any provider):

| Variable | Default | Notes |
|----------|---------|-------|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | (empty) | Google OAuth 2.0 |
| `GOOGLE_HD` | (empty) | Restrict Google login to a hosted domain (e.g. `example.com`) |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | (empty) | Microsoft OAuth 2.0 |
| `MICROSOFT_TENANT_ID` | `common` | Azure AD tenant (`common`, `organizations`, or a specific tenant ID) |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | (empty) | GitHub OAuth |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | (empty) | Generic OIDC (Authentik, Keycloak, Authelia, etc.) |

**AI / LLM integration** (optional -- leave `AI_PROVIDER` empty to disable):

| Variable | Default | Notes |
|----------|---------|-------|
| `AI_PROVIDER` | (empty) | `anthropic`, `openai`, `ollama`, or `openai-compatible` |
| `AI_API_KEY` | (empty) | API key for the selected provider (not needed for Ollama) |
| `AI_MODEL` | (provider default) | Model name override |
| `AI_BASE_URL` | (empty) | Required for Ollama and openai-compatible providers |
| `AI_QUERY_GENERATION_ENABLED` | `false` | Enable natural-language-to-SQL query generation |

See [Configuration](configuration.md) for the full list of OAuth, SAML, LDAP, and AI variables.

The `.env` file **must** live at the monorepo root, not inside `server/`. The Prisma CLI resolves its env path to `../.env` via `server/prisma.config.ts`.

### 3. Start Docker Containers

```bash
npm run docker:dev
```

This starts:
- **PostgreSQL 16** -- Database on `127.0.0.1:5432`
- **guacenc** -- Recording processor on port 3003

Alternatively, the `predev` script handles this automatically:

```bash
npm run predev
```

### 4. Generate Prisma Client

If not already done by `predev`:

```bash
npm run db:generate
```

### 5. Start Development Server

```bash
npm run dev
```

Or run server and client separately:

```bash
# Terminal 1
npm run dev:server    # Express on :3001

# Terminal 2
npm run dev:client    # Vite on :3000
```

### 6. Access the Application

Open `http://localhost:3000` in your browser.

The default settings are optimized for a simplified first-run experience:

- **No email provider needed** -- email verification is disabled by default (`EMAIL_VERIFY_REQUIRED=false`)
- **LAN connections work out of the box** -- private network access is allowed by default (`ALLOW_LOCAL_NETWORK=true`)
- **Admin creates accounts** -- self-signup is disabled by default (`SELF_SIGNUP_ENABLED=false`); the first user created via the startup wizard becomes the admin and can then create additional accounts from the admin panel

To get started:

- Complete the startup configuration wizard (creates the admin account)
- Set up your vault password (encrypts all credentials)
- Create your first SSH, RDP, or VNC connection to a LAN or remote host

## Development Ports

| Port | Service | Notes |
|------|---------|-------|
| 3000 | Client (Vite) | Proxies `/api` -> 3001, `/guacamole` -> 3002 |
| 3001 | Server (Express) | REST API + Socket.IO |
| 3002 | Guacamole WebSocket | RDP/VNC tunnel |
| 3003 | guacenc | Recording processor (dev only) |
| 4822 | guacd | RDP/VNC protocol handler (internal) |
| 5432 | PostgreSQL | Database (bound to 127.0.0.1) |

## Using the Makefile

Alternative commands via Make:

```bash
make install          # npm install
make full-stack       # Install + run server + client
make server-dev       # Server with watch (generates DB first)
make client-dev       # Client dev server
make prisma-studio    # Open Prisma Studio GUI
make migrate-dev      # Create interactive migration
```

## DevContainer Support

The project includes a `.devcontainer/` configuration for VS Code Dev Containers:

1. Open the project in VS Code
2. Select "Reopen in Container" when prompted
3. The container includes Node.js 22, Docker socket access, and PostgreSQL

## Verification

Run the full verification pipeline before committing:

```bash
npm run verify
```

This runs: typecheck -> lint -> audit -> test -> build. All checks must pass.

## Next Steps

- [Configuration](configuration.md) -- Environment variables and feature flags
- [Architecture](architecture.md) -- System design and component interactions
- [API Reference](api-reference.md) -- Complete endpoint documentation
- [Development](development.md) -- Contributing guidelines and branch strategy
