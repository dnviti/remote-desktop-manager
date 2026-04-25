# State Management

> Auto-generated on 2026-04-05 by /docs create components.
> Source of truth is the codebase. Run /docs update components after code changes.

### `authStore` (`client/src/store/authStore.ts`)

| Field | Type | Description |
|-------|------|-------------|
| `accessToken` | string \| null | JWT access token |
| `csrfToken` | string \| null | CSRF token for auth endpoints |
| `user` | object \| null | User identity (id, email, username, avatarData, tenantId, tenantRole, domainName) |
| `isAuthenticated` | boolean | Authentication status |
| `permissions` | object | Effective permission snapshot for the active tenant |
| `permissionsLoaded` | boolean | Whether `/api/user/permissions` has been resolved for the current user and tenant |
| `permissionsLoading` | boolean | Whether the current permission snapshot request is in flight |
| `permissionsSubject` | string \| null | Cache key for the loaded permission snapshot (`userId:tenantId`) |

`permissions`, `accessToken`, and `csrfToken` are intentionally runtime-only and are not persisted to local storage.

**Actions**: `setAuth`, `applySession`, `setAccessToken`, `setCsrfToken`, `updateUser`, `fetchCurrentPermissions`, `clearPermissions`, `fetchDomainProfile`, `logout`

### `connectionsStore` (`client/src/store/connectionsStore.ts`)

| Field | Type | Description |
|-------|------|-------------|
| `ownConnections` | Connection[] | User's own connections |
| `sharedConnections` | Connection[] | Connections shared with user |
| `teamConnections` | Connection[] | Team connections |
| `folders` | Folder[] | User's folders |
| `teamFolders` | Folder[] | Team folders |
| `loading` | boolean | Loading state |

**Actions**: `fetchConnections`, `fetchFolders`, `toggleFavorite`, `moveConnection`, `reset`

### `tabsStore` (`client/src/store/tabsStore.ts`)

| Field | Type | Description |
|-------|------|-------------|
| `tabs` | Tab[] | Open tab instances (stable id, connection, active, optional credentials) |
| `activeTabId` | string \| null | Currently active tab |
| `recentTick` | number | Change counter for re-render triggers |

**Actions**: `openTab`, `closeTab`, `setActiveTab`, `restoreTabs`, `clearAll`. Auto-syncs tab-instance-scoped state to the server with debounce; credential-override tabs stay local-only.

### `vaultStore` (`client/src/store/vaultStore.ts`)

| Field | Type | Description |
|-------|------|-------------|
| `unlocked` | boolean | Vault unlock status |
| `initialized` | boolean | Whether initial status check completed |
| `mfaUnlockAvailable` | boolean | Whether MFA re-unlock is possible |
| `mfaUnlockMethods` | string[] | Available MFA methods for re-unlock |

**Actions**: `checkStatus`, `applyStatus`, `setUnlocked`, `reset`, `handleSocketEvent`

### `uiPreferencesStore` (`client/src/store/uiPreferencesStore.ts`)

Persisted to localStorage via Zustand `persist` middleware (key: `arsenale-ui-preferences`). Namespaced by userId.

Key preferences: `rdpFileBrowserOpen`, `sshSftpBrowserOpen`, `sshSftpTransferQueueOpen`, `sidebarFavoritesOpen`, `sidebarRecentsOpen`, `sidebarSharedOpen`, `sidebarCompact`, `sidebarTeamSections`, `settingsActiveTab`, `keychainScopeFilter`, `keychainTypeFilter`, `keychainSortBy`, `orchestrationDashboardTab`, `orchestrationAutoRefresh`, `auditLog*`, `tenantAuditLog*`, `connAuditLog*`, `lastActiveTenantId`.

**Actions**: `set`, `toggle`, `toggleTeamSection`

### `tenantStore` (`client/src/store/tenantStore.ts`)

| Field | Type | Description |
|-------|------|-------------|
| `tenant` | Tenant \| null | Current tenant details |
| `users` | User[] | Tenant user list |
| `memberships` | Membership[] | User's tenant memberships |
| `loading`, `usersLoading` | boolean | Loading states |

