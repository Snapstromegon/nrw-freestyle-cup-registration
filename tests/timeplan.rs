//! Integration tests for editing and running the timeplan.

mod common;

use axum::http::StatusCode;
use common::{TestApp, starter_body};
use serde_json::{Value, json};
use sqlx::SqlitePool;

/// Format sent by the admin frontend.
const START: &str = "2026-04-19T09:00:00Z";

async fn list_timeplan(app: &TestApp) -> Vec<Value> {
    let response = app.get("/api/query/list_timeplan", None).await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    response.body.as_array().unwrap().clone()
}

fn ids(entries: &[Value]) -> Vec<i64> {
    entries.iter().map(|e| e["id"].as_i64().unwrap()).collect()
}

fn labels(entries: &[Value]) -> Vec<String> {
    entries
        .iter()
        .map(|e| {
            e["category"]
                .as_str()
                .or(e["label"].as_str())
                .unwrap()
                .to_string()
        })
        .collect()
}

/// Replaces the seeded timeplan with the given entries.
async fn replace_timeplan(app: &TestApp, admin: &str, entries: &[Value]) {
    for id in ids(&list_timeplan(app).await) {
        let response = app
            .post(
                "/api/command/delete_timeplan_entry",
                json!({ "id": id }),
                Some(admin),
            )
            .await;
        assert_eq!(response.status, StatusCode::OK);
    }
    for entry in entries {
        let response = app
            .post(
                "/api/command/add_timeplan_entry",
                entry.clone(),
                Some(admin),
            )
            .await;
        assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    }
}

fn category_entry(category: &str, earliest_start_time: Option<&str>) -> Value {
    json!({
        "earliest_start_time": earliest_start_time,
        "duration_seconds": null,
        "label": null,
        "category": category,
    })
}

fn custom_entry(label: &str, duration_seconds: i64) -> Value {
    json!({
        "earliest_start_time": null,
        "duration_seconds": duration_seconds,
        "label": label,
        "category": null,
    })
}

#[sqlx::test]
async fn list_timeplan_returns_seeded_entries_in_order(db: SqlitePool) {
    let app = TestApp::new(db).await;

    let entries = list_timeplan(&app).await;

    assert!(!entries.is_empty());
    assert!(ids(&entries).is_sorted());
    assert_eq!(entries[0]["category"], "EMU11");
    assert!(entries[0]["earliest_start_time"].is_string());
    let lunch = entries
        .iter()
        .find(|e| e["label"] == "Mittagspause")
        .unwrap();
    assert_eq!(lunch["duration_seconds"], 45 * 60);
    assert_eq!(lunch["category"], Value::Null);
    assert!(entries.iter().all(|e| e["started_at"].is_null()));
}

#[sqlx::test]
async fn timeplan_commands_require_admin(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let user = app.cookie_for(app.create_user("Alex", false).await);
    let before = list_timeplan(&app).await;
    let mut edit = custom_entry("X", 60);
    edit["id"] = json!(1);

    for (uri, body) in [
        ("/api/command/add_timeplan_entry", custom_entry("X", 60)),
        ("/api/command/edit_timeplan_entry", edit),
        ("/api/command/delete_timeplan_entry", json!({ "id": 1 })),
        ("/api/command/move_timeplan_up", json!({ "id": 2 })),
        ("/api/command/move_timeplan_down", json!({ "id": 1 })),
        ("/api/command/timeplan_forward", json!(null)),
        ("/api/command/timeplan_backward", json!(null)),
    ] {
        let response = app.post(uri, body.clone(), Some(&user)).await;
        assert_eq!(response.status, StatusCode::FORBIDDEN, "{uri}");
        let response = app.post(uri, body, None).await;
        assert_eq!(response.status, StatusCode::UNAUTHORIZED, "{uri}");
    }

    assert_eq!(list_timeplan(&app).await, before);
}

#[sqlx::test]
async fn add_edit_and_delete_timeplan_entries(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let admin = app.create_admin().await;
    replace_timeplan(
        &app,
        &admin,
        &[
            category_entry("EWU13", Some(START)),
            custom_entry("Pause", 900),
        ],
    )
    .await;

    let entries = list_timeplan(&app).await;
    assert_eq!(labels(&entries), ["EWU13", "Pause"]);
    assert_eq!(
        entries[0]["earliest_start_time"],
        "+002026-04-19T09:00:00.000000000Z"
    );
    assert_eq!(entries[1]["duration_seconds"], 900);

    let mut edit = custom_entry("Mittagessen", 1800);
    edit["id"] = entries[1]["id"].clone();
    let response = app
        .post("/api/command/edit_timeplan_entry", edit, Some(&admin))
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    let entries = list_timeplan(&app).await;
    assert_eq!(entries[1]["label"], "Mittagessen");
    assert_eq!(entries[1]["duration_seconds"], 1800);

    let response = app
        .post(
            "/api/command/delete_timeplan_entry",
            json!({ "id": entries[1]["id"] }),
            Some(&admin),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK);
    assert_eq!(labels(&list_timeplan(&app).await), ["EWU13"]);
}

