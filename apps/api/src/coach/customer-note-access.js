import { query } from "../db.js";
import { loadCoachBusinessRules } from "./business-rules.js";
import { loadChannelIntentConfigurations } from "./channel-intent-governance.js";
import { hasAnyPermission } from "./operation-policy.js";

const fail = (status, message) => Object.assign(new Error(message), { status });

export async function readCustomerOpportunityForNotes({
  user,
  accountId,
  opportunityId,
  execute = query,
  lock = false,
}) {
  if (
    !Number.isSafeInteger(Number(accountId)) ||
    Number(accountId) <= 0 ||
    !Number.isSafeInteger(Number(opportunityId)) ||
    Number(opportunityId) <= 0
  ) {
    throw fail(400, "La cuenta y la oportunidad deben estar identificadas");
  }
  if (
    !hasAnyPermission(user, ["cuentas.read", "cuentas.read_all"]) ||
    !hasAnyPermission(user, ["oportunidades.read", "oportunidades.read_all"])
  ) {
    throw fail(403, "No tienes permisos para consultar las notas de esta oportunidad");
  }
  const rules = await loadCoachBusinessRules({
    channel: "customer_account",
    process: "default",
  });
  const intents = await loadChannelIntentConfigurations({
    channel: "customer_account",
  });
  if (
    rules.scope?.opportunitySearchAllowed === false ||
    intents.some(
      (intent) =>
        intent.code === "opportunity_status" && intent.enabled === false,
    )
  ) {
    throw fail(409, "La consulta de notas está deshabilitada en este canal");
  }
  const globalScope = hasAnyPermission(user, ["cuentas.read_all"]);
  const rows = await execute(
    `SELECT o.id, o.account_id AS accountId, o.name AS opportunityName,
            a.name AS accountName
     FROM opportunities o
     INNER JOIN accounts a ON a.id = o.account_id
     INNER JOIN account_activation_statuses aas ON aas.id = a.activation_status_id
     WHERE o.id = ? AND o.account_id = ? AND aas.code = 'activada'
       AND (? = 1 OR EXISTS (
         SELECT 1 FROM account_owners ao
         WHERE ao.account_id = a.id AND ao.user_id = ?
       ))
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [Number(opportunityId), Number(accountId), globalScope ? 1 : 0, Number(user.id)],
  );
  if (!rows.length) {
    throw fail(404, "La oportunidad ya no está disponible en la cuenta autorizada");
  }
  return rows[0];
}

export async function checkCustomerNoteAccess(
  user,
  operation,
  { execute = query, lock = false } = {},
) {
  if (operation?.kind !== "opportunity_note") return null;
  if (
    operation.sourceChannel !== "customer_account" ||
    !Number.isSafeInteger(Number(operation.accountId)) ||
    !Number.isSafeInteger(Number(operation.opportunityId)) ||
    !String(operation.noteText || "").trim()
  ) {
    return { status: 400, message: "La operación de nota no es válida para Cliente existente" };
  }
  const rules = await loadCoachBusinessRules({
    channel: "customer_account",
    process: "default",
  });
  const intents = await loadChannelIntentConfigurations({
    channel: "customer_account",
  });
  if (
    !rules.operationPolicy.allowedKinds.includes("opportunity_note") ||
    rules.scope?.opportunitySearchAllowed === false ||
    intents.some(
      (intent) => intent.code === "crm_operation" && intent.enabled === false,
    )
  ) {
    return { status: 409, message: "El registro de notas está deshabilitado en este canal" };
  }
  if (
    !hasAnyPermission(user, ["mi_coach.execute"]) ||
    !hasAnyPermission(user, ["oportunidades.update"])
  ) {
    return { status: 403, message: "No tienes permisos para guardar una nota en esta oportunidad" };
  }
  try {
    await readCustomerOpportunityForNotes({
      user,
      accountId: Number(operation.accountId),
      opportunityId: Number(operation.opportunityId),
      execute,
      lock,
    });
  } catch (error) {
    if (!error.status) throw error;
    return { status: error.status, message: error.message };
  }
  return null;
}
