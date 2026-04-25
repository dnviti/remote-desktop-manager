# Vault Endpoints

> Auto-generated on 2026-03-15 by /docs create api.
> Source of truth is the codebase. Run /docs update api after code changes.

## Vault

All endpoints require authentication.

### `POST /api/vault/unlock`

Unlock vault with password.

**Body**: `{ password }` | **Response**: `{ unlocked: true }`

### `POST /api/vault/lock`

Lock vault (soft lock — preserves MFA recovery).

### `GET /api/vault/status`

Get vault lock status and available MFA unlock methods.

**Response**: `{ unlocked, mfaUnlockAvailable, mfaUnlockMethods[] }`

### `POST /api/vault/touch`

Extend the active vault-session TTL after user activity. Returns `unlocked: false` and emits a vault status update if the vault session has already expired.

**Response**: `{ unlocked }`

### `POST /api/vault/reveal-password`

Reveal a connection's decrypted password.

**Body**: `{ connectionId }` | **Response**: `{ password }`

### `POST /api/vault/unlock-mfa/totp`

Unlock vault using TOTP code (requires prior password unlock in session).

**Body**: `{ code }`

### `POST /api/vault/unlock-mfa/webauthn-options`

Get WebAuthn options for vault MFA unlock.

### `POST /api/vault/unlock-mfa/webauthn`

Unlock vault with WebAuthn credential.

**Body**: `{ credential }`

### `POST /api/vault/unlock-mfa/request-sms`

Request SMS code for vault MFA unlock.

### `POST /api/vault/unlock-mfa/sms`

Unlock vault with SMS code.

**Body**: `{ code }`

### `GET /api/vault/auto-lock`

Get vault auto-lock preference.

**Response**: `{ autoLockMinutes, tenantMaxMinutes? }`

### `PUT /api/vault/auto-lock`

Set vault auto-lock preference.

**Body**: `{ minutes }` (0 = never, null = server default)

<!-- manual-start -->
<!-- manual-end -->
