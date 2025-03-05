use axum::{Extension, Json};
use sqlx::SqlitePool;
use tracing::instrument;

use crate::http_server::{ClientError, HttpError, extractor::auth::Auth};

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct Category {
    name: String,
    description: Option<String>,
    #[serde(with = "time::serde::iso8601::option")]
    from_birthday: Option<time::OffsetDateTime>,
    #[serde(with = "time::serde::iso8601::option")]
    to_birthday: Option<time::OffsetDateTime>,
    is_pair: bool,
    is_sonderpokal: bool,
    is_single_male: bool,
    order: Option<i64>,
}

/// Get information about a club.
#[utoipa::path(
    get,
    tags=["query"],
    path="/list_categories",
    responses(
        (status=200, content_type="application/json", body=Vec<Category>),
        (status=404, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
pub async fn list_categories(
    Extension(db): Extension<SqlitePool>,
    auth: Option<Auth>,
) -> Result<Json<Vec<Category>>, HttpError> {
    let club_categories = sqlx::query_as!(
        Category,
        r#"
        SELECT name as "name!", description, from_birthday, to_birthday, is_pair, is_sonderpokal, is_single_male, "order"
        FROM categories ORDER BY "order" ASC
        "#
    )
    .fetch_all(&db)
    .await?;
    Ok(Json(club_categories))
}
