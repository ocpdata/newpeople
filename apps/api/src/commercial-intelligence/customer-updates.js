import { randomUUID } from "node:crypto";
import { z } from "zod";
import { customerUpdateSpecSchema } from "./turn-contract.js";
import { normalizeCustomerSearchText } from "./customer-record-list.js";
import { CUSTOMER_UPDATE_FIELDS, CUSTOMER_UPDATE_LABELS, comparableCustomerUpdateValue, normalizeCustomerUpdateValue, parseCustomerUpdateAmount } from "../coach/customer-field-values.js";

const itemSchema = z.object({
  id: z.string().uuid(), field: z.string(), action: z.enum(["set", "clear", "pending"]),
  value: z.string().max(10000), status: z.enum(["pending", "completed", "discarded", "no_change"]),
}).strict();
const memorySchema = z.object({
  accountId: z.number().int().positive(), object: z.enum(["account", "contact", "opportunity"]),
  draftId: z.string().uuid(), revision: z.number().int().positive(),
  targetId: z.number().int().nonnegative(), targetReference: z.string().max(300),
  candidateIds: z.array(z.number().int().positive()).max(100),
  items: z.array(itemSchema).max(12),
}).strict();
const literal = (text, value) => String(text).replace(/\s+/g, " ").includes(String(value).replace(/\s+/g, " "));
const amountIsSupportedByEvidence = (value, evidence) => {
  const match = String(evidence).match(
    /(?:\b(?:USD|d[oó]lares|dollars)\s*(\d[\d.,]*)|(?:^|[^\d])(\d[\d.,]*)\s*(?:USD|d[oó]lares|dollars)\b)/i,
  );
  const mentionedAmount = match ? parseCustomerUpdateAmount(match[1] || match[2]) : null;
  const proposedAmount = parseCustomerUpdateAmount(value);
  return mentionedAmount !== null && proposedAmount !== null && mentionedAmount === proposedAmount;
};
const valueIsSupportedByEvidence = (change) =>
  literal(change.evidence, change.value) ||
  (change.field === "amountUsd" && amountIsSupportedByEvidence(change.value, change.evidence));
export function validateCustomerUpdateMemory(value, snapshot) {
  const parsed = memorySchema.safeParse(value);
  if (!parsed.success || parsed.data.accountId !== Number(snapshot?.account?.id)) return null;
  const memory = parsed.data;
  if (new Set(memory.items.map((item) => item.field)).size !== memory.items.length ||
      new Set(memory.items.map((item) => item.id)).size !== memory.items.length) return null;
  if (memory.items.some((item) => {
    if (!CUSTOMER_UPDATE_FIELDS[memory.object][item.field]) return true;
    try {
      if (item.action !== "pending") normalizeCustomerUpdateValue(memory.object, item.field, item.action === "clear" ? null : item.value);
      return false;
    } catch { return true; }
  })) return null;
  return memory;
}

