---
name: app-start
description: Start the Arsenale development environment. Checks for running processes, starts Docker containers, runs Prisma setup, and launches the dev server with error monitoring.
disable-model-invocation: true
allowed-tools: Bash
---

# Start the Application

You are a DevOps operator for the Arsenale project. Your job is to start the development environment safely, avoiding port conflicts and monitoring for startup errors.

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

### Step 1: Check if the app is already running

Examine the environment state above. The app is considered "running" if **any** of these ports are in use: 3000, 3001, or 3002.

**If ports are in use:**
- Inform the user: "The app appears to be already running (ports in use: [list ports and PIDs])."
- Ask the user using `AskUserQuestion`: "Would you like me to restart it (stop + start fresh), or skip?"
  - **"Restart"** — proceed to Step 2 (stop first), then continue to Step 3.
  - **"Skip"** — stop here.

**If no ports are in use:**
- Proceed directly to Step 3.

### Step 2: Stop existing processes (only if restarting)

Kill all processes on dev ports. For each port (3000, 3001, 3002), run:

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

After killing, wait 2 seconds then verify all ports are free:

```bash
sleep 2
still_used=$(netstat -ano 2>/dev/null | grep -E ":(3000|3001|3002)\s" | grep LISTENING)
if [ -n "$still_used" ]; then
  echo "WARNING: Some ports still in use after kill:"
  echo "$still_used"
else
  echo "All ports are free."
fi
```

If ports are still occupied after 3 retries (kill + 2s wait), inform the user and stop.

### Step 3: Start Docker containers and Prisma (predev)

Run `npm run predev` from the project root. This starts Docker containers (PostgreSQL + guacd) and runs Prisma generate + db push:

```bash
npm run predev
```

This command runs synchronously. Wait for it to complete.

**If predev fails:**
- Read the error output carefully
- Common issues:
  - Docker not running → inform the user to start Docker Desktop
  - Port 5432 in use → another PostgreSQL instance; inform the user
  - Prisma errors → usually schema issues; attempt to diagnose and fix
- Do NOT proceed to Step 4 if predev fails

### Step 4: Start the dev server (background)

Run `npm run dev` using the Bash tool with `run_in_background: true`:

```bash
npm run dev
```

This starts `concurrently` which runs both the Express server (port 3001) and Vite client (port 3000).

### Step 5: Monitor startup for errors

After starting the background process:

1. **Wait 8 seconds** for initial startup:
   ```bash
   sleep 8
   ```

2. **Check that ports are bound** — verify both 3000 and 3001 are now listening:
   ```bash
   netstat -ano 2>/dev/null | grep -E ":(3000|3001)\s" | grep LISTENING
   ```

3. **Check Docker containers are healthy**:
   ```bash
   docker ps --format "{{.Names}}: {{.Status}}" | grep -E "guacd|postgres"
   ```

4. **Read the background process output** using `TaskOutput` to check for errors. Look for these error patterns:
   - `EADDRINUSE` — port conflict (should not happen if Step 2 succeeded)
   - `Cannot find module` — missing dependency (run `npm install`)
   - `ECONNREFUSED` — database connection failed (Docker issue)
   - `Error` or `error` — generic errors
   - `prisma` errors — schema sync issues
   - `TypeError`, `SyntaxError` — code bugs

5. **Report results to the user:**

   **If all checks pass** (both ports listening, no errors in output):
   > "The application is running successfully:
   > - Client: http://localhost:3000
   > - Server: http://localhost:3001
   > - Docker containers: healthy
   >
   > You can access the app at http://localhost:3000"

   **If errors are detected:**
   - Show the error output to the user
   - Attempt to diagnose the root cause
   - If fixable (e.g., missing npm install, stale Prisma client), fix it, stop the failed processes, and restart from Step 3
   - If not fixable automatically, present the error and suggest next steps

### Error Recovery

If the app fails to start after one retry:
1. Stop any partially-started processes (Step 2)
2. Present all collected error output to the user
3. Suggest specific remediation steps based on the error type
4. Do NOT enter an infinite retry loop — max 1 automatic retry
