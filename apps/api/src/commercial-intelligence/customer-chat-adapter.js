import { runStructuredTextResearch } from "../structuredWebResearch.js";
import { resolveCoachEntities } from "../coach/entity-resolver.js";
import { executeCoachReadTool } from "../coach/crm-read-tools.js";
import { runConversationEngine } from "../coach/conversation-engine.js";
import { normalizeActivityOperation } from "../coach/operation-contract.js";
import { filterValidCoachOperations } from "../coach/contract.js";
import {
  buildStageReadiness,
  isStagePreparationQuestion,
} from "../coach/stage-readiness.js";
import {
  getCoachReadToolCatalog,
  inferCoachOpportunityFilters,
} from "../coach/read-tools.js";
import { loadCoachBusinessRules } from "../coach/business-rules.js";
import { listCoachAdminRules } from "../coach/admin-rules.js";
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
  const inactiveOpportunities = (snapshot.inactiveOpportunities || []).filter(
    isInScope,
  );
  const selectedOpportunity = isInScope(snapshot.selectedOpportunity || {})
    ? snapshot.selectedOpportunity
    : null;
  const opportunityIds = new Set(
    [
      ...opportunities,
      ...inactiveOpportunities,
      ...(selectedOpportunity ? [selectedOpportunity] : []),
    ].map((opportunity) => Number(opportunity.id)),
  );
  const contacts = (snapshot.contacts || []).filter(isInScope);
  const interactions = (snapshot.interactions || []).filter(isInScope);
  const activities = (snapshot.activities || []).filter(
    (activity) =>
      isInScope(activity) &&
      (!activity.opportunityId ||
        opportunityIds.has(Number(activity.opportunityId))),
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
      (activity) =>
        Number(activity.opportunityId || 0) === Number(opportunity.id),
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
    ([
      "searchOpportunities",
      "getOpportunity",
      "getOpportunityQuotation",
    ].includes(toolName) &&
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
  const opportunityFilters = inferCoachOpportunityFilters(
    question,
    businessRules,
  );
  const scope = businessRules.scope || {};
  const selectedOpportunity =
    snapshot.selectedOpportunity || resolution.opportunity || null;
  const queryCase = matchCoachQueryCase(question);
  const toolNames = new Set(availableTools.map((tool) => tool.name));
  const selectedOpportunityQuotation =
    queryCase?.readTool === "getOpportunityQuotation" &&
    selectedOpportunity &&
    scope.opportunitySearchAllowed !== false &&
    scope.quotationSearchAllowed !== false &&
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
  if (
    /\b(oportunidad|oportunidades|pipeline|etapa|waiting|negociacion)\b/.test(
      normalizedQuestion,
    )
  ) {
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
  if (
    /\b(contacto|contactos|decisor|eduardo|persona)\b/.test(normalizedQuestion)
  ) {
    pushTool("searchContacts");
  }
  if (
    /\b(interaccion|interacciones|actividad|actividades|correo|email|llamada|riesgo)\b/.test(
      normalizedQuestion,
    )
  ) {
    pushTool("searchInteractions");
  }
  if (
    selectedOpportunity &&
    /\b(detalle|monto|importe|etapa|oportunidad)\b/.test(normalizedQuestion)
  ) {
    pushTool("getOpportunity", { opportunityId: selectedOpportunity.id });
  }
  if (
    selectedOpportunity &&
    /\b(actividad|actividades|siguiente paso|proximo paso)\b/.test(
      normalizedQuestion,
    )
  ) {
    pushTool("getOpportunityActivities", {
      opportunityId: selectedOpportunity.id,
    });
  }
  if (selectedOpportunity && isStagePreparationQuestion(question)) {
    pushTool("getOpportunityReadiness", {
      opportunityId: selectedOpportunity.id,
    });
  }
  if (
    /\b(pipeline|cobertura|riesgo|riesgos|prioridades)\b/.test(
      normalizedQuestion,
    )
  ) {
    pushTool("getSellerPipeline");
  }
  if (/\b(lead|leads|prospecto|prospectos)\b/.test(normalizedQuestion)) {
    pushTool("searchLeads", { accountId: snapshot.account?.id || null });
  }
  if (
    queryCase?.readTool === "getOpportunityQuotation" &&
    selectedOpportunity
  ) {
    pushTool("getOpportunityQuotation", {
      opportunityId: selectedOpportunity.id,
    });
  }
  const modelSnapshot = {
    account: scope.accountSearchAllowed === false ? null : snapshot.account,
    opportunities:
      scope.opportunitySearchAllowed === false
        ? []
        : snapshot.opportunities || [],
    inactiveOpportunities:
      scope.opportunitySearchAllowed === false
        ? []
        : snapshot.inactiveOpportunities || [],
    contacts:
      scope.contactSearchAllowed === false ? [] : snapshot.contacts || [],
    interactions: snapshot.interactions || [],
    accountHealth: snapshot.accountHealth,
    expansionHypotheses: snapshot.expansionHypotheses || [],
    selectedOpportunity:
      scope.opportunitySearchAllowed === false ? null : selectedOpportunity,
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
    questionContextTransition: {
      changed: false,
      context: modelSnapshot.selectedContext,
    },
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
                  ? opportunityRecords(snapshot)
                      .slice(0, 20)
                      .map((opportunity) => ({
                        id: Number(opportunity.id),
                        name: opportunity.name || "Oportunidad sin nombre",
                        accountId:
                          Number(
                            opportunity.accountId || snapshot.account?.id || 0,
                          ) || null,
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
  if (
    /\b(correo|email|mail|modelo|enviar|mensaje)\b/.test(normalizedQuestion)
  ) {
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
    question
      ? { role: "user", text: String(question).trim().slice(0, 2000) }
      : null,
    answer
      ? { role: "assistant", text: String(answer).trim().slice(0, 2000) }
      : null,
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
  const administrativeRules = Array.isArray(snapshot?.administrativeRules)
    ? snapshot.administrativeRules
        .filter((rule) => rule?.enabled && rule?.instruction)
        .map((rule) => `- ${rule.title}: ${rule.instruction}`)
    : [];
  return {
    question,
    context: snapshot,
    selectedContext: context,
    conversationHistory,
    instruction:
      "Responde la solicitud sobre la cuenta usando solo el CRM autorizado. Si se pide un correo, redacta un borrador y no lo envíes. Si solicitan un cambio, devuelve operations con el tipo de operación y los IDs exactos del contexto de esta cuenta; nunca propongas una entidad de otra cuenta. Toda operación es una propuesta editable que requiere revisión y confirmación; no afirmes que ya fue ejecutada." +
      (administrativeRules.length
        ? `\n\nReglas administrativas activas para este canal; aplícalas sin ampliar el alcance autorizado ni omitir permisos o confirmaciones:\n${administrativeRules.join("\n")}`
        : ""),
  };
}

export function normalizeCustomerOperations(operations, snapshot, context) {
  const accountId = Number(snapshot?.account?.id || context.accountId || 0);
  const contactIds = new Set(
    (snapshot?.contacts || []).map((item) => Number(item.id)).filter(Boolean),
  );
  const opportunityIds = new Set(
    [
      ...(snapshot?.opportunities || []),
      ...(snapshot?.inactiveOpportunities || []),
      ...(snapshot?.selectedOpportunity ? [snapshot.selectedOpportunity] : []),
    ]
      .filter((item) => Number(item.accountId || accountId) === accountId)
      .map((item) => Number(item.id))
      .filter(Boolean),
  );
  const interactionIds = new Set(
    (snapshot?.interactions || [])
      .map((item) => Number(item.id))
      .filter(Boolean),
  );
  const candidates = (Array.isArray(operations) ? operations : []).map(
    (item) => {
      const operation = {
        ...item,
        sourceChannel: "customer_account",
        requiresConfirmation: true,
      };
      if (
        ["activity", "stage_answer", "opportunity_field"].includes(
          operation.kind,
        )
      ) {
        operation.opportunityId =
          Number(operation.opportunityId || context.opportunityId || 0) || null;
      }
      if (operation.kind === "account_field") {
        operation.accountId = Number(operation.accountId || accountId) || null;
      }
      if (operation.kind === "contact_field") {
        operation.contactId =
          Number(operation.contactId || context.contactId || 0) || null;
      }
      return operation;
    },
  );
  return filterValidCoachOperations(candidates).filter((operation) => {
    if (operation.kind === "account_field")
      return Number(operation.accountId) === accountId;
    if (operation.kind === "contact_field")
      return contactIds.has(Number(operation.contactId));
    if (
      ["activity", "stage_answer", "opportunity_field"].includes(operation.kind)
    )
      return opportunityIds.has(Number(operation.opportunityId));
    if (operation.kind === "lead_call_outcome")
      return interactionIds.has(Number(operation.interactionId));
    return false;
  });
}

function normalizeCustomerResponse(result, snapshot, _question, context) {
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
  const operations = normalizeCustomerOperations(
    normalized.operations,
    snapshot,
    context,
  );
  for (const operation of operations) {
    if (operation.kind !== "activity") continue;
    if (
      !recommendedActions.some(
        (action) =>
          Number(action.opportunityId || 0) ===
            Number(operation.opportunityId || 0) &&
          action.title === operation.title,
      )
    ) {
      recommendedActions.push({
        title: operation.title,
        opportunityId: operation.opportunityId,
        actionType: operation.actionType,
        notes: operation.notes,
        successCriteria: operation.successCriteria,
        dueDate: operation.dueDate,
        scheduledAt: operation.scheduledAt,
        evidence: operation.evidence,
      });
    }
  }
  for (const action of recommendedActions) {
    const activity = normalizeActivityOperation(action, context);
    if (
      activity.opportunityId &&
      !operations.some(
        (operation) =>
          operation.kind === "activity" &&
          Number(operation.opportunityId) === Number(activity.opportunityId) &&
          operation.title === activity.title,
      )
    ) {
      operations.push(activity);
    }
  }
  return {
    answer: String(
      normalized.answer || "No fue posible responder la pregunta.",
    ),
    evidence: Array.isArray(normalized.evidence) ? normalized.evidence : [],
    inferences: Array.isArray(normalized.inferences)
      ? normalized.inferences
      : [],
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
    operations,
    clarification: null,
  };
}

export function createCustomerAccountAdapter({
  user,
  snapshot,
  agents,
  jobId,
}) {
  const permissions = user?.permissionSet || new Set();
  const availableTools = [
    ...COACH_READ_TOOL_CATALOG,
    {
      name: "searchInteractions",
      requiredPermission: "interacciones.read",
      readOnly: true,
    },
  ];
  const dependencies = {
    loadAdministrativeRules: listCoachAdminRules,
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
    }) =>
      executeCustomerReadTool({
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
          "Responde preguntas comerciales sobre una cuenta usando exclusivamente el contexto autorizado. No inventes datos. Puedes proponer activity, stage_answer, lead_call_outcome, account_field, contact_field u opportunity_field si la petición es explícita y los datos están respaldados por el contexto de esta cuenta. Las operaciones son borradores para revisión y confirmación; nunca las ejecutes. Si solicitan un correo, devuelve un borrador; no lo envíes.",
        subject: snapshot.account?.name || "cuenta",
        context: { ...payload, agents },
        currentValues: {},
        fields: [
          { key: "answer", type: "string", example: fallback.answer },
          {
            key: "evidence",
            type: "array",
            example: [],
            items: { type: "string", example: "Evidencia" },
          },
          {
            key: "inferences",
            type: "array",
            example: [],
            items: { type: "string", example: "Hipótesis" },
          },
          {
            key: "confidence",
            type: "enum",
            enum: ["high", "medium", "low"],
            example: "medium",
          },
          {
            key: "recommendedActions",
            type: "array",
            example: [],
            items: {
              type: "object",
              fields: [
                { key: "title", type: "string", example: "Actividad" },
                { key: "opportunityId", type: "string", example: "" },
                { key: "actionType", type: "string", example: "call" },
                { key: "notes", type: "string", example: "Notas" },
                { key: "successCriteria", type: "string", example: "Criterio" },
                {
                  key: "requiresConfirmation",
                  type: "string",
                  example: "true",
                },
              ],
            },
          },
          {
            key: "operations",
            type: "array",
            example: [],
            items: {
              type: "object",
              fields: [
                {
                  key: "kind",
                  type: "enum",
                  enum: [
                    "activity",
                    "stage_answer",
                    "lead_call_outcome",
                    "account_field",
                    "contact_field",
                    "opportunity_field",
                  ],
                  example: "opportunity_field",
                },
                { key: "title", type: "string", example: "Actualizar importe" },
                { key: "accountId", type: "number", example: 7 },
                { key: "contactId", type: "number", example: 12 },
                { key: "opportunityId", type: "number", example: 18 },
                { key: "interactionId", type: "number", example: 25 },
                { key: "field", type: "string", example: "amountUsd" },
                { key: "currentValue", type: "string", example: "10000" },
                { key: "value", type: "string", example: "12000" },
                { key: "questionId", type: "number", example: 4 },
                { key: "answerValue", type: "string", example: "" },
                {
                  key: "answerMode",
                  type: "enum",
                  enum: ["replace", "append"],
                  example: "replace",
                },
                { key: "substatusCode", type: "string", example: "" },
                { key: "reasonCode", type: "string", example: "" },
                { key: "requiredActionCode", type: "string", example: "" },
                { key: "comment", type: "string", example: "" },
                {
                  key: "actionType",
                  type: "enum",
                  enum: [
                    "next_step",
                    "follow_up",
                    "call",
                    "meeting",
                    "conference",
                    "presentation",
                    "visit",
                    "send_email",
                    "waiting_customer",
                    "demo",
                    "quotation",
                    "negotiation",
                    "other",
                  ],
                  example: "call",
                },
                {
                  key: "status",
                  type: "enum",
                  enum: ["pending", "in_progress", "blocked", "done"],
                  example: "pending",
                },
                {
                  key: "priority",
                  type: "enum",
                  enum: ["low", "medium", "high"],
                  example: "medium",
                },
                { key: "scheduledAt", type: "string", example: "" },
                { key: "dueDate", type: "string", example: "" },
                { key: "notes", type: "string", example: "" },
                { key: "successCriteria", type: "string", example: "" },
                {
                  key: "evidence",
                  type: "array",
                  example: [],
                  items: {
                    type: "object",
                    fields: [
                      {
                        key: "sourceType",
                        type: "string",
                        example: "opportunity",
                      },
                      { key: "sourceId", type: "number", example: 18 },
                      { key: "label", type: "string", example: "Dato CRM" },
                      { key: "excerpt", type: "string", example: "" },
                    ],
                  },
                },
              ],
            },
          },
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
      allowedKinds: [
        "activity",
        "stage_answer",
        "lead_call_outcome",
        "account_field",
        "contact_field",
        "opportunity_field",
      ],
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
