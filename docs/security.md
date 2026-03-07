# Security

> Auto-generated on 2026-03-07 by `/docs update security`.
> Source of truth is the codebase. Run `/docs update security` after code changes.

## Overview

Arsenale implements defense-in-depth security:

- **Credentials at rest**: AES-256-GCM encryption with per-user master keys
- **Key derivation**: Argon2id from user password
- **Authentication**: JWT access/refresh tokens with automatic refresh and CSRF protection
- **Multi-factor**: TOTP (authenticator app), SMS OTP, and WebAuthn (passkeys/security keys)
- **Identity verification**: Multi-method verification for sensitive operations (email change, password change, admin actions)
- **Account lockout**: Automatic lockout after configurable failed login attempts
- **Audit trail**: All security-relevant actions logged (100+ action types)

Source files: `server/src/services/crypto.service.ts`, `server/src/services/auth.service.ts`, `server/src/services/vault.service.ts`, `server/src/services/identityVerification.service.ts`, `server/src/middleware/auth.middleware.ts`

<!-- manual-start -->
<!-- manual-end -->

## Vault Encryption

### Algorithm

| Parameter | Value | Source |
|-----------|-------|--------|
| Algorithm | AES-256-GCM | `crypto.service.ts` `ALGORITHM` |
| Key length | 32 bytes (256 bits) | `KEY_LENGTH` |
| IV length | 16 bytes | `IV_LENGTH` |
| Salt length | 32 bytes | `SALT_LENGTH` |

### Key Derivation (Argon2id)

| Parameter | Value | Source |
|-----------|-------|--------|
| Type | Argon2id | `argon2.hash()` options |
| Memory cost | 65,536 KiB (64 MB) | `memoryCost` |
| Time cost | 3 iterations | `timeCost` |
| Parallelism | 1 | `parallelism` |
| Hash length | 32 bytes | `hashLength` |
| Output | Raw buffer | `raw: true` |

### Encrypted Field Structure

Each encrypted value is stored as three separate database columns:

```typescript
interface EncryptedField {
  ciphertext: string;  // Hex-encoded encrypted data
  iv: string;          // Hex-encoded 16-byte initialization vector
  tag: string;         // Hex-encoded GCM authentication tag
}
```

### Master Key Lifecycle

```
User Password
      │
      ▼
  Argon2id(password, salt) → Derived Key (32 bytes)
      │
      ▼
  AES-256-GCM Decrypt(encryptedVaultKey, derivedKey) → Master Key (32 bytes)
      │
      ▼
  Stored in-memory (VaultSession Map) with TTL
      │
      ▼
  Used to encrypt/decrypt connection credentials
```

1. **Registration**: Random 32-byte master key generated, encrypted with Argon2-derived key, stored in DB. A recovery key (32 random bytes, base64url) is also generated and encrypted with the master key.
2. **Vault unlock**: Password → Argon2 → derived key → decrypt master key → store in memory
3. **Credential operations**: Master key retrieved from memory to encrypt/decrypt
4. **Vault lock**: Master key buffer zeroed with `.fill(0)`, session deleted

### Vault Recovery Key

A base64url-encoded 32-byte recovery key is generated during registration and stored encrypted in the database using Argon2id-derived key from the recovery key itself:

- `encryptedVaultRecoveryKey` / `vaultRecoveryKeyIV` / `vaultRecoveryKeyTag` — recovery-key-encrypted master key
- `vaultRecoveryKeySalt` — Argon2 salt for recovery key derivation
- Used during password reset to recover the vault without the original password

<!-- manual-start -->
<!-- manual-end -->

## Vault Session Management

### User Vault Sessions

