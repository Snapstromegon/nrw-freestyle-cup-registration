//! Integration tests for admin-only endpoints, categories and the timeplan.

mod common;

use axum::http::StatusCode;
use common::{RELOAD_DB_TOKEN, TestApp};
use serde_json::{Value, json};
use sqlx::SqlitePool;
use time::{OffsetDateTime, format_description::well_known::Iso8601};

async fn category_orders(app: &TestApp) -> Vec<(String, Option<i64>)> {
    let response = app.get("/api/query/list_categories", None).await;
    assert_eq!(response.status, StatusCode::OK);
    response
        .body
        .as_array()
        .unwrap()
        .iter()
        .map(|c| (c["name"].as_str().unwrap().to_string(), c["order"].as_i64()))
        .collect()
}

fn order_of(categories: &[(String, Option<i64>)], name: &str) -> Option<i64> {
    categories.iter().find(|(n, _)| n == name).unwrap().1
}

fn category_body(name: &str) -> Value {
    json!({
        "name": name,
        "description": "Testkategorie",
        // Format sent by the admin frontend.
        "from_birthday": "2000-01-01T00:00:00Z",
        "to_birthday": "2010-01-01T00:00:00Z",
        "is_pair": false,
        "is_sonderpokal": false,
        "is_single_male": false,
        "einfahrzeit_seconds": 300,
        "act_duration_seconds": 120,
        "judge_duration_seconds": 60,
    })
}

