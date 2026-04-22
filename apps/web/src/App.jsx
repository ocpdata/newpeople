import { useEffect, useMemo, useState } from "react";
import DatePicker from "react-datepicker";
import { es } from "date-fns/locale";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { api, getApiErrorMessage, setAuthToken } from "./api";
import OpportunityQuestionAdminPage from "./OpportunityQuestionAdminPage";

const DEFAULT_STATUS_FILTER = "active";
const VALID_STATUS_FILTERS = new Set(["active", "pending", "inactive", "all"]);

function readStoredStatusFilter(storageKey) {
  if (typeof window === "undefined") return DEFAULT_STATUS_FILTER;
  const storedValue = window.localStorage.getItem(storageKey);
  return VALID_STATUS_FILTERS.has(storedValue)
    ? storedValue
    : DEFAULT_STATUS_FILTER;
}

function usePersistedStatusFilter(storageKey) {
  const [statusFilter, setStatusFilter] = useState(() =>
    readStoredStatusFilter(storageKey),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, statusFilter);
  }, [storageKey, statusFilter]);

  return [statusFilter, setStatusFilter];
}

function parseDateFilterValue(value) {
  if (!value) return null;
  const [year, month, day] = String(value)
    .split("-")
    .map((part) => Number(part));
  if (!year || !month || !day) return null;
  const parsedDate = new Date(year, month - 1, day);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function formatDateFilterValue(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "";
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function App() {
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [hasUsers, setHasUsers] = useState(true);
  const [token, setToken] = useState(localStorage.getItem("crm_token") || "");
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    boot();
  }, []);

  useEffect(() => {
    setAuthToken(token);
    if (token) {
      localStorage.setItem("crm_token", token);
      fetchMe();
    } else {
      localStorage.removeItem("crm_token");
      setCurrentUser(null);
    }
  }, [token]);

  async function boot() {
    try {
      const { data } = await api.get("/api/auth/bootstrap-status");
      setHasUsers(data.hasUsers);
    } catch {
      setHasUsers(true);
    } finally {
      setLoading(false);
    }
  }

  async function fetchMe() {
    try {
      const { data } = await api.get("/api/auth/me");
      setCurrentUser(data);
    } catch {
      setToken("");
    }
  }

  if (location.pathname === "/set-password") {
    return <SetPasswordPage onDone={setToken} />;
  }

  if (loading) return <div className="centered">Cargando...</div>;

  if (!hasUsers) {
    return (
      <FirstUserSetup
        onDone={(tkn) => {
          setHasUsers(true);
          setToken(tkn);
        }}
      />
    );
  }

  if (!token || !currentUser) {
    return <LoginPage onLogin={setToken} />;
  }

  return (
    <Shell
      currentUser={currentUser}
      token={token}
      onLogout={() => setToken("")}
      onRefreshCurrentUser={fetchMe}
    />
  );
}

