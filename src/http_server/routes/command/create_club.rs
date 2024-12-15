use axum::{Extension, Json};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tracing::instrument;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::http_server::{extractor::auth::Auth, HttpError};

#[derive(Debug, Serialize, ToSchema)]
pub struct CreateClubResponse {
    club_id: Uuid,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateClubBody {
    name: String,
}

/// CreateClub a new user.
///
/// This endpoint is used to create a new user.
#[utoipa::path(
    post,
    tags=["command", "club"],
    path="/create_club",
    request_body=CreateClubBody,
    responses(
        (status=200, content_type="application/json", body=CreateClubResponse),
    ),
)]
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn create_club(
    Extension(db): Extension<SqlitePool>,
    auth: Auth,
    Json(body): Json<CreateClubBody>,
) -> Result<Json<CreateClubResponse>, HttpError> {
    let club_id = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO clubs (id, name, owner_id) VALUES (?, ?, ?);
        UPDATE users SET club_id = ? WHERE id = ?;
        "#,
        club_id,
        body.name,
        auth.user_id,
        club_id,
        auth.user_id,
    )
    .execute(&db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to create club: {:?}", e);
        HttpError::InternalServerError
    })?;

    Ok(Json(CreateClubResponse { club_id }))
}
