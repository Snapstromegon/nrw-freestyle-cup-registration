# Plan: Choosing SQLite or PostgreSQL at runtime

Status: proposal · 2026-10-05

## Goal

One release binary that can run on **SQLite** (the current setup) or **PostgreSQL**. A runtime setting picks the database, and we don't lose sqlx's compile-time query checking on either one.

## Where we are today

| Area | Current state | Why it matters for Postgres |
|---|---|---|
| Query layer | About 135 `sqlx::query!` / `query_as!` macros in ~50 route files plus `src/utils.rs`, `src/bin/registration_server.rs` and `src/http_server/extractor/auth.rs` | The `query!` macros are tied to one database driver at compile time, chosen by `DATABASE_URL`. One macro call can't serve both databases. |
| Pool handle | `ReloadableSqlite` (`Arc<RwLock<SqlitePool>>`) is passed to every handler through `Extension` | Every handler names `SqlitePool` directly, so there is no abstraction to plug a second database into. |
| Schema | 15 migrations in `migrations/` that only work on SQLite | They store UUIDs as `BLOB`, use `INTEGER PRIMARY KEY AUTOINCREMENT`, put string values in double quotes (`"NEM"`, `"Mittagspause"`), and call `datetime()` and `julianday()`. The `age_on_competition` column is a `VIRTUAL` generated column with the competition date hardcoded. |
| `view_act` | The core view behind the act, startlist and timeplan queries | It uses `json_group_array`/`json_object`, `hex(id)`, and `MAX()`/`MIN()` over booleans. None of these work in Postgres. |
| SQL in Rust | 15 places use `concat_ws(" ", …)` (double quotes, so Postgres reads it as an identifier), `datetime('now')`, or `` `order` `` (backticks). Placeholders are a mix of `?` and `$N`. | These need small, mechanical rewrites. |
| Reload feature | `POST /reload_db` closes the pool and reopens it, so the app picks up a `db.sqlite` that was swapped with rsync (`make sync-up`) | This only makes sense for SQLite. Postgres needs different handling. |
| Config | `--db` / `env = "DATABASE"` is a `PathBuf` with a `sqlite://` default. `.env` and CI set `DATABASE_URL` instead. | **This is an existing bug.** The `DATABASE_URL` variable never reaches the binary, which always falls back to the default. It should be fixed whatever we decide here. |
| Tests | `#[sqlx::test]` with `SqlitePool` in `tests/` and `src/utils.rs`. `testcontainers` is already a dev-dependency (for Mailpit). | We can reuse `testcontainers` to start Postgres in tests. |

## Options considered

| Option | Verdict |
|---|---|
| **A. `sqlx::Any` driver** | ❌ Loses all compile-time checks. `Any` also doesn't support `Uuid`, `OffsetDateTime` or `Json<T>`, which we use everywhere. |
| **B. Make code generic over `sqlx::Database`** | ❌ The `query!` macros can't be generic, so we'd have to give up the macros anyway. Generic handlers also don't work well with `utoipa` `routes!`. |
| **C. Switch to Diesel (`MultiConnection`) or SeaORM** | ⚠️ Both select the database at runtime and type-check queries. But it means rewriting all ~135 queries in a new style plus the view, and it's a much larger change than the problem needs. |
| **D. Repository trait with one sqlx implementation per database, each in its own crate** | ✅ **Recommended.** Each crate keeps checked `query!` macros against its own database, the handlers lose their SQL, and the choice happens once at startup. |

## Recommended architecture (option D)

```
Cargo workspace
├── crates/db-core        # Repository trait, row/domain types, shared errors (no driver)
├── crates/db-sqlite      # impl Repository for SqliteRepo   + sqlx.toml + migrations/
├── crates/db-postgres    # impl Repository for PgRepo        + sqlx.toml + migrations/
└── (root crate)          # axum app; depends on db-core and, through features, on both impls
```

### 1. Repository trait (`db-core`)

- Handlers call domain methods instead of writing SQL: `db.list_acts()`, `db.move_category_up(name)`, `db.delete_club_starter(club, id)`, and so on.
- **Transactions stay inside the implementation.** For example, `move_category_*` and `delete_club_starter` become one trait method each, so the trait never exposes `Transaction<'_, DB>`.
- Use `#[async_trait]`, or return boxed futures by hand, so `Arc<dyn Repository>` works as an axum `Extension`. Native `async fn` in traits can't be used through `dyn`.
- Keep `sqlx::Error` as the error type. It is the same type for every driver, so `HttpError::DBError` doesn't change.
- Move the `DB*` row structs that are currently defined inside handlers (for example `DBAct` in `list_acts.rs`) into `db-core`.

### 2. One crate per database, both using checked macros

- sqlx 0.9 supports a per-crate **`sqlx.toml`** (enable the `sqlx-toml` feature) with `[common] database-url-var`. We've confirmed it in `sqlx-core-0.9.0/src/config/reference.toml`. Each crate gets its own variable:
  - `crates/db-sqlite/sqlx.toml` → `database-url-var = "SQLITE_DATABASE_URL"`
  - `crates/db-postgres/sqlx.toml` → `database-url-var = "PG_DATABASE_URL"`
