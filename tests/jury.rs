//! Integration tests for the jury registration (#225): the feature flag, the
//! jury rules, jury categories, judges, the obligation and the Juryplan.

mod common;

use axum::http::StatusCode;
use common::{TestApp, closed_registration};
use serde_json::{Value, json};
use sqlx::SqlitePool;
use time::{Duration, OffsetDateTime};

async fn system_status(app: &TestApp, cookie: Option<&str>) -> Value {
    let response = app.get("/api/query/get_system_status", cookie).await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    response.body
}

#[sqlx::test]
async fn system_status_shows_the_flag_rules_and_judge_window(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let status = system_status(&app, None).await;
    // Tests are debug builds, where the flag is on by default.
    assert_eq!(status["jury_registration"], true);
    assert_eq!(status["can_register_judge"], true);
    assert_eq!(
        status["competition"]["jury"],
        json!({
            "min_age": 15,
            "deployments_per_two_acts": 4,
            "missing_deployment_fee": 7.0,
            "registration_end": null,
        })
    );
}

#[sqlx::test]
async fn judges_follow_the_registration_window_unless_the_jury_has_its_own(db: SqlitePool) {
    let app = TestApp::with_status(db, closed_registration()).await;
    assert_eq!(system_status(&app, None).await["can_register_judge"], false);
    let admin = app.create_admin().await;
    assert_eq!(
        system_status(&app, Some(&admin)).await["can_register_judge"],
        true
    );

    // A later jury deadline keeps the judge registration open.
    let later = OffsetDateTime::now_utc() + Duration::days(3);
    sqlx::query("UPDATE competition SET jury_registration_end = ?")
        .bind(later)
        .execute(&app.db)
        .await
        .unwrap();
    let status = system_status(&app, None).await;
    assert_eq!(status["can_register_judge"], true);
    assert_eq!(status["can_register_starter"], false);
}

#[sqlx::test]
async fn the_flag_can_be_turned_off(db: SqlitePool) {
    let app = TestApp::without_jury_registration(db).await;
    let status = system_status(&app, None).await;
    assert_eq!(status["jury_registration"], false);
}
