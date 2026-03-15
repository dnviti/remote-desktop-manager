# Sessions Endpoints

> Auto-generated on 2026-03-15 by /docs create api.
> Source of truth is the codebase. Run /docs update api after code changes.

## Sessions

All endpoints require authentication.

### `POST /api/sessions/rdp`

Create an RDP session. Returns encrypted Guacamole token.

**Body**: `{ connectionId, credentialMode?, username?, password? }` | **Response**: `{ token, wsUrl, sessionId }`

### `POST /api/sessions/vnc`

Create a VNC session. Same pattern as RDP.

**Body**: `{ connectionId, credentialMode?, username?, password? }` | **Response**: `{ token, wsUrl, sessionId }`

### `POST /api/sessions/ssh`

Validate SSH access (does not create a session — SSH sessions are created via Socket.IO).

**Body**: `{ connectionId }`

### `POST /api/sessions/rdp/:sessionId/heartbeat`

Send heartbeat for an RDP/VNC session.

### `POST /api/sessions/rdp/:sessionId/end`

End an RDP/VNC session.

### `POST /api/sessions/vnc/:sessionId/heartbeat`

Send heartbeat for a VNC session.

### `POST /api/sessions/vnc/:sessionId/end`

End a VNC session.

### `GET /api/sessions/active`

List active sessions (tenant-scoped).

**Auth**: Admin, Owner, Auditor, or Operator | **Response**: `[{ id, userId, connectionId, protocol, status, ... }]`

### `GET /api/sessions/count`

Get active session count (tenant-scoped).

**Auth**: Admin, Owner, Auditor, or Operator

### `GET /api/sessions/count/gateway`

Get session count grouped by gateway (tenant-scoped).

**Auth**: Admin, Owner, Auditor, or Operator

### `POST /api/sessions/:sessionId/terminate`

Terminate an active session.

**Auth**: Admin

<!-- manual-start -->
<!-- manual-end -->
