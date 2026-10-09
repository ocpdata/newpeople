import { executeCoachReadTool } from "./crm-read-tools.js";
import {
  applyCoachPhaseOneRules,
  classifyCoachIntent,
} from "./phase-one-engine.js";
import {
  getCoachReadToolCatalog,
  inferCoachOpportunityFilters,
} from "./read-tools.js";
import { getCoachBusinessRules } from "./business-rules.js";
import { matchCoachQueryCase } from "./case-catalog.js";
import { CUSTOMER_CHAT_EVIDENCE_LIMITS } from "../commercial-intelligence/customer-chat-evidence.js";
import {
  classifyChannelIntent,
  getChannelIntentDefaults,
  normalizeChannelIntentPlan,
} from "./channel-intents.js";
import { summarizeCoachToolResults } from "./observability.js";
import {
  buildCoachDetailHandoff,
  getMissingCoachIntentContext,
  getCoachInteractionModePolicy,
  isCoachEmailHelpQuestion,
  isCoachQuestionPhrasingHelp,
  isGeneralCoachProcessInformationQuestion,
  listCoachIntentCatalog,
  validateCoachIntentClassification,
} from "./intent-governance.js";

export const CONTEXT_KEYS = [
  "accountId",
  "contactId",
  "opportunityId",
  "quotationId",
  "proposalId",
  "leadId",
];

export function normalizeChannelConversationHistory(
  history,
  channel = "coach",
) {
  const isCoachChannel = channel === "coach";
  return (Array.isArray(history) ? history : [])
    .filter((message) => message && typeof message === "object")
    .map((message) => ({
      role: isCoachChannel
        ? message.role === "coach" || message.role === "assistant"
          ? "coach"
          : "seller"
        : message.role === "coach" || message.role === "assistant"
          ? "assistant"
          : "user",
      text: String(message.text || "")
        .trim()
        .slice(0, 2000),
    }))
    .filter((message) => message.text)
    .slice(-8);
}

export function summarizeCustomerChatContext(value = {}) {
  const selectedContext = value.selectedContext || value;
  const conversationContext = value.conversationContext || {};
  const routing = value.channelIntentRouting || {};
  const filters = conversationContext.filters || routing.filters || {};
  return {
    accountId:
      Number(selectedContext.accountId || value.account?.id || value.accountId || 0) ||
      null,
    opportunityId:
      Number(
        selectedContext.opportunityId ||
          value.selectedOpportunity?.id ||
          value.opportunityId ||
          0,
      ) || null,
    contactId:
      Number(
        selectedContext.contactId ||
          value.selectedContact?.id ||
          value.contactId ||
          0,
      ) || null,
    intents: conversationContext.intents || routing.intents || [],
    filterNames: Object.keys(filters).filter((key) =>
      [
        "opportunityStatus",
        "stageCode",
        "closeYear",
        "periodMonths",
        "startDate",
        "endDate",
      ].includes(key),
    ),
  };
}

function normalizeConversationHistory(history) {
  return normalizeChannelConversationHistory(history, "coach");
}

export function getConversationChannelJobType(channel = "coach") {
  if (channel === "customer_account") return "account_chat";
  if (channel === "prospect") return "prospect_chat";
  return "mi_coach_chat";
}

export function shouldPreserveCoachContextForQuestion(
  question = "",
  context = {},
) {
  const text = String(question || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const references = [
    [
      context.opportunityId,
      /\b(?:esta|este|esa|ese|actual|misma|mismo) oportunidad\b|\boportunidad (?:actual|seleccionada|en contexto)\b/,
    ],
    [
      context.accountId,
      /\b(?:esta|este|esa|ese|actual|misma|mismo) (?:cuenta|cliente)\b|\b(?:cuenta|cliente) (?:actual|seleccionada|en contexto)\b/,
    ],
    [
      context.contactId,
      /\b(?:este|esta|ese|esa|actual|mismo|misma) contacto\b|\bcontacto (?:actual|seleccionado|en contexto)\b/,
    ],
    [
      context.leadId,
      /\b(?:este|esta|ese|esa|actual|mismo|misma) lead\b|\blead (?:actual|seleccionado|en contexto)\b/,
    ],
  ];
  return references.some(
    ([id, pattern]) => Number(id || 0) > 0 && pattern.test(text),
  );
}

function normalizeRequestContext(context) {
  return Object.fromEntries(
    CONTEXT_KEYS.map((key) => [key, Number(context?.[key] || 0) || null]),
  );
}

export function normalizeCoachGatewayRequest(body = {}) {
  return {
    question: String(body?.question || "").trim(),
    conversationHistory: normalizeConversationHistory(body?.history),
    requestContext: normalizeRequestContext(body?.context),
    requestedSessionId: Number(body?.sessionId || 0) || null,
  };
}

export function resolveCoachTurnContext(
  requestContext = {},
  sessionContext = {},
  isExistingSession = false,
) {
  const source = isExistingSession ? sessionContext : requestContext;
  return Object.fromEntries(
    CONTEXT_KEYS.map((key) => [key, Number(source?.[key] || 0) || null]),
  );
}

export function normalizeCoachToolCalls(value) {
  const calls = Array.isArray(value?.toolCalls)
    ? value.toolCalls
    : Array.isArray(value?.tool_calls)
      ? value.tool_calls
      : [];
  return calls.slice(0, 4).map((call) => ({
    toolName: String(call?.toolName || call?.name || "").trim(),
    args:
      call?.arguments && typeof call.arguments === "object"
        ? call.arguments
        : call?.args && typeof call.args === "object"
          ? call.args
          : {},
  }));
}

function permissionGranted(permissions, permissionCode) {
  if (!permissionCode) return true;
  if (typeof permissions?.has === "function") {
    return permissions.has(permissionCode);
  }
  if (Array.isArray(permissions)) return permissions.includes(permissionCode);
  if (Array.isArray(permissions?.codes)) {
    return permissions.codes.includes(permissionCode);
  }
  return permissions?.[permissionCode] === true;
}

export function resolveAvailableCoachTools(tools = [], permissions = {}) {
  return tools
    .map((tool) =>
      typeof tool === "string" ? { name: tool, readOnly: true } : tool,
    )
    .filter((tool) => {
      if (!tool?.name) return false;
      if (
        tool.requiredPermission &&
        !permissionGranted(permissions, tool.requiredPermission)
      ) {
        return false;
      }
      if (
        Array.isArray(tool.requiredPermissions) &&
        !tool.requiredPermissions.every((permission) =>
          permissionGranted(permissions, permission),
        )
      ) {
        return false;
      }
      return (
        !Array.isArray(tool.requiredAnyPermissions) ||
        tool.requiredAnyPermissions.some((permission) =>
          permissionGranted(permissions, permission),
        )
      );
    });
}

export function applyCoachOperationPolicy(operations = [], policy = {}) {
  const candidates = Array.isArray(operations) ? operations : [];
  if (typeof policy.filterOperations === "function") {
    return policy.filterOperations(candidates);
  }
  const allowedKinds = Array.isArray(policy.allowedKinds)
    ? new Set(policy.allowedKinds)
    : null;
  return candidates
    .filter((operation) => {
      if (allowedKinds && !allowedKinds.has(operation?.kind)) return false;
      if (
        policy.sourceChannel &&
        operation?.sourceChannel &&
        operation.sourceChannel !== policy.sourceChannel
      ) {
        return false;
      }
      return true;
    })
    .map((operation) => ({
      ...operation,
      ...(policy.sourceChannel && !operation.sourceChannel
        ? { sourceChannel: policy.sourceChannel }
        : {}),
    }));
}

export function enforceCoachBusinessEvidence(
  response = {},
  question = "",
  rules = {},
  allowNoBusinessEvidence = false,
) {
  const hasEvidence =
    (Array.isArray(response.evidence) && response.evidence.length > 0) ||
    (Array.isArray(response.facts) && response.facts.length > 0) ||
    (Array.isArray(response.operations) &&
      response.operations.some(
        (operation) =>
          Array.isArray(operation?.evidence) && operation.evidence.length > 0,
      ));
  if (
    !(
      rules.validation?.requireEvidence || rules.scope?.requireBusinessEvidence
    ) ||
    allowNoBusinessEvidence ||
    hasEvidence ||
    ["clarification", "error", "handoff"].includes(response.responseType)
  ) {
    return response;
  }
  const answer =
    "No puedo confirmar una respuesta de negocio con la evidencia disponible. Indica la cuenta, oportunidad o dato que quieres consultar.";
  return {
    ...response,
    intent: "clarification",
    responseType: "clarification",
    answer,
    clarification: {
      type: "missing_fields",
      message: answer,
      missing: ["Evidencia CRM relacionada con la consulta"],
      candidates: [],
      originalRequest: question,
      intendedAction: "continue_request",
    },
    operations: [],
  };
}

export function applyCoachInteractionModeLimits(
  response = {},
  mode = "coaching",
) {
  if (mode !== "brief_context") return response;
  return {
    ...response,
    answer: String(response.answer || "")
      .trim()
      .slice(0, 1400),
    facts: (Array.isArray(response.facts) ? response.facts : []).slice(0, 6),
    evidence: (Array.isArray(response.evidence) ? response.evidence : []).slice(
      0,
      6,
    ),
    inferences: (Array.isArray(response.inferences)
      ? response.inferences
      : []
    ).slice(0, 3),
    pendingItems: (Array.isArray(response.pendingItems)
      ? response.pendingItems
      : []
    ).slice(0, 3),
  };
}

export function applyCoachBusinessRuleScope(snapshot = {}, rules = {}) {
  const blockedRecordTypes = new Set(
    [
      rules.scope?.accountSearchAllowed === false && "account",
      rules.scope?.opportunitySearchAllowed === false && "opportunity",
      rules.scope?.quotationSearchAllowed === false && "quotation",
      rules.scope?.contactSearchAllowed === false && "contact",
      rules.scope?.leadSearchAllowed === false && "lead",
    ].filter(Boolean),
  );
  return {
    ...snapshot,
    ...(rules.scope?.accountSearchAllowed === false ? { accounts: [] } : {}),
    ...(rules.scope?.contactSearchAllowed === false
      ? { contactMappings: [] }
      : {}),
    ...(rules.scope?.leadSearchAllowed === false ? { leads: [] } : {}),
    ...(rules.scope?.quotationSearchAllowed === false
      ? { selectedOpportunityQuotation: null }
      : {}),
    ...(rules.scope?.opportunitySearchAllowed === false
      ? {
          coachOpportunities: [],
          wonOpportunities: [],
          lostOpportunities: [],
          cancelledOpportunities: [],
          inactivePipelineOpportunities: [],
          workboard: [],
          pipeline: snapshot.pipeline
            ? { ...snapshot.pipeline, opportunities: [] }
            : null,
        }
      : {}),
    selectedRecord: blockedRecordTypes.has(snapshot.selectedRecord?.type)
      ? null
      : snapshot.selectedRecord,
  };
}

function normalizeQuestion(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function buildDeterministicAccountOpportunityRanking(
  question,
  opportunities = [],
) {
  const normalizedQuestion = normalizeQuestion(question);
  const isAccountRanking =
    /\bcuentas?\b/.test(normalizedQuestion) &&
    /\boportunidades?\b/.test(normalizedQuestion) &&
    /\b(mayor|mayores|mas|cantidad|numero|numero)\b/.test(normalizedQuestion);
  if (!isAccountRanking) return null;
  const groups = new Map();
  for (const opportunity of opportunities) {
    if (
      opportunity?.lifecycle &&
      String(opportunity.lifecycle).trim() !== "open"
    )
      continue;
    if (
      opportunity?.activationStatusCode &&
      String(opportunity.activationStatusCode).trim() !== "activada"
    )
      continue;
    const accountId = Number(
      opportunity?.account?.id || opportunity?.accountId || 0,
    );
    const accountName =
      opportunity?.accountName ||
      opportunity?.account?.name ||
      "Cuenta sin nombre";
    if (!accountId) continue;
    const current = groups.get(accountId) || {
      accountId,
      accountName,
      count: 0,
      opportunityIds: [],
    };
    current.count += 1;
    current.opportunityIds.push(Number(opportunity.id));
    groups.set(accountId, current);
  }
  const ranking = [...groups.values()]
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.accountName.localeCompare(right.accountName),
    )
    .slice(0, 5);
  return {
    intent: "pipeline_coverage",
    responseType: "informational",
    answer: ranking.length
      ? `Las cuentas con mayor cantidad de oportunidades abiertas son: ${ranking
          .map(
            (item, index) =>
              `${index + 1}) ${item.accountName} con ${item.count} oportunidad(es) abiertas`,
          )
          .join(", ")}.`
      : "No hay oportunidades abiertas autorizadas para agrupar por cuenta.",
    facts: ranking.map((item) => ({
      sourceType: "account",
      sourceId: item.accountId,
      label: `${item.accountName}: ${item.count} oportunidades abiertas`,
      excerpt: `IDs de oportunidades consultadas: ${item.opportunityIds.join(", ")}`,
    })),
    evidence: [
      "Conteo determinista sobre oportunidades autorizadas y abiertas.",
    ],
    inferences: [],
    pendingItems: [],
    recommendation: null,
    confidence: "high",
    entities: {
      accountId: null,
      opportunityId: null,
      contactId: null,
      leadId: null,
      names: ranking.map((item) => item.accountName),
    },
    operations: [],
    clarification: null,
    action: null,
    stageReadiness: null,
  };
}

