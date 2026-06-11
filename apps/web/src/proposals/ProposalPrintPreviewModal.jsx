import "./proposal-print.css";
import ProposalPrintDocument from "./ProposalPrintDocument";

export default function ProposalPrintPreviewModal({
  isOpen,
  dirty,
  model,
  onClose,
  onOpenPdfPreview,
  onOpenEmailComposer,
}) {
  if (!isOpen || !model) {
    return null;
  }

  return (
    <div
      className="modal-overlay modal-overlay-elevated proposal-print-preview-overlay"
      onClick={onClose}
    >
      <div
        className="modal-dialog modal-dialog-account proposal-print-preview-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="proposal-print-preview-header">
          <div>
            <h3 className="modal-title">Impresion</h3>
            <p className="field-hint">
              {dirty
                ? "Mostrando el borrador actual con cambios sin guardar."
                : "Mostrando la ultima version cargada de la propuesta."}
            </p>
          </div>
          <div className="proposal-print-preview-actions">
            <span className="proposal-chip proposal-chip-soft">
              {dirty ? "Borrador actual" : "Ultima version guardada"}
            </span>
            <button
              type="button"
              className="proposal-print-preview-icon-button is-primary"
              onClick={onOpenPdfPreview}
              aria-label="Abrir PDF"
              title="Abrir PDF"
            >
              <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                <path d="M6.25 5.75A2 2 0 0 1 8.25 3.75h7.5l3 3v11.5a2 2 0 0 1-2 2h-8.5a2 2 0 0 1-2-2V5.75Zm8.5-2v3h3M12 8.75v7.5m0 0-3-3m3 3 3-3" />
              </svg>
            </button>
            <button
              type="button"
              className="proposal-print-preview-icon-button"
              onClick={() => onOpenEmailComposer?.()}
              aria-label="Enviar por correo"
              title="Enviar por correo"
            >
              <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                <path d="M3.75 6.75h16.5a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5H3.75a1.5 1.5 0 0 1-1.5-1.5v-7.5a1.5 1.5 0 0 1 1.5-1.5Zm0 1.5L12 13.5l8.25-5.25" />
              </svg>
            </button>
            <button
              type="button"
              className="proposal-print-preview-icon-button"
              onClick={onClose}
              aria-label="Cerrar"
              title="Cerrar"
            >
              <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                <path d="M7.53 6.47a.75.75 0 0 1 1.06 0L12 9.94l3.41-3.47a.75.75 0 1 1 1.08 1.04L13.06 11l3.43 3.49a.75.75 0 0 1-1.08 1.04L12 12.06l-3.41 3.47a.75.75 0 0 1-1.08-1.04L10.94 11 7.53 7.53a.75.75 0 0 1 0-1.06Z" />
              </svg>
            </button>
          </div>
        </div>

        <div className="proposal-print-preview-body">
          <ProposalPrintDocument model={model} />
        </div>
      </div>
    </div>
  );
}
