import { describe, expect, it } from "vitest";
import {
  buildCustomerPriorityResponse, resolveCustomerPriorityRequest, validateCustomerPriorityMemory,
} from "../src/commercial-intelligence/customer-prioritization.js";
import { validateCustomerRecordList } from "../src/commercial-intelligence/customer-record-list.js";

const opportunity = (id, name, amountUsd, closeDate, extra = {}) => ({
  id, accountId: 1, name, amountUsd, closeDate, stageCode: "contacto_inicial",
  commercialStatusCode: "en_proceso", activationStatusCode: "activada", ...extra,
});
const items = [
  opportunity(1, "Seguridad de las APIs", 100000, "2026-11-18"),
  opportunity(2, "Hardware Refresh", 500000, "2027-01-31"),
  opportunity(3, "Vrf 2027", 500000, "2027-01-31"),
  opportunity(4, "Sin datos", null, null),
  opportunity(5, "Vencida", 0, "2026-10-16"),
  opportunity(6, "Hoy", 40000, "2026-10-17"),
  opportunity(7, "Otra cuenta", 999999, "2026-10-17", { accountId: 2 }),
];
const snapshot = {
  account: { id: 1, name: "Cuenta sintética" }, opportunities: items,
  permissions: { canReadOpportunities: true }, collectionScopes: { opportunities: "Históricos según gobierno" },
};
const metrics = ["opportunities_active", "opportunities_inactive"].map((source) => ({ source, truncated: false, errorCode: null }));
const now = new Date("2026-10-17T18:00:00Z");
const part = (prioritySpec = {}, extra = {}) => ({
  category: "guidance.prioritization", object: "opportunity", reference: "", prioritySpec, ...extra,
});
const resolve = (spec = {}, extra = {}) => resolveCustomerPriorityRequest({
  component: part(spec), movement: "new_request", previous: null, previousList: null,
  snapshot, context: { accountId: 1 }, ...extra,
});
const rank = (spec = { criterion: "amountUsd" }, extra = {}) => buildCustomerPriorityResponse({
  request: resolve(spec), snapshot, read: { toolName: "searchOpportunities", result: items },
  metrics, now, timezone: "America/Mexico_City", ...extra,
});

