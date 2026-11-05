import { z } from "zod";
import { query, withTransaction } from "../db.js";
import { ensureQuotationWonDocumentsSchema } from "../quotation-won-documents-schema.js";
import { requireReportScope } from "./permissions.js";
import {
  buildQuotationVersionBaseSaleTotalJoin,
  buildQuotationVersionEffectiveTotalSql,
} from "../quotation-totals-sql.js";

const commercialStates = ["en_proceso", "ganada", "perdida"];
const quotationStates = [
  "borrador", "en_aprobacion", "aprobada", "enviada", "ganada",
  "aceptada", "rechazada", "perdida", "no_vigente",
];
const id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional();
const codes = (values) => z.string().transform((value) =>
  [...new Set(value.split(",").filter(Boolean))],
).pipe(z.array(z.enum(values))).default([]);
const date = z.iso.date().optional();

export const reportFiltersSchema = z.object({
  preset: z.enum(["all", "won", "accepted", "both", "either", "won_without_accepted", "accepted_not_won"]).default("all"),
  accountId: id,
  sellerUserId: id,
  presalesUserId: id,
  commercialStatuses: codes(commercialStates),
  quotationStatuses: codes(quotationStates),
  quotationPresence: z.enum(["all", "with", "without"]).default("all"),
  opportunityActivation: z.enum(["all", "activada", "pendiente_activacion", "desactivada"]).default("all"),
  quotationActivation: z.enum(["all", "activada", "desactivada"]).default("all"),
  dateType: z.enum(["expected_close", "actual_close", "quotation"]).default("expected_close"),
  dateFrom: date,
  dateTo: date,
  search: z.string().trim().max(200).default(""),
  sort: z.enum(["id", "name", "account", "amount", "expected_close", "actual_close"]).default("id"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(50), z.literal(100)])).default(10),
}).strict().refine((value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo, {
  message: "La fecha inicial no puede ser posterior a la final",
  path: ["dateTo"],
});

export function buildReportSelection(user, filters, report = "opportunitiesQuotations") {
  const params = [];
  const scope = ["ocs.code <> 'anulada'"];
  if (requireReportScope(user, report) === "own") {
    scope.push("o.seller_user_id = ?");
    params.push(Number(user.id));
  }
  for (const [key, column] of [
    ["accountId", "o.account_id"], ["sellerUserId", "o.seller_user_id"],
    ["presalesUserId", "o.presales_user_id"],
  ]) {
    if (filters[key]) {
      scope.push(`${column} = ?`);
      params.push(filters[key]);
    }
  }
  if (filters.opportunityActivation !== "all") {
    scope.push("oas.code = ?");
    params.push(filters.opportunityActivation);
  }
  if (filters.commercialStatuses.length) {
    scope.push(`ocs.code IN (${filters.commercialStatuses.map(() => "?").join(",")})`);
    params.push(...filters.commercialStatuses);
  }
  if (filters.search) {
    scope.push("(o.name LIKE ? OR a.name LIKE ? OR CAST(o.id AS CHAR) = ?)");
    params.push(`%${filters.search}%`, `%${filters.search}%`, filters.search);
  }
  if (filters.dateType !== "quotation") {
    const column = filters.dateType === "actual_close" ? "o.commercial_closed_at" : "o.close_date";
    if (filters.dateFrom) {
      scope.push(`${column} >= ?`);
      params.push(filters.dateFrom);
    }
    if (filters.dateTo) {
      scope.push(`${column} < DATE_ADD(?, INTERVAL 1 DAY)`);
      params.push(filters.dateTo);
    }
  }

  const quotationScope = ["(qs.code IS NULL OR qs.code <> 'anulada')"];
  if (filters.quotationActivation !== "all") {
    quotationScope.push("qas.code = ?");
    params.push(filters.quotationActivation);
  }
  const quoteMatch = [];
  if (filters.quotationStatuses.length) {
    quoteMatch.push(`eq.status_code IN (${filters.quotationStatuses.map(() => "?").join(",")})`);
    params.push(...filters.quotationStatuses);
  }
  if (filters.dateType === "quotation") {
    if (filters.dateFrom) {
      quoteMatch.push("eq.quotation_date >= ?");
      params.push(filters.dateFrom);
    }
    if (filters.dateTo) {
      quoteMatch.push("eq.quotation_date < DATE_ADD(?, INTERVAL 1 DAY)");
      params.push(filters.dateTo);
    }
  }
  const customMatch = quoteMatch.length ? quoteMatch.join(" AND ") : "1 = 1";
  const won = "so.commercial_status_code = 'ganada'";
  const accepted = "EXISTS (SELECT 1 FROM eligible_quotations aq WHERE aq.opportunity_id = so.id AND aq.status_code = 'aceptada')";
  const presets = {
    all: "1 = 1",
    won,
    accepted,
    both: `(${won}) AND (${accepted})`,
    either: `(${won}) OR (${accepted})`,
    won_without_accepted: `(${won}) AND NOT (${accepted})`,
    accepted_not_won: `NOT (${won}) AND (${accepted})`,
  };
  const opportunityMatch = [`(${presets[filters.preset]})`];
  if (filters.quotationPresence !== "all") {
    opportunityMatch.push(`${filters.quotationPresence === "without" ? "NOT " : ""}EXISTS (
      SELECT 1 FROM eligible_quotations pq WHERE pq.opportunity_id = so.id
    )`);
  }
  if (quoteMatch.length) {
    opportunityMatch.push(`EXISTS (
      SELECT 1 FROM matching_quotations mq WHERE mq.opportunity_id = so.id AND mq.matches_filters = 1
    )`);
  }
  let quickMatch = "1 = 1";
  if (["accepted", "both", "accepted_not_won"].includes(filters.preset)) {
    quickMatch = "eq.status_code = 'aceptada'";
  } else if (filters.preset === "either") {
    quickMatch = "(so.commercial_status_code = 'ganada' OR eq.status_code = 'aceptada')";
  }

  return {
    params,
    cte: `WITH scoped_opportunities AS (
      SELECT o.id, o.name, o.account_id, a.name AS account_name,
             o.amount_usd, o.close_date, o.commercial_closed_at,
             o.seller_user_id, o.presales_user_id,
             su.full_name AS seller_name, pu.full_name AS presales_name,
             oss.name AS sales_stage, ocs.code AS commercial_status_code,
             ocs.name AS commercial_status_name, oas.name AS activation_status
      FROM opportunities o
      INNER JOIN accounts a ON a.id = o.account_id
      INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
      INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
      INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
      LEFT JOIN users su ON su.id = o.seller_user_id
      LEFT JOIN users pu ON pu.id = o.presales_user_id
      ${scope.length ? `WHERE ${scope.join(" AND ")}` : ""}
    ), eligible_quotations AS (
      SELECT q.id AS quotation_id, lv.id, q.opportunity_id, q.latest_version_id,
             lv.version_number, lv.proposal_name, lv.quotation_date, lv.currency_code, lv.exchange_rate,
             lv.summary_discount_mode, lv.summary_discount_value,
             lv.summary_distribution_mode, lv.summary_vat_mode, lv.summary_vat_pct,
             qs.code AS status_code, qs.name AS status_name,
             qas.name AS activation_status
      FROM quotations q
      INNER JOIN scoped_opportunities so ON so.id = q.opportunity_id
      LEFT JOIN quotation_versions lv ON lv.id = q.latest_version_id AND lv.quotation_id = q.id
      LEFT JOIN quotation_statuses qs ON qs.id = lv.status_id
      INNER JOIN quotation_activation_statuses qas ON qas.id = q.activation_status_id
      ${quotationScope.length ? `WHERE ${quotationScope.join(" AND ")}` : ""}
    ), matching_quotations AS (
      SELECT eq.*, ((${customMatch}) AND (${quickMatch})) AS matches_filters
      FROM eligible_quotations eq
      INNER JOIN scoped_opportunities so ON so.id = eq.opportunity_id
    ), selected_opportunities AS (
      SELECT so.* FROM scoped_opportunities so WHERE ${opportunityMatch.join(" AND ")}
    )`,
  };
}

const sortColumns = {
  id: "so.id", name: "so.name", account: "so.account_name",
  amount: "so.amount_usd", expected_close: "so.close_date", actual_close: "so.commercial_closed_at",
};
// Materialize shared CTEs instead of repeatedly expanding the same account and quotation joins.
const reportSelect = "SELECT /*+ SET_VAR(optimizer_switch='derived_merge=off') */";

function numberOrNull(value) {
  return value == null ? null : Number(value);
}

export async function listOpportunitiesQuotationsReport(user, filters) {
  await ensureQuotationWonDocumentsSchema();
  return withTransaction(async (connection) => {
    const read = async (sql, params) => {
      const [rows] = await connection.query(sql, params);
      return rows;
    };
    return readReport(user, filters, read);
  });
}

async function readReport(user, filters, read) {
  const { cte, params } = buildReportSelection(user, filters);
  const [summary] = await read(`${cte}
    ${reportSelect} COUNT(*) AS opportunity_count,
           COALESCE(SUM(so.commercial_status_code = 'ganada'), 0) AS won_count,
           COALESCE(SUM(so.amount_usd), 0) AS opportunity_amount_usd,
           (SELECT COUNT(*) FROM matching_quotations mq INNER JOIN selected_opportunities s ON s.id = mq.opportunity_id) AS quotation_count,
           (SELECT COUNT(*) FROM matching_quotations mq INNER JOIN selected_opportunities s ON s.id = mq.opportunity_id WHERE mq.status_code = 'aceptada') AS accepted_count,
           (SELECT COUNT(*) FROM matching_quotations mq INNER JOIN selected_opportunities s ON s.id = mq.opportunity_id WHERE mq.matches_filters = 1) AS matching_count
    FROM selected_opportunities so`, params);
  const total = Number(summary.opportunity_count);
  const page = Math.min(filters.page, Math.max(1, Math.ceil(total / filters.pageSize)));
  const rows = await read(`${cte}
    ${reportSelect} so.* FROM selected_opportunities so
    ORDER BY ${sortColumns[filters.sort]} ${filters.direction.toUpperCase()}, so.id DESC
    LIMIT ? OFFSET ?`, [...params, filters.pageSize, (page - 1) * filters.pageSize]);

  const totalSql = buildQuotationVersionEffectiveTotalSql();
  const totalsJoin = buildQuotationVersionBaseSaleTotalJoin();
  const usdTotalSql = `CASE
    WHEN UPPER(TRIM(lv.currency_code)) = 'USD' THEN ${totalSql}
    WHEN NULLIF(TRIM(lv.currency_code), '') IS NOT NULL
      AND lv.exchange_rate > 0 AND lv.exchange_rate <> 1
      THEN (${totalSql}) / lv.exchange_rate
    ELSE NULL END`;
  const currencyRows = await read(`${cte}
    ${reportSelect} lv.currency_code,
           SUM(${totalSql}) AS amount,
           SUM(CASE WHEN lv.matches_filters = 1 THEN ${totalSql} ELSE 0 END) AS matching_amount,
           SUM(${usdTotalSql}) AS usd_amount,
           SUM(CASE WHEN lv.matches_filters = 1 THEN ${usdTotalSql} ELSE 0 END) AS matching_usd_amount,
           SUM((${usdTotalSql}) IS NULL) AS missing_usd_count,
           SUM(lv.matches_filters = 1 AND (${usdTotalSql}) IS NULL) AS matching_missing_usd_count
    FROM matching_quotations lv
    INNER JOIN selected_opportunities so ON so.id = lv.opportunity_id
    ${totalsJoin}
    WHERE lv.latest_version_id IS NOT NULL
    GROUP BY lv.currency_code ORDER BY lv.currency_code`, params);
  const ids = rows.map((row) => Number(row.id));
  const quotations = ids.length ? await read(`${cte}
    ${reportSelect} lv.*, ${totalSql} AS total_amount
    FROM matching_quotations lv
    INNER JOIN selected_opportunities so ON so.id = lv.opportunity_id
    ${totalsJoin}
    WHERE lv.opportunity_id IN (${ids.map(() => "?").join(",")})
    ORDER BY lv.opportunity_id, lv.quotation_id DESC`, [...params, ...ids]) : [];
  const versionIds = quotations.map((quotation) => Number(quotation.latest_version_id)).filter(Boolean);
  const purchaseOrders = versionIds.length ? await read(
    `SELECT qwd.quotation_version_id, qwd.document_id, qwd.document_source,
            qwd.purchase_order_amount, qwd.purchase_order_currency, d.original_file_name
     FROM quotation_won_documents qwd
     INNER JOIN documents d ON d.id = qwd.document_id
     WHERE qwd.quotation_version_id IN (${versionIds.map(() => "?").join(",")})
       AND qwd.document_role = 'purchase_order' AND COALESCE(d.is_deleted, 0) = 0
     ORDER BY qwd.quotation_version_id, qwd.created_at, qwd.id`, versionIds,
  ) : [];

  return {
    page, pageSize: filters.pageSize, total, scope: requireReportScope(user, "opportunitiesQuotations"),
    summary: {
      opportunityCount: total,
      wonCount: Number(summary.won_count),
      opportunityAmountUsd: Number(summary.opportunity_amount_usd),
      quotationCount: Number(summary.quotation_count),
      acceptedCount: Number(summary.accepted_count),
      matchingCount: Number(summary.matching_count),
      quotedUsd: currencyRows.reduce((totals, row) => ({
        amount: totals.amount + Number(row.usd_amount ?? 0),
        matchingAmount: totals.matchingAmount + Number(row.matching_usd_amount ?? 0),
        missingCount: totals.missingCount + Number(row.missing_usd_count),
        matchingMissingCount: totals.matchingMissingCount + Number(row.matching_missing_usd_count),
      }), { amount: 0, matchingAmount: 0, missingCount: 0, matchingMissingCount: 0 }),
      currencies: currencyRows.map((row) => ({
        currency: row.currency_code,
        amount: numberOrNull(row.amount),
        matchingAmount: numberOrNull(row.matching_amount),
      })),
    },
    items: rows.map((row) => ({
      id: Number(row.id), name: row.name, accountId: Number(row.account_id),
      accountName: row.account_name, amountUsd: numberOrNull(row.amount_usd),
      expectedCloseDate: row.close_date, actualCloseDate: row.commercial_closed_at,
      sellerName: row.seller_name, presalesName: row.presales_name,
      salesStage: row.sales_stage, commercialStatusCode: row.commercial_status_code,
      commercialStatusName: row.commercial_status_name, activationStatus: row.activation_status,
      quotations: quotations.filter((quotation) => Number(quotation.opportunity_id) === Number(row.id)).map((quotation) => ({
        id: Number(quotation.quotation_id), versionNumber: numberOrNull(quotation.version_number),
        proposalName: quotation.proposal_name, statusCode: quotation.status_code,
        statusName: quotation.status_name, activationStatus: quotation.activation_status,
        quotationDate: quotation.quotation_date, currency: quotation.currency_code,
        exchangeRate: numberOrNull(quotation.exchange_rate),
        purchaseOrders: purchaseOrders.filter((order) =>
          Number(order.quotation_version_id) === Number(quotation.latest_version_id)).map((order) => ({
          documentId: Number(order.document_id), source: order.document_source,
          originalFileName: order.original_file_name,
          amount: numberOrNull(order.purchase_order_amount), currencyCode: order.purchase_order_currency,
        })),
        totalAmount: numberOrNull(quotation.total_amount), matchesFilters: Boolean(Number(quotation.matches_filters)),
      })),
    })),
  };
}

export async function getReportCatalogs(user, report = "opportunitiesQuotations") {
  const filters = reportFiltersSchema.parse(["profitability", "contribution"].includes(report) ? {
    commercialStatuses: "ganada", quotationStatuses: "ganada,aceptada",
  } : {});
  const { cte, params } = buildReportSelection(user, filters, report);
  const rows = await query(`${cte}
    ${reportSelect} DISTINCT account_id, account_name, seller_user_id, seller_name, presales_user_id, presales_name
    FROM selected_opportunities ORDER BY account_name`, params);
  const unique = (idKey, nameKey) => [...new Map(rows.filter((row) => row[idKey] != null)
    .map((row) => [Number(row[idKey]), { id: Number(row[idKey]), name: row[nameKey] }])).values()];
  return {
    accounts: unique("account_id", "account_name"),
    sellers: unique("seller_user_id", "seller_name"),
    presales: unique("presales_user_id", "presales_name"),
  };
}
