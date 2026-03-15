# Core Models

> Auto-generated on 2026-03-15 by /docs create database.
> Source of truth is the codebase. Run /docs update database after code changes.

## User

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, UUID | Unique identifier |
| email | String | Unique | User email address |
| username | String? | Optional | Display name |
| avatarData | String? | Optional | Base64-encoded avatar image |
| passwordHash | String? | Optional | Argon2 hashed password (null for OAuth-only users) |
| vaultSalt | String? | Optional | Salt for vault key derivation |
| encryptedVaultKey | String? | Optional | AES-256-GCM encrypted master key |
| vaultKeyIV | String? | Optional | Vault key initialization vector |
| vaultKeyTag | String? | Optional | Vault key auth tag |
| vaultSetupComplete | Boolean | Default: true | Whether vault encryption is configured |
| sshDefaults | Json? | Optional | Default SSH terminal settings |
| rdpDefaults | Json? | Optional | Default RDP connection settings |
| totpSecret | String? | Optional | Legacy TOTP secret (deprecated) |
| encryptedTotpSecret | String? | Optional | Encrypted TOTP secret |
| totpSecretIV | String? | Optional | TOTP secret IV |
| totpSecretTag | String? | Optional | TOTP secret auth tag |
| totpEnabled | Boolean | Default: false | TOTP 2FA enabled |
| phoneNumber | String? | Optional | Phone number for SMS MFA |
| phoneVerified | Boolean | Default: false | Phone number verified |
| smsMfaEnabled | Boolean | Default: false | SMS MFA enabled |
| smsOtpHash | String? | Optional | Current SMS OTP hash |
| smsOtpExpiresAt | DateTime? | Optional | SMS OTP expiry |
| webauthnEnabled | Boolean | Default: false | WebAuthn/passkey MFA enabled |
| vaultAutoLockMinutes | Int? | Optional | User's vault auto-lock preference |
| domainName | String? | Optional | Windows/AD domain name |
| domainUsername | String? | Optional | Domain username |
| encryptedDomainPassword | String? | Optional | Encrypted domain password |
| domainPasswordIV | String? | Optional | Domain password IV |
| domainPasswordTag | String? | Optional | Domain password auth tag |
| enabled | Boolean | Default: true | Account enabled/disabled |
| emailVerified | Boolean | Default: false | Email verification status |
| emailVerifyToken | String? | Unique | Email verification token |
| emailVerifyExpiry | DateTime? | Optional | Verification token expiry |
| pendingEmail | String? | Optional | Pending email change address |
| emailChangeCodeOldHash | String? | Optional | Email change OTP for old address |
| emailChangeCodeNewHash | String? | Optional | Email change OTP for new address |
| emailChangeExpiry | DateTime? | Optional | Email change expiry |
| passwordResetTokenHash | String? | Unique | Password reset token hash |
| passwordResetExpiry | DateTime? | Optional | Reset token expiry |
| encryptedVaultRecoveryKey | String? | Optional | Encrypted vault recovery key |
| vaultRecoveryKeyIV | String? | Optional | Recovery key IV |
| vaultRecoveryKeyTag | String? | Optional | Recovery key auth tag |
| vaultRecoveryKeySalt | String? | Optional | Recovery key derivation salt |
| failedLoginAttempts | Int | Default: 0 | Failed login counter for lockout |
| lockedUntil | DateTime? | Optional | Account lockout expiry |
| createdAt | DateTime | Auto | Creation timestamp |
| updatedAt | DateTime | Auto | Last update timestamp |

**Relations**: tenantMemberships (TenantMember[]), connections (Connection[]), folders (Folder[]), sharedWithMe (SharedConnection[]), sharedByMe (SharedConnection[]), refreshTokens (RefreshToken[]), oauthAccounts (OAuthAccount[]), auditLogs (AuditLog[]), notifications (Notification[]), teamMembers (TeamMember[]), gatewaysCreated (Gateway[]), gatewayTemplatesCreated (GatewayTemplate[]), openTabs (OpenTab[]), vaultSecrets (VaultSecret[]), secretVersionChanges (VaultSecretVersion[]), vaultFolders (VaultFolder[]), tenantVaultMemberships (TenantVaultMember[]), secretsSharedWithMe (SharedSecret[]), secretsSharedByMe (SharedSecret[]), externalSecretShares (ExternalSecretShare[]), webauthnCredentials (WebAuthnCredential[]), activeSessions (ActiveSession[]), sessionRecordings (SessionRecording[]), syncProfilesCreated (SyncProfile[])

