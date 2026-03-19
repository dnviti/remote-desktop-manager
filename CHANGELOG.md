# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.6.0] - 2026-03-16

### Added
- Scaffold browser extension with Manifest V3 and multi-account management (BEXT-101)
- Extension authentication flow with JWT, CSRF, and MFA support (BEXT-102)
- Keychain integration with vault unlock, secret listing, and copy (BEXT-103)
- Connection listing and one-click session launch in browser extension (BEXT-104)
- Contextual credential autofill on web pages via content script (BEXT-105)
- Core PWA support with manifest, service worker, and installability (PWA-001)
- PWA update notification with reload prompt (PWA-002)
- PWA app shortcuts for quick actions (PWA-003)
- SSH session recording MP4 export and download (REC-338)
- Multi-theme switcher with 6 selectable themes from Settings UI (THEME-2028)

### Fixed
- Encrypt extension tokens at rest in chrome.storage (RPAT-001)
- Add client-side login rate limiting to browser extension (RPAT-002)
- Deduplicate storage reads in browser extension account fetching (RPAT-003)

## [1.5.1] - 2026-03-15

### Fixed
- Add HEALTHCHECK to guacd and tunnel-agent Dockerfiles (SEC-305)
- Update base image packages to patch zlib vulnerabilities (SEC-301, SEC-304)

### Security
- Update hono override to 4.12.8 to patch prototype pollution vulnerability (SEC-303)
- Override tar-fs/tar-stream to patch symlink traversal vulnerability (SEC-302)
- Update Docker base image packages to patch critical zlib buffer overflow (SEC-301)
- Update Docker base image packages to patch zlib CRC32 DoS (SEC-304)

## [1.4.1] - 2026-03-15

### Changed
- Prevent duplicate Guacamole connections and reconnect loops on RDP/VNC session open
- Fix LOG_GUACAMOLE=false having no effect due to guacamole-lite log level bug

### Security
- Upgrade nginx to 1.28 and hide server version (SEC-0002)
- Harden external share endpoint — stricter rate limits and eliminate enumeration oracle (SEC-0003)
- Enforce authentication on Socket.IO base namespace (SEC-0004)
- Add security headers (CSP, HSTS, X-Frame-Options, Permissions-Policy) to nginx (SEC-0005)
- Remove access tokens from URL parameters in OAuth/SAML flows (SEC-0006)
- Restrict auth config and OAuth provider endpoints to reduce info disclosure (SEC-0007)
- Restrict user search to team-scoped results by default (SEC-0008)
- Add custom Express 404 handler to prevent framework disclosure (SEC-0009)
- Extend CSRF token validation to all state-changing endpoints (SEC-0010)
- Enforce tenant boundary on connection sharing recipients (SEC-0011)
- Only set CORS allow-credentials when whitelisted origin matches (SEC-0012)
- Add Cache-Control headers and suppress Last-Modified on static assets (SEC-0013)
- Add Permissions-Policy header via Helmet.js middleware (SEC-0014)

## [1.4.0] - 2026-03-15

### Added
- LDAP/FreeIPA authentication provider with user/group sync (LDAP-101)
- Impossible travel detection with admin alerts (SEC-108)
- Token binding to IP/User-Agent to prevent session hijacking (SEC-111)
- Password breach detection via HIBP and client-side strength meter (SEC-115)
- Concurrent session limits and absolute session timeouts (SEC-117)
- Tenant-level IP allowlist with audit flagging (GUARD-109)
- DLP browser hardening — block DevTools, View Source & exfiltration shortcuts (SEC-301)
- Data Loss Prevention on clipboard and drive mapping (SEC-116)
- External credential provider HashiCorp Vault (VAULT-101)
- Mandatory recovery key confirmation on password change/reset (VAULT-209)
- NetBox connection synchronizer with provider-agnostic architecture (SYNC-102)
- Global cross-tenant administration CLI commands (CLI-173)
- Org-wide connection policy enforcement (PAM-176)
- Extended tenant roles: AUDITOR, CONSULTANT, GUEST, OPERATOR (ROLE-110)
- Time-limited membership with automatic expiration (ROLE-111)
- Custom context menu for connection sessions (CTX-301)
- Keyboard input capture & passthrough for connection sessions (UX-301)
- Auto-reconnect & resiliency UI for connection sessions (UX-073)
- Docked edge toolbar replacing floating toolbar for sessions
- Admin UI sections for full WebUI-API parity (WEBUI-0001)
- Unit tests for utility functions and middleware

