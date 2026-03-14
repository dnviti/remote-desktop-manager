# Project Memory — Codebase Summary

_Generated for: `arsenale`_

## Project Overview

**Monorepo** with npm workspaces: `server/`, `client/`, and `clients/browser-extensions/`.

### Server (Express + TypeScript)

Layered architecture: **Routes → Controllers → Services → Prisma ORM**

- `server/src/index.ts` — Entry point: runs `prisma migrate deploy` automatically, creates HTTP server, attaches Socket.IO and Guacamole WebSocket server
- `server/src/app.ts` — Express app setup with middleware and route mounting
- `server/src/routes/*.routes.ts` — Route definitions (auth, connections, folders, sharing, vault)
- `server/src/controllers/*.controller.ts` — Request parsing and validation
- `server/src/services/*.service.ts` — Business logic and database operations
- `server/src/socket/` — Socket.IO handlers for SSH terminal sessions
- `server/src/middleware/` — JWT auth middleware, error handler
- `server/src/types/index.ts` — Shared types (`AuthPayload`, `AuthRequest`, `EncryptedField`, `VaultSession`)
- `server/prisma/schema.prisma` — Data models: User, Connection, Folder, SharedConnection, RefreshToken

### Client (React 19 + Vite)

- `client/src/api/` — Axios client with automatic JWT refresh on 401
- `client/src/store/*Store.ts` — Zustand stores: `authStore`, `connectionsStore`, `tabsStore`, `vaultStore`
- `client/src/pages/` — Page components (Login, Register, Dashboard)
- `client/src/components/` — UI components (Layout, RDP viewer, Terminal, Dialogs, Tabs)
- `client/src/hooks/` — Custom hooks (`useAuth`, `useSocket`)
- UI framework: Material-UI (MUI) v7

### Browser Extension (Chrome Manifest V3)

- `clients/browser-extensions/` — Browser extension workspace (Chrome primary, Firefox secondary)
- `clients/browser-extensions/src/background.ts` — Service worker: handles all API calls to Arsenale servers (bypasses CORS), token refresh via chrome.alarms
- `clients/browser-extensions/src/popup/` — React popup app: account switcher, keychain browsing, connection listing
- `clients/browser-extensions/src/options/` — React options/settings page: multi-account management, server URL configuration
- `clients/browser-extensions/src/content/` — Content scripts for credential autofill on web pages
- `clients/browser-extensions/src/lib/` — Shared utilities: account storage, API client, auth, vault/secrets/connections API wrappers

## File Tree

