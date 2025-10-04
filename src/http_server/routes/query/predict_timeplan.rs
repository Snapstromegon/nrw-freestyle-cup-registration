use axum::{Extension, Json};
use tracing::{info, instrument};
use uuid::Uuid;

use crate::{
    http_server::{ClientError, HttpError},
    reloadable_sqlite::ReloadableSqlite,
};

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct TimeplanAct {
    status: TimeplanItemStatus,
    id: Uuid,
    name: String,
    #[serde(with = "time::serde::iso8601::option")]
    started_at: Option<time::OffsetDateTime>,
    #[serde(with = "time::serde::iso8601::option")]
    ended_at: Option<time::OffsetDateTime>,
    #[serde(with = "time::serde::iso8601")]
    predicted_start: time::OffsetDateTime,
    #[serde(with = "time::serde::iso8601")]
    predicted_end: time::OffsetDateTime,
    #[serde(with = "time::serde::iso8601")]
    planned_start: time::OffsetDateTime,
    #[serde(with = "time::serde::iso8601")]
    planned_end: time::OffsetDateTime,
}

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub enum TimeplanEntry {
    Category {
        name: String,
        description: String,
        duration_seconds: i64,
        order: i64,
        einfahrzeit_seconds: i64,
        act_duration_seconds: i64,
        judge_duration_seconds: i64,
        acts: Vec<TimeplanAct>,
    },
    Custom {
        label: String,
        duration_seconds: i64,
    },
}

impl TimeplanEntry {
    pub fn duration(&self) -> time::Duration {
        match self {
            TimeplanEntry::Category {
                duration_seconds, ..
            } => time::Duration::seconds(*duration_seconds),
            TimeplanEntry::Custom {
                duration_seconds, ..
            } => time::Duration::seconds(*duration_seconds),
        }
    }
}

#[derive(Debug, serde::Serialize, utoipa::ToSchema, Eq, PartialEq)]
pub enum TimeplanItemStatus {
    Planned,
    Started,
    Ended,
}

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct TimeplanItem {
    status: TimeplanItemStatus,
    #[serde(with = "time::serde::iso8601")]
    predicted_start: time::OffsetDateTime,
    #[serde(with = "time::serde::iso8601")]
    predicted_end: time::OffsetDateTime,
    #[serde(with = "time::serde::iso8601")]
    planned_start: time::OffsetDateTime,
    #[serde(with = "time::serde::iso8601")]
    planned_end: time::OffsetDateTime,
    planned_duration: i64,
    #[serde(with = "time::serde::iso8601::option")]
    started_at: Option<time::OffsetDateTime>,
    #[serde(with = "time::serde::iso8601::option")]
    ended_at: Option<time::OffsetDateTime>,
    timeplan_entry: TimeplanEntry,
}

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct Timeplan {
    offset: i64,
    items: Vec<TimeplanItem>,
}

