---
title: API Reference
description: Complete REST API endpoint reference for all Arsenale domains
generated-by: claw-docs
generated-at: 2026-03-27T12:00:00Z
source-files:
  - server/src/routes/auth.routes.ts
  - server/src/routes/connections.routes.ts
  - server/src/routes/sessions.routes.ts
  - server/src/routes/vault.routes.ts
  - server/src/routes/secrets.routes.ts
  - server/src/routes/gateway.routes.ts
  - server/src/routes/tenants.routes.ts
  - server/src/routes/teams.routes.ts
  - server/src/routes/audit.routes.ts
  - server/src/routes/recordings.routes.ts
  - server/src/routes/database.routes.ts
  - server/src/routes/admin.routes.ts
  - server/src/routes/notification.routes.ts
  - server/src/routes/oauth.routes.ts
  - server/src/routes/cli.routes.ts
  - server/src/routes/health.routes.ts
  - server/src/types/index.ts
  - client/src/api/client.ts
---

## 🎯 Overview

Arsenale exposes 200+ REST API endpoints across 40+ route files. All endpoints are served over HTTPS on port 3001 (default) under the `/api` prefix.

**Base URL:** `https://localhost:3001/api`

**Authentication:** Most endpoints require a JWT access token via `Authorization: Bearer <token>`. State-changing requests (POST/PUT/PATCH/DELETE) also require a CSRF token via the `X-CSRF-Token` header matching the `arsenale-csrf` cookie.

**Error format:** `{ "error": "message" }` with appropriate HTTP status codes.

## 🔐 Authentication (`/api/auth`)

### Public Endpoints

| Method | Path | Purpose | Rate Limited |
|--------|------|---------|:---:|
| GET | `/auth/config` | Get public auth configuration (signup enabled, features) | - |
| POST | `/auth/register` | Register new user | Yes |
| POST | `/auth/login` | Login with email/password | Yes |
| GET | `/auth/verify-email` | Verify email with token (query: `token`) | - |
| POST | `/auth/resend-verification` | Resend verification email | - |
| POST | `/auth/forgot-password` | Request password reset | Yes |
| POST | `/auth/reset-password/validate` | Validate reset token | Yes |
| POST | `/auth/reset-password/complete` | Complete password reset | Yes |
| POST | `/auth/refresh` | Refresh access token (uses HttpOnly cookie) | - |

### MFA During Login

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/auth/verify-totp` | Verify TOTP code (requires `tempToken`) |
| POST | `/auth/request-sms-code` | Request SMS code (requires `tempToken`) |
| POST | `/auth/verify-sms` | Verify SMS code (requires `tempToken`) |
| POST | `/auth/request-webauthn-options` | Get WebAuthn challenge (requires `tempToken`) |
| POST | `/auth/verify-webauthn` | Verify WebAuthn credential (requires `tempToken`) |
| POST | `/auth/mfa-setup/init` | Initialize mandatory MFA setup (requires `tempToken`) |
| POST | `/auth/mfa-setup/verify` | Complete MFA setup (requires `tempToken`) |

### Authenticated

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/auth/logout` | Logout (revoke refresh token) |
| POST | `/auth/switch-tenant` | Switch to different tenant context |

**Login response variants:**
- Standard: `{ accessToken, csrfToken, user }`
- MFA required: `{ requiresMFA, tempToken, methods[] }`
- MFA setup required: `{ mfaSetupRequired, tempToken }`

## 👤 User Management (`/api/user`)

