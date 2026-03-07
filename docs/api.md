# API Reference

> Auto-generated on 2026-03-07 by `/docs update api`.
> Source of truth is the codebase. Run `/docs update api` after code changes.

## Overview

All REST endpoints are served under `/api` on port 3001. Authentication uses JWT Bearer tokens unless noted otherwise.

| Route Group | Base Path | Auth Required |
|-------------|-----------|---------------|
| Auth | `/api/auth` | Mostly public |
| OAuth | `/api/auth` | Mixed |
| Vault | `/api/vault` | Yes |
| Connections | `/api/connections` | Yes |
| Folders | `/api/folders` | Yes |
| Sharing | `/api/connections` | Yes |
| Sessions | `/api/sessions` | Yes |
| User | `/api/user` | Yes |
| 2FA (TOTP) | `/api/user/2fa` | Yes |
| SMS MFA | `/api/user/2fa/sms` | Yes |
| WebAuthn | `/api/user/2fa/webauthn` | Yes |
| Files | `/api/files` | Yes |
| Audit | `/api/audit` | Yes |
| Notifications | `/api/notifications` | Yes |
| Tenants | `/api/tenants` | Yes |
| Teams | `/api/teams` | Yes |
| Admin | `/api/admin` | Yes (Admin) |
| Gateways | `/api/gateways` | Yes |
| Tabs | `/api/tabs` | Yes |
| Secrets | `/api/secrets` | Yes |
| Public Share | `/api/share` | No |
| Health | `/api` | No |

<!-- manual-start -->
<!-- manual-end -->

## Authentication

Protected endpoints require the `Authorization` header:

```
Authorization: Bearer <access-token>
```

If the token is expired, the client automatically refreshes via `POST /api/auth/refresh` (cookie-based). State-changing operations (POST, PUT, DELETE) require a CSRF token in the `x-csrf-token` header.

<!-- manual-start -->
<!-- manual-end -->

## Auth (`/api/auth`)

### `GET /api/auth/config`

Public authentication configuration (enabled OAuth providers, MFA options).

- **Auth**: No
- **Response**: `200` `{ providers, emailVerifyRequired, selfSignupEnabled }`

### `POST /api/auth/register`

Register a new user account.

- **Auth**: No
- **Rate limit**: 5 per hour
- **Body**: `{ email: string, password: string }` (password min 8 chars)
- **Response**: `201` `{ message, emailVerifyRequired, recoveryKey }`
- **Errors**: `409` email already exists, `400` validation error

### `GET /api/auth/verify-email`

Verify email address via token link.

- **Auth**: No
- **Query**: `token`
- **Response**: `200` success or error

### `POST /api/auth/resend-verification`

Resend email verification.

- **Auth**: No
- **Response**: `200` `{ message }`

### `POST /api/auth/login`

Authenticate with email and password.

- **Auth**: No
- **Body**: `{ email: string, password: string }`
- **Response**: `200` `{ accessToken, csrfToken, user }` or `{ requiresMFA, methods, tempToken }` if MFA enabled
- **Errors**: `401` invalid credentials, `403` email not verified, `423` account locked

### `POST /api/auth/verify-totp`

Verify TOTP code during MFA login.

- **Auth**: No
- **Body**: `{ tempToken: string, code: string }` (code: exactly 6 digits)
- **Response**: `200` `{ accessToken, csrfToken, user }`
- **Errors**: `401` invalid code or token

### `POST /api/auth/request-sms-code`

Request SMS verification code during MFA login.

- **Auth**: No
- **Body**: `{ tempToken: string }`
- **Response**: `200` `{ message: "SMS code sent" }`
- **Errors**: `401` invalid token, `429` rate limited

### `POST /api/auth/verify-sms`

Verify SMS code during MFA login.

- **Auth**: No
- **Body**: `{ tempToken: string, code: string }` (code: exactly 6 digits)
- **Response**: `200` `{ accessToken, csrfToken, user }`
- **Errors**: `401` invalid code or token

### `POST /api/auth/request-webauthn-options`

Request WebAuthn authentication options during MFA login.

- **Auth**: No
- **Response**: `200` WebAuthn authentication options

### `POST /api/auth/verify-webauthn`

Verify WebAuthn credential during MFA login.

- **Auth**: No
- **Body**: `{ credential }` (WebAuthn assertion response)
- **Response**: `200` `{ accessToken, csrfToken, user }`
- **Errors**: `401` invalid credential

### `POST /api/auth/mfa-setup/init`

Initialize mandatory MFA setup (during first login when tenant requires MFA).

- **Auth**: No (temp token)
- **Response**: `200` MFA setup options (TOTP secret, QR URI)

### `POST /api/auth/mfa-setup/verify`

Complete mandatory MFA setup with verification code.

- **Auth**: No (temp token)
- **Body**: `{ code: string }`
- **Response**: `200` `{ accessToken, csrfToken, user }`

### `POST /api/auth/forgot-password`

Request a password reset email.

- **Auth**: No
- **Body**: `{ email: string }`
- **Response**: `200` `{ message }`

### `POST /api/auth/reset-password/validate`

Validate a password reset token.

- **Auth**: No
- **Body**: `{ token: string }`
- **Response**: `200` `{ valid, requiresSmsVerification }`

