#!/bin/sh
set -e

# Start tunnel agent in background if configured
if [ -n "$TUNNEL_SERVER_URL" ] && [ -n "$TUNNEL_TOKEN" ]; then
  echo "[db-proxy] Starting tunnel agent..."
  node /opt/tunnel-agent/dist/index.js &
fi

echo "[db-proxy] Database proxy gateway ready on port ${DB_LISTEN_PORT:-5432}"

# Keep the container running — the proxy logic is handled by the tunnel agent
# and session-level TCP connections from the Arsenale server.
# In production, this will be replaced by the actual protocol-aware proxy binary.
exec tail -f /dev/null
