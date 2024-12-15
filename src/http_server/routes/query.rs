use utoipa_axum::{router::OpenApiRouter, routes};

mod whoami;

pub fn get_query_router() -> OpenApiRouter {
    OpenApiRouter::new().routes(routes!(whoami::whoami))
}
