# Database

> Auto-generated on 2026-03-07 by `/docs update database`.
> Source of truth is the codebase. Run `/docs update database` after code changes.

## Overview

- **Provider**: PostgreSQL 16
- **ORM**: Prisma (`server/prisma/schema.prisma`)
- **Generated client**: `server/src/generated/prisma`
- **Connection**: Configured via `DATABASE_URL` environment variable

<!-- manual-start -->
<!-- manual-end -->

## Entity-Relationship Summary

```
Tenant ──1:N──► User ──1:N──► Connection ──1:N──► SharedConnection
  │                │                │
  │                │                ├──N:1──► Folder
  │                │                ├──N:1──► Gateway?
  │                │                ├──N:1──► VaultSecret? (credential)
  │                │                └──1:N──► ActiveSession
  │                │
  │                ├──1:N──► Folder (tree via parentId)
  │                ├──1:N──► RefreshToken
  │                ├──1:N──► OAuthAccount
  │                ├──1:N──► AuditLog
  │                ├──1:N──► Notification
  │                ├──1:N──► TeamMember
  │                ├──1:N──► VaultSecret (owned)
  │                ├──1:N──► VaultFolder
  │                ├──1:N──► OpenTab
  │                ├──1:N──► ActiveSession
  │                ├──1:N──► WebAuthnCredential
  │                └──1:N──► ExternalSecretShare
  │
  ├──1:N──► Team ──1:N──► TeamMember
  │           ├──1:N──► Connection
  │           ├──1:N──► Folder
  │           ├──1:N──► VaultSecret
  │           └──1:N──► VaultFolder
  │
  ├──1:N──► Gateway ──1:N──► ManagedGatewayInstance
  │           ├──1:N──► Connection
  │           └──1:N──► ActiveSession
  │
  ├──1:1──► SshKeyPair
  ├──1:N──► GatewayTemplate
  ├──1:N──► VaultSecret
  └──1:N──► TenantVaultMember

VaultSecret ──1:N──► VaultSecretVersion
           ──1:N──► SharedSecret
           ──1:N──► ExternalSecretShare
```

- A **User** belongs to an optional **Tenant** (organization)
- A **Tenant** has many **Teams**; each **Team** has many **TeamMembers**
- **Connections** can be personal (userId) or team-owned (teamId), optionally linked to a **Gateway** and a **VaultSecret** for credentials
- **Connections** are organized in a hierarchical **Folder** tree
- **SharedConnection** links a connection to a user with a permission level
- **VaultSecrets** support versioning, sharing, and external (public) sharing
- **Gateways** can be managed (container-based) with auto-scaling via **ManagedGatewayInstance**
- **ActiveSession** tracks live SSH/RDP sessions across users, connections, and gateways

<!-- manual-start -->
<!-- manual-end -->

## Models

### Tenant

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | `@id @default(uuid())` | Primary key |
| name | String | | Organization name |
| slug | String | `@unique` | URL-friendly identifier |
| hasTenantVaultKey | Boolean | `@default(false)` | Whether tenant vault key is initialized |
| mfaRequired | Boolean | `@default(false)` | Enforce MFA for all members |
| vaultAutoLockMaxMinutes | Int? | | Max vault auto-lock timeout (overrides user setting) |
| defaultSessionTimeoutSeconds | Int | `@default(3600)` | Default session inactivity timeout |
| createdAt | DateTime | `@default(now())` | Creation timestamp |
| updatedAt | DateTime | `@updatedAt` | Last update timestamp |

**Relations**: `users` (User[]), `teams` (Team[]), `gateways` (Gateway[]), `gatewayTemplates` (GatewayTemplate[]), `sshKeyPair` (SshKeyPair?), `vaultSecrets` (VaultSecret[]), `tenantVaultMembers` (TenantVaultMember[])

<!-- manual-start -->
<!-- manual-end -->

### Team

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | `@id @default(uuid())` | Primary key |
| name | String | | Team name |
| description | String? | | Optional description |
| tenantId | String | FK → Tenant | Parent organization |
| createdAt | DateTime | `@default(now())` | Creation timestamp |
| updatedAt | DateTime | `@updatedAt` | Last update timestamp |

**Relations**: `tenant` (Tenant), `members` (TeamMember[]), `connections` (Connection[]), `folders` (Folder[]), `vaultSecrets` (VaultSecret[]), `vaultFolders` (VaultFolder[])

**Unique constraints**: `@@unique([tenantId, name])` — team names are unique within a tenant

<!-- manual-start -->
<!-- manual-end -->

### TeamMember

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | `@id @default(uuid())` | Primary key |
| teamId | String | FK → Team (cascade delete) | Team reference |
| userId | String | FK → User (cascade delete) | User reference |
| role | TeamRole | | Member's role in team |
| encryptedTeamVaultKey | String? | | Team vault key encrypted with user's master key |
| teamVaultKeyIV | String? | | IV for team vault key encryption |
| teamVaultKeyTag | String? | | Auth tag for team vault key encryption |
| joinedAt | DateTime | `@default(now())` | Join timestamp |

**Relations**: `team` (Team), `user` (User)

**Unique constraints**: `@@unique([teamId, userId])` — one membership per user per team

<!-- manual-start -->
<!-- manual-end -->

