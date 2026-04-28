# Arsenale

> Auto-generated on 2026-04-15. High-level product overview for LLM RAG consumption.

> Runtime note: the live platform now runs through the Go control plane and companion Go services. References to `server/src` or Prisma below are historical migration notes unless explicitly restated as current.

## What is Arsenale

Arsenale is a modern, web-based remote access management platform designed to replace legacy tools like mRemoteNG, RoyalTS, and standalone Apache Guacamole deployments. It provides a unified interface for managing SSH, RDP, VNC, and database connections through a browser or native clients, eliminating the need for complex jump host configurations. Unlike traditional tools that store credentials locally or rely on unencrypted configuration files, Arsenale encrypts all credentials at rest using a zero-knowledge vault architecture where the server never has access to plaintext passwords.

Arsenale combines the remote access capabilities of Guacamole with enterprise-grade features like multi-tenant organizations, team collaboration, encrypted credential vaults, granular audit logging, and managed container infrastructure. It is designed for teams that need centralized, secure remote access without sacrificing usability.

## Who is it For

Arsenale serves IT operations teams managing fleets of servers and workstations, managed service providers (MSPs) who need tenant isolation between clients, DevOps engineers who require SSH access through bastion hosts, and security-conscious organizations that demand encrypted credential storage with audit trails. It is particularly suited for multi-tenant environments where different teams or clients must be isolated from each other while sharing the same platform infrastructure.

## Remote Access

Arsenale supports three remote access protocols through a tabbed browser interface that lets users work with multiple connections simultaneously.

SSH terminals are rendered using a full-featured terminal emulator that supports customizable themes, font families, font sizes, and cursor styles. Each connection can have its own terminal configuration, and users can set global defaults. The SSH file browser is now a managed temporary sandbox only, so users browse sandbox-relative paths, not the raw remote filesystem. Uploads and downloads still flow through shared object storage first, and retained uploads appear in a separate history view.

RDP remote desktop sessions are rendered through the Guacamole protocol, providing a native-quality desktop experience in the browser. Users can configure color depth, display resolution, resize behavior, audio settings, font smoothing, wallpaper, and desktop composition on a per-connection basis. Clipboard synchronization allows copying and pasting between the local machine and the remote desktop. Drive redirection enables file sharing between the local browser and the remote session through a virtual drive, with a built-in file browser for managing transferred files.

VNC connections follow the same pattern as RDP, rendered through the Guacamole protocol with configurable color depth, cursor mode, clipboard encoding, and view-only settings.

All viewer types include a docked edge toolbar, a slim vertical handle anchored to the left or right edge of the connection viewport that expands on click to reveal action buttons. The toolbar can be dragged vertically along the edge, and dragging past the container center switches it to the opposite side. Position and side are persisted across sessions. For RDP and VNC sessions, the toolbar provides clipboard copy and paste with DLP gating, Ctrl+Alt+Del, a Send Keys submenu, screenshot capture, fullscreen toggle, shared drive toggle for RDP only, and session disconnect. For SSH sessions, the toolbar provides the managed sandbox browser and fullscreen toggle. All viewer types support fullscreen mode. In fullscreen mode on Chromium-based browsers, the Keyboard Lock API attempts to capture additional system-level shortcuts and forward them to the remote session, although some OS-reserved sequences cannot be intercepted by any browser and will still be handled by the operating system. Keyboard input in RDP and VNC sessions is captured at the browser level to prevent browser shortcuts from interfering with the remote desktop. Focus management automatically engages keyboard capture when the mouse enters the viewer area and releases it when the mouse leaves.

All three protocols include automatic reconnection with exponential backoff for transient network interruptions (Wi-Fi switches, brief server hiccups). A visual overlay shows reconnection progress, and Guacamole-based sessions (RDP/VNC) display a connection-unstable indicator when the connection degrades. Permanent errors (admin termination, session timeout, authentication failures) are not retried.

SSH gateway support enables bastion host configurations where connections are routed through intermediate jump hosts. Arsenale supports both traditional SSH bastion hosts (with user-provided credentials) and managed SSH gateways where the platform automatically provisions and manages the infrastructure, including key pairs and container instances.

## Encrypted Credential Vault

Every user's credentials are encrypted at rest using AES-256-GCM with keys derived from their password through Argon2id. The vault uses a zero-knowledge architecture: the server stores only encrypted data and never has access to the plaintext master key. When users log in, their password unlocks the vault for a configurable time window, after which it automatically locks. Users can also unlock the vault using multi-factor authentication methods after the initial session, without re-entering their password.

