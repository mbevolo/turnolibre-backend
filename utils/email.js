require('dotenv').config();
const nodemailer = require('nodemailer');

// Crear el transporte con Gmail
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Verificar conexión al iniciar
transporter.verify((error, success) => {
  if (error) {
    console.warn('⚠️ Error verificando SMTP:', error.message);
  } else {
    console.log('📨 SMTP listo para enviar');
  }
});

// Función genérica para enviar correos
async function sendMail({ to, subject, text, html }) {
  const from = process.env.EMAIL_FROM || `"TurnoLibre" <${process.env.EMAIL_USER}>`;

  const mailOptions = {
    from,
    to,
    subject,
    html: html || (text ? `<pre>${text}</pre>` : ''),
    text: text || undefined
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`📧 Email enviado a ${to} (${info.messageId})`);
    return info;
  } catch (err) {
    console.error('❌ Error al enviar email:', err);
    throw err;
  }
}

module.exports = { sendMail };
