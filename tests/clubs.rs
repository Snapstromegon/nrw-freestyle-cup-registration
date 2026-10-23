//! Integration tests for clubs, starters and their generated acts.

mod common;

use axum::http::StatusCode;
use common::{TestApp, closed_registration, starter_body};
use serde_json::{Value, json};
use sqlx::SqlitePool;
use uuid::Uuid;

async fn list_starters(app: &TestApp, cookie: &str, club_id: Uuid) -> Vec<Value> {
    let response = app
        .get(
            &format!("/api/query/list_club_starters?club_id={club_id}"),
            Some(cookie),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    response.body.as_array().unwrap().clone()
}

async fn list_acts(app: &TestApp, cookie: &str, club_id: Uuid) -> Vec<Value> {
    let response = app
        .get(
            &format!("/api/query/list_club_acts?club_id={club_id}"),
            Some(cookie),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    response.body.as_array().unwrap().clone()
}

#[sqlx::test]
async fn create_club_assigns_club_to_owner(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (cookie, club_id) = app.create_club_owner("Owner", "RSV Test").await;

    let whoami = app.get("/api/query/whoami", Some(&cookie)).await;
    assert_eq!(whoami.body["club_id"], club_id.to_string());

    // Without an explicit id, get_club falls back to the caller's club.
    let club = app.get("/api/query/get_club", Some(&cookie)).await;
    assert_eq!(club.status, StatusCode::OK);
    assert_eq!(club.body["id"], club_id.to_string());
    assert_eq!(club.body["name"], "RSV Test");
    assert_eq!(club.body["payment"], Value::Null);
}

#[sqlx::test]
async fn create_club_requires_login(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let response = app
        .post("/api/command/create_club", json!({ "name": "RSV" }), None)
        .await;
    assert_eq!(response.status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test]
async fn get_club_without_id_or_login_is_not_found(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let response = app.get("/api/query/get_club", None).await;
    assert_eq!(response.status, StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn club_actions_are_forbidden_outside_registration_period(db: SqlitePool) {
    let app = TestApp::with_status(db, closed_registration()).await;
    let cookie = app.cookie_for(app.create_user("Owner", false).await);

    let response = app
        .post(
            "/api/command/create_club",
            json!({ "name": "RSV" }),
            Some(&cookie),
        )
        .await;

    assert_eq!(response.status, StatusCode::FORBIDDEN);
}

#[sqlx::test]
async fn admins_bypass_registration_period(db: SqlitePool) {
    let app = TestApp::with_status(db, closed_registration()).await;
    let admin = app.create_admin().await;

    let status = app.get("/api/query/get_system_status", Some(&admin)).await;
    assert_eq!(status.body["can_create_club"], true);

    let response = app
        .post(
            "/api/command/create_club",
            json!({ "name": "RSV" }),
            Some(&admin),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK);
}

#[sqlx::test]
async fn rename_club_by_owner_changes_name(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (cookie, club_id) = app.create_club_owner("Owner", "Old Name").await;

    let response = app
        .post(
            "/api/command/rename_club",
            json!({ "club_id": club_id, "name": "New Name" }),
            Some(&cookie),
        )
        .await;

    assert_eq!(response.status, StatusCode::OK);
    let club = app.get("/api/query/get_club", Some(&cookie)).await;
    assert_eq!(club.body["name"], "New Name");
}

#[sqlx::test]
async fn rename_club_by_other_user_does_not_change_name(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (owner, club_id) = app.create_club_owner("Owner", "Original").await;
    let (intruder, _) = app.create_club_owner("Intruder", "Other Club").await;

    app.post(
        "/api/command/rename_club",
        json!({ "club_id": club_id, "name": "Hijacked" }),
        Some(&intruder),
    )
    .await;

    let club = app.get("/api/query/get_club", Some(&owner)).await;
    assert_eq!(club.body["name"], "Original");
}

#[sqlx::test]
async fn single_starter_gets_a_single_act(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (cookie, club_id) = app.create_club_owner("Owner", "RSV").await;

    let starter_id = app
        .add_starter(&cookie, starter_body(club_id, "Anna", true, false))
        .await;

    let starters = list_starters(&app, &cookie, club_id).await;
    assert_eq!(starters.len(), 1);
    assert_eq!(starters[0]["id"], starter_id.to_string());
    assert_eq!(starters[0]["firstname"], "Anna");

    let acts = list_acts(&app, &cookie, club_id).await;
    assert_eq!(acts.len(), 1);
    assert_eq!(acts[0]["act_type"], "single");
    assert_eq!(acts[0]["participants"][0]["id"], starter_id.to_string());
}

#[sqlx::test]
async fn pair_partners_are_linked_by_name(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (cookie, club_id) = app.create_club_owner("Owner", "RSV").await;

    let mut first = starter_body(club_id, "Anna", false, true);
    first["partner_name"] = json!("Berta Muster");
    let anna = app.add_starter(&cookie, first).await;

    let mut second = starter_body(club_id, "Berta", false, true);
    second["partner_name"] = json!("Anna Muster");
    let berta = app.add_starter(&cookie, second).await;

    let starters = list_starters(&app, &cookie, club_id).await;
    let find = |id: Uuid| {
        starters
            .iter()
            .find(|s| s["id"] == id.to_string())
            .unwrap()
            .clone()
    };
    assert_eq!(find(anna)["partner_id"], berta.to_string());
    assert_eq!(find(anna)["resolved_partner_name"], "Berta Muster");
    assert_eq!(find(anna)["resolved_partner_club"], "RSV");
    assert_eq!(find(berta)["partner_id"], anna.to_string());

    let acts = list_acts(&app, &cookie, club_id).await;
    assert_eq!(acts.len(), 1);
    assert_eq!(acts[0]["act_type"], "pair");
    assert_eq!(acts[0]["participants"].as_array().unwrap().len(), 2);
}

#[sqlx::test]
async fn deleting_a_starter_removes_acts_and_unlinks_partner(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (cookie, club_id) = app.create_club_owner("Owner", "RSV").await;

    let anna = app
        .add_starter(&cookie, starter_body(club_id, "Anna", true, true))
        .await;
    let mut second = starter_body(club_id, "Berta", false, true);
    second["partner_id"] = json!(anna);
    let berta = app.add_starter(&cookie, second).await;
    assert_eq!(list_acts(&app, &cookie, club_id).await.len(), 2);

    let response = app
        .post(
            "/api/command/delete_club_starter",
            json!({ "starter_id": anna }),
            Some(&cookie),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK);

    let starters = list_starters(&app, &cookie, club_id).await;
    assert_eq!(starters.len(), 1);
    assert_eq!(starters[0]["id"], berta.to_string());
    assert_eq!(starters[0]["partner_id"], Value::Null);
    assert_eq!(starters[0]["partner_name"], Value::Null);
    assert!(list_acts(&app, &cookie, club_id).await.is_empty());
}

#[sqlx::test]
async fn adding_starter_requires_login(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let response = app
        .post(
            "/api/command/add_club_starter",
            starter_body(Uuid::now_v7(), "Anna", true, false),
            None,
        )
        .await;
    assert_eq!(response.status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test]
async fn set_payment_is_admin_only(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (owner, club_id) = app.create_club_owner("Owner", "RSV").await;
    let admin = app.create_admin().await;
    let body = json!({ "club_id": club_id, "amount": 42.5 });

    let forbidden = app
        .post("/api/command/set_payment", body.clone(), Some(&owner))
        .await;
    assert_eq!(forbidden.status, StatusCode::FORBIDDEN);

    let ok = app
        .post("/api/command/set_payment", body, Some(&admin))
        .await;
    assert_eq!(ok.status, StatusCode::OK, "{:?}", ok.body);

    let club = app.get("/api/query/get_club", Some(&owner)).await;
    assert_eq!(club.body["payment"], 42.5);
}

fn edit_body(starter_id: Uuid, firstname: &str, single: bool, pair: bool) -> Value {
    let mut body = starter_body(Uuid::nil(), firstname, single, pair);
    let body_map = body.as_object_mut().unwrap();
    body_map.remove("club_id");
    // Without a gender, an edit keeps the stored one.
    body_map.remove("gender");
    body_map.insert("starter_id".into(), json!(starter_id));
    body
}

#[sqlx::test]
async fn edit_club_starter_updates_data_and_single_act(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (cookie, club_id) = app.create_club_owner("Owner", "RSV").await;
    let anna = app
        .add_starter(&cookie, starter_body(club_id, "Anna", true, false))
        .await;
    assert_eq!(list_acts(&app, &cookie, club_id).await.len(), 1);

    // Renaming and leaving the single competition removes the single act.
    let response = app
        .post(
            "/api/command/edit_club_starter",
            edit_body(anna, "Annika", false, false),
            Some(&cookie),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    let starters = list_starters(&app, &cookie, club_id).await;
    assert_eq!(starters[0]["firstname"], "Annika");
    assert_eq!(starters[0]["single_female"], false);
    assert!(list_acts(&app, &cookie, club_id).await.is_empty());

    // Re-entering the single competition creates a new act.
    let response = app
        .post(
            "/api/command/edit_club_starter",
            edit_body(anna, "Annika", true, false),
            Some(&cookie),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    let acts = list_acts(&app, &cookie, club_id).await;
    assert_eq!(acts.len(), 1);
    assert_eq!(acts[0]["act_type"], "single");
}

#[sqlx::test]
async fn edit_club_starter_links_partner_and_creates_pair_act(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (cookie, club_id) = app.create_club_owner("Owner", "RSV").await;
    let anna = app
        .add_starter(&cookie, starter_body(club_id, "Anna", false, true))
        .await;
    let berta = app
        .add_starter(&cookie, starter_body(club_id, "Berta", false, true))
        .await;
    assert!(list_acts(&app, &cookie, club_id).await.is_empty());

    let mut body = edit_body(anna, "Anna", false, true);
    body["partner_name"] = json!("Berta Muster");
    let response = app
        .post("/api/command/edit_club_starter", body, Some(&cookie))
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);

    let starters = list_starters(&app, &cookie, club_id).await;
    let find = |id: Uuid| {
        starters
            .iter()
            .find(|s| s["id"] == id.to_string())
            .unwrap()
            .clone()
    };
    assert_eq!(find(anna)["partner_id"], berta.to_string());
    assert_eq!(find(berta)["partner_id"], anna.to_string());
    assert_eq!(find(berta)["partner_name"], "Anna Muster");
    let acts = list_acts(&app, &cookie, club_id).await;
    assert_eq!(acts.len(), 1);
    assert_eq!(acts[0]["act_type"], "pair");
}

#[sqlx::test]
async fn edit_club_starter_unpairing_deletes_pair_act(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (cookie, club_id) = app.create_club_owner("Owner", "RSV").await;
    let anna = app
        .add_starter(&cookie, starter_body(club_id, "Anna", false, true))
        .await;
    let berta = app
        .add_starter(&cookie, starter_body(club_id, "Berta", false, true))
        .await;
    let mut body = edit_body(anna, "Anna", false, true);
    body["partner_name"] = json!("Berta Muster");
    let response = app
        .post("/api/command/edit_club_starter", body, Some(&cookie))
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    assert_eq!(list_acts(&app, &cookie, club_id).await.len(), 1);

    // Leaving the pair competition removes the pair act and the link.
    let response = app
        .post(
            "/api/command/edit_club_starter",
            edit_body(berta, "Berta", false, false),
            Some(&cookie),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    assert!(list_acts(&app, &cookie, club_id).await.is_empty());
    let starters = list_starters(&app, &cookie, club_id).await;
    assert!(starters.iter().all(|s| s["partner_id"] == Value::Null));
}

#[sqlx::test]
async fn edit_club_starter_rejects_pairing_with_oneself(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (cookie, club_id) = app.create_club_owner("Owner", "RSV").await;
    let anna = app
        .add_starter(&cookie, starter_body(club_id, "Anna", false, true))
        .await;

    let mut body = edit_body(anna, "Anna", false, true);
    body["partner_name"] = json!("Anna Muster");
    let response = app
        .post("/api/command/edit_club_starter", body, Some(&cookie))
        .await;

    assert_eq!(response.status, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(
        response.body["message"]
            .as_str()
            .unwrap()
            .contains("selbe Person")
    );
    assert_eq!(
        list_starters(&app, &cookie, club_id).await[0]["partner_id"],
        Value::Null
    );
}

#[sqlx::test]
async fn edit_club_starter_is_forbidden_outside_registration_period(db: SqlitePool) {
    let app = TestApp::with_status(db, closed_registration()).await;
    let owner = app.cookie_for(app.create_user("Owner", false).await);

    let response = app
        .post(
            "/api/command/edit_club_starter",
            edit_body(Uuid::now_v7(), "Anna", true, false),
            Some(&owner),
        )
        .await;

    assert_eq!(response.status, StatusCode::FORBIDDEN);
}

#[sqlx::test]
async fn starter_can_only_start_in_one_single_act(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (cookie, club_id) = app.create_club_owner("Owner", "RSV").await;

    let mut both = starter_body(club_id, "Anna", true, false);
    both["single_male"] = json!(true);
    let response = app
        .post("/api/command/add_club_starter", both, Some(&cookie))
        .await;
    assert_eq!(response.status, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(
        response.body["message"]
            .as_str()
            .unwrap()
            .contains("einer Einzelkür"),
        "{:?}",
        response.body
    );
    assert!(list_starters(&app, &cookie, club_id).await.is_empty());

    let anna = app
        .add_starter(&cookie, starter_body(club_id, "Anna", true, false))
        .await;
    let mut edit = edit_body(anna, "Anna", true, false);
    edit["single_male"] = json!(true);
    let response = app
        .post("/api/command/edit_club_starter", edit, Some(&cookie))
        .await;
    assert_eq!(response.status, StatusCode::INTERNAL_SERVER_ERROR);
    let starters = list_starters(&app, &cookie, club_id).await;
    assert_eq!(starters[0]["single_male"], false);
    assert_eq!(list_acts(&app, &cookie, club_id).await.len(), 1);
}

#[sqlx::test]
async fn club_rosters_are_only_shown_to_the_club_and_admins(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (cookie, club_id) = app.create_club_owner("Owner", "RSV").await;
    let (intruder, _) = app.create_club_owner("Intruder", "ESV").await;
    let admin = app.create_admin().await;
    app.add_starter(&cookie, starter_body(club_id, "Anna", true, false))
        .await;

    // Both list the riders with their birthdates.
    for uri in [
        format!("/api/query/list_club_starters?club_id={club_id}"),
        format!("/api/query/list_club_acts?club_id={club_id}"),
    ] {
        let response = app.get(&uri, None).await;
        assert_eq!(response.status, StatusCode::UNAUTHORIZED, "{uri}");
        let response = app.get(&uri, Some(&intruder)).await;
        assert_eq!(response.status, StatusCode::FORBIDDEN, "{uri}");
        for cookie in [&cookie, &admin] {
            let response = app.get(&uri, Some(cookie)).await;
            assert_eq!(
                response.status,
                StatusCode::OK,
                "{uri}: {:?}",
                response.body
            );
            assert_eq!(response.body.as_array().unwrap().len(), 1, "{uri}");
        }
    }
    let response = app
        .get(
            &format!("/api/query/list_club_starters?club_id={}", Uuid::now_v7()),
            Some(&admin),
        )
        .await;
    assert_eq!(response.status, StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn only_the_club_and_admins_change_its_starters(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (cookie, club_id) = app.create_club_owner("Owner", "RSV").await;
    let (intruder, intruder_club_id) = app.create_club_owner("Intruder", "ESV").await;
    let admin = app.create_admin().await;
    let anna = app
        .add_starter(&cookie, starter_body(club_id, "Anna", true, false))
        .await;

    let response = app
        .post(
            "/api/command/delete_club_starter",
            json!({ "starter_id": anna }),
            Some(&intruder),
        )
        .await;
    assert_eq!(
        response.status,
        StatusCode::FORBIDDEN,
        "{:?}",
        response.body
    );
    let response = app
        .post(
            "/api/command/edit_club_starter",
            edit_body(anna, "Gekapert", false, false),
            Some(&intruder),
        )
        .await;
    assert_eq!(
        response.status,
        StatusCode::FORBIDDEN,
        "{:?}",
        response.body
    );
    let response = app
        .post(
            "/api/command/add_club_starter",
            starter_body(club_id, "Fake", true, false),
            Some(&intruder),
        )
        .await;
    assert_eq!(
        response.status,
        StatusCode::FORBIDDEN,
        "{:?}",
        response.body
    );

    // Nothing changed.
    let starters = list_starters(&app, &cookie, club_id).await;
    assert_eq!(starters.len(), 1);
    assert_eq!(starters[0]["firstname"], "Anna");
    assert_eq!(starters[0]["single_female"], true);
    assert_eq!(list_acts(&app, &cookie, club_id).await.len(), 1);

    // Unknown starters.
    for uri in [
        "/api/command/delete_club_starter",
        "/api/command/edit_club_starter",
    ] {
        let response = app
            .post(
                uri,
                edit_body(Uuid::now_v7(), "Niemand", false, false),
                Some(&admin),
            )
            .await;
        assert_eq!(response.status, StatusCode::NOT_FOUND, "{uri}");
    }

    // Admins can change every club's starters.
    let response = app
        .post(
            "/api/command/add_club_starter",
            starter_body(club_id, "Berta", false, false),
            Some(&admin),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    let response = app
        .post(
            "/api/command/edit_club_starter",
            edit_body(anna, "Annika", true, false),
            Some(&admin),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    let starters = list_starters(&app, &admin, club_id).await;
    assert_eq!(starters.len(), 2);
    assert!(starters.iter().any(|s| s["firstname"] == "Annika"));
    let response = app
        .post(
            "/api/command/delete_club_starter",
            json!({ "starter_id": anna }),
            Some(&admin),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    assert_eq!(response.body, json!({}));
    assert_eq!(list_starters(&app, &cookie, club_id).await.len(), 1);
    assert!(
        list_starters(&app, &intruder, intruder_club_id)
            .await
            .is_empty()
    );
}

#[sqlx::test]
async fn clubs_only_link_partners_of_their_own_club(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (cookie, club_id) = app.create_club_owner("Owner", "RSV").await;
    let (other, other_club_id) = app.create_club_owner("Other", "ESV").await;
    let admin = app.create_admin().await;
    let anna = app
        .add_starter(&cookie, starter_body(club_id, "Anna", false, true))
        .await;
    let zoe = app
        .add_starter(&other, starter_body(other_club_id, "Zoe", false, true))
        .await;

    // Linking a rider of another club would change that club's rider.
    let mut body = starter_body(club_id, "Berta", false, true);
    body["partner_id"] = json!(zoe);
    let response = app
        .post("/api/command/add_club_starter", body, Some(&cookie))
        .await;
    assert_eq!(response.status, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(
        response.body["message"]
            .as_str()
            .unwrap()
            .contains("aus dem eigenen Verein"),
        "{:?}",
        response.body
    );
    let mut body = edit_body(anna, "Anna", false, true);
    body["partner_id"] = json!(zoe);
    let response = app
        .post("/api/command/edit_club_starter", body, Some(&cookie))
        .await;
    assert_eq!(response.status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        list_starters(&app, &other, other_club_id).await[0]["partner_id"],
        Value::Null
    );

    // The organizer links pairs across clubs …
    let mut body = edit_body(anna, "Anna", false, true);
    body["partner_id"] = json!(zoe);
    let response = app
        .post("/api/command/edit_club_starter", body, Some(&admin))
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    let starters = list_starters(&app, &cookie, club_id).await;
    assert_eq!(starters[0]["partner_id"], zoe.to_string());
    assert_eq!(starters[0]["resolved_partner_club"], "ESV");

    // … and the club keeps that link when it edits its rider.
    let mut body = edit_body(anna, "Anna", false, true);
    body["partner_id"] = json!(zoe);
    body["birthdate"] = json!("2015-05-02T00:00:00.000Z");
    let response = app
        .post("/api/command/edit_club_starter", body, Some(&cookie))
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    let starters = list_starters(&app, &cookie, club_id).await;
    assert_eq!(starters[0]["partner_id"], zoe.to_string());
}

#[sqlx::test]
async fn club_code_is_stable_across_renames(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (cookie, club_id) = app.create_club_owner("Owner", "RSV").await;
    let code = |body: &Value| body["code"].as_str().unwrap().to_string();

    let before = app.get("/api/query/get_club", Some(&cookie)).await;
    assert_eq!(before.status, StatusCode::OK, "{:?}", before.body);
    let first = code(&before.body);
    assert!(first.starts_with("EV-") && first.len() == 7, "{first}");

    app.post(
        "/api/command/rename_club",
        json!({ "club_id": club_id, "name": "RSV Neu" }),
        Some(&cookie),
    )
    .await;
    let after = app.get("/api/query/get_club", Some(&cookie)).await;
    assert_eq!(after.body["name"], "RSV Neu");
    assert_eq!(code(&after.body), first);
}

fn find<'a>(starters: &'a [Value], id: Uuid) -> &'a Value {
    starters.iter().find(|s| s["id"] == id.to_string()).unwrap()
}

#[sqlx::test]
async fn starter_gender_defaults_to_the_single_and_must_match_it(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (cookie, club_id) = app.create_club_owner("Owner", "RSV").await;
    let anna = app
        .add_starter(&cookie, starter_body(club_id, "Anna", true, false))
        .await;
    let mut body = starter_body(club_id, "Ben", false, false);
    body["gender"] = json!("male");
    let ben = app.add_starter(&cookie, body).await;
    let starters = list_starters(&app, &cookie, club_id).await;
    assert_eq!(find(&starters, anna)["gender"], "female");
    assert_eq!(find(&starters, ben)["gender"], "male");

    // Einzel weiblich doesn't fit a male rider.
    let mut body = edit_body(ben, "Ben", true, false);
    body["gender"] = json!("male");
    let response = app
        .post("/api/command/edit_club_starter", body, Some(&cookie))
        .await;
    assert_ne!(response.status, StatusCode::OK);

    // Without the field, the stored gender is kept.
    let response = app
        .post(
            "/api/command/edit_club_starter",
            edit_body(ben, "Benjamin", false, false),
            Some(&cookie),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    let starters = list_starters(&app, &cookie, club_id).await;
    assert_eq!(find(&starters, ben)["gender"], "male");
}

#[sqlx::test]
async fn replace_act_rider_moves_a_single_and_keeps_the_act(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (cookie, club_id) = app.create_club_owner("Owner", "RSV").await;
    let anna = app
        .add_starter(&cookie, starter_body(club_id, "Anna", true, false))
        .await;
    let mut body = starter_body(club_id, "Berta", false, false);
    body["gender"] = json!("female");
    let berta = app.add_starter(&cookie, body).await;
    let carl = app
        .add_starter(&cookie, starter_body(club_id, "Carl", false, false))
        .await;
    let act_id = list_acts(&app, &cookie, club_id).await[0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let response = app
        .post(
            "/api/command/edit_club_act",
            json!({ "id": act_id, "name": "Schwanensee", "description": null }),
            Some(&cookie),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);

    // Carl has no gender yet (registered before it was asked).
    sqlx::query("UPDATE starter SET gender = NULL WHERE id = ?")
        .bind(carl)
        .execute(&app.db)
        .await
        .unwrap();
    let response = app
        .post(
            "/api/command/replace_act_rider",
            json!({ "act_id": act_id, "starter_id": anna, "new_starter_id": carl }),
            Some(&cookie),
        )
        .await;
    assert_ne!(response.status, StatusCode::OK);

    let response = app
        .post(
            "/api/command/replace_act_rider",
            json!({ "act_id": act_id, "starter_id": anna, "new_starter_id": berta }),
            Some(&cookie),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    let acts = list_acts(&app, &cookie, club_id).await;
    assert_eq!(acts.len(), 1);
    assert_eq!(acts[0]["id"], act_id);
    assert_eq!(acts[0]["name"], "Schwanensee");
    assert_eq!(acts[0]["participants"][0]["id"], berta.to_string());
    let starters = list_starters(&app, &cookie, club_id).await;
    assert_eq!(find(&starters, anna)["single_female"], false);
    assert_eq!(find(&starters, berta)["single_female"], true);
}

#[sqlx::test]
async fn replace_act_rider_swaps_a_pair_partner(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (cookie, club_id) = app.create_club_owner("Owner", "RSV").await;
    let anna = app
        .add_starter(&cookie, starter_body(club_id, "Anna", false, true))
        .await;
    let berta = app
        .add_starter(&cookie, starter_body(club_id, "Berta", false, true))
        .await;
    let clara = app
        .add_starter(&cookie, starter_body(club_id, "Clara", false, false))
        .await;
    let mut body = edit_body(anna, "Anna", false, true);
    body["partner_name"] = json!("Berta Muster");
    app.post("/api/command/edit_club_starter", body, Some(&cookie))
        .await;
    let act_id = list_acts(&app, &cookie, club_id).await[0]["id"].clone();

    let response = app
        .post(
            "/api/command/replace_act_rider",
            json!({ "act_id": act_id, "starter_id": berta, "new_starter_id": clara }),
            Some(&cookie),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    let acts = list_acts(&app, &cookie, club_id).await;
    assert_eq!(acts.len(), 1);
    assert_eq!(acts[0]["id"], act_id);
    let starters = list_starters(&app, &cookie, club_id).await;
    assert_eq!(find(&starters, anna)["partner_id"], clara.to_string());
    assert_eq!(find(&starters, clara)["partner_id"], anna.to_string());
    assert_eq!(find(&starters, clara)["partner_name"], "Anna Muster");
    assert_eq!(find(&starters, anna)["partner_name"], "Clara Muster");
    assert_eq!(find(&starters, berta)["pair"], false);
    assert_eq!(find(&starters, berta)["partner_id"], Value::Null);
}

#[sqlx::test]
async fn replace_act_rider_rejects_riders_of_other_clubs(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (cookie, club_id) = app.create_club_owner("Owner", "RSV").await;
    let (other_cookie, other_club) = app.create_club_owner("Other", "RV").await;
    let anna = app
        .add_starter(&cookie, starter_body(club_id, "Anna", true, false))
        .await;
    let mut body = starter_body(other_club, "Olga", false, false);
    body["gender"] = json!("female");
    let olga = app.add_starter(&other_cookie, body).await;
    let act_id = list_acts(&app, &cookie, club_id).await[0]["id"].clone();
    let response = app
        .post(
            "/api/command/replace_act_rider",
            json!({ "act_id": act_id, "starter_id": anna, "new_starter_id": olga }),
            Some(&cookie),
        )
        .await;
    assert_ne!(response.status, StatusCode::OK);
    assert_eq!(
        list_acts(&app, &cookie, club_id).await[0]["participants"][0]["id"],
        anna.to_string()
    );
}

#[sqlx::test]
async fn get_club_shows_the_owner_only_to_the_club_and_admins(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (cookie, club_id) = app.create_club_owner("Owner", "RSV").await;
    let (other, _) = app.create_club_owner("Other", "RV").await;
    let admin = app.create_admin().await;
    let uri = format!("/api/query/get_club?club_id={club_id}");

    for cookie in [&cookie, &admin] {
        let club = app.get(&uri, Some(cookie)).await;
        assert_eq!(club.status, StatusCode::OK);
        assert_eq!(club.body["owner_name"], "Owner");
        assert!(club.body["owner_email"].as_str().unwrap().contains('@'));
    }
    for cookie in [Some(other.as_str()), None] {
        let club = app.get(&uri, cookie).await;
        assert_eq!(club.status, StatusCode::OK);
        assert_eq!(club.body["owner_name"], Value::Null);
        assert_eq!(club.body["owner_email"], Value::Null);
    }
}

#[sqlx::test]
async fn add_club_starter_requires_a_gender(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (cookie, club_id) = app.create_club_owner("Owner", "RSV").await;
    let mut body = starter_body(club_id, "Anna", false, false);
    body["gender"] = Value::Null;
    let response = app
        .post("/api/command/add_club_starter", body, Some(&cookie))
        .await;
    assert_ne!(response.status, StatusCode::OK);
    assert!(
        response.body["message"]
            .as_str()
            .unwrap()
            .contains("Geschlecht")
    );
    assert!(list_starters(&app, &cookie, club_id).await.is_empty());
}

#[sqlx::test]
async fn responsible_person_defaults_to_owner_and_can_be_changed(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (cookie, club_id) = app.create_club_owner("Owner", "RSV Test").await;

    let club = app.get("/api/query/get_club", Some(&cookie)).await;
    assert_eq!(club.body["responsible_name"], "Owner");
    assert_eq!(club.body["responsible_email"], "owner@cup.test");

    let response = app
        .post(
            "/api/command/set_club_responsible",
            json!({ "club_id": club_id, "name": "Berta Trainer", "email": "berta@verein.test" }),
            Some(&cookie),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);

    let club = app.get("/api/query/get_club", Some(&cookie)).await;
    assert_eq!(club.body["responsible_name"], "Berta Trainer");
    assert_eq!(club.body["responsible_email"], "berta@verein.test");

    // Clearing both goes back to the owner.
    let response = app
        .post(
            "/api/command/set_club_responsible",
            json!({ "club_id": club_id, "name": null, "email": null }),
            Some(&cookie),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    let club = app.get("/api/query/get_club", Some(&cookie)).await;
    assert_eq!(club.body["responsible_name"], "Owner");
}

#[sqlx::test]
async fn responsible_person_is_only_set_by_the_club_or_admins(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (owner, club_id) = app.create_club_owner("Owner", "RSV Test").await;
    let (other, _) = app.create_club_owner("Other", "RSV Andere").await;
    let body = json!({ "club_id": club_id, "name": "Berta", "email": "berta@verein.test" });

    let response = app
        .post(
            "/api/command/set_club_responsible",
            body.clone(),
            Some(&other),
        )
        .await;
    assert_eq!(response.status, StatusCode::FORBIDDEN);
    let response = app
        .post("/api/command/set_club_responsible", body.clone(), None)
        .await;
    assert_eq!(response.status, StatusCode::UNAUTHORIZED);

    let admin = app.create_admin().await;
    let response = app
        .post("/api/command/set_club_responsible", body, Some(&admin))
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);

    // Other clubs and anonymous visitors don't see the contact.
    let url = format!("/api/query/get_club?club_id={club_id}");
    for cookie in [Some(other.as_str()), None] {
        let club = app.get(&url, cookie).await;
        assert_eq!(club.body["responsible_name"], Value::Null);
        assert_eq!(club.body["responsible_email"], Value::Null);
    }
    let club = app.get(&url, Some(&owner)).await;
    assert_eq!(club.body["responsible_name"], "Berta");

    let clubs = app.get("/api/query/list_clubs", Some(&admin)).await;
    let listed = clubs
        .body
        .as_array()
        .unwrap()
        .iter()
        .find(|club| club["id"] == club_id.to_string())
        .unwrap();
    assert_eq!(listed["responsible_name"], "Berta");
    assert_eq!(listed["responsible_email"], "berta@verein.test");
}

#[sqlx::test]
async fn responsible_person_needs_name_and_a_valid_email(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (cookie, club_id) = app.create_club_owner("Owner", "RSV Test").await;

    for (name, email) in [
        ("Berta", "keine-adresse"),
        ("Berta", "berta@verein"),
        ("Berta", "berta @verein.test"),
        ("", "berta@verein.test"),
        ("Berta", ""),
    ] {
        let response = app
            .post(
                "/api/command/set_club_responsible",
                json!({ "club_id": club_id, "name": name, "email": email }),
                Some(&cookie),
            )
            .await;
        // Validation messages come back as a generic error, as elsewhere.
        assert!(
            !response.status.is_success(),
            "{name:?} {email:?}: {:?}",
            response.status
        );
    }
    let club = app.get("/api/query/get_club", Some(&cookie)).await;
    assert_eq!(club.body["responsible_name"], "Owner");
}

#[sqlx::test]
async fn responsible_person_is_fixed_after_the_registration_for_clubs(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (cookie, club_id) = app.create_club_owner("Owner", "RSV Test").await;
    app.close_registration().await;

    let response = app
        .post(
            "/api/command/set_club_responsible",
            json!({ "club_id": club_id, "name": "Berta", "email": "berta@verein.test" }),
            Some(&cookie),
        )
        .await;
    assert_eq!(response.status, StatusCode::FORBIDDEN);
}

#[sqlx::test]
async fn amount_due_lists_start_fees_jury_fee_and_total(db: SqlitePool) {
    // Only the start fees; the jury fee is tested in tests/jury.rs.
    let app = TestApp::without_jury_registration(db).await;
    let (cookie, club_id) = app.create_club_owner("Owner", "RSV Test").await;
    let (other, other_club) = app.create_club_owner("Other", "RSV Andere").await;

    let club = app.get("/api/query/get_club", Some(&cookie)).await;
    assert_eq!(
        club.body["amount_due"],
        json!({ "start_fees": 0.0, "jury_fee": 0.0, "total": 0.0 })
    );

    app.add_starter(&cookie, starter_body(club_id, "Anna", true, false))
        .await;
    app.add_starter(&cookie, starter_body(club_id, "Carla", true, true))
        .await;
    let dora = app
        .add_starter(&cookie, starter_body(club_id, "Dora", true, true))
        .await;
    let riders = app.add_riders(&cookie, club_id, "Rider", 2).await;
    let members = [dora, riders[0], riders[1]];
    let small = app.create_group(&cookie, club_id, "Klein").await;
    let large = app.create_large_group(&cookie, club_id, "Groß").await;
    for group in [small, large] {
        let response = app
            .set_group_members(&cookie, club_id, group, &members, &[])
            .await;
        assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    }
    app.add_starter(&other, starter_body(other_club, "Olga", true, false))
        .await;

    // Anna 15, Carla 30, Dora 4 starts capped at 45, both riders 2 × 15.
    let expected = json!({ "start_fees": 150.0, "jury_fee": 0.0, "total": 150.0 });
    let club = app.get("/api/query/get_club", Some(&cookie)).await;
    assert_eq!(club.body["amount_due"], expected);

    let admin = app.create_admin().await;
    let clubs = app.get("/api/query/list_clubs", Some(&admin)).await;
    let amounts: Vec<(String, Value)> = clubs
        .body
        .as_array()
        .unwrap()
        .iter()
        .map(|club| {
            (
                club["name"].as_str().unwrap().to_string(),
                club["amount_due"].clone(),
            )
        })
        .collect();
    assert_eq!(
        amounts,
        vec![
            (
                "RSV Andere".to_string(),
                json!({ "start_fees": 15.0, "jury_fee": 0.0, "total": 15.0 })
            ),
            ("RSV Test".to_string(), expected),
        ]
    );

    // Like the contact, the amount is only for the club itself and admins.
    let club = app
        .get(
            &format!("/api/query/get_club?club_id={club_id}"),
            Some(&other),
        )
        .await;
    assert_eq!(club.body["amount_due"], Value::Null);
}

#[sqlx::test]
async fn amount_due_keeps_withdrawn_starts_unless_the_fee_is_waived(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (cookie, club_id) = app.create_club_owner("Owner", "RSV Test").await;
    let admin = app.create_admin().await;
    let anna = app
        .add_starter(&cookie, starter_body(club_id, "Anna", true, true))
        .await;
    let single = app.act_of_type(anna, "single").await;
    let start_fees = async || {
        let club = app.get("/api/query/get_club", Some(&cookie)).await;
        club.body["amount_due"]["start_fees"].clone()
    };
    assert_eq!(start_fees().await, 30.0);

    for (fee_waived, expected) in [(false, 30.0), (true, 15.0)] {
        let response = app
            .post(
                "/api/command/set_act_withdrawn",
                json!({ "act_id": single, "withdrawn": true, "fee_waived": fee_waived }),
                Some(&admin),
            )
            .await;
        assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
        assert_eq!(start_fees().await, expected, "fee_waived: {fee_waived}");
    }
}