describe("G04 typed request resolution", () => {
  it("asks for an objective rather than inventing probabilities", () => {
    expect(resolve().error).toContain("No puedo asegurar");
    expect(resolve({ criterion: "unspecified" }).error).toContain("importe USD");
  });
  it.each([
    [{ unsupported: ["urgencia"] }, "no soportados"],
    [{ criterion: "risk" }, "no son válidos"],
    [{ criterion: "amountUsd", direction: "nearest" }, "no se aplica al importe"],
    [{ criterion: "amountUsd", accountReference: "Otra" }, "cuenta seleccionada"],
    [{ criterion: "amountUsd", clarification: "¿Cuál criterio?" }, "¿Cuál criterio?"],
    [{ criterion: "amountUsd", set: "collection", references: ["Hardware Refresh"] }, "incompatibles"],
    [{ criterion: "amountUsd", listSpec: { limit: 3 } }, "cantidad en la priorización"],
    [{ criterion: "amountUsd", listSpec: { sortBy: "closeDate" } }, "cantidad en la priorización"],
    [{ criterion: "amountUsd", listSpec: { columns: ["stageName"] } }, "columnas personalizadas"],
    [{ criterion: "amountUsd", references: [] }, "lista de nombres está vacía"],
    [{ criterion: "amountUsd", listSpec: { amountFilters: [{ operator: "gte", value: 10, currency: "MXN" }] } }, "no son válidos"],
  ])("does not silently omit unsupported criteria %j", (spec, expected) => {
    expect(resolve(spec).error).toContain(expected);
  });
  it("defaults criterion direction without claiming commercial priority", () => {
    expect(resolve({ criterion: "amountUsd" }).spec.direction).toBe("desc");
    expect(resolve({ criterion: "closeDate" }).spec.direction).toBe("nearest");
  });
  it("resolves all named references exactly, deduplicating by identity", () => {
    expect(resolve({ criterion: "closeDate", references: ["Hardware Refresh", "Vrf 2027", "Hardware Refresh"] }).targetIds).toEqual([2, 3]);
  });
  it.each([
    ["Hardware", "Vrf 2027"], ["Hardware Refresh", "No existe"], ["Otra cuenta"],
  ])("refuses an incomplete or out-of-account named set %j", (...references) => {
    expect(resolve({ criterion: "amountUsd", references }).error).toContain("todas las oportunidades");
  });
  it("does not resolve duplicate exact names arbitrarily", () => {
    expect(resolve({ criterion: "amountUsd", references: ["Hardware Refresh"] }, {
      snapshot: { ...snapshot, opportunities: [...items, opportunity(8, "Hardware Refresh", 2, null)] },
    }).error).toContain("inequívoca");
  });
  it("rejects another account and other object types", () => {
    expect(resolve({ criterion: "amountUsd" }, { context: { accountId: 2 } }).error).toContain("cuenta autorizada");
    expect(resolve({}, { component: part({}, { object: "contact" }) }).error).toContain("solo admite");
  });
  it("preserves filters and named identities on criterion change", () => {
    const first = rank({ criterion: "closeDate", references: ["Hardware Refresh", "Vrf 2027"], listSpec: { statusCodes: ["en_proceso"] } });
    const next = resolve({ criterion: "amountUsd" }, { movement: "continue", previous: first.priorityMemory });
    expect(next.targetIds).toEqual([2, 3]);
    expect(next.spec.direction).toBe("desc");
    expect(next.spec.listSpec.statusCodes).toEqual(["en_proceso"]);
  });
  it("does not inherit old filters on explicit replacement of the set", () => {
    const first = rank({ criterion: "amountUsd", listSpec: { amountFilters: [{ operator: "gte", value: 100000, currency: "USD" }] } });
    const next = resolve({ references: ["Hoy"] }, { movement: "continue", previous: first.priorityMemory });
    expect(next.targetIds).toEqual([6]);
    expect(next.spec.listSpec.amountFilters).toEqual([]);
  });
  it("uses exactly the previously presented list, not its unshown matches", () => {
    const previousList = { accountId: 1, object: "opportunity", spec: {}, ids: [2, 3] };
    expect(resolve({ criterion: "amountUsd", set: "previous_list" }, { previousList }).targetIds).toEqual([2, 3]);
    expect(resolve({ criterion: "amountUsd", set: "previous_list" }).error).toContain("listado previo");
  });
});

