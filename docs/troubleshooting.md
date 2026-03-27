---
title: Troubleshooting
description: Common errors, debugging techniques, and frequently asked questions
generated-by: claw-docs
generated-at: 2026-03-27T12:00:00Z
source-files:
  - server/src/index.ts
  - server/src/config.ts
  - server/src/utils/logger.ts
  - server/src/middleware/error.middleware.ts
  - server/src/middleware/auth.middleware.ts
  - server/src/middleware/globalRateLimit.middleware.ts
  - client/src/api/client.ts
  - dev-certs/generate.sh
  - Makefile
---

## 🐛 Common Errors

### Database Connection

| Error | Cause | Solution |
|-------|-------|----------|
| `ECONNREFUSED 127.0.0.1:5432` | PostgreSQL not running | Run `make dev` to start containers |
| `FATAL: password authentication failed` | Wrong DB password | Check `vault.yml` or regenerate with `make vault` |
| `SSL connection required` | Missing SSL certs | Ensure `DATABASE_URL` includes `?sslmode=require` |
| `P1001: Can't reach database server` | Prisma can't connect | Verify `DATABASE_URL` in `.env`, check `make status` |
| `P3009: Migration failed` | Schema conflict | Run `npm run db:push` to force-sync, then `npm run db:migrate` |

### TLS and Certificates

| Error | Cause | Solution |
|-------|-------|----------|
| `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | CA not trusted | Set `NODE_EXTRA_CA_CERTS=dev-certs/ca.pem` in `.env` |
| `ERR_CERT_AUTHORITY_INVALID` | Browser doesn't trust dev CA | Import `dev-certs/ca.pem` into browser trust store |
| `DEPTH_ZERO_SELF_SIGNED_CERT` | Self-signed cert without CA | Run `make certs` to regenerate with proper CA chain |
| `certificate has expired` | Expired dev certs | Run `make certs` to regenerate (default: 10-year validity) |
| `ENOENT: dev-certs/server/server-cert.pem` | Missing cert files | Run `./dev-certs/generate.sh` or `make setup` |

### Authentication

| Error | Cause | Solution |
|-------|-------|----------|
| `401 Unauthorized` on every request | Expired or invalid JWT | Check `JWT_SECRET` matches between restarts |
| `403 CSRF validation failed` | CSRF token mismatch | Ensure `X-CSRF-Token` header matches `arsenale-csrf` cookie |
| `403 Account locked` | Too many failed logins | Wait for lockout duration (default: 30 min) or reset via CLI |
| `TOKEN_HIJACK_ATTEMPT` in logs | IP or User-Agent changed | Disable `TOKEN_BINDING_ENABLED` or re-login from new location |
| `429 Too Many Requests` | Rate limit exceeded | Wait for window to expire, or add IP to `RATE_LIMIT_WHITELIST_CIDRS` |

### Server Startup

| Error | Cause | Solution |
|-------|-------|----------|
| `EADDRINUSE :::3001` | Port already in use | The server auto-cleans stale processes in dev; otherwise `kill` the process |
| `JWT_SECRET is required in production` | Missing env var | Set `JWT_SECRET` (64 hex chars) in `.env` or vault |
| `Cannot find module '@prisma/client'` | Prisma not generated | Run `npm run db:generate` |
| `guacd connection refused` | guacd not running | Run `make dev` or check guacd container: `make status` |
| `GUACD_SSL=true but no GUACD_CA_CERT` | TLS misconfigured for guacd | Set `GUACD_CA_CERT` path or disable `GUACD_SSL` |

### Client / Frontend

| Error | Cause | Solution |
|-------|-------|----------|
| Blank page after build | Asset paths wrong | Check `CLIENT_URL` matches actual deployment URL |
| `Mixed Content` errors | HTTP/HTTPS mismatch | Ensure all URLs use HTTPS; check `CLIENT_URL` |
| WebSocket connection failed | Proxy not forwarding | Check Nginx config proxies `/socket.io` and `/guacamole` |
| `CORS error` on API calls | Origin mismatch | Set `CLIENT_URL` to match the exact origin (including port) |
| HMR not working in dev | Vite WebSocket blocked | Check browser dev tools for blocked WebSocket connections |

### RDP/VNC Sessions

| Error | Cause | Solution |
|-------|-------|----------|
| `Guacamole connection failed` | guacd unreachable or creds wrong | Check `make status` for guacd, verify connection credentials |
| Black screen after connect | Display resolution issue | Try different resolution in connection settings |
| `AES decryption failed` | Guacamole secret mismatch | Ensure `GUACAMOLE_SECRET` is consistent between server and guacamole-lite |
| Session disconnects after 24h | WebSocket timeout | Default Nginx timeout is 86400s; check reverse proxy config |

### SSH Sessions

| Error | Cause | Solution |
|-------|-------|----------|
| `Authentication failed` | Wrong credentials | Verify connection username/password or SSH key |
| `Connection refused` | Target SSH server down | Check target host connectivity |
| Terminal garbled output | Encoding mismatch | Set terminal encoding to UTF-8 in connection settings |
| `ALLOW_LOCAL_NETWORK is false` | Blocked RFC 1918 target | Set `ALLOW_LOCAL_NETWORK=true` or `ALLOW_LOOPBACK=true` |

## 🔍 Debugging Techniques

### Enable Verbose Logging

```bash
# In .env
LOG_LEVEL=debug
LOG_HTTP_REQUESTS=true
LOG_GUACAMOLE=true
```

**Log levels:** `error` < `warn` < `info` < `verbose` < `debug`

### Structured JSON Logs

For log aggregation (ELK, Datadog, etc.):

```bash
LOG_FORMAT=json
```

### View Container Logs

```bash
make logs              # All services
make logs SVC=server   # Server only
make logs SVC=guacd    # guacd only
make logs SVC=postgres # PostgreSQL only
```

### Check Service Health

```bash
# Container status
make status

