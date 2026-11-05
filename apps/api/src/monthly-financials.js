import express from "express";
import { z } from "zod";
import { query, withTransaction } from "./db.js";
import { requireAnyPermission } from "./auth.js";
import { logAuditEvent } from "./audit.js";
import { MONTHLY_FINANCIAL_FIELDS, isFinancialRate, monthlyFinancialTotals } from "../../../shared/monthly-financials.js";

const readPermissions = ["informacion_financiera.read", "informacion_financiera.update"];
const amount = z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/, "Usa un importe no negativo con hasta 2 decimales");
const rate = amount.refine((value) => Number(value) <= 100, "El porcentaje debe estar entre 0 y 100");
const monthShape = {
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
  version: z.number().int().min(0).max(2147483646),
  ...Object.fromEntries(MONTHLY_FINANCIAL_FIELDS.map((key) => [key, (isFinancialRate(key) ? rate : amount).nullable()])),
};
export const monthlyFinancialSchema = z.object(monthShape).strict();
export const monthlyFinancialYearSchema = z.object({
  months: z.array(z.object({ month: z.number().int().min(1).max(12), ...monthShape }).strict()).min(1).max(12),
}).strict().refine(({ months }) => new Set(months.map((item) => item.month)).size === months.length, "Hay meses repetidos");
const periodSchema = z.object({
  year: z.coerce.number().int().min(1900).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

let schemaPromise;
export async function ensureMonthlyFinancialSchema() {
  if (!schemaPromise) {
    schemaPromise = query(`CREATE TABLE IF NOT EXISTS monthly_financials (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      year SMALLINT NOT NULL, month TINYINT NOT NULL, currency_code CHAR(3) NOT NULL,
      ${MONTHLY_FINANCIAL_FIELDS.map((key) => `\`${key}\` DECIMAL(16,2) NULL`).join(",\n")},
      version INT NOT NULL DEFAULT 1,
      updated_by_user_id BIGINT UNSIGNED NOT NULL, updated_at DATETIME(3) NOT NULL,
      UNIQUE KEY uq_monthly_financial_period (year, month)
    )`).catch((error) => { schemaPromise = undefined; throw error; });
  }
  await schemaPromise;
}

function financialValues(row) {
  return Object.fromEntries(MONTHLY_FINANCIAL_FIELDS.map((key) => [key, row[key] == null ? null : Number(row[key]).toFixed(2)]));
}

function toRecord(row) {
  if (!row) return null;
  const values = financialValues(row);
  return {
    ...values, year: Number(row.year), month: Number(row.month), currencyCode: row.currency_code,
    version: Number(row.version), updatedAt: row.updated_at, updatedByName: row.updated_by_name,
    totals: monthlyFinancialTotals(values),
  };
}

const selectYearRecords = `SELECT mf.*, u.full_name AS updated_by_name FROM monthly_financials mf
  LEFT JOIN users u ON u.id = mf.updated_by_user_id WHERE mf.year = ? ORDER BY mf.month`;

export class MonthlyFinancialConflictError extends Error {
  constructor(months) {
    super("Otra persona modificó este periodo. Revisa la versión actual antes de guardar.");
    this.status = 409;
    this.months = months;
  }
}

export async function listMonthlyFinancials(year) {
  await ensureMonthlyFinancialSchema();
  return (await query(selectYearRecords, [year])).map(toRecord);
}

export async function getMonthlyFinancials(year, month) {
  return (await listMonthlyFinancials(year)).find((record) => record.month === month) ?? null;
}

// Saves every received month or none, and leaves new months without any amount unregistered.
export async function saveMonthlyFinancialsYear(req, year, items) {
  await ensureMonthlyFinancialSchema();
  const sortedItems = [...items].sort((left, right) => left.month - right.month);
  return withTransaction(async (connection) => {
    const currencyCodes = [...new Set(sortedItems.map((item) => item.currencyCode))];
    const [currencies] = await connection.query("SELECT code FROM currencies WHERE code IN (?) AND is_active = 1", [currencyCodes]);
    if (currencies.length !== currencyCodes.length) throw Object.assign(new Error("Selecciona una moneda activa"), { status: 400 });
    const [rows] = await connection.query("SELECT * FROM monthly_financials WHERE year = ? FOR UPDATE", [year]);
    const previousByMonth = new Map(rows.map((row) => [Number(row.month), row]));
    const conflicts = sortedItems
      .filter((item) => Number(previousByMonth.get(item.month)?.version || 0) !== item.version)
      .map((item) => item.month);
    if (conflicts.length) throw new MonthlyFinancialConflictError(conflicts);

    for (const item of sortedItems) {
      const previous = previousByMonth.get(item.month);
      if (!previous && MONTHLY_FINANCIAL_FIELDS.every((key) => item[key] === null)) continue;
      const values = MONTHLY_FINANCIAL_FIELDS.map((key) => item[key]);
      const now = new Date();
      let id = previous?.id;
      if (previous) {
        await connection.query(`UPDATE monthly_financials SET currency_code = ?,
          ${MONTHLY_FINANCIAL_FIELDS.map((key) => `\`${key}\` = ?`).join(", ")},
          version = version + 1, updated_by_user_id = ?, updated_at = ? WHERE id = ?`,
        [item.currencyCode, ...values, req.user.id, now, id]);
      } else {
        try {
          const [result] = await connection.query(`INSERT INTO monthly_financials
            (year, month, currency_code, ${MONTHLY_FINANCIAL_FIELDS.map((key) => `\`${key}\``).join(",")},
            version, updated_by_user_id, updated_at) VALUES (?, ?, ?, ${values.map(() => "?").join(",")}, 1, ?, ?)`,
          [year, item.month, item.currencyCode, ...values, req.user.id, now]);
          id = result.insertId;
        } catch (error) {
          if (error.code !== "ER_DUP_ENTRY") throw error;
          throw new MonthlyFinancialConflictError([item.month]);
        }
      }
      await logAuditEvent({
        req, module: "informacion_financiera", action: previous ? "updated" : "created",
        entityType: "monthly_financials", entityId: Number(id), detail: `Información financiera ${year}-${String(item.month).padStart(2, "0")}`,
        before: previous ? { ...financialValues(previous), year, month: item.month, currencyCode: previous.currency_code, version: Number(previous.version) } : null,
        after: { ...financialValues(item), currencyCode: item.currencyCode, year, month: item.month, version: item.version + 1 },
        connection, required: true,
      });
    }
    const [savedRows] = await connection.query(selectYearRecords, [year]);
    return savedRows.map(toRecord);
  });
}

export async function saveMonthlyFinancials(req, year, month, data) {
  const records = await saveMonthlyFinancialsYear(req, year, [{ ...data, month }]);
  return records.find((record) => record.month === month) ?? null;
}

async function saveOrConflict(res, year, work) {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof MonthlyFinancialConflictError)) throw error;
    const current = await listMonthlyFinancials(year);
    res.status(409).json({
      message: error.message,
      conflicts: error.months.map((month) => ({ month, record: current.find((record) => record.month === month) ?? null })),
    });
    return null;
  }
}

const router = express.Router();
router.use(requireAnyPermission(readPermissions));
router.get("/currencies", async (_req, res) => {
  res.json(await query("SELECT code, name FROM currencies WHERE is_active = 1 ORDER BY name"));
});
router.get("/:year", async (req, res) => {
  const parsed = periodSchema.pick({ year: true }).safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Año inválido" });
  res.json({ year: parsed.data.year, records: await listMonthlyFinancials(parsed.data.year) });
});
router.put("/:year", requireAnyPermission(["informacion_financiera.update"]), async (req, res) => {
  const period = periodSchema.pick({ year: true }).safeParse(req.params);
  const parsed = monthlyFinancialYearSchema.safeParse(req.body);
  if (!period.success || !parsed.success) {
    return res.status(400).json({ message: "Revisa los datos de captura", errors: parsed.error?.flatten() });
  }
  const { year } = period.data;
  const records = await saveOrConflict(res, year, () => saveMonthlyFinancialsYear(req, year, parsed.data.months));
  if (records) res.json({ year, records });
});
router.get("/:year/:month", async (req, res) => {
  const parsed = periodSchema.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Año o mes inválido" });
  res.json({ record: await getMonthlyFinancials(parsed.data.year, parsed.data.month) });
});
router.put("/:year/:month", requireAnyPermission(["informacion_financiera.update"]), async (req, res) => {
  const period = periodSchema.safeParse(req.params);
  const parsed = monthlyFinancialSchema.safeParse(req.body);
  if (!period.success || !parsed.success) {
    return res.status(400).json({ message: "Revisa los datos de captura", errors: parsed.error?.flatten() });
  }
  const { year, month } = period.data;
  const record = await saveOrConflict(res, year, () => saveMonthlyFinancials(req, year, month, parsed.data));
  if (record !== null || !res.headersSent) res.json({ record });
});
export default router;