### User

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | `@id @default(uuid())` | Primary key |
| email | String | `@unique` | Login email |
| username | String? | | Display name |
| avatarData | String? | | Base64-encoded avatar image |
| passwordHash | String? | | Bcrypt hash (null for OAuth-only users) |
| vaultSalt | String? | | Argon2 salt for key derivation (hex) |
| encryptedVaultKey | String? | | AES-256-GCM encrypted master key |
| vaultKeyIV | String? | | IV for vault key encryption |
| vaultKeyTag | String? | | Auth tag for vault key encryption |
| vaultSetupComplete | Boolean | `@default(true)` | Whether vault has been initialized |
| sshDefaults | Json? | | Default SSH terminal configuration |
| rdpDefaults | Json? | | Default RDP connection settings |
| totpSecret | String? | | TOTP secret (legacy, plain) |
| encryptedTotpSecret | String? | | TOTP secret encrypted with server key |
| totpSecretIV | String? | | IV for TOTP secret encryption |
| totpSecretTag | String? | | Auth tag for TOTP secret encryption |
| totpEnabled | Boolean | `@default(false)` | TOTP 2FA enabled flag |
| phoneNumber | String? | | Phone number for SMS MFA (E.164) |
| phoneVerified | Boolean | `@default(false)` | Phone verification status |
| smsMfaEnabled | Boolean | `@default(false)` | SMS MFA enabled flag |
| smsOtpHash | String? | | Hashed SMS OTP code |
| smsOtpExpiresAt | DateTime? | | SMS OTP expiration |
| webauthnEnabled | Boolean | `@default(false)` | WebAuthn passkey enabled flag |
| vaultAutoLockMinutes | Int? | | User-configured vault auto-lock timeout |
| enabled | Boolean | `@default(true)` | Account enabled/disabled by admin |
| emailVerified | Boolean | `@default(false)` | Email verification status |
| emailVerifyToken | String? | `@unique` | Email verification token (64-char hex) |
| emailVerifyExpiry | DateTime? | | Token expiration (24h) |
| pendingEmail | String? | | New email pending change confirmation |
| emailChangeCodeOldHash | String? | | Hashed OTP sent to old email |
| emailChangeCodeNewHash | String? | | Hashed OTP sent to new email |
| emailChangeExpiry | DateTime? | | Email change OTP expiration |
| passwordResetTokenHash | String? | `@unique` | Hashed password reset token |
| passwordResetExpiry | DateTime? | | Password reset expiration |
| encryptedVaultRecoveryKey | String? | | Server-encrypted vault recovery key for MFA unlock |
| vaultRecoveryKeyIV | String? | | IV for recovery key encryption |
| vaultRecoveryKeyTag | String? | | Auth tag for recovery key encryption |
| vaultRecoveryKeySalt | String? | | Argon2 salt for recovery key derivation |
| failedLoginAttempts | Int | `@default(0)` | Failed login counter for lockout |
| lockedUntil | DateTime? | | Account lockout expiration |
| tenantId | String? | FK → Tenant | Organization membership |
| tenantRole | TenantRole? | | Role within organization |
| createdAt | DateTime | `@default(now())` | Registration timestamp |
| updatedAt | DateTime | `@updatedAt` | Last update timestamp |

**Relations**: `tenant` (Tenant?), `connections` (Connection[]), `folders` (Folder[]), `sharedWithMe` (SharedConnection[]), `sharedByMe` (SharedConnection[]), `refreshTokens` (RefreshToken[]), `oauthAccounts` (OAuthAccount[]), `auditLogs` (AuditLog[]), `notifications` (Notification[]), `teamMembers` (TeamMember[]), `gatewaysCreated` (Gateway[]), `gatewayTemplatesCreated` (GatewayTemplate[]), `openTabs` (OpenTab[]), `vaultSecrets` (VaultSecret[]), `secretVersionChanges` (VaultSecretVersion[]), `vaultFolders` (VaultFolder[]), `tenantVaultMemberships` (TenantVaultMember[]), `secretsSharedWithMe` (SharedSecret[]), `secretsSharedByMe` (SharedSecret[]), `externalSecretShares` (ExternalSecretShare[]), `activeSessions` (ActiveSession[]), `webauthnCredentials` (WebAuthnCredential[])

<!-- manual-start -->
<!-- manual-end -->

### OAuthAccount

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | `@id @default(uuid())` | Primary key |
| userId | String | FK → User (cascade delete) | Account owner |
| provider | AuthProvider | | OAuth provider |
| providerUserId | String | | User ID from provider |
| providerEmail | String? | | Email from provider |
| accessToken | String? | | OAuth access token |
| refreshToken | String? | | OAuth refresh token |
| samlAttributes | Json? | | SAML assertion attributes |
| createdAt | DateTime | `@default(now())` | Link timestamp |
| updatedAt | DateTime | `@updatedAt` | Last update timestamp |

**Relations**: `user` (User)

**Unique constraints**: `@@unique([provider, providerUserId])`

**Indexes**: `@@index([userId])`

<!-- manual-start -->
<!-- manual-end -->

### Folder

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | `@id @default(uuid())` | Primary key |
| name | String | | Folder name |
| parentId | String? | FK → Folder (self-ref) | Parent folder for nesting |
| userId | String | FK → User | Owner |
| teamId | String? | FK → Team | Team ownership (null = personal) |
| sortOrder | Int | `@default(0)` | Display order |
| createdAt | DateTime | `@default(now())` | Creation timestamp |
| updatedAt | DateTime | `@updatedAt` | Last update timestamp |

