---
name: docs
description: "Manage all project documentation. Operations: create, update, verify (docs/ folder); sync (task files + doc alignment); claude-md (update CLAUDE.md from code changes). Usage: /docs <operation> [args]."
disable-model-invocation: true
allowed-tools: Bash, Read, Grep, Glob, Edit, Write
argument-hint: "<create|update|verify|sync|claude-md> [category or context]"
---

# Documentation Manager

You are a documentation manager for the Arsenale project. Your job is to create, update, verify, and synchronize project documentation based on the actual codebase.

## Current Documentation State

### Existing docs/ files:
!`ls -1 docs/*.md 2>/dev/null || echo "(none — docs/ directory does not exist yet)"`

### README.md:
!`test -f README.md && echo "Exists ($(wc -l < README.md) lines)" || echo "Missing"`

### Files changed in last 5 commits:
!`git diff --name-only HEAD~5..HEAD 2>/dev/null | sort -u`

### In-progress tasks:
!`grep '^\[~\]' progressing.txt 2>/dev/null | tr -d '\r'`

### Recently completed tasks (last 5):
!`grep '^\[x\]' done.txt 2>/dev/null | tail -5 | tr -d '\r'`

## Arguments

The user invoked: **$ARGUMENTS**

## Instructions

### Step 1: Parse the command

Extract the **operation** and optional **category/context** from `$ARGUMENTS`:
- Format: `<operation> [category]`
- Valid operations: `create`, `update`, `verify`, `sync`, `claude-md`
- Valid categories (for create/update/verify): `api`, `database`, `components`, `architecture`, `security`, `deployment`, `environment`, `rag`, `all`
- If no category is given for create/update/verify, default to `all`
- If arguments are empty or invalid, show this usage guide and stop:

```
Usage: /docs <operation> [category]

Operations:
  create     — Generate new documentation from code
  update     — Refresh existing docs to match current code
  verify     — Check docs accuracy (read-only, no changes)
  sync       — Synchronize task files and align related documentation
  claude-md  — Update CLAUDE.md to reflect current codebase state

Categories (for create/update/verify):
  api           — REST API endpoint reference
  database      — Prisma schema, models, relations
  components    — React components, pages, stores, hooks
  architecture  — System overview, data flows, structure
  security      — Vault encryption, JWT auth, key derivation
  deployment    — Docker, nginx, environment setup
  environment   — Environment variables reference
  rag           — High-level product summary for LLM RAG consumption
  all           — All categories (default)

Examples:
  /docs create api
  /docs verify
  /docs update database
  /docs sync
  /docs claude-md
```

### Step 2: Route to the correct operation

Based on the parsed operation, follow the corresponding section below.

---

## Operation: CREATE

Generate new documentation. For each category, read the specified source files and produce a well-structured markdown document in `docs/`.

**Before writing any files**, create the `docs/` directory if it does not exist:
```bash
mkdir -p docs
```

Every generated document MUST begin with this header:

```markdown
# [Document Title]

> Auto-generated on [YYYY-MM-DD] by `/docs create [category]`.
> Source of truth is the codebase. Run `/docs update [category]` after code changes.
```

### Category: api

**Output**: `docs/api.md`

**Read these files**:
- `server/src/app.ts` (route mounting and base paths)
- All files in `server/src/routes/*.routes.ts`
- All files in `server/src/controllers/*.controller.ts`

**Document structure**:
1. **Overview** — list all route groups with their base paths
2. **Authentication** — explain JWT Bearer requirement, which routes are public vs protected
3. **For each route group** (Auth, Connections, Folders, Sharing, Vault, User, Sessions/Health):
   - Group header with base path
   - Each endpoint: `METHOD /full/path` — description, auth required (yes/no), request body (from Zod schema if present), response shape, error codes
4. **WebSocket endpoints** — document Socket.IO `/ssh` namespace events and Guacamole WebSocket on port 3002

### Category: database

**Output**: `docs/database.md`

**Read these files**:
- `server/prisma/schema.prisma`

**Document structure**:
1. **Overview** — database provider, connection info
2. **Entity-Relationship summary** — text description of how models relate
3. **For each model** (User, Folder, Connection, SharedConnection, RefreshToken):
   - Table with columns: Field, Type, Constraints, Description
   - Relations section listing foreign keys and cardinality
4. **Enums** — document ConnectionType and Permission with values
5. **Indexes and unique constraints**

### Category: components

**Output**: `docs/components.md`

