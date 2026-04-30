import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, getApiErrorMessage } from "../api";
import { quotationPrintTemplateData } from "./quotationPrintTemplateData";
import {
  buildQuotationItemPricing,
  buildItemDraft,
  buildCreateQuotationForm,
  buildItemDrafts,
  buildItemEdits,
  buildSectionDraft,
  buildSectionEdits,
  buildVersionForm,
  compareValues,
  DEFAULT_QUOTATION_VAT_PCT,
  formatQuotationDate,
  getQuotationActivationBucket,
  getQuotationWorkflowTone,
  normalizeQuotationDateInput,
  normalizeText,
  syncQuotationItemDraftPricing,
  syncQuotationItemEditsPricing,
  toNumber,
} from "./quotationsUtils";
import { setQuotationNavigationGuard } from "./quotationNavigationGuard";

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
    const startIndex = index;
    const rootLocalId = getBundleRootLocalId(list[index]);
    const items = [list[index]];

    index += 1;
    while (
      index < list.length &&
      getBundleRootLocalId(list[index]) === rootLocalId
    ) {
      items.push(list[index]);
      index += 1;
    }

    blocks.push({
      startIndex,
      items,
      selected: items.some((item) => selectedIdSet.has(item?.localId)),
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

function normalizeQuotationPdfPayload(printModel) {
  if (!printModel || typeof printModel !== "object") {
    return null;
  }

  const { company: _ignoredCompany, ...payload } = printModel;

  return {
    ...payload,
    sections: Array.isArray(payload.sections)
      ? payload.sections.map((section) => ({
          ...section,
          subtotal: toNumber(section?.subtotal),
          rows: Array.isArray(section?.rows)
            ? section.rows.map((row) => ({
                ...row,
                displayOrder:
                  row?.displayOrder == null ? null : Number(row.displayOrder),
                quantity: row?.quantity == null ? null : toNumber(row.quantity),
                salePriceUnit:
                  row?.salePriceUnit == null
                    ? null
                    : toNumber(row.salePriceUnit),
                salePriceTotal:
                  row?.salePriceTotal == null
                    ? null
                    : toNumber(row.salePriceTotal),
              }))
            : [],
        }))
      : [],
    summary: payload.summary
      ? {
          ...payload.summary,
          subtotal: toNumber(payload.summary.subtotal),
          discount: toNumber(payload.summary.discount),
          discountedSubtotal: toNumber(payload.summary.discountedSubtotal),
          vatAmount: toNumber(payload.summary.vatAmount),
          total: toNumber(payload.summary.total),
        }
      : payload.summary,
  };
}

function getBundleRootLocalId(item) {
  return item?.bundleParentLocalId || item?.localId || null;
}

function expandBundleSelection(items, selectedIds) {
  if (!Array.isArray(items) || !selectedIds.length) {
    return selectedIds;
  }

  const selectedIdSet = new Set(selectedIds);
  const bundleRootIds = new Set();

  items.forEach((item) => {
    if (!selectedIdSet.has(item?.localId)) {
      return;
    }

    bundleRootIds.add(getBundleRootLocalId(item));
  });

  if (!bundleRootIds.size) {
    return selectedIds;
  }

  return items
    .filter((item) => {
      const bundleRootId = getBundleRootLocalId(item);
      return selectedIdSet.has(item.localId) || bundleRootIds.has(bundleRootId);
    })
    .map((item) => item.localId);
}

function cloneCreateSectionItems(items, buildLocalId) {
  const localIdMap = new Map(
    items.map((item) => [item.localId, buildLocalId()]),
  );

  return items.map((item) => ({
    ...item,
    localId: localIdMap.get(item.localId),
    bundleParentLocalId: item.bundleParentLocalId
      ? localIdMap.get(item.bundleParentLocalId) || item.bundleParentLocalId
      : null,
  }));
}

function buildEditablePersistedSectionItems(section, itemEdits) {
  return [...(section?.items || [])]
    .map((item, index) => {
      const itemDraftValue = itemEdits[String(item.id)] || {};

      return {
        ...item,
        ...itemDraftValue,
        localId: String(item.id),
        bundleParentLocalId: item.bundleParentItemId
          ? String(item.bundleParentItemId)
          : null,
        isBundleComponent: Boolean(item.bundleParentItemId),
        displayOrder:
          Number(itemDraftValue.displayOrder) ||
          Number(item.displayOrder) ||
          index + 1,
      };
    })
    .sort((leftItem, rightItem) => {
      const leftOrder = Number(leftItem.displayOrder || 0);
      const rightOrder = Number(rightItem.displayOrder || 0);
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      return Number(leftItem.id) - Number(rightItem.id);
    });
}

function isEditableCreateBundleOriginType(originType) {
  return originType === "manual_bundle" || originType === "price_list_bundle";
}

function normalizeCreateBundleParentAsManual(item) {
  return {
    ...item,
    quantity: "1",
    originalListPriceUnit: "0",
    listPriceUnit: "0",
    manufacturerDiscountPct: "0",
    importCostPct: "0",
    profitMarginPct: "0",
    finalDiscountPct: "0",
    itemType: "grupo_productos",
    bundleParentLocalId: null,
    bundleOriginType: "manual_bundle",
    sourceProviderPriceListItemId: null,
    sourceComponentPriceListItemId: null,
    bundleComponentItemId: null,
    isBundleComponent: false,
  };
}

function normalizeCreateBundleComponentAsManual(item, parentLocalId) {
  return {
    ...item,
    bundleParentLocalId: parentLocalId,
    bundleOriginType: "manual_bundle",
    sourceProviderPriceListItemId: null,
    sourceComponentPriceListItemId: null,
    bundleComponentItemId: null,
    isBundleComponent: true,
  };
}

function getCreateManualBundleSelection(items, selectedIds) {
  const selectedIdSet = new Set(selectedIds || []);
  const selectedItems = (items || []).filter((item) =>
    selectedIdSet.has(item?.localId),
  );

  if (selectedItems.length < 2) {
    return {
      ok: false,
      message: "Selecciona al menos dos filas para crear un bundle manual.",
      items: [],
    };
  }

  const hasNestedOrExistingBundleItems = selectedItems.some((item) => {
    const hasChildren = (items || []).some(
      (candidate) => candidate?.bundleParentLocalId === item?.localId,
    );

    return (
      Boolean(item?.bundleParentLocalId) ||
      Boolean(item?.isBundleComponent) ||
      item?.itemType === "grupo_productos" ||
      hasChildren
    );
  });

  if (hasNestedOrExistingBundleItems) {
    return {
      ok: false,
      message:
        "Solo puedes agrupar filas independientes. No se permiten bundles existentes ni componentes dentro de otro bundle.",
      items: [],
    };
  }

  return {
    ok: true,
    message: "",
    items: selectedItems,
  };
}

function getAttachToCreateManualBundleSelection(items, selectedIds) {
  const selectedIdSet = new Set(selectedIds || []);
  const selectedItems = (items || []).filter((item) =>
    selectedIdSet.has(item?.localId),
  );

  if (selectedItems.length < 2) {
    return {
      ok: false,
      message:
        "Selecciona un bundle manual y al menos una fila independiente para agregar componentes.",
      parentItem: null,
      items: [],
    };
  }

  const parentItems = selectedItems.filter(
    (item) =>
      item?.itemType === "grupo_productos" &&
      !item?.bundleParentLocalId &&
      isEditableCreateBundleOriginType(getCreateBundleOriginType(item)),
  );

  if (parentItems.length !== 1) {
    return {
      ok: false,
      message:
        "Selecciona exactamente un bundle existente y una o mas filas independientes.",
      parentItem: null,
      items: [],
    };
  }

  const parentItem = parentItems[0];
  const componentItems = selectedItems.filter(
    (item) => item?.localId !== parentItem.localId,
  );

  if (!componentItems.length) {
    return {
      ok: false,
      message:
        "Selecciona al menos una fila independiente adicional para agregarla al bundle.",
      parentItem,
      items: [],
    };
  }

  const hasInvalidComponentItems = componentItems.some((item) => {
    const hasChildren = (items || []).some(
      (candidate) => candidate?.bundleParentLocalId === item?.localId,
    );

    return (
      Boolean(item?.bundleParentLocalId) ||
      Boolean(item?.isBundleComponent) ||
      item?.itemType === "grupo_productos" ||
      hasChildren
    );
  });

  if (hasInvalidComponentItems) {
    return {
      ok: false,
      message:
        "Solo puedes agregar filas independientes. No se permiten otros bundles ni componentes ya agrupados.",
      parentItem,
      items: [],
    };
  }

  return {
    ok: true,
    message: "",
    parentItem,
    items: componentItems,
  };
}

function getDetachFromCreateManualBundleSelection(items, selectedIds) {
  const selectedIdSet = new Set(selectedIds || []);
  const selectedItems = (items || []).filter((item) =>
    selectedIdSet.has(item?.localId),
  );

  if (!selectedItems.length) {
    return {
      ok: false,
      message:
        "Selecciona uno o mas componentes de un bundle manual para quitarlos del grupo.",
      parentItem: null,
      items: [],
    };
  }

  const parentLocalIds = [
    ...new Set(
      selectedItems.map((item) => item?.bundleParentLocalId).filter(Boolean),
    ),
  ];

  if (parentLocalIds.length !== 1) {
    return {
      ok: false,
      message: "Selecciona componentes que pertenezcan al mismo bundle manual.",
      parentItem: null,
      items: [],
    };
  }

  const parentItem = (items || []).find(
    (item) => item?.localId === parentLocalIds[0],
  );

  if (
    !parentItem ||
    parentItem?.itemType !== "grupo_productos" ||
    !isEditableCreateBundleOriginType(getCreateBundleOriginType(parentItem))
  ) {
    return {
      ok: false,
      message:
        "Solo puedes quitar componentes de bundles editables dentro de la tabla.",
      parentItem: null,
      items: [],
    };
  }

  const hasInvalidItems = selectedItems.some(
    (item) =>
      item?.bundleParentLocalId !== parentItem.localId ||
      !item?.isBundleComponent ||
      !isEditableCreateBundleOriginType(getCreateBundleOriginType(item)),
  );

  if (hasInvalidItems) {
    return {
      ok: false,
      message:
        "Selecciona solo componentes del mismo bundle para quitarlos del grupo.",
      parentItem,
      items: [],
    };
  }

  const siblingItems = (items || []).filter(
    (item) => item?.bundleParentLocalId === parentItem.localId,
  );

  if (selectedItems.length >= siblingItems.length) {
    return {
      ok: false,
      message: "Debe quedar al menos un componente dentro del bundle manual.",
      parentItem,
      items: [],
    };
  }

  return {
    ok: true,
    message: "",
    parentItem,
    items: selectedItems,
  };
}

function getCreateBundleOriginType(item) {
  if (item?.bundleOriginType) {
    return item.bundleOriginType;
  }

  if (
    item?.itemType === "grupo_productos" &&
    item?.sourceProviderPriceListItemId
  ) {
    return "price_list_bundle";
  }

  if (item?.bundleParentLocalId && item?.sourceComponentPriceListItemId) {
    return "price_list_bundle";
  }

  return null;
}

function buildCreateQuotationSectionItemPayload(item, itemIndex) {
  const pricing = buildQuotationItemPricing(item, {
    currencyCode: item?.quotationCurrencyCode,
    exchangeRate: item?.quotationExchangeRate,
  });

  return {
    clientItemId: String(item?.localId || `draft-item-${itemIndex + 1}`),
    providerId: Number(item?.providerId),
    productCode: item?.productCode || "",
    productDescription: item?.productDescription || "",
    quantity: toNumber(item?.quantity),
    originalCurrencyCode: pricing.originalCurrencyCode,
    originalListPriceUnit: pricing.originalListPriceUnit,
    listPriceUnit: pricing.listPriceUnit,
    manufacturerDiscountPct: toNumber(item?.manufacturerDiscountPct),
    importCostPct: toNumber(item?.importCostPct),
    profitMarginPct: toNumber(item?.profitMarginPct),
    finalDiscountPct: toNumber(item?.finalDiscountPct),
    itemType: item?.itemType || "producto",
    bundleParentClientItemId: item?.bundleParentLocalId || null,
    bundleOriginType: getCreateBundleOriginType(item),
    sourceProviderPriceListItemId:
      item?.sourceProviderPriceListItemId && !item?.bundleParentLocalId
        ? Number(item.sourceProviderPriceListItemId)
        : null,
    sourceComponentPriceListItemId: item?.sourceComponentPriceListItemId
      ? Number(item.sourceComponentPriceListItemId)
      : null,
    displayOrder: itemIndex + 1,
  };
}

function toPositiveIntegerOrNull(value) {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0
    ? numericValue
    : null;
}

function resolvePositiveDisplayOrder(value, fallbackDisplayOrder) {
  const explicitDisplayOrder = toPositiveIntegerOrNull(value);
  if (explicitDisplayOrder) {
    return explicitDisplayOrder;
  }

  return toPositiveIntegerOrNull(fallbackDisplayOrder) || 1;
}

function resolveBundleComponentUnitPrice(component) {
  const overrideValue = component?.unitPriceOverride;
  const numericOverrideValue = Number(overrideValue);
  const numericSourcePrice = Number(component?.price ?? 0);

  if (
    Number.isFinite(numericOverrideValue) &&
    numericOverrideValue === 0 &&
    numericSourcePrice > 0
  ) {
    return numericSourcePrice;
  }

  if (
    overrideValue !== null &&
    overrideValue !== undefined &&
    String(overrideValue).trim() !== ""
  ) {
    return overrideValue;
  }

  return component?.price ?? 0;
}

function buildPersistedQuotationItemPayload(
  item,
  fallbackDisplayOrder = 1,
  pricingContext = {},
) {
  const pricing = buildQuotationItemPricing(item, pricingContext);

  return {
    providerId: Number(item?.providerId),
    productCode: item?.productCode || "",
    productDescription: item?.productDescription || "",
    quantity: toNumber(item?.quantity),
    originalCurrencyCode: pricing.originalCurrencyCode,
    originalListPriceUnit: pricing.originalListPriceUnit,
    listPriceUnit: pricing.listPriceUnit,
    manufacturerDiscountPct: toNumber(item?.manufacturerDiscountPct),
    importCostPct: toNumber(item?.importCostPct),
    profitMarginPct: toNumber(item?.profitMarginPct),
    finalDiscountPct: toNumber(item?.finalDiscountPct),
    itemType: item?.itemType || "producto",
    bundleParentItemId: toPositiveIntegerOrNull(item?.bundleParentItemId),
    bundleOriginType: item?.bundleOriginType || null,
    sourceProviderPriceListItemId: toPositiveIntegerOrNull(
      item?.sourceProviderPriceListItemId,
    ),
    sourceComponentPriceListItemId: toPositiveIntegerOrNull(
      item?.sourceComponentPriceListItemId,
    ),
    bundleSortOrder: toPositiveIntegerOrNull(item?.bundleSortOrder),
    displayOrder: resolvePositiveDisplayOrder(
      item?.displayOrder,
      fallbackDisplayOrder,
    ),
  };
}

function buildPersistedQuotationVersionPayload({
  selectedVersion,
  versionForm,
  sectionEdits,
  itemEdits,
  inclusionTypes,
}) {
  const fallbackInclusionTypeId = inclusionTypes[0]?.id
    ? String(inclusionTypes[0].id)
    : "";

  return {
    contactId: Number(versionForm.contactId),
    proposalName: versionForm.proposalName,
    quotationDate: normalizeQuotationDateInput(versionForm.quotationDate),
    introduction: versionForm.introduction,
    activationStatusCode: versionForm.activationStatusCode,
    summaryDiscountMode: versionForm.summaryDiscountMode || null,
    summaryDiscountValue: Number(versionForm.summaryDiscountValue) || 0,
    summaryDistributionMode: versionForm.summaryDistributionMode || null,
    summaryVatMode: versionForm.summaryVatMode || null,
    summaryVatPct:
      versionForm.summaryVatMode === "without_vat"
        ? 0
        : DEFAULT_QUOTATION_VAT_PCT,
    internalNotes: versionForm.internalNotes || "",
    deliveryTime: versionForm.deliveryTime || null,
    quotationValidity: versionForm.quotationValidity || null,
    warranty: versionForm.warranty || null,
    paymentTerms: versionForm.paymentTerms || null,
    currencyCode: versionForm.currencyCode || null,
    exchangeRate:
      versionForm.exchangeRate == null || versionForm.exchangeRate === ""
        ? null
        : Number(versionForm.exchangeRate),
    quotationNotes: versionForm.quotationNotes || "",
    sections: (selectedVersion?.sections || []).map((section, sectionIndex) => {
      const sectionDraft = sectionEdits[String(section.id)] || {
        title: section.title || "",
        inclusionTypeId: String(
          section.inclusionTypeId || fallbackInclusionTypeId || "",
        ),
      };
      const sectionItems = buildEditablePersistedSectionItems(
        section,
        itemEdits,
      );

      return {
        ...(Number(section.id) > 0 ? { id: Number(section.id) } : {}),
        localId: String(section.id),
        title: sectionDraft.title,
        inclusionTypeId: Number(
          sectionDraft.inclusionTypeId || fallbackInclusionTypeId || 0,
        ),
        displayOrder: resolvePositiveDisplayOrder(
          section.displayOrder,
          sectionIndex + 1,
        ),
        items: sectionItems.map((item, itemIndex) => ({
          ...(Number(item.id) > 0 ? { id: Number(item.id) } : {}),
          localId: String(item.localId || item.id),
          ...buildPersistedQuotationItemPayload(item, itemIndex + 1, {
            currencyCode: versionForm.currencyCode,
            exchangeRate: versionForm.exchangeRate,
          }),
          bundleParentLocalId: item.bundleParentLocalId || null,
        })),
      };
    }),
  };
}

function buildPersistedQuotationVersionSnapshot({
  selectedVersion,
  versionForm,
  sectionEdits,
  itemEdits,
  inclusionTypes,
}) {
  if (!selectedVersion) {
    return "";
  }

  return JSON.stringify(
    buildPersistedQuotationVersionPayload({
      selectedVersion,
      versionForm,
      sectionEdits,
      itemEdits,
      inclusionTypes,
    }),
  );
}

function validatePersistedQuotationVersionPayload(payload) {
  if (!Number.isInteger(payload?.contactId) || payload.contactId <= 0) {
    return "Selecciona un contacto valido antes de guardar la version.";
  }

  for (const [sectionIndex, section] of (payload?.sections || []).entries()) {
    if (
      !Number.isInteger(section?.inclusionTypeId) ||
      section.inclusionTypeId <= 0
    ) {
      return `La seccion ${sectionIndex + 1} debe tener una inclusion valida.`;
    }

    for (const [itemIndex, item] of (section.items || []).entries()) {
      if (!Number.isInteger(item?.providerId) || item.providerId <= 0) {
        return `La fila ${itemIndex + 1} de la seccion ${sectionIndex + 1} debe tener un proveedor valido.`;
      }

      if (!String(item?.productCode || "").trim()) {
        return `La fila ${itemIndex + 1} de la seccion ${sectionIndex + 1} debe tener un codigo de producto.`;
      }

      if (!String(item?.productDescription || "").trim()) {
        return `La fila ${itemIndex + 1} de la seccion ${sectionIndex + 1} debe tener una descripcion.`;
      }

      if (!(Number(item?.quantity) > 0)) {
        return `La fila ${itemIndex + 1} de la seccion ${sectionIndex + 1} debe tener una cantidad mayor a cero.`;
      }
    }
  }

  return "";
}

function buildLocalEditableItemRecord(item, providers, displayOrder) {
  const providerId = Number(item?.providerId || 0);
  const providerName =
    providers.find((provider) => Number(provider.id) === providerId)?.name ||
    item?.providerName ||
    "";
  const itemId = Number(item?.id || 0);
  const bundleParentLocalId = item?.bundleParentLocalId
    ? String(item.bundleParentLocalId)
    : item?.bundleParentItemId
      ? String(item.bundleParentItemId)
      : null;

  return {
    id: itemId,
    providerId,
    providerName,
    productCode: item?.productCode || "",
    productDescription: item?.productDescription || "",
    itemType: item?.itemType || "producto",
    bundleParentItemId: bundleParentLocalId
      ? Number(bundleParentLocalId)
      : null,
    bundleOriginType: item?.bundleOriginType || null,
    sourceProviderPriceListItemId: item?.sourceProviderPriceListItemId
      ? Number(item.sourceProviderPriceListItemId)
      : null,
    sourceComponentPriceListItemId: item?.sourceComponentPriceListItemId
      ? Number(item.sourceComponentPriceListItemId)
      : null,
    quantity: toNumber(item?.quantity),
    originalCurrencyCode: item?.originalCurrencyCode || "USD",
    originalListPriceUnit: toNumber(
      item?.originalListPriceUnit ?? item?.listPriceUnit,
    ),
    listPriceUnit: toNumber(item?.listPriceUnit),
    manufacturerDiscountPct: toNumber(item?.manufacturerDiscountPct),
    importCostPct: toNumber(item?.importCostPct),
    profitMarginPct: toNumber(item?.profitMarginPct),
    finalDiscountPct: toNumber(item?.finalDiscountPct),
    displayOrder: Number(displayOrder),
    bundleSortOrder: item?.bundleSortOrder
      ? Number(item.bundleSortOrder)
      : null,
  };
}

function buildLocalEditableItemDraft(item, displayOrder) {
  const itemId = Number(item?.id || 0);
  const bundleParentLocalId = item?.bundleParentLocalId
    ? String(item.bundleParentLocalId)
    : item?.bundleParentItemId
      ? String(item.bundleParentItemId)
      : null;

  return {
    id: itemId,
    localId: String(itemId),
    providerId: String(item?.providerId || ""),
    productCode: item?.productCode || "",
    productDescription: item?.productDescription || "",
    quantity: String(item?.quantity ?? 0),
    originalCurrencyCode: item?.originalCurrencyCode || "USD",
    originalListPriceUnit: String(
      item?.originalListPriceUnit ?? item?.listPriceUnit ?? 0,
    ),
    listPriceUnit: String(item?.listPriceUnit ?? 0),
    manufacturerDiscountPct: String(item?.manufacturerDiscountPct ?? 0),
    importCostPct: String(item?.importCostPct ?? 0),
    profitMarginPct: String(item?.profitMarginPct ?? 0),
    finalDiscountPct: String(item?.finalDiscountPct ?? 0),
    itemType: item?.itemType || "producto",
    bundleParentItemId: bundleParentLocalId
      ? Number(bundleParentLocalId)
      : null,
    bundleParentLocalId,
    bundleOriginType: item?.bundleOriginType || null,
    sourceProviderPriceListItemId: item?.sourceProviderPriceListItemId
      ? Number(item.sourceProviderPriceListItemId)
      : null,
    sourceComponentPriceListItemId: item?.sourceComponentPriceListItemId
      ? Number(item.sourceComponentPriceListItemId)
      : null,
    bundleSortOrder: item?.bundleSortOrder
      ? Number(item.bundleSortOrder)
      : null,
    displayOrder: Number(displayOrder),
    isBundleComponent: Boolean(bundleParentLocalId),
  };
}

export function useQuotationsSection({
  accounts,
  accountId,
  accountName,
  loadingAccounts,
  opportunities,
  opportunityId,
  opportunityName,
  opportunityActivationStatus,
  sellerUserId,
  sellerUserName,
  contactOptions,
  currentUser,
  onOpportunityFocusChange,
  isOpen,
  showDetails,
}) {
  const quotationsListEndpoint = showDetails
    ? opportunityId
      ? `/api/opportunities/${opportunityId}/quotations`
      : null
    : "/api/quotations";

  const [quotations, setQuotations] = useState([]);
  const [catalogs, setCatalogs] = useState({
    inclusionTypes: [],
    deliveryTimes: [],
    validityTerms: [],
    warrantyTerms: [],
    paymentTerms: [],
    currencies: [],
    providers: [],
    activationStatuses: [],
  });
  const [companyBranding, setCompanyBranding] = useState(
    quotationPrintTemplateData.company,
  );
  const [selectedQuotationId, setSelectedQuotationId] = useState(null);
  const [selectedVersionId, setSelectedVersionId] = useState(null);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [createQuotationForm, setCreateQuotationForm] = useState(
    buildCreateQuotationForm({
      accountId,
      contactOptions,
      opportunityId,
      opportunityName,
      sellerUserId,
      sellerUserName,
    }),
  );
  const [createSectionDraft, setCreateSectionDraft] = useState(
    buildSectionDraft([]),
  );
  const [createSectionDrafts, setCreateSectionDrafts] = useState([]);
  const [createItemDraftsBySection, setCreateItemDraftsBySection] = useState(
    {},
  );
  const [createSelectedItemIdsBySection, setCreateSelectedItemIdsBySection] =
    useState({});
  const [
    createHighlightedItemIdsBySection,
    setCreateHighlightedItemIdsBySection,
  ] = useState({});
  const [createCopiedItems, setCreateCopiedItems] = useState([]);
  const [editCopiedItems, setEditCopiedItems] = useState([]);
  const [versionForm, setVersionForm] = useState(buildVersionForm(null));
  const [sectionDraft, setSectionDraft] = useState(buildSectionDraft([]));
  const [sectionEdits, setSectionEdits] = useState({});
  const [itemEdits, setItemEdits] = useState({});
  const [itemDraftsBySection, setItemDraftsBySection] = useState({});
  const [showCreateQuotationForm, setShowCreateQuotationForm] = useState(false);
  const [
    createCommercialContextConfirmed,
    setCreateCommercialContextConfirmed,
  ] = useState(false);
  const [createSelectedAccountId, setCreateSelectedAccountId] = useState(
    accountId ? String(accountId) : "",
  );
  const [createOpportunities, setCreateOpportunities] = useState(
    opportunities || [],
  );
  const [createSelectedOpportunityId, setCreateSelectedOpportunityId] =
    useState(opportunityId ? String(opportunityId) : "");
  const [createContactOptions, setCreateContactOptions] = useState(
    contactOptions || [],
  );
  const quotationVersionPricingContext = useMemo(
    () => ({
      currencyCode: versionForm.currencyCode,
      exchangeRate: versionForm.exchangeRate,
    }),
    [versionForm.currencyCode, versionForm.exchangeRate],
  );
  const setSyncedItemEdits = useCallback(
    (valueOrUpdater) => {
      setItemEdits((prev) => {
        const nextItemEdits =
          typeof valueOrUpdater === "function"
            ? valueOrUpdater(prev)
            : valueOrUpdater;

        return syncQuotationItemEditsPricing(
          nextItemEdits,
          quotationVersionPricingContext,
        );
      });
    },
    [quotationVersionPricingContext],
  );
  const [loadingCreateOpportunities, setLoadingCreateOpportunities] =
    useState(false);
  const [loadingCreateContacts, setLoadingCreateContacts] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [quotationVersionsByQuotationId, setQuotationVersionsByQuotationId] =
    useState({});
  const [
    selectedQuotationEditVersionIdByQuotationId,
    setSelectedQuotationEditVersionIdByQuotationId,
  ] = useState({});
  const [
    loadingQuotationVersionsByQuotationId,
    setLoadingQuotationVersionsByQuotationId,
  ] = useState({});
  const [openQuotationMenuId, setOpenQuotationMenuId] = useState(null);
  const [showEditQuotationModal, setShowEditQuotationModal] = useState(false);
  const [quotationStatusFilter, setQuotationStatusFilter] = useState("all");
  const [quotationQuery, setQuotationQuery] = useState("");
  const [quotationSort, setQuotationSort] = useState({
    field: "id",
    direction: "desc",
  });
  const [quotationsPerPage, setQuotationsPerPageState] = useState(10);
  const [quotationsPage, setQuotationsPage] = useState(1);
  const selectedQuotationIdRef = useRef(selectedQuotationId);
  const loadVersionRef = useRef(null);
  const initialEditSnapshotRef = useRef("");
  const createSectionDraftSequenceRef = useRef(1);
  const createItemDraftSequenceRef = useRef(1);
  const editSectionDraftSequenceRef = useRef(1);

  useEffect(() => {
    let cancelled = false;

    async function loadDocumentBranding() {
      try {
        const response = await api.get("/api/settings/document-branding");
        if (cancelled) return;
        if (response.data?.company) {
          setCompanyBranding(response.data.company);
        }
      } catch {
        if (!cancelled) {
          setCompanyBranding(quotationPrintTemplateData.company);
        }
      }
    }

    void loadDocumentBranding();

    return () => {
      cancelled = true;
    };
  }, []);
  const editItemDraftSequenceRef = useRef(1);

  useEffect(() => {
    setItemEdits((prev) =>
      syncQuotationItemEditsPricing(prev, quotationVersionPricingContext),
    );
  }, [quotationVersionPricingContext]);

  const normalizeQuotationListRecords = useCallback((records) => {
    if (!Array.isArray(records)) return [];

    return records.map((quotation) => ({
      ...quotation,
      id: Number(quotation.id),
      opportunityId: Number(
        quotation.opportunityId ?? quotation.opportunity_id ?? 0,
      ),
      accountId: Number(quotation.accountId ?? quotation.account_id ?? 0),
      accountName: quotation.accountName ?? quotation.account_name ?? null,
      opportunityName:
        quotation.opportunityName ??
        quotation.opportunity_name ??
        quotation.latestProposalName ??
        quotation.latest_proposal_name ??
        null,
      opportunitySalesStageName:
        quotation.opportunitySalesStageName ??
        quotation.opportunity_sales_stage_name ??
        quotation.salesStageName ??
        quotation.sales_stage ??
        null,
      opportunityAmountUsd:
        quotation.opportunityAmountUsd ??
        quotation.opportunity_amount_usd ??
        quotation.amountUsd ??
        quotation.amount_usd ??
        null,
      latestTotalSaleAmount:
        quotation.latestTotalSaleAmount ??
        quotation.latest_total_sale_amount ??
        quotation.latestAmountUsd ??
        quotation.latest_amount_usd ??
        null,
      opportunityCloseDate:
        quotation.opportunityCloseDate ??
        quotation.opportunity_close_date ??
        quotation.closeDate ??
        quotation.close_date ??
        null,
      sellerUserId: quotation.sellerUserId
        ? Number(quotation.sellerUserId)
        : quotation.seller_user_id
          ? Number(quotation.seller_user_id)
          : null,
      sellerUserName:
        quotation.sellerUserName ?? quotation.seller_user_name ?? null,
      sellerUserEmail:
        quotation.sellerUserEmail ?? quotation.seller_user_email ?? "",
      sellerUserPhone:
        quotation.sellerUserPhone ?? quotation.seller_user_phone ?? "",
      latestVersionId: Number(
        quotation.latestVersionId ?? quotation.latest_version_id ?? 0,
      ),
      latestVersionNumber:
        quotation.latestVersionNumber ??
        quotation.latest_version_number ??
        null,
      latestStatusCode:
        quotation.latestStatusCode ?? quotation.latest_status_code ?? null,
      latestStatusName:
        quotation.latestStatusName ?? quotation.latest_status_name ?? null,
      latestStatusUiKey:
        quotation.latestStatusUiKey ?? quotation.latest_status_ui_key ?? null,
      latestProposalName:
        quotation.latestProposalName ?? quotation.latest_proposal_name ?? null,
      latestQuotationDate:
        quotation.latestQuotationDate ??
        quotation.latest_quotation_date ??
        null,
      activationStatusId: Number(
        quotation.activationStatusId ?? quotation.activation_status_id ?? 0,
      ),
      activationStatusCode:
        quotation.activationStatusCode ??
        quotation.activation_status_code ??
        null,
      activationStatusName:
        quotation.activationStatusName ??
        quotation.activation_status_name ??
        null,
      createdAt: quotation.createdAt ?? quotation.created_at ?? null,
      updatedAt: quotation.updatedAt ?? quotation.updated_at ?? null,
    }));
  }, []);

  const normalizeQuotationVersionSummaryRecords = useCallback(
    (quotationDetail) => {
      if (!Array.isArray(quotationDetail?.versions)) {
        return [];
      }

      const latestVersionId = Number(quotationDetail.latestVersionId || 0);

      return quotationDetail.versions
        .map((version) => ({
          id: Number(version.id),
          versionNumber: Number(
            version.versionNumber ?? version.version_number ?? 0,
          ),
          quotationDate:
            version.quotationDate ?? version.quotation_date ?? null,
          statusCode: version.statusCode ?? version.status_code ?? "",
          statusName: version.statusName ?? version.status_name ?? "",
          statusUiKey: version.statusUiKey ?? version.status_ui_key ?? null,
          isLatestVersion: Number(version.id) === latestVersionId,
        }))
        .sort((leftVersion, rightVersion) => {
          if (leftVersion.versionNumber !== rightVersion.versionNumber) {
            return rightVersion.versionNumber - leftVersion.versionNumber;
          }

          return rightVersion.id - leftVersion.id;
        });
    },
    [],
  );

  const getSelectedQuotationEditVersionId = useCallback(
    (quotation) => {
      const quotationId = String(quotation?.id || "");
      const selectedVersionId = Number(
        selectedQuotationEditVersionIdByQuotationId[quotationId] || 0,
      );

      if (selectedVersionId) {
        return selectedVersionId;
      }

      const availableVersions =
        quotationVersionsByQuotationId[quotationId] || [];
      const latestVersionId = Number(quotation?.latestVersionId || 0);

      if (
        latestVersionId &&
        availableVersions.some(
          (version) => Number(version.id) === latestVersionId,
        )
      ) {
        return latestVersionId;
      }

      return Number(availableVersions[0]?.id || latestVersionId || 0) || null;
    },
    [
      quotationVersionsByQuotationId,
      selectedQuotationEditVersionIdByQuotationId,
    ],
  );

  const loadQuotationVersions = useCallback(
    async (quotation) => {
      const quotationId = Number(quotation?.id || quotation || 0);
      if (!quotationId) {
        return [];
      }

      const cacheKey = String(quotationId);
      const cachedVersions = quotationVersionsByQuotationId[cacheKey];
      if (Array.isArray(cachedVersions) && cachedVersions.length > 0) {
        return cachedVersions;
      }

      if (loadingQuotationVersionsByQuotationId[cacheKey]) {
        return [];
      }

      setLoadingQuotationVersionsByQuotationId((prev) => ({
        ...prev,
        [cacheKey]: true,
      }));

      try {
        const { data } = await api.get(`/api/quotations/${quotationId}`);
        const nextVersions = normalizeQuotationVersionSummaryRecords(data);

        setQuotationVersionsByQuotationId((prev) => ({
          ...prev,
          [cacheKey]: nextVersions,
        }));

        setSelectedQuotationEditVersionIdByQuotationId((prev) => {
          const currentVersionId = Number(prev[cacheKey] || 0);
          if (
            currentVersionId &&
            nextVersions.some(
              (version) => Number(version.id) === currentVersionId,
            )
          ) {
            return prev;
          }

          const fallbackVersionId = Number(
            nextVersions.find((version) => version.isLatestVersion)?.id ||
              data?.latestVersionId ||
              quotation?.latestVersionId ||
              nextVersions[0]?.id ||
              0,
          );

          if (!fallbackVersionId) {
            return prev;
          }

          return {
            ...prev,
            [cacheKey]: fallbackVersionId,
          };
        });

        return nextVersions;
      } catch (err) {
        setError(
          getApiErrorMessage(
            err,
            "No fue posible cargar las versiones de la cotizacion",
          ),
        );
        return [];
      } finally {
        setLoadingQuotationVersionsByQuotationId((prev) => ({
          ...prev,
          [cacheKey]: false,
        }));
      }
    },
    [
      loadingQuotationVersionsByQuotationId,
      normalizeQuotationVersionSummaryRecords,
      quotationVersionsByQuotationId,
    ],
  );

  const handleSelectQuotationEditVersion = useCallback(
    (quotationId, versionId) => {
      const normalizedQuotationId = String(quotationId || "");
      const normalizedVersionId = Number(versionId || 0);
      if (!normalizedQuotationId || !normalizedVersionId) {
        return;
      }

      setSelectedQuotationEditVersionIdByQuotationId((prev) => ({
        ...prev,
        [normalizedQuotationId]: normalizedVersionId,
      }));
    },
    [],
  );

  const toggleQuotationMenu = useCallback(
    (quotation) => {
      const quotationId = Number(quotation?.id || 0);
      if (!quotationId) {
        setOpenQuotationMenuId(null);
        return;
      }

      const shouldOpen = Number(openQuotationMenuId) !== quotationId;
      setOpenQuotationMenuId(shouldOpen ? quotationId : null);

      if (shouldOpen) {
        loadQuotationVersions(quotation);
      }
    },
    [loadQuotationVersions, openQuotationMenuId],
  );

  useEffect(() => {
    if (!error && !success) return;

    const timeoutId = window.setTimeout(() => {
      setError("");
      setSuccess("");
    }, 4000);

    return () => window.clearTimeout(timeoutId);
  }, [error, success]);

  const quotationPermissions = useMemo(
    () => new Set(currentUser?.permissions || []),
    [currentUser],
  );
  const canCreateQuotation =
    quotationPermissions.has("cotizaciones.operacion") ||
    quotationPermissions.has("cotizaciones.administracion");
  const isOpportunityActive =
    normalizeText(opportunityActivationStatus) === "activada";
  const selectedCreateOpportunity = useMemo(
    () =>
      createOpportunities.find(
        (item) => Number(item.id) === Number(createSelectedOpportunityId),
      ) || null,
    [createOpportunities, createSelectedOpportunityId],
  );
  const selectedQuotation = useMemo(
    () =>
      quotations.find(
        (quotation) => Number(quotation.id) === Number(selectedQuotationId),
      ) || null,
    [quotations, selectedQuotationId],
  );
  const hasCreateCommercialContext =
    Boolean(createQuotationForm.accountId) &&
    Boolean(createQuotationForm.opportunityId) &&
    Boolean(createQuotationForm.contextContactId);
  const canConfirmCreateCommercialContext =
    hasCreateCommercialContext && Boolean(createQuotationForm.sellerUserId);
  const canSubmitCreateQuotation =
    createCommercialContextConfirmed && canConfirmCreateCommercialContext;
  const currentEditSnapshot = useMemo(
    () =>
      buildPersistedQuotationVersionSnapshot({
        selectedVersion,
        versionForm,
        sectionEdits,
        itemEdits,
        inclusionTypes: catalogs.inclusionTypes,
      }),
    [
      catalogs.inclusionTypes,
      itemEdits,
      sectionEdits,
      selectedVersion,
      versionForm,
    ],
  );
  const hasEditUnsavedChanges = useMemo(
    () =>
      Boolean(
        selectedVersion &&
        initialEditSnapshotRef.current &&
        currentEditSnapshot &&
        currentEditSnapshot !== initialEditSnapshotRef.current,
      ),
    [currentEditSnapshot, selectedVersion],
  );

  const confirmDiscardUnsavedChanges = useCallback(() => {
    if (typeof window === "undefined") {
      return true;
    }

    return window.confirm(
      "Tienes cambios sin guardar en la cotizacion actual. Si sales ahora, los cambios locales se perderan. ¿Quieres continuar?",
    );
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !hasEditUnsavedChanges) {
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
  }, [hasEditUnsavedChanges]);

  useLayoutEffect(() => {
    setQuotationNavigationGuard("edit-quotation", {
      active: hasEditUnsavedChanges,
      message:
        "Tienes cambios sin guardar en la cotizacion actual. Si sales ahora, los cambios locales se perderan. ¿Quieres continuar?",
    });

    return () => {
      setQuotationNavigationGuard("edit-quotation", { active: false });
    };
  }, [hasEditUnsavedChanges]);

  useEffect(() => {
    if (!showCreateQuotationForm) return;

    setCreateQuotationForm((prev) => {
      const shouldPreserveQuotedContact =
        String(prev.accountId || "") ===
          String(createSelectedAccountId || "") &&
        String(prev.opportunityId || "") ===
          String(createSelectedOpportunityId || "") &&
        createContactOptions.some(
          (contact) => String(contact.id) === String(prev.contactId),
        );
      const inheritedContactId =
        selectedCreateOpportunity?.contactId &&
        createContactOptions.some(
          (contact) =>
            String(contact.id) === String(selectedCreateOpportunity.contactId),
        )
          ? String(selectedCreateOpportunity.contactId)
          : "";

      return {
        ...prev,
        accountId: createSelectedAccountId,
        opportunityId: createSelectedOpportunityId,
        contextContactId: inheritedContactId,
        contactId:
          createCommercialContextConfirmed && shouldPreserveQuotedContact
            ? String(prev.contactId)
            : inheritedContactId,
        sellerUserId: selectedCreateOpportunity?.sellerUserId
          ? String(selectedCreateOpportunity.sellerUserId)
          : "",
        sellerUserName: selectedCreateOpportunity?.sellerUserName || "",
        proposalName:
          String(prev.opportunityId || "") ===
          String(createSelectedOpportunityId || "")
            ? prev.proposalName
            : selectedCreateOpportunity?.name || "",
      };
    });
  }, [
    createCommercialContextConfirmed,
    createContactOptions,
    createSelectedAccountId,
    createSelectedOpportunityId,
    selectedCreateOpportunity,
    showCreateQuotationForm,
  ]);

  useEffect(() => {
    if (!showCreateQuotationForm || !createSelectedAccountId) return;

    let cancelled = false;

    async function loadCreateCommercialContext() {
      setLoadingCreateOpportunities(true);
      setLoadingCreateContacts(true);
      try {
        const [opportunitiesResponse, contactsResponse] = await Promise.all([
          api.get(
            `/api/quotation-accounts/${createSelectedAccountId}/opportunities`,
          ),
          api.get(
            `/api/quotation-accounts/${createSelectedAccountId}/contacts`,
          ),
        ]);

        if (cancelled) return;

        const nextOpportunities = Array.isArray(opportunitiesResponse.data)
          ? opportunitiesResponse.data.map((opportunity) => ({
              ...opportunity,
              id: Number(opportunity.id),
              accountId: Number(opportunity.accountId),
              contactId: Number(opportunity.contactId),
              amountUsd:
                opportunity.amountUsd ?? opportunity.amount_usd ?? null,
              closeDate: opportunity.closeDate || opportunity.close_date || "",
              salesStageName:
                opportunity.salesStageName || opportunity.sales_stage || "",
              sellerUserId: opportunity.sellerUserId
                ? Number(opportunity.sellerUserId)
                : null,
            }))
          : [];
        const nextContacts = Array.isArray(contactsResponse.data)
          ? contactsResponse.data.map((contact) => ({
              id: Number(contact.id),
              account_id: Number(contact.accountId ?? contact.account_id),
              full_name: contact.fullName || contact.full_name || "",
              email: contact.email || "",
              phone: contact.phone || "",
            }))
          : [];

        setCreateOpportunities(nextOpportunities);
        setCreateContactOptions(nextContacts);

        const nextSelectedOpportunity = nextOpportunities.find(
          (item) => Number(item.id) === Number(createSelectedOpportunityId),
        );

        setCreateSelectedOpportunityId(
          nextSelectedOpportunity ? String(nextSelectedOpportunity.id) : "",
        );
      } catch (err) {
        if (!cancelled) {
          setError(
            getApiErrorMessage(
              err,
              "No fue posible cargar el contexto comercial de la cotizacion",
            ),
          );
          setCreateOpportunities([]);
          setCreateContactOptions([]);
          setCreateSelectedOpportunityId("");
        }
      } finally {
        if (!cancelled) {
          setLoadingCreateOpportunities(false);
          setLoadingCreateContacts(false);
        }
      }
    }

    loadCreateCommercialContext();

    return () => {
      cancelled = true;
    };
  }, [createSelectedAccountId, opportunityId, showCreateQuotationForm]);

  const ensureEditorCatalogs = useCallback(async () => {
    const hasCatalogsLoaded =
      catalogs.inclusionTypes.length > 0 &&
      catalogs.deliveryTimes.length > 0 &&
      catalogs.validityTerms.length > 0 &&
      catalogs.warrantyTerms.length > 0 &&
      catalogs.paymentTerms.length > 0 &&
      catalogs.currencies.length > 0 &&
      catalogs.providers.length > 0 &&
      catalogs.activationStatuses.length > 0;

    if (hasCatalogsLoaded) {
      return catalogs;
    }

    const [
      inclusionRes,
      deliveryTimesRes,
      validityTermsRes,
      warrantyTermsRes,
      paymentTermsRes,
      currenciesRes,
      providersRes,
      activationRes,
    ] = await Promise.all([
      api.get("/api/catalogs/quotation-section-inclusion-types"),
      api.get("/api/catalogs/quotation-delivery-times"),
      api.get("/api/catalogs/quotation-validity-terms"),
      api.get("/api/catalogs/quotation-warranty-terms"),
      api.get("/api/catalogs/quotation-payment-terms"),
      api.get("/api/catalogs/quotation-currencies"),
      api.get("/api/catalogs/quotation-providers"),
      api.get("/api/catalogs/quotation-activation-statuses"),
    ]);

    const nextCatalogs = {
      inclusionTypes: inclusionRes.data || [],
      deliveryTimes: deliveryTimesRes.data || [],
      validityTerms: validityTermsRes.data || [],
      warrantyTerms: warrantyTermsRes.data || [],
      paymentTerms: paymentTermsRes.data || [],
      currencies: currenciesRes.data || [],
      providers: providersRes.data || [],
      activationStatuses: activationRes.data || [],
    };

    setCatalogs(nextCatalogs);
    setSectionDraft(buildSectionDraft(nextCatalogs.inclusionTypes));
    setCreateSectionDraft(buildSectionDraft(nextCatalogs.inclusionTypes));
    return nextCatalogs;
  }, [catalogs]);

  const openCreateQuotationModal = useCallback(() => {
    Promise.resolve(ensureEditorCatalogs())
      .then((nextCatalogs) => {
        setCreateSelectedAccountId("");
        setCreateOpportunities([]);
        setCreateSelectedOpportunityId("");
        setCreateContactOptions([]);
        setLoadingCreateOpportunities(false);
        setLoadingCreateContacts(false);
        setCreateQuotationForm(
          buildCreateQuotationForm({
            accountId: "",
            contactOptions: [],
            opportunityId: "",
            opportunityName: "",
            sellerUserId: "",
            sellerUserName: "",
          }),
        );
        createSectionDraftSequenceRef.current = 1;
        setCreateSectionDraft(buildSectionDraft(nextCatalogs.inclusionTypes));
        setCreateSectionDrafts([]);
        setCreateItemDraftsBySection({});
        setCreateSelectedItemIdsBySection({});
        setCreateHighlightedItemIdsBySection({});
        setCreateCopiedItems([]);
        setCreateCommercialContextConfirmed(false);
        setError("");
        setSuccess("");
        setShowCreateQuotationForm(true);
      })
      .catch((err) => {
        setError(
          getApiErrorMessage(
            err,
            "No fue posible preparar el formulario de cotizacion",
          ),
        );
      });
  }, [ensureEditorCatalogs]);

  const closeCreateQuotationModal = useCallback(() => {
    createSectionDraftSequenceRef.current = 1;
    createItemDraftSequenceRef.current = 1;
    setCreateSectionDrafts([]);
    setCreateItemDraftsBySection({});
    setCreateSelectedItemIdsBySection({});
    setCreateHighlightedItemIdsBySection({});
    setCreateCopiedItems([]);
    setCreateCommercialContextConfirmed(false);
    setShowCreateQuotationForm(false);
  }, []);

  const closeEditQuotationModal = useCallback(() => {
    if (hasEditUnsavedChanges && !confirmDiscardUnsavedChanges()) {
      return false;
    }

    setShowEditQuotationModal(false);
    setOpenQuotationMenuId(null);
    return true;
  }, [confirmDiscardUnsavedChanges, hasEditUnsavedChanges]);

  const openQuotationPrintView = useCallback((printModel) => {
    if (typeof window === "undefined" || !printModel) {
      setError("No fue posible preparar la vista previa PDF");
      return false;
    }

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setError(
        "El navegador bloqueo la ventana de vista previa. Permite ventanas emergentes e intenta de nuevo.",
      );
      return false;
    }

    try {
      printWindow.document.title = "Generando PDF...";
      printWindow.document.body.innerHTML = `
        <div style="font-family: Arial, sans-serif; padding: 32px; color: #123044;">
          <h1 style="margin: 0 0 12px; font-size: 22px;">Generando vista previa PDF</h1>
          <p style="margin: 0; font-size: 14px; color: #42515c;">
            Estamos preparando el documento oficial de la cotizacion.
          </p>
        </div>
      `;
    } catch {
      // Ignore window bootstrap failures and rely on the navigation below.
    }

    const pdfPayload = normalizeQuotationPdfPayload(printModel);
    const requestUrl = new URL(
      "/api/quotations/render-pdf",
      api.defaults.baseURL || window.location.origin,
    );
    const authToken = window.localStorage.getItem("crm_token") || "";

    void fetch(requestUrl.toString(), {
      method: "POST",
      headers: {
        Accept: "application/pdf",
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify(pdfPayload),
    })
      .then(async (response) => {
        if (!response.ok) {
          const contentType = response.headers.get("content-type") || "";
          if (contentType.includes("application/json")) {
            const errorData = await response.json().catch(() => null);
            const validationErrors = errorData?.errors?.fieldErrors
              ? Object.entries(errorData.errors.fieldErrors)
                  .flatMap(([field, messages]) => {
                    if (!Array.isArray(messages) || messages.length === 0) {
                      return [];
                    }
                    return `${field}: ${messages.join(", ")}`;
                  })
                  .join(" | ")
              : "";
            throw new Error(
              validationErrors
                ? `${errorData?.message || "No fue posible generar la vista previa PDF"}: ${validationErrors}`
                : errorData?.message ||
                    "No fue posible generar la vista previa PDF",
            );
          }

          const textError = await response.text().catch(() => "");
          throw new Error(
            textError || "No fue posible generar la vista previa PDF",
          );
        }

        const pdfBlob = await response.blob();
        if (!pdfBlob || pdfBlob.size === 0) {
          throw new Error("La vista previa PDF se genero vacia");
        }

        return pdfBlob;
      })
      .then((pdfBlob) => {
        const objectUrl = window.URL.createObjectURL(pdfBlob);
        const revokeObjectUrl = () => {
          window.URL.revokeObjectURL(objectUrl);
        };

        const handleLoad = () => {
          printWindow.removeEventListener("load", handleLoad);
          printWindow.addEventListener("pagehide", revokeObjectUrl, {
            once: true,
          });
        };

        printWindow.addEventListener("load", handleLoad, { once: true });
        printWindow.location.replace(objectUrl);
      })
      .catch((err) => {
        printWindow.close();
        setError(err?.message || "No fue posible generar la vista previa PDF");
      });

    return true;
  }, []);

  const loadVersion = useCallback(
    async (
      quotationId,
      versionId,
      { preserveMessage = false, providerOptions = catalogs.providers } = {},
    ) => {
      const safeQuotationId = Number(quotationId);
      const safeVersionId = Number(versionId);
      if (!safeQuotationId || !safeVersionId) return;

      const { data } = await api.get(
        `/api/quotation-versions/${safeVersionId}`,
      );
      setSelectedQuotationId(safeQuotationId);
      setSelectedVersionId(safeVersionId);
      setSelectedVersion(data);
      const nextVersionForm = buildVersionForm(data);
      const nextSectionEdits = buildSectionEdits(data);
      const nextItemEdits = buildItemEdits(data);

      setVersionForm(nextVersionForm);
      setSectionEdits(nextSectionEdits);
      setItemEdits(nextItemEdits);
      setItemDraftsBySection(buildItemDrafts(data, providerOptions));
      initialEditSnapshotRef.current = buildPersistedQuotationVersionSnapshot({
        selectedVersion: data,
        versionForm: nextVersionForm,
        sectionEdits: nextSectionEdits,
        itemEdits: nextItemEdits,
        inclusionTypes: catalogs.inclusionTypes,
      });
      if (!preserveMessage) {
        setError("");
        setSuccess("");
      }
    },
    [catalogs.inclusionTypes, catalogs.providers],
  );

  const applyLoadedVersionState = useCallback(
    (data, providerOptions = catalogs.providers) => {
      const nextVersionForm = buildVersionForm(data);
      const nextSectionEdits = buildSectionEdits(data);
      const nextItemEdits = buildItemEdits(data);

      setSelectedVersion(data);
      setVersionForm(nextVersionForm);
      setSectionEdits(nextSectionEdits);
      setItemEdits(nextItemEdits);
      setItemDraftsBySection(buildItemDrafts(data, providerOptions));
      initialEditSnapshotRef.current = buildPersistedQuotationVersionSnapshot({
        selectedVersion: data,
        versionForm: nextVersionForm,
        sectionEdits: nextSectionEdits,
        itemEdits: nextItemEdits,
        inclusionTypes: catalogs.inclusionTypes,
      });
    },
    [catalogs.inclusionTypes, catalogs.providers],
  );

  const buildNextEditSectionId = useCallback(() => {
    const nextId = -editSectionDraftSequenceRef.current;
    editSectionDraftSequenceRef.current += 1;
    return nextId;
  }, []);

  const buildNextEditItemId = useCallback(() => {
    const nextId = -editItemDraftSequenceRef.current;
    editItemDraftSequenceRef.current += 1;
    return nextId;
  }, []);

  const applyLocalSectionItemsState = useCallback(
    (sectionId, nextEditableItems) => {
      const normalizedItems = nextEditableItems.map((item, index) => {
        const displayOrder = index + 1;
        return {
          record: buildLocalEditableItemRecord(
            item,
            catalogs.providers,
            displayOrder,
          ),
          draft: buildLocalEditableItemDraft(item, displayOrder),
        };
      });

      setSelectedVersion((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          sections: (prev.sections || []).map((section) =>
            Number(section.id) === Number(sectionId)
              ? {
                  ...section,
                  items: normalizedItems.map((item) => item.record),
                }
              : section,
          ),
        };
      });

      setItemEdits((prev) => {
        const next = { ...prev };
        const currentSection = (selectedVersion?.sections || []).find(
          (section) => Number(section.id) === Number(sectionId),
        );

        (currentSection?.items || []).forEach((item) => {
          delete next[String(item.id)];
        });

        normalizedItems.forEach((item) => {
          next[String(item.record.id)] = item.draft;
        });

        return next;
      });
    },
    [catalogs.providers, selectedVersion?.sections],
  );

  const buildLocalEditItemsFromSources = useCallback(
    (sourceItems, { startingDisplayOrder = 1 } = {}) => {
      const idBySourceLocalId = new Map();

      return sourceItems
        .map((item, index) => {
          const nextId = buildNextEditItemId();
          const sourceLocalId = String(item?.localId || nextId);
          idBySourceLocalId.set(sourceLocalId, nextId);

          return {
            ...item,
            id: nextId,
            localId: String(nextId),
            _sourceLocalId: sourceLocalId,
            _bundleParentSourceLocalId: item?.bundleParentLocalId
              ? String(item.bundleParentLocalId)
              : null,
            displayOrder: startingDisplayOrder + index,
          };
        })
        .map((item) => ({
          ...item,
          bundleParentLocalId: item._bundleParentSourceLocalId
            ? String(
                idBySourceLocalId.get(item._bundleParentSourceLocalId) ||
                  item.bundleParentItemId ||
                  "",
              ) || null
            : null,
          bundleParentItemId: item._bundleParentSourceLocalId
            ? Number(
                idBySourceLocalId.get(item._bundleParentSourceLocalId) ||
                  item.bundleParentItemId ||
                  0,
              ) || null
            : null,
        }));
    },
    [buildNextEditItemId],
  );

  const openEditQuotationModal = useCallback(
    async (quotation, requestedVersionId = null) => {
      const versionId = Number(
        requestedVersionId ||
          getSelectedQuotationEditVersionId(quotation) ||
          quotation?.latestVersionId ||
          0,
      );
      if (!versionId) {
        setError("La cotizacion seleccionada no tiene una version editable.");
        setOpenQuotationMenuId(null);
        return;
      }

      setBusyAction(`open-quotation-${quotation.id}`);
      setError("");
      setSuccess("");
      try {
        const nextCatalogs = await ensureEditorCatalogs();
        await loadVersion(quotation.id, versionId, {
          preserveMessage: true,
          providerOptions: nextCatalogs.providers,
        });
        setShowEditQuotationModal(true);
      } catch (err) {
        setError(getApiErrorMessage(err, "No fue posible abrir la cotizacion"));
      } finally {
        setBusyAction("");
        setOpenQuotationMenuId(null);
      }
    },
    [ensureEditorCatalogs, getSelectedQuotationEditVersionId, loadVersion],
  );

  const handleSelectQuotationVersion = useCallback(
    async (quotationId, versionId) => {
      const isSameVersion =
        Number(quotationId) === Number(selectedQuotationId) &&
        Number(versionId) === Number(selectedVersionId);

      if (isSameVersion) {
        return;
      }

      if (hasEditUnsavedChanges && !confirmDiscardUnsavedChanges()) {
        return;
      }

      await loadVersion(quotationId, versionId);
    },
    [
      confirmDiscardUnsavedChanges,
      hasEditUnsavedChanges,
      loadVersion,
      selectedQuotationId,
      selectedVersionId,
    ],
  );

  useEffect(() => {
    selectedQuotationIdRef.current = selectedQuotationId;
  }, [selectedQuotationId]);

  useEffect(() => {
    if (!isOpen || !quotationsListEndpoint) return;

    let cancelled = false;

    async function loadBaseData() {
      setLoading(true);
      setError("");
      try {
        const quotationsRes = await api.get(quotationsListEndpoint);

        if (cancelled) return;

        if (showDetails) {
          const [
            inclusionRes,
            deliveryTimesRes,
            validityTermsRes,
            warrantyTermsRes,
            paymentTermsRes,
            currenciesRes,
            providersRes,
            activationRes,
          ] = await Promise.all([
            api.get("/api/catalogs/quotation-section-inclusion-types"),
            api.get("/api/catalogs/quotation-delivery-times"),
            api.get("/api/catalogs/quotation-validity-terms"),
            api.get("/api/catalogs/quotation-warranty-terms"),
            api.get("/api/catalogs/quotation-payment-terms"),
            api.get("/api/catalogs/quotation-currencies"),
            api.get("/api/catalogs/quotation-providers"),
            api.get("/api/catalogs/quotation-activation-statuses"),
          ]);

          if (cancelled) return;

          const nextCatalogs = {
            inclusionTypes: inclusionRes.data || [],
            deliveryTimes: deliveryTimesRes.data || [],
            validityTerms: validityTermsRes.data || [],
            warrantyTerms: warrantyTermsRes.data || [],
            paymentTerms: paymentTermsRes.data || [],
            currencies: currenciesRes.data || [],
            providers: providersRes.data || [],
            activationStatuses: activationRes.data || [],
          };
          setCatalogs(nextCatalogs);
          setSectionDraft(buildSectionDraft(nextCatalogs.inclusionTypes));

          const nextQuotations = normalizeQuotationListRecords(
            quotationsRes.data,
          );
          setQuotations(nextQuotations);

          const preferredQuotation =
            nextQuotations.find(
              (quotation) =>
                Number(quotation.id) === Number(selectedQuotationIdRef.current),
            ) ||
            nextQuotations[0] ||
            null;

          if (!preferredQuotation) {
            setSelectedQuotationId(null);
            setSelectedVersionId(null);
            setSelectedVersion(null);
            setVersionForm(buildVersionForm(null));
            return;
          }

          await loadVersionRef.current?.(
            preferredQuotation.id,
            preferredQuotation.latestVersionId,
            {
              preserveMessage: true,
              providerOptions: nextCatalogs.providers,
            },
          );
        } else {
          const nextQuotations = normalizeQuotationListRecords(
            quotationsRes.data,
          );
          setQuotations(nextQuotations);
          setSelectedQuotationId(null);
          setSelectedVersionId(null);
          setSelectedVersion(null);
          setVersionForm(buildVersionForm(null));
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            getApiErrorMessage(err, "No fue posible cargar cotizaciones"),
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadBaseData();

    return () => {
      cancelled = true;
    };
  }, [
    isOpen,
    normalizeQuotationListRecords,
    quotationsListEndpoint,
    showDetails,
  ]);

  useEffect(() => {
    loadVersionRef.current = loadVersion;
  }, [loadVersion]);

  const refreshQuotations = useCallback(
    async ({
      preferredQuotationId,
      preferredVersionId,
      targetOpportunityId,
    } = {}) => {
      const effectiveEndpoint = showDetails
        ? Number(targetOpportunityId || opportunityId)
          ? `/api/opportunities/${Number(targetOpportunityId || opportunityId)}/quotations`
          : null
        : "/api/quotations";

      if (!effectiveEndpoint) {
        setQuotations([]);
        setSelectedQuotationId(null);
        setSelectedVersionId(null);
        setSelectedVersion(null);
        setVersionForm(buildVersionForm(null));
        return;
      }

      const quotationsRes = await api.get(effectiveEndpoint);
      const nextQuotations = normalizeQuotationListRecords(quotationsRes.data);
      setQuotations(nextQuotations);
      setQuotationVersionsByQuotationId({});
      setLoadingQuotationVersionsByQuotationId({});

      const preferredQuotation =
        nextQuotations.find(
          (quotation) => Number(quotation.id) === Number(preferredQuotationId),
        ) ||
        nextQuotations[0] ||
        null;

      if (!preferredQuotation || (!showDetails && !showEditQuotationModal)) {
        setSelectedQuotationId(null);
        setSelectedVersionId(null);
        setSelectedVersion(null);
        setVersionForm(buildVersionForm(null));
        return;
      }

      await loadVersion(
        preferredQuotation.id,
        preferredVersionId || preferredQuotation.latestVersionId,
        { preserveMessage: true },
      );
    },
    [
      loadVersion,
      normalizeQuotationListRecords,
      opportunityId,
      showDetails,
      showEditQuotationModal,
    ],
  );

  const handleCreateQuotation = useCallback(
    async (createQuotationOptions = {}) => {
      setBusyAction("create-quotation");
      setError("");
      setSuccess("");
      try {
        const createdOpportunityId = Number(createQuotationForm.opportunityId);
        const normalizedSummaryDiscountInput =
          createQuotationOptions.summaryDiscountInput || null;
        const normalizedSummaryMeta =
          createQuotationOptions.summaryMeta || null;
        const normalizedInternalNotes =
          createQuotationOptions.internalNotes ?? "";
        const normalizedCommercialConditions =
          createQuotationOptions.commercialConditions || null;
        const sectionDrafts =
          createQuotationOptions.sectionDrafts || createSectionDrafts;
        const { data } = await api.post(
          `/api/opportunities/${createQuotationForm.opportunityId}/quotations`,
          {
            accountId: Number(createQuotationForm.accountId),
            contactId: Number(createQuotationForm.contactId),
            sellerUserId: Number(createQuotationForm.sellerUserId),
            proposalName: createQuotationForm.proposalName,
            quotationDate: createQuotationForm.quotationDate,
            introduction: createQuotationForm.introduction,
            summaryDiscountMode: normalizedSummaryDiscountInput?.mode || null,
            summaryDiscountValue:
              normalizedSummaryDiscountInput?.value == null
                ? null
                : Number(normalizedSummaryDiscountInput.value),
            summaryDistributionMode:
              normalizedSummaryMeta?.distributionMode || null,
            summaryVatMode: normalizedSummaryMeta?.vatMode || null,
            summaryVatPct:
              normalizedSummaryMeta?.vatPct == null
                ? null
                : Number(normalizedSummaryMeta.vatPct),
            internalNotes: normalizedInternalNotes,
            deliveryTime: normalizedCommercialConditions?.deliveryTime || null,
            quotationValidity:
              normalizedCommercialConditions?.quotationValidity || null,
            warranty: normalizedCommercialConditions?.warranty || null,
            paymentTerms: normalizedCommercialConditions?.paymentTerms || null,
            currencyCode: normalizedCommercialConditions?.currencyCode || null,
            exchangeRate:
              normalizedCommercialConditions?.exchangeRate == null
                ? null
                : Number(normalizedCommercialConditions.exchangeRate),
            quotationNotes:
              normalizedCommercialConditions?.quotationNotes || "",
            sections: sectionDrafts.map((section, index) => ({
              title: section.title,
              inclusionTypeId: Number(section.inclusionTypeId),
              items: (section.items || []).map((item, itemIndex) =>
                buildCreateQuotationSectionItemPayload(item, itemIndex),
              ),
              displayOrder: index + 1,
            })),
          },
        );
        if (
          createdOpportunityId &&
          Number(opportunityId) !== createdOpportunityId
        ) {
          onOpportunityFocusChange?.(createdOpportunityId);
        }
        await refreshQuotations({
          preferredQuotationId: data.quotationId,
          preferredVersionId: data.latestVersionId,
          targetOpportunityId: createdOpportunityId,
        });
        setCreateQuotationForm(
          buildCreateQuotationForm({
            accountId: createQuotationForm.accountId,
            contactOptions: createContactOptions,
            opportunityId: createQuotationForm.opportunityId,
            opportunityName: createQuotationForm.proposalName,
            sellerUserId: createQuotationForm.sellerUserId,
            sellerUserName: createQuotationForm.sellerUserName,
          }),
        );
        setCreateSectionDraft(buildSectionDraft(catalogs.inclusionTypes));
        setCreateSectionDrafts([]);
        setCreateItemDraftsBySection({});
        setCreateSelectedItemIdsBySection({});
        setCreateHighlightedItemIdsBySection({});
        setCreateCopiedItems([]);
        setCreateCommercialContextConfirmed(false);
        closeCreateQuotationModal();
        setSuccess(data.message || "Cotizacion creada");
      } catch (err) {
        setError(getApiErrorMessage(err, "No fue posible crear la cotizacion"));
      } finally {
        setBusyAction("");
      }
    },
    [
      catalogs.inclusionTypes,
      closeCreateQuotationModal,
      createContactOptions,
      createQuotationForm,
      createSectionDrafts,
      refreshQuotations,
      onOpportunityFocusChange,
      opportunityId,
    ],
  );

  const handleCreateAccountChange = useCallback((nextAccountId) => {
    setCreateCommercialContextConfirmed(false);
    setCreateSelectedAccountId(nextAccountId);
    setCreateSelectedOpportunityId("");
    setCreateOpportunities([]);
    setCreateContactOptions([]);
    setCreateQuotationForm((prev) => ({
      ...prev,
      contextContactId: "",
      contactId: "",
    }));
  }, []);

  const handleCreateOpportunityChange = useCallback((nextOpportunityId) => {
    setCreateCommercialContextConfirmed(false);
    setCreateSelectedOpportunityId(nextOpportunityId);
    setCreateQuotationForm((prev) => ({
      ...prev,
      contextContactId: "",
      contactId: "",
    }));
  }, []);

  const handleConfirmCreateCommercialContext = useCallback(() => {
    if (!canConfirmCreateCommercialContext) {
      setError(
        "Completa cuenta, oportunidad y contacto con vendedor asignado para continuar",
      );
      return;
    }

    setError("");
    setCreateCommercialContextConfirmed(true);
  }, [canConfirmCreateCommercialContext]);

  const handleAddCreateSectionDraft = useCallback(() => {
    const nextDraftId = `draft-section-${createSectionDraftSequenceRef.current}`;
    createSectionDraftSequenceRef.current += 1;
    const nextSectionNumber = createSectionDrafts.length + 1;

    setCreateSectionDrafts((prev) => [
      ...prev,
      {
        localId: nextDraftId,
        ...createSectionDraft,
        title:
          createSectionDraft.title.trim() || `Seccion ${nextSectionNumber}`,
        items: [],
      },
    ]);
    setCreateItemDraftsBySection((prev) => ({
      ...prev,
      [nextDraftId]: buildItemDraft(catalogs.providers),
    }));
    setCreateSectionDraft(buildSectionDraft(catalogs.inclusionTypes));
    setError("");
  }, [catalogs.inclusionTypes, catalogs.providers, createSectionDraft]);

  const handleRemoveCreateSectionDraft = useCallback((index) => {
    let removedLocalId = "";
    setCreateSectionDrafts((prev) =>
      prev.filter((section, itemIndex) => {
        if (itemIndex === index) {
          removedLocalId = section.localId;
          return false;
        }
        return true;
      }),
    );
    if (removedLocalId) {
      setCreateItemDraftsBySection((prev) => {
        const nextDrafts = { ...prev };
        delete nextDrafts[removedLocalId];
        return nextDrafts;
      });
      setCreateSelectedItemIdsBySection((prev) => {
        const nextSelected = { ...prev };
        delete nextSelected[removedLocalId];
        return nextSelected;
      });
      setCreateHighlightedItemIdsBySection((prev) => {
        const nextHighlighted = { ...prev };
        delete nextHighlighted[removedLocalId];
        return nextHighlighted;
      });
    }
  }, []);

  const handleUpdateCreateSectionDraft = useCallback((index, field, value) => {
    setCreateSectionDrafts((prev) =>
      prev.map((section, sectionIndex) =>
        sectionIndex === index
          ? {
              ...section,
              [field]: field === "title" ? value : value,
            }
          : section,
      ),
    );
  }, []);

  const handleMoveCreateSectionDraft = useCallback((index, direction) => {
    setCreateSectionDrafts((prev) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= prev.length) {
        return prev;
      }

      return moveListItem(prev, index, targetIndex);
    });
  }, []);

  const handleUpdateCreateSectionItem = useCallback(
    (sectionIndex, itemIndex, field, value) => {
      setCreateSectionDrafts((prev) =>
        prev.map((section, currentSectionIndex) => {
          if (currentSectionIndex !== sectionIndex) return section;
          return {
            ...section,
            items: (section.items || []).map((item, currentItemIndex) =>
              currentItemIndex === itemIndex
                ? syncQuotationItemDraftPricing(
                    {
                      ...item,
                      [field]: value,
                    },
                    {
                      currencyCode: createQuotationForm.currencyCode,
                      exchangeRate: createQuotationForm.exchangeRate,
                    },
                  )
                : item,
            ),
          };
        }),
      );
    },
    [createQuotationForm.currencyCode, createQuotationForm.exchangeRate],
  );

  const handleApplyCreateSectionItemProduct = useCallback(
    (sectionIndex, itemIndex, product) => {
      let sectionLocalId = "";
      let nextValidItemIds = [];

      setCreateSectionDrafts((prev) =>
        prev.map((section, currentSectionIndex) => {
          if (currentSectionIndex !== sectionIndex) return section;

          sectionLocalId = section.localId;
          const currentItems = section.items || [];
          const currentItem = currentItems[itemIndex];
          if (!currentItem) return section;

          const parentLocalId = currentItem.localId;
          const updatedParentItem = {
            ...currentItem,
            providerId: String(
              product.providerId || currentItem.providerId || "",
            ),
            productCode: product.code || "",
            productDescription: product.description || "",
            originalCurrencyCode:
              product.currencyCode || currentItem.originalCurrencyCode || "USD",
            originalListPriceUnit: String(
              product.price ??
                currentItem.originalListPriceUnit ??
                currentItem.listPriceUnit ??
                "0",
            ),
            listPriceUnit: String(
              product.price ?? currentItem.listPriceUnit ?? "0",
            ),
            itemType: product.itemType || "producto",
            bundleParentLocalId: null,
            bundleOriginType:
              product.itemType === "grupo_productos"
                ? "price_list_bundle"
                : null,
            sourceProviderPriceListItemId:
              product.itemType === "grupo_productos" && product.id
                ? Number(product.id)
                : null,
            sourceComponentPriceListItemId: null,
            bundleComponentItemId: null,
            isBundleComponent: false,
          };

          const nextItems = [];
          currentItems.forEach((item, currentItemIndex) => {
            if (
              currentItemIndex !== itemIndex &&
              item.bundleParentLocalId === parentLocalId
            ) {
              return;
            }

            if (currentItemIndex === itemIndex) {
              nextItems.push(updatedParentItem);

              const bundleComponents = Array.isArray(product.components)
                ? product.components
                : [];
              if (bundleComponents.length) {
                bundleComponents.forEach((component) => {
                  const componentUnitPrice =
                    resolveBundleComponentUnitPrice(component);
                  nextItems.push({
                    ...buildItemDraft(catalogs.providers),
                    localId: `draft-item-${createItemDraftSequenceRef.current++}`,
                    providerId: String(component.providerId || ""),
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
                    bundleParentLocalId: parentLocalId,
                    bundleOriginType: "price_list_bundle",
                    sourceProviderPriceListItemId: null,
                    sourceComponentPriceListItemId:
                      component.componentItemId || null,
                    bundleComponentItemId: component.componentItemId || null,
                    isBundleComponent: true,
                  });
                });
              }
              return;
            }

            nextItems.push(item);
          });

          nextValidItemIds = nextItems.map((item) => item.localId);
          return {
            ...section,
            items: nextItems,
          };
        }),
      );

      if (sectionLocalId) {
        setCreateSelectedItemIdsBySection((prev) => ({
          ...prev,
          [sectionLocalId]: (prev[sectionLocalId] || []).filter((itemId) =>
            nextValidItemIds.includes(itemId),
          ),
        }));
      }
    },
    [catalogs.providers],
  );

  const handleAddCreateSectionItem = useCallback(
    (sectionIndex) => {
      const section = createSectionDrafts[sectionIndex];
      if (!section?.localId) return;
      const draft = buildItemDraft(catalogs.providers);

      setCreateSectionDrafts((prev) =>
        prev.map((currentSection, currentSectionIndex) =>
          currentSectionIndex === sectionIndex
            ? {
                ...currentSection,
                items: [
                  ...(currentSection.items || []),
                  {
                    ...draft,
                    localId: `draft-item-${createItemDraftSequenceRef.current++}`,
                  },
                ],
              }
            : currentSection,
        ),
      );
      setError("");
    },
    [catalogs.providers, createSectionDrafts],
  );

  const handleToggleCreateSectionItemSelection = useCallback(
    (sectionLocalId, itemLocalId, checked) => {
      setCreateSelectedItemIdsBySection((prev) => {
        const currentIds = prev[sectionLocalId] || [];
        if (checked) {
          if (currentIds.includes(itemLocalId)) {
            return prev;
          }

          return {
            ...prev,
            [sectionLocalId]: [...currentIds, itemLocalId],
          };
        }

        const nextIds = currentIds.filter(
          (currentId) => currentId !== itemLocalId,
        );
        return {
          ...prev,
          [sectionLocalId]: nextIds,
        };
      });
    },
    [],
  );

  const handleToggleAllCreateSectionItems = useCallback(
    (sectionLocalId, itemIds, checked) => {
      setCreateSelectedItemIdsBySection((prev) => ({
        ...prev,
        [sectionLocalId]: checked ? itemIds : [],
      }));
    },
    [],
  );

  const handleHighlightCreateSectionItems = useCallback(
    (sectionIndex) => {
      const section = createSectionDrafts[sectionIndex];
      if (!section?.localId) return;

      const selectedIds = createSelectedItemIdsBySection[section.localId] || [];
      const effectiveSelectedIds = expandBundleSelection(
        section.items || [],
        selectedIds,
      );
      if (!effectiveSelectedIds.length) return;

      setCreateHighlightedItemIdsBySection((prev) => ({
        ...prev,
        [section.localId]: [
          ...new Set([
            ...(prev[section.localId] || []),
            ...effectiveSelectedIds,
          ]),
        ],
      }));
      setError("");
      setSuccess("Filas resaltadas");
    },
    [createSectionDrafts, createSelectedItemIdsBySection],
  );

  const handleUnhighlightCreateSectionItems = useCallback(
    (sectionIndex) => {
      const section = createSectionDrafts[sectionIndex];
      if (!section?.localId) return;

      const selectedIds = createSelectedItemIdsBySection[section.localId] || [];
      const effectiveSelectedIds = expandBundleSelection(
        section.items || [],
        selectedIds,
      );
      if (!effectiveSelectedIds.length) return;

      setCreateHighlightedItemIdsBySection((prev) => ({
        ...prev,
        [section.localId]: (prev[section.localId] || []).filter(
          (itemId) => !effectiveSelectedIds.includes(itemId),
        ),
      }));
      setError("");
      setSuccess("Resaltado quitado");
    },
    [createSectionDrafts, createSelectedItemIdsBySection],
  );

  const handleMoveCreateSectionItems = useCallback(
    (sectionIndex, direction) => {
      const section = createSectionDrafts[sectionIndex];
      if (!section?.localId) return;

      const selectedIds = createSelectedItemIdsBySection[section.localId] || [];
      if (!selectedIds.length) return;

      const effectiveSelectedIds = expandBundleSelection(
        section.items || [],
        selectedIds,
      );

      setCreateSectionDrafts((prev) =>
        prev.map((currentSection, currentSectionIndex) => {
          if (currentSectionIndex !== sectionIndex) return currentSection;
          return {
            ...currentSection,
            items: moveSelectedListItems(
              currentSection.items || [],
              effectiveSelectedIds,
              direction,
            ),
          };
        }),
      );

      setCreateSelectedItemIdsBySection((prev) => ({
        ...prev,
        [section.localId]: effectiveSelectedIds,
      }));
    },
    [createSectionDrafts, createSelectedItemIdsBySection],
  );

  const handleDuplicateCreateSectionItems = useCallback(
    (sectionIndex) => {
      const section = createSectionDrafts[sectionIndex];
      if (!section?.localId) return;

      const selectedIdSet = new Set(
        expandBundleSelection(
          section.items || [],
          createSelectedItemIdsBySection[section.localId] || [],
        ),
      );
      if (!selectedIdSet.size) return;

      const duplicatedIds = [];
      setCreateSectionDrafts((prev) =>
        prev.map((currentSection, currentSectionIndex) => {
          if (currentSectionIndex !== sectionIndex) return currentSection;

          const nextItems = [];
          const currentItems = currentSection.items || [];

          for (let index = 0; index < currentItems.length; index += 1) {
            const item = currentItems[index];
            nextItems.push(item);
            if (selectedIdSet.has(item.localId)) {
              const itemsToDuplicate = [item];

              while (
                index + 1 < currentItems.length &&
                selectedIdSet.has(currentItems[index + 1]?.localId)
              ) {
                index += 1;
                const selectedItem = currentItems[index];
                nextItems.push(selectedItem);
                itemsToDuplicate.push(selectedItem);
              }

              const duplicatedItems = cloneCreateSectionItems(
                itemsToDuplicate,
                () => `draft-item-${createItemDraftSequenceRef.current++}`,
              );
              duplicatedItems.forEach((duplicatedItem) => {
                duplicatedIds.push(duplicatedItem.localId);
                nextItems.push(duplicatedItem);
              });
            }
          }

          return {
            ...currentSection,
            items: nextItems,
          };
        }),
      );
      setCreateSelectedItemIdsBySection((prev) => ({
        ...prev,
        [section.localId]: duplicatedIds,
      }));
    },
    [createSectionDrafts, createSelectedItemIdsBySection],
  );

  const handleCopyCreateSectionItems = useCallback(
    (sectionIndex) => {
      const section = createSectionDrafts[sectionIndex];
      if (!section?.localId) return;

      const selectedIdSet = new Set(
        expandBundleSelection(
          section.items || [],
          createSelectedItemIdsBySection[section.localId] || [],
        ),
      );
      if (!selectedIdSet.size) return;

      const copiedRows = cloneCreateSectionItems(
        (section.items || []).filter((item) => selectedIdSet.has(item.localId)),
        () => `copied-item-${createItemDraftSequenceRef.current++}`,
      );

      setCreateCopiedItems(copiedRows);
      setError("");
      setSuccess(
        copiedRows.length === 1
          ? "1 fila copiada"
          : `${copiedRows.length} filas copiadas`,
      );
    },
    [createSectionDrafts, createSelectedItemIdsBySection],
  );

  const handlePasteCreateSectionItems = useCallback(
    (sectionIndex) => {
      const section = createSectionDrafts[sectionIndex];
      if (!section?.localId || !createCopiedItems.length) return;

      const selectedIdSet = new Set(
        expandBundleSelection(
          section.items || [],
          createSelectedItemIdsBySection[section.localId] || [],
        ),
      );
      const pastedIds = [];

      setCreateSectionDrafts((prev) =>
        prev.map((currentSection, currentSectionIndex) => {
          if (currentSectionIndex !== sectionIndex) return currentSection;

          const currentItems = currentSection.items || [];
          let insertIndex = currentItems.length;

          if (selectedIdSet.size) {
            for (let index = currentItems.length - 1; index >= 0; index -= 1) {
              if (selectedIdSet.has(currentItems[index]?.localId)) {
                insertIndex = index + 1;
                break;
              }
            }
          }

          const nextItems = [...currentItems];
          const pastedItems = cloneCreateSectionItems(
            createCopiedItems,
            () => `draft-item-${createItemDraftSequenceRef.current++}`,
          );

          pastedItems.forEach((item) => {
            pastedIds.push(item.localId);
          });

          nextItems.splice(insertIndex, 0, ...pastedItems);
          return {
            ...currentSection,
            items: nextItems,
          };
        }),
      );
      setCreateSelectedItemIdsBySection((prev) => ({
        ...prev,
        [section.localId]: pastedIds,
      }));
      setError("");
    },
    [createCopiedItems, createSectionDrafts, createSelectedItemIdsBySection],
  );

  const handleRemoveCreateSectionItems = useCallback(
    (sectionIndex) => {
      const section = createSectionDrafts[sectionIndex];
      if (!section?.localId) return;

      const selectedIdSet = new Set(
        expandBundleSelection(
          section.items || [],
          createSelectedItemIdsBySection[section.localId] || [],
        ),
      );
      if (!selectedIdSet.size) return;

      setCreateSectionDrafts((prev) =>
        prev.map((currentSection, currentSectionIndex) =>
          currentSectionIndex === sectionIndex
            ? {
                ...currentSection,
                items: (currentSection.items || []).filter(
                  (item) => !selectedIdSet.has(item.localId),
                ),
              }
            : currentSection,
        ),
      );
      setCreateSelectedItemIdsBySection((prev) => ({
        ...prev,
        [section.localId]: [],
      }));
      setCreateHighlightedItemIdsBySection((prev) => ({
        ...prev,
        [section.localId]: (prev[section.localId] || []).filter(
          (itemId) => !selectedIdSet.has(itemId),
        ),
      }));
    },
    [createSectionDrafts, createSelectedItemIdsBySection],
  );

  const handleCreateManualBundle = useCallback(
    (sectionIndex, parentLocalId) => {
      const section = createSectionDrafts[sectionIndex];
      if (!section?.localId) return false;

      const selectedIds = createSelectedItemIdsBySection[section.localId] || [];
      const selection = getCreateManualBundleSelection(
        section.items || [],
        selectedIds,
      );

      if (!selection.ok) {
        setError(selection.message);
        return false;
      }

      const parentItem = selection.items.find(
        (item) => item.localId === parentLocalId,
      );
      if (!parentItem) {
        setError("Selecciona una fila valida como padre del bundle manual.");
        return false;
      }

      setCreateSectionDrafts((prev) =>
        prev.map((currentSection, currentSectionIndex) => {
          if (currentSectionIndex !== sectionIndex) {
            return currentSection;
          }

          const currentItems = currentSection.items || [];
          const currentSelectedSet = new Set(selectedIds);
          const selectedItems = currentItems.filter((item) =>
            currentSelectedSet.has(item.localId),
          );

          const firstSelectedIndex = currentItems.findIndex((item) =>
            currentSelectedSet.has(item.localId),
          );
          if (firstSelectedIndex < 0) {
            return currentSection;
          }

          const normalizedParentItem =
            normalizeCreateBundleParentAsManual(parentItem);

          const normalizedComponentItems = selectedItems
            .filter((item) => item.localId !== parentLocalId)
            .map((item) =>
              normalizeCreateBundleComponentAsManual(item, parentLocalId),
            );

          const nextItems = [];
          let insertedBundleBlock = false;

          currentItems.forEach((item, currentIndex) => {
            if (!insertedBundleBlock && currentIndex === firstSelectedIndex) {
              nextItems.push(normalizedParentItem, ...normalizedComponentItems);
              insertedBundleBlock = true;
            }

            if (currentSelectedSet.has(item.localId)) {
              return;
            }

            nextItems.push(item);
          });

          if (!insertedBundleBlock) {
            nextItems.push(normalizedParentItem, ...normalizedComponentItems);
          }

          return {
            ...currentSection,
            items: nextItems,
          };
        }),
      );

      setCreateSelectedItemIdsBySection((prev) => ({
        ...prev,
        [section.localId]: selection.items.map((item) => item.localId),
      }));
      setError("");
      setSuccess("Bundle manual creado");
      return true;
    },
    [createSectionDrafts, createSelectedItemIdsBySection],
  );

  const handleAttachCreateSectionItemsToManualBundle = useCallback(
    (sectionIndex) => {
      const section = createSectionDrafts[sectionIndex];
      if (!section?.localId) return false;

      const selectedIds = createSelectedItemIdsBySection[section.localId] || [];
      const selection = getAttachToCreateManualBundleSelection(
        section.items || [],
        selectedIds,
      );

      if (!selection.ok || !selection.parentItem?.localId) {
        setError(selection.message);
        return false;
      }

      const parentLocalId = selection.parentItem.localId;
      const componentIdSet = new Set(
        selection.items.map((item) => item.localId),
      );

      setCreateSectionDrafts((prev) =>
        prev.map((currentSection, currentSectionIndex) => {
          if (currentSectionIndex !== sectionIndex) {
            return currentSection;
          }

          const currentItems = currentSection.items || [];
          const editableBundleComponentItems = currentItems.filter(
            (item) => item.bundleParentLocalId === parentLocalId,
          );
          const normalizedSelectedComponentItems = currentItems
            .filter((item) => componentIdSet.has(item.localId))
            .map((item) =>
              normalizeCreateBundleComponentAsManual(item, parentLocalId),
            );

          let lastBundleIndex = currentItems.findIndex(
            (item) => item.localId === parentLocalId,
          );

          currentItems.forEach((item, itemIndex) => {
            if (item.bundleParentLocalId === parentLocalId) {
              lastBundleIndex = itemIndex;
            }
          });

          if (lastBundleIndex < 0) {
            return currentSection;
          }

          const nextItems = [];

          currentItems.forEach((item, itemIndex) => {
            if (item.localId === parentLocalId) {
              nextItems.push(normalizeCreateBundleParentAsManual(item));

              if (itemIndex === lastBundleIndex) {
                nextItems.push(...normalizedSelectedComponentItems);
              }
              return;
            }

            if (
              editableBundleComponentItems.some(
                (bundleItem) => bundleItem.localId === item.localId,
              )
            ) {
              nextItems.push(
                normalizeCreateBundleComponentAsManual(item, parentLocalId),
              );

              if (itemIndex === lastBundleIndex) {
                nextItems.push(...normalizedSelectedComponentItems);
              }
              return;
            }

            if (componentIdSet.has(item.localId)) {
              return;
            }

            nextItems.push(item);

            if (itemIndex === lastBundleIndex) {
              nextItems.push(...normalizedComponentItems);
            }
          });

          return {
            ...currentSection,
            items: nextItems,
          };
        }),
      );

      setCreateSelectedItemIdsBySection((prev) => ({
        ...prev,
        [section.localId]: [
          parentLocalId,
          ...selection.items.map((item) => item.localId),
        ],
      }));
      setError("");
      setSuccess("Componentes agregados al bundle manual");
      return true;
    },
    [createSectionDrafts, createSelectedItemIdsBySection],
  );

  const handleDetachCreateSectionItemsFromManualBundle = useCallback(
    (sectionIndex) => {
      const section = createSectionDrafts[sectionIndex];
      if (!section?.localId) return false;

      const selectedIds = createSelectedItemIdsBySection[section.localId] || [];
      const selection = getDetachFromCreateManualBundleSelection(
        section.items || [],
        selectedIds,
      );

      if (!selection.ok || !selection.parentItem?.localId) {
        setError(selection.message);
        return false;
      }

      const parentLocalId = selection.parentItem.localId;
      const detachedIdSet = new Set(
        selection.items.map((item) => item.localId),
      );

      setCreateSectionDrafts((prev) =>
        prev.map((currentSection, currentSectionIndex) => {
          if (currentSectionIndex !== sectionIndex) {
            return currentSection;
          }

          const currentItems = currentSection.items || [];
          const detachedItems = currentItems
            .filter((item) => detachedIdSet.has(item.localId))
            .map((item) => ({
              ...item,
              bundleParentLocalId: null,
              bundleOriginType: null,
              sourceProviderPriceListItemId: null,
              sourceComponentPriceListItemId: null,
              bundleComponentItemId: null,
              isBundleComponent: false,
            }));
          const editableBundleComponentItems = currentItems.filter(
            (item) => item.bundleParentLocalId === parentLocalId,
          );

          let lastRemainingBundleIndex = -1;
          currentItems.forEach((item, itemIndex) => {
            if (
              item.bundleParentLocalId === parentLocalId &&
              !detachedIdSet.has(item.localId)
            ) {
              lastRemainingBundleIndex = itemIndex;
            }
          });

          if (lastRemainingBundleIndex < 0) {
            return currentSection;
          }

          const nextItems = [];

          currentItems.forEach((item, itemIndex) => {
            if (detachedIdSet.has(item.localId)) {
              return;
            }

            if (item.localId === parentLocalId) {
              nextItems.push(normalizeCreateBundleParentAsManual(item));

              if (itemIndex === lastRemainingBundleIndex) {
                nextItems.push(...detachedItems);
              }
              return;
            }

            if (
              editableBundleComponentItems.some(
                (bundleItem) => bundleItem.localId === item.localId,
              )
            ) {
              nextItems.push(
                normalizeCreateBundleComponentAsManual(item, parentLocalId),
              );

              if (itemIndex === lastRemainingBundleIndex) {
                nextItems.push(...detachedItems);
              }
              return;
            }

            nextItems.push(item);

            if (itemIndex === lastRemainingBundleIndex) {
              nextItems.push(...detachedItems);
            }
          });

          return {
            ...currentSection,
            items: nextItems,
          };
        }),
      );

      setCreateSelectedItemIdsBySection((prev) => ({
        ...prev,
        [section.localId]: selection.items.map((item) => item.localId),
      }));
      setError("");
      setSuccess("Componentes quitados del bundle manual");
      return true;
    },
    [createSectionDrafts, createSelectedItemIdsBySection],
  );

  const handleCreateVersion = useCallback(async () => {
    if (!selectedQuotationId) return;
    setBusyAction("create-version");
    setError("");
    setSuccess("");
    try {
      const { data } = await api.post(
        `/api/quotations/${selectedQuotationId}/versions`,
        {},
      );
      await refreshQuotations({
        preferredQuotationId: selectedQuotationId,
        preferredVersionId: data.id,
      });
      setSuccess(data.message || "Version creada");
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible crear la version"));
    } finally {
      setBusyAction("");
    }
  }, [refreshQuotations, selectedQuotationId]);

  const persistCurrentVersion = useCallback(async () => {
    if (!selectedVersionId) {
      return { ok: false, message: "Version no encontrada" };
    }

    const payload = buildPersistedQuotationVersionPayload({
      selectedVersion,
      versionForm,
      sectionEdits,
      itemEdits,
      inclusionTypes: catalogs.inclusionTypes,
    });
    const validationMessage = validatePersistedQuotationVersionPayload(payload);

    if (validationMessage) {
      setError(validationMessage);
      return { ok: false, message: validationMessage };
    }

    const { data } = await api.put(
      `/api/quotation-versions/${selectedVersionId}/full`,
      payload,
    );
    applyLoadedVersionState(data, catalogs.providers);
    return { ok: true, data };
  }, [
    applyLoadedVersionState,
    catalogs.inclusionTypes,
    catalogs.providers,
    itemEdits,
    sectionEdits,
    selectedVersion,
    selectedVersionId,
    versionForm,
  ]);

  const handleSaveVersion = useCallback(async () => {
    if (!selectedVersionId) return;
    setError("");
    setSuccess("");
    try {
      setBusyAction("save-version");
      const result = await persistCurrentVersion();

      if (!result.ok) {
        return;
      }

      await refreshQuotations({
        preferredQuotationId: selectedQuotationId,
        preferredVersionId: selectedVersionId,
      });

      setSuccess(result.data?.message || "Version actualizada");
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible guardar la version"));
    } finally {
      setBusyAction("");
    }
  }, [
    persistCurrentVersion,
    refreshQuotations,
    selectedQuotationId,
    selectedVersionId,
  ]);

  const handleSaveAsNewVersion = useCallback(async () => {
    if (!selectedQuotationId) return;
    setError("");
    setSuccess("");
    try {
      setBusyAction("save-as-new-version");
      const saveResult = await persistCurrentVersion();

      if (!saveResult.ok) {
        return;
      }

      const { data } = await api.post(
        `/api/quotations/${selectedQuotationId}/versions`,
        {},
      );
      await refreshQuotations({
        preferredQuotationId: selectedQuotationId,
        preferredVersionId: data.id,
      });
      setSuccess(data.message || "Version creada");
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible guardar como nueva version"),
      );
    } finally {
      setBusyAction("");
    }
  }, [persistCurrentVersion, refreshQuotations, selectedQuotationId]);

  const handleAction = useCallback(
    async (actionCode) => {
      if (!selectedVersionId) return;
      if (actionCode === "crear_version") {
        await handleCreateVersion();
        return;
      }

      setBusyAction(`action-${actionCode}`);
      setError("");
      setSuccess("");
      try {
        const { data } = await api.post(
          `/api/quotation-versions/${selectedVersionId}/transition`,
          { actionCode },
        );
        await refreshQuotations({
          preferredQuotationId: selectedQuotationId,
          preferredVersionId: selectedVersionId,
        });
        setSuccess(data.message || "Accion ejecutada");
      } catch (err) {
        setError(getApiErrorMessage(err, "No fue posible ejecutar la accion"));
      } finally {
        setBusyAction("");
      }
    },
    [
      handleCreateVersion,
      refreshQuotations,
      selectedQuotationId,
      selectedVersionId,
    ],
  );

  const handleCreateSection = useCallback(async () => {
    if (!selectedVersionId) return;
    setError("");
    setSuccess("");
    const nextSectionNumber = (selectedVersion?.sections || []).length + 1;
    const nextSectionId = buildNextEditSectionId();
    const nextSection = {
      id: nextSectionId,
      title: sectionDraft.title.trim() || `Seccion ${nextSectionNumber}`,
      inclusionTypeId: Number(
        sectionDraft.inclusionTypeId || catalogs.inclusionTypes[0]?.id || 0,
      ),
      displayOrder: nextSectionNumber,
      items: [],
    };

    setSelectedVersion((prev) =>
      prev
        ? {
            ...prev,
            sections: [...(prev.sections || []), nextSection],
          }
        : prev,
    );
    setSectionEdits((prev) => ({
      ...prev,
      [String(nextSectionId)]: {
        title: nextSection.title,
        inclusionTypeId: String(nextSection.inclusionTypeId),
      },
    }));
    setItemDraftsBySection((prev) => ({
      ...prev,
      [String(nextSectionId)]: buildItemDraft(catalogs.providers),
    }));
    setSectionDraft(buildSectionDraft(catalogs.inclusionTypes));
    setSuccess("Seccion creada");
  }, [
    buildNextEditSectionId,
    catalogs.inclusionTypes,
    catalogs.providers,
    sectionDraft,
    selectedVersion,
    selectedVersionId,
  ]);

  const handleSaveSection = useCallback(
    async (sectionId, explicitDraft = null) => {
      const draft = explicitDraft || sectionEdits[String(sectionId)];
      if (!draft) return;
      setSectionEdits((prev) => ({
        ...prev,
        [String(sectionId)]: draft,
      }));
      setError("");
    },
    [sectionEdits],
  );

  const handleMoveEditSection = useCallback(
    async (sectionId, direction) => {
      const sections = [...(selectedVersion?.sections || [])];
      const currentIndex = sections.findIndex(
        (section) => Number(section.id) === Number(sectionId),
      );
      if (currentIndex < 0) return false;

      const targetIndex = currentIndex + direction;
      if (targetIndex < 0 || targetIndex >= sections.length) {
        return false;
      }

      [sections[currentIndex], sections[targetIndex]] = [
        sections[targetIndex],
        sections[currentIndex],
      ];

      setSelectedVersion((prev) =>
        prev
          ? {
              ...prev,
              sections: sections.map((section, index) => ({
                ...section,
                displayOrder: index + 1,
              })),
            }
          : prev,
      );
      setError("");
      setSuccess("Orden de secciones actualizado");
      return true;
    },
    [selectedVersion],
  );

  const handleRemoveEditSection = useCallback(
    async (sectionId) => {
      setError("");
      setSuccess("");
      const removedSection = (selectedVersion?.sections || []).find(
        (section) => Number(section.id) === Number(sectionId),
      );
      if (!removedSection) return false;

      setSelectedVersion((prev) =>
        prev
          ? {
              ...prev,
              sections: (prev.sections || [])
                .filter((section) => Number(section.id) !== Number(sectionId))
                .map((section, index) => ({
                  ...section,
                  displayOrder: index + 1,
                })),
            }
          : prev,
      );
      setSectionEdits((prev) => {
        const next = { ...prev };
        delete next[String(sectionId)];
        return next;
      });
      setItemDraftsBySection((prev) => {
        const next = { ...prev };
        delete next[String(sectionId)];
        return next;
      });
      setItemEdits((prev) => {
        const next = { ...prev };
        (removedSection.items || []).forEach((item) => {
          delete next[String(item.id)];
        });
        return next;
      });
      setSuccess("Seccion eliminada");
      return true;
    },
    [selectedVersion?.sections],
  );

  const handleCreateItem = useCallback(
    async (sectionId) => {
      const draft = itemDraftsBySection[String(sectionId)];
      if (!draft) return false;
      setError("");
      setSuccess("");
      const section = (selectedVersion?.sections || []).find(
        (candidate) => Number(candidate.id) === Number(sectionId),
      );
      if (!section) return false;

      const currentItems = buildEditablePersistedSectionItems(
        section,
        itemEdits,
      );
      const bundleComponents = Array.isArray(draft.bundleComponents)
        ? draft.bundleComponents
        : [];
      const sourceItems =
        draft.itemType === "grupo_productos" && bundleComponents.length
          ? [
              {
                ...draft,
                localId: `draft-parent-${editItemDraftSequenceRef.current}`,
                bundleParentLocalId: null,
              },
              ...bundleComponents.map((component) => ({
                ...component,
                localId: `draft-component-${editItemDraftSequenceRef.current++}`,
                bundleParentLocalId: `draft-parent-${editItemDraftSequenceRef.current - 1}`,
              })),
            ]
          : [draft];

      const nextItems = [
        ...currentItems,
        ...buildLocalEditItemsFromSources(sourceItems, {
          startingDisplayOrder: currentItems.length + 1,
        }),
      ];

      applyLocalSectionItemsState(sectionId, nextItems);
      setSuccess("Item creado");
      return true;
    },
    [
      applyLocalSectionItemsState,
      buildLocalEditItemsFromSources,
      itemEdits,
      itemDraftsBySection,
      selectedVersion?.sections,
    ],
  );

  const handleApplyEditSectionItemProduct = useCallback(
    async (sectionId, itemId, product) => {
      const section = (selectedVersion?.sections || []).find(
        (candidate) => Number(candidate.id) === Number(sectionId),
      );
      if (!section) {
        return false;
      }

      const currentItems = buildEditablePersistedSectionItems(
        section,
        itemEdits,
      );
      const currentItemIndex = currentItems.findIndex(
        (candidate) => Number(candidate.id) === Number(itemId),
      );
      if (currentItemIndex < 0) {
        return false;
      }

      const currentItem = currentItems[currentItemIndex];
      const parentLocalId = String(currentItem.localId || currentItem.id);
      const shouldExpandBundleComponents =
        product.itemType === "grupo_productos" &&
        !currentItem.bundleParentItemId &&
        !currentItem.bundleParentLocalId &&
        !String(currentItem.productCode || "").trim() &&
        !String(currentItem.productDescription || "").trim() &&
        !currentItem.sourceProviderPriceListItemId;
      const updatedParentItem = {
        ...currentItem,
        providerId: String(product.providerId || currentItem.providerId || ""),
        productCode: product.code || "",
        productDescription: product.description || "",
        originalCurrencyCode:
          product.currencyCode || currentItem.originalCurrencyCode || "USD",
        originalListPriceUnit: String(
          product.price ??
            currentItem.originalListPriceUnit ??
            currentItem.listPriceUnit ??
            "0",
        ),
        listPriceUnit: String(
          product.price ?? currentItem.listPriceUnit ?? "0",
        ),
        itemType: product.itemType || "producto",
        bundleParentItemId: null,
        isBundleComponent: false,
        bundleOriginType:
          product.itemType === "grupo_productos" ? "price_list_bundle" : null,
        sourceProviderPriceListItemId: product.id ? Number(product.id) : null,
        sourceComponentPriceListItemId: null,
        bundleSortOrder: null,
      };

      const bundleComponents =
        shouldExpandBundleComponents && Array.isArray(product.components)
          ? buildLocalEditItemsFromSources(
              product.components.map((component) => {
                const componentUnitPrice =
                  resolveBundleComponentUnitPrice(component);

                return {
                  ...buildItemDraft(catalogs.providers),
                  localId: `edit-bundle-component-${editItemDraftSequenceRef.current++}`,
                  providerId: String(
                    component.providerId || product.providerId || "",
                  ),
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
                  bundleParentLocalId: parentLocalId,
                  bundleParentItemId: Number(currentItem.id) || null,
                  bundleOriginType: "price_list_bundle",
                  sourceProviderPriceListItemId: null,
                  sourceComponentPriceListItemId:
                    component.componentItemId || null,
                  bundleComponentItemId: component.componentItemId || null,
                  isBundleComponent: true,
                };
              }),
              { startingDisplayOrder: currentItemIndex + 2 },
            )
          : [];

      const nextItems = [];
      currentItems.forEach((item, index) => {
        if (
          index !== currentItemIndex &&
          String(item.bundleParentLocalId || item.bundleParentItemId || "") ===
            parentLocalId
        ) {
          return;
        }

        if (index === currentItemIndex) {
          nextItems.push(updatedParentItem, ...bundleComponents);
          return;
        }

        nextItems.push(item);
      });

      applyLocalSectionItemsState(sectionId, nextItems);
      return true;
    },
    [
      applyLocalSectionItemsState,
      buildEditablePersistedSectionItems,
      buildLocalEditItemsFromSources,
      catalogs.providers,
      itemEdits,
      selectedVersion?.sections,
    ],
  );

  const handleCreateEditManualBundle = useCallback(
    async (sectionId, selectedIds, parentLocalId) => {
      const section = (selectedVersion?.sections || []).find(
        (candidate) => Number(candidate.id) === Number(sectionId),
      );
      if (!section) return [];

      const sectionItems = buildEditablePersistedSectionItems(
        section,
        itemEdits,
      );
      const selection = getCreateManualBundleSelection(
        sectionItems,
        selectedIds || [],
      );
      if (!selection.ok) {
        setError(selection.message);
        return [];
      }

      const parentItem = selection.items.find(
        (item) => item.localId === String(parentLocalId),
      );
      if (!parentItem) {
        setError("Selecciona una fila valida como padre del bundle manual.");
        return [];
      }

      setError("");
      setSuccess("");
      const currentSelectedSet = new Set(selectedIds || []);
      const firstSelectedIndex = sectionItems.findIndex((item) =>
        currentSelectedSet.has(item.localId),
      );
      const normalizedParentItem =
        normalizeCreateBundleParentAsManual(parentItem);
      const normalizedComponentItems = selection.items
        .filter((item) => item.localId !== String(parentLocalId))
        .map((item) =>
          normalizeCreateBundleComponentAsManual(item, String(parentLocalId)),
        );

      const nextItems = [];
      let insertedBundleBlock = false;

      sectionItems.forEach((item, currentIndex) => {
        if (!insertedBundleBlock && currentIndex === firstSelectedIndex) {
          nextItems.push(normalizedParentItem, ...normalizedComponentItems);
          insertedBundleBlock = true;
        }

        if (currentSelectedSet.has(item.localId)) {
          return;
        }

        nextItems.push(item);
      });

      if (!insertedBundleBlock) {
        nextItems.push(normalizedParentItem, ...normalizedComponentItems);
      }

      applyLocalSectionItemsState(sectionId, nextItems);
      setSuccess("Bundle manual creado");
      return selection.items.map((item) => item.localId);
    },
    [applyLocalSectionItemsState, itemEdits, selectedVersion],
  );

  const handleAttachEditSectionItemsToManualBundle = useCallback(
    async (sectionId, selectedIds) => {
      const section = (selectedVersion?.sections || []).find(
        (candidate) => Number(candidate.id) === Number(sectionId),
      );
      if (!section) return [];

      const sectionItems = buildEditablePersistedSectionItems(
        section,
        itemEdits,
      );
      const selection = getAttachToCreateManualBundleSelection(
        sectionItems,
        selectedIds || [],
      );
      if (!selection.ok || !selection.parentItem?.localId) {
        setError(selection.message);
        return [];
      }

      setError("");
      setSuccess("");
      const parentLocalId = selection.parentItem.localId;
      const componentIdSet = new Set(
        selection.items.map((item) => item.localId),
      );
      const editableBundleComponentItems = sectionItems.filter(
        (item) => item.bundleParentLocalId === parentLocalId,
      );
      const normalizedSelectedComponentItems = sectionItems
        .filter((item) => componentIdSet.has(item.localId))
        .map((item) =>
          normalizeCreateBundleComponentAsManual(item, parentLocalId),
        );

      let lastBundleIndex = sectionItems.findIndex(
        (item) => item.localId === parentLocalId,
      );
      sectionItems.forEach((item, itemIndex) => {
        if (item.bundleParentLocalId === parentLocalId) {
          lastBundleIndex = itemIndex;
        }
      });

      if (lastBundleIndex < 0) {
        return [];
      }

      const nextItems = [];

      sectionItems.forEach((item, itemIndex) => {
        if (item.localId === parentLocalId) {
          nextItems.push(normalizeCreateBundleParentAsManual(item));

          if (itemIndex === lastBundleIndex) {
            nextItems.push(...normalizedSelectedComponentItems);
          }
          return;
        }

        if (
          editableBundleComponentItems.some(
            (bundleItem) => bundleItem.localId === item.localId,
          )
        ) {
          nextItems.push(
            normalizeCreateBundleComponentAsManual(item, parentLocalId),
          );

          if (itemIndex === lastBundleIndex) {
            nextItems.push(...normalizedSelectedComponentItems);
          }
          return;
        }

        if (componentIdSet.has(item.localId)) {
          return;
        }

        nextItems.push(item);

        if (itemIndex === lastBundleIndex) {
          nextItems.push(...normalizedSelectedComponentItems);
        }
      });

      applyLocalSectionItemsState(sectionId, nextItems);
      setSuccess("Componentes agregados al bundle manual");
      return [parentLocalId, ...selection.items.map((item) => item.localId)];
    },
    [applyLocalSectionItemsState, itemEdits, selectedVersion],
  );

  const handleDetachEditSectionItemsFromManualBundle = useCallback(
    async (sectionId, selectedIds) => {
      const section = (selectedVersion?.sections || []).find(
        (candidate) => Number(candidate.id) === Number(sectionId),
      );
      if (!section) return [];

      const sectionItems = buildEditablePersistedSectionItems(
        section,
        itemEdits,
      );
      const selection = getDetachFromCreateManualBundleSelection(
        sectionItems,
        selectedIds || [],
      );
      if (!selection.ok || !selection.parentItem?.localId) {
        setError(selection.message);
        return [];
      }

      setError("");
      setSuccess("");
      const parentLocalId = selection.parentItem.localId;
      const detachedIdSet = new Set(
        selection.items.map((item) => item.localId),
      );
      const detachedItems = sectionItems
        .filter((item) => detachedIdSet.has(item.localId))
        .map((item) => ({
          ...item,
          bundleParentLocalId: null,
          bundleParentItemId: null,
          bundleOriginType: null,
          sourceProviderPriceListItemId: null,
          sourceComponentPriceListItemId: null,
          bundleComponentItemId: null,
          isBundleComponent: false,
        }));
      const editableBundleComponentItems = sectionItems.filter(
        (item) => item.bundleParentLocalId === parentLocalId,
      );

      let lastRemainingBundleIndex = -1;
      sectionItems.forEach((item, itemIndex) => {
        if (
          item.bundleParentLocalId === parentLocalId &&
          !detachedIdSet.has(item.localId)
        ) {
          lastRemainingBundleIndex = itemIndex;
        }
      });

      if (lastRemainingBundleIndex < 0) {
        return [];
      }

      const nextItems = [];

      sectionItems.forEach((item, itemIndex) => {
        if (detachedIdSet.has(item.localId)) {
          return;
        }

        if (item.localId === parentLocalId) {
          nextItems.push(normalizeCreateBundleParentAsManual(item));

          if (itemIndex === lastRemainingBundleIndex) {
            nextItems.push(...detachedItems);
          }
          return;
        }

        if (
          editableBundleComponentItems.some(
            (bundleItem) => bundleItem.localId === item.localId,
          )
        ) {
          nextItems.push(
            normalizeCreateBundleComponentAsManual(item, parentLocalId),
          );

          if (itemIndex === lastRemainingBundleIndex) {
            nextItems.push(...detachedItems);
          }
          return;
        }

        nextItems.push(item);

        if (itemIndex === lastRemainingBundleIndex) {
          nextItems.push(...detachedItems);
        }
      });

      applyLocalSectionItemsState(sectionId, nextItems);
      setSuccess("Componentes quitados del bundle manual");
      return [parentLocalId, ...detachedItems.map((item) => item.localId)];
    },
    [applyLocalSectionItemsState, itemEdits, selectedVersion],
  );

  const handleDuplicateEditSectionItems = useCallback(
    async (sectionId, selectedIds) => {
      const section = (selectedVersion?.sections || []).find(
        (candidate) => Number(candidate.id) === Number(sectionId),
      );
      if (!section) return [];

      const sectionItems = buildEditablePersistedSectionItems(
        section,
        itemEdits,
      );
      const effectiveSelectedIds = expandBundleSelection(
        sectionItems,
        selectedIds || [],
      );
      const selectedIdSet = new Set(effectiveSelectedIds);
      if (!selectedIdSet.size) return [];

      setError("");
      setSuccess("");
      const nextItems = [];
      const duplicatedIds = [];

      for (let index = 0; index < sectionItems.length; index += 1) {
        const item = sectionItems[index];
        nextItems.push(item);

        if (!selectedIdSet.has(item.localId)) {
          continue;
        }

        const itemsToDuplicate = [item];
        while (
          index + 1 < sectionItems.length &&
          selectedIdSet.has(sectionItems[index + 1]?.localId)
        ) {
          index += 1;
          const selectedItem = sectionItems[index];
          nextItems.push(selectedItem);
          itemsToDuplicate.push(selectedItem);
        }

        const duplicatedItems = buildLocalEditItemsFromSources(
          itemsToDuplicate.map((selectedItem) => ({
            ...selectedItem,
            bundleParentItemId: null,
          })),
          {
            startingDisplayOrder: nextItems.length + 1,
          },
        );

        duplicatedItems.forEach((duplicatedItem) => {
          duplicatedIds.push(duplicatedItem.localId);
          nextItems.push(duplicatedItem);
        });
      }

      applyLocalSectionItemsState(sectionId, nextItems);
      setSuccess(
        duplicatedIds.length === 1
          ? "1 fila duplicada"
          : `${duplicatedIds.length} filas duplicadas`,
      );
      return duplicatedIds;
    },
    [
      applyLocalSectionItemsState,
      buildLocalEditItemsFromSources,
      itemEdits,
      selectedVersion,
    ],
  );

  const handleCopyEditSectionItems = useCallback(
    (sectionId, selectedIds) => {
      const section = (selectedVersion?.sections || []).find(
        (candidate) => Number(candidate.id) === Number(sectionId),
      );
      if (!section) return 0;

      const sectionItems = buildEditablePersistedSectionItems(
        section,
        itemEdits,
      );
      const effectiveSelectedIds = expandBundleSelection(
        sectionItems,
        selectedIds || [],
      );
      const selectedIdSet = new Set(effectiveSelectedIds);
      if (!selectedIdSet.size) return 0;

      const copiedRows = cloneCreateSectionItems(
        sectionItems
          .filter((item) => selectedIdSet.has(item.localId))
          .map((item) => ({
            ...item,
            bundleParentItemId: null,
          })),
        () => `edit-copy-${editItemDraftSequenceRef.current++}`,
      );

      setEditCopiedItems(copiedRows);
      setError("");
      setSuccess(
        copiedRows.length === 1
          ? "1 fila copiada"
          : `${copiedRows.length} filas copiadas`,
      );
      return copiedRows.length;
    },
    [itemEdits, selectedVersion],
  );

  const handlePasteEditSectionItems = useCallback(
    async (sectionId, selectedIds) => {
      if (!editCopiedItems.length) return [];

      const section = (selectedVersion?.sections || []).find(
        (candidate) => Number(candidate.id) === Number(sectionId),
      );
      if (!section) return [];

      const sectionItems = buildEditablePersistedSectionItems(
        section,
        itemEdits,
      );
      const effectiveSelectedIds = expandBundleSelection(
        sectionItems,
        selectedIds || [],
      );
      const selectedIdSet = new Set(effectiveSelectedIds);

      let insertIndex = sectionItems.length;
      if (selectedIdSet.size) {
        for (let index = sectionItems.length - 1; index >= 0; index -= 1) {
          if (selectedIdSet.has(sectionItems[index]?.localId)) {
            insertIndex = index + 1;
            break;
          }
        }
      }

      const pastedItems = cloneCreateSectionItems(
        editCopiedItems,
        () => `edit-item-${editItemDraftSequenceRef.current++}`,
      );

      setError("");
      setSuccess("");
      const nextItems = [
        ...sectionItems.slice(0, insertIndex),
        ...buildLocalEditItemsFromSources(
          pastedItems.map((item) => ({
            ...item,
            bundleParentItemId: null,
          })),
          {
            startingDisplayOrder: insertIndex + 1,
          },
        ),
        ...sectionItems.slice(insertIndex),
      ];
      const createdIds = nextItems
        .slice(insertIndex, insertIndex + pastedItems.length)
        .map((item) => item.localId);

      applyLocalSectionItemsState(sectionId, nextItems);
      setSuccess(
        createdIds.length === 1
          ? "1 fila pegada"
          : `${createdIds.length} filas pegadas`,
      );
      return createdIds;
    },
    [
      applyLocalSectionItemsState,
      buildLocalEditItemsFromSources,
      editCopiedItems,
      itemEdits,
      selectedVersion,
    ],
  );

  const handleRemoveEditSectionItems = useCallback(
    async (sectionId, selectedIds) => {
      const section = (selectedVersion?.sections || []).find(
        (candidate) => Number(candidate.id) === Number(sectionId),
      );
      if (!section) return [];

      const sectionItems = buildEditablePersistedSectionItems(
        section,
        itemEdits,
      );
      const effectiveSelectedIds = expandBundleSelection(
        sectionItems,
        selectedIds || [],
      );
      const selectedIdSet = new Set(effectiveSelectedIds);
      if (!selectedIdSet.size) return [];

      if (!selectedIdSet.size) return [];

      setError("");
      setSuccess("");
      const nextItems = sectionItems.filter(
        (item) => !selectedIdSet.has(String(item.localId)),
      );

      applyLocalSectionItemsState(sectionId, nextItems);
      setSuccess(
        effectiveSelectedIds.length === 1
          ? "1 fila eliminada"
          : `${effectiveSelectedIds.length} filas eliminadas`,
      );
      return effectiveSelectedIds;
    },
    [applyLocalSectionItemsState, itemEdits, selectedVersion],
  );

  const handleSaveItem = useCallback(
    async (itemId, explicitDraft = null) => {
      const draft = explicitDraft || itemEdits[String(itemId)];
      if (!draft) return;
      setItemEdits((prev) => ({
        ...prev,
        [String(itemId)]: draft,
      }));
      setError("");
    },
    [itemEdits],
  );

  const quotationStatusCounts = useMemo(
    () => ({
      active: quotations.filter(
        (quotation) => getQuotationActivationBucket(quotation) === "active",
      ).length,
      inactive: quotations.filter(
        (quotation) => getQuotationActivationBucket(quotation) === "inactive",
      ).length,
    }),
    [quotations],
  );

  const visibleQuotations = useMemo(() => {
    const normalizedQuery = normalizeText(quotationQuery);

    return quotations
      .filter((quotation) => {
        if (
          quotationStatusFilter !== "all" &&
          getQuotationActivationBucket(quotation) !== quotationStatusFilter
        ) {
          return false;
        }

        if (!normalizedQuery) return true;

        const haystack = [
          quotation.id,
          quotation.accountName,
          quotation.opportunityName,
          quotation.opportunitySalesStageName,
          quotation.opportunityAmountUsd,
          quotation.opportunityCloseDate,
          quotation.latestVersionNumber,
          quotation.latestStatusName,
        ]
          .map((value) => normalizeText(value))
          .join(" ");

        return haystack.includes(normalizedQuery);
      })
      .slice()
      .sort((left, right) => {
        const direction = quotationSort.direction === "asc" ? 1 : -1;

        let leftValue;
        let rightValue;

        switch (quotationSort.field) {
          case "version":
            leftValue = Number(left.latestVersionNumber || 0);
            rightValue = Number(right.latestVersionNumber || 0);
            break;
          case "cuenta":
            leftValue = left.accountName || "";
            rightValue = right.accountName || "";
            break;
          case "oportunidad":
            leftValue = left.opportunityName || "";
            rightValue = right.opportunityName || "";
            break;
          case "etapa_oportunidad":
            leftValue = left.opportunitySalesStageName || "";
            rightValue = right.opportunitySalesStageName || "";
            break;
          case "importe":
            leftValue = Number(left.latestTotalSaleAmount || 0);
            rightValue = Number(right.latestTotalSaleAmount || 0);
            break;
          case "cierre_oportunidad":
            leftValue = left.opportunityCloseDate || "";
            rightValue = right.opportunityCloseDate || "";
            break;
          case "estado_cotizacion":
            leftValue = left.latestStatusName || "";
            rightValue = right.latestStatusName || "";
            break;
          case "id":
          default:
            leftValue = Number(left.id || 0);
            rightValue = Number(right.id || 0);
            break;
        }

        return compareValues(leftValue, rightValue) * direction;
      });
  }, [quotations, quotationQuery, quotationSort, quotationStatusFilter]);

  const totalQuotationPages = useMemo(
    () => Math.max(1, Math.ceil(visibleQuotations.length / quotationsPerPage)),
    [visibleQuotations.length, quotationsPerPage],
  );

  const pagedQuotations = useMemo(
    () =>
      visibleQuotations.slice(
        (quotationsPage - 1) * quotationsPerPage,
        quotationsPage * quotationsPerPage,
      ),
    [visibleQuotations, quotationsPage, quotationsPerPage],
  );

  useEffect(() => {
    setQuotationsPage(1);
  }, [quotationQuery, quotationStatusFilter]);

  useEffect(() => {
    if (quotationsPage > totalQuotationPages) {
      setQuotationsPage(totalQuotationPages);
    }
  }, [quotationsPage, totalQuotationPages]);

  const toggleQuotationSort = useCallback((field) => {
    setQuotationSort((current) => {
      if (current.field === field) {
        return {
          field,
          direction: current.direction === "asc" ? "desc" : "asc",
        };
      }

      return { field, direction: field === "id" ? "desc" : "asc" };
    });
  }, []);

  const getQuotationSortArrow = useCallback(
    (field) => {
      if (quotationSort.field !== field) return "↕";
      return quotationSort.direction === "asc" ? "↑" : "↓";
    },
    [quotationSort],
  );

  const setQuotationsPerPage = useCallback((value) => {
    setQuotationsPage(1);
    setQuotationsPerPageState(value);
  }, []);

  const getQuotationActivationBadgeClass = useCallback(
    (quotation) =>
      `user-status-badge ${getQuotationActivationBucket(quotation)}`,
    [],
  );

  const getQuotationWorkflowBadgeClass = useCallback(
    (quotation) => `user-status-badge ${getQuotationWorkflowTone(quotation)}`,
    [],
  );

  const allowedActions = useMemo(
    () => (selectedVersion?.actions || []).filter((action) => action.allowed),
    [selectedVersion],
  );

  return {
    canCreateQuotation,
    isOpportunityActive,
    showCreateQuotationForm,
    busyAction,
    openCreateQuotationModal,
    closeCreateQuotationModal,
    error,
    success,
    createModalProps: {
      accounts,
      accountName,
      draftQuotationIdLabel: "Por asignar",
      draftQuotationVersionLabel: "V1",
      selectedAccountId: createSelectedAccountId,
      onCreateAccountChange: handleCreateAccountChange,
      loadingAccounts,
      opportunities: createOpportunities,
      opportunityName,
      selectedOpportunityId: createSelectedOpportunityId,
      onCreateOpportunityChange: handleCreateOpportunityChange,
      loadingOpportunities: loadingCreateOpportunities,
      contactOptions: createContactOptions,
      loadingContacts: loadingCreateContacts,
      selectedOpportunity: selectedCreateOpportunity,
      createCommercialContextConfirmed,
      handleConfirmCreateCommercialContext,
      canConfirmCreateCommercialContext,
      createQuotationForm,
      setCreateQuotationForm,
      createSectionDraft,
      setCreateSectionDraft,
      createSectionDrafts,
      createItemDraftsBySection,
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
      hasCreateCopiedItems: createCopiedItems.length > 0,
      setCreateItemDraftsBySection,
      closeCreateQuotationModal,
      handleCreateQuotation,
      busyAction,
      canSubmitCreateQuotation,
      hasCreateCommercialContext,
    },
    editModalProps: {
      isOpen: showEditQuotationModal,
      closeEditQuotationModal,
      error,
      success,
      editorContentProps: {
        selectedVersion,
        selectedQuotation,
        closeEditQuotationModal,
        openQuotationPrintView,
        companyBranding,
        versionForm,
        setVersionForm,
        contactOptions,
        catalogs,
        busyAction,
        allowedActions,
        handleSaveVersion,
        handleSaveAsNewVersion,
        handleAction,
        sectionDraft,
        setSectionDraft,
        handleCreateSection,
        sectionEdits,
        setSectionEdits,
        itemEdits,
        setItemEdits: setSyncedItemEdits,
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
        hasEditCopiedItems: editCopiedItems.length > 0,
      },
    },
    listPanelProps: {
      showDetails,
      loading,
      quotations,
      selectedQuotationId,
      loadVersion: handleSelectQuotationVersion,
      quotationStatusFilter,
      setQuotationStatusFilter,
      quotationStatusCounts,
      quotationQuery,
      setQuotationQuery,
      toggleQuotationSort,
      getQuotationSortArrow,
      visibleQuotations,
      pagedQuotations,
      formatQuotationDate,
      getQuotationWorkflowBadgeClass,
      getQuotationActivationBadgeClass,
      openQuotationMenuId,
      setOpenQuotationMenuId,
      quotationVersionsByQuotationId,
      selectedQuotationEditVersionIdByQuotationId,
      loadingQuotationVersionsByQuotationId,
      handleSelectQuotationEditVersion,
      toggleQuotationMenu,
      busyAction,
      openEditQuotationModal,
      quotationsPage,
      quotationsPerPage,
      totalQuotationPages,
      setQuotationsPage,
      setQuotationsPerPage,
    },
    editorContentProps: {
      selectedVersion,
      selectedQuotation,
      selectedQuotation,
      openQuotationPrintView,
      companyBranding,
      versionForm,
      setVersionForm,
      contactOptions,
      catalogs,
      busyAction,
      allowedActions,
      handleSaveVersion,
      handleAction,
      sectionDraft,
      setSectionDraft,
      handleCreateSection,
      sectionEdits,
      setSectionEdits,
      itemEdits,
      setItemEdits: setSyncedItemEdits,
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
      hasEditCopiedItems: editCopiedItems.length > 0,
    },
  };
}
