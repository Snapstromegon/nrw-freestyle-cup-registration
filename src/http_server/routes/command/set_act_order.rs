use axum::{http::StatusCode, Extension, Json};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tracing::instrument;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::http_server::{extractor::auth::Auth, ClientError, HttpError};

#[derive(Debug, Serialize, ToSchema)]
pub struct SetActOrderResponse {}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ActOrderBody {
    act_id: Uuid,
    order: Option<i64>,
}

/// EditClubAct a new user.
///
/// This endpoint is used to create a new user.
#[utoipa::path(
    post,
    tags=["command", "club"],
    path="/set_act_order",
    request_body=ActOrderBody,
    responses(
        (status=200, content_type="application/json", body=SetActOrderResponse),
        (status=400, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn set_act_order(
    Extension(db): Extension<SqlitePool>,
    auth: Auth,
    Json(body): Json<ActOrderBody>,
) -> Result<Json<SetActOrderResponse>, HttpError> {
    if !auth.is_admin() {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }

    sqlx::query!(
        r#"
        UPDATE acts
        SET "order" = $1
        WHERE id = $2
        "#,
        body.order,
        body.act_id,
    )
    .execute(&db)
    .await?;

    Ok(Json(SetActOrderResponse {}))
}
