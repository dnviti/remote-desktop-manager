# Production Security

> Auto-generated on 2026-03-15 by /docs create security.
> Source of truth is the codebase. Run /docs update security after code changes.

## Security Headers

Helmet middleware applies the following security headers:

| Header | Policy |
|--------|--------|
| Content-Security-Policy | `default-src 'self'`, restricted script/style/img/connect, self-hosted fonts only, `object-src 'none'`, `frame-ancestors 'none'` |
| Strict-Transport-Security | `max-age=31536000; includeSubDomains` |
| X-Frame-Options | `DENY` |
| Referrer-Policy | `strict-origin-when-cross-origin` |

<!-- manual-start -->
<!-- manual-end -->

## Security Considerations for Production

1. **Set strong secrets**: `JWT_SECRET`, `GUACAMOLE_SECRET`, `SERVER_ENCRYPTION_KEY` must be cryptographically random. Generate with `openssl rand -hex 32`.
2. **Enable HTTPS**: Use a reverse proxy (Caddy, Traefik, etc.) with TLS termination in front of the Nginx container.
3. **Configure `TRUST_PROXY`**: Set to the number of proxy hops for correct client IP resolution.
4. **Set `CLIENT_URL`**: Must match the actual production URL for CORS and OAuth redirects.
5. **Use strong database password**: Change default PostgreSQL credentials.
6. **Enable MFA policy**: Set `mfaRequired: true` on the tenant to enforce MFA for all members.
7. **Configure vault timeout**: Set `vaultAutoLockMaxMinutes` at the tenant level to cap vault session duration.
8. **Configure session timeout**: Set `defaultSessionTimeoutSeconds` to auto-close idle remote sessions.
9. **Review OAuth/SAML configuration**: Ensure callback URLs match the production domain.
10. **Enable audit logging**: Monitor the audit log for suspicious activity (login failures, token reuse).
11. **Configure GeoIP**: Set `GEOIP_DB_PATH` with a MaxMind GeoLite2 database for IP geolocation in audit logs.
12. **Enable impossible travel detection**: With GeoIP configured, ensure `IMPOSSIBLE_TRAVEL_SPEED_KMH` is set appropriately (default: 900 km/h).
13. **Secure LDAP connections**: If using LDAP, enable STARTTLS (`LDAP_STARTTLS=true`) and keep `LDAP_TLS_REJECT_UNAUTHORIZED=true`.
14. **Restrict network access**: Keep `ALLOW_LOCAL_NETWORK=false` unless Arsenale and its targets share the same LAN. Keep `ALLOW_LOOPBACK=false` unless explicitly needed.
15. **Enable token binding**: Set `TOKEN_BINDING_ENABLED=true` to bind JWT tokens to client IP and User-Agent, preventing token hijacking.
16. **Configure session limits**: Set `MAX_CONCURRENT_SESSIONS` to limit parallel user sessions and `ABSOLUTE_SESSION_TIMEOUT_SECONDS` to force periodic re-authentication.
17. **Use secret files**: Prefer `*_FILE` variants (`JWT_SECRET_FILE`, `DATABASE_URL_FILE`, etc.) over inline environment values for all sensitive configuration.
18. **Enable host validation**: Set `HOST_VALIDATION_ENABLED=true` to prevent DNS rebinding attacks.
19. **Force secure cookies**: Set `COOKIE_SECURE=true` when running behind HTTPS.
20. **Configure recording retention**: Set `RECORDING_RETENTION_DAYS` according to compliance requirements.
21. **Secure tunnel deployments**: Set `TUNNEL_STRICT_MTLS=true` for zero-trust gateway deployments.
22. **Set WebAuthn origins**: Ensure `WEBAUTHN_RP_ID` and `WEBAUTHN_RP_ORIGIN` match the production domain exactly.
23. **Configure SQL firewall**: Define tenant-level SQL firewall rules to block dangerous query patterns.
24. **Review DLP policies**: Set tenant-level DLP policies for clipboard and file transfer restrictions as needed.
25. **Enable keystroke inspection**: Configure keystroke policies for compliance-sensitive SSH sessions.

<!-- manual-start -->
<!-- manual-end -->
