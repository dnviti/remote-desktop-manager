# Custom guacd image with embedded zero-trust tunnel agent.
# Build context: monorepo root
#
# Usage:
#   docker build -t arsenale-guacd -f gateways/guacd/Dockerfile .
#
# The tunnel agent is dormant unless TUNNEL_SERVER_URL / TUNNEL_TOKEN /
# TUNNEL_GATEWAY_ID environment variables are set.

ARG GO_VERSION=1.25.8

# Tunnel agent build stage
FROM --platform=$BUILDPLATFORM docker.io/library/golang:${GO_VERSION}-alpine AS tunnel-builder
ARG TARGETOS
ARG TARGETARCH

WORKDIR /src

COPY gateways/tunnel-agent/go.mod gateways/tunnel-agent/go.sum ./
RUN go mod download

COPY gateways/tunnel-agent/*.go ./
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} go build -trimpath -ldflags="-s -w" -o /out/arsenale-tunnel-agent .

# guacd runtime + tunnel agent
FROM docker.io/library/alpine:3.21

USER root

LABEL org.opencontainers.image.title="Arsenale guacd"
LABEL org.opencontainers.image.description="guacd with embedded zero-trust tunnel agent"
LABEL org.opencontainers.image.source="https://github.com/dnviti/arsenale"
LABEL org.opencontainers.image.licenses="BUSL-1.1"

RUN apk add --no-cache \
    guacamole-server \
    guacamole-server-rdp \
    guacamole-server-vnc \
    guacamole-server-ssh \
    guacamole-server-libs \
    netcat-openbsd \
    shadow \
    && mkdir -p /home/guacd \
    && chown guacd:guacd /home/guacd \
    && usermod -d /home/guacd guacd \
    && ln -sf /usr/lib/libguac-client-rdp.so.0 /usr/lib/libguac-client-rdp.so \
    && ln -sf /usr/lib/libguac-client-vnc.so.0 /usr/lib/libguac-client-vnc.so \
    && ln -sf /usr/lib/libguac-client-ssh.so.0 /usr/lib/libguac-client-ssh.so

ENV HOME=/home/guacd
ENV XDG_CONFIG_HOME=/home/guacd/.config

# Embed pre-built tunnel agent
COPY --from=tunnel-builder /out/arsenale-tunnel-agent /usr/local/bin/arsenale-tunnel-agent

COPY gateways/guacd/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER guacd

EXPOSE 4822

HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=10s \
  CMD nc -z localhost 4822 || exit 1

ENTRYPOINT ["/entrypoint.sh"]
