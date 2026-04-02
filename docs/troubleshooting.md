---
title: Troubleshooting
description: Common failures, debugging commands, and operator guidance for Arsenale
generated-by: claw-docs
generated-at: 2026-04-02T12:57:10Z
source-files:
  - Makefile
  - scripts/dev-api-acceptance.sh
  - scripts/db-migrate.sh
  - dev-certs/generate.sh
  - client/vite.config.ts
  - client/nginx.dev.conf
  - backend/internal/app/app.go
  - backend/cmd/control-plane-api/routes_public.go
  - backend/cmd/control-plane-api/dev_bootstrap.go
  - docker-compose.yml
---

## 🩺 First Checks

Start with health and container state before debugging feature code.

```bash
make status
curl -k https://localhost:3000/health
curl http://127.0.0.1:18080/healthz
curl http://127.0.0.1:18090/healthz
curl http://127.0.0.1:18091/healthz
```

Useful log tail:

```bash
make logs SVC=arsenale-control-plane-api
make logs SVC=arsenale-client
make logs SVC=arsenale-query-runner
make logs SVC=arsenale-dev-tunnel-db-proxy
```

## 🔐 TLS and Browser Issues

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| Browser warns about the cert | Dev CA not trusted | Import `dev-certs/ca.pem` |
| `ERR_CERT_AUTHORITY_INVALID` | Fresh machine or browser profile | Re-import CA and restart browser |
| Vite starts without HTTPS | Dev cert files missing | Run `make setup` or `./dev-certs/generate.sh` |
| API calls fail only in local Vite | Proxy targets or TLS overrides wrong | Check `client/vite.config.ts` and `VITE_*` overrides |
| Containerized client is up but UI assets fail | nginx template mismatch | Check `client/nginx.dev.conf` and `make logs SVC=arsenale-client` |

## 🔑 Auth, Vault, and Tenant Bootstrap Problems

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| `403 CSRF` on writes | Missing or stale `X-CSRF-Token` | Re-login and verify `arsenale-csrf` cookie is present |
| Login loops on 401 | Refresh flow broken or expired cookies | Clear cookies and re-authenticate |
| Tenant vault says not initialized on a newly created tenant | Old control-plane container or stale session | Restart the current stack and log in again; new tenants auto-provision tenant vault state now |
| Tenant SSH keypair is missing on a new tenant | Old control-plane container | Redeploy the current stack; tenant SSH keys are auto-generated during tenant creation now |
| Setup wizard appears unexpectedly | Empty DB or dev bootstrap did not run | Check `arsenale-control-plane-api` logs and rerun `make dev` |

## 🖥 Session and Gateway Issues

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| `/guacamole` fails or black screen | `guacd` unhealthy or target issue | Check `arsenale-guacd` logs and `desktop-broker` health |
| SSH session fails immediately | SSH target, gateway, or credentials wrong | Verify connection settings and `ssh-gateway` health |
| Gateway inventory looks empty | Dev bootstrap did not finish | Re-run `make dev` and confirm bootstrap output |
| Tunneled gateway stays disconnected | Tunnel certs or tunnel-broker state issue | Check `arsenale-dev-tunnel-*` logs and `tunnel-broker` health |

## 🗄 Database Query Issues

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| `No active session to fetch execution plan.` in audit | Old audit entry without stored plan | Enable `Persist execution plans in audit logs` on the connection and run a new query |
| Oracle error `ORA-01435: user does not exist` with `CURRENT_SCHEMA = FREEPDB1` | Session config used the Oracle service name as schema | Reopen the session after the fix, or clear `searchPath` when it matches the service name |
| Query blocked by firewall | Built-in or custom SQL firewall matched | Inspect `/api/db-audit/firewall-rules` and the DB audit entry |
| Query throttled | DB rate-limit policy triggered | Inspect `/api/db-audit/rate-limit-policies` and retry later |
| DB session created but host-side DB tunnel is unreachable | Raw DB tunnel flow is different from UI query path | Use `DATABASE` sessions through `db-proxy`; do not treat host DB tunnel reachability as the UI query path |
| Demo DB connection refused | Demo fixture container not healthy | Check `arsenale-dev-demo-postgres`, `-mysql`, `-mongodb`, `-oracle`, or `-mssql` |
| DB2 fields exist in the UI but queries fail | DB2 metadata exists, query protocol support does not | Treat DB2 as not yet supported for interactive queries |

Representative direct fixture checks:

```bash
podman exec arsenale-dev-demo-postgres psql -U demo_pg_user -d arsenale_demo -At -c "select count(*) from public.demo_customers;"
podman exec arsenale-dev-demo-mysql mysql -u demo_mysql_user -pDemoMySqlPass123! -D arsenale_demo -Nse "select count(*) from demo_customers;"
podman exec arsenale-dev-demo-mongodb mongosh --quiet -u demo_mongo_user -p DemoMongoPass123! --authenticationDatabase arsenale_demo arsenale_demo --eval "db.demo_customers.countDocuments({})"
```

## 🧪 Deeper Diagnostics

### Acceptance script

```bash
npm run dev:api-acceptance
```

This is the fastest way to determine whether the breakage is local UI-only or a real platform regression.

### Database migrations

```bash
./scripts/db-migrate.sh status
./scripts/db-migrate.sh up
```

### CLI smoke

```bash
go build -o /tmp/arsenale-cli ./tools/arsenale-cli
/tmp/arsenale-cli --server https://localhost:3000 health
/tmp/arsenale-cli --server https://localhost:3000 whoami
/tmp/arsenale-cli --server https://localhost:3000 gateway list
```

## 🔄 Safe Reset Options

Use these in order, from least disruptive to most disruptive:

1. `make logs SVC=...` for the failing service.
2. `make status` to confirm container health.
3. `make certs` if the symptom is TLS-only.
4. `make dev-down && make dev` to recreate the local stack.

Avoid deleting PostgreSQL volumes unless you intentionally want to lose the local application database.
