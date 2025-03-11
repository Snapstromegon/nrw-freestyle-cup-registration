use axum::{Extension, Json, http::StatusCode};
use serde::{Deserialize, Serialize};
use tracing::instrument;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    http_server::{ClientError, HttpError, extractor::auth::Auth},
    reloadable_sqlite::ReloadableSqlite,
    system_status::Capabilities,
};

#[derive(Debug, Serialize, ToSchema)]
pub struct EditClubActResponse {}

#[derive(Debug, Deserialize, ToSchema)]
pub struct EditClubActBody {
    id: Uuid,
    name: String,
    description: Option<String>,
}

/// EditClubAct a new user.
///
/// This endpoint is used to create a new user.
#[utoipa::path(
    post,
    tags=["command", "club"],
    path="/edit_club_act",
    request_body=EditClubActBody,
    responses(
        (status=200, content_type="application/json", body=EditClubActResponse),
        (status=400, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn edit_club_act(
    Extension(db): Extension<ReloadableSqlite>,
    auth: Auth,
    capabilities: Capabilities,
    Json(body): Json<EditClubActBody>,
) -> Result<Json<EditClubActResponse>, HttpError> {
    if !capabilities.can_upload_music {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }
    let db = db.get().await.clone();

    sqlx::query!(
        r#"
        UPDATE acts
        SET name = $1, description = $2
        WHERE id = $3
        "#,
        body.name,
        body.description,
        body.id,
    )
    .execute(&db)
    .await?;

    Ok(Json(EditClubActResponse {}))
}
