use std::sync::Arc;

use axum::{Extension, Json};
use tracing::instrument;
use uuid::Uuid;

use crate::{
    competition::Competition,
    fees::{AmountDue, fees_by_club},
    http_server::{ClientError, HttpError, HttpServerOptions, extractor::auth::Granted},
    jury::JuryObligation,
    reloadable_sqlite::ReloadableSqlite,
    roles::permit,
    utils::club_code,
};

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct ClubOverview {
    id: Uuid,
    name: String,
    /// The amount the club has paid so far; only with club balances.
    payment: Option<f64>,
    owner_id: Uuid,
    /// The club contact; only with club contacts.
    owner_name: Option<String>,
    owner_email: Option<String>,
    owner_email_verified: Option<bool>,
    /// The Vereinsverantwortliche/r; the owner unless the club named someone
    /// else. Only with club contacts.
    responsible_name: Option<String>,
    responsible_email: Option<String>,
    /// Short code for the transfer reference, e.g. "EV-K7Q3"; stays the
    /// same when the club is renamed.
    code: String,
    /// What the club owes; only with club balances.
    amount_due: Option<AmountDue>,
    /// The club's jury obligation, while the jury registration is on; only
    /// with club balances or for the jury lead.
    jury: Option<JuryObligation>,
}

/// List all clubs; their balances and contacts only with the permission to
/// see them.
#[utoipa::path(
    get,
    tags=["query", "club"],
    path="/list_clubs",
    responses(
        (status=200, content_type="application/json", body=Vec<ClubOverview>),
        (status=401, content_type="application/json", body=ClientError),
        (status=403, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db, http_options))]
pub async fn list_clubs(
    Extension(db): Extension<ReloadableSqlite>,
    Extension(http_options): Extension<Arc<HttpServerOptions>>,
    _: Granted<permit::ViewClubs>,
    balances: Option<Granted<permit::ViewClubBalances>>,
    contacts: Option<Granted<permit::ViewClubContacts>>,
    jury: Option<Granted<permit::ManageJury>>,
) -> Result<Json<Vec<ClubOverview>>, HttpError> {
    let (balances, contacts) = (balances.is_some(), contacts.is_some());
    let jury = balances || jury.is_some();
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
                amount_due: Some(club_fees.amount_due).filter(|_| balances),
                jury: club_fees.jury.filter(|_| jury),
                id: row.id,
                name: row.name,
                payment: row.payment.filter(|_| balances),
                owner_id: row.owner_id,
                owner_name: Some(row.owner_name).filter(|_| contacts),
                owner_email: Some(row.owner_email).filter(|_| contacts),
                owner_email_verified: Some(row.owner_email_verified).filter(|_| contacts),
                responsible_name: Some(row.responsible_name).filter(|_| contacts),
                responsible_email: Some(row.responsible_email).filter(|_| contacts),
            }
        })
        .collect();
    Ok(Json(clubs))
}
