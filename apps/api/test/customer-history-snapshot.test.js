import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db.js", async (original) => ({ ...(await original()), query: vi.fn() }));
vi.mock("../src/commercial-intelligence/schema.js", () => ({ ensureCommercialIntelligenceSchema: vi.fn() }));
vi.mock("../src/landing/schema.js", () => ({ ensureLandingSchema: vi.fn() }));
vi.mock("../src/manufacturer-registrations/schema.js", () => ({ ensureManufacturerRegistrationsSchema: vi.fn() }));
vi.mock("../src/commercial-intelligence/calendar-activities-schema.js", () => ({ ensureCommercialCalendarActivitiesSchema: vi.fn() }));

import { query } from "../src/db.js";
import { buildAuthorizedCustomerSnapshot, getCustomerSnapshotQueryMetrics } from "../src/commercial-intelligence/service.js";
import { resolveCustomerPendingRequest } from "../src/commercial-intelligence/customer-pending.js";

const user = { id: 7, permissionSet: new Set([
  "cuentas.read", "contactos.read", "oportunidades.read", "interacciones.read",
  "desarrollo_comercial.read", "calendario_comercial.read",
]) };
const historyRequest = { memory: { object: "account", accountId: 22, targetId: 22 },
  range: { startDate: "2026-06-01", endDate: "2026-06-30" } };
const sources = ["interactions", "opportunityActivities", "calendarActivities"];
const sourceQuery = (source) => query.mock.calls.find(([sql]) => source === "interactions" ? /^\s*SELECT i\.id,/.test(sql) : sql.includes({
  interactions: "FROM interactions i\n",
  opportunityActivities: "FROM opportunity_workspace_actions a\n",
  calendarActivities: "FROM commercial_calendar_activities cca\n",
}[source]));