#[sqlx::test]
async fn delete_unknown_timeplan_entry_is_not_found(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let admin = app.create_admin().await;
    let response = app
        .post(
            "/api/command/delete_timeplan_entry",
            json!({ "id": 999_999 }),
            Some(&admin),
        )
        .await;
    assert_eq!(response.status, StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn move_timeplan_entries_up_and_down(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let admin = app.create_admin().await;
    replace_timeplan(
        &app,
        &admin,
        &[
            custom_entry("A", 60),
            custom_entry("B", 60),
            custom_entry("C", 60),
        ],
    )
    .await;
    let original_ids = ids(&list_timeplan(&app).await);

    let response = app
        .post(
            "/api/command/move_timeplan_up",
            json!({ "id": original_ids[2] }),
            Some(&admin),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    let entries = list_timeplan(&app).await;
    assert_eq!(labels(&entries), ["A", "C", "B"]);
    // Entries swap places; the set of ids stays the same.
    assert_eq!(ids(&entries), original_ids);

    let response = app
        .post(
            "/api/command/move_timeplan_down",
            json!({ "id": original_ids[0] }),
            Some(&admin),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    assert_eq!(labels(&list_timeplan(&app).await), ["C", "A", "B"]);
}

#[sqlx::test]
async fn moving_first_entry_up_or_last_entry_down_is_rejected(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let admin = app.create_admin().await;
    replace_timeplan(
        &app,
        &admin,
        &[custom_entry("A", 60), custom_entry("B", 60)],
    )
    .await;
    let entry_ids = ids(&list_timeplan(&app).await);

    let up = app
        .post(
            "/api/command/move_timeplan_up",
            json!({ "id": entry_ids[0] }),
            Some(&admin),
        )
        .await;
    assert_eq!(up.status, StatusCode::BAD_REQUEST);

    let down = app
        .post(
            "/api/command/move_timeplan_down",
            json!({ "id": entry_ids[1] }),
            Some(&admin),
        )
        .await;
    assert_eq!(down.status, StatusCode::BAD_REQUEST);

    assert_eq!(labels(&list_timeplan(&app).await), ["A", "B"]);
}

/// Returns the status of every timeplan item and of the acts of the first item.
async fn progress(app: &TestApp) -> (Vec<String>, Vec<String>) {
    let response = app.get("/api/query/predict_timeplan", None).await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    let items = response.body["items"].as_array().unwrap();
    let item_status = items
        .iter()
        .map(|i| i["status"].as_str().unwrap().to_string())
        .collect();
    let act_status = items[0]["timeplan_entry"]["Category"]["acts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["status"].as_str().unwrap().to_string())
        .collect();
    (item_status, act_status)
}

#[sqlx::test]
async fn timeplan_forward_and_backward_walk_through_acts(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let admin = app.create_admin().await;
    let (owner, club_id) = app.create_club_owner("Owner", "RSV").await;
    for (order, name) in [(1, "Anna"), (2, "Berta")] {
        let act_id = app.add_single_act(&owner, club_id, name).await;
        app.post(
            "/api/command/set_act_order",
            json!({ "act_id": act_id, "order": order }),
            Some(&admin),
        )
        .await;
    }
    // A pair act for the second category.
    let carla = app
        .add_starter(&owner, starter_body(club_id, "Carla", false, true))
        .await;
    let mut dora = starter_body(club_id, "Dora", false, true);
    dora["partner_id"] = json!(carla);
    app.add_starter(&owner, dora).await;
    replace_timeplan(
        &app,
        &admin,
        &[
            category_entry("EWU13", Some(START)),
            category_entry("PU13", None),
        ],
    )
    .await;

    let forward = async || {
        let response = app
            .post("/api/command/timeplan_forward", json!(null), Some(&admin))
            .await;
        assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    };
    let backward = async || {
        let response = app
            .post("/api/command/timeplan_backward", json!(null), Some(&admin))
            .await;
        assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    };
    let state = |items: [&str; 2], acts: [&str; 2]| {
        (
            items.map(String::from).to_vec(),
            acts.map(String::from).to_vec(),
        )
    };

    // Each step forward, with the state after it.
    let steps = [
        // Category starts with its warm-up time; no act runs yet.
        state(["Started", "Planned"], ["Planned", "Planned"]),
        state(["Started", "Planned"], ["Started", "Planned"]),
        state(["Started", "Planned"], ["Ended", "Planned"]),
        state(["Started", "Planned"], ["Ended", "Started"]),
        // Ending the last act ends the category.
        state(["Ended", "Planned"], ["Ended", "Ended"]),
        // The next category starts with its warm-up time.
        state(["Ended", "Started"], ["Ended", "Ended"]),
    ];
    let initial = state(["Planned", "Planned"], ["Planned", "Planned"]);
    assert_eq!(progress(&app).await, initial);
    for expected in &steps {
        forward().await;
        assert_eq!(&progress(&app).await, expected);
    }

    // Going backwards undoes one step at a time, back to the initial state.
    // Reopening a category also reopens its last act.
    for expected in steps.iter().rev().skip(1) {
        backward().await;
        assert_eq!(&progress(&app).await, expected);
    }
    backward().await;
    assert_eq!(progress(&app).await, initial);
}

#[sqlx::test]
async fn timeplan_forward_starts_custom_entry(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let admin = app.create_admin().await;
    replace_timeplan(&app, &admin, &[custom_entry("Pause", 900)]).await;

    let response = app
        .post("/api/command/timeplan_forward", json!(null), Some(&admin))
        .await;

    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    assert!(list_timeplan(&app).await[0]["started_at"].is_string());
}

#[sqlx::test]
async fn timeplan_backward_without_progress_does_nothing(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let admin = app.create_admin().await;
    let before = list_timeplan(&app).await;

    let response = app
        .post("/api/command/timeplan_backward", json!(null), Some(&admin))
        .await;

    assert_eq!(response.status, StatusCode::OK);
    assert_eq!(list_timeplan(&app).await, before);
}

#[sqlx::test]
async fn timeplan_forward_skips_category_without_acts(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let admin = app.create_admin().await;
    replace_timeplan(
        &app,
        &admin,
        &[
            category_entry("EWU13", Some(START)),
            custom_entry("Pause", 900),
        ],
    )
    .await;

    // One step skips the empty block and starts the break.
    app.post("/api/command/timeplan_forward", json!(null), Some(&admin))
        .await;

    let entries = list_timeplan(&app).await;
    assert!(entries[0]["started_at"].is_string(), "{entries:?}");
    assert!(entries[0]["ended_at"].is_string(), "{entries:?}");
    assert!(entries[1]["started_at"].is_string(), "{entries:?}");
    assert!(entries[1]["ended_at"].is_null(), "{entries:?}");
}

async fn step(app: &TestApp, admin: &str, command: &str) -> Vec<String> {
    let response = app
        .post(&format!("/api/command/{command}"), json!(null), Some(admin))
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    progress(app).await.0
}

#[sqlx::test]
async fn empty_blocks_are_skipped_in_one_step_and_restored(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let admin = app.create_admin().await;
    let (owner, club_id) = app.create_club_owner("Owner", "RSV").await;
    app.add_single_act(&owner, club_id, "Anna").await;
    let carla = app
        .add_starter(&owner, starter_body(club_id, "Carla", false, true))
        .await;
    let mut dora = starter_body(club_id, "Dora", false, true);
    dora["partner_id"] = json!(carla);
    app.add_starter(&owner, dora).await;
    replace_timeplan(
        &app,
        &admin,
        &[
            category_entry("EWU13", Some(START)),
            category_entry("EMU13", None),
            category_entry("EMU15", None),
            category_entry("PU13", None),
        ],
    )
    .await;

    let s = |states: [&str; 4]| states.map(String::from).to_vec();
    // Warm-up, the act, its end (which ends the block).
    step(&app, &admin, "timeplan_forward").await;
    step(&app, &admin, "timeplan_forward").await;
    let ended = step(&app, &admin, "timeplan_forward").await;
    assert_eq!(ended, s(["Ended", "Planned", "Planned", "Planned"]));
    // Both empty blocks are skipped; the pairs start with their warm-up.
    let skipped = step(&app, &admin, "timeplan_forward").await;
    assert_eq!(skipped, s(["Ended", "Ended", "Ended", "Started"]));
    assert_eq!(progress(&app).await.1, ["Ended"]);

    // One step back undoes the start and the skips together.
    let back = step(&app, &admin, "timeplan_backward").await;
    assert_eq!(back, ended);
    // The next one reopens the last block that really ran.
    let reopened = step(&app, &admin, "timeplan_backward").await;
    assert_eq!(reopened, s(["Started", "Planned", "Planned", "Planned"]));
    assert_eq!(progress(&app).await.1, ["Started"]);
}

#[sqlx::test]
async fn forward_with_only_empty_blocks_left_changes_nothing(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let admin = app.create_admin().await;
    replace_timeplan(
        &app,
        &admin,
        &[
            category_entry("EWU13", Some(START)),
            category_entry("EMU13", None),
        ],
    )
    .await;

    let states = step(&app, &admin, "timeplan_forward").await;

    assert_eq!(states, ["Planned", "Planned"]);
}

#[sqlx::test]
async fn shared_warmup_of_an_empty_category_moves_to_the_next(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let admin = app.create_admin().await;
    let (owner, club_id) = app.create_club_owner("Owner", "RSV").await;
    app.add_single_act(&owner, club_id, "Anna").await;
    // EWU13 shares the warm-up of the empty EMU13 before it.
    sqlx::query(
        "UPDATE categories SET einfahrzeit_seconds = CASE name WHEN 'EMU13' THEN 600 ELSE 0 END WHERE name IN ('EMU13', 'EWU13')",
    )
    .execute(&app.db)
    .await
    .unwrap();
    replace_timeplan(
        &app,
        &admin,
        &[
            category_entry("EMU13", Some(START)),
            category_entry("EWU13", None),
        ],
    )
    .await;

    let prediction = app.get("/api/query/predict_timeplan", None).await.body;
    let items = prediction["items"].as_array().unwrap();
    let empty = &items[0]["timeplan_entry"]["Category"];
    let shared = &items[1]["timeplan_entry"]["Category"];
    assert_eq!(empty["warmup_seconds"], 0);
    assert_eq!(items[0]["planned_duration"], 0);
    assert_eq!(shared["einfahrzeit_seconds"], 0);
    assert_eq!(shared["warmup_seconds"], 600);
    assert_eq!(items[1]["planned_start"], items[0]["planned_start"]);

    // The rider warms up first instead of starting right away.
    step(&app, &admin, "timeplan_forward").await;
    assert_eq!(progress(&app).await.1, Vec::<String>::new());
    let acts = &app.get("/api/query/predict_timeplan", None).await.body["items"][1]["timeplan_entry"]
        ["Category"]["acts"];
    assert_eq!(acts[0]["status"], "Planned");
}

#[sqlx::test]
async fn act_timer_starts_with_the_first_music_start(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let admin = app.create_admin().await;
    let (owner, club_id) = app.create_club_owner("Owner", "RSV").await;
    let act_id = app.add_single_act(&owner, club_id, "Anna").await;
    replace_timeplan(&app, &admin, &[category_entry("EWU13", Some(START))]).await;

    let music_started = async || {
        let response = app.get("/api/query/predict_timeplan", None).await;
        response.body["items"][0]["timeplan_entry"]["Category"]["acts"][0]["music_started_at"]
            .clone()
    };
    let report = async |cookie: &str| {
        app.post(
            "/api/command/set_act_music_started",
            json!({ "act_id": act_id }),
            Some(cookie),
        )
        .await
        .status
    };

    // During the warm-up, the act doesn't run yet.
    step(&app, &admin, "timeplan_forward").await;
    assert_eq!(report(&admin).await, StatusCode::OK);
    assert!(music_started().await.is_null());

    step(&app, &admin, "timeplan_forward").await;
    assert!(music_started().await.is_null());
    assert_eq!(report(&owner).await, StatusCode::FORBIDDEN);
    assert!(music_started().await.is_null());
    assert_eq!(report(&admin).await, StatusCode::OK);
    assert!(music_started().await.is_string());

    // Only the first start counts.
    sqlx::query("UPDATE acts SET music_started_at = '2026-04-19 09:15:00' WHERE id = ?")
        .bind(act_id)
        .execute(&app.db)
        .await
        .unwrap();
    assert_eq!(report(&admin).await, StatusCode::OK);
    let kept = music_started().await;
    assert!(
        kept.as_str().unwrap().contains("2026-04-19T09:15:00"),
        "{kept}"
    );

    // Undoing the act's start forgets it.
    step(&app, &admin, "timeplan_backward").await;
    assert!(music_started().await.is_null());
    step(&app, &admin, "timeplan_forward").await;
    assert!(music_started().await.is_null());
}
