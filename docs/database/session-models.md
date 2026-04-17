# Session Models

> Auto-generated on 2026-03-15 by /docs create database.
> Source of truth is the codebase. Run /docs update database after code changes.

## ActiveSession

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, UUID | |
| userId | String | FK -> User (cascade) | Session owner |
| connectionId | String | FK -> Connection (cascade) | Target connection |
| gatewayId | String? | FK -> Gateway (set null) | Routing gateway |
| instanceId | String? | FK -> ManagedGatewayInstance (set null) | Specific container instance |
| protocol | SessionProtocol | Enum | SSH, RDP, or VNC |
| status | SessionStatus | Default: ACTIVE | ACTIVE, IDLE, PAUSED, or CLOSED |
| socketId | String? | Optional | Socket.IO socket ID (SSH) |
| guacTokenHash | String? | Optional | Guacamole token hash (RDP/VNC) |
| ipAddress | String? | Optional | Client IP address |
| startedAt | DateTime | Auto | Session start |
| lastActivityAt | DateTime | Auto | Last activity |
| endedAt | DateTime? | Optional | Session end |
| metadata | Json? | Optional | Host, port, credential source, routing info |

**Indexes**: `[userId, status]`, `[status]`, `[gatewayId, status]`, `[protocol, status]`, `[lastActivityAt]`, `[socketId]`, `[guacTokenHash]`, `[instanceId, status]`

<!-- manual-start -->
<!-- manual-end -->

## SessionRecording

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, UUID | |
| sessionId | String? | Optional | Linked active session |
| userId | String | FK -> User (cascade) | |
| connectionId | String | FK -> Connection (cascade) | |
| protocol | SessionProtocol | Enum | SSH, RDP, or VNC |
| filePath | String | Required | Recording file path |
| fileSize | Int? | Optional | File size in bytes |
| duration | Int? | Optional | Duration in seconds |
| width, height | Int? | Optional | Terminal/display dimensions |
| format | String | Default: "asciicast" | asciicast or guac |
| status | RecordingStatus | Default: RECORDING | RECORDING, COMPLETE, ERROR |
| createdAt | DateTime | Auto | |
| completedAt | DateTime? | Optional | |

**Indexes**: `[userId, createdAt]`, `[sessionId]`, `[connectionId]`

<!-- manual-start -->
<!-- manual-end -->