#[sqlx::test]
async fn list_users_is_admin_only(db: SqlitePool) {
    let app = TestApp::new(db);
    let admin = app.create_admin().await;
    let user = app.cookie_for(app.create_user("Alex", false).await);

    let response = app.get("/api/query/list_users", Some(&admin)).await;
    assert_eq!(response.status, StatusCode::OK);
    let mut names: Vec<_> = response
        .body
        .as_array()
        .unwrap()
        .iter()
        .map(|u| u["name"].as_str().unwrap())
        .collect();
    names.sort();
    assert_eq!(names, ["Admin", "Alex"]);

    let forbidden = app.get("/api/query/list_users", Some(&user)).await;
    assert_eq!(forbidden.status, StatusCode::UNAUTHORIZED);

    let anonymous = app.get("/api/query/list_users", None).await;
    assert_eq!(anonymous.status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test]
async fn list_starters_is_admin_only(db: SqlitePool) {
    let app = TestApp::new(db);
    let admin = app.create_admin().await;
    let user = app.cookie_for(app.create_user("Alex", false).await);

    assert_eq!(
        app.get("/api/query/list_starters", Some(&admin))
            .await
            .status,
        StatusCode::OK
    );
    assert_eq!(
        app.get("/api/query/list_starters", Some(&user))
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.get("/api/query/list_starters", None).await.status,
        StatusCode::UNAUTHORIZED
    );
}

#[sqlx::test]
async fn system_status_reflects_open_registration(db: SqlitePool) {
    let app = TestApp::new(db);
    let response = app.get("/api/query/get_system_status", None).await;
    assert_eq!(response.status, StatusCode::OK);
    assert_eq!(
        response.body,
        json!({
            "can_register": true,
            "can_create_club": true,
            "can_register_starter": true,
            "can_register_judge": true,
            "can_upload_music": true,
        })
    );
}

#[sqlx::test]
async fn categories_are_seeded_in_order(db: SqlitePool) {
    let app = TestApp::new(db);
    let categories = category_orders(&app).await;

    assert_eq!(categories.len(), 15);
    assert_eq!(categories[0], ("NEM".to_string(), Some(1)));
    let orders: Vec<_> = categories.iter().map(|(_, o)| o.unwrap()).collect();
    assert!(orders.is_sorted());
}

#[sqlx::test]
async fn category_commands_require_admin(db: SqlitePool) {
    let app = TestApp::new(db);
    let user = app.cookie_for(app.create_user("Alex", false).await);

    let as_user = app
        .post("/api/command/add_category", category_body("X"), Some(&user))
        .await;
    assert_eq!(as_user.status, StatusCode::FORBIDDEN);

    let anonymous = app
        .post("/api/command/add_category", category_body("X"), None)
        .await;
    assert_eq!(anonymous.status, StatusCode::UNAUTHORIZED);

    for uri in [
        "/api/command/delete_category",
        "/api/command/move_category_up",
        "/api/command/move_category_down",
    ] {
        let response = app.post(uri, json!({ "name": "NEM" }), Some(&user)).await;
        assert_eq!(response.status, StatusCode::FORBIDDEN, "{uri}");
    }
    assert_eq!(category_orders(&app).await.len(), 15);
}

#[sqlx::test]
async fn admin_can_add_and_edit_category(db: SqlitePool) {
    let app = TestApp::new(db);
    let admin = app.create_admin().await;

    let added = app
        .post(
            "/api/command/add_category",
            category_body("TEST"),
            Some(&admin),
        )
        .await;
    assert_eq!(added.status, StatusCode::OK, "{:?}", added.body);

    let mut edit = category_body("TEST");
    edit["new_name"] = json!("RENAMED");
    edit["act_duration_seconds"] = json!(999);
    let edited = app
        .post("/api/command/edit_category", edit, Some(&admin))
        .await;
    assert_eq!(edited.status, StatusCode::OK, "{:?}", edited.body);

    let response = app.get("/api/query/list_categories", None).await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    let categories = response.body.as_array().unwrap();
    assert!(!categories.iter().any(|c| c["name"] == "TEST"));
    let renamed = categories.iter().find(|c| c["name"] == "RENAMED").unwrap();
    assert_eq!(renamed["act_duration_seconds"], 999);
    assert_eq!(renamed["description"], "Testkategorie");
}

#[sqlx::test]
#[ignore = "known bug: category birthdays are stored unvalidated and break list_categories"]
async fn category_with_date_only_birthday_does_not_break_listing(db: SqlitePool) {
    let app = TestApp::new(db);
    let admin = app.create_admin().await;
    let mut body = category_body("DATE-ONLY");
    body["from_birthday"] = json!("2000-01-01");

    let added = app
        .post("/api/command/add_category", body, Some(&admin))
        .await;

    // Either the input is rejected, or the listing keeps working.
    if added.status == StatusCode::OK {
        let response = app.get("/api/query/list_categories", None).await;
        assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    }
}

#[sqlx::test]
async fn move_category_up_and_down_swaps_neighbours(db: SqlitePool) {
    let app = TestApp::new(db);
    let admin = app.create_admin().await;

    let up = app
        .post(
            "/api/command/move_category_up",
            json!({ "name": "NEWU11" }),
            Some(&admin),
        )
        .await;
    assert_eq!(up.status, StatusCode::OK, "{:?}", up.body);
    let categories = category_orders(&app).await;
    assert_eq!(order_of(&categories, "NEWU11"), Some(1));
    assert_eq!(order_of(&categories, "NEM"), Some(2));

    let down = app
        .post(
            "/api/command/move_category_down",
            json!({ "name": "NEWU11" }),
            Some(&admin),
        )
        .await;
    assert_eq!(down.status, StatusCode::OK, "{:?}", down.body);
    let categories = category_orders(&app).await;
    assert_eq!(order_of(&categories, "NEM"), Some(1));
    assert_eq!(order_of(&categories, "NEWU11"), Some(2));
}

#[sqlx::test]
async fn moving_first_category_up_or_last_down_is_rejected(db: SqlitePool) {
    let app = TestApp::new(db);
    let admin = app.create_admin().await;
    let before = category_orders(&app).await;

    let up = app
        .post(
            "/api/command/move_category_up",
            json!({ "name": "NEM" }),
            Some(&admin),
        )
        .await;
    assert_eq!(up.status, StatusCode::BAD_REQUEST);

    let down = app
        .post(
            "/api/command/move_category_down",
            json!({ "name": "SP15+" }),
            Some(&admin),
        )
        .await;
    assert_eq!(down.status, StatusCode::BAD_REQUEST);

    assert_eq!(category_orders(&app).await, before);
}

#[sqlx::test]
async fn delete_category_removes_its_timeplan_entries(db: SqlitePool) {
    let app = TestApp::new(db);
    let admin = app.create_admin().await;

    let response = app
        .post(
            "/api/command/delete_category",
            json!({ "name": "NEWU13" }),
            Some(&admin),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK);

    let categories = category_orders(&app).await;
    assert!(!categories.iter().any(|(name, _)| name == "NEWU13"));
    let timeplan_refs: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM timeplan WHERE category = 'NEWU13'")
            .fetch_one(&app.db)
            .await
            .unwrap();
    assert_eq!(timeplan_refs, 0);
}

#[sqlx::test]
async fn delete_unknown_category_is_not_found(db: SqlitePool) {
    let app = TestApp::new(db);
    let admin = app.create_admin().await;
    let response = app
        .post(
            "/api/command/delete_category",
            json!({ "name": "DOES-NOT-EXIST" }),
            Some(&admin),
        )
        .await;
    assert_eq!(response.status, StatusCode::NOT_FOUND);
}

fn parse_time(value: &Value) -> OffsetDateTime {
    OffsetDateTime::parse(value.as_str().unwrap(), &Iso8601::DEFAULT).unwrap()
}

#[sqlx::test]
async fn predicted_timeplan_is_contiguous_and_planned(db: SqlitePool) {
    let app = TestApp::new(db);
    let timeplan_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM timeplan")
        .fetch_one(&app.db)
        .await
        .unwrap();

    let response = app.get("/api/query/predict_timeplan", None).await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);

    let items = response.body["items"].as_array().unwrap();
    assert_eq!(items.len() as i64, timeplan_rows);

    let mut previous_end: Option<OffsetDateTime> = None;
    for item in items {
        assert_eq!(item["status"], "Planned");
        let start = parse_time(&item["planned_start"]);
        let end = parse_time(&item["planned_end"]);
        assert_eq!(
            (end - start).whole_seconds(),
            item["planned_duration"].as_i64().unwrap()
        );
        if let Some(previous_end) = previous_end {
            assert!(start >= previous_end, "{item}");
        }
        previous_end = Some(end);
    }

    // A category without acts only lasts as long as its warm-up time.
    let first = &items[0]["timeplan_entry"]["Category"];
    assert_eq!(first["name"], "NEM");
    assert_eq!(first["duration_seconds"], first["einfahrzeit_seconds"]);
    assert!(first["acts"].as_array().unwrap().is_empty());

    let lunch = items
        .iter()
        .find(|i| i["timeplan_entry"]["Custom"]["label"] == "Mittagspause")
        .unwrap();
    assert_eq!(lunch["planned_duration"], 45 * 60);
}