### `POST /api/auth/reset-password/request-sms`

Request SMS code for password reset verification.

- **Auth**: No
- **Body**: `{ token: string }`
- **Response**: `200` `{ message }`

### `POST /api/auth/reset-password/complete`

Complete password reset with new password.

- **Auth**: No
- **Body**: `{ token, password, smsCode?, recoveryKey? }`
- **Response**: `200` `{ message, recoveryKey }`

### `POST /api/auth/refresh`

Refresh an expired access token using HTTP-only cookie.

- **Auth**: No (cookie-based)
- **Response**: `200` `{ accessToken, csrfToken, user }`
- **Errors**: `401` invalid or expired refresh token

### `POST /api/auth/logout`

Log out and revoke refresh token.

- **Auth**: No (cookie-based)
- **Response**: `200` `{ message }`

<!-- manual-start -->
<!-- manual-end -->

## OAuth (`/api/auth`)

### `GET /api/auth/oauth/providers`

List available OAuth providers.

- **Auth**: No
- **Response**: `200` `[{ name, enabled }]`

### `GET /api/auth/:provider`

Initiate OAuth flow (redirect to provider).

- **Auth**: No
- **Providers**: `google`, `microsoft`, `github`, `oidc`

### `GET /api/auth/:provider/callback`

OAuth callback handler (redirects client with tokens).

- **Auth**: No

### `GET /api/auth/oauth/link/:provider`

Initiate OAuth account linking.

- **Auth**: Yes (via query JWT)

### `GET /api/auth/oauth/accounts`

List linked OAuth accounts.

- **Auth**: Yes
- **Response**: `200` `[{ provider, providerEmail, createdAt }]`

### `DELETE /api/auth/oauth/link/:provider`

Unlink an OAuth account.

- **Auth**: Yes
- **Response**: `200` `{ message }`

### `POST /api/auth/oauth/vault-setup`

Set up vault password for OAuth-only users.

- **Auth**: Yes
- **Body**: `{ password: string }`
- **Response**: `200` `{ recoveryKey }`

<!-- manual-start -->
<!-- manual-end -->

## Vault (`/api/vault`)

### `POST /api/vault/unlock`

Unlock vault with password.

- **Auth**: Yes
- **Body**: `{ password: string }`
- **Response**: `200` `{ locked: false, sessionExpiry }`

### `POST /api/vault/lock`

Lock vault (clear session).

- **Auth**: Yes
- **Response**: `200` `{ locked: true }`

### `GET /api/vault/status`

Check vault lock status.

- **Auth**: Yes
- **Response**: `200` `{ locked, sessionExpiry?, availableMethods? }`

### `POST /api/vault/reveal-password`

Decrypt and reveal a connection password.

- **Auth**: Yes (vault must be unlocked)
- **Body**: `{ connectionId: string, password?: string }`
- **Response**: `200` `{ username, password, domain? }`

### `POST /api/vault/unlock-mfa/totp`

Unlock vault using TOTP code (via recovery key).

- **Auth**: Yes
- **Body**: `{ code: string }` (6 digits)
- **Response**: `200` `{ locked: false, sessionExpiry }`

### `POST /api/vault/unlock-mfa/webauthn-options`

Get WebAuthn authentication options for vault unlock.

- **Auth**: Yes
- **Response**: `200` WebAuthn options

### `POST /api/vault/unlock-mfa/webauthn`

Unlock vault using WebAuthn credential.

- **Auth**: Yes
- **Body**: `{ credential }` (WebAuthn assertion)
- **Response**: `200` `{ locked: false, sessionExpiry }`

### `POST /api/vault/unlock-mfa/request-sms`

Request SMS code for vault unlock.

- **Auth**: Yes
- **Response**: `200` `{ sent: true }`

### `POST /api/vault/unlock-mfa/sms`

Unlock vault using SMS code.

- **Auth**: Yes
- **Body**: `{ code: string }` (6 digits)
- **Response**: `200` `{ locked: false, sessionExpiry }`

### `GET /api/vault/auto-lock`

Get vault auto-lock preference.

- **Auth**: Yes
- **Response**: `200` `{ autoLockMinutes, effectiveAutoLockMinutes, tenantMaxMinutes? }`

### `PUT /api/vault/auto-lock`

Set vault auto-lock timeout.

- **Auth**: Yes
- **Body**: `{ autoLockMinutes: number | null }`
- **Response**: `200` updated preference

<!-- manual-start -->
<!-- manual-end -->

## Connections (`/api/connections`)

### `GET /api/connections`

List all connections (own + shared + team).

- **Auth**: Yes
- **Response**: `200` `{ own: [...], shared: [...], team: [...] }`

### `POST /api/connections`

Create a new connection.

- **Auth**: Yes (vault must be unlocked)
- **Body**: `{ name, type (RDP|SSH), host, port (1-65535), username?, password?, domain?, credentialSecretId?, description?, folderId?, teamId?, enableDrive?, gatewayId?, sshTerminalConfig?, rdpSettings? }`
- **Response**: `201` created connection
- **Notes**: Must provide either `credentialSecretId` OR `username`+`password`

### `GET /api/connections/:id`

Get connection details.

- **Auth**: Yes
- **Response**: `200` connection object

### `PUT /api/connections/:id`

Update a connection.

