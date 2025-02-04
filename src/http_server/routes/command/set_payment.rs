use axum::{http::StatusCode, Extension, Json};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tracing::{info, instrument};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::http_server::{extractor::auth::Auth, ClientError, HttpError};

#[derive(Debug, Serialize, ToSchema)]
pub struct SetClubPaymentResponse {}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ClubPaymentBody {
    club_id: Uuid,
    amount: f64,
}

/// EditClubAct a new user.
///
/// This endpoint is used to create a new user.
#[utoipa::path(
    post,
    tags=["command", "club"],
    path="/set_payment",
    request_body=ClubPaymentBody,
    responses(
        (status=200, content_type="application/json", body=SetClubPaymentResponse),
        (status=400, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn set_payment(
    Extension(db): Extension<SqlitePool>,
    auth: Auth,
    Json(body): Json<ClubPaymentBody>,
) -> Result<Json<SetClubPaymentResponse>, HttpError> {
    if !auth.is_admin() {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }

    info!(
        "Setting payment to {} for club {}",
        body.amount, body.club_id
    );

    sqlx::query!(
        r#"
        UPDATE clubs
        SET payment = $1
        WHERE id = $2
        "#,
        body.amount,
        body.club_id,
    )
    .execute(&db)
    .await?;

    Ok(Json(SetClubPaymentResponse {}))
}
