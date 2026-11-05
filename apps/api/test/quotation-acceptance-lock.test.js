import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db.js", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("../src/audit.js", () => ({ logAuditEvent: vi.fn() }));
vi.mock("../src/utils.js", async (importOriginal) => ({
  ...await importOriginal(), sendCommercialActionEmail: vi.fn(async () => ({ sent: true })),
}));
import { query, withTransaction } from "../src/db.js";
import { sendCommercialActionEmail } from "../src/utils.js";
import router from "../src/routes.quotations.js";
import { lockQuotationClosure } from "../src/quotation-closure-lock.js";

const originalDate = "2026-11-05T12:00:00.000Z";
let status, lockedStatus, recorded, transactionQuery;
const version = () => ({
  id: 10, quotation_id: 1, opportunity_id: 2, latest_version_id: 10,
  status_code: status, currency_code: "USD", exchange_rate: 1, updated_at: originalDate,
});
function app(permissions = ["aceptar_pedido.procesamiento.update", "cotizaciones.operacion"]) {
  const instance = express();
  instance.use(express.json(), (req, _res, next) => {
    req.user = { id: 1, permissionSet: new Set(permissions) };
    next();
  });
  instance.use("/api", router);
  instance.use((error, _req, res, _next) => {
    res.status(error.status || 500).json({ message: error.message, code: error.code });
  });
  return instance;
}
beforeEach(() => {
  vi.clearAllMocks();
  status = "aceptada";
  lockedStatus = null;
  recorded = false;
  query.mockImplementation(async (sql) => {
    if (sql.includes("WHERE qv.id = ?")) return [version()];
    if (sql.includes("SELECT q.id, q.opportunity_id")) return [{ id: 1, opportunity_id: 2, latest_version_id: 10 }];
    if (sql.includes("seller_user_email") && sql.includes("WHERE q.id = ?")) return [{
      id: 1, latest_version_id: 10, seller_user_email: "seller@example.test", currency_code: "USD",
    }];
    if (sql.includes("FROM currencies")) return [{ code: "USD" }];
    if (sql.includes("FROM quotation_statuses") && sql.includes("code")) return [{ id: 3, code: "aceptada", name: "Aceptada" }];
    if (sql.includes("SELECT d.id AS document_id")) return [{ document_id: 20 }];
    if (sql.includes("information_schema")) return [{ count: 1 }];
    return [];
  });
  transactionQuery = vi.fn(async (sql) => {
    if (sql.includes("qs.code AS status_code") && sql.includes("FOR UPDATE")) {
      return [[{ ...version(), status_code: lockedStatus || status }]];
    }
    if (sql.includes("SELECT id, status_code") && sql.includes("quotation_processing_stages")) {
      return [[{ id: 9, status_code: recorded ? "completed" : "not_started",
        notes: "Nota original", owner_user_id: 7, stage_data_json: "{}" }]];
    }
    if (sql.includes("SELECT stage_data_json, completed_at")) return [[{ stage_data_json: JSON.stringify({ acceptedAt: originalDate }) }]];
    if (sql.includes("SELECT id, stage_data_json")) return [[{ id: 9, stage_data_json: JSON.stringify({ other: "preserved" }) }]];
    if (sql.includes("SELECT accepted_at FROM quotation_won_documents")) return [[{ accepted_at: originalDate }]];
    if (sql.includes("SELECT d.id")) return [[{ id: 20 }]];
    if (sql.includes("SELECT qwd.id")) return [[{ id: 30 }]];
    return [[]];
  });
  withTransaction.mockImplementation(async (work) => work({ query: transactionQuery }));
});

