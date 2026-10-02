import { getCoachSession, setCoachPendingQuestion } from "./service.js";
import { config } from "../config.js";
import {
  normalizeCoachGatewayRequest,
  resolveCoachTurnContext,
} from "./conversation-engine.js";
import { classifyCoachIntent } from "./phase-one-engine.js";
import { createCoachAdapter } from "./coach-adapter.js";
import { loadCoachBusinessRules } from "./business-rules.js";
import { recordCoachTurnQualityTrace } from "./observability.js";

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

function collectIds(value, ids = new Set()) {
  if (!value || typeof value !== "object") return ids;
  if (Array.isArray(value)) {
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

export { normalizeCoachGatewayRequest, resolveCoachTurnContext };

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
    persistCoachOperations,
    appendCoachSessionTurn,
  } = dependencies;

  try {
    await query(
      `UPDATE mi_agent_analysis_jobs SET status = 'running', updated_at = NOW(3) WHERE id = ?`,
      [jobId],
    );
    const businessRules = dependencies.loadCoachBusinessRules
      ? await dependencies.loadCoachBusinessRules({
          channel: "coach",
          process: classifyCoachIntent(question).type,
        })
      : await loadCoachBusinessRules({
          channel: "coach",
          process: classifyCoachIntent(question).type,
        });
    const coachAdapter = createCoachAdapter({ user, dependencies, businessRules });
    const engineResult = await coachAdapter.runTurn({
      question,
      context: selectedContext,
      history: conversationHistory,
      jobId,
    });
    const qualityTraceId = await recordCoachTurnQualityTrace({
      channel: "coach",
      process: engineResult.qualityTrace?.process,
      userId: user.id,
      sessionId,
      jobId,
      trace: engineResult.qualityTrace,
    }).catch((error) => {
      console.warn("[mi-agent] No fue posible registrar traza de calidad:", error?.message || error);
      return null;
    });
    const { response: normalizedResult, activeContext, readToolResults } =
      engineResult;
    if (qualityTraceId) normalizedResult.qualityTraceId = qualityTraceId;
    conversationHistory = engineResult.conversationHistory;
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
    await recordCoachTurnQualityTrace({
      channel: "coach",
      process: classifyCoachIntent(question).type,
      userId: user.id,
      sessionId,
      jobId,
      trace: {
        intentType: classifyCoachIntent(question).type,
        intentSubtype: classifyCoachIntent(question).subtype,
        primaryEntity: selectedContext.opportunityId
          ? "opportunity"
          : selectedContext.leadId
            ? "lead"
            : selectedContext.contactId
              ? "contact"
              : selectedContext.accountId
                ? "account"
                : "none",
        appliedRules: { channel: "coach", engineMode: "gateway" },
        validationStatus: "error",
        validationReasons: ["turn_execution_failed"],
        errorCode: String(error?.code || error?.name || "turn_execution_failed"),
        latencyMs: Math.max(0, Date.now() - startedAt),
      },
    }).catch(() => undefined);
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
