import "./quotation-print.css";
import QuotationPrintDocument from "./QuotationPrintDocument";

function QuotationPrintPreviewModal({
  isOpen,
  onClose,
  onOpenPdfPreview,
  canOpenPdfPreview,
  model,
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="modal-overlay quotation-print-preview-overlay"
      onClick={onClose}
    >
      <div
        className="modal-dialog modal-dialog-account quotation-print-preview-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="quotation-print-preview-header">
          <h3 className="modal-title">Impresion</h3>
          <div className="quotation-print-preview-actions">
            {canOpenPdfPreview ? (
              <button
                type="button"
                className="btn-primary"
                onClick={onOpenPdfPreview}
              >
                Abrir PDF
              </button>
            ) : null}
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </div>
        <div className="quotation-print-preview-body">
          <QuotationPrintDocument model={model} />
        </div>
      </div>
    </div>
  );
}

export default QuotationPrintPreviewModal;
