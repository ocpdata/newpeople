import { buffer as streamToBuffer } from "node:stream/consumers";
import { createHash, randomUUID } from "node:crypto";
import express from "express";
import {
  getUserAuthContext,
  requireAnyPermission,
  requirePermission,
} from "./auth.js";
import { logAuditEvent } from "./audit.js";
import {
  getCommercialEnablementAssetDetail,
  getCommercialEnablementFileStream,
  listCommercialEnablementAssets,
  loadCommercialEnablementRecommendationCatalog,
  recommendCommercialEnablementResources,
} from "./commercial-enablement/service.js";
import { listCommercialLibraryFilesForEmail as listCommercialLibraryFilesForEmailShared } from "./commercial-email/shared.js";
import { ensureCommercialNarrativeJobSchema } from "./commercial-development/narrative-jobs-schema.js";
import {
  assertAiBudgetAvailable,
  recordAiUsageFromOpenAiResponse,
} from "./ai-usage/service.js";
import { config } from "./config.js";
import { query } from "./db.js";
import { ensureCommercialExecutionSchema } from "./commercial-execution/schema.js";
import {
  getDocumentContentStream,
  listOpportunityDocuments,
} from "./opportunity-documents/service.js";
import {
  buildOpportunityWorkspace,
  saveOpportunityAction,
} from "./opportunity-workspace/service.js";
import { ensureCommercialPlanningSchema } from "./commercial-planning/schema.js";
import { buildQuotationPdfBuffer } from "./quotationPdf.js";
import {
  getCommercialSettings,
  getCompanyDocumentBranding,
  STAGE_SLA_DEFAULTS,
} from "./settings.js";
import { sendCommercialActionEmail } from "./utils.js";

const router = express.Router();

let _stageSlaCache = null;
let _stageSlaExpiry = 0;
let _businessTimezoneCache = null;
let _businessTimezoneExpiry = 0;

async function loadStageSlaMap() {
  if (_stageSlaCache && Date.now() < _stageSlaExpiry) {
    return _stageSlaCache;
  }
  const settings = await getCommercialSettings().catch(() => null);
  _stageSlaCache = settings?.stageSlaMap
    ? { ...STAGE_SLA_DEFAULTS, ...settings.stageSlaMap }
    : { ...STAGE_SLA_DEFAULTS };
  _stageSlaExpiry = Date.now() + 60000;
  return _stageSlaCache;
}

async function loadBusinessTimezone() {
  if (_businessTimezoneCache && Date.now() < _businessTimezoneExpiry) {
    return _businessTimezoneCache;
  }
  const settings = await getCommercialSettings().catch(() => null);
  _businessTimezoneCache =
    String(
      settings?.businessTimezone || config.app?.businessTimezone || "",
    ).trim() || "America/Mexico_City";
  _businessTimezoneExpiry = Date.now() + 60000;
  return _businessTimezoneCache;
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

const LATE_STAGE_CODES = new Set([
  "cotizacion",
  "demostracion",
  "negociacion",
  "waiting",
]);

const CADENCE_VISIBLE_LIMIT = 10;
const DEVELOPMENT_PRIORITY_LIMIT = 12;
const DEVELOPMENT_ACTION_LIMIT = 10;

const COMMERCIAL_EMAIL_ATTACHMENT_MAX_FILES = 10;
const COMMERCIAL_EMAIL_ATTACHMENT_MAX_TOTAL_BYTES = 15 * 1024 * 1024;
const COMMERCIAL_EMAIL_LIBRARY_SUGGESTION_MAX_FILES = 3;
const COMMERCIAL_EMAIL_ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "text/plain",
  "image/png",
  "image/jpeg",
]);

const NEXT_STEP_ACTION_TYPES = new Set([
  "next_step",
  "follow_up",
  "call",
  "waiting_customer",
]);

const COMMERCIAL_ACTIVITY_ACTION_TYPES = new Set([
  "call",
  "conference",
  "visit",
  "presentation",
  "other",
]);

const COMMERCIAL_ACTION_ITEM_TYPES = new Set([
  ...NEXT_STEP_ACTION_TYPES,
  "send_email",
  "prepare_proposal",
  "request_information",
  "coordinate_presales",
  "send_documentation",
  "update_quote",
  "internal_approval",
  "other_action",
]);

const COMMERCIAL_TIMELINE_ACTION_TYPES = new Set([
  ...COMMERCIAL_ACTIVITY_ACTION_TYPES,
  ...COMMERCIAL_ACTION_ITEM_TYPES,
]);

const COMMERCIAL_ACTIVITY_STATUSES = new Set([
  "pending",
  "confirmed",
  "done",
  "missed",
  "rescheduled",
  "cancelled",
  "in_progress",
  "blocked",
]);

const COMMERCIAL_ACTION_STATUSES = new Set([
  "pending",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
]);
const COMMERCIAL_NARRATIVE_JOB_LEASE_SECONDS = 30;
const COMMERCIAL_NARRATIVE_JOB_RESULT_TTL_MINUTES = 15;
const COMMERCIAL_NARRATIVE_JOB_POLL_AFTER_MS = 3000;
const AI_NARRATIVE_MAX_ANSWER_CHARS = 1500;

let commercialNarrativeWorkerQueued = false;
let commercialNarrativeWorkerStarted = false;

const COMMERCIAL_ACTIVITY_OPEN_STATUSES = new Set([
  "pending",
  "confirmed",
  "rescheduled",
  "in_progress",
  "blocked",
]);

const COMMERCIAL_ACTION_OPEN_STATUSES = new Set([
  "pending",
  "in_progress",
  "blocked",
]);

const CALENDAR_COMPLETED_ACTIVITY_STATUSES = new Set(["done"]);

const LEAD_SUBSTATUS_LABELS = {
  new_unreviewed: "Nuevo sin revisar",
  research_pending: "Investigación pendiente",
  ready_for_outreach: "Listo para contacto",
  contact_attempt_pending: "Intento de contacto pendiente",
  contacted_waiting_response: "Contactado, en espera de respuesta",
  meeting_requested: "Reunión solicitada",
  meeting_confirmed: "Reunión confirmada",
  needs_follow_up_later: "Seguimiento posterior",
  wrong_contact_identified: "Contacto incorrecto detectado",
  alternative_contact_needed: "Se necesita contacto alternativo",
  account_has_other_potential: "La cuenta tiene potencial adicional",
  value_misaligned_current_contact: "Valor no alineado con este contacto",
  budget_timing_issue: "Restricción de presupuesto",
  priority_not_now: "No es prioridad ahora",
  qualified_opportunity_created: "Oportunidad creada",
  disqualified_temporary: "Descalificación temporal",
  disqualified_definitive: "Descalificación definitiva",
};
const BUSINESS_TIMEZONE =
  String(config.app?.businessTimezone || "America/Mexico_City").trim() ||
  "America/Mexico_City";
const CALENDAR_MIN_SLA_DAYS = 1;
const CALENDAR_MAX_SLA_DAYS = 30;
const CALENDAR_DEFAULT_SLA_DAYS = Math.min(
  CALENDAR_MAX_SLA_DAYS,
  Math.max(CALENDAR_MIN_SLA_DAYS, Number(config.app?.calendarSlaDays || 5)),
);
const CALENDAR_DEFAULT_REMINDER_LEAD_MINUTES = Math.max(
  0,
  Number(config.app?.calendarReminderLeadMinutes || 60),
);
const CALENDAR_ALERT_LOOKBACK_DAYS = 45;
const LEAD_FOLLOW_UP_ACTION_LABELS = {
  schedule_meeting: "Agendar reunion",
  send_follow_up_message: "Enviar seguimiento",
  retry_contact: "Reintentar contacto",
  contact_referred_person: "Contactar persona referida",
  explore_other_area: "Explorar otra area",
  revisit_on_date: "Definir fecha de recontacto",
  collect_missing_context: "Completar contexto",
  create_opportunity: "Crear oportunidad",
  close_as_disqualified: "Cerrar como descalificado",
  mark_do_not_contact: "Marcar como no contactar",
};

const DEPENDENCY_TYPE_LABELS = {
  presales_support: "Preventa",
  provider_response: "Proveedor",
  legal_review: "Legal",
  commercial_management: "Direccion comercial",
  pricing_internal: "Cotizacion interna",
  finance_approval: "Finanzas",
  operations_alignment: "Operaciones",
};

const CADENCE_LIBRARY = {
  discovery_push: {
    title: "Cadencia de descubrimiento ejecutivo",
    description:
      "Asegura siguiente paso, sponsor y evidencia operativa en oportunidades tempranas.",
    steps: [
      "Alinear proximo paso con fecha cerrada y responsable del cliente.",
      "Confirmar dolor economico, criterio de exito y urgencia ejecutiva.",
      "Acordar reunion con sponsor operativo y decisor.",
    ],
  },
  proposal_conversion: {
    title: "Cadencia de conversion de propuesta",
    description:
      "Reduce friccion despues de la propuesta y acelera validacion de negocio.",
    steps: [
      "Revisar propuesta con mapa de valor, ROI y condicion de cierre.",
      "Desbloquear objeciones legales, tecnicas o de compra en 48 horas.",
      "Cerrar reunion de decision con plan de implementacion y fecha compromiso.",
    ],
  },
  rescue_inactive: {
    title: "Cadencia de rescate comercial",
    description:
      "Reactiva oportunidades frenadas con mensaje directivo y secuencia corta.",
    steps: [
      "Enviar recap ejecutivo con riesgo de no actuar y propuesta de decision.",
      "Llamar al sponsor y validar si la oportunidad sigue priorizada.",
      "Escalar con nueva hipotesis de valor o cerrar perdida tecnica controlada.",
    ],
  },
};

router.use(async (_req, _res, next) => {
  try {
    await Promise.all([
      ensureCommercialExecutionSchema(),
      ensureCommercialPlanningSchema(),
    ]);
    next();
  } catch (error) {
    next(error);
  }
});

function getQuarterLabel(year, quarter) {
  return `T${quarter} ${year}`;
}

function roundAmount(value) {
  return Number(Number(value || 0).toFixed(2));
}

function toOpportunityScore(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }
  return roundAmount(clampNumber((numericValue / 3) * 10, 0, 10));
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toIsoDate(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}

function formatDateInTimeZone(dateValue, timeZone) {
  const parsed = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return null;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(parsed);
}

function getTimeZoneOffsetMinutes(dateValue, timeZone) {
  const parsed = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return 0;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(parsed);
  const lookup = {};
  parts.forEach((part) => {
    if (part.type !== "literal") {
      lookup[part.type] = part.value;
    }
  });

  const asUtc = Date.UTC(
    Number(lookup.year),
    Number(lookup.month) - 1,
    Number(lookup.day),
    Number(lookup.hour),
    Number(lookup.minute),
    Number(lookup.second),
  );
  return (asUtc - parsed.getTime()) / 60000;
}

function parseDateTimeLocalText(value) {
  const rawValue = String(value || "").trim();
  const match = rawValue.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/,
  );
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] || 0);
  const millisecond = Number(String(match[7] || "0").padEnd(3, "0"));

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    !Number.isInteger(second) ||
    !Number.isInteger(millisecond)
  ) {
    return null;
  }

  return { year, month, day, hour, minute, second, millisecond };
}

function toBusinessDateTimeUtc(dateTimeText, timeZone) {
  const parsed = parseDateTimeLocalText(dateTimeText);
  if (!parsed) {
    return null;
  }

  const baseUtcMs = Date.UTC(
    parsed.year,
    parsed.month - 1,
    parsed.day,
    parsed.hour,
    parsed.minute,
    parsed.second,
    parsed.millisecond,
  );

  let resultMs = baseUtcMs;
  for (let index = 0; index < 3; index += 1) {
    const offsetMinutes = getTimeZoneOffsetMinutes(resultMs, timeZone);
    const nextResultMs = baseUtcMs - offsetMinutes * 60000;
    if (nextResultMs === resultMs) {
      break;
    }
    resultMs = nextResultMs;
  }

  return new Date(resultMs);
}

function toTimeZoneStartOfDayUtc(dateText, timeZone) {
  const parsed = parseDateOnly(dateText);
  if (!parsed) return null;

  const year = parsed.getUTCFullYear();
  const month = parsed.getUTCMonth();
  const day = parsed.getUTCDate();
  const utcMidnightMs = Date.UTC(year, month, day, 0, 0, 0);
  let offsetMinutes = getTimeZoneOffsetMinutes(utcMidnightMs, timeZone);
  let resultMs = utcMidnightMs - offsetMinutes * 60000;

  const normalizedOffset = getTimeZoneOffsetMinutes(resultMs, timeZone);
  if (normalizedOffset !== offsetMinutes) {
    offsetMinutes = normalizedOffset;
    resultMs = utcMidnightMs - offsetMinutes * 60000;
  }

  return new Date(resultMs);
}

function buildContactDisplayName(contact) {
  return String(
    contact?.full_name ||
      contact?.fullName ||
      [contact?.first_name, contact?.last_name].filter(Boolean).join(" "),
  ).trim();
}

async function listContactsByAccountIds(accountIds) {
  const normalizedIds = Array.from(
    new Set(
      (accountIds || [])
        .map((value) => Number(value || 0))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  );
  if (!normalizedIds.length) {
    return new Map();
  }

  const placeholders = normalizedIds.map(() => "?").join(", ");
  const rows = await query(
    `SELECT c.id, c.account_id, c.first_name, c.last_name, c.position_title, c.email
     FROM contacts c
     WHERE c.account_id IN (${placeholders})
       AND COALESCE(TRIM(c.email), '') <> ''
     ORDER BY c.account_id ASC, c.first_name ASC, c.last_name ASC, c.id ASC`,
    normalizedIds,
  ).catch(() => []);

  return rows.reduce((accumulator, row) => {
    const accountId = Number(row.account_id || 0);
    if (!accountId) return accumulator;
    const current = accumulator.get(accountId) || [];
    current.push({
      id: Number(row.id),
      fullName: buildContactDisplayName(row),
      positionTitle: row.position_title || "",
      email: row.email || "",
    });
    accumulator.set(accountId, current);
    return accumulator;
  }, new Map());
}

async function listNarrativeStageAnswers({ opportunityId, salesStageId }) {
  const normalizedOpportunityId = Number(opportunityId || 0);
  const normalizedSalesStageId = Number(salesStageId || 0);
  if (
    !Number.isInteger(normalizedOpportunityId) ||
    normalizedOpportunityId <= 0 ||
    !Number.isInteger(normalizedSalesStageId) ||
    normalizedSalesStageId <= 0
  ) {
    return [];
  }

  const rows = await query(
    `SELECT q.code,
            q.prompt,
            q.is_required,
            a.answer_value,
            a.answered_at
     FROM opportunity_stage_questions q
     LEFT JOIN opportunity_stage_question_answers a
       ON a.id = (
         SELECT a2.id
         FROM opportunity_stage_question_answers a2
         WHERE a2.opportunity_id = ?
           AND a2.sales_stage_id = ?
           AND a2.question_id = q.id
         ORDER BY a2.id DESC
         LIMIT 1
       )
     WHERE q.sales_stage_id = ?
       AND q.is_active = 1
     ORDER BY q.display_order, q.id`,
    [normalizedOpportunityId, normalizedSalesStageId, normalizedSalesStageId],
  ).catch(() => []);

  return rows.map((row) => ({
    salesStageId: normalizedSalesStageId,
    salesStageName: "",
    questionCode: String(row.code || "").trim(),
    questionPrompt: String(row.prompt || "").trim(),
    answerValue: String(row.answer_value || "").trim(),
    isRequired: Boolean(row.is_required),
    answeredAt: row.answered_at || null,
  }));
}

function resolveQuarterSelection(input) {
  const now = new Date();
  const fallbackQuarter = Math.floor(now.getMonth() / 3) + 1;
  const year = Number(input?.year);
  const quarter = Number(input?.quarter);
  return {
    year:
      Number.isInteger(year) && year >= 2020 && year <= 2100
        ? year
        : now.getFullYear(),
    quarter:
      Number.isInteger(quarter) && quarter >= 1 && quarter <= 4
        ? quarter
        : fallbackQuarter,
  };
}

function getQuarterDateRange(year, quarter) {
  const start = new Date(Date.UTC(year, (quarter - 1) * 3, 1));
  const end = new Date(Date.UTC(year, quarter * 3, 0));
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function parseDateOnly(value) {
  const rawValue = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) {
    return null;
  }
  const [year, month, day] = rawValue.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addUtcDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + Number(days || 0));
  return next;
}

function getCalendarRange(view, requestedDate, timeZone = BUSINESS_TIMEZONE) {
  const normalizedView = ["day", "week", "month"].includes(view)
    ? view
    : "week";
  const anchorDateText =
    parseDateOnly(requestedDate)?.toISOString().slice(0, 10) ||
    formatDateInTimeZone(new Date(), timeZone);
  const anchor = parseDateOnly(anchorDateText);

  let start = anchor;
  let end = anchor;
  if (normalizedView === "week") {
    const dayOfWeek = anchor.getUTCDay();
    const offset = (dayOfWeek + 6) % 7;
    start = addUtcDays(anchor, -offset);
    end = addUtcDays(start, 6);
  }
  if (normalizedView === "month") {
    start = new Date(
      Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1),
    );
    end = new Date(
      Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0),
    );
  }

  return {
    view: normalizedView,
    selectedDate: toIsoDate(anchor),
    startDate: toIsoDate(start),
    endDate: toIsoDate(end),
    startDateTime: toTimeZoneStartOfDayUtc(toIsoDate(start), timeZone),
    endExclusiveDateTime: toTimeZoneStartOfDayUtc(
      toIsoDate(addUtcDays(end, 1)),
      timeZone,
    ),
  };
}

function listDateRangeDays(startDate, endDate) {
  const dates = [];
  for (
    let cursor = parseDateOnly(startDate);
    cursor && cursor <= parseDateOnly(endDate);
    cursor = addUtcDays(cursor, 1)
  ) {
    dates.push(toIsoDate(cursor));
  }
  return dates;
}

function resolveCalendarSlaDays(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed)) {
    return CALENDAR_DEFAULT_SLA_DAYS;
  }
  return Math.min(
    CALENDAR_MAX_SLA_DAYS,
    Math.max(CALENDAR_MIN_SLA_DAYS, parsed),
  );
}

function getTimeZoneDayWindow(dateText, timeZone = BUSINESS_TIMEZONE) {
  const start = toTimeZoneStartOfDayUtc(dateText, timeZone);
  if (!start) {
    return { start: null, end: null };
  }

  const parsed = parseDateOnly(dateText);
  const nextDateText = toIsoDate(addUtcDays(parsed, 1));
  return {
    start,
    end: toTimeZoneStartOfDayUtc(nextDateText, timeZone),
  };
}

function isDateWithinQuarter(value, year, quarter) {
  const isoDate = toIsoDate(value);
  if (!isoDate) return false;
  const { startDate, endDate } = getQuarterDateRange(year, quarter);
  return isoDate >= startDate && isoDate <= endDate;
}

function getStageConfidence(stageCode, stageOrder = 0, maxStageOrder = 6) {
  const mapped = {
    contacto_inicial: 0,
    identificacion_oportunidad: 0,
    desarrollo: 0.2,
    cotizacion: 0.45,
    demostracion: 0.65,
    negociacion: 0.85,
    waiting: 1,
  }[stageCode];

  if (mapped !== undefined) {
    return mapped;
  }

  if (!maxStageOrder) {
    return 0.35;
  }

  return clampNumber(
    Number(stageOrder || 0) / Number(maxStageOrder || 1),
    0.1,
    0.95,
  );
}

function isCommittedStage(stageCode) {
  return stageCode === "negociacion" || stageCode === "waiting";
}

function isRealWonStage(stageCode) {
  return stageCode === "ganada";
}

function isRealWonOpportunity(item = {}) {
  return (
    item.commercialStatusCode === "ganada" || isRealWonStage(item.stageCode)
  );
}

async function listDevelopmentPeriods() {
  const rows = await query(
    `SELECT p.id, p.plan_year, p.plan_quarter, p.status,
            EXISTS(
              SELECT 1
              FROM commercial_planning_versions v
              WHERE v.period_id = p.id AND v.status = 'active'
            ) AS has_active_version
     FROM commercial_planning_periods p
     ORDER BY p.plan_year DESC, p.plan_quarter DESC, p.id DESC
     LIMIT 8`,
    [],
  ).catch(() => []);

  return rows.map((row) => ({
    id: Number(row.id),
    year: Number(row.plan_year),
    quarter: Number(row.plan_quarter),
    label: getQuarterLabel(row.plan_year, row.plan_quarter),
    status: row.status,
    hasActiveVersion: Boolean(row.has_active_version),
  }));
}

async function loadPlanningSnapshot({ user, year, quarter, planningItems }) {
  const periodRows = await query(
    `SELECT p.id, p.plan_year, p.plan_quarter, p.base_currency_code, p.status, p.notes,
            v.id AS version_id, v.version_number, v.status AS version_status, v.label AS version_label
     FROM commercial_planning_periods p
     LEFT JOIN commercial_planning_versions v ON v.id = (
       SELECT v2.id
       FROM commercial_planning_versions v2
       WHERE v2.period_id = p.id
       ORDER BY CASE v2.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
                v2.version_number DESC,
                v2.id DESC
       LIMIT 1
     )
     WHERE p.plan_year = ? AND p.plan_quarter = ?
     ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
              p.id DESC
     LIMIT 1`,
    [year, quarter],
  ).catch(() => []);

  const periodRow = periodRows[0] || null;
  const hasGlobalScope = hasGlobalOpportunityScope(user);
  const targetParams = [];
  let targetScopeWhere = "";
  if (periodRow?.version_id) {
    targetParams.push(Number(periodRow.version_id));
    if (!hasGlobalScope) {
      targetScopeWhere = "AND t.seller_user_id = ?";
      targetParams.push(Number(user.id) || 0);
    }
  }

  const targetRows = periodRow?.version_id
    ? await query(
        `SELECT t.seller_user_id, t.sales_quota_amount, t.currency_code,
                t.expected_margin_percent, t.expected_contribution_amount,
                t.status, u.full_name AS seller_user_name
         FROM commercial_planning_targets t
         INNER JOIN users u ON u.id = t.seller_user_id
         WHERE t.version_id = ?
           AND t.status <> 'void'
           ${targetScopeWhere}
         ORDER BY u.full_name ASC`,
        targetParams,
      ).catch(() => [])
    : [];

  const { startDate, endDate } = getQuarterDateRange(year, quarter);
  const stageOrderValues = planningItems.map((item) =>
    Number(item.stageId || 0),
  );
  const maxStageOrder = stageOrderValues.length
    ? Math.max(...stageOrderValues)
    : 6;
  const itemsInQuarter = planningItems.filter((item) =>
    isDateWithinQuarter(item.closeDate, year, quarter),
  );
  const actualBySellerId = itemsInQuarter.reduce((accumulator, item) => {
    if (!isRealWonOpportunity(item)) {
      return accumulator;
    }
    const key = item.sellerUserId || null;
    const current = accumulator.get(key) || {
      actualAmount: 0,
      actualCount: 0,
    };
    current.actualAmount += Number(item.amountUsd || 0);
    current.actualCount += 1;
    accumulator.set(key, current);
    return accumulator;
  }, new Map());
  const openBySellerId = itemsInQuarter.reduce((accumulator, item) => {
    if (isRealWonOpportunity(item)) {
      return accumulator;
    }
    const key = item.sellerUserId || null;
    const current = accumulator.get(key) || {
      openAmount: 0,
      committedOpenAmount: 0,
      weightedOpenAmount: 0,
      openCount: 0,
    };
    const stageConfidence = getStageConfidence(
      item.stageCode,
      item.stageId,
      maxStageOrder,
    );
    current.openAmount += Number(item.amountUsd || 0);
    if (isCommittedStage(item.stageCode)) {
      current.committedOpenAmount += Number(item.amountUsd || 0);
    }
    current.weightedOpenAmount += Number(item.amountUsd || 0) * stageConfidence;
    current.openCount += 1;
    accumulator.set(key, current);
    return accumulator;
  }, new Map());

  const targetSnapshots = targetRows.map((row) => {
    const sellerUserId = Number(row.seller_user_id);
    const actual = actualBySellerId.get(sellerUserId) || {
      actualAmount: 0,
      actualCount: 0,
    };
    const open = openBySellerId.get(sellerUserId) || {
      openAmount: 0,
      committedOpenAmount: 0,
      weightedOpenAmount: 0,
      openCount: 0,
    };
    const quotaAmount = roundAmount(row.sales_quota_amount);
    const projectedAmount = roundAmount(
      actual.actualAmount + open.weightedOpenAmount,
    );
    return {
      sellerUserId,
      sellerUserName: row.seller_user_name,
      quotaAmount,
      currencyCode: row.currency_code || periodRow?.base_currency_code || "USD",
      expectedMarginPercent: Number(row.expected_margin_percent || 0),
      expectedContributionAmount: roundAmount(row.expected_contribution_amount),
      wonAmount: roundAmount(actual.actualAmount),
      wonCount: actual.actualCount,
      openAmount: roundAmount(open.openAmount),
      committedOpenAmount: roundAmount(open.committedOpenAmount),
      openCount: open.openCount,
      weightedOpenAmount: roundAmount(open.weightedOpenAmount),
      gapAmount: roundAmount(Math.max(quotaAmount - actual.actualAmount, 0)),
      projectedGapAmount: roundAmount(
        Math.max(quotaAmount - projectedAmount, 0),
      ),
      attainmentPercent: quotaAmount
        ? roundAmount((actual.actualAmount / quotaAmount) * 100)
        : null,
      projectionPercent: quotaAmount
        ? roundAmount((projectedAmount / quotaAmount) * 100)
        : null,
    };
  });

  const assignedAmount = roundAmount(
    targetSnapshots.reduce(
      (total, item) => total + Number(item.quotaAmount || 0),
      0,
    ),
  );
  const actualAmount = roundAmount(
    targetSnapshots.reduce(
      (total, item) => total + Number(item.wonAmount || 0),
      0,
    ),
  );
  const openAmount = roundAmount(
    targetSnapshots.reduce(
      (total, item) => total + Number(item.openAmount || 0),
      0,
    ),
  );
  const committedOpenAmount = roundAmount(
    targetSnapshots.reduce(
      (total, item) => total + Number(item.committedOpenAmount || 0),
      0,
    ),
  );
  const weightedOpenAmount = roundAmount(
    targetSnapshots.reduce(
      (total, item) => total + Number(item.weightedOpenAmount || 0),
      0,
    ),
  );
  const projectedAmount = roundAmount(actualAmount + weightedOpenAmount);
  const gapAmount = roundAmount(Math.max(assignedAmount - actualAmount, 0));
  const projectedGapAmount = roundAmount(
    Math.max(assignedAmount - projectedAmount, 0),
  );

  return {
    period: {
      id: periodRow ? Number(periodRow.id) : null,
      year,
      quarter,
      label: getQuarterLabel(year, quarter),
      baseCurrencyCode:
        periodRow?.base_currency_code ||
        targetSnapshots[0]?.currencyCode ||
        "USD",
      status: periodRow?.status || "unplanned",
      hasPlan: Boolean(periodRow),
      hasPublishedVersion: periodRow?.version_status === "active",
      versionId: periodRow?.version_id ? Number(periodRow.version_id) : null,
      versionNumber: periodRow?.version_number
        ? Number(periodRow.version_number)
        : null,
      versionLabel: periodRow?.version_label || null,
      notes: periodRow?.notes || "",
      startDate,
      endDate,
    },
    quota: {
      assignedAmount,
      actualAmount,
      openAmount,
      committedOpenAmount,
      weightedOpenAmount,
      projectedAmount,
      gapAmount,
      projectedGapAmount,
      attainmentPercent: assignedAmount
        ? roundAmount((actualAmount / assignedAmount) * 100)
        : null,
      projectionPercent: assignedAmount
        ? roundAmount((projectedAmount / assignedAmount) * 100)
        : null,
      targetCount: targetSnapshots.length,
    },
    sellerSnapshots: targetSnapshots,
  };
}

function buildPipelineByStage(items, quotaGapAmount = 0) {
  const maxStageOrder = items.length
    ? Math.max(...items.map((item) => Number(item.stageId || 0)))
    : 6;
  return Array.from(
    items.reduce((accumulator, item) => {
      const key = String(item.stageCode || item.stageId || "unknown");
      const current = accumulator.get(key) || {
        stageCode: item.stageCode,
        stageName: item.stageName,
        opportunityCount: 0,
        openAmount: 0,
        weightedAmount: 0,
        riskyCount: 0,
        overdueCount: 0,
        withoutNextStepCount: 0,
        quotaCoverageShare: 0,
      };
      const stageConfidence = getStageConfidence(
        item.stageCode,
        item.stageId,
        maxStageOrder,
      );
      current.opportunityCount += 1;
      current.openAmount += Number(item.amountUsd || 0);
      current.weightedAmount += Number(item.amountUsd || 0) * stageConfidence;
      if (item.riskLevel !== "low") current.riskyCount += 1;
      if (item.nextStep?.isOverdue) current.overdueCount += 1;
      if (!item.nextStep) current.withoutNextStepCount += 1;
      accumulator.set(key, current);
      return accumulator;
    }, new Map()),
    ([, item]) => ({
      ...item,
      openAmount: roundAmount(item.openAmount),
      weightedAmount: roundAmount(item.weightedAmount),
      quotaCoverageShare: quotaGapAmount
        ? roundAmount((item.weightedAmount / quotaGapAmount) * 100)
        : null,
    }),
  ).sort((left, right) => right.weightedAmount - left.weightedAmount);
}

function buildDevelopmentRecommendation(item) {
  if (!item.nextStep) {
    return "Define un siguiente paso con fecha y responsable para recuperar conducción.";
  }
  if (item.nextStep?.isOverdue) {
    return "Cierra o renegocia hoy el compromiso vencido para no seguir degradando la oportunidad.";
  }
  if (item.executionState?.code === "esperando_interno") {
    return "Destraba la dependencia interna antes de pedir otra reunión al cliente.";
  }
  if (item.executionState?.code === "esperando_cliente") {
    return "Empuja confirmación del cliente con resumen ejecutivo y fecha cerrada de decisión.";
  }
  if (item.riskLevel === "high") {
    return (
      item.riskReasons?.[0] ||
      "Atiende la principal señal de riesgo antes del siguiente hito comercial."
    );
  }
  return getRecommendedNextMove(item.recommendedNextMove);
}

function getRecommendedNextMove(value) {
  if (!value)
    return "Concreta el siguiente movimiento comercial con evidencia y fecha.";
  if (typeof value === "string") return value;
  return (
    value.title ||
    value.text ||
    "Concreta el siguiente movimiento comercial con evidencia y fecha."
  );
}

function extractResponseOutputText(data) {
  const directOutputText = String(data?.output_text || "").trim();
  if (directOutputText) return directOutputText;

  const outputEntries = Array.isArray(data?.output) ? data.output : [];
  const readPartText = (part) => {
    if (!part || typeof part !== "object") return "";

    const directText = String(part?.text || "").trim();
    if (directText) return directText;

    const nestedText = String(part?.text?.value || "").trim();
    if (nestedText) return nestedText;

    const nestedOutputText = String(part?.output_text || "").trim();
    if (nestedOutputText) return nestedOutputText;

    return "";
  };

  return (
    outputEntries
      .flatMap((entry) => (Array.isArray(entry?.content) ? entry.content : []))
      .filter((part) =>
        ["output_text", "text", "message_text"].includes(
          String(part?.type || "").toLowerCase(),
        ),
      )
      .map(readPartText)
      .find(Boolean) || ""
  );
}

function extractJsonObject(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function extractJsonValue(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    const objectStart = text.indexOf("{");
    const objectEnd = text.lastIndexOf("}");
    if (objectStart !== -1 && objectEnd !== -1 && objectEnd > objectStart) {
      try {
        return JSON.parse(text.slice(objectStart, objectEnd + 1));
      } catch {
        // Continue to array extraction fallback.
      }
    }

    const arrayStart = text.indexOf("[");
    const arrayEnd = text.lastIndexOf("]");
    if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
      try {
        return JSON.parse(text.slice(arrayStart, arrayEnd + 1));
      } catch {
        return null;
      }
    }

    return null;
  }
}

function normalizeNarrativeInsightsPayload(parsedPayload) {
  if (!parsedPayload) return [];

  let candidates = [];
  if (Array.isArray(parsedPayload)) {
    candidates = parsedPayload;
  } else if (Array.isArray(parsedPayload?.insights)) {
    candidates = parsedPayload.insights;
  } else if (Array.isArray(parsedPayload?.opportunities)) {
    candidates = parsedPayload.opportunities;
  } else if (typeof parsedPayload === "object") {
    candidates = [parsedPayload];
  }

  return candidates
    .map((item) => {
      const opportunityId = Number(
        item?.opportunityId ?? item?.opportunity_id ?? item?.id,
      );
      if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
        return null;
      }

      const statusSummary = String(
        item?.aiStatusSummary ??
          item?.statusSummary ??
          item?.summary ??
          item?.status ??
          "",
      ).trim();
      const nextStepRecommendation = String(
        item?.aiNextStepRecommendation ??
          item?.nextStepRecommendation ??
          item?.nextStep ??
          item?.recommendation ??
          "",
      ).trim();
      const recommendedAction = normalizeNarrativeRecommendedAction(
        item?.aiRecommendedAction ??
          item?.recommendedAction ??
          item?.actionRecommendation ??
          null,
      );
      const aiContract = normalizeNarrativeContract(
        item?.aiContract ?? item?.contract ?? null,
      );
      const normalizedRecommendation =
        nextStepRecommendation ||
        aiContract?.nextBestStepText ||
        formatNarrativeRecommendedActionText(recommendedAction);

      const normalizedStatusSummary =
        statusSummary || aiContract?.descriptionSituationText || "";

      if (
        !normalizedStatusSummary &&
        !normalizedRecommendation &&
        !aiContract
      ) {
        return null;
      }

      return {
        opportunityId,
        aiStatusSummary: normalizedStatusSummary,
        aiNextStepRecommendation: normalizedRecommendation,
        aiRecommendedAction: recommendedAction,
        aiContract,
      };
    })
    .filter(Boolean);
}