All endpoints require authentication.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/user/profile` | Get current user profile |
| PUT | `/user/profile` | Update profile (username, fullName) |
| PUT | `/user/password` | Change password |
| PUT | `/user/ssh-defaults` | Update SSH terminal defaults |
| PUT | `/user/rdp-defaults` | Update RDP defaults |
| POST | `/user/avatar` | Upload avatar (multipart) |
| GET | `/user/search` | Search users in tenant (query: `q, limit, offset`) |
| GET | `/user/domain-profile` | Get AD/LDAP domain profile |
| PUT | `/user/domain-profile` | Update domain profile |
| POST | `/user/email-change/initiate` | Start email change verification |
| POST | `/user/email-change/confirm` | Confirm new email |
| POST | `/user/identity/initiate` | Start identity verification |
| POST | `/user/identity/confirm` | Confirm identity |

## 🔒 Vault (`/api/vault`)

All endpoints require authentication.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/vault/unlock` | Unlock vault with password (rate limited) |
| POST | `/vault/lock` | Lock vault immediately |
| GET | `/vault/status` | Get vault lock status and MFA unlock availability |
| POST | `/vault/unlock-mfa/totp` | Unlock vault with TOTP |
| POST | `/vault/unlock-mfa/webauthn` | Unlock vault with WebAuthn |
| POST | `/vault/unlock-mfa/sms` | Unlock vault with SMS code |
| GET | `/vault/auto-lock` | Get auto-lock preference |
| PUT | `/vault/auto-lock` | Set auto-lock timeout |
| POST | `/vault/recover-with-key` | Recover vault with recovery key |
| POST | `/vault/explicit-reset` | Reset vault (requires password) |

## 🔑 Secrets / Keychain (`/api/secret`)

All endpoints require authentication.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/secret` | List secrets (filters: `scope, type, teamId, folderId, search, tags`) |
| POST | `/secret` | Create secret |
| GET | `/secret/:id` | Get secret with decrypted data |
| PUT | `/secret/:id` | Update secret |
| DELETE | `/secret/:id` | Delete secret |
| POST | `/secret/:id/breach-check` | Check if secret is in breach database |
| GET | `/secret/:id/versions` | List version history |
| POST | `/secret/:id/versions/:version/restore` | Restore to previous version |
| POST | `/secret/:id/share` | Share with user/team |
| DELETE | `/secret/:id/share/:userId` | Revoke share |
| GET | `/secret/:id/shares` | List shares |
| GET | `/secret/counts` | Get lightweight counts by type/scope |
| POST | `/secret/:id/external-shares` | Create time-limited external share link |
| DELETE | `/secret/external-shares/:shareId` | Revoke external share |
| POST | `/secret/tenant-vault/init` | Initialize tenant vault |
| GET | `/secret/tenant-vault/status` | Get tenant vault status |

**Secret types:** `LOGIN`, `SSH_KEY`, `CERTIFICATE`, `API_KEY`, `SECURE_NOTE`
**Secret scopes:** `PERSONAL`, `TEAM`, `TENANT`

## 🔗 Connections (`/api/connections`)

All endpoints require authentication.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/connections` | List all connections (own + shared + team) |
| POST | `/connections` | Create connection |
| GET | `/connections/:id` | Get connection details |
| PUT | `/connections/:id` | Update connection |
| DELETE | `/connections/:id` | Delete connection |
| PATCH | `/connections/:id/favorite` | Toggle favorite status |

**Connection types:** `SSH`, `RDP`, `VNC`, `DATABASE`, `DB_TUNNEL`

## 📁 Folders (`/api/folders`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/folders` | List folders |
| POST | `/folders` | Create folder |
| PUT | `/folders/:id` | Update folder |
| DELETE | `/folders/:id` | Delete folder |

## 📡 Sessions (`/api/session`)

### Session Creation

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/session/rdp` | Create RDP session (returns guacToken) |
| POST | `/session/vnc` | Create VNC session (returns guacToken) |
| POST | `/session/ssh` | Validate SSH access |
| POST | `/session/rdp/:id/heartbeat` | RDP heartbeat |
| POST | `/session/rdp/:id/end` | End RDP session |
| POST | `/session/vnc/:id/heartbeat` | VNC heartbeat |
| POST | `/session/vnc/:id/end` | End VNC session |

### Admin Monitoring (requires ADMIN/OWNER/AUDITOR/OPERATOR + canManageSessions)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/session/active` | List active sessions |
| GET | `/session/count` | Get session count |
| GET | `/session/count/gateway` | Sessions by gateway |
| POST | `/session/:id/terminate` | Force terminate session |