- **Auth**: Yes (vault must be unlocked)
- **Body**: Same fields as create (all optional)
- **Response**: `200` updated connection

### `DELETE /api/connections/:id`

Delete a connection.

- **Auth**: Yes
- **Response**: `200` `{ message }`

### `PATCH /api/connections/:id/favorite`

Toggle favorite status.

- **Auth**: Yes
- **Response**: `200` `{ isFavorite }`

<!-- manual-start -->
<!-- manual-end -->

## Sharing (`/api/connections`)

### `POST /api/connections/batch-share`

Share multiple connections at once.

- **Auth**: Yes (vault must be unlocked)
- **Body**: `{ connectionIds: string[] (max 50), target: { email? | userId? }, permission (READ_ONLY|FULL_ACCESS), folderName? }`
- **Response**: `200` `{ shared: [...], failed: [...] }`

### `POST /api/connections/:id/share`

Share a connection with a user.

- **Auth**: Yes (vault must be unlocked)
- **Body**: `{ email? | userId?, permission (READ_ONLY|FULL_ACCESS) }`
- **Response**: `201` share details

### `DELETE /api/connections/:id/share/:userId`

Revoke a share.

- **Auth**: Yes
- **Response**: `200` `{ message }`

### `PUT /api/connections/:id/share/:userId`

Update share permission.

- **Auth**: Yes
- **Body**: `{ permission (READ_ONLY|FULL_ACCESS) }`
- **Response**: `200` updated share

### `GET /api/connections/:id/shares`

List all shares for a connection.

- **Auth**: Yes
- **Response**: `200` `[{ user, permission, createdAt }]`

<!-- manual-start -->
<!-- manual-end -->

## Folders (`/api/folders`)

### `GET /api/folders`

List all folders.

- **Auth**: Yes
- **Response**: `200` folder tree

### `POST /api/folders`

Create a folder.

- **Auth**: Yes
- **Body**: `{ name, parentId?, teamId? }`
- **Response**: `201` created folder

### `PUT /api/folders/:id`

Update a folder.

- **Auth**: Yes
- **Body**: `{ name?, parentId? }`
- **Response**: `200` updated folder

### `DELETE /api/folders/:id`

Delete a folder.

- **Auth**: Yes
- **Response**: `200` `{ message }`

<!-- manual-start -->
<!-- manual-end -->

## Sessions (`/api/sessions`)

### `POST /api/sessions/rdp`

Create an RDP session token for Guacamole.

- **Auth**: Yes (vault must be unlocked)
- **Body**: `{ connectionId, username?, password?, domain? }`
- **Response**: `200` `{ token, sessionId }`

### `POST /api/sessions/rdp/:sessionId/heartbeat`

Send RDP session heartbeat.

- **Auth**: Yes
- **Response**: `200` heartbeat acknowledged

### `POST /api/sessions/rdp/:sessionId/end`

End an RDP session.

- **Auth**: Yes
- **Response**: `200` session ended

### `POST /api/sessions/ssh`

Validate SSH access and create session record.

- **Auth**: Yes
- **Body**: `{ connectionId }`
- **Response**: `200` validation result

### `GET /api/sessions/active`

List active sessions (tenant admin only).

- **Auth**: Yes (Tenant ADMIN+)
- **Query**: `protocol?, gatewayId?`
- **Response**: `200` active sessions array

### `GET /api/sessions/count`

Get total active session count.

- **Auth**: Yes (Tenant ADMIN+)
- **Response**: `200` `{ count }`

### `GET /api/sessions/count/gateway`

Get active session counts grouped by gateway.

- **Auth**: Yes (Tenant ADMIN+)
- **Response**: `200` `[{ gatewayId, count }]`

### `POST /api/sessions/:sessionId/terminate`

Forcefully terminate a session.

- **Auth**: Yes (Tenant ADMIN+)
- **Response**: `200` termination result

<!-- manual-start -->
<!-- manual-end -->

## User (`/api/user`)

### `GET /api/user/profile`

Get current user profile.

- **Auth**: Yes
- **Response**: `200` `{ id, email, username, avatarData?, tenantId?, tenantRole?, totpEnabled, smsMfaEnabled, webauthnEnabled, vaultSetupComplete }`

### `PUT /api/user/profile`

Update profile.

- **Auth**: Yes
- **Body**: `{ username?: string }`
- **Response**: `200` updated profile

### `GET /api/user/search`

Search users within tenant.

- **Auth**: Yes (requires tenant)
- **Query**: `q` (search term), `scope?`, `teamId?`
- **Response**: `200` `[{ id, email, username }]`

### `PUT /api/user/password`

Change password.

- **Auth**: Yes (vault must be unlocked)
- **Body**: `{ oldPassword?: string, newPassword: string (min 8), verificationId?: string }`
- **Response**: `200` `{ message, recoveryKey }`

### `PUT /api/user/ssh-defaults`

Update default SSH terminal settings.

- **Auth**: Yes
- **Body**: SSH terminal config fields (font, theme, cursor, scrollback, etc.)
- **Response**: `200` updated defaults

### `PUT /api/user/rdp-defaults`

Update default RDP settings.

- **Auth**: Yes
- **Body**: RDP settings fields (colorDepth, resolution, etc.)
- **Response**: `200` updated defaults

