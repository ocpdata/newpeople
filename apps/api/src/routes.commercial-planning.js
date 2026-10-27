import express from "express";
import { z } from "zod";
import { requirePermission } from "./auth.js";
import { logAuditEvent, parseAuditChangedFields } from "./audit.js";
import { query, withTransaction } from "./db.js";
import { ensureCommercialPlanningSchema } from "./commercial-planning/schema.js";

const router = express.Router();
const commercialSellerEligibilityPermission = "comercial.seller.eligible";

const targetInputSchema = z.object({
  sellerUserId: z.number().int().positive(),
  salesQuotaAmount: z.number().min(0),
  expectedMarginPercent: z.number().min(0).max(999.99),
  notes: z.string().trim().max(4000).optional().nullable(),
  status: z.enum(["complete", "incomplete", "void"]).optional(),
});

const annualTargetsSchema = z.object({
  currencyCode: z.string().trim().min(1).max(10),
  quarters: z.array(z.object({
    quarter: z.number().int().min(1).max(4),
    targets: z.array(targetInputSchema).max(500),
  })).max(4),
});

const commissionConfigInputSchema = z.object({
  sellerUserId: z.number().int().positive(),
  productCommissionPct: z.number().min(0).max(100),
  serviceCommissionPct: z.number().min(0).max(100),
  renewalCommissionPct: z.number().min(0).max(100),
  notes: z.string().trim().max(4000).optional().nullable(),
});

const replaceCommissionConfigsSchema = z.object({
  configs: z.array(commissionConfigInputSchema).max(500),
});

const annualCommissionConfigsSchema = z.object({
  quarters: z.array(z.object({
    quarter: z.number().int().min(1).max(4),
    configs: z.array(commissionConfigInputSchema).max(500),
  })).length(4),
});

const sellerParameterInputSchema = z.object({
  sellerUserId: z.number().int().positive(),
  averageSaleTicketAmount: z.number().min(0),
  leadsToOpportunitiesRatio: z.number().min(0).max(99999),
  opportunitiesToWinsRatio: z.number().min(0).max(99999),
  averageOpportunityToWinDays: z.number().min(0).max(99999),
  useHistoricalAverageSaleTicketForQuotaProbability: z.boolean().optional(),
  useHistoricalLeadsToOpportunitiesForQuotaProbability: z.boolean().optional(),
  useHistoricalOpportunitiesToWinsForQuotaProbability: z.boolean().optional(),
  useHistoricalAverageOpportunityToWinDaysForQuotaProbability: z.boolean().optional(),
  useHistoricalValuesForQuotaProbability: z.boolean().optional(),
});

const replaceSellerParametersSchema = z.object({
  parameters: z.array(sellerParameterInputSchema).max(500),
});

const quarterLabel = (year, quarter) => `T${quarter} ${year}`;
const roundMoney = (value) => Number(Number(value || 0).toFixed(2));
const roundPercent = (value, scale = 2) => Number(Number(value || 0).toFixed(scale));

function mapPeriodRow(row) {
  return {
    id: Number(row.id),
    year: Number(row.plan_year),
    quarter: Number(row.plan_quarter),
    label: quarterLabel(row.plan_year, row.plan_quarter),
    baseCurrencyCode: row.base_currency_code,
    status: row.status,
    notes: row.notes || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    targetCount: Number(row.target_count || 0),
    totalQuotaAmount: roundMoney(row.total_quota_amount),
    totalContributionAmount: roundMoney(row.total_contribution_amount),
    expectedMarginAveragePercent: row.expected_margin_average_percent == null
      ? null : roundPercent(row.expected_margin_average_percent),
  };
}

function mapTargetRow(row) {
  return {
    id: Number(row.id),
    periodId: Number(row.period_id),
    sellerUserId: Number(row.seller_user_id),
    sellerUserName: row.seller_user_name || "",
    sellerUserEmail: row.seller_user_email || "",
    salesQuotaAmount: roundMoney(row.sales_quota_amount),
    currencyCode: row.currency_code || "USD",
    expectedMarginPercent: roundPercent(row.expected_margin_percent),
    expectedContributionAmount: roundMoney(row.expected_contribution_amount),
    notes: row.notes || "",
    status: row.status,
    updatedAt: row.updated_at,
    updatedByUserName: row.updated_by_name || "",
  };
}

function buildChangedTargetFields(_before, after) {
  if (!_before) return after;
  return {
    salesQuotaAmount: after.salesQuotaAmount,
    currencyCode: after.currencyCode,
    expectedMarginPercent: after.expectedMarginPercent,
    expectedContributionAmount: after.expectedContributionAmount,
    notes: after.notes,
    status: after.status,
  };
}

function mapCommissionConfigRow(row) {
  return {
    id: Number(row.id),
    periodId: Number(row.period_id),
    sellerUserId: Number(row.seller_user_id),
    sellerUserName: row.seller_user_name || "",
    sellerUserEmail: row.seller_user_email || "",
    productCommissionPct: roundPercent(row.product_commission_pct, 4),
    serviceCommissionPct: roundPercent(row.service_commission_pct, 4),
    renewalCommissionPct: roundPercent(row.renewal_commission_pct, 4),
    notes: row.notes || "",
    updatedAt: row.updated_at,
    updatedByUserName: row.updated_by_name || "",
  };
}

function mapSellerParameterRow(row) {
  const legacyToggle = Number(row.use_historical_values_for_quota_probability || 0) > 0;
  return {
    id: Number(row.id),
    sellerUserId: Number(row.seller_user_id),
    sellerUserName: row.seller_user_name || "",
    sellerUserEmail: row.seller_user_email || "",
    averageSaleTicketAmount: roundMoney(row.average_sale_ticket_amount),
    leadsToOpportunitiesRatio: roundPercent(row.leads_to_opportunities_ratio, 4),
    opportunitiesToWinsRatio: roundPercent(row.opportunities_to_wins_ratio, 4),
    averageOpportunityToWinDays: roundPercent(row.average_opportunity_to_win_days, 2),
    useHistoricalAverageSaleTicketForQuotaProbability:
      Number(row.use_hist_avg_ticket_quota_prob || 0) > 0,
    useHistoricalLeadsToOpportunitiesForQuotaProbability:
      Number(row.use_hist_l2o_quota_prob || 0) > 0,
    useHistoricalOpportunitiesToWinsForQuotaProbability:
      Number(row.use_hist_o2w_quota_prob || 0) > 0,
    useHistoricalAverageOpportunityToWinDaysForQuotaProbability:
      Number(row.use_hist_avg_o2w_days_quota_prob || 0) > 0,
    useHistoricalValuesForQuotaProbability: legacyToggle,
    updatedAt: row.updated_at,
    updatedByUserName: row.updated_by_name || "",
  };
}

function getQuarterDateRange(year, quarter) {
  const start = new Date(Date.UTC(Number(year), (Number(quarter) - 1) * 3, 1));
  const end = new Date(Date.UTC(Number(year), Number(quarter) * 3, 1));
  return { start, end };
}

