import { Suspense, lazy, useMemo } from "react";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import Dashboard from "./Dashboard";
import { confirmQuotationNavigation } from "./quotations/quotationNavigationGuard";

const OpportunityQuestionAdminPage = lazy(
  () => import("./OpportunityQuestionAdminPage"),
);
const SystemAuditPage = lazy(() => import("./SystemAuditPage"));
const ConfigurationPage = lazy(() => import("./ConfigurationPage"));
const UsersPage = lazy(() => import("./UsersPage"));
const RolesPage = lazy(() => import("./RolesPage"));
const AccountsPage = lazy(() => import("./AccountsPage"));
const InteractionsPage = lazy(() => import("./InteractionsPage"));
const ProvidersPage = lazy(() => import("./ProvidersPage"));
const OpportunitiesPage = lazy(() => import("./OpportunitiesPage"));
const ExecutionCommercialPage = lazy(() => import("./ExecutionCommercialPage"));
const CommercialEnablementPage = lazy(
  () => import("./CommercialEnablementPage"),
);
const PotentialOpportunitiesPage = lazy(
  () => import("./PotentialOpportunitiesPage"),
);
const ContactsPage = lazy(() => import("./ContactsPage"));
const QuotationsPage = lazy(() => import("./QuotationsPage"));
const QuotationPrintPage = lazy(() => import("./QuotationPrintPage"));

function GuardedNavLink({ onBeforeNavigate, onClick, ...props }) {
  return (
    <NavLink
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) {
          return;
        }

        if (!onBeforeNavigate()) {
          event.preventDefault();
        }
      }}
    />
  );
}

function RouteFallback() {
  return <div className="centered">Cargando...</div>;
}

