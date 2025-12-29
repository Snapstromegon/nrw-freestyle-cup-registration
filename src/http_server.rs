use std::{path::PathBuf, sync::Arc};

use axum::{Json, response::IntoResponse};
use serde::Serialize;
use tracing::info;

use crate::{
    jwt::JWTConfig, mailer::Mailer, reloadable_sqlite::ReloadableSqlite,
    system_status::StatusOptions,
};

pub mod extractor;
pub mod routes;

#[derive(Debug, thiserror::Error)]
pub enum HttpError {
    #[error("Template error: {0}")]
    TemplateError(#[from] askama::Error),
    #[error("Not found")]
    NotFound,
    #[error("Internal server error")]
    InternalServerError,
    #[error("Database error: {0}")]
    DBError(#[from] sqlx::Error),
    #[error("Mail error: {0}")]
    MailError(#[from] lettre::transport::smtp::Error),
    #[error("{0}")]
    ErrorMessages(String),
    #[error("Invalid credentials")]
    InvalidCredentials,
    #[error("Status code: {0}")]
    StatusCode(axum::http::StatusCode),
}

impl IntoResponse for HttpError {
    fn into_response(self) -> axum::response::Response {
        ClientError::from(self).into_response()
    }
}

#[derive(Debug, thiserror::Error, Serialize, utoipa::ToSchema)]
#[serde(tag = "type", content = "message")]
pub enum ClientError {
    #[error("Not found")]
    NotFound,
    #[error("Internal server error")]
    InternalServerError,
    #[error("Invalid credentials")]
    InvalidCredentials,
    #[error("{0}")]
    Generic(String),
    #[error("Status code: {0}")]
    StatusCode(u16),
}

impl From<HttpError> for ClientError {
    fn from(e: HttpError) -> Self {
        match e {
            HttpError::TemplateError(e) => ClientError::Generic(format!("Template error: {:?}", e)),
            HttpError::NotFound => ClientError::NotFound,
            HttpError::InternalServerError => ClientError::InternalServerError,
            HttpError::DBError(e) => ClientError::Generic(format!("Database error: {:?}", e)),
            HttpError::MailError(e) => ClientError::Generic(format!("Mail error: {:?}", e)),
            HttpError::ErrorMessages(e) => ClientError::Generic(format!("{e:?}")),
            HttpError::InvalidCredentials => ClientError::InvalidCredentials,
            HttpError::StatusCode(code) => ClientError::StatusCode(code.as_u16()),
        }
    }
}

impl IntoResponse for ClientError {
    fn into_response(self) -> axum::http::Response<axum::body::Body> {
        (
            match &self {
                Self::NotFound => axum::http::StatusCode::NOT_FOUND,
                Self::InternalServerError => axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Self::Generic(_) => axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Self::InvalidCredentials => axum::http::StatusCode::UNAUTHORIZED,
                Self::StatusCode(code) => axum::http::StatusCode::from_u16(*code).unwrap(),
            },
            Json(self),
        )
            .into_response()
    }
}

#[derive(Debug, Clone)]
pub struct HttpServerOptions {
    pub bind_address: String,
    pub base_url: String,
    pub data_path: PathBuf,
    pub reload_db_token: String,
}

pub struct HttpServer {
    db: ReloadableSqlite,
    mailer: Arc<Mailer>,
    jwt: Arc<JWTConfig>,
    options: Arc<HttpServerOptions>,
    status_options: Arc<StatusOptions>,
}

impl HttpServer {
    pub fn new(
        options: HttpServerOptions,
        db: ReloadableSqlite,
        jwt: Arc<JWTConfig>,
        mailer: Arc<Mailer>,
        status_options: Arc<StatusOptions>,
    ) -> Self {
        Self {
            db,
            mailer,
            options: Arc::new(options),
            jwt,
            status_options,
        }
    }

    pub fn start<F>(&mut self, shutdown_signal: F) -> tokio::task::JoinHandle<()>
    where
        F: std::future::Future<Output = ()> + Send + 'static,
    {
        let app = routes::get_router(
            self.options.clone(),
            self.db.clone(),
            self.mailer.clone(),
            self.jwt.clone(),
            self.status_options.clone(),
        );
        let address = self.options.bind_address.clone();

        tokio::spawn(async move {
            info!("Starting server on {}", address);
            let listener = tokio::net::TcpListener::bind(address).await.unwrap();
            axum::serve(listener, app)
                .with_graceful_shutdown(shutdown_signal)
                .await
                .unwrap();
        })
    }
}
