import { query, withTransaction } from "../db.js";
import {
  classifyChannelIntent,
  getChannelIntentDefaults,
} from "./channel-intents.js";

const ROUTABLE_CHANNELS = new Set(["customer_account", "prospect"]);
const ALLOWED_CONTEXT_KEYS = new Set([
  "account",
  "opportunity",
  "contact",
  "prospectSession",
]);
const CHANNEL_CONTEXT_KEYS = {
  customer_account: new Set(["account", "opportunity", "contact"]),
  prospect: new Set(["prospectSession"]),
};
let ensureChannelIntentSchemaPromise;

function configurationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function assertChannel(channel) {
  if (!ROUTABLE_CHANNELS.has(channel)) {
    throw configurationError("Canal de enrutamiento no configurable");
  }
}

function normalizeExamples(value, fallback) {
  if (!Array.isArray(value)) return [...fallback];
  const examples = [
    ...new Set(
      value
        .map((item) =>
          String(item || "")
            .trim()
            .replace(/\s+/g, " "),
        )
        .filter(Boolean),
    ),
  ];
  if (
    !examples.length ||
    examples.length > 30 ||
    examples.some((item) => item.length > 240)
  ) {
    throw configurationError(
      "Cada intención requiere de 1 a 30 ejemplos de hasta 240 caracteres.",
    );
  }
  return examples;
}

function normalizeConfiguration(channel, defaults, input = {}) {
  const defaultByCode = new Map(defaults.map((item) => [item.code, item]));
  const configured = defaults.map((item) => {
    const value = input[item.code] || {};
    const hardTools = new Set(item.allowedTools);
    const requestedTools = Array.isArray(value.allowedTools)
      ? value.allowedTools.map((tool) => String(tool || "").trim())
      : item.allowedTools;
    const allowedTools = [...new Set(requestedTools)];
    if (allowedTools.some((tool) => !hardTools.has(tool))) {
      throw configurationError(
        `La intención ${item.code} contiene herramientas no permitidas para ${channel}.`,
      );
    }
    const hardContext = new Set(item.requiredContext);
    const requestedContext = Array.isArray(value.requiredContext)
      ? [
          ...new Set(
            value.requiredContext.map((key) => String(key || "").trim()),
          ),
        ]
      : item.requiredContext;
    if (
      requestedContext.some(
        (key) =>
          !ALLOWED_CONTEXT_KEYS.has(key) ||
          !CHANNEL_CONTEXT_KEYS[channel].has(key),
      ) ||
      item.requiredContext.some((key) => !requestedContext.includes(key)) ||
      [...hardContext].some((key) => !requestedContext.includes(key))
    ) {
      throw configurationError(
        `No se pueden eliminar los requisitos de contexto obligatorios de ${item.code}.`,
      );
    }
    const priority = Number.isInteger(Number(value.priority))
      ? Number(value.priority)
      : item.priority;
    if (priority < 0 || priority > 200) {
      throw configurationError("La prioridad debe estar entre 0 y 200.");
    }
    const enabled = value.enabled === undefined ? true : value.enabled === true;
    if (item.code === "account_overview" || item.code === "prospect_profile") {
      if (!enabled) {
        throw configurationError(
          "La intención general de respaldo del canal no se puede desactivar.",
        );
      }
    }
    return {
      code: item.code,
      label: item.label,
      description: item.description,
      examples: normalizeExamples(value.examples, item.examples),
      priority,
      enabled,
      allowedTools,
      requiredContext: requestedContext,
      possibleTools: [...item.allowedTools],
      fixedContext: [...item.requiredContext],
    };
  });
  for (const code of Object.keys(input)) {
    if (!defaultByCode.has(code)) {
      throw configurationError(
        `Intención no reconocida para ${channel}: ${code}`,
      );
    }
  }
  return configured;
}

