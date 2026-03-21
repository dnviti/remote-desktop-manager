---
title: API Reference
description: Complete REST API endpoint reference, WebSocket namespaces, and client SDK documentation
generated-by: ctdf-docs
generated-at: 2026-03-21T19:40:00Z
source-files:
  - server/src/routes/auth.routes.ts
  - server/src/routes/oauth.routes.ts
  - server/src/routes/saml.routes.ts
  - server/src/routes/connections.routes.ts
  - server/src/routes/session.routes.ts
  - server/src/routes/vault.routes.ts
  - server/src/routes/sharing.routes.ts
  - server/src/routes/folders.routes.ts
  - server/src/routes/secret.routes.ts
  - server/src/routes/vault-folders.routes.ts
  - server/src/routes/user.routes.ts
  - server/src/routes/twofa.routes.ts
  - server/src/routes/smsMfa.routes.ts
  - server/src/routes/webauthn.routes.ts
  - server/src/routes/tenant.routes.ts
  - server/src/routes/team.routes.ts
  - server/src/routes/gateway.routes.ts
  - server/src/routes/admin.routes.ts
  - server/src/routes/audit.routes.ts
  - server/src/routes/recording.routes.ts
  - server/src/routes/notification.routes.ts
  - server/src/routes/files.routes.ts
  - server/src/routes/tabs.routes.ts
  - server/src/routes/publicShare.routes.ts
  - server/src/routes/importExport.routes.ts
  - server/src/routes/health.routes.ts
  - server/src/routes/geoip.routes.ts
  - server/src/routes/ldap.routes.ts
  - server/src/routes/sync.routes.ts
  - server/src/routes/externalVault.routes.ts
  - server/src/routes/accessPolicy.routes.ts
  - server/src/routes/checkout.routes.ts
  - server/src/routes/sshProxy.routes.ts
  - server/src/routes/rdGateway.routes.ts
  - server/src/routes/cli.routes.ts
  - server/src/routes/dbProxy.routes.ts
  - server/src/routes/dbAudit.routes.ts
  - server/src/routes/passwordRotation.routes.ts
  - server/src/routes/dbTunnel.routes.ts
  - server/src/routes/keystrokePolicy.routes.ts
  - server/src/routes/systemSettings.routes.ts
  - server/src/routes/setup.routes.ts
---

# API Reference

All REST endpoints are served under `/api`. Authentication uses JWT Bearer tokens. Request bodies use JSON. UUID params are validated as UUIDs.

## Authentication

### Password Authentication (`/api/auth`)

| Method | Path | Auth | Rate Limit | Description |
|--------|------|------|------------|-------------|
| `GET` | `/config` | Public | — | Get public auth configuration |
| `POST` | `/register` | Public | 5/hour | Register new user |
| `GET` | `/verify-email` | Public | — | Verify email with token |
| `POST` | `/resend-verification` | Public | — | Resend verification email |
| `POST` | `/login` | Public | Login limit | Login with email/password |
| `POST` | `/verify-totp` | Public | Login limit | Verify TOTP code (MFA step) |
| `POST` | `/request-sms-code` | Public | SMS limit | Request SMS code for login |
| `POST` | `/verify-sms` | Public | Login limit | Verify SMS code |
| `POST` | `/request-webauthn-options` | Public | Login limit | Get WebAuthn challenge |
| `POST` | `/verify-webauthn` | Public | Login limit | Verify WebAuthn credential |
| `POST` | `/mfa-setup/init` | Public | Login limit | Initialize MFA setup |
| `POST` | `/mfa-setup/verify` | Public | Login limit | Complete MFA setup |
| `POST` | `/forgot-password` | Public | Forgot limit | Request password reset email |
| `POST` | `/reset-password/validate` | Public | Reset limit | Validate reset token |
| `POST` | `/reset-password/request-sms` | Public | SMS limit | Request SMS for password reset |
| `POST` | `/reset-password/complete` | Public | Reset limit | Complete password reset |
| `POST` | `/refresh` | Cookie | — | Refresh access token |
| `POST` | `/logout` | JWT | — | Logout and invalidate tokens |
| `POST` | `/switch-tenant` | JWT | — | Switch active tenant |

