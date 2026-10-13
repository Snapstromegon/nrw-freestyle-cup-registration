use std::collections::HashMap;

use axum::Extension;
use time::format_description::StaticFormatDescription;
use tracing::instrument;
use uuid::Uuid;

use crate::{
    act_type::ActType,
    http_server::{
        ClientError, HttpError,
        routes::{
            http_types::ActParticipant,
            query::predict_timeplan::{TimeplanEntry, predict},
        },
    },
    reloadable_sqlite::ReloadableSqlite,
};

static TIME_FORMAT: StaticFormatDescription =
    time::macros::format_description!("[year]-[month]-[day] [hour]:[minute]");

/// Makes user-entered text (act titles, group names, …) safe for one field of
/// the ';'-separated export, which is written without quoting: ';' would start
/// a new column and a line break a new row. A leading '=', '+', '-' or '@'
/// would make spreadsheets read the field as a formula, so it gets a '\''.
fn csv_field(value: &str) -> String {
    let value = value.replace(';', ",").replace(['\r', '\n'], " ");
    if value.starts_with(['=', '+', '-', '@']) {
        format!("'{value}")
    } else {
        value
    }
}

/// The startlist as CSV, one section per timeplan entry.
#[utoipa::path(
    get,
    tags=["query", "timeplan"],
    path="/get_startlist_csv",
    responses(
        (status=200, content_type="application/json", body=String),
        (status=404, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
pub async fn get_startlist_csv(
    Extension(db): Extension<ReloadableSqlite>,
) -> Result<String, HttpError> {
    let db = db.get().await.clone();
    let timeplan = predict(&db).await?;
    let details: HashMap<Uuid, _> = sqlx::query!(
        r#"
        SELECT
            id as "id!: Uuid",
            act_type as "act_type!: ActType",
            group_name,
            participants as "participants!: sqlx::types::Json<Vec<ActParticipant>>"
        FROM view_act
        WHERE category IS NOT NULL
        "#
    )
    .fetch_all(&db)
    .await?
    .into_iter()
    .map(|act| (act.id, act))
    .collect();

    let mut csv = String::new();

    csv.push_str("Wettbewerb;Anzahl Fahrer;Startnummer/PK;Land;Kürtitel;Name;Verein;Startzeit\n");

    let mut counter = 1;
    for entry in timeplan.items {
        match entry.timeplan_entry {
            TimeplanEntry::Category {
                description, acts, ..
            } => {
                // Empty blocks are skipped, so they get no header either.
                if acts.is_empty() {
                    continue;
                }
                csv.push_str(&format!(
                    "# {} {}\n",
                    entry
                        .predicted_start
                        .to_offset(time::UtcOffset::from_hms(1, 0, 0).expect("Invalid Offset"))
                        .format(&TIME_FORMAT)
                        .unwrap(),
                    csv_field(&description)
                ));
                for timeplan_act in acts {
                    let Some(act) = details.get(&timeplan_act.id) else {
                        continue;
                    };
                    // Groups are listed by their name instead of all riders.
                    let names = match &act.group_name {
                        Some(group_name) => group_name.clone(),
                        None => act
                            .participants
                            .iter()
                            .map(|p| format!("{} {}", p.firstname, p.lastname))
                            .collect::<Vec<String>>()
                            .join(" & "),
                    };
                    let mut clubs: Vec<&str> = vec![];
                    for participant in act.participants.iter() {
                        if !clubs.contains(&participant.club_name.as_str()) {
                            clubs.push(&participant.club_name);
                        }
                    }
                    // Replacement riders don't count as starting riders.
                    let rider_count = act
                        .participants
                        .iter()
                        .filter(|p| !p.is_replacement)
                        .count();
                    csv.push_str(&format!(
                        "{};{};{};{};{};{};{};{}\n",
                        csv_field(&description),
                        rider_count,
                        counter,
                        "Deutschland",
                        csv_field(&timeplan_act.name),
                        csv_field(&names),
                        csv_field(&clubs.join(" & ")),
                        timeplan_act
                            .predicted_start
                            .to_offset(time::UtcOffset::from_hms(1, 0, 0).expect("Invalid Offset"))
                            .format(&TIME_FORMAT)
                            .unwrap()
                    ));
                    counter += 1;
                }
            }
            TimeplanEntry::Custom { label, .. } => {
                csv.push_str(&format!(
                    "# {} {}\n",
                    entry
                        .predicted_start
                        .to_offset(time::UtcOffset::from_hms(1, 0, 0).expect("Invalid Offset"))
                        .format(&TIME_FORMAT)
                        .unwrap(),
                    csv_field(&label)
                ));
            }
        }
    }

    Ok(csv)
}

#[cfg(test)]
mod tests {
    use super::csv_field;

    #[test]
    fn csv_fields_stay_one_field_and_are_no_formulas() {
        assert_eq!(csv_field("Wind;Wetter"), "Wind,Wetter");
        assert_eq!(csv_field("Zeile\r\nZwei"), "Zeile  Zwei");
        assert_eq!(csv_field("=HYPERLINK(1)"), "'=HYPERLINK(1)");
        assert_eq!(csv_field("-1"), "'-1");
        assert_eq!(csv_field("Anna & Berta"), "Anna & Berta");
        assert_eq!(csv_field("Einzel U15 - weiblich"), "Einzel U15 - weiblich");
    }
}
