use axum::extract::DefaultBodyLimit;
use utoipa_axum::{router::OpenApiRouter, routes};

mod register;
mod verify_email;
mod resend_mail_validation;
mod login;
mod logout;
mod create_club;
mod rename_club;

pub fn get_command_router() -> OpenApiRouter {
    OpenApiRouter::new()
        .routes(routes!(register::register))
        .routes(routes!(verify_email::verify_email))
        .routes(routes!(resend_mail_validation::resend_mail_validation))
        .routes(routes!(login::login))
        .routes(routes!(logout::logout))
        .routes(routes!(create_club::create_club))
        .routes(routes!(rename_club::rename_club))
        .layer(DefaultBodyLimit::max(1024 * 1024 * 10))
}
