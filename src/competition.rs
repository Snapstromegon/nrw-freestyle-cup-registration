use time::{Date, OffsetDateTime};

use crate::{config::CompetitionConfig, system_status::StatusOptions};

time::serde::format_description!(iso_date, Date, "[year]-[month]-[day]");

/// Event specific settings, stored in the `competition` table.
#[derive(Debug, Clone, PartialEq, serde::Serialize, utoipa::ToSchema)]
pub struct Competition {
    pub id: String,
    pub name: String,
    pub location: String,
    #[serde(with = "iso_date")]
    pub start_date: Date,
    #[serde(with = "iso_date")]
    pub end_date: Date,
    /// Ages are calculated against this day.
    #[serde(with = "iso_date")]
    pub determining_day: Date,
    #[serde(with = "time::serde::rfc3339")]
    pub registration_start: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub registration_end: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub music_upload_end: OffsetDateTime,
    pub fee_per_start: f64,
    /// Maximum fee per starter; `None` means no cap.
    pub max_fee_per_starter: Option<f64>,
    /// Where the event takes place.
    pub venue: Option<String>,
    /// Contact for clubs, e.g. about overpayments.
    pub contact_email: Option<String>,
    /// Link to the official announcement (Ausschreibung).
    pub announcement_url: Option<String>,
    /// Where the info board's photo QR code leads.
    pub photos_url: Option<String>,
    #[serde(with = "iso_date::option")]
    pub payment_deadline: Option<Date>,
    pub payment_account_holder: Option<String>,
    pub payment_iban: Option<String>,
    pub payment_bic: Option<String>,
    /// Prefix for the transfer reference, followed by the club name.
    pub payment_reference: Option<String>,
}

impl Competition {
    /// Loads the current competition: the one with the latest start date.
    pub async fn current(db: impl sqlx::SqliteExecutor<'_>) -> sqlx::Result<Option<Competition>> {
        sqlx::query_as!(
            Competition,
            r#"
            SELECT
                id as "id!",
                name,
                location,
                start_date as "start_date: Date",
                end_date as "end_date: Date",
                determining_day as "determining_day: Date",
                registration_start as "registration_start: OffsetDateTime",
                registration_end as "registration_end: OffsetDateTime",
                music_upload_end as "music_upload_end: OffsetDateTime",
                fee_per_start,
                max_fee_per_starter,
                venue,
                contact_email,
                announcement_url,
                photos_url,
                payment_deadline as "payment_deadline: Date",
                payment_account_holder,
                payment_iban,
                payment_bic,
                payment_reference
            FROM competition
            ORDER BY start_date DESC
            LIMIT 1
            "#
        )
        .fetch_optional(db)
        .await
    }

    pub fn status_options(&self) -> StatusOptions {
        StatusOptions {
            start_register_date: self.registration_start,
            end_register_date: self.registration_end,
            end_music_upload_date: self.music_upload_end,
        }
    }
}

/// Inserts the competition from the config or updates it if it already exists.
pub async fn upsert_competition(
    db: impl sqlx::SqliteExecutor<'_>,
    config: &CompetitionConfig,
) -> sqlx::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO competition (
            id, name, location, start_date, end_date, determining_day,
            registration_start, registration_end, music_upload_end,
            fee_per_start, max_fee_per_starter, venue, contact_email, announcement_url, photos_url,
            payment_deadline, payment_account_holder, payment_iban, payment_bic, payment_reference
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
            name = excluded.name,
            location = excluded.location,
            start_date = excluded.start_date,
            end_date = excluded.end_date,
            determining_day = excluded.determining_day,
            registration_start = excluded.registration_start,
            registration_end = excluded.registration_end,
            music_upload_end = excluded.music_upload_end,
            fee_per_start = excluded.fee_per_start,
            max_fee_per_starter = excluded.max_fee_per_starter,
            venue = excluded.venue,
            contact_email = excluded.contact_email,
            announcement_url = excluded.announcement_url,
            photos_url = excluded.photos_url,
            payment_deadline = excluded.payment_deadline,
            payment_account_holder = excluded.payment_account_holder,
            payment_iban = excluded.payment_iban,
            payment_bic = excluded.payment_bic,
            payment_reference = excluded.payment_reference
        "#,
        config.id,
        config.name,
        config.location,
        config.start_date,
        config.end_date,
        config.determining_day,
        config.registration_start,
        config.registration_end,
        config.music_upload_end,
        config.fee_per_start,
        config.max_fee_per_starter,
        config.venue,
        config.contact_email,
        config.announcement_url,
        config.photos_url,
        config.payment.deadline,
        config.payment.account_holder,
        config.payment.iban,
        config.payment.bic,
        config.payment.reference,
    )
    .execute(db)
    .await?;
    Ok(())
}
