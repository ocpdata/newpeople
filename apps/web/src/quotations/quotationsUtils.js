import { getQuotationStatusTone } from "./quotationStatusPresentation";

export function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function normalizeQuotationDateInput(value) {
  if (!value) return "";

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return "";
    }

    return value.toISOString().slice(0, 10);
  }

  const normalizedValue = String(value).trim();
  const isoDateMatch = normalizedValue.match(/^(\d{4}-\d{2}-\d{2})/u);
  if (isoDateMatch) {
    return isoDateMatch[1];
  }

  const localDateMatch = normalizedValue.match(/^(\d{2})\/(\d{2})\/(\d{4})$/u);
  if (localDateMatch) {
    const [, day, month, year] = localDateMatch;
    return `${year}-${month}-${day}`;
  }

  return "";
}

const COMMERCIAL_CONDITION_CODE_MAPS = {
  deliveryTime: {
    inmediato: "inmediato",
    "5 dias": "5_dias",
    "10 dias": "10_dias",
    "15 dias": "15_dias",
    "30 dias": "30_dias",
    "45 dias": "45_dias",
    "60 dias": "60_dias",
    "de acuerdo a lo indicado en notas": "segun_notas",
  },
  quotationValidity: {
    "5 dias": "5_dias",
    "10 dias": "10_dias",
    "15 dias": "15_dias",
    "30 dias": "30_dias",
    "45 dias": "45_dias",
    "60 dias": "60_dias",
    "de acuerdo a lo indicado en notas": "segun_notas",
  },
  warranty: {
    "1 ano": "1_ano",
    "2 anos": "2_anos",
    "3 anos": "3_anos",
    "4 anos": "4_anos",
    "5 anos": "5_anos",
    "de acuerdo a lo indicado en notas": "segun_notas",
  },
  paymentTerms: {
    contado: "100_adelantado",
    "100% adelantado": "100_adelantado",
    "50% adelantado - 50% contra entrega": "50_adelantado_50_entrega",
    "50% anticipo y saldo contra entrega": "50_adelantado_50_entrega",
    "100% contra entrega": "100_entrega",
    "factura a 15 dias": "15_dias_facturado",
    "15 dias despues de facturado": "15_dias_facturado",
    "factura a 30 dias": "30_dias_facturado",
    "30 dias despues de facturado": "30_dias_facturado",
    "45 dias despues de facturado": "45_dias_facturado",
    "60 dias despues de facturado": "60_dias_facturado",
    "90 dias despues de facturado": "90_dias_facturado",
    "de acuerdo a lo indicado en notas": "segun_notas",
  },
};

function normalizeCommercialConditionCatalogValue(field, value) {
  if (value == null || value === "") return value;
  const normalizedValue = String(value).trim();
  const normalizedKey = normalizeText(normalizedValue);
  const mappedValue = COMMERCIAL_CONDITION_CODE_MAPS[field]?.[normalizedKey];
  return mappedValue || normalizedValue;
}

export const DEFAULT_QUOTATION_COMMERCIAL_CONDITIONS = {
  deliveryTime: "30_dias",
  quotationValidity: "30_dias",
  warranty: "1_ano",
  paymentTerms: "30_dias_facturado",
  currencyCode: "USD",
  exchangeRate: "1.0000",
  quotationNotes:
    "Los precios están expresados en dólares americanos y no incluyen el I.V.A.",
};

