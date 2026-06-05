export default function ProposalTemplatePickerModal({
  isOpen,
  title,
  subtitle,
  templates,
  loading,
  selectedTemplateId,
  onSelectTemplate,
  onClose,
  onConfirm,
  confirmLabel = "Continuar",
  busy = false,
  footerContent = null,
}) {
  if (!isOpen) {
    return null;
  }

  const selectedTemplate = templates.find(
    (template) => Number(template.id || 0) === Number(selectedTemplateId || 0),
  );

  const getCoverLabel = (coverStyle) => {
    switch (String(coverStyle || "").trim()) {
      case "premium":
        return "Executive";
      case "technical":
        return "Technical";
      default:
        return "Corporate";
    }
  };

  return (
    <div className="modal-overlay modal-overlay-elevated" role="presentation">
      <div
        className="modal-dialog modal-dialog-wide proposal-template-picker-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h3 className="modal-title">{title}</h3>
            {subtitle ? <p className="field-hint">{subtitle}</p> : null}
          </div>
          <div className="account-modal-header-actions">
            <button
              type="button"
              className="opportunity-documents-apply-icon-button account-modal-close-button"
              onClick={onClose}
              aria-label="Cerrar modal de creación de propuesta"
              title="Cerrar"
              disabled={busy}
            >
              ×
            </button>
          </div>
        </div>

        <div className="proposal-template-picker-intro">
          <div className="proposal-template-picker-intro-copy">
            <span className="proposal-template-picker-eyebrow">
              Narrativa base
            </span>
            {loading ? (
              <p className="field-hint">Cargando plantillas...</p>
            ) : null}
            {!loading && !templates.length ? (
              <p className="field-hint">
                No hay plantillas activas disponibles. Se usara la
                predeterminada del sistema si continúas por API.
              </p>
            ) : null}
            {!loading && templates.length ? (
              <p className="proposal-template-picker-caption">
                Elige la portada y el tono visual de la propuesta. El pricing y
                la estructura comercial siguen heredandose de la cotizacion
                aprobada.
              </p>
            ) : null}
          </div>

          {!loading && templates.length ? (
            <div className="proposal-template-picker-status-card">
              <span className="proposal-template-picker-status-label">
                Plantillas activas
              </span>
              <strong>{templates.length}</strong>
              <p>
                {selectedTemplate
                  ? `Seleccion actual: ${selectedTemplate.name}`
                  : "Selecciona una plantilla para habilitar la creacion."}
              </p>
            </div>
          ) : null}
        </div>

        <div className="proposal-template-picker-grid">
          {templates.map((template) => {
            const isSelected =
              Number(selectedTemplateId || 0) === Number(template.id || 0);
            return (
              <button
                key={template.id}
                type="button"
                className={
                  isSelected
                    ? `proposal-template-card is-${template.coverStyle || "corporate"} is-selected`
                    : `proposal-template-card is-${template.coverStyle || "corporate"}`
                }
                aria-pressed={isSelected}
                onClick={() => onSelectTemplate?.(template.id)}
              >
                <div
                  className={`proposal-template-cover is-${template.coverStyle || "corporate"}`}
                >
                  <div className="proposal-template-cover-head">
                    <span className="proposal-chip proposal-chip-outline">
                      {getCoverLabel(template.coverStyle)}
                    </span>
                    {isSelected ? (
                      <span className="proposal-template-cover-badge">
                        Lista
                      </span>
                    ) : null}
                  </div>
                  <span className="proposal-template-cover-title">
                    {template.previewTitle || template.name}
                  </span>
                </div>
                <div className="proposal-template-card-body">
                  <div className="proposal-template-card-head">
                    <strong>{template.name}</strong>
                  </div>
                  <p>{template.description || "Sin descripcion"}</p>
                  <div className="proposal-template-card-meta">
                    {template.isDefault ? (
                      <span className="proposal-chip proposal-chip-soft">
                        Predeterminada
                      </span>
                    ) : null}
                    <span className="proposal-chip proposal-chip-ghost">
                      {template.coverStyle || "corporate"}
                    </span>
                    {isSelected ? (
                      <span className="proposal-chip proposal-chip-outline proposal-chip-outline-dark">
                        Seleccionada
                      </span>
                    ) : null}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {footerContent}

        <div className="proposal-template-picker-actions">
          <div className="proposal-template-picker-actions-copy">
            <span className="proposal-template-picker-actions-label">
              {selectedTemplate ? "Plantilla elegida" : "Siguiente paso"}
            </span>
            <strong>
              {selectedTemplate
                ? selectedTemplate.name
                : "Selecciona una plantilla para continuar"}
            </strong>
          </div>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || (!selectedTemplateId && templates.length > 0)}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
