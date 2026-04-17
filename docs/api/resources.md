# Resource Endpoints

> Auto-generated on 2026-03-15 by /docs create api.
> Source of truth is the codebase. Run /docs update api after code changes.

## Notifications

All endpoints require authentication.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/notifications` | List notifications (paginated) |
| `PUT` | `/api/notifications/read-all` | Mark all as read |
| `PUT` | `/api/notifications/:id/read` | Mark one as read |
| `DELETE` | `/api/notifications/:id` | Delete a notification |

<!-- manual-start -->
<!-- manual-end -->

## Tabs

All endpoints require authentication.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tabs` | Get persisted tabs |
| `PUT` | `/api/tabs` | Sync tab state to server |
| `DELETE` | `/api/tabs` | Clear all persisted tabs |

Tabs are stored per tab instance, not per connection. Each persisted entry contains `id`, `connectionId`, `sortOrder`, and `isActive` so multiple tabs for the same connection can be restored independently.

<!-- manual-start -->
<!-- manual-end -->

## Secrets (Keychain)

All endpoints require authentication.

### CRUD

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/secrets` | List secrets (filterable by scope, type, tags) |
| `POST` | `/api/secrets` | Create secret |
| `GET` | `/api/secrets/:id` | Get secret details |
| `PUT` | `/api/secrets/:id` | Update secret |
| `DELETE` | `/api/secrets/:id` | Delete secret |

### Versioning

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/secrets/:id/versions` | List versions |
| `GET` | `/api/secrets/:id/versions/:version/data` | Get version data |
| `POST` | `/api/secrets/:id/versions/:version/restore` | Restore a version |

### Sharing

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/secrets/:id/share` | Share secret with a user |
| `DELETE` | `/api/secrets/:id/share/:userId` | Revoke sharing |
| `PUT` | `/api/secrets/:id/share/:userId` | Update share permission |
| `GET` | `/api/secrets/:id/shares` | List shares |

### External Sharing

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/secrets/:id/external-shares` | Create external share link |
| `GET` | `/api/secrets/:id/external-shares` | List external shares |
| `DELETE` | `/api/secrets/external-shares/:shareId` | Revoke external share |

### Tenant Vault

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/secrets/tenant-vault/init` | Initialize tenant vault |
| `POST` | `/api/secrets/tenant-vault/distribute` | Distribute tenant vault key to members |
| `GET` | `/api/secrets/tenant-vault/status` | Get tenant vault status |

<!-- manual-start -->
<!-- manual-end -->

## Public Share

Public endpoints for accessing externally shared secrets. No authentication required.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/share/:token/info` | Get share info (name, type, expiry) |
| `POST` | `/api/share/:token` | Access shared secret (with optional PIN). Rate limited: 10/min. |

<!-- manual-start -->
<!-- manual-end -->

## Files

All endpoints require authentication.

### RDP shared drive

These endpoints manage the staged RDP shared-drive view for a specific connection. `connectionId` is required on every request.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/files?connectionId=...` | List staged files for an RDP shared drive |
| `GET` | `/api/files/:name?connectionId=...` | Download a staged file |
| `POST` | `/api/files` | Upload a file to the staged RDP shared drive (`multipart/form-data` with `connectionId` + `file`) |
| `DELETE` | `/api/files/:name?connectionId=...` | Delete a staged file |

### SSH file browser

SSH file operations use dedicated REST endpoints and stage upload/download payloads through shared object storage before delivery.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/files/ssh/list` | List a remote SSH directory |
| `POST` | `/api/files/ssh/mkdir` | Create a remote SSH directory |
| `POST` | `/api/files/ssh/delete` | Delete a remote SSH file or empty directory |
| `POST` | `/api/files/ssh/rename` | Rename a remote SSH path |
| `POST` | `/api/files/ssh/upload` | Upload a local file to a remote SSH path through staged storage |
| `POST` | `/api/files/ssh/download` | Download a remote SSH file through staged storage |

<!-- manual-start -->
<!-- manual-end -->

## Audit

All endpoints require authentication.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/audit` | User | List personal audit logs (paginated, filterable) |
| `GET` | `/api/audit/countries` | User | List distinct countries in user's logs |
| `GET` | `/api/audit/gateways` | User | List distinct gateways in user's logs |
| `GET` | `/api/audit/tenant` | Admin/Owner/Auditor | List tenant-wide audit logs |
| `GET` | `/api/audit/tenant/countries` | Admin/Owner/Auditor | List distinct countries in tenant logs |
| `GET` | `/api/audit/tenant/gateways` | Admin/Owner/Auditor | List distinct gateways in tenant logs |
| `GET` | `/api/audit/tenant/geo-summary` | Admin/Owner/Auditor | Geographic summary with coordinates |
| `GET` | `/api/audit/connection/:connectionId` | User | Connection-scoped audit logs |
| `GET` | `/api/audit/connection/:connectionId/users` | User | Distinct users in connection logs |

<!-- manual-start -->
<!-- manual-end -->

## Recordings

All endpoints require authentication.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/recordings` | List session recordings |
| `GET` | `/api/recordings/:id` | Get recording metadata |
| `GET` | `/api/recordings/:id/stream` | Stream recording file |
| `GET` | `/api/recordings/:id/analyze` | Analyze .guac recording (command extraction) |
| `GET` | `/api/recordings/:id/video` | Export recording as video (via guacenc sidecar) |
| `DELETE` | `/api/recordings/:id` | Delete a recording |

<!-- manual-start -->
<!-- manual-end -->

## GeoIP

All endpoints require authentication.

### `GET /api/geoip/:ip`

Lookup IP geolocation. Uses MaxMind GeoLite2 database if configured, falls back to ip-api.com with caching.

**Response**: `{ country, city, lat, lon, ... }`

<!-- manual-start -->
<!-- manual-end -->

## Vault Folders

All endpoints require authentication. Used for organizing secrets (keychain) into folders.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/vault-folders` | List vault folders (tree structure) |
| `POST` | `/api/vault-folders` | Create a vault folder |
| `PUT` | `/api/vault-folders/:id` | Update a vault folder |
| `DELETE` | `/api/vault-folders/:id` | Delete a vault folder |

<!-- manual-start -->
<!-- manual-end -->

## LDAP

All endpoints require authentication with Admin tenant role.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/ldap/status` | Get LDAP integration status |
| `POST` | `/api/ldap/test` | Test LDAP connection |
| `POST` | `/api/ldap/sync` | Trigger manual LDAP sync |

<!-- manual-start -->
<!-- manual-end -->

## Sync Profiles

All endpoints require authentication with Admin tenant role. Used for external sync integrations (e.g., NetBox).

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/sync-profiles` | List sync profiles |
| `POST` | `/api/sync-profiles` | Create a sync profile |
| `GET` | `/api/sync-profiles/:id` | Get a sync profile |
| `PUT` | `/api/sync-profiles/:id` | Update a sync profile |
| `DELETE` | `/api/sync-profiles/:id` | Delete a sync profile |
| `POST` | `/api/sync-profiles/:id/test` | Test sync profile connectivity |
| `POST` | `/api/sync-profiles/:id/sync` | Trigger manual sync |
| `GET` | `/api/sync-profiles/:id/logs` | Get sync logs (paginated) |

<!-- manual-start -->
<!-- manual-end -->

## External Vault Providers

All endpoints require authentication with Admin tenant role. Used for managing HashiCorp Vault external credential providers.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/vault-providers` | List vault providers |
| `POST` | `/api/vault-providers` | Create a vault provider |
| `GET` | `/api/vault-providers/:providerId` | Get a vault provider |
| `PUT` | `/api/vault-providers/:providerId` | Update a vault provider |
| `DELETE` | `/api/vault-providers/:providerId` | Delete a vault provider |
| `POST` | `/api/vault-providers/:providerId/test` | Test vault provider connectivity |

<!-- manual-start -->
<!-- manual-end -->
