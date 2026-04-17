# Enums

> Auto-generated on 2026-03-15 by /docs create database.
> Source of truth is the codebase. Run /docs update database after code changes.

| Enum | Values |
|------|--------|
| **ConnectionType** | `RDP`, `SSH`, `VNC`, `DATABASE` |
| **GatewayType** | `GUACD`, `SSH_BASTION`, `MANAGED_SSH`, `DB_PROXY` |
| **Permission** | `READ_ONLY`, `FULL_ACCESS` |
| **TenantRole** | `OWNER`, `ADMIN`, `OPERATOR`, `MEMBER`, `CONSULTANT`, `AUDITOR`, `GUEST` |
| **TeamRole** | `TEAM_ADMIN`, `TEAM_EDITOR`, `TEAM_VIEWER` |
| **SecretType** | `LOGIN`, `SSH_KEY`, `CERTIFICATE`, `API_KEY`, `SECURE_NOTE` |
| **SecretScope** | `PERSONAL`, `TEAM`, `TENANT` |
| **SessionProtocol** | `SSH`, `RDP`, `VNC` |
| **SessionStatus** | `ACTIVE`, `IDLE`, `PAUSED`, `CLOSED` |
| **AuthProvider** | `LOCAL`, `GOOGLE`, `MICROSOFT`, `GITHUB`, `OIDC`, `SAML`, `LDAP` |
| **GatewayHealthStatus** | `UNKNOWN`, `REACHABLE`, `UNREACHABLE` |
| **ManagedInstanceStatus** | `PROVISIONING`, `RUNNING`, `STOPPED`, `ERROR`, `REMOVING` |
| **LoadBalancingStrategy** | `ROUND_ROBIN`, `LEAST_CONNECTIONS` |
| **NotificationType** | `CONNECTION_SHARED`, `SHARE_PERMISSION_UPDATED`, `SHARE_REVOKED`, `SECRET_SHARED`, `SECRET_SHARE_REVOKED`, `SECRET_EXPIRING`, `SECRET_EXPIRED`, `TENANT_INVITATION`, `RECORDING_READY`, `IMPOSSIBLE_TRAVEL_DETECTED` |
| **RecordingStatus** | `RECORDING`, `COMPLETE`, `ERROR` |
| **ExternalVaultAuthMethod** | `TOKEN`, `APPROLE` |
| **SyncProvider** | `NETBOX` |
| **SyncStatus** | `PENDING`, `RUNNING`, `SUCCESS`, `PARTIAL`, `ERROR` |
| **AccessPolicyTargetType** | `TENANT`, `TEAM`, `FOLDER` |
| **AuditAction** | 100+ values — see `backend/migrations/*.sql` for the current migration set |

### New AuditAction Values (Tunnel, ABAC, and Session Control)

The following `AuditAction` values were added for zero-trust tunnel, ABAC, and admin session control features:

| Value | Description |
|-------|-------------|
| `TUNNEL_CONNECT` | Tunnel agent successfully connected via WebSocket |
| `TUNNEL_DISCONNECT` | Tunnel agent disconnected |
| `TUNNEL_TOKEN_GENERATE` | A new tunnel agent token was generated for a gateway |
| `TUNNEL_TOKEN_ROTATE` | A tunnel agent token was revoked/rotated |
| `SESSION_DENIED_ABAC` | A session was denied by an ABAC access policy evaluation |
| `SESSION_PAUSE` | An administrator paused a live session |
| `SESSION_RESUME` | An administrator resumed a paused live session |
| `DB_QUERY_EXECUTED` | A database query was executed through the DB proxy |
| `DB_QUERY_BLOCKED` | A database query was blocked by the SQL firewall |
| `CHECKOUT_REQUESTED` | A credential checkout was requested |
| `CHECKOUT_APPROVED` | A credential checkout was approved |
| `CHECKOUT_DENIED` | A credential checkout was denied |
| `CHECKOUT_RETURNED` | A credential checkout was checked back in |
| `PASSWORD_ROTATED` | An automatic password rotation was performed |
| `KEYSTROKE_ALERT` | A keystroke policy triggered an alert |
| `KEYSTROKE_BLOCKED` | A keystroke policy blocked and terminated a session |
| `LATERAL_MOVEMENT_DETECTED` | Lateral movement anomaly detected (MITRE T1021) |

### Database Session and Audit Enums

| Enum | Values |
|------|--------|
| **CheckoutStatus** | `PENDING`, `APPROVED`, `DENIED`, `ACTIVE`, `RETURNED`, `EXPIRED` |
| **FirewallAction** | `BLOCK`, `ALLOW` |
| **MaskingType** | `FULL`, `PARTIAL`, `HASH`, `REDACT` |
| **KeystrokePolicyAction** | `BLOCK_AND_TERMINATE`, `ALERT_ONLY` |

<!-- manual-start -->
<!-- manual-end -->