export async function completeCoachModelTurn({
  result,
  clarification,
  snapshot,
  modelSnapshot,
  question,
  processGuide,
  effectiveContext,
  conversationHistory,
  user,
  jobId,
  startedAt,
  deadlineAt = null,
  featureCode,
  channel = "coach",
  jobType = getConversationChannelJobType(channel),
  channelRules = {},
  permissions = {},
  operationPolicy = {},
  businessRules = {},
  availableTools = [],
  dependencies,
}) {
  const {
    buildStageReadiness,
    buildCoachPrompt,
    requestMiAgentJson,
    buildPrompt = buildCoachPrompt,
    requestResponse = requestMiAgentJson,
    executeReadTool = executeCoachReadTool,
  } = dependencies;
  const requestedToolCalls = normalizeCoachToolCalls(result);
  if (clarification || !requestedToolCalls.length) {
    return { result, requestedToolCalls, requestedToolResults: [] };
  }
  const availableToolNames = new Set(
    availableTools.map((tool) =>
      typeof tool === "string" ? tool : tool?.name,
    ),
  );
  const requestedToolResults = requestedToolCalls.map((call) => {
    if (!availableToolNames.has(call.toolName)) {
      return {
        toolName: call.toolName,
        readOnly: true,
        result: null,
        error: "Read tool no autorizada o no disponible.",
      };
    }
    try {
      return executeReadTool({
        toolName: call.toolName,
        snapshot,
        args: call.args,
        businessRules,
        buildReadiness: (opportunity) =>
          buildStageReadiness(opportunity, {
            currentUserId: Number(user.id),
          }),
      });
    } catch (error) {
      return {
        toolName: call.toolName,
        readOnly: true,
        result: null,
        error: "Read tool no autorizada o no disponible.",
      };
    }
  });
  const promptArguments = [
    {
      ...modelSnapshot,
      readToolResults: [
        ...(modelSnapshot.readToolResults || []),
        ...requestedToolResults,
      ],
    },
    question,
    processGuide,
    effectiveContext,
    conversationHistory,
  ];
  if (
    Object.keys(channelRules).length ||
    Object.keys(permissions).length ||
    Object.keys(operationPolicy).length
  ) {
    promptArguments.push(channelRules, permissions, operationPolicy);
  }
  const completedResult = await requestResponse({
    payload: buildPrompt(...promptArguments),
    user,
    jobId,
    startedAt: new Date(startedAt),
    deadlineAt,
    phase: `${channel}_tool_results`,
    featureCode,
    jobType,
  });
  return {
    result: completedResult,
    requestedToolCalls,
    requestedToolResults,
  };
}

