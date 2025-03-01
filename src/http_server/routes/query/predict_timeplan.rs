use axum::{Extension, Json};
use sqlx::SqlitePool;
use tracing::instrument;
use uuid::Uuid;

use crate::http_server::{ClientError, HttpError};

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct TimeplanAct {
    status: TimeplanItemStatus,
    id: Uuid,
    name: String,
    started_at: Option<time::OffsetDateTime>,
    ended_at: Option<time::OffsetDateTime>,
    predicted_start: time::OffsetDateTime,
    predicted_end: time::OffsetDateTime,
    planned_start: time::OffsetDateTime,
    planned_end: time::OffsetDateTime,
}

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub enum TimeplanEntry {
    Category {
        name: String,
        description: String,
        duration: time::Duration,
        order: i64,
        einfahrzeit: time::Duration,
        act_duration: time::Duration,
        judge_duration: time::Duration,
        acts: Vec<TimeplanAct>,
    },
    Custom {
        label: String,
        duration: time::Duration,
    },
}

impl TimeplanEntry {
    pub fn duration(&self) -> time::Duration {
        match self {
            TimeplanEntry::Category {
                name: _,
                description: _,
                duration,
                order: _,
                einfahrzeit: _,
                act_duration: _,
                judge_duration: _,
                acts: _,
            } => *duration,
            TimeplanEntry::Custom { label: _, duration } => *duration,
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
    predicted_start: time::OffsetDateTime,
    predicted_end: time::OffsetDateTime,
    planned_start: time::OffsetDateTime,
    planned_end: time::OffsetDateTime,
    planned_duration: time::Duration,
    real_start: Option<time::OffsetDateTime>,
    real_end: Option<time::OffsetDateTime>,
    timeplan_entry: TimeplanEntry,
}

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct Timeplan {
    offset: time::Duration,
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
    Extension(db): Extension<SqlitePool>,
) -> Result<Json<Timeplan>, HttpError> {
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

    let mut next_predicted_start_time = time::OffsetDateTime::now_utc().max(next_planned_start_time);

    let mut timeplan = Timeplan {
        offset: time::Duration::minutes(0),
        items: vec![],
    };

    for top_level_timeplan_entry in top_level_timeplan {
        if let Some(earliest_start_time) = top_level_timeplan_entry.earliest_start_time {
            next_planned_start_time = earliest_start_time.max(next_planned_start_time);
            next_predicted_start_time = earliest_start_time.max(next_predicted_start_time);
        }
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
                
                let mut timeplan_acts = vec![];
                for act in acts {
                    timeplan_acts.push(TimeplanAct {
                        id: act.id,
                        name: act.name,
                        started_at: act.started_at,
                        ended_at: act.ended_at,
                        predicted_start: next_predicted_start_time,
                        predicted_end: next_predicted_start_time + time::Duration::seconds(cat.act_duration_seconds),
                        planned_start: next_planned_start_time,
                        planned_end: next_planned_start_time + time::Duration::seconds(cat.act_duration_seconds),
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
                    next_predicted_start_time += time::Duration::seconds(cat.act_duration_seconds) + time::Duration::seconds(cat.judge_duration_seconds);
                    next_planned_start_time += time::Duration::seconds(cat.act_duration_seconds) + time::Duration::seconds(cat.judge_duration_seconds);
                }
                TimeplanEntry::Category {
                    name,
                    description: cat.description,
                    duration: time::Duration::seconds(
                        cat.einfahrzeit_seconds
                            + (cat.act_duration_seconds + cat.judge_duration_seconds)
                                * timeplan_acts.len() as i64,
                    ),
                    order: cat.order,
                    einfahrzeit: time::Duration::seconds(cat.einfahrzeit_seconds),
                    act_duration: time::Duration::seconds(cat.act_duration_seconds),
                    judge_duration: time::Duration::seconds(cat.judge_duration_seconds),
                    acts: timeplan_acts,
                }
            }
            (Some(duration), Some(label), None) => TimeplanEntry::Custom {
                label,
                duration: time::Duration::seconds(duration),
            },
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
            predicted_start: next_predicted_start_time,
            predicted_end: next_predicted_start_time + entry.duration(),
            planned_start: next_planned_start_time,
            planned_end: next_planned_start_time + entry.duration(),
            planned_duration: entry.duration(),
            real_start: top_level_timeplan_entry.started_at,
            real_end: top_level_timeplan_entry.ended_at,
            timeplan_entry: entry,
        };

        if item.status != TimeplanItemStatus::Planned {
            timeplan.offset = item.planned_start - item.real_start.unwrap();
        }

        timeplan.items.push(item);
    }

    Ok(Json(timeplan))
}
