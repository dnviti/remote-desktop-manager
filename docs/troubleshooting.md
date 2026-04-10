---
title: Troubleshooting
description: Common failures, debugging commands, and operator guidance for Arsenale
generated-by: claw-docs
generated-at: 2026-04-05T18:35:00Z
source-files:
  - Makefile
  - scripts/dev-api-acceptance.sh
  - scripts/db-migrate.sh
  - dev-certs/generate.sh
  - deployment/ansible/playbooks/install.yml
  - deployment/ansible/playbooks/status.yml
  - client/vite.config.ts
  - client/nginx.dev.conf
  - backend/internal/runtimefeatures/manifest.go
  - backend/internal/publicconfig/service.go
  - backend/internal/app/app.go
  - backend/cmd/control-plane-api/routes_public.go
  - backend/cmd/control-plane-api/readiness.go
  - backend/cmd/control-plane-api/dev_bootstrap.go
  - docker-compose.yml
---

## 🩺 First Checks

Start with installer status, health, and container state before debugging feature code.

```bash
make status
curl -k https://localhost:3000/health
curl http://127.0.0.1:18080/api/ready
curl http://127.0.0.1:18080/healthz
curl http://127.0.0.1:18090/healthz
curl http://127.0.0.1:18091/healthz
curl http://127.0.0.1:18092/healthz
curl http://127.0.0.1:18093/healthz
curl http://127.0.0.1:18094/healthz
```

Useful log tail:

```bash
make logs SVC=arsenale-control-plane-api
make logs SVC=arsenale-client
make logs SVC=arsenale-query-runner
make logs SVC=arsenale-dev-tunnel-db-proxy
```

`GET /api/ready` is worth checking early because it returns structured dependency status. Today it reports:

- PostgreSQL readiness
- desktop broker readiness when connection features are enabled

## 🔐 TLS, Browser, And Hostname Issues

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| Browser warns about the cert | Dev CA not trusted | Import `${XDG_STATE_HOME:-$HOME/.local/state}/arsenale-dev/dev-certs/ca.pem` |
| `ERR_CERT_AUTHORITY_INVALID` | Fresh machine or browser profile | Re-import CA and restart browser |
| `arsenale-cli` fails with `x509: certificate signed by unknown authority` on `https://localhost:3000` | Dev CA missing or moved | Restore `${XDG_STATE_HOME:-$HOME/.local/state}/arsenale-dev/dev-certs/client/ca.pem`, or point `ARSENALE_CA_CERT` at the active CA bundle |
| Vite starts without HTTPS | Dev cert files missing | Run `make setup` or `make certs` |
| API calls fail only in local Vite | Proxy targets or TLS overrides wrong | Check `client/vite.config.ts` and `VITE_*` overrides |
| Containerized client is up but UI assets fail | nginx template mismatch | Check `client/nginx.dev.conf` and `make logs SVC=arsenale-client` |
| WebAuthn, OAuth, or cookie flows behave oddly on `localhost` | Hostname does not match the configured public URL or RP values | Use the installer-configured hostname such as `arsenale.home.arpa.viti`, or align `CLIENT_URL`, `WEBAUTHN_RP_ID`, and `WEBAUTHN_RP_ORIGIN` |

## 🧩 Feature Flags, Auth, And Bootstrap Problems

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| Login page is missing expected buttons or tabs | `/api/auth/config` disabled that feature family | Inspect `curl http://127.0.0.1:18080/api/auth/config` and check `FEATURE_*`, `CLI_ENABLED`, and `ARSENALE_INSTALL_CAPABILITIES` |
| UI sections disappear after load | Client fail-open defaults were replaced by the server manifest | Treat the server manifest as authoritative and inspect the current install profile |
| Setup wizard appears unexpectedly | Empty DB or dev bootstrap did not run | Check `arsenale-control-plane-api` logs and rerun `make dev` |
| Tenant vault says not initialized on a newly created tenant | Old control-plane container or stale session | Restart the current stack and log in again; new tenants auto-provision tenant vault state |
| Tenant SSH keypair is missing on a new tenant | Bootstrap or tenant-create side effect did not run | Redeploy the current stack and inspect `service dev-bootstrap` output |
| `make status` fails even though containers exist | Installer password mismatch or encrypted artifact drift | Retry with the correct technician password or rerun `make recover` / `make deploy` |

