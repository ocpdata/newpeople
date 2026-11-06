import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db.js", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("../src/audit.js", () => ({ logAuditEvent: vi.fn() }));
import { query, withTransaction } from "../src/db.js";
import { logAuditEvent } from "../src/audit.js";
import { assertPurchaseOrderHasNoProviderInvoices, registerProviderInvoiceRoutes } from "../src/provider-invoices.js";

let orders, lines, documents, reservations, owners, nextId, tail;
const body = (extra = {}) => ({
  documentType: "preinvoice", invoiceDate: "2026-11-06", exchangeRate: 20,
  orderItems: [{ orderId: 1, items: [{ itemId: 10, quantity: 2 }] }], ...extra,
});
const hasAdministration = (user) => user.permissionSet.has("cotizaciones.administracion");
function app(userId = 1, permissions = ["aceptar_pedido.procesamiento.read", "aceptar_pedido.procesamiento.update"]) {
  const instance = express();
  instance.use(express.json(), (req, _res, next) => {
    req.user = { id: userId, permissionSet: new Set(permissions) };
    next();
  });
  registerProviderInvoiceRoutes(instance, {
    permissionCodes: ["aceptar_pedido.procesamiento.read", "aceptar_pedido.procesamiento.update", "cotizaciones.administracion", "cotizaciones.operacion"],
    hasAdministration,
    hasUpdatePermission: (user) => hasAdministration(user) || user.permissionSet.has("aceptar_pedido.procesamiento.update") || user.permissionSet.has("cotizaciones.operacion"),
    ensureProcessingSchema: async () => {},
  });
  return instance;
}

async function execute(sql, params = []) {
  if (sql.includes("FROM quotation_processing_purchase_orders po")) {
    let rows = orders;
    if (sql.includes("WHERE po.id IN")) {
      const ids = sql.includes("account_owners") ? params.slice(0, -1) : params;
      rows = rows.filter((row) => ids.includes(row.id));
    }
    if (sql.includes("account_owners")) rows = rows.filter((row) => owners[row.account_id]?.includes(params.at(-1)));
    return rows;
  }
  if (sql.includes("SELECT * FROM quotation_processing_purchase_order_items")) return lines.filter((line) => params.includes(line.purchase_order_id));
  if (sql.includes("SUM(quantity) AS used_quantity")) {
    return lines.map((line) => ({ purchase_order_item_id: line.id,
      used_quantity: reservations.filter((row) => row.purchase_order_item_id === line.id).reduce((sum, row) => sum + row.quantity, 0) }));
  }
  if (sql.includes("SELECT poi.*")) {
    return lines.filter((line) => params.includes(line.purchase_order_id)).map((line) => {
      const used = reservations.filter((row) => row.purchase_order_item_id === line.id);
      return { ...line,
        invoiced_quantity: used.filter((row) => documents.find((doc) => doc.id === row.invoice_id)?.document_type === "invoice").reduce((sum, row) => sum + row.quantity, 0),
        reserved_quantity: used.filter((row) => documents.find((doc) => doc.id === row.invoice_id)?.document_type === "preinvoice").reduce((sum, row) => sum + row.quantity, 0) };
    });
  }
  if (sql.includes("INSERT INTO provider_invoices")) {
    const [document_type, invoice_number, invoice_number_normalized, invoice_date, provider_id, provider_name,
      currency_code, exchange_rate, exchange_rate_source, exchange_rate_date, subtotal, iva_amount,
      total_amount, total_usd, orders_json, created_by_user_id] = params;
    unique(provider_id, invoice_number_normalized);
    const row = { id: nextId++, document_type, invoice_number, invoice_number_normalized, invoice_date,
      provider_id, provider_name, currency_code, exchange_rate, exchange_rate_source, exchange_rate_date,
      subtotal, iva_amount, total_amount, total_usd, orders_json, created_by_user_id, created_at: "2026-11-06" };
    documents.push(row);
    return { insertId: row.id };
  }
  if (sql.includes("INSERT INTO provider_invoice_items")) {
    const [invoice_id, purchase_order_id, purchase_order_item_id, quantity] = params;
    reservations.push({ invoice_id, purchase_order_id, purchase_order_item_id, quantity });
  }
  if (sql.includes("SELECT pi.*")) {
    let rows = documents;
    if (sql.includes("WHERE pi.id = ?")) rows = rows.filter((row) => row.id === params[0]);
    if (sql.includes("scope_owner")) rows = rows.filter((row) => JSON.parse(row.orders_json).every((order) => owners[order.accountId]?.includes(params.at(-1))));
    return structuredClone(rows);
  }
  if (sql.includes("UPDATE provider_invoices")) {
    const [invoice_number, invoice_number_normalized, invoice_date, exchange_rate, exchange_rate_source,
      exchange_rate_date, total_usd, converted_by_user_id, id] = params;
    const row = documents.find((row) => row.id === id);
    unique(row.provider_id, invoice_number_normalized);
    Object.assign(row, { document_type: "invoice", invoice_number, invoice_number_normalized, invoice_date,
      exchange_rate, exchange_rate_source, exchange_rate_date, total_usd, converted_by_user_id, converted_at: "2026-11-06" });
  }
  if (sql.includes("SELECT id FROM provider_invoice_items")) return reservations.filter((row) => row.purchase_order_id === params[0]);
  return [];
}
function unique(providerId, number) {
  if (number && documents.some((row) => row.provider_id === providerId && row.invoice_number_normalized === number)) {
    throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  documents = [];
  reservations = [];
  owners = { 7: [1, 2], 8: [1] };
  nextId = 1;
  tail = Promise.resolve();
  orders = [1, 2].map((id) => ({
    id, quotation_id: id, order_number: `OC-${id}`, order_date: "2026-11-05",
    opportunity_id: id, opportunity_name: `Proyecto ${id}`, account_id: id === 1 ? 7 : 8,
    account_name: `Cuenta ${id}`, provider_id: 3, provider_name: "Proveedor",
    currency_code: "MXN", iva_pct: id === 1 ? 8 : 0,
  }));
  lines = orders.map((order) => ({
    id: order.id * 10, purchase_order_id: order.id, line_code: "X", line_description: "Producto",
    quantity: 5, unit_cost: 12, discount_pct: 10, amount: 54,
  }));
  query.mockImplementation(execute);
  withTransaction.mockImplementation(async (work) => {
    let unlock;
    const previous = tail;
    tail = new Promise((resolve) => { unlock = resolve; });
    await previous;
    const saved = structuredClone({ documents, reservations, nextId });
    try {
      return await work({ query: async (...args) => [await execute(...args)] });
    } catch (error) {
      ({ documents, reservations, nextId } = saved);
      throw error;
    } finally {
      unlock();
    }
  });
  logAuditEvent.mockResolvedValue(1);
});