- **Storage**: In-memory `Map<userId, { masterKey: Buffer, expiresAt: number }>`
- **TTL**: Configurable via `VAULT_TTL_MINUTES` (default: 30 minutes). Set to 0 for "never expire".
- **Sliding window**: TTL resets on every `getVaultSession()` call (except "never expire" sessions)
- **Cleanup interval**: Every 60 seconds, expired sessions are found, keys zeroed, entries deleted, auto-lock audit logged
- **Defensive copying**: Master keys are copied (`Buffer.from()`) on store and retrieve to prevent external mutations
- **Tenant enforcement**: `vaultAutoLockMaxMinutes` on Tenant model caps the effective auto-lock timeout

### Vault Recovery (MFA-based Re-unlock)

When a user unlocks their vault, the server also stores a recovery entry:

- **Storage**: Separate in-memory `Map<userId, { encryptedKey: EncryptedField, expiresAt: number }>`
- **Encryption**: Master key encrypted with `SERVER_ENCRYPTION_KEY` (AES-256-GCM)
- **TTL**: Matches refresh token expiry (default: 7 days)
- **Purpose**: Allows MFA-based vault re-unlock (TOTP, SMS, WebAuthn) after vault TTL expires without requiring the user's password
- **Soft lock vs hard lock**: Auto-expiry → soft lock (recovery preserved). Logout or password change → hard lock (recovery cleared).
- **Cleanup**: Expired entries cleaned up every 60 seconds alongside vault sessions

### Team Vault Sessions

- **Storage**: Separate `Map<"${teamId}:${userId}", { teamKey: Buffer, expiresAt: number }>`
- **Same TTL and cleanup** as user vault sessions
- **Team key flow**: Team master key encrypted with user's master key → stored in `TeamMember` table → decrypted and cached in memory on team vault unlock
- **Lock operations**: `lockTeamVault(teamId)` locks all users for a team; `lockUserTeamVaults(userId)` locks all teams for a user

### Tenant Vault Sessions

- **Storage**: Separate `Map<"${tenantId}:${userId}", { tenantKey: Buffer, expiresAt: number }>`
- **Same TTL, sliding window, and cleanup** as user/team vault sessions
- **Tenant key flow**: Tenant master key encrypted with user's master key → stored in `TenantVaultMember` table → decrypted and cached in memory on tenant vault unlock

### Memory Security

- All key buffers are zeroed with `.fill(0)` before deletion
- Defensive copies prevent key leakage through shared references
- Periodic cleanup ensures expired keys don't linger in memory
- No keys are ever written to disk or logs

<!-- manual-start -->
<!-- manual-end -->

## Authentication

### Password Hashing

| Parameter | Value |
|-----------|-------|
| Algorithm | bcrypt |
| Rounds | 12 |

### Account Lockout

| Parameter | Default | Config |
|-----------|---------|--------|
| Threshold | 10 failed attempts | `ACCOUNT_LOCKOUT_THRESHOLD` |
| Duration | 30 minutes | `ACCOUNT_LOCKOUT_DURATION_MS` |

After the threshold is reached, the account is locked and login attempts return `423 Locked`. The lockout is cleared after the duration expires.

### JWT Tokens

**Access Token**:
- Payload: `{ userId, email, tenantId?, tenantRole? }`
- Signing: HMAC-SHA256 with `JWT_SECRET`
- Expiration: Configurable via `JWT_EXPIRES_IN` (default: 15 minutes)

**Refresh Token**:
- Format: UUID v4
- Storage: Database (`RefreshToken` model) with expiration timestamp
- Expiration: Configurable via `JWT_REFRESH_EXPIRES_IN` (default: 7 days)
- **Token family**: Each refresh token belongs to a family. If a revoked token is reused, the entire family is revoked (reuse detection).
- **Rotation**: New refresh token issued on each refresh; old one revoked

**MFA Temporary Token**:
- Payload: `{ userId, email, purpose: 'mfa-verify' }`
- Expiration: 5 minutes
- Used for TOTP, SMS, and WebAuthn verification during login

### CSRF Protection

