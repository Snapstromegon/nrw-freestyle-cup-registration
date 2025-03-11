use axum::{Extension, Json, http::StatusCode};
use serde::{Deserialize, Serialize};
use tracing::instrument;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    http_server::{ClientError, HttpError, extractor::auth::Auth},
    reloadable_sqlite::ReloadableSqlite,
    system_status::Capabilities,
    utils::{delete_act, get_act_id_for_starter_id, set_act},
};

#[derive(Debug, Serialize, ToSchema)]
pub struct EditClubStarterResponse {}

#[derive(Debug, Deserialize, ToSchema)]
pub struct EditClubStarterBody {
    starter_id: Uuid,
    firstname: String,
    lastname: String,
    #[serde(with = "time::serde::iso8601")]
    birthdate: time::OffsetDateTime,
    single_sonderpokal: bool,
    single_male: bool,
    single_female: bool,
    pair_sonderpokal: bool,
    pair: bool,
    partner_name: Option<String>,
    partner_id: Option<Uuid>,
}

/// EditClubStarter a new user.
///
/// This endpoint is used to create a new user.
#[utoipa::path(
    post,
    tags=["command", "club"],
    path="/edit_club_starter",
    request_body=EditClubStarterBody,
    responses(
        (status=200, content_type="application/json", body=EditClubStarterResponse),
        (status=400, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn edit_club_starter(
    Extension(db): Extension<ReloadableSqlite>,
    auth: Auth,
    capabilities: Capabilities,
    Json(mut body): Json<EditClubStarterBody>,
) -> Result<Json<EditClubStarterResponse>, HttpError> {
    if !capabilities.can_register_starter {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }
    let db = db.get().await.clone();

    let self_name = format!("{} {}", body.firstname, body.lastname);

    let existing_partner_name = sqlx::query!(
        r#"
        SELECT partner_name FROM starter WHERE id = ?
        "#,
        body.starter_id,
    )
    .fetch_one(&db)
    .await?
    .partner_name;

    if existing_partner_name != body.partner_name || !body.pair {
        body.partner_id = None;
    }

    // Find potential partner
    let partner_id = if let Some(partner_id) = body.partner_id {
        Some(partner_id)
    } else {
        let self_club_id = sqlx::query!(
            r#"
            SELECT club_id as "club_id: Uuid" FROM starter WHERE id = ?
            "#,
            body.starter_id,
        )
        .fetch_one(&db)
        .await?
        .club_id;
        let rows = sqlx::query!(
            r#"
            SELECT id as "id!: Uuid" FROM starter WHERE concat_ws(" ", firstname, lastname) = ? AND pair = TRUE AND club_id = ?
            "#,
            body.partner_name,
            self_club_id,
        )
        .fetch_all(&db)
        .await?;
        if rows.len() != 1 {
            None
        } else {
            Some(rows[0].id)
        }
    };

    let existing_partner_id = sqlx::query!(
        r#"
        SELECT partner_id as "partner_id: Uuid" FROM starter WHERE id = ?
        "#,
        body.starter_id,
    )
    .fetch_one(&db)
    .await?
    .partner_id;

    if existing_partner_id != partner_id {
        // Partner checks
        if let Some(real_partner_id) = partner_id {
            // Check that you don't pair with yourself
            if body.starter_id == real_partner_id {
                return Err(HttpError::ErrorMessages(
                    "Fahrer und Partner sind die selbe Person!".to_string(),
                ));
            }
        }

        // Reset partner of partner
        if let Some(existing_partner_id) = existing_partner_id {
            sqlx::query!(
                r#"
                UPDATE starter SET partner_id = NULL, partner_name = NULL WHERE id = ?
                "#,
                existing_partner_id,
            )
            .execute(&db)
            .await?;
        }

        if let Some(partner_id) = partner_id {
            sqlx::query!(
                r#"
                UPDATE starter SET partner_id = NULL, partner_name = NULL WHERE partner_id = ?
                "#,
                partner_id,
            )
            .execute(&db)
            .await?;
            sqlx::query!(
                r#"
                UPDATE starter SET partner_id = ?, partner_name = ? WHERE id = ?
                "#,
                body.starter_id,
                self_name,
                partner_id,
            )
            .execute(&db)
            .await?;

            // Reset act
            if let Some(own_act_id) = get_act_id_for_starter_id(&db, body.starter_id, true)
                .await
                .map_err(HttpError::ErrorMessages)?
            {
                delete_act(&db, own_act_id)
                    .await
                    .map_err(HttpError::ErrorMessages)?;
            }
            if let Some(partner_act_id) = get_act_id_for_starter_id(&db, partner_id, true)
                .await
                .map_err(HttpError::ErrorMessages)?
            {
                delete_act(&db, partner_act_id)
                    .await
                    .map_err(HttpError::ErrorMessages)?;
            }

            set_act(&db, "", &[body.starter_id, partner_id], None, true)
                .await
                .map_err(HttpError::ErrorMessages)?;
        }
    }

    sqlx::query!(
        r#"
        UPDATE starter SET
          firstname = ?,
          lastname = ?,
          birthdate = ?,
          single_sonderpokal = ?,
          single_male = ?,
          single_female = ?,
          pair_sonderpokal = ?,
          pair = ?,
          partner_name = ?,
          partner_id = ?
        WHERE id = ?
        "#,
        body.firstname,
        body.lastname,
        body.birthdate,
        body.single_sonderpokal,
        body.single_male,
        body.single_female,
        body.pair_sonderpokal,
        body.pair,
        body.partner_name,
        partner_id,
        body.starter_id,
    )
    .execute(&db)
    .await?;

    let existing_act = get_act_id_for_starter_id(&db, body.starter_id, false)
        .await
        .map_err(HttpError::ErrorMessages)?;
    if (body.single_female || body.single_male) && existing_act.is_none() {
        set_act(&db, "", &[body.starter_id], None, false)
            .await
            .map_err(HttpError::ErrorMessages)?;
    } else if (!body.single_female && !body.single_male) && existing_act.is_some() {
        delete_act(&db, existing_act.unwrap())
            .await
            .map_err(HttpError::ErrorMessages)?;
    }

    Ok(Json(EditClubStarterResponse {}))
}
