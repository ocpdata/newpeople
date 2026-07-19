import express from "express";
import { requireAnyPermission } from "./auth.js";
import { query } from "./db.js";
import { ensureCommercialPlanningSchema } from "./commercial-planning/schema.js";
import {
  getCommercialSettings,
  STAGE_SLA_DEFAULTS,
  STAGE_WEIGHT_DEFAULTS,
} from "./settings.js";

const router = express.Router();

let _stageSlaCache = null;
let _stageSlaExpiry = 0;
let _forecastStageWeightCache = { ...STAGE_WEIGHT_DEFAULTS };
let _commercialPlanningSchemaReady = false;

async function ensureSellerParameterSchemaReady() {
  if (_commercialPlanningSchemaReady) {
    return;
  }
  await ensureCommercialPlanningSchema();
  _commercialPlanningSchemaReady = true;
}

function toOptionalNonNegativeDayValue(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return Math.max(0, Math.round(numericValue));
}

async function loadStageSlaMap() {
  if (_stageSlaCache && Date.now() < _stageSlaExpiry) {
    return _stageSlaCache;
  }
  const settings = await getCommercialSettings().catch(() => null);
  _stageSlaCache = settings?.stageSlaMap
    ? { ...STAGE_SLA_DEFAULTS, ...settings.stageSlaMap }
    : { ...STAGE_SLA_DEFAULTS };
  _forecastStageWeightCache = settings?.stageWeightMap
    ? { ...STAGE_WEIGHT_DEFAULTS, ...settings.stageWeightMap }
    : { ...STAGE_WEIGHT_DEFAULTS };
  _stageSlaExpiry = Date.now() + 60000;
  return _stageSlaCache;
}

const STAGE_SLA_DAYS = {
  contacto_inicial: 3,
  identificacion_oportunidad: 3,
  desarrollo: 5,
  cotizacion: 5,
  demostracion: 6,
  negociacion: 4,
  waiting: 3,
};

const FORECAST_QUALITY_FACTORS = {
  excellent: 1.15,
  good: 1,
  medium: 0.75,
  weak: 0.45,
  critical: 0.15,
};

const FORECAST_STAGE_ORDER = {
  contacto_inicial: 1,
  identificacion_oportunidad: 2,
  desarrollo: 3,
  cotizacion: 4,
  demostracion: 5,
  negociacion: 6,
  waiting: 7,
  ganada: 8,
  perdida: 9,
  anulada: 10,
};

const FORECAST_CATEGORY_LABELS = {
  committed: "Comprometido",
  probable: "Probable",
  weak: "Debil",
};

const NEXT_STEP_ACTION_TYPES = [
  "next_step",
  "follow_up",
  "call",
  "waiting_customer",
];

const QUARTERLY_AVG_WON_TICKET_USD = 50000;
const QUARTERLY_OPPORTUNITIES_TO_WON_RATIO = 4;
const QUARTERLY_LEADS_TO_WON_RATIO = 10;
const DEFAULT_QUOTATION_VAT_PCT = 16;
const commercialSellerEligibilityPermission = "comercial.seller.eligible";

function userHasPermission(user, permission) {
  return user?.permissionSet?.has(permission);
}

function hasGlobalOpportunityScope(user) {
  return userHasPermission(user, "oportunidades.read_all");
}

function hasSellerLeagueGlobalScope(user) {
  return userHasPermission(user, "ritmo_comercial.read_all");
}

function buildGlobalOpportunityScopeUser(user) {
  const permissionSet = new Set(user?.permissionSet || []);
  permissionSet.add("oportunidades.read_all");
  return {
    ...user,
    permissionSet,
  };
}

function buildSellerLeagueOpportunityScopeUser(user, canReadAllSellerLeague) {
  const permissionSet = new Set(user?.permissionSet || []);
  if (canReadAllSellerLeague) {
    permissionSet.add("oportunidades.read_all");
  } else {
    permissionSet.delete("oportunidades.read_all");
  }
  return {
    ...user,
    permissionSet,
  };
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(value) {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

function addDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function getWeekStart(value = new Date()) {
  const date = startOfDay(value);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(date, diff);
}

function getWeekRange(rawWeekStart) {
  const candidate = rawWeekStart ? new Date(rawWeekStart) : new Date();
  const safeDate = Number.isNaN(candidate.getTime()) ? new Date() : candidate;
  const start = getWeekStart(safeDate);
  const end = endOfDay(addDays(start, 6));
  return { start, end };
}

function parseMonthStart(rawMonth, fallback = new Date()) {
  const candidate = String(rawMonth || "").trim();
  const match = /^(\d{4})-(\d{2})$/.exec(candidate);
  if (!match) {
    return new Date(fallback.getFullYear(), fallback.getMonth(), 1);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    return new Date(fallback.getFullYear(), fallback.getMonth(), 1);
  }

  return new Date(year, month - 1, 1);
}

function formatIsoMonth(value) {
  const date = startOfDay(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthRange(rawMonth) {
  const start = startOfDay(parseMonthStart(rawMonth));
  start.setDate(1);
  const end = endOfDay(new Date(start.getFullYear(), start.getMonth() + 1, 0));
  return {
    start,
    end,
    month: formatIsoMonth(start),
  };
}

function getQuarterSelection(value = new Date()) {
  const date = startOfDay(value);
  const year = date.getFullYear();
  const quarter = Math.floor(date.getMonth() / 3) + 1;
  return {
    year,
    quarter,
    label: `T${quarter} ${year}`,
    start: startOfDay(new Date(year, (quarter - 1) * 3, 1)),
    end: endOfDay(new Date(year, quarter * 3, 0)),
  };
}

function getPreviousQuarterSelection(value = new Date()) {
  const current = getQuarterSelection(value);
  const previousQuarter = current.quarter === 1 ? 4 : current.quarter - 1;
  const previousYear = current.quarter === 1 ? current.year - 1 : current.year;

  return {
    year: previousYear,
    quarter: previousQuarter,
    label: `T${previousQuarter} ${previousYear}`,
    start: startOfDay(new Date(previousYear, (previousQuarter - 1) * 3, 1)),
    end: endOfDay(new Date(previousYear, previousQuarter * 3, 0)),
  };
}

function buildWeeksForRange(start, end) {
  const weeks = [];
  let cursor = getWeekStart(start);

  while (cursor <= end) {
    const periodStart = new Date(cursor);
    const naturalEnd = endOfDay(addDays(periodStart, 6));
    weeks.push({
      key: formatIsoDate(periodStart),
      label: formatPeriodLabel(periodStart, "week"),
      start: periodStart,
      end: naturalEnd > end ? endOfDay(end) : naturalEnd,
    });
    cursor = addDays(cursor, 7);
  }

  return weeks;
}

function normalizeWeekRangeForValidWeeks(
  rawWeekStart,
  validWeeks,
  fallbackWeek,
) {
  const candidateRange = rawWeekStart
    ? getWeekRange(rawWeekStart)
    : fallbackWeek;
  const candidateKey = formatIsoDate(candidateRange.start);
  const hasCandidate = validWeeks.some((week) => week.key === candidateKey);
  return hasCandidate ? candidateRange : fallbackWeek;
}

function parseDateOrFallback(rawValue, fallback) {
  const candidate = rawValue ? new Date(rawValue) : null;
  if (!candidate || Number.isNaN(candidate.getTime())) {
    return fallback;
  }
  return candidate;
}

function formatIsoDate(value) {
  return startOfDay(value).toISOString().slice(0, 10);
}

function formatPeriodLabel(date, granularity) {
  if (granularity === "month") {
    return new Intl.DateTimeFormat("es-MX", {
      month: "short",
      year: "numeric",
    }).format(date);
  }

  const end = addDays(date, 6);
  const formatter = new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
  });
  return `${formatter.format(date)} - ${formatter.format(end)}`;
}

function buildOwnershipJoin(user, params, alias = "o") {
  if (hasGlobalOpportunityScope(user)) {
    return "";
  }
  params.push(Number(user.id));
  return `LEFT JOIN account_owners ao_scope ON ao_scope.account_id = ${alias}.account_id AND ao_scope.user_id = ?`;
}

function getDiffDays(fromDate, toDate = new Date()) {
  const start = new Date(fromDate);
  const end = new Date(toDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 0;
  }
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86400000));
}