export function buildQuotationCommercialConditionsForm(values) {
  const mergedValues = {
    ...DEFAULT_QUOTATION_COMMERCIAL_CONDITIONS,
    ...(values || {}),
  };

  return {
    ...mergedValues,
    deliveryTime: normalizeCommercialConditionCatalogValue(
      "deliveryTime",
      mergedValues.deliveryTime,
    ),
    quotationValidity: normalizeCommercialConditionCatalogValue(
      "quotationValidity",
      mergedValues.quotationValidity,
    ),
    warranty: normalizeCommercialConditionCatalogValue(
      "warranty",
      mergedValues.warranty,
    ),
    paymentTerms: normalizeCommercialConditionCatalogValue(
      "paymentTerms",
      mergedValues.paymentTerms,
    ),
    currencyCode: String(
      mergedValues.currencyCode ||
        DEFAULT_QUOTATION_COMMERCIAL_CONDITIONS.currencyCode,
    ).trim(),
    exchangeRate:
      values?.exchangeRate == null || values?.exchangeRate === ""
        ? DEFAULT_QUOTATION_COMMERCIAL_CONDITIONS.exchangeRate
        : String(values.exchangeRate),
  };
}

export function buildCreateQuotationForm({
  accountId,
  contactOptions,
  opportunityId,
  opportunityName,
  sellerUserId,
  sellerUserName,
}) {
  return {
    accountId: accountId ? String(accountId) : "",
    opportunityId: opportunityId ? String(opportunityId) : "",
    contextContactId: "",
    contactId: "",
    sellerUserId: sellerUserId ? String(sellerUserId) : "",
    sellerUserName: sellerUserName || "",
    proposalName: opportunityName || "",
    quotationDate: new Date().toISOString().slice(0, 10),
    introduction:
      "Presentamos esta cotizacion para la solucion solicitada, conforme al alcance definido y a las condiciones comerciales acordadas.",
  };
}

export function buildVersionForm(version) {
  if (!version) {
    return {
      contextContactId: "",
      contactId: "",
      proposalName: "",
      quotationDate: "",
      introduction: "",
      activationStatusCode: "activada",
      summaryDiscountMode: "percentage",
      summaryDiscountValue: "0",
      summaryDistributionMode: "total",
      summaryVatMode: "without_vat",
      summaryVatPct: String(DEFAULT_QUOTATION_VAT_PCT),
      internalNotes: "",
      ...buildQuotationCommercialConditionsForm(),
    };
  }

  return {
    contactId: String(version.contactId || ""),
    proposalName: version.proposalName || "",
    quotationDate: normalizeQuotationDateInput(version.quotationDate),
    introduction: version.introduction || "",
    activationStatusCode: version.activationStatusCode || "activada",
    summaryDiscountMode:
      version.summaryDiscountMode === "amount" ? "amount" : "percentage",
    summaryDiscountValue:
      version.summaryDiscountValue == null
        ? "0"
        : String(version.summaryDiscountValue),
    summaryDistributionMode:
      version.summaryDistributionMode === "per_item" ? "per_item" : "total",
    summaryVatMode:
      version.summaryVatMode === "total"
        ? "total"
        : version.summaryVatMode === "per_item"
          ? "per_item"
          : "without_vat",
    summaryVatPct:
      version.summaryVatPct == null
        ? String(DEFAULT_QUOTATION_VAT_PCT)
        : String(version.summaryVatPct),
    internalNotes: version.internalNotes || "",
    ...buildQuotationCommercialConditionsForm({
      deliveryTime: version.deliveryTime,
      quotationValidity: version.quotationValidity,
      warranty: version.warranty,
      paymentTerms: version.paymentTerms,
      currencyCode: version.currencyCode,
      exchangeRate: version.exchangeRate,
      quotationNotes: version.quotationNotes,
    }),
  };
}

export function buildSectionDraft(inclusionTypes) {
  return {
    title: "",
    inclusionTypeId: inclusionTypes[0]?.id ? String(inclusionTypes[0].id) : "",
  };
}

export function buildItemDraft(providerOptions) {
  return {
    providerId: providerOptions[0]?.id ? String(providerOptions[0].id) : "",
    productCode: "",
    productDescription: "",
    quantity: "1",
    originalCurrencyCode: "USD",
    originalListPriceUnit: "0",
    listPriceUnit: "0",
    manufacturerDiscountPct: "0",
    importCostPct: "0",
    profitMarginPct: "0",
    finalDiscountPct: "0",
    itemType: "producto",
    bundleParentLocalId: null,
    bundleOriginType: null,
    sourceProviderPriceListItemId: null,
    sourceComponentPriceListItemId: null,
    isBundleComponent: false,
  };
}

