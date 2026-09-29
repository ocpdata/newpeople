import { getCoachSession, setCoachPendingQuestion } from "./service.js";
import { config } from "../config.js";
import {
  executeCoachReadTool,
} from "./crm-read-tools.js";
import {
  getCoachReadToolCatalog,
  inferCoachOpportunityFilters,
} from "./read-tools.js";

const CONTEXT_KEYS = [
  "accountId",
  "contactId",
  "opportunityId",
  "quotationId",
  "proposalId",
  "leadId",
];

export function resolveCoachRolloutMode(user = {}) {
  const configuredMode = ["legacy", "gateway", "shadow", "pilot"].includes(
    config.features.coachAgentGatewayMode,
  )
    ? config.features.coachAgentGatewayMode
    : "gateway";
  if (configuredMode !== "pilot") return configuredMode;
  return config.features.coachAgentGatewayPilotUserIds.includes(Number(user.id))
    ? "gateway"
    : "legacy";
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

export function coachSessionContextMatchesRequest(
  requestContext,
  sessionContext = {},
) {
  if (!requestContext || typeof requestContext !== "object") return true;
  return Object.keys(requestContext).every((key) => {
    const requestedId = Number(requestContext[key] || 0) || null;
    const storedId = Number(sessionContext?.[key] || 0) || null;
    return requestedId === storedId;
  });
}

export function getCoachConversationHistory(
  messages = [],
  requestContext = null,
  sessionContext = {},
) {
  if (!coachSessionContextMatchesRequest(requestContext, sessionContext)) {
    return [];
  }
  return (Array.isArray(messages) ? messages : [])
    .filter(
      (message) =>
        !message.context ||
        coachSessionContextMatchesRequest(requestContext, message.context),
    )
    .slice(-8)
    .map((message) => ({
      role: message.role,
      text: message.text || message.result?.answer || "",
    }))
    .filter((message) => message.text);
}

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

function normalizeToolCalls(value) {
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

function collectIds(value, ids = new Set()) {
  if (!value || typeof value !== "object") return ids;
  if (Array.isArray(value)) {
    value.forEach((item) => collectIds(item, ids));
    return ids;
  }
  for (const [key, item] of Object.entries(value)) {
    if (
      /(?:^|_)(?:id|ids)$/.test(key) &&
      (typeof item === "number" || Array.isArray(item))
    ) {
      const values = Array.isArray(item) ? item : [item];
      values
        .map((id) => Number(id || 0))
        .filter((id) => id > 0)
        .forEach((id) => ids.add(id));
    } else if (item && typeof item === "object") {
      collectIds(item, ids);
    }
  }
  return ids;
}

function buildTurnObservability({
  result,
  readToolResults = [],
  startedAt,
  activeContext = {},
  error = null,
}) {
  const primaryEntity = activeContext.opportunityId
    ? "opportunity"
    : activeContext.leadId
      ? "lead"
      : activeContext.contactId
        ? "contact"
        : activeContext.accountId
          ? "account"
          : "none";
  return {
    intent: result?.intent || (error ? "error" : "unknown"),
    responseType: result?.responseType || (error ? "error" : "unknown"),
    primaryEntity,
    toolsUsed: readToolResults.map((tool) => tool.toolName).filter(Boolean),
    queriedIds: [...collectIds(readToolResults)],
    result: {
      confidence: result?.confidence || null,
      hasClarification: Boolean(result?.clarification),
      operationCount: Array.isArray(result?.operations)
        ? result.operations.length
        : 0,
    },
    latencyMs: Math.max(0, Date.now() - startedAt),
    error: error ? String(error.message || error).slice(0, 1000) : null,
    action: Array.isArray(result?.operations) && result.operations.length
      ? result.operations.map((operation) => ({
          kind: operation.kind,
          status: operation.persistenceStatus || operation.status || "proposed",
          id: operation.persistentId || null,
        }))
      : null,
  };
}

export function normalizeCoachGatewayRequest(body = {}) {
  return {
    question: String(body?.question || "").trim(),
    conversationHistory: normalizeConversationHistory(body?.history),
    requestContext: normalizeRequestContext(body?.context),
    requestedSessionId: Number(body?.sessionId || 0) || null,
  };
}

export async function prepareCoachTurn({ userId, body = {} }) {
  const request = normalizeCoachGatewayRequest(body);
  let session = request.requestedSessionId
    ? await getCoachSession(userId, request.requestedSessionId)
    : null;
  if (session?.status === "closed") session = null;

  const selectedContext = resolveCoachTurnContext(
    request.requestContext,
    session?.context,
    Boolean(session),
  );
  const conversationHistory = session && !request.conversationHistory.length
    ? getCoachConversationHistory(
        session.messages,
        session.context,
        session.context,
      )
    : request.conversationHistory;

  return {
    ...request,
    selectedContext,
    conversationHistory,
    session,
  };
}

export async function runCoachJob({
  jobId,
  user,
  question,
  selectedContext = {},
  conversationHistory = [],
  sessionId = null,
  dependencies,
}) {
  const startedAt = Date.now();
  const {
    query,
    getMiAgentContext,
    resolveCoachContextEntities,
    applyCoachEntityResolution,
    normalizeCoachMatchText,
    buildCoachEntityClarification,
    getMiAgentEnrichedContext,
    buildCoachScopedSnapshot,
    isStagePreparationQuestion,
    buildStageReadiness,
    loadProcessGuide,
    requestMiAgentJson,
    buildCoachPrompt,
    resolveCoachResponseContext,
    normalizeCoachResult,
    persistCoachOperations,
    appendCoachSessionTurn,
    featureCode,
  } = dependencies;

  try {
    await query(
      `UPDATE mi_agent_analysis_jobs SET status = 'running', updated_at = NOW(3) WHERE id = ?`,
      [jobId],
    );
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
    const analysisBaseSnapshot = historicalQuestion
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
    const normalizedQuestion = normalizeCoachMatchText(question);
    const readToolResults = [];
    const pushReadTool = (toolName, args = {}) => {
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
    if (/\b(contacto|contactos|decisor|participantes|roles)\b/.test(normalizedQuestion)) {
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
      const opportunityFilters = inferCoachOpportunityFilters(question);
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
      selectedOpportunityActivities:
        getToolResult("getOpportunityActivities") || [],
      deterministicStageReadiness,
      readToolCatalog: getCoachReadToolCatalog(),
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
    const clarification = entityClarification || preparationClarification;
    const promptSnapshot = {
      ...(deterministicStageReadiness
        ? { ...scopedSnapshot, deterministicStageReadiness }
        : scopedSnapshot),
      readToolResults,
    };
    const processGuide = await loadProcessGuide();
    let result = clarification
      ? {
          intent: "clarification",
          responseType: "clarification",
          answer: clarification.message,
          confidence: "high",
          clarification,
          operations: [],
        }
      : await requestMiAgentJson({
          payload: buildCoachPrompt(
            modelSnapshot,
            question,
            processGuide,
            effectiveContext,
            conversationHistory,
          ),
          user,
          jobId,
          startedAt: new Date(),
          phase: "coach",
          featureCode,
          jobType: "mi_coach_chat",
        });
    const requestedToolCalls = normalizeToolCalls(result);
    if (!clarification && requestedToolCalls.length) {
      const requestedToolResults = requestedToolCalls.map((call) => {
        try {
          return executeCoachReadTool({
            toolName: call.toolName,
            snapshot: scopedSnapshot,
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
      result = await requestMiAgentJson({
        payload: buildCoachPrompt(
          {
            ...modelSnapshot,
            readToolResults: [...readToolResults, ...requestedToolResults],
          },
          question,
          processGuide,
          effectiveContext,
          conversationHistory,
        ),
        user,
        jobId,
        startedAt: new Date(),
        phase: "coach_tool_results",
        featureCode,
        jobType: "mi_coach_chat",
      });
    }
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
        ? resolveCoachResponseContext(scopedSnapshot, effectiveContext, result)
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
    const normalizedResult = normalizeCoachResult(
      authoritativeResult,
      scopedSnapshot,
      question,
      effectiveContext,
      authoritativeStageReadiness,
    );
    normalizedResult.entities = {
      ...normalizedResult.entities,
      accountId: activeContext.accountId,
      opportunityId: activeContext.opportunityId,
      contactId: activeContext.contactId,
      leadId: activeContext.leadId,
    };
    normalizedResult.activeContext = activeContext;
    normalizedResult.activeContextSource = activeContextSource;
    const persistedOperations = sessionId
      ? await persistCoachOperations({
          userId: user.id,
          sessionId,
          sourceJobId: jobId,
          originalIntent: question,
          entities: normalizedResult.entities,
          operations: normalizedResult.operations,
        })
      : [];
    if (persistedOperations.length) {
      normalizedResult.operations = normalizedResult.operations.map(
        (operation, index) => ({
          ...operation,
          persistentId: persistedOperations[index]?.id,
          persistenceVersion: persistedOperations[index]?.version,
          persistenceStatus: persistedOperations[index]?.status,
        }),
      );
    }
    await query(
      `UPDATE mi_agent_analysis_jobs
       SET status = 'completed', result_json = ?, observability_json = ?, latency_ms = ?,
           error_message = NULL, updated_at = NOW(3)
       WHERE id = ?`,
      [
        JSON.stringify(normalizedResult),
        JSON.stringify(
          buildTurnObservability({
            result: normalizedResult,
            readToolResults,
            startedAt,
            activeContext,
          }),
        ),
        Math.max(0, Date.now() - startedAt),
        jobId,
      ],
    );
    if (sessionId) {
      await setCoachPendingQuestion(user.id, sessionId, null);
    }
    if (sessionId) {
      await appendCoachSessionTurn(
        user.id,
        sessionId,
        { role: "seller", text: question },
        activeContext,
      );
      await appendCoachSessionTurn(
        user.id,
        sessionId,
        {
          role: "coach",
          text: normalizedResult.answer,
          result: normalizedResult,
        },
        activeContext,
      );
    }
  } catch (error) {
    if (sessionId) {
      await setCoachPendingQuestion(user.id, sessionId, null).catch(
        () => undefined,
      );
    }
    await query(
      `UPDATE mi_agent_analysis_jobs
       SET status = 'failed', error_message = ?, observability_json = ?, latency_ms = ?, updated_at = NOW(3)
       WHERE id = ?`,
      [
        String(error?.message || "No fue posible responder la pregunta").slice(
          0,
          1000,
        ),
        JSON.stringify(
          buildTurnObservability({
            result: null,
            readToolResults: [],
            startedAt,
            activeContext: selectedContext,
            error,
          }),
        ),
        Math.max(0, Date.now() - startedAt),
        jobId,
      ],
    ).catch(() => undefined);
  }
}
