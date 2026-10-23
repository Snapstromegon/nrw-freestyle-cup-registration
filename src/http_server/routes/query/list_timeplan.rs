use axum::{Extension, Json};
use tracing::instrument;

use crate::{
    http_server::{ClientError, HttpError, extractor::auth::Auth},
    reloadable_sqlite::ReloadableSqlite,
    timeplan::EntryKind,
};

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct TimeplanListEntry {
    id: i64,
    kind: EntryKind,
    #[serde(with = "time::serde::iso8601::option")]
    earliest_start_time: Option<time::OffsetDateTime>,
    duration_seconds: Option<i64>,
    label: Option<String>,
    category: Option<String>,
    /// Start blocks only: the final running here instead of a category.
    final_name: Option<String>,
    /// Start blocks only: overrides the home category's (or final's)
    /// Einfahrzeit.
    einfahrzeit_seconds: Option<i64>,
    /// Custom entries: photos next to the clock on the info board.
    show_photos: bool,
    /// Start blocks only: the order was edited by hand (`set_block_order`),
    /// so the category's start order no longer applies to it.
    manually_ordered: bool,
    #[serde(with = "time::serde::iso8601::option")]
    started_at: Option<time::OffsetDateTime>,
    #[serde(with = "time::serde::iso8601::option")]
    ended_at: Option<time::OffsetDateTime>,
}

/// List all timeplan entries, in order.
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
        SELECT
            id,
            kind as "kind: EntryKind",
            earliest_start_time,
            duration_seconds,
            label,
            category,
            final_name,
            einfahrzeit_seconds,
            show_photos,
            EXISTS (
                SELECT 1 FROM timeplan_slots WHERE timeplan_slots.timeplan_id = timeplan.id
            ) as "manually_ordered!: bool",
            started_at,
            ended_at
        FROM timeplan ORDER BY position, id
        "#
    )
    .fetch_all(&db)
    .await?;

    Ok(Json(timeplan_entries))
}
