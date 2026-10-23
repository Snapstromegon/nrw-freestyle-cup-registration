//! Integration tests for the jury registration (#225): the feature flag, the
//! jury rules, jury categories, judges, the obligation and the Juryplan.

mod common;

use axum::http::StatusCode;
use common::{TestApp, TestResponse, closed_registration};
use serde_json::{Value, json};
use sqlx::SqlitePool;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

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

// ---------- Judges (#228) ----------

/// Body for `add_club_judge`; `registrations` are (jury category index in
/// the seeded order, role).
fn judge_body(
    club_id: Uuid,
    firstname: &str,
    birthdate: &str,
    is_trained: bool,
    registrations: &[(&Value, &str)],
) -> Value {
    json!({
        "club_id": club_id,
        "firstname": firstname,
        "lastname": "Jury",
        "birthdate": birthdate,
        "is_trained": is_trained,
        "max_deployments": null,
        "note": null,
        "registrations": registrations
            .iter()
            .map(|(category, role)| json!({ "jury_category_id": category, "role": role }))
            .collect::<Vec<_>>(),
    })
}

/// Born so that the judge is 30 on the first competition day.
const ADULT: &str = "1997-01-01T00:00:00.000Z";

async fn category_ids(app: &TestApp, cookie: &str) -> Vec<Value> {
    jury_categories(app, cookie)
        .await
        .iter()
        .map(|c| c["id"].clone())
        .collect()
}

async fn add_judge(app: &TestApp, cookie: &str, body: Value) -> TestResponse {
    app.post("/api/command/add_club_judge", body, Some(cookie))
        .await
}

