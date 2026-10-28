import { api } from "../api";
import { normalizeDecimalInput } from "./planningFormat";

export const QUARTER_NUMBERS = [1, 2, 3, 4];

export function mergeAnnualTargetDrafts(plan) {
  if (!plan) return [];
  return (plan.quarters || []).map((quarter) => {
    const targetsBySellerId = new Map(
      (quarter.targets || []).map((target) => [target.sellerUserId, target]),
    );
    return {
      quarter: quarter.quarter,
      period: quarter.period,
      sellers: (plan.eligibleSellers || []).map((seller) => {
        const target = targetsBySellerId.get(seller.id);
        return {
          sellerUserId: seller.id,
          sellerUserName: seller.fullName,
          sellerEmail: seller.email,
          salesQuotaAmount: target?.salesQuotaAmount == null
            ? ""
            : String(target.salesQuotaAmount),
          expectedMarginPercent: target?.expectedMarginPercent == null
            ? ""
            : String(target.expectedMarginPercent),
        };
      }),
    };
  });
}

export function buildAnnualTargetPayload(quarterDrafts) {
  const errors = [];
  const quarters = quarterDrafts.map((quarter) => {
    const targets = [];
    for (const draft of quarter.sellers) {
      const hasQuota = String(draft.salesQuotaAmount).trim() !== "";
      const hasMargin = String(draft.expectedMarginPercent).trim() !== "";
      if (!hasQuota && !hasMargin) continue;
      if (!hasQuota || !hasMargin) {
        errors.push(`Completa cuota y margen esperado para ${draft.sellerUserName} en T${quarter.quarter}.`);
        continue;
      }
      const salesQuotaAmount = Number(normalizeDecimalInput(draft.salesQuotaAmount));
      const expectedMarginPercent = Number(draft.expectedMarginPercent);
      if (!Number.isFinite(salesQuotaAmount) || salesQuotaAmount < 0) {
        errors.push(`La cuota de ${draft.sellerUserName} en T${quarter.quarter} debe ser mayor o igual a cero.`);
        continue;
      }
      if (!Number.isFinite(expectedMarginPercent) || expectedMarginPercent < 0) {
        errors.push(`El margen de ${draft.sellerUserName} en T${quarter.quarter} debe ser mayor o igual a cero.`);
        continue;
      }
      targets.push({
        sellerUserId: draft.sellerUserId,
        salesQuotaAmount,
        expectedMarginPercent,
      });
    }
    return { quarter: quarter.quarter, targets };
  });
  return { quarters, errors };
}

