export default function ContactOpportunitiesModal({
  contact,
  loading,
  opportunities,
  visibleOpportunities,
  statusFilter,
  yearFilter,
  availableYears,
  onClose,
  onStatusFilterChange,
  onYearFilterChange,
  onOpportunitySelect,
  getOpportunityStatusBadgeClass,
}) {
  if (!contact) {
    return null;
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Oportunidades de ${contact.full_name}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal-dialog modal-dialog-wide modal-dialog-account-opps">
        <div className="modal-header">
          <h3 className="modal-title">
            Oportunidades &mdash; <span style={{ fontWeight: 400 }}>{contact.full_name}</span>
          </h3>
        </div>

        {!loading && opportunities.length > 0 && (
          <div className="account-opps-filters">
            <div
              className="account-opps-pills"
              role="group"
              aria-label="Filtrar por estado"
            >
              {[
                "activada",
                "pendiente de activacion",
                "desactivada",
                "all",
              ].map((status) => (
                <button
                  key={status}
                  type="button"
                  className={`account-opps-pill account-opps-pill--${
                    status === "all"
                      ? "all"
                      : status === "activada"
                        ? "active"
                        : status === "pendiente de activacion"
                          ? "pending"
                          : "inactive"
                  }${statusFilter === status ? " is-active" : ""}`}
                  onClick={() => onStatusFilterChange(status)}
                >
                  {status === "all"
                    ? "Todas"
                    : status === "activada"
                      ? "Activadas"
                      : status === "pendiente de activacion"
                        ? "Pendientes"
                        : "Desactivadas"}
                </button>
              ))}
            </div>
            {availableYears.length > 0 && (
              <select
                className="account-opps-year-select"
                value={yearFilter}
                onChange={(event) => onYearFilterChange(event.target.value)}
                aria-label="Filtrar por año de cierre"
              >
                <option value="all">Todos los años</option>
                {availableYears.map((year) => (
                  <option key={year} value={String(year)}>
                    {year}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {loading ? (
          <p className="account-opps-empty">Cargando oportunidades...</p>
        ) : opportunities.length === 0 ? (
          <p className="account-opps-empty">
            No hay oportunidades registradas para este contacto.
          </p>
        ) : visibleOpportunities.length === 0 ? (
          <p className="account-opps-empty">
            Sin resultados para el filtro seleccionado.
          </p>
        ) : (
          <div className="account-opps-list">
            {visibleOpportunities.map((opportunity) => (
              <div
                key={opportunity.id}
                className="account-opp-row account-opp-row--clickable"
                role="button"
                tabIndex={0}
                onClick={() => onOpportunitySelect(opportunity.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    onOpportunitySelect(opportunity.id);
                  }
                }}
              >
                <div className="account-opp-main">
                  <span className="account-opp-name">{opportunity.name}</span>
                  <span className={getOpportunityStatusBadgeClass(opportunity)}>
                    {opportunity.activation_status || "-"}
                  </span>
                </div>
                <div className="account-opp-meta">
                  <span>{opportunity.account_name}</span>
                  <span>{opportunity.sales_stage}</span>
                  <span>{opportunity.business_line}</span>
                  <span>
                    {Number(opportunity.amount_usd).toLocaleString("es-MX", {
                      style: "currency",
                      currency: "USD",
                      minimumFractionDigits: 0,
                    })}
                  </span>
                  <span>
                    Cierre:{" "}
                    {opportunity.close_date
                      ? new Date(opportunity.close_date).toLocaleDateString(
                          "es-MX",
                        )
                      : "—"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="modal-buttons" style={{ marginTop: 16 }}>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}