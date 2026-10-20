import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/db.js", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("../src/commercial-intelligence/schema.js", () => ({ ensureCommercialIntelligenceSchema: vi.fn() }));
vi.mock("../src/commercial-intelligence/permissions.js", () => ({ ensureCommercialIntelligencePermissions: vi.fn() }));
vi.mock("../src/settings.js", () => ({ getCommercialSettings: vi.fn().mockResolvedValue({ businessTimezone: "America/Mexico_City" }) }));
vi.mock("../src/audit.js", () => ({ logAuditEvent: vi.fn().mockResolvedValue(77) }));
import { query, withTransaction } from "../src/db.js";
import { logAuditEvent } from "../src/audit.js";
import {
  closeCustomerChatDiagnostic, listCustomerAccountChatDiagnostics, getCustomerAccountChatDiagnosticSession,
} from "../src/commercial-intelligence/service.js";
import router from "../src/routes.commercial-intelligence.js";

const user = { id: 31, permissionSet: new Set(["mi_coach.access", "mi_coach.chat_diagnostics"]) };
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = user; next(); });
app.use(router);
let connection;
beforeEach(() => {
  vi.clearAllMocks();
  user.permissionSet = new Set(["mi_coach.access", "mi_coach.chat_diagnostics"]);
  connection = { query: vi.fn(async (sql) => {
    if (sql.includes("FOR UPDATE")) return [[{ id: 2, requested_by_user_id: 7 }]];
    if (sql.startsWith("SELECT id, status")) return [[{ id: 12, status: "completed" }]];
    if (sql.startsWith("SELECT closed_through_job_id")) return [[]];
    return [{ affectedRows: 1 }];
  }) };
  withTransaction.mockImplementation((work) => work(connection));
  query.mockResolvedValue([]);
  logAuditEvent.mockResolvedValue(77);
});

describe("Diagnostic review persistence", () => {
  it("closes only review metadata and requires transactional audit", async () => {
    await closeCustomerChatDiagnostic({ user, sessionId: 2, latestJobId: 12 });
    expect(connection.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO customer_chat_diagnostic_reviews"), [2, 12, 31]);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      actor: user, entityId: 2, action: "close_chat_diagnostic", connection, required: true,
    }));
    expect(connection.query.mock.calls.some(([sql]) => /UPDATE customer_intelligence_(jobs|chat_sessions)/.test(sql))).toBe(false);
  });
  it("does not close a stale list or active session", async () => {
    await expect(closeCustomerChatDiagnostic({ user, sessionId: 2, latestJobId: 11 })).rejects.toMatchObject({ status: 409 });
    connection.query.mockImplementation(async (sql) => sql.includes("FOR UPDATE")
      ? [[{ id: 2, requested_by_user_id: 7 }]] : [[{ id: 12, status: "processing" }]]);
    await expect(closeCustomerChatDiagnostic({ user, sessionId: 2, latestJobId: 12 })).rejects.toMatchObject({ status: 409 });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
  it("propagates audit failures so the transaction rolls back", async () => {
    logAuditEvent.mockRejectedValueOnce(new Error("Audit unavailable"));
    await expect(closeCustomerChatDiagnostic({ user, sessionId: 2, latestJobId: 12 })).rejects.toThrow("Audit unavailable");
  });
  it("keeps the original closing metadata on repeated close requests", async () => {
    const originalQuery = connection.query.getMockImplementation();
    connection.query.mockImplementation((sql, params) => sql.startsWith("SELECT closed_through_job_id")
      ? [[{ closed_through_job_id: 12 }]] : originalQuery(sql, params));
    await closeCustomerChatDiagnostic({ user, sessionId: 2, latestJobId: 12 });
    expect(logAuditEvent).not.toHaveBeenCalled();
    expect(connection.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO"))).toBe(false);
  });
  it("rejects unauthorized or missing sessions", async () => {
    await expect(closeCustomerChatDiagnostic({ user: { permissionSet: new Set() }, sessionId: 2, latestJobId: 12 })).rejects.toMatchObject({ status: 403 });
    connection.query.mockResolvedValue([[]]);
    await expect(closeCustomerChatDiagnostic({ user, sessionId: 2, latestJobId: 12 })).rejects.toMatchObject({ status: 404 });
  });
  it("returns ten per page and reopens review when a later turn exists", async () => {
    query.mockResolvedValueOnce([{ total: 11 }]).mockResolvedValueOnce([
      { session_id: 2, user_id: 7, job_id: 12, closed_at: "2026-10-20", closed_through_job_id: 12, reviewer_name: "Support" },
      { session_id: 3, user_id: 7, job_id: 14, closed_at: "2026-10-20", closed_through_job_id: 13 },
    ]);
    const result = await listCustomerAccountChatDiagnostics({ page: 2, reviewStatus: "pending" });
    expect(result.pageSize).toBe(10);
    expect(query.mock.calls[1][1]).toEqual([10, 10]);
    expect(result.businessTimezone).toBe("America/Mexico_City");
    expect(result.sessions.map((s) => s.diagnosticReview.status)).toEqual(["closed", "pending"]);
    expect(query.mock.calls[0][0]).toContain("r.closed_through_job_id <> COALESCE(j.id, 0)");
  });
  it("keeps review filters independent from technical errors", async () => {
    await listCustomerAccountChatDiagnostics({ status: "errors", reviewStatus: "closed" });
    expect(query.mock.calls[0][0]).toContain("filtered_job.status = 'failed'");
    expect(query.mock.calls[0][0]).toContain("r.closed_through_job_id = COALESCE(j.id, 0)");
  });
  it("includes review state in session detail", async () => {
    query.mockResolvedValueOnce([{ id: 2, user_id: 7, history_json: "[]" }])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([{
        closed_at: "2026-10-20", closed_through_job_id: 12, latest_job_id: 13, reviewer_name: "Support",
      }]);
    const result = await getCustomerAccountChatDiagnosticSession({ sessionId: 2 });
    expect(result.session.diagnosticReview.status).toBe("pending");
  });
});

describe("Diagnostic review API", () => {
  it("requires support permission, validates input and returns errors", async () => {
    user.permissionSet.delete("mi_coach.chat_diagnostics");
    await request(app).post("/account-chat/diagnostics/sessions/2/close").send({ latestJobId: 12 }).expect(403);
    user.permissionSet.add("mi_coach.chat_diagnostics");
    await request(app).post("/account-chat/diagnostics/sessions/no/close").send({ latestJobId: 12 }).expect(400);
    await request(app).post("/account-chat/diagnostics/sessions/2/close").send({ latestJobId: 11 }).expect(409);
    await request(app).post("/account-chat/diagnostics/sessions/2/close").send({ latestJobId: 12 }).expect(200);
  });
  it("defaults list requests to ten and preserves search text", async () => {
    const response = await request(app).get("/account-chat/diagnostics/sessions?query=Intraway&reviewStatus=closed").expect(200);
    expect(response.body.pageSize).toBe(10);
    expect(query.mock.calls[0][1]).toContain("%Intraway%");
  });
});
