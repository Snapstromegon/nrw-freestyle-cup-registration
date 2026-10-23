//! Integration tests for roles: the migration from the admin flag, what
//! `whoami` reports and how a missing permission is rejected.

mod common;

use axum::http::StatusCode;
use common::{TestApp, email_for};
use serde_json::{Value, json};
use sqlx::SqlitePool;
use uuid::Uuid;

/// The migration that replaced `users.is_admin` with roles.
const ROLES_MIGRATION: i64 = 20261023190000;

fn strings(value: &Value) -> Vec<&str> {
    let mut strings: Vec<_> = value
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    strings.sort_unstable();
    strings
}

#[sqlx::test(migrations = false)]
async fn admins_from_before_roles_become_admins(db: SqlitePool) {
    let migrator = sqlx::migrate!();
    migrator.run_to(ROLES_MIGRATION - 1, &db).await.unwrap();
    let admin = Uuid::now_v7();
    let user = Uuid::now_v7();
    for (id, name, is_admin) in [(admin, "Admin", true), (user, "Alex", false)] {
        sqlx::query(
            "INSERT INTO users (id, email, email_verified, name, password, is_admin) VALUES (?, ?, true, ?, 'x', ?)",
        )
        .bind(id)
        .bind(email_for(name))
        .bind(name)
        .bind(is_admin)
        .execute(&db)
        .await
        .unwrap();
    }
    migrator.run(&db).await.unwrap();
    let app = TestApp::new(db).await;

    let admin = app.get("/api/query/whoami", Some(&app.cookie_for(admin))).await;
    assert_eq!(admin.status, StatusCode::OK, "{:?}", admin.body);
    assert_eq!(strings(&admin.body["roles"]), ["admin"]);

    let user = app.get("/api/query/whoami", Some(&app.cookie_for(user))).await;
    assert_eq!(strings(&user.body["roles"]), Vec::<&str>::new());
}

#[sqlx::test]
async fn whoami_lists_roles_and_their_permissions(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let id = app
        .create_user_with_roles("Kim", &["treasurer", "music_check"])
        .await;

    let response = app.get("/api/query/whoami", Some(&app.cookie_for(id))).await;

    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);
    assert_eq!(
        strings(&response.body["roles"]),
        ["music_check", "treasurer"]
    );
    assert_eq!(
        strings(&response.body["permissions"]),
        [
            "check_songs",
            "manage_payments",
            "view_amounts_due",
            "view_club_balances"
        ]
    );
    assert_eq!(response.body["is_admin"], false);
}

#[sqlx::test]
async fn admins_hold_every_permission(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let admin = app.create_admin().await;
    let kim = app.create_user_with_roles("Kim", &["jury_lead"]).await;

    let response = app.get("/api/query/whoami", Some(&admin)).await;
    let jury_lead = app.get("/api/query/whoami", Some(&app.cookie_for(kim))).await;

    assert_eq!(response.body["is_admin"], true);
    let permissions = strings(&response.body["permissions"]);
    assert!(permissions.contains(&"manage_users"), "{permissions:?}");
    for permission in strings(&jury_lead.body["permissions"]) {
        assert!(permissions.contains(&permission), "{permission}");
    }
}

#[sqlx::test]
async fn a_missing_permission_is_forbidden_a_missing_login_unauthorized(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let treasurer = app.create_user_with_roles("Kim", &["treasurer"]).await;

    let forbidden = app
        .get("/api/query/list_users", Some(&app.cookie_for(treasurer)))
        .await;
    assert_eq!(forbidden.status, StatusCode::FORBIDDEN);

    let anonymous = app.get("/api/query/list_users", None).await;
    assert_eq!(anonymous.status, StatusCode::UNAUTHORIZED);

    let admin = app.create_admin().await;
    let allowed = app.get("/api/query/list_users", Some(&admin)).await;
    assert_eq!(allowed.status, StatusCode::OK);
}

#[sqlx::test]
async fn making_a_user_admin_keeps_their_other_roles(db: SqlitePool) {
    let app = TestApp::new(db).await;
    let kim = app.create_user_with_roles("Kim", &["treasurer"]).await;

    let response = app
        .post(
            "/api/command/set_user_admin",
            json!({ "user_id": kim, "is_admin": true }),
            Some(&app.create_admin().await),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK, "{:?}", response.body);

    let whoami = app.get("/api/query/whoami", Some(&app.cookie_for(kim))).await;
    assert_eq!(strings(&whoami.body["roles"]), ["admin", "treasurer"]);
}
