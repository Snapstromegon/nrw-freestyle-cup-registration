use axum::{Extension, Json, http::StatusCode};
use serde::{Deserialize, Serialize};
use tracing::{info, instrument};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    act_type::ActType,
    groups::{ensure_club_access, ensure_group_name_is_free, normalize_group_name},
    http_server::{ClientError, HttpError, extractor::auth::Auth},
    reloadable_sqlite::{ReloadableSqlite, begin_write},
    system_status::Capabilities,
};

#[derive(Debug, Serialize, ToSchema)]
pub struct CreateClubGroupResponse {
    act_id: Uuid,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateClubGroupBody {
    club_id: Uuid,
    group_name: String,
}

/// Create a group act.
///
/// The club becomes the group's owner. The group starts without riders; add
/// them with `set_club_group_members`. Group names are unique across the
/// competition (case-insensitive).
#[utoipa::path(
    post,
    tags=["command", "club", "group"],
    path="/create_club_group",
    request_body=CreateClubGroupBody,
    responses(
        (status=200, content_type="application/json", body=CreateClubGroupResponse),
        (status=403, content_type="application/json", body=ClientError),
        (status=404, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn create_club_group(
    Extension(db): Extension<ReloadableSqlite>,
    auth: Auth,
    capabilities: Capabilities,
    Json(body): Json<CreateClubGroupBody>,
) -> Result<Json<CreateClubGroupResponse>, HttpError> {
    if !capabilities.can_register_starter {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }
    let db = db.get().await.clone();
    let mut transaction = begin_write(&db).await?;

    ensure_club_access(&mut transaction, &auth, body.club_id).await?;
    let group_name = normalize_group_name(&body.group_name).map_err(HttpError::ErrorMessages)?;
    ensure_group_name_is_free(&mut transaction, &group_name, None).await?;

    let act_id = Uuid::now_v7();
    info!(
        "Creating group {group_name:?} ({act_id}) for club {}",
        body.club_id
    );
    sqlx::query!(
        r#"
        INSERT INTO acts (id, name, act_type, group_name, owner_club_id)
        VALUES (?, '', ?, ?, ?)
        "#,
        act_id,
        ActType::GroupSmall,
        group_name,
        body.club_id,
    )
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;

    Ok(Json(CreateClubGroupResponse { act_id }))
}
