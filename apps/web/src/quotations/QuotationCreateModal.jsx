import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, getApiErrorMessage } from "../api";
import {
  applyCreateQuotationPerItemVat,
  applyCreateQuotationDistributedFinalDiscount,
  buildCreateQuotationDistributedBaseSections,
  buildQuotationCommercialConditionsForm,
  calculateCreateQuotationSummary,
  calculateQuotationItemDisplayTotals,
  calculateQuotationItemTotals,
  DEFAULT_QUOTATION_COMMERCIAL_CONDITIONS,
  DEFAULT_QUOTATION_VAT_PCT,
  buildQuotationItemPricing,
  formatQuotationMoneyInputValue,
  formatQuotationAmount,
  sanitizeQuotationMoneyInputValue,
  stepQuantityValueByUnit,
} from "./quotationsUtils";
import {
  QuotationCommercialConditionsCard,
  QuotationInternalNotesField,
} from "./QuotationCommercialFields";
import { setQuotationNavigationGuard } from "./quotationNavigationGuard";

function QuotationIconButton({
  title,
  onClick,
  disabled = false,
  danger = false,
  children,
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

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m5 12 5 5L20 7" />
    </svg>
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

function QuantityInput({ value, onChange, min = "0" }) {
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

const ITEM_TABLE_COLUMNS = [
  {
    key: "selected",
    label: "",
    defaultWidth: 44,
    minWidth: 44,
    resizable: false,
  },
  {
    key: "rowNumber",
    label: "#",
    defaultWidth: 36,
    minWidth: 36,
    resizable: false,
  },
  {
    key: "productCode",
    label: "Codigo",
    defaultWidth: 120,
    minWidth: 84,
    resizable: true,
  },
  {
    key: "productDescription",
    label: "Descripcion",
    defaultWidth: 220,
    minWidth: 140,
    resizable: true,
  },
  {
    key: "quantity",
    label: "Cant.",
    defaultWidth: 64,
    minWidth: 56,
    resizable: true,
  },
  {
    key: "originalListPriceUnit",
    label: "Precio Lista M.O.",
    defaultWidth: 110,
    minWidth: 92,
    resizable: true,
  },
  {
    key: "listPriceUnit",
    label: "Precio de lista",
    defaultWidth: 88,
    minWidth: 72,
    resizable: true,
  },
  {
    key: "manufacturerDiscountPct",
    label: "Desc. prov. %",
    defaultWidth: 88,
    minWidth: 72,
    resizable: true,
  },
  {
    key: "discountedListPriceUnit",
    label: "Prec. lista desc.",
    defaultWidth: 88,
    minWidth: 72,
    resizable: true,
  },
  {
    key: "importCostPct",
    label: "Imp. %",
    defaultWidth: 88,
    minWidth: 72,
    resizable: true,
  },
  {
    key: "costUnit",
    label: "Costo unitario",
    defaultWidth: 88,
    minWidth: 72,
    resizable: true,
  },
  {
    key: "costTotal",
    label: "Costo total",
    defaultWidth: 100,
    minWidth: 84,
    resizable: true,
  },
  {
    key: "profitMarginPct",
    label: "Margen %",
    defaultWidth: 64,
    minWidth: 56,
    resizable: true,
  },
  {
    key: "finalDiscountPct",
    label: "Desc. final %",
    defaultWidth: 88,
    minWidth: 72,
    resizable: true,
  },
  {
    key: "salePriceUnit",
    label: "Precio venta unitario",
    defaultWidth: 108,
    minWidth: 92,
    resizable: true,
  },
  {
    key: "salePriceTotal",
    label: "Precio venta total",
    defaultWidth: 108,
    minWidth: 92,
    resizable: true,
  },
];

function QuotationCreateModal({
  accounts,
  accountName,
  draftQuotationIdLabel,
  draftQuotationVersionLabel,
  selectedAccountId,
  onCreateAccountChange,
  loadingAccounts,
  opportunities,
  opportunityName,
  selectedOpportunityId,
  onCreateOpportunityChange,
  loadingOpportunities,
  contactOptions,
  loadingContacts,
  selectedOpportunity,
  createCommercialContextConfirmed,
  handleConfirmCreateCommercialContext,
  canConfirmCreateCommercialContext,
  createQuotationForm,
  setCreateQuotationForm,
  createSectionDraft,
  setCreateSectionDraft,
  createSectionDrafts,
  createItemDraftsBySection,
  setCreateItemDraftsBySection,
  catalogs,
  handleAddCreateSectionDraft,
  handleRemoveCreateSectionDraft,
  handleMoveCreateSectionDraft,
  handleUpdateCreateSectionDraft,
  handleUpdateCreateSectionItem,
  handleApplyCreateSectionItemProduct,
  handleAddCreateSectionItem,
  createSelectedItemIdsBySection,
  createHighlightedItemIdsBySection,
  setCreateSelectedItemIdsBySection,
  handleToggleCreateSectionItemSelection,
  handleToggleAllCreateSectionItems,
  handleHighlightCreateSectionItems,
  handleUnhighlightCreateSectionItems,
  handleMoveCreateSectionItems,
  handleDuplicateCreateSectionItems,
  handleCopyCreateSectionItems,
  handlePasteCreateSectionItems,
  handleRemoveCreateSectionItems,
  handleCreateManualBundle,
  handleAttachCreateSectionItemsToManualBundle,
  handleDetachCreateSectionItemsFromManualBundle,
  hasCreateCopiedItems,
  closeCreateQuotationModal,
  handleCreateQuotation,
  busyAction,
  canSubmitCreateQuotation,
  hasCreateCommercialContext,
}) {
  const [summaryDiscountMode, setSummaryDiscountMode] = useState("percentage");
  const [summaryDiscountValue, setSummaryDiscountValue] = useState("0");
  const [isSummaryDiscountInputFocused, setIsSummaryDiscountInputFocused] =
    useState(false);
  const [summaryDistributionMode, setSummaryDistributionMode] =
    useState("total");
  const [summaryVatMode, setSummaryVatMode] = useState("without_vat");
  const [internalNotes, setInternalNotes] = useState("");
  const [commercialConditions, setCommercialConditions] = useState(() =>
    buildQuotationCommercialConditionsForm(),
  );
  const distributedBaseSectionDrafts = useMemo(
    () => buildCreateQuotationDistributedBaseSections(createSectionDrafts),
    [createSectionDrafts],
  );
  const summaryDiscountPreviewSections = useMemo(
    () =>
      summaryVatMode === "per_item"
        ? applyCreateQuotationPerItemVat(
            summaryDistributionMode === "per_item"
              ? distributedBaseSectionDrafts
              : createSectionDrafts,
            DEFAULT_QUOTATION_VAT_PCT,
          )
        : summaryDistributionMode === "per_item"
          ? distributedBaseSectionDrafts
          : createSectionDrafts,
    [
      createSectionDrafts,
      distributedBaseSectionDrafts,
      summaryDistributionMode,
      summaryVatMode,
    ],
  );
  const summaryDiscountPreview = useMemo(
    () =>
      calculateCreateQuotationSummary(summaryDiscountPreviewSections, {
        mode: summaryDiscountMode,
        value: summaryDiscountValue,
      }),
    [summaryDiscountMode, summaryDiscountPreviewSections, summaryDiscountValue],
  );
  const discountedCreateSectionDrafts = useMemo(
    () =>
      summaryDistributionMode === "per_item"
        ? applyCreateQuotationDistributedFinalDiscount(
            distributedBaseSectionDrafts,
            summaryDiscountPreview.summaryDiscountPct,
          )
        : createSectionDrafts,
    [
      createSectionDrafts,
      distributedBaseSectionDrafts,
      summaryDiscountPreview.summaryDiscountPct,
      summaryDistributionMode,
    ],
  );
  const effectiveCreateSectionDrafts = useMemo(
    () =>
      (summaryVatMode === "per_item"
        ? applyCreateQuotationPerItemVat(
            discountedCreateSectionDrafts,
            DEFAULT_QUOTATION_VAT_PCT,
          )
        : discountedCreateSectionDrafts
      ).map((section) => ({
        ...section,
        items: (section.items || []).map((item) => {
          const pricing = buildQuotationItemPricing(item, commercialConditions);
          return {
            ...item,
            quotationCurrencyCode: commercialConditions.currencyCode,
            quotationExchangeRate: commercialConditions.exchangeRate,
            originalCurrencyCode: pricing.originalCurrencyCode,
            originalListPriceUnit: String(pricing.originalListPriceUnit),
            listPriceUnit: String(pricing.listPriceUnit),
          };
        }),
      })),
    [commercialConditions, discountedCreateSectionDrafts, summaryVatMode],
  );
  const effectiveCreateSectionItemsBySectionId = useMemo(
    () =>
      new Map(
        effectiveCreateSectionDrafts.map((section) => [
          section.localId,
          section.items || [],
        ]),
      ),
    [effectiveCreateSectionDrafts],
  );
  const effectiveCreateItemsByLocalId = useMemo(() => {
    const itemsByLocalId = new Map();

    effectiveCreateSectionDrafts.forEach((section) => {
      (section.items || []).forEach((item) => {
        itemsByLocalId.set(item.localId, item);
      });
    });

    return itemsByLocalId;
  }, [effectiveCreateSectionDrafts]);
  const createQuotationSummary = useMemo(
    () =>
      calculateCreateQuotationSummary(
        effectiveCreateSectionDrafts,
        summaryDistributionMode === "per_item"
          ? null
          : {
              mode: summaryDiscountMode,
              value: summaryDiscountValue,
            },
        {
          mode: summaryVatMode === "total" ? "total" : "without_vat",
          vatPct: DEFAULT_QUOTATION_VAT_PCT,
        },
      ),
    [
      effectiveCreateSectionDrafts,
      summaryDiscountMode,
      summaryDistributionMode,
      summaryDiscountValue,
      summaryVatMode,
    ],
  );

  const [accountQuery, setAccountQuery] = useState("");
  const [itemTableColumnWidths, setItemTableColumnWidths] = useState(() =>
    ITEM_TABLE_COLUMNS.map((column) => column.defaultWidth),
  );
  const [activeResizeColumnIndex, setActiveResizeColumnIndex] = useState(-1);
  const [activeDescriptionEditor, setActiveDescriptionEditor] = useState({
    sectionIndex: -1,
    itemIndex: -1,
  });
  const [productPickerState, setProductPickerState] = useState({
    isOpen: false,
    sectionIndex: -1,
    itemIndex: -1,
    providerId: "",
    query: "",
    loading: false,
    error: "",
    results: [],
  });
  const [collapsedBundleIdsBySection, setCollapsedBundleIdsBySection] =
    useState({});
  const [manualBundlePickerState, setManualBundlePickerState] = useState({
    isOpen: false,
    sectionIndex: -1,
    parentLocalId: "",
  });
  const [
    preferredBundleHintActionBySection,
    setPreferredBundleHintActionBySection,
  ] = useState({});
  const activeResizeRef = useRef(null);
  const initialSnapshotRef = useRef(null);

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

  function getSummaryDiscountDisplayValue() {
    if (summaryDiscountMode !== "amount" || isSummaryDiscountInputFocused) {
      return summaryDiscountValue;
    }

    const numericValue = Number(summaryDiscountValue);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return "0";
    }

    return formatQuotationAmount(summaryDiscountValue);
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

    setSummaryDiscountMode(nextMode);
    setSummaryDiscountValue(nextValue);
  }

  function handleSummaryDiscountValueChange(nextValue) {
    setSummaryDiscountValue(
      summaryDiscountMode === "amount"
        ? sanitizeSummaryDiscountInputValue(nextValue)
        : nextValue,
    );
  }

  function handleCommercialConditionChange(field, value) {
    setCommercialConditions((currentValue) => ({
      ...currentValue,
      [field]: value,
    }));
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
          "Selecciona uno o mas componentes de un bundle para quitarlos del grupo.",
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
        message: "Selecciona componentes que pertenezcan al mismo bundle.",
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

  useEffect(() => {
    setCollapsedBundleIdsBySection((prev) => {
      const nextState = {};

      createSectionDrafts.forEach((section) => {
        const sectionItems = section.items || [];
        const validBundleIds = new Set(
          sectionItems
            .filter((item) =>
              sectionItems.some(
                (candidate) => candidate.bundleParentLocalId === item.localId,
              ),
            )
            .map((item) => item.localId),
        );
        const nextCollapsedIds = (prev[section.localId] || []).filter(
          (bundleId) => validBundleIds.has(bundleId),
        );

        if (nextCollapsedIds.length) {
          nextState[section.localId] = nextCollapsedIds;
        }
      });

      return nextState;
    });
  }, [createSectionDrafts]);

  useEffect(() => {
    if (!selectedAccountId) return;

    const selectedAccount = accounts.find(
      (account) => String(account.id) === String(selectedAccountId),
    );

    if (selectedAccount?.name) {
      setAccountQuery(selectedAccount.name);
    }
  }, [accounts, selectedAccountId]);

  const filteredAccounts = useMemo(() => {
    const normalizedQuery = accountQuery.trim().toLowerCase();

    if (!normalizedQuery) {
      return accounts;
    }

    return accounts.filter((account) =>
      String(account.name || "")
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [accountQuery, accounts]);

  function getInclusionTypeMeta(inclusionTypeId) {
    return (
      catalogs.inclusionTypes.find(
        (type) => String(type.id) === String(inclusionTypeId),
      ) || null
    );
  }

  function handleAccountQueryChange(value) {
    setAccountQuery(value);

    const normalizedValue = value.trim().toLowerCase();
    const exactMatch = accounts.find(
      (account) =>
        String(account.name || "")
          .trim()
          .toLowerCase() === normalizedValue,
    );

    if (exactMatch) {
      onCreateAccountChange(String(exactMatch.id));
      return;
    }

    if (selectedAccountId) {
      onCreateAccountChange("");
    }
  }

  const rawOpportunityCloseDate = String(
    selectedOpportunity?.closeDate || "",
  ).trim();
  const normalizedOpportunityCloseDate = rawOpportunityCloseDate
    ? rawOpportunityCloseDate.slice(0, 10)
    : "";
  const formattedOpportunityAmount =
    selectedOpportunity?.amountUsd === null ||
    selectedOpportunity?.amountUsd === undefined ||
    selectedOpportunity?.amountUsd === ""
      ? ""
      : Number(selectedOpportunity.amountUsd).toLocaleString("es-MX", {
          style: "currency",
          currency: "USD",
          minimumFractionDigits: 0,
        });
  const formattedOpportunityCloseDate = /^\d{4}-\d{2}-\d{2}$/.test(
    normalizedOpportunityCloseDate,
  )
    ? normalizedOpportunityCloseDate.split("-").reverse().join("/")
    : "";
  const inheritedContextContactName = useMemo(() => {
    if (!selectedOpportunity?.contactId) {
      return "";
    }

    return (
      contactOptions.find(
        (contact) =>
          String(contact.id) === String(selectedOpportunity.contactId),
      )?.full_name || ""
    );
  }, [contactOptions, selectedOpportunity]);

  useEffect(() => {
    if (!productPickerState.isOpen) return undefined;

    if (!productPickerState.providerId) {
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
    productPickerState.providerId,
    productPickerState.query,
  ]);

  useEffect(() => {
    if (activeResizeColumnIndex < 0) {
      return undefined;
    }

    const handleMouseMove = (event) => {
      const activeResize = activeResizeRef.current;

      if (!activeResize) {
        return;
      }

      const column = ITEM_TABLE_COLUMNS[activeResize.columnIndex];
      const nextWidth = Math.max(
        column.minWidth,
        activeResize.startWidth + event.clientX - activeResize.startX,
      );

      setItemTableColumnWidths((currentWidths) => {
        if (currentWidths[activeResize.columnIndex] === nextWidth) {
          return currentWidths;
        }

        return currentWidths.map((width, index) =>
          index === activeResize.columnIndex ? nextWidth : width,
        );
      });
    };

    const handleMouseUp = () => {
      activeResizeRef.current = null;
      setActiveResizeColumnIndex(-1);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [activeResizeColumnIndex]);

  function startItemTableColumnResize(columnIndex, event) {
    const column = ITEM_TABLE_COLUMNS[columnIndex];

    if (!column?.resizable) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    activeResizeRef.current = {
      columnIndex,
      startX: event.clientX,
      startWidth: itemTableColumnWidths[columnIndex],
    };
    setActiveResizeColumnIndex(columnIndex);
  }

  useEffect(() => {
    if (activeDescriptionEditor.sectionIndex < 0) {
      return undefined;
    }

    const activeEditorKey = `${activeDescriptionEditor.sectionIndex}-${activeDescriptionEditor.itemIndex}`;

    const handlePointerDown = (event) => {
      const editorRoot = event.target.closest(
        `[data-description-editor-key="${activeEditorKey}"]`,
      );

      if (!editorRoot) {
        setActiveDescriptionEditor({ sectionIndex: -1, itemIndex: -1 });
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setActiveDescriptionEditor({ sectionIndex: -1, itemIndex: -1 });
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeDescriptionEditor]);

  function openDescriptionEditor(sectionIndex, itemIndex) {
    setActiveDescriptionEditor({ sectionIndex, itemIndex });
  }

  function toggleBundleCollapsed(sectionLocalId, bundleLocalId, sectionItems) {
    const componentIds = (sectionItems || [])
      .filter((item) => item.bundleParentLocalId === bundleLocalId)
      .map((item) => item.localId);

    setCollapsedBundleIdsBySection((prev) => {
      const currentIds = prev[sectionLocalId] || [];
      const isCollapsed = currentIds.includes(bundleLocalId);
      const nextIds = isCollapsed
        ? currentIds.filter((currentId) => currentId !== bundleLocalId)
        : [...currentIds, bundleLocalId];

      if (!isCollapsed && componentIds.length) {
        setCreateSelectedItemIdsBySection((currentSelection) => {
          const selectedIds = currentSelection[sectionLocalId] || [];
          const hasSelectedComponents = componentIds.some((itemId) =>
            selectedIds.includes(itemId),
          );

          if (!hasSelectedComponents) {
            return currentSelection;
          }

          const nextSelectedIds = selectedIds.filter(
            (itemId) => !componentIds.includes(itemId),
          );

          if (!nextSelectedIds.includes(bundleLocalId)) {
            nextSelectedIds.push(bundleLocalId);
          }

          return {
            ...currentSelection,
            [sectionLocalId]: nextSelectedIds,
          };
        });
      }

      return {
        ...prev,
        [sectionLocalId]: nextIds,
      };
    });
  }

  function closeDescriptionEditor() {
    setActiveDescriptionEditor({ sectionIndex: -1, itemIndex: -1 });
  }

  function setPreferredBundleHintAction(sectionLocalId, action) {
    setPreferredBundleHintActionBySection((prev) => {
      if (prev[sectionLocalId] === action) {
        return prev;
      }

      return {
        ...prev,
        [sectionLocalId]: action,
      };
    });
  }

  function clearPreferredBundleHintAction(sectionLocalId, action) {
    setPreferredBundleHintActionBySection((prev) => {
      if (prev[sectionLocalId] !== action) {
        return prev;
      }

      const next = { ...prev };
      delete next[sectionLocalId];
      return next;
    });
  }

  function openManualBundlePicker(sectionIndex, sectionItems, selectedItemIds) {
    const selection = getManualBundleSelectionState(
      sectionItems,
      selectedItemIds,
    );
    if (!selection.ok) {
      return;
    }

    setManualBundlePickerState({
      isOpen: true,
      sectionIndex,
      parentLocalId: selection.items[0]?.localId || "",
    });
  }

  function closeManualBundlePicker() {
    setManualBundlePickerState({
      isOpen: false,
      sectionIndex: -1,
      parentLocalId: "",
    });
  }

  function confirmManualBundle() {
    if (!manualBundlePickerState.isOpen) {
      return;
    }

    const created = handleCreateManualBundle(
      manualBundlePickerState.sectionIndex,
      manualBundlePickerState.parentLocalId,
    );

    if (created) {
      closeManualBundlePicker();
    }
  }

  const activeManualBundleSection =
    manualBundlePickerState.sectionIndex >= 0
      ? createSectionDrafts[manualBundlePickerState.sectionIndex] || null
      : null;
  const activeManualBundleSelection = activeManualBundleSection
    ? getManualBundleSelectionState(
        activeManualBundleSection.items || [],
        createSelectedItemIdsBySection[activeManualBundleSection.localId] || [],
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

  function openProductPicker(
    sectionIndex,
    itemIndex,
    currentCode = "",
    currentProviderId = "",
  ) {
    setProductPickerState({
      isOpen: true,
      sectionIndex,
      itemIndex,
      providerId: String(currentProviderId || ""),
      query: String(currentCode || "").trim(),
      loading: false,
      error: "",
      results: [],
    });
  }

  function closeProductPicker() {
    setProductPickerState({
      isOpen: false,
      sectionIndex: -1,
      itemIndex: -1,
      providerId: "",
      query: "",
      loading: false,
      error: "",
      results: [],
    });
  }

  function handleSelectProduct(product) {
    handleApplyCreateSectionItemProduct(
      productPickerState.sectionIndex,
      productPickerState.itemIndex,
      product,
    );
    closeProductPicker();
  }

  const currentCreateSnapshot = useMemo(
    () =>
      JSON.stringify({
        accountQuery,
        selectedAccountId,
        selectedOpportunityId,
        createCommercialContextConfirmed,
        createQuotationForm,
        createSectionDrafts: effectiveCreateSectionDrafts,
        summaryDiscountMode,
        summaryDiscountValue,
        summaryDistributionMode,
        summaryVatMode,
        internalNotes,
        commercialConditions,
      }),
    [
      accountQuery,
      commercialConditions,
      createCommercialContextConfirmed,
      createQuotationForm,
      effectiveCreateSectionDrafts,
      internalNotes,
      selectedAccountId,
      selectedOpportunityId,
      summaryDiscountMode,
      summaryDiscountValue,
      summaryDistributionMode,
      summaryVatMode,
    ],
  );
  const hasUnsavedChanges =
    initialSnapshotRef.current != null &&
    currentCreateSnapshot !== initialSnapshotRef.current;

  useEffect(() => {
    if (initialSnapshotRef.current == null) {
      initialSnapshotRef.current = currentCreateSnapshot;
    }
  }, [currentCreateSnapshot]);

  useEffect(() => {
    if (typeof window === "undefined" || !hasUnsavedChanges) {
      return undefined;
    }

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [hasUnsavedChanges]);

  useLayoutEffect(() => {
    setQuotationNavigationGuard("create-quotation", {
      active: hasUnsavedChanges,
      message:
        "Tienes cambios sin guardar en la nueva cotizacion. Si sales ahora, los cambios locales se perderan. ¿Quieres continuar?",
    });

    return () => {
      setQuotationNavigationGuard("create-quotation", { active: false });
    };
  }, [hasUnsavedChanges]);

  function requestCloseCreateQuotationModal() {
    if (
      hasUnsavedChanges &&
      typeof window !== "undefined" &&
      !window.confirm(
        "Tienes cambios sin guardar en la nueva cotizacion. Si sales ahora, los cambios locales se perderan. ¿Quieres continuar?",
      )
    ) {
      return;
    }

    closeCreateQuotationModal();
  }

  return (
    <>
      <div className="modal-overlay" onClick={requestCloseCreateQuotationModal}>
        <div
          className="modal-dialog modal-dialog-account quotation-create-modal"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="modal-header">
            <div className="opportunity-modal-header-copy">
              <h3 className="modal-title">Crear cotizacion</h3>
              <p className="field-hint opportunity-modal-subtitle">
                Selecciona el contexto comercial y completa los datos para
                registrar la cotizacion.
              </p>
            </div>
          </div>

          <form
            className="account-create-form in-modal"
            onSubmit={(event) => {
              event.preventDefault();
              handleCreateQuotation({
                summaryDiscountInput:
                  summaryDistributionMode === "per_item"
                    ? null
                    : {
                        mode: summaryDiscountMode,
                        value: Number(summaryDiscountValue) || 0,
                      },
                summaryMeta: {
                  distributionMode: summaryDistributionMode,
                  vatMode: summaryVatMode,
                  vatPct:
                    summaryVatMode === "without_vat"
                      ? 0
                      : DEFAULT_QUOTATION_VAT_PCT,
                },
                internalNotes,
                commercialConditions,
                sectionDrafts: effectiveCreateSectionDrafts,
              });
            }}
          >
            <section className="account-form-section opportunity-main-data-section">
              <h4>Contexto comercial</h4>
              <p className="field-hint">
                Selecciona la cuenta, su oportunidad y el contacto asociado.
              </p>
              <div className="grid-form account-grid-main quotation-commercial-context-grid">
                <div className="field-group">
                  <label>Cuenta</label>
                  <input
                    value={accountQuery}
                    disabled={
                      createCommercialContextConfirmed ||
                      loadingAccounts ||
                      !accounts.length
                    }
                    list={
                      selectedAccountId
                        ? undefined
                        : "quotation-create-account-options"
                    }
                    placeholder="Selecciona o busca cuenta"
                    autoComplete="off"
                    onChange={(event) =>
                      handleAccountQueryChange(event.target.value)
                    }
                  />
                  {!selectedAccountId ? (
                    <datalist id="quotation-create-account-options">
                      {filteredAccounts.map((account) => (
                        <option key={account.id} value={account.name} />
                      ))}
                    </datalist>
                  ) : null}
                  {accountQuery && !filteredAccounts.length ? (
                    <p className="field-hint quotation-create-step-hint">
                      No hay cuentas activas que coincidan con la busqueda.
                    </p>
                  ) : null}
                </div>
                <div className="field-group">
                  <label>Oportunidad</label>
                  <select
                    value={selectedOpportunityId}
                    disabled={
                      createCommercialContextConfirmed ||
                      !selectedAccountId ||
                      loadingOpportunities
                    }
                    onChange={(event) =>
                      onCreateOpportunityChange(event.target.value)
                    }
                  >
                    <option value="">Selecciona oportunidad</option>
                    {opportunities.map((opportunity) => (
                      <option key={opportunity.id} value={opportunity.id}>
                        {opportunity.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-group">
                  <label>Contacto</label>
                  <input
                    value={inheritedContextContactName}
                    readOnly
                    placeholder="Se hereda de la oportunidad"
                  />
                </div>
                <div className="field-group">
                  <label>Fecha de cierre</label>
                  <input
                    value={formattedOpportunityCloseDate}
                    readOnly
                    placeholder="Selecciona oportunidad"
                  />
                </div>
                <div className="field-group">
                  <label>Etapa del proceso de venta</label>
                  <input
                    value={selectedOpportunity?.salesStageName || ""}
                    readOnly
                    placeholder="Selecciona oportunidad"
                  />
                </div>
                <div className="field-group">
                  <label>Importe</label>
                  <input
                    value={formattedOpportunityAmount}
                    readOnly
                    placeholder="Selecciona oportunidad"
                  />
                </div>
                <div className="quotation-context-action-cell">
                  <button
                    type="button"
                    className="quotation-context-confirm-icon"
                    disabled={
                      createCommercialContextConfirmed ||
                      !canConfirmCreateCommercialContext
                    }
                    aria-label="Ingresar datos de la cotizacion"
                    title="Ingresar datos de la cotizacion"
                    onClick={handleConfirmCreateCommercialContext}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </button>
                </div>
              </div>
              {createCommercialContextConfirmed ? (
                <p className="field-hint quotation-create-step-hint">
                  El contexto comercial quedo confirmado y ya no se puede
                  modificar en esta cotizacion.
                </p>
              ) : null}
              {!selectedAccountId ? (
                <p className="field-hint quotation-create-step-hint">
                  Selecciona una cuenta para cargar oportunidades y contactos.
                </p>
              ) : null}
              {selectedAccountId &&
              !loadingOpportunities &&
              !opportunities.length ? (
                <p className="field-hint quotation-create-step-hint">
                  Esta cuenta no tiene oportunidades disponibles.
                </p>
              ) : null}
              {selectedAccountId &&
              !loadingContacts &&
              !contactOptions.length ? (
                <p className="field-hint quotation-create-step-hint">
                  Esta cuenta no tiene contactos disponibles.
                </p>
              ) : null}
            </section>

            {createCommercialContextConfirmed ? (
              <>
                <section className="account-form-section opportunity-sales-management-section">
                  <div className="quotation-proposal-section-header">
                    <div>
                      <h4>Datos de propuesta</h4>
                      <p className="field-hint">
                        El vendedor se precarga desde la oportunidad
                        seleccionada.
                      </p>
                    </div>
                    <div className="quotation-proposal-meta">
                      <div className="quotation-proposal-badges">
                        <span
                          className="record-id-badge"
                          title="ID de la cotizacion"
                        >
                          <span className="record-id-icon" aria-hidden="true">
                            #
                          </span>
                          Cotizacion {draftQuotationIdLabel}
                        </span>
                        <span
                          className="record-id-badge"
                          title="Version inicial"
                        >
                          <span className="record-id-icon" aria-hidden="true">
                            V
                          </span>
                          Version {draftQuotationVersionLabel}
                        </span>
                      </div>
                      <span className="user-status-badge draft">
                        Estado de la propuesta: Borrador
                      </span>
                    </div>
                  </div>
                  <div className="grid-form account-grid-main">
                    <div className="field-group">
                      <label>Nombre de propuesta</label>
                      <input
                        value={createQuotationForm.proposalName}
                        onChange={(event) =>
                          setCreateQuotationForm((prev) => ({
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
                        value={createQuotationForm.quotationDate}
                        onChange={(event) =>
                          setCreateQuotationForm((prev) => ({
                            ...prev,
                            quotationDate: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="field-group">
                      <label>Vendedor</label>
                      <input
                        value={createQuotationForm.sellerUserName}
                        readOnly
                        placeholder="Sin vendedor asignado"
                      />
                    </div>
                    <div className="field-group">
                      <label>Contacto a cotizar</label>
                      <select
                        value={createQuotationForm.contactId}
                        disabled={loadingContacts || !selectedAccountId}
                        onChange={(event) =>
                          setCreateQuotationForm((prev) => ({
                            ...prev,
                            contactId: event.target.value,
                          }))
                        }
                      >
                        <option value="">No seleccionado</option>
                        {contactOptions.map((contact) => (
                          <option key={contact.id} value={contact.id}>
                            {contact.full_name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field-group field-group-full-width">
                      <label>Introduccion</label>
                      <textarea
                        rows={1}
                        value={createQuotationForm.introduction}
                        onChange={(event) =>
                          setCreateQuotationForm((prev) => ({
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
                        Se enviaran junto con la creacion de la cotizacion.
                      </p>
                    </div>
                    <div className="quotation-action-groups">
                      <div className="quotation-action-group">
                        <span className="quotation-action-group-label">
                          Seccion
                        </span>
                        <div className="quotation-icon-actions">
                          <QuotationIconButton
                            title="Agregar seccion inicial"
                            onClick={handleAddCreateSectionDraft}
                          >
                            <PlusIcon />
                          </QuotationIconButton>
                        </div>
                      </div>
                    </div>
                  </div>

                  {createSectionDrafts.length ? (
                    <div className="quotation-create-section-drafts">
                      {effectiveCreateSectionDrafts.map((section, index) => {
                        const sectionItems = section.items || [];
                        const effectiveSectionItems =
                          effectiveCreateSectionItemsBySectionId.get(
                            section.localId,
                          ) || sectionItems;
                        const selectedItemIds =
                          createSelectedItemIdsBySection[section.localId] || [];
                        const collapsedBundleIds = new Set(
                          collapsedBundleIdsBySection[section.localId] || [],
                        );
                        const visibleSectionItems = sectionItems.reduce(
                          (accumulator, item, itemIndex) => {
                            if (
                              item.isBundleComponent &&
                              collapsedBundleIds.has(item.bundleParentLocalId)
                            ) {
                              return accumulator;
                            }

                            accumulator.push({ item, itemIndex });
                            return accumulator;
                          },
                          [],
                        );
                        const visibleItemIds = visibleSectionItems.map(
                          ({ item }) => item.localId,
                        );
                        const highlightedItemIds =
                          createHighlightedItemIdsBySection[section.localId] ||
                          [];
                        const visibleSelectedItemIds = visibleItemIds.filter(
                          (itemId) => selectedItemIds.includes(itemId),
                        );
                        const manualBundleSelection =
                          getManualBundleSelectionState(
                            sectionItems,
                            selectedItemIds,
                          );
                        const attachManualBundleSelection =
                          getAttachToManualBundleSelectionState(
                            sectionItems,
                            selectedItemIds,
                          );
                        const detachManualBundleSelection =
                          getDetachFromManualBundleSelectionState(
                            sectionItems,
                            selectedItemIds,
                          );
                        const showManualBundleHint =
                          selectedItemIds.length > 0 &&
                          !manualBundleSelection.ok &&
                          !attachManualBundleSelection.ok &&
                          !detachManualBundleSelection.ok;
                        const manualBundleHintMessage = showManualBundleHint
                          ? getBundleHintMessage({
                              manualSelection: manualBundleSelection,
                              attachSelection: attachManualBundleSelection,
                              detachSelection: detachManualBundleSelection,
                              preferredAction:
                                preferredBundleHintActionBySection[
                                  section.localId
                                ] || null,
                            })
                          : "";
                        const allItemsSelected =
                          visibleItemIds.length > 0 &&
                          visibleItemIds.every((itemId) =>
                            selectedItemIds.includes(itemId),
                          );
                        const sectionTotals = sectionItems
                          .filter((item) => !item.isBundleComponent)
                          .reduce(
                            (accumulator, item) => {
                              const effectiveItem =
                                effectiveCreateItemsByLocalId.get(
                                  item.localId,
                                ) || item;
                              const totals =
                                calculateQuotationItemDisplayTotals(
                                  effectiveItem,
                                  effectiveSectionItems,
                                );

                              return {
                                costTotal:
                                  accumulator.costTotal +
                                  Number(totals.costTotal || 0),
                                salePriceTotal:
                                  accumulator.salePriceTotal +
                                  Number(totals.salePriceTotal || 0),
                              };
                            },
                            { costTotal: 0, salePriceTotal: 0 },
                          );

                        return (
                          <div
                            key={section.localId || index}
                            className="quotation-section-card"
                          >
                            <div className="quotation-section-card-header">
                              <div className="quotation-action-groups">
                                <div className="quotation-action-group">
                                  <span className="quotation-action-group-label">
                                    Fila
                                  </span>
                                  <div className="quotation-icon-actions">
                                    <QuotationIconButton
                                      title="Agregar fila"
                                      onClick={() =>
                                        handleAddCreateSectionItem(index)
                                      }
                                    >
                                      <PlusIcon />
                                    </QuotationIconButton>
                                    <QuotationIconButton
                                      title="Eliminar filas seleccionadas"
                                      disabled={!visibleSelectedItemIds.length}
                                      danger
                                      onClick={() =>
                                        handleRemoveCreateSectionItems(index)
                                      }
                                    >
                                      <TrashIcon />
                                    </QuotationIconButton>
                                    <QuotationIconButton
                                      title="Subir una posicion las filas seleccionadas"
                                      disabled={!visibleSelectedItemIds.length}
                                      onClick={() =>
                                        handleMoveCreateSectionItems(index, -1)
                                      }
                                    >
                                      <UpIcon />
                                    </QuotationIconButton>
                                    <QuotationIconButton
                                      title="Bajar una posicion las filas seleccionadas"
                                      disabled={!visibleSelectedItemIds.length}
                                      onClick={() =>
                                        handleMoveCreateSectionItems(index, 1)
                                      }
                                    >
                                      <DownIcon />
                                    </QuotationIconButton>
                                    <QuotationIconButton
                                      title="Duplicar filas seleccionadas"
                                      disabled={!visibleSelectedItemIds.length}
                                      onClick={() =>
                                        handleDuplicateCreateSectionItems(index)
                                      }
                                    >
                                      <DuplicateIcon />
                                    </QuotationIconButton>
                                    <QuotationIconButton
                                      title="Copiar filas seleccionadas"
                                      disabled={!visibleSelectedItemIds.length}
                                      onClick={() =>
                                        handleCopyCreateSectionItems(index)
                                      }
                                    >
                                      <CopyIcon />
                                    </QuotationIconButton>
                                    <QuotationIconButton
                                      title="Pegar filas copiadas"
                                      disabled={!hasCreateCopiedItems}
                                      onClick={() =>
                                        handlePasteCreateSectionItems(index)
                                      }
                                    >
                                      <PasteIcon />
                                    </QuotationIconButton>
                                    <QuotationIconButton
                                      title="Resaltar filas seleccionadas"
                                      disabled={!visibleSelectedItemIds.length}
                                      onClick={() =>
                                        handleHighlightCreateSectionItems(index)
                                      }
                                    >
                                      <HighlightIcon />
                                    </QuotationIconButton>
                                    <QuotationIconButton
                                      title="Quitar resaltado de filas seleccionadas"
                                      disabled={!visibleSelectedItemIds.length}
                                      onClick={() =>
                                        handleUnhighlightCreateSectionItems(
                                          index,
                                        )
                                      }
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
                                              section.localId,
                                              "manual",
                                            )
                                          }
                                          onMouseLeave={() =>
                                            clearPreferredBundleHintAction(
                                              section.localId,
                                              "manual",
                                            )
                                          }
                                        >
                                          <QuotationIconButton
                                            title="Crear bundle manual con filas seleccionadas"
                                            disabled={!manualBundleSelection.ok}
                                            onClick={() =>
                                              openManualBundlePicker(
                                                index,
                                                sectionItems,
                                                selectedItemIds,
                                              )
                                            }
                                          >
                                            <BundleManualIcon />
                                          </QuotationIconButton>
                                        </span>
                                        <span
                                          onMouseEnter={() =>
                                            setPreferredBundleHintAction(
                                              section.localId,
                                              "attach",
                                            )
                                          }
                                          onMouseLeave={() =>
                                            clearPreferredBundleHintAction(
                                              section.localId,
                                              "attach",
                                            )
                                          }
                                        >
                                          <QuotationIconButton
                                            title="Adjuntar filas seleccionadas al bundle manual"
                                            disabled={
                                              !attachManualBundleSelection.ok
                                            }
                                            onClick={() =>
                                              handleAttachCreateSectionItemsToManualBundle(
                                                index,
                                              )
                                            }
                                          >
                                            <BundleAttachIcon />
                                          </QuotationIconButton>
                                        </span>
                                        <span
                                          onMouseEnter={() =>
                                            setPreferredBundleHintAction(
                                              section.localId,
                                              "detach",
                                            )
                                          }
                                          onMouseLeave={() =>
                                            clearPreferredBundleHintAction(
                                              section.localId,
                                              "detach",
                                            )
                                          }
                                        >
                                          <QuotationIconButton
                                            title="Quitar filas seleccionadas del bundle manual"
                                            disabled={
                                              !detachManualBundleSelection.ok
                                            }
                                            onClick={() =>
                                              handleDetachCreateSectionItemsFromManualBundle(
                                                index,
                                              )
                                            }
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
                                          String(section.inclusionTypeId) ===
                                          String(type.id);

                                        return (
                                          <button
                                            key={type.id}
                                            type="button"
                                            className={`quotation-icon-button quotation-inclusion-button${isSelected ? " is-selected" : ""}`}
                                            aria-label={type.name}
                                            aria-pressed={isSelected}
                                            title={type.name}
                                            onClick={() =>
                                              handleUpdateCreateSectionDraft(
                                                index,
                                                "inclusionTypeId",
                                                String(type.id),
                                              )
                                            }
                                          >
                                            <InclusionIcon code={type.code} />
                                          </button>
                                        );
                                      })}
                                    </div>
                                    <QuotationIconButton
                                      title="Subir seccion"
                                      disabled={index === 0}
                                      onClick={() =>
                                        handleMoveCreateSectionDraft(index, -1)
                                      }
                                    >
                                      <UpIcon />
                                    </QuotationIconButton>
                                    <QuotationIconButton
                                      title="Bajar seccion"
                                      disabled={
                                        index === createSectionDrafts.length - 1
                                      }
                                      onClick={() =>
                                        handleMoveCreateSectionDraft(index, 1)
                                      }
                                    >
                                      <DownIcon />
                                    </QuotationIconButton>
                                    <QuotationIconButton
                                      title="Eliminar seccion"
                                      danger
                                      onClick={() =>
                                        handleRemoveCreateSectionDraft(index)
                                      }
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
                                  value={section.title}
                                  placeholder={
                                    getInclusionTypeMeta(
                                      section.inclusionTypeId,
                                    )?.name || "Titulo de la seccion"
                                  }
                                  onChange={(event) =>
                                    handleUpdateCreateSectionDraft(
                                      index,
                                      "title",
                                      event.target.value,
                                    )
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
                            manualBundlePickerState.sectionIndex === index &&
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
                                      Elige la fila padre. Las demas filas
                                      seleccionadas quedaran como componentes.
                                    </p>
                                  </div>
                                </div>
                                <div className="quotation-manual-bundle-picker-grid">
                                  <div className="quotation-manual-bundle-picker-column">
                                    <span className="quotation-manual-bundle-picker-label">
                                      Padre
                                    </span>
                                    <div className="quotation-manual-bundle-options">
                                      {activeManualBundleSelection.items.map(
                                        (item) => (
                                          <label
                                            key={item.localId}
                                            className="quotation-manual-bundle-option"
                                          >
                                            <input
                                              type="radio"
                                              name={`manual-bundle-parent-${section.localId}`}
                                              value={item.localId}
                                              checked={
                                                manualBundlePickerState.parentLocalId ===
                                                item.localId
                                              }
                                              onChange={(event) =>
                                                setManualBundlePickerState(
                                                  (prev) => ({
                                                    ...prev,
                                                    parentLocalId:
                                                      event.target.value,
                                                  }),
                                                )
                                              }
                                            />
                                            <span>
                                              <strong>
                                                {item.productCode ||
                                                  "Sin codigo"}
                                              </strong>
                                              <span className="quotation-manual-bundle-option-description">
                                                {item.productDescription ||
                                                  "Sin descripcion"}
                                              </span>
                                            </span>
                                          </label>
                                        ),
                                      )}
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
                                      activeManualBundleSelection.items.length <
                                        2
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
                                    {ITEM_TABLE_COLUMNS.map(
                                      (column, columnIndex) => (
                                        <col
                                          key={column.key}
                                          style={{
                                            width: `${itemTableColumnWidths[columnIndex]}px`,
                                            minWidth: `${itemTableColumnWidths[columnIndex]}px`,
                                          }}
                                        />
                                      ),
                                    )}
                                  </colgroup>
                                  <thead>
                                    <tr>
                                      {ITEM_TABLE_COLUMNS.map(
                                        (column, columnIndex) => (
                                          <th key={column.key}>
                                            <div
                                              className={`quotation-column-header${
                                                column.resizable
                                                  ? " is-resizable"
                                                  : ""
                                              }`}
                                            >
                                              {column.key === "selected" ? (
                                                <input
                                                  type="checkbox"
                                                  checked={allItemsSelected}
                                                  aria-label="Seleccionar todas las filas"
                                                  onChange={(event) =>
                                                    handleToggleAllCreateSectionItems(
                                                      section.localId,
                                                      visibleSectionItems.map(
                                                        ({ item }) =>
                                                          item.localId,
                                                      ),
                                                      event.target.checked,
                                                    )
                                                  }
                                                />
                                              ) : (
                                                <span>{column.label}</span>
                                              )}
                                              {column.resizable ? (
                                                <button
                                                  type="button"
                                                  className={`quotation-column-resize-handle${
                                                    activeResizeColumnIndex ===
                                                    columnIndex
                                                      ? " is-active"
                                                      : ""
                                                  }`}
                                                  aria-label={`Ajustar ancho de columna ${column.label}`}
                                                  title={`Ajustar ancho de columna ${column.label}`}
                                                  onMouseDown={(event) =>
                                                    startItemTableColumnResize(
                                                      columnIndex,
                                                      event,
                                                    )
                                                  }
                                                />
                                              ) : null}
                                            </div>
                                          </th>
                                        ),
                                      )}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {visibleSectionItems.map(
                                      (
                                        { item, itemIndex },
                                        visibleItemIndex,
                                      ) => {
                                        const effectiveItem =
                                          effectiveCreateItemsByLocalId.get(
                                            item.localId,
                                          ) || item;
                                        const totals =
                                          calculateQuotationItemDisplayTotals(
                                            effectiveItem,
                                            effectiveSectionItems,
                                          );
                                        const isSelected =
                                          selectedItemIds.includes(
                                            item.localId,
                                          );
                                        const isHighlighted =
                                          highlightedItemIds.includes(
                                            item.localId,
                                          );
                                        const isBundleComponent = Boolean(
                                          item.isBundleComponent,
                                        );
                                        const isBundleParent =
                                          item.itemType === "grupo_productos" &&
                                          !isBundleComponent;
                                        const bundleComponentCount =
                                          sectionItems.filter(
                                            (candidate) =>
                                              candidate.bundleParentLocalId ===
                                              item.localId,
                                          ).length;
                                        const isBundleCollapsed =
                                          collapsedBundleIds.has(item.localId);

                                        return (
                                          <tr
                                            key={
                                              item.localId ||
                                              `${section.localId}-item-${itemIndex}`
                                            }
                                            className={[
                                              isHighlighted
                                                ? "quotation-table-row-highlighted"
                                                : "",
                                              isSelected
                                                ? "quotation-table-row-selected"
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
                                                aria-label={`Seleccionar fila ${visibleItemIndex + 1}`}
                                                onChange={(event) =>
                                                  handleToggleCreateSectionItemSelection(
                                                    section.localId,
                                                    item.localId,
                                                    event.target.checked,
                                                  )
                                                }
                                              />
                                            </td>
                                            <td>{visibleItemIndex + 1}</td>
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
                                                        aria-expanded={
                                                          !isBundleCollapsed
                                                        }
                                                        aria-label={`${isBundleCollapsed ? "Mostrar" : "Ocultar"} componentes de ${item.productCode || item.productDescription || "bundle"}`}
                                                        title={`${isBundleCollapsed ? "Mostrar" : "Ocultar"} componentes`}
                                                        onClick={() =>
                                                          toggleBundleCollapsed(
                                                            section.localId,
                                                            item.localId,
                                                            sectionItems,
                                                          )
                                                        }
                                                      >
                                                        <BundleToggleIcon
                                                          collapsed={
                                                            isBundleCollapsed
                                                          }
                                                        />
                                                      </button>
                                                    ) : null}
                                                  </div>
                                                ) : null}
                                                <input
                                                  value={item.productCode}
                                                  readOnly
                                                  onDoubleClick={(event) => {
                                                    event.stopPropagation();
                                                    openProductPicker(
                                                      index,
                                                      itemIndex,
                                                      item.productCode,
                                                      item.providerId,
                                                    );
                                                  }}
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
                                                data-description-editor-key={`${index}-${itemIndex}`}
                                              >
                                                <input
                                                  value={
                                                    item.productDescription
                                                  }
                                                  onFocus={() =>
                                                    openDescriptionEditor(
                                                      index,
                                                      itemIndex,
                                                    )
                                                  }
                                                  onChange={(event) =>
                                                    handleUpdateCreateSectionItem(
                                                      index,
                                                      itemIndex,
                                                      "productDescription",
                                                      event.target.value,
                                                    )
                                                  }
                                                />
                                                {activeDescriptionEditor.sectionIndex ===
                                                  index &&
                                                activeDescriptionEditor.itemIndex ===
                                                  itemIndex ? (
                                                  <div className="quotation-description-editor-popover">
                                                    <textarea
                                                      rows={4}
                                                      autoFocus
                                                      value={
                                                        item.productDescription
                                                      }
                                                      onChange={(event) =>
                                                        handleUpdateCreateSectionItem(
                                                          index,
                                                          itemIndex,
                                                          "productDescription",
                                                          event.target.value,
                                                        )
                                                      }
                                                    />
                                                  </div>
                                                ) : null}
                                              </div>
                                            </td>
                                            <td>
                                              <QuantityInput
                                                value={item.quantity}
                                                onChange={(nextValue) =>
                                                  handleUpdateCreateSectionItem(
                                                    index,
                                                    itemIndex,
                                                    "quantity",
                                                    nextValue,
                                                  )
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
                                                  aria-label={`Precio Lista M.O. ${item.productCode || visibleItemIndex + 1}`}
                                                  value={
                                                    item.originalListPriceUnit
                                                  }
                                                  onChange={(nextValue) =>
                                                    handleUpdateCreateSectionItem(
                                                      index,
                                                      itemIndex,
                                                      "originalListPriceUnit",
                                                      nextValue,
                                                    )
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
                                                  item.listPriceUnit,
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
                                                    item.manufacturerDiscountPct
                                                  }
                                                  onChange={(event) =>
                                                    handleUpdateCreateSectionItem(
                                                      index,
                                                      itemIndex,
                                                      "manufacturerDiscountPct",
                                                      event.target.value,
                                                    )
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
                                                  value={item.importCostPct}
                                                  onChange={(event) =>
                                                    handleUpdateCreateSectionItem(
                                                      index,
                                                      itemIndex,
                                                      "importCostPct",
                                                      event.target.value,
                                                    )
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
                                                  totals.costUnit,
                                                )
                                              )}
                                            </td>
                                            <td>
                                              {isBundleParent ? (
                                                <span className="quotation-bundle-parent-placeholder">
                                                  --
                                                </span>
                                              ) : (
                                                formatQuotationAmount(
                                                  totals.costTotal,
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
                                                  value={item.profitMarginPct}
                                                  onChange={(event) =>
                                                    handleUpdateCreateSectionItem(
                                                      index,
                                                      itemIndex,
                                                      "profitMarginPct",
                                                      event.target.value,
                                                    )
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
                                                    summaryDistributionMode ===
                                                    "per_item"
                                                      ? effectiveItem.finalDiscountPct
                                                      : item.finalDiscountPct
                                                  }
                                                  disabled={
                                                    summaryDistributionMode ===
                                                    "per_item"
                                                  }
                                                  onChange={(event) =>
                                                    handleUpdateCreateSectionItem(
                                                      index,
                                                      itemIndex,
                                                      "finalDiscountPct",
                                                      event.target.value,
                                                    )
                                                  }
                                                />
                                              )}
                                            </td>
                                            <td>
                                              {formatQuotationAmount(
                                                totals.salePriceUnit,
                                              )}
                                            </td>
                                            <td>
                                              {formatQuotationAmount(
                                                totals.salePriceTotal,
                                              )}
                                            </td>
                                          </tr>
                                        );
                                      },
                                    )}
                                  </tbody>
                                  <tfoot>
                                    <tr>
                                      <td colSpan={11}>
                                        Totales de la seccion
                                      </td>
                                      <td>
                                        {formatQuotationAmount(
                                          sectionTotals.costTotal,
                                        )}
                                      </td>
                                      <td colSpan={3} />
                                      <td>
                                        {formatQuotationAmount(
                                          sectionTotals.salePriceTotal,
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

                <section className="account-form-section opportunity-sales-management-section quotation-summary-section">
                  <div className="quotation-proposal-section-header">
                    <div>
                      <h4>Resumen</h4>
                      <p className="field-hint">
                        Consolidado actual de costo, venta y margen de la
                        cotizacion en construccion.
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
                          {createQuotationSummary.rows.map((row) => (
                            <tr
                              key={row.key}
                              className={
                                row.key === "total"
                                  ? "quotation-summary-row-total"
                                  : ""
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
                              name="quotation-summary-discount-mode"
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
                              name="quotation-summary-discount-mode"
                              checked={summaryDiscountMode === "amount"}
                              onChange={() =>
                                handleSummaryDiscountModeChange("amount")
                              }
                            />
                            <span>Valor</span>
                          </label>
                        </div>

                        <label>Distribucion</label>
                        <div className="quotation-summary-discount-mode-group">
                          <label className="quotation-summary-discount-mode-option">
                            <input
                              type="radio"
                              name="quotation-summary-distribution-mode"
                              checked={summaryDistributionMode === "total"}
                              onChange={() =>
                                setSummaryDistributionMode("total")
                              }
                            />
                            <span>Total</span>
                          </label>
                          <label className="quotation-summary-discount-mode-option">
                            <input
                              type="radio"
                              name="quotation-summary-distribution-mode"
                              checked={summaryDistributionMode === "per_item"}
                              onChange={() =>
                                setSummaryDistributionMode("per_item")
                              }
                            />
                            <span>Por item</span>
                          </label>
                        </div>

                        <label
                          htmlFor={
                            summaryDiscountMode === "percentage"
                              ? "quotation-summary-discount-pct"
                              : "quotation-summary-discount-amount"
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
                              ? "quotation-summary-discount-pct"
                              : "quotation-summary-discount-amount"
                          }
                          type={
                            summaryDiscountMode === "percentage"
                              ? "number"
                              : "text"
                          }
                          inputMode="decimal"
                          min="0"
                          max={
                            summaryDiscountMode === "percentage"
                              ? "100"
                              : undefined
                          }
                          step="0.01"
                          value={getSummaryDiscountDisplayValue()}
                          onFocus={() => setIsSummaryDiscountInputFocused(true)}
                          onBlur={() => {
                            setIsSummaryDiscountInputFocused(false);
                            setSummaryDiscountValue((currentValue) =>
                              formatSummaryDiscountInputValue(currentValue),
                            );
                          }}
                          onChange={(event) =>
                            handleSummaryDiscountValueChange(event.target.value)
                          }
                        />
                        <p className="field-hint quotation-summary-discount-hint">
                          {summaryDiscountMode === "percentage"
                            ? "Se aplica sobre el valor total de venta de la cotizacion."
                            : "Se aplica como monto directo sobre el valor total de venta de la cotizacion."}
                        </p>
                      </div>

                      <div className="field-group quotation-summary-control-card quotation-summary-vat-field">
                        <label className="quotation-summary-group-title">
                          IVA
                        </label>
                        <div className="quotation-summary-vat-mode-group">
                          <label className="quotation-summary-discount-mode-option quotation-summary-vat-mode-option">
                            <input
                              type="radio"
                              name="quotation-summary-vat-mode"
                              checked={summaryVatMode === "without_vat"}
                              onChange={() => setSummaryVatMode("without_vat")}
                            />
                            <span>Sin IVA</span>
                          </label>
                          <label className="quotation-summary-discount-mode-option quotation-summary-vat-mode-option">
                            <input
                              type="radio"
                              name="quotation-summary-vat-mode"
                              checked={summaryVatMode === "total"}
                              onChange={() => setSummaryVatMode("total")}
                            />
                            <span>Total</span>
                          </label>
                          <label className="quotation-summary-discount-mode-option quotation-summary-vat-mode-option">
                            <input
                              type="radio"
                              name="quotation-summary-vat-mode"
                              checked={summaryVatMode === "per_item"}
                              onChange={() => setSummaryVatMode("per_item")}
                            />
                            <span>Por item</span>
                          </label>
                        </div>
                        <p className="field-hint quotation-summary-discount-hint">
                          Tasa fija del 16% aplicada sobre el precio de venta.
                        </p>
                      </div>

                      <QuotationInternalNotesField
                        id="quotation-summary-internal-notes"
                        value={internalNotes}
                        onChange={setInternalNotes}
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
                    idPrefix="quotation"
                    values={commercialConditions}
                    catalogs={catalogs}
                    onFieldChange={handleCommercialConditionChange}
                    notesRows={7}
                  />
                </section>
              </>
            ) : (
              <p className="field-hint quotation-create-step-hint">
                Selecciona cuenta, oportunidad y contacto, y luego confirma el
                contexto comercial para habilitar la propuesta, el vendedor
                precargado y las secciones iniciales.
              </p>
            )}

            <div className="modal-buttons" style={{ marginTop: 16 }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={requestCloseCreateQuotationModal}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={
                  busyAction === "create-quotation" || !canSubmitCreateQuotation
                }
              >
                Crear cotizacion
              </button>
            </div>
          </form>
        </div>
      </div>

      {productPickerState.isOpen ? (
        <div className="modal-overlay" onClick={closeProductPicker}>
          <div
            className="modal-dialog modal-dialog-account quotation-product-picker-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="quotation-product-picker-header">
              <div>
                <h3 className="modal-title">Seleccionar producto</h3>
                <p className="field-hint opportunity-modal-subtitle">
                  Elige un proveedor activo y luego selecciona un producto para
                  precargar la fila.
                </p>
              </div>
            </div>

            <div className="quotation-product-picker-filters">
              <div className="field-group quotation-product-picker-provider">
                <label>Proveedor</label>
                <select
                  value={productPickerState.providerId}
                  onChange={(event) =>
                    setProductPickerState((prev) => ({
                      ...prev,
                      providerId: event.target.value,
                    }))
                  }
                >
                  <option value="">Selecciona proveedor</option>
                  {catalogs.providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field-group quotation-product-picker-search">
                <label>Buscar producto</label>
                <input
                  autoFocus
                  disabled={!productPickerState.providerId}
                  placeholder={
                    productPickerState.providerId
                      ? "Codigo, descripcion o lista de precios"
                      : "Selecciona primero un proveedor"
                  }
                  value={productPickerState.query}
                  onChange={(event) =>
                    setProductPickerState((prev) => ({
                      ...prev,
                      query: event.target.value,
                    }))
                  }
                />
              </div>
            </div>

            {productPickerState.error ? (
              <p className="field-hint quotation-product-picker-error">
                {productPickerState.error}
              </p>
            ) : null}

            <div className="quotation-product-picker-results">
              <table className="quotation-product-picker-table">
                <thead>
                  <tr>
                    <th>Codigo</th>
                    <th>Descripcion</th>
                    <th>Fabricante</th>
                    <th>Precio</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {!productPickerState.providerId ? (
                    <tr>
                      <td colSpan={5} className="empty-state">
                        Selecciona un proveedor activo para ver sus productos.
                      </td>
                    </tr>
                  ) : productPickerState.loading ? (
                    <tr>
                      <td colSpan={5} className="empty-state">
                        Cargando productos...
                      </td>
                    </tr>
                  ) : productPickerState.results.length ? (
                    productPickerState.results.map((product) => (
                      <tr key={product.id}>
                        <td>{product.code}</td>
                        <td>{product.description}</td>
                        <td>{product.providerName}</td>
                        <td>
                          {product.currencySymbol || "$"}
                          {formatQuotationAmount(product.price)}
                        </td>
                        <td>
                          <QuotationIconButton
                            title="Seleccionar producto"
                            onClick={() => handleSelectProduct(product)}
                          >
                            <CheckIcon />
                          </QuotationIconButton>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="empty-state">
                        No hay productos activos en la lista activa del
                        proveedor que coincidan con la busqueda.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="modal-buttons">
              <button
                type="button"
                className="btn-secondary"
                onClick={closeProductPicker}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default QuotationCreateModal;
