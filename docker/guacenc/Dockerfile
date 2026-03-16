FROM alpine:3.18 AS builder

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
FROM --platform=$BUILDPLATFORM alpine:3.18 AS agg-builder

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

# ── Runtime stage ─────────────────────────────────────────────────────
FROM alpine:3.18

RUN apk update && apk upgrade --no-cache

RUN apk add --no-cache python3 ffmpeg-libs ffmpeg libpng cairo libjpeg-turbo libuuid

COPY --from=builder /usr/local/bin/guacenc /usr/local/bin/guacenc
COPY --from=builder /tmp/guacamole-server-1.6.0/src/libguac/.libs/libguac.so* /usr/local/lib/
RUN ldconfig /usr/local/lib

COPY --from=agg-builder /usr/local/bin/agg /usr/local/bin/agg

COPY server.py /opt/guacenc/server.py

EXPOSE 3003

HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=5s \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:3003/health')" || exit 1

ENV PYTHONUNBUFFERED=1

CMD ["python3", "/opt/guacenc/server.py"]