## 🖥 Session And Gateway Issues

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| `/guacamole` fails or shows a black screen | `guacd` unhealthy or target issue | Check `arsenale-guacd` logs and `desktop-broker` health |
| SSH session fails immediately | SSH target, gateway, or credentials wrong | Verify connection settings and `ssh-gateway` health |
| Gateway inventory looks empty | Current install profile has `zeroTrustEnabled` off, or dev bootstrap did not finish | Inspect `/api/auth/config`, then rerun `make dev` if needed |
| Tunneled gateway stays disconnected | Tunnel certs or tunnel-broker state issue | Check `arsenale-dev-tunnel-*` logs and `tunnel-broker` health |
| Managed SSH gateway never becomes usable in dev | Post-bootstrap SSH key push did not complete | Inspect `arsenale-control-plane-api` logs for managed key push retries |

## 🎬 Recording Issues

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| Recordings not appearing | `RECORDING_ENABLED` is `false` | Set `RECORDING_ENABLED=true` and redeploy |
| SSH recording empty or missing | SSH gateway did not write `.cast` file | Check `ssh-gateway` logs and `RECORDING_PATH` permissions |
| Desktop recording black or corrupt | `guacd` recording params misconfigured | Check `guacd` container logs and verify `GUACAMOLE_SECRET` |
| Video export fails | `guacenc` sidecar unreachable or timed out | Check `guacenc` health and `GUACENC_SERVICE_URL` |
| Recording conversion hangs | Large recording or insufficient resources | Increase `GUACENC_TIMEOUT_MS` and check worker resources |
| Old recordings not cleaned up | Retention job not running | Check `recording-worker` logs and `RECORDING_RETENTION_DAYS` |

## 🤖 AI and Query Generation Issues

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| AI tab missing in database UI | `agenticAIEnabled` is off or no tenant/env AI provider is configured | Set `FEATURE_AGENTIC_AI_ENABLED=true` and configure `/api/ai/config` or the `AI_*` env vars |
| "Query generation failed" error | Provider API error, model unavailable, or `control-plane-api` lacks outbound DNS/egress | Check tenant AI settings, `AI_API_KEY`, `AI_BASE_URL`, model name, and `arsenale-control-plane-api` connectivity |
| Daily limit reached | Tenant hit `AI_MAX_REQUESTS_PER_DAY` | Wait for reset or increase the limit |
| Ollama connection refused | Ollama service not running or wrong URL | Verify `AI_BASE_URL` points to the correct Ollama endpoint |

## 🔑 Credential Checkout And Policy Issues

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| Checkout request stuck in PENDING | No admin or operator online to approve | Check notification delivery and admin availability |
| Checkout expired but credentials still accessible | Cleanup job not running | Check `control-plane-controller` logs for checkout expiry reconciliation |
| Keystroke policy not triggering | Policy not enabled or regex mismatch | Verify policy via `/api/keystroke-policies` and test regex against expected input |
| ABAC denied but no time window applies | Policy on a parent scope (team/tenant) is restricting | Check all applicable policies at folder, team, and tenant levels |
| SQL firewall blocking legitimate queries | Overly broad regex pattern | Review `/api/db-audit/firewall-rules` and refine patterns |

