# Security Audit Report — Arsenale

**Date:** 2026-03-10
**Scope:** Full
**Auditor:** Claude Code Security Audit Skill

## Executive Summary

The Arsenale codebase demonstrates a strong security posture overall, featuring robust authentication mechanisms, proper `HttpOnly` cookie token storage, and secure defaults for core vault encryption using AES-256-GCM and Argon2id. However, critical and high severity issues were identified in the VNC service's encryption implementation, including the use of AES-256-CBC without authentication and weak key derivation compared to the RDP service. Furthermore, configuration defaults may silently activate weak secrets if `NODE_ENV` is misconfigured. Remediation of the encryption discrepancies in the VNC service should be the top priority.

**Risk Distribution:**
| Severity | Count |
|----------|-------|
| CRITICAL | 1     |
| HIGH     | 1     |
| MEDIUM   | 2     |
| LOW      | 0     |
| INFO     | 1     |

---

## Findings

### [CRITICAL] FINDING-001: Weak Cryptographic Algorithm (AES-256-CBC) in VNC Token Generation

**Category:** Encryption
**Location:** `server/src/services/vnc.service.ts:99`
**Status:** Open

**Description:**
The VNC service generates Guacamole connection tokens using the `aes-256-cbc` algorithm without computing or appending a Message Authentication Code (MAC/HMAC). This exposes the application to Padding Oracle attacks. Furthermore, the `rdp.service.ts` correctly uses `aes-256-gcm` with auth tags, and `index.ts` patches Guacamole-lite to expect AES-256-GCM. The mismatch indicates the VNC service is using an insecure, outdated cryptographic pipeline that lacks data integrity verification.

**Impact:**
An attacker who can intercept or manipulate the encrypted VNC token may be able to forge or decrypt connection parameters using padding oracle attacks, potentially leading to unauthorized VNC access.

**Remediation:**
Update `vnc.service.ts` to use `aes-256-gcm`, mirroring the secure implementation found in `rdp.service.ts`.

```typescript
// Replace:
// const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
// let encrypted = cipher.update(data, 'utf8', 'binary');
// encrypted += cipher.final('binary');

// With:
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
let encrypted = cipher.update(data, 'utf8', 'binary');
encrypted += cipher.final('binary');
const tag = cipher.getAuthTag();

const tokenObj = {
  iv: iv.toString('base64'),
  value: Buffer.from(encrypted, 'binary').toString('base64'),
  tag: tag.toString('base64'),
};
```