export function toNumber(value) {
  return Number(String(value || "").replace(/,/g, ""));
}

export function stepQuantityValueByUnit(value, delta, min = 0) {
  const normalizedValue = String(value ?? "")
    .trim()
    .replace(/,/g, ".");
  const numericValue = Number(normalizedValue || 0);

  if (!Number.isFinite(numericValue)) {
    return String(Math.max(min, delta > 0 ? delta : min));
  }

  const decimalPart = normalizedValue.split(".")[1] || "";
  const precision = decimalPart.length;
  const nextValue = Math.max(min, numericValue + delta);
  const precisionFactor = 10 ** precision;
  const roundedValue =
    precision > 0
      ? Math.round(nextValue * precisionFactor) / precisionFactor
      : Math.round(nextValue);

  const formattedValue =
    precision > 0 ? roundedValue.toFixed(precision) : String(roundedValue);

  return formattedValue
    .replace(/(\.\d*?[1-9])0+$/u, "$1")
    .replace(/\.0+$/u, "");
}

export function formatQuotationAmount(value) {
  return Number(value || 0).toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function sanitizeQuotationMoneyInputValue(value) {
  return String(value || "")
    .replace(/,/gu, "")
    .replace(/[^\d.]/gu, "")
    .replace(/(\..*)\./gu, "$1");
}

export function formatQuotationMoneyInputValue(value) {
  const sanitizedValue = sanitizeQuotationMoneyInputValue(value);
  const numericValue = Number(sanitizedValue);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return "0";
  }

  const normalizedValue = numericValue
    .toFixed(4)
    .replace(/(\.\d*?[1-9])0+$/u, "$1")
    .replace(/\.0+$/u, "");
  const [integerPart, decimalPart] = normalizedValue.split(".");
  const formattedIntegerPart = Number(integerPart || 0).toLocaleString(
    "es-MX",
    {
      maximumFractionDigits: 0,
    },
  );

  return decimalPart
    ? `${formattedIntegerPart}.${decimalPart}`
    : formattedIntegerPart;
}

export function roundQuotationMoney(value) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.round((numericValue + Number.EPSILON) * 100) / 100;
}

export function roundQuotationUnitPrice(value) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.round((numericValue + Number.EPSILON) * 10000) / 10000;
}

export function normalizeQuotationCurrencyCode(value, fallback = "USD") {
  const normalizedValue = String(value || fallback || "USD")
    .trim()
    .toUpperCase();

  return normalizedValue || "USD";
}

export function normalizeQuotationExchangeRateValue(value, fallback = 1) {
  const numericValue = toNumber(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }

  return numericValue;
}

export function buildQuotationItemPricing(item, pricingContext = {}) {
  const quotationCurrencyCode = normalizeQuotationCurrencyCode(
    pricingContext?.currencyCode,
    item?.originalCurrencyCode || "USD",
  );
  const originalCurrencyCode = normalizeQuotationCurrencyCode(
    item?.originalCurrencyCode,
    quotationCurrencyCode,
  );
  const originalListPriceUnit = Math.max(
    toNumber(item?.originalListPriceUnit ?? item?.listPriceUnit),
    0,
  );
  const exchangeRate = normalizeQuotationExchangeRateValue(
    pricingContext?.exchangeRate,
    1,
  );
  const listPriceUnit =
    originalCurrencyCode === quotationCurrencyCode
      ? originalListPriceUnit
      : roundQuotationUnitPrice(originalListPriceUnit * exchangeRate);

  return {
    quotationCurrencyCode,
    originalCurrencyCode,
    originalListPriceUnit,
    listPriceUnit,
    exchangeRate,
  };
}

