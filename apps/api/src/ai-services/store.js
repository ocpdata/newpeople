// Database access for AI services: settings, usage events, errors, alerts, provider usage and monitoring.
import { query, withTransaction } from "../db.js";
import { config } from "../config.js";
import { ensureAiUsageSchema } from "../ai-usage/service.js";
import {
  AI_LLM_PROVIDERS,
  AI_MODEL_ROLES,
  AI_MODULES,
  PINECONE_METRICS,
  PINECONE_PLANS,
  aiModuleCodeForFeature,
} from "./catalog.js";
import {
  getAiServiceSettings,
  normalizeAiServiceSettings,
  setAiServiceSettingsCache,
} from "./state.js";
import {
  alertCandidates,
  computeProviderStatuses,
  dayKeyFor,
  isBalanceMetric,
  monthStartFor,
  periodKeyFor,
  tavilyEffectivePrice,
  validateAiServiceSettings,
} from "./status.js";

const MICROS_PER_USD = 1_000_000;
const USAGE_CACHE_MS = 30_000;
const TAVILY_REMOTE_MAX_AGE_MS = 60 * 60 * 1000;
const SETTINGS_REFRESH_MS = 60_000;

let schemaPromise = null;
let usageCache = null;
let tavilyRemoteCache = null;
let refresherStarted = false;

function businessTimeZone() {
  return config.app?.businessTimezone || "America/Mexico_City";
}

function toMicros(usd) {
  const number = Number(usd);
  return Number.isFinite(number) ? Math.round(number * MICROS_PER_USD) : 0;
}

function fromMicros(micros) {
  return Number(micros || 0) / MICROS_PER_USD;
}

function httpError(status, code, message, extra = {}) {
  return Object.assign(new Error(message), { status, code, ...extra });
}

export async function ensureAiServicesSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await query(`CREATE TABLE IF NOT EXISTS ai_service_settings (
        id TINYINT UNSIGNED PRIMARY KEY,
        settings_json LONGTEXT NOT NULL,
        version INT UNSIGNED NOT NULL,
        updated_by_user_id BIGINT UNSIGNED NULL,
        updated_at_utc DATETIME(3) NOT NULL
      )`);
      await query(`CREATE TABLE IF NOT EXISTS ai_service_settings_audit (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        version INT UNSIGNED NOT NULL,
        settings_json LONGTEXT NOT NULL,
        actor_user_id BIGINT UNSIGNED NULL,
        created_at_utc DATETIME(3) NOT NULL,
        KEY idx_ai_service_settings_audit_created (created_at_utc)
      )`);
      await query(`CREATE TABLE IF NOT EXISTS ai_service_usage_events (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        provider VARCHAR(20) NOT NULL,
        metric VARCHAR(40) NOT NULL,
        units BIGINT NOT NULL DEFAULT 0,
        cost_micros BIGINT NULL,
        user_id BIGINT UNSIGNED NULL,
        feature_code VARCHAR(80) NOT NULL,
        module_code VARCHAR(40) NOT NULL,
        created_at_utc DATETIME(3) NOT NULL,
        KEY idx_ai_service_usage_provider_created (provider, created_at_utc),
        KEY idx_ai_service_usage_created (created_at_utc)
      )`);
      await query(`CREATE TABLE IF NOT EXISTS ai_service_call_errors (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        provider VARCHAR(20) NOT NULL,
        feature_code VARCHAR(80) NOT NULL,
        module_code VARCHAR(40) NOT NULL,
        status_code INT NULL,
        error_code VARCHAR(80) NULL,
        message VARCHAR(500) NULL,
        user_id BIGINT UNSIGNED NULL,
        created_at_utc DATETIME(3) NOT NULL,
        KEY idx_ai_service_call_errors_created (created_at_utc)
      )`);
      await query(`CREATE TABLE IF NOT EXISTS ai_service_alerts (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        provider VARCHAR(20) NOT NULL,
        metric VARCHAR(40) NOT NULL,
        level VARCHAR(20) NOT NULL,
        period_key CHAR(7) NOT NULL,
        percent DECIMAL(7,1) NULL,
        created_at_utc DATETIME(3) NOT NULL,
        acknowledged_by_user_id BIGINT UNSIGNED NULL,
        acknowledged_at_utc DATETIME(3) NULL,
        UNIQUE KEY uq_ai_service_alerts_period (provider, metric, level, period_key)
      )`);
      await query(`CREATE TABLE IF NOT EXISTS ai_user_allocation_plan (
        id TINYINT UNSIGNED PRIMARY KEY,
        plan_json LONGTEXT NOT NULL,
        version INT UNSIGNED NOT NULL,
        updated_by_user_id BIGINT UNSIGNED NULL,
        updated_at_utc DATETIME(3) NOT NULL
      )`);
      await query(`CREATE TABLE IF NOT EXISTS ai_user_allocation_plan_audit (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        version INT UNSIGNED NOT NULL,
        plan_json LONGTEXT NOT NULL,
        actor_user_id BIGINT UNSIGNED NULL,
        created_at_utc DATETIME(3) NOT NULL,
        KEY idx_ai_user_allocation_plan_audit_created (created_at_utc)
      )`);
      await query(`CREATE TABLE IF NOT EXISTS ai_service_remote_usage (
        provider VARCHAR(20) PRIMARY KEY,
        payload_json LONGTEXT NULL,
        error_message VARCHAR(500) NULL,
        fetched_at_utc DATETIME(3) NOT NULL
      )`);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