**Relations**: `parent` (Folder?), `children` (Folder[]), `user` (User), `team` (Team?), `connections` (Connection[])

<!-- manual-start -->
<!-- manual-end -->

### Connection

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | `@id @default(uuid())` | Primary key |
| name | String | | Display name |
| type | ConnectionType | | RDP or SSH |
| host | String | | Hostname or IP |
| port | Int | | Port number |
| folderId | String? | FK → Folder (SetNull on delete) | Parent folder |
| teamId | String? | FK → Team | Team ownership |
| encryptedUsername | String? | | AES-256-GCM encrypted username |
| usernameIV | String? | | IV for username encryption |
| usernameTag | String? | | Auth tag for username |
| encryptedPassword | String? | | AES-256-GCM encrypted password |
| passwordIV | String? | | IV for password encryption |
| passwordTag | String? | | Auth tag for password |
| encryptedDomain | String? | | AES-256-GCM encrypted domain (RDP) |
| domainIV | String? | | IV for domain encryption |
| domainTag | String? | | Auth tag for domain |
| credentialSecretId | String? | FK → VaultSecret (SetNull) | Linked vault secret for credentials |
| description | String? | | Optional description |
| isFavorite | Boolean | `@default(false)` | Favorite flag |
| enableDrive | Boolean | `@default(false)` | RDP drive redirection |
| sshTerminalConfig | Json? | | Per-connection SSH terminal settings |
| rdpSettings | Json? | | Per-connection RDP settings |
| userId | String | FK → User | Owner |
| gatewayId | String? | FK → Gateway (SetNull) | Associated gateway |
| createdAt | DateTime | `@default(now())` | Creation timestamp |
| updatedAt | DateTime | `@updatedAt` | Last update timestamp |

**Relations**: `folder` (Folder?), `team` (Team?), `user` (User), `gateway` (Gateway?), `credentialSecret` (VaultSecret?), `shares` (SharedConnection[]), `openTabs` (OpenTab[]), `activeSessions` (ActiveSession[])

<!-- manual-start -->
<!-- manual-end -->

### Gateway

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | `@id @default(uuid())` | Primary key |
| name | String | | Gateway display name |
| type | GatewayType | | GUACD, SSH_BASTION, or MANAGED_SSH |
| host | String | | Gateway hostname |
| port | Int | | Gateway port |
| description | String? | | Optional description |
| isDefault | Boolean | `@default(false)` | Default gateway for tenant |
| tenantId | String | FK → Tenant | Parent organization |
| createdById | String | FK → User | Creator |
| encryptedUsername | String? | | Encrypted gateway username |
| usernameIV | String? | | IV for username |
| usernameTag | String? | | Auth tag for username |
| encryptedPassword | String? | | Encrypted gateway password |
| passwordIV | String? | | IV for password |
| passwordTag | String? | | Auth tag for password |
| encryptedSshKey | String? | | Encrypted SSH private key |
| sshKeyIV | String? | | IV for SSH key |
| sshKeyTag | String? | | Auth tag for SSH key |
| apiPort | Int? | | API port for managed gateways |
| templateId | String? | FK → GatewayTemplate (SetNull) | Template used for creation |
| isManaged | Boolean | `@default(false)` | Whether instances are container-managed |
| publishPorts | Boolean | `@default(false)` | Expose container ports to host |
| lbStrategy | LoadBalancingStrategy | `@default(ROUND_ROBIN)` | Load balancing strategy |
| desiredReplicas | Int | `@default(1)` | Target number of instances |
| autoScale | Boolean | `@default(false)` | Enable auto-scaling |
| minReplicas | Int | `@default(1)` | Minimum instances |
| maxReplicas | Int | `@default(5)` | Maximum instances |
| sessionsPerInstance | Int | `@default(10)` | Sessions per instance before scaling |
| scaleDownCooldownSeconds | Int | `@default(300)` | Cooldown before scale-down |
| lastScaleAction | DateTime? | | Last scaling event timestamp |
| inactivityTimeoutSeconds | Int | `@default(3600)` | Session inactivity timeout |
| monitoringEnabled | Boolean | `@default(true)` | Health monitoring flag |
| monitorIntervalMs | Int | `@default(5000)` | Health check interval |
| lastHealthStatus | GatewayHealthStatus | `@default(UNKNOWN)` | Latest health status |
| lastCheckedAt | DateTime? | | Last health check timestamp |
| lastLatencyMs | Int? | | Last measured latency |
| lastError | String? | | Last error message |
| createdAt | DateTime | `@default(now())` | Creation timestamp |
| updatedAt | DateTime | `@updatedAt` | Last update timestamp |

**Relations**: `tenant` (Tenant), `createdBy` (User), `template` (GatewayTemplate?), `connections` (Connection[]), `activeSessions` (ActiveSession[]), `managedInstances` (ManagedGatewayInstance[])

**Indexes**: `@@index([tenantId])`, `@@index([tenantId, type, isDefault])`

<!-- manual-start -->
<!-- manual-end -->

