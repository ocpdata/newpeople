import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import Dashboard from "./Dashboard";
import DashboardHomePage from "./DashboardHomePage";
import DashboardsPage from "./DashboardsPage";
import { confirmQuotationNavigation } from "./quotations/quotationNavigationGuard";
import { api } from "./api";
import { HelpDrawer, HelpTourCoach } from "./help/HelpWidgets";
import { ChatbotContextProvider } from "./chatbot/context.jsx";
import ChatbotWidget from "./chatbot/ChatbotWidget";

const OpportunityQuestionAdminPage = lazy(
  () => import("./OpportunityQuestionAdminPage"),
);
const SystemAuditPage = lazy(() => import("./SystemAuditPage"));
const ConfigurationPage = lazy(() => import("./ConfigurationPage"));
const AccountSettingsPage = lazy(() => import("./AccountSettingsPage"));
const ToolsPage = lazy(() => import("./ToolsPage"));
const PriceListDuplicatesPage = lazy(() => import("./PriceListDuplicatesPage"));
const UsersPage = lazy(() => import("./UsersPage"));
const RolesPage = lazy(() => import("./RolesPage"));
const AccountsPage = lazy(() => import("./AccountsPage"));
const InteractionsPage = lazy(() => import("./InteractionsPage"));
const ProvidersPage = lazy(() => import("./ProvidersPage"));
const OpportunitiesPage = lazy(() => import("./OpportunitiesPage"));
const CommercialDevelopmentPage = lazy(
  () => import("./CommercialDevelopmentPage"),
);
const CalendarPage = lazy(() => import("./CalendarPage"));
const CommercialTrackingPage = lazy(() => import("./CommercialTrackingPage"));
const SellerLeagueTvPage = lazy(() => import("./SellerLeagueTvPage"));
const CommercialPlanningPage = lazy(() => import("./CommercialPlanningPage"));
const CommercialEnablementPage = lazy(
  () => import("./CommercialEnablementPage"),
);
const ManufacturerRegistrationsPage = lazy(
  () => import("./ManufacturerRegistrationsPage"),
);
const ContactsPage = lazy(() => import("./ContactsPage"));
const ContactMappingPage = lazy(() => import("./ContactMappingPage"));
const QuotationsPage = lazy(() => import("./QuotationsPage"));
const QuotationPrintPage = lazy(() => import("./QuotationPrintPage"));
const ProposalsPage = lazy(() => import("./ProposalsPage"));
const ProposalPrintPage = lazy(() => import("./ProposalPrintPage"));
const LandingModulePage = lazy(() => import("./LandingModulePage"));
const CampaignsPage = lazy(() => import("./CampaignsPage"));
const CampaignEmailModulePage = lazy(() => import("./CampaignEmailModulePage"));

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
  const [aiCreditSummary, setAiCreditSummary] = useState(null);
  const appVersion = __APP_VERSION__;
  const appCommit = __APP_COMMIT__;
  const location = useLocation();
  const can = useMemo(() => {
    const set = new Set(currentUser.permissions || []);
    return (permission) => set.has(permission);
  }, [currentUser]);

  useEffect(() => {
    let mounted = true;

    async function fetchAiCreditSummary() {
      try {
        const { data } = await api.get("/api/ai/me/credit-summary");
        if (mounted) {
          setAiCreditSummary(data);
        }
      } catch {
        if (mounted) {
          setAiCreditSummary(null);
        }
      }
    }

    fetchAiCreditSummary();

    return () => {
      mounted = false;
    };
  }, [currentUser?.id]);

  const aiCreditPercent = Math.max(
    0,
    Math.min(100, Number(aiCreditSummary?.consumedPercent || 0)),
  );
  const aiCreditAvailablePercent = Math.max(0, 100 - aiCreditPercent);
  const aiCreditState = String(aiCreditSummary?.state || "normal").trim();

  const canAccessQuotations = [
    "cotizaciones.operacion",
    "cotizaciones.revision",
    "cotizaciones.ingreso",
    "cotizaciones.administracion",
    "cotizaciones.externo",
  ].some(can);
  const canAccessProposals = [
    "propuestas.read",
    "propuestas.create",
    "propuestas.update",
    "cotizaciones.operacion",
    "cotizaciones.revision",
    "cotizaciones.ingreso",
    "cotizaciones.administracion",
    "cotizaciones.externo",
  ].some(can);
  const canAccessInteractions =
    can("interacciones.read") || can("interacciones.read_all");
  const canReadAccounts = can("cuentas.read") || can("cuentas.read_all");
  const canReadContacts = can("contactos.read") || can("contactos.read_all");
  const canReadOpportunities =
    can("oportunidades.read") || can("oportunidades.read_all");
  const canAccessCommercialDevelopment =
    (can("desarrollo_comercial.read") || can("desarrollo_comercial.update")) &&
    canReadOpportunities;
  const canAccessCommercialTracking =
    can("seguimiento_comercial.read") && canReadOpportunities;
  const canAccessCommercialRhythm = can("ritmo_comercial.read");
  const canAccessCommercialCalendar =
    (can("calendario_comercial.read") ||
      can("calendario_comercial.update") ||
      can("calendario_comercial.read_all")) &&
    canReadOpportunities;
  const canAccessProcessCommercialConfig =
    can("proceso_comercial_config.read") ||
    can("proceso_comercial_config.update");
  const canAccessCommercialPlanning = can("planeacion_comercial.read");
  const canAccessCommercialEnablement =
    can("enablement_comercial.use") ||
    can("enablement_comercial.upload") ||
    can("enablement_comercial.manage") ||
    can("enablement_comercial.admin") ||
    can("enablement_comercial.read") ||
    can("enablement_comercial.update") ||
    can("enablement_comercial.analytics");
  const canAccessManufacturerRegistrations =
    can("registros_fabricantes.read") || can("registros_fabricantes.read_all");
  const canAccessLandingModule =
    can("landing.read") ||
    can("landing.create") ||
    can("landing.update") ||
    can("landing.publish") ||
    can("landing.submissions.read") ||
    can("landing.submissions.reprocess");
  const canAccessCampaigns =
    can("campanas.read") || can("campanas.create") || can("campanas.update");
  const canAccessCampaignEmails = canAccessCampaigns;
  const canAccessAnyDashboard =
    canAccessCommercialTracking ||
    canAccessCommercialRhythm ||
    canAccessCommercialPlanning ||
    canAccessCommercialDevelopment ||
    canAccessInteractions;
  const confirmRouteChange = () => confirmQuotationNavigation();
  const isQuotationPrintRoute = location.pathname === "/quotations/print";
  const isSellerLeagueTvStandaloneRoute =
    location.pathname === "/seller-league-tv/window";

  const appRoutes = (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route
          path="/"
          element={
            <DashboardHomePage
              canAccessCommercialTracking={canAccessCommercialTracking}
              canAccessCommercialRhythm={canAccessCommercialRhythm}
              canAccessCommercialPlanning={canAccessCommercialPlanning}
              canAccessInteractions={canAccessInteractions}
              canReadOpportunities={canReadOpportunities}
              canReadAccounts={canReadAccounts}
              canReadContacts={canReadContacts}
            />
          }
        />
        <Route
          path="/dashboards"
          element={
            <DashboardsPage
              canAccessCommercialTracking={canAccessCommercialTracking}
              canAccessCommercialRhythm={canAccessCommercialRhythm}
              canAccessCommercialPlanning={canAccessCommercialPlanning}
              canAccessCommercialDevelopment={canAccessCommercialDevelopment}
              canAccessInteractions={canAccessInteractions}
            />
          }
        />
        <Route
          path="/dashboards/cuota-mensual"
          element={
            canAccessCommercialTracking ? (
              <Dashboard
                canAccessCommercialTracking={canAccessCommercialTracking}
              />
            ) : (
              <Navigate to="/dashboards" />
            )
          }
        />
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
          path="/account-settings"
          element={
            <AccountSettingsPage
              currentUser={currentUser}
              onRefreshCurrentUser={onRefreshCurrentUser}
            />
          }
        />
        <Route
          path="/tools"
          element={
            can("herramientas.read") ? <ToolsPage /> : <Navigate to="/" />
          }
        />
        <Route
          path="/tools/price-list-duplicates"
          element={
            can("herramientas.read") ? (
              <PriceListDuplicatesPage />
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
            canReadAccounts ? (
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
            canAccessProcessCommercialConfig ? (
              <OpportunityQuestionAdminPage
                canUpdate={can("proceso_comercial_config.update")}
              />
            ) : (
              <Navigate to="/" />
            )
          }
        />
        <Route
          path="/opportunities"
          element={
            canReadOpportunities ? (
              <OpportunitiesPage can={can} currentUser={currentUser} />
            ) : (
              <Navigate to="/" />
            )
          }
        />
        <Route
          path="/manufacturer-registrations"
          element={
            canAccessManufacturerRegistrations &&
            (can("oportunidades.read") || can("oportunidades.read_all")) ? (
              <ManufacturerRegistrationsPage can={can} />
            ) : (
              <Navigate to="/" />
            )
          }
        />
        <Route
          path="/commercial-development"
          element={
            canAccessCommercialDevelopment ? (
              <CommercialDevelopmentPage
                currentUser={currentUser}
                canAccessCommercialCalendar={canAccessCommercialCalendar}
              />
            ) : (
              <Navigate to="/" />
            )
          }
        />
        <Route
          path="/calendar"
          element={
            canAccessCommercialCalendar ? (
              <CalendarPage currentUser={currentUser} />
            ) : (
              <Navigate to="/" />
            )
          }
        />
        <Route
          path="/execution-commercial"
          element={<Navigate to="/commercial-development" replace />}
        />
        <Route
          path="/commercial-tracking"
          element={
            canAccessCommercialTracking ? (
              <CommercialTrackingPage />
            ) : (
              <Navigate to="/" />
            )
          }
        />
        <Route
          path="/seller-league-tv"
          element={
            canAccessCommercialRhythm ? (
              <SellerLeagueTvPage />
            ) : (
              <Navigate to="/" />
            )
          }
        />
        <Route
          path="/seller-league-tv/window"
          element={
            canAccessCommercialRhythm ? (
              <SellerLeagueTvPage />
            ) : (
              <Navigate to="/" />
            )
          }
        />
        <Route
          path="/commercial-planning"
          element={
            canAccessCommercialPlanning ? (
              <CommercialPlanningPage can={can} />
            ) : (
              <Navigate to="/" />
            )
          }
        />
        <Route
          path="/commercial-enablement"
          element={
            canAccessCommercialEnablement ? (
              <CommercialEnablementPage currentUser={currentUser} />
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
          path="/proposals"
          element={canAccessProposals ? <ProposalsPage /> : <Navigate to="/" />}
        />
        <Route
          path="/proposals/print"
          element={
            canAccessProposals ? <ProposalPrintPage /> : <Navigate to="/" />
          }
        />
        <Route
          path="/landing"
          element={
            canAccessLandingModule ? <LandingModulePage /> : <Navigate to="/" />
          }
        />
        <Route
          path="/campaigns"
          element={canAccessCampaigns ? <CampaignsPage /> : <Navigate to="/" />}
        />
        <Route
          path="/campaign-management"
          element={<Navigate to="/campaigns" replace />}
        />
        <Route
          path="/campaign-emails"
          element={
            canAccessCampaignEmails ? (
              <CampaignEmailModulePage />
            ) : (
              <Navigate to="/" />
            )
          }
        />
        <Route
          path="/contacts"
          element={
            canReadContacts ? (
              <ContactsPage can={can} currentUser={currentUser} />
            ) : (
              <Navigate to="/" />
            )
          }
        />
        <Route
          path="/contact-mapping"
          element={
            canReadContacts ? (
              <ContactMappingPage currentUser={currentUser} />
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

  if (isQuotationPrintRoute || isSellerLeagueTvStandaloneRoute) {
    return appRoutes;
  }

  return (
    <ChatbotContextProvider pathname={location.pathname}>
      <div className="app">
        <aside className="sidebar">
          <h1>NewPeople CRM</h1>
          <nav>
            <SidebarNavGroup title="General">
              <GuardedNavLink to="/" onBeforeNavigate={confirmRouteChange}>
                Inicio
              </GuardedNavLink>
              {canAccessAnyDashboard ? (
                <GuardedNavLink
                  to="/dashboards"
                  onBeforeNavigate={confirmRouteChange}
                >
                  Dashboards
                </GuardedNavLink>
              ) : null}
            </SidebarNavGroup>

            {(canReadAccounts ||
              canReadContacts ||
              canReadOpportunities ||
              canAccessInteractions ||
              canAccessQuotations ||
              canAccessManufacturerRegistrations) && (
              <SidebarNavGroup title="Comercial">
                {canReadAccounts && (
                  <GuardedNavLink
                    to="/accounts"
                    onBeforeNavigate={confirmRouteChange}
                  >
                    Cuentas
                  </GuardedNavLink>
                )}
                {canReadContacts && (
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
                    Leads
                  </GuardedNavLink>
                )}
                {canReadOpportunities && (
                  <GuardedNavLink
                    to="/opportunities"
                    end
                    onBeforeNavigate={confirmRouteChange}
                  >
                    Oportunidades
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
                {canAccessProposals && (
                  <GuardedNavLink
                    to="/proposals"
                    onBeforeNavigate={confirmRouteChange}
                  >
                    Propuestas
                  </GuardedNavLink>
                )}
              </SidebarNavGroup>
            )}

            {(canAccessCommercialDevelopment ||
              canAccessCommercialCalendar ||
              canAccessCommercialTracking ||
              canAccessCommercialRhythm ||
              canAccessCommercialPlanning ||
              canAccessCommercialEnablement ||
              canReadContacts) && (
              <SidebarNavGroup title="Desarrollo">
                {canAccessCommercialTracking ? (
                  <GuardedNavLink
                    to="/commercial-tracking"
                    onBeforeNavigate={confirmRouteChange}
                  >
                    Pipeline
                  </GuardedNavLink>
                ) : null}
                {canAccessCommercialRhythm ? (
                  <GuardedNavLink
                    to="/seller-league-tv"
                    onBeforeNavigate={confirmRouteChange}
                  >
                    Ritmo comercial
                  </GuardedNavLink>
                ) : null}
                {canAccessCommercialPlanning ? (
                  <GuardedNavLink
                    to="/commercial-planning"
                    onBeforeNavigate={confirmRouteChange}
                  >
                    Planeación Comercial
                  </GuardedNavLink>
                ) : null}
                {canAccessCommercialCalendar ? (
                  <GuardedNavLink
                    to="/calendar"
                    onBeforeNavigate={confirmRouteChange}
                  >
                    Calendario
                  </GuardedNavLink>
                ) : null}
                {canReadContacts ? (
                  <GuardedNavLink
                    to="/contact-mapping"
                    onBeforeNavigate={confirmRouteChange}
                  >
                    Mapeo de contactos
                  </GuardedNavLink>
                ) : null}
                {canAccessCommercialEnablement ? (
                  <GuardedNavLink
                    to="/commercial-enablement"
                    onBeforeNavigate={confirmRouteChange}
                  >
                    Biblioteca Comercial
                  </GuardedNavLink>
                ) : null}
              </SidebarNavGroup>
            )}

            {(canAccessCampaigns ||
              canAccessCampaignEmails ||
              canAccessLandingModule) && (
              <SidebarNavGroup title="Marketing">
                {canAccessCampaigns ? (
                  <GuardedNavLink
                    to="/campaigns"
                    onBeforeNavigate={confirmRouteChange}
                  >
                    Campañas
                  </GuardedNavLink>
                ) : null}
                {canAccessCampaignEmails ? (
                  <GuardedNavLink
                    to="/campaign-emails"
                    onBeforeNavigate={confirmRouteChange}
                  >
                    Correos
                  </GuardedNavLink>
                ) : null}
                {canAccessLandingModule ? (
                  <GuardedNavLink
                    to="/landing"
                    onBeforeNavigate={confirmRouteChange}
                  >
                    Landing
                  </GuardedNavLink>
                ) : null}
              </SidebarNavGroup>
            )}

            {(can("proveedores.read") ||
              (canAccessManufacturerRegistrations && canReadOpportunities)) && (
              <SidebarNavGroup title="Operacion comercial">
                {can("proveedores.read") && (
                  <GuardedNavLink
                    to="/providers"
                    onBeforeNavigate={confirmRouteChange}
                  >
                    Proveedores
                  </GuardedNavLink>
                )}
                {canAccessManufacturerRegistrations && canReadOpportunities ? (
                  <GuardedNavLink
                    to="/manufacturer-registrations"
                    onBeforeNavigate={confirmRouteChange}
                  >
                    Registros de fabricantes
                  </GuardedNavLink>
                ) : null}
              </SidebarNavGroup>
            )}

            {(can("usuarios.read") ||
              can("roles.read") ||
              canAccessProcessCommercialConfig ||
              can("configuracion.read") ||
              can("herramientas.read")) && (
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
                {canAccessProcessCommercialConfig && (
                  <GuardedNavLink
                    to="/opportunities/questions"
                    onBeforeNavigate={confirmRouteChange}
                  >
                    Configuración del proceso comercial
                  </GuardedNavLink>
                )}
                {can("configuracion.read") && (
                  <GuardedNavLink
                    to="/settings"
                    onBeforeNavigate={confirmRouteChange}
                  >
                    Configuración
                  </GuardedNavLink>
                )}
                {can("herramientas.read") && (
                  <GuardedNavLink
                    to="/tools"
                    onBeforeNavigate={confirmRouteChange}
                  >
                    Herramientas
                  </GuardedNavLink>
                )}
              </SidebarNavGroup>
            )}

            {can("audit.read") && (
              <SidebarNavGroup title="Control">
                <GuardedNavLink
                  to="/audit"
                  onBeforeNavigate={confirmRouteChange}
                >
                  Auditoría
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
          <div className="sidebar-version">
            Version {appVersion} · {appCommit}
          </div>
        </aside>
        <main className="content">
          <header className="topbar">
            <NavLink to="/account-settings" className="topbar-user">
              <UserAvatar
                src={currentUser.avatar_url}
                fullName={currentUser.full_name}
                size="lg"
              />
              <div className="topbar-user-meta">
                <div className="topbar-user-info">
                  <strong>{currentUser.full_name}</strong>
                  <p>{currentUser.email}</p>
                </div>
                {aiCreditSummary ? (
                  <div
                    className="topbar-ai-credit"
                    title="Porcentaje disponible de credito IA"
                  >
                    <div className="topbar-ai-credit-head">
                      <span>Credito IA</span>
                      <span>{aiCreditAvailablePercent}% disponible</span>
                    </div>
                    <div className="topbar-ai-credit-track" aria-hidden="true">
                      <span
                        className={`topbar-ai-credit-fill state-${aiCreditState}`}
                        style={{ width: `${aiCreditAvailablePercent}%` }}
                      />
                    </div>
                    <div className="topbar-ai-credit-foot">
                      <span>{aiCreditAvailablePercent}% disponible</span>
                    </div>
                  </div>
                ) : null}
              </div>
            </NavLink>
          </header>

          {appRoutes}
        </main>
        <HelpDrawer />
        <HelpTourCoach />
        <ChatbotWidget currentUser={currentUser} />
      </div>
    </ChatbotContextProvider>
  );
}
