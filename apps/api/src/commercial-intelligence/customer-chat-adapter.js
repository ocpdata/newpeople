import { runStructuredTextResearch } from "../structuredWebResearch.js";
import { resolveCoachEntities } from "../coach/entity-resolver.js";
import { executeCoachReadTool } from "../coach/crm-read-tools.js";
import { runConversationEngine } from "../coach/conversation-engine.js";
import { normalizeActivityOperation } from "../coach/operation-contract.js";
import { buildStageReadiness, isStagePreparationQuestion } from "../coach/stage-readiness.js";
import { getCoachReadToolCatalog, inferCoachOpportunityFilters } from "../coach/read-tools.js";
import { loadCoachBusinessRules } from "../coach/business-rules.js";
import { matchCoachQueryCase } from "../coach/case-catalog.js";
import { getAuthorizedCoachQuotationContent } from "../coach/quotation-read-service.js";

const COACH_READ_TOOL_CATALOG = getCoachReadToolCatalog();
const COACH_READ_TOOL_NAMES = new Set(
  COACH_READ_TOOL_CATALOG.map((tool) => tool.name),
);

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isOpen(opportunity) {
  return opportunity?.lifecycle === "open";
}

function accountRecord(snapshot) {
  return snapshot.account
    ? [{ ...snapshot.account, accountId: snapshot.account.id }]
    : [];
}

function opportunityRecords(snapshot) {
  const accountId = Number(snapshot.account?.id || 0);
  const opportunities = new Map();
  for (const opportunity of [
    ...(snapshot.opportunities || []),
    ...(snapshot.inactiveOpportunities || []),
    ...(snapshot.selectedOpportunity ? [snapshot.selectedOpportunity] : []),
  ]) {
    if (Number(opportunity.accountId || 0) === accountId) {
      opportunities.set(Number(opportunity.id), opportunity);
    }
  }
  return [...opportunities.values()];
}

function scopeCustomerSnapshot(snapshot) {
  const accountId = Number(snapshot.account?.id || 0);
  if (!accountId) {
    return {
      ...snapshot,
      selectedOpportunity: null,
      opportunities: [],
      inactiveOpportunities: [],
      contacts: [],
      interactions: [],
      activities: [],
    };
  }
  const isInScope = (record) => Number(record.accountId || 0) === accountId;
  const opportunities = (snapshot.opportunities || []).filter(isInScope);
  const inactiveOpportunities = (snapshot.inactiveOpportunities || []).filter(isInScope);
  const selectedOpportunity = isInScope(snapshot.selectedOpportunity || {})
    ? snapshot.selectedOpportunity
    : null;
  const opportunityIds = new Set([
    ...opportunities,
    ...inactiveOpportunities,
    ...(selectedOpportunity ? [selectedOpportunity] : []),
  ].map((opportunity) => Number(opportunity.id)));
  const contacts = (snapshot.contacts || []).filter(isInScope);
  const interactions = (snapshot.interactions || []).filter(isInScope);
  const activities = (snapshot.activities || []).filter(
    (activity) =>
      isInScope(activity) &&
      (!activity.opportunityId || opportunityIds.has(Number(activity.opportunityId))),
  );
  return {
    ...snapshot,
    selectedOpportunity,
    opportunities,
    inactiveOpportunities,
    contacts,
    interactions,
    activities,
  };
}

function buildCustomerCoachSnapshot(snapshot, quotation) {
  const account = snapshot.account;
  const accountId = Number(account?.id || 0) || null;
  const accountName = account?.name || "";
  const activities = snapshot.activities || snapshot.interactions || [];
  const opportunities = opportunityRecords(snapshot).map((opportunity) => ({
    ...opportunity,
    account: { id: accountId, name: accountName },
    activities: activities.filter(
      (activity) => Number(activity.opportunityId || 0) === Number(opportunity.id),
    ),
  }));
  const leads = (snapshot.interactions || [])
    .filter(
      (interaction) =>
        interaction.leadSubstatusCode ||
        interaction.leadReasonCode ||
        interaction.leadRequiredActionCode,
    )
    .map((interaction) => ({
      ...interaction,
      title: interaction.title,
      accountId,
      accountName,
      opportunityId: Number(interaction.opportunityId || 0) || null,
      status: interaction.leadSubstatusCode || "",
    }));
  return {
    accounts: accountRecord(snapshot),
    coachOpportunities: opportunities,
    wonOpportunities: [],
    lostOpportunities: [],
    cancelledOpportunities: [],
    inactivePipelineOpportunities: [],
    contactMappings: snapshot.contacts || [],
    leads,
    selectedOpportunityQuotation: quotation,
  };
}