function normalizeCommissionAmountToBase(amount, quotationCurrencyCode, baseCurrencyCode, exchangeRate) {
  const numericAmount = Number(amount || 0);
  if (!numericAmount) return 0;
  const quotationCurrency = String(quotationCurrencyCode || "").trim().toUpperCase();
  const baseCurrency = String(baseCurrencyCode || "").trim().toUpperCase();
  const numericExchangeRate = Number(exchangeRate || 0);
  if (!quotationCurrency || !baseCurrency || quotationCurrency === baseCurrency || !(numericExchangeRate > 0)) return numericAmount;
  if (baseCurrency === "USD") return numericAmount / numericExchangeRate;
  if (quotationCurrency === "USD") return numericAmount * numericExchangeRate;
  return numericAmount;
}

function calculateCommissionItemAmounts(item) {
  if (!item || String(item.itemType) === "grupo_productos") {
    return { discountedListPriceUnit: 0, costUnit: 0, costTotal: 0, salePriceUnit: 0, salePriceTotal: 0, contributionAmount: 0 };
  }
  const listPriceUnit = Number(item.listPriceUnit || 0);
  const quantity = Number(item.quantity || 0);
  const discountedListPriceUnit = listPriceUnit * (1 - Number(item.manufacturerDiscountPct || 0) / 100);
  const costUnit = discountedListPriceUnit * (1 + Number(item.importCostPct || 0) / 100);
  const profitMarginPct = Number(item.profitMarginPct || 0);
  const salePriceUnit = profitMarginPct >= 100 ? 0 : (costUnit / (1 - profitMarginPct / 100)) * (1 - Number(item.finalDiscountPct || 0) / 100);
  const costTotal = costUnit * quantity;
  const salePriceTotal = salePriceUnit * quantity;
  return { discountedListPriceUnit, costUnit, costTotal, salePriceUnit, salePriceTotal, contributionAmount: salePriceTotal - costTotal };
}

function isAccessQualityProvider(providerName) {
  return String(providerName || "").trim().toLowerCase().includes("access quality");
}

function resolveCommissionCategory(item) {
  if (item?.isRenewal) return "renewals";
  return String(item?.itemType || "") === "servicio_propio" && isAccessQualityProvider(item?.providerName)
    ? "services" : "products";
}

async function getTargetsForPeriod(periodId) {
  const rows = await query(
    `SELECT t.*, u.full_name AS seller_user_name, u.email AS seller_user_email,
            updater.full_name AS updated_by_name
     FROM commercial_planning_period_targets t
     INNER JOIN users u ON u.id = t.seller_user_id
     LEFT JOIN users updater ON updater.id = t.updated_by_user_id
     WHERE t.period_id = ? ORDER BY u.full_name`,
    [Number(periodId)],
  );
  return rows.map(mapTargetRow);
}

async function getCommissionConfigsForPeriod(periodId) {
  const rows = await query(
    `SELECT c.*, u.full_name AS seller_user_name, u.email AS seller_user_email,
            updater.full_name AS updated_by_name
     FROM commercial_planning_commission_configs c
     INNER JOIN users u ON u.id = c.seller_user_id
     LEFT JOIN users updater ON updater.id = c.updated_by_user_id
     WHERE c.period_id = ? ORDER BY u.full_name`,
    [Number(periodId)],
  );
  return rows.map(mapCommissionConfigRow);
}

async function buildCommissionConfigPayload(periodId) {
  const period = await getPeriodById(periodId);
  if (!period) {
    const error = new Error("Periodo no encontrado");
    error.status = 404;
    throw error;
  }
  const [targets, eligibleSellers, configs] = await Promise.all([
    getTargetsForPeriod(periodId),
    listEligibleSellers(),
    getCommissionConfigsForPeriod(periodId),
  ]);
  const targetsBySellerId = new Map(targets.map((target) => [target.sellerUserId, target]));
  const configsBySellerId = new Map(configs.map((config) => [config.sellerUserId, config]));
  const sellers = eligibleSellers.map((seller) => {
    const target = targetsBySellerId.get(seller.id);
    const config = configsBySellerId.get(seller.id);
    return {
      sellerUserId: seller.id,
      sellerUserName: seller.fullName,
      sellerUserEmail: seller.email,
      salesQuotaAmount: target?.salesQuotaAmount || 0,
      currencyCode: target?.currencyCode || period.baseCurrencyCode || "USD",
      productCommissionPct: config?.productCommissionPct || 0,
      serviceCommissionPct: config?.serviceCommissionPct || 0,
      renewalCommissionPct: config?.renewalCommissionPct || 0,
      notes: config?.notes || "",
      updatedAt: config?.updatedAt || null,
      updatedByUserName: config?.updatedByUserName || "",
    };
  });
  return { period, sellers, configs };
}

