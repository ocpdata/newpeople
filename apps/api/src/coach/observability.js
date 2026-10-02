import { createHash } from "node:crypto";
import { query } from "../db.js";
import { ensureCoachSchema } from "./schema.js";

export const COACH_CHANNELS = ["coach", "customer_account", "prospect"];
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
    intentClassificationAccuracy: observedRate(row.intent_positive, intentRated),
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
    correctionByFeedbackRate: observedRate(row.corrected_feedback, feedbackTotal),
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
       operations_proposed, operations_rejected, latency_ms, error_code,
       created_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
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
      JSON.stringify(Array.isArray(trace.validationReasons) ? trace.validationReasons : []),
      String(trace.responseType || "").slice(0, 40) || null,
      String(trace.confidence || "").slice(0, 20) || null,
      Math.max(0, Number(trace.evidenceCount || 0)),
      JSON.stringify(Array.isArray(trace.toolsUsed) ? trace.toolsUsed : []),
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
  const [qualityRows, operationRows] = await Promise.all([
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
  ]);
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
    current.clarifications += Math.round(mapped.clarificationRate * mapped.totalTurns);
    current.invalidResponses += Math.round(mapped.invalidResponseRate * mapped.totalTurns);
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
    const proposed = Number(operationCounts?.proposed || item.proposedOperations);
    const rejected = Number(operationCounts?.rejected || item.rejectedOperations);
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
      averageLatencyMs: Math.round(ratio(item.latencyWeightedTotal, item.totalTurns)),
      processes: item.processes,
    };
  });
  const totalTurns = channels.reduce((sum, item) => sum + item.totalTurns, 0);
  return {
    periodDays: safePeriodDays,
    totalTurns,
    channels,
    processes: channels.flatMap((channel) =>
      channel.processes.map((process) => ({ ...process, channel: channel.channel })),
    ),
    regressions: channels
      .flatMap((channel) => channel.processes.map((process) => ({ ...process, channel: channel.channel })))
      .filter(
        (process) =>
          process.invalidResponseRate > 0 ||
          process.negativeFeedback > 0 ||
          process.rejectedOperations > 0,
      )
      .sort(
        (left, right) =>
          right.invalidResponseRate + right.negativeFeedback -
          (left.invalidResponseRate + left.negativeFeedback),
      ),
  };
}

export async function listCoachChannelRollouts() {
  await ensureCoachSchema();
  const rows = await query(
    `SELECT channel, enabled, rollout_percentage, allowlist_json, updated_at,
            updated_by_user_id
     FROM coach_channel_rollouts ORDER BY channel`,
  );
  return rows.map((row) => ({
    channel: row.channel,
    enabled: Boolean(row.enabled),
    rolloutPercentage: Number(row.rollout_percentage || 0),
    allowlist: Array.isArray(row.allowlist_json)
      ? row.allowlist_json.map(Number).filter(Boolean)
      : typeof row.allowlist_json === "string"
        ? JSON.parse(row.allowlist_json || "[]").map(Number).filter(Boolean)
        : [],
    updatedAt: row.updated_at,
    updatedByUserId: Number(row.updated_by_user_id || 0) || null,
  }));
}

export async function saveCoachChannelRollouts({ user, rollouts = [] }) {
  if (!Array.isArray(rollouts)) throw new Error("Configuracion de rollout invalida");
  await ensureCoachSchema();
  const existingRollouts = await listCoachChannelRollouts();
  const results = [];
  for (const rollout of rollouts) {
    if (!COACH_CHANNELS.includes(rollout.channel)) {
      throw new Error("Canal de rollout no soportado");
    }
    const percentage = Math.max(
      0,
      Math.min(100, Math.round(Number(rollout.rolloutPercentage) || 0)),
    );
    const allowlist = [...new Set(
      (Array.isArray(rollout.allowlist) ? rollout.allowlist : [])
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0),
    )].slice(0, 500);
    const existing = existingRollouts.find(
      (item) => item.channel === rollout.channel,
    );
    const expanding =
      Boolean(rollout.enabled) &&
      (!existing?.enabled || percentage > Number(existing.rolloutPercentage || 0));
    const allowlistedPilot =
      expanding &&
      percentage > 0 &&
      percentage <= 5 &&
      allowlist.length > 0 &&
      Number(existing?.rolloutPercentage || 0) === 0;
    if (expanding && !allowlistedPilot) {
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
            : "Se requieren al menos 20 turnos y 5 feedbacks para ampliar el rollout; inicia primero una canaria con allowlist",
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
      [rollout.channel, Boolean(rollout.enabled), percentage, JSON.stringify(allowlist), Number(user.id)],
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
  const bucket = Number.parseInt(
    createHash("sha256")
      .update(`${rollout.channel}:${Number(userId)}`)
      .digest("hex")
      .slice(0, 8),
    16,
  ) % 100;
  return bucket < rollout.rolloutPercentage;
}