## 🗄 Database Query And Migration Issues

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| `No active session to fetch execution plan.` in audit | Old audit entry without stored plan | Enable persisted execution plans on the connection and run a new query |
| Oracle error `ORA-01435: user does not exist` with `CURRENT_SCHEMA = FREEPDB1` | Session config used the Oracle service name as schema | Reopen the session after the fix, or clear `searchPath` when it matches the service name |
| Query blocked by firewall | Built-in or custom SQL firewall matched | Inspect `/api/db-audit/firewall-rules` and the DB audit entry |
| Query throttled | DB rate-limit policy triggered | Inspect `/api/db-audit/rate-limit-policies` and retry later |
| DB session created but host-side DB tunnel is unreachable | Raw DB tunnel flow is different from UI query path | Use `DATABASE` sessions through `db-proxy`; do not treat host DB tunnel reachability as the UI query path |
| Demo DB connection refused | Demo fixture container not healthy | Check `arsenale-dev-demo-postgres`, `-mysql`, `-mongodb`, `-oracle`, or `-mssql` |
| `./scripts/db-migrate.sh` says compose file not found | Stack was never rendered locally, or you are using a non-default compose file | Run `make dev` or set `ARSENALE_COMPOSE_FILE` |
| Migration runs against the wrong service names | Custom compose service naming | Set `ARSENALE_POSTGRES_SERVICE` and `ARSENALE_MIGRATE_SERVICE` before running the script |

Representative direct fixture checks:

```bash
podman exec arsenale-dev-demo-postgres psql -U demo_pg_user -d arsenale_demo -At -c "select count(*) from public.demo_customers; select count(*) from public.demo_products; select count(*) from public.demo_orders;"
podman exec arsenale-dev-demo-mysql mysql -u demo_mysql_user -pDemoMySqlPass123! -D arsenale_demo -Nse "select count(*) from demo_customers; select count(*) from demo_products; select count(*) from demo_orders;"
podman exec arsenale-dev-demo-mongodb mongosh --quiet -u demo_mongo_user -p DemoMongoPass123! --authenticationDatabase arsenale_demo arsenale_demo --eval "print([db.demo_customers.countDocuments({}), db.demo_products.countDocuments({}), db.demo_orders.countDocuments({})].join('|'))"
```

Expected baseline counts after a healthy demo-stack install:

- `demo_customers`: `60`
- `demo_products`: `72`
- `demo_orders`: `180`

## 🧪 Deeper Diagnostics

### Public config

```bash
curl http://127.0.0.1:18080/api/auth/config
```

Use this to confirm the current feature manifest and self-signup state instead of guessing from the UI.

### Acceptance script

```bash
npm run dev:api-acceptance
```

This is the fastest way to determine whether the breakage is UI-only or a real platform regression.

### Database migrations

```bash
./scripts/db-migrate.sh status
./scripts/db-migrate.sh up
```

### CLI smoke

```bash
mkdir -p ./build/go
go build -o ./build/go/arsenale-cli ./tools/arsenale-cli
./build/go/arsenale-cli --server https://localhost:3000 health
./build/go/arsenale-cli --server https://localhost:3000 whoami
./build/go/arsenale-cli --server https://localhost:3000 gateway list
```

## 🔄 Safe Reset Options

Use these in order, from least disruptive to most disruptive:

1. `make logs SVC=...` for the failing service.
2. `make status` to confirm installer state.
3. `make certs` if the symptom is TLS-only.
4. `make recover` if the installer state appears stale or interrupted.
5. `make dev-down && make dev` to recreate the local stack.

Avoid deleting PostgreSQL volumes unless you intentionally want to lose the local application database.

## 🛡 Production Security Checklist

Before deploying to production, verify:

1. `JWT_SECRET` is a unique 64-byte hex value (not `CHANGE_ME`)
2. `GUACAMOLE_SECRET` is a unique 32-byte hex value
3. `SERVER_ENCRYPTION_KEY` is set (not auto-generated)
4. `DATABASE_URL` uses `sslmode=verify-full` with a proper CA cert
5. `COOKIE_SECURE=true` when behind HTTPS
6. `HOST_VALIDATION_ENABLED=true` to prevent DNS rebinding
7. `SELF_SIGNUP_ENABLED=false` unless public registration is intended
8. `TRUST_PROXY` is set to the correct hop count for your reverse proxy chain
9. All `*_FILE` secret variants are used instead of inline env values
10. `RECORDING_ENABLED` is set according to compliance requirements
11. `TUNNEL_STRICT_MTLS=true` for zero-trust gateway deployments
12. Email provider is configured (not dev mode console logging)
13. `WEBAUTHN_RP_ID` and `WEBAUTHN_RP_ORIGIN` match the production domain

For the full checklist, see [security/production.md](security/production.md).
