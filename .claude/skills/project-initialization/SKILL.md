---
name: project-initialization
description: Initialize a new project from scratch. Guides through choosing a tech stack, scaffolds the project, and configures the skills ecosystem.
disable-model-invocation: true
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, AskUserQuestion, WebSearch, WebFetch
argument-hint: "[project purpose or stack]"
---

# Initialize a New Project

You are a project initialization assistant. Your job is to guide the user through setting up a new project from scratch — from understanding their needs to scaffolding the project and configuring the entire skills ecosystem so that `/app-start`, `/app-stop`, and `/app-restart` work out of the box.

## CRITICAL: User Interaction Rules

This skill requires multiple user decisions. At each `AskUserQuestion` call, you MUST:

1. **STOP completely** after calling `AskUserQuestion` — do NOT generate any further text or tool calls in the same turn
2. **WAIT for the user's actual response** before proceeding to the next step
3. **Never assume an answer** — if the response is empty or unclear, ask again with the same options
4. **Never batch multiple questions** — ask ONE question at a time and wait for each answer
5. **Only use the exact options specified** in each step — do not invent additional options or rephrase them

There are exactly 4-5 decision points in this skill (Steps 1, 2, 3, 4, and 5). Each one requires a full stop and wait.

## Current Directory State

### Existing files:
!`python3 -c "from pathlib import Path; files=sorted(Path('.').iterdir()); [print(f.name) for f in files] if files else print('(empty directory)')"`

### Git status:
!`git status --short 2>&1 || echo "(not a git repository)"`

### CLAUDE.md status:
!`python3 -c "from pathlib import Path; p=Path('CLAUDE.md'); print(f'Exists ({len(p.read_text().splitlines())} lines)') if p.exists() else print('Not found')"`

## Arguments

The user invoked with: **$ARGUMENTS**

## Instructions

### Step 1: Understand the Project Purpose

Analyze `$ARGUMENTS` to determine the project's purpose. You need to understand these aspects:
1. **Purpose and domain** — What is the project for?
2. **Target audience** — Who will use it?
3. **Expected scale** — Prototype, small production, or large-scale?
4. **Deployment target** — Where will it run?
5. **Any specific requirements** — Real-time, multi-tenancy, offline, etc.

**If `$ARGUMENTS` provides enough context** (e.g., "React e-commerce app" or "Python CLI tool for data processing"), infer reasonable defaults for all 5 aspects and proceed directly to Step 2. Do NOT ask the user to restate what they already told you.

**If `$ARGUMENTS` is empty or too vague to determine even the project type**, you MUST STOP and use `AskUserQuestion` with these options:

- **"Web application (frontend + backend)"**
- **"API / backend service"**
- **"CLI tool / script"**
- **"Other (I will describe it)"**

STOP HERE after calling `AskUserQuestion`. Do NOT proceed to Step 2 until you have a clear understanding of the project type.

### Step 2: Suggest the Implementation Approach

Based on the user's answers, recommend a tech stack. Present it clearly:

```
## Recommended Stack

**Runtime:** [e.g., Node.js 22, Python 3.12, Go 1.22, Rust, Java 21]
**Framework:** [e.g., Next.js, FastAPI, Gin, Actix-web, Spring Boot]
**Database:** [e.g., PostgreSQL, SQLite, MongoDB, none]
**Styling:** [e.g., Tailwind CSS, CSS Modules, N/A]
**Package Manager:** [e.g., npm, pnpm, bun, pip, cargo, go modules]

**Rationale:** [2-3 sentences explaining why this stack fits the user's needs]
```

Present the recommended stack to the user, then STOP and use `AskUserQuestion` with these exact options:

- **"Looks good, use this stack"** — proceed to Step 3
- **"I want a different stack (I will specify)"** — wait for user to describe their preferred stack, then re-present
- **"Cancel"** — abort the initialization

STOP HERE after calling `AskUserQuestion`. Do NOT proceed to Step 3 until the user confirms the stack.

### Step 3: Research Scaffolding Options

