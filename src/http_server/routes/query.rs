use utoipa_axum::{router::OpenApiRouter, routes};

mod get_club;
mod list_club_starters;
mod list_users;
mod whoami;
mod get_system_status;
mod list_club_judges;
mod list_starters;
mod list_club_acts;

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
}
