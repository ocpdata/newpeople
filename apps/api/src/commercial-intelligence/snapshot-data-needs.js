// Decides which optional CRM domains the snapshot must include for the current question.

import { runStructuredTextResearch } from "../structuredWebResearch.js";
import { hasReadPermission } from "./service-helpers.js";

export const CUSTOMER_SNAPSHOT_DATA_DOMAINS = Object.freeze([
  {
    code: "contact_history",
    permission: "contactos",
    description:
      "Historial completo de contactos de la cuenta, incluidos inactivos y registros anteriores al límite estándar.",
  },
  {
    code: "provider_catalog",
    permission: "oportunidades",
    description:
      "Catálogo activo de productos y proveedores para consultas de productos complementarios, precios o venta cruzada.",
  },
]);

export function needsProviderCatalogForQuestion(question, conversationHistory) {
  const recentUserContext = (Array.isArray(conversationHistory)
    ? conversationHistory
    : [])
    .slice(-4)
    .filter((message) => message?.role !== "assistant")
    .map((message) => String(message?.text || ""))
    .join(" ");
  const searchableText = `${String(question || "")} ${recentUserContext}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
  return /\b(productos?|proveedores?|catalogo|precios?|lista de precios|venta cruzada|cross[\s-]?sell|complementari\w*)\b/.test(
    searchableText,
  );
}

export function normalizeCustomerSnapshotDataNeeds(
  plan,
  persistedIntents = [],
  allowedDomains = CUSTOMER_SNAPSHOT_DATA_DOMAINS.map((domain) => domain.code),
) {
  const confidence = ["high", "medium", "low"].includes(plan?.confidence)
    ? plan.confidence
    : "low";
  const availableDomains = new Set(Array.isArray(allowedDomains) ? allowedDomains : []);
  const requestedDomains = confidence === "low"
    ? []
    : [...new Set(Array.isArray(plan?.domains) ? plan.domains : [])].filter(
        (domain) => availableDomains.has(domain),
      );
  const domains = new Set(requestedDomains);
  if (
    Array.isArray(persistedIntents) &&
    persistedIntents.includes("contact_history") &&
    availableDomains.has("contact_history")
  ) {
    domains.add("contact_history");
  }
  return {
    domains: [...domains],
    confidence,
    includeContactHistory: domains.has("contact_history"),
    includeProviderCatalog: domains.has("provider_catalog"),
  };
}

export async function classifyCustomerSnapshotDataNeeds({
  question = "",
  conversationHistory = [],
  persistedIntents = [],
  selectedContext = {},
  user,
  jobId,
  classifyWithAI = runStructuredTextResearch,
} = {}) {
  const providerCatalogRequested = needsProviderCatalogForQuestion(
    question,
    conversationHistory,
  );
  const availableDataDomains = CUSTOMER_SNAPSHOT_DATA_DOMAINS.filter((domain) =>
    hasReadPermission(user, domain.permission) &&
    (domain.code !== "provider_catalog" || providerCatalogRequested),
  );
  if (!availableDataDomains.length) {
    return normalizeCustomerSnapshotDataNeeds(null, persistedIntents, []);
  }

  let plan = null;
  try {
    plan = await classifyWithAI({
      schemaName: "customer_account_snapshot_data_needs",
      systemPrompt:
        "Clasifica qué dominios internos opcionales necesita el snapshot para responder la solicitud actual. Elige únicamente códigos de availableDataDomains; no inventes consultas, permisos ni dominios. El contexto básico de la cuenta y las lecturas CRM estándar ya se cargan siempre. Selecciona contact_history cuando haga falta el historial completo de contactos o contactos inactivos; selecciona provider_catalog únicamente cuando hagan falta productos o proveedores del catálogo, como una consulta de producto complementario o venta cruzada. Una pregunta sobre crecimiento, expansión comercial, noticias o iniciativas empresariales no requiere por sí sola provider_catalog. No solicites investigación pública: esa opción requiere consentimiento independiente. Si no se necesita una fuente opcional, devuelve domains vacío.",
      subject: "Necesidades de datos opcionales del snapshot CRM",
      context: {
        question: String(question || "").trim().slice(0, 2000),
        recentConversation: (Array.isArray(conversationHistory)
          ? conversationHistory
          : []
        )
          .slice(-4)
          .map((message) => ({
            role: message?.role === "assistant" ? "assistant" : "user",
            text: String(message?.text || "").slice(0, 600),
          })),
        priorIntents: (Array.isArray(persistedIntents) ? persistedIntents : [])
          .filter((intent) => typeof intent === "string")
          .slice(0, 8),
        selectedContext: {
          accountSelected: Boolean(selectedContext.accountId),
          opportunitySelected: Boolean(selectedContext.opportunityId),
          contactSelected: Boolean(selectedContext.contactId),
        },
        availableDataDomains,
      },
      currentValues: {},
      fields: [
        {
          key: "domains",
          type: "array",
          example: [],
          items: {
            type: "enum",
            enum: availableDataDomains.map((domain) => domain.code),
          },
        },
        {
          key: "confidence",
          type: "enum",
          enum: ["high", "medium", "low"],
          example: "medium",
        },
      ],
      aiUsageContext: {
        userId: Number(user?.id || 0),
        featureCode: "commercial_intelligence.account_chat.snapshot_selection",
        jobType: "account_chat",
        jobId,
      },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    plan = null;
  }
  return normalizeCustomerSnapshotDataNeeds(
    plan,
    persistedIntents,
    availableDataDomains.map((domain) => domain.code),
  );
}
