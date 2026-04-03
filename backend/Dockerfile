# syntax=docker/dockerfile:1.7

ARG GO_VERSION=1.25.8
FROM docker.io/library/golang:${GO_VERSION}-alpine AS build

ARG SERVICE=control-plane-api
WORKDIR /src

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/. ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/service ./cmd/${SERVICE}
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/migrate ./cmd/migrate

FROM docker.io/library/alpine:3.22

RUN apk upgrade --no-cache && \
    apk add --no-cache ca-certificates wget && \
    addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=build /out/service /usr/local/bin/service
COPY --from=build /out/migrate /usr/local/bin/migrate

USER appuser

HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=10s \
    CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/service"]
