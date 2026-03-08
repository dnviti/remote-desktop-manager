# Components

> Auto-generated on 2026-03-07 by `/docs update components`.
> Source of truth is the codebase. Run `/docs update components` after code changes.

## Overview

**Client tech stack**: React 19, Vite, Material-UI (MUI) v6, Zustand, Axios, XTerm.js, guacamole-common-js

Source: `client/src/`

<!-- manual-start -->
<!-- manual-end -->

## Pages

### LoginPage

- **Route**: `/login`
- **Purpose**: Multi-step login flow with email/password and MFA support
- **Features**: Standard login form → MFA method selection (TOTP, SMS, WebAuthn) → code entry or passkey ceremony → optional mandatory MFA setup
- **Stores**: `authStore`, `notificationStore`

### RegisterPage

- **Route**: `/register`
- **Purpose**: User registration with email verification
- **Features**: Registration form, email verification, recovery key display
- **Stores**: `authStore`, `notificationStore`

### OAuthCallbackPage

- **Route**: `/oauth/callback`
- **Purpose**: Handle OAuth provider callback redirects
- **Features**: Parses tokens from URL, auto-redirects to dashboard or vault setup
- **Stores**: `authStore`

### VaultSetupPage

- **Route**: `/oauth/vault-setup`
- **Purpose**: Initial vault password setup for OAuth-only users
- **Features**: Password entry form, redirects to dashboard on completion
- **Stores**: `authStore`, `notificationStore`

### ForgotPasswordPage

- **Route**: `/forgot-password`
- **Purpose**: Password reset request
- **Features**: Email input form, sends reset link

### ResetPasswordPage

- **Route**: `/reset-password`
- **Purpose**: Password reset completion
- **Features**: New password form, SMS verification (if MFA enabled), recovery key support

### DashboardPage

- **Route**: `/` (authenticated, catch-all)
- **Purpose**: Main application entry point
- **Features**: Initializes vault status polling, fetches connections and folders, restores persisted tabs
- **Stores**: `connectionsStore`, `vaultStore`, `tabsStore`

### ConnectionViewerPage

- **Route**: `/connection/:id`
- **Purpose**: Popup window mode for SSH/RDP viewer
- **Features**: Full-screen SshTerminal or RdpViewer, independent token refresh for popup windows
- **Stores**: `authStore`, `tabsStore`

### PublicSharePage

- **Route**: `/share/:token`
- **Purpose**: Public external secret share viewer
- **Features**: PIN entry if protected, displays secret data, access count tracking

<!-- manual-start -->
<!-- manual-end -->

## Components

### Layout

#### MainLayout

- **File**: `client/src/components/Layout/MainLayout.tsx`
- **Purpose**: Root layout wrapping the authenticated dashboard
- **Features**: AppBar with notification bell, sidebar with connection tree, tab bar, main content area, full-screen dialog overlays (Settings, AuditLog, Keychain), vault locked overlay
- **Children**: ConnectionTree (sidebar), TabBar, TabPanel, SettingsDialog, AuditLogDialog, KeychainDialog

#### NotificationBell

- **File**: `client/src/components/Layout/NotificationBell.tsx`
- **Purpose**: Notification indicator in the header
- **Features**: Badge with unread count, dropdown list of notifications, mark as read, delete
- **Stores**: `notificationListStore`

<!-- manual-start -->
<!-- manual-end -->

### Sidebar

#### ConnectionTree

- **File**: `client/src/components/Sidebar/ConnectionTree.tsx`
- **Purpose**: Hierarchical tree view of connections and folders
- **Features**: Favorites section, recent connections, personal folders, shared connections, team sections (collapsible), drag-to-reorder, context menu (edit, delete, share), search/filter
- **Stores**: `connectionsStore`, `tabsStore`, `uiPreferencesStore`

#### TeamConnectionSection

- **File**: `client/src/components/Sidebar/TeamConnectionSection.tsx`
- **Purpose**: Expandable section for a team's connections in the sidebar
- **Features**: Collapse state persisted via `uiPreferencesStore`, shows team folders and connections, role-based visibility
- **Stores**: `uiPreferencesStore`

