use axum::{Extension, Json, http::StatusCode};
use serde::{Deserialize, Serialize};
use tracing::{info, instrument};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    http_server::{ClientError, HttpError, extractor::auth::Auth},
    jury::JuryEnabled,
    reloadable_sqlite::{ReloadableSqlite, begin_write},
};

#[derive(Debug, Serialize, ToSchema)]
pub struct DeleteJuryCategoryResponse {}

#[derive(Debug, Deserialize, ToSchema)]
pub struct DeleteJuryCategoryBody {
    id: Uuid,
}

/// Delete a jury category. Refused while judges are registered for it.
/// Admin only.
#[utoipa::path(
    post,
    tags=["command", "jury"],
    path="/delete_jury_category",
    request_body=DeleteJuryCategoryBody,
    responses(
        (status=200, content_type="application/json", body=DeleteJuryCategoryResponse),
        (status=403, content_type="application/json", body=ClientError),
        (status=404, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn delete_jury_category(
    _jury: JuryEnabled,
    Extension(db): Extension<ReloadableSqlite>,
    auth: Auth,
    Json(body): Json<DeleteJuryCategoryBody>,
) -> Result<Json<DeleteJuryCategoryResponse>, HttpError> {
    if !auth.is_admin() {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }
    let db = db.get().await.clone();
    let mut transaction = begin_write(&db).await?;
    let registrations = sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!: i64" FROM judge_registration WHERE jury_category_id = ?"#,
        body.id
    )
    .fetch_one(&mut *transaction)
    .await?;
    if registrations > 0 {
        return Err(HttpError::ErrorMessages(
            "Für diese Jury-Kategorie sind JurorInnen gemeldet. Erst die Anmeldungen ändern, dann löschen."
                .to_string(),
        ));
    }
    info!("Deleting jury category {}", body.id);
    let result = sqlx::query!("DELETE FROM jury_categories WHERE id = ?", body.id)
        .execute(&mut *transaction)
        .await?;
    if result.rows_affected() == 0 {
        return Err(HttpError::StatusCode(StatusCode::NOT_FOUND));
    }
    transaction.commit().await?;
    Ok(Json(DeleteJuryCategoryResponse {}))
}
