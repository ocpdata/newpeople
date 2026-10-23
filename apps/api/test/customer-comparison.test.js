import { describe, expect, it } from "vitest";
import { buildCustomerComparisonResponse, resolveCustomerComparisonRequest, validateCustomerComparisonMemory } from "../src/commercial-intelligence/customer-comparison.js";
import { validateCustomerConversationContext } from "../src/commercial-intelligence/conversation-context.js";
import { validateCustomerRecordList } from "../src/commercial-intelligence/customer-record-list.js";

const items = Array.from({ length: 6 }, (_, index) => ({
  id: index + 1, accountId: 1, name: ["Hardware Refresh", "Hardware Refresh 3 Años", "Vrf", "Cuarta", "Quinta", "Sexta"][index],
  amountUsd: index === 0 ? 500000 : index === 1 ? 1500000 : index * 100,
  closeDate: "2027-01-31", stageName: "Identificación", stageCode: "identificacion",
  commercialStatusCode: "en_proceso", activationStatusCode: "activada",
  contactId: 20, associatedContactId: 20, associatedContactStatus: "available",
}));
const snapshot = {
  account: { id: 1, name: "Totalplay" }, opportunities: items,
  contacts: [{ id: 20, accountId: 1, name: "Kimberly", activationStatusCode: "activado" }],
  permissions: { canReadOpportunities: true, canReadContacts: true },
};
const metrics = ["opportunities_active", "opportunities_inactive", "contacts"].map((source) => ({ source, truncated: false }));
const references = items.slice(0, 2).map((item) => item.name);
const component = (comparisonSpec = {}) => ({ category: "guidance.comparison", object: "opportunity", reference: "", comparisonSpec });
const resolve = (spec = { references }, extra = {}) => resolveCustomerComparisonRequest({
  component: component(spec), movement: "new_request", snapshot, context: { accountId: 1 }, ...extra,
});
const compare = (spec = { references }, extra = {}) => buildCustomerComparisonResponse({
  request: resolve(spec), snapshot, read: { toolName: "searchOpportunities", result: items },
  contactsRead: { toolName: "searchContacts", result: snapshot.contacts }, contactsAllowed: true, metrics, ...extra,
});
const calc = (kind, fromPosition = 1, toPosition = 2) => ({ kind, fromPosition, toPosition });

