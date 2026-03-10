# Arsenale

> Auto-generated on 2026-03-10. High-level product overview for LLM RAG consumption.

## What is Arsenale

Arsenale is a self-hosted, open-source remote connection manager that provides a unified web interface to manage and connect to remote servers via SSH, RDP, and VNC. It combines browser-based terminal and desktop access with an encrypted credential vault, team collaboration, multi-tenant organizations, and infrastructure orchestration — all from a single deployment.

Think of it as a modern, web-based alternative to tools like mRemoteNG, RoyalTS, or Apache Guacamole — but designed from the ground up for teams that need secure credential management, granular sharing, and organizational structure around their remote access workflows.

## Who is it for

- **IT teams and Managed Service Providers (MSPs)** managing large fleets of servers across multiple clients or organizations. Arsenale's multi-tenant architecture lets a single deployment serve many isolated organizations, each with their own users, teams, connections, and security policies.
- **DevOps and infrastructure engineers** who want quick, browser-based SSH and RDP access without installing desktop clients or managing local credential files. Open a terminal or remote desktop in your browser, from anywhere.
- **Security-conscious organizations** that need credentials encrypted at rest with per-user master keys, not stored in plaintext config files or shared spreadsheets. Arsenale's vault model ensures that even database-level access does not expose credentials.
- **Teams that share infrastructure access** and need granular, auditable permission controls over who can view, use, or administer each connection and secret.

## Remote Access

### SSH Terminals
Arsenale provides full SSH terminal emulation directly in the browser, powered by XTerm.js. Users can open multiple SSH sessions as tabs in a workspace that persists across page reloads. Each terminal session supports configurable fonts, themes, cursor styles, scrollback buffers, and bell behavior. Sessions connect via Socket.IO WebSocket transport for low-latency bidirectional communication.

### Integrated SFTP
Every SSH session includes a built-in SFTP file browser. Users can navigate remote directories, create folders, rename and delete files, and upload or download files — all without leaving the terminal view. File transfers use chunked streaming (64KB chunks) with real-time progress tracking and cancellation support.

### RDP Remote Desktop
RDP sessions are rendered in the browser using the Guacamole protocol (via guacamole-common-js). Users get full remote desktop access with keyboard and mouse input, clipboard synchronization, and drive redirection for file sharing between local and remote machines. RDP settings are highly customizable: color depth, resolution, DPI, resize method, quality presets, wallpaper and font smoothing toggles, audio redirection, security mode, and keyboard layout.

### VNC Support
VNC connections are also supported for environments that use VNC-based remote desktop access.

### SSH Gateway Bastion Hosts
Connections can be routed through SSH gateway bastion hosts (jump servers) for secure access to machines in private networks. Gateways can be self-managed or deployed as managed container instances with automatic health monitoring and SSH key rotation.

## Encrypted Credential Vault

All connection credentials are encrypted at rest using AES-256-GCM with per-user master keys. Each user's master key is derived from their password using Argon2id (a memory-hard key derivation function), ensuring that even if the database is compromised, credentials remain protected without the user's password.

The vault auto-locks after configurable inactivity (default 30 minutes), requiring re-authentication. Users can unlock via password or — if MFA is configured — via TOTP, SMS OTP, or WebAuthn passkey, making re-unlock convenient without sacrificing security. A recovery key is generated at signup to ensure vault access is never permanently lost, even if the user forgets their password.

### Vault Secrets Manager (Keychain)
Beyond connection credentials, Arsenale includes a full secrets manager for storing arbitrary sensitive data: login credentials, SSH keys, TLS certificates, API keys, and secure notes. Secrets support versioning (view and restore previous versions), expiry dates with advance alert notifications, tagging, and folder-based organization.

## Team Collaboration and Sharing

