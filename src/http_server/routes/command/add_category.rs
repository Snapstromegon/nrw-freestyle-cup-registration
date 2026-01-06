use axum::{Extension, Json, http::StatusCode};
use serde::{Deserialize, Serialize};
use tracing::instrument;
use utoipa::ToSchema;

use crate::{
    http_server::{ClientError, HttpError, extractor::auth::Auth},
    reloadable_sqlite::ReloadableSqlite,
};

#[derive(Debug, Serialize, ToSchema)]
pub struct AddCategoryResponse {}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AddCategoryBody {
    name: String,
    description: Option<String>,
    from_birthday: String, // ISO date string
    to_birthday: String,   // ISO date string
    is_pair: bool,
    is_sonderpokal: bool,
    is_single_male: bool,
    einfahrzeit_seconds: i32,
    act_duration_seconds: i32,
    judge_duration_seconds: i32,
}

/// Add a new category.
///
/// This endpoint is used to create a new category.
#[utoipa::path(
    post,
    tags=["command", "category"],
    path="/add_category",
    request_body=AddCategoryBody,
    responses(
        (status=200, content_type="application/json", body=AddCategoryResponse),
        (status=400, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn add_category(
    Extension(db): Extension<ReloadableSqlite>,
    auth: Auth,
    Json(body): Json<AddCategoryBody>,
) -> Result<Json<AddCategoryResponse>, HttpError> {
    if !auth.is_admin() {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }
    let db = db.get().await.clone();

    sqlx::query!(
        r#"
        INSERT INTO categories (
            name, 
            description, 
            from_birthday, 
            to_birthday, 
            is_pair, 
            is_sonderpokal, 
            is_single_male, 
            einfahrzeit_seconds, 
            act_duration_seconds, 
            judge_duration_seconds
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        "#,
        body.name,
        body.description,
        body.from_birthday,
        body.to_birthday,
        body.is_pair,
        body.is_sonderpokal,
        body.is_single_male,
        body.einfahrzeit_seconds,
        body.act_duration_seconds,
        body.judge_duration_seconds,
    )
    .execute(&db)
    .await?;

    Ok(Json(AddCategoryResponse {}))
}