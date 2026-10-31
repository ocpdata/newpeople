import { query } from "../db.js";
import { ensureCommercialIntelligenceSchema } from "../commercial-intelligence/schema.js";
import { ensureQualitySchema, recordQualityRun, purgeOldQualityRuns } from "./store.js";

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

// Flags are deterministic and cost nothing: they mark the turns worth a human look.
export function flagJob({ job, trace, negativeFeedback }) {
  const flags = [];
  if (job.status === "failed") flags.push("job_failed");
  if (trace) {
    if (trace.validation_status === "error" || trace.validation_status === "invalid" || trace.error_code) flags.push("trace_error");
    if (Number(trace.operations_rejected) > 0) flags.push("operation_rejected");
    if (job.status === "completed" && Number(trace.evidence_count) === 0 && trace.validation_status !== "clarification") flags.push("no_evidence");
  }
  if (negativeFeedback) flags.push("negative_feedback");
  return flags;
}

export function summarizeProductionWindow({ jobs, traces, feedback }) {
  const traceByJob = new Map(traces.map((trace) => [Number(trace.job_id), trace]));
  const negativeJobs = new Set(feedback.filter((item) => item.rating === "negative").map((item) => Number(item.job_id)));
  const finished = jobs.filter((job) => job.status === "completed" || job.status === "failed");
  const completed = finished.filter((job) => job.status === "completed");
  const latencies = completed.map((job) => Number(job.seconds)).filter(Number.isFinite);
  const flagged = [];
  const control = [];
  for (const job of finished) {
    const flags = flagJob({ job, trace: traceByJob.get(Number(job.id)), negativeFeedback: negativeJobs.has(Number(job.id)) });
    (flags.length ? flagged : control).push({ jobId: Number(job.id), flags });
  }
  const noEvidence = flagged.filter((item) => item.flags.includes("no_evidence")).length;
  const positive = feedback.filter((item) => item.rating === "positive").length;
  return {
    groups: {
      reliability: { passed: completed.length, total: finished.length },
      satisfaction: { passed: positive, total: feedback.length },
    },
    metrics: {
      windowDays: MONITOR_WINDOW_DAYS,
      turns: finished.length,
      failedTurns: finished.length - completed.length,
      ratedTurns: feedback.length,
      negativeRatings: feedback.length - positive,
      noEvidenceTurns: noEvidence,
      latencyP50Seconds: percentile(latencies, 0.5),
      latencyP95Seconds: percentile(latencies, 0.95),
    },
    sample: [
      ...flagged.sort((a, b) => b.flags.length - a.flags.length || b.jobId - a.jobId).slice(0, FLAGGED_SAMPLE_LIMIT),
      ...control.sort((a, b) => b.jobId - a.jobId).slice(0, CONTROL_SAMPLE_LIMIT),
    ],
  };
}

export async function loadProductionWindow(days = MONITOR_WINDOW_DAYS) {
  await ensureCommercialIntelligenceSchema();
  const jobs = await query(
    `SELECT id, status, TIMESTAMPDIFF(MICROSECOND, created_at, finished_at) / 1000000 AS seconds
     FROM customer_intelligence_jobs
     WHERE job_type = 'account_chat' AND created_at >= DATE_SUB(NOW(3), INTERVAL ? DAY)`,
    [Number(days)],
  );
  const ids = jobs.map((job) => Number(job.id));
  const traces = ids.length ? await query(
    `SELECT job_id, validation_status, error_code, operations_rejected, evidence_count
     FROM coach_turn_quality_traces WHERE channel = 'customer_account' AND job_id IN (${ids.map(() => "?").join(",")})`,
    ids,
  ) : [];
  const feedback = await query(
    `SELECT job_id, rating FROM customer_chat_turn_feedback WHERE created_at >= DATE_SUB(NOW(3), INTERVAL ? DAY)`,
    [Number(days)],
  );
  return { jobs, traces, feedback };
}

export async function runProductionMonitor({ force = false, trigger = "scheduled" } = {}) {
  await ensureQualitySchema();
  if (!force) {
    const [last] = await query(
      "SELECT evaluated_at FROM customer_chat_quality_runs WHERE source = 'production_monitor' ORDER BY evaluated_at DESC LIMIT 1");
    if (last && Date.now() - new Date(last.evaluated_at).getTime() < MIN_HOURS_BETWEEN_SNAPSHOTS * 3600000) return null;
  }
  const summary = summarizeProductionWindow(await loadProductionWindow());
  return recordQualityRun({
    source: "production_monitor",
    report: { groups: summary.groups },
    metrics: summary.metrics,
    trigger,
    details: summary.sample,
  });
}

let started = false;
export function startProductionMonitorWorker() {
  if (started || process.env.NODE_ENV === "test") return;
  started = true;
  const tick = async () => {
    try {
      const run = await runProductionMonitor();
      if (run && run.status !== "passed") {
        console.warn("[customer-chat-quality] Monitoreo de producción:", run.status, run.reasons.join(" | "));
      }
      await purgeOldQualityRuns();
    } catch (error) {
      console.error("[customer-chat-quality] No fue posible registrar el monitoreo:", error?.message || error);
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), MONITOR_INTERVAL_MS);
  timer.unref?.();
}
