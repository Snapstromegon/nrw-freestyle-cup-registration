//! Seeds the competition, categories and timeplan from the config file.
//!
//! The competition is inserted or updated on every start, so the config file
//! stays the source of truth for event settings. Categories and the timeplan
//! are only seeded into empty tables, so changes admins make in the UI are
//! never overwritten.

use std::collections::{BTreeMap, HashSet};

use time::{Date, Duration, Month, OffsetDateTime};
use tracing::{info, warn};

use crate::{
    act_type::ActType,
    competition::{Competition, upsert_competition},
    config::{CategoryConfig, CompetitionConfig, TimeplanEntryConfig},
};

/// Lower birthday bound for categories without a maximum age.
pub const OPEN_FROM_BIRTHDAY: Date = time::macros::date!(1900 - 01 - 01);
/// Upper birthday bound for categories without a minimum age.
pub const OPEN_TO_BIRTHDAY: Date = time::macros::date!(9999 - 12 - 31);

/// A category from the config with its birthday bounds calculated.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedCategory {
    pub name: String,
    pub description: Option<String>,
    pub act_type: ActType,
    pub single_male: bool,
    /// Inclusive.
    pub from_birthday: Date,
    /// Exclusive.
    pub to_birthday: Date,
    pub einfahrzeit_seconds: i64,
    pub act_duration_seconds: i64,
    pub judge_duration_seconds: i64,
}

/// The date `years` years before `day`. Fractions are rounded to whole months,
/// so `9.5` means 9 years and 6 months. Days that don't exist in the target
/// month (e.g. 29 February) move to the month's last day.
///
/// ```
/// use nrw_freestyle_cup_registration::seed::years_before;
/// use time::macros::date;
///
/// assert_eq!(years_before(date!(2027 - 06 - 01), 15.0), date!(2012 - 06 - 01));
/// assert_eq!(years_before(date!(2027 - 06 - 01), 9.5), date!(2017 - 12 - 01));
/// assert_eq!(years_before(date!(2028 - 02 - 29), 1.0), date!(2027 - 02 - 28));
/// ```
pub fn years_before(day: Date, years: f64) -> Date {
    let months = (years * 12.0).round() as i32;
    let total = day.year() * 12 + (day.month() as i32 - 1) - months;
    let year = total.div_euclid(12);
    let month = Month::try_from((total.rem_euclid(12) + 1) as u8).expect("valid month");
    let mut day_of_month = day.day();
    loop {
        if let Ok(date) = Date::from_calendar_date(year, month, day_of_month) {
            return date;
        }
        day_of_month -= 1;
    }
}

fn minutes_to_seconds(minutes: f64, field: &str, category: &str) -> Result<i64, String> {
    if minutes < 0.0 || !minutes.is_finite() {
        return Err(format!(
            "Category {category}: {field} must not be negative."
        ));
    }
    Ok((minutes * 60.0).round() as i64)
}

/// Calculates the birthday bounds of all categories against `determining_day`
/// and validates them.
///
/// A rider is "under N" if they haven't had their N-th birthday on the
/// determining day, so `under_age = N` gives
/// `from_birthday = determining_day - N years + 1 day`. `min_age = M` gives
/// `to_birthday = determining_day - M years + 1 day` (exclusive).
pub fn resolve_categories(
    categories: &[CategoryConfig],
    determining_day: Date,
) -> Result<Vec<ResolvedCategory>, String> {
    let mut names = HashSet::new();
    let mut resolved = Vec::with_capacity(categories.len());
    for category in categories {
        let name = &category.name;
        if name.trim().is_empty() {
            return Err("A category has an empty name.".to_string());
        }
        if !names.insert(name.clone()) {
            return Err(format!("Category {name} is defined more than once."));
        }
        for age in [category.min_age, category.under_age].into_iter().flatten() {
            if age < 0.0 || !age.is_finite() {
                return Err(format!("Category {name}: ages must not be negative."));
            }
        }
        if let (Some(min), Some(under)) = (category.min_age, category.under_age)
            && min >= under
        {
            return Err(format!(
                "Category {name}: min_age ({min}) must be lower than under_age ({under})."
            ));
        }

        let from_birthday = match (category.from_birthday, category.under_age) {
            (Some(date), _) => date,
            (None, Some(under)) => years_before(determining_day, under) + Duration::days(1),
            (None, None) => OPEN_FROM_BIRTHDAY,
        };
        let to_birthday = match (category.to_birthday, category.min_age) {
            (Some(date), _) => date,
            (None, Some(min)) => years_before(determining_day, min) + Duration::days(1),
            (None, None) => OPEN_TO_BIRTHDAY,
        };
        if from_birthday >= to_birthday {
            return Err(format!(
                "Category {name}: from_birthday ({from_birthday}) must be before to_birthday ({to_birthday})."
            ));
        }

        resolved.push(ResolvedCategory {
            name: name.clone(),
            description: category.description.clone(),
            act_type: category.act_type,
            single_male: category.single_male,
            from_birthday,
            to_birthday,
            einfahrzeit_seconds: minutes_to_seconds(
                category.einfahrzeit_minutes,
                "einfahrzeit_minutes",
                name,
            )?,
            act_duration_seconds: minutes_to_seconds(
                category.act_duration_minutes,
                "act_duration_minutes",
                name,
            )?,
            judge_duration_seconds: minutes_to_seconds(
                category.judge_duration_minutes,
                "judge_duration_minutes",
                name,
            )?,
        });
    }
    Ok(resolved)
}

