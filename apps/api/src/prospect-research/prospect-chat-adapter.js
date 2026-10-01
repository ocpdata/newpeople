import { runStructuredTextResearch } from "../structuredWebResearch.js";
import { runConversationEngine } from "../coach/conversation-engine.js";
import { normalizeProspectConversionOperation } from "../coach/operation-contract.js";

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function prospectTools(snapshot) {
  return {
    getProspectProfile: () => snapshot.profile || {},
    searchProspectFindings: ({ text = "" } = {}) => {
      const normalizedText = normalize(text);
      return (snapshot.findings || []).filter(
        (finding) =>
          !normalizedText ||
          normalize(`${finding.title} ${finding.summary}`).includes(
            normalizedText,
          ),
      );
    },
    searchProspectContacts: ({ text = "" } = {}) => {
      const normalizedText = normalize(text);
      return (snapshot.contacts || []).filter(
        (contact) =>
          !normalizedText ||
          normalize(`${contact.roleTitle} ${contact.area} ${contact.name}`).includes(
            normalizedText,
          ),
      );
    },
    searchProspectHypotheses: ({ text = "" } = {}) => {
      const normalizedText = normalize(text);
      return (snapshot.hypotheses || []).filter(
        (hypothesis) =>
          !normalizedText ||
          normalize(
            `${hypothesis.title} ${hypothesis.businessChallenge} ${hypothesis.technologyArea}`,
          ).includes(normalizedText),
      );
    },
  };
}

function executeProspectReadTool({ toolName, snapshot, args = {} }) {
  const execute = prospectTools(snapshot)[toolName];
  if (!execute) throw new Error(`Read tool no soportada: ${toolName}`);
  return { toolName, readOnly: true, result: execute(args) };
}

function buildProspectFallback(snapshot, question) {
  const normalizedQuestion = normalize(question);
  if (/\b(correo|email|mail|mensaje|outreach)\b/.test(normalizedQuestion)) {
    return {
      answer: snapshot.outreach?.body || "No hay un borrador de correo disponible.",
      evidence: ["Borrador generado desde la sesión de prospección."],
      inferences: [],
      confidence: "medium",
      recommendedActions: [],
      source: "prospect_research",
    };
  }
  return {
    answer: `La ficha de ${snapshot.profile?.companyName || "la empresa"} contiene ${snapshot.findings?.length || 0} hallazgo(s), ${snapshot.contacts?.length || 0} contacto(s) objetivo y ${snapshot.hypotheses?.length || 0} hipótesis de oportunidad.`,
    evidence: ["Datos de la sesión de prospección."],
    inferences: [],
    confidence: "medium",
    recommendedActions: [],
    source: "prospect_research",
  };
}