export async function loadAiServiceSettings() {
  await ensureAiServicesSchema();
  const rows = await query("SELECT settings_json, version FROM ai_service_settings WHERE id = 1 LIMIT 1");
  if (!rows[0]) {
    setAiServiceSettingsCache(null);
    return getAiServiceSettings();
  }
  let parsed = {};
  try {
    parsed = JSON.parse(rows[0].settings_json || "{}");
  } catch {
    parsed = {};
  }
  setAiServiceSettingsCache({ ...parsed, version: Number(rows[0].version || 0) });
  return getAiServiceSettings();
}

// Keeps every API process aligned with the stored settings without a query per AI call.
export async function startAiServiceSettingsRefresher() {
  if (refresherStarted) return;
  refresherStarted = true;
  const refresh = () => loadAiServiceSettings().catch((error) => {
    console.error("[ai-services] No fue posible cargar la configuración", error?.message || error);
  });
  setInterval(refresh, SETTINGS_REFRESH_MS).unref?.();
  await refresh();
}

export function aiServiceConnections() {
  return {
    openai: Boolean(String(config.openai?.apiKey || "").trim()),
    tavily: Boolean(String(config.tavily?.apiKey || "").trim()),
    tavilyEnabled: Boolean(config.tavily?.enableSearch),
    pinecone: Boolean(String(config.pinecone?.apiKey || "").trim()),
  };
}

async function loadActiveRates() {
  await ensureAiUsageSchema();
  const now = new Date();
  const rows = await query(
    `SELECT provider, model FROM ai_pricing_rates
     WHERE valid_from_utc <= ? AND (valid_to_utc IS NULL OR valid_to_utc > ?)`,
    [now, now],
  );
  const byProvider = {};
  for (const row of rows) {
    const provider = String(row.provider || "").toLowerCase();
    byProvider[provider] = byProvider[provider] || new Set();
    byProvider[provider].add(String(row.model || ""));
  }
  return byProvider;
}

async function readStoredSettings() {
  const rows = await query("SELECT settings_json FROM ai_service_settings WHERE id = 1 LIMIT 1");
  try {
    return rows[0] ? JSON.parse(rows[0].settings_json || "{}") : {};
  } catch {
    return {};
  }
}

// The capture time is set by the server whenever the administrator enters a new balance.
function withBalanceCapture(incoming, stored, now) {
  const openai = { ...(incoming?.providers?.openai || {}) };
  const previous = stored?.providers?.openai || {};
  const balance = openai.balanceUsd === undefined || openai.balanceUsd === null || openai.balanceUsd === ""
    ? null
    : Number(openai.balanceUsd);
  const previousBalance = previous.balanceUsd ?? null;
  openai.balanceCapturedAt = balance === null
    ? null
    : balance === previousBalance && previous.balanceCapturedAt && !openai.recaptureBalance
      ? previous.balanceCapturedAt
      : now.toISOString();
  delete openai.recaptureBalance;
  return { ...incoming, providers: { ...(incoming?.providers || {}), openai } };
}

