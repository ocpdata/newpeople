import { createHash, randomUUID } from "node:crypto";
import express from "express";
import { z } from "zod";
import { requireAnyPermission } from "./auth.js";
import { config } from "./config.js";
import { query, withTransaction } from "./db.js";
import { logAuditEvent } from "./audit.js";
import {
  parseMultipartFiles,
  cleanupTempFiles,
} from "./opportunity-documents/service.js";

const landingReadPermissions = ["landing.read"];
const landingCreatePermissions = ["landing.create"];
const landingUpdatePermissions = ["landing.update"];
const landingPublishPermissions = ["landing.publish"];
const landingSubmissionsReadPermissions = ["landing.submissions.read"];
const landingSubmissionsReprocessPermissions = [
  "landing.submissions.reprocess",
];

const SOURCE_TYPES = new Set([
  "ai",
  "html_upload",
  "url_import_once",
  "manual_edit",
]);
const FIELD_TYPES = new Set([
  "text",
  "email",
  "phone",
  "textarea",
  "select",
  "radio",
  "checkbox",
  "hidden",
]);
const CRM_ENTITY_TYPES = new Set(["lead", "account", "contact", "meta"]);
const CRM_STATUS_PENDING = "pending";
const CRM_STATUS_PENDING_MANUAL = "pending_manual";
const CRM_STATUS_PROCESSED = "processed";
const CRM_STATUS_FAILED = "failed";
const CRM_STATUS_DUPLICATE_REVIEW = "duplicate_review";

const updateDraftSchema = z.object({
  html_content: z.string().trim().min(1).max(2_000_000).optional(),
  form_schema: z.any().optional(),
  publish_notes: z.string().trim().max(500).optional().nullable(),
});

const upsertLandingSchema = z.object({
  eventName: z.string().trim().min(1).max(180),
  slug: z
    .string()
    .trim()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9-]+$/),
  source_type: z.enum(["ai", "html_upload", "url_import_once", "manual_edit"]),
  initial_prompt: z.string().trim().max(4000).optional().nullable(),
  html_content: z.string().trim().max(2_000_000).optional().nullable(),
  source_url: z.string().trim().url().max(1000).optional().nullable(),
  form_schema: z.any(),
});

const importUrlSchema = z.object({
  source_url: z.string().trim().url().max(1000),
  force: z.boolean().optional().default(false),
});

const publishSchema = z.object({
  version_id: z.number().int().positive(),
});

const confirmationConfigSchema = z.object({
  enabled: z.boolean(),
  response_type: z.enum(["email", "page", "both"]).optional().nullable(),
  email_subject: z.string().trim().max(300).optional().nullable(),
  email_body_html: z.string().trim().max(200_000).optional().nullable(),
  redirect_url: z.string().trim().max(1000).optional().nullable(),
  page_html: z.string().trim().max(2_000_000).optional().nullable(),
});

const securityConfigSchema = z.object({
  enabled: z.boolean().optional(),
  honeypot_enabled: z.boolean().optional(),
  require_user_agent: z.boolean().optional(),
  rate_limit: z
    .object({
      enabled: z.boolean().optional(),
      ip_requests_per_minute: z.number().int().min(1).max(10_000).optional(),
      slug_requests_per_hour: z.number().int().min(1).max(100_000).optional(),
      block_duration_seconds: z.number().int().min(1).max(86_400).optional(),
    })
    .optional(),
  idempotency: z
    .object({
      require_key: z.boolean().optional(),
      match_payload_hash: z.boolean().optional(),
    })
    .optional(),
  payload_rules: z
    .object({
      reject_unknown_fields: z.boolean().optional(),
      max_field_length_default: z.number().int().min(10).max(20_000).optional(),
      max_total_fields: z.number().int().min(1).max(1_000).optional(),
    })
    .optional(),
  origin_rules: z
    .object({
      enforce_allowlist: z.boolean().optional(),
      allowed_origins: z.array(z.string().trim().max(300)).max(200).optional(),
    })
    .optional(),
  response_privacy: z
    .object({
      generic_validation_errors: z.boolean().optional(),
    })
    .optional(),
});

const publicSubmitSchema = z.object({
  form_data: z.record(z.string(), z.any()),
  context: z
    .object({
      referrer_url: z.string().trim().max(1000).optional().nullable(),
      page_url: z.string().trim().max(1000).optional().nullable(),
    })
    .optional()
    .default({}),
});

const reprocessSchema = z.object({
  force: z.boolean().optional().default(false),
});

const submissionNotesSchema = z.object({
  user_notes: z.string().max(8000).optional().nullable(),
});

const submissionSellerSchema = z.object({
  seller_user_id: z.number().int().positive().nullable(),
});

const autoAssignSubmissionSellersSchema = z.object({
  submission_ids: z.array(z.number().int().positive()).min(1).max(500),
});

const privateRouter = express.Router();
const publicRouter = express.Router();

const LANDING_SECURITY_DEFAULTS = Object.freeze({
  enabled: Boolean(config.landingSecurity?.defaultEnabled),
  honeypot_enabled: Boolean(config.landingSecurity?.defaultHoneypotEnabled),
  require_user_agent: Boolean(config.landingSecurity?.defaultRequireUserAgent),
  rate_limit: {
    enabled: Boolean(config.landingSecurity?.defaultRateLimitEnabled),
    ip_requests_per_minute: Math.max(
      1,
      Number(config.landingSecurity?.defaultIpRequestsPerMinute || 30),
    ),
    slug_requests_per_hour: Math.max(
      1,
      Number(config.landingSecurity?.defaultSlugRequestsPerHour || 600),
    ),
    block_duration_seconds: Math.max(
      1,
      Number(config.landingSecurity?.defaultBlockDurationSeconds || 300),
    ),
  },
  idempotency: {
    require_key: Boolean(config.landingSecurity?.defaultRequireIdempotencyKey),
    match_payload_hash: Boolean(
      config.landingSecurity?.defaultMatchPayloadHash,
    ),
  },
  payload_rules: {
    reject_unknown_fields: Boolean(
      config.landingSecurity?.defaultRejectUnknownFields,
    ),
    max_field_length_default: Math.max(
      10,
      Number(config.landingSecurity?.defaultMaxFieldLength || 500),
    ),
    max_total_fields: Math.max(
      1,
      Number(config.landingSecurity?.defaultMaxTotalFields || 120),
    ),
  },
  origin_rules: {
    enforce_allowlist: Boolean(
      config.landingSecurity?.defaultEnforceOriginAllowlist,
    ),
    allowed_origins: Array.isArray(
      config.landingSecurity?.defaultAllowedOrigins,
    )
      ? config.landingSecurity.defaultAllowedOrigins
      : [],
  },
  response_privacy: {
    generic_validation_errors: Boolean(
      config.landingSecurity?.defaultGenericValidationErrors,
    ),
  },
});

const landingSubmissionRateLimitBuckets = {
  ipMinute: new Map(),
  slugHour: new Map(),
};

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizePhone(value) {
  return String(value || "")
    .trim()
    .replace(/[^\d+]/g, "")
    .slice(0, 30);
}

function normalizeCompanyName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b(s\.?a\.?\s*de\s*c\.?v\.?|s\.?a\.?|llc|inc|corp)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeGenericText(value, max = 255) {
  return String(value || "")
    .trim()
    .slice(0, max);
}

function normalizeSqlDateTimeToUtcIso(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  // MySQL DATETIME has no timezone marker. We persist and expose it as UTC.
  const parsed = new Date(`${text.replace(" ", "T")}Z`);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString();
}

function formatSubmissionValueForSynopsis(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "Si" : "No";
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? "").trim())
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value === "object") {
    return normalizeGenericText(JSON.stringify(value), 1000);
  }
  return normalizeGenericText(value, 1000);
}

function buildLeadSynopsisFromSubmission({
  payloadRaw,
  formSchema,
  userNotes,
  eventName,
  ownerName,
}) {
  const lines = [];

  // Add event name if available
  if (eventName) {
    lines.push(`Evento: ${normalizeGenericText(eventName, 180)}`);
  }

  // Add owner/account owner if available
  if (ownerName) {
    lines.push(`Propietario de la cuenta: ${normalizeGenericText(ownerName, 180)}`);
  }

  // Add separator if we added event or owner info
  if (lines.length) {
    lines.push("");
  }

  const entries = buildSubmissionFieldEntries(payloadRaw, formSchema);

  for (const entry of entries) {
    const label = normalizeGenericText(
      entry?.label || entry?.key || "Campo",
      120,
    );
    const value = formatSubmissionValueForSynopsis(entry?.value);
    if (!label || !value) continue;
    lines.push(`${label}: ${value}`);
  }

  const notesText = normalizeGenericText(userNotes || "", 4000);
  if (notesText) {
    if (lines.length > (eventName || ownerName ? 3 : 0)) {
      lines.push("");
    }
    lines.push("Notas del registro:");
    lines.push(notesText);
  }

  return normalizeGenericText(lines.join("\n"), 8000) || null;
}

function resolveLeadTitleFromSubmission(normalizedPayload, slug) {
  const accountName = normalizeCompanyName(
    normalizedPayload?.account?.name ||
      normalizedPayload?.contact?.company_name ||
      "",
  );

  if (accountName) {
    return normalizeGenericText(accountName, 180);
  }

  return normalizeGenericText(
    normalizedPayload?.lead?.title || `Registro landing ${slug}`,
    180,
  );
}

function parseConfirmationConfig(value) {
  const fallback = {
    enabled: false,
    response_type: "email",
    email_subject: "",
    email_body_html: "",
    redirect_url: "",
    page_html: "",
  };

  const raw =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value || "{}");
          } catch {
            return {};
          }
        })()
      : value && typeof value === "object"
        ? value
        : {};

  const responseType = String(raw.response_type || "email").trim();

  return {
    ...fallback,
    enabled: Boolean(raw.enabled),
    response_type: ["email", "page", "both"].includes(responseType)
      ? responseType
      : "email",
    email_subject: String(raw.email_subject || "").trim(),
    email_body_html: String(raw.email_body_html || "").trim(),
    redirect_url: String(raw.redirect_url || "").trim(),
    page_html: String(raw.page_html || "").trim(),
  };
}

function normalizeOrigin(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const parsed = new URL(text);
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return "";
  }
}

function parseLandingSecurityConfig(value) {
  const raw =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value || "{}");
          } catch {
            return {};
          }
        })()
      : value && typeof value === "object"
        ? value
        : {};

  const parsed = securityConfigSchema.safeParse(raw);
  const clean = parsed.success ? parsed.data : {};

  const allowedOrigins = [
    ...(LANDING_SECURITY_DEFAULTS.origin_rules.allowed_origins || []),
    ...((clean.origin_rules?.allowed_origins || []).map((value) =>
      normalizeOrigin(value),
    ) || []),
  ].filter(Boolean);

  return {
    enabled:
      clean.enabled !== undefined
        ? Boolean(clean.enabled)
        : LANDING_SECURITY_DEFAULTS.enabled,
    honeypot_enabled:
      clean.honeypot_enabled !== undefined
        ? Boolean(clean.honeypot_enabled)
        : LANDING_SECURITY_DEFAULTS.honeypot_enabled,
    require_user_agent:
      clean.require_user_agent !== undefined
        ? Boolean(clean.require_user_agent)
        : LANDING_SECURITY_DEFAULTS.require_user_agent,
    rate_limit: {
      enabled:
        clean.rate_limit?.enabled !== undefined
          ? Boolean(clean.rate_limit.enabled)
          : LANDING_SECURITY_DEFAULTS.rate_limit.enabled,
      ip_requests_per_minute: Math.max(
        1,
        Number(
          clean.rate_limit?.ip_requests_per_minute ||
            LANDING_SECURITY_DEFAULTS.rate_limit.ip_requests_per_minute,
        ),
      ),
      slug_requests_per_hour: Math.max(
        1,
        Number(
          clean.rate_limit?.slug_requests_per_hour ||
            LANDING_SECURITY_DEFAULTS.rate_limit.slug_requests_per_hour,
        ),
      ),
      block_duration_seconds: Math.max(
        1,
        Number(
          clean.rate_limit?.block_duration_seconds ||
            LANDING_SECURITY_DEFAULTS.rate_limit.block_duration_seconds,
        ),
      ),
    },
    idempotency: {
      require_key:
        clean.idempotency?.require_key !== undefined
          ? Boolean(clean.idempotency.require_key)
          : LANDING_SECURITY_DEFAULTS.idempotency.require_key,
      match_payload_hash:
        clean.idempotency?.match_payload_hash !== undefined
          ? Boolean(clean.idempotency.match_payload_hash)
          : LANDING_SECURITY_DEFAULTS.idempotency.match_payload_hash,
    },
    payload_rules: {
      reject_unknown_fields:
        clean.payload_rules?.reject_unknown_fields !== undefined
          ? Boolean(clean.payload_rules.reject_unknown_fields)
          : LANDING_SECURITY_DEFAULTS.payload_rules.reject_unknown_fields,
      max_field_length_default: Math.max(
        10,
        Number(
          clean.payload_rules?.max_field_length_default ||
            LANDING_SECURITY_DEFAULTS.payload_rules.max_field_length_default,
        ),
      ),
      max_total_fields: Math.max(
        1,
        Number(
          clean.payload_rules?.max_total_fields ||
            LANDING_SECURITY_DEFAULTS.payload_rules.max_total_fields,
        ),
      ),
    },
    origin_rules: {
      enforce_allowlist:
        clean.origin_rules?.enforce_allowlist !== undefined
          ? Boolean(clean.origin_rules.enforce_allowlist)
          : LANDING_SECURITY_DEFAULTS.origin_rules.enforce_allowlist,
      allowed_origins: Array.from(new Set(allowedOrigins)),
    },
    response_privacy: {
      generic_validation_errors:
        clean.response_privacy?.generic_validation_errors !== undefined
          ? Boolean(clean.response_privacy.generic_validation_errors)
          : LANDING_SECURITY_DEFAULTS.response_privacy
              .generic_validation_errors,
    },
  };
}

