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

function buildImportTemplateFileName(provider, form) {
  const normalizedName = String(provider?.name || "proveedor")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const listSuffix = String(form?.name || "lista-nueva")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

  return `plantilla-lista-precios-${normalizedName || "proveedor"}-${listSuffix || "lista-nueva"}.xlsx`;
}

function buildImportTemplateWorkbook({ currencyCode, itemTypeLabel }) {
  const templateWorksheet = XLSX.utils.aoa_to_sheet([
    ["Código", "Descripción", "Precio", "Moneda", "Estado", "Tipo"],
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
    ["Código", "Obligatorio", "Único dentro del archivo y de la lista"],
    ["Descripción", "Opcional", "Texto libre"],
    ["Precio", "Obligatorio", "Número mayor o igual a 0"],
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
  const [providerPriceListImportFile, setProviderPriceListImportFile] =
    useState(null);
  const [providerPriceListImportFileName, setProviderPriceListImportFileName] =
    useState("");
  const [providerPriceListImportPreview, setProviderPriceListImportPreview] =
    useState(null);
  const [reviewingProviderPriceListImport, setReviewingProviderPriceListImport] =
    useState(false);
  const [providerPriceListImportProgress, setProviderPriceListImportProgress] =
    useState(null);

  function buildDefaultProviderPriceListForm() {
    const defaultProductTypeCode = catalogs.productTypes?.[0]?.code || "producto";

    return {
      name: "",
      currencyId: String(catalogs.currencies?.[0]?.id || ""),
      itemType: defaultProductTypeCode,
    };
  }

  function getProviderPriceListTypeLabel(itemType) {
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

  function resetProviderPriceListImportState() {
    setProviderPriceListImportFile(null);
    setProviderPriceListImportFileName("");
    setProviderPriceListImportPreview(null);
    setReviewingProviderPriceListImport(false);
    setProviderPriceListImportProgress(null);
  }

  function buildImportPreview({
    rows,
    fileName,
    selectedCurrencyCode,
    selectedItemTypeCode,
    selectedItemTypeLabel,
    activeStatusId,
    inactiveStatusId,
    selectedCurrencyId,
  }) {
    const headerIndexes = getImportedHeaderIndexes(rows[0]);
    if (headerIndexes.code === undefined || headerIndexes.price === undefined) {
      throw new Error(
        "El Excel debe incluir al menos las columnas Código y Precio.",
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
        issues.push("El precio no es válido.");
      }

      if (
        importedCurrency &&
        normalizeText(selectedCurrencyCode) !== importedCurrency
      ) {
        issues.push(
          `La moneda ${row[headerIndexes.currency]} no coincide con la lista configurada (${selectedCurrencyCode}).`,
        );
      }

      if (
        importedItemType &&
        importedItemType !== normalizeText(selectedItemTypeCode) &&
        importedItemType !== normalizeText(selectedItemTypeLabel)
      ) {
        issues.push(
          `El tipo ${row[headerIndexes.itemType]} no coincide con la lista configurada (${selectedItemTypeLabel}).`,
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
        itemType: selectedItemTypeCode,
        price,
        currencyId: selectedCurrencyId,
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

  function buildImportResultMessage({ importedCount, failedRows, skippedCount }) {
    if (importedCount > 0 && failedRows.length === 0 && skippedCount === 0) {
      return `Lista creada y ${importedCount} producto${importedCount === 1 ? "" : "s"} importado${importedCount === 1 ? "" : "s"}`;
    }

    const segments = ["Lista creada"];

    if (importedCount > 0) {
      segments.push(
        `${importedCount} producto${importedCount === 1 ? "" : "s"} importado${importedCount === 1 ? "" : "s"}`,
      );
    } else {
      segments.push("sin productos importados");
    }

    if (failedRows.length > 0) {
      segments.push(
        `${failedRows.length} fila${failedRows.length === 1 ? "" : "s"} con error durante la carga`,
      );
    }

    if (skippedCount > 0) {
      segments.push(
        `${skippedCount} fila${skippedCount === 1 ? "" : "s"} omitida${skippedCount === 1 ? "" : "s"} en la revision previa`,
      );
    }

    return segments.join(", ");
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
    resetProviderPriceListImportState();
    setShowProviderPriceListCreateModal(true);
  }

  function closeProviderPriceListCreateModal() {
    if (savingProviderPriceList) return;
    setShowProviderPriceListCreateModal(false);
    setProviderPriceListForm(buildDefaultProviderPriceListForm());
    resetProviderPriceListImportState();
  }

  function updateProviderPriceListImportFile(file) {
    setProviderPriceListImportFile(file || null);
    setProviderPriceListImportFileName(file?.name || "");
    setProviderPriceListImportPreview(null);
    setProviderPriceListImportProgress(null);
  }

  function clearProviderPriceListImportFile() {
    resetProviderPriceListImportState();
  }

  function downloadProviderPriceListImportTemplate() {
    if (!providerPriceListModalProvider) return;

    const selectedCurrencyCode = String(
      catalogs.currencies.find(
        (currency) => Number(currency.id) === Number(providerPriceListForm.currencyId),
      )?.code || "",
    );
    const selectedItemTypeLabel = getProviderPriceListTypeLabel(
      providerPriceListForm.itemType,
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
          providerPriceListModalProvider,
          providerPriceListForm,
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

  async function reviewProviderPriceListImportFile() {
    if (!providerPriceListImportFile) {
      setError("Selecciona un archivo Excel antes de revisarlo.");
      return;
    }

    if (!String(providerPriceListForm.name || "").trim()) {
      setError("Completa el nombre de la lista antes de revisar el archivo.");
      return;
    }

    if (!providerPriceListForm.currencyId || !providerPriceListForm.itemType) {
      setError("Completa moneda y tipo antes de revisar el archivo.");
      return;
    }

    if (providerPriceListForm.itemType === "grupo_productos") {
      setError(
        "La importacion desde Excel no esta disponible para listas tipo Bundle.",
      );
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
    const selectedCurrencyId = Number(providerPriceListForm.currencyId);
    const selectedCurrencyCode = String(
      catalogs.currencies.find(
        (currency) => Number(currency.id) === selectedCurrencyId,
      )?.code || "",
    );
    const selectedItemTypeCode = String(providerPriceListForm.itemType || "producto");
    const selectedItemTypeLabel = getProviderPriceListTypeLabel(
      providerPriceListForm.itemType,
    );

    setError("");
    setSuccess("");
    setReviewingProviderPriceListImport(true);
    setProviderPriceListImportPreview(null);

    try {
      const workbook = XLSX.read(await providerPriceListImportFile.arrayBuffer(), {
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

      const preview = buildImportPreview({
        rows,
        fileName: String(providerPriceListImportFile.name || "archivo.xlsx"),
        selectedCurrencyCode,
        selectedItemTypeCode,
        selectedItemTypeLabel,
        activeStatusId,
        inactiveStatusId,
        selectedCurrencyId,
      });

      setProviderPriceListImportPreview(preview);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : getApiErrorMessage(
              err,
              "No fue posible revisar el archivo de importacion",
            ),
      );
    } finally {
      setReviewingProviderPriceListImport(false);
    }
  }

  async function saveProviderPriceList(event) {
    event.preventDefault();
    if (!providerPriceListModalProvider) return;

    if (providerPriceListImportFile && !providerPriceListImportPreview) {
      setError("Revisa el archivo antes de crear la lista e importar.");
      return;
    }

    if (
      providerPriceListImportPreview &&
      providerPriceListImportPreview.validItems.length === 0
    ) {
      setError(
        "No hay filas validas para importar. Corrige el archivo o quitalo para crear la lista vacia.",
      );
      return;
    }

    setError("");
    setSuccess("");
    setSavingProviderPriceList(true);
    setProviderPriceListImportProgress(null);

    try {
      const { data } = await api.post(
        `/api/providers/${providerPriceListModalProvider.id}/price-lists`,
        {
          name: String(providerPriceListForm.name || "").trim(),
          currencyId: Number(providerPriceListForm.currencyId),
          itemType: providerPriceListForm.itemType,
        },
      );

      const createdListId = Number(data?.id || 0);
      const preview = providerPriceListImportPreview;
      const failedRows = [];
      let importedCount = 0;

      if (preview?.validItems.length) {
        setProviderPriceListImportProgress({
          totalValid: preview.validItems.length,
          importedCount: 0,
          failedRows: [],
        });

        for (const item of preview.validItems) {
          try {
            await api.post(
              `/api/providers/${providerPriceListModalProvider.id}/price-lists/${createdListId}/items`,
              {
                code: item.code,
                description: item.description || undefined,
                itemType: item.itemType,
                price: item.price,
                currencyId: item.currencyId,
                activationStatusId: item.activationStatusId,
              },
            );
            importedCount += 1;
          } catch (err) {
            failedRows.push({
              excelRowNumber: item.excelRowNumber,
              code: item.code,
              message: getApiErrorMessage(
                err,
                "No fue posible importar el producto",
              ),
            });
          }

          setProviderPriceListImportProgress({
            totalValid: preview.validItems.length,
            importedCount,
            failedRows: [...failedRows],
          });
        }
      }

      setSuccess(
        preview
          ? buildImportResultMessage({
              importedCount,
              failedRows,
              skippedCount: preview.invalidRows.length,
            })
          : data?.message || "Lista de precios creada correctamente",
      );
      setShowProviderPriceListCreateModal(false);
      setProviderPriceListForm(buildDefaultProviderPriceListForm());
      resetProviderPriceListImportState();
      await openProviderPriceListModal(
        providerPriceListModalProvider,
        createdListId || null,
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
    if (field === "currencyId" || field === "itemType") {
      setProviderPriceListImportPreview(null);
      setProviderPriceListImportProgress(null);
    }
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
    providerPriceListImportFileName,
    providerPriceListImportPreview,
    reviewingProviderPriceListImport,
    providerPriceListImportProgress,
    visibleProviderPriceLists,
    setPriceListStatusFilter,
    openProviderPriceListModal,
    selectProviderPriceList,
    closeProviderPriceListModal,
    openCreateProviderPriceListModal,
    closeProviderPriceListCreateModal,
    saveProviderPriceList,
    updateProviderPriceListImportFile,
    clearProviderPriceListImportFile,
    downloadProviderPriceListImportTemplate,
    reviewProviderPriceListImportFile,
    togglePriceListMenu,
    runPriceListAction,
    updateProviderPriceListStatus,
    updateProviderPriceListFormField,
    loadProviderPriceLists,
    loadProviderPriceListItems,
    refreshProviderPriceLists,
  };
}