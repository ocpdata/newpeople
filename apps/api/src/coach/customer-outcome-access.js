import { query } from "../db.js";
import { isDeepStrictEqual } from "node:util";
import { hasAnyPermission } from "./operation-policy.js";
import { loadCoachBusinessRules } from "./business-rules.js";
import { loadChannelIntentConfigurations } from "./channel-intent-governance.js";
import { getLeadCallOutcomeCatalogResponse, validateLeadCallOutcomeForCoach } from "../lead-call-outcomes.js";
import { comparableCustomerUpdateValue } from "./customer-field-values.js";
import { loadRescheduleTimezone, localSchedule, resolveBusinessDate } from "./customer-reschedule-time.js";

export const outcomeError = (status, message) => Object.assign(new Error(message), { status, code: "COACH_OUTCOME_CONFLICT" });
export function outcomeVersion(lead, accountName) {
  return JSON.stringify({ ...lead, accountName });
}
export function outcomeRuleKey(rule) {
  return [rule.substatusCode, rule.reasonCode, rule.requiredActionCode].join("|");
}
export function describeOutcomeRule(rule, catalog) {
  const label = (items, code) => items.find((item) => item.code === code)?.name || code;
  return {
    result: label(catalog.substatuses, rule.substatusCode), reason: label(catalog.reasons, rule.reasonCode),
    action: label(catalog.requiredActions, rule.requiredActionCode),
    status: label(catalog.statuses, rule.resultStatusCode),
  };
}
export async function readCustomerOutcomes({ user, accountId, execute = query, lock = false }) {
  if (!Number.isSafeInteger(accountId) || accountId <= 0) throw outcomeError(400, "Cuenta inválida");
  if (!hasAnyPermission(user, ["cuentas.read", "cuentas.read_all"]) ||
      !hasAnyPermission(user, ["interacciones.read", "interacciones.read_all"])) throw outcomeError(403, "Necesitas lectura de cuenta y leads");
  const accounts = await execute(`SELECT a.id,a.name FROM accounts a
    INNER JOIN account_activation_statuses s ON s.id=a.activation_status_id
    WHERE a.id=? AND s.code='activada' AND (?=1 OR EXISTS
      (SELECT 1 FROM account_owners ao WHERE ao.account_id=a.id AND ao.user_id=?)) LIMIT 1${lock ? " FOR UPDATE" : ""}`,
  [accountId, hasAnyPermission(user, ["cuentas.read_all"]) ? 1 : 0, Number(user.id)]);
  if (!accounts.length) throw outcomeError(404, "La cuenta fija no está disponible");
  const leads = await execute(`SELECT i.id,i.title,i.account_id AS accountId,i.analysis_status AS status,
    i.lead_substatus_code AS substatusCode,i.lead_reason_code AS reasonCode,i.lead_required_action_code AS requiredActionCode,
    i.lead_commercial_comment AS comment,DATE_FORMAT(i.lead_next_action_due_at,'%Y-%m-%d') AS dueDate,
    CAST(i.lead_next_action_due_at AS CHAR) AS dueAt,
    i.lead_referred_contact_name AS referredContactName,i.lead_referred_area_name AS referredAreaName,
    i.resolved_at AS resolvedAt,i.disqualification_reason AS disqualificationReason,
    (SELECT COALESCE(MAX(e.id),0) FROM interaction_lead_outcome_events e WHERE e.interaction_id=i.id) AS lastEventId,
    (SELECT CAST(e.invalidated_at AS CHAR) FROM interaction_lead_outcome_events e WHERE e.interaction_id=i.id ORDER BY e.id DESC LIMIT 1) AS lastEventInvalidatedAt
    FROM interactions i WHERE i.account_id=? AND (?=1 OR i.seller_user_id=? OR i.created_by=? OR EXISTS
      (SELECT 1 FROM account_owners ao WHERE ao.account_id=i.account_id AND ao.user_id=?) OR EXISTS
      (SELECT 1 FROM landing_submissions ls WHERE ls.id=i.landing_submission_id AND ls.sent_to_leads_by=?) OR EXISTS
      (SELECT 1 FROM landing_submission_crm_links l INNER JOIN landing_submissions ls ON ls.id=l.submission_id
       WHERE l.lead_id=i.id AND ls.sent_to_leads_by=?))
    ORDER BY i.id LIMIT 1001${lock ? " FOR UPDATE" : ""}`,
  [accountId, hasAnyPermission(user, ["interacciones.read_all"]) ? 1 : 0, ...Array(5).fill(Number(user.id))]);
  if (leads.length > 1000) throw outcomeError(422, "Hay más de 1000 leads; utiliza Interacciones para seleccionar el registro sin resultados truncados");
  const normalized = leads.map((lead) => ({
    ...lead, id: Number(lead.id), accountId: Number(lead.accountId), lastEventId: Number(lead.lastEventId),
    dueDate: comparableCustomerUpdateValue("closeDate", lead.dueDate),
    resolvedAt: lead.resolvedAt instanceof Date ? lead.resolvedAt.toISOString() : lead.resolvedAt,
  }));
  if (normalized.some((lead) => String(lead.comment || "").length > 4000 ||
      outcomeVersion(lead, accounts[0].name).length > 12000)) throw outcomeError(422, "El detalle histórico excede el alcance del chat. Revisa el resultado en Interacciones");
  return { accountName: accounts[0].name, leads: normalized };
}