A secrets manager built into the vault allows users to store various credential types including login credentials, SSH key pairs, TLS certificates, API keys, and encrypted notes. Secrets support versioning with full history, allowing users to view previous values and restore older versions. Expiry dates can be set on secrets, with automated scope-aware notifications (personal, team, tenant) when secrets are approaching or have passed expiration, using configurable notification bands (expired, 1 day, 7 days, 30 days) with deduplication. Secrets can be organized into folders scoped to personal, team, or organization levels.

Domain credentials (domain name, username, encrypted password) can be stored at the user profile level and reused across domain-joined connections without re-entering credentials each time.

A recovery key is generated during registration, enabling vault recovery if the user forgets their password. This key is displayed once and must be saved securely by the user.

### External Credential Providers

Connections can reference credentials stored in external secret management systems instead of duplicating them in Arsenale's internal vault. HashiCorp Vault is supported as an external credential provider, using the KV v2 secrets engine. Tenant administrators configure vault providers with server URL, authentication method (static token or AppRole), namespace, mount path, and optional CA certificate. At connection time, credentials are fetched from HashiCorp Vault and injected into SSH/RDP/VNC session parameters. Fetched credentials are cached in-memory with a configurable TTL to minimize API calls. External vault credentials are never persisted in Arsenale's database.

## Team Collaboration and Sharing

Connections can be shared with other users using granular permission levels. When a connection is shared, the credentials are re-encrypted using the recipient's vault key, ensuring that shared credentials remain protected by each user's individual encryption. Share permissions can be set to read-only or full access, controlling whether recipients can modify connection settings.

Batch sharing allows multiple connections to be shared simultaneously, and folder-level sharing applies permissions to all connections within a folder. Secrets from the vault can also be shared internally with team members using the same re-encryption model.

External sharing enables creating time-limited, access-limited links for secrets that can be shared with people outside the platform. These links can optionally be protected with a PIN code. External shares have configurable expiration dates and maximum access counts, and can be revoked at any time.

Teams provide a collaborative workspace within an organization. Teams have their own connection pools, folders, and vault sections. Team members are assigned roles (admin, editor, viewer) that control their level of access. Team vaults use a separate encryption key distributed to members, ensuring team secrets are accessible only to team members. Tenant vault key distribution is asynchronous: when a user's personal vault is locked at the time of distribution (e.g., during tenant vault initialization or when an admin distributes keys), the encrypted tenant key is held in a server-side escrow (AES-256-GCM encrypted with an HMAC-SHA256-derived escrow key) and automatically finalized when the target user next unlocks their personal vault. This ensures that offline or locked-vault users receive tenant vault access without requiring both parties to be online simultaneously.

Folder organization supports nested hierarchies with drag-and-drop reordering for both personal and team connections.

## Multi-Tenant Organizations

Arsenale supports multi-tenant architecture where each organization operates in isolation. Users can belong to multiple organizations and switch between them seamlessly. Each tenant has its own set of users, teams, connections, gateways, and vault secrets.

Tenant roles provide a seven-level hierarchical access control: Owner > Admin > Operator > Member > Consultant > Auditor > Guest. Owners have full control including tenant deletion. Admins can manage users, configure policies, and administer gateways. Operators can manage gateways and view active sessions. Members have standard access to their assigned resources. Consultants have access to assigned connections only. Auditors have read-only access to audit logs and sessions. Guests can view shared connection info without connecting. Non-hierarchical access is supported via role-any checks (e.g., Auditors access audit routes despite being below Member in the hierarchy).

Tenant-level policies allow administrators to enforce mandatory multi-factor authentication for all members, set maximum vault auto-lock durations to prevent users from keeping vaults unlocked indefinitely, configure default session inactivity timeouts, limit concurrent login sessions per user (oldest sessions are evicted when the limit is exceeded), and enforce absolute session timeouts that force re-authentication after a fixed duration regardless of user activity (OWASP A07). User accounts can be enabled or disabled by administrators, and admins can perform identity-verified operations like changing user emails or resetting passwords.

Time-limited memberships allow administrators to set an optional expiration date on tenant and team memberships. Expired memberships are automatically filtered out at token issuance time (defense in depth) and cleaned up by a batch scheduler running every 5 minutes. When a tenant membership expires, the user is removed from all teams in that tenant and their refresh tokens are revoked for immediate lockout. Owner memberships cannot expire. Administrators can set, change, or remove expiration dates from the organization settings UI.

## Security

Arsenale supports multiple MFA methods: TOTP authenticator apps, SMS one-time passwords (via Twilio, AWS SNS, or Vonage), and WebAuthn/FIDO2 passkeys for hardware security key and biometric authentication. Users can register multiple methods simultaneously. A comprehensive identity verification framework supports multiple verification methods (email OTP, TOTP, SMS OTP, WebAuthn, password) and is required for sensitive operations like email changes, password resets, and administrative actions.

