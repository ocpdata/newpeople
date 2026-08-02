import { useEffect, useMemo, useState } from "react";
import { api, getApiErrorMessage } from "../api";

const AUDIT_ACTION_LABELS = {
  created: "Creación",
  updated: "Actualización",
  status_changed: "Cambio de estado",
  permissions_updated: "Permisos actualizados",
  roles_assigned: "Roles asignados",
  password_reset_sent: "Reset enviado",
  password_reset_failed: "Reset fallido",
  invitation_email_failed: "Invitación fallida",
  register_first: "Registro inicial",
  login_success: "Login exitoso",
  login_failed: "Login fallido",
  password_set: "Contraseña configurada",
  set_password_failed: "Contraseña fallida",
  analyzed: "Análisis IA de lead",
  stage_answer_suggestions_generated: "Sugerencias IA generadas",
  stage_answer_suggestions_reused: "Sugerencias IA reutilizadas",
  ai_usage_recorded: "Interacción IA registrada",
};

const AUDIT_ENTITY_LABELS = {
  user: "Usuario",
  role: "Rol",
  account: "Cuenta",
  contact: "Contacto",
  opportunity: "Oportunidad",
  interaction: "Lead",
  ai_usage: "Uso IA",
};

const AUDIT_AI_FEATURE_LABELS = {
  "accounts.draft_analysis": "Análisis de cuenta",
  "chatbot.assistant": "Chatbot",
  "chatbot.planner": "Chatbot: planeación",
  "chatbot.resolver": "Chatbot: resolución",
  "chatbot.answerer": "Chatbot: respuesta",
  "commercial_enablement.intake_prefill": "Biblioteca comercial: prellenado",
  "commercial_enablement.intake_summary": "Biblioteca comercial: resumen",
  "commercial_enablement.intake_structured_analysis":
    "Biblioteca comercial: análisis",
  "contacts.duplicate_review": "Revisión de duplicados de contacto",
  "interactions.analysis": "Análisis de lead",
  "interactions.email_suggestion": "Sugerencia de correo para lead",
  "opportunities.documents.analysis": "Análisis de documento de oportunidad",
  "opportunities.documents.ocr": "OCR de documento de oportunidad",
  "opportunities.documents.transcription":
    "Transcripción de documento de oportunidad",
  "opportunities.stage_suggestions": "Sugerencias de proceso comercial",
  "quotations.documents.provider_import_preview":
    "Importación asistida de cotización",
};

function buildQuery(params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (String(value).trim() === "") return;
    search.set(key, String(value));
  });
  return search.toString();
}

