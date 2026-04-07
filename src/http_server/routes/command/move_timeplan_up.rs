use axum::{Extension, Json, http::StatusCode};
use serde::{Deserialize, Serialize};
use tracing::instrument;
use utoipa::ToSchema;

use crate::{
    http_server::{ClientError, HttpError, extractor::auth::Auth},
    reloadable_sqlite::ReloadableSqlite,
};

#[derive(Debug, Serialize, ToSchema)]
pub struct MoveTimeplanUpResponse {}

#[derive(Debug, Deserialize, ToSchema)]
pub struct MoveTimeplanUpBody {
    id: i64,
}

/// Move a timeplan entry up by swapping IDs with the previous entry.
///
/// This endpoint is used to reorder timeplan entries.
#[utoipa::path(
    post,
    tags=["command", "timeplan"],
    path="/move_timeplan_up",
    request_body=MoveTimeplanUpBody,
    responses(
        (status=200, content_type="application/json", body=MoveTimeplanUpResponse),
        (status=400, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn move_timeplan_up(
    Extension(db): Extension<ReloadableSqlite>,
    auth: Auth,
    Json(body): Json<MoveTimeplanUpBody>,
) -> Result<Json<MoveTimeplanUpResponse>, HttpError> {
    if !auth.is_admin() {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }
    let db = db.get().await.clone();

    // Start a transaction
    let mut tx = db.begin().await?;

    // Find the previous entry (the one with the largest id less than current)
    let prev_entry = sqlx::query!(
        r#"
        SELECT id FROM timeplan 
        WHERE id < $1 
        ORDER BY id DESC 
        LIMIT 1
        "#,
        body.id
    )
    .fetch_optional(&mut *tx)
    .await?;

    if let Some(prev) = prev_entry {
        let prev_id = prev.id;
        let current_id = body.id;
        
        // Use a temporary negative ID to avoid constraint violations
        let temp_id = -999999;

        // Move current to temp
        sqlx::query!(
            "UPDATE timeplan SET id = $1 WHERE id = $2",
            temp_id,
            current_id
        )
        .execute(&mut *tx)
        .await?;

        // Move previous to current position
        sqlx::query!(
            "UPDATE timeplan SET id = $1 WHERE id = $2",
            current_id,
            prev_id
        )
        .execute(&mut *tx)
        .await?;

        // Move temp to previous position
        sqlx::query!(
            "UPDATE timeplan SET id = $1 WHERE id = $2",
            prev_id,
            temp_id
        )
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
    } else {
        // No previous entry, can't move up
        return Err(HttpError::StatusCode(StatusCode::BAD_REQUEST));
    }

    Ok(Json(MoveTimeplanUpResponse {}))
}