export function syncQuotationItemDraftPricing(item, pricingContext = {}) {
  if (!item || typeof item !== "object") {
    return item;
  }

  const pricing = buildQuotationItemPricing(item, pricingContext);

  return {
    ...item,
    quotationCurrencyCode: pricing.quotationCurrencyCode,
    quotationExchangeRate: pricing.exchangeRate,
    originalCurrencyCode: pricing.originalCurrencyCode,
    originalListPriceUnit: String(pricing.originalListPriceUnit),
    listPriceUnit: String(pricing.listPriceUnit),
  };
}

export function syncQuotationItemEditsPricing(itemEdits, pricingContext = {}) {
  if (!itemEdits || typeof itemEdits !== "object") {
    return itemEdits;
  }

  const entries = Object.entries(itemEdits);
  if (!entries.length) {
    return itemEdits;
  }

  let hasChanges = false;
  const nextItemEdits = Object.fromEntries(
    entries.map(([itemId, itemDraft]) => {
      const syncedDraft = syncQuotationItemDraftPricing(
        itemDraft,
        pricingContext,
      );

      if (
        !hasChanges &&
        (String(itemDraft?.quotationCurrencyCode || "") !==
          String(syncedDraft?.quotationCurrencyCode || "") ||
          String(itemDraft?.quotationExchangeRate || "") !==
            String(syncedDraft?.quotationExchangeRate || "") ||
          String(itemDraft?.originalCurrencyCode || "") !==
            String(syncedDraft?.originalCurrencyCode || "") ||
          String(itemDraft?.originalListPriceUnit || "") !==
            String(syncedDraft?.originalListPriceUnit || "") ||
          String(itemDraft?.listPriceUnit || "") !==
            String(syncedDraft?.listPriceUnit || ""))
      ) {
        hasChanges = true;
      }

      return [itemId, syncedDraft];
    }),
  );

  return hasChanges ? nextItemEdits : itemEdits;
}

export const DEFAULT_QUOTATION_VAT_PCT = 16;

function toPercentFactor(value) {
  const numericValue = toNumber(value);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.min(Math.max(numericValue, 0), 100) / 100;
}

export function calculateQuotationItemTotals(item, options = {}) {
  const quantity = Math.max(toNumber(item?.quantity), 0);
  const listPriceUnit = Math.max(toNumber(item?.listPriceUnit), 0);
  const manufacturerDiscount = toPercentFactor(item?.manufacturerDiscountPct);
  const importCost = toPercentFactor(item?.importCostPct);
  const profitMargin = toPercentFactor(item?.profitMarginPct);
  const finalDiscount = toPercentFactor(item?.finalDiscountPct);
  const vat = toPercentFactor(options?.vatPct ?? item?.vatPct);
  const discountedListPriceUnit = listPriceUnit * (1 - manufacturerDiscount);
  const costUnit = discountedListPriceUnit * (1 + importCost);
  const costTotal = quantity * costUnit;
  const salePriceBase = profitMargin >= 1 ? 0 : costUnit / (1 - profitMargin);
  const salePriceUnit = salePriceBase * (1 - finalDiscount) * (1 + vat);

  return {
    discountedListPriceUnit,
    costUnit,
    costTotal,
    salePriceUnit,
    salePriceTotal: quantity * salePriceUnit,
  };
}