function toAmount(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function clampScore(value) {
  const numericValue = Number(value || 0);
  if (numericValue <= 0) return 0;
  if (numericValue >= 100) return 100;
  return toAmount(numericValue);
}

function safeRatio(numerator, denominator) {
  const safeDenominator = Number(denominator || 0);
  if (safeDenominator <= 0) {
    return 0;
  }
  return Number(numerator || 0) / safeDenominator;
}

function toYearValue(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100
    ? parsed
    : new Date().getFullYear();
}

function getQuarterRange(year, quarter) {
  const start = startOfDay(new Date(year, (quarter - 1) * 3, 1));
  const end = endOfDay(new Date(year, quarter * 3, 0));
  return {
    start,
    end,
    label: `T${quarter} ${year}`,
  };
}

function isOpenPipelineStatus(statusCode) {
  const code = String(statusCode || "").trim();
  return !["ganada", "perdida", "anulada"].includes(code);
}

function buildQuotationVersionBaseSaleTotalJoin(versionAlias = "qv") {
  return `LEFT JOIN (
      SELECT qs.quotation_version_id,
             SUM(
               CASE
                 WHEN qsi.profit_margin_pct >= 100 THEN 0
                 ELSE qsi.quantity * (
                   (
                     qsi.list_price_unit *
                     (1 - (qsi.manufacturer_discount_pct / 100)) *
                     (1 + (qsi.import_cost_pct / 100))
                   ) /
                   (1 - (qsi.profit_margin_pct / 100)) *
                   (1 - (qsi.final_discount_pct / 100))
                 )
               END
             ) AS base_sale_total,
             SUM(
               CASE
                 WHEN qsi.profit_margin_pct >= 100 THEN 0
                 ELSE qsi.quantity * (
                   qsi.list_price_unit *
                   (1 - (qsi.manufacturer_discount_pct / 100)) *
                   (1 + (qsi.import_cost_pct / 100))
                 )
               END
             ) AS base_cost_total
      FROM quotation_sections qs
      INNER JOIN quotation_section_items qsi ON qsi.quotation_section_id = qs.id
      LEFT JOIN quotation_section_items child
        ON child.bundle_parent_item_id = qsi.id
       AND child.quotation_section_id = qs.id
      WHERE child.id IS NULL
        AND qsi.item_type <> 'grupo_productos'
      GROUP BY qs.quotation_version_id
    ) quotation_total ON quotation_total.quotation_version_id = ${versionAlias}.id`;
}

function buildQuotationVersionContributionSql({
  versionAlias = "qv",
  totalsAlias = "quotation_total",
} = {}) {
  const baseSaleSql = `COALESCE(${totalsAlias}.base_sale_total, 0)`;
  const baseCostSql = `COALESCE(${totalsAlias}.base_cost_total, 0)`;
  const adjustedSaleSql = `CASE
      WHEN ${versionAlias}.summary_distribution_mode = 'per_item'
        THEN ${baseSaleSql}
      WHEN ${versionAlias}.summary_discount_mode = 'amount'
        THEN GREATEST(
          ${baseSaleSql} - LEAST(COALESCE(${versionAlias}.summary_discount_value, 0), ${baseSaleSql}),
          0
        )
      WHEN ${versionAlias}.summary_discount_mode = 'percentage'
        THEN ${baseSaleSql} *
          (1 - (LEAST(GREATEST(COALESCE(${versionAlias}.summary_discount_value, 0), 0), 100) / 100))
      ELSE ${baseSaleSql}
    END`;

  return `CASE
      WHEN ${versionAlias}.id IS NULL THEN NULL
      ELSE ${adjustedSaleSql} - ${baseCostSql}
    END`;
}

function buildQuotationVersionEffectiveTotalSql({
  versionAlias = "qv",
  totalsAlias = "quotation_total",
} = {}) {
  const baseTotalSql = `COALESCE(${totalsAlias}.base_sale_total, 0)`;
  const vatPctSql = `COALESCE(${versionAlias}.summary_vat_pct, ${DEFAULT_QUOTATION_VAT_PCT})`;
  const totalWithPerItemVatSql = `CASE
      WHEN ${versionAlias}.summary_vat_mode = 'per_item'
        THEN ${baseTotalSql} * (1 + (${vatPctSql} / 100))
      ELSE ${baseTotalSql}
    END`;
  const discountedTotalSql = `CASE
      WHEN ${versionAlias}.summary_distribution_mode = 'per_item'
        THEN ${totalWithPerItemVatSql}
      WHEN ${versionAlias}.summary_discount_mode = 'amount'
        THEN GREATEST(
          ${totalWithPerItemVatSql} - LEAST(COALESCE(${versionAlias}.summary_discount_value, 0), ${totalWithPerItemVatSql}),
          0
        )
      WHEN ${versionAlias}.summary_discount_mode = 'percentage'
        THEN ${totalWithPerItemVatSql} *
          (1 - (LEAST(GREATEST(COALESCE(${versionAlias}.summary_discount_value, 0), 0), 100) / 100))
      ELSE ${totalWithPerItemVatSql}
    END`;

  return `CASE
      WHEN ${versionAlias}.id IS NULL THEN NULL
      WHEN ${versionAlias}.summary_vat_mode = 'total'
        THEN ${discountedTotalSql} * (1 + (${vatPctSql} / 100))
      ELSE ${discountedTotalSql}
    END`;
}

async function loadQuarterTargetSummaryByQuarter({ user, year, sellerUserId }) {
  const hasGlobalScope = hasGlobalOpportunityScope(user);
  const sellerFilter = toPositiveInt(sellerUserId);
  const result = new Map();

  for (let quarter = 1; quarter <= 4; quarter += 1) {
    const periodRows = await query(
      `SELECT p.id,
              p.base_currency_code,
             v.id AS version_id,
             v.label AS version_label
       FROM commercial_planning_periods p
       LEFT JOIN commercial_planning_versions v ON v.id = (
         SELECT v2.id
         FROM commercial_planning_versions v2
         WHERE v2.period_id = p.id AND v2.published_at IS NOT NULL
         ORDER BY v2.published_at DESC, v2.version_number DESC, v2.id DESC
         LIMIT 1
       )
        WHERE p.plan_year = ? AND p.plan_quarter = ?
       ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
                p.id DESC
       LIMIT 1`,
      [year, quarter],
    ).catch(() => []);

    const periodRow = periodRows[0] || null;
    if (!periodRow?.version_id) {
      result.set(quarter, {
        quotaSalesAmountUsd: 0,
        quotaContributionAmountUsd: 0,
        versionLabel: null,
      });
      continue;
    }

    const params = [Number(periodRow.version_id)];
    const where = ["t.version_id = ?", "t.status <> 'void'"];

    if (!hasGlobalScope) {
      where.push("t.seller_user_id = ?");
      params.push(Number(user.id) || 0);
    }
    if (sellerFilter) {
      where.push("t.seller_user_id = ?");
      params.push(sellerFilter);
    }

    const targetRows = await query(
      `SELECT SUM(COALESCE(t.sales_quota_amount, 0)) AS sales_quota_amount,
              SUM(COALESCE(t.expected_contribution_amount, 0)) AS expected_contribution_amount
       FROM commercial_planning_targets t
       WHERE ${where.join(" AND ")}`,
      params,
    ).catch(() => []);

    const targetRow = targetRows[0] || {};
    result.set(quarter, {
      quotaSalesAmountUsd: toAmount(targetRow.sales_quota_amount || 0),
      quotaContributionAmountUsd: toAmount(
        targetRow.expected_contribution_amount || 0,
      ),
      versionLabel: periodRow.version_label || null,
    });
  }

  return result;
}

async function listWonQuotationContributionByOpportunity(opportunityIds) {
  const normalizedIds = (opportunityIds || [])
    .map((id) => Number(id || 0))
    .filter((id) => Number.isInteger(id) && id > 0);
  if (!normalizedIds.length) {
    return new Map();
  }

  const placeholders = normalizedIds.map(() => "?").join(", ");
  const rows = await query(
    `SELECT q.opportunity_id,
            SUM(
              (${buildQuotationVersionContributionSql({ versionAlias: "qv", totalsAlias: "quotation_total" })}) *
              CASE
                WHEN UPPER(COALESCE(qv.currency_code, 'USD')) = 'USD' THEN 1
                WHEN COALESCE(qv.exchange_rate, 0) > 0 THEN 1 / qv.exchange_rate
                ELSE 1
              END
            ) AS contribution_amount_usd
     FROM quotations q
     INNER JOIN quotation_versions qv ON qv.id = (
       SELECT qv2.id
       FROM quotation_versions qv2
       INNER JOIN quotation_statuses qs2 ON qs2.id = qv2.status_id
       WHERE qv2.quotation_id = q.id
         AND qs2.code = 'ganada'
       ORDER BY qv2.version_number DESC, qv2.id DESC
       LIMIT 1
     )
     ${buildQuotationVersionBaseSaleTotalJoin("qv")}
     WHERE q.opportunity_id IN (${placeholders})
     GROUP BY q.opportunity_id`,
    normalizedIds,
  ).catch(() => []);

  return new Map(
    rows.map((row) => [
      Number(row.opportunity_id),
      toAmount(row.contribution_amount_usd || 0),
    ]),
  );
}

function formatCompactCurrency(value) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

async function listScopedOpportunities(user, filters = {}) {
  const params = [];
  const ownershipJoin = buildOwnershipJoin(user, params);
  const where = ["1 = 1", "oas.code = 'activada'"];

  if (!hasGlobalOpportunityScope(user)) {
    params.push(Number(user.id));
    where.push("(ao_scope.user_id IS NOT NULL OR o.created_by = ?)");
  }

  if (filters.sellerUserId) {
    params.push(Number(filters.sellerUserId));
    where.push("o.seller_user_id = ?");
  }

  if (filters.businessLineId) {
    params.push(Number(filters.businessLineId));
    where.push("o.business_line_id = ?");
  }

  if (filters.closeDateFrom) {
    params.push(filters.closeDateFrom);
    where.push("o.close_date >= ?");
  }

  if (filters.closeDateTo) {
    params.push(filters.closeDateTo);
    where.push("o.close_date <= ?");
  }

  if (filters.createdAtLte) {
    params.push(filters.createdAtLte);
    where.push("o.created_at <= ?");
  }

  return query(
    `SELECT o.id, o.name, o.account_id, o.amount_usd, o.close_date,
            o.sales_stage_id, o.commercial_status_id, o.activation_status_id,
            o.business_line_id, o.seller_user_id, o.created_at, o.updated_at,
            o.commercial_closed_at, o.commercial_close_reason,
            a.name AS account_name,
            oss.code AS sales_stage_code,
            oss.name AS sales_stage_name,
            oss.stage_order AS sales_stage_order,
            ocs.code AS commercial_status_code,
            ocs.name AS commercial_status_name,
            oas.code AS activation_status_code,
            su.full_name AS seller_user_name,
            obl.name AS business_line_name
     FROM opportunities o
     ${ownershipJoin}
     INNER JOIN accounts a ON a.id = o.account_id
     INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
     INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
     INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
     LEFT JOIN users su ON su.id = o.seller_user_id
     LEFT JOIN opportunity_business_lines obl ON obl.id = o.business_line_id
     WHERE ${where.join(" AND ")}
     ORDER BY o.created_at DESC, o.id DESC`,
    params,
  );
}

async function listEligibleSellers() {
  const rows = await query(
    `SELECT DISTINCT u.id, u.full_name
     FROM users u
     INNER JOIN user_roles ur ON ur.user_id = u.id
     INNER JOIN roles r ON r.id = ur.role_id
     INNER JOIN role_permissions rp ON rp.role_id = ur.role_id
     INNER JOIN permissions p ON p.id = rp.permission_id
     WHERE u.status = 'active'
       AND r.is_active = 1
       AND p.code = ?`,
    [commercialSellerEligibilityPermission],
  );
  return new Set(rows.map((row) => Number(row.id || 0)));
}

async function listOpportunityLeadOrigins(opportunityIds) {
  if (!opportunityIds.length) {
    return new Map();
  }

  const placeholders = opportunityIds.map(() => "?").join(", ");
  const rows = await query(
    `SELECT related.opportunity_id,
            MAX(CASE WHEN related.analysis_status = 'lead_qualified' THEN 1 ELSE 0 END) AS from_qualified_lead
     FROM (
       SELECT i.primary_opportunity_id AS opportunity_id, i.analysis_status
       FROM interactions i
       WHERE i.primary_opportunity_id IN (${placeholders})

       UNION ALL

       SELECT l.opportunity_id, i.analysis_status
       FROM interaction_opportunity_links l
       INNER JOIN interactions i ON i.id = l.interaction_id
       WHERE l.opportunity_id IN (${placeholders})
     ) related
     GROUP BY related.opportunity_id`,
    [...opportunityIds, ...opportunityIds],
  ).catch(() => []);

  return rows.reduce((map, row) => {
    const opportunityId = Number(row.opportunity_id || 0);
    if (!opportunityId) {
      return map;
    }
    map.set(
      opportunityId,
      Number(row.from_qualified_lead || 0) > 0 ? "lead_qualified" : "direct",
    );
    return map;
  }, new Map());
}

function getForecastStageWeight(stageCode) {
  return _forecastStageWeightCache[String(stageCode || "")] || 0;
}

function getForecastStageOrder(stageCode, fallback = 0) {
  return Number(FORECAST_STAGE_ORDER[String(stageCode || "")]) || fallback;
}

function buildCloseTimingFlags(stageOrder, monthRange, closeDate) {
  const closeDateValue = closeDate ? startOfDay(closeDate) : null;
  const daysToMonthEnd = getDiffDays(new Date(), monthRange.end);
  const closesThisMonth =
    closeDateValue &&
    closeDateValue >= monthRange.start &&
    closeDateValue <= monthRange.end;

  return {
    closesThisMonth: Boolean(closesThisMonth),
    earlyStageMonthlyClose:
      Boolean(closesThisMonth) && stageOrder > 0 && stageOrder <= 2,
    midStageLateMonthlyClose:
      Boolean(closesThisMonth) &&
      stageOrder === 3 &&
      Number.isFinite(daysToMonthEnd) &&
      daysToMonthEnd <= 10,
  };
}

function buildForecastQualityAssessment({
  openItem,
  row,
  monthRange,
  stageOrder,
}) {
  const hasNextStep = Boolean(openItem?.nextStep);
  const blocked = openItem?.executionStateCode === "bloqueada";
  const stale = Boolean(openItem?.isStale);
  const highAmountHighRisk =
    Number(openItem?.amountUsd || row?.amount_usd || 0) >= 100000 &&
    ["bloqueada", "sin_conduccion", "esperando_interno"].includes(
      String(openItem?.executionStateCode || ""),
    );
  const timingFlags = buildCloseTimingFlags(
    stageOrder,
    monthRange,
    row?.close_date,
  );

  const issueFlags = {
    noNextStep: !hasNextStep,
    blocked,
    stale,
    highAmountHighRisk,
    earlyStageMonthlyClose: timingFlags.earlyStageMonthlyClose,
    midStageLateMonthlyClose: timingFlags.midStageLateMonthlyClose,
  };

  const issueCount = Object.values(issueFlags).filter(Boolean).length;
  const severeContradiction =
    issueFlags.earlyStageMonthlyClose ||
    (blocked && stale) ||
    (blocked && highAmountHighRisk);

  let qualityCode = "good";
  if (severeContradiction || issueCount >= 3) {
    qualityCode = "critical";
  } else if (issueCount === 2) {
    qualityCode = "weak";
  } else if (issueCount === 1) {
    qualityCode = "medium";
  } else if (
    hasNextStep &&
    !blocked &&
    !stale &&
    stageOrder >= 5 &&
    timingFlags.closesThisMonth
  ) {
    qualityCode = "excellent";
  }

  const qualityScoreMap = {
    excellent: 96,
    good: 84,
    medium: 63,
    weak: 38,
    critical: 14,
  };

  return {
    qualityCode,
    qualityLabel:
      qualityCode === "excellent"
        ? "Excelente"
        : qualityCode === "good"
          ? "Buena"
          : qualityCode === "medium"
            ? "Media"
            : qualityCode === "weak"
              ? "Debil"
              : "Critica",
    qualityFactor: FORECAST_QUALITY_FACTORS[qualityCode] || 0,
    qualityScore: qualityScoreMap[qualityCode] || 0,
    issueFlags,
  };
}

function clampForecastWeight({ weight, stageOrder, issueFlags }) {
  let nextWeight = Math.max(0, Math.min(Number(weight || 0), 0.9));

  if (stageOrder >= 1 && stageOrder <= 3) {
    nextWeight = Math.min(nextWeight, 0.35);
  }
  if (issueFlags.blocked) {
    nextWeight = Math.min(nextWeight, 0.5);
  }
  if (issueFlags.noNextStep) {
    nextWeight = Math.min(nextWeight, 0.45);
  }
  if (issueFlags.stale) {
    nextWeight = Math.min(nextWeight, 0.35);
  }
  if (issueFlags.earlyStageMonthlyClose) {
    nextWeight = Math.min(nextWeight, 0.15);
  }

  return toAmount(nextWeight);
}

function getForecastCategory({
  weight,
  stageOrder,
  issueFlags,
  executionStateCode,
}) {
  if (
    weight >= 0.7 &&
    stageOrder >= 5 &&
    !issueFlags.noNextStep &&
    !issueFlags.blocked &&
    !issueFlags.stale &&
    executionStateCode !== "sin_conduccion"
  ) {
    return "committed";
  }

  if (
    weight >= 0.35 &&
    stageOrder >= 3 &&
    !issueFlags.earlyStageMonthlyClose &&
    !issueFlags.blocked
  ) {
    return "probable";
  }

  return "weak";
}

function buildOpportunityRecommendedAction(item) {
  if (item.issueFlags?.blocked) {
    return "Destrabar dependencia critica y confirmar responsable del siguiente paso.";
  }
  if (item.issueFlags?.noNextStep) {
    return "Definir siguiente paso con fecha antes de sostener el cierre del mes.";
  }
  if (item.issueFlags?.stale) {
    return "Reactivar la oportunidad con actividad ejecutiva y confirmar vigencia del cierre.";
  }
  if (item.issueFlags?.earlyStageMonthlyClose) {
    return "Refechar el cierre o acelerar la calificacion; hoy el mes esta inflado.";
  }
  if (item.issueFlags?.highAmountHighRisk) {
    return "Escalar revision gerencial por alto monto con riesgo operativo.";
  }
  return "Proteger el siguiente paso y validar criterio de avance antes del cierre.";
}

function summarizeTopReasons(items = []) {
  const counts = new Map();
  items.forEach((item) => {
    const reason = String(item.commercial_close_reason || "").trim();
    if (!reason) {
      return;
    }
    const current = counts.get(reason) || { reason, total: 0, amountUsd: 0 };
    current.total += 1;
    current.amountUsd = toAmount(
      current.amountUsd + Number(item.amount_usd || 0),
    );
    counts.set(reason, current);
  });

  return Array.from(counts.values())
    .sort((left, right) => {
      if (right.total !== left.total) {
        return right.total - left.total;
      }
      return right.amountUsd - left.amountUsd;
    })
    .slice(0, 3);
}

function buildStatusBreakdown(items = [], statusCode) {
  const filtered = items.filter(
    (item) => String(item.commercial_status_code || "") === statusCode,
  );
  const dominantStage = filtered.reduce((accumulator, item) => {
    const key = String(item.sales_stage_code || "sin_etapa");
    const current = accumulator.get(key) || {
      stageCode: key,
      stageName: item.sales_stage_name || "Sin etapa",
      total: 0,
      amountUsd: 0,
    };
    current.total += 1;
    current.amountUsd = toAmount(
      current.amountUsd + Number(item.amount_usd || 0),
    );
    accumulator.set(key, current);
    return accumulator;
  }, new Map());

  const dominantStageRow =
    Array.from(dominantStage.values()).sort((left, right) => {
      if (right.total !== left.total) {
        return right.total - left.total;
      }
      return right.amountUsd - left.amountUsd;
    })[0] || null;

  return {
    total: filtered.length,
    amountUsd: toAmount(sumAmounts(filtered)),
    dominantStage: dominantStageRow,
    topReasons: summarizeTopReasons(filtered),
  };
}

function buildDashboardMonthlyRecommendations({
  monthlyQuotaAmount,
  realWonAmount,
  forecastCommittedAmount,
  forecastProbableAmount,
  weakAmount,
  qualitySummary,
  criticalOpportunities,
}) {
  const recommendations = [];
  const remainingGap = Math.max(
    Number(monthlyQuotaAmount || 0) -
      (Number(realWonAmount || 0) +
        Number(forecastCommittedAmount || 0) +
        Number(forecastProbableAmount || 0)),
    0,
  );

  if (qualitySummary.blocked.amountUsd > 0) {
    recommendations.push({
      code: "blocked",
      title: `Destrabar ${qualitySummary.blocked.total} oportunidades por ${formatCompactCurrency(qualitySummary.blocked.amountUsd)}.`,
      impactLabel: "Protege el forecast comprometido y probable.",
    });
  }

  if (qualitySummary.noNextStep.amountUsd > 0) {
    recommendations.push({
      code: "next_step",
      title: `Definir siguiente paso en ${qualitySummary.noNextStep.total} oportunidades por ${formatCompactCurrency(qualitySummary.noNextStep.amountUsd)}.`,
      impactLabel: "Evita sostener el mes con cierres sin conduccion visible.",
    });
  }

  if (weakAmount > 0) {
    recommendations.push({
      code: "weak",
      title: `Depurar o reemplazar ${formatCompactCurrency(weakAmount)} de forecast debil.`,
      impactLabel: "Reduce inflado del mes y mejora credibilidad ejecutiva.",
    });
  }

  if (remainingGap > 0) {
    recommendations.push({
      code: "gap",
      title: `Cerrar una brecha neta de ${formatCompactCurrency(remainingGap)} con rescate o reemplazo de pipeline.`,
      impactLabel:
        "El mes no se cubre solo con ganado y forecast defendible actual.",
    });
  }

  if (criticalOpportunities.length > 0) {
    recommendations.push({
      code: "critical",
      title: `Intervenir ${Math.min(criticalOpportunities.length, 3)} oportunidades criticas de mayor impacto.`,
      impactLabel: "Cambian directamente el semaforo del mes.",
    });
  }

  return recommendations.slice(0, 5);
}

function buildMonthlyQuotaStatus({
  monthlyQuotaAmount,
  realWonAmount,
  forecastCommittedAmount,
  forecastProbableAmount,
  weakAmount,
  forecastGrossAmount,
  criticalOpportunities,
}) {
  const conservative = toAmount(realWonAmount + forecastCommittedAmount);
  const base = toAmount(conservative + forecastProbableAmount);
  const extended = toAmount(base + weakAmount);
  const weakShare =
    forecastGrossAmount > 0 ? weakAmount / forecastGrossAmount : 0;
  const concentrated =
    criticalOpportunities.length > 0 &&
    criticalOpportunities
      .slice(0, 3)
      .reduce((sum, item) => sum + Number(item.weightedAmountUsd || 0), 0) >=
      (realWonAmount + forecastCommittedAmount + forecastProbableAmount) * 0.5;

  let code = "red";
  if (conservative >= monthlyQuotaAmount && weakShare < 0.2 && !concentrated) {
    code = "green";
  } else if (base >= monthlyQuotaAmount && weakShare <= 0.35) {
    code = "yellow";
  }

  return {
    code,
    label: code === "green" ? "Verde" : code === "yellow" ? "Amarillo" : "Rojo",
    message:
      code === "green"
        ? "El mes esta cubierto con una combinacion defendible de ganado y forecast comprometido."
        : code === "yellow"
          ? "El mes puede cumplirse, pero depende de correcciones operativas y oportunidades fragiles."
          : "El mes no esta cubierto con el forecast actual y requiere reemplazo o rescate inmediato.",
    concentrated,
    weakShare: toAmount(weakShare * 100),
    scenarios: {
      conservative,
      base,
      extended,
    },
  };
}

function buildMonthlyQuotaDashboardPayload({
  monthRange,
  quarterQuota,
  scopedOpportunities,
  openItems,
  originByOpportunity,
}) {
  const monthlyQuotaAmount = quarterQuota?.quotaAmount
    ? toAmount(Number(quarterQuota.quotaAmount || 0) / 3)
    : null;
  const openItemsByOpportunityId = new Map(
    openItems.map((item) => [Number(item.opportunityId || 0), item]),
  );

  const monthItems = scopedOpportunities.filter((item) =>
    isBetween(item.close_date, monthRange.start, monthRange.end),
  );
  const wonItems = monthItems.filter(
    (item) => String(item.commercial_status_code || "") === "ganada",
  );
  const forecastItems = monthItems
    .filter(
      (item) =>
        !["ganada", "perdida", "anulada"].includes(
          String(item.commercial_status_code || ""),
        ),
    )
    .map((row) => {
      const opportunityId = Number(row.id || 0);
      const openItem = openItemsByOpportunityId.get(opportunityId) || null;
      const stageOrder =
        Number(row.sales_stage_order || 0) ||
        getForecastStageOrder(row.sales_stage_code, 0);
      const assessment = buildForecastQualityAssessment({
        openItem,
        row,
        monthRange,
        stageOrder,
      });
      const baseWeight = getForecastStageWeight(row.sales_stage_code);
      const unclampedWeight = baseWeight * assessment.qualityFactor;
      const weight = clampForecastWeight({
        weight: unclampedWeight,
        stageOrder,
        issueFlags: assessment.issueFlags,
      });
      const category = getForecastCategory({
        weight,
        stageOrder,
        issueFlags: assessment.issueFlags,
        executionStateCode: openItem?.executionStateCode,
      });
      const amountUsd = Number(row.amount_usd || 0);
      const weightedAmountUsd = toAmount(amountUsd * weight);
      const stageWeightedAmountUsd = toAmount(amountUsd * baseWeight);
      const origin = originByOpportunity.get(opportunityId) || "direct";

      return {
        id: opportunityId,
        opportunityId,
        name: row.name || "",
        accountName: row.account_name || "",
        sellerUserName: row.seller_user_name || "Sin vendedor",
        amountUsd,
        weightedAmountUsd,
        stageWeightedAmountUsd,
        weight,
        weightPercent: toAmount(weight * 100),
        category,
        categoryLabel: FORECAST_CATEGORY_LABELS[category] || category,
        stageCode: row.sales_stage_code || "",
        stageName: row.sales_stage_name || "",
        stageOrder,
        closeDate: row.close_date || null,
        commercialStatusCode: row.commercial_status_code || "",
        executionStateCode: openItem?.executionStateCode || null,
        qualityCode: assessment.qualityCode,
        qualityLabel: assessment.qualityLabel,
        qualityScore: assessment.qualityScore,
        issueFlags: assessment.issueFlags,
        hasNextStep: Boolean(openItem?.nextStep),
        nextStepTitle: openItem?.nextStep?.title || "",
        isBlocked: assessment.issueFlags.blocked,
        isStale: assessment.issueFlags.stale,
        origin,
        recommendedAction: buildOpportunityRecommendedAction({
          issueFlags: assessment.issueFlags,
        }),
      };
    });

  const forecastGrossAmount = toAmount(
    forecastItems.reduce((sum, item) => sum + Number(item.amountUsd || 0), 0),
  );
  const forecastWeightedAmount = toAmount(
    forecastItems.reduce(
      (sum, item) => sum + Number(item.weightedAmountUsd || 0),
      0,
    ),
  );
  const forecastWeightedAmountByStage = toAmount(
    forecastItems.reduce(
      (sum, item) => sum + Number(item.stageWeightedAmountUsd || 0),
      0,
    ),
  );
  const committedItems = forecastItems.filter(
    (item) => item.category === "committed",
  );
  const probableItems = forecastItems.filter(
    (item) => item.category === "probable",
  );
  const weakItems = forecastItems.filter((item) => item.category === "weak");
  const forecastCommittedAmount = toAmount(
    committedItems.reduce((sum, item) => sum + Number(item.amountUsd || 0), 0),
  );
  const forecastProbableAmount = toAmount(
    probableItems.reduce((sum, item) => sum + Number(item.amountUsd || 0), 0),
  );
  const weakAmount = toAmount(
    weakItems.reduce((sum, item) => sum + Number(item.amountUsd || 0), 0),
  );
  const realWonAmount = toAmount(sumAmounts(wonItems));
  const totalExpectedAmount = toAmount(
    realWonAmount + forecastWeightedAmountByStage,
  );
  const gapAmount =
    monthlyQuotaAmount === null
      ? null
      : toAmount(Math.max(monthlyQuotaAmount - totalExpectedAmount, 0));

  const qualityGroups = {
    noNextStep: forecastItems.filter((item) => item.issueFlags.noNextStep),
    blocked: forecastItems.filter((item) => item.issueFlags.blocked),
    stale: forecastItems.filter((item) => item.issueFlags.stale),
    inconsistentClose: forecastItems.filter(
      (item) =>
        item.issueFlags.earlyStageMonthlyClose ||
        item.issueFlags.midStageLateMonthlyClose,
    ),
    highAmountHighRisk: forecastItems.filter(
      (item) => item.issueFlags.highAmountHighRisk,
    ),
  };
  const qualitySummary = Object.fromEntries(
    Object.entries(qualityGroups).map(([key, items]) => [
      key,
      {
        total: items.length,
        amountUsd: toAmount(
          items.reduce((sum, item) => sum + Number(item.amountUsd || 0), 0),
        ),
      },
    ]),
  );

  const stageMap = forecastItems.reduce((accumulator, item) => {
    const key = String(item.stageCode || "sin_etapa");
    const current = accumulator.get(key) || {
      stageCode: key,
      stageName: item.stageName || "Sin etapa",
      stageOrder: item.stageOrder || 0,
      opportunities: 0,
      grossAmountUsd: 0,
      weightedAmountUsd: 0,
      wonCount: 0,
      committedCount: 0,
      probableCount: 0,
      weakCount: 0,
      riskLabel: "Sin observaciones",
    };
    current.opportunities += 1;
    current.grossAmountUsd = toAmount(
      current.grossAmountUsd + Number(item.amountUsd || 0),
    );
    current.weightedAmountUsd = toAmount(
      current.weightedAmountUsd + Number(item.stageWeightedAmountUsd || 0),
    );
    if (item.category === "committed") current.committedCount += 1;
    if (item.category === "probable") current.probableCount += 1;
    if (item.category === "weak") current.weakCount += 1;
    if (item.issueFlags.blocked) {
      current.riskLabel = "Bloqueadas";
    } else if (item.issueFlags.noNextStep) {
      current.riskLabel = "Sin siguiente paso";
    } else if (item.issueFlags.stale) {
      current.riskLabel = "Sin actividad reciente";
    }
    accumulator.set(key, current);
    return accumulator;
  }, new Map());

  const originMap = new Map();
  [...wonItems, ...forecastItems].forEach((item) => {
    const opportunityId = Number(item.id || item.opportunityId || 0);
    const origin =
      item.origin || originByOpportunity.get(opportunityId) || "direct";
    const current = originMap.get(origin) || {
      origin,
      label: origin === "lead_qualified" ? "Desde lead calificado" : "Directas",
      total: 0,
      grossAmountUsd: 0,
      weightedAmountUsd: 0,
      wonAmountUsd: 0,
      committedCount: 0,
      probableCount: 0,
      weakCount: 0,
      wonCount: 0,
    };
    current.total += 1;
    current.grossAmountUsd = toAmount(
      current.grossAmountUsd + Number(item.amount_usd || item.amountUsd || 0),
    );
    if (item.weightedAmountUsd !== undefined) {
      current.weightedAmountUsd = toAmount(
        current.weightedAmountUsd + Number(item.weightedAmountUsd || 0),
      );
      if (item.category === "committed") current.committedCount += 1;
      if (item.category === "probable") current.probableCount += 1;
      if (item.category === "weak") current.weakCount += 1;
    }
    if (
      String(item.commercial_status_code || item.commercialStatusCode || "") ===
      "ganada"
    ) {
      current.wonCount += 1;
      current.wonAmountUsd = toAmount(
        current.wonAmountUsd + Number(item.amount_usd || item.amountUsd || 0),
      );
    }
    originMap.set(origin, current);
  });

  const criticalOpportunities = [...forecastItems]
    .sort((left, right) => {
      const leftRiskScore =
        Number(left.issueFlags.blocked) * 4 +
        Number(left.issueFlags.noNextStep) * 3 +
        Number(left.issueFlags.stale) * 2 +
        Number(left.issueFlags.highAmountHighRisk) * 2 +
        Number(left.issueFlags.earlyStageMonthlyClose) * 3;
      const rightRiskScore =
        Number(right.issueFlags.blocked) * 4 +
        Number(right.issueFlags.noNextStep) * 3 +
        Number(right.issueFlags.stale) * 2 +
        Number(right.issueFlags.highAmountHighRisk) * 2 +
        Number(right.issueFlags.earlyStageMonthlyClose) * 3;
      if (rightRiskScore !== leftRiskScore) {
        return rightRiskScore - leftRiskScore;
      }
      if (Number(right.amountUsd || 0) !== Number(left.amountUsd || 0)) {
        return Number(right.amountUsd || 0) - Number(left.amountUsd || 0);
      }
      return (
        Number(right.weightedAmountUsd || 0) -
        Number(left.weightedAmountUsd || 0)
      );
    })
    .slice(0, 8);

  const status = buildMonthlyQuotaStatus({
    monthlyQuotaAmount: Number(monthlyQuotaAmount || 0),
    realWonAmount,
    forecastCommittedAmount,
    forecastProbableAmount,
    weakAmount,
    forecastGrossAmount,
    criticalOpportunities,
  });
  const recommendations = buildDashboardMonthlyRecommendations({
    monthlyQuotaAmount: Number(monthlyQuotaAmount || 0),
    realWonAmount,
    forecastCommittedAmount,
    forecastProbableAmount,
    weakAmount,
    qualitySummary,
    criticalOpportunities,
  });

  return {
    quota: {
      quarterAmount: quarterQuota?.quotaAmount ?? null,
      monthAmount: monthlyQuotaAmount,
      currencyCode: quarterQuota?.currencyCode || "USD",
    },
    headline: {
      realWonAmount,
      forecastWeightedAmount: forecastWeightedAmountByStage,
      totalExpectedAmount,
      gapAmount,
      realAttainmentPercent:
        monthlyQuotaAmount && monthlyQuotaAmount > 0
          ? toAmount((realWonAmount / monthlyQuotaAmount) * 100)
          : null,
      expectedAttainmentPercent:
        monthlyQuotaAmount && monthlyQuotaAmount > 0
          ? toAmount((totalExpectedAmount / monthlyQuotaAmount) * 100)
          : null,
      coverageRatio:
        monthlyQuotaAmount && monthlyQuotaAmount > 0
          ? toAmount(
              (forecastCommittedAmount + forecastProbableAmount) /
                Math.max(monthlyQuotaAmount - realWonAmount, 1),
            )
          : null,
    },
    forecastBuckets: {
      committed: {
        amountUsd: forecastCommittedAmount,
        weightedAmountUsd: toAmount(
          committedItems.reduce(
            (sum, item) => sum + Number(item.weightedAmountUsd || 0),
            0,
          ),
        ),
        total: committedItems.length,
      },
      probable: {
        amountUsd: forecastProbableAmount,
        weightedAmountUsd: toAmount(
          probableItems.reduce(
            (sum, item) => sum + Number(item.weightedAmountUsd || 0),
            0,
          ),
        ),
        total: probableItems.length,
      },
      weak: {
        amountUsd: weakAmount,
        weightedAmountUsd: toAmount(
          weakItems.reduce(
            (sum, item) => sum + Number(item.weightedAmountUsd || 0),
            0,
          ),
        ),
        total: weakItems.length,
      },
      grossAmountUsd: forecastGrossAmount,
      weightedAmountUsd: forecastWeightedAmount,
    },
    status,
    scenarios: {
      conservativeAmount: status.scenarios.conservative,
      baseAmount: status.scenarios.base,
      extendedAmount: status.scenarios.extended,
    },
    qualitySummary,
    stageFunnel: Array.from(stageMap.values()).sort(
      (left, right) => left.stageOrder - right.stageOrder,
    ),
    losses: buildStatusBreakdown(monthItems, "perdida"),
    cancelled: buildStatusBreakdown(monthItems, "anulada"),
    originSummary: Array.from(originMap.values()).sort((left, right) =>
      String(left.label).localeCompare(String(right.label), "es", {
        sensitivity: "base",
      }),
    ),
    criticalOpportunities,
    recommendations,
  };
}

async function listNextSteps(opportunityIds) {
  if (!opportunityIds.length) {
    return new Map();
  }

  const placeholders = opportunityIds.map(() => "?").join(", ");
  const typePlaceholders = NEXT_STEP_ACTION_TYPES.map(() => "?").join(", ");
  const rows = await query(
    `SELECT id, opportunity_id, action_type, status, title, due_date,
            owner_user_id, is_primary_next_step
     FROM opportunity_workspace_actions
     WHERE opportunity_id IN (${placeholders})
       AND action_type IN (${typePlaceholders})
       AND status IN ('pending', 'in_progress', 'blocked')
     ORDER BY opportunity_id ASC, is_primary_next_step DESC,
              due_date IS NULL ASC, due_date ASC, id ASC`,
    [...opportunityIds, ...NEXT_STEP_ACTION_TYPES],
  ).catch(() => []);

  const map = new Map();
  rows.forEach((row) => {
    const opportunityId = Number(row.opportunity_id || 0);
    if (!opportunityId || map.has(opportunityId)) return;
    map.set(opportunityId, {
      id: Number(row.id),
      title: row.title || "",
      actionType: row.action_type || "next_step",
      status: row.status || "pending",
      dueDate: row.due_date || null,
      ownerUserId:
        row.owner_user_id === null || row.owner_user_id === undefined
          ? null
          : Number(row.owner_user_id),
      isOverdue: row.due_date ? getDiffDays(row.due_date) > 0 : false,
    });
  });
  return map;
}

async function listOpenDependencies(opportunityIds) {
  if (!opportunityIds.length) {
    return [];
  }

  const placeholders = opportunityIds.map(() => "?").join(", ");
  return query(
    `SELECT d.id, d.opportunity_id, d.status, d.due_date
     FROM commercial_execution_dependencies d
     WHERE d.opportunity_id IN (${placeholders})
       AND d.status IN ('open', 'blocked')`,
    opportunityIds,
  ).catch(() => []);
}

function setLatestActivityTimestamp(
  activityByOpportunity,
  opportunityId,
  value,
) {
  const parsed = value ? new Date(value) : null;
  if (
    !Number.isInteger(opportunityId) ||
    opportunityId <= 0 ||
    !parsed ||
    Number.isNaN(parsed.getTime())
  ) {
    return;
  }

  const current = activityByOpportunity.get(opportunityId);
  if (!current || parsed.getTime() > current.getTime()) {
    activityByOpportunity.set(opportunityId, parsed);
  }
}

async function listLastActivityByOpportunity(opportunityIds) {
  if (!opportunityIds.length) {
    return new Map();
  }

  const placeholders = opportunityIds.map(() => "?").join(", ");
  const actionTypePlaceholders = NEXT_STEP_ACTION_TYPES.map(() => "?").join(
    ", ",
  );

  const [actionRows, dependencyRows, answerRows, auditRows, interactionRows] =
    await Promise.all([
      query(
        `SELECT opportunity_id, MAX(COALESCE(updated_at, created_at)) AS last_activity_at
         FROM opportunity_workspace_actions
         WHERE opportunity_id IN (${placeholders})
           AND action_type IN (${actionTypePlaceholders})
         GROUP BY opportunity_id`,
        [...opportunityIds, ...NEXT_STEP_ACTION_TYPES],
      ).catch(() => []),
      query(
        `SELECT opportunity_id, MAX(COALESCE(updated_at, created_at)) AS last_activity_at
         FROM commercial_execution_dependencies
         WHERE opportunity_id IN (${placeholders})
         GROUP BY opportunity_id`,
        opportunityIds,
      ).catch(() => []),
      query(
        `SELECT opportunity_id, MAX(answered_at) AS last_activity_at
         FROM opportunity_stage_question_answers
         WHERE opportunity_id IN (${placeholders})
         GROUP BY opportunity_id`,
        opportunityIds,
      ).catch(() => []),
      query(
        `SELECT entity_id AS opportunity_id, MAX(created_at) AS last_activity_at
         FROM audit_logs
         WHERE entity_type = 'opportunity'
           AND entity_id IN (${placeholders})
         GROUP BY entity_id`,
        opportunityIds,
      ).catch(() => []),
      query(
        `SELECT related.opportunity_id, MAX(related.created_at) AS last_activity_at
         FROM (
           SELECT i.primary_opportunity_id AS opportunity_id, i.created_at
           FROM interactions i
           WHERE i.primary_opportunity_id IN (${placeholders})
           UNION ALL
           SELECT l.opportunity_id, i.created_at
           FROM interaction_opportunity_links l
           INNER JOIN interactions i ON i.id = l.interaction_id
           WHERE l.opportunity_id IN (${placeholders})
         ) related
         GROUP BY related.opportunity_id`,
        [...opportunityIds, ...opportunityIds],
      ).catch(() => []),
    ]);

  const activityByOpportunity = new Map();
  [actionRows, dependencyRows, answerRows, auditRows, interactionRows].forEach(
    (rows) => {
      rows.forEach((row) => {
        setLatestActivityTimestamp(
          activityByOpportunity,
          Number(row.opportunity_id || 0),
          row.last_activity_at,
        );
      });
    },
  );

  return activityByOpportunity;
}

async function listAuditEvents(opportunityIds, actions, start, end) {
  if (!opportunityIds.length || !actions.length) {
    return [];
  }

  const opportunityPlaceholders = opportunityIds.map(() => "?").join(", ");
  const actionPlaceholders = actions.map(() => "?").join(", ");
  return query(
    `SELECT entity_id, action, created_at
     FROM audit_logs
     WHERE entity_type = 'opportunity'
       AND entity_id IN (${opportunityPlaceholders})
       AND action IN (${actionPlaceholders})
       AND created_at >= ?
       AND created_at <= ?`,
    [...opportunityIds, ...actions, start, end],
  ).catch(() => []);
}

function getExecutionState({ nextStep, dependencies }) {
  const openDependencies = dependencies.filter(
    (item) => item.status === "open",
  );
  const blockedDependencies = dependencies.filter(
    (item) =>
      item.status === "blocked" ||
      (item.due_date && getDiffDays(item.due_date) > 0),
  );

  if (blockedDependencies.length > 0) {
    return { code: "bloqueada", label: "Bloqueada" };
  }
  if (openDependencies.length > 0) {
    return { code: "esperando_interno", label: "Esperando interno" };
  }
  if (!nextStep) {
    return { code: "sin_conduccion", label: "Sin siguiente paso" };
  }
  if (nextStep.actionType === "waiting_customer") {
    return { code: "esperando_cliente", label: "Esperando cliente" };
  }
  if (nextStep.isOverdue) {
    return { code: "vencida", label: "Seguimiento vencido" };
  }
  return { code: "en_curso", label: "En curso" };
}

function buildPeriods(from, to, granularity) {
  const periods = [];
  let cursor = startOfDay(from);

  if (granularity === "month") {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    while (cursor <= to) {
      const periodStart = new Date(cursor);
      const periodEnd = endOfDay(
        new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0),
      );
      periods.push({
        key: `${periodStart.getFullYear()}-${String(periodStart.getMonth() + 1).padStart(2, "0")}`,
        label: formatPeriodLabel(periodStart, "month"),
        start: periodStart,
        end: periodEnd > to ? endOfDay(to) : periodEnd,
      });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
    return periods;
  }

  cursor = getWeekStart(cursor);
  while (cursor <= to) {
    const periodStart = new Date(cursor);
    const naturalEnd = endOfDay(addDays(periodStart, 6));
    periods.push({
      key: formatIsoDate(periodStart),
      label: formatPeriodLabel(periodStart, "week"),
      start: periodStart,
      end: naturalEnd > to ? endOfDay(to) : naturalEnd,
    });
    cursor = addDays(cursor, 7);
  }
  return periods;
}

function isBetween(dateValue, start, end) {
  const date = dateValue ? new Date(dateValue) : null;
  if (!date || Number.isNaN(date.getTime())) return false;
  return date >= start && date <= end;
}

function isOpenAtDate(item, end) {
  const createdAt = item.created_at ? new Date(item.created_at) : null;
  const closedAt = item.commercial_closed_at
    ? new Date(item.commercial_closed_at)
    : null;
  if (!createdAt || Number.isNaN(createdAt.getTime()) || createdAt > end) {
    return false;
  }
  if (String(item.activation_status_code) !== "activada") {
    return false;
  }
  return !closedAt || closedAt > end;
}

function sumAmounts(items) {
  return toAmount(
    items.reduce((total, item) => total + Number(item.amount_usd || 0), 0),
  );
}

function buildVariation(current, previous) {
  const deltaAbsolute = current - previous;
  return {
    current,
    previous,
    deltaAbsolute,
    deltaPercent:
      previous > 0 ? toAmount((deltaAbsolute / previous) * 100) : null,
  };
}

function buildPriorityScore(item) {
  let score = 0;
  if (item.executionStateCode === "bloqueada") score += 40;
  if (item.executionStateCode === "sin_conduccion") score += 32;
  if (item.isStale) score += 24;
  if (item.executionStateCode === "esperando_interno") score += 20;
  if (item.nextStep?.isOverdue) score += 14;
  score += Math.min(20, Math.round(Number(item.amountUsd || 0) / 50000));
  return score;
}

async function buildOpenOpportunityItems(user, filters = {}) {
  const scopedOpportunities =
    filters.scopedOpportunities ||
    (await listScopedOpportunities(user, filters));
  const openRows = scopedOpportunities.filter(
    (item) =>
      String(item.activation_status_code) === "activada" &&
      String(item.commercial_status_code) === "en_proceso",
  );
  const opportunityIds = openRows.map((item) => Number(item.id));
  const [
    nextSteps,
    dependencyRows,
    lastActivityByOpportunity,
    stageAdvancedRows,
  ] = await Promise.all([
    listNextSteps(opportunityIds),
    listOpenDependencies(opportunityIds),
    listLastActivityByOpportunity(opportunityIds),
    listAuditEvents(
      opportunityIds,
      ["stage_advanced"],
      filters.weekRange.start,
      filters.weekRange.end,
    ),
  ]);

  const dependenciesByOpportunity = dependencyRows.reduce(
    (accumulator, row) => {
      const key = Number(row.opportunity_id || 0);
      const current = accumulator.get(key) || [];
      current.push(row);
      accumulator.set(key, current);
      return accumulator;
    },
    new Map(),
  );
  const advancedThisWeekIds = new Set(
    stageAdvancedRows.map((row) => Number(row.entity_id || 0)).filter(Boolean),
  );
  const stageSlaMap = await loadStageSlaMap();

  return openRows
    .map((row) => {
      const opportunityId = Number(row.id);
      const nextStep = nextSteps.get(opportunityId) || null;
      const dependencies = dependenciesByOpportunity.get(opportunityId) || [];
      const executionState = getExecutionState({ nextStep, dependencies });
      const lastActivity = lastActivityByOpportunity.get(opportunityId) || null;
      const slaDays = stageSlaMap[row.sales_stage_code] || 5;
      const daysSinceActivity = lastActivity
        ? getDiffDays(lastActivity)
        : getDiffDays(row.updated_at || row.created_at);
      const isStale = daysSinceActivity > slaDays;

      return {
        opportunityId,
        opportunityName: row.name || "",
        accountId: Number(row.account_id),
        accountName: row.account_name || "",
        sellerUserId:
          row.seller_user_id === null || row.seller_user_id === undefined
            ? null
            : Number(row.seller_user_id),
        sellerUserName: row.seller_user_name || "Sin vendedor",
        businessLineId: Number(row.business_line_id || 0),
        businessLineName: row.business_line_name || "",
        stageCode: row.sales_stage_code || "",
        stageName: row.sales_stage_name || "",
        amountUsd: Number(row.amount_usd || 0),
        closeDate: row.close_date || null,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
        nextStep,
        dependencies,
        executionStateCode: executionState.code,
        executionStateLabel: executionState.label,
        lastActivityAt: lastActivity
          ? lastActivity.toISOString()
          : row.updated_at,
        daysSinceActivity,
        slaDays,
        isStale,
        advancedThisWeek: advancedThisWeekIds.has(opportunityId),
      };
    })
    .map((item) => ({
      ...item,
      priorityScore: buildPriorityScore(item),
    }))
    .sort((left, right) => {
      if (right.priorityScore !== left.priorityScore) {
        return right.priorityScore - left.priorityScore;
      }
      return Number(right.amountUsd || 0) - Number(left.amountUsd || 0);
    });
}

async function buildWonOpportunityItems(user, filters = {}) {
  const scopedOpportunities =
    filters.scopedOpportunities ||
    (await listScopedOpportunities(user, filters));
  const wonRows = scopedOpportunities.filter((item) =>
    isRealWonOpportunity(item),
  );
  const opportunityIds = wonRows.map((item) => Number(item.id));
  const [
    nextSteps,
    dependencyRows,
    lastActivityByOpportunity,
    stageAdvancedRows,
  ] = await Promise.all([
    listNextSteps(opportunityIds),
    listOpenDependencies(opportunityIds),
    listLastActivityByOpportunity(opportunityIds),
    listAuditEvents(
      opportunityIds,
      ["stage_advanced"],
      filters.weekRange.start,
      filters.weekRange.end,
    ),
  ]);

  const dependenciesByOpportunity = dependencyRows.reduce(
    (accumulator, row) => {
      const key = Number(row.opportunity_id || 0);
      const current = accumulator.get(key) || [];
      current.push(row);
      accumulator.set(key, current);
      return accumulator;
    },
    new Map(),
  );
  const advancedThisWeekIds = new Set(
    stageAdvancedRows.map((row) => Number(row.entity_id || 0)).filter(Boolean),
  );
  const stageSlaMap = await loadStageSlaMap();

  return wonRows
    .map((row) => {
      const opportunityId = Number(row.id);
      const nextStep = nextSteps.get(opportunityId) || null;
      const dependencies = dependenciesByOpportunity.get(opportunityId) || [];
      const lastActivity = lastActivityByOpportunity.get(opportunityId) || null;
      const slaDays = stageSlaMap[row.sales_stage_code] || 5;
      const daysSinceActivity = lastActivity
        ? getDiffDays(lastActivity)
        : getDiffDays(row.updated_at || row.created_at);

      return {
        opportunityId,
        opportunityName: row.name || "",
        accountId: Number(row.account_id),
        accountName: row.account_name || "",
        sellerUserId:
          row.seller_user_id === null || row.seller_user_id === undefined
            ? null
            : Number(row.seller_user_id),
        sellerUserName: row.seller_user_name || "Sin vendedor",
        businessLineId: Number(row.business_line_id || 0),
        businessLineName: row.business_line_name || "",
        stageCode: row.sales_stage_code || "",
        stageName: row.sales_stage_name || "",
        amountUsd: Number(row.amount_usd || 0),
        closeDate: row.close_date || null,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
        nextStep,
        dependencies,
        executionStateCode: "ganada",
        executionStateLabel: row.commercial_status_name || "Ganada",
        lastActivityAt: lastActivity
          ? lastActivity.toISOString()
          : row.updated_at,
        daysSinceActivity,
        slaDays,
        isStale: daysSinceActivity > slaDays,
        advancedThisWeek: advancedThisWeekIds.has(opportunityId),
      };
    })
    .sort((left, right) => {
      if (Number(right.amountUsd || 0) !== Number(left.amountUsd || 0)) {
        return Number(right.amountUsd || 0) - Number(left.amountUsd || 0);
      }

      return String(left.opportunityName || "").localeCompare(
        String(right.opportunityName || ""),
      );
    });
}

function buildVariationWithBase(current, previous, hasPrevious = true) {
  if (!hasPrevious) {
    return {
      current,
      previous: null,
      deltaAbsolute: null,
      deltaPercent: null,
      hasPrevious: false,
    };
  }

  return {
    ...buildVariation(current, previous),
    hasPrevious: true,
  };
}

function isRealWonOpportunity(item = {}) {
  return (
    String(item.commercial_status_code || item.commercialStatusCode || "") ===
      "ganada" ||
    String(item.sales_stage_code || item.stageCode || "") === "ganada"
  );
}

async function buildQuarterQuotaSummary(
  user,
  { referenceDate = new Date(), sellerUserId = null } = {},
) {
  const quarter = getQuarterSelection(referenceDate);
  const sellerFilter = toPositiveInt(sellerUserId);
  const periodRows = await query(
    `SELECT p.id, p.plan_year, p.plan_quarter, p.base_currency_code, p.status,
            v.id AS version_id, v.version_number, v.status AS version_status, v.label AS version_label
     FROM commercial_planning_periods p
     LEFT JOIN commercial_planning_versions v ON v.id = (
       SELECT v2.id
       FROM commercial_planning_versions v2
       WHERE v2.period_id = p.id AND v2.published_at IS NOT NULL
       ORDER BY v2.published_at DESC, v2.version_number DESC, v2.id DESC
       LIMIT 1
     )
     WHERE p.plan_year = ? AND p.plan_quarter = ?
     ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
              p.id DESC
     LIMIT 1`,
    [quarter.year, quarter.quarter],
  ).catch(() => []);

  const periodRow = periodRows[0] || null;
  const targetParams = [];
  const targetWhere = [];

  if (periodRow?.version_id) {
    targetParams.push(Number(periodRow.version_id));
    if (!hasGlobalOpportunityScope(user)) {
      targetWhere.push("t.seller_user_id = ?");
      targetParams.push(Number(user.id) || 0);
    }
    if (sellerFilter) {
      targetWhere.push("t.seller_user_id = ?");
      targetParams.push(sellerFilter);
    }
  }

  const targetRows = periodRow?.version_id
    ? await query(
        `SELECT t.seller_user_id, t.sales_quota_amount, t.currency_code
         FROM commercial_planning_targets t
         WHERE t.version_id = ?
           AND t.status <> 'void'
           ${targetWhere.length ? `AND ${targetWhere.join(" AND ")}` : ""}`,
        targetParams,
      ).catch(() => [])
    : [];

  const quarterOpportunities = await listScopedOpportunities(user, {
    sellerUserId: sellerFilter,
    closeDateFrom: formatIsoDate(quarter.start),
    closeDateTo: formatIsoDate(quarter.end),
  });
  const wonItems = quarterOpportunities.filter((item) =>
    isRealWonOpportunity(item),
  );

  const quotaAmount = targetRows.length
    ? toAmount(
        targetRows.reduce(
          (total, item) => total + Number(item.sales_quota_amount || 0),
          0,
        ),
      )
    : null;
  const wonAmount = toAmount(
    wonItems.reduce((total, item) => total + Number(item.amount_usd || 0), 0),
  );
  const gapAmount =
    quotaAmount === null
      ? null
      : toAmount(Math.max(quotaAmount - wonAmount, 0));
  const attainmentPercent =
    quotaAmount && quotaAmount > 0
      ? toAmount((wonAmount / quotaAmount) * 100)
      : null;

  return {
    period: {
      year: quarter.year,
      quarter: quarter.quarter,
      label: quarter.label,
    },
    scope: {
      sellerUserId: sellerFilter,
      businessLineIgnored: true,
    },
    hasPlan: Boolean(periodRow),
    hasPublishedVersion: Boolean(periodRow?.version_id),
    currencyCode:
      targetRows[0]?.currency_code || periodRow?.base_currency_code || "USD",
    quotaAmount,
    wonAmount,
    gapAmount,
    attainmentPercent,
    isCovered: quotaAmount !== null ? wonAmount >= quotaAmount : false,
  };
}

async function buildForecastMonthlyPayload(user, params = {}) {
  const sellerUserId = toPositiveInt(params.sellerUserId);
  const businessLineId = toPositiveInt(params.businessLineId);
  const viewMode =
    String(params.viewMode || "count").trim() === "amount" ? "amount" : "count";
  const monthRange = getMonthRange(params.month);
  const validWeeks = buildWeeksForRange(monthRange.start, monthRange.end);
  const fallbackWeek = validWeeks[0] || getWeekRange(monthRange.start);
  const activeWeekRange = normalizeWeekRangeForValidWeeks(
    params.weekStart,
    validWeeks,
    fallbackWeek,
  );
  const activeWeekKey = formatIsoDate(activeWeekRange.start);
  const activeWeekIndex = validWeeks.findIndex(
    (week) => week.key === activeWeekKey,
  );
  const previousWeek =
    activeWeekIndex > 0 ? validWeeks[activeWeekIndex - 1] : null;

  const scopedOpportunities = await listScopedOpportunities(user, {
    sellerUserId,
    businessLineId,
    closeDateFrom: formatIsoDate(monthRange.start),
    closeDateTo: formatIsoDate(monthRange.end),
  });
  const visibleOpportunities = await listScopedOpportunities(user, {
    sellerUserId,
    businessLineId,
  });

  const openItems = await buildOpenOpportunityItems(user, {
    sellerUserId,
    businessLineId,
    weekRange: activeWeekRange,
    scopedOpportunities,
  });
  const currentWeekCreated = visibleOpportunities.filter((item) =>
    isBetween(item.created_at, activeWeekRange.start, activeWeekRange.end),
  );
  const previousWeekCreated = previousWeek
    ? visibleOpportunities.filter((item) =>
        isBetween(item.created_at, previousWeek.start, previousWeek.end),
      )
    : [];
  const currentWeekWon = scopedOpportunities.filter(
    (item) =>
      item.commercial_status_code === "ganada" &&
      isBetween(
        item.commercial_closed_at,
        activeWeekRange.start,
        activeWeekRange.end,
      ),
  );
  const previousWeekWon = previousWeek
    ? scopedOpportunities.filter(
        (item) =>
          item.commercial_status_code === "ganada" &&
          isBetween(
            item.commercial_closed_at,
            previousWeek.start,
            previousWeek.end,
          ),
      )
    : [];
  const currentWeekLost = scopedOpportunities.filter(
    (item) =>
      ["perdida", "anulada"].includes(String(item.commercial_status_code)) &&
      isBetween(
        item.commercial_closed_at,
        activeWeekRange.start,
        activeWeekRange.end,
      ),
  );
  const previousWeekLost = previousWeek
    ? scopedOpportunities.filter(
        (item) =>
          ["perdida", "anulada"].includes(
            String(item.commercial_status_code),
          ) &&
          isBetween(
            item.commercial_closed_at,
            previousWeek.start,
            previousWeek.end,
          ),
      )
    : [];
  const openAtPreviousWeekEnd = previousWeek
    ? scopedOpportunities.filter((item) => isOpenAtDate(item, previousWeek.end))
    : [];
  const previousAdvancedRows = previousWeek
    ? await listAuditEvents(
        openAtPreviousWeekEnd
          .map((item) => Number(item.id || 0))
          .filter(Boolean),
        ["stage_advanced"],
        previousWeek.start,
        previousWeek.end,
      )
    : [];
  const previousAdvanced = new Set(
    previousAdvancedRows
      .map((row) => Number(row.entity_id || 0))
      .filter(Boolean),
  ).size;
  const currentAdvanced = openItems.filter(
    (item) => item.advancedThisWeek,
  ).length;

  const noNextStep = openItems.filter((item) => !item.nextStep).slice(0, 5);
  const blocked = openItems
    .filter((item) => item.executionStateCode === "bloqueada")
    .slice(0, 5);
  const stale = openItems.filter((item) => item.isStale).slice(0, 5);
  const highAmountHighRisk = openItems
    .filter(
      (item) =>
        item.amountUsd >= 100000 &&
        ["bloqueada", "sin_conduccion", "esperando_interno"].includes(
          item.executionStateCode,
        ),
    )
    .slice(0, 5);

  const openItemsByOpportunityId = new Map(
    openItems.map((item) => [Number(item.opportunityId || 0), item]),
  );

  const forecastOpportunities = scopedOpportunities
    .map((row) => {
      const opportunityId = Number(row.id || 0);
      const openItem = openItemsByOpportunityId.get(opportunityId) || null;
      const noNextStep = openItem ? !openItem.nextStep : false;
      const blocked = openItem
        ? openItem.executionStateCode === "bloqueada"
        : false;
      const stale = openItem ? openItem.isStale : false;
      const highAmountHighRisk = openItem
        ? openItem.amountUsd >= 100000 &&
          ["bloqueada", "sin_conduccion", "esperando_interno"].includes(
            openItem.executionStateCode,
          )
        : false;
      const flagCount = [noNextStep, blocked, stale, highAmountHighRisk].filter(
        Boolean,
      ).length;

      return {
        id: opportunityId,
        opportunityId,
        name: row.name || "",
        accountName: row.account_name || "",
        sellerUserName: row.seller_user_name || "Sin vendedor",
        amountUsd: Number(row.amount_usd || 0),
        stageName: row.sales_stage_name || "",
        closeDate: row.close_date || null,
        commercialStatusCode: row.commercial_status_code || "",
        lastActivityAt: openItem?.lastActivityAt || null,
        hasNextStep: openItem ? Boolean(openItem.nextStep) : true,
        isBlocked: blocked,
        isStale: stale,
        isHighAmountHighRisk: highAmountHighRisk,
        flagCount,
        priorityScore: Number(openItem?.priorityScore || 0),
      };
    })
    .sort((left, right) => {
      if (right.flagCount !== left.flagCount) {
        return right.flagCount - left.flagCount;
      }

      if (right.priorityScore !== left.priorityScore) {
        return right.priorityScore - left.priorityScore;
      }

      if (Number(right.amountUsd || 0) !== Number(left.amountUsd || 0)) {
        return Number(right.amountUsd || 0) - Number(left.amountUsd || 0);
      }

      const leftLastActivity = left.lastActivityAt
        ? new Date(left.lastActivityAt).getTime()
        : 0;
      const rightLastActivity = right.lastActivityAt
        ? new Date(right.lastActivityAt).getTime()
        : 0;
      if (leftLastActivity !== rightLastActivity) {
        return leftLastActivity - rightLastActivity;
      }

      const leftCloseDate = left.closeDate
        ? new Date(left.closeDate).getTime()
        : Number.MAX_SAFE_INTEGER;
      const rightCloseDate = right.closeDate
        ? new Date(right.closeDate).getTime()
        : Number.MAX_SAFE_INTEGER;
      if (leftCloseDate !== rightCloseDate) {
        return leftCloseDate - rightCloseDate;
      }

      return String(left.name || "").localeCompare(String(right.name || ""));
    });

  const generationTrend = validWeeks.map((week) => {
    const created = scopedOpportunities.filter((item) =>
      isBetween(item.created_at, week.start, week.end),
    );
    return {
      periodKey: week.key,
      periodLabel: week.label,
      createdCount: created.length,
      createdAmountUsd: sumAmounts(created),
    };
  });

  const pipelineMovementMap = openItems.reduce((accumulator, item) => {
    const key = String(item.stageCode || "sin_etapa");
    const current = accumulator.get(key) || {
      stageCode: item.stageCode,
      stageName: item.stageName,
      openCount: 0,
      advancedInWeek: 0,
      blockedCount: 0,
      staleCount: 0,
      totalAmountUsd: 0,
    };
    current.openCount += 1;
    if (item.advancedThisWeek) current.advancedInWeek += 1;
    if (item.executionStateCode === "bloqueada") current.blockedCount += 1;
    if (item.isStale) current.staleCount += 1;
    current.totalAmountUsd = toAmount(
      current.totalAmountUsd + Number(item.amountUsd || 0),
    );
    accumulator.set(key, current);
    return accumulator;
  }, new Map());
  const quarterQuota = await buildQuarterQuotaSummary(user, {
    referenceDate: monthRange.start,
    sellerUserId,
  });
  const originByOpportunity = await listOpportunityLeadOrigins(
    scopedOpportunities.map((item) => Number(item.id || 0)).filter(Boolean),
  );
  const dashboardMonthly = buildMonthlyQuotaDashboardPayload({
    monthRange,
    quarterQuota,
    scopedOpportunities,
    openItems,
    originByOpportunity,
  });

  return {
    meta: {
      month: monthRange.month,
      monthStart: formatIsoDate(monthRange.start),
      monthEnd: formatIsoDate(monthRange.end),
      activeWeekStart: formatIsoDate(activeWeekRange.start),
      activeWeekEnd: formatIsoDate(activeWeekRange.end),
      previousWeekStart: previousWeek
        ? formatIsoDate(previousWeek.start)
        : null,
      previousWeekEnd: previousWeek ? formatIsoDate(previousWeek.end) : null,
      validWeeks,
      sellerUserId,
      businessLineId,
      viewMode,
    },
    summary: {
      openOpportunities: openItems.length,
      openAmountUsd: sumAmounts(
        openItems.map((item) => ({ amount_usd: item.amountUsd })),
      ),
      newThisWeek: currentWeekCreated.length,
      newAmountUsd: sumAmounts(currentWeekCreated),
      advancedThisWeek: currentAdvanced,
      blockedOpenOpportunities: openItems.filter(
        (item) => item.executionStateCode === "bloqueada",
      ).length,
    },
    weekChange: {
      newThisWeek: buildVariationWithBase(
        currentWeekCreated.length,
        previousWeekCreated.length,
        Boolean(previousWeek),
      ),
      advancedThisWeek: buildVariationWithBase(
        currentAdvanced,
        previousAdvanced,
        Boolean(previousWeek),
      ),
      wonThisWeek: buildVariationWithBase(
        currentWeekWon.length,
        previousWeekWon.length,
        Boolean(previousWeek),
      ),
      lostThisWeek: buildVariationWithBase(
        currentWeekLost.length,
        previousWeekLost.length,
        Boolean(previousWeek),
      ),
    },
    immediateAttention: {
      noNextStep,
      blocked,
      stale,
      highAmountHighRisk,
    },
    quarterQuota,
    dashboardMonthly,
    forecastOpportunities,
    generationTrend,
    pipelineMovement: Array.from(pipelineMovementMap.values()).sort(
      (left, right) => right.openCount - left.openCount,
    ),
  };
}

async function buildQuarterlyPerformancePayload(user, params = {}) {
  const year = toYearValue(params.year);
  const sellerUserId = toPositiveInt(params.sellerUserId);
  const businessLineId = toPositiveInt(params.businessLineId);

  const yearStart = startOfDay(new Date(year, 0, 1));
  const yearEnd = endOfDay(new Date(year, 11, 31));

  const scopedOpportunities = await listScopedOpportunities(user, {
    sellerUserId,
    businessLineId,
    closeDateFrom: formatIsoDate(yearStart),
    closeDateTo: formatIsoDate(yearEnd),
  });

  const eligibleSellerIds = await listEligibleSellers();

  const stageNameByCode = new Map();
  scopedOpportunities.forEach((item) => {
    const code = String(item.sales_stage_code || "").trim();
    if (!code) return;
    if (!stageNameByCode.has(code)) {
      stageNameByCode.set(code, item.sales_stage_name || code);
    }
  });

  const targetByQuarter = await loadQuarterTargetSummaryByQuarter({
    user,
    year,
    sellerUserId,
  });

  const wonOpportunityIds = scopedOpportunities
    .filter((item) => isRealWonOpportunity(item))
    .map((item) => Number(item.id || 0));
  const wonContributionByOpportunity =
    await listWonQuotationContributionByOpportunity(wonOpportunityIds);

  const quarters = [];
  for (let quarter = 1; quarter <= 4; quarter += 1) {
    const quarterRange = getQuarterRange(year, quarter);
    const quarterItems = scopedOpportunities.filter((item) =>
      isBetween(item.close_date, quarterRange.start, quarterRange.end),
    );

    const wonItems = quarterItems.filter((item) => isRealWonOpportunity(item));
    const openFunnelItems = quarterItems.filter((item) =>
      isOpenPipelineStatus(item.commercial_status_code),
    );

    const stageMap = openFunnelItems.reduce((accumulator, item) => {
      const stageCode = String(item.sales_stage_code || "sin_etapa");
      const current = accumulator.get(stageCode) || {
        stageCode,
        stageName:
          item.sales_stage_name ||
          stageNameByCode.get(stageCode) ||
          "Sin etapa",
        stageOrder: Number(item.sales_stage_order ?? 9999),
        openAmountUsd: 0,
        opportunityCount: 0,
      };
      current.openAmountUsd += Number(item.amount_usd || 0);
      current.opportunityCount += 1;
      accumulator.set(stageCode, current);
      return accumulator;
    }, new Map());

    const funnelOpenAmountUsd = toAmount(
      openFunnelItems.reduce(
        (sum, item) => sum + Number(item.amount_usd || 0),
        0,
      ),
    );

    const funnelByStage = Array.from(stageMap.values())
      .map((item) => ({
        stageCode: item.stageCode,
        stageName: item.stageName,
        stageOrder: item.stageOrder,
        openAmountUsd: toAmount(item.openAmountUsd),
        opportunityCount: Number(item.opportunityCount || 0),
        stageSharePct: funnelOpenAmountUsd
          ? toAmount(
              (Number(item.openAmountUsd || 0) / funnelOpenAmountUsd) * 100,
            )
          : 0,
      }))
      .sort(
        (left, right) =>
          Number(left.stageOrder || 0) - Number(right.stageOrder || 0),
      );

    const sellerFunnelMap = openFunnelItems.reduce((accumulator, item) => {
      const sellerUserId = Number(item.seller_user_id || 0) || null;
      const sellerKey = sellerUserId
        ? `seller-${sellerUserId}`
        : `seller-unknown-${String(item.seller_user_name || "Sin vendedor")}`;
      const currentSeller = accumulator.get(sellerKey) || {
        sellerUserId,
        sellerUserName: item.seller_user_name || "Sin vendedor",
        openAmountUsd: 0,
        opportunityCount: 0,
        stageMap: new Map(),
      };

      currentSeller.openAmountUsd += Number(item.amount_usd || 0);
      currentSeller.opportunityCount += 1;

      const stageCode = String(item.sales_stage_code || "sin_etapa");
      const currentStage = currentSeller.stageMap.get(stageCode) || {
        stageCode,
        stageName:
          item.sales_stage_name ||
          stageNameByCode.get(stageCode) ||
          "Sin etapa",
        stageOrder: Number(item.sales_stage_order ?? 9999),
        openAmountUsd: 0,
        opportunityCount: 0,
      };
      currentStage.openAmountUsd += Number(item.amount_usd || 0);
      currentStage.opportunityCount += 1;
      currentSeller.stageMap.set(stageCode, currentStage);

      accumulator.set(sellerKey, currentSeller);
      return accumulator;
    }, new Map());

    const funnelBySeller = Array.from(sellerFunnelMap.values())
      .filter(
        (seller) =>
          Boolean(seller.sellerUserId) &&
          eligibleSellerIds.has(Number(seller.sellerUserId)),
      )
      .map((seller) => {
        const sellerOpenAmountUsd = toAmount(seller.openAmountUsd || 0);
        return {
          sellerUserId: seller.sellerUserId,
          sellerUserName: seller.sellerUserName,
          openAmountUsd: sellerOpenAmountUsd,
          opportunityCount: Number(seller.opportunityCount || 0),
          funnelByStage: Array.from(seller.stageMap.values())
            .map((stage) => ({
              stageCode: stage.stageCode,
              stageName: stage.stageName,
              stageOrder: stage.stageOrder,
              openAmountUsd: toAmount(stage.openAmountUsd),
              opportunityCount: Number(stage.opportunityCount || 0),
              stageSharePct: sellerOpenAmountUsd
                ? toAmount(
                    (Number(stage.openAmountUsd || 0) / sellerOpenAmountUsd) *
                      100,
                  )
                : 0,
            }))
            .sort(
              (left, right) =>
                Number(left.stageOrder || 0) - Number(right.stageOrder || 0),
            ),
        };
      })
      .sort((left, right) =>
        String(left.sellerUserName || "").localeCompare(
          String(right.sellerUserName || ""),
          "es",
          { sensitivity: "base" },
        ),
      );

    const targetSummary = targetByQuarter.get(quarter) || {
      quotaSalesAmountUsd: 0,
      quotaContributionAmountUsd: 0,
    };

    const actualSalesAmountUsd = toAmount(
      wonItems.reduce((sum, item) => sum + Number(item.amount_usd || 0), 0),
    );
    const actualContributionAmountUsd = toAmount(
      wonItems.reduce(
        (sum, item) =>
          sum +
          Number(wonContributionByOpportunity.get(Number(item.id || 0)) || 0),
        0,
      ),
    );

    const salesGapAmountUsd = toAmount(
      actualSalesAmountUsd - Number(targetSummary.quotaSalesAmountUsd || 0),
    );
    const contributionGapAmountUsd = toAmount(
      actualContributionAmountUsd -
        Number(targetSummary.quotaContributionAmountUsd || 0),
    );

    const salesMissingAmount = Math.max(
      Number(targetSummary.quotaSalesAmountUsd || 0) - actualSalesAmountUsd,
      0,
    );
    const winsNeeded = Math.ceil(
      salesMissingAmount / QUARTERLY_AVG_WON_TICKET_USD,
    );

    quarters.push({
      quarter,
      label: quarterRange.label,
      startDate: formatIsoDate(quarterRange.start),
      endDate: formatIsoDate(quarterRange.end),
      versionLabel: (targetByQuarter.get(quarter) || {}).versionLabel || null,
      quotaSalesAmountUsd: toAmount(targetSummary.quotaSalesAmountUsd || 0),
      actualSalesAmountUsd,
      salesGapAmountUsd,
      salesAttainmentPct: Number(targetSummary.quotaSalesAmountUsd || 0)
        ? toAmount(
            (actualSalesAmountUsd /
              Number(targetSummary.quotaSalesAmountUsd || 0)) *
              100,
          )
        : null,
      quotaContributionAmountUsd: toAmount(
        targetSummary.quotaContributionAmountUsd || 0,
      ),
      actualContributionAmountUsd,
      contributionGapAmountUsd,
      contributionAttainmentPct: Number(
        targetSummary.quotaContributionAmountUsd || 0,
      )
        ? toAmount(
            (actualContributionAmountUsd /
              Number(targetSummary.quotaContributionAmountUsd || 0)) *
              100,
          )
        : null,
      funnelOpenAmountUsd,
      funnelByStage,
      funnelBySeller,
      opportunitiesMissingCount:
        winsNeeded * QUARTERLY_OPPORTUNITIES_TO_WON_RATIO,
      leadsMissingCount: winsNeeded * QUARTERLY_LEADS_TO_WON_RATIO,
    });
  }

  return {
    year,
    currencyCode: "USD",
    assumptions: {
      avgWonTicketUsd: QUARTERLY_AVG_WON_TICKET_USD,
      opportunitiesToWonRatio: QUARTERLY_OPPORTUNITIES_TO_WON_RATIO,
      leadsToWonRatio: QUARTERLY_LEADS_TO_WON_RATIO,
    },
    quarters,
  };
}

async function loadCurrentQuarterTargetsBySeller({ user, quarterSelection }) {
  const periodRows = await query(
    `SELECT p.id,
            p.base_currency_code,
            p.plan_year,
            p.plan_quarter,
            v.id AS version_id,
            v.label AS version_label
     FROM commercial_planning_periods p
     LEFT JOIN commercial_planning_versions v ON v.id = (
       SELECT v2.id
       FROM commercial_planning_versions v2
       WHERE v2.period_id = p.id
         AND v2.published_at IS NOT NULL
       ORDER BY v2.published_at DESC, v2.version_number DESC, v2.id DESC
       LIMIT 1
     )
     WHERE p.plan_year = ?
       AND p.plan_quarter = ?
     ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
              p.id DESC
     LIMIT 1`,
    [quarterSelection.year, quarterSelection.quarter],
  ).catch(() => []);

  const periodRow = periodRows[0] || null;
  if (!periodRow?.version_id) {
    return {
      hasPlan: Boolean(periodRow),
      hasPublishedVersion: false,
      versionLabel: null,
      currencyCode: periodRow?.base_currency_code || "USD",
      targetBySellerId: new Map(),
    };
  }

  const params = [Number(periodRow.version_id)];
  const whereClauses = ["t.version_id = ?", "t.status <> 'void'"];
  if (!hasGlobalOpportunityScope(user)) {
    whereClauses.push("t.seller_user_id = ?");
    params.push(Number(user.id) || 0);
  }

  const targetRows = await query(
    `SELECT t.seller_user_id,
            u.full_name AS seller_user_name,
            SUM(COALESCE(t.sales_quota_amount, 0)) AS sales_quota_amount
     FROM commercial_planning_targets t
     LEFT JOIN users u ON u.id = t.seller_user_id
     WHERE ${whereClauses.join(" AND ")}
     GROUP BY t.seller_user_id, u.full_name`,
    params,
  ).catch(() => []);

  const targetBySellerId = new Map();
  targetRows.forEach((row) => {
    const sellerUserId = Number(row.seller_user_id || 0);
    if (!sellerUserId) {
      return;
    }
    targetBySellerId.set(sellerUserId, {
      sellerUserId,
      sellerUserName: row.seller_user_name || "Sin vendedor",
      quotaAmountUsd: toAmount(row.sales_quota_amount || 0),
    });
  });

  return {
    hasPlan: true,
    hasPublishedVersion: true,
    versionLabel: periodRow.version_label || null,
    currencyCode: periodRow.base_currency_code || "USD",
    targetBySellerId,
  };
}

async function loadQuarterLeadCountsBySeller({ user, quarterSelection }) {
  const params = [quarterSelection.start, addDays(quarterSelection.end, 1)];
  const whereClauses = [
    "i.seller_user_id IS NOT NULL",
    "i.analysis_status IN ('created', 'lead_unassigned', 'lead_assigned', 'lead_qualified', 'lead_disqualified')",
    "i.created_at >= ?",
    "i.created_at < ?",
  ];

  if (!hasGlobalOpportunityScope(user)) {
    whereClauses.push("i.seller_user_id = ?");
    params.push(Number(user.id) || 0);
  }

  const rows = await query(
    `SELECT i.seller_user_id, COUNT(*) AS lead_count
     FROM interactions i
     WHERE ${whereClauses.join(" AND ")}
     GROUP BY i.seller_user_id`,
    params,
  ).catch(() => []);

  return new Map(
    rows
      .map((row) => [
        Number(row.seller_user_id || 0),
        Number(row.lead_count || 0),
      ])
      .filter(([sellerUserId]) => sellerUserId > 0),
  );
}

async function loadQuarterQualifiedLeadCountsBySeller({
  user,
  quarterSelection,
}) {
  const params = [quarterSelection.start, addDays(quarterSelection.end, 1)];
  const whereClauses = [
    "i.seller_user_id IS NOT NULL",
    "i.analysis_status = 'lead_qualified'",
    "i.created_at >= ?",
    "i.created_at < ?",
  ];

  if (!hasGlobalOpportunityScope(user)) {
    whereClauses.push("i.seller_user_id = ?");
    params.push(Number(user.id) || 0);
  }

  const rows = await query(
    `SELECT i.seller_user_id, COUNT(*) AS lead_count
     FROM interactions i
     WHERE ${whereClauses.join(" AND ")}
     GROUP BY i.seller_user_id`,
    params,
  ).catch(() => []);

  return new Map(
    rows
      .map((row) => [
        Number(row.seller_user_id || 0),
        Number(row.lead_count || 0),
      ])
      .filter(([sellerUserId]) => sellerUserId > 0),
  );
}

async function loadSellerParametersBySeller() {
  await ensureSellerParameterSchemaReady().catch(() => null);
  const rows = await query(
    `SELECT seller_user_id,
            average_sale_ticket_amount,
            leads_to_opportunities_ratio,
          opportunities_to_wins_ratio,
          average_opportunity_to_win_days,
          use_hist_avg_ticket_quota_prob,
          use_hist_l2o_quota_prob,
          use_hist_o2w_quota_prob,
          use_hist_avg_o2w_days_quota_prob,
          use_historical_values_for_quota_probability
     FROM commercial_planning_seller_parameters`,
  ).catch(() => []);

  return new Map(
    rows
      .map((row) => {
        const sellerUserId = Number(row.seller_user_id || 0);
        if (!sellerUserId) return null;
        return [
          sellerUserId,
          {
            averageSaleTicketAmount: Number(
              row.average_sale_ticket_amount || 0,
            ),
            leadsToOpportunitiesRatio: Number(
              row.leads_to_opportunities_ratio || 0,
            ),
            opportunitiesToWinsRatio: Number(
              row.opportunities_to_wins_ratio || 0,
            ),
            averageOpportunityToWinDays: Number(
              row.average_opportunity_to_win_days || 0,
            ),
            useHistoricalAverageSaleTicketForQuotaProbability:
              Number(row.use_hist_avg_ticket_quota_prob || 0) > 0,
            useHistoricalLeadsToOpportunitiesForQuotaProbability:
              Number(row.use_hist_l2o_quota_prob || 0) > 0,
            useHistoricalOpportunitiesToWinsForQuotaProbability:
              Number(row.use_hist_o2w_quota_prob || 0) > 0,
            useHistoricalAverageOpportunityToWinDaysForQuotaProbability:
              Number(row.use_hist_avg_o2w_days_quota_prob || 0) > 0,
            useHistoricalValuesForQuotaProbability:
              Number(row.use_historical_values_for_quota_probability || 0) > 0,
          },
        ];
      })
      .filter(Boolean),
  );
}

async function loadQuarterCreatedOpportunityCountsBySeller({
  user,
  quarterSelection,
}) {
  const params = [quarterSelection.start, addDays(quarterSelection.end, 1)];
  const whereClauses = [
    "o.seller_user_id IS NOT NULL",
    "oas.code = 'activada'",
    "o.created_at >= ?",
    "o.created_at < ?",
  ];

  if (!hasGlobalOpportunityScope(user)) {
    whereClauses.push("o.seller_user_id = ?");
    params.push(Number(user.id) || 0);
  }

  const rows = await query(
    `SELECT o.seller_user_id, COUNT(*) AS opportunity_count
     FROM opportunities o
     INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
     WHERE ${whereClauses.join(" AND ")}
     GROUP BY o.seller_user_id`,
    params,
  ).catch(() => []);

  return new Map(
    rows
      .map((row) => [
        Number(row.seller_user_id || 0),
        Number(row.opportunity_count || 0),
      ])
      .filter(([sellerUserId]) => sellerUserId > 0),
  );
}

async function loadOpportunityCreatedWeeklySeriesBySeller({
  user,
  weeks = 10,
} = {}) {
  const normalizedWeeks = Math.max(1, Math.min(10, Number(weeks || 10)));
  const currentWeekRange = getWeekRange(new Date());
  const seriesStart = startOfDay(
    addDays(currentWeekRange.start, -(normalizedWeeks - 1) * 7),
  );
  const seriesEnd = endOfDay(currentWeekRange.end);

  const params = [seriesStart, addDays(seriesEnd, 1)];
  const whereClauses = [
    "o.seller_user_id IS NOT NULL",
    "oas.code = 'activada'",
    "o.created_at >= ?",
    "o.created_at < ?",
  ];

  if (!hasGlobalOpportunityScope(user)) {
    whereClauses.push("o.seller_user_id = ?");
    params.push(Number(user.id) || 0);
  }

  const rows = await query(
    `SELECT o.seller_user_id,
            DATE_SUB(DATE(o.created_at), INTERVAL WEEKDAY(o.created_at) DAY) AS week_start,
            COUNT(*) AS opportunity_count
     FROM opportunities o
     INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
     WHERE ${whereClauses.join(" AND ")}
     GROUP BY o.seller_user_id, week_start`,
    params,
  ).catch(() => []);

  if (!rows.length) {
    return new Map();
  }

  const weeksBySeller = new Map();
  rows.forEach((row) => {
    const sellerId = Number(row.seller_user_id || 0);
    const weekStart = row.week_start
      ? formatIsoDate(new Date(row.week_start))
      : null;
    const opportunityCount = Number(row.opportunity_count || 0);

    if (!sellerId || !weekStart) {
      return;
    }

    if (!weeksBySeller.has(sellerId)) {
      weeksBySeller.set(sellerId, new Map());
    }

    weeksBySeller.get(sellerId).set(weekStart, opportunityCount);
  });

  const weekKeys = Array.from({ length: normalizedWeeks }, (_, index) => {
    const weekStart = new Date(seriesStart);
    weekStart.setDate(weekStart.getDate() + index * 7);
    return formatIsoDate(weekStart);
  });

  return new Map(
    Array.from(weeksBySeller.entries()).map(([sellerId, sellerWeeks]) => [
      sellerId,
      weekKeys.map((weekKey) => Number(sellerWeeks.get(weekKey) || 0)),
    ]),
  );
}

async function loadLeadCreatedWeeklySeriesBySeller({ user, weeks = 10 } = {}) {
  const normalizedWeeks = Math.max(1, Math.min(10, Number(weeks || 10)));
  const currentWeekRange = getWeekRange(new Date());
  const seriesStart = startOfDay(
    addDays(currentWeekRange.start, -(normalizedWeeks - 1) * 7),
  );
  const seriesEnd = endOfDay(currentWeekRange.end);

  const params = [seriesStart, addDays(seriesEnd, 1)];
  const whereClauses = [
    "i.seller_user_id IS NOT NULL",
    "i.analysis_status IN ('created', 'lead_unassigned', 'lead_assigned', 'lead_qualified', 'lead_disqualified')",
    "i.created_at >= ?",
    "i.created_at < ?",
  ];

  if (!hasGlobalOpportunityScope(user)) {
    whereClauses.push("i.seller_user_id = ?");
    params.push(Number(user.id) || 0);
  }

  const rows = await query(
    `SELECT i.seller_user_id,
            DATE_SUB(DATE(i.created_at), INTERVAL WEEKDAY(i.created_at) DAY) AS week_start,
            COUNT(*) AS lead_count
     FROM interactions i
     WHERE ${whereClauses.join(" AND ")}
     GROUP BY i.seller_user_id, week_start`,
    params,
  ).catch(() => []);

  if (!rows.length) {
    return new Map();
  }

  const weeksBySeller = new Map();
  rows.forEach((row) => {
    const sellerId = Number(row.seller_user_id || 0);
    const weekStart = row.week_start
      ? formatIsoDate(new Date(row.week_start))
      : null;
    const leadCount = Number(row.lead_count || 0);

    if (!sellerId || !weekStart) {
      return;
    }

    if (!weeksBySeller.has(sellerId)) {
      weeksBySeller.set(sellerId, new Map());
    }

    weeksBySeller.get(sellerId).set(weekStart, leadCount);
  });

  const weekKeys = Array.from({ length: normalizedWeeks }, (_, index) => {
    const weekStart = new Date(seriesStart);
    weekStart.setDate(weekStart.getDate() + index * 7);
    return formatIsoDate(weekStart);
  });

  return new Map(
    Array.from(weeksBySeller.entries()).map(([sellerId, sellerWeeks]) => [
      sellerId,
      weekKeys.map((weekKey) => Number(sellerWeeks.get(weekKey) || 0)),
    ]),
  );
}

async function loadLeadToOpportunityConversionWeeklySeriesBySeller({
  user,
  weeks = 10,
} = {}) {
  const normalizedWeeks = Math.max(1, Math.min(10, Number(weeks || 10)));
  const currentWeekRange = getWeekRange(new Date());
  const seriesStart = startOfDay(
    addDays(currentWeekRange.start, -(normalizedWeeks - 1) * 7),
  );
  const seriesEnd = endOfDay(currentWeekRange.end);

  const params = [seriesStart, addDays(seriesEnd, 1)];
  const whereClauses = [
    "i.seller_user_id IS NOT NULL",
    "i.analysis_status IN ('created', 'lead_unassigned', 'lead_assigned', 'lead_qualified', 'lead_disqualified')",
    "i.created_at >= ?",
    "i.created_at < ?",
  ];

  if (!hasGlobalOpportunityScope(user)) {
    whereClauses.push("i.seller_user_id = ?");
    params.push(Number(user.id) || 0);
  }

  const rows = await query(
    `SELECT i.seller_user_id, i.id, i.created_at, i.analysis_status
     FROM interactions i
     WHERE ${whereClauses.join(" AND ")}
     ORDER BY i.seller_user_id, i.created_at, i.id`,
    params,
  ).catch(() => []);

  if (!rows.length) {
    return new Map();
  }

  const weekKeys = Array.from({ length: normalizedWeeks }, (_, index) => {
    const weekStart = new Date(seriesStart);
    weekStart.setDate(weekStart.getDate() + index * 7);
    return formatIsoDate(weekStart);
  });

  const leadsBySeller = new Map();
  rows.forEach((row) => {
    const sellerId = Number(row.seller_user_id || 0);
    const createdAt = row.created_at ? new Date(row.created_at) : null;
    if (!sellerId || !createdAt || Number.isNaN(createdAt.getTime())) {
      return;
    }

    if (!leadsBySeller.has(sellerId)) {
      leadsBySeller.set(sellerId, []);
    }

    leadsBySeller.get(sellerId).push({
      id: Number(row.id || 0),
      createdAt,
      isQualified: String(row.analysis_status || "") === "lead_qualified",
    });
  });

  return new Map(
    Array.from(leadsBySeller.entries()).map(([sellerId, sellerLeads]) => {
      const series = weekKeys.map((weekKey, index) => {
        const snapshotDate = new Date(seriesStart);
        snapshotDate.setDate(snapshotDate.getDate() + index * 7);

        const valuesAtSnapshot = sellerLeads
          .filter((lead) => lead.createdAt.getTime() <= snapshotDate.getTime())
          .sort((left, right) => {
            const dateDelta =
              right.createdAt.getTime() - left.createdAt.getTime();
            if (dateDelta !== 0) return dateDelta;
            return Number(right.id || 0) - Number(left.id || 0);
          })
          .slice(0, 20);

        if (!valuesAtSnapshot.length) {
          return 0;
        }

        const qualifiedCount = valuesAtSnapshot.reduce(
          (sum, lead) => sum + (lead.isQualified ? 1 : 0),
          0,
        );
        return toAmount((qualifiedCount / valuesAtSnapshot.length) * 100);
      });

      return [sellerId, series];
    }),
  );
}

async function loadOpportunityToWinConversionWeeklySeriesBySeller({
  user,
  weeks = 10,
} = {}) {
  const normalizedWeeks = Math.max(1, Math.min(10, Number(weeks || 10)));
  const currentWeekRange = getWeekRange(new Date());
  const seriesStart = startOfDay(
    addDays(currentWeekRange.start, -(normalizedWeeks - 1) * 7),
  );
  const seriesEnd = endOfDay(currentWeekRange.end);

  const params = [addDays(seriesEnd, 1)];
  const whereClauses = [
    "o.seller_user_id IS NOT NULL",
    "oas.code = 'activada'",
    "o.created_at < ?",
  ];

  if (!hasGlobalOpportunityScope(user)) {
    whereClauses.push("o.seller_user_id = ?");
    params.push(Number(user.id) || 0);
  }

  const rows = await query(
    `SELECT o.seller_user_id,
            o.id,
            o.created_at,
            ocs.code AS commercial_status_code,
            oss.code AS sales_stage_code
     FROM opportunities o
     INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
     INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
     INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
     WHERE ${whereClauses.join(" AND ")}
     ORDER BY o.seller_user_id, o.created_at DESC, o.id DESC`,
    params,
  ).catch(() => []);

  if (!rows.length) {
    return new Map();
  }

  const opportunitiesBySeller = new Map();
  rows.forEach((row) => {
    const sellerId = Number(row.seller_user_id || 0);
    const createdAt = row.created_at ? new Date(row.created_at) : null;

    if (!sellerId || !createdAt || Number.isNaN(createdAt.getTime())) {
      return;
    }

    if (!opportunitiesBySeller.has(sellerId)) {
      opportunitiesBySeller.set(sellerId, []);
    }

    opportunitiesBySeller.get(sellerId).push({
      id: Number(row.id || 0),
      createdAt,
      isWon:
        String(row.commercial_status_code || "") === "ganada" ||
        String(row.sales_stage_code || "") === "ganada",
    });
  });

  const weekKeys = Array.from({ length: normalizedWeeks }, (_, index) => {
    const weekStart = new Date(seriesStart);
    weekStart.setDate(weekStart.getDate() + index * 7);
    return formatIsoDate(weekStart);
  });

  return new Map(
    Array.from(opportunitiesBySeller.entries()).map(
      ([sellerId, sellerOpportunities]) => {
        const series = Array.from(
          { length: normalizedWeeks },
          (_, weekIndex) => {
            const weeksBack = normalizedWeeks - 1 - weekIndex;
            const snapshotDate = new Date();
            snapshotDate.setDate(snapshotDate.getDate() - weeksBack * 7);

            const latestOpportunities = sellerOpportunities
              .filter(
                (item) => item.createdAt.getTime() <= snapshotDate.getTime(),
              )
              .sort((left, right) => {
                const dateDelta =
                  right.createdAt.getTime() - left.createdAt.getTime();
                if (dateDelta !== 0) return dateDelta;
                return Number(right.id || 0) - Number(left.id || 0);
              })
              .slice(0, 20);

            if (!latestOpportunities.length) {
              return 0;
            }

            const wonCount = latestOpportunities.reduce(
              (sum, item) => sum + (item.isWon ? 1 : 0),
              0,
            );
            return toAmount((wonCount / latestOpportunities.length) * 100);
          },
        );

        return [sellerId, series];
      },
    ),
  );
}

async function loadRecentLeadConversionBySeller({ user, sampleSize = 20 }) {
  const normalizedSampleSize = Math.max(1, Number(sampleSize || 20));
  const params = [];
  const whereClauses = [
    "i.seller_user_id IS NOT NULL",
    "i.analysis_status IN ('created', 'lead_unassigned', 'lead_assigned', 'lead_qualified', 'lead_disqualified')",
  ];

  if (!hasGlobalOpportunityScope(user)) {
    whereClauses.push("i.seller_user_id = ?");
    params.push(Number(user.id) || 0);
  }

  params.push(normalizedSampleSize);
  const rows = await query(
    `SELECT recent.seller_user_id,
            COUNT(*) AS total_lead_count,
            SUM(
              CASE WHEN recent.analysis_status = 'lead_qualified' THEN 1 ELSE 0 END
            ) AS qualified_lead_count
     FROM (
       SELECT i.seller_user_id,
              i.analysis_status,
              ROW_NUMBER() OVER (
                PARTITION BY i.seller_user_id
                ORDER BY i.created_at DESC, i.id DESC
              ) AS row_position
       FROM interactions i
       WHERE ${whereClauses.join(" AND ")}
     ) recent
     WHERE recent.row_position <= ?
     GROUP BY recent.seller_user_id`,
    params,
  ).catch(() => []);

  return new Map(
    rows
      .map((row) => {
        const sellerUserId = Number(row.seller_user_id || 0);
        if (!sellerUserId) {
          return null;
        }
        return [
          sellerUserId,
          {
            totalLeadCount: Number(row.total_lead_count || 0),
            qualifiedLeadCount: Number(row.qualified_lead_count || 0),
          },
        ];
      })
      .filter(Boolean),
  );
}

async function loadRecentOpportunityConversionBySeller({
  user,
  sampleSize = 20,
}) {
  const normalizedSampleSize = Math.max(1, Number(sampleSize || 20));
  const params = [];
  const whereClauses = [
    "o.seller_user_id IS NOT NULL",
    "oas.code = 'activada'",
    "ocs.code <> 'anulada'",
  ];

  if (!hasGlobalOpportunityScope(user)) {
    whereClauses.push("o.seller_user_id = ?");
    params.push(Number(user.id) || 0);
  }

  params.push(normalizedSampleSize);
  const rows = await query(
    `SELECT recent.seller_user_id,
            COUNT(*) AS total_opportunity_count,
            SUM(
              CASE WHEN recent.commercial_status_code = 'ganada' THEN 1 ELSE 0 END
            ) AS won_opportunity_count
     FROM (
       SELECT o.seller_user_id,
              ocs.code AS commercial_status_code,
              ROW_NUMBER() OVER (
                PARTITION BY o.seller_user_id
                ORDER BY o.created_at DESC, o.id DESC
              ) AS row_position
       FROM opportunities o
       INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
       INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
       WHERE ${whereClauses.join(" AND ")}
     ) recent
     WHERE recent.row_position <= ?
     GROUP BY recent.seller_user_id`,
    params,
  ).catch(() => []);

  return new Map(
    rows
      .map((row) => {
        const sellerUserId = Number(row.seller_user_id || 0);
        if (!sellerUserId) {
          return null;
        }
        return [
          sellerUserId,
          {
            totalOpportunityCount: Number(row.total_opportunity_count || 0),
            wonOpportunityCount: Number(row.won_opportunity_count || 0),
          },
        ];
      })
      .filter(Boolean),
  );
}

async function loadLastWonTicketAverageBySeller(user, { maxSales = 10 } = {}) {
  const scopedOpportunities = await listScopedOpportunities(user);
  const wonRowsBySeller = new Map();

  scopedOpportunities.forEach((item) => {
    if (!isRealWonOpportunity(item)) {
      return;
    }

    const sellerUserId = Number(item.seller_user_id || 0);
    if (!sellerUserId) {
      return;
    }

    const amountUsd = Number(item.amount_usd || 0);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      return;
    }

    const closedAt =
      item.commercial_closed_at ||
      item.close_date ||
      item.updated_at ||
      item.created_at ||
      null;
    const closedAtTs = closedAt ? new Date(closedAt).getTime() : 0;

    const rows = wonRowsBySeller.get(sellerUserId) || [];
    rows.push({
      amountUsd,
      closedAtTs: Number.isFinite(closedAtTs) ? closedAtTs : 0,
    });
    wonRowsBySeller.set(sellerUserId, rows);
  });

  const cappedSalesCount = Math.max(1, Number(maxSales || 10));
  const averageBySeller = new Map();

  wonRowsBySeller.forEach((rows, sellerUserId) => {
    const latestRows = [...rows]
      .sort((left, right) => right.closedAtTs - left.closedAtTs)
      .slice(0, cappedSalesCount);

    if (!latestRows.length) {
      averageBySeller.set(sellerUserId, 0);
      return;
    }

    const sumAmount = latestRows.reduce(
      (sum, row) => sum + Number(row.amountUsd || 0),
      0,
    );
    averageBySeller.set(sellerUserId, toAmount(sumAmount / latestRows.length));
  });

  return averageBySeller;
}

