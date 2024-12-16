use askama::Template;

#[derive(Template)]
#[template(path = "emails/verify-mail.j2")]
pub struct VerifyMail<'a> {
  pub name: &'a str,
  pub verify_link: &'a str,
}