### OAuth (`/api/auth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/oauth/providers` | Public | List available OAuth providers |
| `POST` | `/oauth/link-code` | JWT | Generate OAuth link code |
| `GET` | `/oauth/link/:provider` | Public | Initiate OAuth account linking |
| `POST` | `/oauth/exchange-code` | Public | Exchange OAuth code for tokens |
| `GET` | `/oauth/accounts` | JWT | List linked OAuth accounts |
| `DELETE` | `/oauth/link/:provider` | JWT | Unlink OAuth account |
| `POST` | `/oauth/vault-setup` | JWT | Setup vault via OAuth flow |
| `GET` | `/oauth/:provider` | Public | Initiate OAuth login |
| `GET` | `/oauth/:provider/callback` | Public | OAuth callback handler |

### SAML (`/api/auth/saml`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/metadata` | Public | SAML SP metadata (XML) |
| `GET` | `/` | Public | Initiate SAML login |
| `GET` | `/link` | JWT (query) | Initiate SAML account linking |
| `POST` | `/callback` | Public | SAML ACS callback |

## User Management

### Profile & Settings (`/api/user`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/profile` | JWT | Get user profile |
| `PUT` | `/profile` | JWT | Update profile (username, etc.) |
| `GET` | `/search` | JWT + Tenant | Search users by email |
| `PUT` | `/password` | JWT | Change password |
| `POST` | `/avatar` | JWT | Upload avatar (multipart) |
| `PUT` | `/ssh-defaults` | JWT | Update SSH terminal defaults |
| `PUT` | `/rdp-defaults` | JWT | Update RDP session defaults |
| `GET` | `/domain-profile` | JWT | Get LDAP/OAuth domain profile |
| `PUT` | `/domain-profile` | JWT | Update domain profile |
| `DELETE` | `/domain-profile` | JWT | Clear domain profile |

### Identity Verification (`/api/user`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/email-change/initiate` | JWT | Start email change |
| `POST` | `/email-change/confirm` | JWT | Confirm email change |
| `POST` | `/password-change/initiate` | JWT | Start password change |
| `POST` | `/identity/initiate` | JWT | Start identity verification |
| `POST` | `/identity/confirm` | JWT | Confirm identity verification |

### TOTP 2FA (`/api/user/2fa`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/setup` | JWT | Setup TOTP |
| `POST` | `/verify` | JWT | Verify and enable TOTP |
| `POST` | `/disable` | JWT | Disable TOTP |
| `GET` | `/status` | JWT | Get 2FA status |

### SMS MFA (`/api/user/2fa/sms`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/setup-phone` | JWT | Setup phone number |
| `POST` | `/verify-phone` | JWT | Verify phone with OTP |
| `POST` | `/enable` | JWT | Enable SMS MFA |
| `POST` | `/send-disable-code` | JWT | Send disable confirmation |
| `POST` | `/disable` | JWT | Disable SMS MFA |
| `GET` | `/status` | JWT | Get SMS MFA status |

### WebAuthn (`/api/user/2fa/webauthn`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/registration-options` | JWT | Get WebAuthn registration options |
| `POST` | `/register` | JWT | Register WebAuthn credential |
| `GET` | `/credentials` | JWT | List WebAuthn credentials |
| `DELETE` | `/credentials/:id` | JWT | Remove credential |
| `PATCH` | `/credentials/:id` | JWT | Rename credential |
| `GET` | `/status` | JWT | Get WebAuthn status |

## Vault

### Vault Access (`/api/vault`)

| Method | Path | Auth | Rate Limit | Description |
|--------|------|------|------------|-------------|
| `POST` | `/unlock` | JWT | Vault limit | Unlock vault with password |
| `POST` | `/lock` | JWT | — | Lock vault |
| `GET` | `/status` | JWT | — | Get vault status |
| `POST` | `/reveal-password` | JWT | — | Decrypt and reveal password |
| `POST` | `/unlock-mfa/totp` | JWT | Vault limit | Unlock with TOTP |
| `POST` | `/unlock-mfa/webauthn-options` | JWT | Vault limit | Get WebAuthn options |
| `POST` | `/unlock-mfa/webauthn` | JWT | Vault limit | Unlock with WebAuthn |
| `POST` | `/unlock-mfa/request-sms` | JWT | SMS limit | Request SMS for vault unlock |
| `POST` | `/unlock-mfa/sms` | JWT | Vault limit | Unlock with SMS |
| `GET` | `/auto-lock` | JWT | — | Get auto-lock preference |
| `PUT` | `/auto-lock` | JWT | — | Set auto-lock TTL |

