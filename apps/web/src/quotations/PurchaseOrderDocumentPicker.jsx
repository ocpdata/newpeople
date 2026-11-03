import { useState } from "react";
import { api, getApiErrorMessage } from "../api";

export default function PurchaseOrderDocumentPicker({
  versionId, quotationDocuments, opportunityDocuments, purchaseOrders, canUpdate, onSaved,
}) {
  const [selected, setSelected] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const documents = [...new Map([
    ...quotationDocuments.map((document) => ({ ...document, source: "quotation" })),
    ...opportunityDocuments.map((document) => ({ ...document, source: "opportunity" })),
  ].map((document) => [`${document.source}:${document.documentId}`, document])).values()]
    .filter((document) => !purchaseOrders.some((order) => order.documentId === document.documentId));

  async function save() {
    const document = documents.find((item) => `${item.source}:${item.documentId}` === selected);
    if (!document) {
      setError("Selecciona el archivo de la orden de compra.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const { data } = await api.post(`/api/quotation-versions/${versionId}/won-documents/purchase-orders`, {
        source: document.source, documentId: document.documentId,
      });
      setSelected("");
      onSaved(data);
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, "No fue posible registrar la orden de compra"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="purchase-order-document-picker">
      <strong>{purchaseOrders.length ? "Agregar otra orden" : "Agregar orden de compra"}</strong>
      <p className="field-hint">
        Selecciona un archivo ya cargado y agrégalo para capturar su importe y moneda.
      </p>
      {documents.length ? (
        <div className="purchase-order-picker-controls">
          <label>Archivo
            <select aria-label="Archivo de orden de compra" value={selected}
              disabled={!canUpdate || saving} onChange={(event) => setSelected(event.target.value)}>
              <option value="">Selecciona un archivo</option>
              {documents.map((document) => (
                <option key={`${document.source}:${document.documentId}`} value={`${document.source}:${document.documentId}`}>
                  {document.originalFileName} ({document.source === "quotation" ? "Cotización" : "Oportunidad"})
                </option>
              ))}
            </select>
          </label>
          {canUpdate && <button type="button" className="btn-secondary" aria-label="Registrar orden de compra"
            disabled={!selected || saving}
            onClick={() => void save()}>{saving ? "Agregando..." : "Agregar orden"}</button>}
        </div>
      ) : <p className="field-hint">No hay otros archivos disponibles para registrar como orden de compra.</p>}
      {!canUpdate && <p className="field-hint">Solo consulta. Se requiere permiso de actualización para agregar órdenes.</p>}
      {error && <p role="alert" className="field-hint opportunity-documents-preview-error">{error}</p>}
    </div>
  );
}