export function formatAuditDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("es-MX", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function summarizeAuditChanges(entry) {
  if (
    [
      "stage_answer_suggestions_generated",
      "stage_answer_suggestions_reused",
      "ai_usage_recorded",
    ].includes(String(entry?.action || ""))
  ) {
    return "No modificó datos";
  }

  const changed = entry.changed_fields;
  if (!changed || typeof changed !== "object") return "-";
  const fields = Object.keys(changed);
  if (!fields.length) return "-";
  return fields.slice(0, 4).join(", ") + (fields.length > 4 ? "..." : "");
}

export function formatAuditAiUsage(entry) {
  if (!entry?.ai_used) return "-";
  const tokens = Number(entry.ai_total_tokens || 0);
  const tokenText =
    tokens > 0 ? `${tokens.toLocaleString("es-MX")} tokens` : "Usó IA";
  if (!entry.ai_cost_visible) return tokenText;
  const cost = Number(entry.ai_total_cost_usd || 0);
  return `${cost.toLocaleString("es-MX", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  })} · ${tokenText}`;
}

export function summarizeAuditAiContext(entry) {
  if (!entry?.ai_used) return "";
  const featureCodes = Array.isArray(entry.ai_feature_codes)
    ? entry.ai_feature_codes.map(
        (featureCode) =>
          AUDIT_AI_FEATURE_LABELS[featureCode] || String(featureCode || ""),
      )
    : [];
  const models = Array.isArray(entry.ai_models) ? entry.ai_models : [];
  return [...featureCodes, ...models].slice(0, 3).join(" · ");
}

export function formatAuditModuleLabel(value) {
  if (value === "interacciones") {
    return "Leads";
  }
  if (value === "oportunidades") {
    return "Oportunidades";
  }
  const moduleLabels = {
    biblioteca_comercial: "Biblioteca comercial",
    chatbot: "Chatbot",
    contactos: "Contactos",
    cotizaciones: "Cotizaciones",
    cuentas: "Cuentas",
    ejecucion_comercial: "Ejecución comercial",
    ia: "IA",
    landing: "Landing",
    propuestas: "Propuestas",
  };
  if (moduleLabels[value]) {
    return moduleLabels[value];
  }
  return value || "-";
}

export function formatAuditActionLabel(value) {
  return AUDIT_ACTION_LABELS[value] || value || "-";
}

export function formatAuditEntityLabel(entry) {
  const entityType = String(entry?.entity_type || "");
  const label = AUDIT_ENTITY_LABELS[entityType] || entityType || "Entidad";
  if (entry?.entity_name) {
    return `${label}: ${entry.entity_name}`;
  }
  if (entry?.entity_id) {
    return `${label} #${entry.entity_id}`;
  }
  return label;
}

const DEFAULT_FILTERS = {
  page: 1,
  pageSize: 50,
  from: "",
  to: "",
  module: "",
  action: "",
  entityType: "",
  status: "",
  aiUsage: "",
  q: "",
};

const AUDIT_MODULE_OPTIONS = [
  { value: "", label: "Todos los módulos" },
  { value: "auth", label: "Auth" },
  { value: "usuarios", label: "Usuarios" },
  { value: "roles", label: "Roles" },
  { value: "cuentas", label: "Cuentas" },
  { value: "interacciones", label: "Leads" },
  { value: "oportunidades", label: "Oportunidades" },
  { value: "contactos", label: "Contactos" },
];

const AUDIT_ACTION_OPTIONS = [
  { value: "", label: "Todas las acciones" },
  { value: "created", label: AUDIT_ACTION_LABELS.created },
  { value: "updated", label: AUDIT_ACTION_LABELS.updated },
  { value: "status_changed", label: AUDIT_ACTION_LABELS.status_changed },
  {
    value: "stage_answer_suggestions_generated",
    label: AUDIT_ACTION_LABELS.stage_answer_suggestions_generated,
  },
  {
    value: "stage_answer_suggestions_reused",
    label: AUDIT_ACTION_LABELS.stage_answer_suggestions_reused,
  },
  { value: "ai_usage_recorded", label: AUDIT_ACTION_LABELS.ai_usage_recorded },
  { value: "analyzed", label: AUDIT_ACTION_LABELS.analyzed },
  {
    value: "permissions_updated",
    label: AUDIT_ACTION_LABELS.permissions_updated,
  },
  { value: "roles_assigned", label: AUDIT_ACTION_LABELS.roles_assigned },
  {
    value: "password_reset_sent",
    label: AUDIT_ACTION_LABELS.password_reset_sent,
  },
  {
    value: "password_reset_failed",
    label: AUDIT_ACTION_LABELS.password_reset_failed,
  },
  {
    value: "invitation_email_failed",
    label: AUDIT_ACTION_LABELS.invitation_email_failed,
  },
  { value: "register_first", label: AUDIT_ACTION_LABELS.register_first },
  { value: "login_success", label: AUDIT_ACTION_LABELS.login_success },
  { value: "login_failed", label: AUDIT_ACTION_LABELS.login_failed },
  { value: "password_set", label: AUDIT_ACTION_LABELS.password_set },
  {
    value: "set_password_failed",
    label: AUDIT_ACTION_LABELS.set_password_failed,
  },
];

const AUDIT_ENTITY_OPTIONS = [
  { value: "", label: "Todas las entidades" },
  { value: "user", label: "Usuario" },
  { value: "role", label: "Rol" },
  { value: "account", label: "Cuenta" },
  { value: "contact", label: "Contacto" },
  { value: "opportunity", label: "Oportunidad" },
];

const AUDIT_STATUS_OPTIONS = [
  { value: "", label: "Todos", tone: "all" },
  { value: "success", label: "Exito", tone: "success" },
  { value: "error", label: "Error", tone: "error" },
];

const AUDIT_AI_USAGE_OPTIONS = [
  { value: "", label: "Todo uso IA" },
  { value: "with_ai", label: "Con IA" },
  { value: "without_ai", label: "Sin IA" },
];

export function useSystemAuditPage() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [debouncedQuery, setDebouncedQuery] = useState(DEFAULT_FILTERS.q);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedQuery(filters.q);
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [filters.q]);

  const appliedFilters = useMemo(
    () => ({
      page: filters.page,
      pageSize: filters.pageSize,
      from: filters.from,
      to: filters.to,
      module: filters.module,
      action: filters.action,
      entityType: filters.entityType,
      status: filters.status,
      aiUsage: filters.aiUsage,
      q: debouncedQuery,
    }),
    [
      filters.page,
      filters.pageSize,
      filters.from,
      filters.to,
      filters.module,
      filters.action,
      filters.entityType,
      filters.status,
      filters.aiUsage,
      debouncedQuery,
    ],
  );

  useEffect(() => {
    let cancelled = false;

    async function syncAudit() {
      setLoading(true);
      setError("");
      try {
        const qs = buildQuery(appliedFilters);
        const { data } = await api.get(`/api/audit${qs ? `?${qs}` : ""}`);
        if (cancelled) return;
        setItems(data.items || []);
        setTotal(Number(data.total || 0));
        setTotalPages(Number(data.totalPages || 1));
      } catch (err) {
        if (!cancelled) {
          setError(getApiErrorMessage(err, "No fue posible cargar auditoria"));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void syncAudit();

    return () => {
      cancelled = true;
    };
  }, [appliedFilters]);

  function updateFilter(field, value) {
    setFilters((prev) => ({
      ...prev,
      [field]: value,
      page: field === "page" || field === "pageSize" ? prev.page : 1,
    }));
  }

  function changePage(nextPage) {
    const safePage = Math.max(1, Math.min(totalPages, nextPage));
    setFilters((prev) => ({ ...prev, page: safePage }));
  }

  function changePageSize(pageSize) {
    setFilters((prev) => ({ ...prev, page: 1, pageSize }));
  }

  const startItem = total === 0 ? 0 : (filters.page - 1) * filters.pageSize + 1;
  const endItem =
    total === 0 ? 0 : Math.min(filters.page * filters.pageSize, total);
  const activeAuditFilterCount = [
    filters.q,
    filters.module,
    filters.action,
    filters.entityType,
    filters.status,
    filters.aiUsage,
    filters.from,
    filters.to,
  ].filter((value) => String(value || "").trim() !== "").length;

  return {
    items,
    error,
    loading,
    total,
    totalPages,
    filters,
    startItem,
    endItem,
    activeAuditFilterCount,
    auditModuleOptions: AUDIT_MODULE_OPTIONS,
    auditActionOptions: AUDIT_ACTION_OPTIONS,
    auditEntityOptions: AUDIT_ENTITY_OPTIONS,
    auditStatusOptions: AUDIT_STATUS_OPTIONS,
    auditAiUsageOptions: AUDIT_AI_USAGE_OPTIONS,
    updateFilter,
    changePage,
    changePageSize,
  };
}
