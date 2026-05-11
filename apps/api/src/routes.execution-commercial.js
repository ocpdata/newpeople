import { buffer as streamToBuffer } from "node:stream/consumers";
import express from "express";
import { requirePermission } from "./auth.js";
import { logAuditEvent } from "./audit.js";
import {
  getCommercialEnablementAssetDetail,
  getCommercialEnablementFileStream,
  listCommercialEnablementAssets,
  loadCommercialEnablementRecommendationCatalog,
  recommendCommercialEnablementResources,
} from "./commercial-enablement/service.js";
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
import { getCompanyDocumentBranding } from "./settings.js";
import { sendCommercialActionEmail } from "./utils.js";

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
  propuesta: 6,
  cierre: 3,
};

const LATE_STAGE_CODES = new Set([
  "cotizacion",
  "demostracion",
  "negociacion",
  "waiting",
  "propuesta",
  "cierre",
]);

const CADENCE_VISIBLE_LIMIT = 10;
const DEVELOPMENT_PRIORITY_LIMIT = 12;
const DEVELOPMENT_ACTION_LIMIT = 10;

const COMMERCIAL_EMAIL_ATTACHMENT_MAX_FILES = 10;
const COMMERCIAL_EMAIL_ATTACHMENT_MAX_TOTAL_BYTES = 15 * 1024 * 1024;
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

