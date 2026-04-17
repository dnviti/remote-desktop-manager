# Supporting Models

> Auto-generated on 2026-03-15 by /docs create database.
> Source of truth is the codebase. Run /docs update database after code changes.

## RefreshToken

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, UUID | |
| token | String | Unique | Refresh token value |
| userId | String | FK -> User (cascade) | Token owner |
| tokenFamily | String | Indexed | Rotation family ID |
| familyCreatedAt | DateTime | Auto | Family creation timestamp (for session age tracking) |
| ipUaHash | String? | Optional | SHA-256 of IP+UserAgent for token binding |
| revokedAt | DateTime? | Optional | Revocation timestamp |
| expiresAt | DateTime | Required | Token expiry |
| createdAt | DateTime | Auto | |

**Indexes**: `[tokenFamily]`, `[userId]`, `[userId, familyCreatedAt]`

<!-- manual-start -->
<!-- manual-end -->

## OAuthAccount

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, UUID | |
| userId | String | FK -> User (cascade), Indexed | |
| provider | AuthProvider | Enum | LOCAL, GOOGLE, MICROSOFT, GITHUB, OIDC, SAML |
| providerUserId | String | Required | External user ID |
| providerEmail | String? | Optional | External email |
| accessToken, refreshToken | String? | Optional | Stored OAuth tokens |
| samlAttributes | Json? | Optional | SAML assertion attributes |

**Unique constraint**: `[provider, providerUserId]`

<!-- manual-start -->
<!-- manual-end -->

## WebAuthnCredential

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, UUID | |
| userId | String | FK -> User (cascade), Indexed | |
| credentialId | String | Unique | WebAuthn credential ID |
| publicKey | String | Required | COSE public key |
| counter | BigInt | Default: 0 | Signature counter |
| transports | String[] | Default: [] | Supported transports |
| deviceType | String? | Optional | Device type |
| backedUp | Boolean | Default: false | Backup eligible |
| friendlyName | String | Default: "Security Key" | Display name |
| aaguid | String? | Optional | Authenticator AAGUID |
| lastUsedAt | DateTime? | Optional | Last authentication |
| createdAt | DateTime | Auto | |

<!-- manual-start -->
<!-- manual-end -->

## Notification

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, UUID | |
| userId | String | FK -> User (cascade) | |
| type | NotificationType | Enum | Event type |
| message | String | Required | Notification text |
| read | Boolean | Default: false | Read status |
| relatedId | String? | Optional | Related entity ID |
| createdAt | DateTime | Auto | |

**Indexes**: `[userId, read]`, `[userId, createdAt]`

<!-- manual-start -->
<!-- manual-end -->

## OpenTab, TenantMember, TenantVaultMember, VaultFolder, AppConfig

- **OpenTab**: per-user persisted tab instances keyed by `id`, with `connectionId`, sortOrder, and isActive. Same-connection duplicates are allowed. Index: `[userId]`
- **TenantMember**: tenantId + userId (unique), role (TenantRole), isActive, `expiresAt` (optional expiry). Indexes: `[userId, isActive]`, `[tenantId, isActive]`, `[expiresAt]`
- **TenantVaultMember**: tenantId + userId (unique), encryptedTenantVaultKey + IV + tag
- **VaultFolder**: self-referential tree, scoped to personal/team/tenant. Indexes: `[userId, scope]`, `[teamId]`, `[tenantId]`
- **AppConfig**: key (PK string), value, updatedAt

<!-- manual-start -->
<!-- manual-end -->

## SyncProfile

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, UUID | |
| name | String | Required | Display name |
| tenantId | String | FK -> Tenant (cascade) | Owning tenant |
| provider | SyncProvider | Enum | e.g., NETBOX |
| config | Json | Required | Provider-specific configuration |
| encryptedApiToken | String | Required | AES-256-GCM encrypted API token |
| apiTokenIV, apiTokenTag | String | Required | |
| cronExpression | String? | Optional | Scheduled sync cron expression |
| enabled | Boolean | Default: true | |
| teamId | String? | FK -> Team (set null) | Optional target team |
| lastSyncAt | DateTime? | Optional | |
| lastSyncStatus | SyncStatus? | Optional | |
| lastSyncDetails | Json? | Optional | |
| createdById | String | FK -> User | Creator |
| createdAt, updatedAt | DateTime | Auto | |

**Indexes**: `[tenantId]`, `[tenantId, provider]`

**Relations**: tenant (Tenant), createdBy (User), team (Team?), connections (Connection[]), syncLogs (SyncLog[])

## SyncLog

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, UUID | |
| syncProfileId | String | FK -> SyncProfile (cascade) | |
| status | SyncStatus | Enum | |
| startedAt | DateTime | Auto | |
| completedAt | DateTime? | Optional | |
| details | Json? | Optional | Sync run details |
| triggeredBy | String | Required | Who triggered the sync |

**Index**: `[syncProfileId, startedAt]`

<!-- manual-start -->
<!-- manual-end -->

## AccessPolicy

