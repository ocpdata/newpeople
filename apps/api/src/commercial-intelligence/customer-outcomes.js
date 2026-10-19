import { randomUUID } from "node:crypto";
import { z } from "zod";
import { customerOutcomeSpecSchema } from "./turn-contract.js";
import { normalizeCustomerSearchText as normalize } from "./customer-record-list.js";
import { getLeadCallOutcomeCatalogResponse, parseDateOnlyText, validateLeadCallOutcomeForCoach } from "../lead-call-outcomes.js";
import { describeOutcomeRule, outcomeRuleKey, outcomeVersion } from "../coach/customer-outcome-access.js";
import { localSchedule, resolveBusinessDate } from "../coach/customer-reschedule-time.js";

const valueSchema = z.object({ comment: z.string().max(4000), dueDateText: z.string().max(150),
  referredContactName: z.string().max(255), referredAreaName: z.string().max(255) }).strict();
const memorySchema = z.object({
  accountId: z.number().int().positive(), draftId: z.string().uuid(), revision: z.number().int().positive(),
  leadId: z.number().int().nonnegative(), leadReference: z.string().max(300), resultReference: z.string().max(500),
  leadCandidates: z.array(z.number().int().positive()).max(100), ruleCandidates: z.array(z.string().max(400)).max(100),
  ruleKey: z.string().max(400), values: valueSchema, observedVersion: z.string().max(12000), proposalKey: z.string().max(16000),
}).strict();
export function validateCustomerOutcomeMemory(value, snapshot) {
  const parsed = memorySchema.safeParse(value);
  return parsed.success && parsed.data.accountId === Number(snapshot?.account?.id) ? parsed.data : null;
}
const literal = (text, value) => String(text).replace(/\s+/g, " ").includes(String(value).replace(/\s+/g, " "));
const emptyValues = () => ({ comment: "", dueDateText: "", referredContactName: "", referredAreaName: "" });
export async function buildCustomerOutcomeResponse({ component, movement, question, snapshot, previous, readOutcomes,
  timeZone, now = new Date() }) {
  const prior = validateCustomerOutcomeMemory(previous, snapshot);
  let memory = prior ? structuredClone(prior) : null;
  const response = (answer, responseType = "clarification", extra = {}) => ({
    answer, responseType, operations: [], evidence: [], recommendedActions: [], pendingItems: [],
    entities: { accountId: Number(snapshot.account.id), leadId: memory?.leadId || null },
    outcomeMemory: memory, outcomeMetadata: memory ? { draftId: memory.draftId, revision: memory.revision, status: "clarification" } : null, ...extra,
  });
  const parsed = customerOutcomeSpecSchema.safeParse(component.outcomeSpec);
  if (!parsed.success) return response("Identifica el lead y el resultado de la llamada que quieres preparar. No se guardó ningún cambio.");
  const spec = parsed.data;
  if (spec.unsupported?.length || component.scope === "collection") return response("A07 prepara un resultado de llamada para un lead de esta cuenta. No crea contactos, reuniones, tareas ni registra resultados masivos.");
  if ((spec.leadReference || spec.resultReference || spec.position) &&
      (!spec.evidence || !literal(question, spec.evidence) ||
        [spec.leadReference, spec.resultReference].some((value) => value && !literal(spec.evidence, value)))) {
    return response(`Las referencias deben conservar la evidencia literal del mensaje actual.${prior
      ? " Conservé el borrador previo."
      : " No preparé ningún cambio."}`);
  }
  if (new Set(spec.changes.map((change) => change.field)).size !== spec.changes.length ||
      spec.changes.some((change) => !literal(question, change.evidence) || (change.action === "set" && !literal(change.evidence, change.value)))) {
    return response("Los datos deben ser únicos y conservar la evidencia literal del mensaje actual.");
  }
  if (spec.position && spec.selectionTarget === "none") return response("Indica si seleccionas un lead o un resultado de la lista.");
  const fresh = !prior || spec.mode === "start";
  if (prior && fresh && !["new_request", "change_focus"].includes(movement)) return response("Aclara si se trata de una nueva llamada o una corrección de la propuesta anterior.");
  if (fresh) memory = { accountId: Number(snapshot.account.id), draftId: randomUUID(), revision: 1, leadId: 0,
    leadReference: "", resultReference: "", leadCandidates: [], ruleCandidates: [], ruleKey: "", values: emptyValues(),
    observedVersion: "", proposalKey: "" };
  const before = JSON.stringify(memory);
  const revise = () => {
    if (!fresh && memory.revision === prior.revision && (JSON.stringify(memory) !== before || spec.mode === "refresh")) memory.revision += 1;
  };
  for (const key of ["leadReference", "resultReference"]) {
    if (spec[key] && normalize(spec[key]) !== normalize(memory[key])) {
      memory[key] = spec[key]; memory.ruleKey = ""; memory.ruleCandidates = []; memory.values = emptyValues();
      if (key === "leadReference") { memory.leadId = 0; memory.leadCandidates = []; }
    }
  }
  for (const change of spec.changes) memory.values[change.field] = change.action === "remove" ? "" : change.value;
  const values = valueSchema.safeParse(memory.values);
  if (!values.success) {
    memory = prior;
    return response(`La persona/área referida admite hasta 255 caracteres y la fecha hasta 150.${prior
      ? " Conservé el borrador previo."
      : " No preparé ningún cambio."}`);
  }
  if (JSON.stringify(memory) !== before || spec.mode === "refresh" || spec.clarification) memory.proposalKey = "";
  let data;
  try { data = await readOutcomes(memory.accountId); }
  catch (error) { if (error.code !== "COACH_OUTCOME_CONFLICT") throw error; revise(); return response(error.message, "error"); }
  if (memory.leadId && !data.leads.some((item) => item.id === memory.leadId)) {
    memory.leadId = 0; memory.ruleKey = ""; memory.observedVersion = ""; revise();
    return response("El lead seleccionado ya no está disponible en esta cuenta. Selecciona nuevamente.", "error");
  }
  if (!memory.leadId || (spec.selectionTarget === "lead" && spec.position)) {
    const ref = normalize(memory.leadReference).replace(/^lead\s*#?\s*/, "");
    const accountReference = ref === normalize(data.accountName) || ref === normalize(`de ${data.accountName}`);
    const exactLeads = data.leads.filter((item) => normalize(item.title || "") === ref);
    const matches = /^\d+$/.test(ref) ? data.leads.filter((item) => item.id === Number(ref))
      : !ref || accountReference ? data.leads : exactLeads.length ? exactLeads : data.leads.filter((item) => normalize(item.title || "").includes(ref));
    const ids = matches.map((item) => item.id);
    if (spec.selectionTarget === "lead" && spec.position) {
      if (!prior || JSON.stringify(prior.leadCandidates) !== JSON.stringify(ids.slice(0, 100)) || !ids[spec.position - 1]) {
        memory.leadCandidates = ids.slice(0, 100); revise(); return response("La lista de leads cambió o el ordinal es inválido. Selecciona nuevamente.");
      }
      const selected = ids[spec.position - 1];
      if (memory.leadId !== selected) {
        memory.values = emptyValues(); memory.ruleKey = "";
        for (const change of spec.changes) memory.values[change.field] = change.action === "remove" ? "" : change.value;
      }
      memory.leadId = selected;
    } else if (matches.length === 1) memory.leadId = ids[0];
    else {
      memory.leadCandidates = ids.slice(0, 100); revise();
      return response(matches.length ? `Selecciona el lead verificado de ${data.accountName}; no elegiré por suposición:\n${matches.slice(0, 100).map((lead, index) =>
        `${index + 1}. Lead ${lead.id} · ${String(lead.title || "").slice(0, 120)} · ${lead.status} · ${lead.substatusCode || "sin resultado"} · ${String(lead.comment || "sin comentario").slice(0, 160)}`).join("\n")}${matches.length > 100 ? "\nHay más candidatos; indica el ID." : ""}`
        : "No encontré ese lead autorizado en la cuenta fija. No usaré registros ajenos.");
    }
    memory.leadCandidates = ids.slice(0, 100);
  }
  const lead = data.leads.find((item) => item.id === memory.leadId);
  memory.observedVersion = outcomeVersion(lead, data.accountName);
  const catalog = getLeadCallOutcomeCatalogResponse(lead.status);
  const rules = catalog.transitionRules.map(({ resultStatusName: _label, ...rule }) => rule);
  if (!rules.length) { revise(); return response("El estado actual del lead no permite registrar este resultado; no se guardó ningún cambio.", "error"); }
  const ref = normalize(memory.resultReference);
  const labels = (rule) => {
    const description = describeOutcomeRule(rule, catalog);
    return [description.result, description.reason, `${description.result} / ${description.reason} / ${description.action}`].map(normalize);
  };
  const exact = rules.filter((rule) => labels(rule).includes(ref));
  const matches = ref && exact.length ? exact : rules;
  const keys = matches.map(outcomeRuleKey);
  if (spec.selectionTarget === "result" && spec.position) {
    if (!prior || JSON.stringify(keys) !== JSON.stringify(prior.ruleCandidates) || !keys[spec.position - 1]) {
      memory.ruleKey = ""; memory.ruleCandidates = keys; revise(); return response("Los resultados admitidos cambiaron o el ordinal es inválido. Revisa la lista vigente.");
    }
    if (memory.ruleKey !== keys[spec.position - 1]) {
      memory.values = emptyValues();
      for (const change of spec.changes) memory.values[change.field] = change.action === "remove" ? "" : change.value;
    }
    memory.ruleKey = keys[spec.position - 1];
  } else if (!memory.ruleKey && exact.length === 1) memory.ruleKey = outcomeRuleKey(exact[0]);
  memory.ruleCandidates = keys;
  const rule = rules.find((item) => outcomeRuleKey(item) === memory.ruleKey);
  if (!rule) {
    revise();
    return response(`No asignaré una razón o acción por suposición${ref ? ` para «${memory.resultReference}»` : ""}. Selecciona un resultado admitido:\n${matches.map((item, index) => {
      const label = describeOutcomeRule(item, catalog);
      return `${index + 1}. ${label.result} / ${label.reason} / ${label.action} → ${label.status}`;
    }).join("\n")}`);
  }
  const pending = [];
  if (rule.requiresComment && !memory.values.comment) pending.push("Comentario comercial");
  if (rule.requiresDueDate && !memory.values.dueDateText) pending.push("Fecha compromiso");
  if (rule.requiresReferredContact && !memory.values.referredContactName) pending.push("Persona referida");
  if (rule.requiresReferredArea && !memory.values.referredAreaName) pending.push("Área objetivo");
  const today = localSchedule(now, timeZone).slice(0, 10);
  const due = memory.values.dueDateText ? resolveBusinessDate(memory.values.dueDateText, today) : null;
  if (memory.values.dueDateText && (!due || !parseDateOnlyText(due) || due < today)) pending.push("Fecha compromiso válida (hoy o futura, zona del negocio)");
  revise();
  if (pending.length || spec.clarification) return response([spec.clarification, `Lead ${lead.id}. Pendientes: ${pending.join(", ")}.`].filter(Boolean).join("\n"), "clarification", { pendingItems: pending });
  const label = (items, code) => items.find((item) => item.code === code)?.name || code || "(sin dato)";
  const summary = { accountName: data.accountName, leadLabel: `Lead ${lead.id}${lead.title ? ` · ${lead.title}` : ""}`, currentStatus: label(catalog.statuses, lead.status),
    currentResult: label(catalog.substatuses, lead.substatusCode), currentReason: label(catalog.reasons, lead.reasonCode),
    currentAction: label(catalog.requiredActions, lead.requiredActionCode), currentComment: lead.comment || "",
    currentDueDate: lead.dueDate || null, currentReferredContactName: lead.referredContactName || "",
    currentReferredAreaName: lead.referredAreaName || "", proposed: describeOutcomeRule(rule, catalog), timeZone };
  const operation = { kind: "lead_call_outcome", sourceChannel: "customer_account", accountId: memory.accountId,
    interactionId: lead.id, outcomeDraftId: memory.draftId, outcomeRevision: memory.revision,
    outcomeObservedVersion: memory.observedVersion, outcomeRule: JSON.stringify(rule), outcomeSummary: summary,
    substatusCode: rule.substatusCode, reasonCode: rule.reasonCode, requiredActionCode: rule.requiredActionCode,
    comment: memory.values.comment, nextActionDueAt: due,
    referredContactName: memory.values.referredContactName, referredAreaName: memory.values.referredAreaName,
    title: `Registrar llamada: ${summary.leadLabel} · ${summary.proposed.result}`.slice(0, 300),
    evidence: [], missingFields: [], requiresConfirmation: true };
  const validation = validateLeadCallOutcomeForCoach({ currentStatusCode: lead.status, operation });
  if (!validation.ok) return response(validation.message, "clarification");
  memory.proposalKey = JSON.stringify([summary, operation.substatusCode, operation.reasonCode, operation.requiredActionCode,
    operation.comment || "", due, operation.referredContactName || "", operation.referredAreaName || ""]); revise();
  operation.outcomeRevision = memory.revision;
  return response(`${summary.accountName} · ${summary.leadLabel}\nActual: ${summary.currentStatus} / ${summary.currentResult}\nPropuesto: ${summary.proposed.result} / ${summary.proposed.reason} / ${summary.proposed.action}\nEstado resultante: ${summary.proposed.status}.\nPropuesta no guardada: revisa y confirma en Mi Coach. Registra una llamada; no crea reuniones, tareas, contactos ni oportunidades.`,
    "change_request", { operations: [operation], outcomeMetadata: { ...summary, comment: operation.comment,
      nextActionDueAt: due, referredContactName: operation.referredContactName, referredAreaName: operation.referredAreaName,
      draftId: memory.draftId, revision: memory.revision, status: "prepared" } });
}
