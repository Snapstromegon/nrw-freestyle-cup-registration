use utoipa_axum::{router::OpenApiRouter, routes};

mod get_club;
mod get_system_status;
mod list_acts;
mod list_categories;
mod list_club_acts;
mod list_club_judges;
mod list_club_starters;
mod list_judges;
mod list_starters;
mod list_users;
mod startlist;
mod whoami;
mod predict_timeplan;

pub fn get_query_router() -> OpenApiRouter {
    OpenApiRouter::new()
        .routes(routes!(get_club::get_club))
        .routes(routes!(list_club_starters::list_club_starters))
        .routes(routes!(list_users::list_users))
        .routes(routes!(whoami::whoami))
        .routes(routes!(get_system_status::get_system_status))
        .routes(routes!(list_club_judges::list_club_judges))
        .routes(routes!(list_starters::list_starters))
        .routes(routes!(list_club_acts::list_club_acts))
        .routes(routes!(list_acts::list_acts))
        .routes(routes!(list_judges::list_judges))
        .routes(routes!(list_categories::list_categories))
        .routes(routes!(startlist::startlist))
        .routes(routes!(predict_timeplan::predict_timeplan))
}
