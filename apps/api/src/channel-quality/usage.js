import { query } from "../db.js";

// Read-only usage and outcome report for the three chat channels. Cliente existente is read only as a reference.
const RATING_POSITIVE = "positive";
const RATING_NEGATIVE = "negative";

export function percentile(sortedValues, ratio) {
  if (!sortedValues.length) return null;
  return sortedValues[Math.min(sortedValues.length - 1, Math.floor(sortedValues.length * ratio))];
}

export function summarize(values) {
  const sorted = values.filter((value) => value !== null && value !== undefined && value !== "")
    .map(Number).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, p50: null, p95: null, max: null };
  return { count: sorted.length, p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), max: sorted[sorted.length - 1] };
}

// Both values are validated (integer / date pattern), so they are safe to inline.
function windowStart({ days, since }) {
  return since ? `'${since} 00:00:00'` : `DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${Number(days)} DAY)`;
}

const pct = (part, total) => (total ? Number(((part / total) * 100).toFixed(1)) : 0);

async function traceMetrics(window, run) {
  const since = windowStart(window);
  const rows = await run(
    `SELECT channel, user_id, validation_status, feedback_rating, latency_ms, created_at_utc
     FROM coach_turn_quality_traces
     WHERE created_at_utc >= ${since} AND channel IN ('coach', 'customer_account', 'prospect')
     ORDER BY id DESC LIMIT 20000`,
  );
  const byChannel = {};
  for (const row of rows) {
    const entry = byChannel[row.channel] ||= { turns: 0, users: new Set(), errors: 0, clarifications: 0, positive: 0, negative: 0, latencies: [] };
    entry.turns += 1;
    entry.users.add(row.user_id);
    if (row.validation_status === "error") entry.errors += 1;
    if (row.validation_status === "clarification") entry.clarifications += 1;
    if (row.feedback_rating === RATING_POSITIVE) entry.positive += 1;
    if (row.feedback_rating === RATING_NEGATIVE) entry.negative += 1;
    if (row.latency_ms != null) entry.latencies.push(Number(row.latency_ms) / 1000);
  }
  return Object.fromEntries(Object.entries(byChannel).map(([channel, entry]) => [channel, {
    turns: entry.turns,
    users: entry.users.size,
    errors: entry.errors,
    errorRatePct: pct(entry.errors, entry.turns),
    clarificationRatePct: pct(entry.clarifications, entry.turns),
    rated: entry.positive + entry.negative,
    positive: entry.positive,
    negative: entry.negative,
    latencySeconds: summarize(entry.latencies),
  }]));
}

const sessionStats = (row = {}) => ({
  sessions: Number(row.sessions || 0), users: Number(row.users || 0), withMessages: Number(row.with_messages || 0),
  avgMessages: Number(row.avg_messages || 0), maxMessages: Number(row.max_messages || 0),
});

async function coachSessionMetrics(window, run) {
  const since = windowStart(window);
  const [row] = await run(
    `SELECT COUNT(*) AS sessions, COUNT(DISTINCT user_id) AS users,
            SUM(JSON_LENGTH(messages) > 0) AS with_messages,
            ROUND(AVG(JSON_LENGTH(messages)), 1) AS avg_messages, MAX(JSON_LENGTH(messages)) AS max_messages
     FROM coach_conversation_sessions WHERE created_at >= ${since}`,
  );
  return sessionStats(row);
}

async function customerSessionMetrics(window, run) {
  const since = windowStart(window);
  const [row] = await run(
    `SELECT COUNT(*) AS sessions, COUNT(DISTINCT requested_by_user_id) AS users,
            SUM(JSON_LENGTH(history_json) > 0) AS with_messages,
            ROUND(AVG(JSON_LENGTH(history_json)), 1) AS avg_messages, MAX(JSON_LENGTH(history_json)) AS max_messages
     FROM customer_intelligence_chat_sessions WHERE created_at >= ${since}`,
  );
  return sessionStats(row);
}

async function customerFeedbackMetrics(window, run) {
  const since = windowStart(window);
  const rows = await run(
    `SELECT rating, COUNT(*) AS total FROM customer_chat_turn_feedback WHERE created_at >= ${since} GROUP BY rating`,
  );
  const count = (rating) => Number(rows.find((row) => row.rating === rating)?.total || 0);
  return { positive: count(RATING_POSITIVE), negative: count(RATING_NEGATIVE) };
}