function customerTools(snapshot) {
  const interactions = snapshot.interactions || [];
  return {
    searchInteractions: ({ text = "" } = {}) => {
      const normalizedText = normalize(text);
      return interactions.filter(
        (interaction) =>
          !normalizedText ||
          normalize(`${interaction.title} ${interaction.summary}`).includes(
            normalizedText,
          ),
      );
    },
  };
}

function executeCustomerReadTool({
  toolName,
  snapshot,
  args = {},
  businessRules = {},
  buildReadiness,
}) {
  if (COACH_READ_TOOL_NAMES.has(toolName)) {
    return executeCoachReadTool({
      toolName,
      snapshot,
      args,
      businessRules,
      buildReadiness,
    });
  }
  const scope = businessRules.scope || {};
  const denied =
    (toolName === "searchAccounts" && scope.accountSearchAllowed === false) ||
    (["searchOpportunities", "getOpportunity", "getOpportunityQuotation"].includes(toolName) &&
      scope.opportunitySearchAllowed === false) ||
    (toolName === "searchContacts" && scope.contactSearchAllowed === false);
  if (denied) {
    return {
      toolName,
      readOnly: true,
      result: null,
      error: "Herramienta no permitida por la politica del canal.",
    };
  }
  const effectiveArgs =
    toolName === "searchOpportunities"
      ? {
          ...args,
          activeOnly: args.inactiveOnly
            ? false
            : args.activeOnly || businessRules.filters?.defaultActiveOnly,
          inactiveOnly: args.activeOnly
            ? false
            : args.inactiveOnly || businessRules.filters?.defaultInactiveOnly,
          openOnly: args.openOnly || businessRules.filters?.defaultOpenOnly,
        }
      : args;
  const tools = customerTools(snapshot);
  const execute = tools[toolName];
  if (!execute) throw new Error(`Read tool no soportada: ${toolName}`);
  return {
    toolName,
    readOnly: true,
    result: execute(effectiveArgs),
  };
}

