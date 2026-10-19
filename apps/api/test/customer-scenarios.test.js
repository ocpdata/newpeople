import { describe, expect, it } from "vitest";
import { buildCustomerScenarioResponse, resolveCustomerScenarioRequest, validateCustomerScenarioMemory } from "../src/commercial-intelligence/customer-scenarios.js";

const now = new Date("2026-10-17T12:00:00Z");
const snapshot = { account: { id: 1, name: "Cuenta" }, permissions: { canReadOpportunities: true } };
const first = { id: 1, name: "Alfa", account_id: 1, amount_usd: "500000.00", close_date: "2027-01-31",
  commercial_status_code: "en_proceso", activation_status_code: "activada", stage_code: "inicio" };
const data = { complete: true, opportunities: [first, { ...first, id: 2, name: "Beta", amount_usd: "100000.00", close_date: null }] };
const change = (kind = "amount_percent", extra = {}) => ({
  kind, value: -10, unit: "percent", date: "", status: "en_proceso", references: [], ...extra,
});
const alternative = (changes = [change()], extra = {}) => ({ name: "Alternativa A", changes, assumptions: [], ...extra });
const resolve = (spec = {}, extra = {}) => resolveCustomerScenarioRequest({
  component: { object: "account", reference: "", scenarioSpec: { set: "named", references: ["Alfa"], alternatives: [alternative()], ...spec } },
  snapshot, context: { accountId: 1 }, movement: "new_request", now, ...extra,
});
const run = (spec = {}, source = data) => buildCustomerScenarioResponse({ request: resolve(spec), data: source });
const table = (result) => result.scenarioMetadata.tables[0].rows;
describe("G07 deterministic quantitative scenarios", () => {
  it("calculates G07-02 precisely and never mutates real data", () => {
    const original = structuredClone(data), result = run();
    expect(table(result)[0].slice(2, 5)).toEqual(["USD 500,000.00", "USD 450,000.00", "-USD 50,000.00"]);
    expect(result.answer).toContain("ESCENARIO HIPOTÉTICO");
    expect(result.answer).toContain("no modifica el CRM");
    expect(result.answer).toContain("USD 450,000.00");
    expect(result.answer).not.toContain("| Oportunidad |");
    expect(result.operations).toEqual([]);
    expect(data).toEqual(original);
  });
  it.each([
    ["2027-01-31", 1, "months", "2027-02-28"],
    ["2028-01-31", 1, "months", "2028-02-29"],
    ["2027-01-31", 1, "quarters", "2027-04-30"],
    ["2027-01-31", -1, "months", "2026-12-31"],
    ["2027-01-31", 1, "days", "2027-02-01"],
  ])("uses calendar arithmetic: %s plus %s %s", (date, value, unit, expected) => {
    const result = run({ alternatives: [alternative([change("close_shift", { value, unit })])] },
      { ...data, opportunities: [{ ...first, close_date: date }] });
    expect(table(result)[0][6]).toBe(expected);
  });
  it("summarizes a one-month delay without embedding the technical tables", () => {
    const result = run({ alternatives: [alternative([change("close_shift", { value: 1, unit: "months" })])] });
    expect(result.answer).toContain("2027-01-31 → 2027-02-28");
    expect(result.answer).toContain("no modifica el CRM");
    expect(result.answer).not.toContain("| Oportunidad |");
    expect(result.scenarioMetadata.tables[0].rows[0][6]).toBe("2027-02-28");
  });
  it("rounds fractional cents consistently and handles zero without division", () => {
    const source = { complete: true, opportunities: [{ ...first, amount_usd: "0.05" }] };
    expect(table(run({}, source))[0][3]).toBe("USD 0.05");
    expect(table(run({}, { ...source, opportunities: [{ ...first, amount_usd: 0 }] }))[0][3]).toBe("USD 0.00");
  });
  it("compares independent alternatives against the same base", () => {
    const result = run({ alternatives: [alternative(), alternative([change("amount_percent", { value: -20 })], { name: "B" })] });
    expect(table(result).map((row) => row[3])).toEqual(["USD 450,000.00", "USD 400,000.00"]);
  });
  it("applies combined changes only in the declared order and on explicit targets", () => {
    const result = run({ set: "account", references: [], alternatives: [alternative([
      change("amount_delta", { value: 100, unit: "USD", references: ["Alfa"] }), change(),
    ])] });
    expect(table(result).map((row) => row[3])).toEqual(["USD 450,090.00", "USD 90,000.00"]);
  });
  it("distributes pipeline by hypothetical dates without counting won deals as open", () => {
    const result = run({ set: "account", references: [], period: { mode: "absolute", startDate: "2027-01-01", endDate: "2027-03-31" },
      alternatives: [alternative([change("close_shift", { value: 1, unit: "months", references: ["Alfa"] })])] });
    const rows = result.scenarioMetadata.tables[2].rows;
    expect(rows).toContainEqual(["Base registrada", "2027-01", "1", "USD 500,000.00", "Distribución por cierre previsto"]);
    expect(rows).toContainEqual(["Alternativa A", "2027-02", "1", "USD 500,000.00", "Distribución por cierre previsto"]);
    expect(rows.filter((row) => row[1] === "Sin fecha")).toHaveLength(2);
    expect(result.scenarioMetadata.tables[3].rows).toContainEqual(["Alternativa A", "2027-01", "1 → 0", "-1", "-USD 500,000.00"]);
    expect(result.scenarioMetadata.tables[3].rows).toContainEqual(["Alternativa A", "2027-02", "0 → 1", "1", "USD 500,000.00"]);
    const won = run({ period: { mode: "absolute", startDate: "2027-01-01", endDate: "2027-03-31" },
      alternatives: [alternative([change("status_set", { status: "ganada" })])] });
    expect(won.scenarioMetadata.tables[2].rows).toContainEqual(["Alternativa A", "Sin oportunidades abiertas activadas", "0", "USD 0.00", "Conjunto autorizado"]);
  });
  it.each([["quarter", "2027-T1"], ["year", "2027"]])("groups %s pipeline and separates outside period and missing dates", (granularity, key) => {
    const result = run({ set: "account", references: [], granularity,
      period: { mode: "absolute", startDate: "2027-01-01", endDate: "2027-03-31" },
      alternatives: [alternative([change("close_set", { date: "2028-01-31", references: ["Alfa"] })])] });
    const rows = result.scenarioMetadata.tables[2].rows;
    expect(rows.some(row => row[0] === "Base registrada" && row[1] === key)).toBe(true);
    expect(rows.some(row => row[0] === "Alternativa A" && row[1] === "Fuera del periodo")).toBe(true);
    expect(rows.filter(row => row[1] === "Sin fecha")).toHaveLength(2);
  });
  it("uses full authorized account and filters without relying on snapshot membership", () => {
    const result = run({ set: "filtered", references: [], listSpec: { amountFilters: [{ operator: "gte", value: 200000, currency: "USD" }] } });
    expect(table(result)).toHaveLength(1);
    expect(result.answer).toContain("Filtros");
  });
  it("flags missing amounts as partial rather than zero certified totals", () => {
    const result = run({ alternatives: [alternative([], { assumptions: [{ kind: "approval", statement: "Supón aprobación", budgetUsd: -1 }] })] },
      { ...data, opportunities: [{ ...first, amount_usd: null }] });
    expect(result.scenarioMetadata.partial).toBe(true);
    expect(table(result)[0][3]).toBe("No registrado");
  });
  it("caps presentation only after complete calculations", () => {
    const opportunities = Array.from({ length: 501 }, (_, i) => ({ ...first, id: i + 1, name: `Proyecto ${i}`, amount_usd: "1.00" }));
    const result = run({ set: "account", references: [] }, { complete: true, opportunities });
    expect(table(result)).toHaveLength(500);
    expect(result.scenarioMetadata.tables[1].rows).toContainEqual(["Alternativa A", "En proceso", "501", "USD 450.90", "Conjunto autorizado"]);
    expect(result.scenarioMetadata.partial).toBe(true);
  });
});
describe("G07 clarifications and financial boundaries", () => {
  it.each([
    { mode: "financial" }, { unsupported: ["probabilidad exacta"] }, { clarification: "¿Qué presupuesto?" },
    { set: "named", references: [] }, { set: "account", references: ["Alfa"] }, { accountReference: "Otra" },
    { set: "filtered", references: [], listSpec: {} }, { set: "account", references: [], listSpec: { stageCodes: ["inicio"] } },
    { alternatives: [] }, { alternatives: [alternative([])] },
    { alternatives: [alternative([change("amount_percent", { value: -101 })])] },
    { alternatives: [alternative([change("amount_delta", { unit: "USD", value: 0.001 })])] },
    { alternatives: [alternative([change("close_shift", { value: 1.5, unit: "months" })])] },
    { alternatives: [alternative([change("close_set", { date: "2027-02-30" })])] },
    { period: { mode: "absolute", startDate: "2027-01-01", endDate: "2026-01-01" } },
    { alternatives: [alternative(), alternative()] },
  ])("does not silently repair invalid or incomplete criteria %j", (spec) => expect(resolve(spec).error).toBeTruthy());
  it("does not publish incomplete source, foreign records or ambiguous names", () => {
    expect(run({}, { ...data, complete: false }).responseType).toBe("error");
    expect(run({}, { complete: true, opportunities: [{ ...first, account_id: 2 }] }).responseType).toBe("error");
    expect(run({}, { ...data, opportunities: [first, { ...first, id: 3 }] }).responseType).toBe("clarification");
    expect(run({ references: ["Alfa", "No existe"] }).responseType).toBe("clarification");
    expect(run({ references: ["Alfa", "Alfa"] }).responseType).toBe("clarification");
  });
  it("does not calculate over missing amounts/dates or permit negative resulting amounts", () => {
    expect(run({}, { complete: true, opportunities: [{ ...first, amount_usd: null }] }).responseType).toBe("clarification");
    expect(run({ references: ["Beta"], alternatives: [alternative([change("close_shift", { value: 1, unit: "months" })])] }).responseType).toBe("clarification");
    expect(run({ alternatives: [alternative([change("amount_delta", { unit: "USD", value: -600000 })])] }).responseType).toBe("clarification");
    expect(run({}, { complete: true, opportunities: [{ ...first, amount_usd: "-1.00" }] }).responseType).toBe("error");
  });
  it("never turns G07-03 approval into a won deal or CRM fact", () => {
    const result = run({ alternatives: [alternative([], { assumptions: [{ kind: "approval", statement: "Rene aprobó", budgetUsd: -1 }] })] });
    expect(table(result)[0][7]).toBe("En proceso → En proceso");
    expect(result.answer).toContain("no acredita firma");
    expect(result.operations).toEqual([]);
  });
  it("does not substitute opportunity amount for customer budget", () => {
    const result = run({ alternatives: [alternative([], { assumptions: [{ kind: "budget", statement: "Reduce presupuesto a la mitad", budgetUsd: -1 }] })] });
    expect(result.answer).toContain("Presupuesto no informado");
    expect(result.answer).toContain("no se usa el importe");
    expect(table(result)[0][3]).toBe("USD 500,000.00");
  });
});
describe("G07 isolated continuity and current evidence", () => {
  const next = (previous, spec, extra = {}) => resolveCustomerScenarioRequest({
    component: { object: "account", reference: "", scenarioSpec: spec }, snapshot, context: { accountId: 1 },
    movement: "continue", previous, now, ...extra,
  });
  it("replaces 10% with 15% on the real basis, not on the previous simulated result", () => {
    const previous = run().scenarioMemory;
    const result = buildCustomerScenarioResponse({ request: next(previous, { alternatives: [alternative([change("amount_percent", { value: -15 })])] }), data });
    expect(table(result)[0][3]).toBe("USD 425,000.00");
    expect(validateCustomerScenarioMemory(result.scenarioMemory, snapshot)).toEqual(result.scenarioMemory);
    expect(validateCustomerScenarioMemory(previous, { account: { id: 2 } })).toBeNull();
    expect(validateCustomerScenarioMemory({ ...previous, ids: [1, 1] }, snapshot)).toBeNull();
    expect(validateCustomerScenarioMemory(previous, { ...snapshot, permissions: { canReadOpportunities: false } })).toBeNull();
  });
  it("adds a combined change only with append, and removes alternatives by name", () => {
    const previous = run().scenarioMemory;
    const request = next(previous, { edit: "append", alternatives: [alternative([change("close_shift", { value: 1, unit: "months" })])] });
    const combined = buildCustomerScenarioResponse({ request, data });
    expect(table(combined)[0][3]).toBe("USD 450,000.00");
    expect(table(combined)[0][6]).toBe("2027-02-28");
    const multiple = run({ alternatives: [alternative(), alternative([change()], { name: "B" })] }).scenarioMemory;
    expect(next(multiple, { edit: "remove", alternatives: [alternative([])] }).spec.alternatives.map((item) => item.name)).toEqual(["B"]);
  });
  it("detects changed data and set membership before reusing a result", () => {
    const previous = run().scenarioMemory, changed = { ...data, opportunities: [{ ...first, amount_usd: "600000.00" }] };
    expect(buildCustomerScenarioResponse({ request: next(previous, { mode: "explain" }), data: changed }).responseType).toBe("clarification");
    const refreshed = buildCustomerScenarioResponse({ request: next(previous, { mode: "refresh" }), data: changed });
    expect(table(refreshed)[0][3]).toBe("USD 540,000.00");
    expect(refreshed.answer).toContain("Base actualizada: cambió");
    const accountPrevious = run({ set: "account", references: [] }).scenarioMemory;
    const expanded = { ...data, opportunities: [...data.opportunities, { ...first, id: 3, name: "Gamma" }] };
    expect(buildCustomerScenarioResponse({ request: next(accountPrevious, {}), data: expanded }).responseType).toBe("clarification");
  });
  it("requires re-selection after permissions remove a member and supports explicit reset", () => {
    const previous = run().scenarioMemory;
    expect(buildCustomerScenarioResponse({ request: next(previous, {}), data: { complete: true, opportunities: [] } }).responseType).toBe("clarification");
    expect(next(previous, { mode: "reset" })).toEqual({ reset: true });
  });
});
