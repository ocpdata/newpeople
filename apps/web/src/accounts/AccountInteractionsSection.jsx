function formatInteractionDate(value) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return date.toLocaleString("es-MX");
}

function getInteractionResultBadgeClass(code) {
  const normalized = String(code || "").trim();
  if (normalized === "converted_to_opportunity") {
    return "account-interaction-badge is-positive";
  }
  if (normalized === "not_interested_for_now") {
    return "account-interaction-badge is-muted";
  }
  if (normalized === "follow_up_required" || normalized === "future_interest") {
    return "account-interaction-badge is-warning";
  }
  return "account-interaction-badge";
}

function AccountInteractionsSection({
  accountInteractions,
  visibleAccountInteractions,
  interactionTypes,
  interactionResults,
  interactionTypeFilter,
  setInteractionTypeFilter,
  interactionResultFilter,
  setInteractionResultFilter,
  interactionQuery,
  setInteractionQuery,
  loadingAccountInteractions,
  onCreateInteraction,
  onEditInteraction,
  onOpenOpportunity,
  error,
  success,
}) {
  return (
    <section className="account-form-section account-modal-section account-interactions-section">
      <div className="account-interactions-header-row">
        <div>
          <h4>Interacciones comerciales</h4>
          <p className="field-hint">
            Registra reuniones, demos, seguimientos y evidencia comercial sin
            crear oportunidades ficticias.
          </p>
        </div>
        <button
          type="button"
          className="account-interactions-create-button"
          onClick={onCreateInteraction}
          aria-label="Registrar interacción"
          title="Registrar interacción"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 5.25a.75.75 0 0 1 .75.75v5.25H18a.75.75 0 0 1 0 1.5h-5.25V18a.75.75 0 0 1-1.5 0v-5.25H6a.75.75 0 0 1 0-1.5h5.25V6a.75.75 0 0 1 .75-.75Z" />
          </svg>
        </button>
      </div>

      <div className="account-interactions-filters">
        <input
          value={interactionQuery}
          onChange={(event) => setInteractionQuery(event.target.value)}
          placeholder="Buscar por titulo, resumen o contacto"
        />
        <select
          value={interactionTypeFilter}
          onChange={(event) => setInteractionTypeFilter(event.target.value)}
        >
          <option value="all">Todos los tipos</option>
          {interactionTypes.map((option) => (
            <option key={option.id} value={option.code}>
              {option.name}
            </option>
          ))}
        </select>
        <select
          value={interactionResultFilter}
          onChange={(event) => setInteractionResultFilter(event.target.value)}
        >
          <option value="all">Todos los resultados</option>
          {interactionResults.map((option) => (
            <option key={option.id} value={option.code}>
              {option.name}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <div className="account-interactions-inline-error">{error}</div>
      ) : null}
      {success ? (
        <div className="account-interactions-inline-success">{success}</div>
      ) : null}

      {loadingAccountInteractions ? (
        <p className="account-opps-empty">
          Cargando interacciones comerciales...
        </p>
      ) : !accountInteractions.length ? (
        <p className="account-opps-empty">
          Aun no hay interacciones comerciales registradas para esta cuenta.
        </p>
      ) : !visibleAccountInteractions.length ? (
        <p className="account-opps-empty">
          Sin resultados para los filtros seleccionados.
        </p>
      ) : (
        <div className="account-interactions-timeline">
          {visibleAccountInteractions.map((interaction) => (
            <article key={interaction.id} className="account-interaction-card">
              <div className="account-interaction-card-top">
                <div>
                  <strong>{interaction.title}</strong>
                  <div className="account-interaction-card-meta">
                    <span>{interaction.type?.name || "Sin tipo"}</span>
                    <span>{formatInteractionDate(interaction.occurredAt)}</span>
                    <span>{interaction.documentCount || 0} adjunto(s)</span>
                  </div>
                </div>
                <span
                  className={getInteractionResultBadgeClass(
                    interaction.result?.code,
                  )}
                >
                  {interaction.result?.name || "Sin resultado"}
                </span>
              </div>

              <p className="account-interaction-card-summary">
                {interaction.summary}
              </p>

              <div className="account-interaction-card-bottom">
                <div className="account-interaction-card-tags">
                  {(interaction.contacts || []).map((contact) => (
                    <span
                      key={contact.id}
                      className="account-interaction-contact-chip"
                    >
                      {contact.full_name || contact.fullName}
                    </span>
                  ))}
                  {interaction.linkedOpportunityId ? (
                    <button
                      type="button"
                      className="account-interaction-opportunity-link"
                      onClick={() =>
                        onOpenOpportunity(interaction.linkedOpportunityId)
                      }
                    >
                      Oportunidad #{interaction.linkedOpportunityId}
                    </button>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => onEditInteraction(interaction.id)}
                >
                  Editar
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export default AccountInteractionsSection;
