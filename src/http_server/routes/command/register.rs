use std::sync::Arc;

use axum::{Extension, Json};
use axum_extra::extract::CookieJar;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tracing::instrument;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    http_server::{ClientError, HttpError, HttpServerOptions},
    jwt::JWTConfig,
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
        (status=400, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db, mailer))]
#[axum::debug_handler]
pub async fn register(
    cookies: CookieJar,
    Extension(db): Extension<SqlitePool>,
    Extension(mailer): Extension<Arc<Mailer>>,
    Extension(jwt_config): Extension<Arc<JWTConfig>>,
    Extension(http_options): Extension<Arc<HttpServerOptions>>,
    Json(body): Json<RegisterBody>,
) -> Result<(CookieJar, Json<RegisterResponse>), HttpError> {
    check_password(&body.password).map_err(HttpError::ErrorMessages)?;
    check_email_exists(&db, &body.email).await?;
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
    .await?;

    mailer
        .send_text(
            &body.email,
            "Freestyle Cup NRW - Email bestätigen",
            &format!("Hallo {},\n\nWillkommen im Frewestyle Cup NRW Anmeldesystem.\n\nUm mit der Anmeldung zu beginnen, bestätige deine Email Adresse über diesen Link: {}\n\nMIt freundlichen Grüßen,\nDein Freestyle Cup NRW Team\n\nP.S.: Bitte nicht auf diese Mail antworten - das Postfach wird nicht gelesen.", body.name, http_options.base_url),
        )
        .await?;

    Ok((
        jwt_config.add_jwt_cookie(cookies, user_id).map_err(|e| {
            tracing::error!("Failed to add JWT cookie: {:?}", e);
            HttpError::InvalidCredentials
        })?,
        Json(RegisterResponse { user_id }),
    ))
}

fn check_password(password: &str) -> Result<(), String> {
    if password.len() < 8 {
        return Err("Passwort muss mindestens 8 Zeichen haben.".to_string());
    }

    let mut categories = 0;
    if password.chars().any(|c| c.is_uppercase()) {
        categories += 1;
    }
    if password.chars().any(|c| c.is_lowercase()) {
        categories += 1;
    }
    if password.chars().any(|c| c.is_numeric()) {
        categories += 1;
    }
    if r#"!"§$%&/()=?+-*#'_~.,:;<>|\\ {[]}"#
        .chars()
        .any(|s| password.chars().any(|c| s == c))
    {
        categories += 1;
    }

    if categories < 3 {
        return Err("Passwort muss mindestens 3 der folgenden Kategorien enthalten: Kleinbuchstaben, Großbuchstaben, Zahlen, Sonderzeichen.".to_string());
    }

    Ok(())
}

async fn check_email_exists(db: &SqlitePool, email: &str) -> Result<(), HttpError> {
    let user = sqlx::query!(
        r#"
        SELECT id FROM users WHERE email = ?
        "#,
        email
    )
    .fetch_optional(db)
    .await?;

    if user.is_some() {
        return Err(HttpError::ErrorMessages(
            "Email Adresse bereits registriert.".to_string(),
        ));
    }

    Ok(())
}
