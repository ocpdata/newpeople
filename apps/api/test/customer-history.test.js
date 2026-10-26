import { describe, expect, it } from "vitest";
import {
  buildCustomerHistoryReadFilter, buildCustomerHistoryResponse, customerHistoryDate, getCustomerHistorySourceAccess,
  resolveCustomerHistoryPeriod, resolveCustomerHistoryRequest,
} from "../src/commercial-intelligence/customer-history.js";

const now = new Date("2026-10-17T05:30:00Z");
const timezone = "America/Mexico_City";
const snapshot = {
  account: { id: 22, name: "Cuenta sintética" },
  opportunities: [
    { id: 36, accountId: 22, name: "Hardware Refresh" },
    { id: 67, accountId: 22, name: "Hardware Refresh 3 Años" },
  ],
  contacts: [{ id: 232, accountId: 22, name: "Alejandro Ruiz" }],
  permissions: { canReadInteractions: true, canReadOpportunityActivities: true, canReadCalendarActivities: true },
  interactions: [
    { id: 1, accountId: 22, contactIds: [232], title: "Revisión", createdAt: "2026-06-01" },
    { id: 2, accountId: 22, contactIds: [], title: "Otra gestión", createdAt: "2026-06-30" },
    { id: 3, accountId: 99, title: "Otra cuenta", createdAt: "2026-06-20" },
  ],
  opportunityActivities: [
    { id: 30, accountId: 22, opportunityId: 36, title: "Averiguar si aprobaron presupuesto", status: "completed", dueDate: "2026-06-18" },
    { id: 40, accountId: 22, opportunityId: 36, title: "Seguimiento", status: "pending", dueDate: "2026-07-01" },
    { id: 75, accountId: 22, opportunityId: 67, title: "Otra oportunidad", status: "completed", dueDate: "2026-06-18" },
  ],
  calendarActivities: [
    { id: 1, accountId: 22, opportunityId: 36, title: "Reunión", status: "completed", scheduledAt: "2026-06-18" },
  ],
};
const metrics = ["interactions", "opportunity_activities", "calendar_activities"]
  .map((source) => ({ source, truncated: false, errorCode: null }));
const permissions = new Set(["cuentas.read", "contactos.read", "interacciones.read", "oportunidades.read", "desarrollo_comercial.read", "calendario_comercial.read"]);
const period = { mode: "absolute", startDate: "2026-06-01", endDate: "2026-06-30" };
function resolve(historySpec = {}, extra = {}) {
  return resolveCustomerHistoryRequest({
    component: { object: "account", reference: "", historySpec },
    movement: "new_request", previous: null, snapshot, context: { accountId: 22 },
    now, timezone, businessRules: {}, ...extra,
  });
}
function render(spec = {}, extra = {}) {
  const request = resolve({ period, ...spec });
  const access = getCustomerHistorySourceAccess({
    request, snapshot, permissions,
    intent: { allowedTools: ["searchInteractions", "getOpportunityActivities"] }, businessRules: {},
  });
  return buildCustomerHistoryResponse({ request, snapshot, metrics, access, timezone, ...extra });
}