## Connections

### Connection CRUD (`/api/connections`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/` | JWT | List all connections (own + shared + team) |
| `POST` | `/` | JWT | Create connection |
| `GET` | `/:id` | JWT | Get single connection |
| `PUT` | `/:id` | JWT | Update connection |
| `DELETE` | `/:id` | JWT | Delete connection |
| `PATCH` | `/:id/favorite` | JWT | Toggle favorite |

### Connection Sharing (`/api/connections`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/batch-share` | JWT | Batch share connections |
| `POST` | `/:id/share` | JWT | Share connection with user/email |
| `DELETE` | `/:id/share/:userId` | JWT | Unshare connection |
| `PUT` | `/:id/share/:userId` | JWT | Update share permission |
| `GET` | `/:id/shares` | JWT | List shares for connection |

### Import/Export (`/api/connections`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/import` | JWT | Import connections from file |
| `POST` | `/export` | JWT | Export connections to file |

### Folders (`/api/folders`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/` | JWT | List all folders |
| `POST` | `/` | JWT | Create folder |
| `PUT` | `/:id` | JWT | Update folder |
| `DELETE` | `/:id` | JWT | Delete folder |

## Secrets (Keychain)

### Secret CRUD (`/api/secrets`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/` | JWT | List secrets with filters |
| `POST` | `/` | JWT | Create secret |
| `GET` | `/:id` | JWT | Get secret details |
| `PUT` | `/:id` | JWT | Update secret |
| `DELETE` | `/:id` | JWT | Delete secret |

### Secret Versions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/:id/versions` | JWT | List version history |
| `GET` | `/:id/versions/:version/data` | JWT | Get specific version data |
| `POST` | `/:id/versions/:version/restore` | JWT | Restore previous version |

### Secret Sharing

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/:id/share` | JWT | Share secret |
| `DELETE` | `/:id/share/:userId` | JWT | Unshare secret |
| `PUT` | `/:id/share/:userId` | JWT | Update share permission |
| `GET` | `/:id/shares` | JWT | List secret shares |

### External Secret Sharing

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/:id/external-shares` | JWT | Create public share link |
| `GET` | `/:id/external-shares` | JWT | List external shares |
| `DELETE` | `/external-shares/:shareId` | JWT | Revoke external share |

### Tenant Vault (`/api/secrets`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/tenant-vault/init` | JWT | Initialize tenant vault |
| `POST` | `/tenant-vault/distribute` | JWT | Distribute key to members |
| `GET` | `/tenant-vault/status` | JWT | Get tenant vault status |

### Vault Folders (`/api/vault-folders`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/` | JWT | List vault folders |
| `POST` | `/` | JWT | Create vault folder |
| `PUT` | `/:id` | JWT | Update vault folder |
| `DELETE` | `/:id` | JWT | Delete vault folder |

### Public Share Access (`/api/share`)

| Method | Path | Auth | Rate Limit | Description |
|--------|------|------|------------|-------------|
| `GET` | `/:token/info` | Public | 5/min | Get external share info |
| `POST` | `/:token` | Public | 5/min | Access share with PIN |

## Sessions

### Session Lifecycle (`/api/sessions`)

| Method | Path | Auth | Rate Limit | Description |
|--------|------|------|------------|-------------|
| `POST` | `/rdp` | JWT | Session limit | Create RDP session |
| `POST` | `/rdp/:sessionId/heartbeat` | JWT | — | RDP session heartbeat |
| `POST` | `/rdp/:sessionId/end` | JWT | — | End RDP session |
| `POST` | `/vnc` | JWT | Session limit | Create VNC session |
| `POST` | `/vnc/:sessionId/heartbeat` | JWT | — | VNC session heartbeat |
| `POST` | `/vnc/:sessionId/end` | JWT | — | End VNC session |
| `POST` | `/ssh` | JWT | Session limit | Validate SSH access |

### Session Monitoring (Admin)

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| `GET` | `/active` | JWT + Tenant | ADMIN/OWNER/AUDITOR/OPERATOR | List active sessions |
| `GET` | `/count` | JWT + Tenant | ADMIN/OWNER/AUDITOR/OPERATOR | Get session count |
| `GET` | `/count/gateway` | JWT + Tenant | ADMIN/OWNER/AUDITOR/OPERATOR | Sessions per gateway |
| `POST` | `/:sessionId/terminate` | JWT + Tenant | ADMIN | Force-terminate session |

