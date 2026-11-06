import { useEffect, useMemo, useState } from "react";
import { api, getApiErrorMessage } from "./api";
import { formatBusinessDate, getTodayBusinessDate } from "./business-timezone";
import { InvoiceExchangeRateFields } from "./InvoiceExchangeRate";
import { useInvoiceExchangeRate } from "./useInvoiceExchangeRate";

const INVOICING_STATE_STORAGE_KEY = "newpeople.invoicing.module.v1";

function formatDate(value) {
  return formatBusinessDate(value, { fallback: "-" });
}

function formatCurrency(value, currencyCode = "USD", currencyDisplay = "symbol") {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return "-";
  const currency = String(currencyCode || "USD").trim() || "USD";
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
      currencyDisplay,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString("es-MX", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
}

function loadInvoicingState() {
  if (typeof window === "undefined") {
    return {
      selectedQuotationIds: [],
      invoices: [],
    };
  }

  try {
    const raw = window.localStorage.getItem(INVOICING_STATE_STORAGE_KEY);
    if (!raw) {
      return {
        selectedQuotationIds: [],
        invoices: [],
      };
    }
    const parsed = JSON.parse(raw);
    const selectedQuotationIds = Array.isArray(parsed?.selectedQuotationIds)
      ? parsed.selectedQuotationIds
          .map((id) => Number(id || 0))
          .filter((id) => Number.isInteger(id) && id > 0)
      : [];
    const invoices = Array.isArray(parsed?.invoices)
      ? parsed.invoices
          .map((invoice) => {
            const quotationIds = Array.isArray(invoice?.quotationIds)
              ? invoice.quotationIds
                  .map((id) => Number(id || 0))
                  .filter((id) => Number.isInteger(id) && id > 0)
              : [];
            const quotationItems = Array.isArray(invoice?.quotationItems)
              ? invoice.quotationItems
                  .map((entry) => ({
                    quotationId:
                      Number(entry?.quotationId || 0) > 0
                        ? Number(entry.quotationId)
                        : null,
                    items: Array.isArray(entry?.items)
                      ? entry.items
                          .map((item) => ({
                            lineId: String(item?.lineId || "").trim(),
                            productId: Number(item?.productId || 0) || null,
                            code: String(item?.code || "").trim() || "-",
                            description:
                              String(item?.description || "").trim() ||
                              "Sin descripcion",
                            quantity: Number(item?.quantity || 0),
                            unitCostWithDiscount: Number(
                              item?.unitCostWithDiscount || 0,
                            ),
                            isDuplicate: Boolean(item?.isDuplicate),
                            duplicateOfLineId: item?.duplicateOfLineId || null,
                          }))
                          .filter((item) => item.quantity > 0)
                      : [],
                  }))
                  .filter(
                    (entry) =>
                      Number.isInteger(entry.quotationId) &&
                      entry.quotationId > 0 &&
                      entry.items.length,
                  )
              : [];
            return {
              id: String(invoice?.id || "").trim() || `inv-${Date.now()}`,
              invoiceNumber: String(invoice?.invoiceNumber || "").trim(),
              invoiceDate: String(invoice?.invoiceDate || "").trim(),
              quotationIds,
              quotationItems,
              createdAt: String(invoice?.createdAt || "").trim() || null,
            };
          })
          .filter((invoice) => invoice.invoiceNumber)
      : [];
    return { selectedQuotationIds, invoices };
  } catch {
    return {
      selectedQuotationIds: [],
      invoices: [],
    };
  }
}

function saveInvoicingState(state) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      INVOICING_STATE_STORAGE_KEY,
      JSON.stringify(state),
    );
  } catch {
    // Ignore storage failures and keep UI responsive.
  }
}

function buildQuotationPreviewSubtitle(quotation) {
  const parts = [quotation?.opportunityName, quotation?.proposalName]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const uniqueParts = Array.from(new Set(parts));
  return uniqueParts.join(" · ");
}

function normalizeBaseLineId(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  const duplicateSeparatorIndex = normalized.indexOf("-dup-");
  if (duplicateSeparatorIndex <= 0) return normalized;
  return normalized.slice(0, duplicateSeparatorIndex);
}

function buildInvoiceItemAggregationKey(quotationId, item) {
  const normalizedQuotationId = Number(quotationId || 0);
  if (!Number.isInteger(normalizedQuotationId) || normalizedQuotationId <= 0) {
    return "";
  }

  const productId = Number(item?.productId || item?.id || 0);
  if (Number.isInteger(productId) && productId > 0) {
    return `q${normalizedQuotationId}:p${productId}`;
  }

  const duplicateOfLineId = String(item?.duplicateOfLineId || "").trim();
  const lineId = String(item?.lineId || "").trim();
  const baseLineId = normalizeBaseLineId(duplicateOfLineId || lineId);
  if (baseLineId) {
    return `q${normalizedQuotationId}:l${baseLineId}`;
  }

  const code = String(item?.code || "").trim();
  const description = String(item?.description || "").trim();
  if (code || description) {
    return `q${normalizedQuotationId}:x:${code}|${description}`;
  }

  return "";
}

function buildInvoicedQuantityByItemKey(invoices = [], documentType = "invoice") {
  const map = new Map();
  (Array.isArray(invoices) ? invoices : []).forEach((invoice) => {
    if ((invoice.documentType || "invoice") !== documentType) return;
    (Array.isArray(invoice?.quotationItems) ? invoice.quotationItems : []).forEach(
      (entry) => {
        const quotationId = Number(entry?.quotationId || 0);
        (Array.isArray(entry?.items) ? entry.items : []).forEach((item) => {
          const itemKey = buildInvoiceItemAggregationKey(quotationId, item);
          if (!itemKey) return;
          const quantity = Math.max(0, Number(item?.quantity || 0));
          map.set(itemKey, Number(map.get(itemKey) || 0) + quantity);
        });
      },
    );
  });
  return map;
}

function resolveInvoiceCoverageStatus(originalQuantity, invoicedQuantity) {
  const original = Math.max(0, Number(originalQuantity || 0));
  const invoiced = Math.max(0, Number(invoicedQuantity || 0));
  if (original <= 0) return "sin-base";
  if (invoiced <= 0) return "no-facturado";
  if (invoiced + 1e-9 < original) return "parcial";
  return "completo";
}

function getInvoiceCoverageStatusLabel(statusCode) {
  switch (String(statusCode || "").trim()) {
    case "completo":
      return "Completo";
    case "parcial":
      return "Parcial";
    case "sin-base":
      return "Sin base";
    default:
      return "No facturado";
  }
}

function getInvoiceCoverageStatusPalette(statusCode) {
  switch (String(statusCode || "").trim()) {
    case "completo":
      return {
        background: "#dcfce7",
        border: "1px solid #86efac",
        color: "#166534",
      };
    case "parcial":
      return {
        background: "#fef9c3",
        border: "1px solid #fde047",
        color: "#854d0e",
      };
    case "sin-base":
      return {
        background: "#ede9fe",
        border: "1px solid #c4b5fd",
        color: "#5b21b6",
      };
    default:
      return {
        background: "#e2e8f0",
        border: "1px solid #cbd5e1",
        color: "#334155",
      };
  }
}

function roundInvoiceMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function getDocumentOriginalTotal(document) {
  if (document.totalAmount != null) return Number(document.totalAmount);
  const entries = Array.isArray(document.quotationItems) ? document.quotationItems : [];
  const items = entries.flatMap((entry) => Array.isArray(entry.items) ? entry.items : []);
  if (!items.length) return null;
  const subtotal = roundInvoiceMoney(items.reduce((sum, item) =>
    sum + Number(item.quantity) * Number(item.unitCostWithDiscount), 0));
  return roundInvoiceMoney(subtotal + roundInvoiceMoney(subtotal * 0.16));
}

