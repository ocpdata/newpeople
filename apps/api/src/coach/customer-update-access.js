import { query } from "../db.js";
import { CUSTOMER_UPDATE_FIELDS, normalizeCustomerUpdateValue } from "./customer-field-values.js";
import { loadCoachBusinessRules } from "./business-rules.js";
import { loadChannelIntentConfigurations } from "./channel-intent-governance.js";
import { hasAnyPermission } from "./operation-policy.js";

const domains = { account: "cuentas", contact: "contactos", opportunity: "oportunidades" };
const tables = { account: "accounts", contact: "contacts", opportunity: "opportunities" };
export async function readCustomerUpdateRecord({ user, object, accountId, targetId, execute = query, lock = false }) {
  if (!CUSTOMER_UPDATE_FIELDS[object] || !Number.isSafeInteger(targetId) || targetId <= 0 ||
      !Number.isSafeInteger(accountId) || accountId <= 0) throw Object.assign(new Error("Destino A02 inválido"), { status: 400 });
  const domain = domains[object];
  if (!hasAnyPermission(user, ["cuentas.read", "cuentas.read_all"]) ||
      !hasAnyPermission(user, [`${domain}.read`, `${domain}.read_all`])) {
    throw Object.assign(new Error("No tienes permisos para leer el valor actual de este registro"), { status: 403 });
  }
  const columns = Object.entries(CUSTOMER_UPDATE_FIELDS[object]).map(([field, [column]]) => `r.${column} AS \`${field}\``).join(", ");
  const rows = await execute(
    `SELECT r.id, ${columns}${object === "opportunity" ? ", s.code AS commercialStatusCode" : ""}
     FROM ${tables[object]} r
     INNER JOIN accounts a ON a.id = ${object === "account" ? "r.id" : "r.account_id"}
     INNER JOIN account_activation_statuses aas ON aas.id = a.activation_status_id
     ${object === "opportunity" ? "INNER JOIN opportunity_commercial_statuses s ON s.id = r.commercial_status_id" : ""}
     WHERE r.id = ? AND ${object === "account" ? "r.id" : "r.account_id"} = ? AND aas.code = 'activada'
       AND (? = 1 OR EXISTS (SELECT 1 FROM account_owners ao WHERE ao.account_id = ? AND ao.user_id = ?))
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [targetId, accountId, hasAnyPermission(user, ["cuentas.read_all"]) ? 1 : 0, accountId, Number(user.id)],
  );
  if (!rows.length) throw Object.assign(new Error("El registro no está disponible dentro de la cuenta autorizada"), { status: 404 });
  if (object === "opportunity" && ["ganada", "perdida", "anulada"].includes(rows[0].commercialStatusCode)) {
    throw Object.assign(new Error("No puedes modificar una oportunidad cerrada"), { status: 422 });
  }
  return rows[0];
}

export async function loadCustomerUpdateStates({ user, draftId, execute = query }) {
  return execute(
    `SELECT status, pending_operation AS operation FROM coach_session_operations
     WHERE user_id = ? AND JSON_UNQUOTE(JSON_EXTRACT(original_operation, '$.updateDraftId')) = ?
     ORDER BY id`, [Number(user.id), draftId],
  );
}

export async function checkCustomerUpdateAccess(user, operation, { execute = query, lock = false } = {}) {
  if (!operation?.updateDraftId) return null;
  const fail = (status, message) => ({ status, message });
  const object = { account_field: "account", contact_field: "contact", opportunity_field: "opportunity" }[operation.kind];
  if (!object || operation.sourceChannel !== "customer_account") return fail(400, "Tipo de actualización A02 inválido");
  const rules = await loadCoachBusinessRules({ channel: "customer_account", process: "default" });
  const intents = await loadChannelIntentConfigurations({ channel: "customer_account" });
  if (!rules.operationPolicy.allowedKinds.includes(operation.kind) ||
      intents.some((item) => item.code === "crm_operation" && item.enabled === false) ||
      (object !== "account" && rules.scope?.[`${object}SearchAllowed`] === false)) return fail(409, "Esta actualización está deshabilitada en el canal");
  if (!hasAnyPermission(user, ["mi_coach.execute"]) ||
      !hasAnyPermission(user, [`${domains[object]}.update`])) return fail(403, "No tienes permisos para preparar o guardar este cambio");
  const rows = await execute(
    `SELECT context_json FROM customer_intelligence_chat_sessions
     WHERE requested_by_user_id = ? AND account_id = ?
       AND JSON_UNQUOTE(JSON_EXTRACT(context_json, '$.updateMemory.draftId')) = ?
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [Number(user.id), operation.updateAccountId, operation.updateDraftId],
  );
  const context = typeof rows[0]?.context_json === "string" ? JSON.parse(rows[0].context_json) : rows[0]?.context_json;
  const memory = context?.updateMemory;
  const active = memory?.items?.find((item) => item.status === "pending");
  const targetId = operation[`${object}Id`];
  if (!memory || memory.object !== object || memory.targetId !== targetId ||
      memory.accountId !== operation.updateAccountId || memory.revision !== operation.updateRevision ||
      !active || active.id !== operation.updateItemId || active.field !== operation.field || active.action === "pending") {
    return fail(409, "El borrador cambió, fue cancelado o ya no es el cambio vigente. Revisa la propuesta actual");
  }
  let value;
  try { value = normalizeCustomerUpdateValue(object, active.field, active.action === "clear" ? null : active.value); }
  catch (error) { return fail(400, error.message); }
  if (JSON.stringify(value) !== JSON.stringify(operation.value === "" ? null : operation.value)) {
    return fail(409, "El valor fue editado fuera del borrador vigente. Corrígelo en el chat y vuelve a revisarlo");
  }
  try {
    await readCustomerUpdateRecord({ user, object, accountId: memory.accountId, targetId, execute, lock });
  } catch (error) {
    if (!error.status) throw error;
    return fail(error.status, error.message);
  }
  return null;
}
