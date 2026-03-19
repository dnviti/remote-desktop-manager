# ── Build stage ──────────────────────────────────────────────────────────────
FROM --platform=$BUILDPLATFORM golang:1.23-alpine AS builder

WORKDIR /app

COPY main.go ./

RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o rdgw-proxy main.go

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM alpine:3.21

RUN apk update && apk upgrade --no-cache && apk add --no-cache ca-certificates

LABEL org.opencontainers.image.title="Arsenale RD Gateway"
LABEL org.opencontainers.image.description="MS-TSGU RD Gateway proxy for native RDP client access"
LABEL org.opencontainers.image.source="https://github.com/dnviti/arsenale"
LABEL org.opencontainers.image.licenses="BUSL-1.1"

WORKDIR /app

COPY --from=builder /app/rdgw-proxy /app/rdgw-proxy

# Non-root user
RUN adduser -D -s /sbin/nologin rdgw
USER rdgw

# Required env vars:
# RDGW_ARSENALE_API_URL   http://arsenale-server:3001
# RDGW_API_TOKEN          <token for authenticating with Arsenale API>
#
# Optional:
# RDGW_LISTEN_ADDR        :443
# RDGW_TLS_CERT           /certs/tls.crt
# RDGW_TLS_KEY            /certs/tls.key
# RDGW_IDLE_TIMEOUT       3600
# RDGW_LOG_LEVEL          info

EXPOSE 443

HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=5s \
  CMD wget -q -O /dev/null http://localhost:443/health || exit 1

ENTRYPOINT ["/app/rdgw-proxy"]