export async function buildCustomerReadModel({
  user,
  question,
  snapshot,
  availableTools,
  conversationHistory = [],
  businessRules = {},
}) {
  snapshot = scopeCustomerSnapshot(snapshot || {});
  const crmSnapshot = {
    accounts: accountRecord(snapshot),
    coachOpportunities: opportunityRecords(snapshot),
    wonOpportunities: [],
    lostOpportunities: [],
    cancelledOpportunities: [],
    contactMappings: snapshot.contacts || [],
    leads: [],
  };
  const resolution = resolveCoachEntities(crmSnapshot, question, businessRules);
  const opportunityFilters = inferCoachOpportunityFilters(question, businessRules);
  const scope = businessRules.scope || {};
  const selectedOpportunity =
    snapshot.selectedOpportunity || resolution.opportunity || null;
  const queryCase = matchCoachQueryCase(question);
  const toolNames = new Set(availableTools.map((tool) => tool.name));
  const selectedOpportunityQuotation =
    queryCase?.readTool === "getOpportunityQuotation" &&
    selectedOpportunity &&
    scope.opportunitySearchAllowed !== false &&
    toolNames.has("getOpportunityQuotation")
      ? await getAuthorizedCoachQuotationContent({
          user,
          opportunityId: selectedOpportunity.id,
        })
      : null;
  const coachSnapshot = buildCustomerCoachSnapshot(
    snapshot,
    selectedOpportunityQuotation,
  );
  const normalizedQuestion = normalize(question);
  const readToolResults = [];
  const availableNames = new Set(availableTools.map((tool) => tool.name));
  const pushTool = (toolName, args = {}) => {
    if (!availableNames.has(toolName)) return;
    const isCoachTool = COACH_READ_TOOL_NAMES.has(toolName);
    readToolResults.push(
      executeCustomerReadTool({
        toolName,
        snapshot: isCoachTool ? coachSnapshot : snapshot,
        args,
        businessRules,
        buildReadiness: (opportunity) =>
          buildStageReadiness(opportunity, { currentUserId: Number(user?.id) }),
      }),
    );
  };
  pushTool("searchAccounts");
  if (/\b(oportunidad|oportunidades|pipeline|etapa|waiting|negociacion)\b/.test(normalizedQuestion)) {
    pushTool("searchOpportunities", {
      openOnly: /\b(abierta|abiertas|pipeline|en proceso)\b/.test(
        normalizedQuestion,
      ),
      stageCodes: opportunityFilters.stageCodes,
      commercialStatusCodes: opportunityFilters.commercialStatusCodes,
      activeOnly: opportunityFilters.activeOnly,
      inactiveOnly: opportunityFilters.inactiveOnly,
    });
  }
  if (/\b(contacto|contactos|decisor|eduardo|persona)\b/.test(normalizedQuestion)) {
    pushTool("searchContacts");
  }
  if (/\b(interaccion|interacciones|actividad|actividades|correo|email|llamada|riesgo)\b/.test(normalizedQuestion)) {
    pushTool("searchInteractions");
  }
  if (selectedOpportunity && /\b(detalle|monto|importe|etapa|oportunidad)\b/.test(normalizedQuestion)) {
    pushTool("getOpportunity", { opportunityId: selectedOpportunity.id });
  }
  if (selectedOpportunity && /\b(actividad|actividades|siguiente paso|proximo paso)\b/.test(normalizedQuestion)) {
    pushTool("getOpportunityActivities", { opportunityId: selectedOpportunity.id });
  }
  if (selectedOpportunity && isStagePreparationQuestion(question)) {
    pushTool("getOpportunityReadiness", { opportunityId: selectedOpportunity.id });
  }
  if (/\b(pipeline|cobertura|riesgo|riesgos|prioridades)\b/.test(normalizedQuestion)) {
    pushTool("getSellerPipeline");
  }
  if (/\b(lead|leads|prospecto|prospectos)\b/.test(normalizedQuestion)) {
    pushTool("searchLeads", { accountId: snapshot.account?.id || null });
  }
  if (queryCase?.readTool === "getOpportunityQuotation" && selectedOpportunity) {
    pushTool("getOpportunityQuotation", {
      opportunityId: selectedOpportunity.id,
    });
  }
  const modelSnapshot = {
    account:
      scope.accountSearchAllowed === false
        ? null
        : snapshot.account,
    opportunities:
      scope.opportunitySearchAllowed === false
        ? []
        : snapshot.opportunities || [],
    inactiveOpportunities:
      scope.opportunitySearchAllowed === false
        ? []
        : snapshot.inactiveOpportunities || [],
    contacts:
      scope.contactSearchAllowed === false
        ? []
        : snapshot.contacts || [],
    interactions: snapshot.interactions || [],
    accountHealth: snapshot.accountHealth,
    expansionHypotheses: snapshot.expansionHypotheses || [],
    selectedOpportunity:
      scope.opportunitySearchAllowed === false
        ? null
        : selectedOpportunity,
    selectedOpportunityQuotation,
    selectedContext: {
      accountId: snapshot.account?.id || null,
      opportunityId: selectedOpportunity?.id || null,
      contactId: snapshot.selectedContact?.id || null,
      leadId: null,
    },
    readToolResults,
  };
  return {
    baseSnapshot: crmSnapshot,
    effectiveContext: modelSnapshot.selectedContext,
    explicitEntities: resolution,
    questionContextTransition: { changed: false, context: modelSnapshot.selectedContext },
    scopedSnapshot: modelSnapshot,
    preparationRequested: false,
    selectedOpportunity,
    deterministicStageReadiness: null,
    readToolResults,
    modelSnapshot,
    clarification:
      queryCase?.type === "quotation_query" &&
      !toolNames.has("getOpportunityQuotation")
        ? {
            type: "missing_fields",
            message:
              "No tienes permisos para consultar cotizaciones en esta cuenta.",
            missing: ["Permiso de lectura de cotizaciones"],
            candidates: [],
            originalRequest: question,
            intendedAction: "continue_request",
          }
        : queryCase?.requiresOpportunityContext && !selectedOpportunity
        ? {
            type: "select_opportunity",
            message:
              queryCase.type === "quotation_query"
                ? "Selecciona una oportunidad para consultar el contenido de su cotización."
                : "Selecciona una oportunidad para consultar sus actividades y siguientes pasos.",
            missing: ["Oportunidad"],
            candidates:
              queryCase.type === "quotation_query" &&
              scope.opportunitySearchAllowed !== false
                ? opportunityRecords(snapshot).slice(0, 20).map((opportunity) => ({
                    id: Number(opportunity.id),
                    name: opportunity.name || "Oportunidad sin nombre",
                    accountId: Number(opportunity.accountId || snapshot.account?.id || 0) || null,
                    opportunityId: Number(opportunity.id),
                    accountName: snapshot.account?.name || null,
                    stageName: opportunity.stageName || null,
                    entityType: "opportunity",
                  }))
                : [],
            originalRequest: question,
            intendedAction: "continue_request",
          }
          : queryCase?.type === "quotation_query" &&
            selectedOpportunity &&
            !selectedOpportunityQuotation
          ? {
              type: "missing_fields",
              message:
                "No encontré una cotización accesible para esta oportunidad.",
              missing: ["Cotización vigente y accesible"],
              candidates: [],
              originalRequest: question,
              intendedAction: "continue_request",
            }
          : null,
    conversationHistory,
  };
}

