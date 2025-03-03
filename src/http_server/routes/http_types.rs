use uuid::Uuid;

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct User {
    pub id: Uuid,
    pub name: String,
    pub email: String,
    pub email_verified: bool,
    pub is_admin: bool,
    pub club_id: Option<Uuid>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, utoipa::ToSchema, Clone)]
pub struct ActParticipant {
    pub firstname: String,
    pub lastname: String,
    pub id: Uuid,
    pub club_name: String,
}

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct Act {
    pub id: Uuid,
    pub name: String,
    pub song_file: Option<String>,
    pub description: Option<String>,
    pub song_file_name: Option<String>,
    pub song_checked: bool,
    pub is_pair: Option<bool>,
    pub max_age: Option<f64>,
    pub is_sonderpokal: Option<bool>,
    pub participants: Vec<ActParticipant>,
    pub category: Option<String>,
    pub act_order: Option<i64>,
    pub category_order: Option<i64>,
}
