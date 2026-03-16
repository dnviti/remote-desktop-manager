# Build context: monorepo root (see compose.yml — context: .)
# This allows copying gateways/tunnel-agent sources alongside the ssh-gateway files.

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
    && mkdir -p /home/tunnel/.ssh \
    && chown tunnel:tunnel /home/tunnel/.ssh \
    && chmod 700 /home/tunnel/.ssh \
    && mkdir -p /config

COPY gateways/ssh-gateway/sshd_config /etc/ssh/sshd_config
RUN sed -i 's/\r$//' /etc/ssh/sshd_config

# Generate host keys at build time and make them readable by tunnel user
RUN ssh-keygen -A \
    && chown tunnel:tunnel /etc/ssh/ssh_host_*_key /etc/ssh/ssh_host_*_key.pub \
    && chmod 600 /etc/ssh/ssh_host_*_key \
    && chmod 644 /etc/ssh/ssh_host_*_key.pub

COPY gateways/ssh-gateway/entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

RUN mkdir -p /var/www/cgi-bin
COPY gateways/ssh-gateway/key-api.sh /var/www/cgi-bin/authorized-keys
RUN sed -i 's/\r$//' /var/www/cgi-bin/authorized-keys && chmod +x /var/www/cgi-bin/authorized-keys

# Embed pre-built tunnel agent
COPY --from=tunnel-builder /tunnel-agent/dist /opt/tunnel-agent/dist
COPY --from=tunnel-builder /tunnel-agent/node_modules /opt/tunnel-agent/node_modules
COPY --from=tunnel-builder /tunnel-agent/package.json /opt/tunnel-agent/package.json

USER tunnel

EXPOSE 2222 8022

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
    CMD nc -z localhost ${SSH_PORT:-2222} || exit 1

ENTRYPOINT ["/entrypoint.sh"]
