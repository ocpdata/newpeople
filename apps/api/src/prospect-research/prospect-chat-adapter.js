import { runStructuredTextResearch } from "../structuredWebResearch.js";
import { runConversationEngine } from "../coach/conversation-engine.js";
import { normalizeProspectConversionOperation } from "../coach/operation-contract.js";
import { loadCoachBusinessRules } from "../coach/business-rules.js";
import { listCoachAdminRules } from "../coach/admin-rules.js";
import { loadChannelIntentConfigurations } from "../coach/channel-intent-governance.js";

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
          normalize(
            `${contact.roleTitle} ${contact.area} ${contact.name}`,
          ).includes(normalizedText),
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

const PROSPECT_CONVERSION_TARGETS = new Set([
  "account",
  "contact",
  "opportunity",
]);

export function normalizeProspectRecommendedActions(actions = []) {
  if (!Array.isArray(actions)) return [];
  return actions
    .filter((action) => {
      const target = String(action?.target || "")
        .trim()
        .toLowerCase();
      const actionType = String(action?.actionType || "")
        .trim()
        .toLowerCase();
      return (
        PROSPECT_CONVERSION_TARGETS.has(target) &&
        ["convert", "conversion", "create"].includes(actionType)
      );
    })
    .map((action) => ({
      ...action,
      target: String(action.target).trim().toLowerCase(),
      requiresConfirmation: true,
    }));
}