function deriveSingleNarrativeFromText(outputText, opportunityId) {
  const safeOpportunityId = Number(opportunityId || 0);
  if (!Number.isInteger(safeOpportunityId) || safeOpportunityId <= 0) {
    return null;
  }

  const cleaned = String(outputText || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  if (!cleaned) return null;

  const lines = cleaned
    .split(/\r?\n/)
    .map((line) => String(line || "").trim())
    .filter(Boolean);

  const textWithoutLabels = cleaned
    .replace(/(?:aiStatusSummary|statusSummary|resumen|estado)\s*[:=]/gi, "")
    .replace(
      /(?:aiNextStepRecommendation|nextStepRecommendation|siguiente\s*paso|recomendacion)\s*[:=]/gi,
      "",
    )
    .trim();

  const sentenceParts = textWithoutLabels
    .split(/(?<=[.!?])\s+/)
    .map((part) => String(part || "").trim())
    .filter(Boolean);

  const statusSummary = String(lines[0] || sentenceParts[0] || "").trim();
  const nextStepRecommendation = String(
    lines[1] || sentenceParts[1] || lines[0] || "",
  ).trim();

  if (!statusSummary && !nextStepRecommendation) {
    return null;
  }

  return {
    opportunityId: safeOpportunityId,
    aiStatusSummary: statusSummary,
    aiNextStepRecommendation: nextStepRecommendation,
  };
}

function truncateText(value, maxLength = 280) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function toNarrativeAnswer(value) {
  return truncateText(value, AI_NARRATIVE_MAX_ANSWER_CHARS);
}

function normalizeNarrativeContract(contract, fallback = null) {
  const source = contract && typeof contract === "object" ? contract : {};
  const fallbackSource =
    fallback && typeof fallback === "object" ? fallback : {};

  const normalized = {
    descriptionSituationText: toNarrativeAnswer(
      source?.descriptionSituationText ||
        fallbackSource?.descriptionSituationText ||
        source?.descriptionSituation ||
        source?.descriptionSituationText ||
        source?.commercialSituation ||
        source?.aiStatusSummary ||
        "",
    ),
    salesStrategyText: toNarrativeAnswer(
      source?.salesStrategyText ||
        fallbackSource?.salesStrategyText ||
        source?.salesStrategy ||
        source?.strategyToWin ||
        "",
    ),
    nextBestStepText: toNarrativeAnswer(
      source?.nextBestStepText ||
        fallbackSource?.nextBestStepText ||
        source?.nextBestStep ||
        source?.exactStep ||
        source?.aiNextStepRecommendation ||
        "",
    ),
    alternativeStepText: toNarrativeAnswer(
      source?.alternativeStepText ||
        fallbackSource?.alternativeStepText ||
        source?.alternativeStep ||
        source?.fallbackStep ||
        "",
    ),
  };

  const hasAnyValue = Object.values(normalized).some((value) =>
    Boolean(String(value || "").trim()),
  );

  return hasAnyValue
    ? {
        ...normalized,
        constraints: {
          maxCharsPerAnswer: AI_NARRATIVE_MAX_ANSWER_CHARS,
        },
      }
    : null;
}

function normalizeNarrativeRecommendedAction(action) {
  if (!action || typeof action !== "object") return null;

  const normalized = {
    action: String(action.action || action.what || "").trim(),
    ownerTarget: String(action.ownerTarget || action.who || "").trim(),
    dueWindow: String(action.dueWindow || action.when || "").trim(),
    evidenceExpected: String(
      action.evidenceExpected || action.expectedEvidence || "",
    ).trim(),
    messageDraft: String(action.messageDraft || action.script || "").trim(),
  };

  return Object.values(normalized).some(Boolean) ? normalized : null;
}

function formatNarrativeRecommendedActionText(action) {
  if (!action || typeof action !== "object") return "";

  const parts = [
    action.action ? `Accion: ${action.action}.` : "",
    action.ownerTarget ? `Con: ${action.ownerTarget}.` : "",
    action.dueWindow ? `Cuando: ${action.dueWindow}.` : "",
    action.evidenceExpected
      ? `Evidencia esperada: ${action.evidenceExpected}.`
      : "",
  ].filter(Boolean);

  const base = parts.join(" ").trim();
  if (!base) {
    return action.messageDraft || "";
  }

  return action.messageDraft
    ? `${base} Mensaje sugerido: ${action.messageDraft}`
    : base;
}

function buildFallbackRecommendedAction(item) {
  const nextStep = item?.nextStep || null;
  const primaryRisk =
    Array.isArray(item?.riskReasons) && item.riskReasons.length
      ? String(item.riskReasons[0] || "").trim()
      : "";
  const dueWindow = nextStep?.dueDate
    ? `Antes del ${nextStep.dueDate}`
    : item?.daysSinceActivity > item?.slaDays
      ? "En las proximas 24 horas"
      : "En los proximos 2 dias habiles";

  return normalizeNarrativeRecommendedAction({
    action:
      nextStep?.title ||
      "Asegurar un siguiente paso concreto con el cliente y criterio de avance",
    ownerTarget: nextStep?.ownerUserName || "sponsor y decisor de compra",
    dueWindow,
    evidenceExpected:
      nextStep?.successCriteria ||
      "Compromiso de fecha, responsable cliente y condicion de decision",
    messageDraft: primaryRisk
      ? `Detectamos ${primaryRisk.toLowerCase()}. Propongo acordar hoy un siguiente paso con fecha y responsables para no perder traccion.`
      : "Propongo cerrar hoy un siguiente paso con fecha, responsables y criterio de exito para mantener el avance comercial.",
  });
}

function buildFallbackNarrativeContract(item, recommendedAction) {
  const stageLabel = item?.stageName || "Sin etapa";
  const customerNeed =
    Array.isArray(item?.riskReasons) && item.riskReasons.length
      ? `Resolver ${String(item.riskReasons[0] || "").toLowerCase()} para habilitar la compra.`
      : "Confirmar necesidad prioritaria y criterio de decision del cliente.";
  const timeline = item?.closeDate
    ? `Objetivo comercial: ${toIsoDate(item.closeDate) || "sin fecha valida"}.`
    : "No hay fecha de cierre confirmada en CRM.";
  const actionsTaken = (item?.lastMilestones || [])
    .slice(0, 3)
    .map((milestone) => String(milestone?.title || "").trim())
    .filter(Boolean)
    .join("; ");
  const recentDocuments = (item?.documentHighlights || [])
    .slice(0, 3)
    .map((document) => String(document?.fileName || "").trim())
    .filter(Boolean)
    .join("; ");
  const stageAnswerEvidence = (item?.stageAnswers || [])
    .filter((answer) => String(answer?.answerValue || "").trim())
    .slice(0, 4)
    .map(
      (answer) =>
        `${String(answer?.questionPrompt || answer?.questionCode || "").trim()}: ${String(answer?.answerValue || "").trim()}`,
    )
    .filter(Boolean)
    .join("; ");
  const quotationEvidence = (item?.quotationSignals || [])
    .slice(0, 3)
    .map((quotation) => {
      const proposalName = String(quotation?.proposalName || "").trim();
      const statusName = String(quotation?.statusName || "").trim();
      if (!proposalName && !statusName) return "";
      return `${proposalName || "Cotizacion"}${statusName ? ` (${statusName})` : ""}`;
    })
    .filter(Boolean)
    .join("; ");
  const contactEvidence = (item?.accountContacts || [])
    .slice(0, 3)
    .map((contact) => {
      const fullName = String(contact?.fullName || "").trim();
      const positionTitle = String(contact?.positionTitle || "").trim();
      if (!fullName && !positionTitle) return "";
      return `${fullName || "Contacto"}${positionTitle ? ` (${positionTitle})` : ""}`;
    })
    .filter(Boolean)
    .join("; ");
  const openDependencies = (item?.dependencyExecution || [])
    .slice(0, 3)
    .map((dependency) => String(dependency?.title || "").trim())
    .filter(Boolean)
    .join("; ");
  const recommendedSteps = (item?.recommendedStrategySteps || [])
    .slice(0, 3)
    .map((step) => String(step?.text || step?.title || "").trim())
    .filter(Boolean)
    .join("; ");

  return normalizeNarrativeContract({
    descriptionSituationText: `La oportunidad se encuentra en la etapa ${stageLabel} y hoy el cliente parece buscar una solucion que le permita avanzar en su necesidad prioritaria. ${customerNeed} ${item?.executionState?.summary || "Comercialmente la oportunidad sigue abierta, pero necesita mayor claridad de decisor, urgencia y condicion de avance."} ${timeline} ${actionsTaken ? `Hasta ahora el equipo comercial ha trabajado en los siguientes hitos: ${actionsTaken}.` : "Hasta ahora la evidencia comercial registrada sigue siendo parcial y debe consolidarse mejor para sostener una venta consultiva."} ${recentDocuments ? `En documentacion reciente destacan: ${recentDocuments}.` : "No hay suficiente documentacion reciente para reforzar la narrativa comercial."} ${stageAnswerEvidence ? `Las respuestas de etapa muestran esta evidencia relevante: ${stageAnswerEvidence}.` : "Las respuestas de etapa no aportan aun suficiente contexto estructurado."} ${quotationEvidence ? `En cotizaciones existe la siguiente señal de avance: ${quotationEvidence}.` : "No hay una señal fuerte de cotizacion que ayude a ordenar la conversacion de cierre."} ${contactEvidence ? `Los contactos relacionados son: ${contactEvidence}.` : "Aun falta consolidar claramente los contactos que influyen en la decision."}`,
    salesStrategyText: `${item?.recommendedHeading || "La estrategia comercial debe ayudar al vendedor a transformar interes en una decision concreta del cliente."} ${item?.recommendedRoute || "Para lograrlo, debe seguir la disciplina de la etapa actual y conectar cada accion con una evidencia comercial verificable en CRM."} ${recommendedSteps ? `La secuencia recomendada es: ${recommendedSteps}.` : "La secuencia recomendada debe comenzar por validar necesidad, decisor, prioridad de compra y siguiente hito con fecha."} ${item?.recommendedFinalObjective || "Cada accion debe producir un resultado visible: aclarar que busca el cliente, por que lo necesita, quien decide, bajo que criterio compraria y cuando puede ejecutar o comprar la solucion."} ${openDependencies ? `Ademas, hay dependencias que no pueden ignorarse: ${openDependencies}. La estrategia del vendedor debe destrabarlas o gestionarlas en paralelo para que no bloqueen el avance comercial.` : "No hay dependencias abiertas dominantes, por lo que el foco debe ponerse en calidad de conversacion comercial y compromiso del cliente."} ${Array.isArray(item?.riskReasons) && item.riskReasons.length ? `El principal riesgo hoy es ${item.riskReasons[0].toLowerCase()}; por eso la estrategia no debe ser solo de seguimiento, sino de conduccion activa con resultados concretos por accion.` : "El mayor riesgo es caer en seguimiento pasivo; la estrategia debe mantener conduccion activa y resultados concretos por accion."}`,
    nextBestStepText: `${recommendedAction?.action || "El siguiente paso debe ser una accion concreta con el cliente."} ${recommendedAction?.dueWindow ? `Debe ejecutarse ${recommendedAction.dueWindow.toLowerCase()} y no dejarse como un seguimiento abierto.` : "Debe ejecutarse de inmediato y no dejarse como un seguimiento abierto."} ${recommendedAction?.evidenceExpected || "El resultado esperado debe ser evidencia verificable de avance y decision."} Este paso es el mas adecuado porque ayuda a convertir la situacion actual en una definicion operativa: quien decide, que valida el cliente, cual es el criterio de compra y cual es la fecha del siguiente hito. El vendedor debe salir de esta accion con un compromiso concreto, una respuesta observable del cliente y registro suficiente en CRM para sostener el siguiente movimiento comercial.`,
    alternativeStepText:
      "Si el mejor paso no puede ejecutarse o el cliente no responde en el plazo previsto, debe activarse una alternativa de rescate comercial. Esa alternativa consiste en escalar con un resumen ejecutivo que recuerde el valor de la solucion, el riesgo de no decidir, el estado actual de la oportunidad y una fecha alternativa de decision o revision. El objetivo del paso alternativo no es solo insistir, sino recuperar traccion, provocar una definicion del cliente y evitar que la oportunidad quede en seguimiento difuso. El vendedor debe usar este paso para obtener una respuesta formal, redefinir alcance si hace falta y decidir rapidamente si conviene retomar el plan principal o replantear la estrategia comercial.",
  });
}

function buildOpportunityNarrativeFallback(item) {
  const stageLabel = item.stageName || "Sin etapa";
  const executionSummary =
    item.executionState?.summary || "Sin lectura operativa disponible.";
  const closeDateLabel = item.closeDate
    ? `Cierre objetivo ${toIsoDate(item.closeDate) || "sin fecha"}.`
    : "Sin fecha de cierre confirmada.";
  const topRisk =
    Array.isArray(item.riskReasons) && item.riskReasons.length
      ? `Señal principal: ${item.riskReasons[0]}.`
      : "No hay una señal crítica dominante documentada.";

  let statusSummary = `Etapa ${stageLabel}. ${executionSummary} ${topRisk} ${closeDateLabel}`;
  if (item.executionState?.code === "esperando_cliente") {
    statusSummary = `Etapa ${stageLabel}. La oportunidad depende de una respuesta o decisión del cliente y conviene evitar que se enfríe. ${topRisk}`;
  } else if (item.executionState?.code === "esperando_interno") {
    statusSummary = `Etapa ${stageLabel}. El avance depende de destrabar un compromiso interno antes de volver a empujar al cliente. ${topRisk}`;
  } else if (item.executionState?.code === "sin_conduccion") {
    statusSummary = `Etapa ${stageLabel}. La oportunidad sigue abierta, pero hoy no tiene conducción operativa visible ni compromiso vigente. ${topRisk}`;
  }

  const nextStepRecommendation = item.recommendedNextMove
    ? getRecommendedNextMove(item.recommendedNextMove)
    : buildDevelopmentRecommendation(item);
  const recommendedAction = buildFallbackRecommendedAction(item);
  const aiContract = buildFallbackNarrativeContract(item, recommendedAction);

  const blockedScorecards = (item.scorecardItems || [])
    .filter((scorecardItem) => scorecardItem?.tone === "red")
    .map((scorecardItem) => scorecardItem?.label)
    .filter(Boolean);
  if (blockedScorecards.length) {
    statusSummary = `${statusSummary} Frente comercial más débil: ${blockedScorecards
      .slice(0, 2)
      .join(" y ")}.`;
  }

  return {
    aiStatusSummary: statusSummary.trim(),
    aiNextStepRecommendation: String(
      nextStepRecommendation ||
        formatNarrativeRecommendedActionText(recommendedAction),
    ).trim(),
    aiRecommendedAction: recommendedAction,
    aiContract,
    aiNarrativeSource: "fallback",
  };
}

async function requestOpportunityNarrativesWithAi(
  items,
  { aiUsageContext = null } = {},
) {
  if (!config.openai.apiKey || !items.length) {
    return new Map();
  }

  const aiUsageUserId = Number(aiUsageContext?.userId || 0);
  if (aiUsageUserId) {
    await assertAiBudgetAvailable({ userId: aiUsageUserId });
  }

  const payload = {
    model: config.openai.model,
    input: [
      {
        role: "system",
        content:
          "Analiza oportunidades comerciales CRM y responde solo con JSON valido. No inventes datos ni hechos no presentes en la entrada. Debes producir por oportunidad exactamente 4 textos narrativos dentro de aiContract: descriptionSituationText, salesStrategyText, nextBestStepText y alternativeStepText. Cada texto debe ser un solo parrafo corrido, sin bullets ni subtitulos internos, y con maximo 1500 caracteres. Debes escribirlos como una explicacion util para un vendedor comercial: clara, detallada, concreta, orientada a accion y basada en evidencia. No seas telegráfico. Explica el contexto, la logica comercial y el por que de cada recomendacion. Debes usar toda la evidencia entregada: documentacion de oportunidad, acciones, actividades, dependencias, respuestas a preguntas de etapa, cotizaciones, cuenta, contactos y estado de etapa. Razona segun proceso B2B: contacto inicial, identificacion de oportunidad, desarrollo, cotizacion, demostracion, negociacion y waiting. Si falta informacion, indicalo de forma explicita dentro del texto correspondiente. En salesStrategyText y nextBestStepText describe resultados concretos que el vendedor debe obtener. En alternativeStepText explica cuando usarlo y que decision o respuesta debe buscar. Ademas entrega un resumen corto en aiStatusSummary y aiNextStepRecommendation consistente con aiContract, y una aiRecommendedAction ejecutable.",
      },
      {
        role: "user",
        content: JSON.stringify({
          opportunities: items.map((item) => ({
            opportunityId: item.id,
            name: truncateText(item.name, 120),
            accountName: truncateText(item.accountName, 120),
            amountUsd: Number(item.amountUsd || 0),
            stageName: item.stageName,
            stageCode: item.stageCode,
            executionState: item.executionState,
            riskLevel: item.riskLevel,
            riskReasons: Array.isArray(item.riskReasons)
              ? item.riskReasons
                  .slice(0, 5)
                  .map((reason) => truncateText(reason, 180))
              : [],
            daysSinceActivity: Number(item.daysSinceActivity || 0),
            slaDays: Number(item.slaDays || 0),
            currentStageValidated: Boolean(item.currentStageValidated),
            workspaceSummary:
              typeof item.workspaceSummary === "string"
                ? truncateText(item.workspaceSummary, 900)
                : null,
            scorecardOverallTone: item.scorecardOverallTone || "neutral",
            scorecardItems: (item.scorecardItems || [])
              .slice(0, 6)
              .map((scorecardItem) => ({
                label: truncateText(scorecardItem.label, 80),
                tone: scorecardItem.tone,
                statusLabel: truncateText(scorecardItem.statusLabel, 80),
                summary: truncateText(scorecardItem.summary, 180),
              })),
            openWeaknesses: (item.openWeaknesses || [])
              .slice(0, 10)
              .map((weakness) => ({
                title: truncateText(weakness.title, 120),
                severity: weakness.severity,
                detail: truncateText(weakness.detail, 220),
              })),
            nextStep: item.nextStep
              ? {
                  title: truncateText(item.nextStep.title, 120),
                  actionType: item.nextStep.actionType || "",
                  dueDate: item.nextStep.dueDate || null,
                  isOverdue: Boolean(item.nextStep.isOverdue),
                  ownerUserName: truncateText(item.nextStep.ownerUserName, 80),
                  successCriteria: truncateText(
                    item.nextStep.successCriteria,
                    220,
                  ),
                }
              : null,
            nextStepQuality: item.nextStepQuality
              ? {
                  score: Number(item.nextStepQuality.score || 0),
                  label: item.nextStepQuality.label || "",
                  signals: Array.isArray(item.nextStepQuality.signals)
                    ? item.nextStepQuality.signals
                        .slice(0, 4)
                        .map((signal) => truncateText(signal, 120))
                    : [],
                  gaps: Array.isArray(item.nextStepQuality.gaps)
                    ? item.nextStepQuality.gaps
                        .slice(0, 4)
                        .map((gap) => truncateText(gap, 140))
                    : [],
                }
              : null,
            dependencies: (item.dependencies || [])
              .slice(0, 12)
              .map((dependency) => ({
                title: truncateText(dependency.title, 120),
                dependencyLabel: truncateText(dependency.dependencyLabel, 80),
                status: dependency.status,
                isOverdue: Boolean(dependency.isOverdue),
              })),
            dependencyExecution: (item.dependencyExecution || [])
              .slice(0, 12)
              .map((dependency) => ({
                title: truncateText(dependency.title, 120),
                dependencyLabel: truncateText(dependency.dependencyLabel, 80),
                status: dependency.status,
                ownerUserName: truncateText(dependency.ownerUserName, 80),
                dueDate: dependency.dueDate || null,
                isOverdue: Boolean(dependency.isOverdue),
                expectedOutcome: truncateText(dependency.expectedOutcome, 180),
              })),
            lastMilestones: (item.lastMilestones || [])
              .slice(0, 10)
              .map((milestone) => ({
                type: milestone.type || "",
                title: truncateText(milestone.title, 120),
                status: milestone.status || "",
                happenedAt: milestone.happenedAt || null,
                summary: truncateText(milestone.summary, 180),
              })),
            recentActivities: (item.recentActivities || [])
              .slice(0, 12)
              .map((activity) => ({
                title: truncateText(activity.title, 140),
                actionType: activity.actionType || "",
                status: activity.status || "",
                happenedAt:
                  activity.happenedAt ||
                  activity.scheduledAt ||
                  activity.updatedAt ||
                  activity.createdAt ||
                  null,
                summary: truncateText(
                  activity.summary || activity.note || "",
                  220,
                ),
              })),
            recentTimeline: (item.recentTimeline || [])
              .slice(0, 15)
              .map((timelineItem) => ({
                entryKind: timelineItem.entryKind || "",
                title: truncateText(timelineItem.title, 140),
                actionType: timelineItem.actionType || "",
                status: timelineItem.status || "",
                happenedAt:
                  timelineItem.happenedAt ||
                  timelineItem.scheduledAt ||
                  timelineItem.updatedAt ||
                  timelineItem.createdAt ||
                  null,
              })),
            stageAnswers: (item.stageAnswers || [])
              .slice(0, 20)
              .map((answer) => ({
                salesStageName: truncateText(answer.salesStageName, 80),
                questionCode: truncateText(answer.questionCode, 80),
                questionPrompt: truncateText(answer.questionPrompt, 220),
                answerValue: truncateText(answer.answerValue, 320),
                isRequired: Boolean(answer.isRequired),
                answeredAt: answer.answeredAt || null,
              })),
            activityCount: Number(item.activityCount || 0),
            actionCount: Number(item.actionCount || 0),
            decisionStageGap: item.decisionStageGap
              ? {
                  primaryGap: truncateText(
                    item.decisionStageGap.primaryGap,
                    80,
                  ),
                  secondaryGaps: Array.isArray(
                    item.decisionStageGap.secondaryGaps,
                  )
                    ? item.decisionStageGap.secondaryGaps
                        .slice(0, 3)
                        .map((gap) => truncateText(gap, 80))
                    : [],
                  guidance: truncateText(item.decisionStageGap.guidance, 180),
                }
              : null,
            documentActivity: item.documentActivity
              ? {
                  lastDocumentAt: item.documentActivity.lastDocumentAt || null,
                  documentCount: Number(
                    item.documentActivity.documentCount || 0,
                  ),
                  docsLast7d: Number(item.documentActivity.docsLast7d || 0),
                }
              : null,
            documentReadiness: item.documentReadiness
              ? {
                  reviewReady: Number(item.documentReadiness.reviewReady || 0),
                  processing: Number(item.documentReadiness.processing || 0),
                  failed: Number(item.documentReadiness.failed || 0),
                }
              : null,
            documentHighlights: (item.documentHighlights || [])
              .slice(0, 10)
              .map((document) => ({
                fileName: truncateText(document.fileName, 120),
                createdAt: document.createdAt || null,
                processingStatus: String(
                  document.processingStatus || "",
                ).trim(),
                summary: truncateText(document.summary, 220),
              })),
            accountContacts: (item.accountContacts || [])
              .slice(0, 12)
              .map((contact) => ({
                fullName: truncateText(contact.fullName, 100),
                positionTitle: truncateText(contact.positionTitle, 100),
                email: truncateText(contact.email, 120),
              })),
            quotationSignals: (item.quotationSignals || [])
              .slice(0, 12)
              .map((quotation) => ({
                proposalName: truncateText(quotation.proposalName, 140),
                statusName: truncateText(quotation.statusName, 80),
                quotationDate: quotation.quotationDate || null,
                versionNumber: Number(quotation.versionNumber || 0),
              })),
            closeDate: item.closeDate || null,
            recommendedHeading: truncateText(item.recommendedHeading, 160),
            recommendedRoute: truncateText(item.recommendedRoute, 160),
            recommendedFinalObjective: truncateText(
              item.recommendedFinalObjective,
              180,
            ),
            recommendedStrategySteps: (item.recommendedStrategySteps || [])
              .slice(0, 5)
              .map((step) => ({
                priorityLabel: truncateText(step.priorityLabel, 40),
                title: truncateText(step.title, 120),
                text: truncateText(step.text, 220),
              })),
            recommendedNextMove: getRecommendedNextMove(
              item.recommendedNextMove,
            ),
            fallback: buildOpportunityNarrativeFallback(item),
          })),
          expectedShape: {
            insights: [
              {
                opportunityId: 0,
                aiStatusSummary: "string",
                aiNextStepRecommendation: "string",
                aiContract: {
                  descriptionSituationText: "string (max 1500)",
                  salesStrategyText: "string (max 1500)",
                  nextBestStepText: "string (max 1500)",
                  alternativeStepText: "string (max 1500)",
                },
                aiRecommendedAction: {
                  action: "string",
                  ownerTarget: "string",
                  dueWindow: "string",
                  evidenceExpected: "string",
                  messageDraft: "string",
                },
              },
            ],
          },
        }),
      },
    ],
  };

  const response = await fetch(
    `${config.openai.baseUrl.replace(/\/$/, "")}/responses`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openai.apiKey}`,
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();

  if (aiUsageUserId) {
    await recordAiUsageFromOpenAiResponse({
      internalRequestId:
        aiUsageContext?.internalRequestId ||
        `cn_${Date.now().toString(36)}_${randomUUID().replace(/-/g, "").slice(0, 10)}`,
      userId: aiUsageUserId,
      featureCode:
        aiUsageContext?.featureCode ||
        "commercial_development.opportunity_narrative",
      model: config.openai.model,
      openAiResponse: data,
      jobType: aiUsageContext?.jobType || "commercial_narrative",
      jobId: aiUsageContext?.jobId || null,
      startedAt: aiUsageContext?.startedAt || null,
    });
  }

  const responseOutputText = extractResponseOutputText(data);
  const parsed = extractJsonValue(responseOutputText);
  const insights = normalizeNarrativeInsightsPayload(parsed);
  if (
    items.length === 1 &&
    insights.length > 0 &&
    !insights.some(
      (insight) => Number(insight.opportunityId) === Number(items[0]?.id),
    )
  ) {
    insights[0].opportunityId = Number(items[0]?.id || 0);
  }
  if (!insights.length && items.length === 1) {
    const derivedInsight = deriveSingleNarrativeFromText(
      responseOutputText,
      items[0]?.id,
    );
    if (derivedInsight) {
      insights.push(derivedInsight);
    }
  }

  if (!insights.length) {
    throw new Error(
      "OpenAI narrative response did not include parseable insights",
    );
  }

  const itemByOpportunityId = new Map(
    items
      .map((item) => [Number(item?.id || 0), item])
      .filter(
        ([opportunityId]) =>
          Number.isInteger(opportunityId) && opportunityId > 0,
      ),
  );

  return new Map(
    insights
      .map((item) => {
        const opportunityId = Number(item.opportunityId);
        const strengthenedNarrative = strengthenNarrativeWithEvidence(
          itemByOpportunityId.get(opportunityId),
          {
            aiStatusSummary: String(item.aiStatusSummary || "").trim(),
            aiNextStepRecommendation: String(
              item.aiNextStepRecommendation || "",
            ).trim(),
            aiRecommendedAction: item.aiRecommendedAction || null,
            aiContract: item.aiContract || null,
            aiNarrativeSource: "openai",
          },
        );

        return [opportunityId, strengthenedNarrative];
      })
      .filter(
        ([opportunityId]) =>
          Number.isInteger(opportunityId) && opportunityId > 0,
      ),
  );
}

async function enrichOpportunityNarratives(items) {
  const withFallback = items.map((item) => ({
    ...item,
    ...buildOpportunityNarrativeFallback(item),
  }));

  if (!config.openai.apiKey || !withFallback.length) {
    return withFallback;
  }

  try {
    const aiInsights = await requestOpportunityNarrativesWithAi(withFallback);
    return withFallback.map((item) => {
      const aiInsight = aiInsights.get(item.id);
      if (!aiInsight) return item;
      return {
        ...item,
        aiStatusSummary: aiInsight.aiStatusSummary || item.aiStatusSummary,
        aiNextStepRecommendation:
          aiInsight.aiNextStepRecommendation || item.aiNextStepRecommendation,
        aiRecommendedAction:
          aiInsight.aiRecommendedAction || item.aiRecommendedAction || null,
        aiContract: aiInsight.aiContract || item.aiContract || null,
        aiNarrativeSource: aiInsight.aiNarrativeSource,
      };
    });
  } catch {
    return withFallback;
  }
}

async function buildExecutionNarrativeItem({ user, opportunity }) {
  const opportunityId = Number(opportunity?.id || 0);
  if (!opportunityId) {
    return null;
  }

  const opportunityState = {
    ...opportunity,
    salesStageId: Number(
      opportunity?.sales_stage_id || opportunity?.salesStageId || 0,
    ),
  };
  const stagesCatalog = await listActiveSalesStages();
  const stageView = buildStageView(stagesCatalog, opportunityState);
  const workspace = await buildOpportunityWorkspace({
    opportunityState,
    stageView,
    documents: [],
  });
  const dependencyRows = await listOpenDependencies([opportunityId]);
  const dependencies = dependencyRows.map((row) => mapDependencyRow(row));
  const lastActivityByOpportunity = await listLastActivityByOpportunity([
    opportunityId,
  ]);
  const nextStep = selectPrimaryNextStep(
    workspace.actions || [],
    opportunityState.salesStageId,
  );
  const mappedNextStep = mapNextStep(nextStep);
  const activitySummary = buildCommercialActivitySummary(
    workspace.actions || [],
  );
  const [
    documentSignals,
    quotationVersions,
    accountContactsByAccountId,
    stageAnswers,
  ] = await Promise.all([
    listOpportunityDocumentSignals(opportunityId),
    listCommercialQuotationVersionsForEmail({ opportunityId }).catch(() => []),
    listContactsByAccountIds([Number(opportunity?.account_id || 0)]).catch(
      () => new Map(),
    ),
    listNarrativeStageAnswers({
      opportunityId,
      salesStageId: Number(opportunity?.sales_stage_id || 0),
    }).catch(() => []),
  ]);
  const accountContacts = (
    accountContactsByAccountId.get(Number(opportunity?.account_id || 0)) || []
  )
    .slice(0, 12)
    .map((contact) => ({
      id: Number(contact.id || 0),
      fullName: String(contact.fullName || "").trim(),
      positionTitle: String(contact.positionTitle || "").trim(),
      email: String(contact.email || "").trim(),
    }));
  const quotationSignals = (
    Array.isArray(quotationVersions) ? quotationVersions : []
  )
    .slice(0, 12)
    .map((quotationVersion) => ({
      quotationId: Number(quotationVersion.quotationId || 0),
      quotationVersionId: Number(quotationVersion.quotationVersionId || 0),
      proposalName: String(quotationVersion.proposalName || "").trim(),
      statusName: String(quotationVersion.statusName || "").trim(),
      quotationDate: quotationVersion.quotationDate || null,
      versionNumber: Number(quotationVersion.versionNumber || 0),
    }));
  const lastActivityAt =
    lastActivityByOpportunity.get(opportunityId) ||
    (opportunity?.updated_at ? new Date(opportunity.updated_at) : null) ||
    new Date();
  const daysSinceActivity = getDiffDays(lastActivityAt);
  const stageSlaMap = await loadStageSlaMap();
  const slaDays = stageSlaMap[opportunity?.sales_stage_code] || 5;
  const risk = buildRiskSummary({
    workspace,
    nextStep: mappedNextStep,
    dependencies,
    daysSinceActivity,
    slaDays,
  });
  const nextStepQuality = buildNextStepQualitySummary({
    nextStep: mappedNextStep,
    dependencies,
    daysSinceActivity,
    slaDays,
  });
  const decisionStageGap = inferDecisionStageGap({
    scorecardItems: workspace.scorecard?.items || [],
    riskReasons: risk.reasons,
    dependencies,
  });
  const lastMilestones = buildNarrativeMilestones({
    activitySummary,
    dependencies,
    nextStep: mappedNextStep,
  });
  const executionState = deriveExecutionState({
    nextStep: mappedNextStep,
    dependencies,
    risk,
    daysSinceActivity,
    slaDays,
  });

  return {
    id: opportunityId,
    name: opportunity?.name || "",
    accountName: opportunity?.account_name || "",
    amountUsd: Number(opportunity?.amount_usd || 0),
    closeDate: opportunity?.close_date || null,
    stageId: Number(opportunity?.sales_stage_id || 0),
    stageCode: opportunity?.sales_stage_code || "",
    stageName: opportunity?.sales_stage_name || "",
    sellerUserId:
      opportunity?.seller_user_id === null ||
      opportunity?.seller_user_id === undefined
        ? null
        : Number(opportunity.seller_user_id),
    sellerUserName: opportunity?.seller_user_name || "Sin vendedor",
    lastActivityAt,
    daysSinceActivity,
    slaDays,
    currentStageValidated: Boolean(workspace.currentStage?.isValidated),
    workspaceSummary: workspace.summary || null,
    scorecardOverallTone: workspace.scorecard?.overallTone || "neutral",
    scorecardItems: (workspace.scorecard?.items || []).map((scorecardItem) => ({
      label: scorecardItem.label,
      tone: scorecardItem.tone,
      statusLabel: scorecardItem.statusLabel,
      summary: scorecardItem.summary,
    })),
    openWeaknesses: (workspace.weaknesses || [])
      .filter((weakness) => weakness.status === "open")
      .slice(0, 3)
      .map((weakness) => ({
        title: weakness.title,
        severity: weakness.severity,
        detail: weakness.detail || "",
      })),
    recommendedHeading: workspace.recommendedStrategy?.heading || "",
    recommendedRoute: workspace.recommendedStrategy?.route || "",
    recommendedFinalObjective:
      workspace.recommendedStrategy?.finalObjective || "",
    recommendedStrategySteps: (
      workspace.recommendedStrategy?.steps || []
    ).slice(0, 3),
    recommendedNextMove: workspace.recommendedStrategy?.steps?.[0] || "",
    riskLevel: risk.level,
    riskReasons: risk.reasons,
    executionState,
    dependencies,
    dependencyExecution: dependencies,
    nextStepQuality,
    decisionStageGap,
    lastMilestones,
    documentActivity: {
      lastDocumentAt: documentSignals.lastDocumentAt,
      documentCount: Number(documentSignals.documentCount || 0),
      docsLast7d: Number(documentSignals.docsLast7d || 0),
    },
    documentReadiness: {
      reviewReady: Number(
        documentSignals.processingStatusCounts.reviewReady || 0,
      ),
      processing: Number(
        documentSignals.processingStatusCounts.processing || 0,
      ),
      failed: Number(documentSignals.processingStatusCounts.failed || 0),
    },
    documentHighlights: Array.isArray(documentSignals.highlights)
      ? documentSignals.highlights
      : [],
    decisionRiskTone:
      workspace.scorecard?.signals?.decisionRisk?.tone || "neutral",
    nextStep: mappedNextStep,
    nextScheduledActivity: activitySummary.nextScheduledActivity,
    nextPendingAction: activitySummary.nextPendingAction,
    lastCompletedActivity: activitySummary.lastCompletedActivity,
    recentActivities: activitySummary.recentActivities,
    recentTimeline: activitySummary.recentTimeline,
    activityCount: activitySummary.activityCount,
    actionCount: activitySummary.actionCount,
    accountContacts,
    quotationSignals,
    stageAnswers: (Array.isArray(stageAnswers) ? stageAnswers : []).map(
      (answer) => ({
        ...answer,
        salesStageName: opportunity?.sales_stage_name || "",
      }),
    ),
  };
}

function buildCommercialNarrativeJobPublicId() {
  return `opp_narrative_${randomUUID().replace(/-/g, "")}`;
}

function parseCommercialNarrativeJson(value, fallback) {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

function buildCommercialNarrativeSnapshot(item) {
  return {
    id: Number(item?.id || 0),
    name: String(item?.name || ""),
    accountName: String(item?.accountName || ""),
    amountUsd: Number(item?.amountUsd || 0),
    closeDate: item?.closeDate || null,
    stageId: Number(item?.stageId || 0),
    stageCode: String(item?.stageCode || ""),
    stageName: String(item?.stageName || ""),
    daysSinceActivity: Number(item?.daysSinceActivity || 0),
    slaDays: Number(item?.slaDays || 0),
    currentStageValidated: Boolean(item?.currentStageValidated),
    workspaceSummary: item?.workspaceSummary || null,
    scorecardOverallTone: String(item?.scorecardOverallTone || "neutral"),
    scorecardItems: Array.isArray(item?.scorecardItems)
      ? item.scorecardItems
      : [],
    openWeaknesses: Array.isArray(item?.openWeaknesses)
      ? item.openWeaknesses
      : [],
    recommendedHeading: String(item?.recommendedHeading || ""),
    recommendedRoute: String(item?.recommendedRoute || ""),
    recommendedFinalObjective: String(item?.recommendedFinalObjective || ""),
    recommendedStrategySteps: Array.isArray(item?.recommendedStrategySteps)
      ? item.recommendedStrategySteps
      : [],
    recommendedNextMove: item?.recommendedNextMove || "",
    riskLevel: String(item?.riskLevel || "low"),
    riskReasons: Array.isArray(item?.riskReasons) ? item.riskReasons : [],
    executionState: item?.executionState || null,
    dependencies: Array.isArray(item?.dependencies) ? item.dependencies : [],
    dependencyExecution: Array.isArray(item?.dependencyExecution)
      ? item.dependencyExecution
      : [],
    nextStepQuality:
      item?.nextStepQuality && typeof item.nextStepQuality === "object"
        ? item.nextStepQuality
        : null,
    decisionStageGap:
      item?.decisionStageGap && typeof item.decisionStageGap === "object"
        ? item.decisionStageGap
        : null,
    lastMilestones: Array.isArray(item?.lastMilestones)
      ? item.lastMilestones
      : [],
    documentActivity:
      item?.documentActivity && typeof item.documentActivity === "object"
        ? item.documentActivity
        : null,
    documentReadiness:
      item?.documentReadiness && typeof item.documentReadiness === "object"
        ? item.documentReadiness
        : null,
    documentHighlights: Array.isArray(item?.documentHighlights)
      ? item.documentHighlights
      : [],
    accountContacts: Array.isArray(item?.accountContacts)
      ? item.accountContacts
      : [],
    quotationSignals: Array.isArray(item?.quotationSignals)
      ? item.quotationSignals
      : [],
    stageAnswers: Array.isArray(item?.stageAnswers) ? item.stageAnswers : [],
    nextStep: item?.nextStep || null,
  };
}

function normalizeNarrativeComparisonText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function buildNarrativeDocumentAnchor(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const highlights = Array.isArray(item.documentHighlights)
    ? item.documentHighlights
    : [];
  const topDocument = highlights.find((document) =>
    String(document?.fileName || "").trim(),
  );
  if (!topDocument) {
    return null;
  }

  return {
    fileName: truncateText(topDocument.fileName, 96),
    createdAt: toIsoDate(topDocument.createdAt),
    summary: truncateText(topDocument.summary, 140),
  };
}

function textContainsNarrativeAnchor(text, anchor) {
  if (!anchor || !anchor.fileName) {
    return false;
  }

  const normalizedText = normalizeNarrativeComparisonText(text);
  if (!normalizedText) {
    return false;
  }

  const normalizedFileName = normalizeNarrativeComparisonText(anchor.fileName)
    .replace(/\.[a-z0-9]+$/i, "")
    .trim();
  const fileTokens = normalizedFileName
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4)
    .slice(0, 6);

  if (
    fileTokens.some((token) => normalizedText.includes(token)) ||
    /documento|archivo|propuesta|revision/.test(normalizedText)
  ) {
    return true;
  }

  if (anchor.createdAt && normalizedText.includes(anchor.createdAt)) {
    return true;
  }

  return false;
}

function strengthenNarrativeWithEvidence(item, narrative) {
  const baselineNarrative =
    narrative && typeof narrative === "object" ? narrative : {};
  const normalizedContract = normalizeNarrativeContract(
    baselineNarrative.aiContract,
  );

  if (!item || typeof item !== "object") {
    return {
      ...baselineNarrative,
      aiStatusSummary: String(
        baselineNarrative.aiStatusSummary ||
          normalizedContract?.descriptionSituationText ||
          "",
      ).trim(),
      aiNextStepRecommendation: String(
        baselineNarrative.aiNextStepRecommendation ||
          normalizedContract?.nextBestStepText ||
          "",
      ).trim(),
      aiRecommendedAction: normalizeNarrativeRecommendedAction(
        baselineNarrative.aiRecommendedAction,
      ),
      aiContract: normalizedContract,
    };
  }

  let aiStatusSummary = String(baselineNarrative.aiStatusSummary || "").trim();
  let aiNextStepRecommendation = String(
    baselineNarrative.aiNextStepRecommendation || "",
  ).trim();
  let aiRecommendedAction = normalizeNarrativeRecommendedAction(
    baselineNarrative.aiRecommendedAction,
  );

  const documentCount = Number(item?.documentActivity?.documentCount || 0);
  const documentAnchor = buildNarrativeDocumentAnchor(item);
  if (documentCount > 0 && documentAnchor) {
    if (!textContainsNarrativeAnchor(aiStatusSummary, documentAnchor)) {
      const evidenceLabel = `Evidencia reciente: \"${documentAnchor.fileName}\"${
        documentAnchor.createdAt ? ` (${documentAnchor.createdAt})` : ""
      }.`;
      aiStatusSummary = truncateText(
        [aiStatusSummary, evidenceLabel].filter(Boolean).join(" ").trim(),
        320,
      );
    }

    if (
      !textContainsNarrativeAnchor(aiNextStepRecommendation, documentAnchor)
    ) {
      const recommendationAnchor = documentAnchor.summary
        ? "Usar ese documento para cerrar validacion tecnica y economica con decisor."
        : "Usar ese documento como base de la sesion de decision con el cliente.";
      aiNextStepRecommendation = truncateText(
        [aiNextStepRecommendation, recommendationAnchor]
          .filter(Boolean)
          .join(" ")
          .trim(),
        320,
      );
    }

    if (aiRecommendedAction) {
      const expectedEvidence = String(
        aiRecommendedAction.evidenceExpected || "",
      ).trim();
      if (!textContainsNarrativeAnchor(expectedEvidence, documentAnchor)) {
        aiRecommendedAction = normalizeNarrativeRecommendedAction({
          ...aiRecommendedAction,
          evidenceExpected: truncateText(
            `${
              expectedEvidence ? `${expectedEvidence}. ` : ""
            }Acta de revision del documento \"${documentAnchor.fileName}\", decisor confirmado y fecha de cierre acordada.`,
            220,
          ),
        });
      }
    }
  }

  if (!aiRecommendedAction) {
    aiRecommendedAction = buildFallbackRecommendedAction(item);
  }

  if (!aiStatusSummary) {
    aiStatusSummary = String(
      normalizedContract?.descriptionSituationText ||
        item.aiStatusSummary ||
        "",
    ).trim();
  }
  if (!aiNextStepRecommendation) {
    aiNextStepRecommendation = String(
      normalizedContract?.nextBestStepText ||
        item.aiNextStepRecommendation ||
        "",
    ).trim();
  }

  const aiContract = normalizeNarrativeContract(
    baselineNarrative.aiContract,
    buildFallbackNarrativeContract(item, aiRecommendedAction),
  );

  return {
    ...baselineNarrative,
    aiStatusSummary,
    aiNextStepRecommendation,
    aiRecommendedAction,
    aiContract,
  };
}

