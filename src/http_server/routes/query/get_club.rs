use axum::{Extension, Json, extract::Query};
use tracing::instrument;
use uuid::Uuid;

use crate::{
    competition::Competition,
    fees::{AmountDue, amount_due_of_club},
    http_server::{ClientError, HttpError, extractor::auth::Auth},
    reloadable_sqlite::ReloadableSqlite,
    utils::club_code,
};

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct Club {
    id: Uuid,
    name: String,
    owner_id: Uuid,
    payment: Option<f64>,
    /// Short code for the transfer reference, e.g. "EV-K7Q3"; stays the
    /// same when the club is renamed.
    code: String,
    /// The user who registered the club. Only for the club itself and
    /// admins.
    owner_name: Option<String>,
    owner_email: Option<String>,
    /// The Vereinsverantwortliche/r, who files objections; the owner unless
    /// the club named someone else. Only for the club itself and admins.
    responsible_name: Option<String>,
    responsible_email: Option<String>,
    /// What the club owes. Only for the club itself and admins.
    amount_due: Option<AmountDue>,
}

#[derive(Debug, serde::Deserialize, utoipa::IntoParams)]
pub struct GetClubQuery {
    club_id: Option<Uuid>,
}

/// Get information about a club. The owner's and the Vereinsverantwortliche's
/// name and email address are only included for the club itself and admins.
#[utoipa::path(
    get,
    tags=["query", "club"],
    path="/get_club",
    params(GetClubQuery),
    responses(
        (status=200, content_type="application/json", body=Club),
        (status=404, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
pub async fn get_club(
    Extension(db): Extension<ReloadableSqlite>,
    Query(query): Query<GetClubQuery>,
    auth: Option<Auth>,
) -> Result<Json<Club>, HttpError> {
    let db = db.get().await.clone();
    let mut club_id = query.club_id;
    if let Some(auth) = &auth
        && club_id.is_none()
    {
        club_id = auth.club_id;
    }
    if let Some(club_id) = club_id {
        let row = sqlx::query!(
            r#"
        SELECT
            clubs.id as "id!: Uuid",
            clubs.name,
            clubs.owner_id as "owner_id: Uuid",
            clubs.payment,
            users.name as "owner_name?: String",
            users.email as "owner_email?: String",
            COALESCE(clubs.responsible_name, users.name) as "responsible_name?: String",
            COALESCE(clubs.responsible_email, users.email) as "responsible_email?: String"
        FROM clubs LEFT JOIN users ON users.id = clubs.owner_id
        WHERE clubs.id = ?
        "#,
            club_id
        )
        .fetch_one(&db)
        .await?;
        let may_see_owner = auth
            .as_ref()
            .is_some_and(|auth| auth.is_admin() || auth.club_id == Some(row.id));
        let mut club = Club {
            id: row.id,
            name: row.name,
            owner_id: row.owner_id,
            payment: row.payment,
            code: club_code(&row.id),
            owner_name: row.owner_name,
            owner_email: row.owner_email,
            responsible_name: row.responsible_name,
            responsible_email: row.responsible_email,
            amount_due: None,
        };
        if may_see_owner {
            let competition = Competition::current(&db).await?;
            club.amount_due = Some(amount_due_of_club(&db, competition.as_ref(), club.id).await?);
        } else {
            club.owner_name = None;
            club.owner_email = None;
            club.responsible_name = None;
            club.responsible_email = None;
        }
        Ok(Json(club))
    } else {
        Err(HttpError::NotFound)
    }
}
