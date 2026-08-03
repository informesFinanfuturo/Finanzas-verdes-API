const nodemailer = require('nodemailer');

// ✅ transporte SMTP
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ✅ correo de bienvenida (SIN contraseña explícita)
async function sendWelcomeEmail({ to, nombreUsuario }) {
  await transporter.sendMail({
    from: `"Finanzas Verdes" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
    to,
    subject: 'Tu cuenta ha sido creada',
    html: `
      <div style="font-family: Arial, sans-serif; line-height:1.5;">
        <h2>Bienvenido a Finanzas Verdes</h2>

        <p>Hola <strong>${nombreUsuario}</strong>, tu cuenta ha sido creada correctamente.</p>

        <p><strong>Usuario:</strong> ${to}</p>

        <p>
          Tu contraseña inicial corresponde a tu número de documento.
        </p>

        <p>
          Por seguridad, te recomendamos cambiar la contraseña después de iniciar sesión.
        </p>

        <p>
          Si no reconoces este registro, puedes ignorar este mensaje.
        </p>
      </div>
    `,
  });
}

module.exports = {
  sendWelcomeEmail,
};