function SidebarNavGroup({ title, children }) {
  return (
    <div className="sidebar-nav-group">
      <div className="sidebar-nav-group-title">{title}</div>
      <div className="sidebar-nav-group-links">{children}</div>
    </div>
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
  onLogout,
  onRefreshCurrentUser,
}) {
  const location = useLocation();
  const can = useMemo(() => {
    const set = new Set(currentUser.permissions || []);
    return (permission) => set.has(permission);
  }, [currentUser]);

  const canAccessQuotations = [
    "cotizaciones.operacion",
    "cotizaciones.revision",
    "cotizaciones.ingreso",
    "cotizaciones.administracion",
    "cotizaciones.externo",
  ].some(can);
  const canAccessInteractions =
    can("interacciones.read") || can("interacciones.read_all");
  const canAccessPotentialOpportunities =
    can("oportunidades_potenciales.read") ||
    can("oportunidades_potenciales.read_all");
  const canAccessCommercialEnablement =
    can("enablement_comercial.read") ||
    can("enablement_comercial.update") ||
    can("enablement_comercial.analytics");
  const canOpenCommercialEnablementShell =
    canAccessCommercialEnablement || can("oportunidades.read");
  const confirmRouteChange = () => confirmQuotationNavigation();
  const isQuotationPrintRoute = location.pathname === "/quotations/print";

  const appRoutes = (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route
          path="/settings"
          element={
            can("configuracion.read") ? (
              <ConfigurationPage />
            ) : (
              <Navigate to="/" />
            )
          }
        />
        <Route
          path="/users"
          element={
            can("usuarios.read") ? <UsersPage can={can} /> : <Navigate to="/" />
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
              <AccountsPage can={can} currentUser={currentUser} />
            ) : (
              <Navigate to="/" />
            )
          }
        />
        <Route
          path="/interactions"
          element={
            can("interacciones.read") || can("interacciones.read_all") ? (
              <InteractionsPage can={can} currentUser={currentUser} />
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
          path="/execution-commercial"
          element={
            can("oportunidades.read") ? (
              <ExecutionCommercialPage currentUser={currentUser} />
            ) : (
              <Navigate to="/" />
            )
          }
        />
        <Route
          path="/commercial-enablement"
          element={
            canOpenCommercialEnablementShell ? (
              <CommercialEnablementPage currentUser={currentUser} />
            ) : (
              <Navigate to="/" />
            )
          }
        />
        <Route
          path="/potential-opportunities"
          element={
            canAccessPotentialOpportunities ? (
              <PotentialOpportunitiesPage can={can} currentUser={currentUser} />
            ) : (
              <Navigate to="/" />
            )
          }
        />
        <Route
          path="/quotations"
          element={
            canAccessQuotations ? (
              <QuotationsPage currentUser={currentUser} />
            ) : (
              <Navigate to="/" />
            )
          }
        />
        <Route
          path="/quotations/print"
          element={
            canAccessQuotations ? <QuotationPrintPage /> : <Navigate to="/" />
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
          element={
            can("audit.read") ? <SystemAuditPage /> : <Navigate to="/" />
          }
        />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Suspense>
  );

  if (isQuotationPrintRoute) {
    return appRoutes;
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>NewPeople CRM</h1>
        <nav>
          <SidebarNavGroup title="General">
            <GuardedNavLink to="/" onBeforeNavigate={confirmRouteChange}>
              Dashboard
            </GuardedNavLink>
          </SidebarNavGroup>

          {(can("cuentas.read") ||
            can("contactos.read") ||
            canAccessInteractions ||
            canAccessPotentialOpportunities ||
            can("oportunidades.read") ||
            canAccessQuotations) && (
            <SidebarNavGroup title="Comercial">
              {can("cuentas.read") && (
                <GuardedNavLink
                  to="/accounts"
                  onBeforeNavigate={confirmRouteChange}
                >
                  Cuentas
                </GuardedNavLink>
              )}
              {can("contactos.read") && (
                <GuardedNavLink
                  to="/contacts"
                  onBeforeNavigate={confirmRouteChange}
                >
                  Contactos
                </GuardedNavLink>
              )}
              {canAccessInteractions && (
                <GuardedNavLink
                  to="/interactions"
                  onBeforeNavigate={confirmRouteChange}
                >
                  Interacciones
                </GuardedNavLink>
              )}
              {can("oportunidades.read") && (
                <GuardedNavLink
                  to="/opportunities"
                  end
                  onBeforeNavigate={confirmRouteChange}
                >
                  Oportunidades
                </GuardedNavLink>
              )}
              {canAccessPotentialOpportunities && (
                <GuardedNavLink
                  to="/potential-opportunities"
                  onBeforeNavigate={confirmRouteChange}
                >
                  Oportunidades potenciales
                </GuardedNavLink>
              )}
              {canAccessQuotations && (
                <GuardedNavLink
                  to="/quotations"
                  onBeforeNavigate={confirmRouteChange}
                >
                  Cotizaciones
                </GuardedNavLink>
              )}
            </SidebarNavGroup>
          )}

          {(can("oportunidades.read") || canOpenCommercialEnablementShell) && (
            <SidebarNavGroup title="Ejecucion">
              {can("oportunidades.read") ? (
                <GuardedNavLink
                  to="/execution-commercial"
                  onBeforeNavigate={confirmRouteChange}
                >
                  Ejecucion Comercial
                </GuardedNavLink>
              ) : null}
              {canOpenCommercialEnablementShell ? (
                <GuardedNavLink
                  to="/commercial-enablement"
                  onBeforeNavigate={confirmRouteChange}
                >
                  Enablement Comercial
                </GuardedNavLink>
              ) : null}
            </SidebarNavGroup>
          )}

          {(can("proveedores.read") || can("oportunidades.update")) && (
            <SidebarNavGroup title="Operacion comercial">
              {can("proveedores.read") && (
                <GuardedNavLink
                  to="/providers"
                  onBeforeNavigate={confirmRouteChange}
                >
                  Proveedores
                </GuardedNavLink>
              )}
              {can("oportunidades.update") && (
                <GuardedNavLink
                  to="/opportunities/questions"
                  onBeforeNavigate={confirmRouteChange}
                >
                  Preguntas comerciales
                </GuardedNavLink>
              )}
            </SidebarNavGroup>
          )}

          {(can("usuarios.read") ||
            can("roles.read") ||
            can("configuracion.read")) && (
            <SidebarNavGroup title="Administracion">
              {can("usuarios.read") && (
                <GuardedNavLink
                  to="/users"
                  onBeforeNavigate={confirmRouteChange}
                >
                  Usuarios
                </GuardedNavLink>
              )}
              {can("roles.read") && (
                <GuardedNavLink
                  to="/roles"
                  onBeforeNavigate={confirmRouteChange}
                >
                  Roles
                </GuardedNavLink>
              )}
              {can("configuracion.read") && (
                <GuardedNavLink
                  to="/settings"
                  onBeforeNavigate={confirmRouteChange}
                >
                  Configuracion
                </GuardedNavLink>
              )}
            </SidebarNavGroup>
          )}

          {can("audit.read") && (
            <SidebarNavGroup title="Control">
              <GuardedNavLink to="/audit" onBeforeNavigate={confirmRouteChange}>
                Auditoria
              </GuardedNavLink>
            </SidebarNavGroup>
          )}
        </nav>
        <button
          className="logout"
          onClick={() => {
            if (!confirmRouteChange()) {
              return;
            }

            onLogout();
          }}
        >
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

        {appRoutes}
      </main>
    </div>
  );
}
