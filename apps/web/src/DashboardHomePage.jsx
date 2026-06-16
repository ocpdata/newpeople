import { Link } from "react-router-dom";
import DashboardHubCard from "./DashboardHubCard";

export default function DashboardHomePage({
  canAccessCommercialTracking = false,
  canAccessCommercialPlanning = false,
  canAccessInteractions = false,
  canReadOpportunities = false,
  canReadAccounts = false,
  canReadContacts = false,
}) {
  const dashboardCards = [
    canAccessCommercialTracking
      ? {
          badge: "Dashboard",
          title: "Cuota mensual",
          description: "Meta, cierre esperado, riesgo y negocios clave del mes.",
          to: "/dashboards/cuota-mensual",
          cta: "Ver tablero",
          tone: "accent",
          meta: "Comercial",
        }
      : null,
    canAccessCommercialTracking
      ? {
          badge: "Analitica",
          title: "Pipeline comercial",
          description: "Seguimiento detallado del pipeline y forecast por etapa.",
          to: "/commercial-tracking",
          cta: "Abrir pipeline",
          tone: "default",
          meta: "Comercial",
        }
      : null,
    canAccessInteractions
      ? {
          badge: "Analitica",
          title: "Leads",
          description: "Vista de interacciones, calificacion y conversion comercial.",
          to: "/interactions",
          cta: "Abrir leads",
          tone: "default",
          meta: "Marketing",
        }
      : null,
    canAccessCommercialPlanning
      ? {
          badge: "Analitica",
          title: "Planeacion comercial",
          description: "Objetivos, capacidad y coordinacion del frente comercial.",
          to: "/commercial-planning",
          cta: "Abrir planeacion",
          tone: "default",
          meta: "Comercial",
        }
      : null,
  ].filter(Boolean);

  const quickAccessCards = [
    canReadOpportunities
      ? {
          badge: "Operacion",
          title: "Oportunidades",
          description: "Gestion diaria del pipeline y cambios de etapa.",
          to: "/opportunities",
          cta: "Ir a oportunidades",
          tone: "default",
        }
      : null,
    canReadAccounts
      ? {
          badge: "Operacion",
          title: "Cuentas",
          description: "Base comercial, relacion con clientes y contexto por cuenta.",
          to: "/accounts",
          cta: "Ir a cuentas",
          tone: "default",
        }
      : null,
    canReadContacts
      ? {
          badge: "Operacion",
          title: "Contactos",
          description: "Stakeholders, mapeo y seguimiento de relacion.",
          to: "/contacts",
          cta: "Ir a contactos",
          tone: "default",
        }
      : null,
  ].filter(Boolean);

  return (
    <section className="dashboard-home-page">
      <header className="panel dashboard-home-hero">
        <div>
          <span className="dashboard-home-kicker">Inicio</span>
          <h2>Resumen ejecutivo</h2>
          <p>
            Entrada principal para navegar entre dashboards especializados y modulos operativos.
          </p>
        </div>
        <div className="dashboard-home-actions">
          <Link className="primary-button" to="/dashboards">
            Ver dashboards
          </Link>
        </div>
      </header>

      <section className="panel dashboard-home-section">
        <div className="dashboard-home-section-header">
          <div>
            <h3>Dashboards disponibles</h3>
            <span>Vistas especializadas para leer el negocio</span>
          </div>
          <Link className="dashboard-home-inline-link" to="/dashboards">
            Ver catalogo completo
          </Link>
        </div>
        {dashboardCards.length ? (
          <div className="dashboard-hub-grid">
            {dashboardCards.map((card) => (
              <DashboardHubCard key={card.title} {...card} />
            ))}
          </div>
        ) : (
          <p className="dashboard-home-empty">
            No tienes dashboards disponibles con tus permisos actuales.
          </p>
        )}
      </section>

      <section className="panel dashboard-home-section">
        <div className="dashboard-home-section-header">
          <div>
            <h3>Accesos operativos</h3>
            <span>Entradas directas para trabajar el dia a dia</span>
          </div>
        </div>
        {quickAccessCards.length ? (
          <div className="dashboard-hub-grid is-compact">
            {quickAccessCards.map((card) => (
              <DashboardHubCard key={card.title} {...card} />
            ))}
          </div>
        ) : (
          <p className="dashboard-home-empty">
            No hay accesos operativos visibles con tus permisos actuales.
          </p>
        )}
      </section>
    </section>
  );
}
