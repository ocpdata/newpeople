import { describe, expect, it } from "vitest";
import { buildCustomerPendingReadFilter, buildCustomerPendingResponse, resolveCustomerPendingRequest,
  validateCustomerPendingMemory } from "../src/commercial-intelligence/customer-pending.js";
import { getCustomerHistorySourceAccess } from "../src/commercial-intelligence/customer-history.js";
import { validateCustomerConversationContext } from "../src/commercial-intelligence/conversation-context.js";

const now = new Date("2026-10-17T05:30:00Z"), timezone = "America/Mexico_City";
const ids = [21, 27, 40, 41, 67, 68, 75];
const snapshot = {
  account: { id: 22, name: "Cuenta sintética" },
  opportunities: [{ id: 36, accountId: 22, name: "Hardware Refresh", commercialStatusCode: "en_proceso", activationStatusCode: "activada" },
    { id: 51, accountId: 22, name: "Ganada", commercialStatusCode: "ganada", activationStatusCode: "activada" }],
  inactiveOpportunities: [{ id: 94, accountId: 22, name: "Inactiva", commercialStatusCode: "perdida", activationStatusCode: "desactivada" }],
  contacts: [{ id: 232, accountId: 22, name: "Persona" }],
  permissions: { canReadOpportunityActivities: true, canReadCalendarActivities: true },
  opportunityActivities: [
    ...ids.map((id) => ({ id, accountId: 22, opportunityId: id === 21 ? 51 : id === 75 ? 94 : 36,
      title: `Actividad ${id}`, status: "pending", dueDate: id === 67 ? null : "2026-10-13", scheduledAt: null, createdAt: "2026-01-01" })),
    ...[25, 26, 30].map((id) => ({ id, accountId: 22, opportunityId: 36, status: id === 25 ? "cancelled" : "done" })),
  ],
  calendarActivities: [],
};
const metrics = ["opportunity_activities", "calendar_activities", "opportunities_active", "opportunities_inactive"]
  .map((source) => ({ source, truncated: false, errorCode: null }));
