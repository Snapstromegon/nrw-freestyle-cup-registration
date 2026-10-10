//! Integration tests for registering judges.

mod common;

use axum::http::StatusCode;
use common::{TestApp, closed_registration};
use serde_json::{Value, json};
use sqlx::SqlitePool;
use uuid::Uuid;

/// Qualification flags of a judge, as defined in the `judge` table.
const QUALIFICATIONS: &[&str] = &[
    "n_ew_u15_p",
    "n_ew_u15_p_hosp",
    "n_ew_u15_t",
    "n_ew_u15_t_hosp",
    "n_ew_u15_a",
    "n_ew_u15_a_hosp",
    "n_ew_o15_p",
    "n_ew_o15_p_hosp",
    "n_ew_o15_t",
    "n_ew_o15_t_hosp",
    "n_ew_o15_a",
    "n_ew_o15_a_hosp",
    "n_em_u15_p",
    "n_em_u15_p_hosp",
    "n_em_u15_t",
    "n_em_u15_t_hosp",
    "n_em_u15_a",
    "n_em_u15_a_hosp",
    "n_em_o15_p",
    "n_em_o15_p_hosp",
    "n_em_o15_t",
    "n_em_o15_t_hosp",
    "n_em_o15_a",
    "n_em_o15_a_hosp",
    "n_p_u15_p",
    "n_p_u15_p_hosp",
    "n_p_u15_t",
    "n_p_u15_t_hosp",
    "n_p_u15_a",
    "n_p_u15_a_hosp",
    "n_p_o15_p",
    "n_p_o15_p_hosp",
    "n_p_o15_t",
    "n_p_o15_t_hosp",
    "n_p_o15_a",
    "n_p_o15_a_hosp",
    "s_e_u15_p",
    "s_e_u15_p_hosp",
    "s_e_u15_t",
    "s_e_u15_t_hosp",
    "s_e_u15_a",
    "s_e_u15_a_hosp",
    "s_e_o15_p",
    "s_e_o15_p_hosp",
    "s_e_o15_t",
    "s_e_o15_t_hosp",
    "s_e_o15_a",
    "s_e_o15_a_hosp",
    "s_p_u15_p",
    "s_p_u15_p_hosp",
    "s_p_u15_t",
    "s_p_u15_t_hosp",
    "s_p_u15_a",
    "s_p_u15_a_hosp",
    "s_p_o15_p",
    "s_p_o15_p_hosp",
    "s_p_o15_t",
    "s_p_o15_t_hosp",
    "s_p_o15_a",
    "s_p_o15_a_hosp",
];

fn judge_body(club_id: Uuid, firstname: &str, qualifications: &[&str]) -> Value {
    let mut body = json!({
        "club_id": club_id,
        "firstname": firstname,
        "lastname": "Richter",
        "mail": format!("{}@cup.test", firstname.to_lowercase()),
        "birthdate": "1980-01-01T00:00:00.000Z",
    });
    for flag in QUALIFICATIONS {
        body[*flag] = json!(qualifications.contains(flag));
    }
    body
}

async fn add_judge(app: &TestApp, cookie: &str, body: Value) -> Uuid {
    let response = app
        .post("/api/command/add_club_judge", body, Some(cookie))
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    response.body["judge_id"].as_str().unwrap().parse().unwrap()
}

async fn list_club_judges(app: &TestApp, club_id: Uuid) -> Vec<Value> {
    let response = app
        .get(
            &format!("/api/query/list_club_judges?club_id={club_id}"),
            None,
        )
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    response.body.as_array().unwrap().clone()
}

#[sqlx::test]
async fn add_club_judge_stores_all_qualifications(db: SqlitePool) {
    let app = TestApp::new(db);
    let (cookie, club_id) = app.create_club_owner("Owner", "RSV").await;
    let qualifications = ["n_ew_u15_p", "s_p_o15_a_hosp", "n_em_o15_t"];

    let judge_id = add_judge(&app, &cookie, judge_body(club_id, "Jana", &qualifications)).await;

    let judges = list_club_judges(&app, club_id).await;
    assert_eq!(judges.len(), 1);
    let judge = &judges[0];
    assert_eq!(judge["id"], judge_id.to_string());
    assert_eq!(judge["club_id"], club_id.to_string());
    assert_eq!(judge["firstname"], "Jana");
    assert_eq!(judge["mail"], "jana@cup.test");
    for flag in QUALIFICATIONS {
        assert_eq!(judge[*flag], qualifications.contains(flag), "{flag}");
    }
}