### GatewayTemplate

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | `@id @default(uuid())` | Primary key |
| name | String | | Template name |
| type | GatewayType | | Gateway type |
| host | String | | Default host |
| port | Int | | Default port |
| description | String? | | Optional description |
| apiPort | Int? | | Default API port |
| autoScale | Boolean | `@default(false)` | Default auto-scale setting |
| minReplicas | Int | `@default(1)` | Default min replicas |
| maxReplicas | Int | `@default(5)` | Default max replicas |
| sessionsPerInstance | Int | `@default(10)` | Default sessions per instance |
| scaleDownCooldownSeconds | Int | `@default(300)` | Default cooldown |
| monitoringEnabled | Boolean | `@default(true)` | Default monitoring |
| monitorIntervalMs | Int | `@default(5000)` | Default monitor interval |
| inactivityTimeoutSeconds | Int | `@default(3600)` | Default inactivity timeout |
| publishPorts | Boolean | `@default(false)` | Default port publishing |
| lbStrategy | LoadBalancingStrategy | `@default(ROUND_ROBIN)` | Default LB strategy |
| tenantId | String | FK → Tenant | Parent organization |
| createdById | String | FK → User | Creator |
| createdAt | DateTime | `@default(now())` | Creation timestamp |
| updatedAt | DateTime | `@updatedAt` | Last update timestamp |

**Relations**: `tenant` (Tenant), `createdBy` (User), `gateways` (Gateway[])

**Indexes**: `@@index([tenantId])`

<!-- manual-start -->
<!-- manual-end -->

### SshKeyPair

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | `@id @default(uuid())` | Primary key |
| tenantId | String | `@unique` FK → Tenant (cascade delete) | One key pair per tenant |
| encryptedPrivateKey | String | | Server-encrypted private key |
| privateKeyIV | String | | IV for private key encryption |
| privateKeyTag | String | | Auth tag for private key |
| publicKey | String | | Public key (plain text) |
| fingerprint | String | | Key fingerprint |
| algorithm | String | `@default("ed25519")` | Key algorithm |
| expiresAt | DateTime? | | Key expiration date |
| autoRotateEnabled | Boolean | `@default(false)` | Enable automatic rotation |
| rotationIntervalDays | Int | `@default(90)` | Days between rotations |
| lastAutoRotatedAt | DateTime? | | Last auto-rotation timestamp |
| createdAt | DateTime | `@default(now())` | Creation timestamp |
| updatedAt | DateTime | `@updatedAt` | Last update timestamp |

**Relations**: `tenant` (Tenant)

<!-- manual-start -->
<!-- manual-end -->

### SharedConnection

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | `@id @default(uuid())` | Primary key |
| connectionId | String | FK → Connection (cascade delete) | Shared connection |
| sharedWithUserId | String | FK → User | Recipient |
| sharedByUserId | String | FK → User | Sharer |
| permission | Permission | | Access level |
| encryptedUsername | String? | | Re-encrypted username for recipient |
| usernameIV | String? | | IV for re-encrypted username |
| usernameTag | String? | | Auth tag for re-encrypted username |
| encryptedPassword | String? | | Re-encrypted password for recipient |
| passwordIV | String? | | IV for re-encrypted password |
| passwordTag | String? | | Auth tag for re-encrypted password |
| encryptedDomain | String? | | Re-encrypted domain for recipient |
| domainIV | String? | | IV for re-encrypted domain |
| domainTag | String? | | Auth tag for re-encrypted domain |
| createdAt | DateTime | `@default(now())` | Share timestamp |

**Relations**: `connection` (Connection), `sharedWith` (User), `sharedBy` (User)

**Unique constraints**: `@@unique([connectionId, sharedWithUserId])` — one share per user per connection

<!-- manual-start -->
<!-- manual-end -->

### VaultSecret

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | `@id @default(uuid())` | Primary key |
| name | String | | Secret display name |
| description | String? | | Optional description |
| type | SecretType | | LOGIN, SSH_KEY, CERTIFICATE, API_KEY, SECURE_NOTE |
| scope | SecretScope | | PERSONAL, TEAM, or TENANT |
| userId | String | FK → User | Owner |
| teamId | String? | FK → Team | Team scope (if applicable) |
| tenantId | String? | FK → Tenant | Tenant scope (if applicable) |
| folderId | String? | FK → VaultFolder (SetNull) | Parent vault folder |
| encryptedData | String | | AES-256-GCM encrypted secret data |
| dataIV | String | | IV for data encryption |
| dataTag | String | | Auth tag for data encryption |
| metadata | Json? | | Non-sensitive metadata |
| tags | String[] | `@default([])` | Searchable tags |
| isFavorite | Boolean | `@default(false)` | Favorite flag |
| expiresAt | DateTime? | | Secret expiration date |
| currentVersion | Int | `@default(1)` | Current version number |
| createdAt | DateTime | `@default(now())` | Creation timestamp |
| updatedAt | DateTime | `@updatedAt` | Last update timestamp |

**Relations**: `user` (User), `team` (Team?), `tenant` (Tenant?), `folder` (VaultFolder?), `versions` (VaultSecretVersion[]), `shares` (SharedSecret[]), `externalShares` (ExternalSecretShare[]), `connections` (Connection[])

**Indexes**: `@@index([userId, scope])`, `@@index([teamId])`, `@@index([tenantId, scope])`, `@@index([expiresAt])`

