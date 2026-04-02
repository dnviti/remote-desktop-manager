# syntax=docker/dockerfile:1.7

ARG GO_VERSION=1.25.8

# ── Tunnel agent build stage ─────────────────────────────────────────────────
FROM --platform=$BUILDPLATFORM docker.io/library/node:22-alpine AS tunnel-builder

WORKDIR /tunnel-agent

COPY gateways/tunnel-agent/package.json ./
RUN npm install --ignore-scripts

COPY gateways/tunnel-agent/tsconfig.json ./
COPY gateways/tunnel-agent/src/ ./src/

RUN npm run build && npm prune --omit=dev

# ── DB proxy service build stage ─────────────────────────────────────────────
FROM --platform=$BUILDPLATFORM docker.io/library/golang:${GO_VERSION}-alpine AS proxy-builder

WORKDIR /src/backend

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/. ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/db-proxy ./cmd/db-proxy

# ── DB proxy runtime ─────────────────────────────────────────────────────────
FROM docker.io/library/node:22-alpine

LABEL org.opencontainers.image.title="Arsenale DB Proxy"
LABEL org.opencontainers.image.description="Database proxy middleware with bundled database drivers and zero-trust tunnel support"
LABEL org.opencontainers.image.source="https://github.com/dnviti/arsenale"
LABEL org.opencontainers.image.licenses="BUSL-1.1"

RUN apk add --no-cache ca-certificates && \
    addgroup -S dbproxy && adduser -S dbproxy -G dbproxy

COPY --from=proxy-builder /out/db-proxy /usr/local/bin/db-proxy

COPY --from=tunnel-builder /tunnel-agent/dist /opt/tunnel-agent/dist
COPY --from=tunnel-builder /tunnel-agent/node_modules /opt/tunnel-agent/node_modules
COPY --from=tunnel-builder /tunnel-agent/package.json /opt/tunnel-agent/package.json

COPY gateways/db-proxy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER dbproxy

ENV DB_LISTEN_PORT=5432

EXPOSE 5432

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD wget -qO- http://127.0.0.1:${DB_LISTEN_PORT}/healthz >/dev/null || exit 1

ENTRYPOINT ["/entrypoint.sh"]
