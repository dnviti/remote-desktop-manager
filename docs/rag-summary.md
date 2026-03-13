# Arsenale

> Auto-generated on 2026-03-11. High-level product overview for LLM RAG consumption.

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

A secrets manager built into the vault allows users to store various credential types including login credentials, SSH key pairs, TLS certificates, API keys, and encrypted notes. Secrets support versioning with full history, allowing users to view previous values and restore older versions. Expiry dates can be set on secrets, with automatic notifications when secrets are approaching or have passed their expiration. Secrets can be organized into folders scoped to personal, team, or organization levels.

A recovery key is generated during registration, enabling vault recovery if the user forgets their password. This key is displayed once and must be saved securely by the user.

## Team Collaboration and Sharing

Connections can be shared with other users using granular permission levels. When a connection is shared, the credentials are re-encrypted using the recipient's vault key, ensuring that shared credentials remain protected by each user's individual encryption. Share permissions can be set to read-only or full access, controlling whether recipients can modify connection settings.

Batch sharing allows multiple connections to be shared simultaneously, and folder-level sharing applies permissions to all connections within a folder. Secrets from the vault can also be shared internally with team members using the same re-encryption model.

External sharing enables creating time-limited, access-limited links for secrets that can be shared with people outside the platform. These links can optionally be protected with a PIN code. External shares have configurable expiration dates and maximum access counts, and can be revoked at any time.

Teams provide a collaborative workspace within an organization. Teams have their own connection pools, folders, and vault sections. Team members are assigned roles (admin, editor, viewer) that control their level of access. Team vaults use a separate encryption key distributed to members, ensuring team secrets are accessible only to team members.

Folder organization supports nested hierarchies with drag-and-drop reordering for both personal and team connections.

## Multi-Tenant Organizations

Arsenale supports multi-tenant architecture where each organization operates in isolation. Users can belong to multiple organizations and switch between them seamlessly. Each tenant has its own set of users, teams, connections, gateways, and vault secrets.

Tenant roles provide a seven-level hierarchical access control: Owner > Admin > Operator > Member > Consultant > Auditor > Guest. Owners have full control including tenant deletion. Admins can manage users, configure policies, and administer gateways. Operators can manage gateways and view active sessions. Members have standard access to their assigned resources. Consultants have access to assigned connections only. Auditors have read-only access to audit logs and sessions. Guests can view shared connection info without connecting. Non-hierarchical access is supported via role-any checks (e.g., Auditors access audit routes despite being below Member in the hierarchy).

Tenant-level policies allow administrators to enforce mandatory multi-factor authentication for all members, set maximum vault auto-lock durations to prevent users from keeping vaults unlocked indefinitely, and configure default session inactivity timeouts. User accounts can be enabled or disabled by administrators, and admins can perform identity-verified operations like changing user emails or resetting passwords.

Time-limited memberships allow administrators to set an optional expiration date on tenant and team memberships. Expired memberships are automatically filtered out at token issuance time (defense in depth) and cleaned up by a batch scheduler running every 5 minutes. When a tenant membership expires, the user is removed from all teams in that tenant and their refresh tokens are revoked for immediate lockout. Owner memberships cannot expire. Administrators can set, change, or remove expiration dates from the organization settings UI.

## Security

Arsenale supports multiple MFA methods: TOTP authenticator apps, SMS one-time passwords (via Twilio, AWS SNS, or Vonage), and WebAuthn/FIDO2 passkeys for hardware security key and biometric authentication. Users can register multiple methods simultaneously. Identity verification is required for sensitive operations like email changes or password resets, using the same MFA infrastructure.

Account lockout protection automatically locks accounts after repeated failed login attempts, with configurable thresholds and durations. Rate limiting is applied to login, registration, password reset, and SMS endpoints to prevent abuse.

Token binding ties JWT access tokens and refresh tokens to the originating client's IP address and User-Agent via a SHA-256 hash embedded in the token payload and stored on refresh token records. If a token is presented from a different IP or User-Agent than the one that issued it, the token is rejected and the session is terminated. For refresh tokens, the entire token family is revoked to prevent further use. A `TOKEN_HIJACK_ATTEMPT` audit event is logged for security monitoring. Token binding is enabled by default and can be disabled globally via the `TOKEN_BINDING_ENABLED` environment variable for environments with dynamic IPs. Tokens issued before token binding was enabled are accepted without verification for backward compatibility.

Comprehensive audit logging tracks over 100 distinct action types across the platform, including authentication events, connection usage, sharing activities, administrative operations, and session lifecycle events. Audit logs include client IP addresses and optional geographic location enrichment using MaxMind GeoLite2 data. Administrators can view tenant-wide audit logs with geographic visualization on an interactive map.

Session monitoring allows administrators to view all active remote sessions across the organization, with the ability to terminate sessions remotely. Idle session detection automatically marks sessions as idle after configurable inactivity periods.

Session recording can be enabled to capture SSH terminal sessions (in asciicast format) and RDP/VNC sessions (in Guacamole format). Recordings can be played back in-browser, analyzed for command extraction, and exported as video files. Recording retention is configurable with automatic cleanup.

