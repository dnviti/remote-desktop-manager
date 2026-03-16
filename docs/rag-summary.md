# Arsenale

> Auto-generated on 2026-03-15. High-level product overview for LLM RAG consumption.

## What is Arsenale

Arsenale is a modern, web-based remote access management platform designed to replace legacy tools like mRemoteNG, RoyalTS, and standalone Apache Guacamole deployments. It provides a unified interface for managing SSH, RDP, and VNC connections through a browser, eliminating the need for desktop clients or complex jump host configurations. Unlike traditional tools that store credentials locally or rely on unencrypted configuration files, Arsenale encrypts all credentials at rest using a zero-knowledge vault architecture where the server never has access to plaintext passwords.

Arsenale combines the remote access capabilities of Guacamole with enterprise-grade features like multi-tenant organizations, team collaboration, encrypted credential vaults, granular audit logging, and managed container infrastructure. It is designed for teams that need centralized, secure remote access without sacrificing usability.

## Who is it For

Arsenale serves IT operations teams managing fleets of servers and workstations, managed service providers (MSPs) who need tenant isolation between clients, DevOps engineers who require SSH access through bastion hosts, and security-conscious organizations that demand encrypted credential storage with audit trails. It is particularly suited for multi-tenant environments where different teams or clients must be isolated from each other while sharing the same platform infrastructure.

## Remote Access

Arsenale supports three remote access protocols through a tabbed browser interface that lets users work with multiple connections simultaneously.

SSH terminals are rendered using a full-featured terminal emulator that supports customizable themes, font families, font sizes, and cursor styles. Each connection can have its own terminal configuration, and users can set global defaults. An integrated SFTP file browser allows navigating remote file systems, uploading and downloading files, creating directories, and renaming or deleting files — all within the same SSH session without opening a separate tool.

RDP remote desktop sessions are rendered through the Guacamole protocol, providing a native-quality desktop experience in the browser. Users can configure color depth, display resolution, resize behavior, audio settings, font smoothing, wallpaper, and desktop composition on a per-connection basis. Clipboard synchronization allows copying and pasting between the local machine and the remote desktop. Drive redirection enables file sharing between the local browser and the remote session through a virtual drive, with a built-in file browser for managing transferred files.

VNC connections follow the same pattern as RDP, rendered through the Guacamole protocol with configurable color depth, cursor mode, clipboard encoding, and view-only settings.

All viewer types include a docked edge toolbar — a slim vertical handle anchored to the left or right edge of the connection viewport that expands on click to reveal action buttons. The toolbar can be dragged vertically along the edge, and dragging past the container center switches it to the opposite side. Position and side are persisted across sessions. For RDP and VNC sessions, the toolbar provides clipboard copy and paste (with DLP gating), Ctrl+Alt+Del, a Send Keys submenu (Alt+Tab, Alt+F4, Windows key, PrintScreen), screenshot capture, fullscreen toggle, shared drive toggle (RDP only), and session disconnect. For SSH sessions, the toolbar provides SFTP file browser and fullscreen toggle. All viewer types support fullscreen mode. In fullscreen mode on Chromium-based browsers, the Keyboard Lock API attempts to capture additional system-level shortcuts (such as Alt+Tab or Ctrl+W) and forward them to the remote session; however, some OS-reserved sequences (such as Ctrl+Alt+Del on Windows or Ctrl+Alt+Backspace on Linux) cannot be intercepted by any browser and will still be handled by the operating system. Keyboard input in RDP and VNC sessions is captured at the browser level to prevent browser shortcuts from interfering with the remote desktop. Focus management automatically engages keyboard capture when the mouse enters the viewer area and releases it when the mouse leaves.

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

Teams provide a collaborative workspace within an organization. Teams have their own connection pools, folders, and vault sections. Team members are assigned roles (admin, editor, viewer) that control their level of access. Team vaults use a separate encryption key distributed to members, ensuring team secrets are accessible only to team members.

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

