use axum::{Extension, Json, extract::Query};
use tracing::instrument;
use uuid::Uuid;

use crate::{
    http_server::{ClientError, HttpError, extractor::auth::Auth},
    reloadable_sqlite::ReloadableSqlite,
};

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct ClubJudge {
    id: Uuid,
    club_id: Uuid,
    firstname: String,
    lastname: String,
    mail: String,
    #[serde(with = "time::serde::iso8601")]
    birthdate: time::OffsetDateTime,
    n_ew_u15_p: bool,
    n_ew_u15_p_hosp: bool,
    n_ew_u15_t: bool,
    n_ew_u15_t_hosp: bool,
    n_ew_u15_a: bool,
    n_ew_u15_a_hosp: bool,
    n_ew_o15_p: bool,
    n_ew_o15_p_hosp: bool,
    n_ew_o15_t: bool,
    n_ew_o15_t_hosp: bool,
    n_ew_o15_a: bool,
    n_ew_o15_a_hosp: bool,
    n_em_u15_p: bool,
    n_em_u15_p_hosp: bool,
    n_em_u15_t: bool,
    n_em_u15_t_hosp: bool,
    n_em_u15_a: bool,
    n_em_u15_a_hosp: bool,
    n_em_o15_p: bool,
    n_em_o15_p_hosp: bool,
    n_em_o15_t: bool,
    n_em_o15_t_hosp: bool,
    n_em_o15_a: bool,
    n_em_o15_a_hosp: bool,
    n_p_u15_p: bool,
    n_p_u15_p_hosp: bool,
    n_p_u15_t: bool,
    n_p_u15_t_hosp: bool,
    n_p_u15_a: bool,
    n_p_u15_a_hosp: bool,
    n_p_o15_p: bool,
    n_p_o15_p_hosp: bool,
    n_p_o15_t: bool,
    n_p_o15_t_hosp: bool,
    n_p_o15_a: bool,
    n_p_o15_a_hosp: bool,
    s_e_u15_p: bool,
    s_e_u15_p_hosp: bool,
    s_e_u15_t: bool,
    s_e_u15_t_hosp: bool,
    s_e_u15_a: bool,
    s_e_u15_a_hosp: bool,
    s_e_o15_p: bool,
    s_e_o15_p_hosp: bool,
    s_e_o15_t: bool,
    s_e_o15_t_hosp: bool,
    s_e_o15_a: bool,
    s_e_o15_a_hosp: bool,
    s_p_u15_p: bool,
    s_p_u15_p_hosp: bool,
    s_p_u15_t: bool,
    s_p_u15_t_hosp: bool,
    s_p_u15_a: bool,
    s_p_u15_a_hosp: bool,
    s_p_o15_p: bool,
    s_p_o15_p_hosp: bool,
    s_p_o15_t: bool,
    s_p_o15_t_hosp: bool,
    s_p_o15_a: bool,
    s_p_o15_a_hosp: bool,
}

#[derive(Debug, serde::Deserialize, utoipa::IntoParams)]
pub struct ListClubJudgesQuery {
    club_id: Uuid,
}

/// Get information about a club.
#[utoipa::path(
    get,
    tags=["query", "judge"],
    params(ListClubJudgesQuery),
    path="/list_club_judges",
    responses(
        (status=200, content_type="application/json", body=Vec<ClubJudge>),
        (status=404, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
pub async fn list_club_judges(
    Extension(db): Extension<ReloadableSqlite>,
    Query(query): Query<ListClubJudgesQuery>,
    auth: Option<Auth>,
) -> Result<Json<Vec<ClubJudge>>, HttpError> {
    let db = db.get().await.clone();
    let club_id = query.club_id;
    let club_judges = sqlx::query_as!(
        ClubJudge,
        r#"
        SELECT
            id as "id!: Uuid",
            club_id as "club_id!: Uuid",
            firstname,
            lastname,
            mail,
            birthdate,
            n_ew_u15_p,
            n_ew_u15_p_hosp,
            n_ew_u15_t,
            n_ew_u15_t_hosp,
            n_ew_u15_a,
            n_ew_u15_a_hosp,
            n_ew_o15_p,
            n_ew_o15_p_hosp,
            n_ew_o15_t,
            n_ew_o15_t_hosp,
            n_ew_o15_a,
            n_ew_o15_a_hosp,
            n_em_u15_p,
            n_em_u15_p_hosp,
            n_em_u15_t,
            n_em_u15_t_hosp,
            n_em_u15_a,
            n_em_u15_a_hosp,
            n_em_o15_p,
            n_em_o15_p_hosp,
            n_em_o15_t,
            n_em_o15_t_hosp,
            n_em_o15_a,
            n_em_o15_a_hosp,
            n_p_u15_p,
            n_p_u15_p_hosp,
            n_p_u15_t,
            n_p_u15_t_hosp,
            n_p_u15_a,
            n_p_u15_a_hosp,
            n_p_o15_p,
            n_p_o15_p_hosp,
            n_p_o15_t,
            n_p_o15_t_hosp,
            n_p_o15_a,
            n_p_o15_a_hosp,
            s_e_u15_p,
            s_e_u15_p_hosp,
            s_e_u15_t,
            s_e_u15_t_hosp,
            s_e_u15_a,
            s_e_u15_a_hosp,
            s_e_o15_p,
            s_e_o15_p_hosp,
            s_e_o15_t,
            s_e_o15_t_hosp,
            s_e_o15_a,
            s_e_o15_a_hosp,
            s_p_u15_p,
            s_p_u15_p_hosp,
            s_p_u15_t,
            s_p_u15_t_hosp,
            s_p_u15_a,
            s_p_u15_a_hosp,
            s_p_o15_p,
            s_p_o15_p_hosp,
            s_p_o15_t,
            s_p_o15_t_hosp,
            s_p_o15_a,
            s_p_o15_a_hosp
        FROM judge WHERE club_id = ?
        "#,
        club_id
    )
    .fetch_all(&db)
    .await?;
    Ok(Json(club_judges))
}
