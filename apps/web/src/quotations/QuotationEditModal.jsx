import QuotationEditorContent from "./QuotationEditorContent";

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

  return (
    <div className="modal-overlay" onClick={closeEditQuotationModal}>
      <div
        className="modal-dialog modal-dialog-account quotation-create-modal quotation-edit-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div className="opportunity-modal-header-copy">
            <h3 className="modal-title">Editar cotizacion</h3>
            <p className="field-hint opportunity-modal-subtitle">
              Actualiza la cotizacion, sus secciones y sus items desde esta
              ventana.
            </p>
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