**Read these files**:
- All `.tsx` files in `client/src/pages/`
- All `.tsx` files in `client/src/components/` (recursively)
- All `.ts` files in `client/src/store/`
- All `.ts` files in `client/src/hooks/`
- All `.ts` files in `client/src/api/`

**Document structure**:
1. **Overview** — client tech stack (React 19, Vite, MUI v6, Zustand)
2. **Pages** — for each page: purpose, route, key features, stores used
3. **Components** — grouped by subdirectory (Layout, Sidebar, Tabs, Dialogs, Terminal, RDP, Overlays). For each: purpose, props, behavior notes
4. **State Management** — for each Zustand store: state shape, actions, selectors
5. **Hooks** — for each custom hook: purpose, parameters, return value
6. **API Layer** — for each API module: endpoints called, request/response types

### Category: architecture

**Output**: `docs/architecture.md`

**Read these files**:
- `server/src/index.ts`, `server/src/app.ts`, `server/src/config.ts`
- `server/src/socket/index.ts`, `server/src/socket/ssh.handler.ts`, `server/src/socket/rdp.handler.ts`
- `client/nginx.conf`
- `docker-compose.yml`, `docker-compose.dev.yml`
- Root `package.json`

**Document structure**:
1. **System Overview** — monorepo layout, workspace structure
2. **Server Architecture** — layered pattern (Routes → Controllers → Services → Prisma), entry point, middleware pipeline
3. **Client Architecture** — component tree, state management approach, API layer pattern
4. **Real-Time Connection Flows**:
   - SSH flow: Client tab open → Socket.IO `/ssh` namespace → ssh2 session → bidirectional data
   - RDP flow: Client requests token → Guacamole WebSocket tunnel → guacd → RDP protocol
5. **Network Topology** — ports, proxy configuration, WebSocket upgrade paths
6. **Development vs Production** — differences in Docker setup, proxy config

### Category: security

**Output**: `docs/security.md`

**Read these files**:
- `server/src/services/crypto.service.ts`
- `server/src/services/auth.service.ts`
- `server/src/services/vault.service.ts`
- `server/src/middleware/auth.middleware.ts`
- `server/src/types/index.ts`
- `client/src/api/client.ts`

**Document structure**:
1. **Overview** — security model summary
2. **Vault Encryption**:
   - Algorithm: AES-256-GCM with exact parameters (IV length, key length, salt length — read from code)
   - Key derivation: Argon2id with exact parameters (memoryCost, timeCost, parallelism, hashLength — read from code)
   - Master key lifecycle: generation, encryption with derived key, storage, in-memory session
   - Encrypted field structure (ciphertext, IV, tag)
3. **Vault Session Management**:
   - Session lifecycle (unlock, TTL, sliding window, lock, auto-expiry)
   - Memory cleanup (zeroing keys, periodic cleanup interval)
4. **Authentication**:
   - JWT token structure, signing, expiration
   - Refresh token flow (storage in DB, rotation)
   - Client-side auto-refresh interceptor
   - Socket.IO JWT middleware
5. **Connection Sharing Security** — how credentials are re-encrypted for shared users
6. **Security Considerations** — what to configure for production

### Category: deployment

**Output**: `docs/deployment.md`

**Read these files**:
- `docker-compose.yml`, `docker-compose.dev.yml`
- `server/Dockerfile`, `client/Dockerfile`
- `client/nginx.conf`
- `.env.example`, `.env.production.example`
- Root `package.json` (scripts section)

**Document structure**:
1. **Prerequisites** — Node.js, Docker, npm versions
2. **Development Setup** — step-by-step (clone, install, env, docker, dev server)
3. **Production Deployment**:
   - Environment configuration (`.env.production`)
   - Docker Compose topology (4 containers: postgres, guacd, server, client)
   - Service dependencies and health checks
   - Volume management (pgdata persistence)
4. **Nginx Configuration** — reverse proxy routes (`/api`, `/socket.io`, `/guacamole`, SPA fallback)
5. **Available Scripts** — all npm scripts with descriptions
6. **Troubleshooting** — common issues (IPv6/localhost on Windows, Docker networking)

### Category: environment

**Output**: `docs/environment.md`

**Read these files**:
- `.env.example`
- `.env.production.example`
- `server/src/config.ts`

**Document structure**:
1. **Overview** — how env vars are loaded
2. **Variable reference table**: Variable, Type, Default, Required, Environment (dev/prod/both), Description, Security Notes
3. **Development defaults**
4. **Production configuration** — which vars need strong random values, how to generate them
5. **Docker-specific variables** — POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB

