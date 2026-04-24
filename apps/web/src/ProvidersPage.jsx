import { ConfirmationModal } from "./AppModals";
import ProviderFormModal from "./providers/ProviderFormModal";
import ProviderPriceItemModal from "./providers/ProviderPriceItemModal";
import ProviderPriceListModal from "./providers/ProviderPriceListModal";
import ProviderPriceListCreateModal from "./providers/ProviderPriceListCreateModal";
import { useProvidersPage } from "./providers/useProvidersPage";

function ProvidersPage({ currentUser }) {
  const {
    providerStatusFilter,
    setProviderStatusFilter,
    providerQuery,
    setProviderQuery,
    providersPerPage,
    setProvidersPerPage,
    providersPage,
    setProvidersPage,
    showProviderModal,
    editingProviderId,
    editProviderAudit,
    openProviderMenuId,
    confirmProviderStatusAction,
    savingProvider,
    catalogs,
    error,
    success,
    canCreateProviders,
    canUpdateProviders,
    canReadProviderPrices,
    canCreateProviderPrices,
    canUpdateProviderPrices,
    form,
    providerStatusCounts,
    totalProvidersCount,
    visibleProviders,
    pagedProviders,
    totalProviderPages,
    openCreateProviderModal,
    openEditProviderModal,
    closeProviderModal,
    isProviderActive,
    isProviderInactive,
    getProviderStatusLabel,
    getProviderStatusBadgeClass,
    toggleProviderMenu,
    runProviderAction,
    openProviderStatusConfirmation,
    closeProviderStatusConfirmation,
    confirmSelectedProviderStatusChange,
    getProviderStatusIconBadgeClassById,
    toggleProviderSort,
    getProviderSortArrow,
    formatDateTime,
    formatPriceValue,
    getProviderStatusConfirmationMeta,
    saveProvider,
    updateProviderFormField,
    providerPriceListModalProvider,
    currentProviderForPriceList,
    providerPriceLists,
    loadingProviderPriceLists,
    selectedProviderPriceList,
    selectedProviderPriceListId,
    providerPriceListItems,
    loadingProviderPriceListItems,
    showProviderPriceListCreateModal,
    showPriceItemModal,
    editingPriceItemId,
    priceListStatusFilter,
    priceListStatusCounts,
    priceItemStatusFilter,
    priceItemStatusCounts,
    priceItemQuery,
    openPriceListMenuId,
    openPriceItemMenuId,
    confirmPriceItemStatusAction,
    savingProviderPriceList,
    savingPriceItem,
    exportingPriceList,
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
    providerPriceListForm,
    visibleProviderPriceLists,
    visibleProviderPriceListItems,
    pagedProviderPriceListItems,
    priceItemsPage,
    priceItemsPerPage,
    totalPriceItemPages,
    isGroupProductsPriceList,
    getCatalogProductTypeLabel,
    getPriceItemTypeLabel,
    getPriceItemStatusBadgeClass,
    getPriceItemStatusLabel,
    getPriceItemSortArrow,
    isPriceItemActive,
    isPriceItemInactive,
    openProviderPriceListModal,
    closeProviderPriceListModal,
    openCreateProviderPriceListModal,
    closeProviderPriceListCreateModal,
    saveProviderPriceList,
    openCreatePriceItemModal,
    openEditPriceItemModal,
    closePriceItemModal,
    togglePriceItemMenu,
    togglePriceListMenu,
    runPriceListAction,
    runPriceItemAction,
    updateProviderPriceListStatus,
    exportProviderPriceListToExcel,
    savePriceItem,
    openPriceItemStatusConfirmation,
    closePriceItemStatusConfirmation,
    confirmSelectedPriceItemStatusChange,
    getPriceItemStatusConfirmationMeta,
    selectProviderPriceList,
    setPriceListStatusFilter,
    setPriceItemStatusFilter,
    setPriceItemQuery,
    setPriceItemsPage,
    updateProviderPriceListFormField,
    updatePriceItemFormField,
    handleGroupBaseProviderChange,
    handleGroupBaseItemFilterChange,
    handleGroupComponentProviderChange,
    handleGroupComponentItemFilterChange,
    applyBaseItemToGroup,
    addGroupComponent,
    stepGroupComponentQuantity,
    updateGroupComponentQuantity,
    moveGroupComponent,
    removeGroupComponent,
    togglePriceItemSort,
  } = useProvidersPage({ currentUser });

  return (
    <section className="panel">
      <ConfirmationModal
        isOpen={Boolean(confirmProviderStatusAction)}
        title={getProviderStatusConfirmationMeta().title}
        message={getProviderStatusConfirmationMeta().message}
        onConfirm={confirmSelectedProviderStatusChange}
        onCancel={closeProviderStatusConfirmation}
        confirmText={getProviderStatusConfirmationMeta().confirmText}
        isDangerous={getProviderStatusConfirmationMeta().isDangerous}
        overlayClassName="modal-overlay-elevated"
      />

      <ConfirmationModal
        isOpen={Boolean(confirmPriceItemStatusAction)}
        title={getPriceItemStatusConfirmationMeta().title}
        message={getPriceItemStatusConfirmationMeta().message}
        onConfirm={confirmSelectedPriceItemStatusChange}
        onCancel={closePriceItemStatusConfirmation}
        confirmText={getPriceItemStatusConfirmationMeta().confirmText}
        isDangerous={getPriceItemStatusConfirmationMeta().isDangerous}
        overlayClassName="modal-overlay-elevated"
      />

      <div className="roles-page-header">
        <div className="roles-page-header-left">
          <div className="module-title-with-icon">
            <h2>Proveedores</h2>
            <span
              className="module-title-icon module-title-icon-providers"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M4.75 5A1.75 1.75 0 0 0 3 6.75v10.5C3 18.22 3.78 19 4.75 19h14.5c.97 0 1.75-.78 1.75-1.75V6.75C21 5.78 20.22 5 19.25 5zm.25 1.5h14a.5.5 0 0 1 .5.5V8H4.5v-1a.5.5 0 0 1 .5-.5m-.5 3h15v7.75a.25.25 0 0 1-.25.25H4.75a.25.25 0 0 1-.25-.25z" />
                <path d="M7 11h4v1.5H7zm0 3h6v1.5H7zm8-3h2v4h-2z" />
              </svg>
            </span>
          </div>
          <p className="roles-subtitle">
            Gestiona proveedores y las listas de precios asociadas a cada uno
          </p>
        </div>
        {canCreateProviders && (
          <button
            type="button"
            className="btn-primary"
            onClick={openCreateProviderModal}
          >
            + Crear proveedor
          </button>
        )}
      </div>

      <div className="roles-pills-bar accounts-pills-bar-row">
        <div
          className="accounts-status-pills"
          role="group"
          aria-label="Filtrar proveedores por estado"
        >
          <button
            type="button"
            className={
              providerStatusFilter === "active"
                ? "status-filter-pill status-filter-pill-active is-selected"
                : "status-filter-pill status-filter-pill-active"
            }
            aria-pressed={providerStatusFilter === "active"}
            onClick={() => setProviderStatusFilter("active")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Activos</span>
            <span className="status-filter-pill-count">
              {providerStatusCounts.active}
            </span>
          </button>
          <button
            type="button"
            className={
              providerStatusFilter === "inactive"
                ? "status-filter-pill status-filter-pill-inactive is-selected"
                : "status-filter-pill status-filter-pill-inactive"
            }
            aria-pressed={providerStatusFilter === "inactive"}
            onClick={() => setProviderStatusFilter("inactive")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Desactivados</span>
            <span className="status-filter-pill-count">
              {providerStatusCounts.inactive}
            </span>
          </button>
          <button
            type="button"
            className={
              providerStatusFilter === "all"
                ? "status-filter-pill status-filter-pill-all is-selected"
                : "status-filter-pill status-filter-pill-all"
            }
            aria-pressed={providerStatusFilter === "all"}
            onClick={() => setProviderStatusFilter("all")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Todos</span>
            <span className="status-filter-pill-count">
              {totalProvidersCount}
            </span>
          </button>
        </div>
        <input
          className="accounts-search-inline"
          type="text"
          placeholder="Buscar por ID, nombre, país, lista activa o estado"
          value={providerQuery}
          onChange={(e) => setProviderQuery(e.target.value)}
        />
      </div>

      <ProviderFormModal
        isOpen={showProviderModal}
        editingProviderId={editingProviderId}
        form={form}
        catalogs={catalogs}
        editProviderAudit={editProviderAudit}
        savingProvider={savingProvider}
        onClose={closeProviderModal}
        onSubmit={saveProvider}
        onChange={updateProviderFormField}
        getProviderStatusIconBadgeClassById={getProviderStatusIconBadgeClassById}
        formatDateTime={formatDateTime}
      />

      <ProviderPriceListModal
        isOpen={Boolean(providerPriceListModalProvider)}
        providerState={{
          providerPriceListModalProvider,
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
        }}
        permissions={{
          canCreateProviderPrices,
          canReadProviderPrices,
          canUpdateProviderPrices,
        }}
        helpers={{
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
        }}
        handlers={{
          onClose: closeProviderPriceListModal,
          setPriceListStatusFilter,
          openCreateProviderPriceListModal,
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
        }}
      />

      <ProviderPriceListCreateModal
        isOpen={showProviderPriceListCreateModal}
        provider={providerPriceListModalProvider}
        form={providerPriceListForm}
        catalogs={catalogs}
        saving={savingProviderPriceList}
        onClose={closeProviderPriceListCreateModal}
        onSubmit={saveProviderPriceList}
        onChange={updateProviderPriceListFormField}
      />

      <ProviderPriceItemModal
        isOpen={showPriceItemModal}
        providerState={{
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
        }}
        catalogs={catalogs}
        savingPriceItem={savingPriceItem}
        helpers={{
          formatPriceValue,
          getCatalogProductTypeLabel,
        }}
        handlers={{
          onClose: closePriceItemModal,
          onSubmit: savePriceItem,
          onPriceItemFieldChange: updatePriceItemFormField,
          onGroupBaseProviderChange: handleGroupBaseProviderChange,
          onGroupBaseItemFilterChange: handleGroupBaseItemFilterChange,
          onApplyBaseItem: applyBaseItemToGroup,
          onGroupComponentProviderChange: handleGroupComponentProviderChange,
          onGroupComponentItemFilterChange: handleGroupComponentItemFilterChange,
          onAddGroupComponent: addGroupComponent,
          onStepGroupComponentQuantity: stepGroupComponentQuantity,
          onUpdateGroupComponentQuantity: updateGroupComponentQuantity,
          onMoveGroupComponent: moveGroupComponent,
          onRemoveGroupComponent: removeGroupComponent,
        }}
      />

      {error && <div className="toast toast-error">{error}</div>}
      {success && <div className="toast toast-success">{success}</div>}

      <table>
        <thead>
          <tr>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleProviderSort("id")}
              >
                ID <span>{getProviderSortArrow("id")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleProviderSort("nombre")}
              >
                Nombre <span>{getProviderSortArrow("nombre")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleProviderSort("pais")}
              >
                Pais <span>{getProviderSortArrow("pais")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleProviderSort("lista_activa")}
              >
                Lista activa <span>{getProviderSortArrow("lista_activa")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleProviderSort("estado")}
              >
                Estado <span>{getProviderSortArrow("estado")}</span>
              </button>
            </th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {visibleProviders.length > 0 ? (
            pagedProviders.map((provider) => (
              <tr key={provider.id}>
                <td>{provider.id}</td>
                <td>{provider.name}</td>
                <td>{provider.country}</td>
                <td>
                  {provider.active_price_list_name ? (
                    <span className="record-id-badge provider-active-price-list-badge">
                      {provider.active_price_list_name}
                    </span>
                  ) : (
                    <span className="user-status-badge inactive">
                      Sin lista activa
                    </span>
                  )}
                </td>
                <td>
                  <span className={getProviderStatusBadgeClass(provider)}>
                    {getProviderStatusLabel(provider)}
                  </span>
                </td>
                <td className="accounts-actions-cell">
                  <div className="user-kebab-wrap providers-kebab-wrap">
                    <button
                      type="button"
                      className="kebab-btn"
                      onClick={() => toggleProviderMenu(provider.id)}
                      aria-label="Abrir acciones"
                    >
                      ⋮
                    </button>
                    {openProviderMenuId === provider.id && (
                      <div className="user-kebab-menu">
                        <button
                          type="button"
                          disabled={!canUpdateProviders}
                          onClick={() =>
                            runProviderAction(() =>
                              openEditProviderModal(provider.id),
                            )
                          }
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          disabled={
                            !canUpdateProviders || isProviderActive(provider)
                          }
                          onClick={() =>
                            openProviderStatusConfirmation(provider, "activado")
                          }
                        >
                          Activar
                        </button>
                        <button
                          type="button"
                          disabled={
                            !canUpdateProviders || isProviderInactive(provider)
                          }
                          onClick={() =>
                            openProviderStatusConfirmation(
                              provider,
                              "desactivado",
                            )
                          }
                        >
                          Desactivar
                        </button>
                        {canReadProviderPrices && (
                          <button
                            type="button"
                            onClick={() =>
                              runProviderAction(() =>
                                openProviderPriceListModal(provider),
                              )
                            }
                          >
                            Listas de precios
                          </button>
                        )}
                        {canCreateProviderPrices && (
                          <button
                            type="button"
                            onClick={() =>
                              runProviderAction(async () => {
                                await openProviderPriceListModal(provider);
                                openCreateProviderPriceListModal(provider);
                              })
                            }
                          >
                            Crear lista de precios
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={6} className="empty-state">
                No hay proveedores que coincidan con los filtros
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {visibleProviders.length > 0 && (
        <div className="users-pagination">
          <div className="users-pagination-left">
            <span className="users-pagination-info">
              {(providersPage - 1) * providersPerPage + 1}–
              {Math.min(
                providersPage * providersPerPage,
                visibleProviders.length,
              )}{" "}
              de {visibleProviders.length}
            </span>
          </div>
          <div className="users-pagination-center">
            <button
              type="button"
              className="users-page-btn"
              disabled={providersPage === 1}
              onClick={() => setProvidersPage((page) => page - 1)}
            >
              ‹
            </button>
            <span className="users-pagination-pages">
              {providersPage} / {totalProviderPages}
            </span>
            <button
              type="button"
              className="users-page-btn"
              disabled={providersPage === totalProviderPages}
              onClick={() => setProvidersPage((page) => page + 1)}
            >
              ›
            </button>
          </div>
          <div className="users-pagination-right">
            <span className="users-pagination-label">Por página:</span>
            {[10, 50, 100].map((n) => (
              <button
                key={n}
                type="button"
                className={`users-perpage-btn${providersPerPage === n ? " is-active" : ""}`}
                onClick={() => setProvidersPerPage(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export default ProvidersPage;
