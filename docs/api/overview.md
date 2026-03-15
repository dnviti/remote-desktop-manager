# API Overview

> Auto-generated on 2026-03-15 by /docs create api.
> Source of truth is the codebase. Run /docs update api after code changes.

## Overview

All REST endpoints are mounted under `/api`. The server runs on port 3001 (configurable via `PORT`).

| Route Group | Base Path | Auth Required | Description |
|-------------|-----------|---------------|-------------|
| Health | `/api/health`, `/api/ready` | No | Health and readiness probes |
| Auth | `/api/auth` | Mixed | Registration, login, MFA, token refresh |
| OAuth | `/api/auth/oauth` | Mixed | OAuth provider flows (Google, Microsoft, GitHub, OIDC) |
| SAML | `/api/auth/saml` | Mixed | SAML 2.0 SSO |
| Vault | `/api/vault` | Yes | Vault lock/unlock, MFA unlock, auto-lock |
| Connections | `/api/connections` | Yes | Connection CRUD, favorites |
| Folders | `/api/folders` | Yes | Folder CRUD |
| Sharing | `/api/connections` | Yes | Connection sharing management |
| Import/Export | `/api/connections` | Yes | Connection import/export |
| Sessions | `/api/sessions` | Yes | RDP/VNC/SSH session lifecycle, admin monitoring |
| User | `/api/user` | Yes | Profile, settings, identity verification |
| 2FA (TOTP) | `/api/user/2fa` | Yes | TOTP setup/verify/disable |
| 2FA (SMS) | `/api/user/2fa/sms` | Yes | SMS MFA setup/verify/disable |
| 2FA (WebAuthn) | `/api/user/2fa/webauthn` | Yes | Passkey registration/management |
| Files | `/api/files` | Yes | RDP drive file management |
| Audit | `/api/audit` | Yes | Audit log queries |
| Notifications | `/api/notifications` | Yes | In-app notification management |
| Tenants | `/api/tenants` | Yes | Tenant CRUD, user management |
| Teams | `/api/teams` | Yes | Team CRUD, member management |
| Admin | `/api/admin` | Yes (Admin) | Email config, app settings |
| Gateways | `/api/gateways` | Yes (Tenant) | Gateway CRUD, SSH keys, orchestration |
| Tabs | `/api/tabs` | Yes | Tab state persistence |
| Secrets | `/api/secrets` | Yes | Vault secrets CRUD, versioning, sharing |
| Public Share | `/api/share` | No | External secret access (public) |
| Recordings | `/api/recordings` | Yes | Session recording management |
| GeoIP | `/api/geoip` | Yes | IP geolocation lookup |
| LDAP | `/api/ldap` | Yes (Admin) | LDAP integration status, test, and manual sync |
| Vault Folders | `/api/vault-folders` | Yes | Vault (keychain) folder CRUD |
| Sync | `/api/sync-profiles` | Yes (Admin) | External sync profiles (NetBox), CRUD, test, and manual trigger |
| External Vault | `/api/vault-providers` | Yes (Admin) | HashiCorp Vault external credential provider CRUD and test |

<!-- manual-start -->
<!-- manual-end -->

## Authentication

Most endpoints require a JWT Bearer token in the `Authorization` header:

```
Authorization: Bearer <access_token>
```

Public endpoints (no auth required): `/api/health`, `/api/ready`, `/api/auth/config`, `/api/auth/register`, `/api/auth/login`, `/api/auth/verify-email`, `/api/auth/resend-verification`, `/api/auth/forgot-password`, `/api/auth/reset-password/*`, `/api/auth/refresh`, `/api/auth/logout`, `/api/auth/verify-totp`, `/api/auth/verify-sms`, `/api/auth/request-sms-code`, `/api/auth/verify-webauthn`, `/api/auth/request-webauthn-options`, `/api/auth/mfa-setup/*`, `/api/auth/oauth/*`, `/api/auth/saml/*`, `/api/share/:token/*`.

CSRF-protected endpoints (require `X-CSRF-Token` header): `/api/auth/refresh`, `/api/auth/logout`, `/api/auth/switch-tenant`.

Tenant-scoped endpoints require the user to have an active tenant membership (set via JWT claims after login or tenant switch). Admin-only endpoints additionally require `ADMIN` or `OWNER` tenant role.

<!-- manual-start -->
<!-- manual-end -->
