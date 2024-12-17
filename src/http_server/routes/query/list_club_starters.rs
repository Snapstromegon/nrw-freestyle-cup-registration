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
    sonderpokal: bool,
    single_male: bool,
    single_female: bool,
    pair: bool,
    partner_id: Option<Uuid>,
    partner_name: Option<String>,
}

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct ListClubStartersResponse {
    starters: Vec<ClubStarter>,
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
        (status=200, content_type="application/json", body=ListClubStartersResponse),
        (status=404, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
pub async fn list_club_starters(
    Extension(db): Extension<SqlitePool>,
    Query(query): Query<ListClubStartersQuery>,
    auth: Option<Auth>,
) -> Result<Json<ListClubStartersResponse>, HttpError> {
    let club_id = query.club_id;
    let club_starters = sqlx::query_as!(
        ClubStarter,
        r#"
        SELECT
            id as "id!: Uuid",
            club_id as "club_id!: Uuid",
            firstname,
            lastname,
            birthdate,
            sonderpokal,
            single_male,
            single_female,
            pair,
            partner_id as "partner_id: Uuid",
            partner_name
        FROM starter WHERE club_id = ?
        "#,
        club_id
    )
    .fetch_all(&db)
    .await?;
    println!("{:?}", club_starters);
    Ok(Json(ListClubStartersResponse {
        starters: club_starters,
    }))
}