function buildSellerLeagueRow({
  sellerUserId,
  sellerUserName,
  quarterWonItems,
  quarterOpenItems,
  nextQuarterQuotaAmountUsd,
  nextQuarterOpenPipelineUsd,
  advancedOpportunityIds14d,
  quotaAmountUsd,
  leadActualCount,
  leadQualifiedCount,
  conversionLeadTotalCount,
  conversionLeadQualifiedCount,
  conversionOpportunityTotalCount,
  conversionOpportunityWonCount,
  opportunityCreatedActualCount,
  averageSaleTicketLast10,
  sellerParameters,
  opportunityToWinDays,
  opportunityToWinWeeklyDays,
  opportunityToWinWeeklyConversionPct,
  leadToOpportunityDays,
  leadToOpportunityWeeklyDays,
  leadToOpportunityWeeklyConversionPct,
  leadsAssignedDays,
  leadsAssignedWeeklyDays,
  leadsPerWeekWeeklyCounts,
  opportunitiesPerWeekWeeklyCounts,
  quarterComplianceSeries,
}) {
  const wonAmountUsd = toAmount(
    quarterWonItems.reduce(
      (sum, item) => sum + Number(item.amount_usd || 0),
      0,
    ),
  );
  const openOpportunities = quarterOpenItems.length;
  const pipelineWeightedUsd = toAmount(
    quarterOpenItems.reduce((sum, item) => {
      return (
        sum +
        Number(item.amountUsd || 0) * getForecastStageWeight(item.stageCode)
      );
    }, 0),
  );
  const coverageGapUsd = Math.max(
    Number(quotaAmountUsd || 0) - wonAmountUsd,
    1,
  );
  const coverageRatio = safeRatio(pipelineWeightedUsd, coverageGapUsd);

  const advanced14dCount = quarterOpenItems.reduce((sum, item) => {
    return advancedOpportunityIds14d.has(Number(item.opportunityId || 0))
      ? sum + 1
      : sum;
  }, 0);
  const advanceRate14d = safeRatio(advanced14dCount, openOpportunities);

  const opportunitiesWithNextStepCount = quarterOpenItems.filter((item) =>
    Boolean(item.nextStep),
  ).length;
  const qualityReadyCount = quarterOpenItems.filter(
    (item) => Boolean(item.nextStep) && Boolean(item.closeDate),
  ).length;
  const qualityRate = safeRatio(qualityReadyCount, openOpportunities);

  const overdueCount = quarterOpenItems.filter((item) => {
    if (!item.nextStep?.dueDate) {
      return false;
    }
    return getDiffDays(item.nextStep.dueDate) > 0;
  }).length;
  const overdueRate = safeRatio(overdueCount, opportunitiesWithNextStepCount);

  const noNextStepCount = quarterOpenItems.filter(
    (item) => !item.nextStep,
  ).length;
  const noNextStepRate = safeRatio(noNextStepCount, openOpportunities);

  const blockedCriticalCount = quarterOpenItems.filter((item) =>
    ["bloqueada", "sin_conduccion"].includes(
      String(item.executionStateCode || ""),
    ),
  ).length;
  const blockedCriticalRate = safeRatio(
    blockedCriticalCount,
    openOpportunities,
  );

  const scoreClosing = quotaAmountUsd
    ? clampScore(100 * safeRatio(wonAmountUsd, quotaAmountUsd))
    : null;
  const scoreCoverage = clampScore((coverageRatio / 2) * 100);
  const scoreAdvance = clampScore((advanceRate14d / 0.6) * 100);
  const scoreQuality = clampScore((qualityRate / 0.9) * 100);
  const scoreBuild = toAmount(
    0.5 * scoreCoverage + 0.3 * scoreAdvance + 0.2 * scoreQuality,
  );

  const scoreOverdue = 100 - clampScore((overdueRate / 0.3) * 100);
  const scoreNoNextStep = 100 - clampScore((noNextStepRate / 0.25) * 100);
  const scoreBlocked = 100 - clampScore((blockedCriticalRate / 0.2) * 100);
  const scoreDiscipline = toAmount(
    0.4 * scoreOverdue + 0.35 * scoreNoNextStep + 0.25 * scoreBlocked,
  );

  const scoreTotal =
    scoreClosing === null
      ? null
      : toAmount(0.5 * scoreClosing + 0.3 * scoreBuild + 0.2 * scoreDiscipline);
  const calculatedAverageSaleTicketAmount = Number(
    averageSaleTicketLast10 || 0,
  );
  const configuredAverageSaleTicketAmount = Number(
    sellerParameters?.averageSaleTicketAmount || 0,
  );
  const useHistoricalAverageSaleTicketForQuotaProbability =
    sellerParameters?.useHistoricalAverageSaleTicketForQuotaProbability ===
    true;
  const averageSaleTicketAmount =
    useHistoricalAverageSaleTicketForQuotaProbability
      ? calculatedAverageSaleTicketAmount > 0
        ? calculatedAverageSaleTicketAmount
        : configuredAverageSaleTicketAmount > 0
          ? configuredAverageSaleTicketAmount
          : 0
      : configuredAverageSaleTicketAmount > 0
        ? configuredAverageSaleTicketAmount
        : 0;
  const conversionTotalLeads = Number(conversionLeadTotalCount || 0);
  const conversionQualifiedLeads = Number(conversionLeadQualifiedCount || 0);
  const leadToOpportunityCurrentRatio =
    conversionTotalLeads > 0
      ? Math.max(0, conversionQualifiedLeads / conversionTotalLeads)
      : null;
  const leadsToOpportunitiesRatio = Number(
    sellerParameters?.leadsToOpportunitiesRatio || 0,
  );
  const opportunitiesToWinsRatio = Number(
    sellerParameters?.opportunitiesToWinsRatio || 0,
  );
  const configuredOpportunityToWinDays = Number(
    sellerParameters?.averageOpportunityToWinDays || 0,
  );
  const useHistoricalLeadsToOpportunitiesForQuotaProbability =
    sellerParameters?.useHistoricalLeadsToOpportunitiesForQuotaProbability ===
    true;
  const useHistoricalOpportunitiesToWinsForQuotaProbability =
    sellerParameters?.useHistoricalOpportunitiesToWinsForQuotaProbability ===
    true;
  const useHistoricalAverageOpportunityToWinDaysForQuotaProbability =
    sellerParameters?.useHistoricalAverageOpportunityToWinDaysForQuotaProbability ===
    true;
  const useHistoricalValuesForQuotaProbability =
    sellerParameters?.useHistoricalValuesForQuotaProbability === true;
  const opportunityToWinCurrentRatio =
    conversionOpportunityTotalCount > 0
      ? Math.max(
          0,
          Number(conversionOpportunityWonCount || 0) /
            Number(conversionOpportunityTotalCount || 0),
        )
      : null;
  const opportunityToWinHistoricalRatio =
    opportunityToWinCurrentRatio !== null && opportunityToWinCurrentRatio > 0
      ? opportunityToWinCurrentRatio
      : 0;
  const opportunityToWinConfiguredRatio = opportunitiesToWinsRatio;
  const opportunityToWinEffectiveRatio =
    useHistoricalOpportunitiesToWinsForQuotaProbability
      ? opportunityToWinHistoricalRatio > 0
        ? opportunityToWinHistoricalRatio
        : opportunityToWinConfiguredRatio
      : opportunityToWinConfiguredRatio;
  const configuredLeadToOpportunityRatio =
    leadsToOpportunitiesRatio > 0 ? leadsToOpportunitiesRatio : 0;
  const leadToOpportunityCurrentPct = toAmount(
    (leadToOpportunityCurrentRatio ?? 0) * 100,
  );
  const leadToOpportunityTargetRatioRaw =
    leadsToOpportunitiesRatio > 0 ? 1 / leadsToOpportunitiesRatio : 0;
  const leadToOpportunityTargetRatio = Number.isFinite(
    leadToOpportunityTargetRatioRaw,
  )
    ? Math.max(0, leadToOpportunityTargetRatioRaw)
    : 0;
  const leadToOpportunityTargetPct = toAmount(
    leadToOpportunityTargetRatio * 100,
  );
  const historicalOpportunityToWinDays = Number(opportunityToWinDays || 0);
  const opportunityToWinEffectiveDays =
    useHistoricalAverageOpportunityToWinDaysForQuotaProbability
      ? historicalOpportunityToWinDays > 0
        ? historicalOpportunityToWinDays
        : configuredOpportunityToWinDays
      : configuredOpportunityToWinDays;

  const opportunityCreatedTargetCount =
    quotaAmountUsd &&
    Number(quotaAmountUsd || 0) > 0 &&
    averageSaleTicketAmount > 0 &&
    opportunityToWinEffectiveRatio > 0
      ? toAmount(
          Number(quotaAmountUsd || 0) /
            (averageSaleTicketAmount * opportunityToWinEffectiveRatio),
        )
      : null;
  const opportunityCreatedGapCount =
    opportunityCreatedTargetCount === null
      ? null
      : toAmount(
          Math.max(
            Number(opportunityCreatedTargetCount || 0) -
              Number(opportunityCreatedActualCount || 0),
            0,
          ),
        );
  const opportunityCreatedAttainmentPct =
    opportunityCreatedTargetCount && opportunityCreatedTargetCount > 0
      ? toAmount(
          (Number(opportunityCreatedActualCount || 0) /
            Number(opportunityCreatedTargetCount)) *
            100,
        )
      : null;
  const leadToOpportunityEffectiveRatio =
    useHistoricalLeadsToOpportunitiesForQuotaProbability
      ? leadToOpportunityCurrentRatio !== null &&
        leadToOpportunityCurrentRatio > 0
        ? leadToOpportunityCurrentRatio
        : configuredLeadToOpportunityRatio
      : configuredLeadToOpportunityRatio;
  const leadTargetRaw =
    Number(opportunityCreatedTargetCount || 0) > 0 &&
    leadToOpportunityEffectiveRatio > 0
      ? Number(opportunityCreatedTargetCount || 0) /
        leadToOpportunityEffectiveRatio
      : null;
  const leadTargetCount =
    leadTargetRaw !== null ? Math.max(0, Math.ceil(leadTargetRaw)) : null;
  const leadGapCount =
    leadTargetCount === null
      ? null
      : toAmount(
          Math.max(
            Number(leadTargetCount || 0) - Number(leadActualCount || 0),
            0,
          ),
        );
  const leadAttainmentPct =
    leadTargetCount && leadTargetCount > 0
      ? toAmount((Number(leadActualCount || 0) / Number(leadTargetCount)) * 100)
      : null;

  const funnelOpenAmountUsd = toAmount(
    quarterOpenItems.reduce(
      (sum, item) => sum + Number(item.amountUsd || 0),
      0,
    ),
  );
  const funnelByStage = Array.from(
    quarterOpenItems
      .reduce((accumulator, item) => {
        const stageCode = String(item.stageCode || "sin_etapa");
        const current = accumulator.get(stageCode) || {
          stageCode,
          stageName: item.stageName || "Sin etapa",
          stageOrder: Number(item.stageOrder ?? 9999),
          openAmountUsd: 0,
          opportunityCount: 0,
        };
        current.openAmountUsd += Number(item.amountUsd || 0);
        current.opportunityCount += 1;
        accumulator.set(stageCode, current);
        return accumulator;
      }, new Map())
      .values(),
  )
    .map((stage) => ({
      stageCode: stage.stageCode,
      stageName: stage.stageName,
      stageOrder: stage.stageOrder,
      openAmountUsd: toAmount(stage.openAmountUsd),
      opportunityCount: Number(stage.opportunityCount || 0),
      stageSharePct: funnelOpenAmountUsd
        ? toAmount(
            (Number(stage.openAmountUsd || 0) / funnelOpenAmountUsd) * 100,
          )
        : 0,
    }))
    .sort(
      (left, right) =>
        Number(left.stageOrder || 0) - Number(right.stageOrder || 0),
    );

  return {
    sellerUserId,
    sellerUserName,
    quotaAmountUsd: quotaAmountUsd ? toAmount(quotaAmountUsd) : null,
    nextQuarterQuotaAmountUsd:
      nextQuarterQuotaAmountUsd && Number(nextQuarterQuotaAmountUsd) > 0
        ? toAmount(nextQuarterQuotaAmountUsd)
        : null,
    leadTargetCount,
    leadActualCount: Number(leadActualCount || 0),
    leadQualifiedCount: Number(leadQualifiedCount || 0),
    leadGapCount,
    leadAttainmentPct,
    leadToOpportunityCurrentRatio,
    leadToOpportunityCurrentPct,
    leadToOpportunityDisplayRatio:
      leadToOpportunityCurrentRatio !== null
        ? leadToOpportunityCurrentRatio
        : configuredLeadToOpportunityRatio,
    leadToOpportunityDisplayPct: toAmount(
      ((leadToOpportunityCurrentRatio !== null
        ? leadToOpportunityCurrentRatio
        : configuredLeadToOpportunityRatio) || 0) * 100,
    ),
    leadToOpportunityTargetRatio,
    leadToOpportunityTargetPct,
    averageSaleTicketAmount: toAmount(averageSaleTicketAmount),
    opportunityToWinCurrentRatio,
    opportunityToWinCurrentPct:
      opportunityToWinCurrentRatio !== null
        ? toAmount(opportunityToWinCurrentRatio * 100)
        : null,
    opportunityToWinConfiguredRatio,
    opportunityToWinConfiguredPct: toAmount(
      opportunityToWinConfiguredRatio * 100,
    ),
    opportunityToWinHistoricalRatio,
    opportunityToWinHistoricalPct: toAmount(
      opportunityToWinHistoricalRatio * 100,
    ),
    opportunityToWinEffectiveRatio,
    opportunityToWinEffectivePct: toAmount(
      opportunityToWinEffectiveRatio * 100,
    ),
    useHistoricalAverageSaleTicketForQuotaProbability,
    useHistoricalLeadsToOpportunitiesForQuotaProbability,
    useHistoricalOpportunitiesToWinsForQuotaProbability,
    useHistoricalAverageOpportunityToWinDaysForQuotaProbability,
    useHistoricalValuesForQuotaProbability,
    opportunityToWinDays: toOptionalNonNegativeDayValue(
      opportunityToWinEffectiveDays,
    ),
    opportunityToWinHistoricalDays: historicalOpportunityToWinDays,
    opportunityToWinConfiguredDays: configuredOpportunityToWinDays,
    opportunityToWinWeeklyDays: Array.isArray(opportunityToWinWeeklyDays)
      ? opportunityToWinWeeklyDays
      : [],
    opportunityToWinWeeklyConversionPct: Array.isArray(
      opportunityToWinWeeklyConversionPct,
    )
      ? opportunityToWinWeeklyConversionPct
      : [],
    leadToOpportunityDays: toOptionalNonNegativeDayValue(leadToOpportunityDays),
    leadToOpportunityWeeklyDays: Array.isArray(leadToOpportunityWeeklyDays)
      ? leadToOpportunityWeeklyDays
      : [],
    leadToOpportunityWeeklyConversionPct: Array.isArray(
      leadToOpportunityWeeklyConversionPct,
    )
      ? leadToOpportunityWeeklyConversionPct
      : [],
    leadsAssignedDays: Number(leadsAssignedDays || 0),
    leadsAssignedWeeklyDays: Array.isArray(leadsAssignedWeeklyDays)
      ? leadsAssignedWeeklyDays
      : [],
    leadsPerWeekWeeklyCounts: Array.isArray(leadsPerWeekWeeklyCounts)
      ? leadsPerWeekWeeklyCounts
      : [],
    opportunitiesPerWeekWeeklyCounts: Array.isArray(
      opportunitiesPerWeekWeeklyCounts,
    )
      ? opportunitiesPerWeekWeeklyCounts
      : [],
    opportunityCreatedTargetCount,
    opportunityCreatedActualCount: Number(opportunityCreatedActualCount || 0),
    opportunityCreatedGapCount,
    opportunityCreatedAttainmentPct,
    wonAmountUsd,
    attainmentPct:
      quotaAmountUsd && quotaAmountUsd > 0
        ? toAmount((wonAmountUsd / Number(quotaAmountUsd)) * 100)
        : null,
    gapAmountUsd:
      quotaAmountUsd && quotaAmountUsd > 0
        ? toAmount(Math.max(Number(quotaAmountUsd) - wonAmountUsd, 0))
        : null,
    openOpportunities,
    opportunitiesWithNextStepCount,
    pipelineWeightedUsd,
    coverageRatio: toAmount(coverageRatio),
    advanced14dCount,
    advanceRate14d: toAmount(advanceRate14d * 100),
    qualityRate: toAmount(qualityRate * 100),
    overdueCount,
    overdueRate: toAmount(overdueRate * 100),
    noNextStepCount,
    noNextStepRate: toAmount(noNextStepRate * 100),
    blockedCriticalCount,
    blockedCriticalRate: toAmount(blockedCriticalRate * 100),
    funnelOpenAmountUsd,
    nextQuarterOpenPipelineUsd: toAmount(nextQuarterOpenPipelineUsd || 0),
    funnelByStage,
    scoreClosing,
    scoreBuild,
    scoreDiscipline,
    scoreTotal,
    momentum7d: toAmount(advanced14dCount * 3 + wonAmountUsd / 25000),
    isOfficial: Boolean(quotaAmountUsd && quotaAmountUsd > 0),
    quarterComplianceSeries: Array.isArray(quarterComplianceSeries)
      ? quarterComplianceSeries
      : [],
  };
}

