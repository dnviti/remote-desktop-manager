# Sessions Endpoints

> Auto-generated on 2026-04-17 by /docs create api.
> Source of truth is the codebase. Run /docs update api after code changes.

## Sessions

All endpoints require authentication.

### `POST /api/sessions/rdp`

Create an RDP session. Returns encrypted Guacamole token.

**Body**: `{ connectionId, credentialMode?, username?, password? }` | **Response**: `{ token, wsUrl, sessionId, resolvedUsername, resolvedDomain }`

### `POST /api/sessions/vnc`

Create a VNC session. Same pattern as RDP.

**Body**: `{ connectionId, credentialMode?, username?, password? }` | **Response**: `{ token, wsUrl, sessionId }`

### `POST /api/sessions/ssh`

Start an SSH session through the terminal broker and return the browser WebSocket grant.

**Body**: `{ connectionId, credentialMode?, username?, password? }` | **Response**: `{ transport, sessionId, token, expiresAt, webSocketPath, webSocketUrl, dlpPolicy, enforcedSshSettings, sftpSupported: false, fileBrowserSupported: true }`

### `POST /api/sessions/ssh/{sessionId}/observe`

Issue a read-only observer grant for another active SSH session in the same tenant. The returned token connects to the existing `/ws/terminal` runtime instead of starting a second SSH connection.

**Auth**: Any tenant member with `canObserveSessions` | **Response**: `{ sessionId, token, expiresAt, webSocketPath, mode: "observe", readOnly: true }`

### `POST /api/sessions/rdp/{sessionId}/observe`

Issue a read-only desktop observer grant for another active RDP session in the same tenant. The returned token joins the existing Guacamole session instead of starting a second desktop connection.

**Auth**: Any tenant member with `canObserveSessions` | **Response**: `{ sessionId, protocol: "RDP", token, expiresAt, webSocketPath, readOnly: true }`

### `POST /api/sessions/vnc/{sessionId}/observe`

Issue a read-only desktop observer grant for another active VNC session in the same tenant. The returned token joins the existing Guacamole session instead of starting a second desktop connection.

**Auth**: Any tenant member with `canObserveSessions` | **Response**: `{ sessionId, protocol: "VNC", token, expiresAt, webSocketPath, readOnly: true }`

### `POST /api/sessions/rdp/:sessionId/heartbeat`

Send heartbeat for an RDP/VNC session.

### `POST /api/sessions/rdp/:sessionId/end`

End an RDP/VNC session.

### `POST /api/sessions/vnc/:sessionId/heartbeat`

Send heartbeat for a VNC session.

### `POST /api/sessions/vnc/:sessionId/end`

End a VNC session.

### `GET /api/sessions/active`

List active sessions.

**Auth**: Tenant members with `canViewSessions` get tenant-wide active rows. Tenant members without `canViewSessions` fall back to only their own active rows. **Response**: `[{ id, userId, connectionId, protocol, status, ... }]` where `status` can be `ACTIVE`, `IDLE`, `PAUSED`, or `CLOSED`

### `GET /api/sessions/console`

List unified session-console rows keyed by `sessionId`, including the latest recording summary for each visible session.

**Auth**: Tenant members with `canViewSessions` get tenant-wide rows, auditors stay read-only through their existing flags, and tenant members without `canViewSessions` are limited to their own active rows. **Response**: `{ scope, total, sessions: [{ id, userId, connectionId, protocol, status, startedAt, lastActivityAt, endedAt, durationFormatted, recording: { exists, id?, status?, format?, completedAt?, fileSize?, duration? } }] }`

### `GET /api/sessions/count`

Get active session count.

**Auth**: Tenant members with `canViewSessions` get tenant-wide counts. Tenant members without `canViewSessions` get counts for only their own active sessions.

### `GET /api/sessions/count/gateway`

Get session count grouped by gateway (tenant-scoped).

**Auth**: Any tenant member with `canViewSessions`

### `POST /api/sessions/:sessionId/terminate`

Terminate an active session.

**Auth**: Any tenant member with `canControlSessions`

### `POST /api/sessions/:sessionId/pause`

Persist session state as `PAUSED` and freeze SSH terminal or desktop broker transport until resumed.

**Auth**: Any tenant member with `canControlSessions` | **Response**: `{ ok, sessionId, protocol, status, paused }`

### `POST /api/sessions/:sessionId/resume`

Clear persisted `PAUSED` state and resume SSH terminal or desktop broker transport.

**Auth**: Any tenant member with `canControlSessions` | **Response**: `{ ok, sessionId, protocol, status, paused }`

### Recording and audit visibility alignment

- `/api/recordings`, `/api/recordings/{id}`, `/api/recordings/{id}/stream`, `/api/recordings/{id}/analyze`, `/api/recordings/{id}/video`, and `/api/recordings/{id}/audit-trail` now use the same session visibility model as the console.
- Tenant-wide viewers can read recordings for any visible tenant session.
- Tenant members without `canViewSessions` can access only their own recordings.
- Delete remains read-only-blocked for tenant-wide viewers without `canControlSessions`.
- `/api/audit/session/{sessionId}/recording` now follows the same tenant-wide vs own-scope rule instead of owner-or-auditor-only logic.

<!-- manual-start -->
<!-- manual-end -->
