use std::sync::Arc;

use axum::{extract::FromRequestParts, http::request::Parts};
use time::OffsetDateTime;

use crate::http_server::extractor::auth::Auth;

#[derive(Debug, Clone, Copy, serde::Serialize, utoipa::ToSchema)]
pub struct Capabilities {
    pub can_register: bool,
    pub can_create_club: bool,
    pub can_register_starter: bool,
    pub can_register_judge: bool,
    pub can_upload_music: bool,
}

#[derive(Debug, Clone)]
pub struct StatusOptions {
    pub start_register_date: OffsetDateTime,
    pub end_register_date: OffsetDateTime,
    pub end_music_upload_date: OffsetDateTime,
}

impl StatusOptions {
    pub fn get_system_status(&self) -> Capabilities {
        let now = OffsetDateTime::now_utc();

        let in_register_period = now >= self.start_register_date && now <= self.end_register_date;

        Capabilities {
            can_register: in_register_period,
            can_create_club: in_register_period,
            can_register_starter: in_register_period,
            can_register_judge: in_register_period,
            can_upload_music: now <= self.end_music_upload_date,
        }
    }
}

impl<S> FromRequestParts<S> for Capabilities
where
    S: Send + Sync,
{
    type Rejection = ();
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        if let Ok(auth) = Auth::from_request_parts(parts, state).await {
            if auth.is_admin() {
                return Ok(Capabilities {
                    can_register: true,
                    can_create_club: true,
                    can_register_starter: true,
                    can_register_judge: true,
                    can_upload_music: true,
                });
            }
        }
        let status_options = parts.extensions.get::<Arc<StatusOptions>>().unwrap();
        Ok(status_options.get_system_status())
    }
}