describe("G04 objective ranking and coverage", () => {
  it("orders amount descending with ties, real zero and null last (G04-01)", () => {
    const result = rank();
    expect(result.recordList.ids).toEqual([2, 3, 1, 6, 5, 4]);
    expect(result.answer).toContain("empate entre 2 oportunidades");
    expect(result.answer).toContain("importe registrado USD: USD 0");
    expect(result.answer).toContain("Sin información suficiente");
    expect(result.answer).toContain("no es una prioridad comercial integral");
    expect(result.operations).toEqual([]);
  });
  it("orders amount ascending while keeping missing data last", () => {
    expect(rank({ criterion: "amountUsd", direction: "asc" }).recordList.ids).toEqual([5, 6, 1, 2, 3, 4]);
  });
  it("ranks the exact three named opportunities with the registered tie (G04-02)", () => {
    const result = rank({ criterion: "closeDate", references: ["Seguridad de las APIs", "Hardware Refresh", "Vrf 2027"] });
    expect(result.recordList.ids).toEqual([1, 2, 3]);
    expect(result.answer).toContain("2026-11-18");
    expect(result.answer).toContain("2027-01-31");
    expect(result.answer).toContain("empate entre 2");
    expect(result.answer).not.toContain("USD 500");
  });
  it("separates today/future, overdue and missing for nearest close", () => {
    const result = rank({ criterion: "closeDate" });
    expect(result.recordList.ids).toEqual([6, 1, 2, 3, 5, 4]);
    expect(result.answer).toContain("cierres desde hoy 4; vencidas para revisión 1; sin fecha válida 1");
    expect(result.answer).toContain("fuera del ranking de cierres próximos");
  });
  it("honors explicit chronological ordering including overdue, without silently using nearest", () => {
    expect(rank({ criterion: "closeDate", direction: "asc" }).recordList.ids).toEqual([5, 6, 1, 2, 3, 4]);
    expect(rank({ criterion: "closeDate", direction: "desc" }).recordList.ids).toEqual([2, 3, 1, 6, 5, 4]);
    expect(rank({ criterion: "closeDate", direction: "asc" }).answer).toContain("Fecha vencida");
  });
  it("uses business timezone for today and preserves date-only deadlines", () => {
    const result = rank({ criterion: "closeDate" }, { now: new Date("2026-10-18T02:00:00Z"), timezone: "America/Mexico_City" });
    expect(result.priorityMetadata.today).toBe("2026-10-17");
    expect(result.recordList.ids[0]).toBe(6);
  });
  it("keeps the top strict and counts omitted known ties", () => {
    const result = rank({ criterion: "amountUsd", limit: 1 });
    expect(result.recordList.ids).toEqual([2]);
    expect(result.priorityMetadata.cutTies).toBe(1);
    expect(result.answer).toContain("deja fuera 1 oportunidades empatadas");
    expect(result.answer).toContain("5 elegibles recuperadas fuera del top");
  });
  it("filters before ranking and top using shared Q05 criteria", () => {
    const result = rank({ criterion: "amountUsd", limit: 1, listSpec: {
      textFilters: [{ field: "name", operator: "contains", value: "APIs" }],
      amountFilters: [{ operator: "gte", value: 100000, currency: "USD" }],
    } });
    expect(result.recordList.ids).toEqual([1]);
    expect(result.priorityMetadata.eligible).toBe(1);
  });
  it("deduplicates the recovered set and excludes other accounts", () => {
    const result = rank(undefined, { read: { toolName: "searchOpportunities", result: [...items, items[0]] } });
    expect(result.priorityMetadata.recovered).toBe(6);
    expect(new Set(result.recordList.ids).size).toBe(6);
  });
  it("does not break equal dates using amount", () => {
    const data = [opportunity(3, "Menor ID no más valor", 1, "2027-01-31"), opportunity(4, "Mayor valor", 999999, "2027-01-31")];
    const result = rank({ criterion: "closeDate" }, { read: { toolName: "searchOpportunities", result: data } });
    expect(result.recordList.ids).toEqual([3, 4]);
    expect(result.answer.match(/grupo 1; empate entre 2/g)).toHaveLength(2);
  });
  it.each([null, [], [{ source: "opportunities_active", truncated: true }]])("marks unknown or truncated coverage partial", (customMetrics) => {
    const result = rank(undefined, { metrics: customMetrics || [] });
    expect(result.priorityMetadata.partial).toBe(true);
    expect(result.answer).toContain("no el total global");
  });
  it("never turns source errors into empty success", () => {
    expect(rank(undefined, { read: { toolName: "searchOpportunities", error: "DB" } }).responseType).toBe("error");
    expect(rank(undefined, { metrics: [{ source: "opportunities_active", errorCode: "DB" }] }).responseType).toBe("error");
  });
  it("rejects a named subset that the authorized read no longer contains", () => {
    const request = resolve({ criterion: "amountUsd", references: ["Hardware Refresh", "Vrf 2027"] });
    const result = rank(undefined, { request, read: { toolName: "searchOpportunities", result: [items[1]] } });
    expect(result.responseType).toBe("clarification");
    expect(result.answer).toContain("todo el conjunto");
  });
  it("reports an empty authorized set explicitly", () => {
    const result = rank(undefined, { read: { toolName: "searchOpportunities", result: [] } });
    expect(result.responseType).toBe("informational");
    expect(result.answer).toContain("No hay oportunidades elegibles");
    expect(result.priorityMetadata.eligible).toBe(0);
  });
  it("caps at 50 after ranking the whole recovered collection", () => {
    const data = Array.from({ length: 60 }, (_, index) => opportunity(index + 1, `Caso ${index}`, index, null));
    const result = rank({ criterion: "amountUsd", limit: 100 }, { read: { toolName: "searchOpportunities", result: data } });
    expect(result.recordList.ids).toHaveLength(50);
    expect(result.recordList.ids[0]).toBe(60);
    expect(result.priorityMetadata.eligible).toBe(60);
  });
  it("treats invalid dates and nonfinite amounts as missing, not zero or a valid date", () => {
    const data = [opportunity(1, "Inválida", NaN, "2026-02-30"), opportunity(2, "Cero", 0, "2026-10-20")];
    expect(rank({ criterion: "amountUsd" }, { read: { toolName: "searchOpportunities", result: data } }).recordList.ids).toEqual([2, 1]);
    expect(rank({ criterion: "closeDate" }, { read: { toolName: "searchOpportunities", result: data } }).recordList.ids).toEqual([2, 1]);
  });
});

