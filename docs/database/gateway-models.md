# Gateway Models

> Auto-generated on 2026-03-15 by /docs create database.
> Source of truth is the codebase. Run /docs update database after code changes.

## Gateway

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, UUID | Unique identifier |
| name | String | Required | Display name |
| type | GatewayType | Enum | GUACD, SSH_BASTION, or MANAGED_SSH |
| host | String | Required | Gateway hostname |
| port | Int | Required | Gateway port |
| description | String? | Optional | Notes |
| isDefault | Boolean | Default: false | Default gateway for its type |
| tenantId | String | FK -> Tenant | Owning tenant |
| createdById | String | FK -> User | Creator |
| encryptedUsername | String? | Optional | Encrypted gateway credentials |
| usernameIV, usernameTag | String? | Optional | |
| encryptedPassword | String? | Optional | |
| passwordIV, passwordTag | String? | Optional | |
| encryptedSshKey | String? | Optional | |
| sshKeyIV, sshKeyTag | String? | Optional | |
| apiPort | Int? | Optional | Gateway API sidecar port |
| templateId | String? | FK -> GatewayTemplate (set null) | Source template |
| isManaged | Boolean | Default: false | Whether orchestrator manages containers |
| publishPorts | Boolean | Default: false | Expose container ports to host |
| lbStrategy | LoadBalancingStrategy | Default: ROUND_ROBIN | Load balancing strategy |
| desiredReplicas | Int | Default: 1 | Desired container count |
| autoScale | Boolean | Default: false | Auto-scaling enabled |
| minReplicas | Int | Default: 1 | Minimum replicas |
| maxReplicas | Int | Default: 5 | Maximum replicas |
| sessionsPerInstance | Int | Default: 10 | Scale threshold |
| scaleDownCooldownSeconds | Int | Default: 300 | Cooldown after scale-down |
| lastScaleAction | DateTime? | Optional | Last scaling event |
| inactivityTimeoutSeconds | Int | Default: 3600 | Session inactivity timeout |
| monitoringEnabled | Boolean | Default: true | Health monitoring active |
| monitorIntervalMs | Int | Default: 5000 | Health check interval |
| lastHealthStatus | GatewayHealthStatus | Default: UNKNOWN | Current health |
| lastCheckedAt | DateTime? | Optional | Last health check |
| lastLatencyMs | Int? | Optional | Last check latency |
| lastError | String? | Optional | Last error message |
| tunnelEnabled | Boolean | Default: false | Whether zero-trust tunnel is enabled |
| encryptedTunnelToken | String? | Optional | AES-256-GCM encrypted tunnel agent token |
| tunnelTokenIV | String? | Optional | IV for tunnel token encryption |
| tunnelTokenTag | String? | Optional | Auth tag for tunnel token encryption |
| tunnelTokenHash | String? | Unique, Optional | SHA-256 hash of the plaintext token (used for auth lookup) |
| tunnelConnectedAt | DateTime? | Optional | Timestamp when the tunnel agent last connected |
| tunnelLastHeartbeat | DateTime? | Optional | Timestamp of the last heartbeat from the agent |
| tunnelClientVersion | String? | Optional | Agent software version string |
| tunnelClientIp | String? | Optional | Agent remote IP address |
| tunnelCaCert | String? | Optional | PEM-encoded CA certificate for mTLS |
| tunnelCaKey | String? | Optional | Encrypted CA private key |
| tunnelCaKeyIV | String? | Optional | IV for CA key encryption |
| tunnelCaKeyTag | String? | Optional | Auth tag for CA key encryption |
| tunnelClientCert | String? | Optional | PEM-encoded client certificate issued to the agent |
| tunnelClientCertExp | DateTime? | Optional | Client certificate expiry date |
| egressPolicy | Json | Default: `{"rules":[]}` | Per-gateway tunneled egress allow policy; empty rules deny all tunneled targets |
| createdAt | DateTime | Auto | |
| updatedAt | DateTime | Auto | |

**Indexes**: `[tenantId]`, `[tenantId, type, isDefault]`

**Relations**: tenant (Tenant), createdBy (User), template (GatewayTemplate?), connections (Connection[]), activeSessions (ActiveSession[]), managedInstances (ManagedGatewayInstance[])