function getQuarterNumberFromDate(dateValue) {
  const date = dateValue ? new Date(dateValue) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return null;
  }
  return Math.floor(date.getMonth() / 3) + 1;
}

async function buildSellerQuarterComplianceSeriesMap({
  user,
  year,
  sellerUserIds,
}) {
  const normalizedSellerIds = (sellerUserIds || [])
    .map((id) => Number(id || 0))
    .filter((id) => Number.isInteger(id) && id > 0);
  if (!normalizedSellerIds.length) {
    return new Map();
  }

  const yearStart = formatIsoDate(startOfDay(new Date(year, 0, 1)));
  const yearEnd = formatIsoDate(endOfDay(new Date(year, 11, 31)));
  const scopedYearOpportunities = await listScopedOpportunities(user, {
    closeDateFrom: yearStart,
    closeDateTo: yearEnd,
  });

  const wonAmountBySellerQuarter = scopedYearOpportunities
    .filter((item) => isRealWonOpportunity(item))
    .reduce((accumulator, item) => {
      const sellerUserId = Number(item.seller_user_id || 0);
      if (!sellerUserId || !normalizedSellerIds.includes(sellerUserId)) {
        return accumulator;
      }
      const quarter = getQuarterNumberFromDate(item.close_date);
      if (!quarter) {
        return accumulator;
      }
      const key = `${sellerUserId}:${quarter}`;
      const current = Number(accumulator.get(key) || 0);
      accumulator.set(key, current + Number(item.amount_usd || 0));
      return accumulator;
    }, new Map());

  const targetSummaryBySeller = new Map();
  for (const sellerUserId of normalizedSellerIds) {
    const summary = await loadQuarterTargetSummaryByQuarter({
      user,
      year,
      sellerUserId,
    });
    targetSummaryBySeller.set(sellerUserId, summary);
  }

  const result = new Map();
  normalizedSellerIds.forEach((sellerUserId) => {
    const targetByQuarter =
      targetSummaryBySeller.get(sellerUserId) || new Map();
    const series = [];
    for (let quarter = 1; quarter <= 4; quarter += 1) {
      const quotaAmountUsd = toAmount(
        Number(targetByQuarter.get(quarter)?.quotaSalesAmountUsd || 0),
      );
      const wonAmountUsd = toAmount(
        Number(wonAmountBySellerQuarter.get(`${sellerUserId}:${quarter}`) || 0),
      );
      series.push({
        quarter,
        label: `T${quarter}`,
        quotaAmountUsd,
        wonAmountUsd,
        attainmentPct:
          quotaAmountUsd > 0
            ? toAmount((wonAmountUsd / quotaAmountUsd) * 100)
            : null,
      });
    }
    result.set(sellerUserId, series);
  });

  return result;
}

