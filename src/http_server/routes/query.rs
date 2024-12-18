use utoipa_axum::{router::OpenApiRouter, routes};

mod get_club;
mod list_club_starters;
mod list_users;
mod whoami;

pub fn get_query_router() -> OpenApiRouter {
    OpenApiRouter::new()
        .routes(routes!(get_club::get_club))
        .routes(routes!(list_club_starters::list_club_starters))
        .routes(routes!(list_users::list_users))
        .routes(routes!(whoami::whoami))
}
