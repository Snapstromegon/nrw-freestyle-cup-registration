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
}
