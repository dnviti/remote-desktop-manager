# Build context: monorepo root (see compose.yml - context: .)
# This allows copying gateways/tunnel-agent sources alongside the ssh-gateway files.

ARG GO_VERSION=1.25.8

# gRPC key management server build stage
FROM --platform=$BUILDPLATFORM docker.io/library/golang:${GO_VERSION}-alpine AS grpc-builder

WORKDIR /build
COPY gateways/ssh-gateway/grpc-server/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /key-mgmt-server .

# Tunnel agent build stage
FROM --platform=$BUILDPLATFORM docker.io/library/golang:${GO_VERSION}-alpine AS tunnel-builder
ARG TARGETOS
ARG TARGETARCH

WORKDIR /src

COPY gateways/tunnel-agent/go.mod gateways/tunnel-agent/go.sum ./
RUN go mod download

COPY gateways/tunnel-agent/*.go ./

RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} go build -trimpath -ldflags="-s -w" -o /out/arsenale-tunnel-agent .

# SSH gateway runtime
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

# gRPC key management server (static binary - replaces Node.js key-api-server.js)
COPY --from=grpc-builder /key-mgmt-server /usr/local/bin/key-mgmt-server

# Embed pre-built tunnel agent
COPY --from=tunnel-builder /out/arsenale-tunnel-agent /usr/local/bin/arsenale-tunnel-agent

USER tunnel

EXPOSE 2222 9022

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
    CMD nc -z localhost ${SSH_PORT:-2222} || exit 1

ENTRYPOINT ["/entrypoint.sh"]
