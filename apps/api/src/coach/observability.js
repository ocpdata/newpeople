import { createHash } from "node:crypto";
import { query } from "../db.js";
import { ensureCoachSchema } from "./schema.js";

export const COACH_CHANNELS = ["coach", "customer_account", "prospect"];
const COACH_ROLLOUT_CHANNELS = ["coach", "prospect"];
export const COACH_FEEDBACK_CATEGORIES = [
  "intent",
  "entity",
  "response",
  "evidence",
  "other",
];

function clampDays(value) {
  return Math.max(1, Math.min(Number(value) || 30, 365));
}

function ratio(numerator, denominator) {
  return denominator ? Number(numerator || 0) / Number(denominator) : 0;
}

function observedRate(numerator, denominator) {
  return denominator ? Number(numerator || 0) / Number(denominator) : null;
}

function parseJsonValue(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

const TRACE_ERROR_CODES = new Set([
  "permission_denied",
  "timeout",
  "tool_error",
  "query_error",
  "adapter_execution_failed",
  "structured_response_unavailable",
  "chat_preparation_failed",
]);

function normalizeTraceErrorCode(code, errorText = "") {
  const normalizedCode = String(code || "").trim();
  if (TRACE_ERROR_CODES.has(normalizedCode)) return normalizedCode;
  const normalizedError = String(errorText || "").toLowerCase();
  if (
    /permiso|permission|forbidden|no autorizado|politica del canal/.test(
      normalizedError,
    )
  ) {
    return "permission_denied";
  }
  if (/timeout|timed out|tiempo de espera/.test(normalizedError)) {
    return "timeout";
  }
  return normalizedCode || errorText ? "tool_error" : null;
}

function getToolResultCount(result) {
  if (result === null || result === undefined) return 0;
  if (Array.isArray(result)) return result.length;
  if (typeof result !== "object") return 1;
  for (const key of [
    "records",
    "results",
    "opportunities",
    "contacts",
    "interactions",
    "activities",
    "leads",
    "items",
    "sections",
  ]) {
    if (Array.isArray(result[key])) return result[key].length;
  }
  return 1;
}

function getToolTruncation(result, resultCount) {
  if (!result || typeof result !== "object") return null;
  for (const key of ["truncated", "isTruncated", "limitReached"]) {
    if (typeof result[key] === "boolean") return result[key];
  }
  if (typeof result.hasMore === "boolean") return result.hasMore;
  if (typeof result.pagination?.hasMore === "boolean") {
    return result.pagination.hasMore;
  }
  const totalCount = Number(result.totalCount ?? result.pagination?.totalCount);
  if (Number.isFinite(totalCount) && totalCount >= 0) {
    return totalCount > resultCount;
  }
  return null;
}

export function summarizeCoachToolResults(toolResults = []) {
  return (Array.isArray(toolResults) ? toolResults : [])
    .slice(0, 40)
    .map((tool) => {
      const result = tool?.result;
      const resultCount = getToolResultCount(result);
      const errorText = tool?.error || result?.error || "";
      return {
        toolName: String(tool?.toolName || "unknown").slice(0, 80),
        resultCount,
        errorCode: normalizeTraceErrorCode(
          tool?.errorCode || result?.errorCode,
          errorText,
        ),
        truncated: getToolTruncation(result, resultCount),
      };
    });
}

function sanitizeTraceDiagnostics(diagnostics = {}) {
  const routing = diagnostics.channelIntentRouting;
  const planner = diagnostics.planner || {};
  const evidence = diagnostics.evidence || {};
  const fallback = diagnostics.fallback || {};
  const agentMetrics = Array.isArray(diagnostics.agentMetrics)
    ? diagnostics.agentMetrics.slice(0, 20).map((agent) => ({
        agentId: String(agent?.agentId || "unknown").slice(0, 60),
        status: String(agent?.status || "unknown").slice(0, 30),
        evidenceCount: Math.max(0, Number(agent?.evidenceCount || 0)),
        errorCode: normalizeTraceErrorCode(agent?.errorCode),
      }))
    : [];
  const snapshotMetrics = Array.isArray(diagnostics.snapshotMetrics)
    ? diagnostics.snapshotMetrics.slice(0, 40).map((metric) => ({
        source: String(metric?.source || "unknown").slice(0, 60),
        resultCount: Math.max(0, Number(metric?.resultCount || 0)),
        resultLimit:
          Number.isInteger(metric?.resultLimit) && metric.resultLimit >= 0
            ? metric.resultLimit
            : null,
        truncated:
          typeof metric?.truncated === "boolean" ? metric.truncated : null,
        errorCode: normalizeTraceErrorCode(metric?.errorCode),
      }))
    : [];
  const allowedFailureStages = new Set([
    "request",
    "snapshot",
    "history",
    "agents",
    "adapter",
  ]);
  const allowedPlannerSources = new Set(["structured_plan", "not_applicable"]);
  const allowedPlannerReasons = new Set([
    "planner_unavailable",
    "invalid_plan",
    "planner_error",
  ]);
  const plannerEvaluation = planner.evaluation || {};
  const allowedPlannerModes = new Set(["active"]);
  const allowedEvidenceStatuses = new Set([
    "sufficient",
    "insufficient_evidence",
    "no_results",
    "clarification",
    "query_error",
    "query_limit_reached",
    "timeout",
    "verification_unavailable",
    "verification_error",
    "answer_generation_error",
  ]);
  const allowedEvidenceErrors = new Set([
    "turn_timeout",
    "evidence_verification_failed",
    "evidence_verifier_unavailable",
    "read_query_failed",
    "additional_read_failed",
    "read_query_limit_reached",
    "no_new_authorized_queries",
    "no_authorized_queries_executed",
    "answer_generation_unavailable",
  ]);
  const result = {
    planner: {
      source: allowedPlannerSources.has(planner.source)
        ? planner.source
        : "not_applicable",
      fallbackUsed: false,
      reasonCode: allowedPlannerReasons.has(planner.reasonCode)
        ? planner.reasonCode
        : null,
      queryCount: Math.max(0, Math.min(20, Number(planner.queryCount || 0))),
      evaluation: allowedPlannerModes.has(plannerEvaluation.mode)
        ? {
            mode: plannerEvaluation.mode,
            assigned: Boolean(plannerEvaluation.assigned),
            planAvailable: Boolean(plannerEvaluation.planAvailable),
            plannerIntents: Array.isArray(plannerEvaluation.plannerIntents)
              ? plannerEvaluation.plannerIntents
                  .slice(0, 8)
                  .map((item) => String(item).slice(0, 80))
              : [],
            plannerTools: Array.isArray(plannerEvaluation.plannerTools)
              ? plannerEvaluation.plannerTools
                  .slice(0, 40)
                  .map((item) => String(item).slice(0, 80))
              : [],
            plannerRequiresClarification: Boolean(
              plannerEvaluation.plannerRequiresClarification,
            ),
            plannerFilterCount: Math.max(
              0,
              Math.min(20, Number(plannerEvaluation.plannerFilterCount || 0)),
            ),
            plannerEntityReferenceCount: Math.max(
              0,
              Math.min(
                8,
                Number(plannerEvaluation.plannerEntityReferenceCount || 0),
              ),
            ),
            plannedToolCount: Math.max(
              0,
              Math.min(40, Number(plannerEvaluation.plannedToolCount || 0)),
            ),
            plannedToolsObserved: Math.max(
              0,
              Math.min(40, Number(plannerEvaluation.plannedToolsObserved || 0)),
            ),
            plannedToolsWithEvidence: Math.max(
              0,
              Math.min(
                40,
                Number(plannerEvaluation.plannedToolsWithEvidence || 0),
              ),
            ),
            genericFallback: Boolean(plannerEvaluation.genericFallback),
            retrievalError: Boolean(plannerEvaluation.retrievalError),
            truncatedSourceCount: Math.max(
              0,
              Math.min(40, Number(plannerEvaluation.truncatedSourceCount || 0)),
            ),
          }
        : null,
    },
    evidence: evidence.status
      ? {
          status: allowedEvidenceStatuses.has(evidence.status)
            ? evidence.status
            : "verification_error",
          rounds: Math.max(0, Math.min(2, Number(evidence.rounds || 0))),
          additionalReadQueries: Math.max(
            0,
            Math.min(8, Number(evidence.additionalReadQueries || 0)),
          ),
          unqueriedAuthorizedTools: Array.isArray(
            evidence.unqueriedAuthorizedTools,
          )
            ? evidence.unqueriedAuthorizedTools
                .slice(0, 20)
                .map((tool) => String(tool).slice(0, 80))
            : [],
          missingFactsCount: Math.max(
            0,
            Number(evidence.missingFactsCount || 0),
          ),
          errorCode: allowedEvidenceErrors.has(evidence.errorCode)
            ? evidence.errorCode
            : null,
          additionalToolMetrics: Array.isArray(evidence.additionalToolMetrics)
            ? evidence.additionalToolMetrics.slice(0, 8).map((metric) => ({
                toolName: String(metric?.toolName || "unknown").slice(0, 80),
                resultCount: Math.max(0, Number(metric?.resultCount || 0)),
                errorCode: normalizeTraceErrorCode(metric?.errorCode),
                truncated:
                  typeof metric?.truncated === "boolean"
                    ? metric.truncated
                    : null,
              }))
            : [],
        }
      : null,
    channelIntentRouting: routing
      ? {
          intent: String(routing.intent || "").slice(0, 80) || null,
          mode: String(routing.mode || "").slice(0, 30) || null,
          confidence: Number.isFinite(Number(routing.confidence))
            ? Math.max(0, Math.min(1, Number(routing.confidence)))
            : null,
          allowedTools: Array.isArray(routing.allowedTools)
            ? routing.allowedTools
                .slice(0, 40)
                .map((tool) => String(tool).slice(0, 80))
            : [],
          requiredContext: Array.isArray(routing.requiredContext)
            ? routing.requiredContext
                .slice(0, 20)
                .map((item) => String(item).slice(0, 40))
            : [],
          missingContext: Array.isArray(routing.missingContext)
            ? routing.missingContext
                .slice(0, 20)
                .map((item) => String(item).slice(0, 40))
            : [],
          requiresClarification: Boolean(routing.requiresClarification),
        }
      : null,
    fallback: {
      used: Boolean(fallback.used),
      reasonCode: normalizeTraceErrorCode(fallback.reasonCode),
    },
    failureStage: allowedFailureStages.has(diagnostics.failureStage)
      ? diagnostics.failureStage
      : null,
    agentMetrics,
    snapshotMetrics,
  };
  return result;
}

function mapQualityRow(row = {}) {
  const total = Number(row.total_turns || 0);
  const intentRated =
    Number(row.intent_positive || 0) + Number(row.intent_negative || 0);
  const entityRated =
    Number(row.entity_positive || 0) + Number(row.entity_negative || 0);
  const feedbackTotal = Number(row.feedback_total || 0);
  const proposed = Number(row.operations_proposed || 0);
  return {
    channel: row.channel || "unknown",
    process: row.process_key || "unknown",
    caseId: row.case_id || null,
    totalTurns: total,
    clarificationRate: ratio(row.clarifications, total),
    invalidResponseRate: ratio(
      Number(row.invalid_responses || 0) + Number(row.error_responses || 0),
      total,
    ),
    intentClassificationAccuracy: observedRate(
      row.intent_positive,
      intentRated,
    ),
    intentFeedbackCount: intentRated,
    intentPositive: Number(row.intent_positive || 0),
    intentNegative: Number(row.intent_negative || 0),
    entityResolutionQuality: observedRate(row.entity_positive, entityRated),
    entityFeedbackCount: entityRated,
    entityPositive: Number(row.entity_positive || 0),
    entityNegative: Number(row.entity_negative || 0),
    rejectedOperationRate: observedRate(row.rejected_operations, proposed),
    proposedOperations: proposed,
    rejectedOperations: Number(row.rejected_operations || 0),
    correctionByFeedbackRate: observedRate(
      row.corrected_feedback,
      feedbackTotal,
    ),
    feedbackCount: feedbackTotal,
    correctedFeedback: Number(row.corrected_feedback || 0),
    negativeFeedback: Number(row.negative_feedback || 0),
    averageLatencyMs: Math.round(Number(row.average_latency_ms || 0)),
  };
}

export async function recordCoachTurnQualityTrace({
  channel,
  process,
  userId,
  sessionId = null,
  jobId = null,
  trace = {},
}) {
  if (!COACH_CHANNELS.includes(channel) || !Number(userId)) return null;
  await ensureCoachSchema();
  const result = await query(
    `INSERT INTO coach_turn_quality_traces
      (channel, process_key, case_id, user_id, session_id, job_id, intent_type,
       intent_subtype, primary_entity, entity_resolution_json,
       applied_rules_json, validation_status, validation_reasons_json,
       response_type, confidence, evidence_count, tools_used_json,
       tool_metrics_json, diagnostics_json, operations_proposed,
       operations_rejected, latency_ms, error_code,
       created_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
    [
      channel,
      String(process || "default").slice(0, 80),
      String(trace.caseId || "").slice(0, 80) || null,
      Number(userId),
      Number(sessionId) || null,
      Number(jobId) || null,
      String(trace.intentType || "").slice(0, 80) || null,
      String(trace.intentSubtype || "").slice(0, 100) || null,
      String(trace.primaryEntity || "none").slice(0, 40),
      JSON.stringify(trace.entityResolution || {}),
      JSON.stringify(trace.appliedRules || {}),
      ["valid", "invalid", "clarification", "error"].includes(
        trace.validationStatus,
      )
        ? trace.validationStatus
        : "error",
      JSON.stringify(
        Array.isArray(trace.validationReasons) ? trace.validationReasons : [],
      ),
      String(trace.responseType || "").slice(0, 40) || null,
      String(trace.confidence || "").slice(0, 20) || null,
      Math.max(0, Number(trace.evidenceCount || 0)),
      JSON.stringify(Array.isArray(trace.toolsUsed) ? trace.toolsUsed : []),
      JSON.stringify(summarizeCoachToolResults(trace.toolMetrics)),
      JSON.stringify(sanitizeTraceDiagnostics(trace.diagnostics)),
      Math.max(0, Number(trace.operationsProposed || 0)),
      Math.max(0, Number(trace.operationsRejected || 0)),
      Math.max(0, Number(trace.latencyMs || 0)),
      String(trace.errorCode || "").slice(0, 100) || null,
    ],
  );
  return Number(result.insertId);
}

export async function submitCoachTurnFeedback({
  traceId,
  userId,
  rating,
  category = "response",
  corrected = false,
}) {
  await ensureCoachSchema();
  const rows = await query(
    `SELECT id FROM coach_turn_quality_traces
     WHERE id = ? AND user_id = ? LIMIT 1`,
    [Number(traceId), Number(userId)],
  );
  if (!rows.length) return { outcome: "not_found" };
  if (!COACH_FEEDBACK_CATEGORIES.includes(category)) {
    return { outcome: "invalid_category" };
  }
  if (!["positive", "negative"].includes(rating)) {
    return { outcome: "invalid_rating" };
  }
  const result = await query(
    `UPDATE coach_turn_quality_traces
     SET feedback_rating = ?, feedback_category = ?, feedback_corrected = ?,
         feedback_at = UTC_TIMESTAMP(3)
     WHERE id = ? AND user_id = ?`,
    [rating, category, Boolean(corrected), Number(traceId), Number(userId)],
  );
  return { outcome: result.affectedRows ? "saved" : "not_found" };
}

export async function listCoachQualityTraces({
  userId,
  channel,
  sessionId,
  limit = 50,
}) {
  if (!COACH_CHANNELS.includes(channel)) return [];
  await ensureCoachSchema();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
  const rows = await query(
    `SELECT id, channel, process_key, case_id, session_id, job_id, intent_type,
            intent_subtype, primary_entity, entity_resolution_json,
            applied_rules_json, validation_status, validation_reasons_json,
           response_type, confidence, evidence_count, tools_used_json,
           tool_metrics_json, diagnostics_json,
            operations_proposed, operations_rejected, latency_ms, error_code,
            feedback_rating, feedback_category, feedback_corrected,
            feedback_at, created_at_utc
     FROM coach_turn_quality_traces
     WHERE user_id = ? AND channel = ? AND session_id = ?
     ORDER BY created_at_utc DESC LIMIT ?`,
    [Number(userId), channel, Number(sessionId), safeLimit],
  );
  const parse = (value, fallback) => {
    if (!value) return fallback;
    if (typeof value === "object") return value;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  };
  return rows.map((row) => ({
    id: Number(row.id),
    channel: row.channel,
    process: row.process_key,
    caseId: row.case_id || null,
    sessionId: row.session_id === null ? null : Number(row.session_id),
    jobId: row.job_id === null ? null : Number(row.job_id),
    intent: { type: row.intent_type, subtype: row.intent_subtype },
    primaryEntity: row.primary_entity,
    entityResolution: parse(row.entity_resolution_json, {}),
    appliedRules: parse(row.applied_rules_json, {}),
    toolMetrics: parse(row.tool_metrics_json, []),
    diagnostics: parse(row.diagnostics_json, {}),
    validation: {
      status: row.validation_status,
      reasons: parse(row.validation_reasons_json, []),
    },
    responseType: row.response_type,
    confidence: row.confidence,
    evidenceCount: Number(row.evidence_count || 0),
    toolsUsed: parse(row.tools_used_json, []),
    operationsProposed: Number(row.operations_proposed || 0),
    operationsRejected: Number(row.operations_rejected || 0),
    latencyMs: Number(row.latency_ms || 0),
    errorCode: row.error_code,
    feedback: row.feedback_rating
      ? {
          rating: row.feedback_rating,
          category: row.feedback_category,
          corrected: Boolean(row.feedback_corrected),
          createdAt: row.feedback_at,
        }
      : null,
    createdAt: row.created_at_utc,
  }));
}

export async function getCoachQualityDashboard(periodDays = 30) {
  await ensureCoachSchema();
  const safePeriodDays = clampDays(periodDays);
  const [qualityRows, operationRows, plannerRows, aiCostRows] =
    await Promise.all([
      query(
        `SELECT channel, process_key, case_id,
              COUNT(*) AS total_turns,
              SUM(validation_status = 'clarification') AS clarifications,
              SUM(validation_status = 'invalid') AS invalid_responses,
              SUM(validation_status = 'error') AS error_responses,
              SUM(feedback_rating = 'positive' AND feedback_category = 'intent') AS intent_positive,
              SUM(feedback_rating = 'negative' AND feedback_category = 'intent') AS intent_negative,
              SUM(feedback_rating = 'positive' AND feedback_category = 'entity') AS entity_positive,
              SUM(feedback_rating = 'negative' AND feedback_category = 'entity') AS entity_negative,
              SUM(feedback_rating = 'negative') AS negative_feedback,
              SUM(feedback_rating IS NOT NULL) AS feedback_total,
              SUM(feedback_corrected = 1) AS corrected_feedback,
              SUM(operations_proposed) AS operations_proposed,
              SUM(operations_rejected) AS rejected_operations,
              AVG(latency_ms) AS average_latency_ms
       FROM coach_turn_quality_traces
       WHERE created_at_utc >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
      GROUP BY channel, process_key, case_id
      ORDER BY channel, process_key, case_id`,
        [safePeriodDays],
      ),
      query(
        `SELECT COALESCE(JSON_UNQUOTE(JSON_EXTRACT(o.original_operation, '$.sourceChannel')), 'coach') AS channel,
              COUNT(DISTINCT CASE WHEN e.event_type = 'proposed' THEN e.operation_id END) AS proposed,
              COUNT(DISTINCT CASE WHEN e.event_type = 'rejected' THEN e.operation_id END) AS rejected
       FROM coach_operation_events e
       INNER JOIN coach_session_operations o ON o.id = e.operation_id
       WHERE e.created_at_utc >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
       GROUP BY COALESCE(JSON_UNQUOTE(JSON_EXTRACT(o.original_operation, '$.sourceChannel')), 'coach')`,
        [safePeriodDays],
      ),
      Promise.resolve(
        query(
          `SELECT diagnostics_json, tool_metrics_json, response_type, latency_ms,
              feedback_rating, feedback_category, feedback_corrected, job_id
       FROM coach_turn_quality_traces
       WHERE channel = 'customer_account'
         AND created_at_utc >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)`,
          [safePeriodDays],
        ),
      )
        .then((rows) => rows || [])
        .catch(() => []),
      Promise.resolve(
        query(
          `SELECT job_id, SUM(cost_micros) AS total_cost_micros
       FROM ai_usage_ledger
       WHERE feature_code = 'commercial_intelligence.account_chat'
         AND job_type = 'account_chat'
         AND job_id IS NOT NULL
         AND created_at_utc >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
       GROUP BY job_id`,
          [safePeriodDays],
        ),
      )
        .then((rows) => rows || [])
        .catch(() => []),
    ]);
  const costByJob = new Map(
    aiCostRows.map((row) => [
      Number(row.job_id),
      Number(row.total_cost_micros || 0),
    ]),
  );
  const plannerMetricsByMode = new Map();
  for (const row of plannerRows) {
    const diagnostics = parseJsonValue(row.diagnostics_json);
    const planner = diagnostics.planner || {};
    const evaluation = planner.evaluation;
    if (
      !evaluation ||
      evaluation.mode !== "active" ||
      evaluation.assigned === false
    ) {
      continue;
    }
    const cohort = "assigned";
    const metricKey = "active:assigned";
    const current = plannerMetricsByMode.get(metricKey) || {
      mode: evaluation.mode,
      cohort,
      turns: 0,
      assignedTurns: 0,
      planAvailableTurns: 0,
      plannerFilterTotal: 0,
      plannerEntityReferenceTotal: 0,
      clarificationRequests: 0,
      visibleClarifications: 0,
      incorrectClarificationFeedback: 0,
      clarificationFeedback: 0,
      plannedTools: 0,
      observedPlannedTools: 0,
      plannedToolsWithEvidence: 0,
      genericFallbacks: 0,
      retrievalErrors: 0,
      truncatedTurns: 0,
      latencyTotalMs: 0,
      aiCostTotalMicros: 0,
      aiCostTurns: 0,
      feedbackCount: 0,
      correctedFeedback: 0,
    };
    current.turns += 1;
    current.assignedTurns += evaluation.assigned ? 1 : 0;
    current.planAvailableTurns += evaluation.planAvailable ? 1 : 0;
    current.plannerFilterTotal += Number(evaluation.plannerFilterCount || 0);
    current.plannerEntityReferenceTotal += Number(
      evaluation.plannerEntityReferenceCount || 0,
    );
    current.clarificationRequests += evaluation.plannerRequiresClarification
      ? 1
      : 0;
    current.visibleClarifications +=
      row.response_type === "clarification" ? 1 : 0;
    current.plannedTools += Number(evaluation.plannedToolCount || 0);
    current.observedPlannedTools += Number(
      evaluation.plannedToolsObserved || 0,
    );
    current.plannedToolsWithEvidence += Number(
      evaluation.plannedToolsWithEvidence || 0,
    );
    current.genericFallbacks += evaluation.genericFallback ? 1 : 0;
    current.retrievalErrors += evaluation.retrievalError ? 1 : 0;
    current.truncatedTurns +=
      Number(evaluation.truncatedSourceCount || 0) > 0 ? 1 : 0;
    current.latencyTotalMs += Number(row.latency_ms || 0);
    if (row.feedback_rating) {
      current.feedbackCount += 1;
      current.correctedFeedback += Number(row.feedback_corrected || 0);
      if (
        row.response_type === "clarification" &&
        row.feedback_category === "intent"
      ) {
        current.clarificationFeedback += 1;
        current.incorrectClarificationFeedback +=
          row.feedback_rating === "negative" ? 1 : 0;
      }
    }
    const jobCost = costByJob.get(Number(row.job_id));
    if (jobCost !== undefined) {
      current.aiCostTotalMicros += jobCost;
      current.aiCostTurns += 1;
    }
    plannerMetricsByMode.set(metricKey, current);
  }
  const plannerMetrics = [...plannerMetricsByMode.values()].map((item) => ({
    mode: item.mode,
    cohort: item.cohort,
    turns: item.turns,
    assignedTurns: item.assignedTurns,
    planAvailableTurns: item.planAvailableTurns,
    averagePlannerFilterCount: item.planAvailableTurns
      ? Number((item.plannerFilterTotal / item.planAvailableTurns).toFixed(2))
      : null,
    averagePlannerEntityReferenceCount: item.planAvailableTurns
      ? Number(
          (item.plannerEntityReferenceTotal / item.planAvailableTurns).toFixed(
            2,
          ),
        )
      : null,
    plannerClarificationRate: ratio(
      item.clarificationRequests,
      item.planAvailableTurns,
    ),
    visibleClarificationRate: ratio(item.visibleClarifications, item.turns),
    incorrectClarificationRate: observedRate(
      item.incorrectClarificationFeedback,
      item.clarificationFeedback,
    ),
    incorrectClarificationFeedbackCount: item.incorrectClarificationFeedback,
    clarificationFeedbackCount: item.clarificationFeedback,
    plannedToolObservationRate: observedRate(
      item.observedPlannedTools,
      item.plannedTools,
    ),
    plannedToolEvidenceRate: observedRate(
      item.plannedToolsWithEvidence,
      item.plannedTools,
    ),
    genericFallbackRate: ratio(item.genericFallbacks, item.turns),
    retrievalErrorRate: ratio(item.retrievalErrors, item.turns),
    truncationRate: ratio(item.truncatedTurns, item.turns),
    averageLatencyMs: Math.round(ratio(item.latencyTotalMs, item.turns)),
    averageCostMicros: item.aiCostTurns
      ? Math.round(item.aiCostTotalMicros / item.aiCostTurns)
      : null,
    aiCostTurns: item.aiCostTurns,
    feedbackCount: item.feedbackCount,
    correctionByFeedbackRate: observedRate(
      item.correctedFeedback,
      item.feedbackCount,
    ),
  }));
  const byChannel = new Map();
  for (const row of qualityRows) {
    const mapped = mapQualityRow(row);
    const current = byChannel.get(mapped.channel) || {
      channel: mapped.channel,
      totalTurns: 0,
      clarifications: 0,
      invalidResponses: 0,
      errorResponses: 0,
      intentPositive: 0,
      intentNegative: 0,
      entityPositive: 0,
      entityNegative: 0,
      negativeFeedback: 0,
      correctedFeedback: 0,
      feedbackTotal: 0,
      proposedOperations: 0,
      rejectedOperations: 0,
      latencyWeightedTotal: 0,
      processes: [],
    };
    current.totalTurns += mapped.totalTurns;
    current.clarifications += Math.round(
      mapped.clarificationRate * mapped.totalTurns,
    );
    current.invalidResponses += Math.round(
      mapped.invalidResponseRate * mapped.totalTurns,
    );
    current.intentPositive += mapped.intentPositive;
    current.intentNegative += mapped.intentNegative;
    current.entityPositive += mapped.entityPositive;
    current.entityNegative += mapped.entityNegative;
    current.negativeFeedback += mapped.negativeFeedback;
    current.feedbackTotal += mapped.feedbackCount;
    current.correctedFeedback += mapped.correctedFeedback;
    current.proposedOperations += mapped.proposedOperations;
    current.rejectedOperations += mapped.rejectedOperations;
    current.latencyWeightedTotal += mapped.averageLatencyMs * mapped.totalTurns;
    current.processes.push(mapped);
    byChannel.set(mapped.channel, current);
  }
  const channelOperationCounts = new Map(
    operationRows.map((row) => [row.channel, row]),
  );
  const channels = [...byChannel.values()].map((item) => {
    const operationCounts = channelOperationCounts.get(item.channel);
    const proposed = Number(
      operationCounts?.proposed || item.proposedOperations,
    );
    const rejected = Number(
      operationCounts?.rejected || item.rejectedOperations,
    );
    return {
      channel: item.channel,
      totalTurns: item.totalTurns,
      clarificationRate: ratio(item.clarifications, item.totalTurns),
      invalidResponseRate: ratio(item.invalidResponses, item.totalTurns),
      intentClassificationAccuracy: observedRate(
        item.intentPositive,
        item.intentPositive + item.intentNegative,
      ),
      intentFeedbackCount: item.intentPositive + item.intentNegative,
      entityResolutionQuality: observedRate(
        item.entityPositive,
        item.entityPositive + item.entityNegative,
      ),
      entityFeedbackCount: item.entityPositive + item.entityNegative,
      rejectedOperationRate: observedRate(rejected, proposed),
      proposedOperations: proposed,
      rejectedOperations: rejected,
      correctionByFeedbackRate: observedRate(
        item.correctedFeedback,
        item.feedbackTotal,
      ),
      feedbackCount: item.feedbackTotal,
      negativeFeedback: item.negativeFeedback,
      averageLatencyMs: Math.round(
        ratio(item.latencyWeightedTotal, item.totalTurns),
      ),
      processes: item.processes,
    };
  });
  const totalTurns = channels.reduce((sum, item) => sum + item.totalTurns, 0);
  return {
    periodDays: safePeriodDays,
    totalTurns,
    channels,
    plannerMetrics,
    processes: channels.flatMap((channel) =>
      channel.processes.map((process) => ({
        ...process,
        channel: channel.channel,
      })),
    ),
    regressions: channels
      .flatMap((channel) =>
        channel.processes.map((process) => ({
          ...process,
          channel: channel.channel,
        })),
      )
      .filter(
        (process) =>
          process.invalidResponseRate > 0 ||
          process.negativeFeedback > 0 ||
          process.rejectedOperations > 0,
      )
      .sort(
        (left, right) =>
          right.invalidResponseRate +
          right.negativeFeedback -
          (left.invalidResponseRate + left.negativeFeedback),
      ),
  };
}

export async function listCoachChannelRollouts() {
  await ensureCoachSchema();
  const rows = await query(
    `SELECT channel, enabled, rollout_percentage, allowlist_json, updated_at,
            updated_by_user_id
     FROM coach_channel_rollouts
     WHERE channel IN ('coach', 'prospect') ORDER BY channel`,
  );
  return rows.map((row) => ({
    channel: row.channel,
    enabled: Boolean(row.enabled),
    rolloutPercentage: Number(row.rollout_percentage || 0),
    allowlist: Array.isArray(row.allowlist_json)
      ? row.allowlist_json.map(Number).filter(Boolean)
      : typeof row.allowlist_json === "string"
        ? JSON.parse(row.allowlist_json || "[]")
            .map(Number)
            .filter(Boolean)
        : [],
    updatedAt: row.updated_at,
    updatedByUserId: Number(row.updated_by_user_id || 0) || null,
  }));
}

export async function saveCoachChannelRollouts({ user, rollouts = [] }) {
  if (!Array.isArray(rollouts))
    throw new Error("Configuracion de rollout invalida");
  await ensureCoachSchema();
  const existingRollouts = await listCoachChannelRollouts();
  const results = [];
  for (const rollout of rollouts) {
    if (!COACH_ROLLOUT_CHANNELS.includes(rollout.channel)) {
      throw new Error("Canal de rollout no soportado");
    }
    const percentage = Math.max(
      0,
      Math.min(100, Math.round(Number(rollout.rolloutPercentage) || 0)),
    );
    const existing = existingRollouts.find(
      (item) => item.channel === rollout.channel,
    );
    const allowlist = [
      ...new Set(
        (Array.isArray(rollout.allowlist) ? rollout.allowlist : [])
          .map(Number)
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    ].slice(0, 500);
    const expanding =
      Boolean(rollout.enabled) &&
      (!existing?.enabled ||
        percentage > Number(existing.rolloutPercentage || 0));
    if (expanding) {
      const qualityRows = await query(
        `SELECT COUNT(*) AS total_turns,
                SUM(validation_status IN ('invalid', 'error')) AS invalid_turns,
                SUM(feedback_rating IS NOT NULL) AS feedback_turns,
                SUM(feedback_rating = 'negative') AS negative_feedback,
                SUM(feedback_corrected = 1) AS corrected_feedback,
                SUM(operations_proposed) AS proposed_operations,
                SUM(operations_rejected) AS rejected_operations
         FROM coach_turn_quality_traces
         WHERE channel = ?
           AND created_at_utc >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)`,
        [rollout.channel],
      );
      const quality = qualityRows[0] || {};
      const totalTurns = Number(quality.total_turns || 0);
      const feedbackTurns = Number(quality.feedback_turns || 0);
      const invalidRate = ratio(quality.invalid_turns, totalTurns);
      const negativeRate = ratio(quality.negative_feedback, feedbackTurns);
      const correctionRate = ratio(quality.corrected_feedback, totalTurns);
      const operationRate = ratio(
        quality.rejected_operations,
        quality.proposed_operations,
      );
      const sufficientSample = totalTurns >= 20 && feedbackTurns >= 5;
      const qualityAllowsExpansion =
        sufficientSample &&
        invalidRate <= 0.05 &&
        negativeRate <= 0.15 &&
        correctionRate <= 0.1 &&
        operationRate <= 0.2;
      if (!qualityAllowsExpansion) {
        const error = new Error(
          sufficientSample
            ? "La calidad observada no permite ampliar el rollout de este canal"
            : "Se requieren al menos 20 turnos y 5 feedbacks para ampliar el rollout",
        );
        error.status = 409;
        error.code = sufficientSample
          ? "ROLLOUT_QUALITY_GATE_BLOCKED"
          : "ROLLOUT_QUALITY_GATE_INSUFFICIENT_SAMPLE";
        error.quality = {
          totalTurns,
          feedbackTurns,
          invalidRate,
          negativeRate,
          correctionRate,
          operationRate,
        };
        throw error;
      }
    }
    await query(
      `INSERT INTO coach_channel_rollouts
        (channel, enabled, rollout_percentage, allowlist_json, updated_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NOW(3), NOW(3))
       ON DUPLICATE KEY UPDATE enabled = VALUES(enabled),
         rollout_percentage = VALUES(rollout_percentage),
         allowlist_json = VALUES(allowlist_json),
         updated_by_user_id = VALUES(updated_by_user_id), updated_at = NOW(3)`,
      [
        rollout.channel,
        Boolean(rollout.enabled),
        percentage,
        JSON.stringify(allowlist),
        Number(user.id),
      ],
    );
    results.push({
      channel: rollout.channel,
      enabled: Boolean(rollout.enabled),
      rolloutPercentage: percentage,
      allowlist,
    });
  }
  return results;
}

export async function isCoachChannelInRollout({ channel, userId }) {
  const rollouts = await listCoachChannelRollouts();
  const rollout = rollouts.find((item) => item.channel === channel);
  if (!rollout) return true;
  return isCoachUserInRollout(rollout, userId);
}

export function isCoachUserInRollout(rollout, userId) {
  if (!rollout) return true;
  if (!rollout.enabled) return false;
  if (rollout.allowlist.includes(Number(userId))) return true;
  if (rollout.rolloutPercentage >= 100) return true;
  if (rollout.rolloutPercentage <= 0) return false;
  const bucket =
    Number.parseInt(
      createHash("sha256")
        .update(`${rollout.channel}:${Number(userId)}`)
        .digest("hex")
        .slice(0, 8),
      16,
    ) % 100;
  return bucket < rollout.rolloutPercentage;
}