Account lockout protection automatically locks accounts after repeated failed login attempts, with configurable thresholds and durations. Rate limiting is applied to login, registration, password reset, SMS, vault, session, and OAuth endpoints to prevent abuse.

Impossible travel detection uses Haversine-based geo-velocity analysis to flag login attempts that would require physically impossible travel speeds between consecutive sessions. Logins within 50 km are skipped. When a suspicious login is detected, administrators are notified via the audit system.

Password breach protection queries the HaveIBeenPwned API using k-Anonymity during registration, password change, and password reset. Only the first 5 characters of the SHA-1 hash are sent to the API, preserving privacy. Passwords found in known data breaches are rejected with a clear error message. If the HIBP API is unreachable, the check fails open to maintain availability. A real-time password strength meter powered by zxcvbn is displayed on all password forms (registration, reset, change), providing a five-level score (Very Weak through Very Strong) with contextual feedback and suggestions. Server-side password validation requires a minimum of 10 characters with lowercase, uppercase, and digit requirements.

Token binding ties JWT access tokens and refresh tokens to the originating client's IP address and User-Agent via a SHA-256 hash embedded in the token payload and stored on refresh token records. If a token is presented from a different IP or User-Agent than the one that issued it, the token is rejected and the session is terminated. For refresh tokens, the entire token family is revoked to prevent further use. A `TOKEN_HIJACK_ATTEMPT` audit event is logged for security monitoring. Token binding is enabled by default and can be disabled globally via the `TOKEN_BINDING_ENABLED` environment variable for environments with dynamic IPs. Access tokens without the binding claim are only accepted when their `iat` is at or before `TOKEN_BINDING_ENFORCEMENT_TIMESTAMP`; when that variable is unset, the cutoff defaults to control-plane startup time so pre-restart legacy access tokens can expire naturally.

Attribute-Based Access Control (ABAC) extends the role-based permission model by evaluating context attributes when a user attempts to start a session. ABAC policies (`AccessPolicy`) are scoped to a `FOLDER`, `TEAM`, or `TENANT` target. Each policy can enforce time-window restrictions (comma-separated `HH:MM-HH:MM` UTC ranges — e.g., `"09:00-18:00"` restricts sessions to business hours), trusted-device requirements (user must have authenticated with WebAuthn during the current login), and MFA step-up requirements (user must have completed any MFA challenge — TOTP, WebAuthn, or SMS — during login). Policies are evaluated at session start for SSH, RDP, and VNC connections; the first matching denial returns HTTP 403 and logs a `SESSION_DENIED_ABAC` audit event with `details.reason` set to `outside_working_hours`, `untrusted_device`, or `mfa_step_up_required`. The MFA method used during login (`totp`, `webauthn`, or `sms`) is embedded in the JWT payload and forwarded to the Go access-policy evaluator in `backend/internal/accesspolicies/service.go`. Segregation of Duties enforcement for privileged access management (PAM) checkout requests — preventing a user from approving their own secret checkout — will be added when PAM-111 is implemented.

Comprehensive audit logging tracks over 100 distinct action types across the platform, including authentication events, connection usage, sharing activities, administrative operations, and session lifecycle events. Audit logs include client IP addresses and optional geographic location enrichment using MaxMind GeoLite2 data. Administrators can view tenant-wide audit logs with geographic visualization on an interactive map.

Session monitoring allows administrators to view all active remote sessions across the organization, with the ability to pause, resume, or terminate sessions remotely. Paused SSH and desktop sessions keep the underlying connection open while transport forwarding is frozen until an administrator resumes the session. Idle session detection automatically marks sessions as idle after configurable inactivity periods.

Session recording can be enabled to capture SSH terminal sessions (in asciicast format) and RDP/VNC sessions (in Guacamole format). Recordings can be played back in-browser, analyzed for command extraction, and exported as video files. Recording retention is configurable with automatic cleanup.

Tenant-level IP allowlists restrict which IP addresses and CIDR ranges are permitted to log in to a tenant. Configured by admins in Settings → Administration → IP Allowlist, the feature supports two enforcement modes: **flag** mode allows the login but appends an `UNTRUSTED_IP` flag to the audit log entry for later review, while **block** mode rejects the login with a 403 response and writes a `LOGIN_FAILURE` audit event with `reason: "ip_not_allowed"`. The allowlist is checked at every token-issuance point across all authentication paths: password login, TOTP, SMS MFA, WebAuthn, OAuth (Google, Microsoft, GitHub, OIDC), and SAML. An empty allowlist with the feature enabled means all IPs are untrusted (flag) or all are blocked — admins should always add their own IP before enabling block mode. Allowlist changes are recorded under the `TENANT_UPDATE` audit action. The Settings UI includes a chip-based CIDR input and a client-side "Test IP" tool. The three schema fields added to the `Tenant` model are `ipAllowlistEnabled` (Boolean, default false), `ipAllowlistMode` (String, default "flag"), and `ipAllowlistEntries` (String array). API endpoints: `GET /api/tenants/:id/ip-allowlist` and `PUT /api/tenants/:id/ip-allowlist` (admin only).

