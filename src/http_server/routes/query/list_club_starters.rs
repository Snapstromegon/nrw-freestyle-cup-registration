use axum::{extract::Query, Extension, Json};
use sqlx::SqlitePool;
use tracing::instrument;
use uuid::Uuid;

use crate::http_server::{extractor::auth::Auth, ClientError, HttpError};

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct ClubStarter {
    id: Uuid,
    club_id: Uuid,
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

#[derive(Debug, serde::Deserialize, utoipa::IntoParams)]
pub struct ListClubStartersQuery {
    club_id: Uuid,
}

/// Get information about a club.
#[utoipa::path(
    get,
    tags=["query", "club"],
    params(ListClubStartersQuery),
    path="/list_club_starters",
    responses(
        (status=200, content_type="application/json", body=Vec<ClubStarter>),
        (status=404, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
pub async fn list_club_starters(
    Extension(db): Extension<SqlitePool>,
    Query(query): Query<ListClubStartersQuery>,
    auth: Option<Auth>,
) -> Result<Json<Vec<ClubStarter>>, HttpError> {
    let club_id = query.club_id;
    let club_starters = sqlx::query_as!(
        ClubStarter,
        r#"
        SELECT
            starter.id as "id!: Uuid",
            starter.club_id as "club_id!: Uuid",
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
        FROM starter LEFT JOIN starter as partner ON partner.id = starter.partner_id LEFT JOIN clubs as partner_club ON partner_club.id = partner.club_id
        WHERE starter.club_id = ?
        "#,
        club_id
    )
    .fetch_all(&db)
    .await?;
    Ok(Json(club_starters))
}
