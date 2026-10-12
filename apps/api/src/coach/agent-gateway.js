import { getCoachSession, setCoachPendingQuestion } from "./service.js";
import {
  normalizeCoachGatewayRequest,
  resolveCoachTurnContext,
} from "./conversation-engine.js";
import { classifyCoachIntent } from "./phase-one-engine.js";
import {
  createCoachAdapter,
  coachBlockPipelineEnabled,
} from "./coach-adapter.js";
import { createCoachBlockTrace } from "./block-runtime.js";
import { loadCoachBusinessRules } from "./business-rules.js";
import { recordCoachTurnQualityTrace } from "./observability.js";
import { runCoachDecision } from "./coach-orchestrator.js";
import { summarizeCoachDecisionTrace } from "./decision-trace.js";
import { config } from "../config.js";

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

function buildCoachPermissionSnapshot(user = {}) {
  const permissionSet = user?.permissionSet || new Set();
  const permissionValues = Array.from(permissionSet || []);

  return {
    canReadAccounts:
      permissionValues.some((value) =>
        [
          "cuentas.read",
          "cuentas.leer",
          "account.read",
          "read:accounts",
        ].includes(value),
      ) || Boolean(user?.canReadAccounts),
    canReadOpportunities:
      permissionValues.some((value) =>
        [
          "oportunidades.read",
          "oportunidades.leer",
          "opportunities.read",
          "read:opportunities",
        ].includes(value),
      ) || Boolean(user?.canReadOpportunities),
    canWriteOpportunities:
      permissionValues.some((value) =>
        [
          "oportunidades.write",
          "oportunidades.editar",
          "opportunities.write",
          "write:opportunities",
        ].includes(value),
      ) || Boolean(user?.canWriteOpportunities),
    canReadHistory:
      permissionValues.some((value) =>
        ["historial.read", "history.read", "read:history"].includes(value),
      ) || Boolean(user?.canReadHistory),
  };
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
  const decisionTrace = result?.decisionTrace || result?.finalDecision || null;
  return {
    intent: result?.intent || (error ? "error" : "unknown"),
    responseType: result?.responseType || (error ? "error" : "unknown"),
    primaryEntity,
    toolsUsed: readToolResults.map((tool) => tool.toolName).filter(Boolean),
    queriedIds: [...collectIds(readToolResults)],
    decision: decisionTrace
      ? {
          intent:
            decisionTrace.finalDecision?.intent || decisionTrace.intent || null,
          b3Bucket: decisionTrace.preDecision?.bucket || null,
          semanticIntent: decisionTrace.semanticDecision?.intent || null,
          interactionMode: decisionTrace.finalDecision?.interactionMode || null,
          policyProcess: decisionTrace.finalDecision?.policyProcess || null,
          requiresClarification: Boolean(
            decisionTrace.finalDecision?.requiresClarification,
          ),
          confidence:
            decisionTrace.finalDecision?.confidence ??
            decisionTrace.summary?.confidence ??
            result?.confidence ??
            null,
          resolution:
            decisionTrace.finalDecision?.source?.resolver ||
            decisionTrace.summary?.resolution ||
            null,
          conflict: decisionTrace.summary?.conflict || null,
          reason: decisionTrace.finalDecision?.reason || null,
        }
      : null,
    result: {
      confidence: result?.confidence || null,
      hasClarification: Boolean(result?.clarification),
      operationCount: Array.isArray(result?.operations)
        ? result.operations.length
        : 0,
    },
    latencyMs: Math.max(0, Date.now() - startedAt),
    error: error ? String(error.message || error).slice(0, 1000) : null,
    action:
      Array.isArray(result?.operations) && result.operations.length
        ? result.operations.map((operation) => ({
            kind: operation.kind,
            status:
              operation.persistenceStatus || operation.status || "proposed",
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
  const conversationHistory =
    session && !request.conversationHistory.length
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
  const { query, persistCoachOperations, appendCoachSessionTurn } =
    dependencies;
  const executionTrace = coachBlockPipelineEnabled(dependencies)
    ? createCoachBlockTrace({ jobId })
    : null;
  const permissionSnapshot = buildCoachPermissionSnapshot(user);
  const decisionContext = {
    ...selectedContext,
    accountId: selectedContext?.accountId || null,
  };
  const classifySemanticIntent = dependencies.requestMiAgentJson
    ? ({ message, context }) =>
        dependencies.requestMiAgentJson({
          payload: {
            model: config.openai.model,
            temperature: 0,
            text: { format: { type: "json_object" } },
            input: [
              {
                role: "system",
                content:
                  "Clasifica la intención del usuario para Coach usando exactamente uno de estos valores: seller_coaching, account_performance, account_query, opportunity_query, create_opportunity, update_opportunity, general_query, clarify_needed. Usa clarify_needed si la petición es ambigua o no alcanza confianza 0.68. Devuelve JSON con intent, confidence entre 0 y 1 y reason. No propongas herramientas, no decidas permisos y no ejecutes acciones.",
              },
              {
                role: "user",
                content: JSON.stringify({
                  message,
                  context: {
                    selectedAccount: Boolean(context?.accountId),
                    selectedOpportunity: Boolean(context?.opportunityId),
                    selectedContact: Boolean(context?.contactId),
                    selectedLead: Boolean(context?.leadId),
                  },
                  conversationHistory,
                }),
              },
            ],
          },
          user,
          jobId,
          startedAt: new Date(),
          phase: "coach_final_intent",
          featureCode: dependencies.featureCode || "mi_coach",
          jobType: "mi_coach_chat",
        })
    : null;
  const decision = await runCoachDecision(
    question,
    decisionContext,
    permissionSnapshot,
    classifySemanticIntent,
  );
  const decisionTraceSummary = summarizeCoachDecisionTrace(decision);
  const coachIntentClassification = {
    ...classifyCoachIntent(question),
    type: decision.finalDecision.intent,
    subtype: decision.finalDecision.intent,
    interactionMode: decision.finalDecision.interactionMode,
    policyProcess: decision.finalDecision.policyProcess,
    requiresClarification: decision.finalDecision.requiresClarification,
    operationRequested:
      decision.finalDecision.intent === "create_opportunity" ||
      decision.finalDecision.intent === "update_opportunity",
    decisionTrace: {
      ...decision,
      summary: decisionTraceSummary,
    },
  };
  executionTrace?.record({
    from: "B2",
    to: "B3",
    label: "Procesar job de Coach",
    phase: "call",
    status: "started",
    input: {
      intentType: coachIntentClassification.type,
      interactionMode: coachIntentClassification.interactionMode,
      policyProcess: coachIntentClassification.policyProcess,
      decisionTrace: decision,
    },
  });

  try {
    await query(
      `UPDATE mi_agent_analysis_jobs SET status = 'running', updated_at = NOW(3) WHERE id = ?`,
      [jobId],
    );
    const businessRules = dependencies.loadCoachBusinessRules
      ? await dependencies.loadCoachBusinessRules({
          channel: "coach",
          process: coachIntentClassification.policyProcess,
        })
      : await loadCoachBusinessRules({
          channel: "coach",
          process: coachIntentClassification.policyProcess,
        });
    const coachAdapter = createCoachAdapter({
      user,
      dependencies,
      businessRules,
      coachIntentClassification,
    });
    const runAdapter = () =>
      coachAdapter.runTurn({
        question,
        context: selectedContext,
        history: conversationHistory,
        jobId,
        executionTrace,
      });
    const engineResult = executionTrace
      ? await executionTrace.span(
          "B3",
          "B4",
          "Delegar turno al adaptador Coach",
          runAdapter,
          (value) => ({ responseType: value.response?.responseType || null }),
        )
      : await runAdapter();
    const qualityTraceId = await recordCoachTurnQualityTrace({
      channel: "coach",
      process: engineResult.qualityTrace?.process,
      userId: user.id,
      sessionId,
      jobId,
      trace: {
        ...engineResult.qualityTrace,
        diagnostics: {
          ...engineResult.qualityTrace?.diagnostics,
          decision: {
            intent: decision.finalDecision.intent,
            b3Bucket: decision.preDecision.bucket,
            semanticIntent: decision.semanticDecision.intent,
            interactionMode: decision.finalDecision.interactionMode,
            policyProcess: decision.finalDecision.policyProcess,
            confidence: decision.finalDecision.confidence,
            requiresClarification: decision.finalDecision.requiresClarification,
            resolution: decision.finalDecision.source?.resolver || "unknown",
            conflict: decisionTraceSummary.conflict,
            reason: decision.finalDecision.reason,
            source: decision.finalDecision.source,
          },
        },
      },
    }).catch((error) => {
      console.warn(
        "[mi-agent] No fue posible registrar traza de calidad:",
        error?.message || error,
      );
      return null;
    });
    const {
      response: normalizedResult,
      activeContext,
      readToolResults,
    } = engineResult;
    normalizedResult.decisionTrace = {
      ...decision,
      summary: decisionTraceSummary,
    };
    if (qualityTraceId) normalizedResult.qualityTraceId = qualityTraceId;
    conversationHistory = engineResult.conversationHistory;
    executionTrace?.record({
      from: "B3",
      to: "B11",
      label: "Persistir operaciones y sesión de Coach",
      phase: "call",
      status: "started",
    });
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
    if (executionTrace) {
      executionTrace.record({
        from: "B11",
        to: "B3",
        label: "Persistir operaciones y sesión de Coach",
        phase: "return",
        status: "completed",
        output: {
          sessionPersisted: Boolean(sessionId),
          operationsPersisted: persistedOperations.length,
        },
      });
      executionTrace.record({
        from: "B3",
        to: "B2",
        label: "Procesar job de Coach",
        phase: "return",
        status: "completed",
        output: {
          intentType: coachIntentClassification.type,
          interactionMode: coachIntentClassification.interactionMode,
          policyProcess: coachIntentClassification.policyProcess,
          responseType: normalizedResult.responseType,
          validationStatus: engineResult.qualityTrace?.validationStatus,
        },
      });
    }
    await query(
      `UPDATE mi_agent_analysis_jobs
       SET status = 'completed', result_json = ?, observability_json = ?, latency_ms = ?,
           error_message = NULL, updated_at = NOW(3)
       WHERE id = ?`,
      [
        JSON.stringify(normalizedResult),
        JSON.stringify({
          ...buildTurnObservability({
            result: normalizedResult,
            readToolResults,
            startedAt,
            activeContext,
          }),
          ...(executionTrace
            ? {
                architecture: "coach_blocks_v1",
                executionTrace: executionTrace.events,
              }
            : {}),
        }),
        Math.max(0, Date.now() - startedAt),
        jobId,
      ],
    );
  } catch (error) {
    executionTrace?.record({
      from: "B3",
      to: "B2",
      label: "Procesar job de Coach",
      phase: "return",
      status: "failed",
      errorCode: String(error.code || error.name || "coach_job_failed"),
    });
    await recordCoachTurnQualityTrace({
      channel: "coach",
      process: coachIntentClassification.type,
      userId: user.id,
      sessionId,
      jobId,
      trace: {
        intentType: coachIntentClassification.type,
        intentSubtype: coachIntentClassification.subtype,
        primaryEntity: selectedContext.opportunityId
          ? "opportunity"
          : selectedContext.leadId
            ? "lead"
            : selectedContext.contactId
              ? "contact"
              : selectedContext.accountId
                ? "account"
                : "none",
        appliedRules: {
          channel: "coach",
          engineMode: "gateway",
          policyProcess: coachIntentClassification.policyProcess,
        },
        validationStatus: "error",
        validationReasons: ["turn_execution_failed"],
        errorCode: String(
          error?.code || error?.name || "turn_execution_failed",
        ),
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
