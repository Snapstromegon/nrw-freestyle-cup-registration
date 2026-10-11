use std::sync::Arc;

use tokio::sync::{RwLock, RwLockReadGuard};

use sqlx::SqlitePool;

#[derive(Debug, Clone)]
pub struct ReloadableSqlite {
    db: Arc<RwLock<SqlitePool>>,
    path: String,
}

impl ReloadableSqlite {
    pub fn new(db: SqlitePool, path: String) -> Self {
        Self {
            db: Arc::new(RwLock::new(db)),
            path,
        }
    }

    pub async fn get(&self) -> RwLockReadGuard<'_, SqlitePool> {
        self.db.read().await
    }

    pub async fn reload(&self) -> Result<(), sqlx::Error> {
        let mut old_db = self.db.write().await;
        old_db.close().await;
        let new_db = SqlitePool::connect(&self.path).await?;
        *old_db = new_db;
        Ok(())
    }
}

/// Begins a transaction that will write, with `BEGIN IMMEDIATE`.
///
/// A plain (deferred) `BEGIN` takes the write lock only at the first write.
/// If another connection writes meanwhile, SQLite fails the upgrade from read
/// to write at once with "database is locked", without waiting for the busy
/// timeout. Commands that read before they write use this instead, so they
/// wait for the lock up front.
pub async fn begin_write(
    pool: &SqlitePool,
) -> Result<sqlx::Transaction<'static, sqlx::Sqlite>, sqlx::Error> {
    pool.begin_with("BEGIN IMMEDIATE").await
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(std::path::PathBuf);

    impl TempDir {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("reloadable-sqlite-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn db_url(&self, name: &str) -> String {
            format!("sqlite://{}?mode=rwc", self.0.join(name).display())
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    async fn create_db_with_value(url: &str, value: &str) -> SqlitePool {
        let pool = SqlitePool::connect(url).await.unwrap();
        sqlx::query("CREATE TABLE marker (value TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO marker (value) VALUES (?)")
            .bind(value)
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    async fn read_marker(db: &ReloadableSqlite) -> String {
        sqlx::query_scalar("SELECT value FROM marker")
            .fetch_one(&*db.get().await)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn reload_keeps_database_usable() {
        let dir = TempDir::new();
        let url = dir.db_url("db.sqlite");
        let db = ReloadableSqlite::new(create_db_with_value(&url, "original").await, url);

        db.reload().await.unwrap();

        assert_eq!(read_marker(&db).await, "original");
    }

    #[tokio::test]
    async fn reload_picks_up_replaced_database_file() {
        let dir = TempDir::new();
        let url = dir.db_url("db.sqlite");
        let db = ReloadableSqlite::new(create_db_with_value(&url, "old").await, url);
        assert_eq!(read_marker(&db).await, "old");

        // Simulate an upload that atomically replaces the database file.
        create_db_with_value(&dir.db_url("new.sqlite"), "new")
            .await
            .close()
            .await;
        std::fs::rename(dir.0.join("new.sqlite"), dir.0.join("db.sqlite")).unwrap();

        db.reload().await.unwrap();

        assert_eq!(read_marker(&db).await, "new");
    }

    #[tokio::test]
    async fn clones_share_the_reloaded_pool() {
        let dir = TempDir::new();
        let url = dir.db_url("db.sqlite");
        let db = ReloadableSqlite::new(create_db_with_value(&url, "old").await, url);
        let clone = db.clone();

        create_db_with_value(&dir.db_url("new.sqlite"), "new")
            .await
            .close()
            .await;
        std::fs::rename(dir.0.join("new.sqlite"), dir.0.join("db.sqlite")).unwrap();
        db.reload().await.unwrap();

        assert_eq!(read_marker(&clone).await, "new");
    }

    #[tokio::test]
    async fn write_transactions_wait_for_each_other() {
        let dir = TempDir::new();
        let pool = SqlitePool::connect(&dir.db_url("db.sqlite")).await.unwrap();
        sqlx::query("CREATE TABLE counter (value INTEGER NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO counter (value) VALUES (0)")
            .execute(&pool)
            .await
            .unwrap();

        // Read, then write, like the commands do. With a deferred BEGIN some
        // of them fail at once with "database is locked".
        let tasks: Vec<_> = (0..8)
            .map(|_| {
                let pool = pool.clone();
                tokio::spawn(async move {
                    let mut tx = begin_write(&pool).await?;
                    let value: i64 = sqlx::query_scalar("SELECT value FROM counter")
                        .fetch_one(&mut *tx)
                        .await?;
                    tokio::time::sleep(std::time::Duration::from_millis(5)).await;
                    sqlx::query("UPDATE counter SET value = ?")
                        .bind(value + 1)
                        .execute(&mut *tx)
                        .await?;
                    tx.commit().await
                })
            })
            .collect();
        for task in tasks {
            task.await.unwrap().unwrap();
        }

        let value: i64 = sqlx::query_scalar("SELECT value FROM counter")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(value, 8);
    }
}
