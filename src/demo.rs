//! Demo data for development and tests.
//!
//! A demo file (see `demo-data.toml`) describes a complete event: the
//! competition, categories and timeplan in the same format as the config file,
//! plus users, clubs, starters and act details. [`DemoData::apply`] writes it
//! into an empty, migrated database; the `seed_demo` binary recreates the
//! database before doing so.

use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
};

use password_auth::generate_hash;
use serde::Deserialize;
use time::{Date, OffsetDateTime, UtcOffset};
use tracing::info;
use uuid::Uuid;

use crate::{
    act_type::ActType,
    config::{
        CategoryConfig, CompetitionConfig, TimeplanEntryConfig, toml_date, toml_datetime_option,
    },
    seed, utils,
};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DemoData {
    pub competition: CompetitionConfig,
    #[serde(default)]
    pub categories: Vec<CategoryConfig>,
    #[serde(default)]
    pub timeplan: Vec<DemoTimeplanEntry>,
    #[serde(default)]
    pub users: Vec<DemoUser>,
    #[serde(default)]
    pub clubs: Vec<DemoClub>,
    #[serde(default)]
    pub acts: Vec<DemoAct>,
    /// Directory that relative `song_source` paths are resolved against.
    #[serde(skip)]
    pub base_dir: PathBuf,
}

