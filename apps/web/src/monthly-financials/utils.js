import {
  MONTHLY_FINANCIAL_FIELDS,
  MONTHLY_FINANCIAL_GROUPS,
  isFinancialRate,
  monthlyFinancialTotals,
} from "../../../../shared/monthly-financials.js";

export { isFinancialRate };
export const FIELDS = MONTHLY_FINANCIAL_FIELDS;
export const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);
export const MONTH_NAMES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
export const MONTH_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
export const FIELD_LABELS = Object.fromEntries(MONTHLY_FINANCIAL_GROUPS.flatMap((group) => group.fields.map(([key, label]) => [key, label])));
export const SECTIONS = [
  { title: "Ventas y compras", groups: [MONTHLY_FINANCIAL_GROUPS[0]] },
  { title: "Gastos generales", groups: [MONTHLY_FINANCIAL_GROUPS[1]] },
  { title: "Otros ingresos y gastos", groups: [MONTHLY_FINANCIAL_GROUPS[2], MONTHLY_FINANCIAL_GROUPS[3]] },
  { title: "Porcentajes", groups: [MONTHLY_FINANCIAL_GROUPS[4]] },
];

export const AMOUNT_PATTERN = /^(0|[1-9]\d{0,11})(\.\d{1,2})?$/;
const amountFormat = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const formatAmount = (value) => amountFormat.format(Number(value));
export const totalLabel = (group) => `Total de ${group.title.toLowerCase()}`;

export const isValidValue = (key, value) =>
  AMOUNT_PATTERN.test(value) && (!isFinancialRate(key) || Number(value) <= 100);

export function cellError(key, value) {
  if (value === "" || isValidValue(key, value)) return "";
  return isFinancialRate(key)
    ? "Ingresa un porcentaje de 0 a 100, con hasta 2 decimales."
    : "Ingresa un importe no negativo, con hasta 12 enteros y 2 decimales.";
}

export const emptyMonth = () => Object.fromEntries(FIELDS.map((key) => [key, ""]));
export const monthFromRecord = (record) =>
  record ? Object.fromEntries(FIELDS.map((key) => [key, record[key] ?? ""])) : emptyMonth();
export const formsFromRecords = (records) =>
  Object.fromEntries(MONTHS.map((month) => [month, monthFromRecord(records[month])]));

const normalizeCell = (value) => (AMOUNT_PATTERN.test(value) ? Number(value).toFixed(2) : value);
export function monthChanged(form, record) {
  const baseline = monthFromRecord(record);
  return FIELDS.some((key) => normalizeCell(form[key]) !== normalizeCell(baseline[key]));
}

export const registeredCount = (form) => FIELDS.filter((key) => form[key] !== "").length;
export const validValues = (form) =>
  Object.fromEntries(FIELDS.map((key) => [key, isValidValue(key, form[key]) ? form[key] : null]));
export const monthTotals = (form) => monthlyFinancialTotals(validValues(form));

export function rowYearTotal(forms, key) {
  let cents = 0;
  let registered = 0;
  for (const month of MONTHS) {
    const value = forms[month][key];
    if (!isValidValue(key, value)) continue;
    cents += Math.round(Number(value) * 100);
    registered += 1;
  }
  return { amount: cents / 100, registered, size: MONTHS.length };
}

export function groupYearTotal(totalsByMonth, group) {
  let cents = 0;
  let registered = 0;
  for (const month of MONTHS) {
    const total = totalsByMonth[month][group.total];
    cents += Math.round(total.amount * 100);
    registered += group.fields.length - total.pending;
  }
  return { amount: cents / 100, registered, size: group.fields.length * MONTHS.length };
}

export function parsePastedGrid(text) {
  return text
    .replace(/\r?\n$/, "")
    .split(/\r?\n/)
    .map((row) => row.split("\t").map((cell) => cell.replace(/,/g, "").trim()));
}
