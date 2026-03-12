---
name: app-restart
description: Restart the project's development environment. Stops existing processes, then starts fresh with setup and dev server, with error monitoring.
disable-model-invocation: true
---

# Restart the Application

You are a DevOps operator for this project. Your job is to cleanly restart the development environment — stop everything, then start fresh.

## Current Environment State

### Dev port status (JSON — check DEV_PORTS in CLAUDE.md):
!`python3 .claude/scripts/app_manager.py check-ports 3000 3001 3002`

### Docker containers:
!`docker ps --format "{{.Names}}: {{.Status}}"`

## Arguments

The user invoked with: **$ARGUMENTS**

## Instructions

### Step 1: Stop existing processes

Regardless of whether the app appears to be running, perform a clean stop to ensure no stale processes remain.

**Kill all processes on dev ports and verify:**

```bash
python3 .claude/scripts/app_manager.py kill-ports 3000 3001 3002
python3 .claude/scripts/app_manager.py verify-ports --wait 2 --expect free 3000 3001 3002
```

If `"all_match": false` in the JSON output, retry the kill once more. If still occupied after 2 retries, inform the user and stop.

### Step 2: Run pre-start setup (if applicable)

Run the pre-start command to ensure services are up and dependencies are synchronized:

```bash
npm run predev
```

Wait for it to complete. If it fails:
- Diagnose the error
- Common issues: Docker not running, port occupied, schema errors
- Attempt to fix if possible, otherwise inform the user and stop

### Step 3: Start the dev server (background)

Run the start command with `run_in_background: true`:

```bash
npm run dev
```

### Step 4: Monitor startup for errors

1. **Wait for startup and verify ports are bound:**
   ```bash
   python3 .claude/scripts/app_manager.py verify-ports --wait 8 --expect bound 3000 3001 3002
   ```

3. **Check Docker health** (if applicable):
   ```bash
   docker ps --format "{{.Names}}: {{.Status}}"
   ```

4. **Read the background process output** using `TaskOutput` for errors. Look for common error indicators:
   - Port conflicts: `EADDRINUSE`, `Address already in use`, `port is already allocated`
   - Missing dependencies: `Cannot find module`, `ModuleNotFoundError`, `no required module`, `package not found`
   - Connection failures: `ECONNREFUSED`, `Connection refused`, `connection error`
   - Generic errors: `Error`, `FATAL`, `panic`, `traceback`, stack traces or crash dumps

5. **Report results:**

   **Success:**
   > "Application restarted successfully:
   > - [list bound ports and their services]
   > - Docker containers: [healthy / N/A]"

   **Failure:**
   - Show the error output
   - Attempt to diagnose and fix
   - If fixable, stop processes and retry from Step 2 (max 1 retry)
   - If not fixable, present the error and suggest remediation