describe("G05 selection and dimensions", () => {
  it("resolves similar names exactly and defaults only current dimensions", () => {
    expect(resolve().ids).toEqual([1, 2]);
    expect(resolve().spec.dimensions).toEqual(["amountUsd", "stageName", "commercialStatusCode", "closeDate"]);
  });
  it("accepts a redundant selected-account reference with a separately specified named set", () => {
    const result = resolve({ references: items.slice(0, 3).map((item) => item.name) }, {
      component: { ...component({ references: items.slice(0, 3).map((item) => item.name) }),
        reference: "Totalplay" },
    });
    expect(result.error).toBeUndefined();
    expect(result.ids).toEqual([1, 2, 3]);
    expect(resolve({}, { component: { ...component({}), reference: "Totalplay" } }).error).toContain("por separado");
  });
  it.each([
    [{}, "entre 2 y 5"],
    [{ references: [] }, "vacía"],
    [{ references: [references[0]] }, "contiene 1"],
    [{ references: [references[0], references[0]] }, "contiene 1"],
    [{ references: items.map((item) => item.name) }, "contiene 6"],
    [{ references: ["Hardware", references[1]] }, "todas las oportunidades"],
    [{ references: [references[0], "AT&T"] }, "todas las oportunidades"],
    [{ references, accountReference: "AT&T" }, "cuenta seleccionada"],
    [{ references, unsupported: ["pendientes"] }, "no están incluidos"],
    [{ references, clarification: "¿Cuáles?" }, "¿Cuáles?"],
    [{ references, dimensions: [] }, "al menos una"],
    [{ references, dimensions: ["probability"] }, "inválidos"],
    [{ references, set: "previous_list" }, "No mezcles"],
    [{ references, positions: [1] }, "No mezcles"],
    [{ set: "named" }, "nombres"],
    [{ positions: [] }, "vacía"],
    [{ references, edit: "add" }, "previa verificable"],
    [{ references, mode: "explain" }, "misma comparación previa"],
    [{ references, calculations: [calc("percentage", 0)] }, "base y destino"],
    [{ references, calculations: [calc("ratio", 1, 1)] }, "base y destino"],
    [{ references, calculations: [calc("ratio", 1, 3)] }, "base y destino"],
    [{ references, dimensions: ["closeDate"], calculations: [calc("difference")] }, "dimensión"],
  ])("does not silently substitute an invalid request %j", (spec, expected) => {
    expect(resolve(spec).error).toContain(expected);
  });
  it("deduplicates references and accepts exactly five distinct opportunities", () => {
    expect(resolve({ references: [...items.slice(0, 5).map((item) => item.name), references[0]] }).ids).toEqual([1, 2, 3, 4, 5]);
  });
  it("does not resolve duplicate exact names or foreign accounts", () => {
    expect(resolve(undefined, { snapshot: { ...snapshot, opportunities: [...items, { ...items[0], id: 8 }] } }).error).toContain("inequívocamente");
    expect(resolve(undefined, { snapshot: { ...snapshot, opportunities: items.map((item) => ({ ...item, accountId: 2 })) } }).error).toContain("inequívocamente");
    expect(resolve(undefined, { context: { accountId: 2 } }).error).toContain("cuenta autorizada");
    expect(resolve(undefined, { component: { ...component({ references }), object: "contact" } }).error).toContain("solo compara");
    expect(resolve(undefined, { component: { ...component({ references }), reference: "A y B" } }).error).toContain("por separado");
  });
  it("explains the selected-account boundary for a cross-account comparison request", () => {
    const result = resolve(undefined, {
      component: { ...component({ references }), text: "Compara Totalplay con AT&T sin cambiar la cuenta" },
    });
    expect(result.error).toContain("La cuenta seleccionada es Totalplay");
    expect(result.error).toContain("No consulté ni compararé AT&T");
    expect(result.error).toContain("no cambié la cuenta seleccionada");
  });
  it("uses exact displayed positions in their requested order, not top five", () => {
    const previousList = { accountId: 1, object: "opportunity", spec: {}, ids: [6, 4, 2] };
    expect(resolve({ set: "previous_list", positions: [3, 1] }, { previousList }).ids).toEqual([2, 6]);
    expect(resolve({ set: "previous_list" }, { previousList }).ids).toEqual([6, 4, 2]);
    expect(resolve({ set: "previous_list", positions: [4] }, { previousList }).error).toContain("no existe");
    expect(resolve({ set: "previous_list" }).error).toContain("listado previo");
    expect(resolve({ set: "previous_list" }, { previousList: { ...previousList, ids: [1, 2, 3, 4, 5, 6] } }).error).toContain("contiene 6");
  });
});

