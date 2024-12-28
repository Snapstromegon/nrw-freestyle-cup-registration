use axum::{Extension, Json, http::StatusCode};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tracing::instrument;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{http_server::{extractor::auth::Auth, ClientError, HttpError}, system_status::Capabilities};

#[derive(Debug, Serialize, ToSchema)]
pub struct AddClubStarterResponse {
    starter_id: Uuid,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AddClubStarterBody {
    club_id: Uuid,
    firstname: String,
    lastname: String,
    #[serde(with = "time::serde::iso8601")]
    birthdate: time::OffsetDateTime,
    single_sonderpokal: bool,
    single_male: bool,
    single_female: bool,
    pair_sonderpokal: bool,
    pair: bool,
    partner_id: Option<Uuid>,
    partner_name: Option<String>,
}

/// AddClubStarter a new user.
///
/// This endpoint is used to create a new user.
#[utoipa::path(
    post,
    tags=["command", "club"],
    path="/add_club_starter",
    request_body=AddClubStarterBody,
    responses(
        (status=200, content_type="application/json", body=AddClubStarterResponse),
        (status=400, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn add_club_starter(
    Extension(db): Extension<SqlitePool>,
    auth: Auth,
    capabilities: Capabilities,
    Json(body): Json<AddClubStarterBody>,
) -> Result<Json<AddClubStarterResponse>, HttpError> {
    if !capabilities.can_register_starter {
        return Err(HttpError::StatusCode(StatusCode::FORBIDDEN));
    }
    let starter_id = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO starter (
          id,
          club_id,
          firstname,
          lastname,
          birthdate,
          single_sonderpokal,
          single_male,
          single_female,
          pair_sonderpokal,
          pair,
          partner_id,
          partner_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        "#,
        starter_id,
        body.club_id,
        body.firstname,
        body.lastname,
        body.birthdate,
        body.single_sonderpokal,
        body.single_male,
        body.single_female,
        body.pair_sonderpokal,
        body.pair,
        body.partner_id,
        body.partner_name,
    )
    .execute(&db)
    .await?;

    Ok(Json(AddClubStarterResponse { starter_id }))
}
