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
      interactionMode: "clarification",
      policyProcess: "default",
      requiresClarification: true,
      operationRequested: false,
      temporalFilter: null,
    };
  }

  const catalogCase = matchCoachQueryCase(question);

  const hasOpportunityTerm =
    /\b(oportunidad|oportunidades|pipeline|etapa)\b/.test(text);
  const hasAccountTerm = /\b(cuenta|cuentas|account|accounts)\b/.test(text);
  const hasRiskTerm = /\b(riesgo|riesgos|bloqueo|bloqueos)\b/.test(text);
  const hasTemporalTerm = /\b(fecha de cierre|cierre|cerrar|cierran)\b/.test(
    text,
  );
  const hasOperationTerm =
    /\b(agenda|agendar|actualiza|actualizar|actualice|crea|crear|cree|cambia|cambiar|cambie|registra|registrar|registre|envia|enviar|envie|confirma|confirmar|modifica|modificar|modifique|vincula|vincular|asocia|asociar|prepara|preparar)\b/.test(
      text,
    );
  const hasStageTerm =
    /\b(etapa|fase|preparacion|siguiente paso|avanzar)\b/.test(text);
  const hasLeadTerm = /\b(lead|leads|prospecto|prospectos)\b/.test(text);
  const hasContactTerm =
    /\b(contacto|contactos|decisor|decisores|stakeholder|stakeholders)\b/.test(
      text,
    );
  const hasQuotationTerm = /\b(cotizacion|cotizaciones)\b/.test(text);
  const hasActivityTerm = /\b(actividad|actividades|seguimiento)\b/.test(text);
  const hasRankingTerm = /\b(mayor|mayores|mas|cantidad|numero|ranking)\b/.test(
    text,
  );
  const hasSellerCoachingCue =
    /\b(desempen\w*|prioriz\w*|prioridad\w*|recomend\w*|suger\w*|consej\w*|mejor\w*|que deberia hacer|que puedo hacer|que atender)\b/.test(
      text,
    );
  const hasPointAccountLookup =
    /\b(que cuenta es|cual es esta cuenta|cual es la cuenta|nombre de la cuenta|datos de la cuenta|resumen de la cuenta)\b/.test(
      text,
    );
  const closeYearMatch = text.match(/\b(20\d{2})\b/);
  const requiresDeepExploration =
    /\b(historial completo|historial detallado|todos los contactos|todas las actividades|lista completa|partidas completas|todas las partidas|todo el detalle|detalle completo|detalle exhaustivo|desglose completo|explora a fondo|explorar a fondo|investiga a fondo|revisa a profundidad)\b/.test(
      text,
    );

  if (hasOperationTerm) {
    return {
      type: "operation",
      subtype: "action_request",
      interactionMode: "operation",
      policyProcess: "operation",
      requiresClarification: false,
      operationRequested: true,
      temporalFilter: closeYearMatch ? Number(closeYearMatch[1]) : null,
    };
  }

  if (requiresDeepExploration) {
    return {
      type:
        catalogCase?.type ||
        (hasLeadTerm
          ? "lead_query"
          : hasOpportunityTerm
            ? "opportunity_query"
            : hasAccountTerm
              ? "account_query"
              : "general_query"),
      subtype: "detailed_record_request",
      interactionMode: "deep_exploration",
      policyProcess: "default",
      ...(catalogCase?.id ? { caseId: catalogCase.id } : {}),
      requiresClarification: false,
      operationRequested: false,
      temporalFilter: closeYearMatch ? Number(closeYearMatch[1]) : null,
    };
  }

  if (hasSellerCoachingCue) {
    return {
      type:
        catalogCase?.type ||
        (hasOpportunityTerm
          ? "opportunity_query"
          : hasLeadTerm
            ? "lead_query"
            : hasContactTerm
              ? "contact_query"
              : hasQuotationTerm
                ? "quotation_query"
                : hasActivityTerm
                  ? "activity_query"
                  : hasAccountTerm
                    ? "account_query"
                    : "general_query"),
      subtype: catalogCase?.subtype || "seller_guidance",
      interactionMode: "coaching",
      policyProcess: "seller_coaching",
      ...(catalogCase?.id ? { caseId: catalogCase.id } : {}),
      requiresClarification: false,
      operationRequested: false,
      temporalFilter: closeYearMatch ? Number(closeYearMatch[1]) : null,
    };
  }

  if (hasPointAccountLookup) {
    return {
      type: "account_query",
      subtype: "account_lookup",
      interactionMode: "brief_context",
      policyProcess: "brief_context",
      requiresClarification: false,
      operationRequested: false,
      temporalFilter: closeYearMatch ? Number(closeYearMatch[1]) : null,
    };
  }

  if (catalogCase?.type === "stage_readiness") {
    return {
      type: catalogCase.type,
      subtype: catalogCase.subtype,
      interactionMode: "coaching",
      policyProcess: "seller_coaching",
      caseId: catalogCase.id,
      requiresClarification: false,
      operationRequested: false,
      temporalFilter: closeYearMatch ? Number(closeYearMatch[1]) : null,
    };
  }

  if (
    [
      "account_query",
      "contact_query",
      "activity_query",
      "quotation_query",
    ].includes(catalogCase?.type)
  ) {
    return {
      type: catalogCase.type,
      subtype: catalogCase.subtype,
      interactionMode: "brief_context",
      policyProcess: "brief_context",
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
      interactionMode: "coaching",
      policyProcess: "seller_coaching",
      requiresClarification: false,
      operationRequested: false,
      temporalFilter: closeYearMatch ? Number(closeYearMatch[1]) : null,
    };
  }

  if (hasAccountTerm && hasRankingTerm && hasOpportunityTerm) {
    return {
      type: "account_ranking",
      subtype: "pipeline_coverage",
      interactionMode: "coaching",
      policyProcess: "seller_coaching",
      requiresClarification: false,
      operationRequested: false,
      temporalFilter: closeYearMatch ? Number(closeYearMatch[1]) : null,
    };
  }

  if (hasTemporalTerm) {
    return {
      type: "temporal_filter",
      subtype: "closing_date_query",
      interactionMode: "coaching",
      policyProcess: "seller_coaching",
      requiresClarification: false,
      operationRequested: false,
      temporalFilter: closeYearMatch ? Number(closeYearMatch[1]) : null,
    };
  }

  if (hasOpportunityTerm && !hasLeadTerm) {
    return {
      type: "opportunity_query",
      subtype: hasRankingTerm ? "aggregate" : "detail",
      interactionMode: "brief_context",
      policyProcess: "brief_context",
      requiresClarification: false,
      operationRequested: false,
      temporalFilter: closeYearMatch ? Number(closeYearMatch[1]) : null,
    };
  }

  if (hasLeadTerm) {
    return {
      type: "lead_query",
      subtype: "detail",
      interactionMode: "brief_context",
      policyProcess: "brief_context",
      requiresClarification: false,
      operationRequested: false,
      temporalFilter: closeYearMatch ? Number(closeYearMatch[1]) : null,
    };
  }

  return {
    type: "general_query",
    subtype: "general",
    interactionMode: "coaching",
    policyProcess: "seller_coaching",
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
    businessRules ||
    getCoachBusinessRules({ channel, overrides: context?.businessRules || {} });
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
      ),
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
