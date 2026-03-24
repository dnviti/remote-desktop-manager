---
title: Documentation Index
description: Landing page, table of contents, and project summary for Arsenale
generated-by: ctdf-docs
generated-at: 2026-03-24T23:40:00Z
source-files:
  - README.md
  - CLAUDE.md
  - package.json
---

![Arsenale](../icons/Arsenale_logo_transparent.png)

# Arsenale Documentation

**Arsenale** is a web-based remote access management platform for SSH, RDP, VNC, and database connections. It provides encrypted credential storage, multi-tenant RBAC, session recording, gateway orchestration, a zero-trust tunnel system, and a native client CLI.

## :books: Table of Contents

- [Technology Stack](#technology-stack)
- [Quick Start](#quick-start)
- [Documentation](#documentation)
- [Key Features](#key-features)
- [Repository](#repository)

## :gear: Technology Stack

| Layer | Technologies |
|-------|-------------|
| **Server** | Express, TypeScript, Prisma ORM, Socket.IO, ssh2, guacamole-lite |
| **Client** | React 19, Vite, Material-UI v7, Zustand, XTerm.js, guacamole-common-js |
| **Database** | PostgreSQL 16 (42 Prisma models) |
| **Infrastructure** | Docker, Podman, Kubernetes |
| **Extensions** | Chrome Extension (Manifest V3) |
| **CLI** | Go, RFC 8628 Device Auth |
| **AI** | Anthropic, OpenAI, OpenAI-compatible providers |

## :rocket: Quick Start

```bash
git clone https://github.com/dnviti/arsenale.git
cd arsenale
npm install
cp .env.example .env
npm run predev && npm run dev
```

Open `http://localhost:3000` -- register, set up your vault, create connections.

## :page_facing_marks: Documentation

| Section | Description |
|---------|-------------|
| [Architecture](architecture.md) | System design, component interactions, data flow, Mermaid diagrams |
| [Getting Started](getting-started.md) | Installation, prerequisites, environment setup, first run |
| [Configuration](configuration.md) | Environment variables, config files, feature flags |
| [API Reference](api-reference.md) | Complete REST API endpoints, WebSocket namespaces |
| [Deployment](deployment.md) | Docker containers, CI/CD pipelines, production setup |
| [Development](development.md) | Contributing, local dev, testing, branch strategy |
| [Troubleshooting](troubleshooting.md) | Common errors, debugging tips, FAQ |
| [Infrastructure Roadmap](infrastructure-roadmap.md) | Future microservices decomposition plan, phased approach |
| [LLM Context](llm-context.md) | Consolidated single-file for AI/bot consumption |

## :sparkles: Key Features

- **Multi-Protocol:** SSH, RDP, VNC from the browser
- **Database Access:** PostgreSQL, MySQL, Oracle, MSSQL, DB2 -- browser-based SQL client and SSH-tunneled connections
- **Encrypted Vault:** AES-256-GCM encryption for all credentials at rest
- **Secrets Keychain:** Login credentials, SSH keys, certificates, API keys, secure notes with versioning and expiry
- **Multi-Tenant RBAC:** 7 tenant roles, 3 team roles, ABAC policies with time windows and MFA step-up
- **Multi-Factor Auth:** TOTP, SMS (Twilio/SNS/Vonage), WebAuthn/FIDO2 passkeys
- **SSO Integration:** Google, Microsoft, GitHub, OIDC, SAML 2.0, LDAP
- **Session Recording:** SSH (asciicast) and RDP/VNC (Guacamole format) with in-browser playback and video export
- **DLP Policies:** Tenant and per-connection controls for clipboard copy/paste and file upload/download
- **Gateway Orchestration:** Deploy and auto-scale gateways on Docker/Podman/Kubernetes
- **Zero-Trust Tunnel:** Outbound-only tunnel agents for firewalled networks
- **Secret Manager:** Versioned secrets with sharing, expiry, and external links
- **External Vault:** HashiCorp Vault integration (KV v2)
- **Connection Sync:** NetBox integration for automated connection imports
- **Browser Extension:** Chrome extension for credential autofill and keychain browsing
- **PWA:** Progressive Web App with offline support
- **6 Themes:** Editorial, Primer, Tanuki, Monokai, Solarized, OneDark (dark + light modes)
- **SSH Keystroke Inspection:** Real-time command monitoring with configurable block/alert policies
- **Credential Checkout:** Temporary credential check-out/check-in with approval workflow (PAM)
- **Password Rotation:** Automatic credential rotation on target systems
- **Lateral Movement Detection:** MITRE T1021 anomaly detection for multi-target access patterns
- **Pwned Password Check:** HaveIBeenPwned integration for vault secret validation
- **Native Client CLI:** Arsenale Connect CLI for SSH/RDP via native clients (PuTTY, mstsc)
- **RD Gateway:** MS-TSGU protocol support for native RDP clients
- **SSH Proxy:** Native SSH client access via protocol proxy (port 2222)
- **AI-Assisted Queries:** Natural language to SQL via Anthropic, OpenAI, or compatible providers
- **Feature Toggles:** Database proxy, connections, and keychain can be individually disabled
- **Startup Wizard:** Guided first-run configuration via `/api/setup`
- **System Settings:** Admin panel for runtime configuration at `/api/admin/system-settings`

## :link: Repository

- **GitHub:** [dnviti/arsenale](https://github.com/dnviti/arsenale)
- **License:** Business Source License (BSL 1.1)
- **Version:** 1.7.1