## 🎬 Recordings (`/api/recording`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/recording` | List recordings (filters: `limit, offset, connectionId`) |
| GET | `/recording/:id` | Get recording metadata |
| GET | `/recording/:id/stream` | Stream recording data (binary) |
| GET | `/recording/:id/video` | Export as MP4 video |
| GET | `/recording/:id/analyze` | AI analysis of recording |
| GET | `/recording/:id/audit-trail` | Audit trail for recording |
| DELETE | `/recording/:id` | Delete recording |

## 🚪 Gateways (`/api/gateway`)

Requires authentication + tenant. Most management endpoints require OPERATOR/ADMIN/OWNER.

### CRUD and Testing

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/gateway` | List gateways |
| POST | `/gateway` | Create gateway |
| PUT | `/gateway/:id` | Update gateway |
| DELETE | `/gateway/:id` | Delete gateway |
| POST | `/gateway/:id/test` | Test connectivity |

### SSH Key Management

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/gateway/ssh-keypair` | Generate SSH keypair |
| GET | `/gateway/ssh-keypair` | Get public key |
| GET | `/gateway/ssh-keypair/private` | Download private key (PEM) |
| POST | `/gateway/ssh-keypair/rotate` | Rotate SSH keys |
| POST | `/gateway/:id/push-key` | Push SSH key to gateway |

### Managed Gateway Lifecycle

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/gateway/:id/deploy` | Deploy managed gateway |
| DELETE | `/gateway/:id/deploy` | Undeploy managed gateway |
| POST | `/gateway/:id/scale` | Scale instances |
| GET | `/gateway/:id/instances` | List instances |
| POST | `/gateway/:id/instances/:iid/restart` | Restart instance |
| GET | `/gateway/:id/instances/:iid/logs` | Get instance logs |
| GET | `/gateway/:id/scaling` | Get auto-scaling config |
| PUT | `/gateway/:id/scaling` | Update auto-scaling |

### Tunnels

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/gateway/tunnel-overview` | Fleet overview |
| POST | `/gateway/:id/tunnel-token` | Generate tunnel token |
| DELETE | `/gateway/:id/tunnel-token` | Revoke tunnel token |
| POST | `/gateway/:id/tunnel-disconnect` | Force disconnect |
| GET | `/gateway/:id/tunnel-events` | Tunnel events |
| GET | `/gateway/:id/tunnel-metrics` | Tunnel metrics |

### Templates

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/gateway/templates` | List templates |
| POST | `/gateway/templates` | Create template |
| PUT | `/gateway/templates/:id` | Update template |
| DELETE | `/gateway/templates/:id` | Delete template |
| POST | `/gateway/templates/:id/deploy` | Deploy from template |

## 🏢 Tenants (`/api/tenant`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/tenant` | Create new tenant |
| GET | `/tenant/mine/all` | List all my tenants |
| GET | `/tenant/mine` | Get current tenant |
| PUT | `/tenant/:id` | Update tenant (ADMIN) |
| DELETE | `/tenant/:id` | Delete tenant (OWNER) |
| GET | `/tenant/:id/users` | List tenant users |
| POST | `/tenant/:id/users` | Create user (ADMIN) |
| POST | `/tenant/:id/invite` | Invite user (ADMIN) |
| PUT | `/tenant/:id/users/:uid` | Update user role (ADMIN) |
| DELETE | `/tenant/:id/users/:uid` | Remove user (ADMIN) |
| PATCH | `/tenant/:id/users/:uid/enabled` | Enable/disable user |
| PATCH | `/tenant/:id/users/:uid/expiry` | Set membership expiry |
| GET | `/tenant/:id/users/:uid/permissions` | Get permission overrides |
| PUT | `/tenant/:id/users/:uid/permissions` | Update permissions |
| GET | `/tenant/:id/mfa-stats` | MFA adoption statistics |
| GET | `/tenant/:id/ip-allowlist` | Get IP allowlist |
| PUT | `/tenant/:id/ip-allowlist` | Update IP allowlist |

