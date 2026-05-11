import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, getApiErrorMessage } from "./api";

const ACTIVITY_TYPE_OPTIONS = [
  { value: "call", label: "Llamada" },
  { value: "conference", label: "Conferencia" },
  { value: "visit", label: "Visita" },
  { value: "presentation", label: "Presentacion" },
  { value: "other", label: "Otro" },
];

const ACTION_TYPE_OPTIONS = [
  { value: "next_step", label: "Siguiente paso" },
  { value: "follow_up", label: "Seguimiento" },
  { value: "waiting_customer", label: "Esperando cliente" },
  { value: "send_email", label: "Enviar correo" },
  { value: "prepare_proposal", label: "Preparar propuesta" },
  { value: "request_information", label: "Solicitar informacion" },
  { value: "coordinate_presales", label: "Coordinar preventa" },
  { value: "send_documentation", label: "Enviar documentacion" },
  { value: "update_quote", label: "Actualizar cotizacion" },
  { value: "internal_approval", label: "Gestionar aprobacion interna" },
  { value: "other_action", label: "Otra accion" },
];

const ACTIVITY_STATUS_LABELS = {
  pending: "Programada",
  confirmed: "Confirmada",
  in_progress: "En curso",
  blocked: "Bloqueada",
  done: "Realizada",
  missed: "No realizada",
  rescheduled: "Reprogramada",
  cancelled: "Cancelada",
};

const ACTION_STATUS_LABELS = {
  pending: "Pendiente",
  in_progress: "En curso",
  blocked: "Bloqueada",
  done: "Realizada",
  cancelled: "Cancelada",
};

const ACTIVITY_STATUS_OPTIONS = [
  { value: "pending", label: "Programada" },
  { value: "confirmed", label: "Confirmada" },
  { value: "rescheduled", label: "Reprogramada" },
  { value: "done", label: "Realizada" },
  { value: "missed", label: "No realizada" },
  { value: "cancelled", label: "Cancelada" },
];

const ACTION_STATUS_OPTIONS = [
  { value: "pending", label: "Pendiente" },
  { value: "in_progress", label: "En curso" },
  { value: "blocked", label: "Bloqueada" },
  { value: "done", label: "Realizada" },
  { value: "cancelled", label: "Cancelada" },
];

const ACTION_PRIORITY_OPTIONS = [
  { value: "high", label: "Alta" },
  { value: "medium", label: "Media" },
  { value: "low", label: "Baja" },
];

const EMAIL_PURPOSE_OPTIONS = [
  { value: "proposal", label: "Enviar propuesta" },
  { value: "request_information", label: "Enviar informacion" },
  { value: "other", label: "Otro" },
];

const EMAIL_PURPOSE_VALUE_SET = new Set(
  EMAIL_PURPOSE_OPTIONS.map((option) => option.value),
);