describe("G05 symmetric evidence and exact calculations", () => {
  it("compares amounts, shared data and exact arithmetic (G05-01)", () => {
    const result = compare();
    expect(result.comparisonMetadata).toMatchObject({ partial: false, count: 2 });
    expect(result.answer).toContain("USD 1,000,000");
    expect(result.answer).toContain("3 veces");
    expect(result.answer).toContain("Etapa coincide");
    expect(result.answer).toContain("Cierre previsto coincide");
    expect(result.answer).not.toContain("Kimberly");
    expect(result.comparisonMetadata.table.rows[0]).toEqual(["1. Hardware Refresh", "USD 500,000", "Identificación", "En proceso", "2027-01-31"]);
    expect(result.operations).toEqual([]);
  });
  it("does not infer duplication or choose a winner from similar names (G05-02)", () => {
    const result = buildCustomerComparisonResponse({
      request: resolve(undefined, { component: { ...component({ references }), text: "¿Son iguales porque las dos dicen Hardware Refresh?" } }),
      snapshot, read: { toolName: "searchOpportunities", result: items },
      contactsRead: { toolName: "searchContacts", result: snapshot.contacts }, contactsAllowed: true, metrics,
    });
    expect(result.answer).toContain("Son registros CRM distintos");
    expect(result.answer).toContain("Hardware Refresh (ID 1)");
    expect(result.answer).toContain("Hardware Refresh 3 Años (ID 2)");
    expect(result.answer).toContain("no determina una ganadora, preparación comercial ni duplicidad");
    expect(result.comparisonMemory.ids).toEqual([1, 2]);
  });
  it("keeps incomplete records and distinguishes zero, missing, unavailable and invalid", () => {
    const changed = [{ ...items[0], amountUsd: 0, closeDate: "2027-02-31" }, { ...items[1], amountUsd: null, closeDate: undefined }];
    const result = compare(undefined, { read: { toolName: "searchOpportunities", result: changed } });
    expect(result.comparisonMetadata.count).toBe(2);
    expect(result.answer).toContain("USD 0");
    expect(result.answer).toContain("Dato inválido");
    expect(result.answer).toContain("No registrado");
    expect(result.answer).toContain("No verificable");
    expect(result.answer).toContain("no calculable");
    expect(result.answer).not.toContain("NaN");
  });
  it("does not divide by zero and does not equate two missing values", () => {
    const result = compare({ references, calculations: [calc("ratio"), calc("percentage")] }, {
      read: { toolName: "searchOpportunities", result: items.slice(0, 2).map((item) => ({ ...item, amountUsd: 0, stageName: null })) },
    });
    expect(result.answer.match(/la base es cero/g)).toHaveLength(2);
    expect(result.answer).not.toContain("Etapa coincide");
  });
  it("calculates a percentage with an explicit base and reverse direction", () => {
    expect(compare({ references, calculations: [calc("percentage")] }).answer).toContain("200 %");
    expect(compare({ references, calculations: [calc("difference", 2, 1)] }).answer).toContain("USD -1,000,000");
  });
  it("computes date differences as calendar days", () => {
    const result = compare({ references, dimensions: ["closeDate"], calculations: [calc("date_days")] }, {
      read: { toolName: "searchOpportunities", result: [items[0], { ...items[1], closeDate: "2027-02-28" }] },
    });
    expect(result.answer).toContain("28 días calendario");
  });
  it("does not select arbitrary pairs among three opportunities", () => {
    const result = compare({ references: items.slice(0, 3).map((item) => item.name) });
    expect(result.comparisonMemory.spec.calculations).toEqual([]);
    expect(result.answer).not.toContain("veces");
  });
  it("rejects non-finite fields and reports overflowing calculations", () => {
    const read = { toolName: "searchOpportunities", result: [{ ...items[0], amountUsd: -Number.MAX_VALUE }, { ...items[1], amountUsd: Number.MAX_VALUE }] };
    expect(compare(undefined, { read }).answer).toContain("excede el rango");
    expect(compare(undefined, { read: { ...read, result: [{ ...items[0], amountUsd: NaN }, { ...items[1], amountUsd: Infinity }] } }).answer).toContain("Dato inválido");
  });
  it("uses authorized contact identity, not equal names or guessed roles", () => {
    const result = compare({ references, dimensions: ["associatedContact"] });
    expect(result.answer).toContain("Kimberly");
    expect(result.answer).toContain("Contacto asociado coincide");
    expect(result.answer).toContain("no acredita autoridad");
    const different = compare({ references, dimensions: ["associatedContact"] }, {
      read: { toolName: "searchOpportunities", result: [items[0], { ...items[1], associatedContactId: 21 }] },
      contactsRead: { result: [...snapshot.contacts, { ...snapshot.contacts[0], id: 21 }] },
    });
    expect(different.answer).toContain("Contacto asociado difiere");
  });
  it.each([
    [{ contactsAllowed: false }, "No accesible"],
    [{ contactsRead: { error: "FAILED" } }, "falló la lectura"],
    [{ contactsRead: { result: [] } }, "No verificable"],
    [{ contactsRead: { result: [{ ...snapshot.contacts[0], accountId: 2 }] } }, "No verificable"],
    [{ contactsRead: { result: [{ ...snapshot.contacts[0], activationStatusCode: "desactivado" }] } }, "No verificable"],
    [{ metrics: metrics.map((item) => item.source === "contacts" ? { ...item, errorCode: "FAILED" } : item) }, "falló la lectura"],
  ])("retains permitted fields and exposes contact limitations %j", (extra, expected) => {
    const result = compare({ references, dimensions: ["amountUsd", "associatedContact"] }, extra);
    expect(result.responseType).toBe("informational");
    expect(result.comparisonMetadata.partial).toBe(true);
    expect(result.answer).toContain(expected);
    expect(result.answer).toContain("USD 500,000");
    expect(result.answer).not.toContain("Kimberly");
  });
  it("distinguishes no recorded contact from an unverifiable destination", () => {
    const result = compare({ references, dimensions: ["associatedContact"] }, {
      read: { toolName: "searchOpportunities", result: [items[0], { ...items[1], associatedContactStatus: "not_recorded", associatedContactId: null }] },
    });
    expect(result.answer).toContain("No registrado");
    expect(result.comparisonMetadata.partial).toBe(false);
  });
  it("marks unknown/truncated coverage and rejects read failures or missing selected identities", () => {
    expect(compare(undefined, { metrics: [] }).comparisonMetadata.partial).toBe(true);
    expect(compare(undefined, { metrics: metrics.map((item) => ({ ...item, truncated: true })) }).comparisonMetadata.partial).toBe(true);
    expect(compare(undefined, { read: { toolName: "searchOpportunities", error: "FAILED" } }).responseType).toBe("error");
    expect(compare(undefined, { metrics: [{ source: "opportunities_active", errorCode: "FAILED" }] }).responseType).toBe("error");
    expect(compare(undefined, { read: { toolName: "searchOpportunities", result: [items[0]] } }).responseType).toBe("clarification");
  });
  it("escapes table delimiters and retains literal text in structured UI cells", () => {
    const result = compare(undefined, { read: { toolName: "searchOpportunities", result: [{ ...items[0], name: "A | <b>\nB" }, items[1]] } });
    expect(result.answer).toContain("A \\| &lt;b&gt; B");
    expect(result.comparisonMetadata.table.rows[0][0]).toContain("A | <b>");
  });
});