async fn club_judges(app: &TestApp, cookie: &str, club_id: Uuid) -> Vec<Value> {
    let response = app
        .get(
            &format!("/api/query/list_club_judges?club_id={club_id}"),
            Some(cookie),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    response.body.as_array().unwrap().clone()
}

#[sqlx::test]
async fn clubs_add_edit_and_delete_judges(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (owner, club_id) = app.create_club_owner("Owner", "RSV").await;
    let ids = category_ids(&app, &owner).await;

    let mut body = judge_body(
        club_id,
        "Anna",
        ADULT,
        true,
        &[
            (&ids[0], "technical"),
            (&ids[0], "performance"),
            (&ids[1], "dismounts"),
        ],
    );
    body["max_deployments"] = json!(3);
    body["note"] = json!("Nur Samstag");
    let added = add_judge(&app, &owner, body).await;
    assert_eq!(added.status, StatusCode::OK, "{:?}", added.body);
    let judge_id = added.body["judge_id"].clone();

    let judges = club_judges(&app, &owner, club_id).await;
    assert_eq!(judges.len(), 1);
    let anna = &judges[0];
    assert_eq!(anna["id"], judge_id);
    assert_eq!(anna["firstname"], "Anna");
    assert_eq!(anna["is_trained"], true);
    assert_eq!(anna["max_deployments"], 3);
    assert_eq!(anna["note"], "Nur Samstag");
    assert_eq!(anna["registrations"].as_array().unwrap().len(), 3);

    // Editing replaces the registrations.
    let mut edit = judge_body(club_id, "Anna", ADULT, false, &[(&ids[2], "dismounts")]);
    edit.as_object_mut().unwrap().remove("club_id");
    edit["judge_id"] = judge_id.clone();
    let edited = app
        .post("/api/command/edit_club_judge", edit, Some(&owner))
        .await;
    assert_eq!(edited.status, StatusCode::OK, "{:?}", edited.body);
    let anna = club_judges(&app, &owner, club_id).await[0].clone();
    assert_eq!(anna["is_trained"], false);
    assert_eq!(anna["note"], Value::Null);
    assert_eq!(
        anna["registrations"],
        json!([{ "jury_category_id": ids[2], "role": "dismounts" }])
    );

    let deleted = app
        .post(
            "/api/command/delete_club_judge",
            json!({ "judge_id": judge_id }),
            Some(&owner),
        )
        .await;
    assert_eq!(deleted.status, StatusCode::OK, "{:?}", deleted.body);
    assert!(club_judges(&app, &owner, club_id).await.is_empty());
}

#[sqlx::test]
async fn only_the_club_and_admins_manage_its_judges(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (owner, club_id) = app.create_club_owner("Owner", "RSV").await;
    let (other, _) = app.create_club_owner("Other", "RSV Andere").await;
    let ids = category_ids(&app, &owner).await;
    let body = judge_body(club_id, "Anna", ADULT, true, &[(&ids[0], "technical")]);

    assert_eq!(
        add_judge(&app, &other, body.clone()).await.status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.post("/api/command/add_club_judge", body.clone(), None)
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
    let judge_id = add_judge(&app, &owner, body).await.body["judge_id"].clone();

    let list = format!("/api/query/list_club_judges?club_id={club_id}");
    assert_eq!(
        app.get(&list, Some(&other)).await.status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(app.get(&list, None).await.status, StatusCode::UNAUTHORIZED);

    let mut edit = judge_body(club_id, "Eve", ADULT, true, &[]);
    edit.as_object_mut().unwrap().remove("club_id");
    edit["judge_id"] = judge_id.clone();
    for (command, body) in [
        ("edit_club_judge", edit),
        ("delete_club_judge", json!({ "judge_id": judge_id })),
    ] {
        let response = app
            .post(&format!("/api/command/{command}"), body, Some(&other))
            .await;
        assert_eq!(response.status, StatusCode::FORBIDDEN, "{command}");
    }

    let admin = app.create_admin().await;
    assert_eq!(club_judges(&app, &admin, club_id).await.len(), 1);
    let all = app.get("/api/query/list_judges", Some(&admin)).await;
    assert_eq!(all.status, StatusCode::OK, "{:?}", all.body);
    assert_eq!(all.body[0]["club_name"], "RSV");
    assert_eq!(all.body[0]["firstname"], "Anna");
    assert_eq!(
        app.get("/api/query/list_judges", Some(&owner)).await.status,
        StatusCode::FORBIDDEN
    );
}

#[sqlx::test]
async fn judges_are_fixed_after_the_judge_deadline_except_for_admins(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (owner, club_id) = app.create_club_owner("Owner", "RSV").await;
    let ids = category_ids(&app, &owner).await;
    app.close_registration().await;
    let body = judge_body(club_id, "Anna", ADULT, true, &[(&ids[0], "technical")]);
    assert_eq!(
        add_judge(&app, &owner, body.clone()).await.status,
        StatusCode::FORBIDDEN
    );
    let admin = app.create_admin().await;
    assert_eq!(add_judge(&app, &admin, body).await.status, StatusCode::OK);
}

#[sqlx::test]
async fn judges_are_validated(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (owner, club_id) = app.create_club_owner("Owner", "RSV").await;
    let ids = category_ids(&app, &owner).await;
    let technical = [(&ids[0], "technical")];
    let dismounts = [(&ids[0], "dismounts")];

    // The first competition day is 2027-06-05: trained judges must be 15.
    let fifteen = "2012-06-05T00:00:00.000Z";
    let fourteen = "2012-06-06T00:00:00.000Z";
    let mut max_zero = judge_body(club_id, "Null", ADULT, true, &technical);
    max_zero["max_deployments"] = json!(0);
    for (body, reason) in [
        (
            judge_body(club_id, "Jung", fourteen, true, &technical),
            "under 15",
        ),
        (
            judge_body(club_id, "Ungeschult", ADULT, false, &technical),
            "untrained T",
        ),
        (
            judge_body(club_id, "=Formel", ADULT, true, &technical),
            "CSV injection",
        ),
        (
            judge_body(club_id, "  ", ADULT, true, &technical),
            "empty name",
        ),
        (max_zero, "max 0"),
        (
            judge_body(
                club_id,
                "Unbekannt",
                ADULT,
                true,
                &[(&json!(Uuid::new_v4()), "technical")],
            ),
            "unknown category",
        ),
    ] {
        let response = add_judge(&app, &owner, body).await;
        assert!(
            !response.status.is_success(),
            "{reason}: {:?}",
            response.body
        );
    }

    for body in [
        judge_body(club_id, "Fünfzehn", fifteen, true, &technical),
        // Untrained dismount counters have no minimum age.
        judge_body(club_id, "Zählerin", fourteen, false, &dismounts),
    ] {
        let response = add_judge(&app, &owner, body).await;
        assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    }
    // The same name twice in one club.
    let duplicate = add_judge(
        &app,
        &owner,
        judge_body(club_id, "Fünfzehn", fifteen, true, &technical),
    )
    .await;
    assert!(!duplicate.status.is_success());
    assert_eq!(club_judges(&app, &owner, club_id).await.len(), 2);
}

#[sqlx::test]
async fn jury_categories_with_registered_judges_cannot_be_deleted(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (owner, club_id) = app.create_club_owner("Owner", "RSV").await;
    let admin = app.create_admin().await;
    let ids = category_ids(&app, &owner).await;
    let added = add_judge(
        &app,
        &owner,
        judge_body(club_id, "Anna", ADULT, true, &[(&ids[0], "technical")]),
    )
    .await;
    assert_eq!(added.status, StatusCode::OK, "{:?}", added.body);

    let delete = |id: &Value| json!({ "id": id });
    let refused = app
        .post(
            "/api/command/delete_jury_category",
            delete(&ids[0]),
            Some(&admin),
        )
        .await;
    assert!(!refused.status.is_success(), "{:?}", refused.body);
    let allowed = app
        .post(
            "/api/command/delete_jury_category",
            delete(&ids[1]),
            Some(&admin),
        )
        .await;
    assert_eq!(allowed.status, StatusCode::OK, "{:?}", allowed.body);
}

#[sqlx::test]
async fn judge_endpoints_dont_exist_without_the_flag(db: SqlitePool) {
    let app = TestApp::without_jury_registration(db).await;
    let (owner, club_id) = app.create_club_owner("Owner", "RSV").await;
    let list = app
        .get(
            &format!("/api/query/list_club_judges?club_id={club_id}"),
            Some(&owner),
        )
        .await;
    assert_eq!(list.status, StatusCode::NOT_FOUND);
}
