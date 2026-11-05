export const MONTHLY_FINANCIAL_GROUPS = [
  { title: "Ventas y compras", fields: [
    ["salesDiscounts", "Descuentos sobre ventas"],
    ["salesReturns", "Devoluciones sobre ventas"],
    ["purchases", "Compras"],
  ] },
  { title: "Gastos generales", total: "generalExpenses", fields: [
    ["sellingExpenses", "Gastos de venta"],
    ["administrativeExpenses", "Gastos de administración"],
    ["depreciation", "Depreciación de planta y equipo"],
    ["amortization", "Amortización de gastos diferidos"],
  ] },
  { title: "Otros ingresos", total: "otherIncome", fields: [
    ["financialIncome", "Productos financieros"],
    ["otherIncome", "Otros productos"],
  ] },
  { title: "Otros gastos", total: "otherExpenses", fields: [
    ["financialExpenses", "Gastos financieros"],
    ["otherExpenses", "Otros gastos"],
  ] },
  { title: "Porcentajes", fields: [
    ["isrPct", "ISR (%)", "Impuesto sobre la renta"],
    ["ptuPct", "PTU (%)", "Participación de los trabajadores en las utilidades"],
  ] },
];

export const MONTHLY_FINANCIAL_FIELDS = MONTHLY_FINANCIAL_GROUPS.flatMap((group) => group.fields.map(([key]) => key));
export const isFinancialRate = (key) => key === "isrPct" || key === "ptuPct";

export function monthlyFinancialTotals(values) {
  return Object.fromEntries(MONTHLY_FINANCIAL_GROUPS.filter((group) => group.total).map((group) => {
    const amounts = group.fields.map(([key]) => values[key]);
    const registered = amounts.filter((value) => value !== null && value !== undefined && value !== "");
    const cents = registered.reduce((sum, value) => sum + Math.round(Number(value) * 100), 0);
    return [group.total, { amount: cents / 100, pending: amounts.length - registered.length }];
  }));
}
