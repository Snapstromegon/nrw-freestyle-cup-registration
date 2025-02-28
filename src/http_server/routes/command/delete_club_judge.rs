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
pub struct DeleteClubJudgeResponse {}

#[derive(Debug, Deserialize, ToSchema)]
pub struct DeleteClubJudgeBody {
    judge_id: Uuid,
}

/// DeleteClubJudge a new user.
///
/// This endpoint is used to create a new user.
#[utoipa::path(
    post,
    tags=["command", "club"],
    path="/delete_club_judge",
    request_body=DeleteClubJudgeBody,
    responses(
        (status=200, content_type="application/json", body=DeleteClubJudgeResponse),
        (status=400, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn delete_club_judge(
    Extension(db): Extension<SqlitePool>,
    auth: Auth,
    capabilities: Capabilities,
    Json(body): Json<DeleteClubJudgeBody>,
) -> Result<Json<DeleteClubJudgeResponse>, HttpError> {
    if !capabilities.can_register_judge {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }
    sqlx::query!(
        r#"
        DELETE FROM judge WHERE id = ?;
        "#,
        body.judge_id
    )
    .execute(&db)
    .await?;

    Ok(Json(DeleteClubJudgeResponse {}))
}
