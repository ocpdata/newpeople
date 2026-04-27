import { quotationPrintTemplateData } from "./quotationPrintTemplateData";

function getCatalogLabel(options, code) {
  if (!Array.isArray(options) || !code) {
    return "";
  }

  return (
    options.find((option) => String(option.code) === String(code))?.name || ""
  );
}

function formatPrintDate(value) {
  if (!value) {
    return "";
  }

  const datePart = String(value).split("T")[0];
  const [year, month, day] = datePart.split("-");
  if (!year || !month || !day) {
    return value;
  }

  return `${day}-${month}-${year}`;
}

export function buildQuotationPrintModel({
  company = quotationPrintTemplateData.company,
  proposalName = "",
  quotationDate = "",
  accountName = "",
  contactName = "",
  contactEmail = "",
  contactPhone = "",
  sellerName = "",
  sellerEmail = "",
  sellerPhone = "",
  introduction = "",
  sections = [],
  summary = null,
  deliveryTime = "",
  quotationValidity = "",
  warranty = "",
  paymentTerms = "",
  currencyCode = "",
  currencyName = "",
  quotationNotes = "",
  catalogs = {},
}) {
  const resolvedCurrencyName =
    currencyName || getCatalogLabel(catalogs.currencies, currencyCode) || "";

  return {
    company,
    header: {
      quotationDate: formatPrintDate(quotationDate),
      proposalName: proposalName || "",
      accountName: accountName || "",
      contactName: contactName || "",
      contactEmail: contactEmail || "",
      contactPhone: contactPhone || "",
      sellerName: sellerName || "",
      sellerEmail: sellerEmail || "",
      sellerPhone: sellerPhone || "",
    },
    introduction: introduction || "",
    sections: Array.isArray(sections) ? sections : [],
    summary: summary || {
      subtotal: 0,
      discount: 0,
      discountedSubtotal: 0,
      vatAmount: 0,
      total: 0,
      showVat: false,
    },
    commercialTerms: {
      deliveryTime: getCatalogLabel(catalogs.deliveryTimes, deliveryTime),
      quotationValidity: getCatalogLabel(
        catalogs.validityTerms,
        quotationValidity,
      ),
      warranty: getCatalogLabel(catalogs.warrantyTerms, warranty),
      paymentTerms: getCatalogLabel(catalogs.paymentTerms, paymentTerms),
      currency: resolvedCurrencyName || currencyCode || "",
    },
    notes: quotationNotes || "",
  };
}

export default buildQuotationPrintModel;