```
arsenale/
├── .claude/
│   ├── scripts/
│   │   ├── analyzers/
│   │   │   ├── __init__.py
│   │   │   ├── features.py
│   │   │   ├── infrastructure.py
│   │   │   └── quality.py
│   │   ├── codebase_analyzer.py
│   │   └── memory_builder.py
│   ├── github-issues.example.json
│   ├── issues-tracker.example.json
│   ├── issues-tracker.json
│   ├── launch.json
│   └── settings.json
├── .devcontainer/
│   ├── devcontainer.json
│   ├── docker-compose.yml
│   └── Dockerfile
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md
│   │   └── feature_request.md
│   ├── workflows/
│   │   ├── agentic-docs.yml
│   │   ├── agentic-fleet.yml
│   │   ├── agentic-task.yml
│   │   ├── docker-client.yml
│   │   ├── docker-server.yml
│   │   ├── guacenc-build.yml
│   │   ├── release.yml
│   │   ├── security-client.yml
│   │   ├── security-server.yml
│   │   ├── ssh-gateway-build.yml
│   │   ├── verify-client.yml
│   │   └── verify-server.yml
│   └── pull_request_template.md
├── .vscode/
│   ├── launch.json
│   └── tasks.json
├── client/
│   ├── public/
│   │   ├── apple-touch-icon.png
│   │   ├── favicon.ico
│   │   ├── icon-192-maskable.png
│   │   ├── icon-192.png
│   │   ├── icon-512-maskable.png
│   │   └── icon-512.png
│   ├── src/
│   │   ├── api/
│   │   │   ├── admin.api.ts
│   │   │   ├── audit.api.ts
│   │   │   ├── auth.api.ts
│   │   │   ├── client.ts
│   │   │   ├── connections.api.ts
│   │   │   ├── email.api.ts
│   │   │   ├── files.api.ts
│   │   │   ├── folders.api.ts
│   │   │   ├── gateway.api.ts
│   │   │   ├── importExport.api.ts
│   │   │   ├── ldap.api.ts
│   │   │   ├── notifications.api.ts
│   │   │   ├── oauth.api.ts
│   │   │   ├── passwordReset.api.ts
│   │   │   ├── recordings.api.ts
│   │   │   ├── secrets.api.ts
│   │   │   ├── sessions.api.ts
│   │   │   ├── sharing.api.ts
│   │   │   ├── smsMfa.api.ts
│   │   │   ├── sync.api.ts
│   │   │   ├── tabs.api.ts
│   │   │   ├── team.api.ts
│   │   │   ├── tenant.api.ts
│   │   │   ├── twofa.api.ts
│   │   │   ├── user.api.ts
│   │   │   ├── vault-folders.api.ts
│   │   │   ├── vault.api.ts
│   │   │   └── webauthn.api.ts
│   │   ├── components/
│   │   │   ├── Audit/
│   │   │   ├── common/
│   │   │   ├── Dialogs/
│   │   │   ├── gateway/
│   │   │   ├── Keychain/
│   │   │   ├── Layout/
│   │   │   ├── orchestration/
│   │   │   ├── Overlays/
│   │   │   ├── RDP/
│   │   │   ├── Recording/
│   │   │   ├── Settings/
│   │   │   ├── shared/
│   │   │   ├── Sidebar/
│   │   │   ├── SSH/
│   │   │   ├── Tabs/
│   │   │   ├── Terminal/
│   │   │   ├── VNC/
│   │   │   ├── OAuthButtons.tsx
│   │   │   └── UserPicker.tsx
│   │   ├── constants/
│   │   │   ├── keysyms.ts
│   │   │   ├── rdpDefaults.ts
│   │   │   ├── terminalThemes.ts
│   │   │   └── vncDefaults.ts
│   │   ├── hooks/
│   │   │   ├── useAsyncAction.ts
│   │   │   ├── useAuth.ts
│   │   │   ├── useAutoReconnect.ts
│   │   │   ├── useCopyToClipboard.ts
│   │   │   ├── useDlpBrowserHardening.ts
│   │   │   ├── useFullscreen.ts
│   │   │   ├── useGatewayMonitor.ts
│   │   │   ├── useGuacToolbarActions.tsx
│   │   │   ├── useKeyboardCapture.ts
│   │   │   ├── useLazyMount.ts
│   │   │   ├── useSftpTransfers.ts
│   │   │   ├── useShareSync.ts
│   │   │   └── useSocket.ts
│   │   ├── pages/
│   │   │   ├── ConnectionViewerPage.tsx
│   │   │   ├── DashboardPage.tsx
│   │   │   ├── ForgotPasswordPage.tsx
│   │   │   ├── LoginPage.tsx
│   │   │   ├── OAuthCallbackPage.tsx
│   │   │   ├── PublicSharePage.tsx
│   │   │   ├── RecordingPlayerPage.tsx
│   │   │   ├── RegisterPage.tsx
│   │   │   ├── ResetPasswordPage.tsx
│   │   │   └── VaultSetupPage.tsx
│   │   ├── store/
│   │   │   ├── authStore.ts
│   │   │   ├── connectionsStore.ts
│   │   │   ├── gatewayStore.ts
│   │   │   ├── notificationListStore.ts
│   │   │   ├── notificationStore.ts
│   │   │   ├── rdpSettingsStore.ts
│   │   │   ├── secretStore.ts
│   │   │   ├── tabsStore.ts
│   │   │   ├── teamStore.ts
│   │   │   ├── tenantStore.ts
│   │   │   ├── terminalSettingsStore.ts
│   │   │   ├── themeStore.ts
│   │   │   ├── uiPreferencesStore.ts
│   │   │   └── vaultStore.ts
│   │   ├── types/
│   │   │   └── keyboard-lock.d.ts
│   │   ├── utils/
│   │   │   ├── apiError.ts
│   │   │   ├── notificationActions.tsx
│   │   │   ├── openConnectionWindow.ts
│   │   │   ├── openRecordingWindow.ts
│   │   │   ├── recentConnections.ts
│   │   │   ├── reconnectClassifier.ts
│   │   │   └── roles.ts
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── theme.ts
│   ├── Dockerfile
│   ├── index.html
│   ├── nginx.conf
│   ├── nginx.main.conf
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   └── vite.config.ts
├── docker/
│   └── guacenc/
│       ├── Dockerfile
│       └── server.py
├── docs/
│   ├── api.md
│   ├── architecture.md
│   ├── components.md
│   ├── database.md
│   ├── deployment.md
│   ├── environment.md
│   ├── rag-summary.md
│   └── security.md
├── icons/
│   ├── android/
│   │   ├── res/
│   │   │   ├── mipmap-anydpi-v26/
│   │   │   ├── mipmap-hdpi/
│   │   │   ├── mipmap-mdpi/
│   │   │   ├── mipmap-xhdpi/
│   │   │   ├── mipmap-xxhdpi/
│   │   │   └── mipmap-xxxhdpi/
│   │   └── play_store_512.png
│   ├── ios/
│   │   ├── AppIcon-20@2x.png
│   │   ├── AppIcon-20@2x~ipad.png
│   │   ├── AppIcon-20@3x.png
│   │   ├── AppIcon-20~ipad.png
│   │   ├── AppIcon-29.png
│   │   ├── AppIcon-29@2x.png
│   │   ├── AppIcon-29@2x~ipad.png
│   │   ├── AppIcon-29@3x.png
│   │   ├── AppIcon-29~ipad.png
│   │   ├── AppIcon-40@2x.png
│   │   ├── AppIcon-40@2x~ipad.png
│   │   ├── AppIcon-40@3x.png
│   │   ├── AppIcon-40~ipad.png
│   │   ├── AppIcon-60@2x~car.png
│   │   ├── AppIcon-60@3x~car.png
│   │   ├── AppIcon-83.5@2x~ipad.png
│   │   ├── AppIcon@2x.png
│   │   ├── AppIcon@2x~ipad.png
│   │   ├── AppIcon@3x.png
│   │   ├── AppIcon~ios-marketing.png
│   │   ├── AppIcon~ipad.png
│   │   └── Contents.json
│   ├── web/
│   │   ├── apple-touch-icon.png
│   │   ├── favicon.ico
│   │   ├── icon-192-maskable.png
│   │   ├── icon-192.png
│   │   ├── icon-512-maskable.png
│   │   ├── icon-512.png
│   │   └── README.txt
│   ├── Arsenale_icon.png
│   ├── Arsenale_logo.png
│   └── Arsenale_logo_transparent.png
├── scripts/
│   ├── container-runtime.sh
│   ├── security-scan.sh
│   ├── setup-github-labels.sh
│   ├── setup-labels.sh
│   ├── task-manager.sh
│   └── update-geodb.sh
├── selinux/
│   ├── arsenale-podman.te
│   └── install.sh
├── server/
│   ├── prisma/
│   │   ├── migrations/
│   │   │   ├── 20260225185211_init/
│   │   │   ├── 20260301182340_add_missing_schema_changes/
│   │   │   ├── 20260301222014_add_open_tab/
│   │   │   ├── 20260302001850_add_ssh_keypair/
│   │   │   ├── 20260302093438_add_managed_ssh_gateway_type/
│   │   │   ├── 20260302110000_add_batch_share_audit_action/
│   │   │   ├── 20260302111317_add_ssh_key_rotation_policy/
│   │   │   ├── 20260302113302_add_gateway_health_monitoring/
│   │   │   ├── 20260302120000_add_gateway_ssh_key/
│   │   │   ├── 20260302122942_add_session_audit_actions/
│   │   │   ├── 20260302124609_add_login_failure_audit/
│   │   │   ├── 20260302130000_add_gateway_api_port_and_push_audit/
│   │   │   ├── 20260302153150_add_vault_secrets/
│   │   │   ├── 20260302160609_add_shared_secret/
│   │   │   ├── 20260302165730_vault_055_connection_credential_secret/
│   │   │   ├── 20260302200127_add_external_secret_share/
│   │   │   ├── 20260302203728_add_secret_expiry_notification_types/
│   │   │   ├── 20260302220000_add_active_session_tracking/
│   │   │   ├── 20260302224137_add_session_inactivity_timeout/
│   │   │   ├── 20260302231310_add_managed_gateway_instance/
│   │   │   ├── 20260303002039_add_gateway_lifecycle_fields/
│   │   │   ├── 20260303004825_add_gateway_autoscale/
│   │   │   ├── 20260303093408_add_tenant_mfa_required/
│   │   │   ├── 20260303100544_add_gateway_template/
│   │   │   ├── 20260304095920_add_publish_ports/
│   │   │   ├── 20260304120000_gate_080_load_balancing/
│   │   │   ├── 20260304130638_audit_083_gateway_id/
│   │   │   ├── 20260304193921_gate_084/
│   │   │   ├── 20260304201402_add_api_port_to_managed_instance/
│   │   │   ├── 20260305002631_add_session_error_audit_action/
│   │   │   ├── 20260305004106_add_comprehensive_audit_actions/
│   │   │   ├── 20260305121409_zt_092/
│   │   │   ├── 20260305130000_zt_044/
│   │   │   ├── 20260305130100_fido_093/
│   │   │   ├── 20260305140000_vault_auto_lock/
│   │   │   ├── 20260305235054_tenant_094/
│   │   │   ├── 20260306140000_sso_073_add_domain_fields/
│   │   │   ├── 20260307184356_tenant_096/
│   │   │   ├── 20260309091244_proto_069/
│   │   │   ├── 20260309102635_rec_070/
│   │   │   ├── 20260309143517_add_recording_dimensions/
│   │   │   ├── 20260310004301_rec_171/
│   │   │   ├── 20260310022442_io_071/
│   │   │   ├── 20260310102208_geo_106/
│   │   │   ├── 20260310223723_add_ip_to_active_session/
│   │   │   ├── 20260311171324_opt_202/
│   │   │   ├── 20260312000000_role_110_extended_tenant_roles/
│   │   │   ├── 20260312100000_role_111_membership_expiry/
│   │   │   ├── 20260313000000_sec_116_dlp_policy/
│   │   │   ├── 20260313100000_sec_111_token_binding/
│   │   │   └── migration_lock.toml
│   │   ├── dev.db
│   │   └── schema.prisma
│   ├── src/
│   │   ├── cli/
│   │   │   ├── commands/
│   │   │   ├── helpers/
│   │   │   └── index.ts
│   │   ├── config/
│   │   │   └── passport.ts
│   │   ├── controllers/
│   │   │   ├── admin.controller.ts
│   │   │   ├── audit.controller.ts
│   │   │   ├── auth.controller.ts
│   │   │   ├── connections.controller.ts
│   │   │   ├── externalShare.controller.ts
│   │   │   ├── files.controller.ts
│   │   │   ├── folders.controller.ts
│   │   │   ├── gateway.controller.ts
│   │   │   ├── geoip.controller.ts
│   │   │   ├── importExport.controller.ts
│   │   │   ├── ldap.controller.ts
│   │   │   ├── notification.controller.ts
│   │   │   ├── oauth.controller.ts
│   │   │   ├── recording.controller.ts
│   │   │   ├── saml.controller.ts
│   │   │   ├── secret.controller.ts
│   │   │   ├── session.controller.ts
│   │   │   ├── sharing.controller.ts
│   │   │   ├── smsMfa.controller.ts
│   │   │   ├── sync.controller.ts
│   │   │   ├── tabs.controller.ts
│   │   │   ├── team.controller.ts
│   │   │   ├── tenant.controller.ts
│   │   │   ├── twofa.controller.ts
│   │   │   ├── user.controller.ts
│   │   │   ├── vault-folders.controller.ts
│   │   │   ├── vault.controller.ts
│   │   │   └── webauthn.controller.ts
│   │   ├── middleware/
│   │   │   ├── asyncHandler.ts
│   │   │   ├── auth.middleware.ts
│   │   │   ├── csrf.middleware.ts
│   │   │   ├── error.middleware.ts
│   │   │   ├── identityRateLimit.middleware.ts
│   │   │   ├── loginRateLimit.middleware.ts
│   │   │   ├── oauthRateLimit.middleware.ts
│   │   │   ├── rateLimitFactory.ts
│   │   │   ├── requestLogger.middleware.ts
│   │   │   ├── resetRateLimit.middleware.ts
│   │   │   ├── sessionRateLimit.middleware.ts
│   │   │   ├── smsRateLimit.middleware.ts
│   │   │   ├── team.middleware.ts
│   │   │   ├── tenant.middleware.ts
│   │   │   ├── validate.middleware.ts
│   │   │   └── vaultRateLimit.middleware.ts
│   │   ├── orchestrator/
│   │   │   ├── docker.provider.ts
│   │   │   ├── index.ts
│   │   │   ├── kubernetes.provider.ts
│   │   │   ├── none.provider.ts
│   │   │   ├── podman.provider.ts
│   │   │   └── types.ts
│   │   ├── routes/
│   │   │   ├── admin.routes.ts
│   │   │   ├── audit.routes.ts
│   │   │   ├── auth.routes.ts
│   │   │   ├── connections.routes.ts
│   │   │   ├── files.routes.ts
│   │   │   ├── folders.routes.ts
│   │   │   ├── gateway.routes.ts
│   │   │   ├── geoip.routes.ts
│   │   │   ├── health.routes.ts
│   │   │   ├── importExport.routes.ts
│   │   │   ├── ldap.routes.ts
│   │   │   ├── notification.routes.ts
│   │   │   ├── oauth.routes.ts
│   │   │   ├── publicShare.routes.ts
│   │   │   ├── recording.routes.ts
│   │   │   ├── saml.routes.ts
│   │   │   ├── secret.routes.ts
│   │   │   ├── session.routes.ts
│   │   │   ├── sharing.routes.ts
│   │   │   ├── smsMfa.routes.ts
│   │   │   ├── sync.routes.ts
│   │   │   ├── tabs.routes.ts
│   │   │   ├── team.routes.ts
│   │   │   ├── tenant.routes.ts
│   │   │   ├── twofa.routes.ts
│   │   │   ├── user.routes.ts
│   │   │   ├── vault-folders.routes.ts
│   │   │   ├── vault.routes.ts
│   │   │   └── webauthn.routes.ts
│   │   ├── schemas/
│   │   │   ├── admin.schemas.ts
│   │   │   ├── audit.schemas.ts
│   │   │   ├── auth.schemas.ts
│   │   │   ├── common.schemas.ts
│   │   │   ├── connection.schemas.ts
│   │   │   ├── externalShare.schemas.ts
│   │   │   ├── files.schemas.ts
│   │   │   ├── folder.schemas.ts
│   │   │   ├── gateway.schemas.ts
│   │   │   ├── geoip.schemas.ts
│   │   │   ├── importExport.schemas.ts
│   │   │   ├── index.ts
│   │   │   ├── mfa.schemas.ts
│   │   │   ├── notification.schemas.ts
│   │   │   ├── oauth.schemas.ts
│   │   │   ├── recording.schemas.ts
│   │   │   ├── secret.schemas.ts
│   │   │   ├── session.schemas.ts
│   │   │   ├── sharing.schemas.ts
│   │   │   ├── sync.schemas.ts
│   │   │   ├── tabs.schemas.ts
│   │   │   ├── team.schemas.ts
│   │   │   ├── tenant.schemas.ts
│   │   │   ├── user.schemas.ts
│   │   │   ├── vault.schemas.ts
│   │   │   └── vaultFolder.schemas.ts
│   │   ├── services/
│   │   │   ├── email/
│   │   │   ├── sms/
│   │   │   ├── appConfig.service.ts
│   │   │   ├── audit.service.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── autoscaler.service.ts
│   │   │   ├── connection.service.ts
│   │   │   ├── crypto.service.ts
│   │   │   ├── domain.service.ts
│   │   │   ├── externalShare.service.ts
│   │   │   ├── file.service.ts
│   │   │   ├── folder.service.ts
│   │   │   ├── gateway.service.ts
│   │   │   ├── gatewayMonitor.service.ts
│   │   │   ├── gatewayTemplate.service.ts
│   │   │   ├── geoip.service.ts
│   │   │   ├── health.service.ts
│   │   │   ├── identityVerification.service.ts
│   │   │   ├── importExport.service.ts
│   │   │   ├── impossibleTravel.service.ts
│   │   │   ├── ldap.service.ts
│   │   │   ├── loadBalancer.service.ts
│   │   │   ├── managedGateway.service.ts
│   │   │   ├── notification.service.ts
│   │   │   ├── oauth.service.ts
│   │   │   ├── password.service.ts
│   │   │   ├── passwordReset.service.ts
│   │   │   ├── permission.service.ts
│   │   │   ├── rdp.service.ts
│   │   │   ├── recording.service.ts
│   │   │   ├── scheduler.service.ts
│   │   │   ├── secret.service.ts
│   │   │   ├── secretExpiry.service.ts
│   │   │   ├── secretSharing.service.ts
│   │   │   ├── session.service.ts
│   │   │   ├── sessionCleanup.service.ts
│   │   │   ├── sharing.service.ts
│   │   │   ├── smsOtp.service.ts
│   │   │   ├── ssh.service.ts
│   │   │   ├── sshkey.service.ts
│   │   │   ├── sync.service.ts
│   │   │   ├── syncScheduler.service.ts
│   │   │   ├── tabs.service.ts
│   │   │   ├── team.service.ts
│   │   │   ├── tenant.service.ts
│   │   │   ├── totp.service.ts
│   │   │   ├── user.service.ts
│   │   │   ├── vault-folder.service.ts
│   │   │   ├── vault.service.ts
│   │   │   ├── vnc.service.ts
│   │   │   └── webauthn.service.ts
│   │   ├── socket/
│   │   │   ├── gatewayMonitor.handler.ts
│   │   │   ├── index.ts
│   │   │   ├── notification.handler.ts
│   │   │   └── ssh.handler.ts
│   │   ├── sync/
│   │   │   ├── engine.ts
│   │   │   ├── index.ts
│   │   │   ├── netbox.provider.ts
│   │   │   └── types.ts
│   │   ├── types/
│   │   │   └── index.ts
│   │   ├── utils/
│   │   │   ├── cookie.ts
│   │   │   ├── csvParser.ts
│   │   │   ├── dlp.ts
│   │   │   ├── format.ts
│   │   │   ├── freePort.ts
│   │   │   ├── hostValidation.ts
│   │   │   ├── ip.ts
│   │   │   ├── jwt.ts
│   │   │   ├── logger.ts
│   │   │   ├── mremoteNgParser.ts
│   │   │   ├── rdpParser.ts
│   │   │   ├── tcpProbe.ts
│   │   │   ├── tenantScope.ts
│   │   │   ├── tokenBinding.ts
│   │   │   └── validate.ts
│   │   ├── app.ts
│   │   ├── cli.ts
│   │   ├── config.ts
│   │   └── index.ts
│   ├── Dockerfile
│   ├── package.json
│   ├── prisma.config.ts
│   └── tsconfig.json
├── ssh-gateway/
│   ├── Dockerfile
│   ├── entrypoint.sh
│   ├── key-api.sh
│   └── sshd_config
├── .dockerignore
├── .editorconfig
├── .gitattributes
├── .gitignore
├── .trivyignore.yaml
├── audit_client.json
├── audit_root.json
├── audit_server.json
├── CHANGELOG.md
├── CLAUDE.md
├── CODE_OF_CONDUCT.md
├── compose.demo.yml
├── compose.dev.yml
├── compose.yml
├── CONTRIBUTING.md
├── Dockerfile.dev
├── eslint.config.mjs
├── LICENSE
├── Makefile
├── package-lock.json
├── package.json
├── README.md
├── releases.example.json
├── releases.json
└── SECURITY.md
```

