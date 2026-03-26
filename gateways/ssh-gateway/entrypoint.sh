#!/bin/sh
set -e

# Set up authorized_keys from environment variable and/or volume mount
AUTH_KEYS_FILE="/home/tunnel/.ssh/authorized_keys"
: > "$AUTH_KEYS_FILE"

# Source 1: SSH_AUTHORIZED_KEYS environment variable (newline-separated)
if [ -n "$SSH_AUTHORIZED_KEYS" ]; then
    echo "Loading authorized keys from environment variable..."
    printf '%s\n' "$SSH_AUTHORIZED_KEYS" >> "$AUTH_KEYS_FILE"
fi

# Source 2: /config/authorized_keys volume mount
if [ -f /config/authorized_keys ]; then
    echo "Loading authorized keys from /config/authorized_keys..."
    cat /config/authorized_keys >> "$AUTH_KEYS_FILE"
fi

# Warn if no keys were configured
if [ ! -s "$AUTH_KEYS_FILE" ]; then
    echo "WARNING: No authorized keys configured. Set SSH_AUTHORIZED_KEYS env var or mount /config/authorized_keys"
fi

chmod 600 "$AUTH_KEYS_FILE"

# Start HTTPS key management API (sidecar) if token is configured
if [ -n "$GATEWAY_API_TOKEN" ]; then
  echo "Starting key management API (HTTPS)..."
  node /opt/key-api/key-api-server.js &
else
  echo "WARNING: GATEWAY_API_TOKEN not set — key management API disabled"
fi

# Start zero-trust tunnel agent if configured (auto-activating, dormant if env vars absent)
if [ -f /opt/tunnel-agent/dist/index.js ]; then
  echo "Starting tunnel agent (dormant if TUNNEL_SERVER_URL not set)..."
  node /opt/tunnel-agent/dist/index.js &
fi

echo "Starting SSH gateway on port ${SSH_PORT:-2222}..."
exec /usr/sbin/sshd -D -e -p "${SSH_PORT:-2222}"
