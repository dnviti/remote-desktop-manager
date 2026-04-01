---
title: Architecture
description: System architecture, component interactions, data flow, and design decisions for Arsenale
generated-by: claw-docs
generated-at: 2026-03-27T12:00:00Z
source-files:
  - backend/cmd/control-plane-api/main.go
  - backend/cmd/desktop-broker/main.go
  - backend/cmd/terminal-broker/main.go
  - backend/cmd/tunnel-broker/main.go
  - backend/schema/bootstrap.sql
  - backend/internal/authservice/service.go
  - backend/internal/sshsessions/service.go
  - backend/internal/dbsessions/service.go
  - backend/internal/gateways/service.go
  - client/src/api/client.ts
  - client/vite.config.ts
  - gateways/tunnel-agent/src/config.ts
---

## 🏗 Overview

Arsenale is a secure remote access platform built as a monorepo with npm workspaces. It provides SSH, RDP, VNC, and database proxy access through a unified web interface with enterprise-grade security, multi-tenancy, and session recording.

**Why this architecture:** Arsenale consolidates fragmented remote access tools (PuTTY, RDP clients, VPN tunnels, database GUIs) into a single zero-trust platform where every connection is authenticated, encrypted, audited, and optionally recorded.

> Runtime note: the active application edge runs through the Go split services in `backend/`; there is no local legacy `server/` implementation in-tree.

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
        API["control-plane-api-go\n(Port 8080)"]
        Desktop["desktop-broker-go\n(Port 8091)"]
        Terminal["terminal-broker-go\n(Port 8090)"]
        Tunnel["tunnel-broker-go\n(Port 8092)"]
    end

    subgraph Data["Data Layer"]
        Postgres["PostgreSQL 16\n(SSL/TLS)"]
        Redis["Redis\n(Co-ordination + cache)"]
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
    CLI --> API

    Nginx -->|"/api"| API
    Nginx -->|"/guacamole"| Desktop
    Nginx -->|"/ws/terminal"| Terminal

    API --> Postgres
    API --> Redis
    API --> Guacd
    API --> SSHGw
    API --> DBProxy
    API --> Guacenc
    API --> Tunnel

    Desktop --> Guacd

    Guacd --> RDPServer
    Guacd --> VNCServer
    SSHGw --> SSHServer
    DBProxy --> DBServer
```

## 📦 Workspace Structure

| Workspace | Path | Technology | Purpose |
|-----------|------|-----------|---------|
| Backend | `backend/` | Go 1.25 | Control plane, brokers, orchestration, AI, runtime |
| Client | `client/` | React 19 + Vite + MUI v7 | Web UI (SPA) |
| Tunnel Agent | `gateways/tunnel-agent/` | Node.js + TypeScript | Zero-trust tunnel client |
| Browser Extension | `extra-clients/browser-extensions/` | Chrome MV3 + React | Autofill, keychain |

## 🔀 Active Service Architecture

The live request path follows a Go service architecture centered on explicit handlers and stores: **Routers -> Handlers -> Services -> SQL/Redis/Downstream brokers**.

```mermaid
flowchart LR
    Request["HTTPS Request"] --> Middleware["Edge Middleware"]
    Middleware --> Route["Go Route Handler"]
    Route --> Service["Service Package"]
    Service --> SQL["pgx / SQL stores"]
    Service --> Redis["Redis state + coordination"]
    Service --> External["Downstream services\n(guacd, brokers, guacenc, gateways)"]
```

**Why this shape:** handlers stay close to the public wire contract, service packages own business rules, stores keep SQL explicit, and Redis-backed coordination remains isolated from request serialization.

## 🛡 Edge Request Pipeline

The public Go edge applies security and tenancy checks before dispatching to a feature package.

```mermaid
flowchart TD
    A["TLS ingress via client"] --> B["Host + origin validation"]
    B --> C["Request size / body parsing"]
    C --> D["Cookie + bearer token parsing"]
    D --> E["JWT / refresh validation"]
    E --> F["CSRF + rate limiting"]
    F --> G["Tenant membership normalization"]
    G --> H["Route-specific authz / feature checks"]
    H --> I["Handler + service execution"]
    I --> J["Structured JSON error/response writer"]
```

**Key design decisions:**

- **CSRF uses double-submit cookies**, not server-side tokens, enabling stateless JWT auth without session storage
- **Rate limiting is Redis-backed** so repeated login/session attempts are enforced across instances
- **Feature gates evaluate dynamically** on each request, allowing runtime toggles without restarts via the Settings UI
- **Host validation** prevents DNS rebinding attacks by checking the Host header against allowed values

## 🔐 Authentication Flow

```mermaid
sequenceDiagram
    participant Client
    participant API as control-plane-api-go
    participant DB
    participant MFA as MFA / Redis state

    Client->>API: POST /api/auth/login {email, password}
    API->>DB: Find user, verify Argon2 hash
    alt MFA Required
        API->>Client: 200 {requiresMFA, tempToken, methods[]}
        Client->>API: POST /api/auth/verify-totp {tempToken, code}
        API->>MFA: Validate challenge / WebAuthn or SMS state
        MFA-->>API: Valid
    end
    API->>DB: Create RefreshToken (family-based)
    API-->>Client: 200 {accessToken, csrfToken} + Set-Cookie: refresh token
    Note over Client,API: Access token: 15min, in-memory only<br/>Refresh token: 7d, HttpOnly cookie<br/>CSRF token: in header + cookie

    Client->>API: GET /api/... (Authorization: Bearer token)
    API->>API: Verify JWT signature + token binding
    API->>DB: Normalize tenant membership
    API-->>Client: 200 Response
