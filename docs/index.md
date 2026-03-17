---
title: Documentation Index
description: Landing page, table of contents, and project summary for Arsenale
generated-by: ctdf-docs
generated-at: 2026-03-17T10:00:00Z
source-files:
  - README.md
  - CLAUDE.md
  - package.json
---

# Arsenale Documentation

**Arsenale** is a web-based remote access management platform for SSH, RDP, and VNC connections. It provides encrypted credential storage, multi-tenant RBAC, session recording, gateway orchestration, and a zero-trust tunnel system.

## Technology Stack

| Layer | Technologies |
|-------|-------------|
| **Server** | Express, TypeScript, Prisma ORM, Socket.IO, ssh2, guacamole-lite |
| **Client** | React 19, Vite, Material-UI v7, Zustand, XTerm.js, guacamole-common-js |
| **Database** | PostgreSQL 16 |
| **Infrastructure** | Docker, Podman, Kubernetes |
| **Extensions** | Chrome Extension (Manifest V3) |

## Quick Start

```bash
git clone https://github.com/dnviti/arsenale.git
cd arsenale
npm install
cp .env.example .env
npm run predev && npm run dev
```

Open `http://localhost:3000` — register, set up your vault, create connections.

## Documentation

| Section | Description |
|---------|-------------|
| [Architecture](architecture.md) | System design, component interactions, data flow, Mermaid diagrams |
| [Getting Started](getting-started.md) | Installation, prerequisites, environment setup, first run |
| [Configuration](configuration.md) | Environment variables, config files, feature flags |
| [API Reference](api-reference.md) | Complete REST API endpoints, WebSocket namespaces |
| [Deployment](deployment.md) | Docker containers, CI/CD pipelines, production setup |
| [Development](development.md) | Contributing, local dev, testing, branch strategy |
| [Troubleshooting](troubleshooting.md) | Common errors, debugging tips, FAQ |
| [LLM Context](llm-context.md) | Consolidated single-file for AI/bot consumption |

## Key Features

- **Multi-Protocol:** SSH, RDP, VNC from the browser
- **Encrypted Vault:** AES-256-GCM encryption for all credentials at rest
- **Multi-Tenant RBAC:** 7 tenant roles, 3 team roles, ABAC policies
- **Multi-Factor Auth:** TOTP, SMS, WebAuthn/FIDO2 passkeys
- **SSO Integration:** Google, Microsoft, GitHub, OIDC, SAML, LDAP
- **Session Recording:** SSH (asciicast) and RDP/VNC (Guacamole format) with video export
- **Gateway Orchestration:** Deploy and auto-scale gateways on Docker/Podman/Kubernetes
- **Zero-Trust Tunnel:** Outbound-only tunnel agents for firewalled networks
- **Secret Manager:** Versioned secrets with sharing, expiry, and external links
- **External Vault:** HashiCorp Vault integration (KV v2)
- **Connection Sync:** NetBox integration for automated connection imports
- **Browser Extension:** Chrome extension for credential autofill
- **PWA:** Progressive Web App with offline support
- **6 Themes:** Editorial, Primer, Tanuki, Monokai, Solarized, OneDark (dark + light modes)

## Repository

- **GitHub:** [dnviti/arsenale](https://github.com/dnviti/arsenale)
- **License:** Business Source License (BSL)
- **Version:** 1.3.2
