use std::{path::PathBuf, str::FromStr, sync::Arc};

use clap::Parser;
use nrw_freestyle_cup_registration::{
    http_server::{HttpServer, HttpServerOptions},
    jwt::JWTConfig,
    mailer::Mailer,
};
use password_auth::generate_hash;
use serde::Deserialize;
use tracing::info;
use tracing_subscriber::FmtSubscriber;
use url::Url;
use uuid::Uuid;

#[derive(Debug, Parser)]
struct Args {
    #[clap(long, default_value = "http://localhost:3000", env = "BASE_URL")]
    pub base_url: Url,
    #[clap(long, env = "HTTP_ADDRESS", default_value = "127.0.0.1:3000")]
    pub http_address: String,
    #[clap(long, env = "SMTP_SERVER")]
    pub smtp_server: String,
    #[clap(long, env = "SMTP_USER")]
    pub smtp_username: String,
    #[clap(long, env = "SMTP_PASSWORD")]
    pub smtp_password: String,
    #[clap(
        long,
        default_value = "sqlite://./db.sqlite?mode=rwc",
        env = "DATABASE"
    )]
    pub db: PathBuf,
    #[clap(long, default_value = "./data", env = "data")]
    pub data: PathBuf,
    #[clap(long, env = "JWT_SECRET", default_value = "supersecretsupersecret")]
    pub jwt_secret: String,
    #[clap(long, env = "ADMIN")]
    pub admin: Option<AdminArgs>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct AdminArgs {
    pub name: String,
    pub email: String,
    pub password: String,
}

impl FromStr for AdminArgs {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let res: AdminArgs = serde_json::from_str(s)?;
        Ok(res)
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    let args = Args::parse();
    FmtSubscriber::builder()
        .with_max_level(tracing::Level::INFO)
        .with_target(true)
        .with_file(true)
        .with_line_number(true)
        .init();

    info!("Starting server with args: {:?}", args);

    let mailer = Mailer::new(
        &args.smtp_server,
        &args.smtp_username,
        &args.smtp_password,
        &args.smtp_username,
    );

    let db = sqlx::sqlite::SqlitePool::connect(&args.db.to_string_lossy())
        .await
        .expect("Couldn't connect to database");

    info!("{:?}", args.admin);
    if let Some(admin) = &args.admin {
        insert_admin_user(&db, &admin.name, &admin.email, &admin.password).await?;
    }

    let jwt_algorithm = jsonwebtoken::Algorithm::HS512;
    let mut validator = jsonwebtoken::Validation::new(jwt_algorithm);
    validator.validate_aud = false;
    let jwt_config = JWTConfig::new(
        jsonwebtoken::EncodingKey::from_secret(args.jwt_secret.as_bytes()),
        jsonwebtoken::DecodingKey::from_secret(args.jwt_secret.as_bytes()),
        jwt_algorithm,
        validator,
    );

    HttpServer::new(
        HttpServerOptions {
            bind_address: args.http_address,
            base_url: args.base_url.to_string(),
        },
        db,
        Arc::new(jwt_config),
        Arc::new(mailer),
    )
    .start()
    .await?;

    Ok(())
}

async fn admin_user_exists(db: &sqlx::SqlitePool) -> anyhow::Result<bool> {
    let result = sqlx::query!(
        r#"
        SELECT COUNT(*) as count FROM users WHERE is_admin = true
        "#,
    )
    .fetch_one(db)
    .await?;
    Ok(result.count > 0)
}

async fn insert_admin_user(
    db: &sqlx::SqlitePool,
    name: &str,
    email: &str,
    password: &str,
) -> anyhow::Result<()> {
    if admin_user_exists(db).await? {
        return Ok(());
    }
    let hash = generate_hash(password);
    let id = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO users (id, email, email_verified, name, password, is_admin)
        VALUES (?, ?, true, ?, ?, true)
        "#,
        id,
        email,
        name,
        hash
    )
    .execute(db)
    .await?;
    Ok(())
}
