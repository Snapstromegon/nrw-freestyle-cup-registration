//! Integration tests for acts: editing, music uploads, ordering and startlists.

mod common;

use axum::http::StatusCode;
use common::{TestApp, closed_registration, starter_body};
use serde_json::{Value, json};
use sqlx::SqlitePool;
use uuid::Uuid;

async fn get_act(app: &TestApp, act_id: Uuid) -> Value {
    let response = app
        .get(&format!("/api/query/get_act?act_id={act_id}"), None)
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    response.body
}

async fn list_acts(app: &TestApp) -> Vec<Value> {
    let response = app.get("/api/query/list_acts", None).await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    response.body.as_array().unwrap().clone()
}

/// Creates a club with one single act and one pair act.
async fn club_with_acts(app: &TestApp) -> (String, Uuid, Uuid) {
    let (cookie, club_id) = app.create_club_owner("Owner", "RSV").await;
    let single = app.add_single_act(&cookie, club_id, "Anna").await;
    let berta = app
        .add_starter(&cookie, starter_body(club_id, "Berta", false, true))
        .await;
    let mut carla = starter_body(club_id, "Carla", false, true);
    carla["partner_id"] = json!(berta);
    let carla = app.add_starter(&cookie, carla).await;
    let pair = app.act_of(carla).await;
    (cookie, single, pair)
}

#[sqlx::test]
async fn get_act_returns_category_and_participants(db: SqlitePool) {
    let app = TestApp::new(db);
    let (_, single, pair) = club_with_acts(&app).await;

    let act = get_act(&app, single).await;
    assert_eq!(act["id"], single.to_string());
    assert_eq!(act["is_pair"], false);
    assert_eq!(act["category"], "NEWU13");
    assert_eq!(act["song_checked"], false);
    assert_eq!(act["song_file"], Value::Null);
    let participants = act["participants"].as_array().unwrap();
    assert_eq!(participants.len(), 1);
    assert_eq!(participants[0]["firstname"], "Anna");
    assert_eq!(participants[0]["club_name"], "RSV");
    // Born 2012-05-01, competition on 2026-04-19.
    let max_age = act["max_age"].as_f64().unwrap();
    assert!((13.9..14.0).contains(&max_age), "{max_age}");

    let act = get_act(&app, pair).await;
    assert_eq!(act["is_pair"], true);
    assert_eq!(act["category"], "NPU13");
    assert_eq!(act["participants"].as_array().unwrap().len(), 2);
}

#[sqlx::test]
async fn get_unknown_act_fails(db: SqlitePool) {
    let app = TestApp::new(db);
    let response = app
        .get(
            &format!("/api/query/get_act?act_id={}", Uuid::now_v7()),
            None,
        )
        .await;
    assert_eq!(response.status, StatusCode::INTERNAL_SERVER_ERROR);
}

#[sqlx::test]
async fn list_acts_is_sorted_by_category_order(db: SqlitePool) {
    let app = TestApp::new(db);
    let (_, single, pair) = club_with_acts(&app).await;

    let acts = list_acts(&app).await;
    let ids: Vec<_> = acts.iter().map(|a| a["id"].as_str().unwrap()).collect();
    assert_eq!(ids, [single.to_string(), pair.to_string()]);
    assert!(acts[0]["category_order"].as_i64() < acts[1]["category_order"].as_i64());
}

#[sqlx::test]
async fn edit_club_act_sets_name_and_description(db: SqlitePool) {
    let app = TestApp::new(db);
    let (cookie, single, _) = club_with_acts(&app).await;

    let response = app
        .post(
            "/api/command/edit_club_act",
            json!({ "id": single, "name": "Sternenstaub", "description": "Mit Seil" }),
            Some(&cookie),
        )
        .await;

    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    let act = get_act(&app, single).await;
    assert_eq!(act["name"], "Sternenstaub");
    assert_eq!(act["description"], "Mit Seil");
}

