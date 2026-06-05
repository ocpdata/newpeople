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
  buildQuotationCommercialConditionsForm,
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

const PROVIDER_DOCUMENT_IMPORT_JOB_POLL_INTERVAL_MS = 3000;
const PROVIDER_DOCUMENT_IMPORT_TOTAL_POLL_TIMEOUT_MS = 300000;
const PROVIDER_DOCUMENT_IMPORT_REQUEST_TIMEOUT_MS = 30000;
const PROVIDER_DOCUMENT_IMPORT_COMMERCIAL_TERM_KEYS = [
  "deliveryTime",
  "quotationValidity",
  "warranty",
  "paymentTerms",
  "currencyCode",
];
const PROVIDER_DOCUMENT_IMPORT_COMMERCIAL_TERM_FIELD_CONFIG = {
  deliveryTime: {
    optionsKey: "deliveryTimes",
    label: "Tiempo de entrega",
  },
  quotationValidity: {
    optionsKey: "validityTerms",
    label: "Validez",
  },
  warranty: {
    optionsKey: "warrantyTerms",
    label: "Garantia",
  },
  paymentTerms: {
    optionsKey: "paymentTerms",
    label: "Pago",
  },
};
const PROVIDER_DOCUMENT_IMPORT_SUGGESTED_MATCH_STATUSES = [
  "suggested_match_pending_confirmation",
  "ambiguous_similar_match",
];
const PROVIDER_DOCUMENT_IMPORT_NON_TRANSFERABLE_WARNING_PATTERNS = [
  /costo\s+unitario/i,
  /moneda/i,
  /proveedor/i,
  /lista\s+activa|price\s+list/i,
  /codigo\s+de\s+proveedor|supplier\s+code/i,
  /descripcion\s+suficiente|enough\s+description/i,
  /coincidencia\s+sugerida|match|ambigua|ambigu/i,
  /bloquead|blocking|cannot\s+create/i,
];

function buildMailtoDraftUrl({ to = "", subject = "", body = "" } = {}) {
  const recipient = String(to || "").trim();
  const encodedRecipient = encodeURIComponent(recipient);
  const queryParts = [];

  if (subject) {
    queryParts.push(`subject=${encodeURIComponent(String(subject))}`);
  }
  if (body) {
    queryParts.push(`body=${encodeURIComponent(String(body))}`);
  }

  const queryString = queryParts.join("&");
  if (!queryString) {
    return `mailto:${encodedRecipient}`;
  }

  return `mailto:${encodedRecipient}?${queryString}`;
}

function openMailtoDraft(url) {
  if (typeof window === "undefined" || !url) {
    return false;
  }

  try {
    const popup = window.open(url, "_blank", "noopener,noreferrer");
    if (popup) {
      return true;
    }
  } catch {
    // Continue with location fallback.
  }

  try {
    window.location.href = url;
    return true;
  } catch {
    return false;
  }
}

function buildProviderDocumentImportCommercialTermsSelection() {
  return {
    deliveryTime: true,
    quotationValidity: true,
    warranty: true,
    paymentTerms: true,
    currencyCode: true,
  };
}

function buildProviderDocumentImportCommercialClausesSelection(
  preview,
  currentSelection = {},
) {
  const clauses = Array.isArray(preview?.commercialClauses)
    ? preview.commercialClauses
    : [];

  return clauses.reduce((selection, clause) => {
    const clauseId = String(clause?.clauseId || "").trim();
    if (!clauseId) {
      return selection;
    }

    if (Object.prototype.hasOwnProperty.call(currentSelection, clauseId)) {
      selection[clauseId] = Boolean(currentSelection[clauseId]);
      return selection;
    }

    selection[clauseId] = true;
    return selection;
  }, {});
}

function buildProviderDocumentImportSuggestedMatchFeedbackEntry(
  type,
  message,
  mode = null,
) {
  const normalizedMessage = String(message || "").trim();
  if (!normalizedMessage) {
    return null;
  }

  return {
    type: type === "success" ? "success" : "error",
    message: normalizedMessage,
    mode:
      mode === "reused" ||
      mode === "created" ||
      mode === "reused_pending_confirmation"
        ? mode
        : null,
  };
}

function patchProviderDocumentImportPreviewWithSelectedSuggestedCandidate(
  preview,
  {
    previewId,
    selectedSuggestedPriceListItemId,
    providerCode,
    productDescription,
  } = {},
) {
  if (!preview || typeof preview !== "object") {
    return preview;
  }

  const normalizedPreviewId = String(previewId || "").trim();
  const normalizedCandidateId = Number(selectedSuggestedPriceListItemId || 0);
  const previewItems = Array.isArray(preview.items) ? preview.items : [];
  if (!normalizedPreviewId || !normalizedCandidateId || !previewItems.length) {
    return preview;
  }

  return {
    ...preview,
    items: previewItems.map((item) => {
      if (String(item?.previewId || "") !== normalizedPreviewId) {
        return item;
      }

      const suggestedMatchCandidates = Array.isArray(
        item.suggestedMatchCandidates,
      )
        ? item.suggestedMatchCandidates
        : [];
      const hasCandidate = suggestedMatchCandidates.some(
        (candidate) => Number(candidate?.id || 0) === normalizedCandidateId,
      );

      return {
        ...item,
        suggestedMatchCandidates: hasCandidate
          ? suggestedMatchCandidates
          : [
              ...suggestedMatchCandidates,
              {
                id: normalizedCandidateId,
                code: String(providerCode || item?.providerCode || "").trim(),
                description: String(
                  productDescription || item?.productDescription || "",
                ).trim(),
              },
            ],
      };
    }),
  };
}

function resolveProviderDocumentImportItem(item, itemMatchResolutions = {}) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const resolution = itemMatchResolutions[String(item.previewId)] || null;
  const suggestedMatchCandidates = Array.isArray(item.suggestedMatchCandidates)
    ? item.suggestedMatchCandidates
    : [];
  const selectedSuggestedPriceListItemId = Number(
    resolution?.selectedSuggestedPriceListItemId || 0,
  );
  const selectedCandidate = suggestedMatchCandidates.find(
    (candidate) => Number(candidate.id) === selectedSuggestedPriceListItemId,
  );

  if (item.matchStatus === "matched") {
    return {
      ...item,
      originalMatchStatus: item.originalMatchStatus || item.matchStatus,
      effectiveMatchStatus: "matched",
      effectiveMatchedPriceListItemId: item.matchedPriceListItemId || null,
      effectiveMatchedCandidate: selectedCandidate || null,
      selectedSuggestedPriceListItemId: null,
      resolutionAction: null,
      resolutionRequired: false,
    };
  }

  if (
    PROVIDER_DOCUMENT_IMPORT_SUGGESTED_MATCH_STATUSES.includes(item.matchStatus)
  ) {
    if (resolution?.action === "use_existing" && selectedCandidate) {
      return {
        ...item,
        originalMatchStatus: item.matchStatus,
        effectiveMatchStatus: "matched",
        effectiveMatchedPriceListItemId: Number(selectedCandidate.id),
        effectiveMatchedCandidate: selectedCandidate,
        selectedSuggestedPriceListItemId: Number(selectedCandidate.id),
        resolutionAction: "use_existing",
        resolutionRequired: false,
      };
    }

    if (resolution?.action === "treat_as_missing") {
      return {
        ...item,
        originalMatchStatus: item.matchStatus,
        effectiveMatchStatus: "missing_in_price_list",
        effectiveMatchedPriceListItemId: null,
        effectiveMatchedCandidate: null,
        selectedSuggestedPriceListItemId: null,
        resolutionAction: "treat_as_missing",
        resolutionRequired: false,
      };
    }

    return {
      ...item,
      originalMatchStatus: item.matchStatus,
      effectiveMatchStatus: item.matchStatus,
      effectiveMatchedPriceListItemId: null,
      effectiveMatchedCandidate: null,
      selectedSuggestedPriceListItemId:
        selectedSuggestedPriceListItemId || null,
      resolutionAction: null,
      resolutionRequired: true,
    };
  }

  return {
    ...item,
    originalMatchStatus: item.matchStatus,
    effectiveMatchStatus: item.matchStatus,
    effectiveMatchedPriceListItemId: item.matchedPriceListItemId || null,
    effectiveMatchedCandidate: null,
    selectedSuggestedPriceListItemId: null,
    resolutionAction: null,
    resolutionRequired: false,
  };
}

function buildProviderDocumentImportEffectiveItems(
  preview,
  itemMatchResolutions = {},
) {
  const items = Array.isArray(preview?.items) ? preview.items : [];
  return items
    .map((item) =>
      resolveProviderDocumentImportItem(item, itemMatchResolutions),
    )
    .filter(Boolean);
}

function buildProviderDocumentImportWorkflowStage(
  preview,
  itemMatchResolutions = {},
) {
  const items = buildProviderDocumentImportEffectiveItems(
    preview,
    itemMatchResolutions,
  );
  if (
    String(preview?.workflowStage || "") ===
    "provider_mismatch_confirmation_required"
  ) {
    return "provider_mismatch_confirmation_required";
  }
  if (
    items.some((item) => item.effectiveMatchStatus === "missing_price_list")
  ) {
    return "blocked_missing_price_list";
  }
  if (items.some((item) => item.resolutionRequired)) {
    return "resolve_suggested_matches";
  }
  if (
    items.some(
      (item) =>
        item.effectiveMatchStatus === "missing_in_price_list" &&
        item.canCreateInPriceList,
    )
  ) {
    return "ready_to_create_missing_items";
  }
  return "ready_to_apply";
}

function pruneProviderDocumentImportItemMatchResolutions(
  preview,
  itemMatchResolutions = {},
) {
  const previewIds = new Set(
    (Array.isArray(preview?.items) ? preview.items : []).map((item) =>
      String(item.previewId),
    ),
  );

  return Object.entries(itemMatchResolutions).reduce(
    (nextResolutions, [previewId, resolution]) => {
      if (previewIds.has(String(previewId))) {
        nextResolutions[previewId] = resolution;
      }
      return nextResolutions;
    },
    {},
  );
}

function buildProviderDocumentImportMissingItemsSelection(
  preview,
  itemMatchResolutions = {},
  currentSelection = {},
) {
  const items = buildProviderDocumentImportEffectiveItems(
    preview,
    itemMatchResolutions,
  );

  return items.reduce((selection, item) => {
    if (
      item?.previewId &&
      item.effectiveMatchStatus === "missing_in_price_list" &&
      item.canCreateInPriceList
    ) {
      const previewId = String(item.previewId);
      selection[previewId] =
        currentSelection[previewId] == null
          ? true
          : Boolean(currentSelection[previewId]);
    }
    return selection;
  }, {});
}

function buildProviderDocumentImportCreateMissingItemPayload(
  item,
  overrides = {},
) {
  if (!item?.previewId) {
    return null;
  }

  return {
    previewId: item.previewId,
    providerCode: item.providerCode,
    productDescription: item.productDescription,
    quantity: Number(item.quantity || 1),
    originalCurrencyCode: item.originalCurrencyCode || null,
    resolvedCostUnit: Number(item.resolvedCostUnit || 0),
    manufacturerDiscountPct: Number(item.manufacturerDiscountPct || 0),
    resolutionAction: item.resolutionAction || null,
    selectedSuggestedPriceListItemId:
      item.selectedSuggestedPriceListItemId || null,
    selectedForPriceListCreation: true,
    ...overrides,
  };
}

function patchProviderDocumentImportPreviewWithCreatedItems(
  preview,
  createdItems = [],
  sourcePreview = preview,
) {
  if (!preview || typeof preview !== "object") {
    return preview;
  }

  const previewItems = Array.isArray(preview.items) ? preview.items : [];
  const sourcePreviewItems = Array.isArray(sourcePreview?.items)
    ? sourcePreview.items
    : [];
  if (
    !previewItems.length ||
    !Array.isArray(createdItems) ||
    !createdItems.length
  ) {
    return preview;
  }

  const sourceItemsByPreviewId = new Map(
    sourcePreviewItems
      .map((item) => [String(item?.previewId || "").trim(), item])
      .filter(([previewId]) => previewId),
  );

  const createdByPreviewId = new Map(
    createdItems
      .map((item) => ({
        previewId: String(item?.previewId || "").trim(),
        createdPriceListItemId:
          Number(item?.createdPriceListItemId || 0) || null,
      }))
      .filter((item) => item.previewId),
  );

  if (!createdByPreviewId.size) {
    return preview;
  }

  const nextItems = previewItems.map((item) => {
    const previewId = String(item?.previewId || "").trim();
    const createdRecord = createdByPreviewId.get(previewId);
    if (!createdRecord) {
      return item;
    }

    const sourceItem = sourceItemsByPreviewId.get(previewId) || item;

    return {
      ...item,
      originalMatchStatus:
        sourceItem.originalMatchStatus ||
        sourceItem.matchStatus ||
        item.originalMatchStatus ||
        item.matchStatus,
      matchStatus: "matched",
      matchedPriceListItemId:
        createdRecord.createdPriceListItemId ||
        item.matchedPriceListItemId ||
        null,
      canCreateInPriceList: false,
      createBlockedReason: null,
    };
  });

  return {
    ...preview,
    items: nextItems,
  };
}

function buildProviderDocumentImportState(
  defaultDocumentId = "",
  options = {},
) {
  return {
    isOpen: false,
    sourceMode:
      options.sourceMode === "create_draft" ? "create_draft" : "version",
    sourceDocuments: Array.isArray(options.sourceDocuments)
      ? options.sourceDocuments
      : [],
    draftPricingContext:
      options.draftPricingContext &&
      typeof options.draftPricingContext === "object"
        ? options.draftPricingContext
        : null,
    selectedDocumentId: defaultDocumentId ? String(defaultDocumentId) : "",
    confirmedProviderId: "",
    preview: null,
    previewJob: null,
    loadingPreview: false,
    creatingMissingItems: false,
    creatingSuggestedMatchPreviewId: "",
    suggestedMatchFeedbackByPreviewId: {},
    applying: false,
    commercialTermsSelection:
      buildProviderDocumentImportCommercialTermsSelection(),
    commercialClausesSelection: {},
    itemMatchResolutions: {},
    missingItemsSelection: {},
    transferableWarningsSelection: {},
  };
}