const permissions = new Set(["oportunidades.read", "desarrollo_comercial.read", "calendario_comercial.read"]);
const intent = { allowedTools: ["getOpportunityActivities"] };
function resolve(pendingSpec = {}, extra = {}) {
  return resolveCustomerPendingRequest({ component: { object: "activity", reference: "", pendingSpec },
    movement: "new_request", snapshot, context: { accountId: 22 }, now, timezone, businessRules: {}, ...extra });
}
function render(spec = {}, extra = {}) {
  const request = resolve(spec);
  const access = getCustomerHistorySourceAccess({ request, snapshot, permissions, intent, businessRules: {} });
  return buildCustomerPendingResponse({ request, snapshot, access, metrics, timezone, ...extra });
}
describe("Q07 deterministic pending activities", () => {
  it("lists the seven authorized pending IDs including undated, won and inactive opportunities without a default date filter", () => {
    const result = render();
    expect(result.activityHistory.sections.flatMap((section) => section.items.map((item) => item.recordId)).sort((a, b) => a - b)).toEqual(ids);
    expect(result.activityHistory.sections[1].items.map((item) => item.recordId)).toEqual([67]);
    expect(result.answer).toContain("registro 67");
    expect(result.answer).toContain("sin fecha; vencimiento no verificable");
    expect(result.answer).toContain("Sin límite temporal implícito");
    expect(result.answer).toContain("7 actividad(es) pendiente(s) recuperada(s); 7 mostrada(s).");
    expect(result.answer).not.toContain("Estados de oportunidad: todos los autorizados");
    expect(result.answer).not.toContain("activación: all");
    expect(result.activityHistory.metadata.partial).toBe(false);
    expect(result.operations).toEqual([]);
    expect(resolve().range).toBeNull();
  });
  it("does not use creation as a commitment or claim undated activities are overdue", () => {
    const result = render({ mode: "overdue", asOf: "2026-10-13" });
    expect(result.activityHistory.sections[0].items).toEqual([]);
    expect(result.activityHistory.sections[1].items[0]).toMatchObject({ recordId: 67, date: "", overdue: null });
    expect(render({ mode: "overdue", asOf: "2026-10-14", includeUndated: false }).activityHistory.sections[0].items).toHaveLength(6);
    expect(resolve().spec.asOf).toBe("2026-10-16");
  });
  it("excludes same-day and future commitments from overdue while retaining undated separately", () => {
    const rows = snapshot.opportunityActivities.map((item) => item.id === 21 ? { ...item, dueDate: "2026-10-17" } : item);
    const result = render({ mode: "overdue", asOf: "2026-10-17" }, { snapshot: { ...snapshot, opportunityActivities: rows } });
    expect(result.activityHistory.sections[0].items.some((item) => item.recordId === 21)).toBe(false);
    expect(result.activityHistory.sections[1].items[0].recordId).toBe(67);
  });
  it("uses only explicit date, state, source and opportunity filters", () => {
    expect(render({ period: { mode: "absolute", startDate: "2026-10-14", endDate: "2026-10-15" } })
      .activityHistory.sections[0].items).toEqual([]);
    expect(render({ statuses: ["blocked"] }).activityHistory.metadata.matched).toBe(0);
    expect(render({ sources: ["calendarActivities"] }).activityHistory.metadata.matched).toBe(0);
    expect(render({ activation: "inactive" }).activityHistory.sections[0].items.map((item) => item.recordId)).toEqual([75]);
    expect(render({ opportunityStatusCodes: ["ganada"] }).activityHistory.sections[0].items.map((item) => item.recordId)).toEqual([21]);
    const request = resolve({ opportunityReference: "Hardware Refresh" });
    expect(request.memory.targetId).toBe(36);
    expect(render({}, { request }).activityHistory.sections.flatMap((s) => s.items).some((item) => [21, 75].includes(item.recordId))).toBe(false);
  });
  it("keeps contact pending records limited to explicit calendar links", () => {
    const request = resolve({ contactReference: "Persona" });
    const access = getCustomerHistorySourceAccess({ request, snapshot, permissions, intent, activityIntent: intent, businessRules: {} });
    const result = render({}, { request, access, snapshot: { ...snapshot, calendarActivities: [
      { id: 1, accountId: 22, contactId: 232, status: "pending", opportunityId: null },
      { id: 2, accountId: 22, contactId: 233, status: "pending", opportunityId: 36 },
    ] } });
    expect(result.activityHistory.sections.flatMap((s) => s.items).map((item) => item.recordId)).toEqual([1]);
    expect(result.activityHistory.coverage[0].status).toBe("not_applicable");
  });
  it.each([
    { readMetrics: [] }, { readMetrics: metrics.map((item) => item.source === "opportunity_activities" ? { ...item, truncated: true } : item) },
    { readMetrics: metrics.map((item) => item.source === "opportunities_active" ? { ...item, errorCode: "query_error" } : item) },
  ])("does not turn partial or unqueried sources into absence: %j", ({ readMetrics }) => {
    const result = render({}, { metrics: readMetrics, snapshot: { ...snapshot, opportunityActivities: [] } });
    expect(result.activityHistory.metadata.partial).toBe(true);
    expect(result.answer).toContain("no puedo afirmar que no existan pendientes");
    expect(result.answer).not.toContain("No encontré actividades pendientes");
  });
  it("reports failed or restricted sources explicitly without a success-shaped empty result", () => {
    const request = resolve({ sources: ["opportunityActivities"] });
    const result = render({}, { request, access: [{ source: "opportunityActivities", title: "Actividades", status: "available" }],
      metrics: [{ source: "opportunity_activities", errorCode: "query_error" }] });
    expect(result.responseType).toBe("error");
    expect(result.answer).toContain("falló la lectura");
    expect(result.answer).not.toContain("No encontré actividades pendientes");
    expect(getCustomerHistorySourceAccess({ request, snapshot, permissions: new Set(), intent, businessRules: {} })[0].status).toBe("restricted");
  });
  it("states a complete empty result only after reading the authorized sources", () => {
    expect(render({}, { snapshot: { ...snapshot, opportunityActivities: [] } }).answer).toContain("No encontré actividades pendientes");
  });
  it("marks missing opportunity links and channel exclusions as partial and enforces account boundaries", () => {
    const result = render({}, { snapshot: { ...snapshot, opportunityActivities: [
      ...snapshot.opportunityActivities, { id: 999, accountId: 99, opportunityId: 36, status: "pending" },
      { id: 998, accountId: 22, opportunityId: 999, status: "pending" },
    ], collectionScopes: { opportunities: "excluye ganadas" } } });
    expect(result.activityHistory.metadata.partial).toBe(true);
    expect(result.answer).not.toContain("Registro 999");
    expect(result.answer).not.toContain("Registro 998");
    expect(result.answer).toContain("excluye ganadas");
  });
  it("declares presentation limits rather than claiming that the displayed rows are all matches", () => {
    const result = render({ limit: 2 });
    expect(result.activityHistory.metadata).toMatchObject({ matched: 7, shown: 2, presentationLimited: true });
    expect(result.answer).toContain("sin paginación");
  });
  it("preserves effective filters in validated context and continuation while isolating new requests", () => {
    const first = resolve({ opportunityReference: "Hardware Refresh", sources: ["opportunityActivities"], includeUndated: false });
    expect(validateCustomerPendingMemory(first.memory, snapshot)).toEqual(first.memory);
    const context = validateCustomerConversationContext({ accountId: 22, pendingMemory: first.memory }, snapshot, 22);
    expect(context.pendingMemory).toEqual(first.memory);
    const next = resolve({ changed: ["mode"], mode: "overdue", sources: [] }, {
      previous: first.memory, movement: "continue",
    });
    expect(next.memory.targetId).toBe(36);
    expect(next.spec.sources).toEqual(["opportunityActivities"]);
    expect(next.spec.includeUndated).toBe(false);
    expect(resolve({}, { previous: first.memory }).spec.sources).toHaveLength(2);
    expect(validateCustomerPendingMemory({ ...first.memory, accountId: 99 }, snapshot)).toBeNull();
  });
  it.each([{ clarification: "¿De qué año?" }, { unsupported: ["correos"] }, { asOf: "2026-02-30" },
    { accountReference: "Otra cuenta" }, { opportunityReference: "No visible" },
    { contactReference: "Persona", opportunityReference: "Hardware Refresh" },
    { period: { mode: "absolute", startDate: "2026-07-01", endDate: "2026-06-01" } }])("rejects unresolved or unsupported criteria: %j", (spec) => {
    expect(resolve(spec).error).toBeTruthy();
  });
  it("builds bounded-source reads without date exclusions or implicit commercial filters", () => {
    const request = resolve();
    const read = buildCustomerPendingReadFilter("opportunityActivities", request);
    expect(read.sql).toContain("a.status IN (?)");
    expect(read.sql).not.toContain("created_at");
    expect(read.sql).not.toContain("commercial_status");
    expect(read.params).toEqual(["pending"]);
    expect(buildCustomerPendingReadFilter("calendarActivities", request).sql).toContain("linked_i.primary_opportunity_id");
    expect(() => buildCustomerPendingReadFilter("interactions", request)).toThrow("inválidos");
    expect(() => buildCustomerPendingReadFilter("opportunityActivities", { ...request, spec: { statuses: ["done"] } })).toThrow("inválidos");
  });
});
