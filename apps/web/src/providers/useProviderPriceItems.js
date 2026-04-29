import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { api, getApiErrorMessage } from "../api";

const IMPORTED_PRICE_LIST_HEADER_ALIASES = {
  code: ["codigo", "código", "code"],
  description: ["descripcion", "descripción", "description"],
  price: ["precio", "price"],
  status: ["estado", "status"],
  currency: ["moneda", "currency"],
  itemType: ["tipo", "item type", "tipo item", "tipo de item"],
};

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function buildExportFileName(provider, priceList) {
  const normalizedName = String(provider?.name || "proveedor")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const dateStamp = new Date().toISOString().slice(0, 10);
  const listSuffix = String(priceList?.name || "lista")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

  return `lista-precios-${normalizedName || "proveedor"}-${listSuffix || "lista"}-${dateStamp}.xlsx`;
}

function buildImportTemplateFileName(provider, priceList) {
  const normalizedName = String(provider?.name || "proveedor")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const listSuffix = String(priceList?.name || "lista")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

  return `plantilla-lista-precios-${normalizedName || "proveedor"}-${listSuffix || "lista"}.xlsx`;
}

function buildImportTemplateWorkbook({ currencyCode, itemTypeLabel }) {
  const templateWorksheet = XLSX.utils.aoa_to_sheet([
    ["Codigo", "Descripcion", "Precio", "Moneda", "Estado", "Tipo"],
  ]);
  templateWorksheet["!cols"] = [
    { wch: 18 },
    { wch: 42 },
    { wch: 14 },
    { wch: 12 },
    { wch: 14 },
    { wch: 22 },
  ];

  const instructionsWorksheet = XLSX.utils.aoa_to_sheet([
    ["Campo", "Uso", "Valor esperado"],
    ["Codigo", "Obligatorio", "Unico dentro del archivo y de la lista"],
    ["Descripcion", "Opcional", "Texto libre"],
    ["Precio", "Obligatorio", "Numero mayor o igual a 0"],
    ["Moneda", "Opcional", currencyCode || "Debe coincidir con la lista"],
    ["Estado", "Opcional", "Activo o Inactivo"],
    ["Tipo", "Opcional", itemTypeLabel || "Debe coincidir con la lista"],
  ]);
  instructionsWorksheet["!cols"] = [{ wch: 18 }, { wch: 30 }, { wch: 34 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, templateWorksheet, "Plantilla");
  XLSX.utils.book_append_sheet(workbook, instructionsWorksheet, "Instrucciones");
  return workbook;
}

function parseImportedPrice(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : Number.NaN;
  }

  const rawValue = String(value || "").trim().replace(/[$\s]/g, "");

  if (!rawValue) {
    return Number.NaN;
  }

  const hasComma = rawValue.includes(",");
  const hasDot = rawValue.includes(".");
  let normalizedValue = rawValue;

  if (hasComma && hasDot) {
    normalizedValue = rawValue.replace(/,/g, "");
  } else if (hasComma) {
    normalizedValue = rawValue.replace(/,/g, ".");
  }

  if (!normalizedValue) {
    return Number.NaN;
  }

  return Number(normalizedValue);
}

function isImportedRowEmpty(row) {
  return row.every((cell) => String(cell || "").trim() === "");
}

function getImportedHeaderIndexes(headerRow) {
  const indexMap = {};

  headerRow.forEach((headerValue, index) => {
    const normalizedHeader = normalizeText(headerValue);
    Object.entries(IMPORTED_PRICE_LIST_HEADER_ALIASES).forEach(
      ([fieldName, aliases]) => {
        if (indexMap[fieldName] !== undefined) return;
        if (aliases.some((alias) => normalizeText(alias) === normalizedHeader)) {
          indexMap[fieldName] = index;
        }
      },
    );
  });

  return indexMap;
}

