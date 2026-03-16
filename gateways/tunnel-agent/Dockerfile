# ── Build stage ──────────────────────────────────────────────────────────────
FROM --platform=$BUILDPLATFORM node:22-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install --ignore-scripts

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build && npm prune --omit=dev

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine

RUN apk update && apk upgrade --no-cache

LABEL org.opencontainers.image.title="Arsenale Tunnel Agent"
LABEL org.opencontainers.image.description="Zero-trust tunnel agent for non-managed gateways"
LABEL org.opencontainers.image.source="https://github.com/dnviti/arsenale"
LABEL org.opencontainers.image.licenses="BUSL-1.1"

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Non-root user
RUN adduser -D -s /sbin/nologin agent
USER agent

ENV NODE_ENV=production

# Required env vars (no defaults — absent = dormant mode):
# TUNNEL_SERVER_URL   wss://your-server/tunnel
# TUNNEL_TOKEN        <hex token>
# TUNNEL_GATEWAY_ID   <uuid>
# TUNNEL_LOCAL_PORT   4822  (guacd) or 2222 (sshd)
#
# Optional:
# TUNNEL_LOCAL_HOST   localhost
# TUNNEL_CA_CERT      <PEM>
# TUNNEL_CLIENT_CERT  <PEM>
# TUNNEL_CLIENT_KEY   <PEM>

HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=5s \
  CMD node -e "process.exit(0)" || exit 1

CMD ["node", "dist/index.js"]
