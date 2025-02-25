use axum::{Extension, Json};
use sqlx::SqlitePool;
use tracing::instrument;
use uuid::Uuid;

use crate::http_server::{ClientError, HttpError};

#[derive(Debug, serde::Serialize, serde::Deserialize, utoipa::ToSchema, Clone)]
pub struct StartlistActParticipant {
    firstname: String,
    lastname: String,
    id: Uuid,
    club_name: String,
}

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct StartlistAct {
    id: Uuid,
    name: String,
    is_pair: Option<bool>,
    max_age: Option<f64>,
    is_sonderpokal: Option<bool>,
    participants: Vec<StartlistActParticipant>,
    category: Option<String>,
    act_order: Option<i64>,
    category_order: Option<i64>,
}

/// List all users.
#[utoipa::path(
    get,
    tags=["query", "acts"],
    path="/startlist",
    responses(
        (status=200, content_type="application/json", body=Vec<StartlistAct>),
        (status=404, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
pub async fn startlist(
    Extension(db): Extension<SqlitePool>,
) -> Result<Json<Vec<StartlistAct>>, HttpError> {
    pub struct DBStartlistAct {
        id: Uuid,
        name: String,
        is_pair: Option<bool>,
        max_age: Option<f64>,
        is_sonderpokal: Option<bool>,
        participants: sqlx::types::Json<Vec<StartlistActParticipant>>,
        category: Option<String>,
        act_order: Option<i64>,
        category_order: Option<i64>,
    }
    impl From<DBStartlistAct> for StartlistAct {
        fn from(db_act: DBStartlistAct) -> Self {
            StartlistAct {
                id: db_act.id,
                name: db_act.name,
                is_pair: db_act.is_pair,
                max_age: db_act.max_age,
                is_sonderpokal: db_act.is_sonderpokal,
                participants: db_act.participants.0,
                category: db_act.category,
                act_order: db_act.act_order,
                category_order: db_act.category_order,
            }
        }
    }
    let acts = sqlx::query_as!(
        DBStartlistAct,
        r#"
        SELECT
            id as "id!: Uuid",
            view_act."order" as "act_order",
            categories."order" as "category_order",
            view_act.name,
            view_act.is_pair as "is_pair: bool",
            max_age,
            view_act.is_sonderpokal as "is_sonderpokal: bool",
            participants as "participants!: sqlx::types::Json<Vec<StartlistActParticipant>>",
            category
        FROM view_act JOIN categories ON view_act.category = categories.name
        ORDER BY categories."order", view_act."order" ASC
        "#
    )
    .fetch_all(&db)
    .await?;
    Ok(Json(acts.into_iter().map(|a| a.into()).collect()))
}
