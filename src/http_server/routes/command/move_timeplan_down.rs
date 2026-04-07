use axum::{Extension, Json, http::StatusCode};
use serde::{Deserialize, Serialize};
use tracing::instrument;
use utoipa::ToSchema;

use crate::{
    http_server::{ClientError, HttpError, extractor::auth::Auth},
    reloadable_sqlite::ReloadableSqlite,
};

#[derive(Debug, Serialize, ToSchema)]
pub struct MoveTimeplanDownResponse {}

#[derive(Debug, Deserialize, ToSchema)]
pub struct MoveTimeplanDownBody {
    id: i64,
}

/// Move a timeplan entry down by swapping IDs with the next entry.
///
/// This endpoint is used to reorder timeplan entries.
#[utoipa::path(
    post,
    tags=["command", "timeplan"],
    path="/move_timeplan_down",
    request_body=MoveTimeplanDownBody,
    responses(
        (status=200, content_type="application/json", body=MoveTimeplanDownResponse),
        (status=400, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn move_timeplan_down(
    Extension(db): Extension<ReloadableSqlite>,
    auth: Auth,
    Json(body): Json<MoveTimeplanDownBody>,
) -> Result<Json<MoveTimeplanDownResponse>, HttpError> {
    if !auth.is_admin() {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }
    let db = db.get().await.clone();

    // Start a transaction
    let mut tx = db.begin().await?;

    // Find the next entry (the one with the smallest id greater than current)
    let next_entry = sqlx::query!(
        r#"
        SELECT id FROM timeplan 
        WHERE id > $1 
        ORDER BY id ASC 
        LIMIT 1
        "#,
        body.id
    )
    .fetch_optional(&mut *tx)
    .await?;

    if let Some(next) = next_entry {
        let next_id = next.id;
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

        // Move next to current position
        sqlx::query!(
            "UPDATE timeplan SET id = $1 WHERE id = $2",
            current_id,
            next_id
        )
        .execute(&mut *tx)
        .await?;

        // Move temp to next position
        sqlx::query!(
            "UPDATE timeplan SET id = $1 WHERE id = $2",
            next_id,
            temp_id
        )
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
    } else {
        // No next entry, can't move down
        return Err(HttpError::StatusCode(StatusCode::BAD_REQUEST));
    }

    Ok(Json(MoveTimeplanDownResponse {}))
}
