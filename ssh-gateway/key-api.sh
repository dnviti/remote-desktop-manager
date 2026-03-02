#!/bin/sh
# CGI handler for SSH authorized_keys management
# Served by BusyBox httpd at /cgi-bin/authorized-keys
# Expects: GATEWAY_API_TOKEN env var for bearer token auth

AUTH_FILE="/home/tunnel/.ssh/authorized_keys"

# --- Auth check ---
expected="Bearer $GATEWAY_API_TOKEN"
if [ -z "$GATEWAY_API_TOKEN" ] || [ "$HTTP_AUTHORIZATION" != "$expected" ]; then
  printf 'Status: 401\r\nContent-Type: application/json\r\n\r\n'
  printf '{"error":"Unauthorized"}\n'
  exit 0
fi

# --- GET: return current authorized keys ---
if [ "$REQUEST_METHOD" = "GET" ]; then
  printf 'Status: 200\r\nContent-Type: application/json\r\n\r\n'
  if [ -s "$AUTH_FILE" ]; then
    # Build JSON array from non-empty lines
    keys=$(awk 'NF{gsub(/"/, "\\\""); printf "%s\"%s\"", sep, $0; sep=","}' "$AUTH_FILE")
    printf '{"keys":[%s]}\n' "$keys"
  else
    printf '{"keys":[]}\n'
  fi
  exit 0
fi

# --- POST: write new authorized key ---
if [ "$REQUEST_METHOD" = "POST" ]; then
  # Read body from stdin (CONTENT_LENGTH set by httpd)
  body=""
  if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
    body=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null)
  fi

  # Extract publicKey value from JSON (simple sed — no jq dependency)
  pubkey=$(printf '%s' "$body" | sed -n 's/.*"publicKey"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

  if [ -z "$pubkey" ]; then
    printf 'Status: 400\r\nContent-Type: application/json\r\n\r\n'
    printf '{"error":"Missing publicKey"}\n'
    exit 0
  fi

  # Validate key format (must start with ssh- or ecdsa-)
  case "$pubkey" in
    ssh-*|ecdsa-*) ;;
    *)
      printf 'Status: 400\r\nContent-Type: application/json\r\n\r\n'
      printf '{"error":"Invalid key format"}\n'
      exit 0
      ;;
  esac

  # Write key to authorized_keys (overwrite)
  printf '%s\n' "$pubkey" > "$AUTH_FILE"
  chown tunnel:tunnel "$AUTH_FILE"
  chmod 600 "$AUTH_FILE"

  printf 'Status: 200\r\nContent-Type: application/json\r\n\r\n'
  printf '{"ok":true}\n'
  exit 0
fi

# --- Unsupported method ---
printf 'Status: 405\r\nContent-Type: application/json\r\n\r\n'
printf '{"error":"Method not allowed"}\n'
