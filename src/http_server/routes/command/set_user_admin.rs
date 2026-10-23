use axum::{Extension, Json, http::StatusCode};
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
    auth: Granted<permit::ManageUsers>,
    Json(body): Json<SetUserAdminBody>,
) -> Result<Json<SetUserAdminResponse>, HttpError> {
    if auth.user_id == body.user_id && !body.is_admin {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }
    let db = db.get().await.clone();
    let mut transaction = begin_write(&db).await?;

    let exists: Option<i64> = sqlx::query_scalar("SELECT 1 FROM users WHERE id = ?")
        .bind(body.user_id)
        .fetch_optional(&mut *transaction)
        .await?;
    exists.ok_or(HttpError::NotFound)?;
    let current_is_admin: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM user_roles WHERE user_id = ? AND role = 'admin')",
    )
    .bind(body.user_id)
    .fetch_one(&mut *transaction)
    .await?;

    if current_is_admin && !body.is_admin {
        let admin_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM user_roles WHERE role = 'admin'")
                .fetch_one(&mut *transaction)
                .await?;
        if admin_count <= 1 {
            return Err(HttpError::StatusCode(StatusCode::CONFLICT));
        }
    }

    if body.is_admin {
        sqlx::query("INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, 'admin')")
            .bind(body.user_id)
            .execute(&mut *transaction)
            .await?;
    } else {
        sqlx::query("DELETE FROM user_roles WHERE user_id = ? AND role = 'admin'")
            .bind(body.user_id)
            .execute(&mut *transaction)
            .await?;
    }

    transaction.commit().await?;
    info!(
        "Set admin status of user {} to {}",
        body.user_id, body.is_admin
    );
    Ok(Json(SetUserAdminResponse {}))
}
