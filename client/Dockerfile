FROM node:22-alpine AS build

WORKDIR /app

COPY client/package.json client/package-lock.json* ./
RUN npm install

COPY client/ .
RUN npm run build

FROM alpine:3.21

RUN apk add --no-cache nginx \
    && mkdir -p /etc/nginx/conf.d /usr/share/nginx/html \
    && mkdir -p /var/cache/nginx /var/lib/nginx /var/log/nginx \
    && chown -R nginx:nginx /var/cache/nginx /var/lib/nginx /var/log/nginx \
    && chown -R nginx:nginx /usr/share/nginx/html

COPY --from=build /app/dist /usr/share/nginx/html
COPY client/nginx.main.conf /etc/nginx/nginx.conf
COPY client/nginx.conf /etc/nginx/conf.d/default.conf

USER nginx

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=5s \
  CMD wget -qO- http://localhost:8080/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
