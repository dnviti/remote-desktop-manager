---
name: app-restart
description: Restart the Arsenale development environment. Stops existing processes, then starts fresh with Docker + Prisma setup and dev server, with error monitoring.
disable-model-invocation: true
allowed-tools: Bash
---

# Restart the Application

You are a DevOps operator for the Arsenale project. Your job is to cleanly restart the development environment — stop everything, then start fresh.

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

### Step 1: Stop existing processes

Regardless of whether the app appears to be running, perform a clean stop to ensure no stale processes remain.

**Kill all processes on dev ports (3000, 3001, 3002):**

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

**Verify ports are free:**

```bash
sleep 2
remaining=$(netstat -ano 2>/dev/null | grep -E ":(3000|3001|3002)\s" | grep LISTENING)
if [ -n "$remaining" ]; then
  echo "WARNING: Ports still in use, retrying..."
  echo "$remaining" | awk '{print $5}' | sort -u | tr -d '\r' | while read pid; do
    [ -n "$pid" ] && [ "$pid" != "0" ] && taskkill /PID "$pid" /F /T 2>/dev/null || true
  done
  sleep 2
fi
```

If ports are still occupied after 2 retries, inform the user and stop.

### Step 2: Start Docker containers and Prisma (predev)

Run the predev script to ensure Docker containers are up and Prisma is synchronized:

```bash
npm run predev
```

Wait for it to complete. If it fails:
- Diagnose the error
- Common issues: Docker Desktop not running, port 5432 occupied, Prisma schema errors
- Attempt to fix if possible, otherwise inform the user and stop

### Step 3: Start the dev server (background)

Run `npm run dev` with `run_in_background: true`:

```bash
npm run dev
```

This starts `concurrently` which runs both the Express server (port 3001) and Vite client (port 3000).

### Step 4: Monitor startup for errors

1. **Wait 8 seconds** for startup:
   ```bash
   sleep 8
   ```

2. **Verify ports are bound:**
   ```bash
   netstat -ano 2>/dev/null | grep -E ":(3000|3001)\s" | grep LISTENING
   ```

3. **Check Docker health:**
   ```bash
   docker ps --format "{{.Names}}: {{.Status}}" | grep -E "guacd|postgres"
   ```

4. **Read the background process output** using `TaskOutput` for errors. Look for:
   - `EADDRINUSE` — port still occupied
   - `Cannot find module` — missing dependency (run `npm install`)
   - `ECONNREFUSED` — database unreachable
   - `Error`, `TypeError`, `SyntaxError` — code or config issues

5. **Report results:**

   **Success:**
   > "Application restarted successfully:
   > - Client: http://localhost:3000
   > - Server: http://localhost:3001
   > - Docker containers: healthy"

   **Failure:**
   - Show the error output
   - Attempt to diagnose and fix
   - If fixable, stop processes and retry from Step 2 (max 1 retry)
   - If not fixable, present the error and suggest remediation