### `POST /api/user/avatar`

Upload user avatar.

- **Auth**: Yes
- **Body**: `{ avatarData: string }` (base64, max ~200KB)
- **Response**: `200` `{ avatarData }`

### `POST /api/user/email-change/initiate`

Start email change flow (sends verification codes).

- **Auth**: Yes (rate limited)
- **Body**: `{ newEmail: string }`
- **Response**: `200` `{ method, verificationId? }`

### `POST /api/user/email-change/confirm`

Confirm email change with verification codes.

- **Auth**: Yes
- **Body**: `{ codeOld?, codeNew?, verificationId? }`
- **Response**: `200` `{ message }`

### `POST /api/user/password-change/initiate`

Start identity-verified password change flow.

- **Auth**: Yes (rate limited)
- **Response**: `200` identity verification challenge

### `POST /api/user/identity/initiate`

Initiate identity verification for sensitive operations.

- **Auth**: Yes (rate limited)
- **Body**: `{ purpose: string }`
- **Response**: `200` `{ verificationId, methods, challengeData? }`

### `POST /api/user/identity/confirm`

Confirm identity verification.

- **Auth**: Yes
- **Body**: `{ verificationId, code?, credential?, password? }`
- **Response**: `200` `{ verified, verificationId }`

<!-- manual-start -->
<!-- manual-end -->

## 2FA — TOTP (`/api/user/2fa`)

### `POST /api/user/2fa/setup`

Generate TOTP secret and QR code URI.

- **Auth**: Yes
- **Response**: `200` `{ secret, otpauthUri }`

### `POST /api/user/2fa/verify`

Enable TOTP with a verification code.

- **Auth**: Yes
- **Body**: `{ code: string }` (6 digits)
- **Response**: `200` `{ enabled: true }`

### `POST /api/user/2fa/disable`

Disable TOTP with a verification code.

- **Auth**: Yes
- **Body**: `{ code: string }` (6 digits)
- **Response**: `200` `{ enabled: false }`

### `GET /api/user/2fa/status`

Check TOTP status.

- **Auth**: Yes
- **Response**: `200` `{ enabled: boolean }`

<!-- manual-start -->
<!-- manual-end -->

## 2FA — SMS MFA (`/api/user/2fa/sms`)

### `POST /api/user/2fa/sms/setup-phone`

Set up phone number (sends verification SMS).

- **Auth**: Yes
- **Body**: `{ phoneNumber: string }` (E.164 format)
- **Response**: `200` `{ message }`

### `POST /api/user/2fa/sms/verify-phone`

Verify phone number with SMS code.

- **Auth**: Yes
- **Body**: `{ code: string }` (6 digits)
- **Response**: `200` `{ verified: true }`

### `POST /api/user/2fa/sms/enable`

Enable SMS MFA (phone must be verified first).

- **Auth**: Yes
- **Response**: `200` `{ enabled: true }`

### `POST /api/user/2fa/sms/send-disable-code`

Request SMS code to disable SMS MFA.

- **Auth**: Yes
- **Response**: `200` `{ message }`

### `POST /api/user/2fa/sms/disable`

Disable SMS MFA with verification code.

- **Auth**: Yes
- **Body**: `{ code: string }` (6 digits)
- **Response**: `200` `{ enabled: false }`

### `GET /api/user/2fa/sms/status`

Check SMS MFA status.

- **Auth**: Yes
- **Response**: `200` `{ enabled, phoneVerified, phoneNumber? }`

<!-- manual-start -->
<!-- manual-end -->

## 2FA — WebAuthn (`/api/user/2fa/webauthn`)

### `POST /api/user/2fa/webauthn/registration-options`

Get WebAuthn registration options.

- **Auth**: Yes
- **Response**: `200` registration options (PublicKeyCredentialCreationOptions)

### `POST /api/user/2fa/webauthn/register`

Register a WebAuthn credential.

- **Auth**: Yes
- **Body**: `{ credential, friendlyName?: string }`
- **Response**: `201` registered credential info

### `GET /api/user/2fa/webauthn/credentials`

List registered WebAuthn credentials.

- **Auth**: Yes
- **Response**: `200` `[{ id, friendlyName, deviceType, backedUp, lastUsedAt, createdAt }]`

### `DELETE /api/user/2fa/webauthn/credentials/:id`

Remove a WebAuthn credential.

- **Auth**: Yes
- **Response**: `200` `{ removed: true }`

### `PATCH /api/user/2fa/webauthn/credentials/:id`

Rename a WebAuthn credential.

- **Auth**: Yes
- **Body**: `{ friendlyName: string }`
- **Response**: `200` `{ renamed: true }`

### `GET /api/user/2fa/webauthn/status`

Check WebAuthn status.

- **Auth**: Yes
- **Response**: `200` `{ enabled, credentialCount }`

<!-- manual-start -->
<!-- manual-end -->

## Files (`/api/files`)

### `GET /api/files`

List files in user's drive.

- **Auth**: Yes
- **Response**: `200` `[{ name, size, modifiedAt }]`

### `POST /api/files`

Upload a file.

- **Auth**: Yes
- **Body**: Multipart form with `file` field
- **Response**: `200` `{ files: [...] }`
- **Errors**: `413` quota exceeded

### `GET /api/files/:name`

Download a file.

