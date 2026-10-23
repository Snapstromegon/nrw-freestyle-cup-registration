use axum::{Extension, Json};
use tracing::instrument;
use uuid::Uuid;

use crate::{
    gender::Gender,
    http_server::{ClientError, HttpError, extractor::auth::Granted},
    reloadable_sqlite::ReloadableSqlite,
    roles::permit,
};

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct Starter {
    id: Uuid,
    club_id: Uuid,
    club_name: String,
    firstname: String,
    lastname: String,
    /// Only for who may see birthdates.
    #[serde(with = "time::serde::iso8601::option")]
    birthdate: Option<time::OffsetDateTime>,
    gender: Option<Gender>,
    single_male: bool,
    single_female: bool,
    pair: bool,
    partner_id: Option<Uuid>,
    partner_name: Option<String>,
    resolved_partner_name: Option<String>,
    resolved_partner_club: Option<String>,
    /// On the determining day; only for who may see birthdates.
    age_on_competition: Option<f64>,
    /// When the starter checked in on competition day.
    #[serde(with = "time::serde::iso8601::option")]
    checked_in_at: Option<time::OffsetDateTime>,
    /// Number of groups the starter is in, as a regular or replacement rider.
    group_count: i64,
    /// Starts whose fee an admin waived after a withdrawal. They count in
    /// the flags and `group_count` above, but cost nothing.
    waived_count: i64,
}

/// Every rider with their club and starts; birthdates and ages only for
/// who may see them.
#[utoipa::path(
    get,
    tags=["query"],
    path="/list_starters",
    responses(
        (status=200, content_type="application/json", body=Vec<Starter>),
        (status=401, content_type="application/json", body=ClientError),
        (status=403, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
pub async fn list_starters(
    Extension(db): Extension<ReloadableSqlite>,
    _: Granted<permit::ViewRiders>,
    birthdates: Option<Granted<permit::ViewBirthdates>>,
) -> Result<Json<Vec<Starter>>, HttpError> {
    let db = db.get().await.clone();
    let club_starters: Vec<Starter> = sqlx::query_as!(
        Starter,
        r#"
        SELECT
            starter.id as "id!: Uuid",
            starter.club_id as "club_id!: Uuid",
            club.name as "club_name!",
            starter.firstname,
            starter.lastname,
            starter.birthdate as "birthdate: time::OffsetDateTime",
            starter.gender as "gender: Gender",
            starter.single_male,
            starter.single_female,
            starter.pair,
            starter.partner_id as "partner_id: Uuid",
            starter.partner_name,
            NULLIF(concat_ws(" ", partner.firstname, partner.lastname), '') as "resolved_partner_name: String",
            partner_club.name as resolved_partner_club,
            COALESCE(
              (
                julianday((SELECT determining_day FROM competition ORDER BY start_date DESC LIMIT 1))
                - julianday(starter.birthdate)
              ) / 365.2425,
              0.0
            ) as "age_on_competition: f64",
            starter.checked_in_at as "checked_in_at: time::OffsetDateTime",
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
        FROM starter
          LEFT JOIN clubs as club ON club.id = starter.club_id
          LEFT JOIN starter as partner ON partner.id = starter.partner_id
          LEFT JOIN clubs as partner_club ON partner_club.id = partner.club_id
        "#
    )
    .fetch_all(&db)
    .await?
    .into_iter()
    .map(|starter| {
        if birthdates.is_some() {
            starter
        } else {
            Starter {
                birthdate: None,
                age_on_competition: None,
                ..starter
            }
        }
    })
    .collect();
    Ok(Json(club_starters))
}
