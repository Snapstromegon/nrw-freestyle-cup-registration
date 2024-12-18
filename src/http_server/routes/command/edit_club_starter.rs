use axum::{Extension, Json};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tracing::instrument;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::http_server::{extractor::auth::Auth, ClientError, HttpError};

#[derive(Debug, Serialize, ToSchema)]
pub struct EditClubStarterResponse {}

#[derive(Debug, Deserialize, ToSchema)]
pub struct EditClubStarterBody {
    starter_id: Uuid,
    firstname: String,
    lastname: String,
    #[serde(with = "time::serde::iso8601")]
    birthdate: time::OffsetDateTime,
    sonderpokal: bool,
    single_male: bool,
    single_female: bool,
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
    Json(body): Json<EditClubStarterBody>,
) -> Result<Json<EditClubStarterResponse>, HttpError> {
    sqlx::query!(
        r#"
        UPDATE starter SET
          firstname = ?,
          lastname = ?,
          birthdate = ?,
          sonderpokal = ?,
          single_male = ?,
          single_female = ?,
          pair = ?,
          partner_name = ?
        WHERE id = ?
        "#,
        body.firstname,
        body.lastname,
        body.birthdate,
        body.sonderpokal,
        body.single_male,
        body.single_female,
        body.pair,
        body.partner_name,
        body.starter_id,
    )
    .execute(&db)
    .await?;

    Ok(Json(EditClubStarterResponse {}))
}
