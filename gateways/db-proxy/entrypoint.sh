#!/bin/sh
set -e

# Start tunnel agent in background if configured
tunnel_pid=""
if [ -n "$TUNNEL_SERVER_URL" ] && [ -n "$TUNNEL_TOKEN" ]; then
  echo "[db-proxy] Starting tunnel agent..."
  node /opt/tunnel-agent/dist/index.js &
  tunnel_pid=$!
fi

# Start a lightweight TCP listener so the tunnel agent has a healthy local target.
# This is a development placeholder until the full protocol-aware proxy is wired in.
node -e '
  const net = require("net");
  const port = Number(process.env.DB_LISTEN_PORT || "5432");
  net.createServer((socket) => {
    socket.end();
  }).listen(port, "0.0.0.0", () => {
    console.log(`[db-proxy] TCP listener ready on port ${port}`);
  });
' &
listener_pid=$!

echo "[db-proxy] Database proxy gateway ready on port ${DB_LISTEN_PORT:-5432}"

# Keep the container running while both background processes are healthy.
while :; do
  if [ -n "$tunnel_pid" ] && ! kill -0 "$tunnel_pid" 2>/dev/null; then
    wait "$tunnel_pid" || true
    exit 1
  fi

  if ! kill -0 "$listener_pid" 2>/dev/null; then
    wait "$listener_pid" || true
    exit 1
  fi

  sleep 1
done