describe("Q06 deterministic history synthesis", () => {
  it("shows dated activity entries and notes without treating an activity title as an outcome", () => {
    const response = render({ sources: ["opportunityActivities"] }, { snapshot: {
      ...snapshot, opportunityActivities: [
        snapshot.opportunityActivities[0],
        { ...snapshot.opportunityActivities[0], id: 31, status: "done", notes: "El cliente sigue revisando." },
        { ...snapshot.opportunityActivities[0], id: 32, status: "pending" },
        { ...snapshot.opportunityActivities[0], id: 33, status: "cancelled" },
      ],
    } });
    expect(response.answer).toContain("Estado de las actividades: 2 realizadas, 1 pendiente, 1 cancelada");
    expect(response.answer).toContain("El cliente sigue revisando.");
    expect(response.answer).toContain("El título por sí solo no permite saber cómo terminó la gestión.");
    expect(response.answer).toContain("Averiguar si aprobaron presupuesto");
    expect(response.answer).toContain("2026-06-18 · Vencimiento");
    expect(response.activityHistory.sections[0].items).toHaveLength(4);
  });
  it("bounds inline notes while preserving all recovered events and full notes in structured history", () => {
    const response = render({ sources: ["opportunityActivities"] }, { snapshot: {
      ...snapshot, opportunityActivities: Array.from({ length: 6 }, (_, index) => ({
        ...snapshot.opportunityActivities[0], id: index + 1, notes: "x".repeat(600),
      })),
    } });
    expect(response.answer.match(/Nota:/g)).toHaveLength(5);
    expect(response.answer).toContain("extracto; consulta el detalle");
    expect(response.answer).toContain("Incluyo hasta cinco notas");
    expect(response.answer.match(/Nota: x{1,}/g)).toHaveLength(5);
    expect(response.activityHistory.sections[0].items[0].details).toHaveLength(600);
  });
});

