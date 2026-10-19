import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { CUSTOMER_CREATION_FIELDS, customerCreationSpecSchema, customerDateOnly } from "./turn-contract.js";
import { normalizeCustomerSearchText } from "./customer-record-list.js";

const limits = {
  firstName: 120, lastName: 120, positionTitle: 120, email: 190, phone: 40,
  mobile: 30, department: 120, city: 120, stateRegion: 120, name: 180,
  amountUsd: 40, closeDate: 10, contactReference: 300,
};
const labels = {
  firstName: "Nombre", lastName: "Apellido", positionTitle: "Cargo", email: "Correo",
  phone: "Teléfono", mobile: "Móvil", department: "Departamento", city: "Ciudad",
  stateRegion: "Estado/región", name: "Nombre de oportunidad", amountUsd: "Importe USD",
  closeDate: "Cierre previsto", contactReference: "Contacto",
};
const memorySchema = z.object({
  accountId: z.number().int().positive(), object: z.enum(["contact", "opportunity"]),
  draftId: z.string().uuid(),
  revision: z.number().int().positive(),
  values: z.record(z.string(), z.string().max(500)),
  duplicateFingerprint: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  acknowledgedFingerprint: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
}).strict();
const normalized = (text) => String(text || "").replace(/\s+/g, " ").trim();
const containsLiteral = (text, value) => normalized(text).includes(normalized(value));
const amount = (value) => /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(value)
  && Number.isFinite(Number(value.replaceAll(",", ""))) ? Number(value.replaceAll(",", "")) : null;

function invalidValue(field, value) {
  if (!value || value.length > limits[field]) return true;
  if (["firstName", "lastName", "name"].includes(field)) return value.length < 2;
  if (field === "amountUsd") return amount(value) === null;
  if (field === "closeDate") return customerDateOnly(value) === null;
  if (field === "email") return !z.email().safeParse(value).success;
  return false;
}

export function validateCustomerCreationMemory(value, snapshot) {
  const parsed = memorySchema.safeParse(value);
  if (!parsed.success || parsed.data.accountId !== Number(snapshot?.account?.id)) return null;
  const memory = parsed.data;
  if (Object.entries(memory.values).some(([field, text]) =>
    !CUSTOMER_CREATION_FIELDS[memory.object].includes(field) || invalidValue(field, text))) return null;
  return memory;
}

function findCoincidences(object, values, records) {
  const name = normalizeCustomerSearchText(object === "contact"
    ? [values.firstName, values.lastName].filter(Boolean).join(" ") : values.name);
  const email = normalizeCustomerSearchText(values.email);
  return records.filter((record) => {
    const existing = normalizeCustomerSearchText(record.name || [record.firstName, record.lastName].filter(Boolean).join(" "));
    return (email && email === normalizeCustomerSearchText(record.email)) ||
      (name && existing && (name === existing || (name.length >= 3 && existing.includes(name))));
  }).map((record) => ({
    id: Number(record.id), name: String(record.name || [record.firstName, record.lastName].filter(Boolean).join(" ")),
    reason: email && email === normalizeCustomerSearchText(record.email) ? "Coincidencia de correo" : "Coincidencia de nombre",
  })).sort((a, b) => a.id - b.id);
}

