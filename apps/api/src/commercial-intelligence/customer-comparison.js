import { z } from "zod";
import {
  CUSTOMER_COMPARISON_DIMENSIONS, customerComparisonSpecPatch, customerComparisonSpecSchema, customerDateOnly,
} from "./turn-contract.js";
import {
  buildCustomerRecordListResponse, customerComparisonRecordBasis, normalizeCustomerSearchText,
  resolveCustomerListSpec, validateCustomerRecordList,
} from "./customer-record-list.js";

const DEFAULT_DIMENSIONS = ["amountUsd", "stageName", "commercialStatusCode", "closeDate"];
const LABELS = {
  amountUsd: "Importe registrado USD", stageName: "Etapa", commercialStatusCode: "Estado comercial",
  closeDate: "Cierre previsto", associatedContact: "Contacto asociado",
};
const STATUS_LABELS = { en_proceso: "En proceso", ganada: "Ganada", perdida: "Perdida", anulada: "Anulada" };
const STATES = { not_recorded: "No registrado", invalid: "Dato inválido", unavailable: "No verificable en la lectura autorizada", restricted: "No accesible por permisos o política" };
const continuation = (movement) => ["continue", "correct", "answer_clarification", "select_candidate", "request_rationale"].includes(movement);
const idsSchema = z.array(z.number().int().positive()).min(2).max(5).refine((ids) => new Set(ids).size === ids.length);
const cellSchema = z.object({
  state: z.enum(["known", "not_recorded", "invalid", "unavailable", "restricted"]),
  value: z.union([z.string().max(1000), z.number().finite(), z.null()]),
  identity: z.union([z.string().max(1000), z.number().finite(), z.null()]),
}).strict();
const rowSchema = z.object({
  id: z.number().int().positive(), name: z.string().max(1000),
  cells: z.partialRecord(z.enum(CUSTOMER_COMPARISON_DIMENSIONS), cellSchema),
}).strict();
const memorySchema = z.object({
  accountId: z.number().int().positive(), ids: idsSchema, spec: customerComparisonSpecSchema,
  rows: z.array(rowSchema).min(2).max(5), partial: z.boolean(),
  partialReasons: z.array(z.string().max(1000)).max(10),
  relationshipContactId: z.number().int().positive().nullable(),
}).strict();
const response = (answer, responseType = "informational", extra = {}) => ({
  answer, responseType, operations: [], recommendedActions: [], inferences: [], pendingItems: [],
  evidence: [], confidence: "medium", source: "account_intelligence", ...extra,
});
function records(snapshot) {
  return [...new Map([...(snapshot.opportunities || []), ...(snapshot.inactiveOpportunities || []),
    ...(snapshot.selectedOpportunity ? [snapshot.selectedOpportunity] : [])]
    .filter((item) => Number(item.accountId) === Number(snapshot.account?.id))
    .map((item) => [Number(item.id), item])).values()];
}
function relationVisible(snapshot, id, ids) {
  return snapshot.permissions?.canReadContacts !== false &&
    [...(snapshot.contacts || []), ...(snapshot.selectedContact ? [snapshot.selectedContact] : [])].some((item) =>
      Number(item.id) === id && Number(item.accountId) === Number(snapshot.account.id) && item.activationStatusCode === "activado") &&
    ids.every((target) => records(snapshot).some((item) => Number(item.id) === target && Number(item.contactId) === id));
}
export function validateCustomerComparisonMemory(value, snapshot) {
  const parsed = memorySchema.safeParse(value);
  if (!parsed.success || parsed.data.accountId !== Number(snapshot.account?.id) ||
      snapshot.permissions?.canReadOpportunities === false) return null;
  const memory = parsed.data;
  const dimensions = memory.spec.dimensions;
  if (!dimensions?.length || new Set(dimensions).size !== dimensions.length ||
      memory.spec.unsupported?.length || memory.spec.clarification ||
      memory.rows.length !== memory.ids.length ||
      memory.rows.some((row, index) => row.id !== memory.ids[index] ||
        Object.keys(row.cells).length !== dimensions.length || dimensions.some((dimension) => !row.cells[dimension] ||
          (row.cells[dimension].state === "known"
            ? row.cells[dimension].value === null || row.cells[dimension].identity === null
            : row.cells[dimension].value !== null || row.cells[dimension].identity !== null))) ||
      memory.ids.some((id) => !records(snapshot).some((item) => Number(item.id) === id)) ||
      (dimensions.includes("associatedContact") && snapshot.permissions?.canReadContacts === false &&
        memory.rows.some((row) => row.cells.associatedContact.state === "known")) ||
      (memory.relationshipContactId && !relationVisible(snapshot, memory.relationshipContactId, memory.ids))) return null;
  if (memory.spec.calculations?.some((calc) => !validCalculation(calc, dimensions, memory.ids.length))) return null;
  return memory;
}
function validCalculation(calc, dimensions, count) {
  return calc.fromPosition > 0 && calc.toPosition > 0 && calc.fromPosition <= count && calc.toPosition <= count &&
    calc.fromPosition !== calc.toPosition && dimensions.includes(calc.kind === "date_days" ? "closeDate" : "amountUsd");
}

