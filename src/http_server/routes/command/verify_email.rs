use std::sync::Arc;

use axum::{extract::Query, Extension, Json};
use axum_extra::extract::CookieJar;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tracing::instrument;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{http_server::HttpError, jwt::JWTConfig};

#[derive(Debug, Serialize, ToSchema)]
pub struct VerifyMailResponse {
    user_id: Uuid,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct VerifyMailQuery {
    email: String,
}

/// VerifyMail a new user.
///
/// This endpoint is used to create a new user.
#[utoipa::path(
    get,
    tags=["command", "user"],
    path="/verify_email",
    responses(
        (status=200, content_type="application/json", body=VerifyMailResponse),
    ),
)]
#[instrument(skip(db, jwt_config))]
#[axum::debug_handler]
pub async fn verify_email(
    Extension(db): Extension<SqlitePool>,
    Extension(jwt_config): Extension<Arc<JWTConfig>>,
    Query(body): Query<VerifyMailQuery>,
    cookies: CookieJar,
) -> Result<(CookieJar, Json<VerifyMailResponse>), HttpError> {
    let user = sqlx::query!(
        r#"
        UPDATE users SET email_verified = true WHERE email = ? RETURNING id as "id!: Uuid"
        "#,
        body.email
    )
    .fetch_optional(&db)
    .await?;

    if let Some(user) = user {
        Ok((
            jwt_config.add_jwt_cookie(cookies, user.id).map_err(|e| {
                tracing::error!("Failed to add JWT cookie: {:?}", e);
                HttpError::InvalidCredentials
            })?,
            Json(VerifyMailResponse { user_id: user.id }),
        ))
    } else {
        Err(HttpError::NotFound)
    }
}
