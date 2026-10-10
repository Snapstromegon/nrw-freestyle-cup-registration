use clap::Parser;
use eyre::eyre;
use nrw_freestyle_cup_registration::{
    competition::Competition,
    config::{CliArgs, ConfigFile, Settings},
    http_server::{HttpServer, HttpServerOptions},
    jwt::JWTConfig,
    mailer::Mailer,
    reloadable_sqlite::ReloadableSqlite,
    seed, utils,
};
use password_auth::generate_hash;
use sqlx::migrate;
use std::sync::Arc;
use tokio::signal;
use tracing::{info, warn};
use tracing_subscriber::FmtSubscriber;
use uuid::Uuid;

#[tokio::main]
async fn main() -> eyre::Result<()> {
    color_eyre::install()?;
    dotenvy::dotenv().ok();
    let cli = CliArgs::parse();
    FmtSubscriber::builder()
        .with_max_level(tracing::Level::INFO)
        .with_target(true)
        .with_file(true)
        .with_line_number(true)
        .init();

    info!("Starting registration system.");
    let config_file = ConfigFile::load(cli.config.as_deref()).map_err(|e| eyre!(e))?;
    let settings = Settings::resolve(cli, config_file).map_err(|e| eyre!(e))?;
    for warning in &settings.warnings {
        warn!("{warning}");
    }

    info!("Build Mail client");

    let mailer = Mailer::new(
        &settings.smtp_server,
        &settings.smtp_username,
        &settings.smtp_password,
        &settings.smtp_username,
    );

    info!("Connecting to database");

    let db = sqlx::sqlite::SqlitePool::connect(&settings.database_url)
        .await
        .expect("Couldn't connect to database");

    info!("Running database migrations");
    migrate!("./migrations").run(&db).await?;

    info!("Applying event settings from the config");
    seed::seed(
        &db,
        settings.competition.as_ref(),
        &settings.categories,
        &settings.timeplan,
    )
    .await
    .map_err(|e| eyre!(e))?;
    let competition = Competition::current(&db).await?.ok_or_else(|| {
        eyre!("No competition configured. Add a [competition] section to the config file (see config.example.toml).")
    })?;
    info!(
        "Running competition {} ({})",
        competition.name, competition.id
    );

    if let Some(admin) = &settings.admin {
        info!("Inserting admin user with email: {}", admin.email);
        insert_admin_user(&db, &admin.name, &admin.email, &admin.password).await?;
    }

    info!("Initializing acts");
    utils::initialize_acts(&db).await.unwrap();

    info!("Build JWT config");
    let jwt_algorithm = jsonwebtoken::Algorithm::HS512;
    let mut validator = jsonwebtoken::Validation::new(jwt_algorithm);
    validator.validate_aud = false;
    let jwt_config = JWTConfig::new(
        jsonwebtoken::EncodingKey::from_secret(settings.jwt_secret.as_bytes()),
        jsonwebtoken::DecodingKey::from_secret(settings.jwt_secret.as_bytes()),
        jwt_algorithm,
        validator,
        settings.insecure_cookies,
    );

    info!("Starting HTTP server");
    HttpServer::new(
        HttpServerOptions {
            bind_address: settings.http_address,
            base_url: settings.base_url.to_string(),
            data_path: settings.data_path,
            reload_db_token: settings.reload_db_token,
        },
        ReloadableSqlite::new(db, settings.database_url),
        Arc::new(jwt_config),
        Arc::new(mailer),
    )
    .start(shutdown_signal())
    .await?;

    Ok(())
}

async fn admin_user_exists(db: &sqlx::SqlitePool) -> sqlx::Result<bool> {
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
) -> sqlx::Result<()> {
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

async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    info!("Waiting for shutdown signal (Ctrl+C or SIGTERM)");

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}