Data Loss Prevention (DLP) policies control clipboard and file operations in RDP, VNC, and SSH sessions. Tenant-level policies set an organization-wide floor that applies to all connections, while per-connection DLP overrides can only be more restrictive (logical OR / most restrictive wins). Four controls are available: disable clipboard copy (remote to local), disable clipboard paste (local to remote), disable file download, and disable file upload. For RDP and VNC, clipboard restrictions are enforced via Guacamole protocol parameters (`disable-copy`, `disable-paste`) with additional client-side gating as defense-in-depth. RDP file transfer restrictions are enforced both via Guacamole parameters (`disable-download`, `disable-upload`) and server-side guards on the staged shared-drive API. For SSH sessions, clipboard restrictions are enforced client-side in the terminal (Ctrl+Shift+C for copy, Ctrl+Shift+V for paste), and file transfer restrictions are enforced server-side in the `/api/files/ssh/*` REST handlers with client-side UI hiding of upload/download controls as defense-in-depth. Both RDP and SSH payload transfers are staged through shared object storage and passed through threat scanning before delivery. When both download and upload are disabled, the file browser UI (drive for RDP, SSH browser for SSH) is hidden entirely. DLP policy changes are tracked in the audit log under the `TENANT_DLP_POLICY_UPDATE` action.

The native browser right-click context menu is globally suppressed across the entire authenticated UI to prevent access to browser functions (Save As, Print, Inspect) that could bypass DLP controls. Existing custom context menus in the sidebar (connections, folders, vault secrets) are unaffected as they already call `preventDefault()` and `stopPropagation()`. SSH terminal sessions provide a custom right-click context menu (`SessionContextMenu`) with DLP-aware Copy and Paste actions, SSH file browser toggle, fullscreen toggle, and session disconnect. Copy and Paste menu items are disabled when the corresponding DLP policy flags are active. RDP and VNC sessions retain their native right-click forwarding to the remote machine; session-specific actions for these protocols (clipboard, special keys, screenshot, disconnect) are available via the docked edge toolbar.

Browser-level exfiltration vectors are blocked as an additional DLP hardening layer in both development and production builds. DevTools shortcuts (F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C), View Source (Ctrl+U), Save Page (Ctrl+S), and Print (Ctrl+P) are all intercepted and suppressed. Ctrl+Shift+C is carved out when an SSH terminal is focused so the terminal's own DLP-aware copy handler processes it instead. Drag-and-drop from the page to external applications is also prevented. Text selection is disabled on UI chrome elements (AppBar, toolbar, tabs, sidebar, drawers) while remaining enabled in form inputs, text areas, and terminal/viewer content.

## Database Access

Arsenale supports database connections through two mechanisms: a web-based SQL client via the Database Protocol Gateway, and agentless SSH-tunneled connections.

The Database Protocol Gateway (`gateways/db-proxy/`) is a Go-based managed container supporting Oracle (TNS), MSSQL (TDS), and IBM DB2 protocols. It runs as a managed gateway container with an API management port and protocol-specific ports for database connections. Users can execute SQL queries, browse database schemas, and view results through a browser-based database client integrated as a new connection tab type. All database queries are audited with full SQL logging.

Agentless database access via SSH port-forwarding (`DB_TUNNEL` connection type) enables direct connections to databases through existing SSH bastion hosts or managed SSH gateways without requiring a dedicated database proxy. The server creates an SSH tunnel with local port forwarding, proxies database queries through the tunnel, and returns results to the client.

Database query auditing records every SQL statement executed through both proxy and tunnel connections. A SQL firewall enables administrators to define rules that block or allow specific SQL patterns, preventing data exfiltration or destructive operations. Data masking policies allow administrators to define regex-based patterns for masking sensitive columns (e.g., credit card numbers, SSNs) in query results.

## SSH Keystroke Inspection

