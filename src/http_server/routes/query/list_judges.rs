use axum::{Extension, Json};
use tracing::instrument;
use uuid::Uuid;

use crate::{
    http_server::{ClientError, HttpError, extractor::auth::Auth},
    reloadable_sqlite::ReloadableSqlite,
};

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct Judge {
    id: Uuid,
    club_id: Uuid,
    club_name: String,
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

/// Get information about a club.
#[utoipa::path(
    get,
    tags=["query"],
    path="/list_judges",
    responses(
        (status=200, content_type="application/json", body=Vec<Judge>),
        (status=404, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
pub async fn list_judges(
    Extension(db): Extension<ReloadableSqlite>,
    auth: Option<Auth>,
) -> Result<Json<Vec<Judge>>, HttpError> {
    auth.ok_or(HttpError::InvalidCredentials).map(|auth| {
        if auth.is_admin() {
            Ok(())
        } else {
            Err(HttpError::InvalidCredentials)
        }
    })??;
    let db = db.get().await.clone();
    let club_judges = sqlx::query_as!(
        Judge,
        r#"
        SELECT
            judge.id as "id!: Uuid",
            club_id as "club_id!: Uuid",
            club.name as "club_name!",
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
        FROM judge JOIN clubs as club ON club.id = judge.club_id
        "#
    )
    .fetch_all(&db)
    .await?;
    Ok(Json(club_judges))
}
