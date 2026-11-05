import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db.js", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}));
vi.mock("../src/audit.js", () => ({ logAuditEvent: vi.fn() }));
vi.mock("../src/quotation-closure-lock.js", () => ({ lockQuotationClosure: vi.fn() }));
import { query, withTransaction } from "../src/db.js";
import { logAuditEvent } from "../src/audit.js";
import router from "../src/routes.quotations.js";
import { purchaseOrderValueSchema } from "../src/purchase-order-value.js";
import { lockQuotationClosure } from "../src/quotation-closure-lock.js";

const endpoint = "/api/quotation-versions/10/won-documents/quotation/20/value";
const removalEndpoint = "/api/quotation-versions/10/won-documents/quotation/20";
const providerRemovalEndpoint = "/api/quotation-versions/10/won-documents/provider-quotes/quotation/20";
function app(permissions = ["aceptar_pedido.procesamiento.update"]) {
  const instance = express();
  instance.use(express.json());
  instance.use((req, _res, next) => {
    req.user = { id: 1, permissionSet: new Set(permissions) };
    next();
  });
  instance.use("/api", router);
  return instance;
}

describe("Purchase order value", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lockQuotationClosure.mockResolvedValue({ id: 10, status_code: "ganada", latest_version_id: 10 });
    query.mockImplementation(async (sql) => {
      if (sql.includes("WHERE qv.id = ?")) return [{ id: 10, latest_version_id: 10, status_code: "aceptada" }];
      if (sql.includes("FROM currencies")) return [{ code: "MXN" }];
      if (sql.includes("information_schema")) return [{ count: 1 }];
      return [];
    });
    withTransaction.mockImplementation(async (work) => work({
      query: async (sql) => sql.includes("SELECT qwd.id")
        ? [[{ id: 30, purchase_order_amount: null, purchase_order_currency: null }]]
        : [{ affectedRows: 1 }],
    }));
  });
  it.each([-1, 1.234, NaN, Infinity, 10000000000000])("rejects invalid amount %s", (amount) => {
    expect(purchaseOrderValueSchema.safeParse({ amount, currencyCode: "MXN" }).success).toBe(false);
  });
  it("adds missing value columns to an existing closing-document table before reading orders", async () => {
    const defaultQuery = query.getMockImplementation();
    query.mockImplementation(async (sql, params) => {
      if (sql.includes("information_schema.COLUMNS") && sql.includes("quotation_won_documents")) return [];
      return defaultQuery(sql, params);
    });
    const response = await request(app()).get("/api/quotation-versions/10/won-documents");
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const statements = query.mock.calls.map(([sql]) => sql);
    const amountMigration = statements.findIndex((sql) =>
      sql.includes("ALTER TABLE quotation_won_documents ADD COLUMN purchase_order_amount"));
    const currencyMigration = statements.findIndex((sql) =>
      sql.includes("ALTER TABLE quotation_won_documents ADD COLUMN purchase_order_currency"));
    const selectionRead = statements.findIndex((sql) => sql.includes("SELECT qwd.document_id"));
    expect(amountMigration).toBeGreaterThan(-1);
    expect(currencyMigration).toBeGreaterThan(amountMigration);
    expect(selectionRead).toBeGreaterThan(currencyMigration);
  });
  it("saves amount and selected currency and records audit", async () => {
    const response = await request(app()).patch(endpoint).send({ amount: 1250.25, currencyCode: "mxn" });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ amount: 1250.25, currencyCode: "MXN" });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      after: { documentId: 20, source: "quotation", amount: 1250.25, currencyCode: "MXN" },
    }));
  });
  it("does not grant update access to read-only users", async () => {
    const response = await request(app(["aceptar_pedido.procesamiento.read"])).patch(endpoint)
      .send({ amount: 100, currencyCode: "MXN" });
    expect(response.status).toBe(403);
    expect(withTransaction).not.toHaveBeenCalled();
  });
  it("rejects invalid currencies, missing amounts and nonexistent documents", async () => {
    expect((await request(app()).patch(endpoint).send({ currencyCode: "MXN" })).status).toBe(400);
    withTransaction.mockImplementation(async (work) => work({ query: async () => [[]] }));
    expect((await request(app()).patch(endpoint).send({ amount: 100, currencyCode: "MXN" })).status).toBe(404);
  });
  it("rejects unavailable currencies and inaccessible versions", async () => {
    query.mockResolvedValue([]);
    expect((await request(app()).patch(endpoint).send({ amount: 100, currencyCode: "MXN" })).status).toBe(404);
    query.mockImplementation(async (sql) => sql.includes("WHERE qv.id = ?")
      ? [{ id: 10, latest_version_id: 10, status_code: "aceptada" }] : []);
    expect((await request(app()).patch(endpoint).send({ amount: 100, currencyCode: "ZZZ" })).status).toBe(400);
    expect(withTransaction).not.toHaveBeenCalled();
  });
  it("preserves an existing order value when the same closing document is saved again", async () => {
    query.mockImplementation(async (sql) => {
      if (sql.includes("WHERE qv.id = ?")) return [{
        id: 10, quotation_id: 1, opportunity_id: 2, latest_version_id: 10, status_code: "aceptada",
      }];
      if (sql.includes("SELECT d.id AS document_id")) return [{ document_id: 20 }];
      if (sql.includes("information_schema")) return [{ count: 1 }];
      return [];
    });
    const transactionQuery = vi.fn(async (sql) => sql.includes("SELECT document_id, document_source")
      ? [[{ document_id: 20, document_source: "quotation", purchase_order_amount: "1250.25", purchase_order_currency: "MXN" }]]
      : [{ affectedRows: 1 }]);
    withTransaction.mockImplementation(async (work) => work({ query: transactionQuery }));
    const response = await request(app()).post("/api/quotation-versions/10/won-documents")
      .send({ selections: [{ role: "purchase_order", source: "quotation", documentId: 20 }] });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const insert = transactionQuery.mock.calls.find(([sql]) => sql.includes("INSERT INTO quotation_won_documents"));
    expect(insert[1].slice(-2)).toEqual(["1250.25", "MXN"]);
  });
  it("removes only the selected order row and its value, keeping original files and provider selections", async () => {
    const transactionQuery = vi.fn(async (sql) => sql.includes("SELECT qwd.id")
      ? [[{ id: 30, purchase_order_amount: "1500.00", purchase_order_currency: "MXN" }]]
      : [{ affectedRows: 1 }]);
    withTransaction.mockImplementation(async (work) => work({ query: transactionQuery }));
    const response = await request(app()).delete(removalEndpoint);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(transactionQuery).toHaveBeenCalledTimes(2);
    expect(transactionQuery.mock.calls[0][0]).toContain("qwd.document_role = 'purchase_order' FOR UPDATE");
    expect(transactionQuery.mock.calls[0][1]).toEqual([10, 20, "quotation"]);
    expect(transactionQuery.mock.calls[1]).toEqual(["DELETE FROM quotation_won_documents WHERE id = ?", [30]]);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "purchase_order_removed",
      before: { documentId: 20, source: "quotation", amount: "1500.00", currencyCode: "MXN" },
      after: { purchaseOrder: null },
    }));
  });
  it("rejects removal for read-only users", async () => {
    expect((await request(app(["aceptar_pedido.procesamiento.read"])).delete(removalEndpoint)).status).toBe(403);
    expect(withTransaction).not.toHaveBeenCalled();
  });
  it.each(["quotation", "opportunity"])("removes only the selected %s provider association and audits without deleting files", async (source) => {
    const transactionQuery = vi.fn(async (sql) => sql.includes("SELECT qwd.id")
      ? [[{ id: 30, purchase_order_amount: null, purchase_order_currency: null }]]
      : [{ affectedRows: 1 }]);
    withTransaction.mockImplementation(async (work) => work({ query: transactionQuery }));
    const response = await request(app()).delete(providerRemovalEndpoint.replace("/quotation/20", `/${source}/20`));
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(transactionQuery).toHaveBeenCalledTimes(2);
    expect(transactionQuery.mock.calls[0][0]).toContain("qwd.document_role = 'provider_quote' FOR UPDATE");
    expect(transactionQuery.mock.calls[0][1]).toEqual([10, 20, source]);
    expect(transactionQuery.mock.calls[1]).toEqual(["DELETE FROM quotation_won_documents WHERE id = ?", [30]]);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "provider_quote_removed", after: { providerQuote: null },
    }));
  });
  it("enforces provider removal permissions, references and current closed version", async () => {
    expect((await request(app(["aceptar_pedido.procesamiento.read"])).delete(providerRemovalEndpoint)).status).toBe(403);
    expect((await request(app()).delete(providerRemovalEndpoint.replace("/quotation/20", "/invalid/20"))).status).toBe(400);
    expect((await request(app()).delete(providerRemovalEndpoint.replace("/quotation/20", "/quotation/0"))).status).toBe(400);
    query.mockResolvedValue([]);
    expect((await request(app()).delete(providerRemovalEndpoint)).status).toBe(404);
    for (const version of [
      { id: 10, latest_version_id: 11, status_code: "aceptada" },
      { id: 10, latest_version_id: 10, status_code: "borrador" },
    ]) {
      query.mockResolvedValue([version]);
      expect((await request(app()).delete(providerRemovalEndpoint)).status).toBe(400);
    }
    expect(withTransaction).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
  it("does not delete or audit when the provider association is missing", async () => {
    const transactionQuery = vi.fn(async () => [[]]);
    withTransaction.mockImplementation(async (work) => work({ query: transactionQuery }));
    expect((await request(app()).delete(providerRemovalEndpoint)).status).toBe(404);
    expect(transactionQuery).toHaveBeenCalledTimes(1);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
  it("rejects invalid removal references", async () => {
    expect((await request(app()).delete(removalEndpoint.replace("/quotation/20", "/invalid/20"))).status).toBe(400);
    expect((await request(app()).delete(removalEndpoint.replace("/quotation/20", "/quotation/0"))).status).toBe(400);
    expect(withTransaction).not.toHaveBeenCalled();
  });
  it("does not remove an inaccessible, historical or nonclosed version", async () => {
    query.mockResolvedValue([]);
    expect((await request(app()).delete(removalEndpoint)).status).toBe(404);
    for (const version of [
      { id: 10, latest_version_id: 11, status_code: "aceptada" },
      { id: 10, latest_version_id: 10, status_code: "borrador" },
    ]) {
      query.mockResolvedValue([version]);
      expect((await request(app()).delete(removalEndpoint)).status).toBe(400);
    }
    expect(withTransaction).not.toHaveBeenCalled();
  });
  it("reports missing selected orders without deleting or recording success", async () => {
    const transactionQuery = vi.fn(async () => [[]]);
    withTransaction.mockImplementation(async (work) => work({ query: transactionQuery }));
    expect((await request(app()).delete(removalEndpoint)).status).toBe(404);
    expect(transactionQuery).toHaveBeenCalledTimes(1);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
  it("returns all orders and a stable primary order for existing single-order clients", async () => {
    query.mockImplementation(async (sql) => {
      if (sql.includes("WHERE qv.id = ?")) return [{ id: 10, quotation_id: 1, opportunity_id: 2 }];
      if (sql.includes("information_schema")) return [{ count: 1 }];
      if (sql.includes("SELECT qwd.document_id")) return [
        { document_id: 20, document_source: "quotation", document_role: "purchase_order", purchase_order_amount: "100", purchase_order_currency: "USD" },
        { document_id: 21, document_source: "opportunity", document_role: "purchase_order", purchase_order_amount: "250", purchase_order_currency: "MXN" },
      ];
      return [];
    });
    const response = await request(app()).get("/api/quotation-versions/10/won-documents");
    expect(response.status).toBe(200);
    expect(response.body.savedSelections.purchaseOrders).toMatchObject([
      { documentId: 20, amount: 100, currencyCode: "USD" },
      { documentId: 21, amount: 250, currencyCode: "MXN" },
    ]);
    expect(response.body.savedSelections.purchaseOrder.documentId).toBe(20);
  });
  it.each([
    ["purchase-orders", "purchase_order", "quotation"],
    ["purchase-orders", "purchase_order", "opportunity"],
    ["provider-quotes", "provider_quote", "quotation"],
  ])("appends %s from %s / %s without replacing existing documents or values", async (path, role, source) => {
    query.mockImplementation(async (sql) => {
      if (sql.includes("WHERE qv.id = ?")) return [{
        id: 10, quotation_id: 1, opportunity_id: 2, latest_version_id: 10, status_code: "aceptada",
      }];
      if (sql.includes("information_schema")) return [{ count: 1 }];
      return [];
    });
    const transactionQuery = vi.fn(async (sql) => {
      if (sql.includes("SELECT d.id")) return [[{ id: 21 }]];
      if (sql.includes("SELECT accepted_at")) return [[{ accepted_at: "2026-11-03", accepted_by_user_id: 7 }]];
      return [[]];
    });
    withTransaction.mockImplementation(async (work) => work({ query: transactionQuery }));
    const response = await request(app()).post(`/api/quotation-versions/10/won-documents/${path}`)
      .send({ source, documentId: 21 });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const writes = transactionQuery.mock.calls.filter(([sql]) => /INSERT|UPDATE|DELETE/.test(sql) && !sql.includes("SELECT"));
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toContain("INSERT INTO quotation_won_documents");
    expect(writes[0][0]).toContain(`'${role}'`);
    expect(writes[0][1]).toEqual([1, 10, 2, 21, source, 1, "2026-11-03", 7]);
    expect(writes[0][0]).not.toContain("purchase_order_amount");
    expect(transactionQuery.mock.calls[0][1]).toEqual([21, source === "quotation" ? 1 : 2]);
    expect(transactionQuery.mock.calls[1][0]).toContain(`document_role = '${role}' FOR UPDATE`);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: role === "provider_quote" ? "provider_quote_added" : "purchase_order_added",
      after: { documentId: 21, source },
    }));
  });
  it.each(["purchase-orders", "provider-quotes"])("does not append missing files or duplicates for %s", async (path) => {
    const post = () => request(app()).post(`/api/quotation-versions/10/won-documents/${path}`)
      .send({ source: "quotation", documentId: 20 });
    const transactionQuery = vi.fn(async () => [[]]);
    withTransaction.mockImplementation(async (work) => work({ query: transactionQuery }));
    expect((await post()).status).toBe(404);
    transactionQuery.mockImplementation(async (sql) =>
      sql.includes("SELECT d.id") || sql.includes("SELECT id FROM quotation_won_documents") ? [[{ id: 20 }]] : [[]]);
    expect((await post()).status).toBe(409);
    expect(transactionQuery.mock.calls.some(([sql]) => sql.includes("INSERT INTO"))).toBe(false);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
  it.each(["purchase-orders", "provider-quotes"])("enforces append permissions, references and current closed version for %s", async (type) => {
    const path = `/api/quotation-versions/10/won-documents/${type}`;
    const body = { source: "quotation", documentId: 20 };
    expect((await request(app(["aceptar_pedido.procesamiento.read"])).post(path).send(body)).status).toBe(403);
    expect((await request(app()).post(path).send({ ...body, source: "invalid" })).status).toBe(400);
    expect((await request(app()).post(path).send({ ...body, documentId: 0 })).status).toBe(400);
    query.mockResolvedValue([]);
    expect((await request(app()).post(path).send(body)).status).toBe(404);
    for (const version of [
      { id: 10, latest_version_id: 11, status_code: "aceptada" },
      { id: 10, latest_version_id: 10, status_code: "borrador" },
    ]) {
      query.mockResolvedValue([version]);
      expect((await request(app()).post(path).send(body)).status).toBe(400);
    }
    expect(withTransaction).not.toHaveBeenCalled();
  });
  it("only allows quotation sources for provider quotes", async () => {
    const response = await request(app()).post("/api/quotation-versions/10/won-documents/provider-quotes")
      .send({ source: "opportunity", documentId: 20 });
    expect(response.status).toBe(400);
    expect(withTransaction).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
  it("registers provider documents from any version of the same won quotation and returns all selections", async () => {
    query.mockImplementation(async (sql) => {
      if (sql.includes("WHERE qv.id = ?")) return [{
        id: 10, quotation_id: 1, opportunity_id: 2, latest_version_id: 10, status_code: "ganada",
      }];
      if (sql.includes("SELECT qwd.document_id")) return [
        { document_id: 20, document_source: "quotation", document_role: "purchase_order", purchase_order_amount: "250", purchase_order_currency: "MXN" },
        { document_id: 21, document_source: "quotation", document_role: "provider_quote", original_file_name: "proveedor.pdf" },
      ];
      return [];
    });
    const transactionQuery = vi.fn(async (sql) => sql.includes("SELECT d.id") ? [[{ id: 21 }]] : [[]]);
    withTransaction.mockImplementation(async (work) => work({ query: transactionQuery }));
    const response = await request(app()).post("/api/quotation-versions/10/won-documents/provider-quotes")
      .send({ source: "quotation", documentId: 21 });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const fileRead = transactionQuery.mock.calls[0];
    expect(fileRead[0]).toContain("qv.quotation_id = ?");
    expect(fileRead[0]).toContain("COALESCE(d.is_deleted, 0) = 0");
    expect(fileRead[1]).toEqual([21, 1]);
    expect(response.body.savedSelections.purchaseOrders).toMatchObject([
      { documentId: 20, amount: 250, currencyCode: "MXN" },
    ]);
    expect(response.body.savedSelections.providerQuotes).toMatchObject([
      { documentId: 21, originalFileName: "proveedor.pdf" },
    ]);
  });
  it("preserves additional processing orders and their values when the single-order editor saves", async () => {
    query.mockImplementation(async (sql) => {
      if (sql.includes("WHERE qv.id = ?")) return [{
        id: 10, quotation_id: 1, opportunity_id: 2, latest_version_id: 10, status_code: "aceptada",
      }];
      if (sql.includes("SELECT d.id AS document_id")) return [{ document_id: 20 }];
      if (sql.includes("information_schema")) return [{ count: 1 }];
      return [];
    });
    const transactionQuery = vi.fn(async (sql) => sql.includes("SELECT document_id, document_source") ? [[
      { document_id: 20, document_source: "quotation", purchase_order_amount: "100", purchase_order_currency: "USD" },
      { document_id: 21, document_source: "opportunity", purchase_order_amount: "250", purchase_order_currency: "MXN" },
    ]] : [{ affectedRows: 1 }]);
    withTransaction.mockImplementation(async (work) => work({ query: transactionQuery }));
    const response = await request(app()).post("/api/quotation-versions/10/won-documents")
      .send({ selections: [{ role: "purchase_order", source: "quotation", documentId: 20 }] });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const inserts = transactionQuery.mock.calls.filter(([sql]) => sql.includes("INSERT INTO quotation_won_documents"));
    expect(inserts).toHaveLength(2);
    expect(inserts[0][1].slice(-2)).toEqual(["100", "USD"]);
    expect(inserts[1][1].slice(3, 6)).toEqual([21, "opportunity", "purchase_order"]);
    expect(inserts[1][1].slice(-2)).toEqual(["250", "MXN"]);
  });
  it("keeps the existing quotation selection endpoint limited to one submitted order", async () => {
    const response = await request(app()).post("/api/quotation-versions/10/won-documents")
      .send({ selections: [
        { role: "purchase_order", source: "quotation", documentId: 20 },
        { role: "purchase_order", source: "opportunity", documentId: 21 },
      ] });
    expect(response.status, JSON.stringify(response.body)).toBe(400);
    expect(withTransaction).not.toHaveBeenCalled();
  });
});
