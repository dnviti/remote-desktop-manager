FROM node:22-alpine

WORKDIR /app

COPY server/package.json ./
COPY package-lock.json ./
RUN npm install --production=false

# Copy everything prisma needs BEFORE generate
COPY server/prisma ./prisma
COPY server/prisma.config.ts ./
COPY server/tsconfig.json ./
RUN npx prisma generate

# Copy source and compile
COPY server/src ./src
RUN npx tsc

RUN npm prune --production

RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
    && chown -R appuser:appgroup /app

RUN mkdir -p /guacd-drive && chmod 1777 /guacd-drive

USER appuser

EXPOSE 3001 3002

HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=30s \
    CMD wget -qO- http://localhost:3001/api/health || exit 1

CMD ["node", "dist/index.js"]
