# Features & User Experience Report

> Auto-generated static analysis for `arsenale`

## UI Component Inventory

- **Total components:** 100
- **Total lines:** 25,212

| Domain | Components | Lines |
| --- | --- | --- |
| Audit | 3 | 610 |
| Dialogs | 15 | 3,874 |
| Keychain | 9 | 2,999 |
| Layout | 3 | 741 |
| Overlays | 1 | 322 |
| RDP | 2 | 694 |
| Recording | 4 | 845 |
| SSH | 2 | 582 |
| Settings | 21 | 6,443 |
| Sidebar | 3 | 1,332 |
| Tabs | 2 | 136 |
| Terminal | 1 | 528 |
| VNC | 1 | 427 |
| common | 4 | 411 |
| gateway | 3 | 990 |
| hooks | 1 | 195 |
| orchestration | 6 | 1,046 |
| root | 15 | 2,324 |
| shared | 3 | 613 |
| utils | 1 | 100 |

## API Endpoint Summary

- **Framework:** Express
- **Total endpoints:** 230

| Domain | GET | POST | PUT | DELETE | Total |
| --- | --- | --- | --- | --- | --- |
| :id | 21 | 14 | 16 | 15 | 70 |
| :ip | 1 | 0 | 0 | 0 | 1 |
| :name | 1 | 0 | 0 | 1 | 2 |
| :sessionId | 0 | 1 | 0 | 0 | 1 |
| :token | 1 | 1 | 0 | 0 | 2 |
| active | 1 | 0 | 0 | 0 | 1 |
| app-config | 1 | 0 | 1 | 0 | 2 |
| auto-lock | 1 | 0 | 1 | 0 | 2 |
| avatar | 0 | 1 | 0 | 0 | 1 |
| batch-share | 0 | 1 | 0 | 0 | 1 |
| callback | 0 | 1 | 0 | 0 | 1 |
| config | 1 | 0 | 0 | 0 | 1 |
| connection | 2 | 0 | 0 | 0 | 2 |
| count | 2 | 0 | 0 | 0 | 2 |
| countries | 1 | 0 | 0 | 0 | 1 |
| credentials | 1 | 0 | 0 | 1 | 3 |
| disable | 0 | 2 | 0 | 0 | 2 |
| domain-profile | 1 | 0 | 1 | 1 | 3 |
| email | 1 | 1 | 0 | 0 | 2 |
| email-change | 0 | 2 | 0 | 0 | 2 |
| enable | 0 | 1 | 0 | 0 | 1 |
| export | 0 | 1 | 0 | 0 | 1 |
| external-shares | 0 | 0 | 0 | 1 | 1 |
| forgot-password | 0 | 1 | 0 | 0 | 1 |
| gateways | 1 | 0 | 0 | 0 | 1 |
| health | 1 | 0 | 0 | 0 | 1 |
| identity | 0 | 2 | 0 | 0 | 2 |
| import | 0 | 1 | 0 | 0 | 1 |
| link | 1 | 0 | 0 | 0 | 1 |
| lock | 0 | 1 | 0 | 0 | 1 |
| login | 0 | 1 | 0 | 0 | 1 |
| logout | 0 | 1 | 0 | 0 | 1 |
| metadata | 1 | 0 | 0 | 0 | 1 |
| mfa-setup | 0 | 2 | 0 | 0 | 2 |
| mine | 2 | 0 | 0 | 0 | 2 |
| oauth | 5 | 1 | 0 | 1 | 7 |
| password | 0 | 0 | 1 | 0 | 1 |
| password-change | 0 | 1 | 0 | 0 | 1 |
| path | 5 | 5 | 0 | 0 | 11 |
| profile | 1 | 0 | 1 | 0 | 2 |
| rdp | 0 | 3 | 0 | 0 | 3 |
| rdp-defaults | 0 | 0 | 1 | 0 | 1 |
| read-all | 0 | 0 | 1 | 0 | 1 |
| ready | 1 | 0 | 0 | 0 | 1 |
| refresh | 0 | 1 | 0 | 0 | 1 |
| register | 0 | 2 | 0 | 0 | 2 |
| registration-options | 0 | 1 | 0 | 0 | 1 |
| request-sms-code | 0 | 1 | 0 | 0 | 1 |
| request-webauthn-options | 0 | 1 | 0 | 0 | 1 |
| resend-verification | 0 | 1 | 0 | 0 | 1 |
| reset-password | 0 | 3 | 0 | 0 | 3 |
| reveal-password | 0 | 1 | 0 | 0 | 1 |
| root | 13 | 9 | 1 | 1 | 24 |
| search | 1 | 0 | 0 | 0 | 1 |
| send-disable-code | 0 | 1 | 0 | 0 | 1 |
| setup | 0 | 1 | 0 | 0 | 1 |
| setup-phone | 0 | 1 | 0 | 0 | 1 |
| ssh | 0 | 1 | 0 | 0 | 1 |
| ssh-defaults | 0 | 0 | 1 | 0 | 1 |
| ssh-keypair | 3 | 2 | 0 | 0 | 6 |
| status | 5 | 0 | 0 | 0 | 5 |
| switch-tenant | 0 | 1 | 0 | 0 | 1 |
| sync | 0 | 1 | 0 | 0 | 1 |
| templates | 1 | 2 | 1 | 1 | 5 |
| tenant | 4 | 0 | 0 | 0 | 4 |
| tenant-vault | 1 | 2 | 0 | 0 | 3 |
| test | 0 | 1 | 0 | 0 | 1 |
| unlock | 0 | 1 | 0 | 0 | 1 |
| unlock-mfa | 0 | 5 | 0 | 0 | 5 |
| verify | 0 | 1 | 0 | 0 | 1 |
| verify-email | 1 | 0 | 0 | 0 | 1 |
| verify-phone | 0 | 1 | 0 | 0 | 1 |
| verify-sms | 0 | 1 | 0 | 0 | 1 |
| verify-totp | 0 | 1 | 0 | 0 | 1 |
| verify-webauthn | 0 | 1 | 0 | 0 | 1 |
| vnc | 0 | 3 | 0 | 0 | 3 |