- CSRF token stored in HTTP-only cookie (`arsenale-csrf`) and returned in login response
- State-changing requests to `/auth/refresh` and `/auth/logout` require `X-CSRF-Token` header
- Cookie settings: `SameSite=Strict`, `Secure` in production, `Path=/api/auth`

### Token Refresh Flow

1. Client receives 401 response
2. Axios interceptor sends `POST /api/auth/refresh` with refresh cookie + CSRF header
3. Server validates token exists in DB, is not expired, and is not revoked
4. Server issues new access token and rotates refresh token
5. Original request is retried with new access token
6. On refresh failure: client calls `authStore.logout()` and redirects to login
7. **Concurrent 401 handling**: Refresh lock ensures only one refresh request at a time; other requests wait for the result

### Socket.IO Authentication

- All Socket.IO namespaces (`/ssh`, `/notifications`, `/gateway-monitor`) use JWT middleware
- Token passed in `socket.handshake.auth.token`
- Verified with same `JWT_SECRET` as HTTP endpoints
- Payload attached to socket as `socket.user`

<!-- manual-start -->
<!-- manual-end -->

## Multi-Factor Authentication

### TOTP (Authenticator App)

1. **Setup**: Server generates random secret, returns QR code URI
2. **Verify**: User enters 6-digit code, server validates with `speakeasy`
3. **Login**: After password verification, `purpose: 'mfa-verify'` temp token issued → user submits TOTP code → real tokens issued
4. **Secret storage**: TOTP secret encrypted with server encryption key (`encryptedTotpSecret`, `totpSecretIV`, `totpSecretTag`)

### SMS OTP

1. **Phone setup**: User provides E.164 phone number → 6-digit code sent via SMS provider
2. **Phone verify**: User submits code → phone marked as verified
3. **Enable**: SMS MFA activated (requires verified phone)
4. **Login**: After password verification, SMS code sent to verified phone → user submits code → real tokens issued

**SMS Providers**: Twilio, AWS SNS, Vonage (configurable via `SMS_PROVIDER` env var). Dev mode logs codes to console.

**Rate Limiting**: SMS endpoints use rate limiting middleware to prevent abuse.

### WebAuthn (Passkeys / Security Keys)

1. **Registration**: Server generates registration options via `@simplewebauthn/server` → user completes browser ceremony → credential stored in DB
2. **Authentication**: Server generates authentication options → user completes browser ceremony → credential verified against stored public key
3. **Challenge storage**: In-memory with 60-second TTL
4. **Credential management**: Users can register multiple credentials, rename them, and remove them
5. **Used for**: Login MFA, vault unlock, and identity verification

**Configuration**: `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_ORIGIN`, `WEBAUTHN_RP_NAME` environment variables.

<!-- manual-start -->
<!-- manual-end -->

## Identity Verification

A reusable system for verifying user identity before sensitive operations.

### Parameters

| Parameter | Value | Source |
|-----------|-------|--------|
| Session TTL | 15 minutes | `SESSION_TTL_MS` |
| Consume window | 5 minutes after confirmation | `CONSUME_WINDOW_MS` |
| Max attempts | 5 | `MAX_ATTEMPTS` |
| OTP length | 6 digits | `OTP_LENGTH` |
| Rate limit | 3 attempts per 15 minutes | `identityRateLimit.middleware.ts` |

### Supported Methods

| Method | Verification |
|--------|-------------|
| `email` | SHA-256 hashed OTP sent to verified email, timing-safe comparison |
| `totp` | Standard TOTP code verification via `speakeasy` |
| `sms` | SMS OTP sent to verified phone, verified via SMS OTP service |
| `webauthn` | WebAuthn authentication ceremony with stored challenge |
| `password` | bcrypt comparison against stored password hash |

### Flow

1. **Initiate**: Client calls `POST /api/user/identity/initiate` with `{ purpose }`
2. **Method selection**: Server selects first available method (priority: email > totp > sms > webauthn > password)
3. **Challenge sent**: OTP/challenge delivered to user
4. **Confirm**: Client calls `POST /api/user/identity/confirm` with verification response
5. **Consume**: The operation endpoint (e.g., password change) consumes the verified session

