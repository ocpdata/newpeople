function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function getProposalStatusCode(proposal) {
  return normalizeText(proposal.statusCode || proposal.status_code || "active");
}

function isProposalInactive(proposal) {
  return getProposalStatusCode(proposal) === "archived";
}

function getProposalStatusLabel(proposal) {
  const statusCode = getProposalStatusCode(proposal);
  if (statusCode === "archived") return "Desactivada";
  return "Activa";
}

function AccountProposalsModal({
  account,
  loading,
  proposals,
  statusFilter,
  setStatusFilter,
  onClose,
  onProposalSelect,
  getProposalStatusBadgeClass,
}) {
  if (!account) return null;

  const selectedAccountId = Number(account.id || 0);
  const accountScopedProposals = (proposals || []).filter((proposal) => {
    const proposalAccountId = Number(
      proposal?.accountId ?? proposal?.account_id ?? 0,
    );
    if (!proposalAccountId) return true;
    return proposalAccountId === selectedAccountId;
  });

  const visibleProposals =
    statusFilter === "all"
      ? accountScopedProposals
      : accountScopedProposals.filter((proposal) => {
          const inactive = isProposalInactive(proposal);
          return statusFilter === "inactive" ? inactive : !inactive;
        });

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Propuestas de ${account.name}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-dialog modal-dialog-wide modal-dialog-account-opps">
        <div className="modal-header">
          <h3 className="modal-title">
            Propuestas - <span style={{ fontWeight: 400 }}>{account.name}</span>
          </h3>
        </div>

        {!loading && accountScopedProposals.length > 0 && (
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
          <p className="account-opps-empty">Cargando propuestas...</p>
        ) : accountScopedProposals.length === 0 ? (
          <p className="account-opps-empty">
            No hay propuestas registradas para esta cuenta.
          </p>
        ) : visibleProposals.length === 0 ? (
          <p className="account-opps-empty">
            Sin resultados para el filtro seleccionado.
          </p>
        ) : (
          <div className="account-opps-list">
            {visibleProposals.map((proposal) => (
              <div
                key={proposal.id}
                className="account-opp-row account-opp-row--clickable"
                role="button"
                tabIndex={0}
                onClick={() => onProposalSelect(proposal.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    onProposalSelect(proposal.id);
                  }
                }}
              >
                <div className="account-opp-main">
                  <span className="account-opp-name">
                    {proposal.title || `Propuesta #${proposal.id || "-"}`}
                  </span>
                  <span className={getProposalStatusBadgeClass(proposal)}>
                    {getProposalStatusLabel(proposal)}
                  </span>
                </div>
                <div className="account-opp-meta">
                  <span>{proposal.templateName || "Sin plantilla"}</span>
                  <span>
                    Cotización #
                    {proposal.quotationId || proposal.quotation_id || "-"}
                  </span>
                  <span>
                    {proposal.updatedAt || proposal.updated_at
                      ? new Date(
                          proposal.updatedAt || proposal.updated_at,
                        ).toLocaleDateString("es-MX")
                      : "Sin fecha"}
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

export default AccountProposalsModal;
