import { useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { api, getApiErrorMessage, setAuthToken } from "./api";

function App() {
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

  return <Shell currentUser={currentUser} onLogout={() => setToken("")} />;
}

function Shell({ currentUser, onLogout }) {
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
          {can("audit.read") && <NavLink to="/audit">Auditoria</NavLink>}
        </nav>
        <button className="logout" onClick={onLogout}>
          Salir
        </button>
      </aside>
      <main className="content">
        <header className="topbar">
          <div>
            <strong>{currentUser.full_name}</strong>
            <p>{currentUser.email}</p>
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
              can("roles.read") ? <RolesPage can={can} /> : <Navigate to="/" />
            }
          />
          <Route
            path="/accounts"
            element={
              can("cuentas.read") ? (
                <AccountsPage can={can} currentUser={currentUser} />
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
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [filters, setFilters] = useState({
    page: 1,
    pageSize: 50,
    from: "",
    to: "",
    module: "",
    action: "",
    status: "",
    q: "",
  });

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
    load();
  }, []);

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
    const nextFilters = { ...filters, page: safePage };
    setFilters(nextFilters);
    load(nextFilters);
  }

  function submitFilters(e) {
    e.preventDefault();
    const nextFilters = { ...filters, page: 1 };
    setFilters(nextFilters);
    load(nextFilters);
  }

  function resetFilters() {
    const defaults = {
      page: 1,
      pageSize: 50,
      from: "",
      to: "",
      module: "",
      action: "",
      status: "",
      q: "",
    };
    setFilters(defaults);
    load(defaults);
  }

  return (
    <section className="panel">
      <div className="users-header-row">
        <h2>Auditoria del sistema</h2>
        <span className="audit-total-pill">{total} eventos</span>
      </div>

      <form className="audit-screen-filters" onSubmit={submitFilters}>
        <input
          type="text"
          placeholder="Buscar por actor, modulo, accion o detalle"
          value={filters.q}
          onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value }))}
        />
        <select
          value={filters.module}
          onChange={(e) =>
            setFilters((p) => ({ ...p, module: e.target.value }))
          }
        >
          <option value="">Todos los modulos</option>
          <option value="auth">Auth</option>
          <option value="usuarios">Usuarios</option>
          <option value="roles">Roles</option>
          <option value="cuentas">Cuentas</option>
        </select>
        <select
          value={filters.status}
          onChange={(e) =>
            setFilters((p) => ({ ...p, status: e.target.value }))
          }
        >
          <option value="">Todos los estados</option>
          <option value="success">Exito</option>
          <option value="error">Error</option>
        </select>
        <input
          type="date"
          value={filters.from}
          onChange={(e) => setFilters((p) => ({ ...p, from: e.target.value }))}
        />
        <input
          type="date"
          value={filters.to}
          onChange={(e) => setFilters((p) => ({ ...p, to: e.target.value }))}
        />
        <div className="audit-screen-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={resetFilters}
          >
            Limpiar
          </button>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? "Buscando..." : "Aplicar"}
          </button>
        </div>
      </form>

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
                  {entry.entity_id ? ` #${entry.entity_id}` : ""}
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

      <div className="audit-pager">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => changePage(filters.page - 1)}
          disabled={filters.page <= 1 || loading}
        >
          Anterior
        </button>
        <span>
          Pagina {filters.page} de {Math.max(1, totalPages)}
        </span>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => changePage(filters.page + 1)}
          disabled={filters.page >= totalPages || loading}
        >
          Siguiente
        </button>
      </div>
    </section>
  );
}

