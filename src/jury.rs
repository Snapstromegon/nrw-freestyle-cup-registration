//! The jury registration (#225): clubs register their judges (JurorInnen)
//! for admin-defined jury categories, admins check each club's jury
//! obligation and plan the jury. Everything is behind the
//! `[features] jury_registration` flag.

use std::sync::Arc;

use axum::{extract::FromRequestParts, http::request::Parts};
use time::Date;
use uuid::Uuid;

use crate::{
    competition::Competition,
    http_server::{HttpError, HttpServerOptions},
};

time::serde::format_description!(iso_date, Date, "[year]-[month]-[day]");

/// Guard for every jury endpoint: they don't exist (404) while the feature
/// flag is off.
#[derive(Debug)]
pub struct JuryEnabled;

impl<S: Send + Sync> FromRequestParts<S> for JuryEnabled {
    type Rejection = HttpError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let enabled = parts
            .extensions
            .get::<Arc<HttpServerOptions>>()
            .is_some_and(|options| options.jury_registration);
        if enabled {
            Ok(JuryEnabled)
        } else {
            Err(HttpError::NotFound)
        }
    }
}

/// What judges register for and get assigned to, e.g. one heat block.
#[derive(Debug, Clone, serde::Serialize, utoipa::ToSchema)]
pub struct JuryCategory {
    pub id: Uuid,
    pub name: String,
    /// Jury deployments (Einsätze) it counts for: a heat 2, a final 1.
    pub deployments: i64,
    /// The day it runs, if known.
    #[serde(with = "iso_date::option")]
    #[schema(value_type = Option<String>, format = Date)]
    pub day: Option<Date>,
    pub sort_order: i64,
    /// Judges it needs per role.
    pub needed_technical: i64,
    pub needed_performance: i64,
    pub needed_dismounts: i64,
}

/// What admins set for a jury category.
#[derive(Debug, Clone, serde::Deserialize, utoipa::ToSchema)]
pub struct JuryCategoryFields {
    pub name: String,
    pub deployments: i64,
    #[serde(default, deserialize_with = "optional_date")]
    #[schema(value_type = Option<String>, format = Date)]
    pub day: Option<Date>,
    pub needed_technical: i64,
    pub needed_performance: i64,
    pub needed_dismounts: i64,
}

/// An optional "YYYY-MM-DD" date. Unlike `iso_date::option`, this also works
/// inside `#[serde(flatten)]`, which hands `null` over as a unit value.
fn optional_date<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Date>, D::Error> {
    use serde::{Deserialize, de::Error};
    Option::<String>::deserialize(deserializer)?
        .map(|day| {
            Date::parse(
                &day,
                time::macros::format_description!("[year]-[month]-[day]"),
            )
            .map_err(D::Error::custom)
        })
        .transpose()
}

impl JuryCategoryFields {
    /// Trims the name and checks the numbers and that the day is within the
    /// event. The message is German.
    pub fn normalize(mut self, competition: Option<&Competition>) -> Result<Self, String> {
        self.name = self.name.trim().to_string();
        if self.name.is_empty() {
            return Err("Die Jury-Kategorie braucht einen Namen.".to_string());
        }
        if [
            self.deployments,
            self.needed_technical,
            self.needed_performance,
            self.needed_dismounts,
        ]
        .iter()
        .any(|n| *n < 0)
        {
            return Err("Einsätze und benötigte JurorInnen dürfen nicht negativ sein.".to_string());
        }
        if let (Some(day), Some(competition)) = (self.day, competition)
            && (day < competition.start_date || day > competition.end_date)
        {
            return Err(format!(
                "Der Tag muss zwischen {} und {} liegen.",
                competition.start_date, competition.end_date
            ));
        }
        Ok(self)
    }
}

/// Loads the jury categories in their order.
pub async fn list_categories(db: impl sqlx::SqliteExecutor<'_>) -> sqlx::Result<Vec<JuryCategory>> {
    sqlx::query_as!(
        JuryCategory,
        r#"
        SELECT
            id as "id!: Uuid",
            name,
            deployments,
            day as "day: Date",
            sort_order,
            needed_technical,
            needed_performance,
            needed_dismounts
        FROM jury_categories
        ORDER BY sort_order, name
        "#
    )
    .fetch_all(db)
    .await
}

/// Inserts a jury category at the end of the order and returns its id. A
/// duplicate name is refused with a German message.
pub async fn insert_category(
    conn: &mut sqlx::SqliteConnection,
    fields: &JuryCategoryFields,
) -> Result<Uuid, HttpError> {
    let id = Uuid::new_v4();
    let result = sqlx::query!(
        r#"
        INSERT INTO jury_categories (
            id, name, deployments, day, sort_order,
            needed_technical, needed_performance, needed_dismounts
        ) VALUES (
            ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM jury_categories),
            ?, ?, ?
        )
        "#,
        id,
        fields.name,
        fields.deployments,
        fields.day,
        fields.needed_technical,
        fields.needed_performance,
        fields.needed_dismounts,
    )
    .execute(&mut *conn)
    .await;
    match result {
        Ok(_) => Ok(id),
        Err(e) if is_unique_violation(&e) => Err(duplicate_name(&fields.name)),
        Err(e) => Err(e.into()),
    }
}

pub(crate) fn is_unique_violation(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .is_some_and(|e| e.is_unique_violation())
}

pub(crate) fn duplicate_name(name: &str) -> HttpError {
    HttpError::ErrorMessages(format!("Die Jury-Kategorie „{name}“ gibt es schon."))
}