export function calculateQuotationItemDisplayTotals(item, allItems = []) {
  const baseTotals = calculateQuotationItemTotals(item);

  if (item?.isBundleComponent) {
    return baseTotals;
  }

  const componentItems = Array.isArray(allItems)
    ? allItems.filter(
        (candidate) => candidate?.bundleParentLocalId === item?.localId,
      )
    : [];

  if (!componentItems.length) {
    return baseTotals;
  }

  const aggregatedTotals = componentItems.reduce(
    (accumulator, componentItem) => {
      const componentTotals = calculateQuotationItemTotals(componentItem);
      return {
        costTotal:
          accumulator.costTotal + Number(componentTotals.costTotal || 0),
        salePriceTotal:
          accumulator.salePriceTotal +
          Number(componentTotals.salePriceTotal || 0),
      };
    },
    { costTotal: 0, salePriceTotal: 0 },
  );

  const quantity = Math.max(toNumber(item?.quantity), 0);
  const costUnit =
    quantity > 0
      ? aggregatedTotals.costTotal / quantity
      : aggregatedTotals.costTotal;
  const salePriceUnit =
    quantity > 0
      ? aggregatedTotals.salePriceTotal / quantity
      : aggregatedTotals.salePriceTotal;

  return {
    ...baseTotals,
    costUnit,
    costTotal: aggregatedTotals.costTotal,
    salePriceUnit,
    salePriceTotal: aggregatedTotals.salePriceTotal,
  };
}

function buildQuotationSummaryBucket() {
  return {
    costTotal: 0,
    salePriceTotal: 0,
  };
}

function getQuotationSummaryMarginPct(bucket) {
  const salePriceTotal = Number(bucket?.salePriceTotal || 0);
  const costTotal = Number(bucket?.costTotal || 0);

  if (salePriceTotal <= 0) {
    return 0;
  }

  return ((salePriceTotal - costTotal) / salePriceTotal) * 100;
}

function resolveQuotationSummaryCategory(itemType) {
  return itemType === "servicio_propio" ? "services" : "products";
}

function getQuotationSummaryChildParentIdSet(sections = []) {
  const allItems = Array.isArray(sections)
    ? sections.flatMap((section) => section?.items || [])
    : [];

  return new Set(
    allItems
      .filter((item) => item?.bundleParentLocalId)
      .map((item) => item.bundleParentLocalId),
  );
}

function isQuotationSummaryLeafItem(item, childParentIdSet) {
  if (!item) {
    return false;
  }

  const isComponent = Boolean(
    item.isBundleComponent || item.bundleParentLocalId,
  );
  const hasChildren = childParentIdSet.has(item.localId);

  if (hasChildren) {
    return false;
  }

  if (!isComponent && item.itemType === "grupo_productos") {
    return false;
  }

  return true;
}

function formatDistributedDiscountPct(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return "0";
  }

  return numericValue
    .toFixed(8)
    .replace(/(\.\d*?[1-9])0+$/u, "$1")
    .replace(/\.0+$/u, "");
}

export function buildCreateQuotationDistributedBaseSections(sections = []) {
  const childParentIdSet = getQuotationSummaryChildParentIdSet(sections);

  return (sections || []).map((section) => ({
    ...section,
    items: (section?.items || []).map((item) =>
      isQuotationSummaryLeafItem(item, childParentIdSet)
        ? {
            ...item,
            finalDiscountPct: "0",
          }
        : item,
    ),
  }));
}

export function applyCreateQuotationDistributedFinalDiscount(
  sections = [],
  distributedDiscountPct = 0,
) {
  const childParentIdSet = getQuotationSummaryChildParentIdSet(sections);
  const formattedDistributedDiscountPct = formatDistributedDiscountPct(
    Math.min(Math.max(Number(distributedDiscountPct) || 0, 0), 100),
  );

  return (sections || []).map((section) => ({
    ...section,
    items: (section?.items || []).map((item) =>
      isQuotationSummaryLeafItem(item, childParentIdSet)
        ? {
            ...item,
            finalDiscountPct: formattedDistributedDiscountPct,
          }
        : item,
    ),
  }));
}

export function applyCreateQuotationPerItemVat(
  sections = [],
  vatPct = DEFAULT_QUOTATION_VAT_PCT,
) {
  const childParentIdSet = getQuotationSummaryChildParentIdSet(sections);
  const normalizedVatPct = Math.min(Math.max(Number(vatPct) || 0, 0), 100);

  return (sections || []).map((section) => ({
    ...section,
    items: (section?.items || []).map((item) =>
      isQuotationSummaryLeafItem(item, childParentIdSet)
        ? {
            ...item,
            vatPct: normalizedVatPct,
          }
        : item,
    ),
  }));
}

