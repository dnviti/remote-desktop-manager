# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] - 2026-03-08

### Added
- Multi-tenant membership with organization picker on login (TENANT-096)

## [1.1.0] - 2026-03-07

### Added
- SAML 2.0 SSO authentication via Passport.js (SSO-074)
- User domain credential profile for SSO passthrough (SSO-075)
- Domain credential passthrough for RDP/SSH connections (SSO-076)
- Per-connection audit log with user filter (AUDIT-095)
- Block connections to loopback and local IP addresses (GUARD-105)
- Reusable identity verification system for sensitive operations
- Dedicated /health endpoint for client nginx container

### Changed
- Rename project from Remote Desktop Manager to Arsenale

### Fixed
- Activate proactive token refresh on page reload for member users
- Remove inherited EXPOSE 80 from client nginx container
- Resolve CJS/ESM crash in Docker production build
- Added logo transparent

## [1.0.0] - 2026-02-28

### Added

#### Core Connectivity
- SSH terminal sessions via XTerm.js and Socket.IO (`/ssh` namespace)
- RDP sessions via Apache Guacamole (guacamole-lite + guacd)
- Tabbed interface for managing multiple concurrent sessions
- Connection dialog for creating SSH and RDP connections

#### Connection Management
- Hierarchical folder organization with drag-and-drop reordering
- Context menu (right-click) on connections: Connect, Connect As, Edit, Delete, Share
- Inline connection editing with vault-protected credential updates
- Search bar for filtering connections by name, host, type, or description
- Favorites and recent connections sections in the sidebar
- Drag-and-drop to move connections between folders

#### File Transfer
- RDP drive redirection for file upload/download between browser and remote session
- SFTP file browser for SSH sessions with upload, download, mkdir, rename, delete
- Transfer queue with progress tracking and chunked transfers (64 KB chunks, 100 MB max)

#### Terminal & RDP Customization
- SSH terminal customization: font family, font size, 9 color themes, cursor style, bell
- RDP session customization: quality presets (Performance/Balanced/Quality/Custom), color depth, resolution, DPI, audio, security mode, keyboard layout
- Two-level configuration: global defaults per user + per-connection overrides

#### Security
- AES-256-GCM encryption for all stored credentials
- Argon2id key derivation from user password (master key never stored)
- Vault session with configurable TTL (default: 30 minutes auto-lock)
- TOTP two-factor authentication (RFC 6238, compatible with standard authenticator apps)
- Email verification on account registration (with resend and 24-hour token expiry)
- OAuth 2.0 authentication with Google, Microsoft, and GitHub
- Separate vault password for OAuth users (same encryption guarantees)
- JWT access tokens (15 min) + refresh tokens (7 days) with automatic client-side refresh

#### Multi-Tenant & Teams
- Multi-tenant schema: Tenant, Team, TeamMember models with role hierarchies
- Backend CRUD for tenant management: create, invite users, manage roles
- Backend CRUD for team management: create teams, manage members, team vault
- Team vault: per-team master key encrypted with each member's personal key
- Connection ownership model: private, team-scoped, and shared connections
- Tenant-scoped user search for connection sharing (cross-tenant sharing prohibited)

#### Sharing & Notifications
- Share connections with users inside the same tenant (READ_ONLY or FULL_ACCESS)
- User picker with autocomplete, avatar, and email for selecting share targets
- In-app notifications for connection share events (real-time via Socket.IO)

#### Administration & Observability
- User settings page: profile, avatar, password change with automatic vault re-keying
- Linked OAuth accounts management in settings
- Audit log with 24 distinct action types, date/action filters, and pagination
- Configurable log level via `LOG_LEVEL` environment variable

#### Developer Experience
- ESLint flat config with `typescript-eslint` strict rules and `eslint-plugin-security`
- TypeScript strict mode in both server and client workspaces
- `npm run verify` quality gate: typecheck → lint → audit → build
- GitHub Actions CI pipeline running the full quality gate on push/PR

### Security

- All connection credentials encrypted at rest (AES-256-GCM + Argon2id)
- bcrypt password hashing for login credentials
- Vault auto-lock with configurable TTL
- TOTP 2FA support
- Email verification preventing unverified account login
- ESLint security plugin enforced in CI

[Unreleased]: https://github.com/dnviti/arsenale/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/dnviti/arsenale/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/dnviti/arsenale/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/dnviti/arsenale/releases/tag/v1.0.0
