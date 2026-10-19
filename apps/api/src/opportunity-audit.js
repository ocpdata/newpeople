import { withTransaction } from "./db.js";
import { logAuditEvent } from "./audit.js";

export const HISTORY_FIELDS = Object.freeze([
  "name", "account_id", "amount_usd", "sales_stage_id", "commercial_status_id",
  "activation_status_id", "close_date", "commercial_closed_at", "seller_user_id",
  "presales_user_id", "created_by", "created_at",
]);
export const COMMERCIAL_AUDIT_ACTIONS = Object.freeze([
  "commercial_history_created", "commercial_history_changed", "commercial_history_deleted", "commercial_history_baseline",
]);

function captureState(row) {
  if (!row) return null;
  const date = (value) => value instanceof Date
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")} ${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}:${String(value.getSeconds()).padStart(2, "0")}`
    : value ?? null;
  return Object.fromEntries([...HISTORY_FIELDS, "contact_id"].map((field) => [field,
    field === "close_date" ? date(row[field])?.slice(0, 10) :
      ["created_at", "commercial_closed_at"].includes(field) ? date(row[field]) : row[field] ?? null]));
}

export async function recordOpportunityAuditState({ connection, opportunityId, kind, before, after, req, actor }) {
  return logAuditEvent({
    connection, required: true, req, actor,
    module: "oportunidades", action: `commercial_history_${kind}`,
    entityType: "opportunity", entityId: opportunityId,
    detail: "Historia comercial transaccional",
    after: { commercial_history: {
      version: 1, kind, recorded_at_utc: new Date().toISOString(),
      before_state: captureState(before), after_state: captureState(after),
    } },
  });
}

export async function mutateAuditedOpportunity({ connection = null, opportunityId = null, req, actor }, sql, params) {
  const mutate = async (conn) => {
    let before = null;
    if (opportunityId !== null) {
      const [rows] = await conn.query("SELECT * FROM opportunities WHERE id=? FOR UPDATE", [opportunityId]);
      if (!rows[0]) throw Object.assign(new Error("La oportunidad no existe para registrar su cambio."), { status: 404 });
      before = rows[0];
    }
    const [result] = await conn.query(sql, params);
    const id = opportunityId ?? Number(result.insertId);
    if (!id) throw new Error("La escritura no identifico una oportunidad para auditar.");
    const [rows] = await conn.query("SELECT * FROM opportunities WHERE id=?", [id]);
    const after = rows[0] || null;
    if (!before && !after) throw new Error("No se pudo leer el estado de la oportunidad creada para auditarla.");
    if (JSON.stringify(captureState(before)) !== JSON.stringify(captureState(after))) {
      await recordOpportunityAuditState({
        connection: conn, opportunityId: id, req, actor, before, after,
        kind: before ? after ? "changed" : "deleted" : "created",
      });
    }
    return result;
  };
  return connection ? mutate(connection) : withTransaction(mutate);
}
