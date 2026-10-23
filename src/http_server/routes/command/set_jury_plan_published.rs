use axum::{Extension, Json, http::StatusCode};
use serde::{Deserialize, Serialize};
use tracing::{info, instrument};
use utoipa::ToSchema;

use crate::{
    http_server::{ClientError, HttpError, extractor::auth::Auth},
    jury::JuryEnabled,
    reloadable_sqlite::{ReloadableSqlite, begin_write},
};

#[derive(Debug, Serialize, ToSchema)]
pub struct SetJuryPlanPublishedResponse {}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SetJuryPlanPublishedBody {
    published: bool,
}

/// Publish the Juryplan to the clubs, or take it back. Each club then sees
/// its own judges' assignments. Admin only.
#[utoipa::path(
    post,
    tags=["command", "jury"],
    path="/set_jury_plan_published",
    request_body=SetJuryPlanPublishedBody,
    responses(
        (status=200, content_type="application/json", body=SetJuryPlanPublishedResponse),
        (status=403, content_type="application/json", body=ClientError),
        (status=404, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn set_jury_plan_published(
    _jury: JuryEnabled,
    Extension(db): Extension<ReloadableSqlite>,
    auth: Auth,
    Json(body): Json<SetJuryPlanPublishedBody>,
) -> Result<Json<SetJuryPlanPublishedResponse>, HttpError> {
    if !auth.is_admin() {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }
    let db = db.get().await.clone();
    let mut transaction = begin_write(&db).await?;
    let published_at = body.published.then(time::OffsetDateTime::now_utc);
    info!("Juryplan published: {}", body.published);
    sqlx::query!(
        "UPDATE competition SET jury_plan_published_at = ?",
        published_at
    )
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(Json(SetJuryPlanPublishedResponse {}))
}
