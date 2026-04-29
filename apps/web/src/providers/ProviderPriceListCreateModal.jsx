export default function ProviderPriceListCreateModal({
  isOpen,
  provider,
  form,
  catalogs,
  saving,
  importFileName,
  importPreview,
  reviewingImport,
  importProgress,
  onClose,
  onSubmit,
  onChange,
  onDownloadTemplate,
  onImportFileChange,
  onClearImportFile,
  onReviewImportFile,
}) {
  if (!isOpen || !provider) {
    return null;
  }

  function formatPreviewPrice(value) {
    return new Intl.NumberFormat("es-MX", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value || 0));
  }

  function formatPreviewCount(value) {
    return new Intl.NumberFormat("es-MX").format(Number(value || 0));
  }

  const hasImportFile = Boolean(importFileName);
  const importDisabledForType = form.itemType === "grupo_productos";
  const validImportRows = importPreview?.validItems.length || 0;
  const invalidImportRows = importPreview?.invalidRows.length || 0;
  const shouldReviewBeforeSubmit = hasImportFile && !importPreview;
  const submitDisabled = saving || (hasImportFile && validImportRows === 0);
  const canReviewImport =
    !saving &&
    !reviewingImport &&
    Boolean(String(form.name || "").trim()) &&
    Boolean(form.currencyId) &&
    Boolean(form.itemType) &&
    !importDisabledForType;
  const primaryButtonLabel = hasImportFile
    ? importPreview
      ? saving
        ? "Creando e importando..."
        : "Crear lista e importar"
      : reviewingImport
        ? "Revisando..."
        : "Revisar archivo"
    : saving
      ? "Creando..."
      : "Crear lista";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-dialog modal-dialog-account provider-price-list-create-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="opportunity-modal-header-copy">
            <h3 className="modal-title">Crear lista de precios</h3>
            <p className="field-hint opportunity-modal-subtitle">
              {provider.name}
            </p>
          </div>
        </div>

        <form
          className="account-create-form in-modal provider-price-list-create-form"
          onSubmit={onSubmit}
        >
          <section className="account-form-section account-modal-section">
            <p className="field-hint provider-price-list-create-note">
              La lista se crea inactiva y usa una sola moneda y un solo tipo.
            </p>
            <div className="provider-price-list-create-grid">
              <div className="field-group provider-price-list-create-name-field">
                <label>
                  Nombre <span className="required-mark">*</span>
                </label>
                <input
                  value={form.name}
                  onChange={(e) => onChange("name", e.target.value)}
                  placeholder="Ej. Lista mayo 2026"
                  required
                />
              </div>
              <div className="field-group">
                <label>
                  Moneda <span className="required-mark">*</span>
                </label>
                <select
                  value={form.currencyId}
                  onChange={(e) => onChange("currencyId", e.target.value)}
                  required
                >
                  <option value="">Selecciona moneda</option>
                  {catalogs.currencies.map((currency) => (
                    <option key={currency.id} value={currency.id}>
                      {currency.code} - {currency.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label>
                  Tipo <span className="required-mark">*</span>
                </label>
                <select
                  value={form.itemType}
                  onChange={(e) => onChange("itemType", e.target.value)}
                  required
                >
                  {catalogs.productTypes.map((productType) => (
                    <option key={productType.id} value={productType.code}>
                      {productType.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="field-hint provider-price-list-import-helper">
              Si el Excel no incluye Moneda, Estado o Tipo, se usarán los
              valores configurados en esta lista. Estado por defecto: Activo.
            </p>
          </section>

          <section className="account-form-section account-modal-section provider-price-list-import-section">
            <div className="provider-price-list-import-header">
              <div>
                <h4>Importación opcional desde Excel</h4>
                <p className="field-hint">
                  Puedes crear la lista vacía o cargar productos durante la
                  creación.
                </p>
              </div>
            </div>

            <div className="provider-price-list-import-actions-panel">
              <button
                type="button"
                className="provider-price-list-action-chip"
                onClick={onDownloadTemplate}
                disabled={saving}
              >
                <span
                  className="provider-price-list-action-chip-icon"
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d="M12 4a.75.75 0 0 1 .75.75v8.69l2.72-2.72a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 1 1 1.06-1.06l2.72 2.72V4.75A.75.75 0 0 1 12 4Z" />
                    <path d="M5.75 16a.75.75 0 0 1 .75.75v1.5c0 .14.11.25.25.25h10.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 17.25 20H6.75A1.75 1.75 0 0 1 5 18.25v-1.5a.75.75 0 0 1 .75-.75Z" />
                  </svg>
                </span>
                <span className="provider-price-list-action-chip-copy">
                  <strong>Plantilla</strong>
                  <small>Formato base</small>
                </span>
              </button>

              <label className="provider-price-list-action-chip provider-price-list-file-picker">
                <span
                  className="provider-price-list-action-chip-icon is-primary"
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d="M12 19a.75.75 0 0 1-.75-.75V9.56L8.53 12.28a.75.75 0 1 1-1.06-1.06l4-4a.75.75 0 0 1 1.06 0l4 4a.75.75 0 1 1-1.06 1.06l-2.72-2.72v8.69A.75.75 0 0 1 12 19Z" />
                    <path d="M5.75 5A1.75 1.75 0 0 0 4 6.75v1.5a.75.75 0 0 0 1.5 0v-1.5c0-.14.11-.25.25-.25h12.5a.25.25 0 0 1 .25.25v1.5a.75.75 0 0 0 1.5 0v-1.5A1.75 1.75 0 0 0 18.25 5Z" />
                  </svg>
                </span>
                <span className="provider-price-list-action-chip-copy">
                  <strong>Seleccionar archivo</strong>
                  <small>Excel .xlsx o .xls</small>
                </span>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(event) =>
                    onImportFileChange(event.target.files?.[0] || null)
                  }
                  disabled={saving}
                />
              </label>

              <button
                type="button"
                className="provider-price-list-action-chip is-muted"
                onClick={onClearImportFile}
                disabled={!hasImportFile || saving || reviewingImport}
              >
                <span
                  className="provider-price-list-action-chip-icon is-muted"
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d="M7.53 6.47a.75.75 0 0 1 1.06 0L12 9.94l3.41-3.47a.75.75 0 1 1 1.08 1.04L13.06 11l3.43 3.49a.75.75 0 0 1-1.08 1.04L12 12.06l-3.41 3.47a.75.75 0 0 1-1.08-1.04L10.94 11 7.53 7.53a.75.75 0 0 1 0-1.06Z" />
                  </svg>
                </span>
                <span className="provider-price-list-action-chip-copy">
                  <strong>Quitar archivo</strong>
                  <small>{hasImportFile ? "Limpiar selección" : "Sin archivo"}</small>
                </span>
              </button>

              <div className="provider-price-list-import-file-summary">
                <div className="provider-price-list-import-file-summary-head">
                  <strong>Archivo</strong>
                  <span
                    className={
                      hasImportFile
                        ? "provider-price-list-file-badge is-selected"
                        : "provider-price-list-file-badge"
                    }
                  >
                    {hasImportFile ? "Listo" : "Pendiente"}
                  </span>
                </div>
                <span>{importFileName || "Ningún archivo seleccionado"}</span>
              </div>
            </div>

            {importDisabledForType ? (
              <p className="field-hint provider-price-list-import-warning">
                La importación desde Excel no está disponible para listas tipo
                Bundle.
              </p>
            ) : null}

            {importProgress ? (
              <div className="provider-price-list-import-progress">
                <strong>Importando productos...</strong>
                <span>
                  {importProgress.importedCount} de {importProgress.totalValid} filas
                  válidas procesadas
                </span>
              </div>
            ) : null}

            {importPreview ? (
              <div className="provider-price-list-import-preview-shell">
                <div className="provider-price-import-preview-summary">
                  <article className="provider-price-import-summary-card is-valid">
                    <strong>{formatPreviewCount(validImportRows)}</strong>
                    <span>
                      fila{validImportRows === 1 ? "" : "s"} válida
                      {validImportRows === 1 ? "" : "s"}
                    </span>
                  </article>
                  <article className="provider-price-import-summary-card is-invalid">
                    <strong>{formatPreviewCount(invalidImportRows)}</strong>
                    <span>
                      fila{invalidImportRows === 1 ? "" : "s"} inválida
                      {invalidImportRows === 1 ? "" : "s"}
                    </span>
                  </article>
                </div>

                {validImportRows > 0 ? (
                  <section className="provider-price-import-preview-section">
                    <div className="provider-price-import-preview-section-header">
                      <h4>Filas listas para importar</h4>
                    </div>
                    <div className="provider-price-import-preview-table-wrap">
                      <table className="provider-price-import-preview-table">
                        <thead>
                          <tr>
                            <th>Fila</th>
                            <th>Código</th>
                            <th>Descripción</th>
                            <th>Precio</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importPreview.validItems.map((item) => (
                            <tr key={`valid-${item.excelRowNumber}-${item.code}`}>
                              <td>{item.excelRowNumber}</td>
                              <td>{item.code}</td>
                              <td>{item.description || "-"}</td>
                              <td>{formatPreviewPrice(item.price)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ) : null}

                {invalidImportRows > 0 ? (
                  <section className="provider-price-import-preview-section">
                    <div className="provider-price-import-preview-section-header">
                      <h4>Filas con observaciones</h4>
                    </div>
                    <div className="provider-price-import-issues-list">
                      {importPreview.invalidRows.map((row) => (
                        <article
                          key={`invalid-${row.excelRowNumber}-${row.code || "empty"}`}
                          className="provider-price-import-issue-card"
                        >
                          <div className="provider-price-import-issue-head">
                            <strong>Fila {row.excelRowNumber}</strong>
                            <span>{row.code || "Sin código"}</span>
                          </div>
                          <ul>
                            {row.issues.map((issue) => (
                              <li key={`${row.excelRowNumber}-${issue}`}>{issue}</li>
                            ))}
                          </ul>
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            ) : null}
          </section>

          <div className="modal-buttons" style={{ marginTop: 16 }}>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            {shouldReviewBeforeSubmit ? (
              <button
                type="button"
                className="btn-primary"
                disabled={!canReviewImport}
                onClick={onReviewImportFile}
              >
                {primaryButtonLabel}
              </button>
            ) : (
              <button type="submit" className="btn-primary" disabled={submitDisabled}>
                {primaryButtonLabel}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}