export function buildCustomerFallback(snapshot, question) {
  const normalizedQuestion = normalize(question);
  const openOpportunities = (snapshot.opportunities || []).filter(isOpen);
  const accountName = snapshot.account?.name || "la cuenta seleccionada";
  const evidence = [`Snapshot CRM capturado: ${snapshot.capturedAt}`];
  const risk = snapshot.accountHealth?.signals?.find(
    (signal) => signal.severity === "high",
  );
  const recommendedActions = risk
    ? [
        {
          title: risk.title,
          opportunityId:
            risk.entityType === "opportunity"
              ? risk.entityId
              : openOpportunities[0]?.id || null,
          actionType: "call",
          notes: "Revisar desde Cliente existente.",
          successCriteria: "Validar la señal con el cliente.",
          requiresConfirmation: true,
        },
      ]
    : [];
  if (/\b(correo|email|mail|modelo|enviar|mensaje)\b/.test(normalizedQuestion)) {
    return {
      answer: `Borrador de correo para solicitar una conversación comercial con ${snapshot.account?.name || "la cuenta"}.`,
      evidence,
      inferences: [],
      confidence: "low",
      recommendedActions,
      source: "account_intelligence",
    };
  }
  if (/\b(oportunidad|oportunidades|pipeline)\b/.test(normalizedQuestion)) {
    return {
      answer: `La cuenta ${accountName} tiene ${openOpportunities.length} oportunidad(es) abierta(s): ${openOpportunities.map((item) => item.name).join(", ") || "ninguna"}.`,
      evidence,
      inferences: [],
      confidence: "medium",
      recommendedActions,
      source: "account_intelligence",
    };
  }
  return {
    answer: `La cuenta ${accountName} tiene ${snapshot.contacts?.length || 0} contacto(s), ${openOpportunities.length} oportunidad(es) abiertas y ${snapshot.interactions?.length || 0} interacción(es) recientes.`,
    evidence,
    inferences: [],
    confidence: "low",
    recommendedActions,
    source: "account_intelligence",
  };
}

export function appendCustomerAccountChatHistory(
  history = [],
  question,
  answer,
) {
  const normalizedHistory = (Array.isArray(history) ? history : [])
    .filter(
      (message) =>
        ["user", "assistant"].includes(message?.role) &&
        String(message?.text || "").trim(),
    )
    .map((message) => ({
      role: message.role,
      text: String(message.text).trim().slice(0, 2000),
    }));
  return [
    ...normalizedHistory,
    question ? { role: "user", text: String(question).trim().slice(0, 2000) } : null,
    answer ? { role: "assistant", text: String(answer).trim().slice(0, 2000) } : null,
  ]
    .filter(Boolean)
    .slice(-8);
}

function buildCustomerPrompt(
  snapshot,
  question,
  _processGuide,
  context,
  conversationHistory = [],
) {
  return {
    question,
    context: snapshot,
    selectedContext: context,
    conversationHistory,
    instruction:
      "Responde la solicitud sobre la cuenta usando solo el CRM autorizado. Si se pide un correo, redacta un borrador y no lo envíes. Todas las acciones requieren confirmación.",
  };
}

