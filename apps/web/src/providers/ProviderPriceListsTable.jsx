export default function ProviderPriceListsTable({
  providerPriceLists,
  loadingProviderPriceLists,
  visibleProviderPriceLists,
  selectedProviderPriceListId,
  openPriceListMenuId,
  canUpdateProviderPrices,
  getPriceItemTypeLabel,
  selectProviderPriceList,
  togglePriceListMenu,
  runPriceListAction,
  updateProviderPriceListStatus,
}) {
  if (loadingProviderPriceLists) {
    return (
      <p className="field-hint provider-price-list-empty">
        Cargando listas de precios...
      </p>
    );
  }

  if (providerPriceLists.length === 0) {
    return (
      <p className="field-hint provider-price-list-empty">
        Este proveedor todavia no tiene listas de precios registradas.
      </p>
    );
  }

  if (visibleProviderPriceLists.length === 0) {
    return (
      <p className="field-hint provider-price-list-empty">
        No hay listas de precios que coincidan con ese estado.
      </p>
    );
  }

  return (
    <div
      className={
        openPriceListMenuId !== null
          ? "provider-price-list-table-wrap provider-price-lists-compact-wrap provider-price-lists-compact-wrap-menu-open"
          : "provider-price-list-table-wrap provider-price-lists-compact-wrap"
      }
    >
      <table className="provider-price-list-table provider-price-lists-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Nombre</th>
            <th>Tipo</th>
            <th>Estado</th>
            <th>Productos</th>
            <th>Moneda</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {visibleProviderPriceLists.map((priceList) => {
            const isSelected =
              Number(priceList.id) === Number(selectedProviderPriceListId);

            return (
              <tr
                key={priceList.id}
                className={isSelected ? "provider-price-list-row-selected" : ""}
                onClick={() => selectProviderPriceList(priceList.id)}
              >
                <td>{priceList.id}</td>
                <td>{priceList.name}</td>
                <td>
                  <span className="record-id-badge">
                    {getPriceItemTypeLabel(priceList.item_type)}
                  </span>
                </td>
                <td>
                  <span
                    className={
                      Number(priceList.is_active) === 1
                        ? "user-status-badge active"
                        : "user-status-badge inactive"
                    }
                  >
                    {Number(priceList.is_active) === 1 ? "Activa" : "Inactiva"}
                  </span>
                </td>
                <td>
                  {priceList.active_price_items || 0} activos de{" "}
                  {priceList.total_price_items || 0} productos
                </td>
                <td>{priceList.currency_code || "-"}</td>
                <td
                  className="provider-price-list-inline-actions"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="user-kebab-wrap provider-price-lists-kebab-wrap">
                    <button
                      type="button"
                      className="kebab-btn"
                      onClick={() => togglePriceListMenu(priceList.id)}
                      aria-label="Abrir acciones"
                    >
                      ⋮
                    </button>
                    {openPriceListMenuId === priceList.id && (
                      <div className="user-kebab-menu">
                        <button
                          type="button"
                          disabled={
                            !canUpdateProviderPrices ||
                            Number(priceList.is_active) === 1
                          }
                          onClick={() =>
                            runPriceListAction(() =>
                              updateProviderPriceListStatus(priceList, "activa"),
                            )
                          }
                        >
                          Activar
                        </button>
                        <button
                          type="button"
                          disabled={
                            !canUpdateProviderPrices ||
                            Number(priceList.is_active) !== 1
                          }
                          onClick={() =>
                            runPriceListAction(() =>
                              updateProviderPriceListStatus(priceList, "inactiva"),
                            )
                          }
                        >
                          Desactivar
                        </button>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}