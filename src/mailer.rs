use lettre::{
    AsyncSmtpTransport, AsyncTransport, Tokio1Executor, message::header::ContentType,
    transport::smtp::authentication::Credentials,
};

pub struct Mailer {
    transport: AsyncSmtpTransport<Tokio1Executor>,
    from_address: String,
}

impl Mailer {
    pub fn new(server: &str, username: &str, password: &str, from_address: &str) -> Self {
        let creds = Credentials::new(username.to_owned(), password.to_owned());
        let transport = lettre::AsyncSmtpTransport::<Tokio1Executor>::relay(server)
            .unwrap()
            .credentials(creds)
            .build();
        Self {
            transport,
            from_address: from_address.to_owned(),
        }
    }

    pub async fn send_text(
        &self,
        to: &str,
        subject: &str,
        body: &str,
    ) -> Result<(), lettre::transport::smtp::Error> {
        let email = lettre::Message::builder()
            .from(self.from_address.parse().unwrap())
            .to(to.parse().unwrap())
            .subject(subject)
            .header(ContentType::TEXT_PLAIN)
            .body(body.to_string())
            .unwrap();

        self.transport.send(email).await?;
        Ok(())
    }
}
