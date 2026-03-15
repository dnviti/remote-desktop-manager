# Components Overview

> Auto-generated on 2026-03-15 by /docs create components.
> Source of truth is the codebase. Run /docs update components after code changes.

## Overview

The client is built with:

- **React 19** with TypeScript
- **Vite** — build tool and dev server
- **Material-UI (MUI) v7** — component library and theming
- **Zustand** — state management (14 stores with localStorage persistence for UI preferences)
- **Axios** — HTTP client with JWT auto-refresh
- **Socket.IO Client** — real-time SSH terminals, notifications, gateway monitoring
- **XTerm.js** — SSH terminal emulation
- **guacamole-common-js** — RDP/VNC remote desktop rendering

**Total**: 10 pages, 88 components, 14 stores, 13 hooks, 29 API modules.

<!-- manual-start -->
<!-- manual-end -->

## Pages

| Page | Route | Purpose | Key Stores |
|------|-------|---------|------------|
| `LoginPage` | `/login` | Multi-step login: email/password, MFA challenge (TOTP/SMS/WebAuthn), forced MFA setup, tenant selection | authStore, vaultStore |
| `RegisterPage` | `/register` | User registration with email verification and recovery key display | authStore |
| `DashboardPage` | `/` | Main app shell — fetches connections, restores tabs, renders MainLayout | connectionsStore, tabsStore |
| `ConnectionViewerPage` | `/viewer/:id` | Standalone popup window for a single connection (SSH/RDP/VNC) with auth bootstrap | tabsStore, authStore |
| `RecordingPlayerPage` | `/recordings/:id` | Standalone popup player for session recordings (asciicast or .guac) | authStore |
| `PublicSharePage` | `/share/:token` | Unauthenticated page for externally shared secrets (optional PIN) | — |
| `OAuthCallbackPage` | `/oauth/callback` | Handles OAuth redirects, extracts tokens, redirects to dashboard or vault setup | authStore |
| `VaultSetupPage` | `/vault-setup` | Post-OAuth vault password setup for OAuth-only users | authStore |
| `ForgotPasswordPage` | `/forgot-password` | Password reset email request form | — |
| `ResetPasswordPage` | `/reset-password` | Multi-step password reset (token validation, optional SMS, new password) | — |

<!-- manual-start -->
<!-- manual-end -->
