use axum::{Extension, Json, http::StatusCode};
use serde::{Deserialize, Serialize};
use tracing::instrument;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    act_type::ActType,
    gender::Gender,
    groups::ensure_starter_access,
    http_server::{ClientError, HttpError, extractor::auth::Auth},
    reloadable_sqlite::{ReloadableSqlite, begin_write},
    system_status::Capabilities,
};

#[derive(Debug, Serialize, ToSchema)]
pub struct ReplaceActRiderResponse {}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ReplaceActRiderBody {
    act_id: Uuid,
    /// The rider leaving the act.
    starter_id: Uuid,
    /// The rider taking their place, of the same club.
    new_starter_id: Uuid,
}

/// Replace a rider of a single or pair, keeping the act with its title,
/// description and music.
///
/// For a single, the new rider gets the single (by their gender, which must
/// be known) and the old one loses it. For a pair, the new rider becomes the
/// partner of the remaining rider. The new rider must be of the same club
/// (admins: any club) and not already ride a single or pair. Group riders
/// are set with `set_club_group_members`.
#[utoipa::path(
    post,
    tags=["command", "club"],
    path="/replace_act_rider",
    request_body=ReplaceActRiderBody,
    responses(
        (status=200, content_type="application/json", body=ReplaceActRiderResponse),
        (status=403, content_type="application/json", body=ClientError),
        (status=404, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn replace_act_rider(
    Extension(db): Extension<ReloadableSqlite>,
    auth: Auth,
    capabilities: Capabilities,
    Json(body): Json<ReplaceActRiderBody>,
) -> Result<Json<ReplaceActRiderResponse>, HttpError> {
    if !capabilities.can_register_starter {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }
    let db = db.get().await.clone();
    let mut transaction = begin_write(&db).await?;

    let act = sqlx::query!(
        r#"
        SELECT act_type as "act_type!: ActType", withdrawn_at IS NOT NULL as "withdrawn!: bool"
        FROM acts WHERE id = ?
        "#,
        body.act_id,
    )
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or(HttpError::StatusCode(StatusCode::NOT_FOUND))?;
    if act.act_type.is_group() {
        return Err(HttpError::ErrorMessages(
            "Die Fahrer einer Gruppe werden in der Gruppe ausgewählt.".to_string(),
        ));
    }
    if act.withdrawn {
        return Err(HttpError::ErrorMessages(
            "Die Kür ist abgemeldet und kann nicht mehr geändert werden.".to_string(),
        ));
    }

    let club_id = ensure_starter_access(&mut transaction, &auth, body.starter_id).await?;
    let new_club_id = ensure_starter_access(&mut transaction, &auth, body.new_starter_id).await?;
    if club_id != new_club_id && !auth.is_admin() {
        return Err(HttpError::ErrorMessages(
            "Der neue Fahrer muss aus demselben Verein sein.".to_string(),
        ));
    }

    let participants = sqlx::query_scalar!(
        r#"SELECT starter_id as "starter_id!: Uuid" FROM act_participants WHERE act_id = ?"#,
        body.act_id,
    )
    .fetch_all(&mut *transaction)
    .await?;
    if !participants.contains(&body.starter_id) {
        return Err(HttpError::StatusCode(StatusCode::NOT_FOUND));
    }
    if participants.contains(&body.new_starter_id) {
        return Err(HttpError::ErrorMessages(
            "Der Fahrer fährt diese Kür schon.".to_string(),
        ));
    }

    let new = sqlx::query!(
        r#"
        SELECT
            firstname, lastname,
            gender as "gender: Gender",
            single_male, single_female, pair
        FROM starter WHERE id = ?
        "#,
        body.new_starter_id,
    )
    .fetch_one(&mut *transaction)
    .await?;
    let new_name = format!("{} {}", new.firstname, new.lastname);

    match act.act_type {
        ActType::Single => {
            if new.single_male || new.single_female {
                return Err(HttpError::ErrorMessages(format!(
                    "{new_name} fährt schon eine Einzelkür."
                )));
            }
            let gender = new.gender.ok_or_else(|| {
                HttpError::ErrorMessages(format!(
                    "Bitte gib zuerst das Geschlecht von {new_name} an."
                ))
            })?;
            let (single_male, single_female) = (gender == Gender::Male, gender == Gender::Female);
            sqlx::query!(
                "UPDATE starter SET single_male = FALSE, single_female = FALSE WHERE id = ?",
                body.starter_id,
            )
            .execute(&mut *transaction)
            .await?;
            sqlx::query!(
                "UPDATE starter SET single_male = ?, single_female = ? WHERE id = ?",
                single_male,
                single_female,
                body.new_starter_id,
            )
            .execute(&mut *transaction)
            .await?;
        }
        ActType::Pair => {
            if new.pair {
                return Err(HttpError::ErrorMessages(format!(
                    "{new_name} fährt schon eine Paarkür."
                )));
            }
            let partner_id = participants
                .iter()
                .copied()
                .find(|id| *id != body.starter_id);
            let partner_name = match partner_id {
                Some(partner_id) => sqlx::query_scalar!(
                    r#"SELECT concat_ws(' ', firstname, lastname) as "name!: String" FROM starter WHERE id = ?"#,
                    partner_id,
                )
                .fetch_optional(&mut *transaction)
                .await?,
                None => None,
            };
            sqlx::query!(
                "UPDATE starter SET pair = FALSE, partner_id = NULL, partner_name = NULL WHERE id = ?",
                body.starter_id,
            )
            .execute(&mut *transaction)
            .await?;
            sqlx::query!(
                "UPDATE starter SET pair = TRUE, partner_id = ?, partner_name = ? WHERE id = ?",
                partner_id,
                partner_name,
                body.new_starter_id,
            )
            .execute(&mut *transaction)
            .await?;
            if let Some(partner_id) = partner_id {
                sqlx::query!(
                    "UPDATE starter SET partner_id = ?, partner_name = ? WHERE id = ?",
                    body.new_starter_id,
                    new_name,
                    partner_id,
                )
                .execute(&mut *transaction)
                .await?;
            }
        }
        ActType::GroupSmall | ActType::GroupLarge => unreachable!("groups are rejected above"),
    }

    sqlx::query!(
        "UPDATE act_participants SET starter_id = ? WHERE act_id = ? AND starter_id = ?",
        body.new_starter_id,
        body.act_id,
        body.starter_id,
    )
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;
    Ok(Json(ReplaceActRiderResponse {}))
}