function normalizeCustomerResponse(result, _snapshot, _question, context) {
  const normalized = result || {};
  const recommendedActions = Array.isArray(normalized.recommendedActions)
    ? normalized.recommendedActions
        .map((action) => ({
          ...action,
          opportunityId: Number(action.opportunityId || 0) || null,
          requiresConfirmation: true,
        }))
        .slice(0, 5)
    : [];
  return {
    answer: String(normalized.answer || "No fue posible responder la pregunta."),
    evidence: Array.isArray(normalized.evidence) ? normalized.evidence : [],
    inferences: Array.isArray(normalized.inferences) ? normalized.inferences : [],
    confidence: ["high", "medium", "low"].includes(normalized.confidence)
      ? normalized.confidence
      : "low",
    recommendedActions,
    source: "account_intelligence",
    entities: {
      accountId: context.accountId || null,
      opportunityId: context.opportunityId || null,
      contactId: context.contactId || null,
      leadId: null,
      names: [],
    },
    operations: recommendedActions.map((action) =>
      normalizeActivityOperation(action, context),
    ),
    clarification: null,
  };
}

export function createCustomerAccountAdapter({ user, snapshot, agents, jobId }) {
  const permissions = user?.permissionSet || new Set();
  const availableTools = [
    ...COACH_READ_TOOL_CATALOG,
    { name: "searchInteractions", requiredPermission: "interacciones.read", readOnly: true },
  ];
  const dependencies = {
    prepareReadModel: async ({
      question,
      availableTools: resolvedTools,
      conversationHistory,
      businessRules,
    }) =>
      buildCustomerReadModel({
        user,
        question,
        snapshot,
        availableTools: resolvedTools,
        conversationHistory,
        businessRules,
      }),
    executeReadTool: ({
      toolName,
      snapshot: scopedSnapshot,
      args,
      businessRules,
    }) => executeCustomerReadTool({
      toolName,
      snapshot: scopedSnapshot,
      args,
      businessRules,
    }),
    buildStageReadiness: (opportunity) =>
      buildStageReadiness(opportunity, { currentUserId: Number(user?.id) }),
    isStagePreparationQuestion,
    loadProcessGuide: async () => "",
    buildPrompt: buildCustomerPrompt,
    requestResponse: async ({ payload }) => {
      const fallback = buildCustomerFallback(snapshot, payload.question);
      const aiResult = await runStructuredTextResearch({
        schemaName: "account_contextual_chat",
        systemPrompt:
          "Responde preguntas comerciales sobre una cuenta usando exclusivamente el contexto autorizado. No inventes datos. Si solicitan un correo, devuelve un borrador; no lo envíes.",
        subject: snapshot.account?.name || "cuenta",
        context: { ...payload, agents },
        currentValues: {},
        fields: [
          { key: "answer", type: "string", example: fallback.answer },
          { key: "evidence", type: "array", example: [], items: { type: "string", example: "Evidencia" } },
          { key: "inferences", type: "array", example: [], items: { type: "string", example: "Hipótesis" } },
          { key: "confidence", type: "enum", enum: ["high", "medium", "low"], example: "medium" },
          { key: "recommendedActions", type: "array", example: [], items: { type: "object", fields: [
            { key: "title", type: "string", example: "Actividad" },
            { key: "opportunityId", type: "string", example: "" },
            { key: "actionType", type: "string", example: "call" },
            { key: "notes", type: "string", example: "Notas" },
            { key: "successCriteria", type: "string", example: "Criterio" },
            { key: "requiresConfirmation", type: "string", example: "true" },
          ] } },
          { key: "source", type: "string", example: "account_intelligence" },
        ],
        aiUsageContext: {
          userId: Number(user.id),
          featureCode: "commercial_intelligence.account_chat",
          jobType: "account_chat",
          jobId,
        },
      });
      return aiResult || fallback;
    },
    resolveResponseContext: (_snapshot, context) => ({
      context,
      changed: false,
      conflict: null,
    }),
    normalizeResponse: (result, scopedSnapshot, question, context) =>
      normalizeCustomerResponse(result, scopedSnapshot, question, context),
    featureCode: "commercial_intelligence.account_chat",
  };
  return {
    channel: "customer_account",
    availableTools,
    permissions,
    channelRules: { accountScoped: true, noSharedCoachSession: true },
    operationPolicy: {
      allowedKinds: ["activity"],
      sourceChannel: "customer_account",
    },
    async runTurn({ question, context = {}, history = [] }) {
      const businessRules = await loadCoachBusinessRules({
        channel: "customer_account",
        process: "account_chat",
      });
      return runConversationEngine({
        question,
        context,
        history,
        user,
        jobId,
        availableTools,
        channelRules: this.channelRules,
        permissions,
        operationPolicy: this.operationPolicy,
        businessRules,
        dependencies,
      });
    },
  };
}
