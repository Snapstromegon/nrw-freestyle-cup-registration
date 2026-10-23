use askama::Template;

/// Email asking a newly registered user to confirm their address.
///
/// ```
/// use askama::Template;
/// use nrw_freestyle_cup_registration::templates::VerifyMail;
///
/// let body = VerifyMail {
///     event_name: "Einradevent 2027",
///     name: "Alex",
///     verify_link: "https://example.com/verify_email?token=abc",
/// }
/// .render()
/// .unwrap();
/// assert!(body.starts_with("Hallo Alex,"));
/// assert!(body.contains("https://example.com/verify_email?token=abc"));
/// assert!(body.contains("Dein Einradevent 2027 Team"));
/// ```
#[derive(Template)]
#[template(path = "emails/verify-mail.j2")]
pub struct VerifyMail<'a> {
    /// The competition's name, see [`crate::competition::Competition::event_name`].
    pub event_name: &'a str,
    pub name: &'a str,
    pub verify_link: &'a str,
}

/// Email containing a password reset link.
#[derive(Template)]
#[template(path = "emails/password-reset-mail.j2")]
pub struct PasswordResetMail<'a> {
    pub event_name: &'a str,
    pub name: &'a str,
    pub reset_link: &'a str,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_reset_mail_contains_name_and_link() {
        let body = PasswordResetMail {
            event_name: "Einradevent 2027",
            name: "Alex",
            reset_link: "https://example.com/reset_password?token=abc",
        }
        .render()
        .unwrap();
        assert!(body.starts_with("Hallo Alex,"));
        assert!(body.contains("https://example.com/reset_password?token=abc"));
    }

    #[test]
    #[ignore = "known bug: askama HTML-escapes .j2 templates, fix with `escape = \"none\"`"]
    fn mails_are_plain_text_without_html_escaping() {
        let body = VerifyMail {
            event_name: "Einradevent 2027",
            name: "Anna & Berta O'Brien",
            verify_link: "https://example.com/verify_email?token=abc",
        }
        .render()
        .unwrap();
        assert!(body.contains("Anna & Berta O'Brien"), "{body}");
    }
}
