export function StageBypassConfirmationModal({
  isOpen,
  reason,
  onReasonChange,
  onCancel,
  onConfirm,
  isSubmitting,
}) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Confirmar bypass de etapa</h3>
        <p className="modal-message">
          Confirma que deseas omitir la etapa actual. La oportunidad quedará con
          un cambio pendiente hasta que presiones Guardar cambios.
        </p>
        <div className="field-group opportunity-bypass-confirm-group">
          <label>
            Motivo del bypass <span className="required-mark">*</span>
          </label>
          <textarea
            aria-label="Motivo del bypass"
            rows={4}
            placeholder="Describe por qué se omitirá esta etapa"
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            disabled={isSubmitting}
            autoFocus
          />
        </div>
        <div className="modal-buttons">
          <button className="btn-secondary" onClick={onCancel}>
            Cancelar
          </button>
          <button className="btn-primary" onClick={onConfirm}>
            {isSubmitting ? "Bypaseando..." : "Confirmar bypass"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CommercialCloseConfirmationModal({
  isOpen,
  statusCode,
  reason,
  onReasonChange,
  onCancel,
  onConfirm,
}) {
  if (!isOpen) return null;

  const statusLabel = statusCode === "anulada" ? "anulada" : "perdida";

  return (
    <div className="modal-overlay">
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Confirmar oportunidad {statusLabel}</h3>
        <p className="modal-message">
          Confirma que deseas marcar la oportunidad como {statusLabel}. El
          cambio quedará pendiente hasta que presiones Guardar cambios.
        </p>
        <div className="field-group opportunity-bypass-confirm-group">
          <label>
            Motivo del cierre <span className="required-mark">*</span>
          </label>
          <textarea
            aria-label="Motivo del cierre comercial"
            rows={4}
            placeholder={`Describe por qué la oportunidad se marcará como ${statusLabel}`}
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            autoFocus
          />
        </div>
        <div className="modal-buttons">
          <button className="btn-secondary" onClick={onCancel}>
            Cancelar
          </button>
          <button className="btn-primary" onClick={onConfirm}>
            Confirmar cierre
          </button>
        </div>
      </div>
    </div>
  );
}

export function CommercialStatusReasonModal({
  isOpen,
  statusLabel,
  reason,
  onClose,
}) {
  if (!isOpen) return null;

  const normalizedStatus = String(statusLabel || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const statusTone =
    normalizedStatus === "anulada"
      ? "canceled"
      : normalizedStatus === "perdida"
        ? "lost"
        : "pending";
  const statusIcon = normalizedStatus === "anulada" ? "⊘" : "✕";
  const hasReason = Boolean(String(reason || "").trim());

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-dialog commercial-status-reason-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="commercial-status-reason-header">
          <div className={`commercial-status-reason-icon is-${statusTone}`}>
            <span aria-hidden="true">{statusIcon}</span>
          </div>
          <div className="commercial-status-reason-copy">
            <span
              className={`status-icon-badge commercial-status-reason-badge ${statusTone}`}
            >
              <span className="status-dot" aria-hidden="true" />
              {statusLabel || "Estado comercial"}
            </span>
            <h3 className="modal-title">Detalle del cierre comercial</h3>
            <p className="modal-message">
              Consulta el motivo registrado cuando la oportunidad fue marcada
              como {statusLabel || "cerrada"}.
            </p>
          </div>
        </div>

        <div className="commercial-status-reason-panel">
          <div className="commercial-status-reason-panel-label">
            Motivo registrado
          </div>
          <div
            className={`commercial-status-reason-body${
              hasReason ? "" : " is-empty"
            }`}
            aria-label="Motivo del estado comercial"
          >
            {hasReason
              ? reason
              : "No se registró un motivo para este cierre comercial."}
          </div>
        </div>
        <div className="modal-buttons">
          <button className="btn-primary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmationModal({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText = "Aceptar",
  cancelText = "Cancelar",
  isDangerous = false,
  confirmDisabled = false,
  cancelDisabled = false,
  overlayClassName = "",
  dialogClassName = "",
}) {
  if (!isOpen) return null;

  return (
    <div className={`modal-overlay ${overlayClassName}`.trim()}>
      <div className={`modal-dialog ${dialogClassName}`.trim()}>
        <h3 className="modal-title">{title}</h3>
        <p className="modal-message">{message}</p>
        <div className="modal-buttons">
          <button
            className="btn-secondary"
            onClick={onCancel}
            disabled={cancelDisabled}
          >
            {cancelText}
          </button>
          <button
            className={isDangerous ? "btn-danger" : "btn-primary"}
            onClick={onConfirm}
            disabled={confirmDisabled}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
