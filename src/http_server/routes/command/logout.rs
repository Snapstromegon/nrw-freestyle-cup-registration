use std::sync::Arc;

use axum::{Extension, Json};
use axum_extra::extract::CookieJar;
use tracing::instrument;

use crate::{http_server::HttpError, jwt::JWTConfig};

/// Log out the currently authenticated user.
#[utoipa::path(
    post,
    tags=["command", "auth"],
    path="/logout",
    responses(
        (status=200, content_type="application/json", body=String),
    ),
)]
#[instrument(skip(cookies))]
pub async fn logout(
    cookies: CookieJar,
    Extension(jwt_config): Extension<Arc<JWTConfig>>,
) -> Result<(CookieJar, Json<String>), HttpError> {
    Ok((
        jwt_config.remove_jwt_cookie(cookies).map_err(|e| {
            tracing::error!("Failed to remove JWT cookie: {:?}", e);
            HttpError::InvalidCredentials
        })?,
        Json("Logged out".into()),
    ))
}