export async function saveAiServiceSettings({ settings, expectedVersion, actorUserId }) {
  await ensureAiServicesSchema();
  const normalized = normalizeAiServiceSettings(
    withBalanceCapture(settings, await readStoredSettings(), new Date()),
  );
  const validation = validateAiServiceSettings(normalized, {
    activeRates: await loadActiveRates(),
    connections: aiServiceConnections(),
  });
  if (validation.errors.length) {
    throw httpError(422, "AI_SERVICES_INVALID", "La configuración tiene modelos sin tarifa vigente.", {
      details: validation.errors,
    });
  }
  const now = new Date();
  const saved = await withTransaction(async (conn) => {
    const [rows] = await conn.query("SELECT version FROM ai_service_settings WHERE id = 1 FOR UPDATE");
    const currentVersion = Number(rows[0]?.version || 0);
    if (Number(expectedVersion) !== currentVersion) {
      throw httpError(409, "AI_SERVICES_VERSION_CONFLICT", "Otro administrador cambió la configuración. Recarga e intenta de nuevo.");
    }
    const nextVersion = currentVersion + 1;
    const { version: _ignored, ...payload } = normalized;
    const json = JSON.stringify(payload);
    if (rows[0]) {
      await conn.query(
        "UPDATE ai_service_settings SET settings_json = ?, version = ?, updated_by_user_id = ?, updated_at_utc = ? WHERE id = 1",
        [json, nextVersion, actorUserId || null, now],
      );
    } else {
      await conn.query(
        "INSERT INTO ai_service_settings (id, settings_json, version, updated_by_user_id, updated_at_utc) VALUES (1, ?, ?, ?, ?)",
        [json, nextVersion, actorUserId || null, now],
      );
    }
    await conn.query(
      "INSERT INTO ai_service_settings_audit (version, settings_json, actor_user_id, created_at_utc) VALUES (?, ?, ?, ?)",
      [nextVersion, json, actorUserId || null, now],
    );
    return { ...payload, version: nextVersion };
  });
  setAiServiceSettingsCache(saved);
  usageCache = null;
  return getAiServiceSettings();
}

export async function recordAiServiceUsage({ provider, metric, units, costUsd = null, userId = null, featureCode }) {
  const safeUnits = Math.max(0, Math.round(Number(units) || 0));
  if (!safeUnits) return;
  await ensureAiServicesSchema();
  const safeFeature = String(featureCode || "unspecified").slice(0, 80);
  await query(
    `INSERT INTO ai_service_usage_events
       (provider, metric, units, cost_micros, user_id, feature_code, module_code, created_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      provider,
      metric,
      safeUnits,
      costUsd === null || costUsd === undefined ? null : toMicros(costUsd),
      Number(userId) > 0 ? Number(userId) : null,
      safeFeature,
      aiModuleCodeForFeature(safeFeature),
      new Date(),
    ],
  );
  usageCache = null;
}

export async function recordAiServiceError({ provider, featureCode, statusCode = null, errorCode = null, message = "", userId = null }) {
  await ensureAiServicesSchema();
  const safeFeature = String(featureCode || "unspecified").slice(0, 80);
  await query(
    `INSERT INTO ai_service_call_errors
       (provider, feature_code, module_code, status_code, error_code, message, user_id, created_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      provider,
      safeFeature,
      aiModuleCodeForFeature(safeFeature),
      Number.isInteger(Number(statusCode)) && statusCode !== null ? Number(statusCode) : null,
      errorCode ? String(errorCode).slice(0, 80) : null,
      String(message || "").replace(/\s+/g, " ").trim().slice(0, 500) || null,
      Number(userId) > 0 ? Number(userId) : null,
      new Date(),
    ],
  );
}

export function invalidateAiServiceUsageCache() {
  usageCache = null;
}