#[sqlx::test]
async fn edit_club_act_is_forbidden_after_music_deadline(db: SqlitePool) {
    let app = TestApp::with_status(db, closed_registration());
    let owner = app.cookie_for(app.create_user("Owner", false).await);

    let response = app
        .post(
            "/api/command/edit_club_act",
            json!({ "id": Uuid::now_v7(), "name": "X", "description": null }),
            Some(&owner),
        )
        .await;

    assert_eq!(response.status, StatusCode::FORBIDDEN);
}

#[sqlx::test]
async fn save_act_song_stores_file_and_metadata(db: SqlitePool) {
    let app = TestApp::new(db);
    let (cookie, single, _) = club_with_acts(&app).await;
    let contents = b"ID3 not really an mp3";

    let response = app
        .post_file(
            &format!("/api/command/save_act_song?act_id={single}"),
            "Mein Lied.mp3",
            contents,
            Some(&cookie),
        )
        .await;

    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    let stored_name = format!("{single}.mp3");
    assert_eq!(
        std::fs::read(app.data_path().join(&stored_name)).unwrap(),
        contents
    );
    let act = get_act(&app, single).await;
    assert_eq!(act["song_file"], stored_name);
    assert_eq!(act["song_file_name"], "Mein Lied.mp3");
}

#[sqlx::test]
async fn save_act_song_replaces_previous_upload(db: SqlitePool) {
    let app = TestApp::new(db);
    let (cookie, single, _) = club_with_acts(&app).await;
    let uri = format!("/api/command/save_act_song?act_id={single}");

    app.post_file(&uri, "first.mp3", b"first", Some(&cookie))
        .await;
    app.post_file(&uri, "second.mp3", b"second", Some(&cookie))
        .await;

    assert_eq!(
        std::fs::read(app.data_path().join(format!("{single}.mp3"))).unwrap(),
        b"second"
    );
    assert_eq!(get_act(&app, single).await["song_file_name"], "second.mp3");
}

#[sqlx::test]
async fn save_act_song_rejects_file_without_extension(db: SqlitePool) {
    let app = TestApp::new(db);
    let (cookie, single, _) = club_with_acts(&app).await;

    let response = app
        .post_file(
            &format!("/api/command/save_act_song?act_id={single}"),
            "song",
            b"data",
            Some(&cookie),
        )
        .await;

    assert_eq!(response.status, StatusCode::BAD_REQUEST);
    assert_eq!(std::fs::read_dir(app.data_path()).unwrap().count(), 0);
}