## Recordings (`/api/recordings`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/` | JWT | List recordings |
| `GET` | `/:id` | JWT | Get recording metadata |
| `GET` | `/:id/stream` | JWT | Stream recording data |
| `GET` | `/:id/analyze` | JWT | Analyze recording |
| `GET` | `/:id/video` | JWT | Export as video |
| `DELETE` | `/:id` | JWT | Delete recording |

## Multi-Tenancy

### Tenants (`/api/tenants`)

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| `POST` | `/` | JWT | — | Create tenant |
| `GET` | `/mine/all` | JWT | — | List user's tenants |
| `GET` | `/mine` | JWT + Tenant | — | Get active tenant |
| `PUT` | `/:id` | JWT + Tenant | ADMIN | Update tenant settings |
| `DELETE` | `/:id` | JWT + Tenant | OWNER | Delete tenant |
| `GET` | `/:id/mfa-stats` | JWT + Tenant | ADMIN | MFA enrollment stats |

### Tenant User Management

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| `GET` | `/:id/users` | JWT + Tenant | ADMIN | List members |
| `GET` | `/:id/users/:userId/profile` | JWT + Tenant | ADMIN | Get user profile |
| `POST` | `/:id/users` | JWT + Tenant | ADMIN | Create user |
| `POST` | `/:id/invite` | JWT + Tenant | ADMIN | Invite user |
| `PUT` | `/:id/users/:userId` | JWT + Tenant | ADMIN | Update user role |
| `DELETE` | `/:id/users/:userId` | JWT + Tenant | ADMIN | Remove user |
| `PATCH` | `/:id/users/:userId/enabled` | JWT + Tenant | ADMIN | Toggle enabled |
| `PATCH` | `/:id/users/:userId/expiry` | JWT + Tenant | ADMIN | Set membership expiry |
| `PUT` | `/:id/users/:userId/email` | JWT + Tenant | ADMIN | Change user email |
| `PUT` | `/:id/users/:userId/password` | JWT + Tenant | ADMIN | Change user password |

### IP Allowlist

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| `GET` | `/:id/ip-allowlist` | JWT + Tenant | ADMIN | Get allowlist |
| `PUT` | `/:id/ip-allowlist` | JWT + Tenant | ADMIN | Update allowlist |

### Teams (`/api/teams`)

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| `POST` | `/` | JWT + Tenant | — | Create team |
| `GET` | `/` | JWT + Tenant | — | List teams |
| `GET` | `/:id` | JWT + Tenant | Member | Get team |
| `PUT` | `/:id` | JWT + Tenant | TEAM_ADMIN | Update team |
| `DELETE` | `/:id` | JWT + Tenant | TEAM_ADMIN | Delete team |
| `GET` | `/:id/members` | JWT + Tenant | Member | List members |
| `POST` | `/:id/members` | JWT + Tenant | TEAM_ADMIN | Add member |
| `PUT` | `/:id/members/:userId` | JWT + Tenant | TEAM_ADMIN | Update member role |
| `DELETE` | `/:id/members/:userId` | JWT + Tenant | TEAM_ADMIN | Remove member |
| `PATCH` | `/:id/members/:userId/expiry` | JWT + Tenant | TEAM_ADMIN | Set member expiry |

## Gateways (`/api/gateways`)

### Gateway CRUD

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| `GET` | `/` | JWT + Tenant | — | List gateways |
| `POST` | `/` | JWT + Tenant | OPERATOR | Create gateway |
| `PUT` | `/:id` | JWT + Tenant | OPERATOR | Update gateway |
| `DELETE` | `/:id` | JWT + Tenant | OPERATOR | Delete gateway |
| `POST` | `/:id/test` | JWT + Tenant | — | Test connectivity |

### SSH Key Management

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| `POST` | `/ssh-keypair` | JWT + Tenant | OPERATOR | Generate key pair |
| `GET` | `/ssh-keypair` | JWT + Tenant | OPERATOR | Get public key |
| `GET` | `/ssh-keypair/private` | JWT + Tenant | OPERATOR | Download private key |
| `POST` | `/ssh-keypair/rotate` | JWT + Tenant | OPERATOR | Rotate keys |
| `PATCH` | `/ssh-keypair/rotation` | JWT + Tenant | OPERATOR | Update rotation policy |
| `GET` | `/ssh-keypair/rotation` | JWT + Tenant | OPERATOR | Get rotation status |
| `POST` | `/:id/push-key` | JWT + Tenant | OPERATOR | Push key to gateway |

