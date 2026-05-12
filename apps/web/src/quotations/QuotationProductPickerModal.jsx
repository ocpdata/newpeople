function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

export default function QuotationProductPickerModal({
  isOpen,
  state,
  catalogs,
  canCreateQuickProduct,
  onClose,
  onProviderChange,
  onQueryChange,
  onSelectProduct,
  onOpenQuickCreate,
  onCancelQuickCreate,
  onQuickCreateFieldChange,
  onQuickCreateSubmit,
  formatQuotationAmount,
}) {
  if (!isOpen) {
    return null;
  }

  const selectedPriceList =
    state.activeLists.find(
      (entry) => String(entry.id) === String(state.priceListId || ""),
    ) || null;
  const quickCreateDisabledReason = !state.providerId
    ? "Selecciona primero un proveedor"
    : !state.priceListId
      ? "El proveedor no tiene una lista activa disponible"
      : selectedPriceList?.itemType === "grupo_productos"
        ? "Desde este modal no se pueden crear bundles"
        : "";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-dialog modal-dialog-account quotation-product-picker-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="quotation-product-picker-header">
          <div>
            <h3 className="modal-title">
              {state.isCreateMode ? "Crear producto" : "Seleccionar producto"}
            </h3>
            <p className="field-hint opportunity-modal-subtitle">
              {state.isCreateMode
                ? "Completa solo los datos del nuevo item. El resto se hereda del proveedor y su lista activa."
                : "Selecciona proveedor y luego el producto para precargar la fila. La lista activa se detecta automaticamente."}
            </p>
          </div>
          {!state.isCreateMode && canCreateQuickProduct ? (
            <button
              type="button"
              className="quotation-icon-button quotation-product-picker-create-button"
              onClick={onOpenQuickCreate}
              disabled={Boolean(quickCreateDisabledReason)}
              title={quickCreateDisabledReason || "Crear producto"}
              aria-label={quickCreateDisabledReason || "Crear producto"}
            >
              <span className="quotation-product-picker-create-icon" aria-hidden="true">
                <PlusIcon />
              </span>
            </button>
          ) : null}
        </div>

        {!state.isCreateMode ? (
          <div className="quotation-product-picker-filters quotation-product-picker-filters-compact">
            <div className="field-group quotation-product-picker-provider">
              <label>Proveedor</label>
              <select value={state.providerId} onChange={(event) => onProviderChange(event.target.value)}>
                <option value="">Selecciona proveedor</option>
                {catalogs.providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field-group quotation-product-picker-search">
              <label>Buscar producto</label>
              <input
                autoFocus
                disabled={!selectedPriceList}
                placeholder={
                  selectedPriceList
                    ? "Codigo o descripcion"
                    : state.loadingLists
                      ? "Resolviendo lista activa..."
                      : "Selecciona primero un proveedor con lista activa"
                }
                value={state.query}
                onChange={(event) => onQueryChange(event.target.value)}
              />
            </div>
          </div>
        ) : null}

        {state.error ? (
          <p className="field-hint quotation-product-picker-error">{state.error}</p>
        ) : null}

        {!state.isCreateMode ? (
          <div className="quotation-product-picker-results">
            <table className="quotation-product-picker-table">
              <thead>
                <tr>
                  <th>Codigo</th>
                  <th>Descripcion</th>
                  <th>Lista</th>
                  <th>Precio</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {!state.providerId ? (
                  <tr>
                    <td colSpan={5} className="empty-state">
                      Selecciona un proveedor activo para continuar.
                    </td>
                  </tr>
                ) : !selectedPriceList ? (
                  <tr>
                    <td colSpan={5} className="empty-state">
                      {state.loadingLists
                        ? "Cargando lista activa del proveedor..."
                        : "El proveedor seleccionado no tiene una lista activa disponible."}
                    </td>
                  </tr>
                ) : state.loading ? (
                  <tr>
                    <td colSpan={5} className="empty-state">
                      Cargando productos...
                    </td>
                  </tr>
                ) : state.results.length ? (
                  state.results.map((product) => (
                    <tr key={product.id}>
                      <td>{product.code}</td>
                      <td>{product.description}</td>
                      <td>{product.priceListName}</td>
                      <td>
                        {product.currencySymbol || "$"}
                        {formatQuotationAmount(product.price)}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="quotation-icon-button"
                          title="Seleccionar producto"
                          onClick={() => onSelectProduct(product)}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="m20 6-11 11-5-5" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="empty-state">
                      No hay productos activos en la lista seleccionada que coincidan con la busqueda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <form className="quotation-product-quick-create-form" onSubmit={onQuickCreateSubmit}>
            <section className="quotation-product-quick-create-context">
              <div className="quotation-product-quick-create-context-header">
                <h4>Contexto heredado</h4>
                <p className="field-hint">
                  Estos valores se toman automaticamente del proveedor seleccionado.
                </p>
              </div>
              <div className="quotation-product-quick-create-context-grid">
                <div className="quotation-product-quick-create-context-item">
                  <span className="quotation-product-quick-create-context-label">
                    Proveedor
                  </span>
                  <strong>{selectedPriceList?.providerName || ""}</strong>
                </div>
                <div className="quotation-product-quick-create-context-item">
                  <span className="quotation-product-quick-create-context-label">
                    Tipo
                  </span>
                  <strong>
                    {selectedPriceList?.itemType === "servicio_propio"
                      ? "Servicio propio"
                      : selectedPriceList?.itemType === "grupo_productos"
                        ? "Bundle"
                        : selectedPriceList
                          ? "Producto"
                          : ""}
                  </strong>
                </div>
                <div className="quotation-product-quick-create-context-item">
                  <span className="quotation-product-quick-create-context-label">
                    Moneda
                  </span>
                  <strong>
                    {selectedPriceList
                      ? `${selectedPriceList.currencyCode} - ${selectedPriceList.currencyName}`
                      : ""}
                  </strong>
                </div>
              </div>
            </section>

            <section className="quotation-product-quick-create-fields-card">
              <div className="quotation-product-quick-create-fields-header">
                <h4>Datos del item</h4>
                <p className="field-hint">
                  Captura el codigo, el precio y una descripcion clara si aplica.
                </p>
              </div>
              <div className="quotation-product-quick-create-grid">
                <div className="field-group">
                  <label>Codigo</label>
                  <input
                    autoFocus
                    value={state.createForm.code}
                    onChange={(event) =>
                      onQuickCreateFieldChange("code", event.target.value)
                    }
                    required
                  />
                </div>
                <div className="field-group">
                  <label>Precio</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={state.createForm.price}
                    onChange={(event) =>
                      onQuickCreateFieldChange("price", event.target.value)
                    }
                    required
                  />
                </div>
                <div className="field-group field-group-full-width">
                  <label>Descripcion</label>
                  <textarea
                    rows={4}
                    value={state.createForm.description}
                    onChange={(event) =>
                      onQuickCreateFieldChange("description", event.target.value)
                    }
                    placeholder="Describe brevemente el alcance o contenido del item"
                  />
                </div>
              </div>
            </section>

            {state.createError ? (
              <p className="field-hint quotation-product-picker-error">
                {state.createError}
              </p>
            ) : null}

            <div className="modal-buttons">
              <button type="button" className="btn-secondary" onClick={onCancelQuickCreate}>
                Volver
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={state.creating || Boolean(quickCreateDisabledReason)}
                title={quickCreateDisabledReason || "Guardar producto"}
              >
                Guardar producto
              </button>
            </div>
          </form>
        )}

        {!state.isCreateMode ? (
          <div className="modal-buttons">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cerrar
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}