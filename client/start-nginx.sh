#!/bin/sh
set -eu

resolver="${NGINX_RESOLVER:-}"
api_upstream_host="${API_UPSTREAM_HOST:-control-plane-api}"
desktop_upstream_host="${DESKTOP_UPSTREAM_HOST:-desktop-broker}"
map_assets_upstream_host="${MAP_ASSETS_UPSTREAM_HOST:-map-assets}"
terminal_upstream_host="${TERMINAL_UPSTREAM_HOST:-terminal-broker}"
if [ -z "$resolver" ]; then
    resolver="$(awk '/^nameserver[[:space:]]+/ { print $2; exit }' /etc/resolv.conf)"
fi

if [ -z "$resolver" ]; then
    echo "could not determine nginx resolver from /etc/resolv.conf" >&2
    exit 1
fi

sed \
    -e "s|\${NGINX_RESOLVER}|$resolver|g" \
    -e "s|\${API_UPSTREAM_HOST}|$api_upstream_host|g" \
    -e "s|\${DESKTOP_UPSTREAM_HOST}|$desktop_upstream_host|g" \
    -e "s|\${MAP_ASSETS_UPSTREAM_HOST}|$map_assets_upstream_host|g" \
    -e "s|\${TERMINAL_UPSTREAM_HOST}|$terminal_upstream_host|g" \
    /etc/nginx/templates/default.conf.template \
    > /tmp/default.conf

exec nginx -g 'daemon off;'
