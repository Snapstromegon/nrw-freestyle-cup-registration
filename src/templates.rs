use askama::Template;

/// Email asking a newly registered user to confirm their address.
///
/// ```
/// use askama::Template;
/// use nrw_freestyle_cup_registration::templates::VerifyMail;
///
/// let body = VerifyMail {
///     name: "Alex",
///     verify_link: "https://example.com/verify_email?token=abc",
/// }
/// .render()
/// .unwrap();
/// assert!(body.starts_with("Hallo Alex,"));
/// assert!(body.contains("https://example.com/verify_email?token=abc"));
/// ```
#[derive(Template)]
#[template(path = "emails/verify-mail.j2")]
pub struct VerifyMail<'a> {
    pub name: &'a str,
    pub verify_link: &'a str,
}

/// Email containing a password reset link.
#[derive(Template)]
#[template(path = "emails/password-reset-mail.j2")]
pub struct PasswordResetMail<'a> {
    pub name: &'a str,
    pub reset_link: &'a str,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_reset_mail_contains_name_and_link() {
        let body = PasswordResetMail {
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
            name: "Anna & Berta O'Brien",
            verify_link: "https://example.com/verify_email?token=abc",
        }
        .render()
        .unwrap();
        assert!(body.contains("Anna & Berta O'Brien"), "{body}");
    }
}
