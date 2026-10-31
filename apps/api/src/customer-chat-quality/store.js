import { query } from "../db.js";
import { config } from "../config.js";
import { QUALITY_SOURCES, assessQualityReport } from "./gates.js";

let ready;
export function ensureQualitySchema() {
  if (!ready) ready = createSchema().catch((error) => { ready = null; throw error; });
  return ready;
}

async function createSchema() {
  await query(`CREATE TABLE IF NOT EXISTS customer_chat_quality_runs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
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
    KEY quality_source_time (source, evaluated_at)
  ) ENGINE=InnoDB`);
  await query(`CREATE TABLE IF NOT EXISTS customer_chat_quality_settings (
    id TINYINT UNSIGNED PRIMARY KEY,
    weekly_evaluation_enabled TINYINT NOT NULL DEFAULT 0,
    updated_by_user_id BIGINT UNSIGNED NULL,
    updated_at DATETIME(3) NULL
  ) ENGINE=InnoDB`);
  await query("INSERT IGNORE INTO customer_chat_quality_settings (id) VALUES (1)");
}

const MAX_DETAILS = 30;
const MAX_DETAILS_BYTES = 20000;

// Keeps only what explains a failure; the full report stays in the CI artifact.
export function failedDetails(report) {
  const items = (Array.isArray(report?.results) ? report.results : [])
    .filter((item) => item && item.passed === false)
    .slice(0, MAX_DETAILS)
    .map((item) => ({ group: item.group, id: item.id ?? item.expected ?? null, error: item.error ?? null }));
  const scenarios = (Array.isArray(report?.scenarios) ? report.scenarios : [])
    .filter((item) => item.status !== "pass")
    .slice(0, MAX_DETAILS)
    .map((item) => ({ group: "scenarios", id: item.name, error: item.status }));
  const details = [...items, ...scenarios];
  return JSON.stringify(details).length > MAX_DETAILS_BYTES ? details.slice(0, 10) : details;
}

const parse = (value) => (typeof value === "string" ? JSON.parse(value) : value);

function mapRow(row) {
  return {
    id: Number(row.id),
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

export async function recordQualityRun({ source, report, metrics = {}, model = null, commitSha = null,
  trigger = "manual", evaluatedAt = null, details = null }) {
  if (!QUALITY_SOURCES.includes(source)) throw new Error(`Fuente de calidad desconocida: ${source}`);
  await ensureQualitySchema();
  const when = evaluatedAt ? new Date(evaluatedAt) : new Date();
  if (Number.isNaN(when.getTime())) throw new Error("Fecha de evaluación inválida.");
  if (commitSha) {
    const [existing] = await query(
      "SELECT * FROM customer_chat_quality_runs WHERE source = ? AND evaluated_at = ? AND commit_sha = ? LIMIT 1",
      [source, when, String(commitSha).slice(0, 40)],
    );
    if (existing) return { ...mapRow(existing), duplicate: true };
  }
  const [previous] = await query(
    "SELECT groups_json FROM customer_chat_quality_runs WHERE source = ? AND evaluated_at < ? ORDER BY evaluated_at DESC, id DESC LIMIT 1",
    [source, when],
  );
  const assessment = assessQualityReport({ source, report, metrics, previousGroups: previous ? parse(previous.groups_json) : null });
  const result = await query(
    `INSERT INTO customer_chat_quality_runs
      (source, status, trigger_kind, model, commit_sha, groups_json, metrics_json, reasons_json, details_json, evaluated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [source, assessment.status, trigger, model ? String(model).slice(0, 80) : null,
      commitSha ? String(commitSha).slice(0, 40) : null, JSON.stringify(assessment.groups),
      JSON.stringify(metrics || {}), JSON.stringify(assessment.reasons),
      JSON.stringify(details ?? failedDetails(report)), when],
  );
  const [row] = await query("SELECT * FROM customer_chat_quality_runs WHERE id = ?", [result.insertId]);
  return mapRow(row);
}

export async function getQualityOverview({ days = 90 } = {}) {
  await ensureQualitySchema();
  const span = Math.min(Math.max(Number(days) || 90, 1), 365);
  const rows = await query(
    `SELECT * FROM customer_chat_quality_runs
     WHERE evaluated_at >= ?
     ORDER BY evaluated_at ASC, id ASC LIMIT 1000`,
    [new Date(Date.now() - span * 86400000)],
  );
  const runs = rows.map(mapRow);
  const latest = {};
  for (const run of runs) latest[run.source] = run;
  const latestOutsideWindow = [];
  for (const source of QUALITY_SOURCES) {
    if (latest[source]) continue;
    const [row] = await query(
      "SELECT * FROM customer_chat_quality_runs WHERE source = ? ORDER BY evaluated_at DESC, id DESC LIMIT 1", [source]);
    if (row) latestOutsideWindow.push(mapRow(row));
  }
  for (const run of latestOutsideWindow) latest[run.source] = run;
  return { days: span, runs, latest, settings: await getQualitySettings() };
}

export async function getQualitySettings() {
  await ensureQualitySchema();
  const [row] = await query(
    `SELECT s.weekly_evaluation_enabled, s.updated_at, u.full_name AS updated_by
     FROM customer_chat_quality_settings s LEFT JOIN users u ON u.id = s.updated_by_user_id WHERE s.id = 1`);
  const [lastCi] = await query(
    "SELECT evaluated_at FROM customer_chat_quality_runs WHERE trigger_kind = 'ci' ORDER BY evaluated_at DESC LIMIT 1");
  return {
    weeklyEnabled: Boolean(Number(row?.weekly_evaluation_enabled)),
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
    updatedBy: row?.updated_by || null,
    ciConfigured: Boolean(config.customerChatQuality.ciToken),
    lastCiReportAt: lastCi ? new Date(lastCi.evaluated_at).toISOString() : null,
  };
}

export async function setWeeklyEvaluationEnabled({ enabled, userId }) {
  await ensureQualitySchema();
  await query(
    "UPDATE customer_chat_quality_settings SET weekly_evaluation_enabled = ?, updated_by_user_id = ?, updated_at = ? WHERE id = 1",
    [enabled ? 1 : 0, userId || null, new Date()],
  );
  return getQualitySettings();
}

export async function purgeOldQualityRuns({ months = 24 } = {}) {
  await ensureQualitySchema();
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const result = await query("DELETE FROM customer_chat_quality_runs WHERE evaluated_at < ?", [cutoff]);
  return Number(result?.affectedRows || 0);
}
