// Per-user share of the captured provider balance: stored plan, enforcement and admin listing.
import { query, withTransaction } from "../db.js";
import { config } from "../config.js";
import { ensureAiUsageSchema } from "../ai-usage/service.js";
import { AI_MODULES, aiModuleCodeForFeature } from "./catalog.js";
import { getAiServiceSettings } from "./state.js";
import { computeUserAllocations, monthStartFor, normalizeAllocationPlan } from "./status.js";
import { ensureAiServicesSchema } from "./store.js";

const CONTEXT_CACHE_MS = 10_000;
const RECENT_USAGE_DAYS = 90;
const MICROS_PER_USD = 1_000_000;

let contextCache = null;

function httpError(status, code, message, extra = {}) {
  return Object.assign(new Error(message), { status, code, ...extra });
}

function fromMicros(value) {
  return Number(value || 0) / MICROS_PER_USD;
}

export function invalidateAllocationCache() {
  contextCache = null;
}

async function readPlan() {
  await ensureAiServicesSchema();
  const rows = await query("SELECT plan_json, version FROM ai_user_allocation_plan WHERE id = 1 LIMIT 1");
  if (!rows[0]) return normalizeAllocationPlan(null, 0);
  let parsed = {};
  try {
    parsed = JSON.parse(rows[0].plan_json || "{}");
  } catch {
    parsed = {};
  }
  return normalizeAllocationPlan(parsed, rows[0].version);
}

function capturedBalance() {
  const openai = getAiServiceSettings().providers.openai;
  return openai.balanceUsd !== null && openai.balanceCapturedAt
    ? { capturedUsd: openai.balanceUsd, capturedAt: openai.balanceCapturedAt }
    : null;
}

async function spentByUserSince(since) {
  await ensureAiUsageSchema();
  const rows = await query(
    `SELECT user_id, COALESCE(SUM(cost_micros), 0) AS cost_micros
     FROM ai_usage_ledger
     WHERE provider = 'openai' AND status = 'success' AND created_at_utc >= ?
     GROUP BY user_id`,
    [since],
  );
  return new Map(rows.map((row) => [Number(row.user_id), fromMicros(row.cost_micros)]));
}

async function activeUserIds() {
  const rows = await query("SELECT id FROM users WHERE status = 'active'");
  return new Set(rows.map((row) => Number(row.id)));
}

// Without a captured balance there is no per-user limit; usage is only measured.
async function loadContext() {
  const balance = capturedBalance();
  if (!balance) return { limited: false };
  if (contextCache && contextCache.capturedAt === balance.capturedAt && Date.now() - contextCache.at < CONTEXT_CACHE_MS) {
    return contextCache.value;
  }
  const [plan, spentByUser, activeIds] = await Promise.all([
    readPlan(),
    spentByUserSince(new Date(balance.capturedAt)),
    activeUserIds(),
  ]);
  const value = {
    limited: true,
    ...balance,
    plan,
    allocations: computeUserAllocations({ capturedUsd: balance.capturedUsd, plan, spentByUser, activeUserIds: activeIds }),
  };
  contextCache = { capturedAt: balance.capturedAt, at: Date.now(), value };
  return value;
}

export async function getUserAllocationSummary(userId) {
  const context = await loadContext();
  if (!context.limited) return { userId: Number(userId), limited: false };
  const allocation = context.allocations.forUser(userId);
  return {
    ...allocation,
    limited: true,
    warningPercent: context.plan.warningPercent,
    capturedUsd: context.capturedUsd,
    capturedAt: context.capturedAt,
  };
}

export async function assertUserAllocationAvailable(userId) {
  const summary = await getUserAllocationSummary(userId);
  if (!summary.limited || summary.availableUsd > 0) return;
  const message = summary.source === "allocation"
    ? "Se agotó tu asignación de crédito IA. Pide a un administrador que aumente tu porcentaje o capture un nuevo saldo."
    : "Se agotó la reserva compartida de crédito IA. Pide a un administrador que te asigne un porcentaje o capture un nuevo saldo.";
  throw httpError(402, "AI_BUDGET_EXCEEDED", message);
}