#[sqlx::test]
async fn save_act_song_requires_login(db: SqlitePool) {
    let app = TestApp::new(db);
    let response = app
        .post_file(
            &format!("/api/command/save_act_song?act_id={}", Uuid::now_v7()),
            "song.mp3",
            b"data",
            None,
        )
        .await;
    assert_eq!(response.status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test]
#[ignore = "known bug: save_act_song does not check can_upload_music"]
async fn save_act_song_is_forbidden_after_music_deadline(db: SqlitePool) {
    let app = TestApp::with_status(db, closed_registration());
    let owner = app.cookie_for(app.create_user("Owner", false).await);

    let response = app
        .post_file(
            &format!("/api/command/save_act_song?act_id={}", Uuid::now_v7()),
            "song.mp3",
            b"data",
            Some(&owner),
        )
        .await;

    assert_eq!(response.status, StatusCode::FORBIDDEN);
}

#[sqlx::test]
async fn set_song_checked_is_admin_only(db: SqlitePool) {
    let app = TestApp::new(db);
    let (owner, single, _) = club_with_acts(&app).await;
    let admin = app.create_admin().await;

    let forbidden = app
        .post(
            "/api/command/set_song_checked",
            json!({ "act_id": single, "checked": true }),
            Some(&owner),
        )
        .await;
    assert_eq!(forbidden.status, StatusCode::FORBIDDEN);
    assert_eq!(get_act(&app, single).await["song_checked"], false);

    for checked in [true, false] {
        let response = app
            .post(
                "/api/command/set_song_checked",
                json!({ "act_id": single, "checked": checked }),
                Some(&admin),
            )
            .await;
        assert_eq!(response.status, StatusCode::OK);
        assert_eq!(get_act(&app, single).await["song_checked"], checked);
    }
}

#[sqlx::test]
async fn set_act_order_reorders_acts_within_category(db: SqlitePool) {
    let app = TestApp::new(db);
    let (owner, club_id) = app.create_club_owner("Owner", "RSV").await;
    let admin = app.create_admin().await;
    let anna = app.add_single_act(&owner, club_id, "Anna").await;
    let berta = app.add_single_act(&owner, club_id, "Berta").await;

    let forbidden = app
        .post(
            "/api/command/set_act_order",
            json!({ "act_id": anna, "order": 1 }),
            Some(&owner),
        )
        .await;
    assert_eq!(forbidden.status, StatusCode::FORBIDDEN);

    for (act_id, order) in [(anna, 2), (berta, 1)] {
        let response = app
            .post(
                "/api/command/set_act_order",
                json!({ "act_id": act_id, "order": order }),
                Some(&admin),
            )
            .await;
        assert_eq!(response.status, StatusCode::OK);
    }

    let acts = list_acts(&app).await;
    let ids: Vec<_> = acts.iter().map(|a| a["id"].as_str().unwrap()).collect();
    assert_eq!(ids, [berta.to_string(), anna.to_string()]);
    assert_eq!(acts[0]["act_order"], 1);
    assert_eq!(acts[1]["act_order"], 2);
}

#[sqlx::test]
async fn startlist_lists_acts_with_participants_and_clubs(db: SqlitePool) {
    let app = TestApp::new(db);
    let (_, single, pair) = club_with_acts(&app).await;

    let response = app.get("/api/query/startlist", None).await;

    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    let acts = response.body.as_array().unwrap();
    assert_eq!(acts.len(), 2);
    assert_eq!(acts[0]["id"], single.to_string());
    assert_eq!(acts[0]["category"], "NEWU13");
    assert_eq!(acts[0]["participants"][0]["club_name"], "RSV");
    assert_eq!(acts[1]["id"], pair.to_string());
    assert_eq!(acts[1]["participants"].as_array().unwrap().len(), 2);
    // The public startlist doesn't expose music or review details.
    assert!(acts[0].get("song_file").is_none());
    assert!(acts[0].get("song_checked").is_none());
}

#[sqlx::test]
async fn startlist_csv_contains_header_sections_and_acts(db: SqlitePool) {
    let app = TestApp::new(db);
    let (cookie, single, _) = club_with_acts(&app).await;
    app.post(
        "/api/command/edit_club_act",
        json!({ "id": single, "name": "Sternenstaub", "description": null }),
        Some(&cookie),
    )
    .await;

    let response = app.get("/api/query/get_startlist_csv", None).await;

    assert_eq!(response.status, StatusCode::OK);
    let csv = response.body.as_str().unwrap();
    let lines: Vec<_> = csv.lines().collect();
    assert_eq!(
        lines[0],
        "Wettbewerb;Anzahl Fahrer;Startnummer/PK;Land;Kürtitel;Name;Verein;Startzeit"
    );

    let single_line = lines
        .iter()
        .find(|l| l.contains("Anna Muster"))
        .expect("single act in CSV");
    let fields: Vec<_> = single_line.split(';').collect();
    assert_eq!(
        fields[..7],
        [
            "Nachwuchscup Einzel Weiblich U13",
            "1",
            "1",
            "Deutschland",
            "Sternenstaub",
            "Anna Muster",
            "RSV",
        ]
    );

    let pair_line = lines
        .iter()
        .find(|l| l.contains("Berta Muster"))
        .expect("pair act in CSV");
    let fields: Vec<_> = pair_line.split(';').collect();
    assert_eq!(fields[1], "2");
    assert_eq!(fields[2], "2");
    assert!(
        fields[5] == "Berta Muster & Carla Muster" || fields[5] == "Carla Muster & Berta Muster"
    );
    assert_eq!(fields[6], "RSV");

    // Every timeplan entry gets a section line.
    let timeplan_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM timeplan")
        .fetch_one(&app.db)
        .await
        .unwrap();
    let sections = lines.iter().filter(|l| l.starts_with("# ")).count();
    assert_eq!(sections as i64, timeplan_rows);
    assert!(
        lines
            .iter()
            .any(|l| l.starts_with("# ") && l.ends_with(" Mittagspause"))
    );
}