<!-- manual-start -->
<!-- manual-end -->

## GatewayTemplate

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, UUID | Unique identifier |
| name | String | Required | Template name |
| type | GatewayType | Enum | Gateway type |
| host | String | Required | Default host |
| port | Int | Required | Default port |
| description | String? | Optional | Notes |
| apiPort | Int? | Optional | API sidecar port |
| autoScale, minReplicas, maxReplicas, sessionsPerInstance, scaleDownCooldownSeconds | Various | | Auto-scaling defaults |
| monitoringEnabled, monitorIntervalMs, inactivityTimeoutSeconds | Various | | Monitoring defaults |
| publishPorts | Boolean | Default: false | Port publishing default |
| lbStrategy | LoadBalancingStrategy | Default: ROUND_ROBIN | LB strategy default |
| tenantId | String | FK -> Tenant | Owning tenant |
| createdById | String | FK -> User | Creator |
| createdAt | DateTime | Auto | |
| updatedAt | DateTime | Auto | |

**Index**: `[tenantId]`

**Relations**: tenant (Tenant), createdBy (User), gateways (Gateway[])

<!-- manual-start -->
<!-- manual-end -->

## SshKeyPair

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, UUID | Unique identifier |
| tenantId | String | Unique, FK -> Tenant (cascade) | One per tenant |
| encryptedPrivateKey | String | Required | Server-encrypted private key |
| privateKeyIV | String | Required | |
| privateKeyTag | String | Required | |
| publicKey | String | Required | Public key (plaintext) |
| fingerprint | String | Required | Key fingerprint |
| algorithm | String | Default: "ed25519" | Key algorithm |
| expiresAt | DateTime? | Optional | Key expiry date |
| autoRotateEnabled | Boolean | Default: false | Auto-rotation enabled |
| rotationIntervalDays | Int | Default: 90 | Days between rotations |
| lastAutoRotatedAt | DateTime? | Optional | Last auto-rotation |
| createdAt | DateTime | Auto | |
| updatedAt | DateTime | Auto | |

<!-- manual-start -->
<!-- manual-end -->

## ManagedGatewayInstance

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, UUID | |
| gatewayId | String | FK -> Gateway (cascade) | Parent gateway |
| containerId | String | Unique | Container/pod ID |
| containerName | String | Required | Container name |
| host | String | Required | Container hostname |
| port | Int | Required | SSH port |
| apiPort | Int? | Optional | API sidecar port |
| status | ManagedInstanceStatus | Default: PROVISIONING | PROVISIONING, RUNNING, STOPPED, ERROR, REMOVING |
| orchestratorType | String | Required | docker, podman, or kubernetes |
| healthStatus | String? | Optional | Last health check result |
| lastHealthCheck | DateTime? | Optional | |
| errorMessage | String? | Optional | |
| consecutiveFailures | Int | Default: 0 | |
| tunnelProxyHost | String? | Optional | Hostname to reach this instance via the tunnel broker |
| tunnelProxyPort | Int? | Optional | Port to reach this instance via the tunnel broker |
| createdAt, updatedAt | DateTime | Auto | |

**Indexes**: `[gatewayId]`, `[status]`

<!-- manual-start -->
<!-- manual-end -->

## Tenant Tunnel Configuration

The following fields on the **Tenant** model control tenant-wide tunnel defaults and policies:

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| tunnelDefaultEnabled | Boolean | Default: false | New gateways in this tenant have tunnelling enabled by default |
| tunnelAutoTokenRotation | Boolean | Default: false | Automatically rotate tunnel agent tokens on a schedule |
| tunnelTokenRotationDays | Int | Default: 90 | Days between automatic token rotations |
| tunnelRequireForRemote | Boolean | Default: false | Require tunnel for all remote (non-LAN) connections |
| tunnelTokenMaxLifetimeDays | Int? | Optional | Maximum allowed lifetime for tunnel tokens (null = unlimited) |
| tunnelAgentAllowedCidrs | String[] | Default: [] | CIDR allowlist for tunnel agent source IPs (empty = allow all) |
