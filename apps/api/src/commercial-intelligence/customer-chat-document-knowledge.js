const DOCUMENT_KNOWLEDGE_CATEGORIES = new Set([
  "guidance.next_steps",
  "guidance.risks_and_gaps",
  "guidance.situation_assessment",
  "guidance.strategy",
  "content.discovery_questions",
  "content.meeting_preparation",
  "content.value_argument",
]);

const CRM_ONLY_INTENTS = new Set([
  "account_activity_history",
  "contact_history",
  "contact_query",
  "content_preparation",
  "opportunity_query",
  "opportunity_status",
  "quotation_query",
]);

const DOCUMENT_KNOWLEDGE_TERMS =
  /\b(?:proceso comercial|proceso de ventas|metodolog[ií]a(?:s)?(?: de venta| comercial)?|etapas? de venta|ciclo de ventas|fabricantes?|productos?|soluciones?|tecnolog[ií]as?|caracter[ií]sticas?|funcionamiento|implementaci[oó]n|integraci[oó]n|arquitectura|f5|bluecat|infoblox|waf|dd[ií]|dns|api(?:s)?|seguridad de aplicaciones)\b/i;

const ACCOUNT_SPECIFIC_FACTUAL_QUESTION =
  /\b(?:esta cuenta|la cuenta|el cliente|esta oportunidad|la oportunidad|la cotizaci[oó]n|productos? cotizados|servicios? cotizados|tiene registrados?|compr[oó]|adquiri[oó]|se vendi[oó]|en crm)\b/i;

function contractComponents(turnContract) {
  return Array.isArray(turnContract?.components) ? turnContract.components : [];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildCustomerDocumentKnowledgeQuery({
  question,
  routing = null,
  turnContract = null,
  snapshot = null,
}) {
  const references = [
    snapshot?.account?.name,
    snapshot?.selectedOpportunity?.name,
    snapshot?.selectedContact?.name,
    routing?.entities?.accountReference,
    routing?.entities?.opportunityReference,
    routing?.entities?.contactReference,
    ...contractComponents(turnContract).map((component) => component.reference),
  ]
    .map((value) => String(value || "").trim())
    .filter((value) => value.length >= 3);
  let sanitized = String(question || "");
  for (const reference of new Set(references)) {
    sanitized = sanitized.replace(
      new RegExp(escapeRegExp(reference), "giu"),
      " ",
    );
  }
  sanitized = sanitized.replace(
    /\b(?:cuenta|oportunidad|contacto|cotizaci[oó]n)\s*(?:n(?:o|úm)?\.?\s*)?#?\d+\b/gi,
    " ",
  );
  return sanitized.replace(/\s+/g, " ").trim().slice(0, 1200) ||
    "conocimiento comercial general";
}

export function shouldRetrieveCustomerDocumentKnowledge({
  question,
  routing = null,
  turnContract = null,
}) {
  const components = contractComponents(turnContract);
  if (turnContract && turnContract.resolution !== "resolved") return false;
  if (components.length) {
    if (components.some((component) => component.category?.startsWith("action."))) {
      return false;
    }
    if (components.some((component) =>
      DOCUMENT_KNOWLEDGE_CATEGORIES.has(component.category))) {
      return true;
    }
    return false;
  }

  if (!routing) return false;
  const intents = Array.isArray(routing?.intents)
    ? routing.intents
    : routing?.intent
      ? [routing.intent]
      : [];
  if (
    routing?.requiresClarification ||
    routing?.mode === "clarification" ||
    routing?.mode === "operation" ||
    routing?.ambiguity?.reason === "other_account" ||
    routing?.ambiguity?.reason === "out_of_scope" ||
    intents.includes("crm_operation")
  ) {
    return false;
  }
  if (intents.some((intent) => CRM_ONLY_INTENTS.has(intent))) return false;
  if (intents.includes("opportunity_guidance") || intents.includes("value_argument")) {
    return true;
  }
  return intents.includes("account_overview") &&
    !ACCOUNT_SPECIFIC_FACTUAL_QUESTION.test(String(question || "")) &&
    DOCUMENT_KNOWLEDGE_TERMS.test(String(question || ""));
}
