---
title: Troubleshooting
description: Common errors, debugging tips, and frequently asked questions
generated-by: ctdf-docs
generated-at: 2026-03-21T19:50:00Z
source-files:
  - server/src/index.ts
  - server/src/middleware/error.middleware.ts
  - server/src/middleware/auth.middleware.ts
  - client/src/api/auth.api.ts
  - server/src/config.ts
  - server/src/services/keystrokeInspection.service.ts
  - .env.example
---

# Troubleshooting

## Startup Issues

### Database Connection Failed

**Error:** `Can't reach database server at localhost:5432`

**Causes and fixes:**
1. PostgreSQL container not running: `npm run docker:dev`
2. Wrong `DATABASE_URL` in `.env`: verify host, port, credentials
3. Port conflict: `sudo lsof -i :5432` to check
4. Docker/Podman not running: start Docker daemon

### Prisma Migration Failed

**Error:** `Error: P3009: migrate found failed migrations`

**Fix:** Check `server/prisma/migrations/` for failed migration. If in development:
```bash
npm run db:push    # Force-sync schema (drops data)
```

For production, investigate the specific migration error and fix the SQL.

### Port Already in Use

**Error:** `EADDRINUSE: address already in use :::3001`

**Fix:**
```bash
# Find and kill the process
lsof -i :3001
kill <PID>
```

Common ports: 3000 (client), 3001 (server), 3002 (Guacamole WS), 5432 (PostgreSQL).

### .env File Not Found

**Error:** `Error: .env file not found`

**Fix:** The `.env` file must be at the **monorepo root**, not inside `server/` or `client/`:
```bash
cp .env.example .env
```

### Prisma Client Not Generated

**Error:** `@prisma/client did not initialize yet`

**Fix:**
```bash
npm run db:generate
```

This is automatically done by `npm run predev`.

## Authentication Issues

### JWT Token Expired

**Error:** `401 Unauthorized` on API calls

**How it works:** Access tokens expire after 15 minutes (default). The Axios client interceptor automatically refreshes tokens on 401. If refresh also fails, the user is redirected to login.

**If tokens keep expiring:**
- Check `JWT_EXPIRES_IN` and `JWT_REFRESH_EXPIRES_IN` in `.env`
- Verify server clock is synchronized
- Check for `TOKEN_HIJACK_ATTEMPT` in audit logs (IP/User-Agent mismatch)

### CSRF Token Mismatch

**Error:** `403 Forbidden: CSRF token mismatch`

**Causes:**
- Browser cookies blocked or cleared
- Cross-origin request without proper CSRF header
- Extension client not sending `Authorization: Bearer` header (extension clients bypass CSRF)

**Fix:** Ensure the client sends the CSRF token from cookies in the `x-csrf-token` header.

### OAuth Callback Error

**Error:** OAuth redirect fails or loops

**Causes:**
- `CLIENT_URL` in `.env` doesn't match the actual client URL
- OAuth callback URL in provider settings doesn't match
- Missing or wrong `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_SECRET`, etc.

### Microsoft OAuth Returns "User Not In Tenant"

**Error:** Microsoft login fails with tenant validation error

**Cause:** `MICROSOFT_TENANT_ID` is set to a specific Azure AD tenant ID, but the user's account belongs to a different tenant.

**Fix:** Set `MICROSOFT_TENANT_ID=common` in `.env` to allow any Microsoft account, or verify the tenant ID matches your Azure AD directory. Default is `common` (all Microsoft accounts accepted).

### Google OAuth Rejects Users Outside Domain

**Error:** Google login fails for users not in the expected domain

**Cause:** `GOOGLE_HD` (hosted domain) is set to restrict login to a specific Google Workspace domain.

**Fix:** Clear `GOOGLE_HD` in `.env` to allow any Google account, or set it to your organization's domain (e.g., `GOOGLE_HD=example.com`). When set, only users with an email in that domain can authenticate via Google OAuth.

### Account Lockout

**Error:** `Account locked` after too many failed attempts

**Default:** 10 failed attempts → 30 minute lockout.

