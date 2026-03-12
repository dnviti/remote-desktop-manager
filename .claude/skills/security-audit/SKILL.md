---
name: security-audit
description: Perform a security audit of the codebase and generate a report with findings and remediation steps.
disable-model-invocation: true
argument-hint: "[scope: auth|encryption|api|client|dependencies|config|infrastructure|code]"
---

# Security Audit

You are a senior application security engineer performing a structured audit of the Arsenale codebase. You will analyze the code for vulnerabilities, misconfigurations, and security best-practice violations, then produce a professional report.

## Scope

The user requested audit scope: **$ARGUMENTS**

If the scope is empty or "full", run ALL audit sections below. Otherwise, run only the matching section(s). Valid scopes: `auth`, `encryption`, `api`, `client`, `dependencies`, `config`, `infrastructure`, `code`. Multiple scopes can be comma-separated (e.g., `auth,encryption`).

---

## Data Collection

The following data is gathered automatically for your analysis.

### Project structure
!`ls server/src/services/ server/src/middleware/ server/src/routes/ server/src/controllers/ server/src/socket/ 2>/dev/null`

### Package versions (server)
!`cat server/package.json | grep -E '"(express|jsonwebtoken|bcrypt|argon2|socket.io|prisma|ssh2|guacamole-lite|zod|cors|dotenv|uuid|helmet|express-rate-limit)"' 2>/dev/null`

### Package versions (client)
!`cat client/package.json | grep -E '"(react|axios|socket.io-client|zustand|guacamole-common-js)"' 2>/dev/null`

### Dependency audit (server)
!`cd server && npm audit --json 2>/dev/null | head -120`

### Dependency audit (client)
!`cd client && npm audit --json 2>/dev/null | head -120`

### Server configuration
!`cat server/src/config.ts 2>/dev/null`

### Environment example
!`cat .env.example 2>/dev/null`

### Authentication service
!`cat server/src/services/auth.service.ts 2>/dev/null`

### Auth middleware
!`cat server/src/middleware/auth.middleware.ts 2>/dev/null`

### Auth controller
!`cat server/src/controllers/auth.controller.ts 2>/dev/null`

### Auth routes
!`cat server/src/routes/auth.routes.ts 2>/dev/null`

### Encryption service
!`cat server/src/services/crypto.service.ts 2>/dev/null`

### Vault service
!`cat server/src/services/vault.service.ts 2>/dev/null`

### RDP service
!`cat server/src/services/rdp.service.ts 2>/dev/null`

### Express app setup
!`cat server/src/app.ts 2>/dev/null`

### Server entry point
!`cat server/src/index.ts 2>/dev/null`

### Socket.IO setup
!`cat server/src/socket/index.ts 2>/dev/null`

### SSH handler
!`cat server/src/socket/ssh.handler.ts 2>/dev/null`

### Client auth store
!`cat client/src/store/authStore.ts 2>/dev/null`

### Client API client
!`cat client/src/api/client.ts 2>/dev/null`

### User service
!`cat server/src/services/user.service.ts 2>/dev/null`

### Error middleware
!`cat server/src/middleware/error.middleware.ts 2>/dev/null`

### Server types
!`cat server/src/types/index.ts 2>/dev/null`

### Docker (dev)
!`cat docker-compose.dev.yml 2>/dev/null`

### Docker (prod)
!`cat docker-compose.yml 2>/dev/null`

### Gitignore (secrets coverage)
!`cat .gitignore 2>/dev/null | grep -iE "\.env|secret|credential|\.pem|\.key" || echo "NO_MATCHES: No secret-related gitignore entries found"`

### Security middleware search
!`grep -rn "helmet\|csp\|content-security-policy\|rate.limit\|express-rate\|express-slow" server/src/ --include="*.ts" 2>/dev/null || echo "NO_MATCHES: No security middleware (helmet, rate-limit, CSP) found"`

