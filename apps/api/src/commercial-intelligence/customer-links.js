import { randomUUID } from "node:crypto";
import { z } from "zod";
import { customerLinkSpecSchema } from "./turn-contract.js";
import { normalizeCustomerSearchText as normalize } from "./customer-record-list.js";

const memorySchema = z.object({
  accountId: z.number().int().positive(), draftId: z.string().uuid(), revision: z.number().int().positive(),
  opportunityId: z.number().int().nonnegative(), contactId: z.number().int().nonnegative(),
  opportunityReference: z.string().max(300), contactReference: z.string().max(300),
  opportunityCandidates: z.array(z.number().int().positive()).max(100),
  contactCandidates: z.array(z.number().int().positive()).max(100),
  intent: z.enum(["assign", "replace", "add", "unspecified"]),
  currentContactId: z.number().int().positive().nullable(), observed: z.boolean(),
}).strict();
export function validateCustomerLinkMemory(value, snapshot) {
  const parsed = memorySchema.safeParse(value);
  return parsed.success && parsed.data.accountId === Number(snapshot?.account?.id) ? parsed.data : null;
}
const literal = (text, value) => String(text).replace(/\s+/g, " ").includes(String(value).replace(/\s+/g, " "));
export async function buildCustomerLinkResponse({ component, movement, question, snapshot, previous, metrics = [], readPair }) {
  const prior = validateCustomerLinkMemory(previous, snapshot);
  let memory = prior ? structuredClone(prior) : null;
  const response = (answer, responseType = "clarification", extra = {}) => ({
    answer, responseType, operations: [], evidence: [], recommendedActions: [], pendingItems: [],
    entities: { accountId: Number(snapshot.account.id), contactId: memory?.contactId || null, opportunityId: memory?.opportunityId || null },
    linkMemory: memory, ...extra,
  });
  const parsed = customerLinkSpecSchema.safeParse(component.linkSpec);
  if (!parsed.success) return response("Indica el contacto y la oportunidad de esta cuenta que quieres vincular. No se guardó ningún cambio.");
  const spec = parsed.data;
  if (spec.unsupported?.length || component.scope === "collection") return response("A04 solo permite un contacto existente y una oportunidad de la cuenta fija. No preparé relaciones múltiples, masivas ni ajenas.");
  if (spec.position && spec.selectionTarget === "none") return response("Indica si la posición corresponde a contactos u oportunidades.");
  if ((spec.opportunityReference || spec.contactReference || spec.intent !== "unspecified" || spec.position > 0) &&
      (!spec.evidence || !literal(question, spec.evidence) ||
        [spec.opportunityReference, spec.contactReference].some((ref) => ref && !literal(spec.evidence, ref)))) {
    return response("Las referencias no conservan los datos literales del mensaje actual. Conservé el borrador anterior.");
  }
  const fresh = !prior || spec.mode === "start";
  if (prior && fresh && !["new_request", "change_focus"].includes(movement)) return response("Indica explícitamente si quieres iniciar un nuevo vínculo.");
  if (fresh) memory = {
    accountId: Number(snapshot.account.id), draftId: randomUUID(), revision: 1,
    opportunityId: 0, contactId: 0, opportunityReference: "", contactReference: "",
    opportunityCandidates: [], contactCandidates: [], intent: "unspecified", currentContactId: null, observed: false,
  };
  const before = JSON.stringify(memory);
  for (const object of ["opportunity", "contact"]) {
    const key = `${object}Reference`;
    if (spec[key] && normalize(spec[key]) !== normalize(memory[key])) {
      memory[key] = spec[key]; memory[`${object}Id`] = 0; memory[`${object}Candidates`] = [];
      memory.observed = false;
    }
  }
  if (spec.intent !== "unspecified") memory.intent = spec.intent;
  const questions = [];
  for (const object of ["opportunity", "contact"]) {
    const sources = object === "contact" ? ["contacts"] : ["opportunities_active", "opportunities_inactive"];
    if (metrics.some((metric) => sources.includes(metric.source) && metric.errorCode)) {
      if (!fresh && (JSON.stringify(memory) !== before || spec.mode === "refresh")) memory.revision += 1;
      return response("Falló la lectura autorizada para resolver ambos extremos. No se interpreta como ausencia de registros.", "error");
    }
    const records = object === "contact" ? [...(snapshot.contacts || []), ...(snapshot.selectedContact ? [snapshot.selectedContact] : [])] :
      [...(snapshot.opportunities || []), ...(snapshot.inactiveOpportunities || []), ...(snapshot.selectedOpportunity ? [snapshot.selectedOpportunity] : [])];
    const unique = [...new Map(records.filter((item) => Number(item.accountId) === memory.accountId)
      .map((item) => [Number(item.id), item])).values()];
    const idKey = `${object}Id`, candidatesKey = `${object}Candidates`;
    if (memory[idKey] && !unique.some((item) => Number(item.id) === memory[idKey])) {
      memory[idKey] = 0; memory.observed = false;
    }
    if (memory[idKey] && !(spec.selectionTarget === object && spec.position)) continue;
    const ref = normalize(memory[`${object}Reference`]);
    const exact = unique.filter((item) => normalize(item.name) === ref);
    const matches = ref && !/^\d+$/.test(ref) ? exact.length ? exact : unique.filter((item) => normalize(item.name).includes(ref)) : [];
    const ids = matches.map((item) => Number(item.id));
    if (spec.selectionTarget === object && spec.position) {
      if (!prior || JSON.stringify(ids) !== JSON.stringify(prior[candidatesKey]) || !ids[spec.position - 1]) {
        memory[idKey] = 0; memory.observed = false;
        questions.push(`Los candidatos de ${object === "contact" ? "contacto" : "oportunidad"} cambiaron o la posición no es válida. Selecciona por nombre.`);
      } else memory[idKey] = ids[spec.position - 1];
    } else if (matches.length === 1) memory[idKey] = ids[0];
    else questions.push(matches.length
      ? `Elige ${object === "contact" ? "contacto" : "oportunidad"}: ${matches.slice(0, 100).map((item, index) => `${index + 1}. ${item.name}`).join("; ")}.${matches.length > 100 ? " Reduce la referencia; hay más de 100 coincidencias." : ""}`
      : `Indica el nombre de un ${object === "contact" ? "contacto" : "oportunidad"} autorizado de esta cuenta; no usaré IDs escritos ni cargo como identidad.`);
    memory[candidatesKey] = ids.slice(0, 100);
  }
  if (!fresh && (JSON.stringify(memory) !== before || spec.mode === "refresh")) memory.revision += 1;
  if (questions.length || spec.clarification) return response([spec.clarification, ...questions].filter(Boolean).join("\n"));
  let pair;
  try { pair = await readPair({ accountId: memory.accountId, opportunityId: memory.opportunityId, contactId: memory.contactId }); }
  catch (error) {
    if (!error.status) throw error;
    return response(error.message, "error");
  }
  const observedId = pair.currentContactId === null ? null : Number(pair.currentContactId);
  if (memory.observed && memory.currentContactId !== observedId && memory.revision === prior?.revision) memory.revision += 1;
  memory.currentContactId = observedId; memory.observed = true;
  const effect = observedId === memory.contactId ? "no_change" : observedId ? "replace" : "assign";
  const metadata = {
    draftId: memory.draftId, revision: memory.revision, accountName: pair.accountName,
    opportunityName: pair.opportunityName, contactName: pair.contactName,
    currentContactName: pair.currentContactName, currentContactId: observedId, effect,
    status: effect === "no_change" ? "no_change" : "prepared", observedAt: new Date().toISOString(),
  };
  const prefix = `${pair.accountName} · ${pair.opportunityName}.\nContacto actual: ${pair.currentContactName || "(sin contacto)"}.\nContacto propuesto: ${pair.contactName}.`;
  if (effect === "no_change") return response(`${prefix}\nYa existe este vínculo. No se preparó ni guardó una modificación.`, "informational", { linkMetadata: metadata });
  if (memory.intent === "add") return response(`${prefix}\nSolo existe un contacto asociado por oportunidad. No puedo agregar otro conservando ambos. Indica explícitamente si deseas sustituir la asociación.`, "clarification", { linkMetadata: { ...metadata, status: "blocked" } });
  if (memory.intent === "unspecified") return response(`${prefix}\nConfirma si deseas preparar esta ${effect === "replace" ? "sustitución" : "asignación"}. No se guardó ningún cambio.`, "clarification", { linkMetadata: { ...metadata, status: "collecting" } });
  const operation = {
    kind: "link_contact_to_opportunity", sourceChannel: "customer_account", targetModule: "opportunities",
    title: `${effect === "replace" ? "Sustituir" : "Asignar"} contacto de ${pair.opportunityName}`,
    accountId: memory.accountId, opportunityId: memory.opportunityId, contactId: memory.contactId,
    payload: { accountId: memory.accountId, contactId: memory.contactId },
    linkDraftId: memory.draftId, linkRevision: memory.revision, currentContactId: observedId,
    linkSummary: { accountName: pair.accountName, opportunityName: pair.opportunityName,
      contactName: pair.contactName, currentContactName: pair.currentContactName, effect },
    evidence: [], missingFields: [], requiresConfirmation: true,
  };
  return response(`${prefix}\n${effect === "replace" ? "Se sustituirá la asociación actual; no se conservarán ambos contactos." : "Se asignará el contacto propuesto."}\nPropuesta no guardada. Revisa y confirma en Oportunidades; decir «sí» en el chat no ejecuta el cambio.`,
    "informational", { operations: [operation], linkMetadata: metadata });
}
