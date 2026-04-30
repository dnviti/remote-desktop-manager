# Tunnel & ABAC Implementation Guide

> Auto-generated on 2026-03-15 by `/docs create guides`.

> Runtime note: the public tunnel path now terminates in the Go control plane, Go tunnel broker, and Go tunnel agent. Any remaining `server/src` references are historical implementation notes retained for protocol context.

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

1. **Agent connects** -- The `TunnelAgent` on the remote network opens a WSS connection to `/api/tunnel/connect` with a `Bearer` token, `X-Gateway-Id`, and client certificate header.
2. **Server authenticates** -- `backend/internal/tunnelbroker` extracts headers, authenticates the tunnel request, completes the WebSocket upgrade, and registers the connection.
3. **Session request** -- A user opens an SSH/RDP/VNC session. The session path detects `gateway.tunnelEnabled` and calls `openStream()` or `createTCPProxy()`.
4. **OPEN frame** -- The broker sends an OPEN frame with `host:port` payload through the WebSocket.
5. **Agent forwards** -- The agent's `Forwarder.HandleOpen()` opens a local TCP connection to `localhost:port`, then sends back an OPEN ack.
6. **Bidirectional data** -- DATA frames flow in both directions, tagged with the `streamId`. The broker wraps data into a Go stream that proxy code can pipe transparently.
7. **Teardown** -- Either side sends a CLOSE frame to end the stream. When the WebSocket itself drops, all streams are destroyed.

---

## Binary Frame Protocol

The wire protocol is shared by the Go broker (`backend/internal/tunnelbroker`) and Go agent (`gateways/tunnel-agent/`) through `gateways/gateway-core/protocol`. Every WebSocket message is a binary frame with the following layout:

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

Defined in `gateways/gateway-core/protocol/types.go`:

```go
const (
	MsgOpen      byte = 1
	MsgData      byte = 2
	MsgClose     byte = 3
	MsgPing      byte = 4
	MsgPong      byte = 5
	MsgHeartbeat byte = 6
	MsgCertRenew byte = 7
)
```

### Frame Construction

Both sides use an identical `buildFrame` function:

