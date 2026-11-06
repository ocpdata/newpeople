import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db.js", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("../src/audit.js", () => ({ logAuditEvent: vi.fn() }));
import { query, withTransaction } from "../src/db.js";
import { logAuditEvent } from "../src/audit.js";
import router from "../src/routes.quotations.js";

let connection, referenced;
const app = express();
app.use(express.json(), (req, _res, next) => {
  req.user = { id: 1, permissionSet: new Set(["aceptar_pedido.procesamiento.update"]) };
  next();
});
app.use("/api", router);
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: error.message }));
beforeEach(() => {
  vi.clearAllMocks();
  referenced = true;
  query.mockImplementation(async (sql) => sql.includes("SELECT q.id, q.opportunity_id")
    ? [{ id: 1, opportunity_id: 1, latest_version_id: 1 }] : []);
  connection = { query: vi.fn(async (sql) => {
    if (sql.includes("FROM quotation_processing_stages")) return [[{ status_code: "in_progress", stage_data_json: "{}" }]];
    if (sql.includes("FROM provider_invoice_items")) return [referenced ? [{ id: 1 }] : []];
    if (sql.includes("FROM quotation_processing_purchase_orders")) return [[{ id: 2, order_number: "OC-2" }]];
    if (sql.includes("FROM quotation_processing_purchase_order_items")) return [[{ id: 10 }]];
    return [[]];
  }) };
  withTransaction.mockImplementation((work) => work(connection));
});

describe("supplier document purchase-order protection", () => {
  it("locks supplier reservations before the order and rejects deletion of referenced orders", async () => {
    const response = await request(app).delete("/api/quotations/1/processing/provider-purchase-orders/2");
    expect(response.status, response.text).toBe(409);
    expect(response.body.message).toMatch(/facturas o prefacturas/);
    expect(connection.query.mock.calls[0][0]).toContain("provider_invoice_lock");
    expect(connection.query.mock.calls.some(([sql]) => sql.includes("DELETE FROM quotation_processing_purchase_orders"))).toBe(false);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("preserves deletion of unreferenced orders", async () => {
    referenced = false;
    const response = await request(app).delete("/api/quotations/1/processing/provider-purchase-orders/2");
    expect(response.status, response.text).toBe(200);
    expect(connection.query.mock.calls.some(([sql]) => sql.includes("DELETE FROM quotation_processing_purchase_orders"))).toBe(true);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "quotation_processing_purchase_order_deleted" }));
  });
});
