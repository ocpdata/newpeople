import { executeCoachReadTool } from "./crm-read-tools.js";
import {
  getCoachReadToolCatalog,
  inferCoachOpportunityFilters,
} from "./read-tools.js";

export const CONTEXT_KEYS = [
  "accountId",
  "contactId",
  "opportunityId",
  "quotationId",
  "proposalId",
  "leadId",
];

function normalizeConversationHistory(history) {
  return (Array.isArray(history) ? history : [])
    .filter((message) => message && typeof message === "object")
    .map((message) => ({
      role: message.role === "coach" ? "coach" : "seller",
      text: String(message.text || "")
        .trim()
        .slice(0, 2000),
    }))
    .filter((message) => message.text)
    .slice(-8);
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
      typeof tool === "string"
        ? { name: tool, readOnly: true }
        : tool,
    )
    .filter(
      (tool) =>
        tool?.name && permissionGranted(permissions, tool.requiredPermission),
    );
}

export function applyCoachOperationPolicy(operations = [], policy = {}) {
  const candidates = Array.isArray(operations) ? operations : [];
  if (typeof policy.filterOperations === "function") {
    return policy.filterOperations(candidates);
  }
  const allowedKinds = Array.isArray(policy.allowedKinds)
    ? new Set(policy.allowedKinds)
    : null;
  return candidates.filter((operation) => {
    if (allowedKinds && !allowedKinds.has(operation?.kind)) return false;
    if (policy.sourceChannel && operation?.sourceChannel !== policy.sourceChannel)
      return false;
    return true;
  });
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
    /\b(mayor|mayores|mas|cantidad|numero|numero)\b/.test(
      normalizedQuestion,
    );
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
      opportunity?.accountName || opportunity?.account?.name || "Cuenta sin nombre";
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
    .sort((left, right) => right.count - left.count || left.accountName.localeCompare(right.accountName))
    .slice(0, 5);
  return {
    intent: "pipeline_coverage",
    responseType: "informational",
    answer: ranking.length
      ? `Las cuentas con mayor cantidad de oportunidades abiertas son: ${ranking
          .map((item, index) => `${index + 1}) ${item.accountName} con ${item.count} oportunidad(es) abiertas`)
          .join(", ")}.`
      : "No hay oportunidades abiertas autorizadas para agrupar por cuenta.",
    facts: ranking.map((item) => ({
      sourceType: "account",
      sourceId: item.accountId,
      label: `${item.accountName}: ${item.count} oportunidades abiertas`,
      excerpt: `IDs de oportunidades consultadas: ${item.opportunityIds.join(", ")}`,
    })),
    evidence: ["Conteo determinista sobre oportunidades autorizadas y abiertas."],
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
  channelRules = {},
  permissions = {},
  operationPolicy = {},
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
    if (availableToolNames.size && !availableToolNames.has(call.toolName)) {
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
    phase: "coach_tool_results",
    featureCode,
    jobType: "mi_coach_chat",
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
  dependencies,
}) {
  const {
    buildStageReadiness,
    loadProcessGuide,
    requestMiAgentJson,
    buildCoachPrompt,
    resolveCoachResponseContext,
    normalizeCoachResult,
    featureCode,
  } = dependencies;
  const prepareReadModel = dependencies.prepareReadModel || prepareCoachReadModel;
  const buildPrompt = dependencies.buildPrompt || buildCoachPrompt;
  const requestResponse = dependencies.requestResponse || requestMiAgentJson;
  const resolveResponseContext =
    dependencies.resolveResponseContext || resolveCoachResponseContext;
  const normalizeResponse =
    dependencies.normalizeResponse || normalizeCoachResult;
  const resolvedTools = resolveAvailableCoachTools(
    availableTools.length ? availableTools : getCoachReadToolCatalog(),
    permissions,
  );
  const readModel = await prepareReadModel({
    user,
    question,
    selectedContext: context,
    conversationHistory: history,
    dependencies,
    availableTools: resolvedTools,
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
  } = readModel;
  const processGuide = await loadProcessGuide();
  const promptArguments = [
    modelSnapshot,
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
  const deterministicResult = clarification
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
    : deterministicResult || (await requestResponse({
      payload: buildPrompt(...promptArguments),
        user,
        jobId,
        startedAt: new Date(),
        phase: "coach",
        featureCode,
        jobType: "mi_coach_chat",
      }));
  const completedModelTurn = await completeCoachModelTurn({
    result,
    clarification,
    snapshot: scopedSnapshot,
    modelSnapshot,
    question,
    processGuide,
    effectiveContext,
    conversationHistory,
    user,
    jobId,
    startedAt: new Date(),
    featureCode,
    channelRules,
    permissions,
    operationPolicy,
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
  const response = normalizeResponse(
    authoritativeResult,
    scopedSnapshot,
    question,
    effectiveContext,
    authoritativeStageReadiness,
  );
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
  response.operations = applyCoachOperationPolicy(
    response.operations,
    operationPolicy,
  );
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
  };
}

export async function prepareCoachReadModel({
  user,
  question,
  selectedContext = {},
  conversationHistory = [],
  availableTools = [],
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

  const toolCatalog = resolveAvailableCoachTools(
    availableTools.length ? availableTools : getCoachReadToolCatalog(),
  );
  const availableToolNames = new Set(toolCatalog.map((tool) => tool.name));
  const baseSnapshot = await getMiAgentContext(user);
  let effectiveContext = { ...selectedContext };
  const { explicitEntities } = resolveCoachContextEntities(
    baseSnapshot,
    question,
    conversationHistory,
    effectiveContext,
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
    buildCoachEntityClarification(
      explicitEntities,
      question,
      effectiveContext,
    );
  const historicalQuestion =
    explicitEntities.opportunity?.lifecycle === "historical" ||
    /\b(vend|vent|compr|adquiri|ganad|perdid|anulad|cancelad|cerrad|historial|cotiz|propuest)/.test(
      normalizeCoachMatchText(question),
    );
  const normalizedQuestion = normalizeCoachMatchText(question);
  const opportunityFilters = inferCoachOpportunityFilters(question);
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
  const scopedSnapshot = await getMiAgentEnrichedContext(
    user,
    buildCoachScopedSnapshot(analysisBaseSnapshot, effectiveContext),
  );
  const preparationRequested = isStagePreparationQuestion(question);
  const selectedOpportunity =
    scopedSnapshot.selectedRecord?.type === "opportunity"
      ? scopedSnapshot.selectedRecord
      : null;
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
        snapshot: scopedSnapshot,
        args,
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
  if (/(contacto|contactos|decisor|participantes|roles)\b/.test(normalizedQuestion)) {
    pushReadTool("searchContacts", {
      accountId: effectiveContext.accountId,
    });
  }
  if (/\b(lead|leads|prospecto|prospectos)\b/.test(normalizedQuestion)) {
    pushReadTool("searchLeads", {
      accountId: effectiveContext.accountId,
    });
  }
  if (/\b(pipeline|cobertura|riesgo|riesgos|prioridades)\b/.test(normalizedQuestion)) {
    pushReadTool("getSellerPipeline");
  }
  if (/\b(oportunidad|oportunidades|etapa|waiting|cotizacion|negociacion)\b/.test(normalizedQuestion)) {
    pushReadTool("searchOpportunities", {
      accountId: effectiveContext.accountId,
      text: explicitEntities.account?.name || "",
      stageCodes: opportunityFilters.stageCodes,
      commercialStatusCodes: opportunityFilters.commercialStatusCodes,
      activeOnly: opportunityFilters.activeOnly,
      inactiveOnly: opportunityFilters.inactiveOnly,
      openOnly: opportunityFilters.openOnly,
    });
  }
  const getToolResult = (toolName) =>
    readToolResults.find((tool) => tool.toolName === toolName)?.result;
  const modelSnapshot = {
    period: scopedSnapshot.period || null,
    quota: scopedSnapshot.quota || null,
    currencyConversion: scopedSnapshot.currencyConversion || null,
    selectedContext: scopedSnapshot.selectedContext || effectiveContext,
    selectedRecord: scopedSnapshot.selectedRecord || null,
    selectedOpportunity: selectedOpportunity || null,
    accounts: getToolResult("searchAccounts") || [],
    coachOpportunities: getToolResult("searchOpportunities") || [],
    workboard: getToolResult("searchOpportunities") || [],
    leads: getToolResult("searchLeads") || [],
    contactMappings: getToolResult("searchContacts") || [],
    pipeline: getToolResult("getSellerPipeline") || null,
    selectedOpportunityDetail: getToolResult("getOpportunity") || null,
    selectedOpportunityActivities: getToolResult("getOpportunityActivities") || [],
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
          candidates: (scopedSnapshot.coachOpportunities || [])
            .slice(0, 20)
            .map((opportunity) => ({
              id: Number(opportunity.id),
              name: opportunity.name || "Oportunidad sin nombre",
              accountId:
                Number(
                  opportunity.account?.id || opportunity.accountId || 0,
                ) || null,
              contactId:
                Number(
                  opportunity.contact?.id || opportunity.contactId || 0,
                ) || null,
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

  return {
    baseSnapshot,
    effectiveContext,
    explicitEntities,
    questionContextTransition,
    entityClarification,
    scopedSnapshot,
    preparationRequested,
    selectedOpportunity,
    deterministicStageReadiness,
    readToolResults,
    modelSnapshot,
    clarification: entityClarification || preparationClarification,
    conversationHistory,
  };
}
