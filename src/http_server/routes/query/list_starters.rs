use axum::{Extension, Json};
use sqlx::SqlitePool;
use tracing::instrument;
use uuid::Uuid;

use crate::http_server::{ClientError, HttpError, extractor::auth::Auth};

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct Starter {
    id: Uuid,
    club_id: Uuid,
    club_name: String,
    firstname: String,
    lastname: String,
    #[serde(with = "time::serde::iso8601")]
    birthdate: time::OffsetDateTime,
    single_sonderpokal: bool,
    single_male: bool,
    single_female: bool,
    pair_sonderpokal: bool,
    pair: bool,
    partner_id: Option<Uuid>,
    partner_name: Option<String>,
    resolved_partner_name: Option<String>,
    resolved_partner_club: Option<String>,
}

/// Get information about a club.
#[utoipa::path(
    get,
    tags=["query"],
    path="/list_starters",
    responses(
        (status=200, content_type="application/json", body=Vec<Starter>),
        (status=404, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
pub async fn list_starters(
    Extension(db): Extension<SqlitePool>,
    auth: Option<Auth>,
) -> Result<Json<Vec<Starter>>, HttpError> {
    auth.ok_or(HttpError::InvalidCredentials).map(|auth| {
        if auth.is_admin() {
            Ok(())
        } else {
            Err(HttpError::InvalidCredentials)
        }
    })??;
    let club_starters = sqlx::query_as!(
        Starter,
        r#"
        SELECT
            starter.id as "id!: Uuid",
            starter.club_id as "club_id!: Uuid",
            club.name as "club_name!",
            starter.firstname,
            starter.lastname,
            starter.birthdate,
            starter.single_sonderpokal,
            starter.single_male,
            starter.single_female,
            starter.pair_sonderpokal,
            starter.pair,
            starter.partner_id as "partner_id: Uuid",
            starter.partner_name,
            NULLIF(concat_ws(" ", partner.firstname, partner.lastname), '') as "resolved_partner_name: String",
            partner_club.name as resolved_partner_club
        FROM starter
          LEFT JOIN clubs as club ON club.id = starter.club_id
          LEFT JOIN starter as partner ON partner.id = starter.partner_id
          LEFT JOIN clubs as partner_club ON partner_club.id = partner.club_id
        "#
    )
    .fetch_all(&db)
    .await?;
    Ok(Json(club_starters))
}