#[sqlx::test]
async fn list_club_judges_only_returns_judges_of_that_club(db: SqlitePool) {
    let app = TestApp::new(db);
    let (first, first_club) = app.create_club_owner("First", "RSV A").await;
    let (second, second_club) = app.create_club_owner("Second", "RSV B").await;
    add_judge(&app, &first, judge_body(first_club, "Jana", &[])).await;
    add_judge(&app, &second, judge_body(second_club, "Jonas", &[])).await;

    let judges = list_club_judges(&app, first_club).await;
    assert_eq!(judges.len(), 1);
    assert_eq!(judges[0]["firstname"], "Jana");
}

#[sqlx::test]
async fn edit_club_judge_updates_data_and_qualifications(db: SqlitePool) {
    let app = TestApp::new(db);
    let (cookie, club_id) = app.create_club_owner("Owner", "RSV").await;
    let judge_id = add_judge(&app, &cookie, judge_body(club_id, "Jana", &["n_ew_u15_p"])).await;

    let mut body = judge_body(club_id, "Janina", &["s_e_o15_t"]);
    body["judge_id"] = json!(judge_id);
    body["mail"] = json!("janina@cup.test");
    let response = app
        .post("/api/command/edit_club_judge", body, Some(&cookie))
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);

    let judge = &list_club_judges(&app, club_id).await[0];
    assert_eq!(judge["firstname"], "Janina");
    assert_eq!(judge["mail"], "janina@cup.test");
    assert_eq!(judge["n_ew_u15_p"], false);
    assert_eq!(judge["s_e_o15_t"], true);
}

#[sqlx::test]
async fn delete_club_judge_removes_judge(db: SqlitePool) {
    let app = TestApp::new(db);
    let (cookie, club_id) = app.create_club_owner("Owner", "RSV").await;
    let judge_id = add_judge(&app, &cookie, judge_body(club_id, "Jana", &[])).await;
    let other = add_judge(&app, &cookie, judge_body(club_id, "Jonas", &[])).await;

    let response = app
        .post(
            "/api/command/delete_club_judge",
            json!({ "judge_id": judge_id }),
            Some(&cookie),
        )
        .await;

    assert_eq!(response.status, StatusCode::OK);
    let judges = list_club_judges(&app, club_id).await;
    assert_eq!(judges.len(), 1);
    assert_eq!(judges[0]["id"], other.to_string());
}

#[sqlx::test]
async fn judge_commands_require_login(db: SqlitePool) {
    let app = TestApp::new(db);
    let club_id = Uuid::now_v7();
    let mut edit = judge_body(club_id, "Jana", &[]);
    edit["judge_id"] = json!(Uuid::now_v7());

    for (uri, body) in [
        (
            "/api/command/add_club_judge",
            judge_body(club_id, "Jana", &[]),
        ),
        ("/api/command/edit_club_judge", edit),
        (
            "/api/command/delete_club_judge",
            json!({ "judge_id": Uuid::now_v7() }),
        ),
    ] {
        let response = app.post(uri, body, None).await;
        assert_eq!(response.status, StatusCode::UNAUTHORIZED, "{uri}");
    }
}

#[sqlx::test]
async fn judge_commands_are_forbidden_outside_registration_period(db: SqlitePool) {
    let app = TestApp::with_status(db, closed_registration());
    let owner = app.cookie_for(app.create_user("Owner", false).await);
    let club_id = Uuid::now_v7();
    let mut edit = judge_body(club_id, "Jana", &[]);
    edit["judge_id"] = json!(Uuid::now_v7());

    for (uri, body) in [
        (
            "/api/command/add_club_judge",
            judge_body(club_id, "Jana", &[]),
        ),
        ("/api/command/edit_club_judge", edit),
        (
            "/api/command/delete_club_judge",
            json!({ "judge_id": Uuid::now_v7() }),
        ),
    ] {
        let response = app.post(uri, body, Some(&owner)).await;
        assert_eq!(response.status, StatusCode::FORBIDDEN, "{uri}");
    }
}

#[sqlx::test]
async fn list_judges_is_admin_only_and_includes_club_name(db: SqlitePool) {
    let app = TestApp::new(db);
    let admin = app.create_admin().await;
    let (owner, club_id) = app.create_club_owner("Owner", "RSV").await;
    add_judge(&app, &owner, judge_body(club_id, "Jana", &["n_p_u15_a"])).await;

    let response = app.get("/api/query/list_judges", Some(&admin)).await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    let judges = response.body.as_array().unwrap();
    assert_eq!(judges.len(), 1);
    assert_eq!(judges[0]["club_name"], "RSV");
    assert_eq!(judges[0]["n_p_u15_a"], true);

    assert_eq!(
        app.get("/api/query/list_judges", Some(&owner)).await.status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.get("/api/query/list_judges", None).await.status,
        StatusCode::UNAUTHORIZED
    );
}