router.get(
  "/overview",
  requireAnyPermission(["seguimiento_comercial.read"]),
  requireAnyPermission(["oportunidades.read", "oportunidades.read_all"]),
  async (req, res) => {
    const sellerUserId = toPositiveInt(req.query?.sellerUserId);
    const businessLineId = toPositiveInt(req.query?.businessLineId);
    const viewMode =
      String(req.query?.viewMode || "count").trim() === "amount"
        ? "amount"
        : "count";
    const weekRange = getWeekRange(req.query?.weekStart);
    const previousWeekRange = {
      start: addDays(weekRange.start, -7),
      end: endOfDay(addDays(weekRange.start, -1)),
    };

    const [allScopedOpportunities, openItems, quarterQuota] = await Promise.all(
      [
        listScopedOpportunities(req.user, { sellerUserId, businessLineId }),
        buildOpenOpportunityItems(req.user, {
          sellerUserId,
          businessLineId,
          weekRange,
        }),
        buildQuarterQuotaSummary(req.user, {
          referenceDate: weekRange.start,
          sellerUserId,
        }),
      ],
    );

    const currentWeekCreated = allScopedOpportunities.filter((item) =>
      isBetween(item.created_at, weekRange.start, weekRange.end),
    );
    const previousWeekCreated = allScopedOpportunities.filter((item) =>
      isBetween(
        item.created_at,
        previousWeekRange.start,
        previousWeekRange.end,
      ),
    );
    const currentWeekWon = allScopedOpportunities.filter(
      (item) =>
        item.commercial_status_code === "ganada" &&
        isBetween(item.commercial_closed_at, weekRange.start, weekRange.end),
    );
    const previousWeekWon = allScopedOpportunities.filter(
      (item) =>
        item.commercial_status_code === "ganada" &&
        isBetween(
          item.commercial_closed_at,
          previousWeekRange.start,
          previousWeekRange.end,
        ),
    );
    const currentWeekLost = allScopedOpportunities.filter(
      (item) =>
        ["perdida", "anulada"].includes(String(item.commercial_status_code)) &&
        isBetween(item.commercial_closed_at, weekRange.start, weekRange.end),
    );
    const previousWeekLost = allScopedOpportunities.filter(
      (item) =>
        ["perdida", "anulada"].includes(String(item.commercial_status_code)) &&
        isBetween(
          item.commercial_closed_at,
          previousWeekRange.start,
          previousWeekRange.end,
        ),
    );

    const openAtPreviousWeekEnd = allScopedOpportunities.filter((item) =>
      isOpenAtDate(item, previousWeekRange.end),
    );
    const currentAdvanced = openItems.filter(
      (item) => item.advancedThisWeek,
    ).length;
    const previousAdvancedRows = await listAuditEvents(
      openAtPreviousWeekEnd
        .map((item) => Number(item.id || item.opportunityId || 0))
        .filter(Boolean),
      ["stage_advanced"],
      previousWeekRange.start,
      previousWeekRange.end,
    );

    const noNextStep = openItems.filter((item) => !item.nextStep).slice(0, 5);
    const blocked = openItems
      .filter((item) => item.executionStateCode === "bloqueada")
      .slice(0, 5);
    const stale = openItems.filter((item) => item.isStale).slice(0, 5);
    const highAmountHighRisk = openItems
      .filter(
        (item) =>
          item.amountUsd >= 100000 &&
          ["bloqueada", "sin_conduccion", "esperando_interno"].includes(
            item.executionStateCode,
          ),
      )
      .slice(0, 5);

    const generationTrend = buildPeriods(
      addDays(weekRange.start, -49),
      weekRange.end,
      "week",
    ).map((period) => {
      const created = allScopedOpportunities.filter((item) =>
        isBetween(item.created_at, period.start, period.end),
      );
      return {
        periodKey: period.key,
        periodLabel: period.label,
        createdCount: created.length,
        createdAmountUsd: sumAmounts(created),
      };
    });

    const pipelineMovementMap = openItems.reduce((accumulator, item) => {
      const key = String(item.stageCode || "sin_etapa");
      const current = accumulator.get(key) || {
        stageCode: item.stageCode,
        stageName: item.stageName,
        openCount: 0,
        advancedInWeek: 0,
        blockedCount: 0,
        staleCount: 0,
      };
      current.openCount += 1;
      if (item.advancedThisWeek) current.advancedInWeek += 1;
      if (item.executionStateCode === "bloqueada") current.blockedCount += 1;
      if (item.isStale) current.staleCount += 1;
      accumulator.set(key, current);
      return accumulator;
    }, new Map());

    res.json({
      filters: {
        weekStart: formatIsoDate(weekRange.start),
        weekEnd: formatIsoDate(weekRange.end),
        sellerUserId,
        businessLineId,
        viewMode,
      },
      summary: {
        openOpportunities: openItems.length,
        openAmountUsd: sumAmounts(
          openItems.map((item) => ({ amount_usd: item.amountUsd })),
        ),
        newThisWeek: currentWeekCreated.length,
        newAmountUsd: sumAmounts(currentWeekCreated),
        advancedThisWeek: currentAdvanced,
        blockedOpenOpportunities: openItems.filter(
          (item) => item.executionStateCode === "bloqueada",
        ).length,
      },
      weekChange: {
        newThisWeek: buildVariation(
          currentWeekCreated.length,
          previousWeekCreated.length,
        ),
        advancedThisWeek: buildVariation(
          currentAdvanced,
          new Set(
            previousAdvancedRows
              .map((row) => Number(row.entity_id || 0))
              .filter(Boolean),
          ).size,
        ),
        wonThisWeek: buildVariation(
          currentWeekWon.length,
          previousWeekWon.length,
        ),
        lostThisWeek: buildVariation(
          currentWeekLost.length,
          previousWeekLost.length,
        ),
      },
      immediateAttention: {
        noNextStep,
        blocked,
        stale,
        highAmountHighRisk,
      },
      quarterQuota,
      generationTrend,
      pipelineMovement: Array.from(pipelineMovementMap.values()).sort(
        (left, right) => right.openCount - left.openCount,
      ),
    });
  },
);