Token binding ties JWT access tokens and refresh tokens to the originating client's IP address and User-Agent via a SHA-256 hash embedded in the token payload and stored on refresh token records. If a token is presented from a different IP or User-Agent than the one that issued it, the token is rejected and the session is terminated. For refresh tokens, the entire token family is revoked to prevent further use. A `TOKEN_HIJACK_ATTEMPT` audit event is logged for security monitoring. Token binding is enabled by default and can be disabled globally via the `TOKEN_BINDING_ENABLED` environment variable for environments with dynamic IPs. Tokens issued before token binding was enabled are accepted without verification for backward compatibility.

Attribute-Based Access Control (ABAC) extends the role-based permission model by evaluating context attributes when a user attempts to start a session. ABAC policies (`AccessPolicy` Prisma model) are scoped to a `FOLDER`, `TEAM`, or `TENANT` target. Each policy can enforce: time-window restrictions (comma-separated `HH:MM-HH:MM` UTC ranges — e.g., `"09:00-18:00"` restricts sessions to business hours), trusted-device requirements (user must have authenticated with WebAuthn during the current login), and MFA step-up requirements (user must have completed any MFA challenge — TOTP, WebAuthn, or SMS — during login). Policies are evaluated at session start for SSH, RDP, and VNC connections; the first matching denial returns HTTP 403 and logs a `SESSION_DENIED_ABAC` audit event with `details.reason` set to `outside_working_hours`, `untrusted_device`, or `mfa_step_up_required`. The MFA method used during login (`totp`, `webauthn`, or `sms`) is now embedded in the JWT payload as `mfaMethod` and is forwarded to the ABAC evaluator. The ABAC service lives at `server/src/services/abac.service.ts`. Segregation of Duties enforcement for privileged access management (PAM) checkout requests — preventing a user from approving their own secret checkout — will be added when PAM-111 is implemented.

Comprehensive audit logging tracks over 100 distinct action types across the platform, including authentication events, connection usage, sharing activities, administrative operations, and session lifecycle events. Audit logs include client IP addresses and optional geographic location enrichment using MaxMind GeoLite2 data. Administrators can view tenant-wide audit logs with geographic visualization on an interactive map.

Session monitoring allows administrators to view all active remote sessions across the organization, with the ability to terminate sessions remotely. Idle session detection automatically marks sessions as idle after configurable inactivity periods.

Session recording can be enabled to capture SSH terminal sessions (in asciicast format) and RDP/VNC sessions (in Guacamole format). Recordings can be played back in-browser, analyzed for command extraction, and exported as MP4 video files. All protocols (SSH, RDP, VNC) support video export: RDP/VNC recordings are converted via guacenc (.guac to .m4v), while SSH recordings are converted via agg + ffmpeg (.cast to .mp4). Both conversion pipelines run in the same guacenc sidecar service using an async job pattern with polling and caching. Recording retention is configurable with automatic cleanup.

Tenant-level IP allowlists restrict which IP addresses and CIDR ranges are permitted to log in to a tenant. Configured by admins in Settings → Administration → IP Allowlist, the feature supports two enforcement modes: **flag** mode allows the login but appends an `UNTRUSTED_IP` flag to the audit log entry for later review, while **block** mode rejects the login with a 403 response and writes a `LOGIN_FAILURE` audit event with `reason: "ip_not_allowed"`. The allowlist is checked at every token-issuance point across all authentication paths: password login, TOTP, SMS MFA, WebAuthn, OAuth (Google, Microsoft, GitHub, OIDC), and SAML. An empty allowlist with the feature enabled means all IPs are untrusted (flag) or all are blocked — admins should always add their own IP before enabling block mode. Allowlist changes are recorded under the `TENANT_UPDATE` audit action. The Settings UI includes a chip-based CIDR input and a client-side "Test IP" tool. The three schema fields added to the `Tenant` model are `ipAllowlistEnabled` (Boolean, default false), `ipAllowlistMode` (String, default "flag"), and `ipAllowlistEntries` (String array). API endpoints: `GET /api/tenants/:id/ip-allowlist` and `PUT /api/tenants/:id/ip-allowlist` (admin only).

