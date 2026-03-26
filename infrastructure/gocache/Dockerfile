# Build stage
FROM golang:1.25-alpine AS builder

RUN apk add --no-cache git

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /gocache .

# Runtime stage
FROM alpine:3.21

LABEL org.opencontainers.image.title="gocache" \
      org.opencontainers.image.description="In-memory cache server with gRPC clustering" \
      org.opencontainers.image.source="https://github.com/dnviti/arsenale"

RUN apk add --no-cache ca-certificates wget && \
    addgroup -g 10001 -S gocache && \
    adduser -u 10001 -S gocache -G gocache -h /home/gocache && \
    mkdir -p /data && chown gocache:gocache /data

COPY --from=builder --chown=10001:10001 /gocache /usr/local/bin/gocache

VOLUME /data

EXPOSE 6380
EXPOSE 6381

USER 10001:10001

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:6381/health || exit 1

ENTRYPOINT ["/usr/local/bin/gocache"]
