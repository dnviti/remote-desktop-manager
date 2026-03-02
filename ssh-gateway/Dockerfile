FROM alpine:3.21

LABEL org.opencontainers.image.title="RDM SSH Gateway"
LABEL org.opencontainers.image.description="Lightweight SSH tunnel for TCP port forwarding (no shell access)"
LABEL org.opencontainers.image.source="https://github.com/dnviti/remote-desktop-manager"
LABEL org.opencontainers.image.licenses="MIT"

RUN apk add --no-cache openssh-server netcat-openbsd busybox-extras \
    && adduser -D -s /sbin/nologin tunnel \
    && sed -i 's/^tunnel:!/tunnel:*/' /etc/shadow \
    && mkdir -p /home/tunnel/.ssh \
    && chown tunnel:tunnel /home/tunnel/.ssh \
    && chmod 700 /home/tunnel/.ssh \
    && mkdir -p /config

COPY sshd_config /etc/ssh/sshd_config
RUN sed -i 's/\r$//' /etc/ssh/sshd_config
COPY entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

RUN mkdir -p /var/www/cgi-bin
COPY key-api.sh /var/www/cgi-bin/authorized-keys
RUN sed -i 's/\r$//' /var/www/cgi-bin/authorized-keys && chmod +x /var/www/cgi-bin/authorized-keys

EXPOSE 2222 8022

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
    CMD nc -z localhost ${SSH_PORT:-2222} || exit 1

ENTRYPOINT ["/entrypoint.sh"]
