use std::sync::Arc;

use axum::{Extension, Json};
use tracing::instrument;

use crate::{
    competition::Competition,
    http_server::{HttpError, HttpServerOptions},
    reloadable_sqlite::ReloadableSqlite,
    system_status::Capabilities,
};

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct SystemStatus {
    #[serde(flatten)]
    capabilities: Capabilities,
    /// The current competition; `None` until one is configured.
    competition: Option<Competition>,
    /// Whether the jury registration is on; everything about judges is hidden
    /// without it.
    jury_registration: bool,
}

/// Get information about the status of the system and the current competition.
#[utoipa::path(
    get,
    tags=["query"],
    path="/get_system_status",
    responses(
        (status=200, content_type="application/json", body=SystemStatus),
    ),
)]
#[instrument(skip(db, http_options))]
pub async fn get_system_status(
    Extension(db): Extension<ReloadableSqlite>,
    Extension(http_options): Extension<Arc<HttpServerOptions>>,
    capabilities: Capabilities,
) -> Result<Json<SystemStatus>, HttpError> {
    let db = db.get().await.clone();
    Ok(Json(SystemStatus {
        capabilities,
        competition: Competition::current(&db).await?,
        jury_registration: http_options.jury_registration,
    }))
}