async function loadMonthUsage(now = new Date()) {
  const timeZone = businessTimeZone();
  const periodKey = periodKeyFor(now, timeZone);
  const balanceSince = getAiServiceSettings().providers.openai.balanceCapturedAt;
  const cacheKey = `${periodKey}|${balanceSince || ""}`;
  if (usageCache && usageCache.cacheKey === cacheKey && Date.now() - usageCache.at < USAGE_CACHE_MS) {
    return usageCache.value;
  }
  await ensureAiUsageSchema();
  await ensureAiServicesSchema();
  const since = monthStartFor(now, timeZone);
  const [ledgerRows, eventRows] = await Promise.all([
    query(
      `SELECT provider, model, feature_code, COUNT(*) AS calls, COALESCE(SUM(cost_micros), 0) AS cost_micros
       FROM ai_usage_ledger
       WHERE status = 'success' AND created_at_utc >= ?
       GROUP BY provider, model, feature_code`,
      [since],
    ),
    query(
      `SELECT provider, metric, module_code, COUNT(*) AS calls, COALESCE(SUM(units), 0) AS units,
              COALESCE(SUM(cost_micros), 0) AS cost_micros
       FROM ai_service_usage_events
       WHERE created_at_utc >= ?
       GROUP BY provider, metric, module_code`,
      [since],
    ),
  ]);

  const usage = {
    openai: { costUsd: 0, calls: 0, byModel: [] },
    tavily: { credits: 0, calls: 0 },
    pinecone: { calls: 0 },
    byModule: {},
  };
  const byModel = new Map();
  const moduleEntry = (code) => {
    usage.byModule[code] = usage.byModule[code] || { llmCostUsd: 0, llmCalls: 0, tavilyCredits: 0, pineconeTokens: 0, pineconeUnits: 0 };
    return usage.byModule[code];
  };
  for (const row of ledgerRows) {
    const provider = String(row.provider || "openai");
    const costUsd = fromMicros(row.cost_micros);
    const calls = Number(row.calls || 0);
    if (provider === "openai") {
      usage.openai.costUsd += costUsd;
      usage.openai.calls += calls;
      const current = byModel.get(row.model) || { model: row.model, costUsd: 0, calls: 0 };
      current.costUsd += costUsd;
      current.calls += calls;
      byModel.set(row.model, current);
    }
    const entry = moduleEntry(aiModuleCodeForFeature(row.feature_code));
    entry.llmCostUsd += costUsd;
    entry.llmCalls += calls;
  }
  usage.openai.byModel = [...byModel.values()].sort((a, b) => b.costUsd - a.costUsd);
  if (balanceSince) {
    const [spent] = await query(
      `SELECT COALESCE(SUM(cost_micros), 0) AS cost_micros FROM ai_usage_ledger
       WHERE provider = 'openai' AND status = 'success' AND created_at_utc >= ?`,
      [new Date(balanceSince)],
    );
    usage.openai.spentSinceBalanceUsd = fromMicros(spent?.cost_micros);
  }
  for (const row of eventRows) {
    const units = Number(row.units || 0);
    const calls = Number(row.calls || 0);
    const entry = moduleEntry(row.module_code);
    if (row.provider === "tavily" && row.metric === "credits") {
      usage.tavily.credits += units;
      usage.tavily.calls += calls;
      entry.tavilyCredits += units;
    }
    if (row.provider === "pinecone") {
      usage.pinecone[row.metric] = Number(usage.pinecone[row.metric] || 0) + units;
      if (row.metric !== "ingestion_units") {
        usage.pinecone.calls += calls;
        entry.pineconeTokens += units;
      } else {
        entry.pineconeUnits += units;
      }
    }
  }
  usageCache = { cacheKey, at: Date.now(), value: usage };
  return usage;
}

function parseTavilyUsagePayload(payload) {
  const account = payload?.account || {};
  const key = payload?.key || {};
  const number = (value) => (value === null || value === undefined || value === "" ? null : Number(value));
  return {
    plan: account.current_plan ? String(account.current_plan) : null,
    planUsage: number(account.plan_usage),
    planLimit: number(account.plan_limit),
    paygoUsage: number(account.paygo_usage),
    paygoLimit: number(account.paygo_limit),
    keyUsage: number(key.usage),
    keyLimit: number(key.limit),
  };
}

