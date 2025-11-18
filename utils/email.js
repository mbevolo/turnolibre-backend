const Brevo = require("@getbrevo/brevo");

const apiInstance = new Brevo.TransactionalEmailsApi();
apiInstance.setApiKey(
  Brevo.TransactionalEmailsApiApiKeys.apiKey,
  process.env.BREVO_API_KEY
);

async function sendMail({ to, subject, html }) {
  const email = {
    sender: {
      email: process.env.FROM_EMAIL,
      name: "TurnoLibre"
    },
    to: [{ email: to }],
    subject,
    htmlContent: html
  };

  try {
    const response = await apiInstance.sendTransacEmail(email);
    console.log("📨 Email enviado a Brevo:", response.messageId);
  } catch (err) {
    console.error("❌ Error enviando email Brevo:", err);
  }
}

module.exports = { sendMail };
