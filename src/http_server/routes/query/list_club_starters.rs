use axum::{Extension, Json, extract::Query};
use tracing::instrument;
use uuid::Uuid;

use crate::{
    gender::Gender,
    groups::ensure_club_access,
    http_server::{ClientError, HttpError, extractor::auth::Auth},
    reloadable_sqlite::ReloadableSqlite,
};

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct ClubStarter {
    id: Uuid,
    club_id: Uuid,
    firstname: String,
    lastname: String,
    #[serde(with = "time::serde::iso8601")]
    birthdate: time::OffsetDateTime,
    /// Decides whether the single is Einzel weiblich or männlich. Missing for
    /// riders registered before it was asked.
    gender: Option<Gender>,
    single_male: bool,
    single_female: bool,
    pair: bool,
    partner_id: Option<Uuid>,
    partner_name: Option<String>,
    resolved_partner_name: Option<String>,
    resolved_partner_club: Option<String>,
    /// Number of groups the starter is in, as a regular or replacement rider.
    group_count: i64,
    /// Starts whose fee an admin waived after a withdrawal. They count in
    /// the flags and `group_count` above, but cost nothing.
    waived_count: i64,
}

#[derive(Debug, serde::Deserialize, utoipa::IntoParams)]
pub struct ListClubStartersQuery {
    club_id: Uuid,
}

/// List the starters of a club, with their birthdates.
///
/// Only for the club and admins.
#[utoipa::path(
    get,
    tags=["query", "club"],
    params(ListClubStartersQuery),
    path="/list_club_starters",
    responses(
        (status=200, content_type="application/json", body=Vec<ClubStarter>),
        (status=401, content_type="application/json", body=ClientError),
        (status=403, content_type="application/json", body=ClientError),
        (status=404, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
pub async fn list_club_starters(
    Extension(db): Extension<ReloadableSqlite>,
    Query(query): Query<ListClubStartersQuery>,
    auth: Auth,
) -> Result<Json<Vec<ClubStarter>>, HttpError> {
    let db = db.get().await.clone();
    let mut connection = db.acquire().await?;
    let club_id = query.club_id;
    ensure_club_access(&mut connection, &auth, club_id).await?;
    let club_starters = sqlx::query_as!(
        ClubStarter,
        r#"
        SELECT
            starter.id as "id!: Uuid",
            starter.club_id as "club_id!: Uuid",
            starter.firstname,
            starter.lastname,
            starter.birthdate,
            starter.gender as "gender: Gender",
            starter.single_male,
            starter.single_female,
            starter.pair,
            starter.partner_id as "partner_id: Uuid",
            starter.partner_name,
            NULLIF(concat_ws(" ", partner.firstname, partner.lastname), '') as "resolved_partner_name: String",
            partner_club.name as resolved_partner_club,
            (
              SELECT COUNT(*) FROM act_participants
              JOIN acts ON acts.id = act_participants.act_id
              WHERE act_participants.starter_id = starter.id
                AND acts.act_type IN ('group_small', 'group_large')
            ) as "group_count!: i64",
            (
              SELECT COUNT(*) FROM act_participants
              JOIN acts ON acts.id = act_participants.act_id
              WHERE act_participants.starter_id = starter.id
                AND acts.withdrawn_at IS NOT NULL
                AND acts.fee_waived
            ) as "waived_count!: i64"
        FROM starter LEFT JOIN starter as partner ON partner.id = starter.partner_id LEFT JOIN clubs as partner_club ON partner_club.id = partner.club_id
        WHERE starter.club_id = ?
        "#,
        club_id
    )
    .fetch_all(&mut *connection)
    .await?;
    Ok(Json(club_starters))
}
