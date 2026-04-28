# Tunnel & ABAC Implementation Guide

> Auto-generated on 2026-03-15 by `/docs create guides`.

> Runtime note: the public tunnel path now terminates in the Go control plane and tunnel broker. `server/src` references below are historical implementation notes retained for protocol context.

This guide is for backend/fullstack developers who need to understand, extend, or debug the zero-trust tunnel and Attribute-Based Access Control (ABAC) systems in Arsenale. It covers the binary frame protocol, server-side broker, agent-side forwarder, session integration for SSH/RDP/VNC, the ABAC policy evaluation engine, health monitoring, certificate rotation, and security hardening.

---

## Architecture Overview

The tunnel system connects remote gateway agents to the Arsenale server over a single persistent WebSocket, then multiplexes many independent TCP streams over that connection using a binary frame protocol. This enables SSH, RDP, and VNC sessions to traverse NATs and firewalls without exposing services directly to the internet.

### Component Diagram

```
                          Internet / NAT
                              |
  +---------------------------+---------------------------+
  |                                                       |
  |  Arsenale Server                                      |  Remote Network
  |  +-----------------+      WSS (port 3001)             |  +------------------+
  |  | TunnelBroker    |<---------------------------------|--| TunnelAgent      |
  |  | (tunnel.service)|   Binary frames over WS          |  | (gateways/tunnel-agent/)  |
  |  +------+----------+                                  |  +------+-----------+
  |         |                                             |         |
  |  +------+----------+                                  |  +------+-----------+
  |  | Stream Mux      |    streamId-tagged frames        |  | TCP Forwarder    |
  |  | (openStream)    |<-----------------------------+---|--| (tcpForwarder)   |
  |  +------+----------+                              |   |  +------+-----------+
  |         |                                         |   |         |
  |  +------+---+  +-------+---+  +-------+---+      |   |  +------+-----------+
  |  | SSH2     |  | TCP Proxy |  | TCP Proxy  |      |   |  | Local guacd      |
  |  | Client   |  | (RDP)     |  | (VNC)      |      |   |  | or SSH service   |
  |  +----------+  +-----------+  +------------+      |   |  +------------------+
  |                                                   |   |
  +---------------------------------------------------+   +
```

### Data Flow for a Tunneled Session

1. **Agent connects** -- The `TunnelAgent` on the remote network opens a WSS connection to `/api/tunnel/connect` with a `Bearer` token and `X-Gateway-Id` header.
2. **Server authenticates** -- the Go tunnel broker validates the bearer token and gateway ID, completes the WebSocket upgrade, and registers the tunnel.
3. **Session request** -- a user opens an SSH/RDP/VNC/database session. The Go session service detects `gateway.tunnelEnabled`.
4. **Egress authorization** -- the session service evaluates the gateway `egressPolicy` against the requested protocol, target host/subnet, and target port.
5. **OPEN frame** -- if the policy allows the target, the broker sends an OPEN frame with `host:port` payload through the WebSocket.
6. **Agent forwards** -- the agent's `handleOpenFrame()` opens a local TCP connection only to its configured `TUNNEL_LOCAL_HOST:TUNNEL_LOCAL_PORT`, then sends back an OPEN ack.
7. **Bidirectional data** -- DATA frames flow in both directions, tagged with the `streamId`. The broker wraps data into a `Duplex` stream that SSH2/guacamole consume transparently.
8. **Teardown** -- Either side sends a CLOSE frame to end the stream. When the WebSocket itself drops, all streams are destroyed.

---

## Binary Frame Protocol

The wire protocol is identical on both broker (`backend/internal/tunnelbroker`) and agent (`gateways/tunnel-agent/protocol.go`). Every WebSocket message is a binary frame with the following layout:

### Header Format

```
Offset  Size   Field       Description
------  ----   -----       -----------
0       1      type        Message type (see table below)
1       1      flags       Reserved, must be 0
2-3     2      streamId    uint16 big-endian stream identifier
4+      N      payload     Variable-length payload (0 bytes for control frames)
```

Total header size: **4 bytes** (constant `HEADER_SIZE`).

### Message Types

