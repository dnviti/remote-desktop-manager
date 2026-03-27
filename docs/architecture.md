---
title: Architecture
description: System architecture, component interactions, data flow, and design decisions for Arsenale
generated-by: claw-docs
generated-at: 2026-03-27T12:00:00Z
source-files:
  - server/src/index.ts
  - server/src/app.ts
  - server/src/config.ts
  - server/prisma/schema.prisma
  - server/src/socket/index.ts
  - server/src/middleware/auth.middleware.ts
  - server/src/middleware/error.middleware.ts
  - server/src/middleware/csrf.middleware.ts
  - server/src/middleware/globalRateLimit.middleware.ts
  - server/src/middleware/rateLimitFactory.ts
  - server/src/middleware/tenant.middleware.ts
  - server/src/middleware/team.middleware.ts
  - server/src/middleware/featureGate.middleware.ts
  - server/src/utils/logger.ts
  - client/src/api/client.ts
  - client/vite.config.ts
  - gateways/tunnel-agent/src/config.ts
  - infrastructure/gocache/Dockerfile
---

## 🏗 Overview

Arsenale is a secure remote access platform built as a monorepo with npm workspaces. It provides SSH, RDP, VNC, and database proxy access through a unified web interface with enterprise-grade security, multi-tenancy, and session recording.

**Why this architecture:** Arsenale consolidates fragmented remote access tools (PuTTY, RDP clients, VPN tunnels, database GUIs) into a single zero-trust platform where every connection is authenticated, encrypted, audited, and optionally recorded.

## 🧩 High-Level Architecture

```mermaid
flowchart TD
    subgraph External["External Clients"]
        Browser["Browser (React SPA)"]
        Extension["Chrome Extension"]
        CLI["CLI Tool"]
    end

    subgraph Frontend["Frontend Layer"]
        Nginx["Nginx Reverse Proxy\n(Port 8080)"]
    end

    subgraph Backend["Backend Layer"]
        Express["Express API Server\n(Port 3001, HTTPS)"]
        GuacWS["Guacamole-lite WS\n(Port 3002, WSS)"]
        SocketIO["Socket.IO\n(SSH, Notifications, Gateway Monitor)"]
    end

    subgraph Data["Data Layer"]
        Postgres["PostgreSQL 16\n(SSL/TLS)"]
        GoCacheKV["GoCacheKV\n(gRPC + mTLS)"]
        GoCachePubSub["GoCachePubSub\n(gRPC + mTLS)"]
    end

    subgraph Gateways["Gateway Layer"]
        Guacd["guacd\n(RDP/VNC, Port 4822)"]
        SSHGw["SSH Gateway\n(Port 2222)"]
        DBProxy["DB Proxy\n(Port 5432)"]
        Guacenc["guacenc\n(Video Converter, Port 3003)"]
    end

    subgraph Targets["Remote Targets"]
        RDPServer["RDP Servers"]
        SSHServer["SSH Servers"]
        VNCServer["VNC Servers"]
        DBServer["Databases"]
    end

    Browser --> Nginx
    Extension --> Nginx
    CLI --> Express

    Nginx -->|"/api -> HTTPS"| Express
    Nginx -->|"/socket.io -> WSS"| SocketIO
    Nginx -->|"/guacamole -> WSS"| GuacWS

    Express --> Postgres
    Express --> GoCacheKV
    Express --> GoCachePubSub
    SocketIO --> GoCachePubSub

    Express --> Guacd
    Express --> SSHGw
    Express --> DBProxy
    Express --> Guacenc

    GuacWS --> Guacd

    Guacd --> RDPServer
    Guacd --> VNCServer
    SSHGw --> SSHServer
    DBProxy --> DBServer
```

## 📦 Workspace Structure

| Workspace | Path | Technology | Purpose |
|-----------|------|-----------|---------|
| Server | `server/` | Express 5 + TypeScript | API, auth, sessions, WebSocket |
| Client | `client/` | React 19 + Vite + MUI v7 | Web UI (SPA) |
| Tunnel Agent | `gateways/tunnel-agent/` | Node.js + TypeScript | Zero-trust tunnel client |
| Browser Extension | `extra-clients/browser-extensions/` | Chrome MV3 + React | Autofill, keychain |