<!-- manual-start -->
<!-- manual-end -->

## Tenant

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, UUID | Unique identifier |
| name | String | Required | Organization name |
| slug | String | Unique | URL-safe identifier |
| hasTenantVaultKey | Boolean | Default: false | Whether tenant vault is initialized |
| mfaRequired | Boolean | Default: false | Mandatory MFA policy |
| vaultAutoLockMaxMinutes | Int? | Optional | Maximum vault auto-lock for members |
| defaultSessionTimeoutSeconds | Int | Default: 3600 | Default session inactivity timeout |
| maxConcurrentSessions | Int | Default: 0 | Max concurrent login sessions per user (0 = unlimited) |
| absoluteSessionTimeoutSeconds | Int | Default: 43200 | Absolute session timeout forcing re-auth (OWASP A07) |
| dlpDisableCopy | Boolean | Default: false | Tenant-level DLP: disable clipboard copy (remote→local) |
| dlpDisablePaste | Boolean | Default: false | Tenant-level DLP: disable clipboard paste (local→remote) |
| dlpDisableDownload | Boolean | Default: false | Tenant-level DLP: disable file download |
| dlpDisableUpload | Boolean | Default: false | Tenant-level DLP: disable file upload |
| enforcedConnectionSettings | Json? | Optional | JSON policy overriding user SSH/RDP/VNC settings |
| ipAllowlistEnabled | Boolean | Default: false | IP allowlist enforcement active |
| ipAllowlistMode | String | Default: "flag" | Enforcement mode: `flag` (audit) or `block` (reject) |
| ipAllowlistEntries | String[] | Default: [] | Allowed IP addresses and CIDR ranges |
| createdAt | DateTime | Auto | Creation timestamp |
| updatedAt | DateTime | Auto | Last update timestamp |

**Relations**: members (TenantMember[]), teams (Team[]), gateways (Gateway[]), gatewayTemplates (GatewayTemplate[]), sshKeyPair (SshKeyPair?), vaultSecrets (VaultSecret[]), tenantVaultMembers (TenantVaultMember[]), syncProfiles (SyncProfile[]), externalVaultProviders (ExternalVaultProvider[])

<!-- manual-start -->
<!-- manual-end -->

## Team

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, UUID | Unique identifier |
| name | String | Required | Team name |
| description | String? | Optional | Team description |
| tenantId | String | FK -> Tenant | Parent tenant |
| createdAt | DateTime | Auto | Creation timestamp |
| updatedAt | DateTime | Auto | Last update timestamp |

**Unique constraint**: `[tenantId, name]`

**Relations**: tenant (Tenant), members (TeamMember[]), connections (Connection[]), folders (Folder[]), vaultSecrets (VaultSecret[]), vaultFolders (VaultFolder[]), syncProfiles (SyncProfile[])

<!-- manual-start -->
<!-- manual-end -->

## TeamMember

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, UUID | Unique identifier |
| teamId | String | FK -> Team (cascade delete) | Parent team |
| userId | String | FK -> User (cascade delete) | Member user |
| role | TeamRole | Enum | Member's role in team |
| encryptedTeamVaultKey | String? | Optional | Encrypted team vault key for this member |
| teamVaultKeyIV | String? | Optional | Team vault key IV |
| teamVaultKeyTag | String? | Optional | Team vault key auth tag |
| joinedAt | DateTime | Auto | Join timestamp |
| expiresAt | DateTime? | Optional | Membership expiry date (null = permanent) |

**Unique constraint**: `[teamId, userId]` | **Index**: `[expiresAt]`

<!-- manual-start -->
<!-- manual-end -->

