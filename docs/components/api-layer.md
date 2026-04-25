# API Layer

> Auto-generated on 2026-03-15 by /docs create components.
> Source of truth is the codebase. Run /docs update components after code changes.

40 API modules in `client/src/api/` provide typed Axios wrappers:

| Module | Description |
|--------|-------------|
| `client.ts` | Axios instance with JWT interceptor, browser CSRF cookie handling, and browser-session restore on 401 |
| `accessPolicy.api.ts` | ABAC access policy CRUD and evaluation |
| `admin.api.ts` | Admin config (email status, self-signup, system settings) |
| `aiQuery.api.ts` | Named AI backend config, feature defaults, natural-language-to-SQL generation, and query optimization |
| `audit.api.ts` | Personal, tenant, and connection audit logs, geo data, geo summary |
| `auth.api.ts` | Passkey-first login, password fallback, MFA flows, browser-session restore/touch, logout, public config |
| `checkout.api.ts` | Credential checkout/check-in with approval workflow |
| `connections.api.ts` | Connection CRUD, favorites, CLI listing |
| `database.api.ts` | Database session query execution, schema, explain, introspection, history |
| `dbAudit.api.ts` | Database audit logs, SQL firewall rules, masking policies, rate-limit policies |
| `email.api.ts` | Email verification resend |
| `externalVault.api.ts` | External vault provider CRUD (HashiCorp Vault), test connectivity |
| `files.api.ts` | RDP drive file management |
| `folders.api.ts` | Folder CRUD |
| `gateway.api.ts` | Gateway CRUD, derived operational status, SSH keys, orchestration, templates, sessions, tunnel controls |
| `importExport.api.ts` | Connection import/export (CSV, JSON, mRemoteNG, RDP) |
| `ldap.api.ts` | LDAP status, connection test, and sync trigger |
| `live.api.ts` | SSE subscription helpers for gateways, sessions, audit, and vault streams |
| `notifications.api.ts` | Notification listing, preferences, read state, and management |
| `oauth.api.ts` | OAuth providers, linked accounts, vault setup |
| `passwordReset.api.ts` | Password reset flow |
| `rdGateway.api.ts` | RD Gateway (MS-TSGU) config and RDP file generation |
| `recordings.api.ts` | Session recording listing, streaming, analysis, and video export |
| `secrets.api.ts` | Keychain CRUD, versioning, sharing, external shares, tenant vault, password rotation |
| `sessions.api.ts` | Session monitoring (active, count, terminate), SSH proxy tokens |
| `setup.api.ts` | First-run setup wizard status and completion |
| `sharing.api.ts` | Connection sharing + RDP/SSH session creation |
| `smsMfa.api.ts` | SMS MFA setup/verify/enable/disable |
| `sse.ts` | Server-sent events client and EventSource management |
| `sync.api.ts` | Sync profile CRUD, test connection, trigger sync, logs |
| `systemSettings.api.ts` | Admin system settings CRUD, auth provider configuration |
| `tabs.api.ts` | Tab state persistence |
| `team.api.ts` | Team CRUD, member management |
| `tenant.api.ts` | Tenant CRUD, user management, MFA stats, IP allowlist |
| `twofa.api.ts` | TOTP 2FA setup/verify/disable |
| `user.api.ts` | Profile, settings, identity verification, domain profile, notification schedule |
| `vault.api.ts` | Vault lock/unlock, activity touch, passkey-first re-unlock, auto-lock, password reveal, recovery |
| `vault-folders.api.ts` | Vault folder CRUD (create, update, delete, list) |
| `version.api.ts` | Version check and update notification |
| `webauthn.api.ts` | WebAuthn credential management |

<!-- manual-start -->
<!-- manual-end -->
