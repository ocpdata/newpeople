import { CUSTOMER_RECORD_FIELDS, customerDateOnly, customerRecordListSpecPatch, customerRecordListSpecSchema } from "./turn-contract.js";

export const CUSTOMER_RECORD_LIST_LIMIT = 50;
const SORT_FIELDS = {
  opportunity: ["name", "amountUsd", "closeDate"],
  contact: ["name", "positionTitle"],
};
const DEFAULT_COLUMNS = {
  opportunity: ["name", "amountUsd", "stageName", "commercialStatusCode"],
  contact: ["name", "positionTitle"],
};
const STATUS_LABELS = { en_proceso: "En proceso", ganada: "Ganada", perdida: "Perdida", anulada: "Anulada" };
const ACTIVATION_LABELS = { activada: "Activada", desactivada: "Desactivada" };
const SORT_LABELS = { name: "nombre", amountUsd: "importe USD", closeDate: "cierre previsto", positionTitle: "cargo" };
const OPERATOR_LABELS = { eq: "igual a", gt: "mayor que", gte: "mayor o igual que", lt: "menor que", lte: "menor o igual que" };
const TEXT_FIELDS = { opportunity: ["name"], contact: ["name", "positionTitle"] };

export function normalizeCustomerSearchText(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es").replace(/\s+/g, " ").trim();
}

function comparisonMatches(value, filter) {
  switch (filter.operator) {
    case "eq": return value === filter.value;
    case "gt": return value > filter.value;
    case "gte": return value >= filter.value;
    case "lt": return value < filter.value;
    case "lte": return value <= filter.value;
    default: return false;
  }
}

function contradictoryComparisons(filters) {
  const equals = filters.filter((filter) => filter.operator === "eq");
  if (equals.length) return !filters.every((filter) => comparisonMatches(equals[0].value, filter));
  const lower = filters.filter((filter) => ["gt", "gte"].includes(filter.operator))
    .sort((a, b) => a.value < b.value ? 1 : a.value > b.value ? -1 : Number(b.operator === "gt") - Number(a.operator === "gt"))[0];
  const upper = filters.filter((filter) => ["lt", "lte"].includes(filter.operator))
    .sort((a, b) => a.value < b.value ? -1 : a.value > b.value ? 1 : Number(b.operator === "lt") - Number(a.operator === "lt"))[0];
  return lower && upper && (lower.value > upper.value ||
    (lower.value === upper.value && (lower.operator === "gt" || upper.operator === "lt")));
}

export function formatCustomerRecordFields(object, record) {
  const value = (field) => record[field] === undefined ? "No disponible en la lectura"
    : record[field] === null || String(record[field]).trim() === "" ? "No informado" : String(record[field]);
  const fields = { name: `Nombre: ${value("name")}`, accountName: `Cuenta: ${value("accountName")}` };
  if (object === "opportunity") {
    Object.assign(fields, {
      amountUsd: `Importe (USD): ${record.amountUsd == null ? value("amountUsd") : `USD ${Number(record.amountUsd).toLocaleString("es-MX")}`}`,
      closeDate: `Cierre previsto: ${record.closeDate instanceof Date
        ? record.closeDate.toISOString().slice(0, 10)
        : record.closeDate ? String(record.closeDate).slice(0, 10) : value("closeDate")}`,
      stageName: `Etapa: ${value("stageName")}`,
      commercialStatusCode: `Estado comercial: ${STATUS_LABELS[record.commercialStatusCode] || value("commercialStatusCode")}`,
      activationStatusCode: `Activación: ${record.activationStatusName || ACTIVATION_LABELS[record.activationStatusCode] || value("activationStatusCode")}`,
      associatedContact: `Contacto asociado: ${record.associatedContact?.name || ({
        restricted: "No disponible por permisos o política del canal",
        not_recorded: "No informado",
      }[record.associatedContactStatus] || "No disponible en la lectura autorizada")}`,
    });
  } else {
    Object.assign(fields, {
      positionTitle: `Cargo: ${value("positionTitle")}`,
      email: `Correo: ${value("email")}`,
      phone: `Teléfono: ${value("phone")}`,
      mobile: `Móvil: ${value("mobile")}`,
    });
  }
  return fields;
}

