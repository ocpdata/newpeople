import DashboardHubCard from "./DashboardHubCard";

export default function ReportsPage({ canAccess, canReadOpportunitiesQuotations, canReadProfitability }) {
  return (
    <section className="dashboard-home-page">
      <header className="panel dashboard-home-hero">
        <div>
          <span className="dashboard-home-kicker">Inicio</span>
          <h2>Reportes</h2>
          <p>Consulta los reportes disponibles para tus permisos.</p>
        </div>
      </header>

      <section className="panel dashboard-home-section">
        <div className="dashboard-home-section-header">
          <div>
            <h3>Reportes disponibles</h3>
          </div>
          {!canAccess ? <p role="alert">No tienes permiso para acceder a Reportes.</p> : canReadOpportunitiesQuotations || canReadProfitability ? (
            <div className="dashboard-hub-grid">
              {canReadProfitability && <DashboardHubCard
                title="Rentabilidad de oportunidades ganadas"
                description="Consulta venta, costos y margen de las cotizaciones ganadas y aceptadas, consolidados por oportunidad."
                to="/reports/opportunity-profitability"
                cta="Abrir reporte"
                meta="Comercial · USD"
              />}
              {canReadOpportunitiesQuotations && <DashboardHubCard
                title="Oportunidades y cotizaciones"
                description="Identifica oportunidades ganadas, cotizaciones aceptadas y sus combinaciones."
                to="/reports/opportunities-quotations"
                cta="Abrir reporte"
                meta="Comercial"
              />}
            </div>
          ) : (
            <p>No tienes reportes habilitados.</p>
          )}
        </div>
      </section>
    </section>
  );
}
