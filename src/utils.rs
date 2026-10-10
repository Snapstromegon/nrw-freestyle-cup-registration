use std::collections::HashSet;

use uuid::Uuid;

/// Checks that a password satisfies the registration password policy.
///
/// A password must be at least 8 bytes long and contain characters from at
/// least three of these categories: lowercase letters, uppercase letters,
/// digits and special characters. The returned error is a user-facing
/// (German) message.
///
/// ```
/// use nrw_freestyle_cup_registration::utils::check_password;
///
/// assert!(check_password("Secret123").is_ok());
/// assert!(check_password("geheim-123").is_ok());
///
/// // Too short
/// assert!(check_password("Ab1!").is_err());
/// // Only two categories (lowercase and digits)
/// assert!(check_password("password123").is_err());
/// ```
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

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::SqlitePool;
    use time::{Date, Month, OffsetDateTime};

    #[test]
    fn password_shorter_than_eight_is_rejected() {
        let err = check_password("Ab1!xyz").unwrap_err();
        assert!(err.contains("mindestens 8 Zeichen"), "{err}");
    }

    #[test]
    fn password_with_exactly_eight_chars_and_three_categories_is_accepted() {
        assert_eq!(check_password("Abcdefg1"), Ok(()));
    }

    #[test]
    fn password_with_two_categories_is_rejected() {
        for password in [
            "abcdefgh1",
            "ABCDEFGH1",
            "abcdEFGH",
            "abcd!efgh",
            "1234!5678",
        ] {
            let err = check_password(password).unwrap_err();
            assert!(
                err.contains("3 der folgenden Kategorien"),
                "{password}: {err}"
            );
        }
    }

    #[test]
    fn password_with_three_or_four_categories_is_accepted() {
        for password in [
            "abcdEFGH1",
            "abcd!efg1",
            "ABCD!EFG1",
            "abcd!EFGH",
            "aB1!aB1!",
        ] {
            assert_eq!(check_password(password), Ok(()), "{password}");
        }
    }

    #[test]
    fn space_and_backslash_count_as_special_characters() {
        assert_eq!(check_password("abcd efg1"), Ok(()));
        assert_eq!(check_password("abcd\\efg1"), Ok(()));
    }

    #[test]
    fn non_ascii_letters_count_as_letters() {
        // "Ä" is uppercase, "ö" lowercase.
        assert_eq!(check_password("Äöxxxxx1"), Ok(()));
    }

    #[test]
    fn length_check_happens_before_category_check() {
        let err = check_password("abc").unwrap_err();
        assert!(err.contains("mindestens 8 Zeichen"), "{err}");
    }

    fn birthdate(year: i32) -> OffsetDateTime {
        Date::from_calendar_date(year, Month::May, 1)
            .unwrap()
            .midnight()
            .assume_utc()
    }

    async fn insert_club(db: &SqlitePool) -> Uuid {
        let owner_id = Uuid::now_v7();
        sqlx::query(
            "INSERT INTO users (id, email, email_verified, name, password, is_admin) VALUES (?, ?, true, ?, 'x', false)",
        )
        .bind(owner_id)
        .bind(format!("{owner_id}@example.com"))
        .bind(owner_id.to_string())
        .execute(db)
        .await
        .unwrap();
        let club_id = Uuid::now_v7();
        sqlx::query("INSERT INTO clubs (id, name, owner_id) VALUES (?, ?, ?)")
            .bind(club_id)
            .bind(club_id.to_string())
            .bind(owner_id)
            .execute(db)
            .await
            .unwrap();
        club_id
    }

    async fn insert_starter(
        db: &SqlitePool,
        club_id: Uuid,
        firstname: &str,
        single: bool,
        pair: bool,
        partner_id: Option<Uuid>,
    ) -> Uuid {
        let id = Uuid::now_v7();
        sqlx::query(
            r#"
            INSERT INTO starter (id, club_id, firstname, lastname, birthdate, single_sonderpokal,
                single_male, single_female, pair_sonderpokal, pair, partner_id)
            VALUES (?, ?, ?, 'Test', ?, false, false, ?, false, ?, ?)
            "#,
        )
        .bind(id)
        .bind(club_id)
        .bind(firstname)
        .bind(birthdate(2012))
        .bind(single)
        .bind(pair)
        .bind(partner_id)
        .execute(db)
        .await
        .unwrap();
        id
    }

    async fn link_partners(db: &SqlitePool, a: Uuid, b: Uuid) {
        for (id, partner) in [(a, b), (b, a)] {
            sqlx::query("UPDATE starter SET partner_id = ? WHERE id = ?")
                .bind(partner)
                .bind(id)
                .execute(db)
                .await
                .unwrap();
        }
    }

    async fn count_acts(db: &SqlitePool, is_pair: bool) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM acts WHERE is_pair = ?")
            .bind(is_pair)
            .fetch_one(db)
            .await
            .unwrap()
    }

    #[sqlx::test]
    async fn set_act_creates_act_with_participants(db: SqlitePool) {
        let club_id = insert_club(&db).await;
        let a = insert_starter(&db, club_id, "Anna", false, true, None).await;
        let b = insert_starter(&db, club_id, "Berta", false, true, None).await;

        let act_id = set_act(&db, "Duo", &[a, b], Some("Beschreibung"), true)
            .await
            .unwrap();

        let (name, description, is_pair): (String, Option<String>, bool) =
            sqlx::query_as("SELECT name, description, is_pair FROM acts WHERE id = ?")
                .bind(act_id)
                .fetch_one(&db)
                .await
                .unwrap();
        assert_eq!(name, "Duo");
        assert_eq!(description.as_deref(), Some("Beschreibung"));
        assert!(is_pair);

        let participants: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM act_participants WHERE act_id = ?")
                .bind(act_id)
                .fetch_one(&db)
                .await
                .unwrap();
        assert_eq!(participants, 2);
    }

    #[sqlx::test]
    async fn get_act_id_for_starter_id_distinguishes_single_and_pair(db: SqlitePool) {
        let club_id = insert_club(&db).await;
        let starter = insert_starter(&db, club_id, "Anna", true, false, None).await;

        assert_eq!(
            get_act_id_for_starter_id(&db, starter, false).await,
            Ok(None)
        );

        let act_id = set_act(&db, "", &[starter], None, false).await.unwrap();

        assert_eq!(
            get_act_id_for_starter_id(&db, starter, false).await,
            Ok(Some(act_id))
        );
        assert_eq!(
            get_act_id_for_starter_id(&db, starter, true).await,
            Ok(None)
        );
    }

    #[sqlx::test]
    async fn delete_act_removes_act_and_participants(db: SqlitePool) {
        let club_id = insert_club(&db).await;
        let starter = insert_starter(&db, club_id, "Anna", true, false, None).await;
        let act_id = set_act(&db, "", &[starter], None, false).await.unwrap();

        delete_act(&db, act_id).await.unwrap();

        assert_eq!(count_acts(&db, false).await, 0);
        let participants: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM act_participants")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(participants, 0);
    }

    #[sqlx::test]
    async fn delete_act_reports_missing_act(db: SqlitePool) {
        assert_eq!(
            delete_act(&db, Uuid::new_v4()).await,
            Err("Kür nicht gefunden.".to_string())
        );
    }

    #[sqlx::test]
    async fn initialize_acts_creates_missing_single_and_pair_acts(db: SqlitePool) {
        let club_id = insert_club(&db).await;
        let single = insert_starter(&db, club_id, "Solo", true, false, None).await;
        let a = insert_starter(&db, club_id, "Anna", false, true, None).await;
        let b = insert_starter(&db, club_id, "Berta", false, true, None).await;
        link_partners(&db, a, b).await;
        // A pair starter without a partner must not get an act.
        insert_starter(&db, club_id, "Lonely", false, true, None).await;

        initialize_acts(&db).await.unwrap();

        assert_eq!(count_acts(&db, false).await, 1);
        assert_eq!(count_acts(&db, true).await, 1);
        assert!(
            get_act_id_for_starter_id(&db, single, false)
                .await
                .unwrap()
                .is_some()
        );
        let pair_act_a = get_act_id_for_starter_id(&db, a, true).await.unwrap();
        let pair_act_b = get_act_id_for_starter_id(&db, b, true).await.unwrap();
        assert!(pair_act_a.is_some());
        assert_eq!(pair_act_a, pair_act_b);
    }

    #[sqlx::test]
    async fn initialize_acts_is_idempotent(db: SqlitePool) {
        let club_id = insert_club(&db).await;
        insert_starter(&db, club_id, "Solo", true, false, None).await;
        let a = insert_starter(&db, club_id, "Anna", false, true, None).await;
        let b = insert_starter(&db, club_id, "Berta", false, true, None).await;
        link_partners(&db, a, b).await;

        initialize_acts(&db).await.unwrap();
        initialize_acts(&db).await.unwrap();

        assert_eq!(count_acts(&db, false).await, 1);
        assert_eq!(count_acts(&db, true).await, 1);
    }
}
