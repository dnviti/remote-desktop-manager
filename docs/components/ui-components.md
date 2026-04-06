# UI Components

> Auto-generated on 2026-03-15 by /docs create components.
> Source of truth is the codebase. Run /docs update components after code changes.

## Components

### Layout (`client/src/components/Layout/`)

| Component | Purpose |
|-----------|---------|
| `MainLayout` | Top-level layout: sidebar, tab bar, connection viewers, and all full-screen dialog mount points. Manages open/close state for all dialogs. |
| `TenantSwitcher` | Sidebar dropdown for switching between tenant organizations |
| `NotificationBell` | AppBar bell icon with unread badge and notification dropdown list |

### Sidebar (`client/src/components/Sidebar/`)

| Component | Purpose |
|-----------|---------|
| `ConnectionTree` | Main sidebar — connection tree with folders, favorites section, recents, shared connections, search, drag-and-drop, and context menus |
| `TeamConnectionSection` | Sidebar section showing team connections grouped by team with folder support |
| `treeHelpers` | Helper functions for building tree node structures from flat connection/folder data |

### Tabs (`client/src/components/Tabs/`)

| Component | Purpose |
|-----------|---------|
| `TabBar` | Horizontal tab bar with close buttons, active indicator, pop-out action, and context menu |
| `TabPanel` | Content panel that renders the appropriate viewer (SSH terminal, RDP, VNC) for the active tab |

### Terminal / SSH (`client/src/components/Terminal/`, `client/src/components/SSH/`)

| Component | Purpose |
|-----------|---------|
| `SshTerminal` | XTerm.js-based SSH terminal with Socket.IO connection, resize handling, search addon, and SFTP browser integration |
| `SftpBrowser` | In-session SFTP file browser panel (navigate, upload, download, delete, rename, mkdir) |
| `SftpTransferQueue` | SFTP transfer progress queue showing active/completed/failed file transfers |

### RDP (`client/src/components/RDP/`)

| Component | Purpose |
|-----------|---------|
| `RdpViewer` | Guacamole-based RDP viewer with clipboard sync, dynamic scaling, toolbar, and drive redirection |
| `FileBrowser` | In-session RDP file browser for the virtual drive (upload, download, delete, create folder) |

### VNC (`client/src/components/VNC/`)

| Component | Purpose |
|-----------|---------|
| `VncViewer` | Guacamole-based VNC viewer with clipboard sync, scaling, and toolbar |

### Dialogs (`client/src/components/Dialogs/`)

All full-screen dialogs use the MUI `Dialog` component with `fullScreen` prop and `Slide` transition, rendered from `MainLayout` to preserve active sessions.

| Component | Purpose |
|-----------|---------|
| `SettingsDialog` | Full-screen settings with tabbed sections (profile, security, terminal, RDP, VNC, gateway, tenant, teams, audit) |
| `AuditLogDialog` | Full-screen personal audit log with filtering, pagination, and geo-location |
| `ConnectionAuditLogDialog` | Full-screen audit log scoped to a specific connection |
| `KeychainDialog` | Full-screen secrets/keychain manager (list, create, edit, share, external share) |
| `ConnectionDialog` | Create/edit connection dialog (SSH, RDP, VNC) with host, port, credentials, gateway selection, and per-connection settings |
| `FolderDialog` | Create/rename folder dialog |
| `ShareDialog` | Manage connection sharing (add/remove users, change permissions) |
| `ShareFolderDialog` | Batch-share all connections in a folder |
| `ImportDialog` | Import connections from CSV/JSON/mRemoteNG/RDP files |
| `ExportDialog` | Export connections to CSV or JSON (with optional credentials) |
| `ConnectAsDialog` | Choose credential mode (saved, domain, manual) before opening a connection |
| `CreateUserDialog` | Tenant admin: create a new user with email, password, and role |
| `UserProfileDialog` | View tenant user's profile, teams, and admin actions (change email/password, MFA status) |
| `InviteDialog` | Tenant admin: invite a user by email with a role |
| `TeamDialog` | Create or edit a team (name, description, members, roles) |

