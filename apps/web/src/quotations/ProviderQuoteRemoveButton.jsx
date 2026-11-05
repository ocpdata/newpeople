import { useState } from "react";
import { api, getApiErrorMessage } from "../api";
import { acceptanceCorrectionConfig } from "./acceptanceCorrection";

export default function ProviderQuoteRemoveButton({ document, versionId, canUpdate, onRemoved, onBusyChange, correctionReason }) {
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    if (!window.confirm("¿Quitar la cotización de proveedor del cierre? El archivo original se conservará en la cotización u oportunidad.")) return;
    setRemoving(true);
    onBusyChange?.(true);
    setError("");
    try {
      await api.delete(`/api/quotation-versions/${versionId}/won-documents/provider-quotes/${document.source}/${document.documentId}`, acceptanceCorrectionConfig(correctionReason));
      onRemoved();
    } catch (removeError) {
      setError(getApiErrorMessage(removeError, "No fue posible quitar la cotización de proveedor"));
    } finally {
      setRemoving(false);
      onBusyChange?.(false);
    }
  }

  return canUpdate ? (
    <div className="purchase-order-value-fields">
      <div className="purchase-order-value-actions provider-quote-actions">
      <button type="button" className="btn-secondary purchase-order-remove-btn"
        aria-label={`Quitar cotización de proveedor del cierre: ${document.originalFileName || "Documento"}`}
        disabled={removing} onClick={() => void remove()}>
        {removing ? "Quitando..." : "Quitar del cierre"}
      </button>
      </div>
      {error && <p role="alert" className="field-hint opportunity-documents-preview-error">{error}</p>}
    </div>
  ) : null;
}
