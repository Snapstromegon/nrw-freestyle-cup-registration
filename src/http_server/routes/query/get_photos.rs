use std::sync::Arc;

use axum::{Extension, Json};
use serde::Serialize;
use tracing::instrument;
use utoipa::ToSchema;

use crate::{
    http_server::extractor::auth::Auth,
    photos::{PhotoInfo, Photos},
};

#[derive(Debug, Serialize, ToSchema)]
pub struct PhotosOverview {
    /// Whether a photo source is set (`[photos]`).
    pub configured: bool,
    /// The newest photo that isn't hidden: the info board shows it after an
    /// act.
    pub newest: Option<PhotoInfo>,
    /// How many recent photos breaks choose from.
    pub recent: usize,
    /// Admins only: why the source couldn't be listed last time.
    pub error: Option<String>,
}

/// The info board's photos: the newest one and how many there are. Public,
/// like the info board.
#[utoipa::path(
    get,
    tags=["query", "photos"],
    path="/get_photos",
    responses(
        (status=200, content_type="application/json", body=PhotosOverview),
    ),
)]
#[instrument(skip(photos))]
pub async fn get_photos(
    Extension(photos): Extension<Arc<Photos>>,
    auth: Option<Auth>,
) -> Json<PhotosOverview> {
    let admin = auth.is_some_and(|auth| auth.is_admin());
    Json(PhotosOverview {
        configured: photos.configured(),
        newest: photos.newest(),
        recent: photos.recent().len(),
        error: photos.error().filter(|_| admin),
    })
}
