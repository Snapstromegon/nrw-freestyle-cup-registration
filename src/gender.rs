use serde::{Deserialize, Serialize};

/// A rider's gender. It decides whether a single counts as Einzel weiblich
/// or männlich. Stored as text in `starter.gender`.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, sqlx::Type, utoipa::ToSchema,
)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
pub enum Gender {
    Female,
    Male,
}

impl Gender {
    /// The gender a single implies: `single_female` or `single_male`.
    pub fn of_single(single_male: bool, single_female: bool) -> Option<Gender> {
        if single_female {
            Some(Gender::Female)
        } else if single_male {
            Some(Gender::Male)
        } else {
            None
        }
    }

    /// A German message if a single doesn't match the rider's gender.
    pub fn check_single(
        gender: Option<Gender>,
        single_male: bool,
        single_female: bool,
    ) -> Result<(), String> {
        match (gender, Gender::of_single(single_male, single_female)) {
            (Some(gender), Some(single)) if gender != single => Err(match gender {
                Gender::Female => "Eine Fahrerin startet in Einzel weiblich.".to_string(),
                Gender::Male => "Ein Fahrer startet in Einzel männlich.".to_string(),
            }),
            _ => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_must_match_gender() {
        assert!(Gender::check_single(Some(Gender::Female), false, true).is_ok());
        assert!(Gender::check_single(Some(Gender::Female), true, false).is_err());
        assert!(Gender::check_single(None, true, false).is_ok());
        assert!(Gender::check_single(Some(Gender::Male), false, false).is_ok());
    }
}
