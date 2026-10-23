use axum::{Extension, Json};
use serde::{Deserialize, Serialize};
use tracing::{info, instrument};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    http_server::{ClientError, HttpError, extractor::auth::Granted},
    reloadable_sqlite::ReloadableSqlite,
    roles::permit,
};

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
    Extension(db): Extension<ReloadableSqlite>,
    _: Granted<permit::ManagePayments>,
    Json(body): Json<ClubPaymentBody>,
) -> Result<Json<SetClubPaymentResponse>, HttpError> {
    let db = db.get().await.clone();

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
