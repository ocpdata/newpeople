import express from "express";
import mysql from "mysql2/promise";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pool: null }));
vi.mock("../src/db.js", () => ({
  query: async (...args) => (await state.pool.query(...args))[0],
  withTransaction: async (work) => {
    const conn = await state.pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await work(conn);
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  },
}));
vi.mock("../src/audit.js", () => ({ logAuditEvent: vi.fn(async () => 1) }));
import { config } from "../src/config.js";
import { logAuditEvent } from "../src/audit.js";
import { registerProviderInvoiceRoutes, ensureProviderInvoicesSchema, assertPurchaseOrderHasNoProviderInvoices } from "../src/provider-invoices.js";
import { createDocumentStorage } from "../src/opportunity-documents/storage.js";

describe.skipIf(process.env.PROVIDER_INVOICE_MYSQL_TEST !== "1")("supplier invoice MySQL persistence and serialization", () => {
  const database = `provider_invoices_test_${process.pid}`;
  let admin, databaseCreated = false;
  const storedFiles = [];
  function app(userId = 1, administrator = false) {
    const instance = express();
    instance.use(express.json(), (req, _res, next) => {
      req.user = { id: userId, permissionSet: new Set(["aceptar_pedido.procesamiento.read", "aceptar_pedido.procesamiento.update"]), administrator };
      next();
    });
    registerProviderInvoiceRoutes(instance, {
      permissionCodes: ["aceptar_pedido.procesamiento.read"],
      hasAdministration: (user) => user.administrator,
      hasUpdatePermission: (user) => user.administrator || user.permissionSet.has("aceptar_pedido.procesamiento.update"),
      ensureProcessingSchema: async () => {},
    });
    return instance;
  }
  const input = (extra = {}) => ({
    documentType: "preinvoice", invoiceDate: "2026-11-06", exchangeRate: 20,
    exchangeRateSource: "suggested", exchangeRateDate: "2026-11-05",
    orderItems: [{ orderId: 1, items: [{ itemId: 10, quantity: 3 }] }], ...extra,
  });
  beforeAll(async () => {
    admin = await mysql.createConnection({ ...config.db, database: undefined });
    await admin.query(`CREATE DATABASE \`${database}\``);
    databaseCreated = true;
    state.pool = mysql.createPool({ ...config.db, database, connectionLimit: 5 });
    await state.pool.query("CREATE TABLE users (id BIGINT UNSIGNED PRIMARY KEY)");
    await state.pool.query("INSERT INTO users VALUES (1), (2)");
    await state.pool.query("CREATE TABLE accounts (id BIGINT UNSIGNED PRIMARY KEY, name VARCHAR(100))");
    await state.pool.query("INSERT INTO accounts VALUES (7, 'Cuenta 1'), (8, 'Cuenta 2')");
    await state.pool.query("CREATE TABLE account_owners (account_id BIGINT UNSIGNED, user_id BIGINT UNSIGNED)");
    await state.pool.query("INSERT INTO account_owners VALUES (7, 1), (7, 2), (8, 1)");
    await state.pool.query("CREATE TABLE opportunities (id BIGINT UNSIGNED PRIMARY KEY, account_id BIGINT UNSIGNED, name VARCHAR(100))");
    await state.pool.query("INSERT INTO opportunities VALUES (1, 7, 'Proyecto 1'), (2, 8, 'Proyecto 2')");
    await state.pool.query(`CREATE TABLE quotation_processing_purchase_orders (
      id BIGINT UNSIGNED PRIMARY KEY, quotation_id BIGINT UNSIGNED, opportunity_id BIGINT UNSIGNED,
      provider_id BIGINT UNSIGNED, provider_name VARCHAR(190), order_number VARCHAR(120), order_date DATE,
      currency_code VARCHAR(20), iva_pct DECIMAL(6,3), created_at DATETIME(3) DEFAULT NOW(3)
    ) ENGINE=InnoDB`);
    await state.pool.query(`CREATE TABLE quotation_processing_purchase_order_items (
      id BIGINT UNSIGNED PRIMARY KEY, purchase_order_id BIGINT UNSIGNED, product_id BIGINT UNSIGNED,
      line_code VARCHAR(120), line_description VARCHAR(5000), quantity DECIMAL(18,6),
      unit_cost DECIMAL(18,6), discount_pct DECIMAL(6,3), amount DECIMAL(18,6),
      CONSTRAINT fk_test_po FOREIGN KEY (purchase_order_id) REFERENCES quotation_processing_purchase_orders(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
    await state.pool.query(`CREATE TABLE documents (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, public_id VARCHAR(64) NOT NULL UNIQUE,
      upload_session_id BIGINT UNSIGNED NULL, entity_type VARCHAR(40), entity_id BIGINT UNSIGNED,
      storage_provider VARCHAR(30), storage_bucket VARCHAR(120), storage_key VARCHAR(500),
      original_file_name VARCHAR(255), stored_file_name VARCHAR(255), mime_type VARCHAR(120),
      file_extension VARCHAR(20), byte_size BIGINT UNSIGNED, sha256 CHAR(64),
      document_kind VARCHAR(40), source_label VARCHAR(120), processing_status VARCHAR(30),
      is_deleted TINYINT(1) DEFAULT 0, uploaded_by_user_id BIGINT UNSIGNED,
      created_at DATETIME(3) DEFAULT NOW(3), updated_at DATETIME(3) DEFAULT NOW(3)
    ) ENGINE=InnoDB`);
    await ensureProviderInvoicesSchema();
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    logAuditEvent.mockResolvedValue(1);
    const [existingFiles] = await state.pool.query("SELECT storage_key AS storageKey, storage_bucket AS storageBucket FROM documents");
    storedFiles.push(...existingFiles);
    await state.pool.query("DELETE FROM documents");
    await state.pool.query("DELETE FROM provider_invoice_items");
    await state.pool.query("DELETE FROM provider_invoices");
    await state.pool.query("DELETE FROM quotation_processing_purchase_order_items");
    await state.pool.query("DELETE FROM quotation_processing_purchase_orders");
    await state.pool.query(`INSERT INTO quotation_processing_purchase_orders
      (id, quotation_id, opportunity_id, provider_id, provider_name, order_number, order_date, currency_code, iva_pct)
      VALUES (1, 1, 1, 3, 'Proveedor', 'OC-1', '2026-11-05', 'MXN', 8),
             (2, 2, 2, 3, 'Proveedor', 'OC-2', '2026-11-05', 'MXN', 0)`);
    await state.pool.query(`INSERT INTO quotation_processing_purchase_order_items
      (id, purchase_order_id, line_code, line_description, quantity, unit_cost, discount_pct, amount)
      VALUES (10, 1, 'X', 'Producto', 5, 12, 10, 54),
             (20, 2, 'Y', 'Otro producto', 5, 17.123456, 0, 85.61728)`);
  });
  afterAll(async () => {
    if (state.pool) {
      if (databaseCreated) {
        const [files] = await state.pool.query("SELECT storage_key AS storageKey, storage_bucket AS storageBucket FROM documents").catch(() => [[]]);
        storedFiles.push(...files);
        const storage = createDocumentStorage();
        await Promise.all(storedFiles.map((file) => storage.delete(file)));
      }
      await state.pool.end();
    }
    if (admin) {
      if (databaseCreated) await admin.query(`DROP DATABASE \`${database}\``);
      await admin.end();
    }
  });

  it("serializes concurrent partial reservations and in-place conversions with persisted decimal rates and totals", async () => {
    const responses = await Promise.all([
      request(app()).post("/provider-invoices").send(input()),
      request(app()).post("/provider-invoices").send(input()),
    ]);
    expect(responses.map((response) => response.status).sort(), responses.map((response) => response.text).join("\n")).toEqual([201, 409]);
    const created = responses.find((response) => response.status === 201).body;
    expect(created).toMatchObject({
      documentType: "preinvoice", invoiceNumber: null, subtotal: 32.4, ivaAmount: 2.59,
      totalAmount: 34.99, totalUsd: 1.75, exchangeRate: 20, exchangeRateDate: "2026-11-05",
    });
    const available = await request(app()).get("/provider-invoices/orders");
    expect(available.body.find((order) => order.orderId === 1).lines[0]).toMatchObject({ reservedQuantity: 3, invoicedQuantity: 0, availableQuantity: 2 });
    const conversions = await Promise.all([
      request(app()).post(`/provider-invoices/${created.id}/convert`).send({ invoiceNumber: " Ref-123 ", invoiceDate: "2026-12-01", exchangeRate: 17.12345678 }),
      request(app()).post(`/provider-invoices/${created.id}/convert`).send({ invoiceNumber: "Ref-456", invoiceDate: "2026-12-01" }),
    ]);
    expect(conversions.map((response) => response.status).sort()).toEqual([200, 409]);
    const converted = conversions.find((response) => response.status === 200).body;
    expect(converted.orders).toEqual(created.orders);
    const listed = await request(app()).get("/provider-invoices");
    expect(listed.body[0]).toMatchObject({
      id: created.id, documentType: "invoice", totalAmount: 34.99, subtotal: 32.4, ivaAmount: 2.59,
    });
    const remaining = await request(app()).get("/provider-invoices/orders");
    expect(remaining.body.find((order) => order.orderId === 1).lines[0]).toMatchObject({ reservedQuantity: 0, invoicedQuantity: 3, availableQuantity: 2 });
    expect((await state.pool.query("SELECT COUNT(*) AS n FROM provider_invoice_items"))[0][0].n).toBe(1);
    await expect(assertPurchaseOrderHasNoProviderInvoices(state.pool, 1)).rejects.toMatchObject({ status: 409 });
    await expect(state.pool.query("DELETE FROM quotation_processing_purchase_orders WHERE id = 1")).rejects.toMatchObject({ code: "ER_ROW_IS_REFERENCED_2" });
    await expect(state.pool.query("DELETE FROM quotation_processing_purchase_order_items WHERE id = 10")).rejects.toMatchObject({ code: "ER_ROW_IS_REFERENCED_2" });
  });

  it("enforces supplier number uniqueness on competing create and conversion, without leaking grouped account data", async () => {
    const grouped = input({ orderItems: [{ orderId: 1, items: [{ itemId: 10, quantity: 1 }] }, { orderId: 2, items: [{ itemId: 20, quantity: 2 }] }] });
    const preinvoice = await request(app()).post("/provider-invoices").send(grouped);
    expect(preinvoice.status, preinvoice.text).toBe(201);
    expect(preinvoice.body).toMatchObject({ subtotal: 45.05, ivaAmount: 0.86, totalAmount: 45.91, totalUsd: 2.3 });
    expect((await request(app(2)).get("/provider-invoices")).body).toEqual([]);
    expect((await request(app(2)).post(`/provider-invoices/${preinvoice.body.id}/convert`).send({ invoiceNumber: "X", invoiceDate: "2026-11-06" })).status).toBe(404);
    const invoice = await request(app()).post("/provider-invoices").send(input({ documentType: "invoice", invoiceNumber: "Unique-1" }));
    expect(invoice.status, invoice.text).toBe(201);
    const duplicate = await request(app()).post(`/provider-invoices/${preinvoice.body.id}/convert`).send({ invoiceNumber: " unique-1 ", invoiceDate: "2026-11-06" });
    expect(duplicate.status, duplicate.text).toBe(409);
    expect((await request(app()).get("/provider-invoices")).body.find((doc) => doc.id === preinvoice.body.id).documentType).toBe("preinvoice");
    const otherSupplier = await state.pool.query("UPDATE quotation_processing_purchase_orders SET provider_id = 4 WHERE id = 2");
    expect(otherSupplier[0].affectedRows).toBe(1);
    const allowed = await request(app()).post("/provider-invoices").send(input({
      documentType: "invoice", invoiceNumber: " UNIQUE-1 ",
      orderItems: [{ orderId: 2, items: [{ itemId: 20, quantity: 1 }] }],
    }));
    expect(allowed.status, allowed.text).toBe(201);
  });

  it("rolls back failed audit and retains historical order snapshots after source changes", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logAuditEvent.mockRejectedValueOnce(new Error("audit unavailable"));
    expect((await request(app()).post("/provider-invoices").send(input())).status).toBe(500);
    expect((await state.pool.query("SELECT COUNT(*) AS n FROM provider_invoices"))[0][0].n).toBe(0);
    expect((await state.pool.query("SELECT COUNT(*) AS n FROM provider_invoice_items"))[0][0].n).toBe(0);
    const created = await request(app()).post("/provider-invoices").send(input());
    await state.pool.query("UPDATE quotation_processing_purchase_orders SET iva_pct = 100, currency_code = 'EUR', provider_name = 'Cambio' WHERE id = 1");
    await state.pool.query("UPDATE quotation_processing_purchase_order_items SET unit_cost = 999 WHERE id = 10");
    const converted = await request(app()).post(`/provider-invoices/${created.body.id}/convert`).send({
      invoiceNumber: "HIST-1", invoiceDate: "2026-12-01", exchangeRate: 10, exchangeRateSource: "manual",
    });
    expect(converted.status, converted.text).toBe(200);
    expect(converted.body).toMatchObject({
      currencyCode: "MXN", providerName: "Proveedor", subtotal: 32.4, ivaAmount: 2.59,
      totalAmount: 34.99, totalUsd: 3.5, exchangeRate: 10, exchangeRateDate: null,
    });
    expect(converted.body.orders).toEqual(created.body.orders);
    spy.mockRestore();
  });

  it("uploads, lists and downloads invoice attachments using existing storage, with account access checks", async () => {
    const created = await request(app()).post("/provider-invoices").send(input({
      orderItems: [{ orderId: 2, items: [{ itemId: 20, quantity: 1 }] }],
    }));
    const uploaded = await request(app()).post(`/provider-invoices/${created.body.id}/attachments`)
      .attach("files", Buffer.from("%PDF-1.4\nsupplier invoice\n"), { filename: "factura.pdf", contentType: "application/pdf" });
    expect(uploaded.status, uploaded.text).toBe(201);
    expect(uploaded.body.attachments[0]).toMatchObject({ fileName: "factura.pdf", mimeType: "application/pdf", byteSize: 26 });
    const attachment = uploaded.body.attachments[0];
    expect((await request(app()).get(`/provider-invoices/${created.body.id}/attachments`)).body[0].id).toBe(attachment.id);
    expect((await request(app()).get("/provider-invoices")).body[0].attachments[0].id).toBe(attachment.id);
    const content = await request(app()).get(attachment.downloadUrl.replace("/api", ""));
    expect(content.status, content.text).toBe(200);
    expect(content.body.toString()).toBe("%PDF-1.4\nsupplier invoice\n");
    expect((await request(app(2)).get(attachment.downloadUrl.replace("/api", ""))).status).toBe(404);
    expect((await request(app(2)).post(`/provider-invoices/${created.body.id}/attachments`)
      .attach("files", Buffer.from("data"), { filename: "x.pdf", contentType: "application/pdf" })).status).toBe(404);
    expect((await request(app()).post(`/provider-invoices/${created.body.id}/attachments`)
      .attach("files", Buffer.from("data"), { filename: "x.exe", contentType: "application/x-msdownload" })).status).toBe(400);
    const converted = await request(app()).post(`/provider-invoices/${created.body.id}/convert`).send({
      invoiceNumber: "ATT-1", invoiceDate: "2026-11-06",
    });
    expect(converted.body.attachments[0].id).toBe(attachment.id);
  });
});
