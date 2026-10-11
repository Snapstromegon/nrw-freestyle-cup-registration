//! Integration tests for acts: editing, music uploads, ordering and startlists.

mod common;

use axum::http::StatusCode;
use common::{TestApp, closed_registration, starter_body};
use serde_json::{Value, json};
use sqlx::SqlitePool;
use uuid::Uuid;

async fn get_act(app: &TestApp, act_id: Uuid) -> Value {
    get_act_as(app, None, act_id).await
}

async fn get_act_as(app: &TestApp, cookie: Option<&str>, act_id: Uuid) -> Value {
    let response = app
        .get(&format!("/api/query/get_act?act_id={act_id}"), cookie)
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
    let app = TestApp::new(db).await;
    let (_, single, pair) = club_with_acts(&app).await;
    let admin = app.create_admin().await;

    let act = get_act_as(&app, Some(&admin), single).await;
    assert_eq!(act["id"], single.to_string());
    assert_eq!(act["act_type"], "single");
    assert_eq!(act["category"], "EWU13");
    assert_eq!(act["song_checked"], false);
    assert_eq!(act["song_file"], Value::Null);
    let participants = act["participants"].as_array().unwrap();
    assert_eq!(participants.len(), 1);
    assert_eq!(participants[0]["firstname"], "Anna");
    assert_eq!(participants[0]["club_name"], "RSV");
    assert_eq!(act["type_conflict"], false);
    // Born 2015-05-01, determining day 2027-06-01.
    let max_age = act["max_age"].as_f64().unwrap();
    assert!((12.0..12.1).contains(&max_age), "{max_age}");

    let act = get_act(&app, pair).await;
    assert_eq!(act["act_type"], "pair");
    assert_eq!(act["category"], "PU13");
    assert_eq!(act["participants"].as_array().unwrap().len(), 2);
}

/// Category of the act of the given type the starter takes part in.
async fn category_of(app: &TestApp, starter_id: Uuid, act_type: &str) -> Value {
    let act_id: Uuid = sqlx::query_scalar(
        "SELECT act_id FROM act_participants JOIN acts ON acts.id = act_id WHERE starter_id = ? AND act_type = ?",
    )
    .bind(starter_id)
    .bind(act_type)
    .fetch_one(&app.db)
    .await
    .unwrap();
    get_act(app, act_id).await["category"].clone()
}

#[sqlx::test]
async fn categories_follow_gender_and_age(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (cookie, club_id) = app.create_club_owner("Owner", "RSV").await;
    let starter = |name: &str, birthdate: &str, male: bool, female: bool, pair: bool| {
        let mut body = starter_body(club_id, name, female, pair);
        body["single_male"] = json!(male);
        body["birthdate"] = json!(birthdate);
        body
    };

    // Same age, different gender.
    let max = app
        .add_starter(
            &cookie,
            starter("Max", "2015-05-01T00:00:00.000Z", true, false, false),
        )
        .await;
    let mia = app
        .add_starter(
            &cookie,
            starter("Mia", "2015-05-01T00:00:00.000Z", false, true, false),
        )
        .await;
    assert_eq!(category_of(&app, max, "single").await, "EMU13");
    assert_eq!(category_of(&app, mia, "single").await, "EWU13");

    // Turning 17 on the determining day counts as U19, one day later as U17.
    let older = app
        .add_starter(
            &cookie,
            starter("Olga", "2010-06-01T00:00:00.000Z", false, true, false),
        )
        .await;
    let younger = app
        .add_starter(
            &cookie,
            starter("Yara", "2010-06-02T00:00:00.000Z", false, true, false),
        )
        .await;
    assert_eq!(category_of(&app, older, "single").await, "EWU19");
    assert_eq!(category_of(&app, younger, "single").await, "EWU17");

    let senior = app
        .add_starter(
            &cookie,
            starter("Sepp", "1950-01-01T00:00:00.000Z", true, false, false),
        )
        .await;
    assert_eq!(category_of(&app, senior, "single").await, "EM70+");

    // Pairs aren't split by gender, even if both riders also start in a male single.
    let ben = app
        .add_starter(
            &cookie,
            starter("Ben", "2015-05-01T00:00:00.000Z", true, false, true),
        )
        .await;
    let mut tom = starter("Tom", "2015-05-01T00:00:00.000Z", true, false, true);
    tom["partner_id"] = json!(ben);
    app.add_starter(&cookie, tom).await;
    assert_eq!(category_of(&app, ben, "pair").await, "PU13");
}

#[sqlx::test]
async fn get_unknown_act_fails(db: SqlitePool) {
    let app = TestApp::new(db).await;
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
    let app = TestApp::new(db).await;
    let (_, single, pair) = club_with_acts(&app).await;

    let acts = list_acts(&app).await;
    let ids: Vec<_> = acts.iter().map(|a| a["id"].as_str().unwrap()).collect();
    assert_eq!(ids, [single.to_string(), pair.to_string()]);
    assert!(acts[0]["category_order"].as_i64() < acts[1]["category_order"].as_i64());
}

