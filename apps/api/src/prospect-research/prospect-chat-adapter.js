import { runStructuredTextResearch } from "../structuredWebResearch.js";
import { aiModelFor } from "../ai-services/state.js";
import { shapeLibraryMaterials } from "../coach/performance-tools.js";
import { runConversationEngine } from "../coach/conversation-engine.js";
import { loadCoachBusinessRules } from "../coach/business-rules.js";
import { listCoachAdminRules } from "../coach/admin-rules.js";
import { loadChannelIntentConfigurations } from "../coach/channel-intent-governance.js";
import { buildProspectOperations, buildProspectRecommendedActions, normalizeProspectRecommendedActions } from "./prospect-operations.js";
import { buildGuardedProspectTurn } from "./prospect-guards.js";
import { classifyProspectIntent } from "./prospect-intent-classifier.js";
import { prospectVerificationEnabled, verifyAndRepairAnswer } from "./prospect-verifier.js";
import { PROSPECT_CHAT_INSTRUCTION, PROSPECT_HELP_INTENTS, PROSPECT_SYSTEM_PROMPT, buildSessionCoverage, languageInstruction, prospectIntentGuidance, requestedLanguage } from "./prospect-prompts.js";

export { normalizeProspectRecommendedActions };

const CHAT_FEATURE_CODE = "prospect_research.chat";
const LIBRARY_TOOL = "getLibraryMaterials";

// Library material that fits the prospect's industry, hypotheses and findings, read with the seller's own visibility.
async function loadProspectLibrary({ user, snapshot, question, listAssets }) {
  const list = listAssets || (await import("../commercial-enablement/library-service.js")).listCommercialEnablementAssets;
  const result = await list({ user, filters: { pageSize: 200 } });
  const hypotheses = snapshot.hypotheses || [];
  const shaped = shapeLibraryMaterials({
    assets: result?.items || [],
    question,
    opportunity: {
      name: [
        ...hypotheses.map((hypothesis) => `${hypothesis.title || ""} ${hypothesis.technologyArea || ""}`),
        ...(snapshot.findings || []).slice(0, 4).map((finding) => finding.title || ""),
      ].join(" "),
      account: snapshot.profile?.industry || "",
    },
  });
  return { ...shaped, focus: { prospect: snapshot.profile?.companyName || null, industry: snapshot.profile?.industry || null } };
}

// Help answers (drafting, prioritizing, material) run on the module's advanced model by default. The server rule
// decides; PROSPECT_CHAT_HELP_MODEL_ROLE (fast|advanced) overrides it when set.
function helpModelFor(intent, policyRole = "advanced", env = process.env) {
  if (!PROSPECT_HELP_INTENTS.has(intent)) return null;
  const override = String(env.PROSPECT_CHAT_HELP_MODEL_ROLE || "").toLowerCase();
  const role = override === "fast" || override === "advanced" ? override : policyRole;
  if (role !== "advanced") return null;
  return aiModelFor(CHAT_FEATURE_CODE, "advanced") || null;
}

function correctionInstruction(issues) {
  const listed = issues.map((issue) => `«${issue.text}»`).join(", ");
  return `\n\nCorrección obligatoria: tu respuesta anterior incluyó datos que no están en la sesión de prospección: ${listed}. Reescribe la respuesta completa sin esos datos y sin sustituirlos por otros inventados; si un dato hace falta y no está, dilo.`;
}

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

function sessionEvidenceLine(snapshot) {
  const coverage = buildSessionCoverage(snapshot);
  return `Sesión de prospección de ${snapshot?.profile?.companyName || "la empresa"}: ${coverage.findings} hallazgo(s), ${coverage.contacts} contacto(s) identificado(s) y ${coverage.hypotheses} hipótesis de oportunidad.`;
}

// Operations are built by the server from the seller's explicit request; whatever the model returns is ignored.
export function normalizeProspectResponse(result, scopedSnapshot, question, context) {
  const recommendedActions = normalizeProspectRecommendedActions(
    buildProspectRecommendedActions({
      intent: scopedSnapshot?.channelIntentRouting?.intent,
      question,
      snapshot: scopedSnapshot,
    }),
  );
  const modelEvidence = Array.isArray(result?.evidence) ? result.evidence : [];
  return {
    answer: String(result?.answer || "No fue posible responder."),
    // An answer built from the session is backed by it; without this the engine discards good answers that omit the list.
    evidence: modelEvidence.length || !String(result?.answer || "").trim() ? modelEvidence : [sessionEvidenceLine(scopedSnapshot)],
    inferences: Array.isArray(result?.inferences) ? result.inferences : [],
    confidence: result?.confidence || "low",
    recommendedActions,
    source: "prospect_research",
    entities: { accountId: null, opportunityId: null, contactId: null, leadId: null, names: [] },
    operations: buildProspectOperations(recommendedActions, context.prospectSessionId),
    clarification: null,
  };
}