### Gateway Templates

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| `GET` | `/templates` | JWT + Tenant | OPERATOR | List templates |
| `POST` | `/templates` | JWT + Tenant | OPERATOR | Create template |
| `PUT` | `/templates/:templateId` | JWT + Tenant | OPERATOR | Update template |
| `DELETE` | `/templates/:templateId` | JWT + Tenant | OPERATOR | Delete template |
| `POST` | `/templates/:templateId/deploy` | JWT + Tenant | OPERATOR | Deploy from template |

### Managed Gateway Lifecycle

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| `POST` | `/:id/deploy` | JWT + Tenant | OPERATOR | Deploy managed gateway |
| `DELETE` | `/:id/deploy` | JWT + Tenant | OPERATOR | Undeploy gateway |
| `POST` | `/:id/scale` | JWT + Tenant | OPERATOR | Scale replicas |
| `GET` | `/:id/instances` | JWT + Tenant | OPERATOR | List instances |
| `POST` | `/:id/instances/:instanceId/restart` | JWT + Tenant | OPERATOR | Restart instance |
| `GET` | `/:id/instances/:instanceId/logs` | JWT + Tenant | OPERATOR | Get instance logs |
| `GET` | `/:id/scaling` | JWT + Tenant | OPERATOR | Get scaling config |
| `PUT` | `/:id/scaling` | JWT + Tenant | OPERATOR | Update auto-scaling |

### Zero-Trust Tunnel

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| `GET` | `/tunnel-overview` | JWT + Tenant | ADMIN | Fleet-wide tunnel status |
| `POST` | `/:id/tunnel-token` | JWT + Tenant | OPERATOR | Generate tunnel token |
| `DELETE` | `/:id/tunnel-token` | JWT + Tenant | OPERATOR | Revoke tunnel token |
| `POST` | `/:id/tunnel-disconnect` | JWT + Tenant | OPERATOR | Force disconnect |
| `GET` | `/:id/tunnel-events` | JWT + Tenant | OPERATOR | Get tunnel events |
| `GET` | `/:id/tunnel-metrics` | JWT + Tenant | OPERATOR | Get tunnel metrics |

## Administration

### Admin (`/api/admin`)

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| `GET` | `/email/status` | JWT | ADMIN | Email config status |
| `POST` | `/email/test` | JWT | ADMIN | Send test email |
| `GET` | `/app-config` | JWT | ADMIN | Get app configuration |
| `PUT` | `/app-config/self-signup` | JWT | ADMIN | Toggle self-signup |
| `GET` | `/auth-providers` | JWT | ADMIN | Get auth provider details |

### Audit Logs (`/api/audit`)

| Method | Path | Auth | Scope | Description |
|--------|------|------|-------|-------------|
| `GET` | `/` | JWT | User | User's audit logs |
| `GET` | `/gateways` | JWT | User | Gateways in audit |
| `GET` | `/countries` | JWT | User | Countries in audit |
| `GET` | `/tenant` | JWT + Tenant | ADMIN/AUDITOR | Tenant audit logs |
| `GET` | `/tenant/gateways` | JWT + Tenant | ADMIN/AUDITOR | Tenant audit gateways |
| `GET` | `/tenant/countries` | JWT + Tenant | ADMIN/AUDITOR | Tenant audit countries |
| `GET` | `/tenant/geo-summary` | JWT + Tenant | ADMIN/AUDITOR | Geographic summary |
| `GET` | `/connection/:connectionId/users` | JWT | — | Users who accessed connection |
| `GET` | `/connection/:connectionId` | JWT | — | Connection audit logs |

### Notifications (`/api/notifications`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/` | JWT | List notifications |
| `PUT` | `/read-all` | JWT | Mark all as read |
| `PUT` | `/:id/read` | JWT | Mark one as read |
| `DELETE` | `/:id` | JWT | Delete notification |

