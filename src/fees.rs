//! What clubs owe: start fees now, the jury fee later (#229).
//!
//! The one place the fee rule lives in the backend; the club queries, the
//! payment QR code (through them) and `/metrics` all use it.

use std::collections::HashMap;

use uuid::Uuid;

use crate::competition::Competition;

/// What a club owes, split into its parts.
#[derive(Debug, Clone, Copy, Default, PartialEq, serde::Serialize, utoipa::ToSchema)]
pub struct AmountDue {
    /// `fee_per_start` per start, at most `max_fee_per_starter` per starter.
    pub start_fees: f64,
    /// For missing jury deployments; 0 until the jury registration exists.
    pub jury_fee: f64,
    pub total: f64,
}

/// The amount due of every club that has starters. Clubs without starters
/// owe nothing and are missing from the map.
pub async fn amount_due_by_club(
    db: &sqlx::SqlitePool,
    competition: Option<&Competition>,
) -> sqlx::Result<HashMap<Uuid, AmountDue>> {
    amount_due(db, competition, None).await
}

/// The amount due of one club.
pub async fn amount_due_of_club(
    db: &sqlx::SqlitePool,
    competition: Option<&Competition>,
    club_id: Uuid,
) -> sqlx::Result<AmountDue> {
    Ok(amount_due(db, competition, Some(club_id))
        .await?
        .remove(&club_id)
        .unwrap_or_default())
}

/// The amount due per club, of all clubs or only of `club_id`.
async fn amount_due(
    db: &sqlx::SqlitePool,
    competition: Option<&Competition>,
    club_id: Option<Uuid>,
) -> sqlx::Result<HashMap<Uuid, AmountDue>> {
    Ok(start_fees_by_club(db, competition, club_id)
        .await?
        .into_iter()
        .map(|(club_id, start_fees)| {
            let jury_fee = 0.0;
            let amount = AmountDue {
                start_fees,
                jury_fee,
                total: start_fees + jury_fee,
            };
            (club_id, amount)
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