<!-- manual-start -->
<!-- manual-end -->

### VaultSecretVersion

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | `@id @default(uuid())` | Primary key |
| secretId | String | FK → VaultSecret (cascade delete) | Parent secret |
| version | Int | | Version number |
| encryptedData | String | | Encrypted version data |
| dataIV | String | | IV for data encryption |
| dataTag | String | | Auth tag for data encryption |
| changedBy | String | FK → User | User who created this version |
| changeNote | String? | | Optional change description |
| createdAt | DateTime | `@default(now())` | Version timestamp |

**Relations**: `secret` (VaultSecret), `changer` (User)

**Unique constraints**: `@@unique([secretId, version])`

**Indexes**: `@@index([secretId])`

<!-- manual-start -->
<!-- manual-end -->

### SharedSecret

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | `@id @default(uuid())` | Primary key |
| secretId | String | FK → VaultSecret (cascade delete) | Shared secret |
| sharedWithUserId | String | FK → User | Recipient |
| sharedByUserId | String | FK → User | Sharer |
| permission | Permission | | Access level |
| encryptedData | String | | Re-encrypted data for recipient |
| dataIV | String | | IV for re-encrypted data |
| dataTag | String | | Auth tag for re-encrypted data |
| createdAt | DateTime | `@default(now())` | Share timestamp |

**Relations**: `secret` (VaultSecret), `sharedWith` (User), `sharedBy` (User)

**Unique constraints**: `@@unique([secretId, sharedWithUserId])`

<!-- manual-start -->
<!-- manual-end -->

### VaultFolder

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | `@id @default(uuid())` | Primary key |
| name | String | | Folder name |
| parentId | String? | FK → VaultFolder (self-ref) | Parent folder for nesting |
| userId | String | FK → User | Owner |
| scope | SecretScope | | PERSONAL, TEAM, or TENANT |
| teamId | String? | FK → Team | Team ownership |
| tenantId | String? | | Tenant ownership |
| sortOrder | Int | `@default(0)` | Display order |
| createdAt | DateTime | `@default(now())` | Creation timestamp |
| updatedAt | DateTime | `@updatedAt` | Last update timestamp |

**Relations**: `parent` (VaultFolder?), `children` (VaultFolder[]), `user` (User), `team` (Team?), `secrets` (VaultSecret[])

**Indexes**: `@@index([userId, scope])`, `@@index([teamId])`, `@@index([tenantId])`

<!-- manual-start -->
<!-- manual-end -->

### TenantVaultMember

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | `@id @default(uuid())` | Primary key |
| tenantId | String | FK → Tenant (cascade delete) | Tenant |
| userId | String | FK → User (cascade delete) | Member |
| encryptedTenantVaultKey | String | | Tenant vault key encrypted with user's master key |
| tenantVaultKeyIV | String | | IV for encryption |
| tenantVaultKeyTag | String | | Auth tag for encryption |
| createdAt | DateTime | `@default(now())` | Creation timestamp |

**Relations**: `tenant` (Tenant), `user` (User)

**Unique constraints**: `@@unique([tenantId, userId])`

<!-- manual-start -->
<!-- manual-end -->

### ExternalSecretShare

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | `@id @default(uuid())` | Primary key |
| secretId | String | FK → VaultSecret (cascade delete) | Shared secret |
| createdByUserId | String | FK → User | Creator |
| tokenHash | String | `@unique` | Hashed access token |
| encryptedData | String | | Independently encrypted data |
| dataIV | String | | IV for data encryption |
| dataTag | String | | Auth tag for data encryption |
| hasPin | Boolean | `@default(false)` | Whether PIN protection is enabled |
| pinSalt | String? | | Salt for PIN-based key derivation |
| tokenSalt | String? | | Salt for token-based key derivation |
| expiresAt | DateTime | | Link expiration |
| maxAccessCount | Int? | | Maximum number of accesses |
| accessCount | Int | `@default(0)` | Current access count |
| secretType | SecretType | | Type of the shared secret |
| secretName | String | | Name snapshot at time of sharing |
| isRevoked | Boolean | `@default(false)` | Manual revocation flag |
| createdAt | DateTime | `@default(now())` | Creation timestamp |

**Relations**: `secret` (VaultSecret), `createdBy` (User)

**Indexes**: `@@index([tokenHash])`, `@@index([expiresAt])`

<!-- manual-start -->
<!-- manual-end -->

### RefreshToken

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | `@id @default(uuid())` | Primary key |
| token | String | `@unique` | Token value (UUID) |
| userId | String | FK → User (cascade delete) | Token owner |
| tokenFamily | String | | Token family for reuse detection |
| revokedAt | DateTime? | | Revocation timestamp (null = active) |
| expiresAt | DateTime | | Expiration timestamp |
| createdAt | DateTime | `@default(now())` | Issue timestamp |

**Relations**: `user` (User)

**Indexes**: `@@index([tokenFamily])`, `@@index([userId])`

<!-- manual-start -->
<!-- manual-end -->

### OpenTab

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | `@id @default(uuid())` | Primary key |
| userId | String | FK → User (cascade delete) | Tab owner |
| connectionId | String | FK → Connection (cascade delete) | Open connection |
| sortOrder | Int | `@default(0)` | Tab order |
| isActive | Boolean | `@default(false)` | Currently selected tab |
| createdAt | DateTime | `@default(now())` | Open timestamp |