### Category: rag

**Output**: `docs/rag-summary.md`

**Read these files**:
- All existing `docs/*.md` files (architecture, database, api, security, components, deployment, environment)
- `README.md`

This document is a **high-level marketing-oriented product overview** designed to be consumed as RAG context by an LLM. It must stay within **~4096 tokens** (~3000 words max).

**Important**: This is NOT a technical reference. It must contain only product-level information — no code paths, no internal architecture details, no API routes, no database schemas, no encryption parameters, no environment variables.

**Document structure**:
1. **What is Arsenale** — product description, positioning vs alternatives (mRemoteNG, RoyalTS, Apache Guacamole)
2. **Who is it for** — target personas (IT teams, MSPs, DevOps, security-conscious orgs, multi-tenant environments)
3. **Remote Access** — SSH terminals (XTerm.js, tabs, configurable), integrated SFTP file browser, RDP remote desktop (Guacamole, clipboard sync, drive redirection, customizable settings), VNC, SSH gateway bastion hosts
4. **Encrypted Credential Vault** — encryption at rest, auto-lock, vault secrets manager (versioning, expiry alerts, sharing), recovery key
5. **Team Collaboration and Sharing** — connection sharing with granular permissions (view/use/edit/admin), re-encryption model, team workspaces with shared vault, folder organization with drag-and-drop, external sharing with PIN protection and time/access limits
6. **Multi-Tenant Organizations** — tenant isolation, roles (owner/admin/member), tenant-level policies (mandatory MFA, vault timeout caps, session timeouts), user management, multi-org membership with seamless switching
7. **Security** — MFA methods (TOTP, SMS OTP, WebAuthn passkeys), identity verification for sensitive ops, account lockout, audit logging (100+ action types), session monitoring with idle detection and remote termination
8. **Infrastructure Management** — SSH gateways, managed container instances with auto-scaling (Docker/Podman/Kubernetes), SSH key rotation
9. **User Experience** — Material UI with dark/light mode, tabbed workspace with persistence, customizable terminals and RDP settings, persistent UI preferences, real-time notifications, OAuth SSO (Google, Microsoft, GitHub, OIDC, SAML), email verification (SMTP, SendGrid, SES, Resend, Mailgun), pop-out sessions
10. **Deployment** — single Docker Compose command, simple .env config, automatic migrations, Docker/Podman support, non-root containers, volume persistence
11. **Technology** — brief tech stack mention (Node.js/TypeScript, React, PostgreSQL, modern open-source stack, clean architecture)

**Style rules**:
- Write in a descriptive, product-marketing tone — explain what features do and why they matter
- Use full sentences and paragraphs, not terse bullet lists
- No code blocks, no file paths, no function names, no config keys
- No `<!-- manual-start -->` / `<!-- manual-end -->` markers (this file is fully auto-generated)
- Header: `> Auto-generated on [YYYY-MM-DD]. High-level product overview for LLM RAG consumption.`

### When category is `all`

Run create for each category in this order: architecture, database, api, security, components, deployment, environment, rag. Present a summary at the end listing all files created with line counts.

---

## Operation: UPDATE

Refresh existing documentation to match current code.

### Step 1: Check existing docs

For the specified category, check if `docs/[category].md` exists. If not, inform the user and suggest running `/docs create [category]` instead.

### Step 2: Identify drift

Read the existing doc file AND the same source files specified in the CREATE section for that category. Compare and identify:
- **Missing items**: code elements in source but not documented
- **Removed items**: documented elements that no longer exist in code
- **Changed items**: documented details that no longer match code

### Step 3: Update the document

Regenerate the document following the same structure as CREATE, but:
- **Preserve manual sections**: any content between `<!-- manual-start -->` and `<!-- manual-end -->` markers must be kept unchanged
- Update the timestamp in the header
- Keep the same file path

### Step 4: Report changes

After updating, present a summary:

```
## Update Summary: docs/[category].md

**Changes made:**
- Added: [list of new items documented]
- Updated: [list of items whose documentation changed]
- Removed: [list of items removed from docs]
- Preserved: [count] manual sections unchanged

**Files read**: [list of source files consulted]
```

### When category is `all`

Iterate through all existing `.md` files in `docs/` and update each one (including `rag-summary.md`). If a category file is missing, skip it and note it in the summary. Always update `rag-summary.md` last, since it draws content from the other docs.

---

## Operation: VERIFY

Check documentation accuracy without modifying any files. This is a **read-only** operation — do NOT edit or write any files.

