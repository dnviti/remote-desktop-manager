# Encryption

> Auto-generated on 2026-03-15 by /docs create security.
> Source of truth is the codebase. Run /docs update security after code changes.

## Overview

Arsenale employs a defense-in-depth security model:

1. **Vault encryption** — all credentials encrypted at rest with AES-256-GCM, user-derived keys via Argon2id
2. **JWT authentication** — short-lived access tokens with httpOnly refresh token cookies and CSRF protection
3. **Token binding** — JWT tokens bound to originating IP + User-Agent via SHA-256 hash
4. **Multi-factor authentication** — TOTP, SMS OTP, and WebAuthn/FIDO2 passkeys
5. **Tenant isolation** — multi-tenant RBAC with per-tenant policies
6. **Session limits** — max concurrent sessions and absolute session timeouts (OWASP A07)
7. **IP allowlist** — per-tenant IP/CIDR allowlists with flag or block enforcement modes
8. **DLP policies** — clipboard and file transfer controls for RDP, VNC, and SSH sessions
9. **Audit logging** — 100+ action types with IP and geo-location tracking
10. **Rate limiting** — per-IP and per-user throttling across login, vault, session, OAuth, and SMS endpoints
11. **Security headers** — Helmet with strict CSP, HSTS, and frame protection
12. **Impossible travel detection** — Haversine-based geo-velocity checks with admin notifications
13. **Host validation / SSRF prevention** — DNS resolution and IP range checks block connections to loopback, link-local, and (optionally) private networks
14. **Input validation** — Zod schema validation middleware on all API endpoints
15. **LDAP authentication** — LDAP/LDAPS bind with optional group-based access control and periodic sync

<!-- manual-start -->
<!-- manual-end -->

## Vault Encryption

### Algorithm

- **Cipher**: AES-256-GCM (authenticated encryption)
- **IV length**: 16 bytes (randomly generated per encryption)
- **Key length**: 32 bytes (256 bits)
- **Salt length**: 32 bytes (for key derivation)
- **Auth tag**: Included with every ciphertext for integrity verification

Source: `server/src/services/crypto.service.ts` — constants `ALGORITHM`, `IV_LENGTH`, `KEY_LENGTH`, `SALT_LENGTH`.

### Key Derivation

Master keys are derived from the user's password using Argon2id:

| Parameter | Value |
|-----------|-------|
| **Algorithm** | argon2id |
| **Memory cost** | 65,536 KiB (64 MB) |
| **Time cost** | 3 iterations |
| **Parallelism** | 1 |
| **Hash length** | 32 bytes (256 bits) |

Source: `crypto.service.ts` `deriveKeyFromPassword()` function.

### Master Key Lifecycle

1. **Registration**: A random 32-byte master key is generated (`crypto.randomBytes(KEY_LENGTH)`)
2. **Derivation**: The user's password is combined with a random 32-byte salt via Argon2id to produce a derived key
3. **Encryption**: The master key is encrypted with the derived key using AES-256-GCM
4. **Storage**: The encrypted master key (`encryptedVaultKey`), IV (`vaultKeyIV`), auth tag (`vaultKeyTag`), and salt (`vaultSalt`) are stored in the `User` record
5. **Unlock**: When the user enters their password, the derived key is recreated from the salt, and the master key is decrypted
6. **Session**: The decrypted master key is held in-memory in the vault session store with a configurable TTL

### Encrypted Field Structure

All encrypted data is stored as an `EncryptedField`:

```typescript
interface EncryptedField {
  ciphertext: string;  // hex-encoded AES-256-GCM ciphertext
  iv: string;          // hex-encoded 16-byte initialization vector
  tag: string;         // hex-encoded GCM authentication tag
}
```

In the database, these are stored as three separate columns (e.g., `encryptedUsername`, `usernameIV`, `usernameTag`).

### Recovery Key

During registration, a recovery key is generated (`crypto.randomBytes(32).toString('base64url')`). The master key is encrypted with a key derived from the recovery key (using the same Argon2id parameters) and stored separately. This allows vault recovery during password reset without losing encrypted data.

<!-- manual-start -->
<!-- manual-end -->

## Server-Level Encryption

Some data must be decryptable by the server without user interaction (e.g., SSH key pairs for managed gateways). This uses a separate `SERVER_ENCRYPTION_KEY`:

- 32 bytes (64 hex characters)
- Required in production, auto-generated in development
- Uses the same AES-256-GCM algorithm
- Encrypts: SSH key pairs, vault recovery entries

**Important**: In development, the server encryption key is auto-generated on each startup, meaning SSH key pairs for managed gateways will not survive restarts.

<!-- manual-start -->
<!-- manual-end -->

## Guacamole Token Encryption

RDP/VNC session tokens for guacamole-lite are encrypted with AES-256-GCM:

- Key: `GUACAMOLE_SECRET` (separate from vault keys)
- Token contains: connection parameters (host, port, credentials), display settings, recording config
- The encrypted token is passed via the WebSocket URL
- guacamole-lite decrypts the token to establish the connection
- The server monkey-patches guacamole-lite's Crypt module to properly handle GCM auth tags

<!-- manual-start -->
<!-- manual-end -->
