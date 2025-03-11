use axum::{Extension, Json, extract::Query};
use tracing::instrument;
use uuid::Uuid;

use crate::{
    http_server::{
        ClientError, HttpError,
        extractor::auth::Auth,
        routes::http_types::{Act, ActParticipant},
    },
    reloadable_sqlite::ReloadableSqlite,
};

#[derive(Debug, serde::Deserialize, utoipa::IntoParams)]
pub struct GetActQuery {
    act_id: Uuid,
}

/// Get information about an act.
#[utoipa::path(
    get,
    tags=["query", "act"],
    path="/get_act",
    params(GetActQuery),
    responses(
        (status=200, content_type="application/json", body=Act),
        (status=404, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
pub async fn get_act(
    Extension(db): Extension<ReloadableSqlite>,
    Query(query): Query<GetActQuery>,
    auth: Option<Auth>,
) -> Result<Json<Act>, HttpError> {
    pub struct DBAct {
        id: Uuid,
        name: String,
        song_file: Option<String>,
        description: Option<String>,
        song_file_name: Option<String>,
        is_pair: Option<bool>,
        max_age: Option<f64>,
        is_sonderpokal: Option<bool>,
        participants: sqlx::types::Json<Vec<ActParticipant>>,
        category: Option<String>,
        song_checked: bool,
        act_order: Option<i64>,
        category_order: Option<i64>,
    }
    impl From<DBAct> for Act {
        fn from(db_act: DBAct) -> Self {
            Act {
                id: db_act.id,
                name: db_act.name,
                song_file: db_act.song_file,
                description: db_act.description,
                song_file_name: db_act.song_file_name,
                is_pair: db_act.is_pair,
                max_age: db_act.max_age,
                is_sonderpokal: db_act.is_sonderpokal,
                participants: db_act.participants.0,
                category: db_act.category,
                song_checked: db_act.song_checked,
                act_order: db_act.act_order,
                category_order: db_act.category_order,
            }
        }
    }
    let db = db.get().await.clone();
    let act = sqlx::query_as!(
        DBAct,
        r#"
        SELECT
            id as "id!: Uuid",
            view_act."order" as "act_order",
            categories."order" as "category_order",
            view_act.name,
            song_file,
            view_act.description,
            song_file_name,
            view_act.is_pair as "is_pair: bool",
            max_age as "max_age: f64",
            view_act.is_sonderpokal as "is_sonderpokal: bool",
            participants as "participants!: sqlx::types::Json<Vec<ActParticipant>>",
            category,
            song_checked
        FROM view_act JOIN categories ON view_act.category = categories.name
        WHERE id = ?
        "#,
        query.act_id
    )
    .fetch_one(&db)
    .await?;
    Ok(Json(act.into()))
}