export async function listUserAllocations({ now = new Date() } = {}) {
  await ensureAiServicesSchema();
  await ensureAiUsageSchema();
  const balance = capturedBalance();
  const since = balance
    ? new Date(balance.capturedAt)
    : monthStartFor(now, config.app?.businessTimezone || "America/Mexico_City");
  const recentSince = new Date(now.getTime() - RECENT_USAGE_DAYS * 24 * 60 * 60 * 1000);
  const [plan, users, usageRows, recentRows] = await Promise.all([
    readPlan(),
    query(
      `SELECT u.id, u.full_name, u.email,
              GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ', ') AS roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE u.status = 'active'
       GROUP BY u.id, u.full_name, u.email
       ORDER BY u.full_name ASC, u.id ASC`,
    ),
    query(
      `SELECT user_id, feature_code, COUNT(*) AS calls, COALESCE(SUM(cost_micros), 0) AS cost_micros
       FROM ai_usage_ledger
       WHERE provider = 'openai' AND status = 'success' AND created_at_utc >= ?
       GROUP BY user_id, feature_code`,
      [since],
    ),
    query(
      `SELECT DISTINCT user_id FROM ai_usage_ledger WHERE status = 'success' AND created_at_utc >= ?`,
      [recentSince],
    ),
  ]);

  const moduleLabels = new Map(AI_MODULES.map((module) => [module.code, module.label]));
  const spentByUser = new Map();
  const modulesByUser = new Map();
  for (const row of usageRows) {
    const userId = Number(row.user_id);
    const costUsd = fromMicros(row.cost_micros);
    spentByUser.set(userId, Number(spentByUser.get(userId) || 0) + costUsd);
    const moduleCode = aiModuleCodeForFeature(row.feature_code);
    const modules = modulesByUser.get(userId) || new Map();
    const entry = modules.get(moduleCode) || { module: moduleCode, label: moduleLabels.get(moduleCode) || moduleCode, costUsd: 0, calls: 0 };
    entry.costUsd += costUsd;
    entry.calls += Number(row.calls || 0);
    modules.set(moduleCode, entry);
    modulesByUser.set(userId, modules);
  }
  const activeIds = new Set(users.map((user) => Number(user.id)));
  const recentIds = new Set(recentRows.map((row) => Number(row.user_id)));
  const allocations = balance
    ? computeUserAllocations({ capturedUsd: balance.capturedUsd, plan, spentByUser, activeUserIds: activeIds })
    : null;

  return {
    plan: { version: plan.version, warningPercent: plan.warningPercent },
    limited: Boolean(balance),
    capturedUsd: balance?.capturedUsd ?? null,
    capturedAt: balance?.capturedAt ?? null,
    spentSinceUtc: since.toISOString(),
    totals: allocations
      ? {
          assignedPercent: allocations.assignedPercent,
          reservePercent: allocations.reservePercent,
          reserveUsd: allocations.reserveUsd,
          reserveSpentUsd: allocations.reserveSpentUsd,
          reserveAvailableUsd: allocations.reserveAvailableUsd,
          reserveState: allocations.reserveState,
        }
      : null,
    users: users.map((user) => {
      const id = Number(user.id);
      const allocation = allocations?.forUser(id);
      return {
        userId: id,
        fullName: String(user.full_name || ""),
        email: String(user.email || ""),
        roles: String(user.roles || ""),
        percent: plan.users[id] ?? null,
        usedAiRecently: recentIds.has(id),
        spentUsd: Number(spentByUser.get(id) || 0),
        allocatedUsd: allocation?.allocatedUsd ?? null,
        availableUsd: allocation?.availableUsd ?? null,
        consumedPercent: allocation?.consumedPercent ?? null,
        source: allocation?.source ?? null,
        state: allocation?.state ?? "unlimited",
        byModule: [...(modulesByUser.get(id)?.values() || [])].sort((a, b) => b.costUsd - a.costUsd),
      };
    }),
  };
}

export async function saveAllocationPlan({ users, warningPercent, expectedVersion, actorUserId }) {
  await ensureAiServicesSchema();
  const activeIds = await activeUserIds();
  const incoming = {};
  for (const item of users || []) {
    const userId = Number(item.userId);
    const percent = item.percent === null || item.percent === undefined ? 0 : Math.round(Number(item.percent) * 100) / 100;
    if (!activeIds.has(userId)) {
      throw httpError(400, "AI_ALLOCATION_INACTIVE_USER", "Solo se pueden asignar porcentajes a usuarios activos.");
    }
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw httpError(400, "AI_ALLOCATION_INVALID_PERCENT", "Cada porcentaje debe estar entre 0 y 100.");
    }
    if (percent > 0) incoming[userId] = percent;
  }
  const total = Object.values(incoming).reduce((sum, value) => sum + value, 0);
  if (Math.round(total * 100) > 10_000) {
    throw httpError(422, "AI_ALLOCATION_OVER_100", `Los porcentajes suman ${Math.round(total * 100) / 100} %; el máximo es 100 %.`);
  }

  const now = new Date();
  const saved = await withTransaction(async (conn) => {
    const [rows] = await conn.query("SELECT plan_json, version FROM ai_user_allocation_plan WHERE id = 1 FOR UPDATE");
    const currentVersion = Number(rows[0]?.version || 0);
    if (Number(expectedVersion) !== currentVersion) {
      throw httpError(409, "AI_ALLOCATION_VERSION_CONFLICT", "Otro administrador cambió las asignaciones. Recarga e intenta de nuevo.");
    }
    let stored = {};
    try {
      stored = rows[0] ? JSON.parse(rows[0].plan_json || "{}") : {};
    } catch {
      stored = {};
    }
    // Percentages of inactive users are kept so they come back if the user is reactivated.
    const preserved = Object.fromEntries(
      Object.entries(normalizeAllocationPlan(stored).users).filter(([id]) => !activeIds.has(Number(id))),
    );
    const plan = normalizeAllocationPlan({
      warningPercent: warningPercent ?? stored.warningPercent,
      users: { ...preserved, ...incoming },
    });
    const nextVersion = currentVersion + 1;
    const json = JSON.stringify({ warningPercent: plan.warningPercent, users: plan.users });
    if (rows[0]) {
      await conn.query(
        "UPDATE ai_user_allocation_plan SET plan_json = ?, version = ?, updated_by_user_id = ?, updated_at_utc = ? WHERE id = 1",
        [json, nextVersion, actorUserId || null, now],
      );
    } else {
      await conn.query(
        "INSERT INTO ai_user_allocation_plan (id, plan_json, version, updated_by_user_id, updated_at_utc) VALUES (1, ?, ?, ?, ?)",
        [json, nextVersion, actorUserId || null, now],
      );
    }
    await conn.query(
      "INSERT INTO ai_user_allocation_plan_audit (version, plan_json, actor_user_id, created_at_utc) VALUES (?, ?, ?, ?)",
      [nextVersion, json, actorUserId || null, now],
    );
    return { ...plan, version: nextVersion };
  });
  invalidateAllocationCache();
  return saved;
}
