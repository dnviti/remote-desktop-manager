# WebSocket Endpoints

> Auto-generated on 2026-03-15 by /docs create api.
> Source of truth is the codebase. Run /docs update api after code changes.

## SSH Terminal WebSocket (`/ws/terminal`)

Connected via a plain WebSocket at `/ws/terminal`. Authentication is handled with the short-lived terminal session token in the query string. A normal SSH grant creates the controlling runtime; an observer grant attaches a second read-only client to that same runtime.

**Client -> Server Events:**

| Event | Data | Description |
|-------|------|-------------|
| `input` | `{ type: "input", data }` | Terminal input (keystrokes) for the controlling SSH client only |
| `resize` | `{ type: "resize", cols, rows }` | Terminal resize for the controlling SSH client only |
| `ping` | `{ type: "ping" }` | Keepalive |
| `close` | `{ type: "close" }` | Close the controlling terminal session, or disconnect one observer socket without ending the shared SSH runtime |

**Server -> Client Events:**

| Event | Data | Description |
|-------|------|-------------|
| `ready` | `{ type: "ready" }` | SSH connection established |
| `data` | `{ type: "data", data }` | Terminal output |
| `pong` | `{ type: "pong" }` | Keepalive response |
| `closed` | `{ type: "closed" }` | Session ended |
| `error` | `{ type: "error", code?, message }` | Connection or session error |

Observer clients receive the same `ready`, `data`, `error`, and `closed` events as the controlling client, but `input` and `resize` messages return a `READ_ONLY` error and do not reach SSH stdin or PTY resize handling. SSH file browsing is not part of the terminal WebSocket protocol anymore. The SPA calls `/api/files/ssh/list`, `/api/files/ssh/mkdir`, `/api/files/ssh/delete`, `/api/files/ssh/rename`, `/api/files/ssh/upload`, and `/api/files/ssh/download` over REST, and those payload transfers are staged through shared object storage.

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