describe("supplier invoice API", () => {
  it("snapshots multiple accounts, actual per-order IVA and discounted costs without trusting client totals", async () => {
    const response = await request(app()).post("/provider-invoices").send(body({
      subtotal: 999, totalAmount: 999,
      orderItems: [{ orderId: 1, items: [{ itemId: 10, quantity: 2, unitCost: 999 }] },
        { orderId: 2, items: [{ itemId: 20, quantity: 1 }] }],
      exchangeRateSource: "suggested", exchangeRateDate: "2026-11-05",
    }));
    expect(response.status, response.text).toBe(201);
    expect(response.body).toMatchObject({
      id: "1", documentType: "preinvoice", invoiceNumber: null, providerId: 3,
      currencyCode: "MXN", subtotal: 32.4, ivaAmount: 1.73, totalAmount: 34.13, totalUsd: 1.71,
      exchangeRate: 20, exchangeRateSource: "suggested", exchangeRateDate: "2026-11-05",
    });
    expect(response.body.orders).toHaveLength(2);
    expect(response.body.orders[0]).toMatchObject({
      accountId: 7, opportunityName: "Proyecto 1", ivaPct: 8, subtotal: 21.6,
      lines: [{ itemId: 10, quantity: 2, purchasedQuantity: 5, unitCost: 12, discountPct: 10, amount: 21.6 }],
    });
    expect(response.body.orders[1]).toMatchObject({ accountId: 8, ivaPct: 0, ivaAmount: 0 });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ required: true, connection: expect.any(Object) }));
  });

  it("lists persisted orders across statuses, reserves partial quantities and keeps invoice/reservation totals separate", async () => {
    await request(app()).post("/provider-invoices").send(body());
    await request(app()).post("/provider-invoices").send(body({ documentType: "invoice", invoiceNumber: "Ab-1" }));
    const response = await request(app()).get("/provider-invoices/orders");
    expect(response.status).toBe(200);
    expect(response.body[0].lines[0]).toMatchObject({
      quantity: 5, purchasedQuantity: 5, invoicedQuantity: 2, reservedQuantity: 2, availableQuantity: 1,
    });
    expect((await request(app()).post("/provider-invoices").send(body())).status).toBe(409);
    const remaining = body({ orderItems: [{ orderId: 1, items: [{ itemId: 10, quantity: 1 }] }] });
    expect((await request(app()).post("/provider-invoices").send(remaining)).status).toBe(201);
    expect((await request(app()).get("/provider-invoices/orders")).body[0].lines[0].availableQuantity).toBe(0);
  });

  it("converts in place, preserving historical items/currency/IVA/totals and updating only rate and invoice metadata", async () => {
    const created = await request(app()).post("/provider-invoices").send(body({
      exchangeRateSource: "suggested", exchangeRateDate: "2026-11-05",
    }));
    const original = documents[0].orders_json;
    orders[0].currency_code = "EUR";
    orders[0].iva_pct = 100;
    lines[0].unit_cost = 900;
    const converted = await request(app()).post("/provider-invoices/1/convert").send({
      invoiceNumber: " INV-42 ", invoiceDate: "2026-12-01", exchangeRate: 10,
    });
    expect(converted.status, converted.text).toBe(200);
    expect(converted.body).toMatchObject({
      id: created.body.id, invoiceNumber: "INV-42", documentType: "invoice",
      currencyCode: "MXN", subtotal: 21.6, ivaAmount: 1.73, totalAmount: 23.33, totalUsd: 2.33,
      exchangeRate: 10, exchangeRateSource: "manual", exchangeRateDate: null, convertedByUserId: 1,
    });
    expect(documents[0].orders_json).toBe(original);
    expect((await request(app()).get("/provider-invoices")).body[0]).toEqual(converted.body);
    expect((await request(app()).post("/provider-invoices/1/convert").send({
      invoiceNumber: "INV-43", invoiceDate: "2026-11-06",
    })).status).toBe(409);
    expect(reservations).toHaveLength(1);
  });

  it("requires invoice numbers only for invoices and enforces case/trim uniqueness per supplier", async () => {
    expect((await request(app()).post("/provider-invoices").send(body({ documentType: "invoice" }))).status).toBe(400);
    expect((await request(app()).post("/provider-invoices").send(body({ documentType: "invoice", invoiceNumber: " A-1 " }))).status).toBe(201);
    expect((await request(app()).post("/provider-invoices").send(body({ documentType: "invoice", invoiceNumber: "a-1" }))).status).toBe(409);
    expect(reservations).toHaveLength(1);
    orders[1].provider_id = 4;
    expect((await request(app()).post("/provider-invoices").send(body({
      documentType: "invoice", invoiceNumber: "a-1", orderItems: [{ orderId: 2, items: [{ itemId: 20, quantity: 1 }] }],
    }))).status).toBe(201);
    const preinvoice = await request(app()).post("/provider-invoices").send(body({ orderItems: [{ orderId: 1, items: [{ itemId: 10, quantity: 1 }] }] }));
    expect((await request(app()).post(`/provider-invoices/${preinvoice.body.id}/convert`).send({ invoiceNumber: " a-1 ", invoiceDate: "2026-11-06" })).status).toBe(409);
    expect(documents.at(-1).document_type).toBe("preinvoice");
  });

  it("scopes orders and grouped documents to ownership of every account, with administrator override", async () => {
    const grouped = body({ orderItems: [{ orderId: 1, items: [{ itemId: 10, quantity: 1 }] }, { orderId: 2, items: [{ itemId: 20, quantity: 1 }] }] });
    expect((await request(app(2)).post("/provider-invoices").send(grouped)).status).toBe(404);
    expect((await request(app()).post("/provider-invoices").send(grouped)).status).toBe(201);
    expect((await request(app(2)).get("/provider-invoices/orders")).body).toHaveLength(1);
    expect((await request(app(2)).get("/provider-invoices")).body).toEqual([]);
    expect((await request(app(2)).post("/provider-invoices/1/convert").send({ invoiceNumber: "X", invoiceDate: "2026-11-06" })).status).toBe(404);
    expect((await request(app(3, ["cotizaciones.administracion"])).get("/provider-invoices")).body).toHaveLength(1);
    expect((await request(app(1, [])).get("/provider-invoices")).status).toBe(403);
    owners[7] = [];
    expect((await request(app()).get("/provider-invoices")).body).toEqual([]);
  });

  it("allows read-only access but requires the existing update permission for writes and creator/admin for conversion", async () => {
    const created = await request(app()).post("/provider-invoices").send(body());
    const readonly = app(1, ["aceptar_pedido.procesamiento.read"]);
    expect((await request(readonly).get("/provider-invoices/orders")).body[0].canUpdate).toBe(false);
    expect((await request(readonly).get("/provider-invoices")).body[0]).toMatchObject({ canUpdate: false, canConvert: false });
    expect((await request(readonly).post("/provider-invoices").send(body())).status).toBe(403);
    expect((await request(readonly).post(`/provider-invoices/${created.body.id}/convert`).send({ invoiceNumber: "NO", invoiceDate: "2026-11-06" })).status).toBe(403);
    expect((await request(readonly).post(`/provider-invoices/${created.body.id}/attachments`)).status).toBe(403);
    expect((await request(app(2)).get("/provider-invoices")).body[0]).toMatchObject({ canUpdate: true, canConvert: false });
    expect((await request(app(2)).post(`/provider-invoices/${created.body.id}/convert`).send({ invoiceNumber: "NO", invoiceDate: "2026-11-06" })).status).toBe(403);
    expect((await request(app(9, ["cotizaciones.administracion"])).post(`/provider-invoices/${created.body.id}/convert`).send({ invoiceNumber: "YES", invoiceDate: "2026-11-06" })).status).toBe(200);
  });

  it("rejects mismatched grouping, item/order mismatch, duplicates, malformed dates, rates and quantities", async () => {
    const grouped = body({ orderItems: [{ orderId: 1, items: [{ itemId: 10, quantity: 1 }] }, { orderId: 2, items: [{ itemId: 20, quantity: 1 }] }] });
    orders[1].provider_id = 4;
    expect((await request(app()).post("/provider-invoices").send(grouped)).status).toBe(400);
    orders[1].provider_id = 3;
    orders[1].currency_code = "USD";
    expect((await request(app()).post("/provider-invoices").send(grouped)).status).toBe(400);
    for (const invalid of [
      { invoiceDate: "2026-02-30" }, { exchangeRate: 0 }, { exchangeRate: 1.123456789 }, { exchangeRate: null },
      { exchangeRateDate: "2026-99-99" }, { exchangeRateSource: "unknown" }, { invoiceNumber: " " .repeat(121) + "x".repeat(121) },
      { orderItems: [] }, { orderItems: [null] }, { orderItems: [{ orderId: 1, items: [{ itemId: 20, quantity: 1 }] }] },
      { orderItems: [{ orderId: 1, items: [{ itemId: 10, quantity: 0.0000001 }] }] },
      { orderItems: [{ orderId: 1, items: [{ itemId: 10, quantity: -1 }] }] },
      { orderItems: [{ orderId: 1, items: [{ itemId: 10, quantity: 1 }, { itemId: 10, quantity: 1 }] }] },
      { orderItems: [grouped.orderItems[0], grouped.orderItems[0]] },
    ]) expect((await request(app()).post("/provider-invoices").send(body(invalid))).status, JSON.stringify(invalid)).toBe(400);
    expect(documents).toHaveLength(0);
  });

  it("defaults USD to one, requires other currency rate and retains a saved rate on conversion", async () => {
    const input = body();
    delete input.exchangeRate;
    expect((await request(app()).post("/provider-invoices").send(input)).status).toBe(400);
    orders[0].currency_code = "USD";
    const created = await request(app()).post("/provider-invoices").send(input);
    expect(created.body.exchangeRate).toBe(1);
    expect((await request(app()).post("/provider-invoices").send(body({ exchangeRate: 2 }))).status).toBe(400);
    const converted = await request(app()).post("/provider-invoices/1/convert").send({ invoiceNumber: "USD-1", invoiceDate: "2026-11-06" });
    expect(converted.body).toMatchObject({ exchangeRate: 1, totalUsd: 23.33 });
  });

  it("serializes competing reservations and conversions without double consuming quantities", async () => {
    const input = body({ orderItems: [{ orderId: 1, items: [{ itemId: 10, quantity: 3 }] }] });
    const responses = await Promise.all([request(app()).post("/provider-invoices").send(input), request(app(2)).post("/provider-invoices").send(input)]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const converted = await Promise.all([request(app()).post("/provider-invoices/1/convert").send({ invoiceNumber: "X", invoiceDate: "2026-11-06" }),
      request(app()).post("/provider-invoices/1/convert").send({ invoiceNumber: "Y", invoiceDate: "2026-11-06" })]);
    expect(converted.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(reservations).toHaveLength(1);
  });

  it("rolls back both document and reservations if audit fails, and blocks referenced order mutation", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logAuditEvent.mockRejectedValueOnce(new Error("audit unavailable"));
    expect((await request(app()).post("/provider-invoices").send(body())).status).toBe(500);
    expect(documents).toEqual([]);
    expect(reservations).toEqual([]);
    await request(app()).post("/provider-invoices").send(body());
    await expect(assertPurchaseOrderHasNoProviderInvoices({ query: async (...args) => [await execute(...args)] }, 1)).rejects.toMatchObject({ status: 409 });
    await expect(assertPurchaseOrderHasNoProviderInvoices({ query: async (...args) => [await execute(...args)] }, 2)).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
