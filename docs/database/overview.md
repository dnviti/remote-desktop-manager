# Database Overview

> Auto-generated on 2026-03-15 by /docs create database.
> Source of truth is the codebase. Run /docs update database after code changes.

## Overview

- **Provider**: PostgreSQL 16
- **ORM**: Prisma (with `prisma-client` generator, CJS module format, output to `server/src/generated/prisma`)
- **Schema location**: `server/prisma/schema.prisma`
- **Connection**: Configured via `DATABASE_URL` environment variable
- **Migrations**: Automatically applied on server start via `prisma migrate deploy`

<!-- manual-start -->
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
- **OpenTab** persists the user's open connection tabs server-side.
- **AppConfig** stores key-value application settings (e.g., self-signup toggle).

<!-- manual-start -->
<!-- manual-end -->
