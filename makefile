
all: frontend backend
	
migrate-db:
	sqlx migrate run

install-frontend:
	cd frontend && npm install
	mkdir -p static

openapi: migrate-db install-frontend
	cargo run --bin gen_openapi

frontend-api: openapi
	cd frontend && npm run build:api

frontend: frontend-api
	cd frontend && npm run build

frontend-release: frontend-api
	cd frontend && npm run build:release

run: all
	cargo run

backend: migrate-db
	cargo build

release: clean-frontend openapi frontend-release migrate-db
	cargo build --release

centos-release: clean-frontend openapi frontend-release migrate-db
	cargo build --release --target x86_64-unknown-linux-musl

demo:
	cargo run --bin seed_demo

run-release: release
	cargo run --release

# Integration tests start Mailpit via testcontainers. Fall back to the rootless
# Podman socket when Docker isn't available.
PODMAN_SOCKET := /run/user/$(shell id -u)/podman/podman.sock
ifeq ($(DOCKER_HOST)$(wildcard /var/run/docker.sock),)
ifneq ($(wildcard $(PODMAN_SOCKET)),)
export DOCKER_HOST := unix://$(PODMAN_SOCKET)
endif
endif

test: migrate-db
	cargo test
	cd frontend && npm test

lint:
	cargo clippy
	cd frontend && npm run check && npm run lint

clean-frontend:
	rm -rf static

clean: clean-frontend
	cargo clean

reset: clean-frontend
	rm -rf data
	rm -rf db.sqlite3

download:
	rsync -v uberspace:nrw-freestyle-cup-registration/db.sqlite db.sqlite
	rsync -v -r uberspace:nrw-freestyle-cup-registration/data/ data/

sync-up:
	rsync -v db.sqlite uberspace:nrw-freestyle-cup-registration/db.sqlite
