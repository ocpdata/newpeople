import { query, withTransaction } from "../db.js";
import {
  ensureRulesSchema,
  getCoachBusinessRules,
  loadCoachBusinessRulesWithSource,
} from "./business-rules.js";
import {
  CUSTOMER_SERVER_RULE_CATEGORIES,
  serverRulesUpdateSchema,
} from "./server-policy.js";

const channel = "customer_account";
let schemaPromise;
let cache = null;
const CACHE_MAX_AGE_MS = 60000;

export function invalidateCustomerServerRulesCache() {
  cache = null;
}

export async function ensureCustomerServerRulesSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await ensureRulesSchema();
      await query(`CREATE TABLE IF NOT EXISTS mi_coach_server_rule_versions (
        channel VARCHAR(40) NOT NULL,
        process_key VARCHAR(80) NOT NULL,
        version INT UNSIGNED NOT NULL DEFAULT 0,
        updated_by_user_id BIGINT UNSIGNED NULL,
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (channel, process_key)
      )`);
      await query(`CREATE TABLE IF NOT EXISTS mi_coach_server_rule_revisions (
        channel VARCHAR(40) NOT NULL,
        process_key VARCHAR(80) NOT NULL,
        version INT UNSIGNED NOT NULL,
        rules_json JSON NOT NULL,
        created_by_user_id BIGINT UNSIGNED NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (channel, process_key, version)
      )`);
      await query(
        `INSERT IGNORE INTO mi_coach_server_rule_versions (channel, process_key)
         VALUES (?, 'default')`, [channel],
      );
    })().catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  await schemaPromise;
}

async function getVersion() {
  const rows = await query(
    `SELECT version, updated_by_user_id, updated_at FROM mi_coach_server_rule_versions
     WHERE channel = ? AND process_key = 'default'`, [channel],
  );
  if (!rows[0]) throw new Error("No se encontró la versión de las reglas del servidor");
  return rows[0];
}

export async function loadCustomerEffectiveRules() {
  await ensureCustomerServerRulesSchema();
  // A small version read also detects saves from other API processes.
  const row = await getVersion();
  const version = Number(row.version);
  if (cache && cache.version === version && Date.now() - cache.loadedAt < CACHE_MAX_AGE_MS) {
    return structuredClone(cache.rules);
  }
  // Retry if a concurrent save occurred while loading the shared business rules.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = await getVersion();
    const { businessRules } = await loadCoachBusinessRulesWithSource({ channel });
    const after = await getVersion();
    if (Number(before.version) !== Number(after.version)) continue;
    const rules = {
      ...businessRules,
      serverRulesVersion: Number(after.version),
      serverRulesUpdatedByUserId: Number(after.updated_by_user_id) || null,
      serverRulesUpdatedAt: after.updated_at || null,
    };
    cache = { rules, version: rules.serverRulesVersion, loadedAt: Date.now() };
    return structuredClone(rules);
  }
  throw Object.assign(new Error("Las reglas cambiaron durante la carga. Intenta nuevamente."), {
    code: "customer_server_rules_load_conflict", status: 409,
  });
}

export function editableCustomerRules(rules) {
  return {
    scope: Object.fromEntries(
      ["accountSearchAllowed", "opportunitySearchAllowed", "contactSearchAllowed",
        "leadSearchAllowed", "quotationSearchAllowed"].map((key) => [key, rules.scope[key]]),
    ),
    filters: Object.fromEntries(
      ["defaultOpenOnly", "defaultActiveOnly", "defaultInactiveOnly"]
        .map((key) => [key, rules.filters[key]]),
    ),
    operationPolicy: { allowedKinds: [...rules.operationPolicy.allowedKinds] },
    serverPolicy: { ...rules.serverPolicy },
  };
}

