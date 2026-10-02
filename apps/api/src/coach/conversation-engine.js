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

function normalizeConversationHistory(history) {
  return normalizeChannelConversationHistory(history, "coach");
}

export function getConversationChannelJobType(channel = "coach") {
  if (channel === "customer_account") return "account_chat";
  if (channel === "prospect") return "prospect_chat";
  return "mi_coach_chat";
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
    hasEvidence ||
    ["clarification", "error"].includes(response.responseType)
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
  const businessRules =
    configuredBusinessRules ||
    getCoachBusinessRules({
      channel,
      overrides: channelRules,
    });
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
  const readModel = await prepareReadModel({
    user,
    question,
    selectedContext: context,
    conversationHistory: channelHistory,
    dependencies,
    availableTools: resolvedTools,
    businessRules,
  });
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
  const deterministicResult =
    clarification || channel !== "coach"
      ? null
      : buildDeterministicAccountOpportunityRanking(
          question,
          modelSnapshot.coachOpportunities || [],
        );
  let result = clarification
    ? {
        intent: "clarification",
        responseType: "clarification",
        answer: clarification.message,
        confidence: "high",
        clarification,
        operations: [],
      }
    : deterministicResult ||
      (await requestResponse({
        payload: buildPrompt(...promptArguments),
        user,
        jobId,
        startedAt: new Date(),
        phase: channel,
        featureCode,
        jobType,
      }));
  const completedModelTurn = await completeCoachModelTurn({
    result,
    clarification,
    snapshot: scopedSnapshot,
    modelSnapshot: promptModelSnapshot,
    question,
    processGuide,
    effectiveContext,
    conversationHistory,
    user,
    jobId,
    startedAt: new Date(),
    featureCode,
    channel,
    jobType,
    channelRules: effectiveChannelRules,
    permissions,
    operationPolicy: effectiveOperationPolicy,
    businessRules,
    availableTools: resolvedTools,
    dependencies: {
      buildStageReadiness,
      buildCoachPrompt,
      requestMiAgentJson,
      buildPrompt,
      requestResponse,
      executeReadTool: dependencies.executeReadTool,
    },
  });
  result = completedModelTurn.result;
  const requiresStageReadiness =
    !clarification &&
    selectedOpportunity &&
    selectedOpportunity.lifecycle !== "historical" &&
    (preparationRequested || result?.intent === "opportunity_preparation");
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
  const responseContextTransition =
    !clarification && !result?.clarification
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
          intent: classifyCoachIntent(question),
          businessRules,
        })
      : {
          intent: {
            type: "channel_query",
            subtype: channel,
            requiresClarification: Boolean(result?.clarification),
            operationRequested: Boolean(result?.operations?.length),
          },
          requiresClarification: Boolean(result?.clarification),
          allowOperations: Boolean(result?.operations?.length),
          filters: {
            sourceChannel: channel,
            scope: channel,
            entityContext: effectiveContext,
          },
        };
  const normalizedResponse = normalizeResponse(
    authoritativeResult,
    scopedSnapshot,
    question,
    effectiveContext,
    authoritativeStageReadiness,
  );
  const proposedOperationCount = Array.isArray(normalizedResponse.operations)
    ? normalizedResponse.operations.length
    : 0;
  const validationReasons = [];
  if (!String(normalizedResponse?.answer || "").trim()) {
    validationReasons.push("missing_answer");
  }
  const evidenceCount =
    (Array.isArray(normalizedResponse?.evidence)
      ? normalizedResponse.evidence.length
      : 0) +
    (Array.isArray(normalizedResponse?.facts)
      ? normalizedResponse.facts.length
      : 0);
  if (
    (businessRules.validation.requireEvidence ||
      businessRules.scope.requireBusinessEvidence) &&
    !evidenceCount &&
    !["clarification", "error"].includes(normalizedResponse?.responseType)
  ) {
    validationReasons.push("missing_business_evidence");
  }
  const validationStatus = ["error"].includes(normalizedResponse?.responseType)
    ? "error"
    : validationReasons.length
      ? "invalid"
      : normalizedResponse?.responseType === "clarification"
        ? "clarification"
        : "valid";
  const response = enforceCoachBusinessEvidence(
    normalizedResponse,
    question,
    businessRules,
  );
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
  const qualityTrace = {
    channel,
    caseId: phaseOneDecision.intent.caseId || null,
    process:
      channel === "coach"
        ? phaseOneDecision.intent.type
        : getConversationChannelJobType(channel),
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
          : getConversationChannelJobType(channel),
      filters: phaseOneDecision.filters,
      scope: businessRules.scope,
      filtersDefault: businessRules.filters,
      operationPolicy: effectiveOperationPolicy,
      channelRules: effectiveChannelRules,
    },
    validationStatus,
    validationReasons,
    responseType: response.responseType,
    confidence: response.confidence,
    evidenceCount,
    toolsUsed: [...readToolResults, ...completedModelTurn.requestedToolResults]
      .map((tool) => tool.toolName)
      .filter(Boolean),
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
  };
}

export async function prepareCoachReadModel({
  user,
  question,
  selectedContext = {},
  conversationHistory = [],
  availableTools = [],
  businessRules = {},
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
  );
  const questionContextTransition = applyCoachEntityResolution(
    baseSnapshot,
    effectiveContext,
    explicitEntities,
  );
  effectiveContext = questionContextTransition.context;
  if (questionContextTransition.changed) conversationHistory = [];
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
  const normalizedQuestion = normalizeCoachMatchText(question);
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
  const loadedScopedSnapshot = await getMiAgentEnrichedContext(
    user,
    buildCoachScopedSnapshot(analysisBaseSnapshot, effectiveContext),
  );
  const scopedSnapshot = applyCoachBusinessRuleScope(
    loadedScopedSnapshot,
    businessRules,
  );
  const preparationRequested = isStagePreparationQuestion(question);
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
  const pushReadTool = (toolName, args = {}) => {
    if (!availableToolNames.has(toolName)) return;
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
  const activityClarification =
    queryCase?.requiresOpportunityContext && !selectedOpportunity
      ? {
          type: "select_opportunity",
          message:
            queryCase.type === "quotation_query"
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
