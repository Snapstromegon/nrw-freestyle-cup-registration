use std::sync::Arc;

use axum::response::IntoResponse;
use sqlx::SqlitePool;
use tracing::{error, info};

use crate::{jwt::JWTConfig, mailer::Mailer};

pub mod routes;
pub mod extractor;

#[derive(Debug, thiserror::Error)]
pub enum HttpError {
    #[error("Not found")]
    NotFound,
    #[error("Internal server error")]
    InternalServerError,
    #[error("Database error: {0}")]
    DBError(#[from] sqlx::Error),
    #[error("Error messages: {0}")]
    ErrorMessages(String),
    #[error("Invalid credentials")]
    InvalidCredentials,
}

impl IntoResponse for HttpError {
    fn into_response(self) -> axum::http::Response<axum::body::Body> {
        match self {
            HttpError::NotFound => axum::http::StatusCode::NOT_FOUND.into_response(),
            HttpError::InternalServerError => {
                axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response()
            }
            HttpError::DBError(e) => {
                error!("Database error: {:?}", e);
                axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response()
            }
            HttpError::ErrorMessages(e) => {
                error!("Error messages: {:?}", e);
                (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e).into_response()
            }
            HttpError::InvalidCredentials => {
                error!("Invalid credentials");
                axum::http::StatusCode::UNAUTHORIZED.into_response()
            }
        }
    }
}

#[derive(Debug, Clone)]
pub struct HttpServerOptions {
    pub bind_address: String,
    pub base_url: String,
}

pub struct HttpServer {
    db: SqlitePool,
    mailer: Arc<Mailer>,
    jwt: Arc<JWTConfig>,
    options: Arc<HttpServerOptions>,
}

impl HttpServer {
    pub fn new(
        options: HttpServerOptions,
        db: SqlitePool,
        jwt: Arc<JWTConfig>,
        mailer: Arc<Mailer>,
    ) -> Self {
        Self {
            db,
            mailer,
            options: Arc::new(options),
            jwt,
        }
    }

    pub fn start(&mut self) -> tokio::task::JoinHandle<()> {
        let app = routes::get_router(self.options.clone(), self.db.clone(), self.mailer.clone(), self.jwt.clone());
        let address = self.options.bind_address.clone();

        tokio::spawn(async move {
            info!("Starting server on {}", address);
            let listener = tokio::net::TcpListener::bind(address).await.unwrap();
            axum::serve(listener, app).await.unwrap();
        })
    }
}