### Keychain (`client/src/components/Keychain/`)

| Component | Purpose |
|-----------|---------|
| `SecretListPanel` | Left panel — filterable, sortable list of secrets with scope/type badges |
| `SecretDetailView` | Right panel — full secret data, metadata, tags, shares, and external shares |
| `SecretDialog` | Create/edit secret (Login, SSH Key, Certificate, API Key, Secure Note) |
| `SecretVersionHistory` | Version history with diff viewing and restore capability |
| `SecretPicker` | Autocomplete picker to select a keychain secret (used in ConnectionDialog) |
| `ShareSecretDialog` | Share a secret with another user (internal sharing with permissions) |
| `ExternalShareDialog` | Create external share link (expiry, max accesses, optional PIN) |
| `SecretTree` | Folder tree navigation for vault secrets with drag-and-drop support and context menus |
| `VaultFolderDialog` | Create/edit vault folder with scope (personal, team, tenant) and parent selection |

### Settings (`client/src/components/Settings/`)

| Component | Purpose |
|-----------|---------|
| `ProfileSection` | Username, email, avatar upload |
| `ChangePasswordSection` | Password change with identity verification |
| `TwoFactorSection` | TOTP 2FA setup/disable with QR code |
| `SmsMfaSection` | SMS MFA setup — phone, verification, enable/disable |
| `WebAuthnSection` | WebAuthn/passkey management — register, rename, remove |
| `LinkedAccountsSection` | OAuth linked accounts — link/unlink providers |
| `TerminalSettingsSection` | SSH terminal defaults (theme, font, cursor) |
| `RdpSettingsSection` | RDP defaults (color depth, resize, clipboard, audio, etc.) |
| `VncSettingsSection` | VNC defaults (color depth, cursor, resize, clipboard) |
| `ConnectionDefaultsSection` | Default credential mode setting |
| `VaultAutoLockSection` | Vault auto-lock timer (with tenant maximum enforcement) |
| `DomainProfileSection` | Windows/AD domain profile (domain, username, password) |
| `TenantSection` | Tenant management — name, MFA policy, session timeout, user management |
| `TenantAuditLogSection` | Tenant-wide audit log with user filter, geo map, table/timeline views |
| `TeamSection` | Team management — CRUD teams, manage members and roles |
| `GatewaySection` | Gateway management — CRUD, SSH keys, health tests, orchestration tabs |
| `EmailProviderSection` | Email provider status and test-send (admin) |
| `SelfSignupSection` | Toggle self-signup on/off (admin, respects env-lock) |
| `LdapConfigSection` | LDAP integration status, connection test, and manual sync trigger (admin) |
| `SyncProfileSection` | External sync profile management — CRUD profiles, test connections, trigger syncs, view logs |
| `SyncPreviewDialog` | Sync preview dialog showing items to create, update, skip, and errors before confirming |
| `IpAllowlistSection` | Tenant IP allowlist configuration with CIDR support and IP test tool |
| `TenantConnectionPolicySection` | Tenant-wide enforced connection settings (SSH/RDP/VNC defaults and overrides) |
| `VaultProvidersSection` | External vault provider management (HashiCorp Vault) — CRUD, test, token/AppRole auth |

### Gateway / Orchestration (`client/src/components/gateway/`, `client/src/components/orchestration/`)

| Component | Purpose |
|-----------|---------|
| `GatewayDialog` | Create/edit gateway (GUACD, SSH Bastion, Managed SSH) with connection test |
| `GatewayTemplateDialog` | Create/edit gateway template with auto-scaling and LB defaults |
| `GatewayTemplateSection` | Gateway templates list with create/edit/delete/deploy actions |
| `OrchestrationSection` | Settings section wrapper for orchestration dashboard |
| `SessionDashboard` | Active sessions with filtering, counts per gateway, terminate actions |
| `GatewayInstanceList` | Managed container instances with status, health, restart, log viewing |
| `ScalingControls` | Auto-scaling configuration (enable/disable, min/max, sessions-per-instance) |
| `ContainerLogDialog` | Container logs for a managed gateway instance |
| `SessionTimeoutConfig` | Gateway inactivity session timeout configuration |

