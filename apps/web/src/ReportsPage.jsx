import DashboardHubCard from "./DashboardHubCard";

export default function ReportsPage({ canReadReport }) {
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
          {canReadReport ? (
            <div className="dashboard-hub-grid">
              <DashboardHubCard
                title="Oportunidades y cotizaciones"
                description="Identifica oportunidades ganadas, cotizaciones aceptadas y sus combinaciones."
                to="/reports/opportunities-quotations"
                cta="Abrir reporte"
                meta="Comercial"
              />
            </div>
          ) : (
            <p>No hay reportes disponibles con tus permisos actuales. Este reporte requiere consultar oportunidades y cotizaciones.</p>
          )}
        </div>
      </section>
    </section>
  );
}
