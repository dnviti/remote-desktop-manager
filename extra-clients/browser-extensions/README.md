# Browser Extension

Chrome Manifest V3 workspace for the Arsenale browser extension.

## Current Scope

- Multi-account sign-in against multiple Arsenale servers
- MFA sign-in with TOTP, SMS, and WebAuthn
- Tenant selection after sign-in for multi-organization users
- Vault unlock with password, TOTP, SMS, and WebAuthn
- Keychain browsing with secret detail and clipboard copy
- Connection listing with favorite toggles and web-client deep links
- Content-script autofill anchored to matching login forms

## Local Development

```bash
npm run typecheck --workspace browser-extensions
npm test --workspace browser-extensions
npm run build --workspace browser-extensions
```

Load the unpacked extension from [`dist/`](/home/debian/repos/arsenale/extra-clients/browser-extensions/dist) after running the build.

## Release Checklist

1. Run `npm run typecheck --workspace browser-extensions`.
2. Run `npm test --workspace browser-extensions`.
3. Run `npm run build --workspace browser-extensions`.
4. Load the unpacked build from `extra-clients/browser-extensions/dist`.
5. Verify direct sign-in against a test server.
6. Verify MFA sign-in with TOTP, SMS, and WebAuthn.
7. Verify tenant selection for a user with access to multiple organizations.
8. Verify vault unlock with password and at least one MFA method.
9. Verify autofill on a real login page, including vault unlock from the content-script prompt.
10. Verify connection launch via `autoconnect` into the web client.
11. Verify logout, account removal, and expired-session recovery.