export function calculateCreateQuotationSummary(
  sections = [],
  summaryDiscountInput = {},
  summaryVatInput = {},
) {
  const buckets = {
    products: buildQuotationSummaryBucket(),
    services: buildQuotationSummaryBucket(),
    total: buildQuotationSummaryBucket(),
  };

  const allItems = Array.isArray(sections)
    ? sections.flatMap((section) => section?.items || [])
    : [];
  const childParentIdSet = getQuotationSummaryChildParentIdSet(sections);

  allItems.forEach((item) => {
    if (!isQuotationSummaryLeafItem(item, childParentIdSet)) {
      return;
    }

    const category = resolveQuotationSummaryCategory(item.itemType);
    const itemTotals = calculateQuotationItemTotals(item);
    const costTotal = Number(itemTotals.costTotal || 0);
    const salePriceTotal = Number(itemTotals.salePriceTotal || 0);

    buckets[category].costTotal += costTotal;
    buckets[category].salePriceTotal += salePriceTotal;
    buckets.total.costTotal += costTotal;
    buckets.total.salePriceTotal += salePriceTotal;
  });

  const summaryDiscountMode =
    summaryDiscountInput?.mode === "amount" ? "amount" : "percentage";
  const numericSummaryDiscountValue = Math.max(
    Number(summaryDiscountInput?.value) || 0,
    0,
  );
  const normalizedSummaryDiscountPct =
    summaryDiscountMode === "amount"
      ? buckets.total.salePriceTotal > 0
        ? Math.min(
            Math.max(
              (numericSummaryDiscountValue / buckets.total.salePriceTotal) *
                100,
              0,
            ),
            100,
          )
        : 0
      : Math.min(numericSummaryDiscountValue, 100);
  const totalSalePriceTotal = roundQuotationMoney(buckets.total.salePriceTotal);
  const discountAmount = roundQuotationMoney(
    summaryDiscountMode === "amount"
      ? Math.min(numericSummaryDiscountValue, totalSalePriceTotal)
      : totalSalePriceTotal * (normalizedSummaryDiscountPct / 100),
  );
  const discountedTotalAmount = roundQuotationMoney(
    totalSalePriceTotal - discountAmount,
  );
  const summaryVatMode =
    summaryVatInput?.mode === "total"
      ? "total"
      : summaryVatInput?.mode === "per_item"
        ? "per_item"
        : "without_vat";
  const normalizedSummaryVatPct = Math.min(
    Math.max(Number(summaryVatInput?.vatPct) || 0, 0),
    100,
  );
  const vatBaseAmount =
    discountAmount > 0 ? discountedTotalAmount : totalSalePriceTotal;
  const vatAmount = roundQuotationMoney(
    summaryVatMode === "total"
      ? vatBaseAmount * (normalizedSummaryVatPct / 100)
      : 0,
  );
  const totalWithVatAmount = roundQuotationMoney(vatBaseAmount + vatAmount);

  const rows = [
    {
      key: "products",
      label: "Productos",
      ...buckets.products,
      marginPct: getQuotationSummaryMarginPct(buckets.products),
    },
    {
      key: "services",
      label: "Servicios",
      ...buckets.services,
      marginPct: getQuotationSummaryMarginPct(buckets.services),
    },
    {
      key: "total",
      label: "Total",
      ...buckets.total,
      marginPct: getQuotationSummaryMarginPct(buckets.total),
    },
  ];

  if (discountAmount > 0) {
    rows.push({
      key: "discount",
      label: "Descuento",
      costTotal: null,
      salePriceTotal: discountAmount,
      marginPct: null,
    });
    rows.push({
      key: "discounted-total",
      label: "Total Descontado",
      costTotal: null,
      salePriceTotal: discountedTotalAmount,
      marginPct: null,
    });
  }

  if (summaryVatMode === "total" && vatAmount > 0) {
    rows.push({
      key: "vat",
      label: "IVA",
      costTotal: null,
      salePriceTotal: vatAmount,
      marginPct: null,
    });
    rows.push({
      key: "total-with-vat",
      label: "Total con IVA incluido",
      costTotal: null,
      salePriceTotal: totalWithVatAmount,
      marginPct: null,
    });
  }

  return {
    rows,
    summaryDiscountMode,
    summaryDiscountValue:
      summaryDiscountMode === "amount"
        ? discountAmount
        : normalizedSummaryDiscountPct,
    summaryDiscountPct: normalizedSummaryDiscountPct,
    totalSalePriceTotal,
    discountAmount,
    discountedTotalAmount,
    summaryVatMode,
    summaryVatPct: normalizedSummaryVatPct,
    vatAmount,
    totalWithVatAmount,
  };
}

