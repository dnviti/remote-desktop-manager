# Authentication

> Auto-generated on 2026-03-15 by /docs create security.
> Source of truth is the codebase. Run /docs update security after code changes.

## Vault Session Management

### Session Lifecycle

1. **Unlock**: User provides password (or MFA for re-unlock). Master key is decrypted and stored in the in-memory `vaultStore` Map.
2. **Active**: Every vault access resets the TTL (sliding window). Default TTL: 30 minutes (`VAULT_TTL_MINUTES`).
3. **Soft lock**: TTL expiry or manual lock clears the vault session but preserves the recovery entry for MFA re-unlock.
4. **Hard lock**: Logout or password change clears both the vault session AND the recovery entry.
5. **Auto-expiry**: A cleanup interval runs every 60 seconds, zeroing out expired master keys and deleting sessions.

### Memory Cleanup

- Master keys are zeroed (`buffer.fill(0)`) before deletion from the store
- The periodic cleanup interval (60s) catches both expired vault sessions, team vault sessions, tenant vault sessions, and recovery entries
- Team and tenant vault sessions are locked in cascade when the user's vault session expires

### Vault Recovery (MFA Re-unlock)

When the vault is unlocked with a password, the master key is also encrypted with the `SERVER_ENCRYPTION_KEY` and stored in the recovery store (`vaultRecoveryStore`). This allows MFA-based re-unlock after TTL expiry:

1. User's vault expires
2. User triggers MFA vault unlock (TOTP, SMS, or WebAuthn)
3. Server verifies MFA, retrieves the recovery entry, decrypts the master key
4. New vault session is created

The recovery entry has its own TTL matching `JWT_REFRESH_EXPIRES_IN` (default: 7 days).

### Auto-Lock Preference

Users can configure a custom vault auto-lock timer:
- `null` = use server default (VAULT_TTL_MINUTES)
- `0` = never auto-lock
- `> 0` = custom minutes

Tenant admins can enforce a maximum auto-lock duration (`vaultAutoLockMaxMinutes`), capping what users can set.

<!-- manual-start -->
<!-- manual-end -->

## Authentication

### JWT Token Structure

- **Access token**: Short-lived (default: 15 minutes, configurable via `JWT_EXPIRES_IN`)
  - Payload: `{ userId, email, tenantId?, tenantRole? }`
  - Signed with `JWT_SECRET` using HS256
- **Refresh token**: Long-lived (default: 7 days, configurable via `JWT_REFRESH_EXPIRES_IN`)
  - Stored as a UUID in the `RefreshToken` database table
  - Delivered via httpOnly, Secure (production), SameSite=strict cookie named `arsenale-rt`

### Refresh Token Rotation

Refresh tokens use a **family-based rotation** scheme with reuse detection:

1. Each login creates a new token family (random UUID)
2. On refresh, the old token is revoked and a new token is issued in the same family
3. If a revoked token is reused (potential theft), the entire token family is revoked
4. A 30-second grace period allows concurrent requests during rotation
5. Token reuse triggers an `REFRESH_TOKEN_REUSE` audit log entry

### CSRF Protection

State-changing auth endpoints (`/refresh`, `/logout`, `/switch-tenant`) require an `X-CSRF-Token` header matching the CSRF token delivered alongside the access token. The CSRF token is stored in a non-httpOnly cookie (`arsenale-csrf`) so the client JavaScript can read and include it.

### Client-Side Auto-Refresh

The Axios client interceptor (`client/src/api/client.ts`):

1. Attaches `Authorization: Bearer <jwt>` to every request
2. On 401 response, attempts to refresh the access token
3. Uses a **single-flight pattern**: only the first 401 triggers a refresh; subsequent concurrent 401s wait for the same promise
4. On refresh success, retries the original request with the new token
5. On refresh failure, calls `logout()` to clear all auth state

### Socket.IO JWT Middleware

Socket.IO namespaces (`/ssh`, `/notifications`, `/gateway-monitor`) authenticate via JWT in the handshake:

```typescript
sshNamespace.use((socket, next) => {
  const token = socket.handshake.auth.token;
  // verify JWT, attach payload to socket
});
```

### Rate Limiting and Account Lockout

All rate limiters are built via a shared `rateLimitFactory` (`server/src/middleware/rateLimitFactory.ts`) that wraps `express-rate-limit` with standard headers and optional per-user keying.

| Protection | Threshold | Window | Key |
|-----------|-----------|--------|-----|
| Login | 5 attempts | 15 min | IP |
| Registration | 5 attempts | 1 hour | IP |
| Account lockout | 10 consecutive failures | 30 min | User |
| Vault unlock (password) | 5 attempts | 1 min | User |
| Vault unlock (MFA) | 10 attempts | 1 min | User |
| Session endpoints | 20 requests | 1 min | User |
| OAuth flow (initiate/callback) | 20 requests | 15 min | IP |
| OAuth account management | 15 requests | 1 min | User |
| OAuth account linking | 10 attempts | 15 min | IP |
| SMS MFA send | 3 requests | 10 min | User / IP |
| Password reset request | 3 requests | 15 min | IP |
| Password reset submit | 5 attempts | 15 min | IP |
| Password reset SMS | 3 requests | 10 min | IP |
| Identity verification | 3 requests | 15 min | User |
| External share access | 10 per IP | 1 min | IP |

Account lockout is tracked per-user (`failedLoginAttempts`, `lockedUntil` fields). Successful login resets the counter.

All thresholds are configurable via environment variables (see `docs/environment.md` — Rate Limiting & Account Lockout section).

<!-- manual-start -->
<!-- manual-end -->

## Token Binding

Token binding ties JWT access tokens and refresh tokens to the originating client's IP address and User-Agent. A SHA-256 hash of the IP+UA is stored in the `RefreshToken` record (`ipUaHash` field).

- If a refresh token is presented from a different IP or User-Agent, the token is rejected and the entire token family is revoked
- A `TOKEN_HIJACK_ATTEMPT` audit event is logged for security monitoring
- Enabled by default; disable via `TOKEN_BINDING_ENABLED=false` for environments with dynamic IPs (e.g., mobile clients, VPNs)
- Tokens issued before binding was enabled are accepted without verification for backward compatibility

<!-- manual-start -->
<!-- manual-end -->

## Session Limits (OWASP A07)

Tenant administrators can enforce two session-level controls:

| Policy | Field | Default | Description |
|--------|-------|---------|-------------|
| **Max concurrent sessions** | `maxConcurrentSessions` | 0 (unlimited) | When exceeded, the oldest active session family is evicted |
| **Absolute session timeout** | `absoluteSessionTimeoutSeconds` | 43200 (12h) | Forces re-authentication after a fixed duration regardless of activity |

- `SESSION_LIMIT_EXCEEDED` and `SESSION_ABSOLUTE_TIMEOUT` audit actions are logged when these controls trigger
- Configured in Settings → Administration → Security

<!-- manual-start -->
<!-- manual-end -->

## LDAP Authentication

LDAP authentication (`server/src/services/ldap.service.ts`) supports secure directory-based login:

- **Bind verification**: User credentials are verified via LDAP bind against the configured server
- **STARTTLS**: Optional STARTTLS upgrade for encrypted connections (`LDAP_STARTTLS=true`)
- **TLS certificate validation**: Configurable via `LDAP_TLS_REJECT_UNAUTHORIZED` (default: `true`)
- **Group-based access control**: When `LDAP_ALLOWED_GROUPS` is set, only members of listed groups can authenticate
- **Auto-provisioning**: New users are automatically created on first LDAP login (configurable via `LDAP_AUTO_PROVISION`)
- **Periodic sync**: Optional cron-based user/group synchronization (`LDAP_SYNC_ENABLED`, `LDAP_SYNC_CRON`)

<!-- manual-start -->
<!-- manual-end -->
