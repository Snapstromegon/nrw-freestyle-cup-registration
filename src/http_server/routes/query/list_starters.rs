use axum::{Extension, Json};
use tracing::instrument;
use uuid::Uuid;

use crate::{
    http_server::{ClientError, HttpError, extractor::auth::Auth},
    reloadable_sqlite::ReloadableSqlite,
};

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct Starter {
    id: Uuid,
    club_id: Uuid,
    club_name: String,
    firstname: String,
    lastname: String,
    #[serde(with = "time::serde::iso8601")]
    birthdate: time::OffsetDateTime,
    single_male: bool,
    single_female: bool,
    pair: bool,
    partner_id: Option<Uuid>,
    partner_name: Option<String>,
    resolved_partner_name: Option<String>,
    resolved_partner_club: Option<String>,
    age_on_competition: f64,
    /// When the starter checked in on competition day.
    #[serde(with = "time::serde::iso8601::option")]
    checked_in_at: Option<time::OffsetDateTime>,
    /// Number of groups the starter is in, as a regular or replacement rider.
    group_count: i64,
    /// Starts whose fee an admin waived after a withdrawal. They count in
    /// the flags and `group_count` above, but cost nothing.
    waived_count: i64,
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
    Extension(db): Extension<ReloadableSqlite>,
    auth: Option<Auth>,
) -> Result<Json<Vec<Starter>>, HttpError> {
    auth.ok_or(HttpError::InvalidCredentials).map(|auth| {
        if auth.is_admin() {
            Ok(())
        } else {
            Err(HttpError::InvalidCredentials)
        }
    })??;
    let db = db.get().await.clone();
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
            ) as "age_on_competition!: f64",
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
    .await?;
    Ok(Json(club_starters))
}
