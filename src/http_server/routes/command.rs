use axum::extract::DefaultBodyLimit;
use utoipa_axum::{router::OpenApiRouter, routes};

mod register;
mod verify_email;
mod resend_mail_validation;
mod request_password_reset;
mod reset_password;
mod login;
mod logout;
mod create_club;
mod rename_club;
mod add_club_starter;
mod delete_club_starter;
mod edit_club_starter;
mod add_club_judge;
mod delete_club_judge;
mod edit_club_judge;
mod edit_club_act;
mod save_act_song;
mod set_payment;
mod set_song_checked;
mod set_act_order;

pub fn get_command_router() -> OpenApiRouter {
    OpenApiRouter::new()
        .routes(routes!(register::register))
        .routes(routes!(verify_email::verify_email))
        .routes(routes!(resend_mail_validation::resend_mail_validation))
        .routes(routes!(request_password_reset::request_password_reset))
        .routes(routes!(reset_password::reset_password))
        .routes(routes!(login::login))
        .routes(routes!(logout::logout))
        .routes(routes!(create_club::create_club))
        .routes(routes!(rename_club::rename_club))
        .routes(routes!(add_club_starter::add_club_starter))
        .routes(routes!(delete_club_starter::delete_club_starter))
        .routes(routes!(edit_club_starter::edit_club_starter))
        .routes(routes!(add_club_judge::add_club_judge))
        .routes(routes!(delete_club_judge::delete_club_judge))
        .routes(routes!(edit_club_judge::edit_club_judge))
        .routes(routes!(edit_club_act::edit_club_act))
        .routes(routes!(save_act_song::save_act_song))
        .routes(routes!(set_payment::set_payment))
        .routes(routes!(set_song_checked::set_song_checked))
        .routes(routes!(set_act_order::set_act_order))
        .layer(DefaultBodyLimit::max(1024 * 1024 * 10))
}
