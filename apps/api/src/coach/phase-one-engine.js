import { resolveCoachEntities } from "./entity-resolver.js";
import { inferCoachOpportunityFilters } from "./read-tools.js";
import { getCoachBusinessRules } from "./business-rules.js";
import { matchCoachQueryCase } from "./case-catalog.js";

function normalizeCoachText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function classifyCoachIntent(question = "") {
  const text = normalizeCoachText(question);
  if (!text) {
    return {
      type: "unknown",
      subtype: "empty",
      requiresClarification: true,
      operationRequested: false,
      temporalFilter: null,
    };
  }

  const catalogCase = matchCoachQueryCase(question);

  const hasOpportunityTerm = /\b(oportunidad|oportunidades|pipeline|etapa)\b/.test(text);
  const hasAccountTerm = /\b(cuenta|cuentas|account|accounts)\b/.test(text);
  const hasRiskTerm = /\b(riesgo|riesgos|bloqueo|bloqueos)\b/.test(text);
  const hasTemporalTerm = /\b(fecha de cierre|cierre|cerrar|cierran)\b/.test(text);
  const hasOperationTerm = /\b(agenda|actualiza|crea|cambia|registra|envia|confirma)\b/.test(text);
  const hasStageTerm = /\b(etapa|fase|preparacion|siguiente paso|avanzar)\b/.test(text);
  const hasLeadTerm = /\b(lead|leads|prospecto|prospectos)\b/.test(text);
  const hasRankingTerm = /\b(mayor|mayores|mas|cantidad|numero|ranking)\b/.test(text);
  const closeYearMatch = text.match(/\b(20\d{2})\b/);

  if (hasOperationTerm) {
    return {
      type: "operation",
      subtype: "action_request",
      requiresClarification: false,
      operationRequested: true,
      temporalFilter: closeYearMatch ? Number(closeYearMatch[1]) : null,
    };
  }

  if (catalogCase?.type === "stage_readiness") {
    return {
      type: catalogCase.type,
      subtype: catalogCase.subtype,
      caseId: catalogCase.id,
      requiresClarification: false,
      operationRequested: false,
      temporalFilter: closeYearMatch ? Number(closeYearMatch[1]) : null,
    };
  }

  if (["account_query", "contact_query", "activity_query", "quotation_query"].includes(catalogCase?.type)) {
    return {
      type: catalogCase.type,
      subtype: catalogCase.subtype,
      caseId: catalogCase.id,
      requiresClarification: false,
      operationRequested: false,
      temporalFilter: closeYearMatch ? Number(closeYearMatch[1]) : null,
    };
  }

  if (hasRiskTerm || hasStageTerm) {
    return {
      type: "stage_readiness",
      subtype: hasRiskTerm ? "risk_review" : "stage_preparation",
      requiresClarification: false,
      operationRequested: false,
      temporalFilter: closeYearMatch ? Number(closeYearMatch[1]) : null,
    };
  }

  if (hasAccountTerm && hasRankingTerm && hasOpportunityTerm) {
    return {
      type: "account_ranking",
      subtype: "pipeline_coverage",
      requiresClarification: false,
      operationRequested: false,
      temporalFilter: closeYearMatch ? Number(closeYearMatch[1]) : null,
    };
  }

  if (hasTemporalTerm) {
    return {
      type: "temporal_filter",
      subtype: "closing_date_query",
      requiresClarification: false,
      operationRequested: false,
      temporalFilter: closeYearMatch ? Number(closeYearMatch[1]) : null,
    };
  }

  if (hasOpportunityTerm && !hasLeadTerm) {
    return {
      type: "opportunity_query",
      subtype: hasRankingTerm ? "aggregate" : "detail",
      requiresClarification: false,
      operationRequested: false,
      temporalFilter: closeYearMatch ? Number(closeYearMatch[1]) : null,
    };
  }

  if (hasLeadTerm) {
    return {
      type: "lead_query",
      subtype: "detail",
      requiresClarification: false,
      operationRequested: false,
      temporalFilter: closeYearMatch ? Number(closeYearMatch[1]) : null,
    };
  }

  return {
    type: "general_query",
    subtype: "general",
    requiresClarification: false,
    operationRequested: false,
    temporalFilter: closeYearMatch ? Number(closeYearMatch[1]) : null,
  };
}

export function applyCoachPhaseOneRules({
  question,
  snapshot,
  context = {},
  channel = "coach",
  intent = null,
  businessRules = null,
}) {
  const resolvedBusinessRules =
    businessRules || getCoachBusinessRules({ channel, overrides: context?.businessRules || {} });
  const detectedIntent = intent || classifyCoachIntent(question);
  const explicitEntities = resolveCoachEntities(
    snapshot,
    question,
    resolvedBusinessRules,
  );
  const facilityFilters = inferCoachOpportunityFilters(
    question,
    resolvedBusinessRules,
  );
  const requiresClarification =
    Boolean(
      explicitEntities?.candidates?.opportunities?.length > 1 &&
        detectedIntent.type !== "operation" &&
        detectedIntent.type !== "account_ranking" &&
        !/\b(oportunidad|oportunidades|cuenta|cuentas)\b/.test(
          normalizeCoachText(question),
        )
    ) ||
    Boolean(
      detectedIntent.type === "general_query" &&
        explicitEntities?.candidates?.opportunities?.length > 1,
    );

  return {
    intent: detectedIntent,
    explicitEntities,
    businessRules: resolvedBusinessRules,
    filters: {
      ...facilityFilters,
      sourceChannel: resolvedBusinessRules.channel,
      scope: resolvedBusinessRules.channel,
      entityContext: context,
      businessRules: resolvedBusinessRules,
      defaultFilterSet: resolvedBusinessRules.filters,
    },
    requiresClarification,
    allowOperations: detectedIntent.operationRequested,
    allowReadQueries: !detectedIntent.operationRequested,
  };
}