Use `WebSearch` to find the best scaffolding tools and templates for the chosen stack. Search for:
- `"[framework] official starter template [current year]"`
- `"best way to scaffold [framework] project"`
- `"create [framework] app quickstart"`

Use `WebFetch` on the most promising results to extract the actual scaffolding commands and options.

Present your findings to the user as a numbered list:
1. **Official CLI / tool** — The framework's own scaffolding (e.g., `create-next-app`, `cargo init`). Show the exact command, pros and cons.
2. **Community template** — A popular starter with extras. Show the exact command, pros and cons.
3. **Manual setup** — For full control over every dependency.

Then STOP and use `AskUserQuestion` with these exact options:

- **"Option 1: Official CLI"** — use the official scaffolding tool
- **"Option 2: Community template"** — use the community template
- **"Option 3: Manual setup"** — set up manually
- **"I have my own (I will provide the command)"** — wait for user input

STOP HERE after calling `AskUserQuestion`. Do NOT proceed to Step 4 until the user chooses a scaffolding approach.

### Step 4: Execute Scaffolding

**Before scaffolding:**
- Check the current directory state. If the directory is **not empty**, STOP and use `AskUserQuestion` with these options:
  - **"Scaffold here anyway"** — proceed in current directory
  - **"Scaffold in a subdirectory (I will name it)"** — wait for user to provide a directory name
  - **"Abort"** — cancel the initialization

  STOP HERE after calling `AskUserQuestion` if the directory is not empty. Do NOT proceed until the user responds.

- Prefer **non-interactive flags** when available (e.g., `npx create-next-app@latest . --typescript --yes`, `cargo init --name myapp`).

**Execute** the chosen scaffolding command via `Bash`.

**After scaffolding:**
1. Verify the project structure was created: list key files and directories.
2. If dependencies were not installed by the scaffold, install them.

### Step 5: Initialize Git Repository

STOP and use `AskUserQuestion` with these exact options:

- **"Yes, initialize git"** — proceed with git init, .gitignore, and branch setup
- **"No, skip git"** — skip this step entirely

STOP HERE after calling `AskUserQuestion`. Do NOT proceed until the user responds.

**If the user chose "Yes, initialize git":**

1. **Get the `.gitignore`:**
   - Use `WebSearch` to find the official `.gitignore` template for the chosen stack/framework (e.g., search for `"gitignore [language/framework] github"` — GitHub maintains templates at `github/gitignore`).
   - Use `WebFetch` to download the appropriate `.gitignore` content.
   - If no suitable template is found online, generate a comprehensive `.gitignore` yourself based on the stack (e.g., `node_modules/`, `__pycache__/`, `target/`, `.env`, IDE files, OS files, build output).
   - If the scaffolding tool already created a `.gitignore`, merge the downloaded/generated one with it — do not overwrite useful entries already present.

2. **Initialize the repository:**
   ```bash
   git init
   ```

3. **Create branch structure:**
   - Create an initial commit on `main`:
     ```bash
     git add -A
     git commit -m "Initial project scaffold"
     ```
   - Create a `develop` branch and switch to it:
     ```bash
     git checkout -b develop
     ```
   - The `develop` branch is the **default working branch**. All development should happen here or in feature branches off `develop`.

4. **Report the git setup:**
   > "Git repository initialized:
   > - Branches: `main` (initial commit), `develop` (current, default working branch)
   > - `.gitignore` configured for [stack]"

**If the user chose "No, skip git":**
- Skip this step entirely. Do not initialize git.
- If the scaffolding tool already initialized a git repo, inform the user that the scaffold created one and ask if they want to keep it or remove it.

### Step 6: Configure the Skills Ecosystem

This is the **critical integration step**. You must configure CLAUDE.md and the app lifecycle skills so the entire system works for this specific project.

#### 5a. Detect Project Configuration

Read the scaffolded project's configuration files to detect:

| What to detect | Where to look |
|----------------|---------------|
| Dev server start command | `package.json` (scripts.dev/start), `Makefile`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `Procfile` |
| Dev server port(s) | Framework config files, default port for the framework, `docker-compose.yml` |
| Pre-dev command | Docker setup, database migrations, codegen steps |
| Verify/build command | `package.json` (scripts.build/lint/test), `Makefile`, `Cargo.toml` |
| File naming conventions | Scaffolded directory structure and framework conventions |

#### 5b. Update CLAUDE.md

Update the Development Commands section with the actual detected values:

```markdown
## Development Commands

```bash
DEV_PORTS=[detected ports]                    # Port(s) the dev server listens on
START_COMMAND="[detected start command]"       # Command to start the dev server
PREDEV_COMMAND="[detected predev or empty]"    # Optional pre-start setup
VERIFY_COMMAND="[detected verify command]"     # Quality gate command

# Common commands:
# [actual install command]    — Install dependencies
# [actual dev command]        — Start development server
# [actual build command]      — Build for production
# [actual test command]       — Run tests
```
```

Also update:
- **Environment Setup** section with instructions for the chosen stack
- **Architecture** section with the scaffolded project's structure overview
- **File Naming Conventions** table if the framework has established conventions

#### 5c. Update App Lifecycle Skills

Edit the following skill files to configure them for this specific project:

- `.claude/skills/app-start/SKILL.md` — Update the configuration note with the actual DEV_PORTS, START_COMMAND, and PREDEV_COMMAND values
- `.claude/skills/app-stop/SKILL.md` — Update with the actual DEV_PORTS
- `.claude/skills/app-restart/SKILL.md` — Update with the actual DEV_PORTS, START_COMMAND, and PREDEV_COMMAND values

In each skill, replace the generic `[DEV_PORTS]`, `[START_COMMAND]`, and `[PREDEV_COMMAND]` placeholders in the bash code blocks with the actual project values, so the skills work without any manual configuration.

#### 5d. Update Workflow Skills

Based on the detected project configuration, update the following skill files by replacing their placeholders with project-specific values:

**`.claude/skills/test-engineer/SKILL.md`:**
- `[TEST_FRAMEWORK]` — The test framework for the stack (e.g., Vitest for Vite/React, pytest for Python, `go test` for Go). If the scaffold did not include a test framework, choose the most popular one for the stack and note it in the orientation report.
- `[TEST_COMMAND]` — The command to run tests (e.g., `npx vitest run`, `pytest`, `cargo test`).
- `[TEST_FILE_PATTERN]` — The naming convention for test files (e.g., `*.test.ts`, `test_*.py`).
- `[CI_RUNTIME_SETUP]` — The GitHub Actions setup step for the project's runtime. Replace with the actual YAML steps block (e.g., `- uses: actions/setup-node@v4` with the detected Node version, or `- uses: actions/setup-python@v5` with detected Python version).

**`.claude/skills/task-create/SKILL.md` and `.claude/skills/idea-approve/SKILL.md`:**
- `[TECH_DETAIL_LAYERS]` — Replace with an indented list of the project's architectural layers, derived from the scaffolded directory structure and framework conventions. Each line should name the layer and its directory. Example for Next.js:
  ```
      - App Router pages and layouts (app/)
      - API routes (app/api/)
      - React components (components/)
      - Database schema and queries (prisma/)
      - Shared utilities and types (lib/)
      - Configuration and environment
  ```

**`.claude/skills/idea-create/SKILL.md`:**
- `[IDEA_CATEGORIES]` — Replace with a markdown table combining 3-4 universal categories (Core Features, Security, Performance, Infrastructure) with 2-3 project-domain categories derived from the project purpose. Example for an e-commerce app:
  ```
  | Category | Domain |
  |----------|--------|
  | `Product Catalog` | Product listings, search, filtering |
  | `Checkout` | Cart, payment, order processing |
  | `User Accounts` | Registration, profiles, preferences |
  | `Core Features` | Primary functionality, core workflows |
  | `Security` | Authentication, authorization, encryption |
  | `Performance` | Optimization, caching, scaling |
  | `Infrastructure` | DevOps, CI/CD, deployment, Docker |
  ```

