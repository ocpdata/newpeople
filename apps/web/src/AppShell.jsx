import { useMemo } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import OpportunityQuestionAdminPage from "./OpportunityQuestionAdminPage";
import Dashboard from "./Dashboard";
import SystemAuditPage from "./SystemAuditPage";
import UsersPage from "./UsersPage";
import RolesPage from "./RolesPage";
import AccountsPage from "./AccountsPage";
import ProvidersPage from "./ProvidersPage";
import OpportunitiesPage from "./OpportunitiesPage";
import ContactsPage from "./ContactsPage";

function getUserInitials(fullName) {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (!parts.length) return "U";
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

export function UserAvatar({ src, fullName, size = "md" }) {
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

export default function AppShell({
  currentUser,
  token,
  onLogout,
  onRefreshCurrentUser,
}) {
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
          {can("proveedores.read") && (
            <NavLink to="/providers">Proveedores</NavLink>
          )}
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
            element={can("usuarios.read") ? <UsersPage can={can} /> : <Navigate to="/" />}
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
                <AccountsPage can={can} currentUser={currentUser} />
              ) : (
                <Navigate to="/" />
              )
            }
          />
          <Route
            path="/providers"
            element={
              can("proveedores.read") ? (
                <ProvidersPage can={can} currentUser={currentUser} />
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
                <ContactsPage can={can} currentUser={currentUser} />
              ) : (
                <Navigate to="/" />
              )
            }
          />
          <Route
            path="/audit"
            element={can("audit.read") ? <SystemAuditPage /> : <Navigate to="/" />}
          />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}