export function resolveCustomerListSpec(component, previous, movement, account = null) {
  const object = component.object;
  if (!SORT_FIELDS[object]) return { error: "Los listados y búsquedas solo admiten oportunidades y contactos." };
  const result = customerRecordListSpecSchema.safeParse(component.listSpec || {});
  if (!result.success) return { error: "Los criterios contienen valores, operadores o fechas inválidos. Revisa la búsqueda antes de continuar.", responseType: "clarification" };
  const parsed = result.data;
  const patch = { ...customerRecordListSpecPatch(parsed) };
  if (patch.clarification) return { error: patch.clarification, responseType: "clarification" };
  if (patch.accountReference && (!account ||
      normalizeCustomerSearchText(patch.accountReference) !== normalizeCustomerSearchText(account.name))) {
    return { error: "La búsqueda está limitada a la cuenta seleccionada. Para consultar otra cuenta, selecciónala en la interfaz y valida el acceso.", responseType: "clarification" };
  }
  delete patch.accountReference;
  delete patch.clarification;
  const inherits = !["new_request", "change_focus", "stop", "reject", "discard_draft"].includes(movement) &&
    previous?.object === object;
  const spec = {
    statusCodes: [], stageCodes: [], activation: "all", sortBy: "name",
    sortDirection: "asc", limit: 0, columns: DEFAULT_COLUMNS[object],
    textFilters: [], amountFilters: [], closeDateFilters: [],
    ...(inherits ? previous.spec : {}), ...patch,
  };
  spec.statusCodes = [...new Set(spec.statusCodes)];
  spec.stageCodes = [...new Set(spec.stageCodes)];
  spec.columns = [...new Set(spec.columns.length ? spec.columns : DEFAULT_COLUMNS[object])];
  const unsupported = [
    ...(spec.unsupported || []),
    ...spec.columns.filter((field) => !CUSTOMER_RECORD_FIELDS[object].includes(field)),
    ...(!SORT_FIELDS[object].includes(spec.sortBy) ? [`orden por ${spec.sortBy}`] : []),
    ...spec.textFilters.filter((filter) => !TEXT_FIELDS[object].includes(filter.field))
      .map((filter) => `búsqueda de texto por ${filter.field}`),
    ...(object === "contact" && (spec.statusCodes.length || spec.stageCodes.length || spec.activation !== "all")
      ? ["filtros de oportunidad aplicados a contactos"] : []),
    ...(object === "contact" && (spec.amountFilters.length || spec.closeDateFilters.length)
      ? ["importe o cierre de oportunidad aplicado a contactos"] : []),
  ];
  if (unsupported.length) return { error: `Criterios o columnas no soportados: ${[...new Set(unsupported)].join(", ")}. No los sustituí ni mostré un listado con criterios distintos.` };
  delete spec.unsupported;
  if (contradictoryComparisons(spec.amountFilters) || contradictoryComparisons(spec.closeDateFilters)) {
    return { error: "Los límites del importe o de la fecha de cierre son contradictorios. Aclara los extremos y si deben incluirse; no ejecuté una búsqueda distinta.", responseType: "clarification" };
  }
  if (spec.textFilters.some((filter) => !normalizeCustomerSearchText(filter.value))) {
    return { error: "Indica un texto de búsqueda no vacío.", responseType: "clarification" };
  }
  return { spec };
}

