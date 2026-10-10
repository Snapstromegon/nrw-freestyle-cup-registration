use serde::{Deserialize, Serialize};

/// The kind of an act. Stored as text in `acts.act_type` and `categories.act_type`.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, sqlx::Type, utoipa::ToSchema,
)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
pub enum ActType {
    Single,
    Pair,
}

impl ActType {
    pub fn as_str(self) -> &'static str {
        match self {
            ActType::Single => "single",
            ActType::Pair => "pair",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_like_the_database_value() {
        for act_type in [ActType::Single, ActType::Pair] {
            assert_eq!(
                serde_json::to_string(&act_type).unwrap(),
                format!("\"{}\"", act_type.as_str())
            );
        }
    }
}