Real-time SSH keystroke inspection monitors terminal input against configurable regex-based policies per tenant. Each policy defines a set of regex patterns and an action: `BLOCK_AND_TERMINATE` (prevents the command from reaching the remote host and immediately terminates the session) or `ALERT_ONLY` (logs the violation and notifies administrators but allows execution). The inspection service maintains a per-session keystroke buffer that reconstructs the logical input line from raw terminal data, handling control characters like backspace, Ctrl-U (kill line), and Ctrl-C. When a newline is detected, the accumulated command is inspected against compiled policies before being forwarded to the SSH stream. Policies are cached per-tenant with a 30-second TTL and include ReDoS safety checks to reject patterns with nested quantifiers. Policy violations are recorded in the audit log and trigger real-time notifications to tenant administrators with retry-based delivery.

## Credential Checkout (PAM)

Temporary credential check-out/check-in implements a privileged access management (PAM) workflow for shared credentials. Users request temporary access to secrets or connections they don't own, specifying a duration (1-1440 minutes) and an optional reason. Resource owners and tenant/team administrators receive notifications and can approve or reject requests. Approved checkouts create time-limited access that automatically expires. Early check-in allows returning credentials before the expiry window. The system uses atomic database operations to prevent TOCTOU race conditions in approval/rejection workflows. A background scheduler runs every 5 minutes to process expired checkouts. All checkout lifecycle events are audited and generate real-time notifications.

## Password Rotation

Automatic password rotation enables credential rotation on target systems connected through Arsenale. When enabled on a vault secret, the system can rotate passwords automatically on a configurable schedule or be triggered manually. Rotation history is tracked with full audit logging.

## Lateral Movement Detection

Arsenale implements MITRE T1021 (Remote Services) anomaly detection to identify suspicious patterns of concurrent connections to multiple targets. When a user connects to more distinct targets than the configured threshold within a sliding time window, the system temporarily suspends the account and alerts tenant administrators via real-time notifications and audit logging.

## Pwned Password Check

Vault secrets of type LOGIN are checked against the HaveIBeenPwned breach database using k-Anonymity (only the first 5 SHA-1 hash characters are sent). The breach count is stored on the secret record and surfaced in the UI. Users are warned when stored credentials appear in known data breaches.

## Native Client Access

### SSH Proxy

The SSH Protocol Proxy enables native SSH clients (PuTTY, OpenSSH, etc.) to connect through Arsenale. Users obtain a short-lived proxy token via the REST API, which the SSH proxy server validates to inject vault credentials and route the connection through the appropriate gateway. All sessions are audited identically to browser-based SSH sessions.

### RD Gateway (MS-TSGU)

The RD Gateway (`gateways/rdgw/`) implements the Microsoft Terminal Services Gateway (MS-TSGU) protocol, enabling native Windows RDP clients (mstsc.exe) to connect through Arsenale. The gateway handles TSGU protocol negotiation, retrieves credentials from the vault, and forwards the RDP connection to the target server. Administrators configure the gateway per-tenant with server addresses and ports. Users can download pre-configured .rdp files from the web UI.

### Arsenale Connect CLI

The Arsenale Connect CLI (`tools/arsenale-cli/`) is a Go-based command-line tool for native client orchestration. It authenticates using RFC 8628 Device Authorization: the CLI displays a verification URL and user code, the user authorizes in the web browser, and the CLI polls for a token. Once authenticated, the CLI can list connections, retrieve vault credentials, generate SSH proxy tokens, download .rdp files, and launch native SSH/RDP clients with credential injection.

## Connection Policy Enforcement

Organization administrators can define enforced connection settings that override user and per-connection configurations for SSH, RDP, and VNC protocols. These policies are stored as a JSON field on the Tenant model and applied as the highest-priority layer in the settings merge chain (system defaults, user defaults, connection overrides, then tenant-enforced). On the client side, enforced fields are shown with a lock icon and cannot be modified by users. The policy is configured in the Organization tab of Settings and audited via the TENANT_CONNECTION_POLICY_UPDATE audit action.

## Infrastructure Management

SSH gateways can be managed entirely by Arsenale through container orchestration. The platform supports Docker, Podman, and Kubernetes as orchestration backends, automatically detecting the available runtime. Managed gateways can be deployed, scaled, and monitored from the web interface.

Auto-scaling automatically adjusts the number of gateway container instances based on active session counts, with configurable minimum and maximum replicas, sessions-per-instance thresholds, and scale-down cooldown periods. Load balancing distributes sessions across instances using a configurable strategy: round-robin or least-connections, selectable per gateway.

SSH key pairs are managed at the tenant level with optional automatic rotation on configurable schedules (default 90 days). Auto-rotation can be enabled per key pair. Keys can be pushed to gateway instances via an API sidecar, and private keys can be downloaded for manual configuration.

Gateway health monitoring continuously checks gateway availability with configurable intervals, reporting latency and status in real time through WebSocket updates.