#### treeHelpers

- **File**: `client/src/components/Sidebar/treeHelpers.tsx`
- **Purpose**: Utility functions for building connection tree structure
- **Features**: Recursive tree building, pruning, matching, error handling

<!-- manual-start -->
<!-- manual-end -->

### Tabs

#### TabBar

- **File**: `client/src/components/Tabs/TabBar.tsx`
- **Purpose**: Horizontal tab bar for open connections
- **Features**: Active tab highlighting, close button, connection type icon (SSH/RDP)
- **Stores**: `tabsStore`

#### TabPanel

- **File**: `client/src/components/Tabs/TabPanel.tsx`
- **Purpose**: Content container for each tab
- **Features**: Renders SshTerminal or RdpViewer based on connection type, lazy rendering

<!-- manual-start -->
<!-- manual-end -->

### Terminal / SSH

#### SshTerminal

- **File**: `client/src/components/Terminal/SshTerminal.tsx`
- **Purpose**: SSH terminal emulator
- **Features**: XTerm.js terminal, Socket.IO connection, resize handling, configurable theme/font/cursor, SFTP browser toggle, Guacamole WebSocket support
- **Stores**: `terminalSettingsStore`, `uiPreferencesStore`

#### SftpBrowser

- **File**: `client/src/components/SSH/SftpBrowser.tsx`
- **Purpose**: SFTP file browser panel alongside SSH terminal
- **Features**: Directory listing, navigate, create directory, delete files/dirs, rename, upload/download files
- **Stores**: `uiPreferencesStore`

#### SftpTransferQueue

- **File**: `client/src/components/SSH/SftpTransferQueue.tsx`
- **Purpose**: Upload/download progress queue
- **Features**: Progress bars per transfer, cancel button, clear completed
- **Stores**: `uiPreferencesStore`

<!-- manual-start -->
<!-- manual-end -->

### RDP

#### RdpViewer

- **File**: `client/src/components/RDP/RdpViewer.tsx`
- **Purpose**: RDP remote desktop viewer
- **Features**: Guacamole client rendering, keyboard/mouse input, clipboard sync, connection status, shared drive file browser
- **Stores**: `uiPreferencesStore`

#### FileBrowser

- **File**: `client/src/components/RDP/FileBrowser.tsx`
- **Purpose**: RDP drive redirection file browser
- **Features**: Browse, upload, download files shared via RDP drive redirection
- **Stores**: `uiPreferencesStore`

<!-- manual-start -->
<!-- manual-end -->

### Dialogs

#### ConnectionDialog

- **File**: `client/src/components/Dialogs/ConnectionDialog.tsx`
- **Purpose**: Create/edit connection form
- **Features**: Name, host, port, type (RDP/SSH), credentials or secret picker, domain field (RDP), folder selection, team assignment, drive enable, gateway selection, SSH terminal config, RDP settings
- **Stores**: `connectionsStore`, `notificationStore`

#### FolderDialog

- **File**: `client/src/components/Dialogs/FolderDialog.tsx`
- **Purpose**: Create/rename folder
- **Stores**: `connectionsStore`, `notificationStore`

#### ShareDialog

- **File**: `client/src/components/Dialogs/ShareDialog.tsx`
- **Purpose**: Share a connection with another user
- **Features**: User search (by email), permission selection (READ_ONLY/FULL_ACCESS), list existing shares, update/revoke
- **Stores**: `notificationStore`

#### ShareFolderDialog

- **File**: `client/src/components/Dialogs/ShareFolderDialog.tsx`
- **Purpose**: Share a folder (batch-share all connections within)
- **Stores**: `notificationStore`

#### ConnectAsDialog

- **File**: `client/src/components/Dialogs/ConnectAsDialog.tsx`
- **Purpose**: Override credentials when opening a connection
- **Features**: Username/password/domain input for one-time credential override
- **Stores**: `tabsStore`

#### SettingsDialog

