use std::sync::Arc;

use crate::{
    http_server::{extractor::auth::Auth, HttpError, HttpServerOptions},
    mailer::Mailer,
};
use axum::{Extension, Json};
use serde::{Deserialize, Serialize};
use tracing::instrument;
use utoipa::ToSchema;

#[derive(Debug, Serialize, ToSchema)]
pub struct ResendMailValidationResponse {}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ResendMailValidationBody {
}

/// ResendMailValidation a new user.
///
/// This endpoint is used to create a new user.
#[utoipa::path(
    post,
    tags=["command", "user"],
    path="/resend_mail_validation",
    request_body=ResendMailValidationBody,
    responses(
        (status=200, content_type="application/json", body=ResendMailValidationResponse),
    ),
)]
#[instrument(skip(mailer))]
#[axum::debug_handler]
pub async fn resend_mail_validation(
    Extension(mailer): Extension<Arc<Mailer>>,
    Extension(http_options): Extension<Arc<HttpServerOptions>>,
    auth: Auth,
    Json(_body): Json<ResendMailValidationBody>,
) -> Result<Json<ResendMailValidationResponse>, HttpError> {
    mailer
        .send_text(
            &auth.email,
            "Freestyle Cup NRW - Email bestätigen",
            &format!("Hallo {},\n\nWillkommen im Frewestyle Cup NRW Anmeldesystem.\n\nUm mit der Anmeldung zu beginnen, bestätige deine Email Adresse über diesen Link: {}\n\nMIt freundlichen Grüßen,\nDein Freestyle Cup NRW Team\n\nP.S.: Bitte nicht auf diese Mail antworten - das Postfach wird nicht gelesen.", auth.name, http_options.base_url),
        )
        .await
        .map_err(|e| HttpError::ErrorMessages(e.to_string()))?;

    Ok(Json(ResendMailValidationResponse {}))
}
