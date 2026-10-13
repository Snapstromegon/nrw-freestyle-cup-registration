use std::sync::Arc;

use axum::{Extension, Json, http::StatusCode};
use serde::Serialize;
use tracing::{instrument, warn};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    http_server::{ClientError, HttpError, extractor::auth::Auth},
    player::PlayerHub,
    reloadable_sqlite::{ReloadableSqlite, begin_write},
    timeplan::live_entries,
};

#[derive(Debug, Serialize, ToSchema)]
pub struct SetTimeplanBackwardResponse {}

/// Moves the live timeplan one step back, undoing the last forward step.
///
/// Undoing the start of an entry also undoes the skips of the empty category
/// blocks right before it, since they were skipped in the same step.
#[utoipa::path(
    post,
    tags=["command", "timeplan"],
    path="/timeplan_backward",
    responses(
        (status=200, content_type="application/json", body=SetTimeplanBackwardResponse),
        (status=400, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db, player_hub))]
#[axum::debug_handler]
pub async fn timeplan_backward(
    Extension(db): Extension<ReloadableSqlite>,
    Extension(player_hub): Extension<Arc<PlayerHub>>,
    auth: Auth,
) -> Result<Json<SetTimeplanBackwardResponse>, HttpError> {
    if !auth.is_admin() {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }
    let db = db.get().await.clone();
    // One write transaction, so two operators pressing at the same moment
    // can't both act on the same state and skip a step.
    let mut tx = begin_write(&db).await?;

    let entries = live_entries(&mut tx).await?;
    let running = entries
        .iter()
        .position(|e| e.started_at.is_some() && e.ended_at.is_none());

    match running {
        Some(index) => {
            let entry = &entries[index];
            let running_act = match &entry.category {
                Some(category) => sqlx::query!(
                    "SELECT id as 'id!: Uuid' FROM view_act WHERE category = ? AND started_at IS NOT NULL AND ended_at IS NULL ORDER BY `order` LIMIT 1",
                    category
                ).fetch_optional(&mut *tx).await?.map(|row| row.id),
                None => None,
            };
            let last_finished_act = match &entry.category {
                Some(category) => sqlx::query!(
                    "SELECT id as 'id!: Uuid' FROM view_act WHERE category = ? AND ended_at IS NOT NULL ORDER BY `order` DESC LIMIT 1",
                    category
                ).fetch_optional(&mut *tx).await?.map(|row| row.id),
                None => None,
            };
            if let Some(running_act_id) = running_act {
                sqlx::query!(
                    "UPDATE acts SET started_at = NULL, music_started_at = NULL WHERE id = ?",
                    running_act_id
                )
                .execute(&mut *tx)
                .await?;
            } else if let Some(last_act_id) = last_finished_act {
                sqlx::query!("UPDATE acts SET ended_at = NULL WHERE id = ?", last_act_id)
                    .execute(&mut *tx)
                    .await?;
            } else {
                // Nothing done in this entry yet: undo its start, together
                // with the empty blocks skipped to get here.
                sqlx::query!(
                    "UPDATE timeplan SET started_at = NULL WHERE id = ?",
                    entry.id
                )
                .execute(&mut *tx)
                .await?;
                let skipped = entries[..index].iter().rev().take_while(|e| e.is_skipped());
                for skipped in skipped {
                    reset_entry(&mut tx, skipped.id).await?;
                }
            }
        }
        None => {
            // Reopen the last entry that really ran, and undo the skips after it.
            let Some(index) = entries
                .iter()
                .rposition(|e| e.ended_at.is_some() && !e.is_skipped())
            else {
                tx.commit().await?;
                return Ok(Json(SetTimeplanBackwardResponse {}));
            };
            let entry = &entries[index];
            sqlx::query!("UPDATE timeplan SET ended_at = NULL WHERE id = ?", entry.id)
                .execute(&mut *tx)
                .await?;
            if let Some(category) = &entry.category {
                sqlx::query!(
                    "UPDATE acts SET ended_at = NULL WHERE id = (SELECT id FROM view_act WHERE category = ? ORDER BY `order` DESC LIMIT 1)",
                    category
                )
                .execute(&mut *tx)
                .await?;
            }
            for skipped in entries[index + 1..].iter().filter(|e| e.is_skipped()) {
                reset_entry(&mut tx, skipped.id).await?;
            }
        }
    }

    tx.commit().await?;
    // A remote player gets the song of the act now due; it doesn't start.
    if let Err(e) = player_hub.cue_from_timeplan().await {
        warn!("Couldn't cue the next song: {e}");
    }

    Ok(Json(SetTimeplanBackwardResponse {}))
}

/// Puts an entry back to planned.
async fn reset_entry(db: &mut sqlx::SqliteConnection, id: i64) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "UPDATE timeplan SET started_at = NULL, ended_at = NULL WHERE id = ?",
        id
    )
    .execute(db)
    .await?;
    Ok(())
}
