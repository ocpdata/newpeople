import { useEffect, useMemo, useState } from "react";
import { api, getApiErrorMessage } from "./api";

const INVOICING_STATE_STORAGE_KEY = "newpeople.invoicing.module.v1";

function formatDate(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString("es-MX", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatCurrency(value, currencyCode = "USD") {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return "-";
  const currency = String(currencyCode || "USD").trim() || "USD";
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
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

function buildInvoiceNumberPrefixForYear(year) {
  return `AQ-${year}-`;
}

function parseInvoiceSequentialNumber(invoiceNumber, year) {
  const prefix = buildInvoiceNumberPrefixForYear(year);
  const normalizedInvoiceNumber = String(invoiceNumber || "").trim();
  if (!normalizedInvoiceNumber.startsWith(prefix)) return null;
  const suffix = normalizedInvoiceNumber.slice(prefix.length);
  const parsed = Number(suffix);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function buildNextInvoiceNumber(invoices = [], year) {
  const maxSequence = (Array.isArray(invoices) ? invoices : []).reduce(
    (maxValue, invoice) => {
      const parsedSequence = parseInvoiceSequentialNumber(
        invoice?.invoiceNumber,
        year,
      );
      if (!parsedSequence) return maxValue;
      return Math.max(maxValue, parsedSequence);
    },
    0,
  );
  return `${buildInvoiceNumberPrefixForYear(year)}${maxSequence + 1}`;
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

function buildInvoicedQuantityByItemKey(invoices = []) {
  const map = new Map();
  (Array.isArray(invoices) ? invoices : []).forEach((invoice) => {
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
      setInvoices(Array.isArray(data) ? data : []);
    } catch {
      setInvoices([]);
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
      const selectedQuotationMap = new Map(
        rows
          .filter((item) => selectedIds.includes(Number(item.id || 0)))
          .map((item) => [Number(item.id || 0), item]),
      );

      const invoicedQuantityByItemKey = buildInvoicedQuantityByItemKey(invoices);

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
              const pendingQuantity = Math.max(0, originalQuantity - invoicedQuantity);
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
    if (invoicePreviewLoading) return;
    setInvoicePreviewModalOpen(false);
    setInvoicePreviewError("");
    setInvoicePreviewRows([]);
    setShowCompletedPreviewItems(false);
  }

  function closeInvoiceModelModal() {
    setInvoiceModelModalOpen(false);
    setPendingInvoiceModel(null);
    setInvoiceModelMode("create");
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

    const subtotal = selectedItems.reduce(
      (sum, item) =>
        sum + Number(item.quantity || 0) * Number(item.unitCostWithDiscount || 0),
      0,
    );
    const ivaPct = 16;
    const ivaAmount = subtotal * (ivaPct / 100);
    const total = subtotal + ivaAmount;

    const firstQuotationId = Array.isArray(invoice?.quotationIds)
      ? Number(invoice.quotationIds[0] || 0)
      : 0;
    const firstQuotation = rows.find(
      (item) => Number(item.id || 0) === firstQuotationId,
    );
    const customerName = String(firstQuotation?.accountName || "Cliente").trim();
    const currencyCode =
      String(firstQuotation?.latestCurrencyCode || "USD").trim() || "USD";

    setPendingInvoiceModel({
      id: String(invoice?.id || "").trim() || `inv-${Date.now()}`,
      invoiceNumber: String(invoice?.invoiceNumber || "").trim() || "",
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
        exchangeRate: "1.0000",
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
    const normalizedId = String(invoiceId || "").trim();
    if (!normalizedId) return;
    const shouldDelete = window.confirm(
      "Se eliminara la factura seleccionada. Esta accion no se puede deshacer.",
    );
    if (!shouldDelete) return;

    try {
      await api.delete(`/api/quotation-invoices/${normalizedId}`);
      setInvoices((current) =>
        current.filter((item) => String(item.id || "").trim() !== normalizedId),
      );
    } catch (deleteError) {
      setError(getApiErrorMessage(deleteError, "No fue posible eliminar la factura"));
      return;
    }

    if (String(pendingInvoiceModel?.id || "").trim() === normalizedId) {
      closeInvoiceModelModal();
    }
  }

  function togglePreviewItemIncluded(quotationId, lineId) {
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

  function buildInvoiceFromSelection() {
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
      String(invoiceDateDraft || "").trim() || new Date().toISOString().slice(0, 10);
    const [yearText] = normalizedInvoiceDate.split("-");
    const invoiceYear = Number(yearText || 0) || new Date().getFullYear();
    const normalizedInvoiceNumber = buildNextInvoiceNumber(invoices, invoiceYear);

    const allSelectedItems = selectedItemsByQuotation.flatMap((entry) =>
      Array.isArray(entry.items) ? entry.items : [],
    );
    const subtotal = allSelectedItems.reduce(
      (sum, item) =>
        sum + Number(item.quantity || 0) * Number(item.unitCostWithDiscount || 0),
      0,
    );
    const ivaPct = 16;
    const ivaAmount = subtotal * (ivaPct / 100);
    const total = subtotal + ivaAmount;

    const firstQuotation =
      rows.find((item) => Number(item.id || 0) === selectedIds[0]) || null;
    const customerName = String(firstQuotation?.accountName || "Cliente").trim();
    const currencyCode =
      String(firstQuotation?.latestCurrencyCode || "USD").trim() || "USD";

    return {
      id: `inv-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      invoiceNumber: normalizedInvoiceNumber,
      invoiceDate: normalizedInvoiceDate,
      quotationIds: selectedIds,
      quotationItems: selectedItemsByQuotation,
      createdAt: new Date().toISOString(),
      model: {
        companyName: "ACCESS QUALITY SA DE CV",
        fiscalRfc: "AQJ10118VA2",
        customerName,
        paymentMethodLabel: "PPD Pago en parcialidades o diferido",
        cfdIUse: "G03 Gastos en general",
        currencyCode,
        exchangeRate: "1.0000",
        subtotal,
        ivaPct,
        ivaAmount,
        total,
        selectedItems: allSelectedItems,
      },
    };
  }

  function openInvoiceModelModal() {
    const pendingInvoice = buildInvoiceFromSelection();
    if (!pendingInvoice) return;
    setPendingInvoiceModel(pendingInvoice);
    setInvoiceModelMode("create");
    setInvoiceModelModalOpen(true);
  }

  async function finalizeInvoiceCreation() {
    if (!pendingInvoiceModel) return;
    const firstQuotationId = pendingInvoiceModel.quotationIds[0] || null;
    const firstQuotation = firstQuotationId
      ? rows.find((r) => Number(r.id || 0) === Number(firstQuotationId))
      : null;
    const accountId = firstQuotation?.accountId ? Number(firstQuotation.accountId) : null;
    try {
      await api.post("/api/quotation-invoices", {
        invoiceNumber: pendingInvoiceModel.invoiceNumber,
        invoiceDate: pendingInvoiceModel.invoiceDate,
        accountId,
        quotationIds: pendingInvoiceModel.quotationIds,
        quotationItems: pendingInvoiceModel.quotationItems,
      });
      await loadInvoices();
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, "No fue posible guardar la factura"));
      return;
    }
    setSelectedQuotationIds([]);
    setInvoiceDateDraft("");
    setError("");
    closeInvoiceModelModal();
    closeInvoicePreviewModal();
  }

  const totalAmount = useMemo(
    () => rows.reduce((sum, item) => sum + Number(item?.latestTotalSaleAmount || 0), 0),
    [rows],
  );

  const invoicesByQuotationId = useMemo(() => {
    const map = new Map();
    invoices.forEach((invoice) => {
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

  const invoicedAmountByQuotationId = useMemo(() => {
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
          map.set(quotationId, Number(map.get(quotationId) || 0) + amount);
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

  const nextInvoiceNumberPreview = useMemo(() => {
    const normalizedInvoiceDate =
      String(invoiceDateDraft || "").trim() || new Date().toISOString().slice(0, 10);
    const [yearText] = normalizedInvoiceDate.split("-");
    const invoiceYear = Number(yearText || 0) || new Date().getFullYear();
    return buildNextInvoiceNumber(invoices, invoiceYear);
  }, [invoiceDateDraft, invoices]);

  return (
    <section>
      <header className="page-header" style={{ marginBottom: 16 }}>
        <h2>Facturacion</h2>
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
            <h3 style={{ margin: 0, fontSize: 16 }}>Crear factura</h3>
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
              <span>Numero de factura (generado)</span>
              <input
                type="text"
                value={nextInvoiceNumberPreview}
                readOnly
                disabled
              />
            </label>

            <label className="field-group" style={{ marginBottom: 0 }}>
              <span>Fecha de factura</span>
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
                disabled={!selectedQuotationIds.length}
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
                  <th className="is-right">Pendiente</th>
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
                    Number(invoicedAmountByQuotationId.get(quotationId) || 0),
                  );
                  const pendingAmount = Math.max(
                    0,
                    quotationTotalAmount - invoicedAmount,
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
                  <th colSpan={10} className="is-right">
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
            <h3 style={{ margin: 0, fontSize: 16 }}>Facturas registradas</h3>
          </header>

          {invoices.length ? (
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Factura</th>
                    <th>Fecha</th>
                    <th>Cotizaciones relacionadas</th>
                    <th className="is-center">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td>{invoice.invoiceNumber}</td>
                      <td>{formatDate(invoice.invoiceDate)}</td>
                      <td>
                        {(Array.isArray(invoice.quotationIds)
                          ? invoice.quotationIds
                          : []
                        ).length
                          ? invoice.quotationIds.join(", ")
                          : "Sin cotizaciones"}
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
                            aria-label={`Ver factura ${invoice.invoiceNumber || ""}`}
                            title="Ver factura"
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
                          <button
                            type="button"
                            className="btn-secondary processing-product-action-icon is-danger"
                            aria-label={`Eliminar factura ${invoice.invoiceNumber || ""}`}
                            title="Eliminar factura"
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
              Aun no hay facturas registradas en este modulo.
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

              {!invoicePreviewLoading && !invoicePreviewError ? (
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
                      Ajusta la cantidad a facturar por item segun el pendiente disponible.
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
                      Mostrar items ya completados
                    </label>
                  </div>

                  {invoicePreviewRows.map((quotation) => {
                    const quotationTotal = quotation.products.reduce(
                      (sum, item) =>
                        Boolean(item.includedInInvoice)
                          ? sum + Number(item.quantity || 0) * Number(item.unitCostWithDiscount || 0)
                          : sum,
                      0,
                    );
                    const quotationQuotedTotal = quotation.products.reduce(
                      (sum, item) =>
                        sum +
                        Math.max(0, Number(item.originalQuantity || 0)) *
                          Math.max(0, Number(item.unitCostWithDiscount || 0)),
                      0,
                    );
                    const quotationInvoicedTotal = quotation.products.reduce(
                      (sum, item) =>
                        sum +
                        Math.min(
                          Math.max(0, Number(item.invoicedQuantity || 0)),
                          Math.max(0, Number(item.originalQuantity || 0)),
                        ) * Math.max(0, Number(item.unitCostWithDiscount || 0)),
                      0,
                    );
                    const quotationPendingTotal = Math.max(
                      0,
                      quotationQuotedTotal - quotationInvoicedTotal,
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
                            Facturado: {formatCurrency(quotationInvoicedTotal, quotation.currencyCode)} · Pendiente: {formatCurrency(quotationPendingTotal, quotation.currencyCode)}
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
                                  <th className="is-right">Cantidad a facturar</th>
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
                              ? "No hay items pendientes en esta cotizacion. Activa 'Mostrar items ya completados' para revisarlos."
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
                className="btn-primary"
                onClick={openInvoiceModelModal}
                disabled={invoicePreviewLoading || Boolean(invoicePreviewError)}
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
              <h3 id="invoice-model-modal-title">Modelo de factura</h3>
            </div>

            <div className="modal-body invoice-model-modal-body">
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
                    <strong className="invoice-model-folio-label">Comprobante fiscal digital</strong>
                    <strong className="invoice-model-folio-number">
                      {pendingInvoiceModel.invoiceNumber}
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
                  *Vista previa del comprobante. El formato final puede variar
                  segun timbrado y reglas fiscales.
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
              >
                {invoiceModelMode === "view" ? "Cerrar" : "Cerrar modelo"}
              </button>
              {invoiceModelMode === "create" ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={finalizeInvoiceCreation}
                >
                  Crear factura
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