**Fix:** Wait for lockout to expire, or adjust `ACCOUNT_LOCKOUT_THRESHOLD` and `ACCOUNT_LOCKOUT_DURATION_MS` in `.env`.

### Self-Signup Not Working

**Error:** Registration page not available or returns `403 Forbidden`

**Cause:** Self-signup is disabled by default (`SELF_SIGNUP_ENABLED=false`). The admin must create user accounts.

**Fix:** Either create accounts from the admin panel, or enable self-signup:
- Set `SELF_SIGNUP_ENABLED=true` in `.env`, or
- Toggle the setting in **Settings → System Settings** in the admin panel

### Email Verification Blocking Login

**Error:** User cannot log in because email is not verified, but no verification email was received

**Cause:** Email verification is disabled by default (`EMAIL_VERIFY_REQUIRED=false`). If it has been enabled without configuring an email provider, verification emails cannot be sent.

**Fix:** Either disable email verification (`EMAIL_VERIFY_REQUIRED=false`) or configure an email provider (SMTP, SendGrid, SES, Resend, or Mailgun) in `.env`. See [Configuration — Email](configuration.md#email).

## Vault Issues

### Vault Won't Unlock

**Error:** `Invalid password` on vault unlock

**Causes:**
- Wrong password (master key derived from password via Argon2)
- Vault not initialized (first-time users need vault setup)
- Corrupted vault data

**Alternative:** Use MFA-based vault unlock if TOTP/WebAuthn/SMS is configured.

### Vault Auto-Locks Too Quickly

**Configuration:** `VAULT_TTL_MINUTES` (default: 30). Set to `0` for never-auto-lock.

Users can also set per-user auto-lock via `PUT /api/vault/auto-lock`.

## Connection Issues

### SSH Connection Fails

**Error:** `SSH connection error` in terminal

**Debugging:**
1. Verify target host is reachable from the server
2. Check credentials are correct (vault must be unlocked)
3. If using a gateway, verify gateway health in the Gateway Manager
4. Check `ALLOW_LOCAL_NETWORK` if connecting to private IPs (default: `true`)
5. Check DLP policies if copy/paste is blocked

### RDP/VNC Black Screen

**Error:** RDP connects but shows nothing

**Causes:**
1. `guacd` not running: check container health (`nc -z localhost 4822`)
2. Wrong Guacamole secret: verify `GUACAMOLE_SECRET` matches between server and guacd
3. Target RDP/VNC service not accepting connections
4. Firewall blocking port 3389 (RDP) or 5900 (VNC) on target

### RDP Clipboard Not Working

**Possible causes:**
- DLP policy `dlpDisableCopy` or `dlpDisablePaste` enabled on tenant or connection
- Guacamole connection settings don't include clipboard
- Browser permissions blocking clipboard access

### Session Recording Not Working

**Configuration:**
- `RECORDING_ENABLED=true` in `.env`
- `RECORDING_PATH` must be writable
- `guacenc` container must be running for video export

### Gateway Shows "Unreachable"

**Debugging:**
1. Check gateway container is running
2. Test network connectivity from server to gateway
3. For tunnel-based gateways, verify tunnel agent is connected
4. Check `TUNNEL_SERVER_URL`, `TUNNEL_TOKEN`, `TUNNEL_GATEWAY_ID` on the agent

## Build and Type Errors

### TypeScript Errors After Schema Change

**Fix:** Regenerate Prisma client:
```bash
npm run db:generate
```

### ESLint Errors in New Code

**Fix:**
```bash
npm run lint:fix   # Auto-fix what's possible
```

Common issues:
- `no-console` in server code (use the logger utility)
- Missing React hook dependencies
- `@typescript-eslint/no-explicit-any` (use proper types)

### Build Fails with Chunk Size Warning

Vite warns at 700 KB chunk size. The manual chunk splitting in `client/vite.config.ts` handles most cases. If you import a large library, add it to the manual chunks configuration.

## Docker Issues

### Docker Socket Permission Denied

**Error:** `permission denied while trying to connect to the Docker daemon socket`

**Fix:**
```bash
# Add user to docker group
sudo usermod -aG docker $USER
# Re-login or:
newgrp docker
```

For Podman, ensure the socket path is correct: `PODMAN_SOCKET_PATH=$XDG_RUNTIME_DIR/podman/podman.sock`

### Container Orchestration Not Working

**Error:** `Orchestrator type not detected`

**Fix:** Set `ORCHESTRATOR_TYPE` explicitly in `.env`:
- `docker` — Docker socket at `/var/run/docker.sock`
- `podman` — Podman socket
- `kubernetes` — In-cluster or kubeconfig
- `none` — Disable managed gateways

### PostgreSQL Data Lost After Restart

**Cause:** Volume not persisted.

**Fix:** Ensure `pgdata` volume is defined in compose file (it is by default in both `compose.yml` and `compose.dev.yml`).

## Network Issues

### CORS Errors in Browser

**Error:** `Access-Control-Allow-Origin` header missing

**Fix:** Set `CLIENT_URL` in `.env` to match exactly the URL in the browser address bar (including port).

### WebSocket Connection Failed

**Error:** Socket.IO or Guacamole WebSocket can't connect

**Causes:**
1. Client proxy not configured (check `client/vite.config.ts` proxy settings)
2. In production, Nginx proxy config missing WebSocket upgrade headers
3. Firewall or reverse proxy blocking WebSocket upgrade

**Vite proxy override:** Set `VITE_API_TARGET` environment variable to override the default proxy target.

### Impossible Travel False Positives

**Fix:** Adjust `IMPOSSIBLE_TRAVEL_SPEED_KMH` in `.env` (default: 900 km/h). Set to `0` to disable.

## Performance

### Slow API Responses

**Debugging:**
1. Enable `LOG_HTTP_REQUESTS=true` to see request timing
2. Check database query performance with `npx prisma studio`
3. Verify PostgreSQL has adequate resources
4. Check for missing database indexes

### High Memory Usage

**Common causes:**
1. Large number of concurrent SSH sessions (each holds a stream buffer)
2. Vault sessions accumulating (check `VAULT_TTL_MINUTES`)
3. Node.js default heap size too low: `NODE_OPTIONS=--max-old-space-size=4096`

## Keystroke Policy Issues

### Policy Not Matching

**Symptom:** SSH commands not being caught by keystroke policies.

**Causes and fixes:**
1. Policy not enabled: verify `enabled: true` in policy settings
2. Regex pattern error: check pattern validity in the API response
3. Cache delay: policies refresh every 30 seconds — wait and retry
4. ReDoS safety: patterns with nested quantifiers are automatically rejected

### Session Terminated Unexpectedly

**Symptom:** SSH session closed with "input matched a security policy rule"

**Cause:** A `BLOCK_AND_TERMINATE` keystroke policy matched the entered command.

**Fix:** Review keystroke policies in Settings → Keystroke Policies. Check audit log for the matched pattern.

## Database Connection Issues

### Database Proxy Not Connecting

**Symptom:** Database sessions fail to establish via the proxy gateway.

**Causes and fixes:**
1. DB proxy container not running: check gateway status in Settings → Gateways
2. Wrong protocol ports: verify Oracle (1521), MSSQL (1433), DB2 (50000) configuration
3. Network connectivity: ensure the proxy container can reach the target database server

## FAQ

**Q: Can I use MySQL instead of PostgreSQL?**
A: No. The Prisma schema uses PostgreSQL-specific features (enums, UUID generation, JSON columns).

**Q: Can I run without Docker?**
A: You need PostgreSQL accessible somewhere. `guacd` is required for RDP/VNC. SSH-only setups can skip guacd.

**Q: How do I reset my vault password?**
A: If recovery keys were generated during vault setup, use them. Otherwise, the vault must be re-initialized (credentials will be lost).

**Q: How do I add a new OAuth provider?**
A: Set the provider's `CLIENT_ID` and `CLIENT_SECRET` in `.env`. The server auto-detects configured providers.

**Q: Why are my connections not showing after login?**
A: The vault must be unlocked to decrypt connection credentials. Check vault status.

**Q: How do I debug WebSocket issues?**
A: Enable `LOG_GUACAMOLE=true` in `.env`. For Socket.IO, set `LOG_LEVEL=debug`.
