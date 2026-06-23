import express from "express";
import { requireAnyPermission } from "./auth.js";
import { query } from "./db.js";
import {
  getCommercialSettings,
  STAGE_SLA_DEFAULTS,
  STAGE_WEIGHT_DEFAULTS,
} from "./settings.js";

const router = express.Router();

let _stageSlaCache = null;
let _stageSlaExpiry = 0;
let _forecastStageWeightCache = { ...STAGE_WEIGHT_DEFAULTS };

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

function userHasPermission(user, permission) {
  return user?.permissionSet?.has(permission);
}

function hasGlobalOpportunityScope(user) {
  return userHasPermission(user, "oportunidades.read_all");
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
             ) AS base_sale_total
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
              (${buildQuotationVersionEffectiveTotalSql({ versionAlias: "qv", totalsAlias: "quotation_total" })}) *
              CASE
                WHEN UPPER(COALESCE(qv.currency_code, 'USD')) = 'USD' THEN 1
                WHEN COALESCE(qv.exchange_rate, 0) > 0 THEN 1 / qv.exchange_rate
                ELSE 1
              END
            ) AS contribution_amount_usd
     FROM quotations q
     INNER JOIN quotation_versions qv ON qv.quotation_id = q.id
     INNER JOIN quotation_statuses qs ON qs.id = qv.status_id
     ${buildQuotationVersionBaseSaleTotalJoin("qv")}
     WHERE q.opportunity_id IN (${placeholders})
       AND qs.code = 'ganada'
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
  const timingFlags = buildCloseTimingFlags(stageOrder, monthRange, row?.close_date);

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

function clampForecastWeight({
  weight,
  stageOrder,
  issueFlags,
}) {
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

  const dominantStageRow = Array.from(dominantStage.values()).sort((left, right) => {
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
      impactLabel: "El mes no se cubre solo con ganado y forecast defendible actual.",
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
  const weakShare = forecastGrossAmount > 0 ? weakAmount / forecastGrossAmount : 0;
  const concentrated = criticalOpportunities.length > 0 && criticalOpportunities
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
  const committedItems = forecastItems.filter((item) => item.category === "committed");
  const probableItems = forecastItems.filter((item) => item.category === "probable");
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
    const origin = item.origin || originByOpportunity.get(opportunityId) || "direct";
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
    if (String(item.commercial_status_code || item.commercialStatusCode || "") === "ganada") {
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
      return Number(right.weightedAmountUsd || 0) - Number(left.weightedAmountUsd || 0);
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
    scopedOpportunities
      .map((item) => Number(item.id || 0))
      .filter(Boolean),
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
        stageName: item.sales_stage_name || stageNameByCode.get(stageCode) || "Sin etapa",
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
          ? toAmount((Number(item.openAmountUsd || 0) / funnelOpenAmountUsd) * 100)
          : 0,
      }))
      .sort((left, right) => Number(left.stageOrder || 0) - Number(right.stageOrder || 0));

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
          Number(
            wonContributionByOpportunity.get(Number(item.id || 0)) || 0,
          ),
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
        ? toAmount((actualSalesAmountUsd / Number(targetSummary.quotaSalesAmountUsd || 0)) * 100)
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
