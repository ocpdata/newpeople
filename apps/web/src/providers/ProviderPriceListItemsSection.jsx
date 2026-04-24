export default function ProviderPriceListItemsSection({
  selectedProviderPriceList,
  providerPriceListItems,
  loadingProviderPriceListItems,
  visibleProviderPriceListItems,
  priceItemStatusFilter,
  priceItemStatusCounts,
  priceItemQuery,
  openPriceItemMenuId,
  pagedProviderPriceListItems,
  priceItemsPage,
  priceItemsPerPage,
  totalPriceItemPages,
  canUpdateProviderPrices,
  formatPriceValue,
  getPriceItemStatusBadgeClass,
  getPriceItemStatusLabel,
  getPriceItemSortArrow,
  isPriceItemActive,
  isPriceItemInactive,
  setPriceItemStatusFilter,
  setPriceItemQuery,
  togglePriceItemSort,
  togglePriceItemMenu,
  runPriceItemAction,
  openEditPriceItemModal,
  openPriceItemStatusConfirmation,
  setPriceItemsPage,
}) {
  if (!selectedProviderPriceList) {
    return null;
  }

  return (
    <>
      <div className="provider-price-list-selection-header">
        <div>
          <h4>Precios de {selectedProviderPriceList.name}</h4>
        </div>
        <span
          className={
            Number(selectedProviderPriceList.is_active) === 1
              ? "user-status-badge active"
              : "user-status-badge inactive"
          }
        >
          {Number(selectedProviderPriceList.is_active) === 1 ? "Activa" : "Inactiva"}
        </span>
      </div>

      {!loadingProviderPriceListItems && providerPriceListItems.length > 0 && (
        <div className="roles-pills-bar accounts-pills-bar-row provider-price-items-toolbar">
          <div
            className="accounts-status-pills"
            role="group"
            aria-label="Filtrar precios por estado"
          >
            <button
              type="button"
              className={
                priceItemStatusFilter === "all"
                  ? "status-filter-pill status-filter-pill-all is-selected"
                  : "status-filter-pill status-filter-pill-all"
              }
              aria-pressed={priceItemStatusFilter === "all"}
              onClick={() => setPriceItemStatusFilter("all")}
            >
              <span className="status-filter-pill-text">Todos</span>
              <span className="status-filter-pill-count">{priceItemStatusCounts.all}</span>
            </button>
            <button
              type="button"
              className={
                priceItemStatusFilter === "active"
                  ? "status-filter-pill status-filter-pill-active is-selected"
                  : "status-filter-pill status-filter-pill-active"
              }
              aria-pressed={priceItemStatusFilter === "active"}
              onClick={() => setPriceItemStatusFilter("active")}
            >
              <span className="status-filter-pill-text">Activos</span>
              <span className="status-filter-pill-count">{priceItemStatusCounts.active}</span>
            </button>
            <button
              type="button"
              className={
                priceItemStatusFilter === "inactive"
                  ? "status-filter-pill status-filter-pill-inactive is-selected"
                  : "status-filter-pill status-filter-pill-inactive"
              }
              aria-pressed={priceItemStatusFilter === "inactive"}
              onClick={() => setPriceItemStatusFilter("inactive")}
            >
              <span className="status-filter-pill-text">Inactivos</span>
              <span className="status-filter-pill-count">{priceItemStatusCounts.inactive}</span>
            </button>
          </div>
          <input
            className="accounts-search-inline"
            type="text"
            placeholder="Filtrar por ID, código, descripción, precio o estado"
            value={priceItemQuery}
            onChange={(e) => setPriceItemQuery(e.target.value)}
          />
        </div>
      )}

      {loadingProviderPriceListItems ? (
        <p className="field-hint provider-price-list-empty">
          Cargando precios de la lista...
        </p>
      ) : visibleProviderPriceListItems.length > 0 ? (
        <>
          <div
            className={
              openPriceItemMenuId !== null
                ? "provider-price-list-table-wrap provider-price-items-table-wrap-menu-open"
                : "provider-price-list-table-wrap"
            }
          >
            <table className="provider-price-list-table">
              <thead>
                <tr>
                  <th>
                    <button
                      type="button"
                      className="provider-price-list-sort-btn"
                      onClick={() => togglePriceItemSort("id")}
                    >
                      ID <span>{getPriceItemSortArrow("id")}</span>
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="provider-price-list-sort-btn"
                      onClick={() => togglePriceItemSort("codigo")}
                    >
                      Codigo <span>{getPriceItemSortArrow("codigo")}</span>
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="provider-price-list-sort-btn"
                      onClick={() => togglePriceItemSort("descripcion")}
                    >
                      Descripcion <span>{getPriceItemSortArrow("descripcion")}</span>
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="provider-price-list-sort-btn"
                      onClick={() => togglePriceItemSort("precio")}
                    >
                      Precio <span>{getPriceItemSortArrow("precio")}</span>
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="provider-price-list-sort-btn"
                      onClick={() => togglePriceItemSort("estado")}
                    >
                      Estado <span>{getPriceItemSortArrow("estado")}</span>
                    </button>
                  </th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {pagedProviderPriceListItems.map((item) => (
                  <tr key={item.id}>
                    <td>{item.id}</td>
                    <td>{item.code}</td>
                    <td>{item.description || "-"}</td>
                    <td>{formatPriceValue(item.price, item.currency_code)}</td>
                    <td>
                      <span className={getPriceItemStatusBadgeClass(item)}>
                        {getPriceItemStatusLabel(item)}
                      </span>
                    </td>
                    <td className="accounts-actions-cell">
                      <div className="user-kebab-wrap provider-price-items-kebab-wrap">
                        <button
                          type="button"
                          className="kebab-btn"
                          onClick={() => togglePriceItemMenu(item.id)}
                          aria-label="Abrir acciones"
                        >
                          ⋮
                        </button>
                        {openPriceItemMenuId === item.id && (
                          <div className="user-kebab-menu">
                            <button
                              type="button"
                              disabled={!canUpdateProviderPrices}
                              onClick={() =>
                                runPriceItemAction(() => openEditPriceItemModal(item))
                              }
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              disabled={
                                !canUpdateProviderPrices || isPriceItemActive(item)
                              }
                              onClick={() =>
                                openPriceItemStatusConfirmation(item, "activo")
                              }
                            >
                              Activar
                            </button>
                            <button
                              type="button"
                              disabled={
                                !canUpdateProviderPrices || isPriceItemInactive(item)
                              }
                              onClick={() =>
                                openPriceItemStatusConfirmation(item, "inactivo")
                              }
                            >
                              Desactivar
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="users-pagination provider-price-items-pagination">
            <div className="users-pagination-left">
              <span className="users-pagination-info">
                {(priceItemsPage - 1) * priceItemsPerPage + 1}–
                {Math.min(
                  priceItemsPage * priceItemsPerPage,
                  visibleProviderPriceListItems.length,
                )}{" "}
                de {visibleProviderPriceListItems.length}
              </span>
            </div>
            <div className="users-pagination-center">
              <button
                type="button"
                className="users-page-btn"
                disabled={priceItemsPage === 1}
                onClick={() => setPriceItemsPage((page) => page - 1)}
              >
                ‹
              </button>
              <span className="users-pagination-pages">
                {priceItemsPage} / {totalPriceItemPages}
              </span>
              <button
                type="button"
                className="users-page-btn"
                disabled={priceItemsPage === totalPriceItemPages}
                onClick={() => setPriceItemsPage((page) => page + 1)}
              >
                ›
              </button>
            </div>
            <div className="users-pagination-right">
              <span className="users-pagination-label">Por página:</span>
              <button
                type="button"
                className="users-perpage-btn is-active"
                disabled
              >
                {priceItemsPerPage}
              </button>
            </div>
          </div>
        </>
      ) : (
        <p className="field-hint provider-price-list-empty">
          {providerPriceListItems.length > 0
            ? priceItemQuery.trim()
              ? "No hay precios que coincidan con el filtro aplicado."
              : "No hay precios para el estado seleccionado."
            : "La lista seleccionada todavia no tiene precios registrados."}
        </p>
      )}
    </>
  );
}