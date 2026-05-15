import { useEffect, useMemo, useState } from "react";
import { api, getApiErrorMessage } from "../api";

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
  const changed = entry.changed_fields;
  if (!changed || typeof changed !== "object") return "-";
  const fields = Object.keys(changed);
  if (!fields.length) return "-";
  return fields.slice(0, 4).join(", ") + (fields.length > 4 ? "..." : "");
}

export function formatAuditModuleLabel(value) {
  if (value === "interacciones") {
    return "Leads";
  }
  return value || "-";
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
  q: "",
};

const AUDIT_MODULE_OPTIONS = [
  { value: "", label: "Todos los modulos" },
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
  { value: "created", label: "Creacion" },
  { value: "updated", label: "Actualizacion" },
  { value: "status_changed", label: "Cambio de estado" },
  { value: "permissions_updated", label: "Permisos actualizados" },
  { value: "roles_assigned", label: "Roles asignados" },
  { value: "password_reset_sent", label: "Reset enviado" },
  { value: "password_reset_failed", label: "Reset fallido" },
  { value: "invitation_email_failed", label: "Invitacion fallida" },
  { value: "register_first", label: "Registro inicial" },
  { value: "login_success", label: "Login exitoso" },
  { value: "login_failed", label: "Login fallido" },
  { value: "password_set", label: "Contrasena configurada" },
  { value: "set_password_failed", label: "Contrasena fallida" },
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
    updateFilter,
    changePage,
    changePageSize,
  };
}
