import { query } from "../db.js";
import { ensureCoachSchema } from "./schema.js";

export async function getCoachMetrics(userId, periodDays = 30) {
  await ensureCoachSchema();
  const safePeriodDays = Math.max(1, Math.min(Number(periodDays) || 30, 365));
  const [usageRows, eventRows, pendingRows] = await Promise.all([
    query(
      `SELECT COUNT(*) AS requests, COALESCE(SUM(total_tokens), 0) AS tokens,
              COALESCE(SUM(cost_micros), 0) AS costMicros
       FROM ai_usage_ledger
       WHERE user_id = ? AND feature_code = 'mi_coach.chat'
         AND created_at_utc >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)`,
      [Number(userId), safePeriodDays],
    ),
    query(
      `SELECT
         COUNT(DISTINCT CASE WHEN event_type = 'proposed' THEN operation_id END) AS proposed,
         COUNT(DISTINCT CASE WHEN event_type = 'approved' THEN operation_id END) AS approved,
         COUNT(DISTINCT CASE WHEN event_type = 'rejected' THEN operation_id END) AS rejected,
         COUNT(DISTINCT CASE WHEN event_type = 'completed' THEN operation_id END) AS completed,
         COUNT(DISTINCT CASE WHEN event_type = 'execution_failed' THEN operation_id END) AS failed,
         COUNT(DISTINCT CASE WHEN event_type = 'reverted' THEN operation_id END) AS reverted,
         COUNT(DISTINCT CASE WHEN event_type = 'cancelled' THEN operation_id END) AS cancelled,
         COUNT(DISTINCT CASE WHEN event_type = 'superseded' THEN operation_id END) AS superseded
       FROM coach_operation_events
       WHERE user_id = ?
         AND created_at_utc >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)`,
      [Number(userId), safePeriodDays],
    ),
    query(
      `SELECT COUNT(*) AS pending
       FROM coach_session_operations
       WHERE user_id = ?
         AND status IN ('proposed', 'collecting', 'ready', 'handed_off', 'executing', 'failed')
         AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)`,
      [Number(userId), safePeriodDays],
    ),
  ]);
  const usage = usageRows[0] || {};
  const events = eventRows[0] || {};
  const proposed = Number(events.proposed || 0);
  const approved = Number(events.approved || 0);
  const rejected = Number(events.rejected || 0);
  const completed = Number(events.completed || 0);
  return {
    periodDays: safePeriodDays,
    requests: Number(usage.requests || 0),
    tokens: Number(usage.tokens || 0),
    costMicros: Number(usage.costMicros || 0),
    proposed,
    approved,
    rejected,
    completed,
    failed: Number(events.failed || 0),
    reverted: Number(events.reverted || 0),
    cancelled: Number(events.cancelled || 0),
    superseded: Number(events.superseded || 0),
    pending: Number(pendingRows[0]?.pending || 0),
    decided: approved + rejected,
    approvalRate: approved + rejected ? approved / (approved + rejected) : 0,
    completionRate: approved ? completed / approved : 0,
    operationsCreated: approved,
    operationsCompleted: completed,
    operationsUndone: Number(events.reverted || 0),
    operationsRejected: rejected,
    operationsDecided: approved + rejected,
  };
}