### Cookie security search
!`grep -rn "httpOnly\|secure\|sameSite\|cookie" server/src/ --include="*.ts" 2>/dev/null || echo "NO_MATCHES: No cookie security configuration found"`

### Dangerous HTML patterns (client)
!`grep -rn "dangerouslySetInnerHTML\|innerHTML\|__html\|v-html" client/src/ --include="*.tsx" --include="*.ts" 2>/dev/null || echo "NO_MATCHES: No dangerous HTML injection patterns found"`

### Browser storage usage (client)
!`grep -rn "localStorage\|sessionStorage" client/src/ --include="*.tsx" --include="*.ts" 2>/dev/null || echo "NO_MATCHES: No browser storage usage found"`

### Command execution patterns (server)
!`grep -rn "exec\|spawn\|child_process\|eval(" server/src/ --include="*.ts" 2>/dev/null || echo "NO_MATCHES: No command execution patterns found"`

### Raw SQL queries (server)
!`grep -rn "\.query\|rawQuery\|\$queryRaw\|\$executeRaw" server/src/ --include="*.ts" 2>/dev/null || echo "NO_MATCHES: No raw SQL queries found"`

### Input validation coverage
!`grep -rn "z\.object\|z\.string\|z\.number\|z\.enum\|\.parse(\|\.safeParse(" server/src/controllers/ --include="*.ts" 2>/dev/null`

### Route parameter usage
!`grep -rn "req\.params\.\|req\.query\." server/src/controllers/ --include="*.ts" 2>/dev/null`

### Files handling passwords/secrets
!`grep -rn "password\|secret\|key\|token" server/src/ --include="*.ts" -l 2>/dev/null`

### Sharing service
!`cat server/src/services/sharing.service.ts 2>/dev/null`

### Connection service
!`cat server/src/services/connection.service.ts 2>/dev/null`

### PrismaClient instantiation count
!`grep -rn "new PrismaClient" server/src/ --include="*.ts" 2>/dev/null || echo "NO_MATCHES: No PrismaClient instantiation found"`

---

## Audit Checklist

Analyze ALL collected data above against each category. For each finding, assign a severity and document it precisely. Only report findings you have clear evidence for — no speculation.

### 1. DEPENDENCIES (scope: `dependencies`)
*MITRE ATT&CK: T1195 (Supply Chain Compromise), T1190 (Exploit Public-Facing Application)*

Check for:
- Known CVEs from `npm audit` output
- Outdated packages with known security issues
- Missing security packages: `helmet` (HTTP headers), `express-rate-limit` (brute-force), `cors` misconfig
- Unnecessary dependencies that increase attack surface

### 2. AUTHENTICATION (scope: `auth`)
*MITRE ATT&CK: T1078 (Valid Accounts), T1110 (Brute Force), T1528 (Steal Application Access Token)*

Check for:
- **MITRE T1078 (Valid Accounts)**: Check for weak default passwords, lack of MFA enforcement, or missing account lockout/brute-force protection on all auth endpoints.
- **MITRE T1110 (Brute Force)**: Ensure strict rate limiting and progressive delays are applied to login, token refresh, and MFA verification endpoints.
- **MITRE T1563 (Session Hijacking)**: Check if JWT tokens are bound to client IP/User-Agent. Are tokens rotated? Can a stolen token be used from anywhere?
- **JWT secret strength**: Is there a weak fallback secret (e.g., `'dev-secret-change-me'`)? Could it silently activate in production if `JWT_SECRET` env var is missing?
- **Algorithm pinning**: Does token verification specify allowed algorithms?
- **Password policy**: Is the minimum length sufficient? Is complexity enforced?
- **Hashing cost factor**: Are hash rounds/parameters adequate (>= 10 for bcrypt, adequate Argon2 parameters)?
- **Refresh token rotation**: After a refresh token is used, is the old one invalidated? (Prevents token reuse/replay.)
- **Brute-force protection**: Are login/register endpoints rate-limited?
- **Token storage (client)**: Where are tokens stored? `localStorage` is XSS-accessible.
- **Account enumeration**: Do error messages distinguish "user not found" vs "wrong password"?
- **Logout completeness**: Are all tokens and sessions invalidated on logout?
- **Socket.IO auth**: Is JWT validation applied to WebSocket connections?

