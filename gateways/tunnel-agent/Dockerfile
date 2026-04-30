# syntax=docker/dockerfile:1.7

ARG GO_VERSION=1.25.8
ARG ALPINE_VERSION=3.22

# Build context: monorepo root

# ── Build stage ──────────────────────────────────────────────────────────────
FROM --platform=$BUILDPLATFORM docker.io/library/golang:${GO_VERSION}-alpine AS builder

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

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM docker.io/library/alpine:${ALPINE_VERSION}

LABEL org.opencontainers.image.title="Arsenale Tunnel Agent"
LABEL org.opencontainers.image.description="Zero-trust tunnel agent for non-managed gateways"
LABEL org.opencontainers.image.source="https://github.com/dnviti/arsenale"
LABEL org.opencontainers.image.licenses="BUSL-1.1"

RUN apk upgrade --no-cache && \
    apk add --no-cache ca-certificates && \
    adduser -D -s /sbin/nologin agent

COPY --from=builder /out/tunnel-agent /usr/local/bin/tunnel-agent

USER agent

# Required env vars (no defaults; absent = dormant mode):
# TUNNEL_SERVER_URL   wss://your-server/tunnel
# TUNNEL_TOKEN        <hex token>
# TUNNEL_GATEWAY_ID   <uuid>
# TUNNEL_LOCAL_PORT   4822 (guacd) or 2222 (sshd)
#
# Optional:
# TUNNEL_LOCAL_HOST   127.0.0.1
# TUNNEL_CA_CERT      <PEM>
# TUNNEL_CLIENT_CERT  <PEM>
# TUNNEL_CLIENT_KEY   <PEM>

HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=5s \
  CMD /usr/local/bin/tunnel-agent --healthcheck || exit 1

CMD ["/usr/local/bin/tunnel-agent"]
