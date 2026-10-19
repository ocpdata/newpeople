import { describe, expect, it } from "vitest";
import { buildCustomerTrendResponse, prepareCustomerCommercialHistory, reconstructCustomerOpportunity, resolveCustomerTrendRequest, validateCustomerTrendMemory } from "../src/commercial-intelligence/customer-trends.js";

const state = (extra = {}) => ({
  name: "Alfa", account_id: 1, amount_usd: 500, sales_stage_id: 1, commercial_status_id: 1, activation_status_id: 1,
  close_date: "2026-12-31", commercial_closed_at: null, seller_user_id: 1, presales_user_id: null,
  created_by: 1, created_at: "2026-01-01 10:00:00", ...extra,
});
const initial = state(), second = state({ sales_stage_id: 2, amount_usd: 700 }), final = state({ sales_stage_id: 3, amount_usd: 1000, commercial_status_id: 2 });
const event = (id, at, before, after, kind = "changed", opportunityId = 1) => ({
  id, opportunity_id: opportunityId, event_kind: kind, recorded_at_utc: at, before_state: before, after_state: after,
});
const events = [
  event(1, "2026-01-01T10:00:00Z", null, initial, "created"),
  event(2, "2026-02-01T10:00:00Z", initial, second),
  event(3, "2026-03-01T10:00:00Z", second, final),
];
const data = {
  complete: true, opportunities: [{ ...final, id: 1 }], events,
  stages: [{ id: 1, code: "inicio", name: "Inicio", display_order: 1 }, { id: 2, code: "evaluacion", name: "Evaluación", display_order: 2 }, { id: 3, code: "cierre", name: "Cierre", display_order: 3 }],
  commercialStatuses: [{ id: 1, code: "en_proceso" }, { id: 2, code: "ganada" }, { id: 3, code: "perdida" }, { id: 4, code: "anulada" }],
  activationStatuses: [{ id: 1, code: "activada" }, { id: 2, code: "desactivada" }], control: {},
};
const snapshot = { account: { id: 1, name: "Cuenta" }, permissions: { canReadOpportunities: true } };
const now = new Date("2026-04-01T12:00:00Z");
const period = { mode: "absolute", startDate: "2026-01-01", endDate: "2026-03-31" };
const resolve = (trendSpec = {}, extra = {}) => resolveCustomerTrendRequest({
  component: { object: "account", reference: "", trendSpec }, snapshot, context: { accountId: 1 }, movement: "new_request", now, timezone: "UTC", ...extra,
});
const run = (metric = "stage_movements", extra = {}, source = data) => buildCustomerTrendResponse({
  request: resolve({ metric, period, ...extra }), data: source,
});
describe("G06 interpretation and explicit financial limits", () => {
  it.each(["facturación", "cobros", "pagos", "saldos"])("does not substitute finance with pipeline: %s", () => {
    expect(resolve({ metric: "financial" }).error).toContain("aún no está disponible");
  });
  it.each([
    [{}, "Qué deseas"], [{ metric: "created" }, "periodo"], [{ metric: "risk" }, "inválidos"],
    [{ metric: "created", period, accountReference: "Otra" }, "cuenta seleccionada"],
    [{ metric: "journey", period }, "Indica una oportunidad"],
    [{ metric: "created", period: { mode: "absolute", startDate: "2026-01-01", endDate: "2027-01-01" } }, "no futuras"],
    [{ metric: "created", period, unsupported: ["pronóstico"] }, "No puedo dar un pronóstico exacto"],
    [{ metric: "created", period, clarification: "¿Qué fecha?" }, "¿Qué fecha?"],
  ])("clarifies without silently changing purpose %j", (spec, expected) => expect(resolve(spec).error).toContain(expected));
  it("declines exact forecasts while offering a conditional pipeline scenario", () => {
    const result = resolve({ metric: "unspecified", unsupported: ["pronóstico exacto de ventas"] });
    expect(result.error).toContain("No puedo dar un pronóstico exacto");
    expect(result.error).toContain("escenarios condicionados");
    expect(result.responseType).toBe("informational");
  });
  it("preserves metric and filters in continuations with fixed absolute periods", () => {
    const first = run("pipeline");
    const previous = first.trendMemory;
    expect(validateCustomerTrendMemory(previous, snapshot)).toEqual(previous);
    const next = resolve({ granularity: "day" }, { previous, movement: "continue" });
    expect(next.spec.metric).toBe("pipeline");
    expect(next.spec.filters).toEqual({ stageCodes: [], statusCodes: ["en_proceso"], activation: "active" });
    expect(next.range).toEqual({ startDate: "2026-01-01", endDate: "2026-03-31" });
    expect(validateCustomerTrendMemory(previous, { account: { id: 2 } })).toBeNull();
    expect(validateCustomerTrendMemory({ ...previous, fingerprint: 12 }, snapshot)).toBeNull();
  });
});
describe("G06 historic reconstruction and metrics", () => {
  it("reconstructs a full state at each cut, not current amount or current stage", () => {
    const [timeline] = prepareCustomerCommercialHistory(data);
    expect(timeline.continuous).toBe(true);
    expect(reconstructCustomerOpportunity(timeline, "2025-12-31", "UTC", data)).toEqual({ known: true, state: null });
    expect(reconstructCustomerOpportunity(timeline, "2026-01-31", "UTC", data).state).toEqual(initial);
    expect(reconstructCustomerOpportunity(timeline, "2026-02-28", "UTC", data).state).toEqual(second);
    expect(reconstructCustomerOpportunity(timeline, "2026-03-31", "UTC", data).state).toEqual(final);
    const result = run("pipeline");
    expect(result.trendMetadata.table.rows.map((row) => row[2])).toEqual(["1", "1", "0"]);
    expect(result.answer).toContain("USD 500");
    expect(result.answer).toContain("USD 700");
  });
  it("uses all authorized creations and can count before baseline without inventing original amounts", () => {
    const old = { ...data, events: [event(9, "2026-04-01T01:00:00Z", null, final, "baseline")] };
    const result = run("created", {}, old);
    expect(result.trendMetadata.table.rows.map((row) => row[2])).toEqual(["1", "0", "0"]);
    expect(result.trendMetadata.partial).toBe(false);
    expect(run("created", { filters: { stageCodes: ["inicio"] } }, old).trendMetadata.partial).toBe(true);
  });
  it("counts changes once despite a general audit record for the same stage transition", () => {
    const result = run("stage_movements", {}, { ...data, events: [...events, event(10, "2026-02-01T10:00:00Z", null, { sales_stage_id: { before: 1, after: 2 } }, "legacy")] });
    expect(result.trendMetadata.table.rows.map((row) => row[2])).toEqual(["0", "1", "1"]);
    expect(result.trendMetadata.table.rows[1][3]).toContain("1 oportunidades; 1 avances");
  });
  it("does not duplicate certified journey events with operational audit from the same interval", () => {
    const source = { ...data, events: [...events, event(10, "2026-02-01T10:00:01Z",
      { recorded_at: "2026-02-01T10:00:01Z" }, { sales_stage_id: { before: 1, after: 2 } }, "legacy")] };
    const result = run("journey", { opportunityReference: "Alfa" }, source);
    expect(result.trendMetadata.table.rows).toHaveLength(3);
    expect(result.trendMetadata.partial).toBe(false);
    expect(result.answer).not.toContain("Auditoría conservada:");
  });
  it("counts commercial closures separately from invoice revenue", () => {
    const result = run("closures");
    expect(result.trendMetadata.table.rows.map((row) => row[2])).toEqual(["0", "0", "1"]);
    expect(result.trendMetadata.table.rows[2][3]).toContain("ganadas 1");
    expect(result.answer).toContain("no facturación ni cobros");
  });
  it("reports changes without freezing opportunity amounts", () => {
    const result = run("changes");
    expect(result.answer).toContain("500 → 700");
    expect(result.answer).toContain("700 → 1000");
  });
  it("requires explicit names and shows stage journey with initial event", () => {
    const result = run("journey", { opportunityReference: "Alfa" });
    expect(result.answer).toContain("Creación registrada");
    expect(result.answer).toContain("Evaluación");
    expect(result.trendMemory.targetId).toBe(1);
    expect(run("journey", { opportunityReference: "No existe" }).responseType).toBe("clarification");
  });
  it("computes verified completed stays and does not use updated_at as entry", () => {
    const result = run("stage_duration", { opportunityReference: "Alfa" });
    expect(result.trendMetadata.table.rows[0][3]).toContain("31 días");
    expect(result.trendMetadata.table.rows[1][3]).toContain("28 días");
    const baseline = { ...data, events: [event(11, "2026-02-10T00:00:00Z", null, second, "baseline"), events[2]] };
    const incomplete = run("stage_duration", { opportunityReference: "Alfa" }, baseline);
    expect(incomplete.answer).not.toContain("Estancia completada");
    expect(incomplete.trendMetadata.partial).toBe(true);
  });
  it("does not certify a historical state before the first observation or across broken chains", () => {
    const baseline = { ...data, events: [event(11, "2026-04-01T00:00:00Z", null, final, "baseline")] };
    expect(run("pipeline", {}, baseline).trendMetadata.table.rows[0][2]).toContain("parcial");
    const broken = { ...data, events: [events[0], { ...events[2], before_state: state({ amount_usd: 999 }) }] };
    expect(run("pipeline", {}, broken).trendMetadata.partial).toBe(true);
    expect(prepareCustomerCommercialHistory({ ...data, opportunities: [{ ...final, id: 1, amount_usd: 99 }] })[0].continuous).toBe(false);
  });
  it("orders identical timestamps by event identity and does not expose another account's state", () => {
    const moved = state({ account_id: 2 });
    const source = { ...data, opportunities: [{ ...moved, account_id: 1, id: 1 }], events: [
      events[0], event(2, "2026-02-01T10:00:00Z", initial, moved), event(3, "2026-03-01T10:00:00Z", moved, initial),
    ] };
    const timeline = prepareCustomerCommercialHistory(source)[0];
    expect(reconstructCustomerOpportunity(timeline, "2026-02-28", "UTC", source).known).toBe(false);
    const sameTime = { ...data, events: [events[0], events[1], { ...events[2], recorded_at_utc: events[1].recorded_at_utc }] };
    expect(reconstructCustomerOpportunity(prepareCustomerCommercialHistory(sameTime)[0], "2026-02-01", "UTC", sameTime).state).toEqual(final);
  });
  it("reports percentage only for equal-duration complete periods and handles zero base", () => {
    const result = run("created", { period: { mode: "absolute", startDate: "2026-01-01", endDate: "2026-01-31" },
      comparePeriod: { mode: "absolute", startDate: "2025-12-01", endDate: "2025-12-31" } });
    expect(result.answer).toContain("base cero");
    expect(result.trendMetadata.partial).toBe(false);
    const different = run("created", { comparePeriod: { mode: "absolute", startDate: "2026-02-01", endDate: "2026-02-28" } });
    expect(different.answer).toContain("distinta duración");
  });
  it("explains only current evidence and requests refresh after changes", () => {
    const first = run("created");
    const request = resolve({ mode: "explain" }, { previous: first.trendMemory, movement: "request_rationale" });
    expect(buildCustomerTrendResponse({ request, data }).responseType).toBe("informational");
    const changed = { ...data, opportunities: [...data.opportunities, { ...initial, id: 2 }] };
    const stale = buildCustomerTrendResponse({ request, data: changed });
    expect(stale.responseType).toBe("clarification");
    expect(stale.trendMemory).toEqual(first.trendMemory);
  });
  it("does not publish source errors as an empty result", () => {
    expect(run("created", {}, { ...data, complete: false }).responseType).toBe("error");
  });
  it("clarifies an unknown historical stage instead of certifying zero results", () => {
    expect(run("pipeline", { filters: { stageCodes: ["no_existe"] } }).responseType).toBe("clarification");
  });
  it("uses original captured registration dates rather than later edits to created_at", () => {
    const edited = state({ created_at: "2026-02-10 10:00:00" });
    const source = { ...data, opportunities: [{ ...edited, id: 1 }], events: [
      events[0], event(2, "2026-03-01T10:00:00Z", initial, edited),
    ] };
    expect(run("created", {}, source).trendMetadata.table.rows.map((row) => row[2])).toEqual(["1", "0", "0"]);
    expect(reconstructCustomerOpportunity(prepareCustomerCommercialHistory(source)[0], "2026-01-31", "UTC", source).state).toEqual(initial);
  });
  it("requires a new target when explicitly clearing an opportunity journey selection", () => {
    const previous = run("journey", { opportunityReference: "Alfa" }).trendMemory;
    expect(resolve({ opportunityReference: "" }, { previous, movement: "continue" }).error).toContain("Indica una oportunidad");
  });
  it("counts retreats, jumps and reentries independently of numeric catalog spacing", () => {
    const jumped = state({ sales_stage_id: 3 });
    const source = { ...data, opportunities: [{ ...initial, id: 1 }], stages: data.stages.map((stage, i) => ({ ...stage, display_order: [10, 50, 100][i] })), events: [
      events[0], event(2, "2026-02-01T10:00:00Z", initial, jumped),
      event(3, "2026-02-02T10:00:00Z", jumped, initial),
    ] };
    const result = run("stage_movements", {}, source);
    expect(result.trendMetadata.table.rows[1][2]).toBe("2");
    expect(result.trendMetadata.table.rows[1][3]).toBe("1 oportunidades; 1 avances (1 saltos incluidos), 1 retrocesos");
    const stays = run("stage_duration", { opportunityReference: "Alfa" }, source);
    expect(stays.answer).toContain("31 días");
    expect(stays.answer).toContain("1 días");
  });
  it("ends a stay at commercial closure even if its stage has not changed", () => {
    const closed = state({ commercial_status_id: 2 });
    const source = { ...data, opportunities: [{ ...closed, id: 1 }], events: [
      events[0], event(2, "2026-02-01T10:00:00Z", initial, closed),
    ] };
    const result = run("stage_duration", { opportunityReference: "Alfa", period: { mode: "absolute", startDate: "2026-01-01", endDate: "2026-04-01" } }, source);
    expect(result.trendMetadata.table.rows).toHaveLength(1);
    expect(result.answer).toContain("31 días");
    expect(result.answer).not.toContain("Estancia abierta desde");
    expect(result.answer).toContain("periodo está en curso");
    expect(run("journey", { opportunityReference: "Alfa" }, source).answer).toContain("Inicio / ganada / activada");
  });
  it("does not infer stage entry when an opportunity returns from another account", () => {
    const foreign = state({ account_id: 2 });
    const source = { ...data, opportunities: [{ ...initial, id: 1 }], events: [
      events[0], event(2, "2026-02-01T10:00:00Z", initial, foreign),
      event(3, "2026-03-01T10:00:00Z", foreign, initial),
    ] };
    const result = run("stage_duration", { opportunityReference: "Alfa", period: { mode: "absolute", startDate: "2026-01-01", endDate: "2026-04-01" } }, source);
    expect(result.trendMetadata.table.rows).toHaveLength(0);
    expect(result.answer).not.toContain("Estancia abierta desde");
    expect(result.trendMetadata.partial).toBe(true);
  });
  it("sums exact cents without treating current-day cuts as completed future days", () => {
    const opportunities = [0.1, 0.2, 0.3].map((amount_usd, index) => ({ ...initial, amount_usd, id: index + 1 }));
    const source = { ...data, opportunities, events: opportunities.map(({ id, ...after }) => event(id, events[0].recorded_at_utc, null, after, "created", id)) };
    const result = run("pipeline", {}, source);
    expect(result.trendMetadata.table.rows.map((row) => row[3])).toEqual(["USD 0.60", "USD 0.60", "USD 0.60"]);
    const today = run("pipeline", { period: { mode: "absolute", startDate: "2026-04-01", endDate: "2026-04-01" } }, source);
    expect(today.answer).toContain("periodo está en curso");
    expect(today.answer).toContain("no un día futuro completado");
  });
});
