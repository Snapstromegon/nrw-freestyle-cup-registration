use axum::Json;
use axum_extra::extract::{
    cookie::{Cookie, SameSite},
    CookieJar,
};
use tracing::instrument;

use crate::http_server::HttpError;

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
pub async fn logout(cookies: CookieJar) -> Result<(CookieJar, Json<String>), HttpError> {
    Ok((
        cookies.add(
            Cookie::build(("jwt", ""))
                .http_only(true)
                .secure(true)
                .max_age(time::Duration::seconds(0))
                .path("/")
                .same_site(SameSite::Strict)
                .build(),
        ),
        Json("Logged out".into()),
    ))
}
