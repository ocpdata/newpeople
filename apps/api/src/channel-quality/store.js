import { query } from "../db.js";
import { QUALITY_CHANNELS, QUALITY_SOURCES, assessQualityReport } from "./gates.js";

let ready;
export function ensureChannelQualitySchema() {
  if (!ready) ready = createSchema().catch((error) => { ready = null; throw error; });
  return ready;
}

async function createSchema() {
  await query(`CREATE TABLE IF NOT EXISTS chat_channel_quality_runs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    channel VARCHAR(30) NOT NULL,
    source VARCHAR(40) NOT NULL,
    status VARCHAR(16) NOT NULL,
    trigger_kind VARCHAR(20) NOT NULL DEFAULT 'manual',
    model VARCHAR(80) NULL,
    commit_sha VARCHAR(40) NULL,
    groups_json JSON NOT NULL,
    metrics_json JSON NULL,
    reasons_json JSON NULL,
    details_json JSON NULL,
    evaluated_at DATETIME(3) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY channel_source_time (channel, source, evaluated_at)
  ) ENGINE=InnoDB`);
}

const MAX_DETAILS = 30;
const MAX_DETAILS_BYTES = 20000;

// Keeps only what explains a failure; the full report stays with whoever ran the evaluation.
export function failedDetails(report) {
  const details = (Array.isArray(report?.results) ? report.results : [])
    .filter((item) => item && item.passed === false)
    .slice(0, MAX_DETAILS)
    .map((item) => ({ group: item.group ?? null, id: item.id ?? null, error: item.error ?? null }));
  return JSON.stringify(details).length > MAX_DETAILS_BYTES ? details.slice(0, 10) : details;
}

const parse = (value) => (typeof value === "string" ? JSON.parse(value) : value);

function mapRow(row) {
  return {
    id: Number(row.id),
    channel: row.channel,
    source: row.source,
    status: row.status,
    trigger: row.trigger_kind,
    model: row.model,
    commit: row.commit_sha,
    groups: parse(row.groups_json) || {},
    metrics: parse(row.metrics_json) || {},
    reasons: parse(row.reasons_json) || [],
    details: parse(row.details_json) || [],
    evaluatedAt: new Date(row.evaluated_at).toISOString(),
  };
}

function assertChannel(channel) {
  if (!QUALITY_CHANNELS.includes(channel)) throw new Error(`Canal de calidad desconocido: ${channel}`);
}

export async function recordChannelQualityRun({ channel, source, report, metrics = {}, model = null, commitSha = null,
  trigger = "manual", evaluatedAt = null, details = null }) {
  assertChannel(channel);
  if (!QUALITY_SOURCES.includes(source)) throw new Error(`Fuente de calidad desconocida: ${source}`);
  await ensureChannelQualitySchema();
  const when = evaluatedAt ? new Date(evaluatedAt) : new Date();
  if (Number.isNaN(when.getTime())) throw new Error("Fecha de evaluación inválida.");
  if (commitSha) {
    const [existing] = await query(
      "SELECT * FROM chat_channel_quality_runs WHERE channel = ? AND source = ? AND evaluated_at = ? AND commit_sha = ? LIMIT 1",
      [channel, source, when, String(commitSha).slice(0, 40)],
    );
    if (existing) return { ...mapRow(existing), duplicate: true };
  }
  const [previous] = await query(
    `SELECT groups_json FROM chat_channel_quality_runs
     WHERE channel = ? AND source = ? AND evaluated_at < ? ORDER BY evaluated_at DESC, id DESC LIMIT 1`,
    [channel, source, when],
  );
  const assessment = assessQualityReport({ source, report, metrics, previousGroups: previous ? parse(previous.groups_json) : null });
  const result = await query(
    `INSERT INTO chat_channel_quality_runs
      (channel, source, status, trigger_kind, model, commit_sha, groups_json, metrics_json, reasons_json, details_json, evaluated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [channel, source, assessment.status, trigger, model ? String(model).slice(0, 80) : null,
      commitSha ? String(commitSha).slice(0, 40) : null, JSON.stringify(assessment.groups),
      JSON.stringify(metrics || {}), JSON.stringify(assessment.reasons),
      JSON.stringify(details ?? failedDetails(report)), when],
  );
  const [row] = await query("SELECT * FROM chat_channel_quality_runs WHERE id = ?", [result.insertId]);
  return mapRow(row);
}

export async function getChannelQualityOverview({ channel, days = 90 }) {
  assertChannel(channel);
  await ensureChannelQualitySchema();
  const span = Math.min(Math.max(Number(days) || 90, 1), 365);
  const rows = await query(
    `SELECT * FROM chat_channel_quality_runs
     WHERE channel = ? AND evaluated_at >= ?
     ORDER BY evaluated_at ASC, id ASC LIMIT 1000`,
    [channel, new Date(Date.now() - span * 86400000)],
  );
  const runs = rows.map(mapRow);
  const latest = {};
  for (const run of runs) latest[run.source] = run;
  for (const source of QUALITY_SOURCES) {
    if (latest[source]) continue;
    const [row] = await query(
      "SELECT * FROM chat_channel_quality_runs WHERE channel = ? AND source = ? ORDER BY evaluated_at DESC, id DESC LIMIT 1",
      [channel, source],
    );
    if (row) latest[source] = mapRow(row);
  }
  return { channel, days: span, runs, latest };
}

export async function purgeOldChannelQualityRuns({ months = 24 } = {}) {
  await ensureChannelQualitySchema();
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const result = await query("DELETE FROM chat_channel_quality_runs WHERE evaluated_at < ?", [cutoff]);
  return Number(result?.affectedRows || 0);
}
