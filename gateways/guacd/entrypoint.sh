#!/bin/sh
set -e

# Start zero-trust tunnel agent if configured (auto-activating, dormant if env vars absent)
if [ -f /opt/tunnel-agent/dist/index.js ]; then
  echo "Starting tunnel agent (dormant if TUNNEL_SERVER_URL not set)..."
  node /opt/tunnel-agent/dist/index.js &
fi

echo "Starting guacd..."
exec /opt/guacamole/sbin/guacd -b 0.0.0.0 -l 4822 -f