### Step 1: Inventory existing documentation

List all documentation files: `docs/*.md`, `README.md`, `CLAUDE.md`.

### Step 2: Verify each document

For each existing doc file, read it and compare against the actual source code. Use the same source file lists defined in the CREATE section for each category.

**Specific checks per category:**

- **api**: Every route in `server/src/routes/*.routes.ts` has a corresponding entry. Every route prefix in `server/src/app.ts` is documented. HTTP methods and paths match.
- **database**: Every model and field in `server/prisma/schema.prisma` is documented. Field types and constraints match.
- **components**: Every `.tsx` file in `client/src/components/` and `client/src/pages/` is documented. Every store and hook is documented.
- **architecture**: Documented ports match `server/src/config.ts`. File paths in docs exist.
- **security**: Algorithm parameters match constants in `server/src/services/crypto.service.ts`. Argon2 parameters match.
- **deployment**: Docker services match `docker-compose.yml`. Nginx locations match `client/nginx.conf`.
- **environment**: Every variable in `.env.example` and `server/src/config.ts` is documented. Defaults match.
- **rag**: File exists and is within ~4096 tokens (~3000 words). Contains only high-level marketing content — no code paths, API routes, env vars, or internal architecture. All major product features are represented.

**Also verify README.md:**
- Project structure tree matches actual filesystem
- Scripts section matches root `package.json` scripts
- Environment variable table matches `.env.example`
- Tech stack info is current

### Step 3: Present verification report

```
## Documentation Verification Report

**Date**: [current date]
**Overall Status**: [PASS | DRIFT DETECTED | DOCS MISSING]

### File Inventory
| File | Exists | Last Modified |
|------|--------|---------------|
| docs/api.md | Yes/No | date or N/A |
| docs/database.md | Yes/No | date or N/A |
| docs/components.md | Yes/No | date or N/A |
| docs/architecture.md | Yes/No | date or N/A |
| docs/security.md | Yes/No | date or N/A |
| docs/deployment.md | Yes/No | date or N/A |
| docs/environment.md | Yes/No | date or N/A |
| docs/rag-summary.md | Yes/No | date or N/A |
| README.md | Yes/No | date or N/A |

### Drift Report
| Document | Status | Issues Found |
|----------|--------|-------------|
| [file] | OK / DRIFT / MISSING | [count] issues |

### Detailed Findings

#### [document name]
- [MISSING] Endpoint `POST /api/connections/:id/share` not documented
- [DRIFT] Field `Connection.isFavorite` documented as String, actual type is Boolean
- [STALE] Component `OldDialog.tsx` documented but file no longer exists
...

### Recommended Actions
- Run `/docs create [category]` for missing documents
- Run `/docs update [category]` for drifted documents
```

If a single category was specified, only verify that category (plus README.md). If `all` or no category, verify everything.

---

## Operation: SYNC

Synchronize task tracking files and align related documentation when tasks change status.

### Step 1: Assess Current State
- Read all three task files (`to-do.txt`, `progressing.txt`, `done.txt`)
- Identify which tasks have recently changed status based on the conversation context
- If invoked without specific context, scan all three files for inconsistencies

### Step 2: Update Task Files
- Move tasks to the correct file based on their new status
- Ensure the status symbol matches the file (`[ ]`, `[~]`, or `[x]`)
- Preserve task descriptions exactly — do not rephrase or summarize
- Maintain chronological or logical ordering within each file
- Add timestamps or dates to completed tasks in done.txt if that convention exists

### Step 3: Review Documentation Impact
- For each progressed/completed task, determine if it affects any documentation:
  - New features → update feature documentation, README sections
  - Architecture changes → update CLAUDE.md architecture section
  - New commands or scripts → update Development Commands section in CLAUDE.md
  - New file patterns → update File Naming Conventions table in CLAUDE.md
  - New environment variables → update Environment Setup section
  - API changes → update relevant API documentation
  - New UI components or stores → update client architecture docs
  - New dependencies → note in relevant documentation

### Step 4: Apply Documentation Updates
- Make precise, targeted edits — do not rewrite entire documents
- Maintain the existing documentation style and format
- Add new sections only when genuinely needed
- Keep language clear, concise, and technical
- Ensure all code examples and command references are accurate

### Step 5: Verify Consistency
- Cross-check that no task appears in multiple files
- Verify that documentation references match actual file paths and command names
- Ensure no stale references to removed or renamed features remain
- Confirm the task count adds up (no tasks lost in transition)

### Sync Quality Standards