function hashCommercialNarrativeSnapshot(snapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

function buildCommercialNarrativeJobResponse(row) {
  const fallback = parseCommercialNarrativeJson(row.fallback_json, null);
  const result = parseCommercialNarrativeJson(row.result_json, null);
  const sourceSnapshot = parseCommercialNarrativeJson(
    row.source_snapshot_json,
    null,
  );
  const isExpired =
    row.expires_at && new Date(row.expires_at).getTime() <= Date.now();
  const status =
    isExpired && ["completed", "failed", "stale"].includes(row.status)
      ? "expired"
      : row.status;
  const response = {
    job: {
      id: String(row.public_id),
      status,
      pollAfterMs: COMMERCIAL_NARRATIVE_JOB_POLL_AFTER_MS,
      resultAvailable: status === "completed" && Boolean(result),
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      expiresAt: row.expires_at,
    },
    fallback,
  };

  if (status === "completed" && result) {
    const strengthenedResult = strengthenNarrativeWithEvidence(
      sourceSnapshot && typeof sourceSnapshot === "object"
        ? sourceSnapshot
        : fallback,
      result,
    );
    response.result = {
      ...result,
      ...strengthenedResult,
      generatedAt:
        result?.generatedAt ||
        row.finished_at ||
        row.updated_at ||
        row.created_at ||
        null,
    };
    return response;
  }

  if (status === "failed") {
    response.error = {
      code: row.error_code || "narrative_failed",
      message:
        String(row.error_message || "").trim() ||
        "No fue posible completar la narrativa IA",
    };
    return response;
  }

  if (status === "stale") {
    response.error = {
      code: row.error_code || "stale_snapshot",
      message:
        String(row.error_message || "").trim() ||
        "La oportunidad cambio antes de ejecutar la narrativa IA. Solicita una nueva generacion.",
    };
    return response;
  }

  if (status === "expired") {
    response.error = {
      code: "expired_result",
      message:
        "El resultado de la narrativa IA ya expiro. Solicita una nueva generacion.",
    };
  }

  return response;
}

async function buildCommercialNarrativeExecutionContext({
  user,
  opportunityId,
}) {
  const opportunity = await loadOpportunityForExecution(user, opportunityId);
  if (!opportunity) {
    const error = new Error("Oportunidad no encontrada");
    error.status = 404;
    throw error;
  }

  const narrativeItem = await buildExecutionNarrativeItem({
    user,
    opportunity,
  });
  if (!narrativeItem) {
    const error = new Error("Oportunidad no encontrada");
    error.status = 404;
    throw error;
  }

  const fallbackNarrative = buildOpportunityNarrativeFallback(narrativeItem);
  return {
    narrativeItem,
    snapshot: buildCommercialNarrativeSnapshot(narrativeItem),
    fallback: {
      opportunityId,
      ...fallbackNarrative,
    },
  };
}

async function executeCommercialOpportunityNarrative({ user, opportunityId }) {
  const executionContext = await buildCommercialNarrativeExecutionContext({
    user,
    opportunityId,
  });

  try {
    const aiInsights = await requestOpportunityNarrativesWithAi(
      [
        {
          ...executionContext.narrativeItem,
          ...executionContext.fallback,
        },
      ],
      {
        aiUsageContext: {
          userId: Number(user.id),
          featureCode: "commercial_development.opportunity_narrative",
          jobType: "commercial_narrative",
          jobId: Number(opportunityId),
          internalRequestId: `cn_${Number(opportunityId)}_${Date.now().toString(36)}_${randomUUID().replace(/-/g, "").slice(0, 6)}`,
          startedAt: new Date().toISOString(),
        },
      },
    );
    const aiNarrative = aiInsights.get(opportunityId);
    return {
      snapshot: executionContext.snapshot,
      fallback: executionContext.fallback,
      result: {
        opportunityId,
        aiStatusSummary:
          aiNarrative?.aiStatusSummary ||
          executionContext.fallback.aiStatusSummary,
        aiNextStepRecommendation:
          aiNarrative?.aiNextStepRecommendation ||
          executionContext.fallback.aiNextStepRecommendation,
        aiRecommendedAction:
          aiNarrative?.aiRecommendedAction ||
          executionContext.fallback.aiRecommendedAction ||
          null,
        aiContract:
          aiNarrative?.aiContract ||
          executionContext.fallback.aiContract ||
          null,
        aiNarrativeSource:
          aiNarrative?.aiNarrativeSource ||
          executionContext.fallback.aiNarrativeSource,
        generatedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    console.error(
      "Commercial narrative OpenAI fallback:",
      error?.message || error,
    );
    return {
      snapshot: executionContext.snapshot,
      fallback: executionContext.fallback,
      result: {
        opportunityId,
        ...executionContext.fallback,
        generatedAt: new Date().toISOString(),
      },
    };
  }
}

async function createOrReuseCommercialNarrativeJob({
  opportunityId,
  requestedByUserId,
  user,
  forceRegenerate = false,
}) {
  const executionContext = await buildCommercialNarrativeExecutionContext({
    user,
    opportunityId,
  });
  const fingerprint = hashCommercialNarrativeSnapshot(
    executionContext.snapshot,
  );
  const reusableRows = forceRegenerate
    ? []
    : await query(
        `SELECT *
     FROM commercial_opportunity_narrative_jobs
     WHERE opportunity_id = ?
       AND requested_by_user_id = ?
       AND request_fingerprint = ?
       AND status IN ('pending', 'running', 'completed')
       AND (expires_at IS NULL OR expires_at > NOW(3))
     ORDER BY id DESC
     LIMIT 1`,
        [opportunityId, requestedByUserId, fingerprint],
      );

  if (reusableRows.length) {
    const reusableRow = reusableRows[0];
    const reusableResult = parseCommercialNarrativeJson(
      reusableRow.result_json,
      null,
    );
    const reusableSource = String(reusableResult?.aiNarrativeSource || "")
      .trim()
      .toLowerCase();
    const shouldBypassReuse =
      reusableRow.status === "completed" && reusableSource === "fallback";

    if (!shouldBypassReuse) {
      return {
        wasReused: true,
        response: buildCommercialNarrativeJobResponse(reusableRow),
      };
    }
  }

  const publicId = buildCommercialNarrativeJobPublicId();
  await query(
    `INSERT INTO commercial_opportunity_narrative_jobs (
       public_id,
       opportunity_id,
       requested_by_user_id,
       status,
       request_fingerprint,
       source_snapshot_json,
       fallback_json
     ) VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
    [
      publicId,
      opportunityId,
      requestedByUserId,
      fingerprint,
      JSON.stringify(executionContext.snapshot),
      JSON.stringify(executionContext.fallback),
    ],
  );

  const rows = await query(
    `SELECT *
     FROM commercial_opportunity_narrative_jobs
     WHERE public_id = ?
     LIMIT 1`,
    [publicId],
  );
  return {
    wasReused: false,
    response: buildCommercialNarrativeJobResponse(rows[0]),
  };
}

async function getCommercialNarrativeJob({ publicId, opportunityId }) {
  const rows = await query(
    `SELECT *
     FROM commercial_opportunity_narrative_jobs
     WHERE public_id = ?
       AND opportunity_id = ?
     LIMIT 1`,
    [publicId, opportunityId],
  );
  return rows.length ? buildCommercialNarrativeJobResponse(rows[0]) : null;
}

async function claimNextPendingCommercialNarrativeJob() {
  const candidates = await query(
    `SELECT id
     FROM commercial_opportunity_narrative_jobs
     WHERE (
         status = 'pending'
         OR (
           status = 'running'
           AND lease_expires_at IS NOT NULL
           AND lease_expires_at <= NOW(3)
         )
       )
       AND (expires_at IS NULL OR expires_at > NOW(3))
     ORDER BY created_at ASC, id ASC
     LIMIT 20`,
  );

  for (const candidate of candidates) {
    const leaseToken = randomUUID().replace(/-/g, "");
    const updateResult = await query(
      `UPDATE commercial_opportunity_narrative_jobs
       SET status = 'running',
           attempt_count = attempt_count + 1,
           lease_token = ?,
           lease_expires_at = DATE_ADD(NOW(3), INTERVAL ? SECOND),
           started_at = COALESCE(started_at, NOW(3)),
           updated_at = NOW(3)
       WHERE id = ?
         AND (
           status = 'pending'
           OR (
             status = 'running'
             AND lease_expires_at IS NOT NULL
             AND lease_expires_at <= NOW(3)
           )
         )`,
      [
        leaseToken,
        COMMERCIAL_NARRATIVE_JOB_LEASE_SECONDS,
        Number(candidate.id),
      ],
    );

    if (updateResult.affectedRows) {
      const rows = await query(
        `SELECT *
         FROM commercial_opportunity_narrative_jobs
         WHERE id = ?
         LIMIT 1`,
        [Number(candidate.id)],
      );
      return rows[0] || null;
    }
  }

  return null;
}

async function finalizeCommercialNarrativeJob({
  jobId,
  leaseToken,
  status,
  result,
  errorCode,
  errorMessage,
}) {
  await query(
    `UPDATE commercial_opportunity_narrative_jobs
     SET status = ?,
         result_json = ?,
         error_code = ?,
         error_message = ?,
         finished_at = NOW(3),
         expires_at = DATE_ADD(NOW(3), INTERVAL ? MINUTE),
         lease_token = NULL,
         lease_expires_at = NULL,
         updated_at = NOW(3)
     WHERE id = ?
       AND lease_token = ?`,
    [
      status,
      result ? JSON.stringify(result) : null,
      errorCode || null,
      errorMessage || null,
      COMMERCIAL_NARRATIVE_JOB_RESULT_TTL_MINUTES,
      jobId,
      leaseToken,
    ],
  );
}

async function processCommercialNarrativeJob(row) {
  try {
    const user = await getUserAuthContext(Number(row.requested_by_user_id));
    if (!user) {
      await finalizeCommercialNarrativeJob({
        jobId: Number(row.id),
        leaseToken: row.lease_token,
        status: "failed",
        errorCode: "requester_not_found",
        errorMessage: "No fue posible resolver el usuario solicitante del job",
      });
      return;
    }

    const execution = await executeCommercialOpportunityNarrative({
      user,
      opportunityId: Number(row.opportunity_id),
    });
    const fingerprint = hashCommercialNarrativeSnapshot(execution.snapshot);
    if (fingerprint !== row.request_fingerprint) {
      await finalizeCommercialNarrativeJob({
        jobId: Number(row.id),
        leaseToken: row.lease_token,
        status: "stale",
        errorCode: "stale_snapshot",
        errorMessage:
          "La oportunidad cambio antes de ejecutar la narrativa IA. Solicita una nueva generacion.",
      });
      return;
    }

    await finalizeCommercialNarrativeJob({
      jobId: Number(row.id),
      leaseToken: row.lease_token,
      status: "completed",
      result: execution.result,
    });
  } catch (error) {
    await finalizeCommercialNarrativeJob({
      jobId: Number(row.id),
      leaseToken: row.lease_token,
      status: "failed",
      errorCode: "narrative_failed",
      errorMessage:
        String(error?.message || "").trim() ||
        "No fue posible completar la narrativa IA",
    });
  }
}

export function queueCommercialNarrativeProcessing() {
  commercialNarrativeWorkerQueued = true;
}

export async function processPendingCommercialNarrativeJobs({
  limit = 1,
} = {}) {
  let processed = 0;
  while (processed < limit) {
    const row = await claimNextPendingCommercialNarrativeJob();
    if (!row) {
      break;
    }
    processed += 1;
    await processCommercialNarrativeJob(row);
  }
  return processed;
}

export async function startCommercialNarrativeWorker() {
  if (commercialNarrativeWorkerStarted) {
    return;
  }
  commercialNarrativeWorkerStarted = true;

  const tick = async () => {
    if (!commercialNarrativeWorkerQueued) {
      return;
    }
    commercialNarrativeWorkerQueued = false;
    try {
      const processed = await processPendingCommercialNarrativeJobs({
        limit: 5,
      });
      if (processed > 0) {
        commercialNarrativeWorkerQueued = true;
      }
    } catch (error) {
      console.error(
        "Commercial narrative worker error:",
        error?.message || error,
      );
    }
  };

  const interval = setInterval(() => {
    tick();
  }, COMMERCIAL_NARRATIVE_JOB_POLL_AFTER_MS);
  interval.unref?.();

  queueCommercialNarrativeProcessing();
  await tick();
}

function buildPriorityItems(items, planningSnapshot) {
  const maxAmount = items.length
    ? Math.max(...items.map((item) => Number(item.amountUsd || 0)), 1)
    : 1;
  const maxStageOrder = items.length
    ? Math.max(...items.map((item) => Number(item.stageId || 0)), 6)
    : 6;
  const quotaGapAmount = Number(planningSnapshot?.quota?.gapAmount || 0);

  return items
    .map((item) => {
      const amountRatio = Number(item.amountUsd || 0) / maxAmount;
      const stageConfidence = getStageConfidence(
        item.stageCode,
        item.stageId,
        maxStageOrder,
      );
      const impactScore = Math.round(
        amountRatio * 45 +
          Math.min(
            quotaGapAmount > 0
              ? Number(item.amountUsd || 0) / quotaGapAmount
              : 0.45,
            1,
          ) *
            35 +
          stageConfidence * 20,
      );

      let riskScore =
        item.riskLevel === "high" ? 70 : item.riskLevel === "medium" ? 45 : 15;
      riskScore += Math.min((item.riskReasons || []).length * 6, 18);
      riskScore += item.nextStep?.isOverdue ? 12 : 0;
      riskScore += item.executionState?.code === "bloqueada" ? 10 : 0;
      riskScore += item.executionState?.code === "esperando_interno" ? 8 : 0;
      riskScore = clampNumber(riskScore, 0, 100);

      const closeDate = item.closeDate ? new Date(item.closeDate) : null;
      const daysToClose =
        closeDate && !Number.isNaN(closeDate.getTime())
          ? Math.ceil((closeDate.getTime() - Date.now()) / 86400000)
          : null;
      let urgencyScore = 25;
      if (daysToClose !== null) {
        if (daysToClose <= 7) urgencyScore += 35;
        else if (daysToClose <= 21) urgencyScore += 24;
        else if (daysToClose <= 45) urgencyScore += 14;
      }
      if (item.nextStep?.isOverdue) urgencyScore += 20;
      if (!item.nextStep) urgencyScore += 12;
      if (item.daysSinceActivity > item.slaDays) urgencyScore += 10;
      urgencyScore = clampNumber(urgencyScore, 0, 100);

      const priorityScore = Math.round(
        impactScore * 0.45 + riskScore * 0.3 + urgencyScore * 0.25,
      );
      const gapCoverageShare = quotaGapAmount
        ? roundAmount((Number(item.amountUsd || 0) / quotaGapAmount) * 100)
        : null;

      return {
        ...item,
        impactScore,
        riskScore,
        urgencyScore,
        priorityScore,
        stageConfidence: roundAmount(stageConfidence * 100),
        gapCoverageShare,
        primaryRecommendation: buildDevelopmentRecommendation(item),
      };
    })
    .sort((left, right) => {
      if (right.priorityScore !== left.priorityScore) {
        return right.priorityScore - left.priorityScore;
      }
      return Number(right.amountUsd || 0) - Number(left.amountUsd || 0);
    });
}

function buildDevelopmentRecommendations({
  summary,
  planningSnapshot,
  priorities,
  quarterPipeline,
}) {
  const recommendations = [];
  const quota = planningSnapshot.quota || {};

  if (!planningSnapshot.period?.hasPlan) {
    recommendations.push({
      type: "planning_gap",
      title: `No existe cuota publicada para ${planningSnapshot.period?.label}`,
      detail:
        "Publica una versión activa en Planeación Comercial para medir avance real contra meta.",
      tone: "medium",
    });
  } else if (Number(quota.gapAmount || 0) > 0) {
    const committedOpenAmount = Number(quota.committedOpenAmount || 0);
    const weightedOpenAmount = Number(quota.weightedOpenAmount || 0);
    recommendations.push({
      type: "quota_gap",
      title: `Faltan ${quota.gapAmount || 0} para cubrir la cuota del trimestre`,
      detail:
        committedOpenAmount >= Number(quota.gapAmount || 0)
          ? "El pipeline comprometido ya cubre la brecha actual, pero depende de ejecutar bien las oportunidades del tramo final."
          : committedOpenAmount + weightedOpenAmount >=
              Number(quota.gapAmount || 0)
            ? "Lo comprometido no alcanza; necesitas convertir también oportunidades en maduración para cubrir la brecha."
            : "Ni el pipeline comprometido ni el ponderado actuales alcanzan la brecha; hace falta abrir o acelerar cobertura.",
      tone:
        committedOpenAmount >= Number(quota.gapAmount || 0)
          ? "medium"
          : committedOpenAmount + weightedOpenAmount >=
              Number(quota.gapAmount || 0)
            ? "medium"
            : "high",
    });
  } else {
    recommendations.push({
      type: "quota_on_track",
      title: "La cuota del trimestre ya está cubierta en real",
      detail:
        "Protege los cierres ganados y reorienta foco a expansión o margen.",
      tone: "low",
    });
  }

  if (summary.withoutNextStep > 0) {
    recommendations.push({
      type: "next_step",
      title: `${summary.withoutNextStep} oportunidad(es) siguen sin siguiente paso`,
      detail:
        "La prioridad operativa más barata es cerrar conducción visible en oportunidades con monto relevante.",
      tone: "high",
    });
  }

  if (summary.waitingOnInternal > 0 || summary.blockedOpportunities > 0) {
    recommendations.push({
      type: "internal_blockers",
      title: "Hay avance detenido por bloqueos internos",
      detail: `Tienes ${summary.waitingOnInternal || 0} esperando interno y ${summary.blockedOpportunities || 0} bloqueadas. Destrabar interno probablemente mueve más cuota que abrir más pipeline.`,
      tone: "medium",
    });
  }

  const topPriority = priorities[0];
  if (topPriority) {
    recommendations.push({
      type: "focus_opportunity",
      title: `Empieza por ${topPriority.name}`,
      detail: topPriority.primaryRecommendation,
      tone: topPriority.riskLevel === "high" ? "high" : "medium",
      opportunityId: topPriority.id,
    });
  }

  const strongestStage = quarterPipeline[0];
  if (strongestStage && strongestStage.opportunityCount > 0) {
    recommendations.push({
      type: "stage_focus",
      title: `La mayor cobertura del trimestre está en ${strongestStage.stageName}`,
      detail: `Esta etapa concentra ${strongestStage.weightedAmount} ponderados. Vale la pena limpiar vacíos y acelerar decisión aquí antes de abrir más frentes.`,
      tone: "low",
    });
  }

  return recommendations.slice(0, 5);
}

function buildActionsToday({
  priorities,
  activeCadences,
  pendingInteractions,
}) {
  const actionItems = [];

  priorities.forEach((item) => {
    if (!item.nextStep) {
      actionItems.push({
        kind: "next_step",
        priorityScore: item.priorityScore + 8,
        opportunityId: item.id,
        opportunityName: item.name,
        accountName: item.accountName,
        opportunityScore: item.opportunityScore ?? null,
        scoreTone:
          item.workspaceSummary?.health?.overallTone ||
          item.scorecardOverallTone,
        title: "Definir siguiente paso",
        detail: item.primaryRecommendation,
        dueDate: null,
      });
    } else if (item.nextStep.isOverdue) {
      actionItems.push({
        kind: "follow_up_overdue",
        priorityScore: item.priorityScore + 12,
        opportunityId: item.id,
        opportunityName: item.name,
        accountName: item.accountName,
        opportunityScore: item.opportunityScore ?? null,
        scoreTone:
          item.workspaceSummary?.health?.overallTone ||
          item.scorecardOverallTone,
        title: item.nextStep.title || "Cerrar seguimiento vencido",
        detail:
          "El compromiso ya venció y debe renegociarse o completarse hoy.",
        dueDate: item.nextStep.dueDate || null,
      });
    }

    const overdueDependency = (item.dependencies || []).find(
      (dependency) => dependency.isOverdue,
    );
    if (overdueDependency) {
      actionItems.push({
        kind: "dependency",
        priorityScore: item.priorityScore + 10,
        opportunityId: item.id,
        opportunityName: item.name,
        accountName: item.accountName,
        opportunityScore: item.opportunityScore ?? null,
        scoreTone:
          item.workspaceSummary?.health?.overallTone ||
          item.scorecardOverallTone,
        title: overdueDependency.title,
        detail: `Resolver ${overdueDependency.dependencyLabel} para liberar avance comercial.`,
        dueDate: overdueDependency.dueDate || null,
      });
    }
  });

  activeCadences.forEach((cadence) => {
    const nextRunAt = cadence.nextRunAt ? new Date(cadence.nextRunAt) : null;
    if (!nextRunAt || nextRunAt.getTime() <= Date.now()) {
      actionItems.push({
        kind: "cadence",
        priorityScore: 70,
        opportunityId: cadence.opportunityId,
        opportunityName: cadence.opportunityName,
        accountName: cadence.accountName,
        title: cadence.title,
        detail: cadence.currentStepLabel || "Cadencia lista para ejecutarse",
        dueDate: cadence.nextRunAt || null,
      });
    }
  });

  pendingInteractions.slice(0, 4).forEach((item) => {
    actionItems.push({
      kind: "interaction",
      priorityScore: 55,
      opportunityId: item.primaryOpportunityId,
      opportunityName:
        item.primaryOpportunityName || "Sin oportunidad principal",
      accountName: item.accountName,
      title: item.title,
      detail:
        "Resolver interacción pendiente que puede destrabar evidencia o avance.",
      dueDate: item.createdAt || null,
    });
  });

  return actionItems
    .sort((left, right) => right.priorityScore - left.priorityScore)
    .slice(0, DEVELOPMENT_ACTION_LIMIT);
}

function userHasPermission(user, permission) {
  if (user?.permissionSet instanceof Set) {
    return user.permissionSet.has(permission);
  }
  const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
  return permissions.includes(permission);
}

function hasGlobalOpportunityScope(user) {
  return userHasPermission(user, "oportunidades.read_all");
}

function hasCalendarGlobalScope(user) {
  return userHasPermission(user, "calendario_comercial.read_all");
}

function isPendingCommercialActivityStatus(status) {
  return COMMERCIAL_ACTIVITY_OPEN_STATUSES.has(String(status || ""));
}

function getCalendarActivityStatuses(includeCompleted) {
  const pendingStatuses = Array.from(COMMERCIAL_ACTIVITY_OPEN_STATUSES);
  if (!includeCompleted) {
    return pendingStatuses;
  }
  return [
    ...pendingStatuses,
    ...Array.from(CALENDAR_COMPLETED_ACTIVITY_STATUSES),
  ];
}

function getLeadFollowUpActionLabel(actionCode) {
  return LEAD_FOLLOW_UP_ACTION_LABELS[String(actionCode || "").trim()] || "";
}

function resolveCalendarSellerScope(user, requestedSellerUserId) {
  const parsed = Number(requestedSellerUserId || 0);
  if (!hasCalendarGlobalScope(user)) {
    return Number(user.id);
  }
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return null;
}

function getCalendarTrafficLight({
  isOverdue,
  isToday,
  isUpcoming,
  isBlocked,
  hasOverdueDependency,
}) {
  if (isOverdue || isBlocked || hasOverdueDependency) return "red";
  if (isToday || isUpcoming) return "amber";
  return "green";
}

function computeCalendarRiskScore({
  isOverdue,
  isToday,
  isUpcoming,
  isBlocked,
  hasOverdueDependency,
  isSilenceRisk,
}) {
  let score = 0;
  if (isOverdue) score += 60;
  if (isBlocked) score += 20;
  if (hasOverdueDependency) score += 20;
  if (isSilenceRisk) score += 15;
  if (isToday) score += 20;
  if (isUpcoming) score += 10;
  return Math.min(100, score);
}

function sortAlertsByRisk(left, right) {
  const riskDelta = Number(right.riskScore || 0) - Number(left.riskScore || 0);
  if (riskDelta !== 0) return riskDelta;
  const leftDate = left.scheduledAt
    ? new Date(left.scheduledAt).getTime()
    : Number.MAX_SAFE_INTEGER;
  const rightDate = right.scheduledAt
    ? new Date(right.scheduledAt).getTime()
    : Number.MAX_SAFE_INTEGER;
  if (leftDate !== rightDate) return leftDate - rightDate;
  return String(left.title || "").localeCompare(
    String(right.title || ""),
    "es",
  );
}

async function listCalendarSellerOptions(user) {
  if (!hasCalendarGlobalScope(user)) {
    return [
      {
        id: Number(user.id),
        fullName: user.full_name || "Mi calendario",
      },
    ];
  }

  const rows = await query(
    `SELECT DISTINCT u.id, u.full_name
     FROM users u
     WHERE u.status = 'active'
      AND u.id != ?
     ORDER BY u.full_name ASC, u.id ASC`,
    [Number(user.id)],
  ).catch(() => []);

  return rows.map((row) => ({
    id: Number(row.id),
    fullName: row.full_name || `Usuario ${row.id}`,
  }));
}

function hasInteractionReadPermission(user) {
  return userHasPermission(user, "interacciones.read");
}

function getDiffDays(fromDate, toDate = new Date()) {
  const start = new Date(fromDate);
  const end = new Date(toDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 0;
  }
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86400000));
}

function normalizeJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getDependencyTypeLabel(type) {
  return DEPENDENCY_TYPE_LABELS[type] || type || "Dependencia interna";
}

function buildOwnershipJoin(user, params, alias = "o") {
  if (hasGlobalOpportunityScope(user)) {
    return "";
  }
  params.push(Number(user.id));
  return `LEFT JOIN account_owners ao_scope ON ao_scope.account_id = ${alias}.account_id AND ao_scope.user_id = ?`;
}

async function listActiveSalesStages() {
  return query(
    `SELECT id, code, name, stage_order
     FROM opportunity_sales_stages
     WHERE is_active = 1
     ORDER BY stage_order ASC, id ASC`,
  );
}

function buildOpportunityStageSummary(stagesCatalog, opportunityState) {
  return stagesCatalog.map((stage) => {
    const stageOrder = Number(stage.stage_order || 0);
    const currentStageOrder = Number(opportunityState.stage_order || 0);
    return {
      id: Number(stage.id),
      code: stage.code,
      name: stage.name,
      description: null,
      stageOrder,
      isCurrent: Number(stage.id) === Number(opportunityState.salesStageId),
      isPast: stageOrder < currentStageOrder,
      isFuture: stageOrder > currentStageOrder,
    };
  });
}

function buildStageView(stagesCatalog, opportunityState) {
  const stages = buildOpportunityStageSummary(stagesCatalog, opportunityState);
  return {
    opportunityId: Number(opportunityState.id),
    selectedSalesStageId: Number(opportunityState.salesStageId),
    salesStageId: Number(opportunityState.salesStageId),
    salesStageCode: opportunityState.sales_stage_code,
    salesStageName: opportunityState.sales_stage_name,
    commercialStatusCode: opportunityState.commercial_status_code,
    commercialStatusName: opportunityState.commercial_status_name,
    stages,
  };
}

async function listAccessibleOpportunities(user) {
  const params = [];
  const ownershipJoin = buildOwnershipJoin(user, params);
  if (!hasGlobalOpportunityScope(user)) {
    params.push(Number(user.id));
  }

  return query(
    `SELECT o.id, o.account_id, o.name, o.amount_usd, o.close_date, o.sales_stage_id,
            o.commercial_status_id, o.seller_user_id, o.updated_at,
            a.name AS account_name,
            oas.code AS activation_status_code,
            oss.code AS sales_stage_code,
            oss.name AS sales_stage_name,
            oss.stage_order,
            ocs.code AS commercial_status_code,
            ocs.name AS commercial_status_name,
          su.full_name AS seller_user_name,
          su.email AS seller_user_email
     FROM opportunities o
     ${ownershipJoin}
     INNER JOIN accounts a ON a.id = o.account_id
     INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
     INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
     INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
     LEFT JOIN users su ON su.id = o.seller_user_id
     WHERE ocs.code NOT IN ('ganada', 'perdida', 'cancelada')
       AND oas.code = 'activada'
       ${hasGlobalOpportunityScope(user) ? "" : "AND (ao_scope.user_id IS NOT NULL OR o.created_by = ?)"}
     ORDER BY o.updated_at DESC, o.id DESC`,
    params,
  );
}

async function listAccessiblePlanningOpportunities(user) {
  const params = [];
  const ownershipJoin = buildOwnershipJoin(user, params);
  if (!hasGlobalOpportunityScope(user)) {
    params.push(Number(user.id));
  }

  return query(
    `SELECT o.id, o.account_id, o.name, o.amount_usd, o.close_date, o.sales_stage_id,
            o.commercial_status_id, o.seller_user_id, o.updated_at,
            a.name AS account_name,
            oas.code AS activation_status_code,
            oss.code AS sales_stage_code,
            oss.name AS sales_stage_name,
            oss.stage_order,
            ocs.code AS commercial_status_code,
            ocs.name AS commercial_status_name,
          su.full_name AS seller_user_name,
          su.email AS seller_user_email
     FROM opportunities o
     ${ownershipJoin}
     INNER JOIN accounts a ON a.id = o.account_id
     INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
     INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
     INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
     LEFT JOIN users su ON su.id = o.seller_user_id
     WHERE ocs.code NOT IN ('perdida', 'cancelada')
       AND oas.code = 'activada'
       ${hasGlobalOpportunityScope(user) ? "" : "AND (ao_scope.user_id IS NOT NULL OR o.created_by = ?)"}
     ORDER BY o.updated_at DESC, o.id DESC`,
    params,
  );
}

async function listPendingInteractions(user) {
  if (!hasInteractionReadPermission(user)) {
    return [];
  }

  const params = [];
  const ownershipJoin = hasGlobalOpportunityScope(user)
    ? ""
    : "LEFT JOIN account_owners ao_scope ON ao_scope.account_id = i.account_id AND ao_scope.user_id = ?";
  if (!hasGlobalOpportunityScope(user)) {
    params.push(Number(user.id));
    params.push(Number(user.id));
  }

  const where = ["i.analysis_status <> 'lead_qualified'"];
  if (!hasGlobalOpportunityScope(user)) {
    where.push("(ao_scope.user_id IS NOT NULL OR i.created_by = ?)");
  }

  return query(
    `SELECT i.id, i.title, i.analysis_status, i.created_at, i.account_id,
            a.name AS account_name,
            i.primary_opportunity_id,
            o.name AS primary_opportunity_name
     FROM interactions i
     LEFT JOIN accounts a ON a.id = i.account_id
     LEFT JOIN opportunities o ON o.id = i.primary_opportunity_id
     ${ownershipJoin}
     WHERE ${where.join(" AND ")}
     ORDER BY i.created_at DESC
     LIMIT 25`,
    params,
  );
}

async function listActiveCadences(opportunityIds) {
  if (!opportunityIds.length) {
    return [];
  }

  const placeholders = opportunityIds.map(() => "?").join(", ");
  return query(
    `SELECT c.id, c.opportunity_id, c.cadence_type, c.title, c.status,
            c.current_step_index, c.steps_json, c.next_run_at, c.last_executed_at,
            c.owner_user_id, c.notes, u.full_name AS owner_user_name
     FROM commercial_execution_cadences c
     LEFT JOIN users u ON u.id = c.owner_user_id
     WHERE c.opportunity_id IN (${placeholders})
       AND c.status IN ('active', 'paused')
     ORDER BY c.next_run_at IS NULL ASC, c.next_run_at ASC, c.updated_at DESC`,
    opportunityIds,
  );
}

async function listOpenDependencies(opportunityIds) {
  if (!opportunityIds.length) {
    return [];
  }

  const placeholders = opportunityIds.map(() => "?").join(", ");
  return query(
    `SELECT d.id, d.opportunity_id, d.dependency_type, d.title, d.status,
            d.owner_user_id, d.due_date, d.expected_outcome, d.details,
            d.resolution_note, d.created_at, d.updated_at,
            u.full_name AS owner_user_name
     FROM commercial_execution_dependencies d
     LEFT JOIN users u ON u.id = d.owner_user_id
     WHERE d.opportunity_id IN (${placeholders})
       AND d.status IN ('open', 'blocked')
     ORDER BY d.due_date IS NULL ASC, d.due_date ASC, d.updated_at DESC`,
    opportunityIds,
  );
}

async function listDependencies(opportunityIds) {
  if (!opportunityIds.length) {
    return [];
  }

  const placeholders = opportunityIds.map(() => "?").join(", ");
  return query(
    `SELECT d.id, d.opportunity_id, d.dependency_type, d.title, d.status,
            d.owner_user_id, d.due_date, d.expected_outcome, d.details,
            d.resolution_note, d.created_at, d.updated_at,
            u.full_name AS owner_user_name
     FROM commercial_execution_dependencies d
     LEFT JOIN users u ON u.id = d.owner_user_id
     WHERE d.opportunity_id IN (${placeholders})
     ORDER BY d.due_date IS NULL ASC, d.due_date ASC, d.updated_at DESC`,
    opportunityIds,
  );
}

async function listOpportunityDocumentSignals(opportunityId) {
  const normalizedOpportunityId = Number(opportunityId || 0);
  if (
    !Number.isInteger(normalizedOpportunityId) ||
    normalizedOpportunityId <= 0
  ) {
    return {
      lastDocumentAt: null,
      documentCount: 0,
      docsLast7d: 0,
      processingStatusCounts: {
        reviewReady: 0,
        processing: 0,
        failed: 0,
      },
      highlights: [],
    };
  }

  const rows = await query(
    `SELECT d.id,
            d.original_file_name,
            d.processing_status,
            d.created_at,
            dc.content_summary
     FROM opportunity_document_links odl
     INNER JOIN documents d ON d.id = odl.document_id
     LEFT JOIN document_contents dc ON dc.document_id = d.id
     WHERE odl.opportunity_id = ?
       AND d.is_deleted = 0
     ORDER BY d.created_at DESC, d.id DESC
     LIMIT 40`,
    [normalizedOpportunityId],
  ).catch(() => []);

  const lastDocumentAt = rows[0]?.created_at || null;
  const now = new Date();
  const docsLast7d = rows.filter((row) => {
    const createdAt = row?.created_at ? new Date(row.created_at) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) {
      return false;
    }
    return now.getTime() - createdAt.getTime() <= 7 * 24 * 60 * 60 * 1000;
  }).length;

  const processingStatusCounts = rows.reduce(
    (accumulator, row) => {
      const status = String(row?.processing_status || "").trim();
      if (status === "review_ready") {
        accumulator.reviewReady += 1;
      } else if (["uploaded", "retry_pending", "processing"].includes(status)) {
        accumulator.processing += 1;
      } else if (status === "failed") {
        accumulator.failed += 1;
      }
      return accumulator;
    },
    {
      reviewReady: 0,
      processing: 0,
      failed: 0,
    },
  );

  const highlights = rows
    .slice(0, 4)
    .map((row) => ({
      fileName: String(row?.original_file_name || "").trim(),
      createdAt: row?.created_at || null,
      processingStatus: String(row?.processing_status || "").trim(),
      summary: truncateText(row?.content_summary || "", 220),
    }))
    .filter((item) => item.fileName || item.summary);

  return {
    lastDocumentAt,
    documentCount: rows.length,
    docsLast7d,
    processingStatusCounts,
    highlights,
  };
}

async function listLatestCommercialNarrativesByOpportunity(opportunityIds) {
  if (!opportunityIds.length) {
    return new Map();
  }

  const placeholders = opportunityIds.map(() => "?").join(", ");
  const rows = await query(
    `SELECT j.opportunity_id,
            j.result_json,
            j.source_snapshot_json,
            j.finished_at,
            j.updated_at,
            j.created_at
     FROM commercial_opportunity_narrative_jobs j
     INNER JOIN (
       SELECT opportunity_id,
              MAX(COALESCE(finished_at, updated_at, created_at)) AS latest_at
       FROM commercial_opportunity_narrative_jobs
       WHERE opportunity_id IN (${placeholders})
         AND status = 'completed'
         AND result_json IS NOT NULL
       GROUP BY opportunity_id
     ) latest
       ON latest.opportunity_id = j.opportunity_id
      AND latest.latest_at = COALESCE(j.finished_at, j.updated_at, j.created_at)
     WHERE j.opportunity_id IN (${placeholders})
       AND j.status = 'completed'
       AND j.result_json IS NOT NULL
     ORDER BY j.opportunity_id ASC, j.id DESC`,
    [...opportunityIds, ...opportunityIds],
  ).catch(() => []);

  const narrativeByOpportunity = new Map();
  for (const row of rows) {
    const opportunityId = Number(row?.opportunity_id || 0);
    if (!opportunityId || narrativeByOpportunity.has(opportunityId)) {
      continue;
    }

    const result = parseCommercialNarrativeJson(row.result_json, null);
    const snapshot = parseCommercialNarrativeJson(
      row.source_snapshot_json,
      null,
    );
    if (!result || typeof result !== "object") {
      continue;
    }

    const strengthenedResult = strengthenNarrativeWithEvidence(
      snapshot,
      result,
    );

    narrativeByOpportunity.set(opportunityId, {
      aiStatusSummary: String(strengthenedResult.aiStatusSummary || "").trim(),
      aiNextStepRecommendation: String(
        strengthenedResult.aiNextStepRecommendation || "",
      ).trim(),
      aiRecommendedAction: normalizeNarrativeRecommendedAction(
        strengthenedResult.aiRecommendedAction,
      ),
      aiContract: normalizeNarrativeContract(strengthenedResult.aiContract),
      aiNarrativeSource: String(
        strengthenedResult.aiNarrativeSource || "openai",
      ).trim(),
      aiNarrativeGeneratedAt:
        result.generatedAt ||
        row.finished_at ||
        row.updated_at ||
        row.created_at ||
        null,
    });
  }

  return narrativeByOpportunity;
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
  const actionTypes = Array.from(NEXT_STEP_ACTION_TYPES);
  const actionTypePlaceholders = actionTypes.map(() => "?").join(", ");

  const [
    actionRows,
    dependencyRows,
    answerRows,
    auditRows,
    interactionRows,
    documentRows,
  ] = await Promise.all([
    query(
      `SELECT opportunity_id, MAX(COALESCE(updated_at, created_at)) AS last_activity_at
       FROM opportunity_workspace_actions
       WHERE opportunity_id IN (${placeholders})
         AND action_type IN (${actionTypePlaceholders})
       GROUP BY opportunity_id`,
      [...opportunityIds, ...actionTypes],
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
       FROM audit_log
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
    query(
      `SELECT odl.opportunity_id,
                MAX(COALESCE(odl.created_at, d.updated_at, d.created_at)) AS last_activity_at
         FROM opportunity_document_links odl
         INNER JOIN documents d ON d.id = odl.document_id
         WHERE odl.opportunity_id IN (${placeholders})
           AND d.is_deleted = 0
         GROUP BY odl.opportunity_id`,
      opportunityIds,
    ).catch(() => []),
  ]);

  const activityByOpportunity = new Map();
  for (const row of [
    ...actionRows,
    ...dependencyRows,
    ...answerRows,
    ...auditRows,
    ...interactionRows,
    ...documentRows,
  ]) {
    setLatestActivityTimestamp(
      activityByOpportunity,
      Number(row.opportunity_id),
      row.last_activity_at,
    );
  }

  return activityByOpportunity;
}

function selectPrimaryNextStep(actions, currentStageId) {
  const candidates = (actions || [])
    .filter((action) => COMMERCIAL_TIMELINE_ACTION_TYPES.has(action.actionType))
    .filter((action) => isCommercialEntryOpen(action))
    .sort((left, right) => {
      const leftPrimary = Boolean(left.isPrimaryNextStep);
      const rightPrimary = Boolean(right.isPrimaryNextStep);
      if (leftPrimary !== rightPrimary) return leftPrimary ? -1 : 1;
      const leftDue = left.scheduledAt
        ? new Date(left.scheduledAt).getTime()
        : left.dueDate
          ? new Date(left.dueDate).getTime()
          : Number.MAX_SAFE_INTEGER;
      const rightDue = right.scheduledAt
        ? new Date(right.scheduledAt).getTime()
        : right.dueDate
          ? new Date(right.dueDate).getTime()
          : Number.MAX_SAFE_INTEGER;
      if (leftDue !== rightDue) return leftDue - rightDue;
      const leftCurrent =
        Number(left.linkedStageId || 0) === Number(currentStageId);
      const rightCurrent =
        Number(right.linkedStageId || 0) === Number(currentStageId);
      if (leftCurrent !== rightCurrent) return leftCurrent ? -1 : 1;
      return String(left.title || "").localeCompare(
        String(right.title || ""),
        "es",
      );
    });

  return candidates[0] || null;
}

function mapNextStep(nextStep) {
  if (!nextStep) {
    return null;
  }

  return {
    id: Number(nextStep.id),
    title: nextStep.title,
    actionType: nextStep.actionType || "next_step",
    dueDate: nextStep.dueDate,
    scheduledAt: nextStep.scheduledAt || null,
    status: nextStep.status,
    successCriteria: nextStep.successCriteria || "",
    notes: nextStep.notes || "",
    isPrimaryNextStep: Boolean(nextStep.isPrimaryNextStep),
    ownerUserId:
      nextStep.ownerUserId === null ? null : Number(nextStep.ownerUserId),
    ownerUserName: nextStep.ownerUserName || "",
    isOverdue: Boolean(nextStep.dueDate && getDiffDays(nextStep.dueDate) > 0),
  };
}

function getActionTimestamp(action) {
  const rawValue =
    action?.scheduledAt ||
    action?.dueDate ||
    action?.updatedAt ||
    action?.createdAt ||
    null;
  if (!rawValue) {
    return Number.NaN;
  }
  const parsed = new Date(rawValue);
  return Number.isNaN(parsed.getTime()) ? Number.NaN : parsed.getTime();
}

function getCommercialEntryKind(actionType) {
  return COMMERCIAL_ACTIVITY_ACTION_TYPES.has(actionType)
    ? "activity"
    : "action";
}

function isCommercialEntryOpen(entry) {
  const entryKind = getCommercialEntryKind(
    entry?.actionType || entry?.entryType || "",
  );
  const openStatuses =
    entryKind === "activity"
      ? COMMERCIAL_ACTIVITY_OPEN_STATUSES
      : COMMERCIAL_ACTION_OPEN_STATUSES;
  return openStatuses.has(entry?.status);
}

function mapCommercialTimelineEntry(action) {
  const entryKind = getCommercialEntryKind(action.actionType);
  return {
    id: Number(action.id),
    entryKind,
    title: action.title || "",
    entryType: action.actionType || "other",
    activityType: action.actionType || "other",
    status: action.status || "pending",
    priority: action.priority || "medium",
    scheduledAt: action.scheduledAt || null,
    dueDate: action.dueDate || null,
    note: action.notes || "",
    details: action.details || null,
    successCriteria: action.successCriteria || "",
    isPrimaryNextStep: Boolean(action.isPrimaryNextStep),
    ownerUserId:
      action.ownerUserId === null ? null : Number(action.ownerUserId),
    ownerUserName: action.ownerName || action.ownerUserName || "",
    createdAt: action.createdAt || null,
    updatedAt: action.updatedAt || null,
  };
}

function mapLeadFollowUpCalendarItem(row, timeZone = BUSINESS_TIMEZONE) {
  const actionLabel = getLeadFollowUpActionLabel(row.lead_required_action_code);
  const leadTitle = String(row.interaction_title || "").trim();
  const scheduledDateText =
    String(row.lead_next_action_due_date || "").trim() ||
    toIsoDate(row.lead_next_action_due_at);
  const scheduledStart = scheduledDateText
    ? toTimeZoneStartOfDayUtc(scheduledDateText, timeZone)
    : null;
  const scheduledAt = scheduledStart
    ? new Date(scheduledStart.getTime() + 12 * 60 * 60 * 1000)
    : row.lead_next_action_due_at;
  const scheduledDate = scheduledDateText
    ? scheduledDateText
    : formatDateInTimeZone(row.lead_next_action_due_at, timeZone);
  const leadSubstatusCode = String(row.lead_substatus_code || "").trim();
  const leadSubstatusName =
    LEAD_SUBSTATUS_LABELS[leadSubstatusCode] || leadSubstatusCode || "";

  return {
    id:
      row.event_id === null || row.event_id === undefined
        ? Number(row.id)
        : Number(row.event_id),
    interactionId: Number(row.interaction_id || row.id),
    calendarSource: "interaction",
    opportunityId:
      row.primary_opportunity_id === null
        ? null
        : Number(row.primary_opportunity_id),
    opportunityName:
      row.primary_opportunity_name || actionLabel || "Lead comercial",
    accountName: row.account_name || "",
    activityType: "lead_follow_up",
    status: "pending",
    scheduledAt,
    scheduledDate,
    title: leadTitle || actionLabel || "Seguimiento de lead",
    note: row.summary || actionLabel || "",
    isPrimaryNextStep: false,
    stageName: "Lead",
    sellerUserId:
      row.seller_user_id === null ? null : Number(row.seller_user_id),
    sellerUserName: row.seller_user_name || "Sin vendedor",
    closeDate: row.close_date || null,
    amountUsd: Number(row.amount_usd || 0),
    readonlyByStatus: true,
    leadSubstatusCode,
    leadSubstatusName,
  };
}

function mapCompletedLeadOutcomeCalendarItem(
  row,
  timeZone = BUSINESS_TIMEZONE,
) {
  const actionLabel = getLeadFollowUpActionLabel(row.lead_required_action_code);
  const leadTitle = String(row.interaction_title || "").trim();
  const effectiveAt = row.event_effective_at || row.event_created_at || null;
  const scheduledDate = effectiveAt
    ? formatDateInTimeZone(effectiveAt, timeZone)
    : "";
  const leadSubstatusCode = String(row.lead_substatus_code || "").trim();
  const leadSubstatusName =
    LEAD_SUBSTATUS_LABELS[leadSubstatusCode] || leadSubstatusCode || "";

  return {
    id: Number(row.event_id || row.id),
    interactionId: Number(row.interaction_id || row.id),
    calendarSource: "interaction",
    opportunityId:
      row.primary_opportunity_id === null
        ? null
        : Number(row.primary_opportunity_id),
    opportunityName:
      row.primary_opportunity_name || actionLabel || "Lead comercial",
    accountName: row.account_name || "",
    activityType: "lead_follow_up",
    status: "done",
    scheduledAt: effectiveAt,
    scheduledDate,
    title: leadTitle || actionLabel || "Seguimiento de lead",
    note: row.summary || actionLabel || "",
    isPrimaryNextStep: false,
    stageName: "Lead",
    sellerUserId:
      row.seller_user_id === null ? null : Number(row.seller_user_id),
    sellerUserName: row.seller_user_name || "Sin vendedor",
    closeDate: row.close_date || null,
    amountUsd: Number(row.amount_usd || 0),
    readonlyByStatus: true,
    leadSubstatusCode,
    leadSubstatusName,
  };
}

async function listCalendarLeadFollowUps({
  user,
  startDateTime,
  endExclusiveDateTime,
  startDate,
  endDate,
  sellerUserId = null,
  year = null,
  quarter = null,
  timeZone = BUSINESS_TIMEZONE,
}) {
  const params = [];
  const accessJoin = hasCalendarGlobalScope(user)
    ? ""
    : "LEFT JOIN account_owners ao_interaction_scope ON ao_interaction_scope.account_id = i.account_id AND ao_interaction_scope.user_id = ?";
  const sellerExpression = "COALESCE(i.seller_user_id, po.seller_user_id)";
  const where = [
    `i.lead_required_action_code IS NOT NULL`,
    `i.lead_next_action_due_at IS NOT NULL`,
    `COALESCE(i.lead_substatus_code, '') NOT IN ('disqualified_temporary', 'disqualified_definitive')`,
  ];

  if (!hasCalendarGlobalScope(user)) {
    params.push(Number(user.id));
  }

  const normalizedStartDate = String(startDate || "").trim();
  const normalizedEndDate = String(endDate || "").trim();
  if (normalizedStartDate && normalizedEndDate) {
    where.push(`DATE(i.lead_next_action_due_at) BETWEEN ? AND ?`);
    params.push(normalizedStartDate, normalizedEndDate);
  } else {
    where.push(`i.lead_next_action_due_at >= ?`);
    where.push(`i.lead_next_action_due_at < ?`);
    params.push(startDateTime, endExclusiveDateTime);
  }

  if (year !== null && quarter !== null) {
    const quarterRange = getQuarterDateRange(year, quarter);
    where.push(`po.close_date BETWEEN ? AND ?`);
    params.push(quarterRange.startDate, quarterRange.endDate);
  }

  if (Number.isInteger(Number(sellerUserId)) && Number(sellerUserId) > 0) {
    where.push(`${sellerExpression} = ?`);
    params.push(Number(sellerUserId));
  }

  if (!hasCalendarGlobalScope(user)) {
    where.push(`(
      (${sellerExpression} IS NOT NULL AND ${sellerExpression} = ?)
      OR
      (${sellerExpression} IS NULL AND (ao_interaction_scope.user_id IS NOT NULL OR i.created_by = ?))
    )`);
    params.push(Number(user.id), Number(user.id));
  }

  const rows = await query(
    `SELECT i.id,
            e_latest.id AS event_id,
            e_latest.interaction_id,
            i.title AS interaction_title,
            COALESCE(e_latest.commercial_comment, i.summary) AS summary,
            i.lead_substatus_code AS lead_substatus_code,
            i.lead_required_action_code AS lead_required_action_code,
            i.lead_next_action_due_at AS lead_next_action_due_at,
            DATE_FORMAT(i.lead_next_action_due_at, '%Y-%m-%d') AS lead_next_action_due_date,
            i.primary_opportunity_id,
            po.name AS primary_opportunity_name,
            po.close_date,
            po.amount_usd,
            ${sellerExpression} AS seller_user_id,
            a.name AS account_name,
            su.full_name AS seller_user_name
     FROM interactions i
     LEFT JOIN interaction_lead_outcome_events e_latest
       ON e_latest.id = (
         SELECT e2.id
         FROM interaction_lead_outcome_events e2
         WHERE e2.interaction_id = i.id
         ORDER BY e2.created_at DESC, e2.id DESC
         LIMIT 1
       )
     LEFT JOIN opportunities po ON po.id = i.primary_opportunity_id
     LEFT JOIN accounts a ON a.id = COALESCE(i.account_id, po.account_id)
     LEFT JOIN users su ON su.id = ${sellerExpression}
     ${accessJoin}
     WHERE ${where.join(" AND ")}
     ORDER BY i.lead_next_action_due_at ASC, i.id ASC`,
    params,
  ).catch(() => []);

  return rows.map((row) => mapLeadFollowUpCalendarItem(row, timeZone));
}

async function listCalendarCompletedLeadOutcomeHistory({
  user,
  startDateTime,
  endExclusiveDateTime,
  sellerUserId = null,
  year = null,
  quarter = null,
  timeZone = BUSINESS_TIMEZONE,
}) {
  const params = [];
  const accessJoin = hasCalendarGlobalScope(user)
    ? ""
    : "LEFT JOIN account_owners ao_interaction_scope ON ao_interaction_scope.account_id = i.account_id AND ao_interaction_scope.user_id = ?";
  const sellerExpression = "COALESCE(i.seller_user_id, po.seller_user_id)";
  const where = [
    `e.required_action_code IS NOT NULL`,
    `e.invalidated_at IS NULL`,
    `COALESCE(e.effective_at, e.created_at) >= ?`,
    `COALESCE(e.effective_at, e.created_at) < ?`,
  ];

  if (!hasCalendarGlobalScope(user)) {
    params.push(Number(user.id));
  }

  params.push(startDateTime, endExclusiveDateTime);

  if (year !== null && quarter !== null) {
    const quarterRange = getQuarterDateRange(year, quarter);
    where.push(`po.close_date BETWEEN ? AND ?`);
    params.push(quarterRange.startDate, quarterRange.endDate);
  }

  if (Number.isInteger(Number(sellerUserId)) && Number(sellerUserId) > 0) {
    where.push(`${sellerExpression} = ?`);
    params.push(Number(sellerUserId));
  }

  if (!hasCalendarGlobalScope(user)) {
    where.push(`(
      (${sellerExpression} IS NOT NULL AND ${sellerExpression} = ?)
      OR
      (${sellerExpression} IS NULL AND (ao_interaction_scope.user_id IS NOT NULL OR i.created_by = ?))
    )`);
    params.push(Number(user.id), Number(user.id));
  }

  const rows = await query(
    `SELECT i.id,
            e.id AS event_id,
            e.interaction_id,
            i.title AS interaction_title,
            COALESCE(e.commercial_comment, i.summary) AS summary,
            e.substatus_code AS lead_substatus_code,
            e.required_action_code AS lead_required_action_code,
            e.effective_at AS event_effective_at,
            e.created_at AS event_created_at,
            i.primary_opportunity_id,
            po.name AS primary_opportunity_name,
            po.close_date,
            po.amount_usd,
            ${sellerExpression} AS seller_user_id,
            a.name AS account_name,
            su.full_name AS seller_user_name
     FROM interaction_lead_outcome_events e
     INNER JOIN interactions i ON i.id = e.interaction_id
     LEFT JOIN opportunities po ON po.id = i.primary_opportunity_id
     LEFT JOIN accounts a ON a.id = COALESCE(i.account_id, po.account_id)
     LEFT JOIN users su ON su.id = ${sellerExpression}
     ${accessJoin}
     WHERE ${where.join(" AND ")}
     ORDER BY COALESCE(e.effective_at, e.created_at) ASC, e.id ASC`,
    params,
  ).catch(() => []);

  return rows.map((row) => mapCompletedLeadOutcomeCalendarItem(row, timeZone));
}

function buildCommercialActivitySummary(actions) {
  const timelineItems = (actions || [])
    .filter((action) => COMMERCIAL_TIMELINE_ACTION_TYPES.has(action.actionType))
    .map(mapCommercialTimelineEntry);

  const activityItems = timelineItems.filter(
    (item) => item.entryKind === "activity",
  );
  const actionItems = timelineItems.filter(
    (item) => item.entryKind === "action",
  );

  const nextScheduledActivity =
    [...activityItems]
      .filter((action) => isCommercialEntryOpen(action))
      .sort(
        (left, right) => getActionTimestamp(left) - getActionTimestamp(right),
      )[0] || null;

  const nextPendingAction =
    [...actionItems]
      .filter((action) => isCommercialEntryOpen(action))
      .sort(
        (left, right) => getActionTimestamp(left) - getActionTimestamp(right),
      )[0] || null;

  const lastCompletedActivity =
    [...activityItems]
      .filter((action) => action.status === "done")
      .sort(
        (left, right) => getActionTimestamp(right) - getActionTimestamp(left),
      )[0] || null;

  const recentActivities = [...activityItems]
    .sort((left, right) => getActionTimestamp(right) - getActionTimestamp(left))
    .slice(0, 5);

  const recentTimeline = [...timelineItems]
    .sort((left, right) => getActionTimestamp(right) - getActionTimestamp(left))
    .slice(0, 8);

  return {
    activityCount: activityItems.length,
    actionCount: actionItems.length,
    nextScheduledActivity,
    nextPendingAction,
    lastCompletedActivity,
    recentActivities,
    recentTimeline,
  };
}

function buildNextStepQualitySummary({
  nextStep,
  dependencies,
  daysSinceActivity,
  slaDays,
}) {
  const signals = [];
  const gaps = [];
  let score = 0;

  if (!nextStep) {
    gaps.push("No hay siguiente paso operativo vigente");
  } else {
    score += 40;
    signals.push("Existe siguiente paso activo");

    if (nextStep.dueDate) {
      score += 14;
      signals.push("Incluye fecha compromiso");
    } else {
      gaps.push("Falta fecha concreta del siguiente paso");
    }

    if (nextStep.successCriteria) {
      score += 14;
      signals.push("Incluye criterio de exito");
    } else {
      gaps.push("Falta criterio de exito verificable");
    }

    if (nextStep.ownerUserId) {
      score += 10;
      signals.push("Tiene responsable asignado");
    } else {
      gaps.push("Falta responsable explicito del siguiente paso");
    }

    if (nextStep.isOverdue) {
      gaps.push("El siguiente paso esta vencido");
      score -= 12;
    } else {
      score += 8;
      signals.push("El siguiente paso no esta vencido");
    }
  }

  if (daysSinceActivity <= slaDays) {
    score += 8;
    signals.push("Actividad reciente dentro del SLA");
  } else {
    gaps.push(`Inactividad sobre SLA (${daysSinceActivity} dias)`);
  }

  const overdueDependencies = (dependencies || []).filter(
    (dependency) => dependency?.isOverdue,
  ).length;
  if (overdueDependencies > 0) {
    score -= Math.min(14, overdueDependencies * 5);
    gaps.push(`${overdueDependencies} dependencia(s) vencida(s)`);
  }

  const boundedScore = Math.max(0, Math.min(100, Math.round(score)));
  const label =
    boundedScore >= 75
      ? "strong"
      : boundedScore >= 50
        ? "workable"
        : boundedScore >= 30
          ? "fragile"
          : "critical";

  return {
    score: boundedScore,
    label,
    signals: signals.slice(0, 4),
    gaps: gaps.slice(0, 4),
  };
}

function inferDecisionStageGap({ scorecardItems, riskReasons, dependencies }) {
  const redLabels = (Array.isArray(scorecardItems) ? scorecardItems : [])
    .filter((item) => String(item?.tone || "").toLowerCase() === "red")
    .map((item) => String(item?.label || "").toLowerCase());
  const riskText = (Array.isArray(riskReasons) ? riskReasons : [])
    .map((reason) => String(reason || "").toLowerCase())
    .join(" ");
  const openDependencyCount = (
    Array.isArray(dependencies) ? dependencies : []
  ).filter((dependency) =>
    ["open", "blocked"].includes(dependency?.status),
  ).length;

  const candidates = [
    {
      key: "budget_alignment",
      matches:
        redLabels.some((label) => label.includes("presupuesto")) ||
        /presupuesto|inversion|precio|costo|roi/.test(riskText),
      guidance: "Validar viabilidad economica, rango y condicion de decision",
    },
    {
      key: "decision_access",
      matches:
        redLabels.some((label) => label.includes("decisor")) ||
        /decisor|sponsor|aprobador|compra/.test(riskText),
      guidance: "Asegurar acceso al sponsor y decisor economico",
    },
    {
      key: "urgency_strength",
      matches:
        redLabels.some((label) => label.includes("urgencia")) ||
        /urgencia|no decision|sin prioridad|enfri/.test(riskText),
      guidance: "Construir urgencia y costo de no actuar",
    },
    {
      key: "execution_blockers",
      matches:
        openDependencyCount > 0 || /bloqueo|dependenc|intern/.test(riskText),
      guidance: "Destrabar dependencias internas que frenan el avance",
    },
  ];

  const active = candidates.filter((candidate) => candidate.matches);
  const primary = active[0]?.key || "next_step_quality";
  const secondary = active.slice(1).map((candidate) => candidate.key);
  const guidance =
    active[0]?.guidance ||
    "Asegurar siguiente paso claro con decisor, fecha y evidencia de avance";

  return {
    primaryGap: primary,
    secondaryGaps: secondary.slice(0, 3),
    guidance,
  };
}

function buildNarrativeMilestones({ activitySummary, dependencies, nextStep }) {
  const timelineMilestones = (activitySummary?.recentTimeline || [])
    .slice(0, 3)
    .map((entry) => ({
      type: entry.entryKind || "activity",
      title: String(entry.title || "Actividad reciente"),
      status: String(entry.status || "pending"),
      happenedAt:
        entry.scheduledAt ||
        entry.dueDate ||
        entry.updatedAt ||
        entry.createdAt ||
        null,
      summary:
        String(entry.successCriteria || "").trim() ||
        String(entry.note || "").trim() ||
        "Sin resumen operativo",
    }));

  const dependencyMilestones = (dependencies || [])
    .filter((dependency) => dependency?.isOverdue)
    .slice(0, 2)
    .map((dependency) => ({
      type: "dependency",
      title: dependency.title || "Dependencia vencida",
      status: dependency.status || "open",
      happenedAt: dependency.dueDate || dependency.updatedAt || null,
      summary:
        dependency.expectedOutcome ||
        `${dependency.dependencyLabel || "Dependencia"} pendiente`,
    }));

  const nextStepMilestone = nextStep
    ? [
        {
          type: "next_step",
          title: nextStep.title || "Siguiente paso",
          status: nextStep.status || "pending",
          happenedAt: nextStep.dueDate || nextStep.scheduledAt || null,
          summary:
            nextStep.successCriteria || "Sin criterio de exito documentado",
        },
      ]
    : [];

  return [...nextStepMilestone, ...timelineMilestones, ...dependencyMilestones]
    .slice(0, 5)
    .map((milestone) => ({
      ...milestone,
      happenedAt: milestone.happenedAt || null,
    }));
}

const actionTypes = Array.from(COMMERCIAL_ACTIVITY_ACTION_TYPES);

function mapDependencyRow(row) {
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    dependencyType: row.dependency_type,
    dependencyLabel: getDependencyTypeLabel(row.dependency_type),
    title: row.title,
    status: row.status,
    ownerUserId: row.owner_user_id === null ? null : Number(row.owner_user_id),
    ownerUserName: row.owner_user_name || "",
    dueDate: row.due_date,
    expectedOutcome: row.expected_outcome || "",
    details: row.details || "",
    resolutionNote: row.resolution_note || "",
    isOverdue: Boolean(row.due_date && getDiffDays(row.due_date) > 0),
    updatedAt: row.updated_at,
  };
}

function getUniqueTexts(values, limit = 4) {
  return Array.from(
    new Set(
      (values || []).map((value) => String(value || "").trim()).filter(Boolean),
    ),
  ).slice(0, limit);
}

function determineCadenceType(opportunityItem) {
  const openDependencies = (opportunityItem.dependencies || []).filter(
    (dependency) =>
      dependency.status === "open" || dependency.status === "blocked",
  );
  const overdueDependencies = openDependencies.filter(
    (dependency) => dependency.isOverdue,
  );
  if (
    overdueDependencies.length > 0 ||
    opportunityItem.daysSinceActivity >= opportunityItem.slaDays + 2 ||
    (!opportunityItem.nextStep &&
      opportunityItem.daysSinceActivity > opportunityItem.slaDays)
  ) {
    return "rescue_inactive";
  }
  if (
    LATE_STAGE_CODES.has(opportunityItem.stageCode) ||
    opportunityItem.nextStep?.actionType === "waiting_customer"
  ) {
    return "proposal_conversion";
  }
  return "discovery_push";
}

function buildCadenceSuggestionAssessment(opportunityItem) {
  const reasons = [];
  const protectiveSignals = [];
  const openDependencies = (opportunityItem.dependencies || []).filter(
    (dependency) =>
      dependency.status === "open" || dependency.status === "blocked",
  );
  const overdueDependencies = openDependencies.filter(
    (dependency) => dependency.isOverdue,
  );
  const nextStep = opportunityItem.nextStep;

  let score = 0;
  if (!nextStep) {
    score += 50;
    reasons.push("Sin proximo paso vigente");
  }
  if (nextStep?.isOverdue) {
    score += 28;
    reasons.push("Proximo paso vencido");
  }
  if (opportunityItem.daysSinceActivity > opportunityItem.slaDays + 4) {
    score += 24;
    reasons.push(
      `Inactividad severa: ${opportunityItem.daysSinceActivity} dias sin movimiento`,
    );
  } else if (opportunityItem.daysSinceActivity > opportunityItem.slaDays + 2) {
    score += 20;
    reasons.push(
      `Inactividad alta: ${opportunityItem.daysSinceActivity} dias sin movimiento`,
    );
  } else if (opportunityItem.daysSinceActivity > opportunityItem.slaDays) {
    score += 14;
    reasons.push(`SLA vencido en etapa ${opportunityItem.stageName}`);
  }
  if (openDependencies.length > 0) {
    score += Math.min(12, openDependencies.length * 4);
    reasons.push(
      `${openDependencies.length} dependencia(s) interna(s) abierta(s)`,
    );
  }
  if (overdueDependencies.length > 0) {
    score += Math.min(20, overdueDependencies.length * 10);
    reasons.push(
      `${overdueDependencies.length} dependencia(s) interna(s) vencida(s)`,
    );
  }
  if (nextStep?.actionType === "waiting_customer") {
    score += 10;
    reasons.push("Respuesta del cliente pendiente de cierre");
  }
  if (opportunityItem.riskLevel === "high") {
    score += 16;
    reasons.push("Riesgo operativo alto");
  } else if (opportunityItem.riskLevel === "medium") {
    score += 10;
    reasons.push("Riesgo operativo medio");
  }
  if (opportunityItem.criticalWeaknessCount > 0) {
    score += Math.min(14, opportunityItem.criticalWeaknessCount * 7);
    reasons.push(
      `${opportunityItem.criticalWeaknessCount} debilidad(es) critica(s) abierta(s)`,
    );
  }
  if (opportunityItem.decisionRiskTone === "red") {
    score += 10;
    reasons.push("Riesgo de decision o sponsor insuficiente");
  }
  if (LATE_STAGE_CODES.has(opportunityItem.stageCode)) {
    score += 6;
  }

  let nextStepProtection = 0;
  if (nextStep && !nextStep.isOverdue) {
    nextStepProtection += 12;
    protectiveSignals.push("Tiene siguiente paso vigente");
    if (nextStep.dueDate) {
      nextStepProtection += 8;
      protectiveSignals.push("Tiene fecha de seguimiento confirmada");
    }
    if (nextStep.successCriteria?.trim()) {
      nextStepProtection += 8;
      protectiveSignals.push("Tiene criterio de exito definido");
    }
    if (nextStep.ownerUserId) {
      nextStepProtection += 6;
      protectiveSignals.push("Tiene responsable asignado");
    }
  }
  if (
    opportunityItem.daysSinceActivity <=
    Math.max(1, Math.floor(opportunityItem.slaDays / 2))
  ) {
    nextStepProtection += 8;
    protectiveSignals.push("Tiene actividad comercial reciente");
  }

  const boundedScore = Math.max(
    0,
    Math.min(100, score - Math.min(34, nextStepProtection)),
  );
  const cadenceDecision =
    boundedScore >= 70 ? "activate" : boundedScore >= 50 ? "watch" : "none";

  return {
    frictionScore: boundedScore,
    cadenceDecision,
    frictionReasons: getUniqueTexts(
      [...reasons, ...(opportunityItem.riskReasons || [])],
      4,
    ),
    protectiveSignals: getUniqueTexts(protectiveSignals, 3),
    hasGoodNextStep: nextStepProtection >= 28,
  };
}

function buildRiskSummary({
  workspace,
  nextStep,
  dependencies,
  daysSinceActivity,
  slaDays,
}) {
  const reasons = [];
  const criticalWeaknesses = (workspace?.weaknesses || []).filter(
    (weakness) => weakness.tone === "critical" || weakness.tone === "red",
  );
  const openDependencies = dependencies.filter(
    (dependency) =>
      dependency.status === "open" || dependency.status === "blocked",
  );
  const overdueDependencies = openDependencies.filter(
    (dependency) => dependency.isOverdue,
  );

  if (!nextStep) {
    reasons.push("Sin proximo paso comprometido");
  }
  if (nextStep?.isOverdue) {
    reasons.push("Proximo paso vencido");
  }
  if (daysSinceActivity > slaDays) {
    reasons.push(`Inactividad mayor al SLA de ${slaDays} dias`);
  }
  if (nextStep?.actionType === "waiting_customer") {
    reasons.push("Esperando respuesta del cliente sin cierre confirmado");
  }
  if (openDependencies.length > 0) {
    reasons.push(
      `${openDependencies.length} dependencia(s) interna(s) abierta(s)`,
    );
  }
  if (overdueDependencies.length > 0) {
    reasons.push(
      `${overdueDependencies.length} dependencia(s) interna(s) vencida(s)`,
    );
  }
  if (criticalWeaknesses.length > 0) {
    reasons.push(
      `${criticalWeaknesses.length} debilidad(es) critica(s) abierta(s)`,
    );
  }
  if (workspace?.scorecard?.signals?.decisionRisk?.tone === "red") {
    reasons.push("Riesgo alto de decision o sponsor insuficiente");
  }

  let level = "low";
  if (reasons.length >= 3) {
    level = "high";
  } else if (reasons.length >= 1) {
    level = "medium";
  }

  return {
    level,
    reasons,
    criticalWeaknessCount: criticalWeaknesses.length,
  };
}

function buildSuggestedCadence(opportunityItem, activeCadenceByOpportunity) {
  if (activeCadenceByOpportunity.has(opportunityItem.id)) {
    return null;
  }

  const assessment = buildCadenceSuggestionAssessment(opportunityItem);
  if (assessment.cadenceDecision === "none") {
    return null;
  }

  const cadenceType = determineCadenceType(opportunityItem);
  const cadence = CADENCE_LIBRARY[cadenceType];
  if (!cadence) {
    return null;
  }

  return {
    cadenceType,
    title: cadence.title,
    description: cadence.description,
    steps: cadence.steps,
    opportunityId: opportunityItem.id,
    opportunityName: opportunityItem.name,
    accountName: opportunityItem.accountName,
    sellerUserName: opportunityItem.sellerUserName,
    frictionScore: assessment.frictionScore,
    cadenceDecision: assessment.cadenceDecision,
    frictionReasons: assessment.frictionReasons,
    protectiveSignals: assessment.protectiveSignals,
    hasGoodNextStep: assessment.hasGoodNextStep,
  };
}

function deriveExecutionState({
  nextStep,
  dependencies,
  risk,
  daysSinceActivity,
  slaDays,
}) {
  const hasOpenDependencies = dependencies.some(
    (dependency) =>
      dependency.status === "open" || dependency.status === "blocked",
  );
  const hasOverdueDependencies = dependencies.some(
    (dependency) => dependency.isOverdue,
  );

  if (!nextStep) {
    return {
      code: "sin_conduccion",
      label: "Sin conduccion",
      summary:
        "La oportunidad sigue activa pero no tiene siguiente paso vigente.",
    };
  }
  if (nextStep.isOverdue) {
    return {
      code: "vencida",
      label: "Vencida",
      summary:
        "El siguiente paso ya vencio y la oportunidad requiere reaccion inmediata.",
    };
  }
  if (hasOverdueDependencies) {
    return {
      code: "bloqueada",
      label: "Bloqueada",
      summary:
        "Hay dependencias internas vencidas que estan frenando el avance.",
    };
  }
  if (hasOpenDependencies) {
    return {
      code: "esperando_interno",
      label: "Esperando interno",
      summary: "El avance depende de un compromiso interno aun abierto.",
    };
  }
  if (nextStep.actionType === "waiting_customer") {
    return {
      code: "esperando_cliente",
      label: "Esperando cliente",
      summary:
        "Existe siguiente paso definido, pero la respuesta pendiente la tiene el cliente.",
    };
  }
  if (risk.level !== "low" || daysSinceActivity > slaDays) {
    return {
      code: "en_riesgo",
      label: "En riesgo",
      summary:
        "La oportunidad mantiene conduccion, pero ya muestra señales de deterioro operativo.",
    };
  }

  return {
    code: "en_ritmo",
    label: "En ritmo",
    summary:
      "La oportunidad tiene siguiente paso vigente y no presenta bloqueos operativos criticos.",
  };
}

function buildExecutionReminders({
  opportunityItem,
  nextStep,
  dependencies,
  risk,
}) {
  const reminders = [];

  if (!nextStep) {
    reminders.push({
      tone: "high",
      title: "Definir siguiente paso",
      detail:
        "La oportunidad no deberia permanecer activa sin compromiso y fecha cerrada.",
    });
  }
  if (nextStep?.isOverdue) {
    reminders.push({
      tone: "high",
      title: "Seguimiento vencido",
      detail: `El siguiente paso vencio y ya acumula ${getDiffDays(nextStep.dueDate)} dia(s) fuera de fecha.`,
    });
  }
  if (nextStep?.actionType === "waiting_customer") {
    reminders.push({
      tone: "medium",
      title: "Cliente pendiente de responder",
      detail:
        "Conviene proteger el deal con una fecha de decision o una reunion de cierre.",
    });
  }
  if (opportunityItem.daysSinceActivity > opportunityItem.slaDays) {
    reminders.push({
      tone: "high",
      title: "SLA comercial vencido",
      detail: `La oportunidad lleva ${opportunityItem.daysSinceActivity} dias sin traccion y supera el SLA de ${opportunityItem.slaDays} dias.`,
    });
  }

  dependencies
    .filter((dependency) => !dependency.isOverdue)
    .slice(0, 1)
    .forEach((dependency) => {
      reminders.push({
        tone: "medium",
        title: `Dependencia interna abierta: ${dependency.dependencyLabel}`,
        detail: dependency.title,
      });
    });

  dependencies
    .filter((dependency) => dependency.isOverdue)
    .slice(0, 2)
    .forEach((dependency) => {
      reminders.push({
        tone: "high",
        title: `Dependencia interna vencida: ${dependency.dependencyLabel}`,
        detail: dependency.title,
      });
    });

  risk.reasons.slice(0, 2).forEach((reason) => {
    reminders.push({
      tone: risk.level === "high" ? "high" : "medium",
      title: "Alerta operativa",
      detail: reason,
    });
  });

  return reminders.slice(0, 5);
}

function mapCadenceRow(row, opportunitiesById) {
  const opportunity = opportunitiesById.get(Number(row.opportunity_id));
  const steps = normalizeJsonArray(row.steps_json);
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    opportunityName: opportunity?.name || "Oportunidad",
    accountName: opportunity?.accountName || "",
    cadenceType: row.cadence_type,
    title: row.title,
    status: row.status,
    ownerUserId: row.owner_user_id === null ? null : Number(row.owner_user_id),
    ownerUserName: row.owner_user_name || "",
    currentStepIndex: Number(row.current_step_index || 0),
    currentStepLabel:
      steps[Number(row.current_step_index || 0)] || steps[0] || "",
    steps,
    nextRunAt: row.next_run_at,
    lastExecutedAt: row.last_executed_at,
    notes: row.notes || "",
  };
}

async function loadOpportunityForExecution(user, opportunityId) {
  const ownershipParams = [];
  const ownershipJoin = buildOwnershipJoin(user, ownershipParams);
  const params = hasGlobalOpportunityScope(user)
    ? [opportunityId]
    : [Number(user.id), opportunityId, Number(user.id)];

  const rows = await query(
    `SELECT o.id, o.account_id, o.name, o.amount_usd, o.close_date, o.sales_stage_id,
            o.commercial_status_id, o.seller_user_id, o.updated_at,
            a.name AS account_name,
            oss.code AS sales_stage_code,
            oss.name AS sales_stage_name,
            oss.stage_order,
            ocs.code AS commercial_status_code,
            ocs.name AS commercial_status_name,
          su.full_name AS seller_user_name,
          su.email AS seller_user_email
     FROM opportunities o
     ${ownershipJoin}
     INNER JOIN accounts a ON a.id = o.account_id
     INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
     INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
     LEFT JOIN users su ON su.id = o.seller_user_id
     WHERE o.id = ?
       ${hasGlobalOpportunityScope(user) ? "" : "AND (ao_scope.user_id IS NOT NULL OR o.created_by = ?)"}`,
    hasGlobalOpportunityScope(user)
      ? params
      : [...ownershipParams, ...params.slice(1)],
  );

  return rows[0] || null;
}

async function loadDependencyForExecution(user, dependencyId) {
  const rows = await query(
    `SELECT d.id, d.opportunity_id
     FROM commercial_execution_dependencies d
     WHERE d.id = ?
     LIMIT 1`,
    [dependencyId],
  );
  if (!rows[0]) {
    return null;
  }

  const opportunity = await loadOpportunityForExecution(
    user,
    Number(rows[0].opportunity_id),
  );
  if (!opportunity) {
    return null;
  }

  return rows[0];
}

async function saveExecutionDependency({
  dependencyId = null,
  opportunityId,
  payload,
  userId,
}) {
  const allowedColumns = [
    "dependency_type",
    "title",
    "status",
    "owner_user_id",
    "due_date",
    "expected_outcome",
    "details",
    "resolution_note",
    "updated_by_user_id",
  ];
  const entries = Object.entries({
    ...payload,
    updated_by_user_id: userId,
  }).filter(([key]) => allowedColumns.includes(key));

  if (dependencyId) {
    const setClause = entries.map(([key]) => `${key} = ?`).join(", ");
    await query(
      `UPDATE commercial_execution_dependencies
       SET ${setClause}, updated_at = NOW(3)
       WHERE id = ?`,
      [...entries.map((entry) => entry[1]), dependencyId],
    );
    return Number(dependencyId);
  }

  const columns = [
    "opportunity_id",
    "created_by_user_id",
    "updated_by_user_id",
    ...entries
      .map(([key]) => key)
      .filter((key) => key !== "updated_by_user_id"),
  ];
  const values = [
    opportunityId,
    userId,
    userId,
    ...entries
      .filter(([key]) => key !== "updated_by_user_id")
      .map((entry) => entry[1]),
  ];
  const placeholders = columns.map(() => "?").join(", ");
  const result = await query(
    `INSERT INTO commercial_execution_dependencies (${columns.join(", ")}) VALUES (${placeholders})`,
    values,
  );
  return Number(result.insertId);
}

async function findOpenNextStepAction(opportunityId) {
  const rows = await query(
    `SELECT id
     FROM opportunity_workspace_actions
     WHERE opportunity_id = ?
       AND action_type = 'next_step'
       AND status IN ('pending', 'in_progress', 'blocked')
     ORDER BY due_date IS NULL ASC, due_date ASC, id ASC
     LIMIT 1`,
    [opportunityId],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

async function clearPrimaryNextStepActions(
  opportunityId,
  excludeActionId = null,
) {
  const params = [opportunityId];
  let whereClause = "opportunity_id = ? AND is_primary_next_step = 1";
  if (excludeActionId) {
    whereClause += " AND id <> ?";
    params.push(Number(excludeActionId));
  }

  await query(
    `UPDATE opportunity_workspace_actions
     SET is_primary_next_step = 0,
         updated_at = NOW(3)
     WHERE ${whereClause}`,
    params,
  );
}

async function loadCommercialActivityAction(opportunityId, actionId) {
  const actionTypes = Array.from(COMMERCIAL_TIMELINE_ACTION_TYPES);
  const rows = await query(
    `SELECT id, opportunity_id, action_type, status, title, notes, scheduled_at,
            due_date, owner_user_id, linked_stage_id, is_primary_next_step,
            priority, success_criteria, details_json
     FROM opportunity_workspace_actions
     WHERE id = ?
       AND opportunity_id = ?
       AND action_type IN (${actionTypes.map(() => "?").join(", ")})
     LIMIT 1`,
    [actionId, opportunityId, ...actionTypes],
  );

  return rows[0] || null;
}

function parseCommercialActionDetails(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeCommercialEmailDraft(details = {}) {
  const normalizedPurpose = String(details.purpose || "proposal").trim();
  const normalizedPurposeOther = String(details.purposeOther || "").trim();
  const hasKnownPurpose = new Set([
    "proposal",
    "request_information",
    "other",
  ]).has(normalizedPurpose);
  return {
    recipient: String(details.recipient || "").trim(),
    cc: String(details.cc || "").trim(),
    subject: String(details.subject || "").trim(),
    purpose: hasKnownPurpose
      ? normalizedPurpose || "proposal"
      : normalizedPurpose
        ? "other"
        : "proposal",
    purposeOther: hasKnownPurpose
      ? normalizedPurposeOther
      : normalizedPurposeOther || normalizedPurpose,
    aiInstructionText: String(details.aiInstructionText || "").trim(),
    messageBody: String(details.messageBody || "").trim(),
    attachmentsNote: String(details.attachmentsNote || "").trim(),
    attachments: Array.isArray(details.attachments)
      ? details.attachments
          .map((attachment) => normalizeCommercialEmailAttachment(attachment))
          .filter(Boolean)
      : [],
    expectedResponse: String(details.expectedResponse || "").trim(),
    responseDueDate: String(details.responseDueDate || "").trim(),
    markDoneOnSend: Boolean(details.markDoneOnSend),
    sentAt: details.sentAt ? String(details.sentAt) : "",
    sentByUserId: details.sentByUserId ? Number(details.sentByUserId) : null,
    sentByUserName: details.sentByUserName
      ? String(details.sentByUserName)
      : "",
    lastSendStatus: details.lastSendStatus
      ? String(details.lastSendStatus)
      : "",
    lastSendError: details.lastSendError ? String(details.lastSendError) : "",
    lastDraftSavedAt: details.lastDraftSavedAt
      ? String(details.lastDraftSavedAt)
      : "",
    lastDraftSavedByUserId: details.lastDraftSavedByUserId
      ? Number(details.lastDraftSavedByUserId)
      : null,
    lastDraftSavedByUserName: details.lastDraftSavedByUserName
      ? String(details.lastDraftSavedByUserName)
      : "",
    lastRecipientSnapshot: details.lastRecipientSnapshot
      ? String(details.lastRecipientSnapshot)
      : "",
    lastSubjectSnapshot: details.lastSubjectSnapshot
      ? String(details.lastSubjectSnapshot)
      : "",
    replyToEmail: details.replyToEmail ? String(details.replyToEmail) : "",
  };
}

function normalizeCommercialEmailAttachment(attachment = {}) {
  const sourceType = String(attachment.sourceType || "").trim();
  if (!sourceType) {
    return null;
  }

  const normalized = {
    id:
      String(attachment.id || "").trim() ||
      `${sourceType}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    sourceType,
    sourceLabel: String(attachment.sourceLabel || "").trim(),
    fileName: String(attachment.fileName || "").trim(),
    mimeType: String(attachment.mimeType || "")
      .trim()
      .toLowerCase(),
    byteSize:
      attachment.byteSize === null || attachment.byteSize === undefined
        ? null
        : Number(attachment.byteSize),
    resourcePublicId: String(attachment.resourcePublicId || "").trim(),
    filePublicId: String(attachment.filePublicId || "").trim(),
    documentPublicId: String(attachment.documentPublicId || "").trim(),
    quotationId: attachment.quotationId ? Number(attachment.quotationId) : null,
    quotationVersionId: attachment.quotationVersionId
      ? Number(attachment.quotationVersionId)
      : null,
    proposalName: String(attachment.proposalName || "").trim(),
    title: String(attachment.title || "").trim(),
    summary: String(attachment.summary || "").trim(),
    assetTypeLabel: String(attachment.assetTypeLabel || "").trim(),
  };

  if (normalized.sourceType === "library_file") {
    return normalized.resourcePublicId && normalized.filePublicId
      ? normalized
      : null;
  }

  if (normalized.sourceType === "opportunity_document") {
    return normalized.documentPublicId ? normalized : null;
  }

  if (normalized.sourceType === "quotation_pdf") {
    return normalized.quotationVersionId ? normalized : null;
  }

  return null;
}

function getCommercialEmailAttachmentNames(details = {}) {
  const attachments = Array.isArray(details.attachments)
    ? details.attachments
    : [];
  const names = attachments
    .map((attachment) =>
      String(attachment?.fileName || attachment?.proposalName || "").trim(),
    )
    .filter(Boolean);
  if (names.length) {
    return names;
  }
  const legacyNote = String(details.attachmentsNote || "").trim();
  return legacyNote ? [legacyNote] : [];
}

function getCommercialEmailAttachmentsSummary(details = {}) {
  return getCommercialEmailAttachmentNames(details).join(", ");
}

function isCommercialEmailAttachmentMimeTypeAllowed(mimeType) {
  const normalizedMimeType = String(mimeType || "")
    .trim()
    .toLowerCase();
  return COMMERCIAL_EMAIL_ALLOWED_ATTACHMENT_MIME_TYPES.has(normalizedMimeType);
}

function validateCommercialEmailAttachments(attachments = []) {
  if (attachments.length > COMMERCIAL_EMAIL_ATTACHMENT_MAX_FILES) {
    return `Solo puedes incluir hasta ${COMMERCIAL_EMAIL_ATTACHMENT_MAX_FILES} documentos por correo.`;
  }

  const invalidAttachment = attachments.find((attachment) => {
    if (
      attachment?.mimeType &&
      !isCommercialEmailAttachmentMimeTypeAllowed(attachment.mimeType)
    ) {
      return true;
    }
    return false;
  });

  if (invalidAttachment) {
    return `El archivo ${invalidAttachment.fileName || "seleccionado"} no tiene un tipo permitido para envio.`;
  }

  const knownTotalBytes = attachments.reduce(
    (total, attachment) => total + Number(attachment?.byteSize || 0),
    0,
  );
  if (
    knownTotalBytes > 0 &&
    knownTotalBytes > COMMERCIAL_EMAIL_ATTACHMENT_MAX_TOTAL_BYTES
  ) {
    return "El tamaño total de adjuntos supera el límite permitido para el correo.";
  }

  return "";
}

async function loadCommercialEmailAttachmentOptions({
  user,
  opportunityId,
  libraryFilters = {},
}) {
  const [allLibraryFiles, quotationVersions] = await Promise.all([
    listCommercialLibraryFilesForEmailShared({ user }),
    listCommercialQuotationVersionsForEmail({ opportunityId }),
  ]);

  const libraryCatalogs =
    buildCommercialLibraryAttachmentCatalogs(allLibraryFiles);
  const filteredLibraryFiles = filterCommercialLibraryFiles(
    allLibraryFiles,
    libraryFilters,
  );
  const sortedLibraryFiles = sortCommercialLibraryFiles(
    filteredLibraryFiles,
    libraryFilters.sort,
  );

  return {
    libraryFiles: sortedLibraryFiles,
    libraryCatalogs,
    appliedLibraryFilters: normalizeCommercialLibraryFilters(libraryFilters),
    libraryStats: {
      totalAvailable: allLibraryFiles.length,
      totalMatching: sortedLibraryFiles.length,
    },
    quotationVersions,
    constraints: {
      maxFiles: COMMERCIAL_EMAIL_ATTACHMENT_MAX_FILES,
      maxTotalBytes: COMMERCIAL_EMAIL_ATTACHMENT_MAX_TOTAL_BYTES,
      allowedMimeTypes: Array.from(
        COMMERCIAL_EMAIL_ALLOWED_ATTACHMENT_MIME_TYPES,
      ),
    },
  };
}

function normalizeCommercialLibraryFilters(filters = {}) {
  const normalizeArray = (value) => {
    if (Array.isArray(value)) {
      return value.map((entry) => String(entry || "").trim()).filter(Boolean);
    }
    return String(value || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  };

  return {
    q: String(filters?.q || "").trim(),
    manufacturerCodes: normalizeArray(filters?.manufacturerCodes),
    solutionCodes: normalizeArray(filters?.solutionCodes),
    industryCodes: normalizeArray(filters?.industryCodes),
    sort: String(filters?.sort || "updated_desc").trim() || "updated_desc",
  };
}

function buildCommercialLibraryAttachmentCatalogs(libraryFiles) {
  const buildCatalog = (catalogType) => {
    const byCode = new Map();
    libraryFiles.forEach((file) => {
      const info = getCommercialAttachmentCatalogInfo(file, catalogType);
      info.codes.forEach((code, index) => {
        const normalizedCode = String(code || "").trim();
        if (!normalizedCode || byCode.has(normalizedCode)) return;
        byCode.set(normalizedCode, {
          code: normalizedCode,
          label:
            String(info.labels[index] || normalizedCode).trim() ||
            normalizedCode,
        });
      });
    });
    return Array.from(byCode.values()).sort((left, right) =>
      left.label.localeCompare(right.label, "es"),
    );
  };

  return {
    manufacturer: buildCatalog("manufacturer"),
    solution: buildCatalog("solution"),
    industry: buildCatalog("industry"),
  };
}

function getCommercialAttachmentCatalogInfo(file, catalogType) {
  if (catalogType === "manufacturer") {
    return {
      codes: Array.isArray(file?.manufacturerCodes)
        ? file.manufacturerCodes
        : [],
      labels: Array.isArray(file?.manufacturerLabels)
        ? file.manufacturerLabels
        : [],
    };
  }
  if (catalogType === "solution") {
    return {
      codes: Array.isArray(file?.solutionCodes) ? file.solutionCodes : [],
      labels: Array.isArray(file?.solutionLabels) ? file.solutionLabels : [],
    };
  }
  if (catalogType === "industry") {
    return {
      codes: Array.isArray(file?.industryCodes) ? file.industryCodes : [],
      labels: Array.isArray(file?.industryLabels) ? file.industryLabels : [],
    };
  }
  return { codes: [], labels: [] };
}

function buildCommercialLibraryAttachmentSearchText(file) {
  return [
    file?.fileName,
    file?.title,
    file?.summary,
    file?.assetTypeLabel,
    ...(Array.isArray(file?.manufacturerLabels) ? file.manufacturerLabels : []),
    ...(Array.isArray(file?.solutionLabels) ? file.solutionLabels : []),
    ...(Array.isArray(file?.industryLabels) ? file.industryLabels : []),
  ]
    .join(" ")
    .toLowerCase();
}

function filterCommercialLibraryFiles(libraryFiles, rawFilters = {}) {
  const filters = normalizeCommercialLibraryFilters(rawFilters);
  const queryText = filters.q.toLowerCase();

  return libraryFiles.filter((file) => {
    if (
      queryText &&
      !buildCommercialLibraryAttachmentSearchText(file).includes(queryText)
    ) {
      return false;
    }
    if (
      filters.manufacturerCodes.length &&
      !filters.manufacturerCodes.some((code) =>
        getCommercialAttachmentCatalogInfo(file, "manufacturer").codes.includes(
          code,
        ),
      )
    ) {
      return false;
    }
    if (
      filters.solutionCodes.length &&
      !filters.solutionCodes.some((code) =>
        getCommercialAttachmentCatalogInfo(file, "solution").codes.includes(
          code,
        ),
      )
    ) {
      return false;
    }
    if (
      filters.industryCodes.length &&
      !filters.industryCodes.some((code) =>
        getCommercialAttachmentCatalogInfo(file, "industry").codes.includes(
          code,
        ),
      )
    ) {
      return false;
    }
    return true;
  });
}

function sortCommercialLibraryFiles(libraryFiles, sort = "updated_desc") {
  const normalizedSort =
    String(sort || "updated_desc").trim() || "updated_desc";
  const nextFiles = [...libraryFiles];

  if (normalizedSort === "title_asc") {
    return nextFiles.sort((left, right) =>
      String(left.fileName || left.title || "").localeCompare(
        String(right.fileName || right.title || ""),
        "es",
      ),
    );
  }
  if (normalizedSort === "title_desc") {
    return nextFiles.sort((left, right) =>
      String(right.fileName || right.title || "").localeCompare(
        String(left.fileName || left.title || ""),
        "es",
      ),
    );
  }
  if (normalizedSort === "updated_asc") {
    return nextFiles.sort((left, right) =>
      String(left.createdAt || "").localeCompare(String(right.createdAt || "")),
    );
  }
  return nextFiles.sort((left, right) =>
    String(right.createdAt || "").localeCompare(String(left.createdAt || "")),
  );
}

function getCommercialAttachmentCatalogMeta(asset, catalogType) {
  const entries = (Array.isArray(asset?.catalogs) ? asset.catalogs : [])
    .filter((entry) => String(entry?.catalogType || "") === catalogType)
    .map((entry) => ({
      code: String(entry?.code || "").trim(),
      label: String(entry?.name || "").trim(),
    }))
    .filter((entry) => entry.code || entry.label);

  return {
    codes: entries.map((entry) => entry.code).filter(Boolean),
    labels: entries.map((entry) => entry.label).filter(Boolean),
  };
}

async function listCommercialLibraryFilesForEmail({ user }) {
  const assetResult = await listCommercialEnablementAssets({
    user,
    filters: {
      status: "published",
      visibilityLevel: "client_safe",
      pageSize: 80,
      sort: "updated_desc",
    },
  }).catch(() => ({ items: [] }));

  const items = Array.isArray(assetResult?.items) ? assetResult.items : [];
  const details = await Promise.all(
    items.map((item) =>
      getCommercialEnablementAssetDetail({
        user,
        assetPublicId: item.publicId,
      }).catch(() => null),
    ),
  );

  return details.filter(Boolean).flatMap((asset) =>
    (asset.files || [])
      .filter(
        (file) =>
          file?.isAvailable !== false &&
          isCommercialEmailAttachmentMimeTypeAllowed(file?.mimeType),
      )
      .map((file) => {
        const manufacturer = getCommercialAttachmentCatalogMeta(
          asset,
          "manufacturer",
        );
        const solution = getCommercialAttachmentCatalogMeta(asset, "solution");
        const industry = getCommercialAttachmentCatalogMeta(asset, "industry");

        return {
          id: `library:${asset.publicId}:${file.publicId}`,
          sourceType: "library_file",
          sourceLabel: "Biblioteca",
          resourcePublicId: asset.publicId,
          filePublicId: file.publicId,
          fileName: file.originalFileName || file.storedFileName || "archivo",
          mimeType: file.mimeType || "application/octet-stream",
          byteSize:
            file.byteSize === null || file.byteSize === undefined
              ? null
              : Number(file.byteSize),
          title: asset.title || "Activo comercial",
          summary: asset.summary || "",
          assetTypeLabel: asset.assetTypeLabel || "",
          manufacturerCodes: manufacturer.codes,
          manufacturerLabels: manufacturer.labels,
          solutionCodes: solution.codes,
          solutionLabels: solution.labels,
          industryCodes: industry.codes,
          industryLabels: industry.labels,
          createdAt: file.createdAt || asset.updatedAt || asset.createdAt || "",
        };
      }),
  );
}

async function listCommercialQuotationVersionsForEmail({ opportunityId }) {
  const rows = await query(
    `SELECT q.id AS quotation_id,
            qv.id AS quotation_version_id,
            qv.version_number,
            qv.proposal_name,
            qv.quotation_date,
            qs.name AS status_name,
            qs.ui_key AS status_ui_key
     FROM quotations q
     INNER JOIN quotation_versions qv ON qv.quotation_id = q.id
     INNER JOIN quotation_statuses qs ON qs.id = qv.status_id
     WHERE q.opportunity_id = ?
     ORDER BY qv.version_number DESC, qv.id DESC`,
    [Number(opportunityId)],
  ).catch(() => []);

  return rows.map((row) => ({
    id: `quotation:${Number(row.quotation_id)}:${Number(row.quotation_version_id)}`,
    sourceType: "quotation_pdf",
    sourceLabel: "Propuesta",
    quotationId: Number(row.quotation_id),
    quotationVersionId: Number(row.quotation_version_id),
    proposalName: String(row.proposal_name || "").trim() || "Propuesta",
    fileName: `${String(row.proposal_name || "Propuesta").trim() || "Propuesta"}.pdf`,
    mimeType: "application/pdf",
    byteSize: null,
    versionNumber: Number(row.version_number || 0),
    quotationDate: row.quotation_date || "",
    statusName: row.status_name || "",
    statusUiKey: row.status_ui_key || "",
  }));
}

async function resolveCommercialEmailAttachments({
  user,
  opportunity,
  details,
}) {
  const attachments = Array.isArray(details?.attachments)
    ? details.attachments
    : [];
  if (!attachments.length) {
    return [];
  }

  const validationError = validateCommercialEmailAttachments(attachments);
  if (validationError) {
    const error = new Error(validationError);
    error.status = 400;
    throw error;
  }

  let totalBytes = 0;
  const resolvedAttachments = [];
  for (const attachment of attachments) {
    const resolved = await resolveCommercialEmailAttachment({
      opportunity,
      user,
      attachment,
    });
    totalBytes += Number(resolved.byteSize || 0);
    if (totalBytes > COMMERCIAL_EMAIL_ATTACHMENT_MAX_TOTAL_BYTES) {
      const error = new Error(
        "El tamaño total de adjuntos supera el límite permitido para el correo.",
      );
      error.status = 400;
      throw error;
    }
    resolvedAttachments.push({
      filename: resolved.fileName,
      contentType: resolved.mimeType,
      content: resolved.content,
    });
  }

  return resolvedAttachments;
}

async function resolveCommercialEmailAttachment({
  opportunity,
  user,
  attachment,
}) {
  if (attachment.sourceType === "library_file") {
    const file = await getCommercialEnablementFileStream({
      user,
      assetPublicId: attachment.resourcePublicId,
      filePublicId: attachment.filePublicId,
    });
    if (!file) {
      const error = new Error("Activo de biblioteca no encontrado");
      error.status = 404;
      throw error;
    }
    const content = await streamToBuffer(file.stream);
    return {
      fileName: attachment.fileName || file.fileName || "archivo",
      mimeType:
        attachment.mimeType || file.mimeType || "application/octet-stream",
      content,
      byteSize: content.length,
    };
  }

  if (attachment.sourceType === "opportunity_document") {
    const accessRows = await query(
      `SELECT 1
       FROM opportunity_document_links odl
       INNER JOIN documents d ON d.id = odl.document_id
       WHERE odl.opportunity_id = ?
         AND d.public_id = ?
         AND d.is_deleted = 0
       LIMIT 1`,
      [Number(opportunity.id), attachment.documentPublicId],
    );
    if (!accessRows.length) {
      const error = new Error("Documento no disponible para esta oportunidad");
      error.status = 404;
      throw error;
    }

    const result = await getDocumentContentStream({
      documentPublicId: attachment.documentPublicId,
    });
    const content = await streamToBuffer(result.stream);
    return {
      fileName:
        attachment.fileName ||
        result.document.original_file_name ||
        "documento",
      mimeType:
        attachment.mimeType ||
        result.document.mime_type ||
        "application/octet-stream",
      content,
      byteSize: content.length,
    };
  }

  if (attachment.sourceType === "quotation_pdf") {
    return buildCommercialQuotationPdfAttachment({
      opportunity,
      quotationVersionId: attachment.quotationVersionId,
      quotationId: attachment.quotationId,
      fileName: attachment.fileName,
    });
  }

  const error = new Error("Tipo de adjunto no soportado");
  error.status = 400;
  throw error;
}

async function buildCommercialQuotationPdfAttachment({
  opportunity,
  quotationVersionId,
  quotationId,
  fileName,
}) {
  const version = await loadCommercialQuotationVersionForAttachment({
    opportunityId: Number(opportunity.id),
    quotationVersionId,
    quotationId,
  });
  if (!version) {
    const error = new Error("Version de propuesta no encontrada");
    error.status = 404;
    throw error;
  }

  const [sections, company, catalogs] = await Promise.all([
    loadCommercialQuotationSectionsForAttachment(quotationVersionId),
    getCompanyDocumentBranding(),
    loadCommercialQuotationCatalogsForPdf(),
  ]);

  const printSections = buildCommercialQuotationPrintSections(sections);
  const quotationSummary = calculateCommercialQuotationSummary(printSections, {
    summaryDiscountMode: version.summary_discount_mode,
    summaryDiscountValue: version.summary_discount_value,
    summaryVatMode: version.summary_vat_mode,
    summaryVatPct: version.summary_vat_pct,
  });

  const { buffer, fileName: generatedFileName } = await buildQuotationPdfBuffer(
    {
      company,
      header: {
        quotationNumber: String(version.quotation_id || ""),
        versionNumber: String(version.version_number || ""),
        quotationDate: version.quotation_date || "",
        proposalName: version.proposal_name || "",
        accountName: version.account_name || "",
        contactName: version.contact_name || "",
        contactEmail: version.contact_email || "",
        contactPhone: version.contact_phone || "",
        sellerName: version.seller_user_name || "",
        sellerEmail: version.seller_user_email || "",
        sellerPhone: version.seller_user_phone || "",
      },
      introduction: version.introduction || "",
      sections: printSections,
      summary: {
        subtotal: quotationSummary.totalSalePriceTotal,
        discount: quotationSummary.discountAmount,
        discountedSubtotal: quotationSummary.discountedTotalAmount,
        vatAmount: quotationSummary.vatAmount,
        total:
          quotationSummary.summaryVatMode === "total"
            ? quotationSummary.totalWithVatAmount
            : quotationSummary.discountedTotalAmount,
        showVat: quotationSummary.summaryVatMode === "total",
        vatMode: quotationSummary.summaryVatMode,
        currencyCode: version.currency_code || "USD",
      },
      commercialTerms: {
        deliveryTime:
          catalogs.deliveryTimes.get(String(version.delivery_time || "")) || "",
        quotationValidity:
          catalogs.validityTerms.get(
            String(version.quotation_validity || ""),
          ) || "",
        warranty:
          catalogs.warrantyTerms.get(String(version.warranty_term || "")) || "",
        paymentTerms:
          catalogs.paymentTerms.get(String(version.payment_terms || "")) || "",
        currency:
          catalogs.currencies.get(String(version.currency_code || "")) ||
          String(version.currency_code || ""),
      },
      notes: version.quotation_notes || "",
    },
  );

  return {
    fileName:
      fileName ||
      generatedFileName ||
      `${version.proposal_name || "Propuesta"}.pdf`,
    mimeType: "application/pdf",
    content: buffer,
    byteSize: buffer.length,
  };
}

async function loadCommercialQuotationVersionForAttachment({
  opportunityId,
  quotationVersionId,
  quotationId = null,
}) {
  const rows = await query(
    `SELECT qv.id,
            qv.quotation_id,
            qv.version_number,
            qv.contact_id,
            qv.proposal_name,
            qv.quotation_date,
            qv.introduction,
            qv.summary_discount_mode,
            qv.summary_discount_value,
            qv.summary_vat_mode,
            qv.summary_vat_pct,
            qv.delivery_time,
            qv.quotation_validity,
            qv.warranty_term,
            qv.payment_terms,
            qv.currency_code,
            qv.quotation_notes,
            o.name AS opportunity_name,
            a.name AS account_name,
            CONCAT(c.first_name, ' ', c.last_name) AS contact_name,
            c.email AS contact_email,
            c.phone AS contact_phone,
            su.full_name AS seller_user_name,
            su.email AS seller_user_email,
            su.mobile AS seller_user_phone
     FROM quotation_versions qv
     INNER JOIN quotations q ON q.id = qv.quotation_id
     INNER JOIN opportunities o ON o.id = q.opportunity_id
     INNER JOIN accounts a ON a.id = o.account_id
     INNER JOIN contacts c ON c.id = qv.contact_id
     LEFT JOIN users su ON su.id = o.seller_user_id
     WHERE qv.id = ?
       AND q.opportunity_id = ?
       ${quotationId ? "AND q.id = ?" : ""}
     LIMIT 1`,
    quotationId
      ? [Number(quotationVersionId), Number(opportunityId), Number(quotationId)]
      : [Number(quotationVersionId), Number(opportunityId)],
  );
  return rows[0] || null;
}

async function loadCommercialQuotationSectionsForAttachment(
  quotationVersionId,
) {
  const sections = await query(
    `SELECT qs.id, qs.title, qs.display_order
     FROM quotation_sections qs
     WHERE qs.quotation_version_id = ?
     ORDER BY qs.display_order, qs.id`,
    [Number(quotationVersionId)],
  );

  const sectionIds = sections.map((section) => Number(section.id));
  if (!sectionIds.length) {
    return [];
  }

  const placeholders = sectionIds.map(() => "?").join(", ");
  const items = await query(
    `SELECT qsi.id,
            qsi.quotation_section_id,
            qsi.product_code,
            qsi.product_description,
            qsi.item_type,
            qsi.bundle_parent_item_id,
            qsi.quantity,
            qsi.list_price_unit,
            qsi.manufacturer_discount_pct,
            qsi.import_cost_pct,
            qsi.profit_margin_pct,
            qsi.final_discount_pct,
            qsi.display_order
     FROM quotation_section_items qsi
     WHERE qsi.quotation_section_id IN (${placeholders})
     ORDER BY qsi.display_order, qsi.id`,
    sectionIds,
  );

  const itemsBySectionId = items.reduce((map, item) => {
    const key = Number(item.quotation_section_id);
    const current = map.get(key) || [];
    current.push({
      id: Number(item.id),
      quotationSectionId: key,
      productCode: item.product_code || "",
      productDescription: item.product_description || "",
      itemType: item.item_type || "producto",
      bundleParentItemId: item.bundle_parent_item_id
        ? Number(item.bundle_parent_item_id)
        : null,
      quantity: Number(item.quantity || 0),
      listPriceUnit: Number(item.list_price_unit || 0),
      manufacturerDiscountPct: Number(item.manufacturer_discount_pct || 0),
      importCostPct: Number(item.import_cost_pct || 0),
      profitMarginPct: Number(item.profit_margin_pct || 0),
      finalDiscountPct: Number(item.final_discount_pct || 0),
      displayOrder: Number(item.display_order || 0),
      isBundleComponent: Boolean(item.bundle_parent_item_id),
    });
    map.set(key, current);
    return map;
  }, new Map());

  return sections.map((section) => ({
    id: Number(section.id),
    title: section.title || `Seccion ${section.id}`,
    displayOrder: Number(section.display_order || 0),
    items: itemsBySectionId.get(Number(section.id)) || [],
  }));
}

async function loadCommercialQuotationCatalogsForPdf() {
  const [
    deliveryTimes,
    validityTerms,
    warrantyTerms,
    paymentTerms,
    currencies,
  ] = await Promise.all([
    query(
      `SELECT code, name FROM quotation_delivery_times WHERE is_active = 1 ORDER BY display_order, id`,
    ).catch(() => []),
    query(
      `SELECT code, name FROM quotation_validity_terms WHERE is_active = 1 ORDER BY display_order, id`,
    ).catch(() => []),
    query(
      `SELECT code, name FROM quotation_warranty_terms WHERE is_active = 1 ORDER BY display_order, id`,
    ).catch(() => []),
    query(
      `SELECT code, name FROM quotation_payment_terms WHERE is_active = 1 ORDER BY display_order, id`,
    ).catch(() => []),
    query(
      `SELECT code, name FROM currencies WHERE is_active = 1 ORDER BY name, id`,
    ).catch(() => []),
  ]);

  const buildMap = (rows) =>
    rows.reduce(
      (map, row) => map.set(String(row.code || ""), String(row.name || "")),
      new Map(),
    );

  return {
    deliveryTimes: buildMap(deliveryTimes),
    validityTerms: buildMap(validityTerms),
    warrantyTerms: buildMap(warrantyTerms),
    paymentTerms: buildMap(paymentTerms),
    currencies: buildMap(currencies),
  };
}

function buildCommercialQuotationPrintSections(sections = []) {
  return sections.map((section) => {
    const items = Array.isArray(section.items) ? section.items : [];
    const subtotal = items
      .filter((item) => !item.bundleParentItemId)
      .reduce((total, item) => {
        const totals = calculateCommercialQuotationItemDisplayTotals(
          item,
          items,
        );
        return total + Number(totals.salePriceTotal || 0);
      }, 0);

    const rows = items.map((item) => {
      const totals = calculateCommercialQuotationItemDisplayTotals(item, items);
      return {
        id: item.id,
        displayOrder: item.displayOrder,
        productCode: item.productCode,
        productDescription: item.productDescription,
        quantity: item.quantity,
        quantityDisplay: Number(item.quantity || 0).toFixed(2),
        salePriceUnit: totals.salePriceUnit,
        salePriceTotal: totals.salePriceTotal,
      };
    });

    return {
      id: section.id,
      title: section.title,
      subtotal: roundCommercialQuotationMoney(subtotal),
      rows,
      items,
    };
  });
}

function roundCommercialQuotationMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function toCommercialQuotationPercentFactor(value) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.min(Math.max(numericValue, 0), 100) / 100;
}

function calculateCommercialQuotationItemTotals(item) {
  const quantity = Math.max(Number(item?.quantity || 0), 0);
  const listPriceUnit = Math.max(Number(item?.listPriceUnit || 0), 0);
  const manufacturerDiscount = toCommercialQuotationPercentFactor(
    item?.manufacturerDiscountPct,
  );
  const importCost = toCommercialQuotationPercentFactor(item?.importCostPct);
  const profitMargin = toCommercialQuotationPercentFactor(
    item?.profitMarginPct,
  );
  const finalDiscount = toCommercialQuotationPercentFactor(
    item?.finalDiscountPct,
  );
  const discountedListPriceUnit = listPriceUnit * (1 - manufacturerDiscount);
  const costUnit = discountedListPriceUnit * (1 + importCost);
  const costTotal = quantity * costUnit;
  const salePriceBase = profitMargin >= 1 ? 0 : costUnit / (1 - profitMargin);
  const salePriceUnit = salePriceBase * (1 - finalDiscount);

  return {
    discountedListPriceUnit,
    costUnit,
    costTotal,
    salePriceUnit,
    salePriceTotal: quantity * salePriceUnit,
  };
}

function calculateCommercialQuotationItemDisplayTotals(item, allItems = []) {
  const baseTotals = calculateCommercialQuotationItemTotals(item);
  if (item?.isBundleComponent) {
    return baseTotals;
  }

  const componentItems = Array.isArray(allItems)
    ? allItems.filter(
        (candidate) =>
          Number(candidate?.bundleParentItemId || 0) === Number(item?.id || 0),
      )
    : [];

  if (!componentItems.length) {
    return baseTotals;
  }

  const aggregatedTotals = componentItems.reduce(
    (accumulator, componentItem) => {
      const componentTotals =
        calculateCommercialQuotationItemTotals(componentItem);
      return {
        costTotal:
          accumulator.costTotal + Number(componentTotals.costTotal || 0),
        salePriceTotal:
          accumulator.salePriceTotal +
          Number(componentTotals.salePriceTotal || 0),
      };
    },
    { costTotal: 0, salePriceTotal: 0 },
  );

  const quantity = Math.max(Number(item?.quantity || 0), 0);
  return {
    ...baseTotals,
    costUnit:
      quantity > 0
        ? aggregatedTotals.costTotal / quantity
        : aggregatedTotals.costTotal,
    costTotal: aggregatedTotals.costTotal,
    salePriceUnit:
      quantity > 0
        ? aggregatedTotals.salePriceTotal / quantity
        : aggregatedTotals.salePriceTotal,
    salePriceTotal: aggregatedTotals.salePriceTotal,
  };
}

function resolveCommercialQuotationSummaryCategory(itemType) {
  const normalizedType = String(itemType || "")
    .trim()
    .toLowerCase();
  return normalizedType === "servicio" || normalizedType === "service"
    ? "services"
    : "products";
}

function calculateCommercialQuotationSummary(sections = [], options = {}) {
  const buckets = {
    products: { costTotal: 0, salePriceTotal: 0 },
    services: { costTotal: 0, salePriceTotal: 0 },
    total: { costTotal: 0, salePriceTotal: 0 },
  };

  sections.forEach((section) => {
    const items = Array.isArray(section.items) ? section.items : [];
    items.forEach((item) => {
      if (item?.bundleParentItemId) {
        return;
      }
      const category = resolveCommercialQuotationSummaryCategory(
        item?.itemType,
      );
      const totals = calculateCommercialQuotationItemDisplayTotals(item, items);
      buckets[category].costTotal += Number(totals.costTotal || 0);
      buckets[category].salePriceTotal += Number(totals.salePriceTotal || 0);
      buckets.total.costTotal += Number(totals.costTotal || 0);
      buckets.total.salePriceTotal += Number(totals.salePriceTotal || 0);
    });
  });

  const summaryDiscountMode =
    options?.summaryDiscountMode === "amount" ? "amount" : "percentage";
  const summaryDiscountValue = Number(options?.summaryDiscountValue || 0);
  const normalizedSummaryDiscountPct =
    summaryDiscountMode === "amount"
      ? buckets.total.salePriceTotal > 0
        ? Math.min(
            Math.max(
              (summaryDiscountValue / buckets.total.salePriceTotal) * 100,
              0,
            ),
            100,
          )
        : 0
      : Math.min(Math.max(summaryDiscountValue, 0), 100);

  const totalSalePriceTotal = roundCommercialQuotationMoney(
    buckets.total.salePriceTotal,
  );
  const discountAmount = roundCommercialQuotationMoney(
    summaryDiscountMode === "amount"
      ? Math.min(summaryDiscountValue, totalSalePriceTotal)
      : totalSalePriceTotal * (normalizedSummaryDiscountPct / 100),
  );
  const discountedTotalAmount = roundCommercialQuotationMoney(
    totalSalePriceTotal - discountAmount,
  );
  const summaryVatMode =
    options?.summaryVatMode === "total"
      ? "total"
      : options?.summaryVatMode === "per_item"
        ? "per_item"
        : "without_vat";
  const summaryVatPct = Math.min(
    Math.max(Number(options?.summaryVatPct || 0), 0),
    100,
  );
  const vatBaseAmount =
    discountAmount > 0 ? discountedTotalAmount : totalSalePriceTotal;
  const vatAmount = roundCommercialQuotationMoney(
    summaryVatMode === "total" ? vatBaseAmount * (summaryVatPct / 100) : 0,
  );
  const totalWithVatAmount = roundCommercialQuotationMoney(
    vatBaseAmount + vatAmount,
  );

  return {
    totalSalePriceTotal,
    discountAmount,
    discountedTotalAmount,
    summaryVatMode,
    vatAmount,
    totalWithVatAmount,
  };
}

function getCommercialEmailSuggestionContextLabel(opportunity) {
  const opportunityName = String(opportunity?.name || "").trim();
  const accountName = String(opportunity?.account_name || "").trim();

  if (opportunityName) return opportunityName;
  if (accountName) return accountName;
  return "la oportunidad";
}

function resolveCommercialRecipientName(details = {}, contacts = []) {
  const recipient = String(details?.recipient || "")
    .trim()
    .toLowerCase();
  if (!recipient) return "";

  const matchedContact = (Array.isArray(contacts) ? contacts : []).find(
    (contact) => {
      const email = String(contact?.email || "")
        .trim()
        .toLowerCase();
      return email && email === recipient;
    },
  );

  return buildContactDisplayName(matchedContact);
}

function buildCommercialRecipientGreeting(recipientName = "") {
  return recipientName ? `Estimado/a ${recipientName},` : "Buen dia,";
}

function tokenizeCommercialInstruction(text = "") {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter(
      (token) =>
        !new Set([
          "para",
          "con",
          "por",
          "que",
          "los",
          "las",
          "una",
          "uno",
          "del",
          "sobre",
          "correo",
          "cliente",
          "este",
          "esta",
          "como",
          "hacer",
          "debe",
        ]).has(token),
    );
}

function scoreCommercialLibraryFileByInstruction(file, instructionTokens) {
  if (!instructionTokens.length) return 0;

  const searchable = [
    String(file?.title || ""),
    String(file?.summary || ""),
    String(file?.fileName || ""),
    String(file?.assetTypeLabel || ""),
  ]
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  let score = 0;
  instructionTokens.forEach((token) => {
    if (searchable.includes(token)) {
      score += 2;
    }
  });

  if (
    /\b(demo|demostracion|presentacion)\b/i.test(instructionTokens.join(" "))
  ) {
    const typeText = String(file?.assetTypeLabel || "").toLowerCase();
    if (
      typeText.includes("presentacion") ||
      typeText.includes("brochure") ||
      typeText.includes("datasheet")
    ) {
      score += 1;
    }
  }

  return score;
}

function buildCommercialAttachmentSuggestionsFallback({
  libraryFiles = [],
  details = {},
}) {
  const normalizedDetails = normalizeCommercialEmailDraft(details);
  const instructionTokens = tokenizeCommercialInstruction(
    normalizedDetails.aiInstructionText,
  );

  const scored = (Array.isArray(libraryFiles) ? libraryFiles : [])
    .map((file) => ({
      file,
      score: scoreCommercialLibraryFileByInstruction(file, instructionTokens),
    }))
    .filter((entry) => entry.file?.id)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      const leftDate = new Date(left.file?.createdAt || 0).getTime();
      const rightDate = new Date(right.file?.createdAt || 0).getTime();
      return rightDate - leftDate;
    })
    .slice(0, COMMERCIAL_EMAIL_LIBRARY_SUGGESTION_MAX_FILES)
    .map((entry) => ({
      ...entry.file,
      reason:
        entry.score > 0
          ? "Coincide con las instrucciones de la solicitud."
          : "Recomendado por vigencia y contexto comercial.",
    }));

  return scored;
}

async function requestCommercialAttachmentSuggestionsWithAi({
  opportunity,
  details,
  libraryFiles,
  aiUsageContext = null,
}) {
  const fallbackSuggestions = buildCommercialAttachmentSuggestionsFallback({
    libraryFiles,
    details,
  });

  if (!config.openai.apiKey) {
    return {
      source: "fallback",
      suggestions: fallbackSuggestions,
    };
  }

  const aiUsageUserId = Number(aiUsageContext?.userId || 0);
  const aiUsageStartedAt = new Date();
  const aiUsageInternalRequestId =
    aiUsageContext?.internalRequestId || randomUUID();

  if (aiUsageUserId) {
    await assertAiBudgetAvailable({ userId: aiUsageUserId });
  }

  const normalizedDetails = normalizeCommercialEmailDraft(details);
  const candidates = (Array.isArray(libraryFiles) ? libraryFiles : [])
    .slice(0, 40)
    .map((file) => ({
      id: String(file.id || "").trim(),
      title: String(file.title || "").trim(),
      summary: String(file.summary || "").trim(),
      fileName: String(file.fileName || "").trim(),
      assetTypeLabel: String(file.assetTypeLabel || "").trim(),
    }))
    .filter((file) => file.id);

  const payload = {
    model: config.openai.model,
    input: [
      {
        role: "system",
        content:
          "Eres un asistente de preventa. Responde solo con JSON valido. Debes seleccionar hasta 3 documentos de biblioteca que mejor respondan a las instrucciones del usuario y al contexto de la oportunidad. No inventes IDs. Solo puedes usar IDs del arreglo candidates.",
      },
      {
        role: "user",
        content: JSON.stringify({
          opportunity: {
            id: Number(opportunity?.id || 0),
            name: String(opportunity?.name || "").trim(),
            accountName: String(opportunity?.account_name || "").trim(),
            stageName: String(opportunity?.sales_stage_name || "").trim(),
          },
          aiInstructionText: normalizedDetails.aiInstructionText,
          candidates,
          expectedShape: {
            suggestedAttachmentIds: ["library:..."],
            reasons: [{ id: "library:...", reason: "string" }],
          },
        }),
      },
    ],
  };

  const response = await fetch(
    `${config.openai.baseUrl.replace(/\/$/, "")}/responses`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openai.apiKey}`,
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  if (aiUsageUserId) {
    await recordAiUsageFromOpenAiResponse({
      internalRequestId: aiUsageInternalRequestId,
      userId: aiUsageUserId,
      featureCode:
        String(
          aiUsageContext?.featureCode ||
            "commercial_development.email_attachment_suggestions",
        ) || "commercial_development.email_attachment_suggestions",
      model: String(payload?.model || config.openai.model || "").trim(),
      openAiResponse: data,
      jobType: aiUsageContext?.jobType || null,
      jobId: aiUsageContext?.jobId || null,
      startedAt: aiUsageStartedAt,
    });
  }

  const parsed = extractJsonObject(extractResponseOutputText(data));
  const reasonPairs = Array.isArray(parsed?.reasons) ? parsed.reasons : [];
  const reasonById = new Map(
    reasonPairs
      .map((entry) => [
        String(entry?.id || "").trim(),
        String(entry?.reason || "").trim(),
      ])
      .filter(([id]) => id),
  );

  const requestedIds = Array.isArray(parsed?.suggestedAttachmentIds)
    ? parsed.suggestedAttachmentIds
    : [];
  const selectedIds = Array.from(
    new Set(
      requestedIds.map((value) => String(value || "").trim()).filter(Boolean),
    ),
  ).slice(0, COMMERCIAL_EMAIL_LIBRARY_SUGGESTION_MAX_FILES);

  const candidatesById = new Map(
    (Array.isArray(libraryFiles) ? libraryFiles : [])
      .filter((file) => file?.id)
      .map((file) => [String(file.id).trim(), file]),
  );

  const suggestions = selectedIds
    .map((id) => {
      const file = candidatesById.get(id);
      if (!file) return null;
      return {
        ...file,
        reason:
          reasonById.get(id) ||
          "Seleccionado por alta coincidencia con las instrucciones.",
      };
    })
    .filter(Boolean);

  return {
    source: "openai",
    suggestions: suggestions.length ? suggestions : fallbackSuggestions,
  };
}

function buildCommercialEmailSuggestionFallback(
  opportunity,
  details = {},
  recipientName = "",
) {
  const normalizedDetails = normalizeCommercialEmailDraft(details);
  const contextLabel = getCommercialEmailSuggestionContextLabel(opportunity);
  const greeting = buildCommercialRecipientGreeting(recipientName);
  const instructionText = normalizedDetails.aiInstructionText;

  if (instructionText) {
    const lowerInstruction = instructionText.toLowerCase();
    const mentionsDemo = /\b(demo|demostraci[oó]n|demostrar)\b/i.test(
      instructionText,
    );
    const mentionsInfo = /\b(informaci[oó]n|informar|info)\b/i.test(
      instructionText,
    );
    const mentionsInvite = /\b(invitar|invitaci[oó]n)\b/i.test(instructionText);
    const productLabel = /\bf5\s*dcs\b/i.test(instructionText)
      ? "F5 DCS"
      : contextLabel;

    let subject = `Seguimiento sobre ${productLabel}`;
    if (mentionsDemo && mentionsInfo) {
      subject = `Informacion y demostracion de ${productLabel}`;
    } else if (mentionsDemo) {
      subject = `Invitacion a demostracion de ${productLabel}`;
    } else if (mentionsInfo) {
      subject = `Informacion de ${productLabel}`;
    } else if (mentionsInvite) {
      subject = `Invitacion sobre ${productLabel}`;
    }

    const lines = [
      greeting,
      "",
      mentionsInfo
        ? `Le comparto informacion sobre ${productLabel}.`
        : `Le comparto este correo sobre ${productLabel}.`,
      mentionsDemo || mentionsInvite
        ? "Tambien me gustaria invitarle a una demostracion para mostrarle el alcance y resolver cualquier duda."
        : "",
      "Quedo atento a sus comentarios para avanzar con el siguiente paso.",
      "",
      "Saludos cordiales,",
    ].filter(Boolean);

    if (lowerInstruction.includes("breve")) {
      lines.splice(
        3,
        0,
        "He procurado dejar el mensaje breve y directo, como indicaste.",
      );
    }

    return {
      subject,
      messageBody: lines.join("\n"),
      source: "fallback",
    };
  }

  if (normalizedDetails.purpose === "request_information") {
    return {
      subject: `Informacion de ${contextLabel}`,
      messageBody: `${greeting}\n\nComparto la informacion de ${contextLabel} para su revision. Si requiere algun dato adicional, con gusto lo revisamos.\n\nQuedo atento a sus comentarios.\n\nSaludos cordiales,`,
      source: "fallback",
    };
  }

  if (normalizedDetails.purpose === "other") {
    const topic = normalizedDetails.purposeOther || contextLabel;
    return {
      subject: `${topic} - ${contextLabel}`,
      messageBody: `${greeting}\n\nLe comparto este correo sobre ${topic}. Quedo atento a sus comentarios y a cualquier siguiente paso necesario para avanzar ${contextLabel}.\n\nSaludos cordiales,`,
      source: "fallback",
    };
  }

  return {
    subject: `Propuesta para ${contextLabel}`,
    messageBody: `${greeting}\n\nComparto la propuesta de ${contextLabel} para su revision. Quedo atento a sus comentarios y a los siguientes pasos para continuar con la oportunidad.\n\nSaludos cordiales,`,
    source: "fallback",
  };
}

async function requestCommercialEmailSuggestionWithAi({
  opportunity,
  details,
  recipientName = "",
  aiUsageContext = null,
}) {
  const fallback = buildCommercialEmailSuggestionFallback(
    opportunity,
    details,
    recipientName,
  );

  if (!config.openai.apiKey) {
    return {
      ...fallback,
      source: "fallback",
      sourceReason: "missing_openai_api_key",
    };
  }

  const aiUsageUserId = Number(aiUsageContext?.userId || 0);
  const aiUsageStartedAt = new Date();
  const aiUsageInternalRequestId =
    aiUsageContext?.internalRequestId || randomUUID();

  if (aiUsageUserId) {
    await assertAiBudgetAvailable({ userId: aiUsageUserId });
  }

  const normalizedDetails = normalizeCommercialEmailDraft(details);
  const selectedLibraryFiles = (
    Array.isArray(normalizedDetails.attachments)
      ? normalizedDetails.attachments
      : []
  )
    .filter((attachment) => attachment?.sourceType === "library_file")
    .slice(0, 3)
    .map((attachment) => ({
      fileName: String(attachment.fileName || "").trim(),
      title: String(attachment.title || "").trim(),
      summary: String(attachment.summary || "").trim(),
      assetTypeLabel: String(attachment.assetTypeLabel || "").trim(),
    }));
  const payload = {
    model: config.openai.model,
    temperature: 0.2,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "commercial_email_suggestion",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            subject: { type: "string" },
            messageBody: { type: "string" },
          },
          required: ["subject", "messageBody"],
        },
      },
    },
    messages: [
      {
        role: "system",
        content:
          "Eres un redactor comercial B2B. Responde solo con JSON válido. No inventes hechos no presentes en la entrada. Debes redactar un asunto y un mensaje base de correo en español, formales, ejecutivos y listos para enviar. El asunto debe ser breve, específico y sin comillas. El mensaje base debe ser texto plano, sin markdown, con saludo profesional, cuerpo breve y cierre cordial. Si existe `recipientName`, úsalo en el saludo de forma natural. Prioriza la instrucción del usuario (`aiInstructionText`) por encima del contexto fijo de la oportunidad, siempre que no contradiga hechos reales. Si la instrucción pide mencionar un producto, demo, reunión o material concreto, incorpóralo al correo de forma natural.",
      },
      {
        role: "user",
        content: JSON.stringify({
          opportunity: {
            id: Number(opportunity?.id || 0),
            name: String(opportunity?.name || "").trim(),
            accountName: String(opportunity?.account_name || "").trim(),
            stageName: String(opportunity?.sales_stage_name || "").trim(),
            stageCode: String(opportunity?.sales_stage_code || "").trim(),
            sellerName: String(opportunity?.seller_user_name || "").trim(),
            amountUsd: Number(opportunity?.amount_usd || 0),
            closeDate: opportunity?.close_date || null,
          },
          emailDraft: {
            purpose: normalizedDetails.purpose,
            purposeOther: normalizedDetails.purposeOther,
            recipientName,
            aiInstructionText: normalizedDetails.aiInstructionText,
            expectedResponse: normalizedDetails.expectedResponse,
            attachmentsSummary:
              getCommercialEmailAttachmentsSummary(normalizedDetails),
            responseDueDate: normalizedDetails.responseDueDate,
            selectedLibraryFiles,
          },
          writingGoal: normalizedDetails.aiInstructionText
            ? `Sigue esta instruccion del usuario: ${normalizedDetails.aiInstructionText}`
            : normalizedDetails.purpose === "proposal"
              ? "Presentar o enviar una propuesta comercial."
              : normalizedDetails.purpose === "request_information"
                ? "Compartir informacion util para mover la oportunidad."
                : `Redactar un correo sobre: ${normalizedDetails.purposeOther || "otro tema comercial relevante"}.`,
          contextGoal:
            normalizedDetails.purpose === "proposal"
              ? "Presentar o enviar una propuesta comercial."
              : normalizedDetails.purpose === "request_information"
                ? "Compartir informacion util para mover la oportunidad."
                : `Redactar un correo sobre: ${normalizedDetails.purposeOther || "otro tema comercial relevante"}.`,
          fallback,
          expectedShape: {
            subject: "string",
            messageBody: "string",
          },
        }),
      },
    ],
  };

  const response = await fetch(
    `${config.openai.baseUrl.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openai.apiKey}`,
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  if (aiUsageUserId) {
    try {
      await recordAiUsageFromOpenAiResponse({
        internalRequestId: aiUsageInternalRequestId,
        userId: aiUsageUserId,
        featureCode:
          String(
            aiUsageContext?.featureCode ||
              "commercial_development.email_suggestion",
          ) || "commercial_development.email_suggestion",
        model: String(payload?.model || config.openai.model || "").trim(),
        openAiResponse: data,
        jobType: aiUsageContext?.jobType || null,
        jobId: aiUsageContext?.jobId || null,
        startedAt: aiUsageStartedAt,
      });
    } catch (usageError) {
      if (config.nodeEnv !== "test") {
        console.warn(
          "Commercial email suggestion usage log warning:",
          usageError?.message || usageError,
        );
      }
    }
  }
  const completionContent = String(data?.choices?.[0]?.message?.content || "");
  const parsed = extractJsonObject(completionContent);
  const subject = String(parsed?.subject || "").trim() || fallback.subject;
  const messageBody =
    String(parsed?.messageBody || "").trim() || fallback.messageBody;

  return {
    subject,
    messageBody,
    source: "openai",
    sourceReason: "openai",
  };
}

function splitEmailList(value) {
  return String(value || "")
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildSendEmailActionTitle(details, fallbackTitle = "") {
  return (
    details.subject || String(fallbackTitle || "").trim() || "Enviar correo"
  );
}

async function loadCommercialSendEmailContext({
  req,
  opportunityId,
  activityId,
}) {
  const opportunity = await loadOpportunityForExecution(
    req.user,
    opportunityId,
  );
  if (!opportunity) {
    return { error: { status: 404, message: "Oportunidad no encontrada" } };
  }

  const currentActivity = await loadCommercialActivityAction(
    opportunityId,
    activityId,
  );
  if (!currentActivity) {
    return { error: { status: 404, message: "Actividad no encontrada" } };
  }

  if (String(currentActivity.action_type || "") !== "send_email") {
    return {
      error: {
        status: 400,
        message: "La accion indicada no es de tipo enviar correo",
      },
    };
  }

  const details = normalizeCommercialEmailDraft(
    parseCommercialActionDetails(currentActivity.details_json) || {},
  );
  return {
    opportunity,
    currentActivity,
    details,
  };
}

async function persistCommercialEmailDraft({
  opportunity,
  currentActivity,
  details,
  req,
  status,
}) {
  const nextTitle = buildSendEmailActionTitle(details, currentActivity.title);
  await saveOpportunityAction({
    opportunityId: Number(opportunity.id),
    actionId: Number(currentActivity.id),
    payload: {
      linked_stage_id: Number(
        currentActivity.linked_stage_id || opportunity.sales_stage_id,
      ),
      action_type: "send_email",
      priority: String(currentActivity.priority || "medium"),
      title: nextTitle,
      owner_user_id:
        currentActivity.owner_user_id === null
          ? Number(req.user.id)
          : Number(currentActivity.owner_user_id),
      due_date: currentActivity.due_date,
      scheduled_at: currentActivity.scheduled_at,
      success_criteria: details.expectedResponse || "",
      notes: currentActivity.notes || null,
      is_primary_next_step: Number(currentActivity.is_primary_next_step || 0),
      details_json: JSON.stringify(details),
      status,
    },
    userId: Number(req.user.id),
  });

  return nextTitle;
}

async function listCommercialCalendarActivities({
  user,
  view,
  date,
  includeCompleted,
  sellerUserId = null,
  year = null,
  quarter = null,
  timeZone = BUSINESS_TIMEZONE,
}) {
  const range = getCalendarRange(view, date, timeZone);
  const allowedStatuses = getCalendarActivityStatuses(includeCompleted);
  const actionTypes = Array.from(COMMERCIAL_ACTIVITY_ACTION_TYPES);
  const params = [];
  const ownershipJoin = buildOwnershipJoin(user, params);
  const where = [
    `a.scheduled_at >= ?`,
    `a.scheduled_at < ?`,
    `a.action_type IN (${actionTypes.map(() => "?").join(", ")})`,
    `a.status IN (${allowedStatuses.map(() => "?").join(", ")})`,
    `ocs.code NOT IN ('ganada', 'perdida', 'cancelada')`,
    `oas.code = 'activada'`,
  ];

  params.push(
    range.startDateTime,
    range.endExclusiveDateTime,
    ...actionTypes,
    ...allowedStatuses,
  );

  if (year !== null && quarter !== null) {
    const quarterRange = getQuarterDateRange(year, quarter);
    where.push(`o.close_date BETWEEN ? AND ?`);
    params.push(quarterRange.startDate, quarterRange.endDate);
  }

  if (Number.isInteger(Number(sellerUserId)) && Number(sellerUserId) > 0) {
    where.push(`o.seller_user_id = ?`);
    params.push(Number(sellerUserId));
  }

  if (!hasCalendarGlobalScope(user)) {
    where.push(`(ao_scope.user_id IS NOT NULL OR o.created_by = ?)`);
    params.push(Number(user.id));
  }

  const [rows, leadFollowUps, completedLeadHistory] = await Promise.all([
    query(
      `SELECT a.id, a.opportunity_id, a.action_type, a.status, a.title, a.notes,
              a.scheduled_at, a.is_primary_next_step,
              o.name AS opportunity_name, o.close_date, o.amount_usd,
            o.seller_user_id,
              ac.name AS account_name,
            oss.name AS stage_name,
            su.full_name AS seller_user_name
       FROM opportunity_workspace_actions a
       INNER JOIN opportunities o ON o.id = a.opportunity_id
       ${ownershipJoin}
       INNER JOIN accounts ac ON ac.id = o.account_id
       INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
       INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
       INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
           LEFT JOIN users su ON su.id = o.seller_user_id
       WHERE ${where.join(" AND ")}
       ORDER BY a.scheduled_at ASC, a.is_primary_next_step DESC, o.amount_usd DESC, o.name ASC`,
      params,
    ),
    listCalendarLeadFollowUps({
      user,
      startDateTime: range.startDateTime,
      endExclusiveDateTime: range.endExclusiveDateTime,
      startDate: range.startDate,
      endDate: range.endDate,
      sellerUserId,
      year,
      quarter,
      timeZone,
    }),
    includeCompleted
      ? listCalendarCompletedLeadOutcomeHistory({
          user,
          startDateTime: range.startDateTime,
          endExclusiveDateTime: range.endExclusiveDateTime,
          sellerUserId,
          year,
          quarter,
          timeZone,
        })
      : Promise.resolve([]),
  ]);

  const items = rows.map((row) => ({
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    opportunityName: row.opportunity_name,
    accountName: row.account_name,
    activityType: row.action_type,
    status: row.status,
    scheduledAt: row.scheduled_at,
    scheduledDate: formatDateInTimeZone(row.scheduled_at, timeZone),
    title: row.title || "",
    note: row.notes || "",
    isPrimaryNextStep: Boolean(row.is_primary_next_step),
    stageName: row.stage_name || "",
    sellerUserId:
      row.seller_user_id === null ? null : Number(row.seller_user_id),
    sellerUserName: row.seller_user_name || "Sin vendedor",
    closeDate: row.close_date,
    amountUsd: Number(row.amount_usd || 0),
    calendarSource: "opportunity",
  }));

  items.push(...leadFollowUps);
  items.push(...completedLeadHistory);
  items.sort((left, right) => {
    const leftTime = left.scheduledAt
      ? new Date(left.scheduledAt).getTime()
      : Number.MAX_SAFE_INTEGER;
    const rightTime = right.scheduledAt
      ? new Date(right.scheduledAt).getTime()
      : Number.MAX_SAFE_INTEGER;
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return String(left.title || "").localeCompare(
      String(right.title || ""),
      "es",
    );
  });

  const groupedItems = items.reduce((accumulator, item) => {
    const key = item.scheduledDate;
    if (!accumulator.has(key)) {
      accumulator.set(key, []);
    }
    accumulator.get(key).push(item);
    return accumulator;
  }, new Map());

  const summary = items.reduce(
    (accumulator, item) => {
      accumulator.total += 1;
      if (isPendingCommercialActivityStatus(item.status))
        accumulator.pending += 1;
      if (item.status === "in_progress") accumulator.inProgress += 1;
      if (item.status === "blocked") accumulator.blocked += 1;
      if (item.status === "done") accumulator.done += 1;
      return accumulator;
    },
    {
      total: 0,
      pending: 0,
      inProgress: 0,
      blocked: 0,
      done: 0,
    },
  );

  return {
    filters: {
      view: range.view,
      date: range.selectedDate,
      rangeStart: range.startDate,
      rangeEnd: range.endDate,
      includeCompleted: Boolean(includeCompleted),
      year,
      quarter,
    },
    summary,
    days: listDateRangeDays(range.startDate, range.endDate).map((day) => ({
      date: day,
      count: (groupedItems.get(day) || []).length,
      items: groupedItems.get(day) || [],
    })),
  };
}

async function listCalendarAlertActivities({
  user,
  sellerUserId,
  now,
  next24h,
  timeZone = BUSINESS_TIMEZONE,
}) {
  const actionTypes = Array.from(COMMERCIAL_ACTIVITY_ACTION_TYPES);
  const allowedStatuses = Array.from(COMMERCIAL_ACTIVITY_OPEN_STATUSES);
  const params = [];
  const ownershipJoin = buildOwnershipJoin(user, params);
  const where = [
    `a.scheduled_at >= ?`,
    `a.scheduled_at < ?`,
    `a.action_type IN (${actionTypes.map(() => "?").join(", ")})`,
    `a.status IN (${allowedStatuses.map(() => "?").join(", ")})`,
    `ocs.code NOT IN ('ganada', 'perdida', 'cancelada')`,
    `oas.code = 'activada'`,
  ];

  const lookbackStart = new Date(
    now.getTime() - CALENDAR_ALERT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  );
  params.push(lookbackStart, next24h, ...actionTypes, ...allowedStatuses);

  if (Number.isInteger(Number(sellerUserId)) && Number(sellerUserId) > 0) {
    where.push(`o.seller_user_id = ?`);
    params.push(Number(sellerUserId));
  }

  if (!hasCalendarGlobalScope(user)) {
    where.push(`(ao_scope.user_id IS NOT NULL OR o.created_by = ?)`);
    params.push(Number(user.id));
  }

  const [rows, leadFollowUps] = await Promise.all([
    query(
      `SELECT a.id, a.opportunity_id, a.action_type, a.status, a.title, a.notes,
              a.scheduled_at,
              o.name AS opportunity_name, o.seller_user_id,
              ac.name AS account_name,
              su.full_name AS seller_user_name
       FROM opportunity_workspace_actions a
       INNER JOIN opportunities o ON o.id = a.opportunity_id
       ${ownershipJoin}
       INNER JOIN accounts ac ON ac.id = o.account_id
       INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
       INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
       LEFT JOIN users su ON su.id = o.seller_user_id
       WHERE ${where.join(" AND ")}
       ORDER BY a.scheduled_at ASC, o.name ASC`,
      params,
    ),
    listCalendarLeadFollowUps({
      user,
      startDateTime: lookbackStart,
      endExclusiveDateTime: next24h,
      startDate: formatDateInTimeZone(lookbackStart, timeZone),
      endDate: formatDateInTimeZone(new Date(next24h.getTime() - 1), timeZone),
      sellerUserId,
      timeZone,
    }),
  ]);

  const items = rows.map((row) => ({
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    opportunityName: row.opportunity_name || "",
    accountName: row.account_name || "",
    activityType: row.action_type || "other",
    status: row.status || "pending",
    scheduledAt: row.scheduled_at,
    scheduledDate: formatDateInTimeZone(row.scheduled_at, timeZone),
    title: row.title || "",
    note: row.notes || "",
    sellerUserId:
      row.seller_user_id === null ? null : Number(row.seller_user_id),
    sellerUserName: row.seller_user_name || "Sin vendedor",
    calendarSource: "opportunity",
  }));

  items.push(...leadFollowUps);
  items.sort((left, right) => {
    const leftTime = left.scheduledAt
      ? new Date(left.scheduledAt).getTime()
      : Number.MAX_SAFE_INTEGER;
    const rightTime = right.scheduledAt
      ? new Date(right.scheduledAt).getTime()
      : Number.MAX_SAFE_INTEGER;
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return String(left.title || "").localeCompare(
      String(right.title || ""),
      "es",
    );
  });

  return items;
}

async function buildCommercialCalendarInsights({
  user,
  sellerUserId,
  slaDays,
  timeZone = BUSINESS_TIMEZONE,
}) {
  const now = new Date();
  const nowMs = now.getTime();
  const todayDate = formatDateInTimeZone(now, timeZone);
  const todayWindow = getTimeZoneDayWindow(todayDate, timeZone);
  const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const alertItems = await listCalendarAlertActivities({
    user,
    sellerUserId,
    now,
    next24h,
    timeZone,
  });
  const opportunityIds = Array.from(
    new Set(alertItems.map((item) => item.opportunityId).filter(Boolean)),
  );
  const [dependencyRows, lastActivityByOpportunity] = await Promise.all([
    listOpenDependencies(opportunityIds),
    listLastActivityByOpportunity(opportunityIds),
  ]);

  const dependenciesByOpportunity = dependencyRows.reduce(
    (accumulator, row) => {
      const key = Number(row.opportunity_id || 0);
      if (!key) return accumulator;
      const current = accumulator.get(key) || [];
      current.push({
        id: Number(row.id),
        title: row.title || "Dependencia",
        dependencyType: row.dependency_type || "other",
        dependencyLabel: getDependencyTypeLabel(row.dependency_type),
        dueDate: row.due_date || null,
        isOverdue: Boolean(row.due_date && getDiffDays(row.due_date) > 0),
      });
      accumulator.set(key, current);
      return accumulator;
    },
    new Map(),
  );

  const prioritized = alertItems
    .map((item) => {
      const scheduledAtMs = item.scheduledAt
        ? new Date(item.scheduledAt).getTime()
        : Number.NaN;
      const hasRegisteredLeadSituation =
        String(item.calendarSource || "") === "interaction" &&
        String(item.leadSubstatusCode || "").trim().length > 0;
      const isOverdue =
        Number.isFinite(scheduledAtMs) &&
        scheduledAtMs < nowMs &&
        !hasRegisteredLeadSituation;
      const isToday =
        Number.isFinite(scheduledAtMs) &&
        todayWindow.start &&
        todayWindow.end &&
        scheduledAtMs >= todayWindow.start.getTime() &&
        scheduledAtMs < todayWindow.end.getTime();
      const isUpcoming =
        Number.isFinite(scheduledAtMs) &&
        scheduledAtMs >= nowMs &&
        scheduledAtMs < next24h.getTime();
      const deps = dependenciesByOpportunity.get(item.opportunityId) || [];
      const hasOverdueDependency = deps.some(
        (dependency) => dependency.isOverdue,
      );
      const lastActivityAt =
        lastActivityByOpportunity.get(item.opportunityId) || null;
      const daysWithoutActivity = lastActivityAt
        ? getDiffDays(lastActivityAt, now)
        : 0;
      const isSilenceRisk = daysWithoutActivity > slaDays;
      const isBlocked = String(item.status || "") === "blocked";

      const trafficLight = getCalendarTrafficLight({
        isOverdue,
        isToday,
        isUpcoming,
        isBlocked,
        hasOverdueDependency,
      });
      const riskScore = computeCalendarRiskScore({
        isOverdue,
        isToday,
        isUpcoming,
        isBlocked,
        hasOverdueDependency,
        isSilenceRisk,
      });

      return {
        ...item,
        riskScore,
        trafficLight,
        flags: {
          isOverdue,
          isToday,
          isUpcoming,
          isBlocked,
          hasOverdueDependency,
          isSilenceRisk,
          hasRegisteredLeadSituation,
        },
        daysWithoutActivity,
        dependencies: deps,
      };
    })
    .sort(sortAlertsByRisk);

  const myDay = prioritized.filter((item) => item.flags.isToday);
  const dependencyLinked = prioritized.filter(
    (item) => item.flags.hasOverdueDependency,
  );
  const silence = prioritized
    .filter((item) => item.flags.isSilenceRisk)
    .sort((left, right) => right.daysWithoutActivity - left.daysWithoutActivity)
    .slice(0, 12);

  const reminders = prioritized.slice(0, 10).map((item) => {
    const scheduledAtMs = item.scheduledAt
      ? new Date(item.scheduledAt).getTime()
      : nowMs;
    const reminderAtMs = Math.max(
      nowMs,
      scheduledAtMs - CALENDAR_DEFAULT_REMINDER_LEAD_MINUTES * 60 * 1000,
    );
    return {
      activityId: item.id,
      title: item.title || "Actividad",
      opportunityName: item.opportunityName,
      remindAt: new Date(reminderAtMs).toISOString(),
      channel: "in_app",
      priority:
        item.riskScore >= 70 ? "high" : item.riskScore >= 40 ? "medium" : "low",
      message:
        item.riskScore >= 70
          ? "Atencion inmediata recomendada"
          : "Recordatorio operativo automatico",
    };
  });

  const byTrafficLight = prioritized.reduce(
    (accumulator, item) => {
      const tone = item.trafficLight || "green";
      accumulator[tone] = (accumulator[tone] || 0) + 1;
      return accumulator;
    },
    { red: 0, amber: 0, green: 0 },
  );

  const bySeller = prioritized.reduce((accumulator, item) => {
    if (!item.sellerUserId) return accumulator;
    const key = Number(item.sellerUserId);
    const current = accumulator.get(key) || {
      sellerUserId: key,
      sellerUserName: item.sellerUserName || `Vendedor ${key}`,
      total: 0,
      overdue: 0,
      highRisk: 0,
    };
    current.total += 1;
    if (item.flags.isOverdue) current.overdue += 1;
    if (item.riskScore >= 70) current.highRisk += 1;
    accumulator.set(key, current);
    return accumulator;
  }, new Map());

  return {
    timezone: timeZone,
    myDay,
    alerts: {
      prioritized,
      byTrafficLight,
      dependencyLinked,
      silence,
      reminders,
      counters: {
        total: prioritized.length,
        overdue: prioritized.filter((item) => item.flags.isOverdue).length,
        today: prioritized.filter((item) => item.flags.isToday).length,
        upcoming: prioritized.filter((item) => item.flags.isUpcoming).length,
        blocked: prioritized.filter((item) => item.flags.isBlocked).length,
        highRisk: prioritized.filter((item) => item.riskScore >= 70).length,
      },
    },
    indicators: {
      byTrafficLight,
      bySeller: Array.from(bySeller.values()).sort(
        (left, right) => right.highRisk - left.highRisk,
      ),
    },
  };
}

router.get(
  "/dashboard",
  requireAnyPermission([
    "desarrollo_comercial.read",
    "desarrollo_comercial.update",
  ]),
  requirePermission("oportunidades.read"),
  async (req, res) => {
    const includeClosedDependencies =
      String(req.query?.includeClosedDependencies || "").trim() === "1";
    const quarterSelection = resolveQuarterSelection(req.query || {});
    const developmentPeriods = await listDevelopmentPeriods();
    const stagesCatalog = await listActiveSalesStages();
    const opportunityRows = await listAccessibleOpportunities(req.user);
    const planningOpportunityRows = await listAccessiblePlanningOpportunities(
      req.user,
    );
    const opportunityIds = opportunityRows.map((row) => Number(row.id));
    const accountContactsByAccountId = await listContactsByAccountIds(
      opportunityRows.map((row) => row.account_id),
    );
    const recommendationCatalog =
      await loadCommercialEnablementRecommendationCatalog();
    const dependencyRows = includeClosedDependencies
      ? await listDependencies(opportunityIds)
      : await listOpenDependencies(opportunityIds);
    const lastActivityByOpportunity =
      await listLastActivityByOpportunity(opportunityIds);
    const dependenciesByOpportunity = dependencyRows.reduce(
      (accumulator, row) => {
        const key = Number(row.opportunity_id);
        const current = accumulator.get(key) || [];
        current.push(mapDependencyRow(row));
        accumulator.set(key, current);
        return accumulator;
      },
      new Map(),
    );
    const stageSlaMap = await loadStageSlaMap();
    let executionItems = await Promise.all(
      opportunityRows.map(async (row) => {
        const opportunityState = {
          ...row,
          salesStageId: Number(row.sales_stage_id),
        };
        const stageView = buildStageView(stagesCatalog, opportunityState);
        const workspace = await buildOpportunityWorkspace({
          opportunityState,
          stageView,
          documents: [],
          currentUserId: Number(req.user.id),
        });

        const nextStep = selectPrimaryNextStep(
          workspace.actions || [],
          opportunityState.salesStageId,
        );
        const mappedNextStep = mapNextStep(nextStep);
        const activitySummary = buildCommercialActivitySummary(
          workspace.actions || [],
        );
        const lastActivityAt =
          lastActivityByOpportunity.get(Number(row.id)) ||
          (row.updated_at ? new Date(row.updated_at) : null) ||
          new Date();
        const daysSinceActivity = getDiffDays(lastActivityAt);
        const slaDays = stageSlaMap[row.sales_stage_code] || 5;
        const dependencies =
          dependenciesByOpportunity.get(Number(row.id)) || [];
        const risk = buildRiskSummary({
          workspace,
          nextStep: mappedNextStep,
          dependencies,
          daysSinceActivity,
          slaDays,
        });
        const executionState = deriveExecutionState({
          nextStep: mappedNextStep,
          dependencies,
          risk,
          daysSinceActivity,
          slaDays,
        });

        const item = {
          id: Number(row.id),
          name: row.name,
          accountId: Number(row.account_id),
          accountName: row.account_name,
          accountContacts:
            accountContactsByAccountId.get(Number(row.account_id)) || [],
          amountUsd: Number(row.amount_usd || 0),
          closeDate: row.close_date,
          stageId: Number(row.sales_stage_id),
          stageCode: row.sales_stage_code,
          stageName: row.sales_stage_name,
          commercialStatusCode: row.commercial_status_code,
          commercialStatusName: row.commercial_status_name,
          sellerUserId:
            row.seller_user_id === null ? null : Number(row.seller_user_id),
          sellerUserName: row.seller_user_name || "Sin vendedor",
          updatedAt: row.updated_at,
          lastActivityAt,
          daysSinceActivity,
          slaDays,
          slaBreached: daysSinceActivity > slaDays,
          currentStageValidated: Boolean(workspace.currentStage?.isValidated),
          workspaceSummary: workspace.summary || null,
          opportunityScore: toOpportunityScore(
            workspace.scorecard?.averageScore,
          ),
          scorecardOverallTone: workspace.scorecard?.overallTone || "neutral",
          scorecardItems: (workspace.scorecard?.items || []).map(
            (scorecardItem) => ({
              label: scorecardItem.label,
              tone: scorecardItem.tone,
              statusLabel: scorecardItem.statusLabel,
              summary: scorecardItem.summary,
            }),
          ),
          openWeaknesses: (workspace.weaknesses || [])
            .filter((weakness) => weakness.status === "open")
            .slice(0, 3)
            .map((weakness) => ({
              title: weakness.title,
              severity: weakness.severity,
              detail: weakness.detail || "",
            })),
          recommendedHeading: workspace.recommendedStrategy?.heading || "",
          recommendedRoute: workspace.recommendedStrategy?.route || "",
          recommendedFinalObjective:
            workspace.recommendedStrategy?.finalObjective || "",
          recommendedStrategySteps: (
            workspace.recommendedStrategy?.steps || []
          ).slice(0, 3),
          recommendedNextMove: workspace.recommendedStrategy?.steps?.[0] || "",
          weaknessCount: (workspace.weaknesses || []).length,
          criticalWeaknessCount: risk.criticalWeaknessCount,
          riskLevel: risk.level,
          riskReasons: risk.reasons,
          executionState,
          dependencies,
          decisionRiskTone:
            workspace.scorecard?.signals?.decisionRisk?.tone || "neutral",
          nextStep: mappedNextStep,
          nextScheduledActivity: activitySummary.nextScheduledActivity,
          nextPendingAction: activitySummary.nextPendingAction,
          lastCompletedActivity: activitySummary.lastCompletedActivity,
          recentActivities: activitySummary.recentActivities,
          recentTimeline: activitySummary.recentTimeline,
          activityCount: activitySummary.activityCount,
          actionCount: activitySummary.actionCount,
        };

        item.reminders = buildExecutionReminders({
          opportunityItem: item,
          nextStep: mappedNextStep,
          dependencies,
          risk,
        });
        item.recommendedResources = recommendCommercialEnablementResources({
          catalog: recommendationCatalog,
          context: {
            stageCode: item.stageCode,
            accountName: item.accountName,
            opportunityName: item.name,
            riskReasons: item.riskReasons,
            executionStateCode: item.executionState?.code,
            executionStateLabel: item.executionState?.label,
            recommendedHeading: item.recommendedHeading,
            recommendedRoute: item.recommendedRoute,
            dependencies,
            roleTags: ["seller"],
          },
        });

        return item;
      }),
    );

    const quarterOpportunityIds = new Set(
      executionItems
        .filter((item) =>
          isDateWithinQuarter(
            item.closeDate,
            quarterSelection.year,
            quarterSelection.quarter,
          ),
        )
        .map((item) => item.id),
    );
    const quarterNarrativeFallbacks = executionItems
      .filter((item) => quarterOpportunityIds.has(item.id))
      .map((item) => ({
        id: Number(item.id),
        ...buildOpportunityNarrativeFallback(item),
      }));
    const quarterNarrativeFallbackById = new Map(
      quarterNarrativeFallbacks.map((item) => [item.id, item]),
    );
    const quarterLatestNarrativeById =
      await listLatestCommercialNarrativesByOpportunity(
        Array.from(quarterOpportunityIds),
      );

    executionItems = executionItems.map((item) => {
      if (!quarterOpportunityIds.has(item.id)) {
        return item;
      }

      const persistedNarrative = quarterLatestNarrativeById.get(
        Number(item.id),
      );
      const fallbackNarrative = quarterNarrativeFallbackById.get(
        Number(item.id),
      );
      return {
        ...item,
        ...(fallbackNarrative || {}),
        ...(persistedNarrative || {}),
      };
    });

    const activeCadenceRows = await listActiveCadences(opportunityIds);
    const opportunitiesById = new Map(
      executionItems.map((item) => [item.id, item]),
    );
    const activeCadences = activeCadenceRows.map((row) =>
      mapCadenceRow(row, opportunitiesById),
    );
    const activeCadenceByOpportunity = new Map(
      activeCadences.map((item) => [item.opportunityId, item]),
    );
    const suggestedCadences = executionItems
      .map((item) => buildSuggestedCadence(item, activeCadenceByOpportunity))
      .filter(Boolean)
      .sort((left, right) => {
        const decisionDelta =
          (right.cadenceDecision === "activate" ? 1 : 0) -
          (left.cadenceDecision === "activate" ? 1 : 0);
        if (decisionDelta !== 0) {
          return decisionDelta;
        }
        if (right.frictionScore !== left.frictionScore) {
          return right.frictionScore - left.frictionScore;
        }
        return String(left.opportunityName || "").localeCompare(
          String(right.opportunityName || ""),
          "es",
        );
      });
    const activateCount = suggestedCadences.filter(
      (item) => item.cadenceDecision === "activate",
    ).length;
    const watchCount = suggestedCadences.filter(
      (item) => item.cadenceDecision === "watch",
    ).length;

    const followUps = executionItems
      .filter((item) => item.nextStep)
      .sort((left, right) => {
        const leftDue = left.nextStep?.dueDate
          ? new Date(left.nextStep.dueDate).getTime()
          : Number.MAX_SAFE_INTEGER;
        const rightDue = right.nextStep?.dueDate
          ? new Date(right.nextStep.dueDate).getTime()
          : Number.MAX_SAFE_INTEGER;
        return leftDue - rightDue;
      })
      .slice(0, 20);

    const highRisks = executionItems
      .filter((item) => item.riskLevel !== "low")
      .sort((left, right) => right.riskReasons.length - left.riskReasons.length)
      .slice(0, 20);

    const pendingInteractions = (await listPendingInteractions(req.user)).map(
      (row) => ({
        id: Number(row.id),
        title: row.title,
        analysisStatus: row.analysis_status,
        accountId: row.account_id === null ? null : Number(row.account_id),
        accountName: row.account_name || "",
        primaryOpportunityId:
          row.primary_opportunity_id === null
            ? null
            : Number(row.primary_opportunity_id),
        primaryOpportunityName: row.primary_opportunity_name || "",
        createdAt: row.created_at,
        daysOpen: getDiffDays(row.created_at),
      }),
    );

    const planningSnapshot = await loadPlanningSnapshot({
      user: req.user,
      year: quarterSelection.year,
      quarter: quarterSelection.quarter,
      planningItems: planningOpportunityRows.map((row) => ({
        amountUsd: Number(row.amount_usd || 0),
        closeDate: row.close_date || null,
        commercialStatusCode: row.commercial_status_code || "",
        sellerUserId:
          row.seller_user_id === null || row.seller_user_id === undefined
            ? null
            : Number(row.seller_user_id),
        stageCode: row.sales_stage_code || "",
        stageId: Number(row.sales_stage_id || 0),
      })),
    });

    const sellerStats = Array.from(
      executionItems
        .reduce((accumulator, item) => {
          const key = item.sellerUserId || `unassigned-${item.id}`;
          const current = accumulator.get(key) || {
            sellerUserId: item.sellerUserId,
            sellerUserName: item.sellerUserName,
            openPipeline: 0,
            riskyOpportunities: 0,
            overdueFollowUps: 0,
            withoutNextStep: 0,
            activeCadences: 0,
            totalAmountUsd: 0,
          };
          current.openPipeline += 1;
          current.totalAmountUsd += Number(item.amountUsd || 0);
          if (item.riskLevel !== "low") current.riskyOpportunities += 1;
          if (item.executionState.code === "bloqueada")
            current.blocked = (current.blocked || 0) + 1;
          if (item.executionState.code === "esperando_interno")
            current.waitingInternal = (current.waitingInternal || 0) + 1;
          if (item.executionState.code === "esperando_cliente")
            current.waitingClient = (current.waitingClient || 0) + 1;
          if (
            item.nextStep?.dueDate &&
            getDiffDays(item.nextStep.dueDate) > 0
          ) {
            current.overdueFollowUps += 1;
          }
          if (!item.nextStep) current.withoutNextStep += 1;
          if (activeCadenceByOpportunity.has(item.id))
            current.activeCadences += 1;
          accumulator.set(key, current);
          return accumulator;
        }, new Map())
        .values(),
    ).sort((left, right) => right.riskyOpportunities - left.riskyOpportunities);

    const stageStats = Array.from(
      executionItems
        .reduce((accumulator, item) => {
          const current = accumulator.get(item.stageCode) || {
            stageCode: item.stageCode,
            stageName: item.stageName,
            count: 0,
            riskyCount: 0,
            noNextStepCount: 0,
            blockedCount: 0,
            waitingInternalCount: 0,
          };
          current.count += 1;
          if (item.riskLevel !== "low") current.riskyCount += 1;
          if (!item.nextStep) current.noNextStepCount += 1;
          if (item.executionState.code === "bloqueada")
            current.blockedCount += 1;
          if (item.executionState.code === "esperando_interno") {
            current.waitingInternalCount += 1;
          }
          accumulator.set(item.stageCode, current);
          return accumulator;
        }, new Map())
        .values(),
    );

    const executionStateStats = Array.from(
      executionItems
        .reduce((accumulator, item) => {
          const key = item.executionState.code;
          const current = accumulator.get(key) || {
            code: item.executionState.code,
            label: item.executionState.label,
            count: 0,
          };
          current.count += 1;
          accumulator.set(key, current);
          return accumulator;
        }, new Map())
        .values(),
    ).sort((left, right) => right.count - left.count);

    const dependencyStats = Array.from(
      dependencyRows
        .reduce((accumulator, row) => {
          const key = String(row.dependency_type || "unknown");
          const current = accumulator.get(key) || {
            dependencyType: key,
            dependencyLabel: getDependencyTypeLabel(key),
            openCount: 0,
            overdueCount: 0,
          };
          current.openCount += 1;
          if (row.due_date && getDiffDays(row.due_date) > 0) {
            current.overdueCount += 1;
          }
          accumulator.set(key, current);
          return accumulator;
        }, new Map())
        .values(),
    ).sort((left, right) => right.overdueCount - left.overdueCount);

    const summary = {
      openOpportunities: executionItems.length,
      riskyOpportunities: executionItems.filter(
        (item) => item.riskLevel !== "low",
      ).length,
      overdueFollowUps: executionItems.filter(
        (item) =>
          item.nextStep?.dueDate && getDiffDays(item.nextStep.dueDate) > 0,
      ).length,
      withoutNextStep: executionItems.filter((item) => !item.nextStep).length,
      staleOpportunities: executionItems.filter((item) => item.slaBreached)
        .length,
      waitingOnClient: executionItems.filter(
        (item) => item.executionState.code === "esperando_cliente",
      ).length,
      waitingOnInternal: executionItems.filter(
        (item) => item.executionState.code === "esperando_interno",
      ).length,
      blockedOpportunities: executionItems.filter(
        (item) => item.executionState.code === "bloqueada",
      ).length,
      activeCadences: activeCadences.length,
      openDependencies: dependencyRows.length,
      overdueDependencies: dependencyRows.filter(
        (row) => row.due_date && getDiffDays(row.due_date) > 0,
      ).length,
      pendingInteractions: pendingInteractions.length,
    };

    const priorityItems = buildPriorityItems(executionItems, planningSnapshot);
    const quarterPipeline = buildPipelineByStage(
      executionItems.filter((item) =>
        isDateWithinQuarter(
          item.closeDate,
          planningSnapshot.period.year,
          planningSnapshot.period.quarter,
        ),
      ),
      planningSnapshot.quota.gapAmount,
    );
    const developmentRecommendations = buildDevelopmentRecommendations({
      summary,
      planningSnapshot,
      priorities: priorityItems,
      quarterPipeline,
    });
    const actionsToday = buildActionsToday({
      priorities: priorityItems,
      activeCadences,
      pendingInteractions,
    });

    res.json({
      summary,
      workboard: executionItems,
      followUps,
      risks: highRisks,
      cadences: {
        active: activeCadences,
        suggested: suggestedCadences,
        totalSuggested: suggestedCadences.length,
        activateCount,
        watchCount,
        visibleLimit: CADENCE_VISIBLE_LIMIT,
      },
      pendingInteractions,
      management: {
        sellerStats,
        stageStats,
        executionStateStats,
        dependencyStats,
      },
      development: {
        period: planningSnapshot.period,
        periods: developmentPeriods,
        quota: planningSnapshot.quota,
        sellerSnapshots: planningSnapshot.sellerSnapshots,
        pipelineByStage: quarterPipeline,
        priorities: priorityItems.slice(0, DEVELOPMENT_PRIORITY_LIMIT),
        recommendations: developmentRecommendations,
        actionsToday,
      },
    });
  },
);

router.get(
  "/calendar",
  requireAnyPermission([
    "calendario_comercial.read",
    "calendario_comercial.update",
  ]),
  requirePermission("oportunidades.read"),
  async (req, res) => {
    const view = String(req.query?.view || "week").trim();
    if (!["day", "week", "month"].includes(view)) {
      return res.status(400).json({ message: "view invalido" });
    }

    const date = String(req.query?.date || "").trim();
    const includeCompleted =
      String(req.query?.includeCompleted || "false") === "true";
    const slaDays = resolveCalendarSlaDays(req.query?.slaDays);
    const sellerUserId = resolveCalendarSellerScope(
      req.user,
      req.query?.sellerUserId,
    );
    const hasQuarterFilter =
      req.query?.year !== undefined || req.query?.quarter !== undefined;
    const quarterSelection = hasQuarterFilter
      ? resolveQuarterSelection(req.query)
      : { year: null, quarter: null };
    const businessTimezone = await loadBusinessTimezone();

    const [calendarData, sellerOptions, insights] = await Promise.all([
      listCommercialCalendarActivities({
        user: req.user,
        view,
        date,
        includeCompleted,
        sellerUserId,
        year: quarterSelection.year,
        quarter: quarterSelection.quarter,
        timeZone: businessTimezone,
      }),
      listCalendarSellerOptions(req.user),
      buildCommercialCalendarInsights({
        user: req.user,
        sellerUserId,
        slaDays,
        timeZone: businessTimezone,
      }),
    ]);

    return res.json({
      ...calendarData,
      sellerScope: hasCalendarGlobalScope(req.user) ? "all" : "self",
      selectedSellerUserId: sellerUserId,
      sellers: sellerOptions,
      slaConfig: {
        days: slaDays,
        minDays: CALENDAR_MIN_SLA_DAYS,
        maxDays: CALENDAR_MAX_SLA_DAYS,
      },
      businessTimezone,
      myDay: insights.myDay,
      alerts: insights.alerts,
      indicators: insights.indicators,
    });
  },
);

router.get(
  "/opportunities/:id/ai-narrative/latest",
  requireAnyPermission([
    "desarrollo_comercial.read",
    "desarrollo_comercial.update",
  ]),
  requirePermission("oportunidades.read"),
  async (req, res) => {
    const businessTimezone = await loadBusinessTimezone();
    const opportunityId = Number(req.params.id);
    if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }

    const opportunity = await loadOpportunityForExecution(
      req.user,
      opportunityId,
    );
    if (!opportunity) {
      return res.status(404).json({ message: "Oportunidad no encontrada" });
    }

    const latestNarratives = await listLatestCommercialNarrativesByOpportunity([
      opportunityId,
    ]);
    const latest = latestNarratives.get(opportunityId) || null;
    if (latest) {
      return res.json({
        found: true,
        ...latest,
      });
    }

    const narrativeItem = await buildExecutionNarrativeItem({
      user: req.user,
      opportunity,
    });
    const fallback = narrativeItem
      ? buildOpportunityNarrativeFallback(narrativeItem)
      : {
          aiStatusSummary: "Sin lectura operativa disponible.",
          aiNextStepRecommendation:
            "Completa datos clave para generar una estrategia accionable.",
          aiRecommendedAction: null,
          aiNarrativeSource: "fallback",
        };

    return res.json({
      found: false,
      aiStatusSummary: String(fallback.aiStatusSummary || "").trim(),
      aiNextStepRecommendation: String(
        fallback.aiNextStepRecommendation || "",
      ).trim(),
      aiRecommendedAction: fallback.aiRecommendedAction || null,
      aiContract: fallback.aiContract || null,
      aiNarrativeSource: String(
        fallback.aiNarrativeSource || "fallback",
      ).trim(),
      aiNarrativeGeneratedAt: null,
    });
  },
);

router.post(
  "/opportunities/:id/ai-narrative/jobs",
  requireAnyPermission([
    "desarrollo_comercial.read",
    "desarrollo_comercial.update",
  ]),
  requirePermission("oportunidades.read"),
  async (req, res) => {
    const opportunityId = Number(req.params.id);
    if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }

    await ensureCommercialNarrativeJobSchema();

    try {
      const forceRegenerate = Boolean(req.body?.forceRegenerate);
      const result = await createOrReuseCommercialNarrativeJob({
        opportunityId,
        requestedByUserId: Number(req.user.id),
        user: req.user,
        forceRegenerate,
      });
      let responsePayload = result.response;
      if (!result.wasReused) {
        queueCommercialNarrativeProcessing();
        await processPendingCommercialNarrativeJobs({ limit: 1 });

        const refreshedJob = await getCommercialNarrativeJob({
          publicId: String(result.response?.job?.id || "").trim(),
          opportunityId,
        });
        if (refreshedJob) {
          responsePayload = refreshedJob;
        }
      }

      return res
        .status(responsePayload?.result ? 200 : 202)
        .json(responsePayload);
    } catch (error) {
      return res.status(error?.status || 500).json({
        message:
          String(error?.message || "").trim() ||
          "No fue posible preparar la narrativa IA",
      });
    }
  },
);

router.get(
  "/opportunities/:id/ai-narrative/jobs/:jobId",
  requireAnyPermission([
    "desarrollo_comercial.read",
    "desarrollo_comercial.update",
  ]),
  requirePermission("oportunidades.read"),
  async (req, res) => {
    const opportunityId = Number(req.params.id);
    const jobId = String(req.params.jobId || "").trim();
    if (!Number.isInteger(opportunityId) || opportunityId <= 0 || !jobId) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }

    const opportunity = await loadOpportunityForExecution(
      req.user,
      opportunityId,
    );
    if (!opportunity) {
      return res.status(404).json({ message: "Oportunidad no encontrada" });
    }

    await ensureCommercialNarrativeJobSchema();
    const job = await getCommercialNarrativeJob({
      publicId: jobId,
      opportunityId,
    });
    if (!job) {
      return res.status(404).json({ message: "Job no encontrado" });
    }

    return res.json(job);
  },
);

router.post(
  "/opportunities/:id/ai-narrative/direct",
  requireAnyPermission([
    "desarrollo_comercial.read",
    "desarrollo_comercial.update",
  ]),
  requirePermission("oportunidades.read"),
  async (req, res) => {
    const opportunityId = Number(req.params.id);
    if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }

    try {
      const execution = await executeCommercialOpportunityNarrative({
        user: req.user,
        opportunityId,
      });
      return res.json({
        result: execution?.result || null,
      });
    } catch (error) {
      return res.status(error?.status || 500).json({
        message:
          String(error?.message || "").trim() ||
          "No fue posible generar la narrativa IA de forma directa",
      });
    }
  },
);

router.post(
  "/opportunities/:id/ai-narrative",
  requireAnyPermission([
    "desarrollo_comercial.read",
    "desarrollo_comercial.update",
  ]),
  requirePermission("oportunidades.read"),
  async (req, res) => {
    const opportunityId = Number(req.params.id);
    if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }

    try {
      const forceRegenerate = Boolean(req.body?.forceRegenerate);
      const result = await createOrReuseCommercialNarrativeJob({
        user: req.user,
        opportunityId,
        requestedByUserId: Number(req.user.id),
        forceRegenerate,
      });
      let responsePayload = result.response;
      if (!result.wasReused) {
        queueCommercialNarrativeProcessing();
        await processPendingCommercialNarrativeJobs({ limit: 1 });

        const refreshedJob = await getCommercialNarrativeJob({
          publicId: String(result.response?.job?.id || "").trim(),
          opportunityId,
        });
        if (refreshedJob) {
          responsePayload = refreshedJob;
        }
      }
      return res
        .status(responsePayload?.result ? 200 : 202)
        .json(responsePayload);
    } catch (error) {
      return res.status(error?.status || 500).json({
        message:
          String(error?.message || "").trim() ||
          "No fue posible generar la narrativa IA",
      });
    }
  },
);

router.get(
  "/opportunities/:id/activities/:activityId",
  requireAnyPermission([
    "desarrollo_comercial.read",
    "desarrollo_comercial.update",
    "calendario_comercial.read",
    "calendario_comercial.update",
  ]),
  requirePermission("oportunidades.read"),
  async (req, res) => {
    const opportunityId = Number(req.params.id);
    const activityId = Number(req.params.activityId);
    if (
      !Number.isInteger(opportunityId) ||
      opportunityId <= 0 ||
      !Number.isInteger(activityId) ||
      activityId <= 0
    ) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }

    const opportunity = await loadOpportunityForExecution(
      req.user,
      opportunityId,
    );
    if (!opportunity) {
      return res.status(404).json({ message: "Oportunidad no encontrada" });
    }

    const activity = await loadCommercialActivityAction(
      opportunityId,
      activityId,
    );
    if (!activity) {
      return res.status(404).json({ message: "Actividad no encontrada" });
    }

    const parsedDetails = parseCommercialActionDetails(activity.details_json);
    const entryKind = getCommercialEntryKind(activity.action_type);
    const nextStatus = String(activity.status || "pending").trim();

    return res.json({
      id: Number(activity.id),
      opportunityId,
      opportunityName: opportunity.name || "",
      accountName: opportunity.accountName || "",
      entryKind,
      activityType: String(activity.action_type || "other").trim() || "other",
      status: nextStatus || "pending",
      scheduledAt: activity.scheduled_at || null,
      dueDate: activity.due_date || null,
      objective: String(activity.title || "").trim(),
      note: String(activity.notes || "").trim(),
      priority: String(activity.priority || "medium").trim() || "medium",
      successCriteria: String(activity.success_criteria || "").trim(),
      isPrimaryNextStep: Boolean(activity.is_primary_next_step),
      details: parsedDetails,
      readonlyByStatus: ["done", "cancelled"].includes(nextStatus),
    });
  },
);

router.post(
  "/opportunities/:id/activities",
  requirePermission("desarrollo_comercial.update"),
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const businessTimezone = await loadBusinessTimezone();
    const opportunityId = Number(req.params.id);
    if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
      return res.status(400).json({ message: "Oportunidad invalida" });
    }

    const opportunity = await loadOpportunityForExecution(
      req.user,
      opportunityId,
    );
    if (!opportunity) {
      return res.status(404).json({ message: "Oportunidad no encontrada" });
    }

    const activityType = String(
      req.body?.activityType || req.body?.entryType || "",
    ).trim();
    const entryKind =
      String(
        req.body?.entryKind || getCommercialEntryKind(activityType),
      ).trim() === "action"
        ? "action"
        : "activity";
    const scheduledAtRaw = String(req.body?.scheduledAt || "").trim();
    const dueDateRaw = String(req.body?.dueDate || "").trim();
    const objective = String(req.body?.objective || "").trim();
    const note = String(req.body?.note || "").trim();
    const priority = String(req.body?.priority || "medium").trim() || "medium";
    const isPrimaryNextStep = Boolean(req.body?.isPrimaryNextStep);
    const successCriteria = String(
      req.body?.successCriteria || req.body?.details?.expectedResponse || "",
    ).trim();
    const details =
      req.body?.details && typeof req.body.details === "object"
        ? req.body.details
        : null;

    if (
      (entryKind === "activity" &&
        !COMMERCIAL_ACTIVITY_ACTION_TYPES.has(activityType)) ||
      (entryKind === "action" &&
        !COMMERCIAL_ACTION_ITEM_TYPES.has(activityType))
    ) {
      return res.status(400).json({ message: "activityType invalido" });
    }
    if (!objective) {
      return res.status(400).json({ message: "El objetivo es obligatorio" });
    }

    let scheduledAt = null;
    let dueDate = null;

    if (entryKind === "activity") {
      if (!scheduledAtRaw) {
        return res.status(400).json({ message: "scheduledAt es obligatorio" });
      }
      scheduledAt = toBusinessDateTimeUtc(scheduledAtRaw, businessTimezone);
      if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
        return res.status(400).json({ message: "scheduledAt invalido" });
      }
      dueDate = formatDateInTimeZone(scheduledAt, businessTimezone);
    } else {
      dueDate = dueDateRaw || scheduledAtRaw.slice(0, 10);
      if (!dueDate) {
        return res.status(400).json({ message: "dueDate es obligatorio" });
      }
    }

    const actionId = await saveOpportunityAction({
      opportunityId,
      actionId: null,
      payload: {
        linked_stage_id: Number(opportunity.sales_stage_id),
        action_type: activityType,
        priority: isPrimaryNextStep ? "high" : priority,
        title: objective,
        owner_user_id: Number(req.user.id),
        due_date: dueDate,
        scheduled_at: scheduledAt,
        success_criteria: successCriteria || "",
        notes: note || null,
        is_primary_next_step: isPrimaryNextStep ? 1 : 0,
        details_json: details ? JSON.stringify(details) : null,
        status: "pending",
      },
      userId: Number(req.user.id),
    });

    if (isPrimaryNextStep) {
      await clearPrimaryNextStepActions(opportunityId, actionId);
    }

    await logAuditEvent({
      req,
      module: "opportunities.workspace",
      action:
        entryKind === "activity"
          ? "workspace_activity_created"
          : "workspace_action_created",
      entityType: "opportunity",
      entityId: opportunityId,
      detail:
        entryKind === "activity"
          ? `Actividad programada: ${objective}`
          : `Accion creada: ${objective}`,
      after: {
        actionId,
        entryKind,
        activityType,
        objective,
        scheduledAt,
        dueDate,
        isPrimaryNextStep,
      },
    });

    return res.status(201).json({
      id: actionId,
      message:
        entryKind === "activity" ? "Actividad programada" : "Accion creada",
    });
  },
);

router.patch(
  "/opportunities/:id/activities/:activityId",
  requirePermission("desarrollo_comercial.update"),
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const businessTimezone = await loadBusinessTimezone();
    const opportunityId = Number(req.params.id);
    const activityId = Number(req.params.activityId);
    if (
      !Number.isInteger(opportunityId) ||
      opportunityId <= 0 ||
      !Number.isInteger(activityId) ||
      activityId <= 0
    ) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }

    const opportunity = await loadOpportunityForExecution(
      req.user,
      opportunityId,
    );
    if (!opportunity) {
      return res.status(404).json({ message: "Oportunidad no encontrada" });
    }

    const currentActivity = await loadCommercialActivityAction(
      opportunityId,
      activityId,
    );
    if (!currentActivity) {
      return res.status(404).json({ message: "Actividad no encontrada" });
    }

    const nextActivityType =
      req.body?.activityType === undefined
        ? String(currentActivity.action_type || "")
        : String(req.body.activityType || "").trim();
    const nextEntryKind =
      String(
        req.body?.entryKind || getCommercialEntryKind(nextActivityType),
      ).trim() === "action"
        ? "action"
        : "activity";
    const nextObjective =
      req.body?.objective === undefined
        ? String(currentActivity.title || "")
        : String(req.body.objective || "").trim();
    const nextNote =
      req.body?.note === undefined
        ? String(currentActivity.notes || "")
        : String(req.body.note || "").trim();
    const scheduledAtRaw =
      req.body?.scheduledAt === undefined
        ? currentActivity.scheduled_at || currentActivity.due_date || null
        : String(req.body.scheduledAt || "").trim();
    const dueDateRaw =
      req.body?.dueDate === undefined
        ? currentActivity.due_date || null
        : String(req.body.dueDate || "").trim();
    const nextStatus =
      req.body?.status === undefined
        ? String(currentActivity.status || "pending")
        : String(req.body.status || "").trim();
    const nextPriority =
      req.body?.priority === undefined
        ? String(currentActivity.priority || "medium")
        : String(req.body.priority || "medium").trim();
    const nextSuccessCriteria =
      req.body?.successCriteria === undefined
        ? String(currentActivity.success_criteria || "")
        : String(req.body.successCriteria || "").trim();
    const nextDetails =
      req.body?.details === undefined
        ? currentActivity.details_json
          ? typeof currentActivity.details_json === "string"
            ? JSON.parse(currentActivity.details_json)
            : currentActivity.details_json
          : null
        : req.body?.details && typeof req.body.details === "object"
          ? req.body.details
          : null;

    if (
      (nextEntryKind === "activity" &&
        !COMMERCIAL_ACTIVITY_ACTION_TYPES.has(nextActivityType)) ||
      (nextEntryKind === "action" &&
        !COMMERCIAL_ACTION_ITEM_TYPES.has(nextActivityType))
    ) {
      return res.status(400).json({ message: "activityType invalido" });
    }
    if (!nextObjective) {
      return res.status(400).json({ message: "El objetivo es obligatorio" });
    }
    if (
      !(nextEntryKind === "activity"
        ? COMMERCIAL_ACTIVITY_STATUSES.has(nextStatus)
        : COMMERCIAL_ACTION_STATUSES.has(nextStatus))
    ) {
      return res.status(400).json({ message: "status invalido" });
    }

    let scheduledAt = null;
    let dueDate = null;

    if (nextEntryKind === "activity") {
      if (!scheduledAtRaw) {
        return res.status(400).json({ message: "scheduledAt es obligatorio" });
      }
      scheduledAt =
        scheduledAtRaw instanceof Date
          ? new Date(scheduledAtRaw)
          : toBusinessDateTimeUtc(scheduledAtRaw, businessTimezone);
      if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
        return res.status(400).json({ message: "scheduledAt invalido" });
      }
      dueDate = formatDateInTimeZone(scheduledAt, businessTimezone);
    } else {
      dueDate = String(dueDateRaw || "").trim();
      if (!dueDate) {
        return res.status(400).json({ message: "dueDate es obligatorio" });
      }
    }

    const isOpenStatus =
      nextEntryKind === "activity"
        ? COMMERCIAL_ACTIVITY_OPEN_STATUSES.has(nextStatus)
        : COMMERCIAL_ACTION_OPEN_STATUSES.has(nextStatus);
    const nextIsPrimaryNextStep =
      isOpenStatus && req.body?.isPrimaryNextStep !== undefined
        ? Boolean(req.body.isPrimaryNextStep)
        : isOpenStatus && Boolean(currentActivity.is_primary_next_step);

    await saveOpportunityAction({
      opportunityId,
      actionId: activityId,
      payload: {
        linked_stage_id: Number(
          currentActivity.linked_stage_id || opportunity.sales_stage_id,
        ),
        action_type: nextActivityType,
        priority: nextIsPrimaryNextStep ? "high" : nextPriority,
        title: nextObjective,
        owner_user_id:
          currentActivity.owner_user_id === null
            ? Number(req.user.id)
            : Number(currentActivity.owner_user_id),
        due_date: dueDate,
        scheduled_at: scheduledAt,
        success_criteria: nextSuccessCriteria || "",
        notes: nextNote || null,
        is_primary_next_step: nextIsPrimaryNextStep ? 1 : 0,
        details_json: nextDetails ? JSON.stringify(nextDetails) : null,
        status: nextStatus,
      },
      userId: Number(req.user.id),
    });

    if (nextIsPrimaryNextStep) {
      await clearPrimaryNextStepActions(opportunityId, activityId);
    }

    await logAuditEvent({
      req,
      module: "opportunities.workspace",
      action:
        nextStatus === "done"
          ? nextEntryKind === "activity"
            ? "workspace_activity_completed"
            : "workspace_action_completed"
          : nextEntryKind === "activity"
            ? "workspace_activity_updated"
            : "workspace_action_updated",
      entityType: "opportunity",
      entityId: opportunityId,
      detail:
        nextStatus === "done"
          ? nextEntryKind === "activity"
            ? `Actividad realizada: ${nextObjective}`
            : `Accion realizada: ${nextObjective}`
          : nextEntryKind === "activity"
            ? `Actividad actualizada: ${nextObjective}`
            : `Accion actualizada: ${nextObjective}`,
      after: {
        actionId: activityId,
        entryKind: nextEntryKind,
        activityType: nextActivityType,
        objective: nextObjective,
        scheduledAt,
        dueDate,
        status: nextStatus,
        isPrimaryNextStep: nextIsPrimaryNextStep,
      },
    });

    return res.json({
      id: activityId,
      message:
        nextStatus === "done"
          ? nextEntryKind === "activity"
            ? "Actividad marcada como realizada"
            : "Accion marcada como realizada"
          : nextEntryKind === "activity"
            ? "Actividad actualizada"
            : "Accion actualizada",
    });
  },
);

router.patch(
  "/opportunities/:id/activities/:activityId/email-draft",
  requirePermission("desarrollo_comercial.update"),
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const opportunityId = Number(req.params.id);
    const activityId = Number(req.params.activityId);
    if (
      !Number.isInteger(opportunityId) ||
      opportunityId <= 0 ||
      !Number.isInteger(activityId) ||
      activityId <= 0
    ) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }

    const context = await loadCommercialSendEmailContext({
      req,
      opportunityId,
      activityId,
    });
    if (context.error) {
      return res
        .status(context.error.status)
        .json({ message: context.error.message });
    }

    if (
      !COMMERCIAL_ACTION_OPEN_STATUSES.has(
        String(context.currentActivity.status || ""),
      )
    ) {
      return res.status(409).json({
        message:
          "Solo puedes editar el borrador mientras la accion siga abierta",
      });
    }

    const nextDetails = normalizeCommercialEmailDraft({
      ...context.details,
      ...(req.body?.details && typeof req.body.details === "object"
        ? req.body.details
        : {}),
      lastDraftSavedAt: new Date().toISOString(),
      lastDraftSavedByUserId: Number(req.user.id),
      lastDraftSavedByUserName: String(
        req.user.full_name || req.user.name || "",
      ),
      lastSendError: "",
    });

    if (
      !nextDetails.recipient ||
      !nextDetails.subject ||
      !nextDetails.messageBody
    ) {
      return res.status(400).json({
        message: "Destinatario, asunto y mensaje base son obligatorios",
      });
    }

    const title = await persistCommercialEmailDraft({
      opportunity: context.opportunity,
      currentActivity: context.currentActivity,
      details: nextDetails,
      req,
      status: String(context.currentActivity.status || "pending"),
    });

    await logAuditEvent({
      req,
      module: "opportunities.workspace",
      action: "workspace_send_email_draft_saved",
      entityType: "opportunity",
      entityId: opportunityId,
      detail: `Borrador de correo actualizado: ${title}`,
      after: {
        actionId: activityId,
        recipient: nextDetails.recipient,
        subject: nextDetails.subject,
      },
    });

    return res.json({
      id: activityId,
      message: "Borrador guardado",
      details: nextDetails,
    });
  },
);

router.get(
  "/opportunities/:id/email-attachments/options",
  requirePermission("desarrollo_comercial.update"),
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const opportunityId = Number(req.params.id);
    if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }

    const opportunity = await loadOpportunityForExecution(
      req.user,
      opportunityId,
    );
    if (!opportunity) {
      return res.status(404).json({ message: "Oportunidad no encontrada" });
    }

    const options = await loadCommercialEmailAttachmentOptions({
      user: req.user,
      opportunityId,
      libraryFilters: {
        q: req.query?.q,
        manufacturerCodes: req.query?.manufacturerCodes,
        solutionCodes: req.query?.solutionCodes,
        industryCodes: req.query?.industryCodes,
        sort: req.query?.sort,
      },
    });
    const opportunityDocuments = await listOpportunityDocuments({
      opportunityId,
    }).catch(() => []);

    return res.json({
      ...options,
      opportunityDocuments: opportunityDocuments
        .filter((document) =>
          isCommercialEmailAttachmentMimeTypeAllowed(document.mimeType),
        )
        .map((document) => ({
          id: `opportunity:${document.publicId}`,
          sourceType: "opportunity_document",
          sourceLabel: "Documento cargado",
          documentPublicId: document.publicId,
          fileName: document.originalFileName || "documento",
          mimeType: document.mimeType || "application/octet-stream",
          byteSize: Number(document.byteSize || 0),
          createdAt: document.createdAt,
        })),
    });
  },
);

router.post(
  "/opportunities/:id/email-attachment-suggestions",
  requirePermission("desarrollo_comercial.update"),
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const opportunityId = Number(req.params.id);
    if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }

    const opportunity = await loadOpportunityForExecution(
      req.user,
      opportunityId,
    );
    if (!opportunity) {
      return res.status(404).json({ message: "Oportunidad no encontrada" });
    }

    const details = normalizeCommercialEmailDraft(
      req.body?.details && typeof req.body.details === "object"
        ? req.body.details
        : {},
    );
    const selectedIds = new Set(
      (Array.isArray(details.attachments) ? details.attachments : [])
        .filter((attachment) => attachment?.sourceType === "library_file")
        .map((attachment) => String(attachment.id || "").trim())
        .filter(Boolean),
    );

    const options = await loadCommercialEmailAttachmentOptions({
      user: req.user,
      opportunityId,
      libraryFilters: {
        q: "",
      },
    });

    const candidateLibraryFiles = (
      Array.isArray(options?.libraryFiles) ? options.libraryFiles : []
    )
      .filter((file) => file?.id && !selectedIds.has(String(file.id).trim()))
      .slice(0, 60);

    if (!candidateLibraryFiles.length) {
      return res.json({
        source: "fallback",
        suggestions: [],
      });
    }

    try {
      const result = await requestCommercialAttachmentSuggestionsWithAi({
        opportunity,
        details,
        libraryFiles: candidateLibraryFiles,
        aiUsageContext: req.user?.id
          ? {
              userId: Number(req.user.id),
              featureCode:
                "commercial_development.email_attachment_suggestions",
              jobType: "commercial_email_attachment_suggestions",
              jobId: Number(opportunity.id),
              internalRequestId: `commercial_email_attachment_suggestions:${Number(opportunity.id)}:${Date.now()}`,
            }
          : null,
      });

      return res.json({
        source: String(result?.source || "fallback"),
        suggestions: (Array.isArray(result?.suggestions)
          ? result.suggestions
          : []
        )
          .slice(0, COMMERCIAL_EMAIL_LIBRARY_SUGGESTION_MAX_FILES)
          .map((file) => ({
            id: String(file.id || "").trim(),
            sourceType: "library_file",
            sourceLabel: String(file.sourceLabel || "Biblioteca").trim(),
            resourcePublicId: String(file.resourcePublicId || "").trim(),
            filePublicId: String(file.filePublicId || "").trim(),
            fileName: String(file.fileName || "archivo").trim(),
            mimeType: String(
              file.mimeType || "application/octet-stream",
            ).trim(),
            byteSize:
              file.byteSize === null || file.byteSize === undefined
                ? null
                : Number(file.byteSize),
            title: String(file.title || "").trim(),
            summary: String(file.summary || "").trim(),
            assetTypeLabel: String(file.assetTypeLabel || "").trim(),
            reason: String(file.reason || "").trim(),
          }))
          .filter(
            (file) => file.id && file.resourcePublicId && file.filePublicId,
          ),
      });
    } catch (error) {
      if (config.nodeEnv !== "test") {
        console.error(
          "Commercial email attachment suggestion AI error:",
          error?.message || error,
        );
      }

      const fallbackSuggestions = buildCommercialAttachmentSuggestionsFallback({
        libraryFiles: candidateLibraryFiles,
        details,
      });

      return res.json({
        source: "fallback",
        suggestions: fallbackSuggestions
          .slice(0, COMMERCIAL_EMAIL_LIBRARY_SUGGESTION_MAX_FILES)
          .map((file) => ({
            id: String(file.id || "").trim(),
            sourceType: "library_file",
            sourceLabel: String(file.sourceLabel || "Biblioteca").trim(),
            resourcePublicId: String(file.resourcePublicId || "").trim(),
            filePublicId: String(file.filePublicId || "").trim(),
            fileName: String(file.fileName || "archivo").trim(),
            mimeType: String(
              file.mimeType || "application/octet-stream",
            ).trim(),
            byteSize:
              file.byteSize === null || file.byteSize === undefined
                ? null
                : Number(file.byteSize),
            title: String(file.title || "").trim(),
            summary: String(file.summary || "").trim(),
            assetTypeLabel: String(file.assetTypeLabel || "").trim(),
            reason: String(file.reason || "").trim(),
          }))
          .filter(
            (file) => file.id && file.resourcePublicId && file.filePublicId,
          ),
      });
    }
  },
);

router.post(
  "/opportunities/:id/email-suggestion",
  requirePermission("desarrollo_comercial.update"),
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const opportunityId = Number(req.params.id);
    if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }

    const opportunity = await loadOpportunityForExecution(
      req.user,
      opportunityId,
    );
    if (!opportunity) {
      return res.status(404).json({ message: "Oportunidad no encontrada" });
    }

    const details = normalizeCommercialEmailDraft(
      req.body?.details && typeof req.body.details === "object"
        ? req.body.details
        : {},
    );
    const selectedLibraryAttachments = (
      Array.isArray(details.attachments) ? details.attachments : []
    ).filter((attachment) => attachment?.sourceType === "library_file");
    if (selectedLibraryAttachments.length > 3) {
      return res.status(400).json({
        message:
          "Solo puedes seleccionar hasta 3 activos de biblioteca para la sugerencia IA.",
      });
    }
    const accountContactsByAccountId = await listContactsByAccountIds([
      Number(opportunity.account_id),
    ]);
    const recipientName = resolveCommercialRecipientName(
      details,
      accountContactsByAccountId.get(Number(opportunity.account_id)) || [],
    );

    const fallbackSuggestion = buildCommercialEmailSuggestionFallback(
      opportunity,
      details,
      recipientName,
    );

    try {
      const result = await requestCommercialEmailSuggestionWithAi({
        opportunity,
        details,
        recipientName,
        aiUsageContext: req.user?.id
          ? {
              userId: Number(req.user.id),
              featureCode: "commercial_development.email_suggestion",
              jobType: "commercial_email_suggestion",
              jobId: Number(opportunity.id),
              internalRequestId: `commercial_email_suggestion:${Number(opportunity.id)}:${Date.now()}`,
            }
          : null,
      });

      return res.json({
        subject: String(result?.subject || fallbackSuggestion.subject).trim(),
        messageBody: String(
          result?.messageBody || fallbackSuggestion.messageBody,
        ).trim(),
        source: String(
          result?.source || fallbackSuggestion.source || "fallback",
        ).trim(),
        sourceReason: String(result?.sourceReason || "").trim(),
      });
    } catch (error) {
      if (config.nodeEnv !== "test") {
        console.error(
          "Commercial email suggestion AI error:",
          error?.message || error,
        );
      }

      const fallbackReason =
        String(error?.code || "").trim() === "AI_BUDGET_EXCEEDED"
          ? "ai_budget_exceeded"
          : String(error?.message || "").includes("OpenAI request failed")
            ? "openai_request_failed"
            : "ai_generation_error";

      return res.json({
        ...fallbackSuggestion,
        source: "fallback",
        sourceReason: fallbackReason,
      });
    }
  },
);

router.post(
  "/opportunities/:id/activities/:activityId/send-email",
  requirePermission("desarrollo_comercial.update"),
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const opportunityId = Number(req.params.id);
    const activityId = Number(req.params.activityId);
    if (
      !Number.isInteger(opportunityId) ||
      opportunityId <= 0 ||
      !Number.isInteger(activityId) ||
      activityId <= 0
    ) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }

    const context = await loadCommercialSendEmailContext({
      req,
      opportunityId,
      activityId,
    });
    if (context.error) {
      return res
        .status(context.error.status)
        .json({ message: context.error.message });
    }

    if (
      !COMMERCIAL_ACTION_OPEN_STATUSES.has(
        String(context.currentActivity.status || ""),
      )
    ) {
      return res.status(409).json({
        message: "La accion ya no esta abierta para envio",
      });
    }

    const nextDetails = normalizeCommercialEmailDraft({
      ...context.details,
      ...(req.body?.details && typeof req.body.details === "object"
        ? req.body.details
        : {}),
    });

    if (
      !nextDetails.recipient ||
      !nextDetails.subject ||
      !nextDetails.messageBody
    ) {
      return res.status(400).json({
        message: "Destinatario, asunto y mensaje base son obligatorios",
      });
    }

    const attachmentValidationError = validateCommercialEmailAttachments(
      nextDetails.attachments,
    );
    if (attachmentValidationError) {
      return res.status(400).json({ message: attachmentValidationError });
    }

    const resolvedAttachments = await resolveCommercialEmailAttachments({
      user: req.user,
      opportunity: context.opportunity,
      details: nextDetails,
    });

    const replyToEmail = String(
      context.opportunity.seller_user_email || req.user.email || "",
    ).trim();
    const mailResult = await sendCommercialActionEmail({
      to: nextDetails.recipient,
      cc: splitEmailList(nextDetails.cc),
      replyTo: replyToEmail,
      subject: nextDetails.subject,
      messageBody: nextDetails.messageBody,
      attachmentsNote: nextDetails.attachmentsNote,
      attachments: resolvedAttachments,
      metadataLines: [
        nextDetails.expectedResponse
          ? `Respuesta esperada: ${nextDetails.expectedResponse}`
          : "",
        nextDetails.responseDueDate
          ? `Fecha limite de respuesta: ${nextDetails.responseDueDate}`
          : "",
      ],
    });

    if (!mailResult.sent) {
      return res.status(502).json({
        message:
          mailResult.detail || "No fue posible enviar el correo comercial",
        reason: mailResult.reason || "smtp_send_failed",
      });
    }

    const sentAt = new Date().toISOString();
    nextDetails.sentAt = sentAt;
    nextDetails.sentByUserId = Number(req.user.id);
    nextDetails.sentByUserName = String(
      req.user.full_name || req.user.name || "",
    );
    nextDetails.lastSendStatus = "sent";
    nextDetails.lastSendError = "";
    nextDetails.lastDraftSavedAt = sentAt;
    nextDetails.lastDraftSavedByUserId = Number(req.user.id);
    nextDetails.lastDraftSavedByUserName = String(
      req.user.full_name || req.user.name || "",
    );
    nextDetails.lastRecipientSnapshot = nextDetails.recipient;
    nextDetails.lastSubjectSnapshot = nextDetails.subject;
    nextDetails.replyToEmail = replyToEmail;

    const nextStatus = nextDetails.markDoneOnSend ? "done" : "in_progress";
    const title = await persistCommercialEmailDraft({
      opportunity: context.opportunity,
      currentActivity: context.currentActivity,
      details: nextDetails,
      req,
      status: nextStatus,
    });

    await logAuditEvent({
      req,
      module: "opportunities.workspace",
      action: "workspace_send_email_sent",
      entityType: "opportunity",
      entityId: opportunityId,
      detail: `Correo enviado desde accion: ${title}`,
      after: {
        actionId: activityId,
        recipient: nextDetails.recipient,
        subject: nextDetails.subject,
        attachmentCount: nextDetails.attachments.length,
        status: nextStatus,
        sentAt,
      },
    });

    return res.json({
      id: activityId,
      message: "Correo enviado",
      status: nextStatus,
      details: nextDetails,
    });
  },
);

router.post(
  "/opportunities/:id/next-step",
  requirePermission("desarrollo_comercial.update"),
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const opportunityId = Number(req.params.id);
    if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
      return res.status(400).json({ message: "Oportunidad invalida" });
    }

    const opportunity = await loadOpportunityForExecution(
      req.user,
      opportunityId,
    );
    if (!opportunity) {
      return res.status(404).json({ message: "Oportunidad no encontrada" });
    }

    const title = String(req.body?.title || "").trim();
    const dueDate = req.body?.dueDate ? String(req.body.dueDate) : null;
    const successCriteria = String(req.body?.successCriteria || "").trim();
    const ownerUserId = req.body?.ownerUserId
      ? Number(req.body.ownerUserId)
      : null;
    const actionType = String(req.body?.actionType || "next_step").trim();

    if (!title) {
      return res
        .status(400)
        .json({ message: "El proximo paso requiere titulo" });
    }
    if (!NEXT_STEP_ACTION_TYPES.has(actionType)) {
      return res.status(400).json({ message: "actionType invalido" });
    }

    const existingActionId = await findOpenNextStepAction(opportunityId);
    const actionId = await saveOpportunityAction({
      opportunityId,
      actionId: existingActionId,
      payload: {
        linked_stage_id: Number(opportunity.sales_stage_id),
        action_type: actionType,
        priority: "high",
        title,
        owner_user_id: ownerUserId,
        due_date: dueDate,
        is_primary_next_step: 1,
        success_criteria: successCriteria,
        status: "pending",
      },
      userId: Number(req.user.id),
    });

    await clearPrimaryNextStepActions(opportunityId, actionId);

    return res.status(existingActionId ? 200 : 201).json({
      id: actionId,
      message: existingActionId
        ? "Proximo paso actualizado"
        : "Proximo paso creado",
    });
  },
);

router.post(
  "/opportunities/:id/dependencies",
  requirePermission("desarrollo_comercial.update"),
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const opportunityId = Number(req.params.id);
    if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
      return res.status(400).json({ message: "Oportunidad invalida" });
    }

    const opportunity = await loadOpportunityForExecution(
      req.user,
      opportunityId,
    );
    if (!opportunity) {
      return res.status(404).json({ message: "Oportunidad no encontrada" });
    }

    const dependencyType = String(req.body?.dependencyType || "").trim();
    const title = String(req.body?.title || "").trim();
    const status = String(req.body?.status || "open").trim();
    if (!dependencyType || !DEPENDENCY_TYPE_LABELS[dependencyType]) {
      return res.status(400).json({ message: "dependencyType invalido" });
    }
    if (!title) {
      return res
        .status(400)
        .json({ message: "La dependencia requiere titulo" });
    }
    if (!["open", "blocked", "done"].includes(status)) {
      return res.status(400).json({ message: "status invalido" });
    }

    const dependencyId = await saveExecutionDependency({
      opportunityId,
      payload: {
        dependency_type: dependencyType,
        title,
        status,
        owner_user_id: req.body?.ownerUserId
          ? Number(req.body.ownerUserId)
          : null,
        due_date: req.body?.dueDate ? new Date(req.body.dueDate) : null,
        expected_outcome:
          String(req.body?.expectedOutcome || "").trim() || null,
        details: String(req.body?.details || "").trim() || null,
      },
      userId: Number(req.user.id),
    });

    return res.status(201).json({
      id: dependencyId,
      message: "Dependencia interna creada",
    });
  },
);

router.patch(
  "/dependencies/:id",
  requirePermission("desarrollo_comercial.update"),
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const dependencyId = Number(req.params.id);
    if (!Number.isInteger(dependencyId) || dependencyId <= 0) {
      return res.status(400).json({ message: "Dependencia invalida" });
    }

    const dependency = await loadDependencyForExecution(req.user, dependencyId);
    if (!dependency) {
      return res.status(404).json({ message: "Dependencia no encontrada" });
    }

    const payload = {};
    if (req.body?.status !== undefined) {
      const status = String(req.body.status).trim();
      if (!["open", "blocked", "done"].includes(status)) {
        return res.status(400).json({ message: "status invalido" });
      }
      payload.status = status;
    }
    if (req.body?.title !== undefined) {
      const title = String(req.body.title || "").trim();
      if (!title) {
        return res
          .status(400)
          .json({ message: "La dependencia requiere titulo" });
      }
      payload.title = title;
    }
    if (req.body?.dependencyType !== undefined) {
      const dependencyType = String(req.body.dependencyType || "").trim();
      if (!DEPENDENCY_TYPE_LABELS[dependencyType]) {
        return res.status(400).json({ message: "dependencyType invalido" });
      }
      payload.dependency_type = dependencyType;
    }
    if (req.body?.ownerUserId !== undefined) {
      payload.owner_user_id = req.body.ownerUserId
        ? Number(req.body.ownerUserId)
        : null;
    }
    if (req.body?.dueDate !== undefined) {
      payload.due_date = req.body.dueDate ? new Date(req.body.dueDate) : null;
    }
    if (req.body?.expectedOutcome !== undefined) {
      payload.expected_outcome =
        String(req.body.expectedOutcome || "").trim() || null;
    }
    if (req.body?.details !== undefined) {
      payload.details = String(req.body.details || "").trim() || null;
    }
    if (req.body?.resolutionNote !== undefined) {
      payload.resolution_note =
        String(req.body.resolutionNote || "").trim() || null;
    }

    await saveExecutionDependency({
      dependencyId,
      opportunityId: Number(dependency.opportunity_id),
      payload,
      userId: Number(req.user.id),
    });

    return res.json({ message: "Dependencia interna actualizada" });
  },
);

router.post(
  "/cadences",
  requirePermission("desarrollo_comercial.update"),
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const opportunityId = Number(req.body?.opportunityId);
    const cadenceType = String(req.body?.cadenceType || "").trim();
    if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
      return res.status(400).json({ message: "opportunityId invalido" });
    }
    if (!CADENCE_LIBRARY[cadenceType]) {
      return res.status(400).json({ message: "cadenceType invalido" });
    }

    const opportunity = await loadOpportunityForExecution(
      req.user,
      opportunityId,
    );
    if (!opportunity) {
      return res.status(404).json({ message: "Oportunidad no encontrada" });
    }

    const cadence = CADENCE_LIBRARY[cadenceType];
    const nextRunAt = req.body?.nextRunAt
      ? new Date(req.body.nextRunAt)
      : new Date();
    await query(
      `INSERT INTO commercial_execution_cadences
         (opportunity_id, cadence_type, title, status, current_step_index, steps_json,
          next_run_at, owner_user_id, notes, created_by_user_id, updated_by_user_id)
       VALUES (?, ?, ?, 'active', 0, ?, ?, ?, ?, ?, ?)`,
      [
        opportunityId,
        cadenceType,
        cadence.title,
        JSON.stringify(cadence.steps),
        Number.isNaN(nextRunAt.getTime()) ? null : nextRunAt,
        req.body?.ownerUserId ? Number(req.body.ownerUserId) : null,
        String(req.body?.notes || "").trim() || null,
        Number(req.user.id),
        Number(req.user.id),
      ],
    );

    return res.status(201).json({ message: "Cadencia activada" });
  },
);

router.patch(
  "/cadences/:id",
  requirePermission("desarrollo_comercial.update"),
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const cadenceId = Number(req.params.id);
    if (!Number.isInteger(cadenceId) || cadenceId <= 0) {
      return res.status(400).json({ message: "Cadencia invalida" });
    }

    const cadenceRows = await query(
      `SELECT id, status, current_step_index
       FROM commercial_execution_cadences
       WHERE id = ?
       LIMIT 1`,
      [cadenceId],
    );
    if (!cadenceRows[0]) {
      return res.status(404).json({ message: "Cadencia no encontrada" });
    }

    const status = req.body?.status
      ? String(req.body.status)
      : cadenceRows[0].status;
    const currentStepIndex = Number.isInteger(req.body?.currentStepIndex)
      ? Number(req.body.currentStepIndex)
      : Number(cadenceRows[0].current_step_index || 0);

    await query(
      `UPDATE commercial_execution_cadences
       SET status = ?,
           current_step_index = ?,
           next_run_at = ?,
           last_executed_at = ?,
           notes = ?,
           updated_by_user_id = ?,
           updated_at = NOW(3)
       WHERE id = ?`,
      [
        status,
        Math.max(0, currentStepIndex),
        req.body?.nextRunAt ? new Date(req.body.nextRunAt) : null,
        req.body?.lastExecutedAt ? new Date(req.body.lastExecutedAt) : null,
        String(req.body?.notes || "").trim() || null,
        Number(req.user.id),
        cadenceId,
      ],
    );

    return res.json({ message: "Cadencia actualizada" });
  },
);

export default router;