Data Loss Prevention (DLP) policies control clipboard and file operations in RDP, VNC, and SSH sessions. Tenant-level policies set an organization-wide floor that applies to all connections, while per-connection DLP overrides can only be more restrictive (logical OR / most restrictive wins). Four controls are available: disable clipboard copy (remote to local), disable clipboard paste (local to remote), disable file download, and disable file upload. For RDP and VNC, clipboard restrictions are enforced via Guacamole protocol parameters (`disable-copy`, `disable-paste`) with additional client-side gating as defense-in-depth. RDP file transfer restrictions are enforced both via Guacamole parameters (`disable-download`, `disable-upload`) and server-side guards on the file upload/download API. For SSH sessions, clipboard restrictions are enforced client-side in the terminal (Ctrl+Shift+C for copy, Ctrl+Shift+V for paste), and SFTP file transfer restrictions are enforced server-side in the Socket.IO handler (authoritative) with client-side UI hiding of upload/download controls as defense-in-depth. When both download and upload are disabled, the file browser UI (drive for RDP, SFTP for SSH) is hidden entirely. DLP policy changes are tracked in the audit log under the `TENANT_DLP_POLICY_UPDATE` action.

The native browser right-click context menu is globally suppressed across the entire authenticated UI to prevent access to browser functions (Save As, Print, Inspect) that could bypass DLP controls. Existing custom context menus in the sidebar (connections, folders, vault secrets) are unaffected as they already call `preventDefault()` and `stopPropagation()`. SSH terminal sessions provide a custom right-click context menu (`SessionContextMenu`) with DLP-aware Copy and Paste actions, SFTP file browser toggle, fullscreen toggle, and session disconnect. Copy and Paste menu items are disabled when the corresponding DLP policy flags are active. RDP and VNC sessions retain their native right-click forwarding to the remote machine; session-specific actions for these protocols (clipboard, special keys, screenshot, disconnect) are available via the docked edge toolbar.

Browser-level exfiltration vectors are blocked as an additional DLP hardening layer in both development and production builds. DevTools shortcuts (F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C), View Source (Ctrl+U), Save Page (Ctrl+S), and Print (Ctrl+P) are all intercepted and suppressed. Ctrl+Shift+C is carved out when an SSH terminal is focused so the terminal's own DLP-aware copy handler processes it instead. Drag-and-drop from the page to external applications is also prevented. Text selection is disabled on UI chrome elements (AppBar, toolbar, tabs, sidebar, drawers) while remaining enabled in form inputs, text areas, and terminal/viewer content.

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

Authentication uses a 256-bit token (stored encrypted with AES-256-GCM + SHA-256 hash for constant-time comparison) presented via the `Authorization: Bearer` header. Each gateway has a unique token bound to its ID. Token generation/revocation is available via `POST /gateways/:id/tunnel-token` and `DELETE /gateways/:id/tunnel-token` (OPERATOR role required).

The Gateway model includes tunnel fields: `tunnelEnabled`, encrypted token (ciphertext/IV/tag), `tunnelTokenHash` (unique), connection timestamps, client IP/version, and optional mTLS certificate material (`tunnelCaCert`, `tunnelCaKey`, `tunnelClientCert`, `tunnelClientCertExp`). `ManagedGatewayInstance` includes `tunnelProxyHost`/`tunnelProxyPort` for GUACD tunnel proxying.

The Tenant model includes tunnel configuration fields: `tunnelDefaultEnabled` (new gateways default to tunnel mode), `tunnelAutoTokenRotation` + `tunnelTokenRotationDays` (scheduled token rotation), `tunnelRequireForRemote` (force tunnel for non-LAN connections), `tunnelTokenMaxLifetimeDays` (max token lifetime), and `tunnelAgentAllowedCidrs` (CIDR allowlist for agent source IPs).

