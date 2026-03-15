# Enums

> Auto-generated on 2026-03-15 by /docs create database.
> Source of truth is the codebase. Run /docs update database after code changes.

| Enum | Values |
|------|--------|
| **ConnectionType** | `RDP`, `SSH`, `VNC` |
| **GatewayType** | `GUACD`, `SSH_BASTION`, `MANAGED_SSH` |
| **Permission** | `READ_ONLY`, `FULL_ACCESS` |
| **TenantRole** | `OWNER`, `ADMIN`, `OPERATOR`, `MEMBER`, `CONSULTANT`, `AUDITOR`, `GUEST` |
| **TeamRole** | `TEAM_ADMIN`, `TEAM_EDITOR`, `TEAM_VIEWER` |
| **SecretType** | `LOGIN`, `SSH_KEY`, `CERTIFICATE`, `API_KEY`, `SECURE_NOTE` |
| **SecretScope** | `PERSONAL`, `TEAM`, `TENANT` |
| **SessionProtocol** | `SSH`, `RDP`, `VNC` |
| **SessionStatus** | `ACTIVE`, `IDLE`, `CLOSED` |
| **AuthProvider** | `LOCAL`, `GOOGLE`, `MICROSOFT`, `GITHUB`, `OIDC`, `SAML`, `LDAP` |
| **GatewayHealthStatus** | `UNKNOWN`, `REACHABLE`, `UNREACHABLE` |
| **ManagedInstanceStatus** | `PROVISIONING`, `RUNNING`, `STOPPED`, `ERROR`, `REMOVING` |
| **LoadBalancingStrategy** | `ROUND_ROBIN`, `LEAST_CONNECTIONS` |
| **NotificationType** | `CONNECTION_SHARED`, `SHARE_PERMISSION_UPDATED`, `SHARE_REVOKED`, `SECRET_SHARED`, `SECRET_SHARE_REVOKED`, `SECRET_EXPIRING`, `SECRET_EXPIRED`, `TENANT_INVITATION`, `RECORDING_READY`, `IMPOSSIBLE_TRAVEL_DETECTED` |
| **RecordingStatus** | `RECORDING`, `COMPLETE`, `ERROR` |
| **ExternalVaultAuthMethod** | `TOKEN`, `APPROLE` |
| **SyncProvider** | `NETBOX` |
| **SyncStatus** | `PENDING`, `RUNNING`, `SUCCESS`, `PARTIAL`, `ERROR` |
| **AuditAction** | 100+ values — see `server/prisma/schema.prisma` for the full list |

<!-- manual-start -->
<!-- manual-end -->
