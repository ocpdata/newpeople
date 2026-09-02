import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envFileName =
  process.env.API_ENV === "test" ||
  process.env.NODE_ENV === "test" ||
  process.env.VITEST
    ? "../.env.test"
    : "../.env";

dotenv.config({ path: resolve(__dirname, envFileName) });

function resolveGoogleMailRedirectUri() {
  const explicit = String(process.env.GOOGLE_MAIL_REDIRECT_URI || "").trim();
  if (explicit) {
    return explicit;
  }

  return String(process.env.GOOGLE_REDIRECT_URI || "").trim();
}

export const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 4000),
  requestBodyLimit: process.env.REQUEST_BODY_LIMIT || "12mb",
  jwtSecret: process.env.JWT_SECRET || "change-this-secret",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "8h",
  auth: {
    google: {
      enabled: String(process.env.AUTH_GOOGLE_ENABLED || "false") === "true",
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      redirectUri: process.env.GOOGLE_REDIRECT_URI || "",
      mailRedirectUri: resolveGoogleMailRedirectUri(),
      tokenEncryptionKey: process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || "",
    },
  },
  features: {
    opportunityStageAnswerSuggestionsEnabled:
      String(
        process.env.OPPORTUNITY_STAGE_ANSWER_SUGGESTIONS_ENABLED || "true",
      ) === "true",
  },
  app: {
    baseUrl: process.env.APP_BASE_URL || "",
    inviteSetupUrl:
      process.env.APP_INVITE_SETUP_URL || "http://localhost:5173/set-password",
    passwordSetupTokenMinutes: Number(
      process.env.APP_PASSWORD_SETUP_TOKEN_MINUTES || 1440,
    ),
    businessTimezone:
      process.env.APP_BUSINESS_TIMEZONE || "America/Mexico_City",
    calendarSlaDays: Number(process.env.APP_CALENDAR_SLA_DAYS || 5),
    calendarReminderLeadMinutes: Number(
      process.env.APP_CALENDAR_REMINDER_LEAD_MINUTES || 60,
    ),
  },
  securityTests: {
    githubRateLimit: {
      token: process.env.GH_RATE_LIMIT_TOKEN || "",
      repository:
        process.env.GITHUB_RATE_LIMIT_REPOSITORY || "ocpdata/test-rate-limit",
      workflow:
        process.env.GITHUB_RATE_LIMIT_WORKFLOW || "rate-limit.yml",
      callbackUrl: process.env.GH_RATE_LIMIT_CALLBACK_URL || "",
      callbackSecret: process.env.SECURITY_TEST_CALLBACK_SECRET || "",
    },
  },
  mail: {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || "no-reply@newpeople.local",
  },
  db: {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "newpeople_crm",
    connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
  },
  documents: {
    storage: {
      provider: process.env.DOCUMENT_STORAGE_PROVIDER || "local_fs",
      localRoot:
        process.env.DOCUMENT_STORAGE_LOCAL_ROOT ||
        resolve(__dirname, "../../.data/documents"),
      s3Bucket: process.env.DOCUMENT_STORAGE_S3_BUCKET || "",
      s3Region: process.env.DOCUMENT_STORAGE_S3_REGION || "us-east-1",
      s3Endpoint: process.env.DOCUMENT_STORAGE_S3_ENDPOINT || "",
      s3ForcePathStyle:
        String(process.env.DOCUMENT_STORAGE_S3_FORCE_PATH_STYLE || "true") ===
        "true",
      s3AccessKeyId: process.env.DOCUMENT_STORAGE_S3_ACCESS_KEY_ID || "",
      s3SecretAccessKey:
        process.env.DOCUMENT_STORAGE_S3_SECRET_ACCESS_KEY || "",
      maxSessionFiles: Number(process.env.DOCUMENT_MAX_SESSION_FILES || 8),
      maxSessionBytes: Number(
        process.env.DOCUMENT_MAX_SESSION_BYTES || 120 * 1024 * 1024,
      ),
      maxAudioFilesPerSession: Number(
        process.env.DOCUMENT_MAX_AUDIO_FILES_PER_SESSION || 3,
      ),
      maxAudioDurationSecondsPerFile: Number(
        process.env.DOCUMENT_MAX_AUDIO_DURATION_SECONDS_PER_FILE || 20 * 60,
      ),
      maxAudioDurationSecondsPerSession: Number(
        process.env.DOCUMENT_MAX_AUDIO_DURATION_SECONDS_PER_SESSION || 40 * 60,
      ),
      allowedMimeTypes: (
        process.env.DOCUMENT_ALLOWED_MIME_TYPES ||
        [
          "application/pdf",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "application/vnd.ms-powerpoint",
          "application/mspowerpoint",
          "application/x-mspowerpoint",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.ms-excel",
          "text/csv",
          "text/plain",
          "message/rfc822",
          "image/png",
          "image/jpeg",
          "audio/mpeg",
          "audio/wav",
          "audio/x-wav",
          "audio/mp4",
          "audio/x-m4a",
          "video/mp4",
          "application/mp4",
        ].join(",")
      )
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    },
    processing: {
      mode: process.env.DOCUMENT_PROCESSING_MODE || "async_in_process",
      pollIntervalMs: Number(
        process.env.DOCUMENT_PROCESSING_POLL_INTERVAL_MS || 5000,
      ),
      maxAttempts: Number(process.env.DOCUMENT_PROCESSING_MAX_ATTEMPTS || 3),
      retryBaseDelayMs: Number(
        process.env.DOCUMENT_PROCESSING_RETRY_BASE_DELAY_MS || 15000,
      ),
    },
    quotation: {
      company: {
        logoPath:
          process.env.QUOTATION_COMPANY_LOGO_PATH ||
          resolve(__dirname, "../../web/src/assets/hero.png"),
        legalName:
          process.env.QUOTATION_COMPANY_LEGAL_NAME ||
          "Access Quality S.A. de C.V.",
        taxId: process.env.QUOTATION_COMPANY_TAX_ID || "RFC: AQU110118AV2",
        addressLines: (
          process.env.QUOTATION_COMPANY_ADDRESS_LINES ||
          [
            "Montecito #38, Piso 7, Oficina 1, WTC, Col. Napoles",
            "Benito Juarez, CDMX, CP 03810",
          ].join("|")
        )
          .split("|")
          .map((line) => line.trim())
          .filter(Boolean),
        email: process.env.QUOTATION_COMPANY_EMAIL || "",
        phone: process.env.QUOTATION_COMPANY_PHONE || "",
      },
    },
  },
  exchangeRates: {
    provider: process.env.EXCHANGE_RATE_PROVIDER || "frankfurter",
    baseCurrency: (
      process.env.EXCHANGE_RATE_BASE_CURRENCY || "USD"
    ).toUpperCase(),
    frankfurterBaseUrl:
      process.env.EXCHANGE_RATE_FRANKFURTER_BASE_URL ||
      "https://api.frankfurter.app",
    timeoutMs: Number(process.env.EXCHANGE_RATE_TIMEOUT_MS || 5000),
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    transcriptionModel:
      process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe",
    baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    enableWebSearch:
      String(process.env.OPENAI_ENABLE_WEB_SEARCH || "false") === "true",
  },
  landingSecurity: {
    defaultEnabled:
      String(process.env.LANDING_SECURITY_DEFAULT_ENABLED || "false") ===
      "true",
    defaultHoneypotEnabled:
      String(
        process.env.LANDING_SECURITY_DEFAULT_HONEYPOT_ENABLED || "true",
      ) === "true",
    defaultRequireUserAgent:
      String(
        process.env.LANDING_SECURITY_DEFAULT_REQUIRE_USER_AGENT || "false",
      ) === "true",
    defaultRateLimitEnabled:
      String(
        process.env.LANDING_SECURITY_DEFAULT_RATE_LIMIT_ENABLED || "false",
      ) === "true",
    defaultIpRequestsPerMinute: Number(
      process.env.LANDING_SECURITY_DEFAULT_IP_REQUESTS_PER_MINUTE || 30,
    ),
    defaultSlugRequestsPerHour: Number(
      process.env.LANDING_SECURITY_DEFAULT_SLUG_REQUESTS_PER_HOUR || 600,
    ),
    defaultBlockDurationSeconds: Number(
      process.env.LANDING_SECURITY_DEFAULT_BLOCK_DURATION_SECONDS || 300,
    ),
    defaultRequireIdempotencyKey:
      String(
        process.env.LANDING_SECURITY_DEFAULT_REQUIRE_IDEMPOTENCY_KEY || "false",
      ) === "true",
    defaultMatchPayloadHash:
      String(
        process.env.LANDING_SECURITY_DEFAULT_MATCH_PAYLOAD_HASH || "false",
      ) === "true",
    defaultRejectUnknownFields:
      String(
        process.env.LANDING_SECURITY_DEFAULT_REJECT_UNKNOWN_FIELDS || "false",
      ) === "true",
    defaultMaxFieldLength: Number(
      process.env.LANDING_SECURITY_DEFAULT_MAX_FIELD_LENGTH || 500,
    ),
    defaultMaxTotalFields: Number(
      process.env.LANDING_SECURITY_DEFAULT_MAX_TOTAL_FIELDS || 120,
    ),
    defaultEnforceOriginAllowlist:
      String(
        process.env.LANDING_SECURITY_DEFAULT_ENFORCE_ORIGIN_ALLOWLIST ||
          "false",
      ) === "true",
    defaultAllowedOrigins: String(
      process.env.LANDING_SECURITY_DEFAULT_ALLOWED_ORIGINS || "",
    )
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    defaultGenericValidationErrors:
      String(
        process.env.LANDING_SECURITY_DEFAULT_GENERIC_VALIDATION_ERRORS ||
          "false",
      ) === "true",
  },
};