**Relations**: `user` (User), `connection` (Connection)

**Unique constraints**: `@@unique([userId, connectionId])`

**Indexes**: `@@index([userId])`

<!-- manual-start -->
<!-- manual-end -->

### ActiveSession

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | `@id @default(uuid())` | Primary key |
| userId | String | FK → User (cascade delete) | Session user |
| connectionId | String | FK → Connection (cascade delete) | Target connection |
| gatewayId | String? | FK → Gateway (SetNull) | Gateway used |
| instanceId | String? | FK → ManagedGatewayInstance (SetNull) | Managed instance used |
| protocol | SessionProtocol | | SSH or RDP |
| status | SessionStatus | `@default(ACTIVE)` | ACTIVE, IDLE, or CLOSED |
| socketId | String? | | Socket.IO socket ID (SSH) |
| guacTokenHash | String? | | Hashed Guacamole token (RDP) |
| startedAt | DateTime | `@default(now())` | Session start |
| lastActivityAt | DateTime | `@default(now())` | Last activity timestamp |
| endedAt | DateTime? | | Session end timestamp |
| metadata | Json? | | Additional session metadata |

**Relations**: `user` (User), `connection` (Connection), `gateway` (Gateway?), `instance` (ManagedGatewayInstance?)

**Indexes**: `@@index([userId, status])`, `@@index([status])`, `@@index([gatewayId, status])`, `@@index([protocol, status])`, `@@index([lastActivityAt])`, `@@index([socketId])`, `@@index([guacTokenHash])`, `@@index([instanceId, status])`

<!-- manual-start -->
<!-- manual-end -->

### AuditLog

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | `@id @default(uuid())` | Primary key |
| userId | String? | FK → User (cascade delete) | Acting user |
| action | AuditAction | | Action type |
| targetType | String? | | Type of target entity |
| targetId | String? | | ID of target entity |
| details | Json? | | Additional context |
| ipAddress | String? | | Client IP address |
| gatewayId | String? | | Associated gateway ID |
| createdAt | DateTime | `@default(now())` | Timestamp |

**Relations**: `user` (User?)

**Indexes**: `@@index([userId])`, `@@index([action])`, `@@index([createdAt])`, `@@index([gatewayId])`

<!-- manual-start -->
<!-- manual-end -->

### Notification

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | `@id @default(uuid())` | Primary key |
| userId | String | FK → User (cascade delete) | Recipient |
| type | NotificationType | | Notification category |
| message | String | | Display message |
| read | Boolean | `@default(false)` | Read status |
| relatedId | String? | | Related entity ID |
| createdAt | DateTime | `@default(now())` | Timestamp |

**Relations**: `user` (User)

**Indexes**: `@@index([userId, read])`, `@@index([userId, createdAt])`

<!-- manual-start -->
<!-- manual-end -->

### WebAuthnCredential

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | `@id @default(uuid())` | Primary key |
| userId | String | FK → User (cascade delete) | Credential owner |
| credentialId | String | `@unique` | WebAuthn credential ID |
| publicKey | String | | Credential public key |
| counter | BigInt | `@default(0)` | Signature counter |
| transports | String[] | `@default([])` | Supported transports |
| deviceType | String? | | Device type identifier |
| backedUp | Boolean | `@default(false)` | Whether credential is backed up |
| friendlyName | String | `@default("Security Key")` | User-assigned name |
| aaguid | String? | | Authenticator Attestation GUID |
| lastUsedAt | DateTime? | | Last authentication timestamp |
| createdAt | DateTime | `@default(now())` | Registration timestamp |

**Relations**: `user` (User)

**Indexes**: `@@index([userId])`

<!-- manual-start -->
<!-- manual-end -->

### ManagedGatewayInstance

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | `@id @default(uuid())` | Primary key |
| gatewayId | String | FK → Gateway (cascade delete) | Parent gateway |
| containerId | String | `@unique` | Container runtime ID |
| containerName | String | | Container name |
| host | String | | Instance hostname |
| port | Int | | Instance port |
| apiPort | Int? | | Instance API port |
| status | ManagedInstanceStatus | `@default(PROVISIONING)` | PROVISIONING, RUNNING, STOPPED, ERROR, REMOVING |
| orchestratorType | String | | Container runtime type |
| healthStatus | String? | | Last health check result |
| lastHealthCheck | DateTime? | | Last health check timestamp |
| errorMessage | String? | | Last error message |
| consecutiveFailures | Int | `@default(0)` | Consecutive health check failures |
| createdAt | DateTime | `@default(now())` | Creation timestamp |
| updatedAt | DateTime | `@updatedAt` | Last update timestamp |

**Relations**: `gateway` (Gateway), `sessions` (ActiveSession[])

**Indexes**: `@@index([gatewayId])`, `@@index([status])`

<!-- manual-start -->
<!-- manual-end -->

### AppConfig

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| key | String | `@id` | Configuration key |
| value | String | | Configuration value |
| updatedAt | DateTime | `@updatedAt` | Last update timestamp |

A key-value store for runtime application settings (e.g., `selfSignupEnabled`).

<!-- manual-start -->
<!-- manual-end -->

## Enums

### TenantRole