async function ensureChannelIntentSchema() {
  if (!ensureChannelIntentSchemaPromise) {
    ensureChannelIntentSchemaPromise = (async () => {
      await query(
        `CREATE TABLE IF NOT EXISTS mi_channel_intent_configurations (
          channel VARCHAR(40) NOT NULL,
          intent_code VARCHAR(80) NOT NULL,
          configuration_json JSON NOT NULL,
          updated_by_user_id BIGINT UNSIGNED NULL,
          updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
          PRIMARY KEY (channel, intent_code),
          CONSTRAINT fk_mi_channel_intent_config_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
        )`,
      );
      await query(
        `CREATE TABLE IF NOT EXISTS mi_channel_intent_revisions (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          channel VARCHAR(40) NOT NULL,
          snapshot_json JSON NOT NULL,
          changed_by_user_id BIGINT UNSIGNED NULL,
          restored_from_revision_id BIGINT UNSIGNED NULL,
          created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
          INDEX idx_mi_channel_intent_revisions_channel (channel, created_at),
          CONSTRAINT fk_mi_channel_intent_revision_user FOREIGN KEY (changed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
        )`,
      );
    })().catch((error) => {
      ensureChannelIntentSchemaPromise = undefined;
      throw error;
    });
  }
  await ensureChannelIntentSchemaPromise;
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export async function loadChannelIntentConfigurations({ channel } = {}) {
  assertChannel(channel);
  await ensureChannelIntentSchema();
  const defaults = getChannelIntentDefaults(channel);
  const rows = await query(
    `SELECT intent_code, configuration_json
     FROM mi_channel_intent_configurations WHERE channel = ?`,
    [channel],
  );
  const overrides = Object.fromEntries(
    rows.map((row) => [row.intent_code, parseJson(row.configuration_json, {})]),
  );
  return normalizeConfiguration(channel, defaults, overrides);
}

export async function updateChannelIntentConfiguration({
  user,
  channel,
  intentCode,
  configuration,
} = {}) {
  assertChannel(channel);
  await ensureChannelIntentSchema();
  const defaults = getChannelIntentDefaults(channel);
  const target = defaults.find((item) => item.code === intentCode);
  if (!target) return null;
  const current = await loadChannelIntentConfigurations({ channel });
  const currentMap = Object.fromEntries(
    current.map(({ possibleTools, fixedContext, ...item }) => [
      item.code,
      item,
    ]),
  );
  const candidateMap = {
    ...currentMap,
    [intentCode]: { ...currentMap[intentCode], ...configuration },
  };
  const normalized = normalizeConfiguration(channel, defaults, candidateMap);
  const nextMap = Object.fromEntries(
    normalized.map(({ possibleTools, fixedContext, ...item }) => [
      item.code,
      item,
    ]),
  );
  const beforeSnapshot = JSON.stringify(currentMap);
  const afterSnapshot = JSON.stringify(nextMap);
  if (beforeSnapshot === afterSnapshot) {
    return {
      catalog: normalized,
      revisions: await listChannelIntentRevisions({ channel }),
    };
  }
  const next = nextMap[intentCode];
  await withTransaction(async (connection) => {
    await connection.query(
      `INSERT INTO mi_channel_intent_revisions
        (channel, snapshot_json, changed_by_user_id, created_at)
       VALUES (?, ?, ?, NOW(3))`,
      [channel, beforeSnapshot, Number(user?.id) || null],
    );
    await connection.query(
      `INSERT INTO mi_channel_intent_configurations
        (channel, intent_code, configuration_json, updated_by_user_id, updated_at)
       VALUES (?, ?, ?, ?, NOW(3))
       ON DUPLICATE KEY UPDATE
         configuration_json = VALUES(configuration_json),
         updated_by_user_id = VALUES(updated_by_user_id),
         updated_at = NOW(3)`,
      [channel, intentCode, JSON.stringify(next), Number(user?.id) || null],
    );
  });
  return {
    catalog: normalized,
    revisions: await listChannelIntentRevisions({ channel }),
  };
}

export async function listChannelIntentRevisions({ channel, limit = 30 } = {}) {
  assertChannel(channel);
  await ensureChannelIntentSchema();
  const rows = await query(
    `SELECT id, changed_by_user_id, restored_from_revision_id, created_at
     FROM mi_channel_intent_revisions WHERE channel = ?
     ORDER BY id DESC LIMIT ?`,
    [channel, Math.max(1, Math.min(100, Number(limit) || 30))],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    changedByUserId: Number(row.changed_by_user_id) || null,
    restoredFromRevisionId: Number(row.restored_from_revision_id) || null,
    createdAt: row.created_at,
  }));
}

export async function restoreChannelIntentRevision({
  user,
  channel,
  revisionId,
} = {}) {
  assertChannel(channel);
  await ensureChannelIntentSchema();
  const revisionRows = await query(
    `SELECT id, snapshot_json FROM mi_channel_intent_revisions
     WHERE id = ? AND channel = ? LIMIT 1`,
    [Number(revisionId), channel],
  );
  if (!revisionRows[0]) return null;
  const current = await loadChannelIntentConfigurations({ channel });
  const currentMap = Object.fromEntries(
    current.map(({ possibleTools, fixedContext, ...item }) => [
      item.code,
      item,
    ]),
  );
  const snapshot = parseJson(revisionRows[0].snapshot_json, {});
  const normalized = normalizeConfiguration(
    channel,
    getChannelIntentDefaults(channel),
    snapshot,
  );
  await withTransaction(async (connection) => {
    await connection.query(
      `INSERT INTO mi_channel_intent_revisions
        (channel, snapshot_json, changed_by_user_id, restored_from_revision_id, created_at)
       VALUES (?, ?, ?, ?, NOW(3))`,
      [
        channel,
        JSON.stringify(currentMap),
        Number(user?.id) || null,
        Number(revisionId),
      ],
    );
    for (const { possibleTools, fixedContext, ...item } of normalized) {
      await connection.query(
        `INSERT INTO mi_channel_intent_configurations
          (channel, intent_code, configuration_json, updated_by_user_id, updated_at)
         VALUES (?, ?, ?, ?, NOW(3))
         ON DUPLICATE KEY UPDATE
           configuration_json = VALUES(configuration_json),
           updated_by_user_id = VALUES(updated_by_user_id),
           updated_at = NOW(3)`,
        [channel, item.code, JSON.stringify(item), Number(user?.id) || null],
      );
    }
  });
  return {
    catalog: normalized,
    revisions: await listChannelIntentRevisions({ channel }),
  };
}

export async function previewChannelIntent({
  channel,
  question,
  availableTools,
  intentCode,
  configuration,
} = {}) {
  let catalog = await loadChannelIntentConfigurations({ channel });
  if (intentCode && configuration) {
    const catalogInput = Object.fromEntries(
      catalog.map(({ possibleTools, fixedContext, ...item }) => [
        item.code,
        item,
      ]),
    );
    catalog = normalizeConfiguration(
      channel,
      getChannelIntentDefaults(channel),
      {
        ...catalogInput,
        [intentCode]: { ...catalogInput[intentCode], ...configuration },
      },
    );
    if (!catalogInput[intentCode]) {
      throw configurationError(
        `Intención no reconocida para ${channel}: ${intentCode}`,
      );
    }
  }
  const classification = classifyChannelIntent({
    channel,
    question,
    availableTools:
      availableTools ||
      catalog.flatMap((item) => item.possibleTools).map((name) => ({ name })),
    context: {},
    configuration: catalog,
  });
  return {
    classification,
    catalog,
    toolsExecuted: [],
  };
}
