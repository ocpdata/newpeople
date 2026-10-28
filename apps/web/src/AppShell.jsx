import { Children, Suspense, lazy, useEffect, useMemo, useState } from "react";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  matchPath,
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
const DocumentationPage = lazy(() => import("./DocumentationPage"));
const DocumentacionRagPage = lazy(() => import("./DocumentacionRagPage"));
const AccountSettingsPage = lazy(() => import("./AccountSettingsPage"));
const ToolsPage = lazy(() => import("./ToolsPage"));
const SecurityTestsPage = lazy(() => import("./SecurityTestsPage"));
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
const MiAgentPage = lazy(() => import("./MiAgentPage"));
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
const ProposalDocumentsPage = lazy(() => import("./ProposalDocumentsPage"));
const LandingModulePage = lazy(() => import("./LandingModulePage"));
const CampaignsPage = lazy(() => import("./CampaignsPage"));
const CampaignEmailModulePage = lazy(() => import("./CampaignEmailModulePage"));
const AcceptOrderPage = lazy(() => import("./AcceptOrderPage"));
const InvoicingPage = lazy(() => import("./InvoicingPage"));
const ProviderInvoiceReceptionPage = lazy(
  () => import("./ProviderInvoiceReceptionPage"),
);

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

function SidebarNavGroup({ title, children, userId }) {
  const { pathname } = useLocation();
  const links = Children.toArray(children);
  const isActive = links.some((link) => link.props?.to && matchPath({
    path: link.props.to,
    end: link.props.end ?? link.props.to === "/",
  }, pathname));
  const storageKey = `crm_sidebar:${userId}:${title}`;
  const [expanded, setExpanded] = useState(() => {
    try {
      return isActive || window.localStorage.getItem(storageKey) !== "false";
    } catch (error) {
      console.warn("No fue posible leer la preferencia del menú lateral", error);
      return true;
    }
  });
  if (!links.length) return null;

  function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    try {
      window.localStorage.setItem(storageKey, String(next));
    } catch (error) {
      console.warn("No fue posible guardar la preferencia del menú lateral", error);
    }
  }

  return (
    <div className="sidebar-nav-group">
      <button
        type="button"
        className="sidebar-nav-group-title"
        aria-expanded={expanded}
        aria-controls={`sidebar-${encodeURIComponent(title)}`}
        onClick={toggleExpanded}
      >
        <span>{title}</span>
        <span aria-hidden="true">{expanded ? "−" : "+"}</span>
      </button>
      <div id={`sidebar-${encodeURIComponent(title)}`} className="sidebar-nav-group-links" hidden={!expanded}>
        {children}
      </div>
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

  const canReadAiServices = can("ia.budget.read_all") || can("configuracion.read");
  const canManageAiServices = can("ia.budget.manage") || can("configuracion.update");
  const [aiServiceAlerts, setAiServiceAlerts] = useState([]);

  useEffect(() => {
    if (!canReadAiServices) return undefined;
    let mounted = true;
    async function fetchAiServiceAlerts() {
      try {
        const { data } = await api.get("/api/ai/services/alerts");
        if (mounted) setAiServiceAlerts(Array.isArray(data?.items) ? data.items : []);
      } catch {
        if (mounted) setAiServiceAlerts([]);
      }
    }
    fetchAiServiceAlerts();
    const interval = setInterval(fetchAiServiceAlerts, 10 * 60 * 1000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [canReadAiServices, currentUser?.id]);

  async function acknowledgeAiServiceAlert(alertId) {
    try {
      await api.post(`/api/ai/services/alerts/${alertId}/acknowledge`);
    } catch {
      // The alert stays visible and will be refreshed on the next poll.
      return;
    }
    setAiServiceAlerts((current) => current.filter((alert) => alert.id !== alertId));
  }

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
  const canAccessAcceptOrder = [
    "cotizaciones.administracion",
    "aceptar_pedido.procesamiento.read",
    "aceptar_pedido.procesamiento.update",
    "aceptar_pedido.procesamiento.ia",
    "aceptar_pedido.procesamiento.convocar",
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
  const canAccessCustomerChat =
    can("inteligencia_comercial.access") &&
    can("inteligencia_comercial.read") &&
    canReadAccounts;
  const canAccessProspectChat =
    can("prospeccion.access") &&
    (can("prospeccion.read") || can("prospeccion.create"));
  const canAccessMiAgent = can("mi_coach.access");
  const canAccessCommercialTracking =
    can("seguimiento_comercial.read") && canReadOpportunities;
  const canAccessCommercialRhythm = can("ritmo_comercial.read");
  const canAccessCommercialRhythmAll = can("ritmo_comercial.read_all");
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
  const canAccessDocumentacionRag =
    can("documentacion_rag.access") || can("documentacion_rag.manage");
  const canManageDocumentacionRag = can("documentacion_rag.manage");
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
              <ConfigurationPage can={can} />
            ) : (
              <Navigate to="/" />
            )
          }
        />
        <Route
          path="/documentation"
          element={
            can("configuracion.read") ? (
              <DocumentationPage />
            ) : (
              <Navigate to="/" />
            )
          }
        />
        <Route
          path="/documentation/:docId"
          element={
            can("configuracion.read") ? (
              <DocumentationPage />
            ) : (
              <Navigate to="/" />
            )
          }
        />
        <Route
          path="/documentacion-rag"
          element={
            canAccessDocumentacionRag ? (
              <DocumentacionRagPage
                canManage={canManageDocumentacionRag}
              />
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
          path="/security-tests"
          element={
            can("pruebas.read") ? <SecurityTestsPage /> : <Navigate to="/" />
          }
        />
        <Route
          path="/tools/security-tests"
          element={<Navigate to="/security-tests" replace />}
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
          path="/mi-agent"
          element={
            canAccessMiAgent ? (
              <MiAgentPage
                currentUser={currentUser}
                canUseCoach={can("mi_coach.use")}
                canExecuteCoach={can("mi_coach.execute")}
                canCreateActions={can("oportunidades.update")}
                canUpdateLeads={can("interacciones.update")}
                canReadLeads={
                  can("interacciones.read") || can("interacciones.read_all")
                }
                canCreateLeads={can("interacciones.update")}
                canUpdateAccounts={can("cuentas.update")}
                canUpdateContacts={can("contactos.update")}
                canCreateAccounts={
                  can("cuentas.create") || can("cuentas.request")
                }
                canCreateContacts={
                  can("contactos.create") || can("contactos.request")
                }
                canResolveLeads={can("interacciones.resolve")}
                canCreateOpportunities={
                  can("oportunidades.create") || can("oportunidades.request")
                }
                canUpdateCommercialDevelopment={can(
                  "desarrollo_comercial.update",
                )}
                canUpdateCalendar={
                  canAccessCommercialCalendar &&
                  can("calendario_comercial.update")
                }
                canCreateQuotations={[
                  "cotizaciones.operacion",
                  "cotizaciones.ingreso",
                  "cotizaciones.administracion",
                ].some(can)}
                canCreateProposals={can("propuestas.create")}
                canUseExternalSources={can("fuentes_externas.execute")}
                canReadProspecting={can("prospeccion.read")}
                canCreateProspecting={can("prospeccion.create")}
                canUpdateProspecting={can("prospeccion.update")}
                canAccessProspectChat={canAccessProspectChat}
                canReadCustomerIntelligence={
                  can("inteligencia_comercial.read") && canReadAccounts
                }
                canAccessCustomerChat={canAccessCustomerChat}
                canManageCoach={can("mi_coach.admin")}
                canReadEvaluations={can("mi_coach.evaluations_read")}
                canExecuteEvaluations={can("mi_coach.evaluations_execute")}
                canWriteEvaluations={can("mi_coach.evaluations_write")}
                canDiagnoseCustomerChats={can(
                  "mi_coach.chat_diagnostics",
                )}
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
              <SellerLeagueTvPage showPageControls />
            ) : (
              <Navigate to="/" />
            )
          }
        />
        <Route
          path="/seller-league-tv/sellers/:sellerUserId"
          element={
            canAccessCommercialRhythm ? (
              <SellerLeagueTvPage showPageControls detailMode />
            ) : (
              <Navigate to="/" />
            )
          }
        />
        <Route
          path="/seller-league-tv/window"
          element={
            canAccessCommercialRhythm && canAccessCommercialRhythmAll ? (
              <SellerLeagueTvPage showPageControls={false} />
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
          path="/proposals-new"
          element={
            canAccessProposals ? <ProposalDocumentsPage /> : <Navigate to="/" />
          }
        />
        <Route
          path="/accept-order"
          element={
            canAccessAcceptOrder ? <AcceptOrderPage /> : <Navigate to="/" />
          }
        />
        <Route
          path="/invoicing"
          element={
            canAccessAcceptOrder ? <InvoicingPage /> : <Navigate to="/" />
          }
        />
        <Route
          path="/provider-invoice-reception"
          element={
            canAccessAcceptOrder ? (
              <ProviderInvoiceReceptionPage />
            ) : (
              <Navigate to="/" />
            )
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
            <SidebarNavGroup title="Inicio" userId={currentUser.id} key={`inicio:${location.pathname}`}>
              <GuardedNavLink to="/" onBeforeNavigate={confirmRouteChange}>
                Inicio
              </GuardedNavLink>
              {canAccessAnyDashboard ? (
                <GuardedNavLink
                  to="/dashboards"
                  onBeforeNavigate={confirmRouteChange}
                >
                  Indicadores
                </GuardedNavLink>
              ) : null}
              {canAccessCommercialCalendar && (
                <GuardedNavLink to="/calendar" onBeforeNavigate={confirmRouteChange}>
                  Agenda
                </GuardedNavLink>
              )}
              {canAccessMiAgent && (
                <GuardedNavLink to="/mi-agent" onBeforeNavigate={confirmRouteChange}>
                  Mi coach
                </GuardedNavLink>
              )}
            </SidebarNavGroup>

            {(canReadAccounts ||
              canReadContacts ||
              canReadOpportunities ||
              canAccessInteractions ||
              canAccessQuotations ||
              canAccessProposals ||
              (canAccessManufacturerRegistrations && canReadOpportunities)) && (
              <SidebarNavGroup title="Ventas" userId={currentUser.id} key={`ventas:${location.pathname}`}>
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
                {canReadContacts && (
                  <GuardedNavLink to="/contact-mapping" onBeforeNavigate={confirmRouteChange}>
                    Mapa de relaciones
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
                    to="/proposals-new"
                    onBeforeNavigate={confirmRouteChange}
                  >
                    Propuestas
                  </GuardedNavLink>
                )}
                {canAccessManufacturerRegistrations && canReadOpportunities && (
                  <GuardedNavLink to="/manufacturer-registrations" onBeforeNavigate={confirmRouteChange}>
                    Registros con fabricantes
                  </GuardedNavLink>
                )}
              </SidebarNavGroup>
            )}

            {(canAccessCommercialTracking ||
              canAccessCommercialRhythm ||
              canAccessCommercialPlanning ||
              canAccessCommercialEnablement) && (
              <SidebarNavGroup title="Gestión de ventas" userId={currentUser.id} key={`gestion:${location.pathname}`}>
                {canAccessCommercialTracking ? (
                  <GuardedNavLink
                    to="/commercial-tracking"
                    onBeforeNavigate={confirmRouteChange}
                  >
                    Embudo de ventas
                  </GuardedNavLink>
                ) : null}
                {canAccessCommercialPlanning ? (
                  <GuardedNavLink
                    to="/commercial-planning"
                    onBeforeNavigate={confirmRouteChange}
                  >
                    Metas y comisiones
                  </GuardedNavLink>
                ) : null}
                {canAccessCommercialRhythm ? (
                  <GuardedNavLink
                    to="/seller-league-tv"
                    onBeforeNavigate={confirmRouteChange}
                  >
                    Ritmo de ventas
                  </GuardedNavLink>
                ) : null}
                {canAccessCommercialEnablement ? (
                  <GuardedNavLink
                    to="/commercial-enablement"
                    onBeforeNavigate={confirmRouteChange}
                  >
                    Biblioteca de ventas
                  </GuardedNavLink>
                ) : null}
              </SidebarNavGroup>
            )}

            {(canAccessCampaigns ||
              canAccessCampaignEmails ||
              canAccessLandingModule) && (
              <SidebarNavGroup title="Marketing" userId={currentUser.id} key={`marketing:${location.pathname}`}>
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
                    Correo de campañas
                  </GuardedNavLink>
                ) : null}
                {canAccessLandingModule ? (
                  <GuardedNavLink
                    to="/landing"
                    onBeforeNavigate={confirmRouteChange}
                  >
                    Páginas de captación
                  </GuardedNavLink>
                ) : null}
              </SidebarNavGroup>
            )}

            {(canAccessAcceptOrder || can("proveedores.read")) && (
              <SidebarNavGroup title="Operaciones" userId={currentUser.id} key={`operaciones:${location.pathname}`}>
                {canAccessAcceptOrder && (
                <GuardedNavLink
                  to="/accept-order"
                  onBeforeNavigate={confirmRouteChange}
                >
                  Aceptación de pedidos
                </GuardedNavLink>
                )}
                {canAccessAcceptOrder && (
                <GuardedNavLink
                  to="/invoicing"
                  onBeforeNavigate={confirmRouteChange}
                >
                  Facturación a clientes
                </GuardedNavLink>
                )}
                {canAccessAcceptOrder && (
                <GuardedNavLink
                  to="/provider-invoice-reception"
                  onBeforeNavigate={confirmRouteChange}
                >
                  Facturas de proveedores
                </GuardedNavLink>
                )}
                {can("proveedores.read") && (
                  <GuardedNavLink to="/providers" onBeforeNavigate={confirmRouteChange}>
                    Proveedores
                  </GuardedNavLink>
                )}
              </SidebarNavGroup>
            )}

            {(can("usuarios.read") ||
              can("roles.read") ||
              canAccessProcessCommercialConfig ||
              canAccessDocumentacionRag ||
              can("configuracion.read") ||
              can("herramientas.read") ||
              can("pruebas.read") ||
              can("audit.read")) && (
              <SidebarNavGroup title="Administración" userId={currentUser.id} key={`administracion:${location.pathname}`}>
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
                    Roles y permisos
                  </GuardedNavLink>
                )}
                {canAccessProcessCommercialConfig && (
                  <GuardedNavLink
                    to="/opportunities/questions"
                    onBeforeNavigate={confirmRouteChange}
                  >
                    Proceso de ventas
                  </GuardedNavLink>
                )}
                {can("configuracion.read") && (
                  <GuardedNavLink
                    to="/settings"
                    onBeforeNavigate={confirmRouteChange}
                  >
                    Configuración general
                  </GuardedNavLink>
                )}
                {canAccessDocumentacionRag && (
                  <GuardedNavLink
                    to="/documentacion-rag"
                    onBeforeNavigate={confirmRouteChange}
                  >
                    Base de conocimiento IA
                  </GuardedNavLink>
                )}
                {can("configuracion.read") && (
                  <GuardedNavLink
                    to="/documentation"
                    onBeforeNavigate={confirmRouteChange}
                  >
                    Documentación del sistema
                  </GuardedNavLink>
                )}
                {can("herramientas.read") && (
                  <GuardedNavLink
                    to="/tools"
                    onBeforeNavigate={confirmRouteChange}
                  >
                    Herramientas del sistema
                  </GuardedNavLink>
                )}
                {can("pruebas.read") && (
                  <GuardedNavLink
                    to="/security-tests"
                    onBeforeNavigate={confirmRouteChange}
                  >
                    Pruebas de seguridad
                  </GuardedNavLink>
                )}
                {can("audit.read") && (
                  <GuardedNavLink
                    to="/audit"
                    onBeforeNavigate={confirmRouteChange}
                  >
                    Auditoría
                  </GuardedNavLink>
                )}
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
            Cerrar sesión
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
                {aiCreditSummary?.limited ? (
                  <div
                    className="topbar-ai-credit"
                    title={
                      aiCreditSummary.source === "reserve"
                        ? "Porcentaje disponible de la reserva compartida de crédito IA"
                        : "Porcentaje disponible de tu asignación de crédito IA"
                    }
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

          {canReadAiServices && aiServiceAlerts.length ? (
            <div className="ai-service-alert-banner" role="status">
              {aiServiceAlerts.slice(0, 3).map((alert) => (
                <div
                  key={alert.id}
                  className={`ai-service-alert-banner-item level-${alert.level}`}
                >
                  <span>{alert.message}</span>
                  <NavLink to="/settings?section=ai_budget">Ver</NavLink>
                  {canManageAiServices ? (
                    <button
                      type="button"
                      onClick={() => acknowledgeAiServiceAlert(alert.id)}
                    >
                      Entendido
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {appRoutes}
        </main>
        <HelpDrawer />
        <HelpTourCoach />
        <ChatbotWidget currentUser={currentUser} />
      </div>
    </ChatbotContextProvider>
  );
}
