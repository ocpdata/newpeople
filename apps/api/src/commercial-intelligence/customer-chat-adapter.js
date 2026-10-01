import { runStructuredTextResearch } from "../structuredWebResearch.js";
import { resolveCoachEntities } from "../coach/entity-resolver.js";
import { runConversationEngine } from "../coach/conversation-engine.js";
import { normalizeActivityOperation } from "../coach/operation-contract.js";

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
  return [
    ...(snapshot.opportunities || []),
    ...(snapshot.inactiveOpportunities || []),
  ];
}

function customerTools(snapshot) {
  const opportunities = opportunityRecords(snapshot);
  const contacts = snapshot.contacts || [];
  const interactions = snapshot.interactions || [];
  return {
    searchAccounts: () => accountRecord(snapshot),
    searchOpportunities: ({ text = "", openOnly = false } = {}) => {
      const normalizedText = normalize(text);
      return opportunities.filter((opportunity) => {
        if (openOnly && !isOpen(opportunity)) return false;
        if (!normalizedText) return true;
        return normalize(opportunity.name).includes(normalizedText);
      });
    },
    getOpportunity: ({ opportunityId } = {}) =>
      opportunities.find((item) => Number(item.id) === Number(opportunityId)) ||
      null,
    searchContacts: ({ text = "" } = {}) => {
      const normalizedText = normalize(text);
      return contacts.filter(
        (contact) =>
          !normalizedText || normalize(contact.name).includes(normalizedText),
      );
    },
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

function executeCustomerReadTool({ toolName, snapshot, args = {} }) {
  const tools = customerTools(snapshot);
  const execute = tools[toolName];
  if (!execute) throw new Error(`Read tool no soportada: ${toolName}`);
  return {
    toolName,
    readOnly: true,
    result: execute(args),
  };
}

function buildCustomerReadModel({ user, question, snapshot, availableTools }) {
  const crmSnapshot = {
    accounts: accountRecord(snapshot),
    coachOpportunities: opportunityRecords(snapshot),
    wonOpportunities: [],
    lostOpportunities: [],
    cancelledOpportunities: [],
    contactMappings: snapshot.contacts || [],
    leads: [],
  };
  const resolution = resolveCoachEntities(crmSnapshot, question);
  const selectedOpportunity =
    snapshot.selectedOpportunity || resolution.opportunity || null;
  const normalizedQuestion = normalize(question);
  const readToolResults = [];
  const availableNames = new Set(availableTools.map((tool) => tool.name));
  const pushTool = (toolName, args = {}) => {
    if (!availableNames.has(toolName)) return;
    readToolResults.push(executeCustomerReadTool({ toolName, snapshot, args }));
  };
  pushTool("searchAccounts");
  if (/\b(oportunidad|oportunidades|pipeline|etapa|waiting|negociacion)\b/.test(normalizedQuestion)) {
    pushTool("searchOpportunities", {
      openOnly: /\b(abierta|abiertas|pipeline|en proceso)\b/.test(
        normalizedQuestion,
      ),
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
  const modelSnapshot = {
    account: snapshot.account,
    opportunities: snapshot.opportunities || [],
    inactiveOpportunities: snapshot.inactiveOpportunities || [],
    contacts: snapshot.contacts || [],
    interactions: snapshot.interactions || [],
    accountHealth: snapshot.accountHealth,
    expansionHypotheses: snapshot.expansionHypotheses || [],
    selectedOpportunity,
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
    clarification: null,
    conversationHistory: [],
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

function buildCustomerPrompt(snapshot, question, _processGuide, context) {
  return {
    question,
    context: snapshot,
    selectedContext: context,
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
    { name: "searchAccounts", requiredPermission: "cuentas.read" },
    { name: "searchOpportunities", requiredPermission: "oportunidades.read" },
    { name: "getOpportunity", requiredPermission: "oportunidades.read" },
    { name: "searchContacts", requiredPermission: "contactos.read" },
    { name: "searchInteractions", requiredPermission: "interacciones.read" },
  ];
  const dependencies = {
    prepareReadModel: async ({ question, availableTools: resolvedTools }) =>
      buildCustomerReadModel({
        user,
        question,
        snapshot,
        availableTools: resolvedTools,
      }),
    executeReadTool: ({ toolName, snapshot: scopedSnapshot, args }) =>
      executeCustomerReadTool({ toolName, snapshot: scopedSnapshot, args }),
    buildStageReadiness: () => null,
    isStagePreparationQuestion: () => false,
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
    runTurn({ question, context = {}, history = [] }) {
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
        dependencies,
      });
    },
  };
}