- **Auth**: Yes
- **Response**: File download (binary)

### `DELETE /api/files/:name`

Delete a file.

- **Auth**: Yes
- **Response**: `200` `{ deleted: true }`

<!-- manual-start -->
<!-- manual-end -->

## Secrets (`/api/secrets`)

### `GET /api/secrets`

List vault secrets.

- **Auth**: Yes (vault must be unlocked)
- **Query**: `scope?`, `type?`, `teamId?`, `folderId?`, `search?`, `tags?`, `isFavorite?`
- **Response**: `200` secrets array

### `POST /api/secrets`

Create a vault secret.

- **Auth**: Yes (vault must be unlocked)
- **Body**: `{ name, description?, type (LOGIN|SSH_KEY|CERTIFICATE|API_KEY|SECURE_NOTE), scope (PERSONAL|TEAM|TENANT), teamId?, folderId?, data, metadata?, tags?, expiresAt? }`
- **Response**: `201` created secret

### `GET /api/secrets/:id`

Get secret details (encrypted data).

- **Auth**: Yes (vault must be unlocked)
- **Response**: `200` secret object

### `PUT /api/secrets/:id`

Update a secret.

- **Auth**: Yes (vault must be unlocked)
- **Body**: `{ name?, description?, data?, metadata?, tags?, folderId?, isFavorite?, expiresAt?, changeNote? }`
- **Response**: `200` updated secret

### `DELETE /api/secrets/:id`

Delete a secret.

- **Auth**: Yes
- **Response**: `200` `{ message }`

### `GET /api/secrets/:id/versions`

List version history.

- **Auth**: Yes
- **Response**: `200` `[{ version, changedBy, changeNote, createdAt }]`

### `GET /api/secrets/:id/versions/:version/data`

Get specific version data.

- **Auth**: Yes (vault must be unlocked)
- **Response**: `200` version data

### `POST /api/secrets/:id/versions/:version/restore`

Restore a previous version.

- **Auth**: Yes (vault must be unlocked)
- **Response**: `200` restoration result

### `POST /api/secrets/:id/share`

Share a secret with a user.

- **Auth**: Yes (vault must be unlocked)
- **Body**: `{ email? | userId?, permission (READ_ONLY|FULL_ACCESS) }`
- **Response**: `201` share details

### `DELETE /api/secrets/:id/share/:userId`

Revoke a secret share.

- **Auth**: Yes
- **Response**: `200` `{ message }`

### `PUT /api/secrets/:id/share/:userId`

Update secret share permission.

- **Auth**: Yes
- **Body**: `{ permission }`
- **Response**: `200` updated share

### `GET /api/secrets/:id/shares`

List shares for a secret.

- **Auth**: Yes
- **Response**: `200` shares array

### `POST /api/secrets/:id/external-shares`

Create a public external share link.

- **Auth**: Yes (vault must be unlocked)
- **Body**: `{ expiresInMinutes (5-43200), maxAccessCount?, pin? }`
- **Response**: `201` `{ shareUrl, token, expiresAt }`

### `GET /api/secrets/:id/external-shares`

List external shares for a secret.

- **Auth**: Yes
- **Response**: `200` external shares array

### `DELETE /api/secrets/external-shares/:shareId`

Revoke an external share.

- **Auth**: Yes
- **Response**: `200` `{ revoked: true }`

### `POST /api/secrets/tenant-vault/init`

Initialize tenant vault key.

- **Auth**: Yes (Tenant ADMIN+)
- **Response**: `200` initialization result

### `POST /api/secrets/tenant-vault/distribute`

Distribute tenant vault key to members.

- **Auth**: Yes (Tenant ADMIN+)
- **Response**: `200` distribution result

### `GET /api/secrets/tenant-vault/status`

Check tenant vault status.

- **Auth**: Yes
- **Response**: `200` `{ initialized, memberHasKey }`

<!-- manual-start -->
<!-- manual-end -->

## Notifications (`/api/notifications`)

### `GET /api/notifications`

List notifications.

- **Auth**: Yes
- **Query**: `limit? (1-100)`, `offset?`
- **Response**: `200` `{ notifications: [...], total }`

### `PUT /api/notifications/:id/read`

Mark notification as read.

- **Auth**: Yes
- **Response**: `200` success

### `PUT /api/notifications/read-all`

Mark all notifications as read.

- **Auth**: Yes
- **Response**: `200` success

### `DELETE /api/notifications/:id`

Delete a notification.

- **Auth**: Yes
- **Response**: `200` success

<!-- manual-start -->
<!-- manual-end -->

## Audit (`/api/audit`)

### `GET /api/audit`

Query user's audit log.

- **Auth**: Yes
- **Query**: `page`, `limit (1-100)`, `action?`, `startDate?`, `endDate?`, `search?`, `targetType?`, `ipAddress?`, `gatewayId?`, `sortBy (createdAt|action)?`, `sortOrder (asc|desc)?`
- **Response**: `200` `{ logs: [...], total, page, limit }`

### `GET /api/audit/gateways`

List gateways for audit log filtering.

- **Auth**: Yes
- **Response**: `200` gateways array

### `GET /api/audit/tenant`

Query tenant-wide audit log.

