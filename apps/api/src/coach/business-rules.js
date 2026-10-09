import { query, withTransaction } from "../db.js";

const COACH_BASE_RULES = Object.freeze({
  channel: "coach",
  process: "default",
  scope: Object.freeze({
    accountScoped: false,
    accountSearchAllowed: true,
    leadSearchAllowed: true,
    opportunitySearchAllowed: true,
    contactSearchAllowed: true,
    quotationSearchAllowed: true,
    requireContextForOperation: true,
    requireBusinessEvidence: true,
    requirePermissionValidation: true,
  }),
  filters: Object.freeze({
    defaultOpenOnly: false,
    defaultActiveOnly: true,
    defaultInactiveOnly: false,
    defaultRequireEvidence: true,
  }),
  aliases: Object.freeze({
    stage: Object.freeze({
      "contacto inicial": "contacto_inicial",
      contacto_inicial: "contacto_inicial",
      "identificacion de oportunidad": "identificacion_oportunidad",
      identificacion_oportunidad: "identificacion_oportunidad",
      desarrollo: "desarrollo",
      cotizacion: "cotizacion",
      demostracion: "demostracion",
      negociacion: "negociacion",
      waiting: "waiting",
      espera: "waiting",
    }),
    opportunityStatus: Object.freeze({
      abierta: "en_proceso",
      abierto: "en_proceso",
      "en proceso": "en_proceso",
      ganada: "ganada",
      ganado: "ganada",
      perdida: "perdida",
      perdido: "perdida",
      anulada: "anulada",
      anulado: "anulada",
    }),
    inactivity: Object.freeze([
      "desactivada",
      "desactivado",
      "pendiente de activacion",
    ]),
  }),
  operationPolicy: Object.freeze({
    sourceChannel: "coach",
    allowedKinds: Object.freeze([
      "activity",
      "stage_answer",
      "lead_call_outcome",
      "account_field",
      "contact_field",
      "opportunity_field",
    ]),
  }),
  channelRules: Object.freeze({
    scope: "coach",
    crmRecordsConfirmedOnly: true,
    noSharedCoachSession: true,
  }),
  validation: Object.freeze({
    requireEvidence: true,
    requireEntityResolution: true,
    requirePermissionValidation: true,
    allowAmbiguousEntitySelection: false,
  }),
});

const ALLOWED_OPERATION_KINDS = new Set([
  ...COACH_BASE_RULES.operationPolicy.allowedKinds,
  "create_account",
  "create_contact",
  "create_opportunity",
  "link_contact_to_opportunity",
]);
const RULE_CHANNELS = new Set(["coach", "customer_account", "prospect"]);
let ensureCoachBusinessRulesSchemaPromise;
const CUSTOMER_ACCOUNT_PROCESS_MIGRATION =
  "customer_account_single_process_v1";

function canonicalBusinessRulesProcess(channel, process = "default") {
  return channel === "customer_account" ? "default" : process || "default";
}

function mergeRuleConfiguration(base, override) {
  if (
    !base ||
    typeof base !== "object" ||
    Array.isArray(base) ||
    !override ||
    typeof override !== "object" ||
    Array.isArray(override)
  ) {
    return override;
  }
  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] =
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      merged[key] &&
      typeof merged[key] === "object" &&
      !Array.isArray(merged[key])
        ? mergeRuleConfiguration(merged[key], value)
        : value;
  }
  return merged;
}

function parseStoredRules(value) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function normalizeAliasMap(base, overrides) {
  const aliases = { ...base };
  for (const [label, code] of Object.entries(overrides || {})) {
    const normalizedLabel = String(label || "")
      .trim()
      .toLowerCase();
    const normalizedCode = String(code || "")
      .trim()
      .toLowerCase();
    if (normalizedLabel && normalizedCode && normalizedLabel.length <= 80) {
      aliases[normalizedLabel] = normalizedCode;
    }
  }
  return aliases;
}