/// List all users.
#[utoipa::path(
    get,
    tags=["query", "timeplan"],
    path="/predict_timeplan",
    responses(
        (status=200, content_type="application/json", body=Timeplan),
        (status=404, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
pub async fn predict_timeplan(
    Extension(db): Extension<ReloadableSqlite>,
) -> Result<Json<Timeplan>, HttpError> {
    let db = db.get().await.clone();
    let top_level_timeplan = sqlx::query!(
        r#"
        SELECT
            id,
            earliest_start_time,
            duration_seconds,
            label,
            category,
            started_at,
            ended_at
        FROM
            timeplan
        ORDER BY
            id
        "#,
    )
    .fetch_all(&db)
    .await?;

    let first_entry = top_level_timeplan
        .first()
        .ok_or(HttpError::ErrorMessages("No first entry".to_string()))?;
    let mut next_planned_start_time =
        first_entry
            .earliest_start_time
            .ok_or(HttpError::ErrorMessages(
                "Earliest start time is not set".to_string(),
            ))?;

    let mut next_predicted_start_time =
        time::OffsetDateTime::now_utc().max(next_planned_start_time);

    info!("next_planned_start_time: {:?}", next_planned_start_time);
    info!("next_predicted_start_time: {:?}", next_predicted_start_time);

    let mut timeplan = Timeplan {
        offset: (next_predicted_start_time - next_planned_start_time).whole_seconds(),
        items: vec![],
    };

    let mut general_offset = None;

    for top_level_timeplan_entry in top_level_timeplan {
        let mut entry_offset = None;
        if let Some(earliest_start_time) = top_level_timeplan_entry.earliest_start_time {
            next_planned_start_time = earliest_start_time.max(next_planned_start_time);
            next_predicted_start_time = top_level_timeplan_entry
                .started_at
                .unwrap_or(earliest_start_time.max(next_predicted_start_time));
        }

        let item_planned_start_time = next_planned_start_time;
        let item_predicted_start_time = next_predicted_start_time;

        let entry = match (
            top_level_timeplan_entry.duration_seconds,
            top_level_timeplan_entry.label,
            top_level_timeplan_entry.category,
        ) {
            (_, _, Some(name)) => {
                let cat = sqlx::query!(
                    r#"
                    SELECT
                        name,
                        description as "description!",
                        "order" as "order!",
                        einfahrzeit_seconds,
                        act_duration_seconds,
                        judge_duration_seconds
                    FROM
                        categories
                    WHERE
                        name = $1
                    "#,
                    name
                )
                .fetch_one(&db)
                .await?;
                let acts = sqlx::query!(
                    r#"
                    SELECT
                        id as "id!: Uuid",
                        name,
                        started_at,
                        ended_at
                    FROM
                        view_act
                    WHERE
                        category = $1
                    ORDER BY
                        "order"
                    "#,
                    name
                )
                .fetch_all(&db)
                .await?;

                next_predicted_start_time += time::Duration::seconds(cat.einfahrzeit_seconds);
                next_planned_start_time += time::Duration::seconds(cat.einfahrzeit_seconds);

                let mut timeplan_acts = vec![];
                for act in acts {
                    if let (Some(started_at), None) = (act.started_at, act.ended_at) {
                        entry_offset = Some((started_at - next_planned_start_time).whole_seconds());
                    }

                    next_predicted_start_time =
                        time::OffsetDateTime::now_utc().max(next_predicted_start_time);

                    if let Some(started_at) = act.started_at {
                        next_predicted_start_time = started_at;
                    }

                    let next_predicted_end_time = if let Some(ended_at) = act.ended_at {
                        ended_at
                    } else {
                        next_predicted_start_time
                            + time::Duration::seconds(cat.act_duration_seconds)
                    };

                    timeplan_acts.push(TimeplanAct {
                        id: act.id,
                        name: act.name,
                        started_at: act.started_at,
                        ended_at: act.ended_at,
                        predicted_start: next_predicted_start_time,
                        predicted_end: next_predicted_end_time,
                        planned_start: next_planned_start_time,
                        planned_end: next_planned_start_time
                            + time::Duration::seconds(cat.act_duration_seconds),
                        status: match (act.started_at, act.ended_at) {
                            (Some(_), Some(_)) => TimeplanItemStatus::Ended,
                            (Some(_), None) => TimeplanItemStatus::Started,
                            (None, None) => TimeplanItemStatus::Planned,
                            _ => {
                                return Err(HttpError::ErrorMessages(
                                    "Invalid timeplan entry".to_string(),
                                ));
                            }
                        },
                    });
                    next_predicted_start_time += time::Duration::seconds(cat.act_duration_seconds)
                        + time::Duration::seconds(cat.judge_duration_seconds);
                    next_planned_start_time += time::Duration::seconds(cat.act_duration_seconds)
                        + time::Duration::seconds(cat.judge_duration_seconds);
                }
                TimeplanEntry::Category {
                    name,
                    description: cat.description,
                    duration_seconds: (cat.einfahrzeit_seconds
                        + (cat.act_duration_seconds + cat.judge_duration_seconds)
                            * timeplan_acts.len() as i64),
                    order: cat.order,
                    einfahrzeit_seconds: (cat.einfahrzeit_seconds),
                    act_duration_seconds: (cat.act_duration_seconds),
                    judge_duration_seconds: (cat.judge_duration_seconds),
                    acts: timeplan_acts,
                }
            }
            (Some(duration), Some(label), None) => {
                next_predicted_start_time += time::Duration::seconds(duration);
                next_planned_start_time += time::Duration::seconds(duration);
                TimeplanEntry::Custom {
                    label,
                    duration_seconds: duration,
                }
            }
            _ => {
                return Err(HttpError::ErrorMessages(
                    "Invalid timeplan entry".to_string(),
                ));
            }
        };

        let item = TimeplanItem {
            status: match (
                top_level_timeplan_entry.started_at,
                top_level_timeplan_entry.ended_at,
            ) {
                (Some(_), Some(_)) => TimeplanItemStatus::Ended,
                (Some(_), None) => TimeplanItemStatus::Started,
                (None, None) => TimeplanItemStatus::Planned,
                _ => {
                    return Err(HttpError::ErrorMessages(
                        "Invalid timeplan entry".to_string(),
                    ));
                }
            },
            predicted_start: top_level_timeplan_entry
                .started_at
                .unwrap_or(item_predicted_start_time),
            predicted_end: top_level_timeplan_entry
                .ended_at
                .unwrap_or(item_predicted_start_time + entry.duration()),
            planned_start: item_planned_start_time,
            planned_end: item_planned_start_time + entry.duration(),
            planned_duration: entry.duration().whole_seconds(),
            started_at: top_level_timeplan_entry.started_at,
            ended_at: top_level_timeplan_entry.ended_at,
            timeplan_entry: entry,
        };

        if entry_offset.is_none()
            && let (Some(started_at), None) = (item.started_at, item.ended_at)
        {
            entry_offset = Some((started_at - item.planned_start).whole_seconds());
        }

        if let Some(offset) = entry_offset {
            general_offset = Some(offset);
        } else if item.status == TimeplanItemStatus::Started {
            general_offset = Some((item.started_at.unwrap() - item.planned_start).whole_seconds());
        }

        timeplan.items.push(item);
    }

    timeplan.offset = general_offset.unwrap_or(timeplan.offset);

    Ok(Json(timeplan))
}