/// A timeplan entry as in the config, plus its live state.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DemoTimeplanEntry {
    pub category: Option<String>,
    pub label: Option<String>,
    pub duration_minutes: Option<f64>,
    #[serde(default, deserialize_with = "toml_datetime_option")]
    pub earliest_start: Option<OffsetDateTime>,
    #[serde(default, deserialize_with = "toml_datetime_option")]
    pub started_at: Option<OffsetDateTime>,
    #[serde(default, deserialize_with = "toml_datetime_option")]
    pub ended_at: Option<OffsetDateTime>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DemoUser {
    pub name: String,
    pub email: String,
    pub password: String,
    #[serde(default)]
    pub admin: bool,
    #[serde(default = "default_true")]
    pub email_verified: bool,
    /// Pending email verification, usable at `/verify_email?token=…`.
    pub verification_token: Option<Uuid>,
    /// Pending password reset, usable at `/reset_password?token=…`.
    pub password_reset_token: Option<Uuid>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DemoClub {
    pub name: String,
    /// Name of the owning user.
    pub owner: String,
    /// Amount in € the club has paid.
    pub payment: Option<f64>,
    #[serde(default)]
    pub starters: Vec<DemoStarter>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Single {
    Male,
    Female,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DemoStarter {
    pub firstname: String,
    pub lastname: String,
    #[serde(deserialize_with = "toml_date")]
    pub birthdate: Date,
    pub single: Option<Single>,
    #[serde(default)]
    pub pair: bool,
    /// Full name of a registered pair partner, in any club. The partner is
    /// linked back automatically.
    pub partner: Option<String>,
    /// Name of a pair partner that isn't registered (yet).
    pub partner_name: Option<String>,
}

impl DemoStarter {
    fn full_name(&self) -> String {
        format!("{} {}", self.firstname, self.lastname)
    }
}

/// Details of an act. Acts themselves are created for every single starter and
/// linked pair; this selects one by a participant and sets its fields.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DemoAct {
    /// Full name of a participant.
    pub starter: String,
    pub act_type: ActType,
    pub name: Option<String>,
    pub description: Option<String>,
    /// File name of the song as shown in the UI. Without `song_source`, a short
    /// generated tone is stored.
    pub song: Option<String>,
    /// Audio file to store as the song, relative to the demo file.
    pub song_source: Option<PathBuf>,
    #[serde(default)]
    pub song_checked: bool,
    pub order: Option<i64>,
    #[serde(default, deserialize_with = "toml_datetime_option")]
    pub started_at: Option<OffsetDateTime>,
    #[serde(default, deserialize_with = "toml_datetime_option")]
    pub ended_at: Option<OffsetDateTime>,
}

impl DemoData {
    pub fn parse(content: &str) -> Result<Self, String> {
        toml::from_str(content).map_err(|e| e.to_string())
    }

    pub fn load(path: &Path) -> Result<Self, String> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| format!("Couldn't read demo file {}: {e}", path.display()))?;
        let mut data = Self::parse(&content)
            .map_err(|e| format!("Invalid demo file {}: {e}", path.display()))?;
        data.base_dir = path.parent().map(Path::to_path_buf).unwrap_or_default();
        Ok(data)
    }

    /// Writes the demo data into an empty, migrated database. Song files are
    /// stored in `data_path`.
    pub async fn apply(&self, db: &sqlx::SqlitePool, data_path: &Path) -> Result<(), String> {
        let db_error = |e: sqlx::Error| format!("Database error while seeding demo data: {e}");

        let timeplan: Vec<TimeplanEntryConfig> = self
            .timeplan
            .iter()
            .map(|entry| TimeplanEntryConfig {
                category: entry.category.clone(),
                label: entry.label.clone(),
                duration_minutes: entry.duration_minutes,
                earliest_start: entry.earliest_start,
            })
            .collect();
        seed::seed(db, Some(&self.competition), &self.categories, &timeplan).await?;

        let timeplan_ids: Vec<i64> =
            sqlx::query_scalar!(r#"SELECT id as "id!" FROM timeplan ORDER BY id"#)
                .fetch_all(db)
                .await
                .map_err(db_error)?;
        for (id, entry) in timeplan_ids.iter().zip(&self.timeplan) {
            let started_at = entry.started_at.map(utc);
            let ended_at = entry.ended_at.map(utc);
            sqlx::query!(
                "UPDATE timeplan SET started_at = ?, ended_at = ? WHERE id = ?",
                started_at,
                ended_at,
                id
            )
            .execute(db)
            .await
            .map_err(db_error)?;
        }

        let users = self.insert_users(db).await?;
        let starters = self.insert_clubs(db, &users).await?;
        self.link_partners(db, &starters).await?;

        utils::initialize_acts(db).await?;
        self.update_acts(db, &starters, data_path).await?;

        info!(
            "Seeded {} users, {} clubs and {} starters from the demo data",
            self.users.len(),
            self.clubs.len(),
            starters.len()
        );
        Ok(())
    }

    async fn insert_users(&self, db: &sqlx::SqlitePool) -> Result<HashMap<String, Uuid>, String> {
        let db_error = |e: sqlx::Error| format!("Database error while seeding users: {e}");
        let now = OffsetDateTime::now_utc();
        // Hashing is slow, so users sharing a password share its hash.
        let mut hashes: HashMap<&str, String> = HashMap::new();
        let mut ids = HashMap::new();
        for user in &self.users {
            let password = user.password.as_str();
            let hash = hashes
                .entry(password)
                .or_insert_with(|| generate_hash(password))
                .clone();
            let id = Uuid::now_v7();
            sqlx::query!(
                r#"
                INSERT INTO users (id, email, email_verified, name, password, is_admin)
                VALUES (?, ?, ?, ?, ?, ?)
                "#,
                id,
                user.email,
                user.email_verified,
                user.name,
                hash,
                user.admin,
            )
            .execute(db)
            .await
            .map_err(|e| format!("Couldn't insert user {}: {e}", user.name))?;
            if let Some(token) = user.verification_token {
                sqlx::query!(
                    "INSERT INTO mail_verification (id, user_id, created_at) VALUES (?, ?, ?)",
                    token,
                    id,
                    now
                )
                .execute(db)
                .await
                .map_err(db_error)?;
            }
            if let Some(token) = user.password_reset_token {
                sqlx::query!(
                    "INSERT INTO password_resets (id, user_id, created_at) VALUES (?, ?, ?)",
                    token,
                    id,
                    now
                )
                .execute(db)
                .await
                .map_err(db_error)?;
            }
            ids.insert(user.name.clone(), id);
        }
        Ok(ids)
    }

    /// Inserts the clubs and their starters, without partner links. Returns the
    /// starters by full name.
    async fn insert_clubs(
        &self,
        db: &sqlx::SqlitePool,
        users: &HashMap<String, Uuid>,
    ) -> Result<StarterIds<'_>, String> {
        let mut starters = StarterIds::default();
        for club in &self.clubs {
            let owner_id = *users.get(&club.owner).ok_or_else(|| {
                format!(
                    "Club {}: owner {} is not a demo user.",
                    club.name, club.owner
                )
            })?;
            let club_id = Uuid::now_v7();
            sqlx::query!(
                "INSERT INTO clubs (id, name, owner_id, payment) VALUES (?, ?, ?, ?)",
                club_id,
                club.name,
                owner_id,
                club.payment,
            )
            .execute(db)
            .await
            .map_err(|e| format!("Couldn't insert club {}: {e}", club.name))?;
            sqlx::query!(
                "UPDATE users SET club_id = ? WHERE id = ?",
                club_id,
                owner_id
            )
            .execute(db)
            .await
            .map_err(|e| format!("Couldn't assign club {}: {e}", club.name))?;

            for starter in &club.starters {
                let name = starter.full_name();
                if !starter.pair && (starter.partner.is_some() || starter.partner_name.is_some()) {
                    return Err(format!("Starter {name} has a partner but pair = false."));
                }
                if starter.partner.is_some() && starter.partner_name.is_some() {
                    return Err(format!(
                        "Starter {name}: set either partner or partner_name, not both."
                    ));
                }
                let id = Uuid::now_v7();
                let birthdate = starter.birthdate.midnight().assume_utc();
                let single_male = starter.single == Some(Single::Male);
                let single_female = starter.single == Some(Single::Female);
                sqlx::query!(
                    r#"
                    INSERT INTO starter (
                        id, club_id, firstname, lastname, birthdate,
                        single_male, single_female, pair, partner_name
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    "#,
                    id,
                    club_id,
                    starter.firstname,
                    starter.lastname,
                    birthdate,
                    single_male,
                    single_female,
                    starter.pair,
                    starter.partner_name,
                )
                .execute(db)
                .await
                .map_err(|e| format!("Couldn't insert starter {name}: {e}"))?;
                starters.insert(name, id, starter);
            }
        }
        Ok(starters)
    }

    async fn link_partners(
        &self,
        db: &sqlx::SqlitePool,
        starters: &StarterIds<'_>,
    ) -> Result<(), String> {
        let mut partners: HashMap<&str, &str> = HashMap::new();
        for starter in self.clubs.iter().flat_map(|club| &club.starters) {
            let Some(partner) = starter.partner.as_deref() else {
                continue;
            };
            let name = starter.full_name();
            let partner_starter = starters.starter(partner, &name)?;
            if !partner_starter.pair {
                return Err(format!(
                    "Starter {name}: partner {partner} has pair = false."
                ));
            }
            if partner_starter.partner_name.is_some()
                || partner_starter
                    .partner
                    .as_deref()
                    .is_some_and(|p| p != name)
            {
                return Err(format!(
                    "Starter {name}: partner {partner} already has another partner."
                ));
            }
            if partner == name {
                return Err(format!("Starter {name} can't be their own partner."));
            }
            let (name, partner) = (starters.name_ref(&name), starters.name_ref(partner));
            if let Some(other) = partners.get(name).filter(|p| **p != partner) {
                return Err(format!(
                    "Starter {name} is partner of both {other} and {partner}."
                ));
            }
            partners.insert(name, partner);
            partners.insert(partner, name);
        }

        for (name, partner) in partners {
            let partner_id = starters.id(partner, name)?;
            let id = starters.id(name, name)?;
            sqlx::query!(
                "UPDATE starter SET partner_id = ?, partner_name = ? WHERE id = ?",
                partner_id,
                partner,
                id
            )
            .execute(db)
            .await
            .map_err(|e| format!("Couldn't link partners {name} and {partner}: {e}"))?;
        }
        Ok(())
    }

    async fn update_acts(
        &self,
        db: &sqlx::SqlitePool,
        starters: &StarterIds<'_>,
        data_path: &Path,
    ) -> Result<(), String> {
        let mut seen = HashSet::new();
        for (index, act) in self.acts.iter().enumerate() {
            let starter_id = starters.id(&act.starter, "[[acts]]")?;
            let act_id = utils::get_act_id_for_starter_id(db, starter_id, act.act_type)
                .await?
                .ok_or_else(|| {
                    format!(
                        "[[acts]]: {} has no {} act. Singles need `single`, pairs a linked `partner`.",
                        act.starter,
                        act.act_type.as_str()
                    )
                })?;
            if !seen.insert(act_id) {
                return Err(format!(
                    "[[acts]]: the {} act of {} is described twice.",
                    act.act_type.as_str(),
                    act.starter
                ));
            }

            let (song_file, song_file_name) = match (&act.song, &act.song_source) {
                (None, None) => (None, None),
                (song, source) => {
                    let (content, extension) = match source {
                        Some(source) => {
                            let path = self.base_dir.join(source);
                            let content = std::fs::read(&path).map_err(|e| {
                                format!("Couldn't read song {}: {e}", path.display())
                            })?;
                            let extension = path
                                .extension()
                                .map(|e| e.to_string_lossy().into_owned())
                                .unwrap_or_else(|| "bin".to_string());
                            (content, extension)
                        }
                        None => (tone_wav(220.0 + 55.0 * (index % 8) as f64, 5), "wav".into()),
                    };
                    let file = format!("{act_id}.{extension}");
                    std::fs::create_dir_all(data_path).map_err(|e| {
                        format!("Couldn't create data path {}: {e}", data_path.display())
                    })?;
                    std::fs::write(data_path.join(&file), content)
                        .map_err(|e| format!("Couldn't write song {file}: {e}"))?;
                    let name = song.clone().unwrap_or_else(|| {
                        source
                            .as_ref()
                            .and_then(|s| s.file_name())
                            .map(|n| n.to_string_lossy().into_owned())
                            .unwrap_or_else(|| file.clone())
                    });
                    (Some(file), Some(name))
                }
            };

            let name = act.name.as_deref().unwrap_or("");
            let started_at = act.started_at.map(utc);
            let ended_at = act.ended_at.map(utc);
            sqlx::query!(
                r#"
                UPDATE acts SET
                    name = ?, description = ?, song_file = ?, song_file_name = ?,
                    song_checked = ?, "order" = ?, started_at = ?, ended_at = ?
                WHERE id = ?
                "#,
                name,
                act.description,
                song_file,
                song_file_name,
                act.song_checked,
                act.order,
                started_at,
                ended_at,
                act_id,
            )
            .execute(db)
            .await
            .map_err(|e| format!("Couldn't update the act of {}: {e}", act.starter))?;
        }
        Ok(())
    }
}

fn utc(datetime: OffsetDateTime) -> OffsetDateTime {
    datetime.to_offset(UtcOffset::UTC)
}

/// Starters by full name. Names used by more than one starter can't be
/// referenced.
#[derive(Default)]
struct StarterIds<'a> {
    by_name: HashMap<String, Option<(Uuid, &'a DemoStarter)>>,
}

impl<'a> StarterIds<'a> {
    fn insert(&mut self, name: String, id: Uuid, starter: &'a DemoStarter) {
        self.by_name
            .entry(name)
            .and_modify(|entry| *entry = None)
            .or_insert(Some((id, starter)));
    }

    fn len(&self) -> usize {
        self.by_name.len()
    }

    fn get(&self, name: &str, referenced_by: &str) -> Result<(Uuid, &'a DemoStarter), String> {
        match self.by_name.get(name) {
            Some(Some(entry)) => Ok(*entry),
            Some(None) => Err(format!(
                "{referenced_by}: starter name {name} is ambiguous, it's used more than once."
            )),
            None => Err(format!("{referenced_by}: starter {name} doesn't exist.")),
        }
    }

    fn id(&self, name: &str, referenced_by: &str) -> Result<Uuid, String> {
        self.get(name, referenced_by).map(|(id, _)| id)
    }

    fn starter(&self, name: &str, referenced_by: &str) -> Result<&'a DemoStarter, String> {
        self.get(name, referenced_by).map(|(_, starter)| starter)
    }

    /// The stored key for `name`, so it can be borrowed from `self`.
    fn name_ref(&self, name: &str) -> &str {
        self.by_name
            .get_key_value(name)
            .map(|(key, _)| key.as_str())
            .expect("name was resolved before")
    }
}

