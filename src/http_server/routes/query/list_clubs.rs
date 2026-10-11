use axum::{Extension, Json};
use tracing::instrument;
use uuid::Uuid;

use crate::{
    http_server::{ClientError, HttpError, extractor::auth::Auth},
    reloadable_sqlite::ReloadableSqlite,
};

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct ClubOverview {
    id: Uuid,
    name: String,
    /// The amount the club has paid so far.
    payment: Option<f64>,
    owner_id: Uuid,
    owner_name: String,
    owner_email: String,
    owner_email_verified: bool,
}

/// List all clubs with their owners. Admin only.
#[utoipa::path(
    get,
    tags=["query", "club"],
    path="/list_clubs",
    responses(
        (status=200, content_type="application/json", body=Vec<ClubOverview>),
        (status=401, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
pub async fn list_clubs(
    Extension(db): Extension<ReloadableSqlite>,
    auth: Auth,
) -> Result<Json<Vec<ClubOverview>>, HttpError> {
    if !auth.is_admin() {
        return Err(HttpError::InvalidCredentials);
    }
    let db = db.get().await.clone();
    let clubs = sqlx::query_as!(
        ClubOverview,
        r#"
        SELECT
            clubs.id as "id!: Uuid",
            clubs.name,
            clubs.payment,
            clubs.owner_id as "owner_id!: Uuid",
            users.name as owner_name,
            users.email as owner_email,
            users.email_verified as owner_email_verified
        FROM clubs
        JOIN users ON users.id = clubs.owner_id
        ORDER BY clubs.name
        "#
    )
    .fetch_all(&db)
    .await?;
    Ok(Json(clubs))
}
