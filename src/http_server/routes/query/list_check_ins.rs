use axum::{Extension, Json, http::StatusCode};
use tracing::instrument;
use uuid::Uuid;

use crate::{
    http_server::{ClientError, HttpError, extractor::auth::Auth},
    reloadable_sqlite::ReloadableSqlite,
};

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct CheckIn {
    starter_id: Uuid,
    /// `null` if the starter hasn't checked in yet.
    #[serde(with = "time::serde::iso8601::option")]
    checked_in_at: Option<time::OffsetDateTime>,
}

/// The check-in state of every starter. Admin only.
///
/// Small enough to poll during the competition.
#[utoipa::path(
    get,
    tags=["query", "check-in"],
    path="/list_check_ins",
    responses(
        (status=200, content_type="application/json", body=Vec<CheckIn>),
        (status=403, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
pub async fn list_check_ins(
    Extension(db): Extension<ReloadableSqlite>,
    auth: Auth,
) -> Result<Json<Vec<CheckIn>>, HttpError> {
    if !auth.is_admin() {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }
    let db = db.get().await.clone();
    let check_ins = sqlx::query_as!(
        CheckIn,
        r#"
        SELECT
            id as "starter_id!: Uuid",
            checked_in_at as "checked_in_at: time::OffsetDateTime"
        FROM starter
        "#
    )
    .fetch_all(&db)
    .await?;
    Ok(Json(check_ins))
}
