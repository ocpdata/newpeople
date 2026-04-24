export default function ProviderPriceItemModal({
  isOpen,
  providerState,
  catalogs,
  savingPriceItem,
  helpers,
  handlers,
}) {
  if (!isOpen || !providerState.providerPriceListModalProvider) {
    return null;
  }

  const {
    providerPriceListModalProvider,
    selectedProviderPriceList,
    editingPriceItemId,
    isGroupProductsPriceList,
    priceItemForm,
    groupPriceItemTotal,
    activeProvidersForGroupBase,
    groupBaseProviderId,
    groupBaseActiveList,
    loadingGroupBaseProviderItems,
    groupBaseProviderItems,
    filteredGroupBaseProviderItems,
    selectedGroupBaseItem,
    groupBaseItemFilter,
    groupPriceItemComponents,
    groupComponentProviderId,
    groupComponentActiveList,
    loadingGroupComponentProviderItems,
    availableGroupComponentProviderItems,
    filteredGroupComponentResults,
    groupComponentItemFilter,
  } = providerState;

  const { formatPriceValue, getCatalogProductTypeLabel } = helpers;
  const {
    onClose,
    onSubmit,
    onPriceItemFieldChange,
    onGroupBaseProviderChange,
    onGroupBaseItemFilterChange,
    onApplyBaseItem,
    onGroupComponentProviderChange,
    onGroupComponentItemFilterChange,
    onAddGroupComponent,
    onStepGroupComponentQuantity,
    onUpdateGroupComponentQuantity,
    onMoveGroupComponent,
    onRemoveGroupComponent,
  } = handlers;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={
          isGroupProductsPriceList
            ? "modal-dialog modal-dialog-account provider-price-item-modal provider-price-item-modal-group"
            : "modal-dialog modal-dialog-account provider-price-item-modal"
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="opportunity-modal-header-copy">
            <h3 className="modal-title">
              {editingPriceItemId ? "Editar precio" : "Agregar producto"}
            </h3>
            <p className="field-hint opportunity-modal-subtitle">
              {providerPriceListModalProvider.name}
              {selectedProviderPriceList ? ` · ${selectedProviderPriceList.name}` : ""}
            </p>
          </div>
          {editingPriceItemId && (
            <div className="opportunity-modal-header-meta">
              <span className="record-id-badge" title="ID del precio">
                <span className="record-id-icon" aria-hidden="true">
                  #
                </span>
                {editingPriceItemId}
              </span>
            </div>
          )}
        </div>

        <form
          className="account-create-form in-modal provider-price-item-form"
          onSubmit={onSubmit}
        >
          <section className="account-form-section account-modal-section provider-price-item-section">
            {isGroupProductsPriceList ? (
              <>
                <div className="provider-group-section-header">
                  <div>
                    <h4>ITEM DE GRUPO</h4>
                    <p className="field-hint">
                      Define primero la identidad del item y luego revisa su
                      configuracion final.
                    </p>
                  </div>
                </div>
                <div className="provider-group-item-layout">
                  <div className="provider-group-item-main">
                    <div className="provider-group-item-card">
                      <div className="provider-group-item-card-header">
                        <span className="provider-group-item-step">
                          1. Origen y codigo
                        </span>
                        <p className="field-hint">
                          Escribe un codigo propio o precargalo desde un precio
                          activo existente.
                        </p>
                      </div>
                      <div className="field-group">
                        <div className="provider-group-code-heading">
                          <label>
                            Codigo <span className="required-mark">*</span>
                          </label>
                        </div>
                        <div className="provider-group-code-panel">
                          <input
                            value={priceItemForm.code}
                            onChange={(e) =>
                              onPriceItemFieldChange("code", e.target.value)
                            }
                            placeholder="Ej. GP-SERVICIOS-001"
                            required
                          />
                          <span className="field-hint provider-group-code-hint">
                            Escribe un codigo propio o toma uno existente como
                            base y luego ajustalo si lo necesitas.
                          </span>
                          <div className="provider-group-item-picker">
                            <div className="provider-group-item-picker-header">
                              <strong>Usar producto existente como base</strong>
                              <span className="field-hint">
                                Al seleccionarlo se precargan el codigo y la
                                descripcion, pero ambos siguen siendo editables.
                              </span>
                            </div>
                            <div className="provider-group-code-select-grid">
                              <div className="field-group">
                                <label>Proveedor activo</label>
                                <select
                                  value={groupBaseProviderId}
                                  onChange={(e) =>
                                    onGroupBaseProviderChange(e.target.value)
                                  }
                                >
                                  <option value="">Selecciona un proveedor</option>
                                  {activeProvidersForGroupBase.map((provider) => (
                                    <option key={provider.id} value={provider.id}>
                                      {provider.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="field-group">
                                <label>Lista activa</label>
                                <input
                                  value={groupBaseActiveList?.name || ""}
                                  placeholder="Se detecta automaticamente"
                                  readOnly
                                />
                              </div>
                            </div>
                            <div className="field-group">
                              <label>Producto existente</label>
                              <input
                                className="provider-group-search-input"
                                value={groupBaseItemFilter}
                                onChange={(e) =>
                                  onGroupBaseItemFilterChange(e.target.value)
                                }
                                placeholder="Busca por codigo o descripcion"
                                disabled={
                                  !groupBaseProviderId ||
                                  !groupBaseActiveList ||
                                  loadingGroupBaseProviderItems ||
                                  groupBaseProviderItems.length === 0
                                }
                              />
                            </div>
                            {groupBaseActiveList &&
                            !loadingGroupBaseProviderItems &&
                            filteredGroupBaseProviderItems.length > 0 ? (
                              <div className="provider-group-search-results provider-group-search-results-compact provider-group-search-results-code">
                                {filteredGroupBaseProviderItems.map((item) => (
                                  <button
                                    key={item.id}
                                    type="button"
                                    className={
                                      Number(selectedGroupBaseItem?.id) ===
                                      Number(item.id)
                                        ? "provider-group-search-card provider-group-search-card-selected"
                                        : "provider-group-search-card"
                                    }
                                    onClick={() => onApplyBaseItem(item)}
                                  >
                                    <span className="provider-group-search-copy">
                                      <strong className="provider-group-search-copy-code">
                                        {item.code}
                                      </strong>
                                      <span className="provider-group-search-copy-description">
                                        {item.description || "Sin descripcion"}
                                      </span>
                                      <span className="provider-group-search-copy-price">
                                        {formatPriceValue(
                                          item.price,
                                          item.currency_code,
                                        )}
                                      </span>
                                    </span>
                                    <span className="provider-group-search-btn">
                                      Seleccionar
                                    </span>
                                  </button>
                                ))}
                              </div>
                            ) : null}
                            {groupBaseProviderId &&
                            !loadingGroupBaseProviderItems &&
                            !groupBaseActiveList ? (
                              <p className="field-hint provider-group-search-empty">
                                El proveedor seleccionado no tiene una lista activa
                                compatible con la moneda de esta lista.
                              </p>
                            ) : null}
                            {groupBaseActiveList &&
                            !loadingGroupBaseProviderItems &&
                            groupBaseProviderItems.length === 0 ? (
                              <p className="field-hint provider-group-search-empty">
                                La lista activa de este proveedor no tiene precios
                                activos disponibles.
                              </p>
                            ) : null}
                            {groupBaseActiveList &&
                            !loadingGroupBaseProviderItems &&
                            groupBaseProviderItems.length > 0 &&
                            filteredGroupBaseProviderItems.length === 0 ? (
                              <p className="field-hint provider-group-search-empty">
                                No hay productos que coincidan con ese criterio.
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <aside className="provider-group-item-side provider-group-review-side">
                    <div className="provider-group-item-card">
                      <div className="provider-group-item-card-header">
                        <span className="provider-group-item-step">
                          2. Descripcion
                        </span>
                        <p className="field-hint">
                          Resume claramente el alcance o contenido principal del
                          grupo.
                        </p>
                      </div>
                      <div className="field-group">
                        <label>Descripcion del item de grupo</label>
                        <textarea
                          value={priceItemForm.description}
                          onChange={(e) =>
                            onPriceItemFieldChange(
                              "description",
                              e.target.value,
                            )
                          }
                          placeholder="Describe el item principal del grupo"
                        />
                      </div>
                    </div>
                    <div className="provider-group-item-card provider-group-item-card-accent provider-group-review-card">
                      <div className="provider-group-item-card-header">
                        <span className="provider-group-item-step">
                          3. Revision final
                        </span>
                        <p className="field-hint">
                          El total se completa automaticamente con base en los
                          componentes agregados.
                        </p>
                      </div>
                      <div className="field-group provider-group-review-field">
                        <label>
                          Precio <span className="required-mark">*</span>
                        </label>
                        <input
                          type="text"
                          value={Number(groupPriceItemTotal || 0).toLocaleString(
                            "en-US",
                            {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            },
                          )}
                          required
                          readOnly
                        />
                        <span className="field-hint provider-group-price-hint">
                          El total se calcula automaticamente con la suma de los
                          componentes.
                        </span>
                      </div>
                      <div className="field-group provider-group-review-field">
                        <label>
                          Estado <span className="required-mark">*</span>
                        </label>
                        <select
                          value={priceItemForm.activationStatusId}
                          onChange={(e) =>
                            onPriceItemFieldChange(
                              "activationStatusId",
                              e.target.value,
                            )
                          }
                          required
                        >
                          {catalogs.priceItemStatuses.map((status) => (
                            <option key={status.id} value={status.id}>
                              {status.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </aside>
                </div>
              </>
            ) : (
              <div className="grid-form provider-price-item-grid">
                <div className="field-group">
                  <label>
                    Codigo <span className="required-mark">*</span>
                  </label>
                  <input
                    value={priceItemForm.code}
                    onChange={(e) =>
                      onPriceItemFieldChange("code", e.target.value)
                    }
                    required
                  />
                </div>
                <div className="field-group">
                  <label>
                    Precio <span className="required-mark">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={priceItemForm.price}
                    onChange={(e) =>
                      onPriceItemFieldChange("price", e.target.value)
                    }
                    required
                  />
                </div>
                <div className="field-group">
                  <label>
                    Estado <span className="required-mark">*</span>
                  </label>
                  <select
                    value={priceItemForm.activationStatusId}
                    onChange={(e) =>
                      onPriceItemFieldChange(
                        "activationStatusId",
                        e.target.value,
                      )
                    }
                    required
                  >
                    {catalogs.priceItemStatuses.map((status) => (
                      <option key={status.id} value={status.id}>
                        {status.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </section>

          {isGroupProductsPriceList && (
            <section className="account-form-section account-modal-section provider-price-item-section provider-group-search-section">
              <div className="provider-group-section-header">
                <div>
                  <h4>Componentes del grupo</h4>
                  <p className="field-hint">
                    Agrega productos o servicios propios activos. El total se
                    recalcula automaticamente.
                  </p>
                </div>
                <span className="record-id-badge">
                  {groupPriceItemComponents.length} componentes
                </span>
              </div>
              <div className="provider-group-item-picker">
                <div className="provider-group-item-picker-header">
                  <strong>Agregar componente existente</strong>
                  <span className="field-hint">
                    Selecciona un proveedor activo y usa su lista activa para
                    elegir el producto a agregar.
                  </span>
                </div>
                <div className="provider-group-code-select-grid">
                  <div className="field-group">
                    <label>Proveedor activo</label>
                    <select
                      value={groupComponentProviderId}
                      onChange={(e) =>
                        onGroupComponentProviderChange(e.target.value)
                      }
                    >
                      <option value="">Selecciona un proveedor</option>
                      {activeProvidersForGroupBase.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field-group">
                    <label>Lista activa</label>
                    <input
                      value={groupComponentActiveList?.name || ""}
                      placeholder="Se detecta automaticamente"
                      readOnly
                    />
                  </div>
                </div>
                <div className="field-group">
                  <label>Producto existente</label>
                  <input
                    className="provider-group-search-input"
                    type="text"
                    value={groupComponentItemFilter}
                    onChange={(e) =>
                      onGroupComponentItemFilterChange(e.target.value)
                    }
                    placeholder="Busca por codigo o descripcion"
                    disabled={
                      !groupComponentProviderId ||
                      !groupComponentActiveList ||
                      loadingGroupComponentProviderItems ||
                      availableGroupComponentProviderItems.length === 0
                    }
                  />
                </div>
                {loadingGroupComponentProviderItems ? (
                  <p className="field-hint provider-group-search-empty">
                    Cargando componentes...
                  </p>
                ) : filteredGroupComponentResults.length > 0 ? (
                  <div className="provider-group-search-results provider-group-search-results-compact provider-group-search-results-code">
                    {filteredGroupComponentResults.map((candidate) => (
                      <div
                        key={`component-${candidate.id}`}
                        className="provider-group-search-card"
                        onClick={() => onAddGroupComponent(candidate)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onAddGroupComponent(candidate);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <span className="provider-group-search-copy">
                          <strong className="provider-group-search-copy-code">
                            {candidate.code}
                          </strong>
                          <span className="provider-group-search-copy-description">
                            {candidate.description || "Sin descripcion"}
                          </span>
                          <span className="field-hint provider-group-search-copy-price">
                            {formatPriceValue(
                              candidate.price,
                              candidate.currency_code,
                            )}
                          </span>
                        </span>
                        <button
                          type="button"
                          className="btn-secondary provider-group-search-btn"
                          onClick={(event) => {
                            event.stopPropagation();
                            onAddGroupComponent(candidate);
                          }}
                        >
                          Agregar
                        </button>
                      </div>
                    ))}
                  </div>
                ) : groupComponentProviderId && !groupComponentActiveList ? (
                  <p className="field-hint provider-group-search-empty">
                    El proveedor seleccionado no tiene una lista activa
                    compatible con la moneda de esta lista.
                  </p>
                ) : groupComponentActiveList &&
                  availableGroupComponentProviderItems.length === 0 ? (
                  <p className="field-hint provider-group-search-empty">
                    La lista activa de este proveedor no tiene productos
                    disponibles para agregar.
                  </p>
                ) : groupComponentActiveList && groupComponentItemFilter.trim() ? (
                  <p className="field-hint provider-group-search-empty">
                    No hay productos que coincidan con ese criterio.
                  </p>
                ) : (
                  <p className="field-hint provider-group-search-empty">
                    Selecciona un proveedor activo para ver productos
                    disponibles.
                  </p>
                )}
              </div>

              <div className="provider-group-components-wrap">
                {groupPriceItemComponents.length > 0 ? (
                  <table className="provider-group-components-table">
                    <thead>
                      <tr>
                        <th>Componente</th>
                        <th>Cantidad</th>
                        <th>Precio</th>
                        <th>Subtotal</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {groupPriceItemComponents.map((component, index) => (
                        <tr key={component.componentItemId}>
                          <td>
                            <div className="provider-group-component-copy">
                              <strong>{component.code}</strong>
                              <span>{component.description || "Sin descripcion"}</span>
                              <span className="field-hint">
                                {component.providerName} · {component.priceListName}
                              </span>
                            </div>
                          </td>
                          <td>
                            <div className="provider-group-quantity-control">
                              <button
                                type="button"
                                className="btn-ghost provider-group-quantity-btn"
                                aria-label="Reducir cantidad"
                                title="Reducir cantidad"
                                onClick={() =>
                                  onStepGroupComponentQuantity(
                                    component.componentItemId,
                                    -1,
                                  )
                                }
                              >
                                <span aria-hidden="true">-</span>
                              </button>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                inputMode="decimal"
                                className="provider-group-quantity-input"
                                value={component.quantity}
                                onKeyDown={(e) => {
                                  if (e.key === "ArrowUp") {
                                    e.preventDefault();
                                    onStepGroupComponentQuantity(
                                      component.componentItemId,
                                      1,
                                    );
                                  }
                                  if (e.key === "ArrowDown") {
                                    e.preventDefault();
                                    onStepGroupComponentQuantity(
                                      component.componentItemId,
                                      -1,
                                    );
                                  }
                                }}
                                onChange={(e) =>
                                  onUpdateGroupComponentQuantity(
                                    component.componentItemId,
                                    e.target.value,
                                  )
                                }
                              />
                              <button
                                type="button"
                                className="btn-ghost provider-group-quantity-btn"
                                aria-label="Aumentar cantidad"
                                title="Aumentar cantidad"
                                onClick={() =>
                                  onStepGroupComponentQuantity(
                                    component.componentItemId,
                                    1,
                                  )
                                }
                              >
                                <span aria-hidden="true">+</span>
                              </button>
                            </div>
                          </td>
                          <td>
                            {formatPriceValue(
                              component.price,
                              component.currencyCode,
                            )}
                          </td>
                          <td>
                            {formatPriceValue(
                              Number(component.price || 0) *
                                Number(component.quantity || 0),
                              component.currencyCode,
                            )}
                          </td>
                          <td>
                            <div className="provider-group-row-actions">
                              <button
                                type="button"
                                className="btn-ghost provider-group-order-btn"
                                aria-label="Subir componente"
                                title="Subir componente"
                                disabled={index === 0}
                                onClick={() =>
                                  onMoveGroupComponent(
                                    component.componentItemId,
                                    "up",
                                  )
                                }
                              >
                                <span aria-hidden="true">↑</span>
                              </button>
                              <button
                                type="button"
                                className="btn-ghost provider-group-order-btn"
                                aria-label="Bajar componente"
                                title="Bajar componente"
                                disabled={
                                  index === groupPriceItemComponents.length - 1
                                }
                                onClick={() =>
                                  onMoveGroupComponent(
                                    component.componentItemId,
                                    "down",
                                  )
                                }
                              >
                                <span aria-hidden="true">↓</span>
                              </button>
                              <button
                                type="button"
                                className="btn-ghost provider-group-remove-btn"
                                aria-label="Quitar componente"
                                title="Quitar componente"
                                onClick={() =>
                                  onRemoveGroupComponent(
                                    component.componentItemId,
                                  )
                                }
                              >
                                <svg
                                  aria-hidden="true"
                                  viewBox="0 0 24 24"
                                  className="provider-group-remove-icon"
                                >
                                  <path
                                    d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 6h2v8h-2V9Zm4 0h2v8h-2V9ZM7 9h2v8H7V9Zm1 12a2 2 0 0 1-2-2V8h12v11a2 2 0 0 1-2 2H8Z"
                                    fill="currentColor"
                                  />
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="field-hint provider-group-search-empty provider-group-components-empty">
                    Agrega al menos un componente para poder guardar este{" "}
                    {getCatalogProductTypeLabel("grupo_productos")}.
                  </p>
                )}
              </div>
            </section>
          )}

          {!isGroupProductsPriceList && (
            <section className="account-form-section account-modal-section account-description-section provider-price-item-section">
              <div className="field-group">
                <textarea
                  value={priceItemForm.description}
                  onChange={(e) =>
                    onPriceItemFieldChange("description", e.target.value)
                  }
                  placeholder="Descripción del precio o alcance del ítem"
                />
              </div>
            </section>
          )}

          <div className="modal-buttons" style={{ marginTop: 16 }}>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={savingPriceItem}
            >
              {savingPriceItem
                ? editingPriceItemId
                  ? "Guardando..."
                  : "Creando..."
                : editingPriceItemId
                  ? "Guardar cambios"
                  : "Agregar producto"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}