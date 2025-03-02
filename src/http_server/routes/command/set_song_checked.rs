use axum::{Extension, Json, http::StatusCode};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tracing::{info, instrument};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::http_server::{ClientError, HttpError, extractor::auth::Auth};

#[derive(Debug, Serialize, ToSchema)]
pub struct SetSongCheckedResponse {}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SongCheckedBody {
    act_id: Uuid,
    checked: bool,
}

/// EditClubAct a new user.
///
/// This endpoint is used to create a new user.
#[utoipa::path(
    post,
    tags=["command", "club"],
    path="/set_song_checked",
    request_body=SongCheckedBody,
    responses(
        (status=200, content_type="application/json", body=SetSongCheckedResponse),
        (status=400, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn set_song_checked(
    Extension(db): Extension<SqlitePool>,
    auth: Auth,
    Json(body): Json<SongCheckedBody>,
) -> Result<Json<SetSongCheckedResponse>, HttpError> {
    if !auth.is_admin() {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }

    info!(
        "Setting song checked to {} for act {}",
        body.checked, body.act_id
    );

    sqlx::query!(
        r#"
        UPDATE acts
        SET song_checked = $1
        WHERE id = $2
        "#,
        body.checked,
        body.act_id,
    )
    .execute(&db)
    .await?;

    Ok(Json(SetSongCheckedResponse {}))
}