export async function buildCustomerUpdateResponse({
  component, movement, question, snapshot, previous, metrics = [], readRecord, loadStates,
}) {
  const prior = validateCustomerUpdateMemory(previous, snapshot);
  const base = { updateMemory: prior, operations: [], evidence: [], recommendedActions: [], inferences: [], pendingItems: [],
    entities: { accountId: snapshot.account.id, opportunityId: null, contactId: null } };
  const stop = (answer, memory = prior, responseType = "clarification") => ({
    ...base, answer, responseType, updateMemory: memory,
  });
  const parsed = customerUpdateSpecSchema.safeParse(component.updateSpec);
  if (!parsed.success) return stop("Indica el registro, el campo permitido y el valor que quieres proponer. No se ejecutó ningún cambio.");
  const spec = parsed.data;
  if (spec.unsupported?.length) return stop(`Estos cambios no están disponibles en A02: ${spec.unsupported.join(", ")}. No sustituí la operación.`);
  if (component.scope === "collection") return stop("Solo puedo preparar cambios para un registro a la vez. Indica un destino concreto.");
  const newDraft = !prior || spec.mode === "start";
  if (prior && spec.mode === "start" && !["new_request", "change_focus"].includes(movement)) return stop("Confirma si quieres sustituir el borrador e iniciar otro destino.");
  if (!newDraft && component.object !== prior.object) return stop("El borrador corresponde a otro tipo de registro. Indica explícitamente un nuevo destino.");
  if (newDraft && component.object !== "account" && !spec.targetReference && !component.reference) {
    return stop(`¿Qué ${component.object === "contact" ? "contacto" : "oportunidad"} quieres actualizar? Indica su nombre; no elegiré un registro por suposición.`);
  }
  const memory = newDraft ? {
    accountId: Number(snapshot.account.id), object: component.object, draftId: randomUUID(), revision: 1,
    targetId: 0, targetReference: "", candidateIds: [], items: [],
  } : structuredClone(prior);
  if (!CUSTOMER_UPDATE_FIELDS[memory.object]) return stop("Ese tipo de registro no admite cambios A02.");
  const before = JSON.stringify(memory);
  const states = newDraft ? [] : await loadStates(memory.draftId);
  for (const row of states) {
    const operation = typeof row.operation === "string" ? JSON.parse(row.operation) : row.operation;
    const item = memory.items.find((item) => item.id === operation?.updateItemId);
    if (!item || operation.updateDraftId !== memory.draftId || operation.updateAccountId !== memory.accountId ||
        operation[`${memory.object}Id`] !== memory.targetId || operation.field !== item.field) continue;
    if (row.status === "completed") {
      const proposed = item.action === "pending" ? undefined :
        normalizeCustomerUpdateValue(memory.object, item.field, item.action === "clear" ? null : item.value);
      if (proposed !== comparableCustomerUpdateValue(item.field, operation.value)) {
        return stop("La versión anterior de este campo se guardó mientras corregías el borrador. No acredité tu nuevo valor como guardado. Inicia una nueva propuesta y revisa el valor actual.", prior, "error");
      }
      item.status = "completed";
    }
    else if (["cancelled", "rejected", "superseded"].includes(row.status)) item.status = "discarded";
  }
  if (!newDraft && spec.targetReference && normalizeCustomerSearchText(spec.targetReference) !== normalizeCustomerSearchText(memory.targetReference)) {
    if (memory.targetId) return stop("Cambiar el destino requiere iniciar explícitamente otro borrador. No trasladé los valores al otro registro.");
    memory.targetReference = spec.targetReference;
  } else if (spec.targetReference) memory.targetReference = spec.targetReference;
  if (!memory.targetReference && component.reference && !/^\d+$/.test(component.reference)) memory.targetReference = component.reference;
  const seen = new Set();
  for (const change of spec.changes) {
    if (seen.has(change.field) || !CUSTOMER_UPDATE_FIELDS[memory.object][change.field] ||
        !literal(question, change.evidence) || (change.action === "set" && (!change.value || !valueIsSupportedByEvidence(change))) ||
        (change.action !== "set" && change.value !== "")) {
      return stop(`El cambio no es válido o no conserva los datos explícitos de tu mensaje.${prior
        ? " Conservé el borrador anterior."
        : " No preparé ningún cambio."}`);
    }
    seen.add(change.field);
    if (change.field === "amountUsd" && change.action === "set" && !/\b(?:USD|d[oó]lares|dollars)\b/i.test(change.evidence)) return stop("Confirma el importe en USD/dólares; no asumí ni convertí la moneda.");
    if (!["pending", "remove"].includes(change.action)) {
      try { normalizeCustomerUpdateValue(memory.object, change.field, change.action === "clear" ? null : change.value); }
      catch (error) { return stop(`${CUSTOMER_UPDATE_LABELS[change.field]}: ${error.message}. No modifiqué el valor.`); }
    }
    const existing = memory.items.find((item) => item.field === change.field);
    if (existing && existing.status !== "pending") return stop("Ese campo ya fue atendido o retirado. Inicia otra propuesta para volver a modificarlo.");
    if (change.action === "remove") {
      if (!existing) return stop("Ese campo no está pendiente en el borrador.");
      existing.status = "discarded";
    } else if (existing) Object.assign(existing, { action: change.action, value: change.value });
    else memory.items.push({ id: randomUUID(), field: change.field, value: change.value, action: change.action, status: "pending" });
  }
  if (memory.items.length > 12) return stop("El borrador supera el máximo de 12 campos; reduce la solicitud.");
  if (spec.mode === "discard_current") {
    const active = memory.items.find((item) => item.status === "pending");
    if (active) active.status = "discarded";
  }
  if (!newDraft && JSON.stringify(memory) !== before) memory.revision += 1;
  if (spec.clarification) return stop(spec.clarification, memory);
  const sources = memory.object === "contact" ? ["contacts"] : memory.object === "opportunity" ? ["opportunities_active", "opportunities_inactive"] : ["account"];
  if (metrics.some((metric) => sources.includes(metric.source) && metric.errorCode)) {
    return stop("Falló la lectura autorizada necesaria para identificar el destino. No se interpreta como ausencia de registros.", memory, "error");
  }
  const records = memory.object === "account" ? [snapshot.account] : memory.object === "contact" ? snapshot.contacts || [] :
    [...(snapshot.opportunities || []), ...(snapshot.inactiveOpportunities || []), ...(snapshot.selectedOpportunity ? [snapshot.selectedOpportunity] : [])];
  const unique = [...new Map(records.filter((item) => Number(item.id) > 0 &&
    (memory.object === "account" || Number(item.accountId) === memory.accountId)).map((item) => [Number(item.id), item])).values()];
  if (memory.targetId && !unique.some((item) => Number(item.id) === memory.targetId)) {
    memory.targetId = 0;
    memory.candidateIds = [];
    memory.revision += 1;
    return stop("El destino anterior ya no está disponible en la cuenta. Inicia otro borrador con un destino autorizado antes de continuar.", memory);
  }
  if (!memory.targetId) {
    const ref = normalizeCustomerSearchText(memory.targetReference);
    const exact = unique.filter((record) => normalizeCustomerSearchText(record.name) === ref);
    const candidates = memory.object === "account" ? unique : exact.length ? exact :
      ref && !/^\d+$/.test(ref) ? unique.filter((record) => normalizeCustomerSearchText(record.name).includes(ref)) : [];
    const ids = candidates.map((record) => Number(record.id));
    if (component.listPosition > 0) {
      if (!prior || JSON.stringify(ids) !== JSON.stringify(prior.candidateIds) || !ids[component.listPosition - 1]) {
        memory.candidateIds = ids.slice(0, 100);
        return stop("Los candidatos cambiaron o la posición no es válida. Vuelve a seleccionar por nombre; no desplacé la selección.", memory);
      }
      memory.targetId = ids[component.listPosition - 1];
    } else if (candidates.length === 1) memory.targetId = ids[0];
    else {
      memory.candidateIds = ids.slice(0, 100);
      return stop(candidates.length
        ? `Elige un registro por nombre antes de preparar: ${candidates.slice(0, 100).map((record, index) => `${index + 1}. ${record.name}`).join("; ")}.${candidates.length > 100 ? " Hay más de 100 coincidencias; reduce la referencia." : ""}`
        : "Indica el nombre de un único registro autorizado de esta cuenta. No confío en IDs escritos en el mensaje.", memory);
    }
  }
  const target = unique.find((record) => Number(record.id) === memory.targetId);
  if (memory.object === "opportunity" && ["ganada", "perdida", "anulada"].includes(target.commercialStatusCode)) return stop("No puedes modificar una oportunidad cerrada.", memory, "error");
  const active = memory.items.find((item) => item.status === "pending");
  const metadata = {
    draftId: memory.draftId, revision: memory.revision, object: memory.object,
    accountName: snapshot.account.name, targetName: target.name, targetId: memory.targetId,
    status: "collecting", changes: memory.items.map((item) => ({ ...item, label: CUSTOMER_UPDATE_LABELS[item.field] })),
  };
  const finish = (answer, responseType = "informational", extra = {}) => ({
    ...base, answer, responseType, updateMemory: memory, updateMetadata: metadata,
    pendingItems: memory.items.filter((item) => item.status === "pending").map((item) => CUSTOMER_UPDATE_LABELS[item.field]),
    ...extra,
  });
  if (!active) {
    metadata.status = "finished";
    return finish("No quedan cambios pendientes en este borrador. Los estados de guardado se comprobaron contra las operaciones persistidas; retirar una propuesta no modifica el CRM.");
  }
  if (active.action === "pending") return finish(`Falta el valor propuesto de ${CUSTOMER_UPDATE_LABELS[active.field]}. No inventé un valor ni preparé la escritura.`, "clarification");
  let record;
  try { record = await readRecord(memory.object, memory.targetId); }
  catch (error) {
    if (!error.status) throw error;
    metadata.status = "blocked";
    return finish(error.message, "error");
  }
  if (!Object.hasOwn(record, active.field)) throw Object.assign(new Error("La lectura no devolvió el campo solicitado"), { code: "CUSTOMER_UPDATE_FIELD_NOT_READ" });
  const currentValue = comparableCustomerUpdateValue(active.field, record[active.field]);
  const value = normalizeCustomerUpdateValue(memory.object, active.field, active.action === "clear" ? null : active.value);
  Object.assign(metadata, { field: active.field, label: CUSTOMER_UPDATE_LABELS[active.field], currentValue, proposedValue: value,
    observedAt: new Date().toISOString(), status: currentValue === value ? "no_change" : "prepared" });
  if (currentValue === value) {
    active.status = "no_change";
    memory.revision += 1;
    metadata.revision = memory.revision;
    metadata.changes = memory.items.map((item) => ({ ...item, label: CUSTOMER_UPDATE_LABELS[item.field] }));
    return finish(`No hay cambio que aplicar en ${metadata.label}: el valor actual ya coincide. No se preparó ni guardó una operación. Puedes pedir el siguiente cambio pendiente.`);
  }
  const display = (val) => val === null ? "(vacío)" : String(val);
  const operation = {
    kind: `${memory.object}_field`, [`${memory.object}Id`]: memory.targetId,
    updateDraftId: memory.draftId, updateRevision: memory.revision, updateItemId: active.id, updateAccountId: memory.accountId,
    field: active.field, currentValue, value: value === null ? "" : value, title: `Cambiar ${metadata.label} de ${target.name}`,
    sourceChannel: "customer_account", requiresConfirmation: true, evidence: [], missingFields: [],
  };
  return finish([
    `Propuesta para ${target.name} en ${snapshot.account.name}. No se guardó ningún cambio.`,
    `${metadata.label}: ${display(currentValue)} → ${display(value)}.`,
    `Otros cambios pendientes: ${memory.items.filter((item) => item.status === "pending" && item.id !== active.id).map((item) => CUSTOMER_UPDATE_LABELS[item.field]).join(", ") || "ninguno"}.`,
    spec.mode === "next" ? "El cambio anterior sigue pendiente: pedir el siguiente no confirma que se haya guardado. Revísalo o descártalo explícitamente." : "",
    "Revisa el valor vigente y confirma en el control de ejecución. Un «sí» en el chat no ejecuta la operación.",
  ].filter(Boolean).join("\n"), "informational", { operations: [operation] });
}
