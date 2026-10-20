import { query } from "../db.js";
import { loadCoachBusinessRules } from "./business-rules.js";
import { loadChannelIntentConfigurations } from "./channel-intent-governance.js";
import { hasAnyPermission } from "./operation-policy.js";

const denied = (status, message) => Object.assign(new Error(message), { status, code: "COACH_LINK_INVALID" });
export async function readCustomerLinkPair({ user, accountId, opportunityId, contactId, execute = query, lock = false }) {
  if (![accountId, opportunityId, contactId].every((id) => Number.isSafeInteger(id) && id > 0)) throw denied(400, "Extremos del vínculo inválidos");
  for (const domain of ["cuentas", "contactos", "oportunidades"]) {
    if (!hasAnyPermission(user, [`${domain}.read`, `${domain}.read_all`])) throw denied(403, "No tienes permisos para leer ambos extremos y su cuenta");
  }
  const accounts = await execute(
    `SELECT a.id, a.name AS accountName FROM accounts a INNER JOIN account_activation_statuses s ON s.id=a.activation_status_id
     WHERE a.id=? AND s.code='activada' AND (?=1 OR EXISTS
       (SELECT 1 FROM account_owners ao WHERE ao.account_id=a.id AND ao.user_id=?)) LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [accountId, hasAnyPermission(user, ["cuentas.read_all"]) ? 1 : 0, Number(user.id)],
  );
  if (!accounts.length) throw denied(404, "La cuenta fija ya no está disponible");
  const opportunities = await execute(
    `SELECT o.id, o.name AS opportunityName, o.contact_id AS currentContactId, s.code AS commercialStatusCode
     FROM opportunities o INNER JOIN opportunity_commercial_statuses s ON s.id=o.commercial_status_id
     WHERE o.id=? AND o.account_id=? LIMIT 1${lock ? " FOR UPDATE" : ""}`, [opportunityId, accountId],
  );
  if (!opportunities.length) throw denied(404, "La oportunidad no está disponible en la cuenta fija");
  const commercialStatusCode = opportunities[0].commercialStatusCode;
  if (["perdida", "anulada"].includes(commercialStatusCode) ||
      (commercialStatusCode === "ganada" &&
        (!hasAnyPermission(user, ["oportunidades.update"]) ||
          !hasAnyPermission(user, ["oportunidades.update_won"])))) {
    throw denied(422, "No tienes permiso para modificar esta oportunidad cerrada");
  }
  const contacts = await execute(
    `SELECT c.id, CONCAT_WS(' ',c.first_name,c.last_name) AS contactName FROM contacts c
     INNER JOIN contact_activation_statuses s ON s.id=c.activation_status_id
     WHERE c.id=? AND c.account_id=? AND s.code='activado' LIMIT 1${lock ? " FOR UPDATE" : ""}`, [contactId, accountId],
  );
  if (!contacts.length) throw denied(404, "El contacto no está activado o ya no pertenece a la cuenta fija");
  const currentContactId = Number(opportunities[0].currentContactId || 0) || null;
  let currentContactName = null;
  if (currentContactId) {
    const current = await execute(
      "SELECT CONCAT_WS(' ',first_name,last_name) AS name FROM contacts WHERE id=? AND account_id=? LIMIT 1",
      [currentContactId, accountId],
    );
    currentContactName = current[0]?.name || "Contacto asociado no disponible";
  }
  return { ...opportunities[0], accountName: accounts[0].accountName, currentContactId, contactName: contacts[0].contactName, currentContactName };
}

export async function checkCustomerLinkAccess(user, operation, { execute = query, lock = false, compareCurrent = true } = {}) {
  if (!operation?.linkDraftId) return null;
  const fail = (status, message) => ({ status, message });
  if (operation.kind !== "link_contact_to_opportunity" || operation.sourceChannel !== "customer_account" ||
      operation.payload?.accountId !== operation.accountId || operation.payload?.contactId !== operation.contactId) {
    return fail(400, "La identidad del vínculo no coincide con su cuenta fija");
  }
  const rules = await loadCoachBusinessRules({ channel: "customer_account", process: "default" });
  const intents = await loadChannelIntentConfigurations({ channel: "customer_account" });
  if (!rules.operationPolicy.allowedKinds.includes(operation.kind) ||
      rules.scope?.contactSearchAllowed === false || rules.scope?.opportunitySearchAllowed === false ||
      intents.some((intent) => intent.code === "crm_operation" && intent.enabled === false)) return fail(409, "A04 está deshabilitado por política");
  if (!hasAnyPermission(user, ["mi_coach.execute"]) || !hasAnyPermission(user, ["oportunidades.update"])) return fail(403, "No tienes permisos para continuar con este vínculo");
  const rows = await execute(
    `SELECT context_json FROM customer_intelligence_chat_sessions WHERE requested_by_user_id=? AND account_id=?
     AND JSON_UNQUOTE(JSON_EXTRACT(context_json,'$.linkMemory.draftId'))=? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [Number(user.id), operation.accountId, operation.linkDraftId],
  );
  const context = typeof rows[0]?.context_json === "string" ? JSON.parse(rows[0].context_json) : rows[0]?.context_json;
  const memory = context?.linkMemory;
  if (!memory || memory.revision !== operation.linkRevision || memory.accountId !== operation.accountId ||
      memory.opportunityId !== operation.opportunityId || memory.contactId !== operation.contactId ||
      !memory.observed || memory.currentContactId !== operation.currentContactId ||
      !["assign", "replace"].includes(memory.intent)) return fail(409, "Este borrador fue cancelado, corregido o sustituido. Revisa el vínculo vigente en el chat");
  try {
    const pair = await readCustomerLinkPair({ user, accountId: operation.accountId, opportunityId: operation.opportunityId,
      contactId: operation.contactId, execute, lock });
    if (compareCurrent && pair.currentContactId !== operation.currentContactId) return fail(409, "El contacto asociado cambió. Vuelve al chat y revisa la relación actual antes de sustituirla");
    if (compareCurrent && (!operation.linkSummary || operation.linkSummary.accountName !== pair.accountName ||
        operation.linkSummary.opportunityName !== pair.opportunityName ||
        operation.linkSummary.contactName !== pair.contactName || operation.linkSummary.currentContactName !== pair.currentContactName ||
        operation.linkSummary.effect !== (pair.currentContactId ? "replace" : "assign"))) {
      return fail(409, "La descripción del vínculo cambió. Actualiza la propuesta desde el chat antes de continuar");
    }
  } catch (error) {
    if (!error.status) throw error;
    return fail(error.status, error.message);
  }
  return null;
}