Gateway templates provide reusable configurations for quick deployment of new gateways with pre-configured auto-scaling, monitoring, and load balancing settings.

## Zero-Trust Tunnel (TunnelBroker)

The TunnelBroker enables zero-trust environments where gateway agents cannot expose inbound ports (similar to Cloudflare Tunnel, but self-hosted). Gateway agents establish outbound-only WSS connections to the Arsenale server at `/api/tunnel/connect`, and the server proxies TCP streams back through those connections.

The tunnel system uses a binary multiplexing protocol with 4-byte frames (type, flags, streamId uint16) and message types OPEN/DATA/CLOSE/PING/PONG. The `openStream(gatewayId, host, port)` API returns a `net.Duplex`-compatible stream for transparent integration with SSH2 and guacamole-lite.

Each gateway has an `egressPolicy` JSON document with protocol, host/CIDR, and port allow rules. Empty policies deny all tunneled egress. SSH, RDP, VNC, and database session creation enforces the policy before opening tunnel streams, and managed DB proxy runtimes receive `ARSENALE_EGRESS_POLICY_JSON` for runtime enforcement. Denials write `TUNNEL_EGRESS_DENIED` audit events.

Authentication uses a 256-bit token (stored encrypted with AES-256-GCM + SHA-256 hash for constant-time comparison) presented via the `Authorization: Bearer` header. Each gateway has a unique token bound to its ID. Token generation/revocation is available via `POST /gateways/:id/tunnel-token` and `DELETE /gateways/:id/tunnel-token` (OPERATOR role required).

The Gateway model includes tunnel fields: `tunnelEnabled`, encrypted token (ciphertext/IV/tag), `tunnelTokenHash` (unique), connection timestamps, client IP/version, optional mTLS certificate material (`tunnelCaCert`, `tunnelCaKey`, `tunnelClientCert`, `tunnelClientCertExp`), and `egressPolicy`. `ManagedGatewayInstance` includes `tunnelProxyHost`/`tunnelProxyPort` for GUACD tunnel proxying.

The Tenant model includes tunnel configuration fields: `tunnelDefaultEnabled` (new gateways default to tunnel mode), `tunnelAutoTokenRotation` + `tunnelTokenRotationDays` (scheduled token rotation), `tunnelRequireForRemote` (force tunnel for non-LAN connections), `tunnelTokenMaxLifetimeDays` (max token lifetime), and `tunnelAgentAllowedCidrs` (CIDR allowlist for agent source IPs).

Audit actions `TUNNEL_CONNECT`, `TUNNEL_DISCONNECT`, `TUNNEL_TOKEN_GENERATE`, `TUNNEL_TOKEN_ROTATE`, and `TUNNEL_EGRESS_DENIED` are recorded for tunnel lifecycle and egress events.

The `GatewayData` API type exposes `operationalStatus`, `operationalReason`, `healthyInstances`, `tunnelEnabled`, `tunnelConnected` (live broker check when available), `tunnelConnectedAt`, and `tunnelClientCertExp`. The client `gateway.api.ts` provides `generateTunnelToken`, `revokeTunnelToken`, `forceDisconnectTunnel`, `getTunnelEvents`, and `getTunnelMetrics` functions. The `gatewayStore` holds a `tunnelStatuses` map updated via `applyTunnelStatusUpdate` and `tunnel:metrics` Socket.IO events.

### Tunnel UI

`GatewayDialog.tsx` (edit mode only) includes a "Zero-Trust Tunnel" MUI Accordion section persisted via `tunnelSectionOpen` in `uiPreferencesStore`. When tunnel is disabled the admin sees an "Enable Zero-Trust Tunnel" button. Once enabled: managed gateways show a one-time plain token (copy before closing); non-managed gateways show a pre-built `docker run` command with a base64-encoded connection string (`{ serverUrl, tunnelToken, gatewayId }`). Token rotation, revocation, and force disconnect are inline with inline confirmation. Certificate expiry is shown with days-until-renewal. Host/port fields become read-only when tunnel is active.

Additional tunnel UI panels (all collapsible, persisted via `uiPreferencesStore`): **Live Metrics** (`tunnelMetricsOpen`) shows uptime, RTT, active streams, and agent version as MUI Chips when tunnel is connected, fetched from `GET /gateways/:id/tunnel-metrics`. **Connection Event Log** (`tunnelEventLogOpen`) shows the last 20 TUNNEL_CONNECT/TUNNEL_DISCONNECT audit events with timestamps, IP addresses, and forced-disconnect indicators, fetched from `GET /gateways/:id/tunnel-events`. **Deployment Guides** (`tunnelDeployGuidesOpen`) appears when a token has been generated for non-managed gateways, providing Docker Compose and systemd unit file snippets with copy buttons alongside the existing Docker Run command. **Force Disconnect** (`POST /gateways/:id/tunnel-disconnect`) forcefully closes the tunnel WebSocket for a connected gateway (OPERATOR role).

