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

    pub async fn get(&self) -> RwLockReadGuard<SqlitePool> {
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