export function useProviderPriceItems({
  providers,
  catalogs,
  providerPriceListModalProvider,
  currentProviderForPriceList,
  selectedProviderPriceList,
  providerPriceListItems,
  loadProviderPriceLists,
  loadProviderPriceListItems,
  refreshProviderPriceLists,
  reloadProviders,
  setError,
  setSuccess,
}) {
  const [showPriceItemModal, setShowPriceItemModal] = useState(false);
  const [editingPriceItemId, setEditingPriceItemId] = useState(null);
  const [priceItemStatusFilter, setPriceItemStatusFilterState] =
    useState("all");
  const [priceItemQuery, setPriceItemQueryState] = useState("");
  const [priceItemSortField, setPriceItemSortField] = useState("id");
  const [priceItemSortDirection, setPriceItemSortDirection] = useState("desc");
  const [priceItemsPage, setPriceItemsPage] = useState(1);
  const [openPriceItemMenuId, setOpenPriceItemMenuId] = useState(null);
  const [confirmPriceItemStatusAction, setConfirmPriceItemStatusAction] =
    useState(null);
  const [savingPriceItem, setSavingPriceItem] = useState(false);
  const [exportingPriceList, setExportingPriceList] = useState(false);
  const [importingPriceList, setImportingPriceList] = useState(false);
  const [priceListImportPreview, setPriceListImportPreview] = useState(null);
  const [priceItemForm, setPriceItemForm] = useState({
    code: "",
    description: "",
    itemType: "producto",
    price: "",
    currencyId: "",
    activationStatusId: "",
  });
  const [selectedGroupBaseItem, setSelectedGroupBaseItem] = useState(null);
  const [groupBaseProviderId, setGroupBaseProviderId] = useState("");
  const [groupBaseActiveList, setGroupBaseActiveList] = useState(null);
  const [groupBaseProviderItems, setGroupBaseProviderItems] = useState([]);
  const [groupBaseItemFilter, setGroupBaseItemFilter] = useState("");
  const [loadingGroupBaseProviderItems, setLoadingGroupBaseProviderItems] =
    useState(false);
  const [groupComponentProviderId, setGroupComponentProviderId] = useState("");
  const [groupComponentActiveList, setGroupComponentActiveList] =
    useState(null);
  const [groupComponentProviderItems, setGroupComponentProviderItems] =
    useState([]);
  const [groupComponentItemFilter, setGroupComponentItemFilter] = useState("");
  const [
    loadingGroupComponentProviderItems,
    setLoadingGroupComponentProviderItems,
  ] = useState(false);
  const [groupPriceItemComponents, setGroupPriceItemComponents] = useState([]);

  function buildDefaultPriceItemForm() {
    const defaultProductTypeCode =
      catalogs.productTypes?.[0]?.code || "producto";

    return {
      code: "",
      description: "",
      itemType: defaultProductTypeCode,
      price: "",
      currencyId: String(catalogs.currencies?.[0]?.id || ""),
      activationStatusId: String(
        catalogs.priceItemStatuses.find(
          (status) => normalizeText(status.code) === "activo",
        )?.id ||
          catalogs.priceItemStatuses?.[0]?.id ||
          "",
      ),
    };
  }

  function getCatalogProductTypeLabel(itemType) {
    const productType = catalogs.productTypes.find(
      (entry) => String(entry.code) === String(itemType || "producto"),
    );

    if (productType?.name) {
      return String(productType.name);
    }
    if (String(itemType) === "servicio_propio") {
      return "Servicios Propios";
    }
    if (String(itemType) === "grupo_productos") {
      return "Bundle";
    }
    return "Productos";
  }

  function getPriceItemTypeLabel(itemType) {
    return getCatalogProductTypeLabel(itemType);
  }

  function isProviderActive(provider) {
    return (
      normalizeText(
        provider?.activation_status_code || provider?.activation_status,
      ) === "activado"
    );
  }

  function isPriceItemActive(item) {
    return (
      normalizeText(item.activation_status_code || item.activation_status) ===
      "activo"
    );
  }

  function isPriceItemInactive(item) {
    return (
      normalizeText(item.activation_status_code || item.activation_status) ===
      "inactivo"
    );
  }

  const getPriceItemStatusLabel = useCallback((item) => {
    const normalizedStatus = normalizeText(
      item?.activation_status_code || item?.activation_status,
    );
    return normalizedStatus === "activo" ? "Activo" : "Inactivo";
  }, []);

  function getPriceItemStatusBadgeClass(item) {
    return isPriceItemActive(item)
      ? "user-status-badge active"
      : "user-status-badge inactive";
  }

  function resetGroupPriceItemState() {
    setSelectedGroupBaseItem(null);
    setGroupBaseProviderId("");
    setGroupBaseActiveList(null);
    setGroupBaseProviderItems([]);
    setGroupBaseItemFilter("");
    setLoadingGroupBaseProviderItems(false);
    setGroupComponentProviderId("");
    setGroupComponentActiveList(null);
    setGroupComponentProviderItems([]);
    setGroupComponentItemFilter("");
    setLoadingGroupComponentProviderItems(false);
    setGroupPriceItemComponents([]);
  }

  function normalizeGroupComponentSelection(item, overrides = {}) {
    const componentItemId = Number(
      overrides.componentItemId ?? item.component_item_id ?? item.id ?? 0,
    );
    const sourcePrice = Number(item.price || 0);
    const unitPriceOverride = Number(
      overrides.unitPriceOverride ?? item.unit_price_override ?? item.price ?? 0,
    );

    return {
      componentItemId,
      quantity: Number(overrides.quantity ?? item.quantity ?? 1),
      providerId: Number(item.provider_id || 0),
      providerName: item.provider_name || "",
      priceListId: Number(item.price_list_id || 0),
      priceListName: item.price_list_name || "",
      code: item.code || "",
      description: item.description || "",
      itemType: item.item_type || "producto",
      itemTypeLabel:
        item.item_type_label ||
        getPriceItemTypeLabel(item.item_type || "producto"),
      price: sourcePrice,
      sourcePrice,
      unitPriceOverride,
      currencyId: Number(item.currency_id || 0),
      currencyCode: item.currency_code || "USD",
    };
  }

  const selectedPriceListItemType =
    selectedProviderPriceList?.item_type || null;
  const selectedPriceListCurrencyId =
    selectedProviderPriceList?.currency_id || null;
  const isGroupProductsPriceList =
    selectedPriceListItemType === "grupo_productos" ||
    priceItemForm.itemType === "grupo_productos";

  const activeProvidersForGroupBase = useMemo(
    () =>
      providers
        .filter((provider) => isProviderActive(provider))
        .sort((left, right) =>
          String(left.name || "").localeCompare(
            String(right.name || ""),
            "es",
            {
              sensitivity: "base",
              numeric: true,
            },
          ),
        ),
    [providers],
  );

  const filteredGroupBaseProviderItems = useMemo(() => {
    const trimmedFilter = normalizeText(groupBaseItemFilter);
    if (!trimmedFilter) return groupBaseProviderItems;

    return groupBaseProviderItems.filter((item) => {
      const haystack = [
        item.code,
        item.description,
        item.provider_name,
        item.price_list_name,
        item.currency_code,
      ]
        .filter(Boolean)
        .join(" ");

      return normalizeText(haystack).includes(trimmedFilter);
    });
  }, [groupBaseProviderItems, groupBaseItemFilter]);

  const priceItemStatusCounts = useMemo(
    () =>
      providerPriceListItems.reduce(
        (totals, item) => {
          totals.all += 1;
          if (isPriceItemActive(item)) {
            totals.active += 1;
          } else {
            totals.inactive += 1;
          }
          return totals;
        },
        { all: 0, active: 0, inactive: 0 },
      ),
    [providerPriceListItems],
  );

  const visibleProviderPriceListItems = useMemo(() => {
    const statusFilteredItems =
      priceItemStatusFilter === "all"
        ? providerPriceListItems
        : providerPriceListItems.filter((item) =>
            priceItemStatusFilter === "active"
              ? isPriceItemActive(item)
              : isPriceItemInactive(item),
          );

    const query = priceItemQuery.trim().toLowerCase();
    const queryFilteredItems = !query
      ? statusFilteredItems
      : statusFilteredItems.filter((item) => {
          const haystack = [
            item.id,
            item.code,
            item.description,
            item.price,
            item.currency_code,
            getPriceItemStatusLabel(item),
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

          return haystack.includes(query);
        });

    const list = [...queryFilteredItems];
    const readValue = (item) => {
      if (priceItemSortField === "id") return Number(item.id) || 0;
      if (priceItemSortField === "codigo") return String(item.code || "");
      if (priceItemSortField === "descripcion")
        return String(item.description || "");
      if (priceItemSortField === "precio") return Number(item.price) || 0;
      if (priceItemSortField === "estado") return getPriceItemStatusLabel(item);
      return "";
    };

    list.sort((left, right) => {
      const leftValue = readValue(left);
      const rightValue = readValue(right);
      let result = 0;

      if (typeof leftValue === "number" && typeof rightValue === "number") {
        result = leftValue - rightValue;
      } else {
        result = String(leftValue).localeCompare(String(rightValue), "es", {
          numeric: true,
          sensitivity: "base",
        });
      }

      return priceItemSortDirection === "asc" ? result : -result;
    });

    return list;
  }, [
    providerPriceListItems,
    priceItemStatusFilter,
    priceItemQuery,
    priceItemSortDirection,
    priceItemSortField,
    getPriceItemStatusLabel,
  ]);

  const priceItemsPerPage = 10;
  const totalPriceItemPages = Math.max(
    1,
    Math.ceil(visibleProviderPriceListItems.length / priceItemsPerPage),
  );
  const pagedProviderPriceListItems = visibleProviderPriceListItems.slice(
    (priceItemsPage - 1) * priceItemsPerPage,
    priceItemsPage * priceItemsPerPage,
  );

  const lockedPriceItemCurrencyId = useMemo(() => {
    if (selectedProviderPriceList?.currency_id) {
      return String(selectedProviderPriceList.currency_id);
    }

    if (!editingPriceItemId) {
      return String(providerPriceListItems[0]?.currency_id || "");
    }

    const siblingItem = providerPriceListItems.find(
      (item) => Number(item.id) !== Number(editingPriceItemId),
    );

    return String(siblingItem?.currency_id || "");
  }, [selectedProviderPriceList, providerPriceListItems, editingPriceItemId]);

  const groupPriceItemTotal = useMemo(
    () =>
      Number(
        groupPriceItemComponents
          .reduce(
            (sum, component) =>
              sum +
              Number(component.unitPriceOverride || 0) *
                Number(component.quantity || 0),
            0,
          )
          .toFixed(2),
      ),
    [groupPriceItemComponents],
  );

  const availableGroupComponentProviderItems = useMemo(
    () =>
      groupComponentProviderItems.filter(
        (candidate) =>
          !groupPriceItemComponents.some(
            (component) =>
              Number(component.componentItemId) === Number(candidate.id),
          ),
      ),
    [groupComponentProviderItems, groupPriceItemComponents],
  );

  const filteredGroupComponentResults = useMemo(() => {
    const trimmedFilter = normalizeText(groupComponentItemFilter);
    if (!trimmedFilter) return availableGroupComponentProviderItems;

    return availableGroupComponentProviderItems.filter((item) => {
      const haystack = [
        item.code,
        item.description,
        item.provider_name,
        item.price_list_name,
        item.currency_code,
      ]
        .filter(Boolean)
        .join(" ");

      return normalizeText(haystack).includes(trimmedFilter);
    });
  }, [availableGroupComponentProviderItems, groupComponentItemFilter]);

  useEffect(() => {
    if (openPriceItemMenuId === null) return undefined;

    function handlePointerDown(event) {
      if (event.target.closest(".provider-price-items-kebab-wrap")) return;
      setOpenPriceItemMenuId(null);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [openPriceItemMenuId]);

  useEffect(() => {
    if (!showPriceItemModal || !isGroupProductsPriceList) return undefined;
    if (!groupBaseProviderId || !selectedPriceListCurrencyId) return undefined;

    let cancelled = false;

    async function loadGroupBaseProviderItems() {
      setLoadingGroupBaseProviderItems(true);
      try {
        const lists = await loadProviderPriceLists(groupBaseProviderId);
        const activeList =
          lists.find(
            (list) =>
              Number(list.is_active) === 1 &&
              Number(list.currency_id) === Number(selectedPriceListCurrencyId),
          ) || null;

        if (!activeList) {
          if (!cancelled) {
            setGroupBaseActiveList(null);
            setGroupBaseProviderItems([]);
          }
          return;
        }

        const items = await loadProviderPriceListItems(
          groupBaseProviderId,
          activeList.id,
        );

        if (!cancelled) {
          setGroupBaseActiveList({
            id: Number(activeList.id),
            name: activeList.name || "",
          });
          setGroupBaseProviderItems(
            items.filter(
              (item) =>
                isPriceItemActive(item) &&
                String(item.item_type) !== "grupo_productos",
            ),
          );
        }
      } catch (err) {
        if (!cancelled) {
          setGroupBaseActiveList(null);
          setGroupBaseProviderItems([]);
          setError(
            getApiErrorMessage(
              err,
              "No fue posible cargar la lista activa del proveedor seleccionado",
            ),
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingGroupBaseProviderItems(false);
        }
      }
    }

    void loadGroupBaseProviderItems();

    return () => {
      cancelled = true;
    };
  }, [
    showPriceItemModal,
    isGroupProductsPriceList,
    groupBaseProviderId,
    selectedPriceListCurrencyId,
    setError,
    loadProviderPriceListItems,
    loadProviderPriceLists,
  ]);

  useEffect(() => {
    if (!showPriceItemModal || !isGroupProductsPriceList) return undefined;
    if (!groupComponentProviderId || !selectedPriceListCurrencyId)
      return undefined;

    let cancelled = false;

    async function loadGroupComponentProviderItems() {
      setLoadingGroupComponentProviderItems(true);
      try {
        const lists = await loadProviderPriceLists(groupComponentProviderId);
        const activeList =
          lists.find(
            (list) =>
              Number(list.is_active) === 1 &&
              Number(list.currency_id) === Number(selectedPriceListCurrencyId),
          ) || null;

        if (!activeList) {
          if (!cancelled) {
            setGroupComponentActiveList(null);
            setGroupComponentProviderItems([]);
          }
          return;
        }

        const items = await loadProviderPriceListItems(
          groupComponentProviderId,
          activeList.id,
        );

        if (!cancelled) {
          setGroupComponentActiveList({
            id: Number(activeList.id),
            name: activeList.name || "",
          });
          setGroupComponentProviderItems(
            items.filter(
              (item) =>
                isPriceItemActive(item) &&
                String(item.item_type) !== "grupo_productos",
            ),
          );
        }
      } catch (err) {
        if (!cancelled) {
          setGroupComponentActiveList(null);
          setGroupComponentProviderItems([]);
          setError(
            getApiErrorMessage(
              err,
              "No fue posible cargar la lista activa del proveedor para componentes",
            ),
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingGroupComponentProviderItems(false);
        }
      }
    }

    void loadGroupComponentProviderItems();

    return () => {
      cancelled = true;
    };
  }, [
    showPriceItemModal,
    isGroupProductsPriceList,
    groupComponentProviderId,
    selectedPriceListCurrencyId,
    setError,
    loadProviderPriceListItems,
    loadProviderPriceLists,
  ]);

  function setPriceItemStatusFilter(value) {
    setPriceItemsPage(1);
    setPriceItemStatusFilterState(value);
  }

  function setPriceItemQuery(value) {
    setPriceItemsPage(1);
    setPriceItemQueryState(value);
  }

  async function refreshProviderPriceListItems() {
    if (!providerPriceListModalProvider) return;
    await refreshProviderPriceLists();
    await reloadProviders();
  }

  function openCreatePriceItemModal() {
    if (!selectedProviderPriceList) return;
    setError("");
    setSuccess("");
    setEditingPriceItemId(null);
    resetGroupPriceItemState();
    const defaultForm = buildDefaultPriceItemForm();
    setPriceItemForm({
      ...defaultForm,
      itemType: selectedProviderPriceList.item_type || defaultForm.itemType,
      currencyId: lockedPriceItemCurrencyId || defaultForm.currencyId,
    });
    setShowPriceItemModal(true);
  }

  function openEditPriceItemModal(item) {
    setError("");
    setSuccess("");
    setEditingPriceItemId(Number(item.id));
    resetGroupPriceItemState();
    setPriceItemForm({
      code: item.code || "",
      description: item.description || "",
      itemType:
        selectedProviderPriceList?.item_type || item.item_type || "producto",
      price: item.price ?? "",
      currencyId: String(lockedPriceItemCurrencyId || item.currency_id || ""),
      activationStatusId: String(item.activation_status_id || ""),
    });
    if (
      item.item_type === "grupo_productos" &&
      Array.isArray(item.components)
    ) {
      setGroupPriceItemComponents(
        item.components.map((component) =>
          normalizeGroupComponentSelection(component, {
            componentItemId: component.component_item_id,
            unitPriceOverride: component.unit_price_override,
            quantity: component.quantity,
          }),
        ),
      );
    }
    setShowPriceItemModal(true);
  }

  function closePriceItemModal() {
    if (savingPriceItem) return;
    setShowPriceItemModal(false);
    setEditingPriceItemId(null);
    resetGroupPriceItemState();
  }

  function resetPriceItemUiState() {
    setShowPriceItemModal(false);
    setEditingPriceItemId(null);
    setOpenPriceItemMenuId(null);
    setConfirmPriceItemStatusAction(null);
    setPriceListImportPreview(null);
    resetGroupPriceItemState();
  }

  function togglePriceItemMenu(itemId) {
    setOpenPriceItemMenuId((prev) => (prev === itemId ? null : itemId));
  }

  async function runPriceItemAction(action) {
    try {
      await action();
    } finally {
      setOpenPriceItemMenuId(null);
    }
  }

  async function savePriceItem(event) {
    event.preventDefault();
    if (!providerPriceListModalProvider || !selectedProviderPriceList) return;

    setError("");
    setSuccess("");
    setSavingPriceItem(true);

    try {
      const isGroupItem = priceItemForm.itemType === "grupo_productos";
      const payload = {
        code: String(priceItemForm.code || "").trim(),
        description: priceItemForm.description || undefined,
        itemType: priceItemForm.itemType,
        price: isGroupItem ? undefined : Number(priceItemForm.price),
        currencyId: Number(priceItemForm.currencyId),
        activationStatusId: Number(priceItemForm.activationStatusId),
        components: isGroupItem
          ? groupPriceItemComponents.map((component) => ({
              componentItemId: Number(component.componentItemId),
              unitPriceOverride: Number(component.unitPriceOverride || 0),
              quantity: Number(component.quantity),
            }))
          : undefined,
      };

      const { data } = editingPriceItemId
        ? await api.put(
            `/api/providers/${providerPriceListModalProvider.id}/price-lists/${selectedProviderPriceList.id}/items/${editingPriceItemId}`,
            payload,
          )
        : await api.post(
            `/api/providers/${providerPriceListModalProvider.id}/price-lists/${selectedProviderPriceList.id}/items`,
            payload,
          );

      setSuccess(
        data?.message ||
          (editingPriceItemId
            ? "Precio actualizado correctamente"
            : "Precio creado correctamente"),
      );
      setShowPriceItemModal(false);
      setEditingPriceItemId(null);
      await refreshProviderPriceListItems();
    } catch (err) {
      const fieldErrors = err?.response?.data?.errors?.fieldErrors;
      if (fieldErrors && typeof fieldErrors === "object") {
        const firstError = Object.entries(fieldErrors).find(
          ([, messages]) => Array.isArray(messages) && messages.length > 0,
        );
        if (firstError) {
          const [fieldName, messages] = firstError;
          setError(`${fieldName}: ${messages[0]}`);
          setSavingPriceItem(false);
          return;
        }
      }
      setError(getApiErrorMessage(err, "No fue posible guardar el precio"));
    } finally {
      setSavingPriceItem(false);
    }
  }

  async function updatePriceItemStatus(item, statusCode) {
    if (!providerPriceListModalProvider || !selectedProviderPriceList) return;

    setError("");
    setSuccess("");
    try {
      const { data } = await api.patch(
        `/api/providers/${providerPriceListModalProvider.id}/price-lists/${selectedProviderPriceList.id}/items/${item.id}/status`,
        { statusCode },
      );
      setSuccess(data?.message || "Estado del precio actualizado");
      await refreshProviderPriceListItems();
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible actualizar el estado del precio",
        ),
      );
    }
  }

  function openPriceItemStatusConfirmation(item, statusCode) {
    setConfirmPriceItemStatusAction({ item, statusCode });
    setOpenPriceItemMenuId(null);
  }

  function closePriceItemStatusConfirmation() {
    setConfirmPriceItemStatusAction(null);
  }

  async function confirmSelectedPriceItemStatusChange() {
    if (!confirmPriceItemStatusAction) return;
    await updatePriceItemStatus(
      confirmPriceItemStatusAction.item,
      confirmPriceItemStatusAction.statusCode,
    );
    setConfirmPriceItemStatusAction(null);
  }

  function getPriceItemStatusConfirmationMeta() {
    const itemCode = confirmPriceItemStatusAction?.item?.code || "";

    if (confirmPriceItemStatusAction?.statusCode === "activo") {
      return {
        title: "Activar precio",
        message: `Seguro que deseas activar el precio "${itemCode}"?`,
        confirmText: "Activar",
        isDangerous: false,
      };
    }

    return {
      title: "Desactivar precio",
      message: `Seguro que deseas desactivar el precio "${itemCode}"?`,
      confirmText: "Desactivar",
      isDangerous: true,
    };
  }

  async function exportProviderPriceListToExcel() {
    if (
      !currentProviderForPriceList ||
      visibleProviderPriceListItems.length === 0
    ) {
      return;
    }

    setError("");
    setSuccess("");
    setExportingPriceList(true);

    try {
      const rows = visibleProviderPriceListItems.map((item) => ({
        ID: item.id,
        Codigo: item.code || "",
        Descripcion: item.description || "",
        Tipo: getPriceItemTypeLabel(item.item_type),
        Precio: Number(item.price || 0),
        Moneda: item.currency_code || "",
        Estado: getPriceItemStatusLabel(item),
      }));

      const worksheet = XLSX.utils.json_to_sheet(rows);
      worksheet["!cols"] = [
        { wch: 10 },
        { wch: 18 },
        { wch: 42 },
        { wch: 22 },
        { wch: 14 },
        { wch: 12 },
        { wch: 14 },
      ];

      const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1:G1");
      for (let rowIndex = 1; rowIndex <= range.e.r; rowIndex += 1) {
        const priceCellAddress = XLSX.utils.encode_cell({ c: 4, r: rowIndex });
        if (worksheet[priceCellAddress]) {
          worksheet[priceCellAddress].z = "#,##0.00";
        }
      }

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Lista de precios");
      XLSX.writeFile(
        workbook,
        buildExportFileName(
          currentProviderForPriceList,
          selectedProviderPriceList,
        ),
      );
      setSuccess("Exportación generada correctamente");
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible exportar la lista de precios"),
      );
    } finally {
      setExportingPriceList(false);
    }
  }

  function downloadProviderPriceListImportTemplate() {
    if (!currentProviderForPriceList || !selectedProviderPriceList) {
      return;
    }

    const selectedCurrencyCode = String(
      selectedProviderPriceList.currency_code ||
        catalogs.currencies.find(
          (currency) =>
            Number(currency.id) === Number(selectedProviderPriceList.currency_id),
        )?.code ||
        "",
    );
    const selectedItemTypeLabel = getPriceItemTypeLabel(
      selectedProviderPriceList.item_type,
    );

    setError("");
    setSuccess("");

    try {
      const workbook = buildImportTemplateWorkbook({
        currencyCode: selectedCurrencyCode,
        itemTypeLabel: selectedItemTypeLabel,
      });
      XLSX.writeFile(
        workbook,
        buildImportTemplateFileName(
          currentProviderForPriceList,
          selectedProviderPriceList,
        ),
      );
      setSuccess("Plantilla de importacion descargada correctamente");
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible descargar la plantilla de importacion",
        ),
      );
    }
  }

  function closePriceListImportPreview() {
    if (importingPriceList) return;
    setPriceListImportPreview(null);
  }

  function buildPriceListImportPreview({
    rows,
    fileName,
    selectedCurrencyCode,
    selectedItemTypeLabel,
    activeStatusId,
    inactiveStatusId,
  }) {
    const headerIndexes = getImportedHeaderIndexes(rows[0]);
    if (headerIndexes.code === undefined || headerIndexes.price === undefined) {
      throw new Error(
        "El Excel debe incluir al menos las columnas Codigo y Precio.",
      );
    }

    const validItems = [];
    const invalidRows = [];
    const seenCodes = new Set();
    let processedRows = 0;

    rows.slice(1).forEach((row, rowIndex) => {
      if (!Array.isArray(row) || isImportedRowEmpty(row)) {
        return;
      }

      processedRows += 1;
      const excelRowNumber = rowIndex + 2;
      const code = String(row[headerIndexes.code] || "").trim();
      const description = String(row[headerIndexes.description] || "").trim();
      const price = parseImportedPrice(row[headerIndexes.price]);
      const importedStatus = normalizeText(row[headerIndexes.status]);
      const importedCurrency = normalizeText(row[headerIndexes.currency]);
      const importedItemType = normalizeText(row[headerIndexes.itemType]);
      const issues = [];

      if (!code) {
        issues.push("El codigo es obligatorio.");
      } else if (seenCodes.has(normalizeText(code))) {
        issues.push("El codigo esta duplicado en el archivo.");
      }

      if (!Number.isFinite(price) || price < 0) {
        issues.push("El precio no es valido.");
      }

      if (
        importedCurrency &&
        normalizeText(selectedCurrencyCode) !== importedCurrency
      ) {
        issues.push(
          `La moneda ${row[headerIndexes.currency]} no coincide con la lista seleccionada (${selectedCurrencyCode}).`,
        );
      }

      if (
        importedItemType &&
        importedItemType !== normalizeText(selectedProviderPriceList.item_type) &&
        importedItemType !== normalizeText(selectedItemTypeLabel)
      ) {
        issues.push(
          `El tipo ${row[headerIndexes.itemType]} no coincide con la lista seleccionada (${selectedItemTypeLabel}).`,
        );
      }

      let activationStatusId = activeStatusId;
      if (importedStatus) {
        if (importedStatus === "activo") {
          activationStatusId = activeStatusId;
        } else if (importedStatus === "inactivo") {
          activationStatusId = inactiveStatusId;
        } else {
          issues.push("El estado debe ser Activo o Inactivo.");
        }
      }

      if (issues.length > 0) {
        invalidRows.push({
          excelRowNumber,
          code,
          description,
          price: String(row[headerIndexes.price] || "").trim(),
          issues,
        });
        return;
      }

      seenCodes.add(normalizeText(code));
      validItems.push({
        code,
        description,
        itemType: selectedProviderPriceList.item_type,
        price,
        currencyId: Number(selectedProviderPriceList.currency_id),
        activationStatusId,
        excelRowNumber,
      });
    });

    if (processedRows === 0) {
      throw new Error("El archivo Excel no contiene filas para importar.");
    }

    return {
      fileName,
      totalRows: processedRows,
      validItems,
      invalidRows,
    };
  }

  async function importProviderPriceListFromExcel() {
    if (!providerPriceListModalProvider || !selectedProviderPriceList) {
      return;
    }

    if (selectedProviderPriceList.item_type === "grupo_productos") {
      setError(
        "La importacion desde Excel no esta disponible para listas tipo Bundle.",
      );
      return;
    }

    const file = await new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".xlsx,.xls";
      input.onchange = () => resolve(input.files?.[0] || null);
      input.click();
    });

    if (!file) {
      return;
    }

    const activeStatusId = Number(
      catalogs.priceItemStatuses.find(
        (status) => normalizeText(status.code) === "activo",
      )?.id || 0,
    );
    const inactiveStatusId = Number(
      catalogs.priceItemStatuses.find(
        (status) => normalizeText(status.code) === "inactivo",
      )?.id || 0,
    );
    const selectedCurrencyCode = String(
      selectedProviderPriceList.currency_code ||
        catalogs.currencies.find(
          (currency) =>
            Number(currency.id) === Number(selectedProviderPriceList.currency_id),
        )?.code ||
        "",
    );
    const selectedItemTypeLabel = getPriceItemTypeLabel(
      selectedProviderPriceList.item_type,
    );

    setError("");
    setSuccess("");
    setPriceListImportPreview(null);

    try {
      const workbook = XLSX.read(await file.arrayBuffer(), {
        type: "array",
        cellDates: false,
      });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: "",
        raw: false,
      });

      if (!Array.isArray(rows) || rows.length < 2) {
        throw new Error("El archivo Excel no contiene filas para importar.");
      }

      const preview = buildPriceListImportPreview({
        rows,
        fileName: String(file.name || "archivo.xlsx"),
        selectedCurrencyCode,
        selectedItemTypeLabel,
        activeStatusId,
        inactiveStatusId,
      });

      setPriceListImportPreview(preview);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : getApiErrorMessage(
              err,
              "No fue posible importar la lista de precios",
            ),
      );
    }
  }

  async function confirmProviderPriceListImport() {
    if (
      !providerPriceListModalProvider ||
      !selectedProviderPriceList ||
      !priceListImportPreview
    ) {
      return;
    }

    if (priceListImportPreview.validItems.length === 0) {
      setError("No hay filas validas para importar.");
      return;
    }

    setError("");
    setSuccess("");
    setImportingPriceList(true);

    try {
      for (const item of priceListImportPreview.validItems) {
        try {
          await api.post(
            `/api/providers/${providerPriceListModalProvider.id}/price-lists/${selectedProviderPriceList.id}/items`,
            {
              code: item.code,
              description: item.description || undefined,
              itemType: item.itemType,
              price: item.price,
              currencyId: item.currencyId,
              activationStatusId: item.activationStatusId,
            },
          );
        } catch (err) {
          throw new Error(
            `Fila ${item.excelRowNumber}: ${getApiErrorMessage(
              err,
              "No fue posible importar el producto",
            )}`,
          );
        }
      }

      await refreshProviderPriceListItems();
      setPriceListImportPreview(null);
      setSuccess(
        `${priceListImportPreview.validItems.length} producto${priceListImportPreview.validItems.length === 1 ? "" : "s"} importado${priceListImportPreview.validItems.length === 1 ? "" : "s"} correctamente`,
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : getApiErrorMessage(
              err,
              "No fue posible importar la lista de precios",
            ),
      );
    } finally {
      setImportingPriceList(false);
    }
  }

  function applyBaseItemToGroup(candidate) {
    setSelectedGroupBaseItem(candidate);
    setGroupBaseProviderId(String(candidate.provider_id || ""));
    setGroupBaseActiveList({
      id: Number(candidate.price_list_id || 0),
      name: candidate.price_list_name || "",
    });
    setGroupBaseItemFilter(candidate.code || "");
    setPriceItemForm((prev) => ({
      ...prev,
      code: candidate.code || prev.code,
      description: candidate.description || prev.description,
    }));
  }

  function addGroupComponent(candidate) {
    const normalizedComponent = normalizeGroupComponentSelection(candidate);
    setGroupPriceItemComponents((prev) => {
      if (
        prev.some(
          (component) =>
            Number(component.componentItemId) ===
            Number(normalizedComponent.componentItemId),
        )
      ) {
        return prev;
      }
      return [...prev, normalizedComponent];
    });
  }

  function updateGroupComponentQuantity(componentItemId, nextValue) {
    const quantity = Number(nextValue);
    const normalizedQuantity = Number.isFinite(quantity)
      ? Math.max(0, Math.round(quantity * 100) / 100)
      : 0;
    setGroupPriceItemComponents((prev) =>
      prev.map((component) =>
        Number(component.componentItemId) === Number(componentItemId)
          ? { ...component, quantity: normalizedQuantity }
          : component,
      ),
    );
  }

  function updateGroupComponentUnitPrice(componentItemId, nextValue) {
    const unitPrice = Number(nextValue);
    const normalizedUnitPrice = Number.isFinite(unitPrice)
      ? Math.max(0, Math.round(unitPrice * 100) / 100)
      : 0;
    setGroupPriceItemComponents((prev) =>
      prev.map((component) =>
        Number(component.componentItemId) === Number(componentItemId)
          ? { ...component, unitPriceOverride: normalizedUnitPrice }
          : component,
      ),
    );
  }

  function stepGroupComponentQuantity(componentItemId, delta) {
    setGroupPriceItemComponents((prev) =>
      prev.map((component) => {
        if (Number(component.componentItemId) !== Number(componentItemId)) {
          return component;
        }

        return {
          ...component,
          quantity: Math.max(
            0,
            Math.round((Number(component.quantity || 0) + delta) * 100) / 100,
          ),
        };
      }),
    );
  }

  function removeGroupComponent(componentItemId) {
    setGroupPriceItemComponents((prev) =>
      prev.filter(
        (component) =>
          Number(component.componentItemId) !== Number(componentItemId),
      ),
    );
  }

  function moveGroupComponent(componentItemId, direction) {
    setGroupPriceItemComponents((prev) => {
      const currentIndex = prev.findIndex(
        (component) =>
          Number(component.componentItemId) === Number(componentItemId),
      );

      if (currentIndex < 0) return prev;

      const targetIndex =
        direction === "up" ? currentIndex - 1 : currentIndex + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) {
        return prev;
      }

      const next = [...prev];
      const [movedComponent] = next.splice(currentIndex, 1);
      next.splice(targetIndex, 0, movedComponent);
      return next;
    });
  }

  function togglePriceItemSort(field) {
    if (priceItemSortField === field) {
      setPriceItemSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setPriceItemSortField(field);
    setPriceItemSortDirection("asc");
  }

  function getPriceItemSortArrow(field) {
    if (priceItemSortField !== field) return "↕";
    return priceItemSortDirection === "asc" ? "↑" : "↓";
  }

  function updatePriceItemFormField(field, value) {
    setPriceItemForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleGroupBaseProviderChange(value) {
    setGroupBaseProviderId(value);
    setSelectedGroupBaseItem(null);
    setGroupBaseActiveList(null);
    setGroupBaseProviderItems([]);
    setGroupBaseItemFilter("");
  }

  function handleGroupBaseItemFilterChange(value) {
    setGroupBaseItemFilter(value);
    setSelectedGroupBaseItem(null);
  }

  function handleGroupComponentProviderChange(value) {
    setGroupComponentProviderId(value);
    setGroupComponentActiveList(null);
    setGroupComponentProviderItems([]);
    setGroupComponentItemFilter("");
  }

  function handleGroupComponentItemFilterChange(value) {
    setGroupComponentItemFilter(value);
  }

  return {
    showPriceItemModal,
    editingPriceItemId,
    priceItemStatusFilter,
    priceItemStatusCounts,
    priceItemQuery,
    openPriceItemMenuId,
    confirmPriceItemStatusAction,
    savingPriceItem,
    exportingPriceList,
    importingPriceList,
    priceListImportPreview,
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
    openCreatePriceItemModal,
    openEditPriceItemModal,
    closePriceItemModal,
    resetPriceItemUiState,
    togglePriceItemMenu,
    runPriceItemAction,
    exportProviderPriceListToExcel,
    downloadProviderPriceListImportTemplate,
    importProviderPriceListFromExcel,
    closePriceListImportPreview,
    confirmProviderPriceListImport,
    savePriceItem,
    openPriceItemStatusConfirmation,
    closePriceItemStatusConfirmation,
    confirmSelectedPriceItemStatusChange,
    getPriceItemStatusConfirmationMeta,
    setPriceItemStatusFilter,
    setPriceItemQuery,
    setPriceItemsPage,
    updatePriceItemFormField,
    handleGroupBaseProviderChange,
    handleGroupBaseItemFilterChange,
    handleGroupComponentProviderChange,
    handleGroupComponentItemFilterChange,
    applyBaseItemToGroup,
    addGroupComponent,
    stepGroupComponentQuantity,
    updateGroupComponentQuantity,
    updateGroupComponentUnitPrice,
    moveGroupComponent,
    removeGroupComponent,
    togglePriceItemSort,
    isProviderActive,
  };
}