### Purposes

- `email-change` — Changing user email address
- `password-change` — Changing user password
- `admin-action` — Admin operations (change other user's email/password)

<!-- manual-start -->
<!-- manual-end -->

## Server-Level Encryption

For data the server must decrypt autonomously (without user's vault key):

- **Algorithm**: Same AES-256-GCM
- **Key**: `SERVER_ENCRYPTION_KEY` (32-byte hex, auto-generated in dev)
- **Use cases**: SSH key pairs (`SshKeyPair` model), TOTP secrets, vault recovery entries
- **Production**: Must be a stable, pre-generated key (data won't survive key changes)

<!-- manual-start -->
<!-- manual-end -->

## Connection Sharing Security

When a connection is shared with another user:

1. Sharer's vault must be unlocked (master key in memory)
2. Connection credentials are decrypted with sharer's master key
3. Recipient's master key is retrieved (their vault must also be unlocked)
4. Credentials are re-encrypted with recipient's master key
5. Re-encrypted credentials stored in `SharedConnection` table (including domain field)

This ensures each user's credentials are encrypted with their own unique key, and the sharer cannot access credentials without unlocking their vault.

For team connections, a shared team master key is used, encrypted per-member with each member's personal master key.

### Secret Sharing

Vault secrets follow the same re-encryption pattern:
1. Secret data decrypted with owner's master key (or team/tenant key)
2. Re-encrypted with recipient's master key
3. Stored in `SharedSecret` table

### External Sharing

Public share links use token-derived encryption:
1. Random token generated → hashed with SHA-256 for storage
2. Encryption key derived via HKDF(SHA-256) from token + share ID
3. Optional PIN protection: key derived via Argon2id(token + PIN, salt)
4. Data independently encrypted (separate from vault encryption)
5. Access controls: expiry time, max access count, manual revocation

<!-- manual-start -->
<!-- manual-end -->

## Email Verification

- **Token**: 32 random bytes → 64-character hex string
- **TTL**: 24 hours
- **Storage**: `emailVerifyToken` and `emailVerifyExpiry` on User model
- **Resend cooldown**: 60 seconds between resend requests (silent ignore, prevents enumeration)
- **Providers**: SMTP, SendGrid, Amazon SES, Resend, Mailgun

<!-- manual-start -->
<!-- manual-end -->

## Security Considerations for Production

1. **JWT_SECRET**: Must be a strong random value (≥32 bytes). Generate with `openssl rand -base64 32`
2. **GUACAMOLE_SECRET**: Must match between server config and guacamole-lite. Generate similarly
3. **SERVER_ENCRYPTION_KEY**: Must be stable 64-char hex (32 bytes). Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
4. **POSTGRES_PASSWORD**: Strong random password for database
5. **HTTPS**: Deploy behind a TLS-terminating reverse proxy (not handled by the app)
6. **CORS**: `CLIENT_URL` env var controls allowed origin
7. **Vault TTL**: Adjust `VAULT_TTL_MINUTES` based on security requirements vs. convenience. Tenant admins can enforce a maximum via `vaultAutoLockMaxMinutes`.
8. **Rate limiting**: Identity verification (3/15min), login, and SMS endpoints have built-in rate limiting. Consider adding general API rate limiting for production.
9. **OAuth secrets**: Keep `CLIENT_SECRET` values secure; never expose to client
10. **WebAuthn**: Set `WEBAUTHN_RP_ID` and `WEBAUTHN_RP_ORIGIN` to match your production domain
11. **Account lockout**: Configure `ACCOUNT_LOCKOUT_THRESHOLD` and `ACCOUNT_LOCKOUT_DURATION_MS` for your environment

<!-- manual-start -->
<!-- manual-end -->