describe("Q06 temporal semantics", () => {
  it.each([{ interactions: [] }, { interactions: snapshot.interactions }])("explains conditional absence without treating recovered rows as proof: %j", ({ interactions }) => {
    const request = resolve({ purpose: "absence_explanation", sources: ["interactions"] });
    const response = buildCustomerHistoryResponse({ request, snapshot: { ...snapshot, interactions }, timezone });
    expect(response.answer).toMatch(/^No\./);
    expect(response.answer).toContain("no demuestra que nunca");
    expect(response.answer).toContain("No he verificado");
    expect(response.answer).toContain("oportunidades");
    expect(response.answer).toContain("calendario");
    expect(response.answer).not.toContain("Historial de");
    expect(request.range).toBeUndefined();
    expect(response.activityHistory).toBeUndefined();
    expect(response.historyMemory).toBeUndefined();
    expect(response.evidence).toEqual([]);
    expect(response.operations).toEqual([]);
  });
  it("does not inherit absence explanation as a history filter", () => {
    const request = resolve({ period }, { movement: "continue", previous: {
      accountId: 22, object: "account", targetId: 22,
      spec: { purpose: "absence_explanation", period, sources: ["interactions"] },
    } });
    expect(request.purpose).toBe("timeline");
    expect(request.range).toEqual({ startDate: "2026-06-01", endDate: "2026-06-30" });
    expect(request.memory.spec).not.toHaveProperty("purpose");
  });
  it("preserves explicit clarification and unsupported conditions in an absence explanation", () => {
    expect(resolve({ purpose: "absence_explanation", clarification: "Precisa la pregunta." }).error).toBe("Precisa la pregunta.");
    expect(resolve({ purpose: "absence_explanation", unsupported: ["auditoría"] }).error).toContain("auditoría");
    expect(resolve({ purpose: "absence_explanation", accountReference: "Otra cuenta" }).error).toContain("seleccionada");
  });
  it("distinguishes direct account links, opportunity links and unknown provenance without inferring conversations", () => {
    const response = render({ sources: ["interactions"] }, { snapshot: { ...snapshot, interactions: [
      { ...snapshot.interactions[0], directAccountId: 22 },
      { ...snapshot.interactions[1], directAccountId: null, opportunityId: 36 },
      { ...snapshot.interactions[0], id: 4 },
    ] } });
    expect(response.activityHistory.sections[0].items.map((item) => item.accountLink))
      .toEqual(["Cuenta directa", "Vínculo directo no verificado", "Mediante oportunidad"]);
    expect(response.activityHistory.sections[0].items.every((item) => item.dateMeaning === "Creación de interacción")).toBe(true);
    expect(response.answer).toContain("Este resumen cubre las fuentes y el periodo consultados");
  });
  it("uses the business date rather than UTC at midnight", () => {
    expect(customerHistoryDate(now, timezone)).toBe("2026-10-16");
    expect(resolve().range).toEqual({ startDate: "2026-04-16", endDate: "2026-10-16" });
    expect(resolve().defaultPeriod).toBe(true);
  });
  it.each([
    [{ mode: "relative", amount: 1, unit: "day" }, "2026-10-15", "2026-10-16"],
    [{ mode: "relative", amount: 2, unit: "week" }, "2026-10-02", "2026-10-16"],
    [{ mode: "relative", amount: 3, unit: "quarter" }, "2026-01-16", "2026-10-16"],
    [{ mode: "relative", amount: 1, unit: "year" }, "2025-10-16", "2026-10-16"],
    [{ mode: "calendar", unit: "month", year: 2026, index: 6 }, "2026-06-01", "2026-06-30"],
    [{ mode: "calendar", unit: "quarter", year: 2026, index: 1 }, "2026-01-01", "2026-03-31"],
    [{ mode: "calendar", unit: "year", year: 2024 }, "2024-01-01", "2024-12-31"],
    [{ mode: "calendar", unit: "month", offset: -1 }, "2026-09-01", "2026-09-30"],
    [{ mode: "calendar", unit: "quarter", offset: 0 }, "2026-10-01", "2026-10-16"],
    [{ mode: "calendar", unit: "year", offset: -1 }, "2025-01-01", "2025-12-31"],
  ])("resolves %j with a fixed clock", (value, startDate, endDate) => {
    expect(resolveCustomerHistoryPeriod(value, now, timezone)).toEqual({ startDate, endDate });
  });
  it("clamps month subtraction at leap-day boundaries", () => {
    expect(resolveCustomerHistoryPeriod({ mode: "relative", unit: "month", amount: 1 }, new Date("2024-03-31T12:00:00Z"), timezone).startDate).toBe("2024-02-29");
  });
  it.each([
    { mode: "absolute", startDate: "2026-02-29", endDate: "2026-03-01" },
    { mode: "absolute", startDate: "2027-01-01", endDate: "2026-01-01" },
    { mode: "absolute", startDate: "2020-01-01", endDate: "2026-01-01" },
    { mode: "relative", unit: "month", amount: 0 },
    { mode: "relative", unit: "year", amount: 6 },
    { mode: "calendar", unit: "month", year: 2026, index: 0 },
    { mode: "calendar", unit: "quarter", year: 2026, index: 5 },
    { mode: "calendar", unit: "day" },
    { mode: "calendar", unit: "month", year: 0, index: 6 },
  ])("rejects invalid or ambiguous periods %j", (value) => {
    expect(resolve({ period: value }).error).toBeTruthy();
  });
  it.each(["2026-06-31", "2026-06-18 12:00:00", "", "not a date", null])("does not silently reinterpret %j", (value) => {
    expect(customerHistoryDate(value, timezone)).toBeNull();
  });
});