async function buildCommissionTrackingPayload(periodId) {
  const commissionConfig = await buildCommissionConfigPayload(periodId);
  const { period, sellers } = commissionConfig;
  const { start, end } = getQuarterDateRange(period.year, period.quarter);
  // Solo cuentan cotizaciones aceptadas, pero se ubican en el trimestre en que se declararon
  // ganadas. Sin ese evento se usa la primera aceptación y, al final, updated_at.
  // Las ganadas aún sin aceptar se devuelven aparte (pendingQuotations) y no suman.
  const trackedQuotations = await query(
    `SELECT w.* FROM (
       SELECT q.id AS quotation_id, q.latest_version_id AS quotation_version_id,
              qv.proposal_name, qs.code AS status_code, qv.currency_code,
              qv.exchange_rate, a.name AS account_name, o.name AS opportunity_name,
              o.seller_user_id, su.full_name AS seller_user_name, su.email AS seller_user_email,
              COALESCE(
                (SELECT MAX(al.created_at) FROM audit_log al
                  WHERE al.module = 'cotizaciones' AND al.action = 'declarar_ganada'
                    AND al.entity_type = 'quotation_version' AND al.entity_id = qv.id
                    AND al.status = 'success'),
                (SELECT MIN(al.created_at) FROM audit_log al
                  WHERE al.module = 'cotizaciones' AND al.action = 'aceptar'
                    AND al.entity_type = 'quotation_version' AND al.entity_id = qv.id
                    AND al.status = 'success'),
                qv.updated_at
              ) AS won_at
       FROM quotations q
       INNER JOIN quotation_versions qv ON qv.id = q.latest_version_id
       INNER JOIN quotation_statuses qs ON qs.id = qv.status_id
       INNER JOIN opportunities o ON o.id = q.opportunity_id
       INNER JOIN accounts a ON a.id = o.account_id
       LEFT JOIN users su ON su.id = o.seller_user_id
       WHERE qs.code IN ('aceptada', 'ganada') AND o.seller_user_id IS NOT NULL
     ) w
     WHERE w.won_at >= ? AND w.won_at < ?
     ORDER BY w.won_at DESC, w.quotation_id DESC`,
    [start, end],
  );
  const acceptedQuotations = trackedQuotations.filter((row) => row.status_code === "aceptada");
  const pendingQuotationRows = trackedQuotations.filter((row) => row.status_code === "ganada");
  const quotationVersionIds = trackedQuotations.map((row) => Number(row.quotation_version_id));
  const itemsByVersionId = new Map();
  if (quotationVersionIds.length) {
    const placeholders = quotationVersionIds.map(() => "?").join(", ");
    const itemRows = await query(
      `SELECT qs.quotation_version_id, qsi.id AS item_id, qsi.provider_id,
              p.name AS provider_name, qsi.product_code, qsi.product_description,
              qsi.item_type, qsi.is_renewal, qsi.quantity, qsi.list_price_unit,
              qsi.manufacturer_discount_pct, qsi.import_cost_pct,
              qsi.profit_margin_pct, qsi.final_discount_pct
       FROM quotation_sections qs
       INNER JOIN quotation_section_items qsi ON qsi.quotation_section_id = qs.id
       INNER JOIN providers p ON p.id = qsi.provider_id
       WHERE qs.quotation_version_id IN (${placeholders})
       ORDER BY qs.quotation_version_id, qsi.display_order, qsi.id`,
      quotationVersionIds,
    );
    itemRows.forEach((row) => {
      const key = Number(row.quotation_version_id);
      const existing = itemsByVersionId.get(key) || [];
      existing.push({
        itemId: Number(row.item_id), providerId: Number(row.provider_id), providerName: row.provider_name || "",
        productCode: row.product_code || "", productDescription: row.product_description || "",
        itemType: row.item_type || "producto", isRenewal: Boolean(row.is_renewal),
        quantity: Number(row.quantity || 0), listPriceUnit: Number(row.list_price_unit || 0),
        manufacturerDiscountPct: Number(row.manufacturer_discount_pct || 0),
        importCostPct: Number(row.import_cost_pct || 0), profitMarginPct: Number(row.profit_margin_pct || 0),
        finalDiscountPct: Number(row.final_discount_pct || 0),
      });
      itemsByVersionId.set(key, existing);
    });
  }
  const summariesBySellerId = new Map(
    sellers.map((seller) => [seller.sellerUserId, {
      sellerUserId: seller.sellerUserId, sellerUserName: seller.sellerUserName,
      sellerUserEmail: seller.sellerUserEmail,
      currencyCode: seller.currencyCode || period.baseCurrencyCode || "USD",
      salesQuotaAmount: roundMoney(seller.salesQuotaAmount || 0),
      productCommissionPct: roundPercent(seller.productCommissionPct, 4),
      serviceCommissionPct: roundPercent(seller.serviceCommissionPct, 4),
      renewalCommissionPct: roundPercent(seller.renewalCommissionPct, 4),
      acceptedSalesAmount: 0, quotaAttainmentPct: 0, commissionEnabled: false,
      acceptedQuotationCount: 0, eligibleQuotationCount: 0,
      blockedLowMarginQuotationCount: 0, blockedByQuotaQuotationCount: 0,
      eligibleProductContributionAmount: 0, eligibleServiceContributionAmount: 0,
      eligibleRenewalContributionAmount: 0, calculatedProductCommissionAmount: 0,
      calculatedServiceCommissionAmount: 0, calculatedRenewalCommissionAmount: 0,
      calculatedTotalCommissionAmount: 0, quotations: [],
    }]),
  );

  const computeQuotation = (quotationRow) => {
    const quotationCurrencyCode = quotationRow.currency_code || period.baseCurrencyCode || "USD";
    const exchangeRate = Number(quotationRow.exchange_rate || 0);
    const items = (itemsByVersionId.get(Number(quotationRow.quotation_version_id)) || [])
      .filter((item) => item.itemType !== "grupo_productos")
      .map((item) => {
        const amounts = calculateCommissionItemAmounts(item);
        const costTotal = normalizeCommissionAmountToBase(amounts.costTotal, quotationCurrencyCode, period.baseCurrencyCode, exchangeRate);
        const salePriceTotal = normalizeCommissionAmountToBase(amounts.salePriceTotal, quotationCurrencyCode, period.baseCurrencyCode, exchangeRate);
        const contributionAmount = normalizeCommissionAmountToBase(amounts.contributionAmount, quotationCurrencyCode, period.baseCurrencyCode, exchangeRate);
        return { ...item, commissionCategory: resolveCommissionCategory(item), costTotal: roundMoney(costTotal), salePriceTotal: roundMoney(salePriceTotal), contributionAmount: roundMoney(contributionAmount) };
      });
    const totalSaleAmount = roundMoney(items.reduce((sum, item) => sum + Number(item.salePriceTotal || 0), 0));
    const totalCostAmount = roundMoney(items.reduce((sum, item) => sum + Number(item.costTotal || 0), 0));
    const totalContributionAmount = roundMoney(totalSaleAmount - totalCostAmount);
    const quotationMarginPct = totalSaleAmount > 0 ? roundPercent((totalContributionAmount / totalSaleAmount) * 100, 2) : 0;
    return {
      quotationId: Number(quotationRow.quotation_id),
      quotationVersionId: Number(quotationRow.quotation_version_id),
      proposalName: quotationRow.proposal_name || `Cotizacion ${quotationRow.quotation_id}`,
      wonAt: quotationRow.won_at, statusCode: quotationRow.status_code,
      accountName: quotationRow.account_name || "",
      opportunityName: quotationRow.opportunity_name || "",
      sellerUserId: Number(quotationRow.seller_user_id), sellerUserName: quotationRow.seller_user_name || "",
      sellerUserEmail: quotationRow.seller_user_email || "",
      currencyCode: period.baseCurrencyCode || quotationCurrencyCode,
      totalSaleAmount, totalCostAmount, totalContributionAmount, quotationMarginPct, items,
    };
  };
  const computedQuotations = acceptedQuotations.map(computeQuotation);
  const pendingQuotations = pendingQuotationRows.map((row) => {
    const { items: _items, ...quotation } = computeQuotation(row);
    return quotation;
  });

  computedQuotations.forEach((quotation) => {
    const summary = summariesBySellerId.get(quotation.sellerUserId) || {
      sellerUserId: quotation.sellerUserId, sellerUserName: quotation.sellerUserName,
      sellerUserEmail: quotation.sellerUserEmail, currencyCode: period.baseCurrencyCode || "USD",
      salesQuotaAmount: 0, productCommissionPct: 0, serviceCommissionPct: 0,
      renewalCommissionPct: 0, acceptedSalesAmount: 0, quotaAttainmentPct: 0,
      commissionEnabled: false, acceptedQuotationCount: 0, eligibleQuotationCount: 0,
      blockedLowMarginQuotationCount: 0, blockedByQuotaQuotationCount: 0,
      eligibleProductContributionAmount: 0, eligibleServiceContributionAmount: 0,
      eligibleRenewalContributionAmount: 0, calculatedProductCommissionAmount: 0,
      calculatedServiceCommissionAmount: 0, calculatedRenewalCommissionAmount: 0,
      calculatedTotalCommissionAmount: 0, quotations: [],
    };
    summary.acceptedSalesAmount = roundMoney(Number(summary.acceptedSalesAmount || 0) + quotation.totalSaleAmount);
    summary.acceptedQuotationCount += 1;
    summary.quotations.push(quotation);
    summariesBySellerId.set(quotation.sellerUserId, summary);
  });

  const summaries = Array.from(summariesBySellerId.values()).map((summary) => {
    const quotaAttainmentPct = Number(summary.salesQuotaAmount || 0) > 0
      ? roundPercent((Number(summary.acceptedSalesAmount || 0) / Number(summary.salesQuotaAmount || 1)) * 100, 2) : 0;
    const commissionEnabled = quotaAttainmentPct >= 70;
    summary.quotaAttainmentPct = quotaAttainmentPct;
    summary.commissionEnabled = commissionEnabled;
    summary.quotations = summary.quotations.map((quotation) => {
      const passesMarginRule = Number(quotation.quotationMarginPct || 0) >= 10;
      if (passesMarginRule && commissionEnabled) summary.eligibleQuotationCount += 1;
      else if (!passesMarginRule) summary.blockedLowMarginQuotationCount += 1;
      else summary.blockedByQuotaQuotationCount += 1;
      const items = quotation.items.map((item) => {
        const commissionPct = item.commissionCategory === "renewals"
          ? Number(summary.renewalCommissionPct || 0)
          : item.commissionCategory === "services"
            ? Number(summary.serviceCommissionPct || 0) : Number(summary.productCommissionPct || 0);
        const commissionAmount = passesMarginRule && commissionEnabled
          ? roundMoney((Number(item.contributionAmount || 0) * commissionPct) / 100) : 0;
        if (passesMarginRule && commissionEnabled) {
          const contributionKey = item.commissionCategory === "renewals"
            ? "eligibleRenewalContributionAmount"
            : item.commissionCategory === "services"
              ? "eligibleServiceContributionAmount" : "eligibleProductContributionAmount";
          const commissionKey = item.commissionCategory === "renewals"
            ? "calculatedRenewalCommissionAmount"
            : item.commissionCategory === "services"
              ? "calculatedServiceCommissionAmount" : "calculatedProductCommissionAmount";
          summary[contributionKey] = roundMoney(Number(summary[contributionKey] || 0) + Number(item.contributionAmount || 0));
          summary[commissionKey] = roundMoney(Number(summary[commissionKey] || 0) + commissionAmount);
        }
        return {
          ...item, commissionPct: roundPercent(commissionPct, 4), commissionAmount,
          passesMarginRule, sellerPassesQuotaRule: commissionEnabled,
          calculationStatus: !passesMarginRule ? "blocked_by_margin" : !commissionEnabled ? "blocked_by_quota" : "eligible",
        };
      });
      return { ...quotation, passesMarginRule, sellerPassesQuotaRule: commissionEnabled, items };
    });
    summary.calculatedTotalCommissionAmount = roundMoney(
      Number(summary.calculatedProductCommissionAmount || 0) + Number(summary.calculatedServiceCommissionAmount || 0) + Number(summary.calculatedRenewalCommissionAmount || 0),
    );
    return summary;
  });

  return {
    period,
    baseCurrencyCode: period.baseCurrencyCode || "USD",
    pendingQuotations,
    summaries: summaries.sort((left, right) => String(left.sellerUserName || "").localeCompare(String(right.sellerUserName || ""), "es")),
  };
}