## 👥 Teams (`/api/team`)

Requires authentication + tenant.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/team` | List user's teams |
| POST | `/team` | Create team |
| GET | `/team/:id` | Get team details (requires membership) |
| PUT | `/team/:id` | Update team (TEAM_ADMIN) |
| DELETE | `/team/:id` | Delete team (TEAM_ADMIN) |
| GET | `/team/:id/members` | List members |
| POST | `/team/:id/members` | Add member (TEAM_ADMIN) |
| PUT | `/team/:id/members/:uid` | Update role (TEAM_ADMIN) |
| DELETE | `/team/:id/members/:uid` | Remove member (TEAM_ADMIN) |
| PATCH | `/team/:id/members/:uid/expiry` | Set member expiry |

## 📋 Audit (`/api/audit`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/audit` | List audit logs (filters: `from, to, userId, action`) |
| GET | `/audit/tenant` | Tenant audit logs (requires canViewAuditLog) |
| GET | `/audit/tenant/gateways` | Gateways in tenant audit |
| GET | `/audit/tenant/countries` | Countries of access |
| GET | `/audit/tenant/geo-summary` | Geographic access summary |
| GET | `/audit/connection/:id` | Audit logs for connection |
| GET | `/audit/connection/:id/users` | Users who accessed connection |
| GET | `/audit/session/:id/recording` | Recording for session |

## 🗄 Database Proxy (`/api/db-proxy`)

Requires authentication + tenant.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/db-proxy` | Create database session |
| POST | `/db-proxy/:id/end` | End session |
| POST | `/db-proxy/:id/heartbeat` | Session heartbeat |
| POST | `/db-proxy/:id/query` | Execute SQL query |
| GET | `/db-proxy/:id/schema` | Get database schema |
| POST | `/db-proxy/:id/explain` | Get execution plan |
| POST | `/db-proxy/:id/introspect` | Introspect database |
| GET | `/db-proxy/:id/history` | Query history |
| PUT | `/db-proxy/:id/config` | Update session config |

## 🔍 Database Audit (`/api/db-audit`)

Requires ADMIN/OWNER/AUDITOR.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/db-audit/logs` | List query audit logs |
| GET/POST/PUT/DELETE | `/db-audit/firewall-rules[/:id]` | SQL firewall rules |
| GET/POST/PUT/DELETE | `/db-audit/masking-policies[/:id]` | Data masking policies |
| GET/POST/PUT/DELETE | `/db-audit/rate-limit-policies[/:id]` | Query rate limits |

## 🔌 Database Tunnel (`/api/db-tunnel`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/db-tunnel` | Open database tunnel |
| GET | `/db-tunnel` | List active tunnels |
| POST | `/db-tunnel/:id/heartbeat` | Tunnel heartbeat |
| DELETE | `/db-tunnel/:id` | Close tunnel |

## 🔔 Notifications (`/api/notification`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/notification` | List notifications |
| GET | `/notification/preferences` | Get notification preferences |
| PUT | `/notification/preferences` | Update all preferences |
| PUT | `/notification/read-all` | Mark all as read |
| PUT | `/notification/:id/read` | Mark one as read |
| DELETE | `/notification/:id` | Delete notification |

## 🔏 MFA Management

### TOTP (`/api/totp`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/totp/setup` | Initialize TOTP |
| POST | `/totp/verify` | Verify code during setup |
| POST | `/totp/disable` | Disable TOTP |
| GET | `/totp/status` | Get TOTP status |

### WebAuthn (`/api/webauthn`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/webauthn/registration-options` | Get registration options |
| POST | `/webauthn/register` | Register credential |
| GET | `/webauthn/credentials` | List credentials |
| DELETE | `/webauthn/credentials/:id` | Delete credential |
| GET | `/webauthn/status` | Get WebAuthn status |

