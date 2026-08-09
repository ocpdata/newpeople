import PurchaseOrderPrintDocument from "./PurchaseOrderPrintDocument";
import "./quotation-print.css";

function PurchaseOrderPrintPreviewModal({ isOpen, onClose, onConfirm, model }) {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="modal-overlay modal-overlay-elevated quotation-print-preview-overlay"
      onClick={onClose}
    >
      <div
        className="modal-dialog modal-dialog-account quotation-print-preview-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="quotation-print-preview-header">
          <h3 className="modal-title">Vista previa final</h3>
          <div className="quotation-print-preview-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Volver
            </button>
            <button type="button" className="btn-primary" onClick={onConfirm}>
              Confirmar y generar
            </button>
          </div>
        </div>
        <div className="quotation-print-preview-body">
          <PurchaseOrderPrintDocument model={model} />
        </div>
      </div>
    </div>
  );
}

export default PurchaseOrderPrintPreviewModal;