### Connection Sharing
Connections can be shared with individual users at four granular permission levels: view (see the connection exists), use (connect to it), edit (modify its settings), and admin (full control including re-sharing). Sharing uses a re-encryption model — credentials are decrypted with the sharer's master key and re-encrypted with the recipient's master key, so no plaintext credentials are ever transmitted or stored in a shared state.

### Team Workspaces
Organizations can create teams with dedicated connection folders and a team-scoped vault. Team members share a team master key (encrypted per-member with each member's personal key), enabling seamless access to shared connections and secrets without individual share management. Teams support three roles: owner, admin, and member.

### Folder Organization
Connections are organized in a hierarchical folder tree with drag-and-drop reordering. Folders can be shared in bulk — sharing a folder shares all connections within it. Users can mark connections as favorites and access recent connections from a dedicated sidebar section.

### External Sharing
Vault secrets can be shared externally via time-limited, access-count-limited public links. External shares use token-derived encryption (HKDF) independent of the vault, with optional PIN protection (Argon2id-derived). Links can be revoked at any time.

## Multi-Tenant Organizations

Arsenale supports full multi-tenancy. An organization (tenant) provides an isolated environment with its own users, teams, connections, secrets, gateways, and audit logs. Tenant administrators can enforce organization-wide security policies:

- **Mandatory MFA**: require all members to set up multi-factor authentication
- **Vault timeout caps**: set a maximum auto-lock timeout that overrides individual user preferences
- **Default session timeouts**: configure how long SSH/RDP sessions can remain idle before being automatically closed
- **User management**: invite users, assign roles (owner, admin, member), create users directly, toggle accounts, and manage email/password changes with identity verification

Users can belong to multiple organizations and switch between them seamlessly via a tenant picker on login.

## Security

### Multi-Factor Authentication
Arsenale supports three MFA methods, all of which can be used for login, vault unlock, and identity verification:

- **TOTP**: time-based one-time passwords via authenticator apps (Google Authenticator, Authy, etc.)
- **SMS OTP**: one-time codes sent via SMS (supports Twilio, AWS SNS, and Vonage providers)
- **WebAuthn**: passkeys and hardware security keys (FIDO2/U2F) via the WebAuthn browser API

Organizations can enforce mandatory MFA for all members.

### Identity Verification
Sensitive operations (changing email, changing password, admin actions on other users) require a multi-step identity verification flow. The system automatically selects the best available method for the user (email OTP, TOTP, SMS, WebAuthn, or password) and creates a short-lived verification session.

### Account Protection
Accounts are automatically locked after repeated failed login attempts (configurable threshold and duration). Rate limiting is applied to authentication endpoints, SMS verification, and identity verification to prevent abuse.

### Audit Logging
Every security-relevant action is recorded in an immutable audit log with over 100 tracked action types spanning authentication, connections, vault operations, sharing, MFA, sessions, secrets, teams, gateways, and administration. Audit logs are filterable by action type, date range, IP address, and gateway, with full pagination. Tenant administrators can view organization-wide logs.

### Session Monitoring
Administrators have real-time visibility into all active SSH and RDP sessions across the organization. Sessions are tracked with idle detection, heartbeat monitoring, and automatic timeout enforcement. Sessions can be terminated remotely.

## Infrastructure Management

### SSH Gateways
Arsenale supports registering external SSH gateway bastion hosts for routing connections through jump servers. Gateway health is continuously monitored with automatic reconnection.

### Managed Gateway Instances
For containerized environments, Arsenale can deploy and manage gateway instances as containers (Docker, Podman, or Kubernetes). Managed gateways support auto-scaling rules (minimum/maximum replicas, sessions per instance, cooldown periods), real-time health monitoring via WebSocket, and container log viewing for troubleshooting.

### SSH Key Rotation
Gateway SSH key pairs are automatically rotated on a configurable schedule (default: daily at 2 AM) to minimize the window of exposure from compromised keys.

## User Experience

- **Modern UI**: responsive Material UI (MUI v6) interface with dark and light mode
- **Tabbed workspace**: open multiple SSH and RDP sessions simultaneously as browser tabs, with automatic state persistence and restoration across page reloads
- **Customizable terminals**: font family, size, line height, cursor style, theme colors, scrollback buffer, and bell behavior are all configurable per-user
- **Customizable RDP**: color depth, resolution, DPI, quality presets, audio settings, keyboard layout, and display options
- **Persistent preferences**: all UI layout state (panel visibility, sidebar sections, view modes) is automatically saved and restored per-user
- **Real-time notifications**: in-app notifications for sharing events, security alerts, secret expiry warnings, and system events, delivered in real-time via WebSocket
- **OAuth single sign-on**: log in with Google, Microsoft, GitHub, or any custom OIDC/SAML 2.0 provider. OAuth users set a vault password on first login.
- **Email verification**: configurable email verification for new accounts with support for SMTP, SendGrid, Amazon SES, Resend, and Mailgun providers
- **Pop-out sessions**: SSH and RDP sessions can be opened in independent browser windows for multi-monitor workflows

## Arsenale vs. The Entire Guacamole Ecosystem

All these products — CyberArk PSM Gateway, Azure Bastion, Fortinet SSL VPN, Keeper Connection Manager, and vanilla Apache Guacamole — share the same foundation: guacd as the protocol translation engine. They differ in what they wrap around it. Arsenale uses the same core but takes a fundamentally different architectural path. Here's where it wins.

### 1. Architecture: No Java, No Tomcat, No Bloat
Every single competitor wraps guacd with the full Java/Tomcat stack:
- CyberArk's architecture is explicitly: Browser → Servlet Container (Tomcat) → PSM Gateway app (Java servlet) → Guacd → RDP.
- Azure Bastion is Apache Guacamole with a Microsoft layer on top. Fortinet's SSL Web VPN is also Apache Guacamole underneath.
- Keeper Connection Manager was built by the creators of Apache Guacamole, and while they improved the installer and UI, the engine underneath is still the same Java client + guacd.

Arsenale replaces that entire Java middleware with guacamole-lite (Node.js) + Express.js + Socket.IO, which is a dramatically lighter, faster path: Browser → WebSocket → guacamole-lite → guacd. No servlet container, no WAR deployment, no Java memory ballooning.

### 2. Cost & Licensing: Self-Hosted, No Per-Seat Ransoming
- Azure Bastion charges approximately $0.19/hour (~$140/month) just to exist, plus data transfer fees — and it keeps billing even when you delete your VMs. Users discovered they were still being charged after removing VMs because Bastion keeps consuming resources as long as it's deployed, regardless of usage.
- CyberArk demands significant upfront and ongoing investment, including infrastructure setup, specialized personnel, and tiered licensing. Around 21% of their revenue comes from "Maintenance and Professional Services," and major upgrades often require additional expensive services. Reviews note that deployment took more time and resources than expected, with complicated configuration, and that getting support answers typically requires paying for a higher support tier.
- Keeper's business-level deployments generally range from $7,500 to $80,000 annually. They also only offer a SaaS model, which may disappoint fully self-hosted teams, and have minimal PAM capabilities.

Arsenale is fully self-hosted with no per-seat licensing, no cloud lock-in, no surprise bills for idle resources, and no mandatory professional services engagements. For an SMB or even a mid-size company, this is a massive cost differentiator.

### 3. Vendor Lock-In & Cloud Dependency
- Azure Bastion is Azure-only. It only supports IPv4, doesn't work in Virtual WAN hubs, can't be moved between resource groups without full redeployment, and doesn't support custom domains with shareable links. If you're not on Azure, it simply doesn't exist for you.
- CyberArk's core PAM components rely on Microsoft technologies including Windows Server, Remote Desktop Services, and IIS, requiring Windows-based infrastructure and regular patching.
- Keeper is SaaS-only — no self-hosted option.

Arsenale runs anywhere Docker runs — on-prem, any cloud, hybrid, air-gapped. PostgreSQL, Node.js, and guacd are all cross-platform. No vendor lock-in whatsoever.

### 4. Security: Native vs. Bolted-On
- Vanilla Guacamole's security is "configure it yourself" — optional TOTP extensions, optional SAML, and a track record of severe CVEs including arbitrary code execution via terminal codes in versions through 1.5.5, integer overflow vulnerabilities in VNC handling through 1.5.3, and protocol handshake injection flaws through 1.5.1.
- CyberArk lacks the flexibility and open-source innovation that Guacamole supports, and has a centralized online vault that is a single point of failure — it must be online at all times and relies on the network to secure data during transmission.
- Azure Bastion has challenges with protocol speed and reliability, and file transfer requires routing through Azure Storage with additional permissions like ACL or NFS — you can't simply copy/paste files.

Arsenale has JWT + TOTP + Argon2id + AES-256-GCM built into the core from day one, not bolted on as extensions. The planned IP blacklisting (manual, automatic, external feeds, geo-blocking), AI-powered threat detection with auto-disconnect, and SBOM support go far beyond what any of these competitors offer at their respective price points.

### 5. UI & Developer Experience
- Guacamole's UI looks outdated and many dismiss it because it's an Apache project with an aging interface, still running on AngularJS.
- CyberArk's native console is described as "powerful but hard to navigate for complex policies," with a user interface that is "functional but somewhat less user-friendly compared to the latest PAM competitors." Adding devices is not simple and can't be grouped by department.
- Azure Bastion's native mode requires PowerShell or az CLI with many parameters on the command line, and it's more compatible with Edge than other browsers.

Arsenale is React 19 — a modern, componentized, fully customizable frontend. You own the UX entirely. No AngularJS debt, no Microsoft portal dependency, no ancient Java admin screens.

### 6. Multi-Tenancy
None of the competitors have proper multi-tenancy at the gateway level:
- Guacamole has users and connection groups but no tenant isolation.
- CyberArk has "safes" and vaults but that's PAM-level, not gateway-level — and requires massive infrastructure per tenant.
- Azure Bastion is per-VNet, not multi-tenant.
- Keeper Connection Manager is per-organization but SaaS-only.

Arsenale has native multi-tenant architecture with per-tenant isolation baked in, including the planned per-tenant Lua plugin sandboxing. This is critical for MSPs and SaaS delivery.

### 7. Extensibility & Integration
- CyberArk lacks the flexibility and open-source innovation that Guacamole supports, making customization and adaptation more difficult.
- Keeper Connection Manager does not offer an API.
- Guacamole extensions are Java-based, tightly coupled to the servlet lifecycle, and poorly documented.
- Azure Bastion has zero extensibility — it's a managed black box.

Arsenale's planned stack is leagues ahead: Lua plugin system (sandboxed, event-reactive, per-tenant, with declarative UI rendering), outbound webhooks for third-party integration, MCP server integration for LLM access to platform logs, and multi-channel notifications (email, push, WhatsApp, Telegram, Element). No other product in this space even attempts this level of programmability.

### 8. Observability & Monitoring
- Guacamole logs to syslog. That's it.
- CyberArk has session recording and audit logs, but users report issues like PSM server limitations and memory leaks.
- Azure Bastion doesn't give you visibility during VM reboots — if you have boot issues, you can't troubleshoot through Bastion at all.

Arsenale's planned monitoring dashboard (global error/connection views, gateway stats, blacklisted IP visibility, real-time active IP tracking, AI-powered log analysis) addresses a gap that none of these products fill at the gateway level. The combination of real-time monitoring + AI threat detection + auto-disconnect + push notifications to admins is unique in this space.

### 9. Deployment Complexity
- CyberArk's initial setup and configuration is complex and requires specialized expertise. The Vault alone requires 32-256 GB RAM depending on deployment size, 8-60+ physical CPU cores, plus separate resource requirements for PSM, PTA, and other components.
- Vanilla Guacamole requires configuring a full Tomcat server, manually deploying WAR files, and the first ~10 attempts often fail without clear error messages.
- Azure Bastion takes 10-15 minutes to deploy, and some teams delete it when not in use and redeploy it every few days to save costs.

Arsenale is Docker containers — docker-compose up and you're running. Node.js + PostgreSQL + guacd, all containerized. No Tomcat, no WAR files, no 256 GB RAM vault servers.

### Summary: Arsenale's Competitive Advantages

| Advantage | vs. Guacamole | vs. CyberArk | vs. Azure Bastion | vs. Keeper CM |
|-----------|---------------|--------------|-------------------|---------------|
| No Java/Tomcat | ✅ | ✅ | ✅ | ✅ |
| Modern React UI | ✅ | ✅ | ✅ | Comparable |
| Self-hosted, no lock-in | Same | ✅ | ✅ | ✅ |
| No per-seat/hourly billing | Same | ✅ | ✅ | ✅ |
| Native security stack | ✅ | ✅ | ✅ | ✅ |
| Multi-tenancy | ✅ | ✅ | ✅ | ✅ |
| Plugin system (Lua) | ✅ | ✅ | ✅ | ✅ |
| Webhook integrations | ✅ | Comparable | ✅ | ✅ |
| AI threat detection | ✅ | ✅ | ✅ | ✅ |
| Monitoring dashboard | ✅ | ✅ | ✅ | ✅ |
| MCP/LLM integration | ✅ | ✅ | ✅ | ✅ |
| Deployment simplicity | ✅ | ✅ | ✅ | Comparable |
| No cloud dependency | N/A | ✅ | ✅ | ✅ |
| SBOM support | ✅ | ✅ | ✅ | ✅ |

The bottom line: these billion-dollar companies took the lazy path — they wrapped the same old Java/Tomcat/guacd stack, slapped their brand on it, and charge enterprise prices. Arsenale rethinks the middleware layer entirely while keeping the battle-tested guacd core, and adds a modern security/extensibility/monitoring layer that none of them offer. You're building what these companies should have built.

## Deployment

Arsenale is designed to be easy to self-host:

- **Single command production deployment**: `docker compose up` launches the full stack — application server, web frontend (nginx), PostgreSQL database, and Guacamole daemon — as a multi-container stack with health checks and automatic dependency ordering.
- **Simple configuration**: a single `.env` file with sensible defaults. Only a handful of secrets need to be generated for production (JWT secret, encryption key, database password, Guacamole secret).
- **Automatic migrations**: the server runs database migrations on every startup — no manual schema management needed.
- **Container runtime flexibility**: supports both Docker and Podman with automatic detection. Works with Docker Compose v2 and Podman Compose.
- **Optional SSH gateway**: deploy the SSH gateway container for bastion-based access patterns, or register external gateway hosts.
- **Non-root containers**: all containers run as non-root users for improved security posture.
- **Volume persistence**: PostgreSQL data and RDP drive files are stored in named volumes for durability across container restarts.

## Technology

Arsenale is built with modern, well-supported open-source technologies:

- **Backend**: Node.js with TypeScript, Express.js, Prisma ORM, PostgreSQL 16
- **Frontend**: React 19, Vite, Material-UI v6, Zustand state management
- **Real-time**: Socket.IO (SSH terminals, notifications, gateway monitoring), guacamole-lite (RDP)
- **Security**: AES-256-GCM encryption, Argon2id key derivation, bcrypt password hashing, JWT authentication, WebAuthn
- **Infrastructure**: Docker/Podman containerization, nginx reverse proxy, optional SSH gateway bastion

The codebase follows a clean layered architecture (routes, controllers, services, data access) and is designed to be extensible and contribution-friendly with comprehensive documentation.