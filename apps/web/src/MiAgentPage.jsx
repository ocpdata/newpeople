import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Database,
  Lightbulb,
  Pencil,
  Search,
  X,
} from "lucide-react";
import { api, getApiErrorMessage } from "./api";
import "./mi-agent.css";
import "./mi-agent-detail.css";
import "./mi-agent-execution-kit.css";
import "./mi-agent-health.css";
import "./mi-agent-alerts.css";
import "./mi-agent-activity-progress.css";
import "./mi-agent-activity-message.css";
import "./mi-agent-coach.css";
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

const COACH_POLL_TIMEOUT_MS = 180000;
const COACH_FOUNDATION_VISIBILITY_KEY = "mi-agent-coach-show-foundation";

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

  return {
    period: development.period || dashboard?.period || null,
    quota: {
      assignedAmount: Number(quota.assignedAmount || 0),
      actualAmount: Number(quota.actualAmount || 0),
      gapAmount: Number(quota.gapAmount || 0),
      committedOpenAmount: Number(quota.committedOpenAmount || 0),
      weightedOpenAmount: Number(quota.weightedOpenAmount || 0),
      currencyCode:
        quota.currencyCode ||
        development.period?.baseCurrencyCode ||
        dashboard?.period?.baseCurrencyCode ||
        "USD",
    },
    pipeline: {
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
    summary: dashboard?.summary || {},
  };
}

