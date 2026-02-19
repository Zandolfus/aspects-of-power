.PHONY: up down restart logs build watch install deploy status help

COMPOSE := docker compose -f Docker/docker-compose.yml --env-file Docker/.env

help:      ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

up:        ## Start FoundryVTT
	$(COMPOSE) up -d

down:      ## Stop FoundryVTT
	$(COMPOSE) down

restart:   ## Restart the Foundry service
	$(COMPOSE) restart foundry

logs:      ## Follow Foundry logs
	$(COMPOSE) logs -f foundry

build:     ## Compile SCSS → CSS
	npm run build

watch:     ## Watch SCSS for changes (local dev)
	npm run watch

install:   ## Install Node dependencies
	npm install

deploy:    ## Build CSS then restart Foundry
	$(MAKE) build
	$(MAKE) restart

status:    ## Show container status
	$(COMPOSE) ps