# API health check
curl -k https://localhost:3001/api/health

# Readiness check (includes DB, guacd)
curl -k https://localhost:3001/api/ready
```

### Database Debugging

```bash
# Connect directly to PostgreSQL
psql "$DATABASE_URL"

# Check Prisma schema sync
npx prisma db pull    # Pull current DB schema
npx prisma validate   # Validate schema.prisma
```

### Network Debugging

```bash
# Test guacd connectivity
nc -zv localhost 4822

# Test gocache connectivity
nc -zv localhost 6380

# Test PostgreSQL connectivity
pg_isready -h localhost -p 5432
```

### Reset Development Environment

```bash
make dev-down          # Stop containers
make clean             # Remove everything
make setup             # Regenerate vault + certs
make dev               # Fresh start
npm run db:push        # Sync schema
```

## ❓ FAQ

### How do I reset the admin password?

Use the CLI tool:

```bash
npm run cli:dev -- user reset-password --email admin@example.com
```

Requires `CLI_ENABLED=true` in `.env`.

### How do I add a new OAuth provider?

1. Set the provider's env vars (e.g., `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`)
2. Restart the server (or use the live reload system via Settings UI)
3. The login page will automatically show the new provider

### How do I enable session recording?

Set in `.env`:
```bash
RECORDING_ENABLED=true
RECORDING_PATH=/recordings
```

For video conversion, deploy the guacenc container and set `GUACENC_SERVICE_URL`.

### How do I connect to hosts on the local network?

By default, `ALLOW_LOCAL_NETWORK=true` in development. For production:
```bash
ALLOW_LOCAL_NETWORK=true   # RFC 1918 addresses (10.x, 172.16-31.x, 192.168.x)
ALLOW_LOOPBACK=true        # 127.x, ::1 (opt-in, default false)
```

### How do I scale to multiple server instances?

1. Set `arsenale_server_replicas` in Ansible vars
2. Ensure `CACHE_SIDECAR_ENABLED=true` (required for distributed state)
3. GoCacheKV handles rate limits, session state, and Socket.IO events across instances
4. Leader election ensures singleton jobs run on one instance only

### How do I rotate secrets?

```bash
make rotate            # Rotate JWT, Guacamole, and encryption keys
```

This generates new secrets, updates the vault, and restarts affected services.

### Why does my browser show a certificate warning?

Development uses self-signed certificates. Options:
1. Import `dev-certs/ca.pem` into your browser's trust store
2. Click "Advanced" -> "Proceed anyway" (not recommended for production)
3. Set `NODE_EXTRA_CA_CERTS=dev-certs/ca.pem` for Node.js processes

### How do I debug rate limiting?

Check the response headers:
```
RateLimit-Limit: 200
RateLimit-Remaining: 150
RateLimit-Reset: 1711540800
```

To bypass in development, add your IP to `RATE_LIMIT_WHITELIST_CIDRS`.

### Where are audit logs stored?

Audit logs are stored in the `AuditLog` table in PostgreSQL. Access via:
- **UI**: Settings -> Audit Log
- **API**: `GET /api/audit` or `GET /api/audit/tenant`
- **Direct SQL**: `SELECT * FROM "AuditLog" ORDER BY "createdAt" DESC LIMIT 100;`

### How do I enable the database proxy?

The database proxy is enabled by default (`FEATURE_DATABASE_PROXY_ENABLED=true`). To use it:
1. Create a connection with type `DATABASE` or `DB_TUNNEL`
2. Specify the target database host, port, and type (PostgreSQL, MySQL, etc.)
3. Optionally configure a bastion connection for tunneling
