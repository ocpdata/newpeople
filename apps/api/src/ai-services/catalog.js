// Static catalog for the AI services settings: modules, model roles, providers and plan limits.

export const AI_MODEL_ROLES = [
  { code: "fast", label: "Rápido", description: "Tareas simples: resúmenes, sugerencias y correos." },
  { code: "advanced", label: "Avanzado", description: "Razonamiento: enrutador, analista y redacción del chat." },
  { code: "transcription", label: "Transcripción", description: "Audio a texto." },
];

export const AI_LLM_PROVIDERS = [
  { code: "openai", label: "OpenAI" },
];

// Each feature code is attributed to exactly one module by exact code or by "<prefix>." / explicit prefixes.
export const AI_MODULES = [
  { code: "mi_coach", label: "Mi Coach", prefixes: ["mi_coach", "mi_agent"], usesLlm: true },
  {
    code: "customer_account",
    label: "Cliente existente",
    prefixes: ["commercial_intelligence", "customer_chat", "account_chat_attachment_transcription"],
    usesLlm: true,
    usesTavily: true,
    usesPinecone: true,
  },
  { code: "prospect", label: "Cuenta nueva", prefixes: ["prospect_research"], usesLlm: true, usesTavily: true },
  { code: "opportunities", label: "Oportunidades", prefixes: ["opportunities"], usesLlm: true },
  {
    code: "commercial_development",
    label: "Desarrollo comercial",
    prefixes: ["commercial_development", "commercial_email_attachment_suggestions"],
    usesLlm: true,
  },
  { code: "quotations", label: "Cotizaciones", prefixes: ["quotations", "quotation_"], usesLlm: true },
  { code: "proposals", label: "Propuestas", prefixes: ["proposals", "proposals_", "proposal_"], usesLlm: true },
  { code: "interactions", label: "Leads", prefixes: ["interactions"], usesLlm: true },
  { code: "accounts_contacts", label: "Cuentas y contactos", prefixes: ["accounts", "contacts"], usesLlm: true },
  { code: "commercial_enablement", label: "Biblioteca Comercial", prefixes: ["commercial_enablement"], usesLlm: true },
  { code: "chatbot", label: "Asistente del CRM", prefixes: ["chatbot"], usesLlm: true, usesPinecone: true },
  {
    code: "documentation_rag",
    label: "Documentación RAG",
    prefixes: ["documentacion_rag"],
    usesLlm: false,
    usesPinecone: true,
    pineconeRequired: true,
  },
  { code: "other", label: "Otros", prefixes: [], usesLlm: true },
];

export const AI_FALLBACK_MODULE = "other";

function matchesPrefix(featureCode, prefix) {
  if (prefix.endsWith("_")) return featureCode.startsWith(prefix);
  return featureCode === prefix || featureCode.startsWith(`${prefix}.`);
}

export function aiModuleCodeForFeature(featureCode) {
  const code = String(featureCode || "").trim();
  if (!code) return AI_FALLBACK_MODULE;
  const match = AI_MODULES.find((module) =>
    module.prefixes.some((prefix) => matchesPrefix(code, prefix)),
  );
  return match ? match.code : AI_FALLBACK_MODULE;
}

export function getAiModule(code) {
  return AI_MODULES.find((module) => module.code === code) || null;
}

// https://docs.tavily.com/documentation/api-credits — price per credit by plan name.
export const TAVILY_PLAN_PRICES_USD = {
  researcher: 0,
  free: 0,
  project: 0.0075,
  bootstrap: 0.0067,
  startup: 0.0058,
  growth: 0.005,
  "pay as you go": 0.008,
  paygo: 0.008,
};

export function tavilyPriceForPlan(planName) {
  const key = String(planName || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(TAVILY_PLAN_PRICES_USD, key)
    ? TAVILY_PLAN_PRICES_USD[key]
    : null;
}

// Tavily search costs 1 credit (basic) or 2 credits (advanced) when the response omits usage.
export function tavilyCreditsForDepth(depth) {
  return String(depth || "").toLowerCase() === "advanced" ? 2 : 1;
}

export const PINECONE_METRICS = [
  { code: "chat_input_tokens", label: "Respuestas: tokens de entrada", unit: "tokens" },
  { code: "chat_output_tokens", label: "Respuestas: tokens de salida", unit: "tokens" },
  { code: "context_tokens", label: "Búsqueda de contexto", unit: "tokens" },
  { code: "ingestion_units", label: "Carga de documentos", unit: "unidades" },
];

// https://docs.pinecone.io/guides/assistant/pricing-and-limits — monthly limits per organization.
export const PINECONE_PLANS = {
  starter: {
    label: "Starter",
    limits: { chat_input_tokens: 500_000, chat_output_tokens: 300_000, context_tokens: 500_000, ingestion_units: 1_000 },
    usdPerUnit: { chat_input_tokens: 0, chat_output_tokens: 0, context_tokens: 0, ingestion_units: 0 },
    blocksAtLimit: true,
  },
  builder: {
    label: "Builder",
    limits: { chat_input_tokens: 2_000_000, chat_output_tokens: 1_000_000, context_tokens: 2_000_000, ingestion_units: 10_000 },
    usdPerUnit: { chat_input_tokens: 0, chat_output_tokens: 0, context_tokens: 0, ingestion_units: 0 },
    blocksAtLimit: true,
  },
  standard: {
    label: "Standard",
    limits: {},
    usdPerUnit: { chat_input_tokens: 8 / 1e6, chat_output_tokens: 15 / 1e6, context_tokens: 5 / 1e6, ingestion_units: 0.0005 },
    blocksAtLimit: false,
  },
  enterprise: {
    label: "Enterprise",
    limits: {},
    usdPerUnit: { chat_input_tokens: 8 / 1e6, chat_output_tokens: 15 / 1e6, context_tokens: 5 / 1e6, ingestion_units: 0.0005 },
    blocksAtLimit: false,
  },
};
