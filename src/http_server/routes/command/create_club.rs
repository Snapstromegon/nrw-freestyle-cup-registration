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
        (status=400, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn create_club(
    Extension(db): Extension<ReloadableSqlite>,
    auth: Auth,
    capabilities: Capabilities,
    Json(body): Json<CreateClubBody>,
) -> Result<Json<CreateClubResponse>, HttpError> {
    if !capabilities.can_create_club {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }
    let db = db.get().await.clone();
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
    .await?;

    Ok(Json(CreateClubResponse { club_id }))
}
