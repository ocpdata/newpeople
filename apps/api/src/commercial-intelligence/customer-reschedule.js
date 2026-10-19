import { randomUUID } from "node:crypto";
import { z } from "zod";
import { customerRescheduleSpecSchema } from "./turn-contract.js";
import { normalizeCustomerSearchText as normalize } from "./customer-record-list.js";
import { eligibleSchedule, scheduleVersion } from "../coach/customer-reschedule-access.js";
import { localSchedule, proposeSchedule } from "../coach/customer-reschedule-time.js";

const memorySchema = z.object({
  accountId: z.number().int().positive(), draftId: z.string().uuid(), revision: z.number().int().positive(),
  opportunityId: z.number().int().nonnegative(), activityId: z.number().int().nonnegative(),
  opportunityReference: z.string().max(300), activityReference: z.string().max(300),
  opportunityCandidates: z.array(z.number().int().positive()).max(100),
  activityCandidates: z.array(z.number().int().positive()).max(100),
  dateText: z.string().max(150), timeText: z.string().max(150), observedVersion: z.string().max(2000),
  proposalKey: z.string().max(2500),
}).strict();
export function validateCustomerRescheduleMemory(value, snapshot) {
  const parsed = memorySchema.safeParse(value);
  return parsed.success && parsed.data.accountId === Number(snapshot?.account?.id) ? parsed.data : null;
}
const literal = (text, value) => String(text).replace(/\s+/g, " ").includes(String(value).replace(/\s+/g, " "));
export async function buildCustomerRescheduleResponse({ component, movement, question, snapshot, previous, readSchedule, timeZone, now = new Date() }) {
  const prior = validateCustomerRescheduleMemory(previous, snapshot);
  let memory = prior ? structuredClone(prior) : null;
  const response = (answer, responseType = "clarification", extra = {}) => ({
    answer, responseType, operations: [], evidence: [], recommendedActions: [], pendingItems: [],
    entities: { accountId: Number(snapshot.account.id), opportunityId: memory?.opportunityId || null },
    rescheduleMemory: memory,
    rescheduleMetadata: memory ? { draftId: memory.draftId, revision: memory.revision, status: "clarification" } : null,
    ...extra,
  });
  const parsed = customerRescheduleSpecSchema.safeParse(component.rescheduleSpec);
  if (!parsed.success) return response("Identifica la actividad guardada y la nueva fecha u hora. No se modificó ningún registro.");
  const spec = parsed.data;
  if (component.scope === "collection" || spec.unsupported?.length) return response("A06 solo reprograma una actividad pendiente de oportunidad. No crea sustitutas ni cambia otros campos.");
  if ([spec.opportunityReference, spec.activityReference, spec.dateText, spec.timeText].some(Boolean) || spec.position) {
    if (!spec.evidence || !literal(question, spec.evidence) ||
        [spec.opportunityReference, spec.activityReference, spec.dateText, spec.timeText].some((value) => value && !literal(spec.evidence, value))) {
      return response("Los datos deben conservar la evidencia literal del mensaje actual. Conservé el borrador anterior.");
    }
  }
  if (spec.position && spec.selectionTarget === "none") return response("Indica si seleccionas una oportunidad o una actividad.");
  const fresh = !prior || spec.mode === "start";
  if (prior && fresh && !["new_request", "change_focus"].includes(movement)) return response("Indica si quieres iniciar una nueva reprogramación.");
  if (fresh) memory = { accountId: Number(snapshot.account.id), draftId: randomUUID(), revision: 1,
    opportunityId: 0, activityId: 0, opportunityReference: "", activityReference: "",
    opportunityCandidates: [], activityCandidates: [], dateText: "", timeText: "", observedVersion: "", proposalKey: "" };
  const before = JSON.stringify(memory);
  const revise = () => {
    if (!fresh && memory.revision === prior.revision && (JSON.stringify(memory) !== before || spec.mode === "refresh")) memory.revision += 1;
  };
  for (const key of ["opportunityReference", "activityReference", "dateText", "timeText"]) {
    if (spec[key] && spec[key] !== memory[key]) {
      memory[key] = spec[key];
      if (key === "opportunityReference") { memory.opportunityId = 0; memory.activityId = 0; memory.observedVersion = ""; }
      if (key === "activityReference") { memory.activityId = 0; memory.observedVersion = ""; }
    }
  }
  let data;
  try { data = await readSchedule(memory.accountId); }
  catch (error) {
    if (error.code !== "COACH_RESCHEDULE_CONFLICT") throw error;
    revise(); return response(error.message, "error");
  }
  const questions = [];
  for (const object of ["opportunity", "activity"]) {
    const id = `${object}Id`, candidates = `${object}Candidates`;
    const records = object === "opportunity" ? data.opportunities : data.activities.filter((item) => !memory.opportunityId || Number(item.opportunityId) === memory.opportunityId);
    if (memory[id] && !records.some((item) => Number(item.id) === memory[id])) {
      memory[id] = 0; memory.observedVersion = "";
      questions.push("El registro seleccionado ya no está disponible; selecciona nuevamente.");
    }
    if (memory[id] && !(spec.position && spec.selectionTarget === object)) continue;
    const ref = normalize(memory[`${object}Reference`]);
    const fields = (item) => object === "opportunity" ? [item.name] : [
      item.title, item.actionType, localSchedule(item.scheduledAt, timeZone)?.slice(0, 10),
      ({ call: "llamada", meeting_virtual: "reunión", meeting_in_person: "reunión", conference: "reunión" })[item.actionType],
    ];
    const exact = records.filter((item) => /^\d+$/.test(ref) ? Number(ref) === Number(item.id) : fields(item).some((field) => normalize(field || "") === ref));
    const matches = !ref ? [] : /^\d+$/.test(ref) || exact.length ? exact : records.filter((item) => fields(item).some((field) => normalize(field || "").includes(ref)));
    const ids = matches.map((item) => Number(item.id));
    if (spec.position && spec.selectionTarget === object) {
      if (!prior || JSON.stringify(ids.slice(0, 100)) !== JSON.stringify(prior[candidates]) || !ids[spec.position - 1]) {
        questions.push("Los candidatos cambiaron o el ordinal es inválido. Selecciona nuevamente."); memory[id] = 0;
      } else memory[id] = ids[spec.position - 1];
    } else if (matches.length === 1) memory[id] = ids[0];
    else questions.push(matches.length ? `Selecciona ${object === "activity" ? "actividad" : "oportunidad"}:\n${matches.slice(0, 100).map((item, index) =>
      `${index + 1}. ${item.name || item.title} · ID ${item.id}${object === "activity" ? ` · ${localSchedule(item.scheduledAt, timeZone) || "sin fecha"} · ${item.status} · oportunidad ${item.opportunityId}` : ""}`).join("\n")}${matches.length > 100 ? "\nReduce la referencia; hay más candidatos." : ""}`
      : `Indica una ${object === "activity" ? "actividad guardada" : "oportunidad"} de esta cuenta por nombre o ID verificable.`);
    memory[candidates] = ids.slice(0, 100);
  }
  if (memory.activityId && !memory.opportunityId && !memory.opportunityReference) {
    memory.opportunityId = Number(data.activities.find((item) => Number(item.id) === memory.activityId).opportunityId);
    questions.splice(0, 1);
  }
  revise();
  if (questions.length || spec.clarification) return response([spec.clarification, ...questions].filter(Boolean).join("\n"));
  let pair;
  try { pair = eligibleSchedule(data, memory.activityId, memory.opportunityId); }
  catch (error) { if (error.code !== "COACH_RESCHEDULE_CONFLICT") throw error; return response(error.message, "error"); }
  const { activity, opportunity } = pair;
  memory.observedVersion = scheduleVersion({ ...activity, accountName: data.accountName, opportunityName: opportunity.name }); revise();
  if (!memory.dateText && !memory.timeText) return response(`Actividad: ${activity.title}. Actual: ${localSchedule(activity.scheduledAt, timeZone) || "sin programación"}. Indica la nueva fecha u hora.`);
  const proposal = proposeSchedule({ current: activity.scheduledAt, dateText: memory.dateText, timeText: memory.timeText, timeZone, now });
  if (proposal.error) return response(proposal.error);
  const summary = { accountName: data.accountName, opportunityName: opportunity.name, activityTitle: activity.title,
    before: proposal.original, after: proposal.local, timeZone };
  memory.proposalKey = JSON.stringify([summary, proposal.proposed]); revise();
  const noChange = proposal.proposed === (activity.scheduledAt instanceof Date ? activity.scheduledAt.toISOString() : activity.scheduledAt);
  const metadata = { ...summary, draftId: memory.draftId, revision: memory.revision, status: noChange ? "no_change" : "prepared" };
  const prefix = `${summary.accountName} · ${summary.opportunityName} · ${summary.activityTitle}\nActual: ${summary.before || "sin fecha"}\nPropuesta: ${summary.after}\nZona: ${timeZone}`;
  if (noChange) return response(`${prefix}\nLa programación ya coincide. No hay cambios que guardar.`, "informational", { rescheduleMetadata: metadata });
  const operation = { kind: "reschedule_activity", sourceChannel: "customer_account", targetModule: "calendar",
    accountId: memory.accountId, opportunityId: memory.opportunityId, activityId: memory.activityId,
    rescheduleDraftId: memory.draftId, rescheduleRevision: memory.revision, observedVersion: memory.observedVersion,
    proposedAt: proposal.proposed, proposedDueDate: proposal.dueDate, scheduleSummary: summary,
    payload: { accountId: memory.accountId, activityId: memory.activityId },
    title: `Reprogramar ${activity.title}`.slice(0, 300), evidence: [], missingFields: [], requiresConfirmation: true };
  return response(`${prefix}\nPropuesta no guardada. Solo cambiará la programación de la misma actividad. Revisa y confirma en Calendario.`,
    "change_request", { operations: [operation], rescheduleMetadata: metadata });
}