```go
func BuildFrame(msgType byte, streamID uint16, payload []byte) []byte {
	frame := make([]byte, HeaderSize+len(payload))
	frame[0] = msgType
	frame[1] = 0
	binary.BigEndian.PutUint16(frame[2:4], streamID)
	copy(frame[HeaderSize:], payload)
	return frame
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

**File:** `backend/internal/tunnelbroker/`

The TunnelBroker is a singleton module that manages all tunnel connections via a global in-memory registry.

### Connection Registry

```go
type Broker struct {
	registry map[string]*tunnelConnection
}
```

Each entry is a `TunnelConnection`:

```go
type tunnelConnection struct {
	gatewayID     string
	ws            *websocket.Conn
	streams       map[uint16]*streamConn
	pendingOpens  map[uint16]*pendingOpen
	nextStreamID  uint16
	lastHeartbeat time.Time
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

### Stream Multiplexing (`openStream` -> `streamConn`)

`openStream()` is the primary broker API used by session code. It returns a Go `streamConn` backed by `io.Pipe`:

```go
func (b *Broker) openStream(gatewayID, host string, port int, timeout time.Duration) (*streamConn, error)
```

**How it works:**

1. Allocates a unique `streamId` (wraparound with collision detection).
2. Sends an OPEN frame with `"host:port"` as the UTF-8 payload.
3. Waits for the agent to respond with an OPEN ack frame (same `streamId`).
4. Creates a `streamConn` where reads are push-driven by incoming DATA frames, writes send DATA frames to the agent, and close sends a CLOSE frame before removing the stream from the registry.

The returned `streamConn` implements `io.ReadWriteCloser`, so broker code can pipe local sockets and tunnel streams bidirectionally.

### TCP Proxy (`createTCPProxy`)

For RDP and VNC, guacd needs a `host:port` to connect to. Since `openStream()` returns a stream (not a TCP address), `createTCPProxy()` bridges the gap:

```go
func (b *Broker) createTCPProxy(req contracts.TunnelProxyRequest) (contracts.TunnelProxyResponse, error)
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
- `gateways/tunnel-agent/main.go` -- entrypoint, healthcheck flag, signal handling
- `gateways/tunnel-agent/agent.go` -- WebSocket lifecycle, heartbeat, frame dispatch, cert renewal
- `gateways/tunnel-agent/forwarder.go` -- local TCP connection management
- `gateways/tunnel-agent/config.go` -- environment-based configuration
- `gateways/gateway-core/protocol/` -- binary frame encoding/decoding
- `gateways/gateway-core/auth/` -- WebSocket auth headers and TLS helpers

### Configuration & Dormant Mode

Configuration is entirely environment-driven (`gateways/tunnel-agent/config.go`):

| Variable                     | Required | Default     | Description                              |
|------------------------------|----------|-------------|------------------------------------------|
| `TUNNEL_SERVER_URL`          | Yes      | --          | Arsenale server URL or TunnelBroker WSS URL |
| `TUNNEL_TOKEN`               | Yes      | --          | Bearer token from the tunnel deployment bundle |
| `TUNNEL_GATEWAY_ID`          | Yes      | --          | Gateway UUID                             |
| `TUNNEL_LOCAL_PORT`          | Yes      | --          | Local service port to proxy to           |
| `TUNNEL_LOCAL_HOST`          | No       | `127.0.0.1` | Local service host                       |
| `TUNNEL_CA_CERT`             | No       | --          | PEM CA cert for server verification      |
| `TUNNEL_CA_CERT_FILE`        | No       | --          | Path to PEM CA cert for server verification |
| `TUNNEL_CLIENT_CERT_FILE`    | Broker auth | --       | Path to CLI-generated client cert        |
| `TUNNEL_CLIENT_KEY_FILE`     | Broker auth | --       | Path to CLI-generated client key         |
| `TUNNEL_CLIENT_CERT`         | Broker auth | --       | Inline PEM client cert alternative       |
| `TUNNEL_CLIENT_KEY`          | Broker auth | --       | Inline PEM client key alternative        |
| `TUNNEL_PING_INTERVAL_MS`   | No       | `15000`     | Heartbeat interval                       |
| `TUNNEL_RECONNECT_INITIAL_MS`| No      | `1000`      | Initial reconnect backoff                |
| `TUNNEL_RECONNECT_MAX_MS`   | No       | `60000`     | Maximum reconnect backoff                |

`LoadConfigFromEnv()` validates the four core runtime variables. `TUNNEL_SERVER_URL` accepts an Arsenale HTTP(S) base URL, a host without a scheme, or an explicit WebSocket broker URL. HTTP(S) values are normalized to WS(S) and get `/api/tunnel/connect` appended; explicit `ws://` and `wss://` URLs keep their provided path.

The broker authentication path additionally requires client certificate material, either via the `_FILE` variables used by compose installs or the inline PEM variables used by managed runtime injection. Inline PEM values take precedence over matching `_FILE` values.

**Dormant mode:** If none of `TUNNEL_SERVER_URL`, `TUNNEL_TOKEN`, or `TUNNEL_GATEWAY_ID` are set, `LoadConfigFromEnv()` reports dormant mode and the agent exits cleanly. This allows the same Docker image to be deployed with or without tunnel functionality. However, if some but not all required vars are set, the agent exits with an error code -- partial configuration is treated as a misconfiguration.

### Connection Lifecycle & Reconnection

The Go `Agent` (`gateways/tunnel-agent/agent.go`) manages a single WebSocket connection with automatic reconnection:

```
Run() -> connect() -> runConnection() -> pingLoop()
                  -> [read error / close] -> DestroyAll() -> waitReconnect() -> connect()
                  -> [context cancel] -> close websocket -> DestroyAll()
```

Reconnection uses **exponential backoff**:
- Initial delay: `reconnectInitialMs` (default 1s)
- Each failure doubles the delay
- Capped at `reconnectMaxMs` (default 60s)
- Reset to initial on successful connection

Graceful shutdown: `SIGTERM` and `SIGINT` cancel the agent context, close the WebSocket with code 1001, destroy all active sockets, and return from `Run()`.

### TCP Forwarder (`Forwarder.HandleOpen` -> local TCP)

When the broker sends an OPEN frame, `Forwarder.HandleOpen()` (`gateways/tunnel-agent/forwarder.go`):

1. Parses `"host:port"` from the payload.
2. Validates the port is 1-65535.
3. **Checks the host against an allowlist** (see SSRF prevention below).
4. Opens a TCP connection to the local service.
5. Stores the socket and sends an OPEN ack back to broker.
6. Copies local bytes into DATA frames back to broker.
7. On EOF/error: cleans up and sends a CLOSE frame.

Active sockets are tracked in a mutex-protected `map[uint16]net.Conn`.

```go
type Forwarder struct {
	mu      sync.Mutex
	sockets map[uint16]net.Conn
}
```

### Health Probing (`probeLocalService`)

Every `pingIntervalMs` (default 15s), the agent probes the local service by attempting a TCP connection:

```go
func (a *Agent) probeLocalService() healthStatus {
	start := time.Now()
	addr := net.JoinHostPort(a.cfg.LocalServiceHost, fmt.Sprintf("%d", a.cfg.LocalServicePort))
	conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return healthStatus{Healthy: false, LatencyMs: latency, ActiveStreams: a.forwarder.ActiveStreamCount()}
	}
	_ = conn.Close()
	return healthStatus{Healthy: true, LatencyMs: latency, ActiveStreams: a.forwarder.ActiveStreamCount()}
}
```

The result is encoded as JSON in the PING frame payload:

```json
{ "healthy": true, "latencyMs": 3, "activeStreams": 2 }
```

### Localhost-Only Restriction (SSRF Prevention)

The TCP forwarder enforces a strict allowlist for target hosts:

```go
func isAllowedLocalHost(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}
```

This prevents SSRF attacks where a compromised broker could instruct the agent to connect to arbitrary internal hosts. The agent only proxies to `localhost`, `127.0.0.1`, or `::1`. If the proxied service (e.g., guacd) needs to reach other hosts, that routing happens at the service level, not at the tunnel level.

---

## Session Integration

### SSH: openStream -> Tunnel Stream -> SSH Client

**File:** `server/src/socket/ssh.handler.ts`

When an SSH session targets a tunnel-enabled gateway, the handler:

1. Checks `gateway.tunnelEnabled` and `isTunnelConnected(gateway.id)`.
2. Calls `openStream(gateway.id, bastionHost, bastionPort)` to get a tunnel stream.
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

This is the key design insight: by exposing tunnel streams as `io.ReadWriteCloser`-style objects, broker code can adapt existing SSH and TCP proxy paths without exposing the gateway on the public network.

### RDP/VNC: createTCPProxy -> local TCP listener -> guacd

**File:** `server/src/controllers/session.controller.ts`

For RDP and VNC, guacd connects to a `host:port` via TCP, so the tunnel integration uses `createTCPProxy()` to create a local proxy:

```typescript
// session.controller.ts (lines 92-101, RDP path; 324-333, VNC path)
if (gateway.tunnelEnabled) {
  if (!isTunnelConnected(gateway.id)) {
    throw new AppError('Gateway tunnel is disconnected — the gateway may be unreachable', 503);
  }
  const targetHost = guacdHost ?? gateway.host;
  const targetPort = guacdPort ?? gateway.port;
  const { server: _proxyServer, localPort } = await createTCPProxy(gateway.id, targetHost, targetPort);
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

## Certificate Rotation (Stub)

**File:** `server/src/services/tunnel.service.ts` (lines 686-884)

### Current State

The certificate rotation infrastructure is built out but the actual X.509 certificate generation is a **stub**. The `generateClientCert()` function generates an RSA key pair but produces a PKCS#1 public key PEM rather than a proper X.509 certificate:

```typescript
// tunnel.service.ts (lines 825-856)
function generateClientCert(
  _caCertPem: string,
  _caKeyPem: string,
  validityDays: number,
): { cert: string; expiry: Date } {
  // ... generates RSA key pair
  // ... exports public key PEM (not a real certificate)
  void privateKey;  // unused
  return { cert: certPem, expiry };
}
```

The CA cert and CA key parameters are prefixed with `_` (unused). This function needs to be replaced with a proper X.509 certificate signing implementation.

### Future: X.509 Cert Generation

To implement proper cert rotation:
1. Use Go's `crypto/x509` package to create or sign the client certificate material.
2. Sign the CSR with the gateway's CA key (stored encrypted in `tunnelCaKey`).
3. Set the `Subject` and `SubjectAlternativeName` appropriately.
4. The `validityDays` is currently set to 90 days.

### CERT_RENEW Frame Flow

The rotation flow is already wired up:

1. **Scheduler** -- `startCertRotationScheduler()` runs `processCertRotations()` every 6 hours and once at startup.
2. **Candidate selection** -- Finds gateways where `tunnelClientCertExp` is within 7 days of expiry.
3. **Cert generation** -- Decrypts CA key, generates new cert, persists to DB.
4. **Delivery** -- `sendCertRenew()` sends a `CERT_RENEW` frame with the new PEM cert.
5. **Agent handling** -- Currently logs a warning: `"Certificate renewal via tunnel not yet implemented"`.
6. **Managed gateways** -- Triggers a rolling restart via `rollingRestartForCertRotation()` so instances pick up the new cert from environment.

---

## Security Hardening Applied

### SSRF Prevention

**Agent-side:** The TCP forwarder only allows connections to `localhost`, `127.0.0.1`, and `::1`. Any other host in an OPEN frame is rejected with a CLOSE frame (`tcpForwarder.ts`, lines 50-56).

**Server-side:** The `openStream()` API accepts arbitrary `host:port` parameters (the server trusts its own callers), but the agent enforces the localhost restriction. This layered approach means that even if a bug in session code passes a wrong host, the agent blocks it.

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

The raw tunnel token is never written to the audit log.

---

## Extending the Tunnel System

### Adding a New Message Type

1. **Define the constant** in `gateways/gateway-core/protocol/types.go`:
   ```go
   const MsgMyNewType byte = 16
   ```

2. **Add a handler on the broker** in `Broker.readLoop()` (`backend/internal/tunnelbroker/broker_connections.go`):
   ```go
   case msgMyNewType:
    b.handleMyNewType(conn, streamID, body)
   ```

3. **Add a handler on the agent** in `Agent.handleFrame()` (`gateways/tunnel-agent/agent.go`):
   ```go
   case protocol.MsgMyNewType:
    // handle or delegate
   ```

4. **Build frames** with `protocol.BuildFrame(protocol.MsgMyNewType, streamID, payload)`.

5. **Use `streamId = 0`** for control-plane messages (like PING/PONG/HEARTBEAT/CERT_RENEW). Use non-zero `streamId` for messages tied to a specific stream.

### Adding a New Gateway Type

To support a new protocol beyond SSH/RDP/VNC:

1. **Session controller** -- Add a new session creation function following the pattern in `session.controller.ts`. Include the tunnel routing block:
   ```typescript
   if (gateway.tunnelEnabled) {
     if (!isTunnelConnected(gateway.id)) {
       throw new AppError('Gateway tunnel is disconnected', 503);
     }
     // For stream-based protocols (like SSH):
     const sock = await openStream(gateway.id, host, port);
     // For TCP-address-based protocols (like guacd):
     const { localPort } = await createTCPProxy(gateway.id, host, port);
   }
   ```

2. **Choose the integration pattern:**
   - **`openStream()`** for protocols where broker code can consume an `io.ReadWriteCloser`.
   - **`createTCPProxy()`** for protocols that require a TCP `host:port` address (like guacd).

3. **Agent-side:** No changes needed -- the agent doesn't care what protocol runs over the TCP stream. It just forwards bytes between `localhost:port` and the tunnel.

### Implementing Certificate Rotation

To complete the cert rotation stub:

1. Keep certificate generation and encrypted key storage in the Go control plane/tunnel broker.
2. Send a `CERT_RENEW` frame with JSON `{ "clientCert": "<PEM>", "clientKey": "<PEM>" }`.
3. The Go agent's `MsgCertRenew` handler updates in-memory cert material and reconnects with WebSocket close code `1012`.

4. **Test the rotation scheduler** by setting `CERT_ROTATION_THRESHOLD_DAYS` to a higher value or creating a gateway with an `tunnelClientCertExp` date in the near future.

---

## Key File Reference

| Component              | File                                                  |
|------------------------|-------------------------------------------------------|
| TunnelBroker           | `backend/internal/tunnelbroker/`                      |
| WSS Upgrade Handler    | `backend/internal/tunnelbroker/broker_handlers.go`    |
| ABAC Evaluation / CRUD | `backend/internal/accesspolicies/service.go`          |
| Session Controller     | `server/src/controllers/session.controller.ts`        |
| SSH Service            | `server/src/services/ssh.service.ts`                  |
| Gateway Monitor        | `server/src/services/gatewayMonitor.service.ts`       |
| Agent Protocol         | `gateways/gateway-core/protocol/`                    |
| Agent TCP Forwarder    | `gateways/tunnel-agent/forwarder.go`                 |
| Agent Runtime          | `gateways/tunnel-agent/agent.go`                     |
| Agent Config           | `gateways/tunnel-agent/config.go`                    |
| Agent Auth             | `gateways/gateway-core/auth/`                        |