### Fixed
- Unresponsive password input in vault lock overlay (VAULT-213)
- VPN false-positive notification dismiss handling
- Impossible travel notification type handler
- DockedToolbar and useGuacToolbarActions review feedback
- DLP shortcut matching now uses key codes for layout independence

### Security
- Mandatory verify and security gates in Docker build pipelines
- Bump hono to 4.12.7 to fix prototype pollution vulnerability

## [1.3.2] - 2026-03-12

### Added
- Vault folders for keychain secret organization
- Notification action framework with deep-links and auto-refresh (SHR-211)

### Changed
- Composite Prisma indexes for audit query performance (OPT-202)
- Lazy-load 14 full-screen dialogs in MainLayout (OPT-201)
- Extract client shared utilities — SlideUp, extractApiError, useAsyncAction (REFAC-202)
- Extract shared Zod validation middleware and centralize schemas (REFAC-201)
- Add asyncHandler wrapper to eliminate try-catch-next boilerplate (REFAC-203)
- Extract shared utilities for vault key, tenant boundary, and re-encryption (REFAC-204)
- Migrate 9 dialog components to useAsyncAction hook (REFAC-205)
- Extend Zod validate middleware with combined API and typed helpers (REFAC-206)
- Remove debug logs and standardize API response destructuring (CLEAN-201)
- Consolidate duplicated patterns and extract shared utilities

### Fixed
- Add OAuth rate limiting

### Security
- Rate-limit vault unlock and session creation endpoints (SEC-201)

## [1.3.1] - 2026-03-11

### Added
- GeoIP popup dialog and audit geo map (GEO-177, GEO-107)
- IP geolocation enrichment with MaxMind GeoLite2 (GEO-106)

### Fixed
- Align VNC token encryption with guacamole-lite server (AES-256-GCM + scrypt key)
- Correct task tracking files

## [1.3.0] - 2026-03-10

### Added
- Import/export connections (CSV, JSON, mRemoteNG, RDP) (IO-071)
- Guacamole recordings conversion to video with guacenc (REC-171)
- SSH and RDP session recording and playback (REC-070)
- Add VNC protocol support and server admin CLI
- Add user profile dialog with clickable usernames
- Create new makefile

### Fixed
- Fix shared volume path for Guacamole recordings (REC-115)
- Fix RDP recording black screen on Windows (disable-gfx not applied) (REC-119)
- Fix SSH recording player layout and RDP playback (REC-118)
- Remove SSRF validation for gateways (allow localhost) (GATE-117)
- Fix: OAuth catch-all route intercepts verify-email (OAUTH-116)
- Allow guacenc container to write converted videos

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

[Unreleased]: https://github.com/dnviti/arsenale/compare/v1.6.0...HEAD
[1.6.0]: https://github.com/dnviti/arsenale/compare/v1.5.2...v1.6.0
[1.5.1]: https://github.com/dnviti/arsenale/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/dnviti/arsenale/compare/v1.4.1...v1.5.0
[1.4.1]: https://github.com/dnviti/arsenale/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/dnviti/arsenale/compare/v1.3.2...v1.4.0
[1.3.2]: https://github.com/dnviti/arsenale/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/dnviti/arsenale/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/dnviti/arsenale/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/dnviti/arsenale/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/dnviti/arsenale/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/dnviti/arsenale/releases/tag/v1.0.0