function getUserInitials(fullName) {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (!parts.length) return "U";
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

function UserAvatar({ src, fullName, size = "md" }) {
  if (src) {
    return (
      <img
        src={src}
        alt={`Avatar de ${fullName || "usuario"}`}
        className={`user-avatar user-avatar-${size}`}
      />
    );
  }

  return (
    <div className={`user-avatar user-avatar-${size} user-avatar-fallback`}>
      {getUserInitials(fullName)}
    </div>
  );
}

function Shell({ currentUser, token, onLogout, onRefreshCurrentUser }) {
  const can = useMemo(() => {
    const set = new Set(currentUser.permissions || []);
    const isAdmin = (currentUser.roles || []).some(
      (r) => String(r.name).toLowerCase() === "administrador",
    );
    return (permission) => isAdmin || set.has(permission);
  }, [currentUser]);

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>NewPeople CRM</h1>
        <nav>
          <NavLink to="/">Dashboard</NavLink>
          {can("usuarios.read") && <NavLink to="/users">Usuarios</NavLink>}
          {can("roles.read") && <NavLink to="/roles">Roles</NavLink>}
          {can("cuentas.read") && <NavLink to="/accounts">Cuentas</NavLink>}
          {can("oportunidades.read") && (
            <NavLink to="/opportunities" end>
              Oportunidades
            </NavLink>
          )}
          {can("oportunidades.update") && (
            <NavLink to="/opportunities/questions">
              Preguntas comerciales
            </NavLink>
          )}
          {can("contactos.read") && <NavLink to="/contacts">Contactos</NavLink>}
          {can("audit.read") && <NavLink to="/audit">Auditoria</NavLink>}
        </nav>
        <button className="logout" onClick={onLogout}>
          Salir
        </button>
      </aside>
      <main className="content">
        <header className="topbar">
          <div className="topbar-user">
            <UserAvatar
              src={currentUser.avatar_url}
              fullName={currentUser.full_name}
              size="lg"
            />
            <div>
              <strong>{currentUser.full_name}</strong>
              <p>{currentUser.email}</p>
            </div>
          </div>
        </header>

        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route
            path="/users"
            element={
              can("usuarios.read") ? (
                <UsersPage can={can} />
              ) : (
                <Navigate to="/" />
              )
            }
          />
          <Route
            path="/roles"
            element={
              can("roles.read") ? (
                <RolesPage
                  can={can}
                  onRefreshCurrentUser={onRefreshCurrentUser}
                />
              ) : (
                <Navigate to="/" />
              )
            }
          />
          <Route
            path="/accounts"
            element={
              can("cuentas.read") ? (
                <AccountsPage
                  can={can}
                  currentUser={currentUser}
                  token={token}
                />
              ) : (
                <Navigate to="/" />
              )
            }
          />
          <Route
            path="/opportunities/questions"
            element={
              can("oportunidades.update") ? (
                <OpportunityQuestionAdminPage />
              ) : (
                <Navigate to="/" />
              )
            }
          />
          <Route
            path="/opportunities"
            element={
              can("oportunidades.read") ? (
                <OpportunitiesPage can={can} currentUser={currentUser} />
              ) : (
                <Navigate to="/" />
              )
            }
          />
          <Route
            path="/contacts"
            element={
              can("contactos.read") ? (
                <ContactsPage
                  can={can}
                  token={token}
                  currentUser={currentUser}
                />
              ) : (
                <Navigate to="/" />
              )
            }
          />
          <Route
            path="/audit"
            element={
              can("audit.read") ? <SystemAuditPage /> : <Navigate to="/" />
            }
          />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}

function SystemAuditPage() {
  const defaultFilters = {
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
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [filters, setFilters] = useState(defaultFilters);
  const [debouncedQuery, setDebouncedQuery] = useState(defaultFilters.q);
  const auditModuleOptions = [
    { value: "", label: "Todos los modulos" },
    { value: "auth", label: "Auth" },
    { value: "usuarios", label: "Usuarios" },
    { value: "roles", label: "Roles" },
    { value: "cuentas", label: "Cuentas" },
    { value: "oportunidades", label: "Oportunidades" },
    { value: "contactos", label: "Contactos" },
  ];
  const auditActionOptions = [
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
  const auditEntityOptions = [
    { value: "", label: "Todas las entidades" },
    { value: "user", label: "Usuario" },
    { value: "role", label: "Rol" },
    { value: "account", label: "Cuenta" },
    { value: "contact", label: "Contacto" },
    { value: "opportunity", label: "Oportunidad" },
  ];

  function buildQuery(params) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      if (String(value).trim() === "") return;
      search.set(key, String(value));
    });
    return search.toString();
  }

  async function load(nextFilters = filters) {
    setLoading(true);
    setError("");
    try {
      const qs = buildQuery(nextFilters);
      const { data } = await api.get(`/api/audit${qs ? `?${qs}` : ""}`);
      setItems(data.items || []);
      setTotal(Number(data.total || 0));
      setTotalPages(Number(data.totalPages || 1));
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible cargar auditoria"));
    } finally {
      setLoading(false);
    }
  }

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
    load(appliedFilters);
  }, [appliedFilters]);

  function formatDateTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString("es-MX", {
      dateStyle: "short",
      timeStyle: "short",
    });
  }

  function summarizeChanges(entry) {
    const changed = entry.changed_fields;
    if (!changed || typeof changed !== "object") return "-";
    const fields = Object.keys(changed);
    if (!fields.length) return "-";
    return fields.slice(0, 4).join(", ") + (fields.length > 4 ? "..." : "");
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

  return (
    <section className="panel">
      <div className="audit-toolbar">
        <div className="users-header-row audit-header-row">
          <div className="roles-page-header-left">
            <div className="module-title-with-icon">
              <h2>Auditoria del sistema</h2>
              <span
                className="module-title-icon audit-module-title-icon"
                aria-hidden="true"
              >
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M5.75 3h8.19a2.75 2.75 0 0 1 1.94.8l2.52 2.52a2.75 2.75 0 0 1 .8 1.95v10.98A2.75 2.75 0 0 1 16.45 22h-10.7A2.75 2.75 0 0 1 3 19.25V5.75A2.75 2.75 0 0 1 5.75 3m0 1.5c-.69 0-1.25.56-1.25 1.25v13.5c0 .69.56 1.25 1.25 1.25h10.7c.69 0 1.25-.56 1.25-1.25V8.5h-2.95A2.75 2.75 0 0 1 12 5.75V4.5zm7.75.31v.94c0 .69.56 1.25 1.25 1.25h.94zM7.5 10a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5A.75.75 0 0 1 7.5 10m0 3.5a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1-.75-.75m0 3.5a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 7.5 17" />
                </svg>
              </span>
            </div>
            <p className="roles-subtitle audit-subtitle">
              Explora eventos por actor, modulo, accion, entidad y rango de
              fechas.
            </p>
          </div>
          <div className="audit-toolbar-meta">
            <span className="audit-total-pill">{total} eventos</span>
            <span className="audit-filter-summary">
              {activeAuditFilterCount === 0
                ? "Sin filtros activos"
                : `${activeAuditFilterCount} filtros activos`}
            </span>
          </div>
        </div>

        <div className="audit-screen-filters">
          <label className="audit-filter-card audit-filter-search-card">
            <span className="audit-filter-label">Busqueda rápida</span>
            <span className="audit-filter-help">
              Actor, modulo, accion, entidad o detalle
            </span>
            <div className="audit-search-input-wrap">
              <span className="audit-search-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M10.5 4a6.5 6.5 0 1 1 0 13a6.5 6.5 0 0 1 0-13m0-1.5a8 8 0 1 0 4.94 14.29l4.13 4.12a.75.75 0 1 0 1.06-1.06l-4.12-4.13A8 8 0 0 0 10.5 2.5" />
                </svg>
              </span>
              <input
                type="text"
                placeholder="Ej. login_failed, Juan Perez o cuentas"
                value={filters.q}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, q: e.target.value }))
                }
              />
            </div>
          </label>

          <div className="audit-filter-grid">
            <label className="audit-filter-card">
              <span className="audit-filter-label">Modulo</span>
              <select
                value={filters.module}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, module: e.target.value }))
                }
              >
                {auditModuleOptions.map((option) => (
                  <option
                    key={option.value || "all-modules"}
                    value={option.value}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="audit-filter-card">
              <span className="audit-filter-label">Accion</span>
              <select
                value={filters.action}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, action: e.target.value }))
                }
              >
                {auditActionOptions.map((option) => (
                  <option
                    key={option.value || "all-actions"}
                    value={option.value}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="audit-filter-card">
              <span className="audit-filter-label">Entidad</span>
              <select
                value={filters.entityType}
                onChange={(e) =>
                  setFilters((prev) => ({
                    ...prev,
                    entityType: e.target.value,
                  }))
                }
              >
                {auditEntityOptions.map((option) => (
                  <option
                    key={option.value || "all-entities"}
                    value={option.value}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="audit-filter-card audit-filter-status-card">
              <span className="audit-filter-label">Estado</span>
              <div
                className="audit-status-pills"
                role="group"
                aria-label="Filtrar auditoria por estado"
              >
                {[
                  { value: "", label: "Todos", tone: "all" },
                  { value: "success", label: "Exito", tone: "success" },
                  { value: "error", label: "Error", tone: "error" },
                ].map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    className={`audit-status-pill audit-status-pill-${option.tone}${filters.status === option.value ? " is-selected" : ""}`}
                    aria-pressed={filters.status === option.value}
                    onClick={() =>
                      setFilters((prev) => ({ ...prev, status: option.value }))
                    }
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="audit-filter-card audit-filter-date-card">
              <span className="audit-filter-label">Periodo</span>
              <div className="audit-date-range-grid">
                <label className="audit-date-field">
                  <span>Desde</span>
                  <DatePicker
                    selected={parseDateFilterValue(filters.from)}
                    onChange={(date) =>
                      setFilters((prev) => ({
                        ...prev,
                        from: formatDateFilterValue(date),
                      }))
                    }
                    selectsStart
                    startDate={parseDateFilterValue(filters.from)}
                    endDate={parseDateFilterValue(filters.to)}
                    maxDate={parseDateFilterValue(filters.to) || undefined}
                    placeholderText="Selecciona fecha"
                    dateFormat="dd/MM/yyyy"
                    locale={es}
                    showMonthDropdown
                    showYearDropdown
                    dropdownMode="select"
                    fixedHeight
                    todayButton="Hoy"
                    calendarClassName="audit-datepicker-calendar"
                    popperClassName="audit-datepicker-popper"
                    className="audit-date-input"
                    autoComplete="off"
                    isClearable={false}
                    showPopperArrow={false}
                  />
                </label>
                <label className="audit-date-field">
                  <span>Hasta</span>
                  <DatePicker
                    selected={parseDateFilterValue(filters.to)}
                    onChange={(date) =>
                      setFilters((prev) => ({
                        ...prev,
                        to: formatDateFilterValue(date),
                      }))
                    }
                    selectsEnd
                    startDate={parseDateFilterValue(filters.from)}
                    endDate={parseDateFilterValue(filters.to)}
                    minDate={parseDateFilterValue(filters.from) || undefined}
                    placeholderText="Selecciona fecha"
                    dateFormat="dd/MM/yyyy"
                    locale={es}
                    showMonthDropdown
                    showYearDropdown
                    dropdownMode="select"
                    fixedHeight
                    todayButton="Hoy"
                    calendarClassName="audit-datepicker-calendar"
                    popperClassName="audit-datepicker-popper"
                    className="audit-date-input"
                    autoComplete="off"
                    isClearable={false}
                    showPopperArrow={false}
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      {error && <div className="toast toast-error">{error}</div>}

      <table className="audit-table system-audit-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Modulo</th>
            <th>Accion</th>
            <th>Entidad</th>
            <th>Actor</th>
            <th>Estado</th>
            <th>Cambios</th>
            <th>Detalle</th>
          </tr>
        </thead>
        <tbody>
          {items.length > 0 ? (
            items.map((entry) => (
              <tr key={entry.id}>
                <td className="audit-date">
                  {formatDateTime(entry.created_at)}
                </td>
                <td>{entry.module}</td>
                <td>{entry.action}</td>
                <td>
                  {entry.entity_type}
                  {entry.entity_name
                    ? `: ${entry.entity_name}`
                    : entry.entity_id
                      ? ` #${entry.entity_id}`
                      : ""}
                </td>
                <td>
                  {entry.performed_by_name || entry.performed_by_email || "-"}
                </td>
                <td>
                  <span
                    className={
                      entry.status === "error"
                        ? "audit-action-badge audit-status-error"
                        : "audit-action-badge audit-status-success"
                    }
                  >
                    {entry.status === "error" ? "Error" : "Exito"}
                  </span>
                </td>
                <td className="audit-detail">{summarizeChanges(entry)}</td>
                <td className="audit-detail">{entry.detail || "-"}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={8} className="empty-state">
                {loading
                  ? "Cargando eventos..."
                  : "No hay eventos para estos filtros"}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="users-pagination">
        <div className="users-pagination-left">
          <span className="users-pagination-info">
            {startItem}–{endItem} de {total}
          </span>
        </div>
        <div className="users-pagination-center">
          <button
            type="button"
            className="users-page-btn"
            disabled={filters.page <= 1 || loading}
            onClick={() => changePage(filters.page - 1)}
          >
            ‹
          </button>
          <span className="users-pagination-pages">
            {filters.page} / {Math.max(1, totalPages)}
          </span>
          <button
            type="button"
            className="users-page-btn"
            disabled={filters.page >= totalPages || loading}
            onClick={() => changePage(filters.page + 1)}
          >
            ›
          </button>
        </div>
        <div className="users-pagination-right">
          <span className="users-pagination-label">Por página:</span>
          {[10, 25, 50, 100].map((n) => (
            <button
              key={n}
              type="button"
              className={`users-perpage-btn${filters.pageSize === n ? " is-active" : ""}`}
              onClick={() => changePageSize(n)}
              disabled={loading}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function Dashboard() {
  return (
    <section className="panel">
      <h2>Dashboard</h2>
      <p>
        Base del CRM creada con usuarios, roles, permisos, cuentas,
        oportunidades, contactos, paises y monedas.
      </p>
      <div className="cards">
        <div className="card">
          <h3>Seguridad</h3>
          <p>RBAC con deny-by-default.</p>
        </div>
        <div className="card">
          <h3>Cuentas</h3>
          <p>Catalogos y propietarios multiples.</p>
        </div>
        <div className="card">
          <h3>Listo para crecer</h3>
          <p>Contactos y oportunidades luego.</p>
        </div>
      </div>
    </section>
  );
}

function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const { data } = await api.post("/api/auth/login", { email, password });
      onLogin(data.token);
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible iniciar sesion"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <h2>Iniciar sesion</h2>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="E-mail"
          required
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          placeholder="Contrasena"
          required
        />
        {error && <p className="error">{error}</p>}
        <button disabled={saving}>{saving ? "Ingresando..." : "Entrar"}</button>
      </form>
    </section>
  );
}

function FirstUserSetup({ onDone }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mobile, setMobile] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const { data } = await api.post("/api/auth/register-first", {
        fullName,
        email,
        password,
        mobile,
      });
      onDone(data.token);
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible crear el administrador inicial",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <h2>Configurar primer Administrador</h2>
        <input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Nombres y Apellidos"
          required
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="E-mail"
          type="email"
          required
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Contrasena"
          type="password"
          required
        />
        <input
          value={mobile}
          onChange={(e) => setMobile(e.target.value)}
          placeholder="Movil"
        />
        {error && <p className="error">{error}</p>}
        <button disabled={saving}>
          {saving ? "Creando..." : "Crear administrador"}
        </button>
      </form>
    </section>
  );
}

function SetPasswordPage({ onDone }) {
  const location = useLocation();
  const navigate = useNavigate();
  const setupToken = new URLSearchParams(location.search).get("token") || "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [contextLoading, setContextLoading] = useState(true);
  const [inviteContext, setInviteContext] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");

  const passwordChecks = useMemo(
    () => ({
      length: password.length >= 8,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      number: /\d/.test(password),
    }),
    [password],
  );

  const completedChecks = Object.values(passwordChecks).filter(Boolean).length;
  const passwordStrength =
    completedChecks <= 1
      ? { label: "Debil", tone: "weak" }
      : completedChecks <= 3
        ? { label: "Media", tone: "medium" }
        : { label: "Fuerte", tone: "strong" };
  const passwordsMatch =
    confirmPassword.length > 0 && password === confirmPassword;
  const formattedInviteExpiration = inviteContext?.expiresAt
    ? new Intl.DateTimeFormat("es-MX", {
        dateStyle: "long",
        timeStyle: "short",
      }).format(new Date(inviteContext.expiresAt))
    : "";
  const canSubmit =
    !contextLoading &&
    !saving &&
    Boolean(setupToken) &&
    completedChecks === 4 &&
    password.length > 0 &&
    password === confirmPassword;

  useEffect(() => {
    let cancelled = false;

    async function loadContext() {
      if (!setupToken) {
        setInviteContext(null);
        setContextLoading(false);
        setError("El enlace no es valido o esta incompleto.");
        return;
      }

      setContextLoading(true);
      setError("");

      try {
        const { data } = await api.get("/api/auth/set-password-context", {
          params: { token: setupToken },
        });

        if (cancelled) return;
        setInviteContext(data);
      } catch (err) {
        if (cancelled) return;
        setInviteContext(null);
        setError(getApiErrorMessage(err, "No fue posible validar el enlace"));
      } finally {
        if (!cancelled) {
          setContextLoading(false);
        }
      }
    }

    loadContext();

    return () => {
      cancelled = true;
    };
  }, [setupToken]);

  useEffect(() => {
    if (!success) return undefined;

    const timeoutId = window.setTimeout(() => {
      navigate("/", { replace: true });
    }, 1400);

    return () => window.clearTimeout(timeoutId);
  }, [navigate, success]);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    if (password !== confirmPassword) {
      setSaving(false);
      setError("Las contrasenas no coinciden");
      return;
    }

    try {
      const { data } = await api.post("/api/auth/set-password", {
        token: setupToken,
        password,
      });
      setSuccess(data?.message || "Contrasena configurada correctamente");
      onDone(data.token);
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible configurar la contrasena"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="auth-wrap auth-wrap-password">
      <div className="password-setup-shell">
        <aside className="password-setup-hero">
          <p className="password-setup-eyebrow">Acceso seguro</p>
          <h1>Activa tu cuenta con una contrasena clara y fuerte.</h1>
          <p className="password-setup-copy">
            Este paso deja tu acceso listo. Usa una contrasena facil de recordar
            para ti y dificil de adivinar para otros.
          </p>
          <div className="password-setup-points">
            <div className="password-setup-point">
              <strong>Mas rapido</strong>
              <span>
                Ve al grano con un formulario corto y una guia visual inmediata.
              </span>
            </div>
            <div className="password-setup-point">
              <strong>Mas claro</strong>
              <span>Revisamos en vivo los requisitos antes de enviar.</span>
            </div>
            <div className="password-setup-point">
              <strong>Mas seguro</strong>
              <span>
                La fortaleza de la contrasena se muestra mientras escribes.
              </span>
            </div>
          </div>
        </aside>

        <form className="auth-card password-setup-card" onSubmit={submit}>
          <div className="password-setup-header">
            <h2>Configurar contrasena</h2>
            <p className="auth-copy">
              Define la contrasena con la que vas a entrar al sistema y te
              redirigiremos al dashboard.
            </p>
          </div>

          {contextLoading ? (
            <div className="password-setup-context-card is-loading">
              <strong>Validando enlace...</strong>
              <span>Estamos comprobando que el acceso siga vigente.</span>
            </div>
          ) : inviteContext ? (
            <div className="password-setup-context-card">
              <strong>{inviteContext.fullName}</strong>
              <span>{inviteContext.email}</span>
              <p>
                Este enlace corresponde a una
                {inviteContext.purpose === "reset"
                  ? " recuperacion"
                  : " activacion"}
                de acceso.
              </p>
              {formattedInviteExpiration ? (
                <p className="password-setup-expiration">
                  Vigente hasta el {formattedInviteExpiration}.
                </p>
              ) : null}
            </div>
          ) : null}

          <label className="auth-field">
            <span>Nueva contrasena</span>
            <div className="password-input-wrap">
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Crea una contrasena segura"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                minLength={8}
                required
              />
              <button
                className="password-toggle"
                type="button"
                onClick={() => setShowPassword((current) => !current)}
              >
                {showPassword ? "Ocultar" : "Mostrar"}
              </button>
            </div>
          </label>

          <div className="password-strength-box">
            <div className="password-strength-head">
              <span>Fortaleza</span>
              <strong
                className={`strength-pill strength-pill-${passwordStrength.tone}`}
              >
                {passwordStrength.label}
              </strong>
            </div>
            <div className="password-strength-track" aria-hidden="true">
              <span
                className={`password-strength-fill password-strength-fill-${passwordStrength.tone}`}
                style={{ width: `${(completedChecks / 4) * 100}%` }}
              />
            </div>
            <div className="password-checklist">
              <p className={passwordChecks.length ? "is-valid" : ""}>
                Minimo 8 caracteres
              </p>
              <p className={passwordChecks.uppercase ? "is-valid" : ""}>
                Al menos una mayuscula
              </p>
              <p className={passwordChecks.lowercase ? "is-valid" : ""}>
                Al menos una minuscula
              </p>
              <p className={passwordChecks.number ? "is-valid" : ""}>
                Al menos un numero
              </p>
            </div>
          </div>

          <label className="auth-field">
            <span>Confirmar contrasena</span>
            <div className="password-input-wrap">
              <input
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repite tu contrasena"
                type={showConfirmPassword ? "text" : "password"}
                autoComplete="new-password"
                minLength={8}
                required
              />
              <button
                className="password-toggle"
                type="button"
                onClick={() => setShowConfirmPassword((current) => !current)}
              >
                {showConfirmPassword ? "Ocultar" : "Mostrar"}
              </button>
            </div>
          </label>

          <p
            className={`password-match ${
              confirmPassword.length === 0
                ? ""
                : passwordsMatch
                  ? "is-valid"
                  : "is-invalid"
            }`}
          >
            {confirmPassword.length === 0
              ? "Confirma la contrasena para validar que coincide."
              : passwordsMatch
                ? "Las contrasenas coinciden."
                : "Las contrasenas no coinciden."}
          </p>

          {error && <p className="error">{error}</p>}
          {success && (
            <p className="success-inline">
              {success}. Redirigiendo al dashboard...
            </p>
          )}

          <button disabled={!canSubmit}>
            {saving ? "Guardando..." : "Guardar contrasena"}
          </button>

          <p className="auth-hint password-setup-note">
            Cuando guardes, tu sesion quedara lista y entraras directo al
            sistema.
          </p>
        </form>
      </div>
    </section>
  );
}

function UsersPage({ can }) {
  const maxUserAvatarSizeBytes = 2 * 1024 * 1024;
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [openUserMenuId, setOpenUserMenuId] = useState(null);
  const [confirmUserAction, setConfirmUserAction] = useState(null);
  const [editUser, setEditUser] = useState(null);
  const [editForm, setEditForm] = useState({
    fullName: "",
    email: "",
    mobile: "",
    avatarUrl: "",
    roleIds: [],
  });
  const [sortField, setSortField] = useState("id");
  const [sortDirection, setSortDirection] = useState("asc");
  const [userQuery, setUserQuery] = useState("");
  const [userStatusFilter, setUserStatusFilter] = usePersistedStatusFilter(
    "crm.users.statusFilter",
  );
  const [usersPerPage, setUsersPerPage] = useState(10);
  const [usersPage, setUsersPage] = useState(1);
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    mobile: "",
    avatarUrl: "",
    roleIds: [],
  });

  useEffect(() => {
    if (!error && !success) return;
    const timeoutId = window.setTimeout(() => {
      setError("");
      setSuccess("");
    }, 4000);
    return () => window.clearTimeout(timeoutId);
  }, [error, success]);

  useEffect(() => {
    if (openUserMenuId === null) return undefined;

    function handlePointerDown(event) {
      if (event.target.closest(".users-kebab-wrap")) return;
      setOpenUserMenuId(null);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [openUserMenuId]);

  const sortedUsers = useMemo(() => {
    const list = [...users];

    const readValue = (user) => {
      if (sortField === "id") return Number(user.id) || 0;
      if (sortField === "nombre") return String(user.full_name || "");
      if (sortField === "email") return String(user.email || "");
      if (sortField === "movil") return String(user.mobile || "");
      if (sortField === "estado") return String(user.status || "");
      if (sortField === "roles") return String(user.roles || "");
      return "";
    };

    list.sort((a, b) => {
      const aValue = readValue(a);
      const bValue = readValue(b);

      let result = 0;
      if (typeof aValue === "number" && typeof bValue === "number") {
        result = aValue - bValue;
      } else {
        result = String(aValue).localeCompare(String(bValue), "es", {
          numeric: true,
          sensitivity: "base",
        });
      }

      return sortDirection === "asc" ? result : -result;
    });

    return list;
  }, [users, sortField, sortDirection]);

  const filteredUsers = useMemo(() => {
    const base = sortedUsers.filter((u) => {
      if (userStatusFilter === "all") return true;
      if (userStatusFilter === "inactive") return u.status !== "active";
      return u.status === "active";
    });
    const q = userQuery.trim().toLowerCase();
    if (!q) return base;

    return base.filter((u) => {
      const haystack = [
        u.id,
        u.full_name,
        u.email,
        u.mobile,
        u.status === "active" ? "activo" : "inactivo",
        u.roles,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [sortedUsers, userQuery, userStatusFilter]);

  // reset to page 1 when filters change
  useEffect(() => {
    setUsersPage(1);
  }, [userQuery, userStatusFilter, usersPerPage]);

  const totalUserPages = Math.max(
    1,
    Math.ceil(filteredUsers.length / usersPerPage),
  );
  const pagedUsers = filteredUsers.slice(
    (usersPage - 1) * usersPerPage,
    usersPage * usersPerPage,
  );

  const userStatusCounts = useMemo(() => {
    return users.reduce(
      (totals, user) => {
        if (user.status === "active") {
          totals.active += 1;
          return totals;
        }
        totals.inactive += 1;
        return totals;
      },
      { active: 0, inactive: 0 },
    );
  }, [users]);

  const totalUsersCount = userStatusCounts.active + userStatusCounts.inactive;

  function toggleSort(field) {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortField(field);
    setSortDirection("asc");
  }

  function getSortArrow(field) {
    if (sortField !== field) return "↕";
    return sortDirection === "asc" ? "↑" : "↓";
  }

  function formatDateTime(value) {
    if (!value) return "No registrado";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "No registrado";
    return date.toLocaleString("es-ES");
  }

  async function load() {
    try {
      const [usersRes, rolesRes] = await Promise.all([
        api.get("/api/users"),
        api.get("/api/roles"),
      ]);
      setUsers(usersRes.data);
      setRoles(rolesRes.data);
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible cargar usuarios"));
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!showCreateForm) return;
    setForm((prev) => ({ ...prev, email: "" }));
  }, [showCreateForm]);

  function readUserImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("No fue posible leer la imagen"));
      reader.readAsDataURL(file);
    });
  }

  async function handleUserAvatarChange(file, applyAvatar) {
    if (!file) {
      applyAvatar("");
      return;
    }

    if (!String(file.type || "").startsWith("image/")) {
      setError("Selecciona un archivo de imagen válido");
      return;
    }

    if (file.size > maxUserAvatarSizeBytes) {
      setError("La imagen del usuario no debe exceder 2 MB");
      return;
    }

    try {
      const dataUrl = await readUserImageFile(file);
      applyAvatar(dataUrl);
    } catch (err) {
      setError(String(err?.message || "No fue posible cargar la imagen"));
    }
  }

  async function createUser(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      const payload = {
        fullName: form.fullName,
        email: form.email,
        mobile: form.mobile || undefined,
        avatarUrl: form.avatarUrl || undefined,
        roleIds: form.roleIds,
      };

      const { data } = await api.post("/api/users", payload);
      setForm({
        fullName: "",
        email: "",
        mobile: "",
        avatarUrl: "",
        roleIds: [],
      });
      setShowCreateForm(false);
      setSuccess(
        data?.message ||
          "Usuario creado. Se envio un correo para crear la contrasena.",
      );
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible crear el usuario"));
    } finally {
      setSaving(false);
    }
  }

  async function updateUserStatus(userId, nextStatus) {
    setError("");
    setSuccess("");
    try {
      const { data } = await api.patch(`/api/users/${userId}/status`, {
        status: nextStatus,
      });
      setSuccess(data?.message || "Estado actualizado");
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible actualizar estado"));
    }
  }

  function openUserActionConfirmation(user, action) {
    setConfirmUserAction({ user, action });
    setOpenUserMenuId(null);
  }

  function closeUserActionConfirmation() {
    if (saving) return;
    setConfirmUserAction(null);
  }

  async function confirmSelectedUserAction() {
    if (!confirmUserAction) return;

    if (confirmUserAction.action === "inactive") {
      await updateUserStatus(confirmUserAction.user.id, "inactive");
    } else if (confirmUserAction.action === "active") {
      await updateUserStatus(confirmUserAction.user.id, "active");
    } else if (confirmUserAction.action === "reset-password") {
      await sendResetInvite(confirmUserAction.user.id);
    }

    setConfirmUserAction(null);
  }

  function getUserActionConfirmationTitle() {
    if (confirmUserAction?.action === "active") return "Activar usuario";
    if (confirmUserAction?.action === "reset-password") {
      return "Reiniciar contrasena";
    }
    return "Desactivar usuario";
  }

  function getUserActionConfirmationMessage() {
    const fullName = confirmUserAction?.user?.full_name || "";
    if (confirmUserAction?.action === "active") {
      return `Seguro que deseas activar al usuario "${fullName}"?`;
    }
    if (confirmUserAction?.action === "reset-password") {
      return `Seguro que deseas enviar un reinicio de contrasena para el usuario "${fullName}"?`;
    }
    return `Seguro que deseas desactivar al usuario "${fullName}"?`;
  }

  function getUserActionConfirmationText() {
    if (confirmUserAction?.action === "active") return "Activar";
    if (confirmUserAction?.action === "reset-password") {
      return "Enviar reinicio";
    }
    return "Desactivar";
  }

  async function sendResetInvite(userId) {
    setError("");
    setSuccess("");
    try {
      const { data } = await api.post(
        `/api/users/${userId}/reset-password-invite`,
      );
      setSuccess(data?.message || "Correo de reinicio enviado");
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible enviar correo de reinicio"),
      );
    }
  }

  function toggleUserMenu(userId) {
    setOpenUserMenuId((prev) => (prev === userId ? null : userId));
  }

  function openEditUser(u) {
    const currentRoleIds = u.roles
      ? roles
          .filter((r) => u.roles.split(", ").includes(r.name))
          .map((r) => r.id)
      : [];
    setEditForm({
      fullName: u.full_name,
      email: u.email,
      mobile: u.mobile || "",
      avatarUrl: u.avatar_url || "",
      roleIds: currentRoleIds,
    });
    setEditUser(u);
  }

  async function saveEditUser(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      const { data } = await api.put(`/api/users/${editUser.id}`, {
        fullName: editForm.fullName,
        email: editForm.email,
        mobile: editForm.mobile || null,
        avatarUrl: editForm.avatarUrl || null,
        roleIds: editForm.roleIds,
      });
      setEditUser(null);
      setSuccess(data?.message || "Usuario actualizado");
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible actualizar el usuario"));
    } finally {
      setSaving(false);
    }
  }

  async function runUserAction(action) {
    try {
      await action();
    } finally {
      setOpenUserMenuId(null);
    }
  }

  return (
    <section className="panel">
      <ConfirmationModal
        isOpen={Boolean(confirmUserAction)}
        title={getUserActionConfirmationTitle()}
        message={getUserActionConfirmationMessage()}
        onConfirm={confirmSelectedUserAction}
        onCancel={closeUserActionConfirmation}
        confirmText={getUserActionConfirmationText()}
        isDangerous={confirmUserAction?.action === "inactive"}
      />

      <div className="roles-page-header">
        <div className="roles-page-header-left">
          <div className="module-title-with-icon">
            <h2>Usuarios</h2>
            <span
              className="module-title-icon module-title-icon-users"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M12 12.25a4.25 4.25 0 1 0-4.25-4.25A4.25 4.25 0 0 0 12 12.25m0 1.5c-3.66 0-6.75 2.2-6.75 4.8 0 .52.42.95.95.95h11.6a.95.95 0 0 0 .95-.95c0-2.6-3.09-4.8-6.75-4.8" />
              </svg>
            </span>
          </div>
          <p className="roles-subtitle">
            Gestiona los usuarios del sistema y sus roles asignados
          </p>
        </div>
        {can("usuarios.create") && !showCreateForm && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => setShowCreateForm(true)}
          >
            + Crear usuario
          </button>
        )}
      </div>
      {can("usuarios.create") && showCreateForm && (
        <div
          className="modal-overlay"
          onClick={() => {
            if (saving) return;
            setShowCreateForm(false);
            setError("");
            setSuccess("");
            setForm({
              fullName: "",
              email: "",
              mobile: "",
              roleIds: [],
            });
          }}
        >
          <div
            className="modal-dialog modal-dialog-wide"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="modal-title">Crear usuario</h3>
            <form
              className="user-create-form in-modal"
              onSubmit={createUser}
              autoComplete="off"
            >
              <input
                type="text"
                name="fake_username"
                autoComplete="username"
                className="hidden-autofill-trap"
                tabIndex={-1}
              />
              <input
                type="password"
                name="fake_password"
                autoComplete="current-password"
                className="hidden-autofill-trap"
                tabIndex={-1}
              />
              <div className="grid-form">
                <div className="field-group">
                  <label>
                    Nombre completo <span className="required-mark">*</span>
                  </label>
                  <input
                    placeholder="Ej. Ana Perez"
                    value={form.fullName}
                    onChange={(e) =>
                      setForm({ ...form, fullName: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="field-group">
                  <label>
                    E-mail <span className="required-mark">*</span>
                  </label>
                  <input
                    placeholder="Ej. nombre.apellido@empresa.com"
                    type="email"
                    name="new_user_email"
                    autoComplete="off"
                    value={form.email}
                    onChange={(e) =>
                      setForm({ ...form, email: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="field-group">
                  <label>Movil</label>
                  <input
                    placeholder="Ej. 5512345678"
                    value={form.mobile}
                    onChange={(e) =>
                      setForm({ ...form, mobile: e.target.value })
                    }
                  />
                </div>
                <div className="field-group" style={{ gridColumn: "1 / -1" }}>
                  <label>Imagen del usuario</label>
                  <div className="user-avatar-upload-wrap">
                    {form.avatarUrl ? (
                      <img
                        src={form.avatarUrl}
                        alt="Vista previa del usuario"
                        className="user-avatar-preview"
                      />
                    ) : (
                      <div className="user-avatar-placeholder">Sin imagen</div>
                    )}
                    <div className="user-avatar-controls">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) =>
                          handleUserAvatarChange(
                            e.target.files?.[0],
                            (avatarUrl) =>
                              setForm((prev) => ({ ...prev, avatarUrl })),
                          )
                        }
                      />
                      <p className="field-hint">
                        JPG, PNG o WEBP. Tamaño máximo: 2 MB.
                      </p>
                      {form.avatarUrl && (
                        <button
                          type="button"
                          className="btn-secondary user-avatar-clear-btn"
                          onClick={() =>
                            setForm((prev) => ({ ...prev, avatarUrl: "" }))
                          }
                        >
                          Quitar imagen
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <p className="field-hint create-user-email-hint">
                Al crear el usuario se enviara un correo para que configure su
                contrasena en otra seccion de la aplicacion.
              </p>

              <div className="field-group">
                <label>Roles</label>
                <p className="field-hint">Selecciona uno o varios roles</p>
                <div className="roles-picker">
                  {roles.map((r) => {
                    const checked = form.roleIds.includes(Number(r.id));
                    return (
                      <label key={r.id} className="role-choice">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const roleId = Number(r.id);
                            if (e.target.checked) {
                              setForm((prev) => ({
                                ...prev,
                                roleIds: [...prev.roleIds, roleId],
                              }));
                            } else {
                              setForm((prev) => ({
                                ...prev,
                                roleIds: prev.roleIds.filter(
                                  (id) => id !== roleId,
                                ),
                              }));
                            }
                          }}
                        />
                        <span>{r.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="modal-buttons" style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    if (saving) return;
                    setShowCreateForm(false);
                    setError("");
                    setSuccess("");
                    setForm({
                      fullName: "",
                      email: "",
                      mobile: "",
                      avatarUrl: "",
                      roleIds: [],
                    });
                  }}
                >
                  Cancelar
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? "Creando usuario..." : "Guardar usuario"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {error && <div className="toast toast-error">{error}</div>}
      {success && <div className="toast toast-success">{success}</div>}

      <div className="roles-pills-bar accounts-pills-bar-row">
        <div
          className="accounts-status-pills"
          role="group"
          aria-label="Filtrar usuarios por estado"
        >
          <button
            type="button"
            className={
              userStatusFilter === "active"
                ? "status-filter-pill status-filter-pill-active is-selected"
                : "status-filter-pill status-filter-pill-active"
            }
            aria-pressed={userStatusFilter === "active"}
            onClick={() => setUserStatusFilter("active")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Activos</span>
            <span className="status-filter-pill-count">
              {userStatusCounts.active}
            </span>
          </button>
          <button
            type="button"
            className={
              userStatusFilter === "inactive"
                ? "status-filter-pill status-filter-pill-inactive is-selected"
                : "status-filter-pill status-filter-pill-inactive"
            }
            aria-pressed={userStatusFilter === "inactive"}
            onClick={() => setUserStatusFilter("inactive")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Desactivados</span>
            <span className="status-filter-pill-count">
              {userStatusCounts.inactive}
            </span>
          </button>
          <button
            type="button"
            className={
              userStatusFilter === "all"
                ? "status-filter-pill status-filter-pill-all is-selected"
                : "status-filter-pill status-filter-pill-all"
            }
            aria-pressed={userStatusFilter === "all"}
            onClick={() => setUserStatusFilter("all")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Todos</span>
            <span className="status-filter-pill-count">{totalUsersCount}</span>
          </button>
        </div>
        <input
          className="accounts-search-inline"
          type="text"
          placeholder="Buscar por nombre, email, móvil, estado o rol"
          value={userQuery}
          onChange={(e) => setUserQuery(e.target.value)}
        />
      </div>

      <table>
        <thead>
          <tr>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleSort("id")}
              >
                ID <span>{getSortArrow("id")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleSort("nombre")}
              >
                Nombre <span>{getSortArrow("nombre")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleSort("email")}
              >
                Email <span>{getSortArrow("email")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleSort("movil")}
              >
                Movil <span>{getSortArrow("movil")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleSort("estado")}
              >
                Estado <span>{getSortArrow("estado")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleSort("roles")}
              >
                Roles <span>{getSortArrow("roles")}</span>
              </button>
            </th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {filteredUsers.length > 0 ? (
            pagedUsers.map((u) => (
              <tr key={u.id}>
                <td>{u.id}</td>
                <td>
                  <div className="user-name-cell">
                    <UserAvatar
                      src={u.avatar_url}
                      fullName={u.full_name}
                      size="sm"
                    />
                    <span>{u.full_name}</span>
                  </div>
                </td>
                <td>{u.email}</td>
                <td>{u.mobile || "-"}</td>
                <td>
                  <span
                    className={
                      u.status === "active"
                        ? "user-status-badge active"
                        : "user-status-badge inactive"
                    }
                  >
                    {u.status === "active" ? "Activo" : "Inactivo"}
                  </span>
                </td>
                <td>{u.roles || "-"}</td>
                <td>
                  <div className="user-kebab-wrap users-kebab-wrap">
                    <button
                      type="button"
                      className="kebab-btn"
                      onClick={() => toggleUserMenu(u.id)}
                      aria-label="Abrir acciones"
                      title="Acciones"
                    >
                      ⋮
                    </button>
                    {openUserMenuId === u.id && (
                      <div className="user-kebab-menu">
                        <button
                          type="button"
                          onClick={() => {
                            setOpenUserMenuId(null);
                            openEditUser(u);
                          }}
                        >
                          Editar
                        </button>
                        {u.status === "active" ? (
                          <button
                            type="button"
                            onClick={() =>
                              openUserActionConfirmation(u, "inactive")
                            }
                          >
                            Desactivar
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              openUserActionConfirmation(u, "active")
                            }
                          >
                            Activar
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            openUserActionConfirmation(u, "reset-password")
                          }
                        >
                          Reiniciar contrasena
                        </button>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={7} className="empty-state">
                No hay usuarios que coincidan con la búsqueda
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {filteredUsers.length > 0 && (
        <div className="users-pagination">
          <div className="users-pagination-left">
            <span className="users-pagination-info">
              {(usersPage - 1) * usersPerPage + 1}–
              {Math.min(usersPage * usersPerPage, filteredUsers.length)} de{" "}
              {filteredUsers.length}
            </span>
          </div>
          <div className="users-pagination-center">
            <button
              type="button"
              className="users-page-btn"
              disabled={usersPage === 1}
              onClick={() => setUsersPage((p) => p - 1)}
            >
              ‹
            </button>
            <span className="users-pagination-pages">
              {usersPage} / {totalUserPages}
            </span>
            <button
              type="button"
              className="users-page-btn"
              disabled={usersPage === totalUserPages}
              onClick={() => setUsersPage((p) => p + 1)}
            >
              ›
            </button>
          </div>
          <div className="users-pagination-right">
            <span className="users-pagination-label">Por página:</span>
            {[10, 50, 100].map((n) => (
              <button
                key={n}
                type="button"
                className={`users-perpage-btn${usersPerPage === n ? " is-active" : ""}`}
                onClick={() => setUsersPerPage(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}

      {editUser && (
        <div className="modal-overlay" onClick={() => setEditUser(null)}>
          <div
            className="modal-dialog"
            style={{ maxWidth: 480 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3 className="modal-title">Editar usuario</h3>
              <div className="opportunity-modal-header-meta">
                <span className="record-id-badge" title="ID del usuario">
                  <span className="record-id-icon" aria-hidden="true">
                    #
                  </span>
                  {editUser.id}
                </span>
                <span
                  className={
                    editUser.status === "active"
                      ? "status-icon-badge active"
                      : "status-icon-badge inactive"
                  }
                  title="Estado del usuario"
                >
                  <span className="status-dot" aria-hidden="true" />
                  {editUser.status === "active" ? "Activo" : "Inactivo"}
                </span>
              </div>
            </div>
            <form onSubmit={saveEditUser}>
              <div className="grid-form">
                <div className="field-group">
                  <label>
                    Nombre completo <span className="required-mark">*</span>
                  </label>
                  <input
                    type="text"
                    value={editForm.fullName}
                    onChange={(e) =>
                      setEditForm((p) => ({ ...p, fullName: e.target.value }))
                    }
                    required
                    minLength={3}
                    maxLength={160}
                  />
                </div>
                <div className="field-group">
                  <label>
                    E-mail <span className="required-mark">*</span>
                  </label>
                  <input
                    type="email"
                    value={editForm.email}
                    onChange={(e) =>
                      setEditForm((p) => ({ ...p, email: e.target.value }))
                    }
                    required
                    maxLength={254}
                  />
                </div>
                <div className="field-group">
                  <label>Móvil</label>
                  <input
                    type="text"
                    value={editForm.mobile}
                    onChange={(e) =>
                      setEditForm((p) => ({ ...p, mobile: e.target.value }))
                    }
                    maxLength={30}
                    placeholder="Opcional"
                  />
                </div>
                <div className="field-group" style={{ gridColumn: "1 / -1" }}>
                  <label>Imagen del usuario</label>
                  <div className="user-avatar-upload-wrap">
                    {editForm.avatarUrl ? (
                      <img
                        src={editForm.avatarUrl}
                        alt="Vista previa del usuario"
                        className="user-avatar-preview"
                      />
                    ) : (
                      <div className="user-avatar-placeholder">Sin imagen</div>
                    )}
                    <div className="user-avatar-controls">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) =>
                          handleUserAvatarChange(
                            e.target.files?.[0],
                            (avatarUrl) =>
                              setEditForm((prev) => ({ ...prev, avatarUrl })),
                          )
                        }
                      />
                      <p className="field-hint">
                        JPG, PNG o WEBP. Tamaño máximo: 2 MB.
                      </p>
                      {editForm.avatarUrl && (
                        <button
                          type="button"
                          className="btn-secondary user-avatar-clear-btn"
                          onClick={() =>
                            setEditForm((prev) => ({ ...prev, avatarUrl: "" }))
                          }
                        >
                          Quitar imagen
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="field-group" style={{ gridColumn: "1 / -1" }}>
                  <label>Roles</label>
                  <div className="roles-picker">
                    {roles.map((r) => (
                      <label key={r.id} className="role-choice">
                        <input
                          type="checkbox"
                          checked={editForm.roleIds.includes(r.id)}
                          onChange={(e) =>
                            setEditForm((p) => ({
                              ...p,
                              roleIds: e.target.checked
                                ? [...p.roleIds, r.id]
                                : p.roleIds.filter((id) => id !== r.id),
                            }))
                          }
                        />
                        <span>{r.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <section className="account-form-section modal-audit-strip">
                <h4>Auditoría de usuario</h4>
                <div className="role-audit-grid">
                  <div className="audit-item">
                    <span className="audit-label">Creado por</span>
                    <span className="audit-value">
                      {editUser.created_by_name || "No registrado"}
                    </span>
                  </div>
                  <div className="audit-item">
                    <span className="audit-label">Fecha de creacion</span>
                    <span className="audit-value">
                      {formatDateTime(editUser.created_at)}
                    </span>
                  </div>
                  <div className="audit-item">
                    <span className="audit-label">Modificado por</span>
                    <span className="audit-value">
                      {editUser.updated_by_name || "No registrado"}
                    </span>
                  </div>
                  <div className="audit-item">
                    <span className="audit-label">Fecha de modificacion</span>
                    <span className="audit-value">
                      {formatDateTime(editUser.updated_at)}
                    </span>
                  </div>
                </div>
              </section>

              <div className="modal-buttons" style={{ marginTop: 20 }}>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? "Guardando..." : "Guardar"}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setEditUser(null)}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

function StageBypassConfirmationModal({
  isOpen,
  reason,
  onReasonChange,
  onCancel,
  onConfirm,
  isSubmitting,
}) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Confirmar bypass de etapa</h3>
        <p className="modal-message">
          Confirma que deseas omitir la etapa actual. La oportunidad quedará con
          un cambio pendiente hasta que presiones Guardar cambios.
        </p>
        <div className="field-group opportunity-bypass-confirm-group">
          <label>
            Motivo del bypass <span className="required-mark">*</span>
          </label>
          <textarea
            aria-label="Motivo del bypass"
            rows={4}
            placeholder="Describe por qué se omitirá esta etapa"
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            disabled={isSubmitting}
            autoFocus
          />
        </div>
        <div className="modal-buttons">
          <button className="btn-secondary" onClick={onCancel}>
            Cancelar
          </button>
          <button className="btn-primary" onClick={onConfirm}>
            {isSubmitting ? "Bypaseando..." : "Confirmar bypass"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CommercialCloseConfirmationModal({
  isOpen,
  statusCode,
  reason,
  onReasonChange,
  onCancel,
  onConfirm,
}) {
  if (!isOpen) return null;

  const statusLabel = statusCode === "anulada" ? "anulada" : "perdida";

  return (
    <div className="modal-overlay">
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Confirmar oportunidad {statusLabel}</h3>
        <p className="modal-message">
          Confirma que deseas marcar la oportunidad como {statusLabel}. El
          cambio quedará pendiente hasta que presiones Guardar cambios.
        </p>
        <div className="field-group opportunity-bypass-confirm-group">
          <label>
            Motivo del cierre <span className="required-mark">*</span>
          </label>
          <textarea
            aria-label="Motivo del cierre comercial"
            rows={4}
            placeholder={`Describe por qué la oportunidad se marcará como ${statusLabel}`}
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            autoFocus
          />
        </div>
        <div className="modal-buttons">
          <button className="btn-secondary" onClick={onCancel}>
            Cancelar
          </button>
          <button className="btn-primary" onClick={onConfirm}>
            Confirmar cierre
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmationModal({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText = "Aceptar",
  cancelText = "Cancelar",
  isDangerous = false,
}) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-dialog">
        <h3 className="modal-title">{title}</h3>
        <p className="modal-message">{message}</p>
        <div className="modal-buttons">
          <button className="btn-secondary" onClick={onCancel}>
            {cancelText}
          </button>
          <button
            className={isDangerous ? "btn-danger" : "btn-primary"}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

function RolesPage({ can, onRefreshCurrentUser }) {
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [selectedRoleId, setSelectedRoleId] = useState(null);
  const [selectedPerms, setSelectedPerms] = useState([]);
  const [roleUsers, setRoleUsers] = useState([]);
  const [openRoleMenuId, setOpenRoleMenuId] = useState(null);
  const [showCreateRoleModal, setShowCreateRoleModal] = useState(false);
  const [editingRole, setEditingRole] = useState(null);
  const [roleForm, setRoleForm] = useState({
    name: "",
    description: "",
  });
  const [creatingRole, setCreatingRole] = useState(false);
  const [roleStatusFilter, setRoleStatusFilter] = useState("active");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    role: null,
    action: null,
  });

  useEffect(() => {
    if (!error && !success) return;
    const timeoutId = window.setTimeout(() => {
      setError("");
      setSuccess("");
    }, 4000);
    return () => window.clearTimeout(timeoutId);
  }, [error, success]);

  useEffect(() => {
    if (openRoleMenuId === null) return undefined;

    function handlePointerDown(event) {
      if (event.target.closest(".role-kebab-wrap")) return;
      setOpenRoleMenuId(null);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [openRoleMenuId]);

  async function load() {
    try {
      const rolesUrl =
        roleStatusFilter === "all" || roleStatusFilter === "inactive"
          ? "/api/roles?includeInactive=1"
          : "/api/roles";
      const [rolesRes, permsRes] = await Promise.all([
        api.get(rolesUrl),
        api.get("/api/roles/permissions"),
      ]);
      const normalizedRoles = (rolesRes.data || []).map((r) => ({
        ...r,
        id: Number(r.id),
        is_system: Number(r.is_system),
        is_active: Number(r.is_active),
      }));
      setRoles(normalizedRoles);
      if (
        selectedRoleId &&
        !normalizedRoles.some((r) => r.id === selectedRoleId)
      ) {
        setSelectedRoleId(null);
        setSelectedPerms([]);
      }
      setPermissions(
        (permsRes.data || []).map((p) => ({ ...p, id: Number(p.id) })),
      );
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible cargar roles/permisos"));
    }
  }

  useEffect(() => {
    load();
  }, [roleStatusFilter]);

  function resetRoleForm() {
    setRoleForm({ name: "", description: "" });
  }

  function closeRoleModal() {
    if (creatingRole) return;
    setShowCreateRoleModal(false);
    setEditingRole(null);
    resetRoleForm();
  }

  function openCreateRoleModal() {
    setEditingRole(null);
    resetRoleForm();
    setShowCreateRoleModal(true);
  }

  function openEditRoleModal(role) {
    setOpenRoleMenuId(null);
    setShowCreateRoleModal(false);
    setEditingRole(role);
    setRoleForm({
      name: role.name || "",
      description: role.description || "",
    });
  }

  async function submitRole(e) {
    e.preventDefault();
    if (!roleForm.name.trim()) return;
    setError("");
    setSuccess("");
    setCreatingRole(true);
    try {
      const payload = {
        name: roleForm.name.trim(),
        description: roleForm.description.trim(),
      };
      const roleName = payload.name;
      if (editingRole) {
        await api.put(`/api/roles/${editingRole.id}`, payload);
      } else {
        await api.post("/api/roles", payload);
      }
      closeRoleModal();
      await load();
      setSuccess(
        editingRole
          ? `Rol "${roleName}" actualizado correctamente.`
          : `Rol "${roleName}" creado correctamente.`,
      );
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          editingRole
            ? "No fue posible actualizar el rol"
            : "No fue posible crear el rol",
        ),
      );
    } finally {
      setCreatingRole(false);
    }
  }

  async function savePerms() {
    if (!selectedRoleId) {
      setSuccess("");
      setError("Selecciona un rol antes de guardar permisos.");
      return;
    }
    setError("");
    setSuccess("");
    try {
      await api.put(`/api/roles/${selectedRoleId}/permissions`, {
        permissionIds: selectedPerms.map(Number),
      });
      if (typeof onRefreshCurrentUser === "function") {
        await onRefreshCurrentUser();
      }
      await load();
      const selectedRole = roles.find((r) => r.id === selectedRoleId);
      const roleName = selectedRole?.name || "rol";
      setSuccess(`Permisos guardados correctamente para ${roleName}.`);
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible actualizar permisos del rol"),
      );
    }
  }

  async function selectRole(roleId) {
    setSelectedRoleId(roleId);
    setOpenRoleMenuId(null);
    setError("");
    setSuccess("");
    try {
      const [permsRes, usersRes] = await Promise.all([
        api.get(`/api/roles/${roleId}/permissions`),
        api.get(`/api/roles/${roleId}/users`),
      ]);
      setSelectedPerms((permsRes.data.permissionIds || []).map(Number));
      setRoleUsers(usersRes.data || []);
    } catch (err) {
      setSelectedPerms([]);
      setRoleUsers([]);
      setError(getApiErrorMessage(err, "No fue posible cargar datos del rol"));
    }
  }

  function openConfirmModal(role, action) {
    setConfirmModal({ isOpen: true, role, action });
  }

  function closeConfirmModal() {
    setConfirmModal({ isOpen: false, role: null, action: null });
  }

  async function confirmRoleStatusChange() {
    const { role, action } = confirmModal;
    if (!role) return;

    closeConfirmModal();
    const roleId = Number(role.id);
    const nextIsActive = action === "activar";

    setError("");
    setSuccess("");
    try {
      await api.patch(`/api/roles/${roleId}/status`, {
        isActive: nextIsActive,
      });
      if (
        !nextIsActive &&
        roleStatusFilter === "active" &&
        selectedRoleId === roleId
      ) {
        setSelectedRoleId(null);
        setSelectedPerms([]);
      }
      await load();
      setSuccess(
        nextIsActive
          ? `Rol "${role.name}" activado correctamente.`
          : `Rol "${role.name}" desactivado correctamente.`,
      );
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible actualizar estado del rol"),
      );
    }
  }

  async function updateRoleStatus(role, nextIsActive) {
    const roleId = Number(role.id);
    if (Number(role.is_system) === 1) {
      setSuccess("");
      setError("No se puede cambiar el estado de un rol del sistema.");
      return;
    }

    const action = nextIsActive ? "activar" : "desactivar";
    openConfirmModal(role, action);
  }

  function toggleRoleMenu(roleId) {
    selectRole(roleId);
    setOpenRoleMenuId((prev) => (prev === roleId ? null : roleId));
  }

  async function runRoleAction(action) {
    try {
      await action();
    } finally {
      setOpenRoleMenuId(null);
    }
  }

  function formatDateTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString("es-ES");
  }

  const selectedRole = roles.find((r) => r.id === selectedRoleId) || null;

  return (
    <section className="panel">
      <div className="roles-page-header">
        <div className="roles-page-header-left">
          <div className="module-title-with-icon">
            <h2>Roles y permisos</h2>
            <span className="module-title-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M12 1a5 5 0 1 1 0 10A5 5 0 0 1 12 1zm0 1.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM3.5 19.5A8.5 8.5 0 0 1 12 13a8.5 8.5 0 0 1 8.5 6.5H3.5zM2 20.5C2.42 16.09 6.8 13 12 13s9.58 3.09 10 7.5H2zM17 14l1.5 1.5L23 11l-1.5-1.5L17 14zm1.5 1.5L17 14l-2 2 1.5 1.5 2-2z" />
              </svg>
            </span>
          </div>
          <p className="roles-subtitle">
            Gestiona los roles del sistema y asigna permisos por módulo
          </p>
        </div>
        {can("roles.create") && (
          <button
            type="button"
            className="btn-primary"
            onClick={openCreateRoleModal}
          >
            + Crear rol
          </button>
        )}
      </div>
      <div className="roles-pills-bar">
        <div
          className="accounts-status-pills"
          role="group"
          aria-label="Filtrar roles por estado"
        >
          <button
            type="button"
            className={
              roleStatusFilter === "active"
                ? "status-filter-pill status-filter-pill-active is-selected"
                : "status-filter-pill status-filter-pill-active"
            }
            aria-pressed={roleStatusFilter === "active"}
            onClick={() => setRoleStatusFilter("active")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Activos</span>
            <span className="status-filter-pill-count">
              {roles.filter((r) => Number(r.is_active) === 1).length}
            </span>
          </button>
          <button
            type="button"
            className={
              roleStatusFilter === "inactive"
                ? "status-filter-pill status-filter-pill-inactive is-selected"
                : "status-filter-pill status-filter-pill-inactive"
            }
            aria-pressed={roleStatusFilter === "inactive"}
            onClick={() => setRoleStatusFilter("inactive")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Desactivados</span>
            <span className="status-filter-pill-count">
              {roles.filter((r) => Number(r.is_active) === 0).length}
            </span>
          </button>
          <button
            type="button"
            className={
              roleStatusFilter === "all"
                ? "status-filter-pill status-filter-pill-all is-selected"
                : "status-filter-pill status-filter-pill-all"
            }
            aria-pressed={roleStatusFilter === "all"}
            onClick={() => setRoleStatusFilter("all")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Todos</span>
            <span className="status-filter-pill-count">{roles.length}</span>
          </button>
        </div>
      </div>
      {error && <div className="toast toast-error">{error}</div>}
      {success && <div className="toast toast-success">{success}</div>}

      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        title={
          confirmModal.action === "activar" ? "Activar rol" : "Desactivar rol"
        }
        message={`Seguro que deseas ${confirmModal.action} el rol "${confirmModal.role?.name}"?`}
        onConfirm={confirmRoleStatusChange}
        onCancel={closeConfirmModal}
        confirmText={
          confirmModal.action === "activar" ? "Activar" : "Desactivar"
        }
        isDangerous={confirmModal.action === "desactivar"}
      />

      {(showCreateRoleModal || editingRole) && (
        <div className="modal-overlay" onClick={closeRoleModal}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">
              {editingRole ? "Editar rol" : "Crear rol"}
            </h3>
            <form onSubmit={submitRole}>
              <div className="field-group">
                <label>Nombre de rol</label>
                <input
                  value={roleForm.name}
                  onChange={(e) =>
                    setRoleForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="Nombre de rol"
                  autoFocus
                  required
                />
              </div>
              <div className="field-group" style={{ marginTop: 12 }}>
                <label>Descripcion</label>
                <textarea
                  value={roleForm.description}
                  onChange={(e) =>
                    setRoleForm((prev) => ({
                      ...prev,
                      description: e.target.value,
                    }))
                  }
                  placeholder="Describe el objetivo o alcance del rol"
                  maxLength={255}
                  rows={4}
                />
              </div>
              <div className="modal-buttons" style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={closeRoleModal}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={creatingRole}
                >
                  {creatingRole
                    ? editingRole
                      ? "Guardando..."
                      : "Creando..."
                    : "Guardar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="roles-workspace">
        {/* Columna 1: lista de roles */}
        <div className="roles-col">
          <div className="roles-col-header">
            <div className="roles-col-header-left">
              <span className="roles-col-title">Roles</span>
              <span className="roles-col-count">
                {
                  roles.filter((r) =>
                    roleStatusFilter === "all"
                      ? true
                      : roleStatusFilter === "active"
                        ? Number(r.is_active) === 1
                        : Number(r.is_active) === 0,
                  ).length
                }
              </span>
            </div>
          </div>
          <ul className="roles-card-list">
            {roles
              .filter((r) =>
                roleStatusFilter === "all"
                  ? true
                  : roleStatusFilter === "active"
                    ? Number(r.is_active) === 1
                    : Number(r.is_active) === 0,
              )
              .map((r) => (
                <li
                  key={r.id}
                  className={[
                    "roles-card",
                    selectedRoleId === r.id ? "is-selected" : "",
                    Number(r.is_active) === 0 ? "is-inactive" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <button
                    className="roles-card-btn"
                    onClick={() => selectRole(r.id)}
                  >
                    <div className="roles-card-top">
                      <span className="roles-card-name">{r.name}</span>
                      <span
                        className={
                          Number(r.is_active) === 1
                            ? "role-status-badge active"
                            : "role-status-badge inactive"
                        }
                      >
                        {Number(r.is_active) === 1 ? "Activo" : "Inactivo"}
                      </span>
                    </div>
                    <div className="roles-card-meta">
                      <span className="roles-card-desc">
                        {r.description || "Sin descripción"}
                      </span>
                      <span className="roles-card-perm-count">
                        {r.permissions_count} permisos
                      </span>
                    </div>
                  </button>
                  {can("roles.update") && Number(r.is_system) !== 1 && (
                    <div className="user-kebab-wrap role-kebab-wrap">
                      <button
                        type="button"
                        className="kebab-btn"
                        onClick={() => toggleRoleMenu(r.id)}
                        aria-label="Abrir acciones del rol"
                        title="Acciones"
                      >
                        ⋮
                      </button>
                      {openRoleMenuId === r.id && (
                        <div className="user-kebab-menu">
                          <button
                            type="button"
                            onClick={() => {
                              setOpenRoleMenuId(null);
                              openEditRoleModal(r);
                            }}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            disabled={Number(r.is_active) === 1}
                            onClick={() =>
                              runRoleAction(() => updateRoleStatus(r, true))
                            }
                          >
                            Activar
                          </button>
                          <button
                            type="button"
                            disabled={Number(r.is_active) !== 1}
                            onClick={() =>
                              runRoleAction(() => updateRoleStatus(r, false))
                            }
                          >
                            Desactivar
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
          </ul>
          {selectedRole && (
            <div className="role-audit-compact">
              <div className="role-audit-compact-title">Auditoría</div>
              <div className="audit-item">
                <span className="audit-label">Creado por</span>
                <span className="audit-value">
                  {selectedRole.created_by_user_name || "—"}
                </span>
              </div>
              <div className="audit-item">
                <span className="audit-label">Fecha creación</span>
                <span className="audit-value">
                  {formatDateTime(selectedRole.created_at)}
                </span>
              </div>
              <div className="audit-item">
                <span className="audit-label">Modificado por</span>
                <span className="audit-value">
                  {selectedRole.updated_by_user_name || "—"}
                </span>
              </div>
              <div className="audit-item">
                <span className="audit-label">Última modificación</span>
                <span className="audit-value">
                  {formatDateTime(selectedRole.updated_at)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Columna 2: permisos */}
        <div className="roles-col">
          <div className="roles-col-header">
            <div className="roles-col-header-left">
              <span className="roles-col-title">Permisos</span>
              <span className="roles-col-count">{permissions.length}</span>
              {can("roles.update") && selectedRoleId && (
                <button
                  className="btn-icon-save-perms"
                  onClick={savePerms}
                  title="Guardar permisos"
                  type="button"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                    <polyline points="17 21 17 13 7 13 7 21" />
                    <polyline points="7 3 7 8 15 8" />
                  </svg>
                  Guardar
                </button>
              )}
            </div>
          </div>
          {selectedRoleId ? (
            <div className="permissions-by-module">
              {Object.entries(
                permissions.reduce((acc, p) => {
                  const mod = p.module || "otros";
                  if (!acc[mod]) acc[mod] = [];
                  acc[mod].push(p);
                  return acc;
                }, {}),
              ).map(([mod, perms]) => (
                <div key={mod} className="permission-module-group">
                  <div className="permission-module-header">
                    {mod.charAt(0).toUpperCase() + mod.slice(1)}
                  </div>
                  <div className="checkbox-grid">
                    {perms.map((p) => (
                      <label key={p.id}>
                        <input
                          type="checkbox"
                          checked={selectedPerms.includes(Number(p.id))}
                          onChange={(e) => {
                            const permissionId = Number(p.id);
                            if (e.target.checked) {
                              setSelectedPerms((prev) => [
                                ...prev,
                                permissionId,
                              ]);
                            } else {
                              setSelectedPerms((prev) =>
                                prev.filter((id) => id !== permissionId),
                              );
                            }
                          }}
                        />
                        <span className="permission-label">
                          <span className="permission-code">{p.action}</span>
                          {p.description && (
                            <span className="permission-description">
                              {p.description}
                            </span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="roles-empty-state">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="36"
                height="36"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#c0cfe0"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <p>Selecciona un rol para gestionar sus permisos</p>
            </div>
          )}
        </div>

        {/* Columna 3: usuarios + auditoría */}
        <div className="roles-col">
          <div className="roles-col-header">
            <div className="roles-col-header-left">
              <span className="roles-col-title">Usuarios asignados</span>
              {selectedRoleId && (
                <span className="roles-col-count">{roleUsers.length}</span>
              )}
            </div>
          </div>
          {selectedRoleId ? (
            <>
              <div className="users-list">
                {roleUsers.length > 0 ? (
                  <ul className="list">
                    {roleUsers.map((u) => (
                      <li key={u.id} className="roles-user-item">
                        <div className="roles-user-avatar">
                          {u.full_name.charAt(0).toUpperCase()}
                        </div>
                        <div className="roles-user-info">
                          <div className="roles-user-name">{u.full_name}</div>
                          <div className="roles-user-email">{u.email}</div>
                        </div>
                        <span
                          className={
                            u.status === "active"
                              ? "role-status-badge active"
                              : "role-status-badge inactive"
                          }
                        >
                          {u.status === "active" ? "Activo" : "Inactivo"}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="roles-empty-state">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="36"
                      height="36"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#c0cfe0"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                    <p>No hay usuarios con este rol</p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="roles-empty-state">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="36"
                height="36"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#c0cfe0"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <p>Selecciona un rol para ver sus usuarios</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function AccountsPage({ can, currentUser, token }) {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState([]);
  const [users, setUsers] = useState([]);
  const [accountStatusFilter, setAccountStatusFilter] =
    usePersistedStatusFilter("crm.accounts.statusFilter");
  const [accountQuery, setAccountQuery] = useState("");
  const [accountSortField, setAccountSortField] = useState("id");
  const [accountSortDirection, setAccountSortDirection] = useState("asc");
  const [accountsPerPage, setAccountsPerPage] = useState(10);
  const [accountsPage, setAccountsPage] = useState(1);
  const [showCreateAccountModal, setShowCreateAccountModal] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState(null);
  const [editAccountAudit, setEditAccountAudit] = useState(null);
  const [editAccountOpportunities, setEditAccountOpportunities] = useState([]);
  const [loadingAccountOpportunities, setLoadingAccountOpportunities] =
    useState(false);
  const [oppSectionStatusFilter, setOppSectionStatusFilter] = useState("all");
  const [oppSectionYearFilter, setOppSectionYearFilter] = useState(
    String(new Date().getFullYear()),
  );
  const [accountOppsModalAccount, setAccountOppsModalAccount] = useState(null);
  const [accountContactsModalAccount, setAccountContactsModalAccount] =
    useState(null);
  const [editAccountContacts, setEditAccountContacts] = useState([]);
  const [loadingAccountContacts, setLoadingAccountContacts] = useState(false);
  const [contactModalStatusFilter, setContactModalStatusFilter] =
    useState("all");
  const [openAccountMenuId, setOpenAccountMenuId] = useState(null);
  const [confirmAccountStatusAction, setConfirmAccountStatusAction] =
    useState(null);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [catalogs, setCatalogs] = useState({
    countries: [],
    accountTypes: [],
    sectors: [],
    statuses: [],
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const explicitAccountPermissions = useMemo(
    () => new Set(currentUser?.permissions || []),
    [currentUser],
  );
  const canCreateOrRequestAccounts =
    explicitAccountPermissions.has("cuentas.create") ||
    explicitAccountPermissions.has("cuentas.request");
  const canActivateAccounts = explicitAccountPermissions.has("cuentas.create");

  useEffect(() => {
    if (!error && !success) return;
    const timeoutId = window.setTimeout(() => {
      setError("");
      setSuccess("");
    }, 4000);
    return () => window.clearTimeout(timeoutId);
  }, [error, success]);

  useEffect(() => {
    if (openAccountMenuId === null) return undefined;

    function handlePointerDown(event) {
      if (event.target.closest(".accounts-kebab-wrap")) return;
      setOpenAccountMenuId(null);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [openAccountMenuId]);

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }

  function findCatalogIdByCode(options, expectedCode) {
    const target = normalizeText(expectedCode);
    const found = options.find((opt) => normalizeText(opt.code) === target);
    return found ? String(found.id) : "";
  }

  function findCatalogIdByName(options, expectedName) {
    const target = normalizeText(expectedName);
    const found = options.find((opt) => normalizeText(opt.name) === target);
    return found ? String(found.id) : "";
  }

  function buildDefaultAccountForm() {
    const defaultCountryId = findCatalogIdByName(catalogs.countries, "mexico");
    const defaultAccountTypeId = findCatalogIdByName(
      catalogs.accountTypes,
      "prospecto",
    );
    const defaultOwnerUserIds = currentUser?.id ? [Number(currentUser.id)] : [];

    return {
      name: "",
      registrationCode: "",
      phone: "",
      website: "",
      city: "",
      stateRegion: "",
      description: "",
      addressLine: "",
      postalCode: "",
      accountTypeId: defaultAccountTypeId,
      economicSectorId: "",
      countryId: defaultCountryId,
      activationStatusId: "",
      ownerUserIds: defaultOwnerUserIds,
    };
  }

  const [form, setForm] = useState(buildDefaultAccountForm);

  function normalizeOwnerOption(user) {
    return {
      ...user,
      status: user?.status || "active",
    };
  }

  function mergeOwnerOptions(baseUsers, extraUsers = []) {
    const merged = new Map();

    [...baseUsers, ...extraUsers].forEach((user) => {
      if (!user?.id) return;
      merged.set(Number(user.id), normalizeOwnerOption(user));
    });

    return Array.from(merged.values()).sort((left, right) =>
      String(left.full_name || "").localeCompare(
        String(right.full_name || ""),
        "es",
        {
          sensitivity: "base",
        },
      ),
    );
  }

  function isInactiveOwner(user) {
    return normalizeText(user?.status) === "inactive";
  }

  function getOwnerOptionLabel(user) {
    return isInactiveOwner(user)
      ? `${user.full_name} (inactivo)`
      : user.full_name;
  }

  async function load() {
    try {
      const [
        accountsRes,
        usersRes,
        countriesRes,
        typesRes,
        sectorsRes,
        statusesRes,
      ] = await Promise.all([
        api.get("/api/accounts"),
        api.get("/api/catalogs/account-owner-users"),
        api.get("/api/catalogs/countries"),
        api.get("/api/catalogs/account-types"),
        api.get("/api/catalogs/economic-sectors"),
        api.get("/api/catalogs/account-activation-statuses"),
      ]);
      setAccounts(accountsRes.data);
      setUsers((usersRes.data || []).map(normalizeOwnerOption));
      setCatalogs({
        countries: countriesRes.data,
        accountTypes: typesRes.data,
        sectors: sectorsRes.data,
        statuses: statusesRes.data,
      });
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible cargar cuentas"));
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!showCreateAccountModal) return;
    const defaults = buildDefaultAccountForm();
    setForm((prev) => ({
      ...prev,
      accountTypeId: prev.accountTypeId || defaults.accountTypeId,
      countryId: prev.countryId || defaults.countryId,
      ownerUserIds:
        prev.ownerUserIds.length > 0
          ? prev.ownerUserIds
          : defaults.ownerUserIds,
    }));
  }, [showCreateAccountModal, catalogs, currentUser]);

  function openCreateAccountModal() {
    setError("");
    setSuccess("");
    setEditingAccountId(null);
    setEditAccountAudit(null);
    setUsers((prev) => prev.filter((user) => !isInactiveOwner(user)));
    setForm(buildDefaultAccountForm());
    setShowCreateAccountModal(true);
  }

  function closeAccountModal() {
    if (creatingAccount) return;
    setShowCreateAccountModal(false);
    setEditingAccountId(null);
    setEditAccountAudit(null);
    setShowAccountStatusMenu(false);
  }

  async function openAccountOppsModal(account) {
    setOppSectionStatusFilter("all");
    setOppSectionYearFilter(String(new Date().getFullYear()));
    setEditAccountOpportunities([]);
    setAccountOppsModalAccount(account);
    setLoadingAccountOpportunities(true);
    try {
      const { data: opps } = await api.get(
        `/api/opportunities?accountId=${account.id}`,
      );
      setEditAccountOpportunities(Array.isArray(opps) ? opps : []);
    } catch {
      setEditAccountOpportunities([]);
    } finally {
      setLoadingAccountOpportunities(false);
    }
  }

  function closeAccountOppsModal() {
    setAccountOppsModalAccount(null);
    setEditAccountOpportunities([]);
    setOppSectionStatusFilter("all");
    setOppSectionYearFilter(String(new Date().getFullYear()));
  }

  async function openAccountContactsModal(account) {
    setEditAccountContacts([]);
    setContactModalStatusFilter("all");
    setAccountContactsModalAccount(account);
    setLoadingAccountContacts(true);
    try {
      const { data: contacts } = await api.get(
        `/api/contacts?accountId=${account.id}`,
      );
      setEditAccountContacts(Array.isArray(contacts) ? contacts : []);
    } catch {
      setEditAccountContacts([]);
    } finally {
      setLoadingAccountContacts(false);
    }
  }

  function closeAccountContactsModal() {
    setAccountContactsModalAccount(null);
    setEditAccountContacts([]);
    setContactModalStatusFilter("all");
  }

  function formatDateTime(value) {
    if (!value) return "No registrado";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "No registrado";
    return date.toLocaleString("es-ES");
  }

  async function create(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (!form.ownerUserIds.length) {
      setError("Selecciona al menos un usuario propietario");
      return;
    }
    setCreatingAccount(true);
    try {
      const fallbackActivationStatusId =
        Number(form.activationStatusId) || Number(catalogs.statuses?.[0]?.id);
      const normalizedRegistrationCode = String(
        form.registrationCode || "",
      ).trim();

      if (!Number.isFinite(fallbackActivationStatusId)) {
        throw new Error("No hay estado de activacion disponible");
      }

      const payload = {
        ...form,
        registrationCode: normalizedRegistrationCode,
        accountTypeId: Number(form.accountTypeId),
        economicSectorId: Number(form.economicSectorId),
        countryId: Number(form.countryId),
        activationStatusId: fallbackActivationStatusId,
        ownerUserIds: form.ownerUserIds.map(Number),
      };

      const { data } = editingAccountId
        ? await api.put(`/api/accounts/${editingAccountId}`, payload)
        : await api.post("/api/accounts", payload);

      setForm(buildDefaultAccountForm());
      setEditingAccountId(null);
      setShowCreateAccountModal(false);
      await load();
      setSuccess(
        data?.message ||
          (editingAccountId
            ? "Cuenta actualizada correctamente"
            : "Cuenta creada correctamente"),
      );
    } catch (err) {
      const fieldErrors = err?.response?.data?.errors?.fieldErrors;
      if (fieldErrors && typeof fieldErrors === "object") {
        const firstError = Object.entries(fieldErrors).find(
          ([, messages]) => Array.isArray(messages) && messages.length > 0,
        );
        if (firstError) {
          const [fieldName, messages] = firstError;
          setError(`${fieldName}: ${messages[0]}`);
          return;
        }
      }
      setError(
        getApiErrorMessage(err, err?.message || "No fue posible crear cuenta"),
      );
    } finally {
      setCreatingAccount(false);
    }
  }

  function toggleOwnerUser(userId) {
    setForm((prev) => {
      const numericId = Number(userId);
      const selected = prev.ownerUserIds.includes(numericId);
      return {
        ...prev,
        ownerUserIds: selected
          ? prev.ownerUserIds.filter((id) => id !== numericId)
          : [...prev.ownerUserIds, numericId],
      };
    });
  }

  function toggleAccountMenu(accountId) {
    setOpenAccountMenuId((prev) => (prev === accountId ? null : accountId));
  }

  async function runAccountAction(action) {
    try {
      await action();
    } finally {
      setOpenAccountMenuId(null);
    }
  }

  function isAccountActive(account) {
    return normalizeText(account.activation_status) === "activada";
  }

  function isAccountPending(account) {
    return (
      normalizeText(account.activation_status) === "pendiente de activacion"
    );
  }

  function isAccountInactive(account) {
    return normalizeText(account.activation_status) === "desactivada";
  }

  const filteredAccounts = useMemo(() => {
    return accounts.filter((account) => {
      if (accountStatusFilter === "all") return true;
      if (accountStatusFilter === "pending") return isAccountPending(account);
      if (accountStatusFilter === "inactive") return isAccountInactive(account);
      return isAccountActive(account);
    });
  }, [accounts, accountStatusFilter]);

  const sortedAccounts = useMemo(() => {
    const list = [...filteredAccounts];

    const readValue = (account) => {
      if (accountSortField === "id") return Number(account.id) || 0;
      if (accountSortField === "nombre") return String(account.name || "");
      if (accountSortField === "tipo") {
        return String(account.account_type || "");
      }
      if (accountSortField === "pais") return String(account.country || "");
      if (accountSortField === "registro") {
        return String(account.registration_code || "");
      }
      if (accountSortField === "propietarios") {
        return String(account.owners_display || "");
      }
      if (accountSortField === "estado") {
        return String(getAccountStatusLabel(account) || "");
      }
      return "";
    };

    list.sort((a, b) => {
      const aValue = readValue(a);
      const bValue = readValue(b);

      let result = 0;
      if (typeof aValue === "number" && typeof bValue === "number") {
        result = aValue - bValue;
      } else {
        result = String(aValue).localeCompare(String(bValue), "es", {
          numeric: true,
          sensitivity: "base",
        });
      }

      return accountSortDirection === "asc" ? result : -result;
    });

    return list;
  }, [filteredAccounts, accountSortField, accountSortDirection]);

  const visibleAccounts = useMemo(() => {
    const q = accountQuery.trim().toLowerCase();
    if (!q) return sortedAccounts;

    return sortedAccounts.filter((a) => {
      const haystack = [
        a.id,
        a.name,
        a.account_type,
        a.owners_display,
        a.country,
        a.registration_code,
        getAccountStatusLabel(a),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [sortedAccounts, accountQuery]);

  // reset to page 1 when filters change
  useEffect(() => {
    setAccountsPage(1);
  }, [accountQuery, accountStatusFilter, accountsPerPage]);

  const totalAccountPages = Math.max(
    1,
    Math.ceil(visibleAccounts.length / accountsPerPage),
  );
  const pagedAccounts = visibleAccounts.slice(
    (accountsPage - 1) * accountsPerPage,
    accountsPage * accountsPerPage,
  );

  const accountStatusCounts = useMemo(() => {
    return accounts.reduce(
      (totals, account) => {
        if (isAccountPending(account)) {
          totals.pending += 1;
          return totals;
        }
        if (isAccountInactive(account)) {
          totals.inactive += 1;
          return totals;
        }
        totals.active += 1;
        return totals;
      },
      { active: 0, pending: 0, inactive: 0 },
    );
  }, [accounts]);

  const totalAccountsCount =
    accountStatusCounts.active +
    accountStatusCounts.pending +
    accountStatusCounts.inactive;

  function toggleAccountSort(field) {
    if (accountSortField === field) {
      setAccountSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setAccountSortField(field);
    setAccountSortDirection("asc");
  }

  function getAccountSortArrow(field) {
    if (accountSortField !== field) return "↕";
    return accountSortDirection === "asc" ? "↑" : "↓";
  }

  function getAccountStatusBadgeClass(account) {
    if (isAccountPending(account)) {
      return "user-status-badge pending";
    }
    return isAccountActive(account)
      ? "user-status-badge active"
      : "user-status-badge inactive";
  }

  function getAccountStatusLabel(account) {
    if (isAccountPending(account)) return "Pendiente de activacion";
    return isAccountActive(account) ? "Activada" : "Desactivada";
  }

  function getEditingActivationMeta() {
    const selectedStatus = catalogs.statuses.find(
      (x) => String(x.id) === String(form.activationStatusId),
    );
    const statusCode = normalizeText(selectedStatus?.code || "");
    const statusName = normalizeText(selectedStatus?.name || "");
    const isActive = statusCode === "activada" || statusName === "activada";
    const isPending =
      statusCode === "pendiente_activacion" ||
      statusName === "pendiente de activacion";

    return {
      label: selectedStatus?.name || "No definido",
      badgeClass: isPending
        ? "status-icon-badge pending"
        : isActive
          ? "status-icon-badge active"
          : "status-icon-badge inactive",
    };
  }

  async function updateAccountStatus(account, statusCode) {
    setError("");
    setSuccess("");
    try {
      const { data } = await api.patch(`/api/accounts/${account.id}/status`, {
        statusCode,
      });
      setSuccess(data?.message || "Estado de cuenta actualizado");
      await load();
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible actualizar el estado de la cuenta",
        ),
      );
    }
  }

  function openAccountStatusConfirmation(account, statusCode) {
    setConfirmAccountStatusAction({ account, statusCode });
    setOpenAccountMenuId(null);
  }

  function closeAccountStatusConfirmation() {
    setConfirmAccountStatusAction(null);
  }

  async function confirmSelectedAccountStatusChange() {
    if (!confirmAccountStatusAction) return;

    await updateAccountStatus(
      confirmAccountStatusAction.account,
      confirmAccountStatusAction.statusCode,
    );
    setConfirmAccountStatusAction(null);
  }

  function getAccountStatusConfirmationMeta() {
    const accountName = confirmAccountStatusAction?.account?.name || "";

    if (confirmAccountStatusAction?.statusCode === "activada") {
      return {
        title: "Activar cuenta",
        message: `Seguro que deseas activar la cuenta "${accountName}"?`,
        confirmText: "Activar",
        isDangerous: false,
      };
    }

    if (confirmAccountStatusAction?.statusCode === "pendiente_activacion") {
      return {
        title: "Marcar cuenta como pendiente",
        message: `Seguro que deseas marcar como pendiente la cuenta "${accountName}"?`,
        confirmText: "Marcar pendiente",
        isDangerous: false,
      };
    }

    return {
      title: "Desactivar cuenta",
      message: `Seguro que deseas desactivar la cuenta "${accountName}"?`,
      confirmText: "Desactivar",
      isDangerous: true,
    };
  }

  async function openEditAccountModal(accountId) {
    setError("");
    setSuccess("");
    try {
      const { data } = await api.get(`/api/accounts/${accountId}`);
      setUsers((prev) => mergeOwnerOptions(prev, data.owners || []));
      setForm({
        name: data.name || "",
        registrationCode: data.registration_code || "",
        phone: data.phone || "",
        website: data.website || "",
        city: data.city || "",
        stateRegion: data.state_region || "",
        description: data.description || "",
        addressLine: data.address_line || "",
        postalCode: data.postal_code || "",
        accountTypeId: String(data.account_type_id || ""),
        economicSectorId: String(data.economic_sector_id || ""),
        countryId: String(data.country_id || ""),
        activationStatusId: String(data.activation_status_id || ""),
        ownerUserIds: Array.isArray(data.owners)
          ? data.owners.map((o) => Number(o.id))
          : [],
      });
      setEditAccountAudit({
        createdByName: data.created_by_name || null,
        createdAt: data.created_at || null,
        updatedByName: data.updated_by_name || null,
        updatedAt: data.updated_at || null,
      });
      setEditingAccountId(Number(accountId));
      setShowCreateAccountModal(true);
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible cargar la cuenta"));
    }
  }

  return (
    <section className="panel">
      <ConfirmationModal
        isOpen={Boolean(confirmAccountStatusAction)}
        title={getAccountStatusConfirmationMeta().title}
        message={getAccountStatusConfirmationMeta().message}
        onConfirm={confirmSelectedAccountStatusChange}
        onCancel={closeAccountStatusConfirmation}
        confirmText={getAccountStatusConfirmationMeta().confirmText}
        isDangerous={getAccountStatusConfirmationMeta().isDangerous}
      />

      <div className="roles-page-header">
        <div className="roles-page-header-left">
          <div className="module-title-with-icon">
            <h2>Cuentas</h2>
            <span className="module-title-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M9 6.25a1.75 1.75 0 0 1 1.75-1.75h2.5A1.75 1.75 0 0 1 15 6.25V7h3.25A2.75 2.75 0 0 1 21 9.75v7.5A2.75 2.75 0 0 1 18.25 20h-12.5A2.75 2.75 0 0 1 3 17.25v-7.5A2.75 2.75 0 0 1 5.75 7H9zm1.5.75h3v-.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25zM4.5 11.5h15v5.75c0 .69-.56 1.25-1.25 1.25H5.75c-.69 0-1.25-.56-1.25-1.25zm15-1.5h-15v-.25c0-.69.56-1.25 1.25-1.25h12.5c.69 0 1.25.56 1.25 1.25z" />
              </svg>
            </span>
          </div>
          <p className="roles-subtitle">
            Gestiona las cuentas del sistema y sus datos de contacto
          </p>
        </div>
        {canCreateOrRequestAccounts && (
          <button
            type="button"
            className="btn-primary"
            onClick={openCreateAccountModal}
          >
            + Crear cuenta
          </button>
        )}
      </div>
      <div className="roles-pills-bar accounts-pills-bar-row">
        <div
          className="accounts-status-pills"
          role="group"
          aria-label="Filtrar cuentas por estado"
        >
          <button
            type="button"
            className={
              accountStatusFilter === "active"
                ? "status-filter-pill status-filter-pill-active is-selected"
                : "status-filter-pill status-filter-pill-active"
            }
            aria-pressed={accountStatusFilter === "active"}
            onClick={() => setAccountStatusFilter("active")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Activas</span>
            <span className="status-filter-pill-count">
              {accountStatusCounts.active}
            </span>
          </button>
          <button
            type="button"
            className={
              accountStatusFilter === "pending"
                ? "status-filter-pill status-filter-pill-pending is-selected"
                : "status-filter-pill status-filter-pill-pending"
            }
            aria-pressed={accountStatusFilter === "pending"}
            onClick={() => setAccountStatusFilter("pending")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Pendientes</span>
            <span className="status-filter-pill-count">
              {accountStatusCounts.pending}
            </span>
          </button>
          <button
            type="button"
            className={
              accountStatusFilter === "inactive"
                ? "status-filter-pill status-filter-pill-inactive is-selected"
                : "status-filter-pill status-filter-pill-inactive"
            }
            aria-pressed={accountStatusFilter === "inactive"}
            onClick={() => setAccountStatusFilter("inactive")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Desactivadas</span>
            <span className="status-filter-pill-count">
              {accountStatusCounts.inactive}
            </span>
          </button>
          <button
            type="button"
            className={
              accountStatusFilter === "all"
                ? "status-filter-pill status-filter-pill-all is-selected"
                : "status-filter-pill status-filter-pill-all"
            }
            aria-pressed={accountStatusFilter === "all"}
            onClick={() => setAccountStatusFilter("all")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Todas</span>
            <span className="status-filter-pill-count">
              {totalAccountsCount}
            </span>
          </button>
        </div>
        <input
          className="accounts-search-inline"
          type="text"
          placeholder="Buscar por ID, nombre, tipo, país, registro o estado"
          value={accountQuery}
          onChange={(e) => setAccountQuery(e.target.value)}
        />
      </div>

      {showCreateAccountModal && (
        <div
          className="modal-overlay"
          onClick={() => {
            closeAccountModal();
          }}
        >
          <div
            className="modal-dialog modal-dialog-account"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3 className="modal-title">
                {editingAccountId ? "Editar cuenta" : "Crear cuenta"}
              </h3>
              {editingAccountId && (
                <div className="opportunity-modal-header-meta">
                  <span className="record-id-badge" title="ID de la cuenta">
                    <span className="record-id-icon" aria-hidden="true">
                      #
                    </span>
                    {editingAccountId}
                  </span>
                  <span
                    className={getEditingActivationMeta().badgeClass}
                    title="Estado de activacion"
                  >
                    <span className="status-dot" aria-hidden="true" />
                    {getEditingActivationMeta().label}
                  </span>
                </div>
              )}
            </div>
            <p className="modal-message account-modal-message">
              {editingAccountId
                ? "Actualiza los datos necesarios y guarda los cambios."
                : "Completa primero los datos principales y despues asigna los propietarios para crear la cuenta."}
            </p>
            <form className="account-create-form in-modal" onSubmit={create}>
              <section className="account-form-section">
                <h4>Datos principales</h4>
                <div className="grid-form account-grid-main">
                  <div className="field-group">
                    <label>
                      Nombre <span className="required-mark">*</span>
                    </label>
                    <input
                      placeholder="Ej. AccessQ S.A. de C.V."
                      value={form.name}
                      onChange={(e) =>
                        setForm({ ...form, name: e.target.value })
                      }
                      required
                    />
                  </div>
                  <div className="field-group">
                    <label>Registro</label>
                    <input
                      placeholder="Ej. RFC o identificador interno"
                      value={form.registrationCode}
                      onChange={(e) =>
                        setForm({ ...form, registrationCode: e.target.value })
                      }
                    />
                  </div>
                  <div className="field-group">
                    <label>
                      Tipo de cuenta <span className="required-mark">*</span>
                    </label>
                    <select
                      value={form.accountTypeId}
                      onChange={(e) =>
                        setForm({ ...form, accountTypeId: e.target.value })
                      }
                      required
                    >
                      <option value="">Selecciona tipo de cuenta</option>
                      {catalogs.accountTypes.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field-group">
                    <label>
                      Sector economico <span className="required-mark">*</span>
                    </label>
                    <select
                      value={form.economicSectorId}
                      onChange={(e) =>
                        setForm({ ...form, economicSectorId: e.target.value })
                      }
                      required
                    >
                      <option value="">Selecciona sector economico</option>
                      {catalogs.sectors.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>

              <section className="account-form-section">
                <h4>Ubicacion y contacto</h4>
                <div className="grid-form account-grid-location">
                  <div className="field-group">
                    <label>
                      Pais <span className="required-mark">*</span>
                    </label>
                    <select
                      value={form.countryId}
                      onChange={(e) =>
                        setForm({ ...form, countryId: e.target.value })
                      }
                      required
                    >
                      <option value="">Selecciona pais</option>
                      {catalogs.countries.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field-group">
                    <label>Ciudad</label>
                    <input
                      placeholder="Ciudad"
                      value={form.city}
                      onChange={(e) =>
                        setForm({ ...form, city: e.target.value })
                      }
                    />
                  </div>
                  <div className="field-group">
                    <label>Estado</label>
                    <input
                      placeholder="Estado"
                      value={form.stateRegion}
                      onChange={(e) =>
                        setForm({ ...form, stateRegion: e.target.value })
                      }
                    />
                  </div>
                  <div className="field-group">
                    <label>Direccion</label>
                    <input
                      placeholder="Direccion"
                      value={form.addressLine}
                      onChange={(e) =>
                        setForm({ ...form, addressLine: e.target.value })
                      }
                    />
                  </div>
                  <div className="field-group">
                    <label>Codigo postal</label>
                    <input
                      placeholder="Codigo postal"
                      value={form.postalCode}
                      onChange={(e) =>
                        setForm({ ...form, postalCode: e.target.value })
                      }
                    />
                  </div>
                  <div className="field-group">
                    <label>Telefono</label>
                    <input
                      placeholder="Telefono"
                      value={form.phone}
                      onChange={(e) =>
                        setForm({ ...form, phone: e.target.value })
                      }
                    />
                  </div>
                  <div className="field-group">
                    <label>Pagina web</label>
                    <input
                      placeholder="https://empresa.com"
                      value={form.website}
                      onChange={(e) =>
                        setForm({ ...form, website: e.target.value })
                      }
                    />
                  </div>
                </div>
              </section>

              <section className="account-form-section">
                <h4>Descripcion</h4>
                <div className="field-group">
                  <textarea
                    placeholder="Describe brevemente la cuenta, notas comerciales o contexto"
                    value={form.description}
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                  />
                </div>
              </section>

              <section className="account-form-section">
                <h4>
                  Propietarios <span className="required-mark">*</span>
                </h4>
                <p className="field-hint">
                  Selecciona uno o varios usuarios (obligatorio)
                </p>
                <div className="owners-selected-wrap">
                  <p className="field-hint owners-selected-title">
                    Propietarios seleccionados
                  </p>
                  <div className="owners-picker owners-selected-grid">
                    {users
                      .filter((u) => form.ownerUserIds.includes(Number(u.id)))
                      .map((u) => (
                        <button
                          key={`selected-${u.id}`}
                          type="button"
                          className="owner-choice selected"
                          onClick={() => toggleOwnerUser(u.id)}
                          title="Quitar propietario"
                        >
                          <span className="owner-name">
                            {getOwnerOptionLabel(u)}
                          </span>
                          <span className="owner-email">{u.email}</span>
                        </button>
                      ))}
                  </div>
                  {form.ownerUserIds.length === 0 && (
                    <p className="field-hint owners-empty-hint">
                      Aun no hay propietarios seleccionados.
                    </p>
                  )}
                </div>

                <div className="owners-list-wrap">
                  <p className="field-hint owners-list-title">
                    Lista de usuarios para seleccionar
                  </p>
                  <div
                    className="owners-list"
                    role="listbox"
                    aria-multiselectable
                  >
                    {users.map((u) => {
                      const isSelected = form.ownerUserIds.includes(
                        Number(u.id),
                      );
                      const isInactive = isInactiveOwner(u);
                      return (
                        <label key={u.id} className="owners-list-item">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={isInactive && !isSelected}
                            onChange={() => toggleOwnerUser(u.id)}
                          />
                          <span className="owners-list-text">
                            <span className="owner-name">
                              {getOwnerOptionLabel(u)}
                            </span>
                            <span className="owner-email">{u.email}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </section>

              {editingAccountId && (
                <section className="account-form-section modal-audit-strip">
                  <h4>Auditoria de la cuenta</h4>
                  <div className="role-audit-grid">
                    <div className="audit-item">
                      <span className="audit-label">Creado por</span>
                      <span className="audit-value">
                        {editAccountAudit?.createdByName || "No registrado"}
                      </span>
                    </div>
                    <div className="audit-item">
                      <span className="audit-label">Fecha de creacion</span>
                      <span className="audit-value">
                        {formatDateTime(editAccountAudit?.createdAt)}
                      </span>
                    </div>
                    <div className="audit-item">
                      <span className="audit-label">Modificado por</span>
                      <span className="audit-value">
                        {editAccountAudit?.updatedByName || "No registrado"}
                      </span>
                    </div>
                    <div className="audit-item">
                      <span className="audit-label">Fecha de modificacion</span>
                      <span className="audit-value">
                        {formatDateTime(editAccountAudit?.updatedAt)}
                      </span>
                    </div>
                  </div>
                </section>
              )}

              <div className="modal-buttons" style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={closeAccountModal}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={creatingAccount}
                >
                  {creatingAccount
                    ? editingAccountId
                      ? "Guardando..."
                      : "Creando..."
                    : editingAccountId
                      ? "Guardar cambios"
                      : "Crear cuenta"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {error && <div className="toast toast-error">{error}</div>}
      {success && <div className="toast toast-success">{success}</div>}

      <table>
        <thead>
          <tr>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleAccountSort("id")}
              >
                ID <span>{getAccountSortArrow("id")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleAccountSort("nombre")}
              >
                Nombre <span>{getAccountSortArrow("nombre")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleAccountSort("tipo")}
              >
                Tipo <span>{getAccountSortArrow("tipo")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleAccountSort("pais")}
              >
                Pais <span>{getAccountSortArrow("pais")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleAccountSort("registro")}
              >
                Registro <span>{getAccountSortArrow("registro")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleAccountSort("propietarios")}
              >
                Propietarios <span>{getAccountSortArrow("propietarios")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleAccountSort("estado")}
              >
                Estado <span>{getAccountSortArrow("estado")}</span>
              </button>
            </th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {visibleAccounts.length > 0 ? (
            pagedAccounts.map((a) => (
              <tr key={a.id}>
                <td>{a.id}</td>
                <td>{a.name}</td>
                <td>{a.account_type}</td>
                <td>{a.country}</td>
                <td>{a.registration_code}</td>
                <td>{a.owners_display || "-"}</td>
                <td>
                  <span className={getAccountStatusBadgeClass(a)}>
                    {getAccountStatusLabel(a)}
                  </span>
                </td>
                <td className="accounts-actions-cell">
                  <div className="user-kebab-wrap accounts-kebab-wrap">
                    <button
                      type="button"
                      className="kebab-btn"
                      onClick={() => toggleAccountMenu(a.id)}
                      aria-label="Abrir acciones"
                    >
                      ⋮
                    </button>
                    {openAccountMenuId === a.id && (
                      <div className="user-kebab-menu">
                        <button
                          type="button"
                          onClick={() =>
                            runAccountAction(() => openEditAccountModal(a.id))
                          }
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          disabled={!canActivateAccounts || isAccountActive(a)}
                          onClick={() =>
                            openAccountStatusConfirmation(a, "activada")
                          }
                        >
                          Activar
                        </button>
                        <button
                          type="button"
                          disabled={!canActivateAccounts || isAccountPending(a)}
                          onClick={() =>
                            openAccountStatusConfirmation(
                              a,
                              "pendiente_activacion",
                            )
                          }
                        >
                          Marcar pendiente
                        </button>
                        <button
                          type="button"
                          disabled={
                            !canActivateAccounts || isAccountInactive(a)
                          }
                          onClick={() =>
                            openAccountStatusConfirmation(a, "desactivada")
                          }
                        >
                          Desactivar
                        </button>
                        {can("oportunidades.read") && (
                          <button
                            type="button"
                            onClick={() =>
                              runAccountAction(() => openAccountOppsModal(a))
                            }
                          >
                            Oportunidades
                          </button>
                        )}
                        {can("contactos.read") && (
                          <button
                            type="button"
                            onClick={() =>
                              runAccountAction(() =>
                                openAccountContactsModal(a),
                              )
                            }
                          >
                            Contactos
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={8} className="empty-state">
                No hay cuentas que coincidan con los filtros
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {visibleAccounts.length > 0 && (
        <div className="users-pagination">
          <div className="users-pagination-left">
            <span className="users-pagination-info">
              {(accountsPage - 1) * accountsPerPage + 1}–
              {Math.min(accountsPage * accountsPerPage, visibleAccounts.length)}{" "}
              de {visibleAccounts.length}
            </span>
          </div>
          <div className="users-pagination-center">
            <button
              type="button"
              className="users-page-btn"
              disabled={accountsPage === 1}
              onClick={() => setAccountsPage((p) => p - 1)}
            >
              ‹
            </button>
            <span className="users-pagination-pages">
              {accountsPage} / {totalAccountPages}
            </span>
            <button
              type="button"
              className="users-page-btn"
              disabled={accountsPage === totalAccountPages}
              onClick={() => setAccountsPage((p) => p + 1)}
            >
              ›
            </button>
          </div>
          <div className="users-pagination-right">
            <span className="users-pagination-label">Por página:</span>
            {[10, 50, 100].map((n) => (
              <button
                key={n}
                type="button"
                className={`users-perpage-btn${accountsPerPage === n ? " is-active" : ""}`}
                onClick={() => setAccountsPerPage(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}

      {accountOppsModalAccount &&
        (() => {
          const oppCloseYears = [
            ...new Set(
              editAccountOpportunities
                .map((o) =>
                  o.close_date ? new Date(o.close_date).getFullYear() : null,
                )
                .filter(Boolean),
            ),
          ].sort((a, b) => b - a);

          const visibleOpps = editAccountOpportunities.filter((o) => {
            if (
              oppSectionStatusFilter !== "all" &&
              normalizeText(o.activation_status) !==
                normalizeText(oppSectionStatusFilter)
            )
              return false;
            if (oppSectionYearFilter !== "all" && o.close_date) {
              if (
                String(new Date(o.close_date).getFullYear()) !==
                oppSectionYearFilter
              )
                return false;
            } else if (oppSectionYearFilter !== "all" && !o.close_date) {
              return false;
            }
            return true;
          });

          return (
            <div
              className="modal-overlay"
              role="dialog"
              aria-modal="true"
              aria-label={`Oportunidades de ${accountOppsModalAccount.name}`}
              onClick={(e) => {
                if (e.target === e.currentTarget) closeAccountOppsModal();
              }}
            >
              <div className="modal-dialog modal-dialog-wide modal-dialog-account-opps">
                <div className="modal-header">
                  <h3 className="modal-title">
                    Oportunidades &mdash;{" "}
                    <span style={{ fontWeight: 400 }}>
                      {accountOppsModalAccount.name}
                    </span>
                  </h3>
                </div>

                {!loadingAccountOpportunities &&
                  editAccountOpportunities.length > 0 && (
                    <div className="account-opps-filters">
                      <div
                        className="account-opps-pills"
                        role="group"
                        aria-label="Filtrar por estado"
                      >
                        {[
                          "activada",
                          "pendiente de activacion",
                          "desactivada",
                          "all",
                        ].map((s) => (
                          <button
                            key={s}
                            type="button"
                            className={`account-opps-pill account-opps-pill--${s === "all" ? "all" : s === "activada" ? "active" : s === "pendiente de activacion" ? "pending" : "inactive"}${
                              oppSectionStatusFilter === s ? " is-active" : ""
                            }`}
                            onClick={() => setOppSectionStatusFilter(s)}
                          >
                            {s === "all"
                              ? "Todas"
                              : s === "activada"
                                ? "Activadas"
                                : s === "pendiente de activacion"
                                  ? "Pendientes"
                                  : "Desactivadas"}
                          </button>
                        ))}
                      </div>
                      {oppCloseYears.length > 0 && (
                        <select
                          className="account-opps-year-select"
                          value={oppSectionYearFilter}
                          onChange={(e) =>
                            setOppSectionYearFilter(e.target.value)
                          }
                          aria-label="Filtrar por año de cierre"
                        >
                          <option value="all">Todos los años</option>
                          {oppCloseYears.map((y) => (
                            <option key={y} value={String(y)}>
                              {y}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}

                {loadingAccountOpportunities ? (
                  <p className="account-opps-empty">
                    Cargando oportunidades...
                  </p>
                ) : editAccountOpportunities.length === 0 ? (
                  <p className="account-opps-empty">
                    No hay oportunidades registradas para esta cuenta.
                  </p>
                ) : visibleOpps.length === 0 ? (
                  <p className="account-opps-empty">
                    Sin resultados para el filtro seleccionado.
                  </p>
                ) : (
                  <div className="account-opps-list">
                    {visibleOpps.map((opp) => (
                      <div
                        key={opp.id}
                        className="account-opp-row account-opp-row--clickable"
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          closeAccountOppsModal();
                          navigate(`/opportunities?edit=${opp.id}`);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            closeAccountOppsModal();
                            navigate(`/opportunities?edit=${opp.id}`);
                          }
                        }}
                      >
                        <div className="account-opp-main">
                          <span className="account-opp-name">{opp.name}</span>
                          <span
                            className={(() => {
                              const s = normalizeText(opp.activation_status);
                              if (s === "activada")
                                return "user-status-badge active";
                              if (s === "pendiente de activacion")
                                return "user-status-badge pending";
                              return "user-status-badge inactive";
                            })()}
                          >
                            {opp.activation_status || "-"}
                          </span>
                        </div>
                        <div className="account-opp-meta">
                          <span>{opp.sales_stage}</span>
                          <span>{opp.business_line}</span>
                          <span>
                            {Number(opp.amount_usd).toLocaleString("es-MX", {
                              style: "currency",
                              currency: "USD",
                              minimumFractionDigits: 0,
                            })}
                          </span>
                          <span>
                            Cierre:{" "}
                            {opp.close_date
                              ? new Date(opp.close_date).toLocaleDateString(
                                  "es-MX",
                                )
                              : "—"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="modal-buttons" style={{ marginTop: 16 }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={closeAccountOppsModal}
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {accountContactsModalAccount && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`Contactos de ${accountContactsModalAccount.name}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeAccountContactsModal();
          }}
        >
          <div className="modal-dialog modal-dialog-wide modal-dialog-account-opps">
            <div className="modal-header">
              <h3 className="modal-title">
                Contactos &mdash;{" "}
                <span style={{ fontWeight: 400 }}>
                  {accountContactsModalAccount.name}
                </span>
              </h3>
            </div>

            {!loadingAccountContacts && editAccountContacts.length > 0 && (
              <div className="account-opps-filters">
                <div
                  className="account-opps-pills"
                  role="group"
                  aria-label="Filtrar por estado"
                >
                  {[
                    "activado",
                    "pendiente de activacion",
                    "desactivado",
                    "all",
                  ].map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`account-opps-pill account-opps-pill--${
                        s === "all"
                          ? "all"
                          : s === "activado"
                            ? "active"
                            : s === "pendiente de activacion"
                              ? "pending"
                              : "inactive"
                      }${contactModalStatusFilter === s ? " is-active" : ""}`}
                      onClick={() => setContactModalStatusFilter(s)}
                    >
                      {s === "all"
                        ? "Todas"
                        : s === "activado"
                          ? "Activados"
                          : s === "pendiente de activacion"
                            ? "Pendientes"
                            : "Desactivados"}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {(() => {
              const visibleContacts =
                contactModalStatusFilter === "all"
                  ? editAccountContacts
                  : editAccountContacts.filter(
                      (c) =>
                        normalizeText(c.activation_status) ===
                        contactModalStatusFilter,
                    );
              return loadingAccountContacts ? (
                <p className="account-opps-empty">Cargando contactos...</p>
              ) : editAccountContacts.length === 0 ? (
                <p className="account-opps-empty">
                  No hay contactos registrados para esta cuenta.
                </p>
              ) : visibleContacts.length === 0 ? (
                <p className="account-opps-empty">
                  Sin resultados para el filtro seleccionado.
                </p>
              ) : (
                <div className="account-opps-list">
                  {visibleContacts.map((c) => (
                    <div
                      key={c.id}
                      className="account-opp-row account-opp-row--clickable"
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        closeAccountContactsModal();
                        navigate(`/contacts?edit=${c.id}`);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          closeAccountContactsModal();
                          navigate(`/contacts?edit=${c.id}`);
                        }
                      }}
                    >
                      <div className="account-opp-main">
                        <span className="account-opp-name">{c.full_name}</span>
                        <span
                          className={(() => {
                            const s = normalizeText(c.activation_status);
                            if (s === "activado")
                              return "user-status-badge active";
                            if (s === "pendiente de activacion")
                              return "user-status-badge pending";
                            return "user-status-badge inactive";
                          })()}
                        >
                          {c.activation_status || "-"}
                        </span>
                      </div>
                      <div className="account-opp-meta">
                        <span>{c.position_title || "—"}</span>
                        <span>{c.relationship_type || "—"}</span>
                        {c.email && <span>{c.email}</span>}
                        {c.phone && <span>{c.phone}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}

            <div className="modal-buttons" style={{ marginTop: 16 }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={closeAccountContactsModal}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function OpportunitiesPage({ can, currentUser }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [opportunities, setOpportunities] = useState([]);
  const [opportunityStatusFilter, setOpportunityStatusFilter] =
    usePersistedStatusFilter("crm.opportunities.statusFilter");
  const [opportunityQuery, setOpportunityQuery] = useState("");
  const [opportunitySortField, setOpportunitySortField] = useState("id");
  const [opportunitySortDirection, setOpportunitySortDirection] =
    useState("asc");
  const [opportunitiesPerPage, setOpportunitiesPerPage] = useState(10);
  const [opportunitiesPage, setOpportunitiesPage] = useState(1);
  const [showOpportunityModal, setShowOpportunityModal] = useState(false);
  const [editingOpportunityId, setEditingOpportunityId] = useState(null);
  const [editOpportunityAudit, setEditOpportunityAudit] = useState(null);
  const [commercialContext, setCommercialContext] = useState(null);
  const [commercialStageViewsById, setCommercialStageViewsById] = useState({});
  const [draftStageAction, setDraftStageAction] = useState(null);
  const [selectedCommercialStageId, setSelectedCommercialStageId] =
    useState("");
  const [loadingCommercialStageView, setLoadingCommercialStageView] =
    useState(false);
  const [commercialCloseReason, setCommercialCloseReason] = useState("");
  const [pendingCommercialCloseAction, setPendingCommercialCloseAction] =
    useState(null);
  const [showCommercialCloseModal, setShowCommercialCloseModal] =
    useState(false);
  const [commercialCloseModalState, setCommercialCloseModalState] = useState({
    statusCode: "",
    reason: "",
  });
  const [showStageBypassModal, setShowStageBypassModal] = useState(false);
  const [stageBypassReason, setStageBypassReason] = useState("");
  const [openOpportunityMenuId, setOpenOpportunityMenuId] = useState(null);
  const [savingOpportunity, setSavingOpportunity] = useState(false);
  const [savingCommercialAction, setSavingCommercialAction] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const explicitOpportunityPermissions = useMemo(
    () => new Set(currentUser?.permissions || []),
    [currentUser],
  );
  const canCreateOrRequestOpportunities =
    explicitOpportunityPermissions.has("oportunidades.create") ||
    explicitOpportunityPermissions.has("oportunidades.request");
  const canChangeOpportunityActivationStatus =
    explicitOpportunityPermissions.has("oportunidades.create");
  const [catalogs, setCatalogs] = useState({
    accounts: [],
    contacts: [],
    sellerUsers: [],
    presalesUsers: [],
    businessLines: [],
    stages: [],
    statuses: [],
    commercialStatuses: [],
  });

  const [form, setForm] = useState({
    name: "",
    amountUsd: "",
    accountId: "",
    closeDate: "",
    contactId: "",
    salesStageId: "",
    businessLineId: "",
    sellerUserId: "",
    presalesUserId: "",
    activationStatusId: "",
  });

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }

  function findCatalogIdByCode(options, expectedCode) {
    const target = normalizeText(expectedCode);
    const found = options.find((opt) => normalizeText(opt.code) === target);
    return found ? String(found.id) : "";
  }

  useEffect(() => {
    if (!error && !success) return;
    const timeoutId = window.setTimeout(() => {
      setError("");
      setSuccess("");
    }, 4000);
    return () => window.clearTimeout(timeoutId);
  }, [error, success]);

  useEffect(() => {
    if (openOpportunityMenuId === null) return undefined;

    function handlePointerDown(event) {
      if (event.target.closest(".opportunities-kebab-wrap")) return;
      setOpenOpportunityMenuId(null);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [openOpportunityMenuId]);

  async function load() {
    try {
      const [
        opportunitiesRes,
        accountsRes,
        contactsRes,
        sellerUsersRes,
        presalesUsersRes,
        businessLinesRes,
        stagesRes,
        statusesRes,
        commercialStatusesRes,
      ] = await Promise.all([
        api.get("/api/opportunities"),
        api.get("/api/catalogs/opportunity-accounts"),
        api.get("/api/catalogs/opportunity-contacts"),
        api.get("/api/catalogs/opportunity-seller-users"),
        api.get("/api/catalogs/opportunity-presales-users"),
        api.get("/api/catalogs/opportunity-business-lines"),
        api.get("/api/catalogs/opportunity-sales-stages"),
        api.get("/api/catalogs/opportunity-activation-statuses"),
        api.get("/api/catalogs/opportunity-commercial-statuses"),
      ]);

      setOpportunities(opportunitiesRes.data || []);
      setCatalogs({
        accounts: accountsRes.data || [],
        contacts: contactsRes.data || [],
        sellerUsers: sellerUsersRes.data || [],
        presalesUsers: presalesUsersRes.data || [],
        businessLines: businessLinesRes.data || [],
        stages: stagesRes.data || [],
        statuses: statusesRes.data || [],
        commercialStatuses: commercialStatusesRes.data || [],
      });
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible cargar oportunidades"));
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const editId = searchParams.get("edit");
    if (!editId) return;
    setSearchParams({}, { replace: true });
    openEditOpportunityModal(Number(editId));
  }, [searchParams]);

  function buildDefaultOpportunityForm() {
    const defaultSellerUserId =
      (currentUser?.roles || []).some(
        (role) => normalizeText(role.name) === "vendedor",
      ) &&
      catalogs.sellerUsers.some(
        (user) => Number(user.id) === Number(currentUser?.id),
      )
        ? String(currentUser.id)
        : "";

    return {
      name: "",
      amountUsd: "",
      accountId: "",
      closeDate: "",
      contactId: "",
      salesStageId: findCatalogIdByCode(catalogs.stages, "contacto_inicial"),
      businessLineId: "",
      sellerUserId: defaultSellerUserId,
      presalesUserId: "",
      activationStatusId: findCatalogIdByCode(
        catalogs.statuses,
        "pendiente_activacion",
      ),
    };
  }

  function buildDefaultCommercialContext() {
    const defaultStage = catalogs.stages.find(
      (stage) => normalizeText(stage.code) === "contacto_inicial",
    );
    const defaultCommercialStatus = catalogs.commercialStatuses.find(
      (status) => normalizeText(status.code) === "en_proceso",
    );

    return {
      salesStage: defaultStage
        ? {
            id: Number(defaultStage.id),
            code: String(defaultStage.code),
            name: String(defaultStage.name),
            order: Number(defaultStage.stage_order || 0),
          }
        : null,
      currentSalesStage: defaultStage
        ? {
            id: Number(defaultStage.id),
            code: String(defaultStage.code),
            name: String(defaultStage.name),
            order: Number(defaultStage.stage_order || 0),
          }
        : null,
      commercialStatus: defaultCommercialStatus
        ? {
            id: Number(defaultCommercialStatus.id),
            code: String(defaultCommercialStatus.code),
            name: String(defaultCommercialStatus.name),
            closedAt: null,
            closeReason: null,
          }
        : null,
      isSelectedStageCurrent: true,
      stages: defaultStage
        ? catalogs.stages.map((stage) => ({
            id: Number(stage.id),
            code: String(stage.code || ""),
            name: String(stage.name || ""),
            order: Number(stage.stage_order || 0),
            isCurrent: Number(stage.id) === Number(defaultStage.id),
            isSelected: Number(stage.id) === Number(defaultStage.id),
            isPast: false,
            isFuture:
              Number(stage.stage_order || 0) >
              Number(defaultStage.stage_order || 0),
            isClosed: false,
          }))
        : [],
      answers: [],
    };
  }

  function normalizeCommercialContext(data) {
    if (!data) return null;
    const normalizedSalesStage = data.salesStage
      ? {
          id: Number(data.salesStage.id),
          code: String(data.salesStage.code || ""),
          name: String(data.salesStage.name || ""),
          order: Number(
            data.salesStage.order || data.salesStage.stage_order || 0,
          ),
        }
      : null;
    const normalizedCurrentSalesStage = data.currentSalesStage
      ? {
          id: Number(data.currentSalesStage.id),
          code: String(data.currentSalesStage.code || ""),
          name: String(data.currentSalesStage.name || ""),
          order: Number(
            data.currentSalesStage.order ||
              data.currentSalesStage.stage_order ||
              0,
          ),
        }
      : normalizedSalesStage;
    const normalizedStages = Array.isArray(data.stages)
      ? data.stages.map((stage) => ({
          id: Number(stage.id),
          code: String(stage.code || ""),
          name: String(stage.name || ""),
          order: Number(stage.order || stage.stage_order || 0),
          isCurrent: Boolean(stage.isCurrent),
          isSelected: Boolean(stage.isSelected),
          isPast: Boolean(stage.isPast),
          isFuture: Boolean(stage.isFuture),
          isClosed: Boolean(stage.isClosed),
        }))
      : [];

    return {
      salesStage: normalizedSalesStage,
      currentSalesStage: normalizedCurrentSalesStage,
      bypassInfo: data.bypassInfo
        ? {
            isBypassed: Boolean(data.bypassInfo.isBypassed),
            reason: data.bypassInfo.reason || null,
          }
        : {
            isBypassed: false,
            reason: null,
          },
      commercialStatus: data.commercialStatus
        ? {
            id: Number(data.commercialStatus.id),
            code: String(data.commercialStatus.code || ""),
            name: String(data.commercialStatus.name || ""),
            closedAt: data.commercialStatus.closedAt || null,
            closeReason: data.commercialStatus.closeReason || null,
          }
        : null,
      isSelectedStageCurrent:
        data.isSelectedStageCurrent !== undefined
          ? Boolean(data.isSelectedStageCurrent)
          : Number(normalizedSalesStage?.id) ===
            Number(normalizedCurrentSalesStage?.id),
      stages:
        normalizedStages.length > 0
          ? normalizedStages
          : normalizedSalesStage
            ? [
                {
                  ...normalizedSalesStage,
                  isCurrent: true,
                  isSelected: true,
                  isPast: false,
                  isFuture: false,
                  isClosed: isCommercialOpportunityClosed(
                    data.commercialStatus?.code,
                  ),
                },
              ]
            : [],
      answers: Array.isArray(data.answers)
        ? data.answers.map((answer) => ({
            ...answer,
            question_id: Number(answer.question_id),
            answer_value:
              answer.answer_value === null || answer.answer_value === undefined
                ? ""
                : String(answer.answer_value),
          }))
        : [],
    };
  }

  function buildCommercialContextForDraftStage(
    baseContext,
    { currentStageId, selectedStageId = currentStageId },
  ) {
    if (!baseContext) return null;

    const currentStage =
      baseContext.stages.find(
        (stage) => Number(stage.id) === Number(currentStageId),
      ) ||
      baseContext.currentSalesStage ||
      baseContext.salesStage;
    const selectedStage =
      baseContext.stages.find(
        (stage) => Number(stage.id) === Number(selectedStageId),
      ) ||
      baseContext.salesStage ||
      currentStage;
    const currentOrder = Number(currentStage?.order || 0);

    return {
      ...baseContext,
      salesStage: selectedStage
        ? {
            id: Number(selectedStage.id),
            code: String(selectedStage.code || ""),
            name: String(selectedStage.name || ""),
            order: Number(selectedStage.order || 0),
          }
        : null,
      currentSalesStage: currentStage
        ? {
            id: Number(currentStage.id),
            code: String(currentStage.code || ""),
            name: String(currentStage.name || ""),
            order: Number(currentStage.order || 0),
          }
        : null,
      bypassInfo: baseContext.bypassInfo
        ? {
            isBypassed: Boolean(baseContext.bypassInfo.isBypassed),
            reason: baseContext.bypassInfo.reason || null,
          }
        : {
            isBypassed: false,
            reason: null,
          },
      isSelectedStageCurrent:
        Number(selectedStage?.id) === Number(currentStage?.id),
      stages: (baseContext.stages || []).map((stage) => ({
        ...stage,
        isCurrent: Number(stage.id) === Number(currentStage?.id),
        isSelected: Number(stage.id) === Number(selectedStage?.id),
        isPast: Number(stage.order || 0) < currentOrder,
        isFuture: Number(stage.order || 0) > currentOrder,
      })),
    };
  }

  useEffect(() => {
    if (!showOpportunityModal || editingOpportunityId) return;
    const defaults = buildDefaultOpportunityForm();
    setForm((prev) => ({
      ...prev,
      salesStageId: prev.salesStageId || defaults.salesStageId,
      sellerUserId: prev.sellerUserId || defaults.sellerUserId,
      activationStatusId:
        prev.activationStatusId || defaults.activationStatusId,
    }));
    const defaultCommercialContext = buildDefaultCommercialContext();
    setCommercialContext(defaultCommercialContext);
    setCommercialStageViewsById({});
    setDraftStageAction(null);
    setSelectedCommercialStageId(
      defaultCommercialContext?.salesStage?.id
        ? String(defaultCommercialContext.salesStage.id)
        : "",
    );
    setLoadingCommercialStageView(false);
    setCommercialCloseReason("");
    setPendingCommercialCloseAction(null);
    setShowCommercialCloseModal(false);
    setCommercialCloseModalState({ statusCode: "", reason: "" });
    setShowStageBypassModal(false);
    setStageBypassReason("");
  }, [showOpportunityModal, editingOpportunityId, catalogs, currentUser]);

  function openCreateOpportunityModal() {
    setError("");
    setSuccess("");
    setEditingOpportunityId(null);
    setEditOpportunityAudit(null);
    const defaultCommercialContext = buildDefaultCommercialContext();
    setCommercialContext(defaultCommercialContext);
    setCommercialStageViewsById({});
    setDraftStageAction(null);
    setSelectedCommercialStageId(
      defaultCommercialContext?.salesStage?.id
        ? String(defaultCommercialContext.salesStage.id)
        : "",
    );
    setLoadingCommercialStageView(false);
    setCommercialCloseReason("");
    setPendingCommercialCloseAction(null);
    setShowCommercialCloseModal(false);
    setCommercialCloseModalState({ statusCode: "", reason: "" });
    setShowStageBypassModal(false);
    setStageBypassReason("");
    setForm(buildDefaultOpportunityForm());
    setShowOpportunityModal(true);
  }

  async function hydrateOpportunityModal(opportunityId) {
    const [{ data }, { data: commercialData }] = await Promise.all([
      api.get(`/api/opportunities/${opportunityId}`),
      api.get(`/api/opportunities/${opportunityId}/commercial-context`),
    ]);

    setForm({
      name: data.name || "",
      amountUsd:
        data.amount_usd === null || data.amount_usd === undefined
          ? ""
          : formatOpportunityAmountInput(String(data.amount_usd)),
      accountId: String(data.account_id || ""),
      closeDate: data.close_date ? String(data.close_date).slice(0, 10) : "",
      contactId: String(data.contact_id || ""),
      salesStageId: String(data.sales_stage_id || ""),
      businessLineId: String(data.business_line_id || ""),
      sellerUserId: String(data.seller_user_id || ""),
      presalesUserId: data.presales_user_id
        ? String(data.presales_user_id)
        : "",
      activationStatusId: String(data.activation_status_id || ""),
    });
    setEditOpportunityAudit({
      createdByName: data.created_by_name || "",
      createdAt: data.created_at || "",
      updatedByName: data.updated_by_name || "",
      updatedAt: data.updated_at || "",
      activationStatus: data.activation_status || "",
      commercialStatus: data.commercial_status || "",
    });
    const normalizedCommercialContext =
      normalizeCommercialContext(commercialData);
    setCommercialContext(normalizedCommercialContext);
    setDraftStageAction(null);
    setCommercialStageViewsById(
      normalizedCommercialContext?.salesStage?.id
        ? {
            [String(normalizedCommercialContext.salesStage.id)]:
              normalizedCommercialContext,
          }
        : {},
    );
    setSelectedCommercialStageId(
      normalizedCommercialContext?.salesStage?.id
        ? String(normalizedCommercialContext.salesStage.id)
        : "",
    );
    setLoadingCommercialStageView(false);
    setCommercialCloseReason(
      normalizedCommercialContext?.commercialStatus?.closeReason || "",
    );
    setPendingCommercialCloseAction(null);
    setShowCommercialCloseModal(false);
    setCommercialCloseModalState({ statusCode: "", reason: "" });
    setShowStageBypassModal(false);
    setStageBypassReason("");
    setEditingOpportunityId(Number(opportunityId));
    setShowOpportunityModal(true);
  }

  async function openEditOpportunityModal(opportunityId) {
    setError("");
    setSuccess("");
    try {
      await hydrateOpportunityModal(opportunityId);
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible cargar la oportunidad"));
    }
  }

  function closeOpportunityModal() {
    if (savingOpportunity || savingCommercialAction) return;
    setShowOpportunityModal(false);
    setEditingOpportunityId(null);
    setEditOpportunityAudit(null);
    setCommercialContext(null);
    setCommercialStageViewsById({});
    setDraftStageAction(null);
    setSelectedCommercialStageId("");
    setLoadingCommercialStageView(false);
    setCommercialCloseReason("");
    setPendingCommercialCloseAction(null);
    setShowCommercialCloseModal(false);
    setCommercialCloseModalState({ statusCode: "", reason: "" });
    setShowStageBypassModal(false);
    setStageBypassReason("");
  }

  function getOpportunityStatusLabel(opportunity) {
    return opportunity.activation_status || "-";
  }

  function getOpportunityCommercialStatusLabel(opportunity) {
    return opportunity.commercial_status || "-";
  }

  function isOpportunityActive(opportunity) {
    return normalizeText(opportunity.activation_status) === "activada";
  }

  function isOpportunityPending(opportunity) {
    return (
      normalizeText(opportunity.activation_status) === "pendiente de activacion"
    );
  }

  function isOpportunityInactive(opportunity) {
    return normalizeText(opportunity.activation_status) === "desactivada";
  }

  function getOpportunityStatusBadgeClass(opportunity) {
    if (isOpportunityActive(opportunity)) {
      return "user-status-badge active";
    }
    if (isOpportunityPending(opportunity)) {
      return "user-status-badge pending";
    }
    return "user-status-badge inactive";
  }

  function getOpportunityStatusIconBadgeClass(statusValue) {
    if (normalizeText(statusValue) === "activada") {
      return "status-icon-badge active";
    }
    if (normalizeText(statusValue) === "pendiente de activacion") {
      return "status-icon-badge pending";
    }
    return "status-icon-badge inactive";
  }

  function getCommercialStatusBadgeClass(statusValue) {
    const normalized = normalizeText(statusValue);
    if (normalized === "en_proceso" || normalized === "en proceso") {
      return "user-status-badge pending";
    }
    if (normalized === "ganada") {
      return "user-status-badge won";
    }
    if (normalized === "perdida") {
      return "user-status-badge lost";
    }
    if (normalized === "anulada") {
      return "user-status-badge canceled";
    }
    return "user-status-badge inactive";
  }

  function getCommercialStatusIconBadgeClass(statusValue) {
    const normalized = normalizeText(statusValue);
    if (normalized === "en_proceso" || normalized === "en proceso") {
      return "status-icon-badge pending";
    }
    if (normalized === "ganada") {
      return "status-icon-badge won";
    }
    if (normalized === "perdida") {
      return "status-icon-badge lost";
    }
    if (normalized === "anulada") {
      return "status-icon-badge canceled";
    }
    return "status-icon-badge inactive";
  }

  function isCommercialOpportunityClosed(statusValue) {
    const normalized = normalizeText(statusValue);
    return (
      normalized === "ganada" ||
      normalized === "perdida" ||
      normalized === "anulada"
    );
  }

  function isCommercialOpportunityWaiting(statusValue) {
    return normalizeText(statusValue) === "waiting";
  }

  const filteredOpportunities = useMemo(() => {
    return opportunities.filter((opportunity) => {
      if (opportunityStatusFilter === "all") return true;
      if (opportunityStatusFilter === "pending") {
        return isOpportunityPending(opportunity);
      }
      if (opportunityStatusFilter === "inactive") {
        return isOpportunityInactive(opportunity);
      }
      return isOpportunityActive(opportunity);
    });
  }, [opportunities, opportunityStatusFilter]);

  const opportunityStatusCounts = useMemo(() => {
    return opportunities.reduce(
      (totals, opportunity) => {
        if (isOpportunityPending(opportunity)) {
          totals.pending += 1;
          return totals;
        }
        if (isOpportunityInactive(opportunity)) {
          totals.inactive += 1;
          return totals;
        }
        totals.active += 1;
        return totals;
      },
      { active: 0, pending: 0, inactive: 0 },
    );
  }, [opportunities]);

  const totalOpportunitiesCount =
    opportunityStatusCounts.active +
    opportunityStatusCounts.pending +
    opportunityStatusCounts.inactive;

  const sortedOpportunities = useMemo(() => {
    const list = [...filteredOpportunities];

    const readValue = (opportunity) => {
      if (opportunitySortField === "id") return Number(opportunity.id) || 0;
      if (opportunitySortField === "nombre")
        return String(opportunity.name || "");
      if (opportunitySortField === "cuenta")
        return String(opportunity.account_name || "");
      if (opportunitySortField === "vendedor")
        return String(opportunity.seller_user_name || "");
      if (opportunitySortField === "preventa")
        return String(opportunity.presales_user_name || "");
      if (opportunitySortField === "etapa")
        return String(opportunity.sales_stage || "");
      if (opportunitySortField === "estado_comercial")
        return String(getOpportunityCommercialStatusLabel(opportunity));
      if (opportunitySortField === "importe")
        return Number(opportunity.amount_usd) || 0;
      if (opportunitySortField === "cierre")
        return String(opportunity.close_date || "");
      if (opportunitySortField === "estado")
        return String(getOpportunityStatusLabel(opportunity));
      return "";
    };

    list.sort((a, b) => {
      const aValue = readValue(a);
      const bValue = readValue(b);

      let result = 0;
      if (typeof aValue === "number" && typeof bValue === "number") {
        result = aValue - bValue;
      } else {
        result = String(aValue).localeCompare(String(bValue), "es", {
          numeric: true,
          sensitivity: "base",
        });
      }

      return opportunitySortDirection === "asc" ? result : -result;
    });

    return list;
  }, [filteredOpportunities, opportunitySortField, opportunitySortDirection]);

  const visibleOpportunities = useMemo(() => {
    const q = opportunityQuery.trim().toLowerCase();
    if (!q) return sortedOpportunities;

    return sortedOpportunities.filter((opportunity) => {
      const haystack = [
        opportunity.id,
        opportunity.name,
        opportunity.account_name,
        opportunity.seller_user_name,
        opportunity.contact_name,
        opportunity.sales_stage,
        opportunity.business_line,
        opportunity.presales_user_name,
        opportunity.activation_status,
        opportunity.commercial_status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [sortedOpportunities, opportunityQuery]);

  // reset to page 1 when filters change
  useEffect(() => {
    setOpportunitiesPage(1);
  }, [opportunityQuery, opportunityStatusFilter, opportunitiesPerPage]);

  const totalOpportunityPages = Math.max(
    1,
    Math.ceil(visibleOpportunities.length / opportunitiesPerPage),
  );
  const pagedOpportunities = visibleOpportunities.slice(
    (opportunitiesPage - 1) * opportunitiesPerPage,
    opportunitiesPage * opportunitiesPerPage,
  );

  function toggleOpportunitySort(field) {
    if (opportunitySortField === field) {
      setOpportunitySortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setOpportunitySortField(field);
    setOpportunitySortDirection("asc");
  }

  function getOpportunitySortArrow(field) {
    if (opportunitySortField !== field) return "↕";
    return opportunitySortDirection === "asc" ? "↑" : "↓";
  }

  function formatDateTime(value) {
    if (!value) return "No registrado";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "No registrado";
    return date.toLocaleString("es-ES");
  }

  function formatCloseDate(value) {
    if (!value) return "-";
    const datePart = String(value).split("T")[0];
    const [year, month, day] = datePart.split("-");
    if (!year || !month || !day) return value;
    return `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year.slice(-2)}`;
  }

  function formatOpportunityAmountInput(value) {
    const rawValue = String(value || "")
      .replace(/,/g, "")
      .replace(/[^\d.]/g, "");
    if (!rawValue) return "";

    const hasDecimal = rawValue.includes(".");
    const [integerPartRaw, ...decimalRest] = rawValue.split(".");
    const decimalPart = decimalRest.join("");
    const integerPartNormalized =
      integerPartRaw.replace(/^0+(?=\d)/, "") || "0";
    const formattedInteger = integerPartNormalized.replace(
      /\B(?=(\d{3})+(?!\d))/g,
      ",",
    );

    if (!hasDecimal) return formattedInteger;
    return `${formattedInteger}.${decimalPart}`;
  }

  function parseOpportunityAmountInput(value) {
    return Number(String(value || "").replace(/,/g, ""));
  }

  const currentSalesStageName =
    catalogs.stages.find(
      (stage) => String(stage.id) === String(form.salesStageId),
    )?.name || "";

  const currentCommercialStage =
    commercialContext?.currentSalesStage ||
    commercialContext?.salesStage ||
    null;
  const selectedCommercialStage = commercialContext?.salesStage || null;
  const hasPendingStageChange = Boolean(
    draftStageAction &&
    Number(draftStageAction.fromStageId) !== Number(draftStageAction.toStageId),
  );
  const hasPendingCommercialClose = Boolean(pendingCommercialCloseAction);
  const canRetreatToSelectedStage = Boolean(
    selectedCommercialStage &&
    currentCommercialStage &&
    Number(selectedCommercialStage.order || 0) <
      Number(currentCommercialStage.order || 0),
  );
  const currentCommercialStageIndex = (
    commercialContext?.stages || []
  ).findIndex(
    (stage) => Number(stage.id) === Number(currentCommercialStage?.id),
  );
  const canBypassCurrentStage =
    currentCommercialStageIndex > -1 &&
    currentCommercialStageIndex < (commercialContext?.stages || []).length - 1;
  const hasImmediatePreviousStage =
    normalizeText(currentCommercialStage?.code) !== "contacto_inicial";

  const isSelectedCommercialStageReadOnly =
    Boolean(editingOpportunityId) &&
    Boolean(commercialContext) &&
    !commercialContext.isSelectedStageCurrent;

  const isCommercialFlowClosed = isCommercialOpportunityClosed(
    commercialContext?.commercialStatus?.code,
  );

  const currentCommercialStatusName =
    commercialContext?.commercialStatus?.name ||
    catalogs.commercialStatuses.find(
      (status) => normalizeText(status.code) === "en_proceso",
    )?.name ||
    "En proceso";
  const displayedCommercialCloseReason =
    pendingCommercialCloseAction?.reason ||
    commercialContext?.commercialStatus?.closeReason ||
    "";
  const pendingCommercialCloseStatusName = pendingCommercialCloseAction
    ? catalogs.commercialStatuses.find(
        (status) =>
          String(status.code) ===
          String(pendingCommercialCloseAction.statusCode),
      )?.name || pendingCommercialCloseAction.statusCode
    : "";

  function updateCommercialAnswer(questionId, nextValue) {
    setCommercialContext((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        answers: prev.answers.map((answer) =>
          Number(answer.question_id) === Number(questionId)
            ? { ...answer, answer_value: nextValue }
            : answer,
        ),
      };
    });
  }

  function buildStageAnswersPayload() {
    if (
      !commercialContext?.answers?.length ||
      !commercialContext.isSelectedStageCurrent
    ) {
      return [];
    }
    return commercialContext.answers
      .map((answer) => ({
        questionId: Number(answer.question_id),
        answerValue: String(answer.answer_value || "").trim(),
      }))
      .filter((answer) => answer.answerValue);
  }

  async function refreshOpportunityCommercialView() {
    if (!editingOpportunityId) return;
    await hydrateOpportunityModal(editingOpportunityId);
    await load();
  }

  async function handleCommercialStageSelect(salesStageId) {
    const nextStageId = String(salesStageId || "");
    if (!editingOpportunityId || !nextStageId) return;
    if (nextStageId === String(commercialContext?.salesStage?.id || "")) {
      setSelectedCommercialStageId(nextStageId);
      return;
    }

    setError("");
    setSuccess("");
    setSelectedCommercialStageId(nextStageId);

    const cachedStageView = commercialStageViewsById[nextStageId];
    const draftCurrentStageId = Number(
      form.salesStageId ||
        commercialContext?.currentSalesStage?.id ||
        nextStageId,
    );
    if (cachedStageView) {
      setCommercialContext(
        buildCommercialContextForDraftStage(cachedStageView, {
          currentStageId: draftCurrentStageId,
          selectedStageId: Number(nextStageId),
        }),
      );
      return;
    }

    setLoadingCommercialStageView(true);
    try {
      const { data } = await api.get(
        `/api/opportunities/${editingOpportunityId}/stage-view/${nextStageId}`,
      );
      const normalizedStageView = normalizeCommercialContext(data);
      setCommercialContext(
        buildCommercialContextForDraftStage(normalizedStageView, {
          currentStageId: draftCurrentStageId,
          selectedStageId: Number(nextStageId),
        }),
      );
      setCommercialStageViewsById((prev) => ({
        ...prev,
        [nextStageId]: normalizedStageView,
      }));
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible cargar la etapa seleccionada"),
      );
      setSelectedCommercialStageId(
        String(commercialContext?.salesStage?.id || ""),
      );
    } finally {
      setLoadingCommercialStageView(false);
    }
  }

  async function previewStageDraftChange({
    mode,
    reason = null,
    targetStageId = null,
  }) {
    const orderedStages = [...(commercialContext?.stages || [])].sort(
      (left, right) => Number(left.order || 0) - Number(right.order || 0),
    );
    const currentStageIndex = orderedStages.findIndex(
      (stage) => Number(stage.id) === Number(currentCommercialStage?.id),
    );
    if (currentStageIndex === -1) {
      setError("No fue posible determinar la etapa actual");
      return false;
    }

    const targetStage =
      mode === "advance" || mode === "bypass"
        ? orderedStages[currentStageIndex + 1] || null
        : targetStageId
          ? orderedStages.find(
              (stage) => Number(stage.id) === Number(targetStageId),
            ) || null
          : orderedStages[currentStageIndex - 1] || null;

    if (!targetStage) {
      setError(
        mode === "retreat"
          ? "La oportunidad ya esta en la primera etapa operativa"
          : "La oportunidad ya esta en la ultima etapa operativa",
      );
      return false;
    }

    if (
      mode === "retreat" &&
      Number(targetStage.order || 0) >=
        Number(currentCommercialStage?.order || 0)
    ) {
      setError("Selecciona una etapa anterior para regresar la oportunidad");
      return false;
    }

    const nextStageId = String(targetStage.id);
    const cachedStageView = commercialStageViewsById[nextStageId];

    setLoadingCommercialStageView(true);
    try {
      const normalizedStageView = cachedStageView
        ? cachedStageView
        : normalizeCommercialContext(
            (
              await api.get(
                `/api/opportunities/${editingOpportunityId}/stage-view/${nextStageId}`,
              )
            ).data,
          );

      if (!cachedStageView) {
        setCommercialStageViewsById((prev) => ({
          ...prev,
          [nextStageId]: normalizedStageView,
        }));
      }

      setForm((prev) => ({
        ...prev,
        salesStageId: nextStageId,
      }));
      setDraftStageAction({
        mode,
        fromStageId: Number(currentCommercialStage?.id),
        toStageId: Number(targetStage.id),
        reason: reason || null,
      });
      setSelectedCommercialStageId(nextStageId);
      setCommercialContext(
        buildCommercialContextForDraftStage(normalizedStageView, {
          currentStageId: Number(targetStage.id),
          selectedStageId: Number(targetStage.id),
        }),
      );
      setSuccess(
        `Cambio de etapa pendiente. Presiona Guardar cambios para grabar ${targetStage.name}.`,
      );
      return true;
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible preparar el cambio de etapa"),
      );
      return false;
    } finally {
      setLoadingCommercialStageView(false);
    }
  }

  async function saveCommercialAnswers({ silentSuccess = false } = {}) {
    if (!editingOpportunityId || !commercialContext) return true;
    if (!commercialContext.isSelectedStageCurrent) {
      setError("Selecciona la etapa actual para editar respuestas");
      return false;
    }
    const answersPayload = buildStageAnswersPayload();
    if (!answersPayload.length) {
      setError("Debes capturar al menos una respuesta para guardar la etapa");
      return false;
    }

    try {
      await api.post(
        `/api/opportunities/${editingOpportunityId}/stage-answers`,
        {
          answers: answersPayload,
        },
      );
      await refreshOpportunityCommercialView();
      if (!silentSuccess) {
        setSuccess("Respuestas de etapa guardadas");
      }
      return true;
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible guardar las respuestas de etapa",
        ),
      );
      return false;
    }
  }

  async function handleStageTransition(direction) {
    setError("");
    setSuccess("");
    if (hasPendingStageChange) {
      setError(
        "Ya hay un cambio de etapa pendiente. Presiona Guardar cambios o cancela la edición.",
      );
      return;
    }
    if (direction !== "retreat" && !commercialContext?.isSelectedStageCurrent) {
      setError("Selecciona la etapa actual para mover la oportunidad");
      return;
    }
    if (
      direction === "retreat" &&
      !canRetreatToSelectedStage &&
      !hasImmediatePreviousStage
    ) {
      setError("Selecciona una etapa anterior para regresar la oportunidad");
      return;
    }
    setSavingCommercialAction(direction);
    try {
      if (direction === "advance") {
        const saved = await saveCommercialAnswers({ silentSuccess: true });
        if (!saved) return;
      }
      await previewStageDraftChange({
        mode: direction,
        targetStageId:
          direction === "retreat" && canRetreatToSelectedStage
            ? Number(selectedCommercialStage?.id)
            : null,
      });
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible actualizar la etapa comercial"),
      );
    } finally {
      setSavingCommercialAction("");
    }
  }

  async function handleCurrentStageValidation() {
    setError("");
    setSuccess("");
    if (hasPendingStageChange) {
      setError("Guarda cambios antes de validar la nueva etapa seleccionada.");
      return;
    }
    if (hasPendingCommercialClose) {
      setError("Guarda cambios antes de validar la oportunidad cerrada.");
      return;
    }
    if (!commercialContext?.isSelectedStageCurrent) {
      setError("Selecciona la etapa actual para validarla");
      return;
    }
    setSavingCommercialAction("validate-current-stage");
    try {
      const { data } = await api.post(
        `/api/opportunities/${editingOpportunityId}/validate-current-stage`,
        {},
      );
      setSuccess(data?.message || "Etapa actual validada");
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible validar la etapa actual"),
      );
    } finally {
      setSavingCommercialAction("");
    }
  }

  async function handleStageBypass() {
    setError("");
    setSuccess("");
    if (hasPendingStageChange) {
      setError(
        "Ya hay un cambio de etapa pendiente. Presiona Guardar cambios o cancela la edición.",
      );
      return;
    }
    if (hasPendingCommercialClose) {
      setError(
        "Guarda cambios antes de intentar otra acción del proceso comercial.",
      );
      return;
    }
    if (!commercialContext?.isSelectedStageCurrent) {
      setError("Selecciona la etapa actual para bypasearla");
      return;
    }
    if (!canBypassCurrentStage) {
      setError("La oportunidad ya esta en la ultima etapa operativa");
      return;
    }

    setStageBypassReason("");
    setShowStageBypassModal(true);
  }

  function closeStageBypassModal() {
    if (savingCommercialAction === "stage-bypass") return;
    setShowStageBypassModal(false);
    setStageBypassReason("");
  }

  async function confirmStageBypass() {
    const reason = String(stageBypassReason || "").trim();
    if (!reason) {
      setError("Debes indicar un motivo para bypasear la etapa");
      return;
    }

    setError("");
    setSuccess("");
    setSavingCommercialAction("stage-bypass");
    try {
      await previewStageDraftChange({ mode: "bypass", reason });
      setShowStageBypassModal(false);
      setStageBypassReason("");
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible bypasear la etapa actual"),
      );
    } finally {
      setSavingCommercialAction("");
    }
  }

  async function handleCommercialClose(statusCode) {
    setError("");
    setSuccess("");
    if (hasPendingStageChange) {
      setError("Guarda cambios antes de cerrar comercialmente la oportunidad.");
      return;
    }
    if (!commercialContext?.isSelectedStageCurrent) {
      setError("Selecciona la etapa actual para cerrar comercialmente");
      return;
    }
    if (statusCode === "perdida" || statusCode === "anulada") {
      setCommercialCloseModalState({
        statusCode,
        reason:
          pendingCommercialCloseAction?.statusCode === statusCode
            ? pendingCommercialCloseAction.reason
            : "",
      });
      setShowCommercialCloseModal(true);
      return;
    }
    setSavingCommercialAction(statusCode);
    try {
      const payload = {
        statusCode,
        reason:
          statusCode === "perdida" || statusCode === "anulada"
            ? commercialCloseReason
            : null,
      };
      const { data } = await api.post(
        `/api/opportunities/${editingOpportunityId}/commercial-close`,
        payload,
      );
      await refreshOpportunityCommercialView();
      setSuccess(data?.message || "Cierre comercial actualizado");
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible cerrar comercialmente la oportunidad",
        ),
      );
    } finally {
      setSavingCommercialAction("");
    }
  }

  function closeCommercialCloseModal() {
    if (savingCommercialAction === "commercial-close-draft") return;
    setShowCommercialCloseModal(false);
    setCommercialCloseModalState({ statusCode: "", reason: "" });
  }

  function confirmCommercialCloseDraft() {
    const reason = String(commercialCloseModalState.reason || "").trim();
    if (!reason) {
      setError("Debes indicar un motivo para cerrar la oportunidad");
      return;
    }

    const statusCode = commercialCloseModalState.statusCode;
    const statusName =
      catalogs.commercialStatuses.find(
        (status) => String(status.code) === String(statusCode),
      )?.name || statusCode;

    setError("");
    setSuccess(
      `Cierre comercial pendiente como ${statusName}. Presiona Guardar cambios para grabarlo.`,
    );
    setPendingCommercialCloseAction({ statusCode, reason });
    setCommercialCloseReason(reason);
    setShowCommercialCloseModal(false);
    setCommercialCloseModalState({ statusCode: "", reason: "" });
  }

  async function saveOpportunity(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (!form.sellerUserId) {
      setError("Selecciona un vendedor");
      return;
    }

    setSavingOpportunity(true);
    try {
      if (
        editingOpportunityId &&
        commercialContext?.isSelectedStageCurrent &&
        !isCommercialFlowClosed &&
        !hasPendingStageChange &&
        !hasPendingCommercialClose &&
        buildStageAnswersPayload().length
      ) {
        const savedAnswers = await saveCommercialAnswers({
          silentSuccess: true,
        });
        if (!savedAnswers) {
          setSavingOpportunity(false);
          return;
        }
      }

      const payload = {
        name: form.name,
        amountUsd: parseOpportunityAmountInput(form.amountUsd),
        accountId: Number(form.accountId),
        closeDate: form.closeDate,
        contactId: Number(form.contactId),
        businessLineId: Number(form.businessLineId),
        sellerUserId: Number(form.sellerUserId),
        presalesUserId: form.presalesUserId
          ? Number(form.presalesUserId)
          : null,
        activationStatusId: Number(form.activationStatusId),
      };

      if (!editingOpportunityId) {
        payload.salesStageId = Number(form.salesStageId);
      } else if (form.salesStageId) {
        payload.salesStageId = Number(form.salesStageId);
      }

      if (editingOpportunityId && hasPendingStageChange) {
        payload.stageChangeMode = draftStageAction.mode;
        payload.stageChangeReason = draftStageAction.reason || null;
      }

      if (editingOpportunityId && hasPendingCommercialClose) {
        payload.commercialStatusCode = pendingCommercialCloseAction.statusCode;
        payload.commercialCloseReason = pendingCommercialCloseAction.reason;
      }

      const { data } = editingOpportunityId
        ? await api.put(`/api/opportunities/${editingOpportunityId}`, payload)
        : await api.post("/api/opportunities", payload);

      setSuccess(
        data?.message ||
          (editingOpportunityId
            ? "Oportunidad actualizada correctamente"
            : "Oportunidad creada correctamente"),
      );
      setShowOpportunityModal(false);
      setEditingOpportunityId(null);
      setEditOpportunityAudit(null);
      setCommercialContext(null);
      setCommercialStageViewsById({});
      setDraftStageAction(null);
      setSelectedCommercialStageId("");
      setCommercialCloseReason("");
      setPendingCommercialCloseAction(null);
      setShowCommercialCloseModal(false);
      setCommercialCloseModalState({ statusCode: "", reason: "" });
      setShowStageBypassModal(false);
      setStageBypassReason("");
      await load();
    } catch (err) {
      const fieldErrors = err?.response?.data?.errors?.fieldErrors;
      if (fieldErrors && typeof fieldErrors === "object") {
        const firstError = Object.entries(fieldErrors).find(
          ([, messages]) => Array.isArray(messages) && messages.length > 0,
        );
        if (firstError) {
          const [fieldName, messages] = firstError;
          setError(`${fieldName}: ${messages[0]}`);
          setSavingOpportunity(false);
          return;
        }
      }
      setError(
        getApiErrorMessage(err, "No fue posible guardar la oportunidad"),
      );
    } finally {
      setSavingOpportunity(false);
    }
  }

  function toggleOpportunityMenu(opportunityId) {
    setOpenOpportunityMenuId((prev) =>
      prev === opportunityId ? null : opportunityId,
    );
  }

  async function runOpportunityAction(action) {
    try {
      await action();
    } finally {
      setOpenOpportunityMenuId(null);
    }
  }

  async function updateOpportunityStatus(opportunity, statusCode) {
    setError("");
    setSuccess("");
    try {
      const { data } = await api.patch(
        `/api/opportunities/${opportunity.id}/status`,
        { statusCode },
      );
      setSuccess(data?.message || "Estado de oportunidad actualizado");
      await load();
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible actualizar el estado de la oportunidad",
        ),
      );
    }
  }

  const contactOptions = useMemo(() => {
    if (!form.accountId) return [];
    return catalogs.contacts.filter(
      (contact) => Number(contact.account_id) === Number(form.accountId),
    );
  }, [catalogs.contacts, form.accountId]);

  useEffect(() => {
    if (!form.contactId) return;
    const isValidContact = contactOptions.some(
      (contact) => Number(contact.id) === Number(form.contactId),
    );
    if (isValidContact) return;

    setForm((prev) => ({ ...prev, contactId: "" }));
  }, [contactOptions, form.contactId]);

  return (
    <section className="panel">
      <div className="roles-page-header">
        <div className="roles-page-header-left">
          <div className="module-title-with-icon">
            <h2>Oportunidades</h2>
            <span
              className="module-title-icon module-title-icon-opportunities"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M5 18.5a.75.75 0 0 1-.75-.75V6.25A2.25 2.25 0 0 1 6.5 4h11a2.25 2.25 0 0 1 2.25 2.25v11.5a.75.75 0 0 1-1.5 0V6.25a.75.75 0 0 0-.75-.75h-11a.75.75 0 0 0-.75.75v11.5a.75.75 0 0 1-.75.75" />
                <path d="M8.25 15.75a.75.75 0 0 1-.53-1.28l2.72-2.72a.75.75 0 0 1 1.06 0l1.25 1.25 3.22-3.22a.75.75 0 1 1 1.06 1.06l-3.75 3.75a.75.75 0 0 1-1.06 0L11 13.34l-2.19 2.19a.75.75 0 0 1-.56.22" />
              </svg>
            </span>
          </div>
          <p className="roles-subtitle">
            Gestiona las oportunidades comerciales y su seguimiento
          </p>
        </div>
        {canCreateOrRequestOpportunities && (
          <button
            type="button"
            className="btn-primary"
            onClick={openCreateOpportunityModal}
          >
            + Crear oportunidad
          </button>
        )}
      </div>

      <div className="roles-pills-bar accounts-pills-bar-row">
        <div
          className="accounts-status-pills"
          role="group"
          aria-label="Filtrar oportunidades por estado"
        >
          <button
            type="button"
            className={
              opportunityStatusFilter === "active"
                ? "status-filter-pill status-filter-pill-active is-selected"
                : "status-filter-pill status-filter-pill-active"
            }
            aria-pressed={opportunityStatusFilter === "active"}
            onClick={() => setOpportunityStatusFilter("active")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Activas</span>
            <span className="status-filter-pill-count">
              {opportunityStatusCounts.active}
            </span>
          </button>
          <button
            type="button"
            className={
              opportunityStatusFilter === "pending"
                ? "status-filter-pill status-filter-pill-pending is-selected"
                : "status-filter-pill status-filter-pill-pending"
            }
            aria-pressed={opportunityStatusFilter === "pending"}
            onClick={() => setOpportunityStatusFilter("pending")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Pendientes</span>
            <span className="status-filter-pill-count">
              {opportunityStatusCounts.pending}
            </span>
          </button>
          <button
            type="button"
            className={
              opportunityStatusFilter === "inactive"
                ? "status-filter-pill status-filter-pill-inactive is-selected"
                : "status-filter-pill status-filter-pill-inactive"
            }
            aria-pressed={opportunityStatusFilter === "inactive"}
            onClick={() => setOpportunityStatusFilter("inactive")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Desactivadas</span>
            <span className="status-filter-pill-count">
              {opportunityStatusCounts.inactive}
            </span>
          </button>
          <button
            type="button"
            className={
              opportunityStatusFilter === "all"
                ? "status-filter-pill status-filter-pill-all is-selected"
                : "status-filter-pill status-filter-pill-all"
            }
            aria-pressed={opportunityStatusFilter === "all"}
            onClick={() => setOpportunityStatusFilter("all")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Todas</span>
            <span className="status-filter-pill-count">
              {totalOpportunitiesCount}
            </span>
          </button>
        </div>
        <input
          className="accounts-search-inline"
          type="text"
          placeholder="Buscar por nombre, ID, cuenta, vendedor, contacto, etapa o línea"
          value={opportunityQuery}
          onChange={(e) => setOpportunityQuery(e.target.value)}
        />
      </div>

      {showOpportunityModal && (
        <div className="modal-overlay" onClick={closeOpportunityModal}>
          <div
            className="modal-dialog modal-dialog-account"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3 className="modal-title">
                {editingOpportunityId
                  ? "Editar oportunidad"
                  : "Crear oportunidad"}
              </h3>
              {editingOpportunityId && editOpportunityAudit ? (
                <div className="opportunity-modal-header-meta">
                  <span
                    className="record-id-badge"
                    title="ID de la oportunidad"
                  >
                    <span className="record-id-icon" aria-hidden="true">
                      #
                    </span>
                    {editingOpportunityId}
                  </span>
                  <span className="record-id-badge" title="Etapa de venta">
                    Etapa:{" "}
                    {currentCommercialStage?.name ||
                      currentSalesStageName ||
                      "-"}
                  </span>
                  <span
                    className={getOpportunityStatusIconBadgeClass(
                      editOpportunityAudit.activationStatus,
                    )}
                    title="Estado de activacion"
                  >
                    <span className="status-dot" aria-hidden="true" />
                    {editOpportunityAudit.activationStatus || "Sin estado"}
                  </span>
                  <span
                    className={getCommercialStatusIconBadgeClass(
                      editOpportunityAudit.commercialStatus,
                    )}
                    title="Estado comercial"
                  >
                    <span className="status-dot" aria-hidden="true" />
                    {editOpportunityAudit.commercialStatus ||
                      "Sin estado comercial"}
                  </span>
                </div>
              ) : null}
            </div>

            <p className="modal-message account-modal-message">
              {editingOpportunityId
                ? "Actualiza la información de la oportunidad y guarda los cambios."
                : "Completa la información principal para registrar la oportunidad."}
            </p>

            {!editingOpportunityId && (
              <p className="field-hint">
                El ID de la oportunidad se asigna automaticamente y coincide con
                el ID interno.
              </p>
            )}

            <form
              className="account-create-form in-modal"
              onSubmit={saveOpportunity}
            >
              <section className="account-form-section">
                <h4>Datos principales</h4>
                <div className="grid-form account-grid-main">
                  <div className="field-group">
                    <label>
                      Nombre de la oportunidad{" "}
                      <span className="required-mark">*</span>
                    </label>
                    <input
                      value={form.name}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, name: e.target.value }))
                      }
                      required
                    />
                  </div>
                  <div className="field-group">
                    <label>
                      Importe en dólares{" "}
                      <span className="required-mark">*</span>
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="Ej. 50,000"
                      value={form.amountUsd}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          amountUsd: formatOpportunityAmountInput(
                            e.target.value,
                          ),
                        }))
                      }
                      required
                    />
                  </div>
                  <div className="field-group">
                    <label>
                      Fecha de cierre <span className="required-mark">*</span>
                    </label>
                    <DatePicker
                      selected={parseDateFilterValue(form.closeDate)}
                      onChange={(date) =>
                        setForm((prev) => ({
                          ...prev,
                          closeDate: formatDateFilterValue(date),
                        }))
                      }
                      placeholderText="Selecciona fecha"
                      dateFormat="dd/MM/yyyy"
                      locale={es}
                      showMonthDropdown
                      showYearDropdown
                      dropdownMode="select"
                      fixedHeight
                      todayButton="Hoy"
                      calendarClassName="audit-datepicker-calendar"
                      popperClassName="audit-datepicker-popper"
                      className="audit-date-input"
                      autoComplete="off"
                      isClearable={false}
                      showPopperArrow={false}
                      required
                    />
                  </div>
                  <div className="field-group">
                    <label>
                      Cuenta <span className="required-mark">*</span>
                    </label>
                    <select
                      value={form.accountId}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          accountId: e.target.value,
                          contactId: "",
                        }))
                      }
                      required
                    >
                      <option value="">Selecciona cuenta</option>
                      {catalogs.accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field-group">
                    <label>
                      Contacto de la cuenta{" "}
                      <span className="required-mark">*</span>
                    </label>
                    <select
                      value={form.contactId}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          contactId: e.target.value,
                        }))
                      }
                      required
                    >
                      <option value="">Selecciona contacto</option>
                      {contactOptions.map((contact) => (
                        <option key={contact.id} value={contact.id}>
                          {contact.full_name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>

              <section className="account-form-section">
                <h4>Gestion comercial</h4>
                <div className="grid-form account-grid-main">
                  {!editingOpportunityId ? (
                    <div className="field-group">
                      <label>
                        Etapa de venta <span className="required-mark">*</span>
                      </label>
                      <input
                        aria-label="Etapa de venta"
                        value={currentSalesStageName}
                        readOnly
                      />
                    </div>
                  ) : null}
                  <div className="field-group">
                    <label>
                      Linea de negocio <span className="required-mark">*</span>
                    </label>
                    <select
                      value={form.businessLineId}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          businessLineId: e.target.value,
                        }))
                      }
                      required
                    >
                      <option value="">Selecciona linea</option>
                      {catalogs.businessLines.map((line) => (
                        <option key={line.id} value={line.id}>
                          {line.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field-group">
                    <label>
                      Vendedor <span className="required-mark">*</span>
                    </label>
                    <select
                      value={form.sellerUserId}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          sellerUserId: e.target.value,
                        }))
                      }
                      required
                    >
                      <option value="">Selecciona vendedor</option>
                      {catalogs.sellerUsers.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.full_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field-group">
                    <label>Ingeniero preventa</label>
                    <select
                      value={form.presalesUserId}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          presalesUserId: e.target.value,
                        }))
                      }
                    >
                      <option value="">Sin preventa</option>
                      {catalogs.presalesUsers.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.full_name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>

              {editingOpportunityId && commercialContext && (
                <section className="account-form-section opportunity-commercial-section">
                  <div className="opportunity-commercial-section-header">
                    <div>
                      <h4>Proceso comercial</h4>
                      <p className="field-hint opportunity-commercial-hint">
                        Haz clic en una etapa para revisar sus preguntas. Solo
                        la etapa actual permite editar respuestas, mover la
                        oportunidad o cerrar el proceso comercial.
                      </p>
                    </div>
                    <div className="opportunity-commercial-badges">
                      <span className="record-id-badge">
                        Etapa actual: {currentCommercialStage?.name || "-"}
                      </span>
                      <span
                        className={getCommercialStatusIconBadgeClass(
                          commercialContext.commercialStatus?.name,
                        )}
                      >
                        <span className="status-dot" aria-hidden="true" />
                        {commercialContext.commercialStatus?.name ||
                          "Sin estado comercial"}
                      </span>
                    </div>
                  </div>

                  <div
                    className="opportunity-stage-stepper"
                    role="tablist"
                    aria-label="Etapas del proceso comercial"
                  >
                    {commercialContext.stages.map((stage) => {
                      const isSelected =
                        String(stage.id) === String(selectedCommercialStageId);
                      const stateLabel = stage.isCurrent
                        ? "Etapa actual"
                        : stage.isPast
                          ? "Solo lectura"
                          : "Vista previa";
                      const className = [
                        "opportunity-stage-step",
                        isSelected ? "is-selected" : "",
                        stage.isCurrent ? "is-current" : "",
                        stage.isPast ? "is-past" : "",
                        stage.isFuture ? "is-future" : "",
                      ]
                        .filter(Boolean)
                        .join(" ");

                      return (
                        <button
                          key={stage.id}
                          type="button"
                          className={className}
                          onClick={() => handleCommercialStageSelect(stage.id)}
                          aria-pressed={isSelected}
                          disabled={loadingCommercialStageView && isSelected}
                        >
                          <span className="opportunity-stage-step-line" />
                          <span className="opportunity-stage-step-circle-wrap">
                            <span className="opportunity-stage-step-order">
                              {stage.order}
                            </span>
                          </span>
                          <span className="opportunity-stage-step-content">
                            <strong>{stage.name}</strong>
                            <small>{stateLabel}</small>
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {loadingCommercialStageView ? (
                    <p className="field-hint opportunity-commercial-hint">
                      Cargando etapa seleccionada...
                    </p>
                  ) : null}

                  {hasPendingStageChange ? (
                    <p className="field-hint opportunity-stage-readonly-banner">
                      Hay un cambio de etapa pendiente hacia{" "}
                      {currentCommercialStage?.name || "la etapa seleccionada"}.
                      Presiona Guardar cambios para grabarlo o cierra el modal
                      para descartarlo.
                    </p>
                  ) : null}

                  {hasPendingCommercialClose ? (
                    <p className="field-hint opportunity-stage-readonly-banner">
                      Hay un cierre comercial pendiente como{" "}
                      {pendingCommercialCloseStatusName ||
                        "estado seleccionado"}
                      . Presiona Guardar cambios para grabarlo o cierra el modal
                      para descartarlo.
                    </p>
                  ) : null}

                  {isSelectedCommercialStageReadOnly ? (
                    <p className="field-hint opportunity-stage-readonly-banner">
                      Estás revisando la etapa{" "}
                      {commercialContext.salesStage?.name || "seleccionada"}.
                      Esta vista es solo lectura porque la oportunidad sigue en{" "}
                      {currentCommercialStage?.name || "la etapa actual"}.
                    </p>
                  ) : null}

                  {commercialContext.bypassInfo?.isBypassed ? (
                    <div className="opportunity-stage-bypass-summary">
                      <p className="field-hint opportunity-stage-readonly-banner">
                        Esta etapa fue bypaseada. Solo se muestra el motivo del
                        bypass.
                      </p>
                      <div className="field-group opportunity-stage-question">
                        <label>Motivo del bypass</label>
                        <textarea
                          aria-label="Motivo del bypass aplicado"
                          rows={3}
                          value={
                            commercialContext.bypassInfo.reason ||
                            "Sin motivo registrado"
                          }
                          disabled
                        />
                      </div>
                    </div>
                  ) : commercialContext.answers.length > 0 ? (
                    <div className="opportunity-stage-questions">
                      {commercialContext.answers.map((answer) => (
                        <div
                          key={answer.question_id}
                          className="field-group opportunity-stage-question"
                        >
                          <label>
                            {answer.prompt}{" "}
                            {answer.is_required ? (
                              <span className="required-mark">*</span>
                            ) : null}
                          </label>
                          <textarea
                            aria-label={`${answer.prompt}${
                              answer.is_required ? " *" : ""
                            }`}
                            rows={3}
                            value={answer.answer_value}
                            onChange={(e) =>
                              updateCommercialAnswer(
                                answer.question_id,
                                e.target.value,
                              )
                            }
                            disabled={
                              isCommercialFlowClosed ||
                              !commercialContext.isSelectedStageCurrent ||
                              hasPendingStageChange
                            }
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="field-hint opportunity-commercial-hint">
                      Esta etapa no tiene preguntas activas configuradas.
                    </p>
                  )}

                  {displayedCommercialCloseReason ? (
                    <div className="field-group opportunity-close-reason-group">
                      <label>Motivo de cierre comercial</label>
                      <textarea
                        aria-label="Motivo de cierre comercial"
                        rows={3}
                        value={displayedCommercialCloseReason}
                        disabled
                      />
                    </div>
                  ) : null}

                  <div className="opportunity-commercial-actions">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={handleCurrentStageValidation}
                      disabled={
                        Boolean(savingCommercialAction) ||
                        isCommercialFlowClosed ||
                        !commercialContext.isSelectedStageCurrent ||
                        hasPendingStageChange ||
                        hasPendingCommercialClose
                      }
                    >
                      {savingCommercialAction === "validate-current-stage"
                        ? "Validando..."
                        : "Validar etapa actual"}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={handleStageBypass}
                      disabled={
                        Boolean(savingCommercialAction) ||
                        isCommercialFlowClosed ||
                        !commercialContext.isSelectedStageCurrent ||
                        hasPendingStageChange ||
                        hasPendingCommercialClose ||
                        !canBypassCurrentStage
                      }
                    >
                      {savingCommercialAction === "stage-bypass"
                        ? "Bypaseando..."
                        : "Bypasear etapa"}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => handleStageTransition("retreat")}
                      disabled={
                        Boolean(savingCommercialAction) ||
                        isCommercialFlowClosed ||
                        hasPendingStageChange ||
                        hasPendingCommercialClose ||
                        (!commercialContext.isSelectedStageCurrent &&
                          !canRetreatToSelectedStage) ||
                        (!canRetreatToSelectedStage &&
                          !hasImmediatePreviousStage)
                      }
                    >
                      {savingCommercialAction === "retreat"
                        ? "Retrocediendo..."
                        : canRetreatToSelectedStage
                          ? "Regresar a etapa seleccionada"
                          : "Regresar etapa anterior"}
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => handleStageTransition("advance")}
                      disabled={
                        Boolean(savingCommercialAction) ||
                        isCommercialFlowClosed ||
                        !commercialContext.isSelectedStageCurrent ||
                        hasPendingStageChange ||
                        hasPendingCommercialClose
                      }
                    >
                      {savingCommercialAction === "advance"
                        ? "Avanzando..."
                        : "Avanzar etapa"}
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => handleCommercialClose("ganada")}
                      disabled={
                        Boolean(savingCommercialAction) ||
                        isCommercialFlowClosed ||
                        !commercialContext.isSelectedStageCurrent ||
                        hasPendingStageChange ||
                        hasPendingCommercialClose ||
                        !isCommercialOpportunityWaiting(
                          currentCommercialStage?.code,
                        )
                      }
                    >
                      {savingCommercialAction === "ganada"
                        ? "Cerrando..."
                        : "Marcar ganada"}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => handleCommercialClose("perdida")}
                      disabled={
                        Boolean(savingCommercialAction) ||
                        isCommercialFlowClosed ||
                        !commercialContext.isSelectedStageCurrent ||
                        hasPendingStageChange
                      }
                    >
                      {savingCommercialAction === "perdida"
                        ? "Cerrando..."
                        : "Marcar perdida"}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => handleCommercialClose("anulada")}
                      disabled={
                        Boolean(savingCommercialAction) ||
                        isCommercialFlowClosed ||
                        !commercialContext.isSelectedStageCurrent ||
                        hasPendingStageChange
                      }
                    >
                      {savingCommercialAction === "anulada"
                        ? "Cerrando..."
                        : "Marcar anulada"}
                    </button>
                  </div>
                </section>
              )}

              {editingOpportunityId && editOpportunityAudit && (
                <section className="account-form-section modal-audit-strip">
                  <h4>Auditoria</h4>
                  <div className="role-audit-grid">
                    <div className="audit-item">
                      <span className="audit-label">Creado por</span>
                      <span className="audit-value">
                        {editOpportunityAudit.createdByName || "No registrado"}
                      </span>
                    </div>
                    <div className="audit-item">
                      <span className="audit-label">Fecha de creacion</span>
                      <span className="audit-value">
                        {formatDateTime(editOpportunityAudit.createdAt)}
                      </span>
                    </div>
                    <div className="audit-item">
                      <span className="audit-label">Modificado por</span>
                      <span className="audit-value">
                        {editOpportunityAudit.updatedByName || "No registrado"}
                      </span>
                    </div>
                    <div className="audit-item">
                      <span className="audit-label">Fecha de modificacion</span>
                      <span className="audit-value">
                        {formatDateTime(editOpportunityAudit.updatedAt)}
                      </span>
                    </div>
                  </div>
                </section>
              )}

              <div className="modal-buttons" style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={closeOpportunityModal}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={savingOpportunity}
                >
                  {savingOpportunity
                    ? editingOpportunityId
                      ? "Guardando..."
                      : "Creando..."
                    : editingOpportunityId
                      ? "Guardar cambios"
                      : "Crear oportunidad"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <StageBypassConfirmationModal
        isOpen={showStageBypassModal}
        reason={stageBypassReason}
        onReasonChange={setStageBypassReason}
        onCancel={closeStageBypassModal}
        onConfirm={confirmStageBypass}
        isSubmitting={savingCommercialAction === "stage-bypass"}
      />

      <CommercialCloseConfirmationModal
        isOpen={showCommercialCloseModal}
        statusCode={commercialCloseModalState.statusCode}
        reason={commercialCloseModalState.reason}
        onReasonChange={(reason) =>
          setCommercialCloseModalState((prev) => ({ ...prev, reason }))
        }
        onCancel={closeCommercialCloseModal}
        onConfirm={confirmCommercialCloseDraft}
      />

      {error && <div className="toast toast-error">{error}</div>}
      {success && <div className="toast toast-success">{success}</div>}

      <table>
        <thead>
          <tr>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleOpportunitySort("id")}
              >
                ID <span>{getOpportunitySortArrow("id")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleOpportunitySort("nombre")}
              >
                Oportunidad <span>{getOpportunitySortArrow("nombre")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleOpportunitySort("cuenta")}
              >
                Cuenta <span>{getOpportunitySortArrow("cuenta")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleOpportunitySort("vendedor")}
              >
                Vendedor <span>{getOpportunitySortArrow("vendedor")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleOpportunitySort("preventa")}
              >
                Preventa <span>{getOpportunitySortArrow("preventa")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleOpportunitySort("etapa")}
              >
                Etapa <span>{getOpportunitySortArrow("etapa")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleOpportunitySort("importe")}
              >
                Importe USD <span>{getOpportunitySortArrow("importe")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleOpportunitySort("cierre")}
              >
                Cierre <span>{getOpportunitySortArrow("cierre")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleOpportunitySort("estado_comercial")}
              >
                Estado comercial{" "}
                <span>{getOpportunitySortArrow("estado_comercial")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleOpportunitySort("estado")}
              >
                Estado <span>{getOpportunitySortArrow("estado")}</span>
              </button>
            </th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {visibleOpportunities.length > 0 ? (
            pagedOpportunities.map((opportunity) => (
              <tr key={opportunity.id}>
                <td>{opportunity.id}</td>
                <td>{opportunity.name}</td>
                <td>{opportunity.account_name}</td>
                <td>{opportunity.seller_user_name || "-"}</td>
                <td>{opportunity.presales_user_name || "-"}</td>
                <td>{opportunity.sales_stage}</td>
                <td>
                  {Number(opportunity.amount_usd || 0).toLocaleString("en-US", {
                    style: "currency",
                    currency: "USD",
                  })}
                </td>
                <td>{formatCloseDate(opportunity.close_date)}</td>
                <td>
                  <span
                    className={getCommercialStatusBadgeClass(
                      opportunity.commercial_status,
                    )}
                  >
                    {getOpportunityCommercialStatusLabel(opportunity)}
                  </span>
                </td>
                <td>
                  <span className={getOpportunityStatusBadgeClass(opportunity)}>
                    {getOpportunityStatusLabel(opportunity)}
                  </span>
                </td>
                <td className="accounts-actions-cell">
                  <div className="user-kebab-wrap opportunities-kebab-wrap">
                    <button
                      type="button"
                      className="kebab-btn"
                      onClick={() => toggleOpportunityMenu(opportunity.id)}
                      aria-label="Abrir acciones"
                    >
                      ⋮
                    </button>
                    {openOpportunityMenuId === opportunity.id && (
                      <div className="user-kebab-menu">
                        <button
                          type="button"
                          onClick={() =>
                            runOpportunityAction(() =>
                              openEditOpportunityModal(opportunity.id),
                            )
                          }
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          disabled={
                            !canChangeOpportunityActivationStatus ||
                            isOpportunityActive(opportunity)
                          }
                          onClick={() =>
                            runOpportunityAction(() =>
                              updateOpportunityStatus(opportunity, "activada"),
                            )
                          }
                        >
                          Activar
                        </button>
                        <button
                          type="button"
                          disabled={
                            !canChangeOpportunityActivationStatus ||
                            isOpportunityPending(opportunity)
                          }
                          onClick={() =>
                            runOpportunityAction(() =>
                              updateOpportunityStatus(
                                opportunity,
                                "pendiente_activacion",
                              ),
                            )
                          }
                        >
                          Marcar pendiente
                        </button>
                        <button
                          type="button"
                          disabled={
                            !canChangeOpportunityActivationStatus ||
                            normalizeText(opportunity.activation_status) ===
                              "desactivada"
                          }
                          onClick={() =>
                            runOpportunityAction(() =>
                              updateOpportunityStatus(
                                opportunity,
                                "desactivada",
                              ),
                            )
                          }
                        >
                          Desactivar
                        </button>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={11} className="empty-state">
                No hay oportunidades que coincidan con los filtros
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {visibleOpportunities.length > 0 && (
        <div className="users-pagination">
          <div className="users-pagination-left">
            <span className="users-pagination-info">
              {(opportunitiesPage - 1) * opportunitiesPerPage + 1}–
              {Math.min(
                opportunitiesPage * opportunitiesPerPage,
                visibleOpportunities.length,
              )}{" "}
              de {visibleOpportunities.length}
            </span>
          </div>
          <div className="users-pagination-center">
            <button
              type="button"
              className="users-page-btn"
              disabled={opportunitiesPage === 1}
              onClick={() => setOpportunitiesPage((p) => p - 1)}
            >
              ‹
            </button>
            <span className="users-pagination-pages">
              {opportunitiesPage} / {totalOpportunityPages}
            </span>
            <button
              type="button"
              className="users-page-btn"
              disabled={opportunitiesPage === totalOpportunityPages}
              onClick={() => setOpportunitiesPage((p) => p + 1)}
            >
              ›
            </button>
          </div>
          <div className="users-pagination-right">
            <span className="users-pagination-label">Por página:</span>
            {[10, 50, 100].map((n) => (
              <button
                key={n}
                type="button"
                className={`users-perpage-btn${opportunitiesPerPage === n ? " is-active" : ""}`}
                onClick={() => setOpportunitiesPerPage(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function ContactsPage({ can, token, currentUser }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [contacts, setContacts] = useState([]);
  const [contactStatusFilter, setContactStatusFilter] =
    usePersistedStatusFilter("crm.contacts.statusFilter");
  const [contactQuery, setContactQuery] = useState("");
  const [contactSortField, setContactSortField] = useState("id");
  const [contactSortDirection, setContactSortDirection] = useState("asc");
  const [contactsPerPage, setContactsPerPage] = useState(10);
  const [contactsPage, setContactsPage] = useState(1);
  const [showContactModal, setShowContactModal] = useState(false);
  const [editingContactId, setEditingContactId] = useState(null);
  const [editContactAudit, setEditContactAudit] = useState(null);
  const [editContactOpportunities, setEditContactOpportunities] = useState([]);
  const [loadingContactOpportunities, setLoadingContactOpportunities] =
    useState(false);
  const [contactOppSectionStatusFilter, setContactOppSectionStatusFilter] =
    useState("all");
  const [contactOppSectionYearFilter, setContactOppSectionYearFilter] =
    useState(String(new Date().getFullYear()));
  const [contactOppsModalContact, setContactOppsModalContact] = useState(null);
  const [openContactMenuId, setOpenContactMenuId] = useState(null);
  const [confirmContactStatusAction, setConfirmContactStatusAction] =
    useState(null);
  const [savingContact, setSavingContact] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [catalogs, setCatalogs] = useState({
    accounts: [],
    countries: [],
    purchaseParticipations: [],
    relationshipTypes: [],
    employmentStatuses: [],
    activationStatuses: [],
  });
  const explicitContactPermissions = useMemo(
    () => new Set(currentUser?.permissions || []),
    [currentUser],
  );
  const canCreateOrRequestContacts =
    explicitContactPermissions.has("contactos.create") ||
    explicitContactPermissions.has("contactos.request");
  const canChangeContactActivationStatus =
    explicitContactPermissions.has("contactos.create");
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    accountId: "",
    positionTitle: "",
    phone: "",
    phoneExtension: "",
    mobile: "",
    email: "",
    department: "",
    countryId: "",
    stateRegion: "",
    city: "",
    addressLine: "",
    postalCode: "",
    purchaseParticipationId: "",
    relationshipTypeId: "",
    employmentStatusId: "",
    activationStatusId: "",
    managerContactId: "",
    influencesContactId: "",
  });

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }

  function findCatalogIdByCode(options, expectedCode) {
    const target = normalizeText(expectedCode);
    const found = options.find((opt) => normalizeText(opt.code) === target);
    return found ? String(found.id) : "";
  }

  function getAccountLocationFields(accountId) {
    const selectedAccount = catalogs.accounts.find(
      (account) => String(account.id) === String(accountId || ""),
    );

    return {
      countryId: selectedAccount?.country_id
        ? String(selectedAccount.country_id)
        : "",
      stateRegion: selectedAccount?.state_region || "",
      city: selectedAccount?.city || "",
      addressLine: selectedAccount?.address_line || "",
      postalCode: selectedAccount?.postal_code || "",
    };
  }

  useEffect(() => {
    if (!error && !success) return;
    const timeoutId = window.setTimeout(() => {
      setError("");
      setSuccess("");
    }, 4000);
    return () => window.clearTimeout(timeoutId);
  }, [error, success]);

  useEffect(() => {
    if (openContactMenuId === null) return undefined;

    function handlePointerDown(event) {
      if (event.target.closest(".contacts-kebab-wrap")) return;
      setOpenContactMenuId(null);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [openContactMenuId]);

  async function load() {
    try {
      const [
        contactsRes,
        accountsRes,
        countriesRes,
        purchaseRes,
        relationshipRes,
        employmentRes,
        activationRes,
      ] = await Promise.all([
        api.get("/api/contacts"),
        api.get("/api/catalogs/contact-accounts"),
        api.get("/api/catalogs/contact-countries"),
        api.get("/api/catalogs/contact-purchase-participations"),
        api.get("/api/catalogs/contact-relationship-types"),
        api.get("/api/catalogs/contact-employment-statuses"),
        api.get("/api/catalogs/contact-activation-statuses"),
      ]);

      setContacts(contactsRes.data || []);
      setCatalogs({
        accounts: accountsRes.data || [],
        countries: countriesRes.data || [],
        purchaseParticipations: purchaseRes.data || [],
        relationshipTypes: relationshipRes.data || [],
        employmentStatuses: employmentRes.data || [],
        activationStatuses: activationRes.data || [],
      });
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible cargar contactos"));
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const editId = searchParams.get("edit");
    if (!editId) return;
    setSearchParams({}, { replace: true });
    openEditContactModal(Number(editId));
  }, [searchParams]);

  useEffect(() => {
    if (!showContactModal || editingContactId) return;

    setForm((prev) => ({
      ...prev,
      purchaseParticipationId:
        prev.purchaseParticipationId ||
        findCatalogIdByCode(catalogs.purchaseParticipations, "ninguno"),
      relationshipTypeId:
        prev.relationshipTypeId ||
        findCatalogIdByCode(catalogs.relationshipTypes, "ninguno"),
      employmentStatusId:
        prev.employmentStatusId ||
        String(catalogs.employmentStatuses?.[0]?.id || ""),
      activationStatusId:
        prev.activationStatusId ||
        String(catalogs.activationStatuses?.[0]?.id || ""),
      ...(prev.accountId ? getAccountLocationFields(prev.accountId) : null),
    }));
  }, [showContactModal, editingContactId, catalogs]);

  function buildDefaultContactForm() {
    return {
      firstName: "",
      lastName: "",
      accountId: "",
      positionTitle: "",
      phone: "",
      phoneExtension: "",
      mobile: "",
      email: "",
      department: "",
      countryId: "",
      stateRegion: "",
      city: "",
      addressLine: "",
      postalCode: "",
      purchaseParticipationId: findCatalogIdByCode(
        catalogs.purchaseParticipations,
        "ninguno",
      ),
      relationshipTypeId: findCatalogIdByCode(
        catalogs.relationshipTypes,
        "ninguno",
      ),
      employmentStatusId: String(catalogs.employmentStatuses?.[0]?.id || ""),
      activationStatusId: String(catalogs.activationStatuses?.[0]?.id || ""),
      managerContactId: "",
      influencesContactId: "",
    };
  }

  function openCreateContactModal() {
    setError("");
    setSuccess("");
    setEditingContactId(null);
    setEditContactAudit(null);
    setForm(buildDefaultContactForm());
    setShowContactModal(true);
  }

  async function openEditContactModal(contactId) {
    setError("");
    setSuccess("");
    try {
      const { data } = await api.get(`/api/contacts/${contactId}`);
      setForm({
        firstName: data.first_name || "",
        lastName: data.last_name || "",
        accountId: String(data.account_id || ""),
        positionTitle: data.position_title || "",
        phone: data.phone || "",
        phoneExtension: data.phone_extension || "",
        mobile: data.mobile || "",
        email: data.email || "",
        department: data.department || "",
        countryId: data.country_id ? String(data.country_id) : "",
        stateRegion: data.state_region || "",
        city: data.city || "",
        addressLine: data.address_line || "",
        postalCode: data.postal_code || "",
        purchaseParticipationId: String(data.purchase_participation_id || ""),
        relationshipTypeId: String(data.relationship_type_id || ""),
        employmentStatusId: String(data.employment_status_id || ""),
        activationStatusId: String(data.activation_status_id || ""),
        managerContactId: data.manager_contact_id
          ? String(data.manager_contact_id)
          : "",
        influencesContactId: data.influences_contact_id
          ? String(data.influences_contact_id)
          : "",
      });
      setEditContactAudit({
        createdByName: data.created_by_name || "",
        createdAt: data.created_at || "",
        updatedByName: data.updated_by_name || "",
        updatedAt: data.updated_at || "",
      });
      setEditingContactId(Number(contactId));
      setShowContactModal(true);
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible cargar el contacto"));
    }
  }

  function closeContactModal() {
    if (savingContact) return;
    setShowContactModal(false);
    setEditingContactId(null);
    setEditContactAudit(null);
  }

  function isContactActive(contact) {
    return normalizeText(contact.activation_status) === "activado";
  }

  function isContactPending(contact) {
    return (
      normalizeText(contact.activation_status) === "pendiente de activacion"
    );
  }

  function isContactInactive(contact) {
    return normalizeText(contact.activation_status) === "desactivado";
  }

  function getContactStatusLabel(contact) {
    if (isContactPending(contact)) return "Pendiente de activacion";
    return isContactActive(contact) ? "Activado" : "Desactivado";
  }

  function getContactStatusBadgeClass(contact) {
    if (isContactPending(contact)) {
      return "user-status-badge pending";
    }
    return isContactActive(contact)
      ? "user-status-badge active"
      : "user-status-badge inactive";
  }

  function getContactStatusIconBadgeClass(contact) {
    if (isContactPending(contact)) {
      return "status-icon-badge pending";
    }
    return isContactActive(contact)
      ? "status-icon-badge active"
      : "status-icon-badge inactive";
  }

  const filteredContacts = useMemo(() => {
    return contacts.filter((contact) => {
      if (contactStatusFilter === "all") return true;
      if (contactStatusFilter === "pending") return isContactPending(contact);
      if (contactStatusFilter === "inactive") return isContactInactive(contact);
      return isContactActive(contact);
    });
  }, [contacts, contactStatusFilter]);

  const contactStatusCounts = useMemo(() => {
    return contacts.reduce(
      (totals, contact) => {
        if (isContactPending(contact)) {
          totals.pending += 1;
          return totals;
        }
        if (isContactInactive(contact)) {
          totals.inactive += 1;
          return totals;
        }
        totals.active += 1;
        return totals;
      },
      { active: 0, pending: 0, inactive: 0 },
    );
  }, [contacts]);

  const totalContactsCount =
    contactStatusCounts.active +
    contactStatusCounts.pending +
    contactStatusCounts.inactive;

  const sortedContacts = useMemo(() => {
    const list = [...filteredContacts];

    const readValue = (contact) => {
      if (contactSortField === "id") return Number(contact.id) || 0;
      if (contactSortField === "nombre") return String(contact.full_name || "");
      if (contactSortField === "cuenta")
        return String(contact.account_name || "");
      if (contactSortField === "cargo")
        return String(contact.position_title || "");
      if (contactSortField === "email") return String(contact.email || "");
      if (contactSortField === "estado")
        return String(getContactStatusLabel(contact));
      return "";
    };

    list.sort((a, b) => {
      const aValue = readValue(a);
      const bValue = readValue(b);

      let result = 0;
      if (typeof aValue === "number" && typeof bValue === "number") {
        result = aValue - bValue;
      } else {
        result = String(aValue).localeCompare(String(bValue), "es", {
          numeric: true,
          sensitivity: "base",
        });
      }

      return contactSortDirection === "asc" ? result : -result;
    });

    return list;
  }, [filteredContacts, contactSortField, contactSortDirection]);

  const visibleContacts = useMemo(() => {
    const q = contactQuery.trim().toLowerCase();
    if (!q) return sortedContacts;

    return sortedContacts.filter((c) => {
      const haystack = [
        c.id,
        c.full_name,
        c.account_name,
        c.position_title,
        c.email,
        c.mobile,
        getContactStatusLabel(c),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [sortedContacts, contactQuery]);

  // reset to page 1 when filters change
  useEffect(() => {
    setContactsPage(1);
  }, [contactQuery, contactStatusFilter, contactsPerPage]);

  const totalContactPages = Math.max(
    1,
    Math.ceil(visibleContacts.length / contactsPerPage),
  );
  const pagedContacts = visibleContacts.slice(
    (contactsPage - 1) * contactsPerPage,
    contactsPage * contactsPerPage,
  );

  function toggleContactSort(field) {
    if (contactSortField === field) {
      setContactSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setContactSortField(field);
    setContactSortDirection("asc");
  }

  function getContactSortArrow(field) {
    if (contactSortField !== field) return "↕";
    return contactSortDirection === "asc" ? "↑" : "↓";
  }

  function formatDateTime(value) {
    if (!value) return "No registrado";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "No registrado";
    return date.toLocaleString("es-ES");
  }

  function toggleContactMenu(contactId) {
    setOpenContactMenuId((prev) => (prev === contactId ? null : contactId));
  }

  async function openContactOppsModal(contact) {
    setContactOppSectionStatusFilter("all");
    setContactOppSectionYearFilter(String(new Date().getFullYear()));
    setEditContactOpportunities([]);
    setContactOppsModalContact(contact);
    setLoadingContactOpportunities(true);
    try {
      const { data: opps } = await api.get(
        `/api/opportunities?contactId=${contact.id}`,
      );
      setEditContactOpportunities(Array.isArray(opps) ? opps : []);
    } catch {
      setEditContactOpportunities([]);
    } finally {
      setLoadingContactOpportunities(false);
    }
  }

  function closeContactOppsModal() {
    setContactOppsModalContact(null);
    setEditContactOpportunities([]);
    setContactOppSectionStatusFilter("all");
    setContactOppSectionYearFilter(String(new Date().getFullYear()));
  }

  async function runContactAction(action) {
    try {
      await action();
    } finally {
      setOpenContactMenuId(null);
    }
  }

  async function updateContactStatus(contact, statusCode) {
    setError("");
    setSuccess("");
    try {
      const { data } = await api.patch(`/api/contacts/${contact.id}/status`, {
        statusCode,
      });
      setSuccess(data?.message || "Estado de contacto actualizado");
      await load();
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible actualizar el estado del contacto",
        ),
      );
    }
  }

  function openContactStatusConfirmation(contact, statusCode) {
    setConfirmContactStatusAction({ contact, statusCode });
    setOpenContactMenuId(null);
  }

  function closeContactStatusConfirmation() {
    setConfirmContactStatusAction(null);
  }

  async function confirmSelectedContactStatusChange() {
    if (!confirmContactStatusAction) return;

    await updateContactStatus(
      confirmContactStatusAction.contact,
      confirmContactStatusAction.statusCode,
    );
    setConfirmContactStatusAction(null);
  }

  function getContactStatusConfirmationMeta() {
    const contactName = confirmContactStatusAction?.contact?.full_name || "";

    if (confirmContactStatusAction?.statusCode === "activado") {
      return {
        title: "Activar contacto",
        message: `Seguro que deseas activar al contacto "${contactName}"?`,
        confirmText: "Activar",
        isDangerous: false,
      };
    }

    if (confirmContactStatusAction?.statusCode === "pendiente_activacion") {
      return {
        title: "Marcar contacto como pendiente",
        message: `Seguro que deseas marcar como pendiente al contacto "${contactName}"?`,
        confirmText: "Marcar pendiente",
        isDangerous: false,
      };
    }

    return {
      title: "Desactivar contacto",
      message: `Seguro que deseas desactivar al contacto "${contactName}"?`,
      confirmText: "Desactivar",
      isDangerous: true,
    };
  }

  async function saveContact(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSavingContact(true);

    try {
      const payload = {
        firstName: form.firstName,
        lastName: form.lastName,
        accountId: Number(form.accountId),
        positionTitle: form.positionTitle || undefined,
        phone: form.phone || undefined,
        phoneExtension: form.phoneExtension || undefined,
        mobile: form.mobile || undefined,
        email: form.email || undefined,
        department: form.department || undefined,
        countryId: form.countryId ? Number(form.countryId) : null,
        stateRegion: form.stateRegion || undefined,
        city: form.city || undefined,
        addressLine: form.addressLine || undefined,
        postalCode: form.postalCode || undefined,
        purchaseParticipationId: Number(form.purchaseParticipationId),
        relationshipTypeId: Number(form.relationshipTypeId),
        employmentStatusId: Number(form.employmentStatusId),
        activationStatusId: Number(form.activationStatusId),
        managerContactId: form.managerContactId
          ? Number(form.managerContactId)
          : null,
        influencesContactId: form.influencesContactId
          ? Number(form.influencesContactId)
          : null,
      };

      const { data } = editingContactId
        ? await api.put(`/api/contacts/${editingContactId}`, payload)
        : await api.post("/api/contacts", payload);

      setSuccess(
        data?.message ||
          (editingContactId
            ? "Contacto actualizado correctamente"
            : "Contacto creado correctamente"),
      );
      setShowContactModal(false);
      setEditingContactId(null);
      setEditContactAudit(null);
      await load();
    } catch (err) {
      const fieldErrors = err?.response?.data?.errors?.fieldErrors;
      if (fieldErrors && typeof fieldErrors === "object") {
        const firstError = Object.entries(fieldErrors).find(
          ([, messages]) => Array.isArray(messages) && messages.length > 0,
        );
        if (firstError) {
          const [fieldName, messages] = firstError;
          setError(`${fieldName}: ${messages[0]}`);
          setSavingContact(false);
          return;
        }
      }
      setError(getApiErrorMessage(err, "No fue posible guardar el contacto"));
    } finally {
      setSavingContact(false);
    }
  }

  const managerOptions = useMemo(() => {
    return contacts.filter((contact) => {
      if (Number(contact.id) === Number(editingContactId)) return false;
      if (!form.accountId) return false;
      return Number(contact.account_id) === Number(form.accountId);
    });
  }, [contacts, editingContactId, form.accountId]);

  useEffect(() => {
    if (!form.managerContactId) return;
    const isValidManager = managerOptions.some(
      (contact) => Number(contact.id) === Number(form.managerContactId),
    );
    if (isValidManager) return;

    setForm((prev) => ({
      ...prev,
      managerContactId: "",
    }));
  }, [managerOptions, form.managerContactId]);

  return (
    <section className="panel">
      <ConfirmationModal
        isOpen={Boolean(confirmContactStatusAction)}
        title={getContactStatusConfirmationMeta().title}
        message={getContactStatusConfirmationMeta().message}
        onConfirm={confirmSelectedContactStatusChange}
        onCancel={closeContactStatusConfirmation}
        confirmText={getContactStatusConfirmationMeta().confirmText}
        isDangerous={getContactStatusConfirmationMeta().isDangerous}
      />

      <div className="roles-page-header">
        <div className="roles-page-header-left">
          <div className="module-title-with-icon">
            <h2>Contactos</h2>
            <span
              className="module-title-icon module-title-icon-contacts"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M7 4.5A2.5 2.5 0 0 0 4.5 7v10A2.5 2.5 0 0 0 7 19.5h10a2.5 2.5 0 0 0 2.5-2.5V7A2.5 2.5 0 0 0 17 4.5zm0 1.5h10c.55 0 1 .45 1 1v10c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1V7c0-.55.45-1 1-1" />
                <path d="M12 8.25a2.25 2.25 0 1 0 2.25 2.25A2.25 2.25 0 0 0 12 8.25m0 6c-1.94 0-3.75.97-3.75 2.1a.65.65 0 0 0 .65.65h6.2a.65.65 0 0 0 .65-.65c0-1.13-1.81-2.1-3.75-2.1" />
              </svg>
            </span>
          </div>
          <p className="roles-subtitle">
            Gestiona los contactos del sistema y sus datos de comunicación
          </p>
        </div>
        {canCreateOrRequestContacts && (
          <button
            type="button"
            className="btn-primary"
            onClick={openCreateContactModal}
          >
            + Crear contacto
          </button>
        )}
      </div>

      <div className="roles-pills-bar accounts-pills-bar-row">
        <div
          className="accounts-status-pills"
          role="group"
          aria-label="Filtrar contactos por estado"
        >
          <button
            type="button"
            className={
              contactStatusFilter === "active"
                ? "status-filter-pill status-filter-pill-active is-selected"
                : "status-filter-pill status-filter-pill-active"
            }
            aria-pressed={contactStatusFilter === "active"}
            onClick={() => setContactStatusFilter("active")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Activos</span>
            <span className="status-filter-pill-count">
              {contactStatusCounts.active}
            </span>
          </button>
          <button
            type="button"
            className={
              contactStatusFilter === "pending"
                ? "status-filter-pill status-filter-pill-pending is-selected"
                : "status-filter-pill status-filter-pill-pending"
            }
            aria-pressed={contactStatusFilter === "pending"}
            onClick={() => setContactStatusFilter("pending")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Pendientes</span>
            <span className="status-filter-pill-count">
              {contactStatusCounts.pending}
            </span>
          </button>
          <button
            type="button"
            className={
              contactStatusFilter === "inactive"
                ? "status-filter-pill status-filter-pill-inactive is-selected"
                : "status-filter-pill status-filter-pill-inactive"
            }
            aria-pressed={contactStatusFilter === "inactive"}
            onClick={() => setContactStatusFilter("inactive")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Desactivados</span>
            <span className="status-filter-pill-count">
              {contactStatusCounts.inactive}
            </span>
          </button>
          <button
            type="button"
            className={
              contactStatusFilter === "all"
                ? "status-filter-pill status-filter-pill-all is-selected"
                : "status-filter-pill status-filter-pill-all"
            }
            aria-pressed={contactStatusFilter === "all"}
            onClick={() => setContactStatusFilter("all")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Todas</span>
            <span className="status-filter-pill-count">
              {totalContactsCount}
            </span>
          </button>
        </div>
        <input
          className="accounts-search-inline"
          type="text"
          placeholder="Buscar por nombre, cuenta, cargo, email, móvil o estado"
          value={contactQuery}
          onChange={(e) => setContactQuery(e.target.value)}
        />
      </div>

      {showContactModal && (
        <div className="modal-overlay" onClick={closeContactModal}>
          <div
            className="modal-dialog modal-dialog-account"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3 className="modal-title">
                {editingContactId ? "Editar contacto" : "Crear contacto"}
              </h3>
              {editingContactId &&
                (() => {
                  const c = contacts.find(
                    (x) => Number(x.id) === Number(editingContactId),
                  );
                  return c ? (
                    <div className="opportunity-modal-header-meta">
                      <span className="record-id-badge" title="ID del contacto">
                        <span className="record-id-icon" aria-hidden="true">
                          #
                        </span>
                        {editingContactId}
                      </span>
                      <span
                        className={getContactStatusIconBadgeClass(c)}
                        title="Estado de activacion"
                      >
                        <span className="status-dot" aria-hidden="true" />
                        {getContactStatusLabel(c)}
                      </span>
                    </div>
                  ) : null;
                })()}
            </div>
            <p className="modal-message account-modal-message">
              {editingContactId
                ? "Actualiza los datos necesarios y guarda los cambios."
                : "Completa la información principal y guarda para crear el contacto."}
            </p>

            <form
              className="account-create-form in-modal"
              onSubmit={saveContact}
            >
              <section className="account-form-section">
                <h4>Datos principales</h4>
                <div className="grid-form account-grid-main">
                  <div className="field-group">
                    <label>
                      Nombres <span className="required-mark">*</span>
                    </label>
                    <input
                      value={form.firstName}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          firstName: e.target.value,
                        }))
                      }
                      required
                    />
                  </div>
                  <div className="field-group">
                    <label>
                      Apellidos <span className="required-mark">*</span>
                    </label>
                    <input
                      value={form.lastName}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          lastName: e.target.value,
                        }))
                      }
                      required
                    />
                  </div>
                  <div className="field-group">
                    <label>
                      Cuenta <span className="required-mark">*</span>
                    </label>
                    <select
                      value={form.accountId}
                      onChange={(e) => {
                        const accountId = e.target.value;

                        setForm((prev) => ({
                          ...prev,
                          accountId,
                          ...(editingContactId
                            ? null
                            : getAccountLocationFields(accountId)),
                        }));
                      }}
                      required
                    >
                      <option value="">Selecciona cuenta</option>
                      {catalogs.accounts.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field-group">
                    <label>Cargo</label>
                    <input
                      value={form.positionTitle}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          positionTitle: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="field-group">
                    <label>E-mail</label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, email: e.target.value }))
                      }
                    />
                  </div>
                  <div className="field-group">
                    <label>Móvil</label>
                    <input
                      value={form.mobile}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, mobile: e.target.value }))
                      }
                    />
                  </div>
                  <div className="field-group">
                    <label>Telefono fijo</label>
                    <input
                      value={form.phone}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, phone: e.target.value }))
                      }
                    />
                  </div>
                  <div className="field-group">
                    <label>Extension</label>
                    <input
                      value={form.phoneExtension}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          phoneExtension: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="field-group">
                    <label>Departamento</label>
                    <input
                      value={form.department}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          department: e.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
              </section>

              <section className="account-form-section">
                <h4>Relacion comercial</h4>
                <div className="grid-form account-grid-main">
                  <div className="field-group">
                    <label>
                      Participacion de compra{" "}
                      <span className="required-mark">*</span>
                    </label>
                    <select
                      value={form.purchaseParticipationId}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          purchaseParticipationId: e.target.value,
                        }))
                      }
                      required
                    >
                      <option value="">Selecciona participación</option>
                      {catalogs.purchaseParticipations.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field-group">
                    <label>
                      Relacion con nosotros{" "}
                      <span className="required-mark">*</span>
                    </label>
                    <select
                      value={form.relationshipTypeId}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          relationshipTypeId: e.target.value,
                        }))
                      }
                      required
                    >
                      <option value="">Selecciona relación</option>
                      {catalogs.relationshipTypes.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field-group">
                    <label>
                      Situacion en empresa{" "}
                      <span className="required-mark">*</span>
                    </label>
                    <select
                      value={form.employmentStatusId}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          employmentStatusId: e.target.value,
                        }))
                      }
                      required
                    >
                      <option value="">Selecciona situación</option>
                      {catalogs.employmentStatuses.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field-group">
                    <label>Jefe</label>
                    <select
                      value={form.managerContactId}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          managerContactId: e.target.value,
                        }))
                      }
                    >
                      <option value="">Sin jefe</option>
                      {managerOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.full_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field-group">
                    <label>Influye en</label>
                    <select
                      value={form.influencesContactId}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          influencesContactId: e.target.value,
                        }))
                      }
                    >
                      <option value="">Ninguno</option>
                      {managerOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.full_name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>

              <section className="account-form-section">
                <h4>Ubicacion (si difiere de la cuenta)</h4>
                <div className="grid-form account-grid-location">
                  <div className="field-group">
                    <label>Pais</label>
                    <select
                      value={form.countryId}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          countryId: e.target.value,
                        }))
                      }
                    >
                      <option value="">Usar país de la cuenta</option>
                      {catalogs.countries.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field-group">
                    <label>Estado</label>
                    <input
                      value={form.stateRegion}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          stateRegion: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="field-group">
                    <label>Ciudad</label>
                    <input
                      value={form.city}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, city: e.target.value }))
                      }
                    />
                  </div>
                  <div className="field-group">
                    <label>Direccion</label>
                    <input
                      value={form.addressLine}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          addressLine: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="field-group">
                    <label>Codigo postal</label>
                    <input
                      value={form.postalCode}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          postalCode: e.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
              </section>

              {editingContactId && editContactAudit && (
                <section className="account-form-section modal-audit-strip">
                  <h4>Auditoria del contacto</h4>
                  <div className="role-audit-grid">
                    <div className="audit-item">
                      <span className="audit-label">Creado por</span>
                      <span className="audit-value">
                        {editContactAudit.createdByName || "No registrado"}
                      </span>
                    </div>
                    <div className="audit-item">
                      <span className="audit-label">Fecha de creacion</span>
                      <span className="audit-value">
                        {formatDateTime(editContactAudit.createdAt)}
                      </span>
                    </div>
                    <div className="audit-item">
                      <span className="audit-label">Modificado por</span>
                      <span className="audit-value">
                        {editContactAudit.updatedByName || "No registrado"}
                      </span>
                    </div>
                    <div className="audit-item">
                      <span className="audit-label">Fecha de modificacion</span>
                      <span className="audit-value">
                        {formatDateTime(editContactAudit.updatedAt)}
                      </span>
                    </div>
                  </div>
                </section>
              )}

              <div className="modal-buttons" style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={closeContactModal}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={savingContact}
                >
                  {savingContact
                    ? editingContactId
                      ? "Guardando..."
                      : "Creando..."
                    : editingContactId
                      ? "Guardar cambios"
                      : "Crear contacto"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {error && <div className="toast toast-error">{error}</div>}
      {success && <div className="toast toast-success">{success}</div>}

      <table>
        <thead>
          <tr>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleContactSort("id")}
              >
                ID <span>{getContactSortArrow("id")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleContactSort("nombre")}
              >
                Nombre <span>{getContactSortArrow("nombre")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleContactSort("cuenta")}
              >
                Cuenta <span>{getContactSortArrow("cuenta")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleContactSort("cargo")}
              >
                Cargo <span>{getContactSortArrow("cargo")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleContactSort("email")}
              >
                E-mail <span>{getContactSortArrow("email")}</span>
              </button>
            </th>
            <th>Móvil</th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleContactSort("estado")}
              >
                Estado <span>{getContactSortArrow("estado")}</span>
              </button>
            </th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {visibleContacts.length > 0 ? (
            pagedContacts.map((c) => (
              <tr key={c.id}>
                <td>{c.id}</td>
                <td>{c.full_name}</td>
                <td>{c.account_name}</td>
                <td>{c.position_title || "-"}</td>
                <td>{c.email || "-"}</td>
                <td>{c.mobile || "-"}</td>
                <td>
                  <span className={getContactStatusBadgeClass(c)}>
                    {getContactStatusLabel(c)}
                  </span>
                </td>
                <td className="accounts-actions-cell">
                  <div className="user-kebab-wrap contacts-kebab-wrap">
                    <button
                      type="button"
                      className="kebab-btn"
                      onClick={() => toggleContactMenu(c.id)}
                      aria-label="Abrir acciones"
                    >
                      ⋮
                    </button>
                    {openContactMenuId === c.id && (
                      <div className="user-kebab-menu">
                        <button
                          type="button"
                          onClick={() =>
                            runContactAction(() => openEditContactModal(c.id))
                          }
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          disabled={
                            !canChangeContactActivationStatus ||
                            isContactActive(c)
                          }
                          onClick={() =>
                            openContactStatusConfirmation(c, "activado")
                          }
                        >
                          Activar
                        </button>
                        <button
                          type="button"
                          disabled={
                            !canChangeContactActivationStatus ||
                            isContactPending(c)
                          }
                          onClick={() =>
                            openContactStatusConfirmation(
                              c,
                              "pendiente_activacion",
                            )
                          }
                        >
                          Marcar pendiente
                        </button>
                        <button
                          type="button"
                          disabled={
                            !canChangeContactActivationStatus ||
                            isContactInactive(c)
                          }
                          onClick={() =>
                            openContactStatusConfirmation(c, "desactivado")
                          }
                        >
                          Desactivar
                        </button>
                        {can("oportunidades.read") && (
                          <button
                            type="button"
                            onClick={() =>
                              runContactAction(() => openContactOppsModal(c))
                            }
                          >
                            Oportunidades
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={8} className="empty-state">
                No hay contactos que coincidan con los filtros
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {visibleContacts.length > 0 && (
        <div className="users-pagination">
          <div className="users-pagination-left">
            <span className="users-pagination-info">
              {(contactsPage - 1) * contactsPerPage + 1}–
              {Math.min(contactsPage * contactsPerPage, visibleContacts.length)}{" "}
              de {visibleContacts.length}
            </span>
          </div>
          <div className="users-pagination-center">
            <button
              type="button"
              className="users-page-btn"
              disabled={contactsPage === 1}
              onClick={() => setContactsPage((p) => p - 1)}
            >
              ‹
            </button>
            <span className="users-pagination-pages">
              {contactsPage} / {totalContactPages}
            </span>
            <button
              type="button"
              className="users-page-btn"
              disabled={contactsPage === totalContactPages}
              onClick={() => setContactsPage((p) => p + 1)}
            >
              ›
            </button>
          </div>
          <div className="users-pagination-right">
            <span className="users-pagination-label">Por página:</span>
            {[10, 50, 100].map((n) => (
              <button
                key={n}
                type="button"
                className={`users-perpage-btn${contactsPerPage === n ? " is-active" : ""}`}
                onClick={() => setContactsPerPage(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}

      {contactOppsModalContact &&
        (() => {
          const oppCloseYears = [
            ...new Set(
              editContactOpportunities
                .map((o) =>
                  o.close_date ? new Date(o.close_date).getFullYear() : null,
                )
                .filter(Boolean),
            ),
          ].sort((a, b) => b - a);

          const visibleOpps = editContactOpportunities.filter((o) => {
            if (
              contactOppSectionStatusFilter !== "all" &&
              normalizeText(o.activation_status) !==
                normalizeText(contactOppSectionStatusFilter)
            )
              return false;
            if (contactOppSectionYearFilter !== "all" && o.close_date) {
              if (
                String(new Date(o.close_date).getFullYear()) !==
                contactOppSectionYearFilter
              )
                return false;
            } else if (contactOppSectionYearFilter !== "all" && !o.close_date) {
              return false;
            }
            return true;
          });

          return (
            <div
              className="modal-overlay"
              role="dialog"
              aria-modal="true"
              aria-label={`Oportunidades de ${contactOppsModalContact.full_name}`}
              onClick={(e) => {
                if (e.target === e.currentTarget) closeContactOppsModal();
              }}
            >
              <div className="modal-dialog modal-dialog-wide modal-dialog-account-opps">
                <div className="modal-header">
                  <h3 className="modal-title">
                    Oportunidades &mdash;{" "}
                    <span style={{ fontWeight: 400 }}>
                      {contactOppsModalContact.full_name}
                    </span>
                  </h3>
                </div>

                {!loadingContactOpportunities &&
                  editContactOpportunities.length > 0 && (
                    <div className="account-opps-filters">
                      <div
                        className="account-opps-pills"
                        role="group"
                        aria-label="Filtrar por estado"
                      >
                        {[
                          "activada",
                          "pendiente de activacion",
                          "desactivada",
                          "all",
                        ].map((s) => (
                          <button
                            key={s}
                            type="button"
                            className={`account-opps-pill account-opps-pill--${s === "all" ? "all" : s === "activada" ? "active" : s === "pendiente de activacion" ? "pending" : "inactive"}${
                              contactOppSectionStatusFilter === s
                                ? " is-active"
                                : ""
                            }`}
                            onClick={() => setContactOppSectionStatusFilter(s)}
                          >
                            {s === "all"
                              ? "Todas"
                              : s === "activada"
                                ? "Activadas"
                                : s === "pendiente de activacion"
                                  ? "Pendientes"
                                  : "Desactivadas"}
                          </button>
                        ))}
                      </div>
                      {oppCloseYears.length > 0 && (
                        <select
                          className="account-opps-year-select"
                          value={contactOppSectionYearFilter}
                          onChange={(e) =>
                            setContactOppSectionYearFilter(e.target.value)
                          }
                          aria-label="Filtrar por año de cierre"
                        >
                          <option value="all">Todos los años</option>
                          {oppCloseYears.map((y) => (
                            <option key={y} value={String(y)}>
                              {y}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}

                {loadingContactOpportunities ? (
                  <p className="account-opps-empty">
                    Cargando oportunidades...
                  </p>
                ) : editContactOpportunities.length === 0 ? (
                  <p className="account-opps-empty">
                    No hay oportunidades registradas para este contacto.
                  </p>
                ) : visibleOpps.length === 0 ? (
                  <p className="account-opps-empty">
                    Sin resultados para el filtro seleccionado.
                  </p>
                ) : (
                  <div className="account-opps-list">
                    {visibleOpps.map((opp) => (
                      <div
                        key={opp.id}
                        className="account-opp-row account-opp-row--clickable"
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          closeContactOppsModal();
                          navigate(`/opportunities?edit=${opp.id}`);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            closeContactOppsModal();
                            navigate(`/opportunities?edit=${opp.id}`);
                          }
                        }}
                      >
                        <div className="account-opp-main">
                          <span className="account-opp-name">{opp.name}</span>
                          <span
                            className={(() => {
                              const s = normalizeText(opp.activation_status);
                              if (s === "activada")
                                return "user-status-badge active";
                              if (s === "pendiente de activacion")
                                return "user-status-badge pending";
                              return "user-status-badge inactive";
                            })()}
                          >
                            {opp.activation_status || "-"}
                          </span>
                        </div>
                        <div className="account-opp-meta">
                          <span>{opp.account_name}</span>
                          <span>{opp.sales_stage}</span>
                          <span>{opp.business_line}</span>
                          <span>
                            {Number(opp.amount_usd).toLocaleString("es-MX", {
                              style: "currency",
                              currency: "USD",
                              minimumFractionDigits: 0,
                            })}
                          </span>
                          <span>
                            Cierre:{" "}
                            {opp.close_date
                              ? new Date(opp.close_date).toLocaleDateString(
                                  "es-MX",
                                )
                              : "—"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="modal-buttons" style={{ marginTop: 16 }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={closeContactOppsModal}
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
    </section>
  );
}

export default App;