## 🔀 Server Layered Architecture

The server follows a strict layered architecture: **Routes -> Controllers -> Services -> Prisma ORM**.

```mermaid
flowchart LR
    Request["HTTP Request"] --> Middleware["Middleware Pipeline"]
    Middleware --> Route["Route Handler"]
    Route --> Controller["Controller"]
    Controller --> Service["Service"]
    Service --> Prisma["Prisma ORM"]
    Prisma --> DB["PostgreSQL"]
    Service --> External["External Services\n(guacd, SSH, gRPC)"]
```

**Why layered:** Each layer has a single responsibility. Routes handle HTTP binding, controllers handle request/response transformation, services contain business logic, and Prisma handles data access. This separation enables unit testing at each layer and prevents cross-cutting concerns from bleeding through.

## 🛡 Middleware Pipeline

The Express middleware pipeline processes every request in strict order. Security-critical middleware runs first; route handlers run last.

```mermaid
flowchart TD
    A["Helmet\n(Security Headers)"] --> B["Trust Proxy"]
    B --> C["Host Validation\n(DNS Rebinding Protection)"]
    C --> D["CORS\n(Origin Matching)"]
    D --> E["Body Parser\n(JSON 500KB Limit)"]
    E --> F["Cookie Parser"]
    F --> G["Passport\n(JWT Strategy)"]
    G --> H["Request Logger\n(Optional)"]
    H --> I["CSRF Validation\n(Double-Submit Cookie)"]
    I --> J["Global Rate Limiter\n(200/min Auth, 60/min Anon)"]
    J --> K["Feature Gates\n(Dynamic Toggles)"]
    K --> L["Route-Specific Middleware\n(Auth, Tenant, Team, Rate Limits)"]
    L --> M["Route Handler"]
    M --> N["Error Handler"]
```

**Key design decisions:**

- **CSRF uses double-submit cookies**, not server-side tokens, enabling stateless JWT auth without session storage
- **Rate limiting is three-tiered**: whitelisted IPs bypass entirely, authenticated users get 200 req/min keyed by userId, anonymous users get 60 req/min keyed by IP
- **Feature gates evaluate dynamically** on each request, allowing runtime toggles without restarts via the Settings UI
- **Host validation** prevents DNS rebinding attacks by checking the Host header against allowed values

## 🔐 Authentication Flow

```mermaid
sequenceDiagram
    participant Client
    participant Express
    participant Passport
    participant DB
    participant MFA

    Client->>Express: POST /api/auth/login {email, password}
    Express->>DB: Find user, verify Argon2 hash
    alt MFA Required
        Express->>Client: 200 {requiresMFA, tempToken, methods[]}
        Client->>Express: POST /api/auth/verify-totp {tempToken, code}
        Express->>MFA: Validate TOTP
        MFA-->>Express: Valid
    end
    Express->>DB: Create RefreshToken (family-based)
    Express-->>Client: 200 {accessToken, csrfToken} + Set-Cookie: refresh token
    Note over Client,Express: Access token: 15min, in-memory only<br/>Refresh token: 7d, HttpOnly cookie<br/>CSRF token: in header + cookie

    Client->>Express: GET /api/... (Authorization: Bearer token)
    Express->>Passport: Verify JWT signature + expiry
    Passport->>Express: Validate token binding (IP + UA hash)
    Express->>DB: Normalize tenant membership
    Express-->>Client: 200 Response
```

**Security properties:**
- Access tokens are short-lived (15 min) and held in-memory only (never in localStorage)
- Refresh tokens use family-based rotation to detect token replay attacks
- Token binding ties JWTs to the originating IP + User-Agent hash (configurable)
- Account lockout after 10 failed attempts for 30 minutes

## 🌐 Real-Time Connections

### SSH Terminal

```mermaid
sequenceDiagram
    participant Browser
    participant SocketIO as Socket.IO /ssh
    participant SSH2 as ssh2 Library
    participant Target as SSH Server

    Browser->>SocketIO: Connect (JWT auth)
    SocketIO->>SSH2: Create SSH session
    SSH2->>Target: TCP connection
    Target-->>SSH2: SSH handshake
    Browser->>SocketIO: Terminal input (keystrokes)
    SocketIO->>SSH2: Forward to SSH stream
    SSH2-->>SocketIO: Terminal output
    SocketIO-->>Browser: Render in XTerm.js
```

