---
title: Go Refactor Completion
description: Historical completion note for the Arsenale migration from the Node/Prisma stack to the Go control plane
generated-by: codex
generated-at: 2026-03-31T00:00:00Z
source-files:
  - backend/cmd/control-plane-api/main.go
  - backend/cmd/control-plane-api/routes_public.go
  - backend/cmd/control-plane-api/routes_sessions.go
  - backend/cmd/control-plane-api/readiness.go
  - backend/schema/bootstrap.sql
  - scripts/bootstrap-db-schema.sh
  - deployment/ansible/roles/deploy/tasks/main.yml
  - docker-compose.yml
---

## Status

The Go refactor is complete for the live application runtime.

What is true now:

- The public `/api` edge is served by `control-plane-api-go`.
- Browser terminal and desktop traffic are served by Go brokers.
- The legacy reverse proxy fallback has been removed.
- The live stack no longer requires the legacy Node runtime container.
- Empty database bootstrap is handled by `backend/schema/bootstrap.sql` through `scripts/bootstrap-db-schema.sh`.
- The root npm workspace, default dev flow, and active CI no longer depend on Prisma generation or the legacy Node server.

## Active Sources Of Truth

| Domain | Source |
|--------|--------|
| Public routes | `backend/cmd/control-plane-api/routes_*.go` |
| Runtime services | `backend/cmd/*` and `backend/internal/*` |
| Database bootstrap | `backend/schema/bootstrap.sql` |
| Deploy bootstrap hook | `deployment/ansible/roles/deploy/tasks/main.yml` |
| Acceptance verification | `scripts/dev-api-acceptance.sh` |

## Archived Material

`server/` has been removed from the repository. The live system now uses `backend/` as the sole server-side source of truth for runtime behavior, builds, and deployments.

## Continuation Guidance

Future work should assume a Go-first system:

1. Add new backend behavior in `backend/`, not `server/`.
2. Update `backend/schema/bootstrap.sql` and the Go stores when schema changes are introduced.
3. Keep docs and CI aligned with the Go runtime.
4. Treat any remaining `server/` references as archival cleanup, not active platform dependencies.
