use axum::{extract::Query, Extension, Json};
use sqlx::SqlitePool;
use tracing::instrument;
use uuid::Uuid;

use crate::http_server::{extractor::auth::Auth, ClientError, HttpError};

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct Club {
    id: Uuid,
    name: String,
    owner_id: Uuid,
    payment: Option<f64>,
}

#[derive(Debug, serde::Deserialize, utoipa::IntoParams)]
pub struct GetClubQuery {
    club_id: Option<Uuid>,
}

/// Get information about a club.
#[utoipa::path(
    get,
    tags=["query", "club"],
    path="/get_club",
    params(GetClubQuery),
    responses(
        (status=200, content_type="application/json", body=Club),
        (status=404, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
pub async fn get_club(
    Extension(db): Extension<SqlitePool>,
    Query(query): Query<GetClubQuery>,
    auth: Option<Auth>,
) -> Result<Json<Club>, HttpError> {
    let mut club_id = query.club_id;
    if let Some(auth) = auth {
        if club_id.is_none() {
            club_id = auth.club_id;
        }
    }
    if let Some(club_id) = club_id {
        let club = sqlx::query_as!(
            Club,
            r#"
        SELECT id as "id!: Uuid", name, owner_id as "owner_id: Uuid", payment FROM clubs WHERE id = ?
        "#,
            club_id
        )
        .fetch_one(&db)
        .await?;
        Ok(Json(club))
    } else {
        Err(HttpError::NotFound)
    }
}
