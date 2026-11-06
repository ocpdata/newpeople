const numberFormat = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });

export const formatNumber = (value) => numberFormat.format(Number(value || 0));
export const formatMoney = (value, currency) => `$${formatNumber(value)} ${currency || ""}`.trim();
export const formatPct = (value, digits = 1) => (value == null ? "Sin dato" : `${Number(value).toFixed(digits)}%`);

export function formatCompact(value, currency) {
  const amount = Number(value || 0);
  const text = Math.abs(amount) >= 1_000_000
    ? `${(amount / 1_000_000).toLocaleString("es-MX", { maximumFractionDigits: 2 })} M`
    : formatNumber(amount);
  return currency ? `${text} ${currency}` : text;
}

export const STATE_LABELS = { ok: "Cumplido", warn: "En curso", bad: "Sin pago", off: "Sin activar" };
export const LINE_LABELS = { products: "Producto", services: "Servicio", renewals: "Renovación", mixed: "Mixta" };
export const QUARTERS = [1, 2, 3, 4];
