import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import { config } from "./config.js";

export function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.full_name,
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  );
}

export function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function hasMailConfig() {
  return Boolean(config.mail.host && config.mail.user && config.mail.pass);
}

export async function sendUserInvitationEmail({ to, fullName, inviteUrl }) {
  const safeName = fullName || "Usuario";

  if (!hasMailConfig()) {
    console.warn(
      `[mail] SMTP no configurado. Invitacion pendiente para ${to}. URL: ${inviteUrl}`,
    );
    return { sent: false, reason: "smtp_not_configured" };
  }

  const transporter = nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.secure,
    auth: {
      user: config.mail.user,
      pass: config.mail.pass,
    },
  });

  const subject = "Activa tu acceso en NewPeople CRM";
  const text = [
    `Hola ${safeName},`,
    "",
    "Tu usuario fue creado correctamente.",
    "Para continuar, ingresa al siguiente enlace y crea tu contrasena:",
    inviteUrl,
    "",
    "Si no esperabas este correo, puedes ignorarlo.",
  ].join("\n");

  const html = `
    <p>Hola ${safeName},</p>
    <p>Tu usuario fue creado correctamente.</p>
    <p>Para continuar, ingresa al siguiente enlace y crea tu contrasena:</p>
    <p><a href="${inviteUrl}">${inviteUrl}</a></p>
    <p>Si no esperabas este correo, puedes ignorarlo.</p>
  `;

  await transporter.sendMail({
    from: config.mail.from,
    to,
    subject,
    text,
    html,
  });

  return { sent: true };
}
