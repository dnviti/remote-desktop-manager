# Infrastructure & Architecture Report

> Auto-generated static analysis for `arsenale`

## Languages & Ecosystems

| Language | Files |
| --- | --- |
| TypeScript | 281 |
| TypeScript/React | 99 |
| SQL | 50 |
| Shell | 9 |
| Python | 7 |
| JavaScript | 1 |
| HTML | 1 |
| Prisma | 1 |

**Primary ecosystem:** JavaScript

## Frameworks Detected

- Make
- Docker Compose

## Build System

| Indicator | System |
| --- | --- |
| package.json | npm/Node.js |
| Makefile | Make |

## Build Scripts

### `package.json`

| Script | Command |
| --- | --- |
| build | npm run build -w server && npm run build -w client |
| cli | npm run cli -w server -- |
| cli:dev | npm run cli:dev -w server -- |
| db:generate | npm run db:generate -w server |
| db:migrate | npm run db:migrate -w server |
| db:push | npm run db:push -w server |
| dev | concurrently -n server,client -c blue,green "npm run dev:server" "npm run dev:cl |
| dev:client | npm run dev -w client |
| dev:client:wait | wait-on -t 60000 http-get://localhost:3001/api/health && npm run dev -w client |
| dev:docker | $(./scripts/container-runtime.sh) compose -f compose.dev.yml up --build |
| dev:docker:detach | $(./scripts/container-runtime.sh) compose -f compose.dev.yml up --build -d |
| dev:server | npm run dev -w server |
| docker:dev | $(./scripts/container-runtime.sh) compose -f compose.dev.yml up -d |
| docker:dev:down | $(./scripts/container-runtime.sh) compose -f compose.dev.yml down |
| docker:prod | $(./scripts/container-runtime.sh) compose --env-file .env.production up -d --bui |
| lint | eslint . |
| lint:fix | eslint . --fix |
| predev | $(./scripts/container-runtime.sh) compose -f compose.dev.yml up -d postgres && n |
| sast | npm audit --audit-level=critical |
| security | ./scripts/security-scan.sh |
| security:docker | ./scripts/security-scan.sh --docker |
| security:quick | ./scripts/security-scan.sh --quick |
| typecheck | npm run typecheck -w server && npm run typecheck -w client |
| verify | npm run typecheck && npm run lint && npm run sast && npm run build |

### `server/package.json`

| Script | Command |
| --- | --- |
| build | tsc |
| cli | node dist/cli.js |
| cli:dev | tsx src/cli.ts |
| db:generate | prisma generate |
| db:migrate | prisma migrate dev |
| db:push | prisma db push |
| dev | tsx watch src/index.ts |
| start | node dist/index.js |
| typecheck | tsc --noEmit |

### `client/package.json`

| Script | Command |
| --- | --- |
| build | tsc -b && vite build |
| dev | vite |
| preview | vite preview |
| typecheck | tsc -b |

## Monorepo Workspaces

- `server`
- `client`

## CI/CD Pipelines

### GitHub Actions

| File | Name | Triggers |
| --- | --- | --- |
| .github/workflows/agentic-docs.yml | Agentic Fleet — Docs | push, workflow_dispatch |
| .github/workflows/agentic-fleet.yml | Agentic Fleet — Idea Scout | workflow_dispatch, release, issues |
| .github/workflows/agentic-task.yml | Agentic Fleet — Task Implementation | workflow_dispatch, issues |
| .github/workflows/docker-client.yml | Docker Client | push, pull_request, schedule, workflow_dispatch |
| .github/workflows/docker-server.yml | Docker Server | push, pull_request, schedule, workflow_dispatch |
| .github/workflows/guacenc-build.yml | Guacenc — Build & Scan | push, pull_request, schedule, workflow_dispatch |
| .github/workflows/release.yml | Release | push, release |
| .github/workflows/security-client.yml | Security Client | push, pull_request, schedule, workflow_dispatch |
| .github/workflows/security-server.yml | Security Server | push, pull_request, schedule, workflow_dispatch |
| .github/workflows/ssh-gateway-build.yml | SSH Gateway — Build & Scan | push, pull_request, schedule, workflow_dispatch |
| .github/workflows/verify-client.yml | Verify Client | push, pull_request, workflow_dispatch |
| .github/workflows/verify-server.yml | Verify Server | push, pull_request, workflow_dispatch |

## Containerization

### Dockerfiles

