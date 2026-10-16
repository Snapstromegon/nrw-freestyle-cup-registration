use axum::{Extension, Json, http::StatusCode};
use serde::{Deserialize, Serialize};
use tracing::instrument;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    act_type::ActType,
    groups::ensure_starter_access,
    http_server::{ClientError, HttpError, extractor::auth::Auth},
    reloadable_sqlite::{ReloadableSqlite, begin_write},
    system_status::Capabilities,
};

#[derive(Debug, Serialize, ToSchema)]
pub struct DeleteClubStarterResponse {}

#[derive(Debug, Deserialize, ToSchema)]
pub struct DeleteClubStarterBody {
    starter_id: Uuid,
}

/// Delete a starter.
///
/// Only the starter's club (or an admin) can delete them. Their single and
/// pair acts are deleted too. Groups keep their other riders.
#[utoipa::path(
    post,
    tags=["command", "club"],
    path="/delete_club_starter",
    request_body=DeleteClubStarterBody,
    responses(
        (status=200, content_type="application/json", body=DeleteClubStarterResponse),
        (status=400, content_type="application/json", body=ClientError),
        (status=403, content_type="application/json", body=ClientError),
        (status=404, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn delete_club_starter(
    Extension(db): Extension<ReloadableSqlite>,
    auth: Auth,
    capabilities: Capabilities,
    Json(body): Json<DeleteClubStarterBody>,
) -> Result<Json<DeleteClubStarterResponse>, HttpError> {
    if !capabilities.can_register_starter {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }
    let db = db.get().await.clone();
    let mut transaction = begin_write(&db).await?;
    ensure_starter_access(&mut transaction, &auth, body.starter_id).await?;

    let acts = sqlx::query!(
        r#"
        SELECT id as "id!: Uuid", act_type as "act_type!: ActType"
        FROM acts JOIN act_participants ON acts.id = act_participants.act_id
        WHERE act_participants.starter_id = ?
        ORDER BY acts.id;
        "#,
        body.starter_id
    )
    .fetch_all(&mut *transaction)
    .await?;

    for act in &acts {
        if act.act_type.is_group() {
            // Only leave the group; it stays with its other riders and keeps
            // its type.
            sqlx::query!(
                r#"
                DELETE FROM act_participants WHERE act_id = ? AND starter_id = ?;
                "#,
                act.id,
                body.starter_id
            )
            .execute(&mut *transaction)
            .await?;
            continue;
        }

        // Single and pair acts are deleted with the starter.
        sqlx::query!(
            r#"
            DELETE FROM act_participants WHERE act_id = ?;
            "#,
            act.id
        )
        .execute(&mut *transaction)
        .await?;

        sqlx::query!(
            r#"
            DELETE FROM acts WHERE id = ?;
            "#,
            act.id
        )
        .execute(&mut *transaction)
        .await?;
    }

    sqlx::query!(
        r#"
        UPDATE starter SET partner_id = NULL, partner_name = NULL WHERE partner_id = ?;
        "#,
        body.starter_id
    )
    .execute(&mut *transaction)
    .await?;

    sqlx::query!(
        r#"
        DELETE FROM starter WHERE id = ?;
        "#,
        body.starter_id
    )
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;

    Ok(Json(DeleteClubStarterResponse {}))
}
