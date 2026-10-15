use std::sync::Arc;

use axum::{Extension, Json, http::StatusCode};
use serde::Serialize;
use tracing::{info, instrument, warn};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    http_server::{ClientError, HttpError, extractor::auth::Auth},
    player::PlayerHub,
    reloadable_sqlite::{ReloadableSqlite, begin_write},
    timeplan::{LiveEntry, live_entries},
};

#[derive(Debug, Serialize, ToSchema)]
pub struct SetTimeplanForwardResponse {}

/// Moves the live timeplan one step forward.
///
/// Ends the running act, starts the next act, or ends the running entry and
/// starts the next one. Empty category blocks are skipped on the way. Ending
/// an act stops the music on the active player.
#[utoipa::path(
    post,
    tags=["command", "timeplan"],
    path="/timeplan_forward",
    responses(
        (status=200, content_type="application/json", body=SetTimeplanForwardResponse),
        (status=400, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db, player_hub))]
#[axum::debug_handler]
pub async fn timeplan_forward(
    Extension(db): Extension<ReloadableSqlite>,
    Extension(player_hub): Extension<Arc<PlayerHub>>,
    auth: Auth,
) -> Result<Json<SetTimeplanForwardResponse>, HttpError> {
    if !auth.is_admin() {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }

    info!("Forwarding timeplan");
    let db = db.get().await.clone();
    // One write transaction, so two operators pressing at the same moment
    // can't both act on the same state and skip a step.
    let mut tx = begin_write(&db).await?;
    let mut ended_act = false;

    let running_timeplan_entry = sqlx::query!(
        "SELECT id, category FROM timeplan WHERE started_at IS NOT NULL AND ended_at IS NULL ORDER BY id LIMIT 1"
    ).fetch_optional(&mut *tx).await?.map(|row| (row.id, row.category));

    match running_timeplan_entry {
        Some((id, Some(category))) => {
            let running_act = sqlx::query!(
                "SELECT id as 'id!: Uuid' FROM view_act WHERE category = ? AND started_at IS NOT NULL AND ended_at IS NULL ORDER BY `order` LIMIT 1",
                category
            ).fetch_optional(&mut *tx).await?.map(|row| row.id);
            if let Some(running_act_id) = running_act {
                sqlx::query!(
                    "UPDATE acts SET ended_at = datetime('now') WHERE id = ?",
                    running_act_id
                )
                .execute(&mut *tx)
                .await?;
                ended_act = true;

                // Ende category if all acts are done
                let open_cat_acts = sqlx::query!(
                    "SELECT id FROM view_act WHERE category = ? AND started_at IS NULL",
                    category
                )
                .fetch_all(&mut *tx)
                .await?;
                if open_cat_acts.is_empty() {
                    sqlx::query!(
                        "UPDATE timeplan SET ended_at = datetime('now') WHERE id = ?",
                        id
                    )
                    .execute(&mut *tx)
                    .await?;
                }
            } else {
                info!("Starting next act");
                let upcoming_starts = sqlx::query!(
                    "SELECT id as 'id!: Uuid' FROM view_act WHERE category = ? AND started_at IS NULL ORDER BY `order`",
                    category
                ).fetch_all(&mut *tx).await?;
                info!("Upcoming starts: {upcoming_starts:?}");
                if let Some(next_act) = upcoming_starts.first() {
                    sqlx::query!(
                        "UPDATE acts SET started_at = datetime('now') WHERE id = ?",
                        next_act.id
                    )
                    .execute(&mut *tx)
                    .await?;
                } else {
                    // Nothing (left) to start, e.g. a category without acts:
                    // end it so the timeplan can move on.
                    sqlx::query!(
                        "UPDATE timeplan SET ended_at = datetime('now') WHERE id = ?",
                        id
                    )
                    .execute(&mut *tx)
                    .await?;
                }
            }
        }
        Some((id, None)) => {
            sqlx::query!(
                "UPDATE timeplan SET ended_at = datetime('now') WHERE id = ?",
                id
            )
            .execute(&mut *tx)
            .await?;
        }
        None => {
            info!("Starting Next timeplan entry");
            start_next_timeplan_entry(&mut tx).await?;
        }
    }

    tx.commit().await?;
    // A remote player gets the song of the act now due; it doesn't start.
    // Judging starts in silence.
    let cued = if ended_act {
        player_hub.stop_and_cue_from_timeplan().await
    } else {
        player_hub.cue_from_timeplan().await
    };
    if let Err(e) = cued {
        warn!("Couldn't cue the next song: {e}");
    }

    Ok(Json(SetTimeplanForwardResponse {}))
}

/// Starts the next entry that isn't empty, and skips the empty category
/// blocks before it. Its first act starts right away if it has no warm-up.
/// If only empty blocks are left, nothing changes.
async fn start_next_timeplan_entry(db: &mut sqlx::SqliteConnection) -> Result<(), sqlx::Error> {
    let entries = live_entries(&mut *db).await?;
    let upcoming: Vec<&LiveEntry> = entries.iter().filter(|e| e.started_at.is_none()).collect();
    let Some(next) = upcoming.iter().position(|e| !e.empty) else {
        return Ok(());
    };

    for skipped in &upcoming[..next] {
        sqlx::query!(
            "UPDATE timeplan SET started_at = datetime('now'), ended_at = datetime('now') WHERE id = ?",
            skipped.id
        )
        .execute(&mut *db)
        .await?;
    }

    let next = upcoming[next];
    sqlx::query!(
        "UPDATE timeplan SET started_at = datetime('now') WHERE id = ?",
        next.id
    )
    .execute(&mut *db)
    .await?;

    if let Some(category) = &next.category
        && next.warmup_seconds == 0
    {
        sqlx::query!(
            "UPDATE acts SET started_at = datetime('now') WHERE id = (SELECT id FROM view_act WHERE category = ? AND started_at IS NULL ORDER BY `order` LIMIT 1)",
            category
        ).execute(&mut *db).await?;
    }

    Ok(())
}
