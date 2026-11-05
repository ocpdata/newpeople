import express from "express";
import mysql from "mysql2/promise";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/db.js", () => {
  const query = vi.fn();
  return {
    query,
    withTransaction: (work) => work({ query: async (...args) => [await query(...args)] }),
  };
});
vi.mock("../src/quotation-won-documents-schema.js", () => ({
  ensureQuotationWonDocumentsSchema: vi.fn(),
}));

import { config } from "../src/config.js";
import { query } from "../src/db.js";
import reportRoutes from "../src/routes.reports.js";
import {
  getReportCatalogs,
  listOpportunitiesQuotationsReport,
  reportFiltersSchema,
} from "../src/reports/opportunities-quotations.js";

let connection;
let fixtureTableNames = [];
let fixtureCtes = [];
async function refreshFixtures() {
  fixtureCtes = [];
  for (const name of fixtureTableNames) {
    const [rows] = await connection.query(`SELECT * FROM ${name}`);
    const selects = rows.map((row) => `SELECT ${Object.entries(row)
      .map(([column, value]) => `${connection.escape(value)} AS \`${column}\``).join(", ")}`);
    fixtureCtes.push(`${name} AS (${selects.join(" UNION ALL ")})`);
  }
}
const user = (permissions = ["oportunidades.read", "cotizaciones.operacion"]) => ({
  id: 19, permissionSet: new Set(permissions),
});
const report = (filters = {}, currentUser = user()) =>
  listOpportunitiesQuotationsReport(currentUser, reportFiltersSchema.parse(filters));

beforeAll(async () => {
  connection = await mysql.createConnection(config.db);
  await connection.query("SET SESSION max_execution_time = 2000");
  // Temporary fixtures shadow real tables and disappear with this connection.
  const tables = {
    accounts: "id INT PRIMARY KEY, name VARCHAR(100)",
    users: "id INT PRIMARY KEY, full_name VARCHAR(100)",
    account_owners: "account_id INT, user_id INT",
    opportunity_sales_stages: "id INT PRIMARY KEY, name VARCHAR(100)",
    opportunity_commercial_statuses: "id INT PRIMARY KEY, code VARCHAR(30), name VARCHAR(100)",
    opportunity_activation_statuses: "id INT PRIMARY KEY, code VARCHAR(30), name VARCHAR(100)",
    quotation_statuses: "id INT PRIMARY KEY, code VARCHAR(30), name VARCHAR(100)",
    quotation_activation_statuses: "id INT PRIMARY KEY, code VARCHAR(30), name VARCHAR(100)",
    opportunities: `id INT PRIMARY KEY, name VARCHAR(100), account_id INT,
      amount_usd DECIMAL(12,2), close_date DATE, commercial_closed_at DATETIME,
      seller_user_id INT, presales_user_id INT, sales_stage_id INT,
      commercial_status_id INT, activation_status_id INT`,
    quotations: "id INT PRIMARY KEY, opportunity_id INT, latest_version_id INT, activation_status_id INT",
    quotation_versions: `id INT PRIMARY KEY, quotation_id INT, version_number INT,
      proposal_name VARCHAR(100), quotation_date DATE, currency_code VARCHAR(10), exchange_rate DECIMAL(15,4),
      status_id INT, summary_discount_mode VARCHAR(30), summary_discount_value DECIMAL(12,2),
      summary_distribution_mode VARCHAR(30), summary_vat_mode VARCHAR(30), summary_vat_pct DECIMAL(6,2)`,
    quotation_sections: "id INT PRIMARY KEY, quotation_version_id INT",
    documents: "id INT PRIMARY KEY, original_file_name VARCHAR(100), is_deleted INT",
    quotation_won_documents: `id INT PRIMARY KEY, quotation_version_id INT, document_id INT,
      document_source VARCHAR(40), document_role VARCHAR(40), purchase_order_amount DECIMAL(15,2),
      purchase_order_currency CHAR(3), created_at DATETIME`,
    quotation_section_items: `id INT PRIMARY KEY, quotation_section_id INT, quantity DECIMAL(12,2),
      list_price_unit DECIMAL(12,2), manufacturer_discount_pct DECIMAL(6,2),
      import_cost_pct DECIMAL(6,2), profit_margin_pct DECIMAL(6,2),
      final_discount_pct DECIMAL(6,2), item_type VARCHAR(30), bundle_parent_item_id INT`,
  };
  for (const [name, columns] of Object.entries(tables)) {
    await connection.query(`CREATE TEMPORARY TABLE ${name} (${columns})`);
  }
  await connection.query("INSERT INTO accounts VALUES (1, 'Visible'), (2, 'Ajena')");
  await connection.query("INSERT INTO users VALUES (19, 'Vendedor'), (20, 'Preventa')");
  await connection.query("INSERT INTO account_owners VALUES (1, 19)");
  await connection.query("INSERT INTO opportunity_sales_stages VALUES (1, 'Waiting')");
  await connection.query("INSERT INTO opportunity_commercial_statuses VALUES (1, 'en_proceso', 'En proceso'), (2, 'ganada', 'Ganada'), (3, 'anulada', 'Anulada')");
  await connection.query("INSERT INTO opportunity_activation_statuses VALUES (1, 'activada', 'Activada'), (2, 'desactivada', 'Desactivada')");
  await connection.query("INSERT INTO quotation_statuses VALUES (1, 'aceptada', 'Aceptada'), (2, 'ganada', 'Ganada'), (3, 'borrador', 'Borrador'), (4, 'anulada', 'Anulada')");
  await connection.query("INSERT INTO quotation_activation_statuses VALUES (1, 'activada', 'Activada'), (2, 'desactivada', 'Desactivada')");
  for (let id = 1; id <= 6; id += 1) {
    await connection.query(`INSERT INTO opportunities VALUES
      (?, ?, ?, ?, '2026-11-15', ?, 19, 20, 1, ?, 1)`, [
      id, `Oportunidad ${id}`, id === 6 ? 2 : 1, id * 100,
      [1, 3, 4, 6].includes(id) ? "2026-11-03 23:59:59" : null,
      [1, 3, 4, 6].includes(id) ? 2 : 1,
    ]);
  }
  const quotations = [
    [201, 2, 2011, 1, 1, "MXN", 200],
    [301, 3, 3011, 1, 1, "USD", 100],
    [302, 3, 3021, 2, 3, "USD", 50],
    [401, 4, 4011, 1, 2, "USD", 100],
    [501, 5, 5012, 1, 3, "USD", 100],
    [601, 6, 6011, 1, 1, "USD", 100],
  ];
  for (const [id, opportunityId, versionId, activation, status, currency, amount] of quotations) {
    await connection.query("INSERT INTO quotations VALUES (?, ?, ?, ?)", [id, opportunityId, versionId, activation]);
    await connection.query(`INSERT INTO quotation_versions VALUES
      (?, ?, ?, ?, '2026-11-02', ?, ?, ?, 'percentage', 10, 'total', 'total', 16)`, [
      versionId, id, id === 501 ? 2 : 1, `Cotización ${id}`, currency, currency === "MXN" ? 20 : 1, status,
    ]);
    await connection.query("INSERT INTO quotation_sections VALUES (?, ?)", [versionId, versionId]);
    await connection.query("INSERT INTO quotation_section_items VALUES (?, ?, 1, ?, 0, 0, 0, 0, 'producto', NULL)", [versionId, versionId, amount]);
  }
  await connection.query(`INSERT INTO quotation_versions VALUES
    (5011, 501, 1, 'Histórica aceptada', '2026-10-01', 'USD', 1, 1, 'percentage', 0, 'total', 'total', 16)`);
  await connection.query(`INSERT INTO documents VALUES
    (1, 'orden-usd.pdf', 0), (2, 'orden-mxn.pdf', 0), (3, 'orden-sin-valor.pdf', 0),
    (4, 'eliminada.pdf', 1), (5, 'proveedor.pdf', 0),
    (6, 'historica.pdf', 0), (7, 'cuenta-ajena.pdf', 0)`);
  await connection.query(`INSERT INTO quotation_won_documents VALUES
    (1, 3011, 1, 'quotation', 'purchase_order', 1500, 'USD', '2026-11-03'),
    (2, 3011, 2, 'opportunity', 'purchase_order', 3000, 'MXN', '2026-11-03'),
    (3, 3021, 3, 'quotation', 'purchase_order', NULL, NULL, '2026-11-03'),
    (4, 3011, 4, 'quotation', 'purchase_order', 999, 'USD', '2026-11-03'),
    (5, 3011, 5, 'quotation', 'provider_quote', 888, 'USD', '2026-11-03'),
    (6, 5011, 6, 'quotation', 'purchase_order', 777, 'USD', '2026-11-03'),
    (7, 6011, 7, 'quotation', 'purchase_order', 666, 'USD', '2026-11-03')`);
  // CTE fixtures allow repeated references, which MySQL temporary tables cannot support.
  fixtureTableNames = Object.keys(tables);
  await refreshFixtures();
  query.mockImplementation(async (sql, params) => {
    const [rows] = await connection.query(sql.replace("WITH scoped_opportunities AS",
      `WITH ${fixtureCtes.join(", ")}, scoped_opportunities AS`), params);
    return rows;
  });
}, 30000);

afterAll(async () => { await connection?.end(); });

describe("Opportunity and quotation report", () => {
  it("excludes cancelled opportunities and quotations from results, totals, presence and catalogs", async () => {
    try {
      await connection.query("UPDATE opportunities SET commercial_status_id = 3 WHERE id = 6");
      await connection.query("UPDATE quotation_versions SET status_id = 4 WHERE id IN (3011, 5012)");
      await refreshFixtures();
      const currentUser = user(["oportunidades.read_all", "cotizaciones.administracion"]);
      const result = await report({}, currentUser);
      expect(result.items.map((item) => item.id)).toEqual([5, 4, 3, 2, 1]);
      expect(result.items.find((item) => item.id === 5).quotations).toEqual([]);
      expect(result.items.find((item) => item.id === 3).quotations.map((item) => item.id)).toEqual([302]);
      expect(result.items.flatMap((item) => item.quotations).flatMap((item) => item.purchaseOrders)
        .map((item) => item.documentId)).toEqual([3]);
      expect(result.summary).toMatchObject({
        opportunityCount: 5, opportunityAmountUsd: 1500, quotationCount: 3, acceptedCount: 1,
      });
      expect(result.summary.currencies.find((item) => item.currency === "USD").amount).toBeCloseTo(156.6);
      expect((await report({ quotationPresence: "without" }, currentUser)).items.map((item) => item.id)).toEqual([5, 1]);
      expect((await report({ preset: "accepted" }, currentUser)).items.map((item) => item.id)).toEqual([2]);
      expect((await getReportCatalogs(currentUser)).accounts).toEqual([{ id: 1, name: "Visible" }]);
    } finally {
      await connection.query("UPDATE opportunities SET commercial_status_id = 2 WHERE id = 6");
      await connection.query("UPDATE quotation_versions SET status_id = 1 WHERE id = 3011");
      await connection.query("UPDATE quotation_versions SET status_id = 3 WHERE id = 5012");
      await refreshFixtures();
    }
  });
  it.each([
    ["all", [5, 4, 3, 2, 1]],
    ["won", [4, 3, 1]],
    ["accepted", [3, 2]],
    ["both", [3]],
    ["either", [4, 3, 2, 1]],
    ["won_without_accepted", [4, 1]],
    ["accepted_not_won", [2]],
  ])("selects %s without duplicate opportunities", async (preset, ids) => {
    const result = await report({ preset });
    expect(result.items.map((item) => item.id)).toEqual(ids);
    expect(result.total).toBe(ids.length);
  });

  it("uses only the current version and keeps won quotations distinct from accepted", async () => {
    const result = await report();
    expect(result.summary).toMatchObject({
      opportunityCount: 5, wonCount: 3, opportunityAmountUsd: 1500,
      quotationCount: 5, acceptedCount: 2,
    });
    expect(result.items.find((item) => item.id === 5).quotations[0]).toMatchObject({
      id: 501, versionNumber: 2, statusCode: "borrador",
    });
    expect((await report({ quotationStatuses: "ganada" })).items.map((item) => item.id)).toEqual([4]);
    expect((await report({ quotationPresence: "without" })).items.map((item) => item.id)).toEqual([1]);
  });

  it("returns context quotations and highlights only matching quotations", async () => {
    const result = await report({ preset: "both" });
    expect(result.items[0].quotations).toEqual([
      expect.objectContaining({ id: 302, matchesFilters: false }),
      expect.objectContaining({ id: 301, matchesFilters: true }),
    ]);
    expect(result.summary).toMatchObject({ quotationCount: 2, acceptedCount: 1, matchingCount: 1 });
    expect(result.summary.currencies[0].amount).toBeCloseTo(156.6);
    expect(result.summary.currencies[0].matchingAmount).toBeCloseTo(104.4);
    expect(result.summary.quotedUsd).toMatchObject({ missingCount: 0, matchingMissingCount: 0 });
    expect(result.summary.quotedUsd.amount).toBeCloseTo(156.6);
    expect(result.summary.quotedUsd.matchingAmount).toBeCloseTo(104.4);
    expect((await report({ preset: "both", quotationStatuses: "borrador" })).total).toBe(0);
  });

  it("returns each current quotation's orders without combining currencies or including deleted, historical or unauthorized files", async () => {
    const result = await report();
    const quotations = result.items.flatMap((item) => item.quotations);
    expect(quotations.find((item) => item.id === 301).purchaseOrders).toEqual([
      { documentId: 1, source: "quotation", originalFileName: "orden-usd.pdf", amount: 1500, currencyCode: "USD" },
      { documentId: 2, source: "opportunity", originalFileName: "orden-mxn.pdf", amount: 3000, currencyCode: "MXN" },
    ]);
    expect(quotations.find((item) => item.id === 302).purchaseOrders).toEqual([
      { documentId: 3, source: "quotation", originalFileName: "orden-sin-valor.pdf", amount: null, currencyCode: null },
    ]);
    expect(quotations.find((item) => item.id === 501).purchaseOrders).toEqual([]);
    expect(quotations.flatMap((item) => item.purchaseOrders).map((item) => item.documentId)).toEqual([3, 1, 2]);
    expect(result.summary.opportunityAmountUsd).toBe(1500);
    expect(result.summary.currencies.find((item) => item.currency === "USD").amount).toBeCloseTo(365.4);
  });

  it("separates currency totals, applies the existing discount and VAT formula, and paginates opportunities", async () => {
    const result = await report();
    expect(result.summary.currencies.map((item) => item.currency)).toEqual(["MXN", "USD"]);
    expect(result.summary.currencies[0].amount).toBeCloseTo(208.8);
    expect(result.summary.currencies[0].matchingAmount).toBeCloseTo(208.8);
    expect(result.summary.currencies[1].amount).toBeCloseTo(365.4);
    expect(result.summary.quotedUsd.amount).toBeCloseTo(375.84);
    expect(result.summary.quotedUsd.matchingAmount).toBeCloseTo(375.84);
    expect(result.summary.quotedUsd.missingCount).toBe(0);
    expect(result.items.find((item) => item.id === 2).quotations[0]).toMatchObject({
      currency: "MXN", exchangeRate: 20,
    });
    const emptyPage = await report({ page: 100, sort: "name", direction: "asc" });
    expect(emptyPage.page).toBe(1);
    expect(emptyPage.items.map((item) => item.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("paginates opportunities while keeping full-result totals", async () => {
    try {
      const [[template]] = await connection.query("SELECT * FROM opportunities WHERE id = 1");
      for (let id = 100; id <= 105; id += 1) {
        await connection.query("INSERT INTO opportunities SET ?", { ...template, id });
      }
      await refreshFixtures();
      const first = await report();
      const second = await report({ page: 2 });
      expect(first.items).toHaveLength(10);
      expect(second.items.map((item) => item.id)).toEqual([1]);
      expect(first.total).toBe(11);
      expect(second.summary).toEqual(first.summary);
      expect(second.summary.opportunityAmountUsd).toBe(2100);
      expect(second.summary.quotedUsd.amount).toBeCloseTo(375.84);
    } finally {
      await connection.query("DELETE FROM opportunities WHERE id BETWEEN 100 AND 105");
      await refreshFixtures();
    }
  });

  it("converts each quotation before summing even when they share a currency", async () => {
    try {
      await connection.query("UPDATE quotation_versions SET currency_code = 'MXN', exchange_rate = 10 WHERE id = 3011");
      await refreshFixtures();
      const result = await report();
      expect(result.summary.quotedUsd.amount).toBeCloseTo(281.88);
      expect(result.summary.currencies.find((item) => item.currency === "MXN").amount).toBeCloseTo(313.2);
    } finally {
      await connection.query("UPDATE quotation_versions SET currency_code = 'USD', exchange_rate = 1 WHERE id = 3011");
      await refreshFixtures();
    }
  });

  it.each([null, 0, -2, 1])("excludes invalid non-USD rate %s and counts only matching omissions", async (rate) => {
    try {
      await connection.query("UPDATE quotation_versions SET currency_code = 'MXN', exchange_rate = ? WHERE id = 3021", [rate]);
      await refreshFixtures();
      const result = await report({ preset: "both" });
      expect(result.summary.quotedUsd).toMatchObject({ missingCount: 1, matchingMissingCount: 0 });
      expect(result.summary.quotedUsd.amount).toBeCloseTo(104.4);
      expect(result.summary.quotedUsd.matchingAmount).toBeCloseTo(104.4);
      expect(result.summary.currencies.find((item) => item.currency === "MXN").amount).toBeCloseTo(52.2);
      const matching = await report({ quotationStatuses: "borrador", search: "Oportunidad 3" });
      expect(matching.summary.quotedUsd).toMatchObject({
        matchingAmount: 0, missingCount: 1, matchingMissingCount: 1,
      });
      expect(matching.summary.quotedUsd.amount).toBeCloseTo(104.4);
    } finally {
      await connection.query("UPDATE quotation_versions SET currency_code = 'USD', exchange_rate = 1 WHERE id = 3021");
      await refreshFixtures();
    }
  });

  it("counts absent currency as unconvertible but includes USD without a rate", async () => {
    try {
      await connection.query("UPDATE quotation_versions SET currency_code = NULL WHERE id = 2011");
      await connection.query("UPDATE quotation_versions SET exchange_rate = NULL WHERE currency_code = 'USD'");
      await refreshFixtures();
      const result = await report();
      expect(result.summary.quotedUsd.amount).toBeCloseTo(365.4);
      expect(result.summary.quotedUsd.missingCount).toBe(1);
    } finally {
      await connection.query("UPDATE quotation_versions SET currency_code = 'MXN' WHERE id = 2011");
      await connection.query("UPDATE quotation_versions SET exchange_rate = 1 WHERE currency_code = 'USD'");
      await refreshFixtures();
    }
  });

  it("returns zero USD totals with no quotations", async () => {
    expect((await report({ quotationPresence: "without" })).summary.quotedUsd).toEqual({
      amount: 0, matchingAmount: 0, missingCount: 0, matchingMissingCount: 0,
    });
  });

  it("counts bundle children instead of their parent and excludes grouping items", async () => {
    try {
      await connection.query("UPDATE quotation_section_items SET list_price_unit = 999 WHERE id = 3011");
      await connection.query(`INSERT INTO quotation_section_items VALUES
        (90001, 3011, 1, 100, 0, 0, 0, 0, 'producto', 3011),
        (90002, 3011, 1, 500, 0, 0, 0, 0, 'grupo_productos', NULL)`);
      await refreshFixtures();
      const result = await report({ preset: "both" });
      expect(result.items[0].quotations.find((item) => item.id === 301).totalAmount).toBeCloseTo(104.4);
    } finally {
      await connection.query("DELETE FROM quotation_section_items WHERE id IN (90001, 90002)");
      await connection.query("UPDATE quotation_section_items SET list_price_unit = 100 WHERE id = 3011");
      await refreshFixtures();
    }
  });

  it("combines dates, activation, responsibilities and multi-state filters", async () => {
    expect((await report({
      dateType: "actual_close", dateFrom: "2026-11-03", dateTo: "2026-11-03",
      accountId: 1, sellerUserId: 19, presalesUserId: 20,
      commercialStatuses: "ganada", quotationStatuses: "aceptada,ganada",
    })).items.map((item) => item.id)).toEqual([4, 3]);
    expect((await report({
      dateType: "quotation", dateFrom: "2026-10-01", dateTo: "2026-10-01",
    })).total).toBe(0);
    const active = await report({ quotationActivation: "activada", search: "Oportunidad 3" });
    expect(active.items[0].quotations.map((item) => item.id)).toEqual([301]);
    expect((await report({ opportunityActivation: "desactivada" })).total).toBe(0);
    expect((await report({ dateFrom: "2026-12-01" })).total).toBe(0);
  });

  it.each([
    ["oportunidades.read_all", "cotizaciones.operacion"],
    ["oportunidades.read", "cotizaciones.administracion"],
  ])("intersects both account scopes: %s", async (...permissions) => {
    const result = await report({}, user(permissions));
    expect(result.total).toBe(5);
    expect(result.summary.opportunityAmountUsd).toBe(1500);
    expect((await getReportCatalogs(user(permissions))).accounts).toEqual([{ id: 1, name: "Visible" }]);
  });

  it("only grants global scope when both modules allow it", async () => {
    expect((await report({}, user(["oportunidades.read_all", "cotizaciones.administracion"]))).total).toBe(6);
  });

  it.each([
    { dateFrom: "2026-11-30", dateTo: "2026-11-01" },
    { dateFrom: "2026-02-30" }, { page: 0 }, { pageSize: 1000 },
    { sort: "id; DROP TABLE opportunities" }, { accountId: "invalid" },
    { quotationStatuses: "not_a_state" }, { unsupported: "value" },
    { quotationStatuses: "anulada" }, { commercialStatuses: "anulada" },
  ])("rejects malformed filters %j", (filters) => {
    expect(reportFiltersSchema.safeParse(filters).success).toBe(false);
  });
});

describe("Report HTTP access and validation", () => {
  const appFor = (currentUser) => {
    const app = express();
    app.use((req, _res, next) => { req.user = currentUser; next(); });
    app.use("/api/reports", reportRoutes);
    return app;
  };
  it.each([
    [], ["oportunidades.read"], ["cotizaciones.operacion"],
    ["oportunidades.read", "aceptar_pedido.procesamiento.read"],
  ].map((permissions) => ({ permissions })))("denies incomplete permissions $permissions", async ({ permissions }) => {
    const app = appFor(user(permissions));
    expect((await request(app).get("/api/reports/opportunities-quotations")).status).toBe(403);
    expect((await request(app).get("/api/reports/opportunities-quotations/catalogs")).status).toBe(403);
  });
  it("returns 400 for invalid filters and the expected response shape for valid requests", async () => {
    const app = appFor(user());
    expect((await request(app).get("/api/reports/opportunities-quotations?page=-1")).status).toBe(400);
    const response = await request(app).get("/api/reports/opportunities-quotations?preset=both");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ total: 1, page: 1, pageSize: 10, summary: { opportunityCount: 1 } });
  });
});
