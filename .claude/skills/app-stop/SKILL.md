---
name: app-stop
description: Stop the Remote Desktop Manager development environment. Kills dev server processes and optionally stops Docker containers.
disable-model-invocation: true
allowed-tools: Bash
---

# Stop the Application

You are a DevOps operator for the Remote Desktop Manager project. Your job is to cleanly stop the development environment.

## Current Environment State

### Ports in use (3000, 3001, 3002):
!`netstat -ano 2>/dev/null | grep -E ":(3000|3001|3002)\s" | grep LISTENING || echo "No dev ports in use"`

### Docker containers:
!`docker ps --format "{{.Names}}: {{.Status}}" 2>/dev/null | grep -E "guacd|postgres" || echo "No dev containers running"`

### Node processes:
!`tasklist 2>/dev/null | grep -i node | head -10 || echo "No node processes found"`

## Arguments

The user invoked with: **$ARGUMENTS**

## Instructions

### Step 1: Check if the app is running

Examine the environment state above. The app is considered "running" if **any** of ports 3000, 3001, or 3002 are in use.

**If no dev ports are in use and no Docker containers are running:**
- Inform the user: "The application does not appear to be running. Nothing to stop."
- Stop here.

**If dev ports are in use OR Docker containers are running:**
- Proceed to Step 2.

### Step 2: Kill dev server processes

For each dev port (3000, 3001, 3002), find the PID and kill it with its process tree:

```bash
for port in 3000 3001 3002; do
  pids=$(netstat -ano 2>/dev/null | grep -E ":${port}\s" | grep LISTENING | awk '{print $5}' | sort -u | tr -d '\r')
  for pid in $pids; do
    if [ -n "$pid" ] && [ "$pid" != "0" ]; then
      echo "Killing PID $pid (port $port)..."
      taskkill /PID "$pid" /F /T 2>/dev/null || true
    fi
  done
done
```

### Step 3: Verify processes are stopped

Wait briefly, then confirm ports are free:

```bash
sleep 2
remaining=$(netstat -ano 2>/dev/null | grep -E ":(3000|3001|3002)\s" | grep LISTENING)
if [ -n "$remaining" ]; then
  echo "WARNING: Some ports still in use:"
  echo "$remaining"
else
  echo "All dev server ports are free."
fi
```

If ports are still occupied, retry the kill one more time. If still occupied after retry, inform the user that manual intervention may be needed and show the PIDs.

### Step 4: Ask about Docker containers

Check if Docker dev containers (guacd, postgres) are running:

```bash
docker ps --format "{{.Names}}: {{.Status}}" 2>/dev/null | grep -E "guacd|postgres"
```

**If Docker containers are running:**
- If the argument contains "all" or "docker": stop Docker without asking.
- Otherwise ask the user: "Docker containers (PostgreSQL, guacd) are still running. Would you like me to stop them too?"
- If yes: run `npm run docker:dev:down` from the project root.
- If no: leave them running (they can be reused on next start).

**If no Docker containers are running:**
- Skip this step.

### Step 5: Report

Present a summary:

> "Application stopped:
> - Dev server processes: [killed / were not running]
> - Docker containers: [stopped / left running / were not running]"