- **File**: `client/src/components/Dialogs/SettingsDialog.tsx`
- **Purpose**: Full-screen settings modal with tabbed sections
- **Features**: Profile, Security (password, 2FA, SMS, WebAuthn), Connections (SSH/RDP defaults), Team, Gateway, Orchestration, Admin sections
- **Pattern**: Full-screen MUI Dialog with SlideUp transition (preserves active sessions)

#### AuditLogDialog

- **File**: `client/src/components/Dialogs/AuditLogDialog.tsx`
- **Purpose**: Full-screen audit log viewer
- **Features**: Filterable by action type, date range, IP, gateway; paginated results; tenant-wide logs for admins
- **Pattern**: Full-screen MUI Dialog with SlideUp transition

#### KeychainDialog

- **File**: `client/src/components/Dialogs/KeychainDialog.tsx`
- **Purpose**: Full-screen secret management
- **Features**: Secret list, create/edit/delete, version history, sharing, external sharing
- **Pattern**: Full-screen MUI Dialog with SlideUp transition
- **Stores**: `secretStore`

#### TeamDialog

- **File**: `client/src/components/Dialogs/TeamDialog.tsx`
- **Purpose**: Create/edit team
- **Stores**: `teamStore`, `notificationStore`

#### CreateUserDialog

- **File**: `client/src/components/Dialogs/CreateUserDialog.tsx`
- **Purpose**: Admin user creation within tenant
- **Features**: Email, username, password, role, welcome email toggle

<!-- manual-start -->
<!-- manual-end -->

### Settings

#### ProfileSection

- **File**: `client/src/components/Settings/ProfileSection.tsx`
- **Purpose**: Username editing and avatar upload

#### ChangePasswordSection

- **File**: `client/src/components/Settings/ChangePasswordSection.tsx`
- **Purpose**: Password change with optional identity verification

#### TerminalSettingsSection

- **File**: `client/src/components/Settings/TerminalSettingsSection.tsx`
- **Purpose**: SSH terminal defaults configuration
- **Features**: Font family, size, line height, letter spacing, cursor style/blink, theme, custom colors, scrollback, bell style
- **Stores**: `terminalSettingsStore`

#### RdpSettingsSection

- **File**: `client/src/components/Settings/RdpSettingsSection.tsx`
- **Purpose**: RDP connection defaults
- **Features**: Color depth, resolution, DPI, resize method, quality preset, wallpaper/theming/font smoothing toggles, audio settings, security mode, keyboard layout
- **Stores**: `rdpSettingsStore`

#### ConnectionDefaultsSection

- **File**: `client/src/components/Settings/ConnectionDefaultsSection.tsx`
- **Purpose**: Global SSH/RDP default settings for new connections

#### TwoFactorSection

- **File**: `client/src/components/Settings/TwoFactorSection.tsx`
- **Purpose**: TOTP authenticator setup/disable
- **Features**: QR code display, 6-digit code verification, enable/disable toggle

#### SmsMfaSection

- **File**: `client/src/components/Settings/SmsMfaSection.tsx`
- **Purpose**: SMS MFA phone setup and management
- **Features**: Phone number input (E.164), verification code entry, enable/disable toggle

#### WebAuthnSection

- **File**: `client/src/components/Settings/WebAuthnSection.tsx`
- **Purpose**: WebAuthn credential registration and management
- **Features**: Register passkeys/security keys, rename, remove, list credentials

#### LinkedAccountsSection

- **File**: `client/src/components/Settings/LinkedAccountsSection.tsx`
- **Purpose**: Manage linked OAuth accounts
- **Features**: List linked providers, link/unlink Google/Microsoft/GitHub/OIDC accounts

#### VaultAutoLockSection

- **File**: `client/src/components/Settings/VaultAutoLockSection.tsx`
- **Purpose**: Vault auto-lock timeout configuration
- **Features**: Slider/input for auto-lock minutes, tenant maximum enforcement display

#### TenantSection

