use axum::{Extension, Json};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tracing::instrument;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::http_server::{extractor::auth::Auth, ClientError, HttpError};

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
    sonderpokal: bool,
    single_male: bool,
    single_female: bool,
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
    Json(body): Json<AddClubStarterBody>,
) -> Result<Json<AddClubStarterResponse>, HttpError> {
    let starter_id = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO starter (
          id,
          club_id,
          firstname,
          lastname,
          birthdate,
          sonderpokal,
          single_male,
          single_female,
          pair,
          partner_id,
          partner_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        "#,
        starter_id,
        body.club_id,
        body.firstname,
        body.lastname,
        body.birthdate,
        body.sonderpokal,
        body.single_male,
        body.single_female,
        body.pair,
        body.partner_id,
        body.partner_name,
    )
    .execute(&db)
    .await?;

    Ok(Json(AddClubStarterResponse { starter_id }))
}