async function readStoredTavilyRemote() {
  await ensureAiServicesSchema();
  const rows = await query(
    "SELECT payload_json, error_message, fetched_at_utc FROM ai_service_remote_usage WHERE provider = 'tavily' LIMIT 1",
  );
  if (!rows[0]) return null;
  let payload = null;
  try {
    payload = rows[0].payload_json ? JSON.parse(rows[0].payload_json) : null;
  } catch {
    payload = null;
  }
  return {
    ...(payload ? parseTavilyUsagePayload(payload) : {}),
    error: rows[0].error_message || null,
    fetchedAt: rows[0].fetched_at_utc ? new Date(rows[0].fetched_at_utc).toISOString() : null,
  };
}

// Reads plan and credits from Tavily's /usage endpoint; cached for an hour unless forced.
export async function refreshTavilyRemoteUsage({ force = false, fetchImpl = fetch } = {}) {
  const apiKey = String(config.tavily?.apiKey || "").trim();
  if (!apiKey) return null;
  if (!force) {
    const cached = tavilyRemoteCache || await readStoredTavilyRemote();
    if (cached?.fetchedAt && Date.now() - new Date(cached.fetchedAt).getTime() < TAVILY_REMOTE_MAX_AGE_MS) {
      tavilyRemoteCache = cached;
      return cached;
    }
  }
  const fetchedAt = new Date();
  let payload = null;
  let errorMessage = null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(config.tavily?.timeoutMs || 15000));
  try {
    const response = await fetchImpl(`${String(config.tavily.baseUrl || "https://api.tavily.com").replace(/\/$/, "")}/usage`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Tavily respondió ${response.status}`);
    payload = await response.json();
  } catch (error) {
    errorMessage = String(error?.name === "AbortError" ? "Tavily no respondió a tiempo" : error?.message || "No fue posible leer el uso de Tavily").slice(0, 500);
  } finally {
    clearTimeout(timeout);
  }
  await ensureAiServicesSchema();
  await query(
    `INSERT INTO ai_service_remote_usage (provider, payload_json, error_message, fetched_at_utc)
     VALUES ('tavily', ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       payload_json = IF(VALUES(error_message) IS NULL, VALUES(payload_json), payload_json),
       error_message = VALUES(error_message),
       fetched_at_utc = VALUES(fetched_at_utc)`,
    [payload ? JSON.stringify(payload) : null, errorMessage, fetchedAt],
  );
  tavilyRemoteCache = await readStoredTavilyRemote();
  return tavilyRemoteCache;
}

async function currentStatuses(now = new Date(), { readTavily = true } = {}) {
  const settings = getAiServiceSettings();
  const usage = await loadMonthUsage(now);
  let remoteTavily = tavilyRemoteCache;
  if (readTavily) {
    try {
      remoteTavily = await refreshTavilyRemoteUsage();
    } catch (error) {
      console.error("[ai-services] No fue posible leer el uso de Tavily", error?.message || error);
    }
  }
  return {
    settings,
    usage,
    statuses: computeProviderStatuses({ settings, usage, remoteTavily, connections: aiServiceConnections() }),
  };
}

// Throws when the provider reached its monthly limit and the settings say to stop.
export async function assertAiProviderWithinLimit(provider) {
  const settings = getAiServiceSettings();
  const providerSettings = settings.providers[provider];
  if (!providerSettings || providerSettings.onLimit !== "stop") return;
  if (provider === "openai" && !providerSettings.monthlyLimitUsd) return;
  const { statuses } = await currentStatuses(new Date(), { readTavily: provider === "tavily" });
  const status = statuses[provider];
  if (status?.metrics.some((metric) => !isBalanceMetric(metric.code) && metric.level === "limit")) {
    throw httpError(
      402,
      "AI_PROVIDER_LIMIT_REACHED",
      `Se alcanzó el límite mensual configurado para ${status.label}. Un administrador puede ampliarlo en Configuración > Crédito IA.`,
    );
  }
}

export async function isAiProviderWithinLimit(provider) {
  try {
    await assertAiProviderWithinLimit(provider);
    return true;
  } catch (error) {
    if (error?.code === "AI_PROVIDER_LIMIT_REACHED") return false;
    throw error;
  }
}

async function syncAlerts(statuses, periodKey) {
  const now = new Date();
  for (const candidate of alertCandidates(statuses)) {
    await query(
      `INSERT IGNORE INTO ai_service_alerts (provider, metric, level, period_key, percent, created_at_utc)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [candidate.provider, candidate.metric, candidate.level, periodKey, candidate.percent, now],
    );
  }
}

