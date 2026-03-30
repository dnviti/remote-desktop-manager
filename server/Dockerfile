# ---------------------------------------------------------------------------
# Stage 1: Install ALL dependencies (dev + prod) with native build tools
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
COPY server/prisma server/prisma
COPY server/prisma.config.ts server/
COPY server/tsconfig.json server/

USER node

# ---------------------------------------------------------------------------
# Stage 2: Build (Prisma generate + TypeScript compile)
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server/ ./server/

# Generate Prisma client
RUN npx prisma generate --schema=server/prisma/schema.prisma

# Compile TypeScript
WORKDIR /app/server
RUN npx tsc

# ---------------------------------------------------------------------------
# Stage 3: Production dependencies only (no dev deps, no build tools)
# ---------------------------------------------------------------------------
FROM node:22-alpine AS prod-deps

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY .npmrc* ./
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/

RUN npm ci --omit=dev && \
    npx prisma generate --schema=server/prisma/schema.prisma 2>/dev/null || true

# Remove build tools from this layer (native modules already compiled)
# The final stage copies only node_modules, not the apk packages

# ---------------------------------------------------------------------------
# Stage 4: Runtime (minimal — no build tools, no dev deps, no source)
# ---------------------------------------------------------------------------
FROM node:22-alpine

WORKDIR /app

# Production node_modules (with Prisma client generated)
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./package.json

# Compiled JavaScript output
COPY --from=build /app/server/dist ./dist

# Prisma schema + migrations (needed for prisma migrate deploy at runtime)
COPY --from=build /app/server/prisma ./prisma
COPY --from=build /app/server/prisma.config.ts ./prisma.config.ts

# CLI wrapper
RUN printf '#!/bin/sh\nexec node /app/dist/cli.js "$@"\n' > /usr/local/bin/arsenale && \
    chmod +x /usr/local/bin/arsenale

# Rootless: create user + writable directories before switching
RUN addgroup -S appgroup && adduser -S appuser -G appgroup && \
    mkdir -p /guacd-drive /recordings && \
    chown appuser:appgroup /guacd-drive /recordings /app

USER appuser

EXPOSE 3001 3002

HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=30s \
    CMD sh -c 'node -e "const fs=require(\"fs\");const http=require(\"http\");const https=require(\"https\");const useTls=Boolean(process.env.SERVER_TLS_CERT&&process.env.SERVER_TLS_KEY);const request=useTls?https:http;const options=useTls?{hostname:\"localhost\",port:3001,path:\"/api/health\",ca:fs.readFileSync(\"/certs/ca.pem\")}:{hostname:\"localhost\",port:3001,path:\"/api/health\"};request.get(options,res=>{res.resume();process.exit(res.statusCode===200?0:1);}).on(\"error\",()=>process.exit(1));"' || exit 1

CMD ["node", "dist/index.js"]