- **File**: `client/src/components/Settings/TenantSection.tsx`
- **Purpose**: Tenant settings (admin only)
- **Features**: Tenant name, MFA requirement toggle, default session timeout, vault auto-lock maximum

#### TeamSection

- **File**: `client/src/components/Settings/TeamSection.tsx`
- **Purpose**: Team creation and member management within settings

#### GatewaySection

- **File**: `client/src/components/Settings/GatewaySection.tsx`
- **Purpose**: Gateway CRUD, SSH key management, scaling controls
- **Features**: Create/edit/delete gateways, generate/rotate SSH keys, test connectivity, managed gateway deployment

#### EmailProviderSection

- **File**: `client/src/components/Settings/EmailProviderSection.tsx`
- **Purpose**: Email provider status and testing (admin)
- **Features**: Shows active provider, configuration status, send test email

#### SelfSignupSection

- **File**: `client/src/components/Settings/SelfSignupSection.tsx`
- **Purpose**: Toggle public registration (admin)
- **Features**: Enable/disable self-signup, environment lock indicator

#### TenantAuditLogSection

- **File**: `client/src/components/Settings/TenantAuditLogSection.tsx`
- **Purpose**: Tenant-wide audit log within settings (admin)

<!-- manual-start -->
<!-- manual-end -->

### Keychain / Secrets

#### SecretListPanel

- **File**: `client/src/components/Keychain/SecretListPanel.tsx`
- **Purpose**: Secret list with filtering and search
- **Features**: Type filter, search, favorites, tags, bulk actions

#### SecretDetailView

- **File**: `client/src/components/Keychain/SecretDetailView.tsx`
- **Purpose**: Secret detail display with type-specific field rendering

#### SecretDialog

- **File**: `client/src/components/Keychain/SecretDialog.tsx`
- **Purpose**: Create/edit secret form
- **Features**: Type selection (LOGIN, SSH_KEY, CERTIFICATE, API_KEY, SECURE_NOTE), scope, folder, tags, expiry

#### SecretPicker

- **File**: `client/src/components/Keychain/SecretPicker.tsx`
- **Purpose**: Dropdown to select a vault secret for connection credentials
- **Features**: Searchable picker used in ConnectionDialog

#### ShareSecretDialog

- **File**: `client/src/components/Keychain/ShareSecretDialog.tsx`
- **Purpose**: Share a secret with a user
- **Features**: User search, permission selection

#### ExternalShareDialog

- **File**: `client/src/components/Keychain/ExternalShareDialog.tsx`
- **Purpose**: Create external public share link
- **Features**: Expiry, max access count, optional PIN protection

#### SecretVersionHistory

- **File**: `client/src/components/Keychain/SecretVersionHistory.tsx`
- **Purpose**: View and restore secret versions

<!-- manual-start -->
<!-- manual-end -->

### Gateway

#### GatewayDialog

- **File**: `client/src/components/gateway/GatewayDialog.tsx`
- **Purpose**: Create/edit gateway form
- **Features**: Type selection, host/port, credentials, health testing, SSH key management

#### GatewayTemplateSection

- **File**: `client/src/components/gateway/GatewayTemplateSection.tsx`
- **Purpose**: Gateway template list with create/edit/delete

#### GatewayTemplateDialog

- **File**: `client/src/components/gateway/GatewayTemplateDialog.tsx`
- **Purpose**: Create/edit gateway template form

<!-- manual-start -->
<!-- manual-end -->

### Orchestration

#### OrchestrationSection

- **File**: `client/src/components/orchestration/OrchestrationSection.tsx`
- **Purpose**: Orchestration dashboard tab selector (sessions, scaling, instances)

#### SessionDashboard

- **File**: `client/src/components/orchestration/SessionDashboard.tsx`
- **Purpose**: Active session list with protocol/gateway filters and terminate action

#### SessionTimeoutConfig

- **File**: `client/src/components/orchestration/SessionTimeoutConfig.tsx`
- **Purpose**: Session timeout configuration UI

#### ScalingControls

- **File**: `client/src/components/orchestration/ScalingControls.tsx`
- **Purpose**: Gateway auto-scaling configuration (min/max replicas, sessions per instance, cooldown)

