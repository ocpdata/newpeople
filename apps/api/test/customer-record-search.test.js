import { describe, expect, it } from "vitest";
import {
  buildCustomerRecordListResponse, resolveCustomerListSpec, validateCustomerRecordList,
} from "../src/commercial-intelligence/customer-record-list.js";
import { customerDateOnly, customerRecordListSpecSchema } from "../src/commercial-intelligence/turn-contract.js";

const account = { id: 1, name: "Cuenta sintética" };
const rows = [
  { id: 1, accountId: 1, name: "Renovación Alfa", amountUsd: 0, closeDate: "2027-01-01", commercialStatusCode: "en_proceso", stageCode: "waiting", activationStatusCode: "activada" },
  { id: 2, accountId: 1, name: "Renovación Alfa 3 años", amountUsd: 500000, closeDate: "2027-01-31", commercialStatusCode: "en_proceso", stageCode: "waiting", activationStatusCode: "activada" },
  { id: 3, accountId: 1, name: "Renovación Beta", amountUsd: 1500000, closeDate: new Date("2027-02-01T00:00:00Z"), commercialStatusCode: "ganada", stageCode: "waiting", activationStatusCode: "activada" },
  { id: 4, accountId: 1, name: "Vacía", amountUsd: null, closeDate: null, commercialStatusCode: "en_proceso", stageCode: "waiting", activationStatusCode: "activada" },
];
const amount = (operator, value) => ({ operator, value, currency: "USD" });
const date = (operator, value) => ({ operator, value });
const metrics = ["contacts", "opportunities_active", "opportunities_inactive"]
  .map((source) => ({ source, truncated: false, errorCode: null }));
const resolve = (listSpec, object = "opportunity", previous = null, movement = "new_request") =>
  resolveCustomerListSpec({ object, listSpec }, previous, movement, account);
const render = (listSpec, extra = {}) => buildCustomerRecordListResponse({
  object: "opportunity", spec: resolve(listSpec).spec, account,
  readToolResults: [{ toolName: "searchOpportunities", result: rows }],
  snapshotQueryMetrics: metrics, ...extra,
});

describe("Q05 exact amount comparisons", () => {
  it.each([
    ["eq", 500000, [2]], ["gt", 500000, [3]], ["gte", 500000, [2, 3]],
    ["lt", 500000, [1]], ["lte", 500000, [1, 2]], ["eq", 0, [1]],
  ])("%s %s returns exact IDs %j", (operator, value, expected) => {
    expect(render({ amountFilters: [amount(operator, value)] }).recordList.ids.sort()).toEqual(expected);
  });
  it("supports explicit inclusive and exclusive intervals", () => {
    expect(render({ amountFilters: [amount("gte", 0), amount("lte", 500000)] }).recordList.ids.sort()).toEqual([1, 2]);
    expect(render({ amountFilters: [amount("gt", 0), amount("lte", 500000)] }).recordList.ids).toEqual([2]);
    expect(render({ amountFilters: [amount("gte", 500000), amount("lte", 500000)] }).recordList.ids).toEqual([2]);
  });
  it("does not treat null, missing, empty, string or non-finite amounts as numeric evidence", () => {
    const response = render({ amountFilters: [amount("gte", 0)] }, {
      readToolResults: [{ toolName: "searchOpportunities", result: [null, undefined, "", "500000", Infinity, NaN]
        .map((amountUsd, index) => ({ ...rows[0], id: index + 1, amountUsd })) }],
    });
    expect(response.recordList.ids).toEqual([]);
  });
});

