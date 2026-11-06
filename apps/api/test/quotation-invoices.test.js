import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db.js", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("../src/audit.js", () => ({ logAuditEvent: vi.fn() }));
vi.mock("../src/exchange-rates.js", () => ({ getExchangeRate: vi.fn() }));
import { query, withTransaction } from "../src/db.js";
import { logAuditEvent } from "../src/audit.js";
import { getExchangeRate } from "../src/exchange-rates.js";
import router from "../src/routes.quotations.js";

let invoices, sequences, nextId, quotationOverrides, tail;
function app(userId = 1) {
  const instance = express();
  instance.use(express.json(), (req, _res, next) => {
    req.user = { id: userId, permissionSet: new Set(["aceptar_pedido.procesamiento.read"]) };
    next();
  });
  instance.use("/api", router);
  return instance;
}
const payload = (quantity = 2, extra = {}) => ({
  invoiceDate: "2026-11-06", accountId: 7, quotationIds: [1],
  quotationItems: [{ quotationId: 1, items: [{
    lineId: "q1-p10-r1", productId: 10, quantity, unitCostWithDiscount: 12,
  }] }], ...extra,
});

beforeEach(() => {
  invoices = [];
  sequences = new Map();
  nextId = 1;
  quotationOverrides = {};
  tail = Promise.resolve();
  vi.clearAllMocks();
  query.mockImplementation(async (sql, params = []) => {
    if (sql.includes("SELECT q.id AS quotation_id, o.name AS opportunity_name")) {
      return params.filter((id) => id !== 99).map((id) => ({
        quotation_id: id, opportunity_name: id === 3 ? "Otra oportunidad" : "Proyecto principal",
      }));
    }
    if (sql.includes("information_schema.COLUMNS")) return [{ column_name: "invoice_number", is_nullable: "NO" }];
    if (sql.includes("SELECT q.id, q.opportunity_id")) {
      const id = params.at(-1);
      if (quotationOverrides[id]?.inaccessible) return [];
      return [{ id, latest_version_id: id, account_id: 7, ...quotationOverrides[id] }];
    }
    if (sql.includes("WHERE qv.id = ?")) {
      const id = params.at(-1);
      return [{ id, status_code: "aceptada", currency_code: "USD", ...quotationOverrides[id] }];
    }
    if (sql.includes("FROM quotation_sections qs")) return [{ id: 20 }];
    if (sql.includes("FROM quotation_section_items qsi")) return [{
      id: 10, quotation_section_id: 20, quantity: 5, product_code: "X",
      product_description: "Producto", item_type: "producto", list_price_unit: 12,
    }];
    if (sql.includes("FROM quotation_invoices qi")) return invoices.map((invoice) => ({
      ...invoice, account_name: invoice.account_id === 7 ? "Cuenta de prueba" : null,
    }));
    return [];
  });
  withTransaction.mockImplementation(async (work) => {
    let unlock;
    const previous = tail;
    tail = new Promise((resolve) => { unlock = resolve; });
    await previous;
    const snapshot = structuredClone({ invoices, sequences, nextId });
    try {
      return await work({ query: transactionQuery });
    } catch (error) {
      ({ invoices, sequences, nextId } = snapshot);
      throw error;
    } finally {
      unlock();
    }
  });
  logAuditEvent.mockResolvedValue(1);
});

