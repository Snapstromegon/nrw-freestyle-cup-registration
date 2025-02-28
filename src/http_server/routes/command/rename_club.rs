use axum::{http::StatusCode, Extension, Json};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tracing::instrument;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    http_server::{extractor::auth::Auth, HttpError},
    system_status::Capabilities,
};

#[derive(Debug, Serialize, ToSchema)]
pub struct RenameClubResponse {
    club_id: Uuid,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RenameClubBody {
    club_id: Uuid,
    name: String,
}

/// Rename a club.
///
/// This endpoint is used to rename a club.
#[utoipa::path(
    post,
    tags=["command", "club"],
    path="/rename_club",
    request_body=RenameClubBody,
    responses(
        (status=200, content_type="application/json", body=RenameClubResponse),
    ),
)]
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn rename_club(
    Extension(db): Extension<SqlitePool>,
    auth: Auth,
    capabilities: Capabilities,
    Json(body): Json<RenameClubBody>,
) -> Result<Json<RenameClubResponse>, HttpError> {
    if !capabilities.can_register_starter {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }
    if auth.is_admin {
        sqlx::query!(
            r#"
            UPDATE clubs SET name = ? WHERE id = ?
            "#,
            body.name,
            body.club_id,
        )
    } else {
        sqlx::query!(
            r#"
            UPDATE clubs SET name = ? WHERE id = ? AND owner_id = ?
            "#,
            body.name,
            body.club_id,
            auth.user_id,
        )
    }
    .execute(&db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to rename club: {:?}", e);
        HttpError::InternalServerError
    })?;

    Ok(Json(RenameClubResponse {
        club_id: body.club_id,
    }))
}
