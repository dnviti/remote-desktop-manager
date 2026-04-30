# Build context: monorepo root (see compose.yml — context: .)
# This allows copying gateways/tunnel-agent and gateway-core sources alongside the ssh-gateway files.

ARG GO_VERSION=1.25.8

# ── gRPC key management server build stage ──────────────────────────────────
FROM --platform=$BUILDPLATFORM docker.io/library/golang:${GO_VERSION}-alpine AS grpc-builder

WORKDIR /build
COPY gateways/ssh-gateway/grpc-server/ ./
ARG TARGETOS
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} \
    go build -ldflags="-s -w" -o /key-mgmt-server .

# ── Tunnel agent build stage ─────────────────────────────────────────────────
FROM --platform=$BUILDPLATFORM docker.io/library/golang:${GO_VERSION}-alpine AS tunnel-builder

WORKDIR /src

COPY gateways/gateway-core/go.mod gateways/gateway-core/
COPY gateways/tunnel-agent/go.mod gateways/tunnel-agent/go.sum gateways/tunnel-agent/
WORKDIR /src/gateways/tunnel-agent
RUN GOWORK=off go mod download

WORKDIR /src
COPY gateways/gateway-core/ gateways/gateway-core/
COPY gateways/tunnel-agent/ gateways/tunnel-agent/
WORKDIR /src/gateways/tunnel-agent

ARG TARGETOS
ARG TARGETARCH
ARG AGENT_VERSION=1.7.1
RUN GOWORK=off CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} \
    go build -trimpath -ldflags="-s -w -X main.version=${AGENT_VERSION}" \
    -o /out/tunnel-agent .

# ── SSH gateway runtime ───────────────────────────────────────────────────────
FROM docker.io/library/alpine:3.21

LABEL org.opencontainers.image.title="Arsenale SSH Gateway"
LABEL org.opencontainers.image.description="Lightweight SSH tunnel for TCP port forwarding (no shell access)"
LABEL org.opencontainers.image.source="https://github.com/dnviti/arsenale"
LABEL org.opencontainers.image.licenses="MIT"

RUN apk add --no-cache openssh-server netcat-openbsd busybox-extras \
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
COPY --from=tunnel-builder /out/tunnel-agent /usr/local/bin/tunnel-agent

USER tunnel

EXPOSE 2222 9022

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
    CMD nc -z localhost ${SSH_PORT:-2222} || exit 1

ENTRYPOINT ["/entrypoint.sh"]