export function resolveCustomerComparisonRequest({ component, movement, previous, previousList, snapshot, context }) {
  const fail = (error, responseType = "clarification") => ({ error, responseType });
  if (component.object !== "opportunity") return fail("G05 solo compara oportunidades de la cuenta seleccionada.", "informational");
  if (!snapshot.account?.id || Number(context.accountId) !== Number(snapshot.account.id)) return fail("Selecciona una cuenta autorizada para comparar.");
  const comparisonText = String(component.text || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es");
  const selectedAccount = normalizeCustomerSearchText(snapshot.account.name);
  const crossAccountMatch = comparisonText.match(/\bcompara(?:r)?\s+(?:la cuenta\s+)?(.+?)\s+(?:con|contra)\s+(.+?)(?:\s+sin cambiar|\?|\.|$)/);
  if (crossAccountMatch && [crossAccountMatch[1], crossAccountMatch[2]]
    .some((value) => normalizeCustomerSearchText(value) === selectedAccount) &&
    normalizeCustomerSearchText(crossAccountMatch[1]) !== normalizeCustomerSearchText(crossAccountMatch[2])) {
    const rawCrossAccountMatch = String(component.text || "").match(/\bcompara(?:r)?\s+(?:la cuenta\s+)?(.+?)\s+(?:con|contra)\s+(.+?)(?:\s+sin cambiar|\?|\.|$)/i);
    const accounts = rawCrossAccountMatch ? [rawCrossAccountMatch[1], rawCrossAccountMatch[2]] : [crossAccountMatch[1], crossAccountMatch[2]];
    const otherAccount = accounts
      .find((value) => normalizeCustomerSearchText(value) !== selectedAccount);
    return fail(`La cuenta seleccionada es ${snapshot.account.name}. No consulté ni compararé ${otherAccount}, y no cambié la cuenta seleccionada.`, "informational");
  }
  const parsed = customerComparisonSpecSchema.safeParse(component.comparisonSpec || {});
  if (!parsed.success) return fail("La especificación de comparación contiene valores inválidos.");
  const patch = customerComparisonSpecPatch(parsed.data);
  if (patch.clarification) return fail(patch.clarification);
  if (patch.unsupported?.length) return fail(`No puedo completar estas dimensiones en G05: ${patch.unsupported.join(", ")}. Esta entrega solo compara campos actuales; pendientes e historial no están incluidos. No sustituí ni omití la parte solicitada.`, "informational");
  if (patch.accountReference && normalizeCustomerSearchText(patch.accountReference) !== normalizeCustomerSearchText(snapshot.account.name)) {
    return fail("La comparación está limitada a la cuenta seleccionada; no consultaré otra cuenta sin cambiarla en la interfaz.");
  }
  if (component.reference && !(patch.references?.length &&
      normalizeCustomerSearchText(component.reference) === selectedAccount)) {
    return fail("Indica todas las oportunidades por separado en la comparación; no interpretaré una referencia combinada como el conjunto completo.");
  }
  const prior = continuation(movement) ? previous : null;
  const edit = patch.edit || "replace";
  if (edit !== "replace" && !prior) return fail("No hay una comparación previa verificable a la que añadir o quitar oportunidades.");
  const explicitSet = Object.hasOwn(patch, "references") || Object.hasOwn(patch, "positions") || Object.hasOwn(patch, "set");
  if ((Object.hasOwn(patch, "references") && !patch.references.length) ||
      (Object.hasOwn(patch, "positions") && !patch.positions.length)) return fail("La selección está vacía. Indica las oportunidades; no ampliaré el conjunto.");
  if (patch.references?.length && (patch.positions?.length || patch.set === "previous_list")) return fail("No mezcles nombres y posiciones de un listado en una selección; precisa el conjunto.");
  let selected = [], relationshipContactId = prior?.relationshipContactId || null;
  if (patch.references?.length) {
    for (const reference of patch.references) {
      const matches = records(snapshot).filter((item) => normalizeCustomerSearchText(item.name) === normalizeCustomerSearchText(reference));
      if (matches.length !== 1) return fail("No pude resolver todas las oportunidades inequívocamente. Precisa los nombres; no comparé solo las restantes.");
      selected.push(Number(matches[0].id));
    }
    if (edit === "replace") relationshipContactId = null;
  } else if (explicitSet) {
    if (edit === "remove") {
      if (!patch.positions?.length || patch.positions.some((position) => !prior.ids[position - 1])) return fail("Indica posiciones presentadas de la comparación anterior para quitar.");
      selected = patch.positions.map((position) => prior.ids[position - 1]);
    } else {
      if (patch.set === "named") return fail("Indica los nombres de todas las oportunidades para comparar.");
      const list = validateCustomerRecordList(previousList, snapshot, snapshot.account.id);
      if (!list || list.object !== "opportunity") return fail("No hay un listado previo verificable; vuelve a listar o indica los nombres.");
      if (patch.positions?.some((position) => !list.ids[position - 1])) return fail("Una posición solicitada no existe en el listado presentado.");
      selected = patch.positions?.length ? patch.positions.map((position) => list.ids[position - 1]) : list.ids;
      relationshipContactId = list.relationshipContactId || null;
    }
  } else if (!prior) return fail("Indica entre 2 y 5 oportunidades distintas, por nombre o desde un listado previo.");
  else if (edit !== "replace") return fail("Indica qué nombres o posiciones deseas añadir o quitar.");
  let ids = explicitSet ? [...new Set(selected)] : [...prior.ids];
  if (edit === "add") ids = [...new Set([...prior.ids, ...selected])];
  if (edit === "remove") {
    if (selected.some((id) => !prior.ids.includes(id))) return fail("No puedo quitar una oportunidad que no estaba en la comparación.");
    ids = prior.ids.filter((id) => !selected.includes(id));
  }
  if (ids.length < 2 || ids.length > 5) return fail(`Se requieren entre 2 y 5 oportunidades distintas; la selección contiene ${ids.length}. Reduce o completa el conjunto; no lo recorté.`);
  if (relationshipContactId && !relationVisible(snapshot, relationshipContactId, ids)) return fail("No pude revalidar la relación del conjunto anterior; indica una selección nueva.");
  const dimensions = [...new Set(patch.dimensions || prior?.spec.dimensions || DEFAULT_DIMENSIONS)];
  if (!dimensions.length) return fail("Indica al menos una dimensión de comparación.");
  const changedSet = JSON.stringify(ids) !== JSON.stringify(prior?.ids);
  const calculations = patch.calculations || (!changedSet && !Object.hasOwn(patch, "dimensions") ? prior?.spec.calculations : null) ||
    (ids.length === 2 && dimensions.includes("amountUsd") ? [
      { kind: "difference", fromPosition: 1, toPosition: 2 }, { kind: "ratio", fromPosition: 1, toPosition: 2 },
    ] : []);
  if (calculations.some((calc) => !validCalculation(calc, dimensions, ids.length))) return fail("Precisa base y destino distintos por posición y la dimensión correspondiente para cada cálculo. No elegiré una base arbitraria.");
  const mode = patch.mode || "compare";
  if (mode === "explain" && (!prior || changedSet || JSON.stringify(dimensions) !== JSON.stringify(prior.spec.dimensions) ||
      JSON.stringify(calculations) !== JSON.stringify(prior.spec.calculations))) return fail("Para explicar se necesita la misma comparación previa; solicita comparar o actualizar con los nuevos criterios.");
  return { ids, relationshipContactId, previous: prior, spec: { dimensions, calculations, mode },
    questionText: String(component.text || ""),
    asksRecordIdentity: /\b(?:iguales?|mism[oa]s?|duplicad\w*)\b/i.test(component.text || "") };
}

function cell(state, value = null, identity = value) { return { state, value, identity }; }
function fieldCell(record, dimension) {
  const value = record[dimension];
  if (value === undefined) return cell("unavailable");
  if (value === null || value === "") return cell("not_recorded");
  if (dimension === "amountUsd") return typeof value === "number" && Number.isFinite(value) ? cell("known", value) : cell("invalid");
  if (dimension === "closeDate") return customerDateOnly(value) ? cell("known", customerDateOnly(value)) : cell("invalid");
  const text = String(value).trim();
  return text ? cell("known", text, dimension === "stageName" ? record.stageCode || text : text) : cell("not_recorded");
}
function contactCell(record, contactsRead, contactsAllowed, accountId, contactReadFailed) {
  if (!contactsAllowed || record.associatedContactStatus === "restricted") return cell("restricted");
  if (contactReadFailed) return cell("unavailable");
  if (record.associatedContactStatus === "not_recorded") return cell("not_recorded");
  const contact = contactsRead?.result?.find((item) => Number(item.id) === Number(record.associatedContactId) &&
    Number(item.accountId) === Number(accountId) && item.activationStatusCode === "activado");
  return record.associatedContactStatus === "available" && contact ? cell("known", String(contact.name), Number(contact.id)) : cell("unavailable");
}
const escapeCell = (value) => String(value).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const number = (value) => value.toLocaleString("es-MX", { maximumFractionDigits: 6 });
function display(cellValue, dimension) {
  if (cellValue.state !== "known") return STATES[cellValue.state];
  if (dimension === "amountUsd") return `USD ${number(cellValue.value)}`;
  return dimension === "commercialStatusCode" ? STATUS_LABELS[cellValue.value] || cellValue.value : cellValue.value;
}
function calculate(calc, rows) {
  const from = rows[calc.fromPosition - 1], to = rows[calc.toPosition - 1];
  const dimension = calc.kind === "date_days" ? "closeDate" : "amountUsd";
  const a = from.cells[dimension], b = to.cells[dimension];
  const title = `${calc.kind === "difference" ? "Diferencia de importe" : calc.kind === "ratio" ? "Razón de importes" :
    calc.kind === "percentage" ? "Variación porcentual" : "Diferencia de cierre"}: ${to.name} respecto de ${from.name}`;
  if (a.state !== "known" || b.state !== "known") return `${title}: no calculable por datos faltantes, inválidos o no verificables.`;
  if (["ratio", "percentage"].includes(calc.kind) && a.value === 0) return `${title}: no calculable; la base es cero.`;
  const result = calc.kind === "date_days" ? (Date.parse(`${b.value}T00:00:00Z`) - Date.parse(`${a.value}T00:00:00Z`)) / 86400000 :
    calc.kind === "difference" ? b.value - a.value : calc.kind === "ratio" ? b.value / a.value : (b.value - a.value) / a.value * 100;
  if (!Number.isFinite(result)) return `${title}: no calculable; el resultado excede el rango numérico admitido.`;
  return `${title}: ${calc.kind === "difference" ? `USD ${number(result)} (destino menos base)` : calc.kind === "ratio" ?
    `${number(result)} veces (destino/base)` : calc.kind === "percentage" ? `${number(result)} % ((destino − base)/base × 100)` :
      `${number(result)} días calendario (destino menos base)`}.`;
}

export function buildCustomerComparisonResponse({ request, snapshot, read, contactsRead, contactsAllowed = false, metrics = [] }) {
  const listSpec = resolveCustomerListSpec({ object: "opportunity", listSpec: {} }, null, "new_request").spec;
  const verified = buildCustomerRecordListResponse({
    object: "opportunity", spec: listSpec, account: snapshot.account, readToolResults: [read],
    snapshotQueryMetrics: metrics, collectionScopes: snapshot.collectionScopes,
  });
  if (verified.responseType === "error") return verified;
  const selected = request.ids.map((id) => read.result.find((item) => Number(item.id) === id && Number(item.accountId) === Number(snapshot.account.id)));
  if (selected.some((item) => !item)) return response("No pude revalidar todo el conjunto seleccionado; no comparé solo las oportunidades restantes.", "clarification");
  const wantsContact = request.spec.dimensions.includes("associatedContact");
  const contactMetrics = metrics.filter((metric) => metric.source === "contacts");
  const contactReadFailed = wantsContact && contactsAllowed && (!Array.isArray(contactsRead?.result) ||
    Boolean(contactsRead?.error || contactsRead?.queryFailed) || contactMetrics.some((metric) => metric.errorCode));
  const rows = selected.map((record) => ({
    id: Number(record.id), name: String(record.name || "").slice(0, 1000),
    cells: Object.fromEntries(request.spec.dimensions.map((dimension) => [dimension, dimension === "associatedContact"
      ? contactCell(record, contactsRead, contactsAllowed, snapshot.account.id, contactReadFailed) : fieldCell(record, dimension)])),
  }));
  const partialReasons = [...verified.listMetadata.partialReasons,
    ...(wantsContact && !contactsAllowed ? ["contacto no accesible por permisos o política"] : []),
    ...(contactReadFailed ? ["falló la lectura de contactos; no prueba ausencia de asociación"] : []),
    ...(wantsContact && rows.some((row) => ["unavailable", "restricted"].includes(row.cells.associatedContact.state))
      ? ["hay contactos no verificables o restringidos"] : []),
    ...(wantsContact && contactsAllowed && !contactReadFailed &&
      (!contactMetrics.length || contactMetrics.some((metric) => metric.truncated !== false)) ? ["completitud de contactos no verificada"] : []),
  ];
  const partial = partialReasons.length > 0;
  const uniqueReasons = [...new Set(partialReasons)];
  const changed = Boolean(request.previous && (JSON.stringify(rows) !== JSON.stringify(request.previous.rows) ||
    partial !== request.previous.partial || JSON.stringify(uniqueReasons) !== JSON.stringify(request.previous.partialReasons)));
  if (request.spec.mode === "explain" && changed) return response(
    "Los datos o la cobertura de la comparación anterior cambiaron. Solicita actualizar la comparación; conservé el conjunto, pero no presentaré la anterior como vigente.",
    "clarification", { comparisonMemory: request.previous });
  const coincidences = [], differences = [], missing = [];
  for (const dimension of request.spec.dimensions) {
    const known = rows.filter((row) => row.cells[dimension].state === "known");
    const identities = new Set(known.map((row) => row.cells[dimension].identity));
    if (known.length === rows.length && identities.size === 1) coincidences.push(`${LABELS[dimension]} coincide en todas.`);
    else if (identities.size > 1) differences.push(`${LABELS[dimension]} difiere entre las oportunidades con dato conocido.`);
    if (known.length < rows.length) missing.push(`${LABELS[dimension]}: ${rows.filter((row) => row.cells[dimension].state !== "known")
      .map((row) => `${row.name}: ${STATES[row.cells[dimension].state]}`).join("; ")}. No es una desventaja comercial demostrada.`);
  }
  const calculations = request.spec.calculations.map((calc) => calculate(calc, rows));
  const normalizedQuestion = String(request.questionText || "").normalize("NFD")
    .replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es");
  const asksWhyPresentedFirst = request.spec.mode === "explain" &&
    /\b(?:por que|razon)\b[\s\S]{0,100}\b(?:primero|orden)\b/i.test(normalizedQuestion);
  const evidence = [...coincidences, ...differences, ...missing, ...calculations];
  const table = [
    `| Oportunidad | ${request.spec.dimensions.map((dimension) => LABELS[dimension]).join(" | ")} |`,
    `| --- | ${request.spec.dimensions.map(() => "---").join(" | ")} |`,
    ...rows.map((row, index) => `| ${index + 1}. ${escapeCell(row.name)} | ${request.spec.dimensions.map((dimension) => escapeCell(display(row.cells[dimension], dimension))).join(" | ")} |`),
  ];
  const memory = {
    accountId: Number(snapshot.account.id), ids: request.ids, spec: { ...request.spec, mode: "compare" }, rows, partial, partialReasons: uniqueReasons,
    relationshipContactId: request.relationshipContactId,
  };
  return response([
    `Cuenta: ${escapeCell(snapshot.account.name)}. Comparación de ${rows.length} oportunidades por datos actuales registrados.`,
    ...(asksWhyPresentedFirst
      ? ["Esta comparación no generó un ranking ni priorizó una oportunidad; las filas siguen el orden en que se nombraron los registros.",
        ...(request.spec.dimensions.includes("amountUsd") && rows.every((row) => row.cells.amountUsd.state === "known")
          ? [`Si el único criterio fuera mayor importe registrado, ${
            rows.filter((row) => row.cells.amountUsd.value === Math.max(...rows.map((item) => item.cells.amountUsd.value)))
              .map((row) => `${escapeCell(row.name)} (USD ${number(row.cells.amountUsd.value)})`).join("; ")
          } quedaría primero por ese dato. Eso no implica mayor probabilidad de venta ni una recomendación comercial integral.`]
          : [])]
      : []),
    ...(request.asksRecordIdentity ? [
      `Son registros CRM distintos: ${rows.map((row) => `${escapeCell(row.name)} (ID ${row.id})`).join("; ")}. Que sus nombres se parezcan no demuestra que sean duplicados; no se fusionaron.`,
    ] : []),
    ...(partial ? [`Cobertura parcial: ${uniqueReasons.join("; ")}.`] : ["Cobertura del alcance autorizado recuperado verificada."]),
    ...table, "", `Coincidencias: ${coincidences.join(" ") || "No hay coincidencias acreditadas en todas las oportunidades."}`,
    `Diferencias: ${differences.join(" ") || "No hay diferencias acreditadas entre los valores conocidos."}`,
    ...(calculations.length ? ["Cálculos:", ...calculations] : []),
    ...(missing.length ? ["Datos faltantes y límites:", ...missing] : []),
    ...(request.spec.mode === "refresh" && request.previous ? [changed ? "Comparación actualizada: cambió respecto de la anterior." : "Comparación actualizada: sin cambios en los datos utilizados."] : []),
    "Importes registrados no son ingresos realizados; cierres previstos no son compromisos confirmados. La comparación no determina una ganadora, preparación comercial ni duplicidad.",
    ...(wantsContact ? ["La asociación de contacto no acredita autoridad de decisión, aprobación ni firma."] : []),
    "Solo campos actuales: no incluye pendientes ni historial. No se guardó ningún cambio CRM.",
  ].join("\n"), "informational", {
    comparisonMemory: memory, comparisonMetadata: {
      partial, partialReasons: uniqueReasons, count: rows.length, dimensions: request.spec.dimensions,
      table: { headers: ["Oportunidad", ...request.spec.dimensions.map((dimension) => LABELS[dimension])],
        rows: rows.map((row, index) => [`${index + 1}. ${row.name}`, ...request.spec.dimensions.map((dimension) => String(display(row.cells[dimension], dimension)))]) },
    },
    comparisonEvidence: evidence, evidence, confidence: partial ? "medium" : "high",
    recordList: { accountId: Number(snapshot.account.id), object: "opportunity", spec: listSpec, ids: request.ids,
      comparisonBasis: selected.map(customerComparisonRecordBasis),
      ...(request.relationshipContactId ? { relationshipContactId: request.relationshipContactId } : {}) },
    entities: { accountId: Number(snapshot.account.id), opportunityId: null, contactId: null },
  });
}
