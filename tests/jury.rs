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

// ---------- Jury categories (#227) ----------

async fn jury_categories(app: &TestApp, cookie: &str) -> Vec<Value> {
    let response = app
        .get("/api/query/list_jury_categories", Some(cookie))
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    response.body.as_array().unwrap().clone()
}

fn category_body(name: &str, deployments: i64, day: Option<&str>) -> Value {
    json!({
        "name": name,
        "deployments": deployments,
        "day": day,
        "needed_technical": 5,
        "needed_performance": 5,
        "needed_dismounts": 3,
    })
}

#[sqlx::test]
async fn jury_categories_are_seeded_from_the_config_in_order(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (owner, _) = app.create_club_owner("Owner", "RSV").await;
    let categories = jury_categories(&app, &owner).await;
    let summary: Vec<Value> = categories
        .iter()
        .map(|c| {
            json!([
                c["name"],
                c["deployments"],
                c["day"],
                c["needed_technical"],
                c["needed_performance"],
                c["needed_dismounts"],
            ])
        })
        .collect();
    assert_eq!(
        summary,
        vec![
            json!(["Einzel W – Junior Expert Vorlauf", 2, null, 5, 5, 3]),
            json!(["Finale 1 EW", 1, "2027-06-06", 5, 5, 3]),
            json!(["Kleingruppe Expert", 2, null, 3, 3, 2]),
        ]
    );

    let anonymous = app.get("/api/query/list_jury_categories", None).await;
    assert_eq!(anonymous.status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test]
async fn seeding_keeps_jury_categories_changed_by_admins(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let admin = app.create_admin().await;
    let first = jury_categories(&app, &admin).await[0]["id"].clone();
    let response = app
        .post(
            "/api/command/delete_jury_category",
            json!({ "id": first }),
            Some(&admin),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);

    common::seed_db(&app.db, &common::open_registration()).await;
    assert_eq!(jury_categories(&app, &admin).await.len(), 2);
}

#[sqlx::test]
async fn admins_manage_jury_categories(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let admin = app.create_admin().await;
    let (owner, _) = app.create_club_owner("Owner", "RSV").await;

    let body = category_body("Paar – Expert 1 Vorlauf", 2, Some("2027-06-05"));
    let forbidden = app
        .post("/api/command/add_jury_category", body.clone(), Some(&owner))
        .await;
    assert_eq!(forbidden.status, StatusCode::FORBIDDEN);
    let added = app
        .post("/api/command/add_jury_category", body, Some(&admin))
        .await;
    assert_eq!(added.status, StatusCode::OK, "{:?}", added.body);
    let id = added.body["id"].clone();

    let mut edit = category_body("Paar – Expert 1 Vorlauf", 4, None);
    edit["id"] = id.clone();
    let edited = app
        .post("/api/command/edit_jury_category", edit, Some(&admin))
        .await;
    assert_eq!(edited.status, StatusCode::OK, "{:?}", edited.body);

    // New ones go to the end; the order can be set as a whole.
    let mut ids: Vec<Value> = jury_categories(&app, &admin)
        .await
        .iter()
        .map(|c| c["id"].clone())
        .collect();
    assert_eq!(ids.last(), Some(&id));
    ids.reverse();
    let reordered = app
        .post(
            "/api/command/set_jury_category_order",
            json!({ "ids": ids }),
            Some(&admin),
        )
        .await;
    assert_eq!(reordered.status, StatusCode::OK, "{:?}", reordered.body);
    let categories = jury_categories(&app, &admin).await;
    assert_eq!(categories[0]["id"], id);
    assert_eq!(categories[0]["deployments"], 4);
    assert_eq!(categories[0]["day"], Value::Null);

    // The order must name every category exactly once.
    let partial = app
        .post(
            "/api/command/set_jury_category_order",
            json!({ "ids": [id] }),
            Some(&admin),
        )
        .await;
    assert!(!partial.status.is_success());
}

#[sqlx::test]
async fn jury_categories_are_validated(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let admin = app.create_admin().await;
    for body in [
        // The event runs from 2027-06-05 to 2027-06-06.
        category_body("Zu früh", 2, Some("2027-06-04")),
        category_body("Zu spät", 2, Some("2027-06-07")),
        category_body("  ", 2, None),
        category_body("Negativ", -1, None),
        // Names are unique.
        category_body("Finale 1 EW", 1, None),
    ] {
        let response = app
            .post("/api/command/add_jury_category", body.clone(), Some(&admin))
            .await;
        assert!(!response.status.is_success(), "{body}: {:?}", response.body);
    }
    assert_eq!(jury_categories(&app, &admin).await.len(), 3);
}

#[sqlx::test]
async fn jury_endpoints_dont_exist_without_the_flag(db: SqlitePool) {
    let app = TestApp::without_jury_registration(db).await;
    let admin = app.create_admin().await;
    let list = app
        .get("/api/query/list_jury_categories", Some(&admin))
        .await;
    assert_eq!(list.status, StatusCode::NOT_FOUND);
    let add = app
        .post(
            "/api/command/add_jury_category",
            category_body("Neu", 2, None),
            Some(&admin),
        )
        .await;
    assert_eq!(add.status, StatusCode::NOT_FOUND);
}