export async function getCustomerServerRulesAdmin() {
  const effective = await loadCustomerEffectiveRules();
  const revisions = await query(
    `SELECT version, rules_json, created_by_user_id, created_at
     FROM mi_coach_server_rule_revisions
     WHERE channel = ? AND process_key = 'default' ORDER BY version DESC`, [channel],
  );
  return {
    channel, process: "default", connected: true, schemaVersion: 1,
    version: effective.serverRulesVersion,
    updatedByUserId: effective.serverRulesUpdatedByUserId,
    updatedAt: effective.serverRulesUpdatedAt,
    rules: editableCustomerRules(effective),
    initialRules: editableCustomerRules(getCoachBusinessRules({ channel })),
    categories: CUSTOMER_SERVER_RULE_CATEGORIES,
    revisions: revisions.map((row) => {
      const stored = typeof row.rules_json === "string" ? JSON.parse(row.rules_json) : row.rules_json;
      return {
        version: Number(row.version),
        rules: editableCustomerRules(getCoachBusinessRules({ channel, overrides: stored })),
        createdByUserId: Number(row.created_by_user_id) || null,
        createdAt: row.created_at,
      };
    }),
    channels: [
      { channel, label: "Cliente existente", connected: true },
      { channel: "coach", label: "Coach", connected: false },
      { channel: "prospect", label: "Cuenta nueva", connected: false },
    ],
  };
}

export async function saveCustomerServerRules({
  user, rules, expectedVersion, legacy = false, replace = false,
}) {
  if (!legacy) {
    const parsed = serverRulesUpdateSchema.safeParse({ rules, expectedVersion });
    if (!parsed.success) {
      throw Object.assign(new Error("Reglas del servidor inválidas"), {
        status: 400, code: "customer_server_rules_invalid_input", issues: parsed.error.issues,
      });
    }
    rules = parsed.data.rules;
  }
  await ensureCustomerServerRulesSchema();
  const saved = await withTransaction(async (connection) => {
    const [versions] = await connection.query(
      `SELECT version FROM mi_coach_server_rule_versions
       WHERE channel = ? AND process_key = 'default' FOR UPDATE`, [channel],
    );
    const version = Number(versions[0]?.version);
    if (!Number.isInteger(version)) throw new Error("Versión de reglas no disponible");
    if (!legacy && expectedVersion !== version) {
      throw Object.assign(new Error("Las reglas cambiaron. Recarga antes de guardar."), {
        status: 409, code: "customer_server_rules_version_conflict",
      });
    }
    const [rows] = await connection.query(
      `SELECT rules_json, updated_by_user_id FROM mi_coach_business_rules
       WHERE channel = ? AND process_key = 'default' FOR UPDATE`, [channel],
    );
    const stored = rows[0]?.rules_json;
    const before = getCoachBusinessRules({
      channel, overrides: typeof stored === "string" ? JSON.parse(stored) : stored || {},
    });
    const overrides = replace ? rules : {
      ...before, ...rules,
      ...Object.fromEntries(["scope", "filters", "operationPolicy", "serverPolicy", "aliases"]
        .map((key) => [key, { ...before[key], ...rules[key] }])),
    };
    if (overrides.filters?.defaultActiveOnly && overrides.filters?.defaultInactiveOnly) {
      throw Object.assign(new Error("No se pueden exigir activadas y no activadas a la vez"), { status: 400 });
    }
    const businessRules = getCoachBusinessRules({ channel, overrides });
    const userId = Number(user?.id) || null;
    // Preserve the pre-existing configuration, including legacy customizations.
    await connection.query(
      `INSERT IGNORE INTO mi_coach_server_rule_revisions
       (channel, process_key, version, rules_json, created_by_user_id)
       VALUES (?, 'default', ?, ?, ?)`,
      [channel, version, JSON.stringify(before), Number(rows[0]?.updated_by_user_id) || null],
    );
    await connection.query(
      `INSERT INTO mi_coach_business_rules
       (channel, process_key, rules_json, updated_by_user_id, created_at, updated_at)
       VALUES (?, 'default', ?, ?, NOW(3), NOW(3))
       ON DUPLICATE KEY UPDATE rules_json = VALUES(rules_json),
         updated_by_user_id = VALUES(updated_by_user_id), updated_at = NOW(3)`,
      [channel, JSON.stringify(businessRules), userId],
    );
    await connection.query(
      `INSERT INTO mi_coach_server_rule_revisions
       (channel, process_key, version, rules_json, created_by_user_id)
       VALUES (?, 'default', ?, ?, ?)`,
      [channel, version + 1, JSON.stringify(businessRules), userId],
    );
    await connection.query(
      `UPDATE mi_coach_server_rule_versions
       SET version = ?, updated_by_user_id = ?, updated_at = NOW(3)
       WHERE channel = ? AND process_key = 'default'`, [version + 1, userId, channel],
    );
    return { before, businessRules, version: version + 1 };
  });
  invalidateCustomerServerRulesCache();
  return saved;
}