- Each crate embeds its own migrations with `sqlx::migrate!("./migrations")`.
- **Avoid writing every query twice.** Once the SQL is cleaned up (phase 0), most queries are identical on both databases. Two ways to share them:
  1. Put the shared implementation in a single `shared/repo_impl.rs` and `include!` it into both crates, using a crate-local `type Db = Sqlite | Postgres;` alias. Because `include!` expands in each crate, every `query!` is checked against that crate's database. Queries that differ go in per-crate `overrides.rs` modules.
  2. Or use `query_file_as!` with a shared `queries/*.sql` folder, and a per-crate folder for queries that differ.

  Start with (1). It keeps the Rust code and the SQL in one place.
- Type-override annotations (`as "id!: Uuid"`, `as "x: bool"`) work on both databases, so keep them.

### 3. Selecting the database at runtime

- Change `--database-url` (`env = "DATABASE_URL"`) to a `String` instead of a `PathBuf`. This also fixes the bug above.
- Add `--database-backend` (`env = "DATABASE_BACKEND"`) with values `auto | sqlite | postgres`, default `auto`. `auto` looks at the URL scheme (`sqlite:` or `postgres:`/`postgresql:`). The explicit values mostly let the app fail fast when the URL and the backend don't match.
- At startup:

  ```rust
  let db: Arc<dyn Repository> = match backend {
      Backend::Sqlite   => Arc::new(db_sqlite::SqliteRepo::connect_and_migrate(&url).await?),
      Backend::Postgres => Arc::new(db_postgres::PgRepo::connect_and_migrate(&url).await?),
  };
  ```

  The admin seeding and `initialize_acts` code in `registration_server.rs` move behind the trait as well.
- Add cargo features `sqlite` and `postgres`, both on by default, so a build can leave either driver out. The release binary includes both.
- For Postgres over TLS, add the `tls-rustls-ring-webpki` sqlx feature. It's pure Rust, so the `x86_64-unknown-linux-musl` build keeps working.

### 4. Reload feature

- Rename `ReloadableSqlite` to `ReloadableDb`, which wraps `RwLock<Arc<dyn Repository>>`, and add `async fn reload(&self)` to the trait.
- SQLite keeps the current behavior: close the pool and reconnect to the same path.
- Postgres: make `reload` a no-op that returns `200`, so admin tooling keeps working. Document that `pg_restore`/`psql` replaces the rsync-and-reload workflow. `make download` and `make sync-up` get `pg_dump`/`pg_restore` equivalents or stay SQLite-only.

## Making the schema and SQL work on Postgres

### Postgres baseline migration

Don't port the 15 historical migrations. Give Postgres **one squashed baseline** (`crates/db-postgres/migrations/<ts>_baseline.up.sql`) that matches the current SQLite schema and the seed data as of `20260316192643`. After that, every schema change is written once per database.

The SQLite migrations must **not be edited**, because sqlx checks the checksums of migrations that have already run. Moving the files into `crates/db-sqlite/migrations/` is fine. Keeping the same version numbers and file contents is enough.

| SQLite | Postgres |
|---|---|
| `BLOB` (UUID) | `UUID` |
| `BOOLEAN` | `BOOLEAN` |
| `DATETIME` / `TIMESTAMP` | `TIMESTAMPTZ` (columns that are `OffsetDateTime` in Rust) |
| `REAL` (`clubs.payment`, ages) | `DOUBLE PRECISION` (keeps `f64` in Rust) |
| `INTEGER` | `BIGINT` (keeps `i64` in Rust; Postgres `INTEGER` would be `i32`) |
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `BIGINT GENERATED ALWAYS AS IDENTITY` |
| `"string literal"` | `'string literal'` |
| `datetime('2025-03-16')` | `TIMESTAMPTZ '2025-03-16'` |

### `age_on_competition` (fix this first)

The competition date is hardcoded in a generated column, and both previous competitions needed a migration just to change it. Postgres can't express this column directly: it only has `STORED` generated columns before PG 18, and those require immutable expressions.

**Recommendation:** remove the generated column on both databases. Instead, compute the age in `view_act` from a one-row `settings` (or `competition`) table that holds `competition_date`, or pass the date into the queries from `StatusOptions` as a new `COMPETITION_DATE` setting. Then a new season no longer needs a schema migration.

### `view_act`

Write it once per database:

| SQLite | Postgres |
|---|---|
| `json_group_array(json_object(...))` | `COALESCE(json_agg(json_build_object(...)), '[]'::json)` |
| `hex(starter.id)` | `starter.id::text`. `ActParticipant.id` is a `Uuid`, and serde accepts both the plain-hex and the hyphenated form. **Check this with a test.** |
| `MAX(bool)` / `MIN(bool)` | `bool_or(...)` / `bool_and(...)` |
| `a.*` | List the columns explicitly so the view's column types stay predictable for the macros. |

Note: SQLite's `json_group_array` returns `[]` for an empty set, while Postgres's `json_agg` returns `NULL`. That's why the Postgres version needs `COALESCE`, so `participants!` keeps its non-null contract.

