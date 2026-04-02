---
title: Architecture
description: System architecture, component interactions, data flow, and design decisions for Arsenale
generated-by: claw-docs
generated-at: 2026-04-02T12:57:10Z
source-files:
  - backend/internal/catalog/catalog.go
  - backend/internal/app/app.go
  - backend/cmd/control-plane-api/runtime.go
  - backend/cmd/control-plane-api/routes_public.go
  - backend/cmd/control-plane-api/routes_sessions.go
  - backend/cmd/control-plane-api/routes_operations.go
  - backend/internal/dbsessions/create.go
  - backend/internal/dbsessions/query_runtime.go
  - backend/internal/dbsessions/dbproxy_client.go
  - backend/internal/queryrunner/protocols.go
  - backend/internal/queryrunnerapi/service.go
  - backend/cmd/db-proxy/main.go
  - client/src/api/client.ts
  - client/vite.config.ts
  - docker-compose.yml
---

## 🎯 Why This Architecture Exists

Arsenale is structured around a strict split between **control**, **runtime**, **gateway**, and **operator** concerns. The control plane owns identity, tenancy, policy, audit, routing, and orchestration. Runtime brokers own browser session transport. Gateways own target-network access. This split keeps high-risk protocol handling away from the public edge while still exposing a unified browser and CLI experience.

The key architectural rule for database access is now explicit: **the backend is an orchestrator and control plane, not the database client of record**. Interactive database queries are issued through `db-proxy` gateways, exactly as SSH and desktop traffic flow through dedicated gateway services.

## 🧭 Service Planes

| Plane | Service | Default Port | Role |
|------|---------|--------------|------|
| Control | `control-plane-api` | `8080` | Public tenant API, auth, routing, policy, audit |
| Control | `control-plane-controller` | `8081` | Placement and reconciliation |
| Control | `authz-pdp` | `8082` | Central policy decision point |
| Agent | `model-gateway` | `8083` | LLM and embedding provider gateway |
| Agent | `tool-gateway` | `8084` | Typed capability gateway |
| Agent | `agent-orchestrator` | `8085` | Agent run lifecycle |
| Agent | `memory-service` | `8086` | Working and semantic memory service |
| Runtime | `terminal-broker` | `8090` | Browser SSH/WebSocket runtime |
| Runtime | `desktop-broker` | `8091` | Browser RDP/VNC runtime |
| Runtime | `tunnel-broker` | `8092` | Tunnel registration and TCP proxying |
| Runtime | `query-runner` | `8093` | Shared query execution service |
| Runtime | `recording-worker` | `8094` | Recording conversion and retention |
| Execution | `runtime-agent` | `8095` | Host-local workload validation |
| Runtime gateway | `db-proxy` | `5432` | Database middleware for connectivity, query, schema, plan, and introspection |

Every Go service uses the same service wrapper in `backend/internal/app/app.go`, which means the following conventions are stable across the fleet:

- `GET /healthz`
- `GET /readyz`
- `GET /v1/meta/service`
- `GET /v1/meta/architecture`

## 🏗 High-Level Component Diagram

```mermaid
flowchart TD
    subgraph clients["Clients"]
        Browser["Browser SPA"]
        CLI["arsenale CLI"]
        Extension["Browser extension"]
    end

    subgraph edge["Public edge"]
        Client["client / nginx"]
        API["control-plane-api"]
        Terminal["terminal-broker"]
        Desktop["desktop-broker"]
    end

    subgraph control["Control and agent services"]
        Controller["control-plane-controller"]
        Authz["authz-pdp"]
        Model["model-gateway"]
        Tool["tool-gateway"]
        Agent["agent-orchestrator"]
        Memory["memory-service"]
    end

    subgraph gateways["Runtime gateways"]
        Tunnel["tunnel-broker"]
        SSH["ssh-gateway"]
        Guacd["guacd"]
        DBProxy["db-proxy"]
        Guacenc["guacenc"]
    end

    subgraph state["State and storage"]
        Postgres["PostgreSQL"]
        Redis["Redis"]
        Files["drive + recordings volumes"]
    end

    Browser --> Client
    Extension --> Client
    CLI --> API

    Client --> API
    Client --> Terminal
    Client --> Desktop

    API --> Postgres
    API --> Redis
    API --> Controller
    API --> Authz
    API --> Model
    API --> Tool
    API --> Agent
    API --> Memory
    API --> Tunnel
    API --> SSH
    API --> Guacd
    API --> DBProxy
    API --> Guacenc

    Desktop --> Guacd
    Terminal --> SSH
    DBProxy --> Files
    API --> Files
```