| Name         | Value | Direction        | Payload                                      |
|--------------|-------|------------------|----------------------------------------------|
| `OPEN`       | 1     | Broker -> Agent  | UTF-8 `"host:port"` (request to open stream) |
| `OPEN`       | 1     | Agent -> Broker  | Empty (acknowledgement)                       |
| `DATA`       | 2     | Bidirectional    | Raw TCP bytes                                 |
| `CLOSE`      | 3     | Bidirectional    | Empty (stream teardown)                       |
| `PING`       | 4     | Bidirectional    | Optional JSON health metadata (agent->broker) |
| `PONG`       | 5     | Bidirectional    | Empty (heartbeat response)                    |
| `HEARTBEAT`  | 6     | Agent -> Broker  | Optional JSON health metadata                 |
| `CERT_RENEW` | 7     | Broker -> Agent  | JSON `{ clientCert: "<PEM>" }`                |

Defined in both `backend/internal/tunnelbroker/broker_types.go` and `gateways/tunnel-agent/protocol.go`:

```go
const (
	msgOpen      byte = 1
	msgData      byte = 2
	msgClose     byte = 3
	msgPing      byte = 4
	msgPong      byte = 5
	msgHeartbeat byte = 6
	msgCertRenew byte = 7
)
```

### Frame Construction

Both sides use an identical `buildFrame` function:

```go
func buildFrame(frameType byte, streamID uint16, payload []byte) ([]byte, error) {
	frame := make([]byte, frameHeaderSize+len(payload))
	frame[0] = frameType
	frame[1] = 0
	binary.BigEndian.PutUint16(frame[2:4], streamID)
	copy(frame[frameHeaderSize:], payload)
	return frame, nil
}
```

### Stream ID Space

Stream IDs are `uint16` values (`0x0001` to `0xFFFF`). ID `0` is reserved for control-plane frames (PING/PONG/HEARTBEAT/CERT_RENEW). The broker allocates IDs sequentially with wraparound:

```typescript
// tunnel.service.ts (lines 263-272)
let streamId = conn.nextStreamId;
let attempts = 0;
while (conn.streams.has(streamId) || conn.pendingOpens.has(streamId)) {
  streamId = (streamId % MAX_STREAM_ID) + 1;
  if (++attempts > MAX_STREAM_ID) {
    reject(new Error('No available stream IDs'));
    return;
  }
}
conn.nextStreamId = (streamId % MAX_STREAM_ID) + 1;
```

This gives a maximum of **65,535 concurrent streams** per tunnel connection.

### Frame Size Limits and Validation

Frames shorter than `HEADER_SIZE` (4 bytes) are silently dropped with a warning log. There is no explicit maximum frame size enforced at the protocol level -- the practical limit is the WebSocket library's buffer size. Unknown message types are logged and ignored (fail-open for unknown types, fail-closed for everything else).

---

## Server-Side: TunnelBroker

**File:** `backend/internal/tunnelbroker`

The TunnelBroker is a singleton module that manages all tunnel connections via a global in-memory registry.

### Connection Registry

```typescript
// tunnel.service.ts (line 96)
const registry = new Map<string, TunnelConnection>();
```

Each entry is a `TunnelConnection`:

```typescript
// tunnel.service.ts (lines 68-89)
export interface TunnelConnection {
  gatewayId: string;
  ws: WebSocket;
  connectedAt: Date;
  clientVersion?: string;
  clientIp?: string;
  streams: Map<number, Duplex>;         // active multiplexed streams
  pendingOpens: Map<number, PendingOpen>; // awaiting OPEN ack
  nextStreamId: number;
  lastHeartbeat?: Date;
  pingPongLatency?: number;              // RTT from last PING/PONG exchange
  lastPingSentAt?: number;
  bytesTransferred: number;
  heartbeatMetadata?: HeartbeatMetadata;
}
```

Public query functions:
- `isTunnelConnected(gatewayId)` / `hasTunnel(gatewayId)` -- checks if a live WebSocket exists.
- `getTunnelInfo(gatewayId)` -- returns metadata snapshot (without exposing the raw `WebSocket`).
- `getRegisteredTunnels()` -- returns all connected gateway IDs.

### Registration & Eviction

When a gateway connects, `registerTunnel()` is called (from `tunnel.handler.ts`). If a connection already exists for that gateway, the old one is evicted first -- this handles agent restarts or network blips gracefully:

```typescript
// tunnel.service.ts (lines 147-199)
export function registerTunnel(
  gatewayId: string,
  ws: WebSocket,
  clientVersion?: string,
  clientIp?: string,
): TunnelConnection {
  const existing = registry.get(gatewayId);
  if (existing) {
    log.warn(`Gateway ${gatewayId} reconnected — closing previous connection`);
    try { existing.ws.close(1001, 'replaced'); } catch { /* ignore */ }
    evictConnection(existing);
  }
  // ... create TunnelConnection, persist to DB, audit log
}
```

