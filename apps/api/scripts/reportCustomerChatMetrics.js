import { writeFile } from "node:fs/promises";
import { pool, query } from "../src/db.js";

// Read-only baseline of the existing-customer chat: job outcomes, latency, stuck jobs and
// LLM calls/tokens/cost per phase. Run it before and after changes to compare.
// Usage: npm run report:customer-chat:metrics --workspace=apps/api -- [--days=90 | --since=YYYY-MM-DD] [--json] [--output=file.json]
// --since measures only the traffic after a change (date in UTC), to compare with the earlier baseline.

const CHAT_FEATURE_PREFIX = "commercial_intelligence.account_chat";
const STUCK_AFTER_MINUTES = 10;

function parseArgs(argv) {
  const options = { days: 90, since: null, json: false, output: null };
  for (const rawArg of argv) {
    const arg = String(rawArg || "").trim();
    if (arg === "--json") options.json = true;
    else if (arg.startsWith("--days=")) {
      const value = Number(arg.split("=")[1]);
      if (Number.isInteger(value) && value > 0) options.days = value;
    } else if (arg.startsWith("--since=")) {
      const value = arg.slice("--since=".length);
      if (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))) options.since = value;
    } else if (arg.startsWith("--output=")) options.output = arg.slice("--output=".length) || null;
  }
  return options;
}

function percentile(sortedValues, ratio) {
  if (!sortedValues.length) return null;
  return sortedValues[Math.min(sortedValues.length - 1, Math.floor(sortedValues.length * ratio))];
}

function summarize(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, avg: null, p50: null, p90: null, p95: null, max: null };
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    avg: Number((sum / sorted.length).toFixed(2)),
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1],
  };
}

// Both values are validated (integer / date pattern), so they are safe to inline.
function windowStart({ days, since }) {
  return since ? `'${since} 00:00:00'` : `DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${Number(days)} DAY)`;
}

async function loadJobMetrics(window) {
  const since = windowStart(window);
  const byStatus = await query(
    `SELECT job_type, status, COUNT(*) AS jobs
     FROM customer_intelligence_jobs WHERE created_at >= ${since}
     GROUP BY job_type, status ORDER BY job_type, status`,
  );
  const completed = await query(
    `SELECT id, TIMESTAMPDIFF(MICROSECOND, created_at, finished_at) / 1000000 AS seconds
     FROM customer_intelligence_jobs
     WHERE job_type = 'account_chat' AND status = 'completed' AND finished_at IS NOT NULL AND created_at >= ${since}`,
  );
  const failed = await query(
    `SELECT LEFT(COALESCE(NULLIF(error_message, ''), '(sin mensaje)'), 120) AS message, COUNT(*) AS jobs
     FROM customer_intelligence_jobs
     WHERE job_type = 'account_chat' AND status = 'failed' AND created_at >= ${since}
     GROUP BY message ORDER BY jobs DESC LIMIT 10`,
  );
  const stuck = await query(
    `SELECT job_type, status, COUNT(*) AS jobs, MIN(created_at) AS oldest
     FROM customer_intelligence_jobs
     WHERE finished_at IS NULL AND status IN ('pending', 'running')
       AND created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${STUCK_AFTER_MINUTES} MINUTE)
     GROUP BY job_type, status ORDER BY job_type, status`,
  );
  const chatTotals = byStatus.filter((row) => row.job_type === "account_chat");
  const chatTotal = chatTotals.reduce((sum, row) => sum + Number(row.jobs), 0);
  const chatFailed = chatTotals.filter((row) => row.status === "failed").reduce((sum, row) => sum + Number(row.jobs), 0);
  return {
    byStatus: byStatus.map((row) => ({ jobType: row.job_type, status: row.status, jobs: Number(row.jobs) })),
    accountChat: {
      total: chatTotal,
      failed: chatFailed,
      failureRatePct: chatTotal ? Number(((chatFailed / chatTotal) * 100).toFixed(1)) : 0,
      latencySeconds: summarize(completed.map((row) => Number(row.seconds))),
    },
    topErrors: failed.map((row) => ({ message: row.message, jobs: Number(row.jobs) })),
    stuckJobs: stuck.map((row) => ({
      jobType: row.job_type,
      status: row.status,
      jobs: Number(row.jobs),
      oldest: row.oldest ? new Date(row.oldest).toISOString() : null,
    })),
    completedJobIds: completed.map((row) => Number(row.id)),
    completedJobSeconds: new Map(completed.map((row) => [Number(row.id), Number(row.seconds)])),
  };
}