/// Finds overlapping or missing birthday ranges among categories that compete
/// for the same riders (same act type and gender filter).
pub fn coverage_warnings(categories: &[ResolvedCategory]) -> Vec<String> {
    let mut groups: BTreeMap<(&str, bool), Vec<&ResolvedCategory>> = BTreeMap::new();
    for category in categories {
        groups
            .entry((category.act_type.as_str(), category.single_male))
            .or_default()
            .push(category);
    }

    let mut warnings = Vec::new();
    for ((act_type, single_male), mut group) in groups {
        group.sort_by_key(|c| c.from_birthday);
        let label = format!("{act_type}{}", if single_male { ", male" } else { "" });
        if group[0].from_birthday > OPEN_FROM_BIRTHDAY {
            warnings.push(format!(
                "Categories ({label}): riders born before {} match no category.",
                group[0].from_birthday
            ));
        }
        for pair in group.windows(2) {
            let (current, next) = (pair[0], pair[1]);
            if next.from_birthday < current.to_birthday {
                warnings.push(format!(
                    "Categories ({label}): {} and {} overlap.",
                    current.name, next.name
                ));
            } else if next.from_birthday > current.to_birthday {
                warnings.push(format!(
                    "Categories ({label}): riders born from {} to before {} match neither {} nor {}.",
                    current.to_birthday, next.from_birthday, current.name, next.name
                ));
            }
        }
        let last = group
            .iter()
            .max_by_key(|c| c.to_birthday)
            .expect("group isn't empty");
        if last.to_birthday < OPEN_TO_BIRTHDAY {
            warnings.push(format!(
                "Categories ({label}): riders born on or after {} match no category.",
                last.to_birthday
            ));
        }
    }
    warnings
}

/// Checks that every timeplan entry is either a category entry for a known
/// category or a custom entry with a label and a duration.
pub fn validate_timeplan(
    timeplan: &[TimeplanEntryConfig],
    category_names: &[String],
) -> Result<(), String> {
    for (index, entry) in timeplan.iter().enumerate() {
        let position = index + 1;
        match (&entry.category, &entry.label) {
            (Some(category), None) => {
                if !category_names.contains(category) {
                    return Err(format!(
                        "Timeplan entry {position}: category {category} doesn't exist."
                    ));
                }
                if entry.duration_minutes.is_some() {
                    return Err(format!(
                        "Timeplan entry {position}: category entries get their duration from the category, remove duration_minutes."
                    ));
                }
            }
            (None, Some(label)) => {
                if label.trim().is_empty() {
                    return Err(format!("Timeplan entry {position}: label is empty."));
                }
                match entry.duration_minutes {
                    Some(minutes) if minutes >= 0.0 && minutes.is_finite() => {}
                    Some(_) => {
                        return Err(format!(
                            "Timeplan entry {position}: duration_minutes must not be negative."
                        ));
                    }
                    None => {
                        return Err(format!(
                            "Timeplan entry {position} ({label}): custom entries need duration_minutes."
                        ));
                    }
                }
            }
            (Some(_), Some(_)) => {
                return Err(format!(
                    "Timeplan entry {position}: set either category or label, not both."
                ));
            }
            (None, None) => {
                return Err(format!(
                    "Timeplan entry {position}: set either category or label."
                ));
            }
        }
    }
    Ok(())
}

fn midnight_utc(date: Date) -> OffsetDateTime {
    date.midnight().assume_utc()
}