- **Accuracy over completeness**: Only document what is actually implemented.
- **Minimal diffs**: Make the smallest possible changes to achieve alignment.
- **Preserve voice**: Match the existing documentation tone and conventions exactly.
- **No data loss**: Never delete task entries — only move them between files. If cancelled, move to done.txt with a `[cancelled]` note.

### Sync Edge Cases

- **Task partially completed**: Keep in `progressing.txt` with `[~]` and add a note about what remains
- **Task split into subtasks**: Create new entries in the appropriate files and reference the parent task
- **Task reverted**: Move back from `done.txt` to `progressing.txt` or `to-do.txt` with a note
- **No documentation impact**: Explicitly state that no documentation updates are needed after updating task files

### Sync Summary

After completing, provide:
1. Which tasks were moved and between which files
2. Which documentation files were updated and what changed
3. Any inconsistencies found and how they were resolved
4. Any items that need human review or decision

---

## Operation: CLAUDE-MD

Update `CLAUDE.md` to reflect the current state of the codebase. Use this after architectural changes, new patterns, new commands, schema changes, or any structural change.

### Step 1: Understand What Changed

Before making any updates, thoroughly investigate what has changed:

1. **Read the current CLAUDE.md** to understand its existing structure and content.
2. **Examine recent file changes** — look at new, modified, or deleted files to understand the scope of changes.
3. **Read relevant source files** — don't guess about new patterns or architecture; read the actual code.
4. **Check package.json files** (root, server/, client/) for new scripts, dependencies, or workspace changes.
5. **Check the Prisma schema** if database models may have changed.
6. **Check configuration files** (tsconfig, vite.config, eslint config, Docker files) for tooling changes.

### Step 2: Determine What Needs Updating

Compare findings against each section of CLAUDE.md:

- **Development Commands** — New scripts, changed scripts, removed scripts.
- **Environment Setup** — New env vars, changed database setup, new Docker containers, changed ports.
- **Architecture** — New directories, layers, entry points, restructured code, new workspaces.
  - Server: new route files, controllers, services, middleware, socket namespaces, type definitions, schema changes.
  - Client: new API files, stores, pages, components, hooks, UI framework changes.
- **Key Patterns** — New or changed patterns for real-time connections, vault/encryption, authentication, UI preferences, task management, or any new cross-cutting concern.
- **File Naming Conventions** — New file types or changed naming patterns.

### Step 3: Apply Updates Surgically

1. **Preserve the existing structure and style.** Match tone, formatting, heading levels, table formats, and bullet point style.
2. **Be precise and concise.** Every line should provide actionable information.
3. **Add new sections only when necessary.**
4. **Update, don't just append.** Modify existing content rather than adding contradictory new content.
5. **Remove outdated information.** Stale information is worse than missing information.
6. **Maintain the imperative/instructional tone.** Write "Use X for Y" not "We added X for Y".
7. **Keep command blocks accurate.** Verify against package.json scripts.
8. **Preserve all existing rules and constraints** unless they have explicitly changed.

### Step 4: Validate Your Changes

1. Re-read the entire file to ensure consistency and flow.
2. Verify no contradictions exist between sections.
3. Check that all file paths mentioned actually exist in the current codebase.
4. Ensure all commands mentioned are valid by cross-referencing with package.json scripts.
5. Confirm table formatting is correct and aligned.

### CLAUDE-MD Rules

- **Never remove the `npm run verify` requirement.**
- **Never change the Language section** unless explicitly instructed.
- **Never add speculative content** — only document what actually exists.
- **Never duplicate information** — reference rather than repeat.
- **Always preserve the Task Files section** format and rules.
- **Always maintain the File Naming Conventions table** with accurate patterns.
- **Keep CLAUDE.md focused** — only information that helps Claude Code work with this codebase.

---

## Important Guidelines

1. **Always read source code** before writing or verifying documentation. Never guess — always base documentation on actual file contents.
2. **Use consistent formatting** across all doc files: ATX headers, fenced code blocks, tables with alignment.
3. **Include code references** where helpful: file paths, function names, type names.
4. **Be precise about security parameters**: always read the actual values from `crypto.service.ts` rather than assuming.
5. **Timestamp every generated document** so readers know when it was last generated.
6. **Manual section markers**: When creating docs, add a `<!-- manual-start -->` / `<!-- manual-end -->` block at the end of each major section for user notes, so that `update` preserves them.
7. **Do not modify README.md** during create/update operations. Only check it during verify.
8. **Language**: All documentation must be written in English.
