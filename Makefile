# Makefile to replicate .vscode/launch.json and tasks.json configurations

# Auto-detect container runtime: prefer docker, fallback to podman
CONTAINER_RT := $(shell command -v docker >/dev/null 2>&1 && echo docker || echo podman)

.PHONY: help install generate-db server-dev server-debug client-dev migrate-dev prisma-studio full-stack dev-env dev-env-down dev-env-logs

help:
	@echo "Available targets (mapped from .vscode/launch.json):"
	@echo "  make server-dev    - Server: Dev (with watch, generates DB first)"
	@echo "  make server-debug  - Server: Debug (no watch)"
	@echo "  make client-dev    - Client: Dev"
	@echo "  make migrate-dev   - Prisma: Migrate Dev"
	@echo "  make prisma-studio - Prisma: Studio"
	@echo "  make full-stack    - Full Stack: Server + Client (installs and runs both)"
	@echo "  make install       - Task: node:install (npm install)"
	@echo "  make generate-db   - Task: db:generate (npm run db:generate)"
	@echo "  make dev-env       - Start dev environment (postgres, guacenc, gocache)"
	@echo "  make dev-env-down  - Stop dev environment"
	@echo "  make dev-env-logs  - Follow dev environment logs"

# Tasks
install:
	npm install

generate-db:
	npm run db:generate

# Launch Configurations
server-dev: generate-db
	cd server && npx tsx watch src/index.ts

server-debug:
	cd server && npx tsx src/index.ts

client-dev:
	cd client && npx vite

migrate-dev:
	cd server && npx prisma migrate dev

prisma-studio:
	cd server && npx prisma studio

# Dev Environment (compose.dev.yml)
dev-env:
	$(CONTAINER_RT) compose -f compose.dev.yml up -d --build

dev-env-down:
	$(CONTAINER_RT) compose -f compose.dev.yml down

dev-env-logs:
	$(CONTAINER_RT) compose -f compose.dev.yml logs -f

# Compound Configuration
full-stack: install
	npx concurrently -n server,client -c blue,green "$(MAKE) server-dev" "$(MAKE) client-dev"