export function validateCustomerRecordList(value, snapshot, accountId) {
  if (!value || Number(value.accountId) !== Number(accountId) ||
      Number(snapshot?.account?.id) !== Number(accountId) ||
      !SORT_FIELDS[value.object] || !Array.isArray(value.ids) ||
      value.ids.length > CUSTOMER_RECORD_LIST_LIMIT) return null;
  if (snapshot.permissions?.[value.object === "contact" ? "canReadContacts" : "canReadOpportunities"] === false) return null;
  const parsed = customerRecordListSpecSchema.safeParse(value.spec);
  if (!parsed.success) return null;
  const resolved = resolveCustomerListSpec({ object: value.object, listSpec: parsed.data }, null, "new_request");
  if (resolved.error) return null;
  const collection = value.object === "contact" ? snapshot.contacts || [] : [
    ...(snapshot.opportunities || []), ...(snapshot.inactiveOpportunities || []),
    ...(snapshot.selectedOpportunity ? [snapshot.selectedOpportunity] : []),
  ];
  const visible = new Set(collection.filter((record) => Number(record.accountId) === Number(accountId))
    .map((record) => Number(record.id)));
  if (new Set(value.ids).size !== value.ids.length ||
      value.ids.some((id) => !Number.isInteger(id) || id <= 0 || !visible.has(id))) return null;
  if (value.relationshipContactId !== undefined) {
    const contact = [...(snapshot.contacts || []), ...(snapshot.selectedContact ? [snapshot.selectedContact] : [])]
      .find((item) => item.id === value.relationshipContactId && Number(item.accountId) === Number(accountId) &&
        item.activationStatusCode === "activado");
    if (value.object !== "opportunity" || !contact || snapshot.permissions?.canReadContacts === false ||
        value.ids.some((id) => !collection.some((record) => Number(record.id) === id &&
          Number(record.contactId) === value.relationshipContactId))) return null;
  }
  if (value.priorityBasis !== undefined && (value.object !== "opportunity" ||
      !Array.isArray(value.priorityBasis) || value.priorityBasis.length !== value.ids.length ||
      value.priorityBasis.some((basis, index) => {
        const record = collection.find((item) => Number(item.id) === value.ids[index]);
        return !record || JSON.stringify(basis) !== JSON.stringify(customerPriorityRecordBasis(record));
      }))) return null;
  if (value.comparisonBasis !== undefined && (value.object !== "opportunity" ||
      !Array.isArray(value.comparisonBasis) || value.ids.length < 2 || value.ids.length > 5 ||
      value.comparisonBasis.length !== value.ids.length ||
      value.comparisonBasis.some((basis, index) => {
        const record = collection.find((item) => Number(item.id) === value.ids[index]);
        return !record || JSON.stringify(basis) !== JSON.stringify(customerComparisonRecordBasis(record));
      }))) return null;
  if (value.prioritySetBasis !== undefined) {
    if (!Array.isArray(value.prioritySetBasis) || value.prioritySetBasis.length > 1000 ||
        (value.priorityTargetIds !== null && (!Array.isArray(value.priorityTargetIds) ||
          value.priorityTargetIds.length > 1000 ||
          new Set(value.priorityTargetIds).size !== value.priorityTargetIds.length ||
          value.priorityTargetIds.some((id) => !Number.isInteger(id) || !visible.has(id))))) return null;
    const eligibleBasis = filterCustomerRecords([...new Map(collection
      .filter((item) => Number(item.accountId) === Number(accountId))
      .map((item) => [Number(item.id), item])).values()], "opportunity", resolved.spec,
    (item) => value.priorityTargetIds === null || value.priorityTargetIds.includes(Number(item.id)))
      .map(customerPriorityRecordBasis).sort((a, b) => a.id - b.id);
    if (JSON.stringify(eligibleBasis) !== JSON.stringify(value.prioritySetBasis)) return null;
  }
  return { accountId: Number(accountId), object: value.object, spec: resolved.spec, ids: [...value.ids],
    ...(value.priorityBasis ? { priorityBasis: value.priorityBasis.map((item) => ({ ...item })) } : {}),
    ...(value.comparisonBasis ? { comparisonBasis: value.comparisonBasis.map((item) => ({ ...item })) } : {}),
    ...(value.prioritySetBasis ? {
      prioritySetBasis: value.prioritySetBasis.map((item) => ({ ...item })),
      priorityTargetIds: value.priorityTargetIds === null ? null : [...value.priorityTargetIds],
    } : {}),
    ...(value.relationshipContactId !== undefined ? { relationshipContactId: value.relationshipContactId } : {}) };
}

export function customerComparisonRecordBasis(record) {
  return { ...customerPriorityRecordBasis(record), stageName: record.stageName || "" };
}

export function customerPriorityRecordBasis(record) {
  return {
    id: Number(record.id), name: record.name || "",
    amountUsd: typeof record.amountUsd === "number" && Number.isFinite(record.amountUsd) ? record.amountUsd : null,
    closeDate: customerDateOnly(record.closeDate), stageCode: record.stageCode || "",
    commercialStatusCode: record.commercialStatusCode || "", activationStatusCode: record.activationStatusCode || "",
  };
}

