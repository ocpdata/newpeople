function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function isQuotationInactive(quotation) {
  const status = normalizeText(
    quotation.latestStatusLabel ||
      quotation.latest_status_label ||
      quotation.latestStatusCode ||
      quotation.latest_status_code ||
      quotation.status ||
      quotation.status_code,
  );
  return status === "inactive" || status.includes("desactiv");
}

function getQuotationStatusLabel(quotation) {
  return (
    quotation.latestStatusLabel ||
    quotation.latest_status_label ||
    quotation.statusLabel ||
    quotation.status_label ||
    quotation.latestStatusCode ||
    quotation.latest_status_code ||
    quotation.status ||
    quotation.status_code ||
    "Activa"
  );
}

function AccountQuotationsModal({
  account,
  loading,
  quotations,
  statusFilter,
  setStatusFilter,
  onClose,
  onQuotationSelect,
  getQuotationStatusBadgeClass,
}) {
  if (!account) return null;

  const selectedAccountId = Number(account.id || 0);
  const accountScopedQuotations = (quotations || []).filter((quotation) => {
    const quotationAccountId = Number(
      quotation?.accountId ?? quotation?.account_id ?? 0,
    );
    if (!quotationAccountId) {
      return true;
    }
    return quotationAccountId === selectedAccountId;
  });

  const visibleQuotations =
    statusFilter === "all"
      ? accountScopedQuotations
      : accountScopedQuotations.filter((quotation) => {
          const inactive = isQuotationInactive(quotation);
          return statusFilter === "inactive" ? inactive : !inactive;
        });

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Cotizaciones de ${account.name}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-dialog modal-dialog-wide modal-dialog-account-opps">
        <div className="modal-header">
          <h3 className="modal-title">
            Cotizaciones -{" "}
            <span style={{ fontWeight: 400 }}>{account.name}</span>
          </h3>
        </div>

        {!loading && accountScopedQuotations.length > 0 && (
          <div className="account-opps-filters">
            <div
              className="account-opps-pills"
              role="group"
              aria-label="Filtrar por estado"
            >
              {[
                { value: "active", label: "Activas", tone: "active" },
                { value: "inactive", label: "Desactivadas", tone: "inactive" },
                { value: "all", label: "Todas", tone: "all" },
              ].map((status) => (
                <button
                  key={status.value}
                  type="button"
                  className={`account-opps-pill account-opps-pill--${status.tone}${
                    statusFilter === status.value ? " is-active" : ""
                  }`}
                  onClick={() => setStatusFilter(status.value)}
                >
                  {status.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <p className="account-opps-empty">Cargando cotizaciones...</p>
        ) : accountScopedQuotations.length === 0 ? (
          <p className="account-opps-empty">
            No hay cotizaciones registradas para esta cuenta.
          </p>
        ) : visibleQuotations.length === 0 ? (
          <p className="account-opps-empty">
            Sin resultados para el filtro seleccionado.
          </p>
        ) : (
          <div className="account-opps-list">
            {visibleQuotations.map((quotation) => (
              <div
                key={quotation.id}
                className="account-opp-row account-opp-row--clickable"
                role="button"
                tabIndex={0}
                onClick={() => onQuotationSelect(quotation)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    onQuotationSelect(quotation);
                  }
                }}
              >
                <div className="account-opp-main">
                  <span className="account-opp-name">
                    Cotización #{quotation.id || "-"}
                  </span>
                  <span className={getQuotationStatusBadgeClass(quotation)}>
                    {getQuotationStatusLabel(quotation)}
                  </span>
                </div>
                <div className="account-opp-meta">
                  <span>Versión {quotation.version || "-"}</span>
                  <span>
                    {quotation.opportunityName ||
                      quotation.opportunity_name ||
                      "Sin oportunidad"}
                  </span>
                  <span>
                    {Number(
                      quotation.totalAmount || quotation.total_amount || 0,
                    ).toLocaleString("es-MX", {
                      style: "currency",
                      currency:
                        quotation.currencyCode ||
                        quotation.currency_code ||
                        "USD",
                      minimumFractionDigits: 0,
                    })}
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

export default AccountQuotationsModal;
