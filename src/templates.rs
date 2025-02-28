use askama::Template;

#[derive(Template)]
#[template(path = "emails/verify-mail.j2")]
pub struct VerifyMail<'a> {
    pub name: &'a str,
    pub verify_link: &'a str,
}

#[derive(Template)]
#[template(path = "emails/password-reset-mail.j2")]
pub struct PasswordResetMail<'a> {
    pub name: &'a str,
    pub reset_link: &'a str,
}