Eviction (`evictConnection`) destroys all open streams and rejects all pending opens:

```typescript
// tunnel.service.ts (lines 222-235)
function evictConnection(conn: TunnelConnection): void {
  registry.delete(conn.gatewayId);
  for (const stream of conn.streams.values()) {
    if (!stream.destroyed) stream.destroy(new Error('tunnel closed'));
  }
  conn.streams.clear();
  for (const pending of conn.pendingOpens.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error('tunnel closed'));
  }
  conn.pendingOpens.clear();
}
```

### Frame Handler (`attachFrameHandler`)

Attached immediately after registration (`tunnel.service.ts`, line 174). Handles:
- **Buffer normalization** -- `Buffer`, `ArrayBuffer`, or `Buffer[]` all converted to a single `Buffer`.
- **Header parsing** -- extracts `type`, `streamId`, and `payload`.
- **Dispatch** -- routes to `handleOpenAck`, `handleData`, `handleClose`, `handlePing`, `handlePong`, or `handleHeartbeat`.
- **WebSocket lifecycle** -- `close` and `error` events trigger `deregisterTunnel()`.

### Stream Multiplexing (`openStream` -> `Duplex`)

`openStream()` is the primary API used by session code. It returns a standard Node.js `Duplex` stream:

```typescript
// tunnel.service.ts (lines 250-293)
export function openStream(
  gatewayId: string,
  host: string,
  port: number,
  timeoutMs = 10_000,
): Promise<Duplex>
```

**How it works:**

1. Allocates a unique `streamId` (wraparound with collision detection).
2. Sends an OPEN frame with `"host:port"` as the UTF-8 payload.
3. Waits for the agent to respond with an OPEN ack frame (same `streamId`).
4. Creates a `Duplex` stream where:
   - **Readable side** -- push-driven by `handleData()` when DATA frames arrive.
   - **Writable side** -- wraps each `write()` in a DATA frame and sends it over the WebSocket.
   - **Destroy** -- sends a CLOSE frame and removes from the registry.

The returned `Duplex` is API-compatible with `net.Socket`, so SSH2's `sock` option and guacamole's pipe-based I/O work transparently.

### TCP Proxy (`createTcpProxy`)

For RDP and VNC, guacamole-lite needs a `host:port` to connect to. Since `openStream()` returns a `Duplex` (not a TCP address), `createTcpProxy()` bridges the gap:

```typescript
// tunnel.service.ts (lines 638-680)
export function createTcpProxy(
  gatewayId: string,
  targetHost: string,
  targetPort: number,
): Promise<{ server: net.Server; localPort: number }>
```

It creates a one-shot `net.Server` on `127.0.0.1:0` (ephemeral port). When the single guacd connection arrives, it:
1. Closes the server to prevent leaks.
2. Opens a tunnel stream via `openStream()`.
3. Pipes the local socket and remote stream bidirectionally.

**Design decision:** One proxy per session, not a shared proxy. This keeps the lifecycle simple -- the server closes after one connection, which is all guacd needs. The alternative (a persistent proxy with connection pooling) would add complexity for no benefit since each guacd session opens exactly one TCP connection.

### Token Generation & Authentication

Tunnel tokens are 256-bit random values (64 hex characters) stored using a defense-in-depth approach:

1. **SHA-256 hash** (`tunnelTokenHash`) -- for constant-time authentication.
2. **AES-256-GCM encrypted token** (`encryptedTunnelToken`, `tunnelTokenIV`, `tunnelTokenTag`) -- for recovery/auditing.

Authentication flow (`authenticateTunnelRequest`, lines 569-625):
1. Look up gateway by ID, verify `tunnelEnabled`.
2. Hash the incoming token with SHA-256.
3. Compare against stored hash using `crypto.timingSafeEqual()`.
4. Decrypt the stored token and compare against the bearer token (defense-in-depth).

### Heartbeat Processing & DB Throttling

Two heartbeat mechanisms exist:

1. **PING/PONG** (type 4/5) -- agent sends PING, broker responds with PONG. Used for RTT measurement. The broker also records `lastHeartbeat` in the DB on PONG receipt.

