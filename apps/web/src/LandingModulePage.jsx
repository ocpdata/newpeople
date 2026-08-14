import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, getApiErrorMessage } from "./api";
import { formatBusinessDateTime } from "./business-timezone";
import "./landing-module.css";

const DEFAULT_FORM_SCHEMA = {
  form_schema_version: 1,
  submit: {
    button_text: "Registrarme",
    success_message: "Gracias por registrarte",
    redirect_url: null,
  },
  fields: [
    {
      key: "first_name",
      label: "Nombre",
      type: "text",
      required: true,
      placeholder: "Tu nombre",
      default_value: null,
      options: [],
      validation: {
        min_length: 2,
        max_length: 120,
        regex: null,
      },
      crm_map: {
        entity: "contact",
        field: "first_name",
        required_for_entity: true,
      },
    },
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
    {
      key: "company_name",
      label: "Empresa",
      type: "text",
      required: false,
      placeholder: "Nombre de empresa",
      default_value: null,
      options: [],
      validation: {
        min_length: 2,
        max_length: 180,
        regex: null,
      },
      crm_map: {
        entity: "account",
        field: "name",
        required_for_entity: false,
      },
    },
  ],
};

const SOURCE_TYPE_DETAILS = {
  manual_edit:
    "Edición directa del HTML y del esquema del formulario desde el editor.",
  ai: "Genera una propuesta inicial con IA para partir de un borrador.",
  html_upload:
    "Importa un archivo HTML existente para reutilizar una landing previa.",
  url_import_once:
    "Captura una landing desde una URL una sola vez para editarla después.",
};

const LANDING_STATUS_LABELS = {
  draft: "Borrador",
  published: "Publicada",
  archived: "Archivada",
};