function describeBalanceAlert(row, status) {
  const balance = status?.balance;
  const amount = (value) => `USD ${Number(value || 0).toFixed(2)}`;
  if (row.level === "limit") {
    return `El saldo estimado de ${status?.label || row.provider} se agotó. Recarga crédito y captura el nuevo saldo.`;
  }
  return balance
    ? `El saldo estimado de ${status.label} bajó a ${amount(balance.estimatedUsd)} (aviso en ${amount(balance.warningUsd)}).`
    : `El saldo estimado de ${status?.label || row.provider} bajó del umbral de aviso.`;
}

function describeAlert(row, statuses) {
  const status = statuses[row.provider];
  if (isBalanceMetric(row.metric)) return describeBalanceAlert(row, status);
  const metric = status?.metrics.find((item) => item.code === row.metric);
  const subject = metric && status.metrics.length > 1 ? `${status.label} · ${metric.label}` : status?.label || row.provider;
  const percent = row.percent === null || row.percent === undefined ? "" : ` (${Number(row.percent)}%)`;
  return row.level === "limit"
    ? `${subject} llegó al límite mensual${percent}.`
    : `${subject} superó el umbral de aviso${percent}.`;
}

export async function listAiServiceAlerts({ now = new Date() } = {}) {
  await ensureAiServicesSchema();
  const { statuses } = await currentStatuses(now);
  const periodKey = periodKeyFor(now, businessTimeZone());
  await syncAlerts(statuses, periodKey);
  const rows = await query(
    `SELECT id, provider, metric, level, percent, created_at_utc
     FROM ai_service_alerts
     WHERE period_key = ? AND acknowledged_at_utc IS NULL
     ORDER BY level = 'limit' DESC, created_at_utc DESC`,
    [periodKey],
  );
  const currentBalanceMetric = statuses.openai.metrics.find((metric) => isBalanceMetric(metric.code))?.code || null;
  return rows
    .filter((row) => !isBalanceMetric(row.metric) || row.metric === currentBalanceMetric)
    .map((row) => ({
      id: Number(row.id),
      provider: row.provider,
      metric: row.metric,
      level: row.level,
      percent: row.percent === null ? null : Number(row.percent),
      message: describeAlert(row, statuses),
      createdAtUtc: row.created_at_utc ? new Date(row.created_at_utc).toISOString() : null,
    }));
}

export async function acknowledgeAiServiceAlert({ alertId, actorUserId }) {
  await ensureAiServicesSchema();
  const result = await query(
    `UPDATE ai_service_alerts SET acknowledged_by_user_id = ?, acknowledged_at_utc = ?
     WHERE id = ? AND acknowledged_at_utc IS NULL`,
    [actorUserId || null, new Date(), Number(alertId)],
  );
  if (!result?.affectedRows) throw httpError(404, "AI_SERVICE_ALERT_NOT_FOUND", "El aviso ya no está pendiente.");
}