export async function runConversationEngine({
  question,
  context = {},
  history = [],
  user,
  jobId,
  availableTools = [],
  channelRules = {},
  permissions = {},
  operationPolicy = {},
  businessRules: configuredBusinessRules = null,
  executionTrace = null,
  traceParentSpanId = null,
  dependencies,
}) {
  const turnStartedAt = Date.now();
  const {
    buildStageReadiness,
    loadProcessGuide,
    requestMiAgentJson,
    buildCoachPrompt,
    resolveCoachResponseContext,
    normalizeCoachResult,
    featureCode,
  } = dependencies;
  const channel =
    configuredBusinessRules?.channel ||
    channelRules.scope ||
    operationPolicy.sourceChannel ||
    "coach";
  const turnDeadlineAt =
    channel === "customer_account"
      ? turnStartedAt + CUSTOMER_CHAT_EVIDENCE_LIMITS.maxTurnMs
      : null;
  const businessRules =
    configuredBusinessRules || getCoachBusinessRules({ channel });
  const jobType = getConversationChannelJobType(channel);
  const channelHistory = normalizeChannelConversationHistory(history, channel);
  const effectiveOperationPolicy = {
    ...businessRules.operationPolicy,
    ...operationPolicy,
    allowedKinds: businessRules.operationPolicy.allowedKinds.filter(
      (kind) =>
        !Array.isArray(operationPolicy.allowedKinds) ||
        operationPolicy.allowedKinds.includes(kind),
    ),
    sourceChannel: channel,
  };
  const effectiveChannelRules = {
    ...businessRules.channelRules,
    ...channelRules,
    scope: channel,
  };
  const prepareReadModel =
    dependencies.prepareReadModel || prepareCoachReadModel;
  const buildPrompt = dependencies.buildPrompt || buildCoachPrompt;
  const requestResponse = dependencies.requestResponse || requestMiAgentJson;
  const shouldTrace = channel === "customer_account" && executionTrace;
  const safeFilterNames = new Set([
    "opportunityStatus",
    "stageCode",
    "closeYear",
    "periodMonths",
    "startDate",
    "endDate",
  ]);
  const summarizeRouting = (routing) => {
    if (!routing) return null;
    return {
      mode: routing.mode || null,
      confidence: routing.confidence ?? null,
      intents:
        routing.intents ||
        routing.queries ||
        (routing.intent ? [routing.intent] : []),
      allowedTools: routing.allowedTools || [],
      operationKind: routing.operationKind || null,
      clarificationResolution: routing.clarificationResolution || null,
      validationDiagnostics: routing.validationDiagnostics || null,
      entities: routing.entities
        ? Object.fromEntries(
            [
              "accountReference",
              "opportunityReference",
              "contactReference",
              "leadReference",
            ].map((key) => [key, routing.entities[key] || ""]),
          )
        : null,
      activityDraft: routing.activityDraft
        ? {
            action: routing.activityDraft.action || "none",
            actionType: routing.activityDraft.actionType || null,
            title: routing.activityDraft.title || "",
            temporalPreference: routing.activityDraft.temporalPreference || "",
          }
        : null,
      referenceResolution: routing.referenceResolution
        ? {
            targetType: routing.referenceResolution.targetType || null,
            cardinality: routing.referenceResolution.cardinality || null,
            source: routing.referenceResolution.source || null,
            candidateKeys: routing.referenceResolution.candidateKeys || [],
          }
        : null,
      filters: Object.fromEntries(
        Object.entries(routing.filters || {}).filter(([key]) =>
          safeFilterNames.has(key),
        ),
      ),
      requiresClarification: Boolean(routing.requiresClarification),
      ambiguity: routing.ambiguity
        ? {
            reason: routing.ambiguity.reason || null,
            requiresClarification:
              routing.ambiguity.requiresClarification ?? null,
            question: routing.ambiguity.clarificationQuestion ||
              routing.ambiguity.question ||
              "",
            missingContext: routing.ambiguity.missingContext || [],
          }
        : null,
      missingContext:
        routing.missingContext || routing.ambiguity?.missingContext || [],
    };
  };
  const summarizePolicy = () => ({
    channel,
    channelRules: Object.fromEntries(
      Object.entries(effectiveChannelRules).filter(
        ([key, value]) =>
          ["accountScoped", "noSharedCoachSession", "scope"].includes(key) &&
          ["string", "boolean"].includes(typeof value),
      ),
    ),
    businessScope: Object.fromEntries(
      Object.entries(businessRules.scope || {}).filter(
        ([, value]) => typeof value === "boolean",
      ),
    ),
    businessFilters: Object.fromEntries(
      Object.entries(businessRules.filters || {}).filter(
        ([, value]) =>
          typeof value === "boolean" ||
          (typeof value === "number" && Number.isFinite(value)),
      ),
    ),
    allowedOperationKinds: effectiveOperationPolicy.allowedKinds,
    availableTools: resolvedTools?.map((tool) => tool.name) || [],
  });
  const tracedRequestResponse = (request) => {
    if (!shouldTrace) return requestResponse(request);
    return executionTrace.span(
      {
        from: "B5",
        to: "B10",
        label: "Generar respuesta",
        parentSpanId: request.traceParentSpanId || traceParentSpanId,
        input: {
          phase: request.phase || channel,
          questionLength: String(request.payload?.question || "").length,
          toolResultCount: Array.isArray(
            request.payload?.context?.readToolResults,
          )
            ? request.payload.context.readToolResults.length
            : 0,
          context: summarizeCustomerChatContext(
            request.payload?.context || {},
          ),
          validatedRouting: summarizeRouting(
            request.payload?.context?.channelIntentRouting,
          ),
          policy: summarizePolicy(),
        },
      },
      ({ spanId }) =>
        requestResponse({ ...request, traceParentSpanId: spanId }),
      (value) => ({
        responseType: value?.responseType || null,
        answerLength: String(value?.answer || "").length,
        evidenceCount: Array.isArray(value?.evidence)
          ? value.evidence.length
          : 0,
        operationCount: Array.isArray(value?.operations)
          ? value.operations.length
          : 0,
      }),
    );
  };
  const tracedExecuteReadTool = (request) => {
    if (!shouldTrace || typeof dependencies.executeReadTool !== "function") {
      return dependencies.executeReadTool?.(request);
    }
    const allowedArgumentNames = new Set([
      "accountId",
      "opportunityId",
      "contactId",
      "activeOnly",
      "inactiveOnly",
      "openOnly",
      "stageCodes",
      "commercialStatusCodes",
      "sinceDate",
      "untilDate",
      "closeYear",
      "limit",
    ]);
    const safeArgs = Object.fromEntries(
      Object.entries(request.args || {}).filter(([key]) =>
        allowedArgumentNames.has(key),
      ),
    );
    return executionTrace.spanSync(
      {
        from: "B5",
        to: "B8",
        label: `Ejecutar ${request.toolName}`,
        parentSpanId: traceParentSpanId,
        input: { toolName: request.toolName, args: safeArgs },
      },
      () => dependencies.executeReadTool(request),
      (value) => ({
        toolName: value?.toolName || request.toolName,
        resultCount: Array.isArray(value?.result)
          ? value.result.length
          : value?.result == null
            ? 0
            : 1,
        failed: Boolean(value?.error),
      }),
    );
  };
  const resolveResponseContext =
    dependencies.resolveResponseContext || resolveCoachResponseContext;
  const normalizeResponse =
    dependencies.normalizeResponse || normalizeCoachResult;
  const resolvedTools = resolveAvailableCoachTools(
    availableTools,
    permissions,
  ).filter((tool) => {
    if (tool.name === "searchLeads")
      return businessRules.scope.leadSearchAllowed;
    if (tool.name === "searchOpportunities")
      return businessRules.scope.opportunitySearchAllowed;
    if (tool.name === "getOpportunityQuotation")
      return (
        businessRules.scope.quotationSearchAllowed !== false &&
        businessRules.scope.opportunitySearchAllowed !== false
      );
    if (tool.name === "searchContacts")
      return businessRules.scope.contactSearchAllowed;
    if (tool.name === "searchAccounts")
      return businessRules.scope.accountSearchAllowed !== false;
    return true;
  });
  const intentCatalog =
    channel === "coach"
      ? await (dependencies.loadCoachIntentCatalog || listCoachIntentCatalog)()
      : [];
  const channelIntentCatalog =
    channel === "coach"
      ? []
      : typeof dependencies.loadChannelIntentConfigurations === "function"
        ? await dependencies.loadChannelIntentConfigurations({ channel })
        : getChannelIntentDefaults(channel);
  const plannerMayRun =
    channel === "customer_account" &&
    typeof dependencies.planChannelIntent === "function";
  let structuredChannelIntentRouting = null;
  let plannerDiagnostics = {
    source: "not_applicable",
    fallbackUsed: false,
    reasonCode:
      channel === "customer_account" && !plannerMayRun
        ? "planner_unavailable"
        : null,
    queryCount: 0,
  };
  let plannerSpanId = traceParentSpanId;
  if (plannerMayRun) {
    try {
      const plannerInput = {
        channel,
        question,
        context,
        conversationHistory: channelHistory,
        conversationContext: context.conversationContext || null,
        availableTools: resolvedTools,
        catalog: channelIntentCatalog,
        allowedOperationKinds: effectiveOperationPolicy.allowedKinds,
        deadlineAt: turnDeadlineAt,
      };
      const proposedPlan = shouldTrace
        ? await executionTrace.span(
            {
              from: "B5",
              to: "B6",
              label: "Solicitar plan estructurado",
              parentSpanId: traceParentSpanId,
              input: {
                questionLength: String(question || "").length,
                context: summarizeCustomerChatContext(context),
                intentCodes: channelIntentCatalog
                  .filter((intent) => intent.enabled !== false)
                  .map((intent) => intent.code),
                toolNames: resolvedTools.map((tool) => tool.name),
                policy: summarizePolicy(),
              },
            },
            ({ spanId }) => {
              plannerSpanId = spanId;
              return dependencies.planChannelIntent(plannerInput);
            },
            (value) => ({
              hasPlan: Boolean(value),
              proposedRouting: summarizeRouting(value),
              queryCount: Array.isArray(value?.queries)
                ? value.queries.length
                : 0,
              requiresClarification: Boolean(value?.requiresClarification),
            }),
          )
        : await dependencies.planChannelIntent(plannerInput);
      const normalizePlan = () =>
        normalizeChannelIntentPlan({
          channel,
          plan: proposedPlan,
          serverEntityCandidates: proposedPlan?.serverEntityCandidates,
          availableTools: resolvedTools,
          context,
          configuration: channelIntentCatalog,
          allowedOperationKinds: effectiveOperationPolicy.allowedKinds,
          question,
          conversationHistory: channelHistory,
          trustedEntityReferences: context.trustedEntityReferences || [],
        });
      structuredChannelIntentRouting = shouldTrace
        ? executionTrace.spanSync(
            {
              from: "B5",
              to: "B5",
              label: "Validar routing y aplicar políticas",
              parentSpanId: plannerSpanId,
              input: {
                proposedRouting: summarizeRouting(proposedPlan),
                authorizedTools: resolvedTools.map((tool) => tool.name),
                policy: summarizePolicy(),
              },
            },
            normalizePlan,
            (normalized) => {
              const proposedIntents =
                proposedPlan?.queries || proposedPlan?.intents || [];
              const normalizedIntents = new Set(normalized?.intents || []);
              const proposedTools =
                proposedPlan?.allowedTools || proposedPlan?.tools || [];
              const normalizedTools = new Set(normalized?.allowedTools || []);
              return {
                accepted: Boolean(normalized),
                normalizedRouting: summarizeRouting(normalized),
                rejectedIntents: proposedIntents.filter(
                  (intent) => !normalizedIntents.has(intent),
                ),
                rejectedTools: proposedTools.filter(
                  (toolName) => !normalizedTools.has(toolName),
                ),
                rejectionReason: normalized
                  ? null
                  : proposedPlan
                    ? "invalid_or_unauthorized_plan"
                    : "planner_unavailable",
              };
            },
          )
        : normalizePlan();
      plannerDiagnostics = structuredChannelIntentRouting
        ? {
            source: "structured_plan",
            fallbackUsed: false,
            reasonCode: null,
            queryCount: structuredChannelIntentRouting.intents.length,
          }
        : {
            source: "not_applicable",
            fallbackUsed: false,
            reasonCode: proposedPlan ? "invalid_plan" : "planner_unavailable",
            queryCount: 0,
          };
    } catch {
      plannerDiagnostics = {
        source: "not_applicable",
        fallbackUsed: false,
        reasonCode: "planner_error",
        queryCount: 0,
      };
    }
  }
  const channelIntentRouting =
    channel === "customer_account"
      ? structuredChannelIntentRouting
      : channel === "prospect"
        ? classifyChannelIntent({
            channel,
            question,
            availableTools: resolvedTools,
            context,
            configuration: channelIntentCatalog,
          })
        : null;
  const legacyIntent =
    channel === "coach" ? classifyCoachIntent(question) : null;
  const legacyIntentCode = [
    "stage_readiness",
    "activity_query",
    "quotation_query",
    "contact_query",
    "account_query",
    "opportunity_query",
    "lead_query",
    "account_ranking",
    "temporal_filter",
    "operation",
    "general_query",
  ].includes(legacyIntent?.type)
    ? legacyIntent.type
    : "clarification";
  let rawIntentClassification = {
    intent: legacyIntentCode,
    confidence: legacyIntentCode === "clarification" ? 0 : 0.75,
  };
  if (
    channel === "coach" &&
    typeof dependencies.classifyCoachIntentWithModel === "function"
  ) {
    try {
      rawIntentClassification = await dependencies.classifyCoachIntentWithModel(
        {
          question,
          user,
          jobId,
          catalog: intentCatalog,
        },
      );
    } catch (error) {
      rawIntentClassification = {
        intent: "clarification",
        confidence: 0,
        reason: "classifier_unavailable",
      };
      console.warn(
        "[mi-agent] No fue posible clasificar la intención:",
        error?.message || error,
      );
    }
  }
  const processInformationQuestion =
    channel === "coach" && isGeneralCoachProcessInformationQuestion(question);
  const emailHelpQuestion =
    channel === "coach" && isCoachEmailHelpQuestion(question);
  const questionPhrasingHelp =
    channel === "coach" && isCoachQuestionPhrasingHelp(question);
  const intentRouting =
    channel === "coach"
      ? validateCoachIntentClassification(
          processInformationQuestion
            ? {
                intent: "process_information",
                mode: "coaching",
                confidence: 1,
                contextNeeded: [],
              }
            : emailHelpQuestion
              ? {
                  intent: "general_query",
                  mode: "coaching",
                  confidence: 1,
                  contextNeeded: [],
                }
              : questionPhrasingHelp
                ? {
                    intent: "general_query",
                    mode: "coaching",
                    confidence: 1,
                    contextNeeded: [],
                  }
                : rawIntentClassification,
        )
      : null;
  const coachingPermissionSet = user?.permissionSet || permissions;
  const canOpenCustomerWorkspace =
    permissionGranted(coachingPermissionSet, "inteligencia_comercial.read") &&
    (permissionGranted(coachingPermissionSet, "cuentas.read") ||
      permissionGranted(coachingPermissionSet, "cuentas.read_all"));
  const canOpenLeadManagement =
    permissionGranted(coachingPermissionSet, "interacciones.read") ||
    permissionGranted(coachingPermissionSet, "interacciones.read_all");
  const routedTools = intentRouting
    ? resolvedTools.filter((tool) =>
        intentRouting.allowedTools.includes(
          typeof tool === "string" ? tool : tool?.name,
        ),
      )
    : channelIntentRouting
      ? channelIntentRouting.requiresClarification
        ? []
        : resolvedTools.filter((tool) =>
            channelIntentRouting.allowedTools.includes(
              typeof tool === "string" ? tool : tool?.name,
            ),
          )
      : channel === "customer_account"
        ? []
        : resolvedTools;
  const channelReadDisposition =
    channel !== "customer_account"
      ? null
      : !channelIntentRouting
        ? "route_unavailable"
        : channelIntentRouting.requiresClarification
          ? "blocked_by_routing_clarification"
          : routedTools.length
            ? "authorized_reads_planned"
            : "no_authorized_reads_planned";
  const readModelInput = {
    user,
    question,
    selectedContext: context,
    conversationHistory: channelHistory,
    conversationContext: context.conversationContext || null,
    dependencies,
    availableTools: routedTools,
    authorizedTools: resolvedTools,
    businessRules,
    intentRouting,
    ...(channel !== "coach"
      ? { channelIntentRouting, channelIntentCatalog }
      : {}),
  };
  const readModel = shouldTrace
    ? await executionTrace.span(
        {
          from: "B5",
          to: "B7",
          label: "Preparar lecturas del canal",
          parentSpanId: traceParentSpanId,
          input: {
            channel,
            questionLength: String(question || "").length,
            toolNames: routedTools.map((tool) =>
              typeof tool === "string" ? tool : tool.name,
            ),
            routeDisposition: channelReadDisposition,
            validatedRouting: summarizeRouting(channelIntentRouting),
            policy: summarizePolicy(),
          },
        },
        ({ spanId }) =>
          prepareReadModel({
            ...readModelInput,
            traceParentSpanId: spanId,
          }),
        (value) => ({
          toolNames: (value.readToolResults || [])
            .map((item) => item.toolName)
            .filter(Boolean),
          resultCount: (value.readToolResults || []).length,
          clarificationRequired: Boolean(value.clarification),
          routeDisposition: channelReadDisposition,
        }),
      )
    : await prepareReadModel(readModelInput);
  const {
    effectiveContext,
    questionContextTransition,
    scopedSnapshot,
    preparationRequested,
    selectedOpportunity,
    deterministicStageReadiness,
    readToolResults,
    modelSnapshot,
    clarification,
    conversationHistory,
    explicitEntities,
  } = readModel;
  const plannerCandidateTools =
    structuredChannelIntentRouting?.allowedTools || [];
  const plannerCandidateIntents = structuredChannelIntentRouting?.intents || [];
  const plannerCandidateFilters = structuredChannelIntentRouting?.filters || {};
  const plannerCandidateEntities =
    structuredChannelIntentRouting?.entities || {};
  const plannerEvaluation =
    channel === "customer_account"
      ? {
          mode: "active",
          assigned: true,
          planAvailable: Boolean(structuredChannelIntentRouting),
          plannerIntents: plannerCandidateIntents,
          plannerTools: plannerCandidateTools,
          plannerRequiresClarification: Boolean(
            structuredChannelIntentRouting?.requiresClarification,
          ),
          plannerFilterCount: Object.values(plannerCandidateFilters).filter(
            (value) => value !== null && value !== undefined && value !== "",
          ).length,
          plannerEntityReferenceCount: Object.values(
            plannerCandidateEntities,
          ).filter(Boolean).length,
          plannedToolCount: plannerCandidateTools.length,
          plannedToolsObserved: plannerCandidateTools.filter((toolName) =>
            (Array.isArray(readToolResults) ? readToolResults : []).some(
              (item) => item.toolName === toolName,
            ),
          ).length,
          plannedToolsWithEvidence: plannerCandidateTools.filter((toolName) =>
            (Array.isArray(readToolResults) ? readToolResults : []).some(
              (item) =>
                item.toolName === toolName &&
                !item.error &&
                (Array.isArray(item.result)
                  ? item.result.length > 0
                  : item.result !== null && item.result !== undefined),
            ),
          ).length,
        }
      : null;
  const administrativeRules =
    typeof dependencies.loadAdministrativeRules === "function"
      ? await dependencies.loadAdministrativeRules({
          channel,
          process: businessRules.process || "default",
        })
      : [];
  const promptModelSnapshot = {
    ...modelSnapshot,
    administrativeRules: administrativeRules.filter((rule) => rule.enabled),
    intentCatalog,
    intentRouting,
    ...(channel !== "coach"
      ? { channelIntentCatalog, channelIntentRouting }
      : {}),
    interactionModePolicy:
      channel === "coach"
        ? getCoachInteractionModePolicy(intentRouting?.mode)
        : null,
  };
  const processGuide = await loadProcessGuide();
  const promptArguments = [
    promptModelSnapshot,
    question,
    processGuide,
    effectiveContext,
    conversationHistory,
  ];
  if (
    Object.keys(effectiveChannelRules).length ||
    Object.keys(permissions).length ||
    Object.keys(effectiveOperationPolicy).length
  ) {
    promptArguments.push(
      effectiveChannelRules,
      permissions,
      effectiveOperationPolicy,
    );
  }
  const handoffContext = {
    ...effectiveContext,
    accountId:
      effectiveContext.accountId ||
      selectedOpportunity?.account?.id ||
      selectedOpportunity?.accountId ||
      explicitEntities?.account?.id ||
      explicitEntities?.opportunity?.account?.id ||
      explicitEntities?.opportunity?.accountId ||
      explicitEntities?.contact?.account?.id ||
      explicitEntities?.contact?.accountId ||
      null,
  };
  const missingIntentContext = getMissingCoachIntentContext(
    intentRouting,
    handoffContext,
  );
  const detailHandoff = buildCoachDetailHandoff({
    classification: intentRouting,
    context: handoffContext,
    selectedOpportunity,
    explicitEntities,
    canOpenCustomerWorkspace,
    canOpenLeadManagement,
  });
  const deepExplorationNeedsDestination =
    intentRouting?.mode === "deep_exploration" &&
    !missingIntentContext.length &&
    !detailHandoff;
  const routingClarification =
    intentRouting?.requiresClarification ||
    missingIntentContext.length ||
    deepExplorationNeedsDestination
      ? {
          type: "missing_fields",
          message: intentRouting?.requiresClarification
            ? "No identifiqué con suficiente certeza qué necesitas. ¿Puedes precisar si preguntas por el proceso general o por un registro concreto?"
            : missingIntentContext.length
              ? `Para revisar ese detalle, selecciona ${missingIntentContext.join(" y ")} en el contexto del Coach.`
              : intentRouting.detailTarget === "lead"
                ? "No tienes acceso a la gestión de leads desde esta cuenta. Abre el módulo de leads con un perfil autorizado."
                : "No tienes acceso al espacio de Cliente existente para revisar este detalle.",
          missing: missingIntentContext,
          candidates: [],
          originalRequest: question,
          intendedAction: "continue_request",
        }
      : null;
  const channelPlanClarification = channelIntentRouting?.ambiguity;
  const channelRoutingClarification =
    channelIntentRouting?.requiresClarification ||
    (channel === "customer_account" && !channelIntentRouting)
      ? {
          type: "missing_fields",
          message: !channelIntentRouting
            ? plannerDiagnostics.reasonCode === "planner_error" ||
              plannerDiagnostics.reasonCode === "invalid_plan" ||
              plannerDiagnostics.reasonCode === "planner_unavailable"
              ? "No pude interpretar la solicitud con el planificador nuevo. No consulté el CRM; reformula la pregunta o inténtalo más tarde."
              : "El planificador nuevo no produjo una ruta válida. No consulté el CRM; reformula la pregunta o inténtalo más tarde."
            : channelIntentRouting.channel === "customer_account"
              ? channelPlanClarification?.reason === "other_account"
                ? "No puedo consultar otra cuenta desde este chat. Cambia la cuenta seleccionada en la interfaz y vuelve a preguntar."
                : channelPlanClarification?.reason === "out_of_scope"
                  ? "Ese dominio no está disponible en Cliente existente. Puedo consultar los datos CRM incluidos para la cuenta seleccionada."
                  : channelPlanClarification?.clarificationQuestion ||
                    (channelIntentRouting.missingContext.includes("period")
                      ? "¿Qué periodo quieres consultar?"
                      : channelIntentRouting.missingContext.includes("account")
                        ? "Selecciona una cuenta autorizada para continuar esta consulta."
                        : "No identifiqué con suficiente precisión qué registro o dato quieres consultar. ¿Puedes precisarlo?")
              : "No se encontró una sesión de Cuenta nueva válida para continuar.",
          missing: channelIntentRouting?.missingContext || [],
          candidates: [],
          originalRequest: question,
          intendedAction: "continue_request",
        }
      : null;
  const effectiveClarification =
    clarification || routingClarification || channelRoutingClarification;
  const deterministicResult =
    effectiveClarification ||
    channel !== "coach" ||
    intentRouting?.mode === "deep_exploration"
      ? null
      : buildDeterministicAccountOpportunityRanking(
          question,
          modelSnapshot.coachOpportunities || [],
        );
  const handoffResult =
    intentRouting?.mode === "deep_exploration" &&
    !effectiveClarification &&
    detailHandoff
      ? {
          intent: "continue_work",
          responseType: "handoff",
          answer:
            detailHandoff.destination === "customer_account"
              ? "Este nivel de detalle se trabaja en Cliente existente. Abre ese espacio para revisar la cuenta y sus registros relacionados; no exploraré el historial completo desde Coach."
              : "Este nivel de detalle se trabaja en la gestión de leads. Ábrela para continuar revisando el registro; Coach se mantiene enfocado en tu desempeño comercial.",
          confidence: "high",
          facts: [],
          evidence: [],
          inferences: [],
          pendingItems: [],
          recommendation: null,
          entities: {
            accountId: detailHandoff.accountId,
            opportunityId: detailHandoff.opportunityId,
            contactId: detailHandoff.contactId,
            leadId: detailHandoff.leadId,
            names: [],
          },
          operations: [],
          clarification: null,
          action: null,
          stageReadiness: null,
        }
      : null;
  let result = handoffResult;
  if (!result) {
    result = effectiveClarification
      ? {
          intent: "clarification",
          responseType: "clarification",
          answer: effectiveClarification.message,
          confidence: "high",
          clarification: effectiveClarification,
          operations: [],
          ...(channel !== "coach"
            ? {
                entities: {
                  accountId: effectiveContext.accountId || null,
                  opportunityId: effectiveContext.opportunityId || null,
                  contactId: effectiveContext.contactId || null,
                  leadId: effectiveContext.leadId || null,
                  names: [],
                },
              }
            : {}),
        }
      : deterministicResult ||
        (await tracedRequestResponse({
          payload: buildPrompt(...promptArguments),
          user,
          jobId,
          startedAt: new Date(),
          phase: channel,
          featureCode,
          jobType,
          deadlineAt: turnDeadlineAt,
        }));
  }
  const completedModelTurn = await completeCoachModelTurn({
    result,
    clarification: effectiveClarification,
    snapshot: scopedSnapshot,
    modelSnapshot: promptModelSnapshot,
    question,
    processGuide,
    effectiveContext,
    conversationHistory,
    user,
    jobId,
    startedAt: new Date(),
    deadlineAt: turnDeadlineAt,
    featureCode,
    channel,
    jobType,
    channelRules: effectiveChannelRules,
    permissions,
    operationPolicy: effectiveOperationPolicy,
    businessRules,
    availableTools: routedTools,
    dependencies: {
      buildStageReadiness,
      buildCoachPrompt,
      requestMiAgentJson,
      buildPrompt,
      requestResponse: tracedRequestResponse,
      executeReadTool: tracedExecuteReadTool,
    },
  });
  result = completedModelTurn.result;
  const requiresStageReadiness =
    intentRouting?.mode !== "deep_exploration" &&
    !clarification &&
    selectedOpportunity &&
    selectedOpportunity.lifecycle !== "historical" &&
    (intentRouting?.intent === "stage_readiness" ||
      (intentRouting?.intent !== "process_information" &&
        (preparationRequested ||
          result?.intent === "opportunity_preparation")));
  const authoritativeStageReadiness = requiresStageReadiness
    ? deterministicStageReadiness ||
      buildStageReadiness(selectedOpportunity, {
        currentUserId: Number(user.id),
      })
    : null;
  const authoritativeResult = authoritativeStageReadiness
    ? {
        ...result,
        intent: "opportunity_preparation",
        stageReadiness: authoritativeStageReadiness,
      }
    : result;
  const preserveQuestionContext =
    questionContextTransition.changed ||
    shouldPreserveCoachContextForQuestion(question, effectiveContext);
  const responseContextTransition =
    !preserveQuestionContext && !clarification && !result?.clarification
      ? resolveResponseContext(scopedSnapshot, effectiveContext, result)
      : null;
  const activeContext =
    responseContextTransition && !responseContextTransition.conflict
      ? responseContextTransition.context
      : effectiveContext;
  const activeContextSource = questionContextTransition.changed
    ? "question"
    : responseContextTransition?.changed
      ? "coach_response"
      : "existing_context";
  const phaseOneDecision =
    channel === "coach"
      ? applyCoachPhaseOneRules({
          question,
          snapshot: scopedSnapshot,
          context: effectiveContext,
          channel,
          intent: intentRouting
            ? {
                ...legacyIntent,
                type: intentRouting.intent,
                subtype: intentRouting.intent,
                requiresClarification: intentRouting.requiresClarification,
                operationRequested: intentRouting.intent === "operation",
              }
            : legacyIntent,
          businessRules,
        })
      : {
          intent: {
            type: channelIntentRouting?.intent || "channel_query",
            subtype: channelIntentRouting?.intent || channel,
            requiresClarification: Boolean(result?.clarification),
            operationRequested: Boolean(result?.operations?.length),
          },
          requiresClarification: Boolean(result?.clarification),
          allowOperations: Boolean(result?.operations?.length),
          filters: {
            sourceChannel: channel,
            scope: channel,
            entityContext: effectiveContext,
            allowedTools: channelIntentRouting?.allowedTools || [],
            requiredContext: channelIntentRouting?.requiredContext || [],
          },
        };
  const normalizedResponse = normalizeResponse(
    authoritativeResult,
    scopedSnapshot,
    question,
    effectiveContext,
    authoritativeStageReadiness,
  );
  const isProcessGuideCoaching =
    intentRouting?.intent === "process_information" &&
    intentRouting?.mode === "coaching";
  const mayAnswerFromCoachPolicy =
    isProcessGuideCoaching || emailHelpQuestion || questionPhrasingHelp;
  const modeLimitedResponse = applyCoachInteractionModeLimits(
    normalizedResponse,
    intentRouting?.mode,
  );
  const proposedOperationCount = Array.isArray(normalizedResponse.operations)
    ? normalizedResponse.operations.length
    : 0;
  const validationReasons = [];
  if (!String(modeLimitedResponse?.answer || "").trim()) {
    validationReasons.push("missing_answer");
  }
  const evidenceCount =
    (Array.isArray(modeLimitedResponse?.evidence)
      ? modeLimitedResponse.evidence.length
      : 0) +
    (Array.isArray(modeLimitedResponse?.facts)
      ? modeLimitedResponse.facts.length
      : 0);
  if (
    (businessRules.validation.requireEvidence ||
      businessRules.scope.requireBusinessEvidence) &&
    !mayAnswerFromCoachPolicy &&
    !evidenceCount &&
    !["clarification", "error", "handoff"].includes(
      modeLimitedResponse?.responseType,
    )
  ) {
    validationReasons.push("missing_business_evidence");
  }
  const validationStatus = ["error"].includes(modeLimitedResponse?.responseType)
    ? "error"
    : validationReasons.length
      ? "invalid"
      : modeLimitedResponse?.responseType === "clarification"
        ? "clarification"
        : "valid";
  const response = enforceCoachBusinessEvidence(
    modeLimitedResponse,
    question,
    businessRules,
    mayAnswerFromCoachPolicy,
  );
  if (intentRouting) {
    response.intentRouting = {
      intent: intentRouting.intent,
      mode: intentRouting.mode,
      detailTarget: intentRouting.detailTarget,
      confidence: intentRouting.confidence,
      contextNeeded: intentRouting.requiredContext,
      requiredContext: intentRouting.requiredContext,
      allowedTools: intentRouting.allowedTools,
      reason: intentRouting.reason || "",
    };
  }
  if (channelIntentRouting) {
    const { serverResolvedEntityIds, ...publicRouting } = channelIntentRouting;
    response.channelIntentRouting = publicRouting;
  }
  response.detailHandoff = handoffResult ? detailHandoff : null;
  response.intentClassification = phaseOneDecision.intent;
  response.phaseOne = {
    type: phaseOneDecision.intent.type,
    subtype: phaseOneDecision.intent.subtype,
    requiresClarification: phaseOneDecision.requiresClarification,
    allowOperations: phaseOneDecision.allowOperations,
    filters: phaseOneDecision.filters,
  };
  response.entities = {
    ...response.entities,
    accountId: activeContext.accountId ?? response.entities.accountId ?? null,
    opportunityId:
      activeContext.opportunityId ?? response.entities.opportunityId ?? null,
    contactId: activeContext.contactId ?? response.entities.contactId ?? null,
    leadId: activeContext.leadId ?? response.entities.leadId ?? null,
  };
  response.activeContext = activeContext;
  response.activeContextSource = activeContextSource;
  response.operations = applyCoachOperationPolicy(response.operations, {
    ...effectiveOperationPolicy,
    sourceChannel: channel,
  });
  const candidateGroups = explicitEntities?.candidates || {};
  const candidateCounts = Object.fromEntries(
    Object.entries(candidateGroups).map(([type, candidates]) => [
      type,
      Array.isArray(candidates) ? candidates.length : 0,
    ]),
  );
  const resolvedEntityTypes = ["account", "opportunity", "contact", "lead"]
    .filter((type) => explicitEntities?.[type])
    .map((type) => type);
  const tracedToolResults = [
    ...readToolResults,
    ...completedModelTurn.requestedToolResults,
  ];
  let adapterDiagnostics = {};
  try {
    adapterDiagnostics = dependencies.getTurnDiagnostics?.() || {};
  } catch {
    adapterDiagnostics = {};
  }
  const qualityTrace = {
    channel,
    caseId: phaseOneDecision.intent.caseId || null,
    process:
      channel === "coach"
        ? phaseOneDecision.intent.type
        : channelIntentRouting?.intent ||
          getConversationChannelJobType(channel),
    intentType: phaseOneDecision.intent.type,
    intentSubtype: phaseOneDecision.intent.subtype || null,
    primaryEntity: activeContext.opportunityId
      ? "opportunity"
      : activeContext.leadId
        ? "lead"
        : activeContext.contactId
          ? "contact"
          : activeContext.accountId
            ? "account"
            : "none",
    entityResolution: {
      candidateCounts,
      resolvedEntityTypes,
      resolvedEntityIds: {
        accountId: Number(activeContext.accountId || 0) || null,
        opportunityId: Number(activeContext.opportunityId || 0) || null,
        contactId: Number(activeContext.contactId || 0) || null,
        leadId: Number(activeContext.leadId || 0) || null,
      },
      ambiguousTypes: Object.entries(candidateCounts)
        .filter(([, count]) => count > 1)
        .map(([type]) => type),
      clarificationRequired: Boolean(phaseOneDecision.requiresClarification),
    },
    appliedRules: {
      channel,
      process:
        channel === "coach"
          ? phaseOneDecision.intent.type
          : channelIntentRouting?.intent ||
            getConversationChannelJobType(channel),
      filters: phaseOneDecision.filters,
      scope: businessRules.scope,
      filtersDefault: businessRules.filters,
      operationPolicy: effectiveOperationPolicy,
      channelRules: effectiveChannelRules,
    },
    diagnostics: {
      planner: {
        ...plannerDiagnostics,
        evaluation: plannerEvaluation
          ? {
              ...plannerEvaluation,
              genericFallback: Boolean(
                adapterDiagnostics.fallback?.used ||
                plannerDiagnostics.fallbackUsed,
              ),
              retrievalError: Boolean(
                tracedToolResults.some((item) => Boolean(item.error)) ||
                (Array.isArray(adapterDiagnostics.snapshotMetrics) &&
                  adapterDiagnostics.snapshotMetrics.some(
                    (metric) => metric?.errorCode,
                  )),
              ),
              truncatedSourceCount: Array.isArray(
                adapterDiagnostics.snapshotMetrics,
              )
                ? adapterDiagnostics.snapshotMetrics.filter(
                    (metric) => metric?.truncated === true,
                  ).length
                : 0,
            }
          : null,
      },
      responseTypeNormalization: {
        received:
          typeof authoritativeResult?.responseType === "string"
            ? authoritativeResult.responseType
            : null,
        normalized: response?.responseType || null,
        source: authoritativeResult?.responseType
          ? "upstream"
          : channel === "customer_account" && response?.responseType
            ? "customer_account_default"
            : "missing",
      },
      plannerInput: adapterDiagnostics.plannerInput || null,
      channelIntentRouting: channelIntentRouting
        ? {
            intent: channelIntentRouting.intent,
            mode: channelIntentRouting.mode,
            confidence: channelIntentRouting.confidence,
            allowedTools: channelIntentRouting.allowedTools,
            requiredContext: channelIntentRouting.requiredContext,
            missingContext: channelIntentRouting.missingContext,
            requiresClarification: channelIntentRouting.requiresClarification,
          }
        : null,
      fallback: adapterDiagnostics.fallback || {
        used: false,
        reasonCode: null,
      },
      answerGeneration: adapterDiagnostics.answerGeneration || null,
      evidence: adapterDiagnostics.evidence || null,
      answerAudit: adapterDiagnostics.answerAudit || null,
      agentMetrics: adapterDiagnostics.agentMetrics || [],
      failureStage: null,
    },
    toolMetrics: summarizeCoachToolResults(tracedToolResults),
    validationStatus,
    validationReasons,
    responseType: response.responseType,
    confidence: response.confidence,
    evidenceCount,
    toolsUsed: tracedToolResults.map((tool) => tool.toolName).filter(Boolean),
    operationsProposed: proposedOperationCount,
    operationsRejected: Math.max(
      0,
      proposedOperationCount - response.operations.length,
    ),
    latencyMs: Math.max(0, Date.now() - turnStartedAt),
    errorCode: validationReasons[0] || null,
  };
  return {
    response,
    entities: response.entities,
    evidence: response.evidence,
    inferences: response.inferences,
    confidence: response.confidence,
    clarification: response.clarification,
    operations: response.operations,
    activeContext,
    activeContextSource,
    effectiveContext,
    scopedSnapshot,
    readToolResults,
    selectedOpportunity,
    conversationHistory,
    authoritativeStageReadiness,
    requestedToolResults: completedModelTurn.requestedToolResults,
    qualityTrace,
    channelIntentRouting,
  };
}