async function listEligibleSellers() {
  const rows = await query(
    `SELECT DISTINCT u.id, u.full_name, u.email, u.status,
            GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ', ') AS roles
     FROM users u
     INNER JOIN user_roles ur ON ur.user_id = u.id
     INNER JOIN roles r ON r.id = ur.role_id
     INNER JOIN role_permissions rp ON rp.role_id = r.id
     INNER JOIN permissions p ON p.id = rp.permission_id
     WHERE u.status = 'active' AND r.is_active = 1 AND p.code = ?
     GROUP BY u.id, u.full_name, u.email, u.status ORDER BY u.id`,
    [commercialSellerEligibilityPermission],
  );
  return rows.map((row) => ({ id: Number(row.id), fullName: row.full_name, email: row.email, status: row.status, roles: row.roles || "" }));
}

async function getSellerParameters() {
  const rows = await query(
    `SELECT p.*, u.full_name AS seller_user_name, u.email AS seller_user_email,
            updater.full_name AS updated_by_name
     FROM commercial_planning_seller_parameters p
     INNER JOIN users u ON u.id = p.seller_user_id
     LEFT JOIN users updater ON updater.id = p.updated_by_user_id
     ORDER BY u.full_name`,
  );
  return rows.map(mapSellerParameterRow);
}

async function buildSellerParametersPayload() {
  const [eligibleSellers, parameters] = await Promise.all([
    listEligibleSellers(), getSellerParameters(),
  ]);
  const parameterBySellerId = new Map(parameters.map((item) => [item.sellerUserId, item]));
  return {
    sellers: eligibleSellers.map((seller) => {
      const parameter = parameterBySellerId.get(seller.id);
      return {
        sellerUserId: seller.id, sellerUserName: seller.fullName, sellerUserEmail: seller.email,
        averageSaleTicketAmount: parameter?.averageSaleTicketAmount || 0,
        leadsToOpportunitiesRatio: parameter?.leadsToOpportunitiesRatio || 0,
        opportunitiesToWinsRatio: parameter?.opportunitiesToWinsRatio || 0,
        averageOpportunityToWinDays: parameter?.averageOpportunityToWinDays || 0,
        useHistoricalAverageSaleTicketForQuotaProbability: parameter?.useHistoricalAverageSaleTicketForQuotaProbability ?? false,
        useHistoricalLeadsToOpportunitiesForQuotaProbability: parameter?.useHistoricalLeadsToOpportunitiesForQuotaProbability ?? false,
        useHistoricalOpportunitiesToWinsForQuotaProbability: parameter?.useHistoricalOpportunitiesToWinsForQuotaProbability ?? false,
        useHistoricalAverageOpportunityToWinDaysForQuotaProbability: parameter?.useHistoricalAverageOpportunityToWinDaysForQuotaProbability ?? false,
        useHistoricalValuesForQuotaProbability: parameter?.useHistoricalValuesForQuotaProbability ?? false,
        updatedAt: parameter?.updatedAt || null,
        updatedByUserName: parameter?.updatedByUserName || "",
      };
    }),
    parameters,
  };
}

async function getPeriodById(periodId) {
  const rows = await query(
    `SELECT p.*,
            (SELECT COUNT(*) FROM commercial_planning_period_targets t WHERE t.period_id = p.id) AS target_count,
            (SELECT COALESCE(SUM(t.sales_quota_amount), 0) FROM commercial_planning_period_targets t WHERE t.period_id = p.id) AS total_quota_amount,
            (SELECT COALESCE(SUM(t.expected_contribution_amount), 0) FROM commercial_planning_period_targets t WHERE t.period_id = p.id) AS total_contribution_amount,
            (SELECT AVG(t.expected_margin_percent) FROM commercial_planning_period_targets t WHERE t.period_id = p.id) AS expected_margin_average_percent
     FROM commercial_planning_periods p WHERE p.id = ?`,
    [periodId],
  );
  return rows[0] ? mapPeriodRow(rows[0]) : null;
}