export function createProspectChatAdapter({ user, session, jobId, listLibraryAssets = null, businessRules: providedRules = null }) {
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
    crm: session.crm || null,
  };
  const permissions = user?.permissionSet || new Set();
  // Per-turn facts for the quality trace; runTurn resets them.
  let turnState = {};
  let turnRules = providedRules;
  const availableTools = [
    { name: "getProspectProfile", requiredPermission: "prospeccion.read" },
    { name: "searchProspectFindings", requiredPermission: "prospeccion.read" },
    { name: "searchProspectContacts", requiredPermission: "prospeccion.read" },
    {
      name: "searchProspectHypotheses",
      requiredPermission: "prospeccion.read",
    },
    { name: LIBRARY_TOOL, requiredPermission: "enablement_comercial.use" },
  ];
  const dependencies = {
    loadChannelIntentConfigurations: ({ channel }) =>
      loadChannelIntentConfigurations({ channel }),
    classifyChannelIntent: async ({ question, history, availableTools: resolvedTools, context, configuration }) => {
      const routing = await classifyProspectIntent({
        question,
        history,
        catalog: configuration,
        availableTools: resolvedTools,
        context,
        coverage: buildSessionCoverage(snapshot),
        allowed: turnRules?.serverPolicy?.semanticClassifier !== "off",
        userId: user?.id,
        jobId,
      });
      turnState.classifier = { source: routing ? "semantic" : "patterns", intent: routing?.intent || null };
      return routing;
    },
    getTurnDiagnostics: () => ({ prospectChat: turnState }),
    loadAdministrativeRules: listCoachAdminRules,
    prepareReadModel: async ({
      question,
      availableTools: resolvedTools,
      authorizedTools = resolvedTools,
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
        if (toolName === LIBRARY_TOOL) continue;
        if (toolName !== "getProspectProfile") pushTool(toolName);
      }
      if (names.has(LIBRARY_TOOL) && (channelIntentRouting?.allowedTools || []).includes(LIBRARY_TOOL)) {
        try {
          readToolResults.push({
            toolName: LIBRARY_TOOL,
            readOnly: true,
            result: await loadProspectLibrary({ user, snapshot, question, listAssets: listLibraryAssets }),
          });
        } catch (error) {
          console.error("[prospect-chat] Library lookup failed", { jobId, code: error?.code || error?.name });
          readToolResults.push({ toolName: LIBRARY_TOOL, readOnly: true, result: null, error: "No fue posible consultar la biblioteca." });
        }
      }
      const selectedContext = { prospectSessionId: session.id };
      const modelSnapshot = {
        ...snapshot,
        sessionCoverage: buildSessionCoverage(snapshot),
        libraryAccess: turnRules?.scope?.libraryMaterialsAllowed === false
          ? "disabled_by_rules"
          : authorizedTools.some((tool) => tool.name === LIBRARY_TOOL) ? "authorized" : "not_authorized",
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
          PROSPECT_CHAT_INSTRUCTION +
          prospectIntentGuidance(model?.channelIntentRouting?.intent) +
          languageInstruction(requestedLanguage({ question, history: conversationHistory })) +
          (model?.channelIntentRouting
            ? `\n\nEnrutamiento del servidor: ${JSON.stringify(model.channelIntentRouting)}. Indica qué datos de la sesión se cargaron y qué herramientas están permitidas, pero no define lo que pide el vendedor: responde a su pregunta usando únicamente esos datos. La intención prospect_profile es solo la de respaldo y no significa que pidan un resumen del perfil.`
            : "") +
          (administrativeRules.length
            ? `\n\nReglas administrativas activas para este canal; aplícalas sin presentar datos prospectivos como registros CRM ni omitir confirmaciones:\n${administrativeRules.join("\n")}`
            : ""),
      };
    },
    requestResponse: async ({ payload }) => {
      const routing = payload.context?.channelIntentRouting;
      const fallback = buildProspectFallback(
        snapshot,
        payload.question,
        routing,
      );
      const model = helpModelFor(routing?.intent, turnRules?.serverPolicy?.helpModelRole);
      turnState.generation = { intent: routing?.intent || null, modelRole: model ? "advanced" : "fast" };
      const askModel = (correction = null) => runStructuredTextResearch({
        schemaName: "prospect_contextual_chat",
        systemPrompt:
          PROSPECT_SYSTEM_PROMPT,
        subject: snapshot.profile?.companyName || "prospecto",
        context: correction
          ? { ...payload, previousAnswer: correction.previousAnswer, instruction: `${payload.instruction}${correctionInstruction(correction.issues)}` }
          : payload,
        currentValues: {},
        fields: [
          { key: "answer", type: "string", example: "Respuesta completa para el vendedor." },
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
          { key: "source", type: "string", example: "prospect_research" },
        ],
        ...(model ? { model } : {}),
        aiUsageContext: {
          userId: Number(user.id),
          featureCode: CHAT_FEATURE_CODE,
          jobType: "prospect_chat",
          jobId,
        },
      });
      // The provider sometimes returns an unparsable answer; one more attempt is cheaper than the generic fallback.
      const result = (await askModel()) || (await askModel());
      if (!result) return fallback;
      if (!prospectVerificationEnabled()) return result;
      const checked = await verifyAndRepairAnswer({
        result,
        snapshot: { ...snapshot, readToolResults: payload.context?.readToolResults },
        question: payload.question,
        history: payload.conversationHistory,
        repair: askModel,
        fallbackAnswer: fallback.answer,
      });
      turnState.verification = checked.verification;
      return checked.result;
    },
    resolveResponseContext: (_snapshot, context) => ({
      context,
      changed: false,
      conflict: null,
    }),
    normalizeResponse: (result, scopedSnapshot, question, context) =>
      normalizeProspectResponse(result, scopedSnapshot, question, context),
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
    async runTurn({ question, history: fullHistory = [] }) {
      turnState = {};
      const rules = providedRules
        || (await loadCoachBusinessRules({
          channel: "prospect",
          process: "prospect_chat",
        }));
      turnRules = rules;
      const historyWindow = Number(rules?.serverPolicy?.maxHistoryMessages) || 16;
      const history = fullHistory.slice(-historyWindow);
      const guarded = buildGuardedProspectTurn({
        question,
        snapshot,
        history,
        sessionId: session.id,
        normalizeResponse: normalizeProspectResponse,
      });
      if (guarded) return guarded;
      const businessRules = rules;
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
