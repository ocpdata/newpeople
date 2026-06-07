import QuotationEditorContent from "./QuotationEditorContent";
import ModalInlineHelp from "../help/ModalInlineHelp";

function QuotationEditModal({
  isOpen,
  closeEditQuotationModal,
  error,
  success,
  editorContentProps,
}) {
  if (!isOpen) {
    return null;
  }

  const selectedQuotation = editorContentProps?.selectedQuotation;
  const selectedVersion = editorContentProps?.selectedVersion;

  return (
    <div className="modal-overlay">
      <div
        className="modal-dialog modal-dialog-account quotation-create-modal quotation-edit-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div className="opportunity-modal-header-copy">
            <div className="account-modal-title-row">
              <h3 className="modal-title">Editar cotizacion</h3>
              <ModalInlineHelp helpKey="quotation.edit" />
            </div>
            <p className="field-hint opportunity-modal-subtitle">
              Actualiza la cotizacion, sus secciones y sus items desde esta
              ventana.
            </p>
          </div>
          <div className="account-modal-header-actions">
            {selectedVersion ? (
              <div
                className="quotation-edit-modal-meta"
                aria-label="Resumen de cotizacion"
              >
                <span className="record-id-badge">
                  Cotizacion {selectedQuotation?.id || "-"}
                </span>
                <span className="record-id-badge">
                  Version {selectedVersion.versionNumber}
                </span>
                <span className="record-id-badge">
                  Estado: {selectedVersion.statusName}
                </span>
                <span className="record-id-badge">
                  {selectedVersion.isLatestVersion
                    ? "Version mayor"
                    : "Version historica"}
                </span>
              </div>
            ) : null}
            <button
              type="button"
              className="opportunity-documents-apply-icon-button account-modal-close-button"
              onClick={closeEditQuotationModal}
              aria-label="Cerrar modal de edición de cotización"
              title="Cerrar"
            >
              ×
            </button>
          </div>
        </div>
        <div className="quotation-content quotation-edit-modal-content">
          <QuotationEditorContent
            {...editorContentProps}
            error={error}
            success={success}
          />
        </div>
      </div>
    </div>
  );
}

export default QuotationEditModal;
