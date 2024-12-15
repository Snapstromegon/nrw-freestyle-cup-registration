use std::sync::Arc;

use axum::{
    async_trait,
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
    response::IntoResponse,
};
use axum_extra::extract::CookieJar;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::jwt::{JWTClaims, JWTConfig};

#[derive(Debug)]
pub struct Auth {
    pub user_id: Uuid,
    pub email: String,
    pub name: String,
    pub is_admin: bool,
    pub club_id: Option<Uuid>,
    pub email_verified: bool,
}

impl Auth {
    pub fn is_admin(&self) -> bool {
        self.user_id == Uuid::nil()
    }
}

#[async_trait]
impl<S> FromRequestParts<S> for Auth
where
    S: Send + Sync,
{
    type Rejection = Error;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let cookies = CookieJar::from_request_parts(parts, state)
            .await
            .or(Err(Error::CookiesMissing))?;

        let jwt = cookies.get("jwt").ok_or(Error::JwtMissing)?;

        let jwt_config = parts.extensions.get::<Arc<JWTConfig>>().unwrap();

        let token_data = jsonwebtoken::decode::<JWTClaims>(
            jwt.value_trimmed(),
            jwt_config.decode_key(),
            jwt_config.validation(),
        )
        .map_err(|_| Error::JwtInvalid)?;
        let user_id = token_data.claims.sub();
        let db = parts.extensions.get::<SqlitePool>().unwrap();
        let user = sqlx::query!(
            r#"
            SELECT email, name, is_admin, club_id as "club_id: Uuid", email_verified FROM users WHERE id = ?
            "#,
            user_id,
        )
        .fetch_one(db)
        .await
        .map_err(|_| Error::UserNotFound)?;
        Ok(Auth {
            user_id,
            email: user.email,
            name: user.name,
            is_admin: user.is_admin,
            club_id: user.club_id,
            email_verified: user.email_verified,
        })
    }
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Admin required")]
    AdminRequired,
    #[error("Cookies missing")]
    CookiesMissing,
    #[error("JWT missing")]
    JwtMissing,
    #[error("JWT invalid")]
    JwtInvalid,
    #[error("User not found")]
    UserNotFound,
}

impl IntoResponse for Error {
    fn into_response(self) -> axum::response::Response<axum::body::Body> {
        let status = match self {
            Error::AdminRequired => StatusCode::FORBIDDEN,
            Error::CookiesMissing | Error::JwtInvalid | Error::JwtMissing => {
                StatusCode::UNAUTHORIZED
            }
            Error::UserNotFound => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, self.to_string()).into_response()
    }
}
