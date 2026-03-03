FROM node:22

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    openssh-client \
    procps \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Let the node user access the Docker socket (mounted at runtime)
RUN groupadd -f docker && usermod -aG docker node

WORKDIR /app

# Ensure the node user owns the workspace and the node_modules mount point
RUN mkdir -p /app/node_modules && chown -R node:node /app
