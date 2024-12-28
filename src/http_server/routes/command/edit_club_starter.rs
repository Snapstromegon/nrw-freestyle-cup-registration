use axum::{http::StatusCode, Extension, Json};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tracing::instrument;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{http_server::{extractor::auth::Auth, ClientError, HttpError}, system_status::Capabilities};

#[derive(Debug, Serialize, ToSchema)]
pub struct EditClubStarterResponse {}

#[derive(Debug, Deserialize, ToSchema)]
pub struct EditClubStarterBody {
    starter_id: Uuid,
    firstname: String,
    lastname: String,
    #[serde(with = "time::serde::iso8601")]
    birthdate: time::OffsetDateTime,
    single_sonderpokal: bool,
    single_male: bool,
    single_female: bool,
    pair_sonderpokal: bool,
    pair: bool,
    partner_name: Option<String>,
}

/// EditClubStarter a new user.
///
/// This endpoint is used to create a new user.
#[utoipa::path(
    post,
    tags=["command", "club"],
    path="/edit_club_starter",
    request_body=EditClubStarterBody,
    responses(
        (status=200, content_type="application/json", body=EditClubStarterResponse),
        (status=400, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn edit_club_starter(
    Extension(db): Extension<SqlitePool>,
    auth: Auth,
    capabilities: Capabilities,
    Json(body): Json<EditClubStarterBody>,
) -> Result<Json<EditClubStarterResponse>, HttpError> {
    if !capabilities.can_register_starter {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }
    sqlx::query!(
        r#"
        UPDATE starter SET
          firstname = ?,
          lastname = ?,
          birthdate = ?,
          single_sonderpokal = ?,
          single_male = ?,
          single_female = ?,
          pair_sonderpokal = ?,
          pair = ?,
          partner_name = ?
        WHERE id = ?
        "#,
        body.firstname,
        body.lastname,
        body.birthdate,
        body.single_sonderpokal,
        body.single_male,
        body.single_female,
        body.pair_sonderpokal,
        body.pair,
        body.partner_name,
        body.starter_id,
    )
    .execute(&db)
    .await?;

    Ok(Json(EditClubStarterResponse {}))
}
