#!/bin/sh
set -e

requested_home="${HOME:-/home/guacd}"
requested_config_home="${XDG_CONFIG_HOME:-$requested_home/.config}"

if mkdir -p "$requested_home" "$requested_config_home" 2>/dev/null; then
  export HOME="$requested_home"
  export XDG_CONFIG_HOME="$requested_config_home"
else
  export HOME="/tmp/guacd-home"
  export XDG_CONFIG_HOME="$HOME/.config"
  mkdir -p "$HOME" "$XDG_CONFIG_HOME"
fi

# Start zero-trust tunnel agent if configured (auto-activating, dormant if env vars absent)
if command -v arsenale-tunnel-agent >/dev/null 2>&1; then
  echo "Starting tunnel agent (dormant if TUNNEL_SERVER_URL not set)..."
  arsenale-tunnel-agent &
fi

guacd_bin="$(command -v guacd || true)"
if [ -z "$guacd_bin" ] && [ -x /opt/guacamole/sbin/guacd ]; then
  guacd_bin="/opt/guacamole/sbin/guacd"
fi
if [ -z "$guacd_bin" ]; then
  echo "guacd binary not found" >&2
  exit 127
fi

set -- "$guacd_bin" -b 0.0.0.0 -l 4822 -f

if [ "${GUACD_SSL:-false}" = "true" ]; then
  tls_cert_path="${GUACD_SSL_CERT:-}"
  tls_key_path="${GUACD_SSL_KEY:-}"

  if [ -n "${GUACD_SSL_CERT_PEM:-}" ] || [ -n "${GUACD_SSL_KEY_PEM:-}" ]; then
    tls_dir="/tmp/guacd-tls"
    mkdir -p "$tls_dir"

    if [ -n "${GUACD_SSL_CERT_PEM:-}" ]; then
      tls_cert_path="$tls_dir/server-cert.pem"
      printf '%s\n' "$GUACD_SSL_CERT_PEM" > "$tls_cert_path"
      chmod 0644 "$tls_cert_path"
    fi

    if [ -n "${GUACD_SSL_KEY_PEM:-}" ]; then
      tls_key_path="$tls_dir/server-key.pem"
      printf '%s\n' "$GUACD_SSL_KEY_PEM" > "$tls_key_path"
      chmod 0600 "$tls_key_path"
    fi
  fi

  if [ -z "$tls_cert_path" ] || [ -z "$tls_key_path" ]; then
    echo "GUACD_SSL=true requires GUACD_SSL_CERT and GUACD_SSL_KEY (or *_PEM variants)" >&2
    exit 1
  fi

  echo "Starting guacd with TLS..."
  exec "$@" -C "$tls_cert_path" -K "$tls_key_path"
fi

echo "Starting guacd..."
exec "$@"