| File | Base Images | Multi-stage | Exposed Ports |
| --- | --- | --- | --- |
| Dockerfile.dev | node:22 | No | — |
| Dockerfile.dev | node:22 | No | — |
| ssh-gateway/Dockerfile | alpine:3.21 | No | 2222 8022 |
| .devcontainer/Dockerfile | node:22 | No | — |
| server/Dockerfile | node:22-alpine | No | 3001 3002 |
| client/Dockerfile | node:22-alpine, alpine:3.21 | Yes | 8080 |
| docker/guacenc/Dockerfile | alpine:3.18, alpine:3.18 | Yes | 3003 |

### Compose Files

**compose.dev.yml** — services: postgres, guacenc, arsenale-dev, pgdata_dev

**compose.demo.yml** — services: website, ollama-web, postgres, guacd, guacenc, server, demo-seed, client, ssh-gateway, ollama-backend, pgdata, arsenale_drive, arsenale_recordings, ollama_models, proxy-net, arsenale-front-net, arsenale-back-net

**compose.yml** — services: postgres, guacd, guacenc, server, client, ssh-gateway, pgdata, arsenale_drive, arsenale_recordings, arsenale_net

## Database

- **ORM:** Prisma
- **Provider:** postgresql
- **Models (58):** Tenant, Team, TeamMember, User, OAuthAccount, Folder, Connection, Gateway, GatewayTemplate, SshKeyPair, SharedConnection, RefreshToken, AuditLog, Notification, OpenTab, VaultSecret, VaultSecretVersion, SharedSecret, VaultFolder, TenantMember, TenantVaultMember, ExternalSecretShare, ActiveSession, WebAuthnCredential, ManagedGatewayInstance, SessionRecording, SyncProfile, SyncLog, AppConfig, Tenant, Team, TeamMember, User, OAuthAccount, Folder, Connection, Gateway, GatewayTemplate, SshKeyPair, SharedConnection, RefreshToken, AuditLog, Notification, OpenTab, VaultSecret, VaultSecretVersion, SharedSecret, VaultFolder, TenantMember, TenantVaultMember, ExternalSecretShare, ActiveSession, WebAuthnCredential, ManagedGatewayInstance, SessionRecording, SyncProfile, SyncLog, AppConfig
- **Enums (18):** TenantRole, TeamRole, AuthProvider, ConnectionType, GatewayType, GatewayHealthStatus, SessionProtocol, SessionStatus, ManagedInstanceStatus, LoadBalancingStrategy, Permission, SecretType, SecretScope, AuditAction, NotificationType, RecordingStatus, SyncProvider, SyncStatus
- **Migrations:** 1 files
- **Schema files:** server/prisma/schema.prisma, server/prisma/schema.prisma
- **SQL files:** 50

## API Endpoints

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

## Environment Configuration

- **Env files:** .env.example, .env.production.example
- **Variables in .env.example:** 121

## Monitoring & Logging

- **Logging:** Bunyan (Node.js), Log4j (Java), Log4js (Node.js), Logback (Java), Logrus (Go), Morgan (HTTP logger), NLog (.NET), Pino (Node.js), Python logging, SLF4J (Java), Serilog (.NET), Winston (Node.js), Zap (Go), slog (Go)
- **Monitoring/APM:** Datadog, Elastic APM, Grafana, New Relic, OpenTelemetry, Prometheus, Sentry, StatsD

## Dependency Summary

| Manifest | Name | Production | Dev |
| --- | --- | --- | --- |
| package.json | arsenale | 0 | 7 |
| server/package.json | server | 42 | 18 |
| client/package.json | client | 22 | 9 |

## Cross-Cutting Concerns

| Concern | Status |
| --- | --- |
| Authentication Middleware | detected |
| CORS | detected |
| CSRF Protection | detected |
| Compression | detected |
| Health Check | detected |
| Helmet / Security Headers | detected |
| Rate Limiting | detected |
| Request Validation | detected |

## Architecture Pattern Summary

| Layer/Role | Files |
| --- | --- |
| component | 86 |
| service | 61 |
| migration | 51 |
| route | 29 |
| controller | 28 |
| schema | 28 |
| api-client | 27 |
| utility | 26 |
| documentation | 16 |
| middleware | 16 |
| hook | 15 |
| store | 14 |
| ci-cd | 12 |
| container | 11 |
| page | 10 |
| config | 4 |
| handler | 3 |
| template | 2 |

## Identified Gaps

No significant gaps detected.
