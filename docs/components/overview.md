# Components Overview

> Auto-generated on 2026-03-15 by /docs create components.
> Source of truth is the codebase. Run /docs update components after code changes.

## Overview

The client is built with:

- **React 19** with TypeScript
- **Vite** — build tool and dev server
- **Material-UI (MUI) v7** — component library and theming
- **Zustand** — state management (17 stores with localStorage persistence for UI preferences)
- **Axios** — HTTP client with JWT auto-refresh
- **WebSocket / Guacamole clients** — real-time SSH terminals, desktop sessions, and broker transport
- **XTerm.js** — SSH terminal emulation
- **guacamole-common-js** — RDP/VNC remote desktop rendering

**Total**: 11 pages, 88+ components, 17 stores, 15 hooks, 40 API modules.

<!-- manual-start -->
<!-- manual-end -->

## Pages

| Page | Route | Purpose | Key Stores |
|------|-------|---------|------------|
| `LoginPage` | `/login` | Passkey-first login with password fallback after user choice or repeated failures, tenant-aware MFA challenge (email/TOTP/SMS/WebAuthn), forced MFA setup, tenant selection | authStore, vaultStore |
| `RegisterPage` | `/register` | User registration with email verification and recovery key display | authStore |
| `DashboardPage` | `/` | Main app shell — fetches connections, restores tabs, renders MainLayout | connectionsStore, tabsStore |
| `ConnectionViewerPage` | `/viewer/:id` | Standalone popup window for a single connection (SSH/RDP/VNC) with auth bootstrap | tabsStore, authStore |
| `RecordingPlayerPage` | `/recordings/:id` | Standalone popup player for session recordings (asciicast or .guac) | authStore |
| `PublicSharePage` | `/share/:token` | Unauthenticated page for externally shared secrets (optional PIN) | — |
| `OAuthCallbackPage` | `/oauth/callback` | Handles OAuth redirects, extracts tokens, redirects to dashboard or vault setup | authStore |
| `VaultSetupPage` | `/vault-setup` | Post-OAuth vault password setup for OAuth-only users | authStore |
| `ForgotPasswordPage` | `/forgot-password` | Password reset email request form | — |
| `ResetPasswordPage` | `/reset-password` | Multi-step password reset (token validation, optional SMS, new password) | — |
| `SetupWizardPage` | `/setup` | First-run setup wizard for initial admin account and tenant configuration | authStore |

<!-- manual-start -->
<!-- manual-end -->
