use axum::{Extension, Json, http::StatusCode};
use serde::{Deserialize, Serialize};
use tracing::instrument;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    act_type::ActType,
    groups::{ensure_starter_access, refresh_group_act_type, type_conflict_message},
    http_server::{ClientError, HttpError, extractor::auth::Auth},
    reloadable_sqlite::{ReloadableSqlite, begin_write},
    system_status::Capabilities,
};

#[derive(Debug, Serialize, ToSchema)]
pub struct DeleteClubStarterResponse {
    /// One German message per group that now has a rider who is also in
    /// another group of the same type: a large group the starter left can
    /// shrink into a small group. Such groups have no category until the
    /// clubs sort it out.
    warnings: Vec<String>,
}

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

    let starter = sqlx::query!(
        "SELECT firstname, lastname FROM starter WHERE id = ?",
        body.starter_id
    )
    .fetch_one(&mut *transaction)
    .await?;
    let cause = format!("Ohne „{} {}“", starter.firstname, starter.lastname);

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

    let mut left_groups = Vec::new();
    for act in &acts {
        if act.act_type.is_group() {
            // Only leave the group; it stays with its other riders. The group
            // can shrink from a large into a small group, which can put one of
            // its riders into a second small group.
            sqlx::query!(
                r#"
                DELETE FROM act_participants WHERE act_id = ? AND starter_id = ?;
                "#,
                act.id,
                body.starter_id
            )
            .execute(&mut *transaction)
            .await?;
            refresh_group_act_type(&mut transaction, act.id).await?;
            left_groups.push(act.id);
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

    // Checked once all groups have changed, so every group reports the final
    // state.
    let mut warnings = Vec::new();
    for act_id in left_groups {
        warnings.extend(type_conflict_message(&mut transaction, act_id, Some(&cause)).await?);
    }

    transaction.commit().await?;

    Ok(Json(DeleteClubStarterResponse { warnings }))
}