export function buildCustomerCreationResponse({
  component, movement, question, snapshot, previous = null, metrics = [], contactsAllowed = true,
  opportunitiesAllowed = true,
}) {
  const prior = validateCustomerCreationMemory(previous, snapshot);
  const base = {
    operations: [], recommendedActions: [], evidence: [], inferences: [], pendingItems: [],
    entities: { accountId: snapshot.account.id, opportunityId: null, contactId: null },
    creationMemory: prior,
  };
  const stop = (answer, responseType = "clarification") => ({ ...base, answer, responseType });
  const parsed = customerCreationSpecSchema.safeParse(component.creationSpec);
  if (!parsed.success) return stop("Necesito los datos explícitos del nuevo contacto u oportunidad para preparar el borrador. No se guardó ningún registro.");
  const spec = parsed.data;
  const normalizedQuestion = String(question || "").normalize("NFD")
    .replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es");
  const asksToCreateContact = /\b(?:crea(?:r)?|agrega(?:r)?|anade|registra(?:r)?|dar de alta)\b[\s\S]{0,80}\bcontacto\b|\bcontacto\s+nuevo\b/i
    .test(normalizedQuestion);
  const asksToCreateOpportunity = /\b(?:crea(?:r)?|agrega(?:r)?|anade|registra(?:r)?|dar de alta)\b[\s\S]{0,80}\b(?:oportunidad|negocio)\b|\b(?:oportunidad|negocio)\s+nuev[oa]\b/i
    .test(normalizedQuestion);
  if ((asksToCreateContact && component.object !== "contact" && !asksToCreateOpportunity) ||
      (asksToCreateOpportunity && component.object !== "opportunity" && !asksToCreateContact)) {
    return stop(`El mensaje pide crear ${asksToCreateContact ? "un contacto" : "una oportunidad"}, pero el borrador recibido es de otro tipo. No preparé ningún registro; confirma los datos del registro correcto.`);
  }
  if (spec.clarification || spec.unsupported?.length) return stop(spec.clarification ||
    `No puedo preparar esos campos o varias altas: ${spec.unsupported.join(", ")}. Indica un contacto u oportunidad.`);
  if (prior && spec.mode === "start" && !["new_request", "change_focus"].includes(movement)) {
    return stop("Confirma si quieres iniciar otro borrador. Conservé el anterior sin sustituirlo.");
  }
  if (prior && component.object !== prior.object && spec.mode !== "start") {
    return stop("Hay un borrador de otro tipo. Confirma si quieres iniciar un nuevo contacto u oportunidad; no mezclé los datos.");
  }
  const continuing = prior && prior.object === component.object && spec.mode !== "start";
  if (prior && !continuing && spec.mode !== "start") {
    return stop("Confirma si quieres iniciar otro borrador o continuar el anterior.");
  }
  if (!prior && ["continue", "review"].includes(spec.mode) && !spec.fields.length) {
    return stop("No hay un borrador vigente para esta cuenta. Indica los datos del nuevo contacto u oportunidad.");
  }
  const values = { ...(continuing ? prior.values : {}) };
  const seen = new Set();
  for (const entry of spec.fields) {
    if (seen.has(entry.field) || !CUSTOMER_CREATION_FIELDS[component.object]?.includes(entry.field) ||
        !containsLiteral(question, entry.evidence) ||
        (entry.value && (!containsLiteral(entry.evidence, entry.value) || invalidValue(entry.field, entry.value)))) {
      return stop(`Revisa el dato de ${labels[entry.field] || entry.field}: no es válido o no está respaldado literalmente por tu mensaje.${continuing
        ? " Conservé el borrador anterior."
        : " No preparé ningún registro."}`);
    }
    if (entry.field === "amountUsd" && entry.value && !/\b(?:USD|d[oó]lares|dollars)\b/i.test(entry.evidence)) {
      return stop("Confirma el importe en USD/dólares. No convertí ni asumí la moneda.");
    }
    seen.add(entry.field);
    if (entry.value) values[entry.field] = entry.value;
    else delete values[entry.field];
  }
  const memory = {
    accountId: Number(snapshot.account.id), object: component.object,
    draftId: continuing ? prior.draftId : randomUUID(), revision: continuing ? prior.revision : 1, values,
    duplicateFingerprint: null, acknowledgedFingerprint: null,
  };
  const scopedRecords = (items) => [...new Map(items.filter((item) =>
    Number(item.accountId ?? item.account_id) === memory.accountId &&
      Number.isSafeInteger(Number(item.id)) && Number(item.id) > 0)
    .map((item) => [Number(item.id), item])).values()];
  const contactRecords = contactsAllowed ? scopedRecords(snapshot.contacts || []) : [];
  const opportunityRecords = opportunitiesAllowed ? scopedRecords([
    ...(snapshot.opportunities || []), ...(snapshot.inactiveOpportunities || []),
    ...(snapshot.selectedOpportunity ? [snapshot.selectedOpportunity] : []),
  ]) : [];
  const sources = component.object === "contact" ? ["contacts"] : ["opportunities_active", "opportunities_inactive"];
  const failed = metrics.some((metric) => sources.includes(metric.source) && metric.errorCode);
  const canCheck = !failed && (component.object === "contact" ? contactsAllowed : opportunitiesAllowed);
  const matches = canCheck ? findCoincidences(component.object, values,
    component.object === "contact" ? contactRecords : opportunityRecords) : [];
  if (matches.length) {
    memory.duplicateFingerprint = createHash("sha256").update(JSON.stringify({
      object: memory.object, values: Object.entries(values).sort(), matches,
    })).digest("hex");
    if (continuing && prior.acknowledgedFingerprint === memory.duplicateFingerprint) {
      memory.acknowledgedFingerprint = memory.duplicateFingerprint;
    }
    if (spec.duplicateDecision === "distinct") {
      if (!spec.duplicateEvidence || !containsLiteral(question, spec.duplicateEvidence) ||
          !continuing || prior.duplicateFingerprint !== memory.duplicateFingerprint) {
        return stop("Primero revisa las coincidencias del borrador actual y después confirma si se trata de otro registro.");
      }
      memory.acknowledgedFingerprint = memory.duplicateFingerprint;
    }
  }
  if (continuing && (JSON.stringify(Object.entries(values).sort()) !== JSON.stringify(Object.entries(prior.values).sort()) ||
      memory.duplicateFingerprint !== prior.duplicateFingerprint ||
      memory.acknowledgedFingerprint !== prior.acknowledgedFingerprint)) memory.revision += 1;
  const basicFields = component.object === "contact" ? ["firstName", "lastName"] : ["name"];
  const missing = basicFields.filter((field) => !values[field]);
  const moduleFields = component.object === "contact"
    ? ["Participación de compra", "Jerarquía", "Tipo de relación", "Influencia", "Estado laboral", "Activación"]
    : [...(!values.amountUsd ? ["Importe USD"] : []), ...(!values.closeDate ? ["Cierre previsto"] : []),
      ...(!values.contactReference ? ["Contacto"] : []), "Línea de negocio", "Vendedor", "Revisión de etapa y activación"];
  const warnings = [
    "La revisión solo cubre registros autorizados disponibles en esta lectura; no garantiza ausencia de duplicados. El módulo vuelve a validar al guardar.",
    ...(!canCheck ? [failed
      ? "Falló la lectura de coincidencias; no significa que no existan registros similares."
      : "No hay permiso o habilitación para consultar coincidencias de este tipo."] : []),
    ...(matches.length > 20 ? [`Hay ${matches.length} coincidencias; se muestran las primeras 20.`] : []),
  ];
  let contactId = null;
  let contactError = "";
  if (values.contactReference) {
    const candidates = contactRecords.filter((record) =>
      normalizeCustomerSearchText(record.name) === normalizeCustomerSearchText(values.contactReference));
    if (!contactsAllowed || metrics.some((metric) => metric.source === "contacts" && metric.errorCode)) {
      contactError = "No pude verificar el contacto solicitado con la lectura autorizada.";
    } else if (candidates.length !== 1) {
      contactError = "El contacto solicitado no tiene una coincidencia única autorizada. Aclara el nombre o retíralo para elegirlo en Oportunidades.";
    } else contactId = Number(candidates[0].id);
  }
  const duplicatePending = matches.length > 0 && memory.acknowledgedFingerprint !== memory.duplicateFingerprint;
  const metadata = {
    draftId: memory.draftId, object: memory.object, accountId: memory.accountId, accountName: snapshot.account.name,
    revision: memory.revision,
    status: duplicatePending ? "coincidence_review" : missing.length || contactError ? "collecting" : "prepared",
    fields: Object.entries(values).map(([field, value]) => ({ field, label: labels[field], value })),
    pendingFields: [...missing.map((field) => labels[field]), ...moduleFields],
    coincidences: matches.slice(0, 20), coincidenceCount: matches.length, warnings,
    duplicateAcknowledged: Boolean(memory.acknowledgedFingerprint),
  };
  const answer = [
    `Borrador de ${memory.object === "contact" ? "contacto" : "oportunidad"} en ${snapshot.account.name}. No se creó ningún registro.`,
    ...metadata.fields.map((field) => `${field.label}: ${field.value}`),
    ...(missing.length ? [`Falta completar: ${missing.map((field) => labels[field]).join(", ")}.`] : []),
    ...(matches.length ? [`Coincidencias posibles (no prueban duplicidad): ${matches.slice(0, 20).map((item) => `${item.name}: ${item.reason}`).join("; ")}.`] : []),
    ...(duplicatePending ? ["Indica si es otra persona/oportunidad o si te refieres a un registro existente. No preparé el alta para continuar hasta aclararlo."] : []),
    ...(contactError ? [contactError] : []),
    ...warnings,
    `Pendiente de completar o revisar en el módulo: ${moduleFields.join(", ")}.`,
    "Continuar abre el formulario; solo se guardará al completar y confirmar allí. Un permiso de solicitud puede requerir aprobación.",
  ].join("\n");
  const payload = { accountId: memory.accountId, ...Object.fromEntries(Object.entries(values)
    .filter(([field]) => field !== "contactReference")
    .map(([field, value]) => [field, field === "amountUsd" ? amount(value) : value])),
    ...(contactId ? { contactId } : {}) };
  return {
    ...base, answer, creationMemory: memory, creationMetadata: metadata,
    responseType: missing.length || duplicatePending || contactError ? "clarification" : "informational",
    pendingItems: metadata.pendingFields,
    operations: missing.length || duplicatePending || contactError ? [] : [{
      kind: memory.object === "contact" ? "create_contact" : "create_opportunity",
      creationDraftId: memory.draftId,
      creationRevision: memory.revision,
      title: memory.object === "contact" ? `Preparar contacto ${values.firstName} ${values.lastName}` : `Preparar oportunidad ${values.name}`,
      accountId: memory.accountId, contactId, opportunityId: null, interactionId: null, quotationVersionId: null,
      payload, targetModule: memory.object === "contact" ? "contacts" : "opportunities",
      requiresConfirmation: true, sourceChannel: "customer_account", evidence: [], missingFields: [],
    }],
  };
}
