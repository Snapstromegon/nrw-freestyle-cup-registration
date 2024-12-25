use axum::Json;
use tracing::instrument;

use crate::{http_server::HttpError, system_status::Capabilities};

/// Get information about the status of the system.
#[utoipa::path(
    get,
    tags=["query"],
    path="/get_system_status",
    responses(
        (status=200, content_type="application/json", body=Capabilities),
    ),
)]
#[instrument()]
pub async fn get_system_status(status: Capabilities) -> Result<Json<Capabilities>, HttpError> {
    Ok(Json(status))
}