export function createProspectChatAdapter({ user, session, jobId }) {
  const snapshot = {
    profile: session.result?.profile || {
      companyName: session.companyName,
      country: session.country,
      website: session.website,
      industry: session.industry,
    },
    outreach: session.result?.outreach || null,
    findings: session.findings || [],
    contacts: session.contacts || [],
    hypotheses: session.hypotheses || [],
    externalResearch: session.result?.externalResearch || null,
  };
  const permissions = user?.permissionSet || new Set();
  const availableTools = [
    { name: "getProspectProfile", requiredPermission: "prospeccion.read" },
    { name: "searchProspectFindings", requiredPermission: "prospeccion.read" },
    { name: "searchProspectContacts", requiredPermission: "prospeccion.read" },
    { name: "searchProspectHypotheses", requiredPermission: "prospeccion.read" },
  ];
  const dependencies = {
    prepareReadModel: async ({ question, availableTools: resolvedTools }) => {
      const normalizedQuestion = normalize(question);
      const readToolResults = [];
      const names = new Set(resolvedTools.map((tool) => tool.name));
      const pushTool = (toolName, args = {}) => {
        if (names.has(toolName))
          readToolResults.push(executeProspectReadTool({ toolName, snapshot, args }));
      };
      pushTool("getProspectProfile");
      if (/\b(hallazgo|hallazgos|riesgo|reto|evidencia|fuente)\b/.test(normalizedQuestion))
        pushTool("searchProspectFindings");
      if (/\b(contacto|contactos|persona|responsable|eduardo)\b/.test(normalizedQuestion))
        pushTool("searchProspectContacts");
      if (/\b(oportunidad|oportunidades|hipotesis|hipótesis|tecnologia|reto)\b/.test(normalizedQuestion))
        pushTool("searchProspectHypotheses");
      const selectedContext = { prospectSessionId: session.id };
      const modelSnapshot = { ...snapshot, selectedContext, readToolResults };
      return {
        baseSnapshot: snapshot,
        effectiveContext: selectedContext,
        explicitEntities: {},
        questionContextTransition: { changed: false, context: selectedContext },
        scopedSnapshot: modelSnapshot,
        preparationRequested: false,
        selectedOpportunity: null,
        deterministicStageReadiness: null,
        readToolResults,
        modelSnapshot,
        clarification: null,
        conversationHistory: [],
      };
    },
    executeReadTool: ({ toolName, snapshot: scopedSnapshot, args }) =>
      executeProspectReadTool({ toolName, snapshot: scopedSnapshot, args }),
    buildStageReadiness: () => null,
    isStagePreparationQuestion: () => false,
    loadProcessGuide: async () => "",
    buildPrompt: (model, question, _guide, context) => ({
      question,
      context: model,
      selectedContext: context,
      instruction:
        "Usa solo datos de prospección. Distingue datos proporcionados por el vendedor, evidencia pública e inferencias. Nunca presentes un prospecto, contacto o hipótesis como registro CRM confirmado. Las conversiones requieren confirmación explícita.",
    }),
    requestResponse: async ({ payload }) => {
      const fallback = buildProspectFallback(snapshot, payload.question);
      const result = await runStructuredTextResearch({
        schemaName: "prospect_contextual_chat",
        systemPrompt:
          "Responde sobre un prospecto usando únicamente la sesión autorizada. No confundas investigación pública con registros CRM. Las acciones siempre requieren confirmación.",
        subject: snapshot.profile?.companyName || "prospecto",
        context: payload,
        currentValues: {},
        fields: [
          { key: "answer", type: "string", example: fallback.answer },
          { key: "evidence", type: "array", example: [], items: { type: "string", example: "Evidencia" } },
          { key: "inferences", type: "array", example: [], items: { type: "string", example: "Inferencia" } },
          { key: "confidence", type: "enum", enum: ["high", "medium", "low"], example: "medium" },
          { key: "recommendedActions", type: "array", example: [], items: { type: "object", fields: [
            { key: "title", type: "string", example: "Validar hipótesis" },
            { key: "actionType", type: "string", example: "call" },
            { key: "notes", type: "string", example: "Confirmar con el prospecto" },
            { key: "successCriteria", type: "string", example: "Dato validado" },
            { key: "requiresConfirmation", type: "string", example: "true" },
          ] } },
          { key: "source", type: "string", example: "prospect_research" },
        ],
        aiUsageContext: {
          userId: Number(user.id),
          featureCode: "prospect_research.chat",
          jobType: "prospect_chat",
          jobId,
        },
      });
      return result || fallback;
    },
    resolveResponseContext: (_snapshot, context) => ({
      context,
      changed: false,
      conflict: null,
    }),
    normalizeResponse: (result, _snapshot, _question, context) => {
      const recommendedActions = Array.isArray(result?.recommendedActions)
        ? result.recommendedActions.map((action) => ({
            ...action,
            requiresConfirmation: true,
          }))
        : [];
      return {
        answer: String(result?.answer || "No fue posible responder."),
        evidence: Array.isArray(result?.evidence) ? result.evidence : [],
        inferences: Array.isArray(result?.inferences) ? result.inferences : [],
        confidence: result?.confidence || "low",
        recommendedActions,
        source: "prospect_research",
        entities: { accountId: null, opportunityId: null, contactId: null, leadId: null, names: [] },
        operations: recommendedActions.map((action) =>
          normalizeProspectConversionOperation(action, {
            prospectSessionId: context.prospectSessionId,
            target: action.target || "account",
          }),
        ),
        clarification: null,
      };
    },
    featureCode: "prospect_research.chat",
  };
  return {
    channel: "prospect",
    availableTools,
    permissions,
    channelRules: { prospectScoped: true, crmRecordsConfirmedOnly: true },
    operationPolicy: {
      allowedKinds: ["create_account", "create_contact", "create_opportunity"],
      sourceChannel: "prospect",
    },
    runTurn({ question, history = [] }) {
      return runConversationEngine({
        question,
        context: { prospectSessionId: session.id },
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