### Access Policies (`/api/access-policies`)

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| `GET` | `/` | JWT + Tenant | ADMIN | List policies |
| `POST` | `/` | JWT + Tenant | ADMIN | Create policy |
| `PUT` | `/:id` | JWT + Tenant | ADMIN | Update policy |
| `DELETE` | `/:id` | JWT + Tenant | ADMIN | Delete policy |

## External Integrations

### External Vault (`/api/vault-providers`)

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| `GET` | `/` | JWT + Tenant | ADMIN | List providers |
| `POST` | `/` | JWT + Tenant | ADMIN | Create provider |
| `GET` | `/:providerId` | JWT + Tenant | ADMIN | Get provider |
| `PUT` | `/:providerId` | JWT + Tenant | ADMIN | Update provider |
| `DELETE` | `/:providerId` | JWT + Tenant | ADMIN | Delete provider |
| `POST` | `/:providerId/test` | JWT + Tenant | ADMIN | Test connectivity |

### Sync Profiles (`/api/sync-profiles`)

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| `GET` | `/` | JWT + Tenant | ADMIN | List sync profiles |
| `POST` | `/` | JWT + Tenant | ADMIN | Create profile |
| `GET` | `/:id` | JWT + Tenant | ADMIN | Get profile |
| `PUT` | `/:id` | JWT + Tenant | ADMIN | Update profile |
| `DELETE` | `/:id` | JWT + Tenant | ADMIN | Delete profile |
| `POST` | `/:id/test` | JWT + Tenant | ADMIN | Test connection |
| `POST` | `/:id/sync` | JWT + Tenant | ADMIN | Trigger sync |
| `GET` | `/:id/logs` | JWT + Tenant | ADMIN | Get sync logs |

### LDAP (`/api/ldap`)

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| `GET` | `/status` | JWT | ADMIN | LDAP config status |
| `POST` | `/test` | JWT | ADMIN | Test LDAP connection |
| `POST` | `/sync` | JWT | ADMIN | Trigger LDAP sync |

## Utility Endpoints

### Files (`/api/files`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/` | JWT | List user files |
| `GET` | `/:name` | JWT | Download file |
| `POST` | `/` | JWT | Upload file (multipart, quota-checked) |
| `DELETE` | `/:name` | JWT | Delete file |

### Tabs (`/api/tabs`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/` | JWT | Get user's open tabs |
| `PUT` | `/` | JWT | Sync tabs |
| `DELETE` | `/` | JWT | Clear all tabs |

### GeoIP (`/api/geoip`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/:ip` | JWT | Lookup IP geolocation |

### Health (`/api`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | Public | Simple health check (status + version) |
| `GET` | `/ready` | Public | Readiness probe (DB + guacd) |

## Credential Checkout (PAM) (`/api/checkouts`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/` | JWT | List checkout requests (filter by role/status) |
| `POST` | `/` | JWT | Request credential checkout |
| `GET` | `/:id` | JWT | Get checkout request details |
| `POST` | `/:id/approve` | JWT | Approve pending checkout |
| `POST` | `/:id/reject` | JWT | Reject pending checkout |
| `POST` | `/:id/checkin` | JWT | Check in (return) credential |

## Password Rotation (`/api/secrets`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/:id/rotation/enable` | JWT | Enable automatic rotation |
| `POST` | `/:id/rotation/disable` | JWT | Disable rotation |
| `POST` | `/:id/rotation/trigger` | JWT | Manually trigger rotation |
| `GET` | `/:id/rotation/status` | JWT | Get rotation status |
| `GET` | `/:id/rotation/history` | JWT | Get rotation history |

## SSH Proxy (`/api/sessions/ssh-proxy`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/token` | JWT | Issue short-lived SSH proxy token |
| `GET` | `/status` | JWT | Get SSH proxy status |

## RD Gateway (`/api/rdgw`)

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| `GET` | `/config` | JWT + Tenant | ADMIN/OWNER | Get RD Gateway configuration |
| `PUT` | `/config` | JWT + Tenant | ADMIN/OWNER | Update RD Gateway configuration |
| `GET` | `/status` | JWT + Tenant | ADMIN/OWNER/OPERATOR | Get gateway status |
| `GET` | `/connections/:connectionId/rdpfile` | JWT | — | Generate .rdp file for native client |

## CLI Device Authorization (`/api/cli`)