function normalizeStringList(value, fallback) {
  if (!Array.isArray(value)) return [...fallback];
  return [
    ...new Set(value.map((item) => String(item || "").trim()).filter(Boolean)),
  ];
}

function getChannelBaseRules(channel) {
  if (channel === "customer_account") {
    return {
      ...COACH_BASE_RULES,
      scope: {
        ...COACH_BASE_RULES.scope,
        accountScoped: true,
      },
      operationPolicy: {
        sourceChannel: channel,
        allowedKinds: [
          ...COACH_BASE_RULES.operationPolicy.allowedKinds,
          "create_contact",
        ],
      },
      channelRules: {
        scope: channel,
        accountScoped: true,
        noSharedCoachSession: true,
      },
    };
  }
  if (channel === "prospect") {
    return {
      ...COACH_BASE_RULES,
      scope: {
        ...COACH_BASE_RULES.scope,
        accountScoped: true,
        leadSearchAllowed: false,
        opportunitySearchAllowed: false,
        contactSearchAllowed: false,
        quotationSearchAllowed: false,
      },
      operationPolicy: {
        sourceChannel: channel,
        allowedKinds: [
          "create_account",
          "create_contact",
          "create_opportunity",
        ],
      },
      channelRules: {
        scope: channel,
        prospectScoped: true,
        crmRecordsConfirmedOnly: true,
      },
    };
  }
  return COACH_BASE_RULES;
}

async function migrateCustomerAccountBusinessRules(connection) {
  const execute = async (sql, params = []) => {
    const [rows] = await connection.query(sql, params);
    return rows;
  };
  const migrations = await execute(
    `SELECT migration_key FROM mi_coach_business_rule_migrations
     WHERE migration_key = ? LIMIT 1`,
    [CUSTOMER_ACCOUNT_PROCESS_MIGRATION],
  );
  if (migrations.length) return;

  const rows = await execute(
    `SELECT id, process_key, rules_json, updated_by_user_id, created_at, updated_at
     FROM mi_coach_business_rules WHERE channel = ?`,
    ["customer_account"],
  );
  const priority = (row) =>
    row.process_key === "default"
      ? 0
      : row.process_key === "account_chat"
        ? 2
        : 1;
  const orderedRows = [...rows].sort((left, right) => {
    const priorityDifference = priority(left) - priority(right);
    if (priorityDifference) return priorityDifference;
    return String(left.updated_at || "").localeCompare(
      String(right.updated_at || ""),
    );
  });
  const mergedOverrides = orderedRows.reduce(
    (merged, row) =>
      mergeRuleConfiguration(merged, parseStoredRules(row.rules_json)),
    {},
  );
  const preferredUser = [...orderedRows]
    .reverse()
    .find((row) => row.updated_by_user_id)?.updated_by_user_id;

  await execute(
    `INSERT IGNORE INTO mi_coach_business_rule_migrations
       (migration_key, snapshot_json)
     VALUES (?, ?)`,
    [CUSTOMER_ACCOUNT_PROCESS_MIGRATION, JSON.stringify(rows)],
  );
  if (rows.length) {
    const normalized = normalizeCoachBusinessRules({
      channel: "customer_account",
      process: "default",
      overrides: mergedOverrides,
    });
    await execute(
      `INSERT INTO mi_coach_business_rules
         (channel, process_key, rules_json, updated_by_user_id, created_at, updated_at)
       VALUES (?, 'default', ?, ?, NOW(3), NOW(3))
       ON DUPLICATE KEY UPDATE
         rules_json = VALUES(rules_json),
         updated_by_user_id = VALUES(updated_by_user_id),
         updated_at = NOW(3)`,
      ["customer_account", JSON.stringify(normalized), preferredUser || null],
    );
    await execute(
      `DELETE FROM mi_coach_business_rules
       WHERE channel = ? AND process_key <> 'default'`,
      ["customer_account"],
    );
  }
}

