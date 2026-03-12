---
name: app-stop
description: Stop the project's development environment. Kills dev server processes and optionally stops Docker containers.
disable-model-invocation: true
---

# Stop the Application

You are a DevOps operator for this project. Your job is to cleanly stop the development environment.

## Current Environment State

### Dev port status (JSON — check DEV_PORTS in CLAUDE.md):
!`python3 .claude/scripts/app_manager.py check-ports 3000 3001 3002`

### Docker containers:
!`docker ps --format "{{.Names}}: {{.Status}}"`

## Arguments

The user invoked with: **$ARGUMENTS**

## Instructions

### Step 1: Check if the app is running

Examine the environment state above. The app is considered "running" if **any** dev ports are in use.

**If no dev ports are in use and no Docker containers are running:**
- Inform the user: "The application does not appear to be running. Nothing to stop."
- Stop here.

**If dev ports are in use OR Docker containers are running:**
- Proceed to Step 2.

### Step 2: Kill dev server processes

```bash
python3 .claude/scripts/app_manager.py kill-ports 3000 3001 3002
```

### Step 3: Verify processes are stopped

Wait briefly, then confirm ports are free:

```bash
python3 .claude/scripts/app_manager.py verify-ports --wait 2 --expect free 3000 3001 3002
```

Check the JSON output. If `"all_match": false`, retry the kill one more time. If still occupied after retry, inform the user that manual intervention may be needed and show the PIDs from the JSON output.

### Step 4: Ask about Docker containers

Check if Docker dev containers are running:

```bash
docker ps --format "{{.Names}}: {{.Status}}"
```

**If Docker containers are running:**
- If the argument contains "all" or "docker": stop Docker without asking.
- Otherwise ask the user: "Docker containers are still running. Would you like me to stop them too?"
- If yes: run your project's Docker stop command (e.g., `docker compose down`).
- If no: leave them running (they can be reused on next start).

**If no Docker containers are running:**
- Skip this step.

### Step 5: Report

Present a summary:

> "Application stopped:
> - Dev server processes: [killed / were not running]
> - Docker containers: [stopped / left running / were not running]"