async function getPlanningYearDetail(year) {
  const periodRows = await query(
    `SELECT p.*,
            COUNT(t.id) AS target_count,
            COALESCE(SUM(t.sales_quota_amount), 0) AS total_quota_amount,
            COALESCE(SUM(t.expected_contribution_amount), 0) AS total_contribution_amount,
            AVG(t.expected_margin_percent) AS expected_margin_average_percent
     FROM commercial_planning_periods p
     LEFT JOIN commercial_planning_period_targets t ON t.period_id = p.id
     WHERE p.plan_year = ? GROUP BY p.id ORDER BY p.plan_quarter`,
    [year],
  );
  const currencyCodes = [...new Set(periodRows.map((row) => String(row.base_currency_code || "USD").toUpperCase()))];
  if (currencyCodes.length > 1) {
    const error = new Error("Los trimestres del año tienen monedas distintas; corrige la configuración antes de editarlos.");
    error.status = 409;
    throw error;
  }
  const currencyCode = currencyCodes[0] || "USD";
  const eligibleSellers = await listEligibleSellers();
  const periodsByQuarter = new Map(periodRows.map((row) => [Number(row.plan_quarter), row]));
  const quarters = await Promise.all([1, 2, 3, 4].map(async (quarter) => {
    const row = periodsByQuarter.get(quarter);
    const period = row ? mapPeriodRow(row) : {
      id: null, year, quarter, label: quarterLabel(year, quarter), baseCurrencyCode: currencyCode,
      status: "active", targetCount: 0, totalQuotaAmount: 0, totalContributionAmount: 0,
      expectedMarginAveragePercent: null,
    };
    return { quarter, period, targets: row ? await getTargetsForPeriod(Number(row.id)) : [] };
  }));
  return { year, currencyCode, hasPersistedPeriods: periodRows.length > 0, eligibleSellers, quarters };
}

async function buildAnnualCommissionConfigPayload(year) {
  const planningYear = await getPlanningYearDetail(year);
  const quarters = await Promise.all(planningYear.quarters.map(async (item) => {
    if (item.period.id) {
      const payload = await buildCommissionConfigPayload(item.period.id);
      return { quarter: item.quarter, period: item.period, sellers: payload.sellers };
    }
    const targetsBySellerId = new Map(item.targets.map((target) => [target.sellerUserId, target]));
    return {
      quarter: item.quarter,
      period: item.period,
      sellers: planningYear.eligibleSellers.map((seller) => {
        const target = targetsBySellerId.get(seller.id);
        return {
          sellerUserId: seller.id,
          sellerUserName: seller.fullName,
          sellerUserEmail: seller.email,
          salesQuotaAmount: target?.salesQuotaAmount || 0,
          currencyCode: planningYear.currencyCode,
          productCommissionPct: 0,
          serviceCommissionPct: 0,
          renewalCommissionPct: 0,
          notes: "",
          updatedAt: null,
          updatedByUserName: "",
        };
      }),
    };
  }));
  return {
    year,
    currencyCode: planningYear.currencyCode,
    hasPersistedPeriods: planningYear.hasPersistedPeriods,
    quarters,
  };
}

router.use(async (_req, _res, next) => {
  await ensureCommercialPlanningSchema();
  next();
});

router.get(
  "/years/:year",
  requirePermission("planeacion_comercial.read"),
  async (req, res) => {
    const year = Number(req.params.year);
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      return res.status(400).json({ message: "Año de planeación inválido" });
    }
    try {
      res.json(await getPlanningYearDetail(year));
    } catch (error) {
      res.status(Number(error?.status) || 500).json({
        message: error.message || "No fue posible cargar las metas del año",
      });
    }
  },
);

router.get(
  "/years/:year/commission-configs",
  requirePermission("planeacion_comercial.read"),
  async (req, res) => {
    const year = Number(req.params.year);
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      return res.status(400).json({ message: "Año de planeación inválido" });
    }
    try {
      res.json(await buildAnnualCommissionConfigPayload(year));
    } catch (error) {
      res.status(Number(error?.status) || 500).json({
        message: error.message || "No fue posible cargar la configuración anual de comisiones",
      });
    }
  },
);

