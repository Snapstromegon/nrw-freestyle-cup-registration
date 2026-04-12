use axum::{Extension, Json, http::StatusCode};
use serde::Serialize;
use tracing::{info, instrument};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    http_server::{ClientError, HttpError, extractor::auth::Auth},
    reloadable_sqlite::ReloadableSqlite,
};

#[derive(Debug, Serialize, ToSchema)]
pub struct SetTimeplanForwardResponse {}

/// EditClubAct a new user.
///
/// This endpoint is used to create a new user.
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
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn timeplan_forward(
    Extension(db): Extension<ReloadableSqlite>,
    auth: Auth,
) -> Result<Json<SetTimeplanForwardResponse>, HttpError> {
    if !auth.is_admin() {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }

    info!("Forwarding timeplan");
    let db = db.get().await.clone();

    let running_timeplan_entry = sqlx::query!(
        "SELECT id, category FROM timeplan WHERE started_at IS NOT NULL AND ended_at IS NULL ORDER BY id LIMIT 1"
    ).fetch_optional(&db).await?.map(|row| (row.id, row.category));

    match running_timeplan_entry {
        Some((id, Some(category))) => {
            let running_act = sqlx::query!(
                "SELECT id as 'id!: Uuid' FROM view_act WHERE category = ? AND started_at IS NOT NULL AND ended_at IS NULL ORDER BY `order` LIMIT 1",
                category
            ).fetch_optional(&db).await?.map(|row| row.id);
            if let Some(running_act_id) = running_act {
                sqlx::query!(
                    "UPDATE acts SET ended_at = datetime('now') WHERE id = ?",
                    running_act_id
                )
                .execute(&db)
                .await?;

                // Ende category if all acts are done
                let open_cat_acts = sqlx::query!(
                    "SELECT id FROM view_act WHERE category = ? AND started_at IS NULL",
                    category
                )
                .fetch_all(&db)
                .await?;
                if open_cat_acts.is_empty() {
                    sqlx::query!(
                        "UPDATE timeplan SET ended_at = datetime('now') WHERE id = ?",
                        id
                    )
                    .execute(&db)
                    .await?;
                }
            } else {
                info!("Starting next act");
                let upcoming_starts = sqlx::query!(
                    "SELECT id as 'id!: Uuid' FROM view_act WHERE category = ? AND started_at IS NULL ORDER BY `order`",
                    category
                ).fetch_all(&db).await?;
                info!("Upcoming starts: {upcoming_starts:?}");
                sqlx::query!(
                    "UPDATE acts SET started_at = datetime('now') WHERE id = (SELECT id FROM view_act WHERE category = ? AND started_at IS NULL ORDER BY `order` LIMIT 1)",
                    category
                ).execute(&db).await?;
            }
        }
        Some((id, None)) => {
            sqlx::query!(
                "UPDATE timeplan SET ended_at = datetime('now') WHERE id = ?",
                id
            )
            .execute(&db)
            .await?;
        }
        None => {
            info!("Starting Next timeplan entry");
            start_next_timeplan_entry(&db).await?;
        }
    }

    Ok(Json(SetTimeplanForwardResponse {}))
}

async fn start_next_timeplan_entry(db: &sqlx::SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "UPDATE timeplan SET started_at = datetime('now') WHERE id = (SELECT id FROM timeplan WHERE started_at IS NULL ORDER BY id LIMIT 1)"
    ).execute(db).await?;

    let category =
        sqlx::query!("SELECT id, category FROM timeplan WHERE started_at IS NOT NULL AND ended_at IS NULL ORDER BY id LIMIT 1")
            .fetch_optional(db)
            .await?
            .map(|row| row.category);

    if let Some(category) = category {
        let einfahrzeit_seconds = sqlx::query!(
            "SELECT einfahrzeit_seconds FROM categories WHERE name = ?",
            category
        )
        .fetch_one(db)
        .await?
        .einfahrzeit_seconds;

        if einfahrzeit_seconds == 0 {
            sqlx::query!(
                "UPDATE acts SET started_at = datetime('now') WHERE id = (SELECT id FROM view_act WHERE category = ? AND started_at IS NULL ORDER BY `order` LIMIT 1)",
                category
            ).execute(db).await?;
        }
    }

    Ok(())
}
