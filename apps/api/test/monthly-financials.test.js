import express from "express";
import mysql from "mysql2/promise";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db.js", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("../src/audit.js", () => ({ logAuditEvent: vi.fn(async () => 1) }));
import { config } from "../src/config.js";
import { query, withTransaction } from "../src/db.js";
import { logAuditEvent } from "../src/audit.js";
import router, { ensureMonthlyFinancialSchema, monthlyFinancialSchema } from "../src/monthly-financials.js";
import { MONTHLY_FINANCIAL_FIELDS, monthlyFinancialTotals } from "../../../shared/monthly-financials.js";

let connection;
const body = (changes = {}) => ({
  ...Object.fromEntries(MONTHLY_FINANCIAL_FIELDS.map((key) => [key, null])),
  currencyCode: "MXN", version: 0, ...changes,
});
function app(permissions = ["informacion_financiera.update"]) {
  const instance = express();
  instance.use(express.json(), (req, _res, next) => {
    req.user = { id: 1, permissionSet: new Set(permissions) }; next();
  });
  instance.use("/api/monthly-financials", router);
  instance.use((error, _req, res, _next) => {
    res.status(error.status || 500).json({ message: error.message });
  });
  return instance;
}
const url = "/api/monthly-financials/2026/6";

beforeAll(async () => {
  connection = await mysql.createConnection({ ...config.db, decimalNumbers: true });
  await connection.query("CREATE TEMPORARY TABLE currencies (code CHAR(3), name VARCHAR(50), is_active TINYINT)");
  await connection.query("INSERT INTO currencies VALUES ('MXN','Peso mexicano',1),('USD','Dólar',1),('EUR','Euro',0)");
  await connection.query("CREATE TEMPORARY TABLE users (id BIGINT, full_name VARCHAR(50))");
  await connection.query("INSERT INTO users VALUES (1,'Editora de finanzas')");
  query.mockImplementation(async (sql, params) => {
    const isolatedSql = sql.replace("CREATE TABLE IF NOT EXISTS", "CREATE TEMPORARY TABLE IF NOT EXISTS");
    return (await connection.query(isolatedSql, params))[0];
  });
  withTransaction.mockImplementation(async (work) => {
    await connection.beginTransaction();
    try {
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  });
  await ensureMonthlyFinancialSchema();
});
beforeEach(async () => {
  await connection.query("DELETE FROM monthly_financials");
  logAuditEvent.mockClear();
});
afterAll(async () => { await connection?.end(); });

const yearUrl = "/api/monthly-financials/2026";
const monthItem = (month, changes = {}) => ({ month, ...body(), ...changes });

describe("Información financiera anual", () => {
  it("consulta un año sin registros como lista vacía", async () => {
    const response = await request(app(["informacion_financiera.read"])).get(yearUrl);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ year: 2026, records: [] });
  });
  it("guarda varios meses en una operación, omite meses nuevos vacíos y audita cada mes", async () => {
    const response = await request(app()).put(yearUrl).send({ months: [
      monthItem(3, { purchases: "30" }), monthItem(1, { purchases: "10", isrPct: "30" }), monthItem(2),
    ] });
    expect(response.status).toBe(200);
    expect(response.body.records.map((record) => [record.month, record.purchases, record.version])).toEqual([[1, "10.00", 1], [3, "30.00", 1]]);
    expect(logAuditEvent.mock.calls.map(([event]) => event.after.month)).toEqual([1, 3]);
    expect(logAuditEvent.mock.calls.every(([event]) => event.action === "created" && event.connection === connection)).toBe(true);
    expect((await request(app()).get(yearUrl)).body.records).toHaveLength(2);
  });
  it("actualiza solo los meses recibidos sin cambiar la versión de los demás", async () => {
    await request(app()).put(yearUrl).send({ months: [monthItem(1, { purchases: "10" }), monthItem(2, { purchases: "20" })] });
    const response = await request(app()).put(yearUrl).send({ months: [monthItem(2, { version: 1, purchases: null, salesReturns: "5" })] });
    expect(response.body.records.map((record) => [record.month, record.version, record.purchases])).toEqual([[1, 1, "10.00"], [2, 2, null]]);
    expect(logAuditEvent).toHaveBeenLastCalledWith(expect.objectContaining({ action: "updated", before: expect.objectContaining({ month: 2, purchases: "20.00" }) }));
  });
  it("rechaza todo el guardado si un mes está en conflicto y devuelve su versión actual", async () => {
    await request(app()).put(yearUrl).send({ months: [monthItem(2, { purchases: "20" })] });
    logAuditEvent.mockClear();
    const response = await request(app()).put(yearUrl).send({ months: [monthItem(1, { purchases: "1" }), monthItem(2, { purchases: "2" })] });
    expect(response.status).toBe(409);
    expect(response.body.conflicts).toEqual([expect.objectContaining({ month: 2, record: expect.objectContaining({ purchases: "20.00", version: 1 }) })]);
    expect((await request(app()).get(yearUrl)).body.records.map((record) => record.month)).toEqual([2]);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
  it("revierte todos los meses si falla la auditoría de uno", async () => {
    logAuditEvent.mockResolvedValueOnce(1).mockRejectedValueOnce(new Error("Audit unavailable"));
    expect((await request(app()).put(yearUrl).send({ months: [monthItem(1, { purchases: "1" }), monthItem(2, { purchases: "2" })] })).status).toBe(500);
    expect((await request(app()).get(yearUrl)).body.records).toEqual([]);
  });
  it("rechaza una moneda inactiva sin guardar ningún mes", async () => {
    const response = await request(app()).put(yearUrl).send({ months: [monthItem(1, { purchases: "1" }), monthItem(2, { purchases: "2", currencyCode: "EUR" })] });
    expect(response.status).toBe(400);
    expect((await request(app()).get(yearUrl)).body.records).toEqual([]);
  });
  it.each([
    ["meses repetidos", { months: [monthItem(1), monthItem(1)] }],
    ["más de doce meses", { months: Array.from({ length: 13 }, (_, index) => monthItem((index % 12) + 1)) }],
    ["mes inválido", { months: [monthItem(13)] }],
    ["lista vacía", { months: [] }],
    ["propiedades desconocidas", { months: [monthItem(1)], extra: true }],
    ["importe inválido", { months: [monthItem(1, { purchases: "-1" })] }],
  ])("valida el guardado anual: %s", async (_name, payload) => {
    expect((await request(app()).put(yearUrl).send(payload)).status).toBe(400);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
  it("valida el año y los permisos del guardado anual", async () => {
    expect((await request(app()).get("/api/monthly-financials/1899")).status).toBe(400);
    expect((await request(app()).put("/api/monthly-financials/x").send({ months: [monthItem(1)] })).status).toBe(400);
    expect((await request(app(["informacion_financiera.read"])).put(yearUrl).send({ months: [monthItem(1)] })).status).toBe(403);
    expect((await request(app(["configuracion.read"])).get(yearUrl)).status).toBe(403);
  });
});

describe("Información financiera mensual", () => {
  it("distingue un mes inexistente de un fallo o un registro con ceros", async () => {
    const response = await request(app()).get(url);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ record: null });
  });
  it("guarda parcialmente sin convertir vacíos a cero, calcula subtotales y audita", async () => {
    const response = await request(app()).put(url).send(body({ purchases: "0", sellingExpenses: "1000.10", administrativeExpenses: "0.20" }));
    expect(response.status).toBe(200);
    expect(response.body.record).toMatchObject({
      purchases: "0.00", salesDiscounts: null, version: 1, updatedByName: "Editora de finanzas",
      totals: { generalExpenses: { amount: 1000.3, pending: 2 } },
    });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "created", before: null, after: expect.objectContaining({ year: 2026, month: 6, version: 1 }),
      connection, required: true,
    }));
    const stored = await request(app()).get(url);
    expect(stored.body.record.purchases).toBe("0.00");
  });
  it("actualiza meses antiguos, conserva null y registra antes/después", async () => {
    const oldUrl = "/api/monthly-financials/2020/1";
    await request(app()).put(oldUrl).send(body({ purchases: "12.34" }));
    const result = await request(app()).put(oldUrl).send(body({ version: 1, purchases: null, isrPct: "30", ptuPct: "10" }));
    expect(result.status).toBe(200);
    expect(result.body.record).toMatchObject({ version: 2, purchases: null, isrPct: "30.00", ptuPct: "10.00" });
    expect(logAuditEvent).toHaveBeenLastCalledWith(expect.objectContaining({
      action: "updated", before: expect.objectContaining({ purchases: "12.34", version: 1 }),
      after: expect.objectContaining({ purchases: null, version: 2 }),
    }));
  });
  it("rechaza dos editores con la misma revisión y creaciones duplicadas sin sobrescribir", async () => {
    expect((await request(app()).put(url).send(body({ purchases: "10" }))).status).toBe(200);
    expect((await request(app()).put(url).send(body({ purchases: "20" }))).status).toBe(409);
    expect((await request(app()).put(url).send(body({ version: 1, purchases: "30" }))).status).toBe(200);
    expect((await request(app()).put(url).send(body({ version: 1, purchases: "40" }))).status).toBe(409);
    expect((await request(app()).get(url)).body.record.purchases).toBe("30.00");
    expect(logAuditEvent).toHaveBeenCalledTimes(2);
    const [rows] = await connection.query("SELECT COUNT(*) AS count FROM monthly_financials");
    expect(rows[0].count).toBe(1);
    await expect(connection.query(`INSERT INTO monthly_financials
      (year, month, currency_code, updated_by_user_id, updated_at)
      VALUES (2026, 6, 'MXN', 1, NOW())`)).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
  });
  it("revierte la escritura si no puede auditarla", async () => {
    logAuditEvent.mockRejectedValueOnce(new Error("Audit unavailable"));
    expect((await request(app()).put(url).send(body({ purchases: "10" }))).status).toBe(500);
    expect((await request(app()).get(url)).body.record).toBeNull();
  });
  it.each(["EUR", "ZZZ"])("rechaza la moneda inactiva o desconocida %s", async (currencyCode) => {
    expect((await request(app()).put(url).send(body({ currencyCode }))).status).toBe(400);
    expect((await request(app()).get(url)).body.record).toBeNull();
  });
  it("sirve catálogos con permiso independiente sin permisos de configuración", async () => {
    const response = await request(app(["informacion_financiera.read"])).get("/api/monthly-financials/currencies");
    expect(response.status).toBe(200);
    expect(response.body.map((item) => item.code).sort()).toEqual(["MXN", "USD"]);
  });
  it.each(["informacion_financiera.read", "informacion_financiera.update"])("permite consulta con %s", async (permission) => {
    expect((await request(app([permission])).get(url)).status).toBe(200);
  });
  it.each([[], ["configuracion.read"], ["aceptar_pedido.procesamiento.update"]].map((permissions) => ({ permissions })))("deniega acceso sin permisos específicos $permissions", async ({ permissions }) => {
    expect((await request(app(permissions)).get(url)).status).toBe(403);
    expect((await request(app(permissions)).get("/api/monthly-financials/currencies")).status).toBe(403);
    expect((await request(app(permissions)).put(url).send(body())).status).toBe(403);
  });
  it("consulta no permite escribir", async () => {
    expect((await request(app(["informacion_financiera.read"])).put(url).send(body())).status).toBe(403);
  });
  it.each(["2026/0", "2026/13", "1899/1", "2101/1", "x/2", "2026/1.5"])("valida el periodo %s", async (period) => {
    expect((await request(app()).get(`/api/monthly-financials/${period}`)).status).toBe(400);
    expect((await request(app()).put(`/api/monthly-financials/${period}`).send(body())).status).toBe(400);
  });
  it.each([
    { purchases: "-1" }, { purchases: "1.001" }, { purchases: "1000000000000" },
    { purchases: 1 }, { purchases: "" }, { purchases: "1,000" }, { purchases: "1e2" },
    { isrPct: "100.01" }, { ptuPct: "-1" }, { version: -1 }, { version: "0" },
    { currencyCode: "mxn" }, { unknown: "1" },
  ])("valida los datos %j", async (changes) => {
    const result = await request(app()).put(url).send(body(changes));
    expect(result.status).toBe(400);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
  it("exige un documento completo para no borrar conceptos omitidos accidentalmente", () => {
    expect(monthlyFinancialSchema.safeParse({ currencyCode: "MXN", version: 0 }).success).toBe(false);
    expect(monthlyFinancialSchema.safeParse(body({ isrPct: "100", ptuPct: "0" })).success).toBe(true);
  });
  it("totales completos, parciales y totalmente pendientes conservan centavos exactos", () => {
    expect(monthlyFinancialTotals(body()).generalExpenses).toEqual({ amount: 0, pending: 4 });
    const totals = monthlyFinancialTotals(body({
      sellingExpenses: "0.10", administrativeExpenses: "0.20", depreciation: "0", amortization: "0",
      financialIncome: "12.34", otherIncome: "0.66", financialExpenses: "2.50", otherExpenses: "0",
    }));
    expect(totals).toEqual({
      generalExpenses: { amount: 0.3, pending: 0 }, otherIncome: { amount: 13, pending: 0 }, otherExpenses: { amount: 2.5, pending: 0 },
    });
  });
});
