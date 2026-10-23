import { describe, expect, it } from "vitest";
import {
  buildCustomerRecordListResponse, CUSTOMER_RECORD_LIST_LIMIT,
  resolveCustomerListSpec, validateCustomerRecordList,
} from "../src/commercial-intelligence/customer-record-list.js";
import { validateCustomerConversationContext } from "../src/commercial-intelligence/conversation-context.js";
import { normalizeCustomerIntelligenceSnapshot } from "../src/commercial-intelligence/contract.js";

const account = { id: 1, name: "Cuenta sintética" };
const opportunities = [
  { id: 10, accountId: 1, name: "Alfa", amountUsd: 0, stageCode: "waiting", stageName: "Waiting", commercialStatusCode: "ganada", activationStatusCode: "activada" },
  { id: 11, accountId: 1, name: "Beta", amountUsd: 500, stageCode: "contacto_inicial", commercialStatusCode: "en_proceso", activationStatusCode: "activada" },
  { id: 12, accountId: 1, name: "Gamma", amountUsd: 1000, stageCode: "waiting", commercialStatusCode: "en_proceso", activationStatusCode: "desactivada" },
  { id: 13, accountId: 1, name: "Delta", amountUsd: null, stageCode: "waiting", commercialStatusCode: "perdida", activationStatusCode: "activada" },
];
const metrics = ["opportunities_active", "opportunities_inactive", "contacts"]
  .map((source) => ({ source, truncated: false, errorCode: null }));
const spec = (patch = {}, object = "opportunity") =>
  resolveCustomerListSpec({ object, listSpec: patch }, null, "new_request").spec;
const render = (patch = {}, extra = {}) => buildCustomerRecordListResponse({
  object: "opportunity", spec: spec(patch), account,
  readToolResults: [{ toolName: "searchOpportunities", result: opportunities }],
  snapshotQueryMetrics: metrics,
  ...extra,
});

