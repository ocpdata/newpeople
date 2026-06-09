import { useEffect, useMemo, useState } from "react";
import { api, getApiErrorMessage } from "../api";

const AI_NARRATIVE_TIMEOUT_MS = 60000;
const AI_NARRATIVE_POLL_INTERVAL_MS = 3000;
const AI_NARRATIVE_TOTAL_POLL_TIMEOUT_MS = 120000;

function normalizeText(value) {
  return String(value || "").trim();
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
  const text = normalizeText(value);
  if (!text) return "Sin fecha";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString("es-MX", {
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
  const glyph =
    tone === "done" ? "✓" : tone === "cancelled" ? "×" : "•";
  return <span className="opportunity-development-item-manage-glyph">{glyph}</span>;
}

const ACTIVITY_TYPE_OPTIONS = [
  { value: "call", label: "Llamada" },
  { value: "conference", label: "Conferencia" },
  { value: "visit", label: "Visita" },
  { value: "presentation", label: "Presentacion" },
  { value: "other", label: "Otra actividad" },
];

const ACTION_TYPE_OPTIONS = [
  { value: "next_step", label: "Siguiente paso" },
  { value: "follow_up", label: "Seguimiento" },
  { value: "call", label: "Llamada" },
  { value: "waiting_customer", label: "Esperando cliente" },
  { value: "send_email", label: "Enviar correo" },
  { value: "prepare_proposal", label: "Preparar propuesta" },
  { value: "request_information", label: "Solicitar informacion" },
  { value: "coordinate_presales", label: "Coordinar preventa" },
  { value: "send_documentation", label: "Enviar documentacion" },
  { value: "update_quote", label: "Actualizar cotizacion" },
  { value: "internal_approval", label: "Aprobacion interna" },
  { value: "other_action", label: "Otra accion" },
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
const ACTION_TYPE_LABELS = Object.fromEntries(
  ACTION_TYPE_OPTIONS.map((item) => [item.value, item.label]),
);
const DEPENDENCY_TYPE_LABELS = Object.fromEntries(
  DEPENDENCY_TYPE_OPTIONS.map((item) => [item.value, item.label]),
);

const ACTIVITY_TYPE_SET = new Set(ACTIVITY_TYPE_OPTIONS.map((item) => item.value));

function getWorkspaceEntryKind(item) {
  const explicitKind = normalizeText(item?.details?.entryKind).toLowerCase();
  if (explicitKind === "action" || explicitKind === "activity") {
    return explicitKind;
  }
  const actionType = normalizeText(item?.actionType).toLowerCase();
  if (actionType === "call") {
    return "action";
  }
  return ACTIVITY_TYPE_SET.has(String(item?.actionType || ""))
    ? "activity"
    : "action";
}

function toDateTimeLocalInputValue(value) {
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

export default function OpportunityDevelopmentPanel({
  editingOpportunityId,
  form,
  commercialContext,
  opportunityDocuments,
  currentCommercialStage,
  loadingCommercialStageView,
  isCommercialFlowClosed,
  refreshCommercialContext,
}) {
  const [quotations, setQuotations] = useState([]);
  const [interactions, setInteractions] = useState([]);
  const [executionDependencies, setExecutionDependencies] = useState([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const [aiNarrative, setAiNarrative] = useState({
    statusSummary: "",
    nextStepRecommendation: "",
    source: "",
    generatedAt: null,
  });
  const [loadingAiNarrative, setLoadingAiNarrative] = useState(false);
  const [aiJobStatus, setAiJobStatus] = useState("pending");
  const [showAiDetail, setShowAiDetail] = useState(false);
  const [activityDraft, setActivityDraft] = useState({
    activityType: "call",
    objective: "",
    scheduledAt: "",
    note: "",
  });
  const [actionDraft, setActionDraft] = useState({
    actionType: "follow_up",
    objective: "",
    dueDate: "",
    note: "",
    priority: "medium",
  });
  const [dependencyDraft, setDependencyDraft] = useState({
    dependencyType: "presales_support",
    title: "",
    dueDate: "",
    details: "",
  });
  const [savingExecutionItem, setSavingExecutionItem] = useState("");
  const [executionRefreshToken, setExecutionRefreshToken] = useState(0);
  const [executionItemModal, setExecutionItemModal] = useState(null);
  const [executionItemUpdateDraft, setExecutionItemUpdateDraft] = useState({
    status: "done",
    result: "",
  });
  const [savingExecutionUpdate, setSavingExecutionUpdate] = useState(false);
  const [executionItemModalError, setExecutionItemModalError] = useState("");
  const [isDevelopmentExpanded, setIsDevelopmentExpanded] = useState(false);
  const [isExecutionExpanded, setIsExecutionExpanded] = useState(false);

  function applyAiNarrativePayload(payload) {
    if (!payload) return;
    setAiNarrative({
      statusSummary: normalizeText(payload.aiStatusSummary),
      nextStepRecommendation: normalizeText(payload.aiNextStepRecommendation),
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
  const interactionsCount = Array.isArray(interactions) ? interactions.length : 0;
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
        mitigation: "Subir documento clave del requerimiento o contexto cliente.",
      });
    }
    if (missingRequiredAnswers > 0) {
      items.push({
        key: "risk-answers",
        title: "Respuestas obligatorias incompletas",
        severity: "Alta",
        mitigation: "Completar respuestas de etapa para habilitar movimiento comercial.",
      });
    }
    if (!quotationsCount) {
      items.push({
        key: "risk-quotation",
        title: "Sin cotizacion vinculada",
        severity: "Media",
        mitigation: "Preparar una cotizacion inicial para avanzar con decision de compra.",
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
    if (form?.closeDate && isDateInPast(form.closeDate) && !isCommercialFlowClosed) {
      items.push({
        key: "risk-close-date",
        title: "Fecha objetivo vencida",
        severity: "Media",
        mitigation: "Recalibrar fecha de cierre y compromisos del plan inmediato.",
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
    const opportunityName =
      normalizeText(form?.name) || "Oportunidad comercial";
    const accountName = normalizeText(form?.accountName) || "Cuenta no definida";
    const sellerName =
      normalizeText(form?.sellerUserName) ||
      normalizeText(form?.sellerName) ||
      normalizeText(form?.ownerName) ||
      "Vendedor responsable";
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
      normalizeText(aiNarrative.statusSummary) ||
      "No hay lectura operativa suficiente para explicar el bloqueo principal.";
    const accion72 =
      normalizeText(aiNarrative.nextStepRecommendation) ||
      "Programar una conversacion ejecutiva con decisor para acordar siguiente hito de compra.";
    const resultadoEsperado =
      normalizeText(aiNarrative.nextStepRecommendation) ||
      "Asegurar un compromiso verificable del cliente para mover la oportunidad.";
    const canal = interactionsCount > 0 ? "Reunion" : "Llamada";
    const evidenciaCierre =
      "Nota de interaccion, compromiso del cliente y fecha del siguiente hito registrados en CRM.";
    const criterioBinario =
      "Si/No: existe compromiso confirmado con decisor y fecha definida.";

    const messageTarget =
      accountName === "Cuenta no definida"
        ? "su equipo"
        : `el equipo de ${accountName}`;
    const mensajeSugerido = `Hola, para avanzar esta oportunidad con ${messageTarget} propongo una sesion de 30 minutos para validar criterios de decision, alcance final y fecha de cierre. El objetivo es salir con un compromiso concreto y proximo paso calendarizado.`;

    const miniObjetivoEtapa =
      checkpoint.stageLabel === "Aun no lista"
        ? "Eliminar bloqueadores criticos y recuperar conduccion comercial de la etapa actual."
        : "Convertir interes en compromiso comercial verificable de la etapa actual.";
    const planB72 =
      "Si no hay respuesta en 72 horas, escalar con resumen ejecutivo, nueva propuesta de valor y fecha alternativa de decision.";

    const confidence =
      normalizeText(aiNarrative.source).toLowerCase() === "openai"
        ? "Media"
        : "Baja";

    const qualityChecks = [
      {
        id: "q1",
        text: "La accion define verbo, responsable y fecha",
        ok: Boolean(normalizeText(aiNarrative.nextStepRecommendation) && sellerName && commitmentLabel),
      },
      {
        id: "q2",
        text: "Se sustenta en evidencia reciente y verificable",
        ok: Boolean(normalizeText(aiNarrative.statusSummary) && interactionsCount > 0),
      },
      {
        id: "q3",
        text: "Mueve la etapa actual de forma explicita",
        ok: Boolean(stageLabel && normalizeText(aiNarrative.nextStepRecommendation)),
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
      qualityScore >= 7 && normalizeText(aiNarrative.source).toLowerCase() === "openai"
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
        daysWithoutMovement: `${interactionsCount ? 0 : 15}`,
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
        latestActivity: interactionsCount
          ? `${interactionsCount} interaccion(es) registradas`
          : "Sin interacciones recientes",
        daysWithoutMovement: `${interactionsCount ? 0 : 15}`,
        bloqueoPrincipal,
        evidencia1: bloqueoPrincipal,
        evidencia2:
          normalizeText(aiNarrative.nextStepRecommendation) ||
          "No existe recomendacion puntual cargada.",
        evidencia3:
          riskItems[0]?.mitigation ||
          "Sin mitigacion registrada en este momento.",
        confidence,
        missingData:
          contactsCount > 0
            ? "Falta consolidar evidencia de decision economica final."
            : "Falta definir contacto decisor principal.",
        accion72,
        resultadoEsperado,
        commitmentLabel,
        canal,
        mensajeSugerido,
        evidenciaCierre,
        criterioBinario,
        miniObjetivoEtapa,
        estrategia: "Asegurar compromiso de decision con valor de negocio explicito y fecha cerrada.",
        day0: accion72,
        day2:
          "Enviar resumen ejecutivo de acuerdos, riesgos y responsables de siguiente hito.",
        day5:
          "Validar avance con decisor economico y remover objecion principal pendiente.",
        day10:
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
        legalProcurement:
          "Pendiente de involucramiento formal",
        technicalInfluencer:
          "Pendiente de validacion tecnica",
        risk1: detailRisk1,
        risk1Probability: "Alta",
        risk1Impact: "Alto",
        risk1Mitigation: riskItems[0]?.mitigation || "Definir accion concreta con fecha y responsable.",
        risk2: detailRisk2,
        risk2Probability: "Media",
        risk2Impact: "Medio",
        risk2Mitigation: riskItems[1]?.mitigation || "Escalar decision con resumen ejecutivo y evidencia.",
        planB72,
        planBRejected:
          "Reformular propuesta por valor y fases para reducir friccion de aprobacion.",
        disqualificationSignal:
          "Sin decisor, sin siguiente paso y sin respuesta despues de dos ciclos ejecutivos.",
        internalDeadline: closeDateLabel,
        activityKpi:
          "Al menos una interaccion ejecutiva registrada por semana.",
        decisionKpi:
          "Compromiso de decision con fecha confirmada.",
        qualityKpi:
          "Resumen de valor y objeciones actualizado en cada hito.",
        weeklyTrafficLight: semaforoLabel,
        nextReview: closeDateLabel,
        qualityChecks,
        qualityScore,
        qualityStatus,
      },
    };
  }, [
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
    interactionsCount,
    riskItems,
  ]);

  const workspaceActions = Array.isArray(commercialContext?.workspace?.actions)
    ? commercialContext.workspace.actions
    : [];
  const previousActivities = workspaceActions
    .filter(
      (item) =>
        getWorkspaceEntryKind(item) === "activity" &&
        normalizeText(item?.actionType).toLowerCase() !== "call",
    )
    .sort((left, right) => {
      const leftDate = new Date(
        left?.scheduledAt || left?.dueDate || left?.updatedAt || left?.createdAt || 0,
      ).getTime();
      const rightDate = new Date(
        right?.scheduledAt || right?.dueDate || right?.updatedAt || right?.createdAt || 0,
      ).getTime();
      return rightDate - leftDate;
    });
  const previousActions = workspaceActions
    .filter(
      (item) =>
        getWorkspaceEntryKind(item) === "action" ||
        normalizeText(item?.actionType).toLowerCase() === "call",
    )
    .sort((left, right) => {
      const leftDate = new Date(
        left?.dueDate || left?.updatedAt || left?.createdAt || 0,
      ).getTime();
      const rightDate = new Date(
        right?.dueDate || right?.updatedAt || right?.createdAt || 0,
      ).getTime();
      return rightDate - leftDate;
    });
  const executionSummary = {
    actions: previousActions.length,
    activities: previousActivities.length,
    dependencies: executionDependencies.length,
  };

  useEffect(() => {
    if (!editingOpportunityId) {
      setActivityDraft({
        activityType: "call",
        objective: "",
        scheduledAt: "",
        note: "",
      });
      setActionDraft({
        actionType: "follow_up",
        objective: "",
        dueDate: "",
        note: "",
        priority: "medium",
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
    const defaultDateTime = toDateTimeLocalInputValue(defaultDate.toISOString());

    setActivityDraft({
      activityType: "call",
      objective: "",
      scheduledAt: defaultDateTime,
      note: "",
    });
    setActionDraft({
      actionType: "follow_up",
      objective: "",
      dueDate: defaultDateOnly,
      note: "",
      priority: "medium",
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
      api.get("/api/execution-commercial/dashboard"),
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
          Array.isArray(currentItem?.dependencies) ? currentItem.dependencies : [],
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

  async function refreshExecutionSection() {
    if (typeof refreshCommercialContext === "function") {
      await refreshCommercialContext();
    }
    setExecutionRefreshToken((current) => current + 1);
  }

  function openExecutionItemModal(itemType, item) {
    const currentStatus = normalizeText(item?.status).toLowerCase();
    const defaultStatus =
      currentStatus && currentStatus !== "pending" ? currentStatus : "done";
    const existingResult =
      itemType === "dependency"
        ? normalizeText(item?.resolutionNote || item?.details)
        : normalizeText(item?.notes || item?.note);

    setExecutionItemModal({
      itemType,
      item,
    });
    setExecutionItemUpdateDraft({
      status: defaultStatus,
      result: existingResult,
    });
    setExecutionItemModalError("");
  }

  function closeExecutionItemModal() {
    setExecutionItemModal(null);
    setExecutionItemModalError("");
  }

  async function handleSaveExecutionItemUpdate() {
    if (!editingOpportunityId || !executionItemModal?.item) return;

    const result = normalizeText(executionItemUpdateDraft.result);
    if (!result) {
      setExecutionItemModalError("Debes indicar un resultado antes de guardar.");
      return;
    }

    const { itemType, item } = executionItemModal;
    setSavingExecutionUpdate(true);
    setExecutionItemModalError("");
    setSourceError("");
    try {
      if (itemType === "dependency") {
        const dependencyStatus =
          executionItemUpdateDraft.status === "cancelled" ||
          executionItemUpdateDraft.status === "blocked"
            ? "blocked"
            : "done";
        await api.patch(`/api/execution-commercial/dependencies/${item.id}`, {
          status: dependencyStatus,
          resolutionNote: result,
          details: result,
        });
      } else {
        const isCallAction =
          itemType === "action" &&
          normalizeText(item?.actionType).toLowerCase() === "call";
        const entryKindForSave = isCallAction ? "activity" : itemType;
        const payload = {
          entryKind: entryKindForSave,
          activityType: normalizeText(item?.actionType) || "follow_up",
          objective: normalizeText(item?.title) || "Accion comercial",
          status:
            executionItemUpdateDraft.status === "done" ? "done" : "cancelled",
          note: result,
          details: {
            ...(item?.details || {}),
            entryKind: itemType,
            result,
          },
        };
        if (entryKindForSave === "activity") {
          payload.scheduledAt =
            item?.scheduledAt || `${toDateOnly(item?.dueDate) || new Date().toISOString().slice(0, 10)}T09:00`;
        } else {
          payload.dueDate =
            toDateOnly(item?.dueDate) || new Date().toISOString().slice(0, 10);
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

    setSavingExecutionItem("activity");
    setSourceError("");
    try {
      await api.post(
        `/api/execution-commercial/opportunities/${editingOpportunityId}/activities`,
        {
          entryKind: "activity",
          activityType: activityDraft.activityType,
          objective: activityDraft.objective,
          scheduledAt: activityDraft.scheduledAt,
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

  async function handleCreateAction() {
    if (!editingOpportunityId) return;

    const actionType = normalizeText(actionDraft.actionType) || "follow_up";
    const isCallAction = actionType === "call";
    const objective =
      normalizeText(actionDraft.objective) ||
      (actionType === "call" ? "Llamada de seguimiento" : "Accion comercial");
    const dueDate =
      normalizeText(actionDraft.dueDate) || new Date().toISOString().slice(0, 10);
    const scheduledAtForCall = `${dueDate}T09:00`;

    setSavingExecutionItem("action");
    setSourceError("");
    try {
      const payload = {
        entryKind: isCallAction ? "activity" : "action",
        activityType: actionType,
        objective,
        note: actionDraft.note,
        priority: actionDraft.priority,
        details: {
          entryKind: "action",
          requestedAs: "action",
        },
      };

      if (isCallAction) {
        payload.scheduledAt = scheduledAtForCall;
      } else {
        payload.dueDate = dueDate;
      }

      await api.post(
        `/api/execution-commercial/opportunities/${editingOpportunityId}/activities`,
        payload,
      );
      await refreshExecutionSection();
    } catch (error) {
      setSourceError(
        getApiErrorMessage(error, "No fue posible guardar la accion"),
      );
    } finally {
      setSavingExecutionItem("");
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
        {},
        { timeout: AI_NARRATIVE_TIMEOUT_MS },
      );

      const fallback = response?.data?.fallback || null;

      let resolvedData = response?.data;
      const createdJobStatus = normalizeText(resolvedData?.job?.status).toLowerCase();
      if (createdJobStatus) {
        setAiJobStatus(createdJobStatus);
      }
      if (!resolvedData?.result && normalizeText(resolvedData?.job?.id)) {
        const jobId = normalizeText(resolvedData.job.id);
        const deadline = Date.now() + AI_NARRATIVE_TOTAL_POLL_TIMEOUT_MS;
        let nextDelay = Math.max(
          Number(resolvedData?.job?.pollAfterMs || AI_NARRATIVE_POLL_INTERVAL_MS),
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
          const polledStatus = normalizeText(resolvedData?.job?.status).toLowerCase();
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
      const resultSource = normalizeText(resultPayload?.aiNarrativeSource).toLowerCase();
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
      const finalStatus = normalizeText(resolvedData?.job?.status).toLowerCase();
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
        source: "",
        generatedAt: null,
      });
      setAiJobStatus("pending");
      setShowAiDetail(false);
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
  const aiQualityScore = Number(aiCommercialBlueprint?.short?.qualityScore || 0);
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
        <p className="field-hint opportunity-development-warning">{sourceError}</p>
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
            <span className={`opportunity-development-ai-job-status is-${aiJobStatusTone}`}>
              Estado del job: {aiJobStatusLabel}
            </span>
          </div>
          <div className="opportunity-development-ai-short">
            <p>
              <strong>Etapa:</strong> {aiCommercialBlueprint.short.stageLabel}
            </p>
            <p>
              <strong>Prioridad comercial:</strong> {aiCommercialBlueprint.short.semaforoLabel}
            </p>
            <p>
              <strong>Dias sin movimiento:</strong> {aiCommercialBlueprint.short.daysWithoutMovement}
            </p>
            <p>
              <strong>Bloqueo principal:</strong> {aiCommercialBlueprint.short.bloqueoPrincipal}
            </p>
            <p>
              <strong>Accion en 72 horas:</strong> {aiCommercialBlueprint.short.accion72}
            </p>
            <p>
              <strong>Responsable:</strong> {aiCommercialBlueprint.short.sellerName}
            </p>
            <p>
              <strong>Compromiso:</strong> {aiCommercialBlueprint.short.commitmentLabel}
            </p>
            <p>
              <strong>Canal:</strong> {aiCommercialBlueprint.short.canal}
            </p>
            <p>
              <strong>Mensaje sugerido al cliente:</strong> {aiCommercialBlueprint.short.mensajeSugerido}
            </p>
            <p>
              <strong>Resultado esperado:</strong> {aiCommercialBlueprint.short.resultadoEsperado}
            </p>
            <p>
              <strong>Criterio de exito:</strong> {aiCommercialBlueprint.short.criterioBinario}
            </p>
            <p>
              <strong>Evidencia en CRM:</strong> {aiCommercialBlueprint.short.evidenciaCierre}
            </p>
            <p>
              <strong>Objetivo de etapa:</strong> {aiCommercialBlueprint.short.miniObjetivoEtapa}
            </p>
            <p>
              <strong>Plan B (si no responde en 72h):</strong> {aiCommercialBlueprint.short.planB72}
            </p>
            <p>
              <strong>Calidad de recomendacion:</strong> {aiCommercialBlueprint.short.qualityScore}/8
            </p>
            <p>
              <strong>Estado:</strong> {aiCommercialBlueprint.short.qualityStatus}
            </p>
          </div>
          <button
            type="button"
            className="opportunity-development-ai-detail-toggle"
            onClick={() => setShowAiDetail((current) => !current)}
          >
            {showAiDetail ? "Ocultar detalle" : "Ver detalle"}
          </button>
          {showAiDetail ? (
            <div className="opportunity-development-ai-detail">
              <div className="opportunity-development-ai-detail-block">
                <h6>Resumen ejecutivo de la oportunidad</h6>
                <p><strong>Oportunidad:</strong> {aiCommercialBlueprint.detail.opportunityName}</p>
                <p><strong>Cuenta:</strong> {aiCommercialBlueprint.detail.accountName}</p>
                <p><strong>Vendedor responsable:</strong> {aiCommercialBlueprint.detail.sellerName}</p>
                <p><strong>Etapa actual:</strong> {aiCommercialBlueprint.detail.stageLabel}</p>
                <p><strong>Monto estimado:</strong> {aiCommercialBlueprint.detail.amountLabel}</p>
                <p><strong>Fecha objetivo de cierre:</strong> {aiCommercialBlueprint.detail.closeDateLabel}</p>
                <p><strong>Estado comercial actual:</strong> {aiCommercialBlueprint.detail.commercialStatus}</p>
                <p><strong>Ultima actividad registrada:</strong> {aiCommercialBlueprint.detail.latestActivity}</p>
                <p><strong>Dias sin movimiento:</strong> {aiCommercialBlueprint.detail.daysWithoutMovement}</p>
              </div>

              <div className="opportunity-development-ai-detail-block">
                <h6>Diagnostico principal</h6>
                <p><strong>Bloqueo principal:</strong> {aiCommercialBlueprint.detail.bloqueoPrincipal}</p>
                <p><strong>Evidencia comercial relevante 1:</strong> {aiCommercialBlueprint.detail.evidencia1}</p>
                <p><strong>Evidencia comercial relevante 2:</strong> {aiCommercialBlueprint.detail.evidencia2}</p>
                <p><strong>Evidencia comercial relevante 3:</strong> {aiCommercialBlueprint.detail.evidencia3}</p>
                <p><strong>Nivel de confianza del diagnostico:</strong> {aiCommercialBlueprint.detail.confidence}</p>
                <p><strong>Dato critico faltante para elevar precision:</strong> {aiCommercialBlueprint.detail.missingData}</p>
              </div>

              <div className="opportunity-development-ai-detail-block">
                <h6>Plan de ejecucion inmediato (24-72 horas)</h6>
                <p><strong>Accion exacta:</strong> {aiCommercialBlueprint.detail.accion72}</p>
                <p><strong>Resultado esperado:</strong> {aiCommercialBlueprint.detail.resultadoEsperado}</p>
                <p><strong>Responsable:</strong> {aiCommercialBlueprint.detail.sellerName}</p>
                <p><strong>Fecha y hora compromiso:</strong> {aiCommercialBlueprint.detail.commitmentLabel}</p>
                <p><strong>Canal de ejecucion:</strong> {aiCommercialBlueprint.detail.canal}</p>
                <p><strong>Mensaje sugerido listo para usar:</strong> {aiCommercialBlueprint.detail.mensajeSugerido}</p>
                <p><strong>Entregable obligatorio en CRM:</strong> {aiCommercialBlueprint.detail.evidenciaCierre}</p>
                <p><strong>Criterio de exito binario:</strong> {aiCommercialBlueprint.detail.criterioBinario}</p>
              </div>

              <div className="opportunity-development-ai-detail-block">
                <h6>Estrategia de avance comercial (7-14 dias)</h6>
                <p><strong>Objetivo de etapa:</strong> {aiCommercialBlueprint.detail.miniObjetivoEtapa}</p>
                <p><strong>Estrategia seleccionada:</strong> {aiCommercialBlueprint.detail.estrategia}</p>
                <p><strong>Dia 0:</strong> {aiCommercialBlueprint.detail.day0}</p>
                <p><strong>Dia 2:</strong> {aiCommercialBlueprint.detail.day2}</p>
                <p><strong>Dia 5:</strong> {aiCommercialBlueprint.detail.day5}</p>
                <p><strong>Dia 10:</strong> {aiCommercialBlueprint.detail.day10}</p>
                <p><strong>Palanca de valor principal:</strong> {aiCommercialBlueprint.detail.valueLever}</p>
                <p><strong>Objecion mas probable:</strong> {aiCommercialBlueprint.detail.mainObjection}</p>
                <p><strong>Respuesta comercial recomendada:</strong> {aiCommercialBlueprint.detail.objectionResponse}</p>
                <p><strong>Sponsor:</strong> {aiCommercialBlueprint.detail.sponsor}</p>
                <p><strong>Decisor economico:</strong> {aiCommercialBlueprint.detail.economicDecider}</p>
                <p><strong>Compras/Legal:</strong> {aiCommercialBlueprint.detail.legalProcurement}</p>
                <p><strong>Influenciador tecnico:</strong> {aiCommercialBlueprint.detail.technicalInfluencer}</p>
              </div>

              <div className="opportunity-development-ai-detail-block">
                <h6>Riesgos criticos y mitigacion</h6>
                <p><strong>Riesgo 1:</strong> {aiCommercialBlueprint.detail.risk1}</p>
                <p><strong>Probabilidad:</strong> {aiCommercialBlueprint.detail.risk1Probability} <strong>Impacto:</strong> {aiCommercialBlueprint.detail.risk1Impact}</p>
                <p><strong>Mitigacion:</strong> {aiCommercialBlueprint.detail.risk1Mitigation}</p>
                <p><strong>Riesgo 2:</strong> {aiCommercialBlueprint.detail.risk2}</p>
                <p><strong>Probabilidad:</strong> {aiCommercialBlueprint.detail.risk2Probability} <strong>Impacto:</strong> {aiCommercialBlueprint.detail.risk2Impact}</p>
                <p><strong>Mitigacion:</strong> {aiCommercialBlueprint.detail.risk2Mitigation}</p>
              </div>

              <div className="opportunity-development-ai-detail-block">
                <h6>Escenarios alternos y disciplina comercial</h6>
                <p><strong>Plan B si no hay respuesta en 72 horas:</strong> {aiCommercialBlueprint.detail.planB72}</p>
                <p><strong>Plan B si rechazan propuesta:</strong> {aiCommercialBlueprint.detail.planBRejected}</p>
                <p><strong>Señal de pausa o descalificacion:</strong> {aiCommercialBlueprint.detail.disqualificationSignal}</p>
                <p><strong>Fecha limite de decision interna:</strong> {aiCommercialBlueprint.detail.internalDeadline}</p>
              </div>

              <div className="opportunity-development-ai-detail-block">
                <h6>Control de ejecucion comercial</h6>
                <p><strong>Indicador de actividad:</strong> {aiCommercialBlueprint.detail.activityKpi}</p>
                <p><strong>Indicador de avance de decision:</strong> {aiCommercialBlueprint.detail.decisionKpi}</p>
                <p><strong>Indicador de calidad de interaccion:</strong> {aiCommercialBlueprint.detail.qualityKpi}</p>
                <p><strong>Semaforo semanal:</strong> {aiCommercialBlueprint.detail.weeklyTrafficLight}</p>
                <p><strong>Proxima revision ejecutiva:</strong> {aiCommercialBlueprint.detail.nextReview}</p>
              </div>

              <div className="opportunity-development-ai-detail-block">
                <h6>Control de calidad de la recomendacion</h6>
                <ul className="opportunity-development-ai-quality-list">
                  {aiCommercialBlueprint.detail.qualityChecks.map((check, index) => (
                    <li key={check.id}>
                      {index + 1}. {check.text}: {check.ok ? "Si" : "No"}
                    </li>
                  ))}
                </ul>
                <p><strong>Puntaje final:</strong> {aiCommercialBlueprint.detail.qualityScore}/8</p>
                <p><strong>Regla de publicacion:</strong> {aiCommercialBlueprint.detail.qualityStatus === "Publicable" ? "Publicable" : "Menor a 6/8, requiere ajuste antes de publicar"}</p>
              </div>
            </div>
          ) : null}
      </article>

      <article className="opportunity-development-card opportunity-development-execution-card">
        <div className="opportunity-development-card-header">
          <div>
            <h5>Ejecucion comercial</h5>
            <span className="field-hint">
              Registra y da seguimiento sin salir de la oportunidad.
            </span>
          </div>
          <div className="opportunity-collapsible-section-actions">
            <div className="opportunity-development-execution-summary">
              <span className="record-id-badge">Acciones {executionSummary.actions}</span>
              <span className="record-id-badge">Actividades {executionSummary.activities}</span>
              <span className="record-id-badge">Dependencias {executionSummary.dependencies}</span>
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
          <span className="field-hint">Tres entradas rapidas para mantener orden operativo.</span>
        </div>
        <div className="opportunity-development-execution-grid">
          <div className="opportunity-development-execution-form" role="group" aria-label="Nueva accion">
            <div className="opportunity-development-execution-form-header">
              <h6>Accion</h6>
              <span className="record-id-badge state-pending">Nueva</span>
            </div>
            <div className="opportunity-development-execution-form-grid">
              <label>
                Tipo
                <select
                  value={actionDraft.actionType}
                  onChange={(event) =>
                    setActionDraft((current) => ({
                      ...current,
                      actionType: event.target.value,
                    }))
                  }
                >
                  {ACTION_TYPE_OPTIONS.map((option) => (
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
                  value={actionDraft.dueDate}
                  onChange={(event) =>
                    setActionDraft((current) => ({
                      ...current,
                      dueDate: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="is-span-2">
                Objetivo
                <input
                  value={actionDraft.objective}
                  onChange={(event) =>
                    setActionDraft((current) => ({
                      ...current,
                      objective: event.target.value,
                    }))
                  }
                  placeholder="Ej. confirmar fecha de comite de decision"
                />
              </label>
              <label className="is-span-2">
                Nota
                <textarea
                  rows={2}
                  value={actionDraft.note}
                  onChange={(event) =>
                    setActionDraft((current) => ({
                      ...current,
                      note: event.target.value,
                    }))
                  }
                  placeholder="Resultado esperado o contexto"
                />
              </label>
            </div>
            <button
              type="button"
              className="btn-secondary opportunity-development-execution-submit"
              onClick={handleCreateAction}
              disabled={savingExecutionItem === "action"}
            >
              {savingExecutionItem === "action" ? "Guardando..." : "Agregar accion"}
            </button>
          </div>

          <div className="opportunity-development-execution-form" role="group" aria-label="Nueva actividad">
            <div className="opportunity-development-execution-form-header">
              <h6>Actividad</h6>
              <span className="record-id-badge state-pending">Nueva</span>
            </div>
            <div className="opportunity-development-execution-form-grid">
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
                Agenda
                <input
                  type="datetime-local"
                  value={activityDraft.scheduledAt}
                  onChange={(event) =>
                    setActivityDraft((current) => ({
                      ...current,
                      scheduledAt: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="is-span-2">
                Objetivo
                <input
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
              <label className="is-span-2">
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
              {savingExecutionItem === "activity" ? "Guardando..." : "Agregar actividad"}
            </button>
          </div>

          <div className="opportunity-development-execution-form" role="group" aria-label="Nueva dependencia">
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
                <input
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
              {savingExecutionItem === "dependency" ? "Guardando..." : "Agregar dependencia"}
            </button>
          </div>
        </div>

        <div className="opportunity-development-execution-section-header is-history">
          <h6>Seguimiento</h6>
          <span className="field-hint">Consulta lo creado y actualiza estado desde el indicador lateral.</span>
        </div>
        <div className="opportunity-development-execution-history-grid">
          <div className="opportunity-development-execution-history">
            <div className="opportunity-development-execution-history-header">
              <h6>Acciones</h6>
              <span className="record-id-badge">{executionSummary.actions}</span>
            </div>
            {previousActions.length ? (
              <ul>
                {previousActions.map((item) => (
                  <li key={`action-${item.id}`}>
                    <div className="opportunity-development-execution-history-row">
                      <div className="opportunity-development-execution-history-main">
                        <strong>{item.title || "Sin titulo"}</strong>
                        <span>
                          {ACTION_TYPE_LABELS[item.actionType] || item.actionType || "Accion"} · {item.status || "pending"}
                        </span>
                        <span>
                          {item.dueDate ? `Fecha: ${toDateOnly(item.dueDate)}` : "Sin fecha"}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`opportunity-development-item-manage-button is-${getExecutionStatusTone(item.status)}`}
                      onClick={() => openExecutionItemModal("action", item)}
                      aria-label="Gestionar accion"
                      title="Marcar realizada o cancelar"
                    >
                      <ManageExecutionItemIcon tone={getExecutionStatusTone(item.status)} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="field-hint">Aun no hay acciones registradas.</p>
            )}
          </div>

          <div className="opportunity-development-execution-history">
            <div className="opportunity-development-execution-history-header">
              <h6>Actividades</h6>
              <span className="record-id-badge">{executionSummary.activities}</span>
            </div>
            {previousActivities.length ? (
              <ul>
                {previousActivities.map((item) => (
                  <li key={`activity-${item.id}`}>
                    <div className="opportunity-development-execution-history-row">
                      <div className="opportunity-development-execution-history-main">
                        <strong>{item.title || "Sin titulo"}</strong>
                        <span>
                          {ACTIVITY_TYPE_LABELS[item.actionType] || item.actionType || "Actividad"} · {item.status || "pending"}
                        </span>
                        <span>
                          {item.scheduledAt
                            ? `Agenda: ${formatNarrativeTimestamp(item.scheduledAt)}`
                            : item.dueDate
                              ? `Fecha: ${toDateOnly(item.dueDate)}`
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
                      <ManageExecutionItemIcon tone={getExecutionStatusTone(item.status)} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="field-hint">Aun no hay actividades registradas.</p>
            )}
          </div>

          <div className="opportunity-development-execution-history">
            <div className="opportunity-development-execution-history-header">
              <h6>Dependencias</h6>
              <span className="record-id-badge">{executionSummary.dependencies}</span>
            </div>
            {executionDependencies.length ? (
              <ul>
                {executionDependencies.map((item) => (
                  <li key={`dependency-${item.id}`}>
                    <div className="opportunity-development-execution-history-row">
                      <div className="opportunity-development-execution-history-main">
                        <strong>{item.title || "Sin titulo"}</strong>
                        <span>
                          {DEPENDENCY_TYPE_LABELS[item.dependencyType] || item.dependencyLabel || "Dependencia"} · {item.status || "open"}
                        </span>
                        <span>
                          {item.dueDate ? `Fecha: ${toDateOnly(item.dueDate)}` : "Sin fecha"}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`opportunity-development-item-manage-button is-${getExecutionStatusTone(item.status)}`}
                      onClick={() => openExecutionItemModal("dependency", item)}
                      aria-label="Gestionar dependencia"
                      title="Marcar realizada o cancelar"
                    >
                      <ManageExecutionItemIcon tone={getExecutionStatusTone(item.status)} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="field-hint">Aun no hay dependencias registradas.</p>
            )}
          </div>
        </div>
        </div>
      </article>

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
                className="btn-secondary"
                onClick={closeExecutionItemModal}
                disabled={savingExecutionUpdate}
              >
                Cerrar
              </button>
            </div>

            <div className="opportunity-development-item-modal-content">
              <p className="field-hint">
                <strong>{executionItemModal.item?.title || "Sin titulo"}</strong>
              </p>

              <label>
                Estado
                <select
                  value={executionItemUpdateDraft.status}
                  onChange={(event) =>
                    setExecutionItemUpdateDraft((current) => ({
                      ...current,
                      status: event.target.value,
                    }))
                  }
                  disabled={savingExecutionUpdate}
                >
                  <option value="done">Realizada</option>
                  <option value="cancelled">Cancelada</option>
                </select>
              </label>

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
                  disabled={savingExecutionUpdate}
                />
              </label>

              {executionItemModalError ? (
                <p className="field-hint opportunity-development-warning">
                  {executionItemModalError}
                </p>
              ) : null}

              <div className="opportunity-development-item-modal-actions">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleSaveExecutionItemUpdate}
                  disabled={savingExecutionUpdate}
                >
                  {savingExecutionUpdate ? "Guardando..." : "Guardar resultado"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
