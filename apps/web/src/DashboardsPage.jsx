import DashboardHubCard from "./DashboardHubCard";

export default function DashboardsPage({
  canAccessCommercialTracking = false,
  canAccessCommercialPlanning = false,
  canAccessInteractions = false,
  canAccessCommercialDevelopment = false,
}) {
  const availableCards = [
    canAccessCommercialTracking
      ? {
          badge: "Disponible ahora",
          title: "Cuota mensual",
          description: "Meta del mes, respaldo real, brecha y negocios clave para asegurar el cierre.",
          to: "/dashboards/cuota-mensual",
          cta: "Abrir dashboard",
          tone: "accent",
          meta: "Comercial",
        }
      : null,
    canAccessCommercialTracking
      ? {
          badge: "Disponible ahora",
          title: "Pipeline comercial",
          description: "Seguimiento detallado de etapas, forecast y movimiento del pipeline.",
          to: "/commercial-tracking",
          cta: "Abrir vista",
          tone: "default",
          meta: "Comercial",
        }
      : null,
    canAccessCommercialTracking
      ? {
          badge: "Disponible ahora",
          title: "Liga comercial trimestral TV",
          description: "Ranking competitivo diario por vendedor para mostrar en pantallas de equipo.",
          to: "/seller-league-tv",
          cta: "Abrir liga",
          tone: "accent",
          meta: "Comercial",
        }
      : null,
    canAccessInteractions
      ? {
          badge: "Disponible ahora",
          title: "Leads y conversion",
          description: "Interacciones, calificacion y oportunidades derivadas de leads.",
          to: "/interactions",
          cta: "Abrir vista",
          tone: "default",
          meta: "Marketing",
        }
      : null,
    canAccessCommercialPlanning
      ? {
          badge: "Disponible ahora",
          title: "Planeacion comercial",
          description: "Prioridades, objetivos y coordinacion de la ejecucion comercial.",
          to: "/commercial-planning",
          cta: "Abrir vista",
          tone: "default",
          meta: "Comercial",
        }
      : null,
    canAccessCommercialDevelopment
      ? {
          badge: "Disponible ahora",
          title: "Ejecucion comercial",
          description: "Operacion comercial, actividades y avance sobre oportunidades activas.",
          to: "/commercial-development",
          cta: "Abrir vista",
          tone: "default",
          meta: "Comercial",
        }
      : null,
  ].filter(Boolean);

  const upcomingCards = [
    {
      badge: "Siguiente paso",
      title: "Cuentas estrategicas",
      description: "Salud de cuentas clave, relacion, riesgo y potencial comercial.",
      tone: "muted",
      meta: "Proximo dashboard",
    },
    {
      badge: "Siguiente paso",
      title: "Cotizaciones",
      description: "Embudo de cotizaciones, tiempos de respuesta y tasa de aprobacion.",
      tone: "muted",
      meta: "Proximo dashboard",
    },
    {
      badge: "Siguiente paso",
      title: "Actividad comercial",
      description: "Carga de trabajo, seguimiento semanal y disciplina operativa del equipo.",
      tone: "muted",
      meta: "Proximo dashboard",
    },
  ];

  return (
    <section className="dashboard-home-page">
      <header className="panel dashboard-home-hero">
        <div>
          <span className="dashboard-home-kicker">Dashboards</span>
          <h2>Catalogo de tableros</h2>
          <p>
            Este espacio agrupa dashboards tematicos para crecer sin mezclar analitica con operacion.
          </p>
        </div>
      </header>

      <section className="panel dashboard-home-section">
        <div className="dashboard-home-section-header">
          <div>
            <h3>Disponibles hoy</h3>
            <span>Tableros y vistas listas para usar</span>
          </div>
        </div>
        {availableCards.length ? (
          <div className="dashboard-hub-grid">
            {availableCards.map((card) => (
              <DashboardHubCard key={card.title} {...card} />
            ))}
          </div>
        ) : (
          <p className="dashboard-home-empty">
            No hay dashboards habilitados con tus permisos actuales.
          </p>
        )}
      </section>

      <section className="panel dashboard-home-section">
        <div className="dashboard-home-section-header">
          <div>
            <h3>Proximos dashboards</h3>
            <span>Espacios reservados para el crecimiento del sistema</span>
          </div>
        </div>
        <div className="dashboard-hub-grid is-compact">
          {upcomingCards.map((card) => (
            <DashboardHubCard key={card.title} {...card} />
          ))}
        </div>
      </section>
    </section>
  );
}
