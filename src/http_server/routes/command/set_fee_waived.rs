use axum::{Extension, Json};
use serde::{Deserialize, Serialize};
use tracing::{info, instrument};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    http_server::{ClientError, HttpError, extractor::auth::Granted},
    reloadable_sqlite::{ReloadableSqlite, begin_write},
    roles::permit,
};

#[derive(Debug, Serialize, ToSchema)]
pub struct SetFeeWaivedResponse {}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SetFeeWaivedBody {
    act_id: Uuid,
    /// The riders don't pay for this start.
    fee_waived: bool,
}

/// Waive the fee of a withdrawn act, e.g. with a medical certificate, or
/// charge it again. Treasurer; withdrawing stays with the admin.
#[utoipa::path(
    post,
    tags=["command", "payment"],
    path="/set_fee_waived",
    request_body=SetFeeWaivedBody,
    responses(
        (status=200, content_type="application/json", body=SetFeeWaivedResponse),
        (status=403, content_type="application/json", body=ClientError),
        (status=404, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn set_fee_waived(
    Extension(db): Extension<ReloadableSqlite>,
    _: Granted<permit::ManagePayments>,
    Json(body): Json<SetFeeWaivedBody>,
) -> Result<Json<SetFeeWaivedResponse>, HttpError> {
    let db = db.get().await.clone();
    let mut tx = begin_write(&db).await?;
    let withdrawn = sqlx::query_scalar!(
        r#"SELECT withdrawn_at IS NOT NULL as "withdrawn!: bool" FROM acts WHERE id = ?"#,
        body.act_id
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(HttpError::NotFound)?;
    if !withdrawn {
        return Err(HttpError::ErrorMessages(
            "Die Startgebühr lässt sich nur für abgemeldete Küren erlassen.".to_string(),
        ));
    }
    info!(
        "Setting the fee of act {} waived = {}",
        body.act_id, body.fee_waived
    );
    sqlx::query!(
        "UPDATE acts SET fee_waived = ? WHERE id = ?",
        body.fee_waived,
        body.act_id
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(SetFeeWaivedResponse {}))
}
