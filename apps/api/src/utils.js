import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import crypto from "node:crypto";
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

export function hashOpaqueToken(token) {
  return crypto
    .createHash("sha256")
    .update(String(token || ""))
    .digest("hex");
}

export function createOpaqueToken() {
  const token = crypto.randomBytes(32).toString("hex");
  return { token, tokenHash: hashOpaqueToken(token) };
}

export function buildInviteSetupUrl(token) {
  try {
    const url = new URL(config.app.inviteSetupUrl);
    if (token) {
      url.searchParams.set("token", token);
    }
    return url.toString();
  } catch {
    const separator = config.app.inviteSetupUrl.includes("?") ? "&" : "?";
    return token
      ? `${config.app.inviteSetupUrl}${separator}token=${encodeURIComponent(token)}`
      : config.app.inviteSetupUrl;
  }
}

function hasMailConfig() {
  return Boolean(config.mail.host && config.mail.user && config.mail.pass);
}

function formatInviteExpiration(expiresAt) {
  if (!expiresAt) return null;

  const parsedDate =
    expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(parsedDate.getTime())) return null;

  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(parsedDate);
}

function resolveInvitationCopy(purpose) {
  return purpose === "reset"
    ? {
        subject: "Restablece tu acceso en NewPeople CRM",
        intro: "Recibimos una solicitud para restablecer tu acceso.",
        cta: "Para continuar, entra al siguiente enlace y define tu nueva contrasena:",
      }
    : {
        subject: "Activa tu acceso en NewPeople CRM",
        intro: "Tu usuario fue creado correctamente.",
        cta: "Para continuar, ingresa al siguiente enlace y crea tu contrasena:",
      };
}

function resolveMailFailureReason(error) {
  if (!error) {
    return { reason: "mail_unknown_error", detail: "Error SMTP desconocido" };
  }

  if (error.code === "EAUTH" || Number(error.responseCode) === 535) {
    return {
      reason: "smtp_auth_failed",
      detail: "SMTP rechazo las credenciales configuradas",
    };
  }

  if (error.code === "ESOCKET" || error.code === "ECONNECTION") {
    return {
      reason: "smtp_connection_failed",
      detail: "No fue posible conectar con el servidor SMTP",
    };
  }

  if (error.code === "ETIMEDOUT") {
    return {
      reason: "smtp_timeout",
      detail: "La conexion SMTP expiro antes de completar el envio",
    };
  }

  return {
    reason: "smtp_send_failed",
    detail: String(error?.message || error),
  };
}

function buildCommercialMailHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\n", "<br />");
}

export async function sendCommercialActionEmail({
  to,
  cc = [],
  replyTo = "",
  subject,
  messageBody,
  attachmentsNote = "",
  attachments = [],
  metadataLines = [],
}) {
  if (!hasMailConfig()) {
    return {
      sent: false,
      reason: "smtp_not_configured",
      detail: "Falta configurar SMTP_HOST, SMTP_USER o SMTP_PASS",
    };
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

  const lines = [String(messageBody || "").trim()];
  if (attachmentsNote) {
    lines.push("", `Documentos referenciados: ${attachmentsNote}`);
  }
  if (metadataLines.length) {
    lines.push("", ...metadataLines.filter(Boolean));
  }

  const text = lines.join("\n");
  const html = buildCommercialMailHtml(text);

  try {
    await transporter.sendMail({
      from: config.mail.from,
      to,
      cc: cc.length ? cc : undefined,
      replyTo: replyTo || undefined,
      subject: String(subject || "").trim(),
      text,
      html: `<p>${html}</p>`,
      attachments:
        Array.isArray(attachments) && attachments.length
          ? attachments
          : undefined,
    });

    return { sent: true };
  } catch (error) {
    const failure = resolveMailFailureReason(error);
    return {
      sent: false,
      reason: failure.reason,
      detail: failure.detail,
    };
  }
}

export async function sendUserInvitationEmail({
  to,
  fullName,
  inviteUrl,
  purpose = "invite",
  expiresAt = null,
}) {
  const safeName = fullName || "Usuario";
  const emailCopy = resolveInvitationCopy(purpose);
  const formattedExpiration = formatInviteExpiration(expiresAt);

  if (!hasMailConfig()) {
    console.warn(
      `[mail] SMTP no configurado. Invitacion pendiente para ${to}. URL: ${inviteUrl}`,
    );
    return {
      sent: false,
      reason: "smtp_not_configured",
      detail: "Falta configurar SMTP_HOST, SMTP_USER o SMTP_PASS",
    };
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

  const subject = emailCopy.subject;
  const text = [
    `Hola ${safeName},`,
    "",
    emailCopy.intro,
    emailCopy.cta,
    inviteUrl,
    ...(formattedExpiration
      ? ["", `Este enlace vence el ${formattedExpiration}.`]
      : []),
    "",
    "Si no esperabas este correo, puedes ignorarlo.",
  ].join("\n");

  const html = `
    <p>Hola ${safeName},</p>
    <p>${emailCopy.intro}</p>
    <p>${emailCopy.cta}</p>
    <p><a href="${inviteUrl}">${inviteUrl}</a></p>
    ${formattedExpiration ? `<p><strong>Vigencia:</strong> este enlace vence el ${formattedExpiration}.</p>` : ""}
    <p>Si no esperabas este correo, puedes ignorarlo.</p>
  `;

  try {
    await transporter.sendMail({
      from: config.mail.from,
      to,
      subject,
      text,
      html,
    });

    return { sent: true };
  } catch (error) {
    const failure = resolveMailFailureReason(error);
    console.error(
      `[mail] No fue posible enviar invitacion a ${to}: ${failure.reason} - ${failure.detail}`,
    );
    return {
      sent: false,
      reason: failure.reason,
      detail: failure.detail,
    };
  }
}
