import { query } from "../db.js";
import { hasAnyPermission } from "./operation-policy.js";
import { loadCoachBusinessRules } from "./business-rules.js";
import { loadChannelIntentConfigurations } from "./channel-intent-governance.js";
import { COMMERCIAL_ACTIVITY_TYPES } from "../../../../shared/commercial-activity-types.js";
import { loadRescheduleTimezone, proposeSchedule } from "./customer-reschedule-time.js";
import { comparableCustomerUpdateValue } from "./customer-field-values.js";

const invalid = (status, message) => Object.assign(new Error(message), { status, code: "COACH_RESCHEDULE_CONFLICT" });
export const scheduleVersion = (row) => JSON.stringify({
  opportunityId: Number(row.opportunityId), activityId: Number(row.id),
  status: row.status, actionType: row.actionType, title: row.title,
  scheduledAt: row.scheduledAt instanceof Date ? row.scheduledAt.toISOString() : row.scheduledAt,
  dueDate: comparableCustomerUpdateValue("closeDate", row.dueDate),
  accountName: row.accountName, opportunityName: row.opportunityName,
});

export async function readCustomerSchedule({ user, accountId, execute = query, lock = false }) {
  if (!Number.isSafeInteger(accountId) || accountId <= 0) throw invalid(400, "Cuenta inválida");
  for (const domain of ["cuentas", "oportunidades", "calendario_comercial"]) {
    if (!hasAnyPermission(user, [`${domain}.read`, `${domain}.read_all`])) throw invalid(403, "Necesitas lectura de cuenta, oportunidades y Calendario");
  }
  const accounts = await execute(`SELECT a.id,a.name FROM accounts a
    INNER JOIN account_activation_statuses s ON s.id=a.activation_status_id
    WHERE a.id=? AND s.code='activada' AND (?=1 OR EXISTS
    (SELECT 1 FROM account_owners ao WHERE ao.account_id=a.id AND ao.user_id=?)) LIMIT 1${lock ? " FOR UPDATE" : ""}`,
  [accountId, hasAnyPermission(user, ["cuentas.read_all"]) ? 1 : 0, Number(user.id)]);
  if (!accounts.length) throw invalid(404, "La cuenta fija no está disponible");
  const opportunities = await execute(`SELECT o.id,o.name,s.code AS status FROM opportunities o
    INNER JOIN opportunity_commercial_statuses s ON s.id=o.commercial_status_id
    WHERE o.account_id=? ORDER BY o.id${lock ? " FOR UPDATE" : ""}`, [accountId]);
  const activities = await execute(`SELECT a.id,a.opportunity_id AS opportunityId,a.title,a.action_type AS actionType,
    a.status,a.scheduled_at AS scheduledAt,CAST(a.due_date AS CHAR) AS dueDate
    FROM opportunity_workspace_actions a INNER JOIN opportunities o ON o.id=a.opportunity_id
    WHERE o.account_id=? ORDER BY a.id LIMIT 1001${lock ? " FOR UPDATE" : ""}`, [accountId]);
  if (activities.length > 1000) throw invalid(422, "Hay más de 1000 actividades en esta cuenta; utiliza Calendario para seleccionar y editar la actividad");
  return { accountName: accounts[0].name, opportunities, activities };
}

export function eligibleSchedule(data, activityId, opportunityId) {
  const activity = data.activities.find((item) => Number(item.id) === activityId && Number(item.opportunityId) === opportunityId);
  const opportunity = data.opportunities.find((item) => Number(item.id) === opportunityId);
  if (!activity || !opportunity) throw invalid(404, "La actividad no pertenece a una oportunidad autorizada de la cuenta");
  if (["ganada", "perdida", "anulada"].includes(opportunity.status)) throw invalid(422, "No puedes reprogramar actividades de una oportunidad cerrada");
  if (activity.status !== "pending" || (!COMMERCIAL_ACTIVITY_TYPES.some((type) => type.value === activity.actionType) && activity.actionType !== "conference")) {
    throw invalid(422, "Solo se reprograman actividades pendientes, no acciones, actividades completadas o canceladas");
  }
  return { activity, opportunity };
}