async function loadLlmMetrics(window, completedJobIds, completedJobSeconds) {
  const rows = await query(
    `SELECT feature_code, job_id, status, model, prompt_tokens, completion_tokens, cached_tokens, cost_micros,
            TIMESTAMPDIFF(MICROSECOND, started_at_utc, completed_at_utc) / 1000000 AS seconds
     FROM ai_usage_ledger
     WHERE feature_code LIKE ? AND job_type = 'account_chat'
       AND created_at_utc >= ${windowStart(window)}`,
    [`${CHAT_FEATURE_PREFIX}%`],
  );
  const byFeature = new Map();
  const callsByJob = new Map();
  const llmSecondsByJob = new Map();
  for (const row of rows) {
    const entry = byFeature.get(row.feature_code) || { calls: 0, errors: 0, seconds: [], tokens: 0, promptTokens: 0, cachedTokens: 0, costMicros: 0, models: new Set() };
    entry.calls += 1;
    if (row.status !== "success") entry.errors += 1;
    if (row.seconds !== null) entry.seconds.push(Number(row.seconds));
    entry.tokens += Number(row.prompt_tokens || 0) + Number(row.completion_tokens || 0);
    entry.promptTokens += Number(row.prompt_tokens || 0);
    entry.cachedTokens += Number(row.cached_tokens || 0);
    entry.costMicros += Number(row.cost_micros || 0);
    if (row.model) entry.models.add(row.model);
    byFeature.set(row.feature_code, entry);
    if (row.job_id) callsByJob.set(Number(row.job_id), (callsByJob.get(Number(row.job_id)) || 0) + 1);
    if (row.job_id && row.seconds !== null) llmSecondsByJob.set(Number(row.job_id), (llmSecondsByJob.get(Number(row.job_id)) || 0) + Number(row.seconds));
  }
  const completed = new Set(completedJobIds);
  const callsPerCompletedJob = [...callsByJob.entries()].filter(([jobId]) => completed.has(jobId)).map(([, calls]) => calls);
  // Share of a completed turn's duration spent waiting on the provider; the rest is CRM queries and processing.
  const shares = [...completed].filter((jobId) => llmSecondsByJob.has(jobId) && completedJobSeconds.get(jobId) > 0)
    .map((jobId) => llmSecondsByJob.get(jobId) / completedJobSeconds.get(jobId));
  const totals = [...byFeature.values()].reduce((sum, entry) => ({
    promptTokens: sum.promptTokens + entry.promptTokens, cachedTokens: sum.cachedTokens + entry.cachedTokens,
    costMicros: sum.costMicros + entry.costMicros,
  }), { promptTokens: 0, cachedTokens: 0, costMicros: 0 });
  return {
    totalCalls: rows.length,
    llmTimeShareOfTurn: summarize(shares.map((value) => Number(value.toFixed(3)))),
    costPerCompletedJobUsd: completed.size ? Number((totals.costMicros / 1_000_000 / completed.size).toFixed(5)) : null,
    cache: {
      promptTokens: totals.promptTokens,
      cachedTokens: totals.cachedTokens,
      cachedPct: totals.promptTokens ? Number(((totals.cachedTokens / totals.promptTokens) * 100).toFixed(1)) : 0,
    },
    callsPerCompletedJob: summarize(callsPerCompletedJob),
    byFeature: [...byFeature.entries()]
      .map(([featureCode, entry]) => ({
        featureCode,
        calls: entry.calls,
        errors: entry.errors,
        latencySeconds: summarize(entry.seconds),
        avgTokens: Math.round(entry.tokens / entry.calls),
        cachedPct: entry.promptTokens ? Number(((entry.cachedTokens / entry.promptTokens) * 100).toFixed(1)) : 0,
        totalCostUsd: Number((entry.costMicros / 1_000_000).toFixed(4)),
        models: [...entry.models],
      }))
      .sort((a, b) => b.calls - a.calls),
  };
}

function formatText(report) {
  const lines = [];
  const latency = report.jobs.accountChat.latencySeconds;
  lines.push(`Chat de cliente existente · ${report.since ? `desde ${report.since}` : `últimos ${report.days} días`} · generado ${report.generatedAt}`);
  lines.push("");
  lines.push(`Jobs account_chat: ${report.jobs.accountChat.total} (fallidos ${report.jobs.accountChat.failed}, ${report.jobs.accountChat.failureRatePct}%)`);
  lines.push(`Latencia (s) completados: n=${latency.count} p50=${latency.p50} p90=${latency.p90} p95=${latency.p95} máx=${latency.max}`);
  const calls = report.llm.callsPerCompletedJob;
  lines.push(`Llamadas LLM por turno completado: promedio=${calls.avg} p90=${calls.p90} máx=${calls.max} (total ${report.llm.totalCalls})`);
  lines.push(`Tiempo del turno esperando al proveedor: promedio=${Math.round((report.llm.llmTimeShareOfTurn.avg || 0) * 100)}%`);
  lines.push(`Costo por turno completado: USD ${report.llm.costPerCompletedJobUsd} · prompt en caché: ${report.llm.cache.cachedPct}% (${report.llm.cache.cachedTokens}/${report.llm.cache.promptTokens} tokens)`);
  lines.push("");
  lines.push("Fase (feature) · llamadas · errores · latencia p50/p95 (s) · tokens prom. · % en caché · costo USD");
  for (const item of report.llm.byFeature) {
    lines.push(`  ${item.featureCode} · ${item.calls} · ${item.errors} · ${item.latencySeconds.p50}/${item.latencySeconds.p95} · ${item.avgTokens} · ${item.cachedPct}% · ${item.totalCostUsd}`);
  }
  lines.push("");
  lines.push("Errores más frecuentes:");
  for (const item of report.jobs.topErrors) lines.push(`  ${item.jobs}× ${item.message}`);
  if (!report.jobs.topErrors.length) lines.push("  (ninguno)");
  lines.push("");
  lines.push(`Jobs atascados (>${STUCK_AFTER_MINUTES} min sin terminar):`);
  for (const item of report.jobs.stuckJobs) lines.push(`  ${item.jobs}× ${item.jobType}/${item.status} (el más antiguo: ${item.oldest})`);
  if (!report.jobs.stuckJobs.length) lines.push("  (ninguno)");
  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const jobs = await loadJobMetrics(options);
  const llm = await loadLlmMetrics(options, jobs.completedJobIds, jobs.completedJobSeconds);
  const { completedJobIds: _ids, completedJobSeconds: _seconds, ...publicJobs } = jobs;
  const report = { generatedAt: new Date().toISOString(), days: options.days, since: options.since, jobs: publicJobs, llm };
  if (options.output) await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(options.json ? JSON.stringify(report, null, 2) : formatText(report));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
