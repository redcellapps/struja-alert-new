# Operations on the server (docs/ops.md). Needs docker/.env.prod (copy docker/prod.env.example).
COMPOSE ?= docker compose --env-file docker/.env.prod -f docker/compose.prod.yaml
PROFILES ?=

.PHONY: help build up down ps logs migrate deploy backup-now restore-test

help:
	@echo "build         build the server image"
	@echo "up            start (or update) the stack"
	@echo "down          stop the stack (volumes are kept)"
	@echo "ps | logs     status | follow the server log"
	@echo "migrate       apply database migrations with the current image"
	@echo "deploy        pull, build, migrate, then restart the server on the new image"
	@echo "backup-now    take a database dump now"
	@echo "restore-test  restore the latest dump into a scratch database and compare counts"
	@echo "Profiles: make up PROFILES='--profile caddy --profile offsite'"

build:
	$(COMPOSE) build server

up:
	$(COMPOSE) $(PROFILES) up -d

down:
	$(COMPOSE) $(PROFILES) down

ps:
	$(COMPOSE) $(PROFILES) ps

logs:
	$(COMPOSE) logs -f --tail=200 server

# Migrations run before the new version serves anything: the database is started, the migrations are
# applied by a one-off container of the new image, and only then does the server container restart.
migrate:
	$(COMPOSE) up -d db
	$(COMPOSE) run --rm --no-deps -e RUN_JOBS=false server node apps/server/src/db/migrate-cli.ts

deploy:
	git pull --ff-only
	$(MAKE) build
	$(MAKE) migrate
	$(COMPOSE) $(PROFILES) up -d
	@echo "waiting for the server to become healthy..."
	@for i in $$(seq 1 30); do \
	  s=$$($(COMPOSE) ps --format '{{.Health}}' server); \
	  if [ "$$s" = "healthy" ]; then echo "healthy"; exit 0; fi; sleep 3; \
	done; echo "server did not become healthy"; $(COMPOSE) logs --tail=50 server; exit 1

backup-now:
	$(COMPOSE) exec server node apps/server/src/jobs/backup-cli.ts

restore-test:
	sh docker/restore-test.sh "$(COMPOSE)"