export async function checkCustomerOutcomeAccess(user, operation, { execute = query, lock = false } = {}) {
  if (!operation?.outcomeDraftId) return operation?.outcomeRevision || operation?.outcomeSummary ||
    operation?.outcomeObservedVersion || operation?.outcomeRule ? { status: 400, message: "Identidad del borrador de resultado incompleta" } : null;
  try {
    if (operation.kind !== "lead_call_outcome" || operation.sourceChannel !== "customer_account") throw outcomeError(400, "Identidad del resultado inválida");
    for (const permission of ["mi_coach.access", "inteligencia_comercial.access", "mi_coach.execute", "interacciones.update"]) {
      if (!hasAnyPermission(user, [permission])) throw outcomeError(403, "Ya no tienes permisos para registrar el resultado");
    }
    const rules = await loadCoachBusinessRules({ channel: "customer_account", process: "default" });
    const intents = await loadChannelIntentConfigurations({ channel: "customer_account" });
    if (!rules.operationPolicy.allowedKinds.includes("lead_call_outcome") || rules.scope?.leadSearchAllowed === false ||
        intents.some((intent) => intent.code === "crm_operation" && !intent.enabled)) throw outcomeError(409, "El registro de resultados está deshabilitado por política");
    const rows = await execute(`SELECT context_json FROM customer_intelligence_chat_sessions WHERE requested_by_user_id=? AND account_id=?
      AND JSON_UNQUOTE(JSON_EXTRACT(context_json,'$.outcomeMemory.draftId'))=? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [Number(user.id), operation.accountId, operation.outcomeDraftId]);
    const context = typeof rows[0]?.context_json === "string" ? JSON.parse(rows[0].context_json) : rows[0]?.context_json;
    const memory = context?.outcomeMemory;
    if (!memory || memory.accountId !== operation.accountId || memory.leadId !== operation.interactionId ||
        memory.revision !== operation.outcomeRevision || memory.observedVersion !== operation.outcomeObservedVersion ||
        memory.ruleKey !== [operation.substatusCode, operation.reasonCode, operation.requiredActionCode].join("|") ||
        !memory.proposalKey || memory.values?.comment !== (operation.comment || "") ||
        memory.values?.referredContactName !== (operation.referredContactName || "") ||
        memory.values?.referredAreaName !== (operation.referredAreaName || "") ||
        !isDeepStrictEqual(JSON.parse(memory.proposalKey || "null"), [operation.outcomeSummary, operation.substatusCode, operation.reasonCode,
          operation.requiredActionCode, operation.comment || "", operation.nextActionDueAt || null,
          operation.referredContactName || "", operation.referredAreaName || ""])) {
      throw outcomeError(409, "El borrador fue corregido, descartado o sustituido. Retoma la propuesta vigente");
    }
    const data = await readCustomerOutcomes({ user, accountId: operation.accountId, execute, lock });
    const lead = data.leads.find((item) => item.id === operation.interactionId);
    if (!lead) throw outcomeError(404, "El lead no está disponible en la cuenta fija");
    if (outcomeVersion(lead, data.accountName) !== operation.outcomeObservedVersion) throw outcomeError(409, "El lead o su resultado cambiaron. Actualiza y revisa otra vez en el chat");
    const validated = validateLeadCallOutcomeForCoach({ currentStatusCode: lead.status, operation });
    if (!validated.ok) throw outcomeError(validated.status, validated.message);
    const timeZone = await loadRescheduleTimezone();
    const today = localSchedule(new Date(), timeZone).slice(0, 10);
    const dueDate = memory.values?.dueDateText ? resolveBusinessDate(memory.values.dueDateText, today) : null;
    if (timeZone !== operation.outcomeSummary.timeZone || dueDate !== (operation.nextActionDueAt || null) ||
        (dueDate && dueDate < today)) throw outcomeError(409, "La fecha compromiso o la zona del negocio cambió. Revisa nuevamente");
    if (JSON.stringify(validated.rule) !== operation.outcomeRule) throw outcomeError(409, "Las reglas del resultado cambiaron. Actualiza la propuesta");
    const catalog = getLeadCallOutcomeCatalogResponse(lead.status);
    if (!isDeepStrictEqual(describeOutcomeRule(validated.rule, catalog), operation.outcomeSummary.proposed)) {
      throw outcomeError(409, "La descripción del resultado cambió. Actualiza la propuesta");
    }
    return null;
  } catch (error) {
    if (error.code !== "COACH_OUTCOME_CONFLICT") throw error;
    return { status: error.status, message: error.message };
  }
}
