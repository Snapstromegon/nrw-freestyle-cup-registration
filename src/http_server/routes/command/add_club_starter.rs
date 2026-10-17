use axum::{Extension, Json, http::StatusCode};
use serde::{Deserialize, Serialize};
use tracing::{info, instrument};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    act_type::ActType,
    gender::Gender,
    groups::{ensure_club_access, ensure_partner_in_club},
    http_server::{ClientError, HttpError, extractor::auth::Auth},
    reloadable_sqlite::ReloadableSqlite,
    system_status::Capabilities,
    utils::{check_single_start, set_act},
};

#[derive(Debug, Serialize, ToSchema)]
pub struct AddClubStarterResponse {
    starter_id: Uuid,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AddClubStarterBody {
    club_id: Uuid,
    firstname: String,
    lastname: String,
    #[serde(with = "time::serde::iso8601")]
    birthdate: time::OffsetDateTime,
    /// Required, unless it follows from the single (`single_female` or
    /// `single_male`).
    #[serde(default)]
    gender: Option<Gender>,
    single_male: bool,
    single_female: bool,
    pair: bool,
    partner_id: Option<Uuid>,
    partner_name: Option<String>,
}

/// Add a starter to a club.
///
/// Only the club (or an admin) can add starters to it. An explicit
/// `partner_id` must be a starter of the same club; admins can also link
/// partners of other clubs.
#[utoipa::path(
    post,
    tags=["command", "club"],
    path="/add_club_starter",
    request_body=AddClubStarterBody,
    responses(
        (status=200, content_type="application/json", body=AddClubStarterResponse),
        (status=400, content_type="application/json", body=ClientError),
        (status=403, content_type="application/json", body=ClientError),
        (status=404, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn add_club_starter(
    Extension(db): Extension<ReloadableSqlite>,
    auth: Auth,
    capabilities: Capabilities,
    Json(body): Json<AddClubStarterBody>,
) -> Result<Json<AddClubStarterResponse>, HttpError> {
    if !capabilities.can_register_starter {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }
    check_single_start(body.single_male, body.single_female).map_err(HttpError::ErrorMessages)?;
    Gender::check_single(body.gender, body.single_male, body.single_female)
        .map_err(HttpError::ErrorMessages)?;
    let gender = body
        .gender
        .or(Gender::of_single(body.single_male, body.single_female))
        .ok_or_else(|| HttpError::ErrorMessages("Bitte gib das Geschlecht an.".to_string()))?;
    let db = db.get().await.clone();
    {
        let mut conn = db.acquire().await?;
        ensure_club_access(&mut conn, &auth, body.club_id).await?;
        if let Some(partner_id) = body.partner_id {
            ensure_partner_in_club(&mut conn, &auth, partner_id, body.club_id).await?;
        }
    }
    let starter_id = Uuid::now_v7();

    let self_name = format!("{} {}", body.firstname, body.lastname);

    // Find potential partner
    let partner_id = if let Some(partner_id) = body.partner_id {
        Some(partner_id)
    } else {
        let rows = sqlx::query!(
            r#"
            SELECT id as "id!: Uuid" FROM starter WHERE concat_ws(" ", firstname, lastname) = ? AND pair = TRUE AND club_id = ?
            "#,
            body.partner_name,
            body.club_id,
        )
        .fetch_all(&db)
        .await?;
        if rows.len() != 1 {
            None
        } else {
            Some(rows[0].id)
        }
    };
    info!("Found partner_id: {:?}", partner_id);
    if let Some(partner_id) = partner_id {
        sqlx::query!(
            r#"
                UPDATE starter SET partner_id = NULL, partner_name = NULL WHERE partner_id = ?
                "#,
            partner_id,
        )
        .execute(&db)
        .await?;
    }

    info!("Inserting starter {:?}", starter_id);
    sqlx::query!(
        r#"
        INSERT INTO starter (
          id,
          club_id,
          firstname,
          lastname,
          birthdate,
          gender,
          single_male,
          single_female,
          pair,
          partner_id,
          partner_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        "#,
        starter_id,
        body.club_id,
        body.firstname,
        body.lastname,
        body.birthdate,
        gender,
        body.single_male,
        body.single_female,
        body.pair,
        partner_id,
        body.partner_name,
    )
    .execute(&db)
    .await?;

    if body.single_female || body.single_male {
        set_act(&db, "", &[starter_id], None, ActType::Single)
            .await
            .map_err(HttpError::ErrorMessages)?;
    }

    if let Some(partner_id) = partner_id {
        set_act(&db, "", &[starter_id, partner_id], None, ActType::Pair)
            .await
            .map_err(HttpError::ErrorMessages)?;
        info!(
            "Updating partner {:?} to link to starter {:?}",
            partner_id, starter_id
        );
        sqlx::query!(
            r#"
                UPDATE starter SET partner_id = ?, partner_name = ? WHERE id = ?
                "#,
            starter_id,
            self_name,
            partner_id,
        )
        .execute(&db)
        .await?;
    }

    Ok(Json(AddClubStarterResponse { starter_id }))
}