### 3. ENCRYPTION (scope: `encryption`)
*MITRE ATT&CK: T1557 (Adversary-in-the-Middle), T1552 (Unsecured Credentials)*

Check for:
- **MITRE T1552 (Unsecured Credentials)**: Are credentials stored securely? Is the vault master key zeroed out in memory after use? Are there checks against known breached passwords?
- **Algorithm suitability**: AES-256-GCM (vault) vs AES-256-CBC (Guacamole) — is CBC used without authentication (HMAC)?
- **IV/nonce generation**: Are they generated with `crypto.randomBytes()` and unique per operation?
- **Key derivation**: Argon2 parameters (memory, time, parallelism) — are they adequate per OWASP recommendations?
- **Master key lifecycle**: Is `buffer.fill(0)` called on all code paths after use? Check for missed paths.
- **Buffer copying**: Does `Buffer.from(masterKey)` create independent copies or references?
- **Guacamole key derivation**: Is `SHA-256(secret)` used as an encryption key directly? Is the source secret strong enough?
- **In-memory key exposure**: Could heap dumps leak master keys from the vault store?

### 4. API SECURITY (scope: `api`)
*MITRE ATT&CK: T1190 (Exploit Public-Facing Application), T1499 (Endpoint Denial of Service)*

Check for:
- **MITRE T1021 (Remote Services - Lateral Movement)**: Are there anomaly detection mechanisms for unusual connection patterns (e.g., rapid connections to multiple hosts)?
- **MITRE T1190 (Exploit Public-Facing Application)**: Are all endpoints protected against injection, CSRF, and unexpected payloads?
- **Input validation coverage**: Are ALL endpoints using Zod validation? Which endpoints are missing it?
- **Request size limits**: Is the JSON body limit appropriate?
- **CORS configuration**: Is the origin hardcoded? Is it configurable for production?
- **Security headers**: Missing `helmet` means no X-Frame-Options, X-Content-Type-Options, HSTS, etc.
- **Rate limiting**: Are auth endpoints protected against brute force?
- **Error information leakage**: Does the error handler expose stack traces in production?
- **Route parameter validation**: Are `req.params.id` values validated as UUIDs before use?
- **CSRF**: Bearer token auth is CSRF-resistant — confirm no cookie-based auth paths exist.

### 5. CLIENT SECURITY (scope: `client`)
*MITRE ATT&CK: T1059.007 (JavaScript), T1185 (Browser Session Hijacking)*

Check for:
- **XSS vectors**: `dangerouslySetInnerHTML`, `innerHTML`, unescaped user input in React JSX
- **Token storage**: Zustand `persist` to `localStorage` — refresh tokens in localStorage are XSS-accessible
- **Sensitive data in state**: Do any stores hold decrypted passwords or master keys?
- **Content Security Policy**: Is CSP configured?
- **Source maps**: Does the Vite production build include source maps?
- **Raw error display**: Are server error messages shown directly to users?

### 6. CONFIGURATION (scope: `config`)
*MITRE ATT&CK: T1552.001 (Credentials In Files), T1562.001 (Disable or Modify Tools)*

Check for:
- **Default secrets**: Fallback values like `'dev-secret-change-me'` in config.ts that silently activate when env vars are missing
- **Environment validation**: Are required env vars validated at startup with clear errors?
- **Gitignore coverage**: Are `.env`, `.env.production`, and secret files properly excluded?
- **Production Docker secrets**: Does docker-compose enforce required secrets?
- **Log level**: Could debug logging in production leak sensitive data?