## Connection

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, UUID | Unique identifier |
| name | String | Required | Display name |
| type | ConnectionType | Enum | SSH, RDP, or VNC |
| host | String | Required | Target hostname/IP |
| port | Int | Required | Target port |
| folderId | String? | FK -> Folder (set null) | Parent folder |
| teamId | String? | FK -> Team | Owning team |
| encryptedUsername | String? | Optional | AES-256-GCM encrypted username |
| usernameIV | String? | Optional | Username IV |
| usernameTag | String? | Optional | Username auth tag |
| encryptedPassword | String? | Optional | Encrypted password |
| passwordIV | String? | Optional | Password IV |
| passwordTag | String? | Optional | Password auth tag |
| encryptedDomain | String? | Optional | Encrypted Windows domain |
| domainIV | String? | Optional | Domain IV |
| domainTag | String? | Optional | Domain auth tag |
| credentialSecretId | String? | FK -> VaultSecret (set null) | Linked keychain secret |
| description | String? | Optional | Connection notes |
| isFavorite | Boolean | Default: false | Favorited by owner |
| enableDrive | Boolean | Default: false | Enable RDP drive redirection |
| sshTerminalConfig | Json? | Optional | Per-connection SSH terminal settings |
| rdpSettings | Json? | Optional | Per-connection RDP settings |
| vncSettings | Json? | Optional | Per-connection VNC settings |
| dlpPolicy | Json? | Optional | Per-connection DLP overrides (most-restrictive wins vs tenant policy) |
| defaultCredentialMode | String? | Optional | Default credential mode (saved/domain/manual) |
| userId | String | FK -> User | Owner |
| gatewayId | String? | FK -> Gateway (set null) | Assigned gateway |
| syncProfileId | String? | FK -> SyncProfile (set null) | Source sync profile (managed by external sync) |
| externalId | String? | Optional | External system identifier (e.g. NetBox device ID) |
| externalVaultProviderId | String? | FK -> ExternalVaultProvider (set null) | External credential provider |
| externalVaultPath | String? | Optional | Path to credentials in the external vault |
| createdAt | DateTime | Auto | Creation timestamp |
| updatedAt | DateTime | Auto | Last update timestamp |

**Index**: `[syncProfileId, externalId]`

**Relations**: folder (Folder?), team (Team?), user (User), gateway (Gateway?), credentialSecret (VaultSecret?), syncProfile (SyncProfile?), externalVaultProvider (ExternalVaultProvider?), shares (SharedConnection[]), openTabs (OpenTab[]), activeSessions (ActiveSession[]), sessionRecordings (SessionRecording[])

<!-- manual-start -->
<!-- manual-end -->

## SharedConnection

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, UUID | Unique identifier |
| connectionId | String | FK -> Connection (cascade) | Shared connection |
| sharedWithUserId | String | FK -> User | Recipient |
| sharedByUserId | String | FK -> User | Sharer |
| permission | Permission | Enum | READ_ONLY or FULL_ACCESS |
| encryptedUsername | String? | Optional | Re-encrypted credentials for recipient |
| usernameIV, usernameTag | String? | Optional | |
| encryptedPassword | String? | Optional | |
| passwordIV, passwordTag | String? | Optional | |
| encryptedDomain | String? | Optional | |
| domainIV, domainTag | String? | Optional | |
| createdAt | DateTime | Auto | Share timestamp |

**Unique constraint**: `[connectionId, sharedWithUserId]`

<!-- manual-start -->
<!-- manual-end -->

## Folder

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, UUID | Unique identifier |
| name | String | Required | Folder name |
| parentId | String? | FK -> Folder (self-relation) | Parent folder for nesting |
| userId | String | FK -> User | Owner |
| teamId | String? | FK -> Team | Owning team |
| sortOrder | Int | Default: 0 | Display order |
| createdAt | DateTime | Auto | Creation timestamp |
| updatedAt | DateTime | Auto | Last update timestamp |

**Relations**: parent (Folder?), children (Folder[]), user (User), team (Team?), connections (Connection[])

<!-- manual-start -->
<!-- manual-end -->
