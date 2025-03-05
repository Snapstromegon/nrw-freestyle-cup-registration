use std::fmt::Debug;

use axum_extra::extract::{
    CookieJar,
    cookie::{Cookie, SameSite},
};
use jsonwebtoken::{DecodingKey, EncodingKey};
use uuid::Uuid;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct JWTClaims {
    sub: Uuid,
    exp: u64,
}

impl JWTClaims {
    #[must_use]
    pub fn new(sub: Uuid, exp: u64) -> Self {
        Self { sub, exp }
    }

    #[must_use]
    pub fn sub(&self) -> Uuid {
        self.sub
    }

    #[must_use]
    pub fn exp(&self) -> u64 {
        self.exp
    }
}

#[derive(Clone)]
pub struct JWTConfig {
    encoding_key: EncodingKey,
    decode_key: DecodingKey,
    algorithm: jsonwebtoken::Algorithm,
    validation: jsonwebtoken::Validation,
    validity: std::time::Duration,
}

impl JWTConfig {
    #[must_use]
    pub fn new(
        encoding_key: EncodingKey,
        decode_key: DecodingKey,
        algorithm: jsonwebtoken::Algorithm,
        validation: jsonwebtoken::Validation,
    ) -> Self {
        Self {
            encoding_key,
            decode_key,
            algorithm,
            validation,
            validity: std::time::Duration::from_secs(60 * 60 * 24 * 31 * 6),
        }
    }

    #[must_use]
    pub fn get_header(&self) -> jsonwebtoken::Header {
        jsonwebtoken::Header::new(self.algorithm)
    }

    #[must_use]
    pub fn encoding_key(&self) -> &EncodingKey {
        &self.encoding_key
    }

    #[must_use]
    pub fn decode_key(&self) -> &DecodingKey {
        &self.decode_key
    }

    #[must_use]
    pub fn validation(&self) -> &jsonwebtoken::Validation {
        &self.validation
    }

    pub fn create_user_token(&self, user_id: Uuid) -> Result<String, jsonwebtoken::errors::Error> {
        let claims = JWTClaims::new(
            user_id,
            (std::time::SystemTime::now() + self.validity)
                .duration_since(std::time::SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        );
        jsonwebtoken::encode(&self.get_header(), &claims, self.encoding_key())
    }

    pub fn add_jwt_cookie(
        &self,
        cookies: CookieJar,
        user_id: Uuid,
    ) -> Result<CookieJar, jsonwebtoken::errors::Error> {
        Ok(cookies.add(
            Cookie::build(("jwt", self.create_user_token(user_id)?))
                .http_only(true)
                .secure(true)
                .max_age(time::Duration::try_from(self.validity).unwrap())
                .path("/")
                .same_site(SameSite::Strict)
                .build(),
        ))
    }
}

impl Debug for JWTConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("JWTConfig")
            .field("encoding_key", &"...")
            .field("decode_key", &"...")
            .field("algorithm", &self.algorithm)
            .field("validation", &self.validation)
            .field("validity", &self.validity)
            .finish()
    }
}
