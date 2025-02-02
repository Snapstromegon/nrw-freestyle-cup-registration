use axum::{extract::Query, Extension, Json};
use sqlx::SqlitePool;
use tracing::instrument;
use uuid::Uuid;

use crate::http_server::{ClientError, HttpError};

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct ClubAct {
    id: Uuid,
    name: String,
    description: Option<String>,
    song_file_name: Option<String>,
    song_file: Option<String>,
    is_pair: bool,
    is_sonderpokal: bool,
    #[serde(with = "time::serde::iso8601")]
    created_at: time::OffsetDateTime,
    participants: Vec<ActParticipant>,
}

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct ActParticipant {
    id: Uuid,
    starter_firstname: String,
    starter_lastname: String,
    #[serde(with = "time::serde::iso8601")]
    birthdate: time::OffsetDateTime,
}

#[derive(Debug, serde::Deserialize, utoipa::IntoParams)]
pub struct ListClubActsQuery {
    club_id: Uuid,
}

/// Get information about a club.
#[utoipa::path(
    get,
    tags=["query", "club"],
    params(ListClubActsQuery),
    path="/list_club_acts",
    responses(
        (status=200, content_type="application/json", body=Vec<ClubAct>),
        (status=404, content_type="application/json", body=ClientError),
        (status=500, content_type="application/json", body=ClientError),
    ),
)]
#[instrument(skip(db))]
#[axum::debug_handler]
pub async fn list_club_acts(
    Extension(db): Extension<SqlitePool>,
    Query(query): Query<ListClubActsQuery>,
) -> Result<Json<Vec<ClubAct>>, HttpError> {
    let acts_with_club_participation = sqlx::query!(
        r#"
        SELECT DISTINCT
            acts.id as "id!: Uuid",
            acts.name,
            acts.description,
            acts.song_file_name,
            acts.song_file,
            acts.is_pair,
            acts.created_at as "created_at!: time::OffsetDateTime"
        FROM acts
        JOIN act_participants ON acts.id = act_participants.act_id
        JOIN starter ON act_participants.starter_id = starter.id
        WHERE starter.club_id = ?
        ORDER BY acts.id
        "#,
        query.club_id
    )
    .fetch_all(&db)
    .await?;

    let mut club_acts: Vec<ClubAct> = Vec::with_capacity(acts_with_club_participation.len());
    for act in acts_with_club_participation {
        let participants = sqlx::query!(
            r#"
            SELECT
                starter.id as "id!: Uuid",
                starter.firstname,
                starter.lastname,
                starter.birthdate,
                starter.pair_sonderpokal,
                starter.single_sonderpokal
            FROM act_participants
            JOIN starter ON act_participants.starter_id = starter.id
            WHERE act_participants.act_id = ?
            "#,
            act.id
        )
        .fetch_all(&db)
        .await?;

        club_acts.push(ClubAct {
            id: act.id,
            name: act.name,
            description: act.description,
            song_file_name: act.song_file_name,
            song_file: act.song_file,
            is_pair: act.is_pair,
            created_at: act.created_at,
            is_sonderpokal: participants.iter().any(|participant| {
                if act.is_pair {
                    participant.pair_sonderpokal
                } else {
                    participant.single_sonderpokal
                }
            }),
            participants: participants
                .into_iter()
                .map(|participant| ActParticipant {
                    id: participant.id,
                    starter_firstname: participant.firstname,
                    starter_lastname: participant.lastname,
                    birthdate: participant.birthdate,
                })
                .collect(),
        });
    }

    Ok(Json(club_acts))
}
