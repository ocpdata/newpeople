import {
  applyCreateQuotationPerItemVat,
  buildCreateQuotationDistributedBaseSections,
  buildItemDraft,
  buildSectionDraft,
  calculateCreateQuotationSummary,
  calculateQuotationItemDisplayTotals,
  applyCreateQuotationDistributedFinalDiscount,
  DEFAULT_QUOTATION_VAT_PCT,
  formatQuotationMoneyInputValue,
  formatQuotationAmount,
  sanitizeQuotationMoneyInputValue,
  stepQuantityValueByUnit,
} from "./quotationsUtils";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  QuotationCommercialConditionsCard,
  QuotationInternalNotesField,
} from "./QuotationCommercialFields";
import { buildQuotationPrintModel } from "./quotationPrintModel";
import QuotationPrintPreviewModal from "./QuotationPrintPreviewModal";
import QuotationProductPickerModal from "./QuotationProductPickerModal";
import QuotationWorkflowPanel from "./QuotationWorkflowPanel";
import { api, getApiErrorMessage } from "../api";

function updateDraftEntry(setter, entryId, currentValue, field, value) {
  setter((prev) => ({
    ...prev,
    [String(entryId)]: {
      ...currentValue,
      [field]: value,
    },
  }));
}

function formatQuotationDocumentSize(byteSize) {
  const numericValue = Number(byteSize || 0);
  if (!numericValue) return "0 KB";
  if (numericValue >= 1024 * 1024) {
    return `${(numericValue / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(numericValue / 1024))} KB`;
}

function formatQuotationDocumentDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("es-MX", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatSuggestedExchangeRate(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return "1.0000";
  }

  return numericValue.toFixed(4);
}

function buildBundleDraftComponents(product, providerOptions) {
  if (
    product.itemType !== "grupo_productos" ||
    !Array.isArray(product.components)
  ) {
    return [];
  }

  return product.components.map((component) => {
    const componentUnitPrice =
      component.unitPriceOverride ?? component.price ?? 0;

    return {
      ...buildItemDraft(providerOptions),
      providerId: String(component.providerId || product.providerId || ""),
      productCode: component.code || "",
      productDescription: component.description || "",
      quantity: String(component.quantity ?? 1),
      originalCurrencyCode:
        component.currencyCode || product.currencyCode || "USD",
      originalListPriceUnit: String(componentUnitPrice),
      listPriceUnit: String(componentUnitPrice),
      manufacturerDiscountPct: "0",
      importCostPct: "0",
      profitMarginPct: "0",
      finalDiscountPct: "0",
      itemType: component.itemType || "producto",
      bundleParentLocalId: "draft-bundle-parent",
      bundleOriginType: "price_list_bundle",
      sourceProviderPriceListItemId: null,
      sourceComponentPriceListItemId: component.componentItemId || null,
      bundleComponentItemId: component.componentItemId || null,
      isBundleComponent: true,
    };
  });
}

const ITEM_TABLE_COLUMNS = [
  {
    key: "selected",
    label: "",
    defaultWidth: 44,
  },
  {
    key: "rowNumber",
    label: "#",
    defaultWidth: 36,
  },
  {
    key: "productCode",
    label: "Codigo",
    defaultWidth: 120,
  },
  {
    key: "productDescription",
    label: "Descripcion",
    defaultWidth: 220,
  },
  {
    key: "quantity",
    label: "Cant.",
    defaultWidth: 64,
  },
  {
    key: "originalListPriceUnit",
    label: "Precio Lista M.O.",
    defaultWidth: 108,
  },
  {
    key: "listPriceUnit",
    label: "Precio de lista",
    defaultWidth: 88,
  },
  {
    key: "manufacturerDiscountPct",
    label: "Desc. prov. %",
    defaultWidth: 88,
  },
  {
    key: "discountedListPriceUnit",
    label: "Prec. lista desc.",
    defaultWidth: 88,
  },
  {
    key: "importCostPct",
    label: "Imp. %",
    defaultWidth: 88,
  },
  {
    key: "costUnit",
    label: "Costo unitario",
    defaultWidth: 88,
  },
  {
    key: "costTotal",
    label: "Costo total",
    defaultWidth: 100,
  },
  {
    key: "profitMarginPct",
    label: "Margen %",
    defaultWidth: 64,
  },
  {
    key: "finalDiscountPct",
    label: "Desc. final %",
    defaultWidth: 88,
  },
  {
    key: "salePriceUnit",
    label: "Precio venta unitario",
    defaultWidth: 108,
  },
  {
    key: "salePriceTotal",
    label: "Precio venta total",
    defaultWidth: 108,
  },
];

function QuantityInput({ value, onChange, onBlur, min = "0" }) {
  function handleStep(delta) {
    onChange(stepQuantityValueByUnit(value, delta, Number(min)));
  }

  return (
    <div className="quotation-quantity-input">
      <input
        type="number"
        min={min}
        step="any"
        value={value}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp") {
            event.preventDefault();
            handleStep(1);
          }

          if (event.key === "ArrowDown") {
            event.preventDefault();
            handleStep(-1);
          }
        }}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      <div className="quotation-quantity-step-buttons">
        <button
          type="button"
          className="quotation-quantity-step-button"
          aria-label="Aumentar cantidad"
          onClick={() => handleStep(1)}
        >
          +
        </button>
        <button
          type="button"
          className="quotation-quantity-step-button"
          aria-label="Disminuir cantidad"
          onClick={() => handleStep(-1)}
        >
          -
        </button>
      </div>
    </div>
  );
}

function OriginalListPriceInput({ ariaLabel, value, onChange, onBlur }) {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      value={
        isFocused ? String(value ?? "") : formatQuotationMoneyInputValue(value)
      }
      onFocus={() => setIsFocused(true)}
      onChange={(event) =>
        onChange(sanitizeQuotationMoneyInputValue(event.target.value))
      }
      onBlur={(event) => {
        const sanitizedValue = sanitizeQuotationMoneyInputValue(
          event.target.value,
        );
        setIsFocused(false);
        onBlur?.(sanitizedValue);
      }}
    />
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function UpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m6 15 6-6 6 6" />
    </svg>
  );
}

function DownIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="10" height="10" rx="2" />
      <path d="M5 15V7a2 2 0 0 1 2-2h8" />
    </svg>
  );
}

function PasteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 4h6" />
      <path d="M10 2h4a1 1 0 0 1 1 1v2H9V3a1 1 0 0 1 1-1Z" />
      <path d="M8 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2" />
    </svg>
  );
}

function DuplicateIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M5 15V6a1 1 0 0 1 1-1h9" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
    </svg>
  );
}

function HighlightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m6 14 8-8 4 4-8 8H6z" />
      <path d="M14 6 18 10" />
      <path d="M4 20h10" />
    </svg>
  );
}

function HighlightOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m6 14 8-8 4 4-8 8H6z" />
      <path d="M14 6 18 10" />
      <path d="M4 20h10" />
      <path d="M5 5 19 19" />
    </svg>
  );
}

function BundleManualIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="5" width="6" height="6" rx="1" />
      <rect x="14" y="5" width="6" height="6" rx="1" />
      <rect x="9" y="13" width="6" height="6" rx="1" />
      <path d="M10 8h4" />
      <path d="M12 11v2" />
    </svg>
  );
}

function BundleAttachIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="15" y="4" width="5" height="5" rx="1" />
      <rect x="15" y="15" width="5" height="5" rx="1" />
      <path d="M5 12h8" />
      <path d="m10 7 5 5-5 5" />
      <path d="M17.5 9v6" />
    </svg>
  );
}

function BundleDetachIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="4" width="5" height="5" rx="1" />
      <rect x="4" y="15" width="5" height="5" rx="1" />
      <path d="M11 12h8" />
      <path d="m14 9-3 3 3 3" />
      <path d="M6.5 9v6" />
    </svg>
  );
}

function BundleToggleIcon({ collapsed }) {
  return collapsed ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m9 6 6 6-6 6" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}

function InclusionIcon({ code }) {
  if (code === "no_incluida") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M6 6l12 12" />
        <path d="M18 6 6 18" />
      </svg>
    );
  }

  if (code === "opcional") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4" />
        <circle cx="12" cy="16" r="1" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}

