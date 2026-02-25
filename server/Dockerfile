FROM node:22-alpine

WORKDIR /app

COPY server/package.json server/package-lock.json* ./
RUN npm install --production=false

COPY server/prisma ./prisma
RUN npx prisma generate

COPY server/ .
RUN npx tsc

RUN npm prune --production

EXPOSE 3001 3002

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