describe("G05 memory, edits and refreshed evidence", () => {
  const previous = () => compare().comparisonMemory;
  it("persists only validated comparison memory and list identities in context", () => {
    const first = compare();
    expect(validateCustomerComparisonMemory(first.comparisonMemory, snapshot)).toEqual(first.comparisonMemory);
    expect(validateCustomerRecordList(first.recordList, snapshot, 1)).toEqual(first.recordList);
    expect(validateCustomerConversationContext({ accountId: 1, comparisonMemory: first.comparisonMemory }, snapshot, 1).comparisonMemory).toEqual(first.comparisonMemory);
  });
  it.each([
    { accountId: 2 }, { ids: [1, 1] }, { ids: [1, 9] }, { rows: [] }, { relationshipContactId: 99 },
    { spec: { dimensions: ["amountUsd"], calculations: [calc("ratio", 0)] } },
  ])("rejects malformed or invisible memory %j", (patch) => {
    expect(validateCustomerComparisonMemory({ ...previous(), ...patch }, snapshot)).toBeNull();
  });
  it("adds and removes exact identities without modifying CRM or choosing unrelated records", () => {
    const added = resolve({ edit: "add", references: ["Vrf"] }, { previous: previous(), movement: "continue" });
    expect(added.ids).toEqual([1, 2, 3]);
    expect(added.spec.calculations).toEqual([]);
    const memory = { ...previous(), ids: added.ids };
    expect(resolve({ edit: "remove", positions: [2] }, { previous: memory, movement: "continue" }).ids).toEqual([1, 3]);
    expect(resolve({ edit: "remove", references: ["Cuarta"] }, { previous: memory, movement: "continue" }).error).toContain("no estaba");
    expect(resolve({ edit: "remove", positions: [8] }, { previous: memory, movement: "continue" }).error).toContain("posiciones");
    expect(resolve({ edit: "remove" }, { previous: memory, movement: "continue" }).error).toContain("qué nombres");
    expect(resolve({ edit: "remove", positions: [1] }, { previous: previous(), movement: "continue" }).error).toContain("contiene 1");
  });
  it("changes only dimensions and retains order; new sets drop old pair calculations", () => {
    expect(resolve({ dimensions: ["closeDate"] }, { previous: previous(), movement: "continue" })).toMatchObject({ ids: [1, 2], spec: { dimensions: ["closeDate"], calculations: [] } });
    expect(resolve({ references: ["Vrf", "Cuarta", "Quinta"] }, { previous: previous(), movement: "continue" }).spec.calculations).toEqual([]);
  });
  it("explains only unchanged data and preserves the original subset for refresh", () => {
    const request = resolve({ mode: "explain" }, { previous: previous(), movement: "request_rationale" });
    expect(compare(undefined, { request }).responseType).toBe("informational");
    const changedRead = { toolName: "searchOpportunities", result: items.map((item) => item.id === 1 ? { ...item, amountUsd: 1 } : item) };
    const stale = compare(undefined, { request, read: changedRead });
    expect(stale.responseType).toBe("clarification");
    expect(stale.comparisonMemory.ids).toEqual([1, 2]);
    expect(stale.recordList).toBeUndefined();
    const refreshed = compare(undefined, { request: resolve({ mode: "refresh" }, { previous: stale.comparisonMemory, movement: "continue" }), read: changedRead });
    expect(refreshed.answer).toContain("actualizada: cambió");
    expect(compare(undefined, { request: resolve({ mode: "refresh" }, { previous: previous(), movement: "continue" }) }).answer).toContain("sin cambios");
  });
  it("clarifies that rows in a comparison are not a priority ranking", () => {
    const prior = previous();
    const request = resolveCustomerComparisonRequest({
      component: { ...component({ mode: "explain" }), text: "¿Por qué pondrías Vrf primero con ese criterio?" },
      movement: "request_rationale", previous: prior, snapshot, context: { accountId: 1 },
    });
    const result = buildCustomerComparisonResponse({
      request, snapshot, read: { toolName: "searchOpportunities", result: items },
      contactsAllowed: true, metrics,
    });
    expect(result.answer).toContain("no generó un ranking ni priorizó una oportunidad");
    expect(result.answer).toContain("1. Hardware Refresh");
    expect(result.answer).toContain("2. Hardware Refresh 3 Años");
  });
  it("requires refresh when the coverage reason changes even if both results are partial", () => {
    const first = compare(undefined, { metrics: [] });
    const request = resolve({ mode: "explain" }, { previous: first.comparisonMemory, movement: "continue" });
    expect(compare(undefined, { request, metrics: metrics.map((item) => ({ ...item, truncated: true })) }).responseType).toBe("clarification");
  });
  it("rejects memory that encodes a missing value as a known fact or exposes hidden contact evidence", () => {
    const first = previous();
    first.rows[0].cells.amountUsd.value = null;
    expect(validateCustomerComparisonMemory(first, snapshot)).toBeNull();
    const contact = compare({ references, dimensions: ["associatedContact"] });
    expect(validateCustomerComparisonMemory(contact.comparisonMemory, { ...snapshot, permissions: { canReadContacts: false } })).toBeNull();
  });
  it("invalidates ordinal evidence after a displayed record changes, without shifting identities", () => {
    const first = compare();
    const changed = { ...snapshot, opportunities: items.map((item) => item.id === 1 ? { ...item, amountUsd: 42 } : item) };
    expect(validateCustomerRecordList(first.recordList, changed, 1)).toBeNull();
    expect(validateCustomerComparisonMemory(first.comparisonMemory, changed).ids).toEqual([1, 2]);
    expect(validateCustomerRecordList({ ...first.recordList, ids: [2, 1] }, snapshot, 1)).toBeNull();
  });
  it("preserves and revalidates a relationship-derived previous list", () => {
    const previousList = { accountId: 1, object: "opportunity", spec: {}, ids: [1, 2], relationshipContactId: 20 };
    const request = resolve({ set: "previous_list" }, { previousList });
    expect(request.relationshipContactId).toBe(20);
    const first = compare(undefined, { request });
    expect(first.recordList.relationshipContactId).toBe(20);
    expect(validateCustomerComparisonMemory(first.comparisonMemory, { ...snapshot, contacts: [] })).toBeNull();
    expect(resolve({ set: "previous_list" }, { previousList, snapshot: { ...snapshot, contacts: [] } }).error).toContain("listado previo");
  });
});
