use axum::{Extension, Json};
use tracing::instrument;
use uuid::Uuid;

use crate::{
    http_server::{ClientError, HttpError, extractor::auth::Auth, routes::http_types::User},
    reloadable_sqlite::ReloadableSqlite,
};

/// List all users.
#[utoipa::path(
    get,
    tags=["query", "club"],
    path="/list_users",
    responses(
        (status=200, content_type="application/json", body=Vec<User>),
        (status=404, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
pub async fn list_users(
    Extension(db): Extension<ReloadableSqlite>,
    auth: Auth,
) -> Result<Json<Vec<User>>, HttpError> {
    if !auth.is_admin {
        return Err(HttpError::InvalidCredentials);
    }
    let db = db.get().await.clone();
    let users = sqlx::query_as!(
        User,
        r#"
        SELECT id as "id!: Uuid", club_id as "club_id: Uuid", name, email, email_verified, is_admin FROM users
        "#
    )
    .fetch_all(&db)
    .await?;
    Ok(Json(users))
}