/// Applies the event settings from the config to the database in one
/// transaction. Nothing is written if the config is invalid.
pub async fn seed(
    db: &sqlx::SqlitePool,
    competition: Option<&CompetitionConfig>,
    categories: &[CategoryConfig],
    timeplan: &[TimeplanEntryConfig],
) -> Result<(), String> {
    let db_error = |e: sqlx::Error| format!("Database error while seeding: {e}");
    let mut tx = db.begin().await.map_err(db_error)?;

    if let Some(competition) = competition {
        upsert_competition(&mut *tx, competition)
            .await
            .map_err(db_error)?;
        info!("Applied competition {} from the config", competition.id);
    }

    let category_count: i64 =
        sqlx::query_scalar!(r#"SELECT COUNT(*) as "count!: i64" FROM categories"#)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_error)?;
    if category_count == 0 && !categories.is_empty() {
        let determining_day = Competition::current(&mut *tx)
            .await
            .map_err(db_error)?
            .map(|c| c.determining_day)
            .ok_or("Categories need a [competition] with a determining_day.")?;
        let resolved = resolve_categories(categories, determining_day)?;
        for warning in coverage_warnings(&resolved) {
            warn!("{warning}");
        }
        for (index, category) in resolved.iter().enumerate() {
            let order = index as i64 + 1;
            let from_birthday = midnight_utc(category.from_birthday);
            let to_birthday = midnight_utc(category.to_birthday);
            sqlx::query!(
                r#"
                INSERT INTO categories (
                    name, description, from_birthday, to_birthday, act_type,
                    is_single_male, "order", einfahrzeit_seconds, act_duration_seconds, judge_duration_seconds
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                "#,
                category.name,
                category.description,
                from_birthday,
                to_birthday,
                category.act_type,
                category.single_male,
                order,
                category.einfahrzeit_seconds,
                category.act_duration_seconds,
                category.judge_duration_seconds,
            )
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        }
        info!("Seeded {} categories from the config", resolved.len());
    } else if !categories.is_empty() {
        info!("Categories already present, [[categories]] in the config is ignored");
    }

    let timeplan_count: i64 =
        sqlx::query_scalar!(r#"SELECT COUNT(*) as "count!: i64" FROM timeplan"#)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_error)?;
    if timeplan_count == 0 && !timeplan.is_empty() {
        let category_names: Vec<String> =
            sqlx::query_scalar!(r#"SELECT name as "name!" FROM categories"#)
                .fetch_all(&mut *tx)
                .await
                .map_err(db_error)?;
        validate_timeplan(timeplan, &category_names)?;
        for entry in timeplan {
            let duration_seconds = entry.duration_minutes.map(|m| (m * 60.0).round() as i64);
            sqlx::query!(
                r#"
                INSERT INTO timeplan (earliest_start_time, duration_seconds, label, category)
                VALUES (?, ?, ?, ?)
                "#,
                entry.earliest_start,
                duration_seconds,
                entry.label,
                entry.category,
            )
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        }
        info!("Seeded {} timeplan entries from the config", timeplan.len());
    } else if !timeplan.is_empty() {
        info!("Timeplan already present, [[timeplan]] in the config is ignored");
    }

    tx.commit().await.map_err(db_error)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ConfigFile;
    use time::macros::date;

    const DAY: Date = date!(2027 - 06 - 01);

    fn categories(toml: &str) -> Vec<CategoryConfig> {
        ConfigFile::parse(toml).unwrap().categories
    }

    fn category(name: &str, min: Option<f64>, under: Option<f64>) -> String {
        let mut s = format!("[[categories]]\nname = \"{name}\"\nact_type = \"single\"\n");
        if let Some(min) = min {
            s += &format!("min_age = {min}\n");
        }
        if let Some(under) = under {
            s += &format!("under_age = {under}\n");
        }
        s
    }

    #[test]
    fn age_bounds_follow_the_determining_day() {
        let config =
            categories(&(category("U15", None, Some(15.0)) + &category("15+", Some(15.0), None)));
        let resolved = resolve_categories(&config, DAY).unwrap();
        assert_eq!(resolved[0].from_birthday, date!(2012 - 06 - 02));
        assert_eq!(resolved[0].to_birthday, OPEN_TO_BIRTHDAY);
        assert_eq!(resolved[1].from_birthday, OPEN_FROM_BIRTHDAY);
        assert_eq!(resolved[1].to_birthday, date!(2012 - 06 - 02));
        assert!(coverage_warnings(&resolved).is_empty());
    }

    #[test]
    fn half_years_are_supported() {
        let config = categories(
            &(category("U9,5", None, Some(9.5)) + &category("U11", Some(9.5), Some(11.0))),
        );
        let resolved = resolve_categories(&config, DAY).unwrap();
        assert_eq!(resolved[0].from_birthday, date!(2017 - 12 - 02));
        assert_eq!(resolved[1].from_birthday, date!(2016 - 06 - 02));
        assert_eq!(resolved[1].to_birthday, date!(2017 - 12 - 02));
    }

    #[test]
    fn explicit_birthdays_override_ages() {
        let config = categories(
            "[[categories]]\nname = \"X\"\nact_type = \"pair\"\nunder_age = 15\nfrom_birthday = 2000-01-01\n",
        );
        let resolved = resolve_categories(&config, DAY).unwrap();
        assert_eq!(resolved[0].from_birthday, date!(2000 - 01 - 01));
    }

    #[test]
    fn invalid_categories_are_rejected() {
        let duplicate = categories(&(category("A", None, None) + &category("A", None, None)));
        assert!(
            resolve_categories(&duplicate, DAY)
                .unwrap_err()
                .contains("more than once")
        );

        let inverted = categories(&category("A", Some(15.0), Some(11.0)));
        assert!(
            resolve_categories(&inverted, DAY)
                .unwrap_err()
                .contains("lower than")
        );
    }

    #[test]
    fn durations_are_converted_to_seconds() {
        let config = categories(
            "[[categories]]\nname = \"A\"\nact_type = \"single\"\nact_duration_minutes = 3\njudge_duration_minutes = 4.5\n",
        );
        let resolved = resolve_categories(&config, DAY).unwrap();
        assert_eq!(resolved[0].act_duration_seconds, 180);
        assert_eq!(resolved[0].judge_duration_seconds, 270);
        assert_eq!(resolved[0].einfahrzeit_seconds, 0);
    }

    #[test]
    fn gaps_and_overlaps_are_reported() {
        let gap =
            categories(&(category("U11", None, Some(11.0)) + &category("15+", Some(15.0), None)));
        let warnings = coverage_warnings(&resolve_categories(&gap, DAY).unwrap());
        assert_eq!(warnings.len(), 1, "{warnings:?}");
        assert!(warnings[0].contains("match neither"), "{warnings:?}");

        let overlap =
            categories(&(category("U15", None, Some(15.0)) + &category("11+", Some(11.0), None)));
        let warnings = coverage_warnings(&resolve_categories(&overlap, DAY).unwrap());
        assert!(warnings[0].contains("overlap"), "{warnings:?}");

        let open_end = categories(&category("U15", None, Some(15.0)));
        let warnings = coverage_warnings(&resolve_categories(&open_end, DAY).unwrap());
        assert!(warnings[0].contains("born before"), "{warnings:?}");
    }

    #[test]
    fn timeplan_entries_are_validated() {
        let names = vec!["NEM".to_string()];
        let parse = |toml: &str| ConfigFile::parse(toml).unwrap().timeplan;

        assert!(validate_timeplan(&parse("[[timeplan]]\ncategory = \"NEM\""), &names).is_ok());
        assert!(
            validate_timeplan(
                &parse("[[timeplan]]\nlabel = \"Pause\"\nduration_minutes = 30"),
                &names
            )
            .is_ok()
        );
        let unknown = validate_timeplan(&parse("[[timeplan]]\ncategory = \"XYZ\""), &names);
        assert!(unknown.unwrap_err().contains("doesn't exist"));
        let no_duration = validate_timeplan(&parse("[[timeplan]]\nlabel = \"Pause\""), &names);
        assert!(no_duration.unwrap_err().contains("duration_minutes"));
        let both = validate_timeplan(
            &parse("[[timeplan]]\ncategory = \"NEM\"\nlabel = \"Pause\""),
            &names,
        );
        assert!(both.unwrap_err().contains("not both"));
    }

    const CONFIG: &str = r#"
        [competition]
        id = "cup"
        name = "Cup"
        location = "Halle"
        start_date = 2027-06-05
        end_date = 2027-06-06
        determining_day = 2027-06-01
        registration_start = 2026-11-01T00:00:00+01:00
        registration_end = 2027-04-30T23:59:59+02:00
        music_upload_end = 2027-05-20T23:59:59+02:00
        fee_per_start = 15

        [[categories]]
        name = "U15"
        act_type = "single"
        under_age = 15

        [[categories]]
        name = "15+"
        act_type = "single"
        min_age = 15

        [[timeplan]]
        category = "U15"
        earliest_start = 2027-06-05T10:00:00+02:00

        [[timeplan]]
        label = "Pause"
        duration_minutes = 30

        [[timeplan]]
        category = "15+"
    "#;

    async fn seed_config(db: &sqlx::SqlitePool, toml: &str) -> Result<(), String> {
        let file = ConfigFile::parse(toml).unwrap();
        seed(
            db,
            file.competition.as_ref(),
            &file.categories,
            &file.timeplan,
        )
        .await
    }

    async fn count(db: &sqlx::SqlitePool, table: &str) -> i64 {
        sqlx::query_scalar(sqlx::AssertSqlSafe(format!("SELECT COUNT(*) FROM {table}")))
            .fetch_one(db)
            .await
            .unwrap()
    }

    #[sqlx::test]
    async fn migrations_leave_tables_empty(db: sqlx::SqlitePool) {
        for table in [
            "competition",
            "categories",
            "timeplan",
            "users",
            "clubs",
            "starter",
            "acts",
        ] {
            assert_eq!(count(&db, table).await, 0, "{table}");
        }
    }

    #[sqlx::test]
    async fn seeds_empty_database(db: sqlx::SqlitePool) {
        seed_config(&db, CONFIG).await.unwrap();

        let competition = Competition::current(&db).await.unwrap().unwrap();
        assert_eq!(competition.determining_day, DAY);
        assert_eq!(competition.max_fee_per_starter, None);
        let categories: Vec<(String, i64)> =
            sqlx::query_as(r#"SELECT name, "order" FROM categories ORDER BY "order""#)
                .fetch_all(&db)
                .await
                .unwrap();
        assert_eq!(
            categories,
            vec![("U15".to_string(), 1), ("15+".to_string(), 2)]
        );
        assert_eq!(count(&db, "timeplan").await, 3);
    }

    #[sqlx::test]
    async fn second_run_keeps_admin_changes_but_updates_competition(db: sqlx::SqlitePool) {
        seed_config(&db, CONFIG).await.unwrap();
        sqlx::query("UPDATE categories SET description = 'edited' WHERE name = 'U15'")
            .execute(&db)
            .await
            .unwrap();

        seed_config(&db, &CONFIG.replace("name = \"Cup\"", "name = \"Cup 2\""))
            .await
            .unwrap();

        let description: Option<String> =
            sqlx::query_scalar("SELECT description FROM categories WHERE name = 'U15'")
                .fetch_one(&db)
                .await
                .unwrap();
        assert_eq!(description.as_deref(), Some("edited"));
        assert_eq!(count(&db, "categories").await, 2);
        assert_eq!(count(&db, "timeplan").await, 3);
        assert_eq!(count(&db, "competition").await, 1);
        assert_eq!(
            Competition::current(&db).await.unwrap().unwrap().name,
            "Cup 2"
        );
    }

    #[sqlx::test]
    async fn invalid_config_writes_nothing(db: sqlx::SqlitePool) {
        let invalid = CONFIG.replace("category = \"15+\"", "category = \"missing\"");
        let err = seed_config(&db, &invalid).await.unwrap_err();
        assert!(err.contains("missing"), "{err}");
        assert_eq!(count(&db, "competition").await, 0);
        assert_eq!(count(&db, "categories").await, 0);
        assert_eq!(count(&db, "timeplan").await, 0);
    }

    #[sqlx::test]
    async fn categories_without_competition_are_rejected(db: sqlx::SqlitePool) {
        let without_competition = &CONFIG[CONFIG.find("[[categories]]").unwrap()..];
        let err = seed_config(&db, without_competition).await.unwrap_err();
        assert!(err.contains("determining_day"), "{err}");
    }

    #[sqlx::test]
    async fn age_uses_determining_day_of_competition(db: sqlx::SqlitePool) {
        seed_config(&db, CONFIG).await.unwrap();
        let age: f64 = sqlx::query_scalar(
            "SELECT (julianday((SELECT determining_day FROM competition ORDER BY start_date DESC LIMIT 1)) - julianday('2012-06-01')) / 365.2425",
        )
        .fetch_one(&db)
        .await
        .unwrap();
        assert!((age - 15.0).abs() < 0.01, "{age}");
    }
}
