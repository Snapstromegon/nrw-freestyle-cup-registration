use axum::{Extension, Json, http::StatusCode};
use serde::{Deserialize, Serialize};
use tracing::instrument;
use utoipa::ToSchema;

use crate::{
    http_server::{ClientError, HttpError, extractor::auth::Auth},
    reloadable_sqlite::ReloadableSqlite,
};

#[derive(Debug, Serialize, ToSchema)]
pub struct EditTimeplanEntryResponse {}

#[derive(Debug, Deserialize, ToSchema)]
pub struct EditTimeplanEntryBody {
    id: i64, // Primary key - timeplan entry to edit
    earliest_start_time: Option<String>, // ISO datetime string
    duration_seconds: Option<i32>,
    label: Option<String>,
    category: Option<String>,
}

/// Edit an existing timeplan entry.
///
/// This endpoint is used to update a timeplan entry's properties.
#[utoipa::path(
    post,
    tags=["command", "timeplan"],
    path="/edit_timeplan_entry",
    request_body=EditTimeplanEntryBody,
    responses(
        (status=200, content_type="application/json", body=EditTimeplanEntryResponse),
        (status=400, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn edit_timeplan_entry(
    Extension(db): Extension<ReloadableSqlite>,
    auth: Auth,
    Json(body): Json<EditTimeplanEntryBody>,
) -> Result<Json<EditTimeplanEntryResponse>, HttpError> {
    if !auth.is_admin() {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }
    let db = db.get().await.clone();

    sqlx::query!(
        r#"
        UPDATE timeplan 
        SET 
            earliest_start_time = $1,
            duration_seconds = $2,
            label = $3,
            category = $4
        WHERE id = $5
        "#,
        body.earliest_start_time,
        body.duration_seconds,
        body.label,
        body.category,
        body.id,
    )
    .execute(&db)
    .await?;

    Ok(Json(EditTimeplanEntryResponse {}))
}