router.put(
  "/years/:year/commission-configs",
  async (req, res) => {
    const year = Number(req.params.year);
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      return res.status(400).json({ message: "Año de planeación inválido" });
    }
    const parsed = annualCommissionConfigsSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos de configuración anual inválidos",
        errors: parsed.error.flatten(),
      });
    }

    let planningYear;
    try {
      planningYear = await getPlanningYearDetail(year);
    } catch (error) {
      return res.status(Number(error?.status) || 500).json({
        message: error.message || "No fue posible cargar la configuración anual de comisiones",
      });
    }
    const requiredPermission = planningYear.hasPersistedPeriods
      ? "planeacion_comercial.update"
      : "planeacion_comercial.create";
    if (!req.user?.permissionSet?.has(requiredPermission)) {
      return res.status(403).json({ message: "No autorizado", requiredPermission });
    }

    const configsByQuarter = new Map();
    for (const item of parsed.data.quarters) {
      if (configsByQuarter.has(item.quarter)) {
        return res.status(400).json({ message: "Trimestre duplicado en la configuración anual" });
      }
      const sellerIds = item.configs.map((config) => Number(config.sellerUserId));
      if (new Set(sellerIds).size !== sellerIds.length) {
        return res.status(400).json({ message: `Vendedores duplicados en T${item.quarter}` });
      }
      configsByQuarter.set(item.quarter, item.configs);
    }
    if (configsByQuarter.size !== 4) {
      return res.status(400).json({ message: "Envía la configuración de los cuatro trimestres" });
    }

    const eligibleSellers = await listEligibleSellers();
    const eligibleSellerIds = new Set(eligibleSellers.map((seller) => seller.id));
    for (const [quarter, configs] of configsByQuarter) {
      if (configs.some((config) => !eligibleSellerIds.has(Number(config.sellerUserId)))) {
        return res.status(400).json({
          message: `Solo puedes configurar vendedores elegibles en T${quarter}`,
        });
      }
    }

    const beforeByQuarter = new Map(await Promise.all(planningYear.quarters.map(async (item) => [
      item.quarter,
      item.period.id ? await getCommissionConfigsForPeriod(item.period.id) : [],
    ])));
    const actorUserId = Number(req.user?.id) || null;
    const now = new Date();
    try {
      await withTransaction(async (conn) => {
        await conn.query(
          `SELECT id FROM commercial_planning_periods
           WHERE plan_year = ? FOR UPDATE`,
          [year],
        );
        for (let quarter = 1; quarter <= 4; quarter += 1) {
          await conn.query(
            `INSERT IGNORE INTO commercial_planning_periods
               (plan_year, plan_quarter, base_currency_code, status,
                created_by_user_id, updated_by_user_id, created_at, updated_at)
             VALUES (?, ?, ?, 'active', ?, ?, ?, ?)`,
            [year, quarter, planningYear.currencyCode, actorUserId, actorUserId, now, now],
          );
        }
        const [periodRows] = await conn.query(
          `SELECT id, plan_quarter FROM commercial_planning_periods
           WHERE plan_year = ? FOR UPDATE`,
          [year],
        );
        const periodIdsByQuarter = new Map(
          periodRows.map((period) => [Number(period.plan_quarter), Number(period.id)]),
        );
        if (periodIdsByQuarter.size !== 4) {
          const error = new Error("No fue posible materializar los cuatro trimestres");
          error.status = 409;
          throw error;
        }

        for (let quarter = 1; quarter <= 4; quarter += 1) {
          const periodId = periodIdsByQuarter.get(quarter);
          const existingNotesBySeller = new Map(
            (beforeByQuarter.get(quarter) || []).map((config) => [config.sellerUserId, config.notes]),
          );
          await conn.query(
            "DELETE FROM commercial_planning_commission_configs WHERE period_id = ?",
            [periodId],
          );
          for (const config of configsByQuarter.get(quarter)) {
            await conn.query(
              `INSERT INTO commercial_planning_commission_configs
                 (period_id, seller_user_id, product_commission_pct, service_commission_pct,
                  renewal_commission_pct, notes, created_by_user_id, updated_by_user_id,
                  created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                periodId,
                Number(config.sellerUserId),
                roundPercent(config.productCommissionPct, 4),
                roundPercent(config.serviceCommissionPct, 4),
                roundPercent(config.renewalCommissionPct, 4),
                config.notes === undefined
                  ? existingNotesBySeller.get(Number(config.sellerUserId)) || null
                  : String(config.notes || "").trim() || null,
                actorUserId,
                actorUserId,
                now,
                now,
              ],
            );
          }
          await conn.query(
            `UPDATE commercial_planning_periods
             SET updated_by_user_id = ?, updated_at = ? WHERE id = ?`,
            [actorUserId, now, periodId],
          );
        }
      });
    } catch (error) {
      return res.status(Number(error?.status) || 500).json({
        message: error.message || "No fue posible guardar la configuración anual de comisiones",
      });
    }

    const payload = await buildAnnualCommissionConfigPayload(year);
    for (const item of payload.quarters) {
      const beforeConfigs = beforeByQuarter.get(item.quarter) || [];
      const afterConfigs = await getCommissionConfigsForPeriod(item.period.id);
      await logAuditEvent({
        req,
        module: "planeacion_comercial",
        action: "updated_commission_configs",
        entityType: "commercial_planning_period",
        entityId: item.period.id,
        detail: `Configuración de comisiones actualizada en ${item.period.label}`,
        before: { configs: beforeConfigs },
        after: { configs: afterConfigs },
      });
    }
    res.json({ message: "Configuración anual de comisiones actualizada correctamente", ...payload });
  },
);

router.put(
  "/years/:year/targets",
  async (req, res) => {
    const year = Number(req.params.year);
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      return res.status(400).json({ message: "Año de planeación inválido" });
    }
    const parsed = annualTargetsSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos de metas inválidos",
        errors: parsed.error.flatten(),
      });
    }

    let initialPlan;
    try {
      initialPlan = await getPlanningYearDetail(year);
    } catch (error) {
      return res.status(Number(error?.status) || 500).json({
        message: error.message || "No fue posible cargar las metas del año",
      });
    }
    const requiredPermission = initialPlan.hasPersistedPeriods
      ? "planeacion_comercial.update"
      : "planeacion_comercial.create";
    if (!req.user?.permissionSet?.has(requiredPermission)) {
      return res.status(403).json({
        message: "No autorizado",
        requiredPermission,
      });
    }

    const currencyCode = parsed.data.currencyCode.trim().toUpperCase();
    const submittedByQuarter = new Map();
    for (const quarter of parsed.data.quarters) {
      if (submittedByQuarter.has(quarter.quarter)) {
        return res.status(400).json({ message: "Trimestre duplicado en las metas" });
      }
      submittedByQuarter.set(quarter.quarter, quarter.targets);
    }

    const editableQuarters = initialPlan.quarters;
    if (
      submittedByQuarter.size !== 4 ||
      editableQuarters.some((item) => !submittedByQuarter.has(item.quarter))
    ) {
      return res.status(400).json({
        message: "Envía las metas de los cuatro trimestres",
      });
    }

    const eligibleSellers = await listEligibleSellers();
    const eligibleSellerIds = new Set(eligibleSellers.map((seller) => seller.id));
    const normalizedByQuarter = new Map();
    for (const { quarter, targets } of parsed.data.quarters) {
      const duplicateSellerIds = targets
        .map((target) => Number(target.sellerUserId))
        .filter((sellerId, index, list) => list.indexOf(sellerId) !== index);
      if (duplicateSellerIds.length) {
        return res.status(400).json({
          message: `No se permiten vendedores duplicados en T${quarter}`,
        });
      }
      if (targets.some((target) => !eligibleSellerIds.has(Number(target.sellerUserId)))) {
        return res.status(400).json({
          message: "Solo puedes configurar metas para vendedores elegibles y activos",
        });
      }
      normalizedByQuarter.set(
        quarter,
        targets.map((target) => ({
          sellerUserId: Number(target.sellerUserId),
          salesQuotaAmount: roundMoney(target.salesQuotaAmount),
          expectedMarginPercent: Number(Number(target.expectedMarginPercent).toFixed(2)),
          expectedContributionAmount: roundMoney(
            Number(target.salesQuotaAmount) * Number(target.expectedMarginPercent) / 100,
          ),
          notes: target.notes || null,
          status: target.status || "complete",
        })),
      );
    }

    const beforeByQuarter = new Map(
      await Promise.all(editableQuarters.map(async (item) => [
        item.quarter,
        item.period.id ? await getTargetsForPeriod(item.period.id) : [],
      ])),
    );
    const actorUserId = Number(req.user?.id) || null;
    const now = new Date();

    try {
      await withTransaction(async (conn) => {
        await conn.query(
          `SELECT id FROM commercial_planning_periods
           WHERE plan_year = ? FOR UPDATE`,
          [year],
        );
        for (let quarter = 1; quarter <= 4; quarter += 1) {
          await conn.query(
            `INSERT IGNORE INTO commercial_planning_periods
               (plan_year, plan_quarter, base_currency_code, status,
                created_by_user_id, updated_by_user_id, created_at, updated_at)
             VALUES (?, ?, ?, 'active', ?, ?, ?, ?)`,
            [year, quarter, currencyCode, actorUserId, actorUserId, now, now],
          );
        }

        const [periodRows] = await conn.query(
          `SELECT id, plan_quarter, base_currency_code
           FROM commercial_planning_periods
           WHERE plan_year = ? FOR UPDATE`,
          [year],
        );
        const currentPeriods = new Map(
          periodRows.map((period) => [Number(period.plan_quarter), period]),
        );
        const currentCurrencies = [...new Set(
          periodRows.map((period) => String(period.base_currency_code || "USD").toUpperCase()),
        )];
        if (currentCurrencies.length > 1) {
          const error = new Error("Los trimestres del año tienen monedas distintas; corrige la configuración antes de editarlos.");
          error.status = 409;
          throw error;
        }
        for (const { quarter } of editableQuarters) {
          const period = currentPeriods.get(quarter);
          if (!period) {
            const error = new Error("No fue posible materializar todos los trimestres del año");
            error.status = 409;
            throw error;
          }
          await conn.query(
            `UPDATE commercial_planning_periods
             SET base_currency_code = ?, updated_by_user_id = ?, updated_at = ?
             WHERE id = ?`,
            [currencyCode, actorUserId, now, Number(period.id)],
          );
          await conn.query(
            "DELETE FROM commercial_planning_period_targets WHERE period_id = ?",
            [Number(period.id)],
          );
          for (const target of normalizedByQuarter.get(quarter) || []) {
            await conn.query(
              `INSERT INTO commercial_planning_period_targets
                 (period_id, seller_user_id, sales_quota_amount, currency_code,
                  expected_margin_percent, expected_contribution_amount, notes, status,
                  created_by_user_id, updated_by_user_id, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                Number(period.id), target.sellerUserId, target.salesQuotaAmount,
                currencyCode, target.expectedMarginPercent,
                target.expectedContributionAmount, target.notes, target.status,
                actorUserId, actorUserId, now, now,
              ],
            );
          }
        }
      });
    } catch (error) {
      return res.status(Number(error?.status) || 500).json({
        message: error.message || "No fue posible guardar las metas del año",
      });
    }

    const updatedPlan = await getPlanningYearDetail(year);
    for (const item of editableQuarters) {
      const updatedQuarter = updatedPlan.quarters.find(
        (quarter) => quarter.quarter === item.quarter,
      );
      await logAuditEvent({
        req,
        module: "planeacion_comercial",
        action: "updated_targets",
        entityType: "commercial_planning_period",
        entityId: updatedQuarter.period.id,
        detail: `Metas trimestrales actualizadas en ${quarterLabel(year, item.quarter)}`,
        before: {
          targets: (beforeByQuarter.get(item.quarter) || []).map((target) =>
            buildChangedTargetFields(null, target),
          ),
        },
        after: {
          targets: updatedQuarter.targets.map((target) =>
            buildChangedTargetFields(null, target),
          ),
        },
      });
    }
    res.json({ message: "Metas del año actualizadas correctamente", ...updatedPlan });
  },
);