| Method | Path | Auth | Rate Limit | Description |
|--------|------|------|------------|-------------|
| `POST` | `/auth/device` | Public | 20/15min | Initiate device authorization (RFC 8628) |
| `POST` | `/auth/device/token` | Public | 30/60s | Poll for device token |
| `POST` | `/auth/device/authorize` | JWT | — | Approve device from web UI |
| `GET` | `/connections` | JWT | — | List connections for CLI |

## Database Proxy (`/api/sessions/database`)

| Method | Path | Auth | Rate Limit | Description |
|--------|------|------|------------|-------------|
| `POST` | `/` | JWT | Session limit | Create database proxy session |
| `POST` | `/:sessionId/end` | JWT | — | End proxy session |
| `POST` | `/:sessionId/heartbeat` | JWT | — | Session heartbeat |
| `POST` | `/:sessionId/query` | JWT | — | Execute SQL query |
| `GET` | `/:sessionId/schema` | JWT | — | Get database schema |

## Database Tunnels (`/api/sessions/db-tunnel`)

| Method | Path | Auth | Rate Limit | Description |
|--------|------|------|------------|-------------|
| `POST` | `/` | JWT | Session limit | Open SSH-tunneled database connection |
| `GET` | `/` | JWT | — | List active tunnels |
| `POST` | `/:tunnelId/heartbeat` | JWT | — | Tunnel heartbeat |
| `DELETE` | `/:tunnelId` | JWT | — | Close tunnel |

## Database Audit & Firewall (`/api/db-audit`)

### Audit Logs

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| `GET` | `/logs` | JWT + Tenant | ADMIN/OWNER/AUDITOR | List database query audit logs |
| `GET` | `/logs/connections` | JWT + Tenant | ADMIN/OWNER/AUDITOR | Audit logs by connection |
| `GET` | `/logs/users` | JWT + Tenant | ADMIN/OWNER/AUDITOR | Audit logs by user |

### SQL Firewall Rules

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| `GET` | `/firewall-rules` | JWT + Tenant | ADMIN/OWNER/AUDITOR | List firewall rules |
| `GET` | `/firewall-rules/:ruleId` | JWT + Tenant | ADMIN/OWNER/AUDITOR | Get firewall rule |
| `POST` | `/firewall-rules` | JWT + Tenant | ADMIN/OWNER | Create firewall rule |
| `PUT` | `/firewall-rules/:ruleId` | JWT + Tenant | ADMIN/OWNER | Update firewall rule |
| `DELETE` | `/firewall-rules/:ruleId` | JWT + Tenant | ADMIN/OWNER | Delete firewall rule |

### Data Masking Policies

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| `GET` | `/masking-policies` | JWT + Tenant | ADMIN/OWNER/AUDITOR | List masking policies |
| `GET` | `/masking-policies/:policyId` | JWT + Tenant | ADMIN/OWNER/AUDITOR | Get masking policy |
| `POST` | `/masking-policies` | JWT + Tenant | ADMIN/OWNER | Create masking policy |
| `PUT` | `/masking-policies/:policyId` | JWT + Tenant | ADMIN/OWNER | Update masking policy |
| `DELETE` | `/masking-policies/:policyId` | JWT + Tenant | ADMIN/OWNER | Delete masking policy |

## System Settings (`/api/admin/system-settings`)

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| `GET` | `/` | JWT + Tenant | AUDITOR/ADMIN/OWNER | List all system settings |
| `PUT` | `/:key` | JWT + Tenant | ADMIN/OWNER | Update a single setting |
| `PUT` | `/` | JWT + Tenant | ADMIN/OWNER | Bulk update settings |

## Setup Wizard (`/api/setup`)

| Method | Path | Auth | Rate Limit | Description |
|--------|------|------|------------|-------------|
| `GET` | `/status` | Public | — | Check if initial setup is required |
| `POST` | `/complete` | Public | 5/min | Complete first-time platform setup |

## Keystroke Policies (`/api/keystroke-policies`)

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| `GET` | `/` | JWT + Tenant | ADMIN | List keystroke policies |
| `GET` | `/:id` | JWT + Tenant | ADMIN | Get keystroke policy |
| `POST` | `/` | JWT + Tenant | ADMIN | Create keystroke policy |
| `PUT` | `/:id` | JWT + Tenant | ADMIN | Update keystroke policy |
| `DELETE` | `/:id` | JWT + Tenant | ADMIN | Delete keystroke policy |

## WebSocket Namespaces

### SSH Terminal (`/ssh`)