- **Auth**: Yes (Tenant ADMIN+)
- **Query**: Same as `/audit` plus `userId?`
- **Response**: `200` `{ logs: [...], total, page, limit }`

### `GET /api/audit/tenant/gateways`

List tenant gateways for audit log filtering.

- **Auth**: Yes (Tenant ADMIN+)
- **Response**: `200` gateways array

<!-- manual-start -->
<!-- manual-end -->

## Tenants (`/api/tenants`)

### `POST /api/tenants`

Create a new tenant (user becomes OWNER).

- **Auth**: Yes
- **Body**: `{ name: string }`
- **Response**: `201` `{ tenant, accessToken, csrfToken }`

### `GET /api/tenants/mine`

Get current user's tenant.

- **Auth**: Yes (requires tenant)
- **Response**: `200` tenant object

### `PUT /api/tenants/:id`

Update tenant settings.

- **Auth**: Yes (own tenant, ADMIN+)
- **Body**: `{ name?, defaultSessionTimeoutSeconds?, mfaRequired?, vaultAutoLockMaxMinutes? }`
- **Response**: `200` updated tenant

### `DELETE /api/tenants/:id`

Delete a tenant.

- **Auth**: Yes (own tenant, OWNER only)
- **Response**: `200` `{ message }`

### `GET /api/tenants/:id/mfa-stats`

Get MFA adoption statistics.

- **Auth**: Yes (own tenant, ADMIN+)
- **Response**: `200` `{ totalUsers, mfaEnabled, breakdown }`

### `GET /api/tenants/:id/users`

List tenant users.

- **Auth**: Yes (own tenant)
- **Response**: `200` users array

### `POST /api/tenants/:id/invite`

Invite an existing user to tenant.

- **Auth**: Yes (own tenant, ADMIN+)
- **Body**: `{ email, role (ADMIN|MEMBER) }`
- **Response**: `200` invitation result

### `POST /api/tenants/:id/users`

Create a new user within tenant.

- **Auth**: Yes (own tenant, ADMIN+)
- **Body**: `{ email, username?, password (min 8), role, sendWelcomeEmail? }`
- **Response**: `201` created user

### `PUT /api/tenants/:id/users/:userId`

Update user role within tenant.

- **Auth**: Yes (own tenant, ADMIN+)
- **Body**: `{ role (OWNER|ADMIN|MEMBER) }`
- **Response**: `200` updated role

### `DELETE /api/tenants/:id/users/:userId`

Remove user from tenant.

- **Auth**: Yes (own tenant, ADMIN+)
- **Response**: `200` `{ message }`

### `PATCH /api/tenants/:id/users/:userId/enabled`

Enable/disable a user account.

- **Auth**: Yes (own tenant, ADMIN+)
- **Body**: `{ enabled: boolean }`
- **Response**: `200` toggle result

### `PUT /api/tenants/:id/users/:userId/email`

Admin change user email (requires identity verification).

- **Auth**: Yes (own tenant, ADMIN+)
- **Body**: `{ newEmail, verificationId }`
- **Response**: `200` result

### `PUT /api/tenants/:id/users/:userId/password`

Admin change user password (requires identity verification).

- **Auth**: Yes (own tenant, ADMIN+)
- **Body**: `{ newPassword (min 8), verificationId }`
- **Response**: `200` result

<!-- manual-start -->
<!-- manual-end -->

## Teams (`/api/teams`)

### `POST /api/teams`

Create a team.

- **Auth**: Yes (requires tenant)
- **Body**: `{ name, description? }`
- **Response**: `201` created team

### `GET /api/teams`

List teams.

- **Auth**: Yes (requires tenant)
- **Response**: `200` teams array

### `GET /api/teams/:id`

Get team details.

- **Auth**: Yes (team member)
- **Response**: `200` team object

### `PUT /api/teams/:id`

Update team.

- **Auth**: Yes (TEAM_ADMIN)
- **Body**: `{ name?, description? }`
- **Response**: `200` updated team

### `DELETE /api/teams/:id`

Delete team.

- **Auth**: Yes (TEAM_ADMIN)
- **Response**: `200` `{ message }`

### `GET /api/teams/:id/members`

List team members.

- **Auth**: Yes (team member)
- **Response**: `200` members array

### `POST /api/teams/:id/members`

Add team member.

- **Auth**: Yes (TEAM_ADMIN)
- **Body**: `{ userId, role (TEAM_ADMIN|TEAM_EDITOR|TEAM_VIEWER) }`
- **Response**: `201` added member

### `PUT /api/teams/:id/members/:userId`

Update member role.

- **Auth**: Yes (TEAM_ADMIN)
- **Body**: `{ role }`
- **Response**: `200` updated role

### `DELETE /api/teams/:id/members/:userId`

Remove team member.

- **Auth**: Yes (TEAM_ADMIN)
- **Response**: `200` `{ message }`

<!-- manual-start -->
<!-- manual-end -->

## Admin (`/api/admin`)

### `GET /api/admin/email/status`

Check email provider configuration status.

- **Auth**: Yes (Tenant ADMIN+)
- **Response**: `200` `{ provider, configured, testable }`

### `POST /api/admin/email/test`

Send a test email.

- **Auth**: Yes (Tenant ADMIN+)
- **Body**: `{ to: string }` (email address)
- **Response**: `200` `{ success, message }`

### `GET /api/admin/app-config`

