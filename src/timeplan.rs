//! Rules of the live timeplan, shared by the prediction and the forward and
//! backward commands.
//!
//! A category block is *empty* when no act has that category at the moment of
//! reading (`view_act`). Empty blocks are skipped: they take no time, and
//! "Weiter" never stops on them. A skipped block is marked as started and
//! ended at the same time, so "ended and empty" means "skipped".

use std::collections::{HashMap, HashSet};

use sqlx::SqliteConnection;
use time::OffsetDateTime;

/// A timeplan entry, as far as the warm-up rules care.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Block {
    Category {
        einfahrzeit_seconds: i64,
        empty: bool,
    },
    Custom,
}

/// The warm-up each entry really gets.
///
/// - An empty block gets none.
/// - A block with Einfahrzeit 0 shares the warm-up of the category before
///   it. If that category is empty, its warm-up moves on to the next
///   non-empty category sharing it, so its riders still warm up.
/// - Nobody warms up across a custom entry (a break or an award ceremony).
pub fn effective_warmups(blocks: &[Block]) -> Vec<i64> {
    // The warm-up of an empty block, waiting for the next block sharing it.
    let mut pending = 0;
    blocks
        .iter()
        .map(|block| match *block {
            Block::Custom => {
                pending = 0;
                0
            }
            Block::Category {
                einfahrzeit_seconds,
                empty: true,
            } => {
                if einfahrzeit_seconds > 0 {
                    pending = einfahrzeit_seconds;
                }
                0
            }
            Block::Category {
                einfahrzeit_seconds,
                empty: false,
            } => {
                let warmup = if einfahrzeit_seconds > 0 {
                    einfahrzeit_seconds
                } else {
                    pending
                };
                pending = 0;
                warmup
            }
        })
        .collect()
}

/// A timeplan entry with its live state, as the forward and backward
/// commands need it.
#[derive(Debug)]
pub struct LiveEntry {
    pub id: i64,
    pub category: Option<String>,
    pub started_at: Option<OffsetDateTime>,
    pub ended_at: Option<OffsetDateTime>,
    pub empty: bool,
    /// See [`effective_warmups`].
    pub warmup_seconds: i64,
}

impl LiveEntry {
    /// An empty category block that "Weiter" skipped.
    pub fn is_skipped(&self) -> bool {
        self.empty && self.started_at.is_some() && self.ended_at.is_some()
    }
}

/// The categories that have at least one act.
pub async fn non_empty_categories(db: &mut SqliteConnection) -> sqlx::Result<HashSet<String>> {
    Ok(sqlx::query_scalar!(
        r#"SELECT DISTINCT category as "category!" FROM view_act WHERE category IS NOT NULL"#
    )
    .fetch_all(db)
    .await?
    .into_iter()
    .collect())
}

/// Loads the timeplan in order, with emptiness and effective warm-ups.
pub async fn live_entries(db: &mut SqliteConnection) -> sqlx::Result<Vec<LiveEntry>> {
    let non_empty = non_empty_categories(&mut *db).await?;
    let einfahrzeiten: HashMap<String, i64> =
        sqlx::query!(r#"SELECT name as "name!", einfahrzeit_seconds FROM categories"#)
            .fetch_all(&mut *db)
            .await?
            .into_iter()
            .map(|row| (row.name, row.einfahrzeit_seconds))
            .collect();
    let rows = sqlx::query!(
        r#"
        SELECT
            id as "id!",
            category,
            started_at as "started_at: OffsetDateTime",
            ended_at as "ended_at: OffsetDateTime"
        FROM timeplan
        ORDER BY id
        "#
    )
    .fetch_all(&mut *db)
    .await?;

    let blocks: Vec<Block> = rows
        .iter()
        .map(|row| match &row.category {
            Some(name) => Block::Category {
                einfahrzeit_seconds: einfahrzeiten.get(name).copied().unwrap_or(0),
                empty: !non_empty.contains(name),
            },
            None => Block::Custom,
        })
        .collect();
    let warmups = effective_warmups(&blocks);
    Ok(rows
        .into_iter()
        .zip(blocks)
        .zip(warmups)
        .map(|((row, block), warmup_seconds)| LiveEntry {
            id: row.id,
            category: row.category,
            started_at: row.started_at,
            ended_at: row.ended_at,
            empty: matches!(block, Block::Category { empty: true, .. }),
            warmup_seconds,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn cat(einfahrzeit_seconds: i64, empty: bool) -> Block {
        Block::Category {
            einfahrzeit_seconds,
            empty,
        }
    }

    #[test]
    fn blocks_keep_their_own_warmup() {
        assert_eq!(
            effective_warmups(&[cat(600, false), cat(300, false)]),
            [600, 300]
        );
    }

    #[test]
    fn empty_blocks_get_no_warmup() {
        assert_eq!(
            effective_warmups(&[cat(600, true), cat(300, false)]),
            [0, 300]
        );
    }

    #[test]
    fn shared_warmup_stays_with_the_first_category() {
        assert_eq!(
            effective_warmups(&[cat(600, false), cat(0, false), cat(0, false)]),
            [600, 0, 0]
        );
    }

    #[test]
    fn shared_warmup_of_an_empty_category_moves_on() {
        assert_eq!(
            effective_warmups(&[cat(600, true), cat(0, true), cat(0, false), cat(0, false)]),
            [0, 0, 600, 0]
        );
    }

    #[test]
    fn nobody_warms_up_across_a_break() {
        assert_eq!(
            effective_warmups(&[cat(600, true), Block::Custom, cat(0, false)]),
            [0, 0, 0]
        );
    }

    #[test]
    fn a_new_warmup_replaces_a_pending_one() {
        assert_eq!(
            effective_warmups(&[cat(600, true), cat(300, true), cat(0, false)]),
            [0, 0, 300]
        );
    }
}