### SQL in Rust that works on both (phase 0, SQLite-only change)

- `concat_ws(" ", a, b)` → `concat_ws(' ', a, b)`.
- `datetime('now')` → `CURRENT_TIMESTAMP`. On SQLite this gives the same text format.
- `` `order` `` → `"order"`.
- Placeholders: use `$1, $2, …` everywhere. sqlx-sqlite already accepts them, as some of our queries show.
- `COUNT(*) as count` → `COUNT(*) as "count!"`. Postgres reports `COUNT` as nullable to the macros.
- Check for `INSERT OR …`, `LIKE` case sensitivity, and `ORDER BY` with `NULL`s. SQLite sorts `NULL` first and Postgres sorts it last, and `acts."order"` is nullable. Add explicit `NULLS FIRST`/`NULLS LAST` wherever order matters (startlist, timeplan).

## Build, CI and tests

- **Compile-time checks need both databases at build time.** Commit the offline query data (`cargo sqlx prepare --workspace` writes a `.sqlx/` folder in each crate) and build with `SQLX_OFFLINE=true` in CI and for releases. That way `make centos-release` doesn't need a running Postgres.
- Add `make prepare-db`. It runs SQLite migrations into a local file, starts a throwaway Postgres container (`podman`/`docker run postgres:17`), runs the Postgres migrations, then runs `cargo sqlx prepare`. Add a CI check that fails when `.sqlx` is out of date (`cargo sqlx prepare --check`).
- **Run the tests against both databases.**
  - Repository-level tests in `db-core`: write each test once against `Arc<dyn Repository>` and generate a `_sqlite` and a `_postgres` variant with a small macro. Postgres runs in a `testcontainers` Postgres container: one container per test binary, with a fresh database per test. `#[sqlx::test]` can do this too when it's pointed at a Postgres URL.
  - HTTP integration tests (`tests/common/mod.rs`): change `TestApp` to hold `Arc<dyn Repository>` instead of `SqlitePool`. Run the full suite on SQLite by default, and on Postgres when `TEST_POSTGRES=1`, which CI sets.
- CI (`pr-test.yml`): add a matrix over `backend: [sqlite, postgres]`, using a `services: postgres` container for the Postgres leg.

## Moving existing data from SQLite to Postgres

Add a small `bin/db_copy.rs` (`db_copy --from sqlite://db.sqlite --to postgres://…`). It reads each table through `SqliteRepo` row types and writes it to `PgRepo` in one transaction, in foreign-key order: users → clubs → starter → judge → acts → act_participants → categories → timeplan → mail_verification / password_resets. Then it resets the identity sequence on `timeplan`. pgloader is another option, but it maps `BLOB` to `bytea` rather than `uuid`, so it would need custom cast rules. With only 10 tables, a typed Rust tool is safer.

## Phased rollout

Each phase can be merged on its own and leaves SQLite production working.

| # | Phase | Contents | Size |
|---|---|---|---|
| 0 | Prep (SQLite only) | Fix the `DATABASE_URL` config bug; make the Rust SQL work on both databases; add explicit `NULLS` ordering | S |
| 1 | Repository layer (SQLite only) | Add the `Repository` trait. Move all queries out of the handlers into `SqliteRepo`, one route group at a time (auth/users → clubs/starters → judges → acts → categories → timeplan). Swap `ReloadableSqlite` for `ReloadableDb`. Tests stay green. | **L** (most of the work) |
| 2 | Workspace split | Split into `db-core` / `db-sqlite` crates, add `sqlx.toml`, move migrations, set up offline `.sqlx` and `make prepare-db` | S |
| 3 | Competition date | Replace the `age_on_competition` generated column with a settings value (SQLite migration plus view update) | S |
| 4 | Postgres implementation | `db-postgres` crate: baseline migration, `view_act`, the shared `include!` implementation plus overrides | M |
| 5 | Runtime selection | `--database-backend`, cargo features, TLS, reload behavior | S |
| 6 | Tests and CI on both databases | Run tests on both, CI matrix, `testcontainers` Postgres | M |
| 7 | Data migration and operations | `db_copy`, README/ops notes, Makefile targets for Postgres dump/restore | S |

## Risks and open questions

- **Is Postgres actually needed in production?** First check that the current host (uberspace) can run Postgres. Even if it can, the event workload is small, and running two databases means every schema change and every query that differs is maintained twice from now on. If the real need is something specific, such as concurrent access, backups or hosting elsewhere, say what it is before phase 4. Phases 0–3 are worth doing anyway because they clean up the code.
- **Floating-point ages and date boundaries:** ages are compared against category birthdate ranges, and timestamp comparisons have to behave the same on both databases. Text-encoded SQLite datetimes compare as strings, while Postgres compares `timestamptz` values. Add a test that puts boundary birthdates into categories on both databases.
- **Case sensitivity:** `users.email` uniqueness and login lookups are case-sensitive on both databases today. Keep it that way for now; consider `citext` or `lower()` separately.
- **Drift:** schema changes written twice can drift apart. The shared repository tests running on both databases in CI are the main safeguard. Optionally, add a test that compares column names and types between the two schemas.