### RDP/VNC via Guacamole

```mermaid
sequenceDiagram
    participant Browser
    participant Express
    participant GuacLite as guacamole-lite (WSS :3002)
    participant Guacd as guacd (TLS :4822)
    participant Target as RDP/VNC Server

    Browser->>Express: POST /api/session/rdp {connectionId}
    Express->>Express: Encrypt connection params (AES-256-GCM)
    Express-->>Browser: {sessionId, guacToken}
    Browser->>GuacLite: WebSocket connect with guacToken
    GuacLite->>GuacLite: Decrypt params, validate token
    GuacLite->>Guacd: Guacamole protocol (TLS)
    Guacd->>Target: RDP/VNC protocol
    Target-->>Guacd: Screen updates
    Guacd-->>GuacLite: Guacamole instructions
    GuacLite-->>Browser: Render via guacamole-common-js
```

## 🗄 Database Schema

The Prisma schema defines 32+ models across these domains:

```mermaid
erDiagram
    Tenant ||--o{ TenantMember : "has members"
    Tenant ||--o{ Team : "contains"
    Tenant ||--o{ Gateway : "manages"
    Tenant ||--o{ SshKeyPair : "owns"

    TenantMember }o--|| User : "references"
    Team ||--o{ TeamMember : "has members"
    TeamMember }o--|| User : "references"

    User ||--o{ Connection : "owns"
    User ||--o{ VaultSecret : "owns"
    User ||--o{ ActiveSession : "has"
    User ||--o{ RefreshToken : "has"
    User ||--o{ OAuthAccount : "links"
    User ||--o{ WebAuthnCredential : "registers"
    User ||--o{ AuditLog : "generates"

    Connection ||--o{ SharedConnection : "shared via"
    Connection ||--o{ ActiveSession : "used by"
    Connection }o--o| Gateway : "routes through"
    Connection }o--o| Folder : "organized in"

    VaultSecret ||--o{ VaultSecretVersion : "versioned"
    VaultSecret ||--o{ SharedSecret : "shared via"
    VaultSecret }o--o| VaultFolder : "organized in"

    ActiveSession ||--o{ SessionRecording : "recorded as"
    Gateway ||--o{ ManagedGatewayInstance : "scales to"
```

**Key design decisions:**

- **Multi-tenancy** is enforced at the data model level -- every resource belongs to a Tenant, and queries are scoped by tenantId
- **Vault encryption** uses per-user keys derived from passwords via Argon2, with AES-256-GCM at rest
- **Role hierarchy** provides 7 levels: GUEST < AUDITOR < CONSULTANT < MEMBER < OPERATOR < ADMIN < OWNER
- **Team roles** are separate: TEAM_VIEWER < TEAM_EDITOR < TEAM_ADMIN
- **Audit logging** captures 70+ distinct action types for compliance

## 📡 Distributed Architecture

When running multiple server instances, Arsenale uses the GoCacheAdapter for cross-instance coordination:

```mermaid
flowchart LR
    subgraph Instance1["Server Instance 1"]
        S1["Express + Socket.IO"]
    end

    subgraph Instance2["Server Instance 2"]
        S2["Express + Socket.IO"]
    end

    subgraph Cache["Cache Layer (gRPC + mTLS)"]
        KV["GoCacheKV\n(Session State, Rate Limits)"]
        PubSub["GoCachePubSub\n(Socket.IO Events)"]
    end

    S1 --> KV
    S2 --> KV
    S1 --> PubSub
    S2 --> PubSub
    PubSub --> S1
    PubSub --> S2
```

**What the cache layer provides:**
- **KV Store**: Distributed rate limit counters, session state, leader election
- **PubSub**: Socket.IO event broadcasting across instances (notifications, SSH streams, gateway events)
- **Leader Election**: Ensures singleton cron jobs (key rotation, LDAP sync, cleanup) run on exactly one instance

## 🔄 Scheduled Jobs

The server runs background jobs via `node-cron`:

| Job | Default Schedule | Purpose |
|-----|-----------------|---------|
| Key Rotation | `0 2 * * *` (2 AM daily) | Rotate JWT signing keys |
| LDAP Sync | `0 */6 * * *` (every 6h) | Sync users/groups from LDAP |
| Membership Expiry | Hourly | Auto-remove expired tenant/team members |
| Secret Rotation | Configurable | Rotate passwords per policy |
| Session Cleanup | Hourly | Close idle sessions, purge 30-day old closed sessions |
| Recording Cleanup | Daily | Remove recordings past retention (default 90 days) |
| Token Cleanup | Hourly | Purge expired refresh tokens |
| Gateway Health | 30s interval | Health check managed gateways |
| Auto-scaling | 30s interval | Evaluate gateway replica counts |
| System Secret Rotation | Configurable | Roll over JWT + Guacamole keys |
| Device Auth Cleanup | 5-min interval | Purge expired device auth codes |

## ⚙ Live Reload

Configuration changes from the Settings UI take effect immediately via the live reload system:

```mermaid
flowchart LR
    Settings["Settings UI"] -->|"PUT /api/system-settings"| Express
    Express -->|"registerReload()"| Callbacks["Reload Callbacks"]
    Callbacks --> OAuth["OAuth Strategies"]
    Callbacks --> LDAP["LDAP Config"]
    Callbacks --> RateLimits["Rate Limiters"]
    Callbacks --> Email["Email Provider"]
    Callbacks --> SMS["SMS Provider"]
    Callbacks --> Vault["Vault TTL"]
    Callbacks --> AI["AI Config"]
    Callbacks --> Features["Feature Flags"]
    Callbacks --> Gateway["Gateway Routing"]
```

No server restart required for configuration changes.

## 🔒 Security Architecture

### Encryption at Rest

- **Vault secrets**: AES-256-GCM with per-user master key (Argon2-derived from password)
- **Connection credentials**: AES-256-GCM with server encryption key
- **SSH key pairs**: AES-256-GCM with tenant-scoped key
- **Refresh tokens**: SHA-256 hashed before DB storage

### Network Security

All service-to-service communication uses TLS or mTLS:

| Connection | Protocol | Authentication |
|-----------|----------|---------------|
| Client -> Nginx | HTTPS | - |
| Nginx -> Express | HTTPS | Server cert verify |
| Express -> PostgreSQL | SSL | Certificate |
| Express -> guacd | TLS | CA verify |
| Express -> GoCacheKV | gRPC + mTLS | Client + server certs |
| Express -> GoCachePubSub | gRPC + mTLS | Client + server certs |
| Express -> guacenc | HTTPS + mTLS | Client + server certs |
| SSH Gateway -> Express | gRPC + mTLS | Client + server certs |

### Logging Security

The logger (`server/src/utils/logger.ts`) provides defense-in-depth sanitization:

1. **Sensitive key redaction**: Detects password, secret, token, apikey, etc. in log arguments
2. **Value pattern matching**: Redacts JWT tokens (`eyJ...`), Bearer tokens, key-value patterns
3. **Newline stripping**: Prevents log injection attacks
4. **Error sanitization**: Scrubs stack traces before logging

## 🧱 Client Architecture

```mermaid
flowchart TD
    subgraph UI["React 19 + MUI v7"]
        Pages["Pages\n(Login, Dashboard, Setup)"]
        Components["Components\n(Terminal, RDP, VNC, Sidebar, Tabs)"]
    end

    subgraph State["Zustand Stores (17)"]
        Auth["authStore"]
        Connections["connectionsStore"]
        Tabs["tabsStore"]
        Vault["vaultStore"]
        Secrets["secretStore"]
        Gateway["gatewayStore"]
        Teams["teamStore"]
        Tenant["tenantStore"]
    end

    subgraph API["API Layer (29 modules)"]
        Client["Axios Client\n(JWT interceptor, CSRF)"]
    end

    subgraph Realtime["Real-time"]
        SIO["Socket.IO Client"]
    end

    Pages --> Components
    Components --> State
    State --> API
    API --> Client
    Components --> SIO
```

**Key patterns:**
- **Access tokens in-memory only** -- never persisted to localStorage
- **Axios interceptor** auto-refreshes tokens on 401 responses
- **UI preferences** persisted via Zustand + localStorage (`uiPreferencesStore`)
- **Full-screen dialogs** overlay the workspace without destroying active SSH/RDP sessions