#[sqlx::test]
async fn edit_club_act_sets_name_and_description(db: SqlitePool) {
    let app = TestApp::new(db).await;
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
    let app = TestApp::with_status(db, closed_registration()).await;
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
    let app = TestApp::new(db).await;
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
    let app = TestApp::new(db).await;
    let (cookie, single, _) = club_with_acts(&app).await;
    let uri = format!("/api/command/save_act_song?act_id={single}");

    let admin = app.create_admin().await;

    app.post_file(&uri, "first.mp3", b"first", Some(&cookie))
        .await;
    let response = app
        .post(
            "/api/command/set_song_checked",
            json!({ "act_id": single, "checked": true }),
            Some(&admin),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    assert_eq!(get_act(&app, single).await["song_checked"], true);
    app.post_file(&uri, "second.mp3", b"second", Some(&cookie))
        .await;

    assert_eq!(
        std::fs::read(app.data_path().join(format!("{single}.mp3"))).unwrap(),
        b"second"
    );
    let act = get_act(&app, single).await;
    assert_eq!(act["song_file_name"], "second.mp3");
    // Nobody has listened to the new file yet.
    assert_eq!(act["song_checked"], false);
}

#[sqlx::test]
async fn only_the_acts_clubs_and_admins_edit_an_act(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (_, single, _) = club_with_acts(&app).await;
    let (intruder, _) = app.create_club_owner("Intruder", "ESV").await;
    let loner = app.cookie_for(app.create_user("Loner", false).await);
    let admin = app.create_admin().await;
    let song_uri = format!("/api/command/save_act_song?act_id={single}");

    for cookie in [&intruder, &loner] {
        let response = app
            .post(
                "/api/command/edit_club_act",
                json!({ "id": single, "name": "Gekapert", "description": null }),
                Some(cookie),
            )
            .await;
        assert_eq!(
            response.status,
            StatusCode::FORBIDDEN,
            "{:?}",
            response.body
        );
        let response = app
            .post_file(&song_uri, "fremd.mp3", b"fremd", Some(cookie))
            .await;
        assert_eq!(
            response.status,
            StatusCode::FORBIDDEN,
            "{:?}",
            response.body
        );
    }
    let act = get_act(&app, single).await;
    assert_eq!(act["name"], "");
    assert_eq!(act["song_file"], Value::Null);
    // The file wasn't written either.
    assert_eq!(std::fs::read_dir(app.data_path()).unwrap().count(), 0);

    // Unknown acts.
    let unknown = Uuid::now_v7();
    let response = app
        .post(
            "/api/command/edit_club_act",
            json!({ "id": unknown, "name": "X", "description": null }),
            Some(&admin),
        )
        .await;
    assert_eq!(response.status, StatusCode::NOT_FOUND);
    let response = app
        .post_file(
            &format!("/api/command/save_act_song?act_id={unknown}"),
            "x.mp3",
            b"x",
            Some(&admin),
        )
        .await;
    assert_eq!(response.status, StatusCode::NOT_FOUND);

    // Admins can edit every act.
    let response = app
        .post(
            "/api/command/edit_club_act",
            json!({ "id": single, "name": "Vom Admin", "description": null }),
            Some(&admin),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    let response = app
        .post_file(&song_uri, "admin.mp3", b"admin", Some(&admin))
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    let act = get_act(&app, single).await;
    assert_eq!(act["name"], "Vom Admin");
    assert_eq!(act["song_file_name"], "admin.mp3");
}

#[sqlx::test]
async fn ages_are_only_shown_to_admins(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let (owner, single, pair) = club_with_acts(&app).await;
    let admin = app.create_admin().await;

    // The exact age would give away the rider's birthdate.
    for cookie in [None, Some(owner.as_str())] {
        let response = app.get("/api/query/list_acts", cookie).await;
        assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
        for act in response.body.as_array().unwrap() {
            assert_eq!(act["max_age"], Value::Null, "{act}");
        }
        for act_id in [single, pair] {
            assert_eq!(
                get_act_as(&app, cookie, act_id).await["max_age"],
                Value::Null
            );
        }
    }
    let response = app.get("/api/query/startlist", None).await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    for act in response.body.as_array().unwrap() {
        assert!(act.get("max_age").is_none(), "{act}");
        for participant in act["participants"].as_array().unwrap() {
            assert!(participant.get("club_id").is_none(), "{participant}");
        }
    }

    let response = app.get("/api/query/list_acts", Some(&admin)).await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    for act in response.body.as_array().unwrap() {
        assert!(act["max_age"].as_f64().unwrap() > 12.0, "{act}");
    }
}

#[sqlx::test]
async fn save_act_song_rejects_file_without_extension(db: SqlitePool) {
    let app = TestApp::new(db).await;
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
    let app = TestApp::new(db).await;
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
    let app = TestApp::with_status(db, closed_registration()).await;
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
    let app = TestApp::new(db).await;
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
    let app = TestApp::new(db).await;
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
    let app = TestApp::new(db).await;
    let (_, single, pair) = club_with_acts(&app).await;

    let response = app.get("/api/query/startlist", None).await;

    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    let acts = response.body.as_array().unwrap();
    assert_eq!(acts.len(), 2);
    assert_eq!(acts[0]["id"], single.to_string());
    assert_eq!(acts[0]["category"], "EWU13");
    assert_eq!(acts[0]["participants"][0]["club_name"], "RSV");
    assert_eq!(acts[1]["id"], pair.to_string());
    assert_eq!(acts[1]["participants"].as_array().unwrap().len(), 2);
    // The public startlist doesn't expose music or review details.
    assert!(acts[0].get("song_file").is_none());
    assert!(acts[0].get("song_checked").is_none());
}

#[sqlx::test]
async fn startlist_csv_contains_header_sections_and_acts(db: SqlitePool) {
    let app = TestApp::new(db).await;
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
            "Einzel Weiblich U13",
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