#### GatewayInstanceList

- **File**: `client/src/components/orchestration/GatewayInstanceList.tsx`
- **Purpose**: Managed gateway instance list with health status, restart, and logs

#### ContainerLogDialog

- **File**: `client/src/components/orchestration/ContainerLogDialog.tsx`
- **Purpose**: Container log viewer for troubleshooting managed instances

<!-- manual-start -->
<!-- manual-end -->

### Common

#### IdentityVerification

- **File**: `client/src/components/common/IdentityVerification.tsx`
- **Purpose**: Reusable identity verification flow
- **Features**: Supports email, TOTP, SMS, WebAuthn, and password methods. Used for email change, password change, and admin actions.

<!-- manual-start -->
<!-- manual-end -->

### Overlays

#### VaultLockedOverlay

- **File**: `client/src/components/Overlays/VaultLockedOverlay.tsx`
- **Purpose**: Full-screen overlay when vault is locked
- **Features**: Password unlock form, MFA unlock methods (TOTP, SMS, WebAuthn)

<!-- manual-start -->
<!-- manual-end -->

### Shared / Utility

#### FloatingToolbar

- **File**: `client/src/components/shared/FloatingToolbar.tsx`
- **Purpose**: Floating action toolbar for RDP/SSH sessions
- **Features**: Extensible action list (clipboard, screenshot, disconnect, fullscreen, settings)

#### OAuthButtons

- **File**: `client/src/components/OAuthButtons.tsx`
- **Purpose**: OAuth provider login/link buttons
- **Features**: Google, Microsoft, GitHub, custom OIDC provider buttons with icons

#### UserPicker

- **File**: `client/src/components/UserPicker.tsx`
- **Purpose**: User search and selection autocomplete
- **Features**: Search by query, display user email/username, select user

<!-- manual-start -->
<!-- manual-end -->

## State Management

### authStore

- **File**: `client/src/store/authStore.ts`
- **Persistence**: localStorage (`arsenale-auth`)
- **State**: `accessToken`, `csrfToken`, `user`, `isAuthenticated`
- **Actions**: `setAuth(accessToken, csrfToken, user)`, `setAccessToken(token)`, `setCsrfToken(token)`, `updateUser(user)`, `logout()`

### connectionsStore

- **File**: `client/src/store/connectionsStore.ts`
- **Persistence**: None (session only)
- **State**: `ownConnections`, `sharedConnections`, `teamConnections`, `folders`, `teamFolders`, `loading`
- **Actions**: `fetchConnections()`, `fetchFolders()`, `toggleFavorite(id)`, `moveConnection(id, folderId)`

### vaultStore

- **File**: `client/src/store/vaultStore.ts`
- **Persistence**: None
- **State**: `unlocked`, `initialized`
- **Actions**: `checkStatus()`, `setUnlocked(bool)`, `startPolling()`, `stopPolling()`
- **Notes**: Polls vault status every 60 seconds

### tabsStore

- **File**: `client/src/store/tabsStore.ts`
- **Persistence**: Debounced server sync (1-second debounce via PUT /api/tabs)
- **State**: `tabs` (array with connection data and optional credential overrides), `activeTabId`, `recentTick`
- **Actions**: `openTab(connection, credentials?)`, `closeTab(id)`, `setActiveTab(id)`, `restoreTabs()`
- **Notes**: Automatic server-side persistence and restoration on page reload

### secretStore

- **File**: `client/src/store/secretStore.ts`
- **Persistence**: None
- **State**: `secrets`, `filters`, `loading`, `tenantVaultStatus`, `expiringCount`
- **Actions**: `fetchSecrets(filters?)`, `createSecret(data)`, `updateSecret(id, data)`, `deleteSecret(id)`, `fetchTenantVaultStatus()`

### teamStore

