import { quotationPrintTemplateData } from "./quotationPrintTemplateData";

function formatPrintDate(value) {
  if (!value) {
    return "";
  }

  const datePart = String(value).split("T")[0];
  const [year, month, day] = datePart.split("-");
  if (!year || !month || !day) {
    return String(value);
  }

  return `${day}-${month}-${year}`;
}

function getUniqueLabels(values) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter((value) => Boolean(value)),
    ),
  );
}

function normalizeMoney(value) {
  const numberValue = Number(value);
  return Number.isNaN(numberValue) ? 0 : numberValue;
}

export function buildPurchaseOrderPrintModel({
  company = quotationPrintTemplateData.company,
  quotation = null,
  orders = [],
  currencyCode = "USD",
  notes = "",
}) {
  const normalizedOrders = Array.isArray(orders) ? orders : [];
  const firstOrder = normalizedOrders[0] || null;
  const orderDate = firstOrder?.orderDate || new Date().toISOString();
  const quotationId = Number(quotation?.id || 0) || null;
  const providerNames = getUniqueLabels(
    normalizedOrders.map((order) => order?.providerName),
  );

  const sections = normalizedOrders.map((order, index) => {
    const rows = Array.isArray(order?.lines) ? order.lines : [];
    const ivaPct = Math.min(100, Math.max(0, Number(order?.ivaPct ?? 16) || 0));
    const sectionSubtotal = rows.reduce(
      (sum, line) => sum + normalizeMoney(line?.amount),
      0,
    );
    const sectionIvaAmount = sectionSubtotal * (ivaPct / 100);
    const sectionTotal = sectionSubtotal + sectionIvaAmount;

    return {
      id: order?.orderId || `purchase-order-${index + 1}`,
      title: order?.providerName || `Proveedor ${index + 1}`,
      subtitle: order?.orderNumber || "",
      currencyCode: order?.currencyCode || currencyCode || "USD",
      rows: rows.map((line, lineIndex) => ({
        id: line?.lineId || `${order?.orderId || index}-${lineIndex + 1}`,
        productCode: String(line?.code || "").trim(),
        productDescription: String(line?.description || "").trim(),
        quantityDisplay: String(line?.quantity ?? ""),
        salePriceUnit: normalizeMoney(line?.unitCost),
        salePriceTotal: normalizeMoney(line?.amount),
      })),
      subtotal: sectionSubtotal,
      ivaPct,
      ivaAmount: sectionIvaAmount,
      total: sectionTotal,
    };
  });

  const summarySubtotal = sections.reduce((sum, section) => sum + section.subtotal, 0);
  const summaryIvaAmount = sections.reduce((sum, section) => sum + section.ivaAmount, 0);
  const summaryTotal = sections.reduce((sum, section) => sum + section.total, 0);

  return {
    company,
    header: {
      documentNumber: quotationId ? `OC-${quotationId}` : "OC",
      documentDate: formatPrintDate(orderDate),
      quotationReference: quotationId ? `Cotización origen #${quotationId}` : "",
      accountName: String(quotation?.accountName || "").trim(),
      proposalName: String(quotation?.latestProposalName || quotation?.proposalName || "").trim(),
      providerNames: providerNames.join(", "),
      orderCountLabel: `${sections.length} orden(es)`,
    },
    sections,
    summary: {
      subtotal: summarySubtotal,
      discount: 0,
      discountedSubtotal: summarySubtotal,
      vatAmount: summaryIvaAmount,
      total: summaryTotal,
      showVat: true,
      vatMode: "total",
      currencyCode: currencyCode || "USD",
    },
    notes: String(notes || "").trim(),
  };
}

export default buildPurchaseOrderPrintModel;