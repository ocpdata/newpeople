import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Database,
  LayoutDashboard,
  Lightbulb,
  MessageCircle,
  Pencil,
  Search,
  Settings2,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";
import { api, getApiErrorMessage } from "./api";
import "./mi-agent.css";
import "./mi-agent-navigation.css";
import "./mi-agent-detail.css";
import "./mi-agent-execution-kit.css";
import "./mi-agent-health.css";
import "./mi-agent-alerts.css";
import "./mi-agent-activity-progress.css";
import "./mi-agent-activity-message.css";
import "./mi-agent-coach.css";
import "./mi-agent-feedback.css";
import "./mi-agent-rules.css";
import "./mi-agent-coach-thread.css";

const PRIORITY_LABELS = {
  critical: "Critica",
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

const ACTION_STATUS_LABELS = {
  pending: "Pendiente",
  done: "Creada",
};

const CUSTOMER_ACTIVITY_STATUS_LABELS = {
  pending: "Pendiente",
  in_progress: "En curso",
  done: "Completada",
  completed: "Completada",
  cancelled: "Cancelada",
  blocked: "Bloqueada",
};

const CUSTOMER_ACTIVITY_TYPE_LABELS = {
  producto: "Producto",
  service: "Servicio",
  servicio: "Servicio",
  call: "Llamada",
  meeting: "Reunión",
  email: "Correo",
  visit: "Visita",
  demo: "Demostración",
  presentation: "Presentación",
};

const COACH_POLL_TIMEOUT_MS = 180000;
const COACH_FOUNDATION_VISIBILITY_KEY = "mi-agent-coach-show-foundation";
const CUSTOMER_CHAT_FOUNDATION_VISIBILITY_KEY =
  "mi-agent-customer-chat-show-foundation";
const customerChatSessionKey = (accountId) =>
  `mi-agent-customer-chat-session:${Number(accountId || 0)}`;

const COACH_HANDOFF_OPERATION_KINDS = new Set([
  "activity",
  "create_account",
  "create_contact",
  "create_opportunity",
  "create_lead",
  "create_contact_mapping",
  "create_quotation",
  "create_proposal",
  "lead_resolve",
]);

const COACH_RESPONSE_TYPE_LABELS = {
  informational: "Consulta informativa",
  recommendation: "Recomendación",
  change_request: "Solicitud de cambio",
  operation: "Operación completada",
  error: "Error de operación",
  handoff: "Continuar en otro espacio",
};

const COACH_RULE_CHANNEL_LABELS = {
  coach: "Coach",
  customer_account: "Cliente existente",
  prospect: "Cuenta nueva",
};

const COACH_INTERACTION_MODE_LABELS = {
  coaching: "Coaching del vendedor",
  brief_context: "Contexto breve",
  deep_exploration: "Exploración detallada",
  operation: "Propuesta de operación",
};

const COACH_INTENT_PROCESS_OPTIONS = [
  {
    value: "seller_coaching",
    label: "Desempeño y prioridades del vendedor",
    description:
      "Usa señales resumidas del pipeline para recomendar qué mejorar y qué atender primero.",
  },
  {
    value: "unknown",
    label: "Consulta no identificada",
    description:
      "Se aplica cuando el motor no logra reconocer con claridad qué tipo de consulta recibió.",
  },
  {
    value: "operation",
    label: "Proponer una acción o cambio",
    description:
      "Se aplica cuando el usuario pide crear o modificar algo; no ejecuta la operación por sí sola.",
  },
  {
    value: "stage_readiness",
    label: "Evaluar una oportunidad para avanzar",
    description:
      "Se aplica al revisar preparación, pendientes o riesgos de una oportunidad concreta.",
  },
  {
    value: "account_ranking",
    label: "Comparar cuentas por sus oportunidades",
    description:
      "Se aplica al ordenar o comparar cuentas usando la cobertura de sus oportunidades.",
  },
  {
    value: "temporal_filter",
    label: "Consultar por fecha o periodo",
    description:
      "Se aplica a preguntas que filtran oportunidades por fecha de cierre o periodo.",
  },
  {
    value: "opportunity_query",
    label: "Consultar oportunidades",
    description:
      "Se aplica a búsquedas y preguntas sobre oportunidades, sus estados o etapas.",
  },
  {
    value: "lead_query",
    label: "Consultar leads",
    description:
      "Se aplica a búsquedas y preguntas sobre leads o prospectos registrados.",
  },
  {
    value: "general_query",
    label: "Pregunta general o informativa",
    description:
      "Se aplica a preguntas que no requieren consultar un tipo específico de registro.",
  },
  {
    value: "account_query",
    label: "Consultar una cuenta",
    description: "Se aplica a resúmenes e información de una cuenta del CRM.",
  },
  {
    value: "contact_query",
    label: "Consultar contactos y decisores",
    description:
      "Se aplica a preguntas sobre contactos relacionados con una cuenta u oportunidad.",
  },
  {
    value: "activity_query",
    label: "Consultar actividades",
    description:
      "Se aplica a preguntas sobre actividades y siguientes pasos de una oportunidad.",
  },
  {
    value: "quotation_query",
    label: "Consultar una cotización",
    description:
      "Se aplica a preguntas sobre el contenido comercial de la cotización de una oportunidad.",
  },
];

function getCoachProcessOption(process, channel = "coach") {
  if (process === "default") {
    return {
      label: "Configuración predeterminada del canal",
      description:
        "Esta configuración sirve de base para el canal y se usa cuando no hay una específica para el tipo de consulta.",
    };
  }
  if (channel === "prospect") {
    return {
      label: "Conversación de cuenta nueva",
      description:
        "Abarca la conversación del canal de prospección y sus límites de datos y operaciones.",
    };
  }
  if (channel === "customer_account") {
    return {
      label: "Conversación de cliente existente",
      description:
        "Abarca la conversación vinculada a la cuenta seleccionada y sus límites de datos y operaciones.",
    };
  }
  return (
    COACH_INTENT_PROCESS_OPTIONS.find((option) => option.value === process) || {
      label: "Tipo de consulta personalizado",
      description: "Configuración específica para este código de consulta.",
    }
  );
}

const COACH_OPPORTUNITY_STAGE_OPTIONS = [
  { code: "contacto_inicial", label: "Contacto Inicial" },
  {
    code: "identificacion_oportunidad",
    label: "Identificación de Oportunidad",
  },
  { code: "desarrollo", label: "Desarrollo" },
  { code: "cotizacion", label: "Cotización" },
  { code: "demostracion", label: "Demostración" },
  { code: "negociacion", label: "Negociación" },
  { code: "waiting", label: "Waiting" },
];

const COACH_OPERATION_OPTIONS = {
  coach: [
    ["activity", "Actividad"],
    ["stage_answer", "Respuesta de etapa"],
    ["lead_call_outcome", "Resultado de llamada de lead"],
    ["account_field", "Campo de cuenta"],
    ["contact_field", "Campo de contacto"],
    ["opportunity_field", "Campo de oportunidad"],
  ],
  customer_account: [
    ["activity", "Actividad"],
    ["stage_answer", "Respuesta de etapa"],
    ["lead_call_outcome", "Resultado de llamada de lead"],
    ["account_field", "Campo de cuenta"],
    ["contact_field", "Campo de contacto"],
    ["opportunity_field", "Campo de oportunidad"],
  ],
  prospect: [
    ["create_account", "Crear cuenta"],
    ["create_contact", "Crear contacto"],
    ["create_opportunity", "Crear oportunidad"],
  ],
};

const COACH_CONFIDENCE_LABELS = {
  high: "Alta confianza",
  medium: "Confianza media",
  low: "Baja confianza",
};

const STAGE_READINESS_RECOMMENDATION_LABELS = {
  advance: "Avanzar",
  advance_with_caution: "Avanzar con cautela",
  remain: "Permanecer en la etapa",
};

const COACH_OPERATION_STATUS_META = {
  proposed: { label: "Propuesta", tone: "neutral" },
  collecting: { label: "Información incompleta", tone: "attention" },
  ready: { label: "Lista para revisar", tone: "actionable" },
  handed_off: { label: "Pendiente en módulo", tone: "progress" },
  executing: { label: "Aplicando cambio", tone: "progress" },
  completed: { label: "Completada", tone: "success" },
  failed: { label: "Requiere atención", tone: "error" },
  rejected: { label: "Rechazada", tone: "neutral" },
  cancelled: { label: "Cancelada", tone: "neutral" },
  superseded: { label: "Reemplazada", tone: "neutral" },
  reverted: { label: "Revertida", tone: "attention" },
};

const COACH_OPERATION_LABELS = {
  activity: "Registrar actividad",
  stage_answer: "Actualizar respuesta de etapa",
  opportunity_field: "Actualizar oportunidad",
  account_field: "Actualizar cuenta",
  contact_field: "Actualizar contacto",
  lead_call_outcome: "Registrar resultado del lead",
  lead_resolve: "Resolver lead",
  create_account: "Crear cuenta",
  create_contact: "Crear contacto",
  create_opportunity: "Crear oportunidad",
  create_lead: "Crear lead",
  create_contact_mapping: "Crear mapeo de contacto",
  create_quotation: "Crear cotización",
  create_proposal: "Crear propuesta",
};

const COACH_TARGET_MODULE_LABELS = {
  accounts: "Cuentas",
  contacts: "Contactos",
  opportunities: "Oportunidades",
  interactions: "Leads",
  contact_mapping: "Mapeo de contactos",
  quotations: "Cotizaciones",
  proposals: "Propuestas",
  commercial_development: "Desarrollo comercial",
};

const COACH_SOURCE_LABELS = {
  account: "Cuenta",
  contact: "Contacto",
  opportunity: "Oportunidad",
  lead: "Lead",
  stage_answer: "Respuesta de etapa",
  activity: "Actividad",
  quotation: "Cotización",
  proposal: "Propuesta",
  document: "Documento",
  process_guide: "Proceso comercial",
  crm_context: "CRM",
  conversation: "Conversación",
};

const COACH_ACTIVITY_TYPE_OPTIONS = [
  ["call", "Llamada"],
  ["conference", "Reunión"],
  ["presentation", "Demostración"],
  ["visit", "Visita"],
  ["send_email", "Correo"],
  ["next_step", "Tarea de seguimiento"],
  ["waiting_customer", "Esperando cliente"],
  ["other", "Otro"],
];

const COACH_ACTIVITY_TYPE_ALIASES = {
  meeting: "conference",
  demo: "presentation",
  follow_up: "call",
};

const CUSTOMER_FINDING_CATEGORY_LABELS = {
  company_profile: "Perfil de empresa",
  business_challenge: "Reto de negocio",
  technology_project: "Proyecto tecnológico",
  stakeholder: "Contacto / influencia",
  decision_area: "Área de decisión",
  need: "Necesidad",
  pain_point: "Dolor",
  risk: "Riesgo",
  next_step: "Siguiente paso",
  missing_information: "Hueco de información",
};

const CUSTOMER_FINDING_STATUS_LABELS = {
  suggested: "Sugerido",
  confirmed: "Confirmado",
  rejected: "Rechazado",
  outdated: "Obsoleto",
};

const CUSTOMER_FINDING_CONFIDENCE_LABELS = {
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

const CUSTOMER_QUOTATION_STATUS_LABELS = {
  won: "Ganada",
  ganada: "Ganada",
  accepted: "Aceptada",
  aceptada: "Aceptada",
  draft: "Borrador",
  borrador: "Borrador",
  sent: "Enviada",
  enviada: "Enviada",
  rejected: "Rechazada",
  rechazada: "Rechazada",
  pending: "Pendiente",
  pendiente: "Pendiente",
};

const CUSTOMER_FINDING_APPLY_FIELDS = {
  account: [
    ["description", "Descripción"],
    ["website", "Sitio web"],
    ["phone", "Teléfono"],
    ["city", "Ciudad"],
    ["stateRegion", "Estado / región"],
  ],
  contact: [
    ["positionTitle", "Puesto"],
    ["department", "Departamento"],
    ["email", "Correo"],
    ["phone", "Teléfono"],
    ["mobile", "Móvil"],
    ["city", "Ciudad"],
    ["stateRegion", "Estado / región"],
  ],
  opportunity: [["name", "Nombre"]],
};

function normalizeCoachActivityType(value) {
  return COACH_ACTIVITY_TYPE_ALIASES[value] || value || "other";
}

function formatCurrency(value, currency = "USD") {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(date);
}

function formatCoachRecommendation(recommendation) {
  if (!recommendation) return "Sin recomendación adicional.";
  return typeof recommendation === "object"
    ? recommendation.action || "Sin recomendación adicional."
    : recommendation;
}

function formatCoachDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : new Intl.DateTimeFormat("es-MX", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function CoachEvidenceList({ evidence = [] }) {
  if (!evidence.length) return null;
  return (
    <ul className="mi-agent-coach-evidence-list">
      {evidence.map((item, index) => {
        const structured = item && typeof item === "object";
        return (
          <li
            key={`${structured ? item.sourceType : "evidence"}-${structured ? item.sourceId : index}-${index}`}
          >
            {structured ? (
              <>
                <span>
                  {COACH_SOURCE_LABELS[item.sourceType] || item.sourceType}
                </span>
                <strong>{item.label}</strong>
                {item.excerpt ? <small>{item.excerpt}</small> : null}
              </>
            ) : (
              <span>{item}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function CoachSemanticSections({ result }) {
  const sections = [
    {
      key: "facts",
      title: "Hechos",
      icon: Database,
      items: result?.facts || [],
    },
    {
      key: "evidence",
      title: "Evidencia",
      icon: Search,
      items: result?.evidence || [],
    },
    {
      key: "inferences",
      title: "Inferencias",
      icon: AlertCircle,
      items: result?.inferences || [],
    },
  ].filter((section) => section.items.length);
  const recommendation = formatCoachRecommendation(result?.recommendation);

  if (!sections.length && !result?.recommendation) return null;
  return (
    <div className="mi-agent-coach-semantic" aria-label="Fundamento del Coach">
      {sections.map(({ key, title, icon, items }) => (
        <section className={`is-${key}`} key={key}>
          <h5>
            {createElement(icon, { size: 14, "aria-hidden": true })}
            {title}
          </h5>
          <CoachEvidenceList evidence={items} />
        </section>
      ))}
      {result?.recommendation ? (
        <section className="is-recommendation">
          <h5>
            <Lightbulb size={14} aria-hidden="true" />
            Recomendación
          </h5>
          <p>{recommendation}</p>
        </section>
      ) : null}
    </div>
  );
}

function CoachStageReadiness({ readiness }) {
  if (!readiness) return null;

  const completedCount = readiness.confirmedProgress?.length || 0;
  const pendingCount = readiness.pendingItems?.length || 0;
  const totalCount = completedCount + pendingCount;
  const diagnosisLabel =
    readiness.recommendation === "advance"
      ? "Sólida"
      : readiness.recommendation === "advance_with_caution"
        ? "Parcial"
        : "Débil";
  const principalWeakness =
    readiness.risks?.[0]?.title ||
    readiness.pendingItems?.[0]?.title ||
    "Sin debilidad identificada";

  const renderItems = (items, emptyMessage, includeSeverity = false) =>
    items?.length ? (
      <ul>
        {items.map((item, index) => (
          <li key={`${item.title}-${index}`}>
            <strong>{item.title}</strong>
            {includeSeverity ? (
              <span className={`is-${item.severity}`}>{item.severity}</span>
            ) : null}
            <small>{item.detail}</small>
            {item.mitigation ? (
              <small>Mitigación: {item.mitigation}</small>
            ) : null}
            <CoachEvidenceList evidence={item.evidence} />
          </li>
        ))}
      </ul>
    ) : (
      <p className="mi-agent-stage-readiness-empty">{emptyMessage}</p>
    );

  return (
    <section
      className="mi-agent-stage-readiness"
      aria-label="Preparación de etapa"
    >
      <div className="mi-agent-stage-readiness-stage">
        <div>
          <small>Etapa actual</small>
          <strong>{readiness.currentStage.name}</strong>
          <p>{readiness.currentStage.objective}</p>
        </div>
        <div className="mi-agent-stage-readiness-score">
          <span>{diagnosisLabel}</span>
          <strong>
            {completedCount}/{totalCount || 0}
          </strong>
          <small>dimensiones confirmadas</small>
        </div>
      </div>
      <div className="mi-agent-stage-readiness-weakness">
        <AlertCircle size={15} aria-hidden="true" />
        <span>Principal punto de atención</span>
        <strong>{principalWeakness}</strong>
      </div>
      <div className="mi-agent-stage-readiness-grid">
        <section>
          <h5>Avances confirmados</h5>
          {renderItems(readiness.confirmedProgress, "Sin avances confirmados.")}
        </section>
        <section>
          <h5>Pendientes</h5>
          {renderItems(readiness.pendingItems, "Sin pendientes.")}
        </section>
        <section>
          <h5>Riesgos</h5>
          {renderItems(readiness.risks, "Sin riesgos abiertos.", true)}
        </section>
      </div>
      <div className="mi-agent-stage-readiness-next">
        <small>Siguiente paso</small>
        <strong>{readiness.nextStep.action}</strong>
        <p>{readiness.nextStep.successCriteria}</p>
        <span>
          Responsable {readiness.nextStep.responsibleUserId || "por asignar"}
          {readiness.nextStep.targetDate
            ? ` · ${formatDate(readiness.nextStep.targetDate)}`
            : ""}
        </span>
      </div>
      <div
        className={`mi-agent-stage-readiness-recommendation is-${readiness.recommendation}`}
      >
        <small>Recomendación de avance</small>
        <strong>
          {STAGE_READINESS_RECOMMENDATION_LABELS[readiness.recommendation] ||
            readiness.recommendation}
        </strong>
        <p>{readiness.rationale}</p>
      </div>
    </section>
  );
}

function buildCoachOperationDraft(operation, persistedOperation = null) {
  const pendingOperation =
    persistedOperation?.pendingOperation || operation || {};
  const operationWithMissingFields = {
    ...pendingOperation,
    missingFields:
      persistedOperation?.missingFields || pendingOperation.missingFields || [],
  };
  return {
    operation: operationWithMissingFields,
    opportunityId: pendingOperation.opportunityId || "",
    value: pendingOperation.value || pendingOperation.answerValue || "",
    answerMode: pendingOperation.answerMode || "replace",
    payload: pendingOperation.payload || {},
    persistentId:
      persistedOperation?.id || pendingOperation.persistentId || null,
    version:
      persistedOperation?.version || pendingOperation.persistenceVersion || 1,
    persistenceStatus:
      persistedOperation?.status ||
      pendingOperation.persistenceStatus ||
      "ready",
    reviewedAt: persistedOperation?.reviewedAt || null,
  };
}

function serializeCoachOperationDraft(draft) {
  const operation = { ...(draft?.operation || {}) };
  delete operation.persistenceStatus;
  delete operation.persistenceVersion;
  if (
    [
      "create_account",
      "create_contact",
      "create_opportunity",
      "create_lead",
      "create_contact_mapping",
      "create_quotation",
      "create_proposal",
      "lead_resolve",
    ].includes(operation.kind)
  ) {
    operation.payload = draft.payload || {};
  } else if (operation.kind === "stage_answer") {
    operation.answerValue = draft.value;
    operation.answerMode = draft.answerMode;
  } else if (operation.kind === "lead_call_outcome") {
    operation.comment = draft.value;
  } else if (operation.kind === "activity") {
    operation.opportunityId = Number(draft.opportunityId || 0) || null;
  } else if (operation.field) {
    operation.value = draft.value;
  }
  return operation;
}

function unresolvedCoachFields(operation) {
  const payload = operation?.payload || {};
  return (operation?.missingFields || []).filter((field) => {
    const value = payload[field] ?? operation[field];
    return value === null || value === undefined || String(value).trim() === "";
  });
}

function isUsablePublicContactValue(value) {
  const text = String(value || "").trim();
  return Boolean(text) && !/[*xX]{2,}/.test(text);
}

function CoachQualityFeedback({ traceId }) {
  const [category, setCategory] = useState("response");
  const [submittedRating, setSubmittedRating] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedbackError, setFeedbackError] = useState("");
  const categoryDescriptions = {
    intent: "¿Entendió qué estabas pidiendo?",
    entity: "¿Identificó la cuenta, oportunidad o persona correcta?",
    response: "¿La respuesta fue clara y resolvió tu pregunta?",
    evidence: "¿Los datos y las fuentes respaldan lo que respondió?",
    other: "¿Hay otro problema que no encaja en las categorías anteriores?",
  };

  async function submit(rating) {
    if (!traceId || submitting) return;
    setSubmitting(true);
    setFeedbackError("");
    try {
      await api.post(`/api/mi-agent/coach/quality/${traceId}/feedback`, {
        rating,
        category,
        corrected: rating === "negative",
      });
      setSubmittedRating(rating);
    } catch (requestError) {
      setFeedbackError(
        getApiErrorMessage(requestError, "No se pudo registrar el feedback"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!traceId) return null;
  return (
    <div
      className="mi-agent-quality-feedback"
      aria-label="Evaluar respuesta del Coach"
    >
      <div className="mi-agent-quality-feedback-copy">
        <strong>¿Cómo evalúas esta respuesta?</strong>
        <label>
          <span>Aspecto</span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            disabled={submitting || Boolean(submittedRating)}
          >
            <option value="intent">Interpretación de la solicitud</option>
            <option value="entity">Identificación del registro</option>
            <option value="response">
              Claridad y utilidad de la respuesta
            </option>
            <option value="evidence">Exactitud de datos y evidencia</option>
            <option value="other">Otro aspecto</option>
          </select>
        </label>
        <small>{categoryDescriptions[category]}</small>
      </div>
      <div
        className="mi-agent-quality-feedback-actions"
        aria-label="Calificación"
      >
        <button
          type="button"
          className={submittedRating === "positive" ? "is-selected" : ""}
          title="Útil y correcta"
          aria-label="Marcar respuesta como útil y correcta"
          disabled={submitting || Boolean(submittedRating)}
          onClick={() => submit("positive")}
        >
          <ThumbsUp size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={submittedRating === "negative" ? "is-selected" : ""}
          title="Necesita corrección"
          aria-label="Marcar que la respuesta necesita corrección"
          disabled={submitting || Boolean(submittedRating)}
          onClick={() => submit("negative")}
        >
          <ThumbsDown size={16} aria-hidden="true" />
        </button>
        {submittedRating ? (
          <small className="mi-agent-quality-feedback-status" role="status">
            {submittedRating === "positive"
              ? "Gracias, registrado"
              : "Corrección registrada"}
          </small>
        ) : null}
        {feedbackError ? (
          <small className="mi-agent-quality-feedback-error" role="alert">
            {feedbackError}
          </small>
        ) : null}
      </div>
    </div>
  );
}

function buildSnapshot(dashboard) {
  const development = dashboard?.development || dashboard || {};
  const quota = development.quota || {};
  const workboard = Array.isArray(dashboard?.workboard)
    ? dashboard.workboard
    : [];
  // El endpoint propio de Mi agente ya devuelve únicamente oportunidades calificadas.
  const qualified = workboard;
  const coachOpportunities = Array.isArray(dashboard?.coachOpportunities)
    ? dashboard.coachOpportunities
    : qualified;
  const openPipeline = coachOpportunities.filter(
    (item) => item.lifecycle === "open",
  );
  const currencyCode =
    quota.currencyCode ||
    development.period?.baseCurrencyCode ||
    dashboard?.period?.baseCurrencyCode ||
    "USD";
  const currencyConversionAvailable =
    dashboard?.currencyConversion?.available ?? currencyCode === "USD";

  return {
    period: development.period || dashboard?.period || null,
    quota: {
      assignedAmount: Number(quota.assignedAmount || 0),
      actualAmount:
        quota.actualAmount == null ? null : Number(quota.actualAmount),
      gapAmount: quota.gapAmount == null ? null : Number(quota.gapAmount),
      committedOpenAmount:
        quota.committedOpenAmount == null
          ? null
          : Number(quota.committedOpenAmount),
      weightedOpenAmount:
        quota.weightedOpenAmount == null
          ? null
          : Number(quota.weightedOpenAmount),
      currencyCode,
      currencyConversionAvailable,
      usdToQuotaRate: Number(
        dashboard?.currencyConversion?.usdToTargetRate ?? 1,
      ),
      currencyRateFetchedAt: dashboard?.currencyConversion?.fetchedAt || null,
    },
    pipeline: {
      openAmount: !currencyConversionAvailable
        ? null
        : openPipeline.reduce(
            (sum, item) =>
              sum +
              Number(item.amountUsd ?? item.amount_usd ?? 0) *
                Number(dashboard?.currencyConversion?.usdToTargetRate ?? 1),
            0,
          ),
      openCount: openPipeline.length,
      qualifiedAmount: qualified.reduce(
        (sum, item) => sum + Number(item.amountUsd || 0),
        0,
      ),
      qualifiedCount: qualified.length,
      opportunities: qualified.map((item) => ({
        id: Number(item.id),
        name: item.name || "",
        accountName: item.accountName || "",
        amountUsd: Number(item.amountUsd || 0),
        closeDate: item.closeDate || null,
        updatedAt: item.updatedAt || null,
        stageCode: item.stageCode || "",
        stageName: item.stageName || "",
        riskLevel: item.riskLevel || "low",
        riskReasons: Array.isArray(item.riskReasons)
          ? item.riskReasons.slice(0, 4)
          : [],
        daysSinceActivity: Number(item.daysSinceActivity || 0),
        currentStageValidated: Boolean(item.currentStageValidated),
        openWeaknesses: Array.isArray(item.openWeaknesses)
          ? item.openWeaknesses
          : [],
        nextStep: item.nextStep || null,
        nextPendingAction: item.nextPendingAction || null,
        recommendedStrategySteps: Array.isArray(item.recommendedStrategySteps)
          ? item.recommendedStrategySteps.slice(0, 3)
          : [],
      })),
    },
    coachOpportunities,
    wonOpportunities: Array.isArray(dashboard?.wonOpportunities)
      ? dashboard.wonOpportunities
      : [],
    lostOpportunities: Array.isArray(dashboard?.lostOpportunities)
      ? dashboard.lostOpportunities
      : [],
    cancelledOpportunities: Array.isArray(dashboard?.cancelledOpportunities)
      ? dashboard.cancelledOpportunities
      : [],
    inactivePipelineOpportunities: Array.isArray(
      dashboard?.inactivePipelineOpportunities,
    )
      ? dashboard.inactivePipelineOpportunities
      : [],
    accounts: Array.isArray(dashboard?.accounts) ? dashboard.accounts : [],
    contactMappings: Array.isArray(dashboard?.contactMappings)
      ? dashboard.contactMappings
      : [],
    summary: dashboard?.summary || {},
  };
}

function buildCoachOpportunityOptions(openOpportunities, snapshot, accountId) {
  const normalizedAccountId = Number(accountId || 0);
  const open = (Array.isArray(openOpportunities) ? openOpportunities : []).map(
    (opportunity) => ({ ...opportunity, contextGroup: "open" }),
  );
  const historicalGroups = [
    ["wonOpportunities", "won"],
    ["lostOpportunities", "lost"],
    ["cancelledOpportunities", "cancelled"],
  ];
  const historical = historicalGroups.flatMap(([key, contextGroup]) =>
    (Array.isArray(snapshot?.[key]) ? snapshot[key] : [])
      .filter(
        (opportunity) =>
          Number(opportunity.account?.id || opportunity.accountId || 0) ===
          normalizedAccountId,
      )
      .map((opportunity) => ({ ...opportunity, contextGroup })),
  );
  const unique = new Map();
  [...open, ...historical].forEach((opportunity) => {
    unique.set(Number(opportunity.id), opportunity);
  });
  return [...unique.values()];
}

function formatCoachOperationLabel(operation) {
  const title = String(operation?.pendingOperation?.title || "").trim();
  if (title && title.toLowerCase() !== "unknown") return title;
  const kind =
    operation?.kind && operation.kind !== "unknown"
      ? operation.kind
      : operation?.pendingOperation?.kind;
  return COACH_OPERATION_LABELS[kind] || "Acción pendiente";
}

function formatCoachTargetModule(targetModule) {
  return COACH_TARGET_MODULE_LABELS[targetModule] || "";
}

function formatCoachOperationSummary(operation) {
  if (operation?.kind === "activity") {
    return `${operation.actionType || "Actividad"} · ${operation.scheduledAt || "Fecha pendiente"} · ${operation.priority || "Prioridad pendiente"}`;
  }
  if (operation?.kind === "stage_answer")
    return `Respuesta de etapa: ${operation.answerValue || "Pendiente"}`;
  if (operation?.kind === "lead_call_outcome")
    return `Resultado del lead: ${operation.substatusCode || "Pendiente"}`;
  if (operation?.kind === "lead_resolve") return "Resolver y materializar lead";
  if (operation?.kind === "create_account") return "Crear cuenta";
  if (operation?.kind === "create_contact") return "Crear contacto";
  if (operation?.kind === "create_opportunity") return "Crear oportunidad";
  return `${formatCoachFieldLabel(operation?.field)}: ${operation?.value ?? "Valor pendiente"}`;
}

function formatCoachFieldLabel(field) {
  const labels = {
    amountUsd: "Importe de la oportunidad",
    closeDate: "Fecha de cierre",
    name: "Nombre",
    phone: "Teléfono",
    website: "Sitio web",
    companyDescription: "Descripción de la empresa",
    firstName: "Nombre",
    lastName: "Apellido",
    email: "Correo",
    mobile: "Móvil",
    city: "Ciudad",
    stateRegion: "Estado o región",
    postalCode: "Código postal",
    registrationCode: "Código de registro",
    summary: "Resumen",
    sourceNotes: "Notas de origen",
    proposalName: "Nombre de cotización",
    quotationDate: "Fecha de cotización",
    introduction: "Introducción",
    paymentTerms: "Condiciones de pago",
    quotationVersionId: "Versión de cotización",
    sourceProposalId: "Propuesta de origen",
    templateId: "Plantilla",
    opportunityId: "Oportunidad",
    title: "Título",
    actionType: "Tipo de actividad",
    scheduledAt: "Fecha y hora",
    dueDate: "Fecha límite",
    priority: "Prioridad",
    notes: "Notas",
    successCriteria: "Criterio de éxito",
  };
  return labels[field] || field || "Cambio";
}

export default function MiAgentPage({
  canExecuteCoach = false,
  canCreateActions = false,
  canUpdateLeads = false,
  canReadLeads = false,
  canCreateLeads = false,
  canUpdateAccounts = false,
  canUpdateContacts = false,
  canCreateAccounts = false,
  canCreateContacts = false,
  canResolveLeads = false,
  canCreateOpportunities = false,
  canUpdateCommercialDevelopment = false,
  canCreateQuotations = false,
  canCreateProposals = false,
  canUseExternalSources = false,
  canReadProspecting = false,
  canCreateProspecting = false,
  canUpdateProspecting = false,
  canReadCustomerIntelligence = false,
  canManageCoach = false,
}) {
  const navigate = useNavigate();
  const [activeWorkspace, setActiveWorkspace] = useState("summary");
  const [dashboard, setDashboard] = useState(null);
  const [coachAccounts, setCoachAccounts] = useState([]);
  const [coachOpportunities, setCoachOpportunities] = useState([]);
  const [coachContacts, setCoachContacts] = useState([]);
  const [coachContext, setCoachContext] = useState({
    accountId: "",
    opportunityId: "",
    contactId: "",
    leadId: "",
  });
  const [coachSessionId, setCoachSessionId] = useState(null);
  const [loadingCoachContext, setLoadingCoachContext] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [creatingActionRank, setCreatingActionRank] = useState(null);
  const [error, setError] = useState("");
  const [coachNotice, setCoachNotice] = useState("");
  const [selectedAction, setSelectedAction] = useState(null);
  const [coachQuestion, setCoachQuestion] = useState("");
  const [askingCoach, setAskingCoach] = useState(false);
  const [coachMessages, setCoachMessages] = useState([]);
  const [showCoachFoundation, setShowCoachFoundation] = useState(
    () =>
      window.localStorage.getItem(COACH_FOUNDATION_VISIBILITY_KEY) === "true",
  );
  const [coachMetrics, setCoachMetrics] = useState(null);
  const [coachActionDraft, setCoachActionDraft] = useState(null);
  const [coachOperationDraft, setCoachOperationDraft] = useState(null);
  const [coachOperationOpportunityOptionsOverride, setCoachOperationOpportunityOptionsOverride] =
    useState(null);
  const [coachPendingOperations, setCoachPendingOperations] = useState([]);
  const [coachRecentOperations, setCoachRecentOperations] = useState([]);
  const [coachUndoOperationId, setCoachUndoOperationId] = useState(null);
  const [savingCoachOperation, setSavingCoachOperation] = useState(false);
  const [coachDraftSaving, setCoachDraftSaving] = useState(false);
  const [coachOperationAction, setCoachOperationAction] = useState({});
  const [coachGovernance, setCoachGovernance] = useState(null);
  const [coachGovernanceLoading, setCoachGovernanceLoading] = useState(false);
  const [coachGovernanceSaving, setCoachGovernanceSaving] = useState(false);
  const [coachQualityDashboard, setCoachQualityDashboard] = useState(null);
  const [coachBusinessRulesDraft, setCoachBusinessRulesDraft] = useState("");
  const [coachBusinessRulesChannel, setCoachBusinessRulesChannel] =
    useState("coach");
  const [coachBusinessRulesProcess, setCoachBusinessRulesProcess] =
    useState("default");
  const [coachBusinessRulesSource, setCoachBusinessRulesSource] =
    useState(null);
  const [coachAdminRules, setCoachAdminRules] = useState([]);
  const [coachIntentCatalog, setCoachIntentCatalog] = useState([]);
  const [coachIntentRevisions, setCoachIntentRevisions] = useState([]);
  const [coachIntentCode, setCoachIntentCode] = useState("");
  const [coachIntentExamplesDraft, setCoachIntentExamplesDraft] = useState("");
  const [coachIntentTestQuestion, setCoachIntentTestQuestion] = useState("");
  const [coachIntentPreview, setCoachIntentPreview] = useState(null);
  const [coachIntentFeedback, setCoachIntentFeedback] = useState(null);
  const [channelIntentChannel, setChannelIntentChannel] =
    useState("customer_account");
  const [channelIntentCatalog, setChannelIntentCatalog] = useState([]);
  const [channelIntentRevisions, setChannelIntentRevisions] = useState([]);
  const [channelIntentCode, setChannelIntentCode] = useState("");
  const [channelIntentDraft, setChannelIntentDraft] = useState(null);
  const [channelIntentTestQuestion, setChannelIntentTestQuestion] =
    useState("");
  const [channelIntentPreview, setChannelIntentPreview] = useState(null);
  const [channelIntentFeedback, setChannelIntentFeedback] = useState(null);
  const [channelIntentSaving, setChannelIntentSaving] = useState(false);
  const [coachAdminRuleDraft, setCoachAdminRuleDraft] = useState(null);
  const [coachAdminRuleEditingId, setCoachAdminRuleEditingId] = useState(null);
  const [coachAdminRuleFeedback, setCoachAdminRuleFeedback] = useState(null);
  const [customerIntelligenceJob, setCustomerIntelligenceJob] = useState(null);
  const [customerAccounts, setCustomerAccounts] = useState([]);
  const [customerAccountSearch, setCustomerAccountSearch] = useState("");
  const [customerAccountId, setCustomerAccountId] = useState("");
  const [customerSnapshot, setCustomerSnapshot] = useState(null);
  const [customerSnapshotLoading, setCustomerSnapshotLoading] = useState(false);
  const [customerFindings, setCustomerFindings] = useState([]);
  const [customerInvestigating, setCustomerInvestigating] = useState(false);
  const [customerIntelligenceError, setCustomerIntelligenceError] =
    useState("");
  const [customerFindingUpdatingId, setCustomerFindingUpdatingId] =
    useState(null);
  const [customerFindingApplyDraft, setCustomerFindingApplyDraft] =
    useState(null);
  const [customerFindingApplying, setCustomerFindingApplying] = useState(false);
  const [customerContactApplyDraft, setCustomerContactApplyDraft] =
    useState(null);
  const [customerContactApplying, setCustomerContactApplying] = useState(false);
  const [customerDiscoveryJob, setCustomerDiscoveryJob] = useState(null);
  const [customerDiscoveryPreparing, setCustomerDiscoveryPreparing] =
    useState(false);
  const [customerExecutiveBriefingJob, setCustomerExecutiveBriefingJob] =
    useState(null);
  const [
    customerExecutiveBriefingLoading,
    setCustomerExecutiveBriefingLoading,
  ] = useState(false);
  const [customerAgentsJob, setCustomerAgentsJob] = useState(null);
  const [customerAgentsLoading, setCustomerAgentsLoading] = useState(false);
  const [customerChatQuestion, setCustomerChatQuestion] = useState("");
  const [customerChatMessages, setCustomerChatMessages] = useState([]);
  const [customerChatLoading, setCustomerChatLoading] = useState(false);
  const [customerChatSessionId, setCustomerChatSessionId] = useState(null);
  const [customerChatSessionLoading, setCustomerChatSessionLoading] =
    useState(false);
  const [showCustomerChatFoundation, setShowCustomerChatFoundation] = useState(
    () =>
      window.localStorage.getItem(CUSTOMER_CHAT_FOUNDATION_VISIBILITY_KEY) ===
      "true",
  );
  const [customerChatPublicResearch, setCustomerChatPublicResearch] =
    useState(false);
  const [prospectForm, setProspectForm] = useState({
    companyName: "",
    country: "",
    website: "",
    industry: "",
  });
  const [prospectSession, setProspectSession] = useState(null);
  const [prospectChatQuestion, setProspectChatQuestion] = useState("");
  const [prospectChatMessages, setProspectChatMessages] = useState([]);
  const [prospectChatLoading, setProspectChatLoading] = useState(false);
  const [prospectPreparing, setProspectPreparing] = useState(false);
  const [prospectError, setProspectError] = useState("");
  const [prospectFindingUpdatingId, setProspectFindingUpdatingId] =
    useState(null);
  const [prospectConverting, setProspectConverting] = useState("");
  const [prospectExternalResearching, setProspectExternalResearching] =
    useState(false);
  const [prospectConvertedAccountId, setProspectConvertedAccountId] =
    useState(null);
  const [prospectConvertedLeadId, setProspectConvertedLeadId] = useState(null);
  const [prospectConvertedContacts, setProspectConvertedContacts] = useState(
    {},
  );
  const [prospectConvertedOpportunities, setProspectConvertedOpportunities] =
    useState({});
  const [prospectContactDrafts, setProspectContactDrafts] = useState({});
  const coachContextRef = useRef(coachContext);
  const coachThreadRef = useRef(null);
  const coachDialogRef = useRef(null);
  const coachReturnFocusRef = useRef(null);
  const coachActiveSessionCheckedRef = useRef(false);
  const coachActiveSessionRequestRef = useRef(null);
  const coachContextRevisionRef = useRef(0);
  const coachDraftSaveSignatureRef = useRef("");

  useEffect(() => {
    coachContextRef.current = coachContext;
  }, [coachContext]);

  useEffect(() => {
    if (coachSessionId)
      window.localStorage.setItem(
        "mi-agent-coach-session",
        String(coachSessionId),
      );
    else window.localStorage.removeItem("mi-agent-coach-session");
  }, [coachSessionId]);

  useEffect(() => {
    if (!coachSessionId || coachMessages.length) return undefined;
    const contextRevision = coachContextRevisionRef.current;
    let cancelled = false;
    api
      .get(`/api/mi-agent/coach/sessions/${coachSessionId}`)
      .then(({ data }) => {
        if (
          cancelled ||
          contextRevision !== coachContextRevisionRef.current ||
          !data?.session
        )
          return;
        const session = data.session;
        setCoachContext((current) => ({
          ...current,
          accountId: String(
            session.context?.accountId || current.accountId || "",
          ),
          contactId: String(
            session.context?.contactId || current.contactId || "",
          ),
          opportunityId: String(
            session.context?.opportunityId || current.opportunityId || "",
          ),
          leadId: String(session.context?.leadId || current.leadId || ""),
        }));
        setCoachMessages(session.messages || []);
        setCoachPendingOperations(data.operations || []);
        setCoachRecentOperations(data.recentOperations || []);
      })
      .catch(() => {
        if (!cancelled) setCoachSessionId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [coachSessionId, coachMessages.length]);

  useEffect(() => {
    if (coachActiveSessionCheckedRef.current || coachSessionId) return;
    coachActiveSessionCheckedRef.current = true;
    const contextRevision = coachContextRevisionRef.current;
    const request = api.get("/api/mi-agent/coach/sessions/active");
    coachActiveSessionRequestRef.current = request;
    request
      .then(({ data }) => {
        if (
          contextRevision !== coachContextRevisionRef.current ||
          !data?.session
        )
          return;
        setCoachSessionId(Number(data.session.id));
        setCoachMessages(data.session.messages || []);
        setCoachPendingOperations(data.operations || []);
        setCoachRecentOperations(data.recentOperations || []);
        setCoachContext((current) => ({
          ...current,
          accountId: String(data.session.context?.accountId || ""),
          contactId: String(data.session.context?.contactId || ""),
          opportunityId: String(data.session.context?.opportunityId || ""),
          leadId: String(data.session.context?.leadId || ""),
        }));
      })
      .catch(() => undefined)
      .finally(() => {
        if (coachActiveSessionRequestRef.current === request) {
          coachActiveSessionRequestRef.current = null;
        }
      });
  }, [coachSessionId]);

  useEffect(() => {
    if (!coachOperationDraft?.persistentId || savingCoachOperation)
      return undefined;
    const pendingOperation = serializeCoachOperationDraft(coachOperationDraft);
    const missingFields = unresolvedCoachFields(pendingOperation);
    const signature = JSON.stringify({ pendingOperation, missingFields });
    if (signature === coachDraftSaveSignatureRef.current) return undefined;
    const timer = window.setTimeout(() => {
      setCoachDraftSaving(true);
      api
        .patch(
          `/api/mi-agent/coach/operations/${coachOperationDraft.persistentId}`,
          {
            pendingOperation,
            missingFields,
            version: coachOperationDraft.version,
          },
        )
        .then(({ data }) => {
          const saved = data?.operation;
          if (!saved) return;
          coachDraftSaveSignatureRef.current = signature;
          setCoachOperationDraft((current) =>
            current?.persistentId === saved.id
              ? {
                  ...current,
                  version: saved.version,
                  persistenceStatus: saved.status,
                }
              : current,
          );
          setCoachPendingOperations((current) =>
            current.map((item) => (item.id === saved.id ? saved : item)),
          );
        })
        .catch((requestError) => {
          const serverOperation = requestError?.response?.data?.operation;
          const message = getApiErrorMessage(
            requestError,
            "No fue posible guardar el borrador del Coach",
          );
          if (serverOperation) {
            setCoachPendingOperations((current) =>
              current.map((item) =>
                item.id === serverOperation.id ? serverOperation : item,
              ),
            );
          }
          setCoachOperationDraft((current) =>
            current
              ? {
                  ...current,
                  operation:
                    serverOperation?.pendingOperation || current.operation,
                  version: serverOperation?.version || current.version,
                  persistenceStatus:
                    serverOperation?.status || current.persistenceStatus,
                  error: message,
                }
              : current,
          );
        })
        .finally(() => setCoachDraftSaving(false));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [coachOperationDraft, savingCoachOperation]);

  useEffect(() => {
    if (coachOperationDraft) coachDialogRef.current?.focus();
  }, [coachOperationDraft]);

  useEffect(() => {
    if (coachThreadRef.current) {
      coachThreadRef.current.scrollTop = coachThreadRef.current.scrollHeight;
    }
  }, [coachMessages]);

  async function loadDashboard() {
    setLoading(true);
    setError("");
    try {
      const [{ data }, metricsResponse] = await Promise.all([
        api.get("/api/mi-agent/context"),
        api.get("/api/mi-agent/coach/metrics").catch(() => ({ data: null })),
      ]);
      setDashboard(data);
      setCoachMetrics(metricsResponse.data);
      const accountsResponse = await api.get("/api/accounts?activeOnly=true");
      setCoachAccounts(
        Array.isArray(accountsResponse.data) ? accountsResponse.data : [],
      );
      setCustomerAccounts(
        Array.isArray(accountsResponse.data) ? accountsResponse.data : [],
      );
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar el contexto de Mi Coach",
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  function requestCoachGeneralScope() {
    const pendingOperationCount = coachPendingOperations.length;
    const pendingOperationNotice = pendingOperationCount
      ? pendingOperationCount === 1
        ? " También se descartará 1 acción pendiente."
        : ` También se descartarán ${pendingOperationCount} acciones pendientes.`
      : "";

    const confirmed = window.confirm(
      `Volver al ámbito general cerrará esta conversación y limpiará sus mensajes y borradores.${pendingOperationNotice} No podrás reabrirla desde Coach. ¿Continuar?`,
    );
    if (confirmed) void resetCoachToGeneral();
  }

  async function clearCoachConversation() {
    const hasConversationState = Boolean(
      coachSessionId ||
      coachMessages.length ||
      coachRecentOperations.length ||
      coachOperationDraft,
    );
    if (!hasConversationState) return;
    const pendingOperationCount = coachPendingOperations.length;
    const pendingOperationNotice =
      pendingOperationCount === 1
        ? " También se descartará 1 acción pendiente."
        : pendingOperationCount
          ? ` También se descartarán ${pendingOperationCount} acciones pendientes.`
          : "";
    const confirmed = window.confirm(
      `Se cerrará esta conversación y se eliminarán sus mensajes de la vista.${pendingOperationNotice} ¿Continuar?`,
    );
    if (!confirmed) return;

    const sessionId = Number(coachSessionId || 0);
    coachContextRevisionRef.current += 1;
    coachActiveSessionRequestRef.current = null;
    setError("");
    try {
      if (pendingOperationCount) {
        await Promise.all(
          coachPendingOperations.map((operation) =>
            api.post(`/api/mi-agent/coach/operations/${operation.id}/status`, {
              status: "cancelled",
              cancellationReason: "Descartada al limpiar la conversación",
            }),
          ),
        );
      }
      if (sessionId) {
        await api.post(`/api/mi-agent/coach/sessions/${sessionId}/close`);
      }
      setCoachSessionId(null);
      setCoachMessages([]);
      setCoachQuestion("");
      setCoachNotice("");
      setCoachActionDraft(null);
      setCoachOperationDraft(null);
      setCoachPendingOperations([]);
      setCoachRecentOperations([]);
      setCoachUndoOperationId(null);
      setCoachOperationAction({});
      coachDraftSaveSignatureRef.current = "";
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible limpiar la conversación del Coach",
        ),
      );
    }
  }

  async function resetCoachToGeneral() {
    setLoadingCoachContext(true);
    setError("");
    const pendingRestore = coachActiveSessionRequestRef.current;
    coachContextRevisionRef.current += 1;
    coachActiveSessionRequestRef.current = null;
    try {
      const restoredSessionResponse = pendingRestore
        ? await pendingRestore.catch(() => null)
        : null;
      const generalContext = {
        accountId: "",
        opportunityId: "",
        contactId: "",
        leadId: "",
      };
      const sessionIdToClose = Number(
        coachSessionId || restoredSessionResponse?.data?.session?.id || 0,
      );
      if (coachPendingOperations.length) {
        await Promise.all(
          coachPendingOperations.map((operation) =>
            api.post(`/api/mi-agent/coach/operations/${operation.id}/status`, {
              status: "cancelled",
              cancellationReason: "Descartada al volver al ámbito general",
            }),
          ),
        );
      }
      if (sessionIdToClose) {
        await api.post(
          `/api/mi-agent/coach/sessions/${sessionIdToClose}/close`,
        );
      }

      setCoachContext(generalContext);
      coachContextRef.current = generalContext;
      setCoachSessionId(null);
      setCoachOpportunities([]);
      setCoachContacts([]);
      setCoachMessages([]);
      setCoachQuestion("");
      setCoachActionDraft(null);
      setCoachOperationDraft(null);
      setCoachPendingOperations([]);
      setCoachRecentOperations([]);
      setCoachUndoOperationId(null);
      setCoachOperationAction({});
      setCoachNotice("");
      coachDraftSaveSignatureRef.current = "";
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible volver al ámbito general del Coach",
        ),
      );
    } finally {
      setLoadingCoachContext(false);
    }
  }

  async function searchCustomerAccounts(value) {
    setCustomerAccountSearch(value);
    try {
      const response = await api.get(
        `/api/accounts?activeOnly=true&search=${encodeURIComponent(value)}`,
      );
      setCustomerAccounts(Array.isArray(response.data) ? response.data : []);
    } catch (requestError) {
      setCustomerIntelligenceError(
        getApiErrorMessage(requestError, "No fue posible buscar cuentas"),
      );
    }
  }

  function selectCustomerAccount(accountId) {
    setCustomerAccountId(String(accountId || ""));
    resetCustomerIntelligence();
  }

  function openCoachDetailHandoff(handoff) {
    if (handoff?.destination === "customer_account") {
      if (!canReadCustomerIntelligence || !Number(handoff.accountId || 0)) {
        return;
      }
      setActiveWorkspace("customer");
      selectCustomerAccount(handoff.accountId);
      return;
    }
    if (
      handoff?.destination === "lead_management" &&
      canReadLeads &&
      Number(handoff.leadId || 0)
    ) {
      navigate(`/interactions?leadId=${Number(handoff.leadId)}`);
    }
  }

  async function applyCoachActiveContext(
    activeContext,
    expectedRevision = coachContextRevisionRef.current,
  ) {
    if (expectedRevision !== coachContextRevisionRef.current) return;
    const nextContext = {
      accountId: String(activeContext?.accountId || ""),
      opportunityId: String(activeContext?.opportunityId || ""),
      contactId: String(activeContext?.contactId || ""),
      leadId: String(activeContext?.leadId || ""),
    };
    const hasChanged = [
      "accountId",
      "opportunityId",
      "contactId",
      "leadId",
    ].some((key) => nextContext[key] !== coachContextRef.current[key]);
    setCoachContext(nextContext);
    if (!hasChanged) return;
    if (!nextContext.accountId) {
      setCoachOpportunities([]);
      setCoachContacts([]);
      return;
    }

    const [contextResponse, opportunitiesResponse, contactsResponse] =
      await Promise.all([
        api.get("/api/mi-agent/context"),
        api.get(
          `/api/opportunities?accountId=${nextContext.accountId}&activeOnly=true&openOnly=true`,
        ),
        api.get(
          `/api/contacts?accountId=${nextContext.accountId}&opportunityId=${nextContext.opportunityId}&activeOnly=true`,
        ),
      ]);
    if (expectedRevision !== coachContextRevisionRef.current) return;
    const accountSnapshot = buildSnapshot(contextResponse.data);
    setDashboard(contextResponse.data);
    setCoachAccounts((current) => {
      const accounts = new Map(
        current.map((account) => [Number(account.id), account]),
      );
      accountSnapshot.accounts.forEach((account) =>
        accounts.set(Number(account.id), account),
      );
      return [...accounts.values()];
    });
    setCoachOpportunities(
      buildCoachOpportunityOptions(
        opportunitiesResponse.data,
        accountSnapshot,
        nextContext.accountId,
      ),
    );
    setCoachContacts(
      Array.isArray(contactsResponse.data) ? contactsResponse.data : [],
    );
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  const snapshot = useMemo(() => buildSnapshot(dashboard), [dashboard]);
  const currency = snapshot.quota.currencyCode;
  const coverage =
    snapshot.quota.currencyConversionAvailable && snapshot.quota.gapAmount
      ? snapshot.pipeline.openAmount / snapshot.quota.gapAmount
      : null;
  const selectedCustomerAccount =
    customerAccounts.find(
      (item) => String(item.id) === String(customerAccountId),
    ) || null;
  const hasCustomerContext = Boolean(customerAccountId);

  useEffect(() => {
    if (activeWorkspace !== "customer" || !hasCustomerContext) {
      setCustomerSnapshot(null);
      return undefined;
    }
    let cancelled = false;
    setCustomerSnapshotLoading(true);
    api
      .get("/api/commercial-intelligence/account-intelligence/snapshot", {
        params: {
          accountId: Number(customerAccountId),
        },
      })
      .then((response) => {
        if (!cancelled) setCustomerSnapshot(response.data?.snapshot || null);
      })
      .catch((requestError) => {
        if (!cancelled)
          setCustomerIntelligenceError(
            getApiErrorMessage(
              requestError,
              "No fue posible cargar la salud de la cuenta",
            ),
          );
      })
      .finally(() => {
        if (!cancelled) setCustomerSnapshotLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeWorkspace, customerAccountId, hasCustomerContext]);

  useEffect(() => {
    const accountId = Number(customerAccountId || 0);
    if (!accountId || !hasCustomerContext) {
      setCustomerChatSessionId(null);
      setCustomerChatMessages([]);
      setCustomerChatSessionLoading(false);
      return undefined;
    }
    const storageKey = customerChatSessionKey(accountId);
    const storedSessionId = Number(
      window.sessionStorage.getItem(storageKey) || 0,
    );
    if (!storedSessionId) {
      setCustomerChatSessionId(null);
      setCustomerChatMessages([]);
      setCustomerChatSessionLoading(false);
      return undefined;
    }
    let cancelled = false;
    setCustomerChatSessionId(storedSessionId);
    setCustomerChatSessionLoading(true);
    api
      .get(
        `/api/commercial-intelligence/account-chat/sessions/${storedSessionId}`,
      )
      .then((response) => {
        if (cancelled) return;
        const session = response.data?.session;
        if (Number(session?.accountId || 0) !== accountId) {
          throw new Error("La sesion no corresponde a la cuenta actual");
        }
        setCustomerChatMessages(
          (Array.isArray(session.history) ? session.history : []).map(
            (message) =>
              message.role === "user"
                ? { role: "seller", text: message.text }
                : {
                    role: "assistant",
                    answer: message.text,
                    activityHistory: message.activityHistory || null,
                    sourceDomain: "crm_internal",
                  },
          ),
        );
      })
      .catch(() => {
        if (cancelled) return;
        window.sessionStorage.removeItem(storageKey);
        setCustomerChatSessionId(null);
        setCustomerChatMessages([]);
      })
      .finally(() => {
        if (!cancelled) setCustomerChatSessionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customerAccountId, hasCustomerContext]);

  function resetCustomerIntelligence() {
    setCustomerSnapshot(null);
    setCustomerSnapshotLoading(false);
    setCustomerIntelligenceJob(null);
    setCustomerFindings([]);
    setCustomerIntelligenceError("");
    setCustomerFindingUpdatingId(null);
    setCustomerFindingApplyDraft(null);
    setCustomerFindingApplying(false);
    setCustomerContactApplyDraft(null);
    setCustomerContactApplying(false);
    setCustomerDiscoveryJob(null);
    setCustomerDiscoveryPreparing(false);
    setCustomerExecutiveBriefingJob(null);
    setCustomerExecutiveBriefingLoading(false);
    setCustomerAgentsJob(null);
    setCustomerAgentsLoading(false);
    setCustomerChatQuestion("");
    setCustomerChatMessages([]);
    setCustomerChatLoading(false);
    setCustomerChatSessionId(null);
    setCustomerChatSessionLoading(false);
    setCustomerChatPublicResearch(false);
  }

  function buildCustomerIntelligencePayload() {
    return {
      accountId: customerAccountId ? Number(customerAccountId) : null,
      objective: "Investigar cliente existente desde Mi Coach",
    };
  }

  async function pollCustomerIntelligenceJob(jobId) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await api.get(
        `/api/commercial-intelligence/account-internal-analysis/jobs/${jobId}`,
      );
      const job = response.data?.job || null;
      if (job) {
        setCustomerIntelligenceJob(job);
        setCustomerFindings(Array.isArray(job.findings) ? job.findings : []);
      }
      if (["completed", "failed"].includes(String(job?.status || ""))) {
        return job;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 600));
    }
    return null;
  }

  async function runCustomerInvestigation() {
    if (!hasCustomerContext) {
      setCustomerIntelligenceError(
        "Selecciona una cuenta existente para investigar.",
      );
      return;
    }
    setCustomerInvestigating(true);
    setCustomerIntelligenceError("");
    setCoachNotice("");
    try {
      const response = await api.post(
        "/api/commercial-intelligence/account-internal-analysis/jobs",
        buildCustomerIntelligencePayload(),
      );
      const job = response.data?.job;
      if (!job?.id)
        throw new Error("No se pudo iniciar la investigación del cliente");
      setCustomerIntelligenceJob(job);
      setCustomerFindings([]);
      const completedJob = await pollCustomerIntelligenceJob(job.id);
      if (!completedJob || completedJob.status === "failed") {
        throw new Error(
          completedJob?.errorMessage ||
            "No fue posible completar la investigación del cliente",
        );
      }
      setCoachNotice("Investigación del cliente completada.");
    } catch (requestError) {
      setCustomerIntelligenceError(
        getApiErrorMessage(
          requestError,
          "No fue posible investigar el cliente",
        ),
      );
    } finally {
      setCustomerInvestigating(false);
    }
  }

  async function updateCustomerFindingStatus(finding, status) {
    const action = status === "confirmed" ? "confirm" : "reject";
    setCustomerFindingUpdatingId(finding.id);
    setCustomerIntelligenceError("");
    try {
      const response = await api.post(
        `/api/commercial-intelligence/findings/${finding.id}/${action}`,
        {},
      );
      const updatedFinding = response.data?.finding;
      if (updatedFinding) {
        setCustomerFindings((current) =>
          current.map((item) =>
            Number(item.id) === Number(updatedFinding.id)
              ? updatedFinding
              : item,
          ),
        );
        setCustomerIntelligenceJob((current) =>
          current
            ? {
                ...current,
                findings: (Array.isArray(current.findings)
                  ? current.findings
                  : []
                ).map((item) =>
                  Number(item.id) === Number(updatedFinding.id)
                    ? updatedFinding
                    : item,
                ),
                result: current.result
                  ? {
                      ...current.result,
                      findings: (Array.isArray(current.result.findings)
                        ? current.result.findings
                        : []
                      ).map((item) =>
                        Number(item.id) === Number(updatedFinding.id)
                          ? updatedFinding
                          : item,
                      ),
                    }
                  : current.result,
              }
            : current,
        );
        setCoachNotice(
          status === "confirmed"
            ? "Hallazgo confirmado correctamente."
            : "Hallazgo rechazado correctamente.",
        );
        if (status === "confirmed") {
          const suggestedTarget =
            updatedFinding.metadata?.targetEntity ||
            (updatedFinding.metadata?.contactData?.firstName &&
            updatedFinding.metadata?.contactData?.lastName
              ? "contact"
              : null);
          const target =
            ["account", "contact", "opportunity"].includes(suggestedTarget) &&
            updatedFinding[`${suggestedTarget}Id`]
              ? suggestedTarget
              : updatedFinding.accountId
                ? "account"
                : updatedFinding.contactId
                  ? "contact"
                  : "opportunity";
          const fields = CUSTOMER_FINDING_APPLY_FIELDS[target] || [];
          const suggestedField = updatedFinding.metadata?.targetField;
          setCustomerFindingApplyDraft({
            finding: updatedFinding,
            target,
            field: fields.some(([key]) => key === suggestedField)
              ? suggestedField
              : fields[0]?.[0] || "",
            value:
              updatedFinding.metadata?.suggestedValue ||
              updatedFinding.evidenceText ||
              updatedFinding.summary ||
              "",
            mode: "append",
          });
          if (
            (target === "contact" ||
              updatedFinding.metadata?.contactData?.firstName) &&
            updatedFinding.metadata?.contactData
          ) {
            setCustomerContactApplyDraft({
              finding: updatedFinding,
              contactId: "",
              contactData: { ...updatedFinding.metadata.contactData },
            });
          }
        }
      }
    } catch (requestError) {
      setCustomerIntelligenceError(
        getApiErrorMessage(
          requestError,
          "No fue posible actualizar el hallazgo",
        ),
      );
    } finally {
      setCustomerFindingUpdatingId(null);
    }
  }

  async function applyCustomerFinding() {
    const draft = customerFindingApplyDraft;
    if (
      !draft?.finding?.id ||
      !draft.target ||
      !draft.field ||
      !String(draft.value || "").trim()
    )
      return;
    setCustomerFindingApplying(true);
    setCustomerIntelligenceError("");
    try {
      await api.post(
        `/api/commercial-intelligence/findings/${draft.finding.id}/apply`,
        {
          target: draft.target,
          field: draft.field,
          value: draft.value.trim(),
          mode: draft.mode,
        },
      );
      setCustomerFindingApplyDraft(null);
      setCoachNotice("Hallazgo aplicado al registro correctamente.");
    } catch (requestError) {
      setCustomerIntelligenceError(
        getApiErrorMessage(
          requestError,
          "No fue posible aplicar el hallazgo al registro",
        ),
      );
    } finally {
      setCustomerFindingApplying(false);
    }
  }

  async function applyCustomerContact() {
    const draft = customerContactApplyDraft;
    if (!draft?.finding?.id) return;
    setCustomerContactApplying(true);
    try {
      await api.post(
        `/api/commercial-intelligence/findings/${draft.finding.id}/apply-contact`,
        {
          contactId: draft.contactId ? Number(draft.contactId) : null,
          contactData: draft.contactData,
        },
      );
      setCustomerContactApplyDraft(null);
      setCoachNotice("Contacto confirmado y guardado correctamente.");
    } catch (requestError) {
      setCustomerIntelligenceError(
        getApiErrorMessage(requestError, "No fue posible guardar el contacto"),
      );
    } finally {
      setCustomerContactApplying(false);
    }
  }

  async function pollCustomerDiscoveryJob(jobId) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await api.get(
        `/api/commercial-intelligence/commercial-discovery/jobs/${jobId}`,
      );
      const job = response.data?.job || null;
      if (job) setCustomerDiscoveryJob(job);
      if (["completed", "failed"].includes(String(job?.status || "")))
        return job;
      await new Promise((resolve) => window.setTimeout(resolve, 600));
    }
    return null;
  }

  async function prepareCustomerCall() {
    if (!hasCustomerContext) {
      setCustomerIntelligenceError(
        "Selecciona una cuenta existente para preparar la llamada.",
      );
      return;
    }
    setCustomerDiscoveryPreparing(true);
    setCustomerIntelligenceError("");
    setCoachNotice("");
    try {
      const response = await api.post(
        "/api/commercial-intelligence/commercial-discovery/jobs",
        buildCustomerIntelligencePayload(),
      );
      const job = response.data?.job;
      if (!job?.id)
        throw new Error("No se pudo iniciar la preparación comercial");
      setCustomerDiscoveryJob(job);
      const completedJob = await pollCustomerDiscoveryJob(job.id);
      if (!completedJob || completedJob.status === "failed") {
        throw new Error(
          completedJob?.errorMessage || "No fue posible preparar la llamada",
        );
      }
      setCoachNotice("Briefing comercial preparado.");
    } catch (requestError) {
      setCustomerIntelligenceError(
        getApiErrorMessage(requestError, "No fue posible preparar la llamada"),
      );
    } finally {
      setCustomerDiscoveryPreparing(false);
    }
  }

  async function prepareCustomerExecutiveBriefing() {
    if (!hasCustomerContext) {
      setCustomerIntelligenceError(
        "Selecciona una cuenta existente para preparar el resumen ejecutivo.",
      );
      return;
    }
    setCustomerExecutiveBriefingLoading(true);
    setCustomerIntelligenceError("");
    try {
      const response = await api.post(
        "/api/commercial-intelligence/executive-briefing/jobs",
        buildCustomerIntelligencePayload(),
      );
      const jobId = Number(response.data?.job?.id || 0);
      if (!jobId) throw new Error("No se pudo iniciar el resumen ejecutivo");
      setCustomerExecutiveBriefingJob(response.data.job);
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const jobResponse = await api.get(
          `/api/commercial-intelligence/executive-briefing/jobs/${jobId}`,
        );
        const job = jobResponse.data?.job;
        if (job) setCustomerExecutiveBriefingJob(job);
        if (["completed", "failed"].includes(String(job?.status || ""))) {
          if (job.status === "failed")
            throw new Error(
              job.errorMessage ||
                "No fue posible preparar el resumen ejecutivo",
            );
          setCoachNotice("Resumen ejecutivo preparado.");
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 600));
      }
      throw new Error(
        "El resumen ejecutivo tardó demasiado; inténtalo de nuevo",
      );
    } catch (requestError) {
      setCustomerIntelligenceError(
        getApiErrorMessage(
          requestError,
          "No fue posible preparar el resumen ejecutivo",
        ),
      );
    } finally {
      setCustomerExecutiveBriefingLoading(false);
    }
  }

  async function runCustomerAgents() {
    if (!hasCustomerContext) {
      setCustomerIntelligenceError(
        "Selecciona una cuenta existente para ejecutar los agentes.",
      );
      return;
    }
    setCustomerAgentsLoading(true);
    setCustomerIntelligenceError("");
    try {
      if (!canUseExternalSources) {
        throw new Error(
          "No tienes permiso para ejecutar agentes con fuentes públicas",
        );
      }
      const response = await api.post(
        "/api/commercial-intelligence/agents/jobs",
        { ...buildCustomerIntelligencePayload(), includePublicResearch: true },
      );
      const jobId = Number(response.data?.job?.id || 0);
      if (!jobId)
        throw new Error("No se pudo iniciar la orquestación de agentes");
      setCustomerAgentsJob(response.data.job);
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const jobResponse = await api.get(
          `/api/commercial-intelligence/agents/jobs/${jobId}`,
        );
        const job = jobResponse.data?.job;
        if (job) setCustomerAgentsJob(job);
        if (["completed", "failed"].includes(String(job?.status || ""))) {
          if (job.status === "failed")
            throw new Error(
              job.errorMessage || "No fue posible ejecutar los agentes",
            );
          setCoachNotice("Agentes especializados ejecutados.");
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 600));
      }
      throw new Error("La orquestación tardó demasiado; inténtalo de nuevo");
    } catch (requestError) {
      setCustomerIntelligenceError(
        getApiErrorMessage(requestError, "No fue posible ejecutar los agentes"),
      );
    } finally {
      setCustomerAgentsLoading(false);
    }
  }

  async function askCustomerChat(question = customerChatQuestion) {
    const normalizedQuestion = String(question || "").trim();
    if (!normalizedQuestion || !hasCustomerContext) return;
    setCustomerChatLoading(true);
    setCustomerIntelligenceError("");
    setCustomerChatMessages((current) => [
      ...current,
      { role: "seller", text: normalizedQuestion },
    ]);
    setCustomerChatQuestion("");
    try {
      let activeChatSessionId = customerChatSessionId;
      if (!activeChatSessionId) {
        const sessionResponse = await api.post(
          "/api/commercial-intelligence/account-chat/sessions",
          buildCustomerIntelligencePayload(),
        );
        activeChatSessionId = Number(sessionResponse.data?.session?.id || 0);
        if (!activeChatSessionId)
          throw new Error("No se pudo iniciar una conversación de cuenta");
        window.sessionStorage.setItem(
          customerChatSessionKey(customerAccountId),
          String(activeChatSessionId),
        );
        setCustomerChatSessionId(activeChatSessionId);
      }
      const response = await api.post(
        "/api/commercial-intelligence/account-chat/jobs",
        {
          ...buildCustomerIntelligencePayload(),
          chatSessionId: activeChatSessionId,
          question: normalizedQuestion,
          includePublicResearch: customerChatPublicResearch,
        },
      );
      const jobId = Number(response.data?.job?.id || 0);
      if (!jobId) throw new Error("No se pudo iniciar el chat de cuenta");
      let result = null;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const jobResponse = await api.get(
          `/api/commercial-intelligence/account-chat/jobs/${jobId}`,
        );
        const job = jobResponse.data?.job;
        if (["completed", "failed"].includes(String(job?.status || ""))) {
          if (job.status === "failed")
            throw new Error(job.errorMessage || "No fue posible responder");
          result = job.result;
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 600));
      }
      if (!result)
        throw new Error("La respuesta tardó demasiado; inténtalo de nuevo");
      setCustomerChatMessages((current) => [
        ...current,
        { role: "assistant", ...result },
      ]);
    } catch (requestError) {
      setCustomerIntelligenceError(
        getApiErrorMessage(
          requestError,
          "No fue posible responder sobre la cuenta",
        ),
      );
    } finally {
      setCustomerChatLoading(false);
    }
  }

  function startNewCustomerChat() {
    if (customerChatLoading || customerChatSessionLoading) return;
    window.sessionStorage.removeItem(customerChatSessionKey(customerAccountId));
    setCustomerChatSessionId(null);
    setCustomerChatMessages([]);
    setCustomerChatQuestion("");
    setCustomerIntelligenceError("");
  }

  async function openDiscoveryActivity(nextStep) {
    const opportunityId = Number(nextStep?.opportunityId || 0);
    if (!opportunityId || !canExecuteCoach || !canUpdateCommercialDevelopment)
      return;
    const snapshotAccountId = Number(customerSnapshot?.account?.id || 0);
    const customerOpportunity = [
      ...(customerSnapshot?.opportunities || []),
      ...(customerSnapshot?.inactiveOpportunities || []),
    ].find(
      (item) =>
        Number(item.id) === opportunityId &&
        Number(item.accountId || snapshotAccountId) === snapshotAccountId &&
        snapshotAccountId === Number(customerAccountId || 0),
    );
    if (!customerOpportunity) {
      setError(
        "La oportunidad ya no está disponible en la cuenta seleccionada. Actualiza la información e inténtalo de nuevo.",
      );
      return;
    }
    setSavingCoachOperation(true);
    setError("");
    try {
      const response = await api.post("/api/mi-agent/coach/operations", {
        sessionId: null,
        originalIntent: "Preparar actividad desde Cliente existente",
        context: {
          accountId: Number(customerAccountId || 0) || null,
          opportunityId,
        },
        operation: {
          kind: "activity",
          sourceChannel: "coach",
          title: nextStep.title || "Seguimiento comercial",
          evidence: Array.isArray(nextStep.evidence) ? nextStep.evidence : [],
          missingFields: [],
          requiresConfirmation: true,
          opportunityId,
          activityId: null,
          actionType: nextStep.actionType || "call",
          status: "pending",
          priority: nextStep.priority || "medium",
          scheduledAt: nextStep.scheduledAt || null,
          dueDate: nextStep.dueDate || null,
          notes:
            nextStep.notes || "Preparada desde Cliente existente en Mi Coach.",
          successCriteria:
            nextStep.successCriteria || "Obtener siguiente paso confirmado.",
        },
      });
      const persistedOperation = response.data?.operation;
      const destinationSessionId = Number(response.data?.sessionId || 0);
      if (!persistedOperation?.id || !destinationSessionId) {
        throw new Error(
          "No se pudo persistir la actividad en una sesión nueva del Coach",
        );
      }
      const coachContextForHandoff = {
        accountId: String(customerAccountId || ""),
        opportunityId: String(opportunityId),
        contactId: "",
        leadId: "",
      };
      setCoachContext(coachContextForHandoff);
      coachContextRef.current = coachContextForHandoff;
      setCoachMessages([]);
      setCoachSessionId(destinationSessionId);
      setCoachPendingOperations((current) => [
        persistedOperation,
        ...current.filter((item) => item.id !== persistedOperation.id),
      ]);
      await openCoachOperationConfirmation({
        ...persistedOperation.pendingOperation,
        persistentId: persistedOperation.id,
        persistenceVersion: persistedOperation.version,
        persistenceStatus: persistedOperation.status,
      }, {
        opportunityOptions: [
          {
            ...customerOpportunity,
            accountName:
              customerSnapshot.account.name || selectedCustomerAccount?.name,
          },
        ],
      });
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible preparar la actividad",
        ),
      );
    } finally {
      setSavingCoachOperation(false);
    }
  }

  function canReviewCustomerOperation(operation) {
    if (!canExecuteCoach) return false;
    if (operation?.kind === "activity") return canUpdateCommercialDevelopment;
    if (operation?.kind === "lead_call_outcome") return canUpdateLeads;
    if (operation?.kind === "account_field") return canUpdateAccounts;
    if (operation?.kind === "contact_field") return canUpdateContacts;
    if (["stage_answer", "opportunity_field"].includes(operation?.kind))
      return canCreateActions;
    return false;
  }

  async function openCustomerChatOperation(operation) {
    if (!operation || !canReviewCustomerOperation(operation)) return;
    setSavingCoachOperation(true);
    setError("");
    try {
      const accountId = Number(customerAccountId || 0) || null;
      const opportunityId = Number(operation.opportunityId || 0) || null;
      const contactId = Number(operation.contactId || 0) || null;
      const coachOperation = {
        ...operation,
        sourceChannel: "coach",
        requiresConfirmation: true,
      };
      const response = await api.post("/api/mi-agent/coach/operations", {
        sessionId: null,
        originChannel: "customer_account",
        originalIntent: `Propuesta desde Cliente existente: ${operation.title || operation.kind}`,
        context: {
          accountId,
          opportunityId,
          contactId,
          leadId: null,
        },
        operation: coachOperation,
      });
      const persistedOperation = response.data?.operation;
      const destinationSessionId = Number(response.data?.sessionId || 0);
      if (!persistedOperation?.id || !destinationSessionId) {
        throw new Error("No se pudo preparar la operación en el Coach");
      }
      const coachContextForHandoff = {
        accountId: String(accountId || ""),
        opportunityId: String(opportunityId || ""),
        contactId: String(contactId || ""),
        leadId: "",
      };
      setCoachContext(coachContextForHandoff);
      coachContextRef.current = coachContextForHandoff;
      setCoachMessages([]);
      setCoachSessionId(destinationSessionId);
      setCoachPendingOperations((current) => [
        persistedOperation,
        ...current.filter((item) => item.id !== persistedOperation.id),
      ]);
      await openCoachOperationConfirmation({
        ...persistedOperation.pendingOperation,
        persistentId: persistedOperation.id,
        persistenceVersion: persistedOperation.version,
        persistenceStatus: persistedOperation.status,
      });
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible preparar la operación en el Coach",
        ),
      );
    } finally {
      setSavingCoachOperation(false);
    }
  }

  function updateProspectForm(field, value) {
    setProspectForm((current) => ({ ...current, [field]: value }));
    setProspectError("");
  }

  async function prepareProspectAccount() {
    const companyName = prospectForm.companyName.trim();
    const country = prospectForm.country.trim();
    if (!companyName || !country) {
      setProspectError("Captura empresa y país para preparar la cuenta.");
      return;
    }
    setProspectPreparing(true);
    setProspectError("");
    setCoachNotice("");
    try {
      const createResponse = await api.post("/api/prospect-research/sessions", {
        companyName,
        country,
        website: prospectForm.website.trim(),
        industry: prospectForm.industry.trim(),
      });
      const sessionId = Number(createResponse.data?.session?.id || 0);
      if (!sessionId)
        throw new Error("No se pudo crear la sesión de prospección");
      setProspectSession(createResponse.data.session);
      setProspectChatMessages([]);
      const runResponse = await api.post(
        `/api/prospect-research/sessions/${sessionId}/run`,
        {},
      );
      setProspectSession(
        runResponse.data?.session || createResponse.data.session,
      );
      setProspectConvertedAccountId(null);
      setProspectConvertedLeadId(null);
      setProspectConvertedContacts({});
      setProspectConvertedOpportunities({});
      setProspectContactDrafts({});
      setCoachNotice("Ficha de prospección preparada.");
    } catch (requestError) {
      setProspectError(
        getApiErrorMessage(requestError, "No fue posible preparar la cuenta"),
      );
    } finally {
      setProspectPreparing(false);
    }
  }

  async function askProspectChat(question = prospectChatQuestion) {
    const normalizedQuestion = String(question || "").trim();
    if (!normalizedQuestion || !prospectSession?.id) return;
    setProspectChatLoading(true);
    setProspectError("");
    setProspectChatMessages((current) => [
      ...current,
      { role: "seller", text: normalizedQuestion },
    ]);
    setProspectChatQuestion("");
    try {
      const response = await api.post(
        `/api/prospect-research/sessions/${prospectSession.id}/chat`,
        { question: normalizedQuestion },
      );
      setProspectChatMessages((current) => [
        ...current,
        { role: "assistant", ...(response.data?.result || {}) },
      ]);
    } catch (requestError) {
      setProspectError(
        getApiErrorMessage(
          requestError,
          "No fue posible responder sobre el prospecto",
        ),
      );
    } finally {
      setProspectChatLoading(false);
    }
  }

  async function runProspectExternalResearch() {
    if (!prospectSession?.id) return;
    setProspectExternalResearching(true);
    setProspectError("");
    try {
      const response = await api.post(
        `/api/prospect-research/sessions/${prospectSession.id}/run-external`,
        {},
      );
      setProspectSession(response.data?.session || prospectSession);
      setCoachNotice(
        response.data?.session?.result?.externalResearch?.enabled
          ? "Fuentes públicas investigadas."
          : "Investigación externa no habilitada; se conservó la ficha interna.",
      );
    } catch (requestError) {
      setProspectError(
        getApiErrorMessage(
          requestError,
          "No fue posible investigar fuentes públicas",
        ),
      );
    } finally {
      setProspectExternalResearching(false);
    }
  }

  async function updateProspectFindingStatus(finding, status) {
    const action = status === "confirmed" ? "confirm" : "reject";
    setProspectFindingUpdatingId(finding.id);
    setProspectError("");
    try {
      const response = await api.post(
        `/api/prospect-research/findings/${finding.id}/${action}`,
        {},
      );
      const updatedFinding = response.data?.finding;
      if (updatedFinding) {
        setProspectSession((current) =>
          current
            ? {
                ...current,
                findings: (Array.isArray(current.findings)
                  ? current.findings
                  : []
                ).map((item) =>
                  Number(item.id) === Number(updatedFinding.id)
                    ? updatedFinding
                    : item,
                ),
              }
            : current,
        );
      }
    } catch (requestError) {
      setProspectError(
        getApiErrorMessage(
          requestError,
          "No fue posible actualizar el hallazgo",
        ),
      );
    } finally {
      setProspectFindingUpdatingId(null);
    }
  }

  async function convertProspectAccount(
    duplicateDecision = "",
    duplicateAccountId = null,
  ) {
    if (!prospectSession?.id) return;
    setProspectConverting("account");
    setProspectError("");
    try {
      const response = await api.post(
        `/api/prospect-research/sessions/${prospectSession.id}/convert-to-account`,
        { duplicateDecision, duplicateAccountId },
      );
      const accountId = Number(response.data?.accountId || 0);
      if (!accountId) throw new Error("No se pudo crear la cuenta");
      setProspectConvertedAccountId(accountId);
      setProspectSession((current) =>
        current ? { ...current, convertedAccountId: accountId } : current,
      );
      setCoachNotice(
        response.data?.reused
          ? "Cuenta existente vinculada a la prospección."
          : "Cuenta creada desde la prospección.",
      );
    } catch (requestError) {
      setProspectError(
        getApiErrorMessage(requestError, "No fue posible crear la cuenta"),
      );
    } finally {
      setProspectConverting("");
    }
  }

  async function updateProspectHypothesisStatus(hypothesis, status) {
    setProspectConverting(`hypothesis-${hypothesis.id}`);
    setProspectError("");
    try {
      const response = await api.post(
        `/api/prospect-research/hypotheses/${hypothesis.id}/${status === "confirmed" ? "confirm" : "reject"}`,
        {},
      );
      const updatedHypothesis = response.data?.hypothesis;
      if (updatedHypothesis) {
        setProspectSession((current) =>
          current
            ? {
                ...current,
                hypotheses: (current.hypotheses || []).map((item) =>
                  Number(item.id) === Number(updatedHypothesis.id)
                    ? updatedHypothesis
                    : item,
                ),
              }
            : current,
        );
      }
    } catch (requestError) {
      setProspectError(
        getApiErrorMessage(requestError, "No fue posible validar la hipótesis"),
      );
    } finally {
      setProspectConverting("");
    }
  }

  async function convertProspectLead() {
    if (!prospectSession?.id) return;
    setProspectConverting("lead");
    setProspectError("");
    try {
      const response = await api.post(
        `/api/prospect-research/sessions/${prospectSession.id}/convert-to-lead`,
        {
          accountId:
            prospectConvertedAccountId ||
            prospectSession.convertedAccountId ||
            null,
        },
      );
      const interactionId = Number(response.data?.interactionId || 0);
      if (!interactionId) throw new Error("No se pudo crear el lead");
      setProspectConvertedLeadId(interactionId);
      setCoachNotice("Lead creado desde la prospección.");
    } catch (requestError) {
      setProspectError(
        getApiErrorMessage(requestError, "No fue posible crear el lead"),
      );
    } finally {
      setProspectConverting("");
    }
  }

  function updateProspectContactDraft(contactId, field, value) {
    setProspectContactDrafts((current) => ({
      ...current,
      [contactId]: { ...(current[contactId] || {}), [field]: value },
    }));
  }

  async function convertProspectContact(contact) {
    const accountId =
      prospectConvertedAccountId || prospectSession?.convertedAccountId || null;
    if (!accountId) {
      setProspectError(
        "Primero crea o vincula la cuenta antes de crear contactos.",
      );
      return;
    }
    const draft = prospectContactDrafts[contact.id] || {};
    if (!String(draft.contactName || "").trim()) {
      setProspectError(
        "Captura el nombre real del contacto sugerido antes de crearlo.",
      );
      return;
    }
    setProspectConverting(`contact-${contact.id}`);
    setProspectError("");
    try {
      const response = await api.post(
        `/api/prospect-research/contacts/${contact.id}/convert`,
        {
          accountId,
          contactName: draft.contactName,
          email: draft.email || "",
        },
      );
      const contactId = Number(response.data?.contactId || 0);
      if (!contactId) throw new Error("No se pudo crear el contacto");
      setProspectConvertedContacts((current) => ({
        ...current,
        [contact.id]: contactId,
      }));
      setCoachNotice("Contacto creado desde la prospección.");
    } catch (requestError) {
      setProspectError(
        getApiErrorMessage(requestError, "No fue posible crear el contacto"),
      );
    } finally {
      setProspectConverting("");
    }
  }

  async function convertProspectOpportunity(hypothesis) {
    const accountId =
      prospectConvertedAccountId || prospectSession?.convertedAccountId || null;
    const firstContactId = Number(
      Object.values(prospectConvertedContacts)[0] || 0,
    );
    if (!accountId || !firstContactId) {
      setProspectError(
        "Crea la cuenta y al menos un contacto antes de crear una oportunidad preliminar.",
      );
      return;
    }
    setProspectConverting(`opportunity-${hypothesis.id}`);
    setProspectError("");
    try {
      const response = await api.post(
        `/api/prospect-research/hypotheses/${hypothesis.id}/convert-to-opportunity`,
        {
          accountId,
          contactId: firstContactId,
          amountUsd: 0,
        },
      );
      const opportunityId = Number(response.data?.opportunityId || 0);
      if (!opportunityId) throw new Error("No se pudo crear la oportunidad");
      setProspectConvertedOpportunities((current) => ({
        ...current,
        [hypothesis.id]: opportunityId,
      }));
      setCoachNotice("Oportunidad preliminar creada desde la prospección.");
    } catch (requestError) {
      setProspectError(
        getApiErrorMessage(requestError, "No fue posible crear la oportunidad"),
      );
    } finally {
      setProspectConverting("");
    }
  }

  async function askCoach(
    question = coachQuestion,
    contextOverride = coachContext,
    sessionIdOverride = coachSessionId,
  ) {
    const normalizedQuestion = String(question || "").trim();
    if (!normalizedQuestion) return;
    const requestContext = { ...contextOverride };
    const contextKey = JSON.stringify(requestContext);
    const contextRevision = coachContextRevisionRef.current;
    setAskingCoach(true);
    setError("");
    setCoachNotice("");
    const messageId = `${Date.now()}-${normalizedQuestion}`;
    setCoachMessages((current) => [
      ...current,
      { id: `${messageId}-question`, role: "seller", text: normalizedQuestion },
      { id: `${messageId}-pending`, role: "coach", pending: true },
    ]);
    setCoachQuestion("");
    try {
      const conversationHistory = coachMessages
        .filter((message) => !message.pending)
        .slice(-8)
        .map((message) => ({
          role: message.role === "coach" ? "coach" : "seller",
          text:
            message.role === "coach"
              ? message.result?.answer || message.error || ""
              : message.text || "",
        }))
        .filter((message) => message.text);
      const { data: queued } = await api.post("/api/mi-agent/coach", {
        question: normalizedQuestion,
        history: conversationHistory,
        sessionId: sessionIdOverride,
        context: {
          accountId: Number(requestContext.accountId || 0) || null,
          opportunityId: Number(requestContext.opportunityId || 0) || null,
          contactId: Number(requestContext.contactId || 0) || null,
          leadId: Number(requestContext.leadId || 0) || null,
        },
      });
      if (contextRevision !== coachContextRevisionRef.current) return;
      if (queued?.sessionId) setCoachSessionId(Number(queued.sessionId));
      const jobId = Number(queued?.job?.id || 0);
      if (!jobId) throw new Error("No se pudo iniciar la consulta al Coach");
      const deadline = Date.now() + COACH_POLL_TIMEOUT_MS;
      for (;;) {
        if (Date.now() >= deadline) {
          throw new Error(
            "El Coach está tardando más de lo esperado. Puedes intentarlo nuevamente.",
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (contextRevision !== coachContextRevisionRef.current) return;
        const { data } = await api.get(`/api/mi-agent/coach/jobs/${jobId}`);
        if (data?.job?.status === "completed") {
          if (
            contextRevision !== coachContextRevisionRef.current ||
            JSON.stringify(coachContextRef.current) !== contextKey
          ) {
            throw new Error(
              "El contexto cambio mientras se analizaba la pregunta. Vuelve a intentarlo.",
            );
          }
          const activeContext = data.result?.activeContext;
          if (activeContext)
            await applyCoachActiveContext(activeContext, contextRevision);
          const persistedOperations = (data.result?.operations || [])
            .filter((operation) => operation.persistentId)
            .map((operation) => ({
              id: operation.persistentId,
              sessionId: Number(queued.sessionId || coachSessionId || 0),
              kind: operation.kind,
              status: operation.persistenceStatus || "ready",
              version: operation.persistenceVersion || 1,
              originalIntent: normalizedQuestion,
              missingFields: operation.missingFields || [],
              evidence: operation.evidence || [],
              targetModule: operation.targetModule || null,
              pendingOperation: operation,
            }));
          if (persistedOperations.length) {
            setCoachPendingOperations((current) => {
              const incomingIds = new Set(
                persistedOperations.map((operation) => operation.id),
              );
              return [
                ...persistedOperations,
                ...current.filter(
                  (operation) => !incomingIds.has(operation.id),
                ),
              ];
            });
          }
          setCoachMessages((current) =>
            current.map((message) =>
              message.id === `${messageId}-pending`
                ? { ...message, pending: false, result: data.result }
                : message,
            ),
          );
          break;
        }
        if (data?.job?.status === "failed")
          throw new Error(
            data.job.errorMessage || "No fue posible responder la pregunta",
          );
      }
    } catch (requestError) {
      setCoachMessages((current) =>
        current.map((message) =>
          message.id === `${messageId}-pending`
            ? {
                ...message,
                pending: false,
                error: getApiErrorMessage(
                  requestError,
                  "No fue posible responder la pregunta",
                ),
              }
            : message,
        ),
      );
      setError(
        getApiErrorMessage(requestError, "No fue posible consultar al Coach"),
      );
    } finally {
      setAskingCoach(false);
    }
  }

  async function analyzeSituation() {
    setAnalyzing(true);
    setError("");
    try {
      const { data: queued } = await api.post("/api/mi-agent/analyze", {
        snapshot,
      });
      const jobId = Number(queued?.job?.id || 0);
      if (!jobId) {
        throw new Error("No se pudo iniciar el análisis de Mi agente");
      }

      for (;;) {
        await new Promise((resolve) => {
          setTimeout(
            resolve,
            Math.max(500, Number(queued?.job?.pollAfterMs || 1000)),
          );
        });
        const { data: jobData } = await api.get(
          `/api/mi-agent/analyze/jobs/${jobId}`,
        );
        const status = String(jobData?.job?.status || "");
        if (status === "completed" && jobData.result) {
          setAnalysis(jobData.result);
          setSelectedAction(jobData.result.actions?.[0] || null);
          break;
        }
        if (status === "failed") {
          throw new Error(
            jobData?.job?.errorMessage ||
              "No fue posible completar el análisis de Mi agente",
          );
        }
      }
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible analizar tu situación comercial",
        ),
      );
    } finally {
      setAnalyzing(false);
    }
  }

  async function loadCoachGovernance() {
    setCoachGovernanceLoading(true);
    setError("");
    try {
      const [
        response,
        qualityResponse,
        rulesResponse,
        businessRulesResponse,
        intentsResponse,
        channelIntentsResponse,
      ] = await Promise.all([
        api.get("/api/commercial-intelligence/governance"),
        api.get("/api/mi-agent/coach/quality"),
        api.get(
          "/api/commercial-intelligence/governance/rules?channel=all&process=default",
        ),
        api.get(
          "/api/commercial-intelligence/governance/business-rules?channel=coach&process=default",
        ),
        api.get("/api/commercial-intelligence/governance/intents"),
        api
          .get(
            `/api/commercial-intelligence/governance/channel-intents/${channelIntentChannel}`,
          )
          .catch((requestError) => ({
            data: { loadError: requestError },
          })),
      ]);
      setCoachGovernance(response.data || null);
      setCoachQualityDashboard(qualityResponse.data?.quality || null);
      setCoachBusinessRulesDraft(
        JSON.stringify(
          businessRulesResponse.data?.businessRules || {},
          null,
          2,
        ),
      );
      setCoachBusinessRulesSource(
        businessRulesResponse.data?.configurationSource || null,
      );
      setCoachAdminRules(rulesResponse.data?.rules || []);
      const intentCatalog = intentsResponse.data?.catalog || [];
      setCoachIntentCatalog(intentCatalog);
      setCoachIntentRevisions(intentsResponse.data?.revisions || []);
      setCoachIntentCode((current) =>
        intentCatalog.some((item) => item.code === current)
          ? current
          : intentCatalog[0]?.code || "",
      );
      setCoachIntentExamplesDraft(
        (current) => current || (intentCatalog[0]?.examples || []).join("\n"),
      );
      const channelCatalog = channelIntentsResponse.data?.catalog || [];
      setChannelIntentCatalog(channelCatalog);
      setChannelIntentRevisions(channelIntentsResponse.data?.revisions || []);
      if (channelIntentsResponse.data?.loadError) {
        setChannelIntentFeedback({
          kind: "error",
          message: getApiErrorMessage(
            channelIntentsResponse.data.loadError,
            "No fue posible cargar la configuración del canal.",
          ),
        });
      }
      const initialChannelIntent = channelCatalog[0];
      setChannelIntentCode(initialChannelIntent?.code || "");
      setChannelIntentDraft(
        initialChannelIntent
          ? {
              enabled: initialChannelIntent.enabled,
              examples: initialChannelIntent.examples.join("\n"),
              priority: initialChannelIntent.priority,
              allowedTools: [...initialChannelIntent.allowedTools],
              requiredContext: [...initialChannelIntent.requiredContext],
            }
          : null,
      );
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar gobierno de Mi Coach",
        ),
      );
    } finally {
      setCoachGovernanceLoading(false);
    }
  }

  async function saveCoachGovernance() {
    if (!coachGovernance?.settings) return;
    setCoachGovernanceSaving(true);
    setError("");
    try {
      const response = await api.put(
        "/api/commercial-intelligence/governance/settings",
        coachGovernance.settings,
      );
      setCoachGovernance(response.data || coachGovernance);
      const contextResponse = await api.get("/api/mi-agent/context");
      setDashboard(contextResponse.data);
      if (coachContext.accountId) {
        const opportunitiesResponse = await api.get(
          `/api/opportunities?accountId=${coachContext.accountId}&activeOnly=true&openOnly=true`,
        );
        setCoachOpportunities(
          buildCoachOpportunityOptions(
            opportunitiesResponse.data,
            buildSnapshot(contextResponse.data),
            coachContext.accountId,
          ),
        );
      }
      setCoachNotice("Configuración de gobierno guardada.");
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible guardar gobierno de Mi Coach",
        ),
      );
    } finally {
      setCoachGovernanceSaving(false);
    }
  }

  function updateCoachBusinessRuleField(section, field, value) {
    setCoachBusinessRulesDraft((current) => {
      let rules = {};
      try {
        rules = JSON.parse(current || "{}");
      } catch {
        return current;
      }
      return JSON.stringify(
        {
          ...rules,
          [section]: {
            ...(rules[section] || {}),
            [field]: value,
          },
        },
        null,
        2,
      );
    });
  }

  function updateCoachOperationKind(kind, enabled) {
    let rules = {};
    try {
      rules = JSON.parse(coachBusinessRulesDraft || "{}");
    } catch {
      return;
    }
    const currentKinds = Array.isArray(rules.operationPolicy?.allowedKinds)
      ? rules.operationPolicy.allowedKinds
      : (COACH_OPERATION_OPTIONS[coachBusinessRulesChannel] || []).map(
          ([code]) => code,
        );
    const allowedKinds = enabled
      ? [...new Set([...currentKinds, kind])]
      : currentKinds.filter((currentKind) => currentKind !== kind);
    updateCoachBusinessRuleField(
      "operationPolicy",
      "allowedKinds",
      allowedKinds,
    );
  }

  function updateOpportunityStageSet(settingKey, stageCode, enabled) {
    setCoachGovernance((current) => {
      if (!current?.settings) return current;
      const settings = current.settings;
      const existing = Array.isArray(settings[settingKey])
        ? settings[settingKey]
        : [];
      const next = enabled
        ? [...new Set([...existing, stageCode])]
        : existing.filter((code) => code !== stageCode);
      if (!next.length) return current;
      const nextSettings = { ...settings, [settingKey]: next };
      if (settingKey === "qualifiedOpportunityStageCodes" && !enabled) {
        const remainingCommittedStages = (
          settings.committedOpportunityStageCodes || []
        ).filter((code) => code !== stageCode);
        nextSettings.committedOpportunityStageCodes =
          remainingCommittedStages.length > 0
            ? remainingCommittedStages
            : [next[next.length - 1]];
      }
      return { ...current, settings: nextSettings };
    });
  }

  async function saveCoachBusinessRules() {
    setCoachGovernanceSaving(true);
    setError("");
    try {
      const rules = JSON.parse(coachBusinessRulesDraft || "{}");
      const response = await api.put(
        "/api/commercial-intelligence/governance/business-rules",
        {
          channel: coachBusinessRulesChannel,
          process: coachBusinessRulesProcess,
          rules,
        },
      );
      setCoachBusinessRulesDraft(
        JSON.stringify(response.data?.businessRules || rules, null, 2),
      );
      setCoachBusinessRulesSource(
        response.data?.configurationSource || {
          sourceProcess: coachBusinessRulesProcess,
          hasSavedOverride: true,
          inheritedFromDefault: false,
        },
      );
      setCoachGovernance((current) => ({
        ...current,
        businessRules: response.data?.businessRules || rules,
      }));
      setCoachNotice("Reglas del motor guardadas.");
    } catch (requestError) {
      setError(
        requestError instanceof SyntaxError
          ? "El JSON de reglas no es valido."
          : getApiErrorMessage(
              requestError,
              "No fue posible guardar las reglas del motor",
            ),
      );
    } finally {
      setCoachGovernanceSaving(false);
    }
  }

  async function loadCoachBusinessRulesForScope(
    channel = coachBusinessRulesChannel,
    process = coachBusinessRulesProcess,
  ) {
    setCoachGovernanceSaving(true);
    setError("");
    try {
      const params = new URLSearchParams({
        channel,
        process,
      });
      const response = await api.get(
        `/api/commercial-intelligence/governance/business-rules?${params}`,
      );
      setCoachBusinessRulesDraft(
        JSON.stringify(response.data?.businessRules || {}, null, 2),
      );
      setCoachBusinessRulesSource(response.data?.configurationSource || null);
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar las reglas del motor",
        ),
      );
    } finally {
      setCoachGovernanceSaving(false);
    }
  }

  async function resetCoachBusinessRules() {
    setCoachGovernanceSaving(true);
    setError("");
    try {
      const params = new URLSearchParams({
        channel: coachBusinessRulesChannel,
        process: coachBusinessRulesProcess,
      });
      const response = await api.delete(
        `/api/commercial-intelligence/governance/business-rules?${params}`,
      );
      setCoachBusinessRulesDraft(
        JSON.stringify(response.data?.businessRules || {}, null, 2),
      );
      setCoachBusinessRulesSource(response.data?.configurationSource || null);
      setCoachNotice("Reglas restablecidas al valor predeterminado.");
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible restablecer las reglas",
        ),
      );
    } finally {
      setCoachGovernanceSaving(false);
    }
  }

  async function loadCoachAdminRules(
    channel = "all",
    process = coachBusinessRulesProcess,
  ) {
    setCoachGovernanceSaving(true);
    setError("");
    try {
      const params = new URLSearchParams({ channel, process });
      const response = await api.get(
        `/api/commercial-intelligence/governance/rules?${params}`,
      );
      setCoachAdminRules(response.data?.rules || []);
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, "No fue posible cargar las reglas"),
      );
    } finally {
      setCoachGovernanceSaving(false);
    }
  }

  function startCoachAdminRuleCreate(scope) {
    setCoachAdminRuleEditingId(null);
    setCoachAdminRuleDraft({
      scope,
      channel: scope === "channel" ? coachBusinessRulesChannel : null,
      process: scope === "channel" ? coachBusinessRulesProcess : "default",
      title: "",
      instruction: "",
      enabled: true,
      sortOrder:
        Math.max(
          0,
          ...coachAdminRules.map((rule) => Number(rule.sortOrder || 0)),
        ) + 10,
    });
  }

  function startCoachAdminRuleEdit(rule) {
    setCoachAdminRuleEditingId(rule.id);
    setCoachAdminRuleDraft({ ...rule });
  }

  async function saveCoachAdminRule() {
    if (!coachAdminRuleDraft) return;
    setCoachGovernanceSaving(true);
    setCoachAdminRuleFeedback(null);
    setError("");
    try {
      const payload = {
        title: coachAdminRuleDraft.title.trim(),
        instruction: coachAdminRuleDraft.instruction.trim(),
        enabled: Boolean(coachAdminRuleDraft.enabled),
        sortOrder: Number(coachAdminRuleDraft.sortOrder || 0),
      };
      if (coachAdminRuleEditingId) {
        await api.put(
          `/api/commercial-intelligence/governance/rules/${coachAdminRuleEditingId}`,
          payload,
        );
      } else {
        const response = await api.post(
          "/api/commercial-intelligence/governance/rules",
          {
            ...payload,
            scope: coachAdminRuleDraft.scope,
            process: coachAdminRuleDraft.process,
            ...(coachAdminRuleDraft.scope === "channel"
              ? { channel: coachAdminRuleDraft.channel }
              : {}),
          },
        );
        const createdRule = response.data?.rule;
        if (createdRule?.id) {
          setCoachAdminRules((current) =>
            current.some((rule) => rule.id === createdRule.id)
              ? current
              : [...current, createdRule],
          );
        }
      }
      setCoachAdminRuleDraft(null);
      setCoachAdminRuleEditingId(null);
      await loadCoachAdminRules("all", coachBusinessRulesProcess);
      const savedTitle = payload.title;
      setCoachAdminRuleFeedback({
        kind: "success",
        message: `La regla “${savedTitle}” se guardó correctamente y ya aparece en la lista.`,
      });
      setCoachNotice("Regla guardada correctamente.");
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible guardar la regla.",
      );
      setCoachAdminRuleFeedback({ kind: "error", message });
      setError(message);
    } finally {
      setCoachGovernanceSaving(false);
    }
  }

  async function toggleCoachAdminRule(rule) {
    setCoachGovernanceSaving(true);
    setCoachAdminRuleFeedback(null);
    setError("");
    try {
      await api.put(
        `/api/commercial-intelligence/governance/rules/${rule.id}`,
        {
          title: rule.title,
          instruction: rule.instruction,
          enabled: !rule.enabled,
          sortOrder: rule.sortOrder,
        },
      );
      await loadCoachAdminRules();
      setCoachAdminRuleFeedback({
        kind: "success",
        message: `La regla “${rule.title}” se actualizó correctamente.`,
      });
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible actualizar la regla.",
      );
      setCoachAdminRuleFeedback({ kind: "error", message });
      setError(message);
    } finally {
      setCoachGovernanceSaving(false);
    }
  }

  async function deleteCoachAdminRule(rule) {
    if (!window.confirm(`¿Eliminar la regla “${rule.title}”?`)) return;
    setCoachGovernanceSaving(true);
    setCoachAdminRuleFeedback(null);
    setError("");
    try {
      await api.delete(
        `/api/commercial-intelligence/governance/rules/${rule.id}`,
      );
      setCoachAdminRules((current) =>
        current.filter((item) => item.id !== rule.id),
      );
      if (coachAdminRuleEditingId === rule.id) {
        setCoachAdminRuleDraft(null);
        setCoachAdminRuleEditingId(null);
      }
      setCoachNotice("Regla eliminada.");
      setCoachAdminRuleFeedback({
        kind: "success",
        message: `La regla “${rule.title}” se eliminó correctamente.`,
      });
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible eliminar la regla.",
      );
      setCoachAdminRuleFeedback({ kind: "error", message });
      setError(message);
    } finally {
      setCoachGovernanceSaving(false);
    }
  }

  function selectCoachIntent(intent) {
    setCoachIntentCode(intent.code);
    setCoachIntentExamplesDraft((intent.examples || []).join("\n"));
    setCoachIntentPreview(null);
    setCoachIntentFeedback(null);
  }

  async function saveCoachIntentExamples() {
    const examples = coachIntentExamplesDraft
      .split("\n")
      .map((example) => example.trim())
      .filter(Boolean);
    setCoachGovernanceSaving(true);
    setCoachIntentFeedback(null);
    setError("");
    try {
      const response = await api.put(
        `/api/commercial-intelligence/governance/intents/${coachIntentCode}/examples`,
        { examples },
      );
      setCoachIntentCatalog(response.data?.catalog || []);
      setCoachIntentRevisions(
        (
          await api.get(
            "/api/commercial-intelligence/governance/intents/revisions",
          )
        ).data?.revisions || [],
      );
      setCoachIntentFeedback({
        kind: "success",
        message: "Los ejemplos se guardaron y quedaron auditados.",
      });
      setCoachNotice("Ejemplos de enrutamiento guardados.");
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible guardar los ejemplos de intención.",
      );
      setCoachIntentFeedback({ kind: "error", message });
      setError(message);
    } finally {
      setCoachGovernanceSaving(false);
    }
  }

  async function previewCoachIntent() {
    const examples = coachIntentExamplesDraft
      .split("\n")
      .map((example) => example.trim())
      .filter(Boolean);
    setCoachGovernanceSaving(true);
    setCoachIntentFeedback(null);
    setCoachIntentPreview(null);
    setError("");
    try {
      const { data } = await api.post(
        "/api/mi-agent/coach/admin/intents/preview",
        {
          question: coachIntentTestQuestion,
          intentCode: coachIntentCode,
          examples,
        },
      );
      setCoachIntentPreview(data);
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible probar la clasificación.",
      );
      setCoachIntentFeedback({ kind: "error", message });
      setError(message);
    } finally {
      setCoachGovernanceSaving(false);
    }
  }

  async function restoreCoachIntentRevision(revision) {
    if (
      !window.confirm(
        `¿Restaurar la configuración anterior a la revisión ${revision.id}?`,
      )
    ) {
      return;
    }
    setCoachGovernanceSaving(true);
    setCoachIntentFeedback(null);
    setError("");
    try {
      const { data } = await api.post(
        `/api/commercial-intelligence/governance/intents/revisions/${revision.id}/restore`,
      );
      setCoachIntentCatalog(data.catalog || []);
      setCoachIntentRevisions(data.revisions || []);
      const selected = (data.catalog || []).find(
        (item) => item.code === coachIntentCode,
      );
      if (selected) setCoachIntentExamplesDraft(selected.examples.join("\n"));
      setCoachIntentPreview(null);
      setCoachIntentFeedback({
        kind: "success",
        message: `Se restauró la revisión ${revision.id}; la restauración también quedó registrada.`,
      });
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible restaurar la configuración.",
      );
      setCoachIntentFeedback({ kind: "error", message });
      setError(message);
    } finally {
      setCoachGovernanceSaving(false);
    }
  }

  function selectChannelIntent(intent) {
    setChannelIntentCode(intent.code);
    setChannelIntentDraft({
      enabled: intent.enabled,
      examples: intent.examples.join("\n"),
      priority: intent.priority,
      allowedTools: [...intent.allowedTools],
      requiredContext: [...intent.requiredContext],
    });
    setChannelIntentPreview(null);
    setChannelIntentFeedback(null);
  }

  async function loadChannelIntentChannel(channel) {
    setChannelIntentChannel(channel);
    setChannelIntentCatalog([]);
    setChannelIntentRevisions([]);
    setChannelIntentCode("");
    setChannelIntentDraft(null);
    setChannelIntentSaving(true);
    setChannelIntentFeedback(null);
    setChannelIntentPreview(null);
    try {
      const { data } = await api.get(
        `/api/commercial-intelligence/governance/channel-intents/${channel}`,
      );
      const catalog = data?.catalog || [];
      const firstIntent = catalog[0];
      setChannelIntentCatalog(catalog);
      setChannelIntentRevisions(data?.revisions || []);
      setChannelIntentCode(firstIntent?.code || "");
      setChannelIntentDraft(
        firstIntent
          ? {
              enabled: firstIntent.enabled,
              examples: firstIntent.examples.join("\n"),
              priority: firstIntent.priority,
              allowedTools: [...firstIntent.allowedTools],
              requiredContext: [...firstIntent.requiredContext],
            }
          : null,
      );
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible cargar la configuración del canal.",
      );
      setChannelIntentFeedback({ kind: "error", message });
    } finally {
      setChannelIntentSaving(false);
    }
  }

  async function saveChannelIntentConfiguration() {
    if (!channelIntentDraft || !channelIntentCode) return;
    const configuration = {
      ...channelIntentDraft,
      examples: channelIntentDraft.examples
        .split("\n")
        .map((example) => example.trim())
        .filter(Boolean),
    };
    setChannelIntentSaving(true);
    setChannelIntentFeedback(null);
    try {
      const { data } = await api.put(
        `/api/commercial-intelligence/governance/channel-intents/${channelIntentChannel}/${channelIntentCode}`,
        configuration,
      );
      const catalog = data?.catalog || [];
      setChannelIntentCatalog(catalog);
      setChannelIntentRevisions(data?.revisions || []);
      const savedIntent = catalog.find(
        (intent) => intent.code === channelIntentCode,
      );
      if (savedIntent) selectChannelIntent(savedIntent);
      setChannelIntentFeedback({
        kind: "success",
        message: "La configuración se guardó y quedó auditada.",
      });
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible guardar la configuración del canal.",
      );
      setChannelIntentFeedback({ kind: "error", message });
    } finally {
      setChannelIntentSaving(false);
    }
  }

  async function previewChannelIntentConfiguration() {
    setChannelIntentSaving(true);
    setChannelIntentFeedback(null);
    setChannelIntentPreview(null);
    try {
      const { data } = await api.post(
        "/api/commercial-intelligence/governance/channel-intents/preview",
        {
          channel: channelIntentChannel,
          question: channelIntentTestQuestion,
          intentCode: channelIntentCode,
          configuration: {
            ...channelIntentDraft,
            examples: channelIntentDraft.examples
              .split("\n")
              .map((example) => example.trim())
              .filter(Boolean),
          },
        },
      );
      setChannelIntentPreview(data);
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible probar el enrutamiento.",
      );
      setChannelIntentFeedback({ kind: "error", message });
    } finally {
      setChannelIntentSaving(false);
    }
  }

  async function restoreChannelIntentConfiguration(revision) {
    if (
      !window.confirm(
        `¿Restaurar la configuración del canal a la revisión ${revision.id}?`,
      )
    ) {
      return;
    }
    setChannelIntentSaving(true);
    setChannelIntentFeedback(null);
    try {
      const { data } = await api.post(
        `/api/commercial-intelligence/governance/channel-intents/${channelIntentChannel}/revisions/${revision.id}/restore`,
      );
      const catalog = data?.catalog || [];
      setChannelIntentCatalog(catalog);
      setChannelIntentRevisions(data?.revisions || []);
      const selected = catalog.find(
        (intent) => intent.code === channelIntentCode,
      );
      if (selected) selectChannelIntent(selected);
      setChannelIntentFeedback({
        kind: "success",
        message: `Se restauró la revisión ${revision.id} y la restauración quedó registrada.`,
      });
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible restaurar la configuración del canal.",
      );
      setChannelIntentFeedback({ kind: "error", message });
    } finally {
      setChannelIntentSaving(false);
    }
  }

  function openCoachActionConfirmation(action) {
    if (!canExecuteCoach || !canUpdateCommercialDevelopment || !action?.title)
      return;
    setCoachActionDraft({
      action,
      opportunityId: action.opportunityId || "",
      title: action.title || "",
      actionType: action.actionType || "next_step",
      status: action.status || "pending",
      dueDate: action.suggestedDueDate || "",
      scheduledAt: action.scheduledAt || "",
      priority:
        action.priority === "critical" ? "high" : action.priority || "medium",
      successCriteria: action.successCriteria || action.expectedOutcome || "",
      notes:
        action.notes ||
        action.reason ||
        "Creada desde el Coach Comercial de Mi Agente.",
      contextSnapshot:
        snapshot.pipeline.opportunities.find(
          (item) => Number(item.id) === Number(action.opportunityId),
        ) || null,
    });
    setError("");
  }

  function openClarifiedCoachActivity(candidate, activity) {
    openCoachActionConfirmation({
      opportunityId: candidate.id,
      title: activity?.title || "Actividad comercial",
      actionType: activity?.actionType || "meeting",
      status: "pending",
      priority: activity?.priority || "medium",
      scheduledAt: activity?.scheduledAt || "",
      suggestedDueDate: activity?.dueDate || "",
      notes: activity?.notes || activity?.rawRequest || "",
      successCriteria:
        activity?.successCriteria ||
        "Definir el siguiente compromiso del cliente.",
    });
  }

  async function applyCoachClarification(candidate, clarification) {
    const entityType = candidate?.entityType;
    if (!entityType) {
      setError(
        "La aclaración del Coach no incluye el tipo de entidad requerido.",
      );
      return;
    }
    if (clarification?.activity && entityType === "opportunity") {
      openClarifiedCoachActivity(candidate, clarification.activity);
      return;
    }
    const nextContext = {
      accountId: String(
        candidate?.accountId || (entityType === "account" ? candidate.id : ""),
      ),
      opportunityId: String(
        candidate?.opportunityId ||
          (entityType === "opportunity" ? candidate.id : ""),
      ),
      contactId: String(
        candidate?.contactId || (entityType === "contact" ? candidate.id : ""),
      ),
      leadId: String(entityType === "lead" ? candidate.id : ""),
    };
    setCoachContext(nextContext);
    coachContextRef.current = nextContext;
    setCoachSessionId(null);
    setCoachActionDraft(null);
    setCoachOperationDraft(null);
    if (entityType === "account") {
      setCoachAccounts((current) =>
        current.some((item) => Number(item.id) === Number(candidate.id))
          ? current
          : [...current, candidate],
      );
    }
    await askCoach(
      clarification?.originalRequest || "Continúa con la solicitud anterior.",
      nextContext,
      null,
    );
  }

  async function createNextStep() {
    const draft = coachActionDraft;
    const action = draft?.action;
    const opportunityId = Number(
      draft?.opportunityId || action?.opportunityId || 0,
    );
    if (!opportunityId || !draft?.title.trim()) return;
    setCreatingActionRank(action.rank);
    setError("");
    try {
      const proposed = await api.post("/api/mi-agent/coach/operations", {
        sessionId: coachSessionId,
        originalIntent: action.reason || action.title,
        context: { opportunityId },
        operation: {
          kind: "activity",
          title: draft.title.trim(),
          opportunityId,
          activityId: null,
          actionType: draft.actionType,
          status: draft.status,
          priority: draft.priority,
          dueDate: draft.dueDate || null,
          scheduledAt: draft.scheduledAt || null,
          successCriteria: draft.successCriteria.trim() || null,
          notes: draft.notes.trim() || null,
          evidence: [],
          missingFields: [],
          requiresConfirmation: true,
        },
      });
      const operation = proposed.data?.operation;
      if (!operation?.id) throw new Error("No se pudo preparar la actividad");
      const response = await api.post(
        `/api/mi-agent/coach/operations/${operation.id}/handoff`,
      );
      if (!response.data?.handoff?.url) {
        throw new Error("No se pudo abrir Desarrollo Comercial");
      }
      if (proposed.data?.sessionId)
        setCoachSessionId(Number(proposed.data.sessionId));
      setCoachActionDraft(null);
      navigate(response.data.handoff.url);
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible crear el próximo paso",
        ),
      );
    } finally {
      setCreatingActionRank(null);
    }
  }

  async function openCoachOperationConfirmation(
    operation,
    { opportunityOptions = null } = {},
  ) {
    coachReturnFocusRef.current = document.activeElement;
    const canApplyOperation = !canExecuteCoach
      ? false
      : operation?.kind === "lead_call_outcome"
        ? canUpdateLeads
        : operation?.kind === "account_field"
          ? canUpdateAccounts
          : operation?.kind === "contact_field"
            ? canUpdateContacts
            : operation?.kind === "create_account"
              ? canCreateAccounts
              : operation?.kind === "create_contact"
                ? canCreateContacts
                : operation?.kind === "lead_resolve"
                  ? canResolveLeads
                  : operation?.kind === "create_opportunity"
                    ? canCreateOpportunities
                    : operation?.kind === "activity"
                      ? canUpdateCommercialDevelopment
                      : operation?.kind === "create_lead"
                        ? canCreateLeads
                        : operation?.kind === "create_contact_mapping"
                          ? canUpdateContacts
                          : operation?.kind === "create_quotation"
                            ? canCreateQuotations
                            : operation?.kind === "create_proposal"
                              ? canCreateProposals
                              : ["stage_answer", "opportunity_field"].includes(
                                    operation?.kind,
                                  )
                                ? canCreateActions
                                : false;
    if (
      !canApplyOperation ||
      (!(
        operation?.opportunityId ||
        operation?.accountId ||
        operation?.contactId ||
        operation?.interactionId ||
        operation?.quotationVersionId
      ) &&
        ![
          "create_account",
          "create_opportunity",
          "create_quotation",
          "create_proposal",
        ].includes(operation?.kind))
    )
      return;
    setCoachOperationOpportunityOptionsOverride(opportunityOptions);
    const persistedOperation = coachPendingOperations.find(
      (candidate) => candidate.id === Number(operation.persistentId || 0),
    );
    let reviewedOperation = persistedOperation;
    if (
      persistedOperation &&
      !COACH_HANDOFF_OPERATION_KINDS.has(operation?.kind)
    ) {
      setSavingCoachOperation(true);
      try {
        const response = await api.post(
          `/api/mi-agent/coach/operations/${persistedOperation.id}/review`,
          { version: persistedOperation.version },
        );
        reviewedOperation = response.data?.operation || persistedOperation;
        setCoachPendingOperations((current) =>
          current.map((item) =>
            item.id === reviewedOperation.id ? reviewedOperation : item,
          ),
        );
      } catch (requestError) {
        const message = getApiErrorMessage(
          requestError,
          "No fue posible revisar el valor actual",
        );
        setCoachOperationAction({
          id: persistedOperation.id,
          state: "error",
          message,
        });
        return;
      } finally {
        setSavingCoachOperation(false);
      }
    }
    const draft = buildCoachOperationDraft(operation, reviewedOperation);
    draft.idempotencyKey = crypto.randomUUID();
    coachDraftSaveSignatureRef.current = JSON.stringify({
      pendingOperation: serializeCoachOperationDraft(draft),
      missingFields: unresolvedCoachFields(serializeCoachOperationDraft(draft)),
    });
    setCoachOperationDraft(draft);
    setError("");
  }

  async function persistCoachOperationDraft(draft) {
    if (!draft?.persistentId) return draft;
    const pendingOperation = serializeCoachOperationDraft(draft);
    const response = await api.patch(
      `/api/mi-agent/coach/operations/${draft.persistentId}`,
      {
        pendingOperation,
        missingFields: unresolvedCoachFields(pendingOperation),
        version: draft.version,
      },
    );
    const persisted = response.data?.operation;
    if (!persisted) return draft;
    setCoachPendingOperations((current) =>
      current.map((item) => (item.id === persisted.id ? persisted : item)),
    );
    return {
      ...draft,
      operation: persisted.pendingOperation,
      version: persisted.version,
      persistenceStatus: persisted.status,
      reviewedAt: persisted.reviewedAt || null,
    };
  }

  function appendCoachOperationMessage(text, type = "success") {
    setCoachMessages((current) => [
      ...current,
      {
        id: `coach-operation-${Date.now()}-${Math.random()}`,
        role: "coach",
        result: {
          responseType: type === "error" ? "error" : "operation",
          confidence: "high",
          answer: text,
          evidence: [],
          recommendation:
            type === "error"
              ? "Corrige el problema y vuelve a intentarlo."
              : "La operación fue aplicada correctamente.",
        },
      },
    ]);
  }

  function closeCoachOperationDraft() {
    setCoachOperationDraft(null);
    setCoachOperationOpportunityOptionsOverride(null);
    window.requestAnimationFrame(() => coachReturnFocusRef.current?.focus());
  }

  async function applyCoachOperation() {
    let draft = coachOperationDraft;
    let operation = draft?.operation;
    const delegatesToModule = COACH_HANDOFF_OPERATION_KINDS.has(
      operation?.kind,
    );
    if (
      !delegatesToModule &&
      !(
        draft?.opportunityId ||
        operation?.opportunityId ||
        operation?.accountId ||
        operation?.contactId ||
        operation?.interactionId
      )
    )
      return;
    setError("");
    setSavingCoachOperation(true);
    try {
      draft = await persistCoachOperationDraft(draft);
      operation = draft?.operation;
      if (delegatesToModule) {
        if (!draft?.persistentId)
          throw new Error("La operación no tiene un borrador persistente");
        const response = await api.post(
          `/api/mi-agent/coach/operations/${draft.persistentId}/handoff`,
        );
        const handoff = response.data?.handoff;
        if (!handoff?.url)
          throw new Error("No fue posible preparar el módulo de destino");
        if (response.data?.operation) {
          setCoachPendingOperations((current) =>
            current.map((item) =>
              item.id === response.data.operation.id
                ? response.data.operation
                : item,
            ),
          );
        }
        closeCoachOperationDraft();
        navigate(handoff.url);
        return;
      }
      if (!draft.reviewedAt) {
        const reviewResponse = await api.post(
          `/api/mi-agent/coach/operations/${draft.persistentId}/review`,
          { version: draft.version },
        );
        const reviewedOperation = reviewResponse.data?.operation;
        if (!reviewedOperation)
          throw new Error("No fue posible revisar el valor actual");
        setCoachPendingOperations((current) =>
          current.map((item) =>
            item.id === reviewedOperation.id ? reviewedOperation : item,
          ),
        );
        setCoachOperationDraft((current) =>
          current?.persistentId === reviewedOperation.id
            ? {
                ...current,
                operation: {
                  ...reviewedOperation.pendingOperation,
                  missingFields: reviewedOperation.missingFields || [],
                },
                version: reviewedOperation.version,
                persistenceStatus: reviewedOperation.status,
                reviewedAt: reviewedOperation.reviewedAt,
                error: "",
              }
            : current,
        );
        return;
      }
      const response = await api.post(
        `/api/mi-agent/coach/operations/${draft.persistentId}/execute`,
        {
          version: draft.version,
          idempotencyKey: draft.idempotencyKey,
        },
      );
      const completedOperation = response.data?.operation;
      if (!operation.successNotice) {
        operation.successNotice =
          operation.kind === "opportunity_field"
            ? "Cambio de la oportunidad guardado correctamente."
            : operation.kind === "stage_answer"
              ? "Respuesta de etapa guardada correctamente."
              : operation.kind === "account_field"
                ? "Cambio de la cuenta guardado correctamente."
                : operation.kind === "contact_field"
                  ? "Cambio del contacto guardado correctamente."
                  : operation.kind === "lead_call_outcome"
                    ? "Resultado del lead guardado correctamente."
                    : "Cambio guardado correctamente en el CRM.";
      }
      if (completedOperation?.id)
        setCoachUndoOperationId(completedOperation.id);
      if (completedOperation) {
        setCoachPendingOperations((current) =>
          current.filter((item) => item.id !== completedOperation.id),
        );
        setCoachRecentOperations((current) =>
          [
            completedOperation,
            ...current.filter((item) => item.id !== completedOperation.id),
          ].slice(0, 6),
        );
      }
      closeCoachOperationDraft();
      setCoachMessages((current) =>
        current
          .filter((message) => message.result?.responseType !== "error")
          .map((message) => {
            if (!Array.isArray(message.result?.operations)) return message;
            const remainingOperations = message.result.operations.filter(
              (candidate) =>
                candidate !== operation &&
                !(
                  candidate.kind === operation.kind &&
                  candidate.opportunityId === operation.opportunityId &&
                  candidate.accountId === operation.accountId &&
                  candidate.contactId === operation.contactId &&
                  candidate.field === operation.field
                ),
            );
            return remainingOperations.length ===
              message.result.operations.length
              ? message
              : {
                  ...message,
                  result: {
                    ...message.result,
                    operations: remainingOperations,
                  },
                };
          }),
      );
      if (operation.successNotice)
        appendCoachOperationMessage(operation.successNotice);
      await loadDashboard();
      if (operation.successNotice) setCoachNotice(operation.successNotice);
    } catch (requestError) {
      const responseData = requestError?.response?.data;
      const errorCode = responseData?.code;
      setCoachOperationDraft((current) =>
        current
          ? {
              ...current,
              operation:
                errorCode === "COACH_TARGET_CHANGED" &&
                Object.prototype.hasOwnProperty.call(
                  responseData || {},
                  "currentValue",
                )
                  ? {
                      ...current.operation,
                      currentValue: responseData.currentValue,
                    }
                  : current.operation,
              version: responseData?.operation?.version || current.version,
              persistenceStatus:
                responseData?.operation?.status || current.persistenceStatus,
              reviewedAt:
                errorCode === "COACH_TARGET_CHANGED" ||
                errorCode === "COACH_REVIEW_REQUIRED"
                  ? null
                  : current.reviewedAt,
              error: getApiErrorMessage(
                requestError,
                "No fue posible aplicar el cambio propuesto",
              ),
              duplicateWarnings:
                responseData?.duplicateWarnings ||
                current.duplicateWarnings ||
                [],
              duplicateDecision:
                responseData?.duplicateDecision ||
                current.duplicateDecision ||
                null,
              duplicateReview:
                responseData?.duplicateReview ||
                current.duplicateReview ||
                null,
            }
          : current,
      );
      appendCoachOperationMessage(
        getApiErrorMessage(
          requestError,
          "No fue posible aplicar el cambio propuesto",
        ),
        "error",
      );
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible aplicar el cambio propuesto",
        ),
      );
    } finally {
      setSavingCoachOperation(false);
    }
  }

  async function undoCoachOperation() {
    if (!coachUndoOperationId) return;
    try {
      const response = await api.post(
        `/api/mi-agent/coach/operations/${coachUndoOperationId}/revert`,
      );
      if (response.data?.operation) {
        setCoachRecentOperations((current) =>
          [
            response.data.operation,
            ...current.filter((item) => item.id !== response.data.operation.id),
          ].slice(0, 6),
        );
      }
      setCoachUndoOperationId(null);
      await loadDashboard();
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible revertir el cambio del Coach",
        ),
      );
    }
  }

  async function rejectCoachOperation(operation) {
    const persistentId =
      coachOperationDraft?.persistentId || operation?.persistentId || null;
    if (!persistentId) {
      closeCoachOperationDraft();
      return;
    }
    try {
      const response = await api.post(
        `/api/mi-agent/coach/operations/${persistentId}/reject`,
        { reason: "Rechazada por el vendedor" },
      );
      if (response.data?.operation) {
        setCoachPendingOperations((current) =>
          current.filter((item) => item.id !== response.data.operation.id),
        );
        setCoachRecentOperations((current) =>
          [
            response.data.operation,
            ...current.filter((item) => item.id !== response.data.operation.id),
          ].slice(0, 6),
        );
      }
      closeCoachOperationDraft();
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible rechazar la operación del Coach",
        ),
      );
    }
  }

  async function continueCoachOperation(persistedOperation) {
    const operation = {
      ...persistedOperation.pendingOperation,
      persistentId: persistedOperation.id,
    };
    if (persistedOperation.status !== "handed_off") {
      await openCoachOperationConfirmation(operation);
      return;
    }
    setCoachOperationAction({ id: persistedOperation.id, state: "loading" });
    try {
      const response = await api.post(
        `/api/mi-agent/coach/operations/${persistedOperation.id}/handoff`,
      );
      if (!response.data?.handoff?.url) {
        throw new Error("No fue posible recuperar el módulo de destino");
      }
      navigate(response.data.handoff.url);
    } catch (requestError) {
      setCoachOperationAction({
        id: persistedOperation.id,
        state: "error",
        message: getApiErrorMessage(
          requestError,
          "No fue posible continuar la operación",
        ),
      });
    }
  }

  async function cancelPendingCoachOperation(persistedOperation) {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "¿Quieres descartar esta acción pendiente? La información preparada se perderá.",
      )
    ) {
      return;
    }
    setCoachOperationAction({ id: persistedOperation.id, state: "loading" });
    try {
      const response = await api.post(
        `/api/mi-agent/coach/operations/${persistedOperation.id}/status`,
        {
          status: "cancelled",
          cancellationReason: "Cancelada por el vendedor",
        },
      );
      setCoachPendingOperations((current) =>
        current.filter((item) => item.id !== persistedOperation.id),
      );
      if (response.data?.operation) {
        setCoachRecentOperations((current) =>
          [
            response.data.operation,
            ...current.filter((item) => item.id !== response.data.operation.id),
          ].slice(0, 6),
        );
      }
      setCoachOperationAction({});
    } catch (requestError) {
      setCoachOperationAction({
        id: persistedOperation.id,
        state: "error",
        message: getApiErrorMessage(
          requestError,
          "No fue posible descartar la acción",
        ),
      });
    }
  }

  function rejectCoachAction() {
    setCoachActionDraft(null);
  }

  function updateCoachPayloadField(field, value) {
    setCoachOperationDraft((current) => ({
      ...current,
      payload: { ...(current?.payload || {}), [field]: value },
      value: "",
    }));
  }

  function updateCoachFoundationVisibility(visible) {
    setShowCoachFoundation(visible);
    window.localStorage.setItem(
      COACH_FOUNDATION_VISIBILITY_KEY,
      String(visible),
    );
  }

  function updateCustomerChatFoundationVisibility(visible) {
    setShowCustomerChatFoundation(visible);
    window.localStorage.setItem(
      CUSTOMER_CHAT_FOUNDATION_VISIBILITY_KEY,
      String(visible),
    );
  }

  const coachDraftSerialized = coachOperationDraft
    ? serializeCoachOperationDraft(coachOperationDraft)
    : null;
  const coachDraftMissingFields = coachDraftSerialized
    ? unresolvedCoachFields(coachDraftSerialized)
    : [];
  const coachDraftMissingSet = new Set(coachDraftMissingFields);
  const hasCoachFoundation = coachMessages.some((message) => {
    const result = message.result;
    return Boolean(
      result?.facts?.length ||
      result?.evidence?.length ||
      result?.inferences?.length ||
      result?.recommendation,
    );
  });
  const hasCustomerChatFoundation = customerChatMessages.some(
    (message) =>
      message.role !== "seller" &&
      (message.evidence?.length ||
        message.inferences?.length ||
        message.publicSources?.length ||
        message.agents?.length),
  );
  const hasCoachConversation = Boolean(
    coachSessionId ||
    coachMessages.length ||
    coachRecentOperations.length ||
    coachOperationDraft,
  );
  let selectedCoachBusinessRules = {};
  try {
    selectedCoachBusinessRules = JSON.parse(coachBusinessRulesDraft || "{}");
  } catch {
    selectedCoachBusinessRules = {};
  }
  const coachBusinessRulesSourceLabel =
    coachBusinessRulesSource?.hasSavedOverride &&
    coachBusinessRulesSource.sourceProcess === coachBusinessRulesProcess
      ? coachBusinessRulesProcess === "default"
        ? "Hay una configuración predeterminada guardada para este canal."
        : "Hay ajustes propios guardados para este tipo de consulta."
      : coachBusinessRulesSource?.inheritedFromDefault
        ? "No hay ajustes propios para este tipo; se usa la configuración predeterminada del canal."
        : "Se usan los valores iniciales del sistema para este canal.";
  const selectedCoachProcessOption = getCoachProcessOption(
    coachBusinessRulesProcess,
    coachBusinessRulesChannel,
  );
  const getVisibleChannelRules = (channel) =>
    coachAdminRules.filter(
      (rule) =>
        rule.scope === "channel" &&
        rule.channel === channel &&
        (channel !== coachBusinessRulesChannel ||
          rule.process === "default" ||
          rule.process === coachBusinessRulesProcess),
    );
  const selectedCoachIntent = coachIntentCatalog.find(
    (intent) => intent.code === coachIntentCode,
  );
  const selectedChannelIntent = channelIntentCatalog.find(
    (intent) => intent.code === channelIntentCode,
  );

  if (loading) {
    return (
      <section className="mi-agent-page">
        <div className="mi-agent-empty">Cargando tu situación comercial...</div>
      </section>
    );
  }

  return (
    <section className="mi-agent-page">
      <header className="mi-agent-hero">
        <div>
          <span className="mi-agent-kicker">Ejecución comercial</span>
          <h2>Mi Coach</h2>
          <p>Tu siguiente mejor movimiento para acercarte a la cuota.</p>
        </div>
      </header>

      {error ? <p className="form-error">{error}</p> : null}
      {coachNotice ? (
        <p className="mi-agent-coach-success" role="status">
          {coachNotice}
        </p>
      ) : null}

      <div className="mi-agent-workspace-navigation">
        <nav
          className="mi-agent-workspace-tabs"
          aria-label="Espacios de Mi Coach"
        >
          <button
            type="button"
            className={activeWorkspace === "summary" ? "is-active" : ""}
            aria-current={activeWorkspace === "summary" ? "page" : undefined}
            onClick={() => setActiveWorkspace("summary")}
          >
            <LayoutDashboard size={16} aria-hidden="true" />
            Resumen
          </button>
          <button
            type="button"
            className={activeWorkspace === "coach" ? "is-active" : ""}
            aria-current={activeWorkspace === "coach" ? "page" : undefined}
            onClick={() => setActiveWorkspace("coach")}
          >
            <MessageCircle size={16} aria-hidden="true" />
            Coach
          </button>
          {canReadCustomerIntelligence ? (
            <button
              type="button"
              className={activeWorkspace === "customer" ? "is-active" : ""}
              aria-current={activeWorkspace === "customer" ? "page" : undefined}
              onClick={() => setActiveWorkspace("customer")}
            >
              Cliente existente
            </button>
          ) : null}
          {canReadProspecting || canCreateProspecting ? (
            <button
              type="button"
              className={activeWorkspace === "prospect" ? "is-active" : ""}
              aria-current={activeWorkspace === "prospect" ? "page" : undefined}
              onClick={() => setActiveWorkspace("prospect")}
            >
              Cuenta nueva
            </button>
          ) : null}
        </nav>
        {canManageCoach ? (
          <nav className="mi-agent-workspace-admin" aria-label="Administración">
            <button
              type="button"
              className={activeWorkspace === "admin" ? "is-active" : ""}
              aria-current={activeWorkspace === "admin" ? "page" : undefined}
              onClick={() => {
                setActiveWorkspace("admin");
                loadCoachGovernance();
              }}
            >
              <Settings2 size={16} aria-hidden="true" />
              Administración
            </button>
          </nav>
        ) : null}
      </div>

      {activeWorkspace === "summary" || activeWorkspace === "coach" ? (
        <>
          {activeWorkspace === "summary" ? (
            <section
              className="mi-agent-summary"
              aria-labelledby="mi-agent-summary-title"
            >
              <div className="mi-agent-section-heading">
                <div>
                  <span className="mi-agent-section-label">Vista general</span>
                  <h3 id="mi-agent-summary-title">Resumen comercial</h3>
                </div>
                <div className="mi-agent-summary-period">
                  <span>{snapshot.period?.label || "Período actual"}</span>
                  {currency !== "USD" &&
                  snapshot.quota.currencyConversionAvailable ? (
                    <small>
                      1 USD ={" "}
                      {snapshot.quota.usdToQuotaRate.toLocaleString("es-MX", {
                        maximumFractionDigits: 4,
                      })}{" "}
                      {currency} · tasa de referencia{" "}
                      {snapshot.quota.currencyRateFetchedAt
                        ? formatDate(snapshot.quota.currencyRateFetchedAt)
                        : "actual"}
                    </small>
                  ) : null}
                </div>
              </div>
              <div className="mi-agent-metrics">
                <article>
                  <span>Cuota</span>
                  <strong>
                    {formatCurrency(snapshot.quota.assignedAmount, currency)}
                  </strong>
                  <small>{snapshot.period?.label || "Período actual"}</small>
                </article>
                <article>
                  <span>Real ganado</span>
                  <strong>
                    {snapshot.quota.currencyConversionAvailable
                      ? formatCurrency(snapshot.quota.actualAmount, currency)
                      : "No disponible"}
                  </strong>
                  <small>
                    {!snapshot.quota.currencyConversionAvailable
                      ? "Avance no disponible: falta tipo de cambio"
                      : snapshot.quota.assignedAmount
                        ? `${Math.round((snapshot.quota.actualAmount / snapshot.quota.assignedAmount) * 100)}% de avance`
                        : "Sin cuota"}
                  </small>
                </article>
                <article className="is-alert">
                  <span>Brecha</span>
                  <strong>
                    {snapshot.quota.currencyConversionAvailable
                      ? formatCurrency(snapshot.quota.gapAmount, currency)
                      : "No disponible"}
                  </strong>
                  <small>
                    {snapshot.quota.currencyConversionAvailable
                      ? "Lo que aún falta"
                      : "No se obtuvo tipo de cambio desde USD"}
                  </small>
                </article>
                <article>
                  <span>Pipeline abierto</span>
                  <strong>
                    {snapshot.quota.currencyConversionAvailable
                      ? formatCurrency(snapshot.pipeline.openAmount, currency)
                      : "No disponible"}
                  </strong>
                  <small>
                    {snapshot.pipeline.openCount} oportunidades ·{" "}
                    {!snapshot.quota.currencyConversionAvailable
                      ? "Cobertura no disponible"
                      : coverage
                        ? `${coverage.toFixed(1)}x cobertura`
                        : "Sin cobertura"}
                  </small>
                </article>
              </div>
            </section>
          ) : null}

          {activeWorkspace === "coach" ? (
            <>
              <section className="mi-agent-coach-panel">
                <div className="mi-agent-section-heading">
                  <div>
                    <span className="mi-agent-section-label">
                      Coach comercial
                    </span>
                    <h3>Pregúntale a tu Coach</h3>
                  </div>
                  <span>Asesoría general para tu desempeño comercial</span>
                </div>
                <div className="mi-agent-coach-context-heading">
                  <div>
                    <strong>Ámbito de la conversación</strong>
                    <small>
                      Empieza con tu cartera y prioridades generales. Menciona
                      una cuenta, oportunidad, contacto o lead para enfocar la
                      conversación.
                    </small>
                  </div>
                </div>
                <div
                  className="mi-agent-coach-context-summary"
                  aria-label="Alcance actual del Coach"
                  role="group"
                >
                  <strong>
                    {coachContext.accountId ||
                    coachContext.opportunityId ||
                    coachContext.contactId ||
                    coachContext.leadId
                      ? "Enfoque activo"
                      : "Ámbito general del vendedor"}
                  </strong>
                  {coachContext.accountId ? (
                    <span>
                      {coachAccounts.find(
                        (item) =>
                          String(item.id) === String(coachContext.accountId),
                      )?.name || "Cuenta en contexto"}
                    </span>
                  ) : null}
                  {coachContext.opportunityId ? (
                    <span>
                      {coachOpportunities.find(
                        (item) =>
                          String(item.id) ===
                          String(coachContext.opportunityId),
                      )?.name || "Oportunidad en contexto"}
                    </span>
                  ) : null}
                  {coachContext.contactId ? (
                    <span>
                      {coachContacts.find(
                        (item) =>
                          String(item.id) === String(coachContext.contactId),
                      )?.full_name || "Contacto en contexto"}
                    </span>
                  ) : null}
                  {coachContext.leadId ? <span>Lead en contexto</span> : null}
                  {coachContext.accountId ||
                  coachContext.opportunityId ||
                  coachContext.contactId ||
                  coachContext.leadId ? (
                    <button
                      type="button"
                      className="mi-agent-secondary-button"
                      onClick={requestCoachGeneralScope}
                      disabled={loadingCoachContext || askingCoach}
                    >
                      Volver al ámbito general
                    </button>
                  ) : (
                    <span>
                      Menciona una entidad en tu pregunta para centrar el
                      análisis.
                    </span>
                  )}
                </div>
                {coachMetrics ? (
                  <div
                    className="mi-agent-coach-metrics"
                    aria-label="Actividad del Coach durante los últimos 30 días"
                  >
                    <div>
                      <strong>Actividad del Coach</strong>
                      <small>Últimos 30 días</small>
                    </div>
                    <dl>
                      <div>
                        <dt>Consultas</dt>
                        <dd>{coachMetrics.requests}</dd>
                      </div>
                      <div>
                        <dt>Propuestas</dt>
                        <dd>{coachMetrics.proposed || 0}</dd>
                      </div>
                      <div>
                        <dt>Decididas</dt>
                        <dd>{coachMetrics.decided || 0}</dd>
                      </div>
                      <div>
                        <dt>Aprobadas</dt>
                        <dd>{coachMetrics.approved || 0}</dd>
                      </div>
                      <div>
                        <dt>Rechazadas</dt>
                        <dd>{coachMetrics.rejected || 0}</dd>
                      </div>
                      <div>
                        <dt>Completadas</dt>
                        <dd>{coachMetrics.completed || 0}</dd>
                      </div>
                    </dl>
                  </div>
                ) : null}
                <div className="mi-agent-coach-quick-questions">
                  <strong>Preguntas rápidas</strong>
                  <div className="mi-agent-coach-suggestions">
                    {coachContext.opportunityId ? (
                      <>
                        <button
                          type="button"
                          disabled={askingCoach}
                          onClick={() =>
                            askCoach("¿Qué falta para avanzar de etapa?")
                          }
                        >
                          ¿Qué falta para avanzar?
                        </button>
                        <button
                          type="button"
                          disabled={askingCoach}
                          onClick={() =>
                            askCoach("Registra una actividad de seguimiento")
                          }
                        >
                          Registrar actividad
                        </button>
                      </>
                    ) : coachContext.accountId ? (
                      <>
                        <button
                          type="button"
                          disabled={askingCoach}
                          onClick={() =>
                            askCoach(
                              "¿Qué oportunidad debería priorizar en esta cuenta y cuál sería el siguiente paso?",
                            )
                          }
                        >
                          ¿Qué priorizar en esta cuenta?
                        </button>
                        <button
                          type="button"
                          disabled={askingCoach}
                          onClick={() =>
                            askCoach(
                              "¿Qué puedo mejorar en mi seguimiento de esta cuenta?",
                            )
                          }
                        >
                          ¿Cómo mejorar mi seguimiento?
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={askingCoach}
                          onClick={() =>
                            askCoach(
                              "¿Cómo puedo mejorar mi desempeño este mes?",
                            )
                          }
                        >
                          ¿Cómo mejorar mi desempeño?
                        </button>
                        <button
                          type="button"
                          disabled={askingCoach}
                          onClick={() =>
                            askCoach(
                              "¿Qué oportunidades debo priorizar por riesgo y qué seguimiento debo hacer?",
                            )
                          }
                        >
                          ¿Qué atender primero?
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="mi-agent-coach-conversation-heading">
                  <div>
                    <strong>Conversación</strong>
                    <small>
                      {coachMessages.length
                        ? `${coachMessages.length} mensajes en esta sesión`
                        : "Inicia una conversación con tu contexto actual"}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost mi-agent-coach-clear-button"
                    disabled={askingCoach || !hasCoachConversation}
                    onClick={clearCoachConversation}
                    title="Limpiar conversación"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    Limpiar conversación
                  </button>
                  {hasCoachFoundation ? (
                    <label className="mi-agent-coach-foundation-toggle">
                      <span>Mostrar fundamento</span>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={showCoachFoundation}
                        onChange={(event) =>
                          updateCoachFoundationVisibility(event.target.checked)
                        }
                      />
                      <span
                        className="mi-agent-coach-foundation-toggle-track"
                        aria-hidden="true"
                      />
                    </label>
                  ) : null}
                </div>
                <form
                  className="mi-agent-coach-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    askCoach();
                  }}
                >
                  <input
                    value={coachQuestion}
                    onChange={(event) => setCoachQuestion(event.target.value)}
                    placeholder="Escribe tu pregunta para el Coach..."
                    disabled={askingCoach}
                  />
                  <button
                    type="submit"
                    className="mi-agent-primary-button"
                    disabled={askingCoach || !coachQuestion.trim()}
                  >
                    {askingCoach ? "Consultando..." : "Preguntar"}
                  </button>
                </form>
                {coachUndoOperationId ? (
                  <button
                    type="button"
                    className="btn-secondary mi-agent-coach-undo-button"
                    onClick={undoCoachOperation}
                  >
                    Deshacer último cambio
                  </button>
                ) : null}
                {coachMessages
                  .filter((message) => message.result?.clarification)
                  .slice(-1)
                  .map((message) => {
                    const clarification = message.result.clarification;
                    return (
                      <div
                        className="mi-agent-coach-action"
                        key={`${message.id}-clarification`}
                      >
                        <strong>{clarification.message}</strong>
                        <small>Falta: {clarification.missing.join(", ")}</small>
                        {clarification.candidates.length ? (
                          clarification.candidates.map((candidate) => (
                            <button
                              type="button"
                              className="btn-secondary"
                              key={`${candidate.entityType}-${candidate.id}`}
                              onClick={() =>
                                applyCoachClarification(
                                  candidate,
                                  clarification,
                                )
                              }
                            >
                              Usar {candidate.name}
                              {candidate.accountName
                                ? ` · ${candidate.accountName}`
                                : ""}
                              {candidate.stageName
                                ? ` · ${candidate.stageName}`
                                : ""}
                              {candidate.email ? ` · ${candidate.email}` : ""}
                            </button>
                          ))
                        ) : (
                          <small>
                            No hay registros accesibles para seleccionar.
                          </small>
                        )}
                      </div>
                    );
                  })}
                {coachPendingOperations.length ? (
                  <section
                    className="mi-agent-coach-pending"
                    aria-label="Acciones pendientes del Coach"
                  >
                    <div>
                      <strong>Acciones pendientes</strong>
                      <small>
                        Retoma las acciones que iniciaste o descarta las que ya
                        no necesitas.
                      </small>
                    </div>
                    <div className="mi-agent-coach-pending-list">
                      {coachPendingOperations.map((persistedOperation) => {
                        const statusMeta =
                          COACH_OPERATION_STATUS_META[
                            persistedOperation.status
                          ] || COACH_OPERATION_STATUS_META.proposed;
                        const missingFields =
                          persistedOperation.missingFields || [];
                        const actionPending =
                          coachOperationAction.id === persistedOperation.id &&
                          coachOperationAction.state === "loading";
                        const actionError =
                          coachOperationAction.id === persistedOperation.id &&
                          coachOperationAction.state === "error"
                            ? coachOperationAction.message
                            : null;
                        const handoffExpiresAt =
                          persistedOperation.handoffExpiresAt
                            ? new Date(persistedOperation.handoffExpiresAt)
                            : null;
                        const handoffExpired =
                          handoffExpiresAt &&
                          handoffExpiresAt.getTime() <= Date.now();
                        const targetModuleLabel = formatCoachTargetModule(
                          persistedOperation.targetModule ||
                            persistedOperation.pendingOperation?.targetModule,
                        );
                        return (
                          <article
                            key={persistedOperation.id}
                            className={`is-${statusMeta.tone}`}
                          >
                            <div>
                              <span className="mi-agent-coach-operation-status">
                                {persistedOperation.status === "completed" ? (
                                  <CheckCircle2 size={13} aria-hidden="true" />
                                ) : persistedOperation.status === "failed" ? (
                                  <AlertCircle size={13} aria-hidden="true" />
                                ) : (
                                  <Clock3 size={13} aria-hidden="true" />
                                )}
                                {statusMeta.label}
                              </span>
                              <strong>
                                {formatCoachOperationLabel(persistedOperation)}
                              </strong>
                              {persistedOperation.status === "failed" ? (
                                <small>
                                  {persistedOperation.errorDetail ||
                                    "La acción requiere revisión."}
                                </small>
                              ) : targetModuleLabel ? (
                                <small>
                                  {targetModuleLabel}
                                  {persistedOperation.handedOffAt
                                    ? ` · enviada ${formatCoachDateTime(persistedOperation.handedOffAt)}`
                                    : ""}
                                </small>
                              ) : null}
                              {persistedOperation.status === "handed_off" ? (
                                <small
                                  className={handoffExpired ? "form-error" : ""}
                                >
                                  {handoffExpired
                                    ? "El acceso al módulo venció; corrige para generar uno nuevo."
                                    : `Handoff vigente${handoffExpiresAt ? ` hasta ${formatCoachDateTime(handoffExpiresAt)}` : ""}.`}
                                </small>
                              ) : null}
                              {missingFields.length ? (
                                <div className="mi-agent-coach-missing-fields">
                                  <span>
                                    Falta completar antes de continuar:
                                  </span>
                                  <ul>
                                    {missingFields.map((field) => (
                                      <li key={field}>
                                        {formatCoachFieldLabel(field)}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}
                              {actionError ? (
                                <small className="form-error" role="alert">
                                  {actionError}
                                </small>
                              ) : null}
                            </div>
                            <div className="mi-agent-coach-pending-actions">
                              {persistedOperation.status === "collecting" ||
                              (persistedOperation.status === "handed_off" &&
                                !handoffExpired) ? (
                                <button
                                  type="button"
                                  className="btn-primary"
                                  disabled={actionPending}
                                  onClick={() =>
                                    continueCoachOperation(persistedOperation)
                                  }
                                >
                                  <ArrowRight size={14} aria-hidden="true" />
                                  {actionPending
                                    ? "Abriendo..."
                                    : persistedOperation.status === "collecting"
                                      ? "Completar datos"
                                      : `Abrir en ${targetModuleLabel || "el módulo"}`}
                                </button>
                              ) : null}
                              {["ready", "failed"].includes(
                                persistedOperation.status,
                              ) || handoffExpired ? (
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  disabled={actionPending}
                                  onClick={() =>
                                    openCoachOperationConfirmation({
                                      ...persistedOperation.pendingOperation,
                                      persistentId: persistedOperation.id,
                                    })
                                  }
                                >
                                  <Pencil size={14} aria-hidden="true" />
                                  Revisar
                                </button>
                              ) : null}
                              {[
                                "proposed",
                                "collecting",
                                "ready",
                                "handed_off",
                                "failed",
                              ].includes(persistedOperation.status) ? (
                                <button
                                  type="button"
                                  className="btn-ghost"
                                  disabled={actionPending}
                                  onClick={() =>
                                    cancelPendingCoachOperation(
                                      persistedOperation,
                                    )
                                  }
                                >
                                  <X size={14} aria-hidden="true" />
                                  Descartar
                                </button>
                              ) : null}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ) : null}
                {coachRecentOperations.length ? (
                  <details className="mi-agent-coach-recent">
                    <summary>
                      Actividad reciente
                      <span>{coachRecentOperations.length}</span>
                    </summary>
                    <div>
                      {coachRecentOperations.map((operation) => {
                        const statusMeta =
                          COACH_OPERATION_STATUS_META[operation.status] ||
                          COACH_OPERATION_STATUS_META.completed;
                        return (
                          <article key={operation.id}>
                            <span className={`is-${statusMeta.tone}`}>
                              {operation.status === "completed" ? (
                                <CheckCircle2 size={13} aria-hidden="true" />
                              ) : (
                                <Clock3 size={13} aria-hidden="true" />
                              )}
                              {statusMeta.label}
                            </span>
                            <strong>
                              {formatCoachOperationLabel(operation)}
                            </strong>
                            <small>
                              {formatCoachDateTime(
                                operation.completedAt ||
                                  operation.revertedAt ||
                                  operation.rejectedAt ||
                                  operation.cancelledAt ||
                                  operation.updatedAt,
                              ) || "Actualizada recientemente"}
                            </small>
                          </article>
                        );
                      })}
                    </div>
                  </details>
                ) : null}
                {coachMessages.length ? (
                  <div
                    ref={coachThreadRef}
                    className="mi-agent-coach-thread"
                    aria-live="polite"
                  >
                    {coachMessages.map((message) =>
                      message.role === "seller" ? (
                        <div
                          key={message.id}
                          className="mi-agent-coach-message is-seller"
                        >
                          <span>Vendedor</span>
                          <p>{message.text}</p>
                        </div>
                      ) : (
                        <div
                          key={message.id}
                          className="mi-agent-coach-message is-coach"
                        >
                          <span>Coach</span>
                          {message.pending ? (
                            <p>Analizando tu contexto comercial...</p>
                          ) : message.error ? (
                            <p>{message.error}</p>
                          ) : (
                            <>
                              <div className="mi-agent-coach-result-meta">
                                <span>
                                  {COACH_RESPONSE_TYPE_LABELS[
                                    message.result?.responseType
                                  ] || "Respuesta del Coach"}
                                </span>
                                <span>
                                  {COACH_CONFIDENCE_LABELS[
                                    message.result?.confidence
                                  ] || "Confianza media"}
                                </span>
                              </div>
                              <p className="mi-agent-coach-answer-text">
                                {message.result?.answer || "Lectura comercial"}
                              </p>
                              {message.result?.detailHandoff ? (
                                <div className="mi-agent-coach-handoff">
                                  <small>
                                    Coach mantiene el foco en tu desempeño; el
                                    detalle se revisa en el espacio
                                    especializado.
                                  </small>
                                  {message.result.detailHandoff.destination ===
                                  "customer_account" ? (
                                    <button
                                      type="button"
                                      className="mi-agent-secondary-button"
                                      onClick={() =>
                                        openCoachDetailHandoff(
                                          message.result.detailHandoff,
                                        )
                                      }
                                      disabled={
                                        askingCoach ||
                                        !canReadCustomerIntelligence
                                      }
                                    >
                                      Abrir Cliente existente
                                    </button>
                                  ) : message.result.detailHandoff
                                      .destination === "lead_management" ? (
                                    <button
                                      type="button"
                                      className="mi-agent-secondary-button"
                                      onClick={() =>
                                        openCoachDetailHandoff(
                                          message.result.detailHandoff,
                                        )
                                      }
                                      disabled={askingCoach || !canReadLeads}
                                    >
                                      Abrir gestión de leads
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                              <CoachQualityFeedback
                                traceId={message.result?.qualityTraceId}
                              />
                              <CoachStageReadiness
                                readiness={message.result?.stageReadiness}
                              />
                              {showCoachFoundation ? (
                                <CoachSemanticSections
                                  result={message.result}
                                />
                              ) : null}
                              {message.result?.operations
                                ?.filter(
                                  (operation) =>
                                    !operation.persistentId ||
                                    coachPendingOperations.some(
                                      (pending) =>
                                        pending.id === operation.persistentId,
                                    ),
                                )
                                .map((operation, index) => (
                                  <div
                                    className="mi-agent-coach-action"
                                    key={`${operation.kind}-${operation.opportunityId || operation.accountId || operation.contactId || operation.interactionId}-${index}`}
                                  >
                                    <strong>
                                      {operation.title || "Cambio propuesto"}
                                    </strong>
                                    <small>
                                      {formatCoachOperationSummary(operation)}
                                    </small>
                                    {(
                                      operation.kind === "activity"
                                        ? canUpdateCommercialDevelopment
                                        : operation.kind === "lead_call_outcome"
                                          ? canUpdateLeads
                                          : operation.kind === "account_field"
                                            ? canUpdateAccounts
                                            : operation.kind === "contact_field"
                                              ? canUpdateContacts
                                              : operation.kind ===
                                                  "create_account"
                                                ? canCreateAccounts
                                                : operation.kind ===
                                                    "create_contact"
                                                  ? canCreateContacts
                                                  : operation.kind ===
                                                      "lead_resolve"
                                                    ? canResolveLeads
                                                    : canCreateActions
                                    ) ? (
                                      <button
                                        type="button"
                                        className="btn-secondary"
                                        onClick={() =>
                                          openCoachOperationConfirmation(
                                            operation,
                                          )
                                        }
                                      >
                                        Revisar y confirmar
                                      </button>
                                    ) : (
                                      <small>
                                        Requiere permiso de actualización.
                                      </small>
                                    )}
                                  </div>
                                ))}
                              {message.result?.action?.title ? (
                                <div className="mi-agent-coach-action">
                                  <strong>
                                    Acción sugerida:{" "}
                                    {message.result.action.title}
                                  </strong>
                                  <small>
                                    Criterio de éxito:{" "}
                                    {message.result.action.successCriteria ||
                                      "Definir un siguiente compromiso."}
                                  </small>
                                </div>
                              ) : null}
                            </>
                          )}
                        </div>
                      ),
                    )}
                  </div>
                ) : null}
              </section>
            </>
          ) : null}

          {activeWorkspace === "summary" ? (
            !analysis ? (
              <div className="mi-agent-start-panel">
                <div className="mi-agent-start-icon">✦</div>
                <div>
                  <h3>Tu plan comercial está listo para analizarse</h3>
                  <p>
                    Mi agente revisará tu cuota, las oportunidades desde
                    Desarrollo y las señales de riesgo del proceso comercial.
                  </p>
                  <button
                    type="button"
                    className="mi-agent-primary-button"
                    onClick={analyzeSituation}
                    disabled={analyzing}
                  >
                    {analyzing ? "Analizando..." : "Analizar mi situación"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mi-agent-content-stack">
                <div className="mi-agent-main-column">
                  <section className="mi-agent-focus-panel">
                    <div className="mi-agent-section-heading">
                      <div>
                        <span className="mi-agent-section-label">
                          Lectura del agente
                        </span>
                        <h3>{analysis.headline || "Tu situación comercial"}</h3>
                      </div>
                      <span className="mi-agent-analysis-date">
                        Actualizado ahora
                      </span>
                      <button
                        type="button"
                        className="mi-agent-secondary-button"
                        onClick={analyzeSituation}
                        disabled={analyzing}
                      >
                        {analyzing ? "Actualizando..." : "Actualizar análisis"}
                      </button>
                    </div>
                    <p>{analysis.summary || analysis.quotaReadout}</p>
                  </section>

                  {analysis.activityProgress ? (
                    <section className="mi-agent-activity-progress-panel">
                      <div className="mi-agent-section-heading">
                        <div>
                          <span className="mi-agent-section-label">
                            Efectividad comercial
                          </span>
                          <h3>Actividad vs. avance</h3>
                        </div>
                        <span>Lectura del período</span>
                      </div>
                      <p className="mi-agent-activity-progress-message">
                        {analysis.activityProgress.message}
                      </p>
                      <div className="mi-agent-activity-progress-metrics">
                        <article>
                          <span>Actividades recientes</span>
                          <strong>
                            {analysis.activityProgress.activityCount}
                          </strong>
                          <small>Últimos 7 días</small>
                        </article>
                        <article>
                          <span>Oportunidades con respuesta de etapa</span>
                          <strong>
                            {analysis.activityProgress.progressedOpportunities}
                          </strong>
                          <small>Registrada en los últimos 7 días</small>
                        </article>
                        <article
                          className={
                            analysis.activityProgress
                              .opportunitiesWithoutProgress
                              ? "is-alert"
                              : ""
                          }
                        >
                          <span>Actividad sin evidencia de etapa</span>
                          <strong>
                            {
                              analysis.activityProgress
                                .opportunitiesWithoutProgress
                            }
                          </strong>
                          <small>
                            Oportunidades que requieren una interacción más
                            dirigida
                          </small>
                        </article>
                      </div>
                      {analysis.activityProgress.details?.filter(
                        (item) => item.activityWithoutProgress,
                      ).length ? (
                        <div className="mi-agent-activity-progress-list">
                          <strong>
                            Oportunidades con actividad pero sin respuesta de
                            etapa reciente
                          </strong>
                          <ul>
                            {analysis.activityProgress.details
                              .filter((item) => item.activityWithoutProgress)
                              .map((item) => (
                                <li key={item.opportunityId}>
                                  <span>
                                    {item.opportunityName} ·{" "}
                                    {item.accountName || "Sin cuenta"}
                                  </span>
                                  <small>
                                    {item.activityCount} actividades · sin
                                    respuesta de etapa posterior a la actividad
                                  </small>
                                  <button
                                    type="button"
                                    className="mi-agent-link-button"
                                    onClick={() =>
                                      navigate(
                                        `/opportunities?edit=${item.opportunityId}`,
                                      )
                                    }
                                  >
                                    Abrir oportunidad
                                  </button>
                                </li>
                              ))}
                          </ul>
                        </div>
                      ) : null}
                    </section>
                  ) : null}

                  {analysis.alerts?.length ? (
                    <section className="mi-agent-alerts-panel">
                      <div className="mi-agent-section-heading">
                        <div>
                          <span className="mi-agent-section-label">
                            Diagnóstico automático
                          </span>
                          <h3>Problemas de venta detectados</h3>
                        </div>
                        <span>{analysis.alerts.length} alertas</span>
                      </div>
                      <div className="mi-agent-alert-list">
                        {analysis.alerts.map((alert) => (
                          <article
                            key={`${alert.code}-${alert.opportunityId || alert.accountName || alert.title}`}
                            className={`mi-agent-alert-card is-${alert.severity}`}
                          >
                            <div className="mi-agent-alert-card-heading">
                              <strong>{alert.title}</strong>
                              <span>
                                {alert.severity === "critical"
                                  ? "Crítica"
                                  : alert.severity === "high"
                                    ? "Alta"
                                    : "Media"}
                              </span>
                            </div>
                            <p>
                              {alert.opportunityName
                                ? `Oportunidad: ${alert.opportunityName} · ${alert.accountName || "Sin cuenta"}`
                                : "Pipeline del vendedor"}
                            </p>
                            <p>
                              <strong>Evidencia:</strong> {alert.evidence}
                            </p>
                            <p>
                              <strong>Acción:</strong> {alert.action}
                            </p>
                            {alert.opportunityId ? (
                              <button
                                type="button"
                                className="mi-agent-link-button"
                                onClick={() =>
                                  navigate(
                                    `/opportunities?edit=${alert.opportunityId}`,
                                  )
                                }
                              >
                                Abrir oportunidad
                              </button>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  <section className="mi-agent-actions-panel">
                    <div className="mi-agent-section-heading">
                      <div>
                        <span className="mi-agent-section-label">
                          Orden recomendado
                        </span>
                        <h3>Qué hacer ahora</h3>
                      </div>
                      <span>{analysis.actions.length} acciones</span>
                    </div>
                    <div className="mi-agent-action-list">
                      {analysis.actions.length ? (
                        analysis.actions.map((action) => (
                          <div
                            key={`${action.rank}-${action.opportunityId || action.title}`}
                            className="mi-agent-action-item"
                          >
                            <button
                              type="button"
                              className={`mi-agent-action-row ${selectedAction?.rank === action.rank ? "is-selected" : ""}`}
                              onClick={() => setSelectedAction(action)}
                            >
                              <span className="mi-agent-action-rank">
                                {action.rank}
                              </span>
                              <span className="mi-agent-action-copy">
                                <strong>
                                  {action.title || "Acción comercial"}
                                </strong>
                                <small>
                                  Oportunidad #{action.opportunityId || "-"} ·{" "}
                                  {action.opportunityName || "Sin nombre"}
                                </small>
                                <small>
                                  {action.accountName || "Sin cuenta"} ·{" "}
                                  {action.stageName || "Sin etapa"}
                                </small>
                              </span>
                              <span
                                className={`mi-agent-health-badge is-${String(action.salesHealth?.label || "parcial").toLowerCase()}`}
                              >
                                {action.salesHealth
                                  ? `Salud ${action.salesHealth.label}`
                                  : "Salud"}
                              </span>
                              <span
                                className={`mi-agent-priority is-${action.priority}`}
                              >
                                {PRIORITY_LABELS[action.priority]}
                              </span>
                              <span
                                className={`mi-agent-row-state ${action.status === "done" ? "is-done" : ""}`}
                              >
                                {ACTION_STATUS_LABELS[action.status] ||
                                  "Pendiente"}
                              </span>
                            </button>
                            {action.opportunityId ? (
                              <button
                                type="button"
                                className="mi-agent-link-button"
                                onClick={() =>
                                  navigate(
                                    `/opportunities?edit=${action.opportunityId}`,
                                  )
                                }
                              >
                                Abrir oportunidad
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="mi-agent-link-button"
                                onClick={() => setActiveWorkspace("coach")}
                              >
                                Consultar con Coach
                              </button>
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="mi-agent-empty">
                          No se encontraron acciones concretas en este análisis.
                        </div>
                      )}
                    </div>
                  </section>
                </div>

                <section
                  className="mi-agent-detail-panel"
                  style={{ alignSelf: "stretch", position: "static" }}
                >
                  {selectedAction ? (
                    <>
                      <div className="mi-agent-detail-heading">
                        <div>
                          <span className="mi-agent-section-label">
                            Detalle de la acción
                          </span>
                          <h3>{selectedAction.title}</h3>
                          <p>
                            Oportunidad #{selectedAction.opportunityId || "-"} ·{" "}
                            {selectedAction.opportunityName || "Sin nombre"} ·{" "}
                            {selectedAction.accountName || "Sin cuenta"}
                          </p>
                        </div>
                        <span
                          className={`mi-agent-priority is-${selectedAction.priority}`}
                        >
                          {PRIORITY_LABELS[selectedAction.priority]}
                        </span>
                      </div>
                      <div className="mi-agent-detail-facts">
                        <article>
                          <span>Por qué importa</span>
                          <p>
                            {selectedAction.reason ||
                              "Prioridad definida por el análisis del pipeline."}
                          </p>
                        </article>
                        <article>
                          <span>Riesgo</span>
                          <p>
                            {selectedAction.risk ||
                              "Sin riesgo adicional identificado."}
                          </p>
                        </article>
                        <article>
                          <span>Resultado esperado</span>
                          <p>
                            {selectedAction.expectedOutcome ||
                              "Obtener un siguiente paso verificable."}
                          </p>
                        </article>
                        <article>
                          <span>Criterio de éxito</span>
                          <p>
                            {selectedAction.successCriteria ||
                              "Registrar el resultado y el siguiente compromiso."}
                          </p>
                        </article>
                      </div>
                      {selectedAction.salesHealth ? (
                        <div className="mi-agent-health-panel">
                          <div className="mi-agent-health-heading">
                            <div>
                              <span className="mi-agent-section-label">
                                Salud de la oportunidad
                              </span>
                              <strong>
                                {selectedAction.salesHealth.label} ·{" "}
                                {selectedAction.salesHealth.solidCount}/
                                {selectedAction.salesHealth.totalCount}{" "}
                                dimensiones sólidas
                              </strong>
                            </div>
                            <span>
                              Principal debilidad:{" "}
                              {selectedAction.salesHealth.principalWeakness}
                            </span>
                          </div>
                          <div className="mi-agent-health-grid">
                            {selectedAction.salesHealth.dimensions.map(
                              (dimension) => (
                                <div
                                  key={dimension.key}
                                  className={`mi-agent-health-dimension is-${dimension.state}`}
                                >
                                  <span>{dimension.label}</span>
                                  <strong>{dimension.stateLabel}</strong>
                                  <small>{dimension.evidence}</small>
                                </div>
                              ),
                            )}
                          </div>
                        </div>
                      ) : null}
                      <div className="mi-agent-execution-kit">
                        <div className="mi-agent-execution-kit-heading">
                          <div>
                            <span className="mi-agent-section-label">
                              Preparación para ejecutar
                            </span>
                            <h4>{selectedAction.actionType || "follow_up"}</h4>
                          </div>
                          <span>Listo para usar</span>
                        </div>
                        <div className="mi-agent-kit-grid">
                          <article>
                            <span>Objetivo</span>
                            <p>
                              {selectedAction.executionKit?.objective ||
                                selectedAction.expectedOutcome ||
                                "Conseguir un compromiso verificable del cliente."}
                            </p>
                          </article>
                          <article>
                            <span>Resultado mínimo</span>
                            <p>
                              {selectedAction.executionKit?.minimumOutcome ||
                                selectedAction.successCriteria ||
                                "Definir fecha, responsable y siguiente hito."}
                            </p>
                          </article>
                          <article>
                            <span>Propuesta de valor</span>
                            <p>
                              {selectedAction.executionKit?.valueProposition ||
                                "Conectar la solución con la necesidad y el riesgo concreto del cliente."}
                            </p>
                          </article>
                          <article>
                            <span>Mensaje de seguimiento</span>
                            <p>
                              {selectedAction.executionKit?.followUpMessage ||
                                "Enviar un resumen de acuerdos con fecha y siguiente paso."}
                            </p>
                          </article>
                        </div>
                        {selectedAction.executionKit?.knownInformation
                          ?.length ? (
                          <div className="mi-agent-kit-list">
                            <strong>Información conocida</strong>
                            <ul>
                              {selectedAction.executionKit.knownInformation.map(
                                (item) => (
                                  <li key={item}>{item}</li>
                                ),
                              )}
                            </ul>
                          </div>
                        ) : null}
                        {selectedAction.executionKit?.objections?.length ? (
                          <div className="mi-agent-kit-list">
                            <strong>Objeciones probables</strong>
                            <ul>
                              {selectedAction.executionKit.objections.map(
                                (item) => (
                                  <li key={item}>{item}</li>
                                ),
                              )}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                      {selectedAction.questions?.length ? (
                        <div className="mi-agent-questions">
                          <strong>Preguntas sugeridas</strong>
                          <ul>
                            {selectedAction.questions.map((question) => (
                              <li key={question}>{question}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {selectedAction.developmentNarrative ? (
                        <div className="mi-agent-development-context">
                          <span className="mi-agent-section-label">
                            Desarrollo de la oportunidad
                          </span>
                          <span
                            className={`mi-agent-alignment-status is-${selectedAction.alignedContext?.alignment || "partially_aligned"}`}
                            style={{
                              display: "inline-block",
                              marginBottom: "8px",
                              fontSize: "12px",
                              fontWeight: 800,
                            }}
                          >
                            Alineación:{" "}
                            {selectedAction.alignedContext?.alignment ===
                            "aligned"
                              ? "Alineada"
                              : selectedAction.alignedContext?.alignment ===
                                  "not_aligned"
                                ? "Requiere revisión"
                                : "Parcial"}
                          </span>
                          <div className="mi-agent-development-block">
                            <strong>Descripción y situación actual</strong>
                            <p>
                              {selectedAction.alignedContext?.situation ||
                                selectedAction.developmentNarrative.contract
                                  ?.descriptionSituationText ||
                                selectedAction.developmentNarrative
                                  .statusSummary ||
                                "Sin información disponible."}
                            </p>
                          </div>
                          <div className="mi-agent-development-block">
                            <strong>Estrategia para lograr la venta</strong>
                            <p>
                              {selectedAction.alignedContext?.strategy ||
                                selectedAction.developmentNarrative.contract
                                  ?.salesStrategyText ||
                                "Sin información disponible."}
                            </p>
                          </div>
                          <div className="mi-agent-development-block">
                            <strong>Siguiente mejor paso</strong>
                            <p>
                              {selectedAction.alignedContext?.nextBestStep ||
                                selectedAction.developmentNarrative.contract
                                  ?.nextBestStepText ||
                                selectedAction.developmentNarrative
                                  .nextStepRecommendation ||
                                "Sin información disponible."}
                            </p>
                          </div>
                          <div className="mi-agent-development-block">
                            <strong>Paso alternativo</strong>
                            <p>
                              {selectedAction.alignedContext?.alternativeStep ||
                                selectedAction.developmentNarrative.contract
                                  ?.alternativeStepText ||
                                "Sin información disponible."}
                            </p>
                          </div>
                        </div>
                      ) : null}
                      {selectedAction.title &&
                      canExecuteCoach &&
                      canUpdateCommercialDevelopment ? (
                        <button
                          type="button"
                          className="mi-agent-primary-button is-wide"
                          onClick={() =>
                            openCoachActionConfirmation(selectedAction)
                          }
                          disabled={
                            creatingActionRank === selectedAction.rank ||
                            selectedAction.status === "done"
                          }
                        >
                          {selectedAction.status === "done"
                            ? "Próximo paso creado"
                            : "Crear próximo paso"}
                        </button>
                      ) : null}
                      {selectedAction.opportunityId &&
                      (!canExecuteCoach || !canUpdateCommercialDevelopment) ? (
                        <p className="mi-agent-permission-note">
                          Tienes acceso de lectura. Solicita permiso de
                          ejecución y Desarrollo Comercial para preparar el
                          próximo paso.
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <div className="mi-agent-empty">
                      Selecciona una acción para ver su contexto.
                    </div>
                  )}
                </section>
              </div>
            )
          ) : null}
        </>
      ) : activeWorkspace === "customer" ? (
        <section className="mi-agent-workspace-panel mi-agent-customer-workspace">
          <div className="mi-agent-section-heading">
            <div>
              <span className="mi-agent-section-label">Cliente existente</span>
              <h3>Conocimiento del cliente</h3>
            </div>
            <span>
              {customerIntelligenceJob?.status === "completed"
                ? "Investigación lista"
                : "Inteligencia interna"}
            </span>
          </div>
          <div className="mi-agent-customer-context-card">
            <label>
              Buscar cliente
              <input
                value={customerAccountSearch}
                onChange={(event) => searchCustomerAccounts(event.target.value)}
                placeholder="Nombre de cuenta"
              />
            </label>
            <label>
              Cuenta existente
              <select
                value={customerAccountId}
                onChange={(event) => selectCustomerAccount(event.target.value)}
              >
                <option value="">Selecciona una cuenta</option>
                {customerAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {customerAccountId ? (
            <section
              className="mi-agent-customer-overview"
              aria-label="Resumen de cuenta"
            >
              <div className="mi-agent-section-heading">
                <div>
                  <span className="mi-agent-section-label">Fuente CRM</span>
                  <h3>
                    {customerSnapshot?.account?.name ||
                      selectedCustomerAccount?.name ||
                      "Cuenta seleccionada"}
                  </h3>
                </div>
                <span>
                  {customerSnapshot?.account?.city ||
                  customerSnapshot?.account?.stateRegion
                    ? [
                        customerSnapshot.account.city,
                        customerSnapshot.account.stateRegion,
                      ]
                        .filter(Boolean)
                        .join(", ")
                    : "Ubicación sin registrar"}
                </span>
              </div>
              <div className="mi-agent-customer-overview-grid">
                <article>
                  <span>Última actividad registrada</span>
                  <strong>
                    {customerSnapshot?.interactions?.[0]?.updatedAt
                      ? formatDate(customerSnapshot.interactions[0].updatedAt)
                      : "Sin actividad accesible"}
                  </strong>
                  <small>
                    {customerSnapshot?.interactions?.[0]?.title ||
                      "Fuente: interacciones CRM"}
                  </small>
                </article>
                <article>
                  <span>Sitio web</span>
                  <strong>
                    {customerSnapshot?.account?.website || "Sin registrar"}
                  </strong>
                  <small>
                    {customerSnapshot?.account?.registrationCode ||
                      "Sin código de registro"}
                  </small>
                </article>
                <article>
                  <span>Relación comercial</span>
                  <strong>
                    {customerSnapshot?.accountHealth?.metrics
                      ?.opportunityCount || 0}{" "}
                    oportunidades · {customerSnapshot?.contacts?.length || 0}{" "}
                    contactos
                  </strong>
                  <small>Datos CRM autorizados</small>
                </article>
              </div>
              {customerSnapshot?.account?.description ? (
                <p className="mi-agent-customer-summary">
                  {customerSnapshot.account.description}
                </p>
              ) : null}
            </section>
          ) : (
            <div className="mi-agent-empty">
              Selecciona una cuenta para revisar salud, riesgos e historial
              comercial.
            </div>
          )}
          {customerIntelligenceError ? (
            <p className="form-error">{customerIntelligenceError}</p>
          ) : null}
          <section
            className="mi-agent-coach-panel mi-agent-customer-chat"
            aria-label="Chat de cuenta"
          >
            <div className="mi-agent-section-heading">
              <div>
                <span className="mi-agent-section-label">Chat de cuenta</span>
                <h3>Pregúntale sobre esta cuenta</h3>
              </div>
              <div>
                <button
                  type="button"
                  className="mi-agent-secondary-button"
                  onClick={startNewCustomerChat}
                  disabled={
                    customerChatLoading ||
                    customerChatSessionLoading ||
                    !hasCustomerContext
                  }
                >
                  Nueva conversación
                </button>
                <label className="mi-agent-coach-foundation-toggle">
                  <span>Mostrar fundamento</span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={showCustomerChatFoundation}
                    disabled={!hasCustomerChatFoundation}
                    onChange={(event) =>
                      updateCustomerChatFoundationVisibility(
                        event.target.checked,
                      )
                    }
                  />
                  <span
                    className="mi-agent-coach-foundation-toggle-track"
                    aria-hidden="true"
                  />
                </label>
              </div>
            </div>
            <div className="mi-agent-coach-suggestions">
              <button
                type="button"
                onClick={() =>
                  askCustomerChat("Resume esta cuenta para mi reunión.")
                }
                disabled={
                  customerChatLoading ||
                  customerChatSessionLoading ||
                  !hasCustomerContext
                }
              >
                Resumen para reunión
              </button>
              <button
                type="button"
                onClick={() => askCustomerChat("¿Qué riesgos debo atender?")}
                disabled={
                  customerChatLoading ||
                  customerChatSessionLoading ||
                  !hasCustomerContext
                }
              >
                Riesgos
              </button>
              <button
                type="button"
                onClick={() =>
                  askCustomerChat("¿Qué oportunidades de expansión existen?")
                }
                disabled={customerChatLoading || !hasCustomerContext}
              >
                Expansión
              </button>
            </div>
            <label className="field-hint">
              <input
                type="checkbox"
                checked={customerChatPublicResearch}
                onChange={(event) =>
                  setCustomerChatPublicResearch(event.target.checked)
                }
                disabled={customerChatLoading || !hasCustomerContext}
              />{" "}
              Incluir fuentes públicas (requiere gobierno y permiso)
            </label>
            <form
              className="mi-agent-coach-form"
              onSubmit={(event) => {
                event.preventDefault();
                askCustomerChat();
              }}
            >
              <input
                value={customerChatQuestion}
                onChange={(event) =>
                  setCustomerChatQuestion(event.target.value)
                }
                placeholder="Pregunta sobre la cuenta..."
                disabled={customerChatLoading || !hasCustomerContext}
              />
              <button
                type="submit"
                className="mi-agent-primary-button"
                disabled={
                  customerChatLoading ||
                  customerChatSessionLoading ||
                  !customerChatQuestion.trim() ||
                  !hasCustomerContext
                }
              >
                {customerChatLoading ? "Consultando..." : "Preguntar"}
              </button>
            </form>
            {customerChatMessages.length ? (
              <div className="mi-agent-coach-thread" aria-live="polite">
                {customerChatMessages.map((message, index) =>
                  message.role === "seller" ? (
                    <div
                      key={`seller-${index}`}
                      className="mi-agent-coach-message is-seller"
                    >
                      <span>Vendedor</span>
                      <p>{message.text}</p>
                    </div>
                  ) : (
                    <div
                      key={`assistant-${index}`}
                      className="mi-agent-coach-message is-coach"
                    >
                      <span>Cuenta</span>
                      <small className="mi-agent-customer-source-label">
                        {message.sourceDomain === "mixed"
                          ? "CRM + investigación pública"
                          : message.sourceDomain === "public_web"
                            ? "Investigación pública"
                            : "Fuente CRM"}
                        {message.confidence
                          ? ` · confianza ${CUSTOMER_FINDING_CONFIDENCE_LABELS[message.confidence] || message.confidence}`
                          : ""}
                      </small>
                      {String(message.answer || "").includes("\n") ? (
                        <p className="mi-agent-coach-answer-text is-multiline">
                          {message.answer}
                        </p>
                      ) : (
                        <h4
                          className={
                            message.activityHistory
                              ? "mi-agent-customer-history-summary"
                              : undefined
                          }
                        >
                          {message.answer}
                        </h4>
                      )}
                      {message.activityHistory ? (
                        message.activityHistory.mode === "contact_history" ? (
                          <div className="mi-agent-customer-history-results">
                            {!message.activityHistory.contactsAvailable ? (
                              <p className="mi-agent-customer-history-empty">
                                No tienes permiso para consultar contactos en
                                esta cuenta.
                              </p>
                            ) : (
                              message.activityHistory.contacts.map(
                                (contact) => (
                                  <section
                                    key={contact.id}
                                    className="mi-agent-customer-history-section"
                                  >
                                    <div className="mi-agent-customer-history-section-heading">
                                      <strong>{contact.name}</strong>
                                      <span>
                                        {contact.interactionHistoryAvailable
                                          ? `${contact.interactions.length} interacciones`
                                          : "Historial sin acceso"}
                                      </span>
                                    </div>
                                    <div className="mi-agent-customer-contact-history-data">
                                      {contact.positionTitle ||
                                      contact.department ? (
                                        <span>
                                          {[
                                            contact.positionTitle,
                                            contact.department,
                                          ]
                                            .filter(Boolean)
                                            .join(" · ")}
                                        </span>
                                      ) : null}
                                      {contact.email ? (
                                        <a href={`mailto:${contact.email}`}>
                                          {contact.email}
                                        </a>
                                      ) : null}
                                      {contact.phone || contact.mobile ? (
                                        <span>
                                          {[contact.phone, contact.mobile]
                                            .filter(Boolean)
                                            .join(" · ")}
                                        </span>
                                      ) : null}
                                      {contact.activationStatusCode &&
                                      contact.activationStatusCode !==
                                        "activado" ? (
                                        <span>
                                          {contact.activationStatusCode}
                                        </span>
                                      ) : null}
                                    </div>
                                    {contact.purchaseParticipation ||
                                    contact.hierarchyLevel ||
                                    contact.relationshipType ||
                                    contact.influenceLevel ? (
                                      <details className="mi-agent-customer-contact-history-extra">
                                        <summary>
                                          Más datos del contacto
                                        </summary>
                                        <p>
                                          {[
                                            contact.purchaseParticipation,
                                            contact.hierarchyLevel,
                                            contact.relationshipType,
                                            contact.influenceLevel,
                                          ]
                                            .filter(Boolean)
                                            .join(" · ")}
                                        </p>
                                      </details>
                                    ) : null}
                                    {!contact.interactionHistoryAvailable ? (
                                      <p className="mi-agent-customer-history-empty">
                                        No tienes permiso de lectura para
                                        consultar su historial.
                                      </p>
                                    ) : contact.interactions.length ? (
                                      <ul className="mi-agent-customer-history-list">
                                        {contact.interactions.map((item) => (
                                          <li key={`${contact.id}-${item.id}`}>
                                            <time dateTime={item.date}>
                                              {formatDate(item.date)}
                                            </time>
                                            <div className="mi-agent-customer-history-item-content">
                                              <strong title={item.title}>
                                                {item.title}
                                              </strong>
                                              {item.details ? (
                                                <details>
                                                  <summary>
                                                    Ver detalles
                                                  </summary>
                                                  <p>{item.details}</p>
                                                </details>
                                              ) : null}
                                            </div>
                                          </li>
                                        ))}
                                      </ul>
                                    ) : (
                                      <p className="mi-agent-customer-history-empty">
                                        Sin interacciones vinculadas.
                                      </p>
                                    )}
                                  </section>
                                ),
                              )
                            )}
                          </div>
                        ) : (
                          <div className="mi-agent-customer-history-results">
                            {message.activityHistory.mode === "quotation" ? (
                              <div className="mi-agent-customer-history-period">
                                {message.activityHistory.metadata
                                  .opportunityName ? (
                                  <span>
                                    {
                                      message.activityHistory.metadata
                                        .opportunityName
                                    }
                                  </span>
                                ) : null}
                                {message.activityHistory.metadata
                                  .quotationDate ? (
                                  <span>
                                    {formatDate(
                                      message.activityHistory.metadata
                                        .quotationDate,
                                    )}
                                  </span>
                                ) : null}
                                {message.activityHistory.metadata.statusName ? (
                                  <span>
                                    {
                                      message.activityHistory.metadata
                                        .statusName
                                    }
                                  </span>
                                ) : null}
                              </div>
                            ) : (
                              <div className="mi-agent-customer-history-period">
                                <span>
                                  {formatDate(
                                    message.activityHistory.range.startDate,
                                  )}
                                  {" - "}
                                  {formatDate(
                                    message.activityHistory.range.endDate,
                                  )}
                                </span>
                                <span>
                                  {message.activityHistory.range.months} meses
                                </span>
                              </div>
                            )}
                            {message.activityHistory.sections.map((section) => (
                              <section
                                key={section.key}
                                className="mi-agent-customer-history-section"
                              >
                                <div className="mi-agent-customer-history-section-heading">
                                  <strong>{section.title}</strong>
                                  <span>
                                    {section.available
                                      ? section.items.length
                                      : "Sin acceso"}
                                  </span>
                                </div>
                                {section.subtitle ? (
                                  <p className="mi-agent-customer-history-empty">
                                    {section.subtitle}
                                  </p>
                                ) : null}
                                {!section.available ? (
                                  <p className="mi-agent-customer-history-empty">
                                    {section.unavailableMessage}
                                  </p>
                                ) : section.items.length ? (
                                  <ul className="mi-agent-customer-history-list">
                                    {section.items.map((item) => (
                                      <li key={`${section.key}-${item.id}`}>
                                        {item.date ? (
                                          <time dateTime={item.date}>
                                            {formatDate(item.date)}
                                          </time>
                                        ) : item.activityType ? (
                                          <span className="mi-agent-customer-history-item-type">
                                            {CUSTOMER_ACTIVITY_TYPE_LABELS[
                                              item.activityType
                                            ] || item.activityType}
                                          </span>
                                        ) : null}
                                        <div className="mi-agent-customer-history-item-content">
                                          <strong title={item.title}>
                                            {item.title}
                                          </strong>
                                          <div className="mi-agent-customer-history-item-meta">
                                            {item.opportunityName ? (
                                              <span>
                                                {item.opportunityName}
                                              </span>
                                            ) : null}
                                            {item.activityType ? (
                                              <span>
                                                {CUSTOMER_ACTIVITY_TYPE_LABELS[
                                                  item.activityType
                                                ] || item.activityType}
                                              </span>
                                            ) : null}
                                            {item.status ? (
                                              <span className="mi-agent-customer-history-status">
                                                {CUSTOMER_ACTIVITY_STATUS_LABELS[
                                                  item.status
                                                ] || item.status}
                                              </span>
                                            ) : null}
                                          </div>
                                          {item.details ? (
                                            <details>
                                              <summary>Ver detalles</summary>
                                              <p>{item.details}</p>
                                            </details>
                                          ) : null}
                                        </div>
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="mi-agent-customer-history-empty">
                                    No hay registros en este periodo.
                                  </p>
                                )}
                              </section>
                            ))}
                          </div>
                        )
                      ) : null}
                      <CoachQualityFeedback traceId={message.qualityTraceId} />
                      {showCustomerChatFoundation &&
                      message.evidence?.length ? (
                        <div className="mi-agent-customer-chat-evidence">
                          <strong>Evidencia</strong>
                          <ul>
                            {message.evidence.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {showCustomerChatFoundation &&
                      message.inferences?.length ? (
                        <div className="mi-agent-customer-chat-inferences">
                          <strong>Hipótesis por validar</strong>
                          <ul>
                            {message.inferences.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {showCustomerChatFoundation &&
                      message.publicSources?.length ? (
                        <div className="mi-agent-customer-public-sources">
                          <strong>Fuentes públicas</strong>
                          <ul>
                            {message.publicSources.map(
                              (source, sourceIndex) => {
                                const sourceUrl =
                                  typeof source === "string"
                                    ? source
                                    : source.url || source.sourceUrl;
                                return (
                                  <li
                                    key={`${sourceUrl || "source"}-${sourceIndex}`}
                                  >
                                    {/^https?:\/\//i.test(
                                      String(sourceUrl || ""),
                                    ) ? (
                                      <a
                                        href={sourceUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        {typeof source === "object"
                                          ? source.title ||
                                            source.domain ||
                                            sourceUrl
                                          : sourceUrl}
                                      </a>
                                    ) : (
                                      String(
                                        source?.title ||
                                          source ||
                                          "Fuente pública",
                                      )
                                    )}
                                  </li>
                                );
                              },
                            )}
                          </ul>
                        </div>
                      ) : null}
                      {showCustomerChatFoundation && message.agents?.length ? (
                        <small>
                          Agentes:{" "}
                          {message.agents
                            .map((agent) => agent.agentId)
                            .join(", ")}
                        </small>
                      ) : null}
                      {message.recommendedActions?.length ? (
                        <div className="mi-agent-customer-chat-actions">
                          <strong>Próximos pasos sugeridos</strong>
                          {message.recommendedActions.map(
                            (action, actionIndex) => (
                              <article key={`${action.title}-${actionIndex}`}>
                                <span>
                                  {action.title} · requiere confirmación
                                </span>
                                {action.opportunityId &&
                                canExecuteCoach &&
                                canUpdateCommercialDevelopment ? (
                                  <button
                                    type="button"
                                    className="mi-agent-link-button"
                                    onClick={() =>
                                      openDiscoveryActivity({
                                        opportunityId: action.opportunityId,
                                        title: action.title,
                                        actionType: action.actionType || "call",
                                        notes: action.notes,
                                        successCriteria: action.successCriteria,
                                      })
                                    }
                                  >
                                    Preparar actividad
                                  </button>
                                ) : action.opportunityId ? (
                                  <button
                                    type="button"
                                    className="mi-agent-link-button"
                                    onClick={() =>
                                      navigate(
                                        `/opportunities?edit=${action.opportunityId}`,
                                      )
                                    }
                                  >
                                    Abrir oportunidad
                                  </button>
                                ) : null}
                              </article>
                            ),
                          )}
                        </div>
                      ) : null}
                      {message.operations?.some(
                        (operation) => operation.kind !== "activity",
                      ) ? (
                        <div className="mi-agent-customer-chat-actions">
                          <strong>Operaciones propuestas</strong>
                          {message.operations
                            .filter(
                              (operation) => operation.kind !== "activity",
                            )
                            .map((operation, operationIndex) => (
                              <article
                                key={`${operation.kind}-${operation.title}-${operationIndex}`}
                              >
                                <span>
                                  {operation.title || operation.kind} · requiere
                                  revisión y confirmación
                                </span>
                                {canReviewCustomerOperation(operation) ? (
                                  <button
                                    type="button"
                                    className="mi-agent-link-button"
                                    disabled={savingCoachOperation}
                                    onClick={() =>
                                      openCustomerChatOperation(operation)
                                    }
                                  >
                                    Revisar operación
                                  </button>
                                ) : (
                                  <small>
                                    No tienes permisos para proponer este tipo
                                    de cambio.
                                  </small>
                                )}
                              </article>
                            ))}
                        </div>
                      ) : null}
                    </div>
                  ),
                )}
              </div>
            ) : null}
          </section>
          {customerSnapshotLoading ? (
            <p className="field-hint">Calculando salud de la cuenta...</p>
          ) : null}
          {customerSnapshot?.accountHealth ? (
            <section
              className="mi-agent-discovery-panel"
              aria-label="Salud de la cuenta"
            >
              <div className="mi-agent-section-heading">
                <div>
                  <span className="mi-agent-section-label">
                    Salud de cuenta
                  </span>
                  <h3>
                    {customerSnapshot.accountHealth.status === "at_risk"
                      ? "Requiere atención"
                      : customerSnapshot.accountHealth.status === "attention"
                        ? "Atención recomendada"
                        : customerSnapshot.accountHealth.status === "healthy"
                          ? "Salud estable"
                          : "Información insuficiente"}
                  </h3>
                </div>
                <strong>{customerSnapshot.accountHealth.score}/100</strong>
              </div>
              <div className="mi-agent-intelligence-summary">
                <article>
                  <span>Contactos</span>
                  <strong>
                    {customerSnapshot.accountHealth.metrics.contactCount}
                  </strong>
                </article>
                <article>
                  <span>Oportunidades</span>
                  <strong>
                    {customerSnapshot.accountHealth.metrics.opportunityCount}
                  </strong>
                </article>
                <article>
                  <span>En riesgo</span>
                  <strong>
                    {
                      customerSnapshot.accountHealth.metrics
                        .riskyOpportunityCount
                    }
                  </strong>
                </article>
                <article>
                  <span>Última actividad</span>
                  <strong>
                    {customerSnapshot.accountHealth.metrics
                      .daysSinceLastInteraction === null
                      ? "Sin datos"
                      : `${customerSnapshot.accountHealth.metrics.daysSinceLastInteraction} días`}
                  </strong>
                </article>
              </div>
              {customerSnapshot.accountHealth.signals.length ? (
                <div className="mi-agent-finding-list">
                  {customerSnapshot.accountHealth.signals.map((signal) => (
                    <article
                      key={`${signal.code}-${signal.entityId || "account"}`}
                      className={`mi-agent-finding-card is-${signal.severity === "high" ? "rejected" : "suggested"}`}
                    >
                      <div className="mi-agent-finding-heading">
                        <div>
                          <span>
                            {signal.severity === "high" ? "Riesgo" : "Señal"}
                          </span>
                          <strong>{signal.title}</strong>
                        </div>
                        <em>{signal.severity}</em>
                      </div>
                      <small className="mi-agent-customer-source-label">
                        Fuente CRM · señal determinística
                      </small>
                      <p>{signal.summary}</p>
                      <blockquote>{signal.evidence}</blockquote>
                      <div className="mi-agent-customer-signal-actions">
                        {signal.entityType === "opportunity" &&
                        signal.entityId ? (
                          <button
                            type="button"
                            className="mi-agent-link-button"
                            onClick={() =>
                              navigate(`/opportunities?edit=${signal.entityId}`)
                            }
                          >
                            Abrir oportunidad
                          </button>
                        ) : null}
                        {!signal.entityId &&
                        customerSnapshot.opportunities?.some(
                          (opportunity) =>
                            !["ganada", "perdida", "anulada"].includes(
                              opportunity.commercialStatusCode,
                            ),
                        ) &&
                        canUpdateCommercialDevelopment ? (
                          <button
                            type="button"
                            className="mi-agent-link-button"
                            onClick={() => {
                              const opportunity =
                                customerSnapshot.opportunities.find(
                                  (item) =>
                                    !["ganada", "perdida", "anulada"].includes(
                                      item.commercialStatusCode,
                                    ),
                                );
                              openDiscoveryActivity({
                                opportunityId: opportunity.id,
                                title: signal.title,
                                actionType: "call",
                                priority:
                                  signal.severity === "high"
                                    ? "high"
                                    : "medium",
                                notes: signal.evidence,
                                successCriteria:
                                  "Validar la señal de salud con el cliente y registrar el siguiente compromiso.",
                              });
                            }}
                          >
                            Preparar seguimiento
                          </button>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="mi-agent-empty">
                  No se detectaron señales determinísticas de atención.
                </div>
              )}
            </section>
          ) : null}
          {customerSnapshot?.accountHealth?.signals?.length ? (
            <section
              className="mi-agent-customer-next-step"
              aria-label="Próximo paso sugerido"
            >
              <div>
                <span className="mi-agent-section-label">
                  Sugerencia basada en señales CRM
                </span>
                <h3>Próximo paso sugerido</h3>
                <strong>
                  {customerSnapshot.accountHealth.signals[0].title}
                </strong>
                <p>{customerSnapshot.accountHealth.signals[0].summary}</p>
                <small>
                  Evidencia:{" "}
                  {customerSnapshot.accountHealth.signals[0].evidence}
                </small>
              </div>
              {customerSnapshot.accountHealth.signals[0].entityType ===
                "opportunity" &&
              customerSnapshot.accountHealth.signals[0].entityId ? (
                <button
                  type="button"
                  className="mi-agent-secondary-button"
                  onClick={() =>
                    navigate(
                      `/opportunities?edit=${customerSnapshot.accountHealth.signals[0].entityId}`,
                    )
                  }
                >
                  Abrir oportunidad
                </button>
              ) : canExecuteCoach && canUpdateCommercialDevelopment ? (
                customerSnapshot.opportunities?.some((opportunity) =>
                  ["open", undefined].includes(opportunity.lifecycle),
                ) ? (
                  <button
                    type="button"
                    className="mi-agent-primary-button"
                    onClick={() => {
                      const opportunity = customerSnapshot.opportunities.find(
                        (item) => ["open", undefined].includes(item.lifecycle),
                      );
                      openDiscoveryActivity({
                        opportunityId: opportunity.id,
                        title: customerSnapshot.accountHealth.signals[0].title,
                        actionType: "call",
                        priority:
                          customerSnapshot.accountHealth.signals[0].severity ===
                          "high"
                            ? "high"
                            : "medium",
                        notes:
                          customerSnapshot.accountHealth.signals[0].evidence,
                        successCriteria:
                          "Validar la señal con el cliente y registrar un siguiente compromiso.",
                      });
                    }}
                  >
                    Preparar seguimiento
                  </button>
                ) : (
                  <button
                    type="button"
                    className="mi-agent-secondary-button"
                    onClick={() =>
                      askCustomerChat(
                        `¿Cuál es el siguiente paso para atender: ${customerSnapshot.accountHealth.signals[0].title}?`,
                      )
                    }
                    disabled={customerChatLoading}
                  >
                    Consultar siguiente paso
                  </button>
                )
              ) : (
                <button
                  type="button"
                  className="mi-agent-secondary-button"
                  onClick={() =>
                    askCustomerChat(
                      `¿Cuál es el siguiente paso para atender: ${customerSnapshot.accountHealth.signals[0].title}?`,
                    )
                  }
                  disabled={customerChatLoading}
                >
                  Consultar siguiente paso
                </button>
              )}
            </section>
          ) : null}
          {customerSnapshot ? (
            <section
              className="mi-agent-customer-history"
              aria-label="Historial comercial de la cuenta"
            >
              <div className="mi-agent-section-heading">
                <div>
                  <span className="mi-agent-section-label">Fuente CRM</span>
                  <h3>Historial comercial</h3>
                </div>
                <span>
                  {(customerSnapshot.opportunities?.length || 0) +
                    (customerSnapshot.inactiveOpportunities?.length || 0)}{" "}
                  oportunidades
                </span>
              </div>
              <div className="mi-agent-customer-history-grid">
                {[
                  ["open", "Abiertas"],
                  ["ganada", "Ganadas"],
                  ["perdida", "Perdidas"],
                  ["anulada", "Anuladas"],
                ].map(([statusCode, label]) => {
                  const opportunities = (
                    customerSnapshot.opportunities || []
                  ).filter((opportunity) =>
                    statusCode === "open"
                      ? !["ganada", "perdida", "anulada"].includes(
                          opportunity.commercialStatusCode,
                        )
                      : opportunity.commercialStatusCode === statusCode,
                  );
                  return (
                    <div key={statusCode}>
                      <strong>
                        {label} <span>{opportunities.length}</span>
                      </strong>
                      {opportunities.length ? (
                        <ul>
                          {opportunities.map((opportunity) => (
                            <li key={opportunity.id}>
                              <button
                                type="button"
                                className="mi-agent-customer-record-link"
                                onClick={() =>
                                  navigate(
                                    `/opportunities?edit=${opportunity.id}`,
                                  )
                                }
                              >
                                {opportunity.name}
                              </button>
                              <small>
                                {opportunity.stageName || "Sin etapa"} ·{" "}
                                {formatCurrency(opportunity.amountUsd, "USD")}
                                {opportunity.closeDate
                                  ? ` · cierre ${formatDate(opportunity.closeDate)}`
                                  : ""}
                              </small>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <small>Sin registros accesibles</small>
                      )}
                    </div>
                  );
                })}
                <div>
                  <strong>
                    Desactivadas{" "}
                    <span>
                      {customerSnapshot.inactiveOpportunities?.length || 0}
                    </span>
                  </strong>
                  {customerSnapshot.inactiveOpportunities?.length ? (
                    <ul>
                      {customerSnapshot.inactiveOpportunities.map(
                        (opportunity) => (
                          <li key={opportunity.id}>
                            <button
                              type="button"
                              className="mi-agent-customer-record-link"
                              onClick={() =>
                                navigate(
                                  `/opportunities?edit=${opportunity.id}`,
                                )
                              }
                            >
                              {opportunity.name}
                            </button>
                            <small>
                              {opportunity.activationStatusCode ||
                                "No activada"}{" "}
                              ·{" "}
                              {opportunity.commercialStatusCode || "en proceso"}{" "}
                              · {opportunity.stageName || "Sin etapa"} ·{" "}
                              {formatCurrency(opportunity.amountUsd, "USD")}
                            </small>
                          </li>
                        ),
                      )}
                    </ul>
                  ) : (
                    <small>Sin registros accesibles</small>
                  )}
                </div>
              </div>
            </section>
          ) : null}
          {customerSnapshot?.permissions?.canReadContacts ? (
            <section
              className="mi-agent-customer-contacts"
              aria-label="Mapa de relaciones de la cuenta"
            >
              <div className="mi-agent-section-heading">
                <div>
                  <span className="mi-agent-section-label">Fuente CRM</span>
                  <h3>Contactos y mapa de relación</h3>
                </div>
                <span>{customerSnapshot.contacts?.length || 0} contactos</span>
              </div>
              {customerSnapshot.contacts?.length ? (
                <div className="mi-agent-customer-contact-grid">
                  {customerSnapshot.contacts.map((contact) => {
                    const missing = [
                      !contact.positionTitle && "cargo",
                      !contact.purchaseParticipation &&
                        "participación de compra",
                      !contact.hierarchyLevel && "nivel jerárquico",
                      !contact.influenceLevel && "nivel de influencia",
                      !contact.managerContactId &&
                        !contact.influencesContactId &&
                        "relación con otros contactos",
                    ].filter(Boolean);
                    return (
                      <article key={contact.id}>
                        <strong>{contact.name || "Contacto sin nombre"}</strong>
                        <span>
                          {contact.positionTitle || "Cargo sin registrar"}
                          {contact.department ? ` · ${contact.department}` : ""}
                        </span>
                        <small>
                          Participación:{" "}
                          {contact.purchaseParticipation || "Sin dato"}
                        </small>
                        <small>
                          Jerarquía: {contact.hierarchyLevel || "Sin dato"} ·{" "}
                          Influencia: {contact.influenceLevel || "Sin dato"}
                        </small>
                        <small>
                          Relación: {contact.relationshipType || "Sin dato"}
                          {contact.managerName
                            ? ` · Reporta a ${contact.managerName}`
                            : ""}
                          {contact.influencesName
                            ? ` · Influye en ${contact.influencesName}`
                            : ""}
                        </small>
                        {missing.length ? (
                          <small className="mi-agent-customer-map-gap">
                            Falta: {missing.join(", ")}
                          </small>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="mi-agent-empty">
                  No hay contactos activos accesibles para esta cuenta.
                </div>
              )}
            </section>
          ) : null}
          {customerSnapshot &&
          (customerSnapshot.products?.length ||
            customerSnapshot.renewals?.length) ? (
            <section
              className="mi-agent-discovery-panel"
              aria-label="Productos y renovaciones"
            >
              <div className="mi-agent-section-heading">
                <div>
                  <span className="mi-agent-section-label">Fuente CRM</span>
                  <h3>Cotizaciones, productos y renovaciones</h3>
                </div>
                <span>{customerSnapshot.products?.length || 0} productos</span>
              </div>
              {customerSnapshot.products?.length ? (
                <div className="mi-agent-discovery-columns">
                  <div>
                    <strong>Partidas de cotizaciones</strong>
                    <p className="mi-agent-customer-evidence-note">
                      Una cotización aceptada o ganada no confirma por sí sola
                      compra, facturación ni entrega.
                    </p>
                    <ul>
                      {customerSnapshot.products.slice(0, 10).map((product) => (
                        <li
                          key={`${product.quotationVersionId}-${product.productCode}-${product.description}`}
                        >
                          <strong>{product.description}</strong>
                          <br />
                          <span>
                            {product.itemType || "producto"} ·{" "}
                            {product.quantity} unidad(es)
                            {product.isRenewal ? " · renovación cotizada" : ""}
                          </span>
                          <br />
                          <small>
                            Cotización{" "}
                            {CUSTOMER_QUOTATION_STATUS_LABELS[
                              product.commercialStatus
                            ] || product.commercialStatus}{" "}
                            · Compra/entrega: no verificada
                            {product.providerName
                              ? ` · ${product.providerName}`
                              : ""}
                          </small>
                          {product.opportunityId ? (
                            <button
                              type="button"
                              className="mi-agent-customer-record-link"
                              onClick={() =>
                                navigate(
                                  `/opportunities?edit=${product.opportunityId}`,
                                )
                              }
                            >
                              Abrir oportunidad asociada
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}
              {customerSnapshot.renewals?.length ? (
                <div className="mi-agent-discovery-columns">
                  <div>
                    <strong>Renovaciones</strong>
                    <ul>
                      {customerSnapshot.renewals.slice(0, 10).map((renewal) => (
                        <li key={renewal.id}>
                          <span>
                            {renewal.providerName} · {renewal.statusCode} ·
                            vence {renewal.expiresAt || "sin fecha"}
                          </span>
                          <button
                            type="button"
                            className="mi-agent-customer-record-link"
                            onClick={() =>
                              navigate(
                                `/opportunities?edit=${renewal.opportunityId}`,
                              )
                            }
                          >
                            Abrir oportunidad asociada
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}
              {customerSnapshot.expansionHypotheses?.length ? (
                <div className="mi-agent-discovery-next-steps">
                  <strong>Hipótesis de expansión</strong>
                  {customerSnapshot.expansionHypotheses.map((hypothesis) => (
                    <article key={`${hypothesis.type}-${hypothesis.title}`}>
                      <div>
                        <span>Hipótesis · {hypothesis.type}</span>
                        <strong>{hypothesis.title}</strong>
                        <p>
                          {hypothesis.summary} {hypothesis.evidence}
                        </p>
                        <small>
                          Confianza:{" "}
                          {CUSTOMER_FINDING_CONFIDENCE_LABELS[
                            hypothesis.confidence
                          ] ||
                            hypothesis.confidence ||
                            "Baja"}{" "}
                          · requiere validación del vendedor
                        </small>
                      </div>
                      {hypothesis.opportunityId &&
                      canExecuteCoach &&
                      canUpdateCommercialDevelopment &&
                      customerSnapshot.opportunities.some(
                        (opportunity) =>
                          Number(opportunity.id) ===
                            Number(hypothesis.opportunityId) &&
                          opportunity.lifecycle === "open",
                      ) ? (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() =>
                            openDiscoveryActivity({
                              opportunityId: hypothesis.opportunityId,
                              title: hypothesis.title,
                              actionType: "call",
                              priority: "medium",
                              notes: hypothesis.evidence,
                              successCriteria:
                                "Validar la hipótesis con el cliente antes de crear o ampliar la oportunidad.",
                            })
                          }
                        >
                          Revisar hipótesis
                        </button>
                      ) : hypothesis.opportunityId ? (
                        <button
                          type="button"
                          className="mi-agent-link-button"
                          onClick={() =>
                            navigate(
                              `/opportunities?edit=${hypothesis.opportunityId}`,
                            )
                          }
                        >
                          Abrir oportunidad
                        </button>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
          <div className="mi-agent-workspace-actions mi-agent-customer-actions">
            <button
              type="button"
              className="mi-agent-primary-button"
              onClick={runCustomerInvestigation}
              disabled={customerInvestigating || !hasCustomerContext}
            >
              {customerInvestigating ? "Analizando..." : "Analizar cuenta"}
            </button>
            <button
              type="button"
              className="mi-agent-secondary-button"
              onClick={runCustomerAgents}
              disabled={
                customerAgentsLoading ||
                !hasCustomerContext ||
                !canUseExternalSources
              }
            >
              {customerAgentsLoading
                ? "Enriqueciendo..."
                : "Enriquecer con fuentes públicas"}
            </button>
            <button
              type="button"
              className="mi-agent-secondary-button"
              onClick={prepareCustomerExecutiveBriefing}
              disabled={customerExecutiveBriefingLoading || !hasCustomerContext}
            >
              {customerExecutiveBriefingLoading
                ? "Preparando resumen..."
                : "Preparar resumen ejecutivo"}
            </button>
            <button
              type="button"
              className="mi-agent-secondary-button"
              onClick={prepareCustomerCall}
              disabled={customerDiscoveryPreparing || !hasCustomerContext}
            >
              {customerDiscoveryPreparing
                ? "Preparando..."
                : "Preparar llamada"}
            </button>
          </div>
          {!hasCustomerContext ? (
            <p className="field-hint">
              Selecciona una cuenta existente arriba para iniciar la
              inteligencia comercial; la selección del Chat del Coach es
              independiente.
            </p>
          ) : null}
          {customerIntelligenceJob ? (
            <div className="mi-agent-intelligence-summary">
              <article>
                <span>Estado</span>
                <strong>
                  {customerIntelligenceJob.status === "completed"
                    ? "Completado"
                    : customerIntelligenceJob.status === "failed"
                      ? "Fallido"
                      : "En proceso"}
                </strong>
              </article>
              <article>
                <span>Hallazgos</span>
                <strong>{customerFindings.length}</strong>
              </article>
              <article>
                <span>Huecos</span>
                <strong>
                  {
                    customerFindings.filter(
                      (finding) => finding.category === "missing_information",
                    ).length
                  }
                </strong>
              </article>
              <article>
                <span>Confirmados</span>
                <strong>
                  {
                    customerFindings.filter(
                      (finding) => finding.status === "confirmed",
                    ).length
                  }
                </strong>
              </article>
            </div>
          ) : null}
          {customerIntelligenceJob?.result?.summary ? (
            <p className="mi-agent-customer-summary">
              {customerIntelligenceJob.result.summary}
            </p>
          ) : null}
          {customerAgentsJob?.result?.agents?.length ? (
            <section
              className="mi-agent-discovery-panel"
              aria-label="Agentes especializados"
            >
              <div className="mi-agent-section-heading">
                <div>
                  <span className="mi-agent-section-label">
                    {customerAgentsJob.result.sourceDomain === "public_web"
                      ? "CRM interno + investigación pública"
                      : "Análisis interno CRM"}
                  </span>
                  <h3>Agentes especializados</h3>
                </div>
                <span>Sin escrituras automáticas</span>
              </div>
              <div className="mi-agent-discovery-columns">
                {customerAgentsJob.result.agents.map((agent) => (
                  <div key={agent.agentId}>
                    <strong>{agent.agentId}</strong>
                    <p>{agent.summary}</p>
                    <small>
                      {agent.sourceDomain === "public_web"
                        ? "Fuente pública"
                        : "Fuente CRM"}{" "}
                      · {agent.findings?.length || 0} hallazgos · confianza{" "}
                      {CUSTOMER_FINDING_CONFIDENCE_LABELS[agent.confidence] ||
                        agent.confidence}
                    </small>
                    {agent.findings?.length ? (
                      <ul>
                        {agent.findings.slice(0, 10).map((finding) => {
                          const contact =
                            agent.agentId === "contact_research"
                              ? finding.metadata?.contactData
                              : null;
                          return (
                            <li key={`${agent.agentId}-${finding.title}`}>
                              <strong>
                                {contact?.firstName && contact?.lastName
                                  ? `${contact.firstName} ${contact.lastName}`
                                  : finding.title}
                              </strong>
                              {contact?.positionTitle ? (
                                <>
                                  <br />
                                  <span>
                                    {contact.positionTitle}
                                    {contact.department
                                      ? ` · ${contact.department}`
                                      : ""}
                                  </span>
                                </>
                              ) : null}
                              {isUsablePublicContactValue(contact?.email) ? (
                                <>
                                  <br />
                                  <span>Correo: {contact.email}</span>
                                </>
                              ) : null}
                              {isUsablePublicContactValue(contact?.phone) ? (
                                <>
                                  <br />
                                  <span>Teléfono: {contact.phone}</span>
                                </>
                              ) : null}
                              {isUsablePublicContactValue(contact?.mobile) ? (
                                <>
                                  <br />
                                  <span>Móvil: {contact.mobile}</span>
                                </>
                              ) : null}
                              <br />
                              {finding.summary}
                              <br />
                              <small>
                                {finding.evidenceText ||
                                  finding.evidence ||
                                  "Sin evidencia"}
                              </small>
                              <small>
                                Certeza: {finding.certainty || "evidenciada"} ·
                                Confianza:{" "}
                                {CUSTOMER_FINDING_CONFIDENCE_LABELS[
                                  finding.confidence
                                ] ||
                                  finding.confidence ||
                                  agent.confidence}
                              </small>
                              {/^https?:\/\//i.test(
                                String(finding.sourceUrl || ""),
                              ) ? (
                                <a
                                  href={finding.sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Ver fuente pública
                                </a>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          {customerFindings.length ? (
            <div className="mi-agent-finding-list">
              {customerFindings.map((finding) => (
                <article
                  key={finding.id}
                  className={`mi-agent-finding-card is-${finding.status}`}
                >
                  <div className="mi-agent-finding-heading">
                    <div>
                      <span>
                        {CUSTOMER_FINDING_CATEGORY_LABELS[finding.category] ||
                          finding.category}
                      </span>
                      <strong>{finding.title}</strong>
                    </div>
                    <em>
                      {CUSTOMER_FINDING_STATUS_LABELS[finding.status] ||
                        finding.status}
                    </em>
                  </div>
                  <p>{finding.summary}</p>
                  {finding.evidenceText ? (
                    <blockquote>{finding.evidenceText}</blockquote>
                  ) : null}
                  <div className="mi-agent-finding-meta">
                    <span>
                      Fuente:{" "}
                      {finding.sourceDomain === "public_web"
                        ? "Investigación pública"
                        : finding.certainty === "inferred"
                          ? "Inferencia"
                          : "CRM"}
                    </span>
                    <span>
                      Confianza:{" "}
                      {CUSTOMER_FINDING_CONFIDENCE_LABELS[finding.confidence] ||
                        finding.confidence}
                    </span>
                    <span>Certeza: {finding.certainty}</span>
                    <span>
                      Fuente: {finding.sourceReference || finding.sourceType}
                    </span>
                  </div>
                  <div className="mi-agent-finding-actions">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() =>
                        updateCustomerFindingStatus(finding, "confirmed")
                      }
                      disabled={
                        finding.status === "confirmed" ||
                        customerFindingUpdatingId === finding.id
                      }
                    >
                      Confirmar
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() =>
                        updateCustomerFindingStatus(finding, "rejected")
                      }
                      disabled={
                        finding.status === "rejected" ||
                        customerFindingUpdatingId === finding.id
                      }
                    >
                      Rechazar
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : customerIntelligenceJob?.status === "completed" ? (
            <div className="mi-agent-empty">
              No se generaron hallazgos para este contexto.
            </div>
          ) : null}
          {customerExecutiveBriefingJob?.result?.executiveBriefing ? (
            <section
              className="mi-agent-discovery-panel"
              aria-label="Resumen ejecutivo de cuenta"
            >
              <div className="mi-agent-section-heading">
                <div>
                  <span className="mi-agent-section-label">
                    Síntesis ejecutiva
                  </span>
                  <h3>{customerExecutiveBriefingJob.result.headline}</h3>
                </div>
                <span>
                  Salud{" "}
                  {
                    customerExecutiveBriefingJob.result.executiveBriefing
                      .healthScore
                  }
                  /100
                </span>
              </div>
              <p className="mi-agent-customer-summary">
                {customerExecutiveBriefingJob.result.summary}
              </p>
              <div className="mi-agent-discovery-columns">
                <div>
                  <strong>Cambios recientes</strong>
                  <ul>
                    {(
                      customerExecutiveBriefingJob.result.executiveBriefing
                        .recentChanges || []
                    ).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <strong>Riesgos prioritarios</strong>
                  <ul>
                    {(
                      customerExecutiveBriefingJob.result.executiveBriefing
                        .prioritizedRisks || []
                    ).map((item) => (
                      <li key={`${item.title}-${item.evidence}`}>
                        {item.title}: {item.summary}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <strong>Preguntas para la reunión</strong>
                  <ul>
                    {(
                      customerExecutiveBriefingJob.result.executiveBriefing
                        .meetingQuestions || []
                    ).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="mi-agent-customer-summary">
                <strong>Siguiente mejor paso:</strong>{" "}
                {
                  customerExecutiveBriefingJob.result.executiveBriefing
                    .nextBestStep
                }
              </div>
              {customerExecutiveBriefingJob.result.executiveBriefing
                .recommendedActions?.length ? (
                <div className="mi-agent-discovery-next-steps">
                  <strong>Acciones recomendadas</strong>
                  {customerExecutiveBriefingJob.result.executiveBriefing.recommendedActions.map(
                    (action, index) => (
                      <article
                        key={`${action.title}-${action.opportunityId || index}`}
                      >
                        <div>
                          <span>{action.actionType || "Actividad"}</span>
                          <strong>{action.title}</strong>
                          <p>
                            {action.successCriteria ||
                              action.notes ||
                              "Revisar y confirmar el siguiente paso."}
                          </p>
                        </div>
                        {action.opportunityId &&
                        canUpdateCommercialDevelopment ? (
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() =>
                              openDiscoveryActivity({
                                ...action,
                                opportunityId: Number(action.opportunityId),
                              })
                            }
                          >
                            Revisar y crear tarea
                          </button>
                        ) : null}
                      </article>
                    ),
                  )}
                </div>
              ) : null}
            </section>
          ) : null}
          {customerDiscoveryJob?.result?.briefing ? (
            <section className="mi-agent-discovery-panel">
              <div className="mi-agent-section-heading">
                <div>
                  <span className="mi-agent-section-label">
                    Preparación comercial
                  </span>
                  <h3>
                    {customerDiscoveryJob.result.headline ||
                      "Briefing de llamada"}
                  </h3>
                </div>
                <span>
                  {customerDiscoveryJob.status === "completed"
                    ? "Listo"
                    : "En proceso"}
                </span>
              </div>
              <p className="mi-agent-customer-summary">
                {customerDiscoveryJob.result.summary}
              </p>
              <div className="mi-agent-discovery-grid">
                <article>
                  <span>Objetivo</span>
                  <p>{customerDiscoveryJob.result.briefing.objective}</p>
                </article>
                <article>
                  <span>Contacto objetivo</span>
                  <p>{customerDiscoveryJob.result.briefing.targetContact}</p>
                </article>
              </div>
              <div className="mi-agent-discovery-columns">
                <div>
                  <strong>Preguntas para descubrir</strong>
                  <ul>
                    {(customerDiscoveryJob.result.briefing.questions || []).map(
                      (item) => (
                        <li key={item}>{item}</li>
                      ),
                    )}
                  </ul>
                </div>
                <div>
                  <strong>Riesgos a cuidar</strong>
                  <ul>
                    {(customerDiscoveryJob.result.briefing.risks || []).map(
                      (item) => (
                        <li key={item}>{item}</li>
                      ),
                    )}
                  </ul>
                </div>
                <div>
                  <strong>Guion de llamada</strong>
                  <ul>
                    {(customerDiscoveryJob.result.briefing.callGuide || []).map(
                      (item) => (
                        <li key={item}>{item}</li>
                      ),
                    )}
                  </ul>
                </div>
              </div>
              <div className="mi-agent-discovery-next-steps">
                <strong>Próximos pasos sugeridos</strong>
                {(customerDiscoveryJob.result.briefing.nextSteps || []).map(
                  (step) => (
                    <article key={`${step.title}-${step.actionType}`}>
                      <div>
                        <span>{step.actionType}</span>
                        <strong>{step.title}</strong>
                        <p>{step.successCriteria}</p>
                      </div>
                      {step.opportunityId && canUpdateCommercialDevelopment ? (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => openDiscoveryActivity(step)}
                        >
                          Crear tarea
                        </button>
                      ) : null}
                    </article>
                  ),
                )}
              </div>
              {customerDiscoveryJob.result.briefing.emailDraft ? (
                <div className="mi-agent-discovery-email">
                  <strong>Correo sugerido</strong>
                  <span>
                    {customerDiscoveryJob.result.briefing.emailDraft.subject}
                  </span>
                  <pre>
                    {customerDiscoveryJob.result.briefing.emailDraft.body}
                  </pre>
                </div>
              ) : null}
            </section>
          ) : null}
        </section>
      ) : activeWorkspace === "prospect" ? (
        <section className="mi-agent-workspace-panel">
          <div className="mi-agent-section-heading">
            <div>
              <span className="mi-agent-section-label">Cuenta nueva</span>
              <h3>Prospección asistida</h3>
            </div>
            <span>
              {prospectSession?.status === "completed"
                ? "Ficha lista"
                : "Cuenta nueva"}
            </span>
          </div>
          {prospectError ? <p className="form-error">{prospectError}</p> : null}
          <div className="mi-agent-prospect-preview">
            <label>
              Empresa
              <input
                value={prospectForm.companyName}
                onChange={(event) =>
                  updateProspectForm("companyName", event.target.value)
                }
                placeholder="Nombre de la empresa"
                disabled={prospectPreparing || Boolean(prospectSession)}
              />
            </label>
            <label>
              País / mercado
              <input
                value={prospectForm.country}
                onChange={(event) =>
                  updateProspectForm("country", event.target.value)
                }
                placeholder="México, Perú, Colombia..."
                disabled={prospectPreparing || Boolean(prospectSession)}
              />
            </label>
            <label>
              Sitio web opcional
              <input
                value={prospectForm.website}
                onChange={(event) =>
                  updateProspectForm("website", event.target.value)
                }
                placeholder="https://empresa.com"
                disabled={prospectPreparing || Boolean(prospectSession)}
              />
            </label>
            <label>
              Industria opcional
              <input
                value={prospectForm.industry}
                onChange={(event) =>
                  updateProspectForm("industry", event.target.value)
                }
                placeholder="Logística, banca, retail..."
                disabled={prospectPreparing || Boolean(prospectSession)}
              />
            </label>
          </div>
          <div className="mi-agent-workspace-actions">
            <button
              type="button"
              className="mi-agent-primary-button"
              onClick={prepareProspectAccount}
              disabled={!canCreateProspecting || prospectPreparing}
            >
              {prospectPreparing ? "Preparando..." : "Preparar cuenta"}
            </button>
            {canCreateProspecting &&
            canUseExternalSources &&
            prospectSession ? (
              <button
                type="button"
                className="mi-agent-secondary-button"
                onClick={runProspectExternalResearch}
                disabled={prospectExternalResearching}
              >
                {prospectExternalResearching
                  ? "Buscando fuentes..."
                  : "Investigar fuentes públicas"}
              </button>
            ) : null}
            <button
              type="button"
              className="mi-agent-secondary-button"
              onClick={() => {
                setProspectForm({
                  companyName: "",
                  country: "",
                  website: "",
                  industry: "",
                });
                setProspectSession(null);
                setProspectChatMessages([]);
                setProspectChatQuestion("");
                setProspectError("");
              }}
              disabled={prospectPreparing}
            >
              Limpiar
            </button>
          </div>
          {!prospectSession ? (
            <div className="mi-agent-workspace-grid">
              <article>
                <strong>Ficha de prospección</strong>
                <p>
                  Preparará perfil de empresa, posibles retos de negocio, áreas
                  objetivo, proyectos tecnológicos probables e hipótesis de
                  oportunidad.
                </p>
              </article>
              <article>
                <strong>Contactos objetivo</strong>
                <p>
                  Sugerirá roles, áreas y mensajes iniciales para que el
                  vendedor tenga una ruta clara de primer contacto.
                </p>
              </article>
              <article>
                <strong>Sin crear registros</strong>
                <p>
                  La investigación queda como prospección hasta que una fase
                  posterior convierta datos confirmados en cuenta, contacto,
                  lead u oportunidad.
                </p>
              </article>
            </div>
          ) : null}
          {prospectSession?.result ? (
            <section className="mi-agent-prospect-result">
              <div className="mi-agent-section-heading">
                <div>
                  <span className="mi-agent-section-label">
                    Ficha de prospección
                  </span>
                  <h3>{prospectSession.result.headline}</h3>
                </div>
                <span>
                  {prospectSession.status === "completed"
                    ? "Completada"
                    : prospectSession.status}
                </span>
              </div>
              <p className="mi-agent-customer-summary">
                {prospectSession.result.summary}
              </p>
              <section className="mi-agent-coach-panel mi-agent-customer-chat">
                <div className="mi-agent-section-heading">
                  <div>
                    <span className="mi-agent-section-label">
                      Chat de prospecto
                    </span>
                    <h4>Pregúntale sobre esta cuenta nueva</h4>
                  </div>
                  <span>Datos de prospección, no CRM confirmado</span>
                </div>
                {prospectChatMessages.length ? (
                  <div className="mi-agent-coach-thread" aria-live="polite">
                    {prospectChatMessages.map((message, index) => (
                      <div
                        key={`${message.role}-${index}`}
                        className={`mi-agent-coach-message ${message.role === "seller" ? "is-seller" : "is-coach"}`}
                      >
                        <span>
                          {message.role === "seller" ? "Vendedor" : "Prospecto"}
                        </span>
                        <p>{message.text || message.answer}</p>
                        <CoachQualityFeedback
                          traceId={message.qualityTraceId}
                        />
                        {message.evidence?.length ? (
                          <small>{message.evidence.join(" ")}</small>
                        ) : null}
                        {message.recommendedActions?.length ? (
                          <div className="mi-agent-customer-chat-actions">
                            <strong>
                              Acciones sugeridas · requieren confirmación
                            </strong>
                            {message.recommendedActions.map(
                              (action, actionIndex) => (
                                <article key={`${action.title}-${actionIndex}`}>
                                  <span>
                                    {action.title || "Acción de prospección"}
                                  </span>
                                  <small>
                                    Confirma esta acción desde la ficha antes de
                                    convertir datos a CRM.
                                  </small>
                                </article>
                              ),
                            )}
                          </div>
                        ) : null}
                        {message.operations?.some(
                          (operation) => operation.kind !== "activity",
                        ) ? (
                          <div className="mi-agent-customer-chat-actions">
                            <strong>Operaciones propuestas</strong>
                            {message.operations
                              .filter(
                                (operation) => operation.kind !== "activity",
                              )
                              .map((operation, operationIndex) => (
                                <article
                                  key={`${operation.kind}-${operation.title}-${operationIndex}`}
                                >
                                  <span>
                                    {operation.title || operation.kind} ·
                                    requiere revisión y confirmación
                                  </span>
                                  {canReviewCustomerOperation(operation) ? (
                                    <button
                                      type="button"
                                      className="mi-agent-link-button"
                                      disabled={savingCoachOperation}
                                      onClick={() =>
                                        openCustomerChatOperation(operation)
                                      }
                                    >
                                      Revisar operación
                                    </button>
                                  ) : (
                                    <small>
                                      No tienes permisos para proponer este tipo
                                      de cambio.
                                    </small>
                                  )}
                                </article>
                              ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                <form
                  className="mi-agent-coach-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    askProspectChat();
                  }}
                >
                  <input
                    value={prospectChatQuestion}
                    onChange={(event) =>
                      setProspectChatQuestion(event.target.value)
                    }
                    placeholder="Pregunta sobre el prospecto..."
                    disabled={prospectChatLoading}
                  />
                  <button
                    type="submit"
                    className="mi-agent-primary-button"
                    disabled={
                      prospectChatLoading || !prospectChatQuestion.trim()
                    }
                  >
                    {prospectChatLoading ? "Consultando..." : "Preguntar"}
                  </button>
                </form>
              </section>
              {prospectSession.result.externalResearch?.warnings?.length ? (
                <p className="mi-agent-inline-notice">
                  {prospectSession.result.externalResearch.warnings.join(" ")}
                </p>
              ) : null}
              <div className="mi-agent-discovery-grid">
                <article>
                  <span>Empresa</span>
                  <p>{prospectSession.result.profile.companyName}</p>
                </article>
                <article>
                  <span>Posicionamiento</span>
                  <p>{prospectSession.result.profile.positioning}</p>
                </article>
              </div>
              <div className="mi-agent-prospect-section">
                <strong>Revisión de posibles cuentas duplicadas</strong>
                {!prospectSession.duplicateReview?.completed ? (
                  <p>
                    Se requiere permiso de lectura de cuentas para revisar
                    duplicados antes de convertir.
                  </p>
                ) : !prospectSession.duplicateReview.countryResolved ? (
                  <p>
                    No se reconoció el país indicado. Corrígelo y prepara de
                    nuevo la prospección antes de convertir.
                  </p>
                ) : prospectSession.duplicateReview.candidates.length ? (
                  <>
                    <p>
                      Hay coincidencias por nombre o dominio. Revisa en el
                      módulo de cuentas y elige una decisión explícita.
                    </p>
                    <div className="mi-agent-prospect-card-grid">
                      {prospectSession.duplicateReview.candidates.map(
                        (candidate) => (
                          <article key={candidate.id}>
                            <strong>{candidate.name}</strong>
                            <p>
                              {candidate.country || "País no indicado"}
                              {candidate.domain ? ` · ${candidate.domain}` : ""}
                            </p>
                            <small>
                              Coincidencia:{" "}
                              {candidate.matchType === "domain"
                                ? "dominio"
                                : "nombre y país"}
                            </small>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() =>
                                convertProspectAccount(
                                  "link_existing",
                                  candidate.id,
                                )
                              }
                              disabled={
                                !canUpdateProspecting ||
                                !canCreateAccounts ||
                                prospectConverting === "account" ||
                                Boolean(prospectSession.convertedAccountId)
                              }
                            >
                              Vincular esta cuenta
                            </button>
                          </article>
                        ),
                      )}
                    </div>
                    <button
                      type="button"
                      className="mi-agent-secondary-button"
                      onClick={() => convertProspectAccount("create_new")}
                      disabled={
                        !canUpdateProspecting ||
                        !canCreateAccounts ||
                        prospectConverting === "account" ||
                        Boolean(prospectSession.convertedAccountId)
                      }
                    >
                      Crear una cuenta nueva de todos modos
                    </button>
                  </>
                ) : (
                  <p>
                    No se encontraron posibles duplicados para este nombre, país
                    y dominio.
                  </p>
                )}
              </div>
              <div className="mi-agent-prospect-conversion-actions">
                <button
                  type="button"
                  className="mi-agent-primary-button"
                  onClick={() => convertProspectAccount("create_new")}
                  disabled={
                    !canUpdateProspecting ||
                    !canCreateAccounts ||
                    prospectConverting === "account" ||
                    !prospectSession.duplicateReview?.completed ||
                    !prospectSession.duplicateReview?.countryResolved ||
                    prospectSession.duplicateReview.candidates.length > 0 ||
                    Boolean(
                      prospectConvertedAccountId ||
                      prospectSession.convertedAccountId,
                    )
                  }
                >
                  {prospectConvertedAccountId ||
                  prospectSession.convertedAccountId
                    ? "Cuenta creada/vinculada"
                    : prospectConverting === "account"
                      ? "Creando cuenta..."
                      : "Crear cuenta revisada"}
                </button>
                <button
                  type="button"
                  className="mi-agent-secondary-button"
                  onClick={convertProspectLead}
                  disabled={
                    !canUpdateProspecting ||
                    !canCreateLeads ||
                    prospectConverting === "lead" ||
                    Boolean(prospectConvertedLeadId)
                  }
                >
                  {prospectConvertedLeadId
                    ? "Lead creado"
                    : prospectConverting === "lead"
                      ? "Creando lead..."
                      : "Crear lead"}
                </button>
              </div>
              {Array.isArray(prospectSession.findings) &&
              prospectSession.findings.length ? (
                <div className="mi-agent-finding-list">
                  {prospectSession.findings.map((finding) => (
                    <article
                      key={finding.id}
                      className={`mi-agent-finding-card is-${finding.status}`}
                    >
                      <div className="mi-agent-finding-heading">
                        <div>
                          <span>
                            {CUSTOMER_FINDING_CATEGORY_LABELS[
                              finding.category
                            ] || finding.category}
                          </span>
                          <strong>{finding.title}</strong>
                        </div>
                        <em>
                          {CUSTOMER_FINDING_STATUS_LABELS[finding.status] ||
                            finding.status}
                        </em>
                      </div>
                      <p>{finding.summary}</p>
                      {finding.evidenceText ? (
                        <blockquote>{finding.evidenceText}</blockquote>
                      ) : null}
                      <div className="mi-agent-finding-meta">
                        <span>
                          Confianza:{" "}
                          {CUSTOMER_FINDING_CONFIDENCE_LABELS[
                            finding.confidence
                          ] || finding.confidence}
                          <span>
                            Fuente:{" "}
                            {/^https?:\/\//i.test(
                              finding.sourceReference || "",
                            ) ? (
                              <a
                                href={finding.sourceReference}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Abrir fuente
                              </a>
                            ) : (
                              finding.sourceReference || finding.sourceType
                            )}
                          </span>
                          Fuente:{" "}
                          {finding.sourceReference || finding.sourceType}
                        </span>
                      </div>
                      <div className="mi-agent-finding-actions">
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() =>
                            updateProspectFindingStatus(finding, "confirmed")
                          }
                          disabled={
                            !canUpdateProspecting ||
                            finding.status === "confirmed" ||
                            prospectFindingUpdatingId === finding.id
                          }
                        >
                          Confirmar
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() =>
                            updateProspectFindingStatus(finding, "rejected")
                          }
                          disabled={
                            !canUpdateProspecting ||
                            finding.status === "rejected" ||
                            prospectFindingUpdatingId === finding.id
                          }
                        >
                          Rechazar
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}
              {Array.isArray(prospectSession.contacts) &&
              prospectSession.contacts.length ? (
                <div className="mi-agent-prospect-section">
                  <strong>Contactos objetivo</strong>
                  <div className="mi-agent-prospect-card-grid">
                    {prospectSession.contacts.map((contact) => (
                      <article key={contact.id}>
                        <span>{contact.area}</span>
                        <strong>{contact.roleTitle}</strong>
                        <small>Sugerido · no confirmado en el CRM</small>
                        <p>
                          Confianza:{" "}
                          {CUSTOMER_FINDING_CONFIDENCE_LABELS[
                            contact.confidence
                          ] || contact.confidence}
                        </p>
                        {contact.sourceReference ? (
                          <small>
                            Fuente:{" "}
                            {/^https?:\/\//i.test(contact.sourceReference) ? (
                              <a
                                href={contact.sourceReference}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Abrir fuente
                              </a>
                            ) : (
                              contact.sourceReference
                            )}
                          </small>
                        ) : null}
                        <label>
                          Nombre real
                          <input
                            value={
                              prospectContactDrafts[contact.id]?.contactName ||
                              ""
                            }
                            onChange={(event) =>
                              updateProspectContactDraft(
                                contact.id,
                                "contactName",
                                event.target.value,
                              )
                            }
                            placeholder="Nombre y apellido"
                            disabled={Boolean(
                              prospectConvertedContacts[contact.id],
                            )}
                          />
                        </label>
                        <label>
                          Email opcional
                          <input
                            value={
                              prospectContactDrafts[contact.id]?.email || ""
                            }
                            onChange={(event) =>
                              updateProspectContactDraft(
                                contact.id,
                                "email",
                                event.target.value,
                              )
                            }
                            placeholder="correo@empresa.com"
                            disabled={Boolean(
                              prospectConvertedContacts[contact.id],
                            )}
                          />
                        </label>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => convertProspectContact(contact)}
                          disabled={
                            !canUpdateProspecting ||
                            !canCreateContacts ||
                            Boolean(prospectConvertedContacts[contact.id]) ||
                            prospectConverting === `contact-${contact.id}`
                          }
                        >
                          {prospectConvertedContacts[contact.id]
                            ? "Contacto creado"
                            : prospectConverting === `contact-${contact.id}`
                              ? "Creando..."
                              : "Crear contacto"}
                        </button>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}
              {Array.isArray(prospectSession.hypotheses) &&
              prospectSession.hypotheses.length ? (
                <div className="mi-agent-prospect-section">
                  <strong>Hipótesis de oportunidad</strong>
                  <div className="mi-agent-prospect-card-grid">
                    {prospectSession.hypotheses.map((hypothesis) => (
                      <article key={hypothesis.id}>
                        <span>{hypothesis.technologyArea}</span>
                        <strong>{hypothesis.title}</strong>
                        <small>
                          {hypothesis.status === "confirmed"
                            ? "Validada por el vendedor"
                            : hypothesis.status === "rejected"
                              ? "Rechazada por el vendedor"
                              : "Hipótesis · no confirmada"}
                        </small>
                        <p>{hypothesis.businessChallenge}</p>
                        <small>{hypothesis.validationQuestion}</small>
                        <div className="mi-agent-finding-actions">
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() =>
                              updateProspectHypothesisStatus(
                                hypothesis,
                                "confirmed",
                              )
                            }
                            disabled={
                              !canUpdateProspecting ||
                              hypothesis.status === "confirmed" ||
                              prospectConverting ===
                                `hypothesis-${hypothesis.id}`
                            }
                          >
                            Confirmar hipótesis
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() =>
                              updateProspectHypothesisStatus(
                                hypothesis,
                                "rejected",
                              )
                            }
                            disabled={
                              !canUpdateProspecting ||
                              hypothesis.status === "rejected" ||
                              prospectConverting ===
                                `hypothesis-${hypothesis.id}`
                            }
                          >
                            Rechazar
                          </button>
                        </div>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => convertProspectOpportunity(hypothesis)}
                          disabled={
                            !canUpdateProspecting ||
                            !canCreateOpportunities ||
                            hypothesis.status !== "confirmed" ||
                            Boolean(
                              prospectConvertedOpportunities[hypothesis.id],
                            ) ||
                            prospectConverting ===
                              `opportunity-${hypothesis.id}`
                          }
                        >
                          {prospectConvertedOpportunities[hypothesis.id]
                            ? "Oportunidad creada"
                            : prospectConverting ===
                                `opportunity-${hypothesis.id}`
                              ? "Creando..."
                              : "Crear oportunidad preliminar"}
                        </button>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}
              {prospectSession.result.outreach ? (
                <div className="mi-agent-discovery-email">
                  <strong>Correo inicial sugerido</strong>
                  <span>{prospectSession.result.outreach.subject}</span>
                  <pre>{prospectSession.result.outreach.body}</pre>
                  {prospectSession.result.outreach.questions?.length ? (
                    <ul>
                      {prospectSession.result.outreach.questions.map(
                        (question) => (
                          <li key={question}>{question}</li>
                        ),
                      )}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}
        </section>
      ) : (
        <section className="mi-agent-workspace-panel mi-agent-governance-panel">
          <div className="mi-agent-section-heading">
            <div>
              <span className="mi-agent-section-label">
                Gobierno de Mi Coach
              </span>
              <h3>Configuración, límites y métricas</h3>
            </div>
            <span>Solo administración</span>
          </div>
          {coachGovernanceLoading ? (
            <div className="mi-agent-empty">
              Cargando configuración de gobierno...
            </div>
          ) : null}
          {coachGovernance ? (
            <>
              <section
                className="mi-agent-intent-governance"
                aria-labelledby="mi-agent-intent-governance-title"
              >
                <div className="mi-agent-domain-policy-heading">
                  <div>
                    <h4 id="mi-agent-intent-governance-title">
                      Intenciones y enrutamiento
                    </h4>
                    <p>
                      Aquí editas ejemplos de preguntas para mejorar cómo el
                      sistema clasifica solicitudes. Coach prioriza tu
                      desempeño, puede dar contexto puntual y deriva la
                      exploración detallada a Cliente existente o al módulo de
                      leads.
                    </p>
                  </div>
                </div>
                <div
                  className="mi-agent-intent-modes"
                  aria-label="Modos de respuesta de Coach"
                >
                  <article>
                    <strong>Coaching</strong>
                    <span>
                      Analiza avances y riesgos para proponer una mejora y un
                      siguiente paso al vendedor.
                    </span>
                  </article>
                  <article>
                    <strong>Contexto breve</strong>
                    <span>
                      Contesta una pregunta puntual con los datos mínimos
                      relevantes, sin desplegar la ficha completa.
                    </span>
                  </article>
                  <article>
                    <strong>Exploración detallada</strong>
                    <span>
                      No consulta el detalle desde Coach; ofrece abrir el
                      espacio que permite revisarlo.
                    </span>
                  </article>
                  <article>
                    <strong>Propuesta de operación</strong>
                    <span>
                      Prepara un cambio para revisión; el módulo correspondiente
                      conserva la confirmación y ejecución.
                    </span>
                  </article>
                </div>
                {coachIntentFeedback ? (
                  <p
                    className={`mi-agent-admin-rule-feedback is-${coachIntentFeedback.kind}`}
                    role={
                      coachIntentFeedback.kind === "error" ? "alert" : "status"
                    }
                  >
                    {coachIntentFeedback.message}
                  </p>
                ) : null}
                <div className="mi-agent-intent-layout">
                  <nav
                    className="mi-agent-intent-catalog"
                    aria-label="Catálogo de intenciones"
                  >
                    {coachIntentCatalog.map((intent) => (
                      <button
                        type="button"
                        key={intent.code}
                        className={
                          intent.code === coachIntentCode ? "is-active" : ""
                        }
                        onClick={() => selectCoachIntent(intent)}
                        disabled={coachGovernanceSaving}
                      >
                        <strong>{intent.label}</strong>
                        <span>{intent.code}</span>
                      </button>
                    ))}
                  </nav>
                  {selectedCoachIntent ? (
                    <div className="mi-agent-intent-detail">
                      <div>
                        <h5>{selectedCoachIntent.label}</h5>
                        <p>{selectedCoachIntent.description}</p>
                      </div>
                      <dl className="mi-agent-intent-metadata">
                        <div>
                          <dt>Contexto requerido</dt>
                          <dd>
                            {selectedCoachIntent.requiredContext.length
                              ? selectedCoachIntent.requiredContext.join(", ")
                              : "Ninguno"}
                          </dd>
                        </div>
                        <div>
                          <dt>Herramientas posibles</dt>
                          <dd>
                            {selectedCoachIntent.tools.length
                              ? selectedCoachIntent.tools.join(", ")
                              : "Ninguna"}
                          </dd>
                        </div>
                      </dl>
                      <label className="mi-agent-intent-examples">
                        Ejemplos reconocidos, uno por línea
                        <textarea
                          rows={6}
                          maxLength={7200}
                          value={coachIntentExamplesDraft}
                          onChange={(event) =>
                            setCoachIntentExamplesDraft(event.target.value)
                          }
                          disabled={coachGovernanceSaving}
                        />
                      </label>
                      <div className="mi-agent-intent-preview-form">
                        <label>
                          Pregunta de prueba
                          <input
                            value={coachIntentTestQuestion}
                            maxLength={1200}
                            onChange={(event) =>
                              setCoachIntentTestQuestion(event.target.value)
                            }
                            placeholder="Escribe una pregunta para probar el enrutamiento"
                          />
                        </label>
                        <div className="mi-agent-workspace-actions">
                          <button
                            type="button"
                            className="mi-agent-secondary-button"
                            onClick={previewCoachIntent}
                            disabled={
                              coachGovernanceSaving ||
                              !coachIntentTestQuestion.trim()
                            }
                          >
                            {coachGovernanceSaving ? "Probando..." : "Probar"}
                          </button>
                          <button
                            type="button"
                            className="mi-agent-primary-button"
                            onClick={saveCoachIntentExamples}
                            disabled={
                              coachGovernanceSaving ||
                              !coachIntentExamplesDraft.trim() ||
                              !selectedCoachIntent
                            }
                          >
                            Guardar ejemplos
                          </button>
                        </div>
                      </div>
                      {coachIntentPreview ? (
                        <div className="mi-agent-intent-preview" role="status">
                          <strong>
                            {coachIntentCatalog.find(
                              (intent) =>
                                intent.code ===
                                coachIntentPreview.classification.intent,
                            )?.label || "Requiere aclaración"}
                          </strong>
                          <span>
                            Modo:{" "}
                            {COACH_INTERACTION_MODE_LABELS[
                              coachIntentPreview.classification.mode
                            ] || "Requiere aclaración"}
                          </span>
                          {coachIntentPreview.classification.detailTarget ? (
                            <span>
                              Detalle solicitado:{" "}
                              {coachIntentPreview.classification.detailTarget}
                            </span>
                          ) : null}
                          <span>
                            Confianza{" "}
                            {Math.round(
                              coachIntentPreview.classification.confidence *
                                100,
                            )}
                            %
                          </span>
                          <span>
                            Contexto:{" "}
                            {coachIntentPreview.classification.requiredContext.join(
                              ", ",
                            ) || "ninguno"}
                          </span>
                          {coachIntentPreview.missingContext.length ? (
                            <span>
                              Falta seleccionar:{" "}
                              {coachIntentPreview.missingContext.join(", ")}
                            </span>
                          ) : null}
                          <span>
                            Herramientas previstas:{" "}
                            {coachIntentPreview.plannedTools.join(", ") ||
                              "ninguna"}
                          </span>
                          <small>
                            Simulación sin ejecución de herramientas ni cambios
                            CRM.
                          </small>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="mi-agent-intent-revisions">
                  <h5>Historial de configuración</h5>
                  {coachIntentRevisions.length ? (
                    coachIntentRevisions.map((revision) => (
                      <div
                        className="mi-agent-intent-revision"
                        key={revision.id}
                      >
                        <span>
                          Revisión {revision.id} ·{" "}
                          {new Date(revision.createdAt).toLocaleString()}
                          {revision.changedByUserId
                            ? ` · usuario ${revision.changedByUserId}`
                            : " · sistema"}
                        </span>
                        <button
                          type="button"
                          className="mi-agent-secondary-button"
                          onClick={() => restoreCoachIntentRevision(revision)}
                          disabled={coachGovernanceSaving}
                        >
                          Restaurar
                        </button>
                      </div>
                    ))
                  ) : (
                    <p>No hay cambios previos registrados.</p>
                  )}
                </div>
              </section>

              <section
                className="mi-agent-channel-intent-governance"
                aria-labelledby="mi-agent-channel-intent-title"
              >
                <div className="mi-agent-admin-rules-heading">
                  <div>
                    <h4 id="mi-agent-channel-intent-title">
                      Enrutamiento por canal
                    </h4>
                    <p>
                      Ajusta las intenciones de Cliente existente y Cuenta
                      nueva. Los límites de herramientas y contexto los aplica
                      el servidor.
                    </p>
                  </div>
                  <label className="mi-agent-channel-intent-channel">
                    Canal
                    <select
                      value={channelIntentChannel}
                      onChange={(event) =>
                        loadChannelIntentChannel(event.target.value)
                      }
                      disabled={channelIntentSaving}
                    >
                      <option value="customer_account">
                        Cliente existente
                      </option>
                      <option value="prospect">Cuenta nueva</option>
                    </select>
                  </label>
                </div>
                {channelIntentFeedback ? (
                  <p
                    className={`mi-agent-admin-rule-feedback is-${channelIntentFeedback.kind}`}
                    role={
                      channelIntentFeedback.kind === "error"
                        ? "alert"
                        : "status"
                    }
                  >
                    {channelIntentFeedback.message}
                  </p>
                ) : null}
                <div className="mi-agent-intent-layout">
                  <nav
                    className="mi-agent-intent-catalog"
                    aria-label="Intenciones del canal"
                  >
                    {channelIntentCatalog.map((intent) => (
                      <button
                        type="button"
                        key={intent.code}
                        className={
                          intent.code === channelIntentCode ? "is-active" : ""
                        }
                        onClick={() => selectChannelIntent(intent)}
                        disabled={channelIntentSaving}
                      >
                        <strong>{intent.label}</strong>
                        <span>{intent.code}</span>
                      </button>
                    ))}
                  </nav>
                  {selectedChannelIntent && channelIntentDraft ? (
                    <div className="mi-agent-intent-detail">
                      <div>
                        <h5>{selectedChannelIntent.label}</h5>
                        <p>{selectedChannelIntent.description}</p>
                      </div>
                      <label className="mi-agent-channel-intent-toggle">
                        <input
                          type="checkbox"
                          checked={channelIntentDraft.enabled}
                          disabled={
                            channelIntentSaving ||
                            ["account_overview", "prospect_profile"].includes(
                              selectedChannelIntent.code,
                            )
                          }
                          onChange={(event) =>
                            setChannelIntentDraft((current) => ({
                              ...current,
                              enabled: event.target.checked,
                            }))
                          }
                        />
                        Activa
                      </label>
                      <label className="mi-agent-channel-intent-priority">
                        Prioridad
                        <input
                          type="number"
                          min={0}
                          max={200}
                          value={channelIntentDraft.priority}
                          onChange={(event) =>
                            setChannelIntentDraft((current) => ({
                              ...current,
                              priority: Number(event.target.value),
                            }))
                          }
                          disabled={channelIntentSaving}
                        />
                      </label>
                      <label className="mi-agent-intent-examples">
                        Ejemplos reconocidos, uno por línea
                        <textarea
                          rows={5}
                          maxLength={7200}
                          value={channelIntentDraft.examples}
                          onChange={(event) =>
                            setChannelIntentDraft((current) => ({
                              ...current,
                              examples: event.target.value,
                            }))
                          }
                          disabled={channelIntentSaving}
                        />
                      </label>
                      <fieldset className="mi-agent-channel-intent-options">
                        <legend>Herramientas permitidas</legend>
                        {selectedChannelIntent.possibleTools.map((tool) => (
                          <label key={tool}>
                            <input
                              type="checkbox"
                              checked={channelIntentDraft.allowedTools.includes(
                                tool,
                              )}
                              onChange={(event) =>
                                setChannelIntentDraft((current) => ({
                                  ...current,
                                  allowedTools: event.target.checked
                                    ? [...current.allowedTools, tool]
                                    : current.allowedTools.filter(
                                        (item) => item !== tool,
                                      ),
                                }))
                              }
                              disabled={channelIntentSaving}
                            />
                            {tool}
                          </label>
                        ))}
                      </fieldset>
                      <fieldset className="mi-agent-channel-intent-options">
                        <legend>Contexto requerido</legend>
                        {(channelIntentChannel === "customer_account"
                          ? ["account", "opportunity", "contact"]
                          : ["prospectSession"]
                        ).map((contextKey) => {
                          const fixed =
                            selectedChannelIntent.fixedContext.includes(
                              contextKey,
                            );
                          return (
                            <label key={contextKey}>
                              <input
                                type="checkbox"
                                checked={channelIntentDraft.requiredContext.includes(
                                  contextKey,
                                )}
                                onChange={(event) =>
                                  setChannelIntentDraft((current) => ({
                                    ...current,
                                    requiredContext: event.target.checked
                                      ? [...current.requiredContext, contextKey]
                                      : current.requiredContext.filter(
                                          (item) => item !== contextKey,
                                        ),
                                  }))
                                }
                                disabled={channelIntentSaving || fixed}
                              />
                              {contextKey}
                              {fixed ? " · obligatorio" : ""}
                            </label>
                          );
                        })}
                      </fieldset>
                      <div className="mi-agent-intent-preview-form">
                        <label>
                          Pregunta de prueba
                          <input
                            value={channelIntentTestQuestion}
                            maxLength={1200}
                            onChange={(event) =>
                              setChannelIntentTestQuestion(event.target.value)
                            }
                            placeholder="Escribe una pregunta para probar el enrutamiento"
                          />
                        </label>
                        <div className="mi-agent-workspace-actions">
                          <button
                            type="button"
                            className="mi-agent-secondary-button"
                            onClick={previewChannelIntentConfiguration}
                            disabled={
                              channelIntentSaving ||
                              !channelIntentTestQuestion.trim()
                            }
                          >
                            Probar
                          </button>
                          <button
                            type="button"
                            className="mi-agent-primary-button"
                            onClick={saveChannelIntentConfiguration}
                            disabled={
                              channelIntentSaving ||
                              !channelIntentDraft.examples.trim()
                            }
                          >
                            Guardar configuración
                          </button>
                        </div>
                      </div>
                      {channelIntentPreview?.classification ? (
                        <div className="mi-agent-intent-preview">
                          <strong>
                            {channelIntentPreview.classification.label} ·{" "}
                            {channelIntentPreview.classification.intent}
                          </strong>
                          {channelIntentPreview.classification.missingContext
                            .length ? (
                            <span>
                              Contexto requerido no suministrado:{" "}
                              {channelIntentPreview.classification.missingContext.join(
                                ", ",
                              )}
                            </span>
                          ) : null}
                          <span>
                            Herramientas previstas:{" "}
                            {channelIntentPreview.classification.allowedTools.join(
                              ", ",
                            ) || "ninguna"}
                          </span>
                          <small>
                            Simulación sin ejecución de herramientas ni cambios
                            CRM.
                          </small>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="mi-agent-intent-revisions">
                  <h5>Historial de configuración del canal</h5>
                  {channelIntentRevisions.length ? (
                    channelIntentRevisions.map((revision) => (
                      <div
                        className="mi-agent-intent-revision"
                        key={revision.id}
                      >
                        <span>
                          Revisión {revision.id} ·{" "}
                          {new Date(revision.createdAt).toLocaleString()}
                          {revision.restoredFromRevisionId
                            ? ` · restaurada desde ${revision.restoredFromRevisionId}`
                            : ""}
                        </span>
                        <button
                          type="button"
                          className="mi-agent-secondary-button"
                          onClick={() =>
                            restoreChannelIntentConfiguration(revision)
                          }
                          disabled={channelIntentSaving}
                        >
                          Restaurar
                        </button>
                      </div>
                    ))
                  ) : (
                    <p>No hay cambios previos registrados.</p>
                  )}
                </div>
              </section>

              <section
                className="mi-agent-admin-rules"
                aria-labelledby="mi-agent-admin-rules-title"
              >
                <div className="mi-agent-admin-rules-heading">
                  <div>
                    <h4 id="mi-agent-admin-rules-title">
                      Reglas conversacionales
                    </h4>
                    <p>
                      Define instrucciones de respuesta para el asistente:
                      comunes para todos los chats o específicas por canal y
                      tipo de consulta.
                    </p>
                  </div>
                  <div className="mi-agent-admin-rules-actions">
                    <button
                      type="button"
                      className="mi-agent-secondary-button"
                      onClick={() => startCoachAdminRuleCreate("common")}
                      disabled={coachGovernanceSaving}
                    >
                      Añadir regla común
                    </button>
                    <button
                      type="button"
                      className="mi-agent-primary-button"
                      onClick={() => startCoachAdminRuleCreate("channel")}
                      disabled={coachGovernanceSaving}
                    >
                      Añadir regla específica
                    </button>
                  </div>
                </div>
                {coachAdminRuleFeedback ? (
                  <p
                    className={`mi-agent-admin-rule-feedback is-${coachAdminRuleFeedback.kind}`}
                    role={
                      coachAdminRuleFeedback.kind === "error"
                        ? "alert"
                        : "status"
                    }
                  >
                    {coachAdminRuleFeedback.message}
                  </p>
                ) : null}
                <div className="mi-agent-admin-rule-groups">
                  {[
                    {
                      key: "common",
                      title: "Comunes a todos los chats",
                      rules: coachAdminRules.filter(
                        (rule) => rule.scope === "common",
                      ),
                    },
                    {
                      key: "coach",
                      title: `Específicas para Coach · ${coachBusinessRulesChannel === "coach" ? getCoachProcessOption(coachBusinessRulesProcess, "coach").label : "todos los tipos de consulta"}`,
                      rules: getVisibleChannelRules("coach"),
                    },
                    {
                      key: "customer_account",
                      title: `Específicas para Cliente existente · ${coachBusinessRulesChannel === "customer_account" ? getCoachProcessOption(coachBusinessRulesProcess, "customer_account").label : "toda la conversación"}`,
                      rules: getVisibleChannelRules("customer_account"),
                    },
                    {
                      key: "prospect",
                      title: `Específicas para Cuenta nueva · ${coachBusinessRulesChannel === "prospect" ? getCoachProcessOption(coachBusinessRulesProcess, "prospect").label : "toda la conversación"}`,
                      rules: getVisibleChannelRules("prospect"),
                    },
                  ].map((group) => (
                    <section
                      className="mi-agent-admin-rule-group"
                      key={group.key}
                    >
                      <h5>{group.title}</h5>
                      {group.rules.length ? (
                        <div className="mi-agent-admin-rule-list">
                          {group.rules.map((rule) => (
                            <article
                              className={`mi-agent-admin-rule${rule.enabled ? "" : " is-disabled"}`}
                              key={rule.id}
                            >
                              <div className="mi-agent-admin-rule-copy">
                                <strong>{rule.title}</strong>
                                {rule.scope === "channel" ? (
                                  <span>
                                    {COACH_RULE_CHANNEL_LABELS[rule.channel]} ·{" "}
                                    {
                                      getCoachProcessOption(
                                        rule.process,
                                        rule.channel,
                                      ).label
                                    }
                                  </span>
                                ) : null}
                                <p>{rule.instruction}</p>
                              </div>
                              <div className="mi-agent-admin-rule-controls">
                                <label className="mi-agent-admin-rule-toggle">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(rule.enabled)}
                                    onChange={() => toggleCoachAdminRule(rule)}
                                    disabled={coachGovernanceSaving}
                                  />
                                  Activa
                                </label>
                                <button
                                  type="button"
                                  className="mi-agent-icon-button"
                                  aria-label={`Editar regla ${rule.title}`}
                                  title="Editar regla"
                                  onClick={() => startCoachAdminRuleEdit(rule)}
                                  disabled={coachGovernanceSaving}
                                >
                                  <Pencil size={15} aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  className="mi-agent-icon-button is-danger"
                                  aria-label={`Eliminar regla ${rule.title}`}
                                  title="Eliminar regla"
                                  onClick={() => deleteCoachAdminRule(rule)}
                                  disabled={coachGovernanceSaving}
                                >
                                  <Trash2 size={15} aria-hidden="true" />
                                </button>
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <p className="mi-agent-admin-rule-empty">
                          {group.key === coachBusinessRulesChannel &&
                          coachBusinessRulesProcess !== "default"
                            ? `No hay reglas específicas para ${getCoachProcessOption(coachBusinessRulesProcess, coachBusinessRulesChannel).label}; se aplican las reglas predeterminadas del canal.`
                            : "No hay reglas en este ámbito."}
                        </p>
                      )}
                    </section>
                  ))}
                </div>
                {coachAdminRuleDraft ? (
                  <div className="mi-agent-admin-rule-editor">
                    <div className="mi-agent-admin-rule-editor-heading">
                      <h5>
                        {coachAdminRuleEditingId
                          ? "Editar regla"
                          : "Nueva regla"}
                      </h5>
                      <span>
                        {coachAdminRuleDraft.scope === "common"
                          ? "Común a todos los chats"
                          : `${COACH_RULE_CHANNEL_LABELS[coachAdminRuleDraft.channel]} · ${getCoachProcessOption(coachAdminRuleDraft.process, coachAdminRuleDraft.channel).label}`}
                      </span>
                    </div>
                    <label>
                      Nombre
                      <input
                        value={coachAdminRuleDraft.title}
                        maxLength={180}
                        onChange={(event) =>
                          setCoachAdminRuleDraft((current) => ({
                            ...current,
                            title: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      Instrucción
                      <textarea
                        rows={4}
                        value={coachAdminRuleDraft.instruction}
                        maxLength={5000}
                        onChange={(event) =>
                          setCoachAdminRuleDraft((current) => ({
                            ...current,
                            instruction: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="mi-agent-admin-rule-order">
                      Orden
                      <input
                        type="number"
                        min={-1000}
                        max={1000}
                        value={coachAdminRuleDraft.sortOrder}
                        onChange={(event) =>
                          setCoachAdminRuleDraft((current) => ({
                            ...current,
                            sortOrder: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <div className="mi-agent-workspace-actions">
                      <button
                        type="button"
                        className="mi-agent-primary-button"
                        onClick={saveCoachAdminRule}
                        disabled={
                          coachGovernanceSaving ||
                          !coachAdminRuleDraft.title.trim() ||
                          !coachAdminRuleDraft.instruction.trim()
                        }
                      >
                        {coachGovernanceSaving
                          ? "Guardando..."
                          : "Guardar regla"}
                      </button>
                      <button
                        type="button"
                        className="mi-agent-secondary-button"
                        onClick={() => {
                          setCoachAdminRuleDraft(null);
                          setCoachAdminRuleEditingId(null);
                        }}
                        disabled={coachGovernanceSaving}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : null}
              </section>

              <section
                className="mi-agent-domain-policy"
                aria-labelledby="mi-agent-channel-policy-title"
              >
                <div className="mi-agent-domain-policy-heading">
                  <div>
                    <h4 id="mi-agent-channel-policy-title">
                      Políticas del canal y contexto
                    </h4>
                    <p>
                      Delimita qué datos puede consultar cada canal y qué
                      operaciones puede proponer. Los permisos del usuario
                      siempre se validan por separado.
                    </p>
                  </div>
                </div>

                <div className="mi-agent-governance-grid">
                  <label>
                    Canal
                    <select
                      value={coachBusinessRulesChannel}
                      onChange={(event) => {
                        const channel = event.target.value;
                        setCoachBusinessRulesChannel(channel);
                        setCoachBusinessRulesProcess("default");
                        loadCoachAdminRules("all", "default");
                        loadCoachBusinessRulesForScope(channel, "default");
                      }}
                    >
                      <option value="coach">Coach</option>
                      <option value="customer_account">Cuenta existente</option>
                      <option value="prospect">Prospección</option>
                    </select>
                  </label>
                  <label>
                    Tipo de consulta
                    <select
                      value={coachBusinessRulesProcess}
                      onChange={(event) => {
                        const process = event.target.value;
                        setCoachBusinessRulesProcess(process);
                        loadCoachAdminRules("all", process);
                        loadCoachBusinessRulesForScope(
                          coachBusinessRulesChannel,
                          process,
                        );
                      }}
                    >
                      <option value="default">
                        Configuración predeterminada del canal
                      </option>
                      {coachBusinessRulesChannel === "coach"
                        ? COACH_INTENT_PROCESS_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))
                        : [
                            coachBusinessRulesChannel === "prospect"
                              ? "prospect_chat"
                              : "account_chat",
                          ].map((process) => (
                            <option key={process} value={process}>
                              {
                                getCoachProcessOption(
                                  process,
                                  coachBusinessRulesChannel,
                                ).label
                              }
                            </option>
                          ))}
                    </select>
                    <small className="mi-agent-scope-help">
                      {selectedCoachProcessOption.description}
                    </small>
                  </label>
                </div>

                <p className="mi-agent-scope-explainer">
                  La selección de tipo de consulta solo determina a qué
                  solicitudes aplican estos ajustes. No selecciona una etapa
                  comercial ni cambia los controles globales del pipeline.
                </p>

                <section className="mi-agent-domain-policy-subsection">
                  <div>
                    <span className="mi-agent-section-label">
                      {COACH_RULE_CHANNEL_LABELS[coachBusinessRulesChannel]}
                    </span>
                    <div className="mi-agent-admin-scope-status">
                      <strong>
                        Configuración para:{" "}
                        {COACH_RULE_CHANNEL_LABELS[coachBusinessRulesChannel]} ·{" "}
                        {selectedCoachProcessOption.label}
                      </strong>
                      <span>{coachBusinessRulesSourceLabel}</span>
                    </div>
                    <h4>Alcance por dominio y operaciones</h4>
                    <p>
                      Estos controles pueden reducir lo que consulta o propone
                      el chat. Los permisos efectivos y los límites obligatorios
                      del canal siguen siendo validados por el servidor.
                    </p>
                  </div>
                  <div className="mi-agent-domain-policy-groups">
                    <fieldset className="mi-agent-domain-stage-group">
                      <legend>Dominios disponibles para consulta</legend>
                      {[
                        ["accountSearchAllowed", "Cuentas"],
                        ["contactSearchAllowed", "Contactos"],
                        ["leadSearchAllowed", "Leads"],
                        [
                          "opportunitySearchAllowed",
                          "Oportunidades y pipeline",
                        ],
                        ["quotationSearchAllowed", "Cotizaciones"],
                      ].map(([field, label]) => {
                        const channelForbidsDomain =
                          coachBusinessRulesChannel === "prospect" &&
                          [
                            "contactSearchAllowed",
                            "leadSearchAllowed",
                            "opportunitySearchAllowed",
                            "quotationSearchAllowed",
                          ].includes(field);
                        return (
                          <label key={field}>
                            <input
                              type="checkbox"
                              checked={
                                selectedCoachBusinessRules.scope?.[field] !==
                                false
                              }
                              disabled={channelForbidsDomain}
                              onChange={(event) =>
                                updateCoachBusinessRuleField(
                                  "scope",
                                  field,
                                  event.target.checked,
                                )
                              }
                            />
                            {label}
                            {channelForbidsDomain
                              ? " · no disponible en este canal"
                              : ""}
                          </label>
                        );
                      })}
                    </fieldset>
                    <fieldset className="mi-agent-domain-stage-group">
                      <legend>Operaciones que este canal puede proponer</legend>
                      {(
                        COACH_OPERATION_OPTIONS[coachBusinessRulesChannel] || []
                      ).map(([kind, label]) => (
                        <label key={kind}>
                          <input
                            type="checkbox"
                            checked={(
                              selectedCoachBusinessRules.operationPolicy
                                ?.allowedKinds || []
                            ).includes(kind)}
                            onChange={(event) =>
                              updateCoachOperationKind(
                                kind,
                                event.target.checked,
                              )
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </fieldset>
                  </div>
                  <div className="mi-agent-workspace-actions">
                    <button
                      type="button"
                      className="mi-agent-primary-button"
                      onClick={saveCoachBusinessRules}
                      disabled={coachGovernanceSaving}
                    >
                      Guardar políticas del canal
                    </button>
                  </div>
                </section>
              </section>

              <section
                className="mi-agent-governance-settings"
                aria-labelledby="mi-agent-governance-settings-title"
              >
                <div className="mi-agent-domain-policy-heading">
                  <div>
                    <h4 id="mi-agent-governance-settings-title">
                      Configuración de gobierno
                    </h4>
                    <p>
                      Ajusta límites globales y banderas generales que aplican
                      al uso del asistente en toda la organización.
                    </p>
                  </div>
                </div>
                <section className="mi-agent-pipeline-governance">
                  <div>
                    <span className="mi-agent-section-label">
                      Configuración global
                    </span>
                    <h4>Etapas del pipeline calificado y comprometido</h4>
                    <p>
                      Elige qué etapas se incluyen en cada indicador. Esto se
                      aplica a toda la organización, no al canal ni al tipo de
                      consulta seleccionado. Una oportunidad abierta se define
                      por estar activada y En proceso; esta selección no cambia
                      esa regla.
                    </p>
                  </div>
                  <div className="mi-agent-domain-policy-groups">
                    {[
                      {
                        key: "qualifiedOpportunityStageCodes",
                        title: "Etapas que cuentan en el pipeline calificado",
                        selected:
                          coachGovernance.settings
                            .qualifiedOpportunityStageCodes || [],
                      },
                      {
                        key: "committedOpportunityStageCodes",
                        title: "Etapas que cuentan en el monto comprometido",
                        selected:
                          coachGovernance.settings
                            .committedOpportunityStageCodes || [],
                      },
                    ].map((group) => (
                      <fieldset
                        className="mi-agent-domain-stage-group"
                        key={group.key}
                      >
                        <legend>{group.title}</legend>
                        {COACH_OPPORTUNITY_STAGE_OPTIONS.map((stage) => {
                          const isQualified = (
                            coachGovernance.settings
                              .qualifiedOpportunityStageCodes || []
                          ).includes(stage.code);
                          return (
                            <label key={`${group.key}-${stage.code}`}>
                              <input
                                type="checkbox"
                                checked={group.selected.includes(stage.code)}
                                disabled={
                                  (group.key ===
                                    "committedOpportunityStageCodes" &&
                                    !isQualified) ||
                                  (group.selected.length === 1 &&
                                    group.selected.includes(stage.code))
                                }
                                onChange={(event) =>
                                  updateOpportunityStageSet(
                                    group.key,
                                    stage.code,
                                    event.target.checked,
                                  )
                                }
                              />
                              {stage.label}
                            </label>
                          );
                        })}
                      </fieldset>
                    ))}
                  </div>
                  <p className="mi-agent-scope-help">
                    Se guarda con el botón «Guardar configuración» de esta
                    sección.
                  </p>
                </section>
                <div className="mi-agent-governance-grid">
                  <label>
                    Fuentes externas habilitadas
                    <input
                      type="checkbox"
                      checked={Boolean(
                        coachGovernance.settings.externalSourcesEnabled,
                      )}
                      onChange={(event) =>
                        setCoachGovernance((current) => ({
                          ...current,
                          settings: {
                            ...current.settings,
                            externalSourcesEnabled: event.target.checked,
                          },
                        }))
                      }
                    />
                  </label>
                  <label>
                    Conversiones de prospección habilitadas
                    <input
                      type="checkbox"
                      checked={Boolean(
                        coachGovernance.settings.allowProspectConversion,
                      )}
                      onChange={(event) =>
                        setCoachGovernance((current) => ({
                          ...current,
                          settings: {
                            ...current.settings,
                            allowProspectConversion: event.target.checked,
                          },
                        }))
                      }
                    />
                  </label>
                  <label>
                    Incluir oportunidades ganadas
                    <input
                      type="checkbox"
                      checked={Boolean(
                        coachGovernance.settings.includeWonOpportunities,
                      )}
                      onChange={(event) =>
                        setCoachGovernance((current) => ({
                          ...current,
                          settings: {
                            ...current.settings,
                            includeWonOpportunities: event.target.checked,
                          },
                        }))
                      }
                    />
                  </label>
                  <label>
                    Incluir oportunidades perdidas
                    <input
                      type="checkbox"
                      checked={Boolean(
                        coachGovernance.settings.includeLostOpportunities,
                      )}
                      onChange={(event) =>
                        setCoachGovernance((current) => ({
                          ...current,
                          settings: {
                            ...current.settings,
                            includeLostOpportunities: event.target.checked,
                          },
                        }))
                      }
                    />
                  </label>
                  <label>
                    Incluir oportunidades anuladas
                    <input
                      type="checkbox"
                      checked={Boolean(
                        coachGovernance.settings.includeCancelledOpportunities,
                      )}
                      onChange={(event) =>
                        setCoachGovernance((current) => ({
                          ...current,
                          settings: {
                            ...current.settings,
                            includeCancelledOpportunities: event.target.checked,
                          },
                        }))
                      }
                    />
                  </label>
                  <label>
                    Límite diario de investigación por usuario
                    <input
                      type="number"
                      min="1"
                      max="500"
                      value={coachGovernance.settings.dailyResearchLimitPerUser}
                      onChange={(event) =>
                        setCoachGovernance((current) => ({
                          ...current,
                          settings: {
                            ...current.settings,
                            dailyResearchLimitPerUser: Number(
                              event.target.value,
                            ),
                          },
                        }))
                      }
                    />
                  </label>
                  <label>
                    Retención de hallazgos (días)
                    <input
                      type="number"
                      min="30"
                      max="3650"
                      value={coachGovernance.settings.findingRetentionDays}
                      onChange={(event) =>
                        setCoachGovernance((current) => ({
                          ...current,
                          settings: {
                            ...current.settings,
                            findingRetentionDays: Number(event.target.value),
                          },
                        }))
                      }
                    />
                  </label>
                  <label className="mi-agent-governance-wide">
                    Notas
                    <textarea
                      value={coachGovernance.settings.notes || ""}
                      onChange={(event) =>
                        setCoachGovernance((current) => ({
                          ...current,
                          settings: {
                            ...current.settings,
                            notes: event.target.value,
                          },
                        }))
                      }
                    />
                  </label>
                </div>
                <div className="mi-agent-workspace-actions">
                  <button
                    type="button"
                    className="mi-agent-primary-button"
                    onClick={saveCoachGovernance}
                    disabled={coachGovernanceSaving}
                  >
                    {coachGovernanceSaving
                      ? "Guardando..."
                      : "Guardar configuración"}
                  </button>
                </div>
              </section>

              <section
                className="mi-agent-governance-metrics-section"
                aria-labelledby="mi-agent-governance-metrics-title"
              >
                <h4 id="mi-agent-governance-metrics-title">
                  Calidad y métricas
                </h4>
                <p>
                  Revisa desempeño, regresiones y volumen de uso para monitorear
                  la calidad operativa del asistente.
                </p>
                <section className="mi-agent-governance-metrics">
                  <h4>Evaluación del planificador</h4>
                  <div className="mi-agent-governance-grid">
                    {(coachQualityDashboard?.plannerMetrics || []).map(
                      (metrics) => (
                        <article
                          className="mi-agent-governance-rollout"
                          key={`planner-rollout-${metrics.mode}-${metrics.cohort}`}
                        >
                          <strong>Planificador · Cliente existente</strong>
                          <span>
                            Planner disponible {metrics.planAvailableTurns}/
                            {metrics.turns} turnos · filtros explícitos medios{" "}
                            {metrics.averagePlannerFilterCount ?? "Sin muestra"}
                            · referencias medias{" "}
                            {metrics.averagePlannerEntityReferenceCount ??
                              "Sin muestra"}
                          </span>
                          <span>
                            Herramientas observadas{" "}
                            {metrics.plannedToolObservationRate == null
                              ? "Sin muestra"
                              : `${Math.round(metrics.plannedToolObservationRate * 100)}%`}
                            · con evidencia{" "}
                            {metrics.plannedToolEvidenceRate == null
                              ? "Sin muestra"
                              : `${Math.round(metrics.plannedToolEvidenceRate * 100)}%`}
                            · aclaraciones del planner{" "}
                            {Math.round(metrics.plannerClarificationRate * 100)}
                            % · visibles{" "}
                            {Math.round(metrics.visibleClarificationRate * 100)}
                            %
                            {metrics.incorrectClarificationRate == null
                              ? " · feedback negativo de aclaración sin muestra"
                              : ` · feedback negativo visible ${Math.round(metrics.incorrectClarificationRate * 100)}%`}
                          </span>
                          <span>
                            Fallback genérico{" "}
                            {Math.round(metrics.genericFallbackRate * 100)}% ·
                            errores de recuperación{" "}
                            {Math.round(metrics.retrievalErrorRate * 100)}% ·
                            truncamiento{" "}
                            {Math.round(metrics.truncationRate * 100)}%
                          </span>
                          <span>
                            Latencia media {metrics.averageLatencyMs} ms · costo
                            medio por turno{" "}
                            {metrics.averageCostMicros == null
                              ? "Sin dato"
                              : `USD ${(metrics.averageCostMicros / 1000000).toFixed(4)}`}
                            · correcciones{" "}
                            {metrics.correctionByFeedbackRate == null
                              ? "Sin feedback"
                              : `${Math.round(metrics.correctionByFeedbackRate * 100)}%`}
                          </span>
                        </article>
                      ),
                    )}
                  </div>
                </section>
                <section className="mi-agent-governance-metrics">
                  <h4>
                    Calidad del motor ·{" "}
                    {coachQualityDashboard?.periodDays || 30} días
                  </h4>
                  <p>
                    {coachQualityDashboard?.totalTurns || 0} turnos trazados
                  </p>
                  <div className="mi-agent-governance-grid">
                    {(coachQualityDashboard?.channels || []).map((metrics) => (
                      <article
                        className="mi-agent-governance-rollout"
                        key={`quality-${metrics.channel}`}
                      >
                        <strong>{metrics.channel}</strong>
                        <span>
                          Aclaraciones{" "}
                          {Math.round(metrics.clarificationRate * 100)}% ·
                          Respuestas inválidas{" "}
                          {Math.round(metrics.invalidResponseRate * 100)}%
                        </span>
                        <span>
                          Intención{" "}
                          {metrics.intentFeedbackCount
                            ? `${Math.round(metrics.intentClassificationAccuracy * 100)}%`
                            : "Sin feedback"}
                          · Entidad{" "}
                          {metrics.entityFeedbackCount
                            ? `${Math.round(metrics.entityResolutionQuality * 100)}%`
                            : "Sin feedback"}
                        </span>
                        <span>
                          Operaciones rechazadas{" "}
                          {metrics.proposedOperations
                            ? `${Math.round(metrics.rejectedOperationRate * 100)}%`
                            : "Sin operaciones"}
                          · Correcciones{" "}
                          {metrics.feedbackCount
                            ? `${Math.round(metrics.correctionByFeedbackRate * 100)}%`
                            : "Sin feedback"}
                        </span>
                      </article>
                    ))}
                  </div>
                  {coachQualityDashboard?.regressions?.length ? (
                    <div className="mi-agent-governance-regressions">
                      <strong>Procesos con señales de regresión</strong>
                      {coachQualityDashboard.regressions
                        .slice(0, 8)
                        .map((item) => (
                          <p key={`${item.channel}-${item.process}`}>
                            {item.channel} · {item.process}
                            {item.caseId ? ` · ${item.caseId}` : ""}: inválidas{" "}
                            {Math.round(item.invalidResponseRate * 100)}%,
                            feedback negativo {item.negativeFeedback},
                            operaciones rechazadas {item.rejectedOperations}
                          </p>
                        ))}
                    </div>
                  ) : null}
                </section>
                <div className="mi-agent-governance-metrics">
                  <h4>Actividad de los últimos 30 días</h4>
                  <p>
                    Jobs:{" "}
                    {coachGovernance.metrics.jobsLast30Days?.reduce(
                      (sum, item) => sum + Number(item.total || 0),
                      0,
                    ) || 0}{" "}
                    · Hallazgos:{" "}
                    {coachGovernance.metrics.findingsLast30Days?.reduce(
                      (sum, item) => sum + Number(item.total || 0),
                      0,
                    ) || 0}{" "}
                    · Sesiones de prospección:{" "}
                    {coachGovernance.metrics.prospectSessionsLast30Days?.reduce(
                      (sum, item) => sum + Number(item.total || 0),
                      0,
                    ) || 0}
                  </p>
                </div>
              </section>

              <details className="mi-agent-admin-rules-advanced">
                <summary>Configuración técnica avanzada del ámbito</summary>
                <p>
                  Edita directamente el contrato JSON de políticas solo para
                  ajustes avanzados del comportamiento del motor.
                </p>
                <label className="mi-agent-governance-wide">
                  Contrato JSON de reglas deterministas
                  <textarea
                    rows={18}
                    spellCheck={false}
                    value={coachBusinessRulesDraft}
                    onChange={(event) =>
                      setCoachBusinessRulesDraft(event.target.value)
                    }
                  />
                </label>
                <div className="mi-agent-workspace-actions">
                  <button
                    type="button"
                    className="mi-agent-primary-button"
                    onClick={saveCoachBusinessRules}
                    disabled={coachGovernanceSaving}
                  >
                    Guardar contrato técnico
                  </button>
                  <button
                    type="button"
                    className="mi-agent-secondary-button"
                    onClick={resetCoachBusinessRules}
                    disabled={coachGovernanceSaving}
                  >
                    Restablecer contrato técnico
                  </button>
                </div>
              </details>
            </>
          ) : !coachGovernanceLoading ? (
            <div className="mi-agent-empty">
              No se pudo cargar el gobierno de Mi Coach.
            </div>
          ) : null}
        </section>
      )}

      {customerContactApplyDraft ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Confirmar contacto público"
        >
          <div className="modal-dialog mi-agent-coach-action-dialog">
            <h3 className="modal-title">Confirmar contacto público</h3>
            <p className="modal-message">
              Revisa la evidencia y confirma si deseas crear este contacto en la
              cuenta.
            </p>
            <div className="mi-agent-coach-action-form">
              {[
                ["firstName", "Nombre"],
                ["lastName", "Apellido"],
                ["positionTitle", "Cargo"],
                ["department", "Departamento"],
                ["email", "Correo corporativo"],
                ["phone", "Teléfono"],
                ["mobile", "Móvil"],
              ].map(([field, label]) => (
                <label key={field}>
                  {label}
                  <input
                    value={customerContactApplyDraft.contactData?.[field] || ""}
                    onChange={(event) =>
                      setCustomerContactApplyDraft((current) => ({
                        ...current,
                        contactData: {
                          ...current.contactData,
                          [field]: event.target.value,
                        },
                      }))
                    }
                  />
                </label>
              ))}
              {coachContacts.length ? (
                <label>
                  Actualizar contacto existente (opcional)
                  <select
                    value={customerContactApplyDraft.contactId}
                    onChange={(event) =>
                      setCustomerContactApplyDraft((current) => ({
                        ...current,
                        contactId: event.target.value,
                      }))
                    }
                  >
                    <option value="">Crear contacto nuevo</option>
                    {coachContacts.map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {contact.full_name ||
                          `${contact.first_name || ""} ${contact.last_name || ""}`.trim()}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            <div className="modal-buttons">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setCustomerContactApplyDraft(null)}
                disabled={customerContactApplying}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={applyCustomerContact}
                disabled={
                  customerContactApplying ||
                  !customerContactApplyDraft.contactData?.firstName?.trim() ||
                  !customerContactApplyDraft.contactData?.lastName?.trim()
                }
              >
                {customerContactApplying
                  ? "Guardando..."
                  : "Confirmar y guardar contacto"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {customerFindingApplyDraft ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Aplicar hallazgo al CRM"
        >
          <div className="modal-dialog mi-agent-coach-action-dialog">
            <h3 className="modal-title">Aplicar hallazgo al CRM</h3>
            <p className="modal-message">
              El hallazgo fue confirmado. Revisa el valor sugerido antes de
              agregarlo o reemplazar el dato del registro.
            </p>
            <div className="mi-agent-coach-action-form">
              <label>
                Registro
                <select
                  value={customerFindingApplyDraft.target}
                  onChange={(event) => {
                    const target = event.target.value;
                    const firstField =
                      CUSTOMER_FINDING_APPLY_FIELDS[target]?.[0]?.[0] || "";
                    setCustomerFindingApplyDraft((current) => ({
                      ...current,
                      target,
                      field: firstField,
                    }));
                  }}
                >
                  {customerFindingApplyDraft.finding.accountId ? (
                    <option value="account">Cuenta</option>
                  ) : null}
                  {customerFindingApplyDraft.finding.contactId ? (
                    <option value="contact">Contacto</option>
                  ) : null}
                  {customerFindingApplyDraft.finding.opportunityId ? (
                    <option value="opportunity">Oportunidad</option>
                  ) : null}
                </select>
              </label>
              <label>
                Campo
                <select
                  value={customerFindingApplyDraft.field}
                  onChange={(event) =>
                    setCustomerFindingApplyDraft((current) => ({
                      ...current,
                      field: event.target.value,
                    }))
                  }
                >
                  {(
                    CUSTOMER_FINDING_APPLY_FIELDS[
                      customerFindingApplyDraft.target
                    ] || []
                  ).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Valor
                <textarea
                  rows={5}
                  value={customerFindingApplyDraft.value}
                  onChange={(event) =>
                    setCustomerFindingApplyDraft((current) => ({
                      ...current,
                      value: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Tratamiento del valor actual
                <select
                  value={customerFindingApplyDraft.mode}
                  onChange={(event) =>
                    setCustomerFindingApplyDraft((current) => ({
                      ...current,
                      mode: event.target.value,
                    }))
                  }
                >
                  <option value="append">Agregar al valor existente</option>
                  <option value="replace">Reemplazar el valor existente</option>
                </select>
              </label>
            </div>
            <div className="modal-buttons">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setCustomerFindingApplyDraft(null)}
                disabled={customerFindingApplying}
              >
                Cerrar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={applyCustomerFinding}
                disabled={
                  customerFindingApplying ||
                  !String(customerFindingApplyDraft.value || "").trim()
                }
              >
                {customerFindingApplying
                  ? "Aplicando..."
                  : "Confirmar aplicación"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {coachActionDraft ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Confirmar próximo paso del Coach"
        >
          <div className="modal-dialog mi-agent-coach-action-dialog">
            <h3 className="modal-title">Confirmar cambio comercial</h3>
            <p className="modal-message">
              Revisa y edita la propuesta antes de guardarla en la oportunidad.
            </p>
            <div className="mi-agent-coach-action-form">
              <label>
                Oportunidad
                <select
                  value={coachActionDraft.opportunityId}
                  onChange={(event) =>
                    setCoachActionDraft((current) => ({
                      ...current,
                      opportunityId: event.target.value,
                      contextSnapshot:
                        snapshot.pipeline.opportunities.find(
                          (item) =>
                            Number(item.id) === Number(event.target.value),
                        ) || null,
                    }))
                  }
                >
                  <option value="">Selecciona una oportunidad</option>
                  {snapshot.pipeline.opportunities.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.accountName || "Sin cuenta"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Tipo de registro
                <select
                  value={coachActionDraft.actionType}
                  onChange={(event) =>
                    setCoachActionDraft((current) => ({
                      ...current,
                      actionType: event.target.value,
                    }))
                  }
                >
                  <option value="next_step">Próximo paso</option>
                  <option value="follow_up">Seguimiento</option>
                  <option value="call">Llamada</option>
                  <option value="meeting">Reunión</option>
                  <option value="demo">Demostración</option>
                  <option value="quotation">Cotización</option>
                  <option value="negotiation">Negociación</option>
                  <option value="other">Otra actividad</option>
                </select>
              </label>
              <label>
                Título
                <input
                  value={coachActionDraft.title}
                  onChange={(event) =>
                    setCoachActionDraft((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Estado
                <select
                  value={coachActionDraft.status}
                  onChange={(event) =>
                    setCoachActionDraft((current) => ({
                      ...current,
                      status: event.target.value,
                    }))
                  }
                >
                  <option value="pending">Pendiente</option>
                  <option value="in_progress">En progreso</option>
                  <option value="blocked">Bloqueado</option>
                  <option value="done">Realizado</option>
                </select>
              </label>
              <label>
                Fecha límite
                <input
                  type="date"
                  value={coachActionDraft.dueDate}
                  onChange={(event) =>
                    setCoachActionDraft((current) => ({
                      ...current,
                      dueDate: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Fecha y hora programada
                <input
                  type="datetime-local"
                  value={coachActionDraft.scheduledAt}
                  onChange={(event) =>
                    setCoachActionDraft((current) => ({
                      ...current,
                      scheduledAt: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Prioridad
                <select
                  value={coachActionDraft.priority}
                  onChange={(event) =>
                    setCoachActionDraft((current) => ({
                      ...current,
                      priority: event.target.value,
                    }))
                  }
                >
                  <option value="critical">Crítica</option>
                  <option value="low">Baja</option>
                  <option value="medium">Media</option>
                  <option value="high">Alta</option>
                </select>
              </label>
              <label>
                Criterio de éxito
                <textarea
                  rows={2}
                  value={coachActionDraft.successCriteria}
                  onChange={(event) =>
                    setCoachActionDraft((current) => ({
                      ...current,
                      successCriteria: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Notas
                <textarea
                  rows={2}
                  value={coachActionDraft.notes}
                  onChange={(event) =>
                    setCoachActionDraft((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <div className="modal-buttons">
              <button
                type="button"
                className="btn-secondary"
                onClick={rejectCoachAction}
                disabled={Boolean(creatingActionRank)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={createNextStep}
                disabled={
                  Boolean(creatingActionRank) || !coachActionDraft.title.trim()
                }
              >
                {creatingActionRank
                  ? "Preparando..."
                  : "Continuar en Desarrollo Comercial"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {coachOperationDraft ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Confirmar cambio del Coach"
        >
          <div
            ref={coachDialogRef}
            tabIndex={-1}
            className="modal-dialog mi-agent-coach-action-dialog"
            style={{
              width: "min(820px, calc(100vw - 32px))",
              maxWidth: 820,
              padding: 20,
            }}
          >
            <h3 className="modal-title">
              {coachDraftMissingFields.length
                ? "Completar operación"
                : coachOperationDraft.persistenceStatus === "failed"
                  ? "Corregir operación"
                  : "Confirmar cambio"}
            </h3>
            <p className="modal-message">
              {coachDraftMissingFields.length
                ? "Completa los datos obligatorios antes de continuar al módulo."
                : "Revisa el valor propuesto antes de actualizar el CRM."}
            </p>
            {coachDraftMissingFields.length ? (
              <div
                className="mi-agent-coach-missing-summary"
                role="status"
                aria-live="polite"
              >
                <AlertCircle size={16} aria-hidden="true" />
                <div>
                  <strong>
                    {coachDraftMissingFields.length} campos pendientes
                  </strong>
                  <span>
                    {coachDraftMissingFields
                      .map(formatCoachFieldLabel)
                      .join(", ")}
                  </span>
                </div>
              </div>
            ) : null}
            <div className="mi-agent-coach-action-form">
              <label>
                Operación
                <input
                  value={
                    coachOperationDraft.operation.title ||
                    coachOperationDraft.operation.kind
                  }
                  disabled
                />
              </label>
              {[
                "create_account",
                "create_contact",
                "create_opportunity",
                "create_lead",
                "create_contact_mapping",
                "create_quotation",
                "create_proposal",
                "lead_resolve",
              ].includes(coachOperationDraft.operation.kind) ? (
                <div className="mi-agent-coach-action-form">
                  {(coachOperationDraft.operation.kind === "create_account"
                    ? [
                        "name",
                        "registrationCode",
                        "phone",
                        "website",
                        "city",
                        "stateRegion",
                        "postalCode",
                        "companyDescription",
                      ]
                    : coachOperationDraft.operation.kind === "create_contact"
                      ? [
                          "firstName",
                          "lastName",
                          "email",
                          "phone",
                          "mobile",
                          "positionTitle",
                          "department",
                          "city",
                          "stateRegion",
                        ]
                      : coachOperationDraft.operation.kind ===
                          "create_contact_mapping"
                        ? [
                            "accountId",
                            "firstName",
                            "lastName",
                            "email",
                            "phone",
                            "mobile",
                            "positionTitle",
                            "department",
                            "city",
                            "stateRegion",
                          ]
                        : coachOperationDraft.operation.kind === "create_lead"
                          ? ["title", "leadSource", "summary", "sourceNotes"]
                          : coachOperationDraft.operation.kind ===
                              "create_opportunity"
                            ? ["name", "amountUsd", "closeDate", "summary"]
                            : coachOperationDraft.operation.kind ===
                                "create_quotation"
                              ? [
                                  "proposalName",
                                  "quotationDate",
                                  "introduction",
                                  "paymentTerms",
                                ]
                              : coachOperationDraft.operation.kind ===
                                  "create_proposal"
                                ? [
                                    "quotationVersionId",
                                    "sourceProposalId",
                                    "templateId",
                                  ]
                                : ["summary", "sourceNotes"]
                  ).map((field) => (
                    <label key={field}>
                      {field}
                      {field === "companyDescription" ||
                      field === "summary" ||
                      field === "sourceNotes" ? (
                        <textarea
                          rows={3}
                          value={coachOperationDraft.payload?.[field] || ""}
                          aria-invalid={coachDraftMissingSet.has(field)}
                          onChange={(event) =>
                            updateCoachPayloadField(field, event.target.value)
                          }
                        />
                      ) : (
                        <input
                          type={
                            field === "amountUsd"
                              ? "number"
                              : field === "closeDate"
                                ? "date"
                                : "text"
                          }
                          value={coachOperationDraft.payload?.[field] ?? ""}
                          aria-invalid={coachDraftMissingSet.has(field)}
                          onChange={(event) =>
                            updateCoachPayloadField(field, event.target.value)
                          }
                        />
                      )}
                      {coachDraftMissingSet.has(field) ? (
                        <small className="mi-agent-coach-field-error">
                          Este campo es obligatorio para continuar.
                        </small>
                      ) : null}
                    </label>
                  ))}
                  {coachOperationDraft.error ? (
                    <p className="form-error">{coachOperationDraft.error}</p>
                  ) : null}
                  {coachOperationDraft.duplicateWarnings?.length ? (
                    <div className="mi-agent-coach-duplicate-warning">
                      <strong>
                        Revisa posibles duplicados antes de crear:
                      </strong>
                      <ul>
                        {coachOperationDraft.duplicateWarnings.map(
                          (warning, index) => (
                            <li
                              key={`${warning.matchReason || "duplicate"}-${index}`}
                            >
                              {warning.reasonLabel ||
                                warning.message ||
                                warning.severityMessage ||
                                "Coincidencia detectada"}
                            </li>
                          ),
                        )}
                      </ul>
                      <small>
                        Si ya existe, cancela esta propuesta y selecciona el
                        registro existente desde el contexto del Coach.
                      </small>
                    </div>
                  ) : null}
                </div>
              ) : coachOperationDraft.operation.kind === "activity" ? (
                <div
                  className="mi-agent-coach-action-form"
                  style={{
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: 10,
                  }}
                >
                  <label>
                    Oportunidad
                    <select
                      value={coachOperationDraft.opportunityId}
                      aria-invalid={coachDraftMissingSet.has("opportunityId")}
                      onChange={(event) =>
                        setCoachOperationDraft((current) => ({
                          ...current,
                          opportunityId: event.target.value,
                        }))
                      }
                    >
                      <option value="">Selecciona una oportunidad</option>
                      {(
                        coachOperationOpportunityOptionsOverride ||
                        snapshot.pipeline.opportunities
                      ).map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · {item.accountName || "Sin cuenta"}
                        </option>
                      ))}
                    </select>
                    {coachDraftMissingSet.has("opportunityId") ? (
                      <small className="mi-agent-coach-field-error">
                        Selecciona una oportunidad para continuar.
                      </small>
                    ) : null}
                  </label>
                  {[
                    ["title", "Título"],
                    ["actionType", "Tipo"],
                    ["scheduledAt", "Fecha y hora"],
                    ["dueDate", "Fecha límite"],
                    ["priority", "Prioridad"],
                    ["notes", "Notas"],
                    ["successCriteria", "Criterio de éxito"],
                  ].map(([field, label]) => (
                    <label key={field}>
                      {label}
                      {field === "actionType" ? (
                        <select
                          value={normalizeCoachActivityType(
                            coachOperationDraft.operation[field],
                          )}
                          aria-invalid={coachDraftMissingSet.has(field)}
                          onChange={(event) =>
                            setCoachOperationDraft((current) => ({
                              ...current,
                              operation: {
                                ...current.operation,
                                [field]: event.target.value,
                              },
                            }))
                          }
                        >
                          {COACH_ACTIVITY_TYPE_OPTIONS.map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      ) : field === "priority" ? (
                        <select
                          value={
                            coachOperationDraft.operation[field] || "medium"
                          }
                          aria-invalid={coachDraftMissingSet.has(field)}
                          onChange={(event) =>
                            setCoachOperationDraft((current) => ({
                              ...current,
                              operation: {
                                ...current.operation,
                                [field]: event.target.value,
                              },
                            }))
                          }
                        >
                          <option value="critical">Crítica</option>
                          <option value="high">Alta</option>
                          <option value="medium">Media</option>
                          <option value="low">Baja</option>
                        </select>
                      ) : field === "notes" || field === "successCriteria" ? (
                        <textarea
                          rows={2}
                          value={coachOperationDraft.operation[field] || ""}
                          aria-invalid={coachDraftMissingSet.has(field)}
                          onChange={(event) =>
                            setCoachOperationDraft((current) => ({
                              ...current,
                              operation: {
                                ...current.operation,
                                [field]: event.target.value,
                              },
                            }))
                          }
                        />
                      ) : (
                        <input
                          type={
                            field === "scheduledAt"
                              ? "datetime-local"
                              : field === "dueDate"
                                ? "date"
                                : "text"
                          }
                          value={coachOperationDraft.operation[field] || ""}
                          aria-invalid={coachDraftMissingSet.has(field)}
                          onChange={(event) =>
                            setCoachOperationDraft((current) => ({
                              ...current,
                              operation: {
                                ...current.operation,
                                [field]: event.target.value,
                              },
                            }))
                          }
                        />
                      )}
                      {coachDraftMissingSet.has(field) ? (
                        <small className="mi-agent-coach-field-error">
                          Este campo es obligatorio para continuar.
                        </small>
                      ) : null}
                    </label>
                  ))}
                </div>
              ) : coachOperationDraft.operation.kind === "stage_answer" ||
                coachOperationDraft.operation.kind === "lead_call_outcome" ? (
                <label>
                  {coachOperationDraft.operation.kind === "stage_answer"
                    ? "Respuesta de etapa"
                    : "Comentario del resultado"}
                  <textarea
                    rows={4}
                    value={coachOperationDraft.value}
                    aria-invalid={coachDraftMissingSet.has(
                      coachOperationDraft.operation.kind === "stage_answer"
                        ? "answerValue"
                        : "comment",
                    )}
                    onChange={(event) =>
                      setCoachOperationDraft((current) => ({
                        ...current,
                        value: event.target.value,
                      }))
                    }
                  />
                  {coachDraftMissingSet.has(
                    coachOperationDraft.operation.kind === "stage_answer"
                      ? "answerValue"
                      : "comment",
                  ) ? (
                    <small className="mi-agent-coach-field-error">
                      Este campo es obligatorio para continuar.
                    </small>
                  ) : null}
                </label>
              ) : (
                <div className="mi-agent-coach-action-form">
                  {coachOperationDraft.operation.field ? (
                    <>
                      <label>
                        Campo a actualizar
                        <input
                          value={formatCoachFieldLabel(
                            coachOperationDraft.operation.field,
                          )}
                          disabled
                        />
                      </label>
                      <label>
                        Valor actual
                        <input
                          value={
                            coachOperationDraft.operation.currentValue ??
                            "Sin valor"
                          }
                          disabled
                        />
                      </label>
                    </>
                  ) : null}
                  <label>
                    Nuevo valor
                    <input
                      value={coachOperationDraft.value}
                      aria-invalid={coachDraftMissingSet.has("value")}
                      onChange={(event) =>
                        setCoachOperationDraft((current) => ({
                          ...current,
                          value: event.target.value,
                        }))
                      }
                    />
                    {coachDraftMissingSet.has("value") ? (
                      <small className="mi-agent-coach-field-error">
                        Este campo es obligatorio para continuar.
                      </small>
                    ) : null}
                  </label>
                </div>
              )}
              {coachOperationDraft.operation.kind === "stage_answer" &&
              coachOperationDraft.operation.previousAnswer ? (
                <label>
                  Tratamiento de la respuesta anterior
                  <select
                    value={coachOperationDraft.answerMode}
                    onChange={(event) =>
                      setCoachOperationDraft((current) => ({
                        ...current,
                        answerMode: event.target.value,
                      }))
                    }
                  >
                    <option value="replace">Reemplazar</option>
                    <option value="append">
                      Agregar a la respuesta anterior
                    </option>
                  </select>
                </label>
              ) : null}
              {coachOperationDraft.error ? (
                <p className="form-error" role="alert">
                  {coachOperationDraft.error}
                </p>
              ) : null}
              <p className="mi-agent-coach-save-state" aria-live="polite">
                {savingCoachOperation || coachDraftSaving
                  ? "Guardando y validando la operación..."
                  : coachDraftMissingFields.length
                    ? "La operación permanecerá pendiente hasta completar los campos indicados."
                    : coachOperationDraft.reviewedAt
                      ? "Valor actual revisado. Confirma para guardar."
                      : "Revisa el valor actual antes de confirmar."}
              </p>
            </div>
            <div className="modal-buttons">
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  rejectCoachOperation(coachOperationDraft.operation)
                }
                disabled={savingCoachOperation || coachDraftSaving}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={applyCoachOperation}
                disabled={
                  savingCoachOperation ||
                  coachDraftSaving ||
                  !canExecuteCoach ||
                  coachDraftMissingFields.length > 0 ||
                  (coachOperationDraft.operation.kind === "activity"
                    ? !String(
                        coachOperationDraft.operation.title || "",
                      ).trim() ||
                      !String(
                        coachOperationDraft.operation.scheduledAt || "",
                      ).trim()
                    : [
                          "create_account",
                          "create_contact",
                          "create_opportunity",
                          "create_lead",
                          "create_contact_mapping",
                          "create_quotation",
                          "create_proposal",
                          "lead_resolve",
                        ].includes(coachOperationDraft.operation.kind)
                      ? !Object.keys(coachOperationDraft.payload || {}).length
                      : !String(coachOperationDraft.value || "").trim())
                }
              >
                {savingCoachOperation
                  ? "Preparando..."
                  : COACH_HANDOFF_OPERATION_KINDS.has(
                        coachOperationDraft.operation.kind,
                      )
                    ? "Continuar en el módulo"
                    : coachOperationDraft.reviewedAt
                      ? "Confirmar y guardar"
                      : "Revisar valor actual"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {analysis?.risks?.length ? (
        <section className="mi-agent-risks">
          <div className="mi-agent-section-heading">
            <div>
              <span className="mi-agent-section-label">Señales a vigilar</span>
              <h3>Riesgos principales</h3>
            </div>
          </div>
          <div className="mi-agent-risk-list">
            {analysis.risks.map((risk) => (
              <div key={risk}>!</div>
            ))}
          </div>
          <ul>
            {analysis.risks.map((risk) => (
              <li key={risk}>{risk}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