export function toNumber(value) {
  const parsed = Number(normalizeDecimalInput(value) || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function draftContribution(draft) {
  return (toNumber(draft?.salesQuotaAmount) * toNumber(draft?.expectedMarginPercent)) / 100;
}

function roundMoney(value) {
  return Number(Number(value).toFixed(2));
}

// Reparte un monto anual en cuatro trimestres; el residuo de redondeo se absorbe en el último.
export function splitAnnualQuota(total, percentages) {
  const amounts = percentages.map((pct) => roundMoney((total * pct) / 100));
  const difference = roundMoney(total - amounts.reduce((sum, value) => sum + value, 0));
  amounts[amounts.length - 1] = roundMoney(amounts[amounts.length - 1] + difference);
  return amounts.map((amount) => String(amount));
}

export function parseClipboardGrid(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.map((line) => line.split("\t"));
}

// Devuelve "" para celdas vacías, null si el valor no es numérico.
export function cleanClipboardNumber(cell) {
  const cleaned = String(cell ?? "").replace(/[^0-9.,-]/g, "").replace(/,/g, "");
  if (cleaned === "") return "";
  return Number.isFinite(Number(cleaned)) ? cleaned : null;
}

export function collectTargetAlerts(drafts) {
  const alerts = [];
  const sellers = drafts[0]?.sellers || [];
  if (!sellers.length) return alerts;

  drafts.forEach((quarter) => {
    const filled = quarter.sellers.filter((seller) => String(seller.salesQuotaAmount).trim() !== "");
    if (!filled.length) alerts.push(`T${quarter.quarter} no tiene cuotas capturadas.`);
    quarter.sellers.forEach((seller) => {
      const hasQuota = String(seller.salesQuotaAmount).trim() !== "";
      const hasMargin = String(seller.expectedMarginPercent).trim() !== "";
      if (hasQuota && !hasMargin) alerts.push(`${seller.sellerUserName} · T${quarter.quarter}: falta el margen esperado.`);
      if (!hasQuota && hasMargin) alerts.push(`${seller.sellerUserName} · T${quarter.quarter}: falta la cuota.`);
    });
  });

  sellers.forEach((seller) => {
    const hasAnyQuota = drafts.some((quarter) => {
      const draft = quarter.sellers.find((item) => item.sellerUserId === seller.sellerUserId);
      return String(draft?.salesQuotaAmount ?? "").trim() !== "";
    });
    if (!hasAnyQuota) alerts.push(`${seller.sellerUserName} no tiene cuota en ningún trimestre del año.`);
  });
  return alerts;
}

export function collectChangedKeys(drafts, baseline) {
  const baselineValues = new Map();
  baseline.forEach((quarter) => quarter.sellers.forEach((seller) => {
    baselineValues.set(`${quarter.quarter}:${seller.sellerUserId}:salesQuotaAmount`, seller.salesQuotaAmount);
    baselineValues.set(`${quarter.quarter}:${seller.sellerUserId}:expectedMarginPercent`, seller.expectedMarginPercent);
  }));
  const changed = new Set();
  drafts.forEach((quarter) => quarter.sellers.forEach((seller) => {
    ["salesQuotaAmount", "expectedMarginPercent"].forEach((field) => {
      const key = `${quarter.quarter}:${seller.sellerUserId}:${field}`;
      const before = normalizeDecimalInput(baselineValues.get(key) ?? "");
      const after = normalizeDecimalInput(seller[field] ?? "");
      if (before !== after) changed.add(key);
    });
  }));
  return changed;
}

function emptyCell() {
  return { quota: 0, expectedContribution: 0, sales: 0, contribution: 0 };
}

// Cuotas guardadas y avance real (venta aceptada y contribución) por vendedor y trimestre.
export async function fetchYearResults(year, planOverride = null) {
  const plan = planOverride || (await api.get(`/api/commercial-planning/years/${year}`)).data;
  const quarters = await Promise.all((plan?.quarters || []).map(async (quarter) => {
    let summaries = [];
    if (quarter.period?.id) {
      try {
        const response = await api.get(
          `/api/commercial-planning/periods/${quarter.period.id}/commission-tracking`,
        );
        summaries = response.data?.summaries || [];
      } catch {
        summaries = [];
      }
    }
    return { quarter: quarter.quarter, targets: quarter.targets || [], summaries };
  }));

  const sellers = new Map();
  const cellFor = (sellerUserId, name, quarter) => {
    if (!sellers.has(sellerUserId)) {
      sellers.set(sellerUserId, {
        sellerUserId,
        sellerUserName: name || "",
        quarters: Object.fromEntries(QUARTER_NUMBERS.map((number) => [number, emptyCell()])),
      });
    }
    return sellers.get(sellerUserId).quarters[quarter];
  };

  quarters.forEach(({ quarter, targets, summaries }) => {
    targets.forEach((target) => {
      const cell = cellFor(target.sellerUserId, target.sellerUserName, quarter);
      cell.quota = Number(target.salesQuotaAmount || 0);
      cell.expectedContribution = Number(target.expectedContributionAmount || 0);
    });
    summaries.forEach((summary) => {
      const cell = cellFor(summary.sellerUserId, summary.sellerUserName, quarter);
      cell.sales = Number(summary.acceptedSalesAmount || 0);
      cell.contribution = (summary.quotations || []).reduce(
        (sum, quotation) => sum + Number(quotation.totalContributionAmount || 0),
        0,
      );
    });
  });
  return { year, sellers };
}

export function sumResultCells(cells) {
  return cells.reduce((acc, cell) => ({
    quota: acc.quota + cell.quota,
    expectedContribution: acc.expectedContribution + cell.expectedContribution,
    sales: acc.sales + cell.sales,
    contribution: acc.contribution + cell.contribution,
  }), emptyCell());
}

export function sellerYearCells(results, sellerUserId) {
  const seller = results?.sellers.get(sellerUserId);
  return QUARTER_NUMBERS.map((quarter) => seller?.quarters[quarter] || emptyCell());
}
