# WebSocket Endpoints

> Auto-generated on 2026-03-15 by /docs create api.
> Source of truth is the codebase. Run /docs update api after code changes.

## Socket.IO — SSH Terminal (`/ssh`)

Connected via Socket.IO at `/ssh` namespace. Authentication via `auth.token` in handshake.

**Client -> Server Events:**

| Event | Data | Description |
|-------|------|-------------|
| `session:start` | `{ connectionId, username?, password?, credentialMode? }` | Start SSH session |
| `data` | `string` | Terminal input (keystrokes) |
| `resize` | `{ cols, rows }` | Terminal resize |
| `session:heartbeat` | — | Explicit heartbeat |
| `sftp:list` | `{ path }` | List directory contents |
| `sftp:mkdir` | `{ path }` | Create directory |
| `sftp:delete` | `{ path }` | Delete file |
| `sftp:rmdir` | `{ path }` | Remove directory |
| `sftp:rename` | `{ oldPath, newPath }` | Rename file/directory |
| `sftp:upload:start` | `{ remotePath, fileSize, filename }` | Begin file upload |
| `sftp:upload:chunk` | `{ transferId, chunk }` | Upload data chunk |
| `sftp:upload:end` | `{ transferId }` | Complete upload |
| `sftp:download:start` | `{ remotePath, filename }` | Begin file download |
| `sftp:download:cancel` | `{ transferId }` | Cancel download |

**Server -> Client Events:**

| Event | Data | Description |
|-------|------|-------------|
| `session:ready` | — | SSH connection established |
| `session:error` | `{ message }` | Connection error |
| `session:closed` | — | Session ended |
| `data` | `string` | Terminal output |
| `sftp:progress` | `{ transferId, bytesTransferred, totalBytes, filename }` | Transfer progress |
| `sftp:transfer:complete` | `{ transferId }` | Transfer complete |
| `sftp:transfer:error` | `{ transferId, message }` | Transfer error |
| `sftp:download:chunk` | `{ transferId, chunk }` | Download data chunk |
| `sftp:download:complete` | `{ transferId }` | Download complete |

## Socket.IO — Notifications (`/notifications`)

Real-time notification delivery. Authentication via `auth.token` in handshake.

**Server -> Client Events:**

| Event | Data | Description |
|-------|------|-------------|
| `notification` | `{ id, type, message, relatedId }` | New notification |

## Socket.IO — Gateway Monitor (`/gateway-monitor`)

Real-time gateway health and instance updates. Authentication via `auth.token` in handshake.

**Server -> Client Events:**

| Event | Data | Description |
|-------|------|-------------|
| `health:update` | `{ gatewayId, status, latencyMs, ... }` | Gateway health change |
| `instances:update` | `{ gatewayId, instances[] }` | Instance status change |
| `scaling:update` | `{ gatewayId, scalingStatus }` | Scaling event |
| `gateway:update` | `{ gateway }` | Gateway config change |

## Guacamole WebSocket (port 3002)

Direct WebSocket connection at `/guacamole` (proxied via Nginx). Used for RDP and VNC sessions. Communicates using the Guacamole protocol with encrypted connection tokens.

<!-- manual-start -->
<!-- manual-end -->
