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

export const GOOGLE_GMAIL_SEND_SCOPE =
  "https://www.googleapis.com/auth/gmail.send";

function normalizeBase64Input(value) {
  return String(value || "")
    .trim()
    .replaceAll("-", "+")
    .replaceAll("_", "/");
}

function resolveGoogleTokenEncryptionKey() {
  const configured = String(config.auth.google.tokenEncryptionKey || "").trim();
  if (configured) {
    const normalized = normalizeBase64Input(configured);
    try {
      const decoded = Buffer.from(normalized, "base64");
      if (decoded.length >= 32) {
        return crypto.createHash("sha256").update(decoded).digest();
      }
    } catch {
      // Continue with raw string fallback.
    }
    return crypto.createHash("sha256").update(configured).digest();
  }
  return crypto.createHash("sha256").update(config.jwtSecret).digest();
}

function toBase64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function wrapBase64Lines(value, lineLength = 76) {
  if (!value) return "";
  const chunks = [];
  for (let index = 0; index < value.length; index += lineLength) {
    chunks.push(value.slice(index, index + lineLength));
  }
  return chunks.join("\r\n");
}

function normalizeScopeSet(scopeText) {
  return new Set(
    String(scopeText || "")
      .split(/\s+/)
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function hasGoogleMailSendScope(scopeText) {
  const scopes = normalizeScopeSet(scopeText);
  return scopes.has(GOOGLE_GMAIL_SEND_SCOPE);
}

export function encryptOpaqueSecret(secretValue) {
  const plaintext = String(secretValue || "").trim();
  if (!plaintext) {
    throw new Error("No se recibio un secreto para cifrar");
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    resolveGoogleTokenEncryptionKey(),
    iv,
  );
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `v1:${toBase64Url(iv)}:${toBase64Url(encrypted)}:${toBase64Url(authTag)}`;
}

export function decryptOpaqueSecret(encryptedPayload) {
  const payload = String(encryptedPayload || "").trim();
  const [version, ivPart, contentPart, tagPart] = payload.split(":");

  if (version !== "v1" || !ivPart || !contentPart || !tagPart) {
    throw new Error("Formato de secreto cifrado invalido");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    resolveGoogleTokenEncryptionKey(),
    Buffer.from(normalizeBase64Input(ivPart), "base64"),
  );
  decipher.setAuthTag(Buffer.from(normalizeBase64Input(tagPart), "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(normalizeBase64Input(contentPart), "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export async function exchangeGoogleRefreshToken(refreshToken) {
  const body = new URLSearchParams({
    client_id: config.auth.google.clientId,
    client_secret: config.auth.google.clientSecret,
    grant_type: "refresh_token",
    refresh_token: String(refreshToken || ""),
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const payload = await response
    .json()
    .catch(() => ({ error: "invalid_token_response" }));
  if (!response.ok || !payload?.access_token) {
    const error = new Error("No fue posible renovar el token de Google");
    error.code = String(payload?.error || "google_token_refresh_failed");
    error.detail = String(payload?.error_description || payload?.error || "");
    throw error;
  }

  return payload;
}

function normalizeEmailList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(", ");
}

function encodeMimeHeaderUtf8(value) {
  const text = String(value || "").replace(/[\r\n]+/g, " ").trim();
  if (!text) {
    return "";
  }

  if (/^[\x20-\x7E]+$/.test(text)) {
    return text;
  }

  const encoded = Buffer.from(text, "utf8").toString("base64");
  return `=?UTF-8?B?${encoded}?=`;
}

function buildRawMimeMessage({
  from,
  to,
  cc,
  subject,
  messageBody,
  attachments,
}) {
  const normalizedTo = normalizeEmailList(to);
  const normalizedCc = normalizeEmailList(cc);
  const normalizedSubject = String(subject || "").trim();
  const encodedSubject = encodeMimeHeaderUtf8(normalizedSubject);
  const normalizedBody = String(messageBody || "");

  if (!normalizedTo) {
    throw new Error("Debes incluir al menos un destinatario");
  }
  if (!normalizedSubject) {
    throw new Error("El asunto es obligatorio");
  }

  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;

  if (!hasAttachments) {
    const lines = [
      `From: ${from}`,
      `To: ${normalizedTo}`,
      ...(normalizedCc ? [`Cc: ${normalizedCc}`] : []),
      `Subject: ${encodedSubject}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      normalizedBody,
    ];
    return toBase64Url(lines.join("\r\n"));
  }

  const boundary = `np_${crypto.randomBytes(16).toString("hex")}`;
  const lines = [
    `From: ${from}`,
    `To: ${normalizedTo}`,
    ...(normalizedCc ? [`Cc: ${normalizedCc}`] : []),
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    normalizedBody,
  ];

  for (const attachment of attachments) {
    const contentBuffer = Buffer.isBuffer(attachment.content)
      ? attachment.content
      : Buffer.from(attachment.content || "");
    const mimeType = String(
      attachment.contentType || "application/octet-stream",
    ).trim();
    const filename = String(attachment.filename || "archivo.bin").trim();
    const contentBase64 = wrapBase64Lines(contentBuffer.toString("base64"));

    lines.push(`--${boundary}`);
    lines.push(
      `Content-Type: ${mimeType}; name="${filename.replaceAll('"', "")}"`,
    );
    lines.push("Content-Transfer-Encoding: base64");
    lines.push(
      `Content-Disposition: attachment; filename="${filename.replaceAll('"', "")}"`,
    );
    lines.push("");
    lines.push(contentBase64);
  }

  lines.push(`--${boundary}--`, "");
  return toBase64Url(lines.join("\r\n"));
}

export async function sendGoogleMailMessage({
  accessToken,
  from,
  to,
  cc,
  subject,
  messageBody,
  attachments = [],
}) {
  const raw = buildRawMimeMessage({
    from,
    to,
    cc,
    subject,
    messageBody,
    attachments,
  });
  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    },
  );

  const payload = await response
    .json()
    .catch(() => ({ error: { status: "google_send_invalid_response" } }));
  if (!response.ok) {
    const error = new Error("Google rechazo el envio del correo");
    error.code = String(
      payload?.error?.status || "google_send_failed",
    ).toLowerCase();
    error.detail = String(
      payload?.error?.message || payload?.error?.status || "",
    );
    throw error;
  }

  return payload;
}