export async function getAiServicesOverview({ refreshTavily = false } = {}) {
  await ensureAiServicesSchema();
  if (refreshTavily) await refreshTavilyRemoteUsage({ force: true });
  const now = new Date();
  const { settings, usage, statuses } = await currentStatuses(now);
  const activeRates = await loadActiveRates();
  const connections = aiServiceConnections();
  const validation = validateAiServiceSettings(settings, { activeRates, connections });
  const alerts = await listAiServiceAlerts({ now });
  const timeZone = businessTimeZone();
  return {
    settings,
    periodKey: periodKeyFor(now, timeZone),
    periodStartUtc: monthStartFor(now, timeZone).toISOString(),
    timeZone,
    catalog: {
      modules: AI_MODULES.map(({ prefixes: _prefixes, ...module }) => module),
      roles: AI_MODEL_ROLES,
      llmProviders: AI_LLM_PROVIDERS,
      pineconePlans: Object.entries(PINECONE_PLANS).map(([code, plan]) => ({ code, label: plan.label, limits: plan.limits })),
      pineconeMetrics: PINECONE_METRICS,
    },
    connections,
    statuses,
    modulesUsage: usage.byModule,
    readiness: { moduleIssues: validation.moduleIssues, providerIssues: validation.providerIssues, errors: validation.errors },
    tariffModels: Object.fromEntries(
      Object.entries(activeRates).map(([provider, models]) => [provider, [...models].sort()]),
    ),
    alerts,
  };
}

