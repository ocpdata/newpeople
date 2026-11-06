import express from "express";
import mysql from "mysql2/promise";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pool: null, currency: "USD" }));
vi.mock("../src/db.js", () => ({
  query: async (sql, params = []) => {
    if (sql.includes("SELECT q.id, q.opportunity_id")) return [{ id: 1, account_id: 7, latest_version_id: 1 }];
    if (sql.includes("WHERE qv.id = ?")) return [{ id: 1, status_code: "aceptada", currency_code: state.currency }];
    if (sql.includes("FROM quotation_sections qs")) return [{ id: 20 }];
    if (sql.includes("FROM quotation_section_items qsi")) return [{
      id: 10, quotation_section_id: 20, quantity: 5, product_code: "X",
      product_description: "Producto", item_type: "producto", list_price_unit: 12,
    }];
    if (sql.includes("quotation_invoices") || sql.includes("quotation_invoice_lock") ||
        sql.includes("quotation_invoice_sequences")) {
      return (await state.pool.query(sql, params))[0];
    }
    return [];
  },
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
import router from "../src/routes.quotations.js";

describe.skipIf(process.env.QUOTATION_INVOICE_MYSQL_TEST !== "1")("quotation invoice MySQL serialization", () => {
  const database = `quotation_invoices_test_${process.pid}`;
  let admin, databaseCreated = false;
  const app = express();
  app.use(express.json(), (req, _res, next) => {
    req.user = { id: 1, permissionSet: new Set(["aceptar_pedido.procesamiento.read"]) };
    next();
  });
  app.use("/api", router);
  const body = {
    documentType: "preinvoice", invoiceDate: "2026-11-06", accountId: 7, quotationIds: [1],
    quotationItems: [{ quotationId: 1, items: [{ productId: 10, lineId: "q1-p10-r1", quantity: 3, unitCostWithDiscount: 12 }] }],
  };
  beforeAll(async () => {
    admin = await mysql.createConnection({ ...config.db, database: undefined });
    await admin.query(`CREATE DATABASE \`${database}\``);
    databaseCreated = true;
    state.pool = mysql.createPool({ ...config.db, database, connectionLimit: 5 });
    await state.pool.query("CREATE TABLE users (id BIGINT UNSIGNED PRIMARY KEY)");
    await state.pool.query("INSERT INTO users VALUES (1), (2)");
    await state.pool.query("CREATE TABLE accounts (id BIGINT UNSIGNED PRIMARY KEY, name VARCHAR(100))");
    await state.pool.query("INSERT INTO accounts VALUES (7, 'Cuenta de prueba')");
    await state.pool.query("CREATE TABLE account_owners (account_id BIGINT UNSIGNED, user_id BIGINT UNSIGNED)");
    await state.pool.query("INSERT INTO account_owners VALUES (7, 1)");
    await state.pool.query(`CREATE TABLE quotation_invoices (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, invoice_number VARCHAR(80) NOT NULL,
      invoice_date DATE NOT NULL, account_id BIGINT UNSIGNED,
      quotation_ids_json LONGTEXT NOT NULL, quotation_items_json LONGTEXT NOT NULL,
      created_by_user_id BIGINT UNSIGNED NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB`);
    await state.pool.query(`INSERT INTO quotation_invoices
      (invoice_number, invoice_date, account_id, quotation_ids_json, quotation_items_json, created_by_user_id)
      VALUES ('AQ-2026-7', '2026-01-01', 7, '[1]', '[]', 2)`);
  });
  afterAll(async () => {
    if (state.pool) await state.pool.end();
    if (admin) {
      if (databaseCreated) await admin.query(`DROP DATABASE \`${database}\``);
      await admin.end();
    }
  });
  it("migrates legacy rows and serializes competing reservations and conversions", async () => {
    const responses = await Promise.all([
      request(app).post("/api/quotation-invoices").send(body),
      request(app).post("/api/quotation-invoices").send(body),
    ]);
    expect(responses.map((response) => response.status).sort(), responses.map((response) => response.text).join("\n")).toEqual([201, 409]);
    const created = responses.find((response) => response.status === 201).body;
    expect(created).toMatchObject({ documentType: "preinvoice", invoiceNumber: null,
      currencyCode: "USD", exchangeRate: 1, subtotal: 36, ivaAmount: 5.76, totalAmount: 41.76, totalUsd: 41.76 });
    const list = await request(app).get("/api/quotation-invoices");
    expect(list.status).toBe(200);
    expect(list.body.find((row) => row.invoiceNumber === "AQ-2026-7")).toMatchObject({
      documentType: "invoice", invoiceDate: "2026-01-01", createdByUserId: 2,
      currencyCode: null, exchangeRate: null, totalAmount: null, totalUsd: null,
      accountName: "Cuenta de prueba",
    });
    const converted = await Promise.all([
      request(app).post(`/api/quotation-invoices/${created.id}/convert`).send({ invoiceDate: "2026-11-06" }),
      request(app).post(`/api/quotation-invoices/${created.id}/convert`).send({ invoiceDate: "2026-11-06" }),
    ]);
    expect(converted.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(converted.find((response) => response.status === 200).body.invoiceNumber).toBe("AQ-2026-8");
    expect((await request(app).delete(`/api/quotation-invoices/${created.id}`)).status).toBe(200);
    const next = await request(app).post("/api/quotation-invoices").send({ ...body, documentType: "invoice" });
    expect(next.body.invoiceNumber).toBe("AQ-2026-9");
  });

  it("persists decimal amounts and rate metadata through conversion and reload", async () => {
    await state.pool.query("DELETE FROM quotation_invoices");
    state.currency = "MXN";
    const created = await request(app).post("/api/quotation-invoices").send({
      ...body, currencyCode: "MXN", exchangeRate: 20.25,
      exchangeRateSource: "suggested", exchangeRateDate: "2026-11-05",
    });
    expect(created.status).toBe(201);
    const initial = await request(app).get("/api/quotation-invoices");
    expect(initial.body[0]).toMatchObject({
      currencyCode: "MXN", exchangeRate: 20.25, exchangeRateDate: "2026-11-05",
      totalAmount: 41.76, totalUsd: 2.06,
    });
    const converted = await request(app).post(`/api/quotation-invoices/${created.body.id}/convert`).send({
      invoiceDate: "2026-11-06", exchangeRate: 16, exchangeRateSource: "manual",
    });
    expect(converted.status).toBe(200);
    state.currency = "EUR";
    const listed = await request(app).get("/api/quotation-invoices");
    expect(listed.body[0]).toMatchObject({
      id: created.body.id, documentType: "invoice", currencyCode: "MXN",
      exchangeRate: 16, exchangeRateSource: "manual", exchangeRateDate: null,
      subtotal: 36, ivaAmount: 5.76, totalAmount: 41.76, totalUsd: 2.61,
    });
  });
});
