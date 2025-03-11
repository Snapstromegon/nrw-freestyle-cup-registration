
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

run-release: release
	cargo run --release

lint:
	cargo clippy
	cd frontend && npm run lint

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