router.get(
  "/forecast-monthly",
  requireAnyPermission(["seguimiento_comercial.read"]),
  requireAnyPermission(["oportunidades.read", "oportunidades.read_all"]),
  async (req, res) => {
    const payload = await buildForecastMonthlyPayload(req.user, {
      month: req.query?.month,
      weekStart: req.query?.weekStart,
      sellerUserId: req.query?.sellerUserId,
      businessLineId: req.query?.businessLineId,
      viewMode: req.query?.viewMode,
    });

    res.json(payload);
  },
);

router.get(
  "/quarterly-performance",
  requireAnyPermission(["seguimiento_comercial.read"]),
  requireAnyPermission(["oportunidades.read", "oportunidades.read_all"]),
  async (req, res) => {
    const payload = await buildQuarterlyPerformancePayload(req.user, {
      year: req.query?.year,
      sellerUserId: req.query?.sellerUserId,
      businessLineId: req.query?.businessLineId,
    });
    res.json(payload);
  },
);

async function loadOpportunityToWinDaysBySeller({
  user,
  sampleSize = 20,
} = {}) {
  // First, get the development stage ID
  const developmentStageRows = await query(
    `SELECT id FROM opportunity_sales_stages WHERE code = 'desarrollo' LIMIT 1`,
  ).catch(() => []);

  if (!developmentStageRows.length) {
    return new Map();
  }

  const developmentStageId = Number(developmentStageRows[0].id || 0);
  if (!developmentStageId) {
    return new Map();
  }

  const params = [];
  const whereClauses = [
    "o.seller_user_id IS NOT NULL",
    "oas.code = 'activada'",
    "ocs.code = 'ganada'",
  ];

  if (!hasGlobalOpportunityScope(user)) {
    whereClauses.push("o.seller_user_id = ?");
    params.push(Number(user.id) || 0);
  }

  const normalizedSampleSize = Math.max(1, Number(sampleSize || 20));
  params.push(normalizedSampleSize);

  // Get last won opportunities by seller
  const wonOpportunities = await query(
    `SELECT recent.opportunity_id, recent.seller_user_id, recent.commercial_closed_at
     FROM (
       SELECT o.id AS opportunity_id, o.seller_user_id, o.commercial_closed_at,
              ROW_NUMBER() OVER (
                PARTITION BY o.seller_user_id
                ORDER BY o.commercial_closed_at DESC, o.id DESC
              ) AS row_position
       FROM opportunities o
       INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
       INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
       WHERE ${whereClauses.join(" AND ")}
     ) recent
     WHERE recent.row_position <= ?`,
    params,
  ).catch(() => []);

  if (!wonOpportunities.length) {
    return new Map();
  }

  const opportunityIds = wonOpportunities
    .map((row) => Number(row.opportunity_id || 0))
    .filter(Boolean);
  if (!opportunityIds.length) {
    return new Map();
  }

  // Get stage entry dates from audit_log for each opportunity
  // Look for when stage_id changed to development stage
  const placeholders = opportunityIds.map(() => "?").join(", ");
  const stageAuditRows = await query(
    `SELECT al.entity_id, MIN(al.created_at) AS development_entered_at
     FROM audit_log al
     WHERE al.entity_type = 'opportunity'
       AND al.entity_id IN (${placeholders})
       AND al.action = 'stage_advanced'
       AND JSON_EXTRACT(al.changed_fields, '$.sales_stage_id.after') = ?
     GROUP BY al.entity_id`,
    [...opportunityIds, developmentStageId],
  ).catch(() => []);

  const stageEntryByOppId = new Map(
    stageAuditRows.map((row) => [
      Number(row.entity_id || 0),
      row.development_entered_at,
    ]),
  );

  const resultBySeller = new Map();

  wonOpportunities.forEach((wonRow) => {
    const sellerId = Number(wonRow.seller_user_id || 0);
    const oppId = Number(wonRow.opportunity_id || 0);
    const closedAt = wonRow.commercial_closed_at;

    if (!sellerId || !oppId || !closedAt) {
      return;
    }

    if (!resultBySeller.has(sellerId)) {
      resultBySeller.set(sellerId, []);
    }

    const devEnteredAt = stageEntryByOppId.get(oppId);
    if (devEnteredAt) {
      const days = Math.max(
        0,
        getDiffDays(new Date(devEnteredAt), new Date(closedAt)),
      );
      resultBySeller.get(sellerId).push(days);
    }
  });

  // Calculate average per seller
  const averageBySellerId = new Map(
    Array.from(resultBySeller.entries()).map(([sellerId, daysArray]) => [
      sellerId,
      daysArray.length > 0
        ? Math.round(
            daysArray.reduce((sum, d) => sum + d, 0) / daysArray.length,
          )
        : 0,
    ]),
  );

  return averageBySellerId;
}