function getCalendarRange(view, requestedDate) {
  const normalizedView = ["day", "week", "month"].includes(view)
    ? view
    : "week";
  const anchor =
    parseDateOnly(requestedDate) || parseDateOnly(toIsoDate(new Date()));

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
    startDateTime: start,
    endExclusiveDateTime: addUtcDays(end, 1),
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
    descubrimiento: 0.2,
    validacion_valor: 0.45,
    propuesta: 0.65,
    cierre: 1,
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
  return stageCode === "cierre";
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

async function loadPlanningSnapshot({ user, year, quarter, openItems }) {
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
  const stageOrderValues = openItems.map((item) => Number(item.stageId || 0));
  const maxStageOrder = stageOrderValues.length
    ? Math.max(...stageOrderValues)
    : 6;
  const openItemsInQuarter = openItems.filter((item) =>
    isDateWithinQuarter(item.closeDate, year, quarter),
  );
  const actualBySellerId = openItemsInQuarter.reduce((accumulator, item) => {
    if (!isRealWonStage(item.stageCode)) {
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
  const openBySellerId = openItemsInQuarter.reduce((accumulator, item) => {
    if (isRealWonStage(item.stageCode)) {
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
  return (
    outputEntries
      .flatMap((entry) => (Array.isArray(entry?.content) ? entry.content : []))
      .filter((part) => part?.type === "output_text")
      .map((part) => String(part?.text || "").trim())
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
    aiNextStepRecommendation: String(nextStepRecommendation || "").trim(),
    aiNarrativeSource: "fallback",
  };
}

async function requestOpportunityNarrativesWithAi(items) {
  if (!config.openai.apiKey || !items.length) {
    return new Map();
  }

  const payload = {
    model: config.openai.model,
    input: [
      {
        role: "system",
        content:
          "Analiza oportunidades comerciales CRM y responde solo con JSON válido. No inventes datos ni hechos no presentes en la entrada. Debes producir dos textos breves por oportunidad para ayudar al vendedor: un estado realista y una recomendación concreta del siguiente paso. Razona según este proceso de venta B2B: contacto inicial, identificación de oportunidad, desarrollo, cotización, demostración, negociación y waiting. Usa la etapa actual, el estado de ejecución, el scorecard comercial, las debilidades abiertas, la inactividad, las dependencias, el siguiente paso vigente y la estrategia recomendada. El estado debe explicar qué está pasando de verdad en la oportunidad y cuál es la traba comercial principal. La recomendación debe decir qué hacer ahora para mover la oportunidad, no repetir frases vacías como 'dar seguimiento' o 'avanzar etapa'. Prioriza cerrar brechas reales de urgencia, presupuesto, decisores, no decisión, bloqueo interno, ausencia de conducción o falta de validación de etapa. Si la oportunidad está en negociación o waiting, enfócate en decisión, cierre y protección del deal. Si está en desarrollo, cotización o demostración, enfócate en cómo conseguir la siguiente señal de compra. Si falta información, dilo con honestidad pero sigue dando la mejor recomendación posible basada en la evidencia estructurada. Limita cada texto a máximo 320 caracteres.",
      },
      {
        role: "user",
        content: JSON.stringify({
          opportunities: items.map((item) => ({
            opportunityId: item.id,
            name: item.name,
            accountName: item.accountName,
            amountUsd: Number(item.amountUsd || 0),
            stageName: item.stageName,
            stageCode: item.stageCode,
            executionState: item.executionState,
            riskLevel: item.riskLevel,
            riskReasons: item.riskReasons,
            daysSinceActivity: Number(item.daysSinceActivity || 0),
            slaDays: Number(item.slaDays || 0),
            currentStageValidated: Boolean(item.currentStageValidated),
            workspaceSummary: item.workspaceSummary || null,
            scorecardOverallTone: item.scorecardOverallTone || "neutral",
            scorecardItems: (item.scorecardItems || []).map(
              (scorecardItem) => ({
                label: scorecardItem.label,
                tone: scorecardItem.tone,
                statusLabel: scorecardItem.statusLabel,
                summary: scorecardItem.summary,
              }),
            ),
            openWeaknesses: (item.openWeaknesses || []).map((weakness) => ({
              title: weakness.title,
              severity: weakness.severity,
              detail: weakness.detail,
            })),
            nextStep: item.nextStep
              ? {
                  title: item.nextStep.title || "",
                  actionType: item.nextStep.actionType || "",
                  dueDate: item.nextStep.dueDate || null,
                  isOverdue: Boolean(item.nextStep.isOverdue),
                  successCriteria: item.nextStep.successCriteria || "",
                }
              : null,
            dependencies: (item.dependencies || []).map((dependency) => ({
              title: dependency.title,
              dependencyLabel: dependency.dependencyLabel,
              status: dependency.status,
              isOverdue: Boolean(dependency.isOverdue),
            })),
            closeDate: item.closeDate || null,
            recommendedHeading: item.recommendedHeading || "",
            recommendedRoute: item.recommendedRoute || "",
            recommendedFinalObjective: item.recommendedFinalObjective || "",
            recommendedStrategySteps: (item.recommendedStrategySteps || []).map(
              (step) => ({
                priorityLabel: step.priorityLabel,
                title: step.title,
                text: step.text,
              }),
            ),
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
  const parsed = extractJsonObject(extractResponseOutputText(data));
  const insights = Array.isArray(parsed?.insights) ? parsed.insights : [];

  return new Map(
    insights
      .filter((item) => Number.isInteger(Number(item?.opportunityId)))
      .map((item) => [
        Number(item.opportunityId),
        {
          aiStatusSummary: String(item.aiStatusSummary || "").trim(),
          aiNextStepRecommendation: String(
            item.aiNextStepRecommendation || "",
          ).trim(),
          aiNarrativeSource: "openai",
        },
      ]),
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
        aiNarrativeSource: aiInsight.aiNarrativeSource,
      };
    });
  } catch {
    return withFallback;
  }
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

function hasGlobalOpportunityScope(user) {
  const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
  return permissions.includes("oportunidades.read_all");
}

function hasInteractionReadPermission(user) {
  const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
  return permissions.includes("interacciones.read");
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

  const where = ["i.analysis_status <> 'resolved'"];
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

  const [actionRows, dependencyRows, answerRows, auditRows, interactionRows] =
    await Promise.all([
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
    ]);

  const activityByOpportunity = new Map();
  for (const row of [
    ...actionRows,
    ...dependencyRows,
    ...answerRows,
    ...auditRows,
    ...interactionRows,
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

async function loadCommercialEmailAttachmentOptions({ user, opportunityId }) {
  const [libraryFiles, quotationVersions] = await Promise.all([
    listCommercialLibraryFilesForEmail({ user }),
    listCommercialQuotationVersionsForEmail({ opportunityId }),
  ]);

  return {
    libraryFiles,
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
      .map((file) => ({
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
      })),
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

function buildCommercialEmailSuggestionFallback(opportunity, details = {}) {
  const normalizedDetails = normalizeCommercialEmailDraft(details);
  const contextLabel = getCommercialEmailSuggestionContextLabel(opportunity);

  if (normalizedDetails.purpose === "request_information") {
    return {
      subject: `Informacion de ${contextLabel}`,
      messageBody: `Hola,\n\nComparto la informacion de ${contextLabel} para tu revision. Si necesitas algun dato adicional, con gusto lo revisamos.\n\nSaludos,`,
      source: "fallback",
    };
  }

  if (normalizedDetails.purpose === "other") {
    const topic = normalizedDetails.purposeOther || contextLabel;
    return {
      subject: `${topic} - ${contextLabel}`,
      messageBody: `Hola,\n\nTe comparto este correo sobre ${topic}. Quedo atento a tus comentarios y a cualquier siguiente paso necesario.\n\nSaludos,`,
      source: "fallback",
    };
  }

  return {
    subject: `Propuesta para ${contextLabel}`,
    messageBody: `Hola,\n\nComparto la propuesta de ${contextLabel} para tu revision. Quedo atento a tus comentarios y a los siguientes pasos.\n\nSaludos,`,
    source: "fallback",
  };
}

async function requestCommercialEmailSuggestionWithAi({
  opportunity,
  details,
}) {
  const fallback = buildCommercialEmailSuggestionFallback(opportunity, details);

  if (!config.openai.apiKey) {
    return fallback;
  }

  const normalizedDetails = normalizeCommercialEmailDraft(details);
  const payload = {
    model: config.openai.model,
    input: [
      {
        role: "system",
        content:
          "Eres un redactor comercial B2B. Responde solo con JSON válido. No inventes hechos no presentes en la entrada. Debes redactar un asunto y un mensaje base de correo en español, claros, ejecutivos y listos para enviar. El asunto debe ser breve, específico y sin comillas. El mensaje base debe ser texto plano, sin markdown, con saludo simple, cuerpo breve y cierre profesional. Debe sonar comercial, concreto y útil para avanzar la oportunidad según el propósito indicado.",
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
            expectedResponse: normalizedDetails.expectedResponse,
            attachmentsSummary:
              getCommercialEmailAttachmentsSummary(normalizedDetails),
            responseDueDate: normalizedDetails.responseDueDate,
          },
          writingGoal:
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
  const parsed = extractJsonObject(extractResponseOutputText(data));
  const subject = String(parsed?.subject || "").trim() || fallback.subject;
  const messageBody =
    String(parsed?.messageBody || "").trim() || fallback.messageBody;

  return {
    subject,
    messageBody,
    source: "openai",
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
  year = null,
  quarter = null,
}) {
  const range = getCalendarRange(view, date);
  const actionTypes = Array.from(COMMERCIAL_ACTIVITY_ACTION_TYPES);
  const params = [];
  const ownershipJoin = buildOwnershipJoin(user, params);
  const where = [
    `a.scheduled_at >= ?`,
    `a.scheduled_at < ?`,
    `a.action_type IN (${actionTypes.map(() => "?").join(", ")})`,
    includeCompleted
      ? `a.status IN ('pending', 'in_progress', 'blocked', 'done')`
      : `a.status IN ('pending', 'in_progress', 'blocked')`,
    `ocs.code NOT IN ('ganada', 'perdida', 'cancelada')`,
    `oas.code = 'activada'`,
  ];

  params.push(range.startDateTime, range.endExclusiveDateTime, ...actionTypes);

  if (year !== null && quarter !== null) {
    const quarterRange = getQuarterDateRange(year, quarter);
    where.push(`o.close_date BETWEEN ? AND ?`);
    params.push(quarterRange.startDate, quarterRange.endDate);
  }

  if (!hasGlobalOpportunityScope(user)) {
    where.push(`(ao_scope.user_id IS NOT NULL OR o.created_by = ?)`);
    params.push(Number(user.id));
  }

  const rows = await query(
    `SELECT a.id, a.opportunity_id, a.action_type, a.status, a.title, a.notes,
            a.scheduled_at, a.is_primary_next_step,
            o.name AS opportunity_name, o.close_date, o.amount_usd,
            ac.name AS account_name,
            oss.name AS stage_name
     FROM opportunity_workspace_actions a
     INNER JOIN opportunities o ON o.id = a.opportunity_id
     ${ownershipJoin}
     INNER JOIN accounts ac ON ac.id = o.account_id
     INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
     INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
     INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
     WHERE ${where.join(" AND ")}
     ORDER BY a.scheduled_at ASC, a.is_primary_next_step DESC, o.amount_usd DESC, o.name ASC`,
    params,
  );

  const items = rows.map((row) => ({
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    opportunityName: row.opportunity_name,
    accountName: row.account_name,
    activityType: row.action_type,
    status: row.status,
    scheduledAt: row.scheduled_at,
    scheduledDate: toIsoDate(row.scheduled_at),
    title: row.title || "",
    note: row.notes || "",
    isPrimaryNextStep: Boolean(row.is_primary_next_step),
    stageName: row.stage_name || "",
    closeDate: row.close_date,
    amountUsd: Number(row.amount_usd || 0),
  }));

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
      if (item.status === "pending") accumulator.pending += 1;
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

router.get(
  "/dashboard",
  requirePermission("oportunidades.read"),
  async (req, res) => {
    const quarterSelection = resolveQuarterSelection(req.query || {});
    const developmentPeriods = await listDevelopmentPeriods();
    const stagesCatalog = await listActiveSalesStages();
    const opportunityRows = await listAccessibleOpportunities(req.user);
    const opportunityIds = opportunityRows.map((row) => Number(row.id));
    const accountContactsByAccountId = await listContactsByAccountIds(
      opportunityRows.map((row) => row.account_id),
    );
    const recommendationCatalog =
      await loadCommercialEnablementRecommendationCatalog();
    const dependencyRows = await listOpenDependencies(opportunityIds);
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
        const slaDays = STAGE_SLA_DAYS[row.sales_stage_code] || 5;
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
    const quarterNarratives = await enrichOpportunityNarratives(
      executionItems.filter((item) => quarterOpportunityIds.has(item.id)),
    );
    const quarterNarrativeById = new Map(
      quarterNarratives.map((item) => [item.id, item]),
    );
    executionItems = executionItems.map(
      (item) => quarterNarrativeById.get(item.id) || item,
    );

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
      openItems: executionItems,
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
  requirePermission("oportunidades.read"),
  async (req, res) => {
    const view = String(req.query?.view || "week").trim();
    if (!["day", "week", "month"].includes(view)) {
      return res.status(400).json({ message: "view invalido" });
    }

    const date = String(req.query?.date || "").trim();
    const includeCompleted =
      String(req.query?.includeCompleted || "false") === "true";
    const hasQuarterFilter =
      req.query?.year !== undefined || req.query?.quarter !== undefined;
    const quarterSelection = hasQuarterFilter
      ? resolveQuarterSelection(req.query)
      : { year: null, quarter: null };

    const payload = await listCommercialCalendarActivities({
      user: req.user,
      view,
      date,
      includeCompleted,
      year: quarterSelection.year,
      quarter: quarterSelection.quarter,
    });

    return res.json(payload);
  },
);

router.post(
  "/opportunities/:id/activities",
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
      scheduledAt = new Date(scheduledAtRaw);
      if (Number.isNaN(scheduledAt.getTime())) {
        return res.status(400).json({ message: "scheduledAt invalido" });
      }
      dueDate = scheduledAtRaw.slice(0, 10);
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
      scheduledAt = new Date(scheduledAtRaw);
      if (Number.isNaN(scheduledAt.getTime())) {
        return res.status(400).json({ message: "scheduledAt invalido" });
      }
      dueDate = String(scheduledAt.toISOString().slice(0, 10));
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
  "/opportunities/:id/email-suggestion",
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

    try {
      const suggestion = await requestCommercialEmailSuggestionWithAi({
        opportunity,
        details,
      });
      return res.json(suggestion);
    } catch {
      return res.json(
        buildCommercialEmailSuggestionFallback(opportunity, details),
      );
    }
  },
);

router.post(
  "/opportunities/:id/activities/:activityId/send-email",
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
