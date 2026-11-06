import { query, withTransaction } from "../db.js";
import { logAuditEvent } from "../audit.js";
import { buildCommissionTrackingPayload } from "../routes.commercial-planning.js";
import { ensureCommercialPlanningSchema } from "../commercial-planning/schema.js";
import { ensureVariableCompensationSchema } from "./schema.js";
import {
  DEFAULT_VARIABLE_RULES, calculateVariable, evaluateGrowth, evaluateNewClients, validateVariableRules,
} from "../../../../shared/variable-compensation.js";

const BUSINESS_TIMEZONE = "America/Mexico_City";
const DAY_MS = 86400000;
const round = (value, digits = 2) => Number(Number(value || 0).toFixed(digits));
const pad = (value) => String(value).padStart(2, "0");

export class VariableRulesConflictError extends Error {
  constructor() {
    super("Otra persona modificó las reglas. Revisa la versión actual antes de guardar.");
    this.status = 409;
  }
}

export function currentBusinessQuarter(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), quarter: Math.ceil(Number(parts.month) / 3) };
}

function quarterBounds(year, quarter) {
  const startMonth = (quarter - 1) * 3 + 1;
  const endYear = quarter === 4 ? year + 1 : year;
  const endMonth = quarter === 4 ? 1 : startMonth + 3;
  return { start: `${year}-${pad(startMonth)}-01`, end: `${endYear}-${pad(endMonth)}-01` };
}

export async function getVariableRules() {
  await ensureVariableCompensationSchema();
  const [row] = await query(
    `SELECT r.rules_json, r.validated, r.version, r.updated_at, u.full_name AS updated_by_name
     FROM variable_compensation_rules r LEFT JOIN users u ON u.id = r.updated_by_user_id WHERE r.id = 1`,
  );
  const stored = row ? validateVariableRules(JSON.parse(row.rules_json)) : null;
  if (!row || !stored.ok) {
    return { rules: DEFAULT_VARIABLE_RULES, validated: false, version: row ? Number(row.version) : 0, isDefault: true, updatedAt: null, updatedByName: null };
  }
  return {
    rules: stored.rules, validated: Boolean(row.validated), version: Number(row.version),
    isDefault: false, updatedAt: row.updated_at, updatedByName: row.updated_by_name || null,
  };
}

export async function saveVariableRules(req, { rules, validated, version }) {
  const checked = validateVariableRules(rules);
  if (!checked.ok) throw Object.assign(new Error("Revisa las reglas de pago"), { status: 400, errors: checked.errors });
  await ensureVariableCompensationSchema();
  await withTransaction(async (connection) => {
    const [rows] = await connection.query("SELECT * FROM variable_compensation_rules WHERE id = 1 FOR UPDATE");
    const previous = rows[0];
    if (Number(previous?.version || 0) !== version) throw new VariableRulesConflictError();
    const now = new Date();
    const payload = JSON.stringify(checked.rules);
    if (previous) {
      await connection.query(
        `UPDATE variable_compensation_rules SET rules_json = ?, validated = ?, version = version + 1,
         updated_by_user_id = ?, updated_at = ? WHERE id = 1`,
        [payload, validated ? 1 : 0, req.user.id, now],
      );
    } else {
      await connection.query(
        `INSERT INTO variable_compensation_rules (id, rules_json, validated, version, updated_by_user_id, updated_at)
         VALUES (1, ?, ?, 1, ?, ?)`,
        [payload, validated ? 1 : 0, req.user.id, now],
      );
    }
    await logAuditEvent({
      req, module: "variable_comercial", action: previous ? "updated" : "created",
      entityType: "variable_compensation_rules", entityId: 1, detail: "Reglas de pago del variable comercial",
      before: previous ? { ...JSON.parse(previous.rules_json), validated: Boolean(previous.validated) } : null,
      after: { ...checked.rules, validated: Boolean(validated) }, connection, required: true,
    });
  });
  return getVariableRules();
}

// Cuentas con alguna oportunidad ganada dentro de la ventana previa al inicio del trimestre: no son clientes nuevos.
async function findAccountsWithPriorWins(accountIds, quarterStart, lookbackMonths) {
  if (!accountIds.length) return new Set();
  const rows = await query(
    `SELECT DISTINCT o.account_id FROM opportunities o
     INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
     WHERE ocs.code = 'ganada' AND o.account_id IN (${accountIds.map(() => "?").join(",")})
       AND o.close_date >= DATE_SUB(?, INTERVAL ? MONTH) AND o.close_date < ?`,
    [...accountIds, quarterStart, lookbackMonths, quarterStart],
  );
  return new Set(rows.map((row) => Number(row.account_id)));
}