function buildPublicSecurityMessage(securityConfig, defaultMessage) {
  if (securityConfig?.response_privacy?.generic_validation_errors) {
    return "No fue posible procesar el registro";
  }
  return defaultMessage;
}

function checkSlidingRateLimit(bucket, key, limit, windowMs, blockDurationMs) {
  const now = Date.now();
  const current = bucket.get(key);
  if (!current) {
    bucket.set(key, {
      windowStart: now,
      count: 1,
      blockedUntil: 0,
    });
    return { blocked: false };
  }

  if (Number(current.blockedUntil || 0) > now) {
    return {
      blocked: true,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((Number(current.blockedUntil) - now) / 1000),
      ),
    };
  }

  if (now - Number(current.windowStart || 0) >= windowMs) {
    current.windowStart = now;
    current.count = 1;
    current.blockedUntil = 0;
    bucket.set(key, current);
    return { blocked: false };
  }

  current.count = Number(current.count || 0) + 1;
  if (current.count > limit) {
    current.blockedUntil = now + blockDurationMs;
    bucket.set(key, current);
    return {
      blocked: true,
      retryAfterSeconds: Math.max(1, Math.ceil(blockDurationMs / 1000)),
    };
  }

  bucket.set(key, current);
  return { blocked: false };
}

function stableJsonStringify(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`)
    .join(",")}}`;
}

