import { useCallback, useEffect, useMemo, useState } from "react";
import { api, getApiErrorMessage } from "../api";

export function useProviderPriceLists({
  providers,
  catalogs,
  reloadProviders,
  setError,
  setSuccess,
}) {
  const [providerPriceListModalProvider, setProviderPriceListModalProvider] =
    useState(null);
  const [providerPriceLists, setProviderPriceLists] = useState([]);
  const [loadingProviderPriceLists, setLoadingProviderPriceLists] =
    useState(false);
  const [selectedProviderPriceListId, setSelectedProviderPriceListId] =
    useState(null);
  const [providerPriceListItems, setProviderPriceListItems] = useState([]);
  const [loadingProviderPriceListItems, setLoadingProviderPriceListItems] =
    useState(false);
  const [showProviderPriceListCreateModal, setShowProviderPriceListCreateModal] =
    useState(false);
  const [priceListStatusFilter, setPriceListStatusFilter] = useState("all");
  const [openPriceListMenuId, setOpenPriceListMenuId] = useState(null);
  const [savingProviderPriceList, setSavingProviderPriceList] = useState(false);
  const [providerPriceListForm, setProviderPriceListForm] = useState({
    name: "",
    currencyId: "",
    itemType: "producto",
  });

  function buildDefaultProviderPriceListForm() {
    const defaultProductTypeCode = catalogs.productTypes?.[0]?.code || "producto";

    return {
      name: "",
      currencyId: String(catalogs.currencies?.[0]?.id || ""),
      itemType: defaultProductTypeCode,
    };
  }

  const loadProviderPriceLists = useCallback(async (providerId) => {
    const { data } = await api.get(`/api/providers/${providerId}/price-lists`);
    return Array.isArray(data) ? data : [];
  }, []);

  const loadProviderPriceListItems = useCallback(async (providerId, listId) => {
    const { data } = await api.get(
      `/api/providers/${providerId}/price-lists/${listId}/items`,
    );
    return Array.isArray(data) ? data : [];
  }, []);

  const currentProviderForPriceList = useMemo(() => {
    if (!providerPriceListModalProvider) return null;
    return (
      providers.find(
        (provider) =>
          Number(provider.id) === Number(providerPriceListModalProvider.id),
      ) || providerPriceListModalProvider
    );
  }, [providerPriceListModalProvider, providers]);

  const selectedProviderPriceList = useMemo(
    () =>
      providerPriceLists.find(
        (priceList) =>
          Number(priceList.id) === Number(selectedProviderPriceListId),
      ) || null,
    [providerPriceLists, selectedProviderPriceListId],
  );

  const priceListStatusCounts = useMemo(
    () =>
      providerPriceLists.reduce(
        (totals, priceList) => {
          totals.all += 1;
          if (Number(priceList.is_active) === 1) {
            totals.active += 1;
          } else {
            totals.inactive += 1;
          }
          return totals;
        },
        { all: 0, active: 0, inactive: 0 },
      ),
    [providerPriceLists],
  );

  const visibleProviderPriceLists = useMemo(() => {
    if (priceListStatusFilter === "all") {
      return providerPriceLists;
    }

    return providerPriceLists.filter((priceList) =>
      priceListStatusFilter === "active"
        ? Number(priceList.is_active) === 1
        : Number(priceList.is_active) !== 1,
    );
  }, [providerPriceLists, priceListStatusFilter]);

  useEffect(() => {
    if (openPriceListMenuId === null) return undefined;

    function handlePointerDown(event) {
      if (event.target.closest(".provider-price-lists-kebab-wrap")) return;
      setOpenPriceListMenuId(null);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [openPriceListMenuId]);

  async function refreshProviderPriceLists(options = {}) {
    if (!providerPriceListModalProvider) return;

    const preferredListId =
      options.preferredListId === undefined
        ? selectedProviderPriceListId
        : options.preferredListId;

    setLoadingProviderPriceLists(true);
    setLoadingProviderPriceListItems(true);

    try {
      const lists = await loadProviderPriceLists(providerPriceListModalProvider.id);
      setProviderPriceLists(lists);

      const nextSelectedList =
        lists.find((list) => Number(list.id) === Number(preferredListId)) ||
        lists.find((list) => Number(list.is_active) === 1) ||
        lists[0] ||
        null;

      setSelectedProviderPriceListId(
        nextSelectedList ? Number(nextSelectedList.id) : null,
      );

      if (!nextSelectedList) {
        setProviderPriceListItems([]);
        return;
      }

      const items = await loadProviderPriceListItems(
        providerPriceListModalProvider.id,
        nextSelectedList.id,
      );
      setProviderPriceListItems(items);
    } finally {
      setLoadingProviderPriceLists(false);
      setLoadingProviderPriceListItems(false);
    }
  }

  async function openProviderPriceListModal(provider, preferredListId = null) {
    setError("");
    setSuccess("");
    setPriceListStatusFilter("all");
    setProviderPriceListModalProvider(provider);
    setProviderPriceLists([]);
    setSelectedProviderPriceListId(null);
    setProviderPriceListItems([]);
    setLoadingProviderPriceLists(true);
    setLoadingProviderPriceListItems(true);

    try {
      const lists = await loadProviderPriceLists(provider.id);
      setProviderPriceLists(lists);

      const nextSelectedList =
        lists.find((list) => Number(list.id) === Number(preferredListId)) ||
        lists.find((list) => Number(list.is_active) === 1) ||
        lists[0] ||
        null;

      setSelectedProviderPriceListId(
        nextSelectedList ? Number(nextSelectedList.id) : null,
      );

      if (nextSelectedList) {
        const items = await loadProviderPriceListItems(provider.id, nextSelectedList.id);
        setProviderPriceListItems(items);
      }
    } catch (err) {
      setProviderPriceLists([]);
      setProviderPriceListItems([]);
      setError(
        getApiErrorMessage(
          err,
          "No fue posible cargar las listas de precios del proveedor",
        ),
      );
    } finally {
      setLoadingProviderPriceLists(false);
      setLoadingProviderPriceListItems(false);
    }
  }

  async function selectProviderPriceList(listId) {
    if (!providerPriceListModalProvider) return;

    setError("");
    setSuccess("");
    setSelectedProviderPriceListId(Number(listId));
    setLoadingProviderPriceListItems(true);

    try {
      const items = await loadProviderPriceListItems(providerPriceListModalProvider.id, listId);
      setProviderPriceListItems(items);
    } catch (err) {
      setProviderPriceListItems([]);
      setError(
        getApiErrorMessage(err, "No fue posible cargar los precios de la lista"),
      );
    } finally {
      setLoadingProviderPriceListItems(false);
    }
  }

  function closeProviderPriceListModal(isBusy) {
    if (isBusy) return;
    setPriceListStatusFilter("all");
    setProviderPriceListModalProvider(null);
    setProviderPriceLists([]);
    setSelectedProviderPriceListId(null);
    setProviderPriceListItems([]);
    setShowProviderPriceListCreateModal(false);
    setOpenPriceListMenuId(null);
  }

  function openCreateProviderPriceListModal(provider = null) {
    const targetProvider = provider || providerPriceListModalProvider;
    if (!targetProvider) return;

    setError("");
    setSuccess("");
    setProviderPriceListModalProvider(targetProvider);
    setProviderPriceListForm(buildDefaultProviderPriceListForm());
    setShowProviderPriceListCreateModal(true);
  }

  function closeProviderPriceListCreateModal() {
    if (savingProviderPriceList) return;
    setShowProviderPriceListCreateModal(false);
    setProviderPriceListForm(buildDefaultProviderPriceListForm());
  }

  async function saveProviderPriceList(event) {
    event.preventDefault();
    if (!providerPriceListModalProvider) return;

    setError("");
    setSuccess("");
    setSavingProviderPriceList(true);

    try {
      const { data } = await api.post(
        `/api/providers/${providerPriceListModalProvider.id}/price-lists`,
        {
          name: String(providerPriceListForm.name || "").trim(),
          currencyId: Number(providerPriceListForm.currencyId),
          itemType: providerPriceListForm.itemType,
        },
      );

      setSuccess(data?.message || "Lista de precios creada correctamente");
      setShowProviderPriceListCreateModal(false);
      setProviderPriceListForm(buildDefaultProviderPriceListForm());
      await openProviderPriceListModal(
        providerPriceListModalProvider,
        Number(data?.id || 0) || null,
      );
      await reloadProviders();
    } catch (err) {
      const fieldErrors = err?.response?.data?.errors?.fieldErrors;
      if (fieldErrors?.name?.length) {
        setError(`name: ${fieldErrors.name[0]}`);
      } else if (fieldErrors?.currencyId?.length) {
        setError(`currencyId: ${fieldErrors.currencyId[0]}`);
      } else if (fieldErrors?.itemType?.length) {
        setError(`itemType: ${fieldErrors.itemType[0]}`);
      } else {
        setError(getApiErrorMessage(err, "No fue posible crear la lista de precios"));
      }
    } finally {
      setSavingProviderPriceList(false);
    }
  }

  function togglePriceListMenu(listId) {
    setOpenPriceListMenuId((prev) => (prev === listId ? null : listId));
  }

  async function runPriceListAction(action) {
    try {
      await action();
    } finally {
      setOpenPriceListMenuId(null);
    }
  }

  async function updateProviderPriceListStatus(priceList, statusCode) {
    if (!providerPriceListModalProvider) return;

    setError("");
    setSuccess("");
    try {
      const { data } = await api.patch(
        `/api/providers/${providerPriceListModalProvider.id}/price-lists/${priceList.id}/status`,
        { statusCode },
      );
      setSuccess(data?.message || "Estado de la lista actualizado");
      await refreshProviderPriceLists({ preferredListId: priceList.id });
      await reloadProviders();
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible actualizar el estado de la lista de precios",
        ),
      );
    }
  }

  function updateProviderPriceListFormField(field, value) {
    setProviderPriceListForm((prev) => ({ ...prev, [field]: value }));
  }

  return {
    providerPriceListModalProvider,
    currentProviderForPriceList,
    providerPriceLists,
    loadingProviderPriceLists,
    selectedProviderPriceList,
    selectedProviderPriceListId,
    providerPriceListItems,
    setProviderPriceListItems,
    loadingProviderPriceListItems,
    showProviderPriceListCreateModal,
    priceListStatusFilter,
    priceListStatusCounts,
    openPriceListMenuId,
    savingProviderPriceList,
    providerPriceListForm,
    visibleProviderPriceLists,
    setPriceListStatusFilter,
    openProviderPriceListModal,
    selectProviderPriceList,
    closeProviderPriceListModal,
    openCreateProviderPriceListModal,
    closeProviderPriceListCreateModal,
    saveProviderPriceList,
    togglePriceListMenu,
    runPriceListAction,
    updateProviderPriceListStatus,
    updateProviderPriceListFormField,
    loadProviderPriceLists,
    loadProviderPriceListItems,
    refreshProviderPriceLists,
  };
}