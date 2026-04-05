# User Endpoints

> Auto-generated on 2026-04-05 by /docs create api.
> Source of truth is the codebase. Run /docs update api after code changes.

## User

All endpoints require authentication.

### `GET /api/user/profile`

Get current user's profile.

### `GET /api/user/permissions`

Get the current user's effective permission snapshot for the active tenant. This is the self-read endpoint the SPA uses to hide tenant settings surfaces, including gateway management, when the user lacks edit rights.

### `PUT /api/user/profile`

Update profile (username, avatar).

### `PUT /api/user/password`

Change password.

**Body**: `{ currentPassword, newPassword }`

### `PUT /api/user/ssh-defaults`

Update default SSH terminal settings.

**Body**: `{ theme?, fontFamily?, fontSize?, cursorStyle? }`

### `PUT /api/user/rdp-defaults`

Update default RDP settings.

**Body**: Partial RDP settings object.

### `POST /api/user/avatar`

Upload avatar image.

**Body**: Base64 image data.

### `GET /api/user/search`

Search users by email/username (tenant-scoped).

**Auth**: Tenant member | **Query**: `?q=<search>`

### `GET /api/user/domain-profile`

Get Windows/AD domain profile.

### `PUT /api/user/domain-profile`

Update domain profile.

**Body**: `{ domainName, domainUsername, password? }`

### `DELETE /api/user/domain-profile`

Clear domain profile.

### `POST /api/user/email-change/initiate`

Initiate email change (sends OTP to old and new address). Rate limited.

**Body**: `{ newEmail, password }`

### `POST /api/user/email-change/confirm`

Confirm email change with both OTP codes.

**Body**: `{ oldCode, newCode }`

### `POST /api/user/password-change/initiate`

Initiate password change with identity verification. Rate limited.

**Body**: `{ currentPassword, newPassword }`

### `POST /api/user/identity/initiate`

Initiate identity verification for sensitive operations. Rate limited.

**Body**: `{ password }`

### `POST /api/user/identity/confirm`

Confirm identity verification.

**Body**: `{ code }`

<!-- manual-start -->
<!-- manual-end -->

## Two-Factor Authentication

### TOTP (`/api/user/2fa`)

All endpoints require authentication.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/user/2fa/setup` | Generate TOTP secret and QR code |
| `POST` | `/api/user/2fa/verify` | Verify TOTP code and enable 2FA |
| `POST` | `/api/user/2fa/disable` | Disable TOTP 2FA |
| `GET` | `/api/user/2fa/status` | Get TOTP enabled status |

### SMS MFA (`/api/user/2fa/sms`)

All endpoints require authentication.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/user/2fa/sms/setup-phone` | Set phone number and send verification code. Rate limited. |
| `POST` | `/api/user/2fa/sms/verify-phone` | Verify phone number with code |
| `POST` | `/api/user/2fa/sms/enable` | Enable SMS MFA |
| `POST` | `/api/user/2fa/sms/send-disable-code` | Send disable confirmation code. Rate limited. |
| `POST` | `/api/user/2fa/sms/disable` | Disable SMS MFA with code |
| `GET` | `/api/user/2fa/sms/status` | Get SMS MFA status |

### WebAuthn / Passkeys (`/api/user/2fa/webauthn`)

All endpoints require authentication.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/user/2fa/webauthn/registration-options` | Get registration options for a new credential |
| `POST` | `/api/user/2fa/webauthn/register` | Register a new WebAuthn credential |
| `GET` | `/api/user/2fa/webauthn/credentials` | List registered credentials |
| `DELETE` | `/api/user/2fa/webauthn/credentials/:id` | Remove a credential |
| `PATCH` | `/api/user/2fa/webauthn/credentials/:id` | Rename a credential |
| `GET` | `/api/user/2fa/webauthn/status` | Get WebAuthn enabled status |

<!-- manual-start -->
<!-- manual-end -->
