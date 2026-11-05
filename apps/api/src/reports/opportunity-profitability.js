import { z } from "zod";
import { withTransaction } from "../db.js";
import { buildReportSelection, reportFiltersSchema } from "./opportunities-quotations.js";
import { requireReportScope } from "./permissions.js";
import {
  buildQuotationVersionBaseSaleTotalJoin,
  buildQuotationVersionNetSaleSql,
} from "../quotation-totals-sql.js";

const reportSelect = "SELECT /*+ SET_VAR(optimizer_switch='derived_merge=off') */";

export const profitabilityFiltersSchema = z.object({
  search: z.string().trim().max(200).default(""),
  accountId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  sellerUserId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  dateFrom: z.iso.date().optional(),
  dateTo: z.iso.date().optional(),
  sort: z.enum(["id", "name", "sale", "totalCost", "profit", "marginPct"]).default("id"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(50), z.literal(100)])).default(10),
}).strict().refine((value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo, {
  message: "La fecha inicial no puede ser posterior a la final",
  path: ["dateTo"],
});

function metrics(sale, productCost, serviceCost) {
  const totalCost = productCost + serviceCost;
  const profit = sale - totalCost;
  return { sale, productCost, serviceCost, totalCost, profit, marginPct: sale > 0 ? profit / sale * 100 : null };
}

function aggregateMetrics(row) {
  const subtotal = metrics(Number(row.sale || 0), Number(row.product_cost || 0), Number(row.service_cost || 0));
  const missingCount = Number(row.missing_count || 0);
  return {
    missingCount,
    totals: missingCount ? null : subtotal,
    convertibleSubtotal: subtotal,
    quotationCount: Number(row.quotation_count),
  };
}

export async function listOpportunityProfitability(user, filters) {
  const selection = reportFiltersSchema.parse({
    search: filters.search, accountId: filters.accountId, sellerUserId: filters.sellerUserId,
    dateFrom: filters.dateFrom, dateTo: filters.dateTo, dateType: "actual_close",
    commercialStatuses: "ganada", quotationStatuses: "ganada,aceptada",
  });
  const { cte, params } = buildReportSelection(user, selection, "profitability");
  const sql = `${cte}, profitability_quotations AS (
    SELECT lv.quotation_id, lv.opportunity_id, lv.version_number, lv.proposal_name,
           lv.status_name, lv.currency_code, lv.exchange_rate,
           ${buildQuotationVersionNetSaleSql()} AS sale,
           COALESCE(latest_total.product_cost_total, 0) AS product_cost,
           COALESCE(latest_total.service_cost_total, 0) AS service_cost,
           CASE WHEN UPPER(TRIM(lv.currency_code)) = 'USD' THEN 1
             WHEN NULLIF(TRIM(lv.currency_code), '') IS NOT NULL
               AND lv.exchange_rate > 0 AND lv.exchange_rate <> 1 THEN lv.exchange_rate
             ELSE NULL END AS divisor
    FROM matching_quotations lv
    INNER JOIN selected_opportunities so ON so.id = lv.opportunity_id
    ${buildQuotationVersionBaseSaleTotalJoin()}
    WHERE lv.matches_filters = 1
  ), profitability_totals AS (
    SELECT opportunity_id, COUNT(*) AS quotation_count,
           SUM(divisor IS NULL) AS missing_count,
           COALESCE(SUM(sale / divisor), 0) AS sale,
           COALESCE(SUM(product_cost / divisor), 0) AS product_cost,
           COALESCE(SUM(service_cost / divisor), 0) AS service_cost
    FROM profitability_quotations GROUP BY opportunity_id
  )`;
  const columns = {
    id: "so.id", name: "so.name", sale: "pt.sale",
    totalCost: "(pt.product_cost + pt.service_cost)",
    profit: "(pt.sale - pt.product_cost - pt.service_cost)",
    marginPct: "(pt.sale - pt.product_cost - pt.service_cost) / NULLIF(pt.sale, 0)",
  };
  const sort = ["id", "name"].includes(filters.sort)
    ? columns[filters.sort] : `CASE WHEN pt.missing_count = 0 THEN ${columns[filters.sort]} END`;
  return withTransaction(async (connection) => {
    const read = async (statement, values = params) => {
      const [rows] = await connection.query(statement, values);
      return rows;
    };
    const [summary] = await read(`${sql}
      ${reportSelect} COUNT(*) AS opportunity_count, COALESCE(SUM(quotation_count), 0) AS quotation_count,
             COALESCE(SUM(missing_count), 0) AS missing_count,
             COALESCE(SUM(sale), 0) AS sale, COALESCE(SUM(product_cost), 0) AS product_cost,
             COALESCE(SUM(service_cost), 0) AS service_cost
      FROM profitability_totals`);
    const total = Number(summary.opportunity_count);
    const page = Math.min(filters.page, Math.max(1, Math.ceil(total / filters.pageSize)));
    const rows = await read(`${sql}
      ${reportSelect} so.id, so.name, so.account_name, so.seller_name, pt.*
      FROM selected_opportunities so INNER JOIN profitability_totals pt ON pt.opportunity_id = so.id
      ORDER BY ${sort} ${filters.direction.toUpperCase()}, so.id DESC LIMIT ? OFFSET ?`,
    [...params, filters.pageSize, (page - 1) * filters.pageSize]);
    const ids = rows.map((row) => Number(row.id));
    const quotations = ids.length ? await read(`${sql}
      ${reportSelect} * FROM profitability_quotations WHERE opportunity_id IN (${ids.map(() => "?").join(",")})
      ORDER BY quotation_id`, [...params, ...ids]) : [];
    return {
      page, pageSize: filters.pageSize, total, scope: requireReportScope(user, "profitability"),
      summary: { opportunityCount: total, ...aggregateMetrics(summary) },
      items: rows.map((row) => ({
        id: Number(row.id), name: row.name, accountName: row.account_name, sellerName: row.seller_name,
        ...aggregateMetrics(row),
        quotations: quotations.filter((q) => Number(q.opportunity_id) === Number(row.id)).map((q) => {
          const original = metrics(Number(q.sale), Number(q.product_cost), Number(q.service_cost));
          const divisor = q.divisor == null ? null : Number(q.divisor);
          return {
            id: Number(q.quotation_id), versionNumber: Number(q.version_number),
            proposalName: q.proposal_name, statusName: q.status_name,
            currency: q.currency_code, exchangeRate: q.exchange_rate == null ? null : Number(q.exchange_rate),
            original,
            usd: divisor == null ? null : metrics(original.sale / divisor, original.productCost / divisor, original.serviceCost / divisor),
          };
        }),
      })),
    };
  });
}