function buildProviderDocumentImportPreviewJobState(
  responseData,
  fallbackJob = null,
) {
  const job = responseData?.job || fallbackJob || null;
  if (!job) {
    return null;
  }

  return {
    ...job,
    error: responseData?.error || job.error || null,
  };
}

function normalizeProviderDocumentImportWarningToSpanish(warning) {
  const normalizedWarning = String(warning || "").trim();
  if (!normalizedWarning) {
    return "";
  }

  const comparableWarning = normalizeText(normalizedWarning)
    .replace(/[_-]+/g, " ")
    .trim();

  const serviceTermMatch = comparableWarning.match(
    /^(subscription|maintenance)(?:\s+with\s+service)?\s+term:?\s+(\d+)\s+months?$/i,
  );
  if (serviceTermMatch) {
    const warningType = /maintenance/i.test(serviceTermMatch[1])
      ? "Mantenimiento"
      : "Suscripcion";
    const monthCount = Number(serviceTermMatch[2]) || 0;
    return `El item corresponde a ${
      warningType === "Mantenimiento" ? "mantenimiento" : "una suscripcion"
    } con termino de servicio de ${monthCount} ${
      monthCount === 1 ? "mes" : "meses"
    }`;
  }

  const bareServiceTermMatch = comparableWarning.match(
    /^service\s+term:?\s+(\d+)\s+months?$/i,
  );
  if (bareServiceTermMatch) {
    const monthCount = Number(bareServiceTermMatch[1]) || 0;
    return `El item indica un termino de servicio de ${monthCount} ${
      monthCount === 1 ? "mes" : "meses"
    }`;
  }

  return normalizedWarning;
}

function isProviderDocumentImportWarningTransferable(warning) {
  const normalizedWarning =
    normalizeProviderDocumentImportWarningToSpanish(warning);
  if (!normalizedWarning) {
    return false;
  }

  return !PROVIDER_DOCUMENT_IMPORT_NON_TRANSFERABLE_WARNING_PATTERNS.some(
    (pattern) => pattern.test(normalizedWarning),
  );
}

function buildProviderDocumentImportTransferableWarningKey(previewId, warning) {
  return `${String(previewId || "").trim()}::${normalizeProviderDocumentImportWarningToSpanish(
    warning,
  )}`;
}

function appendProviderDocumentImportWarningsToDescription(
  description,
  selectedWarnings = [],
) {
  const baseDescription =
    normalizeProviderDocumentImportDescription(description);
  const normalizedBase = normalizeText(baseDescription).replace(/[_-]+/g, " ");
  const uniqueWarnings = Array.from(
    new Set(
      (Array.isArray(selectedWarnings) ? selectedWarnings : [])
        .map((warning) =>
          normalizeProviderDocumentImportWarningToSpanish(warning),
        )
        .filter(Boolean)
        .filter((warning) => {
          const normalizedWarning = normalizeText(warning).replace(
            /[_-]+/g,
            " ",
          );
          return (
            normalizedWarning && !normalizedBase.includes(normalizedWarning)
          );
        }),
    ),
  );

  if (!uniqueWarnings.length) {
    return baseDescription;
  }

  const notesBlock = uniqueWarnings
    .map((warning) => `Nota: ${warning}`)
    .join("\n");
  return baseDescription ? `${baseDescription}\n${notesBlock}` : notesBlock;
}

function normalizeProviderDocumentImportDescription(value) {
  const normalizedValue = String(value || "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!normalizedValue) {
    return "";
  }

  const segments = normalizedValue
    .split(/Nota:\s*/g)
    .map((segment) => String(segment || "").trim())
    .filter(Boolean);

  if (segments.length <= 1) {
    return normalizedValue;
  }

  const [baseDescription, ...noteSegments] = segments;
  const notesBlock = noteSegments
    .map((segment) => `Nota: ${segment}`)
    .join("\n");
  return [baseDescription, notesBlock].filter(Boolean).join("\n");
}

