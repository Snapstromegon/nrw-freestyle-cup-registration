use std::collections::HashSet;

use uuid::Uuid;

pub fn check_password(password: &str) -> Result<(), String> {
    if password.len() < 8 {
        return Err("Passwort muss mindestens 8 Zeichen haben.".to_string());
    }

    let mut categories = 0;
    if password.chars().any(|c| c.is_uppercase()) {
        categories += 1;
    }
    if password.chars().any(|c| c.is_lowercase()) {
        categories += 1;
    }
    if password.chars().any(|c| c.is_numeric()) {
        categories += 1;
    }
    if r#"!"§$%&/()=?+-*#'_~.,:;<>|\\ {[]}"#
        .chars()
        .any(|s| password.chars().any(|c| s == c))
    {
        categories += 1;
    }

    if categories < 3 {
        return Err("Passwort muss mindestens 3 der folgenden Kategorien enthalten: Kleinbuchstaben, Großbuchstaben, Zahlen, Sonderzeichen.".to_string());
    }

    Ok(())
}

pub async fn get_act_id_for_starter_id(
    db: &sqlx::SqlitePool,
    starter_id: Uuid,
    is_pair: bool,
) -> Result<Option<Uuid>, String> {
    let act_id = sqlx::query!(
        r#"
        SELECT act_id as "act_id: Uuid" FROM act_participants LEFT JOIN acts ON act_participants.act_id = acts.id WHERE starter_id = ? AND is_pair = ?
        "#,
        starter_id,
        is_pair
    )
    .fetch_optional(db)
    .await
    .map_err(|e| format!("Fehler beim Abfragen der Kür-ID: {}", e))?;
    Ok(act_id.map(|act_id| act_id.act_id))
}

pub async fn delete_act(db: &sqlx::SqlitePool, act_id: Uuid) -> Result<(), String> {
    let result = sqlx::query!(
        r#"
        DELETE FROM acts WHERE id = ?
        "#,
        act_id,
    )
    .execute(db)
    .await
    .map_err(|e| format!("Fehler beim Löschen der Kür: {}", e))?;

    if result.rows_affected() == 0 {
        return Err("Kür nicht gefunden.".to_string());
    }

    Ok(())
}

pub async fn set_act(
    db: &sqlx::SqlitePool,
    name: &str,
    starters: &[Uuid],
    description: Option<&str>,
    is_pair: bool,
) -> Result<Uuid, String> {
    let id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO acts (id, name, description, is_pair)
        VALUES (?, ?, ?, ?)
        "#,
        id,
        name,
        description,
        is_pair
    )
    .execute(db)
    .await
    .map_err(|e| format!("Fehler beim Hinzufügen der Kür: {}", e))?;

    for starter in starters {
        sqlx::query!(
            r#"
            INSERT INTO act_participants (act_id, starter_id)
            VALUES (?, ?)
            "#,
            id,
            starter
        )
        .execute(db)
        .await
        .map_err(|e| format!("Fehler beim Hinzufügen des Starters zur Kür: {}", e))?;
    }

    Ok(id)
}

pub async fn initialize_acts(db: &sqlx::SqlitePool) -> Result<(), String> {
    // Singles
    let single_starters = sqlx::query!(
        r#"
        SELECT id as "id!: Uuid" FROM starter WHERE single_male = TRUE or single_female = TRUE
        "#
    )
    .fetch_all(db)
    .await
    .map_err(|e| format!("Fehler beim Abfragen der Einzelstarter: {}", e))?;
    for starter in single_starters {
        if get_act_id_for_starter_id(db, starter.id, false)
            .await?
            .is_none()
        {
            set_act(db, "", &[starter.id], None, false).await?;
        }
    }

    // Pairs
    let pair_starters = sqlx::query!(
        r#"
        SELECT id as "id!: Uuid", partner_id as "partner_id!: Uuid" FROM starter WHERE pair = TRUE and partner_id IS NOT NULL
        "#
    ).fetch_all(db).await.map_err(|e| format!("Fehler beim Abfragen der Paare: {}", e))?;

    let mut covered = HashSet::new();

    for pair_starter in pair_starters {
        if !covered.contains(&pair_starter.id) {
            if get_act_id_for_starter_id(db, pair_starter.id, true)
                .await?
                .is_none()
            {
                set_act(
                    db,
                    "",
                    &[pair_starter.id, pair_starter.partner_id],
                    None,
                    true,
                )
                .await?;
            }
            covered.insert(pair_starter.id);
            covered.insert(pair_starter.partner_id);
        }
    }

    Ok(())
}