describe("Q06 authorized snapshot reads", () => {
  beforeEach(() => {
    query.mockReset();
    query.mockImplementation(async (sql) => {
      if (sql.includes("FROM accounts a\n")) return [{ id: 22, name: "Cuenta sintética", status_code: "activada" }];
      return [];
    });
  });
  const load = (extra = {}) => buildAuthorizedCustomerSnapshot({
    user, accountId: 22, historySources: sources, historyRequest, includeProviderCatalog: false, ...extra,
  });
  it("reads each requested source with authorization, bounded dates and LIMIT 501", async () => {
    const snapshot = await load();
    for (const source of sources) {
      const [sql, params] = sourceQuery(source);
      expect(sql).toContain("LIMIT 501");
      expect(sql).toContain("DATE_SUB(?, INTERVAL 1 DAY)");
      expect(sql).toContain("DATE_ADD(?, INTERVAL 2 DAY)");
      expect(sql).toMatch(/account_owners|seller_user_id/);
      expect(params.slice(-2)).toEqual(["2026-06-01", "2026-06-30"]);
      expect((sql.match(/\?/g) || []).length).toBe(params.length);
    }
    expect(getCustomerSnapshotQueryMetrics(snapshot).filter((metric) =>
      ["interactions", "opportunity_activities", "calendar_activities"].includes(metric.source)))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ source: "interactions", resultLimit: 500, truncated: false }),
        expect.objectContaining({ source: "opportunity_activities", resultLimit: 500, truncated: false }),
        expect.objectContaining({ source: "calendar_activities", resultLimit: 500, truncated: false }),
      ]));
  });
  it("does not execute unrequested history source queries", async () => {
    await load({ historySources: ["interactions"] });
    expect(sourceQuery("interactions")).toBeDefined();
    expect(sourceQuery("opportunityActivities")).toBeUndefined();
    expect(sourceQuery("calendarActivities")).toBeUndefined();
  });
  it("reads Q07 pending sources without implicit dates, open filters or exclusions of undated rows", async () => {
    const request = resolveCustomerPendingRequest({ component: { object: "activity", reference: "" }, movement: "new_request",
      snapshot: { account: { id: 22, name: "Cuenta sintética" } }, context: { accountId: 22 },
      now: new Date("2026-10-17T12:00:00Z"), timezone: "America/Mexico_City", businessRules: {} });
    await load({ historySources: ["opportunityActivities", "calendarActivities"], historyRequest: request });
    expect(sourceQuery("interactions")).toBeUndefined();
    for (const source of ["opportunityActivities", "calendarActivities"]) {
      const [sql, params] = sourceQuery(source);
      expect(sql).toContain("LIMIT 501");
      expect(sql).toContain("status IN (?)");
      expect(sql).not.toContain("DATE_SUB");
      expect(sql).not.toContain("commercial_status_id");
      expect(sql).not.toContain("due_date IS NOT NULL");
      expect(params.at(-1)).toBe("pending");
      expect((sql.match(/\?/g) || []).length).toBe(params.length);
    }
  });
  it("retains original direct linkage instead of stamping every interaction as directly linked to the selected account", async () => {
    const implementation = query.getMockImplementation();
    query.mockImplementation(async (sql, params) => /^\s*SELECT i\.id,/.test(sql) ? [
      { id: 1, account_id: 22, primary_opportunity_id: null, title: "Directa" },
      { id: 2, account_id: null, primary_opportunity_id: 36, title: "Mediante oportunidad" },
    ] : implementation(sql, params));
    const snapshot = await load({ historySources: ["interactions"] });
    expect(sourceQuery("interactions")[0]).toContain("i.account_id, i.primary_opportunity_id");
    expect(snapshot.interactions).toEqual([
      expect.objectContaining({ id: 1, accountId: 22, directAccountId: 22, opportunityId: null }),
      expect.objectContaining({ id: 2, accountId: 22, directAccountId: null, opportunityId: 36 }),
    ]);
  });
  it("retains truncation rather than reporting the capped rows as a complete result", async () => {
    const implementation = query.getMockImplementation();
    query.mockImplementation(async (sql, params) => /^\s*SELECT i\.id,/.test(sql)
      ? Array.from({ length: 501 }, (_, index) => ({ id: index + 1, title: "Evento", created_at: new Date("2026-06-18T12:00:00Z") }))
      : implementation(sql, params));
    const snapshot = await load({ historySources: ["interactions"] });
    expect(snapshot.interactions).toHaveLength(500);
    expect(getCustomerSnapshotQueryMetrics(snapshot).find((metric) => metric.source === "interactions"))
      .toMatchObject({ truncated: true, resultCount: 500 });
  });
  it("preserves calendar contact links and date-only due dates through the real snapshot schema", async () => {
    const implementation = query.getMockImplementation();
    query.mockImplementation(async (sql, params) => {
      if (sql.includes("FROM commercial_calendar_activities cca\n")) return [{
        id: 8, account_id: 22, contact_id: 232, opportunity_id: null, status: "completed",
        due_date: "2026-06-18", scheduled_at: null, objective: "Reunión",
      }];
      if (sql.includes("FROM opportunity_workspace_actions a\n")) return [{
        id: 30, account_id: 22, opportunity_id: 36, status: "done", due_date: "2026-06-18",
        scheduled_at: new Date("2026-06-18T12:00:00Z"), title: "Seguimiento",
      }];
      return implementation(sql, params);
    });
    const snapshot = await load();
    expect(snapshot.calendarActivities[0]).toMatchObject({ contactId: 232, dueDate: "2026-06-18" });
    expect(snapshot.opportunityActivities[0]).toMatchObject({ status: "done", dueDate: "2026-06-18", scheduledAt: new Date("2026-06-18T12:00:00Z") });
    expect(sourceQuery("calendarActivities")[0]).toContain("DATE_FORMAT(cca.due_date");
    expect(sourceQuery("opportunityActivities")[0]).toContain("DATE_FORMAT(a.due_date");
  });
  it("records and reports a source failure independently of other sources", async () => {
    const implementation = query.getMockImplementation();
    query.mockImplementation(async (sql, params) => {
      if (/^\s*SELECT i\.id,/.test(sql)) throw Object.assign(new Error("Synthetic database failure"), { code: "QUERY_FAILED" });
      return implementation(sql, params);
    });
    const snapshot = await load();
    expect(getCustomerSnapshotQueryMetrics(snapshot).find((metric) => metric.source === "interactions"))
      .toMatchObject({ errorCode: "query_error", truncated: null });
    expect(getCustomerSnapshotQueryMetrics(snapshot).find((metric) => metric.source === "calendar_activities"))
      .toMatchObject({ errorCode: null, truncated: false });
  });
  it("captures a failed contact-link lookup without aborting the calendar source", async () => {
    const implementation = query.getMockImplementation();
    query.mockImplementation(async (sql, params) => {
      if (sql.includes("FROM contacts c\n")) return [{ id: 232, account_id: 22, first_name: "Alejandro", last_name: "Ruiz", activation_status_code: "activado" }];
      if (/^\s*SELECT i\.id,/.test(sql)) return [{ id: 1, title: "Llamada", created_at: new Date("2026-06-18T12:00:00Z") }];
      if (sql.includes("FROM interaction_contact_links l")) throw new Error("Synthetic contact link failure");
      return implementation(sql, params);
    });
    const snapshot = await load({ includeContactHistory: true,
      historyRequest: { ...historyRequest, memory: { object: "contact", accountId: 22, targetId: 232 } },
      historySources: ["interactions", "calendarActivities"],
    });
    expect(getCustomerSnapshotQueryMetrics(snapshot).find((metric) => metric.source === "interaction_contact_links"))
      .toMatchObject({ errorCode: "query_error" });
    expect(getCustomerSnapshotQueryMetrics(snapshot).find((metric) => metric.source === "calendar_activities"))
      .toMatchObject({ errorCode: null, truncated: false });
  });
});
