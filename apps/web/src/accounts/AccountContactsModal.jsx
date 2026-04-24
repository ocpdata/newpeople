function AccountContactsModal({
  account,
  loading,
  contacts,
  statusFilter,
  setStatusFilter,
  onClose,
  onContactSelect,
  getContactStatusBadgeClass,
}) {
  if (!account) return null;

  const visibleContacts =
    statusFilter === "all"
      ? contacts
      : contacts.filter(
          (contact) =>
            String(contact.activation_status || "")
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .trim() === statusFilter,
        );

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Contactos de ${account.name}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-dialog modal-dialog-wide modal-dialog-account-opps">
        <div className="modal-header">
          <h3 className="modal-title">
            Contactos - <span style={{ fontWeight: 400 }}>{account.name}</span>
          </h3>
        </div>

        {!loading && contacts.length > 0 && (
          <div className="account-opps-filters">
            <div
              className="account-opps-pills"
              role="group"
              aria-label="Filtrar por estado"
            >
              {[
                "activado",
                "pendiente de activacion",
                "desactivado",
                "all",
              ].map((status) => (
                <button
                  key={status}
                  type="button"
                  className={`account-opps-pill account-opps-pill--${
                    status === "all"
                      ? "all"
                      : status === "activado"
                        ? "active"
                        : status === "pendiente de activacion"
                          ? "pending"
                          : "inactive"
                  }${statusFilter === status ? " is-active" : ""}`}
                  onClick={() => setStatusFilter(status)}
                >
                  {status === "all"
                    ? "Todas"
                    : status === "activado"
                      ? "Activados"
                      : status === "pendiente de activacion"
                        ? "Pendientes"
                        : "Desactivados"}
                </button>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <p className="account-opps-empty">Cargando contactos...</p>
        ) : contacts.length === 0 ? (
          <p className="account-opps-empty">
            No hay contactos registrados para esta cuenta.
          </p>
        ) : visibleContacts.length === 0 ? (
          <p className="account-opps-empty">
            Sin resultados para el filtro seleccionado.
          </p>
        ) : (
          <div className="account-opps-list">
            {visibleContacts.map((contact) => (
              <div
                key={contact.id}
                className="account-opp-row account-opp-row--clickable"
                role="button"
                tabIndex={0}
                onClick={() => onContactSelect(contact.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    onContactSelect(contact.id);
                  }
                }}
              >
                <div className="account-opp-main">
                  <span className="account-opp-name">{contact.full_name}</span>
                  <span className={getContactStatusBadgeClass(contact)}>
                    {contact.activation_status || "-"}
                  </span>
                </div>
                <div className="account-opp-meta">
                  <span>{contact.position_title || "-"}</span>
                  <span>{contact.relationship_type || "-"}</span>
                  {contact.email && <span>{contact.email}</span>}
                  {contact.phone && <span>{contact.phone}</span>}
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

export default AccountContactsModal;