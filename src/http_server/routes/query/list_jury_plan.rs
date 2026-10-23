use axum::{Extension, Json, extract::Query, http::StatusCode};
use time::OffsetDateTime;
use tracing::instrument;
use uuid::Uuid;

use crate::{
    groups::ensure_club_access,
    http_server::{ClientError, HttpError, extractor::auth::Auth},
    jury::{JudgeTask, JuryAssignment, JuryEnabled},
    reloadable_sqlite::ReloadableSqlite,
};

#[derive(Debug, serde::Deserialize, utoipa::IntoParams)]
pub struct ListJuryPlanQuery {
    /// Only this club's judges. Required for everyone but admins.
    club_id: Option<Uuid>,
}

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct JuryPlan {
    /// When the plan was published; `None` while only admins see it.
    #[serde(with = "time::serde::rfc3339::option")]
    published_at: Option<OffsetDateTime>,
    assignments: Vec<JuryAssignment>,
}

/// The Juryplan. Admins see all of it; a club sees its own judges'
/// assignments once the plan is published.
#[utoipa::path(
    get,
    tags=["query", "jury"],
    path="/list_jury_plan",
    params(ListJuryPlanQuery),
    responses(
        (status=200, content_type="application/json", body=JuryPlan),
        (status=401, content_type="application/json", body=ClientError),
        (status=403, content_type="application/json", body=ClientError),
        (status=404, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
pub async fn list_jury_plan(
    _jury: JuryEnabled,
    Extension(db): Extension<ReloadableSqlite>,
    auth: Auth,
    Query(query): Query<ListJuryPlanQuery>,
) -> Result<Json<JuryPlan>, HttpError> {
    let db = db.get().await.clone();
    let mut conn = db.acquire().await?;
    match query.club_id {
        Some(club_id) => ensure_club_access(&mut conn, &auth, club_id).await?,
        None if auth.is_admin() => {}
        None => return Err(HttpError::StatusCode(StatusCode::FORBIDDEN)),
    }
    let published_at = sqlx::query_scalar!(
        r#"SELECT jury_plan_published_at as "published_at: OffsetDateTime" FROM competition ORDER BY start_date DESC LIMIT 1"#
    )
    .fetch_optional(&mut *conn)
    .await?
    .flatten();
    if published_at.is_none() && !auth.is_admin() {
        return Ok(Json(JuryPlan {
            published_at,
            assignments: vec![],
        }));
    }
    let assignments = sqlx::query_as!(
        JuryAssignment,
        r#"
        SELECT
            jury_assignments.judge_id as "judge_id!: Uuid",
            jury_assignments.jury_category_id as "jury_category_id!: Uuid",
            jury_assignments.task as "task!: JudgeTask"
        FROM jury_assignments
        JOIN judge ON judge.id = jury_assignments.judge_id
        JOIN jury_categories ON jury_categories.id = jury_assignments.jury_category_id
        WHERE ?1 IS NULL OR judge.club_id = ?1
        ORDER BY jury_categories.sort_order, jury_assignments.task, judge.lastname, judge.firstname
        "#,
        query.club_id
    )
    .fetch_all(&mut *conn)
    .await?;
    Ok(Json(JuryPlan {
        published_at,
        assignments,
    }))
}
