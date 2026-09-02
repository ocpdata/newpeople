import { config } from "./config.js";

function hasValue(value) {
  return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
}

function isValidAbsoluteUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function envName() {
  return String(config.nodeEnv || "development").toLowerCase();
}

export function validateConfig() {
  const mode = envName();
  const errors = [];
  const warnings = [];

  if (!hasValue(config.db.host)) {
    errors.push("DB_HOST no esta configurado");
  }
  if (!hasValue(config.db.user)) {
    errors.push("DB_USER no esta configurado");
  }
  if (!hasValue(config.db.database)) {
    errors.push("DB_NAME no esta configurado");
  }

  if (!isValidAbsoluteUrl(config.app.inviteSetupUrl)) {
    errors.push("APP_INVITE_SETUP_URL debe ser una URL absoluta (http/https)");
  }

  if (hasValue(config.app.baseUrl) && !isValidAbsoluteUrl(config.app.baseUrl)) {
    errors.push("APP_BASE_URL debe ser una URL absoluta (http/https)");
  }

  if (hasValue(config.mail.host)) {
    if (!hasValue(config.mail.user)) {
      errors.push("SMTP_USER es obligatorio cuando SMTP_HOST esta configurado");
    }
    if (!hasValue(config.mail.pass)) {
      errors.push("SMTP_PASS es obligatorio cuando SMTP_HOST esta configurado");
    }
    if (!hasValue(config.mail.from)) {
      errors.push("SMTP_FROM es obligatorio cuando SMTP_HOST esta configurado");
    }
  } else {
    warnings.push(
      "SMTP_HOST no esta configurado; algunas notificaciones por correo no se enviaran",
    );
  }

  if (config.documents.storage.provider === "s3_compatible") {
    if (!hasValue(config.documents.storage.s3Bucket)) {
      errors.push(
        "DOCUMENT_STORAGE_S3_BUCKET es obligatorio con DOCUMENT_STORAGE_PROVIDER=s3_compatible",
      );
    }
    if (!hasValue(config.documents.storage.s3Region)) {
      errors.push(
        "DOCUMENT_STORAGE_S3_REGION es obligatorio con DOCUMENT_STORAGE_PROVIDER=s3_compatible",
      );
    }
    if (!hasValue(config.documents.storage.s3AccessKeyId)) {
      errors.push(
        "DOCUMENT_STORAGE_S3_ACCESS_KEY_ID es obligatorio con DOCUMENT_STORAGE_PROVIDER=s3_compatible",
      );
    }
    if (!hasValue(config.documents.storage.s3SecretAccessKey)) {
      errors.push(
        "DOCUMENT_STORAGE_S3_SECRET_ACCESS_KEY es obligatorio con DOCUMENT_STORAGE_PROVIDER=s3_compatible",
      );
    }
  }

  if (config.auth.google.enabled) {
    if (!hasValue(config.auth.google.clientId)) {
      errors.push(
        "GOOGLE_CLIENT_ID es obligatorio cuando AUTH_GOOGLE_ENABLED=true",
      );
    }
    if (!hasValue(config.auth.google.clientSecret)) {
      errors.push(
        "GOOGLE_CLIENT_SECRET es obligatorio cuando AUTH_GOOGLE_ENABLED=true",
      );
    }
    if (!isValidAbsoluteUrl(config.auth.google.redirectUri)) {
      errors.push(
        "GOOGLE_REDIRECT_URI debe ser URL absoluta cuando AUTH_GOOGLE_ENABLED=true",
      );
    }
    if (!isValidAbsoluteUrl(config.auth.google.mailRedirectUri)) {
      errors.push(
        "GOOGLE_MAIL_REDIRECT_URI debe ser URL absoluta cuando AUTH_GOOGLE_ENABLED=true",
      );
    }
  }

  if (mode === "production") {
    if (config.jwtSecret === "change-this-secret") {
      errors.push(
        "JWT_SECRET no puede usar el valor por defecto en produccion",
      );
    }
    if (!hasValue(config.db.password)) {
      errors.push("DB_PASSWORD es obligatorio en produccion");
    }
    if (hasValue(config.securityTests.githubRateLimit.token)) {
      if (!hasValue(config.securityTests.githubRateLimit.callbackUrl)) {
        errors.push(
          "GH_RATE_LIMIT_CALLBACK_URL es obligatorio cuando se configura GH_RATE_LIMIT_TOKEN",
        );
      }
      if (!hasValue(config.securityTests.githubRateLimit.callbackSecret)) {
        errors.push(
          "SECURITY_TEST_CALLBACK_SECRET es obligatorio cuando se configura GH_RATE_LIMIT_TOKEN",
        );
      }
    }
  } else if (config.jwtSecret === "change-this-secret") {
    warnings.push(
      "JWT_SECRET usa valor por defecto; cambia este valor antes de subir a nube",
    );
  }

  if (warnings.length > 0) {
    for (const warning of warnings) {
      console.warn(`[config warning] ${warning}`);
    }
  }

  if (errors.length > 0) {
    const message = errors.map((error) => `- ${error}`).join("\n");
    throw new Error(`Configuracion invalida:\n${message}`);
  }
}
