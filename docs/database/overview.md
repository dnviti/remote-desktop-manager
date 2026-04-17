# Database Overview

> Auto-generated on 2026-03-15 by /docs create database.
> Source of truth is the codebase. Run /docs update database after code changes.

## Overview

- **Provider**: PostgreSQL 16
- **Active access layer**: Go stores and SQL in `backend/internal/*`
- **Schema source of truth**: `backend/migrations/*.sql`
- **Generated query config**: `backend/sqlc.yaml`
- **Connection**: Configured via `DATABASE_URL` environment variable
- **Migration path**: `backend/cmd/migrate` and `scripts/db-migrate.sh`

<!-- manual-start -->
The legacy Prisma schema is retained only as archived reference under `server/`. The running application no longer depends on Prisma generation or `prisma migrate deploy`. Runtime DDL bootstrapping has been removed from the Go services; schema changes must land as versioned SQL migrations and fixed application queries should live behind sqlc-generated packages.
<!-- manual-end -->

## Entity-Relationship Summary

The database models a multi-tenant remote access management system:

- **Users** own **Connections** (SSH/RDP/VNC), organize them in **Folders**, and can **share** them with other users via **SharedConnection**.
- **Tenants** represent organizations. Users join tenants through **TenantMember** with roles (Owner/Admin/Member).
- **Teams** exist within tenants. Users join teams through **TeamMember** with roles (Admin/Editor/Viewer).
- Connections can be routed through **Gateways** (GUACD, SSH Bastion, or Managed SSH). Managed gateways have **ManagedGatewayInstances** (containers).
- **GatewayTemplates** provide reusable gateway configurations for quick deployment.
- Each tenant has an optional **SshKeyPair** for managed SSH gateways with auto-rotation.
- **VaultSecrets** store encrypted credentials (Login, SSH Key, Certificate, API Key, Secure Note) with versioning (**VaultSecretVersion**) and sharing (**SharedSecret**, **ExternalSecretShare**).
- Secrets can be organized in **VaultFolders** scoped to personal, team, or tenant level.
- **TenantVaultMember** tracks tenant-level vault key distribution.
- **ActiveSession** tracks live SSH/RDP/VNC sessions with heartbeats and idle detection.
- **SessionRecording** stores metadata for recorded sessions (asciicast for SSH, .guac for RDP/VNC).
- **AuditLog** records 100+ distinct action types with optional geo-location enrichment.
- **Notification** delivers in-app notifications for sharing and secret events.
- **RefreshToken** manages JWT refresh token families with rotation and reuse detection.
- **OAuthAccount** links external identity providers (Google, Microsoft, GitHub, OIDC, SAML).
- **WebAuthnCredential** stores FIDO2/passkey credentials for passwordless MFA.
- **OpenTab** persists the user's open tab instances server-side, including multiple simultaneous tabs for the same connection.
- **AccessPolicy** stores ABAC (Attribute-Based Access Control) policies scoped to tenants, teams, or folders, enforcing time windows, trusted device, and MFA step-up constraints.
- **AppConfig** stores key-value application settings (e.g., self-signup toggle).
- **Checkout** tracks temporary credential checkout/check-in requests with approval workflow for PAM.
- **KeystrokePolicy** defines real-time SSH keystroke inspection patterns with block or alert actions.
- **FirewallRule** stores SQL firewall rules for query pattern matching and blocking in the DB proxy.
- **MaskingPolicy** defines column-level data masking applied after database query execution.
- **RateLimitPolicy** enforces per-connection query rate limits in the DB audit subsystem.
- **DbAuditLog** records all database queries executed through the DB proxy with timing and firewall status.

<!-- manual-start -->
<!-- manual-end -->
