# Code Quality, Performance & Maintainability Report

> Auto-generated static analysis for `arsenale`

## Test Coverage

- **Test files:** 0
- **Source files:** 388
- **Test-to-source ratio:** 0.0%

| Directory | Source | Tests | Ratio |
| --- | --- | --- | --- |
| .claude/scripts | 6 | 0 | 0.0% |
| client/src | 166 | 0 | 0.0% |
| client/vite.config.ts | 1 | 0 | 0.0% |
| docker/guacenc | 1 | 0 | 0.0% |
| eslint.config.mjs | 1 | 0 | 0.0% |
| server/prisma.config.ts | 1 | 0 | 0.0% |
| server/src | 212 | 0 | 0.0% |

## Complexity Hotspots

| File | Lines | Functions | Max Nesting |
| --- | --- | --- | --- |
| client/src/components/Settings/TenantSection.tsx | 1020 | 42 | 16 |
| server/src/services/auth.service.ts | 948 | 87 | 6 |
| server/src/services/tenant.service.ts | 831 | 53 | 7 |
| server/src/socket/ssh.handler.ts | 766 | 48 | 8 |
| server/src/services/managedGateway.service.ts | 723 | 48 | 8 |
| .claude/scripts/analyzers/infrastructure.py | 692 | 15 | 19 |
| client/src/components/Sidebar/ConnectionTree.tsx | 687 | 30 | 10 |
| server/src/services/connection.service.ts | 683 | 42 | 5 |
| client/src/components/Settings/GatewaySection.tsx | 680 | 22 | 19 |
| server/src/services/secret.service.ts | 674 | 41 | 7 |
| client/src/pages/LoginPage.tsx | 671 | 37 | 11 |
| client/src/constants/terminalThemes.ts | 661 | 11 | 4 |
| server/src/services/importExport.service.ts | 643 | 60 | 7 |
| .claude/scripts/analyzers/quality.py | 584 | 15 | 11 |
| server/src/cli/commands/user.commands.ts | 560 | 44 | 7 |

## Code Duplication

- **Files analyzed:** 384
- **Duplicated code blocks:** 1356

**Top file pairs with shared code:**

- `client/src/components/RDP/RdpViewer.tsx` ↔ `client/src/components/VNC/VncViewer.tsx` (191 shared blocks)
- `client/src/components/Dialogs/AuditLogDialog.tsx` ↔ `client/src/components/Settings/TenantAuditLogSection.tsx` (157 shared blocks)
- `client/src/components/Dialogs/ConnectionAuditLogDialog.tsx` ↔ `client/src/components/Settings/TenantAuditLogSection.tsx` (154 shared blocks)
- `client/src/components/Dialogs/AuditLogDialog.tsx` ↔ `client/src/components/Dialogs/ConnectionAuditLogDialog.tsx` (146 shared blocks)
- `client/src/components/Dialogs/ShareDialog.tsx` ↔ `client/src/components/Keychain/ShareSecretDialog.tsx` (81 shared blocks)
- `client/src/components/Settings/SmsMfaSection.tsx` ↔ `client/src/components/Settings/TwoFactorSection.tsx` (52 shared blocks)
- `client/src/components/Dialogs/FolderDialog.tsx` ↔ `client/src/components/Keychain/VaultFolderDialog.tsx` (42 shared blocks)
- `client/src/components/Dialogs/ConnectionDialog.tsx` ↔ `client/src/components/gateway/GatewayDialog.tsx` (36 shared blocks)
- `client/src/pages/LoginPage.tsx` ↔ `client/src/pages/RegisterPage.tsx` (36 shared blocks)
- `client/src/components/Dialogs/ShareDialog.tsx` ↔ `client/src/components/Dialogs/ShareFolderDialog.tsx` (30 shared blocks)

## Error Handling

- **try/catch blocks:** 344
- **Empty catch blocks:** 3 ⚠️
- **Unhandled promise patterns:** 35 ⚠️
- **Files with issues:** 30

## Type Safety

- **`any` usage:** 32 occurrences in 7 files ⚠️
- **@ts-ignore / @ts-expect-error:** 0
- **eslint-disable:** 115
- **Python type: ignore:** 2

## Documentation Quality

- **Files with doc comments:** 47/205 (22.9%)
- **Total doc comments:** 223
- **docs/ directory:** 8 files
- **README.md:** exists (221 lines)

## Naming Conventions

- **Dominant convention:** camelCase
- **Inconsistent files:** 103
| Convention | Files |
| --- | --- |
| camelCase | 285 |
| PascalCase | 95 |
| kebab-case | 5 |
| snake_case | 3 |

## Security Practices

- **Security headers (Helmet):** detected
- **CORS configuration:** detected

**⚠️ Security issues found (1):**

- `server/src/cli/commands/demo.commands.ts`: Hardcoded password

## Technical Debt Summary

- Low test coverage (0.0% test-to-source ratio)
- 3 empty catch blocks swallowing errors
- Excessive `any` type usage (32 occurrences)
- Inconsistent file naming (103 files deviate from camelCase)
- 30 complexity hotspots (files >300 lines or >15 functions)
- 1356 potential code duplication blocks