async function classifyNewAccounts(quotations, quarterStart, lookbackMonths) {
  const accountIds = [...new Set(quotations.map((quotation) => quotation.accountId).filter(Number.isFinite))];
  const withPriorWins = await findAccountsWithPriorWins(accountIds, quarterStart, lookbackMonths);
  return new Set(accountIds.filter((id) => !withPriorWins.has(id)));
}

function lineBreakdown(quotation) {
  const totals = { products: 0, services: 0, renewals: 0 };
  for (const item of quotation.items || []) totals[item.commissionCategory] += Number(item.salePriceTotal || 0);
  const [dominant] = Object.entries(totals).sort((left, right) => right[1] - left[1]);
  const used = Object.values(totals).filter((amount) => amount > 0).length;
  const label = used > 1 ? "mixed" : dominant && dominant[1] > 0 ? dominant[0] : "products";
  return { totals: { products: round(totals.products), services: round(totals.services), renewals: round(totals.renewals) }, line: label };
}

// Ventas a cuentas existentes del mismo trimestre del año anterior, o null si no hay base comparable.
async function loadExistingAccountsBaseline({ year, quarter, currencyCode, sellerIds, lookbackMonths }) {
  const [period] = await query(
    "SELECT id FROM commercial_planning_periods WHERE plan_year = ? AND plan_quarter = ?", [year - 1, quarter],
  );
  if (!period) return null;
  const tracking = await buildCommissionTrackingPayload(Number(period.id));
  if (String(tracking.baseCurrencyCode).toUpperCase() !== currencyCode) return null;
  const quotations = tracking.summaries.filter((summary) => sellerIds.has(summary.sellerUserId)).flatMap((summary) => summary.quotations);
  const newAccounts = await classifyNewAccounts(quotations, quarterBounds(year - 1, quarter).start, lookbackMonths);
  return round(quotations.filter((quotation) => !newAccounts.has(quotation.accountId))
    .reduce((sum, quotation) => sum + quotation.totalSaleAmount, 0));
}