export async function checkCustomerRescheduleAccess(user, operation, { execute = query, lock = false, compareCurrent = true } = {}) {
  if (operation?.kind !== "reschedule_activity") return null;
  try {
    if (![operation.accountId, operation.opportunityId, operation.activityId].every((id) => Number.isSafeInteger(id) && id > 0) ||
        !operation.rescheduleDraftId || operation.sourceChannel !== "customer_account" ||
        operation.payload?.activityId !== operation.activityId || operation.payload?.accountId !== operation.accountId) throw invalid(400, "Identidad de reprogramación inválida");
    const rules = await loadCoachBusinessRules({ channel: "customer_account", process: "default" });
    const intents = await loadChannelIntentConfigurations({ channel: "customer_account" });
    if (!rules.operationPolicy.allowedKinds.includes(operation.kind) || rules.scope?.opportunitySearchAllowed === false ||
        intents.some((intent) => intent.code === "crm_operation" && !intent.enabled)) throw invalid(409, "A06 está deshabilitado por política");
    for (const permission of ["mi_coach.access", "inteligencia_comercial.access", "mi_coach.execute", "calendario_comercial.update", "oportunidades.update", "desarrollo_comercial.update"]) {
      if (!hasAnyPermission(user, [permission])) throw invalid(403, "Ya no tienes los permisos requeridos para reprogramar");
    }
    const rows = await execute(`SELECT context_json FROM customer_intelligence_chat_sessions
      WHERE requested_by_user_id=? AND account_id=?
      AND JSON_UNQUOTE(JSON_EXTRACT(context_json,'$.rescheduleMemory.draftId'))=? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [Number(user.id), operation.accountId, operation.rescheduleDraftId]);
    const context = typeof rows[0]?.context_json === "string" ? JSON.parse(rows[0].context_json) : rows[0]?.context_json;
    const memory = context?.rescheduleMemory;
    if (!memory || memory.revision !== operation.rescheduleRevision || memory.activityId !== operation.activityId ||
        memory.opportunityId !== operation.opportunityId || memory.accountId !== operation.accountId ||
        memory.observedVersion !== operation.observedVersion) throw invalid(409, "La propuesta fue corregida o descartada. Retoma el borrador vigente en el chat");
    const data = await readCustomerSchedule({ user, accountId: operation.accountId, execute, lock });
    const { activity, opportunity } = eligibleSchedule(data, operation.activityId, operation.opportunityId);
    if (compareCurrent) {
      if (scheduleVersion({ ...activity, accountName: data.accountName, opportunityName: opportunity.name }) !== operation.observedVersion) throw invalid(409, "La actividad cambió. Actualiza la propuesta desde el chat antes de sobrescribir");
      const timeZone = await loadRescheduleTimezone();
      const proposal = proposeSchedule({ current: activity.scheduledAt, dateText: memory.dateText, timeText: memory.timeText, timeZone });
      if (proposal.error || timeZone !== operation.scheduleSummary.timeZone || proposal.proposed !== operation.proposedAt ||
          proposal.dueDate !== operation.proposedDueDate || data.accountName !== operation.scheduleSummary.accountName ||
          opportunity.name !== operation.scheduleSummary.opportunityName || activity.title !== operation.scheduleSummary.activityTitle ||
          proposal.original !== operation.scheduleSummary.before || proposal.local !== operation.scheduleSummary.after) {
        throw invalid(409, "La programación o su descripción cambió. Revisa nuevamente la propuesta");
      }
    }
    return null;
  } catch (error) {
    if (error.code !== "COACH_RESCHEDULE_CONFLICT") throw error;
    return { status: error.status, message: error.message };
  }
}