function ensureRulesSchema() {
  if (!ensureCoachBusinessRulesSchemaPromise) {
    ensureCoachBusinessRulesSchemaPromise = (async () => {
      await query(
        `CREATE TABLE IF NOT EXISTS mi_coach_business_rules (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          channel VARCHAR(40) NOT NULL,
          process_key VARCHAR(80) NOT NULL,
          rules_json JSON NOT NULL,
          updated_by_user_id BIGINT UNSIGNED NULL,
          created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
          updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
          CONSTRAINT uq_mi_coach_business_rules_scope UNIQUE (channel, process_key),
          CONSTRAINT fk_mi_coach_business_rules_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
        )`,
      );
      await query(
        `CREATE TABLE IF NOT EXISTS mi_coach_business_rule_migrations (
          migration_key VARCHAR(100) PRIMARY KEY,
          snapshot_json JSON NOT NULL,
          applied_at DATETIME(3) NOT NULL DEFAULT NOW(3)
        )`,
      );
      await withTransaction((connection) =>
        migrateCustomerAccountBusinessRules(connection),
      );
    })().catch((error) => {
      ensureCoachBusinessRulesSchemaPromise = undefined;
      throw error;
    });
  }
  return ensureCoachBusinessRulesSchemaPromise;
}

export function normalizeCoachBusinessRules({
  channel = "coach",
  process = "default",
  overrides = {},
} = {}) {
  if (!RULE_CHANNELS.has(channel))
    throw new Error("Canal de reglas no soportado");
  const normalizedProcess = String(
    canonicalBusinessRulesProcess(channel, process),
  )
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9_-]{1,80}$/.test(normalizedProcess)) {
    throw new Error("Proceso de reglas invalido");
  }
  const baseRules = getChannelBaseRules(channel);
  const channelOperationKinds = new Set(baseRules.operationPolicy.allowedKinds);
  if (channel === "customer_account") {
    channelOperationKinds.add("create_opportunity");
    channelOperationKinds.add("link_contact_to_opportunity");
  }
  const requestedOperationKinds = normalizeStringList(
    overrides.operationPolicy?.allowedKinds,
    baseRules.operationPolicy.allowedKinds,
  );
  const allowedKinds = requestedOperationKinds.filter(
    (kind) =>
      ALLOWED_OPERATION_KINDS.has(kind) && channelOperationKinds.has(kind),
  );
  const filters = {
    ...COACH_BASE_RULES.filters,
    ...(overrides.filters || {}),
    defaultRequireEvidence: true,
  };
  if (filters.defaultActiveOnly && filters.defaultInactiveOnly) {
    filters.defaultInactiveOnly = false;
  }
  const scope = {
    ...baseRules.scope,
    ...(overrides.scope || {}),
    requireContextForOperation: true,
    requireBusinessEvidence: true,
    requirePermissionValidation: true,
  };
  for (const key of [
    "accountSearchAllowed",
    "leadSearchAllowed",
    "opportunitySearchAllowed",
    "contactSearchAllowed",
  ]) {
    if (baseRules.scope[key] === false) scope[key] = false;
  }
  if (baseRules.scope.accountScoped) scope.accountScoped = true;
  const channelRules = {
    ...baseRules.channelRules,
    ...(overrides.channelRules || {}),
    scope: channel,
  };
  for (const key of [
    "accountScoped",
    "prospectScoped",
    "crmRecordsConfirmedOnly",
    "noSharedCoachSession",
  ]) {
    if (baseRules.channelRules[key] === true) channelRules[key] = true;
  }
  return {
    channel,
    process: normalizedProcess,
    operationPolicy: {
      ...baseRules.operationPolicy,
      ...(overrides.operationPolicy || {}),
      sourceChannel: channel,
      allowedKinds,
    },
    channelRules,
    filters,
    scope,
    aliases: {
      stage: {
        ...normalizeAliasMap(
          COACH_BASE_RULES.aliases.stage,
          overrides.aliases?.stage,
        ),
      },
      opportunityStatus: {
        ...normalizeAliasMap(
          COACH_BASE_RULES.aliases.opportunityStatus,
          overrides.aliases?.opportunityStatus,
        ),
      },
      inactivity: normalizeStringList(
        overrides.aliases?.inactivity,
        COACH_BASE_RULES.aliases.inactivity,
      ),
    },
    validation: {
      ...baseRules.validation,
      ...(overrides.validation || {}),
      requireEvidence: true,
      requireEntityResolution: true,
      requirePermissionValidation: true,
      allowAmbiguousEntitySelection: false,
    },
  };
}

