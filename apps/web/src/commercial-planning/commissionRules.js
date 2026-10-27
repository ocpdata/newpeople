// Umbrales informativos: deben coincidir con el cálculo de
// apps/api/src/routes.commercial-planning.js (buildCommissionTrackingPayload).
export const COMMISSION_MIN_QUOTA_ATTAINMENT_PCT = 70;
export const COMMISSION_MIN_QUOTATION_MARGIN_PCT = 10;

export const COMMISSION_CATEGORIES = [
  { key: "products", label: "Productos", rateField: "productCommissionPct" },
  { key: "services", label: "Servicios", rateField: "serviceCommissionPct" },
  { key: "renewals", label: "Renovaciones", rateField: "renewalCommissionPct" },
];

function toNumber(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function simulateCommission({
  quotaAmount,
  acceptedSalesAmount,
  marginPct,
  contributions,
  rates,
}) {
  const quota = toNumber(quotaAmount);
  const accepted = toNumber(acceptedSalesAmount);
  const attainmentPct = quota > 0 ? roundMoney((accepted / quota) * 100) : 0;
  const quotaOk = attainmentPct >= COMMISSION_MIN_QUOTA_ATTAINMENT_PCT;
  const marginOk = toNumber(marginPct) >= COMMISSION_MIN_QUOTATION_MARGIN_PCT;
  const eligible = quotaOk && marginOk;
  const items = COMMISSION_CATEGORIES.map((category) => {
    const contribution = toNumber(contributions?.[category.key]);
    const rate = toNumber(rates?.[category.rateField]);
    return {
      key: category.key,
      label: category.label,
      contribution,
      rate,
      amount: eligible ? roundMoney((contribution * rate) / 100) : 0,
    };
  });
  return {
    attainmentPct,
    quotaOk,
    marginOk,
    status: !marginOk ? "blocked_by_margin" : !quotaOk ? "blocked_by_quota" : "eligible",
    items,
    total: roundMoney(items.reduce((sum, item) => sum + item.amount, 0)),
  };
}

export function isSellerActive(summary, pendingCount = 0) {
  return (
    Number(summary.acceptedQuotationCount || 0) > 0 ||
    Number(summary.calculatedTotalCommissionAmount || 0) > 0 ||
    pendingCount > 0
  );
}

// Resume en una frase por qué un vendedor tiene (o no) comisión en el trimestre.
export function describeSellerCommissionStatus(summary, formatMoney) {
  const quota = Number(summary.salesQuotaAmount || 0);
  const sales = Number(summary.acceptedSalesAmount || 0);
  if (quota <= 0) {
    return sales > 0
      ? { tone: "warn", label: "Sin cuota en Metas" }
      : { tone: "muted", label: "Sin cuota ni ventas" };
  }
  if (!summary.commissionEnabled) {
    if (sales <= 0) return { tone: "muted", label: "Sin ventas aceptadas" };
    const missing = (quota * COMMISSION_MIN_QUOTA_ATTAINMENT_PCT) / 100 - sales;
    return {
      tone: "warn",
      label: `Cumplimiento ${Number(summary.quotaAttainmentPct || 0).toFixed(1)}% < ${COMMISSION_MIN_QUOTA_ATTAINMENT_PCT}%: faltan ${formatMoney(Math.max(missing, 0))} para habilitar`,
    };
  }
  const blocked = Number(summary.blockedLowMarginQuotationCount || 0);
  if (blocked > 0 && Number(summary.eligibleQuotationCount || 0) === 0) {
    return { tone: "warn", label: `Habilitado, pero ${blocked} cotización(es) con margen < ${COMMISSION_MIN_QUOTATION_MARGIN_PCT}%` };
  }
  if (blocked > 0) {
    return { tone: "ok", label: `Habilitado · ${blocked} cotización(es) con margen < ${COMMISSION_MIN_QUOTATION_MARGIN_PCT}%` };
  }
  return { tone: "ok", label: "Habilitado" };
}

export function describeCommissionBlock({ passesMarginRule, sellerPassesQuotaRule, marginPct, quotaAttainmentPct }) {
  if (!passesMarginRule) {
    return `Bloqueada por margen (${Number(marginPct || 0).toFixed(2)}% < ${COMMISSION_MIN_QUOTATION_MARGIN_PCT}%)`;
  }
  if (!sellerPassesQuotaRule) {
    return `Bloqueada por cuota (cumplimiento ${Number(quotaAttainmentPct || 0).toFixed(2)}% < ${COMMISSION_MIN_QUOTA_ATTAINMENT_PCT}%)`;
  }
  return "Elegible";
}