Data Loss Prevention (DLP) policies control clipboard and file operations in RDP, VNC, and SSH sessions. Tenant-level policies set an organization-wide floor that applies to all connections, while per-connection DLP overrides can only be more restrictive (logical OR / most restrictive wins). Four controls are available: disable clipboard copy (remote to local), disable clipboard paste (local to remote), disable file download, and disable file upload. For RDP and VNC, clipboard restrictions are enforced via Guacamole protocol parameters (`disable-copy`, `disable-paste`) with additional client-side gating as defense-in-depth. RDP file transfer restrictions are enforced both via Guacamole parameters (`disable-download`, `disable-upload`) and server-side guards on the file upload/download API. For SSH sessions, clipboard restrictions are enforced client-side in the terminal (Ctrl+Shift+C for copy, Ctrl+Shift+V for paste), and SFTP file transfer restrictions are enforced server-side in the Socket.IO handler (authoritative) with client-side UI hiding of upload/download controls as defense-in-depth. When both download and upload are disabled, the file browser UI (drive for RDP, SFTP for SSH) is hidden entirely. DLP policy changes are tracked in the audit log under the `TENANT_DLP_POLICY_UPDATE` action.

The native browser right-click context menu is globally suppressed across the entire authenticated UI to prevent access to browser functions (Save As, Print, Inspect) that could bypass DLP controls. Existing custom context menus in the sidebar (connections, folders, vault secrets) are unaffected as they already call `preventDefault()` and `stopPropagation()`. SSH terminal sessions provide a custom right-click context menu (`SessionContextMenu`) with DLP-aware Copy and Paste actions, SFTP file browser toggle, fullscreen toggle, and session disconnect. Copy and Paste menu items are disabled when the corresponding DLP policy flags are active. RDP and VNC sessions retain their native right-click forwarding to the remote machine; session-specific actions for these protocols (clipboard, special keys, screenshot, disconnect) are available via the docked edge toolbar.

Browser-level exfiltration vectors are blocked as an additional DLP hardening layer in both development and production builds. DevTools shortcuts (F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C), View Source (Ctrl+U), Save Page (Ctrl+S), and Print (Ctrl+P) are all intercepted and suppressed. Ctrl+Shift+C is carved out when an SSH terminal is focused so the terminal's own DLP-aware copy handler processes it instead. Drag-and-drop from the page to external applications is also prevented. Text selection is disabled on UI chrome elements (AppBar, toolbar, tabs, sidebar, drawers) while remaining enabled in form inputs, text areas, and terminal/viewer content.

## Infrastructure Management

SSH gateways can be managed entirely by Arsenale through container orchestration. The platform supports Docker, Podman, and Kubernetes as orchestration backends, automatically detecting the available runtime. Managed gateways can be deployed, scaled, and monitored from the web interface.

Auto-scaling automatically adjusts the number of gateway container instances based on active session counts, with configurable minimum and maximum replicas, sessions-per-instance thresholds, and scale-down cooldown periods. Load balancing distributes sessions across instances using round-robin or least-connections strategies.

SSH key pairs are managed at the tenant level with automatic rotation on configurable schedules. Keys can be pushed to gateway instances via an API sidecar, and private keys can be downloaded for manual configuration.

Gateway health monitoring continuously checks gateway availability with configurable intervals, reporting latency and status in real time through WebSocket updates.

Gateway templates provide reusable configurations for quick deployment of new gateways with pre-configured auto-scaling, monitoring, and load balancing settings.

## User Experience

The interface uses Material Design with support for both dark and light themes. The tabbed workspace preserves active sessions when navigating between connections or opening settings and management dialogs. All UI layout preferences (panel states, sidebar sections, filter selections, view modes) are automatically persisted and restored across browser sessions.

SSH terminals and RDP settings can be customized globally as user defaults and overridden per connection. Connections can be opened in standalone popup windows for multi-monitor setups.

Real-time notifications alert users to sharing events, secret expiry warnings, and other platform activities. A notification bell in the toolbar shows unread counts and allows quick access to recent notifications.

OAuth single sign-on supports Google, Microsoft, GitHub, any OIDC-compliant identity provider (Authentik, Keycloak, Authelia, Zitadel), and SAML 2.0 identity providers (Azure AD/Entra ID, Okta, OneLogin, ADFS). Multiple identity providers can be linked to a single account.

Email verification supports multiple providers including SMTP, SendGrid, Amazon SES, Resend, and Mailgun, with automatic console logging in development environments.

Connection import and export supports CSV, JSON, mRemoteNG configuration files, and RDP files for easy migration from other tools.

## Deployment

Arsenale deploys with a single Docker Compose command that starts all required services: PostgreSQL database, Guacamole daemon, the server API, and the Nginx-based web client. Database migrations run automatically on startup. The entire stack runs on an internal Docker network with only the web port exposed to the host.

Both Docker and Podman are supported as container runtimes, with rootless Podman configurations working out of the box. All application containers run as non-root users. Volume persistence is configured for database data, drive files, and session recordings.

Configuration is handled through a single environment file with sensible defaults for development. Production deployment requires setting cryptographic secrets and connection parameters, all documented with generation commands.

## Technology

Arsenale is built on a modern open-source stack: a Node.js and TypeScript server with a layered Express architecture backed by PostgreSQL through Prisma ORM, and a React client with Zustand state management and Material UI components. Remote desktop rendering uses the Guacamole protocol via guacamole-lite and guacamole-common-js. SSH terminals use XTerm.js with the ssh2 library. Real-time communication uses Socket.IO for terminal I/O, notifications, and monitoring updates.
