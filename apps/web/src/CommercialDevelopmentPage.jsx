import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, getApiErrorMessage } from "./api";

const ACTIVITY_TYPE_OPTIONS = [
  { value: "call", label: "Llamada" },
  { value: "conference", label: "Conferencia" },
  { value: "visit", label: "Visita" },
  { value: "presentation", label: "Presentacion" },
  { value: "other", label: "Otro" },
];

const ACTIVITY_STATUS_LABELS = {
  pending: "Programada",
  in_progress: "En curso",
  blocked: "Bloqueada",
  done: "Realizada",
  cancelled: "Cancelada",
};

const CALENDAR_WEEKDAY_HEADERS = [
  "Lunes",
  "Martes",
  "Miercoles",
  "Jueves",
  "Viernes",
  "Sabado",
  "Domingo",
];

const FUNNEL_STAGE_CATALOG = [
  {
    stageCode: "contacto_inicial",
    stageName: "Contacto inicial",
    groupKey: null,
  },
  {
    stageCode: "identificacion_oportunidad",
    stageName: "Identificacion de oportunidad",
    groupKey: null,
  },
  {
    stageCode: "desarrollo",
    stageName: "Desarrollo",
    groupKey: "nonCommitted",
  },
  {
    stageCode: "cotizacion",
    stageName: "Cotizacion",
    groupKey: "nonCommitted",
  },
  {
    stageCode: "demostracion",
    stageName: "Demostracion",
    groupKey: "nonCommitted",
  },
  {
    stageCode: "negociacion",
    stageName: "Negociacion",
    groupKey: "committed",
  },
  {
    stageCode: "waiting",
    stageName: "Waiting",
    groupKey: "committed",
  },
];

const FUNNEL_GROUP_LABELS = {
  nonCommitted: "Pipeline no comprometido",
  committed: "Pipeline comprometido",
};

const NON_COMMITTED_BRACE_STAGE_CODES = new Set([
  "desarrollo",
  "cotizacion",
  "demostracion",
]);
const COMMITTED_BRACE_STAGE_CODES = new Set(["negociacion", "waiting"]);

const NON_COMMITTED_BRACE_ANCHOR_STAGE_CODE = "desarrollo";
const COMMITTED_BRACE_ANCHOR_STAGE_CODE = "negociacion";

