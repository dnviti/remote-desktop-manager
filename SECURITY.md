# Security Policy

## Reporting a Vulnerability

Please **do not** open public GitHub issues for security vulnerabilities.

Report vulnerabilities responsibly by emailing:

**security@arsenalepam.com**

Include in your report:
- A clear description of the vulnerability
- Steps to reproduce the issue
- The potential impact (what an attacker could achieve)
- Any suggested fix (optional)

You will receive an acknowledgement within **72 hours** and a resolution update within **14 days**. We follow responsible disclosure: we will coordinate a public disclosure date with you after a fix is released.

## Security Features

### Credential Encryption

- All connection credentials (passwords, private keys) are encrypted at rest using **AES-256-GCM**
- Each user has a master key derived from their password via **Argon2id** (memory-hard KDF)
- The master key is never stored — it is derived on vault unlock and held in server memory with a configurable TTL (default: 30 minutes)
- Team credentials are encrypted with a per-team vault key, which is itself encrypted with each member's master key

### Authentication

- Password hashing with **bcrypt** (login) and **Argon2id** (vault key derivation)
- **JWT** access tokens (short-lived, 15 minutes default) + refresh tokens (stored in DB, 7 days default)
- **TOTP 2FA** support (RFC 6238, compatible with Google Authenticator, Authy, etc.)
- **OAuth 2.0** with Google, Microsoft, and GitHub (Authorization Code flow, server-side)
- Email verification required on registration

### Network & API

- All API routes require a valid JWT (except auth endpoints)
- Vault operations require the vault to be explicitly unlocked
- Connection sharing is scoped within tenant boundaries (cross-tenant sharing is prohibited by design)

### Code Quality

- TypeScript strict mode across all source files
- ESLint with `eslint-plugin-security` rules
- Dependency audit via `npm audit` in CI

## Accepted Scope

In-scope vulnerabilities include:
- Authentication or authorization bypass
- Credential exposure or decryption
- SQL injection or data exfiltration
- Cross-site scripting (XSS) in the web client
- Cross-tenant data leakage
- Insecure cryptographic implementation

Out of scope:
- Vulnerabilities in dependencies (report those to the dependency maintainer; we track them via `npm audit`)
- Issues requiring physical access to the server
- Social engineering

## Supported Versions

| Version | Supported |
|---------|-----------|
| stable `main` | Yes |
| older releases | No |
