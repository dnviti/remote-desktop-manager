# Database Protocol Gateway — protocol-aware proxy for PostgreSQL, MySQL, and MongoDB.
# Build context: monorepo root
#
# Usage:
#   docker build -t arsenale-db-proxy -f gateways/db-proxy/Dockerfile .
#
# The container acts as a protocol-aware intermediary between users and target
# databases. Credentials are injected per-session from the Arsenale vault.
#
# Environment variables:
#   DB_LISTEN_PORT      — port the proxy listens on (default: 5432)
#   TUNNEL_SERVER_URL   — (optional) zero-trust tunnel server URL
#   TUNNEL_TOKEN        — (optional) tunnel authentication token
#   TUNNEL_GATEWAY_ID   — (optional) gateway ID for tunnel registration
#   TUNNEL_LOCAL_PORT   — (optional) local port for tunnel (default: 5432)

# ── Tunnel agent build stage ─────────────────────────────────────────────────
FROM --platform=$BUILDPLATFORM node:22-alpine AS tunnel-builder

WORKDIR /tunnel-agent

COPY gateways/tunnel-agent/package.json ./
RUN npm install --ignore-scripts

COPY gateways/tunnel-agent/tsconfig.json ./
COPY gateways/tunnel-agent/src/ ./src/

RUN npm run build && npm prune --omit=dev

# ── DB proxy runtime ─────────────────────────────────────────────────────────
FROM node:22-alpine

LABEL org.opencontainers.image.title="Arsenale DB Proxy"
LABEL org.opencontainers.image.description="Database protocol gateway with zero-trust tunnel support"
LABEL org.opencontainers.image.source="https://github.com/dnviti/arsenale"
LABEL org.opencontainers.image.licenses="BUSL-1.1"

RUN apk update && apk upgrade --no-cache

# Embed pre-built tunnel agent
COPY --from=tunnel-builder /tunnel-agent/dist /opt/tunnel-agent/dist
COPY --from=tunnel-builder /tunnel-agent/node_modules /opt/tunnel-agent/node_modules
COPY --from=tunnel-builder /tunnel-agent/package.json /opt/tunnel-agent/package.json

COPY gateways/db-proxy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Run as non-root
RUN addgroup -S dbproxy && adduser -S dbproxy -G dbproxy
USER dbproxy

ENV DB_LISTEN_PORT=5432

EXPOSE 5432

HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=10s \
  CMD nc -z localhost ${DB_LISTEN_PORT:-5432} || exit 1

ENTRYPOINT ["/entrypoint.sh"]