function Dashboard() {
  return (
    <section className="panel">
      <h2>Dashboard</h2>
      <p>
        Base del CRM creada con usuarios, roles, permisos, cuentas, paises y
        monedas.
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

function UsersPage({ can }) {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [openUserMenuId, setOpenUserMenuId] = useState(null);
  const [editUser, setEditUser] = useState(null);
  const [editForm, setEditForm] = useState({
    fullName: "",
    email: "",
    mobile: "",
    roleIds: [],
  });
  const [sortField, setSortField] = useState("id");
  const [sortDirection, setSortDirection] = useState("asc");
  const [userQuery, setUserQuery] = useState("");
  const [auditLog, setAuditLog] = useState([]);
  const [auditQuery, setAuditQuery] = useState("");
  const [auditAction, setAuditAction] = useState("all");
  const [auditActor, setAuditActor] = useState("");
  const [auditTarget, setAuditTarget] = useState("");
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    mobile: "",
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
    const q = userQuery.trim().toLowerCase();
    if (!q) return sortedUsers;

    return sortedUsers.filter((u) => {
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
  }, [sortedUsers, userQuery]);

  function getAuditActionLabel(entry) {
    if (entry.action === "created") return "Creado";
    if (entry.action === "updated") return "Editado";
    if (entry.action === "password_reset_sent") return "Reinicio enviado";
    if (entry.action === "status_changed") {
      try {
        const d = JSON.parse(entry.detail || "{}");
        return d.status === "active" ? "Activado" : "Desactivado";
      } catch {
        return "Estado cambiado";
      }
    }
    return entry.action || "-";
  }

  function getAuditDetail(entry) {
    if (entry.action === "updated") {
      try {
        const d = JSON.parse(entry.detail || "{}");
        const parts = [];
        if (d.fields?.length) parts.push(d.fields.join(", "));
        if (d.rolesUpdated) parts.push("roles");
        return parts.join(", ") || "-";
      } catch {
        return "-";
      }
    }

    if (entry.action === "created") {
      try {
        const d = JSON.parse(entry.detail || "{}");
        return d.email || "-";
      } catch {
        return "-";
      }
    }

    return "-";
  }

  const filteredAuditLog = useMemo(() => {
    return auditLog.filter((entry) => {
      if (auditAction !== "all" && entry.action !== auditAction) return false;

      const actorKey = entry.performed_by_email
        ? entry.performed_by_email
        : `name:${entry.performed_by_name || "Sin nombre"}`;
      if (auditActor && actorKey !== auditActor) return false;

      const targetKey = entry.affected_user_email
        ? entry.affected_user_email
        : `name:${entry.affected_user_name || "Sin nombre"}`;
      if (auditTarget && targetKey !== auditTarget) return false;

      const queryText = [
        getAuditActionLabel(entry),
        getAuditDetail(entry),
        entry.performed_by_name,
        entry.performed_by_email,
        entry.affected_user_name,
        entry.affected_user_email,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (
        auditQuery.trim() &&
        !queryText.includes(auditQuery.trim().toLowerCase())
      ) {
        return false;
      }

      return true;
    });
  }, [auditLog, auditAction, auditActor, auditTarget, auditQuery]);

  const auditActorOptions = useMemo(() => {
    const map = new Map();
    for (const entry of auditLog) {
      const email = entry.performed_by_email || "";
      const name = entry.performed_by_name || "Sin nombre";
      const key = email || `name:${name}`;
      if (!map.has(key)) {
        map.set(key, {
          value: key,
          label: name,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.label.localeCompare(b.label, "es", { sensitivity: "base" }),
    );
  }, [auditLog]);

  const auditTargetOptions = useMemo(() => {
    const map = new Map();

    for (const user of users) {
      const email = user.email || "";
      const name = user.full_name || "Sin nombre";
      const key = email || `name:${name}`;
      if (!map.has(key)) {
        map.set(key, {
          value: key,
          label: name,
        });
      }
    }

    for (const entry of auditLog) {
      const email = entry.affected_user_email || "";
      const name = entry.affected_user_name || "Sin nombre";
      const key = email || `name:${name}`;
      if (!map.has(key)) {
        map.set(key, {
          value: key,
          label: name,
        });
      }
    }

    return Array.from(map.values()).sort((a, b) =>
      a.label.localeCompare(b.label, "es", { sensitivity: "base" }),
    );
  }, [users, auditLog]);

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
      const auditRes = await api.get("/api/users/audit");
      setAuditLog(auditRes.data);
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

  async function createUser(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      const { data } = await api.post("/api/users", form);
      setForm({
        fullName: "",
        email: "",
        mobile: "",
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
      <div className="users-header-row">
        <h2>Usuarios</h2>
        {can("usuarios.create") && !showCreateForm && (
          <button type="button" onClick={() => setShowCreateForm(true)}>
            Crear usuario
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

      <div className="users-list-filters">
        <input
          type="text"
          placeholder="Buscar usuario por nombre, email, móvil, estado o rol"
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
            filteredUsers.map((u) => (
              <tr key={u.id}>
                <td>{u.id}</td>
                <td>{u.full_name}</td>
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
                  <div className="user-kebab-wrap">
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
                              runUserAction(() =>
                                updateUserStatus(u.id, "inactive"),
                              )
                            }
                          >
                            Desactivar
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              runUserAction(() =>
                                updateUserStatus(u.id, "active"),
                              )
                            }
                          >
                            Activar
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            runUserAction(() => sendResetInvite(u.id))
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

      <div className="audit-section">
        <h3>Auditoría de usuarios ({auditLog.length})</h3>
        <div className="audit-filters">
          <input
            type="text"
            placeholder="Buscar en auditoría"
            value={auditQuery}
            onChange={(e) => setAuditQuery(e.target.value)}
          />
          <select
            value={auditAction}
            onChange={(e) => setAuditAction(e.target.value)}
          >
            <option value="all">Todas las acciones</option>
            <option value="created">Creado</option>
            <option value="updated">Editado</option>
            <option value="status_changed">Activado / Desactivado</option>
            <option value="password_reset_sent">Reinicio enviado</option>
          </select>
          <select
            value={auditActor}
            onChange={(e) => setAuditActor(e.target.value)}
          >
            <option value="">Realizado por: todos</option>
            {auditActorOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            value={auditTarget}
            onChange={(e) => setAuditTarget(e.target.value)}
          >
            <option value="">Usuario afectado: todos</option>
            {auditTargetOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setAuditQuery("");
              setAuditAction("all");
              setAuditActor("");
              setAuditTarget("");
            }}
          >
            Limpiar
          </button>
        </div>
        <table className="audit-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Acción</th>
              <th>Realizado por</th>
              <th>Usuario afectado</th>
              <th>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {filteredAuditLog.length > 0 ? (
              filteredAuditLog.map((entry) => (
                <tr key={entry.id}>
                  <td className="audit-date">
                    {new Date(entry.created_at).toLocaleString("es-MX", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </td>
                  <td>
                    <span
                      className={`audit-action-badge audit-${entry.action}`}
                    >
                      {getAuditActionLabel(entry)}
                    </span>
                  </td>
                  <td>{entry.performed_by_name || "-"}</td>
                  <td>{entry.affected_user_name || "-"}</td>
                  <td className="audit-detail">{getAuditDetail(entry)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="empty-state">
                  No hay resultados con los filtros seleccionados
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editUser && (
        <div className="modal-overlay" onClick={() => setEditUser(null)}>
          <div
            className="modal-dialog"
            style={{ maxWidth: 480 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="modal-title">Editar usuario</h3>
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

                <div
                  className="field-group modal-audit-small"
                  style={{ gridColumn: "1 / -1" }}
                >
                  <label>Auditoría de usuario</label>
                  <div className="role-audit-grid">
                    <div className="audit-item">
                      <span className="audit-label">Registro</span>
                      <span className="audit-value">
                        {formatDateTime(editUser.registered_at)}
                      </span>
                    </div>
                    <div className="audit-item">
                      <span className="audit-label">Última visita</span>
                      <span className="audit-value">
                        {formatDateTime(editUser.last_visit_at)}
                      </span>
                    </div>
                    <div className="audit-item">
                      <span className="audit-label">Creación de registro</span>
                      <span className="audit-value">
                        {formatDateTime(editUser.created_at)}
                      </span>
                    </div>
                    <div className="audit-item">
                      <span className="audit-label">Última actualización</span>
                      <span className="audit-value">
                        {formatDateTime(editUser.updated_at)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
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

function RolesPage({ can }) {
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [selectedRoleId, setSelectedRoleId] = useState(null);
  const [selectedPerms, setSelectedPerms] = useState([]);
  const [roleUsers, setRoleUsers] = useState([]);
  const [newRoleName, setNewRoleName] = useState("");
  const [showCreateRoleModal, setShowCreateRoleModal] = useState(false);
  const [creatingRole, setCreatingRole] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
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

  async function load() {
    try {
      const rolesUrl = showInactive
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
  }, [showInactive]);

  async function createRole(e) {
    e.preventDefault();
    if (!newRoleName.trim()) return;
    setError("");
    setSuccess("");
    setCreatingRole(true);
    try {
      await api.post("/api/roles", { name: newRoleName.trim() });
      const roleName = newRoleName.trim();
      setNewRoleName("");
      setShowCreateRoleModal(false);
      await load();
      setSuccess(`Rol "${roleName}" creado correctamente.`);
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible crear el rol"));
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
      if (!nextIsActive && !showInactive && selectedRoleId === roleId) {
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

  function formatDateTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString("es-ES");
  }

  const selectedRole = roles.find((r) => r.id === selectedRoleId) || null;

  return (
    <section className="panel">
      <div className="roles-header-row">
        <h2>Roles y permisos</h2>
        {can("roles.create") && (
          <button type="button" onClick={() => setShowCreateRoleModal(true)}>
            Crear rol
          </button>
        )}
      </div>
      <label className="role-filter">
        <input
          type="checkbox"
          checked={showInactive}
          onChange={(e) => setShowInactive(e.target.checked)}
        />
        Mostrar desactivados
      </label>
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

      {showCreateRoleModal && (
        <div
          className="modal-overlay"
          onClick={() => {
            if (creatingRole) return;
            setShowCreateRoleModal(false);
            setNewRoleName("");
          }}
        >
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Crear rol</h3>
            <form onSubmit={createRole}>
              <div className="field-group">
                <label>Nombre de rol</label>
                <input
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                  placeholder="Nombre de rol"
                  autoFocus
                  required
                />
              </div>
              <div className="modal-buttons" style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    if (creatingRole) return;
                    setShowCreateRoleModal(false);
                    setNewRoleName("");
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={creatingRole}
                >
                  {creatingRole ? "Creando..." : "Guardar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="split-3">
        <div>
          <h3>Roles ({roles.length})</h3>
          <ul className="list roles-list">
            {roles.map((r) => (
              <li
                key={r.id}
                className={
                  Number(r.is_active) === 1 ? "role-row" : "role-row inactive"
                }
              >
                <button
                  className={selectedRoleId === r.id ? "active" : ""}
                  onClick={() => selectRole(r.id)}
                >
                  <span className="role-header-line">
                    <span className="role-name">{r.name}</span>{" "}
                    <span
                      className={
                        Number(r.is_active) === 1
                          ? "role-status-badge active"
                          : "role-status-badge inactive"
                      }
                    >
                      {Number(r.is_active) === 1 ? "Activo" : "Desactivado"}
                    </span>{" "}
                    ({r.permissions_count})
                  </span>
                  <span className="role-description">
                    {r.description || "Sin descripcion"}
                  </span>
                </button>
                {can("roles.update") && Number(r.is_system) !== 1 && (
                  <button
                    type="button"
                    className="role-toggle"
                    onClick={() =>
                      updateRoleStatus(r, Number(r.is_active) !== 1)
                    }
                  >
                    {Number(r.is_active) === 1 ? "Desactivar" : "Activar"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3>Permisos ({permissions.length})</h3>
          <div className="checkbox-grid">
            {permissions.map((p) => (
              <label key={p.id}>
                <input
                  type="checkbox"
                  checked={selectedPerms.includes(Number(p.id))}
                  onChange={(e) => {
                    const permissionId = Number(p.id);
                    if (e.target.checked) {
                      setSelectedPerms((prev) => [...prev, permissionId]);
                    } else {
                      setSelectedPerms((prev) =>
                        prev.filter((id) => id !== permissionId),
                      );
                    }
                  }}
                />
                {p.code}
              </label>
            ))}
          </div>
          {can("roles.update") && (
            <button onClick={savePerms}>Guardar permisos</button>
          )}
        </div>

        <div>
          <h3>Usuarios {selectedRoleId ? `(${roleUsers.length})` : ""}</h3>
          {selectedRoleId ? (
            <div className="users-list">
              {roleUsers.length > 0 ? (
                <ul className="list">
                  {roleUsers.map((u) => (
                    <li key={u.id} className="user-item">
                      <div className="user-name">{u.full_name}</div>
                      <div className="user-email">{u.email}</div>
                      <div className="user-status">{u.status}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty-state">No hay usuarios con este rol</p>
              )}
            </div>
          ) : (
            <p className="empty-state">Selecciona un rol para ver usuarios</p>
          )}
        </div>
      </div>

      <div className="role-audit-panel">
        <h3>Auditoria del rol</h3>
        {selectedRole ? (
          <div className="role-audit-grid">
            <div className="audit-item">
              <span className="audit-label">Creado por</span>
              <span className="audit-value">
                {selectedRole.created_by_user_name || "No registrado"}
              </span>
            </div>
            <div className="audit-item">
              <span className="audit-label">Fecha de creacion</span>
              <span className="audit-value">
                {formatDateTime(selectedRole.created_at)}
              </span>
            </div>
            <div className="audit-item">
              <span className="audit-label">Modificado por</span>
              <span className="audit-value">
                {selectedRole.updated_by_user_name || "No registrado"}
              </span>
            </div>
            <div className="audit-item">
              <span className="audit-label">Fecha de modificacion</span>
              <span className="audit-value">
                {formatDateTime(selectedRole.updated_at)}
              </span>
            </div>
          </div>
        ) : (
          <p className="empty-state">
            Selecciona un rol para ver datos de creacion y modificacion
          </p>
        )}
      </div>
    </section>
  );
}

function AccountsPage({ can, currentUser }) {
  const [accounts, setAccounts] = useState([]);
  const [users, setUsers] = useState([]);
  const [showInactiveAccounts, setShowInactiveAccounts] = useState(false);
  const [accountQuery, setAccountQuery] = useState("");
  const [accountSortField, setAccountSortField] = useState("id");
  const [accountSortDirection, setAccountSortDirection] = useState("asc");
  const [showCreateAccountModal, setShowCreateAccountModal] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState(null);
  const [editAccountAudit, setEditAccountAudit] = useState(null);
  const [openAccountMenuId, setOpenAccountMenuId] = useState(null);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [catalogs, setCatalogs] = useState({
    countries: [],
    accountTypes: [],
    sectors: [],
    statuses: [],
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!error && !success) return;
    const timeoutId = window.setTimeout(() => {
      setError("");
      setSuccess("");
    }, 4000);
    return () => window.clearTimeout(timeoutId);
  }, [error, success]);

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
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
        api.get("/api/users"),
        api.get("/api/catalogs/countries"),
        api.get("/api/catalogs/account-types"),
        api.get("/api/catalogs/economic-sectors"),
        api.get("/api/catalogs/account-activation-statuses"),
      ]);
      setAccounts(accountsRes.data);
      setUsers(usersRes.data.filter((u) => u.status === "active"));
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
    setForm(buildDefaultAccountForm());
    setShowCreateAccountModal(true);
  }

  function closeAccountModal() {
    if (creatingAccount) return;
    setShowCreateAccountModal(false);
    setEditingAccountId(null);
    setEditAccountAudit(null);
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

  const filteredAccounts = useMemo(() => {
    if (showInactiveAccounts) return accounts;
    return accounts.filter((account) => isAccountActive(account));
  }, [accounts, showInactiveAccounts]);

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
    return isAccountActive(account)
      ? "user-status-badge active"
      : "user-status-badge inactive";
  }

  function getAccountStatusLabel(account) {
    return isAccountActive(account) ? "Activada" : "Desactivada";
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

  async function openEditAccountModal(accountId) {
    setError("");
    setSuccess("");
    try {
      const { data } = await api.get(`/api/accounts/${accountId}`);
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
      <div className="accounts-header-row">
        <h2>Cuentas</h2>
        {can("cuentas.create") && (
          <button type="button" onClick={openCreateAccountModal}>
            Crear cuenta
          </button>
        )}
      </div>
      <label className="role-filter">
        <input
          type="checkbox"
          checked={showInactiveAccounts}
          onChange={(e) => setShowInactiveAccounts(e.target.checked)}
        />
        Mostrar desactivadas
      </label>

      <div className="accounts-list-filters">
        <input
          type="text"
          placeholder="Buscar cuenta por ID, nombre, tipo, pais, registro o estado"
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
            <h3 className="modal-title">
              {editingAccountId ? "Editar cuenta" : "Crear cuenta"}
            </h3>
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
                          <span className="owner-name">{u.full_name}</span>
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
                      return (
                        <label key={u.id} className="owners-list-item">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleOwnerUser(u.id)}
                          />
                          <span className="owners-list-text">
                            <span className="owner-name">{u.full_name}</span>
                            <span className="owner-email">{u.email}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </section>

              {editingAccountId && (
                <section className="account-form-section account-audit-small">
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
            visibleAccounts.map((a) => (
              <tr key={a.id}>
                <td>{a.id}</td>
                <td>{a.name}</td>
                <td>{a.account_type}</td>
                <td>{a.country}</td>
                <td>{a.registration_code}</td>
                <td>
                  <span className={getAccountStatusBadgeClass(a)}>
                    {getAccountStatusLabel(a)}
                  </span>
                </td>
                <td className="accounts-actions-cell">
                  <div className="user-kebab-wrap">
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
                          disabled={isAccountActive(a)}
                          onClick={() =>
                            runAccountAction(() =>
                              updateAccountStatus(a, "activada"),
                            )
                          }
                        >
                          Activar
                        </button>
                        <button
                          type="button"
                          disabled={!isAccountActive(a)}
                          onClick={() =>
                            runAccountAction(() =>
                              updateAccountStatus(a, "desactivada"),
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
              <td colSpan={7} className="empty-state">
                No hay cuentas que coincidan con los filtros
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

export default App;