- **File**: `client/src/store/teamStore.ts`
- **Persistence**: None
- **State**: `teams`, `loading`, `selectedTeam`, `members`, `membersLoading`
- **Actions**: `fetchTeams()`, `createTeam(name, description?)`, `updateTeam(id, data)`, `deleteTeam(id)`, `selectTeam(team)`, `fetchMembers(teamId)`, `addMember(teamId, userId, role)`, `updateMemberRole(teamId, userId, role)`, `removeMember(teamId, userId)`, `reset()`

### tenantStore

- **File**: `client/src/store/tenantStore.ts`
- **Persistence**: None
- **State**: `tenant`, `users`, `loading`, `usersLoading`
- **Actions**: `fetchTenant()`, `createTenant(name)`, `updateTenant(id, data)`, `deleteTenant(id)`, `fetchUsers()`, `inviteUser(email, role)`, `updateUserRole(userId, role)`, `removeUser(userId)`, `reset()`

### gatewayStore

- **File**: `client/src/store/gatewayStore.ts`
- **Persistence**: None
- **State**: `gateways`, `sshKeyPair`, `loading`, `sessions`, `scalingConfig`, `templates`
- **Actions**: Gateway CRUD, SSH key operations, session monitoring, scaling config, template management

### uiPreferencesStore

- **File**: `client/src/store/uiPreferencesStore.ts`
- **Persistence**: localStorage (`arsenale-ui-preferences`)
- **State**: `rdpFileBrowserOpen`, `sshSftpBrowserOpen`, `sshSftpTransferQueueOpen`, `sidebarFavoritesOpen`, `sidebarRecentsOpen`, `sidebarSharedOpen`, `sidebarCompact`, `sidebarTeamSections`, and more
- **Actions**: `set(key, value)`, `toggle(key)`, `toggleTeamSection(teamId)`

### terminalSettingsStore

- **File**: `client/src/store/terminalSettingsStore.ts`
- **Persistence**: None (fetched from server)
- **State**: `userDefaults`, `loaded`, `loading`
- **Actions**: `fetchDefaults()`, `updateDefaults(config)`

### rdpSettingsStore

- **File**: `client/src/store/rdpSettingsStore.ts`
- **Persistence**: None (fetched from server)
- **State**: `userDefaults`, `loaded`, `loading`
- **Actions**: `fetchDefaults()`, `updateDefaults(config)`

### notificationStore

- **File**: `client/src/store/notificationStore.ts`
- **Persistence**: None
- **State**: `notification` (message + severity)
- **Actions**: `notify(message, severity)`, `clear()`
- **Notes**: Transient toast/snackbar notifications

### notificationListStore

- **File**: `client/src/store/notificationListStore.ts`
- **Persistence**: None
- **State**: `notifications`, `unreadCount`, `total`, `loading`
- **Actions**: `fetchNotifications(limit, offset)`, `markAsRead(id)`, `markAllAsRead()`, `removeNotification(id)`, `addNotification(notif)`, `reset()`
- **Notes**: Server-persisted notifications (sharing events, secret expiry)

### themeStore

- **File**: `client/src/store/themeStore.ts`
- **Persistence**: localStorage (`arsenale-theme`)
- **State**: `mode` (`'light'` | `'dark'`)
- **Actions**: `toggle()`

<!-- manual-start -->
<!-- manual-end -->

## Hooks

### useAuth

- **File**: `client/src/hooks/useAuth.ts`
- **Purpose**: Bootstrap authentication from persisted state
- **Behavior**: On mount, if not authenticated, attempts to refresh access token via cookie. Used in popup windows for independent auth.
- **Returns**: `{ isAuthenticated: boolean }`

### useSocket

- **File**: `client/src/hooks/useSocket.ts`
- **Purpose**: Manage Socket.IO connection with JWT authentication
- **Parameters**: `namespace: string` (e.g., `"/ssh"`)
- **Behavior**: Creates Socket.IO connection with `accessToken` in auth, uses `websocket` transport only
- **Returns**: `socketRef` (React ref to Socket instance)

### useSftpTransfers

