# Freestyle Cup Registration System

This project contains the registration system for the freestyle unicycling cup NRW.

## Configuration

Settings come from CLI flags, environment variables (including `.env`) and an
optional TOML config file, in that order of precedence. The config file is read
from `--config` / `CONFIG`, or from `./config.toml` if it exists. See
[`config.example.toml`](config.example.toml) for all options.

Event settings only come from the config file:

- `[competition]`: name, location, dates, the determining day for ages,
  registration and music upload deadlines, fees and payment details. It is
  written to the `competition` table on every start.
- `[[categories]]` and `[[timeplan]]`: only written into empty tables, so changes
  made in the admin UI are kept.

The database migrations only create the schema and don't insert any data.

## Setting up a new season

1. Copy `config.example.toml` to `config.toml` and set the competition, the
   categories and the timeplan.
2. Start with a fresh database (archive the old `db.sqlite`).
3. Start the server. It migrates the database and seeds it from the config.

The migrations of the 2024–2026 seasons were squashed into one baseline
migration; the originals are kept in `migrations-archive/` for reference. A
database created by those migrations can't be migrated with the baseline.

## Demo data

`cargo run --bin seed_demo` (or `make demo`) **deletes the configured database**
and recreates it with the demo data from [`demo-data.toml`](demo-data.toml):
users in every state, clubs with full, partial, missing and excess payments,
starters in single and pair starts (incl. partners across clubs and
unregistered partners), acts with names, songs and orders, and a timeplan
that is partly run. The file lists the logins at the top. The database and
data path are resolved like for the server; use `--demo` / `DEMO_DATA` for
another file. Tests can load it with `demo::DemoData`.
