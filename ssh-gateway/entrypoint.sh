#!/bin/sh
set -e

# Generate host keys if not present (persisted via volume mount)
if [ ! -f /etc/ssh/ssh_host_ed25519_key ]; then
    echo "Generating SSH host keys..."
    ssh-keygen -A
fi

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

# Fix permissions
chown tunnel:tunnel "$AUTH_KEYS_FILE"
chmod 600 "$AUTH_KEYS_FILE"

echo "Starting SSH gateway on port ${SSH_PORT:-2222}..."
exec /usr/sbin/sshd -D -e -p "${SSH_PORT:-2222}"