async function prospectMetrics(window, run) {
  const since = windowStart(window);
  const [sessions] = await run(
    `SELECT COUNT(*) AS sessions, COUNT(DISTINCT requested_by_user_id) AS users,
            SUM(JSON_LENGTH(COALESCE(chat_history_json, JSON_ARRAY())) > 0) AS with_messages,
            ROUND(AVG(JSON_LENGTH(COALESCE(chat_history_json, JSON_ARRAY()))), 1) AS avg_messages,
            MAX(JSON_LENGTH(COALESCE(chat_history_json, JSON_ARRAY()))) AS max_messages
     FROM prospect_research_sessions WHERE created_at >= ${since}`,
  );
  const jobs = await run(
    `SELECT status, TIMESTAMPDIFF(MICROSECOND, created_at, finished_at) / 1000000 AS seconds
     FROM prospect_research_chat_jobs WHERE created_at >= ${since} ORDER BY id DESC LIMIT 20000`,
  );
  const failed = jobs.filter((job) => job.status === "failed").length;
  return {
    ...sessionStats(sessions),
    turns: jobs.length, errors: failed, errorRatePct: pct(failed, jobs.length),
    latencySeconds: summarize(jobs.filter((job) => job.status === "completed").map((job) => job.seconds)),
  };
}

const EMPTY_TRACES = {
  turns: 0, errors: 0, errorRatePct: 0, clarificationRatePct: 0, rated: 0, positive: 0, negative: 0, latencySeconds: summarize([]),
};

export async function loadChannelUsage({ days = 30, since = null } = {}, { run = query } = {}) {
  const window = { days, since };
  const [traces, coachSessions, customerSessions, customerFeedback, prospect] = await Promise.all([
    traceMetrics(window, run), coachSessionMetrics(window, run), customerSessionMetrics(window, run),
    customerFeedbackMetrics(window, run), prospectMetrics(window, run),
  ]);
  const { users: coachTraceUsers = 0, ...coachTraces } = traces.coach || {};
  const { users: customerTraceUsers = 0, ...customerTraces } = traces.customer_account || {};
  const { positive = 0, negative = 0, rated = 0 } = traces.prospect || {};
  const prospectRatings = { positive, negative, rated };
  return {
    generatedAt: new Date().toISOString(), days, since,
    channels: {
      coach: { ...EMPTY_TRACES, ...coachSessions, ...coachTraces, users: Math.max(coachSessions.users, coachTraceUsers) },
      customer_account: {
        ...EMPTY_TRACES, ...customerSessions, ...customerTraces, users: Math.max(customerSessions.users, customerTraceUsers), referenceOnly: true,
        ...customerFeedback, rated: customerFeedback.positive + customerFeedback.negative,
      },
      prospect: { ...EMPTY_TRACES, ...prospect, ...prospectRatings },
    },
  };
}

const CHANNEL_LABELS = { coach: "Coach", customer_account: "Cliente existente (referencia)", prospect: "Cuenta nueva" };

export function formatChannelUsage(report) {
  const lines = [`Uso de los chats · ${report.since ? `desde ${report.since}` : `últimos ${report.days} días`} · generado ${report.generatedAt}`, ""];
  for (const [channel, data] of Object.entries(report.channels)) {
    const latency = data.latencySeconds;
    lines.push(CHANNEL_LABELS[channel] || channel);
    lines.push(`  Sesiones: ${data.sessions} (con mensajes: ${data.withMessages}; usuarios: ${data.users}; mensajes promedio ${data.avgMessages}, máximo ${data.maxMessages})`);
    lines.push(`  Turnos: ${data.turns} · errores ${data.errors} (${data.errorRatePct}%)${channel === "prospect" ? "" : ` · aclaraciones ${data.clarificationRatePct}%`}`);
    lines.push(`  Latencia (s): p50=${latency.p50 ?? "-"} p95=${latency.p95 ?? "-"} máx=${latency.max ?? "-"}`);
    lines.push(`  Valoraciones: ${data.rated} (👍 ${data.positive} · 👎 ${data.negative})`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