| Value | Description |
|-------|-------------|
| `OWNER` | Full control, can delete tenant |
| `ADMIN` | Can manage members and settings |
| `MEMBER` | Basic access |

### TeamRole

| Value | Description |
|-------|-------------|
| `TEAM_ADMIN` | Full team management |
| `TEAM_EDITOR` | Can edit team connections |
| `TEAM_VIEWER` | Read-only access |

### ConnectionType

| Value | Description |
|-------|-------------|
| `RDP` | Remote Desktop Protocol |
| `SSH` | Secure Shell |

### GatewayType

| Value | Description |
|-------|-------------|
| `GUACD` | Guacamole daemon proxy |
| `SSH_BASTION` | SSH jump host |
| `MANAGED_SSH` | Container-managed SSH gateway |

### GatewayHealthStatus

| Value | Description |
|-------|-------------|
| `UNKNOWN` | Not yet checked |
| `REACHABLE` | Health check passed |
| `UNREACHABLE` | Health check failed |

### SessionProtocol

| Value | Description |
|-------|-------------|
| `SSH` | SSH session |
| `RDP` | RDP session |

### SessionStatus

| Value | Description |
|-------|-------------|
| `ACTIVE` | Session in use |
| `IDLE` | Session idle (no recent activity) |
| `CLOSED` | Session ended |

### ManagedInstanceStatus

| Value | Description |
|-------|-------------|
| `PROVISIONING` | Container starting up |
| `RUNNING` | Container healthy and active |
| `STOPPED` | Container stopped |
| `ERROR` | Container in error state |
| `REMOVING` | Container being removed |

### LoadBalancingStrategy

| Value | Description |
|-------|-------------|
| `ROUND_ROBIN` | Distribute evenly across instances |
| `LEAST_CONNECTIONS` | Route to instance with fewest sessions |

### Permission

| Value | Description |
|-------|-------------|
| `READ_ONLY` | View connection details only |
| `FULL_ACCESS` | View and use credentials |

### SecretType

| Value | Description |
|-------|-------------|
| `LOGIN` | Username/password credentials |
| `SSH_KEY` | SSH private/public key pair |
| `CERTIFICATE` | TLS/SSL certificate |
| `API_KEY` | API key or token |
| `SECURE_NOTE` | Free-form encrypted note |

### SecretScope

| Value | Description |
|-------|-------------|
| `PERSONAL` | Owned by individual user |
| `TEAM` | Shared within a team |
| `TENANT` | Organization-wide |

### AuthProvider

| Value | Description |
|-------|-------------|
| `LOCAL` | Email/password registration |
| `GOOGLE` | Google OAuth |
| `MICROSOFT` | Microsoft OAuth |
| `GITHUB` | GitHub OAuth |
| `OIDC` | Generic OpenID Connect |
| `SAML` | SAML 2.0 |

### NotificationType

| Value | Description |
|-------|-------------|
| `CONNECTION_SHARED` | A connection was shared with you |
| `SHARE_PERMISSION_UPDATED` | Share permission was changed |
| `SHARE_REVOKED` | A share was revoked |
| `SECRET_SHARED` | A secret was shared with you |
| `SECRET_SHARE_REVOKED` | Secret share was revoked |
| `SECRET_EXPIRING` | A secret is nearing expiry |
| `SECRET_EXPIRED` | A secret has expired |

### AuditAction

106 action types organized by category:

