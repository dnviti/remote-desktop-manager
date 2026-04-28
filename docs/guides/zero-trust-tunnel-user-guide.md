# Zero-Trust Tunnel User Guide

> Auto-generated on 2026-03-15 by `/docs create guides`.
> Source of truth is the codebase. Run `/docs update guides` after code changes.

## Overview

Zero-trust tunnels allow remote gateways (guacd, SSH bastions) to connect to the Arsenale server **without opening any inbound ports** on the remote network. Instead of the server reaching out to the gateway, the gateway's embedded tunnel agent initiates an outbound WebSocket (WSS) connection to the server's Tunnel Broker endpoint.

### Why Zero-Trust Tunnels Matter

Traditional remote-desktop gateways require inbound firewall rules -- exposing services like guacd (TCP 4822) or SSH (TCP 2222) to the internet or a VPN. Zero-trust tunnels invert that model:

- **No inbound ports** -- the agent connects outbound over HTTPS (port 443).
- **Token-based authentication** -- each agent presents a cryptographic token; no shared credentials.
- **Centralized control** -- administrators can revoke tokens, force-disconnect agents, restrict source IPs, and enforce time-based access policies from the Arsenale UI.
- **Automatic reconnection** -- the agent uses exponential backoff to reconnect if the connection drops.

### Architecture

```
 Remote Network                         Arsenale Server
 +-----------------+                    +-------------------+
 |                 |     WSS :443       |                   |
 |  guacd / sshd   |  <--- outbound --- | Tunnel Broker     |
 |  (local :4822   |     (TLS)         | (WebSocket server)|
 |   or :2222)     |                    |                   |
 |                 |                    +-------------------+
 |  tunnel-agent --+------>------------>|  /tunnel endpoint |
 +-----------------+                    +-------------------+
       ^                                        |
       |  TCP localhost                         | Proxied
       +--- no inbound firewall rules           | streams
                                                v
                                         End users (browser)
```

The tunnel agent runs alongside the gateway service (guacd or sshd) either as an embedded sidecar process inside the same container, or as a standalone container. It opens a persistent WSS connection to the server, which multiplexes RDP/SSH streams back through that single outbound channel.

## Prerequisites

- **Arsenale server** reachable over HTTPS (or HTTP for development) from the remote host.
- **Docker** on the remote host (recommended), or **Go 1.25+** when building a bare-metal agent from source.
- An **administrator account** on the Arsenale instance to create gateways and generate tunnel tokens.

## Quick Start

Get a tunnel-connected gateway running in under 5 minutes:

1. **Create a gateway** in the Arsenale UI: navigate to **Settings > Gateways > Add Gateway**. Choose type `GUACD` or `SSH_BASTION`, fill in a name, and save.

2. **Enable the tunnel**: in the gateway edit dialog, expand the **Zero-Trust Tunnel** accordion and click **Enable Zero-Trust Tunnel**. The UI generates a one-time token.

3. **Copy the Docker command**: the UI presents a ready-to-paste `docker run` command. Copy it.

4. **Run it on the remote host**:

   ```bash
   docker run -d --restart=unless-stopped \
     -e TUNNEL_TOKEN="<token>" \
    -e TUNNEL_SERVER_URL="wss://arsenale.example.com/api/tunnel/connect" \
     -e TUNNEL_GATEWAY_ID="<uuid>" \
     -e TUNNEL_LOCAL_PORT="4822" \
     arsenale/tunnel-agent:latest
   ```

5. **Verify**: back in the gateway dialog, the status chip turns green with **Connected** and the "since" timestamp appears.

## Gateway Configuration

### Creating a Gateway with Tunnel

1. Open **Settings > Gateways** and click **Add Gateway**.
2. Fill in:
   - **Name** -- descriptive label (e.g. "DC-East guacd").
   - **Type** -- `GUACD` for RDP/VNC, `SSH_BASTION` for SSH.
   - **Host** -- leave as `localhost` (the tunnel agent handles routing).
   - **Port** -- the local port of the proxied service (`4822` for guacd, `2222` for sshd).
