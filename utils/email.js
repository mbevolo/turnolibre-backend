// utils/email.js
require('dotenv').config();
const nodemailer = require('nodemailer');

const {
  SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, EMAIL_FROM
} = process.env;

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    console.warn('[email] SMTP no configurado; se simula envío.');
    return null;
  }
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: String(SMTP_SECURE).toLowerCase() === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

async function sendMail({ to, subject, text, html }) {
  const tx = getTransporter();
  if (!tx) {
    console.log('[email] Simulado:', { to, subject });
    return { simulated: true };
  }
  const from = EMAIL_FROM || SMTP_USER;
  return await tx.sendMail({ from, to, subject, text, html });
}

module.exports = { sendMail };
