FROM docker.io/library/alpine:3.18 AS builder

ARG GUAC_VERSION=1.6.0

RUN apk add --no-cache \
    build-base autoconf automake libtool pkgconf curl \
    ffmpeg-dev libpng-dev cairo-dev libjpeg-turbo-dev \
    util-linux-dev

RUN curl -fsSL "https://archive.apache.org/dist/guacamole/${GUAC_VERSION}/source/guacamole-server-${GUAC_VERSION}.tar.gz" \
    | tar xz -C /tmp

WORKDIR /tmp/guacamole-server-${GUAC_VERSION}

RUN autoreconf -fi \
    && ./configure --with-guacenc --without-guacd --without-guaclog \
       --disable-guaclog --disable-guacd \
    && make -j$(nproc) \
    && cp src/guacenc/.libs/guacenc /usr/local/bin/guacenc

# ── agg (asciicast-to-GIF renderer) build stage ──────────────────────
FROM --platform=$BUILDPLATFORM docker.io/library/alpine:3.18 AS agg-builder

ARG AGG_VERSION=1.7.0
ARG TARGETARCH

RUN apk add --no-cache curl && \
    case "${TARGETARCH}" in \
      amd64) AGG_ARCH="x86_64-unknown-linux-musl" ;; \
      arm64) AGG_ARCH="aarch64-unknown-linux-gnu" ;; \
      *) echo "Unsupported arch: ${TARGETARCH}" && exit 1 ;; \
    esac && \
    curl -fsSL -o /usr/local/bin/agg \
      "https://github.com/asciinema/agg/releases/download/v${AGG_VERSION}/agg-${AGG_ARCH}" && \
    chmod +x /usr/local/bin/agg

# ── Go service build stage ────────────────────────────────────────────
FROM --platform=$BUILDPLATFORM docker.io/library/golang:1.25-alpine AS go-builder

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY *.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /usr/local/bin/arsenale-guacenc .

# ── Runtime stage ─────────────────────────────────────────────────────
FROM docker.io/library/alpine:3.18

RUN apk add --no-cache \
    ffmpeg-libs ffmpeg libpng cairo libjpeg-turbo libuuid curl \
    fontconfig font-dejavu font-liberation

RUN addgroup -S guacenc && adduser -S -G guacenc guacenc

COPY --from=builder /usr/local/bin/guacenc /usr/local/bin/guacenc
COPY --from=builder /tmp/guacamole-server-1.6.0/src/libguac/.libs/libguac.so* /usr/local/lib/
RUN ldconfig /usr/local/lib

COPY --from=agg-builder /usr/local/bin/agg /usr/local/bin/agg
COPY --from=go-builder /usr/local/bin/arsenale-guacenc /usr/local/bin/arsenale-guacenc

RUN mkdir -p /recordings && chown guacenc:guacenc /recordings

EXPOSE 3003

HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=5s \
    CMD sh -c 'if [ -n "$GUACENC_TLS_CERT" ] && [ -n "$GUACENC_TLS_KEY" ]; then curl --silent --show-error --fail --insecure https://127.0.0.1:3003/health >/dev/null; else curl --silent --show-error --fail http://127.0.0.1:3003/health >/dev/null; fi' || exit 1

USER guacenc

CMD ["/usr/local/bin/arsenale-guacenc"]