function buildPublicSubmitSuccessPayload({ formSchema, confirmationConfig }) {
  const successMessage = String(
    formSchema?.submit?.success_message || "Gracias por registrarte",
  );
  const payload = {
    status: "accepted",
    message: successMessage,
  };

  const config = parseConfirmationConfig(confirmationConfig);
  if (!config.enabled) {
    return payload;
  }

  const includesPage = ["page", "both"].includes(config.response_type);
  if (!includesPage) {
    return payload;
  }

  if (config.redirect_url) {
    payload.redirect_url = config.redirect_url;
    payload.response_type = "page_redirect";
    return payload;
  }

  if (config.page_html) {
    payload.page_html = config.page_html;
    payload.response_type = "page_html";
    return payload;
  }

  payload.page_html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Registro completado</title>
    <style>
      body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; background: linear-gradient(145deg,#f0f7ff,#f8fbff); color: #16345a; }
      .wrap { max-width: 760px; margin: 0 auto; padding: 56px 20px 72px; }
      .card { background: #fff; border: 1px solid #d6e4f7; border-radius: 16px; padding: 28px; box-shadow: 0 16px 38px rgba(20,55,101,.12); }
      h1 { margin: 0 0 10px; color: #15437a; }
      p { margin: 0; color: #36587f; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <section class="card">
        <h1>${successMessage.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</h1>
        <p>Tu registro fue recibido correctamente.</p>
      </section>
    </div>
  </body>
</html>`;
  payload.response_type = "page_html";

  return payload;
}

function inferFieldMap(formSchema = {}) {
  const fields = Array.isArray(formSchema?.fields) ? formSchema.fields : [];
  const map = new Map();
  for (const field of fields) {
    const key = String(field?.key || "").trim();
    if (!key) continue;
    map.set(key, field);
  }
  return map;
}

function validateFormSchema(formSchema) {
  const schema =
    formSchema && typeof formSchema === "object" ? formSchema : null;
  if (!schema) {
    throw Object.assign(new Error("form_schema es obligatorio"), {
      status: 400,
    });
  }

  const fields = Array.isArray(schema.fields) ? schema.fields : [];
  if (!fields.length) {
    throw Object.assign(
      new Error("El formulario debe tener al menos un campo"),
      {
        status: 400,
      },
    );
  }
  if (fields.length > 50) {
    throw Object.assign(
      new Error("El formulario no puede tener mas de 50 campos"),
      {
        status: 400,
      },
    );
  }

  const keySet = new Set();
  let hasContactEmailOrPhone = false;
  for (const field of fields) {
    const key = String(field?.key || "").trim();
    const type = String(field?.type || "").trim();
    const crmEntity = String(field?.crm_map?.entity || "").trim();
    const crmField = String(field?.crm_map?.field || "").trim();

    if (!key || !/^[a-z0-9_]{2,60}$/.test(key)) {
      throw Object.assign(
        new Error(`Campo invalido: key (${key || "vacio"})`),
        {
          status: 400,
        },
      );
    }
    if (keySet.has(key)) {
      throw Object.assign(new Error(`Campo duplicado en form_schema: ${key}`), {
        status: 400,
      });
    }
    keySet.add(key);

    if (!FIELD_TYPES.has(type)) {
      throw Object.assign(new Error(`Tipo de campo no soportado: ${type}`), {
        status: 400,
      });
    }

    if (["select", "radio"].includes(type)) {
      const options = Array.isArray(field?.options) ? field.options : [];
      if (!options.length) {
        throw Object.assign(
          new Error(`El campo ${key} requiere opciones para tipo ${type}`),
          { status: 400 },
        );
      }
    }

    if (!CRM_ENTITY_TYPES.has(crmEntity)) {
      throw Object.assign(
        new Error(`crm_map.entity invalido en campo ${key}: ${crmEntity}`),
        { status: 400 },
      );
    }

    if (
      crmEntity === "contact" &&
      ["email", "phone", "mobile"].includes(crmField)
    ) {
      hasContactEmailOrPhone = true;
    }
  }

  if (!hasContactEmailOrPhone) {
    throw Object.assign(
      new Error(
        "El formulario debe mapear al menos un campo a contact.email o contact.phone/mobile",
      ),
      { status: 400 },
    );
  }

  return schema;
}

function normalizeSubmissionPayload(formData = {}, formSchema = {}) {
  const fields = Array.isArray(formSchema?.fields) ? formSchema.fields : [];
  const normalized = {
    contact: {},
    account: {},
    lead: {},
    meta: {},
  };

  for (const field of fields) {
    const key = String(field?.key || "").trim();
    const entity = String(field?.crm_map?.entity || "").trim();
    const targetField = String(field?.crm_map?.field || "").trim();
    if (!key || !entity || !targetField) continue;

    const rawValue = formData?.[key];
    if (rawValue === undefined || rawValue === null) continue;

    let value = rawValue;
    if (targetField === "email") {
      value = normalizeEmail(rawValue);
    } else if (["phone", "mobile"].includes(targetField)) {
      value = normalizePhone(rawValue);
    } else if (targetField === "name") {
      value = normalizeCompanyName(rawValue);
    } else {
      value = normalizeGenericText(rawValue, 500);
    }

    if (String(value || "").trim() === "") continue;
    normalized[entity][targetField] = value;
  }

  return normalized;
}

function buildSubmissionFieldEntries(payloadRaw = {}, formSchema = {}) {
  const raw = payloadRaw && typeof payloadRaw === "object" ? payloadRaw : {};
  const formData =
    raw.form_data && typeof raw.form_data === "object" ? raw.form_data : {};

  const schema =
    typeof formSchema === "string"
      ? (() => {
          try {
            return JSON.parse(formSchema || "{}");
          } catch {
            return {};
          }
        })()
      : formSchema && typeof formSchema === "object"
        ? formSchema
        : {};

  const schemaFields = Array.isArray(schema.fields) ? schema.fields : [];
  const FIELD_LABEL_ES = {
    first_name: "Nombre",
    last_name: "Apellido",
    full_name: "Nombre completo",
    name: "Nombre",
    email: "Correo",
    phone: "Telefono",
    mobile: "Celular",
    company: "Empresa",
    company_name: "Empresa",
    organization: "Organizacion",
    position: "Cargo",
    position_title: "Cargo",
    job_title: "Cargo",
    country: "Pais",
    city: "Ciudad",
    state: "Estado",
    state_region: "Region",
    address: "Direccion",
    address_line: "Direccion",
    postal_code: "Codigo postal",
    website: "Sitio web",
    notes: "Notas",
    comments: "Comentarios",
    message: "Mensaje",
  };
  const humanizeFieldKey = (key) =>
    (() => {
      const normalized = String(key || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_");
      if (FIELD_LABEL_ES[normalized]) {
        return FIELD_LABEL_ES[normalized];
      }
      return String(key || "")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^\w/, (char) => char.toUpperCase());
    })();

  if (schemaFields.length) {
    const entries = [];
    const included = new Set();

    for (const field of schemaFields) {
      const key = String(field?.key || "").trim();
      if (!key || key === "hp_field") continue;
      const label = String(field?.label || "").trim() || humanizeFieldKey(key);
      included.add(key);
      entries.push({
        key,
        label,
        value: Object.prototype.hasOwnProperty.call(formData, key)
          ? formData[key]
          : null,
      });
    }

    // Also include dynamic/extra posted inputs not defined in schema.
    for (const rawKey of Object.keys(formData)) {
      const key = String(rawKey || "").trim();
      if (!key || key === "hp_field" || included.has(key)) continue;
      entries.push({
        key,
        label: humanizeFieldKey(key),
        value: formData[key],
      });
    }

    return entries;
  }

  const fallbackKeys = Object.keys(formData)
    .map((key) => String(key || "").trim())
    .filter((key) => key && key !== "hp_field");

  return Array.from(new Set(fallbackKeys)).map((key) => ({
    key,
    label: String(key)
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^\w/, (char) => char.toUpperCase()),
    value: formData[key],
  }));
}

function buildLandingCaptureScript(slug) {
  const safeSlug = String(slug || "").trim();
  return `
<script>
(function(){
  try {
    var form = document.querySelector('form[data-landing-form]') || document.querySelector('form');
    if (!form) return;

    function collectFormData(targetForm) {
      var result = {};
      try {
        var nativeData = new FormData(targetForm);
        nativeData.forEach(function(value, key){
          if (typeof value === 'string') {
            result[key] = value;
            return;
          }
          result[key] = '';
        });
      } catch (_err) {
        var elements = Array.from(targetForm.elements || []);
        elements.forEach(function(el){
          if (!el || !el.name) return;
          if (el.type === 'checkbox') {
            result[el.name] = Boolean(el.checked);
            return;
          }
          if (el.type === 'radio') {
            if (el.checked) result[el.name] = el.value;
            return;
          }
          result[el.name] = el.value;
        });
      }

      if (!Object.prototype.hasOwnProperty.call(result, 'hp_field')) {
        result.hp_field = '';
      }
      return result;
    }

    form.addEventListener('submit', async function(event){
      event.preventDefault();
      event.stopPropagation();
      var formData = collectFormData(form);
      var idempotencyKey = '';
      try {
        idempotencyKey =
          (window.crypto && typeof window.crypto.randomUUID === 'function'
            ? window.crypto.randomUUID()
            : '') ||
          ('landing-' + Date.now() + '-' + Math.random().toString(36).slice(2));
      } catch (_err) {
        idempotencyKey = 'landing-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      }

      var submitButton = form.querySelector('[type="submit"]');
      if (submitButton) submitButton.disabled = true;

      var response = await fetch('/api/public/landing/v1/${safeSlug}/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify({
          form_data: formData,
          context: {
            referrer_url: document.referrer || null,
            page_url: window.location.href || null
          }
        })
      });

      if (submitButton) submitButton.disabled = false;

      if (response.ok) {
        var payload = await response.json().catch(function(){ return {}; });
        var successMessage = (payload && payload.message) || 'Gracias por registrarte';

        if (payload && typeof payload.redirect_url === 'string' && payload.redirect_url.trim()) {
          window.location.assign(payload.redirect_url.trim());
          return;
        }

        if (payload && typeof payload.page_html === 'string' && payload.page_html.trim()) {
          document.documentElement.innerHTML = payload.page_html;
          document.open();
          document.write(payload.page_html);
          document.close();
          return;
        }

        window.alert(successMessage);
        return;
      }

      window.alert('No fue posible enviar el formulario. Intenta de nuevo.');
    });
  } catch (error) {
    console.error('landing submit error', error);
  }
})();
</script>
`;
}

function sanitizeImportedHtmlForPublish(html) {
  const sourceHtml = String(html || "");

  // Imported pages often depend on framework runtimes from their original host.
  // Remove third-party scripts so the published snapshot behaves as static HTML.
  const withoutScripts = sourceHtml
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, "");

  return withoutScripts;
}

function renderLandingHtml(html, slug, sourceType = "manual_edit") {
  let sourceHtml = String(html || "");
  if (String(sourceType || "").trim() === "url_import_once") {
    sourceHtml = sanitizeImportedHtmlForPublish(sourceHtml);
  }

  const script = buildLandingCaptureScript(slug);
  if (sourceHtml.toLowerCase().includes("</body>")) {
    return sourceHtml.replace(/<\/body>/i, `${script}</body>`);
  }
  return `${sourceHtml}\n${script}`;
}

function hasPermission(user, permission) {
  return Boolean(user?.permissionSet?.has(permission));
}

function hasGlobalLandingSubmissionsScope(user) {
  if (!user) return false;
  if (hasPermission(user, "interacciones.read_all")) return true;

  return Boolean(
    Array.isArray(user.roles) &&
      user.roles.some(
        (role) => role?.is_system || String(role?.name || "") === "Administrador",
      ),
  );
}

async function loadLandingPageById(landingPageId) {
  const rows = await query(
    `SELECT lp.id, lp.event_id, lp.event_name, lp.slug, lp.status, lp.current_version_id,
            lp.confirmation_config_json, lp.security_config_json,
            lp.created_by, lp.updated_by, lp.created_at, lp.updated_at
     FROM landing_pages lp
     WHERE lp.id = ?
     LIMIT 1`,
    [Number(landingPageId)],
  );
  return rows[0] || null;
}

async function loadLandingVersionById(landingPageId, versionId) {
  const rows = await query(
    `SELECT lv.*
     FROM landing_page_versions lv
     WHERE lv.id = ? AND lv.landing_page_id = ?
     LIMIT 1`,
    [Number(versionId), Number(landingPageId)],
  );
  return rows[0] || null;
}

async function parseFormSchemaFromField(formSchemaRaw) {
  if (!formSchemaRaw) {
    throw Object.assign(new Error("form_schema es obligatorio"), {
      status: 400,
    });
  }
  try {
    const parsed = JSON.parse(String(formSchemaRaw));
    return validateFormSchema(parsed);
  } catch (error) {
    if (error?.status) throw error;
    throw Object.assign(new Error("form_schema no es JSON valido"), {
      status: 400,
    });
  }
}

async function fetchUrlHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok) {
      throw Object.assign(
        new Error(`No fue posible importar URL (${response.status})`),
        {
          status: 422,
        },
      );
    }
    const html = await response.text();
    if (!html || html.length > 2_000_000) {
      throw Object.assign(
        new Error("El HTML importado es vacio o excede el limite"),
        {
          status: 422,
        },
      );
    }
    return html;
  } finally {
    clearTimeout(timeout);
  }
}

async function getCatalogIdByCode(tableName, code) {
  const rows = await query(
    `SELECT id FROM ${tableName} WHERE code = ? LIMIT 1`,
    [String(code || "").trim()],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

async function resolveCountryId() {
  const rows = await query(
    `SELECT id FROM countries WHERE iso2 = 'MX' LIMIT 1`,
  );
  return rows[0] ? Number(rows[0].id) : null;
}

function buildRegistrationCode(prefix = "LND") {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`.slice(
    0,
    80,
  );
}

async function resolveOrCreateAccount({ normalizedPayload, actorUserId }) {
  const accountName = normalizeCompanyName(
    normalizedPayload?.account?.name ||
      normalizedPayload?.contact?.company_name ||
      "",
  );
  if (!accountName) {
    return null;
  }

  const existing = await query(
    `SELECT id
     FROM accounts
     WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))
     ORDER BY id ASC
     LIMIT 2`,
    [accountName],
  );
  if (existing.length > 1) {
    return { duplicateReview: true };
  }
  if (existing.length === 1) {
    return { accountId: Number(existing[0].id), action: "match_update" };
  }

  const [accountTypeId, economicSectorId, activationStatusId, countryId] =
    await Promise.all([
      getCatalogIdByCode("account_types", "prospecto").then(
        (value) =>
          value || getCatalogIdByCode("account_types", "cliente_potencial"),
      ),
      getCatalogIdByCode("economic_sectors", "otros"),
      getCatalogIdByCode("account_activation_statuses", "activada"),
      resolveCountryId(),
    ]);

  if (
    !accountTypeId ||
    !economicSectorId ||
    !activationStatusId ||
    !countryId
  ) {
    return { error: "No fue posible resolver catalogos para crear cuenta" };
  }

  const now = new Date();
  const insertResult = await query(
    `INSERT INTO accounts
      (name, account_type_id, registration_code, phone, economic_sector_id, website,
       city, state_region, country_id, description, address_line, postal_code,
       activation_status_id, created_by, created_at, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`,
    [
      accountName,
      accountTypeId,
      buildRegistrationCode("LND"),
      normalizedPayload?.account?.phone || null,
      economicSectorId,
      normalizedPayload?.account?.website || null,
      normalizedPayload?.account?.city || null,
      normalizedPayload?.account?.state_region || null,
      countryId,
      normalizedPayload?.lead?.notes || null,
      activationStatusId,
      Number(actorUserId),
      now,
      Number(actorUserId),
      now,
    ],
  );

  const accountId = Number(insertResult.insertId || 0);
  if (!accountId) {
    return { error: "No fue posible crear cuenta" };
  }

  await query(
    `INSERT INTO account_owners (account_id, user_id, assigned_at, assigned_by)
     SELECT ?, ?, NOW(3), ?
     WHERE NOT EXISTS (
       SELECT 1 FROM account_owners WHERE account_id = ? AND user_id = ?
     )`,
    [
      accountId,
      Number(actorUserId),
      Number(actorUserId),
      accountId,
      Number(actorUserId),
    ],
  ).catch(() => undefined);

  return { accountId, action: "create" };
}

async function resolveOrCreateContact({
  normalizedPayload,
  accountId,
  actorUserId,
}) {
  const email = normalizeEmail(normalizedPayload?.contact?.email || "");
  const mobile = normalizePhone(
    normalizedPayload?.contact?.mobile ||
      normalizedPayload?.contact?.phone ||
      "",
  );

  if (email) {
    const rows = await query(
      `SELECT id, account_id
       FROM contacts
       WHERE LOWER(TRIM(email)) = ?
       ORDER BY id ASC
       LIMIT 2`,
      [email],
    );

    if (rows.length > 1) {
      return { duplicateReview: true };
    }

    if (rows.length === 1) {
      const contactId = Number(rows[0].id);
      await query(
        `UPDATE contacts
         SET phone = COALESCE(NULLIF(phone, ''), ?),
             mobile = COALESCE(NULLIF(mobile, ''), ?),
             position_title = COALESCE(NULLIF(position_title, ''), ?),
             department = COALESCE(NULLIF(department, ''), ?),
             updated_by = ?,
             updated_at = NOW(3)
         WHERE id = ?`,
        [
          normalizedPayload?.contact?.phone || null,
          mobile || null,
          normalizedPayload?.contact?.position_title || null,
          normalizedPayload?.contact?.department || null,
          Number(actorUserId),
          contactId,
        ],
      ).catch(() => undefined);

      return { contactId, action: "match_update" };
    }
  }

  if (!accountId) {
    return { error: "No fue posible crear contacto sin cuenta asociada" };
  }

  const firstName = normalizeGenericText(
    normalizedPayload?.contact?.first_name || "Prospecto",
    120,
  );
  const lastName = normalizeGenericText(
    normalizedPayload?.contact?.last_name || "Landing",
    120,
  );

  const [
    purchaseParticipationId,
    relationshipTypeId,
    hierarchyLevelId,
    influenceLevelId,
    employmentStatusId,
    activationStatusId,
    countryId,
  ] = await Promise.all([
    getCatalogIdByCode("contact_purchase_participations", "ninguno"),
    getCatalogIdByCode("contact_relationship_types", "media").then(
      (value) =>
        value || getCatalogIdByCode("contact_relationship_types", "ninguno"),
    ),
    getCatalogIdByCode("contact_hierarchy_levels", "usuario"),
    getCatalogIdByCode("contact_influence_levels", "media"),
    getCatalogIdByCode("contact_employment_statuses", "labora"),
    getCatalogIdByCode("contact_activation_statuses", "activado"),
    resolveCountryId(),
  ]);

  if (
    !purchaseParticipationId ||
    !relationshipTypeId ||
    !hierarchyLevelId ||
    !influenceLevelId ||
    !employmentStatusId ||
    !activationStatusId
  ) {
    return { error: "No fue posible resolver catalogos para crear contacto" };
  }

  const now = new Date();
  const insertResult = await query(
    `INSERT INTO contacts
      (first_name, last_name, account_id, position_title, phone, phone_extension,
       mobile, email, department, country_id, state_region, city, address_line,
       postal_code, purchase_participation_id, relationship_type_id,
       hierarchy_level_id, influence_level_id, employment_status_id,
       activation_status_id, manager_contact_id, influences_contact_id,
       created_by, created_at, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
    [
      firstName,
      lastName,
      Number(accountId),
      normalizedPayload?.contact?.position_title || null,
      normalizedPayload?.contact?.phone || null,
      mobile || null,
      email || null,
      normalizedPayload?.contact?.department || null,
      countryId || null,
      normalizedPayload?.contact?.state_region || null,
      normalizedPayload?.contact?.city || null,
      purchaseParticipationId,
      relationshipTypeId,
      hierarchyLevelId,
      influenceLevelId,
      employmentStatusId,
      activationStatusId,
      Number(actorUserId),
      now,
      Number(actorUserId),
      now,
    ],
  );

  const contactId = Number(insertResult.insertId || 0);
  if (!contactId) {
    return { error: "No fue posible crear contacto" };
  }

  return { contactId, action: "create" };
}

async function resolveFirstActiveAccountOwnerUserId(accountId) {
  const normalizedAccountId = Number(accountId || 0);
  if (!Number.isInteger(normalizedAccountId) || normalizedAccountId <= 0) {
    return null;
  }

  // Business rule: if multiple active owners exist, assign the first by oldest assignment.
  const rows = await query(
    `SELECT ao.user_id
     FROM account_owners ao
     INNER JOIN users u ON u.id = ao.user_id
     WHERE ao.account_id = ?
       AND u.status = 'active'
     ORDER BY ao.assigned_at ASC, ao.user_id ASC
     LIMIT 1`,
    [normalizedAccountId],
  );

  if (!rows[0]?.user_id) {
    return null;
  }

  return Number(rows[0].user_id) || null;
}

async function resolveSubmissionSellerUserId({
  accountId,
  contactId,
  fallbackLeadAccountId = null,
}) {
  let targetAccountId = Number(accountId || 0) || Number(fallbackLeadAccountId || 0) || null;

  if (!targetAccountId) {
    const normalizedContactId = Number(contactId || 0);
    if (normalizedContactId > 0) {
      const contactRows = await query(
        `SELECT account_id
         FROM contacts
         WHERE id = ?
         LIMIT 1`,
        [normalizedContactId],
      );
      targetAccountId = Number(contactRows[0]?.account_id || 0) || null;
    }
  }

  if (!targetAccountId) {
    return null;
  }

  return resolveFirstActiveAccountOwnerUserId(targetAccountId);
}

function resolveSubmissionAccountName(normalizedPayload) {
  return normalizeCompanyName(
    normalizedPayload?.account?.name ||
      normalizedPayload?.contact?.company_name ||
      "",
  );
}

function resolveSubmissionContactEmail(normalizedPayload) {
  return normalizeEmail(normalizedPayload?.contact?.email || "");
}

async function resolveSubmissionAccountAndContactForSeller({ normalizedPayload }) {
  const accountName = resolveSubmissionAccountName(normalizedPayload);
  const contactEmail = resolveSubmissionContactEmail(normalizedPayload);

  if (!accountName && !contactEmail) {
    return {
      accountId: null,
      contactId: null,
      accountPathAmbiguous: false,
      crossPathAmbiguous: false,
    };
  }

  let accountIdByName = null;
  let accountPathAmbiguous = false;
  if (accountName) {
    const accountRows = await query(
      `SELECT id
       FROM accounts
       WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))
       ORDER BY id ASC
       LIMIT 2`,
      [accountName],
    );
    if (accountRows.length > 1) {
      accountPathAmbiguous = true;
    } else if (accountRows.length === 1) {
      accountIdByName = Number(accountRows[0].id) || null;
    }
  }

  let contactIdByEmail = null;
  let accountIdByContact = null;
  if (contactEmail) {
    const contactRows = await query(
      `SELECT id, account_id
       FROM contacts
       WHERE LOWER(TRIM(email)) = ?
       ORDER BY id ASC
       LIMIT 2`,
      [contactEmail],
    );

    if (contactRows.length === 1) {
      contactIdByEmail = Number(contactRows[0].id) || null;
      accountIdByContact = Number(contactRows[0].account_id) || null;
    }
  }

  const hasNameAccount = Number(accountIdByName || 0) > 0;
  const hasContactAccount = Number(accountIdByContact || 0) > 0;
  const crossPathAmbiguous =
    hasNameAccount &&
    hasContactAccount &&
    Number(accountIdByName) !== Number(accountIdByContact);

  let resolvedAccountId = null;
  if (accountPathAmbiguous || crossPathAmbiguous) {
    resolvedAccountId = null;
  } else if (hasNameAccount && hasContactAccount) {
    resolvedAccountId = Number(accountIdByName);
  } else if (hasNameAccount) {
    resolvedAccountId = Number(accountIdByName);
  } else if (hasContactAccount) {
    resolvedAccountId = Number(accountIdByContact);
  }

  return {
    accountId: resolvedAccountId,
    contactId: contactIdByEmail,
    accountPathAmbiguous,
    crossPathAmbiguous,
  };
}

async function resolveSubmissionSellerUserIdForAutoAssignment({
  normalizedPayload,
  fallbackLeadAccountId = null,
}) {
  const resolution = await resolveSubmissionAccountAndContactForSeller({
    normalizedPayload,
  });

  if (resolution.accountPathAmbiguous || resolution.crossPathAmbiguous) {
    return null;
  }

  return resolveSubmissionSellerUserId({
    accountId: resolution.accountId,
    contactId: resolution.contactId,
    fallbackLeadAccountId,
  });
}

async function resolveOrCreateLead({
  submissionId,
  eventId,
  slug,
  accountId,
  contactId,
  normalizedPayload,
  leadTitle,
  leadSynopsis,
  actorUserId,
}) {
  const existingSubmissionLeadRows = await query(
    `SELECT i.id, i.account_id, i.seller_user_id
     FROM interactions i
     WHERE i.landing_submission_id = ?
     ORDER BY i.id DESC
     LIMIT 1`,
    [Number(submissionId)],
  );

  if (existingSubmissionLeadRows[0]) {
    const existingLead = existingSubmissionLeadRows[0];
    const leadId = Number(existingLead.id);
    let resolvedSellerUserId = null;
    if (Number(existingLead.seller_user_id || 0) <= 0) {
      resolvedSellerUserId = await resolveSubmissionSellerUserId({
        accountId,
        contactId,
        fallbackLeadAccountId: existingLead.account_id,
      });
    }

    await query(
      `UPDATE interactions
       SET title = ?,
           summary = ?,
           seller_user_id = COALESCE(seller_user_id, ?),
           updated_by = ?,
           updated_at = NOW(3)
       WHERE id = ?`,
      [
        normalizeGenericText(leadTitle || `Registro landing ${slug}`, 180),
        leadSynopsis || null,
        resolvedSellerUserId,
        Number(actorUserId),
        leadId,
      ],
    ).catch(() => undefined);
    return { leadId, action: "submission_update" };
  }

  const canDeduplicateByOwnership = Boolean(accountId || contactId);
  const dedupRows = canDeduplicateByOwnership
    ? await query(
        `SELECT i.id, i.account_id, i.seller_user_id
         FROM interactions i
         LEFT JOIN interaction_contact_links icl ON icl.interaction_id = i.id
         WHERE i.account_id <=> ?
           AND icl.contact_id <=> ?
           AND i.created_at >= (NOW(3) - INTERVAL 90 DAY)
           AND i.source_notes LIKE ?
         ORDER BY i.id DESC
         LIMIT 1`,
        [
          accountId || null,
          contactId || null,
          `%landing:event_id=${Number(eventId)};%`,
        ],
      )
    : [];

  if (dedupRows[0]) {
    const dedupLead = dedupRows[0];
    const leadId = Number(dedupLead.id);
    let resolvedSellerUserId = null;
    if (Number(dedupLead.seller_user_id || 0) <= 0) {
      resolvedSellerUserId = await resolveSubmissionSellerUserId({
        accountId,
        contactId,
        fallbackLeadAccountId: dedupLead.account_id,
      });
    }

    await query(
      `UPDATE interactions
       SET title = ?,
           summary = ?,
           seller_user_id = COALESCE(seller_user_id, ?),
           updated_by = ?,
           updated_at = NOW(3)
       WHERE id = ?`,
      [
        normalizeGenericText(leadTitle || `Registro landing ${slug}`, 180),
        leadSynopsis || null,
        resolvedSellerUserId,
        Number(actorUserId),
        leadId,
      ],
    ).catch(() => undefined);
    return { leadId, action: "match_update" };
  }

  const now = new Date();
  const publicId = `int_${randomUUID().replace(/-/g, "")}`;
  const title = normalizeGenericText(
    leadTitle || `Registro landing ${slug}`,
    180,
  );
  const sourceNotes = `landing:event_id=${Number(eventId)};slug=${slug};submission_id=${Number(submissionId)};campaign=${normalizeGenericText(normalizedPayload?.meta?.utm_campaign || "", 120)}`;
  let resolvedSellerUserId = await resolveSubmissionSellerUserId({
    accountId,
    contactId,
  });

  const insertResult = await query(
    `INSERT INTO interactions
       (public_id, title, lead_source, source_notes, summary, analysis_status, processing_status,
        warnings_json, topics_json, actions_taken_json, next_steps_json,
        suggested_account_json, suggested_contacts_json, suggested_opportunities_json,
        account_id, primary_opportunity_id, seller_user_id,
        landing_submission_id,
        created_by, updated_by, created_at, updated_at, analyzed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, NULL, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      publicId,
      title,
      "webinar",
      sourceNotes,
      leadSynopsis || null,
      "created",
      "analyzed",
      accountId || null,
      resolvedSellerUserId,
      Number(submissionId),
      Number(actorUserId),
      Number(actorUserId),
      now,
      now,
    ],
  );

  const leadId = Number(insertResult.insertId || 0);
  if (!leadId) {
    return { error: "No fue posible crear lead" };
  }

  if (contactId) {
    await query(
      `INSERT IGNORE INTO interaction_contact_links (interaction_id, contact_id, created_at)
       VALUES (?, ?, NOW(3))`,
      [leadId, contactId],
    ).catch(() => undefined);
  }

  return { leadId, action: "create" };
}

async function processSubmissionIntoCrm(submissionId, workerRunId) {
  const rows = await query(
    `SELECT s.id,
            s.event_id,
            s.payload_raw_json,
            s.payload_normalized_json,
            s.user_notes,
            s.crm_processing_status,
            s.sent_to_leads_at,
            s.sent_to_leads_by,
            s.landing_page_id,
            lp.slug,
            lp.created_by AS landing_page_created_by,
            lp.event_name,
            lp.confirmation_config_json,
            lv.form_schema_json
     FROM landing_submissions s
     INNER JOIN landing_pages lp ON lp.id = s.landing_page_id
     LEFT JOIN landing_page_versions lv ON lv.id = s.landing_version_id
     WHERE s.id = ?
     LIMIT 1`,
    [Number(submissionId)],
  );

  const submission = rows[0] || null;
  if (!submission) {
    return;
  }

  if (!submission.sent_to_leads_at) {
    return;
  }

  if (
    submission.crm_processing_status !== CRM_STATUS_PENDING &&
    submission.crm_processing_status !== CRM_STATUS_FAILED
  ) {
    return;
  }

  const normalizedPayload =
    typeof submission.payload_normalized_json === "string"
      ? JSON.parse(submission.payload_normalized_json || "{}")
      : submission.payload_normalized_json || {};

  const payloadRaw =
    typeof submission.payload_raw_json === "string"
      ? JSON.parse(submission.payload_raw_json || "{}")
      : submission.payload_raw_json || {};

  const formSchema =
    typeof submission.form_schema_json === "string"
      ? JSON.parse(submission.form_schema_json || "{}")
      : submission.form_schema_json || {};

  const leadTitle = resolveLeadTitleFromSubmission(
    normalizedPayload,
    submission.slug,
  );

  // Try to get existing lead's seller info if submission is already linked
  let ownerName = null;
  const existingLeadRows = await query(
    `SELECT i.seller_user_id, u.full_name
     FROM interactions i
     LEFT JOIN users u ON u.id = i.seller_user_id
     WHERE i.landing_submission_id = ?
     LIMIT 1`,
    [Number(submissionId)],
  ).catch(() => []);

  if (existingLeadRows[0]?.full_name) {
    ownerName = String(existingLeadRows[0].full_name || "").trim();
  }

  const leadSynopsis = buildLeadSynopsisFromSubmission({
    payloadRaw,
    formSchema,
    userNotes: submission.user_notes,
    eventName: String(submission.event_name || "").trim(),
    ownerName,
  });

  const actorUserId =
    Number(submission.sent_to_leads_by || 0) ||
    Number(submission.landing_page_created_by || 0) ||
    1;

  const leadResolution = await resolveOrCreateLead({
    submissionId,
    eventId: Number(submission.event_id),
    slug: submission.slug,
    accountId: null,
    contactId: null,
    normalizedPayload,
    leadTitle,
    leadSynopsis,
    actorUserId,
  });

  if (leadResolution?.error) {
    throw new Error(leadResolution.error);
  }

  await withTransaction(async (conn) => {
    await conn.query(
      `UPDATE landing_submissions
       SET crm_processing_status = ?,
           crm_error_message = NULL,
           crm_processed_at = NOW(3)
       WHERE id = ?`,
      [CRM_STATUS_PROCESSED, Number(submissionId)],
    );

    await conn.query(
      `INSERT INTO landing_submission_crm_links
         (submission_id, action_taken_json, lead_id, account_id, contact_id, worker_run_id)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         action_taken_json = VALUES(action_taken_json),
         lead_id = VALUES(lead_id),
         account_id = VALUES(account_id),
         contact_id = VALUES(contact_id),
         worker_run_id = VALUES(worker_run_id),
         processed_at = NOW(3)`,
      [
        Number(submissionId),
        JSON.stringify({
          lead: {
            action: leadResolution?.action || "none",
            id: leadResolution?.leadId || null,
          },
        }),
        leadResolution?.leadId || null,
        null,
        null,
        workerRunId,
      ],
    );
  });

  // Enviar correo de confirmación si está configurado
  await sendLandingConfirmationEmailIfEnabled(
    submission,
    normalizedPayload,
  ).catch((error) => {
    console.error(
      `[landing] Error enviando confirmación para submission ${submissionId}:`,
      error?.message,
    );
  });
}

async function sendLandingConfirmationEmailIfEnabled(
  submission,
  normalizedPayload,
) {
  try {
    // Obtener configuración de confirmación
    let confirmationConfig =
      typeof submission.confirmation_config_json === "string"
        ? JSON.parse(submission.confirmation_config_json || "{}")
        : submission.confirmation_config_json || {};

    console.log(
      `[landing] Verificando confirmación para submission ${submission.id}: enabled=${confirmationConfig.enabled}, type=${confirmationConfig.response_type}`,
    );

    if (!confirmationConfig.enabled) {
      console.log(
        `[landing] Confirmación deshabilitada para submission ${submission.id}`,
      );
      return;
    }

    const responseType = String(confirmationConfig.response_type || "email")
      .trim()
      .toLowerCase();
    if (!["email", "both"].includes(responseType)) {
      console.log(
        `[landing] Response type no incluye email: ${responseType} para submission ${submission.id}`,
      );
      return;
    }

    // Obtener email del usuario creador
    const creatorRows = await query(
      `SELECT email, full_name FROM users WHERE id = ? LIMIT 1`,
      [Number(submission.created_by)],
    );

    const creatorUser = creatorRows[0];
    if (!creatorUser?.email) {
      console.warn(
        `[landing] No se encontró email del usuario creador ${submission.created_by} para submission ${submission.id}`,
      );
      return;
    }

    // Obtener email del registrado desde payload normalizado
    const registeredEmail =
      normalizedPayload.contact?.email ||
      normalizedPayload.email ||
      normalizedPayload.correo;
    const registeredFirstName =
      normalizedPayload.contact?.first_name ||
      normalizedPayload.first_name ||
      normalizedPayload.nombre ||
      "Registrado";

    if (
      !registeredEmail ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(registeredEmail)
    ) {
      console.warn(
        `[landing] Email de registrado inválido para submission ${submission.id}: ${registeredEmail}`,
      );
      return;
    }

    console.log(
      `[landing] Enviando confirmación a ${registeredEmail} para submission ${submission.id}`,
    );

    await sendLandingConfirmationEmail({
      userId: submission.created_by,
      from: creatorUser.email,
      fromName: creatorUser.full_name,
      to: registeredEmail,
      recipientName: registeredFirstName,
      subject: confirmationConfig.email_subject || "Confirmamos tu registro",
      bodyHtml:
        confirmationConfig.email_body_html ||
        buildDefaultConfirmationHtml(
          registeredFirstName,
          submission.event_name,
        ),
    });
  } catch (error) {
    console.error(
      "[landing] Error procesando envío de confirmación:",
      error?.message,
      error?.stack,
    );
  }
}

function buildDefaultConfirmationHtml(recipientName, eventName) {
  const displayName = String(recipientName || "registrado").trim();
  const event = String(eventName || "evento").trim();
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <h1 style="color: #0066cc; margin-bottom: 24px;">¡Gracias por registrarte!</h1>
    
    <p style="margin-bottom: 16px;">Hola <strong>${displayName}</strong>,</p>
    
    <p style="margin-bottom: 16px;">
      Confirmamos que hemos recibido tu registro en <strong>${event}</strong>. 
      Nos complace que formes parte de esta experiencia.
    </p>
    
    <div style="background-color: #f5f5f5; border-left: 4px solid #0066cc; padding: 16px; margin: 24px 0; border-radius: 4px;">
      <p style="margin: 0; font-weight: 600; color: #0066cc;">Datos confirmados:</p>
      <p style="margin: 8px 0 0 0; font-size: 14px;">Email: ${displayName}</p>
      <p style="margin: 4px 0 0 0; font-size: 14px;">Evento: ${event}</p>
    </div>
    
    <p style="margin-bottom: 16px;">
      En breve recibirás más información sobre ${event}. Si tienes alguna pregunta, 
      no dudes en contactarnos respondiendo a este correo.
    </p>
    
    <p style="margin-bottom: 24px; color: #666; font-size: 14px;">
      Saludos,<br>
      <strong>El equipo</strong>
    </p>
    
    <hr style="border: none; border-top: 1px solid #ddd; margin: 32px 0;">
    
    <p style="margin: 0; font-size: 12px; color: #999;">
      Este correo se envió porque te registraste en ${event}. 
      Si consideraste este mensaje erróneamente, puedes ignorarlo.
    </p>
  </div>
</body>
</html>
  `.trim();
}

function normalizeMojibakeText(value) {
  const original = String(value || "");
  if (!original) {
    return "";
  }

  let normalized = original;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!/[ÃÂ]/.test(normalized)) {
      break;
    }

    const decoded = Buffer.from(normalized, "latin1").toString("utf8");
    if (!decoded || decoded === normalized) {
      break;
    }

    normalized = decoded;
  }

  return normalized;
}

async function sendLandingConfirmationEmail({
  userId,
  from,
  fromName,
  to,
  recipientName,
  subject,
  bodyHtml,
}) {
  const { config } = await import("./config.js");
  const nodemailer = (await import("nodemailer")).default;
  const {
    exchangeGoogleRefreshToken,
    decryptOpaqueSecret,
    sendGoogleMailMessage,
  } = await import("./utils.js");

  const displaySubject = normalizeMojibakeText(
    String(subject || "Confirmamos tu registro").trim(),
  );
  const displayHtml = String(bodyHtml || "").trim();
  const displayFromName = String(fromName || "").trim();
  const displayTo = String(to).trim();

  // Intentar enviar con Google OAuth si el usuario lo tiene configurado
  try {
    const googleConnection = await query(
      `SELECT id, google_email, refresh_token_encrypted, scope_text, revoked_at
       FROM user_google_mail_connections
       WHERE user_id = ? AND revoked_at IS NULL
       LIMIT 1`,
      [Number(userId)],
    );

    if (googleConnection.length > 0) {
      const connection = googleConnection[0];

      // Validar que tenga permisos para enviar
      const hasMailSendScope =
        String(connection.scope_text || "")
          .split(" ")
          .includes("https://www.googleapis.com/auth/gmail.send") ||
        String(connection.scope_text || "").includes(
          "https://mail.google.com/",
        );

      if (!hasMailSendScope) {
        console.warn(
          `[landing] Usuario ${userId} tiene Google conectado pero sin scope para enviar correos`,
        );
      } else {
        try {
          const refreshToken = decryptOpaqueSecret(
            connection.refresh_token_encrypted,
          );
          const tokenPayload = await exchangeGoogleRefreshToken(refreshToken);

          await sendGoogleMailMessage({
            accessToken: tokenPayload.access_token,
            from: connection.google_email,
            to: displayTo,
            subject: displaySubject,
            messageBody: "Confirmamos tu registro.",
            htmlBody: displayHtml,
            attachments: [],
          });

          console.log(
            `[landing-confirmation] ✓ Confirmación enviada a ${displayTo} desde ${connection.google_email} (Google OAuth)`,
          );
          return;
        } catch (googleError) {
          console.error(
            `[landing-confirmation] Error enviando con Google OAuth: ${googleError?.message}. Intentando con SMTP fallback.`,
          );
          // Continuar con SMTP fallback
        }
      }
    }
  } catch (googleCheckError) {
    console.log(
      `[landing] No se encontró Google conexión para usuario ${userId}, usando SMTP`,
    );
  }

  // Fallback a SMTP
  if (!config.mail.host || !config.mail.user) {
    console.error(
      `[mail] SMTP no configurado. SMTP_HOST=${config.mail.host || "undefined"}, SMTP_USER=${config.mail.user || "undefined"}. No se puede enviar confirmación a ${displayTo}.`,
    );
    throw new Error(
      "SMTP_HOST o SMTP_USER no configurados. Contacta al administrador.",
    );
  }

  console.log(
    `[mail] Enviando confirmación a ${displayTo} desde ${from} vía SMTP (${config.mail.host}:${config.mail.port})`,
  );

  const transporter = nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.secure,
    auth: {
      user: config.mail.user,
      pass: config.mail.pass,
    },
  });

  try {
    const info = await transporter.sendMail({
      from: displayFromName
        ? `${displayFromName} <${String(from).trim()}>`
        : String(from).trim(),
      to: displayTo,
      subject: displaySubject,
      html: displayHtml,
    });

    console.log(
      `[landing-confirmation] ✓ Confirmación enviada a ${displayTo} desde ${from} (SMTP, messageId: ${info.messageId})`,
    );
  } catch (error) {
    console.error(
      `[landing-confirmation] ✗ Error enviando a ${displayTo} desde ${from}: ${error?.message}`,
    );
    throw error;
  }
}

let landingWorkerStarted = false;
let landingWorkerBusy = false;
let landingWorkerTimer = null;

async function processPendingLandingSubmissionsBatch(limit = 20) {
  const rows = await query(
    `SELECT id
     FROM landing_submissions
     WHERE crm_processing_status = ?
       AND sent_to_leads_at IS NOT NULL
     ORDER BY submitted_at ASC, id ASC
     LIMIT ?`,
    [CRM_STATUS_PENDING, Number(limit)],
  );

  const workerRunId = `lnd_${Date.now()}_${randomUUID().slice(0, 8)}`;
  for (const row of rows) {
    const submissionId = Number(row.id);
    try {
      await processSubmissionIntoCrm(submissionId, workerRunId);
    } catch (error) {
      await query(
        `UPDATE landing_submissions
         SET crm_processing_status = ?,
             crm_error_message = ?,
             crm_processed_at = NOW(3)
         WHERE id = ?`,
        [
          CRM_STATUS_FAILED,
          String(
            error?.message || "No fue posible procesar envio de landing",
          ).slice(0, 1000),
          submissionId,
        ],
      ).catch(() => undefined);
    }
  }
}

export async function processPendingLandingSubmissions() {
  if (landingWorkerBusy) return;
  landingWorkerBusy = true;
  try {
    await processPendingLandingSubmissionsBatch(20);
  } catch (error) {
    console.error(
      `[landing-worker] Error procesando registros pendientes: ${error?.message}`,
    );
  } finally {
    landingWorkerBusy = false;
  }
}

export async function startLandingWorker() {
  if (landingWorkerStarted) return;
  landingWorkerStarted = true;

  await processPendingLandingSubmissions().catch((error) => {
    console.error(
      `[landing-worker] Error en arranque inicial: ${error?.message}`,
    );
  });

  landingWorkerTimer = setInterval(async () => {
    try {
      await processPendingLandingSubmissions();
    } catch (error) {
      console.error(
        `[landing-worker] Error en ciclo programado: ${error?.message}`,
      );
    }
  }, 10000);

  if (typeof landingWorkerTimer?.unref === "function") {
    landingWorkerTimer.unref();
  }
}

privateRouter.put(
  "/events/:eventId/landing",
  requireAnyPermission(landingCreatePermissions),
  async (req, res) => {
    const eventId = Number(req.params.eventId);
    if (!Number.isInteger(eventId) || eventId <= 0) {
      return res.status(400).json({ message: "eventId invalido" });
    }

    const parsed = upsertLandingSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const payload = parsed.data;
    const slug = normalizeSlug(payload.slug);
    if (!slug || !/^[a-z0-9-]{3,120}$/.test(slug)) {
      return res.status(400).json({ message: "slug invalido" });
    }

    let formSchema;
    try {
      formSchema = validateFormSchema(payload.form_schema);
    } catch (error) {
      return res
        .status(Number(error?.status) || 400)
        .json({ message: error.message });
    }

    const htmlContent =
      String(payload.html_content || "").trim() ||
      '<html><body><h1>Landing</h1><form data-landing-form><input name="email" type="email" /><button type="submit">Enviar</button></form></body></html>';

    try {
      const result = await withTransaction(async (conn) => {
        const [existingRows] = await conn.query(
          `SELECT id, slug
           FROM landing_pages
           WHERE event_id = ?
           LIMIT 1`,
          [eventId],
        );

        if (!existingRows.length) {
          const [slugRows] = await conn.query(
            `SELECT id
             FROM landing_pages
             WHERE slug = ?
             LIMIT 1`,
            [slug],
          );
          if (slugRows.length) {
            throw Object.assign(new Error("El slug ya esta en uso"), {
              status: 409,
            });
          }

          const now = new Date();
          const [insertPageResult] = await conn.query(
            `INSERT INTO landing_pages
               (event_id, event_name, slug, status, created_by, created_at, updated_by, updated_at)
             VALUES (?, ?, ?, 'draft', ?, ?, ?, ?)`,
            [
              eventId,
              payload.eventName,
              slug,
              Number(req.user.id),
              now,
              Number(req.user.id),
              now,
            ],
          );

          const landingPageId = Number(insertPageResult.insertId || 0);
          const [insertVersionResult] = await conn.query(
            `INSERT INTO landing_page_versions
               (landing_page_id, version_number, source_type, source_url, html_content,
                assets_manifest_json, form_schema_json, publish_notes, is_active, created_by, created_at)
             VALUES (?, 1, ?, ?, ?, NULL, ?, NULL, 0, ?, ?)`,
            [
              landingPageId,
              payload.source_type,
              payload.source_url || null,
              htmlContent,
              JSON.stringify(formSchema),
              Number(req.user.id),
              now,
            ],
          );

          const versionId = Number(insertVersionResult.insertId || 0);
          await conn.query(
            `UPDATE landing_pages
             SET current_version_id = ?, updated_by = ?, updated_at = NOW(3)
             WHERE id = ?`,
            [versionId, Number(req.user.id), landingPageId],
          );

          return {
            landingPageId,
            versionId,
          };
        }

        const landingPageId = Number(existingRows[0].id);
        if (String(existingRows[0].slug || "") !== slug) {
          const [slugRows] = await conn.query(
            `SELECT id
             FROM landing_pages
             WHERE slug = ?
               AND id <> ?
             LIMIT 1`,
            [slug, landingPageId],
          );
          if (slugRows.length) {
            throw Object.assign(new Error("El slug ya esta en uso"), {
              status: 409,
            });
          }
        }

        const [versionRows] = await conn.query(
          `SELECT COALESCE(MAX(version_number), 0) AS max_version
           FROM landing_page_versions
           WHERE landing_page_id = ?`,
          [landingPageId],
        );
        const nextVersion = Number(versionRows[0]?.max_version || 0) + 1;

        const [insertVersionResult] = await conn.query(
          `INSERT INTO landing_page_versions
             (landing_page_id, version_number, source_type, source_url, html_content,
              assets_manifest_json, form_schema_json, publish_notes, is_active, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, 0, ?, NOW(3))`,
          [
            landingPageId,
            nextVersion,
            payload.source_type,
            payload.source_url || null,
            htmlContent,
            JSON.stringify(formSchema),
            Number(req.user.id),
          ],
        );

        const versionId = Number(insertVersionResult.insertId || 0);
        await conn.query(
          `UPDATE landing_pages
           SET slug = ?,
               event_name = ?,
               current_version_id = ?,
               updated_by = ?,
               updated_at = NOW(3)
           WHERE id = ?`,
          [
            slug,
            payload.eventName,
            versionId,
            Number(req.user.id),
            landingPageId,
          ],
        );

        return {
          landingPageId,
          versionId,
        };
      });

      await logAuditEvent({
        req,
        module: "landing",
        action: "updated",
        entityType: "landing_page",
        entityId: Number(result.landingPageId),
        detail: `Landing guardada para evento ${eventId}`,
        after: {
          event_id: eventId,
          slug,
          version_id: Number(result.versionId),
        },
      });

      return res.json({
        landing_page: {
          id: Number(result.landingPageId),
          event_id: eventId,
          slug,
          status: "draft",
          current_version_id: Number(result.versionId),
        },
        version: {
          id: Number(result.versionId),
        },
      });
    } catch (error) {
      return res.status(Number(error?.status) || 500).json({
        message: error?.message || "No fue posible guardar landing",
      });
    }
  },
);

privateRouter.post(
  "/landing-pages/:landingPageId/versions/html-upload",
  requireAnyPermission(landingUpdatePermissions),
  async (req, res) => {
    let parsedFiles = [];
    try {
      const landingPageId = Number(req.params.landingPageId);
      if (!Number.isInteger(landingPageId) || landingPageId <= 0) {
        return res.status(400).json({ message: "landingPageId invalido" });
      }

      const landingPage = await loadLandingPageById(landingPageId);
      if (!landingPage) {
        return res.status(404).json({ message: "Landing no encontrada" });
      }

      const { fields, files } = await parseMultipartFiles(req);
      parsedFiles = files;
      const rawFiles = Array.isArray(files) ? files : [];
      if (rawFiles.length !== 1) {
        return res
          .status(400)
          .json({ message: "Debes subir exactamente un archivo HTML" });
      }

      const file = rawFiles[0];
      const htmlContent = String(
        (await import("node:fs/promises").then((m) =>
          m.readFile(file.filepath, "utf8"),
        )) || "",
      );
      if (!htmlContent.trim()) {
        return res.status(400).json({ message: "El archivo HTML esta vacio" });
      }

      const formSchema = await parseFormSchemaFromField(fields?.form_schema);

      const inserted = await withTransaction(async (conn) => {
        const [versionRows] = await conn.query(
          `SELECT COALESCE(MAX(version_number), 0) AS max_version
           FROM landing_page_versions
           WHERE landing_page_id = ?`,
          [landingPageId],
        );
        const nextVersion = Number(versionRows[0]?.max_version || 0) + 1;

        const [insertResult] = await conn.query(
          `INSERT INTO landing_page_versions
             (landing_page_id, version_number, source_type, source_url, html_content,
              assets_manifest_json, form_schema_json, publish_notes, is_active, created_by, created_at)
           VALUES (?, ?, 'html_upload', NULL, ?, NULL, ?, NULL, 0, ?, NOW(3))`,
          [
            landingPageId,
            nextVersion,
            htmlContent,
            JSON.stringify(formSchema),
            Number(req.user.id),
          ],
        );

        await conn.query(
          `UPDATE landing_pages
           SET current_version_id = ?, updated_by = ?, updated_at = NOW(3)
           WHERE id = ?`,
          [Number(insertResult.insertId), Number(req.user.id), landingPageId],
        );

        return {
          versionId: Number(insertResult.insertId || 0),
          versionNumber: nextVersion,
        };
      });

      return res.status(201).json({
        version_id: inserted.versionId,
        version_number: inserted.versionNumber,
        source_type: "html_upload",
      });
    } catch (error) {
      return res.status(Number(error?.status) || 500).json({
        message: error?.message || "No fue posible subir HTML",
      });
    } finally {
      if (parsedFiles.length) {
        await cleanupTempFiles(parsedFiles).catch(() => undefined);
      }
    }
  },
);

privateRouter.post(
  "/landing-pages/:landingPageId/confirmation-page/import-url",
  requireAnyPermission(landingUpdatePermissions),
  async (req, res) => {
    const landingPageId = Number(req.params.landingPageId);
    if (!Number.isInteger(landingPageId) || landingPageId <= 0) {
      return res.status(400).json({ message: "landingPageId invalido" });
    }

    const parsed = importUrlSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ message: "source_url invalida" });
    }

    const landingPage = await loadLandingPageById(landingPageId);
    if (!landingPage) {
      return res.status(404).json({ message: "Landing no encontrada" });
    }

    try {
      const html = await fetchUrlHtml(parsed.data.source_url);
      return res.status(200).json({
        html_content: html,
        source_url: parsed.data.source_url,
      });
    } catch (error) {
      return res.status(Number(error?.status) || 500).json({
        message: error?.message || "No fue posible importar URL",
      });
    }
  },
);

privateRouter.post(
  "/landing-pages/:landingPageId/import-url",
  requireAnyPermission(landingUpdatePermissions),
  async (req, res) => {
    const landingPageId = Number(req.params.landingPageId);
    if (!Number.isInteger(landingPageId) || landingPageId <= 0) {
      return res.status(400).json({ message: "landingPageId invalido" });
    }

    const parsed = importUrlSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ message: "source_url invalida" });
    }

    const landingPage = await loadLandingPageById(landingPageId);
    if (!landingPage) {
      return res.status(404).json({ message: "Landing no encontrada" });
    }

    const alreadyImportedRows = await query(
      `SELECT id
       FROM landing_import_runs
       WHERE landing_page_id = ?
         AND import_status = 'success'
       LIMIT 1`,
      [landingPageId],
    );
    if (alreadyImportedRows.length && !parsed.data.force) {
      return res.status(409).json({
        message: "La importacion por URL solo se permite una vez por landing",
      });
    }

    try {
      const html = await fetchUrlHtml(parsed.data.source_url);
      const diagnostics = {
        scripts_detected: (html.match(/<script\b/gi) || []).length,
        warnings: [],
      };

      const sourceHash = createHash("sha256").update(html).digest("hex");

      const inserted = await withTransaction(async (conn) => {
        const [versionRows] = await conn.query(
          `SELECT COALESCE(MAX(version_number), 0) AS max_version
           FROM landing_page_versions
           WHERE landing_page_id = ?`,
          [landingPageId],
        );
        const nextVersion = Number(versionRows[0]?.max_version || 0) + 1;

        const [baseVersionRows] = await conn.query(
          `SELECT form_schema_json
           FROM landing_page_versions
           WHERE landing_page_id = ?
           ORDER BY version_number DESC
           LIMIT 1`,
          [landingPageId],
        );

        const fallbackSchema =
          baseVersionRows[0]?.form_schema_json &&
          typeof baseVersionRows[0].form_schema_json === "string"
            ? JSON.parse(baseVersionRows[0].form_schema_json)
            : baseVersionRows[0]?.form_schema_json || {
                form_schema_version: 1,
                submit: {
                  button_text: "Registrarme",
                  success_message: "Gracias por registrarte",
                  redirect_url: null,
                },
                fields: [
                  {
                    key: "email",
                    label: "Correo",
                    type: "email",
                    required: true,
                    placeholder: "correo@empresa.com",
                    default_value: null,
                    options: [],
                    validation: {
                      min_length: 5,
                      max_length: 180,
                      regex: null,
                    },
                    crm_map: {
                      entity: "contact",
                      field: "email",
                      required_for_entity: true,
                    },
                  },
                ],
              };

        validateFormSchema(fallbackSchema);

        const [insertVersionResult] = await conn.query(
          `INSERT INTO landing_page_versions
             (landing_page_id, version_number, source_type, source_url, html_content,
              assets_manifest_json, form_schema_json, publish_notes, is_active, created_by, created_at)
           VALUES (?, ?, 'url_import_once', ?, ?, NULL, ?, NULL, 0, ?, NOW(3))`,
          [
            landingPageId,
            nextVersion,
            parsed.data.source_url,
            html,
            JSON.stringify(fallbackSchema),
            Number(req.user.id),
          ],
        );

        const versionId = Number(insertVersionResult.insertId || 0);

        await conn.query(
          `UPDATE landing_pages
           SET current_version_id = ?, updated_by = ?, updated_at = NOW(3)
           WHERE id = ?`,
          [versionId, Number(req.user.id), landingPageId],
        );

        const [importResult] = await conn.query(
          `INSERT INTO landing_import_runs
             (landing_page_id, source_url, fetched_at, html_hash, import_status, diagnostics_json)
           VALUES (?, ?, NOW(3), ?, 'success', ?)`,
          [
            landingPageId,
            parsed.data.source_url,
            sourceHash,
            JSON.stringify(diagnostics),
          ],
        );

        return {
          versionId,
          versionNumber: nextVersion,
          importRunId: Number(importResult.insertId || 0),
        };
      });

      return res.status(201).json({
        version_id: inserted.versionId,
        version_number: inserted.versionNumber,
        source_type: "url_import_once",
        import_run_id: inserted.importRunId,
        diagnostics,
      });
    } catch (error) {
      return res.status(Number(error?.status) || 500).json({
        message: error?.message || "No fue posible importar URL",
      });
    }
  },
);

privateRouter.patch(
  "/landing-pages/:landingPageId/versions/:versionId",
  requireAnyPermission(landingUpdatePermissions),
  async (req, res) => {
    const landingPageId = Number(req.params.landingPageId);
    const versionId = Number(req.params.versionId);
    if (!Number.isInteger(landingPageId) || landingPageId <= 0) {
      return res.status(400).json({ message: "landingPageId invalido" });
    }
    if (!Number.isInteger(versionId) || versionId <= 0) {
      return res.status(400).json({ message: "versionId invalido" });
    }

    const parsed = updateDraftSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const version = await loadLandingVersionById(landingPageId, versionId);
    if (!version) {
      return res.status(404).json({ message: "Version no encontrada" });
    }

    let formSchema = version.form_schema_json;
    if (typeof formSchema === "string") {
      formSchema = JSON.parse(formSchema || "{}");
    }
    if (parsed.data.form_schema !== undefined) {
      try {
        formSchema = validateFormSchema(parsed.data.form_schema);
      } catch (error) {
        return res
          .status(Number(error?.status) || 400)
          .json({ message: error.message });
      }
    }

    const htmlContent =
      parsed.data.html_content !== undefined
        ? String(parsed.data.html_content || "").trim()
        : String(version.html_content || "");

    if (!htmlContent) {
      return res
        .status(400)
        .json({ message: "html_content no puede quedar vacio" });
    }

    await query(
      `UPDATE landing_page_versions
       SET html_content = ?,
           form_schema_json = ?,
           publish_notes = ?,
           created_by = ?,
           created_at = NOW(3)
       WHERE id = ?`,
      [
        htmlContent,
        JSON.stringify(formSchema),
        parsed.data.publish_notes || null,
        Number(req.user.id),
        versionId,
      ],
    );

    return res.json({
      version_id: versionId,
      updated: true,
    });
  },
);

privateRouter.patch(
  "/landing-pages/:landingPageId/confirmation-config",
  requireAnyPermission(landingUpdatePermissions),
  async (req, res) => {
    const landingPageId = Number(req.params.landingPageId);
    if (!Number.isInteger(landingPageId) || landingPageId <= 0) {
      return res.status(400).json({ message: "landingPageId invalido" });
    }

    const parsed = confirmationConfigSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const rows = await query(
      `SELECT id FROM landing_pages WHERE id = ? LIMIT 1`,
      [landingPageId],
    );
    if (!rows.length) {
      return res.status(404).json({ message: "Landing no encontrada" });
    }

    await query(
      `UPDATE landing_pages
       SET confirmation_config_json = ?, updated_by = ?, updated_at = NOW(3)
       WHERE id = ?`,
      [JSON.stringify(parsed.data), Number(req.user.id), landingPageId],
    );

    return res.json({ updated: true });
  },
);

privateRouter.patch(
  "/landing-pages/:landingPageId/security-config",
  requireAnyPermission(landingUpdatePermissions),
  async (req, res) => {
    const landingPageId = Number(req.params.landingPageId);
    if (!Number.isInteger(landingPageId) || landingPageId <= 0) {
      return res.status(400).json({ message: "landingPageId invalido" });
    }

    const parsed = securityConfigSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const rows = await query(
      `SELECT id FROM landing_pages WHERE id = ? LIMIT 1`,
      [landingPageId],
    );
    if (!rows.length) {
      return res.status(404).json({ message: "Landing no encontrada" });
    }

    const normalizedConfig = parseLandingSecurityConfig(parsed.data);

    await query(
      `UPDATE landing_pages
       SET security_config_json = ?, updated_by = ?, updated_at = NOW(3)
       WHERE id = ?`,
      [JSON.stringify(normalizedConfig), Number(req.user.id), landingPageId],
    );

    return res.json({
      updated: true,
      security_config: normalizedConfig,
    });
  },
);

privateRouter.post(
  "/landing-pages/:landingPageId/publish",
  requireAnyPermission(landingPublishPermissions),
  async (req, res) => {
    const landingPageId = Number(req.params.landingPageId);
    if (!Number.isInteger(landingPageId) || landingPageId <= 0) {
      return res.status(400).json({ message: "landingPageId invalido" });
    }

    const parsed = publishSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ message: "version_id invalido" });
    }

    const landingPage = await loadLandingPageById(landingPageId);
    if (!landingPage) {
      return res.status(404).json({ message: "Landing no encontrada" });
    }

    const version = await loadLandingVersionById(
      landingPageId,
      parsed.data.version_id,
    );
    if (!version) {
      return res.status(404).json({ message: "Version no encontrada" });
    }

    try {
      validateFormSchema(
        typeof version.form_schema_json === "string"
          ? JSON.parse(version.form_schema_json || "{}")
          : version.form_schema_json,
      );
    } catch (error) {
      return res
        .status(Number(error?.status) || 400)
        .json({ message: error.message });
    }

    await withTransaction(async (conn) => {
      await conn.query(
        `UPDATE landing_page_versions
         SET is_active = 0
         WHERE landing_page_id = ?`,
        [landingPageId],
      );

      await conn.query(
        `UPDATE landing_page_versions
         SET is_active = 1,
             published_by = ?,
             published_at = NOW(3)
         WHERE id = ?`,
        [Number(req.user.id), Number(parsed.data.version_id)],
      );

      await conn.query(
        `UPDATE landing_pages
         SET status = 'published',
             current_version_id = ?,
             updated_by = ?,
             updated_at = NOW(3)
         WHERE id = ?`,
        [Number(parsed.data.version_id), Number(req.user.id), landingPageId],
      );
    });

    const publicUrl = `/landing/${landingPage.slug}.html`;

    await logAuditEvent({
      req,
      module: "landing",
      action: "published",
      entityType: "landing_page",
      entityId: landingPageId,
      detail: `Landing publicada ${publicUrl}`,
      after: {
        version_id: Number(parsed.data.version_id),
        slug: landingPage.slug,
      },
    });

    return res.json({
      landing_page_id: landingPageId,
      status: "published",
      current_version_id: Number(parsed.data.version_id),
      public_url: publicUrl,
      published_at: new Date().toISOString(),
    });
  },
);

privateRouter.get(
  "/landing-pages",
  requireAnyPermission(landingReadPermissions),
  async (req, res) => {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(
      200,
      Math.max(1, Number(req.query.page_size || 25)),
    );
    const offset = (page - 1) * pageSize;
    const status = String(req.query.status || "").trim();
    const search = String(req.query.search || "").trim();

    const where = ["1 = 1"];
    const params = [];
    if (status) {
      where.push("lp.status = ?");
      params.push(status);
    }
    if (search) {
      where.push(
        "(lp.event_name LIKE ? OR lp.slug LIKE ? OR CAST(lp.event_id AS CHAR) LIKE ?)",
      );
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const items = await query(
      `SELECT lp.id,
              lp.event_id,
              lp.event_name,
              lp.slug,
              lp.status,
              lp.current_version_id,
              lp.updated_at,
              lv.version_number AS current_version_number,
              lv.published_at
       FROM landing_pages lp
       LEFT JOIN landing_page_versions lv ON lv.id = lp.current_version_id
       WHERE ${where.join(" AND ")}
       ORDER BY lp.updated_at DESC, lp.id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );

    const totalRows = await query(
      `SELECT COUNT(*) AS total
       FROM landing_pages lp
       WHERE ${where.join(" AND ")}`,
      params,
    );

    return res.json({
      items: items.map((row) => ({
        id: Number(row.id),
        event_id: Number(row.event_id),
        event_name: row.event_name || "",
        slug: row.slug || "",
        status: row.status || "draft",
        current_version_id:
          row.current_version_id === null
            ? null
            : Number(row.current_version_id),
        current_version_number:
          row.current_version_number === null
            ? null
            : Number(row.current_version_number),
        published_at: row.published_at || null,
        updated_at: row.updated_at || null,
      })),
      pagination: {
        page,
        page_size: pageSize,
        total: Number(totalRows[0]?.total || 0),
      },
    });
  },
);