Get application configuration.

- **Auth**: Yes (Tenant ADMIN+)
- **Response**: `200` `{ selfSignupEnabled, selfSignupEnvLocked }`

### `PUT /api/admin/app-config/self-signup`

Toggle self-signup.

- **Auth**: Yes (Tenant ADMIN+)
- **Body**: `{ enabled: boolean }`
- **Response**: `200` `{ selfSignupEnabled }`
- **Errors**: `403` if locked by environment variable

<!-- manual-start -->
<!-- manual-end -->

## Gateways (`/api/gateways`)

### `GET /api/gateways`

List gateways.

- **Auth**: Yes (requires tenant)
- **Response**: `200` gateways array

### `POST /api/gateways`

Create a gateway.

- **Auth**: Yes (Tenant ADMIN+)
- **Body**: `{ name, type (GUACD|SSH_BASTION|MANAGED_SSH), host, port, description?, isDefault?, username?, password?, sshPrivateKey?, apiPort?, publishPorts?, lbStrategy?, monitoringEnabled?, monitorIntervalMs?, inactivityTimeoutSeconds? }`
- **Response**: `201` created gateway

### `PUT /api/gateways/:id`

Update a gateway.

- **Auth**: Yes (Tenant ADMIN+)
- **Body**: Same as create (all optional)
- **Response**: `200` updated gateway

### `DELETE /api/gateways/:id`

Delete a gateway.

- **Auth**: Yes (Tenant ADMIN+)
- **Response**: `200` `{ message }`

### `POST /api/gateways/:id/test`

Test gateway connectivity.

- **Auth**: Yes (requires tenant)
- **Response**: `200` `{ reachable, latencyMs?, error? }`

### `POST /api/gateways/:id/push-key`

Push SSH public key to gateway.

- **Auth**: Yes (Tenant ADMIN+)
- **Response**: `200` push result

### `POST /api/gateways/ssh-keypair`

Generate SSH key pair for tenant.

- **Auth**: Yes (Tenant ADMIN+)
- **Response**: `201` generated key pair info

### `GET /api/gateways/ssh-keypair`

Get SSH public key.

- **Auth**: Yes (Tenant ADMIN+)
- **Response**: `200` `{ publicKey, fingerprint, algorithm, expiresAt?, autoRotateEnabled }`

### `GET /api/gateways/ssh-keypair/private`

Download SSH private key.

- **Auth**: Yes (Tenant ADMIN+)
- **Response**: Private key file download

### `POST /api/gateways/ssh-keypair/rotate`

Rotate SSH key pair.

- **Auth**: Yes (Tenant ADMIN+)
- **Response**: `200` rotation result

### `PATCH /api/gateways/ssh-keypair/rotation`

Update key rotation policy.

- **Auth**: Yes (Tenant ADMIN+)
- **Body**: `{ autoRotateEnabled?, rotationIntervalDays?, expiresAt? }`
- **Response**: `200` updated policy

### `GET /api/gateways/ssh-keypair/rotation`

Get key rotation status.

- **Auth**: Yes (Tenant ADMIN+)
- **Response**: `200` rotation status

### `GET /api/gateways/templates`

List gateway templates.

- **Auth**: Yes (Tenant ADMIN+)
- **Response**: `200` templates array

### `POST /api/gateways/templates`

Create a gateway template.

- **Auth**: Yes (Tenant ADMIN+)
- **Body**: Gateway configuration fields
- **Response**: `201` created template

### `PUT /api/gateways/templates/:templateId`

Update a gateway template.

- **Auth**: Yes (Tenant ADMIN+)
- **Body**: Template fields
- **Response**: `200` updated template

### `DELETE /api/gateways/templates/:templateId`

Delete a gateway template.

- **Auth**: Yes (Tenant ADMIN+)
- **Response**: `200` `{ message }`

### `POST /api/gateways/templates/:templateId/deploy`

Deploy a gateway from template.

- **Auth**: Yes (Tenant ADMIN+)
- **Response**: `201` deployed gateway

### `POST /api/gateways/:id/deploy`

Deploy managed gateway instances.

- **Auth**: Yes (Tenant ADMIN+)
- **Response**: `200` deployment result

### `DELETE /api/gateways/:id/deploy`

Undeploy managed gateway instances.

- **Auth**: Yes (Tenant ADMIN+)
- **Response**: `200` undeployment result

### `POST /api/gateways/:id/scale`

Scale managed gateway.

- **Auth**: Yes (Tenant ADMIN+)
- **Body**: `{ replicas: number (0-20) }`
- **Response**: `200` scaling result

### `GET /api/gateways/:id/instances`

List managed gateway instances.

- **Auth**: Yes (Tenant ADMIN+)
- **Response**: `200` instances array

### `POST /api/gateways/:id/instances/:instanceId/restart`

Restart a managed instance.

- **Auth**: Yes (Tenant ADMIN+)
- **Response**: `200` restart result

### `GET /api/gateways/:id/instances/:instanceId/logs`

Get managed instance logs.

- **Auth**: Yes (Tenant ADMIN+)
- **Response**: `200` `{ logs }`

### `GET /api/gateways/:id/scaling`

Get auto-scaling status.

- **Auth**: Yes (Tenant ADMIN+)
- **Response**: `200` scaling status

