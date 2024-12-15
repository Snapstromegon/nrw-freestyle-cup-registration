
all: frontend backend
	
migrate-db:
	sqlx migrate run

install-frontend:
	cd frontend && npm install
	mkdir -p static

openapi: install-frontend
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