export async function buildVariableDashboard({ year, quarter, now = new Date() }) {
  await ensureCommercialPlanningSchema();
  const rulesState = await getVariableRules();
  const { rules } = rulesState;
  const period = { year, quarter, label: `T${quarter} ${year}` };
  const [periodRow] = await query(
    "SELECT id FROM commercial_planning_periods WHERE plan_year = ? AND plan_quarter = ?", [year, quarter],
  );
  if (!periodRow) return { status: "no_planning", period, rules: rulesState };

  const tracking = await buildCommissionTrackingPayload(Number(periodRow.id));
  const currencyCode = String(tracking.baseCurrencyCode || "USD").toUpperCase();
  const team = tracking.summaries.filter((summary) => Number(summary.salesQuotaAmount) > 0);
  if (!team.length) return { status: "no_quotas", period, currencyCode, rules: rulesState };
  const teamIds = new Set(team.map((summary) => summary.sellerUserId));

  const bounds = quarterBounds(year, quarter);
  const quotations = team.flatMap((summary) => summary.quotations);
  const newAccounts = await classifyNewAccounts(quotations, bounds.start, rules.newClients.lookbackMonths);

  const quotaAmount = round(team.reduce((sum, seller) => sum + Number(seller.salesQuotaAmount), 0));
  const salesAmount = round(quotations.reduce((sum, quotation) => sum + quotation.totalSaleAmount, 0));
  const costAmount = round(quotations.reduce((sum, quotation) => sum + quotation.totalCostAmount, 0));
  const contributionAmount = round(salesAmount - costAmount);
  const marginPct = salesAmount > 0 ? round(contributionAmount / salesAmount * 100, 2) : null;
  const lowMarginThreshold = rules.margin.lowMarginSalePct;
  const goodQuotations = quotations.filter((quotation) => quotation.quotationMarginPct >= lowMarginThreshold);
  const goodSale = goodQuotations.reduce((sum, quotation) => sum + quotation.totalSaleAmount, 0);
  const marginExcludingLowPct = goodSale > 0
    ? round(goodQuotations.reduce((sum, quotation) => sum + quotation.totalContributionAmount, 0) / goodSale * 100, 2) : null;

  const sellers = team.map((summary) => {
    const attainmentPct = round(summary.acceptedSalesAmount / summary.salesQuotaAmount * 100, 1);
    return {
      sellerUserId: summary.sellerUserId, sellerUserName: summary.sellerUserName,
      quotaAmount: round(summary.salesQuotaAmount), salesAmount: round(summary.acceptedSalesAmount), attainmentPct,
      inQuota: attainmentPct >= rules.team.sellerQuotaPct,
    };
  });
  const sellersInQuota = sellers.filter((seller) => seller.inQuota).length;

  const newQuotations = quotations.filter((quotation) => newAccounts.has(quotation.accountId));
  const amountByNewAccount = new Map();
  for (const quotation of newQuotations) {
    amountByNewAccount.set(quotation.accountId, (amountByNewAccount.get(quotation.accountId) || 0) + quotation.totalSaleAmount);
  }
  const newClients = evaluateNewClients(rules, {
    newSalesAmount: newQuotations.reduce((sum, quotation) => sum + quotation.totalSaleAmount, 0),
    quotaAmount, accountAmounts: [...amountByNewAccount.values()],
  });

  const baselineAmount = await loadExistingAccountsBaseline({
    year, quarter, currencyCode, sellerIds: teamIds, lookbackMonths: rules.newClients.lookbackMonths,
  }).catch(() => null);
  const existingAccounts = evaluateGrowth(rules, {
    currentAmount: quotations.filter((quotation) => !newAccounts.has(quotation.accountId)).reduce((sum, quotation) => sum + quotation.totalSaleAmount, 0),
    baselineAmount,
  });

  const attainmentPct = quotaAmount > 0 ? round(salesAmount / quotaAmount * 100, 2) : 0;
  const variable = calculateVariable(rules, {
    attainmentPct, marginPct, sellersInQuota,
    newClientsMet: newClients.met, existingAccountsMet: existingAccounts.met,
  });

  const startMs = Date.parse(`${bounds.start}T00:00:00Z`);
  const totalDays = Math.round((Date.parse(`${bounds.end}T00:00:00Z`) - startMs) / DAY_MS);
  const today = currentBusinessQuarter(now);
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIMEZONE }).format(now);
  const dayNumber = Math.min(totalDays, Math.max(0, Math.floor((Date.parse(`${todayKey}T00:00:00Z`) - startMs) / DAY_MS) + 1));
  const daysRemaining = totalDays - dayNumber;
  const remainingQuota = Math.max(0, quotaAmount - salesAmount);

  const excludedSales = tracking.summaries.filter((summary) => !teamIds.has(summary.sellerUserId))
    .reduce((sum, summary) => sum + Number(summary.acceptedSalesAmount || 0), 0);
  const pendingAcceptance = tracking.pendingQuotations.filter((quotation) => teamIds.has(quotation.sellerUserId));
  const warnings = [];
  if (tracking.invalidQuotations.length) {
    warnings.push({ code: "invalid_currency", message: `${tracking.invalidQuotations.length} cotización(es) aceptada(s) no se pudieron convertir a ${currencyCode} y no están incluidas.` });
  }
  if (excludedSales > 0) {
    warnings.push({ code: "sellers_without_quota", message: `Hay ventas aceptadas de vendedores sin cuota capturada (${round(excludedSales)} ${currencyCode}); no se incluyen.` });
  }
  if (!existingAccounts.available) {
    warnings.push({ code: "no_baseline", message: `No hay planeación comparable de T${quarter} ${year - 1}; el crecimiento de cuentas actuales no se puede evaluar.` });
  }
  if (!rulesState.validated) {
    warnings.push({ code: "rules_unvalidated", message: "Las reglas de pago están pendientes de validar con la carta de compensación." });
  }

  return {
    status: "ok", period: { ...period, startDate: bounds.start, endDate: bounds.end, totalDays, dayNumber, daysRemaining },
    isCurrentQuarter: today.year === year && today.quarter === quarter,
    currencyCode, rules: rulesState, variable,
    company: {
      quotaAmount, salesAmount, attainmentPct, costAmount, contributionAmount, marginPct, marginExcludingLowPct,
      remainingQuotaAmount: round(remainingQuota),
      requiredDailyAmount: daysRemaining > 0 ? round(remainingQuota / daysRemaining) : null,
      pendingAcceptanceAmount: round(pendingAcceptance.reduce((sum, quotation) => sum + quotation.totalSaleAmount, 0)),
      pendingAcceptanceCount: pendingAcceptance.length,
    },
    sellers, sellersInQuota, newClients, existingAccounts, warnings,
    sales: quotations.map((quotation) => {
      const { totals, line } = lineBreakdown(quotation);
      return {
        quotationId: quotation.quotationId, proposalName: quotation.proposalName, wonAt: quotation.wonAt,
        accountId: quotation.accountId, accountName: quotation.accountName,
        sellerUserId: quotation.sellerUserId, sellerUserName: quotation.sellerUserName,
        line, lineAmounts: totals, saleAmount: quotation.totalSaleAmount, costAmount: quotation.totalCostAmount,
        marginPct: quotation.quotationMarginPct, lowMargin: quotation.quotationMarginPct < lowMarginThreshold,
        newClient: newAccounts.has(quotation.accountId),
      };
    }).sort((left, right) => new Date(right.wonAt).getTime() - new Date(left.wonAt).getTime()),
  };
}
