//! Roles of the organizer team and the permissions they grant (ADR 0003).
//!
//! Roles are fixed in code and granted to users, several per user. Handlers
//! never ask for a role: they require a permission through
//! [`Granted`](crate::http_server::extractor::auth::Granted), e.g.
//! `Granted<permit::ManagePayments>`. Club-side access doesn't go through
//! roles; it follows the user's club and a group's owner club.

use std::collections::HashMap;

use sqlx::SqlitePool;
use uuid::Uuid;

/// What a user may do on the organizer side.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    serde::Serialize,
    serde::Deserialize,
    sqlx::Type,
    utoipa::ToSchema,
)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
pub enum Role {
    /// Everything, including granting roles.
    Admin,
    /// Juryleitung: the jury and the results.
    JuryLead,
    /// Kasse: payments and fee waivers.
    Treasurer,
    /// The check-in desk.
    CheckIn,
    /// Musiksteuerung: playback and the live timeplan.
    MusicControl,
    /// The announcer's screen.
    Moderation,
    /// Musikprüfung: marks songs as checked.
    MusicCheck,
}

pub trait Permit {
    const PERMISSION: Permission;
}

macro_rules! permissions {
    ($($(#[doc = $doc:literal])* $name:ident,)*) => {
        /// Something a handler requires; see [`Role::permissions`].
        #[derive(
            Debug,
            Clone,
            Copy,
            PartialEq,
            Eq,
            PartialOrd,
            Ord,
            Hash,
            serde::Serialize,
            utoipa::ToSchema,
        )]
        #[serde(rename_all = "snake_case")]
        pub enum Permission {
            $($(#[doc = $doc])* $name,)*
        }

        impl Permission {
            pub const ALL: &[Permission] = &[$(Permission::$name,)*];
        }

        /// A type per [`Permission`], for
        /// [`Granted`](crate::http_server::extractor::auth::Granted).
        pub mod permit {
            $(
                $(#[doc = $doc])*
                #[derive(Debug)]
                pub struct $name;

                impl super::Permit for $name {
                    const PERMISSION: super::Permission = super::Permission::$name;
                }
            )*
        }
    };
}

permissions! {
    /// See users and grant roles; reload the database.
    ManageUsers,
    /// Categories, the timeplan, finals and the order of acts.
    PlanCompetition,
    /// Every club's registration, also after the Meldeschluss: riders with
    /// their birthdates, acts, withdrawals, pairs across clubs.
    ManageRegistrations,
    /// Record payments and waive fees.
    ManagePayments,
    /// Every club's amount due with the starts and acts behind it.
    ViewAmountsDue,
    /// Every club's balance: amount due, paid, open or overpaid.
    ViewClubBalances,
    /// Jury categories, judges, the Juryplan and credited deployments.
    ManageJury,
    /// Finals placements and publishing them.
    ManageResults,
    /// Check riders in.
    CheckIn,
    /// The medals and trophies to prepare.
    ViewMedals,
    /// Playback, the live timeplan and award ceremonies.
    ControlMusic,
    /// The moderation screen.
    ViewModeration,
    /// Mark songs as checked.
    CheckSongs,
}

impl Role {
    /// Every role, e.g. to offer them for granting.
    pub const ALL: &[Role] = &[
        Role::Admin,
        Role::JuryLead,
        Role::Treasurer,
        Role::CheckIn,
        Role::MusicControl,
        Role::Moderation,
        Role::MusicCheck,
    ];

    #[must_use]
    pub fn permissions(self) -> &'static [Permission] {
        use Permission as P;
        match self {
            Role::Admin => Permission::ALL,
            Role::JuryLead => &[P::ManageJury, P::ManageResults],
            Role::Treasurer => &[P::ManagePayments, P::ViewAmountsDue, P::ViewClubBalances],
            Role::CheckIn => &[P::CheckIn, P::ViewClubBalances, P::ViewMedals],
            Role::MusicControl => &[P::ControlMusic, P::ViewModeration],
            Role::Moderation => &[P::ViewModeration],
            Role::MusicCheck => &[P::CheckSongs],
        }
    }
}

/// The permissions `roles` grant together, sorted.
#[must_use]
pub fn permissions_of(roles: &[Role]) -> Vec<Permission> {
    let mut permissions: Vec<_> = roles.iter().flat_map(|r| r.permissions()).copied().collect();
    permissions.sort_unstable();
    permissions.dedup();
    permissions
}

/// A user's roles, sorted.
pub async fn roles_of(db: &SqlitePool, user_id: Uuid) -> sqlx::Result<Vec<Role>> {
    let mut roles = sqlx::query_scalar!(
        r#"SELECT role as "role: Role" FROM user_roles WHERE user_id = ?"#,
        user_id
    )
    .fetch_all(db)
    .await?;
    roles.sort_unstable();
    Ok(roles)
}

/// Every user's roles, sorted; users without roles are missing.
pub async fn all_roles(db: &SqlitePool) -> sqlx::Result<HashMap<Uuid, Vec<Role>>> {
    let rows = sqlx::query!(
        r#"SELECT user_id as "user_id: Uuid", role as "role: Role" FROM user_roles"#
    )
    .fetch_all(db)
    .await?;
    let mut roles: HashMap<Uuid, Vec<Role>> = HashMap::new();
    for row in rows {
        roles.entry(row.user_id).or_default().push(row.role);
    }
    for user_roles in roles.values_mut() {
        user_roles.sort_unstable();
    }
    Ok(roles)
}

#[cfg(test)]
mod tests {
    use super::*;
    use Permission as P;

    #[test]
    fn each_role_grants_what_the_role_table_says() {
        let table = [
            (Role::JuryLead, vec![P::ManageJury, P::ManageResults]),
            (
                Role::Treasurer,
                vec![P::ManagePayments, P::ViewAmountsDue, P::ViewClubBalances],
            ),
            (Role::CheckIn, vec![P::ViewClubBalances, P::CheckIn, P::ViewMedals]),
            (Role::MusicControl, vec![P::ControlMusic, P::ViewModeration]),
            (Role::Moderation, vec![P::ViewModeration]),
            (Role::MusicCheck, vec![P::CheckSongs]),
        ];
        for (role, expected) in table {
            assert_eq!(permissions_of(&[role]), expected, "{role:?}");
        }
    }

    #[test]
    fn only_admins_manage_users_plan_and_registrations() {
        for role in Role::ALL {
            let admin_only = [P::ManageUsers, P::PlanCompetition, P::ManageRegistrations];
            for permission in admin_only {
                assert_eq!(
                    role.permissions().contains(&permission),
                    *role == Role::Admin,
                    "{role:?} {permission:?}"
                );
            }
        }
    }

    #[test]
    fn several_roles_grant_each_permission_once() {
        assert_eq!(
            permissions_of(&[Role::Moderation, Role::MusicControl]),
            [P::ControlMusic, P::ViewModeration]
        );
    }
}
