# syntax=docker/dockerfile:1.7

ARG GO_VERSION=1.25.8

# Build stage
FROM --platform=$BUILDPLATFORM docker.io/library/golang:${GO_VERSION}-alpine AS builder
ARG TARGETOS
ARG TARGETARCH

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY *.go ./
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} go build -trimpath -ldflags="-s -w" -o /out/arsenale-tunnel-agent .

# Runtime stage
FROM docker.io/library/alpine:3.22

LABEL org.opencontainers.image.title="Arsenale Tunnel Agent"
LABEL org.opencontainers.image.description="Zero-trust tunnel agent for non-managed gateways"
LABEL org.opencontainers.image.source="https://github.com/dnviti/arsenale"
LABEL org.opencontainers.image.licenses="BUSL-1.1"

WORKDIR /app

RUN apk upgrade --no-cache && \
    apk add --no-cache ca-certificates

COPY --from=builder /out/arsenale-tunnel-agent /usr/local/bin/arsenale-tunnel-agent

# Non-root user
RUN adduser -D -s /sbin/nologin agent
USER agent

# Required env vars (no defaults; absent = dormant mode):
# TUNNEL_SERVER_URL   wss://your-server/tunnel
# TUNNEL_TOKEN        <hex token>
# TUNNEL_GATEWAY_ID   <uuid>
# TUNNEL_LOCAL_PORT   4822  (guacd) or 2222 (sshd)
#
# Optional:
# TUNNEL_LOCAL_HOST   127.0.0.1
# TUNNEL_CA_CERT      <PEM>
# TUNNEL_CLIENT_CERT  <PEM>
# TUNNEL_CLIENT_KEY   <PEM>

HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=5s \
  CMD test -x /usr/local/bin/arsenale-tunnel-agent || exit 1

CMD ["/usr/local/bin/arsenale-tunnel-agent"]