privateRouter.get(
  "/events/:eventId/landing",
  requireAnyPermission(landingReadPermissions),
  async (req, res) => {
    const eventId = Number(req.params.eventId);
    if (!Number.isInteger(eventId) || eventId <= 0) {
      return res.status(400).json({ message: "eventId invalido" });
    }

    const rows = await query(
      `SELECT id
       FROM landing_pages
       WHERE event_id = ?
       LIMIT 1`,
      [eventId],
    );

    if (!rows.length) {
      return res
        .status(404)
        .json({ message: "Landing no encontrada para el evento" });
    }

    return res.json({
      landing_page_id: Number(rows[0].id),
    });
  },
);

privateRouter.get(
  "/landing-pages/:landingPageId",
  requireAnyPermission(landingReadPermissions),
  async (req, res) => {
    const landingPageId = Number(req.params.landingPageId);
    if (!Number.isInteger(landingPageId) || landingPageId <= 0) {
      return res.status(400).json({ message: "landingPageId invalido" });
    }

    const pageRows = await query(
      `SELECT lp.*
       FROM landing_pages lp
       WHERE lp.id = ?
       LIMIT 1`,
      [landingPageId],
    );
    if (!pageRows.length) {
      return res.status(404).json({ message: "Landing no encontrada" });
    }

    const versionRows = await query(
      `SELECT id, landing_page_id, version_number, source_type, source_url,
              publish_notes, is_active, created_by, created_at, published_by, published_at,
              html_content, form_schema_json
       FROM landing_page_versions
       WHERE landing_page_id = ?
       ORDER BY version_number DESC`,
      [landingPageId],
    );

    return res.json({
      landing_page: pageRows[0],
      versions: versionRows,
    });
  },
);