export function buildSectionEdits(version) {
  return Object.fromEntries(
    (version?.sections || []).map((section) => [
      String(section.id),
      {
        title: section.title,
        inclusionTypeId: String(section.inclusionTypeId),
      },
    ]),
  );
}

export function buildItemEdits(version) {
  return Object.fromEntries(
    (version?.sections || []).flatMap((section) =>
      (section.items || []).map((item) => [
        String(item.id),
        {
          id: Number(item.id),
          localId: String(item.id),
          providerId: String(item.providerId),
          productCode: item.productCode,
          productDescription: item.productDescription,
          quantity: String(item.quantity),
          originalCurrencyCode: item.originalCurrencyCode || "USD",
          originalListPriceUnit: String(
            item.originalListPriceUnit ?? item.listPriceUnit ?? 0,
          ),
          listPriceUnit: String(item.listPriceUnit),
          manufacturerDiscountPct: String(item.manufacturerDiscountPct),
          importCostPct: String(item.importCostPct),
          profitMarginPct: String(item.profitMarginPct),
          finalDiscountPct: String(item.finalDiscountPct ?? 0),
          itemType: item.itemType || "producto",
          bundleParentItemId: item.bundleParentItemId
            ? Number(item.bundleParentItemId)
            : null,
          bundleParentLocalId: item.bundleParentItemId
            ? String(item.bundleParentItemId)
            : null,
          bundleOriginType: item.bundleOriginType || null,
          sourceProviderPriceListItemId: item.sourceProviderPriceListItemId
            ? Number(item.sourceProviderPriceListItemId)
            : null,
          sourceComponentPriceListItemId: item.sourceComponentPriceListItemId
            ? Number(item.sourceComponentPriceListItemId)
            : null,
          bundleSortOrder: item.bundleSortOrder
            ? Number(item.bundleSortOrder)
            : null,
          displayOrder: item.displayOrder ? Number(item.displayOrder) : null,
          isBundleComponent: Boolean(item.bundleParentItemId),
        },
      ]),
    ),
  );
}

export function buildItemDrafts(version, providerOptions) {
  return Object.fromEntries(
    (version?.sections || []).map((section) => [
      String(section.id),
      buildItemDraft(providerOptions),
    ]),
  );
}

export function getQuotationActivationBucket(quotation) {
  const normalized = normalizeText(
    quotation.activationStatusCode || quotation.activationStatusName,
  );

  if (normalized.includes("desactiv")) return "inactive";
  return "active";
}

export function getQuotationWorkflowTone(quotation) {
  return getQuotationStatusTone({
    uiKey: quotation.latestStatusUiKey,
    code: quotation.latestStatusCode,
  });
}

export function compareValues(left, right) {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  return String(left || "").localeCompare(String(right || ""), "es", {
    sensitivity: "base",
    numeric: true,
  });
}

export function formatQuotationDate(value) {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-ES").format(date);
}