**References:**
- [OWASP Cryptographic Failures](https://owasp.org/Top10/A02_2021-Cryptographic_Failures/)
- [Padding Oracle Attacks](https://en.wikipedia.org/wiki/Padding_oracle_attack)

---

### [HIGH] FINDING-002: Weak Key Derivation for VNC Guacamole Tokens

**Category:** Encryption
**Location:** `server/src/services/vnc.service.ts:26-28`
**Status:** Open

**Description:**
The VNC service derives its encryption key from the `guacamoleSecret` using a single, unsalted SHA-256 hash iteration: `crypto.createHash('sha256').update(config.guacamoleSecret).digest()`. In contrast, the RDP service correctly uses `scryptSync` with a salt and high cost factors (`N: 16384, r: 8, p: 1`) to derive its key. 

**Impact:**
If the `guacamoleSecret` is weak or leaks, the unsalted SHA-256 hash can be easily reversed using rainbow tables or offline dictionary attacks, compromising the encryption keys for VNC tokens.

**Remediation:**
Standardize the key derivation function across both services. Replace the SHA-256 hash in `vnc.service.ts` with the `scryptSync` implementation used in `rdp.service.ts`.

```typescript
// Replace:
function getGuacamoleKey(): Buffer {
  return crypto.createHash('sha256').update(config.guacamoleSecret).digest();
}

// With:
function getGuacamoleKey(): Buffer {
  return crypto.scryptSync(config.guacamoleSecret, 'arsenale-guac-salt', 32, { N: 16384, r: 8, p: 1 });
}
```

**References:**
- [OWASP Password Storage Cheat Sheet - Key Derivation](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)

---

### [MEDIUM] FINDING-003: Weak Default Secrets Silently Active on Missing NODE_ENV

**Category:** Configuration
**Location:** `server/src/config.ts:36-53`
**Status:** Open

**Description:**
The application relies on `process.env.NODE_ENV` to enforce secure configuration rules (e.g., throwing an error if `JWT_SECRET` is missing in production). However, `config.ts` defaults `nodeEnv` to `'development'` if `NODE_ENV` is unset (`process.env.NODE_ENV || 'development'`). If a production deployment accidentally omits the `NODE_ENV` environment variable, the application will silently start in development mode, utilizing weak hardcoded fallback secrets like `'dev-secret-change-me'` and `'dev-guac-secret'`.

**Impact:**
An operational mistake (missing environment variable) can result in the production environment running with publicly known, hardcoded secrets, completely compromising JWT authentication and Guacamole token encryption.

**Remediation:**
Require explicit environment declaration or strictly validate missing secrets regardless of the environment fallback. Do not allow hardcoded secrets to be used unless explicitly requested via an environment variable flag (e.g., `ALLOW_INSECURE_SECRETS=true`).

```typescript
const secret = process.env.JWT_SECRET;
if (!secret) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required in production');
  }
  console.warn('WARNING: Using weak fallback JWT_SECRET. Do not use in production!');
}
return secret || 'dev-secret-change-me';
```

**References:**
- [OWASP Security Misconfiguration](https://owasp.org/Top10/A05_2021-Security_Misconfiguration/)

---

### [MEDIUM] FINDING-004: In-Memory Master Key Exposure (TTL Window)

**Category:** Encryption
**Location:** `server/src/services/crypto.service.ts:203-210`
**Status:** Open

**Description:**
The application stores the decrypted user `masterKey` Buffer in the Node.js memory (`vaultStore` Map) for the duration of the Vault TTL (default 30 minutes, or indefinitely if accessed frequently). While the buffer is properly zeroed out upon explicit locking or TTL expiration via `session.masterKey.fill(0)`, the key remains resident in memory for extended periods while the vault is "unlocked."

**Impact:**
If an attacker gains arbitrary memory read capabilities (e.g., via a V8 vulnerability, path traversal leading to a heap dump, or server compromise), they can extract the plaintext master keys of all currently logged-in users.

**Remediation:**
While retaining decrypted keys in memory is an accepted architectural requirement for the vault's usability, the risk should be documented and mitigated. Ensure that `masterKey.fill(0)` is executed on every possible code path where the session is invalidated. Consider implementing memory protection APIs (e.g., sodium-native's `sodium_mprotect_noaccess`) if strict memory isolation is required in the future.

**References:**
- [CWE-316: Cleartext Storage of Sensitive Information in Memory](https://cwe.mitre.org/data/definitions/316.html)

---

### [INFO] FINDING-005: Postgres Container Runs as Root

**Category:** Infrastructure
**Location:** `compose.yml:2-21`
**Status:** Open

**Description:**
The `postgres` service in `compose.yml` does not specify a non-root `user`. While the `server` container specifies `user: "0:0"`, the database container will run as the default root user inside the container unless overridden by the host's daemon (e.g., rootless Podman).

**Impact:**
Running containers as root violates the principle of least privilege and increases the impact of container breakout vulnerabilities.

**Remediation:**
Specify a non-root user for the `postgres` container in `compose.yml`, ensuring the mounted volumes have appropriate permissions.

```yaml
    postgres:
      image: postgres:16
      user: "999:999" # Default postgres UID/GID
```

**References:**
- [Docker Security Best Practices](https://docs.docker.com/develop/security-best-practices/)

---

## Positive Findings

The following security strengths and best practices were identified during the audit:

1. **Robust Cryptography Core:** The system correctly utilizes AES-256-GCM for core vault encryption and Argon2id (with `memoryCost: 65536, timeCost: 3`) for password hashing and key derivation.
2. **Secure Token Storage:** The client application deliberately excludes access tokens from `localStorage` (`authStore.ts:75`) and relies on `HttpOnly`, `SameSite=strict` cookies for refresh tokens (`config.ts:153-159`), significantly reducing the risk of token theft via XSS.
3. **Memory Zeroing:** The system actively calls `.fill(0)` on Buffer objects containing master keys and derived keys after use or upon session expiration to minimize memory exposure.
4. **Token Rotation:** Refresh tokens are rotated upon use, and the system implements family-based token revocation to detect and mitigate token reuse/theft (`auth.service.ts:518`).
5. **Security Middleware:** The application implements `helmet` for robust Content Security Policy (CSP) and security headers, alongside `express-rate-limit` for brute-force protection on authentication routes.
6. **Clean Dependencies:** `npm audit` reported 0 known vulnerabilities in both the client and server workspaces.

## Recommendations Summary

Priority actions ordered by impact:

1. **[CRITICAL]** — Standardize `vnc.service.ts` to use `aes-256-gcm` with proper authentication tags to prevent padding oracle attacks and match the patched Guacamole-lite expectations.
2. **[HIGH]** — Update the VNC Guacamole key derivation in `vnc.service.ts` to use `scryptSync` instead of a weak, unsalted SHA-256 hash.
3. **[MEDIUM]** — Refactor `config.ts` to strictly validate required environment variables in production, regardless of the `NODE_ENV` fallback behavior, to prevent silent activation of weak default secrets.

## Methodology

This audit was performed through static analysis of the source code, dependency scanning, and configuration review. It does not include dynamic testing (penetration testing). Findings should be validated in a running environment.