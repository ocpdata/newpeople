import { query } from "../db.js";
import { loadCoachBusinessRules } from "./business-rules.js";
import { loadChannelIntentConfigurations } from "./channel-intent-governance.js";
import { getDelegatedCoachOperationPermissions, hasAnyPermission } from "./operation-policy.js";

export async function checkCustomerCreationAccess(user, operation) {
  if (operation?.sourceChannel !== "customer_account" ||
      !["create_contact", "create_opportunity"].includes(operation.kind)) return null;
  const rules = await loadCoachBusinessRules({ channel: "customer_account", process: "default" });
  const intents = await loadChannelIntentConfigurations({ channel: "customer_account" });
  if (!rules.operationPolicy.allowedKinds.includes(operation.kind) ||
      intents.some((intent) => intent.code === "crm_operation" && intent.enabled === false)) {
    return { status: 409, message: "La creación está deshabilitada para Cliente existente. No se creó ningún registro." };
  }
  if (!hasAnyPermission(user, ["mi_coach.execute"]) ||
      !hasAnyPermission(user, getDelegatedCoachOperationPermissions(operation.kind) || [])) {
    return { status: 403, message: "Tu perfil ya no permite continuar con esta creación." };
  }
  const accountId = Number(operation.accountId);
  if (!Number.isInteger(accountId) || accountId <= 0 || Number(operation.payload?.accountId) !== accountId) {
    return { status: 400, message: "La cuenta del borrador no coincide con su cuenta fija." };
  }
  const accounts = await query(
    `SELECT a.id FROM accounts a
     INNER JOIN account_activation_statuses aas ON aas.id = a.activation_status_id
     WHERE a.id = ? AND aas.code = 'activada'
       AND (? = 1 OR EXISTS (
         SELECT 1 FROM account_owners ao WHERE ao.account_id = a.id AND ao.user_id = ?
       )) LIMIT 1`,
    [accountId, hasAnyPermission(user, ["cuentas.read_all"]) ? 1 : 0, Number(user.id)],
  );
  if (!accounts.length || !hasAnyPermission(user, ["cuentas.read", "cuentas.read_all"])) {
    return { status: 404, message: "La cuenta fija ya no está disponible para este usuario." };
  }
  if (operation.creationDraftId) {
    const drafts = await query(
      `SELECT CAST(JSON_UNQUOTE(JSON_EXTRACT(context_json, '$.creationMemory.revision')) AS UNSIGNED) AS revision
       FROM customer_intelligence_chat_sessions
       WHERE requested_by_user_id = ? AND account_id = ?
         AND JSON_UNQUOTE(JSON_EXTRACT(context_json, '$.creationMemory.draftId')) = ?
       LIMIT 1`,
      [Number(user.id), accountId, operation.creationDraftId],
    );
    if (!drafts.length || Number(drafts[0].revision) !== Number(operation.creationRevision)) {
      return { status: 409, message: "Este borrador fue cancelado, sustituido o modificado. Revisa la propuesta vigente en el chat." };
    }
  }
  const contactId = Number(operation.payload?.contactId || operation.contactId || 0);
  if (contactId) {
    if (operation.kind !== "create_opportunity" ||
        !hasAnyPermission(user, ["contactos.read", "contactos.read_all"]) ||
        rules.scope?.contactSearchAllowed === false ||
        (operation.contactId && Number(operation.contactId) !== contactId)) {
      return { status: 403, message: "El contacto del borrador no está autorizado." };
    }
    const contacts = await query("SELECT id FROM contacts WHERE id = ? AND account_id = ? LIMIT 1", [contactId, accountId]);
    if (!contacts.length) return { status: 404, message: "El contacto ya no pertenece a la cuenta fija." };
  }
  return null;
}
