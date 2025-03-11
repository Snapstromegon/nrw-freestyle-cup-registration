use std::{collections::HashMap, path::Path, sync::Arc};

use axum::{
    Extension, Json,
    extract::{Multipart, Query},
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use tokio::{
    fs::{DirBuilder, File},
    io::AsyncWriteExt,
};
use tracing::instrument;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    http_server::{ClientError, HttpError, HttpServerOptions, extractor::auth::Auth},
    reloadable_sqlite::ReloadableSqlite,
    system_status::Capabilities,
};

#[derive(Debug, Serialize, ToSchema)]
pub struct SaveActSongResponse {}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SaveActSongQuery {
    act_id: Uuid,
}

pub type Metadata = HashMap<String, String>;

#[derive(ToSchema, Debug)]
pub struct Upload {
    #[allow(dead_code)]
    #[schema(value_type = String, format = Binary)]
    pub file_content: Vec<u8>,
    #[allow(dead_code)]
    pub metadata: Option<Metadata>,
}

/// EditClubAct a new user.
///
/// This endpoint is used to create a new user.
#[utoipa::path(
    post,
    tags=["command", "club"],
    path="/save_act_song",
    request_body=Upload,
    responses(
        (status=200, content_type="application/json", body=SaveActSongResponse),
        (status=400, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn save_act_song(
    Extension(db): Extension<ReloadableSqlite>,
    http_options: Extension<Arc<HttpServerOptions>>,
    auth: Auth,
    capabilities: Capabilities,
    Query(query): Query<SaveActSongQuery>,
    mut body: Multipart,
) -> Result<Json<SaveActSongResponse>, HttpError> {
    let db = db.get().await.clone();
    let entry = body
        .next_field()
        .await
        .map_err(|_e| HttpError::InternalServerError)?
        .ok_or(HttpError::StatusCode(StatusCode::BAD_REQUEST))?;

    let file_name = entry
        .file_name()
        .ok_or(HttpError::StatusCode(StatusCode::BAD_REQUEST))?
        .to_string();

    let extension = Path::new(&file_name)
        .extension()
        .ok_or(HttpError::StatusCode(StatusCode::BAD_REQUEST))?;

    let save_file_name = format!("{}.{}", query.act_id, extension.to_string_lossy());

    let path = http_options.data_path.join(&save_file_name);
    let data = entry
        .bytes()
        .await
        .map_err(|_e| HttpError::InternalServerError)?;
    DirBuilder::new()
        .recursive(true)
        .create(path.parent().unwrap())
        .await
        .map_err(|e| HttpError::ErrorMessages(e.to_string()))?;
    File::create(&path)
        .await
        .map_err(|e| HttpError::ErrorMessages(e.to_string()))?
        .write_all(&data)
        .await
        .map_err(|e| HttpError::ErrorMessages(e.to_string()))?;
    sqlx::query!(
        r#"
        UPDATE acts
        SET song_file_name = ?, song_file = ?
        WHERE id = ?
        "#,
        file_name,
        save_file_name,
        query.act_id,
    )
    .execute(&db)
    .await?;

    Ok(Json(SaveActSongResponse {}))
}