#[sqlx::test]
async fn timeplan_forward_starts_first_entry(db: SqlitePool) {
    let app = TestApp::new(db);
    let admin = app.create_admin().await;
    let user = app.cookie_for(app.create_user("Alex", false).await);

    let forbidden = app
        .post("/api/command/timeplan_forward", json!(null), Some(&user))
        .await;
    assert_eq!(forbidden.status, StatusCode::FORBIDDEN);

    let response = app
        .post("/api/command/timeplan_forward", json!(null), Some(&admin))
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);

    let timeplan = app.get("/api/query/predict_timeplan", None).await;
    let items = timeplan.body["items"].as_array().unwrap();
    assert_eq!(items[0]["status"], "Started");
    assert!(items[0]["started_at"].is_string());
    assert!(items[1..].iter().all(|i| i["status"] == "Planned"));
}

#[sqlx::test]
async fn reload_db_rejects_non_admin_without_token(db: SqlitePool) {
    let app = TestApp::new(db);
    let user = app.cookie_for(app.create_user("Alex", false).await);

    let response = app
        .post(
            "/api/command/reload_db?token=wrong",
            json!(null),
            Some(&user),
        )
        .await;
    assert_eq!(response.status, StatusCode::FORBIDDEN);

    // The token alone is not enough: the endpoint also requires a login.
    let anonymous = app
        .post(
            &format!("/api/command/reload_db?token={RELOAD_DB_TOKEN}"),
            json!(null),
            None,
        )
        .await;
    assert_eq!(anonymous.status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test]
async fn unknown_api_route_is_not_found(db: SqlitePool) {
    let app = TestApp::new(db);
    let response = app.get("/api/query/does_not_exist", None).await;
    assert_eq!(response.status, StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn swagger_serves_openapi_document(db: SqlitePool) {
    let app = TestApp::new(db);
    let response = app.get("/openapi.json", None).await;
    assert_eq!(response.status, StatusCode::OK);
    assert!(response.body["paths"]["/api/command/register"].is_object());
}
