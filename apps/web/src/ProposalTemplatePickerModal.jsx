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

  return (
    <div
      className="modal-overlay modal-overlay-elevated"
      role="presentation"
      onClick={onClose}
    >
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
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cerrar
          </button>
        </div>

        {loading ? <p className="field-hint">Cargando plantillas...</p> : null}

        {!loading && !templates.length ? (
          <p className="field-hint">
            No hay plantillas activas disponibles. Se usara la predeterminada
            del sistema si continúas por API.
          </p>
        ) : null}

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
                    ? "proposal-template-card is-selected"
                    : "proposal-template-card"
                }
                onClick={() => onSelectTemplate?.(template.id)}
              >
                <div
                  className={`proposal-template-cover is-${template.coverStyle || "corporate"}`}
                >
                  <span>{template.previewTitle || template.name}</span>
                </div>
                <div className="proposal-template-card-body">
                  <div className="proposal-template-card-head">
                    <strong>{template.name}</strong>
                    {template.isDefault ? (
                      <span className="proposal-chip proposal-chip-soft">
                        Predeterminada
                      </span>
                    ) : null}
                  </div>
                  <p>{template.description || "Sin descripcion"}</p>
                  <div className="proposal-template-card-meta">
                    <span className="proposal-chip proposal-chip-ghost">
                      {template.coverStyle || "corporate"}
                    </span>
                    {isSelected ? (
                      <span className="proposal-chip proposal-chip-soft">
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
