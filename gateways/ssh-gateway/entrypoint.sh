#!/bin/sh
set -e

# Set up authorized_keys in /tmp (writable tmpfs) for read_only containers
AUTH_KEYS_DIR="/tmp/.ssh"
AUTH_KEYS_FILE="${AUTH_KEYS_DIR}/authorized_keys"
CONFIG_AUTH_KEYS_FILE="/config/authorized_keys"

if [ -d "$CONFIG_AUTH_KEYS_FILE" ]; then
    CONFIG_AUTH_KEYS_FILE="${CONFIG_AUTH_KEYS_FILE}/authorized_keys"
fi

mkdir -p "$AUTH_KEYS_DIR"
chmod 700 "$AUTH_KEYS_DIR"
: > "$AUTH_KEYS_FILE"

# Source 1: SSH_AUTHORIZED_KEYS environment variable (newline-separated)
if [ -n "$SSH_AUTHORIZED_KEYS" ]; then
    echo "Loading authorized keys from environment variable..."
    printf '%s\n' "$SSH_AUTHORIZED_KEYS" >> "$AUTH_KEYS_FILE"
fi

# Source 2: /config/authorized_keys volume mount
if [ -f "$CONFIG_AUTH_KEYS_FILE" ]; then
    echo "Loading authorized keys from ${CONFIG_AUTH_KEYS_FILE}..."
    cat "$CONFIG_AUTH_KEYS_FILE" >> "$AUTH_KEYS_FILE"
fi

# Warn if no keys were configured
if [ ! -s "$AUTH_KEYS_FILE" ]; then
    echo "INFO: No authorized keys configured at startup. SSH access remains closed until keys are provisioned."
fi

chmod 600 "$AUTH_KEYS_FILE"

# Generate per-container SSH host keys in tmpfs so they are not baked into the image.
HOSTKEY_DIR="/tmp/ssh-hostkeys"
mkdir -p "$HOSTKEY_DIR"
chmod 700 "$HOSTKEY_DIR"

if [ ! -f "$HOSTKEY_DIR/ssh_host_ed25519_key" ]; then
  ssh-keygen -q -t ed25519 -N '' -f "$HOSTKEY_DIR/ssh_host_ed25519_key"
fi

if [ ! -f "$HOSTKEY_DIR/ssh_host_rsa_key" ]; then
  ssh-keygen -q -t rsa -b 3072 -N '' -f "$HOSTKEY_DIR/ssh_host_rsa_key"
fi

chmod 600 "$HOSTKEY_DIR/ssh_host_ed25519_key" "$HOSTKEY_DIR/ssh_host_rsa_key"
chmod 644 "$HOSTKEY_DIR/ssh_host_ed25519_key.pub" "$HOSTKEY_DIR/ssh_host_rsa_key.pub"

# Materialize inline gRPC TLS PEMs into container-local files for managed deployments.
if [ -n "$GATEWAY_GRPC_TLS_CA_PEM" ] && [ -n "$GATEWAY_GRPC_TLS_CERT_PEM" ] && [ -n "$GATEWAY_GRPC_TLS_KEY_PEM" ]; then
  GRPC_TLS_DIR="/tmp/arsenale-grpc"
  mkdir -p "$GRPC_TLS_DIR"
  chmod 700 "$GRPC_TLS_DIR"
  printf '%s\n' "$GATEWAY_GRPC_TLS_CA_PEM" > "$GRPC_TLS_DIR/ca.pem"
  printf '%s\n' "$GATEWAY_GRPC_TLS_CERT_PEM" > "$GRPC_TLS_DIR/cert.pem"
  printf '%s\n' "$GATEWAY_GRPC_TLS_KEY_PEM" > "$GRPC_TLS_DIR/key.pem"
  if [ -n "$GATEWAY_GRPC_CLIENT_CA_PEM" ]; then
    printf '%s\n' "$GATEWAY_GRPC_CLIENT_CA_PEM" > "$GRPC_TLS_DIR/client-ca.pem"
    chmod 600 "$GRPC_TLS_DIR/client-ca.pem"
    export GATEWAY_GRPC_CLIENT_CA="${GATEWAY_GRPC_CLIENT_CA:-$GRPC_TLS_DIR/client-ca.pem}"
  fi
  chmod 600 "$GRPC_TLS_DIR/ca.pem" "$GRPC_TLS_DIR/cert.pem" "$GRPC_TLS_DIR/key.pem"
  export GATEWAY_GRPC_TLS_CA="${GATEWAY_GRPC_TLS_CA:-$GRPC_TLS_DIR/ca.pem}"
  export GATEWAY_GRPC_TLS_CERT="${GATEWAY_GRPC_TLS_CERT:-$GRPC_TLS_DIR/cert.pem}"
  export GATEWAY_GRPC_TLS_KEY="${GATEWAY_GRPC_TLS_KEY:-$GRPC_TLS_DIR/key.pem}"
fi

# Start gRPC key management server (mTLS-authenticated, replaces old HTTPS API)
if [ -n "$GATEWAY_GRPC_TLS_CA" ] && [ -n "$GATEWAY_GRPC_TLS_CERT" ] && [ -n "$GATEWAY_GRPC_TLS_KEY" ]; then
  echo "Starting key management gRPC server (mTLS)..."
  /usr/local/bin/key-mgmt-server &
else
  echo "WARNING: GATEWAY_GRPC_TLS_* not set — key management gRPC server disabled"
fi

# Start zero-trust tunnel agent if configured (auto-activating, dormant if env vars absent)
if [ -f /opt/tunnel-agent/dist/index.js ]; then
  if [ -n "$TUNNEL_SERVER_URL" ] && [ -n "$TUNNEL_TOKEN" ] && [ -n "$TUNNEL_GATEWAY_ID" ]; then
    echo "Starting tunnel agent..."
    node /opt/tunnel-agent/dist/index.js &
  else
    echo "Tunnel agent not configured at startup; skipping"
  fi
fi

echo "Starting SSH gateway on port ${SSH_PORT:-2222}..."
exec /usr/sbin/sshd -D -e -p "${SSH_PORT:-2222}"