**Actions**: `fetchTenant`, `fetchMemberships`, `switchTenant`, `createTenant`, `updateTenant`, `deleteTenant`, `fetchUsers`, `inviteUser`, `updateUserRole`, `removeUser`, `createUser`, `toggleUserEnabled`, `reset`

### `gatewayStore` (`client/src/store/gatewayStore.ts`)

| Field | Type | Description |
|-------|------|-------------|
| `gateways` | Gateway[] | Tenant gateways, including derived `operationalStatus`, `operationalReason`, and `healthyInstances` |
| `sshKeyPair` | KeyPair \| null | Tenant SSH key pair |
| `activeSessions` | Session[] | Active sessions |
| `sessionCount` | number | Total session count |
| `sessionCountByGateway` | object[] | Sessions per gateway |
| `scalingStatus` | object | Scaling status per gateway |
| `instances` | object | Instances per gateway |
| `templates` | Template[] | Gateway templates |

**Actions**: CRUD for gateways, SSH key pair management, session monitoring, orchestration (deploy, undeploy, scale, instances, scaling config, restart), templates, real-time updates (health, instances, scaling, gateway)

### `teamStore` (`client/src/store/teamStore.ts`)

**State**: `teams`, `selectedTeam`, `members`, loading flags.
**Actions**: CRUD for teams, member management, `reset`.

### `secretStore` (`client/src/store/secretStore.ts`)

**State**: `secrets`, `selectedSecret`, `filters`, `tenantVaultStatus`, `expiringCount`, loading/error.
**Actions**: CRUD for secrets, favorites, filters, tenant vault initialization, expiring count.

### `themeStore` (`client/src/store/themeStore.ts`)

**State**: `mode` ('light' | 'dark'). **Actions**: `toggle`.

### `rdpSettingsStore` / `terminalSettingsStore`

**State**: `userDefaults`, `loaded`, `loading`. **Actions**: `fetchDefaults`, `updateDefaults`.

### `notificationStore` (`client/src/store/notificationStore.ts`)

Ephemeral toast notifications. **State**: `notification` ({message, severity}). **Actions**: `notify`, `clear`.

### `notificationListStore` (`client/src/store/notificationListStore.ts`)

Server-persisted notifications. **State**: `notifications`, `unreadCount`, `total`, `loading`. **Actions**: `fetchNotifications`, `markAsRead`, `markAllAsRead`, `removeNotification`, `addNotification`, `reset`.

### `featureFlagsStore` (`client/src/store/featureFlagsStore.ts`)

| Field | Type | Description |
|-------|------|-------------|
| `connectionsEnabled` | boolean | SSH, RDP, VNC connections and folders |
| `databaseProxyEnabled` | boolean | Database sessions and DB audit |
| `keychainEnabled` | boolean | Vault, secrets, files, external vault providers |
| `recordingsEnabled` | boolean | Session recording APIs and UI |
| `zeroTrustEnabled` | boolean | Gateways, tunnel broker, managed zero-trust routing |
| `agenticAIEnabled` | boolean | AI-assisted database tooling |
| `enterpriseAuthEnabled` | boolean | SAML, OAuth, OIDC, LDAP surfaces |
| `sharingApprovalsEnabled` | boolean | Public sharing, approvals, and checkouts |
| `cliEnabled` | boolean | CLI device auth and CLI-specific APIs |
| `loaded` | boolean | Whether config has been fetched from server |

**Actions**: `loadFromServer`, `reset`. Starts fail-open with all features enabled, then narrows to the server manifest from `GET /api/auth/config`.

### `accessPolicyStore` (`client/src/store/accessPolicyStore.ts`)

**State**: `policies`, `loading`, `error`.
**Actions**: `fetchPolicies`, `createPolicy`, `updatePolicy`, `deletePolicy`, `reset`.

### `checkoutStore` (`client/src/store/checkoutStore.ts`)

**State**: `checkouts`, `pendingCheckouts`, `loading`, `error`.
**Actions**: `fetchCheckouts`, `requestCheckout`, `approveCheckout`, `denyCheckout`, `checkinCheckout`, `reset`.

<!-- manual-start -->
<!-- manual-end -->