describe("Q05 calendar comparisons", () => {
  it.each([
    ["eq", "2027-01-31", [2]], ["gt", "2027-01-31", [3]], ["gte", "2027-01-31", [2, 3]],
    ["lt", "2027-01-31", [1]], ["lte", "2027-01-31", [1, 2]],
  ])("%s %s includes exactly the requested date boundaries", (operator, value, expected) => {
    expect(render({ closeDateFilters: [date(operator, value)] }).recordList.ids.sort()).toEqual(expected);
  });
  it("matches a month, whole year, leap day and an empty future year", () => {
    expect(render({ closeDateFilters: [date("gte", "2027-01-01"), date("lte", "2027-01-31")] }).recordList.ids.sort()).toEqual([1, 2]);
    expect(render({ closeDateFilters: [date("gte", "2027-01-01"), date("lte", "2027-12-31")] }).recordList.ids.sort()).toEqual([1, 2, 3]);
    expect(render({ closeDateFilters: [date("gte", "2035-01-01"), date("lte", "2035-12-31")] }).recordList.ids).toEqual([]);
    const leap = render({ closeDateFilters: [date("eq", "2028-02-29")] }, {
      readToolResults: [{ toolName: "searchOpportunities", result: [{ ...rows[0], closeDate: new Date("2028-02-29T00:00:00Z") }] }],
    });
    expect(leap.recordList.ids).toEqual([1]);
  });
  it.each(["2027-02-29", "2027-04-31", "2027-13-01", "2027-00-01", "2027-01-00", "enero 2027", "", "2027-01-01T00:00:00Z"])("rejects invalid/underspecified date %s", (value) => {
    expect(customerDateOnly(value)).toBeNull();
    expect(resolve({ closeDateFilters: [date("eq", value)] }).responseType).toBe("clarification");
  });
  it("excludes invalid recorded dates without converting missing values to a match", () => {
    const result = render({ closeDateFilters: [date("gte", "2020-01-01")] }, {
      readToolResults: [{ toolName: "searchOpportunities", result: ["", null, undefined, "2027-02-30", new Date("invalid")]
        .map((closeDate, index) => ({ ...rows[0], id: index + 1, closeDate })) }],
    });
    expect(result.recordList.ids).toEqual([]);
  });
});

describe("Q05 text and combined conditions", () => {
  it("normalizes accents, case and repeated whitespace without semantic substitution", () => {
    expect(render({ textFilters: [{ field: "name", operator: "eq", value: "  RENOVACION   ALFA " }] }).recordList.ids).toEqual([1]);
    expect(render({ textFilters: [{ field: "name", operator: "contains", value: "renovacion" }] }).recordList.ids.sort()).toEqual([1, 2, 3]);
    expect(render({ textFilters: [{ field: "name", operator: "eq", value: "renovacion" }] }).recordList.ids).toEqual([]);
  });
  it("combines all filters with AND before order, limit and projection", () => {
    const response = render({
      textFilters: [{ field: "name", operator: "contains", value: "alfa" }],
      statusCodes: ["en_proceso"], stageCodes: ["waiting"], activation: "active",
      amountFilters: [amount("gte", 0)], closeDateFilters: [date("lte", "2027-01-31")],
      sortBy: "amountUsd", sortDirection: "desc", limit: 1, columns: ["name"],
    });
    expect(response.recordList.ids).toEqual([2]);
    expect(response.listMetadata.knownMatchCount).toBe(2);
    expect(response.answer).toContain("todos deben cumplirse");
    expect(response.answer).toContain('nombre contiene "alfa"');
    expect(response.answer).toContain("importe mayor o igual que USD 0");
    expect(response.answer).toContain("cierre menor o igual que 2027-01-31");
    expect(response.answer).not.toContain("Importe (USD):");
  });
  it("filters contact name and role together and excludes missing roles", () => {
    const response = render({}, {
      object: "contact", spec: resolve({
        textFilters: [
          { field: "name", operator: "contains", value: "maria" },
          { field: "positionTitle", operator: "eq", value: "direccion tecnica" },
        ],
      }, "contact").spec,
      readToolResults: [{ toolName: "searchContacts", result: [
        { id: 1, accountId: 1, name: "María Uno", positionTitle: "Dirección Técnica" },
        { id: 2, accountId: 1, name: "María Dos", positionTitle: "" },
        { id: 3, accountId: 1, name: "María Tres", positionTitle: "Dirección Comercial" },
      ] }],
    });
    expect(response.recordList.ids).toEqual([1]);
  });
  it.each([
    { textFilters: [{ field: "email", operator: "contains", value: "example" }] },
    { textFilters: [{ field: "positionTitle", operator: "eq", value: "director" }] },
    { unsupported: ["importe en MXN"] },
    { unsupported: ["nombre Alfa O importe mayor que 500"] },
    { unsupported: ["autoridad de compra"] },
  ])("does not silently ignore unsupported criteria %j", (listSpec) => {
    expect(resolve(listSpec).error).toContain("no soportados");
  });
  it.each([
    { amountFilters: [amount("gte", 1)] }, { closeDateFilters: [date("eq", "2027-01-01")] },
  ])("does not apply opportunity criteria to contacts %j", (listSpec) => {
    expect(resolve(listSpec, "contact").error).toContain("no soportados");
  });
});