export function buildProspectFallback(
  snapshot,
  question,
  channelIntentRouting = null,
) {
  const normalizedQuestion = normalize(question);
  const intent = channelIntentRouting?.intent || "prospect_profile";
  if (/\b(correo|email|mail|mensaje|outreach)\b/.test(normalizedQuestion)) {
    return {
      answer:
        snapshot.outreach?.body || "No hay un borrador de correo disponible.",
      evidence: ["Borrador generado desde la sesión de prospección."],
      inferences: [],
      confidence: "medium",
      recommendedActions: [],
      source: "prospect_research",
    };
  }
  if (intent === "prospect_contacts") {
    const contacts = snapshot.contacts || [];
    return {
      answer: contacts.length
        ? `Contactos potenciales en la sesión (${contacts.length}): ${contacts.map((contact) => [contact.name, contact.roleTitle, contact.area].filter(Boolean).join(" · ")).join("; ")}.`
        : "La sesión no contiene contactos potenciales registrados.",
      evidence: contacts
        .map((contact) => contact.evidence || contact.source || "")
        .filter(Boolean),
      inferences: [],
      confidence: "medium",
      recommendedActions: [],
      source: "prospect_research",
    };
  }
  if (intent === "prospect_findings") {
    const findings = snapshot.findings || [];
    return {
      answer: findings.length
        ? `Hallazgos de la sesión (${findings.length}): ${findings.map((finding) => `${finding.title}${finding.summary ? `: ${finding.summary}` : ""}`).join("; ")}.`
        : "La sesión no contiene hallazgos disponibles.",
      evidence: findings
        .map((finding) => finding.evidence || finding.source || "")
        .filter(Boolean),
      inferences: [],
      confidence: findings.length ? "medium" : "low",
      recommendedActions: [],
      source: "prospect_research",
    };
  }
  if (intent === "public_research_review") {
    const findings = snapshot.findings || [];
    const externalEvidence = Array.isArray(snapshot.externalResearch?.evidence)
      ? snapshot.externalResearch.evidence
      : [];
    const evidence = [
      ...findings
        .map((finding) => finding.evidence || finding.source || "")
        .filter(Boolean),
      ...externalEvidence
        .map((item) => item.title || item.url || item.snippet || "")
        .filter(Boolean),
    ];
    return {
      answer: evidence.length
        ? `Evidencia pública disponible en esta sesión (${evidence.length} elementos): ${evidence.join("; ")}.`
        : "Esta sesión aún no contiene evidencia pública. Ejecuta la investigación externa para consultar fuentes; no se realizó una búsqueda nueva desde el chat.",
      evidence,
      inferences: [],
      confidence: evidence.length ? "medium" : "low",
      recommendedActions: [],
      source: "prospect_research",
    };
  }
  if (intent === "opportunity_hypotheses") {
    const hypotheses = snapshot.hypotheses || [];
    return {
      answer: hypotheses.length
        ? `Hipótesis por validar (${hypotheses.length}): ${hypotheses.map((item) => `${item.title}${item.businessChallenge ? `: ${item.businessChallenge}` : ""}`).join("; ")}. No son oportunidades CRM confirmadas.`
        : "La sesión no contiene hipótesis de oportunidad disponibles.",
      evidence: hypotheses
        .map((item) => item.evidence || item.source || "")
        .filter(Boolean),
      inferences: hypotheses.map((item) => item.summary).filter(Boolean),
      confidence: hypotheses.length ? "medium" : "low",
      recommendedActions: [],
      source: "prospect_research",
    };
  }
  if (intent === "conversion_request") {
    return {
      answer:
        "La conversión desde Cuenta nueva requiere revisión, validación de duplicados y confirmación explícita. No se creó ningún registro CRM.",
      evidence: ["La solicitud pertenece a una sesión de prospección."],
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
    {
      name: "searchProspectHypotheses",
      requiredPermission: "prospeccion.read",
    },
  ];
  const dependencies = {
    loadChannelIntentConfigurations: ({ channel }) =>
      loadChannelIntentConfigurations({ channel }),
    loadAdministrativeRules: listCoachAdminRules,
    prepareReadModel: async ({
      availableTools: resolvedTools,
      conversationHistory = [],
      channelIntentRouting = null,
      channelIntentCatalog = [],
    }) => {
      const readToolResults = [];
      const names = new Set(resolvedTools.map((tool) => tool.name));
      const pushTool = (toolName, args = {}) => {
        if (names.has(toolName))
          readToolResults.push(
            executeProspectReadTool({ toolName, snapshot, args }),
          );
      };
      pushTool("getProspectProfile");
      for (const toolName of channelIntentRouting?.allowedTools || []) {
        if (toolName !== "getProspectProfile") pushTool(toolName);
      }
      const selectedContext = { prospectSessionId: session.id };
      const modelSnapshot = {
        ...snapshot,
        selectedContext,
        readToolResults,
        conversationHistory,
        channelIntentCatalog,
        channelIntentRouting,
      };
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
        conversationHistory,
      };
    },
    executeReadTool: ({ toolName, snapshot: scopedSnapshot, args }) =>
      executeProspectReadTool({ toolName, snapshot: scopedSnapshot, args }),
    buildStageReadiness: () => null,
    isStagePreparationQuestion: () => false,
    loadProcessGuide: async () => "",
    buildPrompt: (
      model,
      question,
      _guide,
      context,
      conversationHistory = [],
    ) => {
      const administrativeRules = Array.isArray(model?.administrativeRules)
        ? model.administrativeRules
            .filter((rule) => rule?.enabled && rule?.instruction)
            .map((rule) => `- ${rule.title}: ${rule.instruction}`)
        : [];
      return {
        question,
        context: model,
        selectedContext: context,
        conversationHistory,
        instruction:
          "Usa solo datos de prospección. Distingue datos proporcionados por el vendedor, evidencia pública e inferencias. Nunca presentes un prospecto, contacto o hipótesis como registro CRM confirmado. Las conversiones requieren confirmación explícita." +
          (model?.channelIntentRouting
            ? `\n\nEnrutamiento validado por el servidor: ${JSON.stringify(model.channelIntentRouting)}. Responde a esa intención usando únicamente las herramientas permitidas y esta sesión de prospecto.`
            : "") +
          (administrativeRules.length
            ? `\n\nReglas administrativas activas para este canal; aplícalas sin presentar datos prospectivos como registros CRM ni omitir confirmaciones:\n${administrativeRules.join("\n")}`
            : ""),
      };
    },
    requestResponse: async ({ payload }) => {
      const fallback = buildProspectFallback(
        snapshot,
        payload.question,
        payload.context?.channelIntentRouting,
      );
      const result = await runStructuredTextResearch({
        schemaName: "prospect_contextual_chat",
        systemPrompt:
          "Responde sobre un prospecto usando únicamente la sesión autorizada. No confundas investigación pública con registros CRM. Las acciones siempre requieren confirmación.",
        subject: snapshot.profile?.companyName || "prospecto",
        context: payload,
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
            items: { type: "string", example: "Inferencia" },
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
                { key: "title", type: "string", example: "Validar hipótesis" },
                {
                  key: "target",
                  type: "enum",
                  enum: ["account", "contact", "opportunity"],
                  example: "opportunity",
                },
                {
                  key: "actionType",
                  type: "enum",
                  enum: ["convert", "conversion", "create"],
                  example: "convert",
                },
                {
                  key: "notes",
                  type: "string",
                  example: "Confirmar con el prospecto",
                },
                {
                  key: "successCriteria",
                  type: "string",
                  example: "Dato validado",
                },
                {
                  key: "requiresConfirmation",
                  type: "string",
                  example: "true",
                },
              ],
            },
          },
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
      const recommendedActions = normalizeProspectRecommendedActions(
        result?.recommendedActions,
      );
      return {
        answer: String(result?.answer || "No fue posible responder."),
        evidence: Array.isArray(result?.evidence) ? result.evidence : [],
        inferences: Array.isArray(result?.inferences) ? result.inferences : [],
        confidence: result?.confidence || "low",
        recommendedActions,
        source: "prospect_research",
        entities: {
          accountId: null,
          opportunityId: null,
          contactId: null,
          leadId: null,
          names: [],
        },
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
    async runTurn({ question, history = [] }) {
      const businessRules = await loadCoachBusinessRules({
        channel: "prospect",
        process: "prospect_chat",
      });
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
        businessRules,
        dependencies,
      });
    },
  };
}
