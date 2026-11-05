import { useState } from "react";
import { api, getApiErrorMessage } from "../api";
import { acceptanceCorrectionConfig } from "./acceptanceCorrection";

export default function ClosingDocumentPicker({
  versionId, quotationDocuments, opportunityDocuments = [], selections, excludedDocuments = [], role, canUpdate, onSaved, onBusyChange, readOnlyReason, correctionReason,
}) {
  const [selected, setSelected] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isProviderQuote = role === "provider_quote";
  const documentLabel = isProviderQuote ? "cotización de proveedor" : "orden de compra";
  const documents = [...new Map([
    ...quotationDocuments.map((document) => ({ ...document, source: "quotation" })),
    ...(isProviderQuote ? [] : opportunityDocuments.map((document) => ({ ...document, source: "opportunity" }))),
  ].map((document) => [`${document.source}:${document.documentId}`, document])).values()]
    .filter((document) => !selections.some((item) => item.documentId === document.documentId)
      && !excludedDocuments.some((item) => item.documentId === document.documentId));

  async function save() {
    const document = documents.find((item) => `${item.source}:${item.documentId}` === selected);
    if (!document) {
      setError(`Selecciona el archivo de ${documentLabel}.`);
      return;
    }
    setSaving(true);
    onBusyChange?.(true);
    setError("");
    try {
      const { data } = await api.post(`/api/quotation-versions/${versionId}/won-documents/${isProviderQuote ? "provider-quotes" : "purchase-orders"}`, {
        source: document.source, documentId: document.documentId,
      }, acceptanceCorrectionConfig(correctionReason));
      setSelected("");
      onSaved(data);
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, `No fue posible registrar la ${documentLabel}`));
    } finally {
      setSaving(false);
      onBusyChange?.(false);
    }
  }

  return (
    <div className="purchase-order-document-picker">
      <strong>{isProviderQuote ? "Agregar cotización de proveedor" : selections.length ? "Agregar otra orden" : "Agregar orden de compra"}</strong>
      <p className="field-hint">
        {isProviderQuote
          ? "Selecciona un archivo ya cargado en la cotización y agrégalo a los documentos de cierre."
          : "Selecciona un archivo ya cargado y agrégalo para capturar su importe y moneda."}
      </p>
      {documents.length ? (
        <div className="purchase-order-picker-controls">
          <label>Archivo
            <select aria-label={`Archivo de ${documentLabel}`} value={selected}
              disabled={!canUpdate || saving} onChange={(event) => setSelected(event.target.value)}>
              <option value="">Selecciona un archivo</option>
              {documents.map((document) => (
                <option key={`${document.source}:${document.documentId}`} value={`${document.source}:${document.documentId}`}>
                  {document.originalFileName} ({document.source === "quotation" ? "Cotización" : "Oportunidad"})
                </option>
              ))}
            </select>
          </label>
          {canUpdate && <button type="button" className="btn-secondary" aria-label={`Registrar ${documentLabel}`}
            disabled={!selected || saving}
            onClick={() => void save()}>{saving ? "Agregando..." : isProviderQuote ? "Agregar cotización de proveedor" : "Agregar orden"}</button>}
        </div>
      ) : <p className="field-hint">No hay otros archivos disponibles para registrar como {documentLabel}.</p>}
      {!canUpdate && <p className="field-hint">{readOnlyReason || `Solo consulta. Se requiere permiso de actualización para agregar ${isProviderQuote ? "cotizaciones de proveedores" : "órdenes"}.`}</p>}
      {error && <p role="alert" className="field-hint opportunity-documents-preview-error">{error}</p>}
    </div>
  );
}
