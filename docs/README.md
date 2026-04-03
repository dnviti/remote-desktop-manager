# Arsenale Documentation

> Synced on 2026-04-03 from the current repository state. Core generated docs live in the top-level files below, and deeper hand-authored references remain in subdirectories.

## Core Docs

- [Index](index.md) — Landing page, runtime summary, and source-of-truth map
- [Getting Started](getting-started.md) — Prerequisites, dev startup, bootstrap credentials, and verification
- [Architecture](architecture.md) — Service planes, feature gating, gateway topology, and DB proxy flow
- [Configuration](configuration.md) — Installer profile, env vars, secrets, public config, and precedence
- [API Reference](api-reference.md) — Public `/api`, live streams, feature-gated route families, and internal `/v1` contracts
- [Deployment](deployment.md) — Installer flow, Podman and Kubernetes backends, TLS, fixtures, and CI/CD
- [Development](development.md) — Local workflow, tests, feature alignment, and CLI rules
- [Troubleshooting](troubleshooting.md) — Health checks, config drift, bootstrap issues, and debugging commands
- [LLM Context](llm-context.md) — Single-file condensed context for bots and operators

## Operations And Environment

- [Installer](installer.md) — Installer artifacts, reruns, recovery, and encrypted status model
- [Environment Variables](environment.md) — Expanded variable reference
- [Deployment Handoff](go-refactor-handoff.md) — Transition notes for the Go-first runtime

## API And Runtime Deep Dives

- [API Overview](api/overview.md) — Endpoint summary table and auth model
- [Auth](api/auth.md) — Auth, SSO, and bootstrap APIs
- [Connections](api/connections.md) — Connection CRUD and sharing flows
- [Sessions](api/sessions.md) — SSH, RDP, VNC, and database session lifecycle
- [Resources](api/resources.md) — Files, notifications, sync, and related resource APIs
- [Admin](api/admin.md) — Admin, gateways, and tenant operations
- [WebSocket](api/websocket.md) — Real-time transport details

## Client, Database, And Security References

- [Client Overview](components/overview.md) — SPA structure and component map
- [State Management](components/stores.md) — Zustand stores
- [API Layer](components/api-layer.md) — Client API modules
- [Database Overview](database/overview.md) — Model inventory and storage references
- [Encryption](security/encryption.md) — Vault encryption and key handling
- [Authentication](security/authentication.md) — JWT, MFA, SSO, and session security
- [Policies](security/policies.md) — DLP, sharing, and enforcement controls
- [Production Hardening](security/production.md) — Security headers, runtime hardening, and operator checklist

## Guides And Summaries

- [Zero-Trust Tunnel User Guide](guides/zero-trust-tunnel-user-guide.md) — Tunnel deployment and operations
- [Tunnel Implementation Guide](guides/tunnel-implementation-guide.md) — Technical tunnel internals
- [RAG Summary](rag-summary.md) — Condensed feature summary for AI context
