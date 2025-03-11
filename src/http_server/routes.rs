pub mod command;
pub mod http_types;
pub mod query;

use axum::{Extension, Router, extract::Request, http::HeaderName};
use axum_embed::{FallbackBehavior, ServeEmbed};
use rust_embed::RustEmbed;
use std::sync::Arc;
use tower::ServiceBuilder;
use tower_http::{
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    services::ServeDir,
    trace::TraceLayer,
};
use tracing::{error, info_span};
use utoipa::{OpenApi as OpenApiTrait, openapi::OpenApi};
use utoipa_axum::router::OpenApiRouter;
use utoipa_swagger_ui::SwaggerUi;

use crate::{
    jwt::JWTConfig, mailer::Mailer, reloadable_sqlite::ReloadableSqlite,
    system_status::StatusOptions,
};

use super::HttpServerOptions;

const REQUEST_ID_HEADER: &str = "x-request-id";

#[derive(RustEmbed, Clone)]
#[folder = "./static/"]
struct StaticAssets;

#[derive(OpenApiTrait)]
#[openapi(
    info(
        title = "NRW Freestyle Cup Login API",
        description = "API for managing registrations",
        license(name = "AGPL-3.0-or-later", url = "https://www.gnu.org/licenses/agpl-3.0.html"),
    ),
    servers(
        (url = "http://localhost:3000"),
        (url = "https://anmeldung.freestyle-cup.nrw"),
    ),
    // security(
    //     (),
    //     ("api_key" = [])
    // ),
)]
pub struct ApiDoc;

fn get_openapi_router() -> (Router, OpenApi) {
    let command_query_router = OpenApiRouter::new()
        .nest("/command", command::get_command_router())
        .nest("/query", query::get_query_router());
    OpenApiRouter::with_openapi(ApiDoc::openapi())
        .nest("/api", command_query_router)
        .split_for_parts()
}

pub fn get_api_router(
    http_options: Arc<HttpServerOptions>,
    db: ReloadableSqlite,
    mailer: Arc<Mailer>,
    jwt_config: Arc<JWTConfig>,
    status_options: Arc<StatusOptions>,
) -> Router {
    let (router, openapi) = get_openapi_router();
    router
        .merge(SwaggerUi::new("/swagger").url("/openapi.json", openapi))
        .layer(Extension(db))
        .layer(Extension(mailer))
        .layer(Extension(jwt_config))
        .layer(Extension(http_options))
        .layer(Extension(status_options))
}

#[must_use]
pub fn get_api_openapi() -> OpenApi {
    get_openapi_router().1
}

pub fn get_router(
    http_options: Arc<HttpServerOptions>,
    db: ReloadableSqlite,
    mailer: Arc<Mailer>,
    jwt_config: Arc<JWTConfig>,
    status_options: Arc<StatusOptions>,
) -> Router {
    let request_id_layer = ServiceBuilder::new()
        .layer(SetRequestIdLayer::new(
            HeaderName::from_static(REQUEST_ID_HEADER),
            MakeRequestUuid,
        ))
        .layer(
            TraceLayer::new_for_http().make_span_with(|request: &Request<axum::body::Body>| {
                // Log the request id as generated.
                let request_id = request.headers().get(REQUEST_ID_HEADER);
                let request_path = request.uri().path();

                if let Some(request_id) = request_id {
                    info_span!(
                        "http_request",
                        request_id = ?request_id,
                        request_path = ?request_path,
                    )
                } else {
                    error!("could not extract request_id");
                    info_span!("http_request")
                }
            }),
        )
        // send headers from request to response headers
        .layer(PropagateRequestIdLayer::new(HeaderName::from_static(
            REQUEST_ID_HEADER,
        )));

    let serve_assets = ServeEmbed::<StaticAssets>::with_parameters(
        Some("index.html".into()),
        FallbackBehavior::Ok,
        Some("index.html".into()),
    );

    Router::new()
        .fallback_service(serve_assets)
        .nest_service("/songs", ServeDir::new(http_options.data_path.clone()))
        .merge(get_api_router(
            http_options,
            db,
            mailer,
            jwt_config,
            status_options,
        ))
        .layer(request_id_layer)
}
