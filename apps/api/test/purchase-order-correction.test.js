import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db.js", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("../src/audit.js", () => ({ logAuditEvent: vi.fn() }));
import { query, withTransaction } from "../src/db.js";
import { logAuditEvent } from "../src/audit.js";
import router from "../src/routes.quotations.js";
import { ensureCorePermissions } from "../src/permissions.js";
import {
  PURCHASE_ORDER_CORRECTION_PERMISSION, purchaseOrderCorrectionOptions, lockPurchaseOrderStage,
} from "../src/purchase-order-correction.js";

const reason = "Correccion solicitada por operaciones";
const header = "X-Purchase-Order-Correction-Reason";
const base = "/api/quotations/1/processing";
const completedAt = new Date("2026-11-06T12:00:00.000Z");
let stage;
let connection;

function app(permissions = ["aceptar_pedido.procesamiento.update", PURCHASE_ORDER_CORRECTION_PERMISSION]) {
  const instance = express();
  instance.use(express.json(), (req, _res, next) => {
    req.user = { id: 1, permissionSet: new Set(permissions) };
    next();
  });
  instance.use("/api", router);
  instance.use((error, _req, res, _next) => {
    res.status(error.status || 500).json({ message: error.message });
  });
  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
  stage = {
    id: 1, status_code: "completed", completed_at: completedAt,
    stage_data_json: JSON.stringify({ purchaseOrderDeliveryTime: "10 dias" }),
  };
  query.mockImplementation(async (sql) => {
    if (sql.includes("SELECT q.id, q.opportunity_id")) {
      return [{ id: 1, opportunity_id: 1, latest_version_id: 10 }];
    }
    if (sql.includes("WHERE qv.id = ?")) {
      return [{ id: 10, quotation_id: 1, latest_version_id: 10, status_code: "aceptada" }];
    }
    return [];
  });
  connection = { query: vi.fn(async (sql) => {
    if (sql.includes("FROM quotation_processing_stages")) return [[stage]];
    if (sql.includes("FROM quotation_processing_purchase_order_items")) return [[{ id: 2, quantity: 1 }]];
    if (sql.includes("FROM quotation_processing_purchase_orders") && sql.includes("COUNT")) return [[{ count: 1 }]];
    if (sql.includes("FROM quotation_processing_purchase_orders")) return [[{ id: 2, order_number: "OC-2" }]];
    return [{ insertId: 2 }];
  }) };
  withTransaction.mockImplementation((fn) => fn(connection));
});

