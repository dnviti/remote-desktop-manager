# Vault Models

> Auto-generated on 2026-03-15 by /docs create database.
> Source of truth is the codebase. Run /docs update database after code changes.

## VaultSecret

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, UUID | Unique identifier |
| name | String | Required | Secret name |
| description | String? | Optional | Description |
| type | SecretType | Enum | LOGIN, SSH_KEY, CERTIFICATE, API_KEY, SECURE_NOTE |
| scope | SecretScope | Enum | PERSONAL, TEAM, TENANT |
| userId | String | FK -> User | Owner |
| teamId | String? | FK -> Team | Team scope |
| tenantId | String? | FK -> Tenant | Tenant scope |
| folderId | String? | FK -> VaultFolder (set null) | Parent folder |
| encryptedData | String | Required | AES-256-GCM encrypted payload |
| dataIV | String | Required | |
| dataTag | String | Required | |
| metadata | Json? | Optional | Additional metadata |
| tags | String[] | Default: [] | Searchable tags |
| isFavorite | Boolean | Default: false | Favorited |
| expiresAt | DateTime? | Optional | Secret expiry date |
| currentVersion | Int | Default: 1 | Current version number |
| createdAt | DateTime | Auto | |
| updatedAt | DateTime | Auto | |

**Indexes**: `[userId, scope]`, `[teamId]`, `[tenantId, scope]`, `[expiresAt]`, `[expiresAt, userId]`

**Relations**: user (User), team (Team?), tenant (Tenant?), folder (VaultFolder?), versions (VaultSecretVersion[]), shares (SharedSecret[]), externalShares (ExternalSecretShare[]), connections (Connection[])

<!-- manual-start -->
<!-- manual-end -->

## VaultSecretVersion

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, UUID | |
| secretId | String | FK -> VaultSecret (cascade) | Parent secret |
| version | Int | Required | Version number |
| encryptedData | String | Required | Encrypted payload snapshot |
| dataIV | String | Required | |
| dataTag | String | Required | |
| changedBy | String | FK -> User | User who made the change |
| changeNote | String? | Optional | Version note |
| createdAt | DateTime | Auto | |

**Unique constraint**: `[secretId, version]` | **Index**: `[secretId]`

<!-- manual-start -->
<!-- manual-end -->

## SharedSecret

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, UUID | |
| secretId | String | FK -> VaultSecret (cascade) | Shared secret |
| sharedWithUserId | String | FK -> User | Recipient |
| sharedByUserId | String | FK -> User | Sharer |
| permission | Permission | Enum | READ_ONLY or FULL_ACCESS |
| encryptedData | String | Required | Re-encrypted for recipient's key |
| dataIV | String | Required | |
| dataTag | String | Required | |
| createdAt | DateTime | Auto | |

**Unique constraint**: `[secretId, sharedWithUserId]`

<!-- manual-start -->
<!-- manual-end -->

## ExternalSecretShare

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, UUID | |
| secretId | String | FK -> VaultSecret (cascade) | Source secret |
| createdByUserId | String | FK -> User | Creator |
| tokenHash | String | Unique | SHA-256 hash of access token |
| encryptedData | String | Required | Token-derived key encrypted payload |
| dataIV, dataTag | String | Required | |
| hasPin | Boolean | Default: false | PIN protection enabled |
| pinSalt | String? | Optional | Salt for PIN derivation |
| tokenSalt | String? | Optional | Salt for HKDF token derivation |
| expiresAt | DateTime | Required | Share expiry |
| maxAccessCount | Int? | Optional | Maximum access limit |
| accessCount | Int | Default: 0 | Current access count |
| secretType | SecretType | Enum | Type of shared secret |
| secretName | String | Required | Name snapshot |
| isRevoked | Boolean | Default: false | Manually revoked |
| createdAt | DateTime | Auto | |

**Indexes**: `[tokenHash]`, `[expiresAt]`

<!-- manual-start -->
<!-- manual-end -->

## VaultFolder

- Self-referential tree, scoped to personal/team/tenant.
- **Indexes**: `[userId, scope]`, `[teamId]`, `[tenantId]`

<!-- manual-start -->
<!-- manual-end -->

## TenantVaultMember

- tenantId + userId (unique), encryptedTenantVaultKey + IV + tag

<!-- manual-start -->
<!-- manual-end -->

## ExternalVaultProvider

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, UUID | |
| tenantId | String | FK -> Tenant (cascade) | Owning tenant |
| name | String | Required | Display name |
| serverUrl | String | Required | Vault server URL |
| authMethod | ExternalVaultAuthMethod | Enum | TOKEN or APPROLE |
| namespace | String? | Optional | HashiCorp Vault namespace |
| mountPath | String | Default: "secret" | KV v2 mount path |
| encryptedAuthPayload | String | Required | AES-256-GCM encrypted credentials (token or AppRole) |
| authPayloadIV, authPayloadTag | String | Required | Encryption metadata |
| caCertificate | String? | Optional | CA certificate for TLS verification |
| cacheTtlSeconds | Int | Default: 300 | In-memory credential cache TTL |
| enabled | Boolean | Default: true | Provider active |
| createdAt, updatedAt | DateTime | Auto | |

**Unique constraint**: `[tenantId, name]` | **Index**: `[tenantId]`

<!-- manual-start -->
<!-- manual-end -->
