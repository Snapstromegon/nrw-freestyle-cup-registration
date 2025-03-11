use std::sync::Arc;

use axum::{extract::Query, http::StatusCode, Extension, Json};
use serde::{Deserialize, Serialize};
use tracing::instrument;
use utoipa::ToSchema;

use crate::{
    http_server::{extractor::auth::Auth, ClientError, HttpError, HttpServerOptions},
    reloadable_sqlite::ReloadableSqlite,
};

#[derive(Debug, Serialize, ToSchema)]
pub struct ReloadDBResponse {}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ReloadDBQuery {
    pub token: Option<String>,
}

#[derive(ToSchema, Debug)]
pub struct Upload {}

/// EditClubAct a new user.
///
/// This endpoint is used to create a new user.
#[utoipa::path(
    post,
    tags=["command", "club"],
    path="/reload_db",
    request_body=Upload,
    responses(
        (status=200, content_type="application/json", body=ReloadDBResponse),
        (status=400, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn reload_db(
    Extension(db): Extension<ReloadableSqlite>,
    auth: Auth,
    Query(query): Query<ReloadDBQuery>,
    Extension(http_options): Extension<Arc<HttpServerOptions>>,
) -> Result<Json<ReloadDBResponse>, HttpError> {
    if !auth.is_admin() && query.token != Some(http_options.reload_db_token.clone()) {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }

    db.reload().await?;

    Ok(Json(ReloadDBResponse {}))
}