- **File**: `client/src/hooks/useSftpTransfers.ts`
- **Purpose**: SFTP file upload/download management
- **Parameters**: `socket` (Socket.IO instance)
- **Behavior**: Handles chunked uploads (64KB), assembles downloaded chunks, tracks progress
- **Returns**: `{ transfers, uploadFile, downloadFile, cancelTransfer, clearCompleted }`

### useGatewayMonitor

- **File**: `client/src/hooks/useGatewayMonitor.ts`
- **Purpose**: Gateway monitoring via Socket.IO `/gateway-monitor` namespace
- **Behavior**: Subscribes to health updates, instance changes, and scaling events in real-time
- **Returns**: Gateway health and instance status data

<!-- manual-start -->
<!-- manual-end -->

## API Layer

All API modules use the centralized Axios client from `client/src/api/client.ts`.

| Module | File | Key Functions |
|--------|------|---------------|
| auth | `auth.api.ts` | `loginApi`, `registerApi`, `verifyTotpApi`, `verifySmsApi`, `requestWebAuthnOptions`, `verifyWebAuthn`, `forgotPassword`, `resetPassword`, `refreshApi`, `logoutApi`, `getPublicAuthConfig` |
| user | `user.api.ts` | `getProfile`, `updateProfile`, `changePassword`, `updateSshDefaults`, `updateRdpDefaults`, `uploadAvatar`, `searchUsers`, `initiateEmailChange`, `confirmEmailChange`, `initiateIdentity`, `confirmIdentity` |
| connections | `connections.api.ts` | CRUD operations, `toggleFavorite` |
| folders | `folders.api.ts` | `createFolder`, `getFolders`, `updateFolder`, `deleteFolder` |
| vault | `vault.api.ts` | `unlockVault`, `lockVault`, `getVaultStatus`, `revealPassword`, MFA unlock methods, `getAutoLock`, `setAutoLock` |
| sharing | `sharing.api.ts` | `shareConnection`, `unshareConnection`, `updateSharePermission`, `listShares`, `batchShare` |
| sessions | `sessions.api.ts` | `createRdpSession`, `rdpHeartbeat`, `rdpEnd`, `validateSshAccess`, `listActiveSessions`, `getSessionCount`, `terminateSession` |
| secrets | `secrets.api.ts` | Secret CRUD, versions, sharing, external shares, tenant vault operations |
| twofa | `twofa.api.ts` | `setup2FA`, `verify2FA`, `disable2FA`, `get2FAStatus` |
| smsMfa | `smsMfa.api.ts` | `setupSmsPhone`, `verifySmsPhone`, `enableSmsMfa`, `disableSmsMfa`, `getSmsMfaStatus` |
| webauthn | `webauthn.api.ts` | `getRegistrationOptions`, `registerCredential`, `getCredentials`, `removeCredential`, `renameCredential`, `getStatus` |
| oauth | `oauth.api.ts` | `getOAuthProviders`, `getLinkedAccounts`, `unlinkOAuthAccount`, `setupVaultPassword` |
| passwordReset | `passwordReset.api.ts` | `forgotPassword`, `validateResetToken`, `requestResetSmsCode`, `completePasswordReset` |
| audit | `audit.api.ts` | `getAuditLogs`, `getTenantAuditLogs` (with filtering and pagination) |
| notifications | `notifications.api.ts` | `getNotifications`, `markAsRead`, `markAllAsRead`, `deleteNotification` |
| tenant | `tenant.api.ts` | Tenant CRUD, member management, user create/toggle/email-change/password-change, MFA stats |
| team | `team.api.ts` | Team CRUD, member management with role selection |
| gateway | `gateway.api.ts` | Gateway CRUD, SSH key management, managed instances, scaling, templates |
| email | `email.api.ts` | `resendVerificationEmail` |
| files | `files.api.ts` | Upload (multipart), download, delete user drive files |
| admin | `admin.api.ts` | `getEmailStatus`, `sendTestEmail`, `getAppConfig`, `setSelfSignup` |
| tabs | `tabs.api.ts` | `getTabs`, `syncTabs`, `clearTabs` |

<!-- manual-start -->
<!-- manual-end -->