describe("G04 memory, explanations and ordinal integrity", () => {
  it("validates account-scoped memory without storing full records", () => {
    const memory = rank().priorityMemory;
    expect(validateCustomerPriorityMemory(memory, snapshot)).toEqual(memory);
    expect(validateCustomerPriorityMemory({ ...memory, accountId: 2 }, snapshot)).toBeNull();
    expect(validateCustomerPriorityMemory(memory, { ...snapshot, permissions: { canReadOpportunities: false } })).toBeNull();
  });
  it.each([
    { targetIds: [1] }, { shownIds: [999] }, { sourceList: { accountId: 1 } },
    { spec: { set: "collection", criterion: "amountUsd", direction: "nearest" } },
    { spec: { set: "named", criterion: "amountUsd", direction: "desc" } },
  ])("rejects inconsistent priority memory without broadening its set %j", (patch) => {
    expect(validateCustomerPriorityMemory({ ...rank().priorityMemory, ...patch }, snapshot)).toBeNull();
  });
  it("explains exactly the prior position, without a new arbitrary ranking", () => {
    const first = rank();
    const request = resolve({ mode: "explain" }, {
      movement: "continue", previous: first.priorityMemory, component: part({ mode: "explain" }, { listPosition: 2 }),
    });
    const result = rank(undefined, { request });
    expect(result.answer).toContain("2. Vrf 2027");
    expect(result.answer).toContain("Fundamento");
    expect(result.evidence[0]).toContain("2. Vrf 2027");
  });
  it.each(["amountUsd", "closeDate", "name", "stageCode", "commercialStatusCode", "activationStatusCode"])("does not explain stale %s as current", (field) => {
    const first = rank();
    const request = resolve({ mode: "explain" }, {
      movement: "continue", previous: first.priorityMemory, component: part({ mode: "explain" }, { listPosition: 1 }),
    });
    const result = rank(undefined, { request, read: { toolName: "searchOpportunities", result: items.map((item) =>
      item.id === 2 ? { ...item, [field]: field === "amountUsd" ? 600000 : field === "closeDate" ? "2027-02-01" : "Cambio" } : item) } });
    expect(result.responseType).toBe("clarification");
    expect(result.answer).toContain("cambiaron");
  });
  it("requires refresh when the day changes a nearest-close explanation", () => {
    const first = rank({ criterion: "closeDate" });
    const request = resolve({ mode: "explain" }, {
      movement: "continue", previous: first.priorityMemory, component: part({ mode: "explain" }, { listPosition: 1 }),
    });
    expect(rank(undefined, { request, now: new Date("2026-10-18T18:00:00Z") }).responseType).toBe("clarification");
  });
  it("reports whether an explicitly refreshed ranking changed", () => {
    const first = rank();
    const request = resolve({ mode: "refresh" }, { movement: "continue", previous: first.priorityMemory });
    expect(rank(undefined, { request }).answer).toContain("sin cambios");
    expect(rank(undefined, { request, read: { toolName: "searchOpportunities", result: items.slice(0, 3) } }).answer).toContain("cambió");
  });
  it("requires an existing position for explanation", () => {
    const first = rank();
    const request = resolve({ mode: "explain" }, { movement: "continue", previous: first.priorityMemory });
    expect(rank(undefined, { request }).responseType).toBe("clarification");
  });
  it("invalidates ordinal lists if ranking data change, without shifting positions", () => {
    const list = rank().recordList;
    expect(validateCustomerRecordList(list, snapshot, 1)).toEqual(list);
    expect(validateCustomerRecordList(list, { ...snapshot, opportunities: items.map((item) =>
      item.id === 2 ? { ...item, amountUsd: 900000 } : item) }, 1)).toBeNull();
  });
  it("invalidates top ordinals when an unshown candidate changes or a new eligible record appears", () => {
    const list = rank({ criterion: "amountUsd", limit: 1 }).recordList;
    expect(validateCustomerRecordList(list, snapshot, 1)).toEqual(list);
    expect(validateCustomerRecordList(list, { ...snapshot, opportunities: items.map((item) =>
      item.id === 1 ? { ...item, amountUsd: 900000 } : item) }, 1)).toBeNull();
    expect(validateCustomerRecordList(list, { ...snapshot, opportunities: [...items,
      opportunity(8, "Nueva", 900000, "2027-01-01")] }, 1)).toBeNull();
  });
});
