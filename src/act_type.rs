use serde::{Deserialize, Serialize};

/// Groups need at least this many regular riders (replacements don't count).
/// Smaller groups stay registered, but get no category.
pub const MIN_GROUP_SIZE: i64 = 3;

/// Groups with up to this many regular riders are small groups (Kleingruppe),
/// larger ones are large groups (Großgruppe).
pub const MAX_SMALL_GROUP_SIZE: i64 = 8;

/// The kind of an act. Stored as text in `acts.act_type` and `categories.act_type`.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, sqlx::Type, utoipa::ToSchema,
)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
pub enum ActType {
    Single,
    Pair,
    GroupSmall,
    GroupLarge,
}

impl ActType {
    pub fn as_str(self) -> &'static str {
        match self {
            ActType::Single => "single",
            ActType::Pair => "pair",
            ActType::GroupSmall => "group_small",
            ActType::GroupLarge => "group_large",
        }
    }

    /// The German name shown to users.
    pub fn german_name(self) -> &'static str {
        match self {
            ActType::Single => "Einzelkür",
            ActType::Pair => "Paarkür",
            ActType::GroupSmall => "Kleingruppe",
            ActType::GroupLarge => "Großgruppe",
        }
    }

    pub fn is_group(self) -> bool {
        matches!(self, ActType::GroupSmall | ActType::GroupLarge)
    }

    /// The group type for a group with `regular_count` regular riders.
    ///
    /// ```
    /// use nrw_freestyle_cup_registration::act_type::ActType;
    ///
    /// assert_eq!(ActType::for_group_size(3), ActType::GroupSmall);
    /// assert_eq!(ActType::for_group_size(8), ActType::GroupSmall);
    /// assert_eq!(ActType::for_group_size(9), ActType::GroupLarge);
    /// ```
    pub fn for_group_size(regular_count: i64) -> ActType {
        if regular_count <= MAX_SMALL_GROUP_SIZE {
            ActType::GroupSmall
        } else {
            ActType::GroupLarge
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: [ActType; 4] = [
        ActType::Single,
        ActType::Pair,
        ActType::GroupSmall,
        ActType::GroupLarge,
    ];

    #[test]
    fn serializes_like_the_database_value() {
        for act_type in ALL {
            assert_eq!(
                serde_json::to_string(&act_type).unwrap(),
                format!("\"{}\"", act_type.as_str())
            );
        }
    }

    #[test]
    fn only_group_types_are_groups() {
        let groups: Vec<_> = ALL.into_iter().filter(|t| t.is_group()).collect();
        assert_eq!(groups, [ActType::GroupSmall, ActType::GroupLarge]);
    }

    #[test]
    fn group_size_decides_between_small_and_large() {
        // Incomplete groups (fewer than MIN_GROUP_SIZE riders) are small groups
        // without a category.
        for size in 0..=MAX_SMALL_GROUP_SIZE {
            assert_eq!(ActType::for_group_size(size), ActType::GroupSmall, "{size}");
        }
        for size in [MAX_SMALL_GROUP_SIZE + 1, 20] {
            assert_eq!(ActType::for_group_size(size), ActType::GroupLarge, "{size}");
        }
    }
}
