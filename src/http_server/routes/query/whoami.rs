use axum::{Extension, Json};
use sqlx::SqlitePool;
use tracing::instrument;
use uuid::Uuid;

use crate::http_server::{extractor::auth::Auth, HttpError};

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct User {
    id: Uuid,
    name: String,
    email: String,
    email_verified: bool,
    is_admin: bool,
    club_id: Option<Uuid>,
}

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
    Extension(db): Extension<SqlitePool>,
    auth: Auth,
) -> Result<Json<User>, HttpError> {
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
