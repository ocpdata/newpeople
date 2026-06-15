import ProviderPriceListItemsSection from "./ProviderPriceListItemsSection";
import ProviderPriceListsTable from "./ProviderPriceListsTable";

export default function ProviderPriceListModal({
  isOpen,
  providerState,
  permissions,
  helpers,
  handlers,
}) {
  if (!isOpen || !providerState.providerPriceListModalProvider) {
    return null;
  }

  const {
    currentProviderForPriceList,
    providerPriceLists,
    loadingProviderPriceLists,
    selectedProviderPriceList,
    selectedProviderPriceListId,
    visibleProviderPriceLists,
    providerPriceListItems,
    loadingProviderPriceListItems,
    visibleProviderPriceListItems,
    priceListStatusFilter,
    priceListStatusCounts,
    priceItemStatusFilter,
    priceItemStatusCounts,
    priceItemQuery,
    openPriceListMenuId,
    openPriceItemMenuId,
    pagedProviderPriceListItems,
    priceItemsPage,
    priceItemsPerPage,
    totalPriceItemPages,
  } = providerState;

  const {
    canCreateProviderPrices,
    canReadProviderPrices,
    canUpdateProviderPrices,
  } = permissions;

  const {
    getProviderStatusBadgeClass,
    getProviderStatusLabel,
    isProviderActive,
    getPriceItemTypeLabel,
    formatPriceValue,
    getPriceItemStatusBadgeClass,
    getPriceItemStatusLabel,
    getPriceItemSortArrow,
    isPriceItemActive,
    isPriceItemInactive,
  } = helpers;

  const {
    onClose,
    setPriceListStatusFilter,
    openCreateProviderPriceListModal,
    openEditProviderPriceListModal,
    exportProviderPriceListToExcel,
    exportingPriceList,
    openCreatePriceItemModal,
    selectProviderPriceList,
    togglePriceListMenu,
    runPriceListAction,
    updateProviderPriceListStatus,
    setPriceItemStatusFilter,
    setPriceItemQuery,
    togglePriceItemSort,
    togglePriceItemMenu,
    runPriceItemAction,
    openEditPriceItemModal,
    openPriceItemStatusConfirmation,
    setPriceItemsPage,
  } = handlers;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-dialog modal-dialog-account modal-dialog-provider-prices"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="opportunity-modal-header-copy">
            <h3 className="modal-title">Listas de precios</h3>
            <p className="field-hint opportunity-modal-subtitle">
              {currentProviderForPriceList?.name || "Proveedor"} ·{" "}
              {providerPriceLists.length} listas
            </p>
          </div>
          <div className="opportunity-modal-header-meta">
            <span className="record-id-badge" title="ID del proveedor">
              <span className="record-id-icon" aria-hidden="true">
                #
              </span>
              {currentProviderForPriceList?.id}
            </span>
            <span
              className={getProviderStatusBadgeClass(
                currentProviderForPriceList || {},
              )}
            >
              {getProviderStatusLabel(currentProviderForPriceList || {})}
            </span>
          </div>
        </div>

        <div className="provider-price-list-toolbar">
          {!loadingProviderPriceLists && providerPriceLists.length > 0 && (
            <div className="provider-price-lists-toolbar">
              <div
                className="accounts-status-pills"
                role="group"
                aria-label="Filtrar listas de precios por estado"
              >
                <button
                  type="button"
                  className={
                    priceListStatusFilter === "all"
                      ? "status-filter-pill status-filter-pill-all is-selected"
                      : "status-filter-pill status-filter-pill-all"
                  }
                  aria-pressed={priceListStatusFilter === "all"}
                  onClick={() => setPriceListStatusFilter("all")}
                >
                  <span className="status-filter-pill-text">Todas</span>
                  <span className="status-filter-pill-count">
                    {priceListStatusCounts.all}
                  </span>
                </button>
                <button
                  type="button"
                  className={
                    priceListStatusFilter === "active"
                      ? "status-filter-pill status-filter-pill-active is-selected"
                      : "status-filter-pill status-filter-pill-active"
                  }
                  aria-pressed={priceListStatusFilter === "active"}
                  onClick={() => setPriceListStatusFilter("active")}
                >
                  <span className="status-filter-pill-text">Activas</span>
                  <span className="status-filter-pill-count">
                    {priceListStatusCounts.active}
                  </span>
                </button>
                <button
                  type="button"
                  className={
                    priceListStatusFilter === "inactive"
                      ? "status-filter-pill status-filter-pill-inactive is-selected"
                      : "status-filter-pill status-filter-pill-inactive"
                  }
                  aria-pressed={priceListStatusFilter === "inactive"}
                  onClick={() => setPriceListStatusFilter("inactive")}
                >
                  <span className="status-filter-pill-text">Inactivas</span>
                  <span className="status-filter-pill-count">
                    {priceListStatusCounts.inactive}
                  </span>
                </button>
              </div>
            </div>
          )}
          <div className="provider-price-list-actions">
            {canCreateProviderPrices && (
              <div className="provider-price-list-action-item">
                <button
                  type="button"
                  className="provider-price-list-icon-btn"
                  onClick={() => openCreateProviderPriceListModal()}
                  aria-label="Crear lista de precios"
                  title="Crear lista de precios"
                >
                  <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                    <path d="M12 5a.75.75 0 0 1 .75.75v5.5h5.5a.75.75 0 0 1 0 1.5h-5.5v5.5a.75.75 0 0 1-1.5 0v-5.5h-5.5a.75.75 0 0 1 0-1.5h5.5v-5.5A.75.75 0 0 1 12 5Z" />
                  </svg>
                </button>
                <span className="provider-price-list-action-label">Crear lista</span>
              </div>
            )}
            {!loadingProviderPriceListItems &&
              selectedProviderPriceList &&
              visibleProviderPriceListItems.length > 0 &&
              canReadProviderPrices && (
                <div className="provider-price-list-action-item">
                  <button
                    type="button"
                    className="provider-price-list-icon-btn"
                    onClick={exportProviderPriceListToExcel}
                    disabled={exportingPriceList}
                    aria-label={
                      exportingPriceList
                        ? "Exportando a Excel"
                        : "Exportar a Excel"
                    }
                    title={
                      exportingPriceList
                        ? "Exportando a Excel"
                        : "Exportar a Excel"
                    }
                  >
                    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                      <path d="M12 4a.75.75 0 0 1 .75.75v8.69l2.72-2.72a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 1 1 1.06-1.06l2.72 2.72V4.75A.75.75 0 0 1 12 4Z" />
                      <path d="M5.75 16a.75.75 0 0 1 .75.75v1.5c0 .14.11.25.25.25h10.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 17.25 20H6.75A1.75 1.75 0 0 1 5 18.25v-1.5a.75.75 0 0 1 .75-.75Z" />
                    </svg>
                  </button>
                  <span className="provider-price-list-action-label">
                    {exportingPriceList ? "Exportando" : "Exportar"}
                  </span>
                </div>
              )}
            {canCreateProviderPrices &&
              selectedProviderPriceList &&
              isProviderActive(currentProviderForPriceList || {}) && (
                <div className="provider-price-list-action-item">
                  <button
                    type="button"
                    className="provider-price-list-icon-btn provider-price-list-icon-btn-primary"
                    onClick={openCreatePriceItemModal}
                    aria-label="Agregar producto"
                    title="Agregar producto"
                  >
                    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                      <path d="M6.75 5A1.75 1.75 0 0 0 5 6.75v10.5C5 18.22 5.78 19 6.75 19h10.5c.97 0 1.75-.78 1.75-1.75V6.75C19 5.78 18.22 5 17.25 5zm0 1.5h10.5a.25.25 0 0 1 .25.25v10.5a.25.25 0 0 1-.25.25H6.75a.25.25 0 0 1-.25-.25V6.75c0-.14.11-.25.25-.25Z" />
                      <path d="M12 8.25a.75.75 0 0 1 .75.75v2.25H15a.75.75 0 0 1 0 1.5h-2.25V15a.75.75 0 0 1-1.5 0v-2.25H9a.75.75 0 0 1 0-1.5h2.25V9a.75.75 0 0 1 .75-.75Z" />
                    </svg>
                  </button>
                  <span className="provider-price-list-action-label">
                    Agregar producto
                  </span>
                </div>
              )}
          </div>
        </div>

        <ProviderPriceListsTable
          providerPriceLists={providerPriceLists}
          loadingProviderPriceLists={loadingProviderPriceLists}
          visibleProviderPriceLists={visibleProviderPriceLists}
          selectedProviderPriceListId={selectedProviderPriceListId}
          openPriceListMenuId={openPriceListMenuId}
          canUpdateProviderPrices={canUpdateProviderPrices}
          getPriceItemTypeLabel={getPriceItemTypeLabel}
          selectProviderPriceList={selectProviderPriceList}
          togglePriceListMenu={togglePriceListMenu}
          runPriceListAction={runPriceListAction}
          openEditProviderPriceListModal={openEditProviderPriceListModal}
          updateProviderPriceListStatus={updateProviderPriceListStatus}
        />

        <ProviderPriceListItemsSection
          selectedProviderPriceList={selectedProviderPriceList}
          providerPriceListItems={providerPriceListItems}
          loadingProviderPriceListItems={loadingProviderPriceListItems}
          visibleProviderPriceListItems={visibleProviderPriceListItems}
          priceItemStatusFilter={priceItemStatusFilter}
          priceItemStatusCounts={priceItemStatusCounts}
          priceItemQuery={priceItemQuery}
          openPriceItemMenuId={openPriceItemMenuId}
          pagedProviderPriceListItems={pagedProviderPriceListItems}
          priceItemsPage={priceItemsPage}
          priceItemsPerPage={priceItemsPerPage}
          totalPriceItemPages={totalPriceItemPages}
          canUpdateProviderPrices={canUpdateProviderPrices}
          formatPriceValue={formatPriceValue}
          getPriceItemStatusBadgeClass={getPriceItemStatusBadgeClass}
          getPriceItemStatusLabel={getPriceItemStatusLabel}
          getPriceItemSortArrow={getPriceItemSortArrow}
          isPriceItemActive={isPriceItemActive}
          isPriceItemInactive={isPriceItemInactive}
          setPriceItemStatusFilter={setPriceItemStatusFilter}
          setPriceItemQuery={setPriceItemQuery}
          togglePriceItemSort={togglePriceItemSort}
          togglePriceItemMenu={togglePriceItemMenu}
          runPriceItemAction={runPriceItemAction}
          openEditPriceItemModal={openEditPriceItemModal}
          openPriceItemStatusConfirmation={openPriceItemStatusConfirmation}
          setPriceItemsPage={setPriceItemsPage}
        />

        <div className="modal-buttons" style={{ marginTop: 16 }}>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