function QuotationIconButton({
  title,
  children,
  disabled = false,
  danger = false,
  onClick,
}) {
  return (
    <button
      type="button"
      className={`quotation-icon-button${danger ? " is-danger" : ""}`}
      aria-label={title}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function moveListItem(list, fromIndex, toIndex) {
  if (
    !Array.isArray(list) ||
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= list.length ||
    toIndex >= list.length
  ) {
    return list;
  }

  const nextList = [...list];
  const [movedItem] = nextList.splice(fromIndex, 1);
  nextList.splice(toIndex, 0, movedItem);
  return nextList;
}

function moveSelectedListItems(list, selectedIds, direction) {
  const selectedIdSet = new Set(selectedIds);
  const blocks = [];

  for (let index = 0; index < list.length; ) {
    const rootLocalId =
      list[index]?.bundleParentLocalId || list[index]?.localId || null;
    const items = [list[index]];

    index += 1;
    while (
      index < list.length &&
      (list[index]?.bundleParentLocalId || list[index]?.localId || null) ===
        rootLocalId
    ) {
      items.push(list[index]);
      index += 1;
    }

    blocks.push({
      items,
      selected: items.some((item) => selectedIdSet.has(String(item.localId))),
    });
  }

  if (direction < 0) {
    for (let index = 1; index < blocks.length; index += 1) {
      if (blocks[index].selected && !blocks[index - 1].selected) {
        [blocks[index - 1], blocks[index]] = [blocks[index], blocks[index - 1]];
      }
    }
  } else {
    for (let index = blocks.length - 2; index >= 0; index -= 1) {
      if (blocks[index].selected && !blocks[index + 1].selected) {
        [blocks[index], blocks[index + 1]] = [blocks[index + 1], blocks[index]];
      }
    }
  }

  return blocks.flatMap((block) => block.items);
}

function formatSummaryDiscountInputValue(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return "0";
  }

  return numericValue
    .toFixed(2)
    .replace(/(\.\d*?[1-9])0+$/u, "$1")
    .replace(/\.0+$/u, "");
}

function sanitizeSummaryDiscountInputValue(value) {
  return String(value || "")
    .replace(/,/gu, "")
    .replace(/[^\d.]/gu, "")
    .replace(/(\..*)\./gu, "$1");
}

function getBundleHintMessage({
  manualSelection,
  attachSelection,
  detachSelection,
  preferredAction,
}) {
  const selectionByAction = {
    manual: manualSelection,
    attach: attachSelection,
    detach: detachSelection,
  };
  const fallbackOrder = ["detach", "attach", "manual"];
  const orderedActions = preferredAction
    ? [
        preferredAction,
        ...fallbackOrder.filter((action) => action !== preferredAction),
      ]
    : fallbackOrder;

  for (const action of orderedActions) {
    const selection = selectionByAction[action];
    if (selection && !selection.ok && selection.message) {
      return selection.message;
    }
  }

  return "";
}

function isEditableBundleOriginType(originType) {
  return originType === "manual_bundle" || originType === "price_list_bundle";
}

function getManualBundleSelectionState(sectionItems, selectedIds) {
  const selectedIdSet = new Set(selectedIds || []);
  const selectedItems = (sectionItems || []).filter((item) =>
    selectedIdSet.has(item.localId),
  );

  if (selectedItems.length < 2) {
    return {
      ok: false,
      message: "Selecciona al menos dos filas para crear un bundle manual.",
      items: [],
    };
  }

  const hasExistingBundleRows = selectedItems.some((item) => {
    const hasChildren = (sectionItems || []).some(
      (candidate) => candidate.bundleParentLocalId === item.localId,
    );

    return (
      Boolean(item.bundleParentLocalId) ||
      Boolean(item.isBundleComponent) ||
      item.itemType === "grupo_productos" ||
      hasChildren
    );
  });

  if (hasExistingBundleRows) {
    return {
      ok: false,
      message:
        "Solo puedes agrupar filas independientes. No se permiten bundles existentes ni componentes dentro de otro bundle.",
      items: [],
    };
  }

  return { ok: true, message: "", items: selectedItems };
}

function getAttachToManualBundleSelectionState(sectionItems, selectedIds) {
  const selectedIdSet = new Set(selectedIds || []);
  const selectedItems = (sectionItems || []).filter((item) =>
    selectedIdSet.has(item.localId),
  );

  if (selectedItems.length < 2) {
    return {
      ok: false,
      message:
        "Selecciona un bundle manual y al menos una fila independiente para agregar componentes.",
    };
  }

  const parentItems = selectedItems.filter(
    (item) =>
      item.itemType === "grupo_productos" &&
      !item.bundleParentLocalId &&
      isEditableBundleOriginType(item.bundleOriginType),
  );

  if (parentItems.length !== 1) {
    return {
      ok: false,
      message:
        "Selecciona exactamente un bundle existente y una o mas filas independientes.",
    };
  }

  const parentItem = parentItems[0];
  const componentItems = selectedItems.filter(
    (item) => item.localId !== parentItem.localId,
  );

  if (!componentItems.length) {
    return {
      ok: false,
      message:
        "Selecciona al menos una fila independiente adicional para agregarla al bundle.",
    };
  }

  const hasInvalidComponentItems = componentItems.some((item) => {
    const hasChildren = (sectionItems || []).some(
      (candidate) => candidate.bundleParentLocalId === item.localId,
    );

    return (
      Boolean(item.bundleParentLocalId) ||
      Boolean(item.isBundleComponent) ||
      item.itemType === "grupo_productos" ||
      hasChildren
    );
  });

  if (hasInvalidComponentItems) {
    return {
      ok: false,
      message:
        "Solo puedes agregar filas independientes. No se permiten otros bundles ni componentes ya agrupados.",
    };
  }

  return { ok: true, message: "" };
}

function getDetachFromManualBundleSelectionState(sectionItems, selectedIds) {
  const selectedIdSet = new Set(selectedIds || []);
  const selectedItems = (sectionItems || []).filter((item) =>
    selectedIdSet.has(item.localId),
  );

  if (!selectedItems.length) {
    return {
      ok: false,
      message:
        "Selecciona uno o mas componentes de un bundle manual para quitarlos del grupo.",
    };
  }

  const parentLocalIds = [
    ...new Set(
      selectedItems.map((item) => item.bundleParentLocalId).filter(Boolean),
    ),
  ];

  if (parentLocalIds.length !== 1) {
    return {
      ok: false,
      message: "Selecciona componentes que pertenezcan al mismo bundle manual.",
    };
  }

  const parentItem = (sectionItems || []).find(
    (item) => item.localId === parentLocalIds[0],
  );

  if (
    !parentItem ||
    parentItem.itemType !== "grupo_productos" ||
    !isEditableBundleOriginType(parentItem.bundleOriginType)
  ) {
    return {
      ok: false,
      message:
        "Solo puedes quitar componentes de bundles editables dentro de la tabla.",
    };
  }

  const hasInvalidItems = selectedItems.some(
    (item) =>
      item.bundleParentLocalId !== parentItem.localId ||
      !item.isBundleComponent ||
      !isEditableBundleOriginType(item.bundleOriginType),
  );

  if (hasInvalidItems) {
    return {
      ok: false,
      message:
        "Selecciona solo componentes del mismo bundle para quitarlos del grupo.",
    };
  }

  const siblingItems = (sectionItems || []).filter(
    (item) => item.bundleParentLocalId === parentItem.localId,
  );

  if (selectedItems.length >= siblingItems.length) {
    return {
      ok: false,
      message: "Debe quedar al menos un componente dentro del bundle.",
    };
  }

  return { ok: true, message: "" };
}

function QuotationEditorContent({
  selectedVersion,
  selectedQuotation,
  closeEditQuotationModal,
  openQuotationPrintView,
  companyBranding,
  error,
  success,
  versionForm,
  setVersionForm,
  contactOptions,
  catalogs,
  busyAction,
  allowedActions,
  handleSaveVersion,
  handleSaveAsNewVersion,
  handleUploadQuotationDocuments,
  handleDownloadQuotationDocument,
  handleAction,
  sectionDraft,
  setSectionDraft,
  handleCreateSection,
  sectionEdits,
  setSectionEdits,
  itemEdits,
  setItemEdits,
  itemDraftsBySection,
  setItemDraftsBySection,
  handleSaveSection,
  handleMoveEditSection,
  handleRemoveEditSection,
  handleSaveItem,
  handleCreateItem,
  handleApplyEditSectionItemProduct,
  handleCreateEditManualBundle,
  handleAttachEditSectionItemsToManualBundle,
  handleDetachEditSectionItemsFromManualBundle,
  handleRemoveEditSectionItems,
  handleDuplicateEditSectionItems,
  handleCopyEditSectionItems,
  handlePasteEditSectionItems,
  hasEditCopiedItems,
  canCreateProviderPrices,
}) {
  const [isSummaryDiscountInputFocused, setIsSummaryDiscountInputFocused] =
    useState(false);
  const [
    preferredBundleHintActionBySection,
    setPreferredBundleHintActionBySection,
  ] = useState({});
  const [manualBundlePickerState, setManualBundlePickerState] = useState({
    isOpen: false,
    sectionId: null,
    parentLocalId: "",
  });
  const [productPickerState, setProductPickerState] = useState({
    isOpen: false,
    mode: "existing",
    sectionId: null,
    itemId: null,
    providerId: "",
    priceListId: "",
    activeLists: [],
    loadingLists: false,
    query: "",
    isCreateMode: false,
    creating: false,
    createError: "",
    createForm: {
      code: "",
      description: "",
      price: "",
    },
    loading: false,
    error: "",
    results: [],
  });
  const [selectedItemIdsBySection, setSelectedItemIdsBySection] = useState({});
  const [highlightedItemIdsBySection, setHighlightedItemIdsBySection] =
    useState({});
  const [collapsedBundleIdsBySection, setCollapsedBundleIdsBySection] =
    useState({});
  const [activeDescriptionEditor, setActiveDescriptionEditor] = useState({
    sectionId: null,
    itemId: null,
  });
  const [isPrintPreviewModalOpen, setIsPrintPreviewModalOpen] = useState(false);
  const [documentViewMode, setDocumentViewMode] = useState("current");
  const [isExchangeRateLoading, setIsExchangeRateLoading] = useState(false);
  const [exchangeRateFeedback, setExchangeRateFeedback] = useState("");
  const [exchangeRateError, setExchangeRateError] = useState("");
  const newItemCodeInputRefs = useRef({});
  const quotationDocumentsInputRef = useRef(null);
  const exchangeRateRequestSequenceRef = useRef(0);
  const exchangeRateManualOverrideRef = useRef(0);
  const selectedVersionSections = selectedVersion?.sections || [];
  const summaryDiscountMode =
    versionForm.summaryDiscountMode === "amount" ? "amount" : "percentage";
  const summaryDistributionMode =
    versionForm.summaryDistributionMode === "per_item" ? "per_item" : "total";
  const summaryVatMode =
    versionForm.summaryVatMode === "total"
      ? "total"
      : versionForm.summaryVatMode === "per_item"
        ? "per_item"
        : "without_vat";
  const normalizedSummarySections = useMemo(
    () =>
      selectedVersionSections.map((section) => ({
        ...section,
        localId: String(section.id),
        items: (section.items || []).map((item) => {
          const itemDraftValue = itemEdits[String(item.id)] || item;

          return {
            ...item,
            ...itemDraftValue,
            localId: String(item.id),
            bundleParentLocalId: item.bundleParentItemId
              ? String(item.bundleParentItemId)
              : null,
            isBundleComponent: Boolean(item.bundleParentItemId),
          };
        }),
      })),
    [itemEdits, selectedVersionSections],
  );
  const distributedBaseSummarySections = useMemo(
    () =>
      buildCreateQuotationDistributedBaseSections(normalizedSummarySections),
    [normalizedSummarySections],
  );
  const summaryDiscountPreviewSections = useMemo(
    () =>
      summaryVatMode === "per_item"
        ? applyCreateQuotationPerItemVat(
            summaryDistributionMode === "per_item"
              ? distributedBaseSummarySections
              : normalizedSummarySections,
            DEFAULT_QUOTATION_VAT_PCT,
          )
        : summaryDistributionMode === "per_item"
          ? distributedBaseSummarySections
          : normalizedSummarySections,
    [
      distributedBaseSummarySections,
      normalizedSummarySections,
      summaryDistributionMode,
      summaryVatMode,
    ],
  );
  const summaryDiscountPreview = useMemo(
    () =>
      calculateCreateQuotationSummary(summaryDiscountPreviewSections, {
        mode: summaryDiscountMode,
        value: Number(versionForm.summaryDiscountValue) || 0,
      }),
    [
      summaryDiscountPreviewSections,
      summaryDiscountMode,
      versionForm.summaryDiscountValue,
    ],
  );
  const discountedSummarySections = useMemo(() => {
    if (summaryDistributionMode !== "per_item") {
      return normalizedSummarySections;
    }

    return applyCreateQuotationDistributedFinalDiscount(
      distributedBaseSummarySections,
      summaryDiscountPreview.summaryDiscountPct,
    );
  }, [
    distributedBaseSummarySections,
    normalizedSummarySections,
    summaryDistributionMode,
    summaryDiscountPreview.summaryDiscountPct,
  ]);
  const effectiveSummarySections = useMemo(
    () =>
      summaryVatMode === "per_item"
        ? applyCreateQuotationPerItemVat(
            discountedSummarySections,
            DEFAULT_QUOTATION_VAT_PCT,
          )
        : discountedSummarySections,
    [discountedSummarySections, summaryVatMode],
  );
  const effectiveSummaryItemsById = useMemo(() => {
    const itemsById = new Map();

    effectiveSummarySections.forEach((section) => {
      (section.items || []).forEach((item) => {
        itemsById.set(String(item.localId), item);
      });
    });

    return itemsById;
  }, [effectiveSummarySections]);
  const quotationSummary = useMemo(
    () =>
      calculateCreateQuotationSummary(
        effectiveSummarySections,
        summaryDistributionMode === "per_item"
          ? null
          : {
              mode: summaryDiscountMode,
              value: Number(versionForm.summaryDiscountValue) || 0,
            },
        {
          mode: summaryVatMode === "total" ? "total" : "without_vat",
          vatPct: DEFAULT_QUOTATION_VAT_PCT,
        },
      ),
    [
      effectiveSummarySections,
      summaryDiscountMode,
      summaryDistributionMode,
      versionForm.summaryDiscountValue,
      summaryVatMode,
    ],
  );
  const selectedContextContactName =
    contactOptions.find(
      (contact) => Number(contact.id) === Number(versionForm.contactId || 0),
    )?.full_name || "";
  const selectedContextContact = useMemo(
    () =>
      contactOptions.find(
        (contact) => Number(contact.id) === Number(versionForm.contactId || 0),
      ) || null,
    [contactOptions, versionForm.contactId],
  );
  const formattedOpportunityAmount =
    selectedQuotation?.opportunityAmountUsd == null
      ? ""
      : formatQuotationAmount(selectedQuotation.opportunityAmountUsd);
  const formattedOpportunityCloseDate =
    selectedQuotation?.opportunityCloseDate || "";
  const selectedSellerName = selectedQuotation?.sellerUserName || "";
  const printSections = useMemo(
    () =>
      (selectedVersion?.sections || []).map((section) => {
        const sectionDraftValue =
          sectionEdits[String(section.id)] ||
          buildSectionDraft(catalogs.inclusionTypes);
        const sectionDisplayItems = buildSectionDisplayItems(section);
        const collapsedBundleIds = new Set(
          collapsedBundleIdsBySection[String(section.id)] || [],
        );
        const effectiveSectionItems =
          effectiveSummarySections.find(
            (candidateSection) =>
              Number(candidateSection.id) === Number(section.id),
          )?.items || sectionDisplayItems;
        const effectiveSectionItemsById = new Map(
          effectiveSectionItems.map((item) => [
            String(item.localId || item.id),
            item,
          ]),
        );

        const subtotal = sectionDisplayItems
          .filter((item) => !item.bundleParentLocalId)
          .reduce((accumulator, item) => {
            const effectiveItem =
              effectiveSectionItemsById.get(String(item.localId || item.id)) ||
              item;
            const totals = calculateQuotationItemDisplayTotals(
              effectiveItem,
              effectiveSectionItems,
            );

            return accumulator + Number(totals.salePriceTotal || 0);
          }, 0);

        const rows = sectionDisplayItems
          .map((item) => {
            const displayItem =
              effectiveSectionItemsById.get(String(item.localId || item.id)) ||
              item;
            const isBundleComponent = Boolean(displayItem.isBundleComponent);
            const bundleParentLocalId = displayItem.bundleParentLocalId
              ? String(displayItem.bundleParentLocalId)
              : null;

            if (
              bundleParentLocalId &&
              collapsedBundleIds.has(bundleParentLocalId)
            ) {
              return null;
            }

            const totals = calculateQuotationItemDisplayTotals(
              displayItem,
              effectiveSectionItems,
            );

            return {
              id: displayItem.localId || item.localId || item.id,
              displayOrder: displayItem.displayOrder,
              productCode: displayItem.productCode,
              productDescription: displayItem.productDescription,
              quantity: displayItem.quantity,
              quantityDisplay: Number(displayItem.quantity || 0).toFixed(2),
              salePriceUnit: totals.salePriceUnit,
              salePriceTotal: totals.salePriceTotal,
            };
          })
          .filter(Boolean);

        return {
          id: section.id,
          title: sectionDraftValue.title || `Seccion ${section.id}`,
          subtotal,
          rows,
        };
      }),
    [
      catalogs.inclusionTypes,
      collapsedBundleIdsBySection,
      effectiveSummaryItemsById,
      effectiveSummarySections,
      sectionEdits,
      selectedVersion?.sections,
    ],
  );
  const printModel = useMemo(
    () =>
      buildQuotationPrintModel({
        company: companyBranding,
        quotationNumber: String(selectedQuotation?.id || ""),
        versionNumber: String(selectedVersion?.versionNumber || ""),
        proposalName: versionForm.proposalName,
        quotationDate: versionForm.quotationDate,
        accountName: selectedQuotation?.accountName || "",
        contactName:
          selectedContextContact?.full_name ||
          selectedContextContact?.fullName ||
          selectedContextContactName,
        contactEmail: selectedContextContact?.email || "",
        contactPhone: selectedContextContact?.phone || "",
        sellerName: selectedSellerName,
        sellerEmail: selectedQuotation?.sellerUserEmail || "",
        sellerPhone: selectedQuotation?.sellerUserPhone || "",
        introduction: versionForm.introduction,
        sections: printSections,
        summary: {
          subtotal: quotationSummary.totalSalePriceTotal,
          discount: quotationSummary.discountAmount,
          discountedSubtotal: quotationSummary.discountedTotalAmount,
          vatAmount: quotationSummary.vatAmount,
          total:
            quotationSummary.summaryVatMode === "total"
              ? quotationSummary.totalWithVatAmount
              : quotationSummary.discountedTotalAmount,
          showVat: quotationSummary.summaryVatMode === "total",
          vatMode: summaryVatMode,
          currencyCode: versionForm.currencyCode || "USD",
        },
        deliveryTime: versionForm.deliveryTime,
        quotationValidity: versionForm.quotationValidity,
        warranty: versionForm.warranty,
        paymentTerms: versionForm.paymentTerms,
        currencyCode: versionForm.currencyCode,
        quotationNotes: versionForm.quotationNotes,
        catalogs,
      }),
    [
      catalogs,
      companyBranding,
      printSections,
      quotationSummary,
      selectedContextContact,
      selectedContextContactName,
      selectedQuotation,
      selectedVersion,
      selectedSellerName,
      versionForm,
    ],
  );

  function openPrintPreviewModal() {
    setIsPrintPreviewModalOpen(true);
  }

  function closePrintPreviewModal() {
    setIsPrintPreviewModalOpen(false);
  }

  function handleOpenPdfPreview() {
    const opened = openQuotationPrintView(printModel);
    if (opened) {
      closePrintPreviewModal();
    }
  }
  const canCreateNewVersion = Array.isArray(allowedActions)
    ? allowedActions.some((action) => action.code === "crear_version")
    : false;
  const currentVersionDocuments = Array.isArray(selectedVersion?.documents)
    ? selectedVersion.documents
    : [];
  const allQuotationDocuments = Array.isArray(selectedVersion?.allDocuments)
    ? selectedVersion.allDocuments
    : [];
  const visibleDocuments =
    documentViewMode === "all" ? allQuotationDocuments : currentVersionDocuments;
  const isUploadingDocuments = busyAction === "upload-quotation-documents";

  useEffect(() => {
    setSelectedItemIdsBySection({});
    setHighlightedItemIdsBySection({});
    setCollapsedBundleIdsBySection({});
    setActiveDescriptionEditor({ sectionId: null, itemId: null });
    setPreferredBundleHintActionBySection({});
    setManualBundlePickerState({
      isOpen: false,
      sectionId: null,
      parentLocalId: "",
    });
    setDocumentViewMode("current");
    setIsExchangeRateLoading(false);
    setExchangeRateFeedback("");
    setExchangeRateError("");
    exchangeRateRequestSequenceRef.current = 0;
    exchangeRateManualOverrideRef.current = 0;
  }, [selectedVersion?.id]);

  async function handleCommercialConditionFieldChange(field, value) {
    if (field === "exchangeRate") {
      exchangeRateManualOverrideRef.current =
        exchangeRateRequestSequenceRef.current;
      setIsExchangeRateLoading(false);
      setExchangeRateError("");
      setExchangeRateFeedback("");
      setVersionForm((prev) => ({
        ...prev,
        exchangeRate: value,
      }));
      return;
    }

    if (field !== "currencyCode") {
      setVersionForm((prev) => ({
        ...prev,
        [field]: value,
      }));
      return;
    }

    const nextCurrencyCode = String(value || "")
      .trim()
      .toUpperCase();

    setVersionForm((prev) => ({
      ...prev,
      currencyCode: nextCurrencyCode,
    }));
    setExchangeRateError("");
    setExchangeRateFeedback("");

    const requestId = exchangeRateRequestSequenceRef.current + 1;
    exchangeRateRequestSequenceRef.current = requestId;
    exchangeRateManualOverrideRef.current = 0;

    if (!nextCurrencyCode || nextCurrencyCode === "USD") {
      setIsExchangeRateLoading(false);
      setVersionForm((prev) => {
        if (
          String(prev.currencyCode || "")
            .trim()
            .toUpperCase() !== nextCurrencyCode
        ) {
          return prev;
        }

        return {
          ...prev,
          exchangeRate: "1.0000",
        };
      });
      setExchangeRateFeedback("Tipo sugerido automaticamente con base USD.");
      return;
    }

    setIsExchangeRateLoading(true);

    try {
      const { data } = await api.get("/api/quotation-exchange-rate", {
        params: {
          currency: nextCurrencyCode,
        },
      });

      if (requestId !== exchangeRateRequestSequenceRef.current) {
        return;
      }
      if (exchangeRateManualOverrideRef.current === requestId) {
        return;
      }

      setVersionForm((prev) => {
        if (
          String(prev.currencyCode || "")
            .trim()
            .toUpperCase() !== nextCurrencyCode
        ) {
          return prev;
        }

        return {
          ...prev,
          exchangeRate: formatSuggestedExchangeRate(data?.exchangeRate),
        };
      });
      setExchangeRateFeedback(
        `Tipo sugerido desde Frankfurter (${data?.baseCurrency || "USD"} -> ${data?.targetCurrency || nextCurrencyCode}).`,
      );
      setExchangeRateError("");
    } catch (error) {
      if (requestId !== exchangeRateRequestSequenceRef.current) {
        return;
      }

      setExchangeRateFeedback("");
      setExchangeRateError(
        getApiErrorMessage(
          error,
          "No fue posible obtener el tipo de cambio sugerido. Puedes capturarlo manualmente.",
        ),
      );
    } finally {
      if (requestId === exchangeRateRequestSequenceRef.current) {
        setIsExchangeRateLoading(false);
      }
    }
  }

  async function handleQuotationDocumentsInputChange(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) {
      return;
    }

    await handleUploadQuotationDocuments(files);
    event.target.value = "";
  }

  function buildSectionDisplayItems(section) {
    return [...(section?.items || [])]
      .map((item, index) => ({
        ...item,
        displayOrder:
          Number(itemEdits[String(item.id)]?.displayOrder) ||
          Number(item.displayOrder) ||
          index + 1,
      }))
      .sort((leftItem, rightItem) => {
        const leftOrder = Number(leftItem.displayOrder || 0);
        const rightOrder = Number(rightItem.displayOrder || 0);
        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }

        return Number(leftItem.id) - Number(rightItem.id);
      })
      .map((item) => {
        const itemDraftValue =
          itemEdits[String(item.id)] || buildItemDraft(catalogs.providers);

        return {
          ...item,
          ...itemDraftValue,
          localId: String(item.id),
          bundleParentLocalId: item.bundleParentItemId
            ? String(item.bundleParentItemId)
            : null,
          isBundleComponent: Boolean(item.bundleParentItemId),
        };
      });
  }

  function toggleSectionItemSelection(sectionId, itemId, checked) {
    setSelectedItemIdsBySection((prev) => {
      const sectionKey = String(sectionId);
      const itemKey = String(itemId);
      const currentIds = prev[sectionKey] || [];

      if (checked) {
        if (currentIds.includes(itemKey)) {
          return prev;
        }

        return {
          ...prev,
          [sectionKey]: [...currentIds, itemKey],
        };
      }

      return {
        ...prev,
        [sectionKey]: currentIds.filter((currentId) => currentId !== itemKey),
      };
    });
  }

  function toggleAllSectionItems(sectionId, itemIds, checked) {
    setSelectedItemIdsBySection((prev) => ({
      ...prev,
      [String(sectionId)]: checked
        ? itemIds.map((itemId) => String(itemId))
        : [],
    }));
  }

  function highlightSelectedItems(sectionId) {
    const sectionKey = String(sectionId);
    const selectedIds = selectedItemIdsBySection[sectionKey] || [];
    if (!selectedIds.length) {
      return;
    }

    setHighlightedItemIdsBySection((prev) => ({
      ...prev,
      [sectionKey]: [...new Set([...(prev[sectionKey] || []), ...selectedIds])],
    }));
  }

  function unhighlightSelectedItems(sectionId) {
    const sectionKey = String(sectionId);
    const selectedIds = selectedItemIdsBySection[sectionKey] || [];
    if (!selectedIds.length) {
      return;
    }

    setHighlightedItemIdsBySection((prev) => ({
      ...prev,
      [sectionKey]: (prev[sectionKey] || []).filter(
        (itemId) => !selectedIds.includes(itemId),
      ),
    }));
  }

  function openDescriptionEditor(sectionId, itemId) {
    setActiveDescriptionEditor({
      sectionId: String(sectionId),
      itemId: String(itemId),
    });
  }

  function closeDescriptionEditor() {
    setActiveDescriptionEditor({ sectionId: null, itemId: null });
  }

  function handleDescriptionEditorBlur(event) {
    if (event.currentTarget.contains(event.relatedTarget)) {
      return;
    }

    closeDescriptionEditor();
  }

  function handleDescriptionEditorEscape(event, itemId, itemDraftValue) {
    if (event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    saveExistingItemDraft(itemId, {
      ...itemDraftValue,
      productDescription: event.currentTarget.value,
    });
    closeDescriptionEditor();
    event.currentTarget.blur();
  }

  function toggleBundleCollapsed(sectionId, bundleLocalId, sectionItems) {
    const sectionKey = String(sectionId);
    const bundleKey = String(bundleLocalId);
    const componentIds = (sectionItems || [])
      .filter((item) => String(item.bundleParentLocalId) === bundleKey)
      .map((item) => String(item.localId || item.id));

    setCollapsedBundleIdsBySection((prev) => {
      const currentIds = prev[sectionKey] || [];
      const isCollapsed = currentIds.includes(bundleKey);
      const nextIds = isCollapsed
        ? currentIds.filter((currentId) => currentId !== bundleKey)
        : [...currentIds, bundleKey];

      if (!isCollapsed && componentIds.length) {
        setSelectedItemIdsBySection((currentSelection) => {
          const selectedIds = currentSelection[sectionKey] || [];
          const hasSelectedComponents = componentIds.some((itemId) =>
            selectedIds.includes(itemId),
          );

          if (!hasSelectedComponents) {
            return currentSelection;
          }

          const nextSelectedIds = selectedIds.filter(
            (itemId) => !componentIds.includes(itemId),
          );

          if (!nextSelectedIds.includes(bundleKey)) {
            nextSelectedIds.push(bundleKey);
          }

          return {
            ...currentSelection,
            [sectionKey]: nextSelectedIds,
          };
        });
      }

      return {
        ...prev,
        [sectionKey]: nextIds,
      };
    });
  }

  function moveSelectedItems(sectionId, items, direction) {
    const sectionKey = String(sectionId);
    const selectedIds = selectedItemIdsBySection[sectionKey] || [];
    if (!selectedIds.length) {
      return;
    }

    const orderedItems = moveSelectedListItems(items, selectedIds, direction);

    setItemEdits((prev) => {
      const next = { ...prev };

      orderedItems.forEach((item, index) => {
        const itemKey = String(item.id);
        const currentDraft = prev[itemKey] || item;
        next[itemKey] = {
          ...currentDraft,
          displayOrder: index + 1,
        };
      });

      return next;
    });
  }

  function setPreferredBundleHintAction(sectionId, action) {
    setPreferredBundleHintActionBySection((prev) => {
      const sectionKey = String(sectionId);
      if (prev[sectionKey] === action) {
        return prev;
      }

      return {
        ...prev,
        [sectionKey]: action,
      };
    });
  }

  function clearPreferredBundleHintAction(sectionId, action) {
    setPreferredBundleHintActionBySection((prev) => {
      const sectionKey = String(sectionId);
      if (prev[sectionKey] !== action) {
        return prev;
      }

      const next = { ...prev };
      delete next[sectionKey];
      return next;
    });
  }

  function openProductPicker({
    mode,
    sectionId,
    itemId = null,
    providerId = "",
    query = "",
  }) {
    setProductPickerState({
      isOpen: true,
      mode,
      sectionId,
      itemId,
      providerId: String(providerId || ""),
      priceListId: "",
      activeLists: [],
      loadingLists: false,
      query: String(query || "").trim(),
      isCreateMode: false,
      creating: false,
      createError: "",
      createForm: {
        code: "",
        description: "",
        price: "",
      },
      loading: false,
      error: "",
      results: [],
    });
  }

  function closeProductPicker() {
    setProductPickerState({
      isOpen: false,
      mode: "existing",
      sectionId: null,
      itemId: null,
      providerId: "",
      priceListId: "",
      activeLists: [],
      loadingLists: false,
      query: "",
      isCreateMode: false,
      creating: false,
      createError: "",
      createForm: {
        code: "",
        description: "",
        price: "",
      },
      loading: false,
      error: "",
      results: [],
    });
  }

  function openManualBundlePicker(sectionId, sectionItems, selectedItemIds) {
    const selection = getManualBundleSelectionState(
      sectionItems,
      selectedItemIds,
    );
    if (!selection.ok) {
      return;
    }

    setManualBundlePickerState({
      isOpen: true,
      sectionId,
      parentLocalId: selection.items[0]?.localId || "",
    });
  }

  function closeManualBundlePicker() {
    setManualBundlePickerState({
      isOpen: false,
      sectionId: null,
      parentLocalId: "",
    });
  }

  async function confirmManualBundle() {
    if (!manualBundlePickerState.isOpen) {
      return;
    }

    const createdIds = await handleCreateEditManualBundle(
      manualBundlePickerState.sectionId,
      selectedItemIdsBySection[String(manualBundlePickerState.sectionId)] || [],
      manualBundlePickerState.parentLocalId,
    );

    if (createdIds.length) {
      setSelectedItemIdsBySection((prev) => ({
        ...prev,
        [String(manualBundlePickerState.sectionId)]: createdIds,
      }));
      closeManualBundlePicker();
    }
  }

  function applyProductToNewItemDraft(sectionId, product) {
    setItemDraftsBySection((prev) => {
      const currentDraft =
        prev[String(sectionId)] || buildItemDraft(catalogs.providers);
      const bundleComponents = buildBundleDraftComponents(
        product,
        catalogs.providers,
      );

      return {
        ...prev,
        [String(sectionId)]: {
          ...currentDraft,
          providerId: String(
            product.providerId || currentDraft.providerId || "",
          ),
          productCode: product.code || "",
          productDescription: product.description || "",
          listPriceUnit: String(
            product.price ?? currentDraft.listPriceUnit ?? "0",
          ),
          itemType: product.itemType || "producto",
          bundleParentItemId: null,
          bundleOriginType:
            product.itemType === "grupo_productos" ? "price_list_bundle" : null,
          sourceProviderPriceListItemId: product.id ? Number(product.id) : null,
          sourceComponentPriceListItemId: null,
          bundleSortOrder: null,
          bundleComponents,
        },
      };
    });
  }

  async function handleSelectProduct(product) {
    if (
      product.itemType === "grupo_productos" &&
      productPickerState.mode !== "draft"
    ) {
      const section = selectedVersionSections.find(
        (candidate) =>
          Number(candidate.id) === Number(productPickerState.sectionId),
      );
      const currentItem = (section?.items || []).find(
        (candidate) =>
          Number(candidate.id) === Number(productPickerState.itemId),
      );
      const hasChildren = (section?.items || []).some(
        (candidate) =>
          Number(candidate.bundleParentItemId) ===
          Number(productPickerState.itemId),
      );

      if (!currentItem || currentItem.bundleParentItemId || hasChildren) {
        setProductPickerState((prev) => ({
          ...prev,
          error:
            "Solo puedes convertir en bundle una fila existente que no sea componente ni tenga componentes actuales.",
        }));
        return;
      }
    }

    if (productPickerState.mode === "draft") {
      applyProductToNewItemDraft(productPickerState.sectionId, product);
    } else {
      await handleApplyEditSectionItemProduct(
        productPickerState.sectionId,
        productPickerState.itemId,
        product,
      );
    }

    closeProductPicker();
  }

  useEffect(() => {
    if (!productPickerState.isOpen) return undefined;

    if (!productPickerState.providerId) {
      setProductPickerState((prev) => ({
        ...prev,
        loadingLists: false,
        priceListId: "",
        activeLists: [],
        loading: false,
        error: "",
        results: [],
        isCreateMode: false,
        createError: "",
      }));
      return undefined;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      setProductPickerState((prev) => ({
        ...prev,
        loadingLists: true,
        error: "",
      }));

      try {
        const { data } = await api.get("/api/quotation-product-lists", {
          params: {
            providerId: productPickerState.providerId,
          },
        });

        if (cancelled) return;
        setProductPickerState((prev) => ({
          ...prev,
          loadingLists: false,
          activeLists: Array.isArray(data) ? data : [],
          priceListId:
            Array.isArray(data) && data.length
              ? String(data[0].id)
              : "",
          results: Array.isArray(data) && data.length ? prev.results : [],
          isCreateMode: Array.isArray(data) && data.length ? prev.isCreateMode : false,
        }));
      } catch (error) {
        if (cancelled) return;
        setProductPickerState((prev) => ({
          ...prev,
          loadingLists: false,
          error: getApiErrorMessage(
            error,
            "No fue posible cargar las listas activas del proveedor",
          ),
        }));
      }
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    productPickerState.isOpen,
    productPickerState.providerId,
  ]);

  useEffect(() => {
    if (!productPickerState.isOpen || productPickerState.isCreateMode) {
      return undefined;
    }

    if (!productPickerState.providerId || !productPickerState.priceListId) {
      setProductPickerState((prev) => ({
        ...prev,
        loading: false,
        error: "",
        results: [],
      }));
      return undefined;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      setProductPickerState((prev) => ({
        ...prev,
        loading: true,
        error: "",
      }));

      try {
        const { data } = await api.get("/api/quotation-products/search", {
          params: {
            providerId: productPickerState.providerId,
            priceListId: productPickerState.priceListId,
            q: productPickerState.query,
            limit: 25,
          },
        });

        if (cancelled) return;
        setProductPickerState((prev) => ({
          ...prev,
          loading: false,
          results: Array.isArray(data) ? data : [],
        }));
      } catch (error) {
        if (cancelled) return;
        setProductPickerState((prev) => ({
          ...prev,
          loading: false,
          error: getApiErrorMessage(
            error,
            "No fue posible cargar los productos disponibles",
          ),
        }));
      }
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    productPickerState.isOpen,
    productPickerState.isCreateMode,
    productPickerState.providerId,
    productPickerState.priceListId,
    productPickerState.query,
  ]);

  function handleProductPickerProviderChange(providerId) {
    setProductPickerState((prev) => ({
      ...prev,
      providerId: String(providerId || ""),
      priceListId: "",
      activeLists: [],
      loadingLists: false,
      query: "",
      isCreateMode: false,
      createError: "",
      error: "",
      results: [],
    }));
  }

  function handleProductPickerQueryChange(queryValue) {
    setProductPickerState((prev) => ({
      ...prev,
      query: queryValue,
    }));
  }

  function openQuickCreateProduct() {
    setProductPickerState((prev) => ({
      ...prev,
      isCreateMode: true,
      createError: "",
      createForm: {
        code: "",
        description: "",
        price: "",
      },
    }));
  }

  function cancelQuickCreateProduct() {
    setProductPickerState((prev) => ({
      ...prev,
      isCreateMode: false,
      createError: "",
    }));
  }

  function handleQuickCreateFieldChange(field, value) {
    setProductPickerState((prev) => ({
      ...prev,
      createForm: {
        ...prev.createForm,
        [field]: value,
      },
    }));
  }

  async function handleQuickCreateSubmit(event) {
    event.preventDefault();

    setProductPickerState((prev) => ({
      ...prev,
      creating: true,
      createError: "",
    }));

    try {
      const { data } = await api.post("/api/quotation-products", {
        providerId: Number(productPickerState.providerId),
        priceListId: Number(productPickerState.priceListId),
        code: String(productPickerState.createForm.code || "").trim(),
        description: String(productPickerState.createForm.description || ""),
        price: Number(productPickerState.createForm.price),
      });

      if (!data?.product) {
        throw new Error("El producto creado no fue devuelto por la API");
      }

      await handleSelectProduct(data.product);
    } catch (error) {
      setProductPickerState((prev) => ({
        ...prev,
        creating: false,
        createError: getApiErrorMessage(
          error,
          "No fue posible crear el producto",
        ),
      }));
      return;
    }
  }

  const activeManualBundleSection = manualBundlePickerState.sectionId
    ? selectedVersionSections.find(
        (section) =>
          Number(section.id) === Number(manualBundlePickerState.sectionId),
      ) || null
    : null;
  const activeManualBundleSelection = activeManualBundleSection
    ? getManualBundleSelectionState(
        buildSectionDisplayItems(activeManualBundleSection),
        selectedItemIdsBySection[String(activeManualBundleSection.id)] || [],
      )
    : { ok: false, message: "", items: [] };

  useEffect(() => {
    if (!manualBundlePickerState.isOpen) {
      return;
    }

    if (!activeManualBundleSection || !activeManualBundleSelection.ok) {
      closeManualBundlePicker();
      return;
    }

    if (
      !activeManualBundleSelection.items.some(
        (item) => item.localId === manualBundlePickerState.parentLocalId,
      )
    ) {
      setManualBundlePickerState((prev) => ({
        ...prev,
        parentLocalId: activeManualBundleSelection.items[0]?.localId || "",
      }));
    }
  }, [
    activeManualBundleSection,
    activeManualBundleSelection,
    manualBundlePickerState.isOpen,
    manualBundlePickerState.parentLocalId,
  ]);

  function getSummaryDiscountDisplayValue() {
    if (summaryDiscountMode !== "amount" || isSummaryDiscountInputFocused) {
      return versionForm.summaryDiscountValue || "0";
    }

    const numericValue = Number(versionForm.summaryDiscountValue);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return "0";
    }

    return formatQuotationAmount(versionForm.summaryDiscountValue);
  }

  function handleSummaryDiscountModeChange(nextMode) {
    if (nextMode === summaryDiscountMode) {
      return;
    }

    const nextValue =
      nextMode === "amount"
        ? formatSummaryDiscountInputValue(summaryDiscountPreview.discountAmount)
        : formatSummaryDiscountInputValue(
            summaryDiscountPreview.summaryDiscountPct,
          );

    setVersionForm((prev) => ({
      ...prev,
      summaryDiscountMode: nextMode,
      summaryDiscountValue: nextValue,
    }));
  }

  function handleSummaryDiscountValueChange(nextValue) {
    setVersionForm((prev) => ({
      ...prev,
      summaryDiscountValue:
        summaryDiscountMode === "amount"
          ? sanitizeSummaryDiscountInputValue(nextValue)
          : nextValue,
    }));
  }

  function saveExistingItemDraft(itemId, explicitDraft) {
    handleSaveItem(itemId, explicitDraft);
  }

  if (!selectedVersion) {
    return (
      <p className="field-hint">
        Selecciona una cotizacion para revisar su version.
      </p>
    );
  }

  return (
    <div className="quotation-create-flow quotation-edit-flow">
      <div className="quotation-meta-row">
        <span className="record-id-badge">
          Version {selectedVersion.versionNumber}
        </span>
        <span className="record-id-badge">
          Estado: {selectedVersion.statusName}
        </span>
        <span className="record-id-badge">
          {selectedVersion.isLatestVersion
            ? "Version mayor"
            : "Version historica"}
        </span>
      </div>

      <QuotationWorkflowPanel
        selectedVersion={selectedVersion}
        allowedActions={allowedActions}
        busyAction={busyAction}
        handleAction={handleAction}
      />

      <section className="account-form-section opportunity-main-data-section">
        <div>
          <h4>Contexto comercial</h4>
          <p className="field-hint">
            Selecciona la cuenta, su oportunidad y el contacto asociado.
          </p>
        </div>
        <div className="grid-form account-grid-main quotation-commercial-context-grid">
          <div className="field-group">
            <label htmlFor="edit-quotation-account">Cuenta</label>
            <input
              id="edit-quotation-account"
              value={selectedQuotation?.accountName || ""}
              disabled
              readOnly
            />
          </div>
          <div className="field-group">
            <label htmlFor="edit-quotation-opportunity">Oportunidad</label>
            <input
              id="edit-quotation-opportunity"
              value={selectedQuotation?.opportunityName || ""}
              disabled
              readOnly
            />
          </div>
          <div className="field-group">
            <label htmlFor="edit-quotation-contact">Contacto</label>
            <input
              id="edit-quotation-contact"
              value={selectedContextContactName}
              readOnly
              placeholder="Se hereda de la oportunidad"
            />
          </div>
          <div className="field-group">
            <label htmlFor="edit-quotation-close-date">Fecha de cierre</label>
            <input
              id="edit-quotation-close-date"
              value={formattedOpportunityCloseDate}
              readOnly
              placeholder="Selecciona oportunidad"
            />
          </div>
          <div className="field-group">
            <label htmlFor="edit-quotation-sales-stage">
              Etapa del proceso de venta
            </label>
            <input
              id="edit-quotation-sales-stage"
              value={selectedQuotation?.opportunitySalesStageName || ""}
              disabled
              readOnly
            />
          </div>
          <div className="field-group">
            <label htmlFor="edit-quotation-amount">Importe</label>
            <input
              id="edit-quotation-amount"
              value={formattedOpportunityAmount}
              readOnly
              placeholder="Selecciona oportunidad"
            />
          </div>
        </div>
        <p className="field-hint quotation-create-step-hint">
          La cuenta y la oportunidad asociadas ya no se pueden modificar desde
          esta ventana.
        </p>
      </section>

      <section className="account-form-section opportunity-sales-management-section">
        <div className="quotation-proposal-section-header">
          <div>
            <h4>Datos de propuesta</h4>
            <p className="field-hint">
              El vendedor se precarga desde la oportunidad seleccionada.
            </p>
          </div>
          <div className="quotation-proposal-meta">
            <div className="quotation-proposal-badges">
              <span className="record-id-badge">
                Cotizacion {selectedQuotation?.id || "-"}
              </span>
              <span className="record-id-badge">
                Version {selectedVersion.versionNumber}
              </span>
            </div>
            <span className="user-status-badge draft">
              Estado de la propuesta: {selectedVersion.statusName}
            </span>
          </div>
        </div>
        <div className="grid-form account-grid-main">
          <div className="field-group">
            <label>Nombre de propuesta</label>
            <input
              value={versionForm.proposalName}
              onChange={(event) =>
                setVersionForm((prev) => ({
                  ...prev,
                  proposalName: event.target.value,
                }))
              }
            />
          </div>
          <div className="field-group">
            <label>Fecha de cotizacion</label>
            <input
              type="date"
              value={versionForm.quotationDate}
              onChange={(event) =>
                setVersionForm((prev) => ({
                  ...prev,
                  quotationDate: event.target.value,
                }))
              }
            />
          </div>
          <div className="field-group">
            <label>Vendedor</label>
            <input
              value={selectedSellerName}
              readOnly
              placeholder="Sin vendedor asignado"
            />
          </div>
          <div className="field-group">
            <label>Contacto a cotizar</label>
            <select
              value={versionForm.contactId}
              onChange={(event) =>
                setVersionForm((prev) => ({
                  ...prev,
                  contactId: event.target.value,
                }))
              }
            >
              <option value="">Selecciona contacto</option>
              {contactOptions.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.full_name}
                </option>
              ))}
            </select>
          </div>
          <div className="field-group">
            <label>Estado de activacion</label>
            <select
              value={versionForm.activationStatusCode}
              onChange={(event) =>
                setVersionForm((prev) => ({
                  ...prev,
                  activationStatusCode: event.target.value,
                }))
              }
            >
              {catalogs.activationStatuses.map((status) => (
                <option key={status.id} value={status.code}>
                  {status.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field-group field-group-full-width">
            <label>Introduccion</label>
            <textarea
              rows={1}
              value={versionForm.introduction}
              onChange={(event) =>
                setVersionForm((prev) => ({
                  ...prev,
                  introduction: event.target.value,
                }))
              }
            />
          </div>
        </div>
      </section>

      <section className="account-form-section opportunity-sales-management-section">
        <div className="quotation-section-toolbar">
          <div>
            <h4>Secciones iniciales</h4>
            <p className="field-hint">
              "Precio Lista M.O." conserva la base original del proveedor y
              "Precio de lista" muestra el valor convertido en la moneda de la
              cotizacion.
            </p>
          </div>
          <div className="quotation-action-groups">
            <div className="quotation-action-group">
              <span className="quotation-action-group-label">Seccion</span>
              <div className="quotation-icon-actions">
                <button
                  type="button"
                  className="quotation-icon-button"
                  aria-label="Agregar seccion inicial"
                  title="Agregar seccion inicial"
                  disabled={busyAction === "create-section"}
                  onClick={handleCreateSection}
                >
                  <PlusIcon />
                </button>
              </div>
            </div>
          </div>
        </div>
        {(selectedVersion.sections || []).length ? (
          <div className="quotation-create-section-drafts quotation-sections-list">
            {(selectedVersion.sections || []).map((section, index) => {
              const sectionDraftValue =
                sectionEdits[String(section.id)] ||
                buildSectionDraft(catalogs.inclusionTypes);
              const sectionSelectedItemIds =
                selectedItemIdsBySection[String(section.id)] || [];
              const sectionHighlightedItemIds =
                highlightedItemIdsBySection[String(section.id)] || [];
              const sectionDisplayItems = buildSectionDisplayItems(section);
              const collapsedBundleIds = new Set(
                collapsedBundleIdsBySection[String(section.id)] || [],
              );
              const visibleSectionItems = sectionDisplayItems.filter((item) => {
                const bundleParentLocalId = item.bundleParentLocalId
                  ? String(item.bundleParentLocalId)
                  : null;

                return (
                  !bundleParentLocalId ||
                  !collapsedBundleIds.has(bundleParentLocalId)
                );
              });
              const allSectionItemIds = visibleSectionItems.map((item) =>
                String(item.id),
              );
              const allItemsSelected =
                allSectionItemIds.length > 0 &&
                allSectionItemIds.every((itemId) =>
                  sectionSelectedItemIds.includes(itemId),
                );
              const sectionTotals = (section.items || [])
                .filter((item) => !item.bundleParentItemId)
                .reduce(
                  (accumulator, item) => {
                    const effectiveItem =
                      effectiveSummaryItemsById.get(String(item.id)) ||
                      sectionDisplayItems.find(
                        (candidate) => Number(candidate.id) === Number(item.id),
                      ) ||
                      item;
                    const totals = calculateQuotationItemDisplayTotals(
                      effectiveItem,
                      effectiveSummarySections.find(
                        (candidateSection) =>
                          Number(candidateSection.id) === Number(section.id),
                      )?.items || sectionDisplayItems,
                    );

                    return {
                      costTotal:
                        accumulator.costTotal + Number(totals.costTotal || 0),
                      salePriceTotal:
                        accumulator.salePriceTotal +
                        Number(totals.salePriceTotal || 0),
                    };
                  },
                  { costTotal: 0, salePriceTotal: 0 },
                );
              const displayedSectionTotals = sectionTotals;
              const manualBundleSelection = getManualBundleSelectionState(
                sectionDisplayItems,
                sectionSelectedItemIds,
              );
              const attachManualBundleSelection =
                getAttachToManualBundleSelectionState(
                  sectionDisplayItems,
                  sectionSelectedItemIds,
                );
              const detachManualBundleSelection =
                getDetachFromManualBundleSelectionState(
                  sectionDisplayItems,
                  sectionSelectedItemIds,
                );
              const showManualBundleHint =
                sectionSelectedItemIds.length > 0 &&
                !manualBundleSelection.ok &&
                !attachManualBundleSelection.ok &&
                !detachManualBundleSelection.ok;
              const manualBundleHintMessage = showManualBundleHint
                ? getBundleHintMessage({
                    manualSelection: manualBundleSelection,
                    attachSelection: attachManualBundleSelection,
                    detachSelection: detachManualBundleSelection,
                    preferredAction:
                      preferredBundleHintActionBySection[String(section.id)] ||
                      null,
                  })
                : "";
              const sectionInclusionTypeName =
                catalogs.inclusionTypes.find(
                  (type) =>
                    String(type.id) ===
                    String(sectionDraftValue.inclusionTypeId),
                )?.name || "Titulo de la seccion";

              return (
                <div key={section.id} className="quotation-section-card">
                  <div className="quotation-section-card-header">
                    <div className="quotation-action-groups">
                      <div className="quotation-action-group">
                        <span className="quotation-action-group-label">
                          Fila
                        </span>
                        <div className="quotation-icon-actions">
                          <QuotationIconButton
                            title="Agregar fila"
                            onClick={async () => {
                              await handleCreateItem(section.id);
                            }}
                          >
                            <PlusIcon />
                          </QuotationIconButton>
                          <QuotationIconButton
                            title="Eliminar filas seleccionadas"
                            danger
                            disabled={!sectionSelectedItemIds.length}
                            onClick={async () => {
                              const removedIds =
                                await handleRemoveEditSectionItems(
                                  section.id,
                                  sectionSelectedItemIds,
                                );
                              if (removedIds.length) {
                                setSelectedItemIdsBySection((prev) => ({
                                  ...prev,
                                  [String(section.id)]: [],
                                }));
                                setHighlightedItemIdsBySection((prev) => ({
                                  ...prev,
                                  [String(section.id)]: (
                                    prev[String(section.id)] || []
                                  ).filter(
                                    (itemId) => !removedIds.includes(itemId),
                                  ),
                                }));
                              }
                            }}
                          >
                            <TrashIcon />
                          </QuotationIconButton>
                          <QuotationIconButton
                            title="Subir una posicion las filas seleccionadas"
                            disabled={!sectionSelectedItemIds.length}
                            onClick={() =>
                              moveSelectedItems(
                                section.id,
                                sectionDisplayItems,
                                -1,
                              )
                            }
                          >
                            <UpIcon />
                          </QuotationIconButton>
                          <QuotationIconButton
                            title="Bajar una posicion las filas seleccionadas"
                            disabled={!sectionSelectedItemIds.length}
                            onClick={() =>
                              moveSelectedItems(
                                section.id,
                                sectionDisplayItems,
                                1,
                              )
                            }
                          >
                            <DownIcon />
                          </QuotationIconButton>
                          <QuotationIconButton
                            title="Duplicar filas seleccionadas"
                            disabled={!sectionSelectedItemIds.length}
                            onClick={async () => {
                              const createdIds =
                                await handleDuplicateEditSectionItems(
                                  section.id,
                                  sectionSelectedItemIds,
                                );
                              if (createdIds.length) {
                                setSelectedItemIdsBySection((prev) => ({
                                  ...prev,
                                  [String(section.id)]: createdIds.map(String),
                                }));
                              }
                            }}
                          >
                            <DuplicateIcon />
                          </QuotationIconButton>
                          <QuotationIconButton
                            title="Copiar filas seleccionadas"
                            disabled={!sectionSelectedItemIds.length}
                            onClick={() =>
                              handleCopyEditSectionItems(
                                section.id,
                                sectionSelectedItemIds,
                              )
                            }
                          >
                            <CopyIcon />
                          </QuotationIconButton>
                          <QuotationIconButton
                            title="Pegar filas copiadas"
                            disabled={!hasEditCopiedItems}
                            onClick={async () => {
                              const createdIds =
                                await handlePasteEditSectionItems(
                                  section.id,
                                  sectionSelectedItemIds,
                                );
                              if (createdIds.length) {
                                setSelectedItemIdsBySection((prev) => ({
                                  ...prev,
                                  [String(section.id)]: createdIds.map(String),
                                }));
                              }
                            }}
                          >
                            <PasteIcon />
                          </QuotationIconButton>
                          <QuotationIconButton
                            title="Resaltar filas seleccionadas"
                            disabled={!sectionSelectedItemIds.length}
                            onClick={() => highlightSelectedItems(section.id)}
                          >
                            <HighlightIcon />
                          </QuotationIconButton>
                          <QuotationIconButton
                            title="Quitar resaltado de filas seleccionadas"
                            disabled={!sectionSelectedItemIds.length}
                            onClick={() => unhighlightSelectedItems(section.id)}
                          >
                            <HighlightOffIcon />
                          </QuotationIconButton>
                          <div
                            className="quotation-bundle-icon-group"
                            role="group"
                            aria-label="Acciones de bundle"
                          >
                            <span className="quotation-bundle-icon-group-label">
                              Bundle
                            </span>
                            <div className="quotation-bundle-icon-group-actions">
                              <span
                                onMouseEnter={() =>
                                  setPreferredBundleHintAction(
                                    section.id,
                                    "manual",
                                  )
                                }
                                onMouseLeave={() =>
                                  clearPreferredBundleHintAction(
                                    section.id,
                                    "manual",
                                  )
                                }
                              >
                                <QuotationIconButton
                                  title="Crear bundle manual con filas seleccionadas"
                                  disabled={!manualBundleSelection.ok}
                                  onClick={() =>
                                    openManualBundlePicker(
                                      section.id,
                                      sectionDisplayItems,
                                      sectionSelectedItemIds,
                                    )
                                  }
                                >
                                  <BundleManualIcon />
                                </QuotationIconButton>
                              </span>
                              <span
                                onMouseEnter={() =>
                                  setPreferredBundleHintAction(
                                    section.id,
                                    "attach",
                                  )
                                }
                                onMouseLeave={() =>
                                  clearPreferredBundleHintAction(
                                    section.id,
                                    "attach",
                                  )
                                }
                              >
                                <QuotationIconButton
                                  title="Adjuntar filas seleccionadas al bundle manual"
                                  disabled={!attachManualBundleSelection.ok}
                                  onClick={async () => {
                                    const nextSelectedIds =
                                      await handleAttachEditSectionItemsToManualBundle(
                                        section.id,
                                        sectionSelectedItemIds,
                                      );
                                    if (nextSelectedIds.length) {
                                      setSelectedItemIdsBySection((prev) => ({
                                        ...prev,
                                        [String(section.id)]: nextSelectedIds,
                                      }));
                                    }
                                  }}
                                >
                                  <BundleAttachIcon />
                                </QuotationIconButton>
                              </span>
                              <span
                                onMouseEnter={() =>
                                  setPreferredBundleHintAction(
                                    section.id,
                                    "detach",
                                  )
                                }
                                onMouseLeave={() =>
                                  clearPreferredBundleHintAction(
                                    section.id,
                                    "detach",
                                  )
                                }
                              >
                                <QuotationIconButton
                                  title="Quitar filas seleccionadas del bundle manual"
                                  disabled={!detachManualBundleSelection.ok}
                                  onClick={async () => {
                                    const nextSelectedIds =
                                      await handleDetachEditSectionItemsFromManualBundle(
                                        section.id,
                                        sectionSelectedItemIds,
                                      );
                                    if (nextSelectedIds.length) {
                                      setSelectedItemIdsBySection((prev) => ({
                                        ...prev,
                                        [String(section.id)]: nextSelectedIds,
                                      }));
                                    }
                                  }}
                                >
                                  <BundleDetachIcon />
                                </QuotationIconButton>
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="quotation-action-group">
                        <span className="quotation-action-group-label">
                          Seccion
                        </span>
                        <div className="quotation-icon-actions quotation-icon-actions-section">
                          <div
                            className="quotation-inline-icon-group"
                            role="group"
                            aria-label="Inclusion de la seccion"
                          >
                            {catalogs.inclusionTypes.map((type) => {
                              const isSelected =
                                String(sectionDraftValue.inclusionTypeId) ===
                                String(type.id);

                              return (
                                <button
                                  key={type.id}
                                  type="button"
                                  className={`quotation-icon-button quotation-inclusion-button${isSelected ? " is-selected" : ""}`}
                                  aria-label={type.name}
                                  aria-pressed={isSelected}
                                  title={type.name}
                                  onClick={() => {
                                    const nextSectionDraft = {
                                      ...sectionDraftValue,
                                      inclusionTypeId: String(type.id),
                                    };

                                    setSectionEdits((prev) => ({
                                      ...prev,
                                      [String(section.id)]: nextSectionDraft,
                                    }));
                                  }}
                                >
                                  <InclusionIcon code={type.code} />
                                </button>
                              );
                            })}
                          </div>
                          <QuotationIconButton
                            title="Subir seccion"
                            disabled={
                              busyAction === `move-section-${section.id}` ||
                              index === 0
                            }
                            onClick={() =>
                              handleMoveEditSection(section.id, -1)
                            }
                          >
                            <UpIcon />
                          </QuotationIconButton>
                          <QuotationIconButton
                            title="Bajar seccion"
                            disabled={
                              busyAction === `move-section-${section.id}` ||
                              index === selectedVersion.sections.length - 1
                            }
                            onClick={() => handleMoveEditSection(section.id, 1)}
                          >
                            <DownIcon />
                          </QuotationIconButton>
                          <QuotationIconButton
                            title="Eliminar seccion"
                            danger
                            disabled={
                              busyAction === `remove-section-${section.id}`
                            }
                            onClick={async () => {
                              const removed = await handleRemoveEditSection(
                                section.id,
                              );
                              if (removed) {
                                setSelectedItemIdsBySection((prev) => {
                                  const next = { ...prev };
                                  delete next[String(section.id)];
                                  return next;
                                });
                                setHighlightedItemIdsBySection((prev) => {
                                  const next = { ...prev };
                                  delete next[String(section.id)];
                                  return next;
                                });
                              }
                            }}
                          >
                            <TrashIcon />
                          </QuotationIconButton>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="grid-form quotation-create-grid">
                    <div className="field-group">
                      <label>Titulo</label>
                      <input
                        value={sectionDraftValue.title}
                        placeholder={sectionInclusionTypeName}
                        onChange={(event) =>
                          setSectionEdits((prev) => ({
                            ...prev,
                            [String(section.id)]: {
                              ...sectionDraftValue,
                              title: event.target.value,
                            },
                          }))
                        }
                        onBlur={(event) =>
                          handleSaveSection(section.id, {
                            ...sectionDraftValue,
                            title: event.currentTarget.value,
                          })
                        }
                      />
                    </div>
                  </div>

                  {showManualBundleHint ? (
                    <p className="field-hint quotation-create-step-hint">
                      {manualBundleHintMessage}
                    </p>
                  ) : null}

                  {manualBundlePickerState.isOpen &&
                  manualBundlePickerState.sectionId === section.id &&
                  activeManualBundleSelection.ok ? (
                    <div
                      className="quotation-manual-bundle-picker"
                      role="dialog"
                      aria-label="Crear bundle manual"
                    >
                      <div className="quotation-manual-bundle-picker-header">
                        <div>
                          <h5>Crear bundle manual</h5>
                          <p className="field-hint">
                            Elige la fila padre. Las demas filas seleccionadas
                            quedaran como componentes.
                          </p>
                        </div>
                      </div>
                      <div className="quotation-manual-bundle-picker-grid">
                        <div className="quotation-manual-bundle-picker-column">
                          <span className="quotation-manual-bundle-picker-label">
                            Padre
                          </span>
                          <div className="quotation-manual-bundle-options">
                            {activeManualBundleSelection.items.map((item) => (
                              <label
                                key={item.localId}
                                className="quotation-manual-bundle-option"
                              >
                                <input
                                  type="radio"
                                  name={`edit-manual-bundle-parent-${section.id}`}
                                  value={item.localId}
                                  checked={
                                    manualBundlePickerState.parentLocalId ===
                                    item.localId
                                  }
                                  onChange={(event) =>
                                    setManualBundlePickerState((prev) => ({
                                      ...prev,
                                      parentLocalId: event.target.value,
                                    }))
                                  }
                                />
                                <span>
                                  <strong>
                                    {item.productCode || "Sin codigo"}
                                  </strong>
                                  <span className="quotation-manual-bundle-option-description">
                                    {item.productDescription ||
                                      "Sin descripcion"}
                                  </span>
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                        <div className="quotation-manual-bundle-picker-column">
                          <span className="quotation-manual-bundle-picker-label">
                            Componentes resultantes
                          </span>
                          <ul className="quotation-manual-bundle-components-preview">
                            {activeManualBundleSelection.items
                              .filter(
                                (item) =>
                                  item.localId !==
                                  manualBundlePickerState.parentLocalId,
                              )
                              .map((item) => (
                                <li key={item.localId}>
                                  <strong>
                                    {item.productCode || "Sin codigo"}
                                  </strong>
                                  <span>
                                    {item.productDescription ||
                                      "Sin descripcion"}
                                  </span>
                                </li>
                              ))}
                          </ul>
                        </div>
                      </div>
                      <div className="quotation-manual-bundle-picker-actions">
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={closeManualBundlePicker}
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={
                            !manualBundlePickerState.parentLocalId ||
                            activeManualBundleSelection.items.length < 2
                          }
                          onClick={confirmManualBundle}
                        >
                          Confirmar bundle
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div className="quotation-items-list">
                    <div className="quotation-items-table-wrap">
                      <table className="quotation-items-table">
                        <colgroup>
                          {ITEM_TABLE_COLUMNS.map((column) => (
                            <col
                              key={column.key}
                              style={{
                                width: `${column.defaultWidth}px`,
                                minWidth: `${column.defaultWidth}px`,
                              }}
                            />
                          ))}
                        </colgroup>
                        <thead>
                          <tr>
                            {ITEM_TABLE_COLUMNS.map((column) => (
                              <th key={column.key}>
                                <div className="quotation-column-header">
                                  {column.key === "selected" ? (
                                    <input
                                      type="checkbox"
                                      checked={allItemsSelected}
                                      aria-label="Seleccionar todas las filas"
                                      onChange={(event) =>
                                        toggleAllSectionItems(
                                          section.id,
                                          allSectionItemIds,
                                          event.target.checked,
                                        )
                                      }
                                    />
                                  ) : (
                                    <span>{column.label}</span>
                                  )}
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {visibleSectionItems.map((item, index) => {
                            const itemDraftValue =
                              itemEdits[String(item.id)] ||
                              buildItemDraft(catalogs.providers);
                            const displayItem = effectiveSummaryItemsById.get(
                              String(item.id),
                            ) ||
                              sectionDisplayItems.find(
                                (candidate) =>
                                  Number(candidate.id) === Number(item.id),
                              ) || {
                                ...item,
                                ...itemDraftValue,
                                localId: String(item.id),
                                bundleParentLocalId: item.bundleParentItemId
                                  ? String(item.bundleParentItemId)
                                  : null,
                                isBundleComponent: Boolean(
                                  item.bundleParentItemId,
                                ),
                              };
                            const totals = calculateQuotationItemDisplayTotals(
                              displayItem,
                              effectiveSummarySections.find(
                                (candidateSection) =>
                                  Number(candidateSection.id) ===
                                  Number(section.id),
                              )?.items || sectionDisplayItems,
                            );
                            const isBundleComponent = Boolean(
                              displayItem.isBundleComponent,
                            );
                            const isBundleParent =
                              displayItem.itemType === "grupo_productos" &&
                              !isBundleComponent;
                            const isSelected = sectionSelectedItemIds.includes(
                              String(item.id),
                            );
                            const isHighlighted =
                              sectionHighlightedItemIds.includes(
                                String(item.id),
                              );
                            const bundleComponentCount = (
                              section.items || []
                            ).filter(
                              (candidate) =>
                                Number(candidate.bundleParentItemId) ===
                                Number(item.id),
                            ).length;
                            const isBundleCollapsed = collapsedBundleIds.has(
                              String(item.id),
                            );

                            return (
                              <tr
                                key={item.id}
                                className={[
                                  isSelected
                                    ? "quotation-table-row-selected"
                                    : "",
                                  isHighlighted
                                    ? "quotation-table-row-highlighted"
                                    : "",
                                  isBundleComponent
                                    ? "quotation-table-row-bundle-component"
                                    : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                              >
                                <td>
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    aria-label={`Seleccionar fila ${index + 1}`}
                                    onChange={(event) =>
                                      toggleSectionItemSelection(
                                        section.id,
                                        item.id,
                                        event.target.checked,
                                      )
                                    }
                                  />
                                </td>
                                <td>{index + 1}</td>
                                <td>
                                  <div
                                    className={[
                                      isBundleComponent
                                        ? "quotation-bundle-component-cell"
                                        : "",
                                      isBundleParent
                                        ? "quotation-bundle-parent-cell"
                                        : "",
                                    ]
                                      .filter(Boolean)
                                      .join(" ")}
                                  >
                                    {isBundleComponent ? (
                                      <span className="quotation-bundle-component-badge">
                                        Componente
                                      </span>
                                    ) : null}
                                    {isBundleParent ? (
                                      <div className="quotation-bundle-parent-meta">
                                        <span className="quotation-bundle-parent-badge">
                                          Bundle
                                        </span>
                                        {bundleComponentCount ? (
                                          <button
                                            type="button"
                                            className="quotation-bundle-toggle-button"
                                            aria-expanded={!isBundleCollapsed}
                                            aria-label={`${isBundleCollapsed ? "Mostrar" : "Ocultar"} componentes de ${item.productCode || item.productDescription || "bundle"}`}
                                            title={`${isBundleCollapsed ? "Mostrar" : "Ocultar"} componentes`}
                                            onClick={() =>
                                              toggleBundleCollapsed(
                                                section.id,
                                                item.id,
                                                sectionDisplayItems,
                                              )
                                            }
                                          >
                                            <BundleToggleIcon
                                              collapsed={isBundleCollapsed}
                                            />
                                          </button>
                                        ) : null}
                                      </div>
                                    ) : null}
                                    <input
                                      value={itemDraftValue.productCode}
                                      readOnly
                                      onDoubleClick={() =>
                                        openProductPicker({
                                          mode: "existing",
                                          sectionId: section.id,
                                          itemId: item.id,
                                          providerId: itemDraftValue.providerId,
                                          query: itemDraftValue.productCode,
                                        })
                                      }
                                    />
                                  </div>
                                </td>
                                <td>
                                  <div
                                    className={`quotation-description-editor-cell${
                                      isBundleComponent
                                        ? " is-bundle-component"
                                        : ""
                                    }`}
                                    onBlurCapture={handleDescriptionEditorBlur}
                                  >
                                    <input
                                      value={itemDraftValue.productDescription}
                                      onFocus={() =>
                                        openDescriptionEditor(
                                          section.id,
                                          item.id,
                                        )
                                      }
                                      onChange={(event) =>
                                        updateDraftEntry(
                                          setItemEdits,
                                          item.id,
                                          itemDraftValue,
                                          "productDescription",
                                          event.target.value,
                                        )
                                      }
                                      onKeyDown={(event) =>
                                        handleDescriptionEditorEscape(
                                          event,
                                          item.id,
                                          itemDraftValue,
                                        )
                                      }
                                      onBlur={(event) =>
                                        saveExistingItemDraft(item.id, {
                                          ...itemDraftValue,
                                          productDescription:
                                            event.currentTarget.value,
                                        })
                                      }
                                    />
                                    {activeDescriptionEditor.sectionId ===
                                      String(section.id) &&
                                    activeDescriptionEditor.itemId ===
                                      String(item.id) ? (
                                      <div className="quotation-description-editor-popover">
                                        <textarea
                                          rows={4}
                                          autoFocus
                                          value={
                                            itemDraftValue.productDescription
                                          }
                                          onChange={(event) =>
                                            updateDraftEntry(
                                              setItemEdits,
                                              item.id,
                                              itemDraftValue,
                                              "productDescription",
                                              event.target.value,
                                            )
                                          }
                                          onKeyDown={(event) =>
                                            handleDescriptionEditorEscape(
                                              event,
                                              item.id,
                                              itemDraftValue,
                                            )
                                          }
                                          onBlur={(event) =>
                                            saveExistingItemDraft(item.id, {
                                              ...itemDraftValue,
                                              productDescription:
                                                event.currentTarget.value,
                                            })
                                          }
                                        />
                                      </div>
                                    ) : null}
                                  </div>
                                </td>
                                <td>
                                  <QuantityInput
                                    value={itemDraftValue.quantity}
                                    onChange={(nextValue) =>
                                      updateDraftEntry(
                                        setItemEdits,
                                        item.id,
                                        itemDraftValue,
                                        "quantity",
                                        nextValue,
                                      )
                                    }
                                    onBlur={(event) =>
                                      saveExistingItemDraft(item.id, {
                                        ...itemDraftValue,
                                        quantity: event.currentTarget.value,
                                      })
                                    }
                                  />
                                </td>
                                <td>
                                  {isBundleParent ? (
                                    <span className="quotation-bundle-parent-placeholder">
                                      --
                                    </span>
                                  ) : (
                                    <OriginalListPriceInput
                                      aria-label={`Precio Lista M.O. ${itemDraftValue.productCode || item.id}`}
                                      value={
                                        itemDraftValue.originalListPriceUnit
                                      }
                                      onChange={(nextValue) =>
                                        updateDraftEntry(
                                          setItemEdits,
                                          item.id,
                                          itemDraftValue,
                                          "originalListPriceUnit",
                                          nextValue,
                                        )
                                      }
                                      onBlur={(nextValue) =>
                                        saveExistingItemDraft(item.id, {
                                          ...itemDraftValue,
                                          originalListPriceUnit: nextValue,
                                        })
                                      }
                                    />
                                  )}
                                </td>
                                <td>
                                  {isBundleParent ? (
                                    <span className="quotation-bundle-parent-placeholder">
                                      --
                                    </span>
                                  ) : (
                                    formatQuotationAmount(
                                      itemDraftValue.listPriceUnit,
                                    )
                                  )}
                                </td>
                                <td>
                                  {isBundleParent ? (
                                    <span className="quotation-bundle-parent-placeholder">
                                      --
                                    </span>
                                  ) : (
                                    <input
                                      type="number"
                                      min="0"
                                      max="100"
                                      step="0.01"
                                      value={
                                        itemDraftValue.manufacturerDiscountPct
                                      }
                                      onChange={(event) =>
                                        updateDraftEntry(
                                          setItemEdits,
                                          item.id,
                                          itemDraftValue,
                                          "manufacturerDiscountPct",
                                          event.target.value,
                                        )
                                      }
                                      onBlur={(event) =>
                                        saveExistingItemDraft(item.id, {
                                          ...itemDraftValue,
                                          manufacturerDiscountPct:
                                            event.currentTarget.value,
                                        })
                                      }
                                    />
                                  )}
                                </td>
                                <td>
                                  {isBundleParent ? (
                                    <span className="quotation-bundle-parent-placeholder">
                                      Calculado por componentes
                                    </span>
                                  ) : (
                                    formatQuotationAmount(
                                      totals.discountedListPriceUnit,
                                    )
                                  )}
                                </td>
                                <td>
                                  {isBundleParent ? (
                                    <span className="quotation-bundle-parent-placeholder">
                                      --
                                    </span>
                                  ) : (
                                    <input
                                      type="number"
                                      min="0"
                                      max="100"
                                      step="0.01"
                                      value={itemDraftValue.importCostPct}
                                      onChange={(event) =>
                                        updateDraftEntry(
                                          setItemEdits,
                                          item.id,
                                          itemDraftValue,
                                          "importCostPct",
                                          event.target.value,
                                        )
                                      }
                                      onBlur={(event) =>
                                        saveExistingItemDraft(item.id, {
                                          ...itemDraftValue,
                                          importCostPct:
                                            event.currentTarget.value,
                                        })
                                      }
                                    />
                                  )}
                                </td>
                                <td>
                                  {isBundleParent ? (
                                    <span className="quotation-bundle-parent-placeholder">
                                      --
                                    </span>
                                  ) : (
                                    formatQuotationAmount(totals.costUnit)
                                  )}
                                </td>
                                <td>
                                  {isBundleParent ? (
                                    <span className="quotation-bundle-parent-placeholder">
                                      --
                                    </span>
                                  ) : (
                                    formatQuotationAmount(totals.costTotal)
                                  )}
                                </td>
                                <td>
                                  {isBundleParent ? (
                                    <span className="quotation-bundle-parent-placeholder">
                                      --
                                    </span>
                                  ) : (
                                    <input
                                      type="number"
                                      min="0"
                                      max="100"
                                      step="0.01"
                                      value={itemDraftValue.profitMarginPct}
                                      onChange={(event) =>
                                        updateDraftEntry(
                                          setItemEdits,
                                          item.id,
                                          itemDraftValue,
                                          "profitMarginPct",
                                          event.target.value,
                                        )
                                      }
                                      onBlur={(event) =>
                                        saveExistingItemDraft(item.id, {
                                          ...itemDraftValue,
                                          profitMarginPct:
                                            event.currentTarget.value,
                                        })
                                      }
                                    />
                                  )}
                                </td>
                                <td>
                                  {isBundleParent ? (
                                    <span className="quotation-bundle-parent-placeholder">
                                      --
                                    </span>
                                  ) : (
                                    <input
                                      type="number"
                                      min="0"
                                      max="100"
                                      step="0.01"
                                      value={
                                        summaryDistributionMode === "per_item"
                                          ? displayItem.finalDiscountPct
                                          : itemDraftValue.finalDiscountPct
                                      }
                                      disabled={
                                        summaryDistributionMode === "per_item"
                                      }
                                      onChange={(event) =>
                                        updateDraftEntry(
                                          setItemEdits,
                                          item.id,
                                          itemDraftValue,
                                          "finalDiscountPct",
                                          event.target.value,
                                        )
                                      }
                                      onBlur={(event) =>
                                        saveExistingItemDraft(item.id, {
                                          ...itemDraftValue,
                                          finalDiscountPct:
                                            event.currentTarget.value,
                                        })
                                      }
                                    />
                                  )}
                                </td>
                                <td>
                                  {formatQuotationAmount(totals.salePriceUnit)}
                                </td>
                                <td>
                                  {formatQuotationAmount(totals.salePriceTotal)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td colSpan={11}>Totales de la seccion</td>
                            <td>
                              {formatQuotationAmount(
                                displayedSectionTotals.costTotal,
                              )}
                            </td>
                            <td colSpan={3} />
                            <td>
                              {formatQuotationAmount(
                                displayedSectionTotals.salePriceTotal,
                              )}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="field-hint quotation-create-step-hint">
            Aun no agregaste secciones iniciales.
          </p>
        )}
      </section>

      <section className="quotation-create-step quotation-summary-section">
        <div className="quotation-create-step-header">
          <div>
            <h4>Resumen</h4>
            <p className="field-hint quotation-create-step-hint">
              Consolidado actual de costo, venta y margen para la version en
              edicion.
            </p>
          </div>
        </div>

        <div className="quotation-summary-card">
          <div className="quotation-summary-table-wrapper">
            <table className="quotation-summary-table">
              <thead>
                <tr>
                  <th>Categoria</th>
                  <th>Costo US$</th>
                  <th>Venta US$</th>
                  <th>Margen %</th>
                </tr>
              </thead>
              <tbody>
                {quotationSummary.rows.map((row) => (
                  <tr
                    key={row.key}
                    className={
                      row.key === "total" ? "quotation-summary-row-total" : ""
                    }
                  >
                    <td>{row.label}</td>
                    <td>
                      {row.costTotal == null
                        ? ""
                        : formatQuotationAmount(row.costTotal)}
                    </td>
                    <td>
                      {row.salePriceTotal == null
                        ? ""
                        : formatQuotationAmount(row.salePriceTotal)}
                    </td>
                    <td>
                      {row.marginPct == null
                        ? ""
                        : formatQuotationAmount(row.marginPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="quotation-summary-controls">
            <div className="field-group quotation-summary-control-card quotation-summary-discount-field">
              <label className="quotation-summary-group-title">
                Descuento Final
              </label>
              <label>Tipo de descuento</label>
              <div className="quotation-summary-discount-mode-group">
                <label className="quotation-summary-discount-mode-option">
                  <input
                    type="radio"
                    name="edit-quotation-summary-discount-mode"
                    checked={summaryDiscountMode === "percentage"}
                    onChange={() =>
                      handleSummaryDiscountModeChange("percentage")
                    }
                  />
                  <span>Porcentaje</span>
                </label>
                <label className="quotation-summary-discount-mode-option">
                  <input
                    type="radio"
                    name="edit-quotation-summary-discount-mode"
                    checked={summaryDiscountMode === "amount"}
                    onChange={() => handleSummaryDiscountModeChange("amount")}
                  />
                  <span>Valor</span>
                </label>
              </div>

              <label>Distribucion</label>
              <div className="quotation-summary-discount-mode-group">
                <label className="quotation-summary-discount-mode-option">
                  <input
                    type="radio"
                    name="edit-quotation-summary-distribution-mode"
                    checked={summaryDistributionMode === "total"}
                    onChange={() =>
                      setVersionForm((prev) => ({
                        ...prev,
                        summaryDistributionMode: "total",
                      }))
                    }
                  />
                  <span>Total</span>
                </label>
                <label className="quotation-summary-discount-mode-option">
                  <input
                    type="radio"
                    name="edit-quotation-summary-distribution-mode"
                    checked={summaryDistributionMode === "per_item"}
                    onChange={() =>
                      setVersionForm((prev) => ({
                        ...prev,
                        summaryDistributionMode: "per_item",
                      }))
                    }
                  />
                  <span>Por item</span>
                </label>
              </div>

              <label
                htmlFor={
                  summaryDiscountMode === "percentage"
                    ? "edit-quotation-summary-discount-pct"
                    : "edit-quotation-summary-discount-amount"
                }
              >
                {summaryDiscountMode === "percentage"
                  ? "Descuento %"
                  : "Descuento US$"}
              </label>
              <input
                className="quotation-summary-discount-input"
                id={
                  summaryDiscountMode === "percentage"
                    ? "edit-quotation-summary-discount-pct"
                    : "edit-quotation-summary-discount-amount"
                }
                type={summaryDiscountMode === "percentage" ? "number" : "text"}
                inputMode="decimal"
                min="0"
                max={summaryDiscountMode === "percentage" ? "100" : undefined}
                step="0.01"
                value={getSummaryDiscountDisplayValue()}
                onFocus={() => setIsSummaryDiscountInputFocused(true)}
                onBlur={() => {
                  setIsSummaryDiscountInputFocused(false);
                  setVersionForm((prev) => ({
                    ...prev,
                    summaryDiscountValue: formatSummaryDiscountInputValue(
                      prev.summaryDiscountValue,
                    ),
                  }));
                }}
                onChange={(event) =>
                  handleSummaryDiscountValueChange(event.target.value)
                }
              />
              <p className="field-hint quotation-summary-discount-hint">
                {summaryDiscountMode === "percentage"
                  ? "Se aplica sobre el valor total de venta de la version."
                  : "Se aplica como monto directo sobre el valor total de venta de la version."}
              </p>
            </div>

            <div className="field-group quotation-summary-control-card quotation-summary-vat-field">
              <label className="quotation-summary-group-title">IVA</label>
              <div className="quotation-summary-vat-mode-group">
                <label className="quotation-summary-discount-mode-option quotation-summary-vat-mode-option">
                  <input
                    type="radio"
                    name="edit-quotation-summary-vat-mode"
                    checked={summaryVatMode === "without_vat"}
                    onChange={() =>
                      setVersionForm((prev) => ({
                        ...prev,
                        summaryVatMode: "without_vat",
                        summaryVatPct: "0",
                      }))
                    }
                  />
                  <span>Sin IVA</span>
                </label>
                <label className="quotation-summary-discount-mode-option quotation-summary-vat-mode-option">
                  <input
                    type="radio"
                    name="edit-quotation-summary-vat-mode"
                    checked={summaryVatMode === "total"}
                    onChange={() =>
                      setVersionForm((prev) => ({
                        ...prev,
                        summaryVatMode: "total",
                        summaryVatPct: String(DEFAULT_QUOTATION_VAT_PCT),
                      }))
                    }
                  />
                  <span>Total</span>
                </label>
                <label className="quotation-summary-discount-mode-option quotation-summary-vat-mode-option">
                  <input
                    type="radio"
                    name="edit-quotation-summary-vat-mode"
                    checked={summaryVatMode === "per_item"}
                    onChange={() =>
                      setVersionForm((prev) => ({
                        ...prev,
                        summaryVatMode: "per_item",
                        summaryVatPct: String(DEFAULT_QUOTATION_VAT_PCT),
                      }))
                    }
                  />
                  <span>Por item</span>
                </label>
              </div>
              <p className="field-hint quotation-summary-discount-hint">
                Tasa fija del 16% aplicada sobre el precio de venta.
              </p>
            </div>

            <QuotationInternalNotesField
              id="edit-quotation-internal-notes"
              value={versionForm.internalNotes || ""}
              onChange={(value) =>
                setVersionForm((prev) => ({
                  ...prev,
                  internalNotes: value,
                }))
              }
              rows={7}
              containerClassName="field-group quotation-summary-control-card quotation-summary-notes-field"
            />
          </div>
        </div>
      </section>

      <section className="account-form-section opportunity-sales-management-section quotation-commercial-conditions-section">
        <div className="quotation-proposal-section-header">
          <div>
            <h4>Condiciones comerciales</h4>
          </div>
        </div>
        <QuotationCommercialConditionsCard
          idPrefix="edit-quotation"
          values={versionForm}
          catalogs={catalogs}
          onFieldChange={handleCommercialConditionFieldChange}
          notesRows={7}
          showPricingHelperText={false}
          exchangeRateLoading={isExchangeRateLoading}
          exchangeRateFeedback={exchangeRateFeedback}
          exchangeRateError={exchangeRateError}
        />
      </section>

      <section className="account-form-section opportunity-sales-management-section quotation-documents-section">
        <div className="quotation-proposal-section-header quotation-documents-header">
          <div>
            <h4>Documentacion</h4>
            <p className="field-hint quotation-documents-hint">
              Adjunta documentos de soporte para esta version de la cotizacion.
            </p>
          </div>
          <div className="quotation-documents-toolbar">
            <div className="quotation-documents-view-toggle" role="tablist" aria-label="Vista de documentos">
              <button
                type="button"
                className={`btn-secondary quotation-documents-view-button${documentViewMode === "current" ? " is-active" : ""}`}
                onClick={() => setDocumentViewMode("current")}
              >
                Esta version
              </button>
              <button
                type="button"
                className={`btn-secondary quotation-documents-view-button${documentViewMode === "all" ? " is-active" : ""}`}
                onClick={() => setDocumentViewMode("all")}
              >
                Todas las versiones
              </button>
            </div>
            <input
              ref={quotationDocumentsInputRef}
              type="file"
              multiple
              className="quotation-documents-input"
              onChange={handleQuotationDocumentsInputChange}
            />
            <button
              type="button"
              className="btn-secondary"
              disabled={isUploadingDocuments}
              onClick={() => quotationDocumentsInputRef.current?.click()}
            >
              {isUploadingDocuments ? "Cargando..." : "Agregar documentos"}
            </button>
          </div>
        </div>

        {visibleDocuments.length ? (
          <div className="quotation-documents-list">
            {visibleDocuments.map((document) => (
              <div key={`${documentViewMode}-${document.id}`} className="quotation-document-card">
                <div className="quotation-document-main">
                  <div className="quotation-document-title-row">
                    <strong>{document.originalFileName || "Documento"}</strong>
                    {documentViewMode === "all" ? (
                      <span className="record-id-badge">V{document.versionNumber}</span>
                    ) : null}
                  </div>
                  <div className="quotation-document-meta">
                    <span>{formatQuotationDocumentSize(document.byteSize)}</span>
                    {document.uploadedByUserName ? (
                      <span>{document.uploadedByUserName}</span>
                    ) : null}
                    {document.createdAt ? (
                      <span>{formatQuotationDocumentDate(document.createdAt)}</span>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busyAction === `download-quotation-document-${document.id}`}
                  onClick={() => handleDownloadQuotationDocument(document)}
                >
                  Descargar
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="quotation-documents-empty">
            {documentViewMode === "all"
              ? "Esta cotizacion aun no tiene documentos adjuntos."
              : "Esta version aun no tiene documentos adjuntos."}
          </div>
        )}
      </section>

      <div className="quotation-edit-actions">
        {error || success ? (
          <div className="quotation-modal-feedback quotation-modal-feedback-inline">
            {error ? <div className="toast toast-error">{error}</div> : null}
            {success ? (
              <div className="toast toast-success">{success}</div>
            ) : null}
          </div>
        ) : null}

        <div
          className={`modal-buttons quotation-edit-actions-buttons${canCreateNewVersion ? " has-create-version" : ""} has-print-action`}
        >
          <button
            type="button"
            className="btn-secondary"
            onClick={closeEditQuotationModal}
          >
            Cancelar
          </button>
          {canCreateNewVersion ? (
            <button
              type="button"
              className="btn-secondary"
              disabled={busyAction === "save-as-new-version"}
              onClick={handleSaveAsNewVersion}
            >
              Guardar como nueva version
            </button>
          ) : null}
          <button
            type="button"
            className="btn-secondary"
            onClick={openPrintPreviewModal}
          >
            Vista previa
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={
              busyAction === "save-version" ||
              busyAction === "save-as-new-version"
            }
            onClick={handleSaveVersion}
          >
            Guardar como version actual
          </button>
        </div>
      </div>

      <QuotationProductPickerModal
        isOpen={productPickerState.isOpen}
        state={productPickerState}
        catalogs={catalogs}
        canCreateQuickProduct={canCreateProviderPrices}
        onClose={closeProductPicker}
        onProviderChange={handleProductPickerProviderChange}
        onQueryChange={handleProductPickerQueryChange}
        onSelectProduct={handleSelectProduct}
        onOpenQuickCreate={openQuickCreateProduct}
        onCancelQuickCreate={cancelQuickCreateProduct}
        onQuickCreateFieldChange={handleQuickCreateFieldChange}
        onQuickCreateSubmit={handleQuickCreateSubmit}
        formatQuotationAmount={formatQuotationAmount}
      />

      <QuotationPrintPreviewModal
        isOpen={isPrintPreviewModalOpen}
        onClose={closePrintPreviewModal}
        onOpenPdfPreview={handleOpenPdfPreview}
        model={printModel}
      />
    </div>
  );
}

export default QuotationEditorContent;