### `PUT /api/gateways/:id/scaling`

Update auto-scaling configuration.

- **Auth**: Yes (Tenant ADMIN+)
- **Body**: `{ autoScale?, minReplicas?, maxReplicas?, sessionsPerInstance?, scaleDownCooldownSeconds? }`
- **Response**: `200` updated configuration

<!-- manual-start -->
<!-- manual-end -->

## Tabs (`/api/tabs`)

### `GET /api/tabs`

Get persisted open tabs.

- **Auth**: Yes
- **Response**: `200` `[{ connectionId, sortOrder, isActive }]`

### `PUT /api/tabs`

Sync open tabs to server.

- **Auth**: Yes
- **Body**: `{ tabs: [{ connectionId, sortOrder, isActive }] }` (max 50)
- **Response**: `200` synced tabs

### `DELETE /api/tabs`

Clear all saved tabs.

- **Auth**: Yes
- **Response**: `200` `{ cleared: true }`

<!-- manual-start -->
<!-- manual-end -->

## Public Share (`/api/share`)

### `GET /api/share/:token/info`

Get public share metadata (no decrypted data).

- **Auth**: No
- **Rate limit**: 10 per minute
- **Response**: `200` `{ secretName, secretType, expiresAt, hasPin, remainingAccesses? }`

### `POST /api/share/:token`

Access public share (decrypt data).

- **Auth**: No
- **Rate limit**: 10 per minute
- **Body**: `{ pin?: string }` (if PIN-protected)
- **Response**: `200` decrypted secret data
- **Errors**: `401` invalid PIN, `404` expired/revoked, `429` max accesses reached

<!-- manual-start -->
<!-- manual-end -->

## Health (`/api`)

### `GET /api/health`

Basic health check.

- **Auth**: No
- **Response**: `200` `{ status: "ok" }`

### `GET /api/ready`

Readiness check with dependency status.

- **Auth**: No
- **Response**: `200` `{ status, checks: { database, guacd } }`

<!-- manual-start -->
<!-- manual-end -->

## WebSocket Endpoints

### SSH Terminal — Socket.IO `/ssh`

Real-time SSH terminal sessions via Socket.IO on port 3001.

**Authentication**: JWT token in connection `auth` payload.

**Client → Server events**:
| Event | Payload | Description |
|-------|---------|-------------|
| `session:start` | `{ connectionId, username?, password? }` | Start SSH session |
| `data` | `string` | Terminal input |
| `resize` | `{ cols, rows }` | Terminal resize |
| `sftp:list` | `{ path }` | List directory |
| `sftp:mkdir` | `{ path }` | Create directory |
| `sftp:delete` | `{ path }` | Delete file |
| `sftp:rmdir` | `{ path }` | Remove directory |
| `sftp:rename` | `{ oldPath, newPath }` | Rename file |
| `sftp:upload` | `{ path, chunk, offset, totalSize }` | Upload file chunk |
| `sftp:download` | `{ path }` | Start file download |

**Server → Client events**:
| Event | Payload | Description |
|-------|---------|-------------|
| `data` | `string` | Terminal output |
| `error` | `{ message }` | Error message |
| `session:end` | `{ reason? }` | Session ended |
| `sftp:list:result` | `[{ filename, attrs }]` | Directory listing |
| `sftp:upload:progress` | `{ percent }` | Upload progress |
| `sftp:download:chunk` | `{ chunk, offset, totalSize }` | Download data chunk |

### Notifications — Socket.IO `/notifications`

Real-time notification delivery.

**Authentication**: JWT token in connection `auth` payload.

**Server → Client events**:
| Event | Payload | Description |
|-------|---------|-------------|
| `notification` | notification object | New notification |

### Gateway Monitor — Socket.IO `/gateway-monitor`

Real-time gateway health and instance status updates.

**Authentication**: JWT token in connection `auth` payload.

**Server → Client events**:
| Event | Payload | Description |
|-------|---------|-------------|
| `health-update` | `{ gatewayId, status, latencyMs }` | Health check result |
| `instance-update` | `{ gatewayId, instances }` | Instance status change |
| `scaling-event` | `{ gatewayId, action, details }` | Auto-scaling event |

### RDP — Guacamole WebSocket (port 3002)

WebSocket tunnel for RDP sessions via `guacamole-lite`.

- **Connection**: `ws://server:3002/?token=<encrypted-token>`
- **Token**: AES-256-CBC encrypted connection parameters
- **Protocol**: Guacamole protocol (handled by `guacamole-common-js` client library)
- **Timeout**: 86400s (24 hours)

<!-- manual-start -->
<!-- manual-end -->

## Common Middleware

| Middleware | Purpose |
|-----------|---------|
| `authenticate` | Validates JWT token, populates `req.user` |
| `requireTenant` | Ensures user has tenant membership |
| `requireTenantRole(role)` | Restricts to specific tenant roles |
| `requireOwnTenant` | Ensures user modifies only own tenant |
| `requireTeamMember` | Ensures user is team member |
| `requireTeamRole(role)` | Restricts to team roles |
| `validateCsrf` | CSRF token validation for state-changing operations |
| `identityRateLimit` | Rate limits identity verification (3 attempts per 15 minutes) |

<!-- manual-start -->
<!-- manual-end -->