describe("Q05 invalid and contradictory criteria", () => {
  it.each([
    { amountFilters: [amount("gte", -1)] },
    { amountFilters: [amount("gte", Infinity)] },
    { amountFilters: [amount("gte", NaN)] },
    { amountFilters: [amount("approximately", 500)] },
    { amountFilters: [{ operator: "eq", value: 500, currency: "MXN" }] },
    { amountFilters: [{ operator: "eq", value: 500 }] },
    { textFilters: [{ field: "name", operator: "contains", value: "  " }] },
  ])("rejects invalid typed filters %j", (listSpec) => {
    expect(customerRecordListSpecSchema.safeParse(listSpec).success).toBe(false);
    expect(resolve(listSpec).responseType).toBe("clarification");
  });
  it.each([
    [amount("gte", 1000), amount("lte", 500)],
    [amount("gt", 500), amount("lte", 500)],
    [amount("gte", 500), amount("lt", 500)],
    [amount("eq", 500), amount("gt", 500)],
    [amount("eq", 500), amount("eq", 1000)],
  ])("clarifies contradictory amount bounds %j", (...filters) => {
    expect(resolve({ amountFilters: filters }).responseType).toBe("clarification");
  });
  it("clarifies contradictory date bounds and requested ambiguity without reading", () => {
    expect(resolve({ closeDateFilters: [date("gte", "2027-02-01"), date("lte", "2027-01-31")] }).responseType).toBe("clarification");
    expect(resolve({ clarification: "¿De qué año?" })).toMatchObject({ error: "¿De qué año?", responseType: "clarification" });
  });
  it("validates an explicitly requested account instead of changing account scope", () => {
    expect(resolve({ accountReference: "Otra cuenta" }).responseType).toBe("clarification");
    expect(resolve({ accountReference: "CUENTA SINTETICA" }).spec).toBeTruthy();
  });
});

describe("Q05 continuity, limits and persistence", () => {
  it("adds, replaces and clears each group without inheriting filters in a new search", () => {
    const first = resolve({
      statusCodes: ["en_proceso"], closeDateFilters: [date("gte", "2027-01-01"), date("lte", "2027-01-31")],
      textFilters: [{ field: "name", operator: "contains", value: "renovacion" }],
    }).spec;
    const previous = { object: "opportunity", spec: first };
    const second = resolve({ amountFilters: [amount("gt", 500000)] }, "opportunity", previous, "continue").spec;
    expect(second).toMatchObject({
      statusCodes: first.statusCodes, closeDateFilters: first.closeDateFilters, textFilters: first.textFilters,
    });
    const third = resolve({ amountFilters: [amount("gt", 1000000)] }, "opportunity", { ...previous, spec: second }, "continue").spec;
    expect(third.amountFilters).toEqual([amount("gt", 1000000)]);
    const fourth = resolve({ amountFilters: [], textFilters: [] }, "opportunity", { ...previous, spec: third }, "continue").spec;
    expect(fourth.amountFilters).toEqual([]);
    expect(fourth.textFilters).toEqual([]);
    expect(fourth.closeDateFilters).toEqual(first.closeDateFilters);
    expect(resolve({}, "opportunity", previous, "new_request").spec.closeDateFilters).toEqual([]);
  });
  it("persists effective search criteria and original displayed order through memory validation", () => {
    const response = render({ amountFilters: [amount("gte", 0)], sortBy: "amountUsd", sortDirection: "desc" });
    const memory = validateCustomerRecordList(response.recordList, { account, opportunities: rows }, 1);
    expect(memory.ids).toEqual([3, 2, 1]);
    expect(memory.spec.amountFilters).toEqual([amount("gte", 0)]);
    expect(validateCustomerRecordList(memory, { account, opportunities: rows.slice(1) }, 1)).toBeNull();
  });
  it("replaces a January interval with January-February without losing other conditions", () => {
    const previous = { object: "opportunity", spec: resolve({
      closeDateFilters: [date("gte", "2027-01-01"), date("lte", "2027-01-31")],
      amountFilters: [amount("gte", 500000)], columns: ["name"], limit: 5,
    }).spec };
    const next = resolve({
      closeDateFilters: [date("gte", "2027-01-01"), date("lte", "2027-02-28")],
    }, "opportunity", previous, "continue").spec;
    const response = render({}, { spec: next });
    expect(response.recordList.ids.sort()).toEqual([2, 3]);
    expect(next).toMatchObject({ amountFilters: [amount("gte", 500000)], columns: ["name"], limit: 5 });
  });
  it("does not turn zero known matches into a global absence over partial data", () => {
    const response = render({ amountFilters: [amount("gt", 5000000)] }, {
      snapshotQueryMetrics: metrics.map((metric) => ({ ...metric, truncated: true })),
    });
    expect(response.recordList.ids).toEqual([]);
    expect(response.listMetadata.sourceComplete).toBe(false);
    expect(response.answer).toContain("No conozco el total global");
    expect(response.answer).toContain("no puedo afirmar que no existan otras");
    expect(response.answer).not.toContain("Se muestran todas");
  });
});