3. Save the gateway.
4. Expand the **Zero-Trust Tunnel** section and click **Enable Zero-Trust Tunnel**.

When a tunnel is enabled, the **Host** field becomes read-only (labeled "Managed by tunnel") and the **Port** source shows "Tunnel".
Before using the tunnel for production traffic, configure the gateway egress policy so only expected target hosts, subnets, protocols, and ports can be reached.

### Enabling Tunnel on an Existing Gateway

1. Edit the gateway from the gateway list.
2. Expand the **Zero-Trust Tunnel** accordion.
3. Click **Enable Zero-Trust Tunnel**.
4. Deploy the agent using the generated token (see [Deploying the Tunnel Agent](#deploying-the-tunnel-agent)).

### Generating a Tunnel Token

Tokens are generated automatically when you enable a tunnel or rotate credentials. The token is displayed **once** in a read-only text field with a copy button. Store it securely -- it cannot be retrieved again after closing the dialog.

For managed gateways (containers orchestrated by Arsenale), the token is injected into the container environment automatically and shown in the dialog for reference.

### Revoking / Rotating Tokens

From the gateway edit dialog, inside the **Zero-Trust Tunnel** section:

- **Rotate Token** -- generates a new token and invalidates the old one. The agent must be redeployed with the new token. Use this periodically or if a token may have been exposed.
- **Revoke Token** -- disables the tunnel entirely. The agent is disconnected and the token is deleted.

Both actions require confirmation and take effect immediately.

## Deploying the Tunnel Agent

The tunnel agent is a lightweight Go binary. It can run in three deployment modes.

### Docker Run (Single Container)

The simplest approach -- a single standalone container:

```bash
docker run -d --restart=unless-stopped \
  --name arsenale-tunnel \
  -e TUNNEL_SERVER_URL="wss://arsenale.example.com/api/tunnel/connect" \
  -e TUNNEL_TOKEN="<your-token>" \
  -e TUNNEL_GATEWAY_ID="<gateway-uuid>" \
  -e TUNNEL_LOCAL_PORT="4822" \
  arsenale/tunnel-agent:latest
```

For an SSH gateway, change `TUNNEL_LOCAL_PORT` to `2222` and ensure an sshd is reachable on that port from the container's network.

The container runs as a non-root user (`agent`) and requires no volumes or capabilities.

### Docker Compose

For environments where you run guacd or sshd alongside the tunnel agent, keep the agent in the same network namespace as the local service or use the embedded gateway images:

```yaml
services:
  guacd:
    image: guacamole/guacd:1.6.0
    restart: always

  arsenale-tunnel:
    image: arsenale/tunnel-agent:latest
    restart: always
    environment:
      TUNNEL_SERVER_URL: "wss://arsenale.example.com/api/tunnel/connect"
      TUNNEL_TOKEN: "<your-token>"
      TUNNEL_GATEWAY_ID: "<gateway-uuid>"
      TUNNEL_LOCAL_PORT: "4822"
    network_mode: "service:guacd"
    depends_on:
      - guacd
```

Alternatively, use the **embedded agent images** which bundle the tunnel agent directly inside the gateway container:

```yaml
services:
  guacd:
    build:
      context: .
      dockerfile: gateways/guacd/Dockerfile
    restart: always
    environment:
      TUNNEL_SERVER_URL: "wss://arsenale.example.com/api/tunnel/connect"
      TUNNEL_TOKEN: "<your-token>"
      TUNNEL_GATEWAY_ID: "<gateway-uuid>"
      TUNNEL_LOCAL_PORT: "4822"
```

The embedded guacd image (`gateways/guacd/Dockerfile`) and SSH gateway image (`gateways/ssh-gateway/Dockerfile`) both include a pre-built copy of the tunnel agent. The entrypoint launches the agent as a background process before starting the main service. If the `TUNNEL_SERVER_URL` variable is not set, the agent remains dormant and the container operates normally.

### Systemd Service (Bare-Metal)

For hosts where Docker is not available:

1. Install the tunnel agent binary or build from source:

   ```bash
   cd gateways/tunnel-agent
   go build -trimpath -ldflags="-s -w" -o arsenale-tunnel-agent .
   ```

2. Create a systemd unit file at `/etc/systemd/system/arsenale-tunnel.service`:

   ```ini
   [Unit]
   Description=Arsenale Tunnel Agent
   After=network-online.target
   Wants=network-online.target

   [Service]
   Type=simple
   Restart=always
   RestartSec=5
   Environment=TUNNEL_SERVER_URL=wss://arsenale.example.com/api/tunnel/connect
   Environment=TUNNEL_TOKEN=<your-token>
   Environment=TUNNEL_GATEWAY_ID=<gateway-uuid>
   Environment=TUNNEL_LOCAL_PORT=4822
   ExecStart=/usr/local/bin/arsenale-tunnel-agent

   [Install]
   WantedBy=multi-user.target
   ```

3. Enable and start the service:

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now arsenale-tunnel
   sudo systemctl status arsenale-tunnel
   ```

### Kubernetes Deployment

Run the tunnel agent as a sidecar container in a Pod alongside guacd:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: arsenale-gateway
spec:
  replicas: 1
  selector:
    matchLabels:
      app: arsenale-gateway
  template:
    metadata:
      labels:
        app: arsenale-gateway
    spec:
      containers:
        - name: guacd
          image: guacamole/guacd:1.6.0
          ports:
            - containerPort: 4822

        - name: tunnel-agent
          image: arsenale/tunnel-agent:latest
          env:
            - name: TUNNEL_SERVER_URL
              value: "https://arsenale.example.com"
            - name: TUNNEL_GATEWAY_ID
              value: "<gateway-uuid>"
            - name: TUNNEL_LOCAL_HOST
              value: "localhost"       # shares the Pod network
            - name: TUNNEL_LOCAL_PORT
              value: "4822"
            - name: TUNNEL_TOKEN
              valueFrom:
                secretKeyRef:
                  name: arsenale-tunnel-secret
                  key: token
```

Create the secret:

```bash
kubectl create secret generic arsenale-tunnel-secret \
  --from-literal=token=<your-token>
```

## Tenant-Level Tunnel Settings

Administrators can configure organization-wide tunnel policies from **Settings > Tunnel Configuration**. These settings affect all gateways within the tenant.

### Default Tunnel Mode

| Setting | Description |
|---------|-------------|
| **Enable tunnel by default for new gateways** | When toggled on, newly created gateways will have tunneling enabled automatically. |
| **Require tunnel for remote gateways** | When enabled, connections to gateways outside the local network must use a zero-trust tunnel. Direct connections are blocked. |

### Token Security (Auto-Rotation, Max Lifetime)

| Setting | Description | Default |
|---------|-------------|---------|
| **Auto-rotate tunnel tokens** | Automatically generates a new token at the specified interval. The old token is revoked. | Off |
| **Rotation interval (days)** | How often tokens are rotated when auto-rotation is enabled. Range: 1--365. | 90 days |
| **Max token lifetime (days)** | Hard cap on how long any token can remain valid. Leave empty for no limit. Range: 1--365. | No limit |

When auto-rotation is enabled, the server schedules token replacement at the configured interval. The tunnel agent must be updated with the new token (for standalone deployments) or the server injects it automatically (for managed gateways).

### Agent IP Restrictions (CIDR Allowlist)

Restrict which source IP addresses tunnel agents can connect from. This adds a network-level guard on top of token authentication.

- Enter CIDR ranges (e.g. `10.0.0.0/8`, `192.168.1.0/24`) or individual IPs.
- Multiple entries are supported.
- **Empty list** = no restrictions (agents can connect from any IP).
- Both IPv4 and IPv6 addresses are accepted.

## Per-Gateway Egress Policy

Each gateway has an `egressPolicy` JSON document that controls where tunneled sessions may send traffic after the user has passed normal Arsenale access checks. The default policy is `{"rules":[]}`, which denies all tunneled egress until an administrator adds rules.

Rules are evaluated top to bottom like firewall rules. The first enabled rule that matches the protocol, destination port, destination host or resolved IP CIDR, and optional user/team scope wins. `action` may be `ALLOW` or `DISALLOW`; omitted `action` defaults to `ALLOW` for older policies. Disabled rules are saved as drafts and ignored. If `userIds` and `teamIds` are both empty, the rule applies to everyone. If no rule matches, traffic is denied.

```json
{
  "rules": [
    {
      "description": "Allow production SSH subnet",
      "enabled": true,
      "action": "ALLOW",
      "protocols": ["SSH"],
      "cidrs": ["10.20.30.0/24"],
      "ports": [22]
    },
    {
      "description": "Block one contractor team from database hosts",
      "enabled": true,
      "action": "DISALLOW",
      "teamIds": ["9fe7fd1b-6da2-45d9-aa2a-8a2bb43b05e0"],
      "protocols": ["DATABASE"],
      "hosts": ["db01.internal.example.com", "*.readonly.internal.example.com"],
      "ports": [5432, 3306]
    }
  ]
}
```

Supported protocols are `SSH`, `RDP`, `VNC`, and `DATABASE`. Host patterns must be exact names or leading wildcards such as `*.example.com`; a bare `*` is rejected. CIDRs accept IPv4 and IPv6 ranges.

Administrators can configure this from the widened gateway edit dialog by expanding **Zero-Trust Tunnel** and using the **Egress Firewall Rules** datatable. Add and edit actions open the rule side panel for action, enabled state, user/team scope, protocols, destinations, and ports. The editor starts in default-deny mode, accepts exact hosts, leading wildcard hosts, CIDRs, and individual IPs, and saves bare IP entries as exact-match `/32` or `/128` prefixes. The same policy remains available through the CLI for scripted updates.

The control plane evaluates the policy before opening SSH, RDP, VNC, and database tunnel routes. Managed database proxy gateways also receive the normalized policy as `ARSENALE_EGRESS_POLICY_JSON` and enforce it at query execution time. When a DB proxy policy contains user or team scope, the control plane signs the runtime principal context with `RUNTIME_EGRESS_PRINCIPAL_SIGNING_KEY`; runtimes deny scoped policies if that key or signature is missing. Denied attempts return `403` and write a `TUNNEL_EGRESS_DENIED` audit event with the protocol, target host, target port, gateway ID, matched rule metadata, and reason.

CLI examples:

```bash
arsenale gateway egress show <gateway-id>
arsenale gateway egress set <gateway-id> --from-file ./gateway-egress-policy.json
arsenale gateway egress test <gateway-id> --protocol DATABASE --host db01.internal.example.com --port 5432 --user-id <user-id>
```

## Access Control (ABAC Policies)

Attribute-Based Access Control policies restrict when and how users can open sessions through gateways. Policies are managed from **Settings > Access Policies**.

### Creating an Access Policy

1. Click **Add Policy**.
2. Select a **Target Type**:
   - **Tenant** -- applies to all sessions in the organization.
   - **Team** -- applies to sessions initiated by members of a specific team.
   - **Folder** -- applies to sessions for connections in a specific folder.
3. Select the specific **Target** (auto-set for Tenant-level policies).
4. Configure the desired restrictions (see sections below).
5. Click **Save**.

### Time Window Restrictions

Restrict sessions to specific hours of the day (all times in UTC):

- Format: `HH:MM-HH:MM` (24-hour notation).
- Multiple windows: comma-separated, e.g. `09:00-12:00,13:00-17:00`.
- Leave empty to allow sessions at any time.

Example: to allow sessions only during business hours (Monday through Friday logic is handled server-side):

```
09:00-18:00
```

### Trusted Device Requirements

Toggle **Require trusted device (WebAuthn)** to mandate that the user's browser has a registered WebAuthn security key or platform authenticator before opening a session.

### MFA Step-Up Requirements

Toggle **Require MFA step-up** to force a fresh multi-factor authentication challenge when opening a session, even if the user already authenticated at login.

### How Policies Are Evaluated (Additive, Most Restrictive Wins)

- Policies are **additive**: all policies that match the session context (tenant, team, folder) are collected.
- **All applicable policies must pass** -- the most restrictive combination wins.
- If no policies are defined, all sessions are allowed by default.
- A Tenant-level policy applies to every session. A Team-level policy applies only to sessions initiated by members of that team. A Folder-level policy applies only to connections in that folder.

Example: if a Tenant policy sets `requireMfaStepUp = true` and a Folder policy adds `allowedTimeWindows = 09:00-18:00`, then sessions to connections in that folder require both MFA step-up **and** must occur within the time window.

## Monitoring and Troubleshooting

### Checking Tunnel Status

In the gateway edit dialog, the **Zero-Trust Tunnel** section shows:

- **Status chip**: green "Connected" or red "Disconnected".
- **Connected since**: timestamp of the current session.
- **Client certificate expiration**: shows the expiry date and days remaining. A warning appears when renewal is imminent (within 7 days).

At the tenant level, **Settings > Tunnel Configuration > Fleet Overview** shows:

- Total tunneled gateways, count of connected and disconnected.
- Average RTT across all connected agents.

### Viewing Connection Events

Expand the **Event Log** accordion inside the gateway tunnel section to see a chronological list of tunnel events, including:

- Connection established / disconnected.
- Token rotations and revocations.
- Force-disconnect actions.
- Error events.

Click **Refresh** to reload the event log.

### Live Metrics (RTT, Active Streams)

When a tunnel is connected, expand the **Metrics** accordion to see real-time data:

| Metric | Description |
|--------|-------------|
| **Uptime** | Duration since the current connection was established |
| **RTT** | Round-trip latency of the WebSocket ping-pong (milliseconds) |
| **Active Streams** | Number of currently proxied sessions through this tunnel |
| **Agent Version** | Version of the tunnel agent software running on the remote host |

Click **Refresh Metrics** to fetch updated values.

### Force Disconnecting an Agent

From the gateway tunnel section, click **Force Disconnect** to immediately terminate the WebSocket connection. The agent will automatically attempt to reconnect using exponential backoff (starting at 1 second, up to 60 seconds).

Use this when:
- An agent appears stuck or unresponsive.
- You need to force a reconnection after a network change.
- You want to test reconnection behavior.

### Common Issues and Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| Agent stays "Disconnected" | Firewall blocks outbound WSS (port 443) | Ensure the remote host can reach the server URL over HTTPS |
| `Missing required environment variables` in agent logs | One or more of the four required env vars is not set | Set all of `TUNNEL_SERVER_URL`, `TUNNEL_TOKEN`, `TUNNEL_GATEWAY_ID`, and `TUNNEL_LOCAL_PORT` |
| Agent connects then immediately disconnects | Token was revoked or rotated | Generate a new token and redeploy the agent |
| High RTT values (>200ms) | Network latency between agent and server | Consider a server instance closer to the remote site, or check for network congestion |
| `TUNNEL_LOCAL_PORT must be a valid port number` | Port value is outside 1--65535 or not a number | Verify the `TUNNEL_LOCAL_PORT` value is correct (4822 for guacd, 2222 for sshd) |
| Agent running but sessions fail | `TUNNEL_LOCAL_HOST` points to wrong address | Ensure the target service is reachable from the agent at the configured host and port |
| Session returns `403` with an egress policy message | The gateway `egressPolicy` has no matching allow rule or a matching disallow rule for the requested protocol, host/subnet, port, user, or team | Review rule order and add or adjust a narrow allow rule for that target, then inspect `TUNNEL_EGRESS_DENIED` audit events |
| Certificate expiry warning | mTLS client certificate approaching expiration | Rotate the tunnel token to trigger certificate renewal |

## Environment Variables Reference

All tunnel agent configuration is read from environment variables. If none of the tunnel variables are set, the agent remains **dormant** (exits cleanly with no error).

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `TUNNEL_SERVER_URL` | WSS URL of the Arsenale Tunnel Broker endpoint | `wss://arsenale.example.com/tunnel` |
| `TUNNEL_TOKEN` | Bearer token for authentication (generated in the UI) | `a1b2c3d4e5f6...` |
| `TUNNEL_GATEWAY_ID` | UUID of the gateway this agent represents | `550e8400-e29b-41d4-a716-446655440000` |
| `TUNNEL_LOCAL_PORT` | TCP port of the local service to proxy | `4822` (guacd) or `2222` (sshd) |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TUNNEL_LOCAL_HOST` | Hostname or IP of the local service to proxy | `127.0.0.1` |
| `TUNNEL_CA_CERT` | PEM-encoded CA certificate to verify the server's TLS certificate | _(system default)_ |
| `TUNNEL_CLIENT_CERT` | PEM-encoded client certificate for mutual TLS (mTLS) | _(none)_ |
| `TUNNEL_CLIENT_KEY` | PEM-encoded client private key for mTLS | _(none)_ |
| `TUNNEL_AGENT_VERSION` | Version string reported to the server in the `X-Agent-Version` header | Agent build default |
| `TUNNEL_PING_INTERVAL_MS` | Interval between WebSocket ping frames (milliseconds) | `15000` (15 seconds) |
| `TUNNEL_RECONNECT_INITIAL_MS` | Initial backoff delay before reconnecting after a disconnect | `1000` (1 second) |
| `TUNNEL_RECONNECT_MAX_MS` | Maximum backoff delay cap for reconnection attempts | `60000` (60 seconds) |

### Dormant Mode

If **none** of `TUNNEL_SERVER_URL`, `TUNNEL_TOKEN`, and `TUNNEL_GATEWAY_ID` are set, the agent exits cleanly (exit code 0). This is the expected behavior for the embedded agent in guacd and SSH gateway images when tunneling is not configured.

If **some but not all** required variables are set, the agent prints an error listing the missing variables and exits with code 1.

## Security Considerations

### Token Handling Best Practices

- **Treat tunnel tokens like passwords.** They grant the ability to establish a persistent connection to your Arsenale server.
- **Never commit tokens** to version control. Use Docker secrets, Kubernetes secrets, or environment-variable injection from a secrets manager.
- **Rotate tokens regularly.** Enable auto-rotation in the tenant tunnel settings or manually rotate from the gateway dialog.
- **Set a maximum token lifetime** at the tenant level to ensure tokens cannot persist indefinitely.
- **Revoke tokens immediately** when decommissioning a gateway or if a token may have been compromised.

### Network Security Recommendations

- **Use HTTPS/WSS in production.** The tunnel agent connects to a `wss://` endpoint. Never use unencrypted `ws://` in production.
- **Restrict agent source IPs.** Use the CIDR allowlist in tenant tunnel settings to limit which networks can establish tunnel connections.
- **Set per-gateway egress policies.** Keep `egressPolicy` rules scoped to the exact protocols, ports, hostnames, subnets, users, and teams the gateway must reach.
- **Use mTLS where possible.** Set `TUNNEL_CLIENT_CERT` and `TUNNEL_CLIENT_KEY` on the agent and configure the server to require client certificates for an additional layer of authentication.
- **Configure a custom CA certificate** (`TUNNEL_CA_CERT`) if your server uses a private or internal CA rather than a publicly trusted certificate.
- **Apply ABAC policies** to restrict session access by time window, trusted device, and MFA requirements.
- **Monitor the event log** for unexpected connection patterns (connections from unknown IPs, frequent disconnects, off-hours activity).

### Certificate Rotation

When mTLS is configured, the gateway dialog displays the client certificate expiration date. Rotating the tunnel token triggers certificate renewal. Plan for rotation before certificates expire -- the UI shows a warning when expiry is within 7 days.
