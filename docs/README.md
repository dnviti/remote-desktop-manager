# Arsenale Documentation

> Auto-generated on 2026-03-15. Index of all project documentation.

## Architecture & Design

- [Architecture](architecture.md) — System overview, server/client layers, connection flows, network topology

## API Reference

- [Overview](api/overview.md) — Endpoint summary table and authentication
- [Auth & SSO](api/auth.md) — Health, Auth, OAuth, SAML endpoints
- [Vault](api/vault.md) — Vault lock/unlock, MFA unlock, auto-lock
- [Connections](api/connections.md) — Connection CRUD, sharing, import/export, folders
- [Sessions](api/sessions.md) — RDP/VNC/SSH session lifecycle
- [User & 2FA](api/user.md) — Profile, settings, TOTP/SMS/WebAuthn
- [Admin & Organization](api/admin.md) — Tenants, teams, admin, gateways
- [Resources](api/resources.md) — Secrets, files, audit, recordings, notifications, sync
- [WebSocket](api/websocket.md) — Socket.IO and Guacamole real-time protocols

## Database

- [Overview](database/overview.md) — Provider, ORM, ER summary
- [Core Models](database/core-models.md) — User, Tenant, Team, Connection, Folder
- [Gateway Models](database/gateway-models.md) — Gateway, templates, SSH keys
- [Vault Models](database/vault-models.md) — Secrets, versioning, sharing
- [Session Models](database/session-models.md) — Active sessions, recordings
- [Supporting Models](database/supporting-models.md) — Auth tokens, OAuth, notifications, sync
- [Enums](database/enums.md) — All enumeration types

## Client

- [Overview](components/overview.md) — Tech stack, pages
- [UI Components](components/ui-components.md) — All 88 components
- [State Management](components/stores.md) — 14 Zustand stores
- [Hooks](components/hooks.md) — 13 custom hooks
- [API Layer](components/api-layer.md) — 29 API modules

## Security

- [Encryption](security/encryption.md) — Vault encryption, key derivation, recovery
- [Authentication](security/authentication.md) — JWT, refresh tokens, rate limiting, sessions
- [Policies](security/policies.md) — Sharing, DLP, IP allowlist, SSRF prevention
- [Production Hardening](security/production.md) — Security headers, production checklist

## Operations

- [Deployment](deployment.md) — Dev setup, production Docker, Nginx, troubleshooting
- [Environment Variables](environment.md) — Full variable reference

## Reference

- [RAG Summary](rag-summary.md) — Condensed feature summary for AI context