export function getCoachBusinessRules({
  channel = "coach",
  process = "default",
  overrides = {},
} = {}) {
  return normalizeCoachBusinessRules({ channel, process, overrides });
}

export async function loadCoachBusinessRulesWithSource({
  channel = "coach",
  process = "default",
} = {}) {
  process = canonicalBusinessRulesProcess(channel, process);
  await ensureRulesSchema();
  const exactRows = await query(
    `SELECT rules_json FROM mi_coach_business_rules
     WHERE channel = ? AND process_key = ? LIMIT 1`,
    [channel, process],
  );
  let rows = exactRows;
  let sourceProcess = exactRows.length ? process : null;
  if (!rows.length && process !== "default") {
    rows = await query(
      `SELECT rules_json FROM mi_coach_business_rules
       WHERE channel = ? AND process_key = 'default' LIMIT 1`,
      [channel],
    );
    if (rows.length) sourceProcess = "default";
  }
  let overrides = {};
  try {
    overrides = rows[0]?.rules_json
      ? typeof rows[0].rules_json === "string"
        ? JSON.parse(rows[0].rules_json)
        : rows[0].rules_json
      : {};
  } catch {
    overrides = {};
  }
  return {
    businessRules: getCoachBusinessRules({ channel, process, overrides }),
    configurationSource: {
      sourceProcess,
      hasSavedOverride: Boolean(rows.length),
      inheritedFromDefault: process !== "default" && !exactRows.length,
    },
  };
}

export async function loadCoachBusinessRules(options = {}) {
  const { businessRules } = await loadCoachBusinessRulesWithSource(options);
  return businessRules;
}

export async function saveCoachBusinessRules({
  user,
  channel = "coach",
  process = "default",
  rules = {},
} = {}) {
  process = canonicalBusinessRulesProcess(channel, process);
  const normalized = normalizeCoachBusinessRules({
    channel,
    process,
    overrides: rules,
  });
  await ensureRulesSchema();
  await query(
    `INSERT INTO mi_coach_business_rules
      (channel, process_key, rules_json, updated_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, NOW(3), NOW(3))
     ON DUPLICATE KEY UPDATE
       rules_json = VALUES(rules_json),
       updated_by_user_id = VALUES(updated_by_user_id),
       updated_at = NOW(3)`,
    [channel, process, JSON.stringify(normalized), Number(user?.id) || null],
  );
  return normalized;
}

export async function resetCoachBusinessRules({
  channel = "coach",
  process = "default",
} = {}) {
  if (!RULE_CHANNELS.has(channel))
    throw new Error("Canal de reglas no soportado");
  const normalizedProcess = String(
    canonicalBusinessRulesProcess(channel, process),
  )
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9_-]{1,80}$/.test(normalizedProcess)) {
    throw new Error("Proceso de reglas invalido");
  }
  await ensureRulesSchema();
  await query(
    `DELETE FROM mi_coach_business_rules WHERE channel = ? AND process_key = ?`,
    [channel, normalizedProcess],
  );
  return loadCoachBusinessRules({ channel, process: normalizedProcess });
}

export function getCoachBusinessRuleSummary({
  channel = "coach",
  process = "default",
  overrides = {},
} = {}) {
  const rules = getCoachBusinessRules({
    channel,
    process: canonicalBusinessRulesProcess(channel, process),
    overrides,
  });
  return {
    channel: rules.channel,
    process: rules.process,
    scope: rules.scope,
    filters: rules.filters,
    operationPolicy: rules.operationPolicy,
    channelRules: rules.channelRules,
    validation: rules.validation,
    aliases: rules.aliases,
  };
}