const closureRequests = [
  ["post", "/api/quotation-versions/10/won-documents/purchase-orders", { source: "quotation", documentId: 20 }],
  ["post", "/api/quotation-versions/10/won-documents/provider-quotes", { source: "quotation", documentId: 20 }],
  ["delete", "/api/quotation-versions/10/won-documents/quotation/20", {}],
  ["delete", "/api/quotation-versions/10/won-documents/provider-quotes/quotation/20", {}],
  ["patch", "/api/quotation-versions/10/won-documents/quotation/20/value", { amount: 10, currencyCode: "USD" }],
  ["post", "/api/quotation-versions/10/won-documents", { selections: [{ role: "purchase_order", source: "quotation", documentId: 20 }] }],
  ["post", "/api/quotations/1/seller-notification", { note: "Revisar pedido" }],
  ["patch", "/api/quotations/1/processing/stages/quotation_accepted", { status: "completed" }],
];
describe("Accepted quotation closure lock", () => {
  it.each(closureRequests)("rejects %s %s after acceptance without mutations or email", async (method, path, body) => {
    const response = await request(app())[method](path).send(body);
    expect(response.status, JSON.stringify(response.body)).toBe(409);
    expect(response.body.message).toMatch(/aceptada/i);
    expect(transactionQuery.mock.calls.some(([sql]) => /^\s*(INSERT|UPDATE|DELETE)/.test(sql))).toBe(false);
    expect(sendCommercialActionEmail).not.toHaveBeenCalled();
  });
  it("rechecks the status under lock rather than trusting a previously read won version", async () => {
    status = "ganada";
    lockedStatus = "aceptada";
    const response = await request(app()).post("/api/quotation-versions/10/won-documents/provider-quotes")
      .send({ source: "quotation", documentId: 20 });
    expect(response.status).toBe(409);
    expect(transactionQuery.mock.calls).toHaveLength(1);
    expect(transactionQuery.mock.calls[0][0]).toContain("FOR UPDATE");
  });
  it("serializes acceptance with closure changes and persists its original date", async () => {
    status = "ganada";
    const response = await request(app()).post("/api/quotation-versions/10/transition")
      .send({ actionCode: "aceptar" });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.statusCode).toBe("aceptada");
    const calls = transactionQuery.mock.calls;
    expect(calls[0][0]).toContain("FOR UPDATE");
    const snapshot = calls.find(([sql]) => sql.includes("INSERT INTO quotation_processing_stages"));
    expect(JSON.parse(snapshot[1][3]).acceptedAt).toBe(originalDate);
    const writes = calls.filter(([sql]) => /^\s*UPDATE/.test(sql));
    expect(writes).toHaveLength(2);
    expect(writes[0][0]).toContain("UPDATE quotation_versions");
    expect(writes[1][0]).toContain("UPDATE quotations");
  });
  it("does not accept an already accepted quotation a second time", async () => {
    const response = await request(app()).post("/api/quotation-versions/10/transition")
      .send({ actionCode: "aceptar" });
    expect(response.status, JSON.stringify(response.body)).toBe(409);
    expect(transactionQuery.mock.calls.some(([sql]) => /^\s*(INSERT|UPDATE)/.test(sql))).toBe(false);
  });
  it("allows document changes and email before acceptance", async () => {
    status = "ganada";
    expect((await request(app()).post("/api/quotation-versions/10/won-documents/provider-quotes")
      .send({ source: "quotation", documentId: 20 })).status).toBe(200);
    expect((await request(app()).post("/api/quotations/1/seller-notification")
      .send({ note: "Revisar pedido" })).status).toBe(200);
    expect(sendCommercialActionEmail).toHaveBeenCalledOnce();
    expect(withTransaction).toHaveBeenLastCalledWith(expect.any(Function), { maxRetries: 1 });
  });
  it("completes only the pending operational record preserving original date and metadata", async () => {
    const response = await request(app()).post("/api/quotations/1/processing/complete-acceptance")
      .send({ acceptedAt: "2099-01-01" });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const writes = transactionQuery.mock.calls.filter(([sql]) => /^\s*(INSERT|UPDATE|DELETE)/.test(sql));
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toContain("INSERT INTO quotation_processing_stages");
    const params = writes[0][1];
    expect(params[4]).toBe("completed");
    expect(params[5]).toBe(7);
    expect(params[7]).toBe(originalDate);
    expect(params[9]).toBe("Nota original");
    expect(JSON.parse(params[10])).toEqual({ other: "preserved", acceptedAt: originalDate });
    expect(sendCommercialActionEmail).not.toHaveBeenCalled();
  });
  it("does not rewrite a completed record", async () => {
    recorded = true;
    expect((await request(app()).post("/api/quotations/1/processing/complete-acceptance")).status).toBe(200);
    expect(transactionQuery.mock.calls.some(([sql]) => sql.includes("INSERT INTO"))).toBe(false);
  });
  it("does not complete records before acceptance or without update permission", async () => {
    status = "ganada";
    expect((await request(app()).post("/api/quotations/1/processing/complete-acceptance")).status).toBe(409);
    expect((await request(app(["aceptar_pedido.procesamiento.read"])).post("/api/quotations/1/processing/complete-acceptance")).status).toBe(403);
  });
  it("rejects a stale latest version even with an accepted override", async () => {
    const conn = { query: vi.fn(async () => [[{ ...version(), latest_version_id: 11 }]]) };
    await expect(lockQuotationClosure(conn, 10, { allowAccepted: true })).rejects.toMatchObject({ status: 409 });
  });
  it("keeps downloads and other operational stages available after acceptance", async () => {
    expect((await request(app()).get("/api/quotation-versions/10/won-documents")).status).toBe(200);
    expect((await request(app()).patch("/api/quotations/1/processing/stages/kickoff_internal")
      .send({ status: "in_progress" })).status).toBe(200);
  });
});