privateRouter.get(
  "/events/:eventId/submissions",
  requireAnyPermission(landingSubmissionsReadPermissions),
  async (req, res) => {
    const eventId = Number(req.params.eventId);
    if (!Number.isInteger(eventId) || eventId <= 0) {
      return res.status(400).json({ message: "eventId invalido" });
    }

    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(
      200,
      Math.max(1, Number(req.query.page_size || 50)),
    );
    const offset = (page - 1) * pageSize;
    const crmStatus = String(req.query.crm_status || "").trim();
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();
    const userId = Number(req.user?.id || 0) || 0;
    const hasGlobalScope = hasGlobalLandingSubmissionsScope(req.user);

    const where = ["s.event_id = ?"];
    const params = [eventId];
    const accessJoins = hasGlobalScope
      ? ""
      : `LEFT JOIN landing_submission_crm_links lscl_scope ON lscl_scope.submission_id = s.id
       LEFT JOIN interactions i_scope ON i_scope.id = lscl_scope.lead_id
       LEFT JOIN account_owners ao_scope ON ao_scope.account_id = i_scope.account_id AND ao_scope.user_id = ?`;

    if (!hasGlobalScope) {
      params.push(userId);
      where.push(`(
        s.sent_to_leads_by = ?
        OR (
          lscl_scope.submission_id IS NOT NULL
          AND (
            i_scope.seller_user_id = ?
            OR ao_scope.user_id IS NOT NULL
            OR i_scope.created_by = ?
          )
        )
      )`);
      params.push(userId, userId, userId);
    }

    if (crmStatus) {
      where.push("s.crm_processing_status = ?");
      params.push(crmStatus);
    }
    if (from) {
      where.push("DATE(s.submitted_at) >= ?");
      params.push(from);
    }
    if (to) {
      where.push("DATE(s.submitted_at) <= ?");
      params.push(to);
    }

    const items = await query(
      `SELECT s.id AS submission_id,
              DATE_FORMAT(s.submitted_at, '%Y-%m-%d %H:%i:%s.%f') AS submitted_at,
              DATE_FORMAT(s.sent_to_leads_at, '%Y-%m-%d %H:%i:%s.%f') AS sent_to_leads_at,
              s.sent_to_leads_by,
              s.user_notes,
              s.crm_processing_status,
              s.crm_error_message,
              s.payload_raw_json,
              s.payload_normalized_json,
              lv.form_schema_json AS landing_form_schema_json,
              scl.lead_id,
              scl.account_id,
              scl.contact_id,
        i.seller_user_id AS crm_seller_user_id,
        su.full_name AS crm_seller_full_name,
        sb.full_name AS sent_to_leads_by_full_name,
              c.first_name AS crm_contact_first_name,
              c.last_name AS crm_contact_last_name
       FROM landing_submissions s
       LEFT JOIN landing_page_versions lv ON lv.id = s.landing_version_id
       LEFT JOIN landing_submission_crm_links scl ON scl.submission_id = s.id
      LEFT JOIN interactions i ON i.id = scl.lead_id
      LEFT JOIN users su ON su.id = i.seller_user_id
      LEFT JOIN users sb ON sb.id = s.sent_to_leads_by
       LEFT JOIN contacts c ON c.id = scl.contact_id
       ${accessJoins}
       WHERE ${where.join(" AND ")}
       ORDER BY s.submitted_at DESC, s.id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );

    const totalRows = await query(
      `SELECT COUNT(*) AS total
       FROM landing_submissions s
       ${accessJoins}
       WHERE ${where.join(" AND ")}`,
      params,
    );

    return res.json({
      items: items.map((row) => {
        const payloadRaw =
          typeof row.payload_raw_json === "string"
            ? JSON.parse(row.payload_raw_json || "{}")
            : row.payload_raw_json || {};

        return {
          submission_id: Number(row.submission_id),
          submitted_at: normalizeSqlDateTimeToUtcIso(row.submitted_at),
          sent_to_leads_at: normalizeSqlDateTimeToUtcIso(row.sent_to_leads_at),
          sent_to_leads_by:
            row.sent_to_leads_by === null ? null : Number(row.sent_to_leads_by),
          user_notes: String(row.user_notes || "").trim(),
          crm_processing_status: row.crm_processing_status,
          crm_error_message: row.crm_error_message,
          payload_raw: payloadRaw,
          payload_normalized:
            typeof row.payload_normalized_json === "string"
              ? JSON.parse(row.payload_normalized_json || "{}")
              : row.payload_normalized_json || {},
          submission_fields: buildSubmissionFieldEntries(
            payloadRaw,
            row.landing_form_schema_json,
          ),
          crm_links: {
            lead_id: row.lead_id === null ? null : Number(row.lead_id),
            account_id: row.account_id === null ? null : Number(row.account_id),
            contact_id: row.contact_id === null ? null : Number(row.contact_id),
          },
          crm_seller: {
            user_id:
              row.crm_seller_user_id === null
                ? null
                : Number(row.crm_seller_user_id),
            full_name: String(row.crm_seller_full_name || "").trim(),
          },
          sent_to_leads_by_user: {
            full_name: String(row.sent_to_leads_by_full_name || "").trim(),
          },
          crm_contact: {
            first_name: String(row.crm_contact_first_name || "").trim(),
            last_name: String(row.crm_contact_last_name || "").trim(),
          },
        };
      }),
      pagination: {
        page,
        page_size: pageSize,
        total: Number(totalRows[0]?.total || 0),
      },
    });
  },
);

privateRouter.get(
  "/submission-sellers",
  requireAnyPermission(landingSubmissionsReadPermissions),
  async (_req, res) => {
    const rows = await query(
      `SELECT u.id, u.full_name, u.email
       FROM users u
       WHERE u.status = 'active'
       ORDER BY u.full_name ASC, u.id ASC`,
    );

    return res.json({
      items: rows.map((row) => ({
        id: Number(row.id),
        full_name: String(row.full_name || "").trim(),
        email: String(row.email || "").trim(),
      })),
    });
  },
);

privateRouter.patch(
  "/submissions/:submissionId/seller",
  requireAnyPermission(landingSubmissionsReprocessPermissions),
  async (req, res) => {
    const submissionId = Number(req.params.submissionId);
    if (!Number.isInteger(submissionId) || submissionId <= 0) {
      return res.status(400).json({ message: "submissionId invalido" });
    }

    const parsed = submissionSellerSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Payload invalido" });
    }

    const rows = await query(
      `SELECT s.id AS submission_id,
              scl.lead_id
       FROM landing_submissions s
       LEFT JOIN landing_submission_crm_links scl ON scl.submission_id = s.id
       WHERE s.id = ?
       LIMIT 1`,
      [submissionId],
    );
    const submission = rows[0] || null;
    if (!submission) {
      return res.status(404).json({ message: "Submission no encontrado" });
    }

    const leadId = Number(submission.lead_id || 0);
    if (!leadId) {
      return res.status(409).json({
        message:
          "Este registro aun no esta vinculado a un lead. Envialo a Leads antes de asignar vendedor.",
      });
    }

    const sellerUserId =
      parsed.data.seller_user_id === null
        ? null
        : Number(parsed.data.seller_user_id);

    let sellerPayload = { user_id: null, full_name: "" };

    if (sellerUserId !== null) {
      const sellerRows = await query(
        `SELECT id, full_name
         FROM users
         WHERE id = ?
           AND status = 'active'
         LIMIT 1`,
        [sellerUserId],
      );
      const seller = sellerRows[0] || null;
      if (!seller) {
        return res.status(404).json({ message: "Vendedor no encontrado" });
      }
      sellerPayload = {
        user_id: Number(seller.id),
        full_name: String(seller.full_name || "").trim(),
      };
    }

    const updateResult = await query(
      `UPDATE interactions
       SET seller_user_id = ?
       WHERE id = ?
       LIMIT 1`,
      [sellerUserId, leadId],
    );

    if (!Number(updateResult?.affectedRows || 0)) {
      return res.status(404).json({ message: "Lead relacionado no encontrado" });
    }

    return res.json({
      submission_id: submissionId,
      lead_id: leadId,
      crm_seller: sellerPayload,
      updated: true,
    });
  },
);

privateRouter.post(
  "/submissions/seller/auto-assign",
  requireAnyPermission(landingSubmissionsReprocessPermissions),
  async (req, res) => {
    const parsed = autoAssignSubmissionSellersSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Payload invalido" });
    }

    const requestedSubmissionIds = Array.from(
      new Set(
        parsed.data.submission_ids
          .map((value) => Number(value || 0))
          .filter((value) => Number.isInteger(value) && value > 0),
      ),
    );

    if (!requestedSubmissionIds.length) {
      return res.status(400).json({ message: "submission_ids invalido" });
    }

    const placeholders = requestedSubmissionIds.map(() => "?").join(", ");
    const rows = await query(
      `SELECT s.id AS submission_id,
              s.payload_normalized_json,
              scl.lead_id,
              i.account_id AS lead_account_id,
              i.seller_user_id AS lead_seller_user_id
       FROM landing_submissions s
       LEFT JOIN landing_submission_crm_links scl ON scl.submission_id = s.id
       LEFT JOIN interactions i ON i.id = scl.lead_id
       WHERE s.id IN (${placeholders})`,
      requestedSubmissionIds,
    );

    const rowBySubmissionId = new Map();
    for (const row of rows) {
      rowBySubmissionId.set(Number(row.submission_id), row);
    }

    const sellerNameCache = new Map();
    const items = [];
    let assignedCount = 0;
    let alreadyAssignedCount = 0;
    let skippedCount = 0;

    for (const submissionId of requestedSubmissionIds) {
      const row = rowBySubmissionId.get(submissionId);
      if (!row) {
        skippedCount += 1;
        items.push({
          submission_id: submissionId,
          updated: false,
          reason: "submission_not_found",
        });
        continue;
      }

      const leadId = Number(row.lead_id || 0);
      if (!leadId) {
        skippedCount += 1;
        items.push({
          submission_id: submissionId,
          lead_id: null,
          updated: false,
          reason: "lead_not_linked",
        });
        continue;
      }

      const currentSellerUserId = Number(row.lead_seller_user_id || 0) || null;

      let normalizedPayload = {};
      try {
        normalizedPayload =
          typeof row.payload_normalized_json === "string"
            ? JSON.parse(row.payload_normalized_json || "{}")
            : row.payload_normalized_json || {};
      } catch {
        normalizedPayload = {};
      }

      const resolvedSellerUserId = await resolveSubmissionSellerUserIdForAutoAssignment(
        {
          normalizedPayload,
          fallbackLeadAccountId: Number(row.lead_account_id || 0) || null,
        },
      );

      if (!resolvedSellerUserId) {
        if (!currentSellerUserId) {
          skippedCount += 1;
          items.push({
            submission_id: submissionId,
            lead_id: leadId,
            updated: false,
            reason: "seller_not_resolved",
          });
          continue;
        }

        const clearResult = await query(
          `UPDATE interactions
           SET seller_user_id = NULL
           WHERE id = ?
           LIMIT 1`,
          [leadId],
        );

        if (!Number(clearResult?.affectedRows || 0)) {
          skippedCount += 1;
          items.push({
            submission_id: submissionId,
            lead_id: leadId,
            updated: false,
            reason: "lead_not_updated",
          });
          continue;
        }

        assignedCount += 1;
        items.push({
          submission_id: submissionId,
          lead_id: leadId,
          updated: true,
          reason: "cleared_no_owner",
          crm_seller: {
            user_id: null,
            full_name: "",
          },
        });
        continue;
      }

      if (currentSellerUserId === resolvedSellerUserId) {
        alreadyAssignedCount += 1;
        items.push({
          submission_id: submissionId,
          lead_id: leadId,
          updated: false,
          reason: "already_matches_rule",
          crm_seller: {
            user_id: resolvedSellerUserId,
            full_name: "",
          },
        });
        continue;
      }

      const updateResult = await query(
        `UPDATE interactions
         SET seller_user_id = ?
         WHERE id = ?
         LIMIT 1`,
        [resolvedSellerUserId, leadId],
      );

      if (!Number(updateResult?.affectedRows || 0)) {
        skippedCount += 1;
        items.push({
          submission_id: submissionId,
          lead_id: leadId,
          updated: false,
          reason: "lead_not_updated",
        });
        continue;
      }

      let sellerFullName = sellerNameCache.get(resolvedSellerUserId) || "";
      if (!sellerNameCache.has(resolvedSellerUserId)) {
        const sellerRows = await query(
          `SELECT full_name
           FROM users
           WHERE id = ?
           LIMIT 1`,
          [resolvedSellerUserId],
        );
        sellerFullName = String(sellerRows[0]?.full_name || "").trim();
        sellerNameCache.set(resolvedSellerUserId, sellerFullName);
      }

      assignedCount += 1;
      items.push({
        submission_id: submissionId,
        lead_id: leadId,
        updated: true,
        reason: "assigned",
        crm_seller: {
          user_id: resolvedSellerUserId,
          full_name: sellerFullName,
        },
      });
    }

    return res.json({
      requested_count: requestedSubmissionIds.length,
      assigned_count: assignedCount,
      already_assigned_count: alreadyAssignedCount,
      skipped_count: skippedCount,
      items,
    });
  },
);

privateRouter.patch(
  "/submissions/:submissionId/notes",
  requireAnyPermission(landingSubmissionsReprocessPermissions),
  async (req, res) => {
    const submissionId = Number(req.params.submissionId);
    if (!Number.isInteger(submissionId) || submissionId <= 0) {
      return res.status(400).json({ message: "submissionId invalido" });
    }

    const parsed = submissionNotesSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Payload invalido" });
    }

    const notesValue = normalizeGenericText(parsed.data.user_notes || "", 8000);

    const updateResult = await query(
      `UPDATE landing_submissions
       SET user_notes = ?,
           notes_updated_by = ?,
           notes_updated_at = NOW(3)
       WHERE id = ?`,
      [notesValue || null, Number(req.user?.id || 0) || null, submissionId],
    );

    if (!Number(updateResult?.affectedRows || 0)) {
      return res.status(404).json({ message: "Submission no encontrado" });
    }

    return res.json({
      submission_id: submissionId,
      user_notes: notesValue || "",
      updated: true,
    });
  },
);

privateRouter.post(
  "/submissions/:submissionId/reprocess",
  requireAnyPermission(landingSubmissionsReprocessPermissions),
  async (req, res) => {
    const submissionId = Number(req.params.submissionId);
    if (!Number.isInteger(submissionId) || submissionId <= 0) {
      return res.status(400).json({ message: "submissionId invalido" });
    }

    const parsed = reprocessSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Payload invalido" });
    }

    const rows = await query(
      `SELECT id
       FROM landing_submissions
       WHERE id = ?
       LIMIT 1`,
      [submissionId],
    );
    if (!rows.length) {
      return res.status(404).json({ message: "Submission no encontrado" });
    }

    await query(
      `UPDATE landing_submissions
       SET crm_processing_status = ?,
           crm_error_message = NULL,
           crm_processed_at = NULL,
           sent_to_leads_at = NOW(3),
           sent_to_leads_by = ?
       WHERE id = ?`,
      [CRM_STATUS_PENDING, Number(req.user?.id || 0) || null, submissionId],
    );

    const workerRunId = `lnd_manual_${Date.now()}_${randomUUID().slice(0, 8)}`;
    try {
      await processSubmissionIntoCrm(submissionId, workerRunId);
    } catch (error) {
      await query(
        `UPDATE landing_submissions
         SET crm_processing_status = ?,
             crm_error_message = ?,
             crm_processed_at = NOW(3)
         WHERE id = ?`,
        [
          CRM_STATUS_FAILED,
          String(
            error?.message || "No fue posible procesar envio de landing",
          ).slice(0, 1000),
          submissionId,
        ],
      ).catch(() => undefined);
    }

    // Continue draining backlog in case there are more pending submissions.
    await processPendingLandingSubmissions();

    return res.status(202).json({
      submission_id: submissionId,
      queued: true,
    });
  },
);

privateRouter.delete(
  "/submissions/:submissionId",
  requireAnyPermission(landingSubmissionsReprocessPermissions),
  async (req, res) => {
    const submissionId = Number(req.params.submissionId);
    if (!Number.isInteger(submissionId) || submissionId <= 0) {
      return res.status(400).json({ message: "submissionId invalido" });
    }

    const rows = await query(
      `SELECT id, event_id, landing_page_id
       FROM landing_submissions
       WHERE id = ?
       LIMIT 1`,
      [submissionId],
    );
    if (!rows.length) {
      return res.status(404).json({ message: "Submission no encontrado" });
    }

    await query(
      `DELETE FROM landing_submissions
       WHERE id = ?`,
      [submissionId],
    );

    await logAuditEvent({
      req,
      module: "landing",
      action: "submission_deleted",
      entityType: "landing_submission",
      entityId: submissionId,
      detail: `Registro eliminado ${submissionId}`,
      before: {
        event_id: Number(rows[0].event_id || 0) || null,
        landing_page_id: Number(rows[0].landing_page_id || 0) || null,
      },
    });

    return res.json({
      submission_id: submissionId,
      deleted: true,
    });
  },
);

publicRouter.get("/landing/:slug.html", async (req, res) => {
  const slug = normalizeSlug(req.params.slug);
  if (!slug) {
    return res.status(404).send("Landing no encontrada");
  }

  const rows = await query(
    `SELECT lp.slug, lv.html_content, lv.source_type
     FROM landing_pages lp
     INNER JOIN landing_page_versions lv ON lv.id = lp.current_version_id
     WHERE lp.slug = ?
       AND lp.status = 'published'
       AND lv.is_active = 1
     LIMIT 1`,
    [slug],
  );

  const landing = rows[0] || null;
  if (!landing) {
    return res.status(404).send("Landing no encontrada");
  }

  const html = renderLandingHtml(
    landing.html_content,
    slug,
    String(landing.source_type || "manual_edit"),
  );
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(html);
});

publicRouter.get("/api/public/landing/v1/:slug/html", async (req, res) => {
  const slug = normalizeSlug(req.params.slug);
  if (!slug) {
    return res.status(404).send("Landing no encontrada");
  }

  const rows = await query(
    `SELECT lp.slug, lv.html_content, lv.source_type
     FROM landing_pages lp
     INNER JOIN landing_page_versions lv ON lv.id = lp.current_version_id
     WHERE lp.slug = ?
       AND lp.status = 'published'
       AND lv.is_active = 1
     LIMIT 1`,
    [slug],
  );

  const landing = rows[0] || null;
  if (!landing) {
    return res.status(404).send("Landing no encontrada");
  }

  const html = renderLandingHtml(
    landing.html_content,
    slug,
    String(landing.source_type || "manual_edit"),
  );
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(html);
});

publicRouter.post("/api/public/landing/v1/:slug/submit", async (req, res) => {
  const slug = normalizeSlug(req.params.slug);
  if (!slug) {
    return res.status(404).json({ message: "Landing no encontrada" });
  }

  const parsed = publicSubmitSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      message: "Payload invalido",
      errors: parsed.error.flatten(),
    });
  }

  const rowSet = await query(
    `SELECT lp.id AS landing_page_id,
            lp.event_id,
            lp.current_version_id,
            lp.confirmation_config_json,
            lp.security_config_json,
            lv.form_schema_json,
            lv.id AS version_id,
            lv.is_active
     FROM landing_pages lp
     INNER JOIN landing_page_versions lv ON lv.id = lp.current_version_id
     WHERE lp.slug = ?
       AND lp.status = 'published'
       AND lv.is_active = 1
     LIMIT 1`,
    [slug],
  );

  const landing = rowSet[0] || null;
  if (!landing) {
    return res.status(404).json({ message: "Landing no encontrada" });
  }

  const securityConfig = parseLandingSecurityConfig(
    landing.security_config_json,
  );

  if (securityConfig.enabled) {
    if (securityConfig.origin_rules.enforce_allowlist) {
      const requestOrigin = normalizeOrigin(req.headers.origin || "");
      if (
        requestOrigin &&
        securityConfig.origin_rules.allowed_origins.length > 0 &&
        !securityConfig.origin_rules.allowed_origins.includes(requestOrigin)
      ) {
        return res.status(403).json({
          message: buildPublicSecurityMessage(
            securityConfig,
            "Origen no permitido para esta landing",
          ),
        });
      }
    }

    if (
      securityConfig.require_user_agent &&
      !String(req.headers["user-agent"] || "").trim()
    ) {
      return res.status(403).json({
        message: buildPublicSecurityMessage(
          securityConfig,
          "Solicitud sin user agent valido",
        ),
      });
    }

    if (securityConfig.rate_limit.enabled) {
      const blockDurationMs =
        Number(securityConfig.rate_limit.block_duration_seconds || 1) * 1000;

      const ipRate = checkSlidingRateLimit(
        landingSubmissionRateLimitBuckets.ipMinute,
        String(req.ip || "unknown").slice(0, 80),
        Number(securityConfig.rate_limit.ip_requests_per_minute || 1),
        60 * 1000,
        blockDurationMs,
      );
      if (ipRate.blocked) {
        return res.status(429).json({
          message: buildPublicSecurityMessage(
            securityConfig,
            "Demasiadas solicitudes. Intenta nuevamente mas tarde.",
          ),
          retry_after_seconds: Number(ipRate.retryAfterSeconds || 60),
        });
      }

      const slugRate = checkSlidingRateLimit(
        landingSubmissionRateLimitBuckets.slugHour,
        String(slug || "").slice(0, 120),
        Number(securityConfig.rate_limit.slug_requests_per_hour || 1),
        60 * 60 * 1000,
        blockDurationMs,
      );
      if (slugRate.blocked) {
        return res.status(429).json({
          message: buildPublicSecurityMessage(
            securityConfig,
            "Demasiadas solicitudes para este evento. Intenta mas tarde.",
          ),
          retry_after_seconds: Number(slugRate.retryAfterSeconds || 60),
        });
      }
    }
  }

  const formData = parsed.data.form_data || {};
  if (
    securityConfig.honeypot_enabled &&
    String(formData.hp_field || "").trim()
  ) {
    return res.status(202).json({
      status: "accepted",
      message: "Gracias por registrarte",
    });
  }

  let formSchema = landing.form_schema_json;
  if (typeof formSchema === "string") {
    formSchema = JSON.parse(formSchema || "{}");
  }

  try {
    validateFormSchema(formSchema);
  } catch (error) {
    return res.status(422).json({
      message: buildPublicSecurityMessage(securityConfig, error.message),
    });
  }

  const fieldsMap = inferFieldMap(formSchema);
  if (securityConfig.enabled) {
    const fieldEntries = Object.entries(formData || {}).filter(
      ([key]) => String(key || "").trim() !== "hp_field",
    );

    if (
      fieldEntries.length >
      Number(securityConfig.payload_rules.max_total_fields || 1)
    ) {
      return res.status(422).json({
        message: buildPublicSecurityMessage(
          securityConfig,
          "El formulario excede el numero maximo de campos permitidos",
        ),
      });
    }

    for (const [rawKey, rawValue] of fieldEntries) {
      const key = String(rawKey || "").trim();
      if (!key) continue;

      if (
        securityConfig.payload_rules.reject_unknown_fields &&
        !fieldsMap.has(key)
      ) {
        return res.status(422).json({
          message: buildPublicSecurityMessage(
            securityConfig,
            `Campo no permitido: ${key}`,
          ),
        });
      }

      const serializedValue =
        typeof rawValue === "string"
          ? rawValue
          : typeof rawValue === "number" || typeof rawValue === "boolean"
            ? String(rawValue)
            : JSON.stringify(rawValue || "");
      if (
        String(serializedValue || "").length >
        Number(securityConfig.payload_rules.max_field_length_default || 10)
      ) {
        return res.status(422).json({
          message: buildPublicSecurityMessage(
            securityConfig,
            `Valor excede el tamano maximo permitido en campo: ${key}`,
          ),
        });
      }
    }
  }

  for (const field of formSchema.fields || []) {
    if (!field?.required) continue;
    const key = String(field?.key || "").trim();
    if (!key) continue;
    if (
      formData[key] === undefined ||
      formData[key] === null ||
      String(formData[key]).trim() === ""
    ) {
      return res.status(422).json({
        message: buildPublicSecurityMessage(
          securityConfig,
          `Campo requerido: ${key}`,
        ),
      });
    }

    const fieldType = String(field.type || "").trim();
    if (fieldType === "email") {
      const email = normalizeEmail(formData[key]);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(422).json({
          message: buildPublicSecurityMessage(
            securityConfig,
            `Correo invalido en campo: ${key}`,
          ),
        });
      }
    }
  }

  const idempotencyKey = String(req.headers["idempotency-key"] || "")
    .trim()
    .slice(0, 120);

  if (
    securityConfig.enabled &&
    securityConfig.idempotency.require_key &&
    !idempotencyKey
  ) {
    return res.status(400).json({
      message: buildPublicSecurityMessage(
        securityConfig,
        "Idempotency-Key es obligatorio para esta landing",
      ),
    });
  }

  if (idempotencyKey) {
    const existingRows = await query(
      `SELECT id, payload_raw_json
       FROM landing_submissions
       WHERE landing_page_id = ?
         AND idempotency_key = ?
       LIMIT 1`,
      [Number(landing.landing_page_id), idempotencyKey],
    );
    if (existingRows[0]) {
      if (
        securityConfig.enabled &&
        securityConfig.idempotency.match_payload_hash
      ) {
        const existingPayloadRaw =
          typeof existingRows[0].payload_raw_json === "string"
            ? (() => {
                try {
                  return JSON.parse(existingRows[0].payload_raw_json || "{}");
                } catch {
                  return {};
                }
              })()
            : existingRows[0].payload_raw_json || {};

        const existingHash = createHash("sha256")
          .update(stableJsonStringify(existingPayloadRaw?.form_data || {}))
          .digest("hex");
        const incomingHash = createHash("sha256")
          .update(stableJsonStringify(formData || {}))
          .digest("hex");

        if (existingHash !== incomingHash) {
          return res.status(409).json({
            message: buildPublicSecurityMessage(
              securityConfig,
              "Idempotency-Key reutilizado con payload diferente",
            ),
          });
        }
      }

      const successPayload = buildPublicSubmitSuccessPayload({
        formSchema,
        confirmationConfig: landing.confirmation_config_json,
      });
      return res.status(201).json({
        submission_id: Number(existingRows[0].id),
        ...successPayload,
      });
    }
  }

  const normalizedPayload = normalizeSubmissionPayload(formData, formSchema);

  const insertResult = await query(
    `INSERT INTO landing_submissions
       (landing_page_id, landing_version_id, event_id, submitted_at, ip_address,
        user_agent, referrer_url, idempotency_key,
        payload_raw_json, payload_normalized_json,
        validation_status, crm_processing_status, crm_error_message)
     VALUES (?, ?, ?, NOW(3), ?, ?, ?, ?, ?, ?, 'valid', ?, NULL)`,
    [
      Number(landing.landing_page_id),
      Number(landing.version_id),
      Number(landing.event_id),
      String(req.ip || "").slice(0, 64),
      String(req.headers["user-agent"] || "").slice(0, 500) || null,
      normalizeGenericText(
        parsed.data.context?.referrer_url ||
          parsed.data.context?.page_url ||
          "",
        1000,
      ) || null,
      idempotencyKey || null,
      JSON.stringify({
        form_data: formData,
        field_keys: Array.from(fieldsMap.keys()),
      }),
      JSON.stringify(normalizedPayload),
      CRM_STATUS_PENDING,
    ],
  );

  const submissionId = Number(insertResult.insertId || 0);

  const successPayload = buildPublicSubmitSuccessPayload({
    formSchema,
    confirmationConfig: landing.confirmation_config_json,
  });

  return res.status(201).json({
    submission_id: submissionId,
    ...successPayload,
  });
});

export default privateRouter;
export { publicRouter };