## Statistics

- **Total files:** 581
- **Estimated LOC:** ~101,479
- **By extension:**
  - `.ts`: 281
  - `.tsx`: 99
  - `.png`: 55
  - `.sql`: 50
  - `.json`: 21
  - `.md`: 17
  - `.yml`: 16
  - `(no ext)`: 12
  - `.sh`: 9
  - `.py`: 7
  - `.conf`: 2
  - `.ico`: 2
  - `.mjs`: 1
  - `.yaml`: 1
  - `.dev`: 1
  - `.te`: 1
  - `.db`: 1
  - `.prisma`: 1
  - `.toml`: 1
  - `.html`: 1

## Key Files

### README.md

```
<div align="center">
  <img src="icons/Arsenale_logo_transparent.png" alt="Arsenale" width="500" />
</div>

[![License: BSL 1.1](https://img.shields.io/badge/License-BSL_1.1-blue.svg)](LICENSE)
[![Verify Server](https://github.com/dnviti/arsenale/actions/workflows/verify-server.yml/badge.svg)](https://github.com/dnviti/arsenale/actions/workflows/verify-server.yml)
[![Verify Client](https://github.com/dnviti/arsenale/actions/workflows/verify-client.yml/badge.svg)](https://github.com/dnviti/arsenale/actions/workflows/verify-client.yml)
[![Version](https://img.shields.io/badge/version-1.3.2-green.svg)](CHANGELOG.md)

A web-based application for managing and accessing remote SSH and RDP connections from your browser. Organize connections in folders, share them with team members, and keep credentials encrypted at rest with a personal vault.

## Features

- **SSH Terminal** — Interactive terminal sessions powered by XTerm.js and Socket.IO, with integrated SFTP file browser
- **RDP Viewer** — Remote desktop connections via Apache Guacamole with clipboard sync and drive redirection
- **VNC Viewer** — VNC sessions via the Guacamole protocol
- **Encrypted Vault** — All credentials encrypted at rest with AES-256-GCM; master key derived from your password via Argon2id
- **Secrets Keychain** — Store login credentials, SSH keys, certificates, API keys, and secure notes with full versioning and expiry notifications
- **Connection Sharing** — Share connections with other users (read-only or full access) with per-recipient re-encryption
- **Folder Organization** — Hierarchical folder tree with drag-and-drop reordering for personal and team connections
- **Tabbed Interface** — Open multiple sessions side by side; pop out connections into standalone windows
- **Multi-Tenant Organizations** — Tenant-scoped RBAC with Owner/Admin/Operator/Member/Consultant/Auditor/Guest roles
- **Team Collaboration** — Teams with shared connection pools, folders, and vault sections
- **Multi-Factor Authentication** — TOTP, SMS OTP (Twilio, AWS SNS, Vonage), and WebAuthn/FIDO2 passkeys
- **OAuth & SAML SSO** — Google, Microsoft, GitHub, any OIDC provider, and SAML 2.0 identity providers
- **Audit Logging** — 100+ action types with IP and GeoIP tracking; geographic visualization for admins
- **Session Recording** — Record SSH (asciicast) and RDP/VNC (Guacamole format) sessions with in-browser playback and video export
- **DLP Policies** — Tenant and per-connection controls for clipboard copy/paste and file upload/download
- **SSH Gateway Management** — Deploy, scale, and monitor SSH gateway containers via Docker, Podman, or Kubernetes
- **JWT Authentication** — Short-lived access tokens with httpOnly refresh cookies, CSRF protection, and token binding

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Server** | Express, TypeScript, Prisma, Socket.IO, ssh2, guacamole-lite |
| **Client** | React 19, Vite, Material-UI v7, Zustand, XTerm.js, guacamole-common-js |
| **Database** | PostgreSQL 16 |
| **Infrastructure** | Docker / Podman / Kubernetes, Nginx, guacd, ssh-gateway |

## Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [Docker](https://www.docker.com/) (required for RDP support via `guacd`)
- npm 9+

## Getting Started

### 1. Clone the repository

... (171 more lines)
```

