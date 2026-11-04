import { query, withTransaction } from "../db.js";
import { ensureRulesSchema, getCoachBusinessRules, loadCoachBusinessRules } from "../coach/business-rules.js";
import {
  PROSPECT_SERVER_RULE_CATEGORIES,
  prospectServerRulesUpdateSchema,
} from "../coach/prospect-server-policy.js";

// Administration of the Cuenta nueva server rules. They live with the channel's business rules and share the version
// and revision tables of the account chat under their own channel, so saving one never touches the other.

const channel = "prospect";
const RULES_PROCESS = "prospect_chat";
let schemaPromise;

export async function ensureProspectServerRulesSchema() {
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
        `INSERT IGNORE INTO mi_coach_server_rule_versions (channel, process_key) VALUES (?, 'default')`,
        [channel],
      );
    })().catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  await schemaPromise;
}

export function editableProspectRules(rules) {
  return {
    scope: {
      libraryMaterialsAllowed: rules.scope.libraryMaterialsAllowed !== false,
      similarCustomersAllowed: rules.scope.similarCustomersAllowed !== false,
    },
    operationPolicy: { allowedKinds: [...rules.operationPolicy.allowedKinds] },
    serverPolicy: { ...rules.serverPolicy },
  };
}

const parseJson = (value) => (typeof value === "string" ? JSON.parse(value) : value || {});

export async function getProspectServerRulesAdmin() {
  await ensureProspectServerRulesSchema();
  const [effective, versions, revisions] = await Promise.all([
    loadCoachBusinessRules({ channel, process: RULES_PROCESS }),
    query(
      `SELECT version, updated_by_user_id, updated_at FROM mi_coach_server_rule_versions
       WHERE channel = ? AND process_key = 'default'`,
      [channel],
    ),
    query(
      `SELECT version, rules_json, created_by_user_id, created_at FROM mi_coach_server_rule_revisions
       WHERE channel = ? AND process_key = 'default' ORDER BY version DESC`,
      [channel],
    ),
  ]);
  const row = versions[0] || {};
  return {
    channel, process: "default", connected: true, schemaVersion: 1,
    version: Number(row.version || 0),
    updatedByUserId: Number(row.updated_by_user_id) || null,
    updatedAt: row.updated_at || null,
    rules: editableProspectRules(effective),
    initialRules: editableProspectRules(getCoachBusinessRules({ channel, process: RULES_PROCESS })),
    categories: PROSPECT_SERVER_RULE_CATEGORIES,
    revisions: revisions.map((item) => ({
      version: Number(item.version),
      rules: editableProspectRules(getCoachBusinessRules({ channel, process: RULES_PROCESS, overrides: parseJson(item.rules_json) })),
      createdByUserId: Number(item.created_by_user_id) || null,
      createdAt: item.created_at,
    })),
  };
}

export async function saveProspectServerRules({ user, rules, expectedVersion }) {
  const parsed = prospectServerRulesUpdateSchema.safeParse({ rules, expectedVersion });
  if (!parsed.success) {
    throw Object.assign(new Error("Reglas del servidor inválidas"), {
      status: 400, code: "prospect_server_rules_invalid_input", issues: parsed.error.issues,
    });
  }
  await ensureProspectServerRulesSchema();
  const patch = parsed.data.rules;
  return withTransaction(async (connection) => {
    const [versions] = await connection.query(
      `SELECT version FROM mi_coach_server_rule_versions
       WHERE channel = ? AND process_key = 'default' FOR UPDATE`,
      [channel],
    );
    const version = Number(versions[0]?.version);
    if (!Number.isInteger(version)) throw new Error("Versión de reglas no disponible");
    if (parsed.data.expectedVersion !== version) {
      throw Object.assign(new Error("Las reglas cambiaron. Recarga antes de guardar."), {
        status: 409, code: "prospect_server_rules_version_conflict",
      });
    }
    const [rows] = await connection.query(
      `SELECT rules_json, updated_by_user_id FROM mi_coach_business_rules
       WHERE channel = ? AND process_key = 'default' FOR UPDATE`,
      [channel],
    );
    const before = getCoachBusinessRules({ channel, process: RULES_PROCESS, overrides: parseJson(rows[0]?.rules_json) });
    const businessRules = getCoachBusinessRules({
      channel, process: RULES_PROCESS,
      overrides: {
        ...before,
        scope: { ...before.scope, ...patch.scope },
        operationPolicy: { ...before.operationPolicy, ...patch.operationPolicy },
        serverPolicy: { ...before.serverPolicy, ...patch.serverPolicy },
      },
    });
    const userId = Number(user?.id) || null;
    await connection.query(
      `INSERT IGNORE INTO mi_coach_server_rule_revisions (channel, process_key, version, rules_json, created_by_user_id)
       VALUES (?, 'default', ?, ?, ?)`,
      [channel, version, JSON.stringify(before), Number(rows[0]?.updated_by_user_id) || null],
    );
    await connection.query(
      `INSERT INTO mi_coach_business_rules (channel, process_key, rules_json, updated_by_user_id, created_at, updated_at)
       VALUES (?, 'default', ?, ?, NOW(3), NOW(3))
       ON DUPLICATE KEY UPDATE rules_json = VALUES(rules_json),
         updated_by_user_id = VALUES(updated_by_user_id), updated_at = NOW(3)`,
      [channel, JSON.stringify(businessRules), userId],
    );
    await connection.query(
      `INSERT INTO mi_coach_server_rule_revisions (channel, process_key, version, rules_json, created_by_user_id)
       VALUES (?, 'default', ?, ?, ?)`,
      [channel, version + 1, JSON.stringify(businessRules), userId],
    );
    await connection.query(
      `UPDATE mi_coach_server_rule_versions SET version = ?, updated_by_user_id = ?, updated_at = NOW(3)
       WHERE channel = ? AND process_key = 'default'`,
      [version + 1, userId, channel],
    );
    return { before, businessRules, version: version + 1 };
  });
}
