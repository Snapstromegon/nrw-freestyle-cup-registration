use axum::{Extension, Json, http::StatusCode};
use serde::{Deserialize, Serialize};
use tracing::instrument;
use utoipa::ToSchema;

use crate::{
    http_server::{ClientError, HttpError, extractor::auth::Auth},
    reloadable_sqlite::ReloadableSqlite,
};

#[derive(Debug, Serialize, ToSchema)]
pub struct DeleteTimeplanEntryResponse {}

#[derive(Debug, Deserialize, ToSchema)]
pub struct DeleteTimeplanEntryBody {
    id: i64, // Primary key of the timeplan entry to delete
}

/// Delete a timeplan entry.
///
/// This endpoint is used to delete an existing timeplan entry.
#[utoipa::path(
    post,
    tags=["command", "timeplan"],
    path="/delete_timeplan_entry",
    request_body=DeleteTimeplanEntryBody,
    responses(
        (status=200, content_type="application/json", body=DeleteTimeplanEntryResponse),
        (status=400, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn delete_timeplan_entry(
    Extension(db): Extension<ReloadableSqlite>,
    auth: Auth,
    Json(body): Json<DeleteTimeplanEntryBody>,
) -> Result<Json<DeleteTimeplanEntryResponse>, HttpError> {
    if !auth.is_admin() {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }
    let db = db.get().await.clone();

    let result = sqlx::query!(
        r#"
        DELETE FROM timeplan
        WHERE id = $1
        "#,
        body.id,
    )
    .execute(&db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(HttpError::StatusCode(StatusCode::NOT_FOUND));
    }

    Ok(Json(DeleteTimeplanEntryResponse {}))
}
