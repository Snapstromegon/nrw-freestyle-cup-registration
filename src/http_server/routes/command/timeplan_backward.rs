use axum::{Extension, Json, http::StatusCode};
use serde::Serialize;
use sqlx::SqlitePool;
use tracing::instrument;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::http_server::{ClientError, HttpError, extractor::auth::Auth};

#[derive(Debug, Serialize, ToSchema)]
pub struct SetTimeplanBackwardResponse {}

/// EditClubAct a new user.
///
/// This endpoint is used to create a new user.
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
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn timeplan_backward(
    Extension(db): Extension<SqlitePool>,
    auth: Auth,
) -> Result<Json<SetTimeplanBackwardResponse>, HttpError> {
    if !auth.is_admin() {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }

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
                    "UPDATE acts SET started_at = NULL WHERE id = ?",
                    running_act_id
                )
                .execute(&db)
                .await?;
            } else {
                let finished_acts = sqlx::query!(
                    "SELECT id as 'id!: Uuid' FROM view_act WHERE category = ? AND ended_at IS NOT NULL ORDER BY `order` DESC",
                    category
                ).fetch_all(&db).await?;
                if finished_acts.is_empty() {
                    sqlx::query!("UPDATE timeplan SET started_at = NULL WHERE id = ?", id)
                        .execute(&db)
                        .await?;
                } else {
                    let last_act_id = finished_acts[0].id;
                    sqlx::query!("UPDATE acts SET ended_at = NULL WHERE id = ?", last_act_id)
                        .execute(&db)
                        .await?;
                }
            }
        }
        Some((id, None)) => {
            sqlx::query!("UPDATE timeplan SET started_at = NULL WHERE id = ?", id)
                .execute(&db)
                .await?;
        }
        None => {
            let category = sqlx::query!(
                "UPDATE timeplan SET ended_at = NULL WHERE id = (SELECT id FROM timeplan WHERE ended_at IS NOT NULL ORDER BY id DESC LIMIT 1) RETURNING category"
            ).fetch_optional(&db).await?.map(|row| row.category);

            if let Some(category) = category {
                sqlx::query!(
                    "UPDATE acts SET ended_at = NULL WHERE id = (SELECT id FROM view_act WHERE category = ? ORDER BY `order` DESC LIMIT 1)",
                    category
                )
                .execute(&db)
                .await?;
            }
        }
    }

    Ok(Json(SetTimeplanBackwardResponse {}))
}