### Recording (`client/src/components/Recording/`)

| Component | Purpose |
|-----------|---------|
| `RecordingsDialog` | Full-screen dialog listing session recordings with filter, delete, and playback |
| `RecordingPlayerDialog` | Opens recording player in a popup window |
| `GuacPlayer` | Guacamole session recording player (RDP/VNC replay with playback controls) |
| `SshPlayer` | SSH terminal recording player (asciinema-style with speed/seek) |

### Audit (`client/src/components/Audit/`)

| Component | Purpose |
|-----------|---------|
| `IpGeoCell` | Table cell with IP address, country flag, and geo info tooltip |
| `GeoIpDialog` | Detailed geo-IP location dialog for an audit entry |
| `AuditGeoMap` | Interactive map visualization of audit log geo-locations |
| `auditConstants` | Audit action label constants mapping action codes to human-readable strings |

### Database Client (`client/src/components/DatabaseClient/`)

| Component | Purpose |
|-----------|---------|
| `DbEditor` | Monaco-based database editor with AI-assisted query generation plus protocol-aware SQL and Mongo query templates |
| `DbSchemaBrowser` | Protocol-aware schema browser that adapts labels, hierarchy, and context-menu actions to SQL and Mongo-style databases |
| `DbResultsTable` | Paginated query results table with sorting, column resizing, and export |
| `QueryVisualizer` | Execution plan tree visualization with node cost analysis |
| `AiQueryOptimizer` | Natural-language-to-SQL conversion panel with AI-powered query optimization |
| `DbQueryHistory` | Per-session query execution history with replay and timing |
| `DbConnectionStatus` | Database connection health indicator and protocol info |
| `DbSessionConfigPopover` | Session configuration popover (schema, search path, read-only mode) |
| `ExecutionPlanTree` | Interactive execution plan tree with cost breakdown per node |
| `dbBrowserHelpers` | Shared database-protocol helpers for schema-browser labels, qualified names, and default query/action templates |
| `sqlCompletionProvider` | Monaco intellisense provider with table/column completions from schema |
| `sqlValidation` | Real-time SQL validation markers in the editor |
| `dbQueryHistoryUtils` | Utility functions for query history formatting and filtering |

### Overlays (`client/src/components/Overlays/`)

| Component | Purpose |
|-----------|---------|
| `VaultLockedOverlay` | Overlay when vault is locked — passkey-first re-unlock with password fallback, or TOTP/SMS/password when no passkey is configured |

### Shared (`client/src/components/shared/`, `client/src/components/common/`)

| Component | Purpose |
|-----------|---------|
| `DockedToolbar` | Dockable, draggable action toolbar over active RDP/VNC sessions with sub-action popovers (clipboard, screenshot, keys, fullscreen, disconnect) |
| `ReconnectOverlay` | Reconnection overlay for dropped sessions — shows reconnecting/unstable/failed states with retry |
| `SessionContextMenu` | Right-click context menu for active sessions (copy, paste, screenshot, send keys, fullscreen, file browser, disconnect) |
| `IdentityVerification` | Reusable identity verification flow (email OTP, TOTP, SMS, WebAuthn, password) for sensitive operations |
| `SlideUp` | Shared Slide-up transition component used by all full-screen dialogs |
| `PasswordStrengthMeter` | Password strength meter using zxcvbn with score callback and visual feedback |
| `RecoveryKeyConfirmDialog` | Recovery key display, copy, download, and verification dialog for account setup |

### Root-Level Components

| Component | Purpose |
|-----------|---------|
| `OAuthButtons` | Row of OAuth login/link buttons based on server-provided provider config |
| `UserPicker` | Autocomplete user search for share/invite dialogs |

<!-- manual-start -->
<!-- manual-end -->