export async function prepareCoachReadModel({
  user,
  question,
  selectedContext = {},
  conversationHistory = [],
  availableTools = [],
  businessRules = {},
  intentRouting = null,
  dependencies,
}) {
  const {
    getMiAgentContext,
    resolveCoachContextEntities,
    applyCoachEntityResolution,
    normalizeCoachMatchText,
    buildCoachEntityClarification,
    getMiAgentEnrichedContext,
    buildCoachScopedSnapshot,
    isStagePreparationQuestion,
    buildStageReadiness,
  } = dependencies;

  const toolCatalog = Array.isArray(availableTools) ? availableTools : [];
  const availableToolNames = new Set(toolCatalog.map((tool) => tool.name));
  const baseSnapshot = await getMiAgentContext(user);
  let effectiveContext = { ...selectedContext };
  const queryCase = matchCoachQueryCase(question);
  const { explicitEntities } = resolveCoachContextEntities(
    baseSnapshot,
    question,
    conversationHistory,
    effectiveContext,
    businessRules,
    { exactMatchOnly: intentRouting?.intent === "seller_coaching" },
  );
  let questionContextTransition = applyCoachEntityResolution(
    baseSnapshot,
    effectiveContext,
    explicitEntities,
  );
  effectiveContext = questionContextTransition.context;
  if (questionContextTransition.changed) conversationHistory = [];
  const normalizedQuestion = normalizeCoachMatchText(question);
  const hasExplicitEntity = Boolean(
    explicitEntities.account ||
    explicitEntities.opportunity ||
    explicitEntities.contact ||
    explicitEntities.lead,
  );
  const hasExplicitRecordFocus =
    /\b(?:esta|este|esa|ese|mi|mis)\s+(?:cuenta|oportunidad|contacto|lead)\b/.test(
      normalizedQuestion,
    );
  const isPortfolioWideCoachingRequest =
    intentRouting?.intent === "seller_coaching" &&
    !hasExplicitEntity &&
    !hasExplicitRecordFocus &&
    /\b(cartera|pipeline|oportunidades|priorizar|prioridades)\b/.test(
      normalizedQuestion,
    );
  if (isPortfolioWideCoachingRequest) {
    const generalContext = Object.fromEntries(
      CONTEXT_KEYS.map((key) => [key, null]),
    );
    effectiveContext = generalContext;
    questionContextTransition = {
      ...questionContextTransition,
      context: generalContext,
      changed: true,
    };
    conversationHistory = [];
  }
  const relationshipClarification = questionContextTransition.conflict
    ? {
        type: "select_opportunity",
        message: questionContextTransition.conflict.message,
        missing: ["Cuenta, oportunidad o contacto compatibles"],
        candidates: questionContextTransition.conflict.candidates,
        originalRequest: question,
        intendedAction: "continue_request",
      }
    : null;
  const entityClarification =
    relationshipClarification ||
    buildCoachEntityClarification(explicitEntities, question, effectiveContext);
  const historicalQuestion =
    explicitEntities.opportunity?.lifecycle === "historical" ||
    /\b(vend|vent|compr|adquiri|ganad|perdid|anulad|cancelad|cerrad|historial|cotiz|propuest)/.test(
      normalizeCoachMatchText(question),
    );
  const opportunityFilters = inferCoachOpportunityFilters(
    question,
    businessRules,
  );
  const asksForActivatedOpportunities =
    opportunityFilters.activeOnly && !opportunityFilters.openOnly;
  const analysisBaseSnapshot =
    historicalQuestion || asksForActivatedOpportunities
      ? baseSnapshot
      : {
          ...baseSnapshot,
          wonOpportunities: [],
          lostOpportunities: [],
          cancelledOpportunities: [],
        };
  const authorizedBaseSnapshot = buildCoachScopedSnapshot(
    analysisBaseSnapshot,
    effectiveContext,
  );
  const loadedScopedSnapshot =
    intentRouting?.mode === "deep_exploration"
      ? authorizedBaseSnapshot
      : await getMiAgentEnrichedContext(user, authorizedBaseSnapshot);
  const scopedSnapshot = applyCoachBusinessRuleScope(
    loadedScopedSnapshot,
    businessRules,
  );
  const preparationRequested = intentRouting
    ? intentRouting.mode !== "deep_exploration" &&
      intentRouting.intent === "stage_readiness"
    : isStagePreparationQuestion(question);
  const selectedOpportunity =
    scopedSnapshot.selectedRecord?.type === "opportunity"
      ? scopedSnapshot.selectedRecord
      : null;
  const quotationContent =
    queryCase?.readTool === "getOpportunityQuotation" &&
    selectedOpportunity &&
    businessRules.scope?.opportunitySearchAllowed !== false &&
    businessRules.scope?.quotationSearchAllowed !== false &&
    availableToolNames.has("getOpportunityQuotation") &&
    typeof dependencies.getAuthorizedCoachQuotationContent === "function"
      ? await dependencies.getAuthorizedCoachQuotationContent({
          user,
          opportunityId: selectedOpportunity.id,
        })
      : null;
  const toolScopedSnapshot = quotationContent
    ? { ...scopedSnapshot, selectedOpportunityQuotation: quotationContent }
    : scopedSnapshot;
  const deterministicStageReadiness =
    preparationRequested &&
    selectedOpportunity &&
    selectedOpportunity.lifecycle !== "historical"
      ? buildStageReadiness(selectedOpportunity, {
          currentUserId: Number(user.id),
        })
      : null;
  const readToolResults = [];
  const allowedIntentTools = intentRouting
    ? new Set(intentRouting.allowedTools)
    : null;
  const pushReadTool = (toolName, args = {}) => {
    if (!availableToolNames.has(toolName)) return;
    if (allowedIntentTools && !allowedIntentTools.has(toolName)) return;
    readToolResults.push(
      executeCoachReadTool({
        toolName,
        snapshot: toolScopedSnapshot,
        args,
        businessRules,
        buildReadiness: (opportunity) =>
          buildStageReadiness(opportunity, { currentUserId: Number(user.id) }),
      }),
    );
  };
  if (selectedOpportunity) {
    pushReadTool("getOpportunity", {
      opportunityId: selectedOpportunity.id,
    });
    pushReadTool("getOpportunityActivities", {
      opportunityId: selectedOpportunity.id,
    });
  }
  if (
    queryCase?.readTool === "getOpportunityQuotation" &&
    selectedOpportunity &&
    businessRules.scope?.quotationSearchAllowed !== false
  ) {
    pushReadTool("getOpportunityQuotation", {
      opportunityId: selectedOpportunity.id,
    });
  }
  if (preparationRequested && selectedOpportunity) {
    pushReadTool("getOpportunityReadiness", {
      opportunityId: selectedOpportunity.id,
    });
  }
  if (
    /\b(cuenta|cuentas|cliente|clientes|empresa|empresas)\b/.test(
      normalizedQuestion,
    ) ||
    explicitEntities.account
  ) {
    pushReadTool("searchAccounts", {
      accountId: effectiveContext.accountId,
    });
  }
  if (
    /(contacto|contactos|decisor|participantes|roles)\b/.test(
      normalizedQuestion,
    )
  ) {
    pushReadTool("searchContacts", {
      accountId: effectiveContext.accountId,
    });
  }
  if (/\b(lead|leads|prospecto|prospectos)\b/.test(normalizedQuestion)) {
    pushReadTool("searchLeads", {
      accountId: effectiveContext.accountId,
    });
  }
  if (
    /\b(pipeline|cobertura|riesgo|riesgos|prioridades)\b/.test(
      normalizedQuestion,
    )
  ) {
    pushReadTool("getSellerPipeline");
  }
  if (
    intentRouting?.intent === "seller_coaching" &&
    intentRouting.mode === "coaching"
  ) {
    pushReadTool("getSellerPipeline");
  }
  if (
    /\b(oportunidad|oportunidades|etapa|waiting|cotizacion|negociacion|fecha de cierre|cierre|cierran|cerrar)\b/.test(
      normalizedQuestion,
    )
  ) {
    pushReadTool("searchOpportunities", {
      accountId: effectiveContext.accountId,
      text: explicitEntities.account?.name || "",
      stageCodes: opportunityFilters.stageCodes,
      commercialStatusCodes: opportunityFilters.commercialStatusCodes,
      activeOnly: opportunityFilters.activeOnly,
      inactiveOnly: opportunityFilters.inactiveOnly,
      openOnly: opportunityFilters.openOnly,
      closeYear: opportunityFilters.closeYear,
    });
  }
  if (
    queryCase?.readTool &&
    !readToolResults.some((tool) => tool.toolName === queryCase.readTool)
  ) {
    pushReadTool(queryCase.readTool, {
      accountId: effectiveContext.accountId,
    });
  }
  const getToolResult = (toolName) =>
    readToolResults.find((tool) => tool.toolName === toolName)?.result;
  const modelSnapshot = {
    period: toolScopedSnapshot.period || null,
    quota: toolScopedSnapshot.quota || null,
    currencyConversion: toolScopedSnapshot.currencyConversion || null,
    selectedContext: toolScopedSnapshot.selectedContext || effectiveContext,
    selectedRecord: toolScopedSnapshot.selectedRecord || null,
    selectedOpportunity: selectedOpportunity || null,
    selectedOpportunityQuotation: quotationContent,
    accounts: getToolResult("searchAccounts") || [],
    coachOpportunities: getToolResult("searchOpportunities") || [],
    workboard: getToolResult("searchOpportunities") || [],
    leads: getToolResult("searchLeads") || [],
    contactMappings: getToolResult("searchContacts") || [],
    pipeline: getToolResult("getSellerPipeline") || null,
    selectedOpportunityDetail: getToolResult("getOpportunity") || null,
    selectedOpportunityActivities:
      getToolResult("getOpportunityActivities") || [],
    deterministicStageReadiness,
    readToolCatalog: toolCatalog,
    readToolResults,
  };
  const preparationClarification =
    preparationRequested && !selectedOpportunity
      ? {
          type: "select_opportunity",
          message:
            "Selecciona una oportunidad para evaluar su preparación de etapa.",
          missing: ["Oportunidad"],
          candidates: (toolScopedSnapshot.coachOpportunities || [])
            .slice(0, 20)
            .map((opportunity) => ({
              id: Number(opportunity.id),
              name: opportunity.name || "Oportunidad sin nombre",
              accountId:
                Number(opportunity.account?.id || opportunity.accountId || 0) ||
                null,
              contactId:
                Number(opportunity.contact?.id || opportunity.contactId || 0) ||
                null,
              opportunityId: Number(opportunity.id),
              accountName:
                opportunity.accountName || opportunity.account?.name || null,
              stageName: opportunity.stageName || null,
              entityType: "opportunity",
            })),
          originalRequest: question,
          intendedAction: "continue_request",
        }
      : null;
  const requiresOpportunityContext = intentRouting
    ? intentRouting.requiredContext.includes("opportunity")
    : Boolean(queryCase?.requiresOpportunityContext);
  const activityClarification =
    requiresOpportunityContext &&
    !selectedOpportunity &&
    !preparationClarification
      ? {
          type: "select_opportunity",
          message:
            (intentRouting?.intent || queryCase?.type) === "quotation_query"
              ? "Selecciona una oportunidad para consultar el contenido de su cotización."
              : "Selecciona una oportunidad para consultar sus actividades y siguientes pasos.",
          missing: ["Oportunidad"],
          candidates: (toolScopedSnapshot.coachOpportunities || [])
            .slice(0, 20)
            .map((opportunity) => ({
              id: Number(opportunity.id),
              name: opportunity.name || "Oportunidad sin nombre",
              accountId:
                Number(opportunity.account?.id || opportunity.accountId || 0) ||
                null,
              contactId:
                Number(opportunity.contact?.id || opportunity.contactId || 0) ||
                null,
              opportunityId: Number(opportunity.id),
              accountName:
                opportunity.accountName || opportunity.account?.name || null,
              stageName: opportunity.stageName || null,
              entityType: "opportunity",
            })),
          originalRequest: question,
          intendedAction: "continue_request",
        }
      : null;
  const quotationPermissionClarification =
    queryCase?.type === "quotation_query" &&
    !availableToolNames.has("getOpportunityQuotation")
      ? {
          type: "missing_fields",
          message:
            "No tienes permisos para consultar cotizaciones de esta oportunidad.",
          missing: ["Permiso de lectura de cotizaciones"],
          candidates: [],
          originalRequest: question,
          intendedAction: "continue_request",
        }
      : null;
  const quotationNotFoundClarification =
    queryCase?.type === "quotation_query" &&
    selectedOpportunity &&
    availableToolNames.has("getOpportunityQuotation") &&
    !quotationContent
      ? {
          type: "missing_fields",
          message:
            "No encontré una cotización accesible para esta oportunidad.",
          missing: ["Cotización vigente y accesible"],
          candidates: [],
          originalRequest: question,
          intendedAction: "continue_request",
        }
      : null;

  return {
    baseSnapshot,
    effectiveContext,
    explicitEntities,
    questionContextTransition,
    entityClarification,
    scopedSnapshot: toolScopedSnapshot,
    preparationRequested,
    selectedOpportunity,
    deterministicStageReadiness,
    readToolResults,
    modelSnapshot,
    clarification:
      entityClarification ||
      preparationClarification ||
      quotationPermissionClarification ||
      quotationNotFoundClarification ||
      activityClarification,
    conversationHistory,
  };
}