// Monitoring for a date range: daily totals, by module, by model, top users and recent errors.
export async function getAiServicesUsage({ fromUtc, toUtc } = {}) {
  await ensureAiUsageSchema();
  await ensureAiServicesSchema();
  const timeZone = businessTimeZone();
  const now = new Date();
  const from = fromUtc ? new Date(fromUtc) : monthStartFor(now, timeZone);
  const to = toUtc ? new Date(toUtc) : now;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    throw httpError(400, "AI_SERVICES_INVALID_RANGE", "El periodo no es válido.");
  }
  const settings = getAiServiceSettings();
  const remoteTavily = tavilyRemoteCache || await readStoredTavilyRemote().catch(() => null);
  const tavilyPrice = tavilyEffectivePrice(settings, remoteTavily).usdPerCredit;
  const pineconePlan = PINECONE_PLANS[settings.providers.pinecone.plan] || PINECONE_PLANS.starter;

  const [ledgerRows, eventRows, errorRows] = await Promise.all([
    query(
      `SELECT DATE_FORMAT(created_at_utc, '%Y-%m-%d %H') AS bucket, MIN(created_at_utc) AS bucket_at,
              provider, model, feature_code, user_id,
              COUNT(*) AS calls, COALESCE(SUM(total_tokens), 0) AS tokens, COALESCE(SUM(cost_micros), 0) AS cost_micros
       FROM ai_usage_ledger
       WHERE status = 'success' AND created_at_utc BETWEEN ? AND ?
       GROUP BY bucket, provider, model, feature_code, user_id`,
      [from, to],
    ),
    query(
      `SELECT DATE_FORMAT(created_at_utc, '%Y-%m-%d %H') AS bucket, MIN(created_at_utc) AS bucket_at,
              provider, metric, module_code, user_id,
              COUNT(*) AS calls, COALESCE(SUM(units), 0) AS units, SUM(cost_micros) AS cost_micros
       FROM ai_service_usage_events
       WHERE created_at_utc BETWEEN ? AND ?
       GROUP BY bucket, provider, metric, module_code, user_id`,
      [from, to],
    ),
    query(
      `SELECT provider, feature_code, module_code, status_code, error_code, message, created_at_utc
       FROM ai_service_call_errors
       WHERE created_at_utc BETWEEN ? AND ?
       ORDER BY created_at_utc DESC
       LIMIT 50`,
      [from, to],
    ),
  ]);

  const days = new Map();
  const modules = new Map();
  const models = new Map();
  const users = new Map();
  const dayEntry = (key) => {
    if (!days.has(key)) days.set(key, { day: key, llmCostUsd: 0, llmCalls: 0, tavilyCredits: 0, tavilyCostUsd: 0, pineconeTokens: 0, pineconeCostUsd: 0 });
    return days.get(key);
  };
  const moduleEntry = (code) => {
    if (!modules.has(code)) modules.set(code, { module: code, llmCostUsd: 0, llmCalls: 0, tavilyCredits: 0, tavilyCostUsd: 0, pineconeTokens: 0, pineconeCostUsd: 0 });
    return modules.get(code);
  };
  const userEntry = (id) => {
    if (!users.has(id)) users.set(id, { userId: id, costUsd: 0, llmCostUsd: 0, tavilyCredits: 0, pineconeTokens: 0, calls: 0 });
    return users.get(id);
  };

  for (const row of ledgerRows) {
    const costUsd = fromMicros(row.cost_micros);
    const calls = Number(row.calls || 0);
    const day = dayEntry(dayKeyFor(new Date(row.bucket_at), timeZone));
    day.llmCostUsd += costUsd;
    day.llmCalls += calls;
    const module = moduleEntry(aiModuleCodeForFeature(row.feature_code));
    module.llmCostUsd += costUsd;
    module.llmCalls += calls;
    const modelKey = `${row.provider}:${row.model}`;
    const model = models.get(modelKey) || { provider: row.provider, model: row.model, costUsd: 0, calls: 0, tokens: 0 };
    model.costUsd += costUsd;
    model.calls += calls;
    model.tokens += Number(row.tokens || 0);
    models.set(modelKey, model);
    if (row.user_id) {
      const user = userEntry(Number(row.user_id));
      user.costUsd += costUsd;
      user.llmCostUsd += costUsd;
      user.calls += calls;
    }
  }

  for (const row of eventRows) {
    const units = Number(row.units || 0);
    const calls = Number(row.calls || 0);
    const day = dayEntry(dayKeyFor(new Date(row.bucket_at), timeZone));
    const module = moduleEntry(row.module_code);
    const user = row.user_id ? userEntry(Number(row.user_id)) : null;
    if (row.provider === "tavily") {
      const costUsd = row.cost_micros !== null && row.cost_micros !== undefined
        ? fromMicros(row.cost_micros)
        : tavilyPrice === null ? 0 : units * tavilyPrice;
      day.tavilyCredits += units;
      day.tavilyCostUsd += costUsd;
      module.tavilyCredits += units;
      module.tavilyCostUsd += costUsd;
      if (user) {
        user.tavilyCredits += units;
        user.costUsd += costUsd;
        user.calls += calls;
      }
    } else if (row.provider === "pinecone") {
      const costUsd = row.cost_micros !== null && row.cost_micros !== undefined
        ? fromMicros(row.cost_micros)
        : units * Number(pineconePlan.usdPerUnit[row.metric] || 0);
      const tokens = row.metric === "ingestion_units" ? 0 : units;
      day.pineconeTokens += tokens;
      day.pineconeCostUsd += costUsd;
      module.pineconeTokens += tokens;
      module.pineconeCostUsd += costUsd;
      if (user) {
        user.pineconeTokens += tokens;
        user.costUsd += costUsd;
        user.calls += calls;
      }
    }
  }

  const topUsers = [...users.values()]
    .sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls)
    .slice(0, 10);
  if (topUsers.length) {
    const nameRows = await query(
      `SELECT id, full_name, email FROM users WHERE id IN (${topUsers.map(() => "?").join(", ")})`,
      topUsers.map((user) => user.userId),
    );
    const names = new Map(nameRows.map((row) => [Number(row.id), row]));
    for (const user of topUsers) {
      user.fullName = names.get(user.userId)?.full_name || null;
      user.email = names.get(user.userId)?.email || null;
    }
  }

  const moduleLabels = new Map(AI_MODULES.map((module) => [module.code, module.label]));
  return {
    fromUtc: from.toISOString(),
    toUtc: to.toISOString(),
    timeZone,
    days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
    modules: [...modules.values()]
      .map((module) => ({ ...module, label: moduleLabels.get(module.module) || module.module }))
      .sort((a, b) => (b.llmCostUsd + b.tavilyCostUsd + b.pineconeCostUsd) - (a.llmCostUsd + a.tavilyCostUsd + a.pineconeCostUsd)),
    models: [...models.values()].sort((a, b) => b.costUsd - a.costUsd),
    topUsers,
    errors: errorRows.map((row) => ({
      provider: row.provider,
      featureCode: row.feature_code,
      module: row.module_code,
      moduleLabel: moduleLabels.get(row.module_code) || row.module_code,
      statusCode: row.status_code === null ? null : Number(row.status_code),
      errorCode: row.error_code,
      message: row.message,
      createdAtUtc: row.created_at_utc ? new Date(row.created_at_utc).toISOString() : null,
    })),
  };
}