const ACCOUNT_CONTACTS_LOAD_TIMEOUT_MS = 8000;
const COMMERCIAL_EMAIL_ATTACHMENT_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "text/plain",
  "image/png",
  "image/jpeg",
];
const COMMERCIAL_EMAIL_ATTACHMENT_DEFAULT_CONSTRAINTS = {
  maxFiles: 10,
  maxTotalBytes: 15 * 1024 * 1024,
  allowedMimeTypes: COMMERCIAL_EMAIL_ATTACHMENT_ALLOWED_MIME_TYPES,
};
const EMPTY_EMAIL_ATTACHMENT_OPTIONS = {
  status: "idle",
  error: "",
  libraryFiles: [],
  opportunityDocuments: [],
  quotationVersions: [],
  constraints: COMMERCIAL_EMAIL_ATTACHMENT_DEFAULT_CONSTRAINTS,
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
  const startIndex = stages.findIndex((stage) =>
    stageCodes.has(stage.stageCode),
  );
  const endIndex = stages.reduce(
    (lastMatchIndex, stage, index) =>
      stageCodes.has(stage.stageCode) ? index : lastMatchIndex,
    -1,
  );
  const isVisible =
    startIndex !== -1 && endIndex !== -1 && endIndex >= startIndex;

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
  return parsed.toLocaleDateString("es-MX", {
    weekday: variant,
    timeZone: "UTC",
  });
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
    asArray(pipelineByStage).map((stage) => [
      stage?.stageCode || "unknown",
      stage,
    ]),
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
    (left, right) =>
      Number(right.openAmount || 0) - Number(left.openAmount || 0),
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

function getActionTypeLabel(value) {
  return (
    ACTION_TYPE_OPTIONS.find((option) => option.value === value)?.label ||
    "Accion"
  );
}

function getActionDraftObjective(draft) {
  const details = {
    ...emptyActionDetails(),
    ...(draft?.details || {}),
  };
  const explicitObjective = String(draft?.objective || "").trim();
  if (explicitObjective) return explicitObjective;
  if (draft?.activityType === "send_email" && details.subject.trim()) {
    return details.subject.trim();
  }
  return getActionTypeLabel(draft?.activityType);
}

function getEntryKind(value) {
  return ACTIVITY_TYPE_OPTIONS.some((option) => option.value === value)
    ? "activity"
    : "action";
}

function getEntryKindLabel(value) {
  return value === "action" ? "Accion" : "Actividad";
}

function getEntryTypeLabel(entryKind, value) {
  return entryKind === "action"
    ? getActionTypeLabel(value)
    : getActivityTypeLabel(value);
}

function getEntryStatusLabel(entryKind, value) {
  if (entryKind === "action") {
    return ACTION_STATUS_LABELS[value] || "Pendiente";
  }
  return getActivityStatusLabel(value);
}

function getScheduledAtDefaultValue() {
  const date = new Date();
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + 1);
  const part = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}`;
}

function getDueDateDefaultValue() {
  return getTodayDateValue();
}

function emptyActionDetails() {
  return {
    recipient: "",
    cc: "",
    subject: "",
    purpose: "proposal",
    purposeOther: "",
    messageBody: "",
    attachmentsNote: "",
    attachments: [],
    expectedResponse: "",
    responseDueDate: "",
    markDoneOnSend: false,
  };
}

function buildEmailAttachmentId(attachment = {}) {
  if (attachment.sourceType === "library_file") {
    return `library:${attachment.resourcePublicId || ""}:${attachment.filePublicId || ""}`;
  }
  if (attachment.sourceType === "opportunity_document") {
    return `opportunity:${attachment.documentPublicId || ""}`;
  }
  if (attachment.sourceType === "quotation_pdf") {
    return `quotation:${attachment.quotationId || ""}:${attachment.quotationVersionId || ""}`;
  }
  return String(attachment.id || "").trim();
}

function normalizeEmailAttachment(attachment = {}) {
  const sourceType = String(attachment?.sourceType || "").trim();
  if (!sourceType) return null;

  const normalized = {
    id:
      buildEmailAttachmentId(attachment) ||
      `${sourceType}:${Math.random().toString(36).slice(2, 10)}`,
    sourceType,
    sourceLabel: String(attachment?.sourceLabel || "").trim(),
    fileName: String(
      attachment?.fileName || attachment?.proposalName || "",
    ).trim(),
    mimeType: String(attachment?.mimeType || "")
      .trim()
      .toLowerCase(),
    byteSize:
      attachment?.byteSize === null || attachment?.byteSize === undefined
        ? null
        : Number(attachment.byteSize),
    resourcePublicId: String(attachment?.resourcePublicId || "").trim(),
    filePublicId: String(attachment?.filePublicId || "").trim(),
    documentPublicId: String(attachment?.documentPublicId || "").trim(),
    quotationId: attachment?.quotationId
      ? Number(attachment.quotationId)
      : null,
    quotationVersionId: attachment?.quotationVersionId
      ? Number(attachment.quotationVersionId)
      : null,
    proposalName: String(attachment?.proposalName || "").trim(),
    title: String(attachment?.title || "").trim(),
    summary: String(attachment?.summary || "").trim(),
    assetTypeLabel: String(attachment?.assetTypeLabel || "").trim(),
    versionNumber: attachment?.versionNumber
      ? Number(attachment.versionNumber)
      : null,
    quotationDate: String(attachment?.quotationDate || "").trim(),
    statusName: String(attachment?.statusName || "").trim(),
    createdAt: String(attachment?.createdAt || "").trim(),
  };

  if (
    normalized.sourceType === "library_file" &&
    normalized.resourcePublicId &&
    normalized.filePublicId
  ) {
    return normalized;
  }
  if (
    normalized.sourceType === "opportunity_document" &&
    normalized.documentPublicId
  ) {
    return normalized;
  }
  if (
    normalized.sourceType === "quotation_pdf" &&
    normalized.quotationVersionId
  ) {
    return normalized;
  }
  return null;
}

function normalizeEmailAttachments(attachments) {
  const byId = new Map();
  asArray(attachments).forEach((attachment) => {
    const normalized = normalizeEmailAttachment(attachment);
    if (normalized) {
      byId.set(normalized.id, normalized);
    }
  });
  return Array.from(byId.values());
}

function addEmailAttachment(attachments, attachment) {
  return normalizeEmailAttachments([...asArray(attachments), attachment]);
}

function removeEmailAttachment(attachments, attachmentId) {
  return normalizeEmailAttachments(attachments).filter(
    (attachment) => attachment.id !== attachmentId,
  );
}

function normalizeEmailAttachmentOptionsResponse(data = {}) {
  return {
    status: "loaded",
    error: "",
    libraryFiles: normalizeEmailAttachments(data?.libraryFiles),
    opportunityDocuments: normalizeEmailAttachments(data?.opportunityDocuments),
    quotationVersions: normalizeEmailAttachments(data?.quotationVersions),
    constraints: {
      ...COMMERCIAL_EMAIL_ATTACHMENT_DEFAULT_CONSTRAINTS,
      ...(data?.constraints || {}),
      allowedMimeTypes:
        asArray(data?.constraints?.allowedMimeTypes).length > 0
          ? data.constraints.allowedMimeTypes
          : COMMERCIAL_EMAIL_ATTACHMENT_DEFAULT_CONSTRAINTS.allowedMimeTypes,
    },
  };
}

function buildOpportunityDocumentEmailAttachment(document = {}) {
  return normalizeEmailAttachment({
    id: `opportunity:${document.publicId || document.documentPublicId || ""}`,
    sourceType: "opportunity_document",
    sourceLabel: "Documento local",
    documentPublicId: document.publicId || document.documentPublicId,
    fileName: document.originalFileName || document.fileName || "documento",
    mimeType: document.mimeType || "application/octet-stream",
    byteSize: document.byteSize,
    createdAt: document.createdAt,
  });
}

function formatFileSize(byteSize) {
  const numericValue = Number(byteSize || 0);
  if (!numericValue) return "Tamano no disponible";
  if (numericValue >= 1024 * 1024) {
    return `${(numericValue / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (numericValue >= 1024) {
    return `${Math.round(numericValue / 1024)} KB`;
  }
  return `${numericValue} B`;
}

function validateLocalEmailAttachmentFiles(
  files,
  constraints,
  existingCount = 0,
) {
  const nextFiles = asArray(files);
  if (!nextFiles.length) return "";

  const allowedMimeTypes = asArray(constraints?.allowedMimeTypes).length
    ? constraints.allowedMimeTypes
    : COMMERCIAL_EMAIL_ATTACHMENT_DEFAULT_CONSTRAINTS.allowedMimeTypes;
  const maxFiles = Number(
    constraints?.maxFiles ||
      COMMERCIAL_EMAIL_ATTACHMENT_DEFAULT_CONSTRAINTS.maxFiles,
  );

  if (existingCount + nextFiles.length > maxFiles) {
    return `Solo puedes incluir hasta ${maxFiles} documentos por correo.`;
  }

  const invalidFile = nextFiles.find(
    (file) => file?.type && !allowedMimeTypes.includes(file.type),
  );
  if (invalidFile) {
    return `El archivo ${invalidFile.name} no tiene un tipo permitido para envio.`;
  }

  return "";
}

function normalizeEmailActionDetails(details = {}) {
  const normalizedPurpose = String(details?.purpose || "proposal").trim();
  const normalizedPurposeOther = String(details?.purposeOther || "").trim();
  const hasKnownPurpose = EMAIL_PURPOSE_VALUE_SET.has(normalizedPurpose);

  return {
    ...emptyActionDetails(),
    ...details,
    purpose: hasKnownPurpose
      ? normalizedPurpose || "proposal"
      : normalizedPurpose
        ? "other"
        : "proposal",
    purposeOther: hasKnownPurpose
      ? normalizedPurposeOther
      : normalizedPurposeOther || normalizedPurpose,
    attachments: normalizeEmailAttachments(details?.attachments),
  };
}

function getEmailSuggestionContext(item) {
  const opportunityName = String(
    item?.opportunityName || item?.name || "",
  ).trim();
  const accountName = String(item?.accountName || "").trim();

  if (opportunityName) return opportunityName;
  if (accountName && accountName !== "Sin cuenta") return accountName;
  return "la oportunidad";
}

function getEmailPurposeTopic(details, item) {
  const normalizedDetails = normalizeEmailActionDetails(details);
  if (normalizedDetails.purpose === "other") {
    return normalizedDetails.purposeOther || getEmailSuggestionContext(item);
  }
  return getEmailSuggestionContext(item);
}

function buildSuggestedEmailContent(item, details) {
  const normalizedDetails = normalizeEmailActionDetails(details);
  const contextLabel = getEmailSuggestionContext(item);

  if (normalizedDetails.purpose === "request_information") {
    return {
      subject: `Informacion de ${contextLabel}`,
      messageBody: `Hola,\n\nComparto la informacion de ${contextLabel} para tu revision. Si necesitas algun dato adicional, con gusto lo revisamos.\n\nSaludos,`,
    };
  }

  if (normalizedDetails.purpose === "other") {
    const topic = getEmailPurposeTopic(normalizedDetails, item);
    return {
      subject: `${topic} - ${contextLabel}`,
      messageBody: `Hola,\n\nTe comparto este correo sobre ${topic}. Quedo atento a tus comentarios y a cualquier siguiente paso necesario.\n\nSaludos,`,
    };
  }

  return {
    subject: `Propuesta para ${contextLabel}`,
    messageBody: `Hola,\n\nComparto la propuesta de ${contextLabel} para tu revision. Quedo atento a tus comentarios y a los siguientes pasos.\n\nSaludos,`,
  };
}

function matchesSuggestedValue(currentValue, suggestedValue) {
  return (
    String(currentValue || "").trim() === String(suggestedValue || "").trim()
  );
}

function applySuggestedEmailContent(details, item, previousDetails = null) {
  const normalizedDetails = normalizeEmailActionDetails(details);
  const nextSuggestion = buildSuggestedEmailContent(item, normalizedDetails);
  const previousSuggestion = previousDetails
    ? buildSuggestedEmailContent(item, previousDetails)
    : null;

  const shouldUpdateSubject =
    !String(normalizedDetails.subject || "").trim() ||
    (previousSuggestion &&
      matchesSuggestedValue(
        normalizedDetails.subject,
        previousSuggestion.subject,
      ));
  const shouldUpdateMessageBody =
    !String(normalizedDetails.messageBody || "").trim() ||
    (previousSuggestion &&
      matchesSuggestedValue(
        normalizedDetails.messageBody,
        previousSuggestion.messageBody,
      ));

  return {
    ...normalizedDetails,
    subject: shouldUpdateSubject
      ? nextSuggestion.subject
      : normalizedDetails.subject,
    messageBody: shouldUpdateMessageBody
      ? nextSuggestion.messageBody
      : normalizedDetails.messageBody,
  };
}

function normalizeEmailSuggestionResult(item, details, suggestion) {
  const fallback = buildSuggestedEmailContent(item, details);
  return {
    subject: String(suggestion?.subject || "").trim() || fallback.subject,
    messageBody:
      String(suggestion?.messageBody || "").trim() || fallback.messageBody,
  };
}

function mergeGeneratedEmailSuggestion(
  details,
  item,
  suggestion,
  previousSuggestion = null,
) {
  const normalizedDetails = normalizeEmailActionDetails(details);
  const fallbackSuggestion = buildSuggestedEmailContent(
    item,
    normalizedDetails,
  );
  const nextSuggestion = normalizeEmailSuggestionResult(
    item,
    normalizedDetails,
    suggestion,
  );

  const replaceableSubjectValues = [
    previousSuggestion?.subject,
    fallbackSuggestion.subject,
  ].filter(Boolean);
  const replaceableMessageValues = [
    previousSuggestion?.messageBody,
    fallbackSuggestion.messageBody,
  ].filter(Boolean);
  const currentSubject = String(normalizedDetails.subject || "").trim();
  const currentMessageBody = String(normalizedDetails.messageBody || "").trim();
  const shouldReplaceSubject =
    !currentSubject ||
    replaceableSubjectValues.some((value) =>
      matchesSuggestedValue(currentSubject, value),
    );
  const shouldReplaceMessageBody =
    !currentMessageBody ||
    replaceableMessageValues.some((value) =>
      matchesSuggestedValue(currentMessageBody, value),
    );

  return {
    ...normalizedDetails,
    subject: shouldReplaceSubject
      ? nextSuggestion.subject
      : normalizedDetails.subject,
    messageBody: shouldReplaceMessageBody
      ? nextSuggestion.messageBody
      : normalizedDetails.messageBody,
  };
}

function buildEmailSuggestionKey(item, details) {
  return JSON.stringify({
    opportunityId: Number(item?.id || 0),
    purpose: String(details?.purpose || "proposal"),
    purposeOther: String(details?.purposeOther || "").trim(),
  });
}

function buildContactRecipientOptions(contacts) {
  const seenEmails = new Set();
  return asArray(contacts)
    .map((contact) => {
      const email = String(contact?.email || "").trim();
      if (!email) return null;
      const normalizedEmail = email.toLowerCase();
      if (seenEmails.has(normalizedEmail)) return null;
      seenEmails.add(normalizedEmail);

      const fullName = String(
        contact?.full_name ||
          contact?.fullName ||
          [contact?.first_name, contact?.last_name].filter(Boolean).join(" "),
      ).trim();
      const positionTitle = String(
        contact?.position_title || contact?.positionTitle || "",
      ).trim();
      const label = [fullName, positionTitle].filter(Boolean).join(" · ");

      return {
        id: Number(contact?.id || 0),
        email,
        label,
      };
    })
    .filter(Boolean);
}

function isSendEmailAction(activity) {
  return (
    (activity?.entryKind || getEntryKind(activity?.activityType)) ===
      "action" && activity?.activityType === "send_email"
  );
}

function buildEmailActionDraft(item, activity) {
  const details = applySuggestedEmailContent(activity?.details || {}, item);
  const status = String(activity?.status || "pending");
  return {
    actionId: Number(activity?.id || 0),
    opportunityId: Number(item?.id || 0),
    opportunityName: item?.name || "",
    accountName: item?.accountName || "Sin cuenta",
    sellerUserName: item?.sellerUserName || "Sin vendedor",
    status,
    isReadOnly: status === "done" || status === "cancelled",
    details,
  };
}

function validateEmailActionDetails(details) {
  if (
    String(details?.purpose || "") === "other" &&
    !String(details?.purposeOther || "").trim()
  ) {
    return "Completa el proposito del correo cuando selecciones Otro.";
  }
  if (!String(details?.recipient || "").trim()) {
    return "Completa el destinatario principal.";
  }
  if (!String(details?.subject || "").trim()) {
    return "Completa el asunto del correo.";
  }
  if (!String(details?.messageBody || "").trim()) {
    return "Completa el mensaje base antes de continuar.";
  }
  return "";
}

function EmailAttachmentsField({
  attachments,
  disabled,
  optionsState,
  uploadState,
  onAddAttachment,
  onRemoveAttachment,
  onUploadFiles,
  onRefreshOptions,
}) {
  const [activePanel, setActivePanel] = useState("");
  const fileInputRef = useRef(null);
  const normalizedAttachments = useMemo(
    () => normalizeEmailAttachments(attachments),
    [attachments],
  );
  const selectedAttachmentIds = useMemo(
    () => new Set(normalizedAttachments.map((attachment) => attachment.id)),
    [normalizedAttachments],
  );
  const safeOptionsState = optionsState || EMPTY_EMAIL_ATTACHMENT_OPTIONS;
  const constraints = {
    ...COMMERCIAL_EMAIL_ATTACHMENT_DEFAULT_CONSTRAINTS,
    ...(safeOptionsState.constraints || {}),
  };
  const acceptValue = asArray(constraints.allowedMimeTypes).join(",");
  const libraryFiles = asArray(safeOptionsState.libraryFiles);
  const opportunityDocuments = asArray(safeOptionsState.opportunityDocuments);
  const quotationVersions = asArray(safeOptionsState.quotationVersions);

  function togglePanel(panelKey) {
    setActivePanel((current) => (current === panelKey ? "" : panelKey));
  }

  function handleFileInputChange(event) {
    const files = Array.from(event.target.files || []);
    if (files.length) {
      onUploadFiles(files);
      setActivePanel("local");
    }
    event.target.value = "";
  }

  function renderOptionCards(optionItems, emptyMessage) {
    if (!optionItems.length) {
      return (
        <div className="commercial-development-email-attachments-empty">
          {emptyMessage}
        </div>
      );
    }

    return (
      <div className="commercial-development-email-attachments-options">
        {optionItems.map((attachment) => {
          const isSelected = selectedAttachmentIds.has(attachment.id);
          return (
            <article
              key={attachment.id}
              className="commercial-development-email-attachment-option"
            >
              <div>
                <strong>{attachment.fileName}</strong>
                <p>
                  {attachment.title ||
                    attachment.proposalName ||
                    attachment.statusName ||
                    attachment.sourceLabel}
                </p>
                <span>
                  {attachment.versionNumber
                    ? `Version ${attachment.versionNumber}`
                    : attachment.assetTypeLabel ||
                      formatFileSize(attachment.byteSize)}
                </span>
              </div>
              <button
                type="button"
                className="secondary-button"
                disabled={disabled || isSelected}
                onClick={() => onAddAttachment(attachment)}
              >
                {isSelected ? "Agregado" : "Agregar"}
              </button>
            </article>
          );
        })}
      </div>
    );
  }

  return (
    <div className="commercial-development-field commercial-development-field-full-width">
      <span className="commercial-development-field-header">
        <span>Documentos a incluir</span>
        <span className="commercial-development-email-attachments-summary">
          {normalizedAttachments.length} seleccionado(s)
        </span>
      </span>

      <div className="commercial-development-email-attachments-toolbar">
        <button
          type="button"
          className="secondary-button"
          onClick={() => togglePanel("library")}
          disabled={disabled}
        >
          Biblioteca
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || uploadState?.loading}
        >
          {uploadState?.loading ? "Cargando archivo..." : "Archivo local"}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => togglePanel("proposal")}
          disabled={disabled}
        >
          Propuesta
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={onRefreshOptions}
          disabled={disabled || safeOptionsState.status === "loading"}
        >
          {safeOptionsState.status === "loading"
            ? "Actualizando..."
            : "Actualizar"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={acceptValue}
          className="commercial-development-email-attachments-input"
          onChange={handleFileInputChange}
        />
      </div>

      {safeOptionsState.error ? (
        <p className="form-error">{safeOptionsState.error}</p>
      ) : null}
      {uploadState?.error ? (
        <p className="form-error">{uploadState.error}</p>
      ) : null}

      {activePanel === "library" ? (
        <div className="commercial-development-email-attachments-panel">
          {renderOptionCards(
            libraryFiles,
            "No hay documentos de biblioteca disponibles para adjuntar.",
          )}
        </div>
      ) : null}

      {activePanel === "local" ? (
        <div className="commercial-development-email-attachments-panel">
          {renderOptionCards(
            opportunityDocuments,
            "Todavia no hay archivos locales cargados para esta oportunidad.",
          )}
        </div>
      ) : null}

      {activePanel === "proposal" ? (
        <div className="commercial-development-email-attachments-panel">
          {renderOptionCards(
            quotationVersions,
            "No hay propuestas disponibles para adjuntar.",
          )}
        </div>
      ) : null}

      {normalizedAttachments.length ? (
        <div className="commercial-development-email-attachments-selected-list">
          {normalizedAttachments.map((attachment) => (
            <div
              key={attachment.id}
              className="commercial-development-email-attachments-selected-item"
            >
              <div>
                <strong>{attachment.fileName}</strong>
                <span>
                  {attachment.sourceLabel || "Adjunto"}
                  {attachment.byteSize
                    ? ` · ${formatFileSize(attachment.byteSize)}`
                    : ""}
                </span>
              </div>
              {!disabled ? (
                <button
                  type="button"
                  className="commercial-development-activity-icon-button"
                  onClick={() => onRemoveAttachment(attachment.id)}
                  aria-label={`Quitar ${attachment.fileName}`}
                  title="Quitar adjunto"
                >
                  x
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="commercial-development-email-attachments-empty">
          No has agregado documentos todavia.
        </div>
      )}
    </div>
  );
}

function findDashboardOpportunity(nextDashboard, opportunityId) {
  return (nextDashboard?.workboard || []).find(
    (item) => Number(item.id) === Number(opportunityId),
  );
}

function resolveOpportunityAccountId(item, workboardById) {
  if (!item) return 0;
  const workboardItem = workboardById?.get(Number(item.id || 0));
  const canonicalAccountId = Number(workboardItem?.accountId || 0);
  if (canonicalAccountId) return canonicalAccountId;
  return Number(item.accountId || 0);
}

function getEmbeddedRecipientOptions(item, workboardById) {
  if (!item) return [];
  const workboardItem = workboardById?.get(Number(item.id || 0));
  return buildContactRecipientOptions(
    workboardItem?.accountContacts || item.accountContacts || [],
  );
}

function buildActivityDraft(item, activity = null) {
  if (activity) {
    const entryKind = activity.entryKind || getEntryKind(activity.activityType);
    const details =
      entryKind === "action"
        ? applySuggestedEmailContent(activity.details || {}, item)
        : emptyActionDetails();
    return {
      id: Number(activity.id),
      mode: "edit",
      entryKind,
      status: activity.status || "pending",
      activityType: activity.activityType || "call",
      scheduledAt: toDateTimeInputValue(
        activity.scheduledAt || activity.dueDate,
      ),
      dueDate: activity.dueDate || getDueDateDefaultValue(),
      priority: activity.priority || "medium",
      objective: activity.title || "",
      note: activity.note || "",
      successCriteria:
        activity.successCriteria || details.expectedResponse || "",
      isPrimaryNextStep: Boolean(activity.isPrimaryNextStep),
      details,
    };
  }

  return {
    id: null,
    mode: "create",
    entryKind: "activity",
    status: "pending",
    activityType: "call",
    scheduledAt: getScheduledAtDefaultValue(),
    dueDate: getDueDateDefaultValue(),
    priority: "medium",
    objective: "",
    note: "",
    successCriteria: "",
    isPrimaryNextStep: !item?.nextStep,
    details: emptyActionDetails(),
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
  return (
    {
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
    }[stageCode] || 0
  );
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
  return (
    Number(item?.amountUsd || 0) * (Number(item?.stageConfidence || 0) / 100)
  );
}

function getCoverageReadout({
  gapAmount,
  committedAmount,
  weightedAdditionalAmount,
}) {
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

function MailActionIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M4.75 7.5A2.75 2.75 0 0 1 7.5 4.75h9a2.75 2.75 0 0 1 2.75 2.75v9A2.75 2.75 0 0 1 16.5 19.25h-9A2.75 2.75 0 0 1 4.75 16.5v-9Zm1.5.27 5.1 4.17a1 1 0 0 0 1.3 0l5.1-4.17M6.75 17.25h10.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function appendEmailToList(value, email) {
  const nextEmail = String(email || "").trim();
  if (!nextEmail) return String(value || "").trim();

  const parts = String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const normalizedNextEmail = nextEmail.toLowerCase();
  if (parts.some((part) => part.toLowerCase() === normalizedNextEmail)) {
    return parts.join(", ");
  }
  return [...parts, nextEmail].join(", ");
}

function EmailAddressCombobox({
  label,
  placeholder,
  value,
  disabled,
  onChange,
  options,
  loading,
  loadError,
  appendOnSelect = false,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rawValue = String(value || "");
  const activeQuery = appendOnSelect
    ? rawValue.split(",").at(-1) || ""
    : rawValue;
  const normalizedValue = activeQuery.trim().toLowerCase();
  const filteredOptions = useMemo(() => {
    if (!options.length) return [];
    if (!normalizedValue) {
      return options.slice(0, 8);
    }

    return options
      .filter((option) =>
        `${option.label} ${option.email}`
          .toLowerCase()
          .includes(normalizedValue),
      )
      .slice(0, 8);
  }, [normalizedValue, options]);
  const showOptions = !disabled && isOpen && filteredOptions.length > 0;

  return (
    <label className="commercial-development-field">
      <span>{label}</span>
      <div className="commercial-development-recipient-combobox">
        <input
          value={value}
          disabled={disabled}
          onFocus={() => setIsOpen(true)}
          onBlur={() => {
            window.setTimeout(() => {
              setIsOpen(false);
            }, 120);
          }}
          onChange={(event) => {
            onChange(event.target.value);
            setIsOpen(true);
          }}
          placeholder={placeholder}
          autoComplete="off"
        />
        {showOptions ? (
          <div className="commercial-development-recipient-combobox-menu">
            {filteredOptions.map((option) => (
              <button
                key={`recipient-option-${option.id}-${option.email}`}
                type="button"
                className="commercial-development-recipient-option"
                onMouseDown={(event) => {
                  event.preventDefault();
                  onChange(
                    appendOnSelect
                      ? appendEmailToList(value, option.email)
                      : option.email,
                  );
                  setIsOpen(false);
                }}
              >
                <strong>{option.label || option.email}</strong>
                <span>{option.email}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <span className="commercial-development-field-hint">
        {loading
          ? "Cargando contactos de la cuenta..."
          : loadError
            ? loadError
            : options.length
              ? "Selecciona un contacto de la cuenta o escribe otro correo manualmente."
              : "No hay contactos con correo en esta cuenta. Puedes escribir un correo manualmente."}
      </span>
    </label>
  );
}

function EmailRecipientCombobox(props) {
  return (
    <EmailAddressCombobox
      label="Destinatario principal"
      placeholder="correo@cliente.com"
      {...props}
    />
  );
}

function EmailCcCombobox(props) {
  return (
    <EmailAddressCombobox
      label="CC"
      placeholder="equipo@empresa.com, preventa@empresa.com"
      appendOnSelect
      {...props}
    />
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
  isGeneratingEmailSuggestion,
  onRegenerateEmailSuggestion,
  attachmentOptions,
  attachmentUploadState,
  onRefreshAttachmentOptions,
  onAddAttachment,
  onRemoveAttachment,
  onUploadAttachments,
  onClose,
  onSubmit,
  onMarkDone,
  viewMode,
  onShowCreate,
  onShowCreateAction,
  onShowList,
  onSelectActivity,
  onOpenEmailDraft,
  recipientOptions,
  recipientOptionsLoading,
  recipientOptionsError,
  currencyCode,
}) {
  if (!item) return null;

  const hasEditableActivity = Boolean(draft?.id);
  const isCompletionDisabled =
    saving || !hasEditableActivity || draft.status === "done";
  const timelineItems = item.recentTimeline?.length
    ? item.recentTimeline
    : item.recentActivities?.length
      ? item.recentActivities
      : item.nextScheduledActivity
        ? [item.nextScheduledActivity]
        : [];
  const isHistoryView = viewMode === "list";
  const entryKind = draft?.entryKind || "activity";
  const isActionForm = entryKind === "action";
  const typeOptions = isActionForm
    ? ACTION_TYPE_OPTIONS
    : ACTIVITY_TYPE_OPTIONS;
  const statusOptions = isActionForm
    ? ACTION_STATUS_OPTIONS
    : ACTIVITY_STATUS_OPTIONS;
  const title = isHistoryView
    ? "Actividades y acciones de la oportunidad"
    : hasEditableActivity
      ? isActionForm
        ? "Actualizar accion"
        : "Actualizar actividad"
      : isActionForm
        ? "Crear accion"
        : "Programar actividad";
  const helperText = isHistoryView
    ? "Revisa el historial y crea una nueva actividad o una nueva accion desde esta misma vista."
    : isActionForm
      ? "Registra trabajo ejecutable como enviar correo, preparar propuesta o coordinar seguimiento."
      : "Programa una interaccion comercial y manten visible el siguiente paso de la oportunidad.";
  const emailDetails = {
    ...emptyActionDetails(),
    ...(draft?.details || {}),
  };

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
              {isHistoryView ? "Seguimiento comercial" : "Captura operativa"}
            </span>
            <h3 className="modal-title">{title}</h3>
            <p className="section-helper-text">{helperText}</p>
          </div>
        </div>

        <div className="commercial-development-activity-context">
          <div className="commercial-development-activity-context-head">
            <span className="commercial-development-activity-context-label">
              Oportunidad
            </span>
            <strong>{item.name}</strong>
          </div>
          <div className="commercial-development-inline-row">
            <span>{item.accountName || "Sin cuenta"}</span>
            <span>
              Proxima actividad:{" "}
              {item.nextScheduledActivity
                ? `${getEntryTypeLabel("activity", item.nextScheduledActivity.activityType)} · ${formatDateTime(item.nextScheduledActivity.scheduledAt)}`
                : "Sin actividad programada"}
            </span>
          </div>
          <div className="commercial-development-inline-row">
            <span>
              Proxima accion:{" "}
              {item.nextPendingAction
                ? `${getEntryTypeLabel("action", item.nextPendingAction.activityType)} · ${item.nextPendingAction.dueDate ? formatDate(item.nextPendingAction.dueDate) : "Sin fecha"}`
                : "Sin accion pendiente"}
            </span>
            <span>
              Siguiente paso principal:{" "}
              {item.nextStep?.title
                ? `${getEntryTypeLabel(getEntryKind(item.nextStep.actionType), item.nextStep.actionType)}: ${item.nextStep.title}`
                : "Sin definir"}
            </span>
          </div>
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        {isHistoryView ? (
          <div className="commercial-development-activity-list-view">
            <div className="commercial-development-activity-list-toolbar">
              <div>
                <strong>Historial</strong>
                <p>Selecciona una actividad o accion para verla o editarla.</p>
              </div>
              <div className="commercial-development-inline-row">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={onShowCreateAction}
                  disabled={saving}
                >
                  Nueva accion
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={onShowCreate}
                  disabled={saving}
                >
                  Nueva actividad
                </button>
              </div>
            </div>

            <div className="commercial-development-activity-history">
              {timelineItems.length ? (
                timelineItems.map((activity) => (
                  <div
                    key={`activity-history-${activity.id}`}
                    className="commercial-development-activity-history-row"
                  >
                    <button
                      type="button"
                      className="commercial-development-activity-history-item commercial-development-activity-history-button"
                      onClick={() => onSelectActivity(activity)}
                      disabled={saving}
                    >
                      <div className="commercial-development-inline-row">
                        <strong>
                          {getEntryTypeLabel(
                            activity.entryKind,
                            activity.activityType,
                          )}
                        </strong>
                        <span className="commercial-development-pill is-low">
                          {getEntryKindLabel(activity.entryKind)}
                        </span>
                        <span className="commercial-development-pill is-low">
                          {getEntryStatusLabel(
                            activity.entryKind,
                            activity.status,
                          )}
                        </span>
                      </div>
                      <p>{activity.title}</p>
                      {activity.entryKind === "action" &&
                      activity.successCriteria ? (
                        <span>{activity.successCriteria}</span>
                      ) : null}
                      <span>
                        {formatDateTime(
                          activity.scheduledAt ||
                            activity.dueDate ||
                            activity.updatedAt,
                        )}
                      </span>
                    </button>
                    {isSendEmailAction(activity) ? (
                      <button
                        type="button"
                        className="commercial-development-activity-icon-button commercial-development-history-secondary-action"
                        onClick={() => onOpenEmailDraft(activity)}
                        disabled={saving}
                        aria-label={
                          activity.status === "done"
                            ? `Ver correo enviado de ${item.name}`
                            : `Abrir borrador de correo de ${item.name}`
                        }
                        title={
                          activity.status === "done"
                            ? "Ver correo enviado"
                            : "Abrir borrador de correo"
                        }
                      >
                        <MailActionIcon />
                      </button>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="empty-state">
                  Sin actividades ni acciones registradas.
                </div>
              )}
            </div>

            <div className="modal-buttons commercial-development-activity-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={onClose}
                disabled={saving}
              >
                Cerrar
              </button>
            </div>
          </div>
        ) : (
          <form
            className="commercial-development-activity-form"
            onSubmit={onSubmit}
          >
            <div className="commercial-development-activity-form-toolbar">
              <button
                type="button"
                className="secondary-button"
                onClick={onShowList}
                disabled={saving}
              >
                Volver al historial
              </button>
              <span className="commercial-development-activity-form-badge">
                {hasEditableActivity
                  ? `${getEntryKindLabel(entryKind)} en edicion`
                  : `Nueva ${getEntryKindLabel(entryKind).toLowerCase()}`}
              </span>
            </div>

            <div className="commercial-development-activity-form-section">
              <div className="commercial-development-activity-section-heading">
                <strong>Datos base</strong>
                <p>
                  {isActionForm
                    ? "Define el tipo de accion. Las acciones se ejecutan de inmediato."
                    : "Define el tipo de contacto y cuando debe ocurrir."}
                </p>
              </div>

              <div className="commercial-development-activity-form-grid">
                <label className="commercial-development-field">
                  <span>
                    {isActionForm ? "Tipo de accion" : "Tipo de actividad"}
                  </span>
                  <select
                    value={draft.activityType}
                    disabled={saving}
                    onChange={(event) =>
                      setDraft((current) => {
                        const nextActivityType = event.target.value;
                        const nextDetails =
                          nextActivityType === "send_email"
                            ? applySuggestedEmailContent(
                                {
                                  ...emptyActionDetails(),
                                  ...(current.details || {}),
                                },
                                item,
                              )
                            : current.details;

                        return {
                          ...current,
                          activityType: nextActivityType,
                          details: nextDetails,
                        };
                      })
                    }
                  >
                    {typeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                {!isActionForm ? (
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
                ) : null}

                {hasEditableActivity ? (
                  <label className="commercial-development-field">
                    <span>Estado</span>
                    <select
                      value={draft.status}
                      disabled={saving}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          status: event.target.value,
                        }))
                      }
                    >
                      {statusOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>

              {isActionForm ? (
                <p className="section-helper-text">
                  La accion se identifica por su tipo y, en correos, por el
                  asunto configurado.
                </p>
              ) : null}
            </div>

            {!isActionForm ? (
              <div className="commercial-development-activity-form-section">
                <div className="commercial-development-activity-section-heading">
                  <strong>Resultado esperado</strong>
                  <p>
                    Describe que debe salir resuelto despues de esta actividad.
                  </p>
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
            ) : null}

            {isActionForm && draft.activityType === "send_email" ? (
              <div className="commercial-development-activity-form-section">
                <div className="commercial-development-activity-section-heading">
                  <strong>Correo a ejecutar</strong>
                  <p>
                    Registra el contenido operativo del correo y la respuesta
                    esperada.
                  </p>
                  {isGeneratingEmailSuggestion ? (
                    <p className="section-helper-text">
                      Generando asunto y mensaje base con IA...
                    </p>
                  ) : null}
                </div>

                <div className="commercial-development-activity-form-grid">
                  <div className="commercial-development-purpose-row commercial-development-field-full-width">
                    <label className="commercial-development-field">
                      <span>Proposito del correo</span>
                      <select
                        value={emailDetails.purpose}
                        disabled={saving}
                        onChange={(event) =>
                          setDraft((current) => {
                            const previousDetails = {
                              ...emptyActionDetails(),
                              ...(current.details || {}),
                            };
                            const nextDetails = applySuggestedEmailContent(
                              {
                                ...previousDetails,
                                purpose: event.target.value,
                                purposeOther:
                                  event.target.value === "other"
                                    ? previousDetails.purposeOther || ""
                                    : "",
                              },
                              item,
                              previousDetails,
                            );

                            return {
                              ...current,
                              details: nextDetails,
                            };
                          })
                        }
                      >
                        {EMAIL_PURPOSE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    {emailDetails.purpose === "other" ? (
                      <label className="commercial-development-field">
                        <span>Especifica el proposito</span>
                        <input
                          value={emailDetails.purposeOther}
                          disabled={saving}
                          onChange={(event) =>
                            setDraft((current) => {
                              const previousDetails = {
                                ...emptyActionDetails(),
                                ...(current.details || {}),
                              };
                              const nextDetails = applySuggestedEmailContent(
                                {
                                  ...previousDetails,
                                  purposeOther: event.target.value,
                                },
                                item,
                                previousDetails,
                              );

                              return {
                                ...current,
                                details: nextDetails,
                              };
                            })
                          }
                          placeholder="Ej. compartir avance operativo"
                        />
                      </label>
                    ) : null}
                  </div>

                  <EmailRecipientCombobox
                    value={emailDetails.recipient}
                    disabled={saving}
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        details: {
                          ...emptyActionDetails(),
                          ...(current.details || {}),
                          recipient: value,
                        },
                      }))
                    }
                    options={recipientOptions}
                    loading={recipientOptionsLoading}
                    loadError={recipientOptionsError}
                  />

                  <EmailCcCombobox
                    value={emailDetails.cc}
                    disabled={saving}
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        details: {
                          ...emptyActionDetails(),
                          ...(current.details || {}),
                          cc: value,
                        },
                      }))
                    }
                    options={recipientOptions}
                    loading={recipientOptionsLoading}
                    loadError={recipientOptionsError}
                  />

                  <label className="commercial-development-field">
                    <span>Asunto</span>
                    <input
                      value={emailDetails.subject}
                      disabled={saving}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          details: {
                            ...emptyActionDetails(),
                            ...(current.details || {}),
                            subject: event.target.value,
                          },
                        }))
                      }
                      placeholder="Propuesta ajustada para revision"
                    />
                  </label>
                </div>

                <label className="commercial-development-field">
                  <span className="commercial-development-field-header">
                    <span>Mensaje base</span>
                    <button
                      type="button"
                      className="commercial-development-activity-icon-button"
                      onClick={onRegenerateEmailSuggestion}
                      disabled={saving || isGeneratingEmailSuggestion}
                      aria-label="Regenerar mensaje base con IA"
                      title="Regenerar con IA"
                    >
                      <SparkIcon />
                    </button>
                  </span>
                  <textarea
                    rows="4"
                    value={emailDetails.messageBody}
                    disabled={saving}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        details: {
                          ...emptyActionDetails(),
                          ...(current.details || {}),
                          messageBody: event.target.value,
                        },
                      }))
                    }
                    placeholder="Hola [Nombre], comparto la propuesta actualizada con los ajustes revisados hoy..."
                  />
                </label>

                <div className="commercial-development-activity-form-grid">
                  <EmailAttachmentsField
                    attachments={emailDetails.attachments}
                    disabled={saving}
                    optionsState={attachmentOptions}
                    uploadState={attachmentUploadState}
                    onRefreshOptions={onRefreshAttachmentOptions}
                    onAddAttachment={onAddAttachment}
                    onRemoveAttachment={onRemoveAttachment}
                    onUploadFiles={onUploadAttachments}
                  />

                  <label className="commercial-development-field">
                    <span>Respuesta esperada</span>
                    <input
                      value={emailDetails.expectedResponse}
                      disabled={saving}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          successCriteria: event.target.value,
                          details: {
                            ...emptyActionDetails(),
                            ...(current.details || {}),
                            expectedResponse: event.target.value,
                          },
                        }))
                      }
                      placeholder="Ej. confirmar visto bueno antes del viernes"
                    />
                  </label>

                  <label className="commercial-development-field">
                    <span>Fecha limite de respuesta</span>
                    <input
                      type="date"
                      value={emailDetails.responseDueDate}
                      disabled={saving}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          details: {
                            ...emptyActionDetails(),
                            ...(current.details || {}),
                            responseDueDate: event.target.value,
                          },
                        }))
                      }
                    />
                  </label>
                </div>

                <label className="commercial-development-activity-checkbox">
                  <input
                    type="checkbox"
                    checked={emailDetails.markDoneOnSend}
                    disabled={saving}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        details: {
                          ...emptyActionDetails(),
                          ...(current.details || {}),
                          markDoneOnSend: event.target.checked,
                        },
                      }))
                    }
                  />
                  <span>Marcar como realizada al enviar</span>
                </label>
              </div>
            ) : null}

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
                  {saving
                    ? "Actualizando..."
                    : isActionForm
                      ? "Marcar realizada"
                      : "Marcar realizada"}
                </button>
                <span>
                  Estado actual: {getEntryStatusLabel(entryKind, draft.status)}
                </span>
              </div>
            ) : null}

            <div className="modal-buttons commercial-development-activity-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={onClose}
                disabled={saving}
              >
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving
                  ? hasEditableActivity
                    ? "Actualizando..."
                    : "Guardando..."
                  : hasEditableActivity
                    ? "Guardar cambios"
                    : isActionForm
                      ? "Guardar accion"
                      : "Guardar actividad"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function CommercialEmailDraftModal({
  item,
  draft,
  saving,
  error,
  notice,
  isGeneratingEmailSuggestion,
  onRegenerateEmailSuggestion,
  attachmentOptions,
  attachmentUploadState,
  onRefreshAttachmentOptions,
  onAddAttachment,
  onRemoveAttachment,
  onUploadAttachments,
  sendFeedback,
  isConfirmingSend,
  recipientOptions,
  recipientOptionsLoading,
  recipientOptionsError,
  onClose,
  onChange,
  onSaveDraft,
  onRequestSend,
  onCancelConfirm,
}) {
  if (!item || !draft) return null;

  const emailDetails = {
    ...emptyActionDetails(),
    ...(draft.details || {}),
  };
  const isReadOnly = draft.isReadOnly;
  const sendStatusTone = sendFeedback?.tone || "";
  const sendStatusMessage = sendFeedback?.message || "";

  function handleEmailPurposeChange(nextPurpose) {
    const nextDetails = applySuggestedEmailContent(
      {
        ...emailDetails,
        purpose: nextPurpose,
        purposeOther: nextPurpose === "other" ? emailDetails.purposeOther : "",
      },
      item,
      emailDetails,
    );

    onChange("purpose", nextDetails.purpose);
    onChange("purposeOther", nextDetails.purposeOther);
    if (nextDetails.subject !== emailDetails.subject) {
      onChange("subject", nextDetails.subject);
    }
    if (nextDetails.messageBody !== emailDetails.messageBody) {
      onChange("messageBody", nextDetails.messageBody);
    }
  }

  function handleEmailPurposeOtherChange(nextPurposeOther) {
    const nextDetails = applySuggestedEmailContent(
      {
        ...emailDetails,
        purposeOther: nextPurposeOther,
      },
      item,
      emailDetails,
    );

    onChange("purposeOther", nextDetails.purposeOther);
    if (nextDetails.subject !== emailDetails.subject) {
      onChange("subject", nextDetails.subject);
    }
    if (nextDetails.messageBody !== emailDetails.messageBody) {
      onChange("messageBody", nextDetails.messageBody);
    }
  }

  return (
    <div
      className="modal-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) {
          onClose();
        }
      }}
    >
      <div className="modal-dialog commercial-email-draft-modal">
        <div className="modal-header commercial-development-activity-modal-header">
          <div className="commercial-development-activity-header-copy">
            <span className="commercial-development-activity-kicker">
              Ejecucion de correo
            </span>
            <h3 className="modal-title">
              {isReadOnly
                ? "Correo enviado"
                : "Revisar borrador antes de enviar"}
            </h3>
            <p className="section-helper-text">
              {isReadOnly
                ? "Consulta el contenido enviado y el estado registrado en la accion."
                : "Ajusta el borrador final, guardalo si todavia falta trabajo y confirma el envio cuando quede listo."}
            </p>
            {isGeneratingEmailSuggestion ? (
              <p className="section-helper-text">
                Generando asunto y mensaje base con IA...
              </p>
            ) : null}
          </div>
        </div>

        <div className="commercial-development-activity-context">
          <div className="commercial-development-activity-context-head">
            <span className="commercial-development-activity-context-label">
              Oportunidad
            </span>
            <strong>{draft.opportunityName}</strong>
          </div>
          <div className="commercial-development-inline-row">
            <span>{draft.accountName}</span>
            <span>
              Estado de la accion: {getEntryStatusLabel("action", draft.status)}
            </span>
          </div>
          <div className="commercial-development-inline-row">
            <span>Respondera comercialmente: {draft.sellerUserName}</span>
            <span>
              {emailDetails.sentAt
                ? `Enviado: ${formatDateTime(emailDetails.sentAt)}`
                : "Pendiente de envio"}
            </span>
          </div>
        </div>

        {sendStatusMessage ? (
          <p
            className={[
              "commercial-development-send-status",
              sendStatusTone ? `is-${sendStatusTone}` : "",
            ]
              .join(" ")
              .trim()}
          >
            {sendStatusMessage}
          </p>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
        {notice ? (
          <p className="commercial-development-modal-notice">{notice}</p>
        ) : null}

        <div className="commercial-development-activity-form-section">
          <div className="commercial-development-activity-section-heading">
            <strong>Contenido del correo</strong>
            <p>
              Se enviara desde la cuenta corporativa configurada y respondera al
              vendedor asignado.
            </p>
          </div>

          <div className="commercial-development-activity-form-grid">
            <div className="commercial-development-purpose-row commercial-development-field-full-width">
              <label className="commercial-development-field">
                <span>Proposito</span>
                <select
                  value={emailDetails.purpose}
                  disabled={saving || isReadOnly}
                  onChange={(event) =>
                    handleEmailPurposeChange(event.target.value)
                  }
                >
                  {EMAIL_PURPOSE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              {emailDetails.purpose === "other" ? (
                <label className="commercial-development-field">
                  <span>Especifica el proposito</span>
                  <input
                    value={emailDetails.purposeOther}
                    disabled={saving || isReadOnly}
                    onChange={(event) =>
                      handleEmailPurposeOtherChange(event.target.value)
                    }
                    placeholder="Ej. compartir avance operativo"
                  />
                </label>
              ) : null}
            </div>

            <EmailRecipientCombobox
              value={emailDetails.recipient}
              disabled={saving || isReadOnly}
              onChange={(value) => onChange("recipient", value)}
              options={recipientOptions}
              loading={recipientOptionsLoading}
              loadError={recipientOptionsError}
            />

            <EmailCcCombobox
              value={emailDetails.cc}
              disabled={saving || isReadOnly}
              onChange={(value) => onChange("cc", value)}
              options={recipientOptions}
              loading={recipientOptionsLoading}
              loadError={recipientOptionsError}
            />

            <label className="commercial-development-field">
              <span>Asunto</span>
              <input
                value={emailDetails.subject}
                disabled={saving || isReadOnly}
                onChange={(event) => onChange("subject", event.target.value)}
              />
            </label>
          </div>

          <label className="commercial-development-field">
            <span className="commercial-development-field-header">
              <span>Mensaje base</span>
              {!isReadOnly ? (
                <button
                  type="button"
                  className="commercial-development-activity-icon-button"
                  onClick={onRegenerateEmailSuggestion}
                  disabled={saving || isGeneratingEmailSuggestion}
                  aria-label="Regenerar mensaje base con IA"
                  title="Regenerar con IA"
                >
                  <SparkIcon />
                </button>
              ) : null}
            </span>
            <textarea
              rows="8"
              value={emailDetails.messageBody}
              disabled={saving || isReadOnly}
              onChange={(event) => onChange("messageBody", event.target.value)}
            />
          </label>

          <div className="commercial-development-activity-form-grid">
            <EmailAttachmentsField
              attachments={emailDetails.attachments}
              disabled={saving || isReadOnly}
              optionsState={attachmentOptions}
              uploadState={attachmentUploadState}
              onRefreshOptions={onRefreshAttachmentOptions}
              onAddAttachment={onAddAttachment}
              onRemoveAttachment={onRemoveAttachment}
              onUploadFiles={onUploadAttachments}
            />

            <label className="commercial-development-field">
              <span>Respuesta esperada</span>
              <input
                value={emailDetails.expectedResponse}
                disabled={saving || isReadOnly}
                onChange={(event) =>
                  onChange("expectedResponse", event.target.value)
                }
              />
            </label>

            <label className="commercial-development-field">
              <span>Fecha limite de respuesta</span>
              <input
                type="date"
                value={emailDetails.responseDueDate}
                disabled={saving || isReadOnly}
                onChange={(event) =>
                  onChange("responseDueDate", event.target.value)
                }
              />
            </label>
          </div>

          <label className="commercial-development-activity-checkbox">
            <input
              type="checkbox"
              checked={Boolean(emailDetails.markDoneOnSend)}
              disabled={saving || isReadOnly}
              onChange={(event) =>
                onChange("markDoneOnSend", event.target.checked)
              }
            />
            <span>Marcar la accion como realizada al enviar</span>
          </label>
        </div>

        {isConfirmingSend && !isReadOnly ? (
          <div className="commercial-development-email-confirmation">
            <strong>Confirmacion de envio</strong>
            <p>
              Este correo se enviara ahora a {emailDetails.recipient}. Confirma
              solo si el contenido final ya esta listo.
            </p>
            <div className="commercial-development-email-confirmation-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={onCancelConfirm}
                disabled={saving}
              >
                Volver a revisar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={onRequestSend}
                disabled={saving}
              >
                {saving ? "Enviando..." : "Confirmar envio"}
              </button>
            </div>
          </div>
        ) : null}

        <div className="modal-buttons commercial-development-activity-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={saving}
          >
            {isReadOnly ? "Cerrar" : "Cancelar"}
          </button>
          {!isReadOnly ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={onSaveDraft}
              disabled={saving || isConfirmingSend}
            >
              {saving ? "Guardando..." : "Guardar borrador"}
            </button>
          ) : null}
          {!isReadOnly && !isConfirmingSend ? (
            <button
              type="button"
              className="btn-primary"
              onClick={onRequestSend}
              disabled={saving}
            >
              Solicitar confirmacion de envio
            </button>
          ) : null}
        </div>
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
  const [activityViewMode, setActivityViewMode] = useState("list");
  const [emailDraftModalItem, setEmailDraftModalItem] = useState(null);
  const [emailDraftState, setEmailDraftState] = useState(null);
  const [emailDraftError, setEmailDraftError] = useState("");
  const [emailDraftNotice, setEmailDraftNotice] = useState("");
  const [emailSendFeedback, setEmailSendFeedback] = useState(null);
  const [savingEmailDraft, setSavingEmailDraft] = useState(false);
  const [confirmingEmailSend, setConfirmingEmailSend] = useState(false);
  const [accountContactsById, setAccountContactsById] = useState({});
  const [
    emailAttachmentOptionsByOpportunityId,
    setEmailAttachmentOptionsByOpportunityId,
  ] = useState({});
  const [activityAttachmentUploadState, setActivityAttachmentUploadState] =
    useState({ loading: false, error: "" });
  const [emailDraftAttachmentUploadState, setEmailDraftAttachmentUploadState] =
    useState({ loading: false, error: "" });
  const [
    generatingActivityEmailSuggestion,
    setGeneratingActivityEmailSuggestion,
  ] = useState(false);
  const [generatingEmailDraftSuggestion, setGeneratingEmailDraftSuggestion] =
    useState(false);
  const activityEmailSuggestionRef = useRef(null);
  const emailDraftSuggestionRef = useRef(null);

  const loadDashboard = useCallback(async (periodKey = "") => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/api/commercial-development/dashboard", {
        params: periodKey ? { period: periodKey } : undefined,
      });
      const nextDashboard = normalizeDashboardResponse(response.data);
      setDashboard(nextDashboard);
      return nextDashboard;
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar la vista de desarrollo comercial",
        ),
      );
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const requestAiEmailSuggestion = useCallback(async (item, details) => {
    const opportunityId = Number(item?.id || 0);
    if (!opportunityId) {
      return normalizeEmailSuggestionResult(item, details, null);
    }

    const response = await api.post(
      `/api/commercial-development/opportunities/${opportunityId}/email-suggestion`,
      { details },
    );
    return normalizeEmailSuggestionResult(item, details, response.data || null);
  }, []);

  const loadEmailAttachmentOptions = useCallback(
    async (opportunityId, { force = false } = {}) => {
      const normalizedOpportunityId = Number(opportunityId || 0);
      if (!normalizedOpportunityId) {
        return EMPTY_EMAIL_ATTACHMENT_OPTIONS;
      }

      const existingState =
        emailAttachmentOptionsByOpportunityId[normalizedOpportunityId];
      if (!force && existingState?.status === "loaded") {
        return existingState;
      }
      if (!force && existingState?.status === "loading") {
        return existingState;
      }

      setEmailAttachmentOptionsByOpportunityId((current) => ({
        ...current,
        [normalizedOpportunityId]: {
          ...(current[normalizedOpportunityId] ||
            EMPTY_EMAIL_ATTACHMENT_OPTIONS),
          status: "loading",
          error: "",
        },
      }));

      try {
        const response = await api.get(
          `/api/commercial-development/opportunities/${normalizedOpportunityId}/email-attachments/options`,
        );
        const nextState = normalizeEmailAttachmentOptionsResponse(
          response.data || {},
        );
        setEmailAttachmentOptionsByOpportunityId((current) => ({
          ...current,
          [normalizedOpportunityId]: nextState,
        }));
        return nextState;
      } catch (requestError) {
        const nextState = {
          ...(existingState || EMPTY_EMAIL_ATTACHMENT_OPTIONS),
          status: "error",
          error: getApiErrorMessage(
            requestError,
            "No fue posible cargar los documentos disponibles para el correo.",
          ),
        };
        setEmailAttachmentOptionsByOpportunityId((current) => ({
          ...current,
          [normalizedOpportunityId]: nextState,
        }));
        return nextState;
      }
    },
    [emailAttachmentOptionsByOpportunityId],
  );

  const mergeUploadedOpportunityDocuments = useCallback(
    (opportunityId, documents) => {
      const normalizedOpportunityId = Number(opportunityId || 0);
      if (!normalizedOpportunityId) return;

      const normalizedDocuments = normalizeEmailAttachments(documents);
      if (!normalizedDocuments.length) return;

      setEmailAttachmentOptionsByOpportunityId((current) => {
        const existingState =
          current[normalizedOpportunityId] || EMPTY_EMAIL_ATTACHMENT_OPTIONS;
        return {
          ...current,
          [normalizedOpportunityId]: {
            ...existingState,
            status:
              existingState.status === "idle" ? "loaded" : existingState.status,
            error: "",
            opportunityDocuments: normalizeEmailAttachments([
              ...asArray(existingState.opportunityDocuments),
              ...normalizedDocuments,
            ]),
          },
        };
      });
    },
    [],
  );

  const uploadLocalEmailAttachments = useCallback(
    async (opportunityId, files) => {
      const formData = new FormData();
      asArray(files).forEach((file, index) => {
        formData.append(`file_${index}`, file, file.name);
      });

      const response = await api.post(
        `/api/opportunities/${Number(opportunityId)}/documents`,
        formData,
      );

      return normalizeEmailAttachments(
        asArray(response.data)
          .map((document) => buildOpportunityDocumentEmailAttachment(document))
          .filter(Boolean),
      );
    },
    [],
  );

  useEffect(() => {
    loadDashboard(selectedPeriodKey);
  }, [loadDashboard, selectedPeriodKey]);

  const ensureAccountContactsLoaded = useCallback(async (accountId) => {
    const normalizedAccountId = Number(accountId || 0);
    if (!normalizedAccountId) return;

    let shouldFetch = false;
    setAccountContactsById((current) => {
      const existing = current[normalizedAccountId];
      if (existing?.status === "loaded" || existing?.status === "loading") {
        return current;
      }
      shouldFetch = true;
      return {
        ...current,
        [normalizedAccountId]: {
          status: "loading",
          options: [],
          error: "",
        },
      };
    });

    if (!shouldFetch) return;

    const timeoutId = window.setTimeout(() => {
      setAccountContactsById((current) => {
        const existing = current[normalizedAccountId];
        if (existing?.status !== "loading") {
          return current;
        }
        return {
          ...current,
          [normalizedAccountId]: {
            status: "error",
            options: [],
            error:
              "La carga de contactos tardó demasiado. Puedes escribir un correo manualmente o reabrir el modal.",
          },
        };
      });
    }, ACCOUNT_CONTACTS_LOAD_TIMEOUT_MS);

    try {
      const response = await api.get("/api/contacts", {
        params: { accountId: normalizedAccountId },
      });
      const options = buildContactRecipientOptions(response.data);
      window.clearTimeout(timeoutId);
      setAccountContactsById((current) => ({
        ...current,
        [normalizedAccountId]: {
          status: "loaded",
          options,
          error: "",
        },
      }));
    } catch (requestError) {
      window.clearTimeout(timeoutId);
      setAccountContactsById((current) => ({
        ...current,
        [normalizedAccountId]: {
          status: "error",
          options: [],
          error: getApiErrorMessage(
            requestError,
            "No fue posible cargar los contactos de la cuenta.",
          ),
        },
      }));
    }
  }, []);

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
  const activeSendEmailAccountId =
    activityModalItem &&
    activityDraft.entryKind === "action" &&
    activityDraft.activityType === "send_email"
      ? resolveOpportunityAccountId(activityModalItem, workboardById)
      : 0;
  const draftSendEmailAccountId = resolveOpportunityAccountId(
    emailDraftModalItem,
    workboardById,
  );
  const activeEmbeddedRecipientOptions = useMemo(
    () => getEmbeddedRecipientOptions(activityModalItem, workboardById),
    [activityModalItem, workboardById],
  );
  const draftEmbeddedRecipientOptions = useMemo(
    () => getEmbeddedRecipientOptions(emailDraftModalItem, workboardById),
    [emailDraftModalItem, workboardById],
  );
  const activeRecipientSource =
    accountContactsById[activeSendEmailAccountId] || null;
  const draftRecipientSource =
    accountContactsById[draftSendEmailAccountId] || null;
  const activeRecipientOptions =
    activeEmbeddedRecipientOptions.length > 0
      ? activeEmbeddedRecipientOptions
      : activeRecipientSource?.options || [];
  const draftRecipientOptions =
    draftEmbeddedRecipientOptions.length > 0
      ? draftEmbeddedRecipientOptions
      : draftRecipientSource?.options || [];
  const activeRecipientOptionsLoading =
    activeEmbeddedRecipientOptions.length === 0 &&
    activeRecipientSource?.status === "loading";
  const draftRecipientOptionsLoading =
    draftEmbeddedRecipientOptions.length === 0 &&
    draftRecipientSource?.status === "loading";
  const activeRecipientOptionsError =
    activeEmbeddedRecipientOptions.length === 0
      ? activeRecipientSource?.error || ""
      : "";
  const draftRecipientOptionsError =
    draftEmbeddedRecipientOptions.length === 0
      ? draftRecipientSource?.error || ""
      : "";
  const activeAttachmentOpportunityId =
    activityModalItem &&
    activityDraft.entryKind === "action" &&
    activityDraft.activityType === "send_email"
      ? Number(activityModalItem.id || 0)
      : 0;
  const draftAttachmentOpportunityId = Number(
    emailDraftState?.opportunityId || emailDraftModalItem?.id || 0,
  );
  const activeAttachmentOptions =
    emailAttachmentOptionsByOpportunityId[activeAttachmentOpportunityId] ||
    EMPTY_EMAIL_ATTACHMENT_OPTIONS;
  const draftAttachmentOptions =
    emailAttachmentOptionsByOpportunityId[draftAttachmentOpportunityId] ||
    EMPTY_EMAIL_ATTACHMENT_OPTIONS;

  useEffect(() => {
    if (
      activeSendEmailAccountId &&
      activeEmbeddedRecipientOptions.length === 0
    ) {
      ensureAccountContactsLoaded(activeSendEmailAccountId);
    }
  }, [
    activeEmbeddedRecipientOptions.length,
    activeSendEmailAccountId,
    ensureAccountContactsLoaded,
  ]);

  useEffect(() => {
    if (draftSendEmailAccountId && draftEmbeddedRecipientOptions.length === 0) {
      ensureAccountContactsLoaded(draftSendEmailAccountId);
    }
  }, [
    draftEmbeddedRecipientOptions.length,
    draftSendEmailAccountId,
    ensureAccountContactsLoaded,
  ]);

  useEffect(() => {
    if (activeAttachmentOpportunityId) {
      loadEmailAttachmentOptions(activeAttachmentOpportunityId);
    }
  }, [activeAttachmentOpportunityId, loadEmailAttachmentOptions]);

  useEffect(() => {
    if (draftAttachmentOpportunityId) {
      loadEmailAttachmentOptions(draftAttachmentOpportunityId);
    }
  }, [draftAttachmentOpportunityId, loadEmailAttachmentOptions]);

  useEffect(() => {
    if (
      !activityModalItem ||
      activityDraft.entryKind !== "action" ||
      activityDraft.activityType !== "send_email"
    ) {
      activityEmailSuggestionRef.current = null;
      setGeneratingActivityEmailSuggestion(false);
      return undefined;
    }

    const requestKey = buildEmailSuggestionKey(
      activityModalItem,
      activityDraft.details,
    );
    let isCancelled = false;
    const timeoutId = window.setTimeout(
      async () => {
        setGeneratingActivityEmailSuggestion(true);
        try {
          const suggestion = await requestAiEmailSuggestion(
            activityModalItem,
            activityDraft.details,
          );
          if (isCancelled) return;
          setActivityDraft((current) => {
            if (
              !current ||
              current.entryKind !== "action" ||
              current.activityType !== "send_email" ||
              buildEmailSuggestionKey(activityModalItem, current.details) !==
                requestKey
            ) {
              return current;
            }

            const nextDetails = mergeGeneratedEmailSuggestion(
              current.details || {},
              activityModalItem,
              suggestion,
              activityEmailSuggestionRef.current,
            );
            return {
              ...current,
              details: nextDetails,
            };
          });
          activityEmailSuggestionRef.current = suggestion;
        } catch {
          if (!isCancelled) {
            activityEmailSuggestionRef.current = null;
          }
        } finally {
          if (!isCancelled) {
            setGeneratingActivityEmailSuggestion(false);
          }
        }
      },
      activityDraft.details?.purpose === "other" ? 500 : 250,
    );

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    activityDraft.activityType,
    activityDraft.entryKind,
    activityDraft.details?.purpose,
    activityDraft.details?.purposeOther,
    activityModalItem,
    requestAiEmailSuggestion,
  ]);

  useEffect(() => {
    if (
      !emailDraftModalItem ||
      !emailDraftState ||
      emailDraftState.isReadOnly
    ) {
      emailDraftSuggestionRef.current = null;
      setGeneratingEmailDraftSuggestion(false);
      return undefined;
    }

    const requestKey = buildEmailSuggestionKey(
      emailDraftModalItem,
      emailDraftState.details,
    );
    let isCancelled = false;
    const timeoutId = window.setTimeout(
      async () => {
        setGeneratingEmailDraftSuggestion(true);
        try {
          const suggestion = await requestAiEmailSuggestion(
            emailDraftModalItem,
            emailDraftState.details,
          );
          if (isCancelled) return;
          setEmailDraftState((current) => {
            if (
              !current ||
              current.isReadOnly ||
              buildEmailSuggestionKey(emailDraftModalItem, current.details) !==
                requestKey
            ) {
              return current;
            }

            const nextDetails = mergeGeneratedEmailSuggestion(
              current.details || {},
              emailDraftModalItem,
              suggestion,
              emailDraftSuggestionRef.current,
            );
            return {
              ...current,
              details: nextDetails,
            };
          });
          emailDraftSuggestionRef.current = suggestion;
        } catch {
          if (!isCancelled) {
            emailDraftSuggestionRef.current = null;
          }
        } finally {
          if (!isCancelled) {
            setGeneratingEmailDraftSuggestion(false);
          }
        }
      },
      emailDraftState.details?.purpose === "other" ? 500 : 250,
    );

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    emailDraftModalItem,
    emailDraftState?.details?.purpose,
    emailDraftState?.details?.purposeOther,
    emailDraftState?.isReadOnly,
    requestAiEmailSuggestion,
  ]);

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
        const riskDelta =
          getRiskRank(left.riskLevel) - getRiskRank(right.riskLevel);
        if (riskDelta !== 0) {
          return riskDelta;
        }
        return String(left.name || "").localeCompare(
          String(right.name || ""),
          "es",
        );
      });

    const committedAmount = roundCurrency(
      candidates
        .filter((item) => item.coverageKind === "committed")
        .reduce(
          (total, item) => total + Number(item.rawCoverageAmount || 0),
          0,
        ),
    );
    const weightedAdditionalAmount = roundCurrency(
      candidates
        .filter((item) => item.coverageKind === "weighted")
        .reduce(
          (total, item) => total + Number(item.rawCoverageAmount || 0),
          0,
        ),
    );

    let remainingGap = activeGapAmount;
    const cards = candidates.map((item) => {
      const effectiveCoverageAmount =
        activeGapAmount > 0
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
    ? gapClosingView.cards.filter(
        (item) => item.stageCode === selectedFunnelStage,
      )
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
          array.findIndex((candidate) => candidate.value === item.value) ===
          index,
      );
    if (prioritized.length) {
      return prioritized;
    }
    return workboard
      .filter((item) => isDateWithinPeriod(item?.closeDate, currentPeriod))
      .map((item) => ({ value: String(item.id), label: item.name }));
  }, [currentPeriod, selectedDayItems, workboard]);

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
    return (
      <section className="panel centered">
        Cargando desarrollo comercial...
      </section>
    );
  }

  function roundCurrency(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function resolveModalOpportunityItem(item) {
    if (!item) return item;
    const canonicalItem = workboardById.get(Number(item.id || 0));
    return canonicalItem ? { ...item, ...canonicalItem } : item;
  }

  function openOpportunityEditor(opportunityId) {
    navigate(`/opportunities?edit=${opportunityId}`);
  }

  function openActivityModal(item, options = {}) {
    const { viewMode = "activity-form" } = options;
    const nextItem = resolveModalOpportunityItem(item);
    setActivityModalItem(nextItem);
    setActivityDraft(buildActivityDraft(nextItem));
    setActivityError("");
    setActivityViewMode(viewMode);
  }

  function openEditActivityModal(item, activity, options = {}) {
    const { viewMode = null } = options;
    const nextItem = resolveModalOpportunityItem(item);
    setActivityModalItem(nextItem);
    setActivityDraft(buildActivityDraft(nextItem, activity));
    setActivityError("");
    const nextViewMode =
      viewMode ||
      ((activity?.entryKind || getEntryKind(activity?.activityType)) ===
      "action"
        ? "action-form"
        : "activity-form");
    setActivityViewMode(nextViewMode);
  }

  function openCreateActivityForDate(item, dateValue) {
    const nextItem = resolveModalOpportunityItem(item);
    setActivityModalItem(nextItem);
    setActivityDraft({
      ...buildActivityDraft(nextItem),
      entryKind: "activity",
      scheduledAt: buildDateTimeInputForDay(dateValue),
    });
    setActivityError("");
    setActivityViewMode("activity-form");
  }

  function openActivityViewer(item) {
    openActivityModal(item, { viewMode: "list" });
  }

  function showCreateActivityForm() {
    if (!activityModalItem) return;
    setActivityDraft({
      ...buildActivityDraft(activityModalItem),
      entryKind: "activity",
      activityType: "call",
    });
    setActivityError("");
    setActivityViewMode("activity-form");
  }

  function showCreateActionForm() {
    if (!activityModalItem) return;
    activityEmailSuggestionRef.current = null;
    setActivityDraft({
      ...buildActivityDraft(activityModalItem),
      entryKind: "action",
      activityType: "send_email",
      dueDate: getDueDateDefaultValue(),
      scheduledAt: "",
      priority: "medium",
      successCriteria: "",
      details: applySuggestedEmailContent(
        emptyActionDetails(),
        activityModalItem,
      ),
    });
    setActivityError("");
    setActivityViewMode("action-form");
  }

  function showActivityList() {
    setActivityError("");
    setActivityViewMode("list");
  }

  function selectActivityFromList(activity) {
    if (!activityModalItem) return;
    setActivityDraft(buildActivityDraft(activityModalItem, activity));
    setActivityError("");
    setActivityViewMode(
      (activity?.entryKind || getEntryKind(activity?.activityType)) === "action"
        ? "action-form"
        : "activity-form",
    );
  }

  function closeActivityModal() {
    if (savingActivity) return;
    activityEmailSuggestionRef.current = null;
    setActivityModalItem(null);
    setActivityDraft(buildActivityDraft(null));
    setActivityError("");
    setActivityAttachmentUploadState({ loading: false, error: "" });
    setActivityViewMode("list");
  }

  function syncActivityModalFromDashboard(
    nextDashboard,
    opportunityId,
    activityId,
  ) {
    if (
      !nextDashboard ||
      !activityModalItem ||
      Number(activityModalItem.id) !== Number(opportunityId)
    ) {
      return;
    }

    const nextItem = findDashboardOpportunity(nextDashboard, opportunityId);
    if (!nextItem) {
      closeActivityModal();
      return;
    }

    setActivityModalItem(nextItem);
    if (!activityId || Number(activityDraft.id || 0) !== Number(activityId)) {
      return;
    }

    const nextActivity = [
      ...(nextItem.recentTimeline || []),
      nextItem.nextScheduledActivity,
      nextItem.nextPendingAction,
    ]
      .filter(Boolean)
      .find((entry) => Number(entry.id) === Number(activityId));

    if (nextActivity) {
      setActivityDraft(buildActivityDraft(nextItem, nextActivity));
    }
  }

  function openEmailDraftModal(item, activity) {
    if (!item || !isSendEmailAction(activity)) return;
    const nextItem = resolveModalOpportunityItem(item);
    emailDraftSuggestionRef.current = null;
    setEmailDraftModalItem(nextItem);
    setEmailDraftState(buildEmailActionDraft(nextItem, activity));
    setEmailDraftError("");
    setEmailDraftNotice("");
    setEmailSendFeedback(
      activity?.details?.sentAt
        ? {
            tone: "success",
            message: `Correo enviado el ${formatDateTime(activity.details.sentAt)}.`,
          }
        : null,
    );
    setConfirmingEmailSend(false);
  }

  function closeEmailDraftModal() {
    if (savingEmailDraft) return;
    emailDraftSuggestionRef.current = null;
    setEmailDraftModalItem(null);
    setEmailDraftState(null);
    setEmailDraftError("");
    setEmailDraftNotice("");
    setEmailSendFeedback(null);
    setConfirmingEmailSend(false);
    setEmailDraftAttachmentUploadState({ loading: false, error: "" });
  }

  function updateEmailDraftField(field, value) {
    setEmailDraftState((current) =>
      current
        ? {
            ...current,
            details: {
              ...current.details,
              [field]:
                field === "attachments"
                  ? normalizeEmailAttachments(value)
                  : value,
            },
          }
        : current,
    );
    setEmailDraftError("");
    setEmailDraftNotice("");
    setEmailSendFeedback(null);
  }

  function handleAddActivityAttachment(attachment) {
    setActivityDraft((current) =>
      current
        ? {
            ...current,
            details: {
              ...emptyActionDetails(),
              ...(current.details || {}),
              attachments: addEmailAttachment(
                current.details?.attachments,
                attachment,
              ),
            },
          }
        : current,
    );
    setActivityError("");
    setActivityAttachmentUploadState({ loading: false, error: "" });
  }

  function handleRemoveActivityAttachment(attachmentId) {
    setActivityDraft((current) =>
      current
        ? {
            ...current,
            details: {
              ...emptyActionDetails(),
              ...(current.details || {}),
              attachments: removeEmailAttachment(
                current.details?.attachments,
                attachmentId,
              ),
            },
          }
        : current,
    );
    setActivityError("");
  }

  function handleAddEmailDraftAttachment(attachment) {
    setEmailDraftState((current) =>
      current
        ? {
            ...current,
            details: {
              ...current.details,
              attachments: addEmailAttachment(
                current.details?.attachments,
                attachment,
              ),
            },
          }
        : current,
    );
    setEmailDraftError("");
    setEmailDraftNotice("");
    setEmailDraftAttachmentUploadState({ loading: false, error: "" });
  }

  function handleRemoveEmailDraftAttachment(attachmentId) {
    setEmailDraftState((current) =>
      current
        ? {
            ...current,
            details: {
              ...current.details,
              attachments: removeEmailAttachment(
                current.details?.attachments,
                attachmentId,
              ),
            },
          }
        : current,
    );
    setEmailDraftError("");
    setEmailDraftNotice("");
  }

  async function handleUploadActivityAttachments(files) {
    const opportunityId = Number(activityModalItem?.id || 0);
    if (!opportunityId) return;

    const optionsState = await loadEmailAttachmentOptions(opportunityId);
    const validationError = validateLocalEmailAttachmentFiles(
      files,
      optionsState?.constraints,
      normalizeEmailAttachments(activityDraft.details?.attachments).length,
    );
    if (validationError) {
      setActivityAttachmentUploadState({
        loading: false,
        error: validationError,
      });
      setActivityError(validationError);
      return;
    }

    setActivityAttachmentUploadState({ loading: true, error: "" });
    setActivityError("");
    try {
      const uploadedDocuments = await uploadLocalEmailAttachments(
        opportunityId,
        files,
      );
      mergeUploadedOpportunityDocuments(opportunityId, uploadedDocuments);
      setActivityDraft((current) =>
        current
          ? {
              ...current,
              details: {
                ...emptyActionDetails(),
                ...(current.details || {}),
                attachments: normalizeEmailAttachments([
                  ...asArray(current.details?.attachments),
                  ...uploadedDocuments,
                ]),
              },
            }
          : current,
      );
      setActivityAttachmentUploadState({ loading: false, error: "" });
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible cargar el archivo para adjuntarlo al correo.",
      );
      setActivityAttachmentUploadState({ loading: false, error: message });
      setActivityError(message);
    }
  }

  async function handleUploadEmailDraftAttachments(files) {
    const opportunityId = Number(emailDraftState?.opportunityId || 0);
    if (!opportunityId) return;

    const optionsState = await loadEmailAttachmentOptions(opportunityId);
    const validationError = validateLocalEmailAttachmentFiles(
      files,
      optionsState?.constraints,
      normalizeEmailAttachments(emailDraftState?.details?.attachments).length,
    );
    if (validationError) {
      setEmailDraftAttachmentUploadState({
        loading: false,
        error: validationError,
      });
      setEmailDraftError(validationError);
      return;
    }

    setEmailDraftAttachmentUploadState({ loading: true, error: "" });
    setEmailDraftError("");
    setEmailDraftNotice("");
    try {
      const uploadedDocuments = await uploadLocalEmailAttachments(
        opportunityId,
        files,
      );
      mergeUploadedOpportunityDocuments(opportunityId, uploadedDocuments);
      setEmailDraftState((current) =>
        current
          ? {
              ...current,
              details: {
                ...current.details,
                attachments: normalizeEmailAttachments([
                  ...asArray(current.details?.attachments),
                  ...uploadedDocuments,
                ]),
              },
            }
          : current,
      );
      setEmailDraftAttachmentUploadState({ loading: false, error: "" });
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible cargar el archivo para adjuntarlo al correo.",
      );
      setEmailDraftAttachmentUploadState({ loading: false, error: message });
      setEmailDraftError(message);
    }
  }

  async function handleRegenerateActivityEmailSuggestion() {
    if (
      !activityModalItem ||
      activityDraft.entryKind !== "action" ||
      activityDraft.activityType !== "send_email"
    ) {
      return;
    }

    setGeneratingActivityEmailSuggestion(true);
    setActivityError("");
    try {
      const suggestion = await requestAiEmailSuggestion(
        activityModalItem,
        activityDraft.details,
      );
      activityEmailSuggestionRef.current = suggestion;
      setActivityDraft((current) => {
        if (
          !current ||
          current.entryKind !== "action" ||
          current.activityType !== "send_email"
        ) {
          return current;
        }

        return {
          ...current,
          details: {
            ...normalizeEmailActionDetails(current.details || {}),
            subject: suggestion.subject,
            messageBody: suggestion.messageBody,
          },
        };
      });
    } catch (requestError) {
      setActivityError(
        getApiErrorMessage(
          requestError,
          "No fue posible regenerar el correo con IA.",
        ),
      );
    } finally {
      setGeneratingActivityEmailSuggestion(false);
    }
  }

  async function handleRegenerateEmailDraftSuggestion() {
    if (
      !emailDraftModalItem ||
      !emailDraftState ||
      emailDraftState.isReadOnly
    ) {
      return;
    }

    setGeneratingEmailDraftSuggestion(true);
    setEmailDraftError("");
    setEmailDraftNotice("");
    try {
      const suggestion = await requestAiEmailSuggestion(
        emailDraftModalItem,
        emailDraftState.details,
      );
      emailDraftSuggestionRef.current = suggestion;
      setEmailDraftState((current) =>
        current
          ? {
              ...current,
              details: {
                ...normalizeEmailActionDetails(current.details || {}),
                subject: suggestion.subject,
                messageBody: suggestion.messageBody,
              },
            }
          : current,
      );
      setEmailDraftNotice("Correo regenerado con IA.");
    } catch (requestError) {
      setEmailDraftError(
        getApiErrorMessage(
          requestError,
          "No fue posible regenerar el correo con IA.",
        ),
      );
    } finally {
      setGeneratingEmailDraftSuggestion(false);
    }
  }

  async function handleSaveEmailDraft() {
    if (!emailDraftState?.opportunityId || !emailDraftState.actionId) return;

    const validationError = validateEmailActionDetails(emailDraftState.details);
    if (validationError) {
      setEmailDraftError(validationError);
      return;
    }

    setSavingEmailDraft(true);
    setEmailDraftError("");
    setEmailDraftNotice("");
    setEmailSendFeedback(null);
    try {
      const response = await api.patch(
        `/api/commercial-development/opportunities/${emailDraftState.opportunityId}/activities/${emailDraftState.actionId}/email-draft`,
        { details: emailDraftState.details },
      );
      setEmailDraftState((current) =>
        current
          ? {
              ...current,
              details: {
                ...current.details,
                ...(response.data?.details || {}),
              },
            }
          : current,
      );
      const nextDashboard = await loadDashboard(selectedPeriodKey);
      syncActivityModalFromDashboard(
        nextDashboard,
        emailDraftState.opportunityId,
        emailDraftState.actionId,
      );
      setEmailDraftNotice("Borrador guardado.");
    } catch (requestError) {
      setEmailDraftError(
        getApiErrorMessage(
          requestError,
          "No fue posible guardar el borrador del correo.",
        ),
      );
    } finally {
      setSavingEmailDraft(false);
    }
  }

  async function handleRequestSendEmail() {
    if (!emailDraftState?.opportunityId || !emailDraftState.actionId) return;

    if (!confirmingEmailSend) {
      const validationError = validateEmailActionDetails(
        emailDraftState.details,
      );
      if (validationError) {
        setEmailDraftError(validationError);
        return;
      }
      setConfirmingEmailSend(true);
      setEmailDraftError("");
      setEmailDraftNotice("");
      setEmailSendFeedback(null);
      return;
    }

    setSavingEmailDraft(true);
    setEmailDraftError("");
    setEmailDraftNotice("");
    setEmailSendFeedback(null);
    try {
      const response = await api.post(
        `/api/commercial-development/opportunities/${emailDraftState.opportunityId}/activities/${emailDraftState.actionId}/send-email`,
        { details: emailDraftState.details },
      );
      setEmailDraftState((current) =>
        current
          ? {
              ...current,
              status: response.data?.status || current.status,
              isReadOnly: true,
              details: {
                ...current.details,
                ...(response.data?.details || {}),
              },
            }
          : current,
      );
      const nextDashboard = await loadDashboard(selectedPeriodKey);
      syncActivityModalFromDashboard(
        nextDashboard,
        emailDraftState.opportunityId,
        emailDraftState.actionId,
      );
      setEmailSendFeedback({
        tone: "success",
        message: response.data?.details?.sentAt
          ? `Correo enviado correctamente el ${formatDateTime(response.data.details.sentAt)}.`
          : "Correo enviado correctamente.",
      });
      setConfirmingEmailSend(false);
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible enviar el correo desde la accion.",
      );
      setEmailDraftError(message);
      setEmailSendFeedback({
        tone: "error",
        message: `Fallo el envio del correo. ${message}`,
      });
      setConfirmingEmailSend(false);
    } finally {
      setSavingEmailDraft(false);
    }
  }

  async function handleSaveActivity(event) {
    event.preventDefault();
    if (!activityModalItem?.id) return;

    const isActionForm = activityDraft.entryKind === "action";
    const actionObjective = isActionForm
      ? getActionDraftObjective(activityDraft)
      : "";

    if (
      !activityDraft.activityType ||
      (!isActionForm && !activityDraft.objective.trim()) ||
      (isActionForm && !actionObjective)
    ) {
      setActivityError(
        isActionForm
          ? "Completa el tipo de accion para continuar."
          : "Completa tipo, fecha/hora y objetivo para guardar la actividad.",
      );
      return;
    }

    if (!isActionForm && !activityDraft.scheduledAt) {
      setActivityError(
        "Completa tipo, fecha/hora y objetivo para guardar la actividad.",
      );
      return;
    }

    if (activityDraft.activityType === "send_email") {
      const details = {
        ...emptyActionDetails(),
        ...(activityDraft.details || {}),
      };
      if (
        !details.recipient.trim() ||
        !details.subject.trim() ||
        !details.messageBody.trim()
      ) {
        setActivityError(
          "Completa destinatario, asunto y mensaje base para guardar la accion de correo.",
        );
        return;
      }
    }

    setSavingActivity(true);
    setActivityError("");
    try {
      const actionDetails =
        activityDraft.entryKind === "action"
          ? {
              ...emptyActionDetails(),
              ...(activityDraft.details || {}),
              expectedResponse:
                activityDraft.successCriteria.trim() ||
                activityDraft.details?.expectedResponse ||
                "",
            }
          : null;
      const payload = {
        entryKind: activityDraft.entryKind,
        activityType: activityDraft.activityType,
        scheduledAt:
          activityDraft.entryKind === "activity"
            ? activityDraft.scheduledAt
            : null,
        dueDate:
          activityDraft.entryKind === "action" ? getTodayDateValue() : null,
        priority: activityDraft.entryKind === "action" ? "medium" : undefined,
        objective: isActionForm
          ? actionObjective
          : activityDraft.objective.trim(),
        note: isActionForm ? "" : activityDraft.note.trim(),
        status: activityDraft.status,
        successCriteria:
          activityDraft.entryKind === "action"
            ? activityDraft.successCriteria.trim()
            : "",
        details: actionDetails,
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
        getApiErrorMessage(
          requestError,
          activityDraft.entryKind === "action"
            ? "No fue posible guardar la accion."
            : "No fue posible guardar la actividad.",
        ),
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
          entryKind: activityDraft.entryKind,
          activityType: activityDraft.activityType,
          scheduledAt:
            activityDraft.entryKind === "activity"
              ? activityDraft.scheduledAt
              : null,
          dueDate:
            activityDraft.entryKind === "action" ? getTodayDateValue() : null,
          objective: isActionForm
            ? actionObjective
            : activityDraft.objective.trim(),
          note: isActionForm ? "" : activityDraft.note.trim(),
          priority: activityDraft.entryKind === "action" ? "medium" : undefined,
          successCriteria:
            activityDraft.entryKind === "action"
              ? activityDraft.successCriteria.trim()
              : "",
          details:
            activityDraft.entryKind === "action"
              ? {
                  ...emptyActionDetails(),
                  ...(activityDraft.details || {}),
                  expectedResponse:
                    activityDraft.successCriteria.trim() ||
                    activityDraft.details?.expectedResponse ||
                    "",
                }
              : null,
          isPrimaryNextStep: false,
        },
      );
      await loadDashboard(selectedPeriodKey);
      closeActivityModal();
    } catch (requestError) {
      setActivityError(
        getApiErrorMessage(
          requestError,
          activityDraft.entryKind === "action"
            ? "No fue posible marcar la accion como realizada."
            : "No fue posible marcar la actividad como realizada.",
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
          recentTimeline: [
            activity,
            ...asArray(workboardItem.recentTimeline).filter(
              (item) => Number(item.id) !== Number(activity.id),
            ),
          ],
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
          recentTimeline: [activity],
          recentActivities: [activity],
          nextScheduledActivity: activity,
          activityCount: 1,
          actionCount: 0,
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
          <span className="commercial-development-kicker">
            Cockpit comercial
          </span>
          <div className="commercial-development-title-row">
            <h2>Desarrollo Comercial</h2>
            <DevelopmentHelp />
          </div>
          <p className="section-helper-text">
            Prioriza cobertura contra cuota, concentra decisiones del trimestre
            y permite ejecutar el siguiente movimiento desde la misma vista.
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
              <p>Lectura agregada del pipeline abierto por etapa comercial.</p>
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

          <div
            className="commercial-development-funnel-visual"
            role="list"
            aria-label="Embudo trimestral por etapa"
          >
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
                      style={{
                        width: `${getFunnelShapeWidth(index, funnel.stages.length)}%`,
                      }}
                      onClick={() =>
                        handleFunnelStageClick(
                          stage.stageCode,
                          stage.opportunityCount,
                        )
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
                          style={{
                            "--funnel-group-stage-span":
                              stageGroupMarker.stageSpan,
                          }}
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
              <div className="empty-state">
                No hay pipeline abierto para este trimestre.
              </div>
            )}

            {funnel.stages.length ? (
              <div
                className="commercial-development-funnel-tip-row"
                aria-hidden="true"
              >
                <div className="commercial-development-funnel-tip-slot">
                  <div className="commercial-development-funnel-tip" />
                </div>
                <div className="commercial-development-funnel-row-marker-slot" />
              </div>
            ) : null}
          </div>
        </section>

        <section className="commercial-development-spotlight commercial-development-calendar-panel">
          <div className="commercial-development-section-header commercial-development-calendar-header">
            <div>
              <h3>Agenda comercial del trimestre</h3>
              <p>
                Visualiza actividades por dia, semana o mes y abre seguimiento
                sin salir del modulo.
              </p>
            </div>
            <span>{formatCalendarRange(calendarFilters)}</span>
          </div>

          <div className="commercial-development-calendar-toolbar">
            <div
              className="commercial-development-calendar-view-switcher"
              role="tablist"
              aria-label="Vista del calendario"
            >
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
              <div
                className="commercial-development-calendar-nav-segmented"
                role="group"
                aria-label="Navegacion del calendario"
              >
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
                <span>Fecha de referencia</span>
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
                <div
                  className={
                    calendarView === "month"
                      ? "commercial-development-calendar-month-frame"
                      : ""
                  }
                >
                  {calendarView === "month" ? (
                    <div
                      className="commercial-development-calendar-month-weekdays"
                      aria-hidden="true"
                    >
                      {CALENDAR_WEEKDAY_HEADERS.map((label) => (
                        <div
                          key={label}
                          className="commercial-development-calendar-month-weekday"
                        >
                          {label}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div
                    className={`commercial-development-calendar-grid is-${calendarView}`}
                  >
                    {calendarView === "month"
                      ? Array.from({ length: monthLeadingEmptySlots }).map(
                          (_, index) => (
                            <div
                              key={`calendar-empty-${index}`}
                              className="commercial-development-calendar-day is-placeholder"
                              aria-hidden="true"
                            >
                              <span className="commercial-development-calendar-placeholder-mark" />
                            </div>
                          ),
                        )
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
                                  {isToday
                                    ? "Hoy"
                                    : getWeekdayLabel(day.date, "short")}
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
                            {asArray(day.items)
                              .slice(0, previewLimit)
                              .map((item) => (
                                <span
                                  key={`calendar-item-preview-${item.id}`}
                                  className="commercial-development-calendar-preview-pill"
                                >
                                  {formatDateTime(item.scheduledAt)
                                    .split(",")[1]
                                    ?.trim() ||
                                    getActivityTypeLabel(item.activityType)}
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
                <div className="empty-state">
                  No hay actividades en este rango.
                </div>
              )}
            </div>

            <aside className="commercial-development-calendar-detail">
              <div className="commercial-development-calendar-detail-header">
                <div className="commercial-development-calendar-detail-heading">
                  <span>Dia seleccionado</span>
                  <h4>
                    {selectedDayData?.date
                      ? formatDate(selectedDayData.date)
                      : "Sin seleccion"}
                  </h4>
                  <p>
                    {selectedDayData?.date
                      ? `${getWeekdayLabel(selectedDayData.date, "long")} · agenda operativa del dia`
                      : "Selecciona un dia para ver su agenda."}
                  </p>
                </div>
                <span className="commercial-development-pill is-low">
                  {selectedDayItems.length} actividad
                  {selectedDayItems.length === 1 ? "" : "es"}
                </span>
              </div>

              <div className="commercial-development-calendar-detail-summary">
                <div className="commercial-development-calendar-detail-chip">
                  <span>Oportunidades activas</span>
                  <strong>{calendarOpportunityOptions.length}</strong>
                </div>
              </div>

              <div className="commercial-development-calendar-create-box">
                <div className="commercial-development-calendar-create-copy">
                  <span
                    className="commercial-development-calendar-inline-icon"
                    aria-hidden="true"
                  >
                    <CalendarPlusIcon />
                  </span>
                  <strong>Nueva actividad</strong>
                  <p>
                    Elige la oportunidad y crea la siguiente accion para este
                    dia.
                  </p>
                </div>
                <label>
                  Oportunidad
                  <select
                    value={calendarOpportunityId}
                    onChange={(event) =>
                      setCalendarOpportunityId(event.target.value)
                    }
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
                        <strong>
                          {getActivityTypeLabel(item.activityType)}
                        </strong>
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
                    <span
                      className="commercial-development-calendar-empty-icon"
                      aria-hidden="true"
                    >
                      <SparkIcon />
                    </span>
                    <strong>Dia sin Actividades</strong>
                    <p>
                      No hay actividades programadas para este dia. Puedes crear
                      una desde este panel.
                    </p>
                  </div>
                )}
              </div>
            </aside>
          </div>
        </section>
      </div>

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
                      <span
                        className={`commercial-development-pill ${item.coverageKind === "committed" ? "is-low" : "is-medium"}`}
                      >
                        {item.coverageKind === "committed"
                          ? "Comprometida"
                          : "Ponderada"}
                      </span>
                      <span className="commercial-development-date-badge">
                        Fecha objetivo: {formatDate(item.closeDate)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className={`commercial-development-activity-trigger ${item.activityCount ? "has-activity" : ""}`.trim()}
                      onClick={() => openActivityViewer(item)}
                      aria-label={`Ver actividades y acciones de ${item.name}`}
                      title="Ver actividades y acciones"
                    >
                      <ActivityIcon />
                    </button>
                  </div>
                </div>

                <div className="commercial-development-gap-coverage-grid">
                  <div>
                    <span>Monto total</span>
                    <strong>
                      {formatCurrency(
                        item.amountUsd,
                        currentPeriod?.baseCurrencyCode,
                      )}
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
                      {item.aiStatusSummary ||
                        "Sin lectura sugerida disponible."}
                    </p>
                  </div>
                  <div className="commercial-development-gap-coverage-insight is-accent">
                    <span>Siguiente paso sugerido</span>
                    <p>
                      {item.aiNextStepRecommendation ||
                        "Sin recomendación sugerida."}
                    </p>
                  </div>
                </div>

                <div className="commercial-development-activity-preview">
                  <p>
                    <strong>Proxima actividad:</strong>{" "}
                    {item.nextScheduledActivity
                      ? `${getEntryTypeLabel("activity", item.nextScheduledActivity.activityType)} · ${formatDateTime(item.nextScheduledActivity.scheduledAt)}`
                      : "Sin actividad programada"}
                  </p>
                  <p>
                    <strong>Proxima accion:</strong>{" "}
                    {item.nextPendingAction
                      ? `${getEntryTypeLabel("action", item.nextPendingAction.activityType)} · ${item.nextPendingAction.dueDate ? formatDate(item.nextPendingAction.dueDate) : "Sin fecha"}`
                      : "Sin accion pendiente"}
                  </p>
                  <p>
                    <strong>Siguiente paso principal:</strong>{" "}
                    {item.nextStep?.title
                      ? `${getEntryTypeLabel(getEntryKind(item.nextStep.actionType), item.nextStep.actionType)}: ${item.nextStep.title}`
                      : "Sin definir"}
                  </p>
                  <p>
                    <strong>Historial:</strong>{" "}
                    {item.activityCount || item.actionCount
                      ? `${item.activityCount || 0} ${item.activityCount === 1 ? "actividad" : "actividades"} · ${item.actionCount || 0} ${item.actionCount === 1 ? "accion" : "acciones"}`
                      : "Sin actividades ni acciones"}
                  </p>
                  {item.nextScheduledActivity ||
                  isSendEmailAction(item.nextPendingAction) ? (
                    <div className="commercial-development-activity-preview-actions">
                      {isSendEmailAction(item.nextPendingAction) ? (
                        <button
                          type="button"
                          className="commercial-development-activity-icon-button"
                          onClick={() =>
                            openEmailDraftModal(item, item.nextPendingAction)
                          }
                          aria-label={`Abrir borrador de correo de ${item.name}`}
                          title="Abrir borrador de correo"
                        >
                          <MailActionIcon />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="commercial-development-activity-icon-button"
                        onClick={() =>
                          openEditActivityModal(
                            item,
                            item.nextScheduledActivity,
                          )
                        }
                        disabled={!item.nextScheduledActivity}
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
        isGeneratingEmailSuggestion={generatingActivityEmailSuggestion}
        onRegenerateEmailSuggestion={handleRegenerateActivityEmailSuggestion}
        attachmentOptions={activeAttachmentOptions}
        attachmentUploadState={activityAttachmentUploadState}
        onRefreshAttachmentOptions={() =>
          loadEmailAttachmentOptions(activeAttachmentOpportunityId, {
            force: true,
          })
        }
        onAddAttachment={handleAddActivityAttachment}
        onRemoveAttachment={handleRemoveActivityAttachment}
        onUploadAttachments={handleUploadActivityAttachments}
        onClose={closeActivityModal}
        onSubmit={handleSaveActivity}
        onMarkDone={handleCompleteActivity}
        viewMode={activityViewMode}
        onShowCreate={showCreateActivityForm}
        onShowCreateAction={showCreateActionForm}
        onShowList={showActivityList}
        onSelectActivity={selectActivityFromList}
        onOpenEmailDraft={(activity) =>
          openEmailDraftModal(activityModalItem, activity)
        }
        recipientOptions={activeRecipientOptions}
        recipientOptionsLoading={activeRecipientOptionsLoading}
        recipientOptionsError={activeRecipientOptionsError}
        currencyCode={currentPeriod?.baseCurrencyCode}
      />

      <CommercialEmailDraftModal
        item={emailDraftModalItem}
        draft={emailDraftState}
        saving={savingEmailDraft}
        error={emailDraftError}
        notice={emailDraftNotice}
        isGeneratingEmailSuggestion={generatingEmailDraftSuggestion}
        onRegenerateEmailSuggestion={handleRegenerateEmailDraftSuggestion}
        attachmentOptions={draftAttachmentOptions}
        attachmentUploadState={emailDraftAttachmentUploadState}
        onRefreshAttachmentOptions={() =>
          loadEmailAttachmentOptions(draftAttachmentOpportunityId, {
            force: true,
          })
        }
        onAddAttachment={handleAddEmailDraftAttachment}
        onRemoveAttachment={handleRemoveEmailDraftAttachment}
        onUploadAttachments={handleUploadEmailDraftAttachments}
        sendFeedback={emailSendFeedback}
        isConfirmingSend={confirmingEmailSend}
        recipientOptions={draftRecipientOptions}
        recipientOptionsLoading={draftRecipientOptionsLoading}
        recipientOptionsError={draftRecipientOptionsError}
        onClose={closeEmailDraftModal}
        onChange={updateEmailDraftField}
        onSaveDraft={handleSaveEmailDraft}
        onRequestSend={handleRequestSendEmail}
        onCancelConfirm={() => setConfirmingEmailSend(false)}
      />
    </section>
  );
}