router.get(
  "/periods",
  requirePermission("planeacion_comercial.read"),
  async (req, res) => {
    const selectedYear = req.query.year ? Number(req.query.year) : null;
    const selectedQuarter = req.query.quarter
      ? Number(req.query.quarter)
      : null;

    const where = [];
    const params = [];
    if (Number.isInteger(selectedYear)) {
      where.push("p.plan_year = ?");
      params.push(selectedYear);
    }
    if (Number.isInteger(selectedQuarter)) {
      where.push("p.plan_quarter = ?");
      params.push(selectedQuarter);
    }

    const rows = await query(
      `SELECT p.*,
        COUNT(t.id) AS target_count,
        COALESCE(SUM(t.sales_quota_amount), 0) AS total_quota_amount,
        COALESCE(SUM(t.expected_contribution_amount), 0) AS total_contribution_amount,
        AVG(t.expected_margin_percent) AS expected_margin_average_percent
       FROM commercial_planning_periods p
      LEFT JOIN commercial_planning_period_targets t ON t.period_id = p.id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       GROUP BY p.id
       ORDER BY p.plan_year DESC, p.plan_quarter DESC`,
      params,
    );

    res.json({ periods: rows.map(mapPeriodRow) });
  },
);

router.get(
  "/periods/:periodId",
  requirePermission("planeacion_comercial.read"),
  async (req, res) => {
    const period = await getPeriodById(Number(req.params.periodId));
    if (!period) {
      return res.status(404).json({ message: "Periodo no encontrado" });
    }

    res.json({
      period,
      targets: await getTargetsForPeriod(period.id),
      eligibleSellers: await listEligibleSellers(),
    });
  },
);

router.get(
  "/eligible-sellers",
  requirePermission("planeacion_comercial.read"),
  async (_req, res) => {
    res.json({ sellers: await listEligibleSellers() });
  },
);

router.get(
  "/seller-parameters",
  requirePermission("planeacion_comercial.read"),
  async (_req, res) => {
    try {
      const payload = await buildSellerParametersPayload();
      res.json(payload);
    } catch (error) {
      res.status(Number(error?.status) || 500).json({
        message:
          error.message ||
          "No fue posible cargar la configuracion de parametros por vendedor",
      });
    }
  },
);

router.put(
  "/seller-parameters",
  requirePermission("planeacion_comercial.update"),
  async (req, res) => {
    const parsed = replaceSellerParametersSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const normalizedParameters = parsed.data.parameters.map((item) => ({
      sellerUserId: Number(item.sellerUserId),
      averageSaleTicketAmount: roundMoney(item.averageSaleTicketAmount),
      leadsToOpportunitiesRatio: roundPercent(
        item.leadsToOpportunitiesRatio,
        4,
      ),
      opportunitiesToWinsRatio: roundPercent(item.opportunitiesToWinsRatio, 4),
      averageOpportunityToWinDays: roundPercent(
        item.averageOpportunityToWinDays,
        2,
      ),
      useHistoricalAverageSaleTicketForQuotaProbability:
        item.useHistoricalAverageSaleTicketForQuotaProbability === true,
      useHistoricalLeadsToOpportunitiesForQuotaProbability:
        item.useHistoricalLeadsToOpportunitiesForQuotaProbability === true,
      useHistoricalOpportunitiesToWinsForQuotaProbability:
        item.useHistoricalOpportunitiesToWinsForQuotaProbability === true,
      useHistoricalAverageOpportunityToWinDaysForQuotaProbability:
        item.useHistoricalAverageOpportunityToWinDaysForQuotaProbability ===
        true,
      useHistoricalValuesForQuotaProbability:
        (item.useHistoricalValuesForQuotaProbability === true &&
          item.useHistoricalAverageSaleTicketForQuotaProbability === true &&
          item.useHistoricalLeadsToOpportunitiesForQuotaProbability === true &&
          item.useHistoricalOpportunitiesToWinsForQuotaProbability === true &&
          item.useHistoricalAverageOpportunityToWinDaysForQuotaProbability ===
            true) ||
        false,
    }));

    const duplicateSellerIds = normalizedParameters
      .map((item) => item.sellerUserId)
      .filter(
        (sellerUserId, index, list) => list.indexOf(sellerUserId) !== index,
      );
    if (duplicateSellerIds.length) {
      return res.status(400).json({
        message: "No se permiten vendedores duplicados en la configuracion",
      });
    }

    const [eligibleSellers, beforeParameters] = await Promise.all([
      listEligibleSellers(),
      getSellerParameters(),
    ]);
    const eligibleSellerIds = new Set(
      eligibleSellers.map((seller) => seller.id),
    );
    const nonEligible = normalizedParameters.find(
      (item) => !eligibleSellerIds.has(item.sellerUserId),
    );
    if (nonEligible) {
      return res.status(400).json({
        message:
          "Solo puedes configurar parametros para vendedores elegibles y activos",
      });
    }

    const actorUserId = Number(req.user?.id) || null;
    const now = new Date();

    await withTransaction(async (conn) => {
      for (const item of normalizedParameters) {
        await conn.query(
          `INSERT INTO commercial_planning_seller_parameters
             (seller_user_id, average_sale_ticket_amount, leads_to_opportunities_ratio,
              opportunities_to_wins_ratio, average_opportunity_to_win_days,
              use_hist_avg_ticket_quota_prob,
              use_hist_l2o_quota_prob,
              use_hist_o2w_quota_prob,
              use_hist_avg_o2w_days_quota_prob,
              use_historical_values_for_quota_probability,
              created_by_user_id, updated_by_user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             average_sale_ticket_amount = VALUES(average_sale_ticket_amount),
             leads_to_opportunities_ratio = VALUES(leads_to_opportunities_ratio),
             opportunities_to_wins_ratio = VALUES(opportunities_to_wins_ratio),
             average_opportunity_to_win_days = VALUES(average_opportunity_to_win_days),
             use_hist_avg_ticket_quota_prob = VALUES(use_hist_avg_ticket_quota_prob),
             use_hist_l2o_quota_prob = VALUES(use_hist_l2o_quota_prob),
             use_hist_o2w_quota_prob = VALUES(use_hist_o2w_quota_prob),
             use_hist_avg_o2w_days_quota_prob = VALUES(use_hist_avg_o2w_days_quota_prob),
             use_historical_values_for_quota_probability = VALUES(use_historical_values_for_quota_probability),
             updated_by_user_id = VALUES(updated_by_user_id),
             updated_at = VALUES(updated_at)`,
          [
            item.sellerUserId,
            item.averageSaleTicketAmount,
            item.leadsToOpportunitiesRatio,
            item.opportunitiesToWinsRatio,
            item.averageOpportunityToWinDays,
            item.useHistoricalAverageSaleTicketForQuotaProbability ? 1 : 0,
            item.useHistoricalLeadsToOpportunitiesForQuotaProbability ? 1 : 0,
            item.useHistoricalOpportunitiesToWinsForQuotaProbability ? 1 : 0,
            item.useHistoricalAverageOpportunityToWinDaysForQuotaProbability
              ? 1
              : 0,
            item.useHistoricalValuesForQuotaProbability ? 1 : 0,
            actorUserId,
            actorUserId,
            now,
            now,
          ],
        );
      }
    });

    const payload = await buildSellerParametersPayload();
    await logAuditEvent({
      req,
      module: "planeacion_comercial",
      action: "updated_seller_parameters",
      entityType: "commercial_planning_seller_parameters",
      entityId: null,
      detail: "Configuracion atemporal de parametros por vendedor actualizada",
      before: { parameters: beforeParameters },
      after: { parameters: payload.parameters },
    });

    res.json({
      message: "Parametros por vendedor actualizados correctamente",
      ...payload,
    });
  },
);

