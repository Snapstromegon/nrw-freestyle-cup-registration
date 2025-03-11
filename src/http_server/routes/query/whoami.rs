use axum::{Extension, Json};
use tracing::instrument;
use uuid::Uuid;

use crate::{
    http_server::{HttpError, extractor::auth::Auth, routes::http_types::User},
    reloadable_sqlite::ReloadableSqlite,
};

/// Get information about the currently authenticated user.
#[utoipa::path(
    get,
    tags=["query", "auth"],
    path="/whoami",
    responses(
        (status=200, content_type="application/json", body=User),
    ),
)]
#[instrument(skip(db))]
pub async fn whoami(
    Extension(db): Extension<ReloadableSqlite>,
    auth: Auth,
) -> Result<Json<User>, HttpError> {
    let db = db.get().await.clone();
    let user = sqlx::query_as!(
        User,
        r#"
        SELECT id as "id!: Uuid", name, email, email_verified, is_admin, club_id as "club_id: Uuid" FROM users WHERE id = ?
        "#,
        auth.user_id
    )
    .fetch_one(&db)
    .await?;
    Ok(Json(user))
}