describe("Q04 deterministic collections", () => {
  it.each([
    [{ changed: ["limit"], limit: 5 }, { limit: 5 }],
    [{ changed: ["sortBy", "sortDirection"], sortBy: "closeDate", sortDirection: "asc" }, { sortBy: "closeDate", sortDirection: "asc" }],
    [{ changed: ["statusCodes"], statusCodes: ["ganada"] }, { statusCodes: ["ganada"] }],
    [{ changed: ["statusCodes"], statusCodes: ["en_proceso", "ganada"] }, { statusCodes: ["en_proceso", "ganada"] }],
    [{ changed: ["amountFilters"], amountFilters: [] }, { amountFilters: [] }],
    [{ changed: ["textFilters"], textFilters: [] }, { textFilters: [] }],
    [{ changed: ["columns"], columns: ["name", "amountUsd"] }, { columns: ["name", "amountUsd"] }],
  ])("changes only explicit groups while retaining the prior search: %j", (patch, expected) => {
    const initial = spec({ statusCodes: ["en_proceso"], sortBy: "amountUsd", sortDirection: "desc",
      textFilters: [{ field: "name", operator: "contains", value: "Hardware Refresh" }],
      amountFilters: [{ operator: "gt", value: 500000, currency: "USD" }], limit: 10 });
    const result = resolveCustomerListSpec({ object: "opportunity", listSpec: patch },
      { object: "opportunity", spec: initial }, "continue", account);
    expect(result.error).toBeUndefined();
    expect(result.spec).toEqual({ ...initial, ...expected });
  });
  it.each(["new_request", "change_focus"])("never inherits search filters on %s", (movement) => {
    const previous = { object: "opportunity", spec: spec({ statusCodes: ["en_proceso"],
      textFilters: [{ field: "name", operator: "contains", value: "Alfa" }],
      sortBy: "amountUsd", sortDirection: "desc", limit: 5 }) };
    const result = resolveCustomerListSpec({ object: "opportunity", listSpec: { changed: ["limit"], limit: 3 } },
      previous, movement, account);
    expect(result.spec).toEqual(spec({ limit: 3 }));
  });
  it("preserves missing amounts through the actual snapshot schema before Q02/Q03/Q04 reads", () => {
    const opportunity = {
      ...opportunities[3], contactId: null, closeDate: null, updatedAt: null, stageName: "Waiting",
    };
    const normalized = normalizeCustomerIntelligenceSnapshot({
      opportunities: [opportunity],
      selectedOpportunity: opportunity,
      inactiveOpportunities: [{ ...opportunity, activationStatusCode: "desactivada", lifecycle: "inactive" }],
    });
    expect(normalized.opportunities[0].amountUsd).toBeNull();
    expect(normalized.selectedOpportunity.amountUsd).toBeNull();
    expect(normalized.inactiveOpportunities[0].amountUsd).toBeNull();
  });
  it("includes won and inactive opportunities, scopes by account and deduplicates by ID", () => {
    const response = render({}, {
      readToolResults: [{
        toolName: "searchOpportunities",
        result: [...opportunities, opportunities[0], { ...opportunities[0], id: 90, accountId: 2, name: "Ajena" }],
      }],
    });
    expect(response.recordList.ids).toEqual([10, 11, 13, 12]);
    expect(response.listMetadata).toMatchObject({ retrievedCount: 4, knownMatchCount: 4, shownCount: 4, sourceComplete: true });
    expect(response.answer).not.toContain("Ajena");
    expect(response.operations).toEqual([]);
  });
  it.each([
    [{ statusCodes: ["en_proceso"] }, [11, 12]],
    [{ activation: "active" }, [10, 11, 13]],
    [{ activation: "inactive" }, [12]],
    [{ stageCodes: ["waiting"], statusCodes: ["ganada"] }, [10]],
  ])("applies filters independently: %j", (patch, ids) => {
    expect(render(patch).recordList.ids).toEqual(ids);
  });
  it("sorts the entire known collection before applying the requested limit", () => {
    const response = render({ sortBy: "amountUsd", sortDirection: "desc", limit: 2 });
    expect(response.recordList.ids).toEqual([12, 11]);
    expect(response.listMetadata.presentationLimited).toBe(true);
    expect(response.answer).toContain("Cantidad solicitada: 2");
    expect(response.answer).not.toContain("Se muestran todas");
  });
  it.each(["asc", "desc"])("puts empty values last for %s and breaks ties by ID", (sortDirection) => {
    const response = render({ sortBy: "amountUsd", sortDirection }, {
      readToolResults: [{ toolName: "searchOpportunities", result: [
        { ...opportunities[1], id: 14 }, ...opportunities,
      ] }],
    });
    expect(response.recordList.ids).toEqual(sortDirection === "asc" ? [10, 11, 14, 12, 13] : [12, 11, 14, 10, 13]);
    expect(response.answer).toContain("Importe (USD): USD 0");
    expect(response.answer).toContain("Importe (USD): No informado");
  });
  it("orders dates consistently whether read as Date objects or date strings", () => {
    const response = render({ sortBy: "closeDate", sortDirection: "desc" }, {
      readToolResults: [{ toolName: "searchOpportunities", result: [
        { ...opportunities[0], closeDate: new Date("2027-01-31T00:00:00Z") },
        { ...opportunities[1], closeDate: "2028-01-31" },
      ] }],
    });
    expect(response.recordList.ids).toEqual([11, 10]);
  });
  it("projects only requested contact columns and reports missing positions", () => {
    const response = render({}, {
      object: "contact", spec: spec({ columns: ["name", "positionTitle"] }, "contact"),
      readToolResults: [{ toolName: "searchContacts", result: [
        { id: 20, accountId: 1, name: "Elena", positionTitle: "", email: "hidden@example.invalid" },
      ] }],
      collectionScopes: { contacts: "solo activados" },
    });
    expect(response.answer).toContain("1. Nombre: Elena | Cargo: No informado");
    expect(response.answer).not.toContain("hidden@example.invalid");
    expect(response.answer).toContain("solo activados");
  });
  it("keeps opportunity names when only commercial columns are requested", () => {
    const response = render({ columns: ["amountUsd", "stageName", "closeDate", "associatedContact"] });
    expect(response.recordList.spec.columns).toEqual(["amountUsd", "stageName", "closeDate", "associatedContact"]);
    expect(response.answer).toContain("1. Nombre: Alfa | Importe (USD): USD 0 | Etapa: Waiting");
    expect(response.answer).toContain("2. Nombre: Beta | Importe (USD): USD 500");
    expect(response.recordList.ids).toEqual([10, 11, 13, 12]);
  });
  it("keeps contact identity without adding unrequested contact details", () => {
    const response = render({}, {
      object: "contact", spec: spec({ columns: ["positionTitle"] }, "contact"),
      readToolResults: [{ toolName: "searchContacts", result: [
        { id: 20, accountId: 1, name: "Elena", positionTitle: "Gerente", email: "hidden@example.invalid" },
      ] }],
    });
    expect(response.answer).toContain("1. Nombre: Elena | Cargo: Gerente");
    expect(response.answer).not.toContain("hidden@example.invalid");
  });
  it("distinguishes a verified empty collection from an unknown or truncated one", () => {
    const empty = { readToolResults: [{ toolName: "searchOpportunities", result: [] }] };
    expect(render({}, empty).answer).toContain("No hay coincidencias con esos filtros");
    for (const snapshotQueryMetrics of [[], [{ ...metrics[0], truncated: true }, metrics[1]]]) {
      const response = render({}, { ...empty, snapshotQueryMetrics });
      expect(response.answer).toContain("No hay coincidencias entre los registros recuperados");
      expect(response.answer).toContain("Resultado parcial");
      expect(response.answer).not.toContain("Se muestran todas");
      expect(response.listMetadata.sourceComplete).toBe(false);
    }
  });
  it.each([
    { readToolResults: [] },
    { readToolResults: [{ toolName: "searchOpportunities", error: "failed", result: [] }] },
    { readToolResults: [{ toolName: "searchOpportunities", queryFailed: true, result: opportunities }] },
    { readToolResults: [{ toolName: "searchOpportunities", result: null }] },
    { snapshotQueryMetrics: [{ ...metrics[0], errorCode: "query_error" }, metrics[1]] },
  ])("reports failed evidence rather than a successful empty list", (extra) => {
    const response = render({}, extra);
    expect(response.responseType).toBe("error");
    expect(response.answer).toContain("No pude verificar");
    expect(response.recordList).toBeUndefined();
  });
  it("caps presentation and never claims a global top result over partial reads", () => {
    const response = render({ sortBy: "amountUsd", sortDirection: "desc", limit: 500 }, {
      readToolResults: [{ toolName: "searchOpportunities", result: Array.from({ length: 70 }, (_, index) => ({
        ...opportunities[1], id: index + 1, amountUsd: index,
      })) }],
      snapshotQueryMetrics: metrics.map((metric) => ({ ...metric, truncated: true })),
    });
    expect(response.recordList.ids).toHaveLength(CUSTOMER_RECORD_LIST_LIMIT);
    expect(response.recordList.ids[0]).toBe(70);
    expect(response.listMetadata).toMatchObject({ sourceComplete: false, presentationLimited: true, appliedLimit: 50 });
    expect(response.answer).toContain("No conozco el total global");
    expect(response.answer).toContain("solo a los registros recuperados");
  });
  it.each([
    ["opportunity", { sortBy: "margin" }],
    ["opportunity", { columns: ["internalCost"] }],
    ["opportunity", { unsupported: ["presupuesto confirmado"] }],
    ["contact", { statusCodes: ["ganada"] }],
    ["contact", { activation: "inactive" }],
    ["quotation", {}],
  ])("rejects unsupported %s criteria %j without substituting", (object, listSpec) => {
    expect(resolveCustomerListSpec({ object, listSpec }, null, "new_request").error).toBeTruthy();
  });
  it("merges only changed properties on continuation, resets new requests and handles explicit clearing", () => {
    const previous = { object: "opportunity", spec: spec({ statusCodes: ["en_proceso"], columns: ["name"], limit: 5 }) };
    const next = resolveCustomerListSpec({
      object: "opportunity", listSpec: { sortBy: "amountUsd", sortDirection: "desc" },
    }, previous, "continue").spec;
    expect(next).toMatchObject({ statusCodes: ["en_proceso"], columns: ["name"], limit: 5, sortBy: "amountUsd" });
    expect(resolveCustomerListSpec({ object: "opportunity", listSpec: { statusCodes: [] } }, previous, "continue").spec.statusCodes).toEqual([]);
    expect(resolveCustomerListSpec({ object: "opportunity", listSpec: {} }, previous, "new_request").spec.statusCodes).toEqual([]);
    expect(resolveCustomerListSpec({ object: "contact", listSpec: {} }, previous, "continue").spec.limit).toBe(0);
  });
  it("uses the changed mask rather than placeholder provider values", () => {
    const previous = { object: "opportunity", spec: spec({ statusCodes: ["en_proceso"], limit: 5 }) };
    const result = resolveCustomerListSpec({ object: "opportunity", listSpec: {
      changed: ["sortBy", "sortDirection"], statusCodes: [], limit: 0,
      sortBy: "amountUsd", sortDirection: "desc",
    } }, previous, "continue");
    expect(result.spec).toMatchObject({ statusCodes: ["en_proceso"], limit: 5, sortBy: "amountUsd", sortDirection: "desc" });
    expect(result.spec.changed).toBeUndefined();
  });
});

