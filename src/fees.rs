//! What clubs owe: start fees and the fee for missing jury deployments.
//!
//! The one place the fee rules live in the backend; the club queries, the
//! payment QR code (through them) and `/metrics` all use it.

use std::collections::HashMap;

use uuid::Uuid;

use crate::{
    competition::Competition,
    jury::{self, JuryObligation},
};

/// What a club owes, split into its parts.
#[derive(Debug, Clone, Copy, Default, PartialEq, serde::Serialize, utoipa::ToSchema)]
pub struct AmountDue {
    /// `fee_per_start` per start, at most `max_fee_per_starter` per starter.
    pub start_fees: f64,
    /// For missing jury deployments; 0 without the jury registration.
    pub jury_fee: f64,
    pub total: f64,
}

/// What a club owes and, with the jury registration, its jury obligation.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct ClubFees {
    pub amount_due: AmountDue,
    pub jury: Option<JuryObligation>,
}

/// The fees of every club. Clubs without starters and jury obligation owe
/// nothing and may be missing from the map.
pub async fn fees_by_club(
    db: &sqlx::SqlitePool,
    competition: Option<&Competition>,
    jury_registration: bool,
) -> sqlx::Result<HashMap<Uuid, ClubFees>> {
    fees(db, competition, jury_registration, None).await
}

/// The fees of one club.
pub async fn fees_of_club(
    db: &sqlx::SqlitePool,
    competition: Option<&Competition>,
    jury_registration: bool,
    club_id: Uuid,
) -> sqlx::Result<ClubFees> {
    Ok(fees(db, competition, jury_registration, Some(club_id))
        .await?
        .remove(&club_id)
        .unwrap_or_default())
}

/// The fees per club, of all clubs or only of `club_id`. The jury fee only
/// applies while the jury registration is on and the competition has jury
/// rules.
async fn fees(
    db: &sqlx::SqlitePool,
    competition: Option<&Competition>,
    jury_registration: bool,
    club_id: Option<Uuid>,
) -> sqlx::Result<HashMap<Uuid, ClubFees>> {
    let start_fees = start_fees_by_club(db, competition, club_id).await?;
    let obligations = match competition.and_then(|c| c.jury.as_ref()) {
        Some(rules) if jury_registration => {
            let mut conn = db.acquire().await?;
            jury::obligations(&mut conn, rules, club_id).await?
        }
        _ => HashMap::new(),
    };
    let clubs: std::collections::HashSet<Uuid> = start_fees
        .keys()
        .chain(obligations.keys())
        .copied()
        .collect();
    Ok(clubs
        .into_iter()
        .map(|id| {
            let start_fees = start_fees.get(&id).copied().unwrap_or(0.0);
            let jury = obligations.get(&id).copied();
            let jury_fee = jury.map_or(0.0, |jury| jury.fee);
            let fees = ClubFees {
                amount_due: AmountDue {
                    start_fees,
                    jury_fee,
                    total: start_fees + jury_fee,
                },
                jury,
            };
            (id, fees)
        })
        .collect())
}

/// Start fees per club. Each single, pair and group start counts, except
/// withdrawn acts whose fee an admin waived; the starter's club pays. The
/// same rule as `getStarterPrice` in the frontend, which still prices single
/// starters in the forms.
async fn start_fees_by_club(
    db: &sqlx::SqlitePool,
    competition: Option<&Competition>,
    club_id: Option<Uuid>,
) -> sqlx::Result<HashMap<Uuid, f64>> {
    let Some(competition) = competition else {
        return Ok(HashMap::new());
    };
    let starters = sqlx::query!(
        r#"
        SELECT
            starter.club_id as "club_id!: Uuid",
            MAX(
                0,
                starter.single_male + starter.single_female + starter.pair
                + (
                    SELECT COUNT(*) FROM act_participants
                    JOIN acts ON acts.id = act_participants.act_id
                    WHERE act_participants.starter_id = starter.id
                        AND acts.act_type IN ('group_small', 'group_large')
                )
                - (
                    SELECT COUNT(*) FROM act_participants
                    JOIN acts ON acts.id = act_participants.act_id
                    WHERE act_participants.starter_id = starter.id
                        AND acts.withdrawn_at IS NOT NULL AND acts.fee_waived
                )
            ) as "starts!: i64"
        FROM starter
        WHERE ?1 IS NULL OR starter.club_id = ?1
        "#,
        club_id
    )
    .fetch_all(db)
    .await?;
    let mut fees = HashMap::new();
    for starter in starters {
        let fee = starter.starts as f64 * competition.fee_per_start;
        let fee = competition
            .max_fee_per_starter
            .map_or(fee, |max| fee.min(max));
        *fees.entry(starter.club_id).or_insert(0.0) += fee;
    }
    Ok(fees)
}
