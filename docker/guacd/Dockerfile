# Custom guacd image with embedded zero-trust tunnel agent.
# Build context: monorepo root
#
# Usage:
#   docker build -t arsenale-guacd -f docker/guacd/Dockerfile .
#
# The tunnel agent is dormant unless TUNNEL_SERVER_URL / TUNNEL_TOKEN /
# TUNNEL_GATEWAY_ID environment variables are set.

# ── Tunnel agent build stage ─────────────────────────────────────────────────
FROM node:22-alpine AS tunnel-builder

WORKDIR /tunnel-agent

COPY tunnel-agent/package.json ./
RUN npm install --ignore-scripts

COPY tunnel-agent/tsconfig.json ./
COPY tunnel-agent/src/ ./src/

RUN npm run build && npm prune --omit=dev

# ── guacd runtime + tunnel agent ─────────────────────────────────────────────
FROM guacamole/guacd:1.6.0

LABEL org.opencontainers.image.title="Arsenale guacd"
LABEL org.opencontainers.image.description="guacd with embedded zero-trust tunnel agent"
LABEL org.opencontainers.image.source="https://github.com/dnviti/arsenale"
LABEL org.opencontainers.image.licenses="BUSL-1.1"

USER root

# Install Node.js runtime (Debian-based guacd image, so use apt)
RUN apt-get update -qq \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Embed pre-built tunnel agent
COPY --from=tunnel-builder /tunnel-agent/dist /opt/tunnel-agent/dist
COPY --from=tunnel-builder /tunnel-agent/node_modules /opt/tunnel-agent/node_modules
COPY --from=tunnel-builder /tunnel-agent/package.json /opt/tunnel-agent/package.json

COPY docker/guacd/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# guacd runs as daemon user (uid 1000 in the official image)
USER daemon

EXPOSE 4822

ENTRYPOINT ["/entrypoint.sh"]
