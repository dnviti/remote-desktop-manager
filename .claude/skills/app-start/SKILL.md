---
name: app-start
description: Start the project's development environment. Checks for running processes, runs setup commands, and launches the dev server with error monitoring.
disable-model-invocation: true
---

# Start the Application

You are a DevOps operator for this project. Your job is to start the development environment safely, avoiding port conflicts and monitoring for startup errors.

## Current Environment State

### Dev port status (JSON — check DEV_PORTS in CLAUDE.md):
!`python3 .claude/scripts/app_manager.py check-ports 3000 3001 3002`

### Docker containers:
!`docker ps --format "{{.Names}}: {{.Status}}"`

## Arguments

The user invoked with: **$ARGUMENTS**

## Instructions

> **Arsenale dev environment:**
> - **Port 3000**: Vite client (React dev server)
> - **Port 3001**: Express server (API backend)
> - **Port 3002**: Guacamole WebSocket (RDP tunnel)
> - **Docker containers**: PostgreSQL (database) + guacd (Guacamole daemon)
> - **Pre-dev (`npm run predev`)**: Starts Docker containers (PostgreSQL + guacd) and runs `npm run db:generate` (Prisma client generation). Database migrations run automatically on server start.

### Step 1: Check if the app is already running

Examine the environment state above. The app is considered "running" if **any** of the configured dev ports are in use.

**If ports are in use:**
- Inform the user: "The app appears to be already running (ports in use: [list ports and PIDs])."
- Ask the user using `AskUserQuestion`: "Would you like me to restart it (stop + start fresh), or skip?"
  - **"Restart"** — proceed to Step 2 (stop first), then continue to Step 3.
  - **"Skip"** — stop here.

**If no ports are in use:**
- Proceed directly to Step 3.

### Step 2: Stop existing processes (only if restarting)

Kill all processes on dev ports and verify:

```bash
python3 .claude/scripts/app_manager.py kill-ports 3000 3001 3002
python3 .claude/scripts/app_manager.py verify-ports --wait 2 --expect free 3000 3001 3002
```

Check the `verify-ports` JSON output. If `"all_match": false`, retry the kill once more. If still occupied after 2 retries, inform the user and stop.

### Step 3: Run pre-start setup (if applicable)

Run the pre-dev command to start Docker containers and generate Prisma client:

```bash
npm run predev
```

This command runs synchronously. Wait for it to complete.

**If it fails:**
- Read the error output carefully
- Common issues:
  - Docker not running — inform the user to start Docker
  - Port conflicts — another service occupying required ports
  - Database errors — schema or migration issues
- Do NOT proceed to Step 4 if pre-start fails

### Step 4: Start the dev server (background)

Run the start command using the Bash tool with `run_in_background: true`:

```bash
npm run dev
```

### Step 5: Monitor startup for errors

After starting the background process:

1. **Wait for startup and check that ports are bound** — verify dev ports are now listening:
   ```bash
   python3 .claude/scripts/app_manager.py verify-ports --wait 8 --expect bound 3000 3001 3002
   ```

3. **Check Docker containers are healthy** (if applicable):
   ```bash
   docker ps --format "{{.Names}}: {{.Status}}"
   ```

4. **Read the background process output** using `TaskOutput` to check for errors. Look for common error indicators:
   - Port conflicts: `EADDRINUSE`, `Address already in use`, `port is already allocated`
   - Missing dependencies: `Cannot find module`, `ModuleNotFoundError`, `no required module`, `package not found`
   - Connection failures: `ECONNREFUSED`, `Connection refused`, `connection error`
   - Generic errors: `Error`, `FATAL`, `panic`, `traceback`, stack traces or crash dumps

5. **Report results to the user:**

   **If all checks pass** (all ports listening, no errors in output):
   > "The application is running successfully:
   > - Port 3000: Vite client (React dev server)
   > - Port 3001: Express server (API backend)
   > - Port 3002: Guacamole WebSocket (RDP tunnel)
   > - Docker containers: [healthy / N/A]
   >
   > You can access the app at http://localhost:3000"

   **If errors are detected:**
   - Show the error output to the user
   - Attempt to diagnose the root cause
   - If fixable (e.g., missing dependency install), fix it, stop the failed processes, and restart from Step 3
   - If not fixable automatically, present the error and suggest next steps

### Error Recovery

If the app fails to start after one retry:
1. Stop any partially-started processes (Step 2)
2. Present all collected error output to the user
3. Suggest specific remediation steps based on the error type
4. Do NOT enter an infinite retry loop — max 1 automatic retry
