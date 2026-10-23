use std::sync::Arc;

use axum::{Extension, Json};
use tracing::instrument;
use uuid::Uuid;

use crate::{
    competition::Competition,
    fees::{AmountDue, fees_by_club},
    http_server::{ClientError, HttpError, HttpServerOptions, extractor::auth::Auth},
    jury::JuryObligation,
    reloadable_sqlite::ReloadableSqlite,
    utils::club_code,
};

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct ClubOverview {
    id: Uuid,
    name: String,
    /// The amount the club has paid so far.
    payment: Option<f64>,
    owner_id: Uuid,
    owner_name: String,
    owner_email: String,
    owner_email_verified: bool,
    /// The Vereinsverantwortliche/r; the owner unless the club named someone
    /// else.
    responsible_name: String,
    responsible_email: String,
    /// Short code for the transfer reference, e.g. "EV-K7Q3"; stays the
    /// same when the club is renamed.
    code: String,
    /// What the club owes.
    amount_due: AmountDue,
    /// The club's jury obligation, while the jury registration is on.
    jury: Option<JuryObligation>,
}

/// List all clubs with their owners. Admin only.
#[utoipa::path(
    get,
    tags=["query", "club"],
    path="/list_clubs",
    responses(
        (status=200, content_type="application/json", body=Vec<ClubOverview>),
        (status=401, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db, http_options))]
pub async fn list_clubs(
    Extension(db): Extension<ReloadableSqlite>,
    Extension(http_options): Extension<Arc<HttpServerOptions>>,
    auth: Auth,
) -> Result<Json<Vec<ClubOverview>>, HttpError> {
    if !auth.is_admin() {
        return Err(HttpError::InvalidCredentials);
    }
    let db = db.get().await.clone();
    let rows = sqlx::query!(
        r#"
        SELECT
            clubs.id as "id!: Uuid",
            clubs.name,
            clubs.payment,
            clubs.owner_id as "owner_id!: Uuid",
            users.name as owner_name,
            users.email as owner_email,
            users.email_verified as owner_email_verified,
            COALESCE(clubs.responsible_name, users.name) as "responsible_name!: String",
            COALESCE(clubs.responsible_email, users.email) as "responsible_email!: String"
        FROM clubs
        JOIN users ON users.id = clubs.owner_id
        ORDER BY clubs.name
        "#
    )
    .fetch_all(&db)
    .await?;
    let competition = Competition::current(&db).await?;
    let mut fees = fees_by_club(&db, competition.as_ref(), http_options.jury_registration).await?;
    let clubs = rows
        .into_iter()
        .map(|row| {
            let club_fees = fees.remove(&row.id).unwrap_or_default();
            ClubOverview {
                code: club_code(&row.id),
                amount_due: club_fees.amount_due,
                jury: club_fees.jury,
                id: row.id,
                name: row.name,
                payment: row.payment,
                owner_id: row.owner_id,
                owner_name: row.owner_name,
                owner_email: row.owner_email,
                owner_email_verified: row.owner_email_verified,
                responsible_name: row.responsible_name,
                responsible_email: row.responsible_email,
            }
        })
        .collect();
    Ok(Json(clubs))
}