2. **HEARTBEAT** (type 6) -- agent sends health metadata as JSON payload. The broker:
   - Updates `lastHeartbeat` in memory.
   - Parses optional JSON with `healthy`, `latencyMs`, `activeStreams` fields.
   - Persists `tunnelLastHeartbeat` to the `Gateway` table (best-effort, fire-and-forget).
   - Updates `ManagedGatewayInstance` health status if metadata is present.

DB writes are best-effort (`.catch(() => {})`) to avoid blocking the frame handler. The gateway monitor (see [Health Monitoring](#health-monitoring)) enforces a 45-second staleness threshold.

---

## Agent-Side: TunnelAgent

**Files:**
- `gateways/tunnel-agent/agent.go` -- main tunnel agent loop
- `gateways/tunnel-agent/tcp_forwarder.go` -- local TCP connection management
- `gateways/tunnel-agent/protocol.go` -- binary frame encoding/decoding
- `gateways/tunnel-agent/config.go` -- environment-based configuration
- `gateways/tunnel-agent/auth.go` -- WebSocket auth headers and mTLS options

### Configuration & Dormant Mode

Configuration is entirely environment-driven (`gateways/tunnel-agent/config.go`):

| Variable                     | Required | Default     | Description                              |
|------------------------------|----------|-------------|------------------------------------------|
| `TUNNEL_SERVER_URL`          | Yes      | --          | WSS URL of the TunnelBroker              |
| `TUNNEL_TOKEN`               | Yes      | --          | Bearer token for authentication          |
| `TUNNEL_GATEWAY_ID`          | Yes      | --          | Gateway UUID                             |
| `TUNNEL_LOCAL_PORT`          | Yes      | --          | Local service port to proxy to           |
| `TUNNEL_LOCAL_HOST`          | No       | `127.0.0.1` | Local service host                       |
| `TUNNEL_CA_CERT`             | No       | --          | PEM CA cert for server verification      |
| `TUNNEL_CLIENT_CERT`         | No       | --          | PEM client cert for mTLS                 |
| `TUNNEL_CLIENT_KEY`          | No       | --          | PEM client key for mTLS                  |
| `TUNNEL_PING_INTERVAL_MS`   | No       | `15000`     | Heartbeat interval                       |
| `TUNNEL_RECONNECT_INITIAL_MS`| No      | `1000`      | Initial reconnect backoff                |
| `TUNNEL_RECONNECT_MAX_MS`   | No       | `60000`     | Maximum reconnect backoff                |

**Dormant mode:** If none of `TUNNEL_SERVER_URL`, `TUNNEL_TOKEN`, or `TUNNEL_GATEWAY_ID` are set, `loadConfig()` returns a dormant result and the agent exits cleanly. This allows the same Docker image to be deployed with or without tunnel functionality. However, if some but not all required vars are set, the agent exits with an error code -- partial configuration is treated as a misconfiguration.

### Connection Lifecycle & Reconnection

The Go agent (`gateways/tunnel-agent/agent.go`) manages a single WebSocket connection with automatic reconnection:

```
start() -> connect() -> [open] -> startPing()
                     -> [close] -> destroyAllSockets() -> scheduleReconnect() -> connect()
                     -> [error] -> (close fires next) -> ...
```

Reconnection uses **exponential backoff**:
- Initial delay: `reconnectInitialMs` (default 1s)
- Each failure doubles the delay
- Capped at `reconnectMaxMs` (default 60s)
- Reset to initial on successful connection

Graceful shutdown: `SIGTERM` and `SIGINT` set `stopped = true`, close the WebSocket with code 1001, destroy all active sockets, and exit after a 500ms flush delay.

### TCP Forwarder (`handleOpenFrame` -> local TCP)

When the broker sends an OPEN frame, the agent's `handleOpenFrame()` (`gateways/tunnel-agent/tcp_forwarder.go`):

1. Parses `"host:port"` from the payload.
2. Validates the port is 1-65535.
3. **Checks the target against the exact configured local service** (see SSRF prevention below).
4. Opens a local TCP connection to the local service.
5. On successful dial: stores the socket, sends OPEN ack back to broker.
6. On socket reads: wraps bytes in DATA frames and sends them to the broker.
7. On `close`/`error`: cleans up and sends CLOSE frame.

Active sockets are tracked by stream ID in the forwarder.

### Health Probing (`probeLocalService`)

Every `pingIntervalMs` (default 15s), the agent probes the local service by attempting a TCP connection:

```typescript
// tunnel.ts (lines 224-252)
private probeLocalService(): Promise<HealthStatus> {
  return new Promise<HealthStatus>((resolve) => {
    const socket = net.connect(
      this.cfg.localServicePort,
      this.cfg.localServiceHost,
    );
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    const timer = setTimeout(() => done(false), 2_000);  // 2s timeout
  });
}
```

The result is encoded as JSON in the PING frame payload:

```json
{ "healthy": true, "latencyMs": 3, "activeStreams": 2 }
```

### Exact Local-Service Restriction (SSRF Prevention)

The TCP forwarder rejects any OPEN frame whose payload does not exactly match the configured `TUNNEL_LOCAL_HOST:TUNNEL_LOCAL_PORT`. It also preserves the localhost-only guard for loopback names and addresses.

This prevents SSRF attacks where a compromised broker could instruct the agent to connect to arbitrary internal hosts or to another local service on the same host. If the proxied service, such as guacd or sshd, needs to reach other hosts, that routing happens at the service level after the control plane has allowed the requested target through the gateway egress policy.

---

## Session Integration

### SSH: Socket.IO -> openStream -> Duplex -> SSH2 Client

**File:** `server/src/socket/ssh.handler.ts`

When an SSH session targets a tunnel-enabled gateway, the handler:

1. Checks `gateway.tunnelEnabled` and `isTunnelConnected(gateway.id)`.
2. Calls `openStream(gateway.id, bastionHost, bastionPort)` to get a `Duplex` stream.
3. Passes the stream as the `sock` parameter to SSH2's `client.connect()`:

```typescript
// ssh.handler.ts (lines 276-296)
if (gateway.tunnelEnabled) {
  if (!isTunnelConnected(gateway.id)) {
    socket.emit('session:error', { message: 'Gateway tunnel is disconnected...' });
    return;
  }
  const tunnelSock = await openStream(gateway.id, bastionHost, bastionPort);
  session = await createSshConnectionViaBastion({
    bastionHost,
    bastionPort,
    bastionUsername,
    bastionPassword,
    bastionPrivateKey,
    targetHost: conn.host,
    targetPort: conn.port,
    targetUsername: username,
    targetPassword: password,
    targetPrivateKey: privateKey,
    targetPassphrase: passphrase,
    sock: tunnelSock,   // <-- tunnel stream replaces direct TCP
  });
}
```

The SSH2 library's `sock` option (`server/src/services/ssh.service.ts`, lines 68-77) tells it to use the provided stream instead of opening its own TCP connection:

```typescript
// ssh.service.ts (lines 68-77)
if (params.sock) {
  client.connect({
    sock: params.sock,
    username: params.username,
    // ... credentials
  });
}
```

This is the key design insight: by exposing tunnel streams as standard Node.js `Duplex` objects, existing SSH2 and bastion-hop code works without modification.

### RDP/VNC: createTcpProxy -> local net.Server -> guacamole

**File:** `server/src/controllers/session.controller.ts`

For RDP and VNC, guacamole-lite connects to a `host:port` via TCP, so the tunnel integration uses `createTcpProxy()` to create a local proxy:

```typescript
// session.controller.ts (lines 92-101, RDP path; 324-333, VNC path)
if (gateway.tunnelEnabled) {
  if (!isTunnelConnected(gateway.id)) {
    throw new AppError('Gateway tunnel is disconnected — the gateway may be unreachable', 503);
  }
  const targetHost = guacdHost ?? gateway.host;
  const targetPort = guacdPort ?? gateway.port;
  const { server: _proxyServer, localPort } = await createTcpProxy(gateway.id, targetHost, targetPort);
  guacdHost = '127.0.0.1';
  guacdPort = localPort;
}
```

After this, `guacdHost` and `guacdPort` point to `127.0.0.1:<ephemeral>`, and the rest of the guacamole token generation proceeds as normal. The proxy server accepts one connection (from guacd), pipes it through a tunnel stream, and then closes.

---

## ABAC Policy System

The Attribute-Based Access Control system evaluates policies before sessions are granted. In the active runtime, evaluation and CRUD now live in the Go access-policy service:

- `backend/internal/accesspolicies/service.go` -- policy evaluation and CRUD operations

### Data Model

Policies are stored in the `AccessPolicy` table:

```typescript
// accessPolicy.service.ts (lines 5-14)
export interface AccessPolicyData {
  id: string;
  targetType: AccessPolicyTargetType;  // 'FOLDER' | 'TEAM' | 'TENANT'
  targetId: string;
  allowedTimeWindows: string | null;   // e.g. "09:00-18:00,20:00-22:00"
  requireTrustedDevice: boolean;       // requires WebAuthn in current login
  requireMfaStepUp: boolean;           // requires TOTP or WebAuthn MFA
  createdAt: Date;
  updatedAt: Date;
}
```

**Target types** form a hierarchy: `FOLDER` (most specific) > `TEAM` > `TENANT` (broadest).

**Constraint:** Only one policy per `(targetType, targetId)` pair. The `createPolicy()` function enforces this with a uniqueness check.

**Tenant isolation:** The `validateTarget()` function ensures that every policy target belongs to the requesting tenant, preventing cross-tenant policy manipulation.

### Evaluation Flow

```typescript
// abac.service.ts (lines 129-198)
export async function evaluate(ctx: AbacContext): Promise<AbacResult>
```

**Input (`AbacContext`):**

```typescript
export interface AbacContext {
  userId: string;
  folderId?: string | null;
  teamId?: string | null;
  tenantId?: string | null;
  usedWebAuthnInLogin: boolean;
  completedMfaStepUp: boolean;
  ipAddress?: string | null;
  connectionId?: string;
}
```

**Evaluation steps:**

1. **Collect scopes** -- Build target list from `folderId`, `teamId`, `tenantId` (in that order).
2. **Fetch policies** -- Single query with `OR` conditions for all applicable targets.
3. **Sort by specificity** -- FOLDER first, then TEAM, then TENANT.
4. **Evaluate each policy** -- For each policy, check all conditions. First failure returns a denial immediately.
5. **All pass** -- If no policy denies, return `{ allowed: true }`.

**Critical design: policies are ADDITIVE.** There is no concept of a permissive override. A lax TENANT policy cannot override a restrictive FOLDER policy. The most restrictive combination always wins. If no policies exist for any scope, access is allowed by default.

### Condition Checks

Each policy can enforce up to three conditions:

| Condition               | Policy Field           | Context Field             | Denial Reason           |
|-------------------------|------------------------|---------------------------|-------------------------|
| Time window             | `allowedTimeWindows`   | Current UTC time          | `outside_working_hours` |
| Trusted device          | `requireTrustedDevice` | `usedWebAuthnInLogin`     | `untrusted_device`      |
| MFA step-up             | `requireMfaStepUp`     | `completedMfaStepUp`      | `mfa_step_up_required`  |

### Time Window Parsing & Validation

Time windows are comma-separated ranges in `"HH:MM-HH:MM"` format (UTC):

```typescript
// abac.service.ts (lines 82-107)
export function isWithinAllowedTimeWindows(allowedTimeWindows: string): boolean
```

Key behaviors:
- **Multiple windows:** `"09:00-12:00,14:00-18:00"` -- access during either window.
- **Overnight windows:** `"22:00-06:00"` -- wraps past midnight (22:00-24:00 and 00:00-06:00).
- **Exclusive end:** The end time is exclusive -- `"09:00-18:00"` allows 09:00 through 17:59.
- **Malformed ranges skipped:** If `HH:MM` parsing fails (`parseTimeMinutes` returns `NaN`), that window is silently skipped. This is fail-closed -- a malformed window never grants access.

### Fail-Closed Design Principles

The ABAC system follows fail-closed principles throughout:

1. **No policies = allow.** If no `AccessPolicy` records exist for a context's scopes, access is granted. This is intentional -- ABAC is opt-in, not opt-out.
2. **Malformed time windows = deny.** Invalid time strings are skipped, never granting access.
3. **All policies must pass.** First denial is returned immediately; no short-circuit to allow.
4. **Audit before deny.** `logAbacDenial()` is awaited before returning 403, ensuring the denial is persisted.

### Audit Logging

```typescript
// abac.service.ts (lines 209-236)
export async function logAbacDenial(ctx: AbacContext, denial: AbacDenial): Promise<void>
```

Denial audit logs include:
- `action: 'SESSION_DENIED_ABAC'`
- The denied user, connection, policy ID, and denial reason.
- GeoIP enrichment (country, city, coordinates) from the client IP.
- Errors in audit logging are caught and logged -- never thrown to the caller. The 403 response must always be sent, even if audit logging fails.

---

## Health Monitoring

**File:** `server/src/services/gatewayMonitor.service.ts`

### Heartbeat-Based Health (`probeViaTunnel`)

For tunnel-enabled gateways, health is derived from tunnel state rather than direct TCP probes:

```typescript
// gatewayMonitor.service.ts (lines 337-401)
async function probeViaTunnel(gatewayId: string, tenantId: string): Promise<void>
```

### Status Derivation

| Tunnel Connected | Last Heartbeat | Agent Healthy | Gateway Status |
|------------------|----------------|---------------|----------------|
| No               | --             | --            | `UNREACHABLE`  |
| Yes              | > 45s ago      | --            | `UNREACHABLE`  |
| Yes              | <= 45s ago     | No            | `UNREACHABLE`  |
| Yes              | <= 45s ago     | Yes           | `REACHABLE`    |

The staleness threshold is 45 seconds (`TUNNEL_HEARTBEAT_TIMEOUT_MS`), which is 3x the default ping interval (15s), providing tolerance for network jitter.

When health status transitions (e.g., REACHABLE -> UNREACHABLE), the change is logged at info level.

### Real-Time Metrics via Socket.IO

The monitor emits two types of real-time updates:

1. **Health updates** (`emitHealthUpdate`) -- gateway status, latency, error message.
2. **Tunnel metrics** (`emitTunnelMetricsUpdate`) -- uptime, RTT, active streams, bytes transferred, agent health.

These are pushed to the client via Socket.IO for the dashboard gateway monitoring panel.

---

## Certificate Rotation

**Files:** `backend/internal/gateways/tunnels_mtls.go`, `backend/internal/gateways/tunnels_crypto.go`, and `gateways/tunnel-agent/agent.go`

### Current State

Tunnel client certificates are generated as real X.509 client certificates in the Go gateway service. Each tenant gets a reusable tunnel CA, and each gateway gets an Ed25519 client certificate with a SPIFFE URI of `spiffe://<trust-domain>/gateway/<gateway-id>`. The encrypted client private key and certificate expiry are stored on the gateway record.

### CERT_RENEW Frame Flow

The rotation flow is already wired up:

1. **Scheduler** -- `startCertRotationScheduler()` runs `processCertRotations()` every 6 hours and once at startup.
2. **Candidate selection** -- Finds gateways where `tunnelClientCertExp` is within 7 days of expiry.
3. **Cert generation** -- Decrypts CA key, generates new cert, persists to DB.
4. **Delivery** -- `sendCertRenew()` sends a `CERT_RENEW` frame with the new PEM cert.
5. **Agent handling** -- The Go tunnel agent handles `CERT_RENEW` by replacing its in-memory client cert/key and closing the WebSocket with a service-restart close code. Reconnect uses the renewed credentials.
6. **Managed gateways** -- Managed runtime env injection also supplies the current cert/key material when containers are recreated.

---

## Security Hardening Applied

### SSRF Prevention

**Control-plane side:** `backend/pkg/egresspolicy` normalizes per-gateway ordered firewall rules and authorizes tunnel targets by protocol, host pattern, CIDR, port, user, and team before opening broker streams. Rules can allow or disallow, disabled rules are ignored, empty user/team scope applies to everyone, and no match denies by default. Denials are audited as `TUNNEL_EGRESS_DENIED`.

**Gateway-runtime side:** managed database proxy gateways receive the normalized policy in `ARSENALE_EGRESS_POLICY_JSON` and enforce the same checks before outbound database operations. Scoped policies require signed principal headers from the control plane; the runtime rejects scoped enforcement when `RUNTIME_EGRESS_PRINCIPAL_SIGNING_KEY` or the signature is unavailable.

**Agent-side:** the TCP forwarder only allows the exact configured local service address. This layered approach means session bugs, broker misuse, and compromised gateway runtimes each hit a separate guardrail.

### Frame Size Limits

Frames shorter than 4 bytes (the header size) are silently dropped. There is no explicit maximum payload size at the protocol level, but the underlying WebSocket library enforces its own limits.

### Token Auth

- **256-bit random tokens** generated with `crypto.randomBytes(32)`.
- **SHA-256 hash** stored for authentication comparison.
- **Constant-time comparison** via `crypto.timingSafeEqual()` on both the hash and the decrypted token (defense-in-depth with two independent comparisons).
- **Encrypted storage** -- the raw token is also stored AES-256-GCM encrypted so it can be recovered if needed (e.g., for re-displaying to the operator).

### Heartbeat Throttling

DB writes from heartbeat/PONG handlers are fire-and-forget (`.catch(() => {})`) and do not block the frame handler. The gateway monitor imposes a configurable check interval (typically 30-60s) for status derivation, preventing excessive DB writes even if the agent sends heartbeats every 15s.

### Audit Log Sanitization

Tunnel events are logged with controlled detail objects:
- `TUNNEL_CONNECT` -- only `clientVersion` and `clientIp`.
- `TUNNEL_DISCONNECT` -- no details.
- `TUNNEL_TOKEN_GENERATE` -- no token value logged.
- `TUNNEL_TOKEN_ROTATE` -- only `revoked: true` or `certRotation: true` flags.
- `TUNNEL_EGRESS_DENIED` -- protocol, target host, target port, gateway ID, optional connection ID, and denial reason.

The raw tunnel token is never written to the audit log.

---

## Extending the Tunnel System

### Adding a New Message Type

1. **Define the constant** in both `backend/internal/tunnelbroker` and `gateways/tunnel-agent/protocol.go`.

2. **Add a handler on the server** in `attachFrameHandler()` (`tunnel.service.ts`, line 309):
   ```typescript
   case MsgType.MY_NEW_TYPE:
     handleMyNewType(conn, streamId, payload);
     break;
   ```

3. **Add a handler on the agent** in `tunnelAgent.handleMessage()`.

4. **Build frames** with `buildFrame(MsgType.MY_NEW_TYPE, streamId, payloadBuffer)`.

5. **Use `streamId = 0`** for control-plane messages (like PING/PONG/HEARTBEAT/CERT_RENEW). Use non-zero `streamId` for messages tied to a specific stream.

### Adding a New Gateway Type

To support a new protocol beyond SSH/RDP/VNC:

1. **Session service** -- add a new session creation path following the Go SSH, desktop, or database session services. Include the tunnel routing block:
   ```typescript
   if (gateway.tunnelEnabled) {
     if (!isTunnelConnected(gateway.id)) {
       throw new AppError('Gateway tunnel is disconnected', 503);
     }
     // For stream-based protocols (like SSH):
     const sock = await openStream(gateway.id, host, port);
     // For TCP-address-based protocols (like guacd):
     const { localPort } = await createTcpProxy(gateway.id, host, port);
   }
   ```

2. **Choose the integration pattern:**
   - **`openStream()`** for protocols where you control the client library and can pass a `Duplex` stream (like SSH2's `sock` option).
   - **`createTcpProxy()`** for protocols that require a TCP `host:port` address (like guacd).

3. **Egress policy:** add the protocol to `backend/pkg/egresspolicy`, enforce it before opening tunnel routes, and pass the normalized policy into any managed gateway runtime that can initiate its own outbound connections.

4. **Agent-side:** no protocol-specific changes are needed if the new gateway still exposes one local TCP service. The agent forwards bytes only to its configured local service address.

### Implementing Certificate Rotation

To complete the cert rotation stub:

Certificate generation and persistence live in the Go gateway service. The agent already handles `CERT_RENEW` by replacing its in-memory client certificate/key material and reconnecting so the next WebSocket handshake uses the renewed credentials.

---

## Key File Reference

| Component              | File                                                  |
|------------------------|-------------------------------------------------------|
| TunnelBroker           | `backend/internal/tunnelbroker`                       |
| WSS Upgrade Handler    | `backend/internal/tunnelbroker/broker_handlers.go`    |
| ABAC Evaluation / CRUD | `backend/internal/accesspolicies/service.go`          |
| Session Controller     | `server/src/controllers/session.controller.ts`        |
| SSH Service            | `server/src/services/ssh.service.ts`                  |
| Gateway Monitor        | `server/src/services/gatewayMonitor.service.ts`       |
| Agent Protocol         | `gateways/tunnel-agent/protocol.go`                  |
| Agent TCP Forwarder    | `gateways/tunnel-agent/tcp_forwarder.go`             |
| Agent Main Loop        | `gateways/tunnel-agent/agent.go`                     |
| Agent Config           | `gateways/tunnel-agent/config.go`                    |
| Agent Auth             | `gateways/tunnel-agent/auth.go`                      |
