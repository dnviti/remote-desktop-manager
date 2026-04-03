# ---------------------------------------------------------------------------
# Stage 1: Install dependencies (with native build tools for monorepo deps)
# ---------------------------------------------------------------------------
FROM docker.io/library/node:22-alpine AS deps

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY .npmrc* ./
COPY package.json package-lock.json ./
COPY client/package.json client/

RUN npm ci

# ---------------------------------------------------------------------------
# Stage: Dev target (deps only — source bind-mounted at runtime)
# ---------------------------------------------------------------------------
FROM docker.io/library/node:22-alpine AS dev

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./

USER node

# ---------------------------------------------------------------------------
# Stage 2: Build static assets
# ---------------------------------------------------------------------------
FROM docker.io/library/node:22-alpine AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY client/ ./client/

WORKDIR /app/client
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 3: Serve with nginx (rootless)
# ---------------------------------------------------------------------------
FROM docker.io/library/nginx:1.28-alpine

RUN apk upgrade --no-cache && \
    apk add --no-cache curl
RUN rm -f /etc/nginx/conf.d/default.conf

COPY --from=build /app/client/dist /usr/share/nginx/html
COPY client/nginx.main.conf /etc/nginx/nginx.conf
COPY client/nginx.conf /etc/nginx/templates/default.conf.template
COPY client/start-nginx.sh /usr/local/bin/start-nginx.sh

RUN chmod +x /usr/local/bin/start-nginx.sh

RUN mkdir -p /certs /tmp && touch /tmp/default.conf \
    && chown -R nginx:nginx /var/cache/nginx /var/run /var/log/nginx /certs /tmp/default.conf

EXPOSE 8080

USER nginx

HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=5s \
    CMD curl --silent --show-error --fail http://127.0.0.1:8080/health >/dev/null || exit 1

CMD ["/usr/local/bin/start-nginx.sh"]
