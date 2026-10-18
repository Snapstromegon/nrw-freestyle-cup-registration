use axum::{Extension, Json, http::StatusCode};
use serde::{Deserialize, Serialize};
use tracing::{info, instrument};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    http_server::{ClientError, HttpError, extractor::auth::Auth},
    reloadable_sqlite::{ReloadableSqlite, begin_write},
};

#[derive(Debug, Serialize, ToSchema)]
pub struct SetUserAdminResponse {}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SetUserAdminBody {
    user_id: Uuid,
    is_admin: bool,
}

/// Promote a user to admin or return an admin to a normal user.
///
/// Admin only. The last administrator cannot be demoted.
#[utoipa::path(
    post,
    tags=["command", "user"],
    path="/set_user_admin",
    request_body=SetUserAdminBody,
    responses(
        (status=200, content_type="application/json", body=SetUserAdminResponse),
        (status=403, content_type="application/json", body=ClientError),
        (status=404, content_type="application/json", body=ClientError),
        (status=409, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn set_user_admin(
    Extension(db): Extension<ReloadableSqlite>,
    auth: Auth,
    Json(body): Json<SetUserAdminBody>,
) -> Result<Json<SetUserAdminResponse>, HttpError> {
    if !auth.is_admin() {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }
    if auth.user_id == body.user_id && !body.is_admin {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }
    let db = db.get().await.clone();
    let mut transaction = begin_write(&db).await?;

    let current_is_admin: Option<bool> =
        sqlx::query_scalar("SELECT is_admin FROM users WHERE id = ?")
            .bind(body.user_id)
            .fetch_optional(&mut *transaction)
            .await?;
    let current_is_admin = current_is_admin.ok_or(HttpError::NotFound)?;

    if current_is_admin && !body.is_admin {
        let admin_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE is_admin = true")
                .fetch_one(&mut *transaction)
                .await?;
        if admin_count <= 1 {
            return Err(HttpError::StatusCode(StatusCode::CONFLICT));
        }
    }

    sqlx::query("UPDATE users SET is_admin = ? WHERE id = ?")
        .bind(body.is_admin)
        .bind(body.user_id)
        .execute(&mut *transaction)
        .await?;

    transaction.commit().await?;
    info!(
        "Set admin status of user {} to {}",
        body.user_id, body.is_admin
    );
    Ok(Json(SetUserAdminResponse {}))
}
