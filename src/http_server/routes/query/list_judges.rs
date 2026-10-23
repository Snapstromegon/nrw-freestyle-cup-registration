use axum::{Extension, Json, http::StatusCode};
use tracing::instrument;

use crate::{
    http_server::{ClientError, HttpError, extractor::auth::Auth},
    jury::{self, ClubJudge, JuryEnabled},
    reloadable_sqlite::ReloadableSqlite,
};

/// List the judges of all clubs, by club. Admin only.
#[utoipa::path(
    get,
    tags=["query", "jury"],
    path="/list_judges",
    responses(
        (status=200, content_type="application/json", body=Vec<ClubJudge>),
        (status=401, content_type="application/json", body=ClientError),
        (status=403, content_type="application/json", body=ClientError),
        (status=404, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
pub async fn list_judges(
    _jury: JuryEnabled,
    Extension(db): Extension<ReloadableSqlite>,
    auth: Auth,
) -> Result<Json<Vec<ClubJudge>>, HttpError> {
    if !auth.is_admin() {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }
    let db = db.get().await.clone();
    let mut conn = db.acquire().await?;
    Ok(Json(jury::list_judges(&mut conn, None).await?))
}