**`.claude/skills/docs/SKILL.md`:**
- `[DOC_CATEGORIES]` — Replace with a list of documentation categories derived from the project's architecture layers. Example: `api`, `database`, `components`, `architecture`, `deployment`.

**`.claude/skills/task-scout/SKILL.md`:**
- `[PROJECT_CONTEXT]` — Replace with a 3-line summary block describing the project's domain, tech stack, and target audience (gathered in Steps 1-2). Example:
  ```
  > - **Domain**: E-commerce platform for artisan goods
  > - **Tech Stack**: Next.js 15, PostgreSQL, Prisma, Tailwind CSS
  > - **Target Audience**: Small business owners selling handmade products
  ```
- `[SCOUT_CATEGORIES]` — Replace with a category list that combines universal categories with 2-3 project-domain-specific categories (use the same domain categories as idea-create). Example:
  ```
  - **Product Catalog**: Product discovery, search, filtering, recommendations
  - **Checkout & Payments**: Cart, payment methods, order management
  - **Core Features**: Primary functionality improvements and extensions
  - **Security**: Authentication, authorization, encryption, audit logging
  - **UX/Productivity**: Keyboard shortcuts, search, themes, accessibility
  - **Performance**: Caching, optimization, lazy loading, compression
  - **Developer Experience**: Testing, documentation, CI/CD, debugging tools
  ```

### Step 7: Orientation Report

Present a comprehensive report to the user:

```
## Project Initialized Successfully

**Stack:** [framework] on [runtime]
**Directory:** [path]

### How to Get Started
1. [install command] — install dependencies (if not done already)
2. [start command] — start the dev server
3. Open http://localhost:[port] in your browser

### Project Structure
[Brief explanation of key directories and their purpose]

### Framework Limitations to Be Aware Of
- [Known limitation 1]
- [Known limitation 2]
- [Known limitation 3]

### How to Expand This Project
- **Add a database:** [brief guidance for the chosen stack]
- **Add authentication:** [brief guidance]
- **Add an API layer:** [brief guidance]
- **Add tests:** Use the `/test-engineer` skill
- **Add CI/CD:** Use the `/test-engineer` skill with CI focus

### Git Repository
- Branches: `main` (initial commit), `develop` (current working branch)
- `.gitignore`: configured for [stack]
- Workflow: develop on `develop`, merge to `main` for releases

### Skills Ecosystem Status
The following skills are now configured for your project:
- `/app-start` — starts your dev server on port [port]
- `/app-stop` — stops your dev server
- `/app-restart` — restarts your dev server
- `/test-engineer` — configured for [test framework] with CI pipeline template
- `/task-create`, `/task-pick` — architecture-aware task templates
- `/idea-create` — project-relevant idea categories
- `/docs` — documentation with project-specific categories
- `/task-scout` — feature scouting tuned to your project domain
```

## Important Rules

1. **NEVER scaffold without explicit user confirmation** of both the stack and the scaffolding tool.
2. **NEVER overwrite existing project files** — if the directory is not empty, warn the user and ask how to proceed.
3. **ALWAYS update CLAUDE.md** with DEV_PORTS, START_COMMAND, PREDEV_COMMAND, and VERIFY_COMMAND after scaffolding.
4. **ALWAYS update the app lifecycle skills** (app-start, app-stop, app-restart) **AND workflow skills** (test-engineer, task-create, idea-approve, idea-create, docs, task-scout) with project-specific values.
5. **ALWAYS verify the scaffold succeeded** by checking that key files exist before reporting success.
6. **Use the project root directory** (current working directory) for scaffolding unless the user specifies otherwise.
7. **Respect user choice** — if the user wants a specific stack or tool, use it even if you would recommend differently.
8. **All output must be in English** — all reports, CLAUDE.md content, and skill configurations must be in English.
9. **Prefer non-interactive scaffolding** — use flags to avoid interactive prompts when possible.
10. **Do NOT enter an infinite loop** — if scaffolding fails, present the error and let the user decide how to proceed.