describe("Q04 persisted list positions", () => {
  const snapshot = { account, opportunities, contacts: [] };
  const recordList = { accountId: 1, object: "opportunity", spec: spec(), ids: [12, 11] };
  it("retains the exact displayed order through context validation", () => {
    const result = validateCustomerConversationContext({ accountId: 1, recordList }, snapshot, 1);
    expect(result.recordList.ids).toEqual([12, 11]);
  });
  it.each([
    { ...recordList, accountId: 2 },
    { ...recordList, ids: [12, 99] },
    { ...recordList, ids: [12, 12] },
    { ...recordList, ids: [12, "11"] },
    { ...recordList, spec: { sortBy: "secret" } },
  ])("invalidates unsafe memory without shifting ordinal positions: %j", (value) => {
    expect(validateCustomerRecordList(value, snapshot, 1)).toBeNull();
  });
  it("invalidates the whole selection when visibility changes or account switches", () => {
    expect(validateCustomerRecordList(recordList, { ...snapshot, opportunities: [opportunities[1]] }, 1)).toBeNull();
    expect(validateCustomerRecordList(recordList, snapshot, 2)).toBeNull();
    expect(validateCustomerRecordList(recordList, { ...snapshot, permissions: { canReadOpportunities: false } }, 1)).toBeNull();
  });
});