## 🔐 Public Request Pipeline

```mermaid
flowchart LR
    A["HTTPS request"] --> B["client / nginx routing"]
    B --> C["control-plane-api handler"]
    C --> D["JWT + tenant resolution"]
    D --> E["RBAC / policy checks"]
    E --> F["domain service package"]
    F --> G["PostgreSQL / Redis / gateway call"]
    G --> H["audit event + JSON response"]
```

This split is intentional:

- The client is only a reverse proxy and static asset host.
- The control plane terminates auth, tenancy, and audit.
- Runtime services only handle transport after the control plane has issued a grant or session.

## 🗄 Database Session Architecture

Database querying follows the same gateway pattern as other remote access types.

```mermaid
sequenceDiagram
    participant UI as Browser / Database UI
    participant CP as control-plane-api
    participant TB as tunnel-broker
    participant GP as db-proxy gateway
    participant DB as Target database

    UI->>CP: POST /api/sessions/database
    CP->>CP: Resolve connection, tenant, permissions, DB settings
    CP->>TB: Optional TCP proxy allocation for tunneled gateways
    CP-->>UI: sessionId + proxyHost + proxyPort + protocol

    UI->>CP: POST /api/sessions/database/{id}/query
    CP->>GP: POST /v1/query-runs:execute-any
    GP->>DB: Native driver query
    DB-->>GP: Rows / metadata / errors
    GP-->>CP: QueryExecutionResponse
    CP->>CP: SQL firewall, rate limits, masking, audit, optional stored plan
    CP-->>UI: Query result
```

Important design details:

- The session record is created by `backend/internal/dbsessions/create.go`.
- The control plane locates a `DB_PROXY` gateway, optionally resolves a managed instance, and optionally opens a tunnel-broker TCP proxy in `backend/internal/dbsessions/dbproxy_client.go`.
- Query, schema, explain, and introspection all call the DB proxy's shared `queryrunnerapi` surface:
  - `POST /v1/connectivity:validate`
  - `POST /v1/query-runs:execute-any`
  - `POST /v1/schema:fetch`
  - `POST /v1/query-plans:explain`
  - `POST /v1/introspection:run`
- The control plane applies masking, firewall, rate-limit, and audit logic after the DB proxy returns data.
- Persisted execution plans are opt-in per connection via `dbSettings.persistExecutionPlan`.

Supported interactive query protocols come from `backend/internal/queryrunner/protocols.go`:

- PostgreSQL
- MySQL / MariaDB
- SQL Server
- Oracle
- MongoDB

`client/src/api/connections.api.ts` already includes DB2 connection metadata fields, but DB2 is not part of the active query protocol switch yet.

## 🌉 Gateways and Tunnel Model

Arsenale supports both directly managed gateway containers and tunneled gateway instances.

- `ssh-gateway` exposes SSH transport and gRPC key management.
- `guacd` handles RDP and VNC protocol termination.
- `db-proxy` hosts the query middleware and database drivers.
- `tunnel-agent` can be embedded into `ssh-gateway`, `guacd`, and `db-proxy` images.
- `tunnel-broker` allocates and multiplexes TCP proxies for tunneled instances.

The development stack ships sample tunneled fixtures for all three gateway types:

- `dev-tunnel-ssh-gateway`
- `dev-tunnel-guacd`
- `dev-tunnel-db-proxy`

## 💾 Data, State, and Persistence

| Component | Purpose |
|-----------|---------|
| PostgreSQL | Durable truth for users, tenants, connections, sessions, policies, audit, and memory metadata |
| Redis | Coordination, rate limits, grants, leases, and stream fan-out |
| `arsenale_drive` volume | Browser file transfer staging |
| `arsenale_recordings` volume | Session recordings and exported artifacts |
| Podman secrets | Runtime delivery for JWT, database URL, guacamole secret, encryption key, and provider credentials |
| `dev-certs/` | Shared CA plus service, gateway, and tunnel certificates |

## 🧪 Shared Service Patterns

The Go services deliberately use a narrow common shape:

- `main.go` wires dependencies and registers routes.
- `app.StaticService` declares metadata and a route registration function.
- `app.Run` handles listen address, logging, `/healthz`, `/readyz`, and graceful shutdown.
- Public route registration is consolidated in `backend/cmd/control-plane-api/routes_*.go`.

That uniformity matters for operators and LLMs because it makes new services easy to discover:

- service metadata is machine-readable,
- default ports are declared centrally in `backend/internal/catalog/catalog.go`,
- and every service exposes the same health and meta endpoints.