describe("Q06 entity and filter continuity", () => {
  it("resolves the exact opportunity instead of its longer prefix match", () => {
    const request = resolve({}, { component: { object: "opportunity", reference: "Hardware Refresh" } });
    expect(request.memory.targetId).toBe(36);
  });
  it.each(["unknown", "Hardware"])("asks for unresolved reference %s", (reference) => {
    expect(resolve({}, { component: { object: "opportunity", reference } }).error).toBeTruthy();
  });
  it("resolves contacts using the existing authorized resolver", () => {
    expect(resolve({}, { component: { object: "contact", reference: "Alejandro Ruiz" } }).memory.targetId).toBe(232);
  });
  it("does not use another account's context or reference", () => {
    expect(resolve({}, { context: { accountId: 99 } }).error).toBeTruthy();
    expect(resolve({ accountReference: "Otra cuenta" }).error).toBeTruthy();
    expect(resolve({}, { component: { object: "account", reference: "Otra cuenta" } }).error).toBeTruthy();
  });
  it.each([
    { clarification: "¿Qué año?" }, { unsupported: ["correos"] }, { statuses: ["ganada"] },
  ])("does not ignore unsupported or ambiguous criteria %j", (spec) => {
    expect(resolve(spec).error).toBeTruthy();
  });
  it("changes only masked groups, clears statuses, and preserves the resolved absolute period", () => {
    const previous = resolve({ period, statuses: ["completed"], sources: ["opportunityActivities"] }).memory;
    const current = resolve({}, {
      movement: "continue", previous,
      component: { object: "account", reference: "", historySpec: {
        changed: ["statuses"], statuses: [], period: { mode: "default" }, sources: [],
      } },
    });
    expect(current.spec).toMatchObject({ period, sources: ["opportunityActivities"], statuses: [] });
    expect(previous.spec.statuses).toEqual(["completed"]);
  });
  it("resets criteria on a new request or changed entity", () => {
    const previous = resolve({ period, statuses: ["completed"] }).memory;
    expect(resolve({}, { previous }).spec.statuses).toEqual([]);
    expect(resolve({}, { previous, movement: "continue",
      component: { object: "opportunity", reference: "Hardware Refresh" } }).spec.statuses).toEqual([]);
  });
});