async function transactionQuery(sql, params = []) {
  if (sql.includes("SELECT quotation_items_json")) return [invoices];
  if (sql.includes("SELECT invoice_number FROM")) {
    return [invoices.filter((row) => row.invoice_number?.startsWith(params[0].slice(0, -1)))];
  }
  if (sql.includes("INSERT INTO quotation_invoice_sequences")) {
    sequences.set(params[0], Math.max(sequences.get(params[0]) || 0, params[1]));
  } else if (sql.includes("UPDATE quotation_invoice_sequences")) {
    sequences.set(params[0], sequences.get(params[0]) + 1);
  } else if (sql.includes("SELECT last_number")) {
    return [[{ last_number: sequences.get(params[0]) }]];
  } else if (sql.includes("INSERT INTO quotation_invoices")) {
    const [invoice_number, invoice_date, account_id, quotation_ids_json, quotation_items_json, created_by_user_id, document_type,
      currency_code, exchange_rate, exchange_rate_source, exchange_rate_date, subtotal, iva_amount, total_amount, total_usd] = params;
    const row = { id: nextId++, invoice_number, invoice_date, account_id, quotation_ids_json,
      quotation_items_json, created_by_user_id, document_type, created_at: "2026-11-06",
      currency_code, exchange_rate, exchange_rate_source, exchange_rate_date, subtotal, iva_amount, total_amount, total_usd };
    invoices.push(row);
    return [{ insertId: row.id }];
  } else if (sql.includes("SELECT id, created_by_user_id")) {
    return [invoices.filter((row) => row.id === params[0])];
  } else if (sql.includes("UPDATE quotation_invoices")) {
    Object.assign(invoices.find((row) => row.id === params.at(-1)), {
      document_type: "invoice", invoice_number: params[0], invoice_date: params[1],
      converted_at: "2026-11-06", converted_by_user_id: params[2],
      currency_code: params[3], exchange_rate: params[4], exchange_rate_source: params[5],
      exchange_rate_date: params[6], subtotal: params[7], iva_amount: params[8],
      total_amount: params[9], total_usd: params[10],
    });
  } else if (sql.includes("DELETE FROM quotation_invoices")) {
    invoices = invoices.filter((row) => row.id !== params[0]);
  }
  return [[]];
}

