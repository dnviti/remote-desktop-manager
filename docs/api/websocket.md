# WebSocket Endpoints

> Auto-generated on 2026-03-15 by /docs create api.
> Source of truth is the codebase. Run /docs update api after code changes.

## SSH Terminal WebSocket (`/ws/terminal`)

Connected via a plain WebSocket at `/ws/terminal`. Authentication is handled with the short-lived terminal session token in the query string.

**Client -> Server Events:**

| Event | Data | Description |
|-------|------|-------------|
| `input` | `{ type: "input", data }` | Terminal input (keystrokes) |
| `resize` | `{ type: "resize", cols, rows }` | Terminal resize |
| `ping` | `{ type: "ping" }` | Keepalive |

**Server -> Client Events:**

| Event | Data | Description |
|-------|------|-------------|
| `ready` | `{ type: "ready" }` | SSH connection established |
| `data` | `{ type: "data", data }` | Terminal output |
| `pong` | `{ type: "pong" }` | Keepalive response |
| `closed` | `{ type: "closed" }` | Session ended |
| `error` | `{ type: "error", code?, message }` | Connection or session error |

SSH file browsing is not part of the terminal WebSocket protocol anymore. The SPA calls `/api/files/ssh/list`, `/api/files/ssh/mkdir`, `/api/files/ssh/delete`, `/api/files/ssh/rename`, `/api/files/ssh/upload`, and `/api/files/ssh/download` over REST, and those payload transfers are staged through shared object storage.

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
