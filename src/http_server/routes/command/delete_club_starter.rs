use axum::{Extension, Json, http::StatusCode};
use serde::{Deserialize, Serialize};
use tracing::instrument;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    http_server::{ClientError, HttpError, extractor::auth::Auth},
    reloadable_sqlite::ReloadableSqlite,
    system_status::Capabilities,
};

#[derive(Debug, Serialize, ToSchema)]
pub struct DeleteClubStarterResponse {}

#[derive(Debug, Deserialize, ToSchema)]
pub struct DeleteClubStarterBody {
    starter_id: Uuid,
}

/// DeleteClubStarter a new user.
///
/// This endpoint is used to create a new user.
#[utoipa::path(
    post,
    tags=["command", "club"],
    path="/delete_club_starter",
    request_body=DeleteClubStarterBody,
    responses(
        (status=200, content_type="application/json", body=DeleteClubStarterResponse),
        (status=400, content_type="application/json", body=ClientError),
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
    let mut transaction = db.begin().await?;

    // delete all acts and act_participant entries that reference this starter
    let act_ids = sqlx::query!(
        r#"
        SELECT id as "id!: Uuid" FROM acts JOIN act_participants ON acts.id = act_participants.act_id WHERE act_participants.starter_id = ?;
        "#,
        body.starter_id
    )
    .fetch_all(&mut *transaction)
    .await?
    .into_iter()
    .map(|row| row.id)
    .collect::<Vec<_>>();

    for act_id in &act_ids {
        sqlx::query!(
            r#"
            DELETE FROM act_participants WHERE act_id = ?;
            "#,
            act_id
        )
        .execute(&mut *transaction)
        .await?;

        sqlx::query!(
            r#"
            DELETE FROM acts WHERE id = ?;
            "#,
            act_id
        )
        .execute(&mut *transaction)
        .await?;
    }

    sqlx::query!(
        r#"
        UPDATE starter SET partner_id = NULL WHERE partner_id = ?;
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