Audit actions `TUNNEL_CONNECT`, `TUNNEL_DISCONNECT`, `TUNNEL_TOKEN_GENERATE`, and `TUNNEL_TOKEN_ROTATE` are recorded for all tunnel lifecycle events.

The `GatewayData` API type exposes `tunnelEnabled`, `tunnelConnected` (live registry check), `tunnelConnectedAt`, and `tunnelClientCertExp`. The client `gateway.api.ts` provides `generateTunnelToken`, `revokeTunnelToken`, `forceDisconnectTunnel`, `getTunnelEvents`, and `getTunnelMetrics` functions. The `gatewayStore` holds a `tunnelStatuses` map updated via `applyTunnelStatusUpdate` and `tunnel:metrics` Socket.IO events.

### Tunnel UI

`GatewayDialog.tsx` (edit mode only) includes a "Zero-Trust Tunnel" MUI Accordion section persisted via `tunnelSectionOpen` in `uiPreferencesStore`. When tunnel is disabled the admin sees an "Enable Zero-Trust Tunnel" button. Once enabled: managed gateways show a one-time plain token (copy before closing); non-managed gateways show a pre-built `docker run` command with a base64-encoded connection string (`{ serverUrl, tunnelToken, gatewayId }`). Token rotation, revocation, and force disconnect are inline with inline confirmation. Certificate expiry is shown with days-until-renewal. Host/port fields become read-only when tunnel is active.

Additional tunnel UI panels (all collapsible, persisted via `uiPreferencesStore`): **Live Metrics** (`tunnelMetricsOpen`) shows uptime, RTT, active streams, and agent version as MUI Chips when tunnel is connected, fetched from `GET /gateways/:id/tunnel-metrics`. **Connection Event Log** (`tunnelEventLogOpen`) shows the last 20 TUNNEL_CONNECT/TUNNEL_DISCONNECT audit events with timestamps, IP addresses, and forced-disconnect indicators, fetched from `GET /gateways/:id/tunnel-events`. **Deployment Guides** (`tunnelDeployGuidesOpen`) appears when a token has been generated for non-managed gateways, providing Docker Compose and systemd unit file snippets with copy buttons alongside the existing Docker Run command. **Force Disconnect** (`POST /gateways/:id/tunnel-disconnect`) forcefully closes the tunnel WebSocket for a connected gateway (OPERATOR role).

`GatewaySection.tsx` shows a `VpnLock` icon badge (green = connected, red = disconnected) next to the health chip for any `tunnelEnabled` gateway. The Tooltip contains connected-since, RTT, active streams, and agent version from live `tunnelStatuses`.

## Tunnel Agent (`tunnel-agent/`)

The `tunnel-agent` is a lightweight Node.js workspace (`tunnel-agent/`) that is embedded into every managed gateway container image (ssh-gateway and custom guacd). It is dormant by default — if `TUNNEL_SERVER_URL`, `TUNNEL_TOKEN`, and `TUNNEL_GATEWAY_ID` are absent, the process exits cleanly and the gateway starts normally.

When tunnel env vars are present, the agent auto-activates and establishes an outbound WSS connection to the TunnelBroker using the same binary multiplexing protocol (OPEN/DATA/CLOSE/PING/PONG, 4-byte header). On receiving an OPEN frame with a `host:port` payload, it opens a local TCP connection and bridges data bidirectionally through DATA frames. The agent sends 15-second PING heartbeats with JSON health metadata (`{ healthy, latencyMs, activeStreams }`) obtained by probing the local service.

Auto-reconnect uses exponential backoff (1 s → 2 s → … → 60 s). Optional mTLS is supported via `TUNNEL_CA_CERT`, `TUNNEL_CLIENT_CERT`, and `TUNNEL_CLIENT_KEY` env vars.

A standalone `tunnel-agent/Dockerfile` is provided for deploying the agent alongside non-managed (external) gateways. For managed gateways, the `ssh-gateway/Dockerfile` and `docker/guacd/Dockerfile` both embed the agent via a multi-stage build (monorepo root context required) and launch it from their entrypoints as a background process.

