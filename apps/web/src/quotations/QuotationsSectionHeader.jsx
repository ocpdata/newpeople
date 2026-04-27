function QuotationsSectionHeader({
  showHeader,
  showCreateButton,
  canCreateQuotation,
  isOpportunityActive,
  busyAction,
  openCreateQuotationModal,
}) {
  if (!showHeader) {
    return null;
  }

  return (
    <div className="opportunity-commercial-section-header opportunity-quotations-header">
      <div>
        <h4>Cotizaciones</h4>
        <p className="field-hint opportunity-commercial-hint">
          Gestiona versiones, secciones, items y acciones del workflow de la
          cotizacion.
        </p>
      </div>
      <div className="opportunity-quotations-toolbar">
        {showCreateButton && canCreateQuotation ? (
          <button
            type="button"
            className="btn-secondary"
            disabled={!isOpportunityActive || busyAction === "create-quotation"}
            onClick={openCreateQuotationModal}
          >
            + Crear cotizacion
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default QuotationsSectionHeader;
