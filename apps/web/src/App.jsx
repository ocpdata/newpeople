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
          {can("contactos.read") && <NavLink to="/contacts">Contactos</NavLink>}
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
            path="/contacts"
            element={
              can("contactos.read") ? (
                <ContactsPage can={can} />
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
  const [showAccountStatusMenu, setShowAccountStatusMenu] = useState(false);
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
    setShowAccountStatusMenu(false);
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

  function getEditingActivationMeta() {
    const selectedStatus = catalogs.statuses.find(
      (x) => String(x.id) === String(form.activationStatusId),
    );
    const statusCode = normalizeText(selectedStatus?.code || "");
    const statusName = normalizeText(selectedStatus?.name || "");
    const isActive = statusCode === "activada" || statusName === "activada";

    return {
      label: selectedStatus?.name || "No definido",
      isActive,
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
            <div className="modal-header">
              <h3 className="modal-title">
                {editingAccountId ? "Editar cuenta" : "Crear cuenta"}
              </h3>
              {editingAccountId && (
                <div
                  className="status-badge-wrapper"
                  style={{ position: "relative" }}
                >
                  <button
                    type="button"
                    className={
                      getEditingActivationMeta().isActive
                        ? "status-icon-badge active"
                        : "status-icon-badge inactive"
                    }
                    title={
                      can("cuentas.update")
                        ? "Click para cambiar estado"
                        : "Estado de activacion (solo lectura)"
                    }
                    onClick={() =>
                      can("cuentas.update") &&
                      setShowAccountStatusMenu(!showAccountStatusMenu)
                    }
                    style={{
                      cursor: can("cuentas.update") ? "pointer" : "default",
                      border: "none",
                      background: "inherit",
                      padding: "4px 8px",
                    }}
                  >
                    <span className="status-dot" aria-hidden="true" />
                    {getEditingActivationMeta().label}
                  </button>
                  {showAccountStatusMenu && can("cuentas.update") && (
                    <div
                      className="status-menu-dropdown"
                      style={{
                        position: "absolute",
                        top: "100%",
                        right: 0,
                        backgroundColor: "#fff",
                        border: "1px solid #d0d7de",
                        borderRadius: "6px",
                        boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                        zIndex: 1000,
                        minWidth: "150px",
                        marginTop: "4px",
                      }}
                    >
                      {catalogs.statuses.map((status) => (
                        <button
                          key={status.id}
                          type="button"
                          onClick={async () => {
                            const statusCode = normalizeText(status.code);
                            try {
                              setCreatingAccount(true);
                              const resp = await fetch(
                                `/api/accounts/${editingAccountId}/status`,
                                {
                                  method: "PUT",
                                  headers: {
                                    "Content-Type": "application/json",
                                    Authorization: `Bearer ${token}`,
                                  },
                                  body: JSON.stringify({ statusCode }),
                                },
                              );
                              if (!resp.ok) {
                                const err = await resp.json();
                                throw new Error(
                                  err.message || "Error al cambiar estado",
                                );
                              }
                              setForm({
                                ...form,
                                activationStatusId: String(status.id),
                              });
                              setShowAccountStatusMenu(false);
                              setSuccess("Estado actualizado exitosamente");
                            } catch (err) {
                              setError(
                                getApiErrorMessage(
                                  err,
                                  "No fue posible cambiar el estado",
                                ),
                              );
                            } finally {
                              setCreatingAccount(false);
                            }
                          }}
                          style={{
                            display: "block",
                            width: "100%",
                            padding: "8px 12px",
                            textAlign: "left",
                            border: "none",
                            background:
                              String(form.activationStatusId) ===
                              String(status.id)
                                ? "#f0f4f8"
                                : "inherit",
                            cursor: "pointer",
                            fontSize: "14px",
                          }}
                          onMouseEnter={(e) => {
                            e.target.style.background = "#f0f4f8";
                          }}
                          onMouseLeave={(e) => {
                            if (
                              String(form.activationStatusId) !==
                              String(status.id)
                            ) {
                              e.target.style.background = "inherit";
                            }
                          }}
                        >
                          {status.name}
                        </button>
                      ))}
                    </div>
                  )}
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

function ContactsPage({ can }) {
  const [contacts, setContacts] = useState([]);
  const [showInactiveContacts, setShowInactiveContacts] = useState(false);
  const [contactQuery, setContactQuery] = useState("");
  const [contactSortField, setContactSortField] = useState("id");
  const [contactSortDirection, setContactSortDirection] = useState("asc");
  const [showContactModal, setShowContactModal] = useState(false);
  const [editingContactId, setEditingContactId] = useState(null);
  const [openContactMenuId, setOpenContactMenuId] = useState(null);
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
      purchaseParticipationId: String(
        catalogs.purchaseParticipations?.[0]?.id || "",
      ),
      relationshipTypeId: String(catalogs.relationshipTypes?.[0]?.id || ""),
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
  }

  function isContactActive(contact) {
    return normalizeText(contact.activation_status) === "activado";
  }

  function getContactStatusLabel(contact) {
    return isContactActive(contact) ? "Activado" : "Desactivado";
  }

  function getContactStatusBadgeClass(contact) {
    return isContactActive(contact)
      ? "user-status-badge active"
      : "user-status-badge inactive";
  }

  const filteredContacts = useMemo(() => {
    if (showInactiveContacts) return contacts;
    return contacts.filter((contact) => isContactActive(contact));
  }, [contacts, showInactiveContacts]);

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

  function toggleContactMenu(contactId) {
    setOpenContactMenuId((prev) => (prev === contactId ? null : contactId));
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
    return contacts.filter((c) => Number(c.id) !== Number(editingContactId));
  }, [contacts, editingContactId]);

  return (
    <section className="panel">
      <div className="accounts-header-row">
        <h2>Contactos</h2>
        {can("contactos.create") && (
          <button type="button" onClick={openCreateContactModal}>
            Crear contacto
          </button>
        )}
      </div>

      <label className="role-filter">
        <input
          type="checkbox"
          checked={showInactiveContacts}
          onChange={(e) => setShowInactiveContacts(e.target.checked)}
        />
        Mostrar desactivados
      </label>

      <div className="accounts-list-filters">
        <input
          type="text"
          placeholder="Buscar contacto por nombre, cuenta, cargo, email, móvil o estado"
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
            <h3 className="modal-title">
              {editingContactId ? "Editar contacto" : "Crear contacto"}
            </h3>
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
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          accountId: e.target.value,
                        }))
                      }
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
                  {editingContactId && (
                    <div className="field-group">
                      <label>
                        Estado de activacion{" "}
                        <span className="required-mark">*</span>
                      </label>
                      <input
                        value={
                          catalogs.activationStatuses.find(
                            (x) =>
                              String(x.id) === String(form.activationStatusId),
                          )?.name || "No definido"
                        }
                        disabled
                        readOnly
                      />
                    </div>
                  )}
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
            visibleContacts.map((c) => (
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
                  <div className="user-kebab-wrap">
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
                          disabled={isContactActive(c)}
                          onClick={() =>
                            runContactAction(() =>
                              updateContactStatus(c, "activado"),
                            )
                          }
                        >
                          Activar
                        </button>
                        <button
                          type="button"
                          disabled={!isContactActive(c)}
                          onClick={() =>
                            runContactAction(() =>
                              updateContactStatus(c, "desactivado"),
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
              <td colSpan={8} className="empty-state">
                No hay contactos que coincidan con los filtros
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

export default App;
