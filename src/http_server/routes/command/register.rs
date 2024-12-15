use std::sync::Arc;

use axum::{Extension, Json};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tracing::instrument;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    http_server::{HttpError, HttpServerOptions},
    mailer::Mailer,
};

#[derive(Debug, Serialize, ToSchema)]
pub struct RegisterResponse {
    user_id: Uuid,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RegisterBody {
    name: String,
    password: String,
    email: String,
}

/// Register a new user.
///
/// This endpoint is used to create a new user.
#[utoipa::path(
    post,
    tags=["command", "user"],
    path="/register",
    request_body=RegisterBody,
    responses(
        (status=200, content_type="application/json", body=RegisterResponse),
    ),
)]
#[instrument(skip(db, mailer))]
#[axum::debug_handler]
pub async fn register(
    Extension(db): Extension<SqlitePool>,
    Extension(mailer): Extension<Arc<Mailer>>,
    Extension(http_options): Extension<Arc<HttpServerOptions>>,
    Json(body): Json<RegisterBody>,
) -> Result<Json<RegisterResponse>, HttpError> {
    let user_id = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO users (id, name, email, email_verified, password, is_admin)
        VALUES (?, ?, ?, ?, ?, ?)
        "#,
        user_id,
        body.name,
        body.email,
        false,
        body.password,
        false
    )
    .execute(&db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to insert user: {:?}", e);
        HttpError::InternalServerError
    })?;

    mailer
        .send_text(
            &body.email,
            "Freestyle Cup NRW - Email bestätigen",
            &format!("Hallo {},\n\nWillkommen im Frewestyle Cup NRW Anmeldesystem.\n\nUm mit der Anmeldung zu beginnen, bestätige deine Email Adresse über diesen Link: {}\n\nMIt freundlichen Grüßen,\nDein Freestyle Cup NRW Team\n\nP.S.: Bitte nicht auf diese Mail antworten - das Postfach wird nicht gelesen.", body.name, http_options.base_url),
        )
        .await
        .map_err(|e| HttpError::ErrorMessages(e.to_string()))?;

    Ok(Json(RegisterResponse { user_id }))
}