/// A mono 16-bit PCM WAV file with a sine tone.
fn tone_wav(frequency: f64, seconds: u32) -> Vec<u8> {
    const SAMPLE_RATE: u32 = 8000;
    let samples = SAMPLE_RATE * seconds;
    let data_len = samples * 2;
    let mut wav = Vec::with_capacity(44 + data_len as usize);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_len).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes()); // PCM
    wav.extend_from_slice(&1u16.to_le_bytes()); // mono
    wav.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    wav.extend_from_slice(&(SAMPLE_RATE * 2).to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());
    for i in 0..samples {
        let t = i as f64 / SAMPLE_RATE as f64;
        let sample = (t * frequency * std::f64::consts::TAU).sin() * 0.3 * i16::MAX as f64;
        wav.extend_from_slice(&(sample as i16).to_le_bytes());
    }
    wav
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEMO: &str = include_str!("../demo-data.toml");

    async fn count(db: &sqlx::SqlitePool, sql: &'static str) -> i64 {
        sqlx::query_scalar(sql).fetch_one(db).await.unwrap()
    }

    fn data_dir() -> PathBuf {
        std::env::temp_dir().join(format!("cup-demo-test-{}", Uuid::new_v4()))
    }

    #[sqlx::test]
    async fn demo_file_fills_every_table(db: sqlx::SqlitePool) {
        let data = DemoData::parse(DEMO).unwrap();
        let data_path = data_dir();
        data.apply(&db, &data_path).await.unwrap();

        for (table, sql) in [
            ("competition", "SELECT COUNT(*) FROM competition"),
            ("users", "SELECT COUNT(*) FROM users"),
            (
                "mail_verification",
                "SELECT COUNT(*) FROM mail_verification",
            ),
            ("password_resets", "SELECT COUNT(*) FROM password_resets"),
            ("clubs", "SELECT COUNT(*) FROM clubs"),
            ("starter", "SELECT COUNT(*) FROM starter"),
            ("acts", "SELECT COUNT(*) FROM acts"),
            ("act_participants", "SELECT COUNT(*) FROM act_participants"),
            ("categories", "SELECT COUNT(*) FROM categories"),
            ("timeplan", "SELECT COUNT(*) FROM timeplan"),
        ] {
            assert!(count(&db, sql).await > 0, "{table} is empty");
        }

        // Every act lands in a category, so it shows up in the startlist.
        assert_eq!(
            count(&db, "SELECT COUNT(*) FROM view_act WHERE category IS NULL").await,
            0
        );
        // Partner links are symmetric.
        assert_eq!(
            count(
                &db,
                "SELECT COUNT(*) FROM starter s JOIN starter p ON p.id = s.partner_id WHERE p.partner_id IS NOT s.id"
            )
            .await,
            0
        );
        let songs: Vec<String> =
            sqlx::query_scalar("SELECT song_file FROM acts WHERE song_file IS NOT NULL")
                .fetch_all(&db)
                .await
                .unwrap();
        assert!(!songs.is_empty());
        for song in songs {
            assert!(data_path.join(&song).exists(), "{song}");
        }
        std::fs::remove_dir_all(data_path).unwrap();
    }

    #[sqlx::test]
    async fn unknown_partner_is_rejected(db: sqlx::SqlitePool) {
        let mut data = DemoData::parse(DEMO).unwrap();
        let starter = &mut data.clubs[0].starters[0];
        starter.pair = true;
        starter.partner = Some("Niemand Unbekannt".into());
        starter.partner_name = None;
        let err = data.apply(&db, &data_dir()).await.unwrap_err();
        assert!(err.contains("Niemand Unbekannt"), "{err}");
    }

    #[test]
    fn tone_has_a_valid_wav_header() {
        let wav = tone_wav(440.0, 1);
        assert_eq!(&wav[..4], b"RIFF");
        assert_eq!(wav.len(), 44 + 8000 * 2);
    }
}
