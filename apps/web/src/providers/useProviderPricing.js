import { useProviderPriceItems } from "./useProviderPriceItems";
import { useProviderPriceLists } from "./useProviderPriceLists";

export function useProviderPricing({
  providers,
  catalogs,
  formatPriceValue,
  reloadProviders,
  setError,
  setSuccess,
}) {
  const priceLists = useProviderPriceLists({
    providers,
    catalogs,
    reloadProviders,
    setError,
    setSuccess,
  });

  const priceItems = useProviderPriceItems({
    providers,
    catalogs,
    providerPriceListModalProvider: priceLists.providerPriceListModalProvider,
    currentProviderForPriceList: priceLists.currentProviderForPriceList,
    selectedProviderPriceList: priceLists.selectedProviderPriceList,
    selectedProviderPriceListId: priceLists.selectedProviderPriceListId,
    providerPriceListItems: priceLists.providerPriceListItems,
    loadProviderPriceLists: priceLists.loadProviderPriceLists,
    loadProviderPriceListItems: priceLists.loadProviderPriceListItems,
    refreshProviderPriceLists: priceLists.refreshProviderPriceLists,
    reloadProviders,
    formatPriceValue,
    setError,
    setSuccess,
  });

  async function openProviderPriceListModal(provider, preferredListId = null) {
    priceItems.setPriceItemStatusFilter("all");
    await priceLists.openProviderPriceListModal(provider, preferredListId);
  }

  async function selectProviderPriceList(listId) {
    await priceLists.selectProviderPriceList(listId);
    priceItems.setPriceItemStatusFilter("all");
  }

  function closeProviderPriceListModal() {
    priceItems.setPriceItemStatusFilter("all");
    priceItems.resetPriceItemUiState();
    priceLists.closeProviderPriceListModal(
      priceItems.savingPriceItem || priceLists.savingProviderPriceList,
    );
  }

  return {
    providerPriceListModalProvider: priceLists.providerPriceListModalProvider,
    currentProviderForPriceList: priceLists.currentProviderForPriceList,
    providerPriceLists: priceLists.providerPriceLists,
    loadingProviderPriceLists: priceLists.loadingProviderPriceLists,
    selectedProviderPriceList: priceLists.selectedProviderPriceList,
    selectedProviderPriceListId: priceLists.selectedProviderPriceListId,
    providerPriceListItems: priceLists.providerPriceListItems,
    loadingProviderPriceListItems: priceLists.loadingProviderPriceListItems,
    showProviderPriceListCreateModal: priceLists.showProviderPriceListCreateModal,
    showPriceItemModal: priceItems.showPriceItemModal,
    editingPriceItemId: priceItems.editingPriceItemId,
    priceListStatusFilter: priceLists.priceListStatusFilter,
    priceListStatusCounts: priceLists.priceListStatusCounts,
    priceItemStatusFilter: priceItems.priceItemStatusFilter,
    priceItemStatusCounts: priceItems.priceItemStatusCounts,
    priceItemQuery: priceItems.priceItemQuery,
    openPriceListMenuId: priceLists.openPriceListMenuId,
    openPriceItemMenuId: priceItems.openPriceItemMenuId,
    confirmPriceItemStatusAction: priceItems.confirmPriceItemStatusAction,
    savingProviderPriceList: priceLists.savingProviderPriceList,
    savingPriceItem: priceItems.savingPriceItem,
    exportingPriceList: priceItems.exportingPriceList,
    priceItemForm: priceItems.priceItemForm,
    groupPriceItemTotal: priceItems.groupPriceItemTotal,
    activeProvidersForGroupBase: priceItems.activeProvidersForGroupBase,
    groupBaseProviderId: priceItems.groupBaseProviderId,
    groupBaseActiveList: priceItems.groupBaseActiveList,
    loadingGroupBaseProviderItems: priceItems.loadingGroupBaseProviderItems,
    groupBaseProviderItems: priceItems.groupBaseProviderItems,
    filteredGroupBaseProviderItems: priceItems.filteredGroupBaseProviderItems,
    selectedGroupBaseItem: priceItems.selectedGroupBaseItem,
    groupBaseItemFilter: priceItems.groupBaseItemFilter,
    groupPriceItemComponents: priceItems.groupPriceItemComponents,
    groupComponentProviderId: priceItems.groupComponentProviderId,
    groupComponentActiveList: priceItems.groupComponentActiveList,
    loadingGroupComponentProviderItems: priceItems.loadingGroupComponentProviderItems,
    availableGroupComponentProviderItems: priceItems.availableGroupComponentProviderItems,
    filteredGroupComponentResults: priceItems.filteredGroupComponentResults,
    groupComponentItemFilter: priceItems.groupComponentItemFilter,
    providerPriceListForm: priceLists.providerPriceListForm,
    visibleProviderPriceLists: priceLists.visibleProviderPriceLists,
    visibleProviderPriceListItems: priceItems.visibleProviderPriceListItems,
    pagedProviderPriceListItems: priceItems.pagedProviderPriceListItems,
    priceItemsPage: priceItems.priceItemsPage,
    priceItemsPerPage: priceItems.priceItemsPerPage,
    totalPriceItemPages: priceItems.totalPriceItemPages,
    isGroupProductsPriceList: priceItems.isGroupProductsPriceList,
    getCatalogProductTypeLabel: priceItems.getCatalogProductTypeLabel,
    getPriceItemTypeLabel: priceItems.getPriceItemTypeLabel,
    getPriceItemStatusBadgeClass: priceItems.getPriceItemStatusBadgeClass,
    getPriceItemStatusLabel: priceItems.getPriceItemStatusLabel,
    getPriceItemSortArrow: priceItems.getPriceItemSortArrow,
    isPriceItemActive: priceItems.isPriceItemActive,
    isPriceItemInactive: priceItems.isPriceItemInactive,
    openProviderPriceListModal,
    closeProviderPriceListModal,
    openCreateProviderPriceListModal: priceLists.openCreateProviderPriceListModal,
    closeProviderPriceListCreateModal: priceLists.closeProviderPriceListCreateModal,
    saveProviderPriceList: priceLists.saveProviderPriceList,
    openCreatePriceItemModal: priceItems.openCreatePriceItemModal,
    openEditPriceItemModal: priceItems.openEditPriceItemModal,
    closePriceItemModal: priceItems.closePriceItemModal,
    togglePriceItemMenu: priceItems.togglePriceItemMenu,
    togglePriceListMenu: priceLists.togglePriceListMenu,
    runPriceListAction: priceLists.runPriceListAction,
    runPriceItemAction: priceItems.runPriceItemAction,
    updateProviderPriceListStatus: priceLists.updateProviderPriceListStatus,
    exportProviderPriceListToExcel: priceItems.exportProviderPriceListToExcel,
    savePriceItem: priceItems.savePriceItem,
    openPriceItemStatusConfirmation: priceItems.openPriceItemStatusConfirmation,
    closePriceItemStatusConfirmation: priceItems.closePriceItemStatusConfirmation,
    confirmSelectedPriceItemStatusChange: priceItems.confirmSelectedPriceItemStatusChange,
    getPriceItemStatusConfirmationMeta: priceItems.getPriceItemStatusConfirmationMeta,
    selectProviderPriceList,
    setPriceListStatusFilter: priceLists.setPriceListStatusFilter,
    setPriceItemStatusFilter: priceItems.setPriceItemStatusFilter,
    setPriceItemQuery: priceItems.setPriceItemQuery,
    setPriceItemsPage: priceItems.setPriceItemsPage,
    updateProviderPriceListFormField: priceLists.updateProviderPriceListFormField,
    updatePriceItemFormField: priceItems.updatePriceItemFormField,
    handleGroupBaseProviderChange: priceItems.handleGroupBaseProviderChange,
    handleGroupBaseItemFilterChange: priceItems.handleGroupBaseItemFilterChange,
    handleGroupComponentProviderChange: priceItems.handleGroupComponentProviderChange,
    handleGroupComponentItemFilterChange: priceItems.handleGroupComponentItemFilterChange,
    applyBaseItemToGroup: priceItems.applyBaseItemToGroup,
    addGroupComponent: priceItems.addGroupComponent,
    stepGroupComponentQuantity: priceItems.stepGroupComponentQuantity,
    updateGroupComponentQuantity: priceItems.updateGroupComponentQuantity,
    moveGroupComponent: priceItems.moveGroupComponent,
    removeGroupComponent: priceItems.removeGroupComponent,
    togglePriceItemSort: priceItems.togglePriceItemSort,
    isProviderActive: priceItems.isProviderActive,
  };
}