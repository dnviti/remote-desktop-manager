---
title: LLM Context
description: Consolidated single-file context for LLM and bot consumption
generated-by: claw-docs
generated-at: 2026-03-31T00:00:00Z
source-files:
  - README.md
  - package.json
  - backend/cmd/control-plane-api/main.go
  - backend/cmd/control-plane-api/routes_public.go
  - backend/cmd/control-plane-api/routes_sessions.go
  - backend/internal/systemsettingsapi/service.go
  - backend/schema/bootstrap.sql
  - client/vite.config.ts
---

# Arsenale - LLM Context Document

## Project Summary

Arsenale is a Go-first remote access platform for SSH, RDP, VNC, and database access through a browser. The active runtime lives in `backend/` and the active JavaScript workspaces are `client/`, `gateways/tunnel-agent/`, and `extra-clients/browser-extensions/`. The legacy Node `server/` implementation has been removed from the repository.

## Runtime Architecture

- Public HTTPS edge: `client` on `https://localhost:3000`
- Public API edge: `control-plane-api-go` on `http://localhost:18080`
- Browser terminal transport: `terminal-broker-go`
- Browser desktop transport: `desktop-broker-go`
- Query execution: `query-runner-go`
- Data stores: PostgreSQL 16 + Redis

## Active Source Of Truth

| Area | Active source |
|------|---------------|
| Public routes | `backend/cmd/control-plane-api/routes_*.go` |
| Runtime services | `backend/cmd/*` and `backend/internal/*` |
| Empty DB bootstrap | `backend/schema/bootstrap.sql` + `scripts/bootstrap-db-schema.sh` |
| Frontend dev proxy | `client/vite.config.ts` |
| Deployment | `deployment/ansible/playbooks/deploy.yml` + `deployment/ansible/roles/deploy/` |

## Development Commands

```bash
make setup              # First-time vault/cert setup
make dev                # Full local stack via Ansible
npm run dev             # Full dev flow: make dev + local Vite
npm run verify          # Backend tests + JS typecheck/lint/test/build
npm run db:bootstrap    # Apply bootstrap.sql when DB is empty
```

## API Surface

The public `/api` surface is served by the Go control plane. Major domains include:

- `/api/auth`
- `/api/user`
- `/api/vault`
- `/api/secret`
- `/api/connections`
- `/api/folders`
- `/api/session`
- `/api/gateway`
- `/api/tenant`
- `/api/team`
- `/api/audit`
- `/api/recording`
- `/api/cli`
- `/api/health`
- `/api/ready`

## Configuration Notes

- Root `.env` is the shared config file for the stack.
- Environment variables override DB-backed system settings.
- New runtime behavior should target Go services and Go-backed stores.

## Historical Note

`server/` has been removed. If runtime behavior is needed, implement it directly in `backend/`.
