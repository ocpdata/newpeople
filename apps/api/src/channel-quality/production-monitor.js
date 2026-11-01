import { query } from "../db.js";
import { ensureChannelQualitySchema, purgeOldChannelQualityRuns, recordChannelQualityRun } from "./store.js";
import { QUALITY_CHANNELS } from "./gates.js";

export const MONITOR_WINDOW_DAYS = 7;
const MONITOR_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MIN_HOURS_BETWEEN_SNAPSHOTS = 20;
const FLAGGED_SAMPLE_LIMIT = 20;
const CONTROL_SAMPLE_LIMIT = 5;

export function percentile(values, ratio) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

function buildSummary({ turns, flaggedFor, latencies, positive, negative, extraMetrics = {} }) {
  const flagged = [];
  const control = [];
  for (const turn of turns) {
    const flags = flaggedFor(turn);
    (flags.length ? flagged : control).push({ id: Number(turn.id), flags });
  }
  const failed = turns.filter((turn) => turn.failed).length;
  return {
    groups: {
      reliability: { passed: turns.length - failed, total: turns.length },
      satisfaction: { passed: positive, total: positive + negative },
    },
    metrics: {
      windowDays: MONITOR_WINDOW_DAYS,
      turns: turns.length,
      failedTurns: failed,
      ratedTurns: positive + negative,
      negativeRatings: negative,
      latencyP50Seconds: percentile(latencies, 0.5),
      latencyP95Seconds: percentile(latencies, 0.95),
      ...extraMetrics,
    },
    sample: [
      ...flagged.sort((a, b) => b.flags.length - a.flags.length || b.id - a.id).slice(0, FLAGGED_SAMPLE_LIMIT),
      ...control.sort((a, b) => b.id - a.id).slice(0, CONTROL_SAMPLE_LIMIT),
    ],
  };
}

// Coach: each persisted quality trace is one turn.
export function summarizeCoachWindow(traces) {
  const turns = traces.map((trace) => ({
    id: trace.id,
    failed: trace.validation_status === "error" || Boolean(trace.error_code),
    rejected: Number(trace.operations_rejected) > 0,
    negative: trace.feedback_rating === "negative",
  }));
  return buildSummary({
    turns,
    flaggedFor: (turn) => [
      ...(turn.failed ? ["trace_error"] : []),
      ...(turn.rejected ? ["operation_rejected"] : []),
      ...(turn.negative ? ["negative_feedback"] : []),
    ],
    latencies: traces.map((trace) => (trace.latency_ms == null ? NaN : Number(trace.latency_ms) / 1000)),
    positive: traces.filter((trace) => trace.feedback_rating === "positive").length,
    negative: traces.filter((trace) => trace.feedback_rating === "negative").length,
  });
}

// Cuenta nueva: each finished chat job is one turn; ratings and rejected operations come from its quality traces.
export function summarizeProspectWindow({ jobs, traces }) {
  const finished = jobs.filter((job) => job.status === "completed" || job.status === "failed");
  const traceByJob = new Map(traces.map((trace) => [Number(trace.job_id), trace]));
  const turns = finished.map((job) => {
    const trace = traceByJob.get(Number(job.id));
    return {
      id: job.id,
      failed: job.status === "failed" || trace?.validation_status === "error",
      rejected: Number(trace?.operations_rejected) > 0,
      negative: trace?.feedback_rating === "negative",
    };
  });
  return buildSummary({
    turns,
    flaggedFor: (turn) => [
      ...(turn.failed ? ["job_failed"] : []),
      ...(turn.rejected ? ["operation_rejected"] : []),
      ...(turn.negative ? ["negative_feedback"] : []),
    ],
    latencies: finished.filter((job) => job.status === "completed").map((job) => Number(job.seconds)),
    positive: traces.filter((trace) => trace.feedback_rating === "positive").length,
    negative: traces.filter((trace) => trace.feedback_rating === "negative").length,
  });
}

export async function loadChannelWindow(channel, days = MONITOR_WINDOW_DAYS, { run = query } = {}) {
  if (channel === "coach") {
    return run(
      `SELECT id, validation_status, error_code, operations_rejected, feedback_rating, latency_ms
       FROM coach_turn_quality_traces
       WHERE channel = 'coach' AND created_at_utc >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
       ORDER BY id DESC LIMIT 20000`,
      [Number(days)],
    );
  }
  const jobs = await run(
    `SELECT id, status, TIMESTAMPDIFF(MICROSECOND, created_at, finished_at) / 1000000 AS seconds
     FROM prospect_research_chat_jobs WHERE created_at >= DATE_SUB(NOW(3), INTERVAL ? DAY)
     ORDER BY id DESC LIMIT 20000`,
    [Number(days)],
  );
  const traces = await run(
    `SELECT job_id, validation_status, operations_rejected, feedback_rating
     FROM coach_turn_quality_traces
     WHERE channel = 'prospect' AND created_at_utc >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
     ORDER BY id DESC LIMIT 20000`,
    [Number(days)],
  );
  return { jobs, traces };
}

export function summarizeChannelWindow(channel, window) {
  if (channel === "coach") return summarizeCoachWindow(window);
  if (channel === "prospect") return summarizeProspectWindow(window);
  throw new Error(`Canal de calidad desconocido: ${channel}`);
}

export async function runChannelProductionMonitor({ channel, force = false, trigger = "scheduled" }) {
  if (!QUALITY_CHANNELS.includes(channel)) throw new Error(`Canal de calidad desconocido: ${channel}`);
  await ensureChannelQualitySchema();
  if (!force) {
    const [last] = await query(
      `SELECT evaluated_at FROM chat_channel_quality_runs
       WHERE channel = ? AND source = 'production_monitor' ORDER BY evaluated_at DESC LIMIT 1`,
      [channel],
    );
    if (last && Date.now() - new Date(last.evaluated_at).getTime() < MIN_HOURS_BETWEEN_SNAPSHOTS * 3600000) return null;
  }
  const summary = summarizeChannelWindow(channel, await loadChannelWindow(channel));
  return recordChannelQualityRun({
    channel,
    source: "production_monitor",
    report: { groups: summary.groups },
    metrics: summary.metrics,
    trigger,
    details: summary.sample,
  });
}

let started = false;
export function startChannelQualityMonitorWorker() {
  if (started || process.env.NODE_ENV === "test") return;
  started = true;
  const tick = async () => {
    try {
      for (const channel of QUALITY_CHANNELS) {
        const run = await runChannelProductionMonitor({ channel });
        if (run && run.status !== "passed") {
          console.warn(`[chat-channel-quality] Monitoreo de producción (${channel}):`, run.status, run.reasons.join(" | "));
        }
      }
      await purgeOldChannelQualityRuns();
    } catch (error) {
      console.error("[chat-channel-quality] No fue posible registrar el monitoreo:", error?.message || error);
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), MONITOR_INTERVAL_MS);
  timer.unref?.();
}