```

**Security properties:**
- Access tokens are short-lived (15 min) and held in-memory only (never in localStorage)
- Refresh tokens use family-based rotation to detect token replay attacks
- Token binding ties JWTs to the originating IP + User-Agent hash (configurable)
- Account lockout after repeated failures remains centrally enforced on the Go auth path

## 🌐 Interactive Session Flows

### SSH Terminal

```mermaid
sequenceDiagram
    participant Browser
    participant API as control-plane-api-go
    participant Terminal as terminal-broker-go
    participant Target as SSH Server

    Browser->>API: POST /api/sessions/ssh
    API-->>Browser: {sessionId, wsUrl}
    Browser->>Terminal: WSS /ws/terminal
    Terminal->>Target: SSH handshake
    Browser->>Terminal: Terminal input
    Target-->>Terminal: Terminal output
    Terminal-->>Browser: Render in XTerm.js
```

### RDP/VNC via Guacamole

```mermaid
sequenceDiagram
    participant Browser
    participant API as control-plane-api-go
    participant Desktop as desktop-broker-go
    participant Guacd as guacd (TLS :4822)
    participant Target as RDP/VNC Server

    Browser->>API: POST /api/sessions/rdp {connectionId}
    API-->>Browser: {sessionId, guacToken}
    Browser->>Desktop: WSS /guacamole with guacToken
    Desktop->>Guacd: Guacamole protocol (TLS)
    Guacd->>Target: RDP/VNC protocol
    Target-->>Guacd: Screen updates
    Guacd-->>Desktop: Guacamole instructions
    Desktop-->>Browser: Render via guacamole-common-js
```

### Database Sessions

```mermaid
sequenceDiagram
    participant Browser
    participant API as control-plane-api-go
    participant Query as query-runner-go
    participant Target as Database

    Browser->>API: POST /api/sessions/database
    API-->>Browser: {sessionId}
    Browser->>API: POST /api/sessions/database/{id}/query
    API->>Query: Execute query for session
    Query->>Target: SQL over managed connection
    Target-->>Query: Rows / metadata
    Query-->>API: Result payload
    API-->>Browser: JSON result
```

## 🗄 Database Schema

The SQL bootstrap schema and Go stores define the core entities across these domains:

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

## 📡 Distributed Coordination

When running multiple API or broker instances, Arsenale uses Redis for shared ephemeral state and coordination:

```mermaid
flowchart LR
    subgraph Instance1["Runtime Instance 1"]
        S1["API / Brokers"]
    end

    subgraph Instance2["Runtime Instance 2"]
        S2["API / Brokers"]
    end

    subgraph Cache["Redis"]
        KV["Keys / TTL / PubSub"]
    end

    S1 --> KV
    S2 --> KV
```

**What Redis provides:**
- **KV + TTL**: Distributed rate limit counters, auth challenge state, vault status, and short-lived coordination data
- **Pub/Sub**: Cross-instance fanout for status notifications and broker coordination where needed
- **Shared coordination**: Ensures horizontally scaled services observe consistent ephemeral state

## 🔄 Scheduled Jobs

The Go control plane and controller services run background jobs and reconciliation loops:

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
    Settings["Settings UI"] -->|"PUT /api/system-settings"| API["control-plane-api-go"]
    API -->|"registerReload()"| Callbacks["Reload Callbacks"]
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

No service restart is required for supported configuration changes.

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
| Nginx -> control-plane-api-go | HTTP/HTTPS | Internal network or service cert verify |
| Nginx -> desktop-broker-go / terminal-broker-go | HTTP+WS | Internal network |
| control-plane-api-go -> PostgreSQL | SSL | Certificate |
| control-plane-api-go -> Redis | TCP/TLS | Internal network / deployment policy |
| control-plane-api-go -> guacd | TLS | CA verify |
| control-plane-api-go -> guacenc | HTTPS + mTLS | Client + server certs |
| SSH Gateway -> control-plane-api-go | gRPC + mTLS | Client + server certs |

### Logging Security

The active Go services emit structured logs with explicit field redaction and bounded request metadata. Archived `server/src` logging code remains reference-only.

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
        WS["WebSocket + Guacamole Clients"]
    end

    Pages --> Components
    Components --> State
    State --> API
    API --> Client
    Components --> WS
```

**Key patterns:**
- **Access tokens in-memory only** -- never persisted to localStorage
- **Axios interceptor** auto-refreshes tokens on 401 responses
- **UI preferences** persisted via Zustand + localStorage (`uiPreferencesStore`)
- **Full-screen dialogs** overlay the workspace without destroying active SSH/RDP sessions