`GatewaySection.tsx` shows a `VpnLock` icon badge (green = connected, red = disconnected) next to the health chip for any `tunnelEnabled` gateway. The Tooltip contains connected-since, RTT, active streams, and agent version from live `tunnelStatuses`.

## Tunnel Agent (`gateways/tunnel-agent/`)

The `tunnel-agent` is a lightweight Go module (`gateways/tunnel-agent/`) that is embedded into every managed gateway container image (ssh-gateway, db-proxy, and custom guacd). It is dormant by default — if `TUNNEL_SERVER_URL`, `TUNNEL_TOKEN`, and `TUNNEL_GATEWAY_ID` are absent, the process exits cleanly and the gateway starts normally.

When tunnel env vars are present, the agent auto-activates and establishes an outbound WSS connection to the TunnelBroker using the same binary multiplexing protocol (OPEN/DATA/CLOSE/PING/PONG, 4-byte header). On receiving an OPEN frame with a `host:port` payload, it opens a local TCP connection and bridges data bidirectionally through DATA frames. The agent sends 15-second PING heartbeats with JSON health metadata (`{ healthy, latencyMs, activeStreams }`) obtained by probing the local service.

Auto-reconnect uses exponential backoff (1 s → 2 s → … → 60 s). Optional mTLS is supported via `TUNNEL_CA_CERT`, `TUNNEL_CLIENT_CERT`, and `TUNNEL_CLIENT_KEY` env vars.

A standalone `gateways/tunnel-agent/Dockerfile` is provided for deploying the agent alongside non-managed (external) gateways. For managed gateways, the `gateways/ssh-gateway/Dockerfile` and `gateways/guacd/Dockerfile` both embed the agent via a multi-stage build (monorepo root context required) and launch it from their entrypoints as a background process.

When `tunnelEnabled=true` on a managed gateway, the Go managed gateway service automatically injects `TUNNEL_SERVER_URL`, `TUNNEL_TOKEN`, `TUNNEL_GATEWAY_ID`, `TUNNEL_LOCAL_PORT`, and `ARSENALE_EGRESS_POLICY_JSON` into the container environment, and suppresses host-port publishing (`publishPorts=false` behavior) so traffic flows exclusively through the tunnel.

## Browser Extension (`extra-clients/browser-extensions/`)

The Arsenale browser extension is a Chrome Manifest V3 extension (with Firefox compatibility via webextension-polyfill) that provides multi-account management for connecting to multiple Arsenale server instances. The extension includes a service worker that handles all API calls to Arsenale servers and propagates autofill state to content scripts, a React popup with account switching, MFA-capable sign-in, tenant selection, vault status, a working Keychain view, and a working Connections view, plus a React options page for account management and autofill preferences. Multi-account storage uses `chrome.storage.local`, with each account entry storing server URL, user identity, encrypted tokens, tenant context, and vault status. Token refresh is handled automatically via `chrome.alarms`, and clipboard auto-clear is delegated through an offscreen document because MV3 service workers do not have direct clipboard access. The build uses Vite with a multi-entry configuration producing a ready-to-load unpacked extension in the `dist/` directory.

## External Sync

Sync profiles allow organizations to automatically import and synchronize connections from external data sources such as NetBox. Profiles are configured with a provider type, credentials, and mapping rules, then can be run on-demand or on a scheduled basis. Each sync run produces a log with created, updated, and deleted connection counts.

## Admin CLI

Arsenale includes a server-side CLI (`arsenale`) for administrative operations that can be run from the host or inside the container. The CLI provides commands for user management, tenant administration, and other platform operations without requiring web UI access.

## User Experience

The interface uses Material Design with support for both dark and light themes. The tabbed workspace preserves active sessions when navigating between connections or opening settings and management dialogs. All UI layout preferences (panel states, sidebar sections, filter selections, view modes) are automatically persisted and restored across browser sessions.

SSH terminals and RDP settings can be customized globally as user defaults and overridden per connection. Connections can be opened in standalone popup windows for multi-monitor setups.

Real-time notifications alert users to sharing events, secret expiry warnings, and other platform activities. A notification bell in the toolbar shows unread counts and allows quick access to recent notifications.

OAuth single sign-on supports Google, Microsoft, GitHub, any OIDC-compliant identity provider (Authentik, Keycloak, Authelia, Zitadel), and SAML 2.0 identity providers (Azure AD/Entra ID, Okta, OneLogin, ADFS). Multiple identity providers can be linked to a single account.

