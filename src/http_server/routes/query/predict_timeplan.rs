use std::collections::HashMap;

use axum::{Extension, Json};
use tracing::instrument;
use uuid::Uuid;

use crate::{
    http_server::{ClientError, HttpError},
    reloadable_sqlite::ReloadableSqlite,
    timeplan::{Block, effective_warmups},
};

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct TimeplanAct {
    pub status: TimeplanItemStatus,
    pub id: Uuid,
    pub name: String,
    #[serde(with = "time::serde::iso8601::option")]
    pub started_at: Option<time::OffsetDateTime>,
    #[serde(with = "time::serde::iso8601::option")]
    pub ended_at: Option<time::OffsetDateTime>,
    #[serde(with = "time::serde::iso8601")]
    pub predicted_start: time::OffsetDateTime,
    #[serde(with = "time::serde::iso8601")]
    pub predicted_end: time::OffsetDateTime,
    #[serde(with = "time::serde::iso8601")]
    pub planned_start: time::OffsetDateTime,
    #[serde(with = "time::serde::iso8601")]
    pub planned_end: time::OffsetDateTime,
}

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub enum TimeplanEntry {
    Category {
        name: String,
        description: String,
        duration_seconds: i64,
        order: i64,
        /// The configured warm-up.
        einfahrzeit_seconds: i64,
        /// The warm-up this block really gets: none for an empty block, and a
        /// block sharing the warm-up of an empty category before it gets
        /// that one (see `crate::timeplan::effective_warmups`).
        warmup_seconds: i64,
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
    pub status: TimeplanItemStatus,
    #[serde(with = "time::serde::iso8601")]
    pub predicted_start: time::OffsetDateTime,
    #[serde(with = "time::serde::iso8601")]
    pub predicted_end: time::OffsetDateTime,
    #[serde(with = "time::serde::iso8601")]
    pub planned_start: time::OffsetDateTime,
    #[serde(with = "time::serde::iso8601")]
    pub planned_end: time::OffsetDateTime,
    pub planned_duration: i64,
    #[serde(with = "time::serde::iso8601::option")]
    pub started_at: Option<time::OffsetDateTime>,
    #[serde(with = "time::serde::iso8601::option")]
    pub ended_at: Option<time::OffsetDateTime>,
    pub timeplan_entry: TimeplanEntry,
}

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct Timeplan {
    pub offset: i64,
    pub items: Vec<TimeplanItem>,
}

/// Predicts when each timeplan entry and act starts and ends.
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
    Ok(Json(predict(&db).await?))
}

/// The prediction behind `predict_timeplan`, also used by the startlist CSV.
pub async fn predict(db: &sqlx::SqlitePool) -> Result<Timeplan, HttpError> {
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
    .fetch_all(db)
    .await?;

    let Some(first_entry) = top_level_timeplan.first() else {
        return Ok(Timeplan {
            offset: 0,
            items: vec![],
        });
    };
    let mut next_planned_start_time =
        first_entry
            .earliest_start_time
            .ok_or(HttpError::ErrorMessages(
                "Der erste Zeitplaneintrag braucht eine früheste Startzeit.".to_string(),
            ))?;

    let mut next_predicted_start_time =
        time::OffsetDateTime::now_utc().max(next_planned_start_time);

    let categories: HashMap<String, _> = sqlx::query!(
        r#"
        SELECT
            name as "name!",
            description as "description!",
            "order" as "order!",
            einfahrzeit_seconds,
            act_duration_seconds,
            judge_duration_seconds
        FROM
            categories
        "#
    )
    .fetch_all(db)
    .await?
    .into_iter()
    .map(|cat| (cat.name.clone(), cat))
    .collect();
    let mut acts_by_category: HashMap<String, Vec<_>> = HashMap::new();
    for act in sqlx::query!(
        r#"
        SELECT
            id as "id!: Uuid",
            name,
            started_at,
            ended_at,
            category as "category!"
        FROM
            view_act
        WHERE
            category IS NOT NULL
        ORDER BY
            "order"
        "#
    )
    .fetch_all(db)
    .await?
    {
        acts_by_category
            .entry(act.category.clone())
            .or_default()
            .push(act);
    }
    let blocks: Vec<Block> = top_level_timeplan
        .iter()
        .map(|entry| match &entry.category {
            Some(name) => Block::Category {
                einfahrzeit_seconds: categories.get(name).map_or(0, |c| c.einfahrzeit_seconds),
                empty: !acts_by_category.contains_key(name),
            },
            None => Block::Custom,
        })
        .collect();
    let warmups = effective_warmups(&blocks);

    let mut timeplan = Timeplan {
        offset: 0,
        items: vec![],
    };

    // The offset is the predicted delay of the next step that hasn't started
    // (an act, or an entry's start). Once everything has started, it's the
    // delay of the last start. It doesn't jump between acts or at the end.
    let mut next_offset = None;
    let mut last_offset = None;

    for (top_level_timeplan_entry, warmup_seconds) in top_level_timeplan.into_iter().zip(warmups) {
        if let Some(earliest_start_time) = top_level_timeplan_entry.earliest_start_time {
            next_planned_start_time = earliest_start_time.max(next_planned_start_time);
            next_predicted_start_time = top_level_timeplan_entry
                .started_at
                .unwrap_or(earliest_start_time.max(next_predicted_start_time));
        }

        let item_planned_start_time = next_planned_start_time;
        let item_predicted_start_time = next_predicted_start_time;
        if let Some(started_at) = top_level_timeplan_entry.started_at {
            last_offset = Some((started_at - item_planned_start_time).whole_seconds());
        } else if next_offset.is_none() {
            next_offset =
                Some((item_predicted_start_time - item_planned_start_time).whole_seconds());
        }

        let entry = match (
            top_level_timeplan_entry.duration_seconds,
            top_level_timeplan_entry.label,
            top_level_timeplan_entry.category,
        ) {
            (_, _, Some(name)) => {
                let cat = categories.get(&name).ok_or_else(|| {
                    HttpError::ErrorMessages(format!("Unbekannte Kategorie im Zeitplan: {name}"))
                })?;
                let acts = acts_by_category.remove(&name).unwrap_or_default();

                next_predicted_start_time += time::Duration::seconds(warmup_seconds);
                next_planned_start_time += time::Duration::seconds(warmup_seconds);

                let mut timeplan_acts = vec![];
                for act in acts {
                    next_predicted_start_time =
                        time::OffsetDateTime::now_utc().max(next_predicted_start_time);

                    if let Some(started_at) = act.started_at {
                        next_predicted_start_time = started_at;
                        last_offset = Some((started_at - next_planned_start_time).whole_seconds());
                    } else if next_offset.is_none() {
                        next_offset = Some(
                            (next_predicted_start_time - next_planned_start_time).whole_seconds(),
                        );
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
                                    "Ungültiger Zeitplaneintrag".to_string(),
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
                    description: cat.description.clone(),
                    duration_seconds: (warmup_seconds
                        + (cat.act_duration_seconds + cat.judge_duration_seconds)
                            * timeplan_acts.len() as i64),
                    order: cat.order,
                    einfahrzeit_seconds: (cat.einfahrzeit_seconds),
                    warmup_seconds,
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
                    "Ungültiger Zeitplaneintrag".to_string(),
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
                        "Ungültiger Zeitplaneintrag".to_string(),
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

        timeplan.items.push(item);
    }

    timeplan.offset = next_offset.or(last_offset).unwrap_or(0);

    Ok(timeplan)
}