async function loadOpportunityToWinWeeklySeriesBySeller({
  user,
  weeks = 10,
  sampleSize = 20,
} = {}) {
  const params = [];
  const whereClauses = [
    "o.seller_user_id IS NOT NULL",
    "oas.code = 'activada'",
    "ocs.code = 'ganada'",
  ];

  if (!hasGlobalOpportunityScope(user)) {
    whereClauses.push("o.seller_user_id = ?");
    params.push(Number(user.id) || 0);
  }

  const normalizedWeeks = Math.max(1, Math.min(10, Number(weeks || 10)));
  const normalizedSampleSize = Math.max(1, Number(sampleSize || 20));
  params.push(normalizedSampleSize);

  const wonOpportunities = await query(
    `SELECT recent.seller_user_id, recent.commercial_closed_at, recent.days_to_win
     FROM (
       SELECT o.seller_user_id, o.commercial_closed_at, o.id,
              FLOOR(DATEDIFF(o.commercial_closed_at, MIN(al.created_at))) AS days_to_win,
              ROW_NUMBER() OVER (
                PARTITION BY o.seller_user_id
                ORDER BY o.commercial_closed_at DESC, o.id DESC
              ) AS row_position
       FROM opportunities o
       INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
       INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
       LEFT JOIN audit_log al
         ON al.entity_type = 'opportunity'
        AND al.entity_id = o.id
        AND al.action = 'stage_advanced'
        AND JSON_EXTRACT(al.changed_fields, '$.sales_stage_id.after') = (
          SELECT id FROM opportunity_sales_stages WHERE code = 'desarrollo' LIMIT 1
        )
       WHERE ${whereClauses.join(" AND ")}
       GROUP BY o.id, o.seller_user_id, o.commercial_closed_at
     ) recent
     WHERE recent.row_position <= ?`,
    params,
  ).catch(() => []);

  if (!wonOpportunities.length) {
    return new Map();
  }

  const wonBySeller = new Map();
  wonOpportunities.forEach((row) => {
    const sellerId = Number(row.seller_user_id || 0);
    const closedAt = row.commercial_closed_at
      ? new Date(row.commercial_closed_at)
      : null;
    const daysToWin = Math.max(0, Number(row.days_to_win || 0));

    if (!sellerId || !closedAt || Number.isNaN(closedAt.getTime())) {
      return;
    }

    if (!wonBySeller.has(sellerId)) {
      wonBySeller.set(sellerId, []);
    }

    wonBySeller.get(sellerId).push({
      closedAt,
      daysToWin,
    });
  });

  return new Map(
    Array.from(wonBySeller.entries()).map(([sellerId, wonItems]) => {
      const now = new Date();
      const series = Array.from({ length: normalizedWeeks }, (_, weekIndex) => {
        const weeksBack = normalizedWeeks - 1 - weekIndex;
        const snapshotDate = new Date(now);
        snapshotDate.setDate(snapshotDate.getDate() - weeksBack * 7);

        const valuesAtSnapshot = wonItems
          .filter((item) => item.closedAt.getTime() <= snapshotDate.getTime())
          .map((item) => item.daysToWin);

        if (!valuesAtSnapshot.length) {
          return null;
        }

        return Math.round(
          valuesAtSnapshot.reduce((sum, value) => sum + value, 0) /
            valuesAtSnapshot.length,
        );
      });

      return [sellerId, series];
    }),
  );
}

async function loadLeadAssignedAgeDaysBySeller({ user, sampleSize = 20 } = {}) {
  const params = [];
  const whereClauses = [
    "i.seller_user_id IS NOT NULL",
    "i.analysis_status <> 'lead_qualified'",
  ];

  if (!hasGlobalOpportunityScope(user)) {
    whereClauses.push("i.seller_user_id = ?");
    params.push(Number(user.id) || 0);
  }

  const normalizedSampleSize = Math.max(1, Number(sampleSize || 20));
  params.push(normalizedSampleSize);

  // Get last assigned leads by seller with age from creation to today
  const assignedLeads = await query(
    `SELECT recent.lead_id, recent.seller_user_id, recent.created_at,
            FLOOR(DATEDIFF(NOW(), recent.created_at)) AS days_since_creation
     FROM (
       SELECT i.id AS lead_id, i.seller_user_id, i.created_at,
              ROW_NUMBER() OVER (
                PARTITION BY i.seller_user_id
                ORDER BY i.created_at DESC, i.id DESC
              ) AS row_position
       FROM interactions i
       WHERE ${whereClauses.join(" AND ")}
     ) recent
     WHERE recent.row_position <= ?`,
    params,
  ).catch(() => []);

  if (!assignedLeads.length) {
    return new Map();
  }

  // Calculate average days per seller
  const resultBySeller = new Map();

  assignedLeads.forEach((leadRow) => {
    const sellerId = Number(leadRow.seller_user_id || 0);
    const daysSinceCreation = Number(leadRow.days_since_creation || 0);

    if (!sellerId) {
      return;
    }

    if (!resultBySeller.has(sellerId)) {
      resultBySeller.set(sellerId, []);
    }

    resultBySeller.get(sellerId).push(Math.max(0, daysSinceCreation));
  });

  // Calculate average per seller
  const averageBySellerId = new Map(
    Array.from(resultBySeller.entries()).map(([sellerId, daysArray]) => [
      sellerId,
      daysArray.length > 0
        ? Math.round(
            daysArray.reduce((sum, d) => sum + d, 0) / daysArray.length,
          )
        : 0,
    ]),
  );

  return averageBySellerId;
}

async function loadLeadAssignedAgeWeeklySeriesBySeller({
  user,
  weeks = 10,
  sampleSize = 20,
} = {}) {
  const params = [];
  const whereClauses = [
    "i.seller_user_id IS NOT NULL",
    "i.analysis_status <> 'lead_qualified'",
  ];

  if (!hasGlobalOpportunityScope(user)) {
    whereClauses.push("i.seller_user_id = ?");
    params.push(Number(user.id) || 0);
  }

  const normalizedWeeks = Math.max(1, Math.min(10, Number(weeks || 10)));
  const normalizedSampleSize = Math.max(1, Number(sampleSize || 20));
  params.push(normalizedSampleSize);

  const leadRows = await query(
    `SELECT recent.seller_user_id, recent.created_at
     FROM (
       SELECT i.seller_user_id, i.created_at, i.id,
              ROW_NUMBER() OVER (
                PARTITION BY i.seller_user_id
                ORDER BY i.created_at DESC, i.id DESC
              ) AS row_position
       FROM interactions i
       WHERE ${whereClauses.join(" AND ")}
     ) recent
     WHERE recent.row_position <= ?`,
    params,
  ).catch(() => []);

  if (!leadRows.length) {
    return new Map();
  }

  const leadsBySeller = new Map();
  leadRows.forEach((row) => {
    const sellerId = Number(row.seller_user_id || 0);
    const createdAt = row.created_at ? new Date(row.created_at) : null;

    if (!sellerId || !createdAt || Number.isNaN(createdAt.getTime())) {
      return;
    }

    if (!leadsBySeller.has(sellerId)) {
      leadsBySeller.set(sellerId, []);
    }
    leadsBySeller.get(sellerId).push(createdAt);
  });

  return new Map(
    Array.from(leadsBySeller.entries()).map(([sellerId, sellerLeads]) => {
      const now = new Date();
      const series = Array.from({ length: normalizedWeeks }, (_, weekIndex) => {
        const weeksBack = normalizedWeeks - 1 - weekIndex;
        const snapshotDate = new Date(now);
        snapshotDate.setDate(snapshotDate.getDate() - weeksBack * 7);

        const agesAtSnapshot = sellerLeads
          .filter((createdAt) => createdAt.getTime() <= snapshotDate.getTime())
          .map((createdAt) => getDiffDays(createdAt, snapshotDate));

        if (!agesAtSnapshot.length) {
          return null;
        }

        return Math.round(
          agesAtSnapshot.reduce((sum, value) => sum + value, 0) /
            agesAtSnapshot.length,
        );
      });

      return [sellerId, series];
    }),
  );
}

async function loadLeadToOpportunityDaysBySeller({
  user,
  sampleSize = 20,
} = {}) {
  const params = [];
  const whereClauses = [
    "i.seller_user_id IS NOT NULL",
    "i.analysis_status = 'lead_qualified'",
  ];

  if (!hasGlobalOpportunityScope(user)) {
    whereClauses.push("i.seller_user_id = ?");
    params.push(Number(user.id) || 0);
  }

  const normalizedSampleSize = Math.max(1, Number(sampleSize || 20));
  params.push(normalizedSampleSize);

  // Get last qualified leads by seller with time to qualification
  const qualifiedLeads = await query(
    `SELECT recent.lead_id, recent.seller_user_id, recent.created_at, recent.updated_at,
            FLOOR(DATEDIFF(recent.updated_at, recent.created_at)) AS days_to_qualified
     FROM (
       SELECT i.id AS lead_id, i.seller_user_id, i.created_at, i.updated_at,
              ROW_NUMBER() OVER (
                PARTITION BY i.seller_user_id
                ORDER BY i.updated_at DESC, i.id DESC
              ) AS row_position
       FROM interactions i
       WHERE ${whereClauses.join(" AND ")}
     ) recent
     WHERE recent.row_position <= ?`,
    params,
  ).catch(() => []);

  if (!qualifiedLeads.length) {
    return new Map();
  }

  // Calculate average days per seller
  const resultBySeller = new Map();

  qualifiedLeads.forEach((leadRow) => {
    const sellerId = Number(leadRow.seller_user_id || 0);
    const daysToQualified = Number(leadRow.days_to_qualified || 0);

    if (!sellerId) {
      return;
    }

    if (!resultBySeller.has(sellerId)) {
      resultBySeller.set(sellerId, []);
    }

    resultBySeller.get(sellerId).push(Math.max(0, daysToQualified));
  });

  // Calculate average per seller
  const averageBySellerId = new Map(
    Array.from(resultBySeller.entries()).map(([sellerId, daysArray]) => [
      sellerId,
      daysArray.length > 0
        ? Math.round(
            daysArray.reduce((sum, d) => sum + d, 0) / daysArray.length,
          )
        : 0,
    ]),
  );

  return averageBySellerId;
}

async function loadLeadToOpportunityWeeklySeriesBySeller({
  user,
  weeks = 10,
  sampleSize = 20,
} = {}) {
  const params = [];
  const whereClauses = [
    "i.seller_user_id IS NOT NULL",
    "i.analysis_status = 'lead_qualified'",
  ];

  if (!hasGlobalOpportunityScope(user)) {
    whereClauses.push("i.seller_user_id = ?");
    params.push(Number(user.id) || 0);
  }

  const normalizedWeeks = Math.max(1, Math.min(10, Number(weeks || 10)));
  const normalizedSampleSize = Math.max(1, Number(sampleSize || 20));
  params.push(normalizedSampleSize);

  const leadRows = await query(
    `SELECT recent.seller_user_id, recent.created_at, recent.qualified_at,
            FLOOR(DATEDIFF(recent.qualified_at, recent.created_at)) AS days_to_qualified
     FROM (
       SELECT i.seller_user_id, i.created_at, i.updated_at AS qualified_at, i.id,
              ROW_NUMBER() OVER (
                PARTITION BY i.seller_user_id
                ORDER BY i.updated_at DESC, i.id DESC
              ) AS row_position
       FROM interactions i
       WHERE ${whereClauses.join(" AND ")}
     ) recent
     WHERE recent.row_position <= ?`,
    params,
  ).catch(() => []);

  if (!leadRows.length) {
    return new Map();
  }

  const qualifiedLeadsBySeller = new Map();
  leadRows.forEach((row) => {
    const sellerId = Number(row.seller_user_id || 0);
    const qualifiedAt = row.qualified_at ? new Date(row.qualified_at) : null;
    const daysToQualified = Math.max(0, Number(row.days_to_qualified || 0));

    if (!sellerId || !qualifiedAt || Number.isNaN(qualifiedAt.getTime())) {
      return;
    }

    if (!qualifiedLeadsBySeller.has(sellerId)) {
      qualifiedLeadsBySeller.set(sellerId, []);
    }

    qualifiedLeadsBySeller.get(sellerId).push({
      qualifiedAt,
      daysToQualified,
    });
  });

  return new Map(
    Array.from(qualifiedLeadsBySeller.entries()).map(
      ([sellerId, qualifiedLeads]) => {
        const now = new Date();
        const series = Array.from(
          { length: normalizedWeeks },
          (_, weekIndex) => {
            const weeksBack = normalizedWeeks - 1 - weekIndex;
            const snapshotDate = new Date(now);
            snapshotDate.setDate(snapshotDate.getDate() - weeksBack * 7);

            const valuesAtSnapshot = qualifiedLeads
              .filter(
                (lead) => lead.qualifiedAt.getTime() <= snapshotDate.getTime(),
              )
              .map((lead) => lead.daysToQualified);

            if (!valuesAtSnapshot.length) {
              return null;
            }

            return Math.round(
              valuesAtSnapshot.reduce((sum, value) => sum + value, 0) /
                valuesAtSnapshot.length,
            );
          },
        );

        return [sellerId, series];
      },
    ),
  );
}

