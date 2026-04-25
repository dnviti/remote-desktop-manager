# Auth Endpoints

> Auto-generated on 2026-03-15 by /docs create api.
> Source of truth is the codebase. Run /docs update api after code changes.

## Health & Readiness

### `GET /api/health`

Health check. Always returns 200.

**Auth**: No | **Response**: `{ "status": "ok" }`

### `GET /api/ready`

Readiness probe. Checks database and guacd connectivity.

**Auth**: No | **Response**: `{ "status": "ready"|"not_ready", "checks": { "database": {...}, "guacd": {...} } }`

<!-- manual-start -->
<!-- manual-end -->

## Auth

### `GET /api/auth/config`

Returns public authentication configuration (enabled OAuth providers, self-signup status, email verification requirement).

**Auth**: No

### `POST /api/auth/register`

Register a new user account. Rate limited: 5 per hour per IP.

**Auth**: No | **Body**: `{ email, password }` | **Response**: `{ message, recoveryKey?, requiresVerification? }`

### `GET /api/auth/verify-email?token=<token>`

Verify email address using the token sent by email.

**Auth**: No

### `POST /api/auth/resend-verification`

Resend email verification link.

**Auth**: No | **Body**: `{ email }`

### `POST /api/auth/login`

Login with email/password. Rate limited per IP. Returns tokens or MFA challenge.

**Auth**: No | **Body**: `{ email, password }` | **Response**: `{ accessToken, user, csrfToken }` or `{ requiresMfa, mfaMethods[], pendingToken }`

### `POST /api/auth/verify-totp`

Verify TOTP code during MFA challenge.

**Auth**: No | **Body**: `{ pendingToken, code }` | **Response**: `{ accessToken, user, csrfToken }`

### `POST /api/auth/request-sms-code`

Request SMS OTP during MFA challenge. Rate limited.

**Auth**: No | **Body**: `{ pendingToken }`

### `POST /api/auth/verify-sms`

Verify SMS OTP during MFA challenge.

**Auth**: No | **Body**: `{ pendingToken, code }` | **Response**: `{ accessToken, user, csrfToken }`

### `POST /api/auth/request-webauthn-options`

Get WebAuthn authentication options during MFA challenge.

**Auth**: No | **Body**: `{ pendingToken }` | **Response**: `{ options }`

### `POST /api/auth/verify-webauthn`

Verify WebAuthn assertion during MFA challenge.

**Auth**: No | **Body**: `{ pendingToken, credential }` | **Response**: `{ accessToken, user, csrfToken }`

### `POST /api/auth/mfa-setup/init`

Initialize mandatory MFA setup during first login.

**Auth**: No | **Body**: `{ pendingToken, method }` | **Response**: Method-specific setup data

### `POST /api/auth/mfa-setup/verify`

Complete mandatory MFA setup verification.

**Auth**: No | **Body**: `{ pendingToken, method, code|credential }` | **Response**: `{ accessToken, user, csrfToken }`

### `POST /api/auth/forgot-password`

Request password reset email. Rate limited.

**Auth**: No | **Body**: `{ email }`

### `POST /api/auth/reset-password/validate`

Validate a password reset token.

**Auth**: No | **Body**: `{ token }` | **Response**: `{ valid, requiresSms? }`

### `POST /api/auth/reset-password/request-sms`

Request SMS verification during password reset.

**Auth**: No | **Body**: `{ token }`

### `POST /api/auth/reset-password/complete`

Complete password reset with new password.

**Auth**: No | **Body**: `{ token, newPassword, smsCode?, recoveryKey? }` | **Response**: `{ message, recoveryKey? }`

### `POST /api/auth/refresh`

Refresh access token using httpOnly cookie. CSRF-protected.

**Auth**: Cookie | **Response**: `{ accessToken, csrfToken, user }`

### `GET /api/auth/session`

Restore the current browser session from the httpOnly browser-session cookie. Reuses the existing CSRF cookie when present.

**Auth**: Cookie | **Response**: `{ accessToken, csrfToken, user }`

### `POST /api/auth/activity`

Extend the authenticated browser session and refresh the browser-session and CSRF cookie expirations after user activity.

**Auth**: Yes | **Response**: `{ ok: true }`

### `POST /api/auth/logout`

Logout and revoke refresh token. CSRF-protected.

**Auth**: Cookie

### `POST /api/auth/switch-tenant`

Switch active tenant context. CSRF-protected.

**Auth**: Yes | **Body**: `{ tenantId }` | **Response**: `{ accessToken, csrfToken, user }`

<!-- manual-start -->
<!-- manual-end -->

## OAuth

### `GET /api/auth/oauth/providers`

List available OAuth providers.

**Auth**: No | **Response**: `{ providers: [{ provider, name, enabled }] }`

### `GET /api/auth/oauth/:provider`

Initiate OAuth flow (redirect to provider). Providers: `google`, `microsoft`, `github`, `oidc`.

**Auth**: No

### `GET /api/auth/oauth/:provider/callback`

OAuth callback handler. Redirects to client with tokens.

**Auth**: No

### `GET /api/auth/oauth/link/:provider`

Initiate OAuth account linking (uses JWT from query param).

**Auth**: JWT in query | **Query**: `?token=<jwt>`

### `GET /api/auth/oauth/accounts`

List linked OAuth accounts.

**Auth**: Yes | **Response**: `[{ provider, providerEmail, createdAt }]`

### `DELETE /api/auth/oauth/link/:provider`

Unlink an OAuth account.

**Auth**: Yes

### `POST /api/auth/oauth/vault-setup`

Set vault password for OAuth-only users.

**Auth**: Yes | **Body**: `{ password }`

<!-- manual-start -->
<!-- manual-end -->

## SAML

### `GET /api/auth/saml/metadata`

SAML Service Provider metadata XML.

**Auth**: No

### `GET /api/auth/saml`

Initiate SAML login (redirect to IdP).

**Auth**: No

### `GET /api/auth/saml/link`

Initiate SAML account linking (JWT from query param).

**Auth**: JWT in query

### `POST /api/auth/saml/callback`

SAML ACS callback (POST with URL-encoded body from IdP).

**Auth**: No

<!-- manual-start -->
<!-- manual-end -->
