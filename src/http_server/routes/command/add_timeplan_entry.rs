use axum::{Extension, Json, http::StatusCode};
use serde::{Deserialize, Serialize};
use tracing::instrument;
use utoipa::ToSchema;

use crate::{
    http_server::{ClientError, HttpError, extractor::auth::Auth},
    reloadable_sqlite::ReloadableSqlite,
};

#[derive(Debug, Serialize, ToSchema)]
pub struct AddTimeplanEntryResponse {}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AddTimeplanEntryBody {
    earliest_start_time: Option<String>, // ISO datetime string
    duration_seconds: Option<i32>,
    label: Option<String>,
    category: Option<String>,
}

/// Add a new timeplan entry.
///
/// This endpoint is used to create a new timeplan entry.
#[utoipa::path(
    post,
    tags=["command", "timeplan"],
    path="/add_timeplan_entry",
    request_body=AddTimeplanEntryBody,
    responses(
        (status=200, content_type="application/json", body=AddTimeplanEntryResponse),
        (status=400, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn add_timeplan_entry(
    Extension(db): Extension<ReloadableSqlite>,
    auth: Auth,
    Json(body): Json<AddTimeplanEntryBody>,
) -> Result<Json<AddTimeplanEntryResponse>, HttpError> {
    if !auth.is_admin() {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }
    let db = db.get().await.clone();

    sqlx::query!(
        r#"
        INSERT INTO timeplan (
            earliest_start_time, 
            duration_seconds, 
            label, 
            category
        )
        VALUES ($1, $2, $3, $4)
        "#,
        body.earliest_start_time,
        body.duration_seconds,
        body.label,
        body.category,
    )
    .execute(&db)
    .await?;

    Ok(Json(AddTimeplanEntryResponse {}))
}
