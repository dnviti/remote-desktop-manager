# API Layer

> Auto-generated on 2026-03-15 by /docs create components.
> Source of truth is the codebase. Run /docs update components after code changes.

29 API modules in `client/src/api/` provide typed Axios wrappers:

| Module | Description |
|--------|-------------|
| `client.ts` | Axios instance with JWT interceptor and auto-refresh |
| `auth.api.ts` | Login, register, MFA flows, refresh, logout, public config |
| `connections.api.ts` | Connection CRUD, favorites |
| `folders.api.ts` | Folder CRUD |
| `sharing.api.ts` | Connection sharing + RDP/SSH session creation |
| `vault.api.ts` | Vault lock/unlock, MFA unlock, auto-lock, password reveal |
| `vault-folders.api.ts` | Vault folder CRUD (create, update, delete, list) |
| `user.api.ts` | Profile, settings, identity verification, domain profile |
| `audit.api.ts` | Personal, tenant, and connection audit logs, geo data |
| `gateway.api.ts` | Gateway CRUD, SSH keys, orchestration, templates, sessions |
| `tenant.api.ts` | Tenant CRUD, user management, MFA stats |
| `team.api.ts` | Team CRUD, member management |
| `secrets.api.ts` | Keychain CRUD, versioning, sharing, external shares, tenant vault |
| `recordings.api.ts` | Session recording listing, streaming, video export |
| `sessions.api.ts` | Session monitoring (active, count, terminate) |
| `oauth.api.ts` | OAuth providers, linked accounts, vault setup |
| `importExport.api.ts` | Connection import/export |
| `twofa.api.ts` | TOTP 2FA setup/verify/disable |
| `smsMfa.api.ts` | SMS MFA setup/verify/enable/disable |
| `webauthn.api.ts` | WebAuthn credential management |
| `passwordReset.api.ts` | Password reset flow |
| `admin.api.ts` | Admin config (email status, self-signup) |
| `tabs.api.ts` | Tab state persistence |
| `files.api.ts` | RDP drive file management |
| `email.api.ts` | Email verification resend |
| `notifications.api.ts` | Notification listing and management |
| `ldap.api.ts` | LDAP status, connection test, and sync trigger |
| `sync.api.ts` | Sync profile CRUD, test connection, trigger sync, logs |
| `externalVault.api.ts` | External vault provider CRUD (HashiCorp Vault), test connectivity |

<!-- manual-start -->
<!-- manual-end -->