describe("Q06 deterministic chronology and source coverage", () => {
  it("combines sources chronologically, keeps source-qualified IDs and excludes other accounts", () => {
    const result = render();
    expect(result.activityHistory.sections[0].items.map((item) => item.id)).toEqual([
      "interactions:1", "calendarActivities:1", "opportunityActivities:30", "opportunityActivities:75", "interactions:2",
    ]);
    expect(result.activityHistory.metadata).toMatchObject({ matched: 5, partial: false, shown: 5 });
    expect(result.operations).toEqual([]);
  });
  it("filters performed activities for the exact opportunity without inventing budget approval", () => {
    const request = resolve({}, { component: {
      object: "opportunity", reference: "Hardware Refresh", historySpec: { period, statuses: ["completed"] },
    } });
    const result = render({}, { request });
    const items = result.activityHistory.sections[0].items;
    expect(items.map((item) => item.id)).toEqual(["calendarActivities:1", "opportunityActivities:30"]);
    expect(items[1]).toMatchObject({ title: "Averiguar si aprobaron presupuesto", dateMeaning: "Vencimiento" });
    expect(result.answer).not.toMatch(/presupuesto aprobado/i);
  });
  it("does not broaden contact history to the account", () => {
    const request = resolve({}, { component: { object: "contact", reference: "Alejandro Ruiz", historySpec: { period } } });
    const access = getCustomerHistorySourceAccess({ request, snapshot, permissions,
      intent: { allowedTools: ["searchInteractions"] },
      activityIntent: { allowedTools: ["getOpportunityActivities"] }, businessRules: {} });
    const result = render({}, { request, access });
    expect(result.activityHistory.sections[0].items.map((item) => item.id)).toEqual(["interactions:1"]);
    expect(result.activityHistory.coverage[1].status).toBe("not_applicable");
    expect(result.activityHistory.coverage[2].status).toBe("complete");
  });
  it("keeps distinct records with identical titles but deduplicates the same source identity", () => {
    const duplicate = snapshot.interactions[0];
    const result = render({}, { snapshot: { ...snapshot, interactions: [duplicate, duplicate, { ...duplicate, id: 5 }] } });
    expect(result.activityHistory.sections[0].items.filter((item) => item.source === "interactions")).toHaveLength(2);
  });
  it("orders timed events within the same business day by timestamp, not source or ID", () => {
    const result = render({ sources: ["interactions"] }, { snapshot: { ...snapshot, interactions: [
      { id: 1, accountId: 22, title: "Tarde", createdAt: "2026-06-18T23:00:00Z" },
      { id: 99, accountId: 22, title: "Mañana", createdAt: "2026-06-18T15:00:00Z" },
    ] } });
    expect(result.activityHistory.sections[0].items.map((item) => item.recordId)).toEqual([99, 1]);
    expect(result.activityHistory.sections[0].items[0]).toMatchObject({ date: "2026-06-18", time: "09:00" });
  });
  it.each(["pending", "in_progress", "blocked", "completed", "cancelled"])("applies the exact activity state %s", (status) => {
    const result = render({ statuses: [status], sources: ["opportunityActivities"] }, { snapshot: {
      ...snapshot, opportunityActivities: [
        { ...snapshot.opportunityActivities[0], status: status === "completed" ? "done" : status },
      ],
    } });
    expect(result.activityHistory.sections[0].items).toHaveLength(1);
  });
  it("identifies undated and invalid-date records without counting them in the period", () => {
    const result = render({}, { snapshot: { ...snapshot, interactions: [
      { ...snapshot.interactions[0], createdAt: null },
      { ...snapshot.interactions[1], createdAt: "invalid" },
    ] } });
    expect(result.activityHistory.metadata).toMatchObject({ matched: 3, undated: 2 });
    expect(result.activityHistory.sections[1].items).toHaveLength(2);
    expect(result.answer).toContain("no se puede comprobar");
  });
  it("filters the scheduled date rather than silently using another date in the range", () => {
    const result = render({}, { snapshot: { ...snapshot, calendarActivities: [
      { ...snapshot.calendarActivities[0], scheduledAt: "2026-07-01", dueDate: "2026-06-18" },
    ] } });
    expect(result.activityHistory.sections[0].items.some((item) => item.source === "calendarActivities")).toBe(false);
  });
  it("applies the limit after ordering all sources", () => {
    const result = render({ limit: 2 });
    expect(result.activityHistory.sections[0].items.map((item) => item.id)).toEqual(["interactions:1", "calendarActivities:1"]);
    expect(result.activityHistory.metadata).toMatchObject({ shown: 2, matched: 5, presentationLimited: true });
    expect(resolve({ limit: 999 }).spec.limit).toBe(50);
  });
  it("enforces the exact 50-event presentation ceiling", () => {
    const result = render({ sources: ["interactions"], limit: 500 }, { snapshot: {
      ...snapshot, interactions: Array.from({ length: 60 }, (_, index) => ({
        id: index + 1, accountId: 22, createdAt: "2026-06-18", title: `Evento ${index + 1}`,
      })),
    } });
    expect(result.activityHistory.sections[0].items).toHaveLength(50);
    expect(result.activityHistory.metadata).toMatchObject({ matched: 60, shown: 50, presentationLimited: true });
  });
  it.each([
    [[], "partial"],
    [[{ source: "interactions", truncated: true }], "partial"],
    [[{ source: "interactions", errorCode: "query_error" }], "failed"],
  ])("does not turn incomplete source metadata into verified emptiness", (sourceMetrics, status) => {
    const result = render({ sources: ["interactions"] }, { metrics: sourceMetrics, snapshot: { ...snapshot, interactions: [] } });
    expect(result.activityHistory.coverage[0].status).toBe(status);
    expect(result.answer).toContain("no demuestra ausencia");
    expect(result.responseType).toBe(status === "failed" ? "error" : "informational");
  });

  describe("Q06 database read scopes", () => {
    it.each(["interactions", "opportunityActivities", "calendarActivities"])("bounds the %s source with parameterized dates", (source) => {
      const filter = buildCustomerHistoryReadFilter(source, resolve({ period }));
      expect(filter.params).toEqual(["2026-06-01", "2026-06-30"]);
      expect(filter.sql).toContain("IS NULL OR");
      expect(filter.sql).toContain("DATE_SUB(?, INTERVAL 1 DAY)");
      expect(filter.sql).toContain("DATE_ADD(?, INTERVAL 2 DAY)");
    });
    it.each(["interactions", "opportunityActivities", "calendarActivities"])("pushes the selected opportunity into %s before the read limit", (source) => {
      const request = resolve({}, { component: { object: "opportunity", reference: "Hardware Refresh", historySpec: { period } } });
      const filter = buildCustomerHistoryReadFilter(source, request);
      expect(filter.params).toEqual(["2026-06-01", "2026-06-30", 36]);
      expect(filter.sql).toMatch(/(?:primary_opportunity_id|a\.opportunity_id|linked_i.primary_opportunity_id\)) = \?$/);
    });
    it("uses explicit contact links, not account membership, for contact reads", () => {
      const request = resolve({}, { component: { object: "contact", reference: "Alejandro Ruiz", historySpec: { period } } });
      expect(buildCustomerHistoryReadFilter("interactions", request).sql).toContain("interaction_contact_links");
      expect(buildCustomerHistoryReadFilter("calendarActivities", request).sql).toContain("cca.contact_id = ?");
      expect(() => buildCustomerHistoryReadFilter("opportunityActivities", request)).toThrow("vínculo de contacto");
    });
    it("rejects invalid source and target values rather than constructing a broad read", () => {
      expect(() => buildCustomerHistoryReadFilter("unknown", resolve({ period }))).toThrow("inválidos");
      const request = resolve({ period });
      expect(() => buildCustomerHistoryReadFilter("interactions", { ...request, memory: { ...request.memory, targetId: "1 OR 1=1" } })).toThrow("inválidos");
    });
  });
  it("returns other usable sources when one fails and identifies that failure", () => {
    const result = render({}, { metrics: metrics.map((item) => item.source === "interactions" ? { ...item, errorCode: "query_error" } : item) });
    expect(result.responseType).toBe("informational");
    expect(result.activityHistory.sections[0].items).toHaveLength(3);
    expect(result.answer).toContain("falló la lectura");
    expect(result.historyMemory).toBeUndefined();
  });
  it("does not mistake a failed contact-link read for a contact with no interactions", () => {
    const request = resolve({}, { component: { object: "contact", reference: "Alejandro Ruiz", historySpec: {
      period, sources: ["interactions"],
    } } });
    const access = getCustomerHistorySourceAccess({ request, snapshot, permissions,
      intent: { allowedTools: ["searchInteractions"] }, businessRules: {} });
    const result = render({}, { request, access, metrics: [
      ...metrics, { source: "interaction_contact_links", errorCode: "query_error" },
    ] });
    expect(result.responseType).toBe("error");
    expect(result.activityHistory.coverage[0].status).toBe("failed");
    expect(result.activityHistory.sections[0].items).toEqual([]);
  });
  it("does not show events of opportunities outside the authorized recovered set", () => {
    const result = render({}, { snapshot: { ...snapshot, opportunityActivities: [
      ...snapshot.opportunityActivities,
      { ...snapshot.opportunityActivities[0], id: 90, opportunityId: 999 },
    ] } });
    expect(result.activityHistory.sections[0].items.some((item) => item.id === "opportunityActivities:90")).toBe(false);
    expect(result.activityHistory.coverage[1].status).toBe("partial");
  });
  it.each([
    [new Set(), {}, "restricted"],
    [permissions, { allowedTools: [] }, "disabled"],
  ])("respects permissions and the configured tool allowlist", (granted, intent, status) => {
    const request = resolve({ sources: ["interactions"] });
    const access = getCustomerHistorySourceAccess({ request, snapshot, permissions: granted, intent, businessRules: {} });
    expect(access[0].status).toBe(status);
  });
  it("does not claim that no interaction rows means no client relationship", () => {
    const result = render({ sources: ["interactions"] }, { snapshot: { ...snapshot, interactions: [] } });
    expect(result.answer).toContain("no demuestra que nunca hubo contacto");
    expect(result.activityHistory.metadata.partial).toBe(false);
  });
});