router.get(
  "/seller-league-tv",
  requireAnyPermission(["ritmo_comercial.read"]),
  async (req, res) => {
    const canReadAllSellerLeague = hasSellerLeagueGlobalScope(req.user);
    const currentUserId = Number(req.user?.id || 0);
    const requestedSellerUserId = toPositiveInt(req.query?.sellerUserId);
    if (
      requestedSellerUserId &&
      requestedSellerUserId !== currentUserId &&
      !canReadAllSellerLeague
    ) {
      return res.status(403).json({
        error: "No tienes permiso para ver el detalle de este vendedor",
      });
    }

    const leagueScopeUser = buildSellerLeagueOpportunityScopeUser(
      req.user,
      canReadAllSellerLeague,
    );
    const selectedSellerUserId =
      requestedSellerUserId || (!canReadAllSellerLeague ? currentUserId : null);
    const commercialSettings = await getCommercialSettings().catch(() => null);
    const quarterSelection = getQuarterSelection(new Date());
    const nextQuarterSelection = getQuarterSelection(
      addDays(quarterSelection.end, 1),
    );
    const quarterStart = formatIsoDate(quarterSelection.start);
    const quarterEnd = formatIsoDate(quarterSelection.end);
    const nextQuarterStart = formatIsoDate(nextQuarterSelection.start);
    const nextQuarterEnd = formatIsoDate(nextQuarterSelection.end);
    const weekRange = getWeekRange(new Date());
    const currentQuarterDaysTotal = Math.max(
      1,
      getDiffDays(quarterSelection.start, addDays(quarterSelection.end, 1)),
    );
    const currentQuarterDaysElapsed = Math.min(
      currentQuarterDaysTotal,
      Math.max(1, getDiffDays(quarterSelection.start, addDays(new Date(), 1))),
    );
    const currentQuarterDaysRemaining = Math.max(
      0,
      currentQuarterDaysTotal - currentQuarterDaysElapsed,
    );
    const currentQuarterWeeksRemaining = toAmount(
      currentQuarterDaysRemaining / 7,
    );

    const [
      scopedQuarterOpportunities,
      scopedQuarterOpenItems,
      quarterTargets,
      nextQuarterTargets,
      nextQuarterOpenItems,
      quarterLeadCountsBySeller,
      quarterQualifiedLeadCountsBySeller,
      recentLeadConversionBySeller,
      recentOpportunityConversionBySeller,
      quarterCreatedOpportunityCountsBySeller,
      lastWonTicketAverageBySeller,
      sellerParametersBySeller,
      opportunityToWinDaysBySeller,
      opportunityToWinWeeklySeriesBySeller,
      opportunityToWinConversionWeeklySeriesBySeller,
      leadToOpportunityDaysBySeller,
      leadToOpportunityWeeklySeriesBySeller,
      leadToOpportunityConversionWeeklySeriesBySeller,
      leadCreatedWeeklySeriesBySeller,
      leadAssignedAgeDaysBySeller,
      leadAssignedWeeklySeriesBySeller,
      opportunityCreatedWeeklySeriesBySeller,
      visibleSellerRows,
    ] = await Promise.all([
      listScopedOpportunities(leagueScopeUser, {
        closeDateFrom: quarterStart,
        closeDateTo: quarterEnd,
        sellerUserId: selectedSellerUserId,
      }),
      buildOpenOpportunityItems(leagueScopeUser, {
        closeDateFrom: quarterStart,
        closeDateTo: quarterEnd,
        sellerUserId: selectedSellerUserId,
        weekRange,
      }),
      loadCurrentQuarterTargetsBySeller({
        user: leagueScopeUser,
        quarterSelection,
      }),
      loadCurrentQuarterTargetsBySeller({
        user: leagueScopeUser,
        quarterSelection: nextQuarterSelection,
      }),
      buildOpenOpportunityItems(leagueScopeUser, {
        closeDateFrom: nextQuarterStart,
        closeDateTo: nextQuarterEnd,
        sellerUserId: selectedSellerUserId,
        weekRange,
      }),
      loadQuarterLeadCountsBySeller({
        user: leagueScopeUser,
        quarterSelection,
      }),
      loadQuarterQualifiedLeadCountsBySeller({
        user: leagueScopeUser,
        quarterSelection,
      }),
      loadRecentLeadConversionBySeller({
        user: leagueScopeUser,
        sampleSize: 20,
      }),
      loadRecentOpportunityConversionBySeller({
        user: leagueScopeUser,
        sampleSize: 20,
      }),
      loadQuarterCreatedOpportunityCountsBySeller({
        user: leagueScopeUser,
        quarterSelection,
      }),
      loadLastWonTicketAverageBySeller(leagueScopeUser, { maxSales: 10 }),
      loadSellerParametersBySeller(),
      loadOpportunityToWinDaysBySeller({
        user: leagueScopeUser,
        sampleSize: 20,
      }),
      loadOpportunityToWinWeeklySeriesBySeller({
        user: leagueScopeUser,
        weeks: 10,
        sampleSize: 20,
      }),
      loadOpportunityToWinConversionWeeklySeriesBySeller({
        user: leagueScopeUser,
        weeks: 10,
      }),
      loadLeadToOpportunityDaysBySeller({
        user: leagueScopeUser,
        sampleSize: 20,
      }),
      loadLeadToOpportunityWeeklySeriesBySeller({
        user: leagueScopeUser,
        weeks: 10,
        sampleSize: 20,
      }),
      loadLeadToOpportunityConversionWeeklySeriesBySeller({
        user: leagueScopeUser,
        weeks: 10,
      }),
      loadLeadCreatedWeeklySeriesBySeller({ user: leagueScopeUser, weeks: 10 }),
      loadLeadAssignedAgeDaysBySeller({
        user: leagueScopeUser,
        sampleSize: 20,
      }),
      loadLeadAssignedAgeWeeklySeriesBySeller({
        user: leagueScopeUser,
        weeks: 10,
      }),
      loadOpportunityCreatedWeeklySeriesBySeller({
        user: leagueScopeUser,
        weeks: 10,
      }),
      query(
        `SELECT DISTINCT u.id, u.full_name AS seller_user_name
         FROM users u
         INNER JOIN user_roles ur ON ur.user_id = u.id
         INNER JOIN role_permissions rp ON rp.role_id = ur.role_id
         INNER JOIN permissions p ON p.id = rp.permission_id
         WHERE u.status = 'active'
           AND p.code = 'ritmo_comercial.display'
           AND (? = 1 OR u.id = ?)
           AND (? IS NULL OR u.id = ?)`,
        [
          canReadAllSellerLeague ? 1 : 0,
          currentUserId,
          selectedSellerUserId,
          selectedSellerUserId,
        ],
      ),
    ]);

    const visibleSellerIds = new Set(
      visibleSellerRows
        .map((row) => Number(row.id || 0))
        .filter((userId) => Number.isInteger(userId) && userId > 0),
    );

    const openOpportunityIds = scopedQuarterOpenItems
      .map((item) => Number(item.opportunityId || 0))
      .filter(Boolean);
    const advanced14dRows = await listAuditEvents(
      openOpportunityIds,
      ["stage_advanced"],
      startOfDay(addDays(new Date(), -14)),
      endOfDay(new Date()),
    );
    const advancedOpportunityIds14d = new Set(
      advanced14dRows.map((row) => Number(row.entity_id || 0)).filter(Boolean),
    );

    const rowsBySeller = new Map();
    visibleSellerRows.forEach((row) => {
      const sellerUserId = Number(row.id || 0);
      if (!sellerUserId || !visibleSellerIds.has(sellerUserId)) return;
      rowsBySeller.set(sellerUserId, {
        sellerUserId,
        sellerUserName: row.seller_user_name || "Sin vendedor",
        wonItems: [],
        openItems: [],
      });
    });

    scopedQuarterOpportunities.forEach((item) => {
      const sellerUserId = Number(item.seller_user_id || 0);
      if (!sellerUserId || !visibleSellerIds.has(sellerUserId)) return;
      const current = rowsBySeller.get(sellerUserId) || {
        sellerUserId,
        sellerUserName: item.seller_user_name || "Sin vendedor",
        wonItems: [],
        openItems: [],
      };
      if (isRealWonOpportunity(item)) {
        current.wonItems.push(item);
      }
      rowsBySeller.set(sellerUserId, current);
    });

    scopedQuarterOpenItems.forEach((item) => {
      const sellerUserId = Number(item.sellerUserId || 0);
      if (!sellerUserId || !visibleSellerIds.has(sellerUserId)) return;
      const current = rowsBySeller.get(sellerUserId) || {
        sellerUserId,
        sellerUserName: item.sellerUserName || "Sin vendedor",
        wonItems: [],
        openItems: [],
      };
      current.openItems.push(item);
      rowsBySeller.set(sellerUserId, current);
    });

    quarterTargets.targetBySellerId.forEach((target, sellerUserId) => {
      if (!visibleSellerIds.has(Number(sellerUserId))) {
        return;
      }
      if (rowsBySeller.has(sellerUserId)) {
        return;
      }
      rowsBySeller.set(sellerUserId, {
        sellerUserId,
        sellerUserName: target.sellerUserName || "Sin vendedor",
        wonItems: [],
        openItems: [],
      });
    });

    const quarterComplianceSeriesBySeller =
      await buildSellerQuarterComplianceSeriesMap({
        user: leagueScopeUser,
        year: quarterSelection.year,
        sellerUserIds: Array.from(rowsBySeller.keys()),
      });

    const nextQuarterOpenPipelineUsdBySeller = nextQuarterOpenItems.reduce(
      (accumulator, item) => {
        const sellerUserId = Number(item.sellerUserId || 0);
        if (!sellerUserId || !visibleSellerIds.has(sellerUserId)) {
          return accumulator;
        }
        accumulator.set(
          sellerUserId,
          toAmount(
            Number(accumulator.get(sellerUserId) || 0) +
              Number(item.amountUsd || 0),
          ),
        );
        return accumulator;
      },
      new Map(),
    );

    const leaderboard = Array.from(rowsBySeller.values()).map((item) => {
      const target = quarterTargets.targetBySellerId.get(item.sellerUserId);
      const nextQuarterTarget = nextQuarterTargets.targetBySellerId.get(
        item.sellerUserId,
      );
      const recentLeadConversion =
        recentLeadConversionBySeller.get(item.sellerUserId) || null;
      const recentOpportunityConversion =
        recentOpportunityConversionBySeller.get(item.sellerUserId) || null;
      return buildSellerLeagueRow({
        sellerUserId: item.sellerUserId,
        sellerUserName: item.sellerUserName,
        quarterWonItems: item.wonItems,
        quarterOpenItems: item.openItems,
        nextQuarterQuotaAmountUsd: nextQuarterTarget?.quotaAmountUsd || null,
        nextQuarterOpenPipelineUsd:
          nextQuarterOpenPipelineUsdBySeller.get(item.sellerUserId) || 0,
        advancedOpportunityIds14d,
        quotaAmountUsd: target?.quotaAmountUsd || null,
        leadActualCount: quarterLeadCountsBySeller.get(item.sellerUserId) || 0,
        leadQualifiedCount:
          quarterQualifiedLeadCountsBySeller.get(item.sellerUserId) || 0,
        conversionLeadTotalCount: recentLeadConversion?.totalLeadCount || 0,
        conversionLeadQualifiedCount:
          recentLeadConversion?.qualifiedLeadCount || 0,
        conversionOpportunityTotalCount:
          recentOpportunityConversion?.totalOpportunityCount || 0,
        conversionOpportunityWonCount:
          recentOpportunityConversion?.wonOpportunityCount || 0,
        opportunityCreatedActualCount:
          quarterCreatedOpportunityCountsBySeller.get(item.sellerUserId) || 0,
        opportunitiesPerWeekWeeklyCounts:
          opportunityCreatedWeeklySeriesBySeller.get(item.sellerUserId) ||
          Array.from({ length: 10 }, () => 0),
        averageSaleTicketLast10:
          lastWonTicketAverageBySeller.get(item.sellerUserId) || 0,
        sellerParameters:
          sellerParametersBySeller.get(item.sellerUserId) || null,
        opportunityToWinDays: opportunityToWinDaysBySeller.has(
          item.sellerUserId,
        )
          ? opportunityToWinDaysBySeller.get(item.sellerUserId)
          : null,
        opportunityToWinWeeklyDays:
          opportunityToWinWeeklySeriesBySeller.get(item.sellerUserId) ||
          Array.from({ length: 10 }, () => null),
        opportunityToWinWeeklyConversionPct:
          opportunityToWinConversionWeeklySeriesBySeller.get(
            item.sellerUserId,
          ) || Array.from({ length: 10 }, () => 0),
        leadToOpportunityDays: leadToOpportunityDaysBySeller.has(
          item.sellerUserId,
        )
          ? leadToOpportunityDaysBySeller.get(item.sellerUserId)
          : null,
        leadToOpportunityWeeklyDays:
          leadToOpportunityWeeklySeriesBySeller.get(item.sellerUserId) ||
          Array.from({ length: 10 }, () => null),
        leadToOpportunityWeeklyConversionPct:
          leadToOpportunityConversionWeeklySeriesBySeller.get(
            item.sellerUserId,
          ) || Array.from({ length: 10 }, () => 0),
        leadsPerWeekWeeklyCounts:
          leadCreatedWeeklySeriesBySeller.get(item.sellerUserId) ||
          Array.from({ length: 10 }, () => 0),
        leadsAssignedDays:
          leadAssignedAgeDaysBySeller.get(item.sellerUserId) || 0,
        leadsAssignedWeeklyDays:
          leadAssignedWeeklySeriesBySeller.get(item.sellerUserId) ||
          Array.from({ length: 10 }, () => null),
        quarterComplianceSeries:
          quarterComplianceSeriesBySeller.get(item.sellerUserId) || [],
      });
    });

    leaderboard.sort((left, right) => {
      const scoreDelta =
        Number(right.scoreTotal || -1) - Number(left.scoreTotal || -1);
      if (scoreDelta !== 0) return scoreDelta;
      const closingDelta =
        Number(right.scoreClosing || -1) - Number(left.scoreClosing || -1);
      if (closingDelta !== 0) return closingDelta;
      const wonDelta =
        Number(right.wonAmountUsd || 0) - Number(left.wonAmountUsd || 0);
      if (wonDelta !== 0) return wonDelta;
      const buildDelta =
        Number(right.scoreBuild || 0) - Number(left.scoreBuild || 0);
      if (buildDelta !== 0) return buildDelta;
      const momentumDelta =
        Number(right.momentum7d || 0) - Number(left.momentum7d || 0);
      if (momentumDelta !== 0) return momentumDelta;
      const disciplineDelta =
        Number(right.scoreDiscipline || 0) - Number(left.scoreDiscipline || 0);
      if (disciplineDelta !== 0) return disciplineDelta;
      return String(left.sellerUserName || "").localeCompare(
        String(right.sellerUserName || ""),
        "es",
        { sensitivity: "base" },
      );
    });

    let officialRank = 0;
    const withRank = leaderboard.map((row, index) => {
      const previousOfficial = leaderboard
        .slice(0, index)
        .filter((item) => item.isOfficial)
        .at(-1);
      const rankGapToNext =
        row.isOfficial && previousOfficial
          ? toAmount(
              Number(previousOfficial.scoreTotal || 0) -
                Number(row.scoreTotal || 0),
            )
          : null;
      if (row.isOfficial) {
        officialRank += 1;
      }
      return {
        ...row,
        rankPosition: row.isOfficial ? officialRank : null,
        rankGapToNext,
      };
    });

    const teamQuotaAmountUsd = toAmount(
      withRank.reduce((sum, row) => sum + Number(row.quotaAmountUsd || 0), 0),
    );
    const teamWonAmountUsd = toAmount(
      withRank.reduce((sum, row) => sum + Number(row.wonAmountUsd || 0), 0),
    );
    const teamAttainmentPct =
      teamQuotaAmountUsd > 0
        ? toAmount((teamWonAmountUsd / teamQuotaAmountUsd) * 100)
        : null;

    res.json({
      screenDisplayMinutes: Number(
        commercialSettings?.sellerLeagueScreenDisplayMinutes || 1,
      ),
      screenRotationMinutes: Number(
        commercialSettings?.sellerLeagueScreenRotationMinutes || 1,
      ),
      period: {
        year: quarterSelection.year,
        quarter: quarterSelection.quarter,
        label: quarterSelection.label,
        startDate: quarterStart,
        endDate: quarterEnd,
      },
      quarterContext: {
        current: {
          year: quarterSelection.year,
          quarter: quarterSelection.quarter,
          label: quarterSelection.label,
          startDate: quarterStart,
          endDate: quarterEnd,
          daysTotal: currentQuarterDaysTotal,
          daysElapsed: currentQuarterDaysElapsed,
          daysRemaining: currentQuarterDaysRemaining,
          weeksRemaining: currentQuarterWeeksRemaining,
          elapsedRatio: toAmount(
            currentQuarterDaysElapsed / currentQuarterDaysTotal,
          ),
          remainingRatio: toAmount(
            currentQuarterDaysRemaining / currentQuarterDaysTotal,
          ),
        },
        next: {
          year: nextQuarterSelection.year,
          quarter: nextQuarterSelection.quarter,
          label: nextQuarterSelection.label,
          startDate: nextQuarterStart,
          endDate: nextQuarterEnd,
        },
      },
      generatedAt: new Date().toISOString(),
      weights: {
        closing: 0.5,
        build: 0.3,
        discipline: 0.2,
      },
      planning: {
        hasPlan: quarterTargets.hasPlan,
        hasPublishedVersion: quarterTargets.hasPublishedVersion,
        versionLabel: quarterTargets.versionLabel,
        currencyCode: quarterTargets.currencyCode,
      },
      permissions: {
        canReadAllSellers: canReadAllSellerLeague,
      },
      team: {
        sellersVisible: withRank.length,
        sellersOfficial: withRank.filter((row) => row.isOfficial).length,
        quotaAmountUsd: teamQuotaAmountUsd,
        wonAmountUsd: teamWonAmountUsd,
        attainmentPct: teamAttainmentPct,
        overdueCount: withRank.reduce(
          (sum, row) => sum + Number(row.overdueCount || 0),
          0,
        ),
        noNextStepCount: withRank.reduce(
          (sum, row) => sum + Number(row.noNextStepCount || 0),
          0,
        ),
        blockedCriticalCount: withRank.reduce(
          (sum, row) => sum + Number(row.blockedCriticalCount || 0),
          0,
        ),
      },
      leaderboard: withRank,
    });
  },
);

router.get(
  "/open-opportunities",
  requireAnyPermission(["seguimiento_comercial.read"]),
  requireAnyPermission(["oportunidades.read", "oportunidades.read_all"]),
  async (req, res) => {
    const sellerUserId = toPositiveInt(req.query?.sellerUserId);
    const businessLineId = toPositiveInt(req.query?.businessLineId);
    const quickFilter = String(req.query?.quickFilter || "all").trim();
    const weekRange = getWeekRange(req.query?.weekStart);
    const closeDateFrom =
      String(req.query?.closeDateFrom || "").trim() || undefined;
    const closeDateTo =
      String(req.query?.closeDateTo || "").trim() || undefined;
    const items = await buildOpenOpportunityItems(req.user, {
      sellerUserId,
      businessLineId,
      weekRange,
      closeDateFrom,
      closeDateTo,
    });

    const filteredItems = items.filter((item) => {
      if (quickFilter === "blocked")
        return item.executionStateCode === "bloqueada";
      if (quickFilter === "no_next_step") return !item.nextStep;
      if (quickFilter === "stale") return item.isStale;
      if (quickFilter === "advanced_this_week") return item.advancedThisWeek;
      if (quickFilter === "waiting_customer")
        return item.executionStateCode === "esperando_cliente";
      if (quickFilter === "waiting_internal")
        return item.executionStateCode === "esperando_interno";
      return true;
    });

    res.json({
      appliedFilters: {
        weekStart: formatIsoDate(weekRange.start),
        sellerUserId,
        businessLineId,
        quickFilter,
      },
      summary: {
        total: filteredItems.length,
        totalAmountUsd: toAmount(
          filteredItems.reduce(
            (sum, item) => sum + Number(item.amountUsd || 0),
            0,
          ),
        ),
      },
      items: filteredItems,
    });
  },
);

router.get(
  "/won-opportunities",
  requireAnyPermission(["seguimiento_comercial.read"]),
  requireAnyPermission(["oportunidades.read", "oportunidades.read_all"]),
  async (req, res) => {
    const sellerUserId = toPositiveInt(req.query?.sellerUserId);
    const businessLineId = toPositiveInt(req.query?.businessLineId);
    const weekRange = getWeekRange(req.query?.weekStart);
    const closeDateFrom =
      String(req.query?.closeDateFrom || "").trim() || undefined;
    const closeDateTo =
      String(req.query?.closeDateTo || "").trim() || undefined;
    const items = await buildWonOpportunityItems(req.user, {
      sellerUserId,
      businessLineId,
      weekRange,
      closeDateFrom,
      closeDateTo,
    });

    res.json({
      appliedFilters: {
        weekStart: formatIsoDate(weekRange.start),
        sellerUserId,
        businessLineId,
      },
      summary: {
        total: items.length,
        totalAmountUsd: toAmount(
          items.reduce((sum, item) => sum + Number(item.amountUsd || 0), 0),
        ),
      },
      items,
    });
  },
);

router.get(
  "/opportunities-by-period",
  requireAnyPermission(["seguimiento_comercial.read"]),
  requireAnyPermission(["oportunidades.read", "oportunidades.read_all"]),
  async (req, res) => {
    const sellerUserId = toPositiveInt(req.query?.sellerUserId);
    const businessLineId = toPositiveInt(req.query?.businessLineId);
    const viewMode =
      String(req.query?.viewMode || "count").trim() === "amount"
        ? "amount"
        : "count";
    const granularity =
      String(req.query?.granularity || "month").trim() === "week"
        ? "week"
        : "month";
    const to = endOfDay(parseDateOrFallback(req.query?.to, new Date()));
    const fallbackFrom =
      granularity === "week"
        ? addDays(to, -83)
        : new Date(to.getFullYear(), to.getMonth() - 11, 1);
    const from = startOfDay(parseDateOrFallback(req.query?.from, fallbackFrom));

    const scopedOpportunities = await listScopedOpportunities(req.user, {
      sellerUserId,
      businessLineId,
      createdAtLte: to,
    });
    const periods = buildPeriods(from, to, granularity);

    const series = periods.map((period, index) => {
      const created = scopedOpportunities.filter((item) =>
        isBetween(item.created_at, period.start, period.end),
      );
      const won = scopedOpportunities.filter(
        (item) =>
          item.commercial_status_code === "ganada" &&
          isBetween(item.commercial_closed_at, period.start, period.end),
      );
      const lost = scopedOpportunities.filter(
        (item) =>
          ["perdida", "anulada"].includes(
            String(item.commercial_status_code),
          ) && isBetween(item.commercial_closed_at, period.start, period.end),
      );
      const openAtEnd = scopedOpportunities.filter((item) =>
        isOpenAtDate(item, period.end),
      );
      const previous = index > 0 ? periods[index - 1] : null;
      const previousCreated = previous
        ? scopedOpportunities.filter((item) =>
            isBetween(item.created_at, previous.start, previous.end),
          ).length
        : 0;

      return {
        periodKey: period.key,
        periodLabel: period.label,
        createdCount: created.length,
        createdAmountUsd: sumAmounts(created),
        wonCount: won.length,
        wonAmountUsd: sumAmounts(won),
        lostCount: lost.length,
        lostAmountUsd: sumAmounts(lost),
        openAtEndCount: openAtEnd.length,
        openAtEndAmountUsd: sumAmounts(openAtEnd),
        deltaVsPrevious: buildVariation(created.length, previousCreated),
      };
    });

    res.json({
      meta: {
        from: formatIsoDate(from),
        to: formatIsoDate(to),
        granularity,
        sellerUserId,
        businessLineId,
        viewMode,
      },
      totals: {
        totalCreatedCount: series.reduce(
          (sum, item) => sum + item.createdCount,
          0,
        ),
        totalCreatedAmountUsd: toAmount(
          series.reduce(
            (sum, item) => sum + Number(item.createdAmountUsd || 0),
            0,
          ),
        ),
        totalWonCount: series.reduce((sum, item) => sum + item.wonCount, 0),
        totalWonAmountUsd: toAmount(
          series.reduce((sum, item) => sum + Number(item.wonAmountUsd || 0), 0),
        ),
        totalLostCount: series.reduce((sum, item) => sum + item.lostCount, 0),
        totalLostAmountUsd: toAmount(
          series.reduce(
            (sum, item) => sum + Number(item.lostAmountUsd || 0),
            0,
          ),
        ),
      },
      series,
    });
  },
);

export default router;