When `tunnelEnabled=true` on a managed gateway, `managedGateway.service.ts` automatically injects `TUNNEL_SERVER_URL`, `TUNNEL_TOKEN`, `TUNNEL_GATEWAY_ID`, and `TUNNEL_LOCAL_PORT` into the container environment, and suppresses host-port publishing (`publishPorts=false` behavior) so traffic flows exclusively through the tunnel.

## Browser Extension (`clients/browser-extensions/`)

The Arsenale browser extension is a Chrome Manifest V3 extension (with Firefox compatibility via webextension-polyfill) that provides multi-account management for connecting to multiple Arsenale server instances. The extension includes a service worker that handles all API calls to Arsenale servers (bypassing CORS), a React popup with account switcher, vault status indicator, and tabbed sections for Keychain and Connections (placeholder for future implementation), and a React options/settings page for managing server accounts. Multi-account storage uses chrome.storage.local, with each account entry storing server URL, user identity, tokens, and vault status. Token refresh is handled automatically via chrome.alarms. The build uses Vite with a multi-entry configuration producing a ready-to-load unpacked extension in the dist/ directory.

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

Platform administrators can control self-registration (sign-up) via a toggle in the admin panel, which can also be locked at the environment level.

Email verification supports multiple providers including SMTP, SendGrid, Amazon SES, Resend, and Mailgun, with automatic console logging in development environments. Administrators can view provider status and send test emails from the settings panel.

Connection import and export supports CSV, JSON, mRemoteNG configuration files, and RDP files for easy migration from other tools.

Arsenale is a Progressive Web App (PWA) that can be installed on desktop and mobile devices for a native app-like experience. The PWA uses a service worker with an online-first caching strategy: navigation requests use NetworkFirst with a 3-second timeout fallback, static assets (JS, CSS, images, fonts) use StaleWhileRevalidate, and Google Fonts are cached for offline resilience. API calls (`/api/*`), WebSocket connections (`/socket.io/*`), and Guacamole tunnels (`/guacamole/*`) are never cached by the service worker. The web app manifest configures standalone display mode with the dark theme background color, and includes both standard and maskable icons in 192px and 512px sizes. When a new version is deployed, the service worker detects the update and a non-intrusive Snackbar notification prompts the user to reload for the latest version. This is critical for a security-sensitive application to avoid running stale cached code. The update uses a prompt-based flow: the new service worker waits until the user explicitly clicks "Reload", which triggers skipWaiting and clients.claim for a seamless transition. The service worker also checks for updates every 60 minutes in the background.

## Deployment

Arsenale deploys with a single Docker Compose command that starts all required services: PostgreSQL database, Guacamole daemon, the server API, and the Nginx-based web client. Database migrations run automatically on startup. The entire stack runs on an internal Docker network with only the web port exposed to the host.

Both Docker and Podman are supported as container runtimes, with rootless Podman configurations working out of the box. All application containers run as non-root users. Volume persistence is configured for database data, drive files, and session recordings.

Configuration is handled through a single environment file with sensible defaults for development. Production deployment requires setting cryptographic secrets and connection parameters, all documented with generation commands.

## Technology

Arsenale is built on a modern open-source stack: a Node.js and TypeScript server with a layered Express architecture backed by PostgreSQL through Prisma ORM, and a React client with Zustand state management and Material UI components. The monorepo includes four workspaces: `server/`, `client/`, `tunnel-agent/`, and `clients/browser-extensions/`. Remote desktop rendering uses the Guacamole protocol via guacamole-lite and guacamole-common-js. SSH terminals use XTerm.js with the ssh2 library. Real-time communication uses Socket.IO for terminal I/O, notifications, and monitoring updates. The zero-trust tunnel system uses raw `ws` WebSocket connections with a custom binary multiplexing protocol for proxying TCP streams through outbound-only gateway agent connections. The ABAC policy engine evaluates `AccessPolicy` Prisma records at session start time to enforce time-window, trusted-device, and MFA step-up constraints.
