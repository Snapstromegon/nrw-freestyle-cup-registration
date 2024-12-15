use axum::extract::DefaultBodyLimit;
use utoipa_axum::{router::OpenApiRouter, routes};

mod register;
mod verify_email;
mod login;
mod logout;
mod create_club;
mod rename_club;
mod resend_mail_validation;

pub fn get_command_router() -> OpenApiRouter {
    OpenApiRouter::new()
        .routes(routes!(register::register))
        .routes(routes!(verify_email::verify_email))
        .routes(routes!(login::login))
        .routes(routes!(logout::logout))
        .routes(routes!(create_club::create_club))
        .routes(routes!(rename_club::rename_club))
        .routes(routes!(resend_mail_validation::resend_mail_validation))
        .layer(DefaultBodyLimit::max(1024 * 1024 * 10))
}