## Authentication & Security

- JWT
- OAuth
- SAML
- LDAP
- WebAuthn/Passkeys
- TOTP/2FA
- SMS/Phone Auth
- API Keys
- Session-based
- Basic Auth

## State Management

- **Libraries:** Zustand, Redux, MobX, Pinia, Vuex, XState, NgRx
- **Store files (14):**
  - `client/src/store/authStore.ts`
  - `client/src/store/connectionsStore.ts`
  - `client/src/store/gatewayStore.ts`
  - `client/src/store/notificationListStore.ts`
  - `client/src/store/notificationStore.ts`
  - `client/src/store/rdpSettingsStore.ts`
  - `client/src/store/secretStore.ts`
  - `client/src/store/tabsStore.ts`
  - `client/src/store/teamStore.ts`
  - `client/src/store/tenantStore.ts`
  - `client/src/store/terminalSettingsStore.ts`
  - `client/src/store/themeStore.ts`
  - `client/src/store/uiPreferencesStore.ts`
  - `client/src/store/vaultStore.ts`

## Real-time Features

- WebSocket
- Socket.IO
- Server-Sent Events
- GraphQL Subscriptions
- MQTT
- gRPC Streaming

## Accessibility Posture

- **UI files with ARIA/role attributes:** 6/100
- **aria-* attributes:** 2
- **role attributes:** 1
- **tabIndex usage:** 4
- **alt attributes:** 0

## Internationalization

- **Libraries:** react-intl, i18next, vue-i18n, gettext, Fluent, FormatJS, lingui
- **Locale files:** 0

## Feature Gaps

- Low accessibility coverage — only 6/100 UI files have ARIA/role attributes
- No dedicated accessibility testing library detected
- No error boundary component detected
- No skeleton/shimmer loading states detected
