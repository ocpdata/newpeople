import express from "express";
import { requireAnyPermission } from "./auth.js";
import { query } from "./db.js";

const router = express.Router();

const STAGE_SLA_DAYS = {
  contacto_inicial: 3,
  identificacion_oportunidad: 3,
  desarrollo: 5,
  cotizacion: 5,
  demostracion: 6,
  negociacion: 4,
  waiting: 3,
  descubrimiento: 5,
  validacion_valor: 5,
};

const NEXT_STEP_ACTION_TYPES = [
  "next_step",
  "follow_up",
  "call",
  "waiting_customer",
];

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
            o.commercial_closed_at,
            a.name AS account_name,
            oss.code AS sales_stage_code,
            oss.name AS sales_stage_name,
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

  return openRows
    .map((row) => {
      const opportunityId = Number(row.id);
      const nextStep = nextSteps.get(opportunityId) || null;
      const dependencies = dependenciesByOpportunity.get(opportunityId) || [];
      const executionState = getExecutionState({ nextStep, dependencies });
      const lastActivity = lastActivityByOpportunity.get(opportunityId) || null;
      const slaDays = STAGE_SLA_DAYS[row.sales_stage_code] || 5;
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

  return wonRows
    .map((row) => {
      const opportunityId = Number(row.id);
      const nextStep = nextSteps.get(opportunityId) || null;
      const dependencies = dependenciesByOpportunity.get(opportunityId) || [];
      const lastActivity = lastActivityByOpportunity.get(opportunityId) || null;
      const slaDays = STAGE_SLA_DAYS[row.sales_stage_code] || 5;
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
    String(item.sales_stage_code || item.stageCode || "") === "cierre"
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
       WHERE v2.period_id = p.id AND v2.status = 'active'
       ORDER BY v2.version_number DESC, v2.id DESC
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
    forecastOpportunities,
    generationTrend,
    pipelineMovement: Array.from(pipelineMovementMap.values()).sort(
      (left, right) => right.openCount - left.openCount,
    ),
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
