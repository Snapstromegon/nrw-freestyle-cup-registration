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
pub struct SetActWithdrawnResponse {}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SetActWithdrawnBody {
    act_id: Uuid,
    withdrawn: bool,
    /// Only for withdrawn acts: the riders don't pay for this start.
    fee_waived: bool,
}

/// Withdraws an act after the registration deadline, or takes it back.
///
/// A withdrawn act doesn't start: it gets no category, so it leaves the
/// startlist and the timeplan. Its riders still pay for it, unless an admin
/// waives the fee (the announcement refunds only with a medical certificate).
/// Before the deadline, clubs simply delete their starters instead.
#[utoipa::path(
    post,
    tags=["command", "admin"],
    path="/set_act_withdrawn",
    request_body=SetActWithdrawnBody,
    responses(
        (status=200, content_type="application/json", body=SetActWithdrawnResponse),
        (status=403, content_type="application/json", body=ClientError),
        (status=404, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn set_act_withdrawn(
    Extension(db): Extension<ReloadableSqlite>,
    _: Granted<permit::ManageRegistrations>,
    Json(body): Json<SetActWithdrawnBody>,
) -> Result<Json<SetActWithdrawnResponse>, HttpError> {
    let db = db.get().await.clone();

    info!(
        "Setting act {} withdrawn = {}, fee waived = {}",
        body.act_id, body.withdrawn, body.fee_waived
    );
    let fee_waived = body.withdrawn && body.fee_waived;
    let updated = sqlx::query!(
        r#"
        UPDATE acts
        SET
            withdrawn_at = CASE WHEN $1 THEN COALESCE(withdrawn_at, datetime('now')) END,
            fee_waived = $2
        WHERE id = $3
        "#,
        body.withdrawn,
        fee_waived,
        body.act_id,
    )
    .execute(&db)
    .await?
    .rows_affected();
    if updated == 0 {
        return Err(HttpError::NotFound);
    }

    Ok(Json(SetActWithdrawnResponse {}))
}
