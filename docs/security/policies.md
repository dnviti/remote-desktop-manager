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
- **RDP/VNC**: Clipboard via Guacamole `disable-copy`/`disable-paste` parameters + client-side defense-in-depth. RDP shared-drive transfers are gated by the staged-file API and materialized into the Guacamole drive cache only after policy checks.
- **SSH**: Clipboard enforced client-side in terminal (Ctrl+Shift+C/V). Remote file browsing uses authenticated REST endpoints under `/api/files/ssh/*`, and upload/download payloads are staged server-side before delivery to the target host or browser.

**Threat scanning:** staged file payloads are scanned before delivery. The builtin scanner currently blocks the EICAR test signature. Files rejected by scanning return HTTP 422 and are not delivered to the remote target or the browser.

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

Source: `backend/internal/auditapi/impossible_travel.go`

<!-- manual-start -->
<!-- manual-end -->

## Lateral Movement Anomaly Detection

Arsenale detects lateral movement patterns consistent with MITRE ATT&CK T1021 (Remote Services). When a user initiates sessions to multiple hosts in rapid succession using the same or different protocols, the system evaluates the pattern against configurable thresholds.

- Session velocity and target diversity are tracked per user within a rolling time window
- Anomalous patterns trigger an `LATERAL_MOVEMENT_DETECTED` audit entry
- Tenant admins receive in-app notifications for flagged patterns
- Detection complements (but does not replace) ABAC policy enforcement

<!-- manual-start -->
<!-- manual-end -->

## Pwned Password Check

User passwords are checked against the HaveIBeenPwned database using the k-Anonymity API:

1. The password is SHA-1 hashed
2. The first 5 characters of the hash are sent to the HIBP API
3. The API returns all matching hash suffixes
4. The full hash is compared locally (password never leaves the server)
5. If the password appears in a known breach, registration or password change is rejected

Controlled by `HIBP_FAIL_OPEN` (default: `false`). When `true`, passwords are allowed if the HIBP API is unreachable.

<!-- manual-start -->
<!-- manual-end -->

## Host Validation / SSRF Prevention

All user-supplied connection hostnames are validated before use to prevent Server-Side Request Forgery (SSRF):

1. The hostname `localhost` is always rejected (unless `ALLOW_LOOPBACK=true`)
2. If the input is an IP address, it is checked directly; otherwise DNS resolution is performed and all resolved IPs are checked
3. **Always blocked**: wildcard (`0.0.0.0`, `::`), link-local (`169.254.0.0/16`, `fe80::/10`), and the server's own interface IPs
4. **Blocked by default**: loopback (`127.0.0.0/8`, `::1`) unless `ALLOW_LOOPBACK=true`; private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, IPv6 ULA `fc00::/7`) unless `ALLOW_LOCAL_NETWORK=true`

Source: `backend/internal/connections/host_validation.go`

<!-- manual-start -->
<!-- manual-end -->

## SQL Firewall

The DB proxy enforces regex-based SQL firewall rules on all queries before execution:

1. Firewall rules are defined per tenant via `/api/db-audit/firewall-rules`
2. Each rule has a regex pattern, priority, and BLOCK or ALLOW action
3. Rules are evaluated in priority order; the first match determines the outcome
4. Blocked queries return an error to the user and create a `DB_QUERY_BLOCKED` audit entry
5. Built-in rules block dangerous patterns (e.g., `DROP DATABASE`, `TRUNCATE`, administrative commands)

Source: `backend/internal/dbauditapi/firewall.go`

<!-- manual-start -->
<!-- manual-end -->

## Data Masking

Column-level masking policies are applied after database query execution in the control plane:

| Mask Type | Behavior |
|-----------|----------|
| `FULL` | Replace entire value with `***` |
| `PARTIAL` | Show first/last characters, mask middle |
| `HASH` | Replace with SHA-256 hash prefix |
| `REDACT` | Remove value entirely (null) |

Masking policies match column names via regex and are managed via `/api/db-audit/masking-policies`.

Source: `backend/internal/dbauditapi/masking.go`

<!-- manual-start -->
<!-- manual-end -->

## SSH Keystroke Inspection

Real-time SSH keystroke inspection policies evaluate terminal input against regex patterns:

1. Keystroke policies are defined per tenant via `/api/keystroke-policies`
2. Each policy has a regex pattern and an action: `BLOCK_AND_TERMINATE` or `ALERT_ONLY`
3. The terminal broker applies policies in real-time to SSH session input
4. `BLOCK_AND_TERMINATE` immediately closes the session and creates a `KEYSTROKE_BLOCKED` audit entry
5. `ALERT_ONLY` creates a `KEYSTROKE_ALERT` audit entry and notifies tenant admins

Source: `backend/internal/keystrokepolicies/service.go`

<!-- manual-start -->
<!-- manual-end -->

## Credential Checkout / PAM

Temporary credential checkout/check-in with approval workflow for privileged access management:

1. A user requests checkout of a connection's credentials via `/api/checkouts`
2. The request requires a justification reason and a requested duration
3. Tenant admins or operators receive a notification and can approve or deny
4. Approved checkouts grant temporary access to the connection credentials
5. Credentials are automatically returned (checked in) when the checkout expires
6. All checkout lifecycle events are audited

Source: `backend/internal/checkouts/service.go`

<!-- manual-start -->
<!-- manual-end -->

## Password Rotation

Automatic password rotation on target systems for stored credentials:

1. Password rotation can be enabled per secret via `/api/secrets/{id}/rotation/enable`
2. Rotation schedules are configurable (daily, weekly, monthly, or custom cron)
3. When triggered, the system connects to the target and changes the password
4. The new password is encrypted and stored as a new secret version
5. Rotation history is tracked and viewable via `/api/secrets/rotation/history`

Source: `backend/internal/passwordrotationapi/service.go`

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

All API endpoints use structured validation in Go middleware:

- Request bodies are decoded and validated before reaching handlers
- Invalid input returns 400 with structured error messages
- UUID path parameters are validated at the routing layer
- Query parameters are parsed with type-safe defaults

<!-- manual-start -->
<!-- manual-end -->