const DEFAULT_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Landing</title>
    <style>
      body { font-family: 'Segoe UI', Tahoma, sans-serif; margin: 0; background: linear-gradient(135deg,#eff5ff,#f9fbff); color: #123; }
      .wrap { max-width: 860px; margin: 0 auto; padding: 48px 20px 64px; }
      .hero { background: #fff; border: 1px solid #d8e3f5; border-radius: 16px; padding: 28px; box-shadow: 0 16px 36px rgba(18,57,119,.08); }
      h1 { margin: 0 0 10px; color: #133a6f; }
      p { margin: 0 0 16px; color: #36537a; }
      form { display: grid; gap: 12px; margin-top: 20px; }
      input, button { border-radius: 10px; border: 1px solid #b6c9e6; padding: 10px 12px; font-size: 14px; }
      button { background: #0f4d9d; color: #fff; border-color: #0f4d9d; font-weight: 600; cursor: pointer; }
      button:hover { background: #0b3f82; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <section class="hero">
        <h1>Evento</h1>
        <p>Regístrate para asegurar tu lugar.</p>
        <form data-landing-form>
          <input name="first_name" placeholder="Nombre" />
          <input name="email" type="email" placeholder="Correo" />
          <input name="company_name" placeholder="Empresa" />
          <input name="hp_field" type="text" style="display:none" tabindex="-1" autocomplete="off" />
          <button type="submit">Registrarme</button>
        </form>
      </section>
    </div>
  </body>
</html>`;

const DEFAULT_CONFIRMATION_PAGE_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Registro completado</title>
    <style>
      body { font-family: 'Segoe UI', Tahoma, sans-serif; margin: 0; background: linear-gradient(145deg,#f0f7ff,#f8fbff); color: #16345a; }
      .wrap { max-width: 760px; margin: 0 auto; padding: 56px 20px 72px; }
      .card { background: #fff; border: 1px solid #d6e4f7; border-radius: 16px; padding: 28px; box-shadow: 0 16px 38px rgba(20, 55, 101, 0.12); }
      h1 { margin: 0 0 10px; color: #15437a; }
      p { margin: 0 0 14px; color: #36587f; }
      .hint { margin-top: 18px; font-size: 13px; color: #5a7699; }
      .cta { display: inline-block; margin-top: 8px; padding: 10px 14px; border-radius: 10px; background: #0f4d9d; color: #fff; text-decoration: none; font-weight: 700; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <section class="card">
        <h1>Gracias por registrarte</h1>
        <p>Tu registro fue recibido correctamente.</p>
        <p>En breve compartiremos mas detalles del evento en tu correo.</p>
        <a class="cta" href="/">Volver al inicio</a>
        <p class="hint">Puedes personalizar esta pagina desde la configuracion de confirmacion.</p>
      </section>
    </div>
  </body>
</html>`;

const DEFAULT_SECURITY_CONFIG = {
  enabled: false,
  honeypot_enabled: true,
  require_user_agent: false,
  rate_limit: {
    enabled: false,
    ip_requests_per_minute: 30,
    slug_requests_per_hour: 600,
    block_duration_seconds: 300,
  },
  idempotency: {
    require_key: false,
    match_payload_hash: false,
  },
  payload_rules: {
    reject_unknown_fields: false,
    max_field_length_default: 500,
    max_total_fields: 120,
  },
  origin_rules: {
    enforce_allowlist: false,
    allowed_origins: [],
  },
  response_privacy: {
    generic_validation_errors: false,
  },
};

function parseSecurityConfigFromApi(value) {
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

  const allowedOrigins = Array.isArray(raw?.origin_rules?.allowed_origins)
    ? raw.origin_rules.allowed_origins
        .map((entry) => String(entry || "").trim())
        .filter(Boolean)
    : [];

  return {
    enabled:
      raw.enabled !== undefined
        ? Boolean(raw.enabled)
        : DEFAULT_SECURITY_CONFIG.enabled,
    honeypot_enabled:
      raw.honeypot_enabled !== undefined
        ? Boolean(raw.honeypot_enabled)
        : DEFAULT_SECURITY_CONFIG.honeypot_enabled,
    require_user_agent:
      raw.require_user_agent !== undefined
        ? Boolean(raw.require_user_agent)
        : DEFAULT_SECURITY_CONFIG.require_user_agent,
    rate_limit: {
      enabled:
        raw?.rate_limit?.enabled !== undefined
          ? Boolean(raw.rate_limit.enabled)
          : DEFAULT_SECURITY_CONFIG.rate_limit.enabled,
      ip_requests_per_minute: Number(
        raw?.rate_limit?.ip_requests_per_minute ||
          DEFAULT_SECURITY_CONFIG.rate_limit.ip_requests_per_minute,
      ),
      slug_requests_per_hour: Number(
        raw?.rate_limit?.slug_requests_per_hour ||
          DEFAULT_SECURITY_CONFIG.rate_limit.slug_requests_per_hour,
      ),
      block_duration_seconds: Number(
        raw?.rate_limit?.block_duration_seconds ||
          DEFAULT_SECURITY_CONFIG.rate_limit.block_duration_seconds,
      ),
    },
    idempotency: {
      require_key:
        raw?.idempotency?.require_key !== undefined
          ? Boolean(raw.idempotency.require_key)
          : DEFAULT_SECURITY_CONFIG.idempotency.require_key,
      match_payload_hash:
        raw?.idempotency?.match_payload_hash !== undefined
          ? Boolean(raw.idempotency.match_payload_hash)
          : DEFAULT_SECURITY_CONFIG.idempotency.match_payload_hash,
    },
    payload_rules: {
      reject_unknown_fields:
        raw?.payload_rules?.reject_unknown_fields !== undefined
          ? Boolean(raw.payload_rules.reject_unknown_fields)
          : DEFAULT_SECURITY_CONFIG.payload_rules.reject_unknown_fields,
      max_field_length_default: Number(
        raw?.payload_rules?.max_field_length_default ||
          DEFAULT_SECURITY_CONFIG.payload_rules.max_field_length_default,
      ),
      max_total_fields: Number(
        raw?.payload_rules?.max_total_fields ||
          DEFAULT_SECURITY_CONFIG.payload_rules.max_total_fields,
      ),
    },
    origin_rules: {
      enforce_allowlist:
        raw?.origin_rules?.enforce_allowlist !== undefined
          ? Boolean(raw.origin_rules.enforce_allowlist)
          : DEFAULT_SECURITY_CONFIG.origin_rules.enforce_allowlist,
      allowed_origins: allowedOrigins,
    },
    response_privacy: {
      generic_validation_errors:
        raw?.response_privacy?.generic_validation_errors !== undefined
          ? Boolean(raw.response_privacy.generic_validation_errors)
          : DEFAULT_SECURITY_CONFIG.response_privacy.generic_validation_errors,
    },
  };
}

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function parseJsonOrThrow(text, fallbackMessage) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    throw new Error(fallbackMessage);
  }
}

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 120);
}

function cleanTextLine(value, max = 220) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function formatLandingStatus(value) {
  const key = String(value || "")
    .trim()
    .toLowerCase();
  return LANDING_STATUS_LABELS[key] || (key ? key : "-");
}

function formatSubmissionFieldValue(value) {
  if (value === undefined || value === null) return "-";
  if (typeof value === "boolean") return value ? "Si" : "No";
  if (Array.isArray(value)) {
    const text = value
      .map((item) => String(item ?? "").trim())
      .filter(Boolean)
      .join(", ");
    return text || "-";
  }
  if (typeof value === "object") {
    const text = JSON.stringify(value);
    return text.length > 160 ? `${text.slice(0, 157)}...` : text;
  }
  const text = String(value).trim();
  return text || "-";
}

function buildSubmissionFieldEntries(submission) {
  const serverFieldEntries = Array.isArray(submission?.submission_fields)
    ? submission.submission_fields
    : [];
  if (serverFieldEntries.length) {
    return serverFieldEntries.map((entry) => {
      const key = String(entry?.key || "").trim();
      const label = String(entry?.label || key).trim() || key;
      return {
        key,
        label,
        value: formatSubmissionFieldValue(entry?.value),
      };
    });
  }

  const payloadRaw =
    submission?.payload_raw && typeof submission.payload_raw === "object"
      ? submission.payload_raw
      : {};
  const formData =
    payloadRaw?.form_data && typeof payloadRaw.form_data === "object"
      ? payloadRaw.form_data
      : {};
  const rawFieldKeys = Array.isArray(payloadRaw?.field_keys)
    ? payloadRaw.field_keys
    : [];

  const orderedKeys = rawFieldKeys
    .map((key) => String(key || "").trim())
    .filter(Boolean);

  const fallbackKeys = Object.keys(formData)
    .map((key) => String(key || "").trim())
    .filter(Boolean);

  const keys = orderedKeys.length ? orderedKeys : fallbackKeys;
  const uniqueKeys = Array.from(new Set(keys)).filter(
    (key) => key && key !== "hp_field",
  );

  return uniqueKeys.map((key) => ({
    key,
    label: key,
    value: formatSubmissionFieldValue(formData[key]),
  }));
}

const COMPANY_DOMAIN_OVERRIDES = {
  aws: "aws.amazon.com",
  amazon: "amazon.com",
  microsoft: "microsoft.com",
  azure: "azure.microsoft.com",
  google: "google.com",
  gcp: "cloud.google.com",
  ibm: "ibm.com",
  oracle: "oracle.com",
  sap: "sap.com",
  salesforce: "salesforce.com",
  f5: "f5.com",
  cisco: "cisco.com",
  fortinet: "fortinet.com",
  paloalto: "paloaltonetworks.com",
  samsung: "samsung.com",
  hp: "hp.com",
  intel: "intel.com",
  amd: "amd.com",
  dell: "dell.com",
  lenovo: "lenovo.com",
  hpe: "hpe.com",
  vmware: "vmware.com",
  servicenow: "servicenow.com",
  adobe: "adobe.com",
  hubspot: "hubspot.com",
  stripe: "stripe.com",
  shopify: "shopify.com",
  nvidia: "nvidia.com",
};

function normalizeCompanyKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCaseWords(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function extractRequestedLogoCompanies(prompt) {
  const text = String(prompt || "");
  if (!/logo|logotipo/i.test(text)) return [];

  const collected = [];
  const logoClauses = [
    ...text.matchAll(/(?:logos?|logotipos?)\s+(?:de|del|para)\s+([^\n.;:]+)/gi),
    ...text.matchAll(
      /(?:incluir|agregar|anadir|mostrar)\s+([^\n.;:]+?)\s+(?:como\s+)?(?:logos?|logotipos?)/gi,
    ),
  ];

  for (const clauseMatch of logoClauses) {
    const clause = String(clauseMatch[1] || "").trim();
    if (!clause) continue;
    const parts = clause
      .replace(/\s+y\s+/gi, ",")
      .split(",")
      .map((item) => cleanTextLine(item, 80))
      .map((item) => item.replace(/^(de|del|la|el|los|las)\s+/i, "").trim())
      .filter(Boolean);
    collected.push(...parts);
  }

  const normalized = new Set();
  const output = [];
  for (const company of collected) {
    const key = normalizeCompanyKey(company);
    if (!key || normalized.has(key)) continue;
    normalized.add(key);
    output.push(titleCaseWords(company));
  }

  return output.slice(0, 8);
}

function resolveCompanyDomain(companyName) {
  const key = normalizeCompanyKey(companyName).replace(/\s+/g, "");
  if (COMPANY_DOMAIN_OVERRIDES[key]) {
    return COMPANY_DOMAIN_OVERRIDES[key];
  }

  const tokenizedKey = normalizeCompanyKey(companyName).split(" ")[0] || "";
  if (COMPANY_DOMAIN_OVERRIDES[tokenizedKey]) {
    return COMPANY_DOMAIN_OVERRIDES[tokenizedKey];
  }

  const slug = normalizeCompanyKey(companyName).replace(/\s+/g, "");
  return slug ? `${slug}.com` : "example.com";
}

function buildLogoHintLines(prompt) {
  const companies = extractRequestedLogoCompanies(prompt);
  if (!companies.length) return "";

  return companies
    .map((company) => {
      const domain = resolveCompanyDomain(company);
      const logoUrl = `https://logo.clearbit.com/${domain}`;
      const fallbackUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
      return `- ${company}: domain=${domain}; primary=${logoUrl}; fallback=${fallbackUrl}`;
    })
    .join("\n");
}

function extractHtmlFromAssistantText(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const fencedMatch = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : text;

  if (!candidate) return "";
  if (!/<!doctype html>|<html[\s>]|<body[\s>]/i.test(candidate)) return "";
  return candidate;
}

function extractAssistantText(value) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const candidates = [
    value.answer,
    value.content,
    value.text,
    value.html,
    value.message,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return "";
}

function extractJsonObjectFromText(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  const fencedJson = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const directCandidate = fencedJson ? fencedJson[1].trim() : text;
  const candidates = [directCandidate];

  const braceMatch = directCandidate.match(/\{[\s\S]*\}/);
  if (braceMatch && braceMatch[0] !== directCandidate) {
    candidates.push(String(braceMatch[0] || "").trim());
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Keep fallback behavior when the assistant does not return valid JSON.
    }
  }

  return null;
}

function normalizeEmailSubject(value, eventName = "") {
  const normalized = String(value || "")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized) {
    return normalized.slice(0, 300);
  }

  const safeEventName = String(eventName || "").trim();
  return safeEventName
    ? `Confirmamos tu registro en ${safeEventName}`
    : "Confirmamos tu registro";
}

function extractConfirmationEmailDraftFromAssistant(rawValue, eventName = "") {
  const objectSubject =
    rawValue && typeof rawValue === "object"
      ? extractAssistantText(
          rawValue.asunto ||
            rawValue.subject ||
            rawValue.email_subject ||
            rawValue.title,
        )
      : "";

  const fallbackText = extractAssistantText(rawValue);
  const parsed = extractJsonObjectFromText(fallbackText);

  const parsedSubject = parsed
    ? extractAssistantText(
        parsed.asunto ||
          parsed.subject ||
          parsed.email_subject ||
          parsed.title,
      )
    : "";

  const parsedHtml = parsed
    ? extractAssistantText(
        parsed.html ||
          parsed.email_body_html ||
          parsed.body_html ||
          parsed.body ||
          parsed.content,
      )
    : "";

  return {
    subject: normalizeEmailSubject(parsedSubject || objectSubject, eventName),
    html: String(parsedHtml || fallbackText || "").trim(),
  };
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function generateLandingHtmlWithChatbotAi({
  prompt,
  eventName,
  slug,
  formSchema,
  currentHtml,
  onStatus,
  shouldCancel,
}) {
  const throwIfCancelled = () => {
    if (typeof shouldCancel === "function" && shouldCancel()) {
      const error = new Error("Generación con IA cancelada");
      error.code = "AI_GENERATION_CANCELLED";
      throw error;
    }
  };

  throwIfCancelled();

  if (typeof onStatus === "function") {
    onStatus("Iniciando sesion de IA...");
  }

  const sessionRes = await api.post("/api/chatbot/sessions", {
    locale: "es",
    userContext: {
      module: "landing",
      objective: "generate_html_landing",
      eventName: String(eventName || "").trim(),
      slug: String(slug || "").trim(),
    },
  });

  const sessionId = String(sessionRes?.data?.sessionId || "").trim();
  if (!sessionId) {
    throw new Error("No fue posible crear sesion IA");
  }

  throwIfCancelled();

  if (typeof onStatus === "function") {
    onStatus("Enviando instrucciones al asistente...");
  }

  const fields = Array.isArray(formSchema?.fields) ? formSchema.fields : [];
  const baseHtml = String(currentHtml || "").trim();
  const baseHtmlSnippet = baseHtml.slice(0, 1600);
  const promptText = String(prompt || "")
    .trim()
    .slice(0, 2400);
  const logoHints = buildLogoHintLines(promptText);
  const requiredFieldHints = fields
    .slice(0, 10)
    .map((field) => {
      const key = cleanTextLine(field?.key || "", 60);
      const type = cleanTextLine(field?.type || "text", 20);
      if (!key) return "";
      const suffix = field?.required ? " (required)" : "";
      return `- ${key}: ${type}${suffix}`;
    })
    .filter(Boolean)
    .join("\n");

  const aiInstruction = [
    "Edita el HTML existente de una landing page para registro de webinar.",
    "Devuelve una version completa actualizada del HTML (no un fragmento).",
    "Puedes agregar, modificar o eliminar contenido del HTML existente.",
    "Conserva la estructura base y cambia solo lo necesario segun el prompt.",
    "Si el prompt pide logos, crea una seccion visual de logos y usa URLs absolutas https confiables.",
    "Para imagenes de logos usa <img> con width/height, object-fit: contain, loading='lazy' y alt descriptivo.",
    "En logos, usa fallback con onerror a una URL de icono funcional si el logo principal falla.",
    "Responde solo con HTML valido (sin explicaciones, sin markdown).",
    "Incluye formulario con atributo data-landing-form y conserva campo hp_field oculto.",
    "Incluye diseno moderno responsive (desktop y mobile) con CSS inline dentro de <style>.",
    "Usa copy en espanol orientado a conversion.",
    `Evento: ${cleanTextLine(eventName || "Webinar", 180)}`,
    `Slug: ${cleanTextLine(slug || "landing", 120)}`,
    "Campos sugeridos en formulario:",
    requiredFieldHints ||
      "- first_name: text (required)\n- email: email (required)\n- company_name: text",
    logoHints ? "Sugerencias de logos (usar estas URLs):" : "",
    logoHints,
    "Instrucciones del usuario:",
    promptText || "Mejorar propuesta de valor y claridad del CTA.",
    "HTML actual (extracto de referencia):",
    baseHtmlSnippet ||
      "<html><body><form data-landing-form></form></body></html>",
  ].join("\n\n");

  const messageRes = await api.post("/api/chatbot/messages", {
    sessionId,
    message: aiInstruction,
    useContext: true,
    contextSnapshot: {
      module: "landing",
      eventName: String(eventName || "").trim(),
      slug: String(slug || "").trim(),
      currentHtml: baseHtml.slice(0, 50_000),
      prompt: promptText,
    },
    featureCode: "chatbot.assistant",
  });

  const jobId = String(messageRes?.data?.jobId || "").trim();
  if (!jobId) {
    throw new Error("No fue posible iniciar generacion IA");
  }

  throwIfCancelled();

  if (typeof onStatus === "function") {
    onStatus("La IA esta construyendo tu landing...");
  }

  let attempts = 0;
  let jobCompleted = false;
  while (attempts < 35) {
    throwIfCancelled();
    attempts += 1;
    const jobRes = await api.get(
      `/api/chatbot/jobs/${encodeURIComponent(jobId)}`,
    );
    const status = String(jobRes?.data?.status || "queued").trim();

    if (typeof onStatus === "function") {
      if (status === "queued") {
        onStatus("La solicitud esta en cola...");
      } else if (status === "running") {
        onStatus("Generando HTML con IA...");
      }
    }

    if (status === "completed") {
      jobCompleted = true;
      break;
    }

    if (status === "failed" || status === "cancelled") {
      const reason = String(jobRes?.data?.error?.message || "").trim();
      throw new Error(reason || "La IA no pudo generar la landing");
    }

    await delay(1200);
  }

  if (!jobCompleted) {
    throw new Error(
      "La IA no termino de generar la landing en el tiempo esperado. Intenta de nuevo.",
    );
  }

  throwIfCancelled();

  const historyRes = await api.get(
    `/api/chatbot/sessions/${encodeURIComponent(sessionId)}/messages`,
  );
  const messages = Array.isArray(historyRes?.data?.items)
    ? historyRes.data.items
    : [];
  const assistantMessage = [...messages]
    .reverse()
    .find((item) => String(item?.role || "").trim() === "assistant");

  const assistantContent = String(assistantMessage?.content || "").trim();
  const html = extractHtmlFromAssistantText(assistantContent);
  if (!html) {
    throw new Error("La IA no devolvio HTML utilizable");
  }

  if (typeof onStatus === "function") {
    onStatus("Aplicando resultado de IA...");
  }

  return html;
}

export default function LandingModulePage() {
  const [activeTab, setActiveTab] = useState("events");

  const [globalError, setGlobalError] = useState("");
  const [globalSuccess, setGlobalSuccess] = useState("");

  const [isLoadingList, setIsLoadingList] = useState(false);
  const [landingItems, setLandingItems] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [selectedLandingId, setSelectedLandingId] = useState(null);
  const [selectedEventId, setSelectedEventId] = useState(null);

  const [landingDetail, setLandingDetail] = useState(null);
  const [selectedVersionId, setSelectedVersionId] = useState(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  const [newEventName, setNewEventName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newSourceType, setNewSourceType] = useState("manual_edit");
  const [campaignNameOptions, setCampaignNameOptions] = useState([]);

  const [editorHtml, setEditorHtml] = useState(DEFAULT_HTML);
  const [editorFormSchemaText, setEditorFormSchemaText] = useState(
    prettyJson(DEFAULT_FORM_SCHEMA),
  );
  const [importUrl, setImportUrl] = useState("");
  const [uploadFile, setUploadFile] = useState(null);
  const [isSavingEditor, setIsSavingEditor] = useState(false);
  const [isAiPromptModalOpen, setIsAiPromptModalOpen] = useState(false);
  const [aiPromptText, setAiPromptText] = useState("");
  const [isGeneratingWithAi, setIsGeneratingWithAi] = useState(false);
  const [isAiCancelRequested, setIsAiCancelRequested] = useState(false);
  const [aiProgressText, setAiProgressText] = useState(
    "Generando landing con IA...",
  );
  const aiGenerationCancelRef = useRef(false);

  const [submissions, setSubmissions] = useState([]);
  const [isLoadingSubmissions, setIsLoadingSubmissions] = useState(false);
  const [submissionEventQuery, setSubmissionEventQuery] = useState("");
  const [isSubmissionEventPickerOpen, setIsSubmissionEventPickerOpen] =
    useState(false);
  const [submissionTableFilter, setSubmissionTableFilter] = useState("");
  const [submissionSort, setSubmissionSort] = useState({
    key: "submitted_at",
    direction: "desc",
  });
  const [submissionNotesDrafts, setSubmissionNotesDrafts] = useState({});
  const [submissionSellerDrafts, setSubmissionSellerDrafts] = useState({});
  const [submissionSellerOptions, setSubmissionSellerOptions] = useState([]);
  const [isLoadingSubmissionSellers, setIsLoadingSubmissionSellers] =
    useState(false);
  const [savingSubmissionSellerById, setSavingSubmissionSellerById] = useState(
    {},
  );
  const [isApplyingSubmissionSellers, setIsApplyingSubmissionSellers] =
    useState(false);
  const [savingSubmissionNotesById, setSavingSubmissionNotesById] = useState(
    {},
  );
  const [sendingSubmissionById, setSendingSubmissionById] = useState({});
  const [deletingSubmissionById, setDeletingSubmissionById] = useState({});
  const [crmStatusFilter, setCrmStatusFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const DEFAULT_CONFIRMATION_CONFIG = {
    enabled: false,
    response_type: "email",
    email_subject: "",
    email_body_html: "",
    redirect_url: "",
    page_html: "",
  };
  const [confirmationConfig, setConfirmationConfig] = useState(
    DEFAULT_CONFIRMATION_CONFIG,
  );
  const [savedConfirmationConfig, setSavedConfirmationConfig] = useState(
    DEFAULT_CONFIRMATION_CONFIG,
  );
  const [securityConfig, setSecurityConfig] = useState(DEFAULT_SECURITY_CONFIG);
  const [securityAllowedOriginsText, setSecurityAllowedOriginsText] =
    useState("");
  const [isSavingSecurityConfig, setIsSavingSecurityConfig] = useState(false);
  const [isSavingConfirmation, setIsSavingConfirmation] = useState(false);
  const [isGeneratingEmailWithAi, setIsGeneratingEmailWithAi] = useState(false);
  const [confirmationEmailAiPrompt, setConfirmationEmailAiPrompt] =
    useState("");
  const [confirmationPageAiPrompt, setConfirmationPageAiPrompt] = useState("");
  const [
    isGeneratingConfirmationPageWithAi,
    setIsGeneratingConfirmationPageWithAi,
  ] = useState(false);
  const [confirmationPageImportUrl, setConfirmationPageImportUrl] =
    useState("");
  const [confirmationPageUploadFile, setConfirmationPageUploadFile] =
    useState(null);
  const [confirmationWorkspaceTab, setConfirmationWorkspaceTab] =
    useState("email");

  const selectedVersion = useMemo(() => {
    const versions = Array.isArray(landingDetail?.versions)
      ? landingDetail.versions
      : [];
    return (
      versions.find(
        (version) => Number(version.id) === Number(selectedVersionId),
      ) || null
    );
  }, [landingDetail, selectedVersionId]);

  const selectedVersionEditorSnapshot = useMemo(() => {
    if (!selectedVersion) {
      return {
        html: String(DEFAULT_HTML || ""),
        formSchemaText: prettyJson(DEFAULT_FORM_SCHEMA),
      };
    }

    let schemaValue = DEFAULT_FORM_SCHEMA;
    if (typeof selectedVersion.form_schema_json === "string") {
      try {
        schemaValue = JSON.parse(selectedVersion.form_schema_json || "{}");
      } catch {
        schemaValue = DEFAULT_FORM_SCHEMA;
      }
    } else if (
      selectedVersion.form_schema_json &&
      typeof selectedVersion.form_schema_json === "object"
    ) {
      schemaValue = selectedVersion.form_schema_json;
    }

    return {
      html: String(selectedVersion.html_content || DEFAULT_HTML),
      formSchemaText: prettyJson(schemaValue),
    };
  }, [selectedVersion]);

  const isEditorVersionDirty = useMemo(() => {
    if (!selectedVersion) return false;
    return (
      String(editorHtml || "") !== selectedVersionEditorSnapshot.html ||
      String(editorFormSchemaText || "") !==
        selectedVersionEditorSnapshot.formSchemaText
    );
  }, [
    editorFormSchemaText,
    editorHtml,
    selectedVersion,
    selectedVersionEditorSnapshot,
  ]);

  const isSelectedLandingPublished =
    String(landingDetail?.landing_page?.status || "")
      .trim()
      .toLowerCase() === "published";

  const confirmationSupportsEmail = ["email", "both"].includes(
    String(confirmationConfig.response_type || "email")
      .trim()
      .toLowerCase(),
  );
  const confirmationSupportsPage = ["page", "both"].includes(
    String(confirmationConfig.response_type || "email")
      .trim()
      .toLowerCase(),
  );

  useEffect(() => {
    const availableTabs = [
      ...(confirmationSupportsEmail ? ["email"] : []),
      ...(confirmationSupportsPage ? ["page"] : []),
    ];

    if (!availableTabs.includes(confirmationWorkspaceTab)) {
      setConfirmationWorkspaceTab(availableTabs[0] || "email");
    }
  }, [
    confirmationSupportsEmail,
    confirmationSupportsPage,
    confirmationWorkspaceTab,
  ]);

  const selectedPublicUrl = useMemo(() => {
    if (!isSelectedLandingPublished) return "";
    const slug = String(landingDetail?.landing_page?.slug || "").trim();
    if (!slug) return "";
    const apiBaseUrl = String(api.defaults.baseURL || window.location.origin)
      .trim()
      .replace(/\/+$/, "");
    return `${apiBaseUrl}/api/public/landing/v1/${encodeURIComponent(slug)}/html`;
  }, [isSelectedLandingPublished, landingDetail]);

  const nextAutoEventId = useMemo(() => {
    const eventIds = landingItems
      .map((item) => Number(item?.event_id || 0))
      .filter((value) => Number.isInteger(value) && value > 0);
    if (!eventIds.length) return 1;
    return Math.max(...eventIds) + 1;
  }, [landingItems]);

  const submissionFieldColumns = useMemo(() => {
    const byKey = new Map();
    for (const submission of submissions) {
      const fields = buildSubmissionFieldEntries(submission);
      for (const field of fields) {
        const key = String(field?.key || "").trim();
        if (!key || byKey.has(key)) continue;
        byKey.set(key, {
          key,
          label: String(field?.label || key).trim() || key,
        });
      }
    }
    const preferredOrder = {
      first_name: 10,
      last_name: 20,
      email: 30,
    };

    return Array.from(byKey.values())
      .map((column, index) => ({
        column,
        index,
      }))
      .sort((left, right) => {
        const leftPriority =
          preferredOrder[left.column.key] !== undefined
            ? preferredOrder[left.column.key]
            : 1000;
        const rightPriority =
          preferredOrder[right.column.key] !== undefined
            ? preferredOrder[right.column.key]
            : 1000;

        if (leftPriority !== rightPriority) {
          return leftPriority - rightPriority;
        }

        return left.index - right.index;
      })
      .map((entry) => entry.column);
  }, [submissions]);

  const submissionEventOptions = useMemo(() => {
    const seen = new Set();
    const options = [];

    for (const item of landingItems) {
      const eventId = Number(item?.event_id || 0);
      if (!eventId || seen.has(eventId)) continue;
      seen.add(eventId);
      const eventName = String(item?.event_name || "").trim();
      options.push({
        eventId,
        eventName,
        label: eventName || `Evento ${eventId}`,
      });
    }

    return options.sort((left, right) => right.eventId - left.eventId);
  }, [landingItems]);

  const filteredSubmissionEventOptions = useMemo(() => {
    const normalizedQuery = String(submissionEventQuery || "")
      .trim()
      .toLowerCase();

    if (!normalizedQuery) {
      return submissionEventOptions.slice(0, 10);
    }

    return submissionEventOptions
      .filter((entry) =>
        `${entry.eventId} ${entry.eventName} ${entry.label}`
          .toLowerCase()
          .includes(normalizedQuery),
      )
      .slice(0, 10);
  }, [submissionEventOptions, submissionEventQuery]);

  const visibleSubmissions = useMemo(() => {
    const normalizedFilter = String(submissionTableFilter || "")
      .trim()
      .toLowerCase();

    const filtered = submissions.filter((submission) => {
      const submittedFields = buildSubmissionFieldEntries(submission);
      const haystack = [
        formatBusinessDateTime(submission?.submitted_at, { fallback: "" }),
        String(submission?.crm_seller?.full_name || ""),
        String(submission?.sent_to_leads_by_user?.full_name || ""),
        String(submission?.user_notes || ""),
        ...submittedFields.flatMap((field) => [
          String(field?.label || ""),
          String(field?.value || ""),
        ]),
      ]
        .join(" ")
        .toLowerCase();

      return !normalizedFilter || haystack.includes(normalizedFilter);
    });

    const decorated = filtered.map((submission) => {
      const submittedFields = buildSubmissionFieldEntries(submission);
      const fieldByKey = new Map(
        submittedFields.map((entry) => [entry.key, entry.value]),
      );
      return {
        submission,
        fieldByKey,
      };
    });

    decorated.sort((left, right) => {
      const { key, direction } = submissionSort;

      const readValue = (entry) => {
        if (key === "submitted_at") {
          return new Date(entry.submission?.submitted_at || 0).getTime();
        }
        if (key === "seller_name") {
          return String(
            entry.submission?.crm_seller?.full_name ||
              entry.submission?.sent_to_leads_by_user?.full_name ||
              "",
          ).toLowerCase();
        }
        if (key === "user_notes") {
          return String(entry.submission?.user_notes || "").toLowerCase();
        }
        return String(entry.fieldByKey.get(key) || "").toLowerCase();
      };

      const leftValue = readValue(left);
      const rightValue = readValue(right);

      if (typeof leftValue === "number" && typeof rightValue === "number") {
        return direction === "asc"
          ? leftValue - rightValue
          : rightValue - leftValue;
      }

      return direction === "asc"
        ? String(leftValue).localeCompare(String(rightValue), "es", {
            numeric: true,
            sensitivity: "base",
          })
        : String(rightValue).localeCompare(String(leftValue), "es", {
            numeric: true,
            sensitivity: "base",
          });
    });

    return decorated;
  }, [submissionSort, submissionTableFilter, submissions]);

  const submissionSellerApplyTargets = useMemo(() => {
    return visibleSubmissions
      .map(({ submission }) => {
        const submissionId = Number(submission?.submission_id || 0);
        const leadId = Number(submission?.crm_links?.lead_id || 0);
        if (!submissionId || !leadId) return null;

        if (
          !Object.prototype.hasOwnProperty.call(
            submissionSellerDrafts,
            submissionId,
          )
        ) {
          return null;
        }

        const draftValue = String(submissionSellerDrafts[submissionId] || "");
        const nextSellerId = draftValue ? Number(draftValue) : null;
        const currentSellerId = submission?.crm_seller?.user_id
          ? Number(submission.crm_seller.user_id)
          : null;

        if (nextSellerId === currentSellerId) return null;

        return {
          submissionId,
          nextSellerId,
        };
      })
      .filter(Boolean);
  }, [submissionSellerDrafts, visibleSubmissions]);

  const submissionSellerAutoAssignTargets = useMemo(() => {
    return visibleSubmissions
      .map(({ submission }) => {
        const submissionId = Number(submission?.submission_id || 0);
        const leadId = Number(submission?.crm_links?.lead_id || 0);
        if (!submissionId || !leadId) return null;

        // Auto-assign only when there is no explicit manual override in the UI.
        if (
          Object.prototype.hasOwnProperty.call(
            submissionSellerDrafts,
            submissionId,
          )
        ) {
          return null;
        }

        return submissionId;
      })
      .filter(Boolean);
  }, [submissionSellerDrafts, visibleSubmissions]);

  const pushSuccess = useCallback((message) => {
    setGlobalSuccess(message);
    setGlobalError("");
  }, []);

  const pushError = useCallback((message) => {
    setGlobalError(message);
    setGlobalSuccess("");
  }, []);

  const normalizeConfirmationConfig = useCallback(
    (value) => ({
      enabled: Boolean(value?.enabled),
      response_type: String(value?.response_type || "email").trim() || "email",
      email_subject: String(value?.email_subject || ""),
      email_body_html: String(value?.email_body_html || ""),
      redirect_url: String(value?.redirect_url || ""),
      page_html: String(value?.page_html || ""),
    }),
    [],
  );

  const isConfirmationConfigDirty = useMemo(() => {
    const current = normalizeConfirmationConfig(confirmationConfig);
    const saved = normalizeConfirmationConfig(savedConfirmationConfig);
    return JSON.stringify(current) !== JSON.stringify(saved);
  }, [
    confirmationConfig,
    normalizeConfirmationConfig,
    savedConfirmationConfig,
  ]);

  const loadCampaignNameOptions = useCallback(async () => {
    try {
      const { data } = await api.get("/api/campaigns");
      const items = Array.isArray(data?.items) ? data.items : [];
      const names = Array.from(
        new Set(
          items.map((item) => String(item?.name || "").trim()).filter(Boolean),
        ),
      ).sort((left, right) =>
        left.localeCompare(right, "es", { sensitivity: "base" }),
      );
      setCampaignNameOptions(names);
    } catch (error) {
      setCampaignNameOptions([]);
      pushError(
        getApiErrorMessage(
          error,
          "No fue posible cargar campañas para el selector de evento",
        ),
      );
    }
  }, [pushError]);

  const loadLandingList = useCallback(async () => {
    try {
      setIsLoadingList(true);
      const { data } = await api.get("/api/landing/v1/landing-pages", {
        params: {
          page: 1,
          page_size: 100,
          status: statusFilter || undefined,
          search: searchText || undefined,
        },
      });
      const items = Array.isArray(data?.items) ? data.items : [];
      setLandingItems(items);

      if (!selectedLandingId && items[0]?.id) {
        setSelectedLandingId(Number(items[0].id));
        setSelectedEventId(Number(items[0].event_id));
      }
    } catch (error) {
      pushError(
        getApiErrorMessage(error, "No fue posible cargar las landings"),
      );
    } finally {
      setIsLoadingList(false);
    }
  }, [pushError, searchText, selectedLandingId, statusFilter]);

  const loadLandingDetail = useCallback(
    async (landingId) => {
      if (!landingId) return;
      try {
        setIsLoadingDetail(true);
        const { data } = await api.get(
          `/api/landing/v1/landing-pages/${landingId}`,
        );
        setLandingDetail(data || null);
        const currentVersionId = Number(
          data?.landing_page?.current_version_id || 0,
        );
        const versions = Array.isArray(data?.versions) ? data.versions : [];
        const nextVersionId =
          currentVersionId || Number(versions[0]?.id || 0) || null;
        setSelectedVersionId(nextVersionId);

        const currentVersion =
          versions.find(
            (version) => Number(version.id) === Number(nextVersionId),
          ) ||
          versions[0] ||
          null;
        if (currentVersion) {
          setEditorHtml(String(currentVersion.html_content || DEFAULT_HTML));
          const schemaValue =
            typeof currentVersion.form_schema_json === "string"
              ? parseJsonOrThrow(
                  currentVersion.form_schema_json,
                  "Schema JSON invalido en API",
                )
              : currentVersion.form_schema_json || DEFAULT_FORM_SCHEMA;
          setEditorFormSchemaText(prettyJson(schemaValue));
        }

        const rawConfirmation = data?.landing_page?.confirmation_config_json;
        const parsedConfirmation =
          typeof rawConfirmation === "string"
            ? JSON.parse(rawConfirmation || "{}")
            : rawConfirmation || {};
        const normalizedConfirmation = normalizeConfirmationConfig({
          enabled: Boolean(parsedConfirmation.enabled),
          response_type: parsedConfirmation.response_type || "email",
          email_subject: parsedConfirmation.email_subject || "",
          email_body_html: parsedConfirmation.email_body_html || "",
          redirect_url: parsedConfirmation.redirect_url || "",
          page_html: parsedConfirmation.page_html || "",
        });
        setConfirmationConfig(normalizedConfirmation);
        setSavedConfirmationConfig(normalizedConfirmation);

        const parsedSecurity = parseSecurityConfigFromApi(
          data?.landing_page?.security_config_json,
        );
        setSecurityConfig(parsedSecurity);
        setSecurityAllowedOriginsText(
          (parsedSecurity.origin_rules.allowed_origins || []).join("\n"),
        );
      } catch (error) {
        pushError(
          getApiErrorMessage(
            error,
            "No fue posible cargar el detalle de la landing",
          ),
        );
      } finally {
        setIsLoadingDetail(false);
      }
    },
    [normalizeConfirmationConfig, pushError],
  );

  const loadSubmissions = useCallback(async () => {
    if (!selectedEventId) {
      setSubmissions([]);
      setSubmissionNotesDrafts({});
      setSubmissionSellerDrafts({});
      setSavingSubmissionSellerById({});
      setIsApplyingSubmissionSellers(false);
      return;
    }

    try {
      setIsLoadingSubmissions(true);
      const { data } = await api.get(
        `/api/landing/v1/events/${selectedEventId}/submissions`,
        {
          params: {
            page: 1,
            page_size: 100,
            crm_status: crmStatusFilter || undefined,
            from: fromDate || undefined,
            to: toDate || undefined,
          },
        },
      );

      const items = Array.isArray(data?.items) ? data.items : [];
      setSubmissions(items);
      setSubmissionNotesDrafts(
        items.reduce((acc, item) => {
          const submissionId = Number(item?.submission_id || 0);
          if (!submissionId) return acc;
          acc[submissionId] = String(item?.user_notes || "");
          return acc;
        }, {}),
      );
      setSubmissionSellerDrafts(
        {},
      );
      setSavingSubmissionSellerById({});
      setIsApplyingSubmissionSellers(false);
    } catch (error) {
      pushError(
        getApiErrorMessage(
          error,
          "No fue posible cargar los registros del evento",
        ),
      );
    } finally {
      setIsLoadingSubmissions(false);
    }
  }, [crmStatusFilter, fromDate, pushError, selectedEventId, toDate]);

  const loadSubmissionSellerOptions = useCallback(async () => {
    try {
      setIsLoadingSubmissionSellers(true);
      const { data } = await api.get("/api/landing/v1/submission-sellers");
      const items = Array.isArray(data?.items) ? data.items : [];
      setSubmissionSellerOptions(
        items
          .map((item) => ({
            id: Number(item?.id || 0),
            fullName: String(item?.full_name || "").trim(),
            email: String(item?.email || "").trim(),
          }))
          .filter((item) => item.id > 0),
      );
    } catch (error) {
      pushError(
        getApiErrorMessage(
          error,
          "No fue posible cargar la lista de vendedores",
        ),
      );
    } finally {
      setIsLoadingSubmissionSellers(false);
    }
  }, [pushError]);

  useEffect(() => {
    loadLandingList();
  }, [loadLandingList]);

  useEffect(() => {
    loadCampaignNameOptions();
  }, [loadCampaignNameOptions]);

  useEffect(() => {
    if (!selectedLandingId) return;
    loadLandingDetail(selectedLandingId);
  }, [loadLandingDetail, selectedLandingId]);

  useEffect(() => {
    if (activeTab !== "submissions") return;
    loadSubmissions();
    loadSubmissionSellerOptions();
  }, [activeTab, loadSubmissionSellerOptions, loadSubmissions]);

  useEffect(() => {
    if (!selectedEventId) {
      setSubmissionEventQuery("");
      return;
    }

    const option = submissionEventOptions.find(
      (entry) => entry.eventId === Number(selectedEventId),
    );
    setSubmissionEventQuery(option?.label || String(selectedEventId));
  }, [selectedEventId, submissionEventOptions]);

  function onSelectLanding(item) {
    setSelectedLandingId(Number(item.id));
    setSelectedEventId(Number(item.event_id));
    setActiveTab("editor");
    setGlobalError("");
    setGlobalSuccess("");
  }

  function toggleSubmissionSort(key) {
    setSubmissionSort((current) => {
      if (current.key === key) {
        return {
          key,
          direction: current.direction === "asc" ? "desc" : "asc",
        };
      }
      return {
        key,
        direction: key === "submitted_at" ? "desc" : "asc",
      };
    });
  }

  async function handleCreateOrUpsertLanding(event) {
    event.preventDefault();
    setGlobalError("");
    setGlobalSuccess("");

    const eventId = Number(nextAutoEventId || 0);
    if (!Number.isInteger(eventId) || eventId <= 0) {
      pushError("Debes indicar un Event ID válido");
      return;
    }
    if (!String(newEventName || "").trim()) {
      pushError("Debes indicar el nombre del evento");
      return;
    }

    const normalizedSlug = normalizeSlug(newSlug);
    if (!normalizedSlug || normalizedSlug.length < 3) {
      pushError("El slug debe tener al menos 3 caracteres alfanuméricos");
      return;
    }

    let parsedSchema;
    try {
      parsedSchema = parseJsonOrThrow(
        editorFormSchemaText,
        "El schema del formulario no es JSON válido",
      );
    } catch (error) {
      pushError(error.message);
      return;
    }

    try {
      setIsSavingEditor(true);
      const { data } = await api.put(
        `/api/landing/v1/events/${eventId}/landing`,
        {
          eventName: String(newEventName || "").trim(),
          slug: normalizedSlug,
          source_type: newSourceType,
          initial_prompt: null,
          html_content: String(editorHtml || "").trim() || DEFAULT_HTML,
          source_url: null,
          form_schema: parsedSchema,
        },
      );

      const landingId = Number(data?.landing_page?.id || 0);
      if (landingId > 0) {
        setSelectedLandingId(landingId);
        setSelectedEventId(Number(data?.landing_page?.event_id || eventId));
        setActiveTab("editor");
        await loadLandingList();
        await loadLandingDetail(landingId);
      }

      pushSuccess("Landing guardada correctamente");
    } catch (error) {
      pushError(
        getApiErrorMessage(error, "No fue posible crear/actualizar la landing"),
      );
    } finally {
      setIsSavingEditor(false);
    }
  }

  async function handleSaveCurrentVersion() {
    if (!selectedLandingId || !selectedVersionId) {
      pushError("Selecciona una landing y versión para guardar");
      return;
    }

    let parsedSchema;
    try {
      parsedSchema = parseJsonOrThrow(
        editorFormSchemaText,
        "El schema del formulario no es JSON válido",
      );
    } catch (error) {
      pushError(error.message);
      return;
    }

    try {
      setIsSavingEditor(true);
      await api.patch(
        `/api/landing/v1/landing-pages/${selectedLandingId}/versions/${selectedVersionId}`,
        {
          html_content: String(editorHtml || "").trim(),
          form_schema: parsedSchema,
          publish_notes: null,
        },
      );
      await loadLandingDetail(selectedLandingId);
      pushSuccess("Versión actualizada");
    } catch (error) {
      pushError(getApiErrorMessage(error, "No fue posible guardar la versión"));
    } finally {
      setIsSavingEditor(false);
    }
  }

  async function handlePublishVersion() {
    if (!selectedLandingId || !selectedVersionId) {
      pushError("Selecciona una landing y versión para publicar");
      return;
    }

    try {
      setIsSavingEditor(true);
      await api.post(
        `/api/landing/v1/landing-pages/${selectedLandingId}/publish`,
        {
          version_id: Number(selectedVersionId),
        },
      );
      await loadLandingList();
      await loadLandingDetail(selectedLandingId);
      pushSuccess("Landing publicada");
    } catch (error) {
      pushError(
        getApiErrorMessage(error, "No fue posible publicar la landing"),
      );
    } finally {
      setIsSavingEditor(false);
    }
  }

  function handleOpenAiPromptModal() {
    if (!selectedLandingId) {
      pushError("Selecciona una landing antes de usar IA");
      return;
    }

    setAiPromptText((current) => {
      if (String(current || "").trim()) return current;
      return [
        "Objetivo:",
        "Audiencia:",
        "Propuesta de valor:",
        "CTA:",
        "Cambios puntuales sobre el HTML actual:",
      ].join("\n");
    });
    setIsAiPromptModalOpen(true);
  }

  async function handleGenerateLandingWithAiInstructions(initialPrompt) {
    if (!selectedLandingId) {
      pushError("Selecciona una landing antes de usar IA");
      return;
    }

    const landingPage = landingDetail?.landing_page || {};
    const eventId = Number(landingPage.event_id || 0);
    const slug = normalizeSlug(landingPage.slug || newSlug);
    const eventName = String(
      landingPage.event_name || newEventName || "",
    ).trim();

    if (!Number.isInteger(eventId) || eventId <= 0 || !slug || !eventName) {
      pushError(
        "No se pudo resolver Event ID, nombre del evento o slug para generar con IA",
      );
      return;
    }

    if (!String(initialPrompt).trim()) {
      pushError("Debes escribir instrucciones para IA");
      return;
    }

    let parsedSchema;
    try {
      parsedSchema = parseJsonOrThrow(
        editorFormSchemaText,
        "El schema del formulario no es JSON válido",
      );
    } catch (error) {
      pushError(error.message);
      return;
    }

    let suggestedHtml = "";
    aiGenerationCancelRef.current = false;
    setIsAiCancelRequested(false);

    try {
      setIsGeneratingWithAi(true);
      setAiProgressText("Preparando contexto para IA...");
      suggestedHtml = await generateLandingHtmlWithChatbotAi({
        prompt: initialPrompt,
        eventName,
        slug,
        formSchema: parsedSchema,
        currentHtml: String(
          selectedVersion?.html_content || editorHtml || "",
        ).trim(),
        onStatus: (message) => {
          if (String(message || "").trim()) {
            setAiProgressText(String(message).trim());
          }
        },
        shouldCancel: () => aiGenerationCancelRef.current,
      });
    } catch (error) {
      const wasCancelled =
        aiGenerationCancelRef.current ||
        String(error?.code || "").trim() === "AI_GENERATION_CANCELLED";
      if (wasCancelled) {
        pushError("Generación con IA cancelada");
        return;
      }

      const errorMessage =
        String(error?.message || "").trim() ||
        "No fue posible generar HTML con IA";
      pushError(errorMessage);
      return;
    } finally {
      setIsGeneratingWithAi(false);
      setAiProgressText("Generando landing con IA...");
    }

    if (aiGenerationCancelRef.current) {
      pushError("Generación con IA cancelada");
      return;
    }

    try {
      setIsSavingEditor(true);
      setEditorHtml(suggestedHtml);
      await api.put(`/api/landing/v1/events/${eventId}/landing`, {
        eventName,
        slug,
        source_type: "ai",
        initial_prompt: String(initialPrompt).trim(),
        html_content: suggestedHtml,
        source_url: null,
        form_schema: parsedSchema,
      });

      await loadLandingList();
      await loadLandingDetail(selectedLandingId);
      pushSuccess("HTML generado por IA y guardado como nueva versión");
    } catch (error) {
      pushError(
        getApiErrorMessage(error, "No fue posible guardar instrucciones de IA"),
      );
    } finally {
      setIsSavingEditor(false);
    }
  }

  function handleCancelAiGeneration() {
    aiGenerationCancelRef.current = true;
    setIsAiCancelRequested(true);
    setAiProgressText("Cancelando generación...");
  }

  function handleCloseAiPromptModal() {
    if (isGeneratingWithAi) return;
    setIsAiPromptModalOpen(false);
  }

  async function handleSubmitAiPrompt(event) {
    event.preventDefault();
    const prompt = String(aiPromptText || "").trim();
    if (!prompt) {
      pushError("Debes escribir instrucciones para IA");
      return;
    }

    setIsAiPromptModalOpen(false);
    await handleGenerateLandingWithAiInstructions(prompt);
  }

  async function handleSaveConfirmationConfig() {
    if (!selectedLandingId) return;

    const normalizedConfirmation = normalizeConfirmationConfig(
      confirmationConfig,
    );

    try {
      setIsSavingConfirmation(true);
      await api.patch(
        `/api/landing/v1/landing-pages/${selectedLandingId}/confirmation-config`,
        {
          enabled: normalizedConfirmation.enabled,
          response_type: normalizedConfirmation.response_type || "email",
          email_subject: normalizedConfirmation.email_subject || null,
          email_body_html: normalizedConfirmation.email_body_html || null,
          redirect_url: normalizedConfirmation.redirect_url || null,
          page_html: normalizedConfirmation.page_html || null,
        },
      );
      setSavedConfirmationConfig(normalizedConfirmation);
      pushSuccess("Configuración de respuesta guardada");
    } catch (error) {
      pushError(
        getApiErrorMessage(error, "No fue posible guardar la configuración"),
      );
    } finally {
      setIsSavingConfirmation(false);
    }
  }

  async function handleSaveSecurityConfig() {
    if (!selectedLandingId) return;

    const allowedOrigins = String(securityAllowedOriginsText || "")
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean);

    try {
      setIsSavingSecurityConfig(true);
      await api.patch(
        `/api/landing/v1/landing-pages/${selectedLandingId}/security-config`,
        {
          enabled: Boolean(securityConfig.enabled),
          honeypot_enabled: Boolean(securityConfig.honeypot_enabled),
          require_user_agent: Boolean(securityConfig.require_user_agent),
          rate_limit: {
            enabled: Boolean(securityConfig.rate_limit?.enabled),
            ip_requests_per_minute: Number(
              securityConfig.rate_limit?.ip_requests_per_minute || 30,
            ),
            slug_requests_per_hour: Number(
              securityConfig.rate_limit?.slug_requests_per_hour || 600,
            ),
            block_duration_seconds: Number(
              securityConfig.rate_limit?.block_duration_seconds || 300,
            ),
          },
          idempotency: {
            require_key: Boolean(securityConfig.idempotency?.require_key),
            match_payload_hash: Boolean(
              securityConfig.idempotency?.match_payload_hash,
            ),
          },
          payload_rules: {
            reject_unknown_fields: Boolean(
              securityConfig.payload_rules?.reject_unknown_fields,
            ),
            max_field_length_default: Number(
              securityConfig.payload_rules?.max_field_length_default || 500,
            ),
            max_total_fields: Number(
              securityConfig.payload_rules?.max_total_fields || 120,
            ),
          },
          origin_rules: {
            enforce_allowlist: Boolean(
              securityConfig.origin_rules?.enforce_allowlist,
            ),
            allowed_origins: allowedOrigins,
          },
          response_privacy: {
            generic_validation_errors: Boolean(
              securityConfig.response_privacy?.generic_validation_errors,
            ),
          },
        },
      );

      await loadLandingDetail(selectedLandingId);
      pushSuccess("Configuración de seguridad guardada");
    } catch (error) {
      pushError(
        getApiErrorMessage(
          error,
          "No fue posible guardar la configuración de seguridad",
        ),
      );
    } finally {
      setIsSavingSecurityConfig(false);
    }
  }

  async function handleGenerateEmailWithAi() {
    if (!selectedLandingId) {
      pushError("Selecciona una landing antes de usar IA");
      return;
    }

    const landingPage = landingDetail?.landing_page || {};
    const eventName = String(
      landingPage.event_name || newEventName || "",
    ).trim();
    const prompt = String(confirmationEmailAiPrompt || "").trim();
    if (!prompt) {
      pushError("Escribe instrucciones para que la IA genere el correo");
      return;
    }

    try {
      setIsGeneratingEmailWithAi(true);

      const sessionRes = await api.post("/api/chatbot/sessions", {
        locale: "es",
        userContext: {
          module: "landing",
          objective: "generate_confirmation_email",
          eventName,
        },
      });
      const sessionId = String(sessionRes?.data?.sessionId || "").trim();
      if (!sessionId) throw new Error("No fue posible crear sesión IA");

      const aiInstruction = [
        "Genera un correo de confirmación de registro en HTML para enviar al asistente.",
        'Devuelve SOLO JSON válido con esta estructura: {"asunto":"...","html":"..."}.',
        "No agregues markdown ni texto fuera del JSON.",
        "Debe ser un HTML limpio, responsive, profesional y en español.",
        "Incluye: saludo personalizado con {first_name}, confirmación de registro, nombre del evento, CTA de agregar al calendario si aplica.",
        `Evento: ${eventName || "Evento"}`,
        "Instrucciones adicionales del usuario:",
        prompt,
      ].join("\n\n");

      const messageRes = await api.post("/api/chatbot/messages", {
        sessionId,
        message: aiInstruction,
        useContext: false,
        featureCode: "chatbot.assistant",
      });

      const jobId = String(messageRes?.data?.jobId || "").trim();
      if (!jobId) throw new Error("No fue posible iniciar generación IA");

      let attempts = 0;
      while (attempts < 35) {
        attempts += 1;
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const jobRes = await api.get(
          `/api/chatbot/jobs/${encodeURIComponent(jobId)}`,
        );
        const status = String(jobRes?.data?.status || "queued").trim();
        if (status === "completed") {
          let generatedPayload = jobRes?.data?.reply || jobRes?.data?.result;
          let generatedText = extractAssistantText(generatedPayload);

          if (!generatedText) {
            const historyRes = await api.get(
              `/api/chatbot/sessions/${encodeURIComponent(sessionId)}/messages`,
            );
            const items = Array.isArray(historyRes?.data?.items)
              ? historyRes.data.items
              : [];
            const assistantMessage = [...items]
              .reverse()
              .find((entry) => String(entry?.role || "") === "assistant");
            generatedPayload = assistantMessage?.content || "";
            generatedText = extractAssistantText(generatedPayload);
          }

          const draft = extractConfirmationEmailDraftFromAssistant(
            generatedPayload,
            eventName,
          );

          if (draft.html) {
            setConfirmationConfig((prev) => ({
              ...prev,
              email_subject: draft.subject,
              email_body_html: draft.html,
            }));
            pushSuccess("Asunto y correo generados por IA");
          } else {
            pushError("La IA no devolvió contenido");
          }
          return;
        }
        if (status === "failed") {
          throw new Error("La IA no pudo completar la generación");
        }
      }
      throw new Error("Tiempo de espera agotado para IA");
    } catch (error) {
      pushError(
        getApiErrorMessage(error, "No fue posible generar el correo con IA"),
      );
    } finally {
      setIsGeneratingEmailWithAi(false);
    }
  }

  async function handleGenerateConfirmationPageWithAi() {
    if (!selectedLandingId) {
      pushError("Selecciona una landing antes de usar IA");
      return;
    }

    const landingPage = landingDetail?.landing_page || {};
    const eventName = String(
      landingPage.event_name || newEventName || "",
    ).trim();
    const prompt = String(confirmationPageAiPrompt || "").trim();
    if (!prompt) {
      pushError("Escribe instrucciones para generar la pagina de confirmacion");
      return;
    }

    try {
      setIsGeneratingConfirmationPageWithAi(true);

      const sessionRes = await api.post("/api/chatbot/sessions", {
        locale: "es",
        userContext: {
          module: "landing",
          objective: "generate_confirmation_page",
          eventName,
        },
      });
      const sessionId = String(sessionRes?.data?.sessionId || "").trim();
      if (!sessionId) throw new Error("No fue posible crear sesion IA");

      const aiInstruction = [
        "Genera una pagina HTML de confirmacion de registro para mostrar inmediatamente despues del envio del formulario.",
        "Devuelve una pagina HTML completa (doctype, html, head, body), sin markdown y sin explicaciones.",
        "Debe ser responsive, moderna y en espanol.",
        "Incluye mensaje de registro confirmado y siguientes pasos.",
        "Si aplica, agrega un CTA para regresar al sitio o ver agenda.",
        `Evento: ${eventName || "Evento"}`,
        "Instrucciones adicionales del usuario:",
        prompt,
      ].join("\n\n");

      const messageRes = await api.post("/api/chatbot/messages", {
        sessionId,
        message: aiInstruction,
        useContext: false,
        featureCode: "chatbot.assistant",
      });

      const jobId = String(messageRes?.data?.jobId || "").trim();
      if (!jobId) throw new Error("No fue posible iniciar generacion IA");

      let attempts = 0;
      while (attempts < 35) {
        attempts += 1;
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const jobRes = await api.get(
          `/api/chatbot/jobs/${encodeURIComponent(jobId)}`,
        );
        const status = String(jobRes?.data?.status || "queued").trim();
        if (status === "completed") {
          const generated =
            extractAssistantText(jobRes?.data?.reply) ||
            extractAssistantText(jobRes?.data?.result);
          let html = extractHtmlFromAssistantText(generated);

          if (!html) {
            const historyRes = await api.get(
              `/api/chatbot/sessions/${encodeURIComponent(sessionId)}/messages`,
            );
            const items = Array.isArray(historyRes?.data?.items)
              ? historyRes.data.items
              : [];
            const assistantMessage = [...items]
              .reverse()
              .find((entry) => String(entry?.role || "") === "assistant");
            html = extractHtmlFromAssistantText(
              assistantMessage?.content || "",
            );
          }

          if (!html) {
            pushError("La IA no devolvio HTML utilizable");
            return;
          }

          setConfirmationConfig((prev) => ({
            ...prev,
            page_html: html,
          }));
          pushSuccess("Pagina de confirmacion generada con IA");
          return;
        }
        if (status === "failed") {
          throw new Error("La IA no pudo completar la generacion");
        }
      }

      throw new Error("Tiempo de espera agotado para IA");
    } catch (error) {
      pushError(
        getApiErrorMessage(
          error,
          "No fue posible generar la pagina de confirmacion con IA",
        ),
      );
    } finally {
      setIsGeneratingConfirmationPageWithAi(false);
    }
  }

  async function handleImportConfirmationPageUrl(event) {
    event.preventDefault();
    if (!selectedLandingId) {
      pushError("Primero selecciona una landing");
      return;
    }

    const sourceUrl = String(confirmationPageImportUrl || "").trim();
    if (!sourceUrl) {
      pushError("Debes indicar una URL para importar");
      return;
    }

    try {
      setIsSavingConfirmation(true);
      const { data } = await api.post(
        `/api/landing/v1/landing-pages/${selectedLandingId}/confirmation-page/import-url`,
        {
          source_url: sourceUrl,
        },
      );

      const importedHtml = String(data?.html_content || "").trim();
      if (!importedHtml) {
        pushError("No se obtuvo HTML desde la URL indicada");
        return;
      }

      setConfirmationConfig((prev) => ({
        ...prev,
        page_html: importedHtml,
      }));
      setConfirmationPageImportUrl("");
      pushSuccess("URL importada a la pagina de confirmacion");
    } catch (error) {
      pushError(
        getApiErrorMessage(
          error,
          "No fue posible importar la URL para pagina de confirmacion",
        ),
      );
    } finally {
      setIsSavingConfirmation(false);
    }
  }

  async function handleUploadConfirmationPageHtml(event) {
    event.preventDefault();
    if (!confirmationPageUploadFile) {
      pushError("Selecciona un archivo HTML para subir");
      return;
    }

    try {
      setIsSavingConfirmation(true);
      const html = await confirmationPageUploadFile.text();
      const normalized = String(html || "").trim();
      if (!normalized) {
        pushError("El archivo HTML esta vacio");
        return;
      }

      setConfirmationConfig((prev) => ({
        ...prev,
        page_html: normalized,
      }));
      setConfirmationPageUploadFile(null);
      pushSuccess("Archivo HTML cargado para pagina de confirmacion");
    } catch {
      pushError("No fue posible leer el archivo HTML");
    } finally {
      setIsSavingConfirmation(false);
    }
  }

  function handlePreviewConfirmationPage() {
    const htmlToRender = String(
      confirmationConfig.page_html || DEFAULT_CONFIRMATION_PAGE_HTML,
    ).trim();

    if (!htmlToRender) {
      pushError("No hay contenido HTML para previsualizar");
      return;
    }

    try {
      const previewBlob = new Blob([htmlToRender], {
        type: "text/html;charset=utf-8",
      });
      const previewUrl = URL.createObjectURL(previewBlob);

      const tempLink = document.createElement("a");
      tempLink.href = previewUrl;
      tempLink.target = "_blank";
      tempLink.rel = "noopener noreferrer";
      tempLink.style.display = "none";
      document.body.appendChild(tempLink);
      tempLink.click();
      tempLink.remove();

      window.setTimeout(() => {
        URL.revokeObjectURL(previewUrl);
      }, 60_000);
    } catch {
      pushError("No fue posible abrir la vista previa de confirmacion");
    }
  }

  function handlePreviewDraftLanding() {
    const htmlToRender = String(
      selectedVersion?.html_content || editorHtml || "",
    ).trim();
    if (!htmlToRender) {
      pushError("No hay contenido HTML para previsualizar");
      return;
    }

    try {
      const previewBlob = new Blob([htmlToRender], {
        type: "text/html;charset=utf-8",
      });
      const previewUrl = URL.createObjectURL(previewBlob);

      const tempLink = document.createElement("a");
      tempLink.href = previewUrl;
      tempLink.target = "_blank";
      tempLink.rel = "noopener noreferrer";
      tempLink.style.display = "none";
      document.body.appendChild(tempLink);
      tempLink.click();
      tempLink.remove();

      // Allow the new tab to start loading before revoking the object URL.
      window.setTimeout(() => {
        URL.revokeObjectURL(previewUrl);
      }, 60_000);
    } catch {
      pushError("No fue posible abrir la previsualización");
    }
  }

  async function handleImportUrl(event) {
    event.preventDefault();
    if (!selectedLandingId) {
      pushError("Primero selecciona una landing");
      return;
    }
    if (!String(importUrl || "").trim()) {
      pushError("Debes indicar una URL para importar");
      return;
    }

    const sourceUrl = String(importUrl || "").trim();

    try {
      setIsSavingEditor(true);
      const { data } = await api.post(
        `/api/landing/v1/landing-pages/${selectedLandingId}/import-url`,
        {
          source_url: sourceUrl,
        },
      );
      setImportUrl("");
      await loadLandingDetail(selectedLandingId);
      if (data?.version_id) {
        setSelectedVersionId(Number(data.version_id));
      }
      pushSuccess("Importación completada");
    } catch (error) {
      const apiMessage = getApiErrorMessage(
        error,
        "No fue posible importar la URL",
      );
      const requiresForce =
        String(apiMessage || "")
          .toLowerCase()
          .includes("solo se permite una vez por landing") ||
        Number(error?.response?.status) === 409;

      if (requiresForce) {
        const shouldReplace = window.confirm(
          "Esta landing ya tuvo una importación por URL. ¿Deseas reemplazarla con una nueva importación?",
        );
        if (shouldReplace) {
          try {
            const { data } = await api.post(
              `/api/landing/v1/landing-pages/${selectedLandingId}/import-url`,
              {
                source_url: sourceUrl,
                force: true,
              },
            );
            setImportUrl("");
            await loadLandingDetail(selectedLandingId);
            if (data?.version_id) {
              setSelectedVersionId(Number(data.version_id));
            }
            pushSuccess("Importación reemplazada correctamente");
            return;
          } catch (forceError) {
            pushError(
              getApiErrorMessage(
                forceError,
                "No fue posible reemplazar la importación",
              ),
            );
            return;
          }
        }
      }

      pushError(apiMessage);
    } finally {
      setIsSavingEditor(false);
    }
  }

  async function handleUploadHtml(event) {
    event.preventDefault();
    if (!selectedLandingId) {
      pushError("Primero selecciona una landing");
      return;
    }
    if (!uploadFile) {
      pushError("Selecciona un archivo HTML para subir");
      return;
    }

    try {
      setIsSavingEditor(true);
      const payload = new FormData();
      payload.append("file", uploadFile);
      payload.append("form_schema", editorFormSchemaText);
      const { data } = await api.post(
        `/api/landing/v1/landing-pages/${selectedLandingId}/versions/html-upload`,
        payload,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        },
      );

      setUploadFile(null);
      await loadLandingDetail(selectedLandingId);
      if (data?.version_id) {
        setSelectedVersionId(Number(data.version_id));
      }
      pushSuccess("Archivo HTML subido como nueva versión");
    } catch (error) {
      pushError(
        getApiErrorMessage(error, "No fue posible subir el archivo HTML"),
      );
    } finally {
      setIsSavingEditor(false);
    }
  }

  async function handleSendSubmissionToLeads(submissionId) {
    const numericSubmissionId = Number(submissionId || 0);
    if (!numericSubmissionId) return;
    if (sendingSubmissionById[numericSubmissionId]) return;

    const shouldProcess = window.confirm(
      "¿Enviar este registro a Leads ahora? Esta acción intentará crear o actualizar el lead en CRM.",
    );
    if (!shouldProcess) return;

    setSendingSubmissionById((prev) => ({
      ...prev,
      [numericSubmissionId]: true,
    }));

    try {
      const notesSaved = await handleSaveSubmissionNotes(numericSubmissionId, {
        quietSuccess: true,
      });
      if (!notesSaved) {
        return;
      }

      await api.post(
        `/api/landing/v1/submissions/${numericSubmissionId}/reprocess`,
        {
          force: true,
        },
      );
      pushSuccess("Registro enviado a Leads");
      await loadSubmissions();
    } catch (error) {
      pushError(
        getApiErrorMessage(error, "No fue posible enviar el registro a Leads"),
      );
    } finally {
      setSendingSubmissionById((prev) => ({
        ...prev,
        [numericSubmissionId]: false,
      }));
    }
  }

  async function handleSaveSubmissionNotes(
    submissionId,
    { quietSuccess = false } = {},
  ) {
    const numericSubmissionId = Number(submissionId || 0);
    if (!numericSubmissionId) return false;

    const targetSubmission = submissions.find(
      (item) => Number(item?.submission_id) === numericSubmissionId,
    );
    if (!targetSubmission) return false;

    const draftNotes = String(submissionNotesDrafts[numericSubmissionId] || "")
      .trim()
      .slice(0, 8000);
    const currentNotes = String(targetSubmission?.user_notes || "")
      .trim()
      .slice(0, 8000);

    if (draftNotes === currentNotes) {
      return true;
    }

    setSavingSubmissionNotesById((prev) => ({
      ...prev,
      [numericSubmissionId]: true,
    }));
    try {
      const { data } = await api.patch(
        `/api/landing/v1/submissions/${numericSubmissionId}/notes`,
        {
          user_notes: draftNotes,
        },
      );

      const savedNotes = String(data?.user_notes || "");
      setSubmissions((prev) =>
        prev.map((item) =>
          Number(item?.submission_id) === numericSubmissionId
            ? { ...item, user_notes: savedNotes }
            : item,
        ),
      );
      setSubmissionNotesDrafts((prev) => ({
        ...prev,
        [numericSubmissionId]: savedNotes,
      }));
      if (!quietSuccess) {
        pushSuccess("Notas guardadas");
      }
      return true;
    } catch (error) {
      pushError(getApiErrorMessage(error, "No fue posible guardar las notas"));
      return false;
    } finally {
      setSavingSubmissionNotesById((prev) => ({
        ...prev,
        [numericSubmissionId]: false,
      }));
    }
  }

  async function handleUpdateSubmissionSeller(submissionId, rawValue) {
    const numericSubmissionId = Number(submissionId || 0);
    if (!numericSubmissionId) return;
    
    const nextSellerId = String(rawValue || "").trim() ? Number(rawValue) : null;
    
    // Update draft immediately
    setSubmissionSellerDrafts((prev) => ({
      ...prev,
      [numericSubmissionId]: String(rawValue || "").trim(),
    }));

    // Save immediately to server
    setSavingSubmissionSellerById((prev) => ({
      ...prev,
      [numericSubmissionId]: true,
    }));

    try {
      const { data } = await api.patch(
        `/api/landing/v1/submissions/${numericSubmissionId}/seller`,
        {
          seller_user_id: nextSellerId,
        },
      );

      const crmSeller = {
        user_id:
          data?.crm_seller?.user_id === null ||
          data?.crm_seller?.user_id === undefined
            ? null
            : Number(data.crm_seller.user_id),
        full_name: String(data?.crm_seller?.full_name || "").trim(),
      };

      setSubmissions((prev) =>
        prev.map((item) =>
          Number(item?.submission_id) === numericSubmissionId
            ? {
                ...item,
                crm_seller: crmSeller,
              }
            : item,
        ),
      );

      setSubmissionSellerDrafts((prev) => ({
        ...prev,
        [numericSubmissionId]:
          crmSeller.user_id !== null ? String(crmSeller.user_id) : "",
      }));
    } catch (error) {
      pushError(
        getApiErrorMessage(
          error,
          "No fue posible asignar el propietario de la cuenta",
        ),
      );
    } finally {
      setSavingSubmissionSellerById((prev) => ({
        ...prev,
        [numericSubmissionId]: false,
      }));
    }
  }

  async function handleApplySubmissionSellerAssignments() {
    if (isApplyingSubmissionSellers) return;

    const pendingAssignments = submissionSellerApplyTargets;
    const autoAssignTargets = submissionSellerAutoAssignTargets;

    if (!pendingAssignments.length && !autoAssignTargets.length) {
      pushError(
        "No hay registros visibles listos para asignar vendedor",
      );
      return;
    }

    const initialSavingState = [...pendingAssignments, ...autoAssignTargets.map((submissionId) => ({ submissionId }))].reduce((acc, entry) => {
      acc[entry.submissionId] = true;
      return acc;
    }, {});

    setIsApplyingSubmissionSellers(true);
    setSavingSubmissionSellerById((prev) => ({
      ...prev,
      ...initialSavingState,
    }));

    let updatedCount = 0;
    let firstErrorMessage = "";

    for (const assignment of pendingAssignments) {
      try {
        const { data } = await api.patch(
          `/api/landing/v1/submissions/${assignment.submissionId}/seller`,
          {
            seller_user_id: assignment.nextSellerId,
          },
        );

        const crmSeller = {
          user_id:
            data?.crm_seller?.user_id === null ||
            data?.crm_seller?.user_id === undefined
              ? null
              : Number(data.crm_seller.user_id),
          full_name: String(data?.crm_seller?.full_name || "").trim(),
        };

        setSubmissions((prev) =>
          prev.map((item) =>
            Number(item?.submission_id) === assignment.submissionId
              ? {
                  ...item,
                  crm_seller: crmSeller,
                }
              : item,
          ),
        );
        setSubmissionSellerDrafts((prev) => ({
          ...prev,
          [assignment.submissionId]:
            crmSeller.user_id !== null ? String(crmSeller.user_id) : "",
        }));
        updatedCount += 1;
      } catch (error) {
        if (!firstErrorMessage) {
          firstErrorMessage = getApiErrorMessage(
            error,
            "No fue posible actualizar uno o más vendedores",
          );
        }
      } finally {
        setSavingSubmissionSellerById((prev) => ({
          ...prev,
          [assignment.submissionId]: false,
        }));
      }
    }

    if (autoAssignTargets.length) {
      try {
        const { data } = await api.post(
          "/api/landing/v1/submissions/seller/auto-assign",
          {
            submission_ids: autoAssignTargets,
          },
        );

        const assignedItems = Array.isArray(data?.items)
          ? data.items.filter((item) => item?.updated)
          : [];

        if (assignedItems.length) {
          const assignedBySubmission = new Map(
            assignedItems.map((item) => [
              Number(item.submission_id),
              {
                user_id:
                  item?.crm_seller?.user_id === null ||
                  item?.crm_seller?.user_id === undefined
                    ? null
                    : Number(item.crm_seller.user_id),
                full_name: String(item?.crm_seller?.full_name || "").trim(),
              },
            ]),
          );

          setSubmissions((prev) =>
            prev.map((entry) => {
              const submissionId = Number(entry?.submission_id || 0);
              if (!assignedBySubmission.has(submissionId)) return entry;
              return {
                ...entry,
                crm_seller: assignedBySubmission.get(submissionId),
              };
            }),
          );

          setSubmissionSellerDrafts((prev) => {
            const next = { ...prev };
            for (const item of assignedItems) {
              const submissionId = Number(item.submission_id || 0);
              if (submissionId) {
                delete next[submissionId];
              }
            }
            return next;
          });

          updatedCount += assignedItems.length;
        }
      } catch (error) {
        if (!firstErrorMessage) {
          firstErrorMessage = getApiErrorMessage(
            error,
            "No fue posible ejecutar la autoasignacion de vendedores",
          );
        }
      } finally {
        for (const submissionId of autoAssignTargets) {
          setSavingSubmissionSellerById((prev) => ({
            ...prev,
            [submissionId]: false,
          }));
        }
      }
    }

    setIsApplyingSubmissionSellers(false);

    if (firstErrorMessage) {
      if (updatedCount > 0) {
        pushError(
          `Se actualizaron ${updatedCount} registro(s), pero hubo errores: ${firstErrorMessage}`,
        );
      } else {
        pushError(firstErrorMessage);
      }
      return;
    }

    pushSuccess(`Vendedor asignado en ${updatedCount} registro(s)`);
  }

  async function handleDeleteSubmission(submissionId) {
    const numericSubmissionId = Number(submissionId || 0);
    if (!numericSubmissionId) return;
    if (deletingSubmissionById[numericSubmissionId]) return;

    const shouldDelete = window.confirm(
      "¿Eliminar este registro? Esta acción no se puede deshacer.",
    );
    if (!shouldDelete) return;

    setDeletingSubmissionById((prev) => ({
      ...prev,
      [numericSubmissionId]: true,
    }));

    try {
      await api.delete(`/api/landing/v1/submissions/${numericSubmissionId}`);
      pushSuccess("Registro eliminado");
      await loadSubmissions();
    } catch (error) {
      pushError(
        getApiErrorMessage(error, "No fue posible eliminar el registro"),
      );
    } finally {
      setDeletingSubmissionById((prev) => ({
        ...prev,
        [numericSubmissionId]: false,
      }));
    }
  }

  function useVersionInEditor(version) {
    if (!version) return;
    setSelectedVersionId(Number(version.id));
    setEditorHtml(String(version.html_content || DEFAULT_HTML));
    const schemaValue =
      typeof version.form_schema_json === "string"
        ? parseJsonOrThrow(version.form_schema_json, "Schema JSON inválido")
        : version.form_schema_json || DEFAULT_FORM_SCHEMA;
    setEditorFormSchemaText(prettyJson(schemaValue));
  }

  return (
    <div className="landing-module-page">
      <header className="landing-module-head">
        <div>
          <h2>Landing por evento</h2>
          <p>
            Crea, edita y publica landings; captura registros y revisa la
            integración CRM.
          </p>
        </div>
      </header>

      <div
        className="landing-module-tabs"
        role="tablist"
        aria-label="Secciones landing"
      >
        <button
          className={activeTab === "events" ? "is-active" : ""}
          onClick={() => setActiveTab("events")}
        >
          Eventos / Landings
        </button>
        <button
          className={activeTab === "editor" ? "is-active" : ""}
          onClick={() => setActiveTab("editor")}
        >
          Editor / Publicación
        </button>
        <button
          className={activeTab === "security" ? "is-active" : ""}
          onClick={() => setActiveTab("security")}
        >
          Seguridad
        </button>
        <button
          className={activeTab === "submissions" ? "is-active" : ""}
          onClick={() => setActiveTab("submissions")}
        >
          Registros por evento
        </button>
      </div>

      {globalError ? (
        <div className="landing-alert landing-alert-error">
          <span>{globalError}</span>
          <button
            type="button"
            className="landing-alert-close"
            onClick={() => setGlobalError("")}
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>
      ) : null}
      {globalSuccess ? (
        <div className="landing-alert landing-alert-success">
          <span>{globalSuccess}</span>
          <button
            type="button"
            className="landing-alert-close"
            onClick={() => setGlobalSuccess("")}
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>
      ) : null}

      {activeTab === "events" ? (
        <section className="landing-panel">
          <div className="landing-grid-two">
            <article className="landing-card landing-card-with-badge">
              <div className="landing-event-id-badge">
                ID: {nextAutoEventId}
              </div>
              <div className="landing-events-form-head">
                <h3>Crear o actualizar landing por evento</h3>
                <p>
                  Completa los datos base del evento para generar o actualizar
                  su landing.
                </p>
              </div>
              <form
                className="landing-form-grid landing-form-grid-events"
                onSubmit={handleCreateOrUpsertLanding}
              >
                <label>
                  Nombre del evento
                  <select
                    value={newEventName}
                    onChange={(event) => setNewEventName(event.target.value)}
                    required
                  >
                    <option value="" disabled>
                      Selecciona una campaña
                    </option>
                    {campaignNameOptions.map((campaignName) => (
                      <option key={campaignName} value={campaignName}>
                        {campaignName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Slug
                  <input
                    type="text"
                    value={newSlug}
                    onChange={(event) =>
                      setNewSlug(normalizeSlug(event.target.value))
                    }
                    placeholder="evento"
                    required
                  />
                </label>
                <label>
                  Fuente
                  <select
                    value={newSourceType}
                    onChange={(event) => setNewSourceType(event.target.value)}
                  >
                    <option
                      value="manual_edit"
                      title={SOURCE_TYPE_DETAILS.manual_edit}
                    >
                      Edición manual
                    </option>
                    <option value="ai" title={SOURCE_TYPE_DETAILS.ai}>
                      IA
                    </option>
                    <option
                      value="html_upload"
                      title={SOURCE_TYPE_DETAILS.html_upload}
                    >
                      HTML
                    </option>
                    <option
                      value="url_import_once"
                      title={SOURCE_TYPE_DETAILS.url_import_once}
                    >
                      URL
                    </option>
                  </select>
                  <span className="landing-field-detail">
                    {SOURCE_TYPE_DETAILS[newSourceType]}
                  </span>
                </label>
                <div className="landing-form-actions">
                  <button type="submit" disabled={isSavingEditor}>
                    {isSavingEditor ? "Guardando..." : "Guardar landing"}
                  </button>
                </div>
              </form>
            </article>

            <article className="landing-card">
              <h3>Landings registradas</h3>
              <div className="landing-list-filters">
                <input
                  type="text"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Buscar por evento, slug o event id"
                />
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value="">Todos los estados</option>
                  <option value="draft">Borrador</option>
                  <option value="published">Publicada</option>
                </select>
                <button
                  type="button"
                  className="landing-refresh-button"
                  onClick={loadLandingList}
                  disabled={isLoadingList}
                  aria-label={
                    isLoadingList ? "Cargando landings" : "Refrescar landings"
                  }
                  title={
                    isLoadingList ? "Cargando landings" : "Refrescar landings"
                  }
                >
                  <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                    <path d="M4 12a8 8 0 0 1 13.66-5.66V4h2.5v6.5H13.5V8h3.44A6.5 6.5 0 1 0 18.4 16h2.64A8 8 0 0 1 4 12z" />
                  </svg>
                </button>
              </div>

              <div className="landing-list-wrap">
                <table className="landing-table">
                  <thead>
                    <tr>
                      <th>Evento</th>
                      <th>Slug</th>
                      <th>Estado</th>
                      <th>Versión</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {landingItems.length === 0 ? (
                      <tr>
                        <td colSpan={5}>No hay landings registradas</td>
                      </tr>
                    ) : (
                      landingItems.map((item) => (
                        <tr
                          key={item.id}
                          className={
                            Number(selectedLandingId) === Number(item.id)
                              ? "is-selected"
                              : ""
                          }
                        >
                          <td>
                            <strong>{item.event_name}</strong>
                            <div className="landing-muted">
                              Event ID: {item.event_id}
                            </div>
                          </td>
                          <td>{item.slug}</td>
                          <td>{formatLandingStatus(item.status)}</td>
                          <td>
                            {item.current_version_number
                              ? `v${item.current_version_number}`
                              : "-"}
                          </td>
                          <td>
                            <button
                              type="button"
                              onClick={() => onSelectLanding(item)}
                            >
                              Abrir
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          </div>
        </section>
      ) : null}

      {activeTab === "editor" ? (
        <section className="landing-panel">
          <article className="landing-card landing-editor-card">
            <h3>Editor y publicación</h3>
            {!selectedLandingId ? (
              <p className="landing-muted">
                Selecciona una landing desde la pestaña Eventos/Landings.
              </p>
            ) : (
              <>
                <div className="landing-meta-grid">
                  <div>
                    <span className="landing-muted">Evento / Landing</span>
                    <strong>
                      {landingDetail?.landing_page?.event_name || "-"}
                    </strong>
                  </div>
                  <div>
                    <span className="landing-muted">Slug</span>
                    <strong>{landingDetail?.landing_page?.slug || "-"}</strong>
                  </div>
                  <div>
                    <span className="landing-muted">Estado</span>
                    <strong>
                      {formatLandingStatus(landingDetail?.landing_page?.status)}
                    </strong>
                  </div>
                  <div className="landing-meta-version">
                    <span className="landing-muted">Versión</span>
                    <select
                      value={selectedVersionId || ""}
                      onChange={(event) => {
                        const nextId = Number(event.target.value || 0);
                        setSelectedVersionId(nextId || null);
                        const version = (landingDetail?.versions || []).find(
                          (entry) => Number(entry.id) === nextId,
                        );
                        if (version) {
                          useVersionInEditor(version);
                        }
                      }}
                    >
                      {(landingDetail?.versions || []).map((version) => (
                        <option key={version.id} value={version.id}>
                          v{version.version_number} · {version.source_type}
                          {version.is_active ? " · activa" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <section className="landing-editor-section">
                  <div className="landing-editor-section-head">
                    <h4>Landing del evento</h4>
                    <p className="landing-editor-section-description">
                      Edita el HTML principal, ajusta el esquema del formulario
                      y controla publicación y versiones desde un solo flujo.
                    </p>
                  </div>
                  <div className="landing-editor-section-grid">
                    <div className="landing-editor-section-main">
                      <div className="landing-action-group">
                        <span className="landing-action-group-label">
                          Acciones de versión · {" "}
                          {isEditorVersionDirty
                            ? "Cambios pendientes"
                            : "Sin cambios"}
                        </span>
                        <div className="landing-inline-actions landing-editor-actions">
                          <button
                            type="button"
                            onClick={handleSaveCurrentVersion}
                            disabled={
                              isSavingEditor ||
                              isLoadingDetail ||
                              isGeneratingWithAi ||
                              !isEditorVersionDirty
                            }
                          >
                            Guardar versión
                          </button>
                          <button
                            type="button"
                            onClick={handlePublishVersion}
                            disabled={
                              isSavingEditor ||
                              isLoadingDetail ||
                              isGeneratingWithAi
                            }
                          >
                            Publicar
                          </button>
                          <button
                            type="button"
                            className="landing-ai-action landing-ai-action--icon-only"
                            onClick={handleOpenAiPromptModal}
                            disabled={
                              isSavingEditor ||
                              isLoadingDetail ||
                              isGeneratingWithAi
                            }
                            title="Generar con IA"
                            aria-label="Generar con IA"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              width="18"
                              height="18"
                              fill="currentColor"
                              aria-hidden="true"
                              focusable="false"
                            >
                              <path d="M12 2l1.09 3.26L16.5 6l-3.41 1.09L12 10.5l-1.09-3.41L7.5 6l3.41-1.09L12 2zm6 10l.73 2.18L21 15l-2.27.73L18 18l-.73-2.27L15 15l2.27-.73L18 12zm-12 0l.73 2.18L9 15l-2.27.73L6 18l-.73-2.27L3 15l2.27-.73L6 12z" />
                            </svg>
                          </button>
                          {selectedPublicUrl ? (
                            <button
                              type="button"
                              onClick={() =>
                                window.open(
                                  selectedPublicUrl,
                                  "_blank",
                                  "noopener,noreferrer",
                                )
                              }
                            >
                              Ver landig publicada
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={handlePreviewDraftLanding}
                              disabled={
                                isSavingEditor ||
                                isLoadingDetail ||
                                isGeneratingWithAi
                              }
                            >
                              Previsualizar borrador
                            </button>
                          )}
                        </div>
                      </div>

                      <label className="landing-label-block">
                        HTML de la landing
                        <textarea
                          value={editorHtml}
                          onChange={(event) =>
                            setEditorHtml(event.target.value)
                          }
                          rows={14}
                        />
                      </label>

                      <label className="landing-label-block">
                        Form schema (JSON)
                        <textarea
                          value={editorFormSchemaText}
                          onChange={(event) =>
                            setEditorFormSchemaText(event.target.value)
                          }
                          rows={14}
                        />
                      </label>

                      <div className="landing-action-group">
                        <span className="landing-action-group-label">
                          Importar contenido
                        </span>
                        <form
                          className="landing-inline-actions landing-inline-actions-compact"
                          onSubmit={handleImportUrl}
                        >
                          <input
                            type="url"
                            value={importUrl}
                            onChange={(event) =>
                              setImportUrl(event.target.value)
                            }
                            placeholder="https://sitio.com/landing"
                          />
                          <button type="submit" disabled={isSavingEditor}>
                            Importar URL
                          </button>
                        </form>

                        <form
                          className="landing-inline-actions landing-inline-actions-compact"
                          onSubmit={handleUploadHtml}
                        >
                          <input
                            type="file"
                            accept=".html,text/html"
                            onChange={(event) =>
                              setUploadFile(event.target.files?.[0] || null)
                            }
                          />
                          <button type="submit" disabled={isSavingEditor}>
                            Subir HTML como nueva versión
                          </button>
                        </form>
                      </div>
                    </div>

                    <div className="landing-editor-section-preview">
                      <h5>Vista previa landing</h5>
                      <div className="landing-preview-wrap">
                        <iframe
                          title="Vista previa landing"
                          srcDoc={editorHtml || DEFAULT_HTML}
                          sandbox="allow-forms allow-same-origin allow-scripts"
                        />
                      </div>
                      {selectedVersion ? (
                        <p className="landing-muted">
                          Versión seleccionada: v
                          {selectedVersion.version_number} ·{" "}
                          {selectedVersion.source_type}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </section>

                <section className="landing-editor-section">
                  <div className="landing-editor-section-head">
                    <h4>Confirmación de registro (correo/página)</h4>
                    <p className="landing-editor-section-description">
                      Define qué sucede después del registro: correo, página o
                      ambos, con edición manual, IA y previsualización.
                    </p>
                  </div>
                  <div className="landing-editor-section-grid">
                    <div className="landing-editor-section-main">
                      <fieldset className="landing-confirmation-config-section">
                        <legend>Configuración</legend>
                        <label className="landing-checkbox-label">
                          <input
                            type="checkbox"
                            checked={confirmationConfig.enabled}
                            onChange={(event) =>
                              setConfirmationConfig((prev) => ({
                                ...prev,
                                enabled: event.target.checked,
                              }))
                            }
                          />
                          Enviar respuesta a registrados
                        </label>

                        {confirmationConfig.enabled ? (
                          <>
                            <label className="landing-label-block">
                              Tipo de respuesta
                              <select
                                value={
                                  confirmationConfig.response_type || "email"
                                }
                                onChange={(event) =>
                                  setConfirmationConfig((prev) => ({
                                    ...prev,
                                    response_type: event.target.value,
                                  }))
                                }
                              >
                                <option value="email">Correo</option>
                                <option value="page">Página</option>
                                <option value="both">
                                  Ambos (correo + página)
                                </option>
                              </select>
                            </label>

                            <div className="landing-confirmation-tabs">
                              {confirmationSupportsEmail ? (
                                <button
                                  type="button"
                                  className={
                                    confirmationWorkspaceTab === "email"
                                      ? "is-active"
                                      : ""
                                  }
                                  onClick={() =>
                                    setConfirmationWorkspaceTab("email")
                                  }
                                >
                                  Correo
                                </button>
                              ) : null}
                              {confirmationSupportsPage ? (
                                <button
                                  type="button"
                                  className={
                                    confirmationWorkspaceTab === "page"
                                      ? "is-active"
                                      : ""
                                  }
                                  onClick={() =>
                                    setConfirmationWorkspaceTab("page")
                                  }
                                >
                                  Página
                                </button>
                              ) : null}
                            </div>

                            {confirmationWorkspaceTab === "email" &&
                            confirmationSupportsEmail ? (
                              <div className="landing-confirmation-pane">
                                <label className="landing-label-block">
                                  Asunto del correo
                                  <input
                                    type="text"
                                    value={
                                      confirmationConfig.email_subject || ""
                                    }
                                    onChange={(event) =>
                                      setConfirmationConfig((prev) => ({
                                        ...prev,
                                        email_subject: event.target.value,
                                      }))
                                    }
                                    placeholder="ej: Confirmamos tu registro en [Evento]"
                                  />
                                </label>

                                <label className="landing-label-block">
                                  Cuerpo del correo (HTML)
                                  <div className="landing-editor-with-ai">
                                    <textarea
                                      value={
                                        confirmationConfig.email_body_html || ""
                                      }
                                      onChange={(event) =>
                                        setConfirmationConfig((prev) => ({
                                          ...prev,
                                          email_body_html: event.target.value,
                                        }))
                                      }
                                      rows={8}
                                      placeholder="<p>Hola {first_name},</p>..."
                                    />
                                    <div className="landing-ai-email-actions">
                                      <input
                                        type="text"
                                        value={confirmationEmailAiPrompt || ""}
                                        onChange={(event) =>
                                          setConfirmationEmailAiPrompt(
                                            event.target.value,
                                          )
                                        }
                                        placeholder="ej: Incluir CTA para agregar al calendario"
                                      />
                                      <button
                                        type="button"
                                        className="landing-ai-action landing-ai-action--icon-only"
                                        onClick={handleGenerateEmailWithAi}
                                        disabled={
                                          isGeneratingEmailWithAi ||
                                          isSavingConfirmation
                                        }
                                        title="Generar con IA"
                                        aria-label="Generar con IA"
                                      >
                                        <svg
                                          viewBox="0 0 24 24"
                                          width="18"
                                          height="18"
                                          fill="currentColor"
                                          aria-hidden="true"
                                          focusable="false"
                                        >
                                          <path d="M12 2l1.09 3.26L16.5 6l-3.41 1.09L12 10.5l-1.09-3.41L7.5 6l3.41-1.09L12 2zm6 10l.73 2.18L21 15l-2.27.73L18 18l-.73-2.27L15 15l2.27-.73L18 12zm-12 0l.73 2.18L9 15l-2.27.73L6 18l-.73-2.27L3 15l2.27-.73L6 12z" />
                                        </svg>
                                      </button>
                                    </div>
                                  </div>
                                </label>
                              </div>
                            ) : null}

                            {confirmationWorkspaceTab === "page" &&
                            confirmationSupportsPage ? (
                              <div className="landing-confirmation-pane">
                                <label className="landing-label-block">
                                  URL de redireccion (opcional)
                                  <input
                                    type="url"
                                    value={
                                      confirmationConfig.redirect_url || ""
                                    }
                                    onChange={(event) =>
                                      setConfirmationConfig((prev) => ({
                                        ...prev,
                                        redirect_url: event.target.value,
                                      }))
                                    }
                                    placeholder="https://tudominio.com/gracias"
                                  />
                                </label>

                                <label className="landing-label-block">
                                  Pagina de confirmacion (HTML)
                                  <div className="landing-editor-with-ai">
                                    <textarea
                                      value={confirmationConfig.page_html || ""}
                                      onChange={(event) =>
                                        setConfirmationConfig((prev) => ({
                                          ...prev,
                                          page_html: event.target.value,
                                        }))
                                      }
                                      rows={10}
                                      placeholder={
                                        DEFAULT_CONFIRMATION_PAGE_HTML
                                      }
                                    />
                                    <div className="landing-ai-email-actions">
                                      <input
                                        type="text"
                                        value={confirmationPageAiPrompt || ""}
                                        onChange={(event) =>
                                          setConfirmationPageAiPrompt(
                                            event.target.value,
                                          )
                                        }
                                        placeholder="ej: incluir resumen del evento y CTA"
                                      />
                                      <button
                                        type="button"
                                        className="landing-ai-action landing-ai-action--icon-only"
                                        onClick={
                                          handleGenerateConfirmationPageWithAi
                                        }
                                        disabled={
                                          isGeneratingConfirmationPageWithAi ||
                                          isSavingConfirmation
                                        }
                                        title="Generar pagina con IA"
                                        aria-label="Generar pagina con IA"
                                      >
                                        <svg
                                          viewBox="0 0 24 24"
                                          width="18"
                                          height="18"
                                          fill="currentColor"
                                          aria-hidden="true"
                                          focusable="false"
                                        >
                                          <path d="M12 2l1.09 3.26L16.5 6l-3.41 1.09L12 10.5l-1.09-3.41L7.5 6l3.41-1.09L12 2zm6 10l.73 2.18L21 15l-2.27.73L18 18l-.73-2.27L15 15l2.27-.73L18 12zm-12 0l.73 2.18L9 15l-2.27.73L6 18l-.73-2.27L3 15l2.27-.73L6 12z" />
                                        </svg>
                                      </button>
                                    </div>
                                  </div>
                                </label>

                                <form
                                  className="landing-inline-actions landing-inline-actions-compact"
                                  onSubmit={handleImportConfirmationPageUrl}
                                >
                                  <input
                                    type="url"
                                    value={confirmationPageImportUrl}
                                    onChange={(event) =>
                                      setConfirmationPageImportUrl(
                                        event.target.value,
                                      )
                                    }
                                    placeholder="https://sitio.com/gracias"
                                  />
                                  <button
                                    type="submit"
                                    disabled={isSavingConfirmation}
                                  >
                                    Importar URL
                                  </button>
                                </form>

                                <form
                                  className="landing-inline-actions landing-inline-actions-compact"
                                  onSubmit={handleUploadConfirmationPageHtml}
                                >
                                  <input
                                    type="file"
                                    accept=".html,text/html"
                                    onChange={(event) =>
                                      setConfirmationPageUploadFile(
                                        event.target.files?.[0] || null,
                                      )
                                    }
                                  />
                                  <button
                                    type="submit"
                                    disabled={isSavingConfirmation}
                                  >
                                    Subir archivo HTML
                                  </button>
                                </form>
                              </div>
                            ) : null}

                            <button
                              type="button"
                              onClick={handleSaveConfirmationConfig}
                              disabled={
                                isSavingConfirmation || !isConfirmationConfigDirty
                              }
                              className="landing-save-btn"
                            >
                              {isSavingConfirmation
                                ? "Guardando..."
                                : "Guardar configuración"}
                            </button>
                            <small className="landing-muted">
                              {isConfirmationConfigDirty
                                ? "Cambios pendientes en configuración"
                                : "Configuración guardada"}
                            </small>
                          </>
                        ) : null}
                      </fieldset>
                    </div>

                    <div className="landing-editor-section-preview">
                      <h5>Vista previa de confirmación</h5>

                      {confirmationSupportsEmail ? (
                        <div className="landing-confirmation-preview-section">
                          <div className="landing-inline-actions">
                            <strong>Correo de confirmacion</strong>
                          </div>
                          <div className="landing-confirmation-preview-wrap">
                            <iframe
                              title="Vista previa correo de confirmacion"
                              srcDoc={
                                confirmationConfig.email_body_html ||
                                "<p style='font-family:Segoe UI,Arial,sans-serif;padding:16px'>Aun no hay contenido de correo.</p>"
                              }
                              sandbox="allow-forms allow-same-origin allow-scripts"
                            />
                          </div>
                        </div>
                      ) : null}

                      {confirmationSupportsPage ? (
                        <div className="landing-confirmation-preview-section">
                          <div className="landing-inline-actions">
                            <strong>Pagina de confirmacion</strong>
                            <button
                              type="button"
                              onClick={handlePreviewConfirmationPage}
                              disabled={isSavingConfirmation}
                            >
                              Abrir en nueva pestana
                            </button>
                          </div>
                          <div className="landing-confirmation-preview-wrap">
                            <iframe
                              title="Vista previa pagina de confirmacion"
                              srcDoc={
                                confirmationConfig.page_html ||
                                DEFAULT_CONFIRMATION_PAGE_HTML
                              }
                              sandbox="allow-forms allow-same-origin allow-scripts"
                            />
                          </div>
                        </div>
                      ) : null}

                      {!confirmationSupportsEmail &&
                      !confirmationSupportsPage ? (
                        <p className="landing-muted">
                          Selecciona un tipo de respuesta para mostrar la vista
                          previa.
                        </p>
                      ) : null}
                    </div>
                  </div>
                </section>
              </>
            )}
          </article>
        </section>
      ) : null}

      {activeTab === "security" ? (
        <section className="landing-panel">
          <article className="landing-card landing-editor-card">
            <h3>Seguridad de registro por evento</h3>
            {!selectedLandingId ? (
              <p className="landing-muted">
                Selecciona una landing desde la pestaña Eventos/Landings.
              </p>
            ) : (
              <section className="landing-editor-section">
                <div className="landing-editor-section-head">
                  <h4>Controles de seguridad</h4>
                  <p className="landing-editor-section-description">
                    Ajusta reglas de protección para la API pública de registro
                    de este evento.
                  </p>
                </div>

                <div className="landing-editor-section-grid">
                  <div className="landing-editor-section-main">
                    <fieldset className="landing-confirmation-config-section">
                      <legend>Política general</legend>
                      <label className="landing-checkbox-label">
                        <input
                          type="checkbox"
                          checked={Boolean(securityConfig.enabled)}
                          onChange={(event) =>
                            setSecurityConfig((prev) => ({
                              ...prev,
                              enabled: event.target.checked,
                            }))
                          }
                        />
                        Activar política de seguridad para este evento
                      </label>
                      <p className="landing-muted">
                        Aplica reglas de protección al endpoint público de
                        registro de esta landing.
                      </p>

                      <label className="landing-checkbox-label">
                        <input
                          type="checkbox"
                          checked={Boolean(securityConfig.honeypot_enabled)}
                          onChange={(event) =>
                            setSecurityConfig((prev) => ({
                              ...prev,
                              honeypot_enabled: event.target.checked,
                            }))
                          }
                        />
                        Activar honeypot (campo trampa)
                      </label>
                      <p className="landing-muted">
                        Descarta envíos automatizados que llenan el campo
                        oculto.
                      </p>

                      <label className="landing-checkbox-label">
                        <input
                          type="checkbox"
                          checked={Boolean(securityConfig.require_user_agent)}
                          onChange={(event) =>
                            setSecurityConfig((prev) => ({
                              ...prev,
                              require_user_agent: event.target.checked,
                            }))
                          }
                        />
                        Requerir User-Agent en el submit
                      </label>
                      <p className="landing-muted">
                        Rechaza solicitudes que no incluyan encabezado
                        User-Agent.
                      </p>
                    </fieldset>

                    <fieldset className="landing-confirmation-config-section">
                      <legend>Rate limiting</legend>
                      <label className="landing-checkbox-label">
                        <input
                          type="checkbox"
                          checked={Boolean(securityConfig.rate_limit?.enabled)}
                          onChange={(event) =>
                            setSecurityConfig((prev) => ({
                              ...prev,
                              rate_limit: {
                                ...prev.rate_limit,
                                enabled: event.target.checked,
                              },
                            }))
                          }
                        />
                        Activar límites de tráfico
                      </label>
                      <p className="landing-muted">
                        Limita la frecuencia de envíos para reducir abuso.
                      </p>

                      <label className="landing-label-block">
                        Solicitudes por minuto por IP
                        <input
                          type="number"
                          min={1}
                          value={
                            securityConfig.rate_limit?.ip_requests_per_minute ||
                            30
                          }
                          onChange={(event) =>
                            setSecurityConfig((prev) => ({
                              ...prev,
                              rate_limit: {
                                ...prev.rate_limit,
                                ip_requests_per_minute: Math.max(
                                  1,
                                  Number(event.target.value || 1),
                                ),
                              },
                            }))
                          }
                        />
                      </label>
                      <p className="landing-muted">
                        Máximo de submits permitidos por IP en 60 segundos.
                      </p>

                      <label className="landing-label-block">
                        Solicitudes por hora para este slug
                        <input
                          type="number"
                          min={1}
                          value={
                            securityConfig.rate_limit?.slug_requests_per_hour ||
                            600
                          }
                          onChange={(event) =>
                            setSecurityConfig((prev) => ({
                              ...prev,
                              rate_limit: {
                                ...prev.rate_limit,
                                slug_requests_per_hour: Math.max(
                                  1,
                                  Number(event.target.value || 1),
                                ),
                              },
                            }))
                          }
                        />
                      </label>
                      <p className="landing-muted">
                        Máximo total de envíos para este evento por hora.
                      </p>

                      <label className="landing-label-block">
                        Tiempo de bloqueo (segundos)
                        <input
                          type="number"
                          min={1}
                          value={
                            securityConfig.rate_limit?.block_duration_seconds ||
                            300
                          }
                          onChange={(event) =>
                            setSecurityConfig((prev) => ({
                              ...prev,
                              rate_limit: {
                                ...prev.rate_limit,
                                block_duration_seconds: Math.max(
                                  1,
                                  Number(event.target.value || 1),
                                ),
                              },
                            }))
                          }
                        />
                      </label>
                      <p className="landing-muted">
                        Tiempo de bloqueo aplicado al exceder los límites.
                      </p>
                    </fieldset>

                    <fieldset className="landing-confirmation-config-section">
                      <legend>Idempotencia y payload</legend>
                      <label className="landing-checkbox-label">
                        <input
                          type="checkbox"
                          checked={Boolean(
                            securityConfig.idempotency?.require_key,
                          )}
                          onChange={(event) =>
                            setSecurityConfig((prev) => ({
                              ...prev,
                              idempotency: {
                                ...prev.idempotency,
                                require_key: event.target.checked,
                              },
                            }))
                          }
                        />
                        Requerir Idempotency-Key
                      </label>
                      <p className="landing-muted">
                        Exige una llave única para deduplicar reintentos.
                      </p>

                      <label className="landing-checkbox-label">
                        <input
                          type="checkbox"
                          checked={Boolean(
                            securityConfig.idempotency?.match_payload_hash,
                          )}
                          onChange={(event) =>
                            setSecurityConfig((prev) => ({
                              ...prev,
                              idempotency: {
                                ...prev.idempotency,
                                match_payload_hash: event.target.checked,
                              },
                            }))
                          }
                        />
                        Validar hash de payload para Idempotency-Key repetida
                      </label>
                      <p className="landing-muted">
                        Bloquea reuso de la misma llave con contenido distinto.
                      </p>

                      <label className="landing-checkbox-label">
                        <input
                          type="checkbox"
                          checked={Boolean(
                            securityConfig.payload_rules?.reject_unknown_fields,
                          )}
                          onChange={(event) =>
                            setSecurityConfig((prev) => ({
                              ...prev,
                              payload_rules: {
                                ...prev.payload_rules,
                                reject_unknown_fields: event.target.checked,
                              },
                            }))
                          }
                        />
                        Rechazar campos no definidos en el schema
                      </label>
                      <p className="landing-muted">
                        Acepta solo campos declarados en el formulario.
                      </p>

                      <label className="landing-label-block">
                        Longitud máxima por campo
                        <input
                          type="number"
                          min={10}
                          value={
                            securityConfig.payload_rules
                              ?.max_field_length_default || 500
                          }
                          onChange={(event) =>
                            setSecurityConfig((prev) => ({
                              ...prev,
                              payload_rules: {
                                ...prev.payload_rules,
                                max_field_length_default: Math.max(
                                  10,
                                  Number(event.target.value || 10),
                                ),
                              },
                            }))
                          }
                        />
                      </label>
                      <p className="landing-muted">
                        Límite de caracteres permitido por cada campo.
                      </p>

                      <label className="landing-label-block">
                        Número máximo de campos por submit
                        <input
                          type="number"
                          min={1}
                          value={
                            securityConfig.payload_rules?.max_total_fields ||
                            120
                          }
                          onChange={(event) =>
                            setSecurityConfig((prev) => ({
                              ...prev,
                              payload_rules: {
                                ...prev.payload_rules,
                                max_total_fields: Math.max(
                                  1,
                                  Number(event.target.value || 1),
                                ),
                              },
                            }))
                          }
                        />
                      </label>
                      <p className="landing-muted">
                        Tope de campos permitidos en un solo envío.
                      </p>
                    </fieldset>

                    <fieldset className="landing-confirmation-config-section">
                      <legend>Origen y privacidad de respuesta</legend>
                      <label className="landing-checkbox-label">
                        <input
                          type="checkbox"
                          checked={Boolean(
                            securityConfig.origin_rules?.enforce_allowlist,
                          )}
                          onChange={(event) =>
                            setSecurityConfig((prev) => ({
                              ...prev,
                              origin_rules: {
                                ...prev.origin_rules,
                                enforce_allowlist: event.target.checked,
                              },
                            }))
                          }
                        />
                        Exigir allowlist de origin
                      </label>
                      <p className="landing-muted">
                        Permite registros solo desde dominios autorizados.
                      </p>

                      <label className="landing-label-block">
                        Origins permitidos (uno por línea)
                        <textarea
                          value={securityAllowedOriginsText}
                          onChange={(event) =>
                            setSecurityAllowedOriginsText(event.target.value)
                          }
                          rows={6}
                          placeholder={[
                            "https://newpip.digitalvs.com",
                            "https://landing.tudominio.com",
                          ].join("\n")}
                        />
                      </label>
                      <p className="landing-muted">
                        Define los origins válidos cuando la allowlist está
                        activa.
                      </p>

                      <label className="landing-checkbox-label">
                        <input
                          type="checkbox"
                          checked={Boolean(
                            securityConfig.response_privacy
                              ?.generic_validation_errors,
                          )}
                          onChange={(event) =>
                            setSecurityConfig((prev) => ({
                              ...prev,
                              response_privacy: {
                                ...prev.response_privacy,
                                generic_validation_errors: event.target.checked,
                              },
                            }))
                          }
                        />
                        Usar mensaje genérico en errores de validación
                      </label>
                      <p className="landing-muted">
                        Evita exponer detalles técnicos de validación al
                        cliente.
                      </p>
                    </fieldset>

                    <button
                      type="button"
                      onClick={handleSaveSecurityConfig}
                      disabled={isSavingSecurityConfig}
                      className="landing-save-btn"
                    >
                      {isSavingSecurityConfig
                        ? "Guardando..."
                        : "Guardar seguridad"}
                    </button>
                  </div>

                  <div className="landing-editor-section-preview">
                    <h5>Resumen de política activa</h5>
                    <div className="landing-confirmation-preview-section">
                      <p className="landing-muted">
                        Estado: {securityConfig.enabled ? "Activa" : "Inactiva"}
                      </p>
                      <p className="landing-muted">
                        Honeypot:{" "}
                        {securityConfig.honeypot_enabled ? "Si" : "No"}
                      </p>
                      <p className="landing-muted">
                        Rate limit:{" "}
                        {securityConfig.rate_limit?.enabled ? "Si" : "No"}
                      </p>
                      <p className="landing-muted">
                        Idempotency-Key obligatoria:{" "}
                        {securityConfig.idempotency?.require_key ? "Si" : "No"}
                      </p>
                      <p className="landing-muted">
                        Allowlist origin:{" "}
                        {securityConfig.origin_rules?.enforce_allowlist
                          ? "Si"
                          : "No"}
                      </p>
                      <p className="landing-muted">
                        Origins configurados:{" "}
                        {
                          String(securityAllowedOriginsText || "")
                            .split("\n")
                            .map((entry) => entry.trim())
                            .filter(Boolean).length
                        }
                      </p>
                    </div>
                  </div>
                </div>
              </section>
            )}
          </article>
        </section>
      ) : null}

      {activeTab === "submissions" ? (
        <section className="landing-panel">
          <article className="landing-card">
            <h3>Registros por evento</h3>
            <p className="landing-muted">
              {isLoadingSubmissions
                ? "Cargando registros..."
                : `Mostrando ${visibleSubmissions.length} de ${submissions.length} registros`}
            </p>
            <div className="landing-submission-filters">
              <label className="landing-submission-filter-field">
                <span>Evento</span>
                <div className="landing-submission-event-combobox">
                  <input
                    type="text"
                    value={submissionEventQuery}
                    onFocus={() => setIsSubmissionEventPickerOpen(true)}
                    onBlur={() => {
                      window.setTimeout(() => {
                        setIsSubmissionEventPickerOpen(false);
                      }, 120);
                    }}
                    onChange={(event) => {
                      const nextValue = String(event.target.value || "");
                      setSubmissionEventQuery(nextValue);
                      setIsSubmissionEventPickerOpen(true);

                      const trimmed = nextValue.trim();
                      if (!trimmed) {
                        setSelectedEventId(null);
                        return;
                      }

                      const exact = submissionEventOptions.find(
                        (entry) =>
                          entry.label.toLowerCase() === trimmed.toLowerCase() ||
                          String(entry.eventId) === trimmed,
                      );
                      if (exact) {
                        setSelectedEventId(exact.eventId);
                        return;
                      }

                      const numericPrefix = /^\d+/.exec(trimmed);
                      if (numericPrefix) {
                        setSelectedEventId(Number(numericPrefix[0]));
                      }
                    }}
                    placeholder="Buscar por ID o nombre de evento"
                    autoComplete="off"
                  />
                  {isSubmissionEventPickerOpen &&
                  filteredSubmissionEventOptions.length ? (
                    <div className="landing-submission-event-combobox-menu">
                      {filteredSubmissionEventOptions.map((entry) => (
                        <button
                          key={entry.eventId}
                          type="button"
                          className="landing-submission-event-option"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            setSubmissionEventQuery(entry.label);
                            setSelectedEventId(entry.eventId);
                            setIsSubmissionEventPickerOpen(false);
                          }}
                        >
                          <strong>{entry.eventName || "Evento"}</strong>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </label>
              <label className="landing-submission-filter-field">
                <span>Desde</span>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(event) => setFromDate(event.target.value)}
                />
              </label>
              <label className="landing-submission-filter-field">
                <span>Hasta</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={(event) => setToDate(event.target.value)}
                />
              </label>
              <label className="landing-submission-filter-field landing-submission-filter-field-wide">
                <span>Filtrar registros</span>
                <input
                  type="text"
                  value={submissionTableFilter}
                  onChange={(event) =>
                    setSubmissionTableFilter(event.target.value)
                  }
                  placeholder="Buscar por fecha, nombre, correo, empresa o notas"
                />
              </label>
              <div className="landing-submission-filter-actions">
                <button
                  type="button"
                  className="landing-icon-action-button"
                  onClick={() => {
                    void handleApplySubmissionSellerAssignments();
                  }}
                  title={
                    isApplyingSubmissionSellers
                      ? "Ubicando propietario de la cuenta..."
                      : "Ubicar propietario de la cuenta"
                  }
                  aria-label={
                    isApplyingSubmissionSellers
                      ? "Ubicando propietario de la cuenta"
                      : "Ubicar propietario de la cuenta"
                  }
                  disabled={
                    isApplyingSubmissionSellers ||
                    isLoadingSubmissionSellers
                  }
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="M5 12l4 4L19 6" />
                  </svg>
                </button>
                <span className="landing-submission-apply-hint">
                  {submissionSellerApplyTargets.length ||
                  submissionSellerAutoAssignTargets.length
                    ? `${submissionSellerApplyTargets.length} manual(es) y ${submissionSellerAutoAssignTargets.length} autoasignable(s)`
                    : "Sin vendedores listos para asignar"}
                </span>
              </div>
            </div>

            <div className="landing-list-wrap">
              <table className="landing-table">
                <thead>
                  <tr>
                    <th>
                      <button
                        type="button"
                        className="landing-sort-button"
                        onClick={() => toggleSubmissionSort("submitted_at")}
                      >
                        Fecha
                        <span>
                          {submissionSort.key === "submitted_at"
                            ? submissionSort.direction === "asc"
                              ? "↑"
                              : "↓"
                            : "↕"}
                        </span>
                      </button>
                    </th>
                    <th>
                      <button
                        type="button"
                        className="landing-sort-button"
                        onClick={() => toggleSubmissionSort("seller_name")}
                      >
                        Propietario de la cuenta
                        <span>
                          {submissionSort.key === "seller_name"
                            ? submissionSort.direction === "asc"
                              ? "↑"
                              : "↓"
                            : "↕"}
                        </span>
                      </button>
                    </th>
                    {submissionFieldColumns.map((column) => (
                      <th key={column.key}>
                        <button
                          type="button"
                          className="landing-sort-button"
                          onClick={() => toggleSubmissionSort(column.key)}
                        >
                          {column.label}
                          <span>
                            {submissionSort.key === column.key
                              ? submissionSort.direction === "asc"
                                ? "↑"
                                : "↓"
                              : "↕"}
                          </span>
                        </button>
                      </th>
                    ))}
                    <th>
                      <button
                        type="button"
                        className="landing-sort-button"
                        onClick={() => toggleSubmissionSort("user_notes")}
                      >
                        Notas
                        <span>
                          {submissionSort.key === "user_notes"
                            ? submissionSort.direction === "asc"
                              ? "↑"
                              : "↓"
                            : "↕"}
                        </span>
                      </button>
                    </th>
                    <th>Enviar a Leads</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSubmissions.length === 0 ? (
                    <tr>
                      <td colSpan={submissionFieldColumns.length + 4}>
                        No hay registros para este filtro
                      </td>
                    </tr>
                  ) : (
                    visibleSubmissions.map(({ submission, fieldByKey }) => {
                      const submissionId = Number(
                        submission.submission_id || 0,
                      );
                      const leadId = Number(submission?.crm_links?.lead_id || 0);
                      const isSentToLeads = Boolean(
                        String(submission?.sent_to_leads_at || "").trim(),
                      );
                      const isSavingSeller = Boolean(
                        savingSubmissionSellerById[submissionId],
                      );
                      const isSendingSubmission = Boolean(
                        sendingSubmissionById[submissionId],
                      );
                      const isDeletingSubmission = Boolean(
                        deletingSubmissionById[submissionId],
                      );
                      const currentNotes = String(submission.user_notes || "");
                      const notesDraft = String(
                        submissionNotesDrafts[submissionId] ?? currentNotes,
                      );
                      const isSavingNotes = Boolean(
                        savingSubmissionNotesById[submissionId],
                      );
                      const isNotesDirty =
                        notesDraft.trim().slice(0, 8000) !==
                        currentNotes.trim().slice(0, 8000);

                      return (
                        <tr
                          key={submissionId}
                          className={isSentToLeads ? "is-processed" : ""}
                        >
                          <td>
                            {formatBusinessDateTime(submission.submitted_at, {
                              fallback: "-",
                            })}
                          </td>
                          <td>
                            <div className="landing-submission-seller-cell">
                              <select
                                value={String(
                                  Object.prototype.hasOwnProperty.call(
                                    submissionSellerDrafts,
                                    submissionId,
                                  )
                                    ? submissionSellerDrafts[submissionId]
                                    : submission?.crm_seller?.user_id
                                      ? String(submission.crm_seller.user_id)
                                      : "",
                                )}
                                onChange={(event) =>
                                  handleUpdateSubmissionSeller(
                                    submissionId,
                                    event.target.value,
                                  )
                                }
                                disabled={
                                  !leadId ||
                                  isSavingSeller ||
                                  isLoadingSubmissionSellers
                                }
                                className="landing-submission-seller-select"
                              >
                                <option value="">
                                  {leadId ? "Sin asignar" : "No disponible"}
                                </option>
                                {submissionSellerOptions.map((seller) => (
                                  <option key={seller.id} value={seller.id}>
                                    {seller.fullName || seller.email}
                                  </option>
                                ))}
                              </select>
                              {!leadId ? (
                                <span className="landing-submission-seller-hint">
                                  Envia a Leads para habilitar vendedor
                                </span>
                              ) : null}
                            </div>
                          </td>
                          {submissionFieldColumns.map((column) => (
                            <td
                              key={`${submission.submission_id}-${column.key}`}
                            >
                              {fieldByKey.get(column.key) || "-"}
                            </td>
                          ))}
                          <td>
                            <div className="landing-submission-notes-cell">
                              <textarea
                                value={notesDraft}
                                onChange={(event) =>
                                  setSubmissionNotesDrafts((prev) => ({
                                    ...prev,
                                    [submissionId]: event.target.value,
                                  }))
                                }
                                placeholder="Agregar notas para este registro..."
                                rows={3}
                              />
                              <button
                                type="button"
                                className="landing-submission-notes-save"
                                onClick={() =>
                                  handleSaveSubmissionNotes(submissionId)
                                }
                                disabled={isSavingNotes || !isNotesDirty}
                              >
                                {isSavingNotes
                                  ? "Guardando..."
                                  : "Guardar notas"}
                              </button>
                            </div>
                          </td>
                          <td>
                            <div className="landing-submission-action-cell">
                              <button
                                type="button"
                                className="landing-icon-action-button"
                                onClick={() =>
                                  handleSendSubmissionToLeads(submissionId)
                                }
                                title={
                                  isSendingSubmission
                                    ? "Enviando registro a Leads..."
                                    : isSentToLeads
                                      ? "Registro ya enviado a Leads"
                                      : "Enviar a Leads"
                                }
                                aria-label={
                                  isSendingSubmission
                                    ? "Enviando registro a Leads"
                                    : isSentToLeads
                                      ? "Registro ya enviado a Leads"
                                      : "Enviar a Leads"
                                }
                                disabled={isSentToLeads || isSendingSubmission}
                              >
                                <svg
                                  viewBox="0 0 24 24"
                                  width="16"
                                  height="16"
                                  fill="currentColor"
                                  aria-hidden="true"
                                  focusable="false"
                                  className={
                                    isSendingSubmission
                                      ? "landing-send-spinner"
                                      : ""
                                  }
                                >
                                  {isSendingSubmission ? (
                                    <path d="M12 3a9 9 0 1 0 9 9h-2a7 7 0 1 1-7-7V3z" />
                                  ) : (
                                    <path d="M2.1 10.9a1 1 0 0 1 .07-1.85L20.5 1.7a1 1 0 0 1 1.28 1.28l-7.36 18.34a1 1 0 0 1-1.85.07l-2.56-6.08-6.08-2.56a1 1 0 0 1-.83-.85zm8.55 2.52 2 4.76 5.79-14.43-14.43 5.79 4.76 2 .44.18 5.71-5.71a1 1 0 1 1 1.41 1.41l-5.71 5.71z" />
                                  )}
                                </svg>
                              </button>
                              {isSendingSubmission ? (
                                <span className="landing-submission-sending-tag">
                                  Enviando...
                                </span>
                              ) : null}
                              {isSentToLeads ? (
                                <span className="landing-submission-sent-tag">
                                  Enviado
                                </span>
                              ) : null}
                              <button
                                type="button"
                                className="landing-icon-action-button landing-icon-action-button-danger"
                                onClick={() =>
                                  handleDeleteSubmission(submissionId)
                                }
                                title={
                                  isDeletingSubmission
                                    ? "Eliminando registro..."
                                    : isSentToLeads
                                      ? "No se puede eliminar: registro ya enviado a Leads"
                                      : "Eliminar registro"
                                }
                                aria-label={
                                  isDeletingSubmission
                                    ? "Eliminando registro"
                                    : isSentToLeads
                                      ? "No se puede eliminar: registro ya enviado a Leads"
                                      : "Eliminar registro"
                                }
                                disabled={
                                  isSentToLeads ||
                                  isDeletingSubmission ||
                                  isSendingSubmission
                                }
                              >
                                {isDeletingSubmission ? (
                                  <svg
                                    viewBox="0 0 24 24"
                                    width="16"
                                    height="16"
                                    fill="currentColor"
                                    aria-hidden="true"
                                    focusable="false"
                                    className="landing-send-spinner"
                                  >
                                    <path d="M12 3a9 9 0 1 0 9 9h-2a7 7 0 1 1-7-7V3z" />
                                  </svg>
                                ) : (
                                  <svg
                                    viewBox="0 0 24 24"
                                    width="16"
                                    height="16"
                                    fill="currentColor"
                                    aria-hidden="true"
                                    focusable="false"
                                  >
                                    <path d="M9 3h6a1 1 0 0 1 1 1v1h4v2h-1v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7H4V5h4V4a1 1 0 0 1 1-1zm1 2v0h4V5h-4zm-3 2v12h10V7H7zm3 2h2v8h-2V9zm4 0h2v8h-2V9z" />
                                  </svg>
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      ) : null}

      {isGeneratingWithAi ? (
        <div
          className="landing-ai-modal-backdrop"
          role="status"
          aria-live="polite"
        >
          <div
            className="landing-ai-modal"
            aria-label="Generacion IA en progreso"
          >
            <div className="landing-ai-modal-spinner" aria-hidden="true" />
            <h4>La IA esta trabajando</h4>
            <p>{aiProgressText}</p>
            <button
              type="button"
              className="landing-ai-cancel-button"
              onClick={handleCancelAiGeneration}
              disabled={isAiCancelRequested}
            >
              {isAiCancelRequested ? "Cancelando..." : "Cancelar"}
            </button>
          </div>
        </div>
      ) : null}

      {isAiPromptModalOpen ? (
        <div
          className="landing-ai-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Instrucciones para generar landing con IA"
        >
          <form className="landing-ai-modal" onSubmit={handleSubmitAiPrompt}>
            <h4>Instrucciones para IA</h4>
            <p>
              Describe cambios en varias líneas. La IA editará el HTML actual de
              la landing.
            </p>
            <textarea
              className="landing-ai-prompt-textarea"
              value={aiPromptText}
              onChange={(event) => setAiPromptText(event.target.value)}
              rows={9}
              placeholder={[
                "Objetivo:",
                "Audiencia:",
                "Propuesta de valor:",
                "CTA:",
                "Cambios puntuales:",
              ].join("\n")}
              autoFocus
            />
            <div className="landing-ai-modal-actions">
              <button
                type="button"
                className="landing-ai-cancel-button"
                onClick={handleCloseAiPromptModal}
              >
                Cancelar
              </button>
              <button type="submit" className="landing-ai-submit-button">
                Generar con IA
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