function buildCoachClarification(result, snapshot) {
  const action = result?.action;
  const unresolvedActivity = Array.isArray(result?.operations)
    ? result.operations.find(
        (operation) =>
          operation?.kind === "activity" && !operation.opportunityId,
      )
    : null;
  if ((!action?.title || action.opportunityId) && !unresolvedActivity)
    return null;
  const candidates = Array.isArray(snapshot?.coachOpportunities)
    ? snapshot.coachOpportunities.slice(0, 8)
    : [];
  return {
    message: "Para registrar esta actividad falta seleccionar la oportunidad.",
    missing: ["Oportunidad", "Fecha completa"],
    candidates,
    activity: {
      title:
        unresolvedActivity?.title || action?.title || "Actividad comercial",
      actionType:
        unresolvedActivity?.actionType || action?.actionType || "meeting",
      scheduledAt: unresolvedActivity?.scheduledAt || action?.scheduledAt || "",
      dueDate: unresolvedActivity?.dueDate || action?.suggestedDueDate || "",
      priority: unresolvedActivity?.priority || action?.priority || "medium",
      notes: unresolvedActivity?.notes || "",
      successCriteria:
        unresolvedActivity?.successCriteria ||
        action?.successCriteria ||
        "Definir el siguiente compromiso del cliente.",
    },
  };
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
  canManageCoach = false,
}) {
  const navigate = useNavigate();
  const [activeWorkspace, setActiveWorkspace] = useState("coach");
  const [dashboard, setDashboard] = useState(null);
  const [coachAccounts, setCoachAccounts] = useState([]);
  const [coachAccountSearch, setCoachAccountSearch] = useState("");
  const [coachOpportunities, setCoachOpportunities] = useState([]);
  const [coachContacts, setCoachContacts] = useState([]);
  const [coachContext, setCoachContext] = useState({
    accountId: "",
    opportunityId: "",
    contactId: "",
    leadId: "",
  });
  const [coachSessionId, setCoachSessionId] = useState(() => {
    const storedSessionId = Number(
      window.localStorage.getItem("mi-agent-coach-session") || 0,
    );
    return storedSessionId || null;
  });
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
  const [coachPendingOperations, setCoachPendingOperations] = useState([]);
  const [coachRecentOperations, setCoachRecentOperations] = useState([]);
  const [coachUndoOperationId, setCoachUndoOperationId] = useState(null);
  const [savingCoachOperation, setSavingCoachOperation] = useState(false);
  const [coachDraftSaving, setCoachDraftSaving] = useState(false);
  const [coachOperationAction, setCoachOperationAction] = useState({});
  const [automaticBriefing, setAutomaticBriefing] = useState(null);
  const [automaticBriefingLoading, setAutomaticBriefingLoading] =
    useState(false);
  const [coachGovernance, setCoachGovernance] = useState(null);
  const [coachGovernanceLoading, setCoachGovernanceLoading] = useState(false);
  const [coachGovernanceSaving, setCoachGovernanceSaving] = useState(false);
  const [customerIntelligenceJob, setCustomerIntelligenceJob] = useState(null);
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
  const [customerChatPublicResearch, setCustomerChatPublicResearch] =
    useState(false);
  const [prospectForm, setProspectForm] = useState({
    companyName: "",
    country: "",
    website: "",
    industry: "",
  });
  const [prospectSession, setProspectSession] = useState(null);
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
    let cancelled = false;
    api
      .get(`/api/mi-agent/coach/sessions/${coachSessionId}`)
      .then(({ data }) => {
        if (cancelled || !data?.session) return;
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
    api
      .get("/api/mi-agent/coach/sessions/active")
      .then(({ data }) => {
        if (!data?.session) return;
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
      .catch(() => undefined);
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
      const accountsResponse = await api.get(
        `/api/accounts?activeOnly=true&search=${encodeURIComponent(coachAccountSearch)}`,
      );
      setCoachAccounts(
        Array.isArray(accountsResponse.data) ? accountsResponse.data : [],
      );
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar tu situación comercial",
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  async function selectCoachAccount(accountId) {
    const normalizedId = String(accountId || "");
    setCoachContext({
      accountId: normalizedId,
      opportunityId: "",
      contactId: "",
      leadId: "",
    });
    setCoachSessionId(null);
    setCoachOpportunities([]);
    setCoachContacts([]);
    setCoachMessages([]);
    setCoachActionDraft(null);
    setCoachOperationDraft(null);
    setCoachPendingOperations([]);
    setCoachRecentOperations([]);
    setCoachNotice("");
    resetCustomerIntelligence();
    if (!normalizedId) return;
    setLoadingCoachContext(true);
    try {
      const [opportunitiesResponse, contactsResponse] = await Promise.all([
        api.get(
          `/api/opportunities?accountId=${normalizedId}&activeOnly=true&openOnly=true`,
        ),
        api.get(
          `/api/contacts?accountId=${normalizedId}&opportunityId=${coachContext.opportunityId || ""}&activeOnly=true`,
        ),
      ]);
      setCoachOpportunities(
        Array.isArray(opportunitiesResponse.data)
          ? opportunitiesResponse.data
          : [],
      );
      setCoachContacts(
        Array.isArray(contactsResponse.data) ? contactsResponse.data : [],
      );
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar el contexto de la cuenta",
        ),
      );
    } finally {
      setLoadingCoachContext(false);
    }
  }

  async function searchCoachAccounts(value) {
    setCoachAccountSearch(value);
    try {
      const response = await api.get(
        `/api/accounts?activeOnly=true&search=${encodeURIComponent(value)}`,
      );
      setCoachAccounts(Array.isArray(response.data) ? response.data : []);
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, "No fue posible buscar cuentas"),
      );
    }
  }

  async function selectCoachOpportunity(opportunityId) {
    setCoachContext((current) => ({
      ...current,
      opportunityId: String(opportunityId || ""),
      contactId: "",
    }));
    setCoachSessionId(null);
    setCoachMessages([]);
    setCoachActionDraft(null);
    setCoachOperationDraft(null);
    setCoachPendingOperations([]);
    setCoachRecentOperations([]);
    setCoachNotice("");
    resetCustomerIntelligence();
    if (opportunityId && coachContext.accountId) {
      const response = await api.get(
        `/api/contacts?accountId=${coachContext.accountId}&opportunityId=${opportunityId}&activeOnly=true`,
      );
      setCoachContacts(
        Array.isArray(response.data) && response.data.length
          ? response.data
          : coachContacts,
      );
    }
  }

  function selectCoachContact(contactId) {
    setCoachContext((current) => ({
      ...current,
      contactId: String(contactId || ""),
    }));
    setCoachSessionId(null);
    setCoachMessages([]);
    setCoachActionDraft(null);
    setCoachOperationDraft(null);
    setCoachPendingOperations([]);
    setCoachRecentOperations([]);
    setCoachNotice("");
    resetCustomerIntelligence();
  }

  useEffect(() => {
    loadDashboard();
    // Dashboard hydration intentionally runs once when the workspace mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (coachAccountSearch !== "") {
        searchCoachAccounts(coachAccountSearch);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [coachAccountSearch]);

  const snapshot = useMemo(() => buildSnapshot(dashboard), [dashboard]);
  const currency = snapshot.quota.currencyCode;
  const coverage = snapshot.quota.gapAmount
    ? snapshot.pipeline.qualifiedAmount / snapshot.quota.gapAmount
    : 0;
  const selectedCoachAccount =
    coachAccounts.find(
      (item) => String(item.id) === String(coachContext.accountId),
    ) || null;
  const selectedCoachOpportunity =
    coachOpportunities.find(
      (item) => String(item.id) === String(coachContext.opportunityId),
    ) || null;
  const selectedCoachContact =
    coachContacts.find(
      (item) => String(item.id) === String(coachContext.contactId),
    ) || null;
  const hasCustomerContext = Boolean(
    coachContext.accountId ||
    coachContext.opportunityId ||
    coachContext.contactId,
  );

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
          accountId: coachContext.accountId
            ? Number(coachContext.accountId)
            : null,
          opportunityId: coachContext.opportunityId
            ? Number(coachContext.opportunityId)
            : null,
          contactId: coachContext.contactId
            ? Number(coachContext.contactId)
            : null,
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
  }, [
    activeWorkspace,
    coachContext.accountId,
    coachContext.opportunityId,
    coachContext.contactId,
    hasCustomerContext,
  ]);

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
    setCustomerChatPublicResearch(false);
  }

  function buildCustomerIntelligencePayload() {
    return {
      accountId: coachContext.accountId ? Number(coachContext.accountId) : null,
      opportunityId: coachContext.opportunityId
        ? Number(coachContext.opportunityId)
        : null,
      contactId: coachContext.contactId ? Number(coachContext.contactId) : null,
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
        "Selecciona una cuenta, oportunidad o contacto para investigar.",
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
        "Selecciona una cuenta, oportunidad o contacto para preparar la llamada.",
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
        "Selecciona una cuenta, oportunidad o contacto para preparar el resumen ejecutivo.",
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
        "Selecciona una cuenta, oportunidad o contacto para ejecutar los agentes.",
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
      const response = await api.post(
        "/api/commercial-intelligence/account-chat/jobs",
        {
          ...buildCustomerIntelligencePayload(),
          question: normalizedQuestion,
          includePublicResearch: customerChatPublicResearch,
        },
      );
      const jobId = Number(response.data?.job?.id || 0);
      if (!jobId) throw new Error("No se pudo iniciar el chat de cuenta");
      let result = null;
      for (let attempt = 0; attempt < 60; attempt += 1) {
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

  function openDiscoveryActivity(nextStep) {
    if (!nextStep?.opportunityId) return;
    openCoachOperationConfirmation({
      kind: "activity",
      opportunityId: nextStep.opportunityId,
      actionType: nextStep.actionType || "call",
      title: nextStep.title || "Seguimiento comercial",
      priority: nextStep.priority || "medium",
      notes: nextStep.notes || "Preparada desde Cliente existente en Mi Coach.",
      successCriteria:
        nextStep.successCriteria || "Obtener siguiente paso confirmado.",
    });
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

  async function convertProspectAccount() {
    if (!prospectSession?.id) return;
    setProspectConverting("account");
    setProspectError("");
    try {
      const response = await api.post(
        `/api/prospect-research/sessions/${prospectSession.id}/convert-to-account`,
        {},
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
        const { data } = await api.get(`/api/mi-agent/coach/jobs/${jobId}`);
        if (data?.job?.status === "completed") {
          if (JSON.stringify(coachContextRef.current) !== contextKey) {
            throw new Error(
              "El contexto cambio mientras se analizaba la pregunta. Vuelve a intentarlo.",
            );
          }
          const inferredOpportunityId = Number(
            data.result?.entities?.opportunityId || 0,
          );
          if (inferredOpportunityId && !requestContext.opportunityId) {
            const inferredOpportunity = snapshot.coachOpportunities.find(
              (opportunity) => Number(opportunity.id) === inferredOpportunityId,
            );
            setCoachContext((current) =>
              current.opportunityId
                ? current
                : {
                    ...current,
                    accountId: String(
                      inferredOpportunity?.account?.id ||
                        inferredOpportunity?.accountId ||
                        current.accountId ||
                        "",
                    ),
                    opportunityId: String(inferredOpportunityId),
                  },
            );
          }
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

  async function loadAutomaticBriefing() {
    setAutomaticBriefingLoading(true);
    setError("");
    setCoachNotice("");
    try {
      const response = await api.get(
        "/api/commercial-intelligence/automatic-briefing/next",
      );
      setAutomaticBriefing(response.data || null);
      if (!response.data?.briefing) {
        setCoachNotice(
          response.data?.message ||
            "No hay actividades próximas para preparar briefing automático.",
        );
      }
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible preparar el briefing automático",
        ),
      );
    } finally {
      setAutomaticBriefingLoading(false);
    }
  }

  async function loadCoachGovernance() {
    setCoachGovernanceLoading(true);
    setError("");
    try {
      const response = await api.get("/api/commercial-intelligence/governance");
      setCoachGovernance(response.data || null);
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
    if (clarification?.activity && candidate?.entityType === "opportunity") {
      openClarifiedCoachActivity(candidate, clarification.activity);
      return;
    }
    const entityType =
      candidate?.entityType ||
      String(clarification?.type || "").replace("select_", "");
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

  async function openCoachOperationConfirmation(operation) {
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
      setCoachOperationDraft((current) =>
        current
          ? {
              ...current,
              version: responseData?.operation?.version || current.version,
              persistenceStatus:
                responseData?.operation?.status || current.persistenceStatus,
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

      <nav
        className="mi-agent-workspace-tabs"
        aria-label="Espacios de Mi Coach"
      >
        <button
          type="button"
          className={activeWorkspace === "coach" ? "is-active" : ""}
          onClick={() => setActiveWorkspace("coach")}
        >
          Coach
        </button>
        <button
          type="button"
          className={activeWorkspace === "customer" ? "is-active" : ""}
          onClick={() => setActiveWorkspace("customer")}
        >
          Cliente existente
        </button>
        <button
          type="button"
          className={activeWorkspace === "prospect" ? "is-active" : ""}
          onClick={() => setActiveWorkspace("prospect")}
        >
          Cuenta nueva
        </button>
        {canManageCoach ? (
          <button
            type="button"
            className={activeWorkspace === "admin" ? "is-active" : ""}
            onClick={() => {
              setActiveWorkspace("admin");
              loadCoachGovernance();
            }}
          >
            Administración
          </button>
        ) : null}
      </nav>

      {activeWorkspace === "coach" ? (
        <>
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
                {formatCurrency(snapshot.quota.actualAmount, currency)}
              </strong>
              <small>
                {snapshot.quota.assignedAmount
                  ? `${Math.round((snapshot.quota.actualAmount / snapshot.quota.assignedAmount) * 100)}% de avance`
                  : "Sin cuota"}
              </small>
            </article>
            <article className="is-alert">
              <span>Brecha</span>
              <strong>
                {formatCurrency(snapshot.quota.gapAmount, currency)}
              </strong>
              <small>Lo que aún falta</small>
            </article>
            <article>
              <span>Pipeline calificado</span>
              <strong>
                {formatCurrency(snapshot.pipeline.qualifiedAmount, currency)}
              </strong>
              <small>
                {snapshot.pipeline.qualifiedCount} oportunidades ·{" "}
                {coverage
                  ? `${coverage.toFixed(1)}x cobertura`
                  : "Sin cobertura"}
              </small>
            </article>
          </div>

          <section className="mi-agent-workspace-panel">
            <div className="mi-agent-section-heading">
              <div>
                <span className="mi-agent-section-label">
                  Briefing automático
                </span>
                <h3>Prepara tu próxima actividad</h3>
              </div>
              <span>
                {automaticBriefing?.briefing ? "Listo" : "Agenda comercial"}
              </span>
            </div>
            <div className="mi-agent-workspace-actions">
              <button
                type="button"
                className="mi-agent-secondary-button"
                onClick={loadAutomaticBriefing}
                disabled={automaticBriefingLoading}
              >
                {automaticBriefingLoading
                  ? "Preparando..."
                  : "Preparar briefing automático"}
              </button>
            </div>
            {automaticBriefing?.briefing ? (
              <div className="mi-agent-discovery-panel">
                <div className="mi-agent-section-heading">
                  <div>
                    <span className="mi-agent-section-label">
                      Próxima actividad
                    </span>
                    <h3>
                      {automaticBriefing.activity?.title ||
                        "Actividad comercial"}
                    </h3>
                  </div>
                  <span>
                    {automaticBriefing.activity?.scheduledAt ||
                      automaticBriefing.activity?.dueDate ||
                      "Sin fecha"}
                  </span>
                </div>
                <p className="mi-agent-customer-summary">
                  {automaticBriefing.summary}
                </p>
                <div className="mi-agent-discovery-grid">
                  <article>
                    <span>Cuenta</span>
                    <p>
                      {automaticBriefing.activity?.accountName || "Sin cuenta"}
                    </p>
                  </article>
                  <article>
                    <span>Oportunidad</span>
                    <p>
                      {automaticBriefing.activity?.opportunityName ||
                        "Sin oportunidad"}
                    </p>
                  </article>
                </div>
                <div className="mi-agent-discovery-columns">
                  <div>
                    <strong>Preguntas</strong>
                    <ul>
                      {(automaticBriefing.briefing.questions || []).map(
                        (item) => (
                          <li key={item}>{item}</li>
                        ),
                      )}
                    </ul>
                  </div>
                  <div>
                    <strong>Riesgos</strong>
                    <ul>
                      {(automaticBriefing.briefing.risks || []).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <strong>Guion</strong>
                    <ul>
                      {(automaticBriefing.briefing.callGuide || []).map(
                        (item) => (
                          <li key={item}>{item}</li>
                        ),
                      )}
                    </ul>
                  </div>
                </div>
                {automaticBriefing.briefing.emailDraft ? (
                  <div className="mi-agent-discovery-email">
                    <strong>Correo sugerido</strong>
                    <span>{automaticBriefing.briefing.emailDraft.subject}</span>
                    <pre>{automaticBriefing.briefing.emailDraft.body}</pre>
                  </div>
                ) : null}
              </div>
            ) : automaticBriefing?.message ? (
              <p className="field-hint">{automaticBriefing.message}</p>
            ) : null}
          </section>

          <section className="mi-agent-coach-panel">
            <div className="mi-agent-section-heading">
              <div>
                <span className="mi-agent-section-label">Coach comercial</span>
                <h3>Pregúntale a tu Coach</h3>
              </div>
              <span>Usa tu contexto real del CRM</span>
            </div>
            <div className="mi-agent-coach-context-heading">
              <div>
                <strong>Contexto de la conversación</strong>
                <small>
                  Limita las respuestas a una cuenta, oportunidad o contacto.
                </small>
              </div>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setCoachContext({
                    accountId: "",
                    opportunityId: "",
                    contactId: "",
                    leadId: "",
                  });
                  setCoachSessionId(null);
                  setCoachOpportunities([]);
                  setCoachContacts([]);
                }}
              >
                <X size={14} aria-hidden="true" />
                Limpiar contexto
              </button>
            </div>
            <div className="mi-agent-coach-context-form">
              <label>
                Buscar cuenta
                <input
                  value={coachAccountSearch}
                  onChange={(event) => searchCoachAccounts(event.target.value)}
                  placeholder="Nombre de la cuenta"
                  disabled={loadingCoachContext}
                />
              </label>
              <label>
                Cuenta activa
                <select
                  value={coachContext.accountId}
                  onChange={(event) => selectCoachAccount(event.target.value)}
                  disabled={loadingCoachContext}
                >
                  <option value="">Selecciona una cuenta</option>
                  {coachAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Oportunidad activa
                <select
                  value={coachContext.opportunityId}
                  onChange={(event) =>
                    selectCoachOpportunity(event.target.value)
                  }
                  disabled={!coachContext.accountId || loadingCoachContext}
                >
                  <option value="">
                    {loadingCoachContext
                      ? "Cargando oportunidades..."
                      : coachContext.accountId && !coachOpportunities.length
                        ? "Sin oportunidades activas"
                        : "Selecciona una oportunidad"}
                  </option>
                  {coachOpportunities.map((opportunity) => (
                    <option key={opportunity.id} value={opportunity.id}>
                      {opportunity.name} ·{" "}
                      {opportunity.sales_stage ||
                        opportunity.stage_name ||
                        "Sin etapa"}{" "}
                      ·{" "}
                      {formatCurrency(
                        opportunity.amount_usd ?? opportunity.amountUsd,
                        "USD",
                      )}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Contacto
                <select
                  value={coachContext.contactId}
                  onChange={(event) => selectCoachContact(event.target.value)}
                  disabled={!coachContext.accountId || loadingCoachContext}
                >
                  <option value="">
                    {loadingCoachContext
                      ? "Cargando contactos..."
                      : coachContext.accountId && !coachContacts.length
                        ? "Sin contactos activos"
                        : "Selecciona un contacto"}
                  </option>
                  {coachContacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.full_name ||
                        `${contact.first_name || ""} ${contact.last_name || ""}`.trim()}{" "}
                      · {contact.position_title || "Sin cargo"}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {coachContext.accountId ? (
              <div className="mi-agent-coach-context-summary">
                <strong>Contexto aplicado</strong>
                <span>
                  {coachAccounts.find(
                    (item) =>
                      String(item.id) === String(coachContext.accountId),
                  )?.name || "Cuenta seleccionada"}
                </span>
                {coachContext.opportunityId ? (
                  <span>
                    {coachOpportunities.find(
                      (item) =>
                        String(item.id) === String(coachContext.opportunityId),
                    )?.name || "Oportunidad seleccionada"}
                  </span>
                ) : null}
                {coachContext.contactId ? (
                  <span>
                    {coachContacts.find(
                      (item) =>
                        String(item.id) === String(coachContext.contactId),
                    )?.full_name || "Contacto seleccionado"}
                  </span>
                ) : null}
              </div>
            ) : null}
            {coachContext.accountId &&
            !loadingCoachContext &&
            (!coachOpportunities.length || !coachContacts.length) ? (
              <div className="mi-agent-coach-context-notices">
                {!coachOpportunities.length ? (
                  <span>Sin oportunidades activas y abiertas.</span>
                ) : null}
                {!coachContacts.length ? (
                  <span>Sin contactos activos.</span>
                ) : null}
              </div>
            ) : null}
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
                          "¿Qué oportunidades activas tiene esta cuenta?",
                        )
                      }
                    >
                      ¿Qué oportunidades tiene?
                    </button>
                    <button
                      type="button"
                      disabled={askingCoach}
                      onClick={() =>
                        askCoach(
                          "¿Qué contactos importantes tiene esta cuenta?",
                        )
                      }
                    >
                      ¿Qué contactos tiene?
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={askingCoach}
                      onClick={() => askCoach("¿Cómo voy este mes?")}
                    >
                      ¿Cómo voy este mes?
                    </button>
                    <button
                      type="button"
                      disabled={askingCoach}
                      onClick={() =>
                        askCoach(
                          "¿Qué oportunidades tienen riesgo de perderse?",
                        )
                      }
                    >
                      ¿Qué está en riesgo?
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
              .filter(
                (message) =>
                  message.result &&
                  (message.result.clarification ||
                    buildCoachClarification(message.result, snapshot)),
              )
              .slice(-1)
              .map((message) => {
                const clarification =
                  message.result.clarification ||
                  buildCoachClarification(message.result, snapshot);
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
                          key={`${candidate.entityType || clarification.type}-${candidate.id}`}
                          onClick={() =>
                            applyCoachClarification(candidate, clarification)
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
                    Retoma las acciones que iniciaste o descarta las que ya no
                    necesitas.
                  </small>
                </div>
                <div className="mi-agent-coach-pending-list">
                  {coachPendingOperations.map((persistedOperation) => {
                    const statusMeta =
                      COACH_OPERATION_STATUS_META[persistedOperation.status] ||
                      COACH_OPERATION_STATUS_META.proposed;
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
                    const handoffExpiresAt = persistedOperation.handoffExpiresAt
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
                              <span>Falta completar antes de continuar:</span>
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
                                cancelPendingCoachOperation(persistedOperation)
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
                        <strong>{formatCoachOperationLabel(operation)}</strong>
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
                          <CoachStageReadiness
                            readiness={message.result?.stageReadiness}
                          />
                          {showCoachFoundation ? (
                            <CoachSemanticSections result={message.result} />
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
                                          : operation.kind === "create_account"
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
                                      openCoachOperationConfirmation(operation)
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
                                Acción sugerida: {message.result.action.title}
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

          {!analysis ? (
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
                        <span>Oportunidades que progresaron</span>
                        <strong>
                          {analysis.activityProgress.progressedOpportunities}
                        </strong>
                        <small>Con cambio comercial en el período</small>
                      </article>
                      <article
                        className={
                          analysis.activityProgress.opportunitiesWithoutProgress
                            ? "is-alert"
                            : ""
                        }
                      >
                        <span>Actividad sin avance</span>
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
                          Oportunidades con actividad pero sin progreso
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
                                  {item.activityCount} actividades · falta
                                  confirmar evidencia comercial
                                </small>
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
                        <button
                          type="button"
                          key={`${action.rank}-${action.opportunityId || action.title}`}
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
                            {ACTION_STATUS_LABELS[action.status] || "Pendiente"}
                          </span>
                        </button>
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
                      {selectedAction.executionKit?.knownInformation?.length ? (
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
                        Tienes acceso de lectura. Solicita permiso de ejecución
                        y Desarrollo Comercial para preparar el próximo paso.
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
          )}
        </>
      ) : activeWorkspace === "customer" ? (
        <section className="mi-agent-workspace-panel">
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
            <div>
              <strong>
                {selectedCoachAccount?.name ||
                  "Selecciona una cuenta en la pestaña Coach"}
              </strong>
              <span>
                {selectedCoachOpportunity
                  ? selectedCoachOpportunity.name
                  : "Sin oportunidad seleccionada"}
              </span>
              <span>
                {selectedCoachContact
                  ? selectedCoachContact.full_name ||
                    `${selectedCoachContact.first_name || ""} ${selectedCoachContact.last_name || ""}`.trim()
                  : "Sin contacto seleccionado"}
              </span>
            </div>
            <button
              type="button"
              className="mi-agent-secondary-button"
              onClick={() => setActiveWorkspace("coach")}
            >
              Cambiar contexto
            </button>
          </div>
          {customerIntelligenceError ? (
            <p className="form-error">{customerIntelligenceError}</p>
          ) : null}
          <section className="mi-agent-coach-panel" aria-label="Chat de cuenta">
            <div className="mi-agent-section-heading">
              <div>
                <span className="mi-agent-section-label">Chat de cuenta</span>
                <h3>Pregúntale sobre esta cuenta</h3>
              </div>
              <span>Contexto separado de Coach</span>
            </div>
            <div className="mi-agent-coach-suggestions">
              <button
                type="button"
                onClick={() =>
                  askCustomerChat("Resume esta cuenta para mi reunión.")
                }
                disabled={customerChatLoading || !hasCustomerContext}
              >
                Resumen para reunión
              </button>
              <button
                type="button"
                onClick={() => askCustomerChat("¿Qué riesgos debo atender?")}
                disabled={customerChatLoading || !hasCustomerContext}
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
                      <h4>{message.answer}</h4>
                      {message.evidence?.length ? (
                        <ul>
                          {message.evidence.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      ) : null}
                      {message.publicSources?.length ? (
                        <p>
                          <strong>Fuentes públicas:</strong>{" "}
                          {message.publicSources.length}
                        </p>
                      ) : null}
                      {message.agents?.length ? (
                        <small>
                          Agentes:{" "}
                          {message.agents
                            .map((agent) => agent.agentId)
                            .join(", ")}
                        </small>
                      ) : null}
                      {message.recommendedActions?.length ? (
                        <p>
                          <strong>Acción sugerida:</strong>{" "}
                          {message.recommendedActions[0].title} (requiere
                          confirmación)
                        </p>
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
                      <p>{signal.summary}</p>
                      <blockquote>{signal.evidence}</blockquote>
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
          {customerSnapshot &&
          (customerSnapshot.products?.length ||
            customerSnapshot.renewals?.length) ? (
            <section
              className="mi-agent-discovery-panel"
              aria-label="Productos y renovaciones"
            >
              <div className="mi-agent-section-heading">
                <div>
                  <span className="mi-agent-section-label">
                    Historial comercial
                  </span>
                  <h3>Productos y renovaciones</h3>
                </div>
                <span>{customerSnapshot.products?.length || 0} productos</span>
              </div>
              {customerSnapshot.products?.length ? (
                <div className="mi-agent-discovery-columns">
                  <div>
                    <strong>Productos cotizados y ganados</strong>
                    <ul>
                      {customerSnapshot.products.slice(0, 10).map((product) => (
                        <li
                          key={`${product.quotationVersionId}-${product.productCode}-${product.description}`}
                        >
                          {product.description} · {product.commercialStatus} ·{" "}
                          {product.fulfillmentStatus}
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
                          {renewal.providerName} · {renewal.statusCode} · vence{" "}
                          {renewal.expiresAt || "sin fecha"}
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
                        <span>{hypothesis.type}</span>
                        <strong>{hypothesis.title}</strong>
                        <p>
                          {hypothesis.summary} {hypothesis.evidence}
                        </p>
                      </div>
                      {hypothesis.opportunityId &&
                      canUpdateCommercialDevelopment ? (
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
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
          <div className="mi-agent-workspace-actions">
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
              Selecciona una cuenta, oportunidad o contacto desde la pestaña
              Coach para iniciar la investigación interna.
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
                  <span className="mi-agent-section-label">Orquestación</span>
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
                      {agent.findings?.length || 0} hallazgos · confianza{" "}
                      {agent.confidence}
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
                disabled={prospectPreparing}
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
                disabled={prospectPreparing}
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
                disabled={prospectPreparing}
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
                disabled={prospectPreparing}
              />
            </label>
          </div>
          <div className="mi-agent-workspace-actions">
            <button
              type="button"
              className="mi-agent-primary-button"
              onClick={prepareProspectAccount}
              disabled={prospectPreparing}
            >
              {prospectPreparing ? "Preparando..." : "Preparar cuenta"}
            </button>
            {canUseExternalSources && prospectSession ? (
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
              <div className="mi-agent-prospect-conversion-actions">
                <button
                  type="button"
                  className="mi-agent-primary-button"
                  onClick={convertProspectAccount}
                  disabled={
                    !canCreateAccounts ||
                    prospectConverting === "account" ||
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
                      : "Crear cuenta"}
                </button>
                <button
                  type="button"
                  className="mi-agent-secondary-button"
                  onClick={convertProspectLead}
                  disabled={
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
                        </span>
                        <span>Certeza: {finding.certainty}</span>
                        <span>
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
                        <p>
                          Confianza:{" "}
                          {CUSTOMER_FINDING_CONFIDENCE_LABELS[
                            contact.confidence
                          ] || contact.confidence}
                        </p>
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
                        <p>{hypothesis.businessChallenge}</p>
                        <small>{hypothesis.validationQuestion}</small>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => convertProspectOpportunity(hypothesis)}
                          disabled={
                            !canCreateOpportunities ||
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
                          dailyResearchLimitPerUser: Number(event.target.value),
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
                      {snapshot.pipeline.opportunities.map((item) => (
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
                    : "La operación está lista para continuar."}
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
                    : "Confirmar y guardar"}
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