describe("quotation invoices", () => {
  it("lists unique opportunity names from all document quotations", async () => {
    invoices.push({
      id: 8, invoice_number: null, document_type: "preinvoice",
      quotation_ids_json: "[1,2,3,99]", quotation_items_json: "[]", created_by_user_id: 1,
    });
    const response = await request(app()).get("/api/quotation-invoices");
    expect(response.status).toBe(200);
    expect(response.body[0].opportunityNames).toEqual(["Proyecto principal", "Otra oportunidad"]);
    expect(query.mock.calls.some(([sql]) => sql.includes("MODIFY invoice_number"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql.includes("ADD COLUMN exchange_rate"))).toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE q.id IN (?, ?, ?, ?)"), [1, 2, 3, 99],
    );
  });

  it("persists original money and converts using the selected rate without changing items or totals", async () => {
    quotationOverrides[1] = { currency_code: "MXN" };
    const created = await request(app()).post("/api/quotation-invoices").send(payload(3, {
      documentType: "preinvoice", currencyCode: "MXN", exchangeRate: 20,
      exchangeRateSource: "suggested", exchangeRateDate: "2026-11-05",
      subtotal: 999, totalAmount: 999, totalUsd: 999,
    }));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      currencyCode: "MXN", exchangeRate: 20, exchangeRateSource: "suggested",
      exchangeRateDate: "2026-11-05", subtotal: 36, ivaAmount: 5.76,
      totalAmount: 41.76, totalUsd: 2.09,
    });
    const beforeItems = invoices[0].quotation_items_json;
    const converted = await request(app()).post("/api/quotation-invoices/1/convert").send({
      invoiceDate: "2026-11-06", exchangeRate: 24, exchangeRateSource: "manual",
    });
    expect(converted.status).toBe(200);
    expect(converted.body).toMatchObject({
      id: "1", currencyCode: "MXN", exchangeRate: 24, exchangeRateSource: "manual",
      exchangeRateDate: null, subtotal: 36, ivaAmount: 5.76, totalAmount: 41.76, totalUsd: 1.74,
    });
    expect(invoices[0].quotation_items_json).toBe(beforeItems);
    quotationOverrides[1] = { currency_code: "EUR" };
    const list = await request(app()).get("/api/quotation-invoices");
    expect(list.body[0]).toMatchObject({ currencyCode: "MXN", totalAmount: 41.76, exchangeRate: 24, totalUsd: 1.74 });
  });

  it("keeps the saved rate on conversion when no new rate is provided", async () => {
    quotationOverrides[1] = { currency_code: "MXN" };
    await request(app()).post("/api/quotation-invoices").send(payload(2, {
      documentType: "preinvoice", exchangeRate: 20, exchangeRateSource: "suggested",
      exchangeRateDate: "2026-11-05",
    }));
    const response = await request(app()).post("/api/quotation-invoices/1/convert").send({ invoiceDate: "2026-11-06" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ exchangeRate: 20, exchangeRateSource: "suggested", exchangeRateDate: "2026-11-05", totalUsd: 1.39 });
  });

  it("preserves the original currency when related quotation currencies change later", async () => {
    quotationOverrides[1] = { currency_code: "MXN" };
    quotationOverrides[2] = { currency_code: "MXN" };
    const input = payload(2, { documentType: "preinvoice", exchangeRate: 20, quotationIds: [1, 2] });
    input.quotationItems.push({ quotationId: 2, items: [{ productId: 10, quantity: 2, unitCostWithDiscount: 12 }] });
    expect((await request(app()).post("/api/quotation-invoices").send(input)).status).toBe(201);
    quotationOverrides[1] = { currency_code: "EUR" };
    quotationOverrides[2] = { currency_code: "USD" };
    const response = await request(app()).post("/api/quotation-invoices/1/convert").send({ invoiceDate: "2026-11-06" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ currencyCode: "MXN", exchangeRate: 20, totalAmount: 55.68, totalUsd: 2.78 });
  });

  it("does not invent monetary snapshots for historical documents", async () => {
    invoices.push({ id: 5, invoice_number: "AQ-2026-7", quotation_items_json: "[]", created_by_user_id: 1 });
    const response = await request(app()).get("/api/quotation-invoices");
    expect(response.body[0]).toMatchObject({ currencyCode: null, exchangeRate: null, totalAmount: null, totalUsd: null });
  });

  it.each([null, "", 0, -1, "invalid", 0.123456789, 1e12, true])("rejects invalid MXN exchange rate %s", async (exchangeRate) => {
    quotationOverrides[1] = { currency_code: "MXN" };
    const response = await request(app()).post("/api/quotation-invoices").send(payload(2, { exchangeRate }));
    expect(response.status).toBe(400);
    expect(invoices).toHaveLength(0);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects USD rates other than one, currency mismatch and invalid rate metadata", async () => {
    for (const extra of [
      { exchangeRate: 20 }, { currencyCode: "MXN", exchangeRate: 1 },
      { exchangeRate: 1, exchangeRateSource: "unknown" },
      { exchangeRate: 1, exchangeRateSource: "suggested", exchangeRateDate: "2026-02-30" },
    ]) {
      expect((await request(app()).post("/api/quotation-invoices").send(payload(2, extra))).status).toBe(400);
    }
    expect(invoices).toHaveLength(0);
  });

  it("rolls back conversion with an invalid rate without releasing its reservation or allocating a number", async () => {
    quotationOverrides[1] = { currency_code: "MXN" };
    await request(app()).post("/api/quotation-invoices").send(payload(3, { documentType: "preinvoice", exchangeRate: 20 }));
    const invalid = await request(app()).post("/api/quotation-invoices/1/convert").send({ invoiceDate: "2026-11-06", exchangeRate: 0 });
    expect(invalid.status).toBe(400);
    expect(invoices[0]).toMatchObject({ document_type: "preinvoice", invoice_number: null, exchange_rate: 20 });
    expect(sequences.size).toBe(0);
    expect((await request(app()).post("/api/quotation-invoices").send(payload(3, { exchangeRate: 20 }))).status).toBe(409);
  });

  it("rounds subtotal, tax and USD total to cents on the server", async () => {
    quotationOverrides[1] = { currency_code: "MXN" };
    const input = payload(1, { exchangeRate: 3 });
    input.quotationItems[0].items[0].unitCostWithDiscount = 10.015;
    const response = await request(app()).post("/api/quotation-invoices").send(input);
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ subtotal: 10.02, ivaAmount: 1.6, totalAmount: 11.62, totalUsd: 3.87 });
  });

  it("allows operational users to query a USD-based reference rate without quotation permissions", async () => {
    getExchangeRate.mockResolvedValue({ baseCurrency: "USD", targetCurrency: "MXN", exchangeRate: 20, rateDate: "2026-11-05" });
    const response = await request(app()).get("/api/quotation-invoices/exchange-rate?currency=MXN");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ exchangeRate: 20, rateDate: "2026-11-05" });
    expect(getExchangeRate).toHaveBeenCalledWith({ baseCurrency: "USD", targetCurrency: "MXN" });
    expect((await request(app()).get("/api/quotation-invoices/exchange-rate?currency=INVALID")).status).toBe(400);
    getExchangeRate.mockRejectedValue(new Error("provider unavailable"));
    expect((await request(app()).get("/api/quotation-invoices/exchange-rate?currency=MXN")).status).toBe(502);
  });

  it("migrates the legacy table, derives account, reserves and converts the same preinvoice", async () => {
    const created = await request(app()).post("/api/quotation-invoices")
      .send(payload(3, { accountId: null, documentType: "preinvoice", invoiceNumber: "spoof" }));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ id: "1", invoiceNumber: null, documentType: "preinvoice" });
    expect(invoices[0].account_id).toBe(7);
    const listed = await request(app(2)).get("/api/quotation-invoices");
    expect(listed.body[0]).toMatchObject({ id: "1", documentType: "preinvoice", createdByUserId: 1 });
    expect(listed.body[0].accountName).toBe("Cuenta de prueba");
    expect(query.mock.calls.find(([sql]) => sql.includes("FROM quotation_invoices qi"))[0]).toContain("account_owners ao_scope");
    expect((await request(app(2)).post("/api/quotation-invoices").send(payload(3))).status).toBe(409);
    expect((await request(app(2)).post("/api/quotation-invoices/1/convert").send({ invoiceDate: "2027-01-02" })).status).toBe(403);
    quotationOverrides[1] = { inaccessible: true };
    expect((await request(app()).post("/api/quotation-invoices/1/convert").send({ invoiceDate: "2027-01-02" })).status).toBe(404);
    quotationOverrides[1] = {};
    const converted = await request(app()).post("/api/quotation-invoices/1/convert").send({ invoiceDate: "2027-01-02" });
    expect(converted.body).toMatchObject({ id: "1", invoiceNumber: "AQ-2027-1", documentType: "invoice" });
    expect((await request(app()).post("/api/quotation-invoices/1/convert").send({ invoiceDate: "2027-01-02" })).status).toBe(409);
    expect((await request(app()).post("/api/quotation-invoices").send(payload(3))).status).toBe(409);
    const listedConverted = await request(app()).get("/api/quotation-invoices");
    expect(listedConverted.body[0]).toMatchObject({ convertedAt: "2026-11-06", convertedByUserId: 1 });
    expect(logAuditEvent.mock.calls.map(([args]) => args.action)).toEqual([
      "quotation_invoice_created", "quotation_preinvoice_converted",
    ]);
  });

  it("releases deleted reservations and never reuses a deleted number", async () => {
    const first = await request(app()).post("/api/quotation-invoices").send(payload(5, { invoiceNumber: "evil" }));
    expect(first.body.invoiceNumber).toBe("AQ-2026-1");
    expect((await request(app(2)).delete("/api/quotation-invoices/1")).status).toBe(403);
    expect((await request(app()).delete("/api/quotation-invoices/1")).status).toBe(200);
    expect((await request(app()).post("/api/quotation-invoices").send(payload(5))).body.invoiceNumber).toBe("AQ-2026-2");
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "quotation_invoice_deleted", required: true }));
  });

  it("releases a deleted preinvoice and starts after legacy invoice numbers", async () => {
    invoices.push({
      id: nextId++, invoice_number: "AQ-2026-7", document_type: "invoice",
      quotation_items_json: "[]", created_by_user_id: 1,
    });
    const preinvoice = await request(app()).post("/api/quotation-invoices")
      .send(payload(5, { documentType: "preinvoice" }));
    expect(preinvoice.body.invoiceNumber).toBeNull();
    expect((await request(app()).delete(`/api/quotation-invoices/${preinvoice.body.id}`)).status).toBe(200);
    expect((await request(app()).post("/api/quotation-invoices").send(payload(5))).body.invoiceNumber).toBe("AQ-2026-8");
  });

  it("preserves the sequence when the last legacy invoice is deleted before first allocation", async () => {
    invoices.push({
      id: nextId++, invoice_number: "AQ-2026-17", document_type: "invoice",
      quotation_items_json: "[]", created_by_user_id: 1,
    });
    expect((await request(app()).delete("/api/quotation-invoices/1")).status).toBe(200);
    expect((await request(app()).post("/api/quotation-invoices").send(payload())).body.invoiceNumber).toBe("AQ-2026-18");
  });

  it("serializes concurrent reservations and sums duplicate lines", async () => {
    const duplicate = payload(2, { documentType: "preinvoice" });
    duplicate.quotationItems[0].items.push({
      lineId: "q1-p10-r1-dup-123", duplicateOfLineId: "q1-p10-r1",
      quantity: 2, unitCostWithDiscount: 12,
    });
    const responses = await Promise.all([
      request(app()).post("/api/quotation-invoices").send(duplicate),
      request(app(2)).post("/api/quotation-invoices").send(payload(2)),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
  });

  it("rejects inaccessible, nonaccepted, inconsistent and malformed quotations", async () => {
    quotationOverrides[1] = { inaccessible: true };
    expect((await request(app()).post("/api/quotation-invoices").send(payload())).status).toBe(404);
    quotationOverrides[1] = { status_code: "enviada" };
    expect((await request(app()).post("/api/quotation-invoices").send(payload())).status).toBe(400);
    quotationOverrides[1] = {};
    quotationOverrides[2] = { currency_code: "MXN" };
    expect((await request(app()).post("/api/quotation-invoices").send(payload(1, { quotationIds: [1, 2] }))).status).toBe(400);
    quotationOverrides[2] = { account_id: 8 };
    expect((await request(app()).post("/api/quotation-invoices").send(payload(1, { quotationIds: [1, 2] }))).status).toBe(400);
    expect((await request(app()).post("/api/quotation-invoices").send(payload(1, { invoiceDate: "2026-02-30" }))).status).toBe(400);
    expect((await request(app()).post("/api/quotation-invoices").send(payload(-1))).status).toBe(400);
    expect((await request(app()).post("/api/quotation-invoices").send(payload(1, { quotationItems: [null] }))).status).toBe(400);
    const invalid = payload();
    invalid.quotationItems[0].items[0].productId = 999;
    expect((await request(app()).post("/api/quotation-invoices").send(invalid)).status).toBe(400);
  });

  it("rolls back creation when required audit fails", async () => {
    logAuditEvent.mockRejectedValueOnce(new Error("audit unavailable"));
    expect((await request(app()).post("/api/quotation-invoices").send(payload())).status).toBe(500);
    expect(invoices).toHaveLength(0);
    expect((await request(app()).post("/api/quotation-invoices").send(payload())).body.invoiceNumber).toBe("AQ-2026-1");
  });
});