router.get(
  "/periods/:periodId/commission-configs",
  requirePermission("planeacion_comercial.read"),
  async (req, res) => {
    try {
      const payload = await buildCommissionConfigPayload(
        Number(req.params.periodId),
      );
      res.json(payload);
    } catch (error) {
      res.status(Number(error?.status) || 500).json({
        message:
          error.message ||
          "No fue posible cargar la configuracion de comisiones",
      });
    }
  },
);

router.put(
  "/periods/:periodId/commission-configs",
  requirePermission("planeacion_comercial.update"),
  async (req, res) => {
    const parsed = replaceCommissionConfigsSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const periodId = Number(req.params.periodId);
    const period = await getPeriodById(periodId);
    if (!period) {
      return res.status(404).json({ message: "Periodo no encontrado" });
    }
    const actorUserId = Number(req.user?.id) || null;
    const now = new Date();
    const normalizedConfigs = parsed.data.configs.map((config) => ({
      sellerUserId: Number(config.sellerUserId),
      productCommissionPct: roundPercent(config.productCommissionPct, 4),
      serviceCommissionPct: roundPercent(config.serviceCommissionPct, 4),
      renewalCommissionPct: roundPercent(config.renewalCommissionPct, 4),
      notes: String(config.notes || "").trim() || null,
    }));

    const duplicateSellerIds = normalizedConfigs
      .map((config) => config.sellerUserId)
      .filter(
        (sellerUserId, index, list) => list.indexOf(sellerUserId) !== index,
      );
    if (duplicateSellerIds.length) {
      return res.status(400).json({
        message:
          "No se permiten vendedores duplicados en la configuracion trimestral",
      });
    }

    const beforeConfigs = await getCommissionConfigsForPeriod(periodId);

    await withTransaction(async (conn) => {
      await conn.query(
        `DELETE FROM commercial_planning_commission_configs
         WHERE period_id = ?`,
        [periodId],
      );

      for (const config of normalizedConfigs) {
        await conn.query(
          `INSERT INTO commercial_planning_commission_configs
             (period_id, seller_user_id, product_commission_pct, service_commission_pct,
              renewal_commission_pct, notes, created_by_user_id, updated_by_user_id,
              created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            periodId,
            config.sellerUserId,
            config.productCommissionPct,
            config.serviceCommissionPct,
            config.renewalCommissionPct,
            config.notes,
            actorUserId,
            actorUserId,
            now,
            now,
          ],
        );
      }

      await conn.query(
        `UPDATE commercial_planning_periods
         SET updated_by_user_id = ?, updated_at = ?
         WHERE id = ?`,
        [actorUserId, now, periodId],
      );
    });

    const payload = await buildCommissionConfigPayload(periodId);

    await logAuditEvent({
      req,
      module: "planeacion_comercial",
      action: "updated_commission_configs",
      entityType: "commercial_planning_period",
      entityId: periodId,
      detail: `Configuracion de comisiones actualizada en ${payload.period.label}`,
      before: { configs: beforeConfigs },
      after: { configs: payload.configs },
    });

    res.json({
      message: "Configuracion de comisiones actualizada correctamente",
      ...payload,
    });
  },
);

router.get(
  "/periods/:periodId/commission-tracking",
  requirePermission("planeacion_comercial.read"),
  async (req, res) => {
    try {
      const payload = await buildCommissionTrackingPayload(
        Number(req.params.periodId),
      );
      res.json(payload);
    } catch (error) {
      res.status(Number(error?.status) || 500).json({
        message:
          error.message || "No fue posible cargar el seguimiento de comisiones",
      });
    }
  },
);

router.get(
  "/audit",
  requirePermission("planeacion_comercial.audit.read"),
  async (req, res) => {
    const selectedYear = req.query.year ? Number(req.query.year) : null;
    const selectedQuarter = req.query.quarter
      ? Number(req.query.quarter)
      : null;
    const sellerUserId = req.query.sellerUserId
      ? Number(req.query.sellerUserId)
      : null;
    const where = [`module = 'planeacion_comercial'`];
    const params = [];

    if (Number.isInteger(selectedYear)) {
      where.push("detail LIKE ?");
      params.push(`%${selectedYear}%`);
    }
    if (Number.isInteger(selectedQuarter)) {
      where.push("detail LIKE ?");
      params.push(`%T${selectedQuarter}%`);
    }
    if (Number.isInteger(sellerUserId)) {
      where.push("changed_fields LIKE ?");
      params.push(`%\"sellerUserId\":${sellerUserId}%`);
    }

    const rows = await query(
      `SELECT id, action, entity_type, entity_id, detail, changed_fields,
              performed_by_user_id, performed_by_name, performed_by_email, created_at
       FROM audit_log
       WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT 300`,
      params,
    );

    res.json({
      entries: rows.map((row) => ({
        id: Number(row.id),
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id === null ? null : Number(row.entity_id),
        detail: row.detail || "",
        changedFields: parseAuditChangedFields(row.changed_fields),
        performedByUserId:
          row.performed_by_user_id === null
            ? null
            : Number(row.performed_by_user_id),
        performedByName: row.performed_by_name || "",
        performedByEmail: row.performed_by_email || "",
        createdAt: row.created_at,
      })),
    });
  },
);

export default router;