### SMS MFA (`/api/sms-mfa`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/sms-mfa/setup-phone` | Setup phone number |
| POST | `/sms-mfa/verify-phone` | Verify with SMS code |
| POST | `/sms-mfa/enable` | Enable SMS MFA |
| POST | `/sms-mfa/disable` | Disable SMS MFA |
| GET | `/sms-mfa/status` | Get SMS MFA status |

## 🌐 OAuth and SSO

### OAuth (`/api/oauth`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/oauth/providers` | List available OAuth providers |
| GET | `/oauth/:provider` | Initiate OAuth login |
| GET | `/oauth/:provider/callback` | OAuth callback |
| POST | `/oauth/link-code` | Generate account link code |
| GET | `/oauth/accounts` | List linked OAuth accounts |
| DELETE | `/oauth/link/:provider` | Unlink OAuth account |

### SAML (`/api/saml`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/saml/metadata` | SP metadata XML |
| GET | `/saml` | Initiate SAML login |
| POST | `/saml/callback` | SAML ACS callback |

## 📱 CLI Device Auth (`/api/cli`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/cli/auth/device` | Initiate device auth (RFC 8628) |
| POST | `/cli/auth/device/token` | Poll for token |
| POST | `/cli/auth/device/authorize` | Approve device (from UI) |
| GET | `/cli/connections` | List connections (CLI) |

## ⚙ Admin and Settings

### Admin (`/api/admin`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/admin/email/status` | Email configuration status |
| POST | `/admin/email/test` | Send test email |
| GET | `/admin/app-config` | Get application config |
| PUT | `/admin/app-config/self-signup` | Toggle self-signup |
| GET | `/admin/auth-providers` | Get OAuth/SAML providers |

### System Settings (`/api/system-settings`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/system-settings` | Get all settings |
| GET | `/system-settings/db-status` | Database connection status |
| PUT | `/system-settings/:key` | Update single setting |
| PUT | `/system-settings` | Update multiple settings |

## ❤ Health and Setup

### Health (no auth required)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Liveness check |
| GET | `/ready` | Readiness check (DB, guacd, gateways) |

### Setup (no auth required during initial setup)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/setup/status` | Check if setup required |
| GET | `/setup/db-status` | Database connection check |
| POST | `/setup/complete` | Complete initial setup |

## 📤 Other Endpoints

| Domain | Base Path | Key Operations |
|--------|-----------|----------------|
| Folders | `/api/vault-folders` | CRUD for vault secret folders |
| Sharing | `/api/sharing` | Batch share, share/unshare secrets |
| Import/Export | `/api/import-export` | Export/import connections (JSON, CSV) |
| Password Rotation | `/api/password-rotation` | Enable/disable/trigger rotation |
| Access Policies | `/api/access-policy` | CRUD access control policies |
| Keystroke Policies | `/api/keystroke-policy` | CRUD keystroke monitoring policies |
| Checkout | `/api/checkout` | Request/approve/reject credential checkout |
| Sync Profiles | `/api/sync` | External connection sync CRUD |
| External Vault | `/api/external-vault` | HashiCorp Vault integration |
| Public Share | `/api/public-share/:token` | Access externally shared secrets (no auth) |
| Tabs | `/api/tabs` | Sync open browser tabs |
| GeoIP | `/api/geoip/:ip` | IP geolocation lookup |
| SSH Proxy | `/api/ssh-proxy` | Get proxy token, check status |
| RD Gateway | `/api/rd-gateway` | Config, status, .rdp file generation |
| AI Query | `/api/ai` | Natural language SQL generation |
| LDAP | `/api/ldap` | Status, test, trigger sync (ADMIN) |
| Files | `/api/files` | SFTP file browser, upload/download |

## 📐 WebSocket Namespaces

| Namespace | Protocol | Purpose |
|-----------|----------|---------|
| `/ssh` | Socket.IO | SSH terminal I/O (keystrokes, output, resize, SFTP) |
| `/notifications` | Socket.IO | Real-time notifications, connection status |
| `/gateway-monitor` | Socket.IO | Gateway health, scaling events |
| `/guacamole` | Raw WebSocket (port 3002) | RDP/VNC Guacamole protocol |
