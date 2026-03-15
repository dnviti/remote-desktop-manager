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

- **OpenTab**: userId + connectionId (unique), sortOrder, isActive. Index: `[userId]`
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