describe("Purchase order completion corrections", () => {
  it("registers the permission in acceptance of orders without granting it to ordinary roles", async () => {
    await ensureCorePermissions();
    const insert = connection.query.mock.calls.find(([sql, params]) =>
      sql.includes("INSERT INTO permissions") && params[0] === PURCHASE_ORDER_CORRECTION_PERMISSION);
    expect(insert[1][1]).toBe("aceptar_pedido");
    expect(connection.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO role_permissions"))).toBe(false);
  });

  it("rejects malformed, short and unauthorized correction reasons", () => {
    const req = (value, permissions = [PURCHASE_ORDER_CORRECTION_PERMISSION]) => ({
      get: () => value, user: { permissionSet: new Set(permissions) },
    });
    expect(() => purchaseOrderCorrectionOptions(req("%broken"))).toThrow("invalido");
    expect(() => purchaseOrderCorrectionOptions(req("short"))).toThrow("10 y 1000");
    expect(() => purchaseOrderCorrectionOptions(req(" ".repeat(20)))).toThrow("10 y 1000");
    expect(() => purchaseOrderCorrectionOptions(req("a".repeat(1001)))).toThrow("10 y 1000");
    expect(() => purchaseOrderCorrectionOptions(req(reason, []))).toThrow("No autorizado");
  });

  it("locks the quotation before checking completed state and requires an explicit correction", async () => {
    await expect(lockPurchaseOrderStage(connection, 1)).rejects.toMatchObject({ status: 409 });
    expect(connection.query.mock.calls[0][0]).toContain("quotations WHERE id = ? FOR UPDATE");
    expect(connection.query.mock.calls[1][0]).toContain("FOR UPDATE");
    stage.status_code = "in_progress";
    await expect(lockPurchaseOrderStage(connection, 1, { reason })).rejects.toMatchObject({ status: 409 });
  });

  it.each([
    ["patch", "/stages/provider_purchase_order", { status: "in_progress", stageData: {} }],
    ["post", "/provider-purchase-orders", { orders: [{
      providerId: 1, currencyCode: "USD",
      lines: [{ code: "ITEM", description: "Item", quantity: 1, unitCost: 10, selectionDate: "2026-11-06" }],
    }] }],
    ["delete", "/provider-purchase-orders/2", undefined],
  ])("blocks %s %s after completion without a correction reason", async (method, path, body) => {
    const call = request(app())[method](`${base}${path}`);
    const response = await (body ? call.send(body) : call);
    expect(response.status).toBe(409);
    expect(connection.query.mock.calls.some(([sql]) => /^\s*(INSERT|DELETE|UPDATE)/.test(sql))).toBe(false);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("requires both update permission and the dedicated correction permission", async () => {
    for (const permissions of [
      ["aceptar_pedido.procesamiento.update"],
      ["aceptar_pedido.procesamiento.read", PURCHASE_ORDER_CORRECTION_PERMISSION],
    ]) {
      const response = await request(app(permissions))
        .patch(`${base}/stages/provider_purchase_order`).set(header, encodeURIComponent(reason))
        .send({ status: "completed", stageData: {} });
      expect(response.status).toBe(403);
    }
  });

  it.each(["short", "%broken", "a".repeat(1001)])("rejects an invalid reason in an API request", async (value) => {
    const response = await request(app())
      .patch(`${base}/stages/provider_purchase_order`).set(header, value)
      .send({ status: "completed", stageData: {} });
    expect(response.status).toBe(400);
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("preserves completion status and original date and audits corrected data", async () => {
    const response = await request(app())
      .patch(`${base}/stages/provider_purchase_order`).set(header, encodeURIComponent(reason))
      .send({ status: "in_progress", completedAt: "2026-12-01T00:00:00.000Z",
        stageData: { purchaseOrderDeliveryTime: "20 dias" } });
    expect(response.status).toBe(200);
    const write = connection.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO quotation_processing_stages"));
    expect(write[1][4]).toBe("completed");
    expect(write[1][7]).toEqual(completedAt);
    expect(JSON.parse(write[1][10]).purchaseOrderDeliveryTime).toBe("20 dias");
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      before: stage,
      after: expect.objectContaining({ reason, stageData: { purchaseOrderDeliveryTime: "20 dias" } }),
    }));
  });

  it("allows normal completion before the stage is locked", async () => {
    stage.status_code = "in_progress";
    const response = await request(app(["aceptar_pedido.procesamiento.update"]))
      .patch(`${base}/stages/provider_purchase_order`)
      .send({ status: "completed", completedAt: completedAt.toISOString(), stageData: {} });
    expect(response.status).toBe(200);
  });

  it("allows authorized order creation and deletion with an audited reason", async () => {
    const created = await request(app()).post(`${base}/provider-purchase-orders`)
      .set(header, encodeURIComponent(reason)).send({ orders: [{
        providerId: 1, currencyCode: "USD",
        lines: [{ code: "ITEM", description: "Item", quantity: 1, unitCost: 10, selectionDate: "2026-11-06" }],
      }] });
    expect(created.status).toBe(200);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      after: expect.objectContaining({ reason, orders: expect.any(Array) }),
    }));
    const removed = await request(app()).delete(`${base}/provider-purchase-orders/2`)
      .set(header, encodeURIComponent(reason));
    expect(removed.status).toBe(200);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      before: expect.objectContaining({ id: 2, lines: [{ id: 2, quantity: 1 }] }),
      after: expect.objectContaining({ reason, orderId: 2 }),
    }));
  });
});