### 7. INFRASTRUCTURE (scope: `infrastructure`)
*MITRE ATT&CK: T1610 (Deploy Container), T1613 (Container and Resource Discovery)*

Check for:
- **Docker security**: Are containers running as non-root? Are images pinned to specific versions/digests?
- **Network exposure**: Are database and internal service ports exposed to the host in production?
- **HTTPS/TLS**: Is TLS termination configured? Reverse proxy setup?
- **Guacamole WebSocket**: Is port 3002 accessible without authentication?
- **Database credentials**: Default dev credentials that could leak to production
- **guacd container configuration**: Is the Guacamole daemon properly isolated and secured?

### 8. CODE QUALITY (scope: `code`)
*MITRE ATT&CK: T1059 (Command and Scripting Interpreter), T1203 (Exploitation for Client Execution)*

Check for:
- **SQL injection**: Any `$queryRaw` / `$executeRaw` with string interpolation? Prisma ORM query injection vectors?
- **Command injection**: Any `exec`, `spawn`, `child_process` with unsanitized input?
- **Path traversal**: File operations using user-controlled input?
- **PrismaClient instances**: Multiple `new PrismaClient()` causing connection pool issues?
- **Timing attacks**: Are secret comparisons using constant-time functions (`crypto.timingSafeEqual`)?
- **Unhandled rejections**: Missing error handling on async operations?
- **TypeScript `any`**: Unsafe type assertions bypassing compile-time safety?
- **Express middleware chain**: Are middleware applied in the correct order? Any gaps in the auth middleware coverage?
- **Vite proxy configuration**: Could the dev proxy be exploited in production?

---

## Report Format

After analysis, write the complete report to `security-report.md` in the project root using this structure:

```markdown
# Security Audit Report — Arsenale

**Date:** YYYY-MM-DD
**Scope:** [Full / specific scope]
**Auditor:** Claude Code Security Audit Skill

## Executive Summary

[2-4 sentences: overall security posture, most critical findings, top priorities.]

**Risk Distribution:**
| Severity | Count |
|----------|-------|
| CRITICAL | N     |
| HIGH     | N     |
| MEDIUM   | N     |
| LOW      | N     |
| INFO     | N     |

---

## Findings

### [SEVERITY] FINDING-NNN: Title

**Category:** [Dependencies | Authentication | Encryption | API Security | Client Security | Configuration | Infrastructure | Code Quality]
**Location:** `path/to/file.ts:NN`
**Status:** Open

**Description:**
[Clear explanation of the vulnerability. Include the relevant code snippet if helpful.]

**Impact:**
[What could an attacker do if this is exploited?]

**Remediation:**
[Specific steps to fix. Include code snippets where possible.]

**References:**
- [Link to OWASP, CVE, or best-practice documentation]

---

[Repeat for each finding, ordered by severity: CRITICAL first, INFO last]

## Positive Findings

List security strengths observed in the codebase (e.g., AES-256-GCM, Argon2, Zod validation, memory zeroing).

## Recommendations Summary

Priority actions ordered by impact:

1. **[CRITICAL/HIGH]** — One-sentence summary
2. ...

## Methodology

This audit was performed through static analysis of the source code, dependency scanning, and configuration review. It does not include dynamic testing (penetration testing). Findings should be validated in a running environment.
```

---

## Final Instructions

1. **Be thorough** — analyze every piece of collected data.
2. **Be precise** — include file paths and line numbers for every finding.
3. **Be actionable** — every finding must have concrete remediation steps with code snippets.
4. **Be fair** — acknowledge security strengths in the "Positive Findings" section.
5. **Avoid false positives** — only report what you have evidence for in the collected data.
6. **Number findings** sequentially: FINDING-001, FINDING-002, etc.
7. **Save the report** to `security-report.md` in the project root.
8. **Summarize to the user** — after saving, print the executive summary and risk distribution table, then tell the user the full report is at `security-report.md`.
