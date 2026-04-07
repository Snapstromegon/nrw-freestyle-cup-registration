use axum::extract::DefaultBodyLimit;
use utoipa_axum::{router::OpenApiRouter, routes};

mod add_category;
mod add_club_judge;
mod add_club_starter;
mod add_timeplan_entry;
mod create_club;
mod delete_category;
mod delete_club_judge;
mod delete_club_starter;
mod delete_timeplan_entry;
mod edit_category;
mod edit_club_act;
mod edit_club_judge;
mod edit_club_starter;
mod edit_timeplan_entry;
mod login;
mod logout;
mod move_category_down;
mod move_category_up;
mod move_timeplan_down;
mod move_timeplan_up;
mod register;
mod reload_db;
mod rename_club;
mod request_password_reset;
mod resend_mail_validation;
mod reset_password;
mod save_act_song;
mod set_act_order;
mod set_payment;
mod set_song_checked;
mod timeplan_backward;
mod timeplan_forward;
mod verify_email;

pub fn get_command_router() -> OpenApiRouter {
    OpenApiRouter::new()
        .routes(routes!(register::register))
        .routes(routes!(verify_email::verify_email))
        .routes(routes!(resend_mail_validation::resend_mail_validation))
        .routes(routes!(request_password_reset::request_password_reset))
        .routes(routes!(reset_password::reset_password))
        .routes(routes!(login::login))
        .routes(routes!(logout::logout))
        .routes(routes!(add_category::add_category))
        .routes(routes!(edit_category::edit_category))
        .routes(routes!(delete_category::delete_category))
        .routes(routes!(move_category_up::move_category_up))
        .routes(routes!(move_category_down::move_category_down))
        .routes(routes!(add_timeplan_entry::add_timeplan_entry))
        .routes(routes!(edit_timeplan_entry::edit_timeplan_entry))
        .routes(routes!(delete_timeplan_entry::delete_timeplan_entry))
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
        .routes(routes!(timeplan_forward::timeplan_forward))
        .routes(routes!(timeplan_backward::timeplan_backward))
        .routes(routes!(move_timeplan_up::move_timeplan_up))
        .routes(routes!(move_timeplan_down::move_timeplan_down))
        .routes(routes!(reload_db::reload_db))
        .layer(DefaultBodyLimit::max(1024 * 1024 * 10))
}