function getFunnelBraceRange(stages, stageCodes) {
  const startIndex = stages.findIndex((stage) => stageCodes.has(stage.stageCode));
  const endIndex = stages.reduce(
    (lastMatchIndex, stage, index) =>
      stageCodes.has(stage.stageCode) ? index : lastMatchIndex,
    -1,
  );
  const isVisible = startIndex !== -1 && endIndex !== -1 && endIndex >= startIndex;

  return {
    startIndex,
    endIndex,
    isVisible,
    stageSpan: isVisible ? endIndex - startIndex + 1 : 0,
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatCurrency(value, currency = "USD") {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "Sin dato";
  }
  return `${Number(value).toFixed(0)}%`;
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Sin fecha";
  return parsed.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function toDateTimeInputValue(value) {
  if (!value) return "";
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hour = String(parsed.getHours()).padStart(2, "0");
  const minute = String(parsed.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function formatDateTime(value) {
  if (!value) return "Sin fecha";
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Sin fecha";
  return parsed.toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toIsoDate(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function getTodayDateValue() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysToDateValue(dateValue, days) {
  if (!dateValue) return getTodayDateValue();
  const [year, month, day] = String(dateValue)
    .split("-")
    .map((part) => Number(part));
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function getStartOfWeek(dateValue) {
  if (!dateValue) return getTodayDateValue();
  const [year, month, day] = String(dateValue)
    .split("-")
    .map((part) => Number(part));
  const date = new Date(Date.UTC(year, month - 1, day));
  const utcDay = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - utcDay + 1);
  return date.toISOString().slice(0, 10);
}

function getStartOfMonth(dateValue) {
  if (!dateValue) return getTodayDateValue();
  const [year, month] = String(dateValue)
    .split("-")
    .map((part) => Number(part));
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function shiftCalendarDate(view, dateValue, direction) {
  const delta = Number(direction || 0);
  if (view === "day") {
    return addDaysToDateValue(dateValue, delta);
  }
  if (view === "week") {
    return addDaysToDateValue(dateValue, delta * 7);
  }
  const [year, month, day] = String(dateValue || getTodayDateValue())
    .split("-")
    .map((part) => Number(part));
  const shifted = new Date(Date.UTC(year, month - 1 + delta, day || 1));
  return shifted.toISOString().slice(0, 10);
}

function formatCalendarRange(filters) {
  if (!filters?.rangeStart || !filters?.rangeEnd) return "Sin rango";
  if (filters.rangeStart === filters.rangeEnd) {
    return formatDate(filters.rangeStart);
  }
  return `${formatDate(filters.rangeStart)} - ${formatDate(filters.rangeEnd)}`;
}

function getWeekdayLabel(dateValue, variant = "short") {
  if (!dateValue) return "";
  const parsed = new Date(`${dateValue}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("es-MX", { weekday: variant, timeZone: "UTC" });
}

function getMonthLeadingEmptySlots(dateValue) {
  if (!dateValue) return 0;
  const parsed = new Date(`${dateValue}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return 0;
  const weekday = parsed.getUTCDay();
  return weekday === 0 ? 6 : weekday - 1;
}

function buildDateTimeInputForDay(dateValue, timeValue = "09:00") {
  return `${dateValue}T${timeValue}`;
}

function getCalendarHeatLevel(count) {
  const total = Number(count || 0);
  if (total >= 5) return "is-heat-3";
  if (total >= 3) return "is-heat-2";
  if (total >= 1) return "is-heat-1";
  return "is-heat-0";
}

function getFunnelStageSortRank(stageCode) {
  const index = FUNNEL_STAGE_CATALOG.findIndex(
    (stage) => stage.stageCode === stageCode,
  );
  return index === -1 ? 99 : index + 1;
}

function buildCommercialFunnel(pipelineByStage = []) {
  const incomingStages = new Map(
    asArray(pipelineByStage).map((stage) => [stage?.stageCode || "unknown", stage]),
  );
  const knownStages = FUNNEL_STAGE_CATALOG.map((stageDefinition) => {
    const stage = incomingStages.get(stageDefinition.stageCode) || null;
    return {
      stageCode: stageDefinition.stageCode,
      stageName: stage?.stageName || stageDefinition.stageName,
      opportunityCount: Number(stage?.opportunityCount || 0),
      openAmount: Number(stage?.openAmount || 0),
      weightedAmount: Number(stage?.weightedAmount || 0),
      riskyCount: Number(stage?.riskyCount || 0),
      isCommitted: stageDefinition.groupKey === "committed",
      groupKey: stageDefinition.groupKey,
      groupLabel: stageDefinition.groupKey
        ? FUNNEL_GROUP_LABELS[stageDefinition.groupKey]
        : "",
    };
  });
  const extraStages = asArray(pipelineByStage)
    .filter(
      (stage) =>
        !FUNNEL_STAGE_CATALOG.some(
          (stageDefinition) => stageDefinition.stageCode === stage?.stageCode,
        ),
    )
    .map((stage) => ({
      stageCode: stage?.stageCode || "unknown",
      stageName: stage?.stageName || "Sin etapa",
      opportunityCount: Number(stage?.opportunityCount || 0),
      openAmount: Number(stage?.openAmount || 0),
      weightedAmount: Number(stage?.weightedAmount || 0),
      riskyCount: Number(stage?.riskyCount || 0),
      isCommitted: isCommittedStage(stage?.stageCode),
      groupKey: null,
      groupLabel: "",
    }));
  const stages = [...knownStages, ...extraStages].sort(
    (left, right) =>
      getFunnelStageSortRank(left.stageCode) -
      getFunnelStageSortRank(right.stageCode),
  );

  const totalOpenAmount = stages.reduce(
    (total, stage) => total + Number(stage.openAmount || 0),
    0,
  );
  const totalOpenCount = stages.reduce(
    (total, stage) => total + Number(stage.opportunityCount || 0),
    0,
  );
  const committedAmount = stages
    .filter((stage) => stage.isCommitted)
    .reduce((total, stage) => total + Number(stage.openAmount || 0), 0);
  const dominantStage = [...stages].sort(
    (left, right) => Number(right.openAmount || 0) - Number(left.openAmount || 0),
  )[0];
  const maxOpenAmount = Math.max(
    ...stages.map((stage) => Number(stage.openAmount || 0)),
    0,
  );
  const maxOpportunityCount = Math.max(
    ...stages.map((stage) => Number(stage.opportunityCount || 0)),
    0,
  );

  return {
    totalOpenAmount,
    totalOpenCount,
    committedSharePercent: totalOpenAmount
      ? Math.round((committedAmount / totalOpenAmount) * 100)
      : 0,
    dominantStageCode: dominantStage?.stageCode || "",
    dominantStageName: dominantStage?.stageName || "Sin datos",
    maxOpenAmount,
    maxOpportunityCount,
    stages: stages.map((stage) => ({
      ...stage,
      sharePercent: totalOpenAmount
        ? Math.round((Number(stage.openAmount || 0) / totalOpenAmount) * 100)
        : 0,
    })),
  };
}

function getFunnelStageWidth(stage, mode, funnel) {
  const maxValue =
    mode === "count"
      ? Number(funnel?.maxOpportunityCount || 0)
      : Number(funnel?.maxOpenAmount || 0);
  const rawValue =
    mode === "count"
      ? Number(stage?.opportunityCount || 0)
      : Number(stage?.openAmount || 0);
  if (!(maxValue > 0) || !(rawValue > 0)) return 38;
  return Math.max(38, Math.round((rawValue / maxValue) * 100));
}

function getFunnelShapeWidth(index, totalStages) {
  const total = Math.max(Number(totalStages || 0), 1);
  if (total === 1) return 100;
  const maxWidth = 100;
  const minWidth = 42;
  const step = (maxWidth - minWidth) / (total - 1);
  return Math.max(minWidth, Math.round(maxWidth - index * step));
}

function getFunnelStagePalette(index) {
  const palette = [
    {
      solid: "#22a6a3",
      soft: "rgba(34, 166, 163, 0.16)",
      border: "rgba(24, 108, 106, 0.24)",
    },
    {
      solid: "#2498b7",
      soft: "rgba(36, 152, 183, 0.16)",
      border: "rgba(21, 95, 115, 0.24)",
    },
    {
      solid: "#4b7fbc",
      soft: "rgba(75, 127, 188, 0.16)",
      border: "rgba(46, 79, 118, 0.24)",
    },
    {
      solid: "#5d65b9",
      soft: "rgba(93, 101, 185, 0.16)",
      border: "rgba(59, 66, 120, 0.24)",
    },
    {
      solid: "#775eb3",
      soft: "rgba(119, 94, 179, 0.16)",
      border: "rgba(78, 61, 118, 0.24)",
    },
    {
      solid: "#8a59a0",
      soft: "rgba(138, 89, 160, 0.16)",
      border: "rgba(87, 56, 101, 0.24)",
    },
    {
      solid: "#9a557e",
      soft: "rgba(154, 85, 126, 0.16)",
      border: "rgba(99, 55, 81, 0.24)",
    },
  ];

  return palette[index] || palette[palette.length - 1];
}

function getQuarterDateRange(period) {
  const year = Number(period?.year || 0);
  const quarter = Number(period?.quarter || 0);
  if (!year || quarter < 1 || quarter > 4) return null;
  const start = new Date(Date.UTC(year, (quarter - 1) * 3, 1));
  const end = new Date(Date.UTC(year, quarter * 3, 0));
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function isDateWithinPeriod(value, period) {
  const isoDate = toIsoDate(value);
  const range = getQuarterDateRange(period);
  if (!isoDate || !range) return false;
  return isoDate >= range.startDate && isoDate <= range.endDate;
}

function getRiskToneClass(level) {
  if (level === "high") return "is-high";
  if (level === "medium") return "is-medium";
  return "is-low";
}

function getRiskLabel(level) {
  if (level === "high") return "Riesgo alto";
  if (level === "medium") return "Riesgo medio";
  return "Controlado";
}

function getRecommendedNextMoveTitle(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.title || value.text || "";
}

function formatOpportunityScore(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }
  return Number(numericValue.toFixed(1));
}

function getActivityTypeLabel(value) {
  return (
    ACTIVITY_TYPE_OPTIONS.find((option) => option.value === value)?.label ||
    "Actividad"
  );
}

function getActivityStatusLabel(value) {
  return ACTIVITY_STATUS_LABELS[value] || "Programada";
}

function getScheduledAtDefaultValue() {
  const date = new Date();
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + 1);
  const part = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}`;
}

function buildActivityDraft(item, activity = null) {
  if (activity) {
    return {
      id: Number(activity.id),
      mode: "edit",
      status: activity.status || "pending",
      activityType: activity.activityType || "call",
      scheduledAt: toDateTimeInputValue(activity.scheduledAt || activity.dueDate),
      objective: activity.title || "",
      note: activity.note || "",
      isPrimaryNextStep: Boolean(activity.isPrimaryNextStep),
    };
  }

  return {
    id: null,
    mode: "create",
    status: "pending",
    activityType: "call",
    scheduledAt: getScheduledAtDefaultValue(),
    objective: "",
    note: "",
    isPrimaryNextStep: !item?.nextStep,
  };
}

function isCommittedStage(stageCode) {
  return stageCode === "negociacion" || stageCode === "waiting";
}

function isNonCommittedPipelineStage(stageCode) {
  return (
    stageCode === "desarrollo" ||
    stageCode === "cotizacion" ||
    stageCode === "demostracion"
  );
}

function getStageSortRank(stageCode) {
  return {
    waiting: 7,
    negociacion: 6,
    demostracion: 5,
    cotizacion: 4,
    desarrollo: 3,
    propuesta: 3,
    validacion_valor: 3,
    identificacion_oportunidad: 2,
    descubrimiento: 2,
    contacto_inicial: 1,
  }[stageCode] || 0;
}

function getRiskRank(level) {
  if (level === "high") return 0;
  if (level === "medium") return 1;
  return 2;
}

function getCoverageKind(item) {
  return isCommittedStage(item?.stageCode) ? "committed" : "weighted";
}

function getRawCoverageAmount(item) {
  if (getCoverageKind(item) === "committed") {
    return Number(item?.amountUsd || 0);
  }
  return Number(item?.amountUsd || 0) * (Number(item?.stageConfidence || 0) / 100);
}

function getCoverageReadout({ gapAmount, committedAmount, weightedAdditionalAmount }) {
  if (!(gapAmount > 0)) {
    return "La cuota ya está cubierta en real; ahora toca proteger cierres, margen y expansión.";
  }

  if (committedAmount >= gapAmount) {
    return "La brecha puede cerrarse con oportunidades ya comprometidas si se ejecutan bien.";
  }

  if (committedAmount + weightedAdditionalAmount >= gapAmount) {
    return "Lo comprometido no alcanza; necesitas convertir también oportunidades en maduración.";
  }

  return "Ni lo comprometido ni la cobertura ponderada actual alcanzan la cuota; hace falta abrir o acelerar pipeline.";
}

function normalizeDashboardResponse(data) {
  const workboard = asArray(data?.workboard).map((item) => ({
    ...item,
    riskReasons: asArray(item?.riskReasons),
    reminders: asArray(item?.reminders),
    dependencies: asArray(item?.dependencies),
    recommendedResources: asArray(item?.recommendedResources).map(
      (resource) => ({
        ...resource,
        assets: asArray(resource?.assets),
      }),
    ),
  }));

  return {
    summary:
      data?.summary && typeof data.summary === "object" ? data.summary : {},
    workboard,
    cadences: {
      active: asArray(data?.cadences?.active).map((item) => ({
        ...item,
        steps: asArray(item?.steps),
      })),
      suggested: asArray(data?.cadences?.suggested).map((item) => ({
        ...item,
        steps: asArray(item?.steps),
        frictionReasons: asArray(item?.frictionReasons),
      })),
    },
    development:
      data?.development && typeof data.development === "object"
        ? data.development
        : {
            period: null,
            periods: [],
            quota: {},
            sellerSnapshots: [],
            pipelineByStage: [],
            priorities: [],
            recommendations: [],
            actionsToday: [],
          },
  };
}

function SummaryMetric({ label, value, helper, tone }) {
  return (
    <article className={`commercial-development-metric ${tone || ""}`.trim()}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{helper}</p>
    </article>
  );
}

function DevelopmentHelp() {
  return (
    <details className="commercial-development-help">
      <summary
        className="commercial-development-help-trigger"
        aria-label="Ayuda sobre desarrollo comercial"
      >
        ?
      </summary>
      <div className="commercial-development-help-popover">
        <strong>Para qué sirve</strong>
        <p>
          Reúne en una sola vista la cuota trimestral, la cobertura real del
          pipeline, las oportunidades que más mueven resultado y las acciones
          concretas para empujar avance.
        </p>
      </div>
    </details>
  );
}

function ActivityIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect
        x="4"
        y="5"
        width="16"
        height="14"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M8 9.25h8M8 12.25h8M8 15.25h5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function RescheduleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M7 6.75h7.5M7 12h5.5M15.5 4.75v4M9.5 4.75v4M6.25 19.25h5.5a2.5 2.5 0 0 0 2.5-2.5V8.25a2.5 2.5 0 0 0-2.5-2.5h-5.5a2.5 2.5 0 0 0-2.5 2.5v8.5a2.5 2.5 0 0 0 2.5 2.5Zm10.25-4.5a3.75 3.75 0 1 0 1.52 3.02M18.75 13.5v2.5h-2.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function EditOpportunityIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M4.75 19.25h4.1l8.84-8.84-4.1-4.1-8.84 8.84v4.1Zm10.07-13.99 2.86-2.86a1.5 1.5 0 0 1 2.12 0l1.8 1.8a1.5 1.5 0 0 1 0 2.12l-2.86 2.86-3.92-3.92Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M12 3.75 13.9 8.1l4.35 1.9-4.35 1.9L12 16.25l-1.9-4.35-4.35-1.9 4.35-1.9L12 3.75Zm6.25 9.5.95 2.3 2.3.95-2.3.95-.95 2.3-.95-2.3-2.3-.95 2.3-.95.95-2.3Zm-12.5 1.5.95 2.3 2.3.95-2.3.95-.95 2.3-.95-2.3-2.3-.95 2.3-.95.95-2.3Z"
        fill="currentColor"
      />
    </svg>
  );
}

function CalendarPlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M7 3.75v2.5m10-2.5v2.5M5.75 7.25h12.5a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5.75a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Zm0 4h12.5M12 11.25v5m-2.5-2.5h5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function CommercialActivityModal({
  item,
  draft,
  setDraft,
  saving,
  error,
  onClose,
  onSubmit,
  onMarkDone,
  viewMode,
  onShowCreate,
  onShowList,
  onSelectActivity,
  currencyCode,
}) {
  if (!item) return null;

  const hasEditableActivity = Boolean(draft?.id);
  const isCompletionDisabled =
    saving || !hasEditableActivity || draft.status === "done";
  const activities = item.recentActivities?.length
    ? item.recentActivities
    : item.nextScheduledActivity
      ? [item.nextScheduledActivity]
      : [];

  return (
    <div
      className="modal-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) {
          onClose();
        }
      }}
    >
      <div className="modal-dialog commercial-development-activity-modal">
        <div className="modal-header commercial-development-activity-modal-header">
          <div className="commercial-development-activity-header-copy">
            <span className="commercial-development-activity-kicker">
              {viewMode === "list" ? "Seguimiento comercial" : "Captura operativa"}
            </span>
            <h3 className="modal-title">
              {viewMode === "list"
                ? "Actividades de la oportunidad"
                : hasEditableActivity
                  ? "Actualizar actividad"
                  : "Programar actividad"}
            </h3>
            <p className="section-helper-text">
              {viewMode === "list"
                ? "Revisa el historial y abre una nueva actividad desde esta misma vista."
                : hasEditableActivity
                  ? "Ajusta la actividad pendiente o márcala como realizada desde este mismo modal."
                  : "Registra la proxima accion comercial de esta oportunidad."}
            </p>
          </div>
        </div>

        <div className="commercial-development-activity-context">
          <div className="commercial-development-activity-context-head">
            <span className="commercial-development-activity-context-label">
              Oportunidad
            </span>
            <strong>{item.name}</strong>
          </div>
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        {viewMode === "list" ? (
          <div className="commercial-development-activity-list-view">
            <div className="commercial-development-activity-list-toolbar">
              <div>
                <strong>Actividades</strong>
                <p>Selecciona una actividad para verla o editarla.</p>
              </div>
              <button
                type="button"
                className="btn-primary"
                onClick={onShowCreate}
                disabled={saving}
              >
                Nueva actividad
              </button>
            </div>

            <div className="commercial-development-activity-history">
              {activities.length ? (
                activities.map((activity) => (
                  <button
                    key={`activity-history-${activity.id}`}
                    type="button"
                    className="commercial-development-activity-history-item commercial-development-activity-history-button"
                    onClick={() => onSelectActivity(activity)}
                    disabled={saving}
                  >
                    <div className="commercial-development-inline-row">
                      <strong>{getActivityTypeLabel(activity.activityType)}</strong>
                      <span className="commercial-development-pill is-low">
                        {getActivityStatusLabel(activity.status)}
                      </span>
                    </div>
                    <p>{activity.title}</p>
                    <span>
                      {formatDateTime(activity.scheduledAt || activity.updatedAt)}
                    </span>
                  </button>
                ))
              ) : (
                <div className="empty-state">Sin actividades registradas.</div>
              )}
            </div>

            <div className="modal-buttons commercial-development-activity-actions">
              <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
                Cerrar
              </button>
            </div>
          </div>
        ) : (
          <form className="commercial-development-activity-form" onSubmit={onSubmit}>
            <div className="commercial-development-activity-form-toolbar">
              <button
                type="button"
                className="secondary-button"
                onClick={onShowList}
                disabled={saving}
              >
                Volver a actividades
              </button>
              <span className="commercial-development-activity-form-badge">
                {hasEditableActivity ? "Edicion" : "Nueva"}
              </span>
            </div>

            <div className="commercial-development-activity-form-section">
              <div className="commercial-development-activity-section-heading">
                <strong>Datos base</strong>
                <p>Define el tipo de contacto y cuándo debe ocurrir.</p>
              </div>

              <div className="commercial-development-activity-form-grid">
                <label className="commercial-development-field">
                  <span>Tipo de actividad</span>
                  <select
                    value={draft.activityType}
                    disabled={saving}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        activityType: event.target.value,
                      }))
                    }
                  >
                    {ACTIVITY_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="commercial-development-field">
                  <span>Fecha y hora</span>
                  <input
                    type="datetime-local"
                    value={draft.scheduledAt}
                    disabled={saving}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        scheduledAt: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
            </div>

            <div className="commercial-development-activity-form-section">
              <div className="commercial-development-activity-section-heading">
                <strong>Resultado esperado</strong>
                <p>Describe qué debe salir resuelto después de esta actividad.</p>
              </div>

              <label className="commercial-development-field">
                <span>Objetivo</span>
                <input
                  value={draft.objective}
                  disabled={saving}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      objective: event.target.value,
                    }))
                  }
                  placeholder="Ej. confirmar decisor, fecha de comite o condicion de cierre"
                />
              </label>

              <label className="commercial-development-field">
                <span>Nota</span>
                <textarea
                  rows="3"
                  value={draft.note}
                  disabled={saving}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      note: event.target.value,
                    }))
                  }
                  placeholder="Participantes, contexto o detalle adicional"
                />
              </label>
            </div>

            <label className="commercial-development-activity-checkbox">
              <input
                type="checkbox"
                checked={draft.isPrimaryNextStep}
                disabled={saving}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    isPrimaryNextStep: event.target.checked,
                  }))
                }
              />
              <span>Marcar como siguiente paso principal</span>
            </label>

            {hasEditableActivity ? (
              <div className="commercial-development-activity-inline-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={isCompletionDisabled}
                  onClick={onMarkDone}
                >
                  {saving ? "Actualizando..." : "Marcar realizada"}
                </button>
                <span>
                  Estado actual: {getActivityStatusLabel(draft.status)}
                </span>
              </div>
            ) : null}

            <div className="modal-buttons commercial-development-activity-actions">
              <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving
                  ? hasEditableActivity
                    ? "Actualizando..."
                    : "Guardando..."
                  : hasEditableActivity
                    ? "Guardar cambios"
                    : "Guardar actividad"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function CommercialDevelopmentPage() {
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedPeriodKey, setSelectedPeriodKey] = useState("");
  const [selectedFunnelStage, setSelectedFunnelStage] = useState("");
  const [calendarView, setCalendarView] = useState("week");
  const [calendarDate, setCalendarDate] = useState(getTodayDateValue);
  const [calendarData, setCalendarData] = useState(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState("");
  const [selectedCalendarDay, setSelectedCalendarDay] = useState("");
  const [calendarOpportunityId, setCalendarOpportunityId] = useState("");
  const [activityModalItem, setActivityModalItem] = useState(null);
  const [activityDraft, setActivityDraft] = useState(buildActivityDraft(null));
  const [activityError, setActivityError] = useState("");
  const [savingActivity, setSavingActivity] = useState(false);
  const [activityViewMode, setActivityViewMode] = useState("form");

  const loadDashboard = useCallback(async (periodKey = "") => {
    setLoading(true);
    setError("");
    try {
      const params = {};
      if (periodKey) {
        const [year, quarter] = String(periodKey).split("-");
        params.year = Number(year);
        params.quarter = Number(quarter);
      }
      const response = await api.get("/api/commercial-development/dashboard", {
        params,
      });
      const nextDashboard = normalizeDashboardResponse(response.data);
      setDashboard(nextDashboard);
      const nextPeriodKey = nextDashboard.development?.period
        ? `${nextDashboard.development.period.year}-${nextDashboard.development.period.quarter}`
        : "";
      setSelectedPeriodKey((current) => current || nextPeriodKey);
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar la vista de desarrollo comercial",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard(selectedPeriodKey);
  }, [loadDashboard, selectedPeriodKey]);

  const workboard = dashboard?.workboard || [];
  const development = dashboard?.development || {};
  const quota = development.quota || {};
  const nonCommittedPipelineAmount = workboard
    .filter((item) => isDateWithinPeriod(item?.closeDate, development.period))
    .filter((item) => isNonCommittedPipelineStage(item?.stageCode))
    .reduce((total, item) => total + Number(item?.amountUsd || 0), 0);
  const nonCommittedStageCount = new Set(
    workboard
      .filter((item) => isDateWithinPeriod(item?.closeDate, development.period))
      .filter((item) => isNonCommittedPipelineStage(item?.stageCode))
      .map((item) => item?.stageCode)
      .filter(Boolean),
  ).size;
  const periodOptions = development.periods || [];
  const currentPeriod = development.period || null;
  const funnel = useMemo(
    () => buildCommercialFunnel(development.pipelineByStage),
    [development.pipelineByStage],
  );
  const workboardById = useMemo(
    () => new Map(workboard.map((item) => [Number(item.id), item])),
    [workboard],
  );

  const loadCalendar = useCallback(async () => {
    setCalendarLoading(true);
    setCalendarError("");
    try {
      const params = {
        view: calendarView,
        date: calendarDate,
        includeCompleted: false,
      };
      if (selectedPeriodKey) {
        const [year, quarter] = String(selectedPeriodKey).split("-");
        params.year = Number(year);
        params.quarter = Number(quarter);
      }
      const response = await api.get("/api/commercial-development/calendar", {
        params,
      });
      const nextCalendarData = response.data || null;
      setCalendarData(nextCalendarData);
      setSelectedCalendarDay((current) => {
        if (
          current &&
          asArray(nextCalendarData?.days).some((day) => day.date === current)
        ) {
          return current;
        }
        return nextCalendarData?.filters?.date || current || calendarDate;
      });
    } catch (requestError) {
      setCalendarError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar el calendario de actividades.",
        ),
      );
    } finally {
      setCalendarLoading(false);
    }
  }, [calendarDate, calendarView, selectedPeriodKey]);

  useEffect(() => {
    const periodRange = getQuarterDateRange(currentPeriod);
    if (!periodRange) return;
    setCalendarDate((current) => {
      if (
        current &&
        current >= periodRange.startDate &&
        current <= periodRange.endDate
      ) {
        return current;
      }
      const today = getTodayDateValue();
      if (today >= periodRange.startDate && today <= periodRange.endDate) {
        return today;
      }
      return periodRange.startDate;
    });
    setSelectedCalendarDay((current) => {
      if (
        current &&
        current >= periodRange.startDate &&
        current <= periodRange.endDate
      ) {
        return current;
      }
      const today = getTodayDateValue();
      if (today >= periodRange.startDate && today <= periodRange.endDate) {
        return today;
      }
      return periodRange.startDate;
    });
  }, [currentPeriod?.quarter, currentPeriod?.year]);

  useEffect(() => {
    loadCalendar();
  }, [loadCalendar]);

  const gapClosingView = useMemo(() => {
    const activeGapAmount = Number(quota.gapAmount || 0);
    const candidates = workboard
      .filter((item) => isDateWithinPeriod(item?.closeDate, currentPeriod))
      .map((item) => ({
        ...item,
        coverageKind: getCoverageKind(item),
        rawCoverageAmount: getRawCoverageAmount(item),
      }))
      .sort((left, right) => {
        const stageDelta =
          getStageSortRank(right.stageCode) - getStageSortRank(left.stageCode);
        if (stageDelta !== 0) {
          return stageDelta;
        }
        const leftClose = left.closeDate
          ? new Date(left.closeDate).getTime()
          : Number.MAX_SAFE_INTEGER;
        const rightClose = right.closeDate
          ? new Date(right.closeDate).getTime()
          : Number.MAX_SAFE_INTEGER;
        if (leftClose !== rightClose) {
          return leftClose - rightClose;
        }
        if (right.amountUsd !== left.amountUsd) {
          return Number(right.amountUsd || 0) - Number(left.amountUsd || 0);
        }
        const riskDelta = getRiskRank(left.riskLevel) - getRiskRank(right.riskLevel);
        if (riskDelta !== 0) {
          return riskDelta;
        }
        return String(left.name || "").localeCompare(String(right.name || ""), "es");
      });

    const committedAmount = roundCurrency(
      candidates
        .filter((item) => item.coverageKind === "committed")
        .reduce((total, item) => total + Number(item.rawCoverageAmount || 0), 0),
    );
    const weightedAdditionalAmount = roundCurrency(
      candidates
        .filter((item) => item.coverageKind === "weighted")
        .reduce((total, item) => total + Number(item.rawCoverageAmount || 0), 0),
    );

    let remainingGap = activeGapAmount;
    const cards = candidates.map((item) => {
      const effectiveCoverageAmount = activeGapAmount > 0
        ? Math.min(remainingGap, item.rawCoverageAmount)
        : 0;
      remainingGap = Math.max(remainingGap - effectiveCoverageAmount, 0);
      return {
        ...item,
        effectiveCoverageAmount: roundCurrency(effectiveCoverageAmount),
        gapCoverageShare: activeGapAmount
          ? roundCurrency((effectiveCoverageAmount / activeGapAmount) * 100)
          : null,
      };
    });

    return {
      gapAmount: activeGapAmount,
      committedAmount,
      weightedAdditionalAmount,
      cards,
      coverageReadout: getCoverageReadout({
        gapAmount: activeGapAmount,
        committedAmount,
        weightedAdditionalAmount,
      }),
    };
  }, [currentPeriod, quota.gapAmount, workboard]);
  const selectedFunnelStageData = funnel.stages.find(
    (stage) => stage.stageCode === selectedFunnelStage,
  );
  const nonCommittedBraceRange = getFunnelBraceRange(
    funnel.stages,
    NON_COMMITTED_BRACE_STAGE_CODES,
  );
  const committedBraceRange = getFunnelBraceRange(
    funnel.stages,
    COMMITTED_BRACE_STAGE_CODES,
  );
  const visibleGapClosingCards = selectedFunnelStage
    ? gapClosingView.cards.filter((item) => item.stageCode === selectedFunnelStage)
    : gapClosingView.cards;

  const calendarDays = asArray(calendarData?.days);
  const calendarFilters = calendarData?.filters || {};
  const developmentPriorities = asArray(development.priorities);
  const actionsToday = asArray(development.actionsToday);
  const selectedDayData =
    calendarDays.find((day) => day.date === selectedCalendarDay) ||
    calendarDays.find((day) => day.date === calendarFilters.date) ||
    calendarDays[0] ||
    null;
  const selectedDayItems = asArray(selectedDayData?.items);
  const monthLeadingEmptySlots =
    calendarView === "month"
      ? getMonthLeadingEmptySlots(calendarDays[0]?.date)
      : 0;
  const calendarOpportunityOptions = useMemo(() => {
    const prioritized = selectedDayItems
      .map((item) => ({
        value: String(item.opportunityId),
        label: item.opportunityName || `Oportunidad ${item.opportunityId}`,
      }))
      .filter(
        (item, index, array) =>
          array.findIndex((candidate) => candidate.value === item.value) === index,
      );
    if (prioritized.length) {
      return prioritized;
    }
    return workboard
      .filter((item) => isDateWithinPeriod(item?.closeDate, currentPeriod))
      .map((item) => ({ value: String(item.id), label: item.name }));
  }, [currentPeriod, selectedDayItems, workboard]);
  const todayDateValue = getTodayDateValue();
  const todayDayData =
    calendarDays.find((day) => day.date === todayDateValue) || null;
  const todayDayItems = asArray(todayDayData?.items);
  const dailyFocusView = useMemo(() => {
    const pendingStatuses = new Set(["pending", "in_progress", "blocked"]);
    const priorityByOpportunityId = new Map(
      developmentPriorities.map((item) => [Number(item.id), item]),
    );
    const firstActionByOpportunityId = new Map();

    actionsToday.forEach((item) => {
      const opportunityId = Number(item.opportunityId || 0);
      if (!opportunityId || firstActionByOpportunityId.has(opportunityId)) {
        return;
      }
      firstActionByOpportunityId.set(opportunityId, item);
    });

    const cardsFromPriorities = developmentPriorities.slice(0, 4).map((item) => {
      const actionItem = firstActionByOpportunityId.get(Number(item.id)) || null;
      const workboardItem = workboardById.get(Number(item.id)) || null;
      return {
        opportunityId: Number(item.id),
        opportunityName: item.name || workboardItem?.name || "Sin oportunidad",
        accountName: item.accountName || workboardItem?.accountName || "Sin cuenta",
        stageName: item.stageName || workboardItem?.stageName || "Sin etapa",
        score: formatOpportunityScore(item.opportunityScore),
        scoreTone:
          item.workspaceSummary?.health?.overallTone ||
          item.scorecardOverallTone ||
          "neutral",
        activityTitle: actionItem?.title || "Siguiente movimiento sugerido",
        activityDetail:
          actionItem?.detail ||
          item.aiNextStepRecommendation ||
          getRecommendedNextMoveTitle(item.recommendedNextMove) ||
          item.primaryRecommendation ||
          "Sin recomendacion sugerida.",
        dueDate: actionItem?.dueDate || item.nextStep?.dueDate || null,
        isOverdue: Boolean(
          (actionItem?.dueDate && actionItem.dueDate < todayDateValue) ||
            item.nextStep?.isOverdue,
        ),
      };
    });

    const cards = cardsFromPriorities.length
      ? cardsFromPriorities
      : Array.from(firstActionByOpportunityId.values())
          .slice(0, 4)
          .map((item) => {
            const workboardItem = workboardById.get(Number(item.opportunityId)) || null;
            const priorityItem = priorityByOpportunityId.get(Number(item.opportunityId)) || null;
            return {
              opportunityId: Number(item.opportunityId),
              opportunityName:
                item.opportunityName || workboardItem?.name || "Sin oportunidad",
              accountName: item.accountName || workboardItem?.accountName || "Sin cuenta",
              stageName: workboardItem?.stageName || priorityItem?.stageName || "Sin etapa",
              score:
                formatOpportunityScore(item.opportunityScore) ??
                formatOpportunityScore(priorityItem?.opportunityScore),
              scoreTone:
                item.scoreTone ||
                priorityItem?.workspaceSummary?.health?.overallTone ||
                priorityItem?.scorecardOverallTone ||
                "neutral",
              activityTitle: item.title || "Siguiente movimiento sugerido",
              activityDetail: item.detail || "Sin recomendacion sugerida.",
              dueDate: item.dueDate || null,
              isOverdue: Boolean(item.dueDate && item.dueDate < todayDateValue),
            };
          });

    return {
      todayActivityCount: todayDayItems.length,
      pendingCount: todayDayItems.filter((item) => pendingStatuses.has(item.status)).length,
      overdueCount: actionsToday.filter(
        (item) => item.dueDate && item.dueDate < todayDateValue,
      ).length,
      focusAction: cards[0] || null,
      cards,
    };
  }, [
    actionsToday,
    developmentPriorities,
    todayDayItems,
    todayDateValue,
    workboardById,
  ]);

  useEffect(() => {
    setCalendarOpportunityId((current) => {
      if (
        current &&
        calendarOpportunityOptions.some((option) => option.value === current)
      ) {
        return current;
      }
      return calendarOpportunityOptions[0]?.value || "";
    });
  }, [calendarOpportunityOptions]);

  if (loading && !dashboard) {
    return <section className="panel centered">Cargando desarrollo comercial...</section>;
  }

  function roundCurrency(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function openOpportunityEditor(opportunityId) {
    navigate(`/opportunities?edit=${opportunityId}`);
  }

  function openActivityModal(item, options = {}) {
    const { viewMode = "form" } = options;
    setActivityModalItem(item);
    setActivityDraft(buildActivityDraft(item));
    setActivityError("");
    setActivityViewMode(viewMode);
  }

  function openEditActivityModal(item, activity, options = {}) {
    const { viewMode = "form" } = options;
    setActivityModalItem(item);
    setActivityDraft(buildActivityDraft(item, activity));
    setActivityError("");
    setActivityViewMode(viewMode);
  }

  function openCreateActivityForDate(item, dateValue) {
    setActivityModalItem(item);
    setActivityDraft({
      ...buildActivityDraft(item),
      scheduledAt: buildDateTimeInputForDay(dateValue),
    });
    setActivityError("");
    setActivityViewMode("form");
  }

  function openActivityViewer(item) {
    openActivityModal(item, { viewMode: "list" });
  }

  function showCreateActivityForm() {
    if (!activityModalItem) return;
    setActivityDraft(buildActivityDraft(activityModalItem));
    setActivityError("");
    setActivityViewMode("form");
  }

  function showActivityList() {
    setActivityError("");
    setActivityViewMode("list");
  }

  function selectActivityFromList(activity) {
    if (!activityModalItem) return;
    setActivityDraft(buildActivityDraft(activityModalItem, activity));
    setActivityError("");
    setActivityViewMode("form");
  }

  function closeActivityModal() {
    if (savingActivity) return;
    setActivityModalItem(null);
    setActivityDraft(buildActivityDraft(null));
    setActivityError("");
    setActivityViewMode("form");
  }

  async function handleSaveActivity(event) {
    event.preventDefault();
    if (!activityModalItem?.id) return;

    if (!activityDraft.activityType || !activityDraft.scheduledAt || !activityDraft.objective.trim()) {
      setActivityError("Completa tipo, fecha/hora y objetivo para guardar la actividad.");
      return;
    }

    setSavingActivity(true);
    setActivityError("");
    try {
      const payload = {
        activityType: activityDraft.activityType,
        scheduledAt: activityDraft.scheduledAt,
        objective: activityDraft.objective.trim(),
        note: activityDraft.note.trim(),
        isPrimaryNextStep: activityDraft.isPrimaryNextStep,
      };

      if (activityDraft.id) {
        await api.patch(
          `/api/commercial-development/opportunities/${activityModalItem.id}/activities/${activityDraft.id}`,
          payload,
        );
      } else {
        await api.post(
          `/api/commercial-development/opportunities/${activityModalItem.id}/activities`,
          payload,
        );
      }
      await loadDashboard(selectedPeriodKey);
      closeActivityModal();
    } catch (requestError) {
      setActivityError(
        getApiErrorMessage(requestError, "No fue posible guardar la actividad."),
      );
    } finally {
      setSavingActivity(false);
    }
  }

  async function handleCompleteActivity() {
    if (!activityModalItem?.id || !activityDraft?.id) return;

    setSavingActivity(true);
    setActivityError("");
    try {
      await api.patch(
        `/api/commercial-development/opportunities/${activityModalItem.id}/activities/${activityDraft.id}`,
        {
          status: "done",
          activityType: activityDraft.activityType,
          scheduledAt: activityDraft.scheduledAt,
          objective: activityDraft.objective.trim(),
          note: activityDraft.note.trim(),
          isPrimaryNextStep: false,
        },
      );
      await loadDashboard(selectedPeriodKey);
      closeActivityModal();
    } catch (requestError) {
      setActivityError(
        getApiErrorMessage(
          requestError,
          "No fue posible marcar la actividad como realizada.",
        ),
      );
    } finally {
      setSavingActivity(false);
    }
  }

  function handleCalendarDayClick(day) {
    setSelectedCalendarDay(day.date);
    setCalendarDate(day.date);
  }

  function handleCalendarEventClick(activity) {
    const workboardItem = workboardById.get(Number(activity.opportunityId));
    const modalItem = workboardItem
      ? {
          ...workboardItem,
          recentActivities: [
            activity,
            ...asArray(workboardItem.recentActivities).filter(
              (item) => Number(item.id) !== Number(activity.id),
            ),
          ],
        }
      : {
          id: Number(activity.opportunityId),
          name: activity.opportunityName,
          accountName: activity.accountName,
          recentActivities: [activity],
          nextScheduledActivity: activity,
          activityCount: 1,
        };
    openEditActivityModal(modalItem, activity);
  }

  function handleCreateCalendarActivity() {
    const opportunityId = Number(calendarOpportunityId || 0);
    if (!opportunityId) return;
    const item = workboardById.get(opportunityId);
    if (!item || !selectedDayData?.date) return;
    openCreateActivityForDate(item, selectedDayData.date);
  }

  function handleFunnelStageClick(stageCode, opportunityCount) {
    if (!opportunityCount) return;
    setSelectedFunnelStage((current) =>
      current === stageCode ? "" : String(stageCode || ""),
    );
  }

  return (
    <section className="panel commercial-development-page">
      <header className="commercial-development-hero">
        <div className="commercial-development-hero-copy">
          <span className="commercial-development-kicker">Cockpit comercial</span>
          <div className="commercial-development-title-row">
            <h2>Desarrollo Comercial</h2>
            <DevelopmentHelp />
          </div>
          <p className="section-helper-text">
            Prioriza cobertura contra cuota, concentra decisiones del trimestre y
            permite ejecutar el siguiente movimiento desde la misma vista.
          </p>
        </div>

        <div className="commercial-development-toolbar">
          <label>
            Trimestre
            <select
              value={selectedPeriodKey}
              onChange={(event) => setSelectedPeriodKey(event.target.value)}
            >
              {periodOptions.map((period) => (
                <option
                  key={`${period.year}-${period.quarter}`}
                  value={`${period.year}-${period.quarter}`}
                >
                  {period.label}
                </option>
              ))}
              {!periodOptions.length && development.period ? (
                <option
                  value={`${development.period.year}-${development.period.quarter}`}
                >
                  {development.period.label}
                </option>
              ) : null}
            </select>
          </label>
          <button
            type="button"
            className="secondary-button"
            onClick={() => loadDashboard(selectedPeriodKey)}
          >
            Actualizar lectura
          </button>
        </div>
      </header>

      {error ? <p className="form-error">{error}</p> : null}

      <div className="commercial-development-metrics-grid">
        <SummaryMetric
          label="Cuota asignada"
          value={formatCurrency(
            quota.assignedAmount,
            development.period?.baseCurrencyCode,
          )}
          helper={development.period?.label || "Trimestre activo"}
        />
        <SummaryMetric
          label="Real ganado"
          value={formatCurrency(
            quota.actualAmount,
            development.period?.baseCurrencyCode,
          )}
          helper={`Avance ${formatPercent(quota.attainmentPercent)}`}
          tone="is-soft"
        />
        <SummaryMetric
          label="Brecha actual"
          value={formatCurrency(
            quota.gapAmount,
            development.period?.baseCurrencyCode,
          )}
          helper="Monto que aún falta en real"
          tone={Number(quota.gapAmount || 0) > 0 ? "is-danger" : "is-good"}
        />
        <SummaryMetric
          label="Pipeline comprometido"
          value={formatCurrency(
            quota.committedOpenAmount,
            development.period?.baseCurrencyCode,
          )}
          helper="Monto abierto solo en negociación o waiting"
          tone="is-soft"
        />
        <SummaryMetric
          label="Pipeline no comprometido"
          value={formatCurrency(
            nonCommittedPipelineAmount,
            development.period?.baseCurrencyCode,
          )}
          helper={`${nonCommittedStageCount} etapa(s) abiertas en desarrollo, cotización o demostración`}
        />
      </div>

      <div className="commercial-development-main-grid commercial-development-focus-layout">
        <section className="commercial-development-spotlight commercial-development-funnel-panel">
          <div className="commercial-development-section-header commercial-development-funnel-header">
            <div>
              <h3>Embudo del trimestre</h3>
              <p>
                Lectura agregada del pipeline abierto por etapa comercial.
              </p>
            </div>
            <span>{currentPeriod?.label || "Sin trimestre"}</span>
          </div>

          <div className="commercial-development-funnel-toolbar">
            <div className="commercial-development-funnel-summary-chips">
              <div className="commercial-development-funnel-chip">
                <span>Pipeline abierto</span>
                <strong>
                  {formatCurrency(
                    funnel.totalOpenAmount,
                    currentPeriod?.baseCurrencyCode,
                  )}
                </strong>
              </div>
              <div className="commercial-development-funnel-chip">
                <span>Etapa dominante</span>
                <strong>{funnel.dominantStageName}</strong>
              </div>
              <div className="commercial-development-funnel-chip">
                <span>Comprometido</span>
                <strong>{formatPercent(funnel.committedSharePercent)}</strong>
              </div>
            </div>
          </div>

          <div className="commercial-development-funnel-visual" role="list" aria-label="Embudo trimestral por etapa">
            {funnel.stages.length ? (
              funnel.stages.map((stage, index) => {
                const isActive = selectedFunnelStage === stage.stageCode;
                const isDimmed = Boolean(selectedFunnelStage && !isActive);
                const isEmpty = !stage.opportunityCount;
                const isNonCommittedBraceAnchor =
                  nonCommittedBraceRange.isVisible &&
                  stage.stageCode === NON_COMMITTED_BRACE_ANCHOR_STAGE_CODE;
                const isCommittedBraceAnchor =
                  committedBraceRange.isVisible &&
                  stage.stageCode === COMMITTED_BRACE_ANCHOR_STAGE_CODE;
                const stageGroupMarker = isNonCommittedBraceAnchor
                  ? {
                      groupKey: "nonCommitted",
                      label: FUNNEL_GROUP_LABELS.nonCommitted,
                      stageSpan: nonCommittedBraceRange.stageSpan,
                    }
                  : isCommittedBraceAnchor
                    ? {
                        groupKey: "committed",
                        label: FUNNEL_GROUP_LABELS.committed,
                        stageSpan: committedBraceRange.stageSpan,
                      }
                    : null;
                const palette = getFunnelStagePalette(index);
                const displayValue = formatCurrency(
                  stage.openAmount,
                  currentPeriod?.baseCurrencyCode,
                );
                const secondaryValue = `${stage.opportunityCount} oportunidad${stage.opportunityCount === 1 ? "" : "es"}`;
                const shareLabel = formatPercent(stage.sharePercent);

                return (
                  <div
                    key={stage.stageCode}
                    className={[
                      "commercial-development-funnel-row",
                      isActive ? "is-active" : "",
                      isDimmed ? "is-dimmed" : "",
                      isEmpty ? "is-empty" : "",
                    ]
                      .join(" ")
                      .trim()}
                    style={{
                      "--funnel-stage-color": palette.solid,
                      "--funnel-stage-soft": palette.soft,
                      "--funnel-stage-border": palette.border,
                    }}
                  >
                    <button
                      type="button"
                      className={[
                        "commercial-development-funnel-stage",
                        `is-index-${index + 1}`,
                        stage.isCommitted ? "is-committed" : "is-open",
                      ]
                        .join(" ")
                        .trim()}
                      style={{ width: `${getFunnelShapeWidth(index, funnel.stages.length)}%` }}
                      onClick={() =>
                        handleFunnelStageClick(stage.stageCode, stage.opportunityCount)
                      }
                      disabled={isEmpty}
                    >
                      <div className="commercial-development-funnel-stage-shell">
                        <div className="commercial-development-funnel-stage-head">
                          <span className="commercial-development-funnel-stage-name">
                            {stage.stageName}
                          </span>
                          <small className="commercial-development-funnel-stage-share">
                            {shareLabel}
                          </small>
                        </div>
                        <div className="commercial-development-funnel-stage-body">
                          <strong>{displayValue}</strong>
                          <p>{secondaryValue}</p>
                        </div>
                      </div>
                    </button>
                    <div
                      className="commercial-development-funnel-row-marker-slot"
                      aria-hidden="true"
                    >
                      {stageGroupMarker ? (
                        <div
                          className={[
                            "commercial-development-funnel-group-marker",
                            `is-${stageGroupMarker.groupKey}`,
                          ]
                            .join(" ")
                            .trim()}
                          style={{ "--funnel-group-stage-span": stageGroupMarker.stageSpan }}
                        >
                          <svg
                            className="commercial-development-funnel-group-brace"
                            viewBox="0 0 26 100"
                            preserveAspectRatio="none"
                            focusable="false"
                          >
                            <path d="M3 2 C10 2 14 5 14 12 L14 88 C14 95 10 98 3 98" />
                          </svg>
                          <span className="commercial-development-funnel-group-label">
                            {stageGroupMarker.label}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="empty-state">No hay pipeline abierto para este trimestre.</div>
            )}

            {funnel.stages.length ? (
              <div className="commercial-development-funnel-tip-row" aria-hidden="true">
                <div className="commercial-development-funnel-tip-slot">
                  <div className="commercial-development-funnel-tip" />
                </div>
                <div className="commercial-development-funnel-row-marker-slot" />
              </div>
            ) : null}
          </div>
        </section>

        <section className="commercial-development-spotlight commercial-development-daily-focus-panel">
          <div className="commercial-development-section-header commercial-development-daily-focus-header">
            <div>
              <h3>Enfoque de hoy</h3>
              <p>
                Actividades del día, siguiente movimiento sugerido y score por oportunidad.
              </p>
            </div>
            <span>{todayDayData?.date ? formatDate(todayDayData.date) : "Hoy"}</span>
          </div>

          <div className="commercial-development-daily-focus-summary">
            <article className="commercial-development-daily-focus-stat">
              <span>Hoy</span>
              <strong>{dailyFocusView.todayActivityCount}</strong>
              <small>actividad{dailyFocusView.todayActivityCount === 1 ? "" : "es"}</small>
            </article>
            <article className="commercial-development-daily-focus-stat">
              <span>Pendientes</span>
              <strong>{dailyFocusView.pendingCount}</strong>
              <small>requieren gestión</small>
            </article>
            <article className="commercial-development-daily-focus-stat">
              <span>Vencidas</span>
              <strong>{dailyFocusView.overdueCount}</strong>
              <small>atender primero</small>
            </article>
          </div>

          {dailyFocusView.focusAction ? (
            <article className="commercial-development-daily-focus-featured">
              <div className="commercial-development-daily-focus-item-head">
                <div>
                  <span className="commercial-development-daily-focus-kicker">
                    Siguiente mejor movimiento
                  </span>
                  <strong>{dailyFocusView.focusAction.opportunityName}</strong>
                </div>
                {dailyFocusView.focusAction.score !== null ? (
                  <span
                    className={[
                      "commercial-development-score-badge",
                      `is-${dailyFocusView.focusAction.scoreTone || "neutral"}`,
                    ]
                      .join(" ")
                      .trim()}
                  >
                    {dailyFocusView.focusAction.score}
                  </span>
                ) : null}
              </div>
              <p>{dailyFocusView.focusAction.activityDetail}</p>
              <div className="commercial-development-daily-focus-meta">
                <span>{dailyFocusView.focusAction.stageName}</span>
                <span>{dailyFocusView.focusAction.accountName}</span>
                <span>
                  {dailyFocusView.focusAction.dueDate
                    ? `Objetivo ${formatDate(dailyFocusView.focusAction.dueDate)}`
                    : "Sin fecha comprometida"}
                </span>
              </div>
            </article>
          ) : (
            <div className="empty-state">
              No hay actividades ni movimientos sugeridos para hoy.
            </div>
          )}

          <div className="commercial-development-daily-focus-list">
            {dailyFocusView.cards.length ? (
              dailyFocusView.cards.map((item) => (
                <article
                  key={`daily-focus-${item.opportunityId}`}
                  className="commercial-development-daily-focus-item"
                >
                  <div className="commercial-development-daily-focus-item-head">
                    <div>
                      <strong>{item.opportunityName}</strong>
                      <p>{item.activityTitle}</p>
                    </div>
                    {item.score !== null ? (
                      <span
                        className={[
                          "commercial-development-score-badge",
                          `is-${item.scoreTone || "neutral"}`,
                        ]
                          .join(" ")
                          .trim()}
                      >
                        {item.score}
                      </span>
                    ) : null}
                  </div>
                  <p className="commercial-development-daily-focus-item-copy">
                    {item.activityDetail}
                  </p>
                  <div className="commercial-development-daily-focus-meta">
                    <span>{item.stageName}</span>
                    <span>{item.accountName}</span>
                    <span className={item.isOverdue ? "is-overdue" : ""}>
                      {item.dueDate
                        ? item.isOverdue
                          ? `Vencida ${formatDate(item.dueDate)}`
                          : `Objetivo ${formatDate(item.dueDate)}`
                        : "Sin fecha"}
                    </span>
                  </div>
                  <div className="commercial-development-daily-focus-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => openOpportunityEditor(item.opportunityId)}
                    >
                      Abrir oportunidad
                    </button>
                  </div>
                </article>
              ))
            ) : null}
          </div>
        </section>
      </div>

      <section className="commercial-development-spotlight commercial-development-calendar-panel">
        <div className="commercial-development-section-header commercial-development-calendar-header">
          <div>
            <h3>Agenda comercial del trimestre</h3>
            <p>
              Visualiza actividades por dia, semana o mes y abre seguimiento sin salir del modulo.
            </p>
          </div>
          <span>{formatCalendarRange(calendarFilters)}</span>
        </div>

        <div className="commercial-development-calendar-toolbar">
          <div className="commercial-development-calendar-view-switcher" role="tablist" aria-label="Vista del calendario">
            {[
              { value: "day", label: "Dia" },
              { value: "week", label: "Semana" },
              { value: "month", label: "Mes" },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                className={calendarView === option.value ? "is-active" : ""}
                onClick={() => setCalendarView(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="commercial-development-calendar-nav">
            <div className="commercial-development-calendar-nav-segmented" role="group" aria-label="Navegacion del calendario">
              <button
                type="button"
                onClick={() =>
                  setCalendarDate((current) =>
                    shiftCalendarDate(calendarView, current, -1),
                  )
                }
              >
                Anterior
              </button>
              <button
                type="button"
                className="is-accent"
                onClick={() => setCalendarDate(getTodayDateValue())}
              >
                Hoy
              </button>
              <button
                type="button"
                onClick={() =>
                  setCalendarDate((current) =>
                    shiftCalendarDate(calendarView, current, 1),
                  )
                }
              >
                Siguiente
              </button>
            </div>
            <label className="commercial-development-calendar-date-input">
              <span>Fecha ancla</span>
              <input
                type="date"
                value={calendarDate}
                onChange={(event) => setCalendarDate(event.target.value)}
              />
            </label>
          </div>
        </div>

        {calendarError ? <p className="form-error">{calendarError}</p> : null}

        <div className="commercial-development-calendar-summary">
          <div>
            <span>Total</span>
            <strong>{Number(calendarData?.summary?.total || 0)}</strong>
          </div>
          <div>
            <span>Pendientes</span>
            <strong>{Number(calendarData?.summary?.pending || 0)}</strong>
          </div>
          <div>
            <span>En curso</span>
            <strong>{Number(calendarData?.summary?.inProgress || 0)}</strong>
          </div>
          <div>
            <span>Realizadas</span>
            <strong>{Number(calendarData?.summary?.done || 0)}</strong>
          </div>
        </div>

        <div className="commercial-development-calendar-layout">
          <div>
            {calendarLoading ? (
              <div className="empty-state">Actualizando agenda...</div>
            ) : calendarDays.length ? (
              <div className={calendarView === "month" ? "commercial-development-calendar-month-frame" : ""}>
                {calendarView === "month" ? (
                  <div className="commercial-development-calendar-month-weekdays" aria-hidden="true">
                    {CALENDAR_WEEKDAY_HEADERS.map((label) => (
                      <div key={label} className="commercial-development-calendar-month-weekday">
                        {label}
                      </div>
                    ))}
                  </div>
                ) : null}

                <div
                  className={`commercial-development-calendar-grid is-${calendarView}`}
                >
                  {calendarView === "month"
                    ? Array.from({ length: monthLeadingEmptySlots }).map((_, index) => (
                        <div
                          key={`calendar-empty-${index}`}
                          className="commercial-development-calendar-day is-placeholder"
                          aria-hidden="true"
                        >
                          <span className="commercial-development-calendar-placeholder-mark" />
                        </div>
                      ))
                    : null}
                  {calendarDays.map((day) => {
                    const isSelected = day.date === selectedDayData?.date;
                    const isToday = day.date === getTodayDateValue();
                    const previewLimit = calendarView === "month" ? 3 : 4;
                    const heatLevelClass = getCalendarHeatLevel(day.count);
                    return (
                      <button
                        key={day.date}
                        type="button"
                        className={`commercial-development-calendar-day ${calendarView === "month" ? "is-month" : ""} ${heatLevelClass} ${isSelected ? "is-selected" : ""} ${isToday ? "is-today" : ""}`.trim()}
                        onClick={() => handleCalendarDayClick(day)}
                      >
                        <div className="commercial-development-calendar-day-header">
                          {calendarView === "month" ? (
                            <div className="commercial-development-calendar-month-day-copy">
                              <strong className="commercial-development-calendar-month-day-number">
                                {Number(String(day.date).slice(-2))}
                              </strong>
                              <span className="commercial-development-calendar-month-day-label">
                                {isToday ? "Hoy" : getWeekdayLabel(day.date, "short")}
                              </span>
                            </div>
                          ) : (
                            <div>
                              <span>{getWeekdayLabel(day.date, "long")}</span>
                              <strong>{formatDate(day.date)}</strong>
                            </div>
                          )}
                          <span className="commercial-development-calendar-count">
                            {day.count}
                          </span>
                        </div>

                        <div className="commercial-development-calendar-day-items">
                          {asArray(day.items).slice(0, previewLimit).map((item) => (
                            <span
                              key={`calendar-item-preview-${item.id}`}
                              className="commercial-development-calendar-preview-pill"
                            >
                              {formatDateTime(item.scheduledAt).split(",")[1]?.trim() || getActivityTypeLabel(item.activityType)}
                            </span>
                          ))}
                          {day.count > previewLimit ? (
                            <span className="commercial-development-calendar-preview-more">
                              +{day.count - previewLimit} mas
                            </span>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="empty-state">No hay actividades en este rango.</div>
            )}
          </div>

          <aside className="commercial-development-calendar-detail">
            <div className="commercial-development-calendar-detail-header">
              <div className="commercial-development-calendar-detail-heading">
                <span>Dia seleccionado</span>
                <h4>{selectedDayData?.date ? formatDate(selectedDayData.date) : "Sin seleccion"}</h4>
                <p>
                  {selectedDayData?.date
                    ? `${getWeekdayLabel(selectedDayData.date, "long")} · agenda operativa del dia`
                    : "Selecciona un dia para ver su agenda."}
                </p>
              </div>
              <span className="commercial-development-pill is-low">
                {selectedDayItems.length} actividad{selectedDayItems.length === 1 ? "" : "es"}
              </span>
            </div>

            <div className="commercial-development-calendar-detail-summary">
              <div className="commercial-development-calendar-detail-chip">
                <span>Oportunidades activas</span>
                <strong>{calendarOpportunityOptions.length}</strong>
              </div>
              <div className="commercial-development-calendar-detail-chip">
                <span>Accion sugerida</span>
                <strong>
                  {selectedDayItems.length ? "Abrir seguimiento" : "Programar nueva"}
                </strong>
              </div>
            </div>

            <div className="commercial-development-calendar-create-box">
              <div className="commercial-development-calendar-create-copy">
                <span className="commercial-development-calendar-inline-icon" aria-hidden="true">
                  <CalendarPlusIcon />
                </span>
                <strong>Nueva actividad</strong>
                <p>Elige la oportunidad y crea la siguiente accion para este dia.</p>
              </div>
              <label>
                Oportunidad
                <select
                  value={calendarOpportunityId}
                  onChange={(event) => setCalendarOpportunityId(event.target.value)}
                  disabled={!calendarOpportunityOptions.length}
                >
                  {calendarOpportunityOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn-primary"
                onClick={handleCreateCalendarActivity}
                disabled={!calendarOpportunityId || !selectedDayData?.date}
              >
                Nueva actividad en este dia
              </button>
            </div>

            <div className="commercial-development-calendar-event-list">
              {selectedDayItems.length ? (
                selectedDayItems.map((item) => (
                  <button
                    key={`calendar-event-${item.id}`}
                    type="button"
                    className="commercial-development-calendar-event-card"
                    onClick={() => handleCalendarEventClick(item)}
                  >
                    <div className="commercial-development-inline-row">
                      <strong>{getActivityTypeLabel(item.activityType)}</strong>
                      <span className="commercial-development-pill is-low">
                        {getActivityStatusLabel(item.status)}
                      </span>
                    </div>
                    <p>{item.title || "Sin objetivo registrado"}</p>
                    <div className="commercial-development-calendar-event-meta">
                      <span>{formatDateTime(item.scheduledAt)}</span>
                      <span>{item.opportunityName}</span>
                      <span>{item.accountName}</span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="commercial-development-calendar-empty-state">
                  <span className="commercial-development-calendar-empty-icon" aria-hidden="true">
                    <SparkIcon />
                  </span>
                  <strong>Dia libre</strong>
                  <p>
                    No hay actividades programadas para este dia. Puedes crear una
                    desde este panel.
                  </p>
                </div>
              )}
            </div>
          </aside>
        </div>
      </section>

      <section className="commercial-development-spotlight">
          <div className="commercial-development-section-header">
            <div>
              <h3>Cerrar la brecha este trimestre</h3>
              <p>
                {selectedFunnelStageData
                  ? `Mostrando oportunidades en ${selectedFunnelStageData.stageName}.`
                  : "Estas son las oportunidades abiertas y activadas del período, ordenadas por etapa de mayor a menor."}
              </p>
            </div>
            <span>{currentPeriod?.label || "Sin trimestre"}</span>
          </div>

          {visibleGapClosingCards.length ? (
            <div className="commercial-development-gap-coverage-list">
              {visibleGapClosingCards.map((item) => (
                <article
                  key={`gap-coverage-${item.id}`}
                  className="commercial-development-gap-coverage-card"
                >
                  <div className="commercial-development-inline-row">
                    <div>
                      <strong>{item.name}</strong>
                      <p>{item.accountName}</p>
                    </div>
                    <div className="commercial-development-card-actions">
                      <button
                        type="button"
                        className="commercial-development-activity-trigger"
                        onClick={() => openOpportunityEditor(item.id)}
                        aria-label={`Editar oportunidad ${item.name}`}
                        title="Editar oportunidad"
                      >
                        <EditOpportunityIcon />
                      </button>
                      <div className="commercial-development-card-badges">
                        <span className={`commercial-development-pill ${item.coverageKind === "committed" ? "is-low" : "is-medium"}`}>
                          {item.coverageKind === "committed" ? "Comprometida" : "Ponderada"}
                        </span>
                        <span className="commercial-development-date-badge">
                          Fecha objetivo: {formatDate(item.closeDate)}
                        </span>
                      </div>
                      <button
                        type="button"
                        className={`commercial-development-activity-trigger ${item.activityCount ? "has-activity" : ""}`.trim()}
                        onClick={() => openActivityViewer(item)}
                        aria-label={`Ver actividades de ${item.name}`}
                        title="Ver actividades"
                      >
                        <ActivityIcon />
                      </button>
                    </div>
                  </div>

                  <div className="commercial-development-gap-coverage-grid">
                    <div>
                      <span>Monto total</span>
                      <strong>
                        {formatCurrency(item.amountUsd, currentPeriod?.baseCurrencyCode)}
                      </strong>
                    </div>
                    <div>
                      <span>Etapa actual</span>
                      <strong>{item.stageName || "Sin etapa"}</strong>
                    </div>
                    <div>
                      <span>Riesgo</span>
                      <strong>{getRiskLabel(item.riskLevel)}</strong>
                    </div>
                  </div>

                  <div className="commercial-development-gap-coverage-meta">
                    <div className="commercial-development-gap-coverage-insight">
                      <span>Lectura actual</span>
                      <p>
                        {item.aiStatusSummary || "Sin lectura sugerida disponible."}
                      </p>
                    </div>
                    <div className="commercial-development-gap-coverage-insight is-accent">
                      <span>Siguiente paso sugerido</span>
                      <p>
                        {item.aiNextStepRecommendation || "Sin recomendación sugerida."}
                      </p>
                    </div>
                  </div>

                  <div className="commercial-development-activity-preview">
                    <p>
                      <strong>Proxima actividad:</strong>{" "}
                      {item.nextScheduledActivity
                        ? `${getActivityTypeLabel(item.nextScheduledActivity.activityType)} · ${formatDateTime(item.nextScheduledActivity.scheduledAt)}`
                        : "Sin actividad programada"}
                    </p>
                    <p>
                      <strong>Siguiente paso principal:</strong>{" "}
                      {item.nextStep?.title
                        ? `${getActivityTypeLabel(item.nextStep.actionType)}: ${item.nextStep.title}`
                        : "Sin definir"}
                    </p>
                    <p>
                      <strong>Historial:</strong>{" "}
                      {item.activityCount
                        ? `${item.activityCount} actividad${item.activityCount === 1 ? "" : "es"}`
                        : "Sin actividades"}
                    </p>
                    {item.nextScheduledActivity ? (
                      <div className="commercial-development-activity-preview-actions">
                        <button
                          type="button"
                          className="commercial-development-activity-icon-button"
                          onClick={() =>
                            openEditActivityModal(item, item.nextScheduledActivity)
                          }
                          aria-label={`Reprogramar actividad de ${item.name}`}
                          title="Reprogramar actividad"
                        >
                          <RescheduleIcon />
                        </button>
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              {selectedFunnelStageData
                ? `No hay oportunidades visibles en ${selectedFunnelStageData.stageName} para este trimestre.`
                : gapClosingView.gapAmount > 0
                  ? "No hay oportunidades del trimestre con aporte material a la brecha."
                  : "La cuota ya está cubierta; no hace falta cobertura adicional en este trimestre."}
            </div>
          )}
      </section>

      <CommercialActivityModal
        item={activityModalItem}
        draft={activityDraft}
        setDraft={setActivityDraft}
        saving={savingActivity}
        error={activityError}
        onClose={closeActivityModal}
        onSubmit={handleSaveActivity}
        onMarkDone={handleCompleteActivity}
        viewMode={activityViewMode}
        onShowCreate={showCreateActivityForm}
        onShowList={showActivityList}
        onSelectActivity={selectActivityFromList}
        currencyCode={currentPeriod?.baseCurrencyCode}
      />
    </section>
  );
}