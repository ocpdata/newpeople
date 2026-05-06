import { query } from "./db.js";

const RETENTION_MONTHS = 12;
const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;
let lastPurgeAt = 0;

function stableStringify(value) {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  const parts = keys.map(
    (key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`,
  );
  return `{${parts.join(",")}}`;
}

function isDifferent(left, right) {
  return stableStringify(left) !== stableStringify(right);
}

function asPlainRecord(value) {
  if (!value || typeof value !== "object") return {};
  return value;
}

export function parseAuditChangedFields(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" ? value : {};
}

export function buildChangedFields(beforeValue, afterValue) {
  const before = asPlainRecord(beforeValue);
  const after = asPlainRecord(afterValue);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes = {};

  for (const key of keys) {
    const previous = before[key];
    const next = after[key];
    if (!isDifferent(previous, next)) continue;
    changes[key] = {
      before: previous === undefined ? null : previous,
      after: next === undefined ? null : next,
    };
  }

  return changes;
}

function shorten(text, maxLength = 255) {
  const value = String(text || "").trim();
  if (!value) return null;
  return value.length > maxLength
    ? `${value.slice(0, maxLength - 1)}...`
    : value;
}

async function purgeExpiredAuditLogs() {
  await query(
    `DELETE FROM audit_log
     WHERE created_at < (NOW(3) - INTERVAL ? MONTH)`,
    [RETENTION_MONTHS],
  );
}

async function maybePurgeExpiredAuditLogs() {
  const now = Date.now();
  if (now - lastPurgeAt < PURGE_INTERVAL_MS) return;

  lastPurgeAt = now;
  try {
    await purgeExpiredAuditLogs();
  } catch (error) {
    console.error("Audit retention purge error:", error?.message || error);
  }
}

function resolveActor(req, fallbackActor) {
  const actor = fallbackActor || req?.user || null;
  return {
    id: Number(actor?.id) || null,
    name: actor?.full_name || actor?.name || null,
    email: actor?.email || null,
  };
}

export async function logAuditEvent({
  req,
  actor,
  module,
  action,
  entityType,
  entityId = null,
  detail = null,
  before = null,
  after = null,
  status = "success",
}) {
  if (!module || !action || !entityType) return;

  const actorData = resolveActor(req, actor);
  const changedFields = buildChangedFields(before, after);
  const changesJson = Object.keys(changedFields).length
    ? JSON.stringify(changedFields)
    : null;
  const safeStatus = status === "error" ? "error" : "success";

  await maybePurgeExpiredAuditLogs();

  try {
    await query(
      `INSERT INTO audit_log
         (module, action, entity_type, entity_id, status, detail, changed_fields,
          performed_by_user_id, performed_by_name, performed_by_email,
          ip_address, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        module,
        action,
        entityType,
        entityId === null ? null : Number(entityId),
        safeStatus,
        shorten(detail),
        changesJson,
        actorData.id,
        actorData.name,
        actorData.email,
        shorten(req?.ip || null, 64),
        shorten(req?.headers?.["user-agent"] || null, 500),
        new Date(),
      ],
    );
  } catch (error) {
    console.error("Audit log insert error:", error?.message || error);
  }
}

export async function startAuditRetentionJob() {
  try {
    await purgeExpiredAuditLogs();
  } catch (error) {
    console.error("Initial audit purge error:", error?.message || error);
  }

  setInterval(async () => {
    try {
      await purgeExpiredAuditLogs();
    } catch (error) {
      console.error("Scheduled audit purge error:", error?.message || error);
    }
  }, PURGE_INTERVAL_MS);
}