| Category | Actions |
|----------|---------|
| Authentication | `LOGIN`, `LOGIN_OAUTH`, `LOGIN_TOTP`, `LOGIN_SMS`, `LOGIN_WEBAUTHN`, `LOGIN_FAILURE`, `LOGOUT`, `REGISTER` |
| Password Reset | `PASSWORD_RESET_REQUEST`, `PASSWORD_RESET_COMPLETE`, `PASSWORD_RESET_FAILURE` |
| Vault | `VAULT_UNLOCK`, `VAULT_LOCK`, `VAULT_SETUP`, `VAULT_AUTO_LOCK`, `VAULT_RECOVERY_KEY_GENERATED`, `VAULT_RESET` |
| Connections | `CREATE_CONNECTION`, `UPDATE_CONNECTION`, `DELETE_CONNECTION`, `CONNECTION_FAVORITE` |
| Sharing | `SHARE_CONNECTION`, `UNSHARE_CONNECTION`, `UPDATE_SHARE_PERMISSION`, `BATCH_SHARE` |
| Folders | `CREATE_FOLDER`, `UPDATE_FOLDER`, `DELETE_FOLDER` |
| User | `PASSWORD_CHANGE`, `PROFILE_UPDATE`, `PASSWORD_REVEAL`, `PROFILE_EMAIL_CHANGE` |
| MFA | `TOTP_ENABLE`, `TOTP_DISABLE`, `SMS_MFA_ENABLE`, `SMS_MFA_DISABLE`, `SMS_PHONE_VERIFY`, `WEBAUTHN_REGISTER`, `WEBAUTHN_REMOVE` |
| OAuth | `OAUTH_LINK`, `OAUTH_UNLINK` |
| Tenants | `TENANT_CREATE`, `TENANT_UPDATE`, `TENANT_DELETE`, `TENANT_INVITE_USER`, `TENANT_REMOVE_USER`, `TENANT_UPDATE_USER_ROLE`, `TENANT_CREATE_USER`, `TENANT_TOGGLE_USER`, `TENANT_VAULT_INIT`, `TENANT_VAULT_KEY_DISTRIBUTE`, `TENANT_MFA_POLICY_UPDATE` |
| Teams | `TEAM_CREATE`, `TEAM_UPDATE`, `TEAM_DELETE`, `TEAM_ADD_MEMBER`, `TEAM_REMOVE_MEMBER`, `TEAM_UPDATE_MEMBER_ROLE` |
| Admin | `EMAIL_TEST_SEND`, `APP_CONFIG_UPDATE`, `ADMIN_EMAIL_CHANGE`, `ADMIN_PASSWORD_CHANGE` |
| Gateways | `GATEWAY_CREATE`, `GATEWAY_UPDATE`, `GATEWAY_DELETE`, `GATEWAY_DEPLOY`, `GATEWAY_UNDEPLOY`, `GATEWAY_SCALE`, `GATEWAY_SCALE_UP`, `GATEWAY_SCALE_DOWN`, `GATEWAY_RESTART`, `GATEWAY_VIEW_LOGS`, `GATEWAY_HEALTH_CHECK`, `GATEWAY_RECONCILE` |
| SSH Keys | `SSH_KEY_GENERATE`, `SSH_KEY_ROTATE`, `SSH_KEY_PUSH`, `SSH_KEY_AUTO_ROTATE` |
| Gateway Templates | `GATEWAY_TEMPLATE_CREATE`, `GATEWAY_TEMPLATE_UPDATE`, `GATEWAY_TEMPLATE_DELETE`, `GATEWAY_TEMPLATE_DEPLOY` |
| Sessions | `SESSION_START`, `SESSION_END`, `SESSION_TIMEOUT`, `SESSION_ERROR`, `SESSION_TERMINATE` |
| Secrets | `SECRET_CREATE`, `SECRET_READ`, `SECRET_UPDATE`, `SECRET_DELETE`, `SECRET_SHARE`, `SECRET_UNSHARE`, `SECRET_SHARE_UPDATE`, `SECRET_EXTERNAL_SHARE`, `SECRET_EXTERNAL_ACCESS`, `SECRET_EXTERNAL_REVOKE`, `SECRET_VERSION_RESTORE` |
| SFTP | `SFTP_UPLOAD`, `SFTP_DOWNLOAD`, `SFTP_DELETE`, `SFTP_MKDIR`, `SFTP_RENAME` |
| Tokens | `REFRESH_TOKEN_REUSE` |

<!-- manual-start -->
<!-- manual-end -->

## Indexes and Unique Constraints

| Model | Type | Fields |
|-------|------|--------|
| Tenant | Unique | `slug` |
| Team | Unique | `[tenantId, name]` |
| TeamMember | Unique | `[teamId, userId]` |
| User | Unique | `email` |
| User | Unique | `emailVerifyToken` |
| User | Unique | `passwordResetTokenHash` |
| OAuthAccount | Unique | `[provider, providerUserId]` |
| OAuthAccount | Index | `[userId]` |
| SharedConnection | Unique | `[connectionId, sharedWithUserId]` |
| RefreshToken | Unique | `token` |
| RefreshToken | Index | `[tokenFamily]` |
| RefreshToken | Index | `[userId]` |
| OpenTab | Unique | `[userId, connectionId]` |
| OpenTab | Index | `[userId]` |
| VaultSecret | Index | `[userId, scope]` |
| VaultSecret | Index | `[teamId]` |
| VaultSecret | Index | `[tenantId, scope]` |
| VaultSecret | Index | `[expiresAt]` |
| VaultSecretVersion | Unique | `[secretId, version]` |
| VaultSecretVersion | Index | `[secretId]` |
| SharedSecret | Unique | `[secretId, sharedWithUserId]` |
| TenantVaultMember | Unique | `[tenantId, userId]` |
| ExternalSecretShare | Unique | `tokenHash` |
| ExternalSecretShare | Index | `[tokenHash]` |
| ExternalSecretShare | Index | `[expiresAt]` |
| Gateway | Index | `[tenantId]` |
| Gateway | Index | `[tenantId, type, isDefault]` |
| GatewayTemplate | Index | `[tenantId]` |
| ActiveSession | Index | `[userId, status]` |
| ActiveSession | Index | `[status]` |
| ActiveSession | Index | `[gatewayId, status]` |
| ActiveSession | Index | `[protocol, status]` |
| ActiveSession | Index | `[lastActivityAt]` |
| ActiveSession | Index | `[socketId]` |
| ActiveSession | Index | `[guacTokenHash]` |
| ActiveSession | Index | `[instanceId, status]` |
| AuditLog | Index | `[userId]` |
| AuditLog | Index | `[action]` |
| AuditLog | Index | `[createdAt]` |
| AuditLog | Index | `[gatewayId]` |
| Notification | Index | `[userId, read]` |
| Notification | Index | `[userId, createdAt]` |
| WebAuthnCredential | Unique | `credentialId` |
| WebAuthnCredential | Index | `[userId]` |
| ManagedGatewayInstance | Unique | `containerId` |
| ManagedGatewayInstance | Index | `[gatewayId]` |
| ManagedGatewayInstance | Index | `[status]` |
| SshKeyPair | Unique | `tenantId` |

<!-- manual-start -->
<!-- manual-end -->
