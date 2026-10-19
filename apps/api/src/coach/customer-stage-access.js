import { query } from "../db.js";
import { hasAnyPermission } from "./operation-policy.js";
import { loadCoachBusinessRules } from "./business-rules.js";
import { loadChannelIntentConfigurations } from "./channel-intent-governance.js";
export const stageError = (status, message) => Object.assign(new Error(message), { status, code: "COACH_STAGE_CONFLICT" });
export const stageVersion = (data, opportunity, next) => JSON.stringify([
  data.accountName, Number(opportunity.id), opportunity.name, Number(opportunity.stageId), opportunity.status,
  next ? [Number(next.id), next.name, next.code, Number(next.stage_order)] : null,
  opportunity.stageName,
]);
export async function readCustomerStages({ user, accountId, execute = query, lock = false }) {
  for (const domain of ["cuentas", "oportunidades"]) {
    if (!hasAnyPermission(user, [`${domain}.read`, `${domain}.read_all`])) throw stageError(403, "Necesitas lectura de cuenta y oportunidades");
  }
  if (!Number.isSafeInteger(accountId) || accountId <= 0) throw stageError(400, "Cuenta inválida");
  const accounts = await execute(`SELECT a.name FROM accounts a INNER JOIN account_activation_statuses s ON s.id=a.activation_status_id
    WHERE a.id=? AND s.code='activada' AND (?=1 OR EXISTS
    (SELECT 1 FROM account_owners ao WHERE ao.account_id=a.id AND ao.user_id=?)) LIMIT 1${lock ? " FOR UPDATE" : ""}`,
  [accountId, hasAnyPermission(user, ["cuentas.read_all"]) ? 1 : 0, Number(user.id)]);
  if (!accounts.length) throw stageError(404, "La cuenta fija no está disponible");
  const opportunities = await execute(`SELECT o.id,o.name,o.sales_stage_id AS stageId,ss.name AS stageName,s.code AS status
    FROM opportunities o INNER JOIN opportunity_sales_stages ss ON ss.id=o.sales_stage_id
    INNER JOIN opportunity_commercial_statuses s ON s.id=o.commercial_status_id
    WHERE o.account_id=? AND (?=1 OR EXISTS
      (SELECT 1 FROM account_owners ao WHERE ao.account_id=o.account_id AND ao.user_id=?))
    ORDER BY o.id LIMIT 1001${lock ? " FOR UPDATE" : ""}`,
  [accountId, hasAnyPermission(user, ["oportunidades.read_all"]) ? 1 : 0, Number(user.id)]);
  if (opportunities.length > 1000) throw stageError(422, "Más de 1000 oportunidades: utiliza Oportunidades para seleccionar sin truncar el conjunto");
  const stages = await execute(`SELECT id,code,name,stage_order FROM opportunity_sales_stages
    WHERE is_active=1 ORDER BY stage_order,id${lock ? " FOR UPDATE" : ""}`, []);
  return { accountName: accounts[0].name, opportunities, stages };
}
export function nextCustomerStage(data, opportunityId) {
  const opportunity = data.opportunities.find((item) => Number(item.id) === opportunityId);
  if (!opportunity) throw stageError(404, "La oportunidad no está disponible en la cuenta fija");
  if (["ganada", "perdida", "anulada"].includes(opportunity.status)) throw stageError(422, "No puedes validar el avance de una oportunidad cerrada");
  const index = data.stages.findIndex((item) => Number(item.id) === Number(opportunity.stageId));
  if (index < 0 || !data.stages[index + 1]) throw stageError(422, "No existe una siguiente etapa operativa disponible");
  return { opportunity, next: data.stages[index + 1] };
}
export async function checkCustomerStageAccess(user, operation, { execute = query, lock = false, compareCurrent = true } = {}) {
  if (operation?.kind !== "validate_stage") return null;
  try {
    if (operation.sourceChannel !== "customer_account" || !operation.stageDraftId ||
        operation.payload?.accountId !== operation.accountId || operation.payload?.opportunityId !== operation.opportunityId) {
      throw stageError(400, "Identidad de la solicitud de validación inválida");
    }
    for (const permission of ["mi_coach.access", "inteligencia_comercial.access", "mi_coach.execute", "oportunidades.update"]) {
      if (!hasAnyPermission(user, [permission])) throw stageError(403, "No tienes permisos para continuar con la validación");
    }
    const rules = await loadCoachBusinessRules({ channel: "customer_account", process: "default" });
    const intents = await loadChannelIntentConfigurations({ channel: "customer_account" });
    if (!rules.operationPolicy.allowedKinds.includes("validate_stage") || rules.scope?.opportunitySearchAllowed === false ||
        intents.some((intent) => intent.code === "crm_operation" && !intent.enabled)) throw stageError(409, "A08 está deshabilitado por política");
    const data = await readCustomerStages({ user, accountId: operation.accountId, execute, lock });
    if (!data.opportunities.some((item) => Number(item.id) === operation.opportunityId)) throw stageError(404, "La oportunidad ya no pertenece a la cuenta fija");
    if (!compareCurrent) return null;
    const rows = await execute(`SELECT context_json FROM customer_intelligence_chat_sessions WHERE requested_by_user_id=? AND account_id=?
      AND JSON_UNQUOTE(JSON_EXTRACT(context_json,'$.stageMemory.draftId'))=? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [Number(user.id), operation.accountId, operation.stageDraftId]);
    const context = typeof rows[0]?.context_json === "string" ? JSON.parse(rows[0].context_json) : rows[0]?.context_json;
    const memory = context?.stageMemory;
    if (!memory || memory.accountId !== operation.accountId || memory.opportunityId !== operation.opportunityId ||
        memory.revision !== operation.stageRevision || memory.observedVersion !== operation.stageObservedVersion ||
        !["advance", "validate_advance"].includes(memory.request)) throw stageError(409, "La solicitud fue corregida o descartada. Retoma la propuesta vigente");
    const { opportunity, next } = nextCustomerStage(data, operation.opportunityId);
    if (stageVersion(data, opportunity, next) !== operation.stageObservedVersion ||
        operation.stageSummary.accountName !== data.accountName || operation.stageSummary.opportunityName !== opportunity.name ||
        operation.stageSummary.currentStageId !== Number(opportunity.stageId) || operation.stageSummary.currentStageName !== opportunity.stageName ||
        operation.stageSummary.targetStageId !== Number(next.id) || operation.stageSummary.targetStageName !== next.name) {
      throw stageError(409, "La etapa, estado o destino cambiaron. Actualiza la solicitud en el chat");
    }
    return null;
  } catch (error) {
    if (error.code !== "COACH_STAGE_CONFLICT") throw error;
    return { status: error.status, message: error.message };
  }
}