### package.json

```
{
  "name": "arsenale",
  "version": "1.3.2",
  "description": "Web-based remote desktop manager for SSH and RDP connections with encrypted vault, team sharing, and multi-tenant support",
  "author": "Daniele Viti <daniele@dnviti.dev>",
  "license": "BUSL-1.1",
  "homepage": "https://github.com/dnviti/arsenale",
  "repository": {
    "type": "git",
    "url": "https://github.com/dnviti/arsenale.git"
  },
  "bugs": {
    "url": "https://github.com/dnviti/arsenale/issues"
  },
  "keywords": [
    "remote-desktop",
    "ssh",
    "rdp",
    "guacamole",
    "web-terminal",
    "sftp",
    "xterm",
    "vault",
    "multi-tenant"
  ],
  "private": true,
  "workspaces": [
    "server",
    "client"
  ],
... (41 more lines)
```

### CLAUDE.md

```
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language

Always respond and work in English, even if the user's prompt is written in another language.

## Development Commands

```bash
# Full dev setup (starts Docker containers, generates Prisma client, runs server+client)
# Database migrations run automatically on server start — no manual migrate command needed
npm run predev && npm run dev

# Run server and client concurrently
npm run dev

# Run individually
npm run dev:server          # Express on :3001 (tsx watch, hot reload)
npm run dev:client          # Vite on :3000 (proxies /api→:3001, /socket.io→:3002)