export default function InvoicingPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [invoiceDateDraft, setInvoiceDateDraft] = useState("");
  const [selectedQuotationIds, setSelectedQuotationIds] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [invoicePreviewModalOpen, setInvoicePreviewModalOpen] = useState(false);
  const [invoicePreviewLoading, setInvoicePreviewLoading] = useState(false);
  const [invoicePreviewError, setInvoicePreviewError] = useState("");
  const [invoicePreviewRows, setInvoicePreviewRows] = useState([]);
  const [showCompletedPreviewItems, setShowCompletedPreviewItems] = useState(false);
  const [invoiceModelModalOpen, setInvoiceModelModalOpen] = useState(false);
  const [pendingInvoiceModel, setPendingInvoiceModel] = useState(null);
  const [invoiceModelMode, setInvoiceModelMode] = useState("create");
  const [documentSaving, setDocumentSaving] = useState(false);
  const [documentError, setDocumentError] = useState("");
  const [conversionInvoice, setConversionInvoice] = useState(null);
  const [conversionDate, setConversionDate] = useState("");
  const [conversionError, setConversionError] = useState("");
  const [documentFilters, setDocumentFilters] = useState({
    startDate: "", endDate: "", documentType: "", accountId: "",
  });
  const documentRate = useInvoiceExchangeRate();
  const conversionRate = useInvoiceExchangeRate();
  const invalidDocumentDateRange = Boolean(documentFilters.startDate && documentFilters.endDate &&
    documentFilters.startDate > documentFilters.endDate);
  const documentAccounts = useMemo(() => {
    const accounts = new Map();
    invoices.forEach((invoice) => {
      if (invoice.accountId != null) {
        accounts.set(String(invoice.accountId), invoice.accountName || `Cuenta ${invoice.accountId}`);
      }
    });
    return [...accounts].sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [invoices]);
  const filteredDocuments = invoices.filter((invoice) =>
    !invalidDocumentDateRange &&
    (!documentFilters.startDate || (invoice.invoiceDate && invoice.invoiceDate >= documentFilters.startDate)) &&
    (!documentFilters.endDate || (invoice.invoiceDate && invoice.invoiceDate <= documentFilters.endDate)) &&
    (!documentFilters.documentType || (invoice.documentType || "invoice") === documentFilters.documentType) &&
    (!documentFilters.accountId || String(invoice.accountId) === documentFilters.accountId),
  );

  async function loadAcceptedQuotations() {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get(
        "/api/quotations?latestStatusCodes=aceptada",
      );
      setRows(Array.isArray(data) ? data : []);
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar las cotizaciones aceptadas",
        ),
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadInvoices() {
    setInvoicesLoading(true);
    try {
      const { data } = await api.get("/api/quotation-invoices");
      const documents = Array.isArray(data) ? data : [];
      setInvoices(documents);
      return documents;
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "No fue posible cargar facturas y prefacturas"));
      return null;
    } finally {
      setInvoicesLoading(false);
    }
  }

  useEffect(() => {
    void loadAcceptedQuotations();
    void loadInvoices();
  }, []);

  useEffect(() => {
    const persisted = loadInvoicingState();
    setSelectedQuotationIds(persisted.selectedQuotationIds);
  }, []);

  useEffect(() => {
    saveInvoicingState({ selectedQuotationIds, invoices: [] });
  }, [selectedQuotationIds]);

  function toggleQuotationSelection(quotationId) {
    const normalizedId = Number(quotationId || 0);
    if (!Number.isInteger(normalizedId) || normalizedId <= 0) return;

    setSelectedQuotationIds((current) => {
      if (current.includes(normalizedId)) {
        return current.filter((id) => id !== normalizedId);
      }
      return [...current, normalizedId];
    });
  }

  function getNormalizedSelectedQuotationIds() {
    return Array.from(
      new Set(
        selectedQuotationIds
          .map((id) => Number(id || 0))
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    );
  }

  async function openInvoicePreviewModal() {
    const selectedIds = getNormalizedSelectedQuotationIds();
    if (!selectedIds.length) {
      setError("Selecciona al menos una cotizacion para incluir en la factura");
      return;
    }

    setInvoicePreviewModalOpen(true);
    setInvoicePreviewLoading(true);
    setInvoicePreviewError("");
    setInvoicePreviewRows([]);
    setShowCompletedPreviewItems(false);

    try {
      const currentInvoices = await loadInvoices();
      if (!currentInvoices) {
        setInvoicePreviewError("No fue posible consultar las cantidades facturadas y reservadas. Actualiza e intenta nuevamente.");
        return;
      }
      const selectedQuotationMap = new Map(
        rows
          .filter((item) => selectedIds.includes(Number(item.id || 0)))
          .map((item) => [Number(item.id || 0), item]),
      );

      const invoicedQuantityByItemKey = buildInvoicedQuantityByItemKey(currentInvoices);
      const reservedQuantityByItemKey = buildInvoicedQuantityByItemKey(currentInvoices, "preinvoice");

      const responses = await Promise.all(
        selectedIds.map(async (quotationId) => {
          const { data } = await api.get(
            `/api/quotations/${quotationId}/processing`,
          );
          const quotationHeader = selectedQuotationMap.get(quotationId) || null;
          const products = Array.isArray(data?.quotation?.products)
            ? data.quotation.products
            : [];
          return {
            quotationId,
            accountName:
              data?.quotation?.accountName || quotationHeader?.accountName || "-",
            opportunityName:
              data?.quotation?.opportunityName ||
              quotationHeader?.opportunityName ||
              "-",
            proposalName:
              data?.quotation?.proposalName || quotationHeader?.latestProposalName || "-",
            currencyCode:
              data?.quotation?.latestCurrencyCode ||
              quotationHeader?.latestCurrencyCode ||
              "USD",
            products: products.map((item, index) => {
              const originalQuantity = Number(item?.quantity || 0);
              const unitCostWithDiscount = Number(item?.unitCostWithDiscount || 0);
              const lineId = `q${quotationId}-p${Number(item?.id || 0)}-r${index + 1}`;
              const baseItemKey = buildInvoiceItemAggregationKey(quotationId, {
                id: item?.id,
                lineId,
                code: item?.code,
                description: item?.description,
                duplicateOfLineId: null,
              });
              const invoicedQuantity = Math.max(
                0,
                Number(invoicedQuantityByItemKey.get(baseItemKey) || 0),
              );
              const reservedQuantity = Math.max(0, Number(reservedQuantityByItemKey.get(baseItemKey) || 0));
              const pendingQuantity = Math.max(0, originalQuantity - invoicedQuantity - reservedQuantity);
              const coverageStatus = resolveInvoiceCoverageStatus(
                originalQuantity,
                invoicedQuantity,
              );
              return {
                lineId,
                id: Number(item?.id || 0) || null,
                code: String(item?.code || "").trim() || "-",
                description:
                  String(item?.description || "").trim() || "Sin descripcion",
                quantity: pendingQuantity,
                originalQuantity,
                invoicedQuantity,
                reservedQuantity,
                pendingQuantity,
                maxInvoiceableQuantity: pendingQuantity,
                baseItemKey,
                coverageStatus,
                unitCostWithDiscount,
                includedInInvoice: pendingQuantity > 0,
                isDuplicate: false,
                duplicateOfLineId: null,
              };
            }),
          };
        }),
      );

      setInvoicePreviewRows(responses);
    } catch (previewError) {
      setInvoicePreviewError(
        getApiErrorMessage(
          previewError,
          "No fue posible cargar los items de las cotizaciones seleccionadas",
        ),
      );
    } finally {
      setInvoicePreviewLoading(false);
    }
  }

  function closeInvoicePreviewModal() {
    if (invoicePreviewLoading || documentSaving) return;
    setInvoicePreviewModalOpen(false);
    setInvoicePreviewError("");
    setInvoicePreviewRows([]);
    setShowCompletedPreviewItems(false);
  }

  function closeInvoiceModelModal() {
    if (documentSaving) return;
    setInvoiceModelModalOpen(false);
    setPendingInvoiceModel(null);
    setInvoiceModelMode("create");
    setDocumentError("");
  }

  function openStoredInvoiceModel(invoice) {
    const quotationItems = Array.isArray(invoice?.quotationItems)
      ? invoice.quotationItems
      : [];
    const fallbackItems = (Array.isArray(invoice?.quotationIds)
      ? invoice.quotationIds
      : []
    )
      .map((quotationId) => {
        const quotation = rows.find(
          (item) => Number(item.id || 0) === Number(quotationId || 0),
        );
        if (!quotation) return null;
        return {
          lineId: `fallback-q-${quotationId}`,
          productId: null,
          code: `Q-${quotationId}`,
          description: String(quotation.opportunityName || "Cotizacion").trim(),
          quantity: 1,
          unitCostWithDiscount: Number(quotation.latestTotalSaleAmount || 0),
          isDuplicate: false,
          duplicateOfLineId: null,
        };
      })
      .filter(Boolean);

    const selectedItems = quotationItems.length
      ? quotationItems.flatMap((entry) =>
          Array.isArray(entry?.items) ? entry.items : [],
        )
      : fallbackItems;

    const calculatedSubtotal = roundInvoiceMoney(selectedItems.reduce(
      (sum, item) =>
        sum + Number(item.quantity || 0) * Number(item.unitCostWithDiscount || 0),
      0,
    ));
    const subtotal = invoice.subtotal ?? calculatedSubtotal;
    const ivaPct = 16;
    const ivaAmount = invoice.ivaAmount ?? roundInvoiceMoney(subtotal * (ivaPct / 100));
    const total = invoice.totalAmount ?? roundInvoiceMoney(subtotal + ivaAmount);

    const firstQuotationId = Array.isArray(invoice?.quotationIds)
      ? Number(invoice.quotationIds[0] || 0)
      : 0;
    const firstQuotation = rows.find(
      (item) => Number(item.id || 0) === firstQuotationId,
    );
    const customerName = String(firstQuotation?.accountName || "Cliente").trim();
    const currencyCode =
      invoice.currencyCode || String(firstQuotation?.latestCurrencyCode || "USD").trim() || "USD";

    setPendingInvoiceModel({
      id: String(invoice?.id || "").trim() || `inv-${Date.now()}`,
      invoiceNumber: String(invoice?.invoiceNumber || "").trim() || "",
      documentType: invoice.documentType || "invoice",
      invoiceDate: String(invoice?.invoiceDate || "").trim() || "",
      quotationIds: Array.isArray(invoice?.quotationIds)
        ? invoice.quotationIds
        : [],
      quotationItems,
      createdAt: invoice?.createdAt || null,
      model: {
        companyName: "ACCESS QUALITY SA DE CV",
        fiscalRfc: "AQJ10118VA2",
        customerName,
        paymentMethodLabel: "PPD Pago en parcialidades o diferido",
        cfdIUse: "G03 Gastos en general",
        currencyCode,
        exchangeRate: invoice.exchangeRate ?? null,
        totalUsd: invoice.totalUsd ?? null,
        exchangeRateDate: invoice.exchangeRateDate || null,
        subtotal,
        ivaPct,
        ivaAmount,
        total,
        selectedItems,
      },
    });
    setInvoiceModelMode("view");
    setInvoiceModelModalOpen(true);
  }

  async function deleteStoredInvoice(invoiceId) {
    if (documentSaving) return;
    const normalizedId = String(invoiceId || "").trim();
    if (!normalizedId) return;
    const isPreinvoice = invoices.find((item) => String(item.id) === normalizedId)?.documentType === "preinvoice";
    const shouldDelete = window.confirm(isPreinvoice
      ? "Se eliminara la prefactura y se liberaran sus cantidades reservadas. Esta accion no se puede deshacer."
      : "Se eliminara la factura seleccionada. Esta accion no se puede deshacer.");
    if (!shouldDelete) return;

    setDocumentSaving(true);
    try {
      await api.delete(`/api/quotation-invoices/${normalizedId}`);
      setInvoices((current) =>
        current.filter((item) => String(item.id || "").trim() !== normalizedId),
      );
    } catch (deleteError) {
      setError(getApiErrorMessage(deleteError, "No fue posible eliminar la factura"));
      return;
    } finally {
      setDocumentSaving(false);
    }

    if (String(pendingInvoiceModel?.id || "").trim() === normalizedId) {
      closeInvoiceModelModal();
    }
  }

  function togglePreviewItemIncluded(quotationId, lineId) {
    setInvoicePreviewError("");
    setInvoicePreviewRows((current) =>
      current.map((quotation) => {
        if (Number(quotation.quotationId || 0) !== Number(quotationId || 0)) {
          return quotation;
        }
        return {
          ...quotation,
          products: (Array.isArray(quotation.products)
            ? quotation.products
            : []
          ).map((item) => {
            if (String(item.lineId) !== String(lineId)) return item;
            const maxInvoiceableQuantity = Math.max(
              0,
              Number(item.maxInvoiceableQuantity || 0),
            );
            if (maxInvoiceableQuantity <= 0) {
              return {
                ...item,
                includedInInvoice: false,
                quantity: 0,
              };
            }
            return {
              ...item,
              includedInInvoice: !Boolean(item.includedInInvoice),
            };
          }),
        };
      }),
    );
  }

  function updatePreviewItemQuantity(quotationId, lineId, rawValue) {
    setInvoicePreviewError("");
    const parsed = Number(rawValue);
    const normalized = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    setInvoicePreviewRows((current) =>
      current.map((quotation) => {
        if (Number(quotation.quotationId || 0) !== Number(quotationId || 0)) {
          return quotation;
        }
        return {
          ...quotation,
          products: (Array.isArray(quotation.products)
            ? quotation.products
            : []
          ).map((item) => {
            if (String(item.lineId) !== String(lineId)) return item;
            const maxInvoiceableQuantity = Math.max(
              0,
              Number(item.maxInvoiceableQuantity || 0),
            );
            return {
              ...item,
              quantity: Math.min(normalized, maxInvoiceableQuantity),
              includedInInvoice:
                maxInvoiceableQuantity > 0
                  ? Boolean(item.includedInInvoice)
                  : false,
            };
          }),
        };
      }),
    );
  }

  function duplicatePreviewItem(quotationId, lineId) {
    setInvoicePreviewRows((current) =>
      current.map((quotation) => {
        if (Number(quotation.quotationId || 0) !== Number(quotationId || 0)) {
          return quotation;
        }

        const sourceItems = Array.isArray(quotation.products)
          ? quotation.products
          : [];
        const sourceIndex = sourceItems.findIndex(
          (item) => String(item.lineId) === String(lineId),
        );
        if (sourceIndex === -1) return quotation;

        const sourceItem = sourceItems[sourceIndex];
        const duplicateItem = {
          ...sourceItem,
          lineId: `${sourceItem.lineId}-dup-${Date.now()}-${Math.round(
            Math.random() * 1000,
          )}`,
          quantity: 0,
          isDuplicate: true,
          duplicateOfLineId: sourceItem.duplicateOfLineId || sourceItem.lineId,
          includedInInvoice: false,
        };

        const nextProducts = [...sourceItems];
        nextProducts.splice(sourceIndex + 1, 0, duplicateItem);
        return {
          ...quotation,
          products: nextProducts,
        };
      }),
    );
  }

  function removePreviewDuplicateItem(quotationId, lineId) {
    setInvoicePreviewError("");
    setInvoicePreviewRows((current) =>
      current.map((quotation) => {
        if (Number(quotation.quotationId || 0) !== Number(quotationId || 0)) {
          return quotation;
        }
        return {
          ...quotation,
          products: (Array.isArray(quotation.products)
            ? quotation.products
            : []
          ).filter(
            (item) =>
              !(
                String(item.lineId) === String(lineId) &&
                Boolean(item.isDuplicate)
              ),
          ),
        };
      }),
    );
  }

  function buildInvoiceFromSelection(documentType) {
    const selectedIds = getNormalizedSelectedQuotationIds();
    if (!selectedIds.length) {
      setError("Selecciona al menos una cotizacion para incluir en la factura");
      return null;
    }

    const requestedQuantityByItemKey = new Map();
    const maxInvoiceableByItemKey = new Map();
    const itemLabelByItemKey = new Map();

    const selectedItemsByQuotation = invoicePreviewRows
      .map((quotation) => {
        const quotationId = Number(quotation?.quotationId || 0);
        const includedItems = (Array.isArray(quotation?.products)
          ? quotation.products
          : []
        )
          .filter((item) => Boolean(item?.includedInInvoice))
          .map((item) => ({
            lineId: String(item?.lineId || "").trim(),
            productId: Number(item?.id || 0) || null,
            code: String(item?.code || "").trim() || "-",
            description: String(item?.description || "").trim() || "Sin descripcion",
            quantity: Number(item?.quantity || 0),
            unitCostWithDiscount: Number(item?.unitCostWithDiscount || 0),
            isDuplicate: Boolean(item?.isDuplicate),
            duplicateOfLineId: item?.duplicateOfLineId || null,
            baseItemKey:
              String(item?.baseItemKey || "").trim() ||
              buildInvoiceItemAggregationKey(quotationId, item),
            maxInvoiceableQuantity: Math.max(
              0,
              Number(item?.maxInvoiceableQuantity || 0),
            ),
          }))
          .filter((item) => item.quantity > 0);

        includedItems.forEach((item) => {
          const itemKey = `${quotationId}|${item.baseItemKey}`;
          const requestedQuantity = Math.max(0, Number(item.quantity || 0));
          const maxInvoiceableQuantity = Math.max(
            0,
            Number(item.maxInvoiceableQuantity || 0),
          );
          requestedQuantityByItemKey.set(
            itemKey,
            Number(requestedQuantityByItemKey.get(itemKey) || 0) + requestedQuantity,
          );
          maxInvoiceableByItemKey.set(itemKey, maxInvoiceableQuantity);
          itemLabelByItemKey.set(
            itemKey,
            `Cotizacion #${quotationId} · ${item.code} · ${item.description}`,
          );
        });

        return {
          quotationId,
          items: includedItems,
        };
      })
      .filter(
        (entry) =>
          Number.isInteger(entry.quotationId) &&
          entry.quotationId > 0 &&
          entry.items.length > 0,
      );

    if (!selectedItemsByQuotation.length) {
      setInvoicePreviewError(
        "Debes seleccionar al menos un item para incluir en la factura",
      );
      return null;
    }

    const overInvoiceMessages = [];
    requestedQuantityByItemKey.forEach((requestedQuantity, itemKey) => {
      const maxInvoiceableQuantity = Number(maxInvoiceableByItemKey.get(itemKey) || 0);
      if (requestedQuantity > maxInvoiceableQuantity + 1e-9) {
        overInvoiceMessages.push(
          `${itemLabelByItemKey.get(itemKey) || itemKey}: pendiente ${maxInvoiceableQuantity.toLocaleString("es-MX", {
            maximumFractionDigits: 4,
          })}, solicitado ${requestedQuantity.toLocaleString("es-MX", {
            maximumFractionDigits: 4,
          })}`,
        );
      }
    });

    if (overInvoiceMessages.length) {
      setInvoicePreviewError(
        `No puedes facturar mas que el pendiente por item. Corrige estas lineas:\n- ${overInvoiceMessages.join("\n- ")}`,
      );
      return null;
    }

    const normalizedInvoiceDate =
      String(invoiceDateDraft || "").trim() || getTodayBusinessDate();

    const allSelectedItems = selectedItemsByQuotation.flatMap((entry) =>
      Array.isArray(entry.items) ? entry.items : [],
    );
    const subtotal = roundInvoiceMoney(allSelectedItems.reduce(
      (sum, item) =>
        sum + Number(item.quantity || 0) * Number(item.unitCostWithDiscount || 0),
      0,
    ));
    const ivaPct = 16;
    const ivaAmount = roundInvoiceMoney(subtotal * (ivaPct / 100));
    const total = roundInvoiceMoney(subtotal + ivaAmount);

    const includedQuotationIds = selectedItemsByQuotation.map((entry) => entry.quotationId);
    const includedQuotations = rows.filter((item) => includedQuotationIds.includes(Number(item.id)));
    const firstQuotation = includedQuotations[0] || null;
    if (includedQuotations.some((item) =>
      Number(item.accountId) !== Number(firstQuotation?.accountId) ||
      String(item.latestCurrencyCode || "USD") !== String(firstQuotation?.latestCurrencyCode || "USD"))) {
      setInvoicePreviewError("Selecciona items de cotizaciones de la misma cuenta y moneda.");
      return null;
    }
    const customerName = String(firstQuotation?.accountName || "Cliente").trim();
    const currencyCode =
      String(firstQuotation?.latestCurrencyCode || "USD").trim() || "USD";

    return {
      id: `inv-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      invoiceNumber: null,
      documentType,
      invoiceDate: normalizedInvoiceDate,
      quotationIds: includedQuotationIds,
      quotationItems: selectedItemsByQuotation,
      createdAt: new Date().toISOString(),
      model: {
        companyName: "ACCESS QUALITY SA DE CV",
        fiscalRfc: "AQJ10118VA2",
        customerName,
        paymentMethodLabel: "PPD Pago en parcialidades o diferido",
        cfdIUse: "G03 Gastos en general",
        currencyCode,
        subtotal,
        ivaPct,
        ivaAmount,
        total,
        selectedItems: allSelectedItems,
      },
    };
  }

  function openInvoiceModelModal(documentType = "invoice") {
    const pendingInvoice = buildInvoiceFromSelection(documentType);
    if (!pendingInvoice) return;
    setPendingInvoiceModel(pendingInvoice);
    setInvoiceModelMode("create");
    setDocumentError("");
    documentRate.initialize(pendingInvoice.model.currencyCode);
    setInvoiceModelModalOpen(true);
  }

  async function finalizeInvoiceCreation() {
    if (!pendingInvoiceModel || documentSaving) return;
    if (!documentRate.valid || documentRate.loading) {
      setDocumentError("Ingresa un tipo de cambio valido antes de guardar.");
      return;
    }
    const firstQuotationId = pendingInvoiceModel.quotationIds[0] || null;
    const firstQuotation = firstQuotationId
      ? rows.find((r) => Number(r.id || 0) === Number(firstQuotationId))
      : null;
    const accountId = firstQuotation?.accountId ? Number(firstQuotation.accountId) : null;
    setDocumentSaving(true);
    setDocumentError("");
    try {
      await api.post("/api/quotation-invoices", {
        documentType: pendingInvoiceModel.documentType,
        invoiceDate: pendingInvoiceModel.invoiceDate,
        accountId,
        quotationIds: pendingInvoiceModel.quotationIds,
        quotationItems: pendingInvoiceModel.quotationItems,
        ...documentRate.payload,
      });
      await loadInvoices();
    } catch (saveError) {
      setDocumentError(getApiErrorMessage(saveError, "No fue posible guardar el documento"));
      return;
    } finally {
      setDocumentSaving(false);
    }
    setSelectedQuotationIds([]);
    setInvoiceDateDraft("");
    setInvoiceModelModalOpen(false);
    setPendingInvoiceModel(null);
    setInvoicePreviewModalOpen(false);
    setInvoicePreviewRows([]);
  }

  async function convertPreinvoice() {
    if (!conversionInvoice || documentSaving) return;
    if (!conversionRate.valid || conversionRate.loading) {
      setConversionError("Ingresa un tipo de cambio valido antes de convertir.");
      return;
    }
    setDocumentSaving(true);
    setConversionError("");
    try {
      await api.post(`/api/quotation-invoices/${conversionInvoice.id}/convert`, {
        invoiceDate: conversionDate,
        ...conversionRate.payload,
      });
      setConversionInvoice(null);
      await loadInvoices();
    } catch (requestError) {
      setConversionError(getApiErrorMessage(requestError, "No fue posible convertir la prefactura"));
    } finally {
      setDocumentSaving(false);
    }
  }
  const totalAmount = useMemo(
    () => rows.reduce((sum, item) => sum + Number(item?.latestTotalSaleAmount || 0), 0),
    [rows],
  );

  const invoicesByQuotationId = useMemo(() => {
    const map = new Map();
    invoices.forEach((invoice) => {
      if (invoice.documentType === "preinvoice") return;
      const invoiceLabel = String(invoice.invoiceNumber || "").trim();
      if (!invoiceLabel) return;
      (Array.isArray(invoice.quotationIds) ? invoice.quotationIds : []).forEach(
        (quotationId) => {
          const normalizedId = Number(quotationId || 0);
          if (!Number.isInteger(normalizedId) || normalizedId <= 0) return;
          const current = map.get(normalizedId) || [];
          current.push(invoiceLabel);
          map.set(normalizedId, current);
        },
      );
    });
    return map;
  }, [invoices]);

  const amountsByQuotationId = useMemo(() => {
    const map = new Map();
    invoices.forEach((invoice) => {
      (Array.isArray(invoice?.quotationItems) ? invoice.quotationItems : []).forEach(
        (entry) => {
          const quotationId = Number(entry?.quotationId || 0);
          if (!Number.isInteger(quotationId) || quotationId <= 0) return;
          const amount = (Array.isArray(entry?.items) ? entry.items : []).reduce(
            (sum, item) =>
              sum +
              Math.max(0, Number(item?.quantity || 0)) *
                Math.max(0, Number(item?.unitCostWithDiscount || 0)),
            0,
          );
          const totals = map.get(quotationId) || { invoiced: 0, reserved: 0 };
          if (invoice.documentType === "preinvoice") totals.reserved += amount;
          else totals.invoiced += amount;
          map.set(quotationId, totals);
        },
      );
    });
    return map;
  }, [invoices]);

  const selectedTotalAmount = useMemo(
    () =>
      rows
        .filter((item) => selectedQuotationIds.includes(Number(item.id || 0)))
        .reduce(
          (sum, item) => sum + Number(item?.latestTotalSaleAmount || 0),
          0,
        ),
    [rows, selectedQuotationIds],
  );

  return (
    <section>
      <header className="page-header" style={{ marginBottom: 16 }}>
        <h2>Facturación a clientes</h2>
        <p>Listado de cotizaciones aceptadas para seguimiento de facturacion.</p>
      </header>

      <div className="panel" style={{ padding: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            marginBottom: 12,
            flexWrap: "wrap",
          }}
        >
          <strong>
            {loading
              ? "Cargando..."
              : `${rows.length} cotizacion(es) aceptada(s)`}
          </strong>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => { void loadAcceptedQuotations(); void loadInvoices(); }}
            disabled={loading || invoicesLoading}
          >
            {loading || invoicesLoading ? "Actualizando..." : "Actualizar"}
          </button>
        </div>

        <section
          className="panel"
          style={{
            marginBottom: 14,
            padding: 12,
            border: "1px solid #dbe6f5",
            borderRadius: 10,
          }}
        >
          <header style={{ marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>Crear factura o prefactura</h3>
            <p style={{ margin: "4px 0 0", color: "#4b5563" }}>
              Una factura puede incluir una o mas cotizaciones, y una cotizacion
              puede pertenecer a una o mas facturas.
            </p>
          </header>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 10,
              alignItems: "end",
            }}
          >
            <label className="field-group" style={{ marginBottom: 0 }}>
              <span>Numero de factura</span>
              <input
                type="text"
                value="Se asigna al crear o convertir en factura"
                readOnly
                disabled
              />
            </label>

            <label className="field-group" style={{ marginBottom: 0 }}>
              <span>Fecha del documento</span>
              <input
                type="date"
                value={invoiceDateDraft}
                onChange={(event) => setInvoiceDateDraft(event.target.value)}
              />
            </label>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void openInvoicePreviewModal()}
                disabled={!selectedQuotationIds.length || invoicesLoading || documentSaving}
              >
                Crear factura con seleccionadas
              </button>
            </div>
          </div>

          <div style={{ marginTop: 10, color: "#334155", fontSize: 14 }}>
            Seleccionadas: {selectedQuotationIds.length} cotizacion(es) · Total
            seleccionado: {formatCurrency(selectedTotalAmount, rows[0]?.latestCurrencyCode || "USD")}
          </div>
        </section>

        {error ? (
          <p className="status-text error" style={{ marginBottom: 12 }}>
            {error}
          </p>
        ) : null}

        {rows.length ? (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th className="is-center">Incluir</th>
                  <th>ID</th>
                  <th>Cuenta</th>
                  <th>Oportunidad</th>
                  <th>Vendedor</th>
                  <th>Moneda</th>
                  <th>Fecha cotizacion</th>
                  <th>Facturas asociadas</th>
                  <th>Estado facturacion</th>
                  <th className="is-right">Facturado</th>
                  <th className="is-right">Reservado en prefacturas</th>
                  <th className="is-right">Disponible</th>
                  <th className="is-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => {
                  const quotationId = Number(item.id || 0);
                  const quotationTotalAmount = Math.max(
                    0,
                    Number(item?.latestBaseSaleTotal ?? item?.latestTotalSaleAmount ?? 0),
                  );
                  const invoicedAmount = Math.max(
                    0,
                    Number(amountsByQuotationId.get(quotationId)?.invoiced || 0),
                  );
                  const reservedAmount = Math.max(0, Number(amountsByQuotationId.get(quotationId)?.reserved || 0));
                  const pendingAmount = Math.max(
                    0,
                    quotationTotalAmount - invoicedAmount - reservedAmount,
                  );
                  const amountStatusCode = resolveInvoiceCoverageStatus(
                    quotationTotalAmount,
                    invoicedAmount,
                  );
                  return (
                  <tr key={item.id}>
                    <td className="is-center">
                      <input
                        type="checkbox"
                        checked={selectedQuotationIds.includes(Number(item.id || 0))}
                        onChange={() => toggleQuotationSelection(item.id)}
                        aria-label={`Incluir cotizacion ${Number(item.id || 0)} en facturacion`}
                      />
                    </td>
                    <td>{Number(item.id || 0)}</td>
                    <td>{item.accountName || "-"}</td>
                    <td>{item.opportunityName || "-"}</td>
                    <td>{item.sellerUserName || "-"}</td>
                    <td>{item.latestCurrencyCode || "USD"}</td>
                    <td>{formatDate(item.latestQuotationDate)}</td>
                    <td>
                      {(invoicesByQuotationId.get(Number(item.id || 0)) || []).length ? (
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 6,
                          }}
                        >
                          {(invoicesByQuotationId.get(Number(item.id || 0)) || []).map(
                            (invoiceLabel, index) => (
                              <span
                                key={`${item.id}-${invoiceLabel}-${index}`}
                                style={{
                                  background: "#eef6ff",
                                  border: "1px solid #cfe2ff",
                                  color: "#1e3a8a",
                                  borderRadius: 999,
                                  padding: "2px 8px",
                                  fontSize: 12,
                                  fontWeight: 600,
                                }}
                              >
                                {invoiceLabel}
                              </span>
                            ),
                          )}
                        </div>
                      ) : (
                        <span style={{ color: "#64748b" }}>Sin facturas</span>
                      )}
                    </td>
                    <td>
                      <span
                        style={{
                          ...getInvoiceCoverageStatusPalette(amountStatusCode),
                          borderRadius: 999,
                          padding: "2px 8px",
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        {getInvoiceCoverageStatusLabel(amountStatusCode)}
                      </span>
                    </td>
                    <td className="is-right">
                      {formatCurrency(invoicedAmount, item.latestCurrencyCode || "USD")}
                    </td>
                    <td className="is-right">
                      {formatCurrency(reservedAmount, item.latestCurrencyCode || "USD")}
                    </td>
                    <td className="is-right">
                      {formatCurrency(
                        pendingAmount,
                        item.latestCurrencyCode || "USD",
                      )}
                    </td>
                    <td className="is-right">
                      {formatCurrency(
                        item.latestTotalSaleAmount,
                        item.latestCurrencyCode || "USD",
                      )}
                    </td>
                  </tr>
                )})}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={12} className="is-right">
                    Total acumulado
                  </th>
                  <th className="is-right">
                    {formatCurrency(totalAmount, rows[0]?.latestCurrencyCode || "USD")}
                  </th>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : !loading ? (
          <p className="status-text">No hay cotizaciones aceptadas para mostrar.</p>
        ) : null}

        <section
          className="panel"
          style={{
            marginTop: 14,
            padding: 12,
            border: "1px solid #dbe6f5",
            borderRadius: 10,
          }}
        >
          <header style={{ marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>Facturas y prefacturas registradas</h3>
          </header>

          <div className="invoice-document-filters" role="group" aria-label="Filtros de documentos registrados">
            <label className="field-group">
              <span>Fecha de inicio</span>
              <input type="date" value={documentFilters.startDate}
                onChange={(event) => setDocumentFilters((current) => ({ ...current, startDate: event.target.value }))} />
            </label>
            <label className="field-group">
              <span>Fecha de fin</span>
              <input type="date" value={documentFilters.endDate}
                onChange={(event) => setDocumentFilters((current) => ({ ...current, endDate: event.target.value }))} />
            </label>
            <label className="field-group">
              <span>Tipo de documento</span>
              <select value={documentFilters.documentType}
                onChange={(event) => setDocumentFilters((current) => ({ ...current, documentType: event.target.value }))}>
                <option value="">Todos</option>
                <option value="invoice">Factura</option>
                <option value="preinvoice">Prefactura</option>
              </select>
            </label>
            <label className="field-group">
              <span>Cuenta</span>
              <select aria-label="Cuenta" value={documentFilters.accountId}
                onChange={(event) => setDocumentFilters((current) => ({ ...current, accountId: event.target.value }))}>
                <option value="">Todas las cuentas</option>
                {documentAccounts.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <button type="button" className="btn-secondary"
              onClick={() => setDocumentFilters({ startDate: "", endDate: "", documentType: "", accountId: "" })}>
              Limpiar filtros
            </button>
          </div>
          <p className="field-hint">Las fechas corresponden a la fecha del documento.</p>
          {invalidDocumentDateRange && (
            <p className="status-text error" role="alert">La fecha de inicio no puede ser posterior a la fecha de fin.</p>
          )}
          <p className="field-hint" role="status">Mostrando {filteredDocuments.length} de {invoices.length} documentos</p>

          {filteredDocuments.length ? (
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Nombre de oportunidad</th>
                    <th>Nombre de cuenta</th>
                    <th>Numero de factura</th>
                    <th>Tipo</th>
                    <th>Fecha del documento</th>
                    <th>IDs de cotizaciones</th>
                    <th className="is-right">Monto en moneda del documento</th>
                    <th className="is-right">Tipo de cambio a USD</th>
                    <th className="is-right">Monto en USD</th>
                    <th className="is-center">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDocuments.map((invoice) => (
                    <tr key={invoice.id}>
                      <td>{Array.isArray(invoice.opportunityNames) && invoice.opportunityNames.length
                        ? invoice.opportunityNames.join(", ") : "No disponible"}</td>
                      <td>{invoice.accountName || "No disponible"}</td>
                      <td>{invoice.documentType === "preinvoice" ? "Sin asignar" : invoice.invoiceNumber}</td>
                      <td>{invoice.documentType === "preinvoice" ? "Prefactura" : "Factura"}</td>
                      <td>{formatDate(invoice.invoiceDate)}</td>
                      <td>
                        {(Array.isArray(invoice.quotationIds)
                          ? invoice.quotationIds
                          : []
                        ).length
                          ? invoice.quotationIds.join(", ")
                          : "Sin cotizaciones"}
                      </td>
                      <td className="is-right">{invoice.currencyCode && invoice.totalAmount != null
                        ? formatCurrency(invoice.totalAmount, invoice.currencyCode, "code") : "No disponible"}</td>
                      <td className="is-right">{invoice.currencyCode && invoice.exchangeRate != null
                        ? `1 USD = ${invoice.exchangeRate} ${invoice.currencyCode}` : "No disponible"}</td>
                      <td className="is-right">{invoice.totalUsd != null
                        ? formatCurrency(invoice.totalUsd, "USD") : "No disponible"}</td>
                      <td className="is-center">
                        <div
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <button
                            type="button"
                            className="btn-secondary processing-product-action-icon"
                            aria-label={invoice.documentType === "preinvoice" ? `Ver prefactura ${invoice.id}` : `Ver factura ${invoice.invoiceNumber || ""}`}
                            title={invoice.documentType === "preinvoice" ? "Ver prefactura" : "Ver factura"}
                            disabled={documentSaving}
                            onClick={() => openStoredInvoiceModel(invoice)}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              focusable="false"
                              aria-hidden="true"
                            >
                              <path d="M12 5c5.3 0 8.7 4.7 9.4 5.8a2.2 2.2 0 0 1 0 2.4C20.7 14.3 17.3 19 12 19s-8.7-4.7-9.4-5.8a2.2 2.2 0 0 1 0-2.4C3.3 9.7 6.7 5 12 5m0 1.5c-4.5 0-7.5 4.1-8.1 5.1a.7.7 0 0 0 0 .8c.6 1 3.6 5.1 8.1 5.1s7.5-4.1 8.1-5.1a.7.7 0 0 0 0-.8c-.6-1-3.6-5.1-8.1-5.1m0 2.25A3.25 3.25 0 1 1 12 15.25 3.25 3.25 0 0 1 12 8.75m0 1.5A1.75 1.75 0 1 0 12 13.75 1.75 1.75 0 0 0 12 10.25" />
                            </svg>
                          </button>
                          {invoice.documentType === "preinvoice" && (
                            <button type="button" className="btn-secondary processing-product-action-icon"
                              disabled={documentSaving}
                              aria-label={`Convertir prefactura ${invoice.id} en factura`}
                              title="Convertir en factura"
                              onClick={() => {
                                setConversionInvoice(invoice);
                                setConversionDate(getTodayBusinessDate());
                                setConversionError("");
                                const currency = invoice.currencyCode ||
                                  rows.find((row) => Number(row.id) === Number(invoice.quotationIds?.[0]))?.latestCurrencyCode || "";
                                conversionRate.initialize(currency, invoice);
                              }}>
                              <svg viewBox="0 0 24 24" style={{ fill: "none" }} stroke="currentColor"
                                strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
                                focusable="false" aria-hidden="true">
                                <path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M13 3v6h6M13 3l6 6" />
                                <path d="M8 15h8m-3-3 3 3-3 3" />
                              </svg>
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn-secondary processing-product-action-icon is-danger"
                            aria-label={invoice.documentType === "preinvoice" ? `Eliminar prefactura ${invoice.id}` : `Eliminar factura ${invoice.invoiceNumber || ""}`}
                            title={invoice.documentType === "preinvoice" ? "Eliminar prefactura" : "Eliminar factura"}
                            disabled={documentSaving}
                            onClick={() => deleteStoredInvoice(invoice.id)}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              focusable="false"
                              aria-hidden="true"
                            >
                              <path d="M9.25 4a.75.75 0 0 1 .75-.75h4a.75.75 0 0 1 .75.75V5h3a.75.75 0 0 1 0 1.5h-.76l-.63 11.01A2.75 2.75 0 0 1 14.37 20h-4.74a2.75 2.75 0 0 1-2.74-2.49L6.26 6.5H5.5a.75.75 0 0 1 0-1.5h3zm1.5.75V5h2.5v-.25zM7.76 6.5l.62 10.92c.04.66.58 1.18 1.25 1.18h4.74c.67 0 1.21-.52 1.25-1.18l.62-10.92z" />
                              <path d="M10.75 9a.75.75 0 0 1 .75.75v5a.75.75 0 0 1-1.5 0v-5a.75.75 0 0 1 .75-.75m2.5 0a.75.75 0 0 1 .75.75v5a.75.75 0 0 1-1.5 0v-5a.75.75 0 0 1 .75-.75" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="status-text">
              {invoices.length
                ? "No hay documentos que coincidan con los filtros."
                : "Aun no hay facturas ni prefacturas registradas en este modulo."}
            </p>
          )}
        </section>
      </div>

      {invoicePreviewModalOpen ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="invoicing-preview-modal-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeInvoicePreviewModal();
            }
          }}
        >
          <div
            className="modal-dialog modal-dialog-wide"
            style={{ width: "min(96vw, 1500px)", maxWidth: "1500px" }}
          >
            <div className="modal-header accept-order-notification-header">
              <h3 id="invoicing-preview-modal-title">
                Items de cotizaciones seleccionadas
              </h3>
            </div>

            <div className="modal-body">
              {invoicePreviewError ? (
                <p className="status-text error">{invoicePreviewError}</p>
              ) : null}

              {invoicePreviewLoading ? (
                <p className="field-hint">Cargando items...</p>
              ) : null}

              {!invoicePreviewLoading && invoicePreviewRows.length > 0 ? (
                <div style={{ maxHeight: "68vh", overflow: "auto", paddingRight: 4 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 10,
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <p style={{ margin: 0, color: "#475569" }}>
                      Ajusta la cantidad a facturar o reservar por item segun el disponible.
                    </p>
                    <label
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 13,
                        color: "#334155",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={showCompletedPreviewItems}
                        onChange={(event) =>
                          setShowCompletedPreviewItems(Boolean(event.target.checked))
                        }
                      />
                      Mostrar items completados o reservados
                    </label>
                  </div>

                  {invoicePreviewRows.map((quotation) => {
                    const originalProducts = quotation.products.filter((item) => !item.isDuplicate);
                    const quotationTotal = quotation.products.reduce(
                      (sum, item) =>
                        Boolean(item.includedInInvoice)
                          ? sum + Number(item.quantity || 0) * Number(item.unitCostWithDiscount || 0)
                          : sum,
                      0,
                    );
                    const quotationQuotedTotal = originalProducts.reduce(
                      (sum, item) =>
                        sum +
                        Math.max(0, Number(item.originalQuantity || 0)) *
                          Math.max(0, Number(item.unitCostWithDiscount || 0)),
                      0,
                    );
                    const quotationInvoicedTotal = originalProducts.reduce(
                      (sum, item) =>
                        sum +
                        Math.min(
                          Math.max(0, Number(item.invoicedQuantity || 0)),
                          Math.max(0, Number(item.originalQuantity || 0)),
                        ) * Math.max(0, Number(item.unitCostWithDiscount || 0)),
                      0,
                    );
                    const quotationReservedTotal = originalProducts.reduce((sum, item) =>
                      sum + Number(item.reservedQuantity || 0) * Math.max(0, Number(item.unitCostWithDiscount || 0)), 0);
                    const quotationPendingTotal = Math.max(
                      0, quotationQuotedTotal - quotationInvoicedTotal - quotationReservedTotal,
                    );
                    const visibleProducts = showCompletedPreviewItems
                      ? quotation.products
                      : quotation.products.filter(
                          (item) => Number(item.pendingQuantity || 0) > 0,
                        );
                    const subtitle = buildQuotationPreviewSubtitle(quotation);
                    return (
                      <section key={quotation.quotationId} style={{ marginBottom: 14 }}>
                        <header style={{ marginBottom: 8 }}>
                          <h4 style={{ margin: 0, fontSize: 15 }}>
                            Cotizacion #{quotation.quotationId} · {quotation.accountName}
                          </h4>
                          {subtitle ? (
                            <p style={{ margin: "2px 0 0", color: "#475569" }}>
                              {subtitle}
                            </p>
                          ) : null}
                          <p
                            style={{
                              margin: "4px 0 0",
                              color: "#475569",
                              fontSize: 13,
                            }}
                          >
                            Facturado: {formatCurrency(quotationInvoicedTotal, quotation.currencyCode)} · Reservado: {formatCurrency(quotationReservedTotal, quotation.currencyCode)} · Disponible: {formatCurrency(quotationPendingTotal, quotation.currencyCode)}
                          </p>
                        </header>

                        {visibleProducts.length ? (
                          <div style={{ overflowX: "auto" }}>
                            <table className="table">
                              <thead>
                                <tr>
                                  <th className="is-center">Factura</th>
                                  <th>Codigo</th>
                                  <th>Descripcion</th>
                                  <th className="is-right">Cantidad a facturar o reservar</th>
                                  <th className="is-right">Facturado</th>
                                  <th className="is-right">Reservado</th>
                                  <th className="is-right">Disponible</th>
                                  <th className="is-right">Costo unitario</th>
                                  <th className="is-right">Total</th>
                                  <th className="is-center">Estado</th>
                                  <th className="is-center">Acciones</th>
                                </tr>
                              </thead>
                              <tbody>
                                {visibleProducts.map((item, index) => (
                                  <tr key={`${quotation.quotationId}-${item.id || item.code}-${index}`}>
                                    <td className="is-center">
                                      <input
                                        type="checkbox"
                                        checked={Boolean(item.includedInInvoice)}
                                        disabled={Number(item.maxInvoiceableQuantity || 0) <= 0}
                                        onChange={() =>
                                          togglePreviewItemIncluded(
                                            quotation.quotationId,
                                            item.lineId,
                                          )
                                        }
                                        aria-label={`Incluir item ${item.code} en factura`}
                                      />
                                    </td>
                                    <td>{item.code}</td>
                                    <td>
                                      {item.description}
                                      {item.isDuplicate ? (
                                        <span
                                          style={{
                                            marginLeft: 8,
                                            fontSize: 11,
                                            borderRadius: 999,
                                            padding: "1px 7px",
                                            background: "#e6fffa",
                                            border: "1px solid #99f6e4",
                                            color: "#115e59",
                                            fontWeight: 600,
                                          }}
                                        >
                                          Copia
                                        </span>
                                      ) : null}
                                    </td>
                                    <td className="is-right">
                                      <input
                                        type="number"
                                        aria-label={`Cantidad ${item.code}`}
                                        min="0"
                                        step="0.0001"
                                        max={Math.max(0, Number(item.maxInvoiceableQuantity || 0))}
                                        value={String(Number(item.quantity || 0))}
                                        onChange={(event) =>
                                          updatePreviewItemQuantity(
                                            quotation.quotationId,
                                            item.lineId,
                                            event.target.value,
                                          )
                                        }
                                        disabled={!Boolean(item.includedInInvoice)}
                                        style={{
                                          width: 92,
                                          textAlign: "right",
                                        }}
                                      />
                                    </td>
                                    <td className="is-right">{Number(item.invoicedQuantity || 0)}</td>
                                    <td className="is-right">{Number(item.reservedQuantity || 0)}</td>
                                    <td className="is-right">{Number(item.pendingQuantity || 0)}</td>
                                    <td className="is-right">
                                      {formatCurrency(
                                        item.unitCostWithDiscount,
                                        quotation.currencyCode,
                                      )}
                                    </td>
                                    <td className="is-right">
                                      {formatCurrency(
                                        Number(item.quantity || 0) *
                                          Number(item.unitCostWithDiscount || 0),
                                        quotation.currencyCode,
                                      )}
                                    </td>
                                    <td className="is-center">
                                      <span
                                        style={{
                                          ...getInvoiceCoverageStatusPalette(item.coverageStatus),
                                          borderRadius: 999,
                                          padding: "2px 8px",
                                          fontSize: 11,
                                          fontWeight: 700,
                                          whiteSpace: "nowrap",
                                        }}
                                      >
                                        {getInvoiceCoverageStatusLabel(item.coverageStatus)}
                                      </span>
                                    </td>
                                    <td className="is-center">
                                      <div
                                        style={{
                                          display: "inline-flex",
                                          alignItems: "center",
                                          gap: 6,
                                        }}
                                      >
                                        <button
                                          type="button"
                                          className="btn-secondary processing-product-action-icon"
                                          aria-label="Duplicar item"
                                          title="Duplicar item"
                                          onClick={() =>
                                            duplicatePreviewItem(
                                              quotation.quotationId,
                                              item.lineId,
                                            )
                                          }
                                        >
                                          <svg
                                            viewBox="0 0 24 24"
                                            focusable="false"
                                            aria-hidden="true"
                                          >
                                            <path d="M8 4.75A2.75 2.75 0 0 0 5.25 7.5v8A2.75 2.75 0 0 0 8 18.25h8a2.75 2.75 0 0 0 2.75-2.75v-8A2.75 2.75 0 0 0 16 4.75zm0 1.5h8c.69 0 1.25.56 1.25 1.25v8c0 .69-.56 1.25-1.25 1.25H8c-.69 0-1.25-.56-1.25-1.25v-8c0-.69.56-1.25 1.25-1.25" />
                                            <path d="M4 8.5a.75.75 0 0 1 .75.75v8c0 .69.56 1.25 1.25 1.25h8a.75.75 0 0 1 0 1.5H6A2.75 2.75 0 0 1 3.25 17.25v-8A.75.75 0 0 1 4 8.5" />
                                          </svg>
                                        </button>
                                        {item.isDuplicate ? (
                                          <button
                                            type="button"
                                            className="btn-secondary processing-product-action-icon is-danger"
                                            aria-label="Eliminar copia"
                                            title="Eliminar copia"
                                            onClick={() =>
                                              removePreviewDuplicateItem(
                                                quotation.quotationId,
                                                item.lineId,
                                              )
                                            }
                                          >
                                            <svg
                                              viewBox="0 0 24 24"
                                              focusable="false"
                                              aria-hidden="true"
                                            >
                                              <path d="M9.25 4a.75.75 0 0 1 .75-.75h4a.75.75 0 0 1 .75.75V5h3a.75.75 0 0 1 0 1.5h-.76l-.63 11.01A2.75 2.75 0 0 1 14.37 20h-4.74a2.75 2.75 0 0 1-2.74-2.49L6.26 6.5H5.5a.75.75 0 0 1 0-1.5h3zm1.5.75V5h2.5v-.25zM7.76 6.5l.62 10.92c.04.66.58 1.18 1.25 1.18h4.74c.67 0 1.21-.52 1.25-1.18l.62-10.92z" />
                                              <path d="M10.75 9a.75.75 0 0 1 .75.75v5a.75.75 0 0 1-1.5 0v-5a.75.75 0 0 1 .75-.75m2.5 0a.75.75 0 0 1 .75.75v5a.75.75 0 0 1-1.5 0v-5a.75.75 0 0 1 .75-.75" />
                                            </svg>
                                          </button>
                                        ) : null}
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr>
                                  <th colSpan={9} className="is-right">
                                    Total cotizacion
                                  </th>
                                  <th className="is-right">
                                    {formatCurrency(quotationTotal, quotation.currencyCode)}
                                  </th>
                                  <th aria-label="Acciones" />
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        ) : (
                          <p className="field-hint">
                            {quotation.products.length
                              ? "No hay items disponibles en esta cotizacion. Activa 'Mostrar items completados o reservados' para revisarlos."
                              : "Esta cotizacion no tiene items."}
                          </p>
                        )}
                      </section>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
                padding: "12px 0 4px",
                borderTop: "1px solid #e2e8f0",
                marginTop: 10,
              }}
            >
              <button
                type="button"
                className="btn-secondary"
                onClick={closeInvoicePreviewModal}
                disabled={invoicePreviewLoading}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => openInvoiceModelModal("preinvoice")}
                disabled={invoicePreviewLoading || Boolean(invoicePreviewError) || documentSaving}
              >
                Crear prefactura
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => openInvoiceModelModal("invoice")}
                disabled={invoicePreviewLoading || Boolean(invoicePreviewError) || documentSaving}
              >
                Confirmar creacion de factura
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {invoiceModelModalOpen && pendingInvoiceModel ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="invoice-model-modal-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeInvoiceModelModal();
            }
          }}
        >
          <div className="modal-dialog modal-dialog-wide">
            <div className="modal-header accept-order-notification-header">
              <h3 id="invoice-model-modal-title">
                {pendingInvoiceModel.documentType === "preinvoice" ? "Modelo de prefactura" : "Modelo de factura"}
              </h3>
            </div>

            <div className="modal-body invoice-model-modal-body">
              {documentError && <p className="status-text error" role="alert">{documentError}</p>}
              {invoiceModelMode === "create" ? (
                <InvoiceExchangeRateFields rate={documentRate} total={pendingInvoiceModel.model.total}
                  disabled={documentSaving} />
              ) : (
                <div>
                  <p>Tipo de cambio a USD: {pendingInvoiceModel.model.exchangeRate == null
                    ? "No disponible"
                    : `1 USD = ${pendingInvoiceModel.model.exchangeRate} ${pendingInvoiceModel.model.currencyCode}`}</p>
                  <p>Total en USD: {pendingInvoiceModel.model.totalUsd == null
                    ? "No disponible" : formatCurrency(pendingInvoiceModel.model.totalUsd, "USD")}</p>
                  {pendingInvoiceModel.model.exchangeRateDate && (
                    <p>Fecha de publicacion de la tasa: {formatDate(pendingInvoiceModel.model.exchangeRateDate)}</p>
                  )}
                </div>
              )}
              <article className="invoice-model-sheet">
                <header className="invoice-model-header">
                  <div className="invoice-model-brand-block">
                    <div className="invoice-model-logo-mark" aria-hidden="true">
                      AQ
                    </div>
                    <div className="invoice-model-brand-copy">
                      <strong>{pendingInvoiceModel.model.companyName}</strong>
                      <span>R.F.C. {pendingInvoiceModel.model.fiscalRfc}</span>
                      <span>Moneda: {pendingInvoiceModel.model.currencyCode}</span>
                    </div>
                  </div>

                  <div className="invoice-model-folio-block">
                    <strong className="invoice-model-folio-label">
                      {pendingInvoiceModel.documentType === "preinvoice" ? "Prefactura · No es un comprobante fiscal" : "Comprobante fiscal digital"}
                    </strong>
                    <strong className="invoice-model-folio-number">
                      {pendingInvoiceModel.documentType === "preinvoice"
                        ? "Sin numero de factura"
                        : pendingInvoiceModel.invoiceNumber || "Numero asignado al confirmar"}
                    </strong>
                    <span>Fecha: {formatDate(pendingInvoiceModel.invoiceDate)}</span>
                    <span>Uso CFDI: {pendingInvoiceModel.model.cfdIUse}</span>
                    <span>Metodo de pago: {pendingInvoiceModel.model.paymentMethodLabel}</span>
                  </div>
                </header>

                <table className="invoice-model-meta-table">
                  <tbody>
                    <tr>
                      <th>Cliente</th>
                      <td>{pendingInvoiceModel.model.customerName}</td>
                      <th>Forma de pago</th>
                      <td>99 Por definir</td>
                    </tr>
                    <tr>
                      <th>Condicion</th>
                      <td>90 dias neto</td>
                      <th>Tipo de comprobante</th>
                      <td>Ingreso</td>
                    </tr>
                  </tbody>
                </table>

                <div className="invoice-model-items-wrap">
                  <table className="invoice-model-items-table">
                    <thead>
                      <tr>
                        <th>No.</th>
                        <th>Codigo</th>
                        <th>Descripcion</th>
                        <th className="is-right">Cantidad</th>
                        <th className="is-right">Costo unitario</th>
                        <th className="is-right">Importe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingInvoiceModel.model.selectedItems.map((item, index) => (
                        <tr key={`${item.lineId}-${index}`}>
                          <td>{index + 1}</td>
                          <td>{item.code}</td>
                          <td className="invoice-model-item-description">{item.description}</td>
                          <td className="is-right">
                            {Number(item.quantity || 0).toLocaleString("es-MX", {
                              maximumFractionDigits: 4,
                            })}
                          </td>
                          <td className="is-right">
                            {formatCurrency(
                              item.unitCostWithDiscount,
                              pendingInvoiceModel.model.currencyCode,
                            )}
                          </td>
                          <td className="is-right">
                            {formatCurrency(
                              Number(item.quantity || 0) *
                                Number(item.unitCostWithDiscount || 0),
                              pendingInvoiceModel.model.currencyCode,
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="invoice-model-summary-grid">
                  <div className="invoice-model-amount-in-words">
                    <strong>Importe con letra (referencial):</strong>
                    <span>
                      Total {formatCurrency(
                        pendingInvoiceModel.model.total,
                        pendingInvoiceModel.model.currencyCode,
                      )}
                    </span>
                  </div>

                  <table className="invoice-model-totals-table">
                    <tbody>
                      <tr>
                        <th>Subtotal</th>
                        <td className="is-right">
                          {formatCurrency(
                            pendingInvoiceModel.model.subtotal,
                            pendingInvoiceModel.model.currencyCode,
                          )}
                        </td>
                      </tr>
                      <tr>
                        <th>IVA ({pendingInvoiceModel.model.ivaPct}%)</th>
                        <td className="is-right">
                          {formatCurrency(
                            pendingInvoiceModel.model.ivaAmount,
                            pendingInvoiceModel.model.currencyCode,
                          )}
                        </td>
                      </tr>
                      <tr>
                        <th>Total</th>
                        <td className="is-right">
                          <strong>
                            {formatCurrency(
                              pendingInvoiceModel.model.total,
                              pendingInvoiceModel.model.currencyCode,
                            )}
                          </strong>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <footer className="invoice-model-footer-note">
                  {pendingInvoiceModel.documentType === "preinvoice"
                    ? "Prefactura sin validez fiscal. Las cantidades quedan reservadas hasta convertirla en factura o eliminarla."
                    : "*Vista previa del comprobante. El formato final puede variar segun timbrado y reglas fiscales."}
                </footer>
              </article>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
                padding: "12px 0 4px",
                borderTop: "1px solid #e2e8f0",
                marginTop: 10,
              }}
            >
              <button
                type="button"
                className="btn-secondary"
                onClick={closeInvoiceModelModal}
                disabled={documentSaving}
              >
                {invoiceModelMode === "view" ? "Cerrar" : "Cerrar modelo"}
              </button>
              {invoiceModelMode === "create" ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={finalizeInvoiceCreation}
                  disabled={documentSaving || documentRate.loading || !documentRate.valid}
                >
                  {documentSaving ? "Guardando..." : pendingInvoiceModel.documentType === "preinvoice" ? "Guardar prefactura" : "Crear factura"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {conversionInvoice && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="preinvoice-conversion-title">
          <div className="modal-dialog invoice-conversion-modal">
            <header className="invoice-conversion-header">
              <span className="invoice-conversion-eyebrow">Facturacion a clientes</span>
              <h3 id="preinvoice-conversion-title">Convertir prefactura en factura</h3>
              <p>Revisa la fecha y el tipo de cambio. Se conservaran los items y el numero de factura se asignara al confirmar.</p>
            </header>
            <div className="invoice-conversion-body">
            {conversionError && <p className="status-text error" role="alert">{conversionError}</p>}
            <div className="invoice-conversion-summary">
              <label className="field-group">
                <span>Fecha de factura</span>
                <input type="date" value={conversionDate} disabled={documentSaving}
                  onChange={(event) => setConversionDate(event.target.value)} />
              </label>
              <div className="invoice-conversion-amount">
                <span>Monto en moneda del documento</span>
                <strong>{getDocumentOriginalTotal(conversionInvoice) == null || !conversionRate.currency
                  ? "No disponible" : formatCurrency(getDocumentOriginalTotal(conversionInvoice), conversionRate.currency, "code")}</strong>
                <small>Total con IVA</small>
              </div>
            </div>
            {!conversionInvoice.currencyCode && (
              <p className="field-hint">Documento anterior sin datos monetarios historicos. Al convertir se guardaran los importes de sus items y la moneda de la cotizacion disponible.</p>
            )}
            {!conversionRate.currency && (
              <p className="status-text error" role="alert">No se pudo determinar la moneda de la prefactura. No es posible convertirla.</p>
            )}
            <InvoiceExchangeRateFields rate={conversionRate} total={getDocumentOriginalTotal(conversionInvoice)}
              disabled={documentSaving} />
            </div>
            <footer className="invoice-conversion-actions">
              <button type="button" className="btn-secondary" disabled={documentSaving}
                onClick={() => setConversionInvoice(null)}>Cancelar</button>
              <button type="button" className="btn-primary" disabled={documentSaving || !conversionDate || conversionRate.loading || !conversionRate.valid}
                onClick={() => void convertPreinvoice()}>
                {documentSaving ? "Convirtiendo..." : "Confirmar conversion"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}
