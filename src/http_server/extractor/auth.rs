use std::sync::Arc;

use axum::{
    extract::{FromRequestParts, OptionalFromRequestParts},
    http::{StatusCode, request::Parts},
    response::IntoResponse,
};
use axum_extra::extract::CookieJar;
use tracing::error;
use uuid::Uuid;

use crate::{
    jwt::{JWTClaims, JWTConfig},
    reloadable_sqlite::ReloadableSqlite,
};

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
        self.is_admin
    }
}

impl<S> FromRequestParts<S> for Auth
where
    S: Send + Sync,
{
    type Rejection = Error;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        <Auth as OptionalFromRequestParts<S>>::from_request_parts(parts, state)
            .await?
            .ok_or(Error::JwtMissing)
    }
}

impl<S: Send + Sync> OptionalFromRequestParts<S> for Auth {
    type Rejection = Error;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &S,
    ) -> Result<Option<Self>, Self::Rejection> {
        let cookies = CookieJar::from_request_parts(parts, state)
            .await
            .or(Err(Error::CookiesMissing))?;

        if let Some(jwt) = cookies.get("jwt") {
            let jwt_config = parts.extensions.get::<Arc<JWTConfig>>().unwrap();

            let token_data = jsonwebtoken::decode::<JWTClaims>(
                jwt.value_trimmed(),
                jwt_config.decode_key(),
                jwt_config.validation(),
            )
            .map_err(|_| Error::JwtInvalid)?;
            let user_id = token_data.claims.sub();
            let db = parts.extensions.get::<ReloadableSqlite>().unwrap();
            let user = sqlx::query!(
                r#"
                SELECT email, name, is_admin, club_id as "club_id: Uuid", email_verified FROM users WHERE id = ?
                "#,
                user_id,
            )
            .fetch_optional(&db.get().await.clone())
            .await
            .map_err(|e| {
                error!("Couldn't load the user: {e}");
                Error::Database
            })?
            .ok_or(Error::UserNotFound)?;
            Ok(Some(Auth {
                user_id,
                email: user.email,
                name: user.name,
                is_admin: user.is_admin,
                club_id: user.club_id,
                email_verified: user.email_verified,
            }))
        } else {
            Ok(None)
        }
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
    /// The token is valid, but its user was deleted.
    #[error("User not found")]
    UserNotFound,
    /// The user couldn't be loaded, e.g. because the database is busy.
    #[error("Database error")]
    Database,
}

impl IntoResponse for Error {
    fn into_response(self) -> axum::response::Response<axum::body::Body> {
        let status = match self {
            Error::AdminRequired => StatusCode::FORBIDDEN,
            Error::CookiesMissing | Error::JwtInvalid | Error::JwtMissing | Error::UserNotFound => {
                StatusCode::UNAUTHORIZED
            }
            Error::Database => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, self.to_string()).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_errors_map_to_expected_status_codes() {
        let cases = [
            (Error::AdminRequired, StatusCode::FORBIDDEN),
            (Error::CookiesMissing, StatusCode::UNAUTHORIZED),
            (Error::JwtMissing, StatusCode::UNAUTHORIZED),
            (Error::JwtInvalid, StatusCode::UNAUTHORIZED),
            (Error::UserNotFound, StatusCode::UNAUTHORIZED),
            (Error::Database, StatusCode::INTERNAL_SERVER_ERROR),
        ];
        for (error, expected) in cases {
            let message = error.to_string();
            assert_eq!(error.into_response().status(), expected, "{message}");
        }
    }
}
