import { useEffect, useMemo, useState } from "react";
import { api, getApiErrorMessage } from "../api";
import {
  formatBusinessDate,
  formatBusinessDateTime,
  toBusinessDateTimeInputValue,
} from "../business-timezone";
import OpportunityOperationEmailModal from "./OpportunityOperationEmailModal";
import {
  buildInteractionApprovalDraft,
  inferInteractionActivityStatus,
} from "./interactionStatus";
import "./opportunity-interaction-coach.css";
import "./opportunity-interaction-review.css";

const AI_NARRATIVE_TIMEOUT_MS = 60000;
const AI_NARRATIVE_POLL_INTERVAL_MS = 3000;
const AI_NARRATIVE_TOTAL_POLL_TIMEOUT_MS = 120000;
const OPERATION_EMAIL_MAX_LIBRARY_ASSETS = 3;

function normalizeText(value) {
  return String(value || "").trim();
}

function parseOpportunityAmount(value) {
  const normalized = normalizeText(value)
    .replace(/[^0-9.,-]/g, "")
    .replace(/,(?=\d{3}(?:\D|$))/g, "")
    .replace(/,/g, ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function getInteractionActivityTypeLabel(value) {
  return {
    call: "Llamada",
    meeting: "Reunión",
    demo: "Demostración",
    email: "Correo",
    other: "Otra actividad",
  }[normalizeText(value).toLowerCase()] || "Actividad";
}

function normalizeInteractionActivityType(value) {
  const normalized = normalizeText(value).toLowerCase();
  return {
    demo: "presentation",
    meeting: "conference",
    email: "other",
    call: "call",
    presentation: "presentation",
    conference: "conference",
    visit: "visit",
    other: "other",
  }[normalized] || "other";
}

function getInteractionFieldLabel(value) {
  return {
    budgetUsd: "Presupuesto de la oportunidad",
    type: "Tipo de actividad",
    scheduledDate: "Fecha propuesta",
    dueDate: "Fecha del próximo paso",
    title: "Título de la actividad",
    note: "Nota de la actividad",
    implementationDate: "Fecha de implementación",
    approvalRequired: "Aprobación requerida",
    successCriteria: "Criterio de éxito",
  }[normalizeText(value)] || normalizeText(value) || "Cambio detectado";
}

function getInteractionConfidenceLabel(value) {
  return {
    high: "alta",
    medium: "media",
    low: "baja",
  }[normalizeText(value).toLowerCase()] || normalizeText(value) || "media";
}

function isStepAnswerMissing(answer) {
  if (!answer?.is_required) return false;
  return !normalizeText(answer?.answer_value);
}

function toDateOnly(dateValue) {
  const text = normalizeText(dateValue);
  if (!text) return "";
  return text.slice(0, 10);
}

function toLocalDateInputValue(offsetDays = 0) {
  const target = new Date();
  target.setDate(target.getDate() + Number(offsetDays || 0));
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, "0");
  const day = String(target.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isDateInPast(dateValue) {
  const isoDate = toDateOnly(dateValue);
  if (!isoDate) return false;
  const today = new Date();
  const currentDate = new Date(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`,
  );
  const targetDate = new Date(`${isoDate}T00:00:00`);
  return targetDate.getTime() < currentDate.getTime();
}

function getNarrativeSourceLabel(source) {
  const normalized = normalizeText(source).toLowerCase();
  if (normalized === "openai") return "IA (OpenAI)";
  if (normalized === "fallback") return "Fallback (reglas locales)";
  if (!normalized) return "Pendiente";
  return normalized;
}

function getJobStatusLabel(status) {
  const normalized = normalizeText(status).toLowerCase();
  if (!normalized) return "Pendiente";
  if (normalized === "loading" || normalized === "running") {
    return "En ejecucion";
  }
  if (normalized === "completed") return "Completado";
  if (normalized === "pending") return "Pendiente";
  if (normalized === "failed") return "Fallido";
  if (normalized === "stale") return "Desactualizado";
  if (normalized === "expired") return "Expirado";
  if (normalized === "persisted") return "Persistido";
  return normalized;
}

function getJobStatusTone(status) {
  const normalized = normalizeText(status).toLowerCase();
  if (!normalized || normalized === "pending" || normalized === "loading") {
    return "pending";
  }
  if (normalized === "running") return "running";
  if (normalized === "completed" || normalized === "persisted") {
    return "completed";
  }
  return "failed";
}

function formatNarrativeTimestamp(value) {
  return formatBusinessDateTime(value, {
    fallback: "Sin fecha",
    options: {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  });
}

function formatActivityDisplayDate(value, { includeTime = false } = {}) {
  if (!value) return "Sin fecha";
  const dateOnly = toDateOnly(value);
  if (dateOnly && !includeTime) {
    return formatBusinessDate(dateOnly, {
      fallback: "Sin fecha",
      options: { day: "2-digit", month: "2-digit", year: "numeric" },
    });
  }
  return formatNarrativeTimestamp(value);
}

function parseActivityTimestamp(value) {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return Number.NaN;
  }
  return parsed.getTime();
}

function normalizeInteractionAnalysisResult(result) {
  const source = result && typeof result === "object" && !Array.isArray(result)
    ? result
    : {};
  return {
    ...source,
    changes: Array.isArray(source.changes)
      ? source.changes.filter(
          (change) => change && typeof change === "object",
        )
      : [],
    activity:
      source.activity && typeof source.activity === "object"
        ? source.activity
        : null,
    nextStep:
      source.nextStep && typeof source.nextStep === "object"
        ? source.nextStep
        : {},
  };
}

function buildStructuredInteractionDraft(
  result,
  fallbackNote = "",
  stageQuestions = [],
  stageName = "",
  currentAmount = "",
) {
  const legacy = buildInteractionApprovalDraft(result, fallbackNote);
  const activityResult = result?.activity || null;
  const nextStep = result?.nextStep || {};
  const activityScheduledAt = normalizeText(
    activityResult?.scheduledAt || activityResult?.scheduled_at,
  );
  const activityScheduledTime = activityScheduledAt.match(
    /[T\s](\d{2}:\d{2})(?::\d{2})?/,
  )?.[1];
  const structuredProposals = [];
  const amountChange = (Array.isArray(result?.changes) ? result.changes : []).find(
    (change) =>
      normalizeText(change?.entity).toLowerCase() === "opportunity" &&
      ["amountusd", "amount_usd", "importe", "monto"].includes(
        normalizeText(change?.field).toLowerCase(),
      ),
  );
  const proposedAmount = amountChange
    ? parseOpportunityAmount(amountChange.newValue)
    : null;
  if (proposedAmount !== null) {
    structuredProposals.push({
      proposalId: "opportunity-amount-proposal",
      kind: "opportunity_field",
      status: "proposed",
      reviewRequired: true,
      selected: true,
      source: { type: "chatbot", rawText: fallbackNote },
      fields: {
        field: "amountUsd",
        label: "Importe en dólares",
        value: proposedAmount,
        previousValue:
          parseOpportunityAmount(amountChange?.previousValue) ??
          parseOpportunityAmount(currentAmount),
        confidence: amountChange?.confidence || "high",
        evidence: amountChange?.evidence || "",
      },
    });
  }

  if (activityResult?.requested === true) {
    structuredProposals.push({
      proposalId: "activity-proposal",
      kind: "activity",
      status: "proposed",
      reviewRequired: true,
      selected: true,
      source: { type: "chatbot", rawText: fallbackNote },
      fields: {
        activityType: String(activityResult?.type || legacy.activityType || "call"),
        objective:
          String(
            activityResult?.objective || activityResult?.title || legacy.objective || "",
          ).trim(),
        scheduledDate: String(
          activityResult?.scheduledAt || activityResult?.scheduledDate || legacy.scheduledDate || "",
        ).slice(0, 10).trim(),
        scheduledTime: String(
          activityResult?.scheduledTime ||
            activityResult?.time ||
            activityResult?.hora ||
            activityScheduledTime ||
            legacy.scheduledTime ||
            "09:00",
        ).trim(),
        note: String(activityResult?.note || legacy.note || fallbackNote || "").trim(),
        status: "pending",
        ownerUserId: null,
        confidence: 0.92,
      },
    });
  }

  const nextStepTitle = normalizeText(
    nextStep?.title || legacy.nextStepTitle || "",
  );
  if (nextStepTitle) {
    structuredProposals.push({
      proposalId: "next-step-proposal",
      kind: "next_step",
      status: "proposed",
      reviewRequired: true,
      selected: true,
      source: { type: "chatbot", rawText: fallbackNote },
      fields: {
        title: nextStepTitle,
        dueDate: String(nextStep?.dueDate || legacy.nextStepDueDate || "").slice(0, 10),
        successCriteria:
          String(
            nextStep?.successCriteria ||
              legacy.nextStepSuccessCriteria ||
              "Registrar compromiso del cliente.",
          ).trim() || "Registrar compromiso del cliente.",
        priority: "high",
        ownerUserId: null,
        status: "pending",
      },
    });
  }

  const stageAnswerChange = (Array.isArray(result?.changes) ? result.changes : []).find(
    (change) =>
      ["stageanswer", "stageanswers"].includes(
        normalizeText(change?.entity).toLowerCase().replace(/[_-]/g, ""),
      ) && normalizeText(change?.newValue),
  );
  const stageAnswers = Array.isArray(result?.stageAnswers)
    ? result.stageAnswers
    : [];
  const stageAnswerCandidates = [
    result?.stageAnswer,
    result?.stage_answer,
    ...stageAnswers,
    stageAnswerChange,
  ];
  const stageAnswer =
    stageAnswerCandidates.find((candidate) =>
      normalizeText(
        candidate?.answerValue ||
          candidate?.answer_value ||
          candidate?.proposedAnswer ||
          candidate?.newValue,
      ),
    ) || {};
  const stageAnswerQuestionId = [
    stageAnswer?.questionId,
    stageAnswer?.question_id,
    stageAnswerChange?.questionId,
    stageAnswerChange?.question_id,
    stageAnswerChange?.field,
    stageAnswer?.id,
    stageQuestions[0]?.questionId,
    stageQuestions[0]?.question_id,
    stageQuestions[0]?.id,
  ]
    .map((value) => Number(value))
    .find((value) => Number.isInteger(value) && value > 0) || 0;
  const matchedStageQuestion = stageQuestions.find(
    (question) =>
      Number(
        question?.question_id || question?.questionId || question?.id,
      ) === stageAnswerQuestionId,
  );
  const stageAnswerValue = normalizeText(
    stageAnswer?.answerValue ||
      stageAnswer?.answer_value ||
      stageAnswer?.proposedAnswer ||
      stageAnswer?.newValue,
  );
  if (proposedAmount === null && stageAnswerQuestionId > 0 && stageAnswerValue) {
    structuredProposals.unshift({
      proposalId: "stage-answer-proposal",
      kind: "stage_answer",
      status: "proposed",
      reviewRequired: true,
      selected: true,
      source: { type: "chatbot", rawText: fallbackNote },
      question: {
        id: stageAnswerQuestionId,
        prompt:
          normalizeText(stageAnswer?.questionPrompt) ||
          normalizeText(stageAnswer?.question_prompt) ||
          normalizeText(matchedStageQuestion?.prompt),
        stageName: normalizeText(stageAnswer?.stageName) || normalizeText(stageName),
      },
      fields: {
        answerValue: stageAnswerValue,
        previousAnswer: normalizeText(matchedStageQuestion?.answerValue || matchedStageQuestion?.answer_value),
        answerMode: normalizeText(matchedStageQuestion?.answerValue || matchedStageQuestion?.answer_value)
          ? "replace"
          : "replace",
        confidence: stageAnswer?.confidence || "high",
      },
    });
  }

  return {
    draftId: `interaction-${Date.now()}`,
    status: "pending_review",
    summary: {
      title: "Resumen del cambio sugerido",
      message:
        normalizeText(result?.summary) ||
        "El coach detectó cambios recomendados para la oportunidad.",
      warnings: [],
    },
    errors: [],
    proposals: structuredProposals,
    activityType: legacy.activityType,
    objective: legacy.objective,
    scheduledDate: legacy.scheduledDate,
    scheduledTime: legacy.scheduledTime,
    note: legacy.note,
    nextStepTitle: legacy.nextStepTitle,
    nextStepDueDate: legacy.nextStepDueDate,
    nextStepSuccessCriteria: legacy.nextStepSuccessCriteria,
  };
}

function formatProposalLabel(kind) {
  return {
    stage_answer: "Respuesta de etapa",
    activity: "Actividad",
    next_step: "Próximo paso",
    stage_transition: "Cambio de etapa",
    commercial_close: "Cierre comercial",
  }[kind] || "Cambio sugerido";
}

function updateInteractionApprovalProposalById(current, proposalId, updater) {
  if (!current?.proposals?.length) return current;
  return {
    ...current,
    proposals: current.proposals.map((proposal) =>
      proposal.proposalId === proposalId ? updater(proposal) : proposal,
    ),
  };
}

function formatActivityProposalDate(value) {
  if (!value) return "Seleccionar fecha";
  return formatBusinessDate(value, {
    fallback: "Sin fecha",
    options: { day: "2-digit", month: "2-digit", year: "numeric" },
  });
}

function formatActivityProposalTime(value) {
  return value ? value : "09:00";
}

function formatProposalSummaryText(proposal) {
  if (proposal.kind === "stage_answer") {
    return normalizeText(proposal.fields?.answerValue) || "Sin respuesta";
  }
  if (proposal.kind === "activity") {
    return `${proposal.fields?.objective || "Actividad sin objetivo"} · ${formatActivityProposalDate(proposal.fields?.scheduledDate)} ${formatActivityProposalTime(proposal.fields?.scheduledTime)}`;
  }
  if (proposal.kind === "next_step") {
    return `${proposal.fields?.title || "Próximo paso"} · ${proposal.fields?.dueDate || "Sin fecha"}`;
  }
  return normalizeText(proposal.fields?.reason || proposal.fields?.title || "Cambio sugerido");
}

function formatActivityTimestamp(value) {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return "Sin actividad reciente";
  }

  return parsed.toLocaleString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function InsightAiIcon() {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-hidden="true" focusable="false">
      <path
        d="M12 3.75 13.9 8.1l4.35 1.9-4.35 1.9L12 16.25l-1.9-4.35-4.35-1.9 4.35-1.9L12 3.75Zm6.25 9.5.95 2.3 2.3.95-2.3.95-.95 2.3-.95-2.3-2.3-.95 2.3-.95.95-2.3Zm-12.5 1.5.95 2.3 2.3.95-2.3.95-.95 2.3-.95-2.3-2.3-.95 2.3-.95.95-2.3Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ManageExecutionItemIcon({ tone }) {
  const glyph = tone === "done" ? "✓" : tone === "cancelled" ? "×" : "•";
  return (
    <span className="opportunity-development-item-manage-glyph">{glyph}</span>
  );
}

function SaveExecutionItemIcon() {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-hidden="true" focusable="false">
      <path
        d="M4.75 4.75A1.75 1.75 0 0 1 6.5 3h9.88L20.5 7.12V19.5a1.75 1.75 0 0 1-1.75 1.75h-12A1.75 1.75 0 0 1 5 19.5v-14.75Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 3.5V9h7V3.5M8 14.5h8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const ACTIVITY_TYPE_OPTIONS = [
  { value: "call", label: "Llamada" },
  { value: "conference", label: "Conferencia" },
  { value: "visit", label: "Visita" },
  { value: "presentation", label: "Presentacion" },
  { value: "other", label: "Otra actividad" },
];

const DEPENDENCY_TYPE_OPTIONS = [
  { value: "presales_support", label: "Preventa" },
  { value: "provider_response", label: "Proveedor" },
  { value: "legal_review", label: "Legal" },
  { value: "commercial_management", label: "Direccion comercial" },
  { value: "pricing_internal", label: "Cotizacion interna" },
  { value: "finance_approval", label: "Finanzas" },
  { value: "operations_alignment", label: "Operaciones" },
];

const ACTIVITY_TYPE_LABELS = Object.fromEntries(
  ACTIVITY_TYPE_OPTIONS.map((item) => [item.value, item.label]),
);
const DEPENDENCY_TYPE_LABELS = Object.fromEntries(
  DEPENDENCY_TYPE_OPTIONS.map((item) => [item.value, item.label]),
);

const ACTIVITY_TYPE_SET = new Set(
  ACTIVITY_TYPE_OPTIONS.map((item) => item.value),
);

function getWorkspaceEntryKind(item) {
  const explicitKind = normalizeText(item?.details?.entryKind).toLowerCase();
  if (explicitKind === "action" || explicitKind === "activity") {
    return explicitKind;
  }
  return ACTIVITY_TYPE_SET.has(String(item?.actionType || ""))
    ? "activity"
    : "action";
}

function toDateTimeLocalInputValue(value) {
  if (!value) return "";
  const businessDateTime = toBusinessDateTimeInputValue(value);
  if (businessDateTime) return businessDateTime;
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return "";
  }
  const pad = (num) => String(num).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

function getExecutionStatusTone(status) {
  const normalized = normalizeText(status).toLowerCase();
  if (normalized === "done") return "done";
  if (normalized === "cancelled" || normalized === "blocked") {
    return "cancelled";
  }
  return "pending";
}

function getExecutionStatusLabel(status) {
  const normalized = normalizeText(status).toLowerCase();
  if (normalized === "done") return "Realizada";
  if (normalized === "cancelled") return "Cancelada";
  if (normalized === "blocked") return "Bloqueada";
  if (normalized === "in_progress") return "En progreso";
  if (normalized === "confirmed") return "Confirmada";
  if (normalized === "rescheduled") return "Reagendada";
  if (normalized === "missed") return "No asistida";
  return "Pendiente";
}

function getExecutionStatusBadgeTone(status) {
  const normalized = normalizeText(status).toLowerCase();
  if (normalized === "done") return "done";
  if (normalized === "cancelled" || normalized === "blocked") {
    return "blocked";
  }
  return "pending";
}

function isExecutionItemClosed(status) {
  const normalized = normalizeText(status).toLowerCase();
  return (
    normalized === "done" ||
    normalized === "cancelled" ||
    normalized === "blocked"
  );
}

function getOperationStatusLabel(status) {
  const normalized = normalizeText(status).toLowerCase();
  if (normalized === "done") return "Enviada";
  if (normalized === "cancelled") return "Cancelada";
  if (normalized === "in_progress") return "En progreso";
  if (normalized === "blocked") return "Bloqueada";
  return "Pendiente";
}

function toDateOnlySafe(value) {
  const text = normalizeText(value);
  if (!text) return "";
  return text.slice(0, 10);
}

function mapDocumentToEmailAttachment(document) {
  const publicId = String(document?.publicId || "").trim();
  if (!publicId) return null;

  return {
    id: `opportunity:${publicId}`,
    sourceType: "opportunity_document",
    sourceLabel: "Documento cargado",
    documentPublicId: publicId,
    fileName: String(document?.originalFileName || "documento").trim(),
    mimeType: String(document?.mimeType || "application/octet-stream").trim(),
    byteSize: Number(document?.byteSize || 0),
    createdAt: document?.createdAt || null,
  };
}

function mapLibraryOptionToEmailAttachment(option, selectionSource = "manual") {
  const id = normalizeText(option?.id);
  const resourcePublicId = normalizeText(option?.resourcePublicId);
  const filePublicId = normalizeText(option?.filePublicId);
  if (!id || !resourcePublicId || !filePublicId) {
    return null;
  }

  return {
    id,
    sourceType: "library_file",
    sourceLabel: normalizeText(option?.sourceLabel) || "Biblioteca",
    resourcePublicId,
    filePublicId,
    fileName: normalizeText(option?.fileName) || "archivo",
    mimeType: normalizeText(option?.mimeType) || "application/octet-stream",
    byteSize: Number(option?.byteSize || 0),
    title: normalizeText(option?.title),
    summary: normalizeText(option?.summary),
    assetTypeLabel: normalizeText(option?.assetTypeLabel),
    selectionSource: selectionSource === "ai" ? "library_ai" : "library_manual",
  };
}

export default function OpportunityDevelopmentPanel({
  editingOpportunityId,
  form,
  setForm,
  commercialContext,
  opportunityDocuments,
  currentCommercialStage,
  loadingCommercialStageView,
  isCommercialFlowClosed,
  refreshCommercialContext,
  updateCommercialAnswer,
  updateOpportunityAmountFromCoach,
  selectedOpportunityContact,
  selectedOpportunityContactEmail,
  contactOptions,
  accountName,
  sellerUserEmail,
  canExecuteOperations,
  showOpportunityCoach = true,
}) {
  const [quotations, setQuotations] = useState([]);
  const [interactions, setInteractions] = useState([]);
  const [executionDependencies, setExecutionDependencies] = useState([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const [aiNarrative, setAiNarrative] = useState({
    statusSummary: "",
    nextStepRecommendation: "",
    contract: null,
    source: "",
    generatedAt: null,
  });
  const [loadingAiNarrative, setLoadingAiNarrative] = useState(false);
  const [aiJobStatus, setAiJobStatus] = useState("pending");
  const [activityDraft, setActivityDraft] = useState({
    activityType: "call",
    objective: "",
    scheduledDate: "",
    scheduledTime: "09:00",
    note: "",
  });
  const [dependencyDraft, setDependencyDraft] = useState({
    dependencyType: "presales_support",
    title: "",
    dueDate: "",
    details: "",
  });
  const [savingExecutionItem, setSavingExecutionItem] = useState("");
  const [interactionNote, setInteractionNote] = useState("");
  const [chatMessages, setChatMessages] = useState([
    {
      id: "assistant-welcome",
      role: "assistant",
      text: "Estoy listo para ayudarte con esta oportunidad. Escribe lo que ocurrió y revisaré qué cambios proponer.",
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [interactionAnalysis, setInteractionAnalysis] = useState(null);
  const [interactionApprovalDraft, setInteractionApprovalDraft] = useState({
    draftId: "",
    status: "drafted",
    activityType: "call",
    objective: "",
    scheduledDate: "",
    scheduledTime: "09:00",
    note: "",
    nextStepTitle: "",
    nextStepDueDate: "",
    nextStepSuccessCriteria: "",
    proposals: [],
    summary: {
      title: "Resumen del cambio sugerido",
      message: "",
      warnings: [],
    },
    errors: [],
  });
  const [isInteractionApprovalOpen, setIsInteractionApprovalOpen] =
    useState(false);
  const [analyzingInteraction, setAnalyzingInteraction] = useState(false);
  const [interactionJobStatus, setInteractionJobStatus] = useState("");
  const [applyingInteraction, setApplyingInteraction] = useState(false);
  const [executionRefreshToken, setExecutionRefreshToken] = useState(0);
  const [localInteractionEntries, setLocalInteractionEntries] = useState([]);
  const [executionItemModal, setExecutionItemModal] = useState(null);
  const [executionItemUpdateDraft, setExecutionItemUpdateDraft] = useState({
    status: "done",
    objective: "",
    note: "",
    date: "",
    time: "09:00",
    result: "",
  });
  const [savingExecutionUpdate, setSavingExecutionUpdate] = useState(false);
  const [executionItemModalError, setExecutionItemModalError] = useState("");
  const [isDevelopmentExpanded, setIsDevelopmentExpanded] = useState(false);
  const [isExecutionExpanded, setIsExecutionExpanded] = useState(false);
  const [isOperationEmailModalOpen, setIsOperationEmailModalOpen] =
    useState(false);
  const [sendingOperationEmail, setSendingOperationEmail] = useState(false);
  const [operationEmailError, setOperationEmailError] = useState("");
  const [operationEmailNotice, setOperationEmailNotice] = useState("");
  const [operationLibraryError, setOperationLibraryError] = useState("");
  const [operationLibraryQuery, setOperationLibraryQuery] = useState("");
  const [operationLibraryOptions, setOperationLibraryOptions] = useState([]);
  const [
    operationSelectedLibraryAttachmentIds,
    setOperationSelectedLibraryAttachmentIds,
  ] = useState([]);
  const [operationAiInstructionText, setOperationAiInstructionText] =
    useState("");
  const [operationAiSuggestion, setOperationAiSuggestion] = useState({
    subject: "",
    messageBody: "",
    source: "",
    sourceReason: "",
  });
  const [loadingOperationLibraryOptions, setLoadingOperationLibraryOptions] =
    useState(false);
  const [generatingOperationAiDraft, setGeneratingOperationAiDraft] =
    useState(false);
  const [
    generatingOperationAiAttachments,
    setGeneratingOperationAiAttachments,
  ] = useState(false);
  const [operationEmailDraft, setOperationEmailDraft] = useState({
    actionId: null,
    recipient: "",
    cc: "",
    subject: "",
    messageBody: "",
    attachments: [],
  });
  const [operationGoogleMailStatus, setOperationGoogleMailStatus] = useState({
    loading: false,
    connected: false,
    canSend: false,
    missingScope: false,
    needsReconnect: false,
    googleEmail: "",
    startUrl: "/api/auth/google-mail/start",
  });

  function applyAiNarrativePayload(payload) {
    if (!payload) return;
    setAiNarrative({
      statusSummary: normalizeText(payload.aiStatusSummary),
      nextStepRecommendation: normalizeText(payload.aiNextStepRecommendation),
      contract:
        payload?.aiContract && typeof payload.aiContract === "object"
          ? payload.aiContract
          : null,
      source: normalizeText(payload.aiNarrativeSource) || "fallback",
      generatedAt:
        payload.generatedAt || payload.aiNarrativeGeneratedAt || null,
    });
  }

  const answers = Array.isArray(commercialContext?.answers)
    ? commercialContext.answers
    : [];
  const requiredAnswers = answers.filter((answer) => answer?.is_required);
  const answeredRequiredCount = requiredAnswers.filter(
    (answer) => !isStepAnswerMissing(answer),
  ).length;
  const missingRequiredAnswers = requiredAnswers.filter((answer) =>
    isStepAnswerMissing(answer),
  ).length;

  const documentsCount = Array.isArray(opportunityDocuments)
    ? opportunityDocuments.length
    : 0;
  const quotationsCount = Array.isArray(quotations) ? quotations.length : 0;
  const proposalSignalsCount = quotations.filter((quotation) =>
    normalizeText(quotation?.latestProposalName),
  ).length;
  const interactionsCount = Array.isArray(interactions)
    ? interactions.length
    : 0;
  const notesCount = interactions.filter(
    (item) => normalizeText(item?.summary) || normalizeText(item?.title),
  ).length;
  const contactsCount = form?.contactId ? 1 : 0;

  const riskItems = useMemo(() => {
    const items = [];

    if (!documentsCount) {
      items.push({
        key: "risk-documents",
        title: "Sin evidencia documental",
        severity: "Alta",
        mitigation:
          "Subir documento clave del requerimiento o contexto cliente.",
      });
    }
    if (missingRequiredAnswers > 0) {
      items.push({
        key: "risk-answers",
        title: "Respuestas obligatorias incompletas",
        severity: "Alta",
        mitigation:
          "Completar respuestas de etapa para habilitar movimiento comercial.",
      });
    }
    if (!quotationsCount) {
      items.push({
        key: "risk-quotation",
        title: "Sin cotizacion vinculada",
        severity: "Media",
        mitigation:
          "Preparar una cotizacion inicial para avanzar con decision de compra.",
      });
    }
    if (!contactsCount) {
      items.push({
        key: "risk-contact",
        title: "Sin contacto principal",
        severity: "Alta",
        mitigation: "Definir el contacto decisor o influenciador principal.",
      });
    }
    if (
      form?.closeDate &&
      isDateInPast(form.closeDate) &&
      !isCommercialFlowClosed
    ) {
      items.push({
        key: "risk-close-date",
        title: "Fecha objetivo vencida",
        severity: "Media",
        mitigation:
          "Recalibrar fecha de cierre y compromisos del plan inmediato.",
      });
    }

    return items;
  }, [
    documentsCount,
    missingRequiredAnswers,
    quotationsCount,
    contactsCount,
    form?.closeDate,
    isCommercialFlowClosed,
  ]);

  const checkpoint = useMemo(() => {
    const notReadyReasons = [];

    if (!documentsCount) {
      notReadyReasons.push("Cargar evidencia documental minima.");
    }
    if (missingRequiredAnswers > 0) {
      notReadyReasons.push("Completar respuestas obligatorias de etapa.");
    }
    if (!contactsCount) {
      notReadyReasons.push("Definir contacto principal para decision.");
    }

    const stageReadiness = notReadyReasons.length
      ? "not_ready"
      : quotationsCount
        ? "ready"
        : "caution";

    return {
      stageReadiness,
      stageLabel:
        stageReadiness === "ready"
          ? "Lista para avanzar"
          : stageReadiness === "caution"
            ? "Avance con reservas"
            : "Aun no lista",
      reasons: notReadyReasons,
    };
  }, [documentsCount, missingRequiredAnswers, contactsCount, quotationsCount]);

  const aiCommercialBlueprint = useMemo(() => {
    const narrativeContract =
      aiNarrative.contract && typeof aiNarrative.contract === "object"
        ? aiNarrative.contract
        : {};
    const descriptionSituation =
      narrativeContract.descriptionSituation &&
      typeof narrativeContract.descriptionSituation === "object"
        ? narrativeContract.descriptionSituation
        : {};
    const salesStrategy =
      narrativeContract.salesStrategy &&
      typeof narrativeContract.salesStrategy === "object"
        ? narrativeContract.salesStrategy
        : {};
    const nextBestStep =
      narrativeContract.nextBestStep &&
      typeof narrativeContract.nextBestStep === "object"
        ? narrativeContract.nextBestStep
        : {};
    const alternativeStep =
      narrativeContract.alternativeStep &&
      typeof narrativeContract.alternativeStep === "object"
        ? narrativeContract.alternativeStep
        : {};
    const opportunityName =
      normalizeText(form?.name) || "Oportunidad comercial";
    const accountName =
      normalizeText(form?.accountName) || "Cuenta no definida";
    const sellerName =
      normalizeText(form?.sellerUserName) ||
      normalizeText(form?.sellerName) ||
      "Sin vendedor asignado";
    const amountLabel = normalizeText(form?.amountUsd)
      ? `${normalizeText(form?.amountUsd)} USD`
      : "Importe pendiente";
    const closeDateLabel = toDateOnly(form?.closeDate) || "Sin fecha";
    const commitmentLabel =
      closeDateLabel === "Sin fecha"
        ? "Dentro de las proximas 72 horas"
        : `${closeDateLabel} 09:00`;
    const stageLabel =
      currentCommercialStage?.name ||
      commercialContext?.salesStage?.name ||
      "Sin etapa";
    const bloqueoPrincipal =
      normalizeText(descriptionSituation.commercialSituation) ||
      normalizeText(aiNarrative.statusSummary) ||
      "No hay lectura operativa suficiente para explicar el bloqueo principal.";
    const accion72 =
      normalizeText(nextBestStep.exactStep) ||
      normalizeText(aiNarrative.nextStepRecommendation) ||
      "Programar una conversacion ejecutiva con decisor para acordar siguiente hito de compra.";
    const resultadoEsperado =
      normalizeText(nextBestStep.expectedResult) ||
      normalizeText(aiNarrative.nextStepRecommendation) ||
      "Asegurar un compromiso verificable del cliente para mover la oportunidad.";
    const canal = interactionsCount > 0 ? "Reunion" : "Llamada";
    const evidenciaCierre =
      "Nota de interaccion, compromiso del cliente y fecha del siguiente hito registrados en CRM.";
    const criterioBinario =
      normalizeText(nextBestStep.successCriteria) ||
      "Si/No: existe compromiso confirmado con decisor y fecha definida.";
    const activityCandidates = [
      ...interactions.map((item) =>
        parseActivityTimestamp(
          item?.updatedAt || item?.createdAt || item?.occurredAt || item?.date,
        ),
      ),
      ...opportunityDocuments.map((document) =>
        parseActivityTimestamp(document?.createdAt || document?.updatedAt),
      ),
    ].filter(Number.isFinite);
    const latestActivityMs = activityCandidates.length
      ? Math.max(...activityCandidates)
      : Number.NaN;
    const latestActivityDate = Number.isFinite(latestActivityMs)
      ? new Date(latestActivityMs)
      : null;
    const daysWithoutMovement = latestActivityDate
      ? Math.max(
          0,
          Math.floor((Date.now() - latestActivityDate.getTime()) / 86400000),
        )
      : 15;
    const latestActivityLabel = latestActivityDate
      ? formatActivityTimestamp(latestActivityDate)
      : "Sin actividad reciente";
    const hasRecentEvidence =
      interactionsCount > 0 ||
      documentsCount > 0 ||
      Number.isFinite(latestActivityMs);

    const messageTarget =
      accountName === "Cuenta no definida"
        ? "su equipo"
        : `el equipo de ${accountName}`;
    const mensajeSugerido = `Hola, para avanzar esta oportunidad con ${messageTarget} propongo una sesion de 30 minutos para validar criterios de decision, alcance final y fecha de cierre. El objetivo es salir con un compromiso concreto y proximo paso calendarizado.`;

    const miniObjetivoEtapa =
      normalizeText(salesStrategy.stageAdvanceCriteria) ||
      (checkpoint.stageLabel === "Aun no lista"
        ? "Eliminar bloqueadores criticos y recuperar conduccion comercial de la etapa actual."
        : "Convertir interes en compromiso comercial verificable de la etapa actual.");
    const planB72 =
      normalizeText(
        [
          normalizeText(alternativeStep.fallbackStep),
          normalizeText(alternativeStep.trigger)
            ? `Trigger: ${normalizeText(alternativeStep.trigger)}`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      ) ||
      "Si no hay respuesta en 72 horas, escalar con resumen ejecutivo, nueva propuesta de valor y fecha alternativa de decision.";

    const confidence =
      normalizeText(aiNarrative.source).toLowerCase() === "openai"
        ? "Media"
        : "Baja";

    const qualityChecks = [
      {
        id: "q1",
        text: "La accion define verbo, responsable y fecha",
        ok: Boolean(
          normalizeText(aiNarrative.nextStepRecommendation) &&
          sellerName &&
          commitmentLabel,
        ),
      },
      {
        id: "q2",
        text: "Se sustenta en evidencia reciente y verificable",
        ok: Boolean(
          normalizeText(aiNarrative.statusSummary) && hasRecentEvidence,
        ),
      },
      {
        id: "q3",
        text: "Mueve la etapa actual de forma explicita",
        ok: Boolean(
          stageLabel && normalizeText(aiNarrative.nextStepRecommendation),
        ),
      },
      {
        id: "q4",
        text: "Incluye mensaje ejecutable para cliente",
        ok: Boolean(mensajeSugerido),
      },
      {
        id: "q5",
        text: "Define criterio de exito binario",
        ok: Boolean(criterioBinario),
      },
      {
        id: "q6",
        text: "Incluye plan alterno (Plan B)",
        ok: Boolean(planB72),
      },
      {
        id: "q7",
        text: "Considera decisores reales del proceso",
        ok: Boolean(contactsCount > 0),
      },
      {
        id: "q8",
        text: "Es ejecutable en menos de 72 horas",
        ok: Boolean(normalizeText(aiNarrative.nextStepRecommendation)),
      },
    ];

    const qualityScore = qualityChecks.filter((item) => item.ok).length;
    const semaforoLabel =
      qualityScore >= 7 &&
      normalizeText(aiNarrative.source).toLowerCase() === "openai"
        ? "Verde"
        : qualityScore >= 6
          ? "Amarillo"
          : "Rojo";
    const qualityStatus = qualityScore >= 6 ? "Publicable" : "Requiere ajuste";
    const detailRisk1 =
      riskItems[0]?.title ||
      "Sin seguimiento operativo visible en la oportunidad";
    const detailRisk2 =
      riskItems[1]?.title ||
      "Compromiso comercial insuficiente para sostener avance";

    return {
      short: {
        opportunityName,
        stageLabel,
        semaforoLabel,
        daysWithoutMovement: `${daysWithoutMovement}`,
        bloqueoPrincipal,
        accion72,
        sellerName,
        commitmentLabel,
        canal,
        mensajeSugerido,
        resultadoEsperado,
        criterioBinario,
        evidenciaCierre,
        miniObjetivoEtapa,
        planB72,
        qualityScore,
        qualityStatus,
      },
      detail: {
        opportunityName,
        accountName,
        sellerName,
        stageLabel,
        amountLabel,
        closeDateLabel,
        commercialStatus: checkpoint.stageLabel,
        latestActivity: latestActivityLabel,
        daysWithoutMovement: `${daysWithoutMovement}`,
        situationCustomerGoal:
          normalizeText(descriptionSituation.customerGoal) ||
          "No se detallo explicitamente que busca el cliente.",
        situationWhyNeedNow:
          normalizeText(descriptionSituation.whyNeedNow) ||
          "No se detallo explicitamente por que lo necesita ahora.",
        situationTargetTimeline:
          normalizeText(descriptionSituation.targetTimeline) ||
          "No se detallo explicitamente el horizonte de compra/implementacion.",
        situationWhatWeHaveDone:
          normalizeText(descriptionSituation.whatWeHaveDone) ||
          "No se detallo explicitamente lo ejecutado hasta ahora.",
        bloqueoPrincipal,
        evidencia1: bloqueoPrincipal,
        evidencia2:
          normalizeText(descriptionSituation.whatWeHaveDone) ||
          normalizeText(aiNarrative.nextStepRecommendation) ||
          "No existe recomendacion puntual cargada.",
        evidencia3:
          normalizeText(descriptionSituation.targetTimeline) ||
          riskItems[0]?.mitigation ||
          "Sin mitigacion registrada en este momento.",
        confidence,
        missingData:
          normalizeText(descriptionSituation.whyNeedNow) ||
          (contactsCount > 0
            ? "Falta consolidar evidencia de decision economica final."
            : "Falta definir contacto decisor principal."),
        accion72,
        resultadoEsperado,
        commitmentLabel,
        canal,
        mensajeSugerido,
        evidenciaCierre,
        criterioBinario,
        miniObjetivoEtapa,
        estrategia:
          normalizeText(salesStrategy.strategyToWin) ||
          "Asegurar compromiso de decision con valor de negocio explicito y fecha cerrada.",
        strategyByStage:
          normalizeText(salesStrategy.stageAlignedActions) ||
          "Sin detalle por etapa.",
        strategyExpectedResults:
          normalizeText(salesStrategy.expectedResultsByAction) ||
          "Sin resultados esperados por accion.",
        strategyRisksMitigation:
          normalizeText(salesStrategy.strategyRisksAndMitigation) ||
          "Sin riesgos y mitigaciones detallados.",
        strategyAdvanceCriteria:
          normalizeText(salesStrategy.stageAdvanceCriteria) ||
          "Sin criterio explicito de avance de etapa.",
        nextWhyThisStep:
          normalizeText(nextBestStep.whyThisStep) ||
          "No se indico explicitamente por que este es el mejor paso.",
        day0: accion72,
        day2:
          normalizeText(salesStrategy.stageAlignedActions) ||
          "Enviar resumen ejecutivo de acuerdos, riesgos y responsables de siguiente hito.",
        day5:
          normalizeText(salesStrategy.expectedResultsByAction) ||
          "Validar avance con decisor economico y remover objecion principal pendiente.",
        day10:
          normalizeText(salesStrategy.strategyRisksAndMitigation) ||
          "Cerrar decision o redefinir alcance/comercial para evitar estancamiento.",
        valueLever:
          "Impacto de negocio y costo de no decidir en el periodo objetivo.",
        mainObjection:
          "Prioridad interna o presupuesto en revision al momento de decidir.",
        objectionResponse:
          "Plantear escenario por fases con hitos claros para reducir riesgo y acelerar aprobacion.",
        sponsor:
          contactsCount > 0
            ? "Contacto principal asignado"
            : "Pendiente de confirmar",
        economicDecider:
          contactsCount > 0
            ? "Identificado en proceso comercial"
            : "Pendiente de confirmar",
        legalProcurement: "Pendiente de involucramiento formal",
        technicalInfluencer: "Pendiente de validacion tecnica",
        risk1: detailRisk1,
        risk1Probability: "Alta",
        risk1Impact: "Alto",
        risk1Mitigation:
          riskItems[0]?.mitigation ||
          "Definir accion concreta con fecha y responsable.",
        risk2: detailRisk2,
        risk2Probability: "Media",
        risk2Impact: "Medio",
        risk2Mitigation:
          riskItems[1]?.mitigation ||
          "Escalar decision con resumen ejecutivo y evidencia.",
        planB72,
        alternativeTrigger:
          normalizeText(alternativeStep.trigger) ||
          "No se definio trigger explicito para activar plan alterno.",
        alternativeExpectedResult:
          normalizeText(alternativeStep.expectedResult) ||
          "No se definio resultado esperado del paso alternativo.",
        alternativeReturnCriteria:
          normalizeText(alternativeStep.returnCriteria) ||
          "No se definio criterio de retorno al plan principal.",
        planBRejected:
          normalizeText(alternativeStep.returnCriteria) ||
          "Reformular propuesta por valor y fases para reducir friccion de aprobacion.",
        disqualificationSignal:
          "Sin decisor, sin siguiente paso y sin respuesta despues de dos ciclos ejecutivos.",
        internalDeadline: closeDateLabel,
        activityKpi:
          "Al menos una interaccion ejecutiva registrada por semana.",
        decisionKpi: "Compromiso de decision con fecha confirmada.",
        qualityKpi: "Resumen de valor y objeciones actualizado en cada hito.",
        weeklyTrafficLight: semaforoLabel,
        nextReview: closeDateLabel,
        qualityChecks,
        qualityScore,
        qualityStatus,
      },
    };
  }, [
    aiNarrative.contract,
    aiNarrative.statusSummary,
    aiNarrative.nextStepRecommendation,
    aiNarrative.source,
    checkpoint.stageLabel,
    commercialContext?.salesStage?.name,
    contactsCount,
    currentCommercialStage?.name,
    form?.accountName,
    form?.amountUsd,
    form?.closeDate,
    form?.name,
    form?.ownerName,
    form?.sellerName,
    form?.sellerUserName,
    interactions,
    interactionsCount,
    opportunityDocuments,
    riskItems,
  ]);

  const workspaceActions = Array.isArray(commercialContext?.workspace?.actions)
    ? commercialContext.workspace.actions
    : [];
  const visibleWorkspaceActions = [
    ...localInteractionEntries,
    ...workspaceActions.filter(
      (item) => !localInteractionEntries.some((local) => Number(local.id) === Number(item.id)),
    ),
  ];
  const previousActivities = visibleWorkspaceActions
    .filter((item) => getWorkspaceEntryKind(item) === "activity")
    .sort((left, right) => {
      const leftDate = new Date(
        left?.scheduledAt ||
          left?.dueDate ||
          left?.updatedAt ||
          left?.createdAt ||
          0,
      ).getTime();
      const rightDate = new Date(
        right?.scheduledAt ||
          right?.dueDate ||
          right?.updatedAt ||
          right?.createdAt ||
          0,
      ).getTime();
      return rightDate - leftDate;
    });
  const operationActions = visibleWorkspaceActions
    .filter(
      (item) =>
        getWorkspaceEntryKind(item) === "action" &&
        normalizeText(item?.actionType).toLowerCase() === "send_email",
    )
    .sort((left, right) => {
      const leftDate = new Date(
        left?.updatedAt || left?.createdAt || left?.dueDate || 0,
      ).getTime();
      const rightDate = new Date(
        right?.updatedAt || right?.createdAt || right?.dueDate || 0,
      ).getTime();
      return rightDate - leftDate;
    });
  const executionSummary = {
    activities: previousActivities.length,
    dependencies: executionDependencies.length,
    operations: operationActions.length,
  };
  const isExecutionItemReadOnly = isExecutionItemClosed(
    executionItemModal?.item?.status,
  );

  const resolvedOperationContact = selectedOpportunityContact;
  const operationRecipientEmail = normalizeText(
    selectedOpportunityContactEmail || "",
  );
  const selectedOperationLibraryAttachments = useMemo(() => {
    const attachments = Array.isArray(operationEmailDraft.attachments)
      ? operationEmailDraft.attachments
      : [];
    const selectedIds = Array.isArray(operationSelectedLibraryAttachmentIds)
      ? operationSelectedLibraryAttachmentIds
      : [];
    return attachments
      .filter(
        (attachment) =>
          attachment?.sourceType === "library_file" &&
          selectedIds.includes(attachment?.id),
      )
      .filter(Boolean);
  }, [operationEmailDraft.attachments, operationSelectedLibraryAttachmentIds]);
  const canOpenSendEmailOperation =
    Boolean(canExecuteOperations) && Boolean(operationRecipientEmail);

  useEffect(() => {
    if (!editingOpportunityId) {
      setActivityDraft({
        activityType: "call",
        objective: "",
        scheduledDate: "",
        scheduledTime: "09:00",
        note: "",
      });
      setDependencyDraft({
        dependencyType: "presales_support",
        title: "",
        dueDate: "",
        details: "",
      });
      return;
    }

    const defaultDate = new Date(Date.now() + 2 * 86400000);
    const defaultDateOnly = defaultDate.toISOString().slice(0, 10);
    const defaultDateTime = toDateTimeLocalInputValue(
      defaultDate.toISOString(),
    );
    const defaultTime = defaultDateTime ? defaultDateTime.slice(11, 16) : "09:00";

    setActivityDraft({
      activityType: "call",
      objective: "",
      scheduledDate: defaultDateOnly,
      scheduledTime: defaultTime,
      note: "",
    });
    setDependencyDraft({
      dependencyType: "presales_support",
      title: "",
      dueDate: defaultDateOnly,
      details: "",
    });
  }, [editingOpportunityId]);

  useEffect(() => {
    if (!editingOpportunityId) {
      setQuotations([]);
      setInteractions([]);
      setExecutionDependencies([]);
      setSourceError("");
      return;
    }

    let ignore = false;
    setLoadingSources(true);
    setSourceError("");

    Promise.all([
      api.get(`/api/opportunities/${editingOpportunityId}/quotations`),
      api.get(`/api/interactions?page=1&pageSize=50`),
      api.get(
        "/api/execution-commercial/dashboard?includeClosedDependencies=1",
      ),
    ])
      .then(([quotationResponse, interactionResponse, dashboardResponse]) => {
        if (ignore) return;

        const quotationItems = Array.isArray(quotationResponse?.data)
          ? quotationResponse.data
          : [];
        const interactionItems = Array.isArray(interactionResponse?.data?.items)
          ? interactionResponse.data.items.filter(
              (item) =>
                Number(item?.primaryOpportunityId || 0) ===
                Number(editingOpportunityId),
            )
          : [];

        setQuotations(quotationItems);
        setInteractions(interactionItems);
        const workboard = Array.isArray(dashboardResponse?.data?.workboard)
          ? dashboardResponse.data.workboard
          : [];
        const currentItem = workboard.find(
          (item) => Number(item?.id || 0) === Number(editingOpportunityId),
        );
        setExecutionDependencies(
          Array.isArray(currentItem?.dependencies)
            ? currentItem.dependencies
            : [],
        );
      })
      .catch((error) => {
        if (ignore) return;
        setSourceError(
          getApiErrorMessage(
            error,
            "No fue posible cargar todas las fuentes del desarrollo",
          ),
        );
      })
      .finally(() => {
        if (!ignore) {
          setLoadingSources(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [editingOpportunityId, executionRefreshToken]);

  useEffect(() => {
    setIsDevelopmentExpanded(false);
    setIsExecutionExpanded(false);
  }, [editingOpportunityId]);

  useEffect(() => {
    if (!isOperationEmailModalOpen || !editingOpportunityId) return;

    const timeoutId = window.setTimeout(() => {
      void loadOperationEmailAttachmentOptions({
        query: operationLibraryQuery,
      });
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [editingOpportunityId, isOperationEmailModalOpen, operationLibraryQuery]);

  async function refreshExecutionSection() {
    if (typeof refreshCommercialContext === "function") {
      await refreshCommercialContext();
    }
    setExecutionRefreshToken((current) => current + 1);
  }

  function openExecutionItemModal(itemType, item) {
    const itemDetails =
      item?.details && typeof item.details === "object" ? item.details : {};
    const currentStatus = normalizeText(item?.status).toLowerCase();
    const defaultStatus =
      currentStatus === "done"
        ? "done"
        : currentStatus === "cancelled" || currentStatus === "blocked"
          ? "cancelled"
          : "pending";
    const existingResult =
      itemType === "dependency"
        ? normalizeText(item?.resolutionNote)
        : normalizeText(itemDetails?.result);
    const existingObjective = normalizeText(item?.title);
    const existingNote =
      itemType === "dependency"
        ? normalizeText(item?.details)
        : normalizeText(item?.notes || item?.note);
    const existingDateTimeLocal =
      itemType === "dependency"
        ? ""
        : toDateTimeLocalInputValue(
            item?.scheduledAt ||
              (toDateOnly(item?.dueDate)
                ? `${toDateOnly(item?.dueDate)}T09:00`
                : ""),
          );
    const existingDate =
      itemType === "dependency"
        ? toDateOnly(item?.dueDate)
        : existingDateTimeLocal
          ? existingDateTimeLocal.slice(0, 10)
          : toDateOnly(item?.dueDate);
    const existingTime =
      itemType === "dependency"
        ? "09:00"
        : existingDateTimeLocal
          ? existingDateTimeLocal.slice(11, 16)
          : "09:00";

    setExecutionItemModal({
      itemType,
      item,
    });
    setExecutionItemUpdateDraft({
      status: defaultStatus,
      objective: existingObjective,
      note: existingNote,
      date: existingDate,
      time: existingTime,
      result: existingResult,
    });
    setExecutionItemModalError("");
  }

  function closeExecutionItemModal() {
    setExecutionItemModal(null);
    setExecutionItemModalError("");
  }

  async function handleSelectExecutionDoneStatus() {
    if (isExecutionItemReadOnly) return;
    if (savingExecutionUpdate) return;
    const result = normalizeText(executionItemUpdateDraft.result);
    if (!result) {
      setExecutionItemModalError(
        "Debes indicar un resultado antes de declarar la actividad realizada.",
      );
      return;
    }

    const shouldConfirmDone = window.confirm(
      "Al declarar la actividad como realizada, ya no se podra modificar. ¿Deseas continuar?",
    );
    if (!shouldConfirmDone) {
      return;
    }

    setExecutionItemUpdateDraft((current) => ({
      ...current,
      status: "done",
    }));
    setExecutionItemModalError("");
    await handleSaveExecutionItemUpdate("done");
  }

  async function handleSelectExecutionCancelledStatus() {
    if (isExecutionItemReadOnly) return;
    if (savingExecutionUpdate) return;

    const shouldConfirmCancelled = window.confirm(
      "Al cancelar la actividad, ya no se podra modificar. ¿Deseas continuar?",
    );
    if (!shouldConfirmCancelled) {
      return;
    }

    setExecutionItemUpdateDraft((current) => ({
      ...current,
      status: "cancelled",
    }));
    setExecutionItemModalError("");
    await handleSaveExecutionItemUpdate("cancelled");
  }

  async function handleSaveExecutionItemUpdate(statusOverride) {
    if (!editingOpportunityId || !executionItemModal?.item) return;
    if (isExecutionItemReadOnly) return;

    const isDependencyItem = executionItemModal.itemType === "dependency";
    const currentStatus = normalizeText(
      executionItemModal?.item?.status,
    ).toLowerCase();
    const objective = normalizeText(executionItemUpdateDraft.objective);
    const note = normalizeText(executionItemUpdateDraft.note);
    const datePart = normalizeText(executionItemUpdateDraft.date);
    const timePart = normalizeText(executionItemUpdateDraft.time);
    const dateValue = isDependencyItem
      ? datePart
      : datePart && timePart
        ? `${datePart}T${timePart}`
        : "";
    const selectedStatus = normalizeText(
      statusOverride ?? executionItemUpdateDraft.status,
    ).toLowerCase();
    const isDeclaringAsDone =
      selectedStatus === "done" && currentStatus !== "done";
    const result = normalizeText(executionItemUpdateDraft.result);
    if (!objective) {
      setExecutionItemModalError("Debes indicar el objetivo.");
      return;
    }
    if (!dateValue) {
      setExecutionItemModalError(
        isDependencyItem
          ? "Debes indicar la fecha."
          : "Debes indicar fecha y hora.",
      );
      return;
    }
    if (isDeclaringAsDone && !result) {
      setExecutionItemModalError(
        "Debes indicar un resultado antes de declarar la actividad realizada.",
      );
      return;
    }

    const { itemType, item } = executionItemModal;
    setSavingExecutionUpdate(true);
    setExecutionItemModalError("");
    setSourceError("");
    try {
      if (itemType === "dependency") {
        const dependencyStatus =
          selectedStatus === "cancelled"
            ? "blocked"
            : selectedStatus === "done"
              ? "done"
              : currentStatus === "blocked"
                ? "blocked"
                : currentStatus === "done"
                  ? "done"
                  : "open";
        await api.patch(`/api/execution-commercial/dependencies/${item.id}`, {
          status: dependencyStatus,
          title: objective,
          dueDate: toDateOnly(datePart),
          details: note,
          resolutionNote: result || null,
        });
      } else {
        const isCallAction =
          itemType === "action" &&
          normalizeText(item?.actionType).toLowerCase() === "call";
        const entryKindForSave = isCallAction ? "activity" : itemType;
        const existingDetails =
          item?.details && typeof item.details === "object" ? item.details : {};
        const nextActivityStatus =
          selectedStatus === "done"
            ? "done"
            : selectedStatus === "cancelled"
              ? "cancelled"
              : currentStatus || "pending";
        const payload = {
          entryKind: entryKindForSave,
          activityType: normalizeText(item?.actionType) || "follow_up",
          objective,
          status: nextActivityStatus,
          note,
          details: {
            ...existingDetails,
            entryKind: itemType,
            result,
          },
        };
        if (entryKindForSave === "activity") {
          payload.scheduledAt = dateValue;
        } else {
          payload.dueDate = toDateOnly(datePart);
        }
        await api.patch(
          `/api/execution-commercial/opportunities/${editingOpportunityId}/activities/${item.id}`,
          payload,
        );
      }

      await refreshExecutionSection();
      closeExecutionItemModal();
    } catch (error) {
      setExecutionItemModalError(
        getApiErrorMessage(error, "No fue posible actualizar el registro"),
      );
    } finally {
      setSavingExecutionUpdate(false);
    }
  }

  async function handleCreateActivity() {
    if (!editingOpportunityId) return;

    const scheduledDate = normalizeText(activityDraft.scheduledDate);
    const scheduledTime = normalizeText(activityDraft.scheduledTime);
    const scheduledAt =
      scheduledDate && scheduledTime
        ? `${scheduledDate}T${scheduledTime}`
        : "";

    if (!scheduledAt) {
      setSourceError("Debes indicar fecha y hora para agendar la actividad.");
      return;
    }

    setSavingExecutionItem("activity");
    setSourceError("");
    try {
      await api.post(
        `/api/execution-commercial/opportunities/${editingOpportunityId}/activities`,
        {
          entryKind: "activity",
          activityType: activityDraft.activityType,
          objective: activityDraft.objective,
          scheduledAt,
          note: activityDraft.note,
          details: {
            entryKind: "activity",
          },
        },
      );
      await refreshExecutionSection();
    } catch (error) {
      setSourceError(
        getApiErrorMessage(error, "No fue posible guardar la actividad"),
      );
    } finally {
      setSavingExecutionItem("");
    }
  }

  function buildInteractionApprovalDraftFromAnalysis(result, fallbackNote = interactionNote) {
    return buildStructuredInteractionDraft(
      result,
      fallbackNote,
      answers,
      currentCommercialStage?.name || commercialContext?.salesStage?.name || "",
      form?.amountUsd,
    );
  }

  function appendChatMessage(role, text) {
    const messageText = normalizeText(text);
    if (!messageText) return;
    setChatMessages((current) => [
      ...current,
      {
        id: `${role}-${Date.now()}-${Math.random()}`,
        role,
        text: messageText,
      },
    ]);
  }

  async function analyzeInteractionConversation(sourceText = interactionNote) {
    const nextNote = normalizeText(sourceText);
    if (!editingOpportunityId || !nextNote) return;

    setAnalyzingInteraction(true);
    setInteractionJobStatus("pending");
    setSourceError("");

    try {
      const queued = await api.post("/api/mi-agent/interaction/analyze", {
        opportunityId: Number(editingOpportunityId),
        note: nextNote,
        stageQuestions: answers.map((answer) => ({
          questionId: Number(answer?.question_id || 0),
          questionPrompt: normalizeText(answer?.prompt),
          answerValue: normalizeText(answer?.answer_value),
          required: Boolean(answer?.is_required),
          stageName: normalizeText(currentCommercialStage?.name || commercialContext?.salesStage?.name),
        })),
      });
      const jobId = Number(queued.data?.job?.id || 0);
      if (!jobId) throw new Error("No se pudo iniciar el análisis de la conversación");

      let result = null;
      for (;;) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        const response = await api.get(`/api/mi-agent/interaction/jobs/${jobId}`);
        const status = String(response.data?.job?.status || "");
        setInteractionJobStatus(status);
        if (status === "completed") {
          result = response.data.result;
          break;
        }
        if (status === "failed") {
          throw new Error(
            response.data.job.errorMessage ||
              "No fue posible analizar la conversación",
          );
        }
      }

      const normalizedResult = normalizeInteractionAnalysisResult(result);
      const nextDraft = buildInteractionApprovalDraftFromAnalysis(
        normalizedResult,
        nextNote,
      );
      setInteractionAnalysis(normalizedResult);
      setInteractionApprovalDraft(nextDraft);
      appendChatMessage(
        "assistant",
        nextDraft.summary?.message ||
          "He preparado una propuesta para revisarla y aprobarla.",
      );
    } catch (error) {
      appendChatMessage(
        "assistant",
        getApiErrorMessage(error, "No fue posible analizar la conversación"),
      );
      setSourceError(
        getApiErrorMessage(error, "No fue posible analizar la conversación"),
      );
    } finally {
      setAnalyzingInteraction(false);
      setInteractionJobStatus((current) => current || "completed");
    }
  }

  function toggleInteractionProposalSelected(proposalId, selected) {
    setInteractionApprovalDraft((current) => {
      if (!current?.proposals?.length) return current;
      return {
        ...current,
        proposals: current.proposals.map((proposal) =>
          proposal.proposalId === proposalId
            ? { ...proposal, selected }
            : proposal,
        ),
      };
    });
  }

  function editInteractionProposal(proposalId, field, value) {
    setInteractionApprovalDraft((current) => {
      if (!current?.proposals?.length) return current;
      return {
        ...current,
        proposals: current.proposals.map((proposal) => {
          if (proposal.proposalId !== proposalId) return proposal;
          const nextProposal = structuredClone(proposal);
          if (field.startsWith("fields.")) {
            const fieldPath = field.replace("fields.", "").split(".");
            let target = nextProposal.fields;
            for (let index = 0; index < fieldPath.length - 1; index += 1) {
              target = target[fieldPath[index]];
            }
            target[fieldPath[fieldPath.length - 1]] = value;
          }
          return {
            ...nextProposal,
            status: "edited",
          };
        }),
      };
    });
  }

  async function handleAnalyzeInteraction() {
    await analyzeInteractionConversation(interactionNote);
  }

  async function handleChatSubmit(event) {
    event.preventDefault();
    const nextNote = normalizeText(chatInput);
    if (!nextNote) return;

    setInteractionNote(nextNote);
    appendChatMessage("user", nextNote);
    setChatInput("");
    await analyzeInteractionConversation(nextNote);
  }

  async function handleApplyInteraction() {
    if (!editingOpportunityId || !interactionAnalysis) return;
    const selectedProposals = (interactionApprovalDraft.proposals || []).filter(
      (proposal) => proposal.selected,
    );
    if (!selectedProposals.length) {
      setSourceError("Debes seleccionar al menos un cambio antes de guardar.");
      return;
    }
    setApplyingInteraction(true);
    setSourceError("");
    try {
      const activityProposal = selectedProposals.find(
        (proposal) => proposal.kind === "activity",
      );
      const nextStepProposal = selectedProposals.find(
        (proposal) => proposal.kind === "next_step",
      );
      const stageAnswerProposal = selectedProposals.find(
        (proposal) => proposal.kind === "stage_answer",
      );
      const opportunityFieldProposal = selectedProposals.find(
        (proposal) => proposal.kind === "opportunity_field",
      );

      if (
        opportunityFieldProposal?.fields?.field === "amountUsd" &&
        typeof updateOpportunityAmountFromCoach === "function"
      ) {
        await updateOpportunityAmountFromCoach(
          opportunityFieldProposal.fields.value,
        );
      }

      const localEntries = [];
      if (activityProposal) {
        const scheduledDate = activityProposal.fields?.scheduledDate || "";
        const scheduledTime = activityProposal.fields?.scheduledTime || "09:00";
        const scheduledAt = scheduledDate && scheduledTime
          ? `${scheduledDate}T${scheduledTime}`
          : new Date().toISOString().slice(0, 16);
        const activityObjective = activityProposal.fields?.objective || "Actividad comercial";
        const activityNote = activityProposal.fields?.note || interactionNote;
        const activityStatus = inferInteractionActivityStatus({
          title: activityObjective,
          note: activityNote,
          result: interactionAnalysis.activity?.result || activityNote,
          scheduledDate,
        });
        const activityResponse = await api.post(`/api/opportunities/${editingOpportunityId}/workspace/actions`, {
          actionType: normalizeInteractionActivityType(activityProposal.fields?.activityType || "call"),
          title: activityObjective,
          status: activityStatus,
          priority: "medium",
          dueDate: scheduledAt.slice(0, 10),
          scheduledAt,
          notes: activityNote,
          successCriteria: "Resultado registrado desde la conversación.",
          ownerUserId: null,
        });
        localEntries.push({
          id: Number(activityResponse.data?.id || Date.now()),
          actionType: normalizeInteractionActivityType(activityProposal.fields?.activityType || "call"),
          status: activityStatus,
          title: activityObjective,
          notes: activityNote,
          dueDate: scheduledAt.slice(0, 10),
          scheduledAt,
          details: { entryKind: "activity", result: activityNote || "" },
          isPrimaryNextStep: false,
        });
      }
      if (nextStepProposal?.fields?.title || interactionApprovalDraft.nextStepTitle) {
        const nextStepTitle = nextStepProposal?.fields?.title || interactionApprovalDraft.nextStepTitle;
        const nextStepDueDate = nextStepProposal?.fields?.dueDate || interactionApprovalDraft.nextStepDueDate || null;
        const nextStepSuccessCriteria =
          nextStepProposal?.fields?.successCriteria ||
          interactionApprovalDraft.nextStepSuccessCriteria ||
          "Registrar compromiso del cliente.";
        const nextStepResponse = await api.post(`/api/opportunities/${editingOpportunityId}/workspace/actions`, {
          title: nextStepTitle,
          actionType: "next_step",
          status: "pending",
          priority: "high",
          dueDate: nextStepDueDate,
          successCriteria: nextStepSuccessCriteria,
          ownerUserId: null,
        });
        localEntries.push({
          id: Number(nextStepResponse.data?.id || Date.now() + 1),
          actionType: "next_step",
          status: "pending",
          title: nextStepTitle,
          dueDate: nextStepDueDate,
          successCriteria: nextStepSuccessCriteria,
          isPrimaryNextStep: true,
        });
      }
      setLocalInteractionEntries((current) => [...localEntries, ...current]);
      if (stageAnswerProposal) {
        const proposedAnswer = normalizeText(stageAnswerProposal.fields?.answerValue);
        const previousAnswer = normalizeText(stageAnswerProposal.fields?.previousAnswer);
        const answerMode = stageAnswerProposal.fields?.answerMode || "replace";
        const answerValue = answerMode === "append" && previousAnswer
          ? `${previousAnswer}\n${proposedAnswer}`
          : proposedAnswer;
        const stageAnswerPayload = {
          answers: [
            {
              questionId: Number(stageAnswerProposal.question?.id || 0),
              answerValue,
            },
          ],
        };
        if (Number(stageAnswerProposal.question?.id || 0) > 0) {
          await api.post(`/api/opportunities/${editingOpportunityId}/stage-answers`, stageAnswerPayload);
          if (typeof updateCommercialAnswer === "function") {
            updateCommercialAnswer(
              Number(stageAnswerProposal.question.id),
              answerValue,
            );
          }
        }
      }
      setInteractionAnalysis(null);
      setInteractionNote("");
      setIsInteractionApprovalOpen(false);
      setInteractionApprovalDraft({
        draftId: "",
        status: "drafted",
        activityType: "call",
        objective: "",
        scheduledDate: "",
        scheduledTime: "09:00",
        note: "",
        nextStepTitle: "",
        nextStepDueDate: "",
        nextStepSuccessCriteria: "",
        proposals: [],
        summary: {
          title: "Resumen del cambio sugerido",
          message: "",
          warnings: [],
        },
        errors: [],
      });
      await refreshExecutionSection();
    } catch (error) {
      setSourceError(getApiErrorMessage(error, "No fue posible aplicar los cambios"));
    } finally {
      setApplyingInteraction(false);
    }
  }

  async function handleCreateDependency() {
    if (!editingOpportunityId) return;

    setSavingExecutionItem("dependency");
    setSourceError("");
    try {
      await api.post(
        `/api/execution-commercial/opportunities/${editingOpportunityId}/dependencies`,
        {
          dependencyType: dependencyDraft.dependencyType,
          title: dependencyDraft.title,
          dueDate: dependencyDraft.dueDate,
          details: dependencyDraft.details,
        },
      );
      await refreshExecutionSection();
    } catch (error) {
      setSourceError(
        getApiErrorMessage(error, "No fue posible guardar la dependencia"),
      );
    } finally {
      setSavingExecutionItem("");
    }
  }

  function buildOperationEmailDefaultDraft() {
    const recipientName = normalizeText(
      resolvedOperationContact?.full_name ||
        resolvedOperationContact?.fullName ||
        "",
    );
    const sellerName = normalizeText(
      form?.sellerUserName || form?.sellerName || "",
    );
    const sellerEmail = normalizeText(sellerUserEmail);
    const safeAccountName = normalizeText(
      accountName || form?.accountName || "",
    );
    const greeting = recipientName ? `Hola ${recipientName},` : "Hola,";
    const sellerSignature = sellerName
      ? `\n\nSaludos,\n${sellerName}`
      : "\n\nSaludos.";

    return {
      actionId: null,
      recipient: operationRecipientEmail,
      cc: sellerEmail,
      subject: safeAccountName
        ? `Seguimiento comercial - ${safeAccountName}`
        : "Seguimiento comercial",
      messageBody: `${greeting}\n\nComparto este seguimiento para continuar con los siguientes pasos de la oportunidad.${sellerSignature}`,
      attachments: [],
    };
  }

  async function loadOperationGoogleMailStatus({ silent = false } = {}) {
    setOperationGoogleMailStatus((current) => ({
      ...current,
      loading: true,
    }));

    try {
      const { data } = await api.get("/api/auth/google-mail/status");
      const nextStatus = {
        loading: false,
        connected: Boolean(data?.connected),
        canSend: Boolean(data?.canSend),
        missingScope: Boolean(data?.missingScope),
        needsReconnect: Boolean(data?.needsReconnect),
        googleEmail: String(data?.googleEmail || ""),
        startUrl: String(data?.startUrl || "/api/auth/google-mail/start"),
      };
      setOperationGoogleMailStatus(nextStatus);

      if (!silent && !nextStatus.canSend) {
        setOperationEmailNotice(
          "Debes conectar Google para habilitar el envio de correos.",
        );
      }

      return nextStatus;
    } catch (error) {
      setOperationGoogleMailStatus({
        loading: false,
        connected: false,
        canSend: false,
        missingScope: false,
        needsReconnect: false,
        googleEmail: "",
        startUrl: "/api/auth/google-mail/start",
      });

      if (!silent) {
        setOperationEmailError(
          getApiErrorMessage(
            error,
            "No fue posible validar la conexion de Google.",
          ),
        );
      }

      return null;
    }
  }

  async function loadOperationEmailAttachmentOptions({ query = "" } = {}) {
    if (!editingOpportunityId) return;

    setLoadingOperationLibraryOptions(true);
    setOperationLibraryError("");

    try {
      const { data } = await api.get(
        `/api/execution-commercial/opportunities/${editingOpportunityId}/email-attachments/options`,
        {
          params: {
            q: normalizeText(query),
          },
        },
      );

      const nextOptions = (
        Array.isArray(data?.libraryFiles) ? data.libraryFiles : []
      )
        .map((item) => ({
          id: normalizeText(item?.id),
          sourceLabel: normalizeText(item?.sourceLabel) || "Biblioteca",
          resourcePublicId: normalizeText(item?.resourcePublicId),
          filePublicId: normalizeText(item?.filePublicId),
          fileName: normalizeText(item?.fileName),
          mimeType: normalizeText(item?.mimeType),
          byteSize: Number(item?.byteSize || 0),
          title: normalizeText(item?.title),
          summary: normalizeText(item?.summary),
          assetTypeLabel: normalizeText(item?.assetTypeLabel),
        }))
        .filter(
          (item) => item.id && item.resourcePublicId && item.filePublicId,
        );

      setOperationLibraryOptions(nextOptions);
    } catch (error) {
      setOperationLibraryError(
        getApiErrorMessage(
          error,
          "No fue posible cargar contenido de biblioteca comercial.",
        ),
      );
    } finally {
      setLoadingOperationLibraryOptions(false);
    }
  }

  function handleOperationAiInstructionChange(value) {
    setOperationAiInstructionText(value);
    setOperationEmailError("");
    setOperationEmailNotice("");
  }

  function handleOperationLibraryQueryChange(value) {
    setOperationLibraryQuery(value);
  }

  function handleToggleOperationLibraryAttachment(attachmentId) {
    const normalizedId = normalizeText(attachmentId);
    if (!normalizedId) return;

    const option = (
      Array.isArray(operationLibraryOptions) ? operationLibraryOptions : []
    ).find((asset) => asset.id === normalizedId);
    const mappedAttachment = mapLibraryOptionToEmailAttachment(
      option,
      "manual",
    );

    setOperationSelectedLibraryAttachmentIds((current) => {
      if (current.includes(normalizedId)) {
        setOperationEmailDraft((draftCurrent) => ({
          ...draftCurrent,
          attachments: (draftCurrent.attachments || []).filter(
            (attachment) => attachment.id !== normalizedId,
          ),
        }));
        return current.filter((id) => id !== normalizedId);
      }
      if (current.length >= OPERATION_EMAIL_MAX_LIBRARY_ASSETS) {
        setOperationEmailError(
          `Solo puedes seleccionar hasta ${OPERATION_EMAIL_MAX_LIBRARY_ASSETS} activos de biblioteca.`,
        );
        return current;
      }

      if (mappedAttachment) {
        setOperationEmailDraft((draftCurrent) => ({
          ...draftCurrent,
          attachments: [
            ...(draftCurrent.attachments || []).filter(
              (attachment) => attachment.id !== mappedAttachment.id,
            ),
            mappedAttachment,
          ],
        }));
      }

      return [...current, normalizedId];
    });

    setOperationEmailNotice("");
  }

  async function handleRequestOperationAiDraft() {
    if (!editingOpportunityId) return;

    setGeneratingOperationAiDraft(true);
    setOperationEmailError("");
    setOperationEmailNotice("");

    try {
      const recipient = normalizeText(operationRecipientEmail);
      const response = await api.post(
        `/api/execution-commercial/opportunities/${editingOpportunityId}/email-suggestion`,
        {
          details: {
            recipient,
            cc: normalizeText(operationEmailDraft.cc),
            subject: normalizeText(operationEmailDraft.subject),
            messageBody: normalizeText(operationEmailDraft.messageBody),
            purpose: "other",
            purposeOther: "operaciones",
            aiInstructionText: normalizeText(operationAiInstructionText),
            attachments: selectedOperationLibraryAttachments,
          },
        },
      );

      const suggestionSource = normalizeText(response?.data?.source);
      const suggestionReason = normalizeText(response?.data?.sourceReason);
      const usedAi = suggestionSource === "openai";

      const fallbackReasonMessage =
        suggestionReason === "missing_openai_api_key"
          ? "Fallback: falta configurar OPENAI_API_KEY."
          : suggestionReason === "ai_budget_exceeded"
            ? "Fallback: saldo IA insuficiente."
            : suggestionReason === "openai_request_failed"
              ? "Fallback: fallo la llamada a OpenAI."
              : suggestionReason
                ? "Fallback: error de generacion IA."
                : "Fallback aplicado por disponibilidad.";

      setOperationAiSuggestion({
        subject: normalizeText(response?.data?.subject),
        messageBody: normalizeText(response?.data?.messageBody),
        source: suggestionSource || "fallback",
        sourceReason: suggestionReason,
      });

      setOperationEmailNotice(
        usedAi ? "Sugerencia generada con IA." : fallbackReasonMessage,
      );
    } catch (error) {
      setOperationEmailError(
        getApiErrorMessage(error, "No fue posible generar el borrador con IA."),
      );
    } finally {
      setGeneratingOperationAiDraft(false);
    }
  }

  async function handleRequestOperationAiAttachments() {
    if (!editingOpportunityId) return;

    setGeneratingOperationAiAttachments(true);
    setOperationEmailError("");
    setOperationEmailNotice("");

    try {
      const response = await api.post(
        `/api/execution-commercial/opportunities/${editingOpportunityId}/email-attachment-suggestions`,
        {
          details: {
            aiInstructionText: normalizeText(operationAiInstructionText),
            attachments: selectedOperationLibraryAttachments,
          },
        },
      );

      const suggestionSource = normalizeText(response?.data?.source);
      const usedAi = suggestionSource === "openai";
      const suggestionLabel = usedAi ? "La IA" : "La heuristica";

      const suggestedOptions = (
        Array.isArray(response?.data?.suggestions)
          ? response.data.suggestions
          : []
      )
        .map((item) => ({
          id: normalizeText(item?.id),
          sourceLabel: normalizeText(item?.sourceLabel) || "Biblioteca",
          resourcePublicId: normalizeText(item?.resourcePublicId),
          filePublicId: normalizeText(item?.filePublicId),
          fileName: normalizeText(item?.fileName),
          mimeType: normalizeText(item?.mimeType),
          byteSize: Number(item?.byteSize || 0),
          title: normalizeText(item?.title),
          summary: normalizeText(item?.summary),
          assetTypeLabel: normalizeText(item?.assetTypeLabel),
        }))
        .filter((item) => item.id && item.resourcePublicId && item.filePublicId)
        .slice(0, OPERATION_EMAIL_MAX_LIBRARY_ASSETS);

      if (!suggestedOptions.length) {
        setOperationEmailNotice(
          `${suggestionLabel} no encontró adjuntos de biblioteca alineados a las instrucciones.`,
        );
        return;
      }

      const currentSelectedIds = Array.isArray(
        operationSelectedLibraryAttachmentIds,
      )
        ? operationSelectedLibraryAttachmentIds
        : [];
      const availableSlots = Math.max(
        OPERATION_EMAIL_MAX_LIBRARY_ASSETS - currentSelectedIds.length,
        0,
      );

      const suggestedAttachments = suggestedOptions
        .map((item) => mapLibraryOptionToEmailAttachment(item, "ai"))
        .filter(Boolean);
      const newSuggestedAttachments = suggestedAttachments
        .filter((attachment) => !currentSelectedIds.includes(attachment.id))
        .slice(0, availableSlots);

      if (!newSuggestedAttachments.length) {
        setOperationEmailNotice(
          `${suggestionLabel} no agregó nuevos adjuntos porque ya alcanzaste el limite o ya estaban seleccionados.`,
        );
        return;
      }

      setOperationSelectedLibraryAttachmentIds((current) =>
        Array.from(
          new Set([
            ...(Array.isArray(current) ? current : []),
            ...newSuggestedAttachments.map((attachment) => attachment.id),
          ]),
        ),
      );

      setOperationEmailDraft((current) => {
        const currentAttachments = Array.isArray(current.attachments)
          ? current.attachments
          : [];
        const mergedById = new Map(
          currentAttachments.map((attachment) => [attachment.id, attachment]),
        );

        newSuggestedAttachments.forEach((attachment) => {
          mergedById.set(attachment.id, attachment);
        });

        return {
          ...current,
          attachments: Array.from(mergedById.values()),
        };
      });

      setOperationEmailNotice(
        `${suggestionLabel} sugirio ${newSuggestedAttachments.length} adjunto(s) de biblioteca.`,
      );
    } catch (error) {
      setOperationEmailError(
        getApiErrorMessage(error, "No fue posible sugerir adjuntos con IA."),
      );
    } finally {
      setGeneratingOperationAiAttachments(false);
    }
  }

  async function handleOpenSendEmailOperation() {
    if (!editingOpportunityId || !canOpenSendEmailOperation) return;

    setOperationEmailDraft(buildOperationEmailDefaultDraft());
    setOperationEmailError("");
    setOperationEmailNotice("");
    setOperationLibraryError("");
    setOperationAiInstructionText("");
    setOperationAiSuggestion({
      subject: "",
      messageBody: "",
      source: "",
      sourceReason: "",
    });
    setGeneratingOperationAiAttachments(false);
    setOperationLibraryQuery("");
    setOperationSelectedLibraryAttachmentIds([]);
    setIsOperationEmailModalOpen(true);

    void loadOperationEmailAttachmentOptions({ query: "" });

    const googleStatus = await loadOperationGoogleMailStatus({ silent: true });
    if (!googleStatus?.canSend) {
      setOperationEmailNotice(
        "Conecta Google para habilitar el envio desde Operaciones.",
      );
    }
  }

  function handleCloseOperationEmailModal() {
    if (sendingOperationEmail || generatingOperationAiDraft) return;
    setIsOperationEmailModalOpen(false);
    setOperationEmailError("");
    setOperationEmailNotice("");
  }

  function handleUseOperationAiSuggestion() {
    const subject = normalizeText(operationAiSuggestion.subject);
    const messageBody = normalizeText(operationAiSuggestion.messageBody);
    if (!subject && !messageBody) return;

    setOperationEmailDraft((current) => ({
      ...current,
      subject: subject || current.subject,
      messageBody: messageBody || current.messageBody,
    }));
    setOperationEmailNotice("Sugerencia copiada al borrador.");
  }

  function handleOperationEmailFieldChange(field, value) {
    setOperationEmailDraft((current) => ({
      ...current,
      [field]: value,
    }));
    setOperationEmailError("");
    setOperationEmailNotice("");
  }

  async function handleConnectOperationGoogleMail() {
    if (typeof window === "undefined") return;

    const connectUrl =
      operationGoogleMailStatus.startUrl || "/api/auth/google-mail/start";
    const returnTo = window.location.href;
    try {
      const { data } = await api.get(connectUrl, {
        params: { returnTo, mode: "json" },
      });

      const oauthUrl = String(data?.url || "").trim();
      if (!oauthUrl) {
        setOperationEmailError(
          "No fue posible iniciar la conexion con Google.",
        );
        return;
      }

      window.location.assign(oauthUrl);
    } catch (error) {
      setOperationEmailError(
        getApiErrorMessage(
          error,
          "No fue posible iniciar la conexion con Google.",
        ),
      );
    }
  }

  function handleRemoveOperationEmailAttachment(attachmentId) {
    const normalizedId = normalizeText(attachmentId);
    setOperationEmailDraft((current) => ({
      ...current,
      attachments: (current.attachments || []).filter(
        (attachment) => attachment.id !== normalizedId,
      ),
    }));
    setOperationSelectedLibraryAttachmentIds((current) =>
      current.filter((id) => id !== normalizedId),
    );
    setOperationEmailError("");
    setOperationEmailNotice("");
  }

  async function handleAddOperationEmailAttachments(files) {
    if (!editingOpportunityId) return;

    const incomingFiles = Array.isArray(files) ? files : [];
    if (!incomingFiles.length) return;

    const currentAttachments = Array.isArray(operationEmailDraft.attachments)
      ? operationEmailDraft.attachments
      : [];
    if (currentAttachments.length + incomingFiles.length > 10) {
      setOperationEmailError("Solo puedes adjuntar hasta 10 archivos.");
      return;
    }

    try {
      const formData = new FormData();
      incomingFiles.forEach((file, index) => {
        formData.append(`file_${index}`, file, file.name);
      });
      const { data } = await api.post(
        `/api/opportunities/${editingOpportunityId}/documents`,
        formData,
      );

      const uploadedAttachments = (Array.isArray(data) ? data : [])
        .map((document) => mapDocumentToEmailAttachment(document))
        .filter(Boolean);

      setOperationEmailDraft((current) => ({
        ...current,
        attachments: [...(current.attachments || []), ...uploadedAttachments],
      }));

      setOperationEmailError("");
      setOperationEmailNotice("");
      await refreshExecutionSection();
    } catch (error) {
      setOperationEmailError(
        getApiErrorMessage(
          error,
          "No fue posible cargar el archivo para adjuntarlo.",
        ),
      );
    }
  }

  async function handleRequestSendOperationEmail() {
    if (!editingOpportunityId) return;

    const recipient = normalizeText(operationEmailDraft.recipient);
    const subject = normalizeText(operationEmailDraft.subject);
    const messageBody = normalizeText(operationEmailDraft.messageBody);

    if (!recipient) {
      setOperationEmailError("Indica el destinatario principal.");
      return;
    }
    if (!subject) {
      setOperationEmailError("Indica el asunto del correo.");
      return;
    }
    if (!messageBody) {
      setOperationEmailError("El mensaje no puede ir vacio.");
      return;
    }

    const latestGoogleStatus = await loadOperationGoogleMailStatus({
      silent: true,
    });
    if (!latestGoogleStatus?.canSend) {
      setOperationEmailError(
        "Tu conexion de Google no esta lista para enviar correos.",
      );
      return;
    }

    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Se enviara este correo ahora a ${recipient}. ¿Deseas continuar?`,
      );
      if (!confirmed) {
        return;
      }
    }

    setSendingOperationEmail(true);
    setOperationEmailError("");
    setOperationEmailNotice("");

    try {
      const draftAttachments = Array.isArray(operationEmailDraft.attachments)
        ? operationEmailDraft.attachments
        : [];
      const mergedAttachments = [
        ...draftAttachments,
        ...selectedOperationLibraryAttachments,
      ].filter(Boolean);
      const uniqueAttachments = Array.from(
        new Map(
          mergedAttachments.map((attachment) => [attachment.id, attachment]),
        ).values(),
      );

      const createPayload = {
        entryKind: "action",
        activityType: "send_email",
        dueDate: toDateOnlySafe(new Date().toISOString()),
        objective: subject,
        details: {
          entryKind: "action",
          recipient,
          cc: normalizeText(operationEmailDraft.cc),
          subject,
          messageBody,
          purpose: "other",
          purposeOther: "operaciones",
          aiInstructionText: normalizeText(operationAiInstructionText),
          attachments: uniqueAttachments,
        },
      };

      const createResponse = await api.post(
        `/api/execution-commercial/opportunities/${editingOpportunityId}/activities`,
        createPayload,
      );
      const actionId = Number(createResponse?.data?.id || 0);
      if (!actionId) {
        throw new Error("No se pudo preparar la accion de envio.");
      }

      await api.post(
        `/api/execution-commercial/opportunities/${editingOpportunityId}/activities/${actionId}/send-email`,
        {
          details: {
            recipient,
            cc: normalizeText(operationEmailDraft.cc),
            subject,
            messageBody,
            purpose: "other",
            purposeOther: "operaciones",
            aiInstructionText: normalizeText(operationAiInstructionText),
            attachments: uniqueAttachments,
            markDoneOnSend: true,
          },
        },
      );

      setOperationEmailNotice(`Correo enviado correctamente a ${recipient}.`);
      setIsOperationEmailModalOpen(false);
      await refreshExecutionSection();
    } catch (error) {
      setOperationEmailError(
        getApiErrorMessage(
          error,
          "No fue posible enviar el correo desde Operaciones.",
        ),
      );
    } finally {
      setSendingOperationEmail(false);
    }
  }

  async function loadPersistedAiNarrative(opportunityId) {
    const response = await api.get(
      `/api/commercial-development/opportunities/${opportunityId}/ai-narrative/latest`,
      { timeout: AI_NARRATIVE_TIMEOUT_MS },
    );
    applyAiNarrativePayload(response?.data || null);
    setAiJobStatus(response?.data?.found ? "persisted" : "pending");
  }

  async function refreshAiNarrative() {
    if (!editingOpportunityId) return;

    setLoadingAiNarrative(true);
    setAiJobStatus("loading");
    let pollTimedOut = false;
    try {
      const response = await api.post(
        `/api/commercial-development/opportunities/${editingOpportunityId}/ai-narrative/jobs`,
        { forceRegenerate: true },
        { timeout: AI_NARRATIVE_TIMEOUT_MS },
      );

      const fallback = response?.data?.fallback || null;

      let resolvedData = response?.data;
      const createdJobStatus = normalizeText(
        resolvedData?.job?.status,
      ).toLowerCase();
      if (createdJobStatus) {
        setAiJobStatus(createdJobStatus);
      }
      if (!resolvedData?.result && normalizeText(resolvedData?.job?.id)) {
        const jobId = normalizeText(resolvedData.job.id);
        const deadline = Date.now() + AI_NARRATIVE_TOTAL_POLL_TIMEOUT_MS;
        let nextDelay = Math.max(
          Number(
            resolvedData?.job?.pollAfterMs || AI_NARRATIVE_POLL_INTERVAL_MS,
          ),
          0,
        );

        while (Date.now() < deadline) {
          if (nextDelay > 0) {
            await new Promise((resolve) => {
              window.setTimeout(resolve, nextDelay);
            });
          }

          const pollResponse = await api.get(
            `/api/commercial-development/opportunities/${editingOpportunityId}/ai-narrative/jobs/${jobId}`,
            { timeout: AI_NARRATIVE_TIMEOUT_MS },
          );

          resolvedData = pollResponse?.data;
          const polledStatus = normalizeText(
            resolvedData?.job?.status,
          ).toLowerCase();
          if (polledStatus) {
            setAiJobStatus(polledStatus);
          }
          if (resolvedData?.result) {
            break;
          }

          const status = normalizeText(resolvedData?.job?.status);
          if (["failed", "stale", "expired"].includes(status)) {
            break;
          }

          nextDelay = Math.max(
            Number(
              resolvedData?.job?.pollAfterMs || AI_NARRATIVE_POLL_INTERVAL_MS,
            ),
            0,
          );
        }

        if (!resolvedData?.result) {
          pollTimedOut = true;
        }
      }

      let resultPayload = resolvedData?.result || null;
      const resultSource = normalizeText(
        resultPayload?.aiNarrativeSource,
      ).toLowerCase();
      if (!resultPayload || resultSource === "fallback") {
        try {
          const directResponse = await api.post(
            `/api/commercial-development/opportunities/${editingOpportunityId}/ai-narrative/direct`,
            {},
            { timeout: AI_NARRATIVE_TIMEOUT_MS },
          );
          const directResult = directResponse?.data?.result || null;
          if (directResult) {
            resultPayload = directResult;
          }
        } catch {
          // Keep job result/fallback when direct refresh is unavailable.
        }
      }

      if (resultPayload) {
        applyAiNarrativePayload(resultPayload);
      } else if (pollTimedOut && fallback) {
        applyAiNarrativePayload(fallback);
      }
      const finalStatus = normalizeText(
        resolvedData?.job?.status,
      ).toLowerCase();
      if (resultPayload) {
        setAiJobStatus("completed");
      } else if (pollTimedOut) {
        setAiJobStatus("failed");
        setSourceError(
          "La IA esta tardando mas de lo esperado. Se mantiene la estrategia actual; intenta nuevamente en unos segundos.",
        );
      } else if (finalStatus) {
        setAiJobStatus(finalStatus);
      }
    } catch (error) {
      setAiJobStatus("failed");
      setSourceError(
        getApiErrorMessage(
          error,
          "No fue posible actualizar la estrategia recomendada",
        ),
      );
    } finally {
      setLoadingAiNarrative(false);
    }
  }

  useEffect(() => {
    if (!editingOpportunityId) {
      setAiNarrative({
        statusSummary: "",
        nextStepRecommendation: "",
        contract: null,
        source: "",
        generatedAt: null,
      });
      setAiJobStatus("pending");
      return;
    }
    loadPersistedAiNarrative(editingOpportunityId).catch((error) => {
      setSourceError(
        getApiErrorMessage(
          error,
          "No fue posible cargar la estrategia persistida",
        ),
      );
    });
  }, [editingOpportunityId]);

  const aiTooltip = `Ultima actualizacion: ${formatNarrativeTimestamp(aiNarrative.generatedAt)}\nFuente: ${getNarrativeSourceLabel(aiNarrative.source)}\nEstado del job: ${getJobStatusLabel(aiJobStatus)}`;
  const aiSourceLabel = getNarrativeSourceLabel(aiNarrative.source);
  const aiUpdatedLabel = formatNarrativeTimestamp(aiNarrative.generatedAt);
  const aiJobStatusLabel = getJobStatusLabel(aiJobStatus);
  const aiJobStatusTone = getJobStatusTone(aiJobStatus);
  const aiContract =
    aiNarrative.contract && typeof aiNarrative.contract === "object"
      ? aiNarrative.contract
      : {};
  const descriptionSituationText =
    normalizeText(aiContract.descriptionSituationText) ||
    normalizeText(aiNarrative.statusSummary) ||
    "No fue posible construir la narrativa de situacion actual.";
  const salesStrategyText =
    normalizeText(aiContract.salesStrategyText) ||
    "No fue posible construir la estrategia comercial.";
  const nextBestStepText =
    normalizeText(aiContract.nextBestStepText) ||
    normalizeText(aiNarrative.nextStepRecommendation) ||
    "No fue posible construir el siguiente mejor paso.";
  const alternativeStepText =
    normalizeText(aiContract.alternativeStepText) ||
    "No fue posible construir el paso alternativo.";
  const aiQualityScore = Number(
    aiCommercialBlueprint?.short?.qualityScore || 0,
  );
  const aiSourceNormalized = normalizeText(aiNarrative.source).toLowerCase();
  const aiHeaderBadge =
    aiQualityScore >= 7 && aiSourceNormalized === "openai"
      ? { label: "Alta confianza", tone: "green" }
      : aiQualityScore >= 6
        ? { label: "En progreso", tone: "amber" }
        : { label: "Requiere ajuste", tone: "red" };
  const aiHeaderBadgeTooltip =
    aiHeaderBadge.tone === "green"
      ? `Estado: Alta confianza\nCriterio: puntaje ${aiQualityScore}/8 y fuente IA OpenAI.`
      : aiHeaderBadge.tone === "amber"
        ? `Estado: En progreso\nCriterio: puntaje ${aiQualityScore}/8. Requiere reforzar calidad para llegar a alta confianza.`
        : `Estado: Requiere ajuste\nCriterio: puntaje ${aiQualityScore}/8. Ajusta la recomendacion antes de publicarla.`;
  const interactionChanges = Array.isArray(interactionAnalysis?.changes)
    ? interactionAnalysis.changes.filter(Boolean)
    : [];

  return (
    <section className="account-form-section opportunity-development-section">
      <div className="opportunity-development-header opportunity-collapsible-section-header">
        <div className="opportunity-collapsible-section-copy">
          <h4>Desarrollo de la oportunidad</h4>
          <p className="field-hint">
            Estrategia guiada y pasos concretos para mover la oportunidad con
            evidencia real.
          </p>
        </div>
        <div className="opportunity-collapsible-section-actions">
          <span
            className={`record-id-badge status-${aiHeaderBadge.tone}`}
            title={aiHeaderBadgeTooltip}
            aria-label={aiHeaderBadgeTooltip}
          >
            {aiHeaderBadge.label}
          </span>
          <button
            type="button"
            className="opportunity-workspace-collapse-button"
            onClick={() => setIsDevelopmentExpanded((current) => !current)}
            aria-expanded={isDevelopmentExpanded}
            aria-controls="opportunity-development-section-body"
          >
            <span aria-hidden="true">{isDevelopmentExpanded ? "▾" : "▸"}</span>
            {isDevelopmentExpanded ? "Colapsar" : "Expandir"}
          </button>
        </div>
      </div>

      {sourceError && isDevelopmentExpanded ? (
        <p className="field-hint opportunity-development-warning">
          {sourceError}
        </p>
      ) : null}

      <article
        id="opportunity-development-section-body"
        className="opportunity-development-card is-highlight"
        hidden={!isDevelopmentExpanded}
      >
        <div className="opportunity-development-card-header">
          <h5>Siguiente mejor paso</h5>
          <button
            type="button"
            className={`opportunity-development-ai-icon-button${loadingAiNarrative ? " is-loading" : ""}`}
            onClick={refreshAiNarrative}
            disabled={loadingAiNarrative || !editingOpportunityId}
            aria-label="Actualizar estrategia con IA"
            title={aiTooltip}
          >
            <InsightAiIcon />
          </button>
        </div>
        <div className="opportunity-development-ai-meta" aria-live="polite">
          <span>Fuente: {aiSourceLabel}</span>
          <span>Ultima actualizacion: {aiUpdatedLabel}</span>
          <span
            className={`opportunity-development-ai-job-status is-${aiJobStatusTone}`}
          >
            Estado del job: {aiJobStatusLabel}
          </span>
        </div>
        <div className="opportunity-development-ai-detail">
          <div className="opportunity-development-ai-detail-block">
            <h6>Descripcion y situacion actual de la oportunidad</h6>
            <p>{descriptionSituationText}</p>
          </div>
          <div className="opportunity-development-ai-detail-block">
            <h6>Estrategia para lograr la venta</h6>
            <p>{salesStrategyText}</p>
          </div>
          <div className="opportunity-development-ai-detail-block">
            <h6>Siguiente mejor paso</h6>
            <p>{nextBestStepText}</p>
          </div>
          <div className="opportunity-development-ai-detail-block">
            <h6>Paso alternativo</h6>
            <p>{alternativeStepText}</p>
          </div>
        </div>
      </article>

      <article
        className="opportunity-development-card opportunity-development-execution-card"
        hidden={!isDevelopmentExpanded}
      >
        <div className="opportunity-development-card-header">
          <div>
            <h5>Ejecucion comercial</h5>
            <span className="field-hint">
              Registra y da seguimiento sin salir de la oportunidad.
          {showOpportunityCoach ? <div className="opportunity-development-interaction-coach">
            <div className="opportunity-development-execution-section-header">
              <h6>Coach de oportunidad</h6>
              <span className="field-hint">Habla con el asistente y revisa los cambios antes de guardarlos.</span>
            </div>

            <div style={{ display: "grid", gap: "12px" }}>
              <div style={{ display: "grid", gap: "8px", maxHeight: "240px", overflowY: "auto", padding: "8px 10px", border: "1px solid #d9dfe8", borderRadius: "12px", background: "#f8fafc" }}>
                {chatMessages.map((message) => (
                  <div key={message.id} style={{ display: "flex", justifyContent: message.role === "user" ? "flex-end" : "flex-start" }}>
                    <div
                      style={{
                        maxWidth: "80%",
                        padding: "9px 12px",
                        borderRadius: "12px",
                        background: message.role === "user" ? "#1d4ed8" : "#ffffff",
                        color: message.role === "user" ? "#fff" : "#0f172a",
                        border: message.role === "assistant" ? "1px solid #d9dfe8" : "none",
                        boxShadow: message.role === "assistant" ? "0 1px 2px rgba(15,23,42,0.04)" : "none",
                      }}
                    >
                      {message.text}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: "grid", gap: "10px" }}>
                <textarea
                  rows={3}
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  placeholder="Ej. La demo fue muy bien. El cliente confirmó interés y quiere avanzado con la propuesta. Agéndame reunión con compras el jueves a las 11:00."
                />
                <div style={{ display: "flex", gap: "10px", alignItems: "center", justifyContent: "space-between" }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleChatSubmit}
                    disabled={analyzingInteraction || !normalizeText(chatInput)}
                  >
                    {analyzingInteraction ? "Analizando..." : "Enviar al coach"}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setChatInput("");
                      setInteractionNote("");
                    }}
                  >
                    Limpiar
                  </button>
                </div>
              </div>

              {interactionJobStatus ? <p className="field-hint">Estado: {interactionJobStatus === "running" ? "analizando" : interactionJobStatus === "completed" ? "análisis listo" : interactionJobStatus}</p> : null}

              {interactionAnalysis ? (
                <div className="opportunity-development-interaction-review">
                  <strong>{interactionAnalysis.summary || "Detecté cambios posibles"}</strong>
                  {interactionAnalysis.activity ? (
                    <div className="opportunity-development-proposed-activity">
                      <h6>Nueva actividad propuesta</h6>
                      <p>
                        <strong>Tipo:</strong>{" "}
                        {getInteractionActivityTypeLabel(
                          interactionAnalysis.activity.type,
                        )}
                      </p>
                      <p>
                        <strong>Objetivo:</strong>{" "}
                        {interactionAnalysis.activity.objective || interactionAnalysis.activity.title || "Sin objetivo"}
                      </p>
                      <p>
                        <strong>Fecha:</strong>{" "}
                        {interactionAnalysis.activity.scheduledDate || "Seleccionar fecha"}
                        {interactionAnalysis.activity.scheduledTime ? ` ${interactionAnalysis.activity.scheduledTime}` : ""}
                      </p>
                      <p>
                        <strong>Nota:</strong>{" "}
                        {interactionAnalysis.activity.note || interactionNote}
                      </p>
                    </div>
                  ) : null}
                  <h6>Cambios detectados en la oportunidad</h6>
                  {interactionChanges.filter((change) => change.entity !== "activity").length ? (
                    <ul>
                      {interactionChanges
                        .filter((change) => change.entity !== "activity")
                        .map((change, index) => (
                          <li key={`${change.entity}-${change.field}-${index}`}>
                            <span>{getInteractionFieldLabel(change.field || change.entity)}</span>
                            <small>Propuesto: {change.newValue || "Sin valor detectado"}</small>
                            <em>
                              Confianza {getInteractionConfidenceLabel(change.confidence)} · {change.evidence || "Sin evidencia"}
                            </em>
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <p className="field-hint">
                      No hay cambios adicionales en la oportunidad; la actividad nueva se muestra arriba.
                    </p>
                  )}
                  <div className="opportunity-development-interaction-review-actions">
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => setIsInteractionApprovalOpen(true)}
                      disabled={applyingInteraction || !interactionAnalysis}
                    >
                      {applyingInteraction ? "Aplicando..." : "Revisar y aprobar"}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        setInteractionAnalysis(null);
                        setIsInteractionApprovalOpen(false);
                      }}
                      disabled={applyingInteraction}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            {interactionAnalysis && isInteractionApprovalOpen ? (
              <div className="opportunity-interaction-approval-backdrop" role="dialog" aria-modal="true" aria-label="Aprobacion de propuesta del coach">
                <div className="opportunity-development-execution-form opportunity-interaction-approval-modal">
                  <div className="opportunity-development-execution-form-header">
                    <h6>Revisar y aprobar</h6>
                    <span className="record-id-badge state-pending">Aprobación</span>
                  </div>

                  <div className="opportunity-development-execution-form-grid is-activity">
                    <div className="opportunity-development-interaction-review-summary" style={{ gridColumn: "1 / -1" }}>
                      <strong>{interactionApprovalDraft.summary?.title || "Resumen del cambio sugerido"}</strong>
                      <p>{interactionApprovalDraft.summary?.message || "El coach detectó cambios sugeridos para la oportunidad."}</p>
                    </div>

                    {(interactionApprovalDraft.proposals || []).length ? (
                      interactionApprovalDraft.proposals.map((proposal) => (
                        <div key={proposal.proposalId} className="opportunity-development-proposed-activity" style={{ gridColumn: "1 / -1" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "10px" }}>
                            <strong>{formatProposalLabel(proposal.kind)}</strong>
                            <label style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "12px", margin: 0 }}>
                              <input
                                type="checkbox"
                                checked={Boolean(proposal.selected)}
                                onChange={(event) => toggleInteractionProposalSelected(proposal.proposalId, event.target.checked)}
                              />
                              Aplicar
                            </label>
                          </div>

                          {proposal.kind === "opportunity_field" ? (
                            <div style={{ display: "grid", gap: "10px" }}>
                              <div>
                                <strong>Campo: {proposal.fields?.label || "Importe en dólares"}</strong>
                                <p style={{ margin: "6px 0 0" }}>
                                  Valor actual: {proposal.fields?.previousValue ?? "Sin valor registrado"}
                                </p>
                              </div>
                              <label style={{ display: "block" }}>
                                Nuevo importe en dólares
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={proposal.fields?.value ?? ""}
                                  onChange={(event) => editInteractionProposal(proposal.proposalId, "fields.value", event.target.value)}
                                />
                              </label>
                            </div>
                          ) : null}

                          {proposal.kind === "stage_answer" ? (
                            <>
                              <div style={{ marginBottom: "12px", padding: "10px 12px", borderRadius: "8px", background: "#e8f1ff", border: "1px solid #c8dcfb" }}>
                                <strong style={{ display: "block", marginBottom: "4px" }}>
                                  Etapa: {proposal.question?.stageName || "Etapa actual"}
                                </strong>
                                <span style={{ color: "#4b6380" }}>
                                  Verifica que la respuesta corresponda a esta etapa antes de guardarla.
                                </span>
                              </div>
                              <label style={{ display: "block", marginBottom: "8px" }}>
                                Pregunta de la etapa
                                <input
                                  value={proposal.question?.prompt || ""}
                                  onChange={(event) => editInteractionProposal(proposal.proposalId, "question.prompt", event.target.value)}
                                  disabled
                                />
                              </label>
                              <label style={{ display: "block" }}>
                                Respuesta sugerida
                                <textarea
                                  rows={3}
                                  value={proposal.fields?.answerValue || ""}
                                  onChange={(event) => editInteractionProposal(proposal.proposalId, "fields.answerValue", event.target.value)}
                                />
                              </label>
                              {proposal.fields?.previousAnswer ? (
                                <div style={{ marginTop: "12px" }}>
                                  <label style={{ display: "block", marginBottom: "6px" }}>
                                    Qué hacer con la respuesta anterior
                                    <select
                                      value={proposal.fields?.answerMode || "replace"}
                                      onChange={(event) => editInteractionProposal(proposal.proposalId, "fields.answerMode", event.target.value)}
                                    >
                                      <option value="replace">Reemplazar la respuesta anterior</option>
                                      <option value="append">Adicionar a la respuesta anterior</option>
                                    </select>
                                  </label>
                                  <div style={{ padding: "10px 12px", borderRadius: "8px", background: "#fff", border: "1px solid #d9dfe8" }}>
                                    <strong style={{ display: "block", marginBottom: "4px" }}>Respuesta anterior</strong>
                                    <span style={{ whiteSpace: "pre-wrap" }}>{proposal.fields.previousAnswer}</span>
                                  </div>
                                </div>
                              ) : (
                                <p className="field-hint" style={{ marginTop: "8px" }}>
                                  No existe una respuesta anterior para esta pregunta.
                                </p>
                              )}
                            </>
                          ) : null}

                          {proposal.kind === "activity" ? (
                            <>
                              <label style={{ display: "block", marginBottom: "8px" }}>
                                Tipo
                                <select
                                  value={proposal.fields?.activityType || "call"}
                                  onChange={(event) => editInteractionProposal(proposal.proposalId, "fields.activityType", event.target.value)}
                                >
                                  {ACTIVITY_TYPE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </label>
                              <label style={{ display: "block", marginBottom: "8px" }}>
                                Fecha
                                <input
                                  type="date"
                                  value={proposal.fields?.scheduledDate || ""}
                                  onChange={(event) => editInteractionProposal(proposal.proposalId, "fields.scheduledDate", event.target.value)}
                                />
                              </label>
                              <label style={{ display: "block", marginBottom: "8px" }}>
                                Hora
                                <input
                                  type="time"
                                  value={proposal.fields?.scheduledTime || "09:00"}
                                  onChange={(event) => editInteractionProposal(proposal.proposalId, "fields.scheduledTime", event.target.value)}
                                />
                              </label>
                              <label style={{ display: "block", marginBottom: "8px" }}>
                                Objetivo
                                <textarea
                                  rows={2}
                                  value={proposal.fields?.objective || ""}
                                  onChange={(event) => editInteractionProposal(proposal.proposalId, "fields.objective", event.target.value)}
                                />
                              </label>
                              <label style={{ display: "block" }}>
                                Nota
                                <textarea
                                  rows={2}
                                  value={proposal.fields?.note || ""}
                                  onChange={(event) => editInteractionProposal(proposal.proposalId, "fields.note", event.target.value)}
                                />
                              </label>
                            </>
                          ) : null}

                          {proposal.kind === "next_step" ? (
                            <>
                              <label style={{ display: "block", marginBottom: "8px" }}>
                                Título
                                <input
                                  value={proposal.fields?.title || ""}
                                  onChange={(event) => editInteractionProposal(proposal.proposalId, "fields.title", event.target.value)}
                                />
                              </label>
                              <label style={{ display: "block", marginBottom: "8px" }}>
                                Fecha límite
                                <input
                                  type="date"
                                  value={proposal.fields?.dueDate || ""}
                                  onChange={(event) => editInteractionProposal(proposal.proposalId, "fields.dueDate", event.target.value)}
                                />
                              </label>
                              <label style={{ display: "block" }}>
                                Criterio de éxito
                                <input
                                  value={proposal.fields?.successCriteria || ""}
                                  onChange={(event) => editInteractionProposal(proposal.proposalId, "fields.successCriteria", event.target.value)}
                                />
                              </label>
                            </>
                          ) : null}

                          {proposal.kind === "stage_transition" ? (
                            <>
                              <p style={{ margin: 0 }}>De {proposal.fields?.fromStageName || "etapa actual"} a {proposal.fields?.toStageName || "siguiente etapa"}</p>
                              <label style={{ display: "block", marginTop: "8px" }}>
                                Motivo
                                <textarea
                                  rows={2}
                                  value={proposal.fields?.reason || ""}
                                  onChange={(event) => editInteractionProposal(proposal.proposalId, "fields.reason", event.target.value)}
                                />
                              </label>
                            </>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <>
                        <label>
                          Tipo
                          <select
                            value={interactionApprovalDraft.activityType}
                            onChange={(event) =>
                              setInteractionApprovalDraft((current) => ({
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
                        <label>
                          Fecha
                          <input
                            type="date"
                            value={interactionApprovalDraft.scheduledDate}
                            onChange={(event) =>
                              setInteractionApprovalDraft((current) => ({
                                ...current,
                                scheduledDate: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label>
                          Hora
                          <input
                            type="time"
                            value={interactionApprovalDraft.scheduledTime}
                            onChange={(event) =>
                              setInteractionApprovalDraft((current) => ({
                                ...current,
                                scheduledTime: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label className="is-span-3">
                          Objetivo
                          <textarea
                            rows={2}
                            value={interactionApprovalDraft.objective}
                            onChange={(event) =>
                              setInteractionApprovalDraft((current) => ({
                                ...current,
                                objective: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label className="is-span-3">
                          Nota
                          <textarea
                            rows={3}
                            value={interactionApprovalDraft.note}
                            onChange={(event) =>
                              setInteractionApprovalDraft((current) => ({
                                ...current,
                                note: event.target.value,
                              }))
                            }
                          />
                        </label>
                        {interactionApprovalDraft.nextStepTitle || interactionAnalysis.nextStep?.title ? (
                          <>
                            <label className="is-span-3">
                              Próximo paso
                              <input
                                value={interactionApprovalDraft.nextStepTitle}
                                onChange={(event) =>
                                  setInteractionApprovalDraft((current) => ({
                                    ...current,
                                    nextStepTitle: event.target.value,
                                  }))
                                }
                              />
                            </label>
                            <label>
                              Fecha del próximo paso
                              <input
                                type="date"
                                value={interactionApprovalDraft.nextStepDueDate}
                                onChange={(event) =>
                                  setInteractionApprovalDraft((current) => ({
                                    ...current,
                                    nextStepDueDate: event.target.value,
                                  }))
                                }
                              />
                            </label>
                            <label>
                              Criterio de éxito
                              <input
                                value={interactionApprovalDraft.nextStepSuccessCriteria}
                                onChange={(event) =>
                                  setInteractionApprovalDraft((current) => ({
                                    ...current,
                                    nextStepSuccessCriteria: event.target.value,
                                  }))
                                }
                              />
                            </label>
                          </>
                        ) : null}
                      </>
                    )}
                  </div>

                  <div className="opportunity-development-interaction-review-actions">
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={handleApplyInteraction}
                      disabled={applyingInteraction}
                    >
                      {applyingInteraction ? "Guardando..." : "Aprobar y guardar"}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setIsInteractionApprovalOpen(false)}
                      disabled={applyingInteraction}
                    >
                      Volver a revisar
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div> : null}

            </span>
          </div>
          <div className="opportunity-collapsible-section-actions">
            <div className="opportunity-development-execution-summary">
              <span className="record-id-badge">
                Actividades {executionSummary.activities}
              </span>
              <span className="record-id-badge">
                Dependencias {executionSummary.dependencies}
              </span>
              <span className="record-id-badge">
                Operaciones {executionSummary.operations}
              </span>
            </div>
            <button
              type="button"
              className="opportunity-workspace-collapse-button"
              onClick={() => setIsExecutionExpanded((current) => !current)}
              aria-expanded={isExecutionExpanded}
              aria-controls="opportunity-execution-section-body"
            >
              <span aria-hidden="true">{isExecutionExpanded ? "▾" : "▸"}</span>
              {isExecutionExpanded ? "Colapsar" : "Expandir"}
            </button>
          </div>
        </div>

        <div
          id="opportunity-execution-section-body"
          hidden={!isExecutionExpanded}
        >
          <div className="opportunity-development-execution-section-header">
            <h6>Registrar</h6>
            <span className="field-hint">
              Dos entradas rapidas para mantener orden operativo.
            </span>
          </div>
          <div className="opportunity-development-execution-grid">
            <div
              className="opportunity-development-execution-form"
              role="group"
              aria-label="Nueva actividad"
            >
              <div className="opportunity-development-execution-form-header">
                <h6>Actividad</h6>
                <span className="record-id-badge state-pending">Nueva</span>
              </div>
              <div className="opportunity-development-execution-form-grid is-activity">
                <label>
                  Tipo
                  <select
                    value={activityDraft.activityType}
                    onChange={(event) =>
                      setActivityDraft((current) => ({
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
                <label>
                  Fecha
                  <input
                    type="date"
                    value={activityDraft.scheduledDate}
                    onChange={(event) =>
                      setActivityDraft((current) => ({
                        ...current,
                        scheduledDate: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Hora
                  <input
                    type="time"
                    step={300}
                    value={activityDraft.scheduledTime}
                    onChange={(event) =>
                      setActivityDraft((current) => ({
                        ...current,
                        scheduledTime: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="is-span-3">
                  Objetivo
                  <textarea
                    rows={2}
                    value={activityDraft.objective}
                    onChange={(event) =>
                      setActivityDraft((current) => ({
                        ...current,
                        objective: event.target.value,
                      }))
                    }
                    placeholder="Ej. llamada de validacion con sponsor"
                  />
                </label>
                <label className="is-span-3">
                  Nota
                  <textarea
                    rows={2}
                    value={activityDraft.note}
                    onChange={(event) =>
                      setActivityDraft((current) => ({
                        ...current,
                        note: event.target.value,
                      }))
                    }
                    placeholder="Contexto para la actividad"
                  />
                </label>
              </div>
              <button
                type="button"
                className="btn-secondary opportunity-development-execution-submit"
                onClick={handleCreateActivity}
                disabled={savingExecutionItem === "activity"}
              >
                {savingExecutionItem === "activity"
                  ? "Guardando..."
                  : "Agregar actividad"}
              </button>
            </div>

            <div
              className="opportunity-development-execution-form"
              role="group"
              aria-label="Nueva dependencia"
            >
              <div className="opportunity-development-execution-form-header">
                <h6>Dependencia</h6>
                <span className="record-id-badge state-pending">Nueva</span>
              </div>
              <div className="opportunity-development-execution-form-grid">
                <label>
                  Tipo
                  <select
                    value={dependencyDraft.dependencyType}
                    onChange={(event) =>
                      setDependencyDraft((current) => ({
                        ...current,
                        dependencyType: event.target.value,
                      }))
                    }
                  >
                    {DEPENDENCY_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Fecha
                  <input
                    type="date"
                    value={dependencyDraft.dueDate}
                    onChange={(event) =>
                      setDependencyDraft((current) => ({
                        ...current,
                        dueDate: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="is-span-2">
                  Titulo
                  <textarea
                    rows={2}
                    value={dependencyDraft.title}
                    onChange={(event) =>
                      setDependencyDraft((current) => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                    placeholder="Ej. aprobacion de preventa para demo"
                  />
                </label>
                <label className="is-span-2">
                  Detalle
                  <textarea
                    rows={2}
                    value={dependencyDraft.details}
                    onChange={(event) =>
                      setDependencyDraft((current) => ({
                        ...current,
                        details: event.target.value,
                      }))
                    }
                    placeholder="Detalle operativo de la dependencia"
                  />
                </label>
              </div>
              <button
                type="button"
                className="btn-secondary opportunity-development-execution-submit"
                onClick={handleCreateDependency}
                disabled={savingExecutionItem === "dependency"}
              >
                {savingExecutionItem === "dependency"
                  ? "Guardando..."
                  : "Agregar dependencia"}
              </button>
            </div>

            <div
              className="opportunity-development-execution-form"
              role="group"
              aria-label="Nueva operacion"
            >
              <div className="opportunity-development-execution-form-header">
                <h6>Operaciones</h6>
                <span className="record-id-badge state-pending">Nueva</span>
              </div>
              <p className="field-hint">
                Ejecuta acciones operativas sin salir de la oportunidad.
              </p>
              <button
                type="button"
                className="btn-secondary opportunity-development-execution-submit"
                onClick={handleOpenSendEmailOperation}
                disabled={!canOpenSendEmailOperation || sendingOperationEmail}
              >
                Enviar correo al contacto
              </button>
              {!canOpenSendEmailOperation && !canExecuteOperations ? (
                <p className="field-hint">
                  Completa y guarda la oportunidad para habilitar operaciones.
                </p>
              ) : !canOpenSendEmailOperation && canExecuteOperations ? (
                <p className="field-hint">
                  Asigna un contacto con correo para habilitar el envío de
                  emails.
                </p>
              ) : null}
            </div>
          </div>

          <div className="opportunity-development-execution-section-header is-history">
            <h6>Seguimiento</h6>
            <span className="field-hint">
              Consulta lo creado y actualiza estado desde el indicador lateral.
            </span>
          </div>
          <div className="opportunity-development-execution-history-grid">
            <div className="opportunity-development-execution-history">
              <div className="opportunity-development-execution-history-header">
                <h6>Actividades</h6>
                <span className="record-id-badge">
                  {executionSummary.activities}
                </span>
              </div>
              {previousActivities.length ? (
                <ul>
                  {previousActivities.map((item) => (
                    <li key={`activity-${item.id}`}>
                      <div className="opportunity-development-execution-history-row">
                        <div className="opportunity-development-execution-history-main">
                          <strong>{item.title || "Sin titulo"}</strong>
                          <span>
                            {ACTIVITY_TYPE_LABELS[item.actionType] ||
                              item.actionType ||
                              "Actividad"}{" "}
                            · {getExecutionStatusLabel(item.status)}
                          </span>
                          <span>
                            {item.scheduledAt
                              ? `Agenda: ${formatActivityDisplayDate(item.scheduledAt, { includeTime: true })}`
                              : item.dueDate
                                ? `Fecha: ${formatActivityDisplayDate(item.dueDate)}`
                                : "Sin fecha"}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className={`opportunity-development-item-manage-button is-${getExecutionStatusTone(item.status)}`}
                        onClick={() => openExecutionItemModal("activity", item)}
                        aria-label="Gestionar actividad"
                        title="Marcar realizada o cancelar"
                      >
                        <ManageExecutionItemIcon
                          tone={getExecutionStatusTone(item.status)}
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="field-hint">
                  Aun no hay actividades registradas.
                </p>
              )}
            </div>

            <div className="opportunity-development-execution-history">
              <div className="opportunity-development-execution-history-header">
                <h6>Dependencias</h6>
                <span className="record-id-badge">
                  {executionSummary.dependencies}
                </span>
              </div>
              {executionDependencies.length ? (
                <ul>
                  {executionDependencies.map((item) => (
                    <li key={`dependency-${item.id}`}>
                      <div className="opportunity-development-execution-history-row">
                        <div className="opportunity-development-execution-history-main">
                          <strong>{item.title || "Sin titulo"}</strong>
                          <span>
                            {DEPENDENCY_TYPE_LABELS[item.dependencyType] ||
                              item.dependencyLabel ||
                              "Dependencia"}{" "}
                            · {getExecutionStatusLabel(item.status)}
                          </span>
                          <span>
                            {item.dueDate
                              ? `Fecha: ${toDateOnly(item.dueDate)}`
                              : "Sin fecha"}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className={`opportunity-development-item-manage-button is-${getExecutionStatusTone(item.status)}`}
                        onClick={() =>
                          openExecutionItemModal("dependency", item)
                        }
                        aria-label="Gestionar dependencia"
                        title="Marcar realizada o cancelar"
                      >
                        <ManageExecutionItemIcon
                          tone={getExecutionStatusTone(item.status)}
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="field-hint">
                  Aun no hay dependencias registradas.
                </p>
              )}
            </div>

            <div className="opportunity-development-execution-history">
              <div className="opportunity-development-execution-history-header">
                <h6>Operaciones</h6>
                <span className="record-id-badge">
                  {executionSummary.operations}
                </span>
              </div>
              {operationActions.length ? (
                <ul>
                  {operationActions.map((item) => {
                    const details =
                      item?.details && typeof item.details === "object"
                        ? item.details
                        : {};
                    const sentAt = normalizeText(details.sentAt);
                    const recipient = normalizeText(details.recipient);
                    const subject = normalizeText(
                      item.title || details.subject,
                    );

                    return (
                      <li key={`operation-${item.id}`}>
                        <div className="opportunity-development-execution-history-row">
                          <div className="opportunity-development-execution-history-main">
                            <strong>{subject || "Envio de correo"}</strong>
                            <span>
                              {getOperationStatusLabel(item.status)}
                              {recipient ? ` · ${recipient}` : ""}
                            </span>
                            <span>
                              {sentAt
                                ? `Enviada: ${formatActivityDisplayDate(sentAt, { includeTime: true })}`
                                : item.dueDate
                                  ? `Fecha: ${formatActivityDisplayDate(item.dueDate)}`
                                  : "Sin fecha"}
                            </span>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="field-hint">
                  Aun no hay operaciones registradas.
                </p>
              )}
            </div>
          </div>
        </div>
      </article>

      <OpportunityOperationEmailModal
        isOpen={isOperationEmailModalOpen}
        draft={operationEmailDraft}
        sending={sendingOperationEmail}
        generatingAiDraft={generatingOperationAiDraft}
        generatingAiAttachments={generatingOperationAiAttachments}
        error={operationEmailError}
        notice={operationEmailNotice}
        libraryError={operationLibraryError}
        googleMailStatus={operationGoogleMailStatus}
        aiInstructionText={operationAiInstructionText}
        aiSuggestionSubject={operationAiSuggestion.subject}
        aiSuggestionMessageBody={operationAiSuggestion.messageBody}
        aiSuggestionSource={operationAiSuggestion.source}
        aiSuggestionSourceReason={operationAiSuggestion.sourceReason}
        libraryQuery={operationLibraryQuery}
        libraryOptions={operationLibraryOptions}
        libraryLoading={loadingOperationLibraryOptions}
        selectedLibraryAttachmentIds={operationSelectedLibraryAttachmentIds}
        maxLibraryAssets={OPERATION_EMAIL_MAX_LIBRARY_ASSETS}
        onClose={handleCloseOperationEmailModal}
        onChangeField={handleOperationEmailFieldChange}
        onChangeAiInstruction={handleOperationAiInstructionChange}
        onUseAiSuggestion={handleUseOperationAiSuggestion}
        onChangeLibraryQuery={handleOperationLibraryQueryChange}
        onToggleLibraryAttachment={handleToggleOperationLibraryAttachment}
        onAddAttachments={handleAddOperationEmailAttachments}
        onRemoveAttachment={handleRemoveOperationEmailAttachment}
        onRequestAiDraft={handleRequestOperationAiDraft}
        onRequestAiAttachments={handleRequestOperationAiAttachments}
        onRequestSend={handleRequestSendOperationEmail}
        onConnectGoogleMail={handleConnectOperationGoogleMail}
      />

      {executionItemModal ? (
        <div className="modal-overlay" onClick={closeExecutionItemModal}>
          <div
            className="modal-dialog opportunity-development-item-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <h3>Actualizar registro</h3>
              <button
                type="button"
                className="opportunity-documents-apply-icon-button account-modal-close-button"
                onClick={closeExecutionItemModal}
                disabled={savingExecutionUpdate}
                aria-label="Cerrar modal de actualización de registro"
                title="Cerrar"
              >
                ×
              </button>
            </div>

            <div className="opportunity-development-item-modal-content">
              <div className="opportunity-development-item-modal-status-row">
                <span
                  className={`record-id-badge state-${getExecutionStatusBadgeTone(executionItemModal.item?.status)}`}
                >
                  Estado actual:{" "}
                  {getExecutionStatusLabel(executionItemModal.item?.status)}
                </span>
              </div>

              <label>
                Objetivo
                <textarea
                  className="opportunity-development-item-modal-objective-textarea"
                  rows={3}
                  value={executionItemUpdateDraft.objective}
                  onChange={(event) =>
                    setExecutionItemUpdateDraft((current) => ({
                      ...current,
                      objective: event.target.value,
                    }))
                  }
                  placeholder="Describe el objetivo del registro"
                  disabled={savingExecutionUpdate || isExecutionItemReadOnly}
                />
              </label>

              <label>
                Nota
                <textarea
                  rows={3}
                  value={executionItemUpdateDraft.note}
                  onChange={(event) =>
                    setExecutionItemUpdateDraft((current) => ({
                      ...current,
                      note: event.target.value,
                    }))
                  }
                  placeholder="Agrega contexto o seguimiento"
                  disabled={savingExecutionUpdate || isExecutionItemReadOnly}
                />
              </label>

              <div className="opportunity-development-item-modal-schedule">
                <span>Agenda</span>
                <div
                  className={`opportunity-development-item-modal-schedule-grid${executionItemModal.itemType === "dependency" ? " is-date-only" : ""}`}
                >
                  <label className="opportunity-development-item-modal-inline-field">
                    Fecha
                    <input
                      type="date"
                      value={executionItemUpdateDraft.date}
                      onChange={(event) =>
                        setExecutionItemUpdateDraft((current) => ({
                          ...current,
                          date: event.target.value,
                        }))
                      }
                      disabled={
                        savingExecutionUpdate || isExecutionItemReadOnly
                      }
                    />
                  </label>
                  {executionItemModal.itemType === "dependency" ? null : (
                    <label className="opportunity-development-item-modal-inline-field">
                      Hora
                      <input
                        type="time"
                        step={300}
                        value={executionItemUpdateDraft.time}
                        onChange={(event) =>
                          setExecutionItemUpdateDraft((current) => ({
                            ...current,
                            time: event.target.value,
                          }))
                        }
                        disabled={
                          savingExecutionUpdate || isExecutionItemReadOnly
                        }
                      />
                    </label>
                  )}
                </div>
                <div className="opportunity-development-item-modal-schedule-quick-actions">
                  <button
                    type="button"
                    className="btn-secondary opportunity-development-item-modal-quick-chip"
                    onClick={() =>
                      setExecutionItemUpdateDraft((current) => ({
                        ...current,
                        date: toLocalDateInputValue(0),
                      }))
                    }
                    disabled={savingExecutionUpdate || isExecutionItemReadOnly}
                  >
                    Hoy
                  </button>
                  <button
                    type="button"
                    className="btn-secondary opportunity-development-item-modal-quick-chip"
                    onClick={() =>
                      setExecutionItemUpdateDraft((current) => ({
                        ...current,
                        date: toLocalDateInputValue(1),
                      }))
                    }
                    disabled={savingExecutionUpdate || isExecutionItemReadOnly}
                  >
                    Manana
                  </button>
                  {executionItemModal.itemType === "dependency" ? null : (
                    <>
                      <button
                        type="button"
                        className="btn-secondary opportunity-development-item-modal-quick-chip"
                        onClick={() =>
                          setExecutionItemUpdateDraft((current) => ({
                            ...current,
                            time: "09:00",
                          }))
                        }
                        disabled={
                          savingExecutionUpdate || isExecutionItemReadOnly
                        }
                      >
                        09:00
                      </button>
                      <button
                        type="button"
                        className="btn-secondary opportunity-development-item-modal-quick-chip"
                        onClick={() =>
                          setExecutionItemUpdateDraft((current) => ({
                            ...current,
                            time: "12:00",
                          }))
                        }
                        disabled={
                          savingExecutionUpdate || isExecutionItemReadOnly
                        }
                      >
                        12:00
                      </button>
                      <button
                        type="button"
                        className="btn-secondary opportunity-development-item-modal-quick-chip"
                        onClick={() =>
                          setExecutionItemUpdateDraft((current) => ({
                            ...current,
                            time: "16:00",
                          }))
                        }
                        disabled={
                          savingExecutionUpdate || isExecutionItemReadOnly
                        }
                      >
                        16:00
                      </button>
                    </>
                  )}
                </div>
              </div>

              <label>
                Resultado
                <textarea
                  rows={3}
                  value={executionItemUpdateDraft.result}
                  onChange={(event) =>
                    setExecutionItemUpdateDraft((current) => ({
                      ...current,
                      result: event.target.value,
                    }))
                  }
                  placeholder="Describe el resultado de la gestion"
                  disabled={savingExecutionUpdate || isExecutionItemReadOnly}
                />
              </label>

              {isExecutionItemReadOnly ? (
                <p className="field-hint">Registro cerrado: solo consulta.</p>
              ) : null}

              {executionItemModalError ? (
                <p className="field-hint opportunity-development-warning">
                  {executionItemModalError}
                </p>
              ) : null}

              {!isExecutionItemReadOnly ? (
                <div className="opportunity-development-item-modal-icon-actions">
                  <button
                    type="button"
                    className={`opportunity-development-item-modal-status-button${executionItemUpdateDraft.status === "done" ? " is-active-done" : ""}`}
                    onClick={handleSelectExecutionDoneStatus}
                    aria-label={
                      executionItemModal?.itemType === "dependency"
                        ? "Declarar la dependencia resuelta"
                        : "Declarar la actividad realizada"
                    }
                    title={
                      executionItemModal?.itemType === "dependency"
                        ? "Declarar la dependencia resuelta"
                        : "Declarar la actividad realizada"
                    }
                    aria-pressed={executionItemUpdateDraft.status === "done"}
                    disabled={savingExecutionUpdate}
                  >
                    <span aria-hidden="true">✓</span>
                  </button>
                  <button
                    type="button"
                    className={`opportunity-development-item-modal-status-button${executionItemUpdateDraft.status === "cancelled" ? " is-active-cancelled" : ""}`}
                    onClick={handleSelectExecutionCancelledStatus}
                    aria-label={
                      executionItemModal?.itemType === "dependency"
                        ? "Cancelar la dependencia"
                        : "Cancelar la actividad"
                    }
                    title={
                      executionItemModal?.itemType === "dependency"
                        ? "Cancelar la dependencia"
                        : "Cancelar la actividad"
                    }
                    aria-pressed={
                      executionItemUpdateDraft.status === "cancelled"
                    }
                    disabled={savingExecutionUpdate}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                  <button
                    type="button"
                    className="opportunity-development-item-modal-save-button"
                    onClick={() => {
                      void handleSaveExecutionItemUpdate();
                    }}
                    aria-label="Guardar cambios"
                    title="Guardar cambios"
                    disabled={savingExecutionUpdate}
                  >
                    {savingExecutionUpdate ? (
                      <span aria-hidden="true">…</span>
                    ) : (
                      <SaveExecutionItemIcon />
                    )}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
