# Security Policies

> Auto-generated on 2026-03-15 by /docs create security.
> Source of truth is the codebase. Run /docs update security after code changes.

> Runtime note: the current authorization and policy enforcement path is Go-first. Any `server/src` references below are historical notes kept for migration context.

## Connection Sharing Security

When a connection is shared with another user, credentials are **re-encrypted** for the recipient:

1. The sharer's vault must be unlocked (master key in memory)
2. Connection credentials are decrypted with the sharer's master key
3. The recipient's public vault key is used to re-encrypt the credentials
4. The re-encrypted credentials are stored in the `SharedConnection` record
5. The recipient can only decrypt with their own master key when their vault is unlocked

This means the server never stores credentials in plaintext, and a compromised recipient cannot access the sharer's vault key.

The same re-encryption model applies to **secret sharing** (`SharedSecret`).

### External Sharing

External shares (shareable links for secrets) use a different key derivation:

1. A random token is generated and given to the creator
2. A key is derived from the token using **HKDF-SHA256** with the share ID as info and an optional salt
3. The secret data is encrypted with this derived key
4. Only the token hash (SHA-256) is stored in the database
5. Optional **PIN protection**: when enabled, the key is derived from `token + PIN` using Argon2id

<!-- manual-start -->
<!-- manual-end -->

## IP Allowlist

Tenant-level IP allowlists restrict which IP addresses and CIDR ranges may log in to a tenant.

| Mode | Behavior |
|------|----------|
| `flag` | Login succeeds; `UNTRUSTED_IP` flag appended to audit log |
| `block` | Login rejected with 403; `LOGIN_FAILURE` audit event logged with `reason: "ip_not_allowed"` |

- Checked at every token-issuance point: password login, TOTP, SMS MFA, WebAuthn, OAuth, SAML
- An empty allowlist with the feature enabled means all IPs are untrusted
- API: `GET /api/tenants/:id/ip-allowlist` and `PUT /api/tenants/:id/ip-allowlist` (admin only)

<!-- manual-start -->
<!-- manual-end -->

## DLP Policies

Data Loss Prevention policies control clipboard and file operations in remote sessions.

**Tenant-level controls** (floor that applies to all connections):

| Field | Description |
|-------|-------------|
| `dlpDisableCopy` | Block clipboard copy from remote to local |
| `dlpDisablePaste` | Block clipboard paste from local to remote |
| `dlpDisableDownload` | Block file download from remote |
| `dlpDisableUpload` | Block file upload to remote |

**Per-connection overrides** (`Connection.dlpPolicy` JSON field): can only be **more** restrictive than the tenant floor (logical OR / most-restrictive wins).

**Protocol enforcement:**
- **RDP/VNC**: Clipboard via Guacamole `disable-copy`/`disable-paste` parameters + client-side defense-in-depth. File transfer via Guacamole parameters + server-side API guards.
- **SSH**: Clipboard enforced client-side in terminal (Ctrl+Shift+C/V). SFTP enforced **server-side** in the Socket.IO handler (authoritative), with client-side UI hiding as defense-in-depth.

DLP policy changes are tracked under the `TENANT_DLP_POLICY_UPDATE` audit action.

<!-- manual-start -->
<!-- manual-end -->

## Impossible Travel Detection

Consecutive authentication events are checked for geographically implausible velocity using the Haversine formula:

1. After each auth-related audit event (login, OAuth, TOTP, SMS, WebAuthn, LDAP), the previous event with geo-coordinates is fetched
2. The distance between the two locations is calculated using the Haversine formula (great-circle distance)
3. Locations closer than 50 km are skipped (same metro area / VPN noise)
4. If the required travel speed exceeds `IMPOSSIBLE_TRAVEL_SPEED_KMH` (default: 900 km/h), the event is flagged
5. An `IMPOSSIBLE_TRAVEL_DETECTED` audit entry is created with distance, time delta, and required speed
6. Tenant admins (OWNER, ADMIN roles) are notified via the in-app notification system

Set `IMPOSSIBLE_TRAVEL_SPEED_KMH=0` to disable detection entirely. Requires GeoIP to be configured (`GEOIP_DB_PATH`).

Source: `server/src/services/impossibleTravel.service.ts`

<!-- manual-start -->
<!-- manual-end -->

## Host Validation / SSRF Prevention

All user-supplied connection hostnames are validated before use to prevent Server-Side Request Forgery (SSRF):

1. The hostname `localhost` is always rejected
2. If the input is an IP address, it is checked directly; otherwise DNS resolution (`resolve4`, `resolve6`, and `lookup`) is performed and all resolved IPs are checked
3. **Always blocked**: loopback (`127.0.0.0/8`, `::1`), wildcard (`0.0.0.0`, `::`), link-local (`169.254.0.0/16`, `fe80::/10`), and the server's own interface IPs
4. **Blocked by default**: private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, IPv6 ULA `fc00::/7`). Set `ALLOW_LOCAL_NETWORK=true` to allow private network connections (for LAN deployments)

Source: `server/src/utils/hostValidation.ts`

<!-- manual-start -->
<!-- manual-end -->

## Attribute-Based Access Control (ABAC)

ABAC policies (stored in the `AccessPolicy` model) add contextual constraints to session access. Each policy targets a **Tenant**, **Team**, or **Folder** and enforces one or more of the following attributes:

### Policy Evaluation Flow

1. When a user opens a remote session (SSH, RDP, or VNC), the server collects the **ABAC context**: folder ID, team ID, tenant ID, whether WebAuthn was used in the current login, and whether MFA step-up was completed.
2. All `AccessPolicy` records matching the connection's folder, team, and tenant are fetched in a single query.
3. Policies are sorted by specificity: **FOLDER > TEAM > TENANT** (most specific first).
4. Each policy is evaluated in order. The first denial short-circuits — access is denied immediately.
5. If all policies pass (or no policies exist), access is granted.

### Additive Policy Semantics

Policies are **additive** (conjunctive): every applicable policy must pass for access to be granted. A permissive TENANT policy cannot override a restrictive FOLDER policy. The most restrictive combination always wins.

### Constraint Types

| Constraint | Field | Behavior |
|-----------|-------|----------|
| **Time window** | `allowedTimeWindows` | Comma-separated `HH:MM-HH:MM` UTC windows. Access is allowed if the current UTC time falls within **any** window. Overnight windows (e.g., `22:00-06:00`) are supported. Malformed windows fail closed (treated as deny). |
| **Trusted device** | `requireTrustedDevice` | The user must have authenticated with a **WebAuthn credential** (FIDO2/passkey) during the current login session. |
| **MFA step-up** | `requireMfaStepUp` | The user must have completed an **MFA challenge** (TOTP or WebAuthn) during the current login session. |

### Denial Handling

When a policy denies access:

- The denial reason is one of: `outside_working_hours`, `untrusted_device`, or `mfa_step_up_required`
- A `SESSION_DENIED_ABAC` audit log entry is created with the denial reason, policy ID, target type/ID, and GeoIP data
- The caller receives a 403 response

Source: `backend/internal/accesspolicies/service.go`

<!-- manual-start -->
<!-- manual-end -->

## Input Validation

All API endpoints use Zod schema validation via the `validate` middleware (`server/src/middleware/validate.middleware.ts`):

- Supports validating `body`, `query`, and `params` independently or together
- Invalid input returns 400 with the first Zod issue message
- Validated data replaces the raw request properties (type-safe downstream)
- UUID path parameters are validated via `validateUuidParam` helper

<!-- manual-start -->
<!-- manual-end -->
