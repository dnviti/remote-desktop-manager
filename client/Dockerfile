# ---------------------------------------------------------------------------
# Stage 1: Install dependencies (with native build tools for monorepo deps)
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY .npmrc* ./
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/

RUN npm ci

# ---------------------------------------------------------------------------
# Stage: Dev target (deps only — source bind-mounted at runtime)
# ---------------------------------------------------------------------------
FROM node:22-alpine AS dev

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./

USER node

# ---------------------------------------------------------------------------
# Stage 2: Build static assets
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY client/ ./client/

WORKDIR /app/client
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 3: Serve with nginx (rootless)
# ---------------------------------------------------------------------------
FROM nginx:1.28-alpine

RUN apk upgrade --no-cache

COPY --from=build /app/client/dist /usr/share/nginx/html
COPY client/nginx.main.conf /etc/nginx/nginx.conf
COPY client/nginx.conf /etc/nginx/conf.d/default.conf

RUN chown -R nginx:nginx /var/cache/nginx /var/run /var/log/nginx

EXPOSE 8080

USER nginx

HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=5s \
    CMD wget -qO- http://127.0.0.1:8080/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