function compareRecords(a, b, field, direction) {
  const first = a[field];
  const second = b[field];
  const missing = (value) => value == null || String(value).trim() === "";
  if (missing(first) !== missing(second)) return missing(first) ? 1 : -1;
  const comparable = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "");
  const comparison = missing(first) ? 0 : field === "amountUsd"
    ? Number(first) - Number(second)
    : comparable(first).localeCompare(comparable(second), "es", { sensitivity: "base", numeric: true });
  return comparison * (direction === "desc" ? -1 : 1) || Number(a.id) - Number(b.id);
}

export function filterCustomerRecords(records, object, spec, recordFilter = () => true) {
  return records.filter((record) => recordFilter(record) && (object === "contact" || (
    (!spec.statusCodes.length || spec.statusCodes.includes(record.commercialStatusCode)) &&
    (!spec.stageCodes.length || spec.stageCodes.includes(record.stageCode)) &&
    (spec.activation === "all" || (spec.activation === "active"
      ? record.activationStatusCode === "activada"
      : record.activationStatusCode && record.activationStatusCode !== "activada"))
  )) && (spec.textFilters || []).every((filter) => {
    const text = normalizeCustomerSearchText(record[filter.field]);
    const target = normalizeCustomerSearchText(filter.value);
    return text !== "" && (filter.operator === "eq" ? text === target : text.includes(target));
  }) && (spec.amountFilters || []).every((filter) =>
    typeof record.amountUsd === "number" && Number.isFinite(record.amountUsd) && comparisonMatches(record.amountUsd, filter)
  ) && (spec.closeDateFilters || []).every((filter) => {
    const date = customerDateOnly(record.closeDate);
    return date !== null && comparisonMatches(date, filter);
  }));
}

export function describeCustomerOpportunityFilters(spec) {
  const conditions = [
    `estado comercial ${spec.statusCodes.length ? spec.statusCodes.map((code) => STATUS_LABELS[code]).join(", ") : "todos los disponibles"}`,
    `etapa ${spec.stageCodes.join(", ") || "todas las disponibles"}`,
    `activación ${{ all: "todas", active: "activadas", inactive: "no activadas" }[spec.activation]}`,
    ...(spec.textFilters || []).map((filter) => `${SORT_LABELS[filter.field]} ${filter.operator === "eq" ? "igual a" : "contiene"} ${JSON.stringify(filter.value)}`),
    ...(spec.amountFilters || []).map((filter) => `importe ${OPERATOR_LABELS[filter.operator]} USD ${filter.value.toLocaleString("es-MX")}`),
    ...(spec.closeDateFilters || []).map((filter) => `cierre ${OPERATOR_LABELS[filter.operator]} ${filter.value}`),
  ];
  return `Filtros (todos deben cumplirse): ${conditions.join("; ")}.`;
}

