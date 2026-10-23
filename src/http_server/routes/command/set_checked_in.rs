use std::collections::HashSet;

use axum::{Extension, Json, http::StatusCode};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use tracing::{info, instrument};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    http_server::{ClientError, HttpError, extractor::auth::Granted},
    reloadable_sqlite::{ReloadableSqlite, begin_write},
    roles::permit,
};

#[derive(Debug, Serialize, ToSchema)]
pub struct SetCheckedInResponse {
    /// The check-in time set for starters that weren't checked in yet. Starters
    /// that already were keep their earlier time. `null` when checking out.
    #[serde(with = "time::serde::iso8601::option")]
    checked_in_at: Option<OffsetDateTime>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SetCheckedInBody {
    starter_ids: Vec<Uuid>,
    checked_in: bool,
}

/// Check starters in (or out) on competition day.
///
/// Check-in and music control. Works after registration closed. Fails as a
/// whole if one of the starters doesn't exist.
#[utoipa::path(
    post,
    tags=["command", "check-in"],
    path="/set_checked_in",
    request_body=SetCheckedInBody,
    responses(
        (status=200, content_type="application/json", body=SetCheckedInResponse),
        (status=403, content_type="application/json", body=ClientError),
        (status=404, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn set_checked_in(
    Extension(db): Extension<ReloadableSqlite>,
    _: Granted<permit::CheckIn>,
    Json(body): Json<SetCheckedInBody>,
) -> Result<Json<SetCheckedInResponse>, HttpError> {
    let db = db.get().await.clone();
    let mut transaction = begin_write(&db).await?;

    let checked_in_at = body.checked_in.then(OffsetDateTime::now_utc);
    info!(
        "Setting check-in of {} starters to {:?}",
        body.starter_ids.len(),
        checked_in_at
    );
    let starter_ids: HashSet<Uuid> = body.starter_ids.into_iter().collect();
    for starter_id in starter_ids {
        let result = if let Some(checked_in_at) = checked_in_at {
            sqlx::query!(
                "UPDATE starter SET checked_in_at = COALESCE(checked_in_at, ?) WHERE id = ?",
                checked_in_at,
                starter_id,
            )
            .execute(&mut *transaction)
            .await?
        } else {
            sqlx::query!(
                "UPDATE starter SET checked_in_at = NULL WHERE id = ?",
                starter_id
            )
            .execute(&mut *transaction)
            .await?
        };
        if result.rows_affected() == 0 {
            return Err(HttpError::StatusCode(StatusCode::NOT_FOUND));
        }
    }

    transaction.commit().await?;

    Ok(Json(SetCheckedInResponse { checked_in_at }))
}
