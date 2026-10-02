function normalizeCoachCaseText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export const COACH_CASE_CATALOG = Object.freeze([
  {
    id: "COACH-STAGE-RISK-001",
    type: "stage_readiness",
    subtype: "risk_review",
    phrases: [
      "que riesgos bloquean esta oportunidad",
      "que bloqueos impiden avanzar de etapa",
      "que riesgos debo atender en la etapa",
      "riesgos abiertos de la oportunidad",
    ],
  },
  {
    id: "COACH-STAGE-PREPARATION-001",
    type: "stage_readiness",
    subtype: "stage_preparation",
    phrases: [
      "que me falta para avanzar de etapa",
      "que falta para pasar de etapa",
      "preparacion de etapa",
      "preparar esta oportunidad para cotizar",
      "preguntas sin respuesta de etapa",
    ],
  },
  {
    id: "COACH-STAGE-QUESTIONS-001",
    type: "stage_readiness",
    subtype: "stage_questions",
    phrases: [
      "que preguntas debo hacer en cotizacion",
      "que preguntas debo hacer en demostracion",
      "preguntas clave para negociacion",
      "que debo preguntar en waiting",
      "preguntas clave de la etapa",
    ],
  },
  {
    id: "COACH-ACTIVITY-QUERY-001",
    type: "activity_query",
    subtype: "pending_activity_detail",
    requiresOpportunityContext: true,
    phrases: [
      "que actividades estan pendientes",
      "actividades pendientes de la oportunidad",
      "siguientes actividades de la oportunidad",
      "siguiente paso de la oportunidad",
      "proximo paso del contexto actual",
    ],
  },
  {
    id: "COACH-QUOTATION-QUERY-001",
    type: "quotation_query",
    subtype: "latest_quotation_contents",
    requiresOpportunityContext: true,
    readTool: "getOpportunityQuotation",
    phrases: [
      "que contiene la cotizacion",
      "que contiene una cotizacion",
      "que incluye la cotizacion",
      "que trae la cotizacion",
      "contenido de la cotizacion",
      "contenido de cotizacion",
      "detalle de la cotizacion",
      "desglose de la cotizacion",
      "partidas de la cotizacion",
      "productos cotizados",
      "servicios cotizados",
    ],
  },
  {
    id: "COACH-CONTACT-QUERY-001",
    type: "contact_query",
    subtype: "stakeholders",
    readTool: "searchContacts",
    phrases: [
      "quienes son los decisores y contactos",
      "contactos de la cuenta",
      "decisores de la cuenta",
      "stakeholders de la oportunidad",
      "responsables de la cuenta",
      "participantes de la oportunidad",
    ],
  },
  {
    id: "COACH-ACCOUNT-QUERY-001",
    type: "account_query",
    subtype: "account_overview",
    readTool: "searchAccounts",
    phrases: [
      "resumen de la cuenta",
      "resumen comercial del cliente",
      "historial de la cuenta",
      "situacion de la empresa",
      "datos de la cuenta",
    ],
  },
]);

export function matchCoachQueryCase(value = "") {
  const text = normalizeCoachCaseText(value);
  return (
    COACH_CASE_CATALOG.find((item) =>
      item.phrases.some((phrase) => text.includes(normalizeCoachCaseText(phrase))),
    ) || null
  );
}

export function listCoachCaseCatalog() {
  return COACH_CASE_CATALOG.map(({ id, type, subtype, readTool, requiresOpportunityContext, phrases }) => ({
    id,
    type,
    subtype,
    phrases: [...phrases],
    ...(readTool ? { readTool } : {}),
    ...(requiresOpportunityContext ? { requiresOpportunityContext } : {}),
  }));
}