# Build
npm run build               # Both server (tsc) and client (vite build)
npm run build -w server     # Server only
npm run build -w client     # Client only

# Database (Prisma)
npm run db:generate         # Generate Prisma client types
npm run db:push             # Sync schema to database (no migration, manual only)
npm run db:migrate          # Run migrations (manual only — server auto-migrates on start)

# Code quality & verification
npm run verify              # Full pipeline: typecheck → lint → audit → build
npm run typecheck           # TypeScript type-check (both workspaces, no emit)
npm run lint                # ESLint (both workspaces via root flat config)
npm run lint:fix            # ESLint with auto-fix
npm run sast                # npm audit (dependency vulnerability scan)

# Docker
npm run docker:dev          # Start guacd + PostgreSQL containers (required for dev)
npm run docker:dev:down     # Stop dev containers
npm run docker:prod         # Full production stack (requires .env.production)
```

**Important:** `npm run verify` must pass before closing any task. It runs typecheck, lint, dependency audit, and build in sequence.

## Environment Setup

Copy `.env.example` to `.env`. PostgreSQL is used in both development and production. Docker is required for both PostgreSQL and `guacd` (Guacamole daemon). The `predev` script starts both containers automatically.

**Important:** The `.env` file lives at the **monorepo root**, not inside `server/`. Prisma CLI commands (`db:push`, `db:migrate`) run from the `server/` workspace directory, so `server/prisma.config.ts` explicitly resolves the `.env` path to `../.env`. Never add a separate `server/.env` — all env vars are loaded from the root `.env`.

## Documentation Maintenance

`docs/rag-summary.md` must be kept in sync whenever documentation or features change. If any feature is added, modified, or removed, update this file to reflect the current state.

## Architecture

**Monorepo** with npm workspaces: `server/`, `client/`, and `clients/browser-extensions/`.

### Server (Express + TypeScript)

Layered architecture: **Routes → Controllers → Services → Prisma ORM**

- `server/src/index.ts` — Entry point: runs `prisma migrate deploy` automatically, creates HTTP server, attaches Socket.IO and Guacamole WebSocket server
- `server/src/app.ts` — Express app setup with middleware and route mounting
- `server/src/routes/*.routes.ts` — Route definitions (auth, connections, folders, sharing, vault)
- `server/src/controllers/*.controller.ts` — Request parsing and validation
- `server/src/services/*.service.ts` — Business logic and database operations
- `server/src/socket/` — Socket.IO handlers for SSH terminal sessions
- `server/src/middleware/` — JWT auth middleware, error handler
- `server/src/types/index.ts` — Shared types (`AuthPayload`, `AuthRequest`, `EncryptedField`, `VaultSession`)
- `server/prisma/schema.prisma` — Data models: User, Connection, Folder, SharedConnection, RefreshToken

### Client (React 19 + Vite)

- `client/src/api/` — Axios client with automatic JWT refresh on 401
- `client/src/store/*Store.ts` — Zustand stores: `authStore`, `connectionsStore`, `tabsStore`, `vaultStore`
- `client/src/pages/` — Page components (Login, Register, Dashboard)
- `client/src/components/` — UI components (Layout, RDP viewer, Terminal, Dialogs, Tabs)
- `client/src/hooks/` — Custom hooks (`useAuth`, `useSocket`)
- UI framework: Material-UI (MUI) v7

### Browser Extension (Chrome Manifest V3)

- `clients/browser-extensions/` — Browser extension workspace (Chrome primary, Firefox secondary)
- `clients/browser-extensions/src/background.ts` — Service worker: handles all API calls to Arsenale servers (bypasses CORS), token refresh via chrome.alarms
- `clients/browser-extensions/src/popup/` — React popup app: account switcher, keychain browsing, connection listing
- `clients/browser-extensions/src/options/` — React options/settings page: multi-account management, server URL configuration
- `clients/browser-extensions/src/content/` — Content scripts for credential autofill on web pages
- `clients/browser-extensions/src/lib/` — Shared utilities: account storage, API client, auth, vault/secrets/connections API wrappers

## Key Patterns

### Real-Time Connections

- **SSH**: Client opens tab → Socket.IO connects to `/ssh` namespace → server creates SSH2 session → bidirectional terminal data via WebSocket. Terminal rendered with XTerm.js.
- **RDP**: Client requests token from `/sessions/rdp` → Guacamole WebSocket tunnel on port 3002 → `guacd` handles RDP protocol. Rendered with `guacamole-common-js`.

### Vault & Encryption

All connection credentials are encrypted at rest using AES-256-GCM. Each user has a master key derived from their password via Argon2. The master key is held in-memory server-side with a configurable TTL (vault sessions auto-expire). When the vault is locked, users must re-enter their password to decrypt credentials.

### Authentication

JWT-based with access tokens (short-lived) and refresh tokens (stored in DB). The Axios client interceptor automatically refreshes expired access tokens. Socket.IO connections authenticate via JWT middleware.

### Full-Screen Dialogs Over Navigation

Features that overlay the main workspace (settings, keychain, audit log, etc.) **must** be implemented as full-screen MUI `Dialog` components rendered from `MainLayout`, not as separate page routes. This preserves active RDP/SSH sessions. The only routed page is the main connections dashboard.

**Pattern (SettingsDialog / AuditLogDialog / KeychainDialog):**
- Import the shared `SlideUp` transition: `import { SlideUp } from '../common/SlideUp'`
- Props: `{ open: boolean; onClose: () => void }`
- Root element: `<Dialog fullScreen open={open} onClose={onClose} TransitionComponent={SlideUp}>`
- AppBar: `<AppBar position="static" sx={{ position: 'relative' }}>` + `<Toolbar variant="dense">` with `CloseIcon` button and title
- Content: `<Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', ... }}>`
- State managed in `MainLayout` as `const [xyzOpen, setXyzOpen] = useState(false)`
- Dialog rendered at the fragment root level in `MainLayout`, outside the blur wrapper `Box`

**Rule:** Never create a new page route for UI that opens over the dashboard. Use this dialog pattern instead.

### API Error Handling

Use `extractApiError(err, fallbackMessage)` from `client/src/utils/apiError.ts` for API error extraction in catch blocks. Never use inline type casts for Axios error responses. For dialog form submissions with loading/error state, prefer the `useAsyncAction` hook from `client/src/hooks/useAsyncAction.ts`.

### UI Preferences Persistence

All user-facing UI layout state **must** be persisted via the centralized `uiPreferencesStore` (`client/src/store/uiPreferencesStore.ts`), which uses Zustand's `persist` middleware with localStorage key `arsenale-ui-preferences`.

**What must be persisted:** panel open/closed states, sidebar section collapse/expand, drawer states, view mode toggles (compact, list/grid), positions and sizes of movable/resizable elements, folder expand/collapse states, and any user-configurable layout preference.

**Rules for any new feature:**
- Import from `useUiPreferencesStore` — never use raw `localStorage.getItem/setItem` for UI preferences
- Provide sensible defaults so the app works without any stored preferences
- Namespace by userId (the store handles this internally)
- Key naming: `camelCase` with component area prefix (e.g., `sidebarCompact`, `sidebarFavoritesOpen`, `rdpFileBrowserOpen`)
- Add new preference keys and their defaults to the store's type and initial state
- Exclude transient state (dialogs, menus, loading flags) — only persist what the user would expect to survive a page reload

### Task & Idea Management

Tasks and ideas are managed through one of three modes, controlled by `.claude/issues-tracker.json` (preferred) or `.claude/github-issues.json` (legacy fallback):

| `enabled` | `sync` | Mode | Data Source |
|-----------|--------|------|-------------|
| `true` | `false` (or absent) | **Platform-only** | GitHub/GitLab Issues only. No local files. |
| `true` | `true` | **Dual sync** | Local files first, then platform issues. |
| `false` | — | **Local only** | Local text files only. |

**Platform-only mode (current):** Tasks are GitHub Issues with status labels (`status:todo`, `status:in-progress`, `status:to-test`, `status:done`). Ideas are GitHub Issues with the `idea` label. No local task/idea text files exist. Tasks in `status:in-progress` may also carry `status:to-test`, indicating they are awaiting test verification before release.

**Local/Dual mode (when enabled):** Tasks are split across three files by status:

| File | Status | Symbol |
|------|--------|--------|
| `to-do.txt` | Pending tasks | `[ ]` |
| `progressing.txt` | In-progress tasks | `[~]` |
| `done.txt` | Completed tasks | `[x]` |

Ideas are stored separately:

| File | Purpose |
|------|---------|
| `ideas.txt` | Ideas awaiting evaluation |
| `idea-disapproved.txt` | Rejected ideas archive |

Use `/idea-create` to add ideas, `/idea-approve` to promote an idea to a task, `/idea-refactor` to update ideas based on codebase changes, and `/idea-disapprove` to reject an idea. Ideas must never be picked up directly by `/task-pick`.

### Release Planning

Tasks can be grouped into planned releases via `releases.json` at the project root. This is the single source of truth for release plans — platform labels (`release:vX.Y.Z`) and milestones are kept in sync as secondary artifacts.


---
_Output truncated to stay within size limit._