Attribute-Based Access Control (ABAC) policies that restrict session access based on contextual attributes. Policies are scoped to a tenant, team, or folder and evaluated additively (most restrictive combination wins).

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, UUID | Unique identifier |
| targetType | AccessPolicyTargetType | Enum | Scope: `TENANT`, `TEAM`, or `FOLDER` |
| targetId | String | Required | ID of the Tenant, Team, or Folder this policy governs |
| allowedTimeWindows | String? | Optional | Comma-separated time windows in `HH:MM-HH:MM` UTC format (e.g., `09:00-18:00`). Null = any time allowed |
| requireTrustedDevice | Boolean | Default: false | Require WebAuthn-authenticated login (trusted device) |
| requireMfaStepUp | Boolean | Default: false | Require MFA step-up (TOTP or WebAuthn) in current session |
| createdAt | DateTime | Auto | |
| updatedAt | DateTime | Auto | |

**Index**: `[targetType, targetId]`

Source: `backend/internal/accesspolicies/service.go`

<!-- manual-start -->
<!-- manual-end -->

## Checkout

Temporary credential checkout/check-in with approval workflow for privileged access management (PAM).

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, UUID | Unique identifier |
| connectionId | String | FK -> Connection | Target connection |
| requestedById | String | FK -> User | Requesting user |
| approvedById | String? | FK -> User | Approving user |
| status | CheckoutStatus | Enum | PENDING, APPROVED, DENIED, ACTIVE, RETURNED, EXPIRED |
| reason | String? | Optional | Justification for access request |
| expiresAt | DateTime | Required | Checkout expiry timestamp |
| checkedInAt | DateTime? | Optional | When credentials were returned |
| createdAt | DateTime | Auto | |
| updatedAt | DateTime | Auto | |

**Indexes**: `[connectionId]`, `[requestedById]`, `[status]`

## KeystrokePolicy

Real-time SSH keystroke inspection and alerting policies.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, UUID | Unique identifier |
| tenantId | String | FK -> Tenant | Owning tenant |
| name | String | Required | Policy name |
| pattern | String | Required | Regex pattern to match keystrokes |
| action | KeystrokePolicyAction | Enum | BLOCK_AND_TERMINATE or ALERT_ONLY |
| enabled | Boolean | Default: true | Policy active state |
| createdAt | DateTime | Auto | |
| updatedAt | DateTime | Auto | |

**Index**: `[tenantId]`

## FirewallRule

SQL firewall rules for database query filtering in the DB proxy.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, UUID | Unique identifier |
| tenantId | String | FK -> Tenant | Owning tenant |
| name | String | Required | Rule name |
| pattern | String | Required | Regex pattern to match SQL queries |
| action | FirewallAction | Enum | BLOCK or ALLOW |
| priority | Int | Default: 0 | Rule evaluation order |
| enabled | Boolean | Default: true | Rule active state |
| createdAt | DateTime | Auto | |
| updatedAt | DateTime | Auto | |

**Index**: `[tenantId, priority]`

## MaskingPolicy

Column-level data masking policies applied after database query execution.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, UUID | Unique identifier |
| tenantId | String | FK -> Tenant | Owning tenant |
| connectionId | String? | FK -> Connection | Optional scoped connection |
| columnPattern | String | Required | Regex pattern for column name matching |
| maskType | MaskingType | Enum | FULL, PARTIAL, HASH, or REDACT |
| enabled | Boolean | Default: true | Policy active state |
| createdAt | DateTime | Auto | |
| updatedAt | DateTime | Auto | |

**Index**: `[tenantId]`

## RateLimitPolicy

Per-connection query rate-limit policies enforced by the DB audit subsystem.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, UUID | Unique identifier |
| tenantId | String | FK -> Tenant | Owning tenant |
| connectionId | String? | FK -> Connection | Optional scoped connection |
| maxQueriesPerMinute | Int | Required | Maximum queries allowed per minute |
| enabled | Boolean | Default: true | Policy active state |
| createdAt | DateTime | Auto | |
| updatedAt | DateTime | Auto | |

**Index**: `[tenantId]`

## DbAuditLog

Database query audit log entries tracking all queries executed through the DB proxy.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, UUID | Unique identifier |
| tenantId | String | FK -> Tenant | Owning tenant |
| userId | String | FK -> User | Executing user |
| connectionId | String | FK -> Connection | Target connection |
| sessionId | String | FK -> ActiveSession | Parent session |
| query | String | Required | Executed SQL query |
| queryHash | String | Required | SHA-256 hash for pattern matching |
| protocol | String | Required | Database protocol (postgresql, mysql, etc.) |
| durationMs | Int | Required | Query execution time in milliseconds |
| rowCount | Int? | Optional | Number of rows returned |
| blocked | Boolean | Default: false | Whether query was blocked by firewall |
| blockedBy | String? | Optional | Firewall rule that blocked the query |
| executionPlan | Json? | Optional | Stored execution plan when persisted |
| createdAt | DateTime | Auto | |

**Indexes**: `[tenantId, createdAt]`, `[connectionId]`, `[userId]`, `[sessionId]`