function mapQuotationContactOption(contact) {
  return {
    id: Number(contact.id),
    account_id: Number(contact.accountId ?? contact.account_id),
    full_name: contact.fullName || contact.full_name || "",
    email: contact.email || "",
    phone: contact.phone || "",
  };
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

function mergeVersionDocuments(version, documents, allDocuments) {
  if (!version) {
    return version;
  }

  return {
    ...version,
    documents: Array.isArray(documents) ? documents : version.documents || [],
    allDocuments: Array.isArray(allDocuments)
      ? allDocuments
      : version.allDocuments || [],
  };
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

function isBlankBundleSelectionItem(item) {
  return (
    !String(item?.productCode || "").trim() &&
    !String(item?.productDescription || "").trim()
  );
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

  if (selectedItems.some((item) => isBlankBundleSelectionItem(item))) {
    return {
      ok: false,
      message: "No puedes crear un bundle con filas seleccionadas en blanco.",
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

function buildProviderDocumentImportLocalItem(
  item,
  pricingContext = {},
  providerContext = {},
) {
  const pricing = buildQuotationItemPricing(
    {
      originalCurrencyCode: item?.originalCurrencyCode || "USD",
      originalListPriceUnit: Number(item?.resolvedCostUnit || 0),
      listPriceUnit: Number(item?.resolvedCostUnit || 0),
    },
    pricingContext,
  );

  return {
    providerId: String(item?.providerId || providerContext?.providerId || ""),
    productCode: String(item?.providerCode || "").trim(),
    productDescription: normalizeProviderDocumentImportDescription(
      item?.productDescription,
    ),
    quantity: String(Number(item?.quantity || 1) || 1),
    originalCurrencyCode: pricing.originalCurrencyCode,
    originalListPriceUnit: String(pricing.originalListPriceUnit),
    listPriceUnit: String(pricing.listPriceUnit),
    manufacturerDiscountPct: String(Number(item?.manufacturerDiscountPct || 0)),
    importCostPct: "0",
    profitMarginPct: "30",
    finalDiscountPct: "0",
    itemType: "producto",
    isRenewal: false,
    bundleParentItemId: null,
    bundleParentLocalId: null,
    bundleOriginType: null,
    sourceProviderPriceListItemId: item?.effectiveMatchedPriceListItemId
      ? Number(item.effectiveMatchedPriceListItemId)
      : item?.matchedPriceListItemId
        ? Number(item.matchedPriceListItemId)
        : null,
    sourceComponentPriceListItemId: null,
    importWarnings: Array.isArray(item?.warnings) ? item.warnings : [],
  };
}

function normalizeProviderDocumentImportCommercialTermValue(value) {
  if (value == null || value === "") {
    return "";
  }

  if (typeof value === "object") {
    const codeValue = String(value.code || "").trim();
    if (codeValue) {
      return codeValue;
    }

    const rawValue = String(
      value.value || value.name || value.label || "",
    ).trim();
    return rawValue;
  }

  return String(value).trim();
}

function normalizeProviderDocumentImportComparableValue(value) {
  return normalizeText(value).replace(/[_-]+/g, " ");
}

function formatProviderDocumentImportFallbackNoteValue(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) {
    return "";
  }

  const normalizedValue =
    normalizeProviderDocumentImportComparableValue(rawValue);
  const netDaysMatch = normalizedValue.match(/^net\s*(\d+)$/u);
  if (netDaysMatch) {
    return `${netDaysMatch[1]} dias despues de facturado`;
  }

  if (
    normalizedValue === "according to notes" ||
    normalizedValue === "as indicated in notes" ||
    normalizedValue === "segun notas" ||
    normalizedValue === "de acuerdo a lo indicado en notas"
  ) {
    return "De acuerdo a lo indicado en notas";
  }

  return rawValue;
}

function buildProviderDocumentImportFallbackNoteLine(label, value) {
  const formattedValue = formatProviderDocumentImportFallbackNoteValue(value);
  return formattedValue ? `${label}: ${formattedValue}` : "";
}

function appendProviderDocumentImportNoteLines(baseNotes, noteLines = []) {
  const currentNotes = String(baseNotes || "").trim();
  const normalizedNotes =
    normalizeProviderDocumentImportComparableValue(currentNotes);
  const uniqueLines = noteLines
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .filter((line) => {
      const comparableLine =
        normalizeProviderDocumentImportComparableValue(line);
      return comparableLine && !normalizedNotes.includes(comparableLine);
    });

  if (!uniqueLines.length) {
    return currentNotes;
  }

  const noteBlock = uniqueLines.map((line) => `- ${line}`).join("\n");
  return currentNotes ? `${currentNotes}\n${noteBlock}` : noteBlock;
}

function formatProviderDocumentImportCommercialClauseCategoryLabel(category) {
  switch (String(category || "").trim().toLowerCase()) {
    case "payment":
      return "Pago";
    case "delivery":
      return "Entrega";
    case "warranty":
      return "Garantia";
    case "legal":
      return "Legal";
    case "logistics":
      return "Logistica";
    default:
      return "Condicion";
  }
}

function buildProviderDocumentImportCommercialClauseNoteLines(clauses = []) {
  const normalizedClauses = Array.isArray(clauses) ? clauses : [];
  if (!normalizedClauses.length) {
    return [];
  }

  const lines = ["Condiciones del proveedor detectadas:"];
  normalizedClauses.forEach((clause) => {
    const text = String(clause?.textEs || "").trim();
    if (!text) {
      return;
    }
    const categoryLabel = formatProviderDocumentImportCommercialClauseCategoryLabel(
      clause?.category,
    );
    const title = String(clause?.titleEs || "").trim();
    const textLine = title
      ? `${categoryLabel} - ${title}: ${text}`
      : `${categoryLabel} - ${text}`;
    lines.push(textLine);
  });
  return lines;
}

function resolveProviderDocumentImportCommercialTermForForm({
  field,
  value,
  options = [],
}) {
  const rawValue = normalizeProviderDocumentImportCommercialTermValue(value);
  if (!rawValue) {
    return {
      resolvedValue: "",
      noteLine: "",
    };
  }

  const normalizedCandidate = buildQuotationCommercialConditionsForm({
    [field]: rawValue,
  })[field];
  const comparableRawValue =
    normalizeProviderDocumentImportComparableValue(rawValue);
  const comparableCandidate =
    normalizeProviderDocumentImportComparableValue(normalizedCandidate);

  const matchedOption = options.find((option) => {
    const optionCode = String(option?.code || "").trim();
    const comparableOptionCode =
      normalizeProviderDocumentImportComparableValue(optionCode);
    const comparableOptionName = normalizeProviderDocumentImportComparableValue(
      option?.name || "",
    );

    return (
      optionCode === normalizedCandidate ||
      comparableOptionCode === comparableRawValue ||
      comparableOptionCode === comparableCandidate ||
      comparableOptionName === comparableRawValue
    );
  });

  if (matchedOption?.code) {
    return {
      resolvedValue: String(matchedOption.code),
      noteLine: "",
    };
  }

  const fallbackOption = options.find(
    (option) => String(option?.code || "").trim() === "segun_notas",
  );
  if (fallbackOption?.code) {
    return {
      resolvedValue: String(fallbackOption.code),
      noteLine: buildProviderDocumentImportFallbackNoteLine(
        PROVIDER_DOCUMENT_IMPORT_COMMERCIAL_TERM_FIELD_CONFIG[field]?.label ||
          field,
        rawValue,
      ),
    };
  }

  return {
    resolvedValue: normalizedCandidate,
    noteLine: "",
  };
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
    isRenewal: Boolean(item?.isRenewal),
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
    isRenewal: Boolean(item?.isRenewal),
    bundleParentItemId: toPositiveIntegerOrNull(item?.bundleParentItemId),
    bundleOriginType: item?.bundleOriginType || null,
    sourceProviderPriceListItemId: toPositiveIntegerOrNull(
      item?.sourceProviderPriceListItemId,
    ),
    sourceComponentPriceListItemId: toPositiveIntegerOrNull(
      item?.sourceComponentPriceListItemId,
    ),
    importWarnings: Array.isArray(item?.importWarnings)
      ? item.importWarnings
      : [],
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

      if (!(toNumber(item?.quantity) > 0)) {
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
    importWarnings: Array.isArray(item?.importWarnings)
      ? item.importWarnings
      : [],
    productCode: item?.productCode || "",
    productDescription: item?.productDescription || "",
    itemType: item?.itemType || "producto",
    isRenewal: Boolean(item?.isRenewal),
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
    isRenewal: Boolean(item?.isRenewal),
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
  const [editContactOptions, setEditContactOptions] = useState(
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
  const [approvalRecommendations, setApprovalRecommendations] = useState([]);
  const [
    shouldOpenProviderImportAfterCreate,
    setShouldOpenProviderImportAfterCreate,
  ] = useState(false);
  const [providerDocumentImportState, setProviderDocumentImportState] =
    useState(() => buildProviderDocumentImportState());
  const [
    createProviderDocumentImportResult,
    setCreateProviderDocumentImportResult,
  ] = useState({
    token: 0,
    commercialConditions: null,
  });
  const providerDocumentImportEffectiveItems = useMemo(
    () =>
      buildProviderDocumentImportEffectiveItems(
        providerDocumentImportState.preview,
        providerDocumentImportState.itemMatchResolutions,
      ),
    [
      providerDocumentImportState.itemMatchResolutions,
      providerDocumentImportState.preview,
    ],
  );
  const providerImportDocuments = useMemo(() => {
    if (providerDocumentImportState.sourceMode === "create_draft") {
      return (providerDocumentImportState.sourceDocuments || [])
        .filter((document) => document?.aiEnabled !== false)
        .map((document) => ({
          id: String(document.localId || document.id || ""),
          originalFileName:
            document.originalFileName || document.file?.name || "Documento",
          aiEnabled: document.aiEnabled !== false,
        }))
        .filter((document) => document.id);
    }

    return (
      Array.isArray(selectedVersion?.allDocuments)
        ? selectedVersion.allDocuments
        : Array.isArray(selectedVersion?.documents)
          ? selectedVersion.documents
          : []
    ).filter((document) => document?.aiEnabled !== false);
  }, [
    providerDocumentImportState.sourceDocuments,
    providerDocumentImportState.sourceMode,
    selectedVersion?.allDocuments,
    selectedVersion?.documents,
  ]);
  const providerDocumentImportWorkflowStage = useMemo(
    () =>
      buildProviderDocumentImportWorkflowStage(
        providerDocumentImportState.preview,
        providerDocumentImportState.itemMatchResolutions,
      ),
    [
      providerDocumentImportState.itemMatchResolutions,
      providerDocumentImportState.preview,
    ],
  );
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
  const [duplicateQuotationModalState, setDuplicateQuotationModalState] =
    useState({
      isOpen: false,
      quotationId: null,
      sourceVersionId: null,
      sourceVersionLabel: "",
      sourceOpportunityId: null,
      targetAccountId: "",
      targetOpportunityId: "",
      error: "",
    });
  const [duplicateTargetOpportunities, setDuplicateTargetOpportunities] =
    useState([]);
  const [
    loadingDuplicateTargetOpportunities,
    setLoadingDuplicateTargetOpportunities,
  ] = useState(false);
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
  const providerDocumentImportPollingTokenRef = useRef(0);
  const loadVersionRef = useRef(null);
  const initialEditSnapshotRef = useRef("");
  const [initialEditSnapshot, setInitialEditSnapshot] = useState("");
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
    // Pricing context changes must update in-progress local item edits.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
          proposalId:
            Number(version.proposalId ?? version.proposal_id ?? 0) || null,
          hasProposal: Boolean(
            version.hasProposal ?? version.has_proposal ?? version.proposalId,
          ),
          proposalStatusCode:
            version.proposalStatusCode ?? version.proposal_status_code ?? null,
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
  const canCreateProviderPrices = quotationPermissions.has(
    "proveedores_precios.create",
  );
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
  const duplicateTargetAccounts = useMemo(
    () =>
      (Array.isArray(accounts) ? accounts : [])
        .map((account) => ({
          id: Number(account?.id || 0),
          name: String(account?.name || "").trim(),
        }))
        .filter((account) => Number(account.id) > 0),
    [accounts],
  );

  const loadDuplicateTargetOpportunitiesForAccount = useCallback(
    async (
      targetAccountId,
      { sourceOpportunityId = null, preserveCurrentSelection = false } = {},
    ) => {
      const normalizedAccountId = Number(targetAccountId || 0);
      if (!normalizedAccountId) {
        setDuplicateTargetOpportunities([]);
        setLoadingDuplicateTargetOpportunities(false);
        return;
      }

      setLoadingDuplicateTargetOpportunities(true);
      try {
        const { data } = await api.get(
          `/api/quotation-accounts/${normalizedAccountId}/opportunities`,
        );

        const nextOpportunities = Array.isArray(data)
          ? data
              .map((opportunity) => ({
                ...opportunity,
                id: Number(opportunity?.id || 0),
                accountId: Number(
                  opportunity?.accountId || normalizedAccountId,
                ),
                sellerUserId: opportunity?.sellerUserId
                  ? Number(opportunity.sellerUserId)
                  : null,
                activationStatusName: String(
                  opportunity?.activationStatusName || "",
                ),
              }))
              .filter(
                (opportunity) =>
                  Number(opportunity.id) > 0 &&
                  normalizeText(opportunity.activationStatusName) ===
                    "activada" &&
                  Number(opportunity.sellerUserId || 0) > 0,
              )
          : [];

        setDuplicateTargetOpportunities(nextOpportunities);
        setDuplicateQuotationModalState((prev) => {
          if (
            !prev.isOpen ||
            Number(prev.targetAccountId || 0) !== normalizedAccountId
          ) {
            return prev;
          }

          const selectedOpportunityId = Number(prev.targetOpportunityId || 0);
          const resolvedSourceOpportunityId = Number(
            sourceOpportunityId || prev.sourceOpportunityId || 0,
          );
          const preserveSelectedOpportunity =
            preserveCurrentSelection &&
            nextOpportunities.some(
              (opportunity) =>
                Number(opportunity.id) === Number(selectedOpportunityId),
            );
          const preferredOpportunity = preserveSelectedOpportunity
            ? nextOpportunities.find(
                (opportunity) =>
                  Number(opportunity.id) === Number(selectedOpportunityId),
              )
            : nextOpportunities.find(
                (opportunity) =>
                  Number(opportunity.id) !== resolvedSourceOpportunityId,
              ) ||
              nextOpportunities[0] ||
              null;

          return {
            ...prev,
            targetOpportunityId: preferredOpportunity
              ? String(preferredOpportunity.id)
              : "",
            error: "",
          };
        });
      } catch (err) {
        setDuplicateTargetOpportunities([]);
        setDuplicateQuotationModalState((prev) => {
          if (
            !prev.isOpen ||
            Number(prev.targetAccountId || 0) !== normalizedAccountId
          ) {
            return prev;
          }

          return {
            ...prev,
            targetOpportunityId: "",
            error: getApiErrorMessage(
              err,
              "No fue posible cargar oportunidades para la cuenta seleccionada",
            ),
          };
        });
      } finally {
        setLoadingDuplicateTargetOpportunities(false);
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadEditContactOptions() {
      const selectedQuotationAccountId = Number(
        selectedQuotation?.accountId ?? selectedQuotation?.account_id ?? 0,
      );
      const fallbackAccountId = Number(accountId || 0);
      const accountIdToLoad =
        selectedQuotationAccountId > 0
          ? selectedQuotationAccountId
          : fallbackAccountId;

      if (!accountIdToLoad) {
        setEditContactOptions(contactOptions || []);
        return;
      }
      try {
        const { data } = await api.get(
          `/api/quotation-accounts/${accountIdToLoad}/contacts`,
        );
        if (cancelled) return;
        setEditContactOptions(
          Array.isArray(data) ? data.map(mapQuotationContactOption) : [],
        );
      } catch {
        if (!cancelled) {
          setEditContactOptions(contactOptions || []);
        }
      }
    }

    loadEditContactOptions();

    return () => {
      cancelled = true;
    };
  }, [
    accountId,
    contactOptions,
    selectedQuotation?.accountId,
    selectedQuotation?.account_id,
  ]);
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
        initialEditSnapshot &&
        currentEditSnapshot &&
        currentEditSnapshot !== initialEditSnapshot,
      ),
    [currentEditSnapshot, initialEditSnapshot, selectedVersion],
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
        const nextOpportunityId = nextSelectedOpportunity
          ? String(nextSelectedOpportunity.id)
          : "";
        const inheritedContactId =
          nextSelectedOpportunity?.contactId &&
          nextContacts.some(
            (contact) =>
              String(contact.id) === String(nextSelectedOpportunity.contactId),
          )
            ? String(nextSelectedOpportunity.contactId)
            : "";

        setCreateSelectedOpportunityId(nextOpportunityId);
        setCreateQuotationForm((prev) => {
          const shouldPreserveQuotedContact =
            String(prev.accountId || "") ===
              String(createSelectedAccountId || "") &&
            String(prev.opportunityId || "") === nextOpportunityId &&
            nextContacts.some(
              (contact) => String(contact.id) === String(prev.contactId),
            );

          return {
            ...prev,
            accountId: String(createSelectedAccountId || ""),
            opportunityId: nextOpportunityId,
            contextContactId: inheritedContactId,
            contactId:
              createCommercialContextConfirmed && shouldPreserveQuotedContact
                ? String(prev.contactId)
                : inheritedContactId,
            sellerUserId: nextSelectedOpportunity?.sellerUserId
              ? String(nextSelectedOpportunity.sellerUserId)
              : "",
            sellerUserName: nextSelectedOpportunity?.sellerUserName || "",
            proposalName:
              String(prev.opportunityId || "") === nextOpportunityId
                ? prev.proposalName
                : nextSelectedOpportunity?.name || "",
          };
        });
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
      const nextSnapshot = buildPersistedQuotationVersionSnapshot({
        selectedVersion: data,
        versionForm: nextVersionForm,
        sectionEdits: nextSectionEdits,
        itemEdits: nextItemEdits,
        inclusionTypes: catalogs.inclusionTypes,
      });
      initialEditSnapshotRef.current = nextSnapshot;
      setInitialEditSnapshot(nextSnapshot);
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
      const nextSnapshot = buildPersistedQuotationVersionSnapshot({
        selectedVersion: data,
        versionForm: nextVersionForm,
        sectionEdits: nextSectionEdits,
        itemEdits: nextItemEdits,
        inclusionTypes: catalogs.inclusionTypes,
      });
      initialEditSnapshotRef.current = nextSnapshot;
      setInitialEditSnapshot(nextSnapshot);
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

  const openDuplicateQuotationModal = useCallback(
    async (quotation, selectedVersion) => {
      const sourceVersionId = Number(selectedVersion?.id || 0);
      const sourceOpportunityId = Number(quotation?.opportunityId || 0);
      const sourceAccountId = Number(
        quotation?.accountId || quotation?.account_id || 0,
      );
      const fallbackAccountId = Number(accountId || 0);
      const preferredTargetAccountId =
        sourceAccountId ||
        fallbackAccountId ||
        Number(duplicateTargetAccounts[0]?.id || 0);

      if (!sourceVersionId) {
        setError("Selecciona una version valida para duplicar la cotizacion");
        return;
      }

      setDuplicateTargetOpportunities([]);

      setDuplicateQuotationModalState({
        isOpen: true,
        quotationId: Number(quotation?.id || 0) || null,
        sourceVersionId,
        sourceVersionLabel: `Version ${selectedVersion?.versionNumber || "-"}`,
        sourceOpportunityId: sourceOpportunityId || null,
        targetAccountId: preferredTargetAccountId
          ? String(preferredTargetAccountId)
          : "",
        targetOpportunityId: "",
        error: "",
      });
      setOpenQuotationMenuId(null);

      if (preferredTargetAccountId) {
        await loadDuplicateTargetOpportunitiesForAccount(
          preferredTargetAccountId,
          {
            sourceOpportunityId,
          },
        );
      }
    },
    [
      accountId,
      duplicateTargetAccounts,
      loadDuplicateTargetOpportunitiesForAccount,
    ],
  );

  const closeDuplicateQuotationModal = useCallback(() => {
    setDuplicateQuotationModalState({
      isOpen: false,
      quotationId: null,
      sourceVersionId: null,
      sourceVersionLabel: "",
      sourceOpportunityId: null,
      targetAccountId: "",
      targetOpportunityId: "",
      error: "",
    });
    setDuplicateTargetOpportunities([]);
    setLoadingDuplicateTargetOpportunities(false);
  }, []);

  const handleDuplicateQuotationTargetAccountChange = useCallback(
    (targetAccountId) => {
      const nextTargetAccountId = String(targetAccountId || "");
      setDuplicateQuotationModalState((prev) => ({
        ...prev,
        targetAccountId: nextTargetAccountId,
        targetOpportunityId: "",
        error: "",
      }));

      if (!nextTargetAccountId) {
        setDuplicateTargetOpportunities([]);
        return;
      }

      void loadDuplicateTargetOpportunitiesForAccount(nextTargetAccountId, {
        sourceOpportunityId: Number(
          duplicateQuotationModalState.sourceOpportunityId || 0,
        ),
      });
    },
    [
      duplicateQuotationModalState.sourceOpportunityId,
      loadDuplicateTargetOpportunitiesForAccount,
    ],
  );

  const handleDuplicateQuotationTargetOpportunityChange = useCallback(
    (targetOpportunityId) => {
      setDuplicateQuotationModalState((prev) => ({
        ...prev,
        targetOpportunityId: String(targetOpportunityId || ""),
        error: "",
      }));
    },
    [],
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

  const handleDuplicateQuotation = useCallback(async () => {
    const sourceVersionId = Number(
      duplicateQuotationModalState.sourceVersionId || 0,
    );
    const targetAccountId = Number(
      duplicateQuotationModalState.targetAccountId || 0,
    );
    const targetOpportunityId = Number(
      duplicateQuotationModalState.targetOpportunityId || 0,
    );

    if (!sourceVersionId || !targetAccountId || !targetOpportunityId) {
      setDuplicateQuotationModalState((prev) => ({
        ...prev,
        error: "Selecciona una cuenta y una oportunidad destino validas",
      }));
      return;
    }

    setBusyAction("duplicate-quotation");
    setError("");
    setSuccess("");
    try {
      const { data } = await api.post(
        `/api/quotation-versions/${sourceVersionId}/duplicate`,
        { targetOpportunityId },
      );

      if (Number(opportunityId) !== targetOpportunityId) {
        onOpportunityFocusChange?.(targetOpportunityId);
      }

      await refreshQuotations({
        preferredQuotationId: data?.quotationId,
        preferredVersionId: data?.latestVersionId,
        targetOpportunityId,
      });

      setSuccess(data?.message || "Cotizacion duplicada");
      closeDuplicateQuotationModal();
    } catch (err) {
      const message = getApiErrorMessage(
        err,
        "No fue posible duplicar la cotizacion",
      );
      setDuplicateQuotationModalState((prev) => ({
        ...prev,
        error: message,
      }));
    } finally {
      setBusyAction("");
    }
  }, [
    closeDuplicateQuotationModal,
    duplicateQuotationModalState.targetAccountId,
    duplicateQuotationModalState.sourceVersionId,
    duplicateQuotationModalState.targetOpportunityId,
    onOpportunityFocusChange,
    opportunityId,
    refreshQuotations,
  ]);

  const uploadQuotationDocumentsToVersion = useCallback(
    async (
      versionId,
      files,
      { syncSelectedVersion = true, clearMessages = true } = {},
    ) => {
      const normalizedFiles = Array.isArray(files)
        ? files
            .map((entry) => (entry?.file instanceof Blob ? entry.file : entry))
            .filter(Boolean)
        : [];

      if (!versionId || !normalizedFiles.length) {
        return { ok: false, message: "No hay documentos para cargar" };
      }

      if (clearMessages) {
        setError("");
        setSuccess("");
      }

      try {
        setBusyAction("upload-quotation-documents");
        const formData = new FormData();
        normalizedFiles.forEach((file) => {
          formData.append("files", file);
        });

        const { data } = await api.post(
          `/api/quotation-versions/${versionId}/documents`,
          formData,
          {
            headers: { "Content-Type": "multipart/form-data" },
          },
        );

        if (syncSelectedVersion) {
          setSelectedVersion((prev) =>
            Number(prev?.id) === Number(versionId)
              ? mergeVersionDocuments(prev, data.documents, data.allDocuments)
              : prev,
          );
        }

        return {
          ok: true,
          message: data.message || "Documentos cargados",
          data,
        };
      } catch (err) {
        return {
          ok: false,
          message: getApiErrorMessage(err, "No fue posible cargar documentos"),
        };
      } finally {
        setBusyAction("");
      }
    },
    [],
  );

  const syncUploadedQuotationDocumentAiEligibility = useCallback(
    async (uploadedDocuments, pendingDocuments) => {
      const excludedPendingDocuments = Array.isArray(pendingDocuments)
        ? pendingDocuments.filter((document) => document?.aiEnabled === false)
        : [];

      if (
        !excludedPendingDocuments.length ||
        !Array.isArray(uploadedDocuments)
      ) {
        return { ok: true };
      }

      const uploadedDocumentsByKey = new Map();
      uploadedDocuments.forEach((document) => {
        const documentKey = `${String(document?.originalFileName || "").trim()}::${Number(document?.byteSize || 0)}`;
        const queuedDocuments = uploadedDocumentsByKey.get(documentKey) || [];
        queuedDocuments.push(document);
        uploadedDocumentsByKey.set(documentKey, queuedDocuments);
      });

      try {
        for (const pendingDocument of excludedPendingDocuments) {
          const pendingDocumentKey = `${String(pendingDocument?.originalFileName || pendingDocument?.file?.name || "").trim()}::${Number(pendingDocument?.byteSize || pendingDocument?.file?.size || 0)}`;
          const matchingDocuments =
            uploadedDocumentsByKey.get(pendingDocumentKey) || [];
          const matchedDocument = matchingDocuments.shift();
          if (!matchedDocument?.id) {
            continue;
          }

          await api.patch(
            `/api/quotation-version-documents/${matchedDocument.id}/ai-eligibility`,
            { aiEnabled: false },
          );
        }

        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          message: getApiErrorMessage(
            err,
            "No fue posible conservar la configuracion de IA de los documentos",
          ),
        };
      }
    },
    [],
  );

  const handleCreateQuotation = useCallback(
    async (createQuotationOptions = {}) => {
      setBusyAction("create-quotation");
      setError("");
      setSuccess("");
      try {
        const createdOpportunityId = Number(createQuotationForm.opportunityId);
        const openProviderImportAfterCreate = Boolean(
          createQuotationOptions.openProviderImportAfterCreate,
        );
        const normalizedSummaryDiscountInput =
          createQuotationOptions.summaryDiscountInput || null;
        const normalizedSummaryMeta =
          createQuotationOptions.summaryMeta || null;
        const normalizedInternalNotes =
          createQuotationOptions.internalNotes ?? "";
        const normalizedCommercialConditions =
          createQuotationOptions.commercialConditions || null;
        const pendingDocuments = Array.isArray(
          createQuotationOptions.pendingDocuments,
        )
          ? createQuotationOptions.pendingDocuments
          : [];
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
        const documentUploadResult =
          pendingDocuments.length && data.latestVersionId
            ? await uploadQuotationDocumentsToVersion(
                data.latestVersionId,
                pendingDocuments,
                { syncSelectedVersion: false, clearMessages: false },
              )
            : null;
        const documentAiSyncResult = documentUploadResult?.ok
          ? await syncUploadedQuotationDocumentAiEligibility(
              documentUploadResult.data?.documents,
              pendingDocuments,
            )
          : null;
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
        setQuotationStatusFilter("all");
        setQuotationQuery("");
        setQuotationSort({
          field: "id",
          direction: "desc",
        });
        setQuotationsPage(1);
        if (
          openProviderImportAfterCreate &&
          data.quotationId &&
          data.latestVersionId
        ) {
          await loadVersion(data.quotationId, data.latestVersionId, {
            preserveMessage: true,
          });
        }
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
        if (openProviderImportAfterCreate) {
          setShouldOpenProviderImportAfterCreate(true);
        }
        closeCreateQuotationModal();
        if (documentUploadResult && !documentUploadResult.ok) {
          setError(
            `Cotizacion creada, pero ${String(
              documentUploadResult.message ||
                "no fue posible cargar los documentos adjuntos",
            )}`,
          );
          return;
        }
        if (documentAiSyncResult && !documentAiSyncResult.ok) {
          setError(
            `Cotizacion creada, pero ${String(
              documentAiSyncResult.message ||
                "no fue posible conservar la configuracion de IA de los documentos",
            )}`,
          );
          return;
        }

        if (!openProviderImportAfterCreate) {
          setSuccess(
            documentUploadResult?.ok
              ? "Cotizacion creada y documentos cargados"
              : data.message || "Cotizacion creada",
          );
        }
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
      loadVersion,
      refreshQuotations,
      syncUploadedQuotationDocumentAiEligibility,
      onOpportunityFocusChange,
      opportunityId,
      uploadQuotationDocumentsToVersion,
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
      accountId: String(nextAccountId || ""),
      opportunityId: "",
      proposalName: "",
      sellerUserId: "",
      sellerUserName: "",
      contextContactId: "",
      contactId: "",
    }));
  }, []);

  const handleCreateOpportunityChange = useCallback(
    (nextOpportunityId) => {
      const nextSelectedOpportunity = createOpportunities.find(
        (item) => String(item.id) === String(nextOpportunityId),
      );
      const inheritedContactId =
        nextSelectedOpportunity?.contactId &&
        createContactOptions.some(
          (contact) =>
            String(contact.id) === String(nextSelectedOpportunity.contactId),
        )
          ? String(nextSelectedOpportunity.contactId)
          : "";

      setCreateCommercialContextConfirmed(false);
      setCreateSelectedOpportunityId(nextOpportunityId);
      setCreateQuotationForm((prev) => ({
        ...prev,
        opportunityId: String(nextOpportunityId || ""),
        proposalName: nextSelectedOpportunity?.name || "",
        sellerUserId: nextSelectedOpportunity?.sellerUserId
          ? String(nextSelectedOpportunity.sellerUserId)
          : "",
        sellerUserName: nextSelectedOpportunity?.sellerUserName || "",
        contextContactId: inheritedContactId,
        contactId: inheritedContactId,
      }));
    },
    [createContactOptions, createOpportunities],
  );

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

  const handleCreateManualBundleFromTemplate = useCallback(
    (sectionIndex, templateProduct) => {
      const section = createSectionDrafts[sectionIndex];
      if (!section?.localId) return [];

      const selectedIds = createSelectedItemIdsBySection[section.localId] || [];
      const selection = getCreateManualBundleSelection(
        section.items || [],
        selectedIds,
      );

      if (!selection.ok) {
        setError(selection.message);
        return [];
      }

      if (
        !templateProduct ||
        templateProduct.itemType === "grupo_productos" ||
        !String(templateProduct.code || "").trim() ||
        !String(templateProduct.description || "").trim() ||
        !Number(templateProduct.providerId)
      ) {
        setError(
          "Selecciona una plantilla valida para crear el padre del bundle.",
        );
        return [];
      }

      const createdIds = [];
      setCreateSectionDrafts((prev) =>
        prev.map((currentSection, currentSectionIndex) => {
          if (currentSectionIndex !== sectionIndex) {
            return currentSection;
          }

          const currentItems = currentSection.items || [];
          const currentSelectedSet = new Set(selectedIds);
          const firstSelectedIndex = currentItems.findIndex((item) =>
            currentSelectedSet.has(item.localId),
          );
          if (firstSelectedIndex < 0) {
            return currentSection;
          }

          const parentLocalId = `draft-item-${createItemDraftSequenceRef.current++}`;
          const normalizedParentItem = {
            id: null,
            localId: parentLocalId,
            providerId: String(templateProduct.providerId || ""),
            productCode: String(templateProduct.code || "").trim(),
            productDescription: String(
              templateProduct.description || "",
            ).trim(),
            quantity: "1",
            originalCurrencyCode: "USD",
            originalListPriceUnit: "0",
            listPriceUnit: "0",
            manufacturerDiscountPct: "0",
            importCostPct: "0",
            profitMarginPct: "0",
            finalDiscountPct: "0",
            itemType: "grupo_productos",
            isRenewal: false,
            bundleParentLocalId: null,
            bundleOriginType: "manual_bundle",
            sourceProviderPriceListItemId: null,
            sourceComponentPriceListItemId: null,
            bundleComponentItemId: null,
            isBundleComponent: false,
          };
          const normalizedComponentItems = selection.items.map((item) => ({
            ...normalizeCreateBundleComponentAsManual(item, parentLocalId),
          }));

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

          createdIds.push(
            parentLocalId,
            ...normalizedComponentItems.map((item) => item.localId),
          );

          return {
            ...currentSection,
            items: nextItems,
          };
        }),
      );

      if (createdIds.length) {
        setCreateSelectedItemIdsBySection((prev) => ({
          ...prev,
          [section.localId]: createdIds,
        }));
        setError("");
        setSuccess("Bundle creado desde plantilla");
      }

      return createdIds;
    },
    [createSectionDrafts, createSelectedItemIdsBySection],
  );

  const handleApplyCreateSectionItemSaleAdjustment = useCallback(
    (sectionIndex, itemLocalId, nextItem) => {
      const section = createSectionDrafts[sectionIndex];
      if (!section?.localId || !itemLocalId || !nextItem) return false;

      let wasUpdated = false;
      setCreateSectionDrafts((prev) =>
        prev.map((currentSection, currentSectionIndex) => {
          if (currentSectionIndex !== sectionIndex) {
            return currentSection;
          }

          return {
            ...currentSection,
            items: (currentSection.items || []).map((item) => {
              if (String(item.localId) !== String(itemLocalId)) {
                return item;
              }

              wasUpdated = true;
              return syncQuotationItemDraftPricing(nextItem, {
                currencyCode: createQuotationForm.currencyCode,
                exchangeRate: createQuotationForm.exchangeRate,
              });
            }),
          };
        }),
      );

      if (wasUpdated) {
        setError("");
        setSuccess("Precio de venta ajustado");
      }

      return wasUpdated;
    },
    [
      createQuotationForm.currencyCode,
      createQuotationForm.exchangeRate,
      createSectionDrafts,
    ],
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
              nextItems.push(...normalizedSelectedComponentItems);
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

  const handleUploadQuotationDocuments = useCallback(
    async (files) => {
      if (!selectedVersionId || !Array.isArray(files) || !files.length) {
        return false;
      }

      const result = await uploadQuotationDocumentsToVersion(
        selectedVersionId,
        files,
      );
      if (result.ok) {
        setSuccess(result.message || "Documentos cargados");
        return true;
      }

      setError(result.message || "No fue posible cargar documentos");
      return false;
    },
    [selectedVersionId, uploadQuotationDocumentsToVersion],
  );

  const handleSetQuotationDocumentAiEnabled = useCallback(
    async (documentLinkId, aiEnabled) => {
      if (!documentLinkId) {
        return false;
      }

      setError("");
      setSuccess("");
      try {
        setBusyAction(`toggle-quotation-document-ai-${documentLinkId}`);
        const { data } = await api.patch(
          `/api/quotation-version-documents/${documentLinkId}/ai-eligibility`,
          { aiEnabled: Boolean(aiEnabled) },
        );

        setSelectedVersion((prev) =>
          mergeVersionDocuments(prev, data.documents, data.allDocuments),
        );
        setSuccess(
          data.message ||
            (aiEnabled
              ? "Documento habilitado para IA"
              : "Documento excluido de IA"),
        );
        return true;
      } catch (err) {
        setError(
          getApiErrorMessage(
            err,
            "No fue posible actualizar el estado de IA del documento",
          ),
        );
        return false;
      } finally {
        setBusyAction("");
      }
    },
    [],
  );

  const openProviderDocumentImportModal = useCallback(() => {
    providerDocumentImportPollingTokenRef.current += 1;
    const allDocuments = Array.isArray(selectedVersion?.allDocuments)
      ? selectedVersion.allDocuments
      : Array.isArray(selectedVersion?.documents)
        ? selectedVersion.documents
        : [];
    const eligibleDocuments = allDocuments.filter(
      (document) => document?.aiEnabled !== false,
    );
    const defaultDocumentId = eligibleDocuments[0]?.id || "";
    setProviderDocumentImportState({
      ...buildProviderDocumentImportState(defaultDocumentId),
      isOpen: true,
    });
  }, [selectedVersion]);

  const openCreateProviderDocumentImportModal = useCallback(
    ({ documents = [], commercialConditions = null } = {}) => {
      providerDocumentImportPollingTokenRef.current += 1;

      const eligibleDocuments = (Array.isArray(documents) ? documents : [])
        .filter((document) => document?.aiEnabled !== false && document?.file)
        .map((document) => ({
          ...document,
          localId: String(document.localId || "").trim(),
        }))
        .filter((document) => document.localId);

      if (!eligibleDocuments.length) {
        setError(
          "Adjunta al menos un documento habilitado para IA antes de importar.",
        );
        return false;
      }

      const defaultDocumentId = eligibleDocuments[0]?.localId || "";
      setError("");
      setSuccess("");
      setProviderDocumentImportState({
        ...buildProviderDocumentImportState(defaultDocumentId, {
          sourceMode: "create_draft",
          sourceDocuments: eligibleDocuments,
          draftPricingContext: commercialConditions,
        }),
        isOpen: true,
      });
      return true;
    },
    [],
  );

  useEffect(() => {
    if (
      !shouldOpenProviderImportAfterCreate ||
      !selectedVersion?.id ||
      !Array.isArray(selectedVersion?.allDocuments) ||
      !selectedVersion.allDocuments.length
    ) {
      return;
    }

    openProviderDocumentImportModal();
    setShouldOpenProviderImportAfterCreate(false);
  }, [
    openProviderDocumentImportModal,
    selectedVersion,
    shouldOpenProviderImportAfterCreate,
  ]);

  const closeProviderDocumentImportModal = useCallback(() => {
    providerDocumentImportPollingTokenRef.current += 1;
    setProviderDocumentImportState(buildProviderDocumentImportState());
  }, []);

  const setProviderDocumentImportDocument = useCallback((documentId) => {
    providerDocumentImportPollingTokenRef.current += 1;
    setProviderDocumentImportState((current) => ({
      ...current,
      selectedDocumentId: String(documentId || ""),
      preview: null,
      previewJob: null,
      loadingPreview: false,
      creatingMissingItems: false,
      creatingSuggestedMatchPreviewId: "",
      suggestedMatchFeedbackByPreviewId: {},
      applying: false,
      commercialTermsSelection:
        buildProviderDocumentImportCommercialTermsSelection(),
      commercialClausesSelection: {},
      itemMatchResolutions: {},
      missingItemsSelection: {},
      transferableWarningsSelection: {},
    }));
  }, []);

  const setProviderDocumentImportProvider = useCallback((providerId) => {
    providerDocumentImportPollingTokenRef.current += 1;
    setProviderDocumentImportState((current) => ({
      ...current,
      confirmedProviderId: String(providerId || ""),
      preview: null,
      previewJob: null,
      loadingPreview: false,
      creatingMissingItems: false,
      creatingSuggestedMatchPreviewId: "",
      suggestedMatchFeedbackByPreviewId: {},
      applying: false,
      commercialTermsSelection:
        buildProviderDocumentImportCommercialTermsSelection(),
      commercialClausesSelection: {},
      itemMatchResolutions: {},
      missingItemsSelection: {},
      transferableWarningsSelection: {},
    }));
  }, []);

  const setProviderDocumentImportCommercialTermSelection = useCallback(
    (field, value) => {
      if (!PROVIDER_DOCUMENT_IMPORT_COMMERCIAL_TERM_KEYS.includes(field)) {
        return;
      }
      setProviderDocumentImportState((current) => ({
        ...current,
        commercialTermsSelection: {
          ...current.commercialTermsSelection,
          [field]: Boolean(value),
        },
      }));
    },
    [],
  );

  const setProviderDocumentImportCommercialClauseSelection = useCallback(
    (clauseId, value) => {
      const normalizedClauseId = String(clauseId || "").trim();
      if (!normalizedClauseId) {
        return;
      }

      setProviderDocumentImportState((current) => ({
        ...current,
        commercialClausesSelection: {
          ...(current.commercialClausesSelection || {}),
          [normalizedClauseId]: Boolean(value),
        },
      }));
    },
    [],
  );

  const setProviderDocumentImportMissingItemSelection = useCallback(
    (previewId, value) => {
      const normalizedPreviewId = String(previewId || "").trim();
      if (!normalizedPreviewId) {
        return;
      }
      setProviderDocumentImportState((current) => ({
        ...current,
        missingItemsSelection: {
          ...current.missingItemsSelection,
          [normalizedPreviewId]: Boolean(value),
        },
      }));
    },
    [],
  );

  const setProviderDocumentImportTransferableWarningSelection = useCallback(
    (previewId, warning, value) => {
      const warningKey = buildProviderDocumentImportTransferableWarningKey(
        previewId,
        warning,
      );
      if (!warningKey || !warningKey.includes("::")) {
        return;
      }

      setProviderDocumentImportState((current) => ({
        ...current,
        transferableWarningsSelection: {
          ...current.transferableWarningsSelection,
          [warningKey]: Boolean(value),
        },
      }));
    },
    [],
  );

  const setProviderDocumentImportSuggestedMatchCandidate = useCallback(
    (previewId, candidateId) => {
      const normalizedPreviewId = String(previewId || "").trim();
      if (!normalizedPreviewId) {
        return;
      }

      setProviderDocumentImportState((current) => ({
        ...current,
        itemMatchResolutions: {
          ...current.itemMatchResolutions,
          [normalizedPreviewId]: {
            ...current.itemMatchResolutions[normalizedPreviewId],
            selectedSuggestedPriceListItemId: candidateId
              ? Number(candidateId)
              : null,
          },
        },
      }));
    },
    [],
  );

  const setProviderDocumentImportSuggestedMatchResolution = useCallback(
    (previewId, action) => {
      const normalizedPreviewId = String(previewId || "").trim();
      const normalizedAction = String(action || "").trim();
      if (!normalizedPreviewId) {
        return;
      }

      setProviderDocumentImportState((current) => {
        const previewItems = Array.isArray(current.preview?.items)
          ? current.preview.items
          : [];
        const previewItem = previewItems.find(
          (item) => String(item.previewId) === normalizedPreviewId,
        );
        if (!previewItem) {
          return current;
        }

        const suggestedMatchCandidates = Array.isArray(
          previewItem.suggestedMatchCandidates,
        )
          ? previewItem.suggestedMatchCandidates
          : [];
        const currentResolution =
          current.itemMatchResolutions[normalizedPreviewId] || {};
        const fallbackCandidateId =
          currentResolution.selectedSuggestedPriceListItemId ||
          (suggestedMatchCandidates.length === 1
            ? Number(suggestedMatchCandidates[0].id)
            : null);

        const nextItemMatchResolutions = {
          ...current.itemMatchResolutions,
        };
        if (
          normalizedAction === "use_existing" &&
          Number(fallbackCandidateId || 0) > 0
        ) {
          nextItemMatchResolutions[normalizedPreviewId] = {
            action: "use_existing",
            selectedSuggestedPriceListItemId: Number(fallbackCandidateId),
          };
        } else if (normalizedAction === "treat_as_missing") {
          nextItemMatchResolutions[normalizedPreviewId] = {
            action: "treat_as_missing",
            selectedSuggestedPriceListItemId: null,
          };
        } else {
          delete nextItemMatchResolutions[normalizedPreviewId];
        }

        const nextMissingItemsSelection = {
          ...current.missingItemsSelection,
        };
        if (
          normalizedAction === "treat_as_missing" &&
          previewItem.canCreateInPriceList
        ) {
          nextMissingItemsSelection[normalizedPreviewId] = true;
        }
        if (normalizedAction === "use_existing") {
          delete nextMissingItemsSelection[normalizedPreviewId];
        }

        const nextSuggestedMatchFeedbackByPreviewId = {
          ...current.suggestedMatchFeedbackByPreviewId,
        };
        delete nextSuggestedMatchFeedbackByPreviewId[normalizedPreviewId];

        return {
          ...current,
          itemMatchResolutions: nextItemMatchResolutions,
          missingItemsSelection: nextMissingItemsSelection,
          suggestedMatchFeedbackByPreviewId:
            nextSuggestedMatchFeedbackByPreviewId,
        };
      });
    },
    [],
  );

  const handlePreviewProviderDocumentImport = useCallback(async () => {
    const isCreateDraftImport =
      providerDocumentImportState.sourceMode === "create_draft";

    if (!providerDocumentImportState.selectedDocumentId) {
      setError("Selecciona un documento para analizar.");
      return false;
    }

    if (!isCreateDraftImport && !selectedVersionId) {
      setError("Selecciona una version valida para analizar el documento.");
      return false;
    }

    providerDocumentImportPollingTokenRef.current += 1;
    const pollingToken = providerDocumentImportPollingTokenRef.current;

    setProviderDocumentImportState((current) => ({
      ...current,
      preview: null,
      previewJob: null,
      loadingPreview: true,
    }));
    setError("");
    setSuccess("");

    try {
      let data = null;
      if (isCreateDraftImport) {
        const selectedDocument = (
          providerDocumentImportState.sourceDocuments || []
        ).find(
          (document) =>
            String(document.localId || document.id || "") ===
            String(providerDocumentImportState.selectedDocumentId),
        );
        if (!selectedDocument?.file) {
          throw new Error(
            "No fue posible resolver el archivo seleccionado para analizar.",
          );
        }

        const formData = new FormData();
        formData.append("file", selectedDocument.file);
        if (providerDocumentImportState.confirmedProviderId) {
          formData.append(
            "providerId",
            String(providerDocumentImportState.confirmedProviderId),
          );
        }

        ({ data } = await api.post(
          "/api/quotation-create/provider-document-import/preview",
          formData,
          {
            timeout: PROVIDER_DOCUMENT_IMPORT_REQUEST_TIMEOUT_MS,
          },
        ));
      } else {
        ({ data } = await api.post(
          `/api/quotation-versions/${selectedVersionId}/provider-document-import/preview`,
          {
            documentLinkId: Number(
              providerDocumentImportState.selectedDocumentId,
            ),
            providerId: providerDocumentImportState.confirmedProviderId
              ? Number(providerDocumentImportState.confirmedProviderId)
              : null,
          },
          {
            timeout: PROVIDER_DOCUMENT_IMPORT_REQUEST_TIMEOUT_MS,
          },
        ));
      }

      let resolvedData = data;
      setProviderDocumentImportState((current) => ({
        ...current,
        previewJob: buildProviderDocumentImportPreviewJobState(resolvedData),
      }));

      if (!resolvedData?.result) {
        const jobId = String(resolvedData?.job?.id || "").trim();
        if (!jobId) {
          throw new Error(
            "No fue posible obtener el identificador del job de analisis",
          );
        }

        const deadline =
          Date.now() + PROVIDER_DOCUMENT_IMPORT_TOTAL_POLL_TIMEOUT_MS;
        let nextDelay = Math.max(
          Number(
            resolvedData?.job?.pollAfterMs ||
              PROVIDER_DOCUMENT_IMPORT_JOB_POLL_INTERVAL_MS,
          ),
          0,
        );

        while (providerDocumentImportPollingTokenRef.current === pollingToken) {
          if (Date.now() >= deadline) {
            resolvedData = {
              error: {
                code: "poll_timeout",
                message:
                  "El analisis del documento sigue tardando mas de 5 minutos. Puedes intentarlo de nuevo desde el modal.",
              },
            };
            break;
          }

          if (nextDelay > 0) {
            await new Promise((resolve) => {
              window.setTimeout(resolve, nextDelay);
            });
          }

          if (providerDocumentImportPollingTokenRef.current !== pollingToken) {
            return false;
          }

          const pollUrl = isCreateDraftImport
            ? `/api/quotation-create/provider-document-import/preview/jobs/${jobId}`
            : `/api/quotation-versions/${selectedVersionId}/provider-document-import/preview/jobs/${jobId}`;

          const pollResponse = await api.get(
            pollUrl,
            {
              timeout: PROVIDER_DOCUMENT_IMPORT_REQUEST_TIMEOUT_MS,
            },
          );
          resolvedData = pollResponse.data;

          setProviderDocumentImportState((current) => ({
            ...current,
            previewJob: buildProviderDocumentImportPreviewJobState(
              resolvedData,
              current.previewJob,
            ),
          }));

          if (resolvedData?.result) {
            break;
          }

          const jobStatus = String(resolvedData?.job?.status || "");
          if (["failed", "stale", "expired"].includes(jobStatus)) {
            break;
          }

          nextDelay = Math.max(
            Number(
              resolvedData?.job?.pollAfterMs ||
                PROVIDER_DOCUMENT_IMPORT_JOB_POLL_INTERVAL_MS,
            ),
            0,
          );
          nextDelay = Math.min(nextDelay, Math.max(deadline - Date.now(), 0));
        }
      }

      if (providerDocumentImportPollingTokenRef.current !== pollingToken) {
        return false;
      }

      if (!resolvedData?.result) {
        setError(
          String(resolvedData?.error?.message || "").trim() ||
            "No fue posible analizar el documento del proveedor",
        );
        return false;
      }

      setProviderDocumentImportState((current) => ({
        ...current,
        preview: resolvedData.result,
        previewJob: buildProviderDocumentImportPreviewJobState(
          resolvedData,
          current.previewJob,
        ),
        creatingMissingItems: false,
        creatingSuggestedMatchPreviewId: "",
        suggestedMatchFeedbackByPreviewId: {},
        confirmedProviderId: current.confirmedProviderId
          ? current.confirmedProviderId
          : resolvedData.result.confirmedProvider?.id
            ? String(resolvedData.result.confirmedProvider.id)
            : "",
        commercialTermsSelection:
          buildProviderDocumentImportCommercialTermsSelection(),
        commercialClausesSelection:
          buildProviderDocumentImportCommercialClausesSelection(
            resolvedData.result,
            {},
          ),
        itemMatchResolutions: {},
        missingItemsSelection: buildProviderDocumentImportMissingItemsSelection(
          resolvedData.result,
          {},
        ),
        transferableWarningsSelection: {},
      }));
      return true;
    } catch (err) {
      if (providerDocumentImportPollingTokenRef.current === pollingToken) {
        setError(
          getApiErrorMessage(
            err,
            "No fue posible analizar el documento del proveedor",
          ),
        );
      }
      return false;
    } finally {
      if (providerDocumentImportPollingTokenRef.current === pollingToken) {
        setProviderDocumentImportState((current) => ({
          ...current,
          loadingPreview: false,
        }));
      }
    }
  }, [
    providerDocumentImportState.confirmedProviderId,
    providerDocumentImportState.sourceDocuments,
    providerDocumentImportState.sourceMode,
    providerDocumentImportState.selectedDocumentId,
    selectedVersionId,
  ]);

  const handleCreateSuggestedProviderDocumentImportItem = useCallback(
    async (previewId) => {
      const normalizedPreviewId = String(previewId || "").trim();
      const setSuggestedMatchRowFeedback = (type, message) => {
        if (!normalizedPreviewId) {
          return;
        }

        setProviderDocumentImportState((current) => ({
          ...current,
          creatingSuggestedMatchPreviewId: "",
          suggestedMatchFeedbackByPreviewId: {
            ...current.suggestedMatchFeedbackByPreviewId,
            [normalizedPreviewId]:
              buildProviderDocumentImportSuggestedMatchFeedbackEntry(
                type,
                message,
              ),
          },
        }));
      };
      const resolvedDocumentLinkId = Number(
        providerDocumentImportState.selectedDocumentId ||
          providerDocumentImportState.previewJob?.request?.documentLinkId ||
          0,
      );
      const isCreateDraftImport =
        providerDocumentImportState.sourceMode === "create_draft";
      const resolvedConfirmedProviderId = Number(
        providerDocumentImportState.confirmedProviderId ||
          providerDocumentImportState.previewJob?.request?.providerId ||
          providerDocumentImportState.preview?.confirmedProvider?.id ||
          0,
      );

      if (
        !providerDocumentImportState.preview ||
        (!isCreateDraftImport && !resolvedDocumentLinkId) ||
        (!isCreateDraftImport && !selectedVersionId) ||
        !resolvedConfirmedProviderId ||
        !normalizedPreviewId
      ) {
        setSuggestedMatchRowFeedback(
          "error",
          "Confirma documento, proveedor y analisis antes de crear el item.",
        );
        return false;
      }

      const targetItem = providerDocumentImportEffectiveItems.find(
        (item) => String(item.previewId) === normalizedPreviewId,
      );
      if (!targetItem || !targetItem.canCreateInPriceList) {
        setSuggestedMatchRowFeedback(
          "error",
          "Este item ya no se puede crear en la lista del proveedor. Actualiza el analisis e intentalo de nuevo.",
        );
        return false;
      }

      const requestItem = buildProviderDocumentImportCreateMissingItemPayload(
        targetItem,
        {
          resolutionAction: "treat_as_missing",
          selectedSuggestedPriceListItemId: null,
        },
      );
      if (!requestItem) {
        setSuggestedMatchRowFeedback(
          "error",
          "No fue posible preparar el item para su creacion.",
        );
        return false;
      }

      setProviderDocumentImportState((current) => ({
        ...current,
        creatingSuggestedMatchPreviewId: normalizedPreviewId,
        suggestedMatchFeedbackByPreviewId: {
          ...current.suggestedMatchFeedbackByPreviewId,
          [normalizedPreviewId]: null,
        },
      }));
      setError("");
      setSuccess("");

      try {
        const endpoint = isCreateDraftImport
          ? "/api/quotation-create/provider-document-import/create-missing-items"
          : `/api/quotation-versions/${selectedVersionId}/provider-document-import/create-missing-items`;
        const payload = isCreateDraftImport
          ? {
              confirmedProviderId: resolvedConfirmedProviderId,
              items: [requestItem],
            }
          : {
              documentLinkId: resolvedDocumentLinkId,
              confirmedProviderId: resolvedConfirmedProviderId,
              items: [requestItem],
            };

        const { data } = await api.post(endpoint, payload, {
          timeout: PROVIDER_DOCUMENT_IMPORT_REQUEST_TIMEOUT_MS,
        });

        setProviderDocumentImportState((current) => {
          const createdItemRecord = Array.isArray(data.createdItems)
            ? data.createdItems.find(
                (item) => String(item?.previewId || "") === normalizedPreviewId,
              ) || null
            : null;
          const successMode = createdItemRecord?.reused
            ? "reused_pending_confirmation"
            : "created";
          const nextPreview = createdItemRecord?.reused
            ? patchProviderDocumentImportPreviewWithSelectedSuggestedCandidate(
                current.preview,
                {
                  previewId: normalizedPreviewId,
                  selectedSuggestedPriceListItemId:
                    createdItemRecord.createdPriceListItemId,
                  providerCode: createdItemRecord.providerCode,
                  productDescription: targetItem.productDescription,
                },
              )
            : patchProviderDocumentImportPreviewWithCreatedItems(
                data.preview || current.preview,
                data.createdItems,
                current.preview,
              );
          const nextItemMatchResolutions = {
            ...pruneProviderDocumentImportItemMatchResolutions(
              nextPreview,
              current.itemMatchResolutions,
            ),
          };
          if (createdItemRecord?.reused) {
            nextItemMatchResolutions[normalizedPreviewId] = {
              ...nextItemMatchResolutions[normalizedPreviewId],
              selectedSuggestedPriceListItemId:
                createdItemRecord.createdPriceListItemId,
            };
          } else {
            delete nextItemMatchResolutions[normalizedPreviewId];
          }

          const nextMissingItemsSelection = {
            ...current.missingItemsSelection,
          };
          delete nextMissingItemsSelection[normalizedPreviewId];

          return {
            ...current,
            preview: nextPreview,
            creatingSuggestedMatchPreviewId: "",
            itemMatchResolutions: nextItemMatchResolutions,
            suggestedMatchFeedbackByPreviewId: {
              ...current.suggestedMatchFeedbackByPreviewId,
              [normalizedPreviewId]:
                buildProviderDocumentImportSuggestedMatchFeedbackEntry(
                  "success",
                  createdItemRecord?.reused
                    ? "Este item ya existe en la lista activa. Se preselecciono para que puedas confirmarlo con usar existente."
                    : data.message || "Item creado en la lista del proveedor",
                  successMode,
                ),
            },
            missingItemsSelection: createdItemRecord?.reused
              ? nextMissingItemsSelection
              : buildProviderDocumentImportMissingItemsSelection(
                  nextPreview,
                  nextItemMatchResolutions,
                  current.missingItemsSelection,
                ),
          };
        });
        return true;
      } catch (err) {
        const rowMessage = getApiErrorMessage(
          err,
          "No fue posible crear el item en la lista del proveedor",
        );
        setProviderDocumentImportState((current) => ({
          ...current,
          suggestedMatchFeedbackByPreviewId: {
            ...current.suggestedMatchFeedbackByPreviewId,
            [normalizedPreviewId]:
              buildProviderDocumentImportSuggestedMatchFeedbackEntry(
                "error",
                rowMessage,
              ),
          },
        }));
        return false;
      } finally {
        setProviderDocumentImportState((current) => ({
          ...current,
          creatingSuggestedMatchPreviewId: "",
        }));
      }
    },
    [
      providerDocumentImportEffectiveItems,
      providerDocumentImportState.confirmedProviderId,
      providerDocumentImportState.preview,
      providerDocumentImportState.selectedDocumentId,
      providerDocumentImportState.sourceMode,
      selectedVersionId,
    ],
  );

  const handleCreateMissingProviderDocumentImportItems =
    useCallback(async () => {
      const isCreateDraftImport =
        providerDocumentImportState.sourceMode === "create_draft";
      if (
        !providerDocumentImportState.preview ||
        (!isCreateDraftImport &&
          !providerDocumentImportState.selectedDocumentId) ||
        (!isCreateDraftImport && !selectedVersionId) ||
        !providerDocumentImportState.confirmedProviderId
      ) {
        setError(
          "Confirma documento, proveedor y analisis antes de crear faltantes.",
        );
        return false;
      }

      const selectedMissingItems = providerDocumentImportEffectiveItems
        .filter(
          (item) =>
            item.effectiveMatchStatus === "missing_in_price_list" &&
            item.canCreateInPriceList &&
            providerDocumentImportState.missingItemsSelection[
              String(item.previewId)
            ],
        )
        .map((item) =>
          buildProviderDocumentImportCreateMissingItemPayload(item),
        )
        .filter(Boolean);

      if (!selectedMissingItems.length) {
        setError(
          "Selecciona al menos un item faltante para crear en la lista del proveedor.",
        );
        return false;
      }

      setProviderDocumentImportState((current) => ({
        ...current,
        creatingMissingItems: true,
      }));
      setError("");
      setSuccess("");

      try {
        const endpoint = isCreateDraftImport
          ? "/api/quotation-create/provider-document-import/create-missing-items"
          : `/api/quotation-versions/${selectedVersionId}/provider-document-import/create-missing-items`;
        const payload = isCreateDraftImport
          ? {
              confirmedProviderId: Number(
                providerDocumentImportState.confirmedProviderId,
              ),
              items: selectedMissingItems,
            }
          : {
              documentLinkId: Number(
                providerDocumentImportState.selectedDocumentId,
              ),
              confirmedProviderId: Number(
                providerDocumentImportState.confirmedProviderId,
              ),
              items: selectedMissingItems,
            };

        const { data } = await api.post(endpoint, payload, {
          timeout: PROVIDER_DOCUMENT_IMPORT_REQUEST_TIMEOUT_MS,
        });

        setProviderDocumentImportState((current) => {
          const nextPreview =
            patchProviderDocumentImportPreviewWithCreatedItems(
              data.preview || current.preview,
              data.createdItems,
              current.preview,
            );
          const nextItemMatchResolutions =
            pruneProviderDocumentImportItemMatchResolutions(
              nextPreview,
              current.itemMatchResolutions,
            );
          return {
            ...current,
            preview: nextPreview,
            creatingMissingItems: false,
            itemMatchResolutions: nextItemMatchResolutions,
            missingItemsSelection:
              buildProviderDocumentImportMissingItemsSelection(
                nextPreview,
                nextItemMatchResolutions,
              ),
          };
        });
        setSuccess(
          data.message || "Items faltantes creados en la lista del proveedor",
        );
        return true;
      } catch (err) {
        setError(
          getApiErrorMessage(
            err,
            "No fue posible crear los items faltantes en la lista del proveedor",
          ),
        );
        return false;
      } finally {
        setProviderDocumentImportState((current) => ({
          ...current,
          creatingMissingItems: false,
        }));
      }
    }, [
      providerDocumentImportState.confirmedProviderId,
      providerDocumentImportEffectiveItems,
      providerDocumentImportState.missingItemsSelection,
      providerDocumentImportState.preview,
      providerDocumentImportState.selectedDocumentId,
      providerDocumentImportState.sourceMode,
      selectedVersionId,
    ]);

  const handleApplyProviderDocumentImport = useCallback(async () => {
    const isCreateDraftImport =
      providerDocumentImportState.sourceMode === "create_draft";
    if (
      !providerDocumentImportState.preview ||
      !providerDocumentImportState.confirmedProviderId ||
      (!isCreateDraftImport &&
        (!selectedVersionId ||
          !selectedQuotationId ||
          !providerDocumentImportState.selectedDocumentId))
    ) {
      setError("Confirma documento, proveedor y analisis antes de aplicar.");
      return false;
    }

    setError("");
    setSuccess("");
    setProviderDocumentImportState((current) => ({
      ...current,
      applying: true,
    }));

    try {
      const matchedItems = providerDocumentImportEffectiveItems.filter(
        (item) => item.effectiveMatchStatus === "matched",
      );
      if (!matchedItems.length) {
        setError(
          "No hay items resueltos contra la lista del proveedor para agregar.",
        );
        return false;
      }

      const selectedCommercialTerms =
        providerDocumentImportState.commercialTermsSelection ||
        buildProviderDocumentImportCommercialTermsSelection();
      const selectedCommercialClauses = (
        Array.isArray(providerDocumentImportState.preview?.commercialClauses)
          ? providerDocumentImportState.preview.commercialClauses
          : []
      ).filter((clause) => {
        const clauseId = String(clause?.clauseId || "").trim();
        if (!clauseId) {
          return false;
        }
        return Boolean(
          providerDocumentImportState.commercialClausesSelection?.[clauseId],
        );
      });
      const selectedCommercialClauseNoteLines =
        buildProviderDocumentImportCommercialClauseNoteLines(
          selectedCommercialClauses,
        );
      const previewCommercialTerms =
        providerDocumentImportState.preview?.commercialTerms || {};
      const fallbackCurrencyCode = isCreateDraftImport
        ? String(
            providerDocumentImportState.draftPricingContext?.currencyCode ||
              "USD",
          )
        : versionForm.currencyCode;
      const fallbackExchangeRate = isCreateDraftImport
        ? String(
            providerDocumentImportState.draftPricingContext?.exchangeRate ||
              "1.0000",
          )
        : versionForm.exchangeRate;
      const nextVersionCurrencyCode =
        selectedCommercialTerms.currencyCode &&
        String(previewCommercialTerms.currencyCode || "").trim()
          ? String(previewCommercialTerms.currencyCode || "")
              .trim()
              .toUpperCase()
          : fallbackCurrencyCode;

      const importedDraftItems = matchedItems.map((item) => ({
        ...buildProviderDocumentImportLocalItem(
          item,
          {
            currencyCode: nextVersionCurrencyCode,
            exchangeRate: fallbackExchangeRate,
          },
          {
            providerId:
              providerDocumentImportState.confirmedProviderId ||
              providerDocumentImportState.preview?.confirmedProvider?.id ||
              "",
          },
        ),
        productDescription: appendProviderDocumentImportWarningsToDescription(
          item.productDescription,
          (Array.isArray(item.warnings) ? item.warnings : []).filter(
            (warning) =>
              isProviderDocumentImportWarningTransferable(warning) &&
              providerDocumentImportState.transferableWarningsSelection[
                buildProviderDocumentImportTransferableWarningKey(
                  item.previewId,
                  warning,
                )
              ],
          ),
        ),
      }));

      const deliveryResolution = selectedCommercialTerms.deliveryTime
        ? resolveProviderDocumentImportCommercialTermForForm({
            field: "deliveryTime",
            value: previewCommercialTerms.deliveryTime,
            options: catalogs.deliveryTimes,
          })
        : { resolvedValue: "", noteLine: "" };
      const quotationValidityResolution =
        selectedCommercialTerms.quotationValidity
          ? resolveProviderDocumentImportCommercialTermForForm({
              field: "quotationValidity",
              value: previewCommercialTerms.quotationValidity,
              options: catalogs.validityTerms,
            })
          : { resolvedValue: "", noteLine: "" };
      const warrantyResolution = selectedCommercialTerms.warranty
        ? resolveProviderDocumentImportCommercialTermForForm({
            field: "warranty",
            value: previewCommercialTerms.warranty,
            options: catalogs.warrantyTerms,
          })
        : { resolvedValue: "", noteLine: "" };
      const paymentTermsResolution = selectedCommercialTerms.paymentTerms
        ? resolveProviderDocumentImportCommercialTermForForm({
            field: "paymentTerms",
            value: previewCommercialTerms.paymentTerms,
            options: catalogs.paymentTerms,
          })
        : { resolvedValue: "", noteLine: "" };

      if (isCreateDraftImport) {
        const nextSectionLocalId = `draft-section-${createSectionDraftSequenceRef.current}`;
        createSectionDraftSequenceRef.current += 1;
        const nextSectionNumber = createSectionDrafts.length + 1;
        const localImportedItems = importedDraftItems.map((item) => ({
          ...item,
          localId: `draft-item-${createItemDraftSequenceRef.current++}`,
        }));

        setCreateSectionDrafts((prev) => [
          ...prev,
          {
            localId: nextSectionLocalId,
            title:
              String(
                providerDocumentImportState.preview?.suggestedSectionName || "",
              ).trim() || `Seccion ${nextSectionNumber}`,
            inclusionTypeId: String(catalogs.inclusionTypes[0]?.id || ""),
            items: localImportedItems,
          },
        ]);
        setCreateItemDraftsBySection((prev) => ({
          ...prev,
          [nextSectionLocalId]: buildItemDraft(catalogs.providers),
        }));
        setCreateProviderDocumentImportResult((current) => ({
          token: current.token + 1,
          commercialConditions: {
            ...(selectedCommercialTerms.deliveryTime &&
            deliveryResolution.resolvedValue
              ? { deliveryTime: deliveryResolution.resolvedValue }
              : {}),
            ...(selectedCommercialTerms.quotationValidity &&
            quotationValidityResolution.resolvedValue
              ? {
                  quotationValidity: quotationValidityResolution.resolvedValue,
                }
              : {}),
            ...(selectedCommercialTerms.warranty &&
            warrantyResolution.resolvedValue
              ? { warranty: warrantyResolution.resolvedValue }
              : {}),
            ...(selectedCommercialTerms.paymentTerms &&
            paymentTermsResolution.resolvedValue
              ? { paymentTerms: paymentTermsResolution.resolvedValue }
              : {}),
            ...(selectedCommercialTerms.currencyCode && nextVersionCurrencyCode
              ? { currencyCode: nextVersionCurrencyCode }
              : {}),
            quotationNotes: appendProviderDocumentImportNoteLines("", [
              deliveryResolution.noteLine,
              quotationValidityResolution.noteLine,
              warrantyResolution.noteLine,
              paymentTermsResolution.noteLine,
              ...selectedCommercialClauseNoteLines,
            ]),
          },
        }));

        closeProviderDocumentImportModal();
        setSuccess(
          "Items agregados al borrador de cotizacion. La cotizacion aun no se ha creado.",
        );
        return true;
      }

      const nextSectionNumber = (selectedVersion?.sections || []).length + 1;
      const nextSectionId = buildNextEditSectionId();
      const localImportedItems = buildLocalEditItemsFromSources(
        importedDraftItems,
        { startingDisplayOrder: 1 },
      );
      const nextSection = {
        id: nextSectionId,
        title:
          String(
            providerDocumentImportState.preview?.suggestedSectionName || "",
          ).trim() || `Seccion ${nextSectionNumber}`,
        inclusionTypeId: Number(
          catalogs.inclusionTypes[0]?.id ||
            selectedVersion?.sections?.[0]?.inclusionTypeId ||
            0,
        ),
        displayOrder: nextSectionNumber,
        items: localImportedItems.map((item, index) =>
          buildLocalEditableItemRecord(item, catalogs.providers, index + 1),
        ),
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
      setItemEdits((prev) => ({
        ...prev,
        ...Object.fromEntries(
          localImportedItems.map((item, index) => {
            const displayOrder = index + 1;
            const draft = buildLocalEditableItemDraft(item, displayOrder);
            return [String(item.id), draft];
          }),
        ),
      }));
      setItemDraftsBySection((prev) => ({
        ...prev,
        [String(nextSectionId)]: buildItemDraft(catalogs.providers),
      }));
      setVersionForm((prev) =>
        buildQuotationCommercialConditionsForm({
          ...prev,
          deliveryTime: deliveryResolution.resolvedValue || prev.deliveryTime,
          quotationValidity:
            quotationValidityResolution.resolvedValue || prev.quotationValidity,
          warranty: warrantyResolution.resolvedValue || prev.warranty,
          paymentTerms:
            paymentTermsResolution.resolvedValue || prev.paymentTerms,
          currencyCode: nextVersionCurrencyCode || prev.currencyCode,
          quotationNotes: appendProviderDocumentImportNoteLines(
            prev.quotationNotes,
            [
              deliveryResolution.noteLine,
              quotationValidityResolution.noteLine,
              warrantyResolution.noteLine,
              paymentTermsResolution.noteLine,
              ...selectedCommercialClauseNoteLines,
            ],
          ),
        }),
      );

      closeProviderDocumentImportModal();
      setShowEditQuotationModal(true);
      setSuccess(
        "Items y seccion agregados en memoria. Usa Guardar como version actual para persistirlos.",
      );
      return true;
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible preparar la importacion en memoria",
        ),
      );
      return false;
    } finally {
      setProviderDocumentImportState((current) => ({
        ...current,
        applying: false,
      }));
    }
  }, [
    buildLocalEditItemsFromSources,
    buildNextEditSectionId,
    catalogs.deliveryTimes,
    catalogs.inclusionTypes,
    catalogs.paymentTerms,
    catalogs.providers,
    catalogs.validityTerms,
    catalogs.warrantyTerms,
    closeProviderDocumentImportModal,
    createSectionDrafts.length,
    providerDocumentImportEffectiveItems,
    providerDocumentImportState.commercialTermsSelection,
    providerDocumentImportState.commercialClausesSelection,
    providerDocumentImportState.confirmedProviderId,
    providerDocumentImportState.draftPricingContext,
    providerDocumentImportState.preview,
    providerDocumentImportState.selectedDocumentId,
    providerDocumentImportState.sourceMode,
    providerDocumentImportState.transferableWarningsSelection,
    selectedQuotationId,
    selectedVersion?.sections,
    selectedVersionId,
    versionForm.currencyCode,
    versionForm.exchangeRate,
  ]);

  const handleDownloadQuotationDocument = useCallback(async (document) => {
    if (!document?.id) {
      return;
    }

    setError("");
    setSuccess("");
    try {
      setBusyAction(`download-quotation-document-${document.id}`);
      const response = await api.get(
        `/api/quotation-version-documents/${document.id}/download`,
        { responseType: "blob" },
      );
      const objectUrl = window.URL.createObjectURL(response.data);
      const link = window.document.createElement("a");
      link.href = objectUrl;
      link.download = document.originalFileName || "documento";
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);
      window.URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible descargar el documento"),
      );
    } finally {
      setBusyAction("");
    }
  }, []);

  const handleAction = useCallback(
    async (actionCode, actionOptions = {}) => {
      if (!selectedVersionId) {
        setError("Selecciona una version antes de ejecutar una accion.");
        return;
      }
      if (actionCode === "crear_version") {
        await handleCreateVersion();
        return;
      }

      const normalizedApprovalMode = String(
        actionOptions?.approvalMode || "",
      ).trim();
      const busyActionCode =
        actionCode === "aprobar" && normalizedApprovalMode
          ? `action-${actionCode}-${normalizedApprovalMode}`
          : `action-${actionCode}`;

      const buildApprovalPolicyErrorMessage = (err) => {
        if (actionCode !== "aprobar") {
          return "";
        }

        const responseCode = err?.response?.data?.code;
        if (
          responseCode === "quotation_approval_provider_backing_reason_required"
        ) {
          return (
            String(err?.response?.data?.message || "").trim() ||
            "Debes registrar un motivo para aprobar con excepcion de respaldo de proveedor."
          );
        }

        if (
          responseCode === "quotation_approval_provider_backing_ack_mismatch"
        ) {
          return (
            String(err?.response?.data?.message || "").trim() ||
            "La lista de items sin respaldo cambio. Debes volver a confirmar la excepcion."
          );
        }

        if (responseCode === "quotation_approval_ai_forbidden") {
          return (
            String(err?.response?.data?.message || "").trim() ||
            "No autorizado para aprobar con IA."
          );
        }

        if (responseCode === "quotation_approval_human_forbidden") {
          return (
            String(err?.response?.data?.message || "").trim() ||
            "No autorizado para aprobar sin IA."
          );
        }

        if (responseCode !== "quotation_approval_policy_failed") {
          return "";
        }

        const blockingRules = err?.response?.data?.validation?.blockingRules;
        if (!Array.isArray(blockingRules) || !blockingRules.length) {
          return "";
        }

        const reasons = blockingRules
          .map((rule) => String(rule?.message || "").trim())
          .filter(Boolean);
        if (!reasons.length) {
          return "";
        }

        return `No se pudo aprobar la cotizacion: ${reasons.join(" | ")}`;
      };

      const buildApprovalRecommendationsMessage = (warnings) => {
        if (actionCode !== "aprobar") {
          return [];
        }

        if (!Array.isArray(warnings) || !warnings.length) {
          return [];
        }

        const recommendationByCode = {
          approval_provider_cost_reference_not_found:
            "Verifica el costo proveedor de referencia en la lista de precios.",
          approval_product_cost_mismatch_waived:
            "Revisa y corrige los costos de proveedor que no coinciden.",
          approval_provider_data_missing_deliveryTime:
            "Confirma el tiempo de entrega con el proveedor.",
          approval_provider_data_missing_quotationValidity:
            "Confirma la vigencia con el proveedor.",
          approval_provider_data_missing_warranty:
            "Confirma la garantia con el proveedor.",
          approval_provider_data_missing_paymentTerms:
            "Confirma las condiciones de pago con el proveedor.",
        };

        const recommendations = Array.from(
          new Set(
            warnings
              .map(
                (warning) =>
                  recommendationByCode[String(warning?.code || "").trim()] ||
                  String(warning?.message || "").trim(),
              )
              .filter(Boolean),
          ),
        );

        return recommendations;
      };

      const prepareSendConfirmation = async () => {
        if (actionCode !== "enviar") {
          return true;
        }

        const normalizedPayload = normalizeQuotationPdfPayload(
          actionOptions?.quotationPrintModel,
        );
        if (!normalizedPayload) {
          setError(
            "No fue posible preparar el documento para compartir en el correo.",
          );
          return false;
        }

        let publicQuotationUrl = "";
        try {
          const response = await api.post(
            `/api/quotation-versions/${selectedVersionId}/public-share-link`,
            {
              pdfPayload: normalizedPayload,
            },
          );
          publicQuotationUrl = String(response?.data?.url || "").trim();
        } catch (err) {
          setError(
            getApiErrorMessage(
              err,
              "No fue posible generar el enlace publico de la cotizacion.",
            ),
          );
          return false;
        }

        if (!publicQuotationUrl) {
          setError(
            "No fue posible generar el enlace publico de la cotizacion.",
          );
          return false;
        }

        const contactId = Number(versionForm?.contactId || 0);
        const selectedContact = Array.isArray(editContactOptions)
          ? editContactOptions.find(
              (contact) => Number(contact?.id || 0) === contactId,
            )
          : null;
        const recipientEmail = String(selectedContact?.email || "").trim();
        const recipientName = String(
          selectedContact?.full_name || selectedContact?.fullName || "",
        ).trim();

        const proposalName = String(versionForm?.proposalName || "").trim();
        const quotationId = Number(selectedQuotation?.id || 0);
        const versionNumber = Number(selectedVersion?.versionNumber || 0);
        const reference = [
          quotationId > 0 ? `#${quotationId}` : "",
          versionNumber > 0 ? `V${versionNumber}` : "",
        ]
          .filter(Boolean)
          .join(" ");

        const subject = proposalName
          ? reference
            ? `Cotizacion ${reference} - ${proposalName}`
            : `Cotizacion - ${proposalName}`
          : reference
            ? `Cotizacion ${reference}`
            : "Cotizacion";

        const greetingLine = recipientName ? `Hola ${recipientName},` : "Hola,";

        const bodyLines = [
          greetingLine,
          "",
          "Te comparto la cotizacion para tu revision.",
          "",
          "Enlace publico (PDF):",
          publicQuotationUrl,
          "",
          "Resumen:",
        ];

        if (reference) {
          bodyLines.push(`- Referencia: ${reference}`);
        }
        if (proposalName) {
          bodyLines.push(`- Propuesta: ${proposalName}`);
        }

        bodyLines.push("", "Quedo atento a tus comentarios.", "", "Saludos.");

        const mailtoUrl = buildMailtoDraftUrl({
          to: recipientEmail,
          subject,
          body: bodyLines.join("\n"),
        });
        const opened = openMailtoDraft(mailtoUrl);

        if (!opened) {
          setError(
            "No fue posible abrir el cliente de correo. La cotizacion no se marco como enviada.",
          );
          return false;
        }

        const confirmationMessage = recipientEmail
          ? `Se intento abrir el correo para ${recipientEmail}. ¿Confirmas que el correo quedo abierto/preparado para envio?`
          : "Se intento abrir el correo. ¿Confirmas que el correo quedo abierto/preparado para envio?";
        const confirmedPrepared = window.confirm(confirmationMessage);

        if (!confirmedPrepared) {
          setSuccess(
            "No se marco como enviada porque no se confirmo la preparacion del correo.",
          );
          return false;
        }

        return true;
      };

      setBusyAction(busyActionCode);
      setError("");
      setSuccess("");
      try {
        const buildApprovalContext = (approvalContextOverrides = {}) => {
          if (actionCode !== "aprobar") {
            return null;
          }

          const approvalMode = String(actionOptions?.approvalMode || "").trim();
          const mergedContext = {
            ...(approvalMode ? { approvalMode } : {}),
            ...(approvalContextOverrides || {}),
          };

          return Object.keys(mergedContext).length ? mergedContext : null;
        };

        const executeTransition = async (approvalContextOverrides) => {
          const approvalContext = buildApprovalContext(
            approvalContextOverrides,
          );

          return api.post(
            `/api/quotation-versions/${selectedVersionId}/transition`,
            {
              actionCode,
              ...(approvalContext ? { approvalContext } : {}),
            },
          );
        };

        let response;
        let approvalContextOverrides = {};

        if (!(await prepareSendConfirmation())) {
          return;
        }

        while (!response) {
          try {
            response = await executeTransition(approvalContextOverrides);
          } catch (err) {
            const responseCode = err?.response?.data?.code;
            if (actionCode !== "aprobar") {
              throw err;
            }

            if (
              responseCode ===
              "quotation_approval_missing_required_services_confirmation"
            ) {
              const missingServices =
                err?.response?.data?.validation?.blockingRules?.find(
                  (rule) =>
                    rule?.code ===
                    "approval_missing_required_services_confirmation",
                )?.missingMandatoryServices || [];

              const humanizedMissing = Array.isArray(missingServices)
                ? missingServices.join(", ")
                : "implementacion, soporte";
              const shouldContinue = window.confirm(
                `Faltan servicios obligatorios (${humanizedMissing}). ¿Deseas aprobar excluyendolos? Esta excepcion quedara auditada.`,
              );
              if (!shouldContinue) {
                setError(
                  `No se aprobo la cotizacion porque faltan servicios obligatorios (${humanizedMissing}). Agrega esos servicios o confirma la excepcion para continuar.`,
                );
                return;
              }

              const reason = String(
                window.prompt(
                  "Indica el motivo para excluir servicios obligatorios:",
                  "",
                ) || "",
              ).trim();
              if (!reason) {
                setError(
                  "Debes indicar un motivo para registrar la excepcion de servicios obligatorios.",
                );
                return;
              }
              if (reason.length < 5) {
                setError(
                  "El motivo debe tener al menos 5 caracteres para registrar la excepcion de servicios obligatorios.",
                );
                return;
              }

              approvalContextOverrides = {
                ...approvalContextOverrides,
                confirmMissingRequiredServices: true,
                missingRequiredServicesReason: reason,
              };
              continue;
            }

            if (
              responseCode ===
              "quotation_approval_provider_backing_confirmation_required"
            ) {
              const providerBackingRule =
                err?.response?.data?.validation?.blockingRules?.find(
                  (rule) =>
                    rule?.code ===
                    "approval_provider_backing_confirmation_required",
                ) || null;
              const providerDocumentMissing = Boolean(
                providerBackingRule?.providerDocumentMissing,
              );
              const unbackedItems = Array.isArray(
                providerBackingRule?.unbackedItems,
              )
                ? providerBackingRule.unbackedItems
                : [];
              const acknowledgedUnbackedItemIds = unbackedItems
                .map((item) => Number(item?.itemId || 0))
                .filter((itemId) => Number.isInteger(itemId) && itemId > 0);

              const unbackedSummary = unbackedItems
                .slice(0, 5)
                .map((item) => {
                  const code = String(item?.productCode || "").trim();
                  const description = String(
                    item?.productDescription || "",
                  ).trim();
                  return code || description
                    ? `${code || "SIN-CODIGO"} ${description}`.trim()
                    : `Item ${item?.itemId || "sin id"}`;
                })
                .filter(Boolean)
                .join(" | ");

              const messageLines = [
                providerDocumentMissing
                  ? "No existe documento de proveedor de respaldo para esta cotizacion."
                  : "Hay items cotizados sin respaldo en el documento del proveedor.",
              ];
              if (unbackedItems.length) {
                messageLines.push(
                  `Items sin respaldo: ${unbackedSummary}${unbackedItems.length > 5 ? " | ..." : ""}`,
                );
              }
              messageLines.push(
                "¿Deseas continuar bajo tu responsabilidad? Esta excepcion quedara auditada.",
              );

              const shouldContinue = window.confirm(messageLines.join("\n"));
              if (!shouldContinue) {
                setError(
                  providerDocumentMissing
                    ? "No se aprobo la cotizacion porque no existe documento de proveedor de respaldo."
                    : "No se aprobo la cotizacion porque existen items sin respaldo en el documento del proveedor.",
                );
                return;
              }

              const reason = String(
                window.prompt(
                  "Indica el motivo para aprobar sin respaldo completo de proveedor:",
                  "",
                ) || "",
              ).trim();
              if (!reason) {
                setError(
                  "Debes indicar un motivo para registrar la excepcion de respaldo de proveedor.",
                );
                return;
              }
              if (reason.length < 15) {
                setError(
                  "El motivo debe tener al menos 15 caracteres para aprobar sin respaldo completo de proveedor.",
                );
                return;
              }

              approvalContextOverrides = {
                ...approvalContextOverrides,
                confirmProviderBackingException: true,
                providerBackingExceptionReason: reason,
                acknowledgedUnbackedItemIds,
              };
              continue;
            }

            throw err;
          }
        }

        const { data } = response;
        await refreshQuotations({
          preferredQuotationId: selectedQuotationId,
          preferredVersionId: selectedVersionId,
        });
        if (actionCode === "aprobar") {
          setApprovalRecommendations(
            buildApprovalRecommendationsMessage(data?.validation?.warnings),
          );
        }
        setSuccess(data.message || "Accion ejecutada");
      } catch (err) {
        const approvalPolicyMessage = buildApprovalPolicyErrorMessage(err);
        setError(
          approvalPolicyMessage ||
            getApiErrorMessage(err, "No fue posible ejecutar la accion"),
        );
      } finally {
        setBusyAction("");
      }
    },
    [
      editContactOptions,
      handleCreateVersion,
      refreshQuotations,
      selectedQuotation?.id,
      selectedQuotationId,
      selectedVersion?.versionNumber,
      selectedVersionId,
      versionForm,
      versionForm?.contactId,
      versionForm?.proposalName,
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

  const handleCreateEditManualBundleFromTemplate = useCallback(
    async (sectionId, selectedIds, templateProduct) => {
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

      if (
        !templateProduct ||
        templateProduct.itemType === "grupo_productos" ||
        !String(templateProduct.code || "").trim() ||
        !String(templateProduct.description || "").trim() ||
        !Number(templateProduct.providerId)
      ) {
        setError(
          "Selecciona una plantilla valida para crear el padre del bundle.",
        );
        return [];
      }

      setError("");
      setSuccess("");

      const currentSelectedSet = new Set(selectedIds || []);
      const firstSelectedIndex = sectionItems.findIndex((item) =>
        currentSelectedSet.has(item.localId),
      );
      const parentLocalId = String(buildNextEditItemId());
      const normalizedParentItem = {
        id: Number(parentLocalId),
        localId: parentLocalId,
        providerId: String(templateProduct.providerId || ""),
        productCode: String(templateProduct.code || "").trim(),
        productDescription: String(templateProduct.description || "").trim(),
        quantity: "1",
        originalCurrencyCode: "USD",
        originalListPriceUnit: "0",
        listPriceUnit: "0",
        manufacturerDiscountPct: "0",
        importCostPct: "0",
        profitMarginPct: "0",
        finalDiscountPct: "0",
        itemType: "grupo_productos",
        isRenewal: false,
        bundleParentItemId: null,
        bundleParentLocalId: null,
        bundleOriginType: "manual_bundle",
        sourceProviderPriceListItemId: null,
        sourceComponentPriceListItemId: null,
        bundleComponentItemId: null,
        isBundleComponent: false,
        bundleSortOrder: null,
      };
      const normalizedComponentItems = selection.items.map((item) =>
        normalizeCreateBundleComponentAsManual(item, parentLocalId),
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
      setSuccess("Bundle creado desde plantilla");
      return [parentLocalId, ...selection.items.map((item) => item.localId)];
    },
    [
      applyLocalSectionItemsState,
      buildNextEditItemId,
      itemEdits,
      selectedVersion,
    ],
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
  const currentQuotationsPage = useMemo(
    () => Math.min(quotationsPage, totalQuotationPages),
    [quotationsPage, totalQuotationPages],
  );

  const pagedQuotations = useMemo(
    () =>
      visibleQuotations.slice(
        (currentQuotationsPage - 1) * quotationsPerPage,
        currentQuotationsPage * quotationsPerPage,
      ),
    [currentQuotationsPage, quotationsPerPage, visibleQuotations],
  );

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

  const dismissApprovalRecommendations = useCallback(() => {
    setApprovalRecommendations([]);
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

  const handleQuotationStatusFilterChange = useCallback((value) => {
    setQuotationsPage(1);
    setQuotationStatusFilter(value);
  }, []);

  const handleQuotationQueryChange = useCallback((value) => {
    setQuotationsPage(1);
    setQuotationQuery(value);
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
      handleCreateManualBundleFromTemplate,
      handleApplyCreateSectionItemSaleAdjustment,
      handleAttachCreateSectionItemsToManualBundle,
      handleDetachCreateSectionItemsFromManualBundle,
      hasCreateCopiedItems: createCopiedItems.length > 0,
      currentUserName:
        currentUser?.full_name || currentUser?.email || "Usuario actual",
      setCreateItemDraftsBySection,
      closeCreateQuotationModal,
      handleCreateQuotation,
      openCreateProviderDocumentImportModal,
      busyAction,
      canSubmitCreateQuotation,
      hasCreateCommercialContext,
      canCreateProviderPrices,
      createProviderDocumentImportAppliedToken:
        createProviderDocumentImportResult.token,
      createProviderDocumentImportAppliedCommercialConditions:
        createProviderDocumentImportResult.commercialConditions,
    },
    editModalProps: {
      isOpen: showEditQuotationModal,
      closeEditQuotationModal,
      error,
      success,
      editorContentProps: {
        isOpen: showEditQuotationModal,
        selectedVersion,
        selectedQuotation,
        closeEditQuotationModal,
        openQuotationPrintView,
        companyBranding,
        versionForm,
        setVersionForm,
        contactOptions: editContactOptions,
        catalogs,
        busyAction,
        approvalRecommendations,
        dismissApprovalRecommendations,
        allowedActions,
        handleSaveVersion,
        handleSaveAsNewVersion,
        handleUploadQuotationDocuments,
        handleSetQuotationDocumentAiEnabled,
        providerDocumentImportState,
        providerDocumentImportEffectiveItems,
        providerDocumentImportWorkflowStage,
        openProviderDocumentImportModal,
        closeProviderDocumentImportModal,
        setProviderDocumentImportDocument,
        setProviderDocumentImportProvider,
        setProviderDocumentImportCommercialTermSelection,
        setProviderDocumentImportSuggestedMatchCandidate,
        setProviderDocumentImportMissingItemSelection,
        selectedQuotationId,
        handlePreviewProviderDocumentImport,
        handleCreateSuggestedProviderDocumentImportItem,
        handleCreateMissingProviderDocumentImportItems,
        handleApplyProviderDocumentImport,
        handleDownloadQuotationDocument,
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
        handleCreateEditManualBundleFromTemplate,
        handleAttachEditSectionItemsToManualBundle,
        handleDetachEditSectionItemsFromManualBundle,
        handleRemoveEditSectionItems,
        handleDuplicateEditSectionItems,
        handleCopyEditSectionItems,
        handlePasteEditSectionItems,
        hasEditCopiedItems: editCopiedItems.length > 0,
        canCreateProviderPrices,
      },
    },
    providerImportWindowProps: {
      isOpen: providerDocumentImportState.isOpen,
      onClose: closeProviderDocumentImportModal,
      errorMessage: error,
      successMessage: success,
      documents: providerImportDocuments,
      providerOptions: catalogs.providers,
      selectedDocumentId: providerDocumentImportState.selectedDocumentId,
      onDocumentChange: setProviderDocumentImportDocument,
      confirmedProviderId: providerDocumentImportState.confirmedProviderId,
      onProviderChange: setProviderDocumentImportProvider,
      onAnalyze: handlePreviewProviderDocumentImport,
      preview: providerDocumentImportState.preview,
      effectiveItems: providerDocumentImportEffectiveItems,
      workflowStage: providerDocumentImportWorkflowStage,
      previewJob: providerDocumentImportState.previewJob,
      loadingPreview: providerDocumentImportState.loadingPreview,
      creatingMissingItems: providerDocumentImportState.creatingMissingItems,
      creatingSuggestedMatchPreviewId:
        providerDocumentImportState.creatingSuggestedMatchPreviewId,
      suggestedMatchFeedbackByPreviewId:
        providerDocumentImportState.suggestedMatchFeedbackByPreviewId,
      applying: providerDocumentImportState.applying,
      commercialTermsSelection:
        providerDocumentImportState.commercialTermsSelection,
      onToggleCommercialTermSelection:
        setProviderDocumentImportCommercialTermSelection,
      commercialClausesSelection:
        providerDocumentImportState.commercialClausesSelection,
      onToggleCommercialClauseSelection:
        setProviderDocumentImportCommercialClauseSelection,
      onSelectSuggestedMatchCandidate:
        setProviderDocumentImportSuggestedMatchCandidate,
      onResolveSuggestedMatch:
        setProviderDocumentImportSuggestedMatchResolution,
      missingItemsSelection: providerDocumentImportState.missingItemsSelection,
      onToggleMissingItemSelection:
        setProviderDocumentImportMissingItemSelection,
      transferableWarningsSelection:
        providerDocumentImportState.transferableWarningsSelection,
      onToggleTransferableWarningSelection:
        setProviderDocumentImportTransferableWarningSelection,
      isWarningTransferable: isProviderDocumentImportWarningTransferable,
      onApply: handleApplyProviderDocumentImport,
      onCreateMissingItems: handleCreateMissingProviderDocumentImportItems,
      onCreateSuggestedMatchItem:
        handleCreateSuggestedProviderDocumentImportItem,
    },
    listPanelProps: {
      showDetails,
      loading,
      quotations,
      duplicateTargetAccounts,
      duplicateTargetOpportunities,
      loadingDuplicateTargetOpportunities,
      selectedQuotationId,
      loadVersion: handleSelectQuotationVersion,
      quotationStatusFilter,
      setQuotationStatusFilter: handleQuotationStatusFilterChange,
      quotationStatusCounts,
      quotationQuery,
      setQuotationQuery: handleQuotationQueryChange,
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
      duplicateQuotationModalState,
      openDuplicateQuotationModal,
      closeDuplicateQuotationModal,
      handleDuplicateQuotationTargetAccountChange,
      handleDuplicateQuotationTargetOpportunityChange,
      handleDuplicateQuotation,
      quotationsPage: currentQuotationsPage,
      quotationsPerPage,
      totalQuotationPages,
      setQuotationsPage,
      setQuotationsPerPage,
    },
    editorContentProps: {
      selectedVersion,
      selectedQuotation,
      openQuotationPrintView,
      companyBranding,
      versionForm,
      setVersionForm,
      contactOptions: editContactOptions,
      catalogs,
      busyAction,
      allowedActions,
      handleSaveVersion,
      handleUploadQuotationDocuments,
      handleSetQuotationDocumentAiEnabled,
      handleSetQuotationDocumentAiEnabled,
      handleSetQuotationDocumentAiEnabled,
      providerDocumentImportState,
      providerDocumentImportEffectiveItems,
      providerDocumentImportWorkflowStage,
      openProviderDocumentImportModal,
      closeProviderDocumentImportModal,
      setProviderDocumentImportDocument,
      setProviderDocumentImportProvider,
      setProviderDocumentImportCommercialTermSelection,
      setProviderDocumentImportSuggestedMatchCandidate,
      setProviderDocumentImportSuggestedMatchResolution,
      setProviderDocumentImportMissingItemSelection,
      handlePreviewProviderDocumentImport,
      handleCreateMissingProviderDocumentImportItems,
      handleApplyProviderDocumentImport,
      handleDownloadQuotationDocument,
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
      handleCreateEditManualBundleFromTemplate,
      handleAttachEditSectionItemsToManualBundle,
      handleDetachEditSectionItemsFromManualBundle,
      handleRemoveEditSectionItems,
      handleDuplicateEditSectionItems,
      handleCopyEditSectionItems,
      handlePasteEditSectionItems,
      hasEditCopiedItems: editCopiedItems.length > 0,
      canCreateProviderPrices,
    },
  };
}