Socket.IO namespace for SSH terminal sessions.

**Authentication:** JWT token in handshake auth.

**Client Events:**

| Event | Payload | Description |
|-------|---------|-------------|
| `start` | `{ connectionId, cols, rows, credentials? }` | Start SSH session |
| `data` | `string` | Terminal input (keystrokes) |
| `resize` | `{ cols, rows }` | Terminal resize |
| `sftp:list` | `{ path }` | List directory contents |
| `sftp:upload` | `{ path, data }` | Upload file via SFTP |
| `sftp:download` | `{ path }` | Download file via SFTP |
| `sftp:delete` | `{ path }` | Delete file via SFTP |
| `sftp:mkdir` | `{ path }` | Create directory via SFTP |
| `sftp:rename` | `{ oldPath, newPath }` | Rename file/directory |

**Server Events:**

| Event | Payload | Description |
|-------|---------|-------------|
| `data` | `string` | Terminal output |
| `ready` | `{ sessionId }` | SSH session established |
| `error` | `{ message }` | Connection error |
| `close` | — | Session ended |
| `sftp:list` | `FileEntry[]` | Directory listing |
| `sftp:data` | `Buffer` | Downloaded file data |
| `sftp:error` | `{ message }` | SFTP operation error |

### Notifications (`/notifications`)

Socket.IO namespace for real-time notifications.

**Server Events:**

| Event | Payload | Description |
|-------|---------|-------------|
| `CONNECTION_SHARED` | `{ connectionId, sharedBy }` | Connection shared with user |
| `SHARE_PERMISSION_UPDATED` | `{ connectionId, permission }` | Share permission changed |
| `SHARE_REVOKED` | `{ connectionId }` | Share revoked |
| `SECRET_SHARED` | `{ secretId, sharedBy }` | Secret shared with user |
| `SECRET_SHARE_REVOKED` | `{ secretId }` | Secret share revoked |
| `SECRET_EXPIRING` | `{ secretId, expiresAt }` | Secret expiring soon |
| `SECRET_EXPIRED` | `{ secretId }` | Secret expired |
| `TENANT_INVITATION` | `{ tenantId, role }` | Tenant invitation received |
| `RECORDING_READY` | `{ recordingId }` | Recording available |
| `IMPOSSIBLE_TRAVEL_DETECTED` | `{ auditLogId }` | Suspicious login detected |
| `SECRET_CHECKOUT_REQUESTED` | `{ checkoutId, secretId }` | Credential checkout requested |
| `SECRET_CHECKOUT_APPROVED` | `{ checkoutId }` | Checkout approved |
| `SECRET_CHECKOUT_DENIED` | `{ checkoutId }` | Checkout denied |
| `SECRET_CHECKOUT_EXPIRED` | `{ checkoutId }` | Checkout expired |
| `LATERAL_MOVEMENT_ALERT` | `{ userId, targets }` | Lateral movement anomaly detected |
| `SESSION_TERMINATED_POLICY_VIOLATION` | `{ policyName }` | SSH session terminated by keystroke policy |

### Gateway Monitor (`/gateways`)

Socket.IO namespace for real-time gateway status.

**Server Events:**

| Event | Payload | Description |
|-------|---------|-------------|
| `health-update` | `{ gatewayId, status, latency }` | Gateway health change |
| `instances-update` | `{ gatewayId, instances[] }` | Instance state change |
| `scaling-update` | `{ gatewayId, current, desired }` | Scaling event |
| `tunnel-status` | `{ gatewayId, connected, agent }` | Tunnel connection change |

### Tunnel Broker (`/api/tunnel/connect`)

Raw WebSocket endpoint for gateway tunnel agents.

**Authentication Headers:**
- `Authorization: Bearer <tunnel-token>`
- `X-Gateway-Id: <gateway-uuid>`
- `X-Agent-Version: <semver>` (optional)

**Binary Frame Protocol:**

| Frame Type | Value | Direction | Description |
|-----------|-------|-----------|-------------|
| OPEN | `0x01` | Server → Agent | Open TCP stream to target |
| DATA | `0x02` | Bidirectional | Stream data payload |
| CLOSE | `0x03` | Bidirectional | Close stream |
| PING | `0x04` | Agent → Server | Heartbeat with health data |
| PONG | `0x05` | Server → Agent | Heartbeat response |
