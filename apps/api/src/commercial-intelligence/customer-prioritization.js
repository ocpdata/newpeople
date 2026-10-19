import { z } from "zod";
import { customerDateOnly, customerPrioritySpecPatch, customerPrioritySpecSchema, customerRecordListSpecPatch } from "./turn-contract.js";
import {
  buildCustomerRecordListResponse, customerPriorityRecordBasis, filterCustomerRecords,
  describeCustomerOpportunityFilters, normalizeCustomerSearchText, resolveCustomerListSpec, validateCustomerRecordList,
} from "./customer-record-list.js";
import { customerHistoryDate } from "./customer-history.js";

const continuation = (movement) => ["continue", "correct", "answer_clarification", "select_candidate", "request_rationale"].includes(movement);
const basisSchema = z.object({
  id: z.number().int().positive(), name: z.string().max(1000), amountUsd: z.number().finite().nullable(),
  closeDate: z.string().refine((value) => customerDateOnly(value) !== null).nullable(),
  stageCode: z.string().max(100), commercialStatusCode: z.string().max(100), activationStatusCode: z.string().max(100),
}).strict();
const idsSchema = z.array(z.number().int().positive()).max(1000).refine((ids) => new Set(ids).size === ids.length);
const memorySchema = z.object({
  accountId: z.number().int().positive(), spec: customerPrioritySpecSchema,
  targetIds: idsSchema.nullable(), sourceList: z.object({}).passthrough().nullable(),
  basis: z.array(basisSchema).max(1000), shownIds: idsSchema.max(50),
  today: z.string().refine((value) => customerDateOnly(value) !== null), timezone: z.string().max(100),
  partial: z.boolean(),
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

export function validateCustomerPriorityMemory(value, snapshot) {
  const parsed = memorySchema.safeParse(value);
  if (!parsed.success || parsed.data.accountId !== Number(snapshot.account?.id) ||
      snapshot.permissions?.canReadOpportunities === false) return null;
  const memory = parsed.data;
  if (!["amountUsd", "closeDate"].includes(memory.spec.criterion) || memory.spec.clarification ||
      memory.spec.unsupported?.length || memory.basis.length !== new Set(memory.basis.map((item) => item.id)).size) return null;
  if (!["collection", "named", "previous_list"].includes(memory.spec.set) ||
      !["asc", "desc", "nearest"].includes(memory.spec.direction) ||
      (memory.spec.direction === "nearest" && memory.spec.criterion !== "closeDate") ||
      ((memory.spec.set === "collection") !== (memory.targetIds === null)) ||
      (memory.targetIds && memory.basis.some((item) => !memory.targetIds.includes(item.id)))) return null;
  const visible = new Set(records(snapshot).map((item) => Number(item.id)));
  if ((memory.targetIds || []).some((id) => !visible.has(id)) ||
      memory.shownIds.some((id) => !visible.has(id) || !memory.basis.some((item) => item.id === id))) return null;
  const list = resolveCustomerListSpec({ object: "opportunity", listSpec: memory.spec.listSpec || {} }, null, "new_request", snapshot.account);
  if (list.error) return null;
  const sourceList = memory.sourceList ? validateCustomerRecordList(memory.sourceList, snapshot, memory.accountId) : null;
  if (memory.sourceList && !sourceList) return null;
  if ((memory.spec.set === "previous_list") !== Boolean(sourceList) ||
      (sourceList && JSON.stringify(memory.targetIds) !== JSON.stringify(sourceList.ids))) return null;
  return { ...memory, sourceList, spec: { ...memory.spec, listSpec: list.spec } };
}

export function resolveCustomerPriorityRequest({ component, movement, previous, previousList, snapshot, context }) {
  const fail = (error, responseType = "clarification") => ({ error, responseType });
  if (component.object !== "opportunity") return fail("La priorización solo admite oportunidades autorizadas.", "informational");
  if (!snapshot.account?.id || Number(context.accountId) !== Number(snapshot.account.id)) return fail("Selecciona una cuenta autorizada para priorizar.");
  const parsed = customerPrioritySpecSchema.safeParse(component.prioritySpec || {});
  if (!parsed.success) return fail("Los criterios de priorización no son válidos.");
  const patch = customerPrioritySpecPatch(parsed.data);
  if (patch.clarification) return fail(patch.clarification);
  if (patch.unsupported?.length) return fail(`Criterios de prioridad no soportados: ${patch.unsupported.join(", ")}. No inventé un score ni sustituí el criterio.`, "informational");
  if (patch.accountReference && normalizeCustomerSearchText(patch.accountReference) !== normalizeCustomerSearchText(snapshot.account.name)) {
    return fail("La priorización está limitada a la cuenta seleccionada; cambia la cuenta en la interfaz.");
  }
  const inherits = continuation(movement) && previous;
  if (Object.hasOwn(patch, "references") && !patch.references.length && patch.set !== "collection") {
    return fail("La lista de nombres está vacía. Indica las oportunidades o solicita explícitamente la colección general; no ampliaré el conjunto por omisión.");
  }
  const changedSet = Object.hasOwn(patch, "set") || Object.hasOwn(patch, "references") || Boolean(component.reference);
  const prior = inherits && !changedSet ? previous : null;
  const criterion = patch.criterion || (inherits ? previous.spec.criterion : null);
  if (!criterion || criterion === "unspecified") return fail("No puedo asegurar una venta ni inventar probabilidades. ¿Quieres priorizar por importe USD o por fecha de cierre registrada?");
  const changedCriterion = criterion !== previous?.spec.criterion;
  const spec = {
    set: patch.set || (patch.references?.length || component.reference ? "named" : prior?.spec.set || "collection"),
    references: patch.references || (component.reference ? [component.reference] : prior?.spec.references || []),
    criterion, direction: patch.direction || (!changedCriterion && inherits ? previous.spec.direction : null) ||
      (criterion === "amountUsd" ? "desc" : "nearest"),
    limit: patch.limit ?? (prior ? prior.spec.limit : 0), mode: patch.mode || "rank",
  };
  if (spec.direction === "nearest" && criterion !== "closeDate") return fail("El criterio de cierre próximo no se aplica al importe. Indica ascendente o descendente.");
  const suppliedList = patch.listSpec ? customerRecordListSpecPatch(patch.listSpec) : {};
  if (["sortBy", "sortDirection", "limit"].some((key) => Object.hasOwn(suppliedList, key))) {
    return fail("Expresa criterio, dirección y cantidad en la priorización; no aplicaré un orden o límite de listado distinto.");
  }
  if (Object.hasOwn(suppliedList, "columns")) return fail("La priorización presenta nombre, criterio, grupo y fundamento. Las columnas personalizadas corresponden a Q04/Q05; no las omití silenciosamente.", "informational");
  const list = resolveCustomerListSpec({ object: "opportunity", listSpec: suppliedList },
    prior ? { object: "opportunity", spec: prior.spec.listSpec } : null, prior ? "continue" : "new_request", snapshot.account);
  if (list.error) return fail(list.error, list.responseType);
  spec.listSpec = list.spec;
  let targetIds = prior?.targetIds || null;
  let sourceList = prior?.sourceList || null;
  if (!prior && spec.set === "previous_list") {
    sourceList = validateCustomerRecordList(previousList, snapshot, snapshot.account.id);
    if (!sourceList || sourceList.object !== "opportunity") return fail("No hay un listado previo de oportunidades verificable; vuelve a listar antes de priorizarlo.");
    targetIds = sourceList.ids;
  } else if (!prior && spec.set === "named") {
    if (!spec.references.length) return fail("Indica todos los nombres de las oportunidades que deseas priorizar.");
    const available = records(snapshot);
    const resolved = spec.references.map((reference) => {
      const matches = available.filter((item) => normalizeCustomerSearchText(item.name) === normalizeCustomerSearchText(reference));
      return matches.length === 1 ? Number(matches[0].id) : null;
    });
    if (resolved.some((id) => !id)) return fail("No pude resolver todas las oportunidades nombradas de forma inequívoca. Precisa cada nombre; no prioricé un subconjunto incompleto.");
    targetIds = [...new Set(resolved)];
  }
  if (spec.set === "collection" && spec.references.length) return fail("La colección general y los nombres explícitos son incompatibles. Precisa el conjunto sin omitir referencias.");
  if (spec.mode === "explain" && !prior) return fail("No hay una priorización previa verificable que pueda explicar. Solicita un ranking actualizado.");
  return { spec, targetIds, sourceList, previous: prior, position: component.listPosition || 0 };
}

export function buildCustomerPriorityResponse({ request, snapshot, read, metrics, now, timezone }) {
  const listResponse = buildCustomerRecordListResponse({
    object: "opportunity", spec: request.spec.listSpec, account: snapshot.account,
    readToolResults: [read], snapshotQueryMetrics: metrics, collectionScopes: snapshot.collectionScopes,
  });
  if (listResponse.responseType === "error") return listResponse;
  const recovered = [...new Map(read.result.filter((item) => Number(item.accountId) === Number(snapshot.account.id))
    .map((item) => [Number(item.id), item])).values()];
  if (request.targetIds?.some((id) => !recovered.some((item) => Number(item.id) === id))) {
    return response("No pude revalidar todo el conjunto seleccionado. No prioricé solo los registros restantes.", "clarification");
  }
  const eligible = filterCustomerRecords(recovered, "opportunity", request.spec.listSpec,
    (item) => request.targetIds === null || request.targetIds.includes(Number(item.id)));
  const today = customerHistoryDate(now, timezone);
  const { criterion, direction } = request.spec;
  const value = (item) => criterion === "closeDate" ? customerDateOnly(item.closeDate) :
    typeof item.amountUsd === "number" && Number.isFinite(item.amountUsd) ? item.amountUsd : null;
  const block = (item) => value(item) === null ? 2 :
    criterion === "closeDate" && direction === "nearest" && value(item) < today ? 1 : 0;
  eligible.sort((a, b) => block(a) - block(b) ||
    (value(a) === null || value(a) === value(b) ? 0 : (value(a) < value(b) ? -1 : 1) * (direction === "desc" ? -1 : 1)) ||
    Number(a.id) - Number(b.id));
  const basis = eligible.map(customerPriorityRecordBasis);
  const shown = eligible.slice(0, Math.min(request.spec.limit || 50, 50));
  const partial = listResponse.listMetadata.partialReasons.length > 0;
  const changed = request.previous && (JSON.stringify(basis) !== JSON.stringify(request.previous.basis) ||
    JSON.stringify(shown.map((item) => Number(item.id))) !== JSON.stringify(request.previous.shownIds) ||
    request.previous.partial !== partial || (criterion === "closeDate" &&
      (request.previous.today !== today || request.previous.timezone !== timezone)));
  const changedExplanationCriteria = request.previous && request.spec.mode === "explain" &&
    (criterion !== request.previous.spec.criterion || direction !== request.previous.spec.direction ||
      JSON.stringify(request.spec.listSpec) !== JSON.stringify(request.previous.spec.listSpec) ||
      request.spec.limit !== request.previous.spec.limit);
  if (request.spec.mode === "explain" && (changed || changedExplanationCriteria)) return response(
    "Los datos, el conjunto o la fecha de referencia del ranking anterior cambiaron. Solicita actualizar el ranking; no presentaré su orden anterior como vigente.", "clarification",
    { priorityMemory: request.previous },
  );
  if (request.spec.mode === "explain" && (!request.position || !shown[request.position - 1])) {
    return response("Indica una posición presentada del ranking anterior que deseas explicar.", "clarification", { priorityMemory: request.previous });
  }
  const labels = { amountUsd: "importe registrado USD", closeDate: "fecha de cierre registrada" };
  let group = 0, priorKey;
  const rows = shown.map((item, index) => {
    const key = `${block(item)}:${value(item)}`;
    if (key !== priorKey) group += 1;
    priorKey = key;
    const ties = value(item) !== null ? eligible.filter((other) => block(other) === block(item) && value(other) === value(item)).length : 0;
    const category = block(item) === 2 ? "Sin información suficiente para ordenar" :
      block(item) === 1 ? "Vencida: revisar fecha; fuera del ranking de cierres próximos" :
        criterion === "closeDate" && direction === "nearest" ? "Cierre desde hoy" : "Orden objetivo";
    return `${index + 1}. ${String(item.name).slice(0, 300)} | ${category} | ${value(item) === null ? "Dato no informado o inválido" :
      `${labels[criterion]}: ${criterion === "amountUsd" ? `USD ${value(item).toLocaleString("es-MX")}` : value(item)} | grupo ${group}${ties > 1 ? `; empate entre ${ties} oportunidades` : ""}`}.${
      criterion === "closeDate" && value(item) !== null && value(item) < today && block(item) === 0 ? " Fecha vencida: requiere revisión." : ""}`;
  });
  const last = shown.at(-1);
  const cutTies = last && value(last) !== null ? eligible.slice(shown.length)
    .filter((item) => block(item) === block(last) && value(item) === value(last)).length : 0;
  const countBlock = (number) => eligible.filter((item) => block(item) === number).length;
  const warning = partial ? `Cobertura parcial: ${listResponse.listMetadata.partialReasons.join("; ")}. El ranking solo cubre registros recuperados; no el total global.` :
    "Cobertura del alcance autorizado recuperado verificada.";
  const summary = [
    `Cuenta: ${String(snapshot.account.name).slice(0, 300)}. Priorización por ${labels[criterion]}, ${direction === "nearest" ? "cierre próximo" : direction === "desc" ? "descendente" : "ascendente"}.`,
    `Conjunto: ${{ collection: "colección autorizada filtrada", named: "oportunidades nombradas", previous_list: "exactamente las oportunidades del listado presentado" }[request.spec.set]}.`,
    describeCustomerOpportunityFilters(request.spec.listSpec),
    ...(request.spec.limit ? [`Cantidad solicitada: ${request.spec.limit}.`] : []),
    `Fecha de referencia: ${today} (${timezone}). Recuperados: ${recovered.length}; elegibles: ${eligible.length}; mostrados: ${shown.length}. Máximo: 50, sin paginación.`,
    warning,
    ...(criterion === "closeDate" && direction === "nearest" ? [
      `Bloques: cierres desde hoy ${countBlock(0)}; vencidas para revisión ${countBlock(1)}; sin fecha válida ${countBlock(2)}.`,
    ] : [`Sin dato válido para el criterio: ${countBlock(2)}.`]),
    ...(eligible.length > shown.length ? [`Presentación limitada: ${eligible.length - shown.length} elegibles recuperadas fuera del top.`] : []),
    ...(cutTies ? [`El corte deja fuera ${cutTies} oportunidades empatadas con la última mostrada; se respeta la cantidad solicitada.`] : []),
    "Empates con igual prioridad; ID solo estabiliza la presentación. Este orden no es una prioridad comercial integral ni predice o asegura una venta.",
    ...(request.spec.mode === "refresh" && request.previous ? [changed ? "Ranking actualizado: cambió respecto del anterior." : "Ranking actualizado: sin cambios en los datos utilizados."] : []),
  ];
  const memory = {
    accountId: Number(snapshot.account.id), spec: { ...request.spec, mode: "rank" }, targetIds: request.targetIds,
    sourceList: request.sourceList, basis, shownIds: shown.map((item) => Number(item.id)), today, timezone, partial,
  };
  const selectedRows = request.spec.mode === "explain" ? [rows[request.position - 1],
    `Fundamento: su posición depende únicamente de ${labels[criterion]} y del bloque indicado; no se utilizó otro criterio para romper empates.`] : rows;
  return response([...summary, "", ...(selectedRows.length ? selectedRows : ["No hay oportunidades elegibles en el conjunto autorizado recuperado."])].join("\n"),
    "informational", {
      priorityMemory: memory,
      priorityMetadata: { criterion, direction, today, timezone, partial, recovered: recovered.length, eligible: eligible.length, shown: shown.length, cutTies },
      recordList: {
        accountId: Number(snapshot.account.id), object: "opportunity", spec: request.spec.listSpec, ids: memory.shownIds,
        priorityBasis: shown.map(customerPriorityRecordBasis),
        prioritySetBasis: [...basis].sort((a, b) => a.id - b.id), priorityTargetIds: request.targetIds,
        ...(request.sourceList?.relationshipContactId ? { relationshipContactId: request.sourceList.relationshipContactId } : {}),
      },
      evidence: selectedRows.length ? selectedRows : ["Lectura autorizada de oportunidades sin coincidencias."],
      entities: { accountId: Number(snapshot.account.id), opportunityId: null, contactId: null },
      confidence: partial ? "medium" : "high",
    });
}