LDAP authentication allows organizations to authenticate users against an existing LDAP/Active Directory server. LDAP integration supports STARTTLS, TLS certificate validation, group-based access control, automatic user provisioning on first login, and periodic background synchronization to keep user attributes and group memberships current.

A startup configuration wizard runs automatically on first install when the database has zero users and the `setupCompleted` AppConfig flag is not set. The wizard guides non-technical users through creating the initial admin account (with vault encryption setup and recovery key generation), naming the organization (tenant), and configuring optional settings like self-registration and SMTP email. All resources are created atomically, and the admin is automatically logged in with the vault unlocked after completion. The wizard is accessible at `/setup` without authentication and is protected by a zero-users precondition that prevents abuse after initial setup. Self-registration is disabled by default, making the wizard the primary onboarding path for new installations.

Platform administrators can control self-registration (sign-up) via a toggle in the admin panel, which can also be locked at the environment level.

Email verification supports multiple providers including SMTP, SendGrid, Amazon SES, Resend, and Mailgun, with automatic console logging in development environments. Administrators can view provider status and send test emails from the settings panel.

Connection import and export supports CSV, JSON, mRemoteNG configuration files, and RDP files for easy migration from other tools.

## Deployment

Arsenale now deploys as a Go-first container stack driven by Ansible and Compose. The default stack includes PostgreSQL, Redis, guacd, guacenc, the Nginx-based web client, `control-plane-api-go`, and the Go runtime brokers for desktop, terminal, tunnel, query, and orchestration traffic. Database changes are applied through versioned SQL migrations in `backend/migrations/`, and sqlc is used for generated query packages in the converted Go domains.

Both Docker and Podman are supported as container runtimes, with rootless Podman configurations working out of the box. All application containers run as non-root users. Volume persistence is configured for database data, drive files, and session recordings.

Configuration is handled through a single environment file with sensible defaults for development. Production deployment requires setting cryptographic secrets and connection parameters, all documented with generation commands.

## Distributed State (Redis Coordination)

Arsenale uses Redis for distributed coordination across the Go control plane and brokers. Redis holds short-lived auth and MFA state, rate limit counters, vault status events, and other ephemeral coordination data that must survive beyond a single process.

### Architecture

Redis runs as a shared service alongside the Go API and brokers. The runtime opens a standard Redis connection from `REDIS_URL` and uses TTL keys and pub/sub where cross-instance coordination matters.

### Distributed Subsystems

| Subsystem | Cache Primitive | Fallback |
|-----------|----------------|----------|
| Cross-instance coordination events | Pub/sub | Process-local state only |
| Auth codes (OAuth/SAML callbacks) | KV with TTL + atomic GetDel | Process-local state only |
| Link codes (account linking) | KV with TTL + atomic GetDel | Local `Map<string, LinkCodeEntry>` |
| Relay state (SAML/OAuth state) | KV with TTL + atomic GetDel | Local `Map<string, LinkCodeEntry>` |
| Vault session index | KV (JSON arrays for prefix-based cleanup) | Local Map cleanup only |
| Rate limit counters | KV with TTL | Per-process counters only |

### Cache Key Patterns

| Pattern | Purpose | TTL |
|---------|---------|-----|
| `auth:code:<hex>` | OAuth/SAML one-time auth code | 60s |
| `link:code:<hex>` | Account-linking one-time code | 60s |
| `relay:code:<hex>` | SAML/OAuth relay state | 5m |
| `vault:status` | Vault status fanout channel | None (pub/sub) |
| `rl:*` | Rate-limit buckets | Varies by limiter |

### Leader Election

In multi-instance deployments, the shared Redis coordination layer lets the API and brokers enforce consistent rate limits, challenge validation, and short-lived state. Long-running background work remains in the Go control/controller services rather than the legacy Node scheduler path.

### Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `REDIS_URL` | `redis://localhost:6379/0` | Shared Redis coordination endpoint |

## Technology

Arsenale is built on a Go-first service stack backed by PostgreSQL and Redis, with a React client using Zustand plus a hybrid Material UI and shadcn/ui plus Tailwind CSS layer. The active JavaScript workspaces are `client/` and `extra-clients/browser-extensions/`; the old `server/` implementation is no longer present. Remote desktop rendering uses guacd and guacamole-common-js, SSH terminals use XTerm.js with the Go terminal broker, and the zero-trust tunnel system uses raw WebSockets with a custom binary multiplexing protocol for proxying TCP streams through outbound-only gateway agent connections. ABAC enforcement now lives in the Go access-policy services and is evaluated on the active Go session path.
