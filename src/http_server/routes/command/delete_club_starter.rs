use axum::{http::StatusCode, Extension, Json};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tracing::instrument;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    http_server::{extractor::auth::Auth, ClientError, HttpError},
    system_status::Capabilities,
};

#[derive(Debug, Serialize, ToSchema)]
pub struct DeleteClubStarterResponse {}

#[derive(Debug, Deserialize, ToSchema)]
pub struct DeleteClubStarterBody {
    starter_id: Uuid,
}

/// DeleteClubStarter a new user.
///
/// This endpoint is used to create a new user.
#[utoipa::path(
    post,
    tags=["command", "club"],
    path="/delete_club_starter",
    request_body=DeleteClubStarterBody,
    responses(
        (status=200, content_type="application/json", body=DeleteClubStarterResponse),
        (status=400, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn delete_club_starter(
    Extension(db): Extension<SqlitePool>,
    auth: Auth,
    capabilities: Capabilities,
    Json(body): Json<DeleteClubStarterBody>,
) -> Result<Json<DeleteClubStarterResponse>, HttpError> {
    if !capabilities.can_register_starter {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }
    sqlx::query!(
        r#"
        DELETE FROM starter WHERE id = ?;
        "#,
        body.starter_id
    )
    .execute(&db)
    .await?;

    Ok(Json(DeleteClubStarterResponse {}))
}
