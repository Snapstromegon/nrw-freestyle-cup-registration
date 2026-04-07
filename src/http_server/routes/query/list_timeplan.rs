use axum::{Extension, Json};
use tracing::instrument;

use crate::{
    http_server::{ClientError, HttpError, extractor::auth::Auth},
    reloadable_sqlite::ReloadableSqlite,
};

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct TimeplanListEntry {
    id: i64,
    #[serde(with = "time::serde::iso8601::option")]
    earliest_start_time: Option<time::OffsetDateTime>,
    duration_seconds: Option<i64>,
    label: Option<String>,
    category: Option<String>,
    #[serde(with = "time::serde::iso8601::option")]
    started_at: Option<time::OffsetDateTime>,
    #[serde(with = "time::serde::iso8601::option")]
    ended_at: Option<time::OffsetDateTime>,
}

/// List all timeplan entries.
#[utoipa::path(
    get,
    tags=["query"],
    path="/list_timeplan",
    responses(
        (status=200, content_type="application/json", body=Vec<TimeplanListEntry>),
        (status=404, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
pub async fn list_timeplan(
    Extension(db): Extension<ReloadableSqlite>,
    auth: Option<Auth>,
) -> Result<Json<Vec<TimeplanListEntry>>, HttpError> {
    let db = db.get().await.clone();
    let timeplan_entries = sqlx::query_as!(
        TimeplanListEntry,
        r#"
        SELECT id, earliest_start_time, duration_seconds, label, category, started_at, ended_at
        FROM timeplan ORDER BY id ASC
        "#
    )
    .fetch_all(&db)
    .await?;

    Ok(Json(timeplan_entries))
}
