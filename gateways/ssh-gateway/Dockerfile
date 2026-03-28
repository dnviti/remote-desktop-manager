# Build context: monorepo root (see compose.yml — context: .)
# This allows copying gateways/tunnel-agent sources alongside the ssh-gateway files.

# ── gRPC key management server build stage ──────────────────────────────────
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS grpc-builder

WORKDIR /build
COPY gateways/ssh-gateway/grpc-server/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /key-mgmt-server .

# ── Tunnel agent build stage ─────────────────────────────────────────────────
FROM --platform=$BUILDPLATFORM node:22-alpine AS tunnel-builder

WORKDIR /tunnel-agent

COPY gateways/tunnel-agent/package.json ./
RUN npm install --ignore-scripts

COPY gateways/tunnel-agent/tsconfig.json ./
COPY gateways/tunnel-agent/src/ ./src/

RUN npm run build && npm prune --omit=dev

# ── SSH gateway runtime ───────────────────────────────────────────────────────
FROM alpine:3.21

RUN apk update && apk upgrade --no-cache

LABEL org.opencontainers.image.title="Arsenale SSH Gateway"
LABEL org.opencontainers.image.description="Lightweight SSH tunnel for TCP port forwarding (no shell access)"
LABEL org.opencontainers.image.source="https://github.com/dnviti/arsenale"
LABEL org.opencontainers.image.licenses="MIT"

RUN apk add --no-cache openssh-server netcat-openbsd busybox-extras nodejs \
    && adduser -D -s /sbin/nologin tunnel \
    && sed -i 's/^tunnel:!/tunnel:*/' /etc/shadow \
    && mkdir -p /config

COPY gateways/ssh-gateway/sshd_config /etc/ssh/sshd_config
RUN sed -i 's/\r$//' /etc/ssh/sshd_config

COPY gateways/ssh-gateway/entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

# gRPC key management server (static binary — replaces Node.js key-api-server.js)
COPY --from=grpc-builder /key-mgmt-server /usr/local/bin/key-mgmt-server

# Embed pre-built tunnel agent
COPY --from=tunnel-builder /tunnel-agent/dist /opt/tunnel-agent/dist
COPY --from=tunnel-builder /tunnel-agent/node_modules /opt/tunnel-agent/node_modules
COPY --from=tunnel-builder /tunnel-agent/package.json /opt/tunnel-agent/package.json

USER tunnel

EXPOSE 2222 9022

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
    CMD nc -z localhost ${SSH_PORT:-2222} || exit 1

ENTRYPOINT ["/entrypoint.sh"]