export function buildCustomerRecordListResponse({
  object, spec, account, readToolResults, snapshotQueryMetrics, collectionScopes = {},
  recordFilter = () => true, additionalPartialReasons = [],
}) {
  const base = {
    responseType: "informational", operations: [], recommendedActions: [], inferences: [],
    pendingItems: [], evidence: [], source: "account_intelligence", confidence: "medium",
    entities: { accountId: Number(account.id), opportunityId: null, contactId: null },
  };
  const toolName = object === "opportunity" ? "searchOpportunities" : "searchContacts";
  const sources = object === "opportunity" ? ["opportunities_active", "opportunities_inactive"] : ["contacts"];
  const metrics = sources.map((source) => snapshotQueryMetrics.find((metric) => metric.source === source));
  const reads = readToolResults.filter((read) => read.toolName === toolName);
  if (!reads.length || reads.some((read) => read.error || read.queryFailed || !Array.isArray(read.result)) ||
      metrics.some((metric) => metric?.errorCode)) {
    return { ...base, responseType: "error", answer: "No pude verificar el listado con las lecturas autorizadas. Un fallo de lectura no significa que no existan registros." };
  }
  const records = [...new Map(reads.flatMap((read) => read.result)
    .filter((record) => Number(record.accountId) === Number(account.id) && Number.isInteger(Number(record.id)) && Number(record.id) > 0)
    .map((record) => [Number(record.id), record])).values()];
  const matches = filterCustomerRecords(records, object, spec, recordFilter);
  matches.sort((a, b) => compareRecords(a, b, spec.sortBy, spec.sortDirection));
  const limit = Math.min(spec.limit || CUSTOMER_RECORD_LIST_LIMIT, CUSTOMER_RECORD_LIST_LIMIT);
  const shown = matches.slice(0, limit);
  const sourceComplete = !additionalPartialReasons.length && metrics.every((metric) => metric && metric.truncated === false && !metric.errorCode);
  const reasons = [...additionalPartialReasons, ...metrics.flatMap((metric, index) => !metric ? [`completitud no verificada: ${sources[index]}`]
    : metric.truncated !== false ? [`lectura limitada: ${sources[index]}`] : [])];
  const presentationLimited = matches.length > shown.length;
  const summary = [
    `Cuenta: ${account.name}. Listado de ${object === "opportunity" ? "oportunidades" : "contactos"} autorizados.`,
    object === "opportunity"
      ? describeCustomerOpportunityFilters(spec)
      : `Alcance de contactos: ${collectionScopes.contacts || "según la lectura autorizada; activación no verificada"}.`,
    ...(object === "contact" && (spec.textFilters?.length || spec.amountFilters?.length || spec.closeDateFilters?.length) ? [
      `Criterios adicionales (todos deben cumplirse): ${[
        ...(spec.textFilters || []).map((filter) => `${SORT_LABELS[filter.field]} ${filter.operator === "eq" ? "igual a" : "contiene"} ${JSON.stringify(filter.value)}`),
        ...(spec.amountFilters || []).map((filter) => `importe ${OPERATOR_LABELS[filter.operator]} USD ${filter.value.toLocaleString("es-MX")}`),
        ...(spec.closeDateFilters || []).map((filter) => `cierre ${OPERATOR_LABELS[filter.operator]} ${filter.value}`),
      ].join("; ")}.`,
    ] : []),
    ...(object === "opportunity" && collectionScopes.opportunities ? [`Política de historial: ${collectionScopes.opportunities}.`] : []),
    `Orden: ${SORT_LABELS[spec.sortBy]}, ${spec.sortDirection === "desc" ? "descendente" : "ascendente"}; vacíos al final, desempate por ID.`,
    `Recuperados: ${records.length}; coincidencias ${sourceComplete ? "" : "conocidas "}${matches.length}; mostrados: ${shown.length}.`,
    ...(spec.limit ? [`Cantidad solicitada: ${spec.limit}.`] : []),
    `Máximo de presentación: ${CUSTOMER_RECORD_LIST_LIMIT}.`,
    ...(!sourceComplete ? [`Resultado parcial: ${reasons.join("; ")}. No conozco el total global; el orden y la selección se aplican solo a los registros recuperados.`] : []),
    ...(presentationLimited ? ["La presentación está limitada; hay más coincidencias recuperadas que las mostradas."] : []),
    ...(sourceComplete && !presentationLimited ? ["Se muestran todas las coincidencias del alcance autorizado recuperado."] : []),
  ];
  const rows = shown.map((record, index) => {
    const fields = formatCustomerRecordFields(object, record);
    return `${index + 1}. ${spec.columns.map((column) => fields[column]).join(" | ")}`;
  });
  if (!shown.length) rows.push(sourceComplete
    ? "No hay coincidencias con esos filtros dentro del alcance autorizado."
    : "No hay coincidencias entre los registros recuperados; no puedo afirmar que no existan otras.");
  return {
    ...base, answer: [...summary, "", ...rows].join("\n"),
    evidence: [`Listado CRM autorizado: ${toolName}, cuenta ${account.id}.`],
    confidence: sourceComplete ? "high" : "medium",
    recordList: { accountId: Number(account.id), object, spec, ids: shown.map((record) => Number(record.id)) },
    listMetadata: {
      retrievedCount: records.length, knownMatchCount: matches.length, shownCount: shown.length,
      sourceComplete, presentationLimited, requestedLimit: spec.limit,
      appliedLimit: limit, partialReasons: reasons,
    },